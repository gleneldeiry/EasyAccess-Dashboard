// Latest videos from a set of YouTube channels, via each channel's public RSS feed
// (no account or API key needed). Shorts are skipped.
//
// Add your own channels in .env:  YOUTUBE_CHANNELS=fitness:@SomeLifter,tech:@SomeCoder,@AnyChannel
// (topic is optional; it becomes a tab in the panel). YOUTUBE_DEFAULTS=off drops the built-in picks.

const DEFAULT_CHANNELS = [
  // fitness — evidence-based lifting, fits a push/pull/legs routine
  { topic: 'fitness', id: 'UC68TLK0mAEzUyHx5x5k-S1Q', name: 'Jeff Nippard' },
  { topic: 'fitness', id: 'UCERm5yFZ1SptUEU4wZ2vJvw', name: 'Jeremy Ethier' },
  { topic: 'fitness', id: 'UCfQgsKhHjSyRLOp9mnffqVg', name: 'Renaissance Periodization' },
  { topic: 'fitness', id: 'UCB2wtYpfbCpYDc5TeTwuqFA', name: 'Will Tennyson' },
  { topic: 'fitness', id: 'UCe0TLA0EsQbE-MjuHXevj2A', name: 'ATHLEAN-X' },
  { topic: 'fitness', id: 'UCKf0UqBiCQI4Ol0To9V0pKQ', name: 'Buff Dudes' },
  // tech — programming, CS, math and gadgets
  { topic: 'tech', id: 'UCsBjURrPoezykLs9EqgamOA', name: 'Fireship' },
  { topic: 'tech', id: 'UC9-y-6csu5WGm29I7JiwpnA', name: 'Computerphile' },
  { topic: 'tech', id: 'UCYO_jab_esuFRV4b17AJtAw', name: '3Blue1Brown' },
  { topic: 'tech', id: 'UCBJycsmduvYEL83R_U4JriQ', name: 'Marques Brownlee' },
  { topic: 'tech', id: 'UC9x0AN7BWHpCDHSm9NiJFJQ', name: 'NetworkChuck' },
];

const CACHE_MS = 20 * 60 * 1000; // channels post a few times a week at most
const PER_CHANNEL = 4; // so channels that post daily don't drown out the rest
const MAX_VIDEOS = 60;
const UA = { 'User-Agent': 'Mozilla/5.0 (EasyAccess dashboard)', 'Accept-Language': 'en-US' };

const unxml = (s = '') => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (xml, name) => unxml((xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`)) || [])[1] || '').trim();

function parseEnv(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const m = entry.match(/^(?:([\w-]+):)?(@[\w.-]+|UC[\w-]{22})$/);
    if (!m) return null;
    return { topic: (m[1] || 'mine').toLowerCase(), handle: m[2].startsWith('@') ? m[2] : undefined, id: m[2].startsWith('UC') ? m[2] : undefined };
  }).filter(Boolean);
}

export function createYouTube({ channels: envChannels, defaults = true }) {
  const channels = [...(defaults ? DEFAULT_CHANNELS : []), ...parseEnv(envChannels)];
  const handleIds = new Map(); // @handle → channel id, looked up once
  let cache = null;

  async function resolve(ch) {
    if (ch.id) return ch.id;
    if (handleIds.has(ch.handle)) return handleIds.get(ch.handle);
    const res = await fetch(`https://www.youtube.com/${ch.handle}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    const id = ((await res.text()).match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || [])[1];
    if (!id) throw new Error(`couldn't find YouTube channel ${ch.handle}`);
    handleIds.set(ch.handle, id);
    return id;
  }

  async function channelVideos(ch) {
    const id = await resolve(ch);
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`YouTube feed HTTP ${res.status}`);
    const xml = await res.text();
    const channelName = ch.name || tag(xml.split('<entry>')[0], 'title');
    return xml.split('<entry>').slice(1).map((e) => {
      const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || '';
      if (link.includes('/shorts/')) return null;
      const videoId = tag(e, 'yt:videoId');
      return {
        id: `yt:${videoId}`,
        source: 'youtube',
        kind: 'video',
        topic: ch.topic,
        title: tag(e, 'title'),
        channel: channelName,
        posted: tag(e, 'published'),
        views: Number((e.match(/<media:statistics views="(\d+)"/) || [])[1]) || undefined,
        thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        url: link || `https://www.youtube.com/watch?v=${videoId}`,
      };
    }).filter(Boolean).slice(0, PER_CHANNEL);
  }

  // force: skip the cache (the app asks for this on every open, reload and refresh)
  async function fetchVideos(force = false) {
    if (!force && cache && Date.now() - cache.t < CACHE_MS) return cache.videos;
    const results = await Promise.allSettled(channels.map(channelVideos));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === results.length && results.length) throw failed[0].reason;
    for (const f of failed) console.error('[youtube]', f.reason.message);
    const videos = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .sort((a, b) => b.posted.localeCompare(a.posted))
      .slice(0, MAX_VIDEOS);
    cache = { t: Date.now(), videos };
    return videos;
  }

  return { fetchVideos };
}
