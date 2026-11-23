// EasyAccess dashboard front end
const FETCH_EVERY = 2 * 60 * 1000; // pull fresh data every 2 min
const TICK_EVERY = 30 * 1000;      // re-render countdowns every 30 s
const ALERT_MINUTES = 10;          // desktop alert this long before an event
const NEW_FOR_HOURS = 12;          // keep the "NEW" tag this long
const DUE_DAYS = 14;               // how far ahead the Due column looks
const SCHEDULE_DAYS = 7;

const SOURCES = { canvas: 'Canvas', google: 'Google', gmail: 'Gmail', youtube: 'YouTube', sports: 'ESPN' };
// Gym routine, Sunday → Saturday. Set GYM_ROUTINE in .env to change it; the server sends it as data.config.
const DEFAULT_ROUTINE = ['Rest', 'Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs'];
const routine = () => data?.config?.gymRoutine || DEFAULT_ROUTINE;
const PALETTE = ['#f97362', '#4f8fff', '#45c486', '#f5a524', '#a78bfa', '#ec6cb9', '#22b3b3', '#d4b13a'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let data = null;
let lastFetch = 0;
const alerted = new Set();

// ---------- storage (fails soft in private windows) ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- dates ----------
const parseDate = (v) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  return new Date(v);
};
const dayStart = (d, offset = 0) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + offset); return x; };
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => {
  const t = dayStart(new Date());
  if (sameDay(d, t)) return 'Today';
  if (sameDay(d, dayStart(t, 1))) return 'Tomorrow';
  if (sameDay(d, dayStart(t, -1))) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
const longDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
function until(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? 's' : ''}`;
}
function ago(d, now) {
  const m = Math.round((now - d) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h`;
  return fmtDay(d);
}

// one stable colour per course, falling back to the source colour
function colorFor(it) {
  if (!it.course) return `var(--${it.source})`;
  let h = 0;
  for (const ch of it.course) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ---------- data shaping ----------
function prepare(raw) {
  raw.emails = raw.emails || [];
  const seenKey = raw.demo ? 'ea.firstSeen.demo' : 'ea.firstSeen.v2';
  const firstSeen = store.get(seenKey, null);
  const isFirstVisit = firstSeen === null;
  const seen = firstSeen || {};
  const now = Date.now();
  raw.videos = raw.videos || [];
  raw.sports = raw.sports || { leagues: [], myTeams: [], games: [], news: [] };
  const all = [...raw.items, ...raw.announcements, ...raw.emails, ...raw.videos, ...raw.sports.news];
  const fresh = [];

  // a whole new section (e.g. a source you just linked) shouldn't light up as NEW all at once
  const seenKinds = new Set(Object.keys(seen).map((id) => (all.find((i) => i.id === id) || {}).kind).filter(Boolean));
  for (const it of all) {
    const quiet = isFirstVisit || !seenKinds.has(it.kind);
    if (!(it.id in seen)) { seen[it.id] = quiet ? 0 : now; if (!quiet) fresh.push(it); }
    it.isNew = seen[it.id] > 0 && now - seen[it.id] < NEW_FOR_HOURS * 3600e3;
    it.startD = parseDate(it.start || it.posted);
    it.endD = parseDate(it.end);
    // Canvas lists 11:59 PM due dates as "all day": treat them as due at end of that day
    it.dueD = it.allDay && it.startD ? new Date(dayStart(it.startD, 1) - 60000) : it.startD;
    it.color = colorFor(it);
  }
  const live = new Set(all.map((i) => i.id));
  for (const id of Object.keys(seen)) if (!live.has(id)) delete seen[id];
  store.set(seenKey, seen);

  raw.items.sort((a, b) => (a.startD - b.startD) || (b.allDay - a.allDay));
  if (fresh.length && !raw.demo) notifyNew(fresh);
  return raw;
}

const isEvent = (i) => i.kind === 'event';
const timed = (i) => isEvent(i) && !i.allDay && i.startD;

function onDay(item, day) {
  const s = dayStart(day), e = dayStart(day, 1);
  if (item.allDay) {
    const end = item.endD || dayStart(item.startD, 1);
    return item.startD < e && end > s;
  }
  return item.startD >= s && item.startD < e;
}

// ---------- shared pieces ----------
function row(it, { title = esc(it.title), meta = '', right = '', cls = '', below = '', lead = '<span class="dot"></span>' } = {}) {
  const open = it.url ? `<a class="row ${cls}" href="${esc(it.url)}" target="_blank" rel="noopener"` : `<div class="row ${cls}"`;
  const close = it.url ? '</a>' : '</div>';
  return `${open} style="--c:${it.color}">${lead}
    <div><div class="t">${title}${it.isNew ? '<span class="tag new">NEW</span>' : ''}</div>${meta ? `<div class="m">${meta}</div>` : ''}${below}</div>
    <div class="w">${right}</div>${close}`;
}
const group = (label, body, { cls = '', count = '' } = {}) =>
  `<div class="group"><div class="group-h ${cls}"><span>${label}</span><span>${count}</span></div>${body}</div>`;
const metaLine = (...parts) => parts.filter(Boolean).map(esc).join(' · ');

// ---------- render ----------
function render() {
  if (!data) return;
  const now = new Date();
  const hour = now.getHours();
  $('greeting').textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('date').textContent = `${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · updated ${fmtTime(new Date(data.generatedAt))}`;

  renderSources();
  renderBanner();
  renderStats(now);
  renderHero(now);
  renderSchedule(now);
  renderDue(now);
  renderGym(now);
  renderInbox(now);
  renderVideos(now);
  renderSports(now);
  checkAlerts(now);
}

function renderSources() {
  $('sources').innerHTML = Object.entries(SOURCES).map(([key, name]) => {
    const s = data.sources[key];
    const cls = !s ? 'off' : s.ok ? '' : 'bad';
    const title = `${name}: ${!s ? 'not linked' : s.ok ? 'connected' : `couldn't load (${s.error})`}`;
    return `<span class="src ${cls}" style="--c:var(--${key})" title="${esc(title)}"></span>`;
  }).join('');
}

function renderBanner() {
  const b = $('banner');
  const broken = Object.entries(data.sources).filter(([, s]) => !s.ok);
  if (data.demo) b.innerHTML = 'You\'re looking at <b>sample data</b>. Follow <code>SETUP.md</code> to link Canvas, Google Calendar and Gmail.';
  else if (broken.length) b.innerHTML = broken.map(([k, s]) => `<b>${SOURCES[k]}</b> didn't load: ${esc(s.error.replace(/\.$/, ''))}.${k === 'gmail' ? '' : ' Check its link in <code>.env</code>.'}`).join('<br>');
  else { b.hidden = true; return; }
  b.hidden = false;
}

const assignments = () => data.items.filter((i) => i.kind === 'assignment');
// checked off on the dashboard, or Canvas says it's submitted
const isDone = (it) => Boolean(it.submitted || data.state?.done?.[it.id]);

function renderStats(now) {
  const a = assignments();
  const todayEnd = dayStart(now, 1);
  const open = a.filter((i) => !isDone(i) && !i.missing && i.dueD > now);
  const dueToday = open.filter((i) => i.dueD < todayEnd).length;
  const week = open.filter((i) => i.dueD < dayStart(now, 8)).length;
  const missing = a.filter((i) => i.missing && !isDone(i)).length;
  const st = data.mail;
  const stats = [
    missing && `<div class="stat hot"><b>${missing}</b><span>missing</span></div>`,
    `<div class="stat${dueToday ? ' hot' : ''}"><b>${dueToday}</b><span>due today</span></div>`,
    `<div class="stat"><b>${week}</b><span>due this week</span></div>`,
    st?.configured && st.unreadCount != null && `<div class="stat"><b>${st.unreadCount}</b><span>unread</span></div>`,
  ];
  $('stats').innerHTML = stats.filter(Boolean).join('');
}

function renderHero(now) {
  const hero = $('hero');
  const events = data.items.filter(timed);
  const current = events.find((e) => e.startD <= now && e.endD && e.endD > now);
  // the upcoming stream: events by start time, assignments by due time
  const stream = [
    ...events.filter((e) => e.startD > now).map((e) => ({ it: e, at: e.startD, type: 'event' })),
    ...assignments().filter((a) => !isDone(a) && !a.missing && a.dueD > now).map((a) => ({ it: a, at: a.dueD, type: 'due' })),
  ].sort((x, y) => x.at - y.at);

  const pick = current ? { it: current, at: current.endD, type: 'now' } : stream[0];
  if (!pick) {
    hero.style.removeProperty('--c');
    hero.innerHTML = `<div class="eyebrow">All clear</div><div class="title">Nothing coming up</div><div class="meta">No events or deadlines in the next two weeks.</div>`;
    return;
  }
  const { it, at, type } = pick;
  hero.style.setProperty('--c', it.color);
  const label = type === 'now' ? '<span class="live"></span>Happening now' : type === 'due' ? 'Next due' : 'Up next';
  const when = type === 'due'
    ? `${fmtDay(at)} at ${fmtTime(at)}`
    : `${fmtDay(it.startD)}, ${fmtTime(it.startD)}${it.endD ? `–${fmtTime(it.endD)}` : ''}`;
  const ms = at - now;
  const big = type === 'now'
    ? `${until(ms)}<small>left</small>`
    : ms < 864e5 ? `${until(ms)}<small>${type === 'due' ? 'left' : 'until it starts'}</small>` : `${fmtDay(at)}<small>${fmtTime(at)}</small>`;
  const bar = type === 'now' ? `<div class="bar"><i style="width:${Math.min(100, ((now - it.startD) / (it.endD - it.startD)) * 100)}%"></i></div>` : '';
  const after = stream.find((s) => s.it !== it);
  const titleHtml = it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title);
  hero.innerHTML = `
    <div class="eyebrow">${label}${it.course ? ` · ${esc(it.course)}` : ''}</div>
    <div class="title">${titleHtml}</div>
    <div class="meta">${esc(when)}${it.location ? ` · ${esc(it.location)}` : ''}</div>
    <div class="big">${big}</div>${bar}
    ${after ? `<div class="then">Then <b>${esc(after.it.title)}</b> · ${fmtDay(after.at)} ${fmtTime(after.at)}</div>` : ''}`;
}

function renderSchedule(now) {
  const groups = [];
  let total = 0;
  for (let d = 0; d < SCHEDULE_DAYS; d++) {
    const day = dayStart(now, d);
    const items = data.items.filter((i) => isEvent(i) && onDay(i, day));
    total += items.length;
    if (!items.length && d > 0) continue;
    const body = items.length ? items.map((it) => {
      let right, cls = '';
      if (it.allDay) right = 'All day';
      else {
        right = fmtTime(it.startD);
        if (it.endD && it.endD < now) cls = 'past';
        else if (it.startD <= now && it.endD > now) { cls = 'now'; right = 'Now'; }
      }
      return row(it, { meta: metaLine(it.location, it.course || SOURCES[it.source]), right, cls });
    }).join('') : '<div class="empty">Nothing else on today.</div>';
    groups.push(group(d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : longDay(day), body, { cls: d === 0 ? 'today' : '' }));
  }
  $('sched-sub').textContent = total ? `${total} this week` : '';
  $('schedule').innerHTML = total ? groups.join('') : '<div class="empty">No classes or meetings on your calendars this week. Add your Google Calendar link in <code>.env</code> to see them here.</div>';
}

function renderDue(now) {
  const all = assignments();
  const missing = all.filter((i) => i.missing && !isDone(i)).sort((a, b) => a.dueD - b.dueD);
  const upcoming = all.filter((i) => !i.missing && i.dueD >= dayStart(now) && i.dueD < dayStart(now, DUE_DAYS));
  const byDay = new Map();
  for (const it of upcoming.sort((a, b) => a.dueD - b.dueD)) {
    const key = dayStart(it.dueD).getTime();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(it);
  }

  const dueRow = (it) => {
    const ms = it.dueD - now;
    const done = isDone(it);
    let tag = '', cls = 'checkable';
    if (done) { cls += ' done'; if (it.submitted) tag = '<span class="tag green">Submitted</span>'; }
    else if (it.missing) tag = '<span class="tag red">Missing</span>';
    else if (ms < 0) cls += ' past';
    else if (ms < 864e5) tag = `<span class="tag ${ms < 6 * 3600e3 ? 'red' : 'amber'}">${until(ms)}</span>`;
    const right = `${it.missing ? fmtDay(it.dueD) : fmtTime(it.dueD)}${tag}`;
    const lead = `<span class="check${done ? ' on' : ''}${it.submitted ? ' locked' : ''}" role="checkbox" tabindex="0"
      aria-checked="${done}" aria-label="Mark ${esc(it.title)} done" data-done-id="${esc(it.id)}" title="${it.submitted ? 'Submitted on Canvas' : done ? 'Mark not done' : 'Mark done'}">
      <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    return row(it, { meta: metaLine(it.course, it.points ? `${it.points} pts` : ''), right, cls, lead });
  };
  const left = (items) => { const n = items.filter((i) => !isDone(i)).length; return n === items.length ? n : `${n} left`; };

  let html = '';
  if (missing.length) html += group('Missing', missing.map(dueRow).join(''), { cls: 'late', count: missing.length });
  for (const [key, items] of byDay) {
    const day = new Date(key);
    const label = sameDay(day, now) ? 'Today' : sameDay(day, dayStart(now, 1)) ? 'Tomorrow' : longDay(day);
    html += group(label, items.map(dueRow).join(''), { cls: sameDay(day, now) ? 'today' : '', count: left(items) });
  }
  const open = upcoming.filter((i) => i.dueD > now && !isDone(i)).length;
  $('due-sub').textContent = open ? `${open} to do in the next ${DUE_DAYS} days` : '';
  $('due').innerHTML = html || '<div class="empty">Nothing due in the next two weeks.</div>';
}

// ---------- sports ----------
let sportTab = store.get('ea.sportTab', 'all');

function teamLine(t, g) {
  const showScore = g.state !== 'pre' && t.score != null;
  return `<div class="team${g.state === 'post' && t.winner ? ' win' : ''}">
    ${t.logo ? `<img src="${esc(t.logo)}" alt="" width="22" height="22" loading="lazy">` : '<span class="nologo"></span>'}
    <span class="nm">${esc(t.name || t.abbr || 'TBD')}</span>
    ${t.record ? `<span class="rec">${esc(t.record)}</span>` : ''}
    ${showScore ? `<span class="sc">${esc(t.score)}</span>` : ''}
  </div>`;
}

function watchHtml(w) {
  const chips = w.national.map((n) => `<span class="net">${esc(n)}</span>`).join('');
  const apps = w.apps.length ? `<div class="apps">Stream: ${w.apps.map(esc).join(' · ')}</div>` : '';
  const regional = w.regional ? '<div class="loc">Regional: only shown in some areas</div>' : '';
  const local = w.local.length ? `<div class="loc">Local: ${w.local.map(esc).join(', ')}</div>` : '';
  return `${chips ? `<div class="nets">${chips}</div>` : ''}${apps}${regional}${local}` || '<div class="loc">TV not announced yet</div>';
}

function renderSports(now) {
  const sp = data.sports;
  const tabs = [...sp.leagues.map((l) => [l.id, l.label]), ...(sp.myTeams.length ? [['mine', 'My teams']] : [])];
  if (sportTab !== 'all' && !tabs.some(([id]) => id === sportTab)) sportTab = 'all';
  $('sport-tabs').innerHTML = (tabs.length > 1 || sp.myTeams.length ? [['all', 'All'], ...tabs] : [])
    .map(([id, label]) => `<button data-sport="${id}" class="${id === sportTab ? 'on' : ''}">${esc(label)}</button>`).join('');

  const games = sp.games.filter((g) => sportTab === 'all' || (sportTab === 'mine' ? g.mine : g.league === sportTab));
  const live = games.filter((g) => g.state === 'in').length;
  $('games-sub').textContent = `${games.length} games${live ? ` · ${live} live now` : ''}`;
  const byDay = new Map();
  for (const g of games) {
    const d = new Date(g.start);
    const key = dayStart(d).getTime();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({ ...g, startD: d });
  }
  let html = '';
  for (const [key, list] of byDay) {
    const day = new Date(key);
    const label = sameDay(day, now) ? 'Today' : sameDay(day, dayStart(now, 1)) ? 'Tomorrow' : longDay(day);
    html += group(label, list.map((g) => {
      const when = g.state === 'in' ? `<span class="livetag"><i></i>${esc(g.detail || 'Live')}</span>`
        : g.state === 'post' ? `<span class="final">${esc(g.detail || 'Final')}</span>`
        : `<b>${fmtTime(g.startD)}</b>`;
      const open = g.url ? `<a class="game${g.state === 'in' ? ' live' : ''}${g.mine ? ' mine' : ''}" href="${esc(g.url)}" target="_blank" rel="noopener">` : `<div class="game">`;
      return `${open}
        <div class="gtime">${when}<span class="lg">${esc(g.leagueLabel)}${g.mine ? ' ★' : ''}</span></div>
        <div class="matchup">${teamLine(g.away, g)}${teamLine(g.home, g)}</div>
        <div class="watch">${g.state === 'post' ? '' : watchHtml(g.watch)}</div>
      ${g.url ? '</a>' : '</div>'}`;
    }).join(''), { cls: sameDay(day, now) ? 'today' : '', count: list.length });
  }
  $('games').innerHTML = html || `<div class="empty">${sp.leagues.length ? 'No games in the next week.' : 'Sports didn\'t load.'}</div>`;

  const news = sp.news.filter((n) => sportTab === 'all' || sportTab === 'mine' || n.league === sportTab);
  $('news').innerHTML = news.length ? news.map((n) => `
    <a class="story" href="${esc(n.url)}" target="_blank" rel="noopener">
      ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" width="104" height="69">` : '<span class="noimg"></span>'}
      <div>
        <div class="t">${esc(n.title)}${n.isNew ? '<span class="tag new">NEW</span>' : ''}</div>
        ${n.preview ? `<div class="p">${esc(n.preview)}</div>` : ''}
        <div class="m">${esc(n.leagueLabel)} · ${n.startD ? ago(n.startD, now) : ''}</div>
      </div>
    </a>`).join('') : '<div class="empty">No headlines right now.</div>';
}

$('sport-tabs').onclick = (e) => {
  const t = e.target.dataset?.sport;
  if (!t) return;
  sportTab = t; store.set('ea.sportTab', t); render();
};

// ---------- YouTube ----------
let ytTopic = store.get('ea.ytTopic', 'all');
const fmtViews = (n) => !n ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M views` : n >= 1e3 ? `${Math.round(n / 1e3)}K views` : `${n} views`;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

const LATER = 'later'; // the Watch Later tab
const laterIcon = (on) => on
  ? '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  : '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/></svg>';

function videoRow(v, now, saved) {
  const when = v.startD ? ago(v.startD, now) : '';
  const btn = `<button class="later${saved ? ' on' : ''}" data-later="${esc(v.id)}"
    title="${saved ? 'Remove from Watch later' : 'Save to Watch later'}" aria-pressed="${saved}"
    aria-label="${saved ? 'Remove' : 'Save'} ${esc(v.title)} ${saved ? 'from' : 'to'} Watch later">${laterIcon(saved)}<span>${saved ? 'Saved' : 'Later'}</span></button>`;
  return `
    <a class="vid" href="${esc(v.url)}" target="_blank" rel="noopener">
      <img src="${esc(v.thumb)}" alt="" loading="lazy" width="112" height="63">
      <div class="vmain">
        <div class="t">${esc(v.title)}${v.isNew ? '<span class="tag new">NEW</span>' : ''}</div>
        <div class="m">${esc(v.channel)}${when ? ` · ${when}` : ''}${v.views ? ` · ${fmtViews(v.views)}` : ''}</div>
      </div>
      ${btn}
    </a>`;
}

function renderVideos(now) {
  const vids = data.videos || [];
  const later = data.state?.watchLater || {};
  const laterList = Object.entries(later)
    .map(([id, v]) => ({ ...v, id, startD: parseDate(v.posted) }))
    .sort((a, b) => b.savedAt - a.savedAt);
  const topics = [...new Set(vids.map((v) => v.topic))];
  if (![ 'all', LATER, ...topics ].includes(ytTopic)) ytTopic = 'all';
  const tabs = [...(topics.length > 1 ? ['all', ...topics] : ['all']), LATER];
  $('yt-tabs').innerHTML = tabs.map((t) => `<button data-topic="${esc(t)}" class="${t === ytTopic ? 'on' : ''}">${
    t === LATER ? `Watch later${laterList.length ? ` <b>${laterList.length}</b>` : ''}` : esc(cap(t))}</button>`).join('');

  if (ytTopic === LATER) {
    $('yt-sub').textContent = '';
    $('videos').innerHTML = laterList.length
      ? laterList.map((v) => videoRow(v, now, true)).join('')
      : '<div class="empty">Nothing saved yet. Hit <b>Later</b> on any video to keep it here until you\'re in the mood.</div>';
    return;
  }
  // saved videos live only in the Watch later tab
  const shown = vids.filter((v) => !later[v.id] && (ytTopic === 'all' || v.topic === ytTopic));
  $('yt-sub').textContent = shown.length ? `${shown.length} latest` : '';
  if (data.sources.youtube && !data.sources.youtube.ok && !vids.length) {
    $('videos').innerHTML = `<div class="empty">Couldn't load YouTube: ${esc(data.sources.youtube.error)}</div>`;
    return;
  }
  $('videos').innerHTML = shown.length ? shown.map((v) => videoRow(v, now, false)).join('')
    : `<div class="empty">${vids.length ? 'You\'ve saved everything here to Watch later.' : 'No videos yet.'}</div>`;
}

function toggleLater(id) {
  const later = data.state.watchLater;
  const was = later[id];
  const video = was ? { id } : (data.videos || []).find((v) => v.id === id);
  if (!video) return;
  if (was) delete later[id];
  else later[id] = { title: video.title, channel: video.channel, topic: video.topic, posted: video.posted, thumb: video.thumb, url: video.url, savedAt: Date.now() };
  saveState(
    { type: 'watchlater', saved: !was, video: { id, title: video.title, channel: video.channel, topic: video.topic, posted: video.posted } },
    () => { if (was) later[id] = was; else delete later[id]; },
  );
}

$('videos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-later]');
  if (!b) return;
  e.preventDefault(); // don't open the video
  e.stopPropagation();
  toggleLater(b.dataset.later);
});

$('yt-tabs').onclick = (e) => {
  const t = e.target.dataset?.topic;
  if (!t) return;
  ytTopic = t; store.set('ea.ytTopic', t); render();
};

// ---------- inbox (school mail forwarded to Gmail) ----------
let inboxView = store.get('ea.inboxView', 'focused');

function renderInbox(now) {
  const box = $('inbox');
  const st = data.mail || { configured: false };
  const tabs = $('inbox-tabs');
  tabs.hidden = !st.configured;
  $('inbox-sub').textContent = st.configured && st.unreadCount ? `${st.unreadCount} unread` : '';

  if (!st.configured) {
    box.innerHTML = `<div class="connect"><p>Forward your school or work email to Gmail and it shows up here.</p><p>Follow the <b>Email</b> steps in <code>SETUP.md</code>.</p></div>`;
    return;
  }
  if (data.sources.gmail && !data.sources.gmail.ok) {
    box.innerHTML = `<div class="connect"><p class="err">${esc(data.sources.gmail.error)}</p></div>`;
    return;
  }

  for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === inboxView);
  const mails = data.emails
    .filter((m) => inboxView === 'all' || m.focused || m.flagged || m.important)
    .sort((a, b) => b.startD - a.startD);
  const rows = mails.map((m) => {
    const tags = (m.flagged ? '<span class="tag amber">Starred</span>' : '') + (m.important ? '<span class="tag red">Important</span>' : '');
    const open = m.url ? `<a class="row mail${m.unread ? '' : ' read'}" href="${esc(m.url)}" target="_blank" rel="noopener"` : `<div class="row mail${m.unread ? '' : ' read'}"`;
    return `${open} style="--c:var(--gmail)"><span class="dot"></span><div>
      <div class="from">${esc(m.from)}${m.isNew ? '<span class="tag new">NEW</span>' : ''}</div>
      <div class="t">${esc(m.title)}</div>
      <div class="p">${esc(m.preview)}</div></div>
      <div class="w">${ago(m.startD, now)}${tags}</div>${m.url ? '</a>' : '</div>'}`;
  }).join('');
  box.innerHTML = `${rows || `<div class="empty">No ${inboxView === 'focused' ? 'Focused ' : ''}email from the last 3 days.</div>`}
    <div class="foot"><span>via ${esc(st.account || 'Gmail')}</span></div>`;
}

$('inbox-tabs').onclick = (e) => {
  const v = e.target.dataset?.view;
  if (!v) return;
  inboxView = v; store.set('ea.inboxView', v); render();
};

// ---------- saving things you click (checked-off assignments, gym log) ----------
async function saveState(change, undo) {
  render();
  try {
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EasyAccess': '1' },
      body: JSON.stringify(change),
    });
    if (!res.ok) throw new Error(`server said ${res.status}`);
    data.state = await res.json();
  } catch (err) {
    undo();
    const b = $('banner');
    b.hidden = false;
    b.innerHTML = `Couldn't save that (${esc(err.message)}). Is the dashboard still running?`;
  }
  render();
}

function toggleDone(id) {
  const done = data.state.done;
  const was = done[id];
  if (was) delete done[id]; else done[id] = Date.now();
  saveState({ type: 'assignment', id, done: !was }, () => { if (was) done[id] = was; else delete done[id]; });
}

function onCheck(e) {
  const c = e.target.closest('[data-done-id]');
  if (!c) return;
  if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
  e.preventDefault(); // don't open the assignment link
  e.stopPropagation();
  if (!c.classList.contains('locked')) toggleDone(c.dataset.doneId);
}
$('due').addEventListener('click', onCheck);
$('due').addEventListener('keydown', onCheck);

// ---------- gym ----------
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const planFor = (d) => routine()[d.getDay()];

// A day "counts" if it's a rest day or the workout was logged. Today only counts once it's done
// (an unfinished workout today doesn't break the streak until the day is over).
function gymStreaks(now) {
  const log = data.state.gym.log;
  const start = parseDate(data.state.gym.startedAt) || dayStart(now);
  const kept = (d) => planFor(d) === 'Rest' || log[dateKey(d)];
  let current = 0;
  let d = dayStart(now);
  if (kept(d)) current++;
  for (d = dayStart(now, -1); d >= start && kept(d); d = dayStart(d, -1)) current++;
  let best = current, run = 0;
  for (d = new Date(start); d < dayStart(now); d = dayStart(d, 1)) {
    run = kept(d) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best };
}

function renderGym(now) {
  const log = data.state.gym.log;
  const today = dayStart(now);
  const todayKey = dateKey(today);
  const plan = planFor(today);
  const { current, best } = gymStreaks(now);
  $('gym-sub').textContent = plan === 'Rest' ? 'Rest day' : `${plan} day`;
  $('gym-streak').innerHTML = `<b>${current}</b> day streak${best > current ? ` <span>· best ${best}</span>` : ''}`;
  $('gym-streak').classList.toggle('hot', current > 0);

  const sunday = dayStart(today, -today.getDay());
  const letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  $('gym-week').innerHTML = routine().map((p, i) => {
    const d = dayStart(sunday, i);
    const key = dateKey(d);
    const isToday = key === todayKey;
    const future = d > today;
    const done = Boolean(log[key]);
    const beforeStart = key < data.state.gym.startedAt; // not tracking yet, so not "missed"
    const state = p === 'Rest' ? 'rest' : done ? 'done' : future || beforeStart ? 'future' : isToday ? 'open' : 'missed';
    const clickable = p !== 'Rest' && !future;
    const label = `${d.toLocaleDateString([], { weekday: 'long' })}: ${p}${p === 'Rest' ? '' : done ? ', done' : future ? '' : isToday ? ', not done yet' : ', missed'}`;
    return `<${clickable ? 'button' : 'div'} class="gday ${state}${isToday ? ' today' : ''}" ${clickable ? `data-gym-date="${key}"` : ''} title="${esc(label)}${clickable ? ' (click to toggle)' : ''}" aria-label="${esc(label)}">
      <span class="gl">${letters[i]}</span><span class="gp">${p === 'Rest' ? '–' : p}</span></${clickable ? 'button' : 'div'}>`;
  }).join('');

  const btn = $('gym-btn');
  if (plan === 'Rest') {
    btn.className = 'gym-btn rest'; btn.disabled = true; btn.textContent = 'Rest day. Recover.';
  } else if (log[todayKey]) {
    btn.className = 'gym-btn did'; btn.disabled = false; btn.innerHTML = `${plan} day done <span>· undo</span>`;
  } else {
    btn.className = 'gym-btn'; btn.disabled = false; btn.textContent = `Mark ${plan} day done`;
  }
}

function toggleGym(key) {
  const log = data.state.gym.log;
  const was = Boolean(log[key]);
  if (was) delete log[key]; else log[key] = true;
  saveState({ type: 'gym', date: key, done: !was }, () => { if (was) log[key] = true; else delete log[key]; });
}
$('gym-btn').onclick = () => toggleGym(dateKey(new Date()));
$('gym-week').onclick = (e) => {
  const b = e.target.closest('[data-gym-date]');
  if (b) toggleGym(b.dataset.gymDate);
};

// ---------- alerts ----------
const alertsOn = () => 'Notification' in window && Notification.permission === 'granted' && store.get('ea.alerts', false);

function updateNotifyButton() {
  const btn = $('notify');
  if (!('Notification' in window)) { btn.hidden = true; return; }
  btn.classList.toggle('on', alertsOn());
  btn.textContent = alertsOn() ? 'Alerts on' : 'Alerts off';
}

$('notify').onclick = async () => {
  if (alertsOn()) store.set('ea.alerts', false);
  else {
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    store.set('ea.alerts', p === 'granted');
  }
  updateNotifyButton();
};

function notify(title, body, url) {
  if (!alertsOn()) return;
  // data.url lets the Mac app open the link when the notification is clicked
  const n = new Notification(title, { body, tag: title + body, data: { url } });
  if (url) n.onclick = () => window.open(url, '_blank');
}

function checkAlerts(now) {
  for (const it of data.items) {
    if (!timed(it)) continue;
    const ms = it.startD - now;
    if (ms > 0 && ms <= ALERT_MINUTES * 60000 && !alerted.has(it.id)) {
      alerted.add(it.id);
      notify(`${it.title} in ${until(ms)}`, [fmtTime(it.startD), it.location].filter(Boolean).join(' · '), it.url);
    }
  }
}

function notifyNew(all) {
  // no pings for videos or promo / "Other" email
  const items = all.filter((i) => i.kind !== 'video' && i.kind !== 'news' && (i.kind !== 'email' || i.focused || i.important || i.flagged));
  if (!items.length) return;
  if (items.length === 1 && items[0].kind === 'email') {
    const m = items[0];
    return notify(`✉ ${m.from}`, `${m.title}\n${m.preview}`, m.url);
  }
  if (items.length > 3) return notify(`${items.length} new items`, items.slice(0, 3).map((i) => i.title).join(', ') + '…');
  for (const it of items) {
    const what = it.kind === 'announcement' ? 'New announcement' : it.kind === 'assignment' ? 'New assignment' : it.kind === 'email' ? `Email from ${it.from}` : `New on ${SOURCES[it.source]}`;
    notify(`${what}: ${it.title}`, it.course || '', it.url);
  }
}

// ---------- loading splash ----------
// let the EASY ACCESS reveal finish (~1.8 s) even if data arrives sooner, then fade it out
function hideSplash() {
  const s = $('splash');
  if (!s || s.classList.contains('gone')) return;
  setTimeout(() => {
    s.classList.add('gone');
    setTimeout(() => s.remove(), 700);
  }, Math.max(0, 1800 - performance.now()));
}
setTimeout(hideSplash, 15000); // never trap you behind it if something hangs

// ---------- loop ----------
let inFlight = null;
async function load(force = false) {
  // a load is already running (e.g. the forced one at startup): don't start a second, staler one
  if (inFlight && !force) return inFlight;
  inFlight = doLoad(force).finally(() => { inFlight = null; });
  return inFlight;
}

async function doLoad(force) {
  const btn = $('refresh');
  btn.classList.add('spin');
  try {
    const res = await fetch(`/api/dashboard${force ? '?refresh' : ''}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    data = prepare(await res.json());
    lastFetch = Date.now();
    render();
  } catch (err) {
    const b = $('banner');
    b.hidden = false;
    b.innerHTML = `Can't reach the dashboard server (${esc(err.message)}). Start it with <code>npm start</code>.`;
  } finally {
    hideSplash();
    btn.classList.remove('spin');
  }
}

$('refresh').onclick = () => load(true);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastFetch > 60000) load();
});
setInterval(() => (Date.now() - lastFetch >= FETCH_EVERY ? load() : render()), TICK_EVERY);
updateNotifyButton();
load(true); // every open/reload gets fresh data, including new YouTube uploads
