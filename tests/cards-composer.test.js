// @vitest-environment happy-dom
//
// The composer's mutators — the half of the Cards view that BUILDS a card
// rather than reporting one. The engine-side rules (ordering, the overlay, the
// renderer) are pinned in tests/card-composer.test.js; this file is about what
// the console does to STATE.cards.
//
// Two properties matter most here and neither is visible by reading the markup:
//
//   1. The staging law. One gesture, one staged change, +1 always — typing must
//      fold into a single ledger row rather than inflating the count per
//      keystroke, and nothing may ever pass a negative delta.
//   2. Typing must not repaint the card. The field being typed into lives INSIDE
//      the card, so a rebuild destroys the caret, the selection, the IME
//      composition and the soft keyboard mid-sentence. That is asserted
//      structurally, the way tests/pulse-console.test.js pins paintCard().
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

// The real load order: dev/field-console.html loads audio-player as a classic
// script BEFORE recent-index, so the engine can resolve a borrowed set through
// AudioPlayer.resolveSetTracks rather than keeping a second copy (chunk 4).
await import('../js/audio-player.js');
await import('../js/recent-index.js');
const { STATE, sessionTrash } = await import('../js/console-state.js');
const cards = await import('../js/console/cards.js');
const {
  cardsCompose, cardsSetText, cardsClearImage, cardsReorder, cardsResetToAuto,
  cardsDoneEditing, cardsCancelEdit, cardsHandleStageClick, cardsSetPalette,
  cardsSetMode, cardsSetLayout, cardsSetDressing, cardsFieldInput, cardsGuardTitle,
  cardsEditStaged, _dressingOf, _normalizeCard, _titleCap,
  cardsResetAllToAuto, _cardRetireUndoTarget, _cardUndoRetire,
  _composedCards, _composingId, _activeMode,
} = cards;
const RI = globalThis.RecentIndex;

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', 'js', 'console', 'cards.js'), 'utf8');

const emptyStaged = () => ({
  buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0,
  friends: 0, library: 0, audio: 0, cards: 0,
});

// A card with something on it. cardsCompose() opens an EMPTY card, and an empty
// card is abandoned the moment composing moves on (the ghost rule — a card with
// neither picture nor words can never be selected again, so leaving it in STATE
// burns a place in the budget forever). So a test that wants two cards has to
// finish the first, exactly as an author does.
const composeNamed = (title) => {
  const c = cardsCompose();
  cardsSetText(c.id, 'title', title);
  return c;
};

beforeEach(() => {
  document.body.innerHTML = '<div id="cards-body"></div><div id="toast-host"></div>';
  for (const k of ['buffer', 'archive', 'posts', 'audio', 'wallpapers', 'barrel',
    'friends', 'library', 'cards']) STATE[k] = [];
  STATE.staged = emptyStaged();
  STATE.stagedLog = [];
  sessionTrash.length = 0;
  globalThis.confirm = () => true;
});

describe('starting a card', () => {
  it('mints one with the next rank and stages exactly one change', () => {
    const card = cardsCompose();
    expect(card.order).toBe(1);
    expect(STATE.cards).toHaveLength(1);
    expect(STATE.staged.cards).toBe(1);
  });

  it('opens empty, because an unfinished card is invisible rather than broken', () => {
    // The engine declines to render a card with neither picture nor words
    // (composedPick), so starting from nothing costs the homepage nothing.
    const card = cardsCompose();
    expect(card.title).toBe('');
    expect(card.media).toBeUndefined();
    expect(globalThis.RecentIndex.composedPick(STATE.cards)).toEqual([]);
  });

  it('focuses the new card for editing', () => {
    const card = cardsCompose();
    expect(_composingId()).toBe(card.id);
  });

  it('refuses past the homepage budget rather than minting a card that cannot show', () => {
    composeNamed('One'); composeNamed('Two');
    expect(cardsCompose()).toBeNull();
    expect(STATE.cards).toHaveLength(2);
  });
});

describe('writing on the card', () => {
  it('stores the words on the CARD, never on whatever it points at', () => {
    const post = { id: 'p-1', fn_id: 'fn-1', title: 'The Original Title', body: 'x' };
    STATE.posts = [post];
    const card = cardsCompose();
    card.source = { type: 'post', id: 'p-1' };
    cardsSetText(card.id, 'title', 'A Different Line');

    expect(STATE.cards[0].title).toBe('A Different Line');
    // The whole reason the card owns its text: composing never edits the post.
    expect(post.title).toBe('The Original Title');
  });

  it('folds a burst of typing into ONE staged change', () => {
    const card = cardsCompose();
    expect(STATE.staged.cards).toBe(1);
    for (const v of ['T', 'Th', 'The', 'The G']) cardsSetText(card.id, 'title', v);
    // stageChange folds per item — a ledger row per keystroke would make the
    // publish count meaningless.
    expect(STATE.stagedLog.filter((r) => r.surface === 'cards')).toHaveLength(1);
    expect(STATE.staged.cards, 'typing does not inflate the stage counter').toBe(1);
  });

  it('ignores a field the card does not have', () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'body', 'nope');
    expect(STATE.cards[0].body).toBeUndefined();
  });

  // The structural guard. A rebuild would destroy the caret mid-sentence, and
  // no assertion about rendered markup can see that.
  it('the typing path never rebuilds the view', () => {
    const fn = SOURCE.match(/export function cardsSetText[\s\S]*?\n}/)[0];
    expect(fn, 'typing must not call the full render').not.toMatch(/_repaint\(|renderCards\(/);
    expect(fn, 'typing repaints surgically').toContain('_paintComposed');
  });

  it('the surgical repaint never writes a field value back', () => {
    const fn = SOURCE.match(/function _paintComposed\([\s\S]*?\n}/)[0];
    expect(fn).not.toMatch(/\.value\s*=/);
    // The fields are editable leaves now, so their "value" is their content.
    expect(fn).not.toMatch(/innerHTML\s*=|innerText\s*=/);
  });

  it('the input handler moves an attribute, never the field\'s content', () => {
    const fn = SOURCE.match(/export function cardsFieldInput[\s\S]*?\n}/)[0];
    expect(fn).not.toMatch(/innerHTML\s*=|innerText\s*=|textContent\s*=/);
    expect(fn).toContain('data-empty');
  });
});

describe('the picture', () => {
  it('clearing it takes the picture-led dressing with it', () => {
    const card = cardsCompose();
    card.media = 'X.webp';
    cardsSetDressing(card.id, 'picture');
    expect(card.kind).toBe('photo');
    cardsClearImage(card.id);
    expect(card.kind, '"Always the picture" cannot survive losing the picture').toBeUndefined();
    expect(_dressingOf(card)).toBe('auto');
  });

  it('clearing it takes the picture-led layout with it', () => {
    const card = cardsCompose();
    Object.assign(card, {
      media: 'X.webp', folder: 'archive', cardFocus: '20% 80%', card: { layout: 'hero' },
    });
    cardsClearImage(card.id);
    for (const k of ['media', 'folder', 'cardFocus', 'card']) {
      expect(k in STATE.cards[0], `${k} should be gone with the picture`).toBe(false);
    }
  });

  it('leaves an explicit words-only layout alone', () => {
    const card = cardsCompose();
    Object.assign(card, { media: 'X.webp', card: { layout: 'plain' } });
    cardsClearImage(card.id);
    expect(STATE.cards[0].card).toEqual({ layout: 'plain' });
  });
});

describe('order is a rank, and it compacts', () => {
  it('swaps two cards and renumbers from one', () => {
    const a = composeNamed('A'); const b = composeNamed('B');
    cardsReorder(b.id, 'up');
    expect(_composedCards().map((c) => c.id)).toEqual([b.id, a.id]);
    expect(_composedCards().map((c) => c.order)).toEqual([1, 2]);
  });

  it('does nothing at the ends', () => {
    const a = composeNamed('A'); composeNamed('B');
    cardsReorder(a.id, 'up');
    expect(_composedCards()[0].id).toBe(a.id);
  });

  // `_cards().length + 1` counted tombstones, which after a retire mints the
  // next card at rank 3 in a row of one. Harmless to the sort, and still a
  // break of the 1..n-and-contiguous invariant _recompact exists to hold.
  it('mints the next LIVE rank, with a tombstone in the list', () => {
    const a = composeNamed('One');
    a._imported = true;
    cardsResetToAuto(a.id);
    const next = composeNamed('Two');
    expect(next.order).toBe(1);
  });

  it('a delete promotes the survivor rather than leaving a hole', () => {
    const a = composeNamed('A'); const b = composeNamed('B');
    cardsResetToAuto(a.id);
    expect(_composedCards().map((c) => c.id)).toEqual([b.id]);
    expect(_composedCards()[0].order).toBe(1);
  });
});

describe('reset to automatic', () => {
  it('hands the slot back and keeps the card in the session trash', () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Goodbye');
    cardsResetToAuto(card.id);

    expect(STATE.cards).toHaveLength(0);
    expect(STATE.staged.cards, 'resetting a fresh card clears its staged count back to zero').toBe(0);
    // The publish horizon is the way back — layer 3 of the reversibility rule.
    expect(sessionTrash.some((t) => t.surface === 'cards')).toBe(true);
  });

  it('asks first — this is a destructive, un-typed-back gesture', () => {
    let asked = false;
    globalThis.confirm = () => { asked = true; return false; };
    const card = cardsCompose();
    cardsResetToAuto(card.id);
    expect(asked).toBe(true);
    expect(STATE.cards).toHaveLength(1);
  });
});

// ---- ⌫ ALL SLOTS AUTOMATIC — the danger zone (owner report, 2026-09-13) ----
//
// The bulk gesture has to make exactly the same per-card decision the per-slot
// control makes, because the thing it would be easy to get wrong is the one
// thing that cannot be undone: a published card deleted outright frees an
// address a live link still points at. So these pin the split, the confirm, and
// that one chip reverses the whole gesture rather than half of it.
describe('resetting every slot to automatic', () => {
  const publish = (card) => { card._imported = true; STATE.stagedLog = []; STATE.staged = emptyStaged(); };

  it('takes every composed card off the grid in one gesture', () => {
    composeNamed('One'); composeNamed('Two');
    cardsResetAllToAuto();
    expect(_composedCards()).toHaveLength(0);
  });

  it('asks first, naming what goes — a bulk clear with no confirm is the violation', () => {
    let prompt = '';
    globalThis.confirm = (msg) => { prompt = msg; return false; };
    composeNamed('Kearny Phantom'); composeNamed('Van Ness');
    cardsResetAllToAuto();
    expect(prompt).toContain('Kearny Phantom');
    expect(prompt).toContain('Van Ness');
    expect(_composedCards(), 'declining changes nothing').toHaveLength(2);
  });

  it('retires the published one and trashes the unpublished one — the same split as one slot', () => {
    const out = composeNamed('Published'); publish(out);
    const draft = composeNamed('Never shipped');
    cardsResetAllToAuto();

    expect(_composedCards()).toHaveLength(0);
    const tomb = STATE.cards.find((c) => c.id === out.id);
    expect(tomb, 'the published address is still reserved').toBeTruthy();
    expect(tomb.retired).toBe(true);
    expect(tomb.title, 'a tombstone holds an address, not content').toBeUndefined();
    expect(STATE.cards.some((c) => c.id === draft.id), 'the draft left STATE').toBe(false);
    expect(sessionTrash.some((t) => t.surface === 'cards'), 'and went to the trash').toBe(true);
  });

  it('one chip puts BOTH retired cards back — the gesture reverses whole', () => {
    const a = composeNamed('A'); const b = composeNamed('B');
    publish(a); publish(b);
    cardsResetAllToAuto();
    expect(_cardRetireUndoTarget(), 'the chip is offered').toBeTruthy();

    _cardUndoRetire();
    expect(_composedCards().map((c) => c.title).sort()).toEqual(['A', 'B']);
    expect(STATE.staged.cards, 'and the ledger is back where it started').toBe(0);
  });

  it('withdraws the chip once a card has come back by another route', () => {
    const a = composeNamed('A'); const b = composeNamed('B');
    publish(a); publish(b);
    cardsResetAllToAuto();
    // One tombstone revived by hand — a partial restore would be a history.
    STATE.cards[STATE.cards.findIndex((c) => c.id === a.id)] = a;
    expect(_cardRetireUndoTarget()).toBeNull();
  });

  it('offers no chip when nothing retired — the trash is the way back for a draft', () => {
    composeNamed('Never shipped');
    cardsResetAllToAuto();
    expect(_cardRetireUndoTarget()).toBeNull();
    expect(sessionTrash.some((t) => t.surface === 'cards')).toBe(true);
  });

  it('does nothing, and asks nothing, on a homepage that is already automatic', () => {
    let asked = false;
    globalThis.confirm = () => { asked = true; return true; };
    cardsResetAllToAuto();
    expect(asked).toBe(false);
  });
});

// ---- chunk 6: a published card keeps its address ----
//
// The fourth tombstone (after dark frames, retired tracks and retired sets) and
// the same argument each time: the id is a permanent address the moment it is
// published, so freeing it would let a later card quietly answer someone's old
// link. These pin the SPLIT — never-published goes to trash, published retires
// — and that the tombstone survives everything that could quietly undo it.
describe('retiring a published card', () => {
  const publish = (card) => { card._imported = true; STATE.stagedLog = []; STATE.staged = emptyStaged(); };

  it('retires instead of deleting, keeping the id and nothing else', () => {
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);

    expect(STATE.cards).toHaveLength(1);
    const tomb = STATE.cards[0];
    expect(tomb.id).toBe(card.id);
    expect(tomb.retired).toBe(true);
    expect(tomb.retired_at).toBeTruthy();
    expect(tomb.title, 'a tombstone holds an address, not content').toBeUndefined();
    expect(tomb.media).toBeUndefined();
  });

  it('does not put a published card in the trash — there is nothing to restore it INTO', () => {
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);
    expect(sessionTrash.some((t) => t.surface === 'cards')).toBe(false);
  });

  it('still trashes a never-published card — its address was never spoken for', () => {
    const card = composeNamed('Never shipped');
    cardsResetToAuto(card.id);
    expect(STATE.cards).toHaveLength(0);
    expect(sessionTrash.some((t) => t.surface === 'cards')).toBe(true);
  });

  it('asks first, and says the address stays reserved', () => {
    let asked = '';
    globalThis.confirm = (msg) => { asked = msg; return false; };
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);
    expect(asked).toContain('/card/');
    expect(asked).toContain('reserved');
    expect(STATE.cards[0].retired).toBeUndefined();
  });

  it('stages exactly one change, as a removal', () => {
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);
    expect(STATE.staged.cards).toBe(1);
    expect(STATE.stagedLog.filter((r) => r.surface === 'cards')).toHaveLength(1);
  });

  it('leaves the tombstone out of the studio, so the budget is a LIVE-card budget', () => {
    const a = composeNamed('One'); const b = composeNamed('Two');
    publish(a);
    cardsResetToAuto(a.id);
    expect(_composedCards().map((c) => c.id)).toEqual([b.id]);
    // The freed place is usable at once — two tombstones must not wedge ＋ COMPOSE.
    expect(cardsCompose()).not.toBeNull();
  });

  it('survives the ghost sweep — a tombstone is empty on purpose', async () => {
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);
    await cards.renderCards();
    expect(STATE.cards.filter((c) => c.retired)).toHaveLength(1);
  });

  it('is not rendered by the engine, which is what makes the slot automatic again', () => {
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);
    expect(RI.composedPick(STATE.cards, [], [])).toEqual([]);
  });
});

describe('↩ UNDO RETIRE — one chip, resolved against state now', () => {
  const publish = (card) => { card._imported = true; STATE.stagedLog = []; STATE.staged = emptyStaged(); };

  it('puts the card back whole, with its words and its rank', () => {
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);
    cards._cardUndoRetire();

    expect(STATE.cards).toHaveLength(1);
    expect(STATE.cards[0].retired).toBeUndefined();
    expect(STATE.cards[0].title).toBe('Out there');
    expect(_composedCards()[0].order).toBe(1);
  });

  it('takes the staged removal back with it', () => {
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);
    cards._cardUndoRetire();
    expect(STATE.staged.cards).toBe(0);
    expect(STATE.stagedLog.filter((r) => r.surface === 'cards')).toHaveLength(0);
  });

  it('offers nothing when nothing has been retired', () => {
    expect(cards._cardRetireUndoTarget()).toBeNull();
  });

  // Retiring frees a place, so the owner can compose into it before undoing.
  // Restoring on top of that would put a third card in a two-card budget — the
  // third invisible on the homepage (composedPick slices) and present in the
  // studio. The chip withdraws rather than becoming a button that refuses.
  it('withdraws once the freed place has been taken', () => {
    const a = composeNamed('One'); const b = composeNamed('Two');
    a._imported = true;
    cardsResetToAuto(a.id);
    expect(cards._cardRetireUndoTarget()).not.toBeNull();

    composeNamed('Three');
    expect(_composedCards()).toHaveLength(2);
    expect(cards._cardRetireUndoTarget()).toBeNull();
    cards._cardUndoRetire();
    expect(_composedCards(), 'the budget is not exceeded by an undo').toHaveLength(2);
    expect(b).toBeTruthy();
  });

  it('offers nothing once the card is back — never a dead button', () => {
    const card = composeNamed('Out there');
    publish(card);
    cardsResetToAuto(card.id);
    expect(cards._cardRetireUndoTarget()).not.toBeNull();
    cards._cardUndoRetire();
    expect(cards._cardRetireUndoTarget()).toBeNull();
  });
});

describe('the staging law', () => {
  it('never passes a negative delta, in any composer path', () => {
    const composer = SOURCE.slice(SOURCE.indexOf('THE COMPOSER'));
    expect(composer).not.toMatch(/bumpStage\([^)]*,\s*-/);
    expect(composer).not.toMatch(/delta:\s*-/);
  });
});

// ------------------------------------------------------------ what it renders

describe('the composer surface', () => {
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

  it('makes the card itself editable — the whole point of a composer', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'The Geometry of Silence');
    await openComposerOn(card);

    const title = document.getElementById('composer-title');
    const tease = document.getElementById('composer-tease');
    // The card's OWN text nodes made editable — not a form beside a picture of
    // one, and not inputs laid over it (chunk 2: the composer is buildCard's
    // card). A field cannot carry a child element, which is why it is the leaf
    // itself that becomes editable rather than a textarea standing in for it.
    expect(title.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(tease.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(title.textContent).toBe('The Geometry of Silence');
    expect(title.closest('.wk-card'), 'the field must be INSIDE the card').not.toBeNull();
    expect(title.classList.contains('wk-t-title'), 'the headline is the tile\'s headline node').toBe(true);
    expect(tease.classList.contains('wk-snip'), 'the tease is the tile\'s snip node').toBe(true);
  });

  it('is the card the renderer draws — same root, same classes, same tier', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Something');
    cardsSetText(card.id, 'tease', 'A short line.');
    await openComposerOn(card);
    const root = document.getElementById('composer-card');
    const real = RI.buildCard(RI.composedItem(card));
    expect(root.className).toBe(real.className);
    expect(root.getAttribute('data-shape')).toBe(real.getAttribute('data-shape'));
    expect(root.getAttribute('data-tier')).toBe(real.getAttribute('data-tier'));
    // The words tile's furniture is the engine's: a <span> kicker with its
    // aria-hidden dot, no place-and-year line (every word was typed).
    expect(root.querySelector('span.wk-kicker .wk-dot[aria-hidden="true"]')).not.toBeNull();
    expect(root.querySelector('.wk-t-meta')).toBeNull();
    // And it is not a link: a takeover keeps its link, the composer must not be one.
    expect(root.hasAttribute('href')).toBe(false);
  });

  it('mounts the shape the engine renders — no media band on a words card, no kicker on a picture card', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Words only, for now');
    await openComposerOn(card);
    expect(document.getElementById('composer-card').getAttribute('data-shape')).toBe('words');
    expect(document.querySelector('#composer-card .wk-img'), 'a words card has no picture').toBeNull();

    card.media = 'X.webp';
    await openComposerOn(card);
    const root = document.getElementById('composer-card');
    expect(root.getAttribute('data-shape')).toBe('picture');
    expect(root.querySelector('.wk-img'), 'a picture card has its picture').not.toBeNull();
    expect(root.querySelector('.wk-kicker'), 'and wears the chip, not the kicker').toBeNull();
    // The editable pair on a picture card is the CAPTION pair — .wk-title and
    // .wk-meta — the grammar the archive card beside it uses.
    expect(document.getElementById('composer-title').classList.contains('wk-title')).toBe(true);
    expect(document.getElementById('composer-tease').classList.contains('wk-meta')).toBe(true);
  });

  it('gives a picture card with no tease the caption line to type into', async () => {
    // captionOf() draws no line without a tease; the composer adds the one the
    // renderer will draw the moment there is a word — same class, same place.
    const card = cardsCompose();
    card.media = 'X.webp';
    await openComposerOn(card);
    const tease = document.getElementById('composer-tease');
    expect(tease.closest('.wk-body')).not.toBeNull();
    expect(tease.hasAttribute('data-empty')).toBe(true);
  });

  // The address is not something the owner picks — it is minted with the card
  // and, once published, permanent. So the rail SHOWS it rather than offering to
  // edit it, and the string comes from the engine's own entryHref so the studio
  // and the grid can never spell it two ways.
  it('shows the card its own address, with a copy', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Somewhere');
    const html = await openComposerOn(card);
    expect(html).toContain(RI.entryHref('composed', card));
    expect(html).toContain('cardsCopyAddress');
    expect(html, 'not yet permanent — nothing is until it publishes')
      .toContain('reserved on publish');
  });

  // ⚠️ ONE BUILDER FOR A CARD'S SHARE TARGET. The composer rail composed its own
  // — its own stem, its own address, its own idea of what the card is called —
  // and the name was the first thing to drift: a card with no title but a tease
  // reads as its tease on the studio rail and read as "this card" here. It goes
  // through _slotOf → _shareOf now, the same path the grid's rail takes, so the
  // two cannot disagree about a card they are both looking at.
  it('builds its share target through the one builder, never inline', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'tease', 'A quiet morning on the water.');
    const html = await openComposerOn(card);
    expect(html).toContain('SHARE');
    expect(html).toContain('shareStampImages');

    // ⚠️ STRUCTURAL, because the rendered markup CANNOT show this. The thing
    // that drifted is the target's `name`, and a name only ever reaches a
    // toast — both spellings emit identical HTML, so an assertion over the
    // markup passes either way (it did, which is how this test got rewritten).
    // What can be checked is that the composer asks the same function the grid's
    // rail asks; the behaviour it must agree about is asserted below it.
    const composer = SOURCE.slice(SOURCE.indexOf('function composerRailHtml'));
    expect(composer, 'the composer must route through _shareOf')
      .toContain('_shareOf(_slotOf(item))');
    expect(composer.slice(0, composer.indexOf('function railHtml')),
      'and must not compose a target of its own')
      .not.toContain('shareTarget({');

    // The answer they now share: a card with no title is named by its tease.
    const viaStudio = cards._shareOf(cards._slotOf(RI.composedItem(card, [], [])));
    expect(viaStudio.name).toBe('A quiet morning on the water.');
    expect(viaStudio.stem).toBe(`meta/card-${card.id}`);
  });

  // The block above it already shows the address with its own COPY, so this one
  // drops both halves rather than putting a second identical button three
  // inches below the first.
  it('and carries no second copy of the address it sits under', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Somewhere');
    const html = await openComposerOn(card);
    expect(html).toContain('cardsCopyAddress');          // the ADDRESS block's
    expect(html).not.toContain('shareCopyLink');         // not a second one
    expect(html).toContain('the address above');         // and the copy says which
  });

  it('says the address is permanent once the card has been published', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Somewhere');
    card._imported = true;
    const html = await openComposerOn(card);
    expect(html).toContain('permanent');
    // …and the removal gesture says what it will actually do.
    expect(html).toContain('RETIRE THIS CARD');
    expect(html).not.toContain('RESET TO AUTOMATIC');
  });

  // LIVE or STAGED, as a coloured aside on the ADDRESS block (2026-09-12) — the
  // owner's report was a copied link that 404ed, because the card was staged.
  // ⚠️ The aside is TEXT and controlBlock escapes it: the first cut passed a
  // `<span class="tone-badge">` through it and the rail printed the markup.
  it('badges the address STAGED until the card is published, LIVE after — as text, never markup', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Somewhere');
    let html = await openComposerOn(card);
    expect(html).toMatch(/<span class="control-block-aside"[^>]*data-tone="staged"[^>]*>STAGED<\/span>/);
    expect(html).not.toContain('&lt;span');
    card._imported = true;
    html = await openComposerOn(card);
    expect(html).toMatch(/<span class="control-block-aside"[^>]*data-tone="live"[^>]*>LIVE<\/span>/);
  });

  // OPEN ↗ goes to where the card CAME FROM. It said `cards` for every composed
  // card — an OPEN CARDS ↗ on the Cards view, reopening the view it was on.
  it('opens the surface a composed card came from, and offers nothing for one made from nothing', () => {
    const fromBuffer = { id: 'c-b', title: 'B', media: 'X.webp', source: { surface: 'buffer', id: 'f1' }, added_at: '2026-09-10' };
    const fromNote = { id: 'c-n', title: 'N', source: { surface: 'posts', id: 'p1' }, added_at: '2026-09-10' };
    const scratch = { id: 'c-s', title: 'S', added_at: '2026-09-10' };
    expect(cards._slotOf(RI.composedItem(fromBuffer, [], [])).view).toBe('buffer');
    expect(cards._slotOf(RI.composedItem(fromNote, [], [])).view, 'notes are the fn view').toBe('fn');
    expect(cards._slotOf(RI.composedItem(scratch, [], [])).view).toBe('');
    expect(cards._slotOf(RI.composedItem(scratch, [], [])).view).not.toBe('cards');
  });

  it('offers every control a card needs, and names them plainly', async () => {
    const card = cardsCompose();
    card.media = 'X.webp';
    const html = await openComposerOn(card);
    for (const call of ['cardsPickImage', 'cardsCropCard', 'cardsClearImage',
      'cardsFieldInput', 'cardsGuardTitle', 'cardsSetDressing', 'cardsResetToAuto']) {
      expect(html, `${call} should be reachable from the composer`).toContain(call);
    }
    expect(html).toContain('RESET TO AUTOMATIC');
  });

  it('offers the three dressings, lights the one worn, and greys the one the card cannot wear', async () => {
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'No picture yet');
    await openComposerOn(card);
    const labels = [...document.querySelectorAll('.layout-chip-label')].map((n) => n.textContent);
    // Three dressings, then whatever further layouts the engine registers for
    // the kind — `overlay` since chunk 3, with nothing in cards.js listing it.
    expect(labels).toEqual([
      'Automatic', 'Always the picture', 'Always the words', 'Words on the picture',
    ]);
    const on = [...document.querySelectorAll('.layout-chip.is-on .layout-chip-label')].map((n) => n.textContent);
    expect(on).toEqual(['Automatic']);
    // Greyed, not hidden: the option exists, and the reason is in the tooltip.
    // Both picture-led dressings are refused for the same reason — there is no
    // picture — which is one gate asked twice, not two rules.
    const blocked = [...document.querySelectorAll('.layout-chip.is-blocked .layout-chip-label')].map((n) => n.textContent);
    expect(blocked).toEqual(['Always the picture', 'Words on the picture']);

    card.media = 'X.webp';
    cardsSetDressing(card.id, 'words');
    await openComposerOn(card);
    expect(document.querySelectorAll('.layout-chip.is-blocked')).toHaveLength(0);
    expect(document.querySelector('.layout-chip.is-on .layout-chip-label').textContent).toBe('Always the words');
  });

  it('widens by itself when the engine registers a further layout for the kind', async () => {
    // The chips are read off RecentIndex.cardLayouts. Chunk 3's `overlay` duly
    // appeared here with nothing in cards.js listing it (the test above pins
    // that); this one keeps the MECHANISM pinned for the layout after it, using
    // a throwaway registered on the photo kind.
    const card = cardsCompose();
    card.media = 'X.webp';
    RI.cardLayouts.photo.push('throwaway');
    try {
      await openComposerOn(card);
      const names = [...document.querySelectorAll('.layout-chip-name')].map((n) => n.textContent);
      expect(names).toContain('photo · throwaway');
      cardsSetDressing(card.id, 'throwaway');
      expect(card.kind).toBe('photo');
      expect(card.card).toEqual({ layout: 'throwaway' });
      expect(_dressingOf(card)).toBe('throwaway');
    } finally {
      RI.cardLayouts.photo.pop();
    }
  });

  it('cardsSetLayout does nothing to a composed card — the dressing owns both halves', () => {
    const card = cardsCompose();
    card.media = 'X.webp';
    cardsSetLayout('composed', card.id, 'hero');
    expect(card.card).toBeUndefined();
    expect(card.kind).toBeUndefined();
  });

  it('offers COMPOSE while there is room, and disables it at the budget', async () => {
    await cards.renderCards();
    expect(document.querySelector('.cards-compose').hasAttribute('disabled')).toBe(false);
    composeNamed('One'); composeNamed('Two');
    await cards.renderCards();
    expect(document.querySelector('.cards-compose').hasAttribute('disabled')).toBe(true);
  });

  it('offers no COMPOSE at all while looking at what is already published', async () => {
    await cards.renderCards();
    cards.cardsSetSource('live');
    expect(document.querySelector('.cards-compose')).toBeNull();
    cards.cardsSetSource('staged');
  });
});

// -------------------------------------------------- opening what you just made

describe('COMPOSE opens the thing it just made', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  // The bug this pins: a new card has neither picture nor words, and the engine
  // deliberately refuses to render one — so a console that decided what to show
  // by looking at THE GRID found nothing, opened no composer, and left COMPOSE
  // looking like it only raised a toast. What is being composed is module state;
  // that is what the studio must ask.
  it('shows the composer for a brand-new, still-empty card', async () => {
    await cards.renderCards();
    cardsCompose();
    expect(document.getElementById('composer-title'), 'the composer must open on a new card')
      .not.toBeNull();
    expect(globalThis.RecentIndex.composedPick(STATE.cards), 'and it is still not on the grid')
      .toEqual([]);
  });

  it('keeps it open while you give it words', async () => {
    await cards.renderCards();
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'A');
    await cards.renderCards();
    expect(document.getElementById('composer-title')).not.toBeNull();
    expect(_composingId()).toBe(card.id);
  });
});

describe('editing a card the grid picked', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  it('takes the card over, seeded from it, and leaves the entry alone', async () => {
    const photo = {
      id: 'p-1', slug: 'granite', filename: 'G.webp', title: 'YOSEMITE GRANITE',
      location: 'Yosemite, 2026', added_at: '2026-08-01', cardFocus: '20% 80%',
    };
    STATE.archive = [photo];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'archive');
    expect(at).toBeGreaterThan(-1);
    cards.cardsSelectSlot(at);
    cards.cardsEditSlot(at);

    expect(STATE.cards).toHaveLength(1);
    const made = STATE.cards[0];
    expect(made.media).toBe('G.webp');
    expect(made.cardFocus).toBe('20% 80%');
    expect(made.title).toBe('YOSEMITE GRANITE');
    // Seeded COPIES, but the link and provenance ride along — the card still
    // opens the archive photo it came from.
    expect(made.link).toBe('/archive/?f=granite');
    expect(made.source).toEqual({ surface: 'archive', id: 'p-1' });
    // The archive entry itself is untouched (a link is navigation, not write-back).
    expect(photo.title).toBe('YOSEMITE GRANITE');
    expect(photo.card).toBeUndefined();
    expect(photo.link).toBeUndefined();
    expect(_composingId()).toBe(made.id);
  });

  it('a takeover of a note that leads with its hero stays the note\'s hero card', async () => {
    STATE.posts = [{
      id: 'n-hero', fn_id: 'fn-hero', title: 'Hero Note', body: 'Body.',
      hero_filename: 'H.webp', card: { layout: 'hero' }, added_at: '2026-08-01',
    }];
    await cards.renderCards();
    const at = cards._cardSlots(cards._stagedInputs()).findIndex((s) => s && s.key === 'text:fn-hero');
    cards.cardsEditSlot(at);
    const card = STATE.cards[0];
    expect(card.kind).toBe('text');
    expect(card.card).toEqual({ layout: 'hero' });
    expect(card.media).toBe('H.webp');
    expect(_dressingOf(card)).toBe('picture');
    // A note without a hero, and a photo, start Automatic: no kind written.
    cardsCancelEdit();
    STATE.posts = [{ id: 'n-plain', fn_id: 'fn-plain', title: 'Plain Note', body: 'Body.', added_at: '2026-08-01' }];
    await cards.renderCards();
    cards.cardsEditSlot(cards._cardSlots(cards._stagedInputs()).findIndex((s) => s && s.key === 'text:fn-plain'));
    expect(STATE.cards[0].kind).toBeUndefined();
  });

  it('keeps a field note card\'s link to the note', async () => {
    STATE.posts = [{
      id: 'p-fn', fn_id: 'fn-9', title: 'A Note', body: 'A one-liner.',
      status: 'published', added_at: '2026-08-01',
    }];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'text');
    expect(at).toBeGreaterThan(-1);
    cards.cardsEditSlot(at);
    expect(STATE.cards[0].link).toBe('/field-notes/post?slug=fn-9');
    expect(STATE.cards[0].source).toEqual({ surface: 'posts', id: 'p-fn' });
  });

  it('typing on a spawned card never drops its inherited link', async () => {
    STATE.archive = [{ id: 'p-a2', slug: 'a-two', filename: 'A2.webp', title: 'Two', added_at: '2026-08-01' }];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'archive');
    cards.cardsEditSlot(at);
    const id = _composingId();
    cardsSetText(id, 'title', 'My own words');
    cardsSetText(id, 'tease', 'And a line.');
    expect(STATE.cards[0].link).toBe('/archive/?f=a-two');
    expect(STATE.cards[0].source).toEqual({ surface: 'archive', id: 'p-a2' });
  });

  it('cardsClearLink cuts a spawned card loose from its source', async () => {
    STATE.archive = [{ id: 'p-a3', slug: 'a-three', filename: 'A3.webp', title: 'Three', added_at: '2026-08-01' }];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'archive');
    cards.cardsEditSlot(at);
    const id = _composingId();
    expect(STATE.cards[0].link).toBe('/archive/?f=a-three');
    cards.cardsClearLink(id);
    expect(STATE.cards[0].link).toBeUndefined();
    expect(STATE.cards[0].source).toBeUndefined();
  });

  it('sends a pulse back to its own composer rather than taking it over', async () => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: { id: 'p1', text: 'Live line.' } } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    await cards.renderCards();
    const at = (cards._cardSlots({ ...cards._stagedInputs(), pulse: { pulse: { id: 'p1', text: 'Live line.' } } }) || [])
      .findIndex((s) => s && s.kind === 'pulse');
    if (at > -1) { cards.cardsSelectSlot(at); cards.cardsEditSlot(at); }
    expect(STATE.cards).toHaveLength(0);
  });
});

describe('exiting edit mode and canceling', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  it('cardsDoneEditing clears _composingId and renders the clean preview', async () => {
    await cards.renderCards();
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Clean Preview');
    expect(_composingId()).toBe(card.id);

    cardsDoneEditing();
    expect(_composingId()).toBeNull();
    // After exiting edit mode, the editor textareas are gone, and EDIT THIS CARD is offered
    expect(document.getElementById('composer-title')).toBeNull();
    expect(document.getElementById('cards-body').innerHTML).toContain('EDIT THIS CARD');
  });

  it('cardsCancelEdit on an untouched taken-over card reverts to automatic cleanly', async () => {
    const photo = {
      id: 'p-2', slug: 'mist', filename: 'M.webp', title: 'VALLEY MIST',
      location: 'Yosemite, 2026', added_at: '2026-08-01', cardFocus: '50% 50%',
    };
    STATE.archive = [photo];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'archive');
    expect(at).toBeGreaterThan(-1);

    cards.cardsSelectSlot(at);
    cards.cardsEditSlot(at);
    expect(STATE.cards).toHaveLength(1);
    expect(STATE.staged.cards).toBe(1);

    // Decided not to change anything: cancel edit
    cardsCancelEdit();
    expect(_composingId()).toBeNull();
    expect(STATE.cards).toHaveLength(0);
    expect(STATE.staged.cards, 'reverts staged counter so it does not leave a phantom staged change').toBe(0);
  });

  // ---- the Cancel confirm, and the list it kept drifting away from ----
  //
  // Cancelling a TAKEN-OVER slot always ends the same way — the slot goes back
  // to automatic — so the thing under test is not the discard, it is the
  // CONFIRM. That prompt is the only thing standing between "I changed my mind
  // about taking this slot" and "I just lost the work I did on it", and it is
  // gated on an is-this-untouched check.
  //
  // That check used to be a hand-written list of five fields sitting beside a
  // snapshot that captured more, and it drifted twice: the link and its
  // provenance first (2026-09-07), then `cardFocus` (2026-09-08) — crop a
  // taken-over card, hit Cancel, and it was thrown away without a word, because
  // a comparison that never looked at the crop concluded nothing had changed.
  // Both now read one table (EDIT_FIELDS), so these tests are really asking:
  // does every field an edit can touch still reach the confirm?
  const withConfirm = (answer, fn) => {
    const before = globalThis.confirm;
    let asked = 0;
    globalThis.confirm = () => { asked += 1; return answer; };
    try { fn(); } finally { globalThis.confirm = before; }
    return asked;
  };

  const takeOverArchiveSlot = async () => {
    STATE.archive = [{
      id: 'p-3', slug: 'ridge', filename: 'R.webp', title: 'RIDGE LINE',
      location: 'Sierra, 2026', added_at: '2026-08-02', cardFocus: '50% 50%',
    }];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'archive');
    expect(at).toBeGreaterThan(-1);
    cards.cardsSelectSlot(at);
    cards.cardsEditSlot(at);
    expect(STATE.cards).toHaveLength(1);
    return STATE.cards[0];
  };

  it('asks before discarding a taken-over card whose CROP was changed', async () => {
    const card = await takeOverArchiveSlot();
    expect(card.cardFocus, 'takeover seeds the crop from the entry').toBe('50% 50%');

    // What cardsCropCard() leaves behind once the focal picker commits.
    card.cardFocus = '30% 80%';

    const asked = withConfirm(true, () => cardsCancelEdit());
    expect(asked, 'a changed crop is a change — Cancel must ask').toBe(1);
    expect(STATE.cards).toHaveLength(0);
  });

  it('keeps the card when the crop confirm is declined', async () => {
    const card = await takeOverArchiveSlot();
    card.cardFocus = '30% 80%';

    const asked = withConfirm(false, () => cardsCancelEdit());
    expect(asked).toBe(1);
    expect(STATE.cards, 'declining the confirm keeps the card AND the crop').toHaveLength(1);
    expect(STATE.cards[0].cardFocus).toBe('30% 80%');
  });

  it('asks before discarding a taken-over card that was made free-form', async () => {
    const card = await takeOverArchiveSlot();
    expect(card.link, 'takeover seeds the way home').toBeTruthy();

    // ✕ MAKE FREE-FORM cuts the pair.
    delete card.link;
    delete card.source;

    const asked = withConfirm(true, () => cardsCancelEdit());
    expect(asked, 'losing the link is a change — Cancel must ask').toBe(1);
  });

  it('still discards an untouched taken-over card without asking', async () => {
    await takeOverArchiveSlot();
    const asked = withConfirm(true, () => cardsCancelEdit());
    expect(asked, 'nothing changed — no prompt to answer').toBe(0);
    expect(STATE.cards).toHaveLength(0);
  });

  it('compares every field it captures — the snapshot and the check share one table', () => {
    // The structural half: if a future field is added to the capture but not to
    // EDIT_FIELDS, or vice versa, the two can disagree again. They cannot,
    // because there is only one list and both read it — pinned here so a
    // refactor that reintroduces a longhand copy fails loudly.
    const table = SOURCE.match(/const EDIT_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\);/);
    expect(table, 'EDIT_FIELDS must exist').not.toBeNull();
    for (const field of
      ['title', 'tease', 'label', 'media', 'folder', 'cardFocus', 'palette', 'link', 'source', 'card']) {
      expect(table[1], `EDIT_FIELDS must cover ${field}`).toContain(`'${field}'`);
    }
    expect(
      SOURCE,
      'the untouched check must derive from the snapshot, not re-list fields longhand',
    ).toContain('_editIsUntouched(card, _editSnapshot)');
  });

  it('cardsCancelEdit on a brand-new card discards it', async () => {
    await cards.renderCards();
    cardsCompose();
    expect(STATE.cards).toHaveLength(1);
    expect(STATE.staged.cards).toBe(1);

    cardsCancelEdit();
    expect(STATE.cards).toHaveLength(0);
    expect(STATE.staged.cards).toBe(0);
    expect(_composingId()).toBeNull();
  });

  it('cardsHandleStageClick exits edit mode when clicking the backdrop', async () => {
    await cards.renderCards();
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Click Out Test');
    expect(_composingId()).toBe(card.id);

    const stage = document.querySelector('.studio-stage');
    expect(stage).not.toBeNull();

    // Clicking a child (like the card) does NOT exit edit mode
    cardsHandleStageClick({ target: document.getElementById('composer-title'), currentTarget: stage });
    expect(_composingId()).toBe(card.id);

    // Clicking the stage backdrop directly exits edit mode
    cardsHandleStageClick({ target: stage, currentTarget: stage });
    expect(_composingId()).toBeNull();
  });

  it('cardsSetPalette updates card palette, DOM data-state, and active swatch without rebuilding textareas', async () => {
    await cards.renderCards();
    const card = cardsCompose();
    const titleEl = document.getElementById('composer-title');
    expect(titleEl).not.toBeNull();

    cardsSetPalette(card.id, 'ember');
    expect(STATE.cards[0].palette).toBe('ember');
    expect(STATE.staged.cards).toBe(1);

    const composerCard = document.getElementById('composer-card');
    expect(composerCard.getAttribute('data-state')).toBe('ember');

    // Textarea DOM node was updated in-place without repainting
    expect(document.getElementById('composer-title')).toBe(titleEl);

    // Active swatch updated
    const activeSwatch = document.querySelector('.cards-swatch.is-active');
    expect(activeSwatch.getAttribute('data-palette')).toBe('ember');
    expect(document.getElementById('cards-palette-name').textContent).toBe('Ember');
  });

  it('cardsCancelEdit restores initial palette if modified', async () => {
    await cards.renderCards();
    const photo = {
      id: 'p-pal', slug: 'dawn-pic', filename: 'D.webp', title: 'DAWN PIC',
      location: 'Yosemite, 2026', added_at: '2026-08-01', cardFocus: '50% 50%',
    };
    STATE.archive = [photo];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'archive');

    cards.cardsSelectSlot(at);
    cards.cardsEditSlot(at);
    const cardId = _composingId();
    expect(STATE.cards[0].palette || 'default').toBe('default');

    cardsSetPalette(cardId, 'flow');
    expect(STATE.cards[0].palette).toBe('flow');

    cardsCancelEdit();
    expect(_composingId()).toBeNull();
    // Reverted back since it was an untouched takeover
    expect(STATE.cards).toHaveLength(0);
  });

  it('cardsEditSlot auto-switches to studio view if currently in panorama mode', async () => {
    const photo = {
      id: 'p-mode', slug: 'mode-pic', filename: 'M.webp', title: 'MODE PIC',
      location: 'Yosemite, 2026', added_at: '2026-08-01', cardFocus: '50% 50%',
    };
    STATE.archive = [photo];
    await cards.renderCards();
    cardsSetMode('panorama');
    expect(_activeMode()).toBe('panorama');

    cards.cardsEditSlot(0);
    expect(_activeMode()).toBe('studio');
    expect(_composingId()).not.toBeNull();
  });

  it('cardsSetLayout stages the layout change and updates the ledger row', async () => {
    STATE.posts = [{
      id: 'fn-layout-test', fn_id: 'fn-layout-test', title: 'A Note',
      body: 'Testing layout folding.', hero_filename: 'hero.webp', added_at: '2026-08-01',
    }];
    cardsSetLayout('text', 'fn-layout-test', 'hero');
    const rows1 = (STATE.stagedLog || []).filter((r) => r.surface === 'posts' && r.ids[0] === 'fn-layout-test');
    expect(rows1).toHaveLength(1);
    expect(rows1[0].label).toContain('hero');

    cardsSetLayout('text', 'fn-layout-test', 'default');
    const rows2 = (STATE.stagedLog || []).filter((r) => r.surface === 'posts' && r.ids[0] === 'fn-layout-test');
    expect(rows2).toHaveLength(1);
    expect(rows2[0].label).toContain('default');
  });

  it('_slotOf carries palette attribute on composed cards', () => {
    // The engine hands a composed card over as a real kind carrying `over`.
    const slot = cards._slotOf({ kind: 'text', data: {}, over: { id: 'c-pal', palette: 'flow', title: 'Flow Card' } });
    expect(slot.kind).toBe('composed');
    expect(slot).not.toBeNull();
    expect(slot.palette).toBe('flow');
  });

  it('cardsCancelEdit on brand new card discards cleanly without leaving orphaned rows', () => {
    const c = cardsCompose();
    expect(STATE.cards).toHaveLength(1);
    expect(STATE.staged.cards).toBe(1);

    cardsCancelEdit();
    expect(STATE.cards).toHaveLength(0);
    expect(STATE.staged.cards).toBe(0);
    const row = (STATE.stagedLog || []).find((r) => r.surface === 'cards' && r.ids[0] === c.id);
    expect(row).toBeUndefined();
  });

  // Selecting a composed slot (the ribbon pill / SLOT NN button) opens the SAME
  // editable composer as ✎ EDIT THIS CARD — so Cancel has to be able to revert
  // edits made on THAT path too. It shipped unable to: cardsSelectSlot set
  // _composing but never a revert snapshot, so Cancel silently kept the changes.
  // Every prior test masked it by calling cardsEditSlot right after select.
  it('cardsCancelEdit reverts edits when the composer was entered by selecting the slot', async () => {
    await cards.renderCards();
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'ORIGINAL');
    cardsDoneEditing();
    expect(_composingId()).toBeNull();
    await cards.renderCards();

    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === card.id);
    expect(at).toBeGreaterThan(-1);

    // Focus off the card's slot, then back onto it via the pill — no EDIT button.
    cards.cardsSelectSlot(at === 0 ? 1 : 0);
    cards.cardsSelectSlot(at);
    expect(_composingId()).toBe(card.id);

    cardsSetText(card.id, 'title', 'CHANGED');
    expect(STATE.cards[0].title).toBe('CHANGED');

    cardsCancelEdit();
    expect(_composingId()).toBeNull();
    expect(STATE.cards[0].title,
      'Cancel must revert edits made after selecting the slot, not keep them').toBe('ORIGINAL');
  });

  // A composed card that already published carries no staged row. Editing it for
  // the first time this session and cancelling must land back at zero pending —
  // not a phantom "1 pending" that publishes the card back byte-identical.
  it('cardsCancelEdit on a previously-published card leaves no phantom staged change', async () => {
    STATE.cards = [{ id: 'c-pub', order: 1, title: 'Published', added_at: '2026-08-01' }];
    STATE.staged.cards = 0;
    STATE.stagedLog = [];
    await cards.renderCards();

    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-pub');
    expect(at).toBeGreaterThan(-1);

    cards.cardsSelectSlot(at === 0 ? 1 : 0);
    cards.cardsSelectSlot(at);
    cardsSetText('c-pub', 'title', 'Published edited');
    expect(STATE.staged.cards).toBe(1);

    cardsCancelEdit();
    expect(STATE.cards).toHaveLength(1);
    expect(STATE.cards[0].title).toBe('Published');
    expect(STATE.staged.cards,
      'reverting the first edit of a published card must not leave a phantom pending change').toBe(0);
    const row = (STATE.stagedLog || []).find((r) => r.surface === 'cards' && r.ids[0] === 'c-pub');
    expect(row).toBeUndefined();
  });

  // A composed card records the R2 FOLDER its picture lives in (wallpapers sit
  // outside archive/). Cancel restored the filename but not the folder, so a
  // reverted wallpaper card rebuilt an archive/ URL — a 404 on the live grid.
  it('cardsCancelEdit restores a wallpaper card\'s source folder, not just its filename', async () => {
    STATE.wallpapers = [{ id: 'w1', filename: 'wall.webp' }];
    STATE.cards = [{ id: 'c-wall', order: 1, title: 'Wall', media: 'wall.webp', folder: 'wallpaper', added_at: '2026-08-01' }];
    STATE.staged.cards = 0;
    STATE.stagedLog = [];
    await cards.renderCards();

    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-wall');
    cards.cardsSelectSlot(at === 0 ? 1 : 0);
    cards.cardsSelectSlot(at);

    cards.cardsClearImage('c-wall');           // Remove Picture, mid-edit
    expect(STATE.cards[0].media).toBeUndefined();

    cardsCancelEdit();
    expect(STATE.cards[0].media).toBe('wall.webp');
    expect(STATE.cards[0].folder,
      'the source folder must come back with the filename or the live card 404s').toBe('wallpaper');
    expect(STATE.staged.cards).toBe(0);
  });

  // Layout picks (cardsSetLayout) stage a SECOND counted gesture that folds into
  // the same row. Cancel has to revert card.card AND give back every folded
  // gesture, not just one — else a Hero pick rides silently into publish and the
  // counter keeps a phantom.
  it('cardsCancelEdit reverts every folded gesture, not just the last', async () => {
    // (This drove the second gesture through cardsSetLayout until chunk 1 of
    // docs/cards-core-complete.md made that mutator inert for composed cards;
    // chunk 2 brings a layout gesture back here. Two text gestures fold into
    // the same row and prove the same thing.)
    STATE.cards = [{ id: 'c-lay', order: 1, title: 'Lay', tease: 'Tease', media: 'pic.webp', folder: 'archive', added_at: '2026-08-01' }];
    STATE.staged.cards = 0;
    STATE.stagedLog = [];
    await cards.renderCards();

    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-lay');
    cards.cardsSelectSlot(at === 0 ? 1 : 0);
    cards.cardsSelectSlot(at);

    cardsSetText('c-lay', 'title', 'Lay edited');   // gesture 1
    cardsSetText('c-lay', 'tease', 'Tease edited'); // gesture 2, folds into the row
    expect(STATE.cards[0].tease).toBe('Tease edited');
    // Repeat edits to the same card fold into ONE staged row (the staging law).
    expect(STATE.staged.cards).toBe(1);

    cardsCancelEdit();
    expect(STATE.cards[0].tease, 'the second gesture must not survive cancel').toBe('Tease');
    expect(STATE.cards[0].title).toBe('Lay');
    expect(STATE.staged.cards,
      'both folded gestures must be given back, not just one').toBe(0);
  });

  // The count change on cancel has to route through bumpStage so the on-screen
  // "PENDING" badge actually refreshes — splicing the row by hand dropped the
  // number internally but left the badge lit until the next unrelated render.
  it('cardsCancelEdit refreshes the pending indicator on the way out', async () => {
    let refreshes = 0;
    const prev = globalThis.refreshStageIndicators;
    globalThis.refreshStageIndicators = () => { refreshes += 1; };
    try {
      STATE.cards = [{ id: 'c-ref', order: 1, title: 'Ref', added_at: '2026-08-01' }];
      STATE.staged.cards = 0;
      STATE.stagedLog = [];
      await cards.renderCards();

      const at = (cards._cardSlots(cards._stagedInputs()) || [])
        .findIndex((s) => s && s.composed && s.id === 'c-ref');
      cards.cardsSelectSlot(at === 0 ? 1 : 0);
      cards.cardsSelectSlot(at);
      cardsSetText('c-ref', 'title', 'Ref edited');

      const before = refreshes;
      cardsCancelEdit();
      expect(refreshes,
        'cancel must refresh the pending badge, not just mutate the count').toBeGreaterThan(before);
    } finally {
      globalThis.refreshStageIndicators = prev;
    }
  });

  // Clicking the ribbon pill of the slot you are ALREADY parked on must open its
  // composer — the index did not move, but the intent ("edit this card") did.
  it('cardsSelectSlot opens the composer when the clicked composed slot is already focused', async () => {
    STATE.cards = [{ id: 'c-focus', order: 1, title: 'Focus', added_at: '2026-08-01' }];
    await cards.renderCards();

    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-focus');
    cards.cardsSelectSlot(at);
    cardsDoneEditing();
    expect(_composingId()).toBeNull();

    // Same slot, index unchanged — must still re-enter edit rather than dead-click.
    cards.cardsSelectSlot(at);
    expect(_composingId(),
      'a click on the already-focused composed slot should open its editor').toBe('c-focus');
  });
});


// -------------------------------------------------- the ghost-card lockout

// ⚠️ THE ONE THAT COULD LOCK AN AUTHOR OUT FOR GOOD.
//
// A composed card with neither a picture nor a word is invisible everywhere:
// composedPick declines it, so it reaches no slot, no ribbon pill and no grid
// cell — and every control that could remove it (↩ RESET TO AUTOMATIC, ✕ CANCEL)
// lives on a slot. Left in STATE it still counted against COMPOSED_MAX, so two
// of them disabled ＋ COMPOSE A CARD permanently, with four automatic slots on
// screen and nothing to reset. So every path that stops composing one discards
// it, the way Cancel already did for a brand-new card.
describe('an unfinished card is abandoned, never filed', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  it('✓ DONE on an empty card drops it, and gives back the gesture it staged', () => {
    cardsCompose();
    expect(STATE.staged.cards).toBe(1);
    cardsDoneEditing();
    expect(STATE.cards, 'an empty card must not survive Done').toHaveLength(0);
    expect(STATE.staged.cards, 'and its staged +1 goes with it').toBe(0);
    expect(_composingId()).toBeNull();
  });

  it('a card with only a PICTURE is finished, and survives Done', () => {
    const card = cardsCompose();
    card.media = 'X.webp';
    cardsDoneEditing();
    expect(STATE.cards).toHaveLength(1);
  });

  it('pressing COMPOSE twice never burns two places on nothing', () => {
    cardsCompose();
    cardsCompose();
    expect(STATE.cards, 'the first, still empty, is abandoned').toHaveLength(1);
    // The lockout shape: two of these used to fill the budget with cards nobody
    // could see, and ＋ COMPOSE A CARD was disabled from then on.
    expect(cardsCompose()).not.toBeNull();
  });

  it('clicking another slot abandons the card being composed', async () => {
    STATE.archive = [{ id: 'p-g', slug: 'g', filename: 'G.webp', title: 'G', added_at: '2026-08-01' }];
    await cards.renderCards();
    cardsCompose();
    expect(STATE.cards).toHaveLength(1);
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'archive');
    cards.cardsSelectSlot(at);
    expect(STATE.cards).toHaveLength(0);
    expect(_composingId()).toBeNull();
  });

  it('taking a slot over abandons the card being composed', async () => {
    STATE.archive = [{ id: 'p-h', slug: 'h', filename: 'H.webp', title: 'H', added_at: '2026-08-01' }];
    await cards.renderCards();
    cardsCompose();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.kind === 'archive');
    cards.cardsEditSlot(at);
    expect(STATE.cards, 'the empty one goes, the taken-over one stays').toHaveLength(1);
    expect(STATE.cards[0].media).toBe('H.webp');
  });

  it('sweeps ghosts that arrived from STORAGE, where nothing was composing', async () => {
    // `_composing` does not survive a reload, so a card left empty when the tab
    // closed comes back with nothing able to select it.
    STATE.cards = [
      { id: 'c-ghost', order: 1, title: '', tease: '', added_at: '2026-08-01' },
      { id: 'c-real', order: 2, title: 'Real', added_at: '2026-08-01' },
    ];
    await cards.renderCards();
    expect(STATE.cards.map((c) => c.id)).toEqual(['c-real']);
    expect(STATE.cards[0].order, 'and the survivor compacts to rank 1').toBe(1);
  });
});

// -------------------------------------------------- the slot the card is IN

describe('the studio follows the card, not the button', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  // Composed cards carry a RANK, not a slot index: the engine files them in at
  // the front (behind a live pulse). So taking over slot 03 publishes at slot 01
  // — and the banner used to name the slot that was PRESSED, while ✓ DONE
  // dropped focus onto whatever automatic item still sat at that old index,
  // which reads exactly like losing the edit.
  it('names the slot the composed card actually landed in', async () => {
    STATE.archive = [
      { id: 'p-1', slug: 'one', filename: 'One.webp', title: 'One', added_at: '2026-08-03' },
      { id: 'p-2', slug: 'two', filename: 'Two.webp', title: 'Two', added_at: '2026-08-02' },
      { id: 'p-3', slug: 'three', filename: 'Three.webp', title: 'Three', added_at: '2026-08-01' },
    ];
    await cards.renderCards();
    const slots = cards._cardSlots(cards._stagedInputs());
    const at = slots.findIndex((s) => s && s.kind === 'archive' && s.id === 'p-3');
    expect(at, 'the third archive photo should be further down the row').toBeGreaterThan(0);

    cards.cardsEditSlot(at);
    const html = document.getElementById('cards-body').innerHTML;
    const made = STATE.cards[0];
    const now = cards._cardSlots(cards._stagedInputs())
      .findIndex((s) => s && s.composed && s.id === made.id);
    expect(now, 'a composed card files in at the front').toBe(0);
    expect(html).toContain(`EDITING SLOT ${String(now + 1).padStart(2, '0')}`);
  });

  it('says so plainly while the card is on no slot at all', async () => {
    await cards.renderCards();
    cardsCompose();
    const html = document.getElementById('cards-body').innerHTML;
    expect(html, 'an empty card is on no slot — naming one would be a lie')
      .toContain('NEW CARD · NO SLOT YET');
  });
});

// -------------------------------------------------- what Cancel must put back

describe('cancel restores the way home', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  // ✕ MAKE FREE-FORM deletes card.link AND card.source. The snapshot did not
  // carry either, so Cancel reverted the words and left the card pointing
  // nowhere — with no gesture left anywhere that could rebuild the link.
  it('cardsCancelEdit puts back a link that MAKE FREE-FORM cut', async () => {
    STATE.cards = [{
      id: 'c-link', order: 1, title: 'Linked', added_at: '2026-08-01',
      link: '/archive/?f=granite', source: { surface: 'archive', id: 'p-1' },
    }];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-link');
    cards.cardsSelectSlot(at);

    cards.cardsClearLink('c-link');
    expect(STATE.cards[0].link).toBeUndefined();

    cardsCancelEdit();
    expect(STATE.cards[0].link, 'the link is navigation the card cannot rebuild')
      .toBe('/archive/?f=granite');
    expect(STATE.cards[0].source).toEqual({ surface: 'archive', id: 'p-1' });
  });

  it('and does not invent one where the card never had it', async () => {
    STATE.cards = [{ id: 'c-free', order: 1, title: 'Free', added_at: '2026-08-01' }];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-free');
    cards.cardsSelectSlot(at);
    cardsSetText('c-free', 'title', 'Free edited');
    cardsCancelEdit();
    expect(STATE.cards[0].link).toBeUndefined();
    expect(STATE.cards[0].source).toBeUndefined();
  });
});

// -------------------------------------------------- WYSIWYG: 'Always the words'

describe('the composer wears the layout the card will publish in', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  // composedCard() gates the picture on `media && layout !== 'plain'`. The
  // composer asked only "is there a picture", so choosing "Always the words"
  // changed the published card and left the photo sitting in the editor.
  it('shows the WORDS shape when the layout says plain, picture or not', async () => {
    STATE.cards = [{
      id: 'c-plain', order: 1, title: 'Plain', media: 'X.webp',
      card: { layout: 'plain' }, added_at: '2026-08-01',
    }];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-plain');
    cards.cardsSelectSlot(at);
    expect(document.getElementById('composer-card').getAttribute('data-shape')).toBe('words');
  });

  it('and the picture shape the moment the layout goes back to automatic', async () => {
    STATE.cards = [{
      id: 'c-auto', order: 1, title: 'Auto', media: 'X.webp', added_at: '2026-08-01',
    }];
    await cards.renderCards();
    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-auto');
    cards.cardsSelectSlot(at);
    expect(document.getElementById('composer-card').getAttribute('data-shape')).toBe('picture');
  });
});

// -------------------------------------------------- the dressing, onto kind + layout

describe('the dressing writes kind + layout, and Automatic is the undo', () => {
  const fresh = (over) => {
    const c = cardsCompose();
    cardsSetText(c.id, 'title', 'Dressed');
    Object.assign(c, over || {});
    return c;
  };

  it('Always the words → text, no layout', () => {
    const c = fresh({ media: 'X.webp' });
    cardsSetDressing(c.id, 'words');
    expect(c.kind).toBe('text');
    expect(c.card).toBeUndefined();
    expect(_dressingOf(c)).toBe('words');
    expect(RI.composedShape(c), 'the engine draws the words tile, picture or not').toBe('words');
  });

  it('Always the picture → photo — and text + hero when the card came from a note', () => {
    const c = fresh({ media: 'X.webp' });
    cardsSetDressing(c.id, 'picture');
    expect(c.kind).toBe('photo');
    expect(c.card).toBeUndefined();
    expect(_dressingOf(c)).toBe('picture');

    const n = fresh({ media: 'H.webp', source: { surface: 'posts', id: 'p-1' }, link: '/field-notes/?n=1' });
    cardsSetDressing(n.id, 'picture');
    expect(n.kind).toBe('text');
    expect(n.card).toEqual({ layout: 'hero' });
    expect(_dressingOf(n)).toBe('picture');
    expect(RI.buildCard(RI.composedItem(n)).getAttribute('data-layout'), 'it is the note\'s own hero card').toBe('hero');
  });

  it('Automatic → neither field, and the engine reads the shape again', () => {
    const c = fresh({ media: 'X.webp' });
    cardsSetDressing(c.id, 'words');
    cardsSetDressing(c.id, 'auto');
    expect(c.kind).toBeUndefined();
    expect(c.card).toBeUndefined();
    expect(_dressingOf(c)).toBe('auto');
    expect(RI.composedShape(c)).toBe('picture');
  });

  it('reads every shape back — written, legacy, or automatic', () => {
    expect(_dressingOf({ id: 'a' })).toBe('auto');
    expect(_dressingOf({ id: 'b', kind: 'text' })).toBe('words');
    expect(_dressingOf({ id: 'c', kind: 'photo', media: 'X.webp' })).toBe('picture');
    expect(_dressingOf({ id: 'd', kind: 'text', media: 'X.webp', card: { layout: 'hero' } })).toBe('picture');
    expect(_dressingOf({ id: 'e', media: 'X.webp', card: { layout: 'plain' } }), 'legacy plain').toBe('words');
    expect(_dressingOf({ id: 'f', media: 'X.webp', card: { layout: 'hero' } }), 'legacy hero').toBe('picture');
    expect(_dressingOf({ id: 'g', kind: 'audio' })).toBe('audio');
  });

  it('refuses the picture without one, and stages nothing', () => {
    const c = fresh();
    const before = STATE.staged.cards;
    cardsSetDressing(c.id, 'picture');
    expect(c.kind).toBeUndefined();
    expect(STATE.staged.cards).toBe(before);
  });

  it('folds into the card\'s one ledger row and never goes negative', () => {
    const c = fresh({ media: 'X.webp' });
    expect(STATE.staged.cards).toBe(1);
    cardsSetDressing(c.id, 'words');
    cardsSetDressing(c.id, 'picture');
    cardsSetDressing(c.id, 'auto');
    expect(STATE.stagedLog.filter((r) => r.surface === 'cards')).toHaveLength(1);
    expect(STATE.staged.cards).toBe(1);
  });

  it('pressing the dressing already worn changes nothing', () => {
    const c = fresh({ media: 'X.webp', kind: 'photo' });
    const snap = JSON.stringify(c);
    cardsSetDressing(c.id, 'picture');
    expect(JSON.stringify(c)).toBe(snap);
  });

  it('Cancel puts the pair back whole', async () => {
    STATE.cards = [{ id: 'c-dress', order: 1, title: 'Dressed', media: 'X.webp', added_at: '2026-09-01' }];
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    await cards.renderCards();
    const at = cards._cardSlots(cards._stagedInputs()).findIndex((s) => s && s.composed && s.id === 'c-dress');
    cards.cardsSelectSlot(at);
    cardsSetDressing('c-dress', 'words');
    expect(STATE.cards[0].kind).toBe('text');
    cardsCancelEdit();
    expect(STATE.cards[0].kind).toBeUndefined();
    expect(STATE.cards[0].card).toBeUndefined();
  });
});

describe('a record the shipped console wrote is rewritten as the new shape, and renders the same', () => {
  const base = (over) => ({ id: 'c-legacy', order: 1, added_at: '2026-08-01', title: 'Mine', tease: 'A line.', ...over });
  it.each([
    ['plain with a picture', { media: 'X.webp', card: { layout: 'plain' } }, { kind: 'text' }],
    ['plain without one', { card: { layout: 'plain' } }, { kind: 'text' }],
    ['hero with a picture', { media: 'X.webp', card: { layout: 'hero' } }, { kind: 'photo' }],
    ['hero without one (gated)', { card: { layout: 'hero' } }, { kind: 'photo' }],
    ['an explicit default', { media: 'X.webp', card: { layout: 'default' } }, {}],
  ])('%s', (_name, legacy, expected) => {
    const before = RI.buildCard(RI.composedItem(base(legacy))).outerHTML;
    const card = base(legacy);
    expect(_normalizeCard(card)).toBe(true);
    expect(card.card, 'the legacy layout is gone').toBeUndefined();
    expect(card.kind).toBe(expected.kind);
    expect(RI.buildCard(RI.composedItem(card)).outerHTML, 'byte-identical either way').toBe(before);
  });

  it('leaves an automatic record and a written one alone', () => {
    expect(_normalizeCard(base({ media: 'X.webp' }))).toBe(false);
    expect(_normalizeCard(base({ kind: 'text', media: 'X.webp', card: { layout: 'hero' } }))).toBe(false);
    expect(_normalizeCard(base({ card: { focus: 'x' } }))).toBe(false);
  });

  it('runs on the way into the view and stages nothing', async () => {
    STATE.cards = [base({ media: 'X.webp', card: { layout: 'plain' } })];
    globalThis.fetch = async () => new Response('[]', { status: 200 });
    await cards.renderCards();
    expect(STATE.cards[0].kind).toBe('text');
    expect(STATE.cards[0].card).toBeUndefined();
    expect(STATE.staged.cards, 'a representation change is not a change to publish').toBe(0);
  });
});

// -------------------------------------------------- LIVE's one action

// Chunk 8 widened this from "one action" to two KINDS of action, and the
// distinction is the point: LIVE still offers nothing that stages a change —
// ✎ EDIT THE STAGED CARD hands you to the staged grid to make one — but it does
// offer SHARE, because a stamp and a copied link act on the card that is on the
// site right now. Sharing is not a staged change and does not wait for publish.
describe('LIVE offers the staged card, and sharing — and nothing that stages', () => {
  const live = { archive: [], posts: [], summary: { featured: [] }, cards: [] };
  let pulse = null;
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? live.summary
        : path === '/api/pulse' ? { pulse }
          : path === '/data/posts.json' ? live.posts
            : path === '/data/cards.json' ? live.cards : []),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    STATE.posts = [
      { id: 'n-1', fn_id: 'fn-1', title: 'One', body: 'First note.', hero_filename: 'H.webp', added_at: '2026-08-02' },
      { id: 'n-2', fn_id: 'fn-2', title: 'Two', body: 'Second note.', added_at: '2026-08-01' },
    ];
    live.posts = STATE.posts.map((p) => ({ ...p }));
    pulse = null;
  });

  it('is the only control on the live rail, and lands on the same card in STAGED', async () => {
    await cards.renderCards();
    cards.cardsSetSource('live');
    const liveSlots = cards._cardSlots({ archive: [], posts: live.posts, rawFeatured: [], audio: [], pulse: null, composed: [] });
    const at = liveSlots.findIndex((s) => s && s.key === 'text:fn-2');
    cards.cardsSelectSlot(at);
    const rail = document.querySelector('.studio-rail');
    expect([...rail.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual([
      '✎ EDIT THE STAGED CARD',
      '⧉ COPY LINK', '▲ STAMP SHARE IMAGES', '⤓ NATIVE', '⤓ STORY',
    ]);
    // Not a layout picker, not a takeover, not one mutator: everything on the
    // live rail either navigates or acts on R2 now.
    expect(rail.querySelector('.layout-chips'), 'LIVE stages nothing').toBeNull();
    cardsEditStaged('text:fn-2');
    expect(document.querySelector('.cards-seg-btn--live').getAttribute('aria-pressed')).toBe('false');
    const focused = [...document.querySelectorAll('.cards-pill')].findIndex((p) => p.classList.contains('is-active'));
    expect(cards._cardSlots(cards._stagedInputs())[focused].key).toBe('text:fn-2');
    // And the picker is right there: a note has two layouts.
    expect(document.querySelector('.layout-chips')).not.toBeNull();
  });

  it('finds the card by identity, not by index — a live pulse shifts every index', async () => {
    pulse = { id: 'p-1', text: 'Live now', state: 'signal', expires_at: '2999-01-01T00:00:00Z' };
    await cards.renderCards();
    cards.cardsSetSource('live');
    cardsEditStaged('text:fn-2');
    // The inputs carry the /api/pulse PAYLOAD, as _paint hands it over.
    const staged = cards._cardSlots({ ...cards._stagedInputs(), pulse: { pulse } });
    const focused = [...document.querySelectorAll('.cards-pill')].findIndex((p) => p.classList.contains('is-active'));
    expect(staged[0].kind, 'the pulse leads').toBe('pulse');
    expect(staged[focused].key).toBe('text:fn-2');
  });

  it('opens the composer when the card is a composed one', async () => {
    STATE.cards = [{ id: 'c-live', order: 1, title: 'Published card', added_at: '2026-08-01' }];
    live.cards = STATE.cards.map((c) => ({ ...c }));
    await cards.renderCards();
    cards.cardsSetSource('live');
    cardsEditStaged('composed:c-live');
    expect(_composingId()).toBe('c-live');
    expect(document.getElementById('composer-title')).not.toBeNull();
  });

  it('says so when the live card is not on the next publish', async () => {
    // Toasts land in #toast-zone (js/console-telemetry.js showToast).
    document.body.insertAdjacentHTML('beforeend', '<div id="toast-zone"></div>');
    STATE.posts = STATE.posts.filter((p) => p.fn_id !== 'fn-2');
    await cards.renderCards();
    cards.cardsSetSource('live');
    cardsEditStaged('text:fn-2');
    expect(document.querySelector('.cards-seg-btn--live').getAttribute('aria-pressed'), 'still switches').toBe('false');
    expect(document.getElementById('toast-zone').textContent).toContain('not on the next publish');
  });
});

// -------------------------------------------------- the cap, on captions only

describe('the 48-character cap applies to picture titles only', () => {
  it('a words headline runs to the note\'s own limit — none', () => {
    const c = cardsCompose();
    const long = 'x'.repeat(80);
    cardsSetText(c.id, 'title', long);
    expect(c.title).toBe(long);
    expect(_titleCap(c)).toBe(Infinity);
  });

  it('a picture caption is bounded, at the store and at the keyboard', () => {
    const c = cardsCompose();
    c.media = 'X.webp';
    expect(_titleCap(c)).toBe(48);
    cardsSetText(c.id, 'title', 'x'.repeat(80));
    expect(c.title).toHaveLength(48);

    const el = document.createElement('div');
    el.textContent = 'x'.repeat(48);
    let prevented = 0;
    const ev = { inputType: 'insertText', data: 'y', currentTarget: el, preventDefault: () => { prevented++; } };
    cardsGuardTitle(ev, c.id);
    expect(prevented, 'the 49th character is refused before it lands').toBe(1);
    cardsGuardTitle({ ...ev, inputType: 'deleteContentBackward' }, c.id);
    expect(prevented, 'deleting is always allowed').toBe(1);
    el.textContent = 'x'.repeat(10);
    cardsGuardTitle(ev, c.id);
    expect(prevented, 'room left → nothing refused').toBe(1);
  });

  it('a hero note keeps the caption cap — its title is a caption under the picture', () => {
    const c = cardsCompose();
    c.media = 'H.webp';
    c.source = { surface: 'posts', id: 'p' };
    cardsSetDressing(c.id, 'picture');
    expect(_titleCap(c)).toBe(48);
  });
});

// ---------------------------------------------------------- the audio slot
//
// CHUNK 5 TURNED THIS DESCRIBE INSIDE OUT. It used to assert that the studio
// REFUSED the audio slot and said why in words where the button would be — the
// right answer while a takeover would have seeded a words card and dropped the
// player (the 2026-09-07 hole). The hole is closed, so the assertions are the
// same in spirit with the verdict reversed: the takeover happens, and the thing
// that made refusing necessary — losing the transport — is what is now pinned
// as impossible.

describe('the studio takes the audio slot over, and the card keeps playing', () => {
  const TRACKS = [
    { id: 'a-1', slug: 'one', filename: 'one.mp3', title: 'One', duration: 30, featured: true, featured_order: 1, added_at: '2026-08-01' },
    { id: 'a-2', slug: 'two', filename: 'two.mp3', title: 'Two', duration: 40, featured: true, featured_order: 2, added_at: '2026-08-02' },
    { id: 'a-3', slug: 'three', filename: 'three.mp3', title: 'Three', duration: 50, added_at: '2026-08-03' },
  ];
  const SETS = [{ slug: 'dusk', name: 'Dusk mix', tracks: ['three', 'one'], added_at: '2026-09-05' }];

  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    STATE.audio = TRACKS.map((t) => ({ ...t }));
    STATE.audioSets = SETS.map((s) => ({ ...s, tracks: [...s.tracks] }));
    STATE.cards = [];
  });

  const audioSlot = () => cards._cardSlots(cards._stagedInputs())
    .findIndex((s) => s && s.kind === 'audio');

  it('offers the button, mints an audio card, and copies no tracks onto it', async () => {
    await cards.renderCards();
    const at = audioSlot();
    expect(at).toBeGreaterThan(-1);
    cards.cardsSelectSlot(at);
    expect(document.querySelector('.studio-stage').textContent).toContain('EDIT THIS CARD');

    cards.cardsEditSlot(at);
    expect(STATE.cards).toHaveLength(1);
    const made = STATE.cards[0];
    expect(made.kind).toBe('audio');
    expect(_composingId()).toBe(made.id);
    // THE WHOLE POINT: no track list on the record. The card names a source —
    // the absence of `set` IS "the homepage tracks" — and the registry answers,
    // so there is nothing here to fall out of step with the shelf.
    expect(made.set).toBeUndefined();
    expect(made.tracks).toBeUndefined();
    expect(made.source).toBeUndefined();
    // No seeded link either: an audio card's address follows what it plays, so
    // the rail offers no ✕ MAKE FREE-FORM — a button with nothing to change.
    expect(made.link).toBeUndefined();
    expect(STATE.staged.cards).toBe(1);
  });

  it('the player survives the takeover — the composed card plays what the slot played', async () => {
    await cards.renderCards();
    cards.cardsEditSlot(audioSlot());
    const item = RI.composedItem(STATE.cards[0], STATE.audio, STATE.audioSets);
    expect(item.kind).toBe('audio');
    expect(item.data.tracks.map((t) => t.slug)).toEqual(['one', 'two']);
    // …and the automatic audio card steps aside rather than doubling it.
    const slots = cards._cardSlots(cards._stagedInputs()).filter(Boolean);
    expect(slots.filter((s) => s.kind === 'audio')).toHaveLength(0);
    expect(slots.filter((s) => s.composed)).toHaveLength(1);
  });

  it('borrowing a set is one staged gesture, and pressing the other chip is the undo', async () => {
    await cards.renderCards();
    cards.cardsEditSlot(audioSlot());
    const card = STATE.cards[0];
    const staged = STATE.staged.cards;

    cards.cardsSetAudioSource(card.id, 'set');
    expect(card.set).toBe('dusk');
    expect(cards._audioSourceOf(card)).toBe('set');
    // One gesture, one row — folded onto the card's existing staged row.
    expect(STATE.staged.cards).toBe(staged);
    expect(RI.composedTracks(card, STATE.audio, STATE.audioSets).map((t) => t.slug))
      .toEqual(['three', 'one']);

    // The reverse is the chip beside it, still on screen — reversibility layer
    // 1 — and it leaves the record exactly as it was, key and all.
    cards.cardsSetAudioSource(card.id, 'tracks');
    expect('set' in card).toBe(false);
    expect(RI.composedTracks(card, STATE.audio, STATE.audioSets).map((t) => t.slug))
      .toEqual(['one', 'two']);
  });

  it('refuses to borrow when the shelf has no sets, rather than writing a dead slug', async () => {
    STATE.audioSets = [];
    await cards.renderCards();
    cards.cardsEditSlot(audioSlot());
    const card = STATE.cards[0];
    cards.cardsSetAudioSource(card.id, 'set');
    expect(card.set).toBeUndefined();
    // And a retired set is not on offer either.
    STATE.audioSets = [{ slug: 'old', name: 'Retired', tracks: ['one'], retired: true }];
    cards.cardsSetAudioSource(card.id, 'set');
    expect(card.set).toBeUndefined();
    cards.cardsPickSet(card.id, 'old');
    expect(card.set).toBeUndefined();
  });

  it('the rail says what it plays, and the block is drawn only for an audio card', async () => {
    await cards.renderCards();
    cards.cardsEditSlot(audioSlot());
    const rail = document.querySelector('.studio-rail').textContent;
    expect(rail).toContain('WHAT THIS CARD PLAYS');
    expect(rail).toContain('CHOOSE TRACKS');
    expect(rail).toContain('One · Two');
    // A picture on an audio card is not in this program — the block that would
    // offer one is the block this one replaced.
    expect(rail).not.toContain('CHOOSE A PICTURE');
    expect(rail).not.toContain('MAKE FREE-FORM');

    STATE.cards = [];
    cardsCompose();
    cardsSetText(_composingId(), 'title', 'A words card');
    expect(document.querySelector('.studio-rail').textContent).not.toContain('WHAT THIS CARD PLAYS');
  });

  it('the author\'s words are the caption, and the composer can type them on an empty card', async () => {
    await cards.renderCards();
    cards.cardsEditSlot(audioSlot());
    const card = STATE.cards[0];
    // audioCaption() draws no body at all until there is a word, so the
    // composer has to add the leaves — otherwise the card cannot be typed on.
    const face = document.getElementById('composer-card');
    expect(face.getAttribute('data-shape')).toBe('audio');
    expect(document.getElementById('composer-title')).not.toBeNull();
    expect(document.getElementById('composer-tease')).not.toBeNull();
    // …and in the place the renderer will draw them, so the line is typed where
    // it publishes. Above the index's rule on the playlist card.
    const kids = [...face.children].map((n) => n.className);
    expect(kids.indexOf('wk-body')).toBeLessThan(kids.indexOf('wk-pl-index'));

    cardsSetText(card.id, 'title', 'For the drive home');
    cardsSetText(card.id, 'tease', 'Two takes, one evening.');
    const node = RI.buildCard(RI.composedItem(card, STATE.audio, STATE.audioSets));
    expect(node.querySelector('.wk-body .wk-title').textContent).toBe('For the drive home');
    expect(node.querySelector('.wk-body .wk-meta').textContent).toBe('Two takes, one evening.');
    // The caption is a caption, so it takes the caption's bound.
    expect(_titleCap(card)).toBe(48);
  });

  it('♪ CHOOSE TRACKS goes through the shelf\'s own mutator — there is one featured list', () => {
    // The studio is a second front door, never a second write path: the proof
    // is in the source, because behaviour can agree today and drift tomorrow
    // (chunk 4's lesson about a second resolveSetTracks).
    const fn = SOURCE.slice(SOURCE.indexOf('export function cardsChooseTracks'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('_audioPromote');
    expect(body).not.toMatch(/\.featured\s*=/);
    expect(body).not.toMatch(/featured_order\s*=/);
    // And it opens showing what the card already plays, ticked.
    expect(body).toContain('preselect');
    // AND IT HANDS THE ORDER ON. _audioPromote only ever appends, so the two
    // membership loops settle WHICH tracks play and nothing about the order —
    // re-ticking two already-featured tracks the other way round used to be a
    // no-op with no explanation (a code review of chunk 7). The reorder goes
    // through the shelf's mutator for the same reason the membership does.
    expect(body).toContain('_audioReorderFeatured(order)');
  });
});

// -------------------------------------------------- who owns the Escape key

describe('Escape belongs to whatever is on top', () => {
  beforeEach(() => {
    globalThis.fetch = async (path) => new Response(
      JSON.stringify(path === '/api/buffer-summary' ? { featured: [] }
        : (path === '/api/pulse' ? { pulse: null } : [])),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  const mount = (modalClass) => {
    document.body.innerHTML = '<div class="view active" id="view-cards">'
      + '<div id="cards-body"></div></div><div id="toast-host"></div>'
      + `<div class="${modalClass}" id="focal-modal"></div>`;
  };

  // ▯ SET THE 4:5 CROP and ◎ CHOOSE A PICTURE both open FROM the composer, so an
  // Escape meant to back out of one used to close the composer underneath it as
  // well — two things for one press, and the one the author wanted (cancelling
  // the crop) was the one that did not happen.
  it('does not exit edit mode while a modal is open', async () => {
    mount('modal-overlay');
    await cards.renderCards();
    const card = cardsCompose();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(_composingId(), 'the open modal owns that press').toBe(card.id);
  });

  it('and still exits edit mode when nothing is on top', async () => {
    mount('modal-overlay hidden');
    await cards.renderCards();
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Keep me');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(_composingId()).toBeNull();
    expect(STATE.cards, 'a finished card survives the exit').toHaveLength(1);
  });
});
