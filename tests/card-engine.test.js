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
  it('registers exactly the four kinds, each with default', () => {
    // `composed` was a fifth kind from 2026-09-07 to 2026-09-10. It is now an
    // OVERRIDE on these four (docs/cards-core-complete.md chunk 1;
    // tests/card-composer.test.js) and must never come back as a kind. Every
    // kind must still offer 'default', because that is what an unknown layout
    // falls back to.
    expect(Object.keys(RI.cardLayouts).sort())
      .toEqual(['audio', 'photo', 'pulse', 'text']);
    expect(RI.cardLayouts.composed).toBeUndefined();
    for (const kind of Object.keys(RI.cardLayouts)) {
      expect(RI.cardLayouts[kind]).toContain('default');
    }
  });

  it('`composed` is not a registered kind, and an old `layout: plain` record still renders', () => {
    // The shipped console wrote `card: { layout: 'plain' }` for "always the
    // words". That name is nobody's layout now — it normalizes to the text kind
    // — and it must degrade to a rendered card, never a throw or a hole.
    expect(RI.resolveLayout('composed', 'plain')).toBe('default');
    expect(RI.resolveLayout('text', 'plain')).toBe('default');
    const [item] = RI.composedPick([{ id: 'c-old', order: 1, media: 'OLD.webp', title: 'Old', card: { layout: 'plain' } }]);
    expect(item.kind).toBe('text');
    const node = RI.buildCard(item);
    expect(node.classList.contains('wk-text')).toBe(true);
    expect(node.querySelector('.wk-img')).toBeNull();
    expect(node.hasAttribute('data-layout')).toBe(false);
    expect(node.querySelector('.wk-t-title').textContent).toBe('Old');
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
    // 'overlay' joined both picture-capable kinds in chunk 3; 'hero' is still
    // the text kind's alone — it is what a NOTE does with its picture, where
    // overlay is what any card does with one.
    expect(RI.cardLayouts.text).toEqual(['default', 'hero', 'overlay']);
    expect(RI.cardLayouts.photo).toEqual(['default', 'overlay']);
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

// ---- Chunk 3: the overlay layout (docs/cards-core-complete.md) ----
//
// The image ladder, v1. Two things are being pinned here, and they are
// different in kind:
//
//   1. THE SPLIT. The engine emits four attributes and NOTHING else — no
//      colour, no gradient, no measurement at render time. That is what makes
//      the layout survive the offline export, which runs from file:// with no
//      network and no layout to measure.
//   2. THE INK THRESHOLD. Derived, never authored (§2.2), so the number has to
//      be a pinned contract rather than a sentence in a comment.
const OV_PHOTO = {
  id: 'c-ov', order: 1, kind: 'photo', title: 'Evening, over the water',
  tease: 'Twenty minutes before it went', media: 'OAKLENS_Hero.webp',
  card: { layout: 'overlay' }, added_at: '2026-09-10',
};

describe('the overlay layout — the words on the picture', () => {
  it('registers on both picture-capable kinds and on neither of the others', () => {
    expect(RI.cardLayouts.photo).toContain('overlay');
    expect(RI.cardLayouts.text).toContain('overlay');
    expect(RI.cardLayouts.audio).not.toContain('overlay');
    expect(RI.cardLayouts.pulse).not.toContain('overlay');
  });

  it('puts the body INSIDE the picture and stamps the four attributes', () => {
    const node = RI.buildCard(RI.composedItem(OV_PHOTO));
    expect(node.getAttribute('data-layout')).toBe('overlay');
    expect(node.getAttribute('data-place')).toBe('bottom');
    expect(node.getAttribute('data-treat')).toBe('scrim');
    expect(node.getAttribute('data-ink')).toBe('light');

    // The one structural difference between an overlay card and its default:
    // which element the body hangs off. Same nodes, same text, same order.
    const img = node.querySelector('.wk-img');
    expect(img.querySelector('.wk-body')).toBeTruthy();
    expect(node.querySelector(':scope > .wk-body')).toBeNull();
    expect(img.querySelector('.wk-title').textContent).toBe('Evening, over the water');
    expect(img.querySelector('.wk-meta').textContent).toBe('Twenty minutes before it went');
  });

  it('carries data-blur only under the frosted treatment', () => {
    const scrim = RI.buildCard(RI.composedItem(OV_PHOTO));
    expect(scrim.hasAttribute('data-blur')).toBe(false);

    const frosted = RI.buildCard(RI.composedItem({
      ...OV_PHOTO, overlay: { treat: 'blur', blur: 3 },
    }));
    expect(frosted.getAttribute('data-treat')).toBe('blur');
    expect(frosted.getAttribute('data-blur')).toBe('3');
  });

  it('emits no colour, gradient or measurement of its own', () => {
    // The division of labour: JS sets attributes, CSS owns everything
    // downstream. The only inline style on the card is the picture the renderer
    // has always set.
    const node = RI.buildCard(RI.composedItem({
      ...OV_PHOTO, overlay: { place: 'top', treat: 'blur', blur: 1 },
      img: { lum: { top: 0.9, mid: 0.4, bottom: 0.1 } },
    }));
    const styled = [...node.querySelectorAll('[style]')].map((n) => n.getAttribute('style'));
    for (const s of styled) {
      expect(s).toMatch(/^background-image:|^background-position:|background-image:.*background-position/);
    }
    expect(node.outerHTML).not.toMatch(/rgba?\(|gradient|blur\(/);
  });

  it('reads the author\'s choices, and falls back to a legible card for anything else', () => {
    expect(RI.overlayOf(null)).toEqual({ place: 'bottom', treat: 'scrim', blur: 2 });
    expect(RI.overlayOf({ overlay: { place: 'top', treat: 'none', blur: 1 } }))
      .toEqual({ place: 'top', treat: 'none', blur: 1 });
    // A record from a NEWER console, naming values this engine has never heard
    // of, degrades to the safe default rather than to a broken card — the same
    // contract resolveLayout makes for layout names.
    expect(RI.overlayOf({ overlay: { place: 'diagonal', treat: 'neon', blur: 9 } }))
      .toEqual({ place: 'bottom', treat: 'scrim', blur: 2 });
    expect(RI.overlayOf({ overlay: 'bottom' }))
      .toEqual({ place: 'bottom', treat: 'scrim', blur: 2 });
  });

  // The derived half. 0.55, and the band the placement reads.
  it.each([
    ['bottom', { top: 0.9, mid: 0.9, bottom: 0.1 }, 'light'],
    ['bottom', { top: 0.1, mid: 0.1, bottom: 0.9 }, 'dark'],
    ['top', { top: 0.9, mid: 0.1, bottom: 0.1 }, 'dark'],
    // 'centre' is the placement's word; 'mid' is the crop's. They are the one
    // pair that does not share a name, so this case is the mapping.
    ['centre', { top: 0.1, mid: 0.8, bottom: 0.1 }, 'dark'],
    ['centre', { top: 0.9, mid: 0.2, bottom: 0.9 }, 'light'],
    // The threshold itself: the tie goes to light, and dark waits for a
    // genuinely bright band.
    ['bottom', { bottom: 0.55 }, 'dark'],
    ['bottom', { bottom: 0.54 }, 'light'],
  ])('ink at %s over %j is %s', (place, lum, ink) => {
    expect(RI.overlayInk({ img: { lum } }, place)).toBe(ink);
  });

  it('an unmeasured card takes light ink — the legible answer over the default scrim', () => {
    expect(RI.INK_THRESHOLD).toBe(0.55);
    expect(RI.overlayInk({}, 'bottom')).toBe('light');
    expect(RI.overlayInk({ img: {} }, 'bottom')).toBe('light');
    expect(RI.overlayInk({ img: { lum: { bottom: 'bright' } } }, 'bottom')).toBe('light');
    expect(RI.overlayInk(null, 'bottom')).toBe('light');
  });

  it('refuses the layout on a card with no picture to write on', () => {
    const wordsOnly = { ...OV_PHOTO, kind: 'text' };
    delete wordsOnly.media;
    const node = RI.buildCard(RI.composedItem(wordsOnly));
    expect(node.hasAttribute('data-layout')).toBe(false);
    expect(node.hasAttribute('data-place')).toBe(false);
    // And it is EXACTLY the words tile — the gate falls back silently, it does
    // not half-render.
    const plain = { ...wordsOnly };
    delete plain.card;
    expect(node.outerHTML).toBe(RI.buildCard(RI.composedItem(plain)).outerHTML);
  });

  it('a note wearing overlay is the hero card with its words moved onto the picture', () => {
    const node = RI.buildCard({ kind: 'text', data: { ...HERO_POST, card: { layout: 'overlay' } } });
    expect(node.getAttribute('data-layout')).toBe('overlay');
    expect(node.classList.contains('wk-text')).toBe(true);
    const img = node.querySelector('.wk-img');
    expect(img.style.backgroundImage).toBe(HERO_URL);
    // The kicker stays where the kind puts it — the on-media chip, exactly as
    // the hero card wears it. Only the body moved.
    expect(img.querySelector('.wk-tag').textContent).toBe('Field Note');
    expect(img.querySelector('.wk-t-title').textContent).toBe('The Long Way Round');

    // Same nodes as the hero card: the difference is the parent and the
    // attributes, nothing else.
    const hero = RI.buildCard({ kind: 'text', data: HERO_POST });
    expect(node.querySelector('.wk-body').innerHTML).toBe(hero.querySelector('.wk-body').innerHTML);
  });

  it('a composed note wearing overlay still reports the picture shape', () => {
    // composedShape is what the console's composer and the palette CSS bind to;
    // a picture-led card that called itself 'words' would draw the wrong face.
    expect(RI.composedShape({ kind: 'text', media: 'X.webp', card: { layout: 'overlay' } }))
      .toBe('picture');
    expect(RI.composedShape({ kind: 'text', media: 'X.webp' })).toBe('words');
  });

  it('changes NOTHING for a card that never asked for it', () => {
    // The byte-identity contract, asked of the two kinds that gained the layout.
    const photo = RI.buildCard({ kind: 'photo', data: ARCHIVE_ENTRY });
    expect(photo.hasAttribute('data-layout')).toBe(false);
    expect(photo.hasAttribute('data-ink')).toBe(false);
    expect(photo.querySelector('.wk-img .wk-body')).toBeNull();
    // And a record carrying an overlay block it never wears is inert.
    const inert = RI.buildCard(RI.composedItem({
      id: 'c-x', order: 1, kind: 'photo', media: 'OAKLENS_Hero.webp', title: 'Plain',
      overlay: { place: 'top', treat: 'blur', blur: 1 },
    }));
    expect(inert.hasAttribute('data-place')).toBe(false);
  });
});

// ---- the plate: the band's type is a ladder and a mark, both stamped ----
//
// Owner, 2026-09-11: the band read as a generic template. The fix is
// typographic and lives in the stylesheets, but the two decisions it needs —
// how large the title runs, and whether it closes on the accent full stop — are
// stamped here as attributes, the way data-tier is for the words tile. Pinned
// as pure functions so the steps are numbers, not sentences.
describe('the plate — the title\'s scale and its mark', () => {
  it('steps the scale down as the title gets longer, counted in graphemes', () => {
    expect(RI.overlayScales).toEqual(['statement', 'feature', 'standard', 'compact']);
    expect(RI.overlayScale('Kearny')).toBe('statement');
    expect(RI.overlayScale('Twelve chars')).toBe('statement');          // 12
    expect(RI.overlayScale('Thirteen char')).toBe('feature');           // 13
    expect(RI.overlayScale('A title of twenty-four!!')).toBe('feature'); // 24
    expect(RI.overlayScale('Twenty-five characters..')).toBe('feature'); // 24 — the comment lies, the count does not
    expect(RI.overlayScale('A title that runs to forty characters..')).toBe('standard'); // 39
    expect(RI.overlayScale('A title that runs to forty-one characters')).toBe('compact'); // 41
    // Graphemes, not code units: a frame citation and a CJK line are both short.
    expect(RI.overlayScale('f#234')).toBe('statement');
    expect(RI.overlayScale('東京の夜, 静か')).toBe('statement');
    expect(RI.overlayScale('🌊🌊🌊🌊🌊')).toBe('statement');
    expect(RI.overlayScale('')).toBe('statement');
  });

  it('marks a title that the author left open, and only that', () => {
    expect(RI.overlayMark('Kearny Phantom')).toBe('dot');
    expect(RI.overlayMark('Kearny Phantom  ')).toBe('dot');        // trailing space is not a stop
    for (const closed of ['Done.', 'Really?', 'Now!', 'Wait…', 'Thus:', 'So;', 'Or,',
      'A dash —', 'A hyphen -', '“Quoted”', "'Quoted'", '"Quoted"', '(aside)', '[note]']) {
      expect(RI.overlayMark(closed), closed).toBe('');
    }
    expect(RI.overlayMark('')).toBe('');
    expect(RI.overlayMark(null)).toBe('');
  });

  it('stamps both on the card, read off the headline the kind built', () => {
    const node = RI.buildCard(RI.composedItem(OV_PHOTO));
    expect(node.getAttribute('data-scale')).toBe('feature');    // 23 graphemes
    expect(node.getAttribute('data-mark')).toBe('dot');

    const closed = RI.buildCard(RI.composedItem({ ...OV_PHOTO, title: 'Gone.' }));
    expect(closed.getAttribute('data-scale')).toBe('statement');
    // An attribute nothing reads is a value somebody will later believe in.
    expect(closed.hasAttribute('data-mark')).toBe(false);

    // A note wearing overlay gets the same two, off its .wk-t-title.
    const note = RI.buildCard(RI.composedItem({
      ...OV_PHOTO, id: 'c-ovt', kind: 'text', title: 'On the way',
    }));
    expect(note.getAttribute('data-scale')).toBe('statement');
    expect(note.getAttribute('data-mark')).toBe('dot');

    // The mark is the STYLESHEET's: the title's text is exactly as typed.
    expect(node.querySelector('.wk-title').textContent).toBe('Evening, over the water');
  });

  it('never reaches a card that is not wearing the layout', () => {
    const plain = RI.buildCard(RI.composedItem({ ...OV_PHOTO, card: undefined }));
    expect(plain.hasAttribute('data-scale')).toBe(false);
    expect(plain.hasAttribute('data-mark')).toBe(false);
  });
});

describe('the overlay layout on the real selection path', () => {
  it('rides pickRecent → buildCard on an automatic frame', () => {
    const entry = { ...ARCHIVE_ENTRY, card: { layout: 'overlay' } };
    const picks = RI.pickRecent([entry], [SHORT_POST], [], [], { pulse: null });
    const nodes = picks.map((item) => RI.buildCard(item));
    const ov = nodes.find((n) => n.getAttribute('data-layout') === 'overlay');
    expect(ov).toBeTruthy();
    // An automatic entry carries no measurement — nothing measures one — so it
    // takes light ink over the default scrim, which is legible on any picture.
    expect(ov.getAttribute('data-ink')).toBe('light');
    expect(ov.getAttribute('data-treat')).toBe('scrim');
    expect(ov.querySelector('.wk-img .wk-body')).toBeTruthy();
    // Nothing else on the row moved.
    expect(nodes.filter((n) => n.hasAttribute('data-layout')).length).toBe(1);
  });
});

// ---------------------------------------------- chunk 5: what an audio card plays
//
// A composed audio card names a SOURCE and the registry answers — it is the one
// kind whose entry is not empty (composedItem's comment says why at length).
// Two sources and only two: a borrowed set, or the homepage tracks. The second
// is what makes taking the audio slot over free of the 2026-09-07 hole — the
// takeover copies nothing, so the card keeps playing what it was playing.
describe('the audio source — a borrowed set, or the homepage tracks', () => {
  const T = (slug, over) => ({
    id: `t-${slug}`, slug, filename: `${slug}.mp3`, title: slug.toUpperCase(),
    duration: 30, added_at: '2026-09-01', ...over,
  });
  const REGISTRY = [
    T('one', { featured: true, featured_order: 1 }),
    T('two', { featured: true, featured_order: 2 }),
    T('three'),
    { id: 't-gone', slug: 'gone', retired: true },
  ];
  const SETS = [
    { slug: 'dusk', name: 'Dusk mix', tracks: ['three', 'one'], added_at: '2026-09-05' },
    { slug: 'empty', name: 'All retired', tracks: ['gone'], added_at: '2026-09-05' },
    { slug: 'old', name: 'Retired set', tracks: ['one'], retired: true, added_at: '2026-09-05' },
    { slug: 'solo', name: 'One only', tracks: ['three'], added_at: '2026-09-05' },
  ];
  const card = (over) => ({ id: 'c-a', order: 1, kind: 'audio', added_at: '2026-09-10', ...over });

  beforeAll(async () => {
    // The real load order: index.html loads audio-player BEFORE recent-index,
    // because resolveSetTracks is the ONE answer to "what does this set play"
    // and the engine calls it rather than keeping a second copy (chunk 4).
    await import('../js/audio-player.js');
  });

  it('no set → the homepage tracks, in featured order, capped', () => {
    expect(RI.composedTracks(card(), REGISTRY, SETS).map((t) => t.slug)).toEqual(['one', 'two']);
  });

  it('a set → its own tracks, in the set’s order, retired ones dropped', () => {
    expect(RI.composedTracks(card({ set: 'dusk' }), REGISTRY, SETS).map((t) => t.slug))
      .toEqual(['three', 'one']);
    // A set whose every track retired plays nothing — and says so by being
    // empty rather than by falling back to the homepage tracks, which would be
    // a card quietly playing something the author never chose.
    expect(RI.composedTracks(card({ set: 'empty' }), REGISTRY, SETS)).toEqual([]);
    // A retired SET is a slug reservation, not a playlist.
    expect(RI.composedTracks(card({ set: 'old' }), REGISTRY, SETS)).toEqual([]);
    // A set that is not there at all.
    expect(RI.composedTracks(card({ set: 'nope' }), REGISTRY, SETS)).toEqual([]);
  });

  it('the cap is applied on read too — a hand-edited file cannot publish a long card', () => {
    const many = Array.from({ length: 9 }, (_, i) => T(`m${i}`));
    const big = [{ slug: 'big', name: 'Big', tracks: many.map((t) => t.slug) }];
    expect(RI.composedTracks(card({ set: 'big' }), many, big).length)
      .toBe(RI.AUDIO_MAX_PLAYLIST);
  });

  it('more than one track is the playlist card, exactly one is the single card', () => {
    const many = RI.buildCard(RI.composedItem(card(), REGISTRY, SETS));
    expect(many.classList.contains('wk-audio-playlist')).toBe(true);
    expect(many.querySelectorAll('.wk-pl-item').length).toBe(2);

    const one = RI.buildCard(RI.composedItem(card({ set: 'solo' }), REGISTRY, SETS));
    expect(one.classList.contains('wk-audio-playlist')).toBe(false);
    expect(one.classList.contains('wk-audio')).toBe(true);
  });

  it('a borrowed set names the card and gives it the set’s own address', () => {
    const node = RI.buildCard(RI.composedItem(card({ set: 'dusk' }), REGISTRY, SETS));
    expect(node.querySelector('.wk-a-title').textContent).toBe('Dusk mix');
    expect(node.querySelector('.wk-a-title a').getAttribute('href')).toBe('/listen/?set=dusk');
    // In the set's order, not the registry's.
    expect([...node.querySelectorAll('.wk-pl-name')].map((a) => a.textContent))
      .toEqual(['THREE', 'ONE']);
    // The single-card shape agrees — name and address are one decision.
    const solo = RI.buildCard(RI.composedItem(card({ set: 'solo' }), REGISTRY, SETS));
    expect(solo.querySelector('.wk-a-title').textContent).toBe('One only');
    expect(solo.querySelector('.wk-a-title a').getAttribute('href')).toBe('/listen/?set=solo');
  });

  it('the author’s words are the caption, under the waveform — never the headline', () => {
    const node = RI.buildCard(RI.composedItem(
      card({ set: 'dusk', title: 'For the drive home', tease: 'Two takes, one evening.' }),
      REGISTRY, SETS,
    ));
    expect(node.querySelector('.wk-a-title').textContent).toBe('Dusk mix');
    expect(node.querySelector('.wk-body .wk-title').textContent).toBe('For the drive home');
    expect(node.querySelector('.wk-body .wk-meta').textContent).toBe('Two takes, one evening.');
    // UNDER THE WAVEFORM, and on the playlist card that means inside the head:
    // after the transport, above the index's rule. Below the index it sat flush
    // against the last track and read as a third row (found by opening the
    // page, not by this suite).
    const kids = [...node.children].map((n) => n.className);
    expect(kids.indexOf('wk-body')).toBeGreaterThan(kids.findIndex((c) => c.startsWith('ap')));
    expect(kids.indexOf('wk-body')).toBeLessThan(kids.indexOf('wk-pl-index'));
    // No tier ladder and no drop cap on an audio card (§2.2).
    expect(node.hasAttribute('data-tier')).toBe(true);   // the PLAYLIST ladder, by row count
    expect(node.querySelector('.wk-dropcap')).toBeNull();
    expect(node.querySelector('.wk-snip')).toBeNull();
  });

  it('an audio card earns its slot with no picture and no words — the tracks are the content', () => {
    const picks = RI.pickRecent([], [], [], REGISTRY, null, [card()], SETS);
    expect(picks.filter((p) => p.kind === 'audio').length).toBe(1);
    expect(picks[0].over).toBeTruthy();
    // …but one that plays nothing and says nothing is still dropped.
    expect(RI.pickRecent([], [], [], [], null, [card()], SETS)
      .filter((p) => p.over)).toEqual([]);
  });

  it('a composed audio card takes the audio slot — the automatic one steps aside', () => {
    const withComposed = RI.pickRecent([ARCHIVE_ENTRY], [SHORT_POST], [], REGISTRY, null, [card({ set: 'dusk' })], SETS);
    const audio = withComposed.filter((p) => p.kind === 'audio');
    expect(audio.length).toBe(1);
    expect(audio[0].over).toBeTruthy();
    // Without one, the automatic audio card is exactly where it always was.
    const auto = RI.pickRecent([ARCHIVE_ENTRY], [SHORT_POST], [], REGISTRY, null, [], SETS);
    expect(auto.filter((p) => p.kind === 'audio').length).toBe(1);
    expect(auto.filter((p) => p.kind === 'audio')[0].over).toBeUndefined();
  });

  it('a COMPOSED card of another kind leaves the audio slot alone', () => {
    const picks = RI.pickRecent([ARCHIVE_ENTRY], [SHORT_POST], [], REGISTRY, null,
      [{ id: 'c-p', order: 1, media: 'CARD.webp', title: 'A picture' }], SETS);
    expect(picks.filter((p) => p.kind === 'audio').length).toBe(1);
    expect(picks.filter((p) => p.kind === 'audio')[0].over).toBeUndefined();
  });
});
