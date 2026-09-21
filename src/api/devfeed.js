// ---- GET /api/devfeed — the dev page's commit grid + activity log ----
//
// Feeds `/dev` two things from one payload: a 52-week commit grid (the
// GitHub-contributions shape) and a short reverse-chronological log of recent
// commit subjects. Both come from GitHub's REST API, both are stale-while-
// revalidate cached at the edge, and neither ever reaches a public page from
// a third-party origin — the page calls THIS endpoint, same-origin, so the
// strict CSP needs no widening and the "zero third-party runtime JS" claim
// survives (CLAUDE.md, dependency-free published site).
//
// TWO REPO LISTS, AND THE SPLIT IS DELIBERATE (site.config.js → devFeed):
//
//   grid: […]  repos whose commit COUNTS are summed into the squares.
//   log:  […]  repos whose commit MESSAGES are quoted in the rail.
//
// `grid` may name private repos; `log` must not. A count and a date say only
// that somebody worked, which is exactly what the grid claims. A commit
// subject is CONTENT — quoting one from a private repo publishes unreleased
// work onto a public page. So the response never names a grid repo at all
// (the squares are a sum, and a sum has no sources), and only ever quotes a
// repo the owner listed under `log`.
//
// Absent config = the feature does not exist: 404, no-store — same posture as
// the webring's /.well-known/analogs.txt. A fork inherits the endpoint and,
// with no devFeed block, inherits a 404.

import siteConfig from '../shared/config.js';
import { jsonRes } from '../shared/http.js';
import { _deployToken } from '../edge/data.js';

// TWO TIERS, AND THE SLOW ONE IS THE SOURCE OF TRUTH.
//
//   KV   — global, survives deploys. This is where the payload LIVES.
//   colo — caches.default, per-datacenter. A read-through in front of KV.
//
// ⚠️ THE KEY USED TO CARRY THE DEPLOY ID and that is what made this endpoint
// feel broken. Every push to `main` is a deploy, a deploy changed the key, and
// a changed key is a purge — so the first visitor after every push paid for a
// full GitHub rebuild. Measured live on 2026-09-20: 5.2s cold against 0.2s
// warm, and the person most reliably hitting it was the owner, whose visit to
// /dev is usually *because* they just deployed. On top of that `caches.default`
// is per-colo, so a warm entry in one datacenter does nothing for a visitor
// routed to another, and the daily cron warm wrote one colo under one deploy
// id and was orphaned by the next push — real work almost nothing ever read.
//
// The deploy id did solve something real: without it a fix to this endpoint
// stays invisible for up to FRESH_MS because the old payload outlives the new
// code (half an hour of this feature's own debugging went to exactly that).
// So it is still here — it just moved OUT of the key and INTO the payload.
// A payload built by a previous deploy is served instantly and the deploy
// change is what schedules the background refresh. Same property, and the
// cost is one stale response instead of five seconds for everybody.
const CACHE_KEY = (origin) => `${origin}/__devfeed_cache`;

// ⚠️ ONE KV KEY, IN THE NAMESPACE THAT ALREADY EXISTS. `SUBSCRIBERS` is the
// engine's only KV binding, so using it costs a fork nothing — a new namespace
// would make every fork provision storage for a feature that ships switched
// off. The namespace already has a convention for this: a `__`-prefixed key
// with no `@` in it is internal, and the subscriber export filters exactly
// that shape (src/api/subscribers.js — `__oaklens_session_secret` lives here
// the same way). tests/subscriber-export.test.js pins that it stays filtered.
const KV_KEY = '__devfeed';

// The edge cache, or null where there isn't one. `caches` is a Workers global
// and simply does not exist under Node — so every reference has to be guarded
// or importing this module is enough to throw in the test runner (it was, in
// tests/method-not-allowed.test.js, which walks every route in the table).
// Without a cache the endpoint still answers; it just fetches every time.
function edgeCache() {
  return (typeof caches !== 'undefined' && caches && caches.default) || null;
}

// ...and the KV namespace, or null. Guarded for the same reason: the tests
// call the handler with a bare `{}` env, and a fork mid-setup may not have
// bound it yet. No KV means no persistence, which is where this started —
// correct, just slower.
function feedStore(env) {
  return (env && env.SUBSCRIBERS) || null;
}

// Revalidate in the background after this long. Deliberately not tight:
// GitHub computes the weekly stats lazily and serves them from its own cache,
// so the right-hand edge of the grid can lag a day regardless of how often we
// ask. Thirty minutes keeps the log rail current without pointless upstream
// traffic.
const FRESH_MS = 30 * 60 * 1000;

// ...and the window used when a repo answered 202 (see buildGrid). GitHub
// computes these aggregates LAZILY: the first request for a repo nobody has
// ever asked about returns 202 and starts the job. So the very first build
// after a deploy can legitimately be missing a repo, and caching that for the
// full thirty minutes means half an hour of a grid that is quietly wrong.
//
// This is not hypothetical — it is what the first production request did on
// 2026-09-20: the three public repos had warm stats, the private one had never
// been asked, and the page showed 119 commits instead of ~1,300. Marking the
// payload provisional lets the next visitor rebuild it, by which time the job
// the 202 kicked off has finished.
const PROVISIONAL_FRESH_MS = 60 * 1000;

// ...but not forever. A repo that genuinely has no commits in the last year
// answers with a real, all-zero year every time, and retrying that every
// minute for the life of the deploy is just noise. After this many
// consecutive incomplete builds the payload settles into the normal window.
const PROVISIONAL_MAX_ATTEMPTS = 6;

// How many commit subjects the rail holds, and how much of one it quotes.
const LOG_MAX = 14;
const SUBJECT_MAX = 96;

// Commits pulled per repo before the merge.
const PER_REPO = 10;

// ...and how many of them any ONE repo may contribute to the finished rail.
//
// ⚠️ WITHOUT THIS CAP THE RAIL IS ONE REPO. A straight newest-first merge is
// the honest ordering and it reads terribly: the engine mirror takes commits
// almost daily while the other projects go quiet for weeks, so all fourteen
// lines come back "sync from engine: …" and the rail stops being a tour of
// the work and becomes a changelog for one repo. Capping each repo's share
// and THEN sorting keeps the order chronological within what is shown while
// guaranteeing every project appears.
const PER_REPO_IN_RAIL = 5;

// Merge commits are plumbing, not work. "Merge pull request #7 from …" tells a
// reader nothing about what was built and is the one subject line likely to
// carry a branch name nobody chose to publish.
const MERGE_SUBJECT = /^Merge (pull request|branch|remote-tracking) /i;

function feedConfig() {
  const cfg = siteConfig.devFeed;
  if (!cfg) return null;
  const grid = Array.isArray(cfg.grid) ? cfg.grid.filter(Boolean) : [];
  const log = Array.isArray(cfg.log) ? cfg.log.filter(Boolean) : [];
  if (!grid.length && !log.length) return null;
  return { grid, log };
}

// One GitHub GET. The token is optional and only ever widens what we can read:
// every repo under `log` is public by contract, and the public ones under
// `grid` are readable by anybody.
function ghGet(path, token) {
  return fetch(`https://api.github.com/${path}`, {
    headers: {
      // GitHub rejects an API request with no User-Agent outright.
      'User-Agent': 'oaklens-devfeed',
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

// ⚠️ A FINE-GRAINED PAT 404s ON REPOS IT WAS NOT GRANTED — INCLUDING PUBLIC
// ONES. GITHUB_TOKEN exists to publish to this instance's own repo, so on most
// installs it is scoped to exactly that one. Sending it to a public repo then
// turns a request that would have succeeded anonymously into a 404, and the
// grid quietly loses that repo instead of reporting a problem. So: try with
// the token (5000 req/hr, and it is the only way to read a private repo), and
// on a refusal retry with no token at all (60 req/hr, plenty behind a cache).
// "GitHub is computing this and hasn't finished" — distinct from a failure,
// and the caller counts the two separately. Waiting a minute fixes one of
// them and will never fix the other, and on a page that just shows a smaller
// number they are otherwise identical.
export const PENDING = Symbol('devfeed:pending');

async function ghJson(path, token) {
  const first = await ghGet(path, token);
  let res = first;

  if (token && (first.status === 403 || first.status === 404)) {
    res = await ghGet(path, null);
    // ⚠️ THE RETRY MUST NOT SWALLOW THE REAL ANSWER. A PRIVATE repo is
    // guaranteed to 404 anonymously, so without this the log would report the
    // anonymous 404 and a genuine permissions problem on the token would read
    // as "that repo does not exist" — which is the wrong thing to go and check.
    if (!res.ok) {
      console.error(
        `[devfeed] GET ${path} responded ${first.status} with the token`
        + ` and ${res.status} without it`
      );
      return null;
    }
  }

  if (res.status === 202) return PENDING;
  if (!res.ok) {
    console.error(`[devfeed] GET ${path} responded ${res.status}`);
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Sum every configured repo's weekly commit counts into one 52×7 grid.
//
// ⚠️ ALIGNED FROM THE END, NOT BY TIMESTAMP. The obvious merge — key each row
// by GitHub's own `week` value — produces a grid with HALF THE SQUARES FILLED
// and roughly 76 columns instead of 52, because GitHub computes these stats
// per repo and does not agree with itself about where a week starts: of this
// instance's three public repos, two report week-start on a Sunday and one on
// a Saturday. Keyed by timestamp those become two interleaved series that
// never add up. Aligning from the last element instead makes "one step back
// from the end" mean the same week for every repo whatever its boundary, and
// it degrades correctly for a repo younger than a year (a short series simply
// contributes nothing to the columns before it existed).
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;
const GRID_WEEKS = 52;

// The fallback's budget. `stats/commit_activity` answers a whole year in one
// request, which is why it is tried first; counting commits by hand costs one
// request per hundred.
//
// ⚠️ A CAP THAT IS REACHED MUST SAY SO. This was 15 pages, and the repo it
// was written for was already using 14 of them — roughly seven weeks from
// silently plateauing, with the grid's number frozen and nothing anywhere
// reporting it. That is the same shape as every other bug in this file's
// history: not wrong data, but wrong data that looks exactly like right data.
// So the ceiling is higher AND `sources.truncated` is set when it is hit.
const COMMIT_PAGE_SIZE = 100;
const COMMIT_MAX_PAGES = 30;

// ...and a budget shared across every repo in one refresh, because the
// per-repo cap alone is not a ceiling on the REQUEST COUNT.
//
// ⚠️ SEEN, NOT IMAGINED. Running this unauthenticated against four repos
// whose statistics were all cold walked all four commit lists and spent the
// entire 60-per-hour anonymous quota in a single refresh. Every call then
// 403'd, the grid came back null, `provisional` set a 60-second retry, and
// the retry hit the same wall — a rate-limit loop that a fork with no
// GITHUB_TOKEN could inflict on itself just by configuring `devFeed`.
//
// With a token the ceiling is 5,000/hr and forty pages is nothing. Without
// one it has to fit inside sixty with room for the stats calls and whatever
// else the instance does, so it is deliberately small: a partial grid that
// reports itself truncated beats no grid and an hour of 403s.
const COMMIT_BUDGET_WITH_TOKEN = 40;
const COMMIT_BUDGET_ANONYMOUS = 8;

/** `YYYY-MM-DD` for a unix-seconds instant, in UTC. */
function isoDay(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

// ⚠️ THE FALLBACK EXISTS BECAUSE `stats/commit_activity` CAN STAY STUCK.
// It is computed lazily: the first request answers 202 and starts a job, and
// the docs say to ask again. For this instance's own repo GitHub answered 202
// on every attempt, indefinitely — six bounded retries over five minutes, then
// twenty more over the following half hour. The grid showed 119 commits
// instead of ~1,300 and no amount of waiting was going to change it.
//
// So a repo that will not produce a statistic gets counted the slow, boring,
// always-correct way: list its commits and tally them by day. The commits
// endpoint has no precomputation behind it and cannot answer "not yet".
async function commitsByDay(repo, token, sinceIso, budget) {
  const byDay = new Map();
  let truncated = false;
  for (let page = 1; page <= COMMIT_MAX_PAGES; page += 1) {
    if (budget.left <= 0) { truncated = true; break; }
    budget.left -= 1;
    const data = await ghJson(
      `repos/${repo}/commits?since=${sinceIso}&per_page=${COMMIT_PAGE_SIZE}&page=${page}`,
      token
    );
    if (!Array.isArray(data) || !data.length) break;
    for (const c of data) {
      const day = String(c?.commit?.author?.date || c?.commit?.committer?.date || '').slice(0, 10);
      if (day) byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    if (data.length < COMMIT_PAGE_SIZE) break;
    // A full last page means there was more we did not ask for.
    if (page === COMMIT_MAX_PAGES) truncated = true;
  }
  return byDay.size ? { byDay, truncated } : null;
}

async function buildGrid(repos, token) {
  const results = await Promise.all(
    repos.map((r) => ghJson(`repos/${r}/stats/commit_activity`, token))
  );
  const series = results.filter((w) => Array.isArray(w) && w.length);

  // THREE COUNTS, because "answered" and "said anything" are not the same and
  // the difference is what made a bad grid look healthy. `null` is either
  // "still computing" (202) or a hard failure. But GitHub also hands back a
  // full, well-formed year of ZEROS for a repo whose stats job it has not
  // finished — which passes every structural check, sums to nothing, and is
  // indistinguishable from a dormant repo unless you count it separately.
  const asked = results.length;
  const computing = results.filter((w) => w === PENDING).length;
  const columns = series.length
    ? Math.min(GRID_WEEKS, Math.max(...series.map((w) => w.length)))
    : GRID_WEEKS;

  // The newest column's timestamp, used to label the grid and to date every
  // cell for the fallback below. Every earlier column is exactly one week
  // before it, so the axis is regular even though the upstream series are not.
  // With no series at all, anchor on the current UTC week.
  const nowWeek = Math.floor(Date.now() / 1000 / WEEK_SECONDS) * WEEK_SECONDS;
  const newest = series.length
    ? Math.max(...series.map((w) => Number(w[w.length - 1]?.week) || 0))
    : nowWeek;

  // Repos that could not produce a statistic get counted from their commits.
  const stuck = repos.filter((_, i) => results[i] === PENDING);
  const oldestCell = newest - (columns - 1) * WEEK_SECONDS;
  // Sequential, not Promise.all: a shared budget only means anything if the
  // repos draw on it one at a time. Run in parallel they would each read
  // `left` before any of them had spent it.
  const counted = [];
  if (stuck.length) {
    const budget = { left: token ? COMMIT_BUDGET_WITH_TOKEN : COMMIT_BUDGET_ANONYMOUS };
    const since = `${isoDay(oldestCell)}T00:00:00Z`;
    for (const r of stuck) {
      const got = await commitsByDay(r, token, since, budget);
      if (got) counted.push(got);
    }
  }
  const fallbacks = counted.map((c) => c.byDay);
  const truncated = counted.some((c) => c.truncated);

  const grid = [];
  for (let back = columns - 1; back >= 0; back -= 1) {
    const days = [0, 0, 0, 0, 0, 0, 0];
    const weekStart = newest - back * WEEK_SECONDS;
    for (const weeks of series) {
      const row = weeks[weeks.length - 1 - back];
      if (!row || !Array.isArray(row.days)) continue;
      for (let i = 0; i < 7; i += 1) days[i] += Number(row.days[i]) || 0;
    }
    // Same cells, dated rather than indexed — day i of a column is exactly i
    // days after that column's start, which is how GitHub lays `days` out too.
    for (const byDay of fallbacks) {
      for (let i = 0; i < 7; i += 1) {
        days[i] += byDay.get(isoDay(weekStart + i * DAY_SECONDS)) || 0;
      }
    }
    grid.push({ w: weekStart, d: days });
  }

  const answered = series.length + fallbacks.length;
  const contributing = series.filter((w) => w.some((r) => (Number(r.total) || 0) > 0)).length
    + fallbacks.length;

  // Nothing answered at all is not an empty grid — it is no grid. Returning 52
  // blank weeks would claim a year of silence that did not happen.
  if (!answered) return { grid: null, asked, answered, contributing, computing, truncated };

  return { grid, asked, answered, contributing, computing, truncated };
}

// The rail: newest commit subjects across the PUBLIC repos, merged and sorted.
async function buildLog(repos, token) {
  const perRepo = await Promise.all(
    repos.map(async (full) => {
      const commits = await ghJson(`repos/${full}/commits?per_page=${PER_REPO}`, token);
      if (!Array.isArray(commits)) return [];
      const name = full.split('/')[1] || full;
      return commits.map((c) => {
        const subject = String(c?.commit?.message || '').split('\n')[0].trim();
        return {
          repo: name,
          date: c?.commit?.author?.date || c?.commit?.committer?.date || '',
          msg: subject.length > SUBJECT_MAX ? `${subject.slice(0, SUBJECT_MAX - 1)}…` : subject,
          url: c?.html_url || '',
        };
      }).filter((e) => e.date && e.msg && !MERGE_SUBJECT.test(e.msg));
    })
  );
  return perRepo
    .map((entries) => entries
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, PER_REPO_IN_RAIL))
    .flat()
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, LOG_MAX);
}

// Fetch both halves and write both tiers. Safe inside ctx.waitUntil.
export async function refreshDevFeed(origin, env, previous) {
  const cfg = feedConfig();
  if (!cfg) return null;
  const token = env.GITHUB_TOKEN || null;
  try {
    const [gridResult, log] = await Promise.all([
      cfg.grid.length
        ? buildGrid(cfg.grid, token)
        : { grid: null, asked: 0, answered: 0, contributing: 0, computing: 0, truncated: false },
      cfg.log.length ? buildLog(cfg.log, token) : [],
    ]);
    const { grid, asked, answered, contributing, computing, truncated } = gridResult;
    // `deploy` is what used to be in the cache key. Carried in the payload
    // instead, it costs a reader nothing and still lets the handler notice
    // that this answer was built by code that is no longer running.
    const payload = { ok: true, ts: Date.now(), deploy: _deployToken(env), grid, log };

    // How many repos were asked, how many replied, and how many had anything
    // to say. COUNTS ONLY — never which — so this stays on the safe side of
    // the grid/log privacy split while making a wrong-looking grid diagnosable
    // from the response instead of from guesswork. A grid that reads low is
    // either `contributing < asked` (a repo is not reporting) or simply a
    // quiet year, and those look identical on the page.
    if (asked) {
      payload.sources = { asked, answered, contributing };
      // Only when non-default, so a healthy payload stays as small as it was.
      if (computing) payload.sources.computing = computing;
      if (truncated) payload.sources.truncated = true;
    }

    // Incomplete is "somebody didn't answer" OR "somebody answered nothing".
    if (asked && contributing < asked) {
      payload.provisional = true;
      payload.attempts = ((previous && previous.attempts) || 0) + 1;
    }
    const body = JSON.stringify(payload);

    // KV FIRST, because it is the copy that has to survive. A colo cache write
    // that succeeds while the KV write fails leaves one datacenter fast and
    // the next deploy back where this started, so the durable tier is the one
    // we wait on and the one whose failure is worth a log line.
    const store = feedStore(env);
    if (store) {
      try {
        await store.put(KV_KEY, body);
      } catch (err) {
        console.error('[devfeed] KV write failed:', err.message);
      }
    }

    await writeColoCache(origin, body);
    return payload;
  } catch (err) {
    console.error('[devfeed] refresh failed:', err.message);
    return null;
  }
}

// The per-colo copy. Long max-age so the entry stays SERVABLE; the payload's
// own `ts` is what decides freshness. Same split the weather cache uses.
async function writeColoCache(origin, body) {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(CACHE_KEY(origin), new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    }));
  } catch (err) {
    console.error('[devfeed] colo cache write failed:', err.message);
  }
}

function usable(payload) {
  return payload && payload.ok ? payload : null;
}

// Read the fast tier only. Never touches KV, never touches GitHub — so it is
// safe anywhere a response is already in flight.
async function readColoCache(origin) {
  const cache = edgeCache();
  if (!cache) return null;
  const hit = await cache.match(new Request(CACHE_KEY(origin)));
  if (!hit) return null;
  try {
    return usable(await hit.json());
  } catch {
    return null;
  }
}

// ...and the durable tier. A KV read is slower than a colo hit and far faster
// than GitHub, which is the whole point: this is what a deploy, a cold colo or
// a quiet week falls back to instead of a five-second rebuild.
async function readStore(env) {
  const store = feedStore(env);
  if (!store) return null;
  try {
    return usable(await store.get(KV_KEY, 'json'));
  } catch (err) {
    console.error('[devfeed] KV read failed:', err.message);
    return null;
  }
}

// Both tiers, fast one first. Says WHERE it came from, because a KV hit means
// this colo has no copy yet and should be given one.
async function readCache(origin, env) {
  const colo = await readColoCache(origin);
  if (colo) return { payload: colo, from: 'colo' };
  const stored = await readStore(env);
  return stored ? { payload: stored, from: 'kv' } : null;
}

// ---- Daily warm (cron) ----
//
// A cron tick has no request to take an origin from, so it uses the canonical
// one from config — the same thing the Wayback run does. Returns quietly when
// `devFeed` or `url` is unset, which is every fork that has not opted in.
export async function warmDevFeed(env) {
  const origin = String(siteConfig.url || '').replace(/\/+$/, '');
  if (!origin || !feedConfig()) return null;
  // The previous payload only supplies `attempts`, so the KV copy is the right
  // one to read here — it is the one that is still there a day later.
  return refreshDevFeed(origin, env, await readStore(env));
}

// ---- GET /api/devfeed ----
//
// Cache-first, across both tiers. A stored payload answers instantly however
// old it is and whatever built it; refreshing is always background work. Only
// a genuinely EMPTY store waits on GitHub — which, now that the payload
// survives deploys, is about once in the life of an install rather than once
// per push. And it waits here rather than on any HTML response: the page
// fetches this after paint, so nothing about the document's TTFB depends on
// GitHub being up.
export async function handleDevFeed(request, env, url, ctx) {
  const cfg = feedConfig();
  if (!cfg) {
    return new Response('Not found\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const origin = url.origin;
  const hit = await readCache(origin, env);

  if (hit) {
    const cached = hit.payload;
    const retrying = cached.provisional
      && (cached.attempts || 0) < PROVISIONAL_MAX_ATTEMPTS;
    const window = retrying ? PROVISIONAL_FRESH_MS : FRESH_MS;
    // Two reasons to rebuild, and NEITHER of them delays this response.
    // The deploy check is what the old cache key did by throwing the payload
    // away; done here it costs one stale answer instead of a cold build.
    const aged = Date.now() - (cached.ts || 0) > window;
    const superseded = cached.deploy !== _deployToken(env);
    if (aged || superseded) {
      ctx.waitUntil(refreshDevFeed(origin, env, cached));
    } else if (hit.from === 'kv') {
      // Came from the durable tier, so this datacenter has no copy. Give it
      // one — otherwise every visitor routed here pays the KV read forever.
      ctx.waitUntil(writeColoCache(origin, JSON.stringify(cached)));
    }
    return jsonRes(cached, 200);
  }

  const fresh = await refreshDevFeed(origin, env, null);
  // Upstream unreachable on a cold store: an honest empty, not a 500. The page
  // renders its quiet state and the next visitor probably gets the real thing.
  return jsonRes(fresh || { ok: true, ts: Date.now(), grid: null, log: [] }, 200);
}

// Exported for tests: the pure shaping, without the network.
export const _internals = {
  feedConfig, buildGrid, buildLog,
  LOG_MAX, SUBJECT_MAX, FRESH_MS, PROVISIONAL_FRESH_MS, PROVISIONAL_MAX_ATTEMPTS,
  COMMIT_BUDGET_WITH_TOKEN, COMMIT_BUDGET_ANONYMOUS,
  // The two storage addresses, so a test can DERIVE where it expects to find
  // the payload instead of restating the string and drifting from it.
  CACHE_KEY, KV_KEY,
};
