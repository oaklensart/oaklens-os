// @vitest-environment happy-dom
//
// The card-engine core seam in js/recent-index.js: CARD_LAYOUTS /
// resolveLayout / cardDescriptor (pure) + CARD_KINDS / buildCard (DOM).
//
// THE LOAD-BEARING CONTRACT: the default layout adds NOTHING. An untouched
// grid must render byte-identical to the pre-engine builders, so a fork that
// configures no card ever notices the engine exists. The two fixture files
// were captured from the pre-refactor renderer (2026-08-23, the commit before
// the registry landed) by rendering these exact payloads through the old
// dispatch ternary — if either comparison fails, default-path markup changed,
// which is a breaking change for every published site whether or not the
// change looks harmless here.
//
// Fixture A: live pulse + single featured audio + archive photo + text post
//            (standard tier, drop cap). Pulse leads.
// Fixture B: no pulse; featured RAW daily + 3-track playlist + archive photo
//            + statement-tier text (no drop cap).
//
// Both fixtures were REORDERED on 2026-08-27 when pins stopped carrying fixed
// card numbers and began compacting to the head of the row (the starred frame
// that landed in the tablet-only card — tests/pulse-card.test.js). Not one byte
// of any card's markup moved: the reorder was applied by rebuilding the row and
// asserting the two sets of card HTML were identical before rewriting the file,
// so these still say exactly what they were captured to say.
//
// The 'hero' layout (Chunk 2) is exercised at the bottom: it is the first
// layout that is not 'default', so it is also the first proof that a real
// layout can land without moving a byte of the two fixtures above.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixture = (name) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

// Deterministic CDN base — cdnRoot() reads this meta before falling back to
// location.origin, which differs across happy-dom versions.
const meta = document.createElement('meta');
meta.setAttribute('name', 'cdn-base');
meta.setAttribute('content', 'https://cdn.example/api/cdn');
document.head.appendChild(meta);

const host = document.createElement('div');
host.id = 'recent-index';
const section = document.createElement('section');
section.className = 'cl-work';
section.appendChild(host);
document.body.appendChild(section);

const ARCHIVE_ENTRY = {
  slug: 'evening-light', filename: 'OAKLENS_Evening.webp', title: 'Evening Light',
  location: 'Sample City, 2025', camera: 'Mirrorless', added_at: '2026-08-01T00:00:00Z',
  focus: '40% 60%',
};
const RAW_ENTRY = {
  id: 'abc1234', filename: 'OAKLENS_Raw.webp', captured_at: '2026-08-17T23:06:46.132Z',
  num: 641, cardFocus: '0% 76%',
};
const LONG_POST = {
  fn_id: 'fn-012', title: 'On Walking', location: 'Sample City',
  body: 'The first walk with a new camera is never about the pictures — it is about learning to see again. Every block becomes an audition for the light.',
  added_at: '2026-08-02T00:00:00Z',
};
const SHORT_POST = {
  fn_id: 'fn-013', title: 'Short', location: 'Sample City',
  body: 'A one-liner.', added_at: '2026-08-03T00:00:00Z',
};
// A note that opted into the hero layout, with a hero the gate accepts.
const HERO_POST = {
  fn_id: 'fn-014', title: 'The Long Way Round', location: 'Sample City',
  hero: 'OAKLENS_Hero.webp', focus: '30% 70%',
  body: 'A one-liner.', added_at: '2026-08-05T00:00:00Z',
  card: { layout: 'hero' },
};
// happy-dom normalises the url() quoting when it reflects the style back.
const HERO_URL = 'url("https://cdn.example/api/cdn/archive/OAKLENS_Hero-1024w.webp")';

const SINGLE_AUDIO = {
  slug: 'field-hum', filename: 'field-hum.mp3', title: 'Field Hum', sub: 'ambient sketch',
  duration: 94, peaks: '', added_at: '2026-08-04T00:00:00Z', featured: true, featured_order: 1,
};
const PLAYLIST_AUDIO = [
  { slug: 't-one', filename: 't-one.mp3', title: 'Track One', duration: 60, peaks: '', added_at: '2026-08-04T00:00:00Z', featured: true, featured_order: 1 },
  { slug: 't-two', filename: 't-two.mp3', title: 'Track Two', duration: 61, peaks: '', added_at: '2026-08-04T00:00:01Z', featured: true, featured_order: 2 },
  { slug: 't-three', filename: 't-three.mp3', title: 'Track Three', duration: 62, peaks: '', added_at: '2026-08-04T00:00:02Z', featured: true, featured_order: 3 },
];
const LIVE_PULSE = {
  state: 'ember', text: 'Printing the last of the dusk rolls.', glyphs: '🌆',
  localTime: '21:14', footLeft: 'studio', footRight: 'late',
};

// Scenario A rides the module's own boot render: payloads are served to the
// import-time fetch, so the fixture covers the REAL end-to-end path
// (getJson → withSampleFallback → pickRecent → buildCard → host).
const payloadsA = {
  '/data/archive.json': [ARCHIVE_ENTRY],
  '/data/posts.json': [LONG_POST],
  '/api/buffer-summary': { featured: [] },
  '/data/audio.json': [SINGLE_AUDIO],
  '/api/pulse': { pulse: LIVE_PULSE },
};
globalThis.fetch = async (path) =>
  new Response(JSON.stringify(payloadsA[path] ?? null), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

let RI;
beforeAll(async () => {
  await import('../js/recent-index.js');
  RI = globalThis.RecentIndex;
  await new Promise((r) => setTimeout(r, 20));
});

describe('byte identity — the default layout adds nothing', () => {
  it('grid A (pulse · audio · text · photo) matches the pre-engine renderer exactly', () => {
    expect(host.innerHTML).toBe(fixture('card-engine-grid-a.html'));
  });

  it('grid B (playlist · RAW · text · photo) matches the pre-engine renderer exactly', () => {
    const picks = RI.pickRecent([ARCHIVE_ENTRY], [SHORT_POST], [RAW_ENTRY], PLAYLIST_AUDIO, { pulse: null });
    const html = picks.map((item) => RI.buildCard(item).outerHTML).join('');
    expect(html).toBe(fixture('card-engine-grid-b.html'));
  });
});

describe('resolveLayout — unknown resolves to default, never breaks', () => {
  it('registers exactly the five kinds, each with default', () => {
    // `composed` joined on 2026-09-07 — the owner's own cards, overlaid on the
    // automatic row (tests/card-composer.test.js). Every kind must still offer
    // 'default', because that is what an unknown layout falls back to.
    expect(Object.keys(RI.cardLayouts).sort())
      .toEqual(['audio', 'composed', 'photo', 'pulse', 'text']);
    for (const kind of Object.keys(RI.cardLayouts)) {
      expect(RI.cardLayouts[kind]).toContain('default');
    }
  });

  it.each([
    ['text', '', 'default'],
    ['text', 'bogus', 'default'],
    ['text', 'default', 'default'],
    ['nope', 'anything', 'default'],
    ['photo', undefined, 'default'],
    ['photo', 42, 'default'],
  ])('resolveLayout(%j, %j) → %j', (kind, want, expected) => {
    expect(RI.resolveLayout(kind, want)).toBe(expected);
  });

  it('resolves a registered non-default layout by name', () => {
    RI.cardLayouts.text.push('__test-layout');
    try {
      expect(RI.resolveLayout('text', '__test-layout')).toBe('__test-layout');
    } finally {
      RI.cardLayouts.text.pop();
    }
  });
});

describe('cardDescriptor — the per-entry card object', () => {
  it.each([
    [undefined, ''],
    [{}, ''],
    [{ card: null }, ''],
    [{ card: 'hero' }, ''],           // bare string is not the shape
    [{ card: { layout: 'hero' } }, 'hero'],
    [{ card: { layout: 7 } }, ''],
  ])('entry %j → layout %j', (entry, layout) => {
    expect(RI.cardDescriptor(entry)).toEqual({ layout });
  });
});

describe('buildCard — dispatch + layout attribute', () => {
  it('renders every kind through the registry', () => {
    const cards = {
      pulse: RI.buildCard({ kind: 'pulse', data: LIVE_PULSE }),
      audio: RI.buildCard({ kind: 'audio', data: SINGLE_AUDIO }),
      photo: RI.buildCard({ kind: 'photo', data: ARCHIVE_ENTRY }),
      raw: RI.buildCard({ kind: 'photo', raw: true, data: RAW_ENTRY }),
      text: RI.buildCard({ kind: 'text', data: SHORT_POST }),
    };
    for (const node of Object.values(cards)) {
      expect(node.classList.contains('wk-card')).toBe(true);
    }
    expect(cards.raw.querySelector('.wk-tag').textContent).toBe('RAW');
    expect(cards.photo.querySelector('.wk-tag').textContent).toBe('Archive');
  });

  it('an unknown kind falls through to the text renderer, as the old ternary did', () => {
    const node = RI.buildCard({ kind: 'mystery', data: SHORT_POST });
    expect(node.classList.contains('wk-text')).toBe(true);
  });

  it('an unregistered layout choice on an entry renders default with NO data-layout', () => {
    const node = RI.buildCard({ kind: 'text', data: { ...SHORT_POST, card: { layout: 'bogus' } } });
    expect(node.hasAttribute('data-layout')).toBe(false);
    expect(node.outerHTML).toBe(RI.buildCard({ kind: 'text', data: SHORT_POST }).outerHTML);
  });

  it('a registered non-default layout surfaces as data-layout and changes nothing else', () => {
    RI.cardLayouts.text.push('__test-layout');
    try {
      const chosen = RI.buildCard({ kind: 'text', data: { ...SHORT_POST, card: { layout: '__test-layout' } } });
      expect(chosen.getAttribute('data-layout')).toBe('__test-layout');
      chosen.removeAttribute('data-layout');
      expect(chosen.outerHTML).toBe(RI.buildCard({ kind: 'text', data: SHORT_POST }).outerHTML);
    } finally {
      RI.cardLayouts.text.pop();
    }
  });
});

// ---- Chunk 2: the field-note hero layout ----
describe('the hero layout — the engine\'s first real layout', () => {
  it('registers hero on the text kind and nowhere else', () => {
    expect(RI.cardLayouts.text).toEqual(['default', 'hero']);
    expect(RI.cardLayouts.photo).toEqual(['default']);
    expect(RI.cardLayouts.audio).toEqual(['default']);
    expect(RI.cardLayouts.pulse).toEqual(['default']);
  });

  it('surfaces as data-layout and leads with the picture', () => {
    const node = RI.buildCard({ kind: 'text', data: HERO_POST });
    expect(node.getAttribute('data-layout')).toBe('hero');
    expect(node.classList.contains('wk-text')).toBe(true);
    expect(node.getAttribute('href')).toBe('/field-notes/post?slug=fn-014');

    const img = node.querySelector('.wk-img');
    expect(img).toBeTruthy();
    expect(img.style.backgroundImage).toBe(HERO_URL);
    // The identity cue is the on-media chip the photo cards already wear —
    // not a headline over the photograph (docs/field-note-card-vision.md).
    expect(img.querySelector('.wk-tag').textContent).toBe('Field Note');

    expect(node.querySelector('.wk-t-title').textContent).toBe('The Long Way Round');
    expect(node.querySelector('.wk-meta').textContent).toBe('Sample City · 2026');
  });

  it('drops the typographic tile\'s furniture — no tease, no drop cap, no caret, no tier', () => {
    const node = RI.buildCard({ kind: 'text', data: HERO_POST });
    expect(node.querySelector('.wk-snip')).toBeNull();
    expect(node.querySelector('.wk-dropcap')).toBeNull();
    expect(node.querySelector('.ed-caret')).toBeNull();
    expect(node.hasAttribute('data-tier')).toBe(false);
  });

  it('crops through cardFocus → focus → CSS centre, like a photo card', () => {
    const withCard = RI.buildCard({ kind: 'text', data: { ...HERO_POST, cardFocus: '10% 90%' } });
    expect(withCard.querySelector('.wk-img').style.backgroundPosition).toBe('10% 90%');

    const withFocus = RI.buildCard({ kind: 'text', data: HERO_POST });
    expect(withFocus.querySelector('.wk-img').style.backgroundPosition).toBe('30% 70%');

    const bare = RI.buildCard({ kind: 'text', data: { ...HERO_POST, focus: '' } });
    expect(bare.querySelector('.wk-img').style.backgroundPosition).toBe('');
  });

  it('reads the console-side hero_filename too, and prefers it', () => {
    const node = RI.buildCard({
      kind: 'text',
      data: { ...HERO_POST, hero: 'ignored.webp', hero_filename: 'OAKLENS_Hero.webp' },
    });
    expect(node.querySelector('.wk-img').style.backgroundImage).toBe(HERO_URL);
  });
});

describe('the image gate — anything doubtful falls back, silently', () => {
  // A broken image on the homepage is worse than a text tile, so the gate is
  // "can we build a CDN URL from this", not "did the author ask for hero".
  it.each([
    ['no hero at all', {}],
    ['an empty hero', { hero: '' }],
    ['whitespace', { hero: '   ' }],
    ['a composer data: preview', { hero: 'data:image/webp;base64,AAAA' }],
    ['a blob: preview', { hero: 'blob:https://example/abc' }],
    ['an absolute URL', { hero: 'https://elsewhere.example/pic.webp' }],
    ['a path rather than a filename', { hero: 'archive/pic.webp' }],
    ['a non-string', { hero: 7 }],
  ])('%s → the text layout, with no data-layout', (_label, patch) => {
    const data = { ...HERO_POST, ...patch };
    delete data.hero_filename;
    if (patch.hero === undefined) delete data.hero;
    const node = RI.buildCard({ kind: 'text', data });
    expect(node.hasAttribute('data-layout')).toBe(false);
    expect(node.querySelector('.wk-img')).toBeNull();
    expect(node.querySelector('.wk-snip')).toBeTruthy();
  });

  it('a gated-out hero renders EXACTLY the default text card', () => {
    const asked = RI.buildCard({ kind: 'text', data: { ...SHORT_POST, card: { layout: 'hero' } } });
    const plain = RI.buildCard({ kind: 'text', data: SHORT_POST });
    expect(asked.outerHTML).toBe(plain.outerHTML);
  });

  it('heroFilename normalises what it accepts', () => {
    expect(RI.heroFilename({ hero: '  pic.webp  ' })).toBe('pic.webp');
    expect(RI.heroFilename({ hero_filename: 'a.webp', hero: 'b.webp' })).toBe('a.webp');
    expect(RI.heroFilename({ hero: 'data:x' })).toBe('');
    expect(RI.heroFilename(null)).toBe('');
  });

  it('layoutFor gates a name resolveLayout would happily return', () => {
    // The two answer different questions: the engine knows 'hero', this entry
    // still cannot wear it.
    expect(RI.resolveLayout('text', 'hero')).toBe('hero');
    expect(RI.layoutFor('text', { card: { layout: 'hero' } })).toBe('default');
    expect(RI.layoutFor('text', HERO_POST)).toBe('hero');
    // A kind with no gate table is untouched by the mechanism.
    expect(RI.layoutFor('photo', ARCHIVE_ENTRY)).toBe('default');
  });
});

describe('the hero layout on the real selection path', () => {
  it('rides pickRecent → buildCard without disturbing the other cards', () => {
    const picks = RI.pickRecent([ARCHIVE_ENTRY], [HERO_POST, SHORT_POST], [], [], { pulse: null });
    const nodes = picks.map((item) => RI.buildCard(item));
    const hero = nodes.find((n) => n.getAttribute('data-layout') === 'hero');
    expect(hero).toBeTruthy();
    expect(hero.querySelector('.wk-img').style.backgroundImage).toBe(HERO_URL);
    // The other note is still the typographic tile.
    const texts = nodes.filter((n) => n.classList.contains('wk-text'));
    expect(texts.length).toBe(2);
    expect(texts.filter((n) => n.hasAttribute('data-layout')).length).toBe(1);
  });
});
