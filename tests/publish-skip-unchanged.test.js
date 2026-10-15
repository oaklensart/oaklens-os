// A publish uploads only the files that changed (2026-10-14).
//
// The console sends every manifest and post on every publish (~20 files), and
// the Worker used to turn each into a GitHub blob POST — twenty writes for a
// one-frame change, all against GitHub's content-creation limit. On weak Wi-Fi
// the owner's publish outran the console's deadline three times running. Now
// the Worker compares each file's git blob id with main's tree and leaves the
// matches to base_tree. Held here: the skip is exact (git's own hash), a miss
// in the comparison degrades to the old upload-everything, and a publish with
// nothing new makes no commit.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import worker from '../worker.js';
import { _gitBlobSha } from '../src/api/publish.js';
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

const POSTS = '[{"id":"a"}]';
const FN0 = '# fn-000\n\nfirst note ▲\n';

// main holds data/posts.json and posts/fn-000.md with the contents above.
// Records every write so a test can say exactly what was sent.
async function stubGitHub({ treeFails = false } = {}) {
  const shaPosts = await _gitBlobSha(POSTS);
  const shaFn0 = await _gitBlobSha(FN0);
  const writes = { blobs: [], trees: [], commits: 0, patches: 0 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init = {}) => {
    const u = String(url);
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes('git/ref/heads/main')) return ok({ object: { sha: 'HEAD' } });
    if (u.includes('git/commits/HEAD')) return ok({ tree: { sha: 'ROOT' } });
    if (u.endsWith('git/trees/ROOT')) {
      if (treeFails) return new Response('{"message":"Server Error"}', { status: 502 });
      return ok({ tree: [
        { path: 'data', type: 'tree', sha: 'DATA' },
        { path: 'posts', type: 'tree', sha: 'POSTS' },
        { path: 'index.html', type: 'blob', sha: 'x' },
      ], truncated: false });
    }
    if (u.endsWith('git/trees/DATA')) return ok({ tree: [{ path: 'posts.json', type: 'blob', sha: shaPosts }] });
    if (u.endsWith('git/trees/POSTS')) return ok({ tree: [{ path: 'fn-000.md', type: 'blob', sha: shaFn0 }] });
    if (u.endsWith('/git/blobs')) {
      writes.blobs.push(JSON.parse(init.body));
      return ok({ sha: `blob-${writes.blobs.length}` });
    }
    if (u.endsWith('/git/trees')) {
      writes.trees.push(JSON.parse(init.body));
      return ok({ sha: 'NEW_TREE' });
    }
    if (u.endsWith('/git/commits')) { writes.commits++; return ok({ sha: 'NEW_COMMIT' }); }
    if (u.includes('git/refs/heads/main') && init.method === 'PATCH') { writes.patches++; return ok({}); }
    throw new Error(`unexpected fetch: ${u}`);
  });
  return writes;
}

describe('_gitBlobSha', () => {
  it('is git\'s own blob id, byte for byte (UTF-8 included)', async () => {
    for (const s of ['', POSTS, FN0, 'café\r\nno trailing newline']) {
      const git = execFileSync('git', ['hash-object', '--stdin'], { input: s }).toString().trim();
      expect(await _gitBlobSha(s)).toBe(git);
    }
  });
});

describe('POST /api/publish — only changed files are uploaded', () => {
  it('skips files identical to main and uploads the rest', async () => {
    const writes = await stubGitHub();
    const res = await worker.fetch(await publishReq({ baseSha: 'HEAD', files: [
      { path: 'data/posts.json', content: POSTS },                    // unchanged
      { path: 'posts/fn-000.md', content: FN0 },                       // unchanged
      { path: 'data/buffer.json', content: '[{"id":"f1"}]' },          // new on main
      { path: 'posts/fn-001.md', content: '# fn-001\n' },              // new file
    ] }), env, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).sha).toBe('NEW_COMMIT');
    expect(writes.blobs).toHaveLength(2);
    expect(writes.trees[0].base_tree).toBe('ROOT');
    expect(writes.trees[0].tree.map((t) => t.path)).toEqual(['data/buffer.json', 'posts/fn-001.md']);
  });

  it('uploads a file whose content changed', async () => {
    const writes = await stubGitHub();
    await worker.fetch(await publishReq({ baseSha: 'HEAD', files: [
      { path: 'data/posts.json', content: '[{"id":"a"},{"id":"b"}]' },
      { path: 'posts/fn-000.md', content: FN0 },
    ] }), env, ctx);
    expect(writes.trees[0].tree.map((t) => t.path)).toEqual(['data/posts.json']);
  });

  it('nothing changed → no writes at all, and main\'s head comes back', async () => {
    const writes = await stubGitHub();
    const res = await worker.fetch(await publishReq({ baseSha: 'HEAD', files: [
      { path: 'data/posts.json', content: POSTS },
      { path: 'posts/fn-000.md', content: FN0 },
    ] }), env, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).sha).toBe('HEAD');
    expect(writes).toEqual({ blobs: [], trees: [], commits: 0, patches: 0 });
  });

  it('cannot read main\'s tree → uploads every file, exactly as before', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writes = await stubGitHub({ treeFails: true });
    const res = await worker.fetch(await publishReq({ baseSha: 'HEAD', files: [
      { path: 'data/posts.json', content: POSTS },
      { path: 'posts/fn-000.md', content: FN0 },
    ] }), env, ctx);
    expect(res.status).toBe(200);
    expect(writes.blobs).toHaveLength(2);
    expect(writes.commits).toBe(1);
    expect(writes.patches).toBe(1);
  });
});
