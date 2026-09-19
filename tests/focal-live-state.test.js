// @vitest-environment happy-dom
//
// DOES THE PREVIEW SAY WHETHER IT IS LIVE?
//
// The focal modal's canvas draws the same card whether or not that card has
// ever been published, so on its own it cannot tell "this is the current
// unfurl" from "this is what ▲ Publish would produce". On 2026-09-18 an owner
// read the second as the first, concluded the console and the edge disagreed
// about the share image, and went looking for a wiring bug. There wasn't one —
// the stamp simply had not surfaced yet. Six minutes on a disagreement that did
// not exist, because the modal had the answer and never showed it.
//
// The buffer has had a ▣ badge off the same set since chunk 6; the archive,
// where this was reported, renders none. So the modal is where the line goes.
// Log: docs/maintenance/2026-09-18-og-stamp-invisible-for-five-minutes.md
import { describe, it, expect, beforeEach, vi } from 'vitest';

const deleted = [];
let deleteShouldFail = false;
vi.mock('../js/console-api.js', () => ({
  getToken: () => 'test-token',
  uploadFiles: async () => {},
  deleteAssets: async (keys) => {
    if (deleteShouldFail) throw new Error('R2 said no');
    deleted.push(...keys);
  },
  fetchOgCards: async () => ({ ok: true, cards: [] }),
}));

// ✕ Remove is the one gesture in this modal with no publish horizon, so it
// asks first. Auto-confirm by default; the refusal case flips it.
let confirmAnswer = true;
globalThis.confirm = () => confirmAnswer;

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

HTMLCanvasElement.prototype.getContext = function getContext() {
  const noop = () => {};
  return {
    fillStyle: '', strokeStyle: '', font: '', letterSpacing: '', filter: '',
    textAlign: '', textBaseline: '', lineWidth: 0, globalAlpha: 1,
    measureText: (s) => ({ width: String(s).length * 9 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    save: noop, restore: noop, clip: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arcTo: noop, arc: noop, fill: noop,
    fillRect: noop, fillText: noop, drawImage: noop, stroke: noop, strokeRect: noop,
  };
};
HTMLCanvasElement.prototype.toBlob = function toBlob(cb) { cb(new Blob(['x'], { type: 'image/webp' })); };

class QuietImage {
  set src(v) { this._src = v; this.naturalWidth = 1600; this.naturalHeight = 1200; setTimeout(() => this.onload?.(), 0); }
  get src() { return this._src; }
}
globalThis.Image = QuietImage;

await import('../js/recent-index.js');
const { STATE } = await import('../js/console-state.js');
const { FocalModal } = await import('../js/console/focal.js');
const { _setOgCardSet, _hasOgCard } = await import('../js/console/buffer.js');

const FRAME = {
  slug: 'evening-light', filename: 'SAMPLE_Evening.webp', title: 'Evening Light',
  location: 'Sample City, 2025', added_at: '2026-09-01',
};
const MARKER = 'SAMPLE_Evening';

// The modal as it actually ships — including the two elements this file is
// about, which the older focal test has no reason to mount.
function mountModal() {
  document.body.innerHTML = `
    <div id="focal-modal" class="hidden">
      <div id="focal-modal-title"></div>
      <div class="focal-hint" id="focal-hint">Drag the <span class="accent">point</span> to choose what stays in frame when this photo is cropped to a thumbnail. The full-frame view is never cropped.</div>
      <div id="focal-stage"><img id="focal-img">
        <div id="focal-guide-thumb"></div><div id="focal-guide-og"></div>
        <div id="focal-dot"></div></div>
      <div id="focal-cardwrap"><canvas id="ogc-canvas"></canvas>
        <div class="ogc-live" id="ogc-live"></div>
        <input type="checkbox" id="focal-guide-toggle"></div>
      <div id="focal-thumbwrap"><div id="focal-crop-preview"><img id="focal-crop-img"></div></div>
      <div id="focal-readout"></div><div id="ogc-status" class="ogc-status"></div>
      <span id="focal-card-actions">
        <button id="focal-btn-copy"></button><button id="focal-btn-publish"></button>
        <button id="focal-btn-remove" style="display:none"></button>
      </span>
    </div>
    <div id="toast-host"></div>
    <div id="buffer-display"></div><div id="buffer-count"></div><div id="buffer-stats"></div>`;
}

const cardFor = (over = {}) => ({
  item: { kind: 'photo', data: FRAME },
  stem: `meta/${MARKER}`,
  marker: MARKER,
  shareUrl: 'https://example.com/archive/?f=evening-light',
  ...over,
});

const openWithCard = (over) => FocalModal.open({
  src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  focus: '40% 60%', aspect: '3 / 2', card: cardFor(over),
});

const live = () => document.getElementById('ogc-live');
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  STATE.buffer = [];
  STATE.archive = [FRAME];
  _setOgCardSet([]);
  deleted.length = 0;
  deleteShouldFail = false;
  confirmAnswer = true;
  mountModal();
});

describe('the modal says whether the stamp is live', () => {
  it('an unstamped frame is NOT sold as the current unfurl', async () => {
    openWithCard();
    await settle();
    expect(live().textContent).toMatch(/not published/i);
    expect(live().className, 'and it is not wearing the live colour').not.toContain('is-live');
  });

  it('a stamped frame says so — off the same set the buffer badge reads', async () => {
    _setOgCardSet([MARKER]);
    openWithCard();
    await settle();
    expect(live().textContent).toMatch(/live/i);
    expect(live().textContent).not.toMatch(/not published/i);
    expect(live().className).toContain('is-live');
  });

  it('publishing flips it without waiting for a reload', async () => {
    openWithCard();
    await settle();
    expect(live().textContent).toMatch(/not published/i);
    await FocalModal.publish();
    expect(live().textContent).toMatch(/live/i);
    expect(live().className).toContain('is-live');
  });

  it('works off the stem alone, so every kind is covered — not just frames', async () => {
    // A note, a track, a set and a composed card are in the same set under
    // their own stems (js/console/buffer.js:208). Nothing passes a `marker` for
    // those, so the line has to derive one or it would read "not published" on
    // four surfaces that are.
    _setOgCardSet(['fn-a-note']);
    FocalModal.open({
      src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      focus: '50% 50%', aspect: '3 / 2',
      card: { item: { kind: 'photo', data: FRAME }, stem: 'meta/fn-a-note', shareUrl: 'https://example.com/p/a-note' },
    });
    await settle();
    expect(live().textContent).toMatch(/live/i);
  });

  it('says nothing on a download-only surface — the wall has no page to unfurl', async () => {
    _setOgCardSet([MARKER]);
    openWithCard({ canPublish: false, shareUrl: null });
    await settle();
    expect(live().textContent, 'neither answer means anything there').toBe('');
  });

  it('is cleared in thumbnail mode, which has no share image at all', async () => {
    _setOgCardSet([MARKER]);
    openWithCard();
    await settle();
    expect(live().textContent).not.toBe('');
    FocalModal.open({ src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', focus: '50% 50%', aspect: '3 / 2' });
    await settle();
    expect(live().textContent, 'a stale LIVE from the last open would be a lie').toBe('');
  });
});

describe('the hint follows the mode', () => {
  // It only ever talked about thumbnails, while the right column showed a
  // 1200×630 OG card — the one piece of prose in the modal, describing a
  // different feature than the one on screen.
  const hint = () => document.getElementById('focal-hint').textContent;

  it('card mode names the share image and says the point drives both', async () => {
    openWithCard();
    await settle();
    expect(hint()).toMatch(/share image/i);
    expect(hint()).toMatch(/thumbnail/i);
    expect(hint(), 'the claim that was wrong in card mode').not.toMatch(/cropped to a thumbnail/i);
  });

  it('thumbnail mode keeps its own wording', async () => {
    openWithCard();
    await settle();
    FocalModal.open({ src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', focus: '50% 50%', aspect: '3 / 2' });
    await settle();
    expect(hint()).toMatch(/cropped to a thumbnail/i);
    expect(hint()).not.toMatch(/share image/i);
  });
});

// ============================================================================
// TURNING A STAMP OFF
//
// The counterpart to publish. It is the only gesture in this modal that is live
// the instant it returns — every other destructive thing in the console waits
// for the publish horizon — so it confirms, and the way back is structural:
// ▲ Publish Card is still on screen, still aimed at the same stem.
// ============================================================================
const removeBtn = () => document.getElementById('focal-btn-remove');

describe('✕ Remove — turning a published stamp off', () => {
  it('is hidden until there is something to remove', async () => {
    openWithCard();
    await settle();
    expect(removeBtn().style.display, 'a permanently-visible inert button is a dead control').toBe('none');
  });

  it('appears once the stamp is live', async () => {
    _setOgCardSet([MARKER]);
    openWithCard();
    await settle();
    expect(removeBtn().style.display).not.toBe('none');
  });

  it('appears the moment you publish, without reopening', async () => {
    openWithCard();
    await settle();
    expect(removeBtn().style.display).toBe('none');
    await FocalModal.publish();
    expect(removeBtn().style.display).not.toBe('none');
  });

  it('deletes ALL THREE ratios, not just the one that unfurls', async () => {
    // og is what a crawler reads, but the share block writes native and story
    // beside it. Deleting only og leaves two orphans nothing references and
    // nothing lists.
    _setOgCardSet([MARKER]);
    openWithCard();
    await settle();
    await FocalModal.remove();
    expect(deleted).toEqual(expect.arrayContaining([
      `meta/${MARKER}-og.webp`, `meta/${MARKER}-native.webp`, `meta/${MARKER}-story.webp`,
    ]));
    expect(deleted).toHaveLength(3);
  });

  it('drops the badge and flips the line back', async () => {
    _setOgCardSet([MARKER]);
    openWithCard();
    await settle();
    await FocalModal.remove();
    expect(_hasOgCard(MARKER), 'the one set every badge reads').toBe(false);
    expect(live().textContent).toMatch(/not published/i);
    expect(removeBtn().style.display, 'and there is nothing left to remove').toBe('none');
  });

  it('does nothing at all if the confirm is declined', async () => {
    _setOgCardSet([MARKER]);
    openWithCard();
    await settle();
    confirmAnswer = false;
    await FocalModal.remove();
    expect(deleted, 'no R2 call').toHaveLength(0);
    expect(_hasOgCard(MARKER), 'and the stamp is untouched').toBe(true);
    expect(live().textContent).toMatch(/live/i);
  });

  it('keeps the stamp marked live when the delete FAILS', async () => {
    // The set must follow R2, not the button press. Marking it gone on a failed
    // delete would show "not published" over a stamp that is still unfurling —
    // the same class of lie this whole session was about, pointing the other way.
    _setOgCardSet([MARKER]);
    openWithCard();
    await settle();
    deleteShouldFail = true;
    await FocalModal.remove();
    expect(_hasOgCard(MARKER)).toBe(true);
    expect(live().textContent).toMatch(/live/i);
  });

  it('is inert on a card that was never stamped', async () => {
    openWithCard();
    await settle();
    await FocalModal.remove();
    expect(deleted).toHaveLength(0);
  });
});
