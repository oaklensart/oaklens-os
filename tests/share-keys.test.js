// @vitest-environment happy-dom
//
// THE TWO SIDES OF A SHARE IMAGE'S ADDRESS, pinned against each other.
//
// The console WRITES the stamp (js/console/card-paint.js — shareStem/shareKey)
// and the edge READS it (src/edge/chrome.js — one resolver per branch). They
// cannot import each other: one is a browser module, the other a Worker module,
// and this repo has no build step that would let them share a constant. So the
// key is spelled twice, and this file is what stops the two spellings drifting
// — the same move tests/audio-playlist-card.test.js makes for AUDIO_MAX_PLAYLIST.
//
// It is a real failure mode, not a theoretical one: a drifted key is silent.
// The console uploads to one address, the edge heads another, nothing is red,
// and every link the owner shares unfurls with no image at all.
//
// Chunk 7 of docs/cards-core-complete.md.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { shareStem, shareKey } from '../js/console/card-paint.js';
import {
  _ogImage, _audioOgImage, _setOgImage, _cardOgImage, _fnOgImage, getPostMeta,
} from '../src/edge/chrome.js';

// The edge's existence check caches through caches.default, which Node has no
// notion of. A fresh store per test — a warm "does not exist" would make the
// next test's head() look like it never ran.
let _savedCaches;
beforeEach(() => {
  _savedCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = store.get(typeof req === 'string' ? req : req.url);
        return hit === undefined ? undefined : new Response(hit);
      },
      async put(req, res) { store.set(typeof req === 'string' ? req : req.url, await res.text()); },
    },
  };
});
afterEach(() => { globalThis.caches = _savedCaches; });

/** An R2 stand-in that says yes to everything and records what it was asked. */
function envAsking(seen) {
  return { CDN: { async head(key) { seen.push(key); return { key }; } } };
}

const ORIGIN = 'https://example.com';

describe('the console writes the key the edge reads', () => {
  const cases = [
    ['a frame', { kind: 'frame', id: 'SAMPLE_Evening' },
      (env) => _ogImage(env, ORIGIN, 'SAMPLE_Evening.webp')],
    ['a field note', { kind: 'fn', id: 'on-walking' },
      (env) => _fnOgImage(env, ORIGIN, 'on-walking')],
    ['a track', { kind: 'audio', id: 'field-hum' },
      (env) => _audioOgImage(env, ORIGIN, 'field-hum')],
    ['a saved set', { kind: 'set', id: 'late-summer' },
      (env) => _setOgImage(env, ORIGIN, 'late-summer')],
    ['a composed card', { kind: 'card', id: 'c-abc123' },
      (env) => _cardOgImage(env, ORIGIN, 'c-abc123')],
  ];

  for (const [name, target, resolve] of cases) {
    it(`${name} — one address, both sides`, async () => {
      const seen = [];
      await resolve(envAsking(seen));
      expect(seen, 'the edge looked exactly once').toHaveLength(1);
      expect(seen[0], 'and at the key the console uploads to')
        .toBe(shareKey(shareStem(target), 'og'));
    });
  }

  it('every resolver answers a CDN url for the key it found', async () => {
    const url = await _cardOgImage(envAsking([]), ORIGIN, 'c-abc123');
    expect(url).toContain('meta/card-c-abc123-og.webp');
  });

  it('and null — never a broken image — when nothing is stamped', async () => {
    const empty = { CDN: { async head() { return null; } } };
    expect(await _fnOgImage(empty, ORIGIN, 'on-walking')).toBeNull();
    expect(await _audioOgImage(empty, ORIGIN, 'x')).toBeNull();
    expect(await _setOgImage(empty, ORIGIN, 'x')).toBeNull();
    expect(await _cardOgImage(empty, ORIGIN, 'x')).toBeNull();
  });

  it('no id, no lookup — an empty key would head the whole prefix', async () => {
    const seen = [];
    const env = envAsking(seen);
    expect(await _fnOgImage(env, ORIGIN, '')).toBeNull();
    expect(await _cardOgImage(env, ORIGIN, '')).toBeNull();
    expect(await _setOgImage(env, ORIGIN, '')).toBeNull();
    expect(seen).toEqual([]);
    expect(shareStem({ kind: 'fn', id: '' })).toBe('');
  });

  it('a track and a set with the same slug keep separate stamps, both sides', async () => {
    const seen = [];
    const env = envAsking(seen);
    await _audioOgImage(env, ORIGIN, 'dusk');
    await _setOgImage(env, ORIGIN, 'dusk');
    expect(new Set(seen).size, 'two keys, not one').toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('a note with a hero keeps the historic frame key, so old stamps still serve', async () => {
    const seen = [];
    await _ogImage(envAsking(seen), ORIGIN, 'SAMPLE_Hero.webp');
    expect(seen[0]).toBe('meta/SAMPLE_Hero-og.webp');
    expect(seen[0]).not.toMatch(/^meta\/fn-/);
  });
});

// ------------------------------------------------- the note that has no hero

/** ASSETS serving one post's markdown. */
const envWithPost = (md) => ({
  ASSETS: { async fetch() { return new Response(md, { status: 200 }); } },
});

describe('a field note with no hero is still a note', () => {
  const withHero = '---\ntitle: On Walking\nlocation: Sample City\nhero: SAMPLE_Hero.webp\n---\n\nbody';
  const noHero = '---\ntitle: Just Words\nlocation: Sample City\ndate: 2026-09-11\n---\n\nbody';
  const url = new URL('https://example.com/field-notes/post?slug=just-words');

  it('its frontmatter reaches the edge — it used to be dropped entirely', async () => {
    const meta = await getPostMeta(url, envWithPost(noHero));
    expect(meta, 'a heroless note answered null before chunk 7').toBeTruthy();
    expect(meta.title).toBe('Just Words');
    expect(meta.hero).toBeUndefined();
  });

  it('a note with a hero is unchanged', async () => {
    const meta = await getPostMeta(url, envWithPost(withHero));
    expect(meta.hero).toBe('SAMPLE_Hero.webp');
    expect(meta.title).toBe('On Walking');
  });

  it('a slug the path shape refuses never reaches ASSETS', async () => {
    const bad = new URL('https://example.com/field-notes/post?slug=../../etc/passwd');
    expect(await getPostMeta(bad, envWithPost(noHero))).toBeNull();
  });

  it('no slug at all is still null, not an empty note', async () => {
    expect(await getPostMeta(new URL('https://example.com/field-notes/post'), envWithPost(noHero))).toBeNull();
  });
});
