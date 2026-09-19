// getFrameOgData — the archive/buffer unfurl, and the probe cache behind it.
//
// This is the oldest and most-used OG path in the product: every shared frame
// link, from either surface, resolves through here. It had NO test at all until
// 2026-09-18 — flagged as a gap on 2026-09-13
// (docs/ideas/og-share-image-styles.md §8.4), then immediately exercised by a
// real defect on that exact path. tests/share-keys.test.js pins the key
// spelling and tests/og-tags.test.js pins the injector; nothing ran the
// resolver in between.
//
// THE DEFECT IT NOW PINS. _cardExists caches its R2 probe at the edge so repeat
// crawls skip the round-trip, and it used to cache BOTH answers for 300s. The
// two are not symmetric:
//
//   '1' goes stale when a stamp is DELETED  → the old card unfurls a few more
//                                             minutes. Harmless.
//   '0' goes stale when a stamp is PUBLISHED → the bare photograph is served to
//                                             crawlers that cache it for DAYS,
//                                             and many never re-crawl.
//
// Reported with six minutes of timestamped evidence: stamp published, link
// shared, unfurled as the plain photo, corrected itself only once the 300s
// lapsed. So the negative answer now expires in _OG_MISS_TTL.
// Log: docs/maintenance/2026-09-18-og-stamp-invisible-for-five-minutes.md
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFrameOgData, _frameImg, OG_IMG_WIDTH } from '../src/edge/chrome.js';
import { cdnBase } from '../src/shared/site.js';
import siteConfig from '../site.config.js';

const ORIGIN = 'https://example.test';

// A cache stand-in that KEEPS THE HEADERS. The usual stub in this suite stores
// response text only, which is exactly the field these tests are about.
let store;
let headCalls;
let _savedCaches;

function installCaches() {
  store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const k = typeof req === 'string' ? req : req.url;
        const hit = store.get(k);
        return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
      },
      async put(req, res) {
        const k = typeof req === 'string' ? req : req.url;
        store.set(k, { body: await res.text(), headers: Object.fromEntries(res.headers) });
      },
    },
  };
}

// `data/*.json` is read through env.ASSETS; the stamp probe through env.CDN.head.
// `stamped` is the set of R2 keys that exist.
function makeEnv({ archive = [], buffer = [], stamped = new Set() } = {}) {
  headCalls = [];
  return {
    ASSETS: {
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        if (path === '/data/archive.json') return new Response(JSON.stringify(archive));
        if (path === '/data/buffer.json') return new Response(JSON.stringify(buffer));
        return new Response('not found', { status: 404 });
      },
    },
    CDN: {
      head: async (key) => { headCalls.push(key); return stamped.has(key) ? { key } : null; },
    },
  };
}

const maxAgeOf = (key) => {
  const hit = store.get(`${ORIGIN}/__cardexists/${key}`);
  if (!hit) return null;
  const m = /max-age=(\d+)/.exec(hit.headers['cache-control'] || '');
  return m ? Number(m[1]) : null;
};

beforeEach(() => { _savedCaches = globalThis.caches; installCaches(); });
afterEach(() => { globalThis.caches = _savedCaches; });

const FRAME = { slug: 'a-frame', title: 'A Frame', sub: 'A Sub', location: 'Somewhere', filename: 'PIC_0001.jpg' };
const STAMP_KEY = 'meta/PIC_0001-og.webp';

describe('getFrameOgData — the archive branch', () => {
  it('resolves title, description and the canonical url off the entry', async () => {
    const env = makeEnv({ archive: [FRAME] });
    const og = await getFrameOgData(new URL(`${ORIGIN}/archive/?f=a-frame`), env, 'archive');
    // DERIVED from config, never spelled out: this repo carries an instance's
    // identity and a fork's is different, so a literal here would be red in
    // every fork (CLAUDE.md, Definition of Done §1).
    expect(og.title).toBe(`A Frame — ${siteConfig.name.toUpperCase()}`);
    expect(og.description).toBe('A Sub · Somewhere');
    expect(og.ogUrl).toBe(`${ORIGIN}/archive/?f=a-frame`);
  });

  it('falls back to the bare photograph when no stamp exists', async () => {
    const env = makeEnv({ archive: [FRAME] });
    const og = await getFrameOgData(new URL(`${ORIGIN}/archive/?f=a-frame`), env, 'archive');
    expect(og.image).toBe(_frameImg(ORIGIN, FRAME.filename, OG_IMG_WIDTH));
    expect(og.image).toContain(`-${OG_IMG_WIDTH}w.webp`);
  });

  it('prefers the stamped card when one is on R2', async () => {
    const env = makeEnv({ archive: [FRAME], stamped: new Set([STAMP_KEY]) });
    const og = await getFrameOgData(new URL(`${ORIGIN}/archive/?f=a-frame`), env, 'archive');
    expect(og.image).toBe(`${cdnBase(ORIGIN)}/${STAMP_KEY}`);
  });

  it('is null without ?f=, and null for a slug that is not there', async () => {
    const env = makeEnv({ archive: [FRAME] });
    expect(await getFrameOgData(new URL(`${ORIGIN}/archive/`), env, 'archive')).toBeNull();
    expect(await getFrameOgData(new URL(`${ORIGIN}/archive/?f=nope`), env, 'archive')).toBeNull();
  });

  it('survives a data file that will not load — an unfurl must not 500', async () => {
    const env = makeEnv({});
    env.ASSETS.fetch = async () => new Response('boom', { status: 500 });
    expect(await getFrameOgData(new URL(`${ORIGIN}/archive/?f=a-frame`), env, 'archive')).toBeNull();
  });
});

describe('getFrameOgData — the buffer branch', () => {
  const B = { id: 'b1', filename: 'PIC_0001.jpg', captured_at: '2026-09-18T12:00:00Z' };

  it('keys off id (not slug) and keeps its quiet title', async () => {
    const env = makeEnv({ buffer: [B] });
    const og = await getFrameOgData(new URL(`${ORIGIN}/archive/buffer/?f=b1`), env, 'buffer');
    expect(og.title).toBe('The Rolling Buffer');
    expect(og.ogUrl).toBe(`${ORIGIN}/archive/buffer/?f=b1`);
    expect(og.description).toContain('Capture first. Process later.');
  });

  it('takes the same stamp a frame does — one key serves both surfaces', async () => {
    const env = makeEnv({ buffer: [B], stamped: new Set([STAMP_KEY]) });
    const og = await getFrameOgData(new URL(`${ORIGIN}/archive/buffer/?f=b1`), env, 'buffer');
    expect(og.image).toBe(`${cdnBase(ORIGIN)}/${STAMP_KEY}`);
  });
});

describe('the stamp probe cache is ASYMMETRIC — the 2026-09-18 defect', () => {
  const ask = (env) => getFrameOgData(new URL(`${ORIGIN}/archive/?f=a-frame`), env, 'archive');

  it('remembers a stamp it FOUND — but BOUNDED, because a stamp can be removed', async () => {
    await ask(makeEnv({ archive: [FRAME], stamped: new Set([STAMP_KEY]) }));
    const hit = maxAgeOf(STAMP_KEY);
    expect(hit).toBeGreaterThan(0);
    // Was 300s, dropped to 60s when the console learned to turn a stamp OFF.
    // A stale '1' used to be harmless (the right card, a few minutes longer).
    // Now it points og:image at a DELETED key — a 404, i.e. a broken image —
    // so the window has to stay short enough to be a blip, not an outage.
    expect(hit, 'a removed stamp must not 404 for minutes').toBeLessThanOrEqual(60);
  });

  it('re-checks a stamp it did NOT find almost immediately', async () => {
    await ask(makeEnv({ archive: [FRAME] }));
    const miss = maxAgeOf(STAMP_KEY);
    expect(miss).toBeGreaterThan(0);          // still collapses a crawl burst
    expect(miss).toBeLessThanOrEqual(30);     // but a fresh stamp surfaces fast
  });

  it('holds a miss far more briefly than a hit — the asymmetry itself', async () => {
    await ask(makeEnv({ archive: [FRAME] }));
    const miss = maxAgeOf(STAMP_KEY);
    store.clear();
    await ask(makeEnv({ archive: [FRAME], stamped: new Set([STAMP_KEY]) }));
    const hit = maxAgeOf(STAMP_KEY);
    // The whole point. Equal TTLs are what let a published stamp stay invisible
    // for five minutes while crawlers cached the bare photo for days.
    expect(miss, 'a MISS must expire sooner than a HIT').toBeLessThan(hit);
  });

  it('serves the stamp once the miss has lapsed — no R2 write is needed to recover', async () => {
    const cold = makeEnv({ archive: [FRAME] });
    expect((await ask(cold)).image).toContain(`-${OG_IMG_WIDTH}w.webp`);
    store.clear();                             // what expiry does for us
    const warm = makeEnv({ archive: [FRAME], stamped: new Set([STAMP_KEY]) });
    expect((await ask(warm)).image).toBe(`${cdnBase(ORIGIN)}/${STAMP_KEY}`);
  });

  it('still spares R2 a second head() while an answer is cached', async () => {
    const env = makeEnv({ archive: [FRAME], stamped: new Set([STAMP_KEY]) });
    await ask(env); await ask(env);
    expect(headCalls.length, 'the cache exists to avoid this round-trip').toBe(1);
  });

  it('answers false rather than throwing when R2 itself fails', async () => {
    const env = makeEnv({ archive: [FRAME] });
    env.CDN.head = async () => { throw new Error('R2 down'); };
    const og = await ask(env);
    expect(og.image).toBe(_frameImg(ORIGIN, FRAME.filename, OG_IMG_WIDTH));
  });
});
