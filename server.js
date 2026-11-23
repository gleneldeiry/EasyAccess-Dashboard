// EasyAccess — a personal dashboard that merges Canvas, Google Calendar and Gmail.
// Runs locally: `npm start`, then open http://localhost:3000
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ical from 'node-ical';
import { createGmail } from './gmail.js';
import { createState } from './state.js';
import { createYouTube } from './youtube.js';
import { createSports } from './sports.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env yet → demo mode */ }

const PORT = Number(process.env.PORT) || 3000;
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD) || 14;
const CACHE_MS = 90 * 1000;

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const config = {
  canvasUrl: (process.env.CANVAS_URL || '').replace(/\/+$/, ''),
  canvasToken: process.env.CANVAS_TOKEN || '',
  feeds: [
    ...list(process.env.CANVAS_ICS).map((url) => ({ source: 'canvas', url })),
    ...list(process.env.GOOGLE_ICS).map((url) => ({ source: 'google', url })),
  ],
};
const canvasApiOn = Boolean(config.canvasUrl && config.canvasToken);
const gmail = createGmail({
  user: process.env.GMAIL_USER || '',
  pass: process.env.GMAIL_APP_PASSWORD || '',
  filter: process.env.GMAIL_FILTER || '',
});
const youtube = createYouTube({
  channels: process.env.YOUTUBE_CHANNELS || '',
  defaults: (process.env.YOUTUBE_DEFAULTS || '').toLowerCase() !== 'off',
});
const sports = createSports({ leagues: process.env.SPORTS_LEAGUES, teams: process.env.SPORTS_TEAMS });
const store = createState(process.env.STATE_FILE || path.join(ROOT, 'data', 'state.json'));
// Weekly gym routine, Sunday → Saturday. "Rest" (or Off / -) marks rest days.
const DEFAULT_ROUTINE = ['Rest', 'Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs'];
const gymRoutine = (() => {
  const days = list(process.env.GYM_ROUTINE).map((d) => (/^(rest|off|-|x)$/i.test(d) ? 'Rest' : d.slice(0, 12)));
  if (days.length && days.length !== 7) console.warn('GYM_ROUTINE needs exactly 7 days (Sunday → Saturday); using the default.');
  return days.length === 7 ? days : DEFAULT_ROUTINE;
})();
const clientConfig = { gymRoutine };

const demoMode = !canvasApiOn && config.feeds.length === 0 && !gmail.configured;

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v.val ?? '') : String(v));
const strip = (html) =>
  text(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();

async function fetchText(url, headers = {}) {
  const res = await fetch(url.replace(/^webcal:/i, 'https:'), {
    headers: { 'User-Agent': 'EasyAccess-Dashboard', ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------- calendar feeds (.ics) ----------
async function loadFeed({ source, url }) {
  if (source === 'google' && !/\.ics(\?|$)/i.test(url)) {
    throw new Error('that\'s not the iCal link. In Google Calendar settings use "Secret address in iCal format" (it ends in .ics)');
  }
  const data = ical.sync.parseICS(await fetchText(url));
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 1);
  const to = new Date(from); to.setDate(to.getDate() + DAYS_AHEAD + 1);
  const items = [];

  for (const ev of Object.values(data)) {
    if (ev.type !== 'VEVENT' || ev.status === 'CANCELLED') continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
    } catch {
      continue;
    }
    for (const inst of instances) {
      const e = inst.event || ev;
      const title = text(inst.summary || e.summary) || '(no title)';
      // Canvas feeds tag assignments with a URL containing "assignment"
      const isAssignment = source === 'canvas' && /assignment/i.test(text(e.url) + text(e.uid));
      const courseMatch = source === 'canvas' ? title.match(/\[([^\]]+)\]\s*$/) : null;
      items.push({
        id: `${source}:${text(e.uid)}:${inst.start.toISOString()}`,
        source,
        kind: isAssignment ? 'assignment' : 'event',
        title: courseMatch ? title.replace(/\s*\[[^\]]+\]\s*$/, '') : title,
        course: courseMatch ? courseMatch[1] : undefined,
        allDay: inst.isFullDay,
        start: inst.isFullDay ? ymd(inst.start) : inst.start.toISOString(),
        end: inst.end ? (inst.isFullDay ? ymd(inst.end) : inst.end.toISOString()) : undefined,
        location: text(e.location) || undefined,
        url: text(e.url) || undefined,
      });
    }
  }
  return items;
}

// ---------- Canvas API (optional, gives to-dos, missing work, announcements) ----------
async function canvas(pathname) {
  const sep = pathname.includes('?') ? '&' : '?';
  const body = await fetchText(`${config.canvasUrl}/api/v1${pathname}${sep}per_page=50`, {
    Authorization: `Bearer ${config.canvasToken}`,
  });
  return JSON.parse(body);
}

async function loadCanvasApi() {
  const items = [];
  const [upcoming, missing, courses] = await Promise.all([
    canvas('/users/self/upcoming_events'),
    canvas('/users/self/missing_submissions?include[]=course&filter[]=submittable').catch(() => []),
    canvas('/courses?enrollment_state=active').catch(() => []),
  ]);
  const courseName = new Map(courses.map((c) => [c.id, c.course_code || c.name]));

  for (const u of upcoming) {
    const a = u.assignment;
    const when = a?.due_at || u.start_at;
    if (!when) continue;
    items.push({
      id: `canvas:${a ? 'a' + a.id : 'e' + u.id}`,
      source: 'canvas',
      kind: a ? 'assignment' : 'event',
      title: a?.name || u.title,
      course: u.context_name,
      allDay: Boolean(u.all_day),
      start: u.all_day && u.all_day_date ? u.all_day_date : when,
      end: a ? undefined : u.end_at || undefined,
      location: u.location_name || undefined,
      url: a?.html_url || u.html_url,
      points: a?.points_possible ?? undefined,
      submitted: a?.has_submitted_submissions || undefined,
    });
  }

  for (const a of missing) {
    items.push({
      id: `canvas:a${a.id}`,
      source: 'canvas',
      kind: 'assignment',
      missing: true,
      title: a.name,
      course: a.course?.course_code || courseName.get(a.course_id),
      allDay: false,
      start: a.due_at,
      url: a.html_url,
      points: a.points_possible ?? undefined,
    });
  }

  const announcements = [];
  if (courses.length) {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const codes = courses.map((c) => `context_codes[]=course_${c.id}`).join('&');
    const anns = await canvas(`/announcements?${codes}&start_date=${since}`).catch(() => []);
    for (const n of anns) {
      const cid = Number(String(n.context_code || '').replace('course_', ''));
      announcements.push({
        id: `canvas:n${n.id}`,
        source: 'canvas',
        kind: 'announcement',
        title: n.title,
        course: courseName.get(cid),
        posted: n.posted_at,
        author: n.author?.display_name,
        preview: strip(n.message).slice(0, 220),
        url: n.html_url,
      });
    }
  }
  return { items, announcements };
}

// ---------- demo data (shown until you add your links) ----------
function demoData() {
  const at = (dayOffset, h, m = 0) => {
    const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return ymd(d); };
  const now = new Date();
  const soon = new Date(now.getTime() + 25 * 60000); soon.setSeconds(0, 0);
  const soonEnd = new Date(soon.getTime() + 75 * 60000);
  const items = [
    { source: 'google', kind: 'event', title: 'Gym', start: at(0, 7), end: at(0, 8) },
    { source: 'canvas', kind: 'event', title: 'BIO 201 Lecture', course: 'BIO 201', start: soon.toISOString(), end: soonEnd.toISOString(), location: 'Science Hall 104' },
    { source: 'google', kind: 'event', title: 'Advisor meeting', start: at(0, 15, 30), end: at(0, 16), location: 'Teams' },
    { source: 'google', kind: 'event', title: 'Dinner with Sam', start: at(0, 19), end: at(0, 20, 30) },
    { source: 'canvas', kind: 'assignment', title: 'Lab Report 4', course: 'BIO 201', start: at(0, 23, 59), points: 50 },
    { source: 'canvas', kind: 'assignment', title: 'Problem Set 7', course: 'MATH 220', start: at(1, 9), points: 20 },
    { source: 'canvas', kind: 'assignment', title: 'Reading Response', course: 'ENG 105', start: at(-1, 23, 59), missing: true, points: 10 },
    { source: 'google', kind: 'event', title: 'Study group', start: at(1, 14), end: at(1, 15, 30), location: 'Library 3F' },
    { source: 'google', kind: 'event', title: "Mom's birthday", allDay: true, start: day(2), end: day(3) },
    { source: 'canvas', kind: 'assignment', title: 'Midterm Essay', course: 'ENG 105', start: at(3, 23, 59), points: 100 },
    { source: 'canvas', kind: 'event', title: 'MATH 220 Midterm', course: 'MATH 220', start: at(4, 10), end: at(4, 11, 50) },
    { source: 'google', kind: 'event', title: 'Shift at work', start: at(5, 12), end: at(5, 17) },
    { source: 'canvas', kind: 'assignment', title: 'Quiz 5', course: 'CHEM 110', start: at(6, 23, 59), points: 15 },
  ].map((x, i) => ({ id: `demo:${i}`, allDay: false, ...x }));
  const announcements = [
    { id: 'demo:n1', source: 'canvas', kind: 'announcement', title: 'Office hours moved to Thursday', course: 'MATH 220', posted: new Date(now - 2 * 3600e3).toISOString(), author: 'Prof. Lee', preview: 'This week only, office hours will be Thursday 2–4pm instead of Wednesday.' },
    { id: 'demo:n2', source: 'canvas', kind: 'announcement', title: 'Midterm review sheet posted', course: 'BIO 201', posted: new Date(now - 26 * 3600e3).toISOString(), author: 'Dr. Patel', preview: 'The review sheet is in Files > Exams. Focus on chapters 5–8.' },
  ];
  const mins = (m) => new Date(now - m * 60000).toISOString();
  const emails = [
    { id: 'demo:m1', source: 'gmail', kind: 'email', title: 'Re: Research assistant position', from: 'Dr. Alvarez', posted: mins(12), preview: 'Thanks for following up — could you come by Thursday at 3 to chat about the role?', focused: true, unread: true, flagged: true },
    { id: 'demo:m2', source: 'gmail', kind: 'email', title: 'Room change for Friday exam', from: 'BIO 201 TA', posted: mins(95), preview: 'Heads up: Friday\'s exam is moving to Little Hall 125.', focused: true, unread: true, important: true },
    { id: 'demo:m3', source: 'gmail', kind: 'email', title: 'Your financial aid has been disbursed', from: 'Student Financial Aid', posted: mins(300), preview: 'Funds have been applied to your student account.', focused: true, unread: true },
    { id: 'demo:m4', source: 'gmail', kind: 'email', title: 'This week at the Rec Center', from: 'RecSports', posted: mins(400), preview: 'New yoga classes, intramural sign-ups and more.', focused: false, unread: true },
  ];
  return { items, announcements, emails, mail: { configured: true, account: 'you@gmail.com', unreadCount: 7 } };
}

// ---------- aggregate ----------
let cache = null;

async function buildDashboard(force = false) {
  if (demoMode) {
    const [videos, sportsData] = await Promise.all([youtube.fetchVideos(force).catch(() => []), sports.fetchSports().catch(() => null)]);
    return { demo: true, config: clientConfig, generatedAt: new Date().toISOString(), sources: {
      canvas: { ok: true }, google: { ok: true }, gmail: { ok: true }, youtube: { ok: true }, sports: { ok: true } }, ...demoData(), videos, sports: sportsData };
  }

  const sources = {};
  const mark = (name, ok, error) => {
    const prev = sources[name];
    sources[name] = { ok: (prev?.ok ?? true) && ok, error: error || prev?.error };
  };
  let items = [];
  let announcements = [];
  let emails = [];
  let videos = [];
  let sportsData = null;
  const mail = { configured: gmail.configured, account: process.env.GMAIL_USER || undefined };

  const jobs = config.feeds.map((f) =>
    loadFeed(f).then((r) => { items.push(...r); mark(f.source, true); })
      .catch((err) => { console.error(`[${f.source}] feed failed:`, err.message); mark(f.source, false, err.message); }));
  if (canvasApiOn) {
    jobs.push(loadCanvasApi().then((r) => { items.push(...r.items); announcements = r.announcements; mark('canvas', true); })
      .catch((err) => { console.error('[canvas] API failed:', err.message); mark('canvas', false, err.message); }));
  }
  if (gmail.configured) {
    jobs.push(gmail.fetchMail().then((r) => { emails = r.emails; mail.unreadCount = r.unreadCount; mark('gmail', true); })
      .catch((err) => { console.error('[gmail] mail failed:', err.message); mark('gmail', false, err.message); }));
  }
  jobs.push(youtube.fetchVideos(force).then((r) => { videos = r; mark('youtube', true); })
    .catch((err) => { console.error('[youtube] failed:', err.message); mark('youtube', false, err.message); }));
  jobs.push(sports.fetchSports().then((r) => { sportsData = r; mark('sports', true); })
    .catch((err) => { console.error('[sports] failed:', err.message); mark('sports', false, err.message); }));
  await Promise.all(jobs);

  // De-duplicate (Canvas API + Canvas feed often list the same assignment)
  const seen = new Map();
  for (const it of items) {
    const key = `${it.source}|${it.title.toLowerCase()}|${String(it.start).slice(0, 16)}`;
    const prev = seen.get(key);
    if (!prev || (it.id.startsWith('canvas:a') && !prev.id.startsWith('canvas:a'))) seen.set(key, { ...prev, ...it });
  }
  items = [...seen.values()];

  return { demo: false, config: clientConfig, canvasApi: canvasApiOn, generatedAt: new Date().toISOString(), sources, items, announcements, emails, mail, videos, sports: sportsData };
}

async function getDashboard(force) {
  if (!force && cache && Date.now() - cache.t < CACHE_MS) return cache.data;
  const data = await buildDashboard(force);
  cache = { t: Date.now(), data };
  return data;
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  // Only answer requests addressed to this machine (blocks DNS-rebinding tricks)
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  try {
    if (url.pathname === '/api/state' && req.method === 'POST') {
      // Custom header means other websites can't trigger this from your browser
      if (req.headers['x-easyaccess'] !== '1') return json(403, { error: 'forbidden' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 10000) return json(413, { error: 'too large' }); }
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { error: 'bad json' }); }
      try { return json(200, await store.update(body)); } catch (err) { return json(err.status || 500, { error: err.message }); }
    }
    if (url.pathname === '/api/dashboard') {
      const data = await getDashboard(url.searchParams.has('refresh'));
      return json(200, { ...data, state: await store.get() });
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(ROOT, 'public', path.normalize(rel));
    if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    const body = await fs.readFile(file);
    // no-cache: always revalidate, so page updates show up right away (also in the Mac app)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') { res.writeHead(404); return res.end('Not found'); }
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, 'localhost', () => {
  console.log(`\n  EasyAccess dashboard → http://localhost:${PORT}`);
  console.log(demoMode
    ? '  (demo mode — copy .env.example to .env and add your links)\n'
    : `  sources: ${config.feeds.length} calendar feed(s)${canvasApiOn ? ' + Canvas API' : ''}\n`);
});
