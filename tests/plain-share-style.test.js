// @vitest-environment happy-dom
//
// THE SECOND SHARE STYLE — the photograph alone.
//
// `card` gives roughly half of a 1200×630 to the picture and the rest to type.
// `plain` gives all of it to the picture, cover-cropped at the focal point. On a
// frame that is a real decision about what a link preview is for, and the owner
// wanted the other answer available (docs/ideas/og-share-image-styles.md).
//
// Three things here are load-bearing and none of them are about pixels:
//
//   1. The two styles CROP DIFFERENTLY — 4:5 against 1.905:1 — so the same
//      focal point keeps different parts of the photograph. The stage's red
//      guide has to follow the selection or the author aims at the wrong box.
//   2. The style has to be REMEMBERED, or reopening a plain-stamped frame
//      previews a card over a line reading "● live" — the exact untruth this
//      area was fixed for on 2026-09-18, one layer along. It rides on the R2
//      object, because a stamp has no publish horizon.
//   3. It is offered ONLY where there is a photograph.
//
// Log: docs/maintenance/2026-09-18-og-stamp-invisible-for-five-minutes.md
import { describe, it, expect, beforeEach, vi } from 'vitest';

const uploads = [];
vi.mock('../js/console-api.js', () => ({
  getToken: () => 'test-token',
  uploadFiles: async (files, opts) => { uploads.push({ names: files.map((f) => f.name), meta: opts && opts.meta }); },
  deleteAssets: async () => {},
  fetchOgCards: async () => ({ ok: true, cards: [] }),
}));

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });
globalThis.confirm = () => true;

// A 2d context that records the draw calls this file reasons about.
let drawCalls = [];
let fillCalls = [];
HTMLCanvasElement.prototype.getContext = function getContext() {
  const noop = () => {};
  return {
    fillStyle: '', strokeStyle: '', font: '', letterSpacing: '', filter: '',
    textAlign: '', textBaseline: '', lineWidth: 0, globalAlpha: 1,
    measureText: (s) => ({ width: String(s).length * 9 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    save: noop, restore: noop, clip: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arcTo: noop, arc: noop, fill: noop,
    fillRect: (...a) => fillCalls.push(a),
    fillText: (...a) => drawCalls.push(['fillText', ...a]),
    drawImage: (...a) => drawCalls.push(['drawImage', ...a]),
    stroke: noop, strokeRect: noop,
  };
};
HTMLCanvasElement.prototype.toBlob = function toBlob(cb) { cb(new Blob(['x'], { type: 'image/webp' })); };

class QuietImage {
  set src(v) { this._src = v; this.naturalWidth = 1600; this.naturalHeight = 1000; setTimeout(() => this.onload?.(), 0); }
  get src() { return this._src; }
}
globalThis.Image = QuietImage;

await import('../js/recent-index.js');
const { STATE } = await import('../js/console-state.js');
const { FocalModal } = await import('../js/console/focal.js');
const { _setOgCardSet, _ogCardStyle, _hasOgCard } = await import('../js/console/assets.js');
const { paintPlain, paintCard, hasPicture, coverRect, focusPct, SHARE_RATIOS } =
  await import('../js/console/card-paint.js');

const FRAME = {
  slug: 'evening-light', filename: 'SAMPLE_Evening.webp', title: 'Evening Light',
  location: 'Sample City, 2025', added_at: '2026-09-01',
};
const MARKER = 'SAMPLE_Evening';
const item = () => ({ kind: 'photo', data: FRAME });

function mountModal() {
  document.body.innerHTML = `
    <div id="focal-modal" class="hidden">
      <div id="focal-modal-title"></div><div class="focal-hint" id="focal-hint"></div>
      <div id="focal-stage"><img id="focal-img">
        <div id="focal-guide-thumb"></div><div id="focal-guide-og"></div>
        <div id="focal-dot"></div></div>
      <div id="focal-cardwrap"><canvas id="ogc-canvas"></canvas>
        <div class="focal-style" id="focal-style">
          <button class="focal-style-btn" data-style="card"></button>
          <button class="focal-style-btn" data-style="plain"></button>
        </div>
        <div class="ogc-live" id="ogc-live"></div>
        <input type="checkbox" id="focal-guide-toggle" checked></div>
      <div id="focal-thumbwrap"><div id="focal-crop-preview"><img id="focal-crop-img"></div></div>
      <div id="focal-readout"></div><div id="ogc-status" class="ogc-status"></div>
      <span id="focal-card-actions">
        <button id="focal-btn-copy"></button><button id="focal-btn-publish"></button>
        <button id="focal-btn-remove" style="display:none"></button>
      </span>
    </div>
    <div id="toast-host"></div>
    <div id="buffer-display"></div><div id="buffer-count"></div><div id="buffer-stats"></div>
    <div id="archive-display"></div><div id="archive-count"></div><div id="archive-stats"></div>`;
}

const openWithCard = (over) => FocalModal.open({
  src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  focus: '40% 60%', aspect: '3 / 2',
  card: { item: item(), stem: `meta/${MARKER}`, marker: MARKER, shareUrl: 'https://example.com/archive/?f=evening-light', ...over },
});
const settle = () => new Promise((r) => setTimeout(r, 0));
const styleBtn = (s) => document.querySelector(`[data-style="${s}"]`);
const guide = () => document.getElementById('focal-guide-og');

// happy-dom lays nothing out: clientWidth/clientHeight and naturalWidth are all
// 0, so every guide rect computes to 0px and a test comparing them compares
// nothing. Fake the one measurement imageRect() takes, so the guide arithmetic
// runs for real.
function fakeStageLayout(w = 600, h = 400, nw = 1600, nh = 1000) {
  const stage = document.getElementById('focal-stage');
  Object.defineProperty(stage, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(stage, 'clientHeight', { value: h, configurable: true });
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h });
  const img = document.getElementById('focal-img');
  Object.defineProperty(img, 'naturalWidth', { value: nw, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: nh, configurable: true });
}

beforeEach(() => {
  STATE.buffer = [];
  STATE.archive = [FRAME];
  _setOgCardSet([]);
  uploads.length = 0;
  drawCalls = [];
  fillCalls = [];
  mountModal();
  fakeStageLayout();
});

describe('paintPlain — the picture, and nothing else', () => {
  it('is the full share ratio, not a card in a ground', async () => {
    const cv = await paintPlain(item(), 'og', { image: null });
    expect(cv.width).toBe(SHARE_RATIOS.og.w);
    expect(cv.height).toBe(SHARE_RATIOS.og.h);
  });

  it('draws NO type — that is the whole difference from the card', async () => {
    const img = new QuietImage(); img.src = 'x'; await settle();
    drawCalls = [];
    await paintPlain(item(), 'og', { image: img });
    expect(drawCalls.some((c) => c[0] === 'drawImage'), 'the photograph').toBe(true);
    expect(drawCalls.some((c) => c[0] === 'fillText'), 'and not one word of it').toBe(false);
  });

  it('the card style DOES draw type — so the two are genuinely different', async () => {
    const img = new QuietImage(); img.src = 'x'; await settle();
    drawCalls = [];
    await paintCard(item(), 'og', { image: img });
    expect(drawCalls.some((c) => c[0] === 'fillText')).toBe(true);
  });

  it('cover-crops the source at the focal point', async () => {
    const img = new QuietImage(); img.src = 'x'; await settle();
    drawCalls = [];
    await paintPlain(item(), 'og', { image: img, focus: '25% 75%' });
    const call = drawCalls.find((c) => c[0] === 'drawImage');
    const [, , sx, sy, cw, ch, dx, dy, dw, dh] = call;
    const f = focusPct('25% 75%');
    const want = coverRect(1600, 1000, SHARE_RATIOS.og.w / SHARE_RATIOS.og.h, f.x, f.y);
    expect({ sx, sy, cw, ch }).toEqual(want);
    expect({ dx, dy, dw, dh }, 'and fills the canvas edge to edge')
      .toEqual({ dx: 0, dy: 0, dw: SHARE_RATIOS.og.w, dh: SHARE_RATIOS.og.h });
  });

  it('a different point keeps a different part of the photograph', async () => {
    const img = new QuietImage(); img.src = 'x'; await settle();
    drawCalls = [];
    await paintPlain(item(), 'og', { image: img, focus: '50% 0%' });
    const top = drawCalls.find((c) => c[0] === 'drawImage')[4 - 1];
    drawCalls = [];
    await paintPlain(item(), 'og', { image: img, focus: '50% 100%' });
    const bottom = drawCalls.find((c) => c[0] === 'drawImage')[4 - 1];
    expect(bottom, 'the point has to actually move the crop').toBeGreaterThan(top);
  });

  it('still paints a ground when the picture will not load', async () => {
    await paintPlain(item(), 'og', { image: null });
    expect(fillCalls.length, 'a transparent canvas exports as black whatever the theme').toBeGreaterThan(0);
  });

  it('rejects a ratio it does not know', async () => {
    await expect(paintPlain(item(), 'nope', { image: null })).rejects.toThrow(/unknown share ratio/);
  });
});

describe('hasPicture — where the style may be offered', () => {
  it('true for a frame', () => {
    expect(hasPicture(item())).toBe(true);
  });

  it('false when there is no photograph to crop', () => {
    // Asked the way loadCardImage asks it — on `filename`, not on media.src.
    expect(hasPicture({ kind: 'photo', data: { ...FRAME, filename: '' } })).toBe(false);
  });
});

describe('the modal follows the style', () => {
  it('defaults to card', async () => {
    openWithCard();
    await settle();
    expect(styleBtn('card').classList.contains('on')).toBe(true);
    expect(styleBtn('plain').classList.contains('on')).toBe(false);
  });

  it('the crop guide MOVES with the style — they keep different pictures', async () => {
    openWithCard();
    await settle();
    const card = { w: guide().style.width, h: guide().style.height };
    expect(parseFloat(card.w), 'the guide is actually drawn').toBeGreaterThan(0);
    // The card keeps a 4:5 slice; plain keeps a 1.905:1 one. On the same
    // photograph at the same point those are different rectangles, and the one
    // on screen has to be the one the selected style will produce.
    FocalModal.setStyle('plain');
    await settle();
    const plain = { w: guide().style.width, h: guide().style.height };
    expect(plain, 'a guide that did not follow would aim you at the wrong box').not.toEqual(card);
    expect(parseFloat(plain.w) / parseFloat(plain.h))
      .toBeCloseTo(SHARE_RATIOS.og.w / SHARE_RATIOS.og.h, 1);
    FocalModal.setStyle('card');
    await settle();
    expect({ w: guide().style.width, h: guide().style.height },
      'and switching back restores the card crop').toEqual(card);
  });

  it('publishing carries the style to R2 as object metadata', async () => {
    openWithCard();
    await settle();
    FocalModal.setStyle('plain');
    await settle();
    await FocalModal.publish();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].meta, 'the object has to remember what it is')
      .toEqual({ [`meta/${MARKER}-og.webp`]: 'plain' });
  });

  it('and records it locally, so the badge and the line agree at once', async () => {
    openWithCard();
    await settle();
    FocalModal.setStyle('plain');
    await FocalModal.publish();
    expect(_hasOgCard(MARKER)).toBe(true);
    expect(_ogCardStyle(MARKER)).toBe('plain');
  });

  it('REOPENS IN THE STYLE THAT IS LIVE, not the last one picked', async () => {
    // The whole reason the style is persisted at all. Previewing a card over a
    // "● live" line on a plain-stamped frame is the same lie, one layer along.
    _setOgCardSet([[MARKER, 'plain']]);
    openWithCard();
    await settle();
    expect(styleBtn('plain').classList.contains('on')).toBe(true);
    expect(styleBtn('card').classList.contains('on')).toBe(false);
  });

  it('an older stamp with no recorded style reopens as card', async () => {
    // Every stamp made before styles existed is a card, so '' means card.
    _setOgCardSet([MARKER]);
    openWithCard();
    await settle();
    expect(styleBtn('card').classList.contains('on')).toBe(true);
  });

  it('does not leak the last style into the next frame opened', async () => {
    _setOgCardSet([[MARKER, 'plain']]);
    openWithCard();
    await settle();
    expect(styleBtn('plain').classList.contains('on')).toBe(true);
    _setOgCardSet([]);                       // a different, unstamped frame
    openWithCard();
    await settle();
    expect(styleBtn('card').classList.contains('on'), 'a fresh frame starts at card').toBe(true);
  });

  it('hides the choice where there is no photograph', async () => {
    openWithCard({ item: { kind: 'photo', data: { ...FRAME, filename: '' } } });
    await settle();
    expect(document.getElementById('focal-style').style.display).toBe('none');
  });
});
