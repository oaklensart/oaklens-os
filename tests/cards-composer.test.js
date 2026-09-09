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

await import('../js/recent-index.js');
const { STATE, sessionTrash } = await import('../js/console-state.js');
const cards = await import('../js/console/cards.js');
const {
  cardsCompose, cardsSetText, cardsClearImage, cardsReorder, cardsResetToAuto,
  cardsDoneEditing, cardsCancelEdit, cardsHandleStageClick, cardsSetPalette,
  cardsSetMode, cardsSetLayout, _composedCards, _composingId, _activeMode,
} = cards;

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
  });
});

describe('the picture', () => {
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
    // Real fields on the card, not a form beside a picture of one.
    expect(title.tagName).toBe('TEXTAREA');
    expect(tease.tagName).toBe('TEXTAREA');
    expect(title.value).toBe('The Geometry of Silence');
    expect(title.closest('.wk-card'), 'the field must be INSIDE the card').not.toBeNull();
  });

  it('wears the real card classes, so it is the card the homepage draws', async () => {
    const card = cardsCompose();
    // An empty card is deliberately invisible to the grid (composedPick), so
    // give it something before asking where it landed.
    cardsSetText(card.id, 'title', 'Something');
    const html = await openComposerOn(card);
    for (const cls of ['wk-card', 'wk-img', 'wk-tag', 'wk-t-title', 'wk-snip']) {
      expect(html, `the composer card should carry .${cls}`).toContain(cls);
    }
  });

  it('keeps both shapes in the DOM and switches with an attribute', async () => {
    // Rendering one or the other would mean rebuilding the card when a picture
    // is added or removed — and the fields live inside the card, so a rebuild is
    // what destroys a caret.
    const card = cardsCompose();
    cardsSetText(card.id, 'title', 'Words only, for now');
    await openComposerOn(card);
    expect(document.getElementById('composer-card').getAttribute('data-shape')).toBe('words');
    expect(document.getElementById('composer-media'), 'the media band stays in the DOM').not.toBeNull();

    card.media = 'X.webp';
    await openComposerOn(card);
    expect(document.getElementById('composer-card').getAttribute('data-shape')).toBe('picture');
  });

  it('offers every control a card needs, and names them plainly', async () => {
    const card = cardsCompose();
    card.media = 'X.webp';
    const html = await openComposerOn(card);
    for (const call of ['cardsPickImage', 'cardsCropCard', 'cardsClearImage',
      'cardsSetText', 'cardsResetToAuto', 'cardsSetLayout']) {
      expect(html, `${call} should be reachable from the composer`).toContain(call);
    }
    expect(html).toContain('RESET TO AUTOMATIC');
  });

  it('names the composed layouts for what they do, not for the engine', async () => {
    // A composed card's `default` leads with the picture when it has one, so
    // calling it "Standard tile" would misdescribe what publish produces.
    const card = cardsCompose();
    card.media = 'X.webp';
    await openComposerOn(card);
    const labels = [...document.querySelectorAll('.layout-chip-label')].map((n) => n.textContent.trim());
    expect(labels).toEqual(['Automatic', 'Always the picture', 'Always the words']);
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
    const slot = cards._slotOf({ kind: 'composed', data: { id: 'c-pal', palette: 'flow', title: 'Flow Card' } });
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
  it('cardsCancelEdit reverts a layout pick and every folded gesture with it', async () => {
    STATE.cards = [{ id: 'c-lay', order: 1, title: 'Lay', media: 'pic.webp', folder: 'archive', added_at: '2026-08-01' }];
    STATE.staged.cards = 0;
    STATE.stagedLog = [];
    await cards.renderCards();

    const at = (cards._cardSlots(cards._stagedInputs()) || [])
      .findIndex((s) => s && s.composed && s.id === 'c-lay');
    cards.cardsSelectSlot(at === 0 ? 1 : 0);
    cards.cardsSelectSlot(at);

    cardsSetText('c-lay', 'title', 'Lay edited');   // gesture 1
    cardsSetLayout('composed', 'c-lay', 'hero');     // gesture 2, folds into the row
    expect(STATE.cards[0].card).toEqual({ layout: 'hero' });
    expect(STATE.staged.cards).toBe(2);

    cardsCancelEdit();
    expect(STATE.cards[0].card, 'a layout pick must not survive cancel').toBeUndefined();
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
