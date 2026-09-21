// @vitest-environment happy-dom
//
// The FN composer's hero-card opt-in — the console half of the card engine's
// first real layout (docs/cards-console-vision.md §3, Chunk 2).
//
// What is worth pinning here is the ROUND TRIP, because it runs through the
// hero slot's dataset rather than a variable: fnStage() reads the slot,
// fnLoadPost() writes it back, and fnHeroClear() drops it. A break anywhere in
// that loop looks like a working button whose choice quietly evaporates on the
// next reload — the same class of failure the inline-handler guard exists for.
//
// The default stays text-only: a note that never touches the control must come
// out of the composer with no descriptor at all, so untouched posts serialize
// byte-identically (tests/build-bundle.test.js pins the other end).
import { describe, it, expect, beforeEach } from 'vitest';

// console-state.js reaches these through the global scope at call time — stub
// before importing, exactly as tests/audio-shelf.test.js does.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const {
  fnNewPost, fnLoadPost, fnStage, fnHeroSet, fnHeroClear, fnToggleHeroCard,
} = await import('../js/console/fn-editor.js');

// The studio's DOM, trimmed to what these tests touch. Kept in step with
// dev/field-console.html by tests/console-boot.test.js, which asserts every id
// the editor writes into is actually in the shipped shell.
const DOM = `
  <div class="fn-studio">
    <input id="fn-id"><input id="fn-title"><input id="fn-location"><input id="fn-date">
    <textarea id="fn-body"></textarea>
    <span id="fn-status-badge"></span>
    <button id="fn-delete-btn"></button>
    <div class="fn-hero" id="fn-hero-slot">
      <div id="fn-hero-empty"></div>
      <img id="fn-hero-thumb"><div id="fn-hero-name"></div>
      <button id="fn-hero-focal"></button>
      <button id="fn-hero-card" aria-pressed="false">▢ HERO CARD</button>
      <button id="fn-hero-clear"></button>
    </div>
    <div id="fn-preview"></div>
    <span id="fn-sync"></span><span id="fn-word-count"></span><span id="fn-read-time"></span>
    <select id="fn-doc-select"></select>
  </div>
  <div id="toast-host"></div>
`;

const slot = () => document.getElementById('fn-hero-slot');
const btn = () => document.getElementById('fn-hero-card');
const staged = () => STATE.posts[0];

beforeEach(() => {
  document.body.innerHTML = DOM;
  STATE.posts = [];
  STATE.buffer = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, friends: 0, library: 0, audio: 0 };
  fnNewPost();
  document.getElementById('fn-title').value = 'The Long Way Round';
  document.getElementById('fn-date').value = '2026-08-23';
});

describe('the control only exists when there is a picture to lead with', () => {
  it('is hidden until a hero lands, and comes back hidden when it is cleared', () => {
    expect(btn().style.display).toBe('none');
    fnHeroSet('', 'pic.webp');
    expect(btn().style.display).toBe('inline-flex');
    fnHeroClear();
    expect(btn().style.display).toBe('none');
  });

  it('refuses to switch on with no hero — the layout would fall back anyway', () => {
    fnToggleHeroCard();
    expect(slot().dataset.cardLayout).toBeUndefined();
  });

  it('clearing the hero drops the opt-in with it', () => {
    fnHeroSet('', 'pic.webp');
    fnToggleHeroCard();
    expect(slot().dataset.cardLayout).toBe('hero');
    fnHeroClear();
    expect(slot().dataset.cardLayout).toBeUndefined();
  });
});

describe('the toggle reads as on or off', () => {
  it('flips the console\'s standard active state and the glyph both ways', () => {
    fnHeroSet('', 'pic.webp');
    expect(btn().classList.contains('active')).toBe(false);
    expect(btn().getAttribute('aria-pressed')).toBe('false');

    fnToggleHeroCard();
    expect(btn().classList.contains('active')).toBe(true);
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(btn().textContent).toBe('▣ HERO CARD');

    fnToggleHeroCard();
    expect(btn().classList.contains('active')).toBe(false);
    expect(btn().textContent).toBe('▢ HERO CARD');
  });
});

describe('the descriptor round-trips through stage and reload', () => {
  it('stages card: { layout: "hero" } when the opt-in is on', () => {
    fnHeroSet('', 'pic.webp');
    fnToggleHeroCard();
    fnStage('published');
    expect(staged().card).toEqual({ layout: 'hero' });
  });

  it('stages no descriptor when it is off — the default is text-only', () => {
    fnHeroSet('', 'pic.webp');
    fnStage('published');
    expect(staged().card).toBeNull();
  });

  it('reopening the post restores the choice and the button state', () => {
    fnHeroSet('', 'pic.webp');
    fnToggleHeroCard();
    fnStage('published');
    const id = staged().id;

    fnNewPost();
    expect(slot().dataset.cardLayout).toBeUndefined();

    fnLoadPost(id);
    expect(slot().dataset.cardLayout).toBe('hero');
    expect(btn().classList.contains('active')).toBe(true);
  });

  it('turning it back off and re-staging clears the descriptor', () => {
    fnHeroSet('', 'pic.webp');
    fnToggleHeroCard();
    fnStage('published');
    const id = staged().id;

    fnLoadPost(id);
    fnToggleHeroCard();
    fnStage();
    expect(STATE.posts.find((p) => p.id === id).card).toBeNull();
  });

  it('a post with no card descriptor reopens with the opt-in off', () => {
    STATE.posts = [{
      id: 'p-old', fn_id: 'fn-001', title: 'Before The Engine', location: 'Sample City',
      date: '2026-01-01', hero: 'old.webp', body: 'x', added_at: '2026-01-01',
    }];
    fnLoadPost('p-old');
    expect(slot().dataset.cardLayout).toBeUndefined();
    expect(btn().classList.contains('active')).toBe(false);
  });
});

describe('the staging law — one gesture, one staged change', () => {
  it('the toggle itself stages nothing; fnStage counts the edit once', () => {
    fnHeroSet('', 'pic.webp');
    fnToggleHeroCard();
    // Applied on stage/update, exactly like ◎ FOCAL — the slot is the draft.
    expect(STATE.staged.posts).toBe(0);
    fnStage('published');
    expect(STATE.staged.posts).toBe(1);
  });
});
