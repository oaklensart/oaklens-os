// /api/devfeed — the /dev page's commit grid and activity log.
//
// Two of the assertions here are regressions against bugs that only appeared
// when the thing was pointed at real repositories, and neither would have been
// visible from reading the code:
//
//   · GitHub does not agree with itself about where a week starts. Of this
//     instance's three public repos, two report week-start on a Sunday and one
//     on a Saturday, so the obvious merge (key each row by GitHub's `week`
//     value) built a 76-column grid out of two interleaved series with half
//     the squares empty. The grid is aligned from the END instead.
//   · A straight newest-first merge of commits makes the rail one repo. The
//     engine mirror takes commits almost daily and the other projects go quiet
//     for weeks, so every line came back from the same place. Each repo's
//     share is capped before the sort.
//
// And one that is a privacy boundary rather than a bug: `grid` repos may be
// private, so the response must never name them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const GRID_ONLY_PRIVATE = 'someone/private-thing';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: Object.freeze({
    ...actual.default,
    // ⚠️ NAMED HERE, NOT INHERITED. `warmDevFeed` reads siteConfig.url, and
    // this instance has one while the extracted fork's example config does
    // not — so a test that leans on the real config passes in this tree and
    // fails in every fork's. (It did, at `os-extract --verify`.)
    url: 'https://example.test',
    devFeed: {
      grid: [GRID_ONLY_PRIVATE, 'acme/loud', 'acme/quiet'],
      log: ['acme/loud', 'acme/quiet'],
    },
  }) };
});

// ⚠️ IMPORTED ONCE, HERE, AND THE STORAGE BLOCK BELOW MUST USE THESE BINDINGS.
// A test further down calls `vi.doUnmock('../site.config.js')` + `resetModules`
// when it finishes, so any LATER `await import(...)` gets a module reading the
// REAL config. In this tree that config has a `devFeed` block and the test
// passes; in the extracted fork's it does not, `warmDevFeed` returns null, and
// the test fails in every fork while staying green here. Caught by
// `os-extract.mjs --verify`, which is why that gate exists (CLAUDE.md).
const { handleDevFeed, warmDevFeed, _internals } = await import('../src/api/devfeed.js');

const ctx = { waitUntil() {} };
const call = async () => {
  const url = new URL('https://example.com/api/devfeed');
  const res = await handleDevFeed(new Request(url), {}, url, ctx);
  return { res, body: await res.json() };
};

const WEEK = 7 * 24 * 60 * 60;

/** 52 weeks of `perDay` commits a day, anchored at `anchor`. */
function activity(anchor, perDay, weeks = 52) {
  return Array.from({ length: weeks }, (_, i) => ({
    week: anchor + (i - (weeks - 1)) * WEEK,
    days: Array(7).fill(perDay),
    total: perDay * 7,
  }));
}

function commit(sha, date, message) {
  return {
    sha,
    html_url: `https://github.com/x/y/commit/${sha}`,
    commit: { message, author: { date } },
  };
}

/** Route stubbed fetches by URL fragment. */
function stubGitHub(routes) {
  const seen = [];
  vi.stubGlobal('fetch', async (input, init) => {
    const url = String(input);
    seen.push({ url, auth: init?.headers?.Authorization || null });
    for (const [fragment, reply] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        const r = typeof reply === 'function' ? reply(seen.length) : reply;
        if (typeof r === 'number') return new Response('', { status: r });
        return new Response(JSON.stringify(r), { status: 200 });
      }
    }
    return new Response('[]', { status: 200 });
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('/api/devfeed', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sums every grid repo into one 52-week grid', async () => {
    const sunday = 1758326400; // a Sunday, 00:00 UTC
    stubGitHub({
      'stats/commit_activity': activity(sunday, 1),
      '/commits?': [],
    });
    const { body } = await call();
    expect(body.grid).toHaveLength(52);
    // three repos × 1 commit a day
    expect(body.grid.at(-1).d).toEqual([3, 3, 3, 3, 3, 3, 3]);
  });

  // ⚠️ THE REGRESSION. One repo reporting a different week anchor must not
  // fork the grid into a second series.
  it('stays 52 columns when repos disagree about where a week starts', async () => {
    const sunday = 1758326400;
    let n = 0;
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) {
        n += 1;
        // Third repo is offset by a day, exactly as fixxer is in production.
        const anchor = n === 3 ? sunday - 86400 : sunday;
        return new Response(JSON.stringify(activity(anchor, 2)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.grid).toHaveLength(52);
    // Every square is filled by all three repos — nothing landed in a
    // parallel series of its own.
    for (const col of body.grid) expect(col.d).toEqual([6, 6, 6, 6, 6, 6, 6]);
  });

  it('a repo whose stats are still computing is skipped, not counted as zero', async () => {
    const sunday = 1758326400;
    let n = 0;
    vi.stubGlobal('fetch', async (input) => {
      if (String(input).includes('stats/commit_activity')) {
        n += 1;
        if (n === 1) return new Response('', { status: 202 }); // GitHub: "ask again"
        return new Response(JSON.stringify(activity(sunday, 5)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.grid.at(-1).d).toEqual([10, 10, 10, 10, 10, 10, 10]); // 2 repos, not 3
  });

  it('no grid at all is null, never a year of empty squares', async () => {
    stubGitHub({ 'stats/commit_activity': 202, '/commits?': [] });
    const { body } = await call();
    expect(body.grid).toBeNull();
  });

  // ⚠️ THE FIRST-DEPLOY REGRESSION. GitHub computes these aggregates lazily:
  // the first request for a repo nobody has ever asked about answers 202 and
  // starts the job. On 2026-09-20 the first production request hit exactly
  // that — three public repos warm, the private one never asked — and the
  // page showed 119 commits instead of ~1,300, cached for a full 30 minutes.
  // A build that is missing a repo must expire in a minute, not half an hour.
  it('marks a grid provisional when a repo was still computing', async () => {
    const sunday = 1758326400;
    let n = 0;
    vi.stubGlobal('fetch', async (input) => {
      if (String(input).includes('stats/commit_activity')) {
        n += 1;
        if (n === 1) return new Response('', { status: 202 });
        return new Response(JSON.stringify(activity(sunday, 1)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.provisional).toBe(true);
    expect(body.grid.at(-1).d).toEqual([2, 2, 2, 2, 2, 2, 2]); // the 2 that answered
    expect(_internals.PROVISIONAL_FRESH_MS).toBeLessThan(_internals.FRESH_MS);
  });

  it('leaves the flag off entirely when every repo answered', async () => {
    stubGitHub({ 'stats/commit_activity': activity(1758326400, 1), '/commits?': [] });
    const { body } = await call();
    expect('provisional' in body).toBe(false);
    expect(body.sources).toEqual({ asked: 3, answered: 3, contributing: 3 });
  });

  // ⚠️ THE ONE THAT LOOKED HEALTHY. GitHub also returns a full, well-formed
  // year of ZEROS for a repo whose stats job it has not finished. That passes
  // every structural check — 52 entries, 7 days each — so the grid counted it
  // as a repo that answered and cached the result as final. On the live site
  // that showed 119 commits where ~1,300 was right, with `provisional: false`
  // swearing everything had replied.
  it('treats a repo that answered with nothing as incomplete', async () => {
    const sunday = 1758326400;
    let n = 0;
    vi.stubGlobal('fetch', async (input) => {
      if (String(input).includes('stats/commit_activity')) {
        n += 1;
        // A real 52-week shape, every count zero.
        if (n === 1) return new Response(JSON.stringify(activity(sunday, 0)), { status: 200 });
        return new Response(JSON.stringify(activity(sunday, 3)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.sources).toEqual({ asked: 3, answered: 3, contributing: 2 });
    expect(body.provisional).toBe(true);
    expect(body.attempts).toBe(1);
  });

  it('counts a repo that never replied separately from one that replied empty', async () => {
    const sunday = 1758326400;
    let n = 0;
    vi.stubGlobal('fetch', async (input) => {
      if (String(input).includes('stats/commit_activity')) {
        n += 1;
        if (n === 1) return new Response('', { status: 202 });             // no reply
        if (n === 2) return new Response(JSON.stringify(activity(sunday, 0)), { status: 200 }); // empty reply
        return new Response(JSON.stringify(activity(sunday, 4)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    // The 202 is now reported as `computing`, which is the whole point:
    // one of these two is worth waiting for and the other is not.
    expect(body.sources).toEqual({ asked: 3, answered: 2, contributing: 1, computing: 1 });
    expect(body.provisional).toBe(true);
  });

  // "Wait a minute" and "go look at the token" are different instructions and
  // the page shows the same smaller number for both.
  it('separates a repo that is still computing from one that refused', async () => {
    const sunday = 1758326400;
    let n = 0;
    vi.stubGlobal('fetch', async (input) => {
      if (String(input).includes('stats/commit_activity')) {
        n += 1;
        if (n === 1) return new Response('', { status: 202 });  // not yet
        if (n === 2) return new Response('', { status: 500 });  // refused
        return new Response(JSON.stringify(activity(sunday, 2)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.sources.asked).toBe(3);
    expect(body.sources.answered).toBe(1);
    expect(body.sources.computing).toBe(1); // the 202, not the 500
    expect(body.provisional).toBe(true);
  });

  it('omits the computing count entirely when nothing is pending', async () => {
    stubGitHub({ 'stats/commit_activity': activity(1758326400, 1), '/commits?': [] });
    const { body } = await call();
    expect('computing' in body.sources).toBe(false);
  });

  // A private repo 404s anonymously by definition, so the fallback must not
  // report that as the answer — it would send someone to check whether the
  // repo exists when the real problem is the token's scope.
  it('keeps the authenticated status when the anonymous retry also fails', async () => {
    const seen = [];
    vi.stubGlobal('fetch', async (input, init) => {
      const auth = init?.headers?.Authorization || null;
      if (String(input).includes('stats/commit_activity')) {
        seen.push(auth);
        return new Response('', { status: auth ? 403 : 404 });
      }
      return new Response('[]', { status: 200 });
    });
    const url = new URL('https://example.com/api/devfeed');
    const res = await handleDevFeed(new Request(url), { GITHUB_TOKEN: 'tok' }, url, ctx);
    const body = await res.json();
    expect(seen).toContain('Bearer tok');
    expect(seen).toContain(null);
    expect(body.grid).toBeNull();
    // Refused, not pending — nothing here is worth retrying fast.
    expect(body.sources).toEqual({ asked: 3, answered: 0, contributing: 0 });
  });

  // ⚠️ THE ONE THAT ACTUALLY FIXED THE LIVE GRID. `stats/commit_activity` is
  // computed lazily and CAN STAY STUCK: for this instance's own repo GitHub
  // answered 202 on every attempt indefinitely, so the grid showed 119
  // commits instead of ~1,300 and waiting was never going to change it. A
  // repo that will not produce a statistic is counted from its commits.
  it('counts commits by hand for a repo whose stats never arrive', async () => {
    const sunday = 1758326400; // Sunday 00:00 UTC
    const day = (n) => new Date((sunday + n * 86400) * 1000).toISOString();
    let n = 0;
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) {
        n += 1;
        if (n === 1) return new Response('', { status: 202 }); // stuck forever
        return new Response(JSON.stringify(activity(sunday, 1)), { status: 200 });
      }
      if (url.includes('/commits?since=')) {
        // Three commits on the most recent Monday, one page.
        return new Response(JSON.stringify([
          commit('a', day(1), 'one'), commit('b', day(1), 'two'), commit('c', day(1), 'three'),
        ]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    const last = body.grid.at(-1);
    // Two healthy repos contribute 1/day; the stuck one adds 3 on Monday only.
    expect(last.d).toEqual([2, 5, 2, 2, 2, 2, 2]);
    expect(body.sources.answered).toBe(3);   // the fallback counts as answered
    expect(body.sources.computing).toBe(1);  // ...and is still reported as stuck
    expect('provisional' in body).toBe(false); // nothing left worth retrying
  });

  it('stops paging once a page comes back short', async () => {
    const sunday = 1758326400;
    const pages = [];
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (url.includes('/commits?since=')) {
        pages.push(url.match(/[?&]page=(\d+)/)?.[1]);
        return new Response(JSON.stringify([
          commit('a', new Date(sunday * 1000).toISOString(), 'x'),
        ]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    await call();
    // One short page per stuck repo — never a blind walk to the page cap.
    expect(new Set(pages)).toEqual(new Set(['1']));
  });

  it('still reports no grid when nothing answers and nothing can be counted', async () => {
    vi.stubGlobal('fetch', async (input) => {
      if (String(input).includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (String(input).includes('/commits?since=')) return new Response('[]', { status: 200 });
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.grid).toBeNull();
  });

  // A deploy must be able to fix this endpoint. Without the deploy token in
  // the key, a cached payload outlives the code that built it and keeps
  // serving the old answer for up to FRESH_MS — which is exactly how a
  // fallback shipped at 18:58 was still invisible at 19:09.
  it('scopes the cache key by the deployment', async () => {
    const { _deployToken } = await import('../src/edge/data.js');
    const a = _deployToken({ CF_VERSION_METADATA: { id: 'aaaa-1111' } });
    const b = _deployToken({ CF_VERSION_METADATA: { id: 'bbbb-2222' } });
    expect(a).not.toBe(b);
    // ...and a fork with no binding still gets a usable, constant token.
    expect(_deployToken({})).toBe('v0');
  });

  // A cap that is reached has to say so, or the grid's number freezes and
  // looks exactly like a real number. The repo this fallback was written for
  // was already using 14 of the original 15 pages.
  it('reports when the commit walk hit its page cap', async () => {
    const sunday = 1758326400;
    const full = Array.from({ length: 100 }, (_, i) =>
      commit(`c${i}`, new Date(sunday * 1000).toISOString(), `c ${i}`));
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (url.includes('/commits?since=')) return new Response(JSON.stringify(full), { status: 200 });
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.sources.truncated).toBe(true);
  });

  it('leaves the truncated flag off when the walk finished', async () => {
    const sunday = 1758326400;
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (url.includes('/commits?since=')) {
        return new Response(JSON.stringify([
          commit('a', new Date(sunday * 1000).toISOString(), 'x'),
        ]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect('truncated' in body.sources).toBe(false);
  });

  // The daily cron keeps the page fresh for the first visitor rather than
  // because of them: without it a quiet week means a week-old log, and the
  // visitor who finally triggers the refresh still sees the old payload.
  it('the cron warm refreshes against the canonical origin', async () => {
    const { warmDevFeed } = await import('../src/api/devfeed.js');
    const seen = [];
    vi.stubGlobal('fetch', async (input) => {
      seen.push(String(input));
      if (String(input).includes('stats/commit_activity')) {
        return new Response(JSON.stringify(activity(1758326400, 1)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const out = await warmDevFeed({});
    expect(out).toBeTruthy();
    expect(out.grid.length).toBe(52);
    expect(seen.some((u) => u.includes('stats/commit_activity'))).toBe(true);
  });

  // ...and the other half: a fork that never set a canonical URL gets a
  // no-op, not a crash in a cron tick nobody is watching.
  it('the cron warm is a no-op with no canonical url configured', async () => {
    vi.doMock('../site.config.js', async (importOriginal) => {
      const actual = await importOriginal();
      const { url, ...rest } = actual.default;
      return { default: Object.freeze({ ...rest, devFeed: { grid: ['a/b'], log: [] } }) };
    });
    vi.resetModules();
    const fresh = await import('../src/api/devfeed.js');
    let called = false;
    vi.stubGlobal('fetch', async () => { called = true; return new Response('[]', { status: 200 }); });
    expect(await fresh.warmDevFeed({})).toBeNull();
    expect(called).toBe(false);
    vi.doUnmock('../site.config.js');
    vi.resetModules();
  });

  // ⚠️ A REAL SELF-INFLICTED RATE LIMIT. Unauthenticated, four repos with
  // cold statistics walked all four commit lists and spent the whole
  // 60/hour anonymous quota in one refresh; every call then 403'd, the grid
  // came back null, and the 60-second provisional retry hit the same wall.
  it('spends far fewer requests on the fallback without a token', async () => {
    const sunday = 1758326400;
    const full = Array.from({ length: 100 }, (_, i) =>
      commit(`c${i}`, new Date(sunday * 1000).toISOString(), `c ${i}`));
    let commitCalls = 0;
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (url.includes('/commits?since=')) {
        commitCalls += 1;
        return new Response(JSON.stringify(full), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call(); // three stuck repos, no token
    expect(commitCalls).toBeLessThanOrEqual(_internals.COMMIT_BUDGET_ANONYMOUS);
    expect(body.sources.truncated).toBe(true);
  });

  it('spends more of it when a token lifts the ceiling', async () => {
    const sunday = 1758326400;
    const full = Array.from({ length: 100 }, (_, i) =>
      commit(`c${i}`, new Date(sunday * 1000).toISOString(), `c ${i}`));
    let commitCalls = 0;
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (url.includes('/commits?since=')) {
        commitCalls += 1;
        return new Response(JSON.stringify(full), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const url = new URL('https://example.com/api/devfeed');
    await handleDevFeed(new Request(url), { GITHUB_TOKEN: 'tok' }, url, ctx);
    expect(commitCalls).toBeGreaterThan(_internals.COMMIT_BUDGET_ANONYMOUS);
    expect(commitCalls).toBeLessThanOrEqual(_internals.COMMIT_BUDGET_WITH_TOKEN);
  });

  it('the fast retry is bounded, so a genuinely dormant repo settles', () => {
    expect(_internals.PROVISIONAL_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(_internals.PROVISIONAL_MAX_ATTEMPTS).toBeLessThan(20);
  });

  it('never names a repo in the diagnostic counts', async () => {
    stubGitHub({ 'stats/commit_activity': activity(1758326400, 1), '/commits?': [] });
    const { body } = await call();
    expect(JSON.stringify(body.sources)).not.toMatch(/[a-z]+\/[a-z]/i);
  });

  it('never names a grid-only repo anywhere in the response', async () => {
    const sunday = 1758326400;
    stubGitHub({
      'stats/commit_activity': activity(sunday, 1),
      '/commits?': [commit('a1', '2026-09-01T00:00:00Z', 'a change')],
    });
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain('private-thing');
    expect(JSON.stringify(body)).not.toContain('someone');
  });

  // ⚠️ THE OTHER REGRESSION: one busy repo must not take the whole rail.
  it('caps how much of the rail any one repo can fill', async () => {
    const loud = Array.from({ length: 10 }, (_, i) =>
      commit(`l${i}`, `2026-09-${String(20 - i).padStart(2, '0')}T00:00:00Z`, `loud ${i}`));
    const quiet = [commit('q1', '2026-01-04T00:00:00Z', 'quiet one')];
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (url.includes('acme/loud/commits')) return new Response(JSON.stringify(loud), { status: 200 });
      if (url.includes('acme/quiet/commits')) return new Response(JSON.stringify(quiet), { status: 200 });
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    const fromLoud = body.log.filter((e) => e.repo === 'loud');
    expect(fromLoud.length).toBeLessThanOrEqual(5);
    expect(body.log.some((e) => e.repo === 'quiet')).toBe(true);
    // Still chronological within what survives the cap.
    const dates = body.log.map((e) => Date.parse(e.date));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('drops merge commits from the rail', async () => {
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (url.includes('/commits?')) {
        return new Response(JSON.stringify([
          commit('m1', '2026-09-02T00:00:00Z', 'Merge pull request #7 from someone/a-branch'),
          commit('c1', '2026-09-01T00:00:00Z', 'a real change'),
        ]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.log.every((e) => !/^Merge /.test(e.msg))).toBe(true);
    expect(body.log.some((e) => e.msg === 'a real change')).toBe(true);
  });

  it('quotes only the first line of a commit message, truncated', async () => {
    const long = 'x'.repeat(400);
    vi.stubGlobal('fetch', async (input) => {
      const url = String(input);
      if (url.includes('stats/commit_activity')) return new Response('', { status: 202 });
      if (url.includes('/commits?')) {
        return new Response(JSON.stringify([
          commit('c1', '2026-09-01T00:00:00Z', `${long}\n\nbody paragraph nobody asked for`),
        ]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const { body } = await call();
    expect(body.log[0].msg).not.toContain('body paragraph');
    expect(body.log[0].msg.length).toBeLessThanOrEqual(_internals.SUBJECT_MAX);
  });

  // A fine-grained PAT scoped to one repo 404s on every other repo, including
  // public ones that need no token at all.
  it('retries without the token when an authenticated read is refused', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (input, init) => {
      const auth = init?.headers?.Authorization || null;
      calls.push({ url: String(input), auth });
      if (String(input).includes('stats/commit_activity')) {
        if (auth) return new Response('', { status: 404 });
        return new Response(JSON.stringify(activity(1758326400, 1)), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const url = new URL('https://example.com/api/devfeed');
    const res = await handleDevFeed(new Request(url), { GITHUB_TOKEN: 'tok' }, url, ctx);
    const body = await res.json();
    expect(calls.some((c) => c.auth === 'Bearer tok')).toBe(true);
    expect(calls.some((c) => c.auth === null)).toBe(true);
    expect(body.grid.at(-1).d).toEqual([3, 3, 3, 3, 3, 3, 3]);
  });
});

describe('/api/devfeed with no devFeed configured', () => {
  it('404s rather than answering an empty feed', async () => {
    vi.doMock('../site.config.js', async (importOriginal) => {
      const actual = await importOriginal();
      const { devFeed, ...rest } = actual.default;
      return { default: Object.freeze(rest) };
    });
    vi.resetModules();
    const fresh = await import('../src/api/devfeed.js');
    const url = new URL('https://example.com/api/devfeed');
    const res = await fresh.handleDevFeed(new Request(url), {}, url, ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    vi.doUnmock('../site.config.js');
    vi.resetModules();
  });
});

// ---- Where the payload LIVES ------------------------------------------------
//
// ⚠️ THE BUG THESE ARE WRITTEN AGAINST WAS A LIFETIME BUG, NOT A LOGIC BUG.
// Everything above pins the stale-while-revalidate *logic*, and that logic was
// always correct: a warm entry served without fetching, a stale one refreshed
// in the background. What nothing tested was how long the thing being cached
// survived. The key carried the deploy id, every push to `main` is a deploy,
// and a changed key is a purge — so the first visitor after every deploy paid
// for a full GitHub rebuild. Measured live on 2026-09-20: 5.2s cold against
// 0.2s warm, and the owner, who visits /dev *because* they just deployed, hit
// it every single time.
//
// A suite can hold a cache warm across a hundred assertions; only a deploy
// throws it away, and there are no deploys in a test run. So these fake BOTH
// tiers and change the deploy id by hand.
// Log: docs/maintenance/2026-09-20-devfeed-cold-after-every-deploy.md

/** A KV namespace that records what was read and written. */
function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    puts: [],
    async get(key, type) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      this.puts.push(key);
      store.set(key, value);
    },
    _raw: store,
  };
}

/** `caches.default`, enough of it. Keys by URL, the way the real one does. */
function fakeCaches(seed = {}) {
  const store = new Map(Object.entries(seed));
  const api = {
    puts: [],
    async match(key) {
      const k = key && key.url ? key.url : String(key);
      const body = store.get(k);
      return body === undefined ? null : new Response(body);
    },
    async put(key, res) {
      const k = key && key.url ? key.url : String(key);
      api.puts.push(k);
      store.set(k, await res.text());
    },
    _raw: store,
  };
  return api;
}

const ORIGIN = 'https://example.com';
const COLO_KEY = _internals.CACHE_KEY(ORIGIN);

/** A believable stored payload, `ageMs` old and built by deploy `deploy`. */
function storedPayload({ ageMs = 0, deploy = 'v0', extra = {} } = {}) {
  return JSON.stringify({
    ok: true,
    ts: Date.now() - ageMs,
    deploy,
    grid: [{ w: 1758326400, d: [1, 1, 1, 1, 1, 1, 1] }],
    log: [{ repo: 'loud', date: '2026-09-19T00:00:00Z', msg: 'stored', url: '' }],
    ...extra,
  });
}

/** Collect the background work instead of dropping it, then await it. */
function collectingCtx() {
  const pending = [];
  return { waitUntil: (p) => pending.push(p), settle: () => Promise.all(pending) };
}

/** A GitHub that answers only when told to.
 *
 * ⚠️ COUNTING CALLS DOES NOT PROVE THE RESPONSE DIDN'T WAIT. `ctx.waitUntil(p)`
 * receives a promise that has ALREADY started — the refresh runs up to its
 * first await before `waitUntil` is even called — so the request count is
 * non-zero by the time the handler returns, and asserting it was zero fails
 * against code that is behaving perfectly. The honest question is whether the
 * response is reachable while the build is still outstanding, so this hangs
 * every call until `release()` and the assertion is simply that the handler
 * resolved anyway. */
function hangingGitHub() {
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  vi.stubGlobal('fetch', async (input) => {
    calls += 1;
    await gate;
    return String(input).includes('stats/commit_activity')
      ? new Response(JSON.stringify(activity(1758326400, 2)), { status: 200 })
      : new Response('[]', { status: 200 });
  });
  return { release: () => release(), get calls() { return calls; } };
}

describe('/api/devfeed storage — the payload outlives the deploy', () => {
  beforeEach(() => vi.restoreAllMocks());

  // THE FIX, in one assertion. A payload in KV answers the request without a
  // single call to GitHub, whatever this datacenter has or hasn't got.
  it('serves the stored payload without touching GitHub when the colo is cold', async () => {
    vi.stubGlobal('caches', { default: fakeCaches() }); // cold datacenter
    const kv = fakeKV({ [_internals.KV_KEY]: storedPayload() });
    let github = 0;
    vi.stubGlobal('fetch', async () => { github += 1; return new Response('[]', { status: 200 }); });

    const url = new URL(`${ORIGIN}/api/devfeed`);
    const res = await handleDevFeed(new Request(url), { SUBSCRIBERS: kv }, url, ctx);
    const body = await res.json();

    expect(github).toBe(0);
    expect(body.log[0].msg).toBe('stored');
  });

  // ...and the datacenter that had to fall back to KV gets its own copy, or
  // every visitor routed there pays the KV read forever.
  it('writes the colo cache through after a KV hit', async () => {
    const cache = fakeCaches();
    vi.stubGlobal('caches', { default: cache });
    const kv = fakeKV({ [_internals.KV_KEY]: storedPayload() });
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));

    const url = new URL(`${ORIGIN}/api/devfeed`);
    const local = collectingCtx();
    await handleDevFeed(new Request(url), { SUBSCRIBERS: kv }, url, local);
    await local.settle();

    expect(cache.puts).toContain(COLO_KEY);
  });

  // THE REGRESSION GUARD. Derived, not restated: whatever the key is, it must
  // not change when the deploy id does — that equality IS the bug's absence.
  it('keys the colo cache by origin alone, never by deploy id', async () => {
    const a = _internals.CACHE_KEY(ORIGIN);
    const b = _internals.CACHE_KEY(ORIGIN);
    expect(a).toBe(b);
    expect(a).not.toMatch(/deploy|version/i);
    // And the handler agrees: the SAME entry is found under two deploy ids.
    const cache = fakeCaches({ [COLO_KEY]: storedPayload({ deploy: 'dep-1' }) });
    vi.stubGlobal('caches', { default: cache });
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));
    const url = new URL(`${ORIGIN}/api/devfeed`);
    const env = { CF_VERSION_METADATA: { id: 'dep-1' } };
    const first = await (await handleDevFeed(new Request(url), env, url, ctx)).json();
    env.CF_VERSION_METADATA = { id: 'dep-2' }; // a deploy happened
    const second = await (await handleDevFeed(new Request(url), env, url, ctx)).json();
    expect(second.log[0].msg).toBe(first.log[0].msg);
  });

  // The property the deploy-keyed key was protecting, kept — and moved off the
  // request path. A payload built by code that is no longer running is served
  // AS IS, instantly, and the rebuild happens behind the response.
  it('serves a superseded payload while the rebuild is still outstanding', async () => {
    const cache = fakeCaches({ [COLO_KEY]: storedPayload({ deploy: 'old-deploy' }) });
    vi.stubGlobal('caches', { default: cache });
    const kv = fakeKV();
    const gh = hangingGitHub();

    const url = new URL(`${ORIGIN}/api/devfeed`);
    const env = { SUBSCRIBERS: kv, CF_VERSION_METADATA: { id: 'new-deploy' } };
    const local = collectingCtx();

    // GitHub has not answered and will not until we say so. The response
    // arrives anyway — which is the entire five seconds, gone.
    const body = await (await handleDevFeed(new Request(url), env, url, local)).json();
    expect(body.log[0].msg).toBe('stored');

    // ...and the rebuild it scheduled is real, not skipped.
    gh.release();
    await local.settle();
    expect(gh.calls).toBeGreaterThan(0);
    expect(kv.puts).toContain(_internals.KV_KEY);
  });

  // A fresh payload from the CURRENT deploy is left alone — no refresh, no
  // redundant write. Without this the check above could pass by rebuilding on
  // every single request, which is the old cost wearing a new shape.
  it('leaves a current, fresh payload entirely alone', async () => {
    const cache = fakeCaches({ [COLO_KEY]: storedPayload({ deploy: 'dep-1' }) });
    vi.stubGlobal('caches', { default: cache });
    const kv = fakeKV();
    let github = 0;
    vi.stubGlobal('fetch', async () => { github += 1; return new Response('[]', { status: 200 }); });

    const url = new URL(`${ORIGIN}/api/devfeed`);
    const local = collectingCtx();
    await handleDevFeed(new Request(url), { SUBSCRIBERS: kv, CF_VERSION_METADATA: { id: 'dep-1' } }, url, local);
    await local.settle();

    expect(github).toBe(0);
    expect(kv.puts).toEqual([]);
    expect(cache.puts).toEqual([]);
  });

  // Age still triggers a rebuild, and it is still background work.
  it('refreshes a payload older than the freshness window, behind the response', async () => {
    const cache = fakeCaches({
      [COLO_KEY]: storedPayload({ ageMs: _internals.FRESH_MS + 1000, deploy: 'dep-1' }),
    });
    vi.stubGlobal('caches', { default: cache });
    const kv = fakeKV();
    const gh = hangingGitHub();

    const url = new URL(`${ORIGIN}/api/devfeed`);
    const local = collectingCtx();
    const body = await (await handleDevFeed(
      new Request(url), { SUBSCRIBERS: kv, CF_VERSION_METADATA: { id: 'dep-1' } }, url, local
    )).json();

    expect(body.log[0].msg).toBe('stored');
    gh.release();
    await local.settle();
    expect(gh.calls).toBeGreaterThan(0);
  });

  // A build writes the durable tier, which is the only reason any of the above
  // works a day and four deploys later.
  it('a build writes KV, not just the datacenter it happened in', async () => {
    const cache = fakeCaches();
    vi.stubGlobal('caches', { default: cache });
    const kv = fakeKV();
    vi.stubGlobal('fetch', async (input) => (
      String(input).includes('stats/commit_activity')
        ? new Response(JSON.stringify(activity(1758326400, 1)), { status: 200 })
        : new Response('[]', { status: 200 })
    ));

    const url = new URL(`${ORIGIN}/api/devfeed`);
    await handleDevFeed(new Request(url), { SUBSCRIBERS: kv }, url, ctx);

    expect(kv.puts).toContain(_internals.KV_KEY);
    expect(cache.puts).toContain(COLO_KEY);
    expect(JSON.parse(kv._raw.get(_internals.KV_KEY)).grid.length).toBe(52);
  });

  // The daily cron is what keeps the page warm for the first visitor rather
  // than because of them — so it has to write the copy that is still there
  // tomorrow. Writing only the colo it ran in is what it used to do, and that
  // entry was orphaned by the next push.
  it('the cron warm writes the durable copy', async () => {
    vi.stubGlobal('caches', { default: fakeCaches() });
    const kv = fakeKV();
    vi.stubGlobal('fetch', async (input) => (
      String(input).includes('stats/commit_activity')
        ? new Response(JSON.stringify(activity(1758326400, 1)), { status: 200 })
        : new Response('[]', { status: 200 })
    ));

    await warmDevFeed({ SUBSCRIBERS: kv });
    expect(kv.puts).toContain(_internals.KV_KEY);
  });

  // A KV binding that throws must not take the endpoint down with it — a fork
  // mid-setup, or a namespace that has not been created yet.
  it('still answers when KV is unavailable', async () => {
    vi.stubGlobal('caches', { default: fakeCaches() });
    const kv = {
      async get() { throw new Error('no namespace'); },
      async put() { throw new Error('no namespace'); },
    };
    vi.stubGlobal('fetch', async (input) => (
      String(input).includes('stats/commit_activity')
        ? new Response(JSON.stringify(activity(1758326400, 1)), { status: 200 })
        : new Response('[]', { status: 200 })
    ));

    const url = new URL(`${ORIGIN}/api/devfeed`);
    const res = await handleDevFeed(new Request(url), { SUBSCRIBERS: kv }, url, ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.grid.length).toBe(52);
  });
});
