// Gmail inbox via IMAP + a Google "app password".
// Typically used for school/work Outlook mail that is auto-forwarded to Gmail, since many
// schools don't allow third-party apps to read their Outlook mail directly.
// The mailbox is opened read-only, so nothing gets marked as read or changed.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const WINDOW = 'newer_than:3d';
const MAX_MESSAGES = 40;

export function createGmail({ user, pass, filter }) {
  const configured = Boolean(user && pass);
  const extra = filter ? ` ${filter}` : '';

  async function fetchMail() {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user, pass: pass.replace(/\s+/g, '') }, // Google shows app passwords with spaces
      logger: false,
      socketTimeout: 30000,
    });
    try {
      await client.connect();
    } catch (err) {
      if (err.authenticationFailed) throw new Error('Gmail rejected the login. Check GMAIL_USER and GMAIL_APP_PASSWORD in .env (it must be an app password, not your normal password).');
      throw new Error(`Couldn't connect to Gmail: ${err.message}`);
    }

    try {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true });
      try {
        // everything from the last few days, read or not (read mail is shown dimmed)
        const recent = (await client.search({ gmraw: `${WINDOW}${extra}` }, { uid: true })) || [];
        const unread = (await client.search({ gmraw: `is:unread${extra}` }, { uid: true })) || [];
        const uids = recent.slice(-MAX_MESSAGES);
        const raw = [];
        if (uids.length) {
          for await (const msg of client.fetch(uids, {
            uid: true, flags: true, envelope: true, internalDate: true, labels: true, threadId: true,
            source: { maxLength: 40000 }, // enough for headers + a text preview, skips big attachments
          }, { uid: true })) raw.push(msg);
        }
        const emails = await Promise.all(raw.map((m) => toEmail(m, user)));
        return { emails, unreadCount: unread.length };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }

  return { configured, fetchMail };
}

export async function toEmail(msg, user) {
  const parsed = await simpleParser(msg.source || Buffer.alloc(0)).catch(() => null);
  const from = msg.envelope?.from?.[0] || {};
  const lines = parsed?.headerLines || [];
  const header = (k) => (lines.find((h) => h.key === k)?.line || '').replace(/^[^:]*:\s*/, '').trim().toLowerCase();
  const isBulk = lines.some((h) => h.key === 'list-unsubscribe' || h.key === 'list-id');
  const isHigh = header('importance') === 'high' || /^[12]\b/.test(header('x-priority'));
  const text = parsed?.text || (parsed?.html ? parsed.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, ' ') : '');
  const flags = msg.flags || new Set();
  const labels = msg.labels || new Set();

  return {
    id: `gmail:${msg.emailId || msg.uid}`,
    source: 'gmail',
    kind: 'email',
    title: msg.envelope?.subject || '(no subject)',
    from: from.name || from.address || '',
    posted: (msg.internalDate || msg.envelope?.date || new Date()).toISOString?.() ?? String(msg.internalDate),
    preview: text.replace(/\s+/g, ' ').trim().slice(0, 200),
    important: isHigh || undefined,
    flagged: flags.has('\\Flagged') || undefined,
    // newsletters/promos carry List-Unsubscribe; Gmail's own "important" marker overrides
    focused: labels.has('\\Important') || !isBulk,
    unread: !flags.has('\\Seen'),
    url: msg.threadId
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(user)}#all/${BigInt(msg.threadId).toString(16)}`
      : undefined,
  };
}
