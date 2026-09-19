// /api/cdn key validation + /api/upload key sanitization.
//
// The proxy and the upload path share one key charset (R2_KEY_CHARS in
// worker.js): anything the console can store, the proxy can serve. This
// matters on a zero-config fork, where all media serves through the proxy —
// real library objects carry spaces, '=' and '+' (camera exports,
// pre-console migrations), and the live custom CDN domain masks any
// mismatch. Found by a real site export: 'archive/OAKLENS_SF-two
// cyclist-blur-1024w.webp' 400'd through the proxy while serving fine from
// cdn.example.com.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';
import { _proxyCacheUrl, _wholeAs206 } from '../src/api/assets.js';

const SESSION_SECRET = 'test-secret-please-ignore';

// R2 stub: get() answers for the listed keys, put() records what was stored.
function makeCdn(keys = []) {
  const objects = new Map(keys.map((k) => [k, 'bytes']));
  const stored = [];
  return {
    stored,
    async get(key) {
      if (!objects.has(key)) return null;
      return { body: objects.get(key), size: 5, httpMetadata: { contentType: 'image/webp' } };
    },
    async put(key) { stored.push(key); objects.set(key, 'bytes'); },
  };
}

const env = (cdn) => ({ SESSION_SECRET, CDN: cdn });

// Keys travel URL-encoded, exactly as the pages and the exporter build them.
const proxyGet = (key, cdn) =>
  worker.fetch(
    new Request(`https://example.com/api/cdn/${encodeURIComponent(key).replace(/%2F/gi, '/')}`),
    env(cdn)
  );

describe('/api/cdn key validation', () => {
  // The two real-library shapes that used to 400 (masked on the live site by
  // the custom CDN domain; fatal on a zero-config fork).
  it('serves decoded keys containing spaces', async () => {
    const key = 'archive/OAKLENS_SF-two cyclist-blur-1024w.webp';
    const res = await proxyGet(key, makeCdn([key]));
    expect(res.status).toBe(200);
  });

  it('serves a base name with a space before the size suffix', async () => {
    const key = 'archive/Earpiece -480w.webp';
    const res = await proxyGet(key, makeCdn([key]));
    expect(res.status).toBe(200);
  });

  it("serves keys containing '=', '+' and parens", async () => {
    for (const key of [
      'archive/frame=005-480w.webp',
      'archive/shot+one-1024w.webp',
      'archive/roll (2)-480w.webp',
    ]) {
      const res = await proxyGet(key, makeCdn([key]));
      expect(res.status, key).toBe(200);
    }
  });

  // Non-Latin filenames. `\w` in the old charset meant ASCII, so every one of
  // these was stripped on upload and then 400'd on the way back out — a real
  // Japanese-titled track stored as 'audio/04 .mp3' and requested under its
  // actual name. R2 keys are UTF-8; there was never a storage reason for this.
  it('serves keys in non-Latin scripts', async () => {
    for (const key of [
      'audio/シルエット 日暮れ 04 街路灯.mp3',
      'archive/Ελλάδα-480w.webp',
      'archive/фотография-1024w.webp',
      'archive/café-münchen-480w.webp',   // combining marks survive too
    ]) {
      const res = await proxyGet(key, makeCdn([key]));
      expect(res.status, key).toBe(200);
    }
  });

  it('still 404s (not 400s) a well-formed key that is not in R2', async () => {
    const res = await proxyGet('archive/missing-480w.webp', makeCdn([]));
    expect(res.status).toBe(404);
  });

  it('serves keys under dev/ prefix', async () => {
    const key = 'dev/it_belongs_in_an_archive_FINAL_yellow_subs.jpg';
    const res = await proxyGet(key, makeCdn([key]));
    expect(res.status).toBe(200);
  });

  // The anchors the wider charset must not loosen.
  it('keeps prefix anchoring: non-public prefixes are rejected', async () => {
    for (const key of ['data/buffer.json.webp', 'secrets/x.webp', 'x.webp']) {
      const res = await proxyGet(key, makeCdn([key]));
      expect(res.status, key).toBe(400);
    }
  });

  it('keeps extension anchoring: non-media extensions are rejected', async () => {
    for (const key of ['archive/x.txt', 'archive/x.webp.html', 'archive/x']) {
      const res = await proxyGet(key, makeCdn([key]));
      expect(res.status, key).toBe(400);
    }
  });

  it("keeps '..' safety even though '.' and '/' are in the charset", async () => {
    const key = 'archive/../data/x.webp';
    const res = await proxyGet(key, makeCdn([key]));
    expect(res.status).toBe(400);
  });
});

describe('/api/upload key sanitization', () => {
  async function upload(name, cdn) {
    const token = await createToken(env(cdn));
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(8)], name, { type: 'image/webp' }));
    return worker.fetch(
      new Request('https://example.com/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }),
      env(cdn)
    );
  }

  it('preserves spaces, = and + instead of silently stripping them', async () => {
    // The old sanitizer deleted these characters, so the stored key diverged
    // from the filename the console records in buffer.json.
    const cdn = makeCdn();
    const res = await upload('archive/two cyclist=x+y-480w.webp', cdn);
    expect(res.status).toBe(200);
    expect(cdn.stored).toEqual(['archive/two cyclist=x+y-480w.webp']);
  });

  it('trims leading/trailing whitespace off every key segment', async () => {
    const cdn = makeCdn();
    const res = await upload('archive/ frame-480w.webp ', cdn);
    expect(res.status).toBe(200);
    expect(cdn.stored).toEqual(['archive/frame-480w.webp']);
  });

  it('round-trips: what upload stores, the proxy serves', async () => {
    const cdn = makeCdn();
    await upload('archive/OAKLENS_SF-two cyclist-blur-1024w.webp', cdn);
    expect(cdn.stored).toHaveLength(1);
    const res = await proxyGet(cdn.stored[0], cdn);
    expect(res.status).toBe(200);
  });

  it('stores a non-Latin filename unchanged, and serves it back', async () => {
    // The whole bug in one test: the console records this exact name in
    // data/audio.json, so an upload that stores anything else produces a
    // player pointed at a key that does not exist.
    const name = 'audio/シルエット 日暮れ 04 街路灯.mp3';
    const cdn = makeCdn();
    const res = await upload(name, cdn);
    expect(res.status).toBe(200);
    expect(cdn.stored).toEqual([name]);
    expect((await proxyGet(cdn.stored[0], cdn)).status).toBe(200);
  });

  it('still strips the characters that change how a key parses', async () => {
    // Widening to Unicode letters must not admit URL delimiters, quotes,
    // backslashes or control characters.
    const cdn = makeCdn();
    const res = await upload('archive/a?b#c%d&e"f\\g-480w.webp', cdn);
    expect(res.status).toBe(200);
    expect(cdn.stored).toEqual(['archive/abcdefg-480w.webp']);
  });

  it('still rejects keys outside the allowed prefixes and ..', async () => {
    for (const name of ['data/buffer.json', 'meta/../data/x.webp', 'nope/x.webp']) {
      const cdn = makeCdn();
      const res = await upload(name, cdn);
      expect(res.status, name).toBe(500); // per-file error path: nothing stored
      expect(cdn.stored).toEqual([]);
    }
  });
});


// ---- The `bytes=0-` -> 206 cache-correctness fix (v1 review E3) ----
//
// These two helpers were exported for tests that were never written (logged
// 2026-08-24 as E3, "better than un-exporting: add the missing direct test").
// The behaviour they carry is not obvious and is expensive to get wrong:
//
//   `Range: bytes=0-` means "send the whole thing, streamed" — it is what a
//   browser sends to START playing media, not a seek. Until 2026-08-14 the
//   proxy treated it as a partial, so every play on every visit skipped the
//   colo cache and went to R2: audio was the one path that never benefited
//   from the cache added for images. It now reads and writes the cache like
//   the full GET it is, while still ANSWERING 206 because Safari needs that
//   to believe seeking works.
//
// The trap that follows is the one worth a test: what gets STORED must be the
// 200, because a 206 is not a storable response. Store the 206 and every later
// visitor gets a partial served as if it were the whole object.
describe('_wholeAs206 — a whole 200 answered as the 206 media asks for', () => {
  it('sets a Content-Range covering the entire object', () => {
    const res = _wholeAs206(new Response('12345', { headers: { 'Content-Length': '5' } }));
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-4/5');
  });

  it('passes the body through untouched — nothing is buffered to do this', async () => {
    const res = _wholeAs206(new Response('12345', { headers: { 'Content-Length': '5' } }));
    expect(await res.text()).toBe('12345');
  });

  it('keeps the other headers', () => {
    const res = _wholeAs206(new Response('12345', {
      headers: { 'Content-Length': '5', 'Content-Type': 'audio/mpeg' },
    }));
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('refuses to invent a range it cannot honestly write', () => {
    // No Content-Length, or an empty object: a 206 would need a Content-Range
    // we cannot state. A server may ignore Range and answer 200, so it does
    // that rather than lie.
    for (const headers of [{}, { 'Content-Length': '0' }, { 'Content-Length': 'banana' }]) {
      expect(_wholeAs206(new Response('x', { headers })).status, JSON.stringify(headers)).toBe(200);
    }
  });
});

describe('_proxyCacheUrl — one key builder, or the purge deletes nothing', () => {
  // A proxy that populates one URL and a purge that deletes another is the
  // same bug as having no purge: it surfaces an hour later as "the overwrite
  // didn't take".
  it('encodes per segment, so a key the pages request matches what is stored', () => {
    // `shot+one-480w.webp` is requested as `shot%2Bone-480w.webp` (the pages
    // build src with encodeURIComponent), so a key built on the RAW name would
    // purge an entry nothing ever wrote.
    expect(_proxyCacheUrl('https://example.com', 'archive/shot+one-480w.webp'))
      .toBe('https://example.com/api/cdn/archive/shot%2Bone-480w.webp');
  });

  it('keeps slashes as separators rather than encoding them away', () => {
    expect(_proxyCacheUrl('https://example.com', 'audio/sets/a.mp3'))
      .toBe('https://example.com/api/cdn/audio/sets/a.mp3');
  });

  it('encodes a space the same way an <img src> does', () => {
    expect(_proxyCacheUrl('https://example.com', 'archive/two cyclist-blur.webp'))
      .toBe('https://example.com/api/cdn/archive/two%20cyclist-blur.webp');
  });
});

describe('what the edge cache STORES for a bytes=0- request', () => {
  // The invariant the two helpers exist to protect, exercised through the real
  // route rather than asserted about it.
  const withCache = () => {
    const store = new Map();
    const puts = [];
    globalThis.caches = {
      default: {
        async match(req) { return store.get(req.url) || undefined; },
        async put(req, res) { puts.push({ url: req.url, status: res.status }); store.set(req.url, res); },
      },
    };
    return { store, puts };
  };

  let saved;
  beforeEach(() => { saved = globalThis.caches; });
  afterEach(() => { globalThis.caches = saved; });

  const rangeGet = (key, cdn, range) => worker.fetch(
    new Request(`https://example.com/api/cdn/${key}`, { headers: range ? { Range: range } : {} }),
    env(cdn),
    { waitUntil: (p) => p },
  );

  it('answers 206 to the caller but stores a 200', async () => {
    const { puts } = withCache();
    const res = await rangeGet('audio/track.mp3', makeCdn(['audio/track.mp3']), 'bytes=0-');
    expect(res.status, 'Safari needs the 206 to believe seeking works').toBe(206);
    expect(puts.length, 'a bytes=0- request must still populate the cache').toBe(1);
    expect(puts[0].status, 'a 206 is not a storable response').toBe(200);
  });

  it('files it under the shared key builder, so the purge can find it', async () => {
    const { puts } = withCache();
    await rangeGet('audio/track.mp3', makeCdn(['audio/track.mp3']), 'bytes=0-');
    expect(puts[0].url).toBe(_proxyCacheUrl('https://example.com', 'audio/track.mp3'));
  });

  it('a genuine seek neither reads nor writes the cache', async () => {
    // A slice filed under the whole object's key is a corrupt hit for everyone
    // who comes after.
    const { puts } = withCache();
    await rangeGet('audio/track.mp3', makeCdn(['audio/track.mp3']), 'bytes=100-200');
    expect(puts.length).toBe(0);
  });

  it('a cache HIT for a bytes=0- request is still answered 206', async () => {
    const { puts } = withCache();
    await rangeGet('audio/track.mp3', makeCdn(['audio/track.mp3']), 'bytes=0-');
    const second = await rangeGet('audio/track.mp3', makeCdn(['audio/track.mp3']), 'bytes=0-');
    expect(second.status).toBe(206);
    expect(puts.length, 'the second request was served from cache').toBe(1);
  });
});
