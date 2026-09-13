// @vitest-environment happy-dom
//
// THE CANVAS IS THE ARTEFACT.
//
// FocalModal's card mode paints the share image, and ▲ Publish uploads whatever
// is on that canvas to R2 under a key that link previews already point at. The
// picture it draws is fetched and decoded in the BACKGROUND while the modal is
// already open and already painted once — so there is a window, as long as the
// network takes, in which the canvas holds a card with an empty well.
//
// Press publish inside that window and the empty card is what ships. Found by a
// code review of chunk 7; no test could have seen it, because the race needs a
// network and a green suite has none. This file gives it one, with the load
// held open on purpose.
//
// It also pins the cheaper half of the same rule: ⤓ Download, which writes the
// same canvas to the author's disk.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const uploaded = [];
vi.mock('../js/console-api.js', () => ({
  getToken: () => 'test-token',
  uploadFiles: async (files) => { uploaded.push(...files); },
  fetchOgCards: async () => ({ ok: true, cards: [] }),
}));

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

// ---- a canvas that records instead of rasterising -------------------------
// happy-dom has no 2d context and no toBlob. What this test asserts is ORDER,
// not pixels: was the picture on the canvas before the blob was taken?
let ctxCalls = [];
HTMLCanvasElement.prototype.getContext = function getContext() {
  const rec = (name) => (...args) => { ctxCalls.push([name, ...args]); };
  return {
    fillStyle: '', strokeStyle: '', font: '', letterSpacing: '', filter: '',
    textAlign: '', textBaseline: '', lineWidth: 0, globalAlpha: 1,
    measureText: (s) => ({ width: String(s).length * 9 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    save: rec('save'), restore: rec('restore'), clip: rec('clip'),
    beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arcTo: rec('arcTo'), arc: rec('arc'),
    fill: rec('fill'), fillRect: rec('fillRect'), fillText: rec('fillText'),
    drawImage: rec('drawImage'), stroke: rec('stroke'), strokeRect: rec('strokeRect'),
  };
};
// WHAT WAS ON THE CANVAS at the moment the blob was taken. Recorded out here,
// not stamped on the Blob: publish() wraps the blob in a `new File(...)`, which
// copies the bytes and drops any property hung on it — so an assertion made
// against the uploaded File reads `undefined` and a `?? true` fallback makes it
// pass on nothing. (It did, in the first version of this file.)
let blobHadPicture = null;
HTMLCanvasElement.prototype.toBlob = function toBlob(cb) {
  blobHadPicture = ctxCalls.some((c) => c[0] === 'drawImage');
  cb(new Blob(['x'], { type: 'image/webp' }));
};

// ---- an Image whose load this test controls -------------------------------
let pending = [];
class HeldImage {
  set src(v) { this._src = v; pending.push(this); }
  get src() { return this._src; }
  settle() { this.naturalWidth = 1600; this.naturalHeight = 1200; this.onload?.(); }
  fail() { this.onerror?.(); }
}
globalThis.Image = HeldImage;

await import('../js/recent-index.js');
const { STATE } = await import('../js/console-state.js');
const { FocalModal } = await import('../js/console/focal.js');

const FRAME = {
  slug: 'evening-light', filename: 'SAMPLE_Evening.webp', title: 'Evening Light',
  location: 'Sample City, 2025', camera: 'Mirrorless', added_at: '2026-09-01',
  focus: '40% 60%',
};

/** Everything FocalModal.open touches, and the three ids renderBuffer wants. */
function mountModal() {
  document.body.innerHTML = `
    <div id="focal-modal" class="hidden">
      <div id="focal-modal-title"></div>
      <div id="focal-stage"><img id="focal-img">
        <div id="focal-guide-thumb"></div><div id="focal-guide-og"></div>
        <div id="focal-dot"></div></div>
      <div id="focal-cardwrap"><canvas id="ogc-canvas"></canvas>
        <input type="checkbox" id="focal-guide-toggle"></div>
      <div id="focal-thumbwrap"><div id="focal-crop-preview"><img id="focal-crop-img"></div></div>
      <div id="focal-readout"></div><div id="ogc-status" class="ogc-status"></div>
      <span id="focal-card-actions">
        <button id="focal-btn-copy"></button><button id="focal-btn-publish"></button>
      </span>
    </div>
    <div id="toast-host"></div>
    <div id="buffer-display"></div><div id="buffer-count"></div><div id="buffer-stats"></div>`;
}

const openWithCard = () => FocalModal.open({
  src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  focus: '40% 60%',
  aspect: '3 / 2',
  card: {
    item: { kind: 'photo', data: FRAME },
    stem: 'meta/SAMPLE_Evening',
    marker: 'SAMPLE_Evening',
    shareUrl: 'https://example.com/archive/?f=evening-light',
  },
});

/** Let every queued microtask drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  uploaded.length = 0;
  ctxCalls = [];
  blobHadPicture = null;
  pending = [];
  STATE.buffer = [];
  STATE.archive = [FRAME];
  mountModal();
});

describe('publish waits for the picture', () => {
  it('does not upload a card whose well is still empty', async () => {
    openWithCard();
    await settle();
    // The modal has painted at least once already — that is the point — and the
    // picture is still in flight.
    expect(ctxCalls.some((c) => c[0] === 'fillRect'), 'it painted').toBe(true);
    expect(ctxCalls.some((c) => c[0] === 'drawImage'), 'without the picture').toBe(false);
    expect(pending, 'and the picture is still loading').toHaveLength(1);

    const publishing = FocalModal.publish();
    await settle();
    expect(uploaded, 'nothing ships while the well is empty').toHaveLength(0);

    pending[0].settle();
    await publishing;

    expect(uploaded, 'and it ships once the picture is on the canvas').toHaveLength(1);
    expect(blobHadPicture, 'and the canvas held the picture when the blob was taken').toBe(true);
  });

  it('uploads to the key shareStem built, not a literal', async () => {
    openWithCard();
    await settle();
    const publishing = FocalModal.publish();
    await settle();
    pending[0].settle();
    await publishing;
    expect(uploaded[0].name).toBe('meta/SAMPLE_Evening-og.webp');
  });

  it('a picture that will NOT load still publishes — degraded, never stuck', async () => {
    // loadCardImage resolves null rather than rejecting: a picture the owner
    // cannot load must not be a card they cannot publish. The wait must honour
    // that, or ▲ Publish hangs forever on a dead CDN.
    openWithCard();
    await settle();
    const publishing = FocalModal.publish();
    await settle();
    pending.forEach((im) => im.fail());     // the 2048w, then the 1024w fallback
    await settle();
    pending.slice(1).forEach((im) => im.fail());
    await publishing;
    expect(uploaded, 'it did not hang').toHaveLength(1);
  });

  it('download waits on the same canvas', async () => {
    const clicks = [];
    const realCreate = document.createElement.bind(document);
    document.createElement = (tag) => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = () => clicks.push(el.download);
      return el;
    };
    globalThis.URL.createObjectURL = () => 'blob:x';
    globalThis.URL.revokeObjectURL = () => {};

    openWithCard();
    await settle();
    const downloading = FocalModal.download();
    await settle();
    expect(clicks, 'nothing saved while the well is empty').toHaveLength(0);
    pending[0].settle();
    await downloading;
    expect(clicks).toHaveLength(1);
    expect(blobHadPicture, 'the saved file held the picture').toBe(true);
    document.createElement = realCreate;
  });

  it('a card with no picture at all does not wait for one', async () => {
    // A words-only composed card has no media, so loadCardImage resolves null
    // immediately. Publish must not stall looking for a picture that was never
    // coming.
    FocalModal.open({
      src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      focus: '50% 50%',
      aspect: '3 / 2',
      card: {
        item: { kind: 'text', data: {}, over: { id: 'c-1', title: 'A card', tease: 'Words.' } },
        stem: 'meta/card-c-1',
        shareUrl: null,
      },
    });
    await settle();
    await FocalModal.publish();
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].name).toBe('meta/card-c-1-og.webp');
  });
});

describe('the paint queue drains before the canvas is read', () => {
  // A code review argued that settled() could return while a QUEUED repaint was
  // still in flight: await the in-flight paint, that paint's .then() kicks off
  // the queued one, settled() unblocks early, and toBlob() reads a stale canvas.
  //
  // It cannot, and the reason is one `return` keyword: drawCard()'s .then()
  // RETURNS drawCard() when a repaint is queued, and a promise that resolves to
  // another promise ADOPTS it — so the outer paint does not settle until the
  // queued one has. Awaiting the in-flight paint therefore waits for the whole
  // chain, however deep it goes.
  //
  // ⚠️ HONEST SCOPE. This sweep covers the PICTURE-LOAD window — the picture
  // arrives at tick N and publish is pressed at tick N, for every N — which is
  // the race that actually shipped. It does NOT reach the queued-repaint window:
  // a paint with its image already in hand is in flight for a single microtask,
  // too narrow for these interleavings to land inside, and breaking the adoption
  // above deliberately leaves this sweep green. That window is covered by the
  // bounded drain loop in settled() instead, which is why that loop exists even
  // though the adoption makes it a no-op. Do not read a green sweep here as
  // proof the queue drains.
  const ticks = (n) => Array.from({ length: n }, () => Promise.resolve())
    .reduce((p) => p.then(() => {}), Promise.resolve());

  for (let n = 0; n <= 8; n++) {
    it(`picture at tick ${n}, publish at tick ${n} — the blob still has the picture`, async () => {
      openWithCard();
      await ticks(n);
      pending.forEach((im) => im.settle());
      const publishing = FocalModal.publish();
      await publishing;
      expect(uploaded, `tick ${n} published`).toHaveLength(1);
      expect(blobHadPicture, `tick ${n}: the blob was taken before the picture landed`).toBe(true);
    });
  }

  it('a drag stacked on top of a publish cannot slip a half-finished crop in', async () => {
    openWithCard();
    await settle();
    pending.forEach((im) => im.settle());
    await settle();
    // Three repaints queued, then publish on top of them.
    FocalModal.reset();
    FocalModal.reset();
    FocalModal.reset();
    await FocalModal.publish();
    expect(uploaded).toHaveLength(1);
    expect(blobHadPicture).toBe(true);
  });
});
