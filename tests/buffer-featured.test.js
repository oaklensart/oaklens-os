// @vitest-environment happy-dom
//
// Exclusive RAW featuring — toggleBufferFeatured in js/console/focal.js.
//
// The homepage shows exactly ONE RAW card, so starring a frame must un-star
// the previous one in the same gesture. The old model set flags and let the
// server's newest-captured-first sort pick a winner: starring an OLDER frame
// visibly did nothing while two ★ badges glowed. Exclusivity lives in the
// CONSOLE WRITE PATH only — the server (_featuredRawFrames) stays tolerant of
// legacy multi-featured data on purpose (tests/buffer-summary.test.js pins
// that), so the two suites together define the contract: console writes one,
// server survives many.
//
// The staging law is the other load-bearing thing here: one gesture = one
// bumpStage('buffer'), +1 ALWAYS — never a decrement, never a tally of
// featured frames. bumpStage clamps at 0, so a decrement model wedges publish
// with a live card that cannot be taken down (the audio-shelf incident;
// see _audioPromote's comment in js/console/audio.js).
import { describe, it, expect, beforeEach } from 'vitest';

// console-state.js reaches these through the global scope at call time (the
// real console mirrors its renderers onto window) — stub before importing.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const { toggleBufferFeatured, getLastFeaturedSwap } = await import('../js/console/focal.js');

beforeEach(() => {
  // renderBuffer() runs inside the toggle and writes these unconditionally.
  document.body.innerHTML = `
    <div id="buffer-display"></div>
    <span id="buffer-count"></span>
    <span id="buffer-stats"></span>
    <div id="toast-host"></div>
  `;
  STATE.buffer = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, friends: 0, library: 0, audio: 0 };
});

const frame = (id, over) => ({
  id, filename: `OAKLENS_${id}.webp`,
  captured_at: `2026-08-1${id.slice(-1)}T12:00:00Z`, published_at: '',
  added_at: '2026-08-20', archived: false, hash: 'sha256:0000', ...over,
});

describe('starring is exclusive', () => {
  it('starring B while A is starred leaves ONLY B featured', () => {
    STATE.buffer = [frame('a1', { featured: true }), frame('b2')];
    toggleBufferFeatured('b2');
    expect(STATE.buffer.find(f => f.id === 'a1').featured).toBeUndefined();
    expect(STATE.buffer.find(f => f.id === 'b2').featured).toBe(true);
  });

  it('starring an OLDER frame wins outright — the case the old model silently lost', () => {
    STATE.buffer = [frame('a9', { featured: true }), frame('b1')]; // b1 captured earlier
    toggleBufferFeatured('b1');
    expect(STATE.buffer.filter(f => f.featured).map(f => f.id)).toEqual(['b1']);
  });

  it('sweeps ALL stray flags, not just one — legacy multi-featured data heals on the next star', () => {
    STATE.buffer = [frame('a1', { featured: true }), frame('b2', { featured: true }), frame('c3')];
    toggleBufferFeatured('c3');
    expect(STATE.buffer.filter(f => f.featured).map(f => f.id)).toEqual(['c3']);
  });

  it('the displaced frame keeps its cardFocus — one tap to re-feature with the crop intact', () => {
    STATE.buffer = [frame('a1', { featured: true, cardFocus: '10% 90%' }), frame('b2')];
    toggleBufferFeatured('b2');
    expect(STATE.buffer.find(f => f.id === 'a1').cardFocus).toBe('10% 90%');
  });

  it('a dark frame refuses featuring and is untouched by the sweep', () => {
    STATE.buffer = [frame('a1', { featured: true }), frame('d4', { dark: true })];
    toggleBufferFeatured('d4');
    expect(STATE.buffer.find(f => f.id === 'a1').featured).toBe(true); // no-op: nothing swept
    expect(STATE.buffer.find(f => f.id === 'd4').featured).toBeUndefined();
  });
});

describe('the staging law — one gesture, one +1', () => {
  it('a displacing star is ONE staged change, not two', () => {
    STATE.buffer = [frame('a1', { featured: true }), frame('b2')];
    toggleBufferFeatured('b2');
    expect(STATE.staged.buffer).toBe(1);
  });

  it('un-starring stages +1 — never a decrement (the clamp trap)', () => {
    STATE.buffer = [frame('a1', { featured: true, _imported: true })];
    STATE.staged.buffer = 0;   // freshly synced: a live published card, nothing pending
    toggleBufferFeatured('a1');
    expect(STATE.staged.buffer).toBe(1);   // the un-star IS a pending change
  });

  it('star then immediate un-star is two gestures, two staged changes', () => {
    STATE.buffer = [frame('a1')];
    toggleBufferFeatured('a1');
    toggleBufferFeatured('a1');
    expect(STATE.staged.buffer).toBe(2);
  });
});

describe('getLastFeaturedSwap — the ↩ re-pin memory', () => {
  it('records { newId, prevId } on a displacing star', () => {
    STATE.buffer = [frame('a1', { featured: true }), frame('b2')];
    toggleBufferFeatured('b2');
    expect(getLastFeaturedSwap()).toEqual({ newId: 'b2', prevId: 'a1' });
  });

  it('a first star (nothing displaced) clears the record', () => {
    STATE.buffer = [frame('a1', { featured: true }), frame('b2')];
    toggleBufferFeatured('b2');           // sets a swap
    STATE.buffer.forEach(f => delete f.featured);
    toggleBufferFeatured('a1');           // fresh star, no displacement
    expect(getLastFeaturedSwap()).toBeNull();
  });

  it('re-pinning the previous frame through the same path restores it exactly', () => {
    STATE.buffer = [frame('a1', { featured: true, cardFocus: '10% 90%' }), frame('b2')];
    toggleBufferFeatured('b2');
    const swap = getLastFeaturedSwap();
    toggleBufferFeatured(swap.prevId);    // the ↩ RE-PIN gesture
    expect(STATE.buffer.filter(f => f.featured).map(f => f.id)).toEqual(['a1']);
    expect(STATE.buffer.find(f => f.id === 'a1').cardFocus).toBe('10% 90%');
    expect(STATE.staged.buffer).toBe(2);  // two gestures, two staged changes
  });
});
