// A manifest over 1 MB (maintenance review 2026-10-15, L1).
//
// GitHub's contents API inlines a file only up to 1 MB. Between 1 and 100 MB it
// answers `content: ''` with `encoding: 'none'`. Both readers decoded that as
// an empty string: sync reported the file as broken on every device, and the
// empty-overwrite guard could not parse main's copy and SKIPPED it — so an
// empty buffer.json would have replaced a full one, the 2026-07-10 incident the
// guard exists for. buffer.json grows ~250 bytes a frame and crosses 1 MB near
// 4,000 frames. Past the line, both now read the blob by its sha.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

const ctx = { waitUntil() {} };
const env = { SESSION_SECRET: 'test-secret-please-ignore', GITHUB_TOKEN: 'gh-token', GITHUB_REPO: 'owner/repo' };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

afterEach(() => { vi.restoreAllMocks(); });

const BIG = JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
// What the contents API says about a file it will not inline.
const tooBigToInline = { type: 'file', encoding: 'none', content: '', size: 1_500_000, sha: 'BLOBSHA' };

function stub({ contents, blob }) {
  const seen = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/contents/')) return contents(u);
    if (u.includes('/git/blobs/BLOBSHA')) return blob();
    if (u.includes('git/ref/heads/main')) return json({ object: { sha: 'abc1234' } });
    if (u.includes('git/commits/')) return json({ tree: { sha: 't' } });
    if (u.endsWith('/git/blobs')) return json({ sha: 'b' });
    if (u.includes('/git/trees/')) return json({ tree: [] });
    if (u.endsWith('/git/trees')) return json({ sha: 'nt' });
    if (u.endsWith('/git/commits')) return json({ sha: 'new-commit' });
    if (u.includes('git/refs/heads/main')) return json({});
    throw new Error(`unexpected fetch: ${u}`);
  });
  return seen;
}

async function publish(body) {
  return worker.fetch(new Request('https://example.com/api/publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await createToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env, ctx);
}

describe('sync reads a manifest past 1 MB', () => {
  it('fetches the blob when the contents API inlines nothing', async () => {
    stub({ contents: () => json(tooBigToInline), blob: () => json({ encoding: 'base64', content: b64(BIG) }) });
    const res = await worker.fetch(new Request('https://example.com/api/sync?files=data/buffer.json', {
      headers: { Authorization: `Bearer ${await createToken(env)}` },
    }), env, ctx);
    const body = await res.json();
    expect(body.files['data/buffer.json']).toEqual({ ok: true, content: JSON.parse(BIG) });
  });
});

describe('the empty-overwrite guard past 1 MB', () => {
  const emptyBuffer = { files: [{ path: 'data/buffer.json', content: '[]' }], baseSha: 'abc1234' };

  it('still refuses to blank a full manifest', async () => {
    stub({ contents: () => json(tooBigToInline), blob: () => json({ encoding: 'base64', content: b64(BIG) }) });
    const res = await publish(emptyBuffer);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('empty_overwrite_blocked');
  });

  it('holds the publish when the blob cannot be read either', async () => {
    stub({ contents: () => json(tooBigToInline), blob: () => json({ message: 'boom' }, 500) });
    const res = await publish(emptyBuffer);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('guard_check_failed');
  });

  it('holds the publish when main\'s copy is not JSON, rather than skipping it', async () => {
    stub({ contents: () => json({ encoding: 'base64', content: b64('<<<not json'), sha: 'x', size: 11 }), blob: () => json({}) });
    const res = await publish(emptyBuffer);
    expect(res.status).toBe(503);
  });

  it('reads at the revision the publish is built on, not the movable ref=main', async () => {
    const seen = stub({ contents: () => json({ encoding: 'base64', content: b64(BIG), sha: 'x', size: BIG.length }), blob: () => json({}) });
    await publish(emptyBuffer);
    const read = seen.find((u) => u.includes('/contents/data/buffer.json'));
    expect(read).toContain('ref=abc1234');
  });

  it('a genuinely absent manifest is still "nothing to protect"', async () => {
    stub({ contents: () => json({ message: 'Not Found' }, 404), blob: () => json({}) });
    const res = await publish(emptyBuffer);
    expect(res.status).toBe(200);
  });
});

describe('the guard\'s edges', () => {
  const emptyBuffer = { files: [{ path: 'data/buffer.json', content: '[]' }], baseSha: 'abc1234' };

  it('a 404 from the BLOB read is unknown, not absent (the file exists)', async () => {
    stub({ contents: () => json(tooBigToInline), blob: () => json({ message: 'Not Found' }, 404) });
    const res = await publish(emptyBuffer);
    expect(res.status).toBe(503);
  });

  it('a zero-byte copy on main is nothing to protect', async () => {
    stub({ contents: () => json({ encoding: 'base64', content: '', sha: 'e', size: 0 }), blob: () => json({}) });
    const res = await publish(emptyBuffer);
    expect(res.status).toBe(200);
  });
});
