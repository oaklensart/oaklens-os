// The empty-overwrite guard, on the day it matters (src/api/publish.js).
//
// The guard exists because a real publish blanked data/posts.json 12 → 0 on
// 2026-07-10. To decide, it reads each suspect manifest's current content from
// main — and every failure of that read was caught and recorded as `null`,
// which _emptyOverwriteGuard reads as "absent on main, nothing to protect".
//
// So the one condition that makes the guard fire — something anomalous
// happening — was also the condition that disabled it. A rate limit or a
// GitHub 5xx during the read meant the empty manifest sailed through, and the
// guard reported nothing wrong. A safety check that fails open is a safety
// check that is missing on exactly the day you needed it.
//
// These pin the distinction: a genuine 404 is information ("the file really
// isn't on main"), anything else is the absence of information.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

const SECRET = 'test-secret-please-ignore';
const ctx = { waitUntil() {} };
const env = { SESSION_SECRET: SECRET, GITHUB_TOKEN: 'gh-token', GITHUB_REPO: 'owner/repo' };

afterEach(() => { vi.restoreAllMocks(); });

async function publishReq(body) {
  const token = await createToken(env);
  return new Request('https://example.com/api/publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/**
 * Stubs the GitHub endpoints a publish touches. `contents` decides how the
 * guard's read of data/posts.json answers: a Response, or a thrown network
 * error — the two shapes a real outage takes.
 */
function stubGitHub({ contents, commits = true } = {}) {
  const seen = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/contents/')) {
      if (typeof contents === 'function') return contents(u);
      return contents;
    }
    if (!commits) throw new Error('commit path should not be reached');
    if (u.includes('git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'HEAD_SHA' } }), { status: 200 });
    }
    if (u.includes('git/commits/')) return new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 });
    if (u.endsWith('/git/blobs')) return new Response(JSON.stringify({ sha: 'b' }), { status: 200 });
    if (u.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: 'nt' }), { status: 200 });
    if (u.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: 'new-commit-sha' }), { status: 200 });
    if (u.includes('git/refs/heads/main')) return new Response(JSON.stringify({}), { status: 200 });
    throw new Error(`unexpected fetch: ${u}`);
  });
  return seen;
}

const emptyManifest = { path: 'data/posts.json', content: '[]' };
const publishEmpty = () => publishReq({ files: [emptyManifest], baseSha: 'HEAD_SHA' });

describe('empty-overwrite guard — a real 404 is information', () => {
  it('proceeds when the manifest is genuinely absent on main', async () => {
    // Nothing to protect: a fresh fork publishing its first (empty) manifest.
    stubGitHub({ contents: new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }) });
    const res = await worker.fetch(await publishEmpty(), env, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).sha).toBe('new-commit-sha');
  });

  it('still blocks a real wipe (the incident this guard was built for)', async () => {
    stubGitHub({
      contents: new Response(JSON.stringify({ content: b64(JSON.stringify([{ id: 'a' }, { id: 'b' }])) }), { status: 200 }),
    });
    const res = await worker.fetch(await publishEmpty(), env, ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('empty_overwrite_blocked');
  });
});

describe('empty-overwrite guard — anything else is the absence of information', () => {
  // Each of these used to be swallowed as "absent on main" and the empty
  // manifest was committed over live content.
  const outages = [
    ['a 403 rate limit', new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 })],
    ['a 500 from GitHub', new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 })],
    ['a 502 from GitHub', new Response('', { status: 502 })],
    ['an unparseable body', new Response('<html>maintenance</html>', { status: 503 })],
  ];

  it.each(outages)('refuses the publish on %s', async (_label, response) => {
    const seen = stubGitHub({ contents: response, commits: false });
    const res = await worker.fetch(await publishEmpty(), env, ctx);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('guard_check_failed');
    expect(body.paths).toEqual(['data/posts.json']);
    expect(body.error, 'tells the author nothing was committed').toMatch(/publish again|retry|Nothing was committed/i);
    expect(seen.some((u) => u.includes('/git/')), 'no commit may be attempted').toBe(false);
  });

  it('does not commit the empty manifest while main is unreadable', async () => {
    // The other cases prove no commit is *attempted*; this one lets the commit
    // path work, so the failure against the old code is the incident itself —
    // a blank data/posts.json committed to main during a GitHub wobble, with
    // the guard reporting nothing wrong.
    const seen = stubGitHub({
      contents: new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 }),
    });
    const res = await worker.fetch(await publishEmpty(), env, ctx);

    expect(res.status, 'an unverifiable empty publish must not return 200').toBe(503);
    expect(seen.some((u) => u.endsWith('/git/blobs')), 'the blank manifest was written as a blob').toBe(false);
    expect(seen.some((u) => u.includes('git/refs/heads/main')), 'main was moved onto the blank manifest').toBe(false);
  });

  it('refuses the publish when the request never completes at all', async () => {
    const seen = stubGitHub({
      contents: () => { throw new TypeError('network error'); },
      commits: false,
    });
    const res = await worker.fetch(await publishEmpty(), env, ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('guard_check_failed');
    expect(seen.some((u) => u.includes('/git/'))).toBe(false);
  });

  it('one unreadable manifest holds the whole publish, even when another reads fine', async () => {
    // The commit is atomic, so a partial verdict is no verdict.
    stubGitHub({
      contents: (u) => (u.includes('posts.json')
        ? new Response(JSON.stringify({ message: 'rate limited' }), { status: 403 })
        : new Response(JSON.stringify({ content: b64('[]') }), { status: 200 })),
      commits: false,
    });
    const res = await worker.fetch(await publishReq({
      files: [emptyManifest, { path: 'data/barrel.json', content: '[]' }],
      baseSha: 'HEAD_SHA',
    }), env, ctx);

    expect(res.status).toBe(503);
    expect((await res.json()).paths).toEqual(['data/posts.json']);
  });

  it('a normal non-empty publish never pays for any of this', async () => {
    // The guard only reads main when an incoming manifest is actually empty;
    // failing closed must not put a GitHub round-trip on the happy path.
    const seen = stubGitHub({ contents: new Response('', { status: 500 }) });
    const res = await worker.fetch(await publishReq({
      files: [{ path: 'data/posts.json', content: '[{"id":"a"}]' }],
      baseSha: 'HEAD_SHA',
    }), env, ctx);

    expect(res.status).toBe(200);
    expect(seen.some((u) => u.includes('/contents/')), 'no guard read on a non-empty publish').toBe(false);
  });
});

describe('GET /api/sync — a missing headSha is announced, not silent', () => {
  // `refOk` is the git-refs endpoint; `commitsOk` is the commits/main fallback.
  // Both down is the only combination that leaves the snapshot without a base.
  function stubSync({ refOk, commitsOk = false }) {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      seen.push(u);
      if (u.includes('git/ref/heads/main')) {
        return refOk
          ? new Response(JSON.stringify({ object: { sha: 'HEAD_SHA' } }), { status: 200 })
          : new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 });
      }
      if (u.includes('/commits/main')) {
        return commitsOk
          ? new Response(JSON.stringify({ sha: 'HEAD_SHA' }), { status: 200 })
          : new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 });
      }
      if (u.includes('/contents/')) {
        return new Response(JSON.stringify({ content: b64('[]') }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    return seen;
  }

  const syncReq = async () => new Request('https://example.com/api/sync?files=data/posts.json', {
    headers: { Authorization: `Bearer ${await createToken(env)}` },
  });

  it('flags the snapshot when main HEAD could not be read', async () => {
    // headSha null means the next publish carries no baseSha, which disarms
    // the stale-base guard for that snapshot. The sync still succeeds — the
    // files are good — but the console has to be able to say so.
    stubSync({ refOk: false, commitsOk: false });
    const res = await worker.fetch(await syncReq(), env, ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok, 'the sync itself must not fail over this').toBe(true);
    expect(body.files['data/posts.json'].ok).toBe(true);
    expect(body.headSha).toBeNull();
    expect(body.staleBaseGuard).toBe('disarmed');
    expect(body.headShaError).toBeTruthy();
  });

  it('says nothing when the HEAD read succeeds', async () => {
    stubSync({ refOk: true });
    const body = await (await worker.fetch(await syncReq(), env, ctx)).json();
    expect(body.headSha).toBe('HEAD_SHA');
    expect(body.staleBaseGuard).toBeUndefined();
    expect(body.headShaError).toBeUndefined();
  });

  it('falls back to commits/main when the refs endpoint blinks', async () => {
    // The live case (2026-08-17): eight manifests read fine and only the refs
    // call failed. One endpoint being down is not the same as GitHub being
    // down, and the guard should not be disarmed for it.
    const seen = stubSync({ refOk: false, commitsOk: true });
    const body = await (await worker.fetch(await syncReq(), env, ctx)).json();
    expect(body.headSha).toBe('HEAD_SHA');
    expect(body.staleBaseGuard, 'the guard stays armed').toBeUndefined();
    expect(body.headShaError).toBeUndefined();
    expect(seen.some((u) => u.includes('/commits/main'))).toBe(true);
  });

  it('does not spend the fallback call when the refs endpoint works', async () => {
    const seen = stubSync({ refOk: true });
    await worker.fetch(await syncReq(), env, ctx);
    expect(seen.some((u) => u.includes('/commits/main'))).toBe(false);
  });

  it('reports the refs error, not the fallback\'s, when both are down', async () => {
    // The refs call is the one that describes what we meant to do; leading with
    // the fallback's failure would send a reader after the wrong endpoint.
    stubSync({ refOk: false, commitsOk: false });
    const body = await (await worker.fetch(await syncReq(), env, ctx)).json();
    expect(body.headSha).toBeNull();
    expect(body.headShaError).toMatch(/rate limit/i);
  });

  it('names the repo it asked GitHub for', async () => {
    // When every read 404s, "Not Found" alone is undebuggable; the console
    // needs to be able to say "the worker asked for github.com/<this>" so a
    // mistyped GITHUB_REPO secret (cold run 4) is visible from the console.
    stubSync({ refOk: true });
    const body = await (await worker.fetch(await syncReq(), env, ctx)).json();
    expect(body.repo).toBe('owner/repo');
  });
});
