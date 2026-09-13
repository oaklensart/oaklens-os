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
//
// AND A COMPOSED CARD IS NOT A KIND (docs/cards-core-complete.md chunk 1,
// 2026-09-10). composedPick hands buildCard `{ kind, data: {}, over: card }`:
// the record names a kind (or the normalizer composedKind reads one off its
// shape), the kind's own renderer draws it, and `over` is the record whose
// fields win. The renderer describes below assert that for every kind — the
// override beats the entry, an absent override falls through — and that the
// legacy `default | hero | plain` vocabulary still resolves. The BYTES of every
// legacy shape are pinned separately (tests/cards-legacy-fixtures.test.js).
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
// A bare record — only what every record carries — for the normalizer cases.
const base = (over) => ({ id: 'c-0', order: 1, added_at: '2026-09-01T00:00:00Z', ...over });

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
    expect(out.map((i) => i.over.id)).toEqual(['c-a', 'c-b']);
  });

  it('caps at COMPOSED_MAX and compacts — order is a rank, never a slot', () => {
    expect(RI.COMPOSED_MAX).toBe(2);
    const out = RI.composedPick([
      composed({ id: 'c-a', order: 1 }), composed({ id: 'c-b', order: 2 }),
      composed({ id: 'c-c', order: 3 }),
    ]);
    expect(out.map((i) => i.over.id)).toEqual(['c-a', 'c-b']);

    // Deleting the first must promote the second, not leave a hole. Ranks that
    // no longer start at 1 still resolve — this is the K18 lesson, and the
    // reason `order` is not an index.
    const gapped = RI.composedPick([composed({ id: 'c-c', order: 7 })]);
    expect(gapped.map((i) => i.over.id)).toEqual(['c-c']);
  });

  it('produces items the card engine can build — a real kind, an empty entry, the record as overrides', () => {
    const [item] = RI.composedPick([composed()]);
    expect(item.kind).toBe('photo');
    expect(item.data).toEqual({});
    expect(item.over.id).toBe('c-1');
    expect(item.d).toBe('2026-09-01T00:00:00Z');
  });
});

// ------------------------------------------------------------ the normalizer

describe('composedKind — which kind a record renders as', () => {
  it('honours a stated kind', () => {
    expect(RI.composedKind({ kind: 'text', media: 'X.webp' })).toBe('text');
    expect(RI.composedKind({ kind: 'audio' })).toBe('audio');
    expect(RI.composedKind({ kind: 'photo', media: 'X.webp' })).toBe('photo');
  });

  it('a stated photo with no usable picture degrades to text — a hole is not a card', () => {
    expect(RI.composedKind({ kind: 'photo', title: 'Words' })).toBe('text');
    expect(RI.composedKind({ kind: 'photo', media: 'data:image/webp;base64,AAAA' })).toBe('text');
  });

  // The shipped console wrote no `kind`. Its renderer decided by SHAPE —
  // `media && layout !== 'plain'` — and the normalizer reads those records the
  // same way, one case per shape it could write.
  it.each([
    ['no picture, words', { title: 'Words' }, 'text'],
    ['a picture', { media: 'X.webp' }, 'photo'],
    ['a picture, layout default', { media: 'X.webp', card: { layout: 'default' } }, 'photo'],
    ['a picture, layout hero', { media: 'X.webp', card: { layout: 'hero' } }, 'photo'],
    ['a picture, layout plain — the words were asked for', { media: 'X.webp', card: { layout: 'plain' } }, 'text'],
    ['no picture, layout hero (gated out)', { title: 'Words', card: { layout: 'hero' } }, 'text'],
    ['a takeover of an archive photo', { media: 'X.webp', source: { surface: 'archive', id: 'a' } }, 'photo'],
    ['a takeover of a note with no hero', { title: 'Words', source: { surface: 'posts', id: 'fn-1' } }, 'text'],
    ['an unusable picture', { media: 'https://elsewhere.example/x.webp', title: 'Words' }, 'text'],
    ['an unknown kind string is treated as legacy', { kind: 'mystery', media: 'X.webp' }, 'photo'],
  ])('legacy — %s → %s', (_name, card, kind) => {
    expect(RI.composedKind(base(card))).toBe(kind);
  });

  it('composedShape agrees with the attribute the rendered root wears — one answer, not two', () => {
    for (const card of [
      base({ title: 'Words' }),
      base({ media: 'X.webp' }),
      base({ media: 'X.webp', card: { layout: 'plain' } }),
      base({ kind: 'text', media: 'X.webp', card: { layout: 'hero' } }),
      base({ kind: 'text', title: 'Words', card: { layout: 'hero' } }),
      base({ kind: 'audio', title: 'A track' }),
    ]) {
      expect(RI.buildCard(RI.composedItem(card)).getAttribute('data-shape')).toBe(RI.composedShape(card));
    }
  });
});

// --------------------------------------------------------------- placement

describe('where composed cards land', () => {
  // A made item is told apart by `over` — the record riding it — never by kind.
  const isMade = (item) => Boolean(item && item.over);

  it('leads the row when no pulse is live', () => {
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], null, [composed()]);
    expect(isMade(row[0])).toBe(true);
  });

  it('sits behind a live pulse — posting one is never silently swallowed', () => {
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], PULSE, [composed()]);
    expect(row[0].kind).toBe('pulse');
    expect(isMade(row[1])).toBe(true);
  });

  it('both composed cards stay visible under a live pulse', () => {
    // The owner's rule: nothing you compose is ever invisible. With a pulse up
    // that fills the three desktop slots, which is the accepted trade.
    const row = RI.pickRecent(ARCHIVE, POSTS, [], [], PULSE, [
      composed({ id: 'c-a', order: 1 }), composed({ id: 'c-b', order: 2 }),
    ]);
    expect(row[0].kind).toBe('pulse');
    expect(row.slice(1, 3).map((i) => i.over.id)).toEqual(['c-a', 'c-b']);
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
    expect(isMade(row[0])).toBe(true);
    expect(row[0].over.media).toBe('A1.webp');
    const duplicates = row.slice(1).filter((item) => item.data && (item.data.filename === 'A1.webp' || item.data.slug === 'a-one'));
    expect(duplicates).toHaveLength(0);
  });
});

// ------------------------------------------------------------- the renderer

describe('the composed card', () => {
  const build = (card) => RI.buildCard(RI.composedItem(card));

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

// ----------------------------------------------------- overrides, per kind
//
// buildCard is the seam: an item may carry BOTH an entry and overrides, and
// each kind's renderer reads every overridable field as over.field ?? entry.field.
// (pickRecent always hands over an empty entry — a record carries everything
// it shows — so these feed buildCard directly to prove the fall-through.)

describe('overrides — the record wins, an absent override falls through', () => {
  const ENTRY_PHOTO = { slug: 'a-one', filename: 'A1.webp', title: 'One', location: 'Somewhere, 2026', camera: 'Mirrorless', cardFocus: '1% 2%' };
  const ENTRY_POST = { fn_id: 'fn-1', title: 'A Note', location: 'Somewhere', body: 'The note body.', added_at: '2026-08-03T00:00:00Z' };
  const ENTRY_AUDIO = { slug: 'track-x', filename: 'x.mp3', title: 'Track X', duration: 30, peaks: '' };

  it('photo — title, picture, crop and chip; the caption is the tease or nothing', () => {
    const over = RI.buildCard({ kind: 'photo', data: ENTRY_PHOTO, over: { media: 'CARD.webp', folder: 'wallpaper', cardFocus: '9% 9%', title: 'Mine', tease: 'A caption.', label: 'New work', link: '/archive/?f=a-one' } });
    expect(over.querySelector('.wk-title').textContent).toBe('Mine');
    expect(over.querySelector('.wk-meta').textContent).toBe('A caption.');
    expect(over.querySelector('.wk-tag').textContent).toBe('New work');
    expect(over.querySelector('.wk-img').style.backgroundImage).toContain('/wallpaper/CARD-1024w.webp');
    expect(over.querySelector('.wk-img').style.backgroundPosition).toBe('9% 9%');
    expect(over.getAttribute('href')).toBe('/archive/?f=a-one');

    const through = RI.buildCard({ kind: 'photo', data: ENTRY_PHOTO, over: { media: 'CARD.webp' } });
    expect(through.querySelector('.wk-title').textContent).toBe('One');
    expect(through.querySelector('.wk-img').style.backgroundPosition).toBe('1% 2%');
    // A composed card's chip is its own word, "Featured" by default — never
    // the entry's kind word; and with no tease there is no caption line.
    expect(through.querySelector('.wk-tag').textContent).toBe('Featured');
    expect(through.querySelector('.wk-meta')).toBeNull();
    // No link on the record → a plain div, not the entry's address.
    expect(through.tagName).toBe('DIV');

    const auto = RI.buildCard({ kind: 'photo', data: ENTRY_PHOTO });
    expect(auto.querySelector('.wk-meta').textContent).toBe('Mirrorless · 2026');
    expect(auto.classList.contains('wk-composed')).toBe(false);
  });

  it('text — the tease is the tile\'s words, the title its headline, the label its kicker', () => {
    const over = RI.buildCard({ kind: 'text', data: ENTRY_POST, over: { title: 'Mine', tease: 'Typed words.', label: 'Field Note' } });
    expect(over.querySelector('.wk-t-title').textContent).toBe('Mine');
    expect(over.querySelector('.wk-snip').textContent).toBe('Typed words.');
    expect(over.querySelector('.wk-kicker').textContent).toBe('Field Note');
    expect(over.getAttribute('data-tier')).toBe('statement');
    // It IS the field-note tile: the same kicker markup, the caret, the cap.
    expect(over.querySelector('.wk-kicker').tagName).toBe('SPAN');
    expect(over.querySelector('.wk-dot').getAttribute('aria-hidden')).toBe('true');
    expect(over.querySelector('.ed-caret')).not.toBeNull();
    const long = RI.buildCard({ kind: 'text', data: {}, over: { title: 'T', tease: 'A line long enough to leave the statement tier and settle in the middle rung of the ladder.' } });
    expect(long.querySelector('.wk-dropcap').textContent).toBe('A');
    // But no place-and-year line — every word on a composed card was typed.
    expect(over.querySelector('.wk-t-meta')).toBeNull();

    const through = RI.buildCard({ kind: 'text', data: ENTRY_POST, over: {} });
    expect(through.querySelector('.wk-t-title').textContent).toBe('A Note');
    expect(through.querySelector('.wk-snip').textContent).toBe('The note body.');
    expect(through.querySelector('.wk-kicker').textContent).toBe('Featured');

    const auto = RI.buildCard({ kind: 'text', data: ENTRY_POST });
    expect(auto.querySelector('.wk-t-meta').textContent).toBe('Somewhere · 2026');
    expect(auto.querySelector('.wk-kicker').textContent).toBe('Field Note');
  });

  it('text wearing hero — a composed text card WITH a picture can; one without cannot', () => {
    const hero = RI.buildCard({ kind: 'text', data: {}, over: { media: 'CARD.webp', title: 'Mine', tease: 'A caption.', card: { layout: 'hero' } } });
    expect(hero.getAttribute('data-layout')).toBe('hero');
    expect(hero.getAttribute('data-shape')).toBe('picture');
    expect(hero.querySelector('.wk-img').style.backgroundImage).toContain('/archive/CARD-1024w.webp');
    expect(hero.querySelector('.wk-t-title').textContent).toBe('Mine');
    expect(hero.querySelector('.wk-meta').textContent).toBe('A caption.');

    const gated = RI.buildCard({ kind: 'text', data: {}, over: { title: 'Mine', card: { layout: 'hero' } } });
    expect(gated.hasAttribute('data-layout')).toBe(false);
    expect(gated.querySelector('.wk-img')).toBeNull();
    expect(gated.getAttribute('data-shape')).toBe('words');

    // The record's descriptor wins over the entry's, and falls through to it.
    expect(RI.layoutFor('text', { hero: 'H.webp', card: { layout: 'hero' } }, { card: { layout: 'default' } })).toBe('default');
    expect(RI.layoutFor('text', { hero: 'H.webp', card: { layout: 'hero' } }, {})).toBe('hero');
  });

  // CHUNK 5 MOVED THIS CONTRACT, and the move is the point. Chunk 1 put the
  // override on `.wk-a-title` because the audio card had nowhere else to put
  // words; chunk 5 gives it somewhere. The headline now names WHAT IS PLAYING
  // (the registry's answer) and the author's words are the caption underneath,
  // in the picture card's `.wk-title` / `.wk-meta` grammar — §2.2 of
  // docs/cards-core-complete.md: a caption, never a statement.
  it('audio — the headline names the track, the author\'s words are the caption', () => {
    const over = RI.buildCard({ kind: 'audio', data: ENTRY_AUDIO, over: { title: 'Mine', tease: 'Recorded at dawn.' } });
    expect(over.querySelector('.wk-a-title').textContent).toBe('Track X');
    expect(over.querySelector('.wk-body .wk-title').textContent).toBe('Mine');
    expect(over.querySelector('.wk-body .wk-meta').textContent).toBe('Recorded at dawn.');
    expect(over.classList.contains('wk-composed')).toBe(true);
    expect(over.getAttribute('data-shape')).toBe('audio');

    // No typed words, no caption block — the captionOf rule: a blank line under
    // a waveform reads as a gap, not as a caption.
    const through = RI.buildCard({ kind: 'audio', data: ENTRY_AUDIO, over: {} });
    expect(through.querySelector('.wk-a-title').textContent).toBe('Track X');
    expect(through.querySelector('.wk-body')).toBeNull();

    // Title only, tease only — each renders alone.
    const titleOnly = RI.buildCard({ kind: 'audio', data: ENTRY_AUDIO, over: { title: 'Mine' } });
    expect(titleOnly.querySelector('.wk-body .wk-title').textContent).toBe('Mine');
    expect(titleOnly.querySelector('.wk-body .wk-meta')).toBeNull();
    const teaseOnly = RI.buildCard({ kind: 'audio', data: ENTRY_AUDIO, over: { tease: 'Just a line.' } });
    expect(teaseOnly.querySelector('.wk-body .wk-title')).toBeNull();
    expect(teaseOnly.querySelector('.wk-body .wk-meta').textContent).toBe('Just a line.');

    // A record whose source resolves to nothing still renders its words — and
    // mounts no transport over a track that is not there.
    const made = RI.buildCard(RI.composedItem({ id: 'c-au', order: 1, kind: 'audio', title: 'Only a title' }, [], []));
    expect(made.querySelector('.wk-body .wk-title').textContent).toBe('Only a title');
    // No track to name, so no headline at all — an empty band above an absent
    // transport reads as a rendering fault, not as a card.
    expect(made.querySelector('.wk-a-title')).toBeNull();
    expect(made.querySelector('.ap')).toBeNull();
  });

  it('marks composed origin on every kind, and only there', () => {
    for (const kind of ['photo', 'text', 'audio']) {
      const entry = { photo: ENTRY_PHOTO, text: ENTRY_POST, audio: ENTRY_AUDIO }[kind];
      const made = RI.buildCard({ kind, data: entry, over: { media: 'CARD.webp', title: 'x', palette: 'tide' } });
      expect(made.classList.contains('wk-composed')).toBe(true);
      expect(made.hasAttribute('data-shape')).toBe(true);
      expect(made.getAttribute('data-state')).toBe('tide');
      const auto = RI.buildCard({ kind, data: entry });
      expect(auto.classList.contains('wk-composed')).toBe(false);
      expect(auto.hasAttribute('data-shape')).toBe(false);
      expect(auto.hasAttribute('data-state')).toBe(false);
    }
  });
});

// ------------------------------------------------------------ layout + gate

describe('the legacy composed layouts — resolved onto the real kinds', () => {
  const build = (card) => RI.buildCard(RI.composedItem(card));

  it('`composed` registers nothing; a record picks from its own kind\'s layouts', () => {
    expect(RI.cardLayouts.composed).toBeUndefined();
    expect(RI.resolveLayout('composed', 'hero')).toBe('default');
    expect(RI.layoutFor('photo', {}, composed({ card: { layout: 'hero' } }))).toBe('default');
  });

  it('`hero` on a picture record is the photo kind — one shape, nothing to name', () => {
    const node = build(composed({ card: { layout: 'hero' } }));
    expect(node.querySelector('.wk-img')).not.toBeNull();
    expect(node.hasAttribute('data-layout')).toBe(false);
    // Same opt-in, no picture: the words tile, silently, rather than a hole.
    const gated = build(composed({ media: null, card: { layout: 'hero' } }));
    expect(gated.querySelector('.wk-img')).toBeNull();
    expect(gated.hasAttribute('data-layout')).toBe(false);
  });

  it('`plain` forces the words even when a picture is available — it is the text kind, not a layout', () => {
    const node = build(composed({ tease: 'Words win.', card: { layout: 'plain' } }));
    expect(node.querySelector('.wk-img')).toBeNull();
    expect(node.classList.contains('wk-text')).toBe(true);
    expect(node.hasAttribute('data-layout')).toBe(false);
    expect(node.querySelector('.wk-snip').textContent).toBe('Words win.');
  });

  it('default adds no data-layout — the byte-identity contract', () => {
    expect(build(composed()).hasAttribute('data-layout')).toBe(false);
  });
});
