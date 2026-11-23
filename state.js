// Things you set on the dashboard itself: assignments you've checked off and your gym log.
// Saved to data/state.json so it survives restarts and works from any browser on this Mac.
import fs from 'node:fs/promises';
import path from 'node:path';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_DONE_DAYS = 120;
const MAX_WATCH_LATER = 300;
const YT_ID = /^yt:[\w-]{6,20}$/;
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export function createState(file) {
  let state = null;
  let writing = Promise.resolve();

  async function get() {
    if (state) return state;
    try { state = JSON.parse(await fs.readFile(file, 'utf8')); } catch { state = {}; }
    state.done ||= {};                 // { assignmentId: checkedAtMs }
    state.gym ||= {};
    state.gym.log ||= {};              // { 'YYYY-MM-DD': true }
    state.watchLater ||= {};           // { 'yt:<videoId>': { title, channel, thumb, url, posted, topic, savedAt } }
    if (!state.gym.startedAt) {        // streaks never count days before you started tracking
      state.gym.startedAt = today();
      await save();
    }
    return state;
  }

  function save() {
    const snapshot = JSON.stringify(state, null, 2);
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, snapshot);
      await fs.rename(`${file}.tmp`, file); // atomic: never leaves a half-written file
    });
    return writing;
  }

  async function update(body) {
    const s = await get();
    if (body?.type === 'assignment' && typeof body.id === 'string' && body.id.length < 500) {
      if (body.done) s.done[body.id] = Date.now();
      else delete s.done[body.id];
      const cutoff = Date.now() - KEEP_DONE_DAYS * 864e5;
      for (const [id, t] of Object.entries(s.done)) if (t < cutoff) delete s.done[id];
    } else if (body?.type === 'gym' && DATE.test(body.date || '') && body.date <= today()) {
      if (body.done) s.gym.log[body.date] = true;
      else delete s.gym.log[body.date];
      if (body.date < s.gym.startedAt) s.gym.startedAt = body.date;
    } else if (body?.type === 'watchlater' && YT_ID.test(body.video?.id || '')) {
      const v = body.video;
      if (body.saved) {
        // keep a copy of the video's details: the feed only lists each channel's newest few
        const videoId = v.id.slice(3);
        s.watchLater[v.id] = {
          title: str(v.title), channel: str(v.channel, 100), topic: str(v.topic, 40), posted: str(v.posted, 40),
          thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          savedAt: Date.now(),
        };
        const ids = Object.keys(s.watchLater);
        if (ids.length > MAX_WATCH_LATER) {
          ids.sort((a, b) => s.watchLater[a].savedAt - s.watchLater[b].savedAt)
            .slice(0, ids.length - MAX_WATCH_LATER).forEach((id) => delete s.watchLater[id]);
        }
      } else {
        delete s.watchLater[v.id];
      }
    } else {
      throw Object.assign(new Error('bad request'), { status: 400 });
    }
    await save();
    return s;
  }

  return { get, update };
}
