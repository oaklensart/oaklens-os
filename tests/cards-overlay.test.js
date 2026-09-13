// @vitest-environment happy-dom
//
// Chunk 3's console half: the one MEASUREMENT the overlay layout rests on, and
// the nine chips that choose everything the measurement does not.
//
// The engine side — the layout, the gate, the ink threshold, the four
// attributes — is pinned in tests/card-engine.test.js. This file is about the
// two things only the console can get wrong:
//
//   1. THE MEASUREMENT. The engine is forbidden from measuring a picture at
//      render time (recent-index.js runs from file:// in the offline export), so
//      the three band luminances are sampled here, once, and stored on the
//      record. If this arithmetic is wrong the card is unreadable and nothing
//      anywhere reports it — there is no error state for "the ink is the wrong
//      colour", only a card you cannot read.
//   2. THE CLOSED SET. Nine chips, every value one the stylesheet has a rule
//      for, and the tenth decision (the ink) not the author's to make. A
//      control that could write a value buildCard would not honour is a control
//      that lies about what publish produces.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

await import('../js/recent-index.js');
const { STATE, sessionTrash } = await import('../js/console-state.js');
const focal = await import('../js/console/focal.js');
const cards = await import('../js/console/cards.js');
const {
  cardsCompose, cardsSetText, cardsSetOverlay, cardsClearImage, cardsSetDressing,
  OVERLAY_LABEL,
} = cards;
const RI = globalThis.RecentIndex;

const emptyStaged = () => ({
  buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0,
  friends: 0, library: 0, audio: 0, cards: 0,
});

beforeEach(() => {
  document.body.innerHTML = '<div id="cards-body"></div><div id="toast-host"></div>';
  for (const k of ['buffer', 'archive', 'posts', 'audio', 'wallpapers', 'barrel',
    'friends', 'library', 'cards']) STATE[k] = [];
  STATE.staged = emptyStaged();
  STATE.stagedLog = [];
  sessionTrash.length = 0;
  globalThis.confirm = () => true;
});

// ------------------------------------------------------------- the measurement

// A synthetic ImageData: `rows` is a list of [r,g,b] repeated down the picture,
// so a band's expected luminance can be reasoned about by hand.
function imageOf(rows, width = 4) {
  const height = rows.length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach(([r, g, b], y) => {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  });
  return { data, width, height };
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

describe('bandLuminance — the three numbers the ink is derived from', () => {
  it('reads a three-band picture band by band', () => {
    // Three rows each: white on top, black in the middle, white at the bottom.
    const img = imageOf([WHITE, WHITE, WHITE, BLACK, BLACK, BLACK, WHITE, WHITE, WHITE]);
    expect(focal.bandLuminance(img)).toEqual({ top: 1, mid: 0, bottom: 1 });
  });

  it('LINEARISES before it weights, which is the whole point', () => {
    // Mid-grey (128,128,128) is 0.5 of the byte range and 0.22 of the LIGHT.
    // A naive average of gamma-encoded bytes would call this picture half
    // bright and flip the ink to dark — on a photograph a reader would find
    // distinctly murky. That error lands exactly where the decision is close.
    const grey = [128, 128, 128];
    const { top } = focal.bandLuminance(imageOf([grey, grey, grey]));
    expect(top).toBeCloseTo(0.22, 2);
    expect(top).toBeLessThan(RI.INK_THRESHOLD);
  });

  it('weights the channels the way the eye does', () => {
    // Pure green reads far brighter than pure blue at the same byte value.
    const flat = (px) => focal.bandLuminance(imageOf([px, px, px])).top;
    const green = flat([0, 255, 0]);
    const blue = flat([0, 0, 255]);
    expect(green).toBeCloseTo(0.72, 2);
    expect(blue).toBeCloseTo(0.07, 2);
    expect(green).toBeGreaterThan(blue);
  });

  it('rounds to two places, so a re-measure of the same crop is the same bytes', () => {
    const px = [100, 140, 90];
    const v = focal.bandLuminance(imageOf([px, px, px])).top;
    expect(Math.round(v * 100) / 100).toBe(v);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('gives the middle band the rows that do not divide by three', () => {
    // 4 rows: the cut is [0,1,3,4] — one row top, TWO mid, one bottom. No row
    // counted twice, none dropped, and the answer is still three numbers.
    const img = imageOf([WHITE, BLACK, BLACK, WHITE]);
    expect(focal.bandLuminance(img)).toEqual({ top: 1, mid: 0, bottom: 1 });
  });

  it('answers null for an input it cannot measure — never three zeroes', () => {
    // "Too dark to read" and "never measured" are different states and
    // overlayInk treats them differently: three zeroes would claim a black
    // picture, which is a measurement, not the absence of one.
    expect(focal.bandLuminance(null)).toBeNull();
    expect(focal.bandLuminance({})).toBeNull();
    expect(focal.bandLuminance({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
    expect(focal.bandLuminance({ width: 4, height: 4, data: new Uint8ClampedArray(8) })).toBeNull();
    // Fewer than three rows cannot be three bands — one would be empty and
    // average to zero, claiming a black stripe rather than admitting there was
    // nothing there.
    expect(focal.bandLuminance(imageOf([BLACK, BLACK]))).toBeNull();
  });
});

describe('the 4:5 cover crop the sampler measures', () => {
  it('keeps the same rect a cover-crop would show, at the focal point', () => {
    // A wide source, cropped to 4:5: full height, a 4/5-of-height-wide column,
    // slid by the focal x. This is the same rule cardCoverRect applies for the
    // OG card — one crop, asked at the card's own aspect.
    const r = focal._coverRect(1000, 500, 4 / 5, 0, 50);
    expect(r).toEqual({ sx: 0, sy: 0, cw: 400, ch: 500 });
    const right = focal._coverRect(1000, 500, 4 / 5, 100, 50);
    expect(right.sx).toBe(600);
    // A tall source crops vertically instead, and the focal Y is what slides.
    const tall = focal._coverRect(400, 1000, 4 / 5, 50, 0);
    expect(tall).toEqual({ sx: 0, sy: 0, cw: 400, ch: 500 });
    expect(focal._coverRect(400, 1000, 4 / 5, 50, 100).sy).toBe(500);
  });

  it('parses a focal point the way the modal does, and clamps it', () => {
    expect(focal._focusPct('30% 70%')).toEqual({ x: 30, y: 70 });
    expect(focal._focusPct('')).toEqual({ x: 50, y: 50 });
    expect(focal._focusPct(null)).toEqual({ x: 50, y: 50 });
    expect(focal._focusPct('-20% 300%')).toEqual({ x: 0, y: 100 });
  });

  it('resolves to null rather than rejecting when the picture cannot be read', async () => {
    // FAILURE IS A NORMAL STATE. A measurement that fails leaves the card
    // unmeasured, which overlayInk reads as "light ink over the scrim" — the
    // legible default. A picture the console cannot sample must still be a
    // picture the owner can use, so nothing here throws and nothing latches.
    await expect(focal.measureCardBands('', '50% 50%')).resolves.toBeNull();
    await expect(focal.measureCardBands(null, '')).resolves.toBeNull();
  });
});

// ------------------------------------------------------------------- the chips

describe('the overlay chips — a closed set, and the default always on screen', () => {
  const pictured = () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Evening, over the water');
    card.media = 'X.webp';
    cardsSetDressing(card.id, 'overlay');
    STATE.staged = emptyStaged();
    STATE.stagedLog = [];
    return card;
  };

  it('offers exactly the values the engine can render', () => {
    // The console's labels and the engine's vocabulary must cover each other:
    // a chip for a value buildCard would not honour writes a card the homepage
    // draws differently, and a registered value with no chip is unreachable.
    expect(Object.keys(OVERLAY_LABEL.place).sort()).toEqual([...RI.overlayPlaces].sort());
    expect(Object.keys(OVERLAY_LABEL.treat).sort()).toEqual([...RI.overlayTreats].sort());
    expect(Object.keys(OVERLAY_LABEL.blur).map(Number).sort())
      .toEqual([...RI.overlayBlurs].sort());
  });

  it('writes one choice, stages exactly one change, and the engine reads it back', () => {
    const card = pictured();
    cardsSetOverlay(card.id, 'place', 'top');
    expect(card.overlay).toEqual({ place: 'top' });
    expect(STATE.staged.cards).toBe(1);
    expect(RI.overlayOf(card).place).toBe('top');
    expect(RI.buildCard(RI.composedItem(card)).getAttribute('data-place')).toBe('top');
  });

  it('stores only what DIFFERS from the default, and drops the key on the way back', () => {
    // Reversibility is structural: the default is one of the chips and pressing
    // it runs this same mutator. And "I tried it and put it back" has to publish
    // the same bytes as "I never touched it" — the serialization law.
    const card = pictured();
    cardsSetOverlay(card.id, 'place', 'centre');
    cardsSetOverlay(card.id, 'treat', 'blur');
    expect(card.overlay).toEqual({ place: 'centre', treat: 'blur' });
    cardsSetOverlay(card.id, 'place', 'bottom');
    cardsSetOverlay(card.id, 'treat', 'scrim');
    expect(card.overlay).toBeUndefined();
  });

  it('+1 staged in BOTH directions, never a tally', () => {
    const card = pictured();
    cardsSetOverlay(card.id, 'treat', 'none');
    const after = STATE.staged.cards;
    cardsSetOverlay(card.id, 'treat', 'scrim');
    // Folded into the same ledger row by _stageCard (one card, one row), and
    // never decremented — STATE.staged counts unpublished CHANGES.
    expect(STATE.staged.cards).toBeGreaterThanOrEqual(after);
    expect(STATE.staged.cards).toBeGreaterThan(0);
  });

  it('refuses a value the stylesheet has no rule for, and stages nothing', () => {
    const card = pictured();
    cardsSetOverlay(card.id, 'place', 'diagonal');
    cardsSetOverlay(card.id, 'treat', 'neon');
    cardsSetOverlay(card.id, 'blur', 9);
    cardsSetOverlay(card.id, 'ink', 'dark');       // never the author's to set
    expect(card.overlay).toBeUndefined();
    expect(STATE.staged.cards).toBe(0);
  });

  it('stages nothing for a chip that is already on', () => {
    const card = pictured();
    cardsSetOverlay(card.id, 'place', 'bottom');   // the default, already worn
    expect(STATE.staged.cards).toBe(0);
    expect(card.overlay).toBeUndefined();
  });

  it('loses the band and the measurement with the picture they describe', () => {
    const card = pictured();
    cardsSetOverlay(card.id, 'place', 'top');
    card.img = { lum: { top: 0.9, mid: 0.3, bottom: 0.2 } };
    cardsClearImage(card.id);
    // A record claiming a brightness nothing has, and a band on a card with no
    // picture, would both publish as descriptions of something that is gone.
    expect(card.overlay).toBeUndefined();
    expect(card.img).toBeUndefined();
    expect(card.card).toBeUndefined();
    expect(card.kind).toBeUndefined();
  });
});

describe('the OVERLAY block in the rail', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  async function openComposerOn(card) {
    await cards.renderCards();
    const slots = cards._cardSlots(cards._stagedInputs());
    const at = slots.findIndex((s) => s && s.kind === 'composed' && s.id === card.id);
    expect(at, 'the composed card should be on the grid').toBeGreaterThan(-1);
    cards.cardsSelectSlot(at);
    return document.getElementById('cards-body').innerHTML;
  }

  const pictured = async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Evening, over the water');
    card.media = 'X.webp';
    cardsSetDressing(card.id, 'overlay');
    return card;
  };

  it('is not there until the card actually wears the layout', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Just words');
    const html = await openComposerOn(card);
    expect(html).not.toContain('WORDS ON THE PICTURE');
    expect(html).not.toContain('cardsSetOverlay');
  });

  it('appears with its rows the moment the card does', async () => {
    const card = await pictured();
    const html = await openComposerOn(card);
    expect(html).toContain('WORDS ON THE PICTURE');
    expect(html).toContain('cardsSetOverlay');
    // Two rows always; the frost row only under the frosted treatment.
    expect([...document.querySelectorAll('.cards-ov-label')].map((n) => n.textContent))
      .toEqual(['Where', 'Behind']);
  });

  it('shows the frost strength only when there is frost to strengthen', async () => {
    const card = await pictured();
    cardsSetOverlay(card.id, 'treat', 'blur');
    await openComposerOn(card);
    expect([...document.querySelectorAll('.cards-ov-label')].map((n) => n.textContent))
      .toEqual(['Where', 'Behind', 'Frost']);
  });

  it('lights the chip the card is wearing', async () => {
    const card = await pictured();
    cardsSetOverlay(card.id, 'place', 'centre');
    await openComposerOn(card);
    const on = [...document.querySelectorAll('.cards-ov-row .layout-chip.is-on .layout-chip-label')]
      .map((n) => n.textContent);
    expect(on).toEqual(['Middle', 'Shaded']);
  });

  it('reports the ink and the reading, and offers no way to set the ink', async () => {
    const card = await pictured();
    card.img = { lum: { top: 0.1, mid: 0.3, bottom: 0.9 } };
    const html = await openComposerOn(card);
    // Bottom band at 0.9 is bright, so the type goes dark — and the block SAYS
    // so rather than leaving the author wondering why the words changed colour.
    expect(html).toContain('dark, on a bright picture');
    expect(html).toContain('90% bright');
    // The one decision that is not the author's. No chip writes it.
    expect(html).not.toMatch(/cardsSetOverlay\([^)]*'ink'/);
  });

  it('says so plainly when the picture has not been measured', async () => {
    const card = await pictured();
    const html = await openComposerOn(card);
    expect(html).toContain('not measured yet');
    // Unmeasured is a normal state, not a fault: the card still renders, with
    // light type over the default scrim.
    expect(html).toContain('light, on a darker picture');
  });
});

// ---- the rail keeps its place (2026-09-11) ----
//
// Every gesture repaints the view, and the rail is its own scroller — so a chip
// pressed in the FROST row three blocks down used to put the rail back at the
// top after every press. The DOM here has no layout, so scrollTop is modelled:
// an element remembers what it was told, which is exactly what a real scroller
// does when the content is tall enough.
describe('the rail keeps its scroll across a repaint', () => {
  let desc;
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() { return this._scrollTop || 0; },
      set(v) { this._scrollTop = v; },
    });
  });
  afterEach(() => {
    if (desc) Object.defineProperty(Element.prototype, 'scrollTop', desc);
    else delete Element.prototype.scrollTop;
  });

  async function openComposerOn(card) {
    await cards.renderCards();
    const slots = cards._cardSlots(cards._stagedInputs());
    const at = slots.findIndex((s) => s && s.kind === 'composed' && s.id === card.id);
    cards.cardsSelectSlot(at);
  }

  it('puts the rail and the stage back where they were', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Evening, over the water');
    card.media = 'X.webp';
    cardsSetDressing(card.id, 'overlay');
    cardsSetOverlay(card.id, 'treat', 'blur');
    await openComposerOn(card);

    const rail = document.querySelector('.studio-rail');
    const stage = document.querySelector('.studio-stage');
    expect(rail && stage).toBeTruthy();
    rail.scrollTop = 640;
    stage.scrollTop = 120;

    // A chip press — the gesture that repaints the whole view.
    cardsSetOverlay(card.id, 'blur', 3);
    const rail2 = document.querySelector('.studio-rail');
    expect(rail2, 'the rail was rebuilt').not.toBe(rail);
    expect(rail2.scrollTop).toBe(640);
    expect(document.querySelector('.studio-stage').scrollTop).toBe(120);
    // And the press itself still landed.
    expect(rail2.querySelector('.cards-ov-row .layout-chip.is-on[title*="Frost"]')).toBeTruthy();
  });

  it('leaves a rail that was at the top at the top', async () => {
    const card = cardsCompose();
    card.media = 'X.webp';
    cardsSetDressing(card.id, 'overlay');
    await openComposerOn(card);
    cardsSetOverlay(card.id, 'place', 'top');
    expect(document.querySelector('.studio-rail').scrollTop).toBe(0);
  });
});

// ---- SOUND: audio from inside the composer (2026-09-11) ----
//
// The track picker existed (cardsChooseTracks) but only an audio-kind card
// could reach it, and the only way to get one was to take the automatic audio
// slot over. Now any composed card offers ♪ ADD AUDIO right under PICTURE, the
// picker opens on the spot, and the same block on the audio card offers the
// way back — with the picture and the words kept, so the reverse is honest.
describe('SOUND — any composed card can become the audio card, from the rail', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    // The library modal, so opening it is observable. Its innards are absent on
    // purpose — renderAudioLibrary bails without them and the open is the fact.
    document.body.insertAdjacentHTML('beforeend',
      '<div id="audio-library-modal" class="modal-overlay hidden"></div>');
    STATE.audio = [
      { id: 'a1', slug: 'one', title: 'One', filename: 'one.mp3', featured: true, featured_order: 1 },
      { id: 'a2', slug: 'two', title: 'Two', filename: 'two.mp3' },
    ];
  });

  async function openComposerOn(card) {
    await cards.renderCards();
    const slots = cards._cardSlots(cards._stagedInputs());
    const at = slots.findIndex((s) => s && s.kind === 'composed' && s.id === card.id);
    expect(at).toBeGreaterThan(-1);
    cards.cardsSelectSlot(at);
    return document.getElementById('cards-body').innerHTML;
  }

  it('sits under PICTURE on a card that does not play, and says the cap', async () => {
    const card = cardsCompose();
    card.media = 'X.webp';
    const html = await openComposerOn(card);
    const heads = [...document.querySelectorAll('.control-block-head')].map((n) => n.firstChild.textContent.trim());
    expect(heads.indexOf('SOUND')).toBe(heads.indexOf('PICTURE') + 1);
    expect(html).toContain('cardsAddAudio');
    expect(html).toContain(`up to ${RI.AUDIO_MAX_PLAYLIST} tracks`);
    expect(html).not.toContain('WHAT THIS CARD PLAYS');
  });

  it('one press: the card is the audio kind, one change is staged, the picker is open', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Evening, over the water');
    card.media = 'X.webp';
    await openComposerOn(card);
    const before = STATE.staged.cards;

    cards.cardsAddAudio(card.id);
    expect(card.kind).toBe('audio');
    expect(RI.composedShape(card)).toBe('audio');
    expect(STATE.staged.cards, 'folded onto the card\'s own staged row').toBe(before);
    expect(document.getElementById('audio-library-modal').classList.contains('hidden')).toBe(false);
    // The picture and the words are KEPT — the reverse has to give them back.
    expect(card.media).toBe('X.webp');
    expect(card.title).toBe('Evening, over the water');

    // The rail now shows what it plays, with the way back in the same block —
    // and no PICTURE or SOUND block, because the card is an audio card.
    const html = document.getElementById('cards-body').innerHTML;
    expect(html).toContain('WHAT THIS CARD PLAYS');
    expect(html).toContain('cardsRemoveAudio');
    expect(html).not.toContain('cardsAddAudio');
    expect(html).not.toContain('cardsPickImage');
  });

  it('the way back: the same block, the picture returns, the set goes', async () => {
    const card = cardsCompose();
    card.media = 'X.webp';
    await openComposerOn(card);
    cards.cardsAddAudio(card.id);
    card.set = 'a-set';                      // as if a set had been borrowed
    cards.cardsRemoveAudio(card.id);
    expect(card.kind).toBeUndefined();
    expect(card.set).toBeUndefined();
    expect(RI.composedShape(card)).toBe('picture');
    const html = document.getElementById('cards-body').innerHTML;
    expect(html).toContain('cardsAddAudio');
    expect(html).not.toContain('WHAT THIS CARD PLAYS');
  });

  it('stages nothing for a card that already is, or already is not, the audio kind', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Just words');   // a card with nothing on it is not on the grid
    await openComposerOn(card);
    const before = STATE.stagedLog.length;
    cards.cardsRemoveAudio(card.id);           // not audio — nothing to remove
    expect(STATE.stagedLog.length).toBe(before);
    cards.cardsAddAudio(card.id);
    const after = STATE.stagedLog.length;
    cards.cardsAddAudio(card.id);              // already audio — nothing to add
    expect(STATE.stagedLog.length).toBe(after);
  });
});
