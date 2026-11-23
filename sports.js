// NBA / NFL games for the next week (with where to watch) and latest headlines,
// from ESPN's public site API. No account or key needed.
//
// .env:  SPORTS_LEAGUES=nba,nfl      (also: wnba, mlb, nhl)
//        SPORTS_TEAMS=ORL,MIA,JAX    (team abbreviations to highlight; adds a "My teams" filter)

const LEAGUES = {
  nba: { path: 'basketball/nba', label: 'NBA' },
  nfl: { path: 'football/nfl', label: 'NFL' },
  wnba: { path: 'basketball/wnba', label: 'WNBA' },
  mlb: { path: 'baseball/mlb', label: 'MLB' },
  nhl: { path: 'hockey/nhl', label: 'NHL' },
};
const API = 'https://site.api.espn.com/apis/site/v2/sports';
const DAYS = 8; // today + the next 7

// National networks → the streaming app that carries them
const STREAM = {
  ESPN: 'ESPN app', ESPN2: 'ESPN app', ABC: 'ESPN app', ESPNU: 'ESPN app',
  CBS: 'Paramount+', NBC: 'Peacock', FOX: 'FOX One', FS1: 'FOX One',
  TNT: 'HBO Max', TRUTV: 'HBO Max', TBS: 'HBO Max',
  'NFL NETWORK': 'NFL+', NFLN: 'NFL+', 'NBA TV': 'NBA League Pass',
};
const STREAMING_SERVICES = /prime video|peacock|netflix|youtube|paramount|espn\+|apple tv/i;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

export function createSports({ leagues, teams }) {
  const active = (leagues || 'nba,nfl').split(',').map((s) => s.trim().toLowerCase()).filter((l) => LEAGUES[l]);
  const myTeams = (teams || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const cache = new Map(); // url → { t, ttl, data }

  async function get(url, ttl) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < hit.ttl) return hit.data;
    const res = await fetch(url, { headers: { 'User-Agent': 'EasyAccess-Dashboard' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
    const data = await res.json();
    cache.set(url, { t: Date.now(), ttl, data });
    return data;
  }

  function watch(comp, league) {
    const geo = (comp.geoBroadcasts || []).filter((g) => g.type?.shortName !== 'Radio');
    const national = [...new Set(geo.filter((g) => g.market?.type === 'National').map((g) => g.media?.shortName).filter(Boolean))];
    const local = [...new Set(geo.filter((g) => g.market?.type !== 'National').map((g) => g.media?.shortName).filter(Boolean))];
    // streaming services (Prime Video, Peacock…) are already the app; TV networks map to theirs
    const apps = [...new Set(national.filter((n) => !STREAMING_SERVICES.test(n)).map((n) => STREAM[n.toUpperCase()]).filter(Boolean))];
    // nothing national: out-of-market fans watch on the league's own package
    if (!national.length && league === 'nba') apps.push('NBA League Pass');
    if (!national.length && league === 'nhl') apps.push('ESPN+');
    if (!national.length && league === 'mlb') apps.push('MLB.TV');
    return { national, local, apps };
  }

  function toGame(e, league) {
    const comp = e.competitions?.[0] || {};
    const side = (ha) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === ha) || {};
      const t = c.team || {};
      return {
        abbr: t.abbreviation, name: t.shortDisplayName || t.displayName, logo: t.logo,
        score: c.score, record: c.records?.find((r) => r.type === 'total')?.summary,
        winner: c.winner || undefined,
      };
    };
    const away = side('away');
    const home = side('home');
    const st = e.status?.type || {};
    return {
      id: `sport:${league}:${e.id}`,
      league,
      leagueLabel: LEAGUES[league].label,
      start: e.date,
      state: st.state, // pre | in | post
      detail: st.shortDetail,
      away, home,
      mine: myTeams.includes(away.abbr) || myTeams.includes(home.abbr) || undefined,
      watch: watch(comp, league),
      url: e.links?.[0]?.href,
    };
  }

  async function games(league) {
    const today = new Date();
    const days = Array.from({ length: DAYS }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() + i); return ymd(d); });
    const results = await Promise.all(days.map((day, i) =>
      // today's games change minute to minute (live scores); later days barely change
      get(`${API}/${LEAGUES[league].path}/scoreboard?dates=${day}`, i === 0 ? 90e3 : 30 * 60e3)
        .then((d) => d.events || [])
        .catch(() => [])));
    return results.flat().map((e) => toGame(e, league));
  }

  async function news(league) {
    const d = await get(`${API}/${LEAGUES[league].path}/news?limit=15`, 15 * 60e3);
    return (d.articles || []).filter((a) => a.links?.web?.href).map((a) => ({
      id: `news:${league}:${a.id || a.links.web.href}`,
      kind: 'news',
      league,
      leagueLabel: LEAGUES[league].label,
      title: a.headline,
      preview: a.description,
      posted: a.published,
      image: (a.images || []).find((i) => i.url)?.url,
      url: a.links.web.href,
    }));
  }

  async function fetchSports() {
    const [g, n] = await Promise.all([
      Promise.allSettled(active.map(games)),
      Promise.allSettled(active.map(news)),
    ]);
    const all = [...g, ...n];
    if (all.length && all.every((r) => r.status === 'rejected')) throw all[0].reason;
    const seen = new Set();
    const gameList = g.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    // NFL Sunday afternoons: when one network carries several games in the same slot, each
    // only airs in some regions (out of market → NFL Sunday Ticket)
    const slots = new Map();
    for (const x of gameList) for (const n of x.watch.national) {
      const key = `${x.league}|${x.start}|${n}`;
      slots.set(key, (slots.get(key) || 0) + 1);
    }
    for (const x of gameList) {
      if (x.league === 'nfl' && x.watch.national.some((n) => slots.get(`${x.league}|${x.start}|${n}`) > 1)) {
        x.watch.regional = true;
        x.watch.apps.push('NFL Sunday Ticket');
      }
    }
    return {
      leagues: active.map((l) => ({ id: l, label: LEAGUES[l].label })),
      myTeams,
      games: gameList
        .filter((x) => !seen.has(x.id) && seen.add(x.id))
        .sort((a, b) => a.start.localeCompare(b.start)),
      news: n.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        .sort((a, b) => String(b.posted).localeCompare(String(a.posted)))
        .slice(0, 30),
    };
  }

  return { fetchSports };
}
