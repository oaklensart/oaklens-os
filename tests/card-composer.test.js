// @vitest-environment happy-dom
//
// Composed cards — the owner's own cards, overlaid on the automatic grid.
//
// THE GUARANTEE THIS FILE EXISTS TO PROTECT: a site with no composed cards gets
// exactly the row it got before this feature. That is why `pickAutomatic` holds
// the original body untouched and `pickRecent` is a thin overlay on top of it —
// the fork promise holds by construction, and the first test below is the proof
// rather than the hope.
//
// The other half is placement. Composed cards carry an ORDER and compact; they
// are NOT pins, so pinTop / VISIBLE_PINS / yieldOlderPin are untouched and
// "card 3 is never an automatic pin" (tests/pulse-card.test.js) stays true. A
// live pulse still leads, because posting one costs no deploy and must never
// silently do nothing.
import { describe, it, expect, beforeAll } from 'vitest';

// Deterministic CDN base — cdnRoot() reads this meta before falling back to
// location.origin, which differs across happy-dom versions.
const meta = document.createElement('meta');
meta.setAttribute('name', 'cdn-base');
meta.setAttribute('content', 'https://cdn.example/api/cdn');
document.head.appendChild(meta);

const ARCHIVE = [
  { slug: 'a-one', filename: 'A1.webp', title: 'One', location: 'Somewhere, 2026', added_at: '2026-08-01T00:00:00Z' },
  { slug: 'a-two', filename: 'A2.webp', title: 'Two', location: 'Somewhere, 2026', added_at: '2026-08-02T00:00:00Z' },
];
const POSTS = [
  { fn_id: 'fn-1', title: 'A Note', location: 'Somewhere', body: 'A one-liner.', added_at: '2026-08-03T00:00:00Z' },
];
const PULSE = { pulse: { id: 'p1', text: 'Tones are singing.', state: 'signal' } };

const composed = (over) => ({
  id: 'c-1', order: 1, media: 'CARD.webp', title: 'The Geometry of Silence',
  added_at: '2026-09-01T00:00:00Z', ...over,
});

let RI;
beforeAll(async () => {
  await import('../js/recent-index.js');
  RI = globalThis.RecentIndex;
});

// ------------------------------------------------------- the default guarantee

describe('a site with no composed cards is untouched', () => {
  // Deep-equal on the whole output, deliberately: the promise is not "similar"
  // but "the same array", and anything less would let a reordering slip through.
  const cases = [
    ['nothing composed at all', undefined],
    ['an explicitly empty list', []],
    ['a list of nothing usable', [{ id: 'x', order: 1 }, null, { id: 'y', media: '   ' }]],
  ];

  for (const [name, cards] of cases) {
    it(`is deep-equal to the automatic row — ${name}`, () => {
      const auto = RI.pickAutomatic(ARCHIVE, POSTS, [], [], PULSE);
      expect(RI.pickRecent(ARCHIVE, POSTS, [], [], PULSE, cards)).toEqual(auto);
    });
  }

  it('holds on the unpinned path too', () => {
    // No pulse, no audio, no RAW — pickRecent's second return, which is where
    // the mixed-row guarantee and the slot-3 swap live.
    const auto = RI.pickAutomatic(ARCHIVE, POSTS, [], [], null);
    expect(RI.pickRecent(ARCHIVE, POSTS, [], [], null, [])).toEqual(auto);
  });
});

// ------------------------------------------------------------- composedPick

describe('composedPick', () => {
  it('needs a picture or a line — a card with neither never renders', () => {
    expect(RI.composedPick([{ id: 'a', order: 1 }])).toEqual([]);
    expect(RI.composedPick([{ id: 'a', order: 1, title: '   ' }])).toEqual([]);
    expect(RI.composedPick([{ id: 'a', order: 1, media: 'X.webp' }])).toHaveLength(1);
    expect(RI.composedPick([{ id: 'a', order: 1, title: 'Words' }])).toHaveLength(1);
  });

  it('orders by `order`, not by array position or date', () => {
    const out = RI.composedPick([
      composed({ id: 'c-b', order: 2, title: 'second' }),
      composed({ id: 'c-a', order: 1, title: 'first' }),
    ]);
    expect(out.map((i) => i.data.id)).toEqual(['c-a', 'c-b']);
  });

  it('caps at COMPOSED_MAX and compacts — order is a rank, never a slot', () => {
    expect(RI.COMPOSED_MAX).toBe(2);
    const out = RI.composedPick([
      composed({ id: 'c-a', order: 1 }), composed({ id: 'c-b', order: 2 }),
      composed({ id: 'c-c', order: 3 }),
    ]);
    expect(out.map((i) => i.data.id)).toEqual(['c-a', 'c-b']);

    // Deleting the first must promote the second, not leave a hole. Ranks that
    // no longer start at 1 still resolve — this is the K18 lesson, and the
    // reason `order` is not an index.
    const gapped = RI.composedPick([composed({ id: 'c-c', order: 7 })]);
    expect(gapped.map((i) => i.data.id)).toEqual(['c-c']);
  });

  it('produces items the card engine can build', () => {
    const [item] = RI.composedPick([composed()]);
    expect(item.kind).toBe('composed');
    expect(item.data.id).toBe('c-1');
  });
});

// --------------------------------------------------------------- placement

describe('where composed cards land', () => {
  it('leads the row when no pulse is live', () => {
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], null, [composed()]);
    expect(row[0].kind).toBe('composed');
  });

  it('sits behind a live pulse — posting one is never silently swallowed', () => {
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], PULSE, [composed()]);
    expect(row[0].kind).toBe('pulse');
    expect(row[1].kind).toBe('composed');
  });

  it('both composed cards stay visible under a live pulse', () => {
    // The owner's rule: nothing you compose is ever invisible. With a pulse up
    // that fills the three desktop slots, which is the accepted trade.
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], PULSE, [
      composed({ id: 'c-a', order: 1 }), composed({ id: 'c-b', order: 2 }),
    ]);
    expect(row.map((i) => i.kind).slice(0, 3)).toEqual(['pulse', 'composed', 'composed']);
  });

  it('never returns more than the grid holds', () => {
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], PULSE, [
      composed({ id: 'c-a', order: 1 }), composed({ id: 'c-b', order: 2 }),
    ]);
    expect(row).toHaveLength(4);
  });

  it('pushes automatic picks down rather than replacing them', () => {
    const auto = RI.pickAutomatic(ARCHIVE, POSTS, [], [], null);
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], null, [composed()]);
    expect(row.slice(1)).toEqual(auto.slice(0, 3));
  });

  it('deduplicates automatic picks when a composed card features the same image', () => {
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], null, [composed({ media: 'A1.webp' })]);
    expect(row[0].kind).toBe('composed');
    expect(row[0].data.media).toBe('A1.webp');
    const duplicates = row.slice(1).filter((item) => item.data && (item.data.filename === 'A1.webp' || item.data.slug === 'a-one'));
    expect(duplicates).toHaveLength(0);
  });
});

// ------------------------------------------------------------- the renderer

describe('the composed card', () => {
  const build = (card) => RI.buildCard({ kind: 'composed', data: card });

  it('leads with the picture when it has one', () => {
    const node = build(composed());
    expect(node.querySelector('.wk-img')).not.toBeNull();
    // A picture card's title is the grid CAPTION (.wk-title), the same scale as
    // the archive card beside it — NOT the big words-tile headline, which would
    // loom over the row.
    expect(node.querySelector('.wk-title').textContent).toBe('The Geometry of Silence');
    expect(node.querySelector('.wk-t-title')).toBeNull();
    expect(node.querySelector('.wk-img').style.backgroundImage)
      .toContain('https://cdn.example/api/cdn/archive/CARD-1024w.webp');
  });

  it('wears the words-tile headline (.wk-t-title) only when it has NO picture', () => {
    const node = build(composed({ media: null, title: 'Words lead here' }));
    expect(node.querySelector('.wk-t-title').textContent).toBe('Words lead here');
    expect(node.querySelector('.wk-title')).toBeNull();
  });

  it('reads a wallpaper from its own folder', () => {
    const node = build(composed({ folder: 'wallpaper' }));
    expect(node.querySelector('.wk-img').style.backgroundImage)
      .toContain('/api/cdn/wallpaper/CARD-1024w.webp');
  });

  it('falls back to the typographic tile with no picture, and wears its tier', () => {
    const node = build(composed({ media: null, tease: 'A short line.' }));
    expect(node.querySelector('.wk-img')).toBeNull();
    expect(node.className).toContain('wk-text');
    expect(node.getAttribute('data-tier')).toBe('statement');
    expect(node.querySelector('.wk-snip').textContent).toBe('A short line.');
  });

  it('is a link when it points somewhere, and a plain div when it does not', () => {
    expect(build(composed({ link: '/archive/?f=a-one' })).tagName).toBe('A');
    // A free-form card is authored from nothing and points nowhere — like a
    // pulse, it is a div rather than a dead anchor.
    expect(build(composed()).tagName).toBe('DIV');
  });

  it('refuses a link that would leave the site', () => {
    for (const link of ['https://example.com', '//example.com', 'javascript:alert(1)']) {
      expect(build(composed({ link })).tagName).toBe('DIV');
    }
  });

  it('labels itself, defaulting to Featured', () => {
    expect(build(composed()).querySelector('.wk-tag').textContent).toBe('Featured');
    expect(build(composed({ label: 'Archive' })).querySelector('.wk-tag').textContent)
      .toBe('Archive');
    expect(build(composed({ label: '   ' })).querySelector('.wk-tag').textContent)
      .toBe('Featured');
  });

  it('carries the card crop when one was set', () => {
    const node = build(composed({ cardFocus: '20% 80%' }));
    expect(node.querySelector('.wk-img').style.backgroundPosition).toBe('20% 80%');
  });

  it('marks its shape so the palette tint targets the right surface', () => {
    // The picture-card palette CSS binds to [data-shape="picture"] .wk-body;
    // without this attribute a palette on a picture card painted nothing on the
    // live grid (and the console grid, which renders through here).
    expect(build(composed()).getAttribute('data-shape')).toBe('picture');
    expect(build(composed({ media: null, tease: 'Words.' })).getAttribute('data-shape')).toBe('words');
  });

  it('carries a palette as data-state, and default is the absence of one', () => {
    expect(build(composed({ palette: 'flow' })).getAttribute('data-state')).toBe('flow');
    expect(build(composed({ palette: 'default' })).hasAttribute('data-state')).toBe(false);
    expect(build(composed()).hasAttribute('data-state')).toBe(false);
  });
});

// ------------------------------------------------------------- entryHref

describe('entryHref — one builder for a card\'s destination', () => {
  it('spells each kind\'s canonical link', () => {
    expect(RI.entryHref('archive', { slug: 'a-one' })).toBe('/archive/?f=a-one');
    expect(RI.entryHref('raw', { id: 'buf-9' })).toBe('/archive/buffer/?f=buf-9');
    expect(RI.entryHref('text', { fn_id: 'fn-1' })).toBe('/field-notes/post?slug=fn-1');
    expect(RI.entryHref('audio', { slug: 'track-x' })).toBe('/listen/?a=track-x');
  });

  it('encodes, tolerates missing fields, and refuses an unknown kind', () => {
    expect(RI.entryHref('archive', { slug: 'a b' })).toBe('/archive/?f=a%20b');
    expect(RI.entryHref('archive', {})).toBe('/archive/?f=');
    expect(RI.entryHref('nope', { slug: 'x' })).toBe('');
  });

  it('sends a slugless audio link to the listen PAGE, not to a dangling query', () => {
    // A playlist has no single entry and so no slug. `/listen/?a=` with nothing
    // after it asks the page to open a track that does not exist — and a console
    // takeover of the playlist card published exactly that onto the homepage.
    // The playlist card's own title already points at /listen/.
    expect(RI.entryHref('audio', {})).toBe('/listen/');
    expect(RI.entryHref('audio', null)).toBe('/listen/');
  });

  it('is the SAME string the automatic card renders — parity, not a second copy', () => {
    const photo = RI.buildCard({ kind: 'photo', data: { slug: 'a-one', filename: 'A1.webp', title: 'One' } });
    expect(photo.getAttribute('href')).toBe(RI.entryHref('archive', { slug: 'a-one' }));
    const note = RI.buildCard({ kind: 'text', data: { fn_id: 'fn-1', title: 'A Note', body: 'x' } });
    expect(note.getAttribute('href')).toBe(RI.entryHref('text', { fn_id: 'fn-1' }));
  });
});

// ------------------------------------------------------------ layout + gate

describe('the composed layouts', () => {
  it('registers default, hero and plain — and nothing else resolves', () => {
    expect(RI.cardLayouts.composed).toEqual(['default', 'hero', 'plain']);
    expect(RI.resolveLayout('composed', 'nope')).toBe('default');
  });

  it('gates hero on there actually being a picture', () => {
    expect(RI.layoutFor('composed', composed({ card: { layout: 'hero' } }))).toBe('hero');
    // Same opt-in, no picture: falls back silently rather than rendering a hole.
    expect(RI.layoutFor('composed', composed({ media: null, card: { layout: 'hero' } })))
      .toBe('default');
  });

  it('`plain` forces the words even when a picture is available', () => {
    const node = RI.buildCard({
      kind: 'composed',
      data: composed({ tease: 'Words win.', card: { layout: 'plain' } }),
    });
    expect(node.querySelector('.wk-img')).toBeNull();
    expect(node.getAttribute('data-layout')).toBe('plain');
  });

  it('default adds no data-layout — the byte-identity contract', () => {
    expect(RI.buildCard({ kind: 'composed', data: composed() }).hasAttribute('data-layout'))
      .toBe(false);
  });
});
