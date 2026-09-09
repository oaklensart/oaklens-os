// @vitest-environment happy-dom
//
// Pins the exact output of buildBundle().
//
// buildBundle() serialises every data/*.json from in-memory state through an
// explicit field whitelist and commits the result atomically to GitHub. Because
// each surface is written as a hand-listed object literal, a field that stops
// being copied does not throw — it simply stops existing in the published JSON,
// and the live site quietly loses that data on the next publish. Per CLAUDE.md
// that has already shipped twice.
//
// The whitelists are also the single most dangerous thing to move during the
// console-ui.js decomposition: nothing else in the codebase would notice a
// dropped line. So this asserts the emitted key set for every surface, rather
// than only spot-checking values.

import { describe, it, expect, beforeAll } from 'vitest';
import { STATE } from '../js/console-state.js';

let buildBundle;
let bundle;

/** One entry per surface with every optional field populated, plus the cases
 *  buildBundle is supposed to filter out. */
function seedState() {
  STATE.buffer = [
    {
      id: 'buf-1', filename: 'f1.jpg', captured_at: '2026-01-02', published_at: '2026-01-03',
      added_at: '2026-01-01', archived: false, hash: 'h1',
      burst_id: 'burst-2026-01-02-001', focus: '50% 40%', cardFocus: '50% 30%', featured: true,
      image: 'data:image/jpeg;base64,AAAA', _imported: true,
    },
    // minimal: every optional field absent
    { id: 'buf-2', filename: 'f2.jpg', captured_at: '2026-01-04', published_at: null, added_at: '2026-01-04', archived: true },
    // a retired frame (dark tombstone). It still carries stale live fields in
    // memory (published_at/archived/featured/hash) — buildBundle must emit ONLY
    // the tombstone shape, or a publish silently un-retires it over gone media.
    {
      id: 'buf-dark', filename: 'gone.jpg', captured_at: '2026-01-05',
      dark: true, darked_at: '2026-02-01T00:00:00.000Z', burst_id: 'burst-2026-01-05-001',
      published_at: '2026-01-06', archived: false, featured: true, hash: 'stale', _imported: true,
    },
    { id: 'buf-err', filename: 'bad.jpg', _uploadError: true },       // filtered
    { id: 'buf-up', filename: 'busy.jpg', _uploading: true },         // filtered
  ];
  STATE.archive = [
    {
      id: 'arc-1', filename: 'a1.jpg', slug: 'a-one', title: 'T', sub: 'S', location: 'L',
      camera: 'C', lens: 'Le', medium: 'M', hash: 'ah1', added_at: '2026-02-01',
      focus: '10% 20%', cardFocus: '30% 40%',
    },
    { id: 'arc-2', filename: 'a2.jpg', slug: 'a-two', title: 'T2', sub: '', location: '', camera: '', lens: '', medium: '', added_at: '2026-02-02' },
    { id: 'arc-err', _uploadError: true },                            // filtered
  ];
  STATE.posts = [
    {
      id: 'p-1', fn_id: 'fn-001', title: 'Post One', location: 'Loc', date: '2026-03-01',
      hero_filename: 'hero.jpg', body: 'Body text', buffer_dates: '2026-01-02', added_at: '2026-03-01',
      focus: '50% 50%', status: 'published', card: { layout: 'hero' },
    },
    // no status at all is treated as published; hero comes from `hero` when it
    // is not an inline data: URL
    { id: 'p-2', fn_id: 'fn-002', title: 'Post Two', location: '', date: '2026-03-02', hero: 'h2.jpg', body: '', added_at: '2026-03-02' },
    { id: 'p-3', fn_id: 'fn-003', title: 'Draft', location: '', date: '2026-03-03', body: 'x', status: 'draft' }, // filtered
    // a data: hero must not be published as a filename
    { id: 'p-4', fn_id: 'fn-004', title: 'Inline Hero', location: '', date: '2026-03-04', hero: 'data:image/png;base64,AAA', body: '', added_at: '2026-03-04' },
  ];
  STATE.wallpapers = [
    { id: 'w-1', filename: 'w1.jpg', fullres: 'w1-full.jpg', title: 'W1', desc: 'D', isNew: true, added_at: '2026-04-01', hash: 'wh1', focus: '0% 0%' },
    { id: 'w-2', title: 'W2', added_at: '2026-04-02' },
    { id: 'w-err', _uploading: true },                                // filtered
  ];
  STATE.barrel = [{ id: 'b-1', date: '2026-05-01', title: 'B1', url: 'https://example.test/1', _imported: true }];
  STATE.friends = [
    { id: 'fr-1', name: 'N1', tag: 'T', location: 'L', url: 'https://example.test/f', added_at: '2026-06-01' },
    { id: 'fr-2', name: 'N2' },
  ];
  STATE.library = [
    { id: 'l-1', filename: 'l1.jpg', kind: 'video', hash: 'lh1', added_at: '2026-07-01' },
    { id: 'l-2', filename: 'l2.jpg' },
    { id: 'l-err', _uploadError: true },                              // filtered
  ];
  STATE.audio = [
    {
      id: 'aud-1', filename: 'a1.mp3', slug: 'a1-slug', title: 'A1 Title', sub: 'A1 Sub',
      duration: 180, peaks: '0.1,0.5,0.9', size: 1024, mime: 'audio/mpeg', added_at: '2026-08-01',
      featured: true, featured_order: 1, episode: true, download: true,
    },
    // minimal: every optional field absent
    { id: 'aud-2', slug: 'a2-slug', filename: 'a2.mp3', added_at: '2026-08-02' },
    { id: 'aud-err', filename: 'bad.mp3', _uploadError: true },       // filtered
    { id: 'aud-up', filename: 'busy.mp3', _uploading: true },         // filtered
  ];
  STATE.cards = [
    {
      id: 'card-1', order: 1, added_at: '2026-09-01',
      source: { type: 'archive', id: 'arc-1' }, media: 'c1.webp', folder: 'archive',
      focus: '10% 20%', cardFocus: '30% 40%', title: 'C1 Title', tease: 'C1 tease.',
      label: 'Archive', link: '/archive/?f=arc-1', palette: 'flow', card: { layout: 'hero' },
      img: { w: 2048, h: 1536, lum: 0.2 },
    },
    // minimal: a free-form card with nothing but words
    { id: 'card-2', order: 2, title: 'C2 Title', added_at: '2026-09-02' },
  ];
  STATE.staged = { buffer: 1, archive: 1, posts: 1, wallpapers: 0, barrel: 0, friends: 0, library: 0, audio: 1 };
}

const parse = (name) => JSON.parse(bundle[name]);
const keysOf = (name, i = 0) => Object.keys(parse(name)[i]).sort();

beforeAll(async () => {
  globalThis.fetch = async () => new Response('[]', { status: 200 });
  ({ buildBundle } = await import('../js/console-ui.js'));
  seedState();
  bundle = buildBundle();
});

describe('buildBundle()', () => {
  it('emits exactly the expected files', () => {
    expect(Object.keys(bundle).sort()).toEqual([
      'MANIFEST.txt',
      'data/archive.json',
      'data/audio.json',
      'data/barrel.json',
      'data/buffer.json',
      'data/cards.json',
      'data/friends.json',
      'data/library.json',
      'data/posts.json',
      'data/wallpapers.json',
      'posts/fn-001.md',
      'posts/fn-002.md',
      'posts/fn-004.md',
    ]);
  });

  // ---- field whitelists: a dropped line in any of these fails here ----

  it('buffer keeps every whitelisted field', () => {
    expect(keysOf('data/buffer.json')).toEqual([
      'added_at', 'archived', 'burst_id', 'captured_at', 'cardFocus',
      'featured', 'filename', 'focus', 'hash', 'id', 'published_at',
    ]);
  });

  it('a dark frame publishes as a tombstone, never resurrected as a live cell', () => {
    // The bug this guards: buildBundle ran every buffer frame through the
    // live-frame whitelist, which has no `dark`/`darked_at` — so retiring a
    // published frame and then publishing dropped the tombstone flags and
    // re-listed it as a live frame pointing at R2 media that retire deleted.
    const dark = parse('data/buffer.json').find((b) => b.id === 'buf-dark');
    expect(Object.keys(dark).sort()).toEqual([
      'burst_id', 'captured_at', 'dark', 'darked_at', 'filename', 'id',
    ]);
    expect(dark.dark).toBe(true);
    expect(dark.darked_at).toBe('2026-02-01T00:00:00.000Z');
    // the stale live fields it still held in memory must NOT be republished —
    // emitting any of them is exactly the un-retirement.
    for (const k of ['published_at', 'added_at', 'archived', 'featured', 'hash']) {
      expect(k in dark, `dark frame must not republish live field ${k}`).toBe(false);
    }
  });

  it('archive keeps every whitelisted field', () => {
    expect(keysOf('data/archive.json')).toEqual([
      'added_at', 'camera', 'cardFocus', 'filename', 'focus', 'hash', 'id',
      'lens', 'location', 'medium', 'slug', 'sub', 'title',
    ]);
  });

  it('posts keep every whitelisted field', () => {
    expect(keysOf('data/posts.json')).toEqual([
      'added_at', 'body', 'buffer_dates', 'card', 'date', 'fn_id', 'focus', 'hero', 'id', 'location', 'title',
    ]);
  });

  // The homepage card descriptor rides the same conditional-spread rule as
  // every other optional flag: a note that never opted into a layout must come
  // out of the serializer exactly as it went in, or an untouched published
  // posts.json grows a key on the next publish.
  it('posts carry the card descriptor only when one was chosen', () => {
    const posts = parse('data/posts.json');
    expect(posts[0].card).toEqual({ layout: 'hero' });
    expect('card' in posts[1]).toBe(false);
    expect('card' in posts[2]).toBe(false);
  });

  it('wallpapers keep every whitelisted field', () => {
    expect(keysOf('data/wallpapers.json')).toEqual([
      'added_at', 'desc', 'filename', 'focus', 'fullres', 'hash', 'id', 'isNew', 'title',
    ]);
  });

  it('friends keep every whitelisted field', () => {
    expect(keysOf('data/friends.json')).toEqual(['added_at', 'id', 'location', 'name', 'tag', 'url']);
  });

  it('library keeps every whitelisted field', () => {
    expect(keysOf('data/library.json')).toEqual(['added_at', 'filename', 'hash', 'id', 'kind']);
  });

  it('audio keeps every whitelisted field', () => {
    expect(keysOf('data/audio.json')).toEqual([
      'added_at', 'download', 'duration', 'episode', 'featured', 'featured_order',
      'filename', 'id', 'mime', 'peaks', 'size', 'slug', 'sub', 'title',
    ]);
  });

  // No 'img'. It was whitelisted from the day composed cards landed, for an
  // image ladder that was handed off and never shipped — nothing in the repo
  // ever wrote or read it, so the entry described a mechanism that did not
  // exist. Removed 2026-09-08. This list pinned the field as PRESENT, which is
  // why it never caught it: a whitelist test proves what publish will emit, not
  // that anything fills it. The ladder is still tracked in docs/ideas/index.md,
  // and lands its field back here alongside the code that writes it.
  it('composed cards keep every whitelisted field', () => {
    expect(keysOf('data/cards.json')).toEqual([
      'added_at', 'card', 'cardFocus', 'focus', 'folder', 'id', 'label',
      'link', 'media', 'order', 'palette', 'source', 'tease', 'title',
    ]);
  });

  // A card may be a picture with no words, words with no picture, or a plain
  // reference. Everything but id/order/added_at is conditional, so a minimal
  // card must not carry a single null.
  it('a minimal composed card emits nothing it was not given', () => {
    const [, minimal] = parse('data/cards.json');
    expect(Object.keys(minimal).sort()).toEqual(['added_at', 'id', 'order', 'title']);
  });

  it('barrel passes entries through, minus the _imported marker', () => {
    expect(keysOf('data/barrel.json')).toEqual(['date', 'id', 'title', 'url']);
  });

  // ---- filters ----

  it('never publishes a frame or audio track whose upload failed or is still running', () => {
    // A committed frame pointing at a CDN object that does not exist renders blank.
    expect(parse('data/buffer.json').map((b) => b.id)).toEqual(['buf-1', 'buf-2', 'buf-dark']);
    expect(parse('data/archive.json').map((a) => a.id)).toEqual(['arc-1', 'arc-2']);
    expect(parse('data/wallpapers.json').map((w) => w.id)).toEqual(['w-1', 'w-2']);
    expect(parse('data/library.json').map((l) => l.id)).toEqual(['l-1', 'l-2']);
    expect(parse('data/audio.json').map((a) => a.id)).toEqual(['aud-1', 'aud-2']);
  });

  it('publishes only posts that are published or have no status', () => {
    expect(parse('data/posts.json').map((p) => p.id)).toEqual(['p-1', 'p-2', 'p-4']);
    expect(bundle['posts/fn-003.md']).toBeUndefined();
  });

  // ---- conditional fields ----

  it('omits optional fields rather than emitting null', () => {
    const [, minimal] = parse('data/buffer.json');
    for (const k of ['burst_id', 'focus', 'cardFocus', 'featured']) {
      expect(k in minimal, `${k} should be absent, not null`).toBe(false);
    }
    const [, minAudio] = parse('data/audio.json');
    for (const k of ['featured', 'featured_order', 'episode', 'download']) {
      expect(k in minAudio, `${k} should be absent from minimal audio, not null/false`).toBe(false);
    }
    expect(minimal.hash).toBeNull(); // hash is explicitly nulled, not omitted
    expect('focus' in parse('data/archive.json')[1]).toBe(false);
    expect('kind' in parse('data/library.json')[1]).toBe(false);
  });

  it('resolves hero to a filename and never to an inline data: URL', () => {
    const posts = parse('data/posts.json');
    expect(posts[0].hero).toBe('hero.jpg');   // hero_filename wins
    expect(posts[1].hero).toBe('h2.jpg');     // plain hero string passes through
    expect(posts[2].hero).toBeNull();         // data: URL is dropped
  });

  // ---- markdown ----

  it('writes post markdown with exact frontmatter', () => {
    expect(bundle['posts/fn-001.md']).toBe(
      '---\nid: fn-001\ntitle: Post One\nlocation: Loc\ndate: 2026-03-01\n' +
      'hero: hero.jpg\nfocus: "50% 50%"\nbuffer_dates: "2026-01-02"\n---\n\nBody text',
    );
    // optional frontmatter lines vanish entirely when unset
    expect(bundle['posts/fn-002.md']).toBe(
      '---\nid: fn-002\ntitle: Post Two\nlocation: \ndate: 2026-03-02\nhero: h2.jpg\n---\n\n',
    );
  });

  // ---- manifest ----

  it('reports per-surface counts in the manifest', () => {
    const m = bundle['MANIFEST.txt'];
    expect(m).toMatch(/^OAKLENS BUNDLE · \d{4}-\d{2}-\d{2}T/);
    expect(m).toMatch(/data\/buffer\.json\s+5 entries \(2 imported \+ 3 new\)/);
    expect(m).toMatch(/data\/archive\.json\s+3 entries/);
    expect(m).toMatch(/data\/friends\.json\s+2 nodes/);
    expect(m).toMatch(/data\/library\.json\s+3 entries/);
  });

  it('emits valid JSON for every data file', () => {
    for (const name of Object.keys(bundle).filter((k) => k.endsWith('.json'))) {
      expect(() => JSON.parse(bundle[name]), `${name} is not valid JSON`).not.toThrow();
    }
  });
});
