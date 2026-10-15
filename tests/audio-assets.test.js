// The audio half of the asset path: /api/upload's type + size gates, the
// audio/ key prefix (shared with /api/delete-assets), and what /api/cdn serves
// back.
//
// Three of these guard something that fails SILENTLY in a browser rather than
// loudly in a log:
//
//  · Content-Type. The proxy sends `nosniff`, so an .mp3 handed back as
//    image/webp does not play — it just sits there. The fallback table has to
//    answer for every extension the key regex admits, or a bucket seeded
//    without httpMetadata (rclone, a pre-console migration) serves dead audio.
//  · Range. Safari refuses to play media from a server that ignores Range, and
//    seeking a 40-minute episode is the whole point of a podcast player.
//  · The size cap. Audio gets its own, larger ceiling; clamping it to the
//    image cap would reject ordinary episodes with a misleading error.
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';
import { handleDeleteAssets } from '../src/api/assets.js';
import { createToken } from '../src/shared/auth.js';

const SESSION_SECRET = 'test-secret-please-ignore';
const env = (cdn) => ({ SESSION_SECRET, CDN: cdn });

// R2 stub: records what was stored (key + contentType) and can serve it back.
function makeCdn(keys = []) {
  const objects = new Map(keys.map((k) => [k, { contentType: undefined }]));
  const stored = [];
  return {
    stored,
    objects,
    async get(key, opts) {
      if (!objects.has(key)) return null;
      const meta = objects.get(key);
      const base = {
        body: 'bytes',
        size: 500,
        httpMetadata: meta.contentType ? { contentType: meta.contentType } : {},
      };
      if (opts && opts.range) return { ...base, range: opts.range };
      return base;
    },
    async put(key, body, opts) {
      // The upload's File itself (a Blob), never a second in-memory copy (W7).
      if (!(body instanceof Blob)) throw new Error('put() was given a copy, not the File');
      stored.push(key);
      objects.set(key, { contentType: opts?.httpMetadata?.contentType });
    },
    async delete(key) { objects.delete(key); },
  };
}

async function upload(cdn, name, type, bytes = 8) {
  const token = await createToken(env(cdn));
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array(bytes)], name, { type }));
  return worker.fetch(new Request('https://example.com/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  }), env(cdn));
}

const proxyGet = (cdn, key, range) => worker.fetch(
  new Request(`https://example.com/api/cdn/${encodeURIComponent(key).replace(/%2F/gi, '/')}`,
    range ? { headers: { Range: range } } : undefined),
  env(cdn)
);

describe('/api/upload — audio types', () => {
  it.each([
    ['audio/mpeg', 'take-one.mp3'],
    ['audio/mp4', 'episode.m4a'],
    ['audio/x-m4a', 'voice-memo.m4a'],
    ['audio/aac', 'clip.aac'],
    ['audio/ogg', 'loop.ogg'],
    ['audio/opus', 'talk.opus'],
    ['audio/wav', 'room-tone.wav'],
    ['audio/flac', 'master.flac'],
  ])('accepts %s into the audio/ prefix', async (type, file) => {
    const cdn = makeCdn();
    const res = await upload(cdn, `audio/${file}`, type);
    expect(res.status).toBe(200);
    expect(cdn.stored).toEqual([`audio/${file}`]);
  });

  it('stores the uploaded Content-Type so the proxy can serve it back playable', async () => {
    const cdn = makeCdn();
    await upload(cdn, 'audio/take-one.mp3', 'audio/mpeg');
    expect(cdn.objects.get('audio/take-one.mp3').contentType).toBe('audio/mpeg');
  });

  it('rejects a type outside the allowlist', async () => {
    const cdn = makeCdn();
    const res = await upload(cdn, 'audio/payload.mp3', 'application/octet-stream');
    expect(res.status).toBe(415);
    expect(cdn.stored).toEqual([]);
  });

  it('gives audio its OWN size cap, well above the 25MB image ceiling', async () => {
    // An ordinary half-hour episode is larger than any photograph the console
    // will ever store; clamping audio to the image cap would reject it.
    const cdn = makeCdn();
    const res = await upload(cdn, 'audio/episode.mp3', 'audio/mpeg', 26 * 1024 * 1024);
    expect(res.status).toBe(200);
    expect(cdn.stored).toEqual(['audio/episode.mp3']);
  });

  it('still refuses app-state and traversal keys for an audio upload', async () => {
    for (const name of ['data/audio.json', 'audio/../data/x.mp3', 'nope/x.mp3']) {
      const cdn = makeCdn();
      const res = await upload(cdn, name, 'audio/mpeg');
      expect(res.status).toBe(500);       // "some files failed" — nothing written
      expect(cdn.stored).toEqual([]);
    }
  });
});

describe('/api/delete-assets — audio/ joins the shared prefix allowlist', () => {
  it('deletes an audio key', async () => {
    const cdn = makeCdn(['audio/take-one.mp3']);
    const token = await createToken(env(cdn));
    const res = await handleDeleteAssets(new Request('https://example.com/api/delete-assets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: ['audio/take-one.mp3'] }),
    }), env(cdn));
    expect(res.status).toBe(200);
    expect(cdn.objects.has('audio/take-one.mp3')).toBe(false);
  });
});

describe('/api/cdn — serving audio', () => {
  it('round-trips: what upload stores, the proxy serves', async () => {
    const cdn = makeCdn();
    await upload(cdn, 'audio/take one (demo).mp3', 'audio/mpeg');
    expect(cdn.stored).toHaveLength(1);
    const res = await proxyGet(cdn, cdn.stored[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it.each([
    ['audio/track.mp3', 'audio/mpeg'],
    ['audio/track.m4a', 'audio/mp4'],
    ['audio/track.aac', 'audio/aac'],
    ['audio/track.ogg', 'audio/ogg'],
    ['audio/track.opus', 'audio/ogg'],
    ['audio/track.wav', 'audio/wav'],
    ['audio/track.flac', 'audio/flac'],
  ])('falls back to a playable Content-Type for %s when R2 stored none', async (key, expected) => {
    // A bucket seeded outside the console (rclone, a migration) carries no
    // httpMetadata. Under `nosniff`, defaulting to image/webp here means the
    // track silently refuses to play.
    const cdn = makeCdn([key]);
    const res = await proxyGet(cdn, key);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(expected);
  });

  it('answers a Range request with 206 so seeking works (and Safari plays at all)', async () => {
    const cdn = makeCdn(['audio/episode.mp3']);
    const res = await proxyGet(cdn, 'audio/episode.mp3', 'bytes=100-199');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 100-199/500');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  });
});
