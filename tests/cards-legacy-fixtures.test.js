// @vitest-environment happy-dom
//
// LEGACY COMPOSED-CARD FIXTURES — chunk 0 of docs/cards-core-complete.md.
//
// THE CONTRACT THIS FILE FREEZES: every `data/cards.json` record shape the
// SHIPPED console can write (2026-09-10: no `kind`; `card.layout` one of
// default | hero | plain) renders exactly these bytes. Forks carry these
// records today. Chunk 1 turned "composed" from a fifth kind into an override
// on the existing kinds, behind a normalizer (composedKind) — and a fork merging
// that upstream must see NO change on its homepage. This test is how chunk 1
// proves it.
//
// ⚠️ CHUNK 1 MOVED EXACTLY THESE BYTES (decision 2.1(5), owner, 2026-09-10;
// docs/maintenance/2026-09-10-cards-composed-is-an-override.md names each):
//   · the WORDS shape (cards-legacy-no-picture, cards-legacy-picture-plain, and
//     the two words tiles in cards-legacy-rows) is now the text kind's own
//     tile: <span> kicker with an aria-hidden dot, drop cap on feature/standard,
//     the editor caret, and no data-layout="plain" — `plain` is the text kind
//     now, not a layout;
//   · a picture record that asked for `hero` lost the inert data-layout="hero"
//     (cards-legacy-picture-hero, one line of rows) — it is the photo kind, which
//     has one shape and nothing to name; no stylesheet bound the attribute on a
//     picture root.
// Every other byte — the picture shapes, the automatic cards, placement,
// dedupe and the grid cut — is unchanged from the 2026-09-10 capture.
//
// The record shapes come from reading js/console/cards.js, not from guessing:
//   cardsCompose()      → { id, order, title, tease, added_at }       (free-form)
//   a slot takeover     → + media, folder, cardFocus, link, source, label
//   cardsPickImage()    → media + folder ('archive' | 'wallpaper')
//   cardsSetLayout()    → card: { layout: 'hero' | 'plain' }
//   the palette row     → palette: 'signal' | 'ember' | … (never 'default')
// and each shape is captured with and without palette, link, source and the
// wallpaper folder, as the brief asks, plus the tease lengths that drive the
// tier ladder on the words tile.
//
// ⚠️ FIXTURES ARE CONTRACTS. Regenerating one to make a test pass is the one
// move that turns "byte-identical" into a sentence. If a fixture must change,
// the maintenance log says which bytes and why, and the owner sees the diff.
// Regeneration is deliberate and explicit:
//
//   CARDS_FIXTURES_WRITE=1 npx vitest run tests/cards-legacy-fixtures.test.js
//
// which rewrites tests/fixtures/cards-legacy-*.html from the CURRENT engine and
// then asserts against what it just wrote (so a capture run is always green —
// read the git diff, that is the review).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');
const WRITE = process.env.CARDS_FIXTURES_WRITE === '1';

// Deterministic CDN base — cdnRoot() reads this meta before falling back to
// location.origin, which differs across happy-dom versions.
const meta = document.createElement('meta');
meta.setAttribute('name', 'cdn-base');
meta.setAttribute('content', 'https://cdn.example/api/cdn');
document.head.appendChild(meta);

// A small automatic row for the composed cards to overlay. Neutral sample data,
// the same vocabulary tests/card-composer.test.js uses.
const ARCHIVE = [
  { slug: 'a-one', filename: 'A1.webp', title: 'One', location: 'Somewhere, 2026', added_at: '2026-08-01T00:00:00Z' },
  { slug: 'a-two', filename: 'A2.webp', title: 'Two', location: 'Somewhere, 2026', added_at: '2026-08-02T00:00:00Z' },
];
const POSTS = [
  { fn_id: 'fn-1', title: 'A Note', location: 'Somewhere', body: 'A one-liner.', added_at: '2026-08-03T00:00:00Z' },
];
const PULSE = {
  pulse: {
    id: 'p1', state: 'ember', text: 'Printing the last of the dusk rolls.', glyphs: '🌆',
    localTime: '21:14', footLeft: 'studio', footRight: 'late',
  },
};

// ---- the record shapes ----------------------------------------------------

// Three teases, one per rung of the tier ladder (recentTier: ≤55 statement,
// ≤105 feature, else standard). The words tile wears data-tier; the picture
// shape does not — both facts are part of what is frozen.
const TEASE = {
  statement: 'A short line.',
  feature: 'A line long enough to leave the statement tier and settle in the middle rung of the ladder.',
  standard: 'The first walk with a new camera is never about the pictures. It is about learning to see again, block by block, until the light starts auditioning for you.',
};

// The optional fields the brief names, applied with and without.
const OPTIONS = {
  palette: { palette: 'ember' },
  link: { link: '/archive/?f=a-two' },
  source: { source: { surface: 'archive', id: 'arc-2' } },
  wallpaper: { folder: 'wallpaper' },
};

const base = (over) => ({
  id: 'c-legacy', order: 1, added_at: '2026-09-01T00:00:00Z', ...over,
});

// One record per line the shipped console can produce, grouped by the shape
// the brief lists. Each group becomes one fixture file; each entry becomes one
// line in it. Order inside a group is the contract too — never reorder.
const GROUPS = {
  // No picture: cardsCompose() and typing. The typographic tile.
  'no-picture': [
    ['words only, title', base({ title: 'The Geometry of Silence', tease: '' })],
    ['title + statement tease', base({ title: 'The Geometry of Silence', tease: TEASE.statement })],
    ['title + feature tease', base({ title: 'The Geometry of Silence', tease: TEASE.feature })],
    ['title + standard tease', base({ title: 'The Geometry of Silence', tease: TEASE.standard })],
    ['tease only, no title', base({ title: '', tease: TEASE.statement })],
    ['label', base({ title: 'Words', tease: TEASE.statement, label: 'New work' })],
    ['+ palette', base({ title: 'Words', tease: TEASE.statement, ...OPTIONS.palette })],
    ['+ link (a takeover of a note with no hero)', base({ title: 'Words', tease: '', link: '/field-notes/post?slug=fn-1' })],
    ['+ source', base({ title: 'Words', tease: '', ...OPTIONS.source })],
    ['+ palette + link + source + label', base({ title: 'Words', tease: TEASE.feature, label: 'Field Note', ...OPTIONS.palette, link: '/field-notes/post?slug=fn-1', source: { surface: 'posts', id: 'fn-1' } })],
    // Layouts on a card with no picture: plain has no gate (so it stamps
    // data-layout even though the words tile is already the result); hero is
    // gated on a picture and falls back to default with NO data-layout.
    ['layout plain, no picture', base({ title: 'Words', tease: TEASE.statement, card: { layout: 'plain' } })],
    ['layout hero, no picture (gated out)', base({ title: 'Words', tease: TEASE.statement, card: { layout: 'hero' } })],
  ],
  // Picture + default: a takeover or cardsPickImage(). Picture-led (the smart
  // default), caption grammar (.wk-title / .wk-meta), no tier.
  'picture-default': [
    ['picture only, no words', base({ media: 'CARD.webp', folder: 'archive', title: '', tease: '' })],
    ['picture + title', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '' })],
    ['picture + title + tease', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: TEASE.statement })],
    ['picture + cardFocus + label', base({ media: 'CARD.webp', folder: 'archive', cardFocus: '51% 82%', title: 'Peaceful Perch', tease: '', label: 'RAW' })],
    ['+ palette', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '', ...OPTIONS.palette })],
    ['+ link', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '', ...OPTIONS.link })],
    ['+ source', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '', ...OPTIONS.source })],
    ['+ wallpaper folder', base({ media: 'CARD.webp', title: 'Peaceful Perch', tease: '', ...OPTIONS.wallpaper })],
    ['+ palette + link + source + wallpaper + cardFocus + label + tease', base({ media: 'CARD.webp', cardFocus: '10% 90%', title: 'Peaceful Perch', tease: TEASE.statement, label: 'Featured', ...OPTIONS.palette, ...OPTIONS.link, ...OPTIONS.source, ...OPTIONS.wallpaper })],
    // The live instance's own record shape on 2026-09-10 (a buffer takeover),
    // with neutral values — the one shape known to exist on a published site.
    ['a buffer takeover, as published', base({ source: { surface: 'buffer', id: 'b-1' }, media: 'CARD.webp', folder: 'archive', cardFocus: '51% 82%', title: 'Peaceful Perch', label: 'RAW', link: '/archive/buffer/?f=b-1', palette: 'velvet' })],
  ],
  // Picture + hero: the picture forced forward. Today identical to default on a
  // card with a picture, plus data-layout="hero" — frozen so chunk 1 keeps it.
  'picture-hero': [
    ['hero, picture + title', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '', card: { layout: 'hero' } })],
    ['hero + tease', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: TEASE.statement, card: { layout: 'hero' } })],
    ['+ palette', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '', card: { layout: 'hero' }, ...OPTIONS.palette })],
    ['+ link', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '', card: { layout: 'hero' }, ...OPTIONS.link })],
    ['+ source', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '', card: { layout: 'hero' }, ...OPTIONS.source })],
    ['+ wallpaper folder', base({ media: 'CARD.webp', title: 'Peaceful Perch', tease: '', card: { layout: 'hero' }, ...OPTIONS.wallpaper })],
    ['+ everything', base({ media: 'CARD.webp', cardFocus: '10% 90%', title: 'Peaceful Perch', tease: TEASE.statement, label: 'Featured', card: { layout: 'hero' }, ...OPTIONS.palette, ...OPTIONS.link, ...OPTIONS.source, ...OPTIONS.wallpaper })],
  ],
  // Picture + plain: the words forced forward on a card that HAS a picture.
  // Today this is composedCard's words branch — the ladder without the drop cap
  // or the caret. The picture is not rendered at all. Frozen as-is; whether
  // chunk 1 keeps these bytes or brings the drop cap back is the open question
  // §7 of cards-core-complete.md records.
  'picture-plain': [
    ['plain, picture + title', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: '', card: { layout: 'plain' } })],
    ['plain + statement tease', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: TEASE.statement, card: { layout: 'plain' } })],
    ['plain + standard tease', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: TEASE.standard, card: { layout: 'plain' } })],
    ['+ palette', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: TEASE.statement, card: { layout: 'plain' }, ...OPTIONS.palette })],
    ['+ link', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: TEASE.statement, card: { layout: 'plain' }, ...OPTIONS.link })],
    ['+ source', base({ media: 'CARD.webp', folder: 'archive', title: 'Peaceful Perch', tease: TEASE.statement, card: { layout: 'plain' }, ...OPTIONS.source })],
    ['+ wallpaper folder', base({ media: 'CARD.webp', title: 'Peaceful Perch', tease: TEASE.statement, card: { layout: 'plain' }, ...OPTIONS.wallpaper })],
    ['+ everything', base({ media: 'CARD.webp', cardFocus: '10% 90%', title: 'Peaceful Perch', tease: TEASE.feature, label: 'Featured', card: { layout: 'plain' }, ...OPTIONS.palette, ...OPTIONS.link, ...OPTIONS.source, ...OPTIONS.wallpaper })],
  ],
};

// Whole rows: the composed cards IN PLACE on the automatic row, through the
// real selection path — placement behind a live pulse, dedupe of an automatic
// pick whose picture a composed card borrowed, and the GRID_SIZE cut.
const ROWS = [
  ['two composed, no pulse, one borrows an archive picture', null, [
    base({ id: 'c-a', order: 1, media: 'A1.webp', folder: 'archive', title: 'Borrowed', tease: '', link: '/archive/?f=a-one', source: { surface: 'archive', id: 'a-one' }, label: 'Archive' }),
    base({ id: 'c-b', order: 2, title: 'Words', tease: TEASE.statement, palette: 'tide' }),
  ]],
  ['two composed behind a live pulse', PULSE, [
    base({ id: 'c-a', order: 1, media: 'CARD.webp', folder: 'archive', title: 'Picture', tease: '', card: { layout: 'hero' } }),
    base({ id: 'c-b', order: 2, media: 'CARD.webp', folder: 'wallpaper', title: 'Words over a picture', tease: TEASE.feature, card: { layout: 'plain' } }),
  ]],
];

let RI;
beforeAll(async () => {
  await import('../js/recent-index.js');
  RI = globalThis.RecentIndex;
});

// Render ONE composed card the way the homepage does: through pickRecent (so
// composedPick's filter and the overlay both run) and then buildCard.
function renderComposed(card) {
  const picks = RI.pickRecent(ARCHIVE, POSTS, [], [], null, [card]);
  const item = picks.find((p) => p.over);
  if (!item) throw new Error('composedPick dropped a record the console can write');
  return RI.buildCard(item).outerHTML;
}

function renderRow(pulse, cards) {
  return RI.pickRecent(ARCHIVE, POSTS, [], [], pulse, cards)
    .map((item) => RI.buildCard(item).outerHTML)
    .join('\n');
}

// A fixture file is the group's renders, one per line, with a leading comment
// naming each line so a failing diff reads as prose. Comments are part of the
// frozen bytes on purpose: renaming a case is a contract change too.
function serialize(entries) {
  return entries.map(([name, html]) => `<!-- ${name} -->\n${html}`).join('\n') + '\n';
}

function fixture(name, produce) {
  const path = join(FIXTURE_DIR, `cards-legacy-${name}.html`);
  if (WRITE || !existsSync(path)) writeFileSync(path, produce());
  return readFileSync(path, 'utf8');
}

describe('legacy composed-card fixtures — the shapes the shipped console writes', () => {
  for (const [group, entries] of Object.entries(GROUPS)) {
    it(`${group}: every record renders the frozen bytes`, () => {
      const rendered = entries.map(([name, card]) => [name, renderComposed(card)]);
      expect(serialize(rendered)).toBe(fixture(group, () => serialize(rendered)));
    });
  }

  it('whole rows: placement, dedupe and the grid cut are frozen too', () => {
    const rendered = ROWS.map(([name, pulse, cards]) => [name, renderRow(pulse, cards)]);
    expect(serialize(rendered)).toBe(fixture('rows', () => serialize(rendered)));
  });

  // The two facts chunk 1's normalizer must reproduce, stated as assertions so
  // a failure names the rule and not just a byte offset.
  it('a picture card is the photo shape; a words card is the text shape', () => {
    const pic = RI.buildCard(RI.composedPick([GROUPS['picture-default'][1][1]])[0]);
    expect(pic.classList.contains('wk-composed')).toBe(true);
    expect(pic.classList.contains('wk-text')).toBe(false);
    expect(pic.getAttribute('data-shape')).toBe('picture');
    expect(pic.hasAttribute('data-tier')).toBe(false);

    const words = RI.buildCard(RI.composedPick([GROUPS['no-picture'][1][1]])[0]);
    expect(words.classList.contains('wk-text')).toBe(true);
    expect(words.getAttribute('data-shape')).toBe('words');
    expect(words.getAttribute('data-tier')).toBe('statement');
    // The drift chunk 1 closed: the words tile IS the field-note tile now —
    // the editor caret always, the drop cap on the tiers that take one
    // (statement is all display type, so none here; feature gets its cap).
    expect(words.querySelector('.ed-caret')).not.toBeNull();
    expect(words.querySelector('.wk-dropcap')).toBeNull();
    const feature = RI.buildCard(RI.composedPick([GROUPS['no-picture'][2][1]])[0]);
    expect(feature.querySelector('.wk-dropcap').textContent).toBe('A');
    // …and it carries no place-and-year line: every word on it was typed.
    expect(words.querySelector('.wk-t-meta')).toBeNull();
  });

  it('plain hides the picture (it is the text kind, not a layout); hero without a picture is gated to default', () => {
    const plain = RI.buildCard(RI.composedPick([GROUPS['picture-plain'][0][1]])[0]);
    expect(plain.hasAttribute('data-layout')).toBe(false);
    expect(plain.getAttribute('data-shape')).toBe('words');
    expect(plain.querySelector('.wk-img')).toBeNull();

    const gated = RI.buildCard(RI.composedPick([GROUPS['no-picture'][11][1]])[0]);
    expect(gated.hasAttribute('data-layout')).toBe(false);
  });
});
