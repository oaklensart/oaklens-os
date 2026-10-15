// Two public answers that every homepage visit asks for, and what they cost.
//
// Maintenance review 2026-10-15, W1 + W5:
//   · /api/buffer-summary built a new Intl.DateTimeFormat inside a sort
//     comparator — 7,383 of them per request on this site's 731 frames, about
//     half a second of CPU against the free plan's 10 ms. The timing test below
//     runs on the site's real buffer.json when the checkout has one.
//   · neither it nor /api/pulse was cached anywhere but the visitor's browser:
//     a Worker's response never passes through Cloudflare's CDN cache, so each
//     new visitor recomputed the summary and read D1. Both now keep their answer
//     in the colo cache — the summary under the deploy token, the pulse for 30s.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { localDay } from '../src/shared/text.js';
import {
  handleBufferSummary, _featuredRawFrames, _summaryCacheUrl,
} from '../src/api/site-meta.js';
import { handleGetPulse, handlePostPulse, handleDeletePulse, _pulseCacheUrl } from '../src/api/pulse.js';
import { createToken, _resetSessionSecretCache } from '../src/shared/auth.js';

const ROOT = join(import.meta.dirname, '..');
const ORIGIN = 'https://example.com';

// A Map-backed stand-in for caches.default: enough of the API for match/put/
// delete, storing bodies as text so a hit is a fresh Response every time.
function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const hit = store.get(typeof req === 'string' ? req : req.url);
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
    },
    async put(req, res) {
      store.set(typeof req === 'string' ? req : req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) });
    },
    async delete(req) {
      return store.delete(typeof req === 'string' ? req : req.url);
    },
  };
}

let cache;
beforeEach(() => { cache = fakeCache(); globalThis.caches = { default: cache }; });
afterEach(() => { delete globalThis.caches; });

// ctx that remembers what was deferred, so a test can wait for the cache write.
function makeCtx() {
  const pending = [];
  return { pending, waitUntil(p) { pending.push(p); }, settle: () => Promise.all(pending) };
}

function bufferEnv(entries, versionId = 'deploy-1') {
  const env = {
    assetReads: 0,
    CF_VERSION_METADATA: versionId ? { id: versionId } : undefined,
    ASSETS: {
      async fetch() {
        env.assetReads += 1;
        return new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json' } });
      },
    },
  };
  return env;
}

const ENTRIES = [
  { id: 'A', captured_at: '2025-01-01T12:00:00.000Z', filename: 'a.webp' },
  { id: 'B', captured_at: '2025-01-02T12:00:00.000Z', filename: 'b.webp', featured: true },
];

describe('W1: the summary costs milliseconds, not half a second', () => {
  it('localDay formats with a kept formatter (thousands of calls stay cheap)', () => {
    const t = performance.now();
    for (let i = 0; i < 5000; i += 1) localDay('2026-09-08T05:12:00.000Z', 'America/Los_Angeles');
    // ~80 µs each when a formatter is built per call: 5,000 calls ≈ 400 ms.
    expect(performance.now() - t).toBeLessThan(100);
  });

  it('numbers the real buffer well inside the budget', () => {
    const f = join(ROOT, 'data', 'buffer.json');
    const real = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
    // A fork's checkout may carry no buffer; a synthetic one of the same size
    // stands in, spread over evenings so day keys differ by zone.
    const arr = real.length >= 200 ? real : Array.from({ length: 731 }, (_, i) => ({
      id: `f${i}`, filename: `IMG_${String(i).padStart(4, '0')}.jpg`,
      captured_at: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 7), 3 + (i % 7))).toISOString(),
    }));
    const t = performance.now();
    _featuredRawFrames(arr);
    // Was 537–596 ms on 731 frames. Generous for a slow CI box.
    expect(performance.now() - t).toBeLessThan(150);
  });

  it('an invalid zone still degrades to the UTC slice, every call', () => {
    expect(localDay('2026-09-08T05:12:00.000Z', 'Not/AZone')).toBe('2026-09-08');
    expect(localDay('2026-09-08T05:12:00.000Z', 'Not/AZone')).toBe('2026-09-08');
    expect(localDay('not a date T', 'UTC')).toBe('not a date');
  });
});

describe('W5: /api/buffer-summary is kept at the edge, keyed by the deploy', () => {
  it('computes once, then answers from the colo cache', async () => {
    const env = bufferEnv(ENTRIES);
    const ctx = makeCtx();
    const first = await handleBufferSummary(new Request(`${ORIGIN}/api/buffer-summary`), env, ctx);
    await ctx.settle();
    expect(cache.store.has(_summaryCacheUrl(ORIGIN, env))).toBe(true);
    // Drop the data cache too, so a second compute would have to read assets.
    for (const k of [...cache.store.keys()]) if (k.includes('__datacache')) cache.store.delete(k);
    const reads = env.assetReads;
    const second = await handleBufferSummary(new Request(`${ORIGIN}/api/buffer-summary`), env, makeCtx());
    expect(env.assetReads).toBe(reads);
    expect(await second.json()).toEqual(await first.json());
    // The browser half of the contract is unchanged.
    expect(second.headers.get('Cache-Control')).toContain('max-age=60');
  });

  it('a new deploy is a new key, never a stale answer', async () => {
    const ctx = makeCtx();
    await handleBufferSummary(new Request(`${ORIGIN}/api/buffer-summary`), bufferEnv(ENTRIES, 'deploy-1'), ctx);
    await ctx.settle();
    const next = bufferEnv([...ENTRIES, { id: 'C', captured_at: '2025-01-03T12:00:00.000Z', filename: 'c.webp' }], 'deploy-2');
    const res = await handleBufferSummary(new Request(`${ORIGIN}/api/buffer-summary`), next, makeCtx());
    expect((await res.json()).frames).toBe(3);
  });

  it('an instance with no version binding keeps it only briefly', async () => {
    const env = bufferEnv(ENTRIES, null);
    const ctx = makeCtx();
    await handleBufferSummary(new Request(`${ORIGIN}/api/buffer-summary`), env, ctx);
    await ctx.settle();
    expect(cache.store.get(_summaryCacheUrl(ORIGIN, env)).headers['cache-control']).toBe('public, max-age=300');
  });

  it('a failed read is answered but never cached', async () => {
    const env = { ASSETS: { async fetch() { return new Response('boom', { status: 500 }); } } };
    const ctx = makeCtx();
    const res = await handleBufferSummary(new Request(`${ORIGIN}/api/buffer-summary`), env, ctx);
    await ctx.settle();
    expect((await res.json()).frames).toBe(0);
    expect(cache.store.has(_summaryCacheUrl(ORIGIN, env))).toBe(false);
  });
});

describe('W5: /api/pulse is kept at the edge for 30 seconds', () => {
  const row = (over = {}) => ({
    id: 'p1', text: 'out shooting', glyphs: '', state: 'live', foot_left: '', foot_right: '',
    local_time: '', posted_at: Date.now() - 1000, expires_at: Date.now() + 3600_000, ...over,
  });
  function dbEnv(result) {
    const env = {
      reads: 0,
      SESSION_SECRET: 'test-secret-for-pulse-cache-0123456789',
      DB: {
        prepare() {
          const stmt = {
            bind: () => stmt,
            first: async () => { env.reads += 1; if (result instanceof Error) throw result; return result; },
            run: async () => ({ meta: { changes: 1 } }),
          };
          return stmt;
        },
        batch: async () => [],
      },
    };
    return env;
  }

  it('a second visitor does not read D1', async () => {
    const env = dbEnv(row());
    const ctx = makeCtx();
    await handleGetPulse(new Request(`${ORIGIN}/api/pulse`), env, ctx);
    await ctx.settle();
    const res = await handleGetPulse(new Request(`${ORIGIN}/api/pulse`), env, makeCtx());
    expect(env.reads).toBe(1);
    expect((await res.json()).pulse.text).toBe('out shooting');
  });

  it('never keeps a pulse past its own expiry', async () => {
    const env = dbEnv(row({ expires_at: Date.now() + 5_000 }));
    const ctx = makeCtx();
    await handleGetPulse(new Request(`${ORIGIN}/api/pulse`), env, ctx);
    await ctx.settle();
    const maxAge = Number(/max-age=(\d+)/.exec(cache.store.get(_pulseCacheUrl(ORIGIN)).headers['cache-control'])[1]);
    expect(maxAge).toBeLessThanOrEqual(5);
  });

  it('a failed read is not cached', async () => {
    const env = dbEnv(new Error('no such table: pulses'));
    const ctx = makeCtx();
    await handleGetPulse(new Request(`${ORIGIN}/api/pulse`), env, ctx);
    await ctx.settle();
    expect(cache.store.has(_pulseCacheUrl(ORIGIN))).toBe(false);
  });

  it('posting and taking down purge the author’s colo', async () => {
    _resetSessionSecretCache();
    const env = dbEnv(row());
    const token = await createToken(env);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    for (const send of [
      () => handlePostPulse(new Request(`${ORIGIN}/api/pulse`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'new' }) }), env),
      () => handleDeletePulse(new Request(`${ORIGIN}/api/pulse`, { method: 'DELETE', headers: auth }), env),
    ]) {
      cache.store.set(_pulseCacheUrl(ORIGIN), { body: '{"pulse":null}', headers: {} });
      const res = await send();
      expect(res.status).toBe(200);
      expect(cache.store.has(_pulseCacheUrl(ORIGIN))).toBe(false);
    }
  });
});

describe('W6: one dev-feed rebuild at a time', () => {
  it('concurrent callers share the running rebuild', async () => {
    const { refreshDevFeed } = await import('../src/api/devfeed.js');
    const env = {};
    const a = refreshDevFeed(ORIGIN, env, null);
    const b = refreshDevFeed(ORIGIN, env, null);
    expect(b).toBe(a);
    await a;
    // …and the next one, after it settles, is a fresh rebuild.
    const c = refreshDevFeed(ORIGIN, env, null);
    expect(c).not.toBe(a);
    await c;
  });
});
