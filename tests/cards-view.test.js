// @vitest-environment happy-dom
//
// The Cards view (js/console/cards.js) — the console's LIVE vs STAGED preview
// of the homepage grid.
//
// The whole feature rests on one property: the preview runs the SHIPPED
// selection logic rather than a copy of it. js/recent-index.js is the classic
// script the homepage loads, dev/field-console.html now loads it too, and
// cards.js composes both columns through window.RecentIndex.pickRecent. So the
// tests below drive the real engine exactly the way the browser does — import
// the classic script, then the module — and never re-state slot rules that
// tests/recent-index.test.js and tests/pulse-card.test.js already own.
//
// Two places DO duplicate logic across a barrier the imports cannot cross, and
// each gets a parity test rather than a promise:
//
//   · _stagedFeaturedRaw() mirrors _featuredRawFrames() (src/api/site-meta.js),
//     which runs in the Worker on the PUBLISHED buffer.json. One fixture, both
//     functions, identical output.
//   · _stagedInputs() mirrors the filters buildBundle() (js/console/publish.js)
//     applies on the way to a publish. The load-bearing one is `status`: a
//     DRAFT lives in STATE.posts and never reaches posts.json, so a preview
//     that skipped this filter would put an unpublished note on the homepage
//     column — the exact class of lie this view exists to remove.
//
// The frame-numbering fixture uses timestamps exactly 24h apart at the same
// wall time on purpose: the console numbers frames in the runner's local zone
// (ymd) and the Worker numbers them in the project zone (localDay), and only a
// fixture whose days can never collide under a constant offset makes the two
// comparable wherever the suite runs.
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// console-state.js reaches these through the global scope at call time (the
// real console mirrors its renderers onto window) — stub before importing.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

// The classic script first, exactly as the console shell loads it: it installs
// window.RecentIndex and its DOM boot bails (no #recent-index in this document).
await import('../js/recent-index.js');

const { STATE } = await import('../js/console-state.js');
const { _featuredRawFrames } = await import('../src/api/site-meta.js');
const cards = await import('../js/console/cards.js');
const {
  _stagedFeaturedRaw, _stagedInputs, _slotOf, _cardSlots, _diffSlots, renderCards,
  _refeatureReady, _repinTarget, cardsToggleRaw, cardsRepinSwap, cardsRefeature,
  cardsDemoteAudio, cardsClearAudioCard, cardsRestoreAudioCard, cardsOpen,
} = cards;
const { getLastFeaturedSwap } = await import('../js/console/focal.js');
const { _audioCardRestoreTarget } = await import('../js/console/audio.js');

let buildBundle;
beforeAll(async () => {
  ({ buildBundle } = await import('../js/console-ui.js'));
});

// A CDN base for cdnThumb(); the console reads it from site.config at import
// time, so the assertions below only check that a thumbnail is present, never
// its host.
const frame = (id, day, over) => ({
  id,
  filename: `F_${id}.webp`,
  captured_at: `2026-08-${day}T12:00:00.000Z`,
  published_at: '',
  added_at: '2026-08-20',
  ...over,
});

const track = (slug, over) => ({
  id: `a-${slug}`, slug, filename: `${slug}.mp3`, title: slug.toUpperCase(),
  sub: '', duration: 100, peaks: '', added_at: '2026-08-10', ...over,
});

const photo = (slug, over) => ({
  id: `p-${slug}`, slug, filename: `${slug}.webp`, title: slug.toUpperCase(),
  location: 'Somewhere, 2026', camera: 'Camera', added_at: '2026-08-01', ...over,
});

const post = (fnId, over) => ({
  id: `n-${fnId}`, fn_id: fnId, title: fnId.toUpperCase(), location: 'Somewhere',
  date: '2026-08-02', body: 'A one-liner.', added_at: '2026-08-02', ...over,
});

const emptyStaged = () => ({
  buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0, audio: 0,
});

beforeEach(() => {
  // The actions call the REAL mutators, and those repaint their own surfaces
  // (renderBuffer / renderAudio) before returning — which is the point. Their
  // nodes have to exist or the test is exercising a different code path than
  // the console does.
  document.body.innerHTML = `
    <div id="cards-body"></div>
    <div id="toast-host"></div>
    <div id="buffer-display"></div><span id="buffer-count"></span><span id="buffer-stats"></span>
    <div id="audio-display"></div><span id="audio-count"></span><span id="audio-stats"></span>
    <div class="view active" id="view-cards"></div>`;
  STATE.buffer = [];
  STATE.archive = [];
  STATE.posts = [];
  STATE.audio = [];
  STATE.wallpapers = [];
  STATE.barrel = [];
  STATE.friends = [];
  STATE.library = [];
  STATE.staged = emptyStaged();
});

// ---------------------------------------------------------------- parity #1

describe('_stagedFeaturedRaw is the server endpoint, before the publish', () => {
  // Deliberately several featured frames: the console write path is exclusive
  // (tests/buffer-featured.test.js), but the SERVER stays tolerant of legacy
  // multi-featured data and degrades to "newest captured wins". The staged
  // mirror has to degrade the same way or the preview disagrees with the site
  // for exactly the data that is hardest to reason about.
  const fixture = () => [
    frame('a1', '14', { featured: true }),
    frame('b2', '15'),
    frame('c3', '16', { featured: true, cardFocus: '20% 80%' }),
    frame('d4', '17', { featured: true, dark: true }),        // retired — never a card
    frame('e5', '18', { featured: true, filename: '' }),      // no media — never a card
    frame('f6', '19'),
  ];

  it('produces byte-identical output to _featuredRawFrames on the same data', () => {
    STATE.buffer = fixture();
    expect(_stagedFeaturedRaw()).toEqual(_featuredRawFrames(fixture()));
  });

  it('newest captured wins, dark and media-less frames never appear', () => {
    STATE.buffer = fixture();
    const out = _stagedFeaturedRaw();
    expect(out.map((r) => r.id)).toEqual(['c3', 'a1']);
    expect(out[0].cardFocus).toBe('20% 80%');
  });

  it('numbers frames positionally over the whole buffer, dark slots included', () => {
    // Frame permanence: a retired frame keeps its number so every f#NNN
    // citation stays valid (CLAUDE.md, manual §5.20). The preview must cite the
    // same numbers the rest of the console does.
    STATE.buffer = fixture();
    expect(_stagedFeaturedRaw().map((r) => r.num)).toEqual([3, 1]);
  });

  it('respects the server\'s limit', () => {
    STATE.buffer = fixture();
    expect(_stagedFeaturedRaw(1)).toEqual(_featuredRawFrames(fixture(), 1));
  });
});

// ---------------------------------------------------------------- parity #2

describe('_stagedInputs is what the next publish would emit', () => {
  it('drops the drafts posts.json will not carry', () => {
    STATE.posts = [post('fn-001'), post('fn-002', { status: 'draft' }), post('fn-003', { status: 'published' })];
    expect(_stagedInputs().posts.map((p) => p.fn_id)).toEqual(['fn-001', 'fn-003']);
  });

  it('agrees with buildBundle() entry-for-entry on every list it composes', () => {
    STATE.archive = [photo('one'), photo('two'), { id: 'arc-err', filename: 'x.webp', slug: 'x', _uploadError: true }];
    STATE.posts = [post('fn-001'), post('fn-002', { status: 'draft' })];
    STATE.audio = [track('t-one'), { ...track('t-busy'), _uploading: true }];
    STATE.buffer = [frame('a1', '14', { featured: true }), frame('b2', '15')];

    const bundle = buildBundle();
    const staged = _stagedInputs();
    const ids = (arr) => arr.map((e) => e.id);

    expect(ids(staged.archive)).toEqual(ids(JSON.parse(bundle['data/archive.json'])));
    expect(ids(staged.posts)).toEqual(ids(JSON.parse(bundle['data/posts.json'])));
    expect(ids(staged.audio)).toEqual(ids(JSON.parse(bundle['data/audio.json'])));
    // The RAW list is a step further along than the bundle — it is what the
    // buffer-summary endpoint would hand the homepage once buffer.json lands.
    expect(ids(staged.rawFeatured))
      .toEqual(ids(_featuredRawFrames(JSON.parse(bundle['data/buffer.json']))));
  });
});

// ---------------------------------------------------------------- the columns

describe('the staged column, composed by the homepage\'s own logic', () => {
  it('leads with the two pins — audio then RAW — and fills recent work behind them', () => {
    STATE.archive = [photo('newest', { added_at: '2026-08-09' }), photo('older', { added_at: '2026-08-03' })];
    STATE.posts = [post('fn-001', { added_at: '2026-08-08' })];
    STATE.audio = [track('t-one', { featured: true, featured_order: 1 }), track('t-two')];
    STATE.buffer = [frame('a1', '14', { featured: true }), frame('b2', '15')];

    const slots = _cardSlots({ ..._stagedInputs(), pulse: null });
    expect(slots[0].kind).toBe('audio');
    expect(slots[0].title).toBe('T-ONE');
    expect(slots[1].kind).toBe('raw');
    expect(slots[1].title).toBe('f#001');
    // Slots 2 and 3 are ordinary recent work, newest first — pins take the top
    // of the row in rank order, so the recent pool always starts below them.
    expect(['archive', 'text']).toContain(slots[2].kind);
    expect(slots[3]).not.toBeNull();
  });

  it('shows only the frame the console left starred', () => {
    // Exclusive starring is a write-path property (js/console/focal.js); this
    // asserts the preview reflects it rather than re-testing the toggle.
    STATE.buffer = [frame('a1', '14', { featured: true }), frame('b2', '15'), frame('c3', '16')];
    STATE.audio = [track('t-one', { featured: true, featured_order: 1 })];
    const raws = _cardSlots({ ..._stagedInputs(), pulse: null }).filter((s) => s && s.kind === 'raw');
    expect(raws).toHaveLength(1);
    expect(raws[0].title).toBe('f#001');
  });

  it('a field note that opted into the hero layout says so; one that cannot, does not', () => {
    STATE.posts = [
      post('fn-hero', { hero_filename: 'HERO.webp', card: { layout: 'hero' } }),
      post('fn-plain', { card: { layout: 'hero' } }),        // opted in, no picture
    ];
    const [hero, plain] = STATE.posts.map((p) => _slotOf({ kind: 'text', data: p }));
    expect(hero.kicker).toBe('FIELD NOTE · HERO');
    expect(hero.thumb).toBeTruthy();
    expect(plain.kicker).toBe('FIELD NOTE');
    expect(plain.thumb).toBe('');
  });
});

describe('the pin budget, seen through the preview', () => {
  const PULSE = { pulse: { id: 'pl-1', text: 'Printing the last of the dusk rolls.', glyphs: '', state: 'ember' } };

  function seedPins() {
    STATE.archive = [photo('one', { added_at: '2026-08-09' }), photo('two', { added_at: '2026-08-03' })];
    STATE.audio = [track('t-one', { featured: true, featured_order: 1, added_at: '2026-08-20' })];
    STATE.buffer = [frame('a1', '14', { featured: true })];
  }

  it('the pulse takes slot 0 and the older content pin yields', () => {
    seedPins();   // audio added 2026-08-20, RAW captured 2026-08-14 → RAW yields
    const slots = _cardSlots({ ..._stagedInputs(), pulse: PULSE });
    expect(slots[0].kind).toBe('pulse');
    expect(slots.map((s) => s && s.kind)).toContain('audio');
    expect(slots.map((s) => s && s.kind)).not.toContain('raw');
  });

  it('the newer of the two pins is the one that stays', () => {
    seedPins();
    STATE.audio = [track('t-one', { featured: true, featured_order: 1, added_at: '2026-08-01' })];
    STATE.buffer = [frame('a1', '25', { featured: true })];
    const slots = _cardSlots({ ..._stagedInputs(), pulse: PULSE });
    expect(slots[0].kind).toBe('pulse');
    expect(slots.map((s) => s && s.kind)).toContain('raw');
    expect(slots.map((s) => s && s.kind)).not.toContain('audio');
  });

  it('the pulse tile is marked as live rather than staged', () => {
    const slot = _slotOf({ kind: 'pulse', data: PULSE.pulse });
    expect(slot.live).toBe(true);
  });
});

// ---------------------------------------------------------------- the diff

describe('the diff markers', () => {
  const slot = (key) => ({ kind: 'photo', key, kicker: 'ARCHIVE', title: key, sub: '', thumb: '' });

  it('names each slot NEW / REPLACED / UNCHANGED / GONE', () => {
    const live = [slot('photo:a'), slot('photo:b'), null, slot('photo:d')];
    const staged = [slot('photo:a'), slot('photo:x'), slot('photo:c'), null];
    expect(_diffSlots(live, staged)).toEqual(['UNCHANGED', 'REPLACED', 'NEW', 'GONE']);
  });

  it('two empty slots are not a change', () => {
    expect(_diffSlots([null, null, null, null], [null, null, null, null]))
      .toEqual(['', '', '', '']);
  });

  it('is always grid-length, so a shortened row still reports its GONE slots', () => {
    expect(_diffSlots([slot('photo:a'), slot('photo:b')], [slot('photo:a')]))
      .toEqual(['UNCHANGED', 'GONE', '', '']);
  });
});

// ---------------------------------------------------------------- rendering

describe('renderCards paints both columns', () => {
  const LIVE = {
    '/data/archive.json': [photo('live-one'), photo('live-two')],
    '/data/posts.json': [post('fn-live')],
    '/api/buffer-summary': { frames: 2, featured: [] },
    '/data/audio.json': [],
    '/api/pulse': { pulse: null },
  };

  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(JSON.stringify(LIVE[path] ?? null), {
      status: LIVE[path] === undefined ? 404 : 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  it('renders a LIVE column, a STAGED column and a marker per slot', async () => {
    STATE.archive = [photo('live-one'), photo('live-two')];
    STATE.posts = [post('fn-live')];
    STATE.buffer = [frame('a1', '14', { featured: true })];

    await renderCards();
    const html = document.getElementById('cards-body').innerHTML;
    expect(html).toContain('LIVE');
    expect(html).toContain('STAGED');
    // The staged column gained the starred RAW frame the live one has not seen.
    expect(html).toContain('f#001');
    expect(document.querySelectorAll('.cards-col')).toHaveLength(2);
    expect(document.querySelectorAll('.slot-mark').length).toBeGreaterThan(0);
  });

  it('badges the fourth slot as tablet-only in both columns', async () => {
    STATE.archive = [photo('a'), photo('b'), photo('c'), photo('d')];
    await renderCards();
    expect(document.querySelectorAll('.slot-badge')).toHaveLength(2);
  });

  it('a missing data file is the fresh-fork state, not a failure', async () => {
    // 404 on /data/*.json is how an un-seeded fork looks; recent-index.js falls
    // back to its bundled samples there, so the column must render normally and
    // say nothing alarming.
    globalThis.fetch = async () => new Response('not found', { status: 404 });
    await renderCards();
    const html = document.getElementById('cards-body').innerHTML;
    expect(document.querySelectorAll('.cards-warn')).toHaveLength(0);
    expect(html).toContain('cards-col');
  });

  it('says so plainly when a source genuinely cannot be reached', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    await renderCards();
    expect(document.querySelector('.cards-warn')).not.toBeNull();
    expect(document.querySelector('.cards-warn').textContent).toContain('/data/archive.json');
  });
});

// ---------------------------------------------------------------- the actions

describe('actions route through the real mutators', () => {
  // The point of every test here: cards.js writes no flag of its own. If these
  // ever pass against a local re-implementation, the staging law and the
  // exclusive-star sweep have quietly forked.
  it('starring from a card tile is one staged change, +1', () => {
    STATE.buffer = [frame('a1', '14'), frame('b2', '15')];
    cardsToggleRaw('a1');
    expect(STATE.buffer[0].featured).toBe(true);
    expect(STATE.staged.buffer).toBe(1);
  });

  it('unstarring is +1 as well — the counter tallies gestures, never featured frames', () => {
    // The audio-shelf incident in reverse: a decrement model clamps at 0 and
    // wedges publish with a live card that cannot be taken down.
    STATE.buffer = [frame('a1', '14', { featured: true })];
    cardsToggleRaw('a1');
    expect(STATE.buffer[0].featured).toBeUndefined();
    expect(STATE.staged.buffer).toBe(1);
  });

  it('starring a second frame un-stars the first in the same gesture', () => {
    STATE.buffer = [frame('a1', '14', { featured: true }), frame('b2', '15')];
    cardsToggleRaw('b2');
    expect(STATE.buffer.filter((b) => b.featured).map((b) => b.id)).toEqual(['b2']);
    expect(STATE.staged.buffer).toBe(1);
  });

  it('a dark frame cannot be starred from here either', () => {
    // Frame permanence: the tombstone has no media behind it. The guard lives in
    // toggleBufferFeatured, which is exactly why this routes through it.
    STATE.buffer = [{ id: 'd1', filename: 'F_d1.webp', captured_at: '2026-08-14T12:00:00.000Z', dark: true }];
    cardsToggleRaw('d1');
    expect(STATE.buffer[0].featured).toBeUndefined();
    expect(STATE.staged.buffer).toBe(0);
  });

  it('taking a track off the card is +1 and leaves the ordering compact', () => {
    STATE.audio = [
      track('t-one', { featured: true, featured_order: 1 }),
      track('t-two', { featured: true, featured_order: 2 }),
    ];
    cardsDemoteAudio('a-t-one');
    expect(STATE.audio[0].featured).toBe(false);
    expect(STATE.audio[1].featured_order).toBe(1);
    expect(STATE.staged.audio).toBe(1);
  });

  it('clearing the audio card is ONE staged change however many tracks it held', () => {
    STATE.audio = [
      track('t-one', { featured: true, featured_order: 1 }),
      track('t-two', { featured: true, featured_order: 2 }),
      track('t-three', { featured: true, featured_order: 3 }),
    ];
    // Taking three tracks down now asks first (2026-08-31) — happy-dom has no
    // real dialog, and this case is about the staging, not the confirm.
    window.confirm = () => true;
    cardsClearAudioCard();
    expect(STATE.audio.every((a) => !a.featured)).toBe(true);
    expect(STATE.staged.audio).toBe(1);
  });

  it('and offers the cleared card back, through the real promote path', () => {
    STATE.audio = [
      track('t-one', { featured: true, featured_order: 1 }),
      track('t-two', { featured: true, featured_order: 2 }),
    ];
    window.confirm = () => true;
    cardsClearAudioCard();
    expect(_audioCardRestoreTarget().map((t) => t.id)).toEqual(['a-t-one', 'a-t-two']);

    cardsRestoreAudioCard();
    expect(STATE.audio.filter((a) => a.featured).map((a) => a.featured_order)).toEqual([1, 2]);
    expect(_audioCardRestoreTarget(), 'the chip retires once it is spent').toBeNull();
  });

  it('opening a surface routes rather than mutating', () => {
    document.body.insertAdjacentHTML('beforeend', '<div class="view" id="view-buffer"></div>');
    cardsOpen('buffer');
    expect(document.getElementById('view-buffer').classList.contains('active')).toBe(true);
    expect(STATE.staged.buffer).toBe(0);
  });
});

describe('undo without a stack', () => {
  it('re-pin puts back exactly the frame the star displaced, with its crop intact', () => {
    STATE.buffer = [
      frame('a1', '14', { featured: true, cardFocus: '20% 80%' }),
      frame('b2', '15'),
    ];
    cardsToggleRaw('b2');                       // displaces a1
    expect(getLastFeaturedSwap()).toEqual({ newId: 'b2', prevId: 'a1' });

    cardsRepinSwap();
    expect(STATE.buffer.filter((b) => b.featured).map((b) => b.id)).toEqual(['a1']);
    // The crop is the whole reason a displaced frame is one tap from coming
    // back — losing it would make the undo a lie.
    expect(STATE.buffer[0].cardFocus).toBe('20% 80%');
  });

  it('is symmetric: the chip then offers the frame you just left', () => {
    STATE.buffer = [frame('a1', '14', { featured: true }), frame('b2', '15')];
    cardsToggleRaw('b2');
    cardsRepinSwap();
    expect(getLastFeaturedSwap()).toEqual({ newId: 'a1', prevId: 'b2' });
  });

  it('every step of that is +1 staged, never a decrement', () => {
    STATE.buffer = [frame('a1', '14', { featured: true }), frame('b2', '15')];
    cardsToggleRaw('b2');
    expect(STATE.staged.buffer).toBe(1);
    cardsRepinSwap();
    expect(STATE.staged.buffer).toBe(2);
  });

  it('the re-feature shelf is the frames carrying an orphaned card crop', () => {
    STATE.buffer = [
      frame('a1', '14', { cardFocus: '20% 80%' }),                  // ready
      frame('b2', '15', { cardFocus: '10% 10%', featured: true }),  // on the card already
      frame('c3', '16'),                                            // never framed
      frame('d4', '17', { cardFocus: '0% 0%', dark: true }),        // retired
      frame('e5', '18', { cardFocus: '0% 0%' }),                    // ready, newer
    ];
    expect(_refeatureReady().map((b) => b.id)).toEqual(['e5', 'a1']);
  });

  it('the shelf survives a reload — it is read off the data, not remembered', () => {
    // The distinction from the swap chip, and the reason both exist.
    STATE.buffer = [frame('a1', '14', { cardFocus: '20% 80%' })];
    expect(getLastFeaturedSwap()?.prevId ?? null).not.toBe('a1');
    expect(_refeatureReady().map((b) => b.id)).toEqual(['a1']);
  });

  it('re-featuring from the shelf goes through the same exclusive path', () => {
    STATE.buffer = [
      frame('a1', '14', { cardFocus: '20% 80%' }),
      frame('b2', '15', { featured: true }),
    ];
    cardsRefeature('a1');
    expect(STATE.buffer.filter((b) => b.featured).map((b) => b.id)).toEqual(['a1']);
    expect(STATE.staged.buffer).toBe(1);
  });
});

describe('the rendered controls', () => {
  const LIVE_EMPTY = { frames: 0, featured: [] };

  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? LIVE_EMPTY : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  it('puts the controls on the STAGED column only — LIVE is a record', async () => {
    STATE.buffer = [frame('a1', '14', { featured: true })];
    STATE.archive = [photo('one')];
    await renderCards();
    const cols = [...document.querySelectorAll('.cards-col')];
    expect(cols[0].querySelectorAll('.slot-act')).toHaveLength(0);
    expect(cols[1].querySelectorAll('.slot-act').length).toBeGreaterThan(0);
  });

  it('a RAW tile offers the star and the crop', async () => {
    STATE.buffer = [frame('a1', '14', { featured: true })];
    await renderCards();
    const html = document.querySelectorAll('.cards-col')[1].innerHTML;
    expect(html).toContain('cardsToggleRaw');
    expect(html).toContain('cardsCropRaw');
  });

  it('a single featured track offers OFF CARD; a playlist offers CLEAR CARD', async () => {
    STATE.audio = [track('t-one', { featured: true, featured_order: 1 })];
    await renderCards();
    expect(document.body.innerHTML).toContain('cardsDemoteAudio');

    STATE.audio = [
      track('t-one', { featured: true, featured_order: 1 }),
      track('t-two', { featured: true, featured_order: 2 }),
    ];
    await renderCards();
    expect(document.body.innerHTML).toContain('cardsClearAudioCard');
  });

  it('the re-pin chip names the frame the star displaced, and flips with it', async () => {
    STATE.buffer = [frame('a1', '14', { featured: true }), frame('b2', '15')];
    await renderCards();

    cardsToggleRaw('b2');                       // displaces a1 (f#001)
    expect(document.querySelector('.cards-chip--undo').textContent).toContain('f#001');

    cardsRepinSwap();                           // and back — now b2 (f#002) is the one out
    expect(document.querySelector('.cards-chip--undo').textContent).toContain('f#002');
  });

  it('renders no chip when the remembered frame is no longer restorable', async () => {
    // The swap record is module state that outlives the view, so it can name a
    // frame that has since been retired, deleted, or re-starred another way. A
    // dead button that silently does nothing is worse than no button.
    STATE.buffer = [frame('a1', '14', { featured: true }), frame('b2', '15')];
    cardsToggleRaw('b2');                       // remembers prevId = a1
    expect(_repinTarget()?.id).toBe('a1');

    STATE.buffer = [frame('b2', '15', { featured: true })];   // a1 deleted out from under it
    expect(_repinTarget()).toBeNull();
    await renderCards();
    expect(document.querySelector('.cards-chip--undo')).toBeNull();
  });

  it('an action repaints the tiles without going back to the network', async () => {
    STATE.buffer = [frame('a1', '14'), frame('b2', '15')];
    await renderCards();
    let reads = 0;
    globalThis.fetch = async () => { reads += 1; return new Response('[]', { status: 200 }); };

    cardsToggleRaw('a1');
    // The LIVE column is the PUBLISHED site — no console action can move it, so
    // re-reading five files to redraw it would be pure latency.
    expect(reads).toBe(0);
    expect(document.body.innerHTML).toContain('f#001');
  });

  it('every inline handler it renders is actually exported', () => {
    // The window bridge only carries EXPORTS, so an unexported handler is a
    // control that silently does nothing. tests/inline-handlers.test.js catches
    // this repo-wide; asserting it here makes the failure local and legible.
    for (const name of [
      'cardsToggleRaw', 'cardsCropRaw', 'cardsDemoteAudio', 'cardsClearAudioCard',
      'cardsRepinSwap', 'cardsRefeature', 'cardsOpen',
    ]) {
      expect(typeof cards[name], `${name} is not exported`).toBe('function');
    }
  });
});

describe('the degraded state when the engine is not there', () => {
  it('renders an honest tile instead of throwing', async () => {
    // A blocked request or a stale installed service-worker copy means
    // window.RecentIndex simply is not defined. The console must stay usable.
    const engine = window.RecentIndex;
    delete window.RecentIndex;
    try {
      await expect(renderCards()).resolves.toBeUndefined();
      expect(document.getElementById('cards-body').innerHTML).toContain('PREVIEW UNAVAILABLE');
    } finally {
      window.RecentIndex = engine;
    }
  });

  it('is a no-op with no view in the document', async () => {
    document.body.innerHTML = '';
    await expect(renderCards()).resolves.toBeUndefined();
  });
});
