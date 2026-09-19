// @vitest-environment happy-dom
//
// ONE SET, EVERY SURFACE.
//
// "Is this stamped?" is answered in four places — the buffer's ▣ badge, the
// archive's ▣ badge, the focal modal's live line, and the share block — and all
// four read `_hasOgCard`, so none of them can disagree about what is on R2.
//
// The archive could not, until 2026-09-18. The set lived in `buffer`, and
// `archive` sits BELOW `buffer` in the plan order, so the import was illegal and
// the archive simply had no marker. That is not a cosmetic gap: the archive
// editor is where an owner was shown a share-image preview, had no way to learn
// it was not live, and concluded the console and the edge disagreed. The set
// moved down to `assets` (R2 bookkeeping, below every reader).
//
// This file pins the part a refactor would quietly undo: that the two renderers
// read the SAME set, and that moving it did not strand either one.
// Log: docs/maintenance/2026-09-18-og-stamp-invisible-for-five-minutes.md
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/console-api.js', () => ({
  getToken: () => 'test-token',
  uploadFiles: async () => {},
  uploadFilesWithRetry: async () => {},
  fetchOgCards: async () => ({ ok: true, cards: [] }),
}));

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const { _setOgCardSet, _addOgCard, _removeOgCard, _hasOgCard } = await import('../js/console/assets.js');
const { renderArchive } = await import('../js/console/archive.js');
const buffer = await import('../js/console/buffer.js');

const FRAME = { id: 'a1', slug: 'evening-light', filename: 'SAMPLE_Evening.webp', title: 'Evening Light', sub: 'A Sub' };

function mount() {
  document.body.innerHTML = `
    <div id="archive-display"></div><div id="archive-count"></div><div id="archive-stats"></div>
    <div id="buffer-display"></div><div id="buffer-count"></div><div id="buffer-stats"></div>
    <div id="toast-host"></div>`;
}

const archiveHtml = () => { renderArchive(); return document.getElementById('archive-display').innerHTML; };

beforeEach(() => {
  STATE.archive = [FRAME];
  STATE.buffer = [];
  _setOgCardSet([]);
  mount();
});

describe('the archive shows the stamped marker', () => {
  it('no badge on a frame with no stamp', () => {
    expect(archiveHtml()).not.toContain('ogc-badge');
  });

  it('a badge once the frame is stamped', () => {
    _setOgCardSet(['SAMPLE_Evening']);
    expect(archiveHtml()).toContain('ogc-badge');
  });

  it('keyed by the image basename, not the slug or the id', () => {
    _setOgCardSet([FRAME.slug]);     // a plausible wrong key
    expect(archiveHtml(), 'the slug is not the marker').not.toContain('ogc-badge');
    _setOgCardSet([FRAME.id]);
    expect(archiveHtml(), 'nor is the id').not.toContain('ogc-badge');
    _setOgCardSet(['SAMPLE_Evening']);
    expect(archiveHtml()).toContain('ogc-badge');
  });

  it('no badge on a failed upload — there is no frame to have stamped', () => {
    STATE.archive = [{ ...FRAME, _uploadError: 'upload failed' }];
    _setOgCardSet(['SAMPLE_Evening']);
    const html = archiveHtml();
    expect(html).toContain('✕ FAILED');
    expect(html).not.toContain('ogc-badge');
  });

  it('the badge sits INSIDE the thumb, which is its positioning context', () => {
    _setOgCardSet(['SAMPLE_Evening']);
    archiveHtml();
    const el = document.querySelector('.archive-card .thumb .ogc-badge');
    expect(el, 'an absolute badge outside .thumb escapes to another box').toBeTruthy();
  });
});

describe('one set, read by every surface', () => {
  it('buffer re-exports the same functions the archive imports', () => {
    // `export … from` is the seam. If buffer ever re-implements its own set,
    // the two badges can drift and the whole point is lost.
    expect(buffer._hasOgCard).toBe(_hasOgCard);
    expect(buffer._addOgCard).toBe(_addOgCard);
    expect(buffer._setOgCardSet).toBe(_setOgCardSet);
    expect(buffer._removeOgCard).toBe(_removeOgCard);
  });

  it('a stamp added anywhere is visible to the archive immediately', () => {
    expect(archiveHtml()).not.toContain('ogc-badge');
    _addOgCard('SAMPLE_Evening');
    expect(archiveHtml()).toContain('ogc-badge');
  });

  it('and removing it takes the badge away again', () => {
    _addOgCard('SAMPLE_Evening');
    expect(archiveHtml()).toContain('ogc-badge');
    _removeOgCard('SAMPLE_Evening');
    expect(archiveHtml()).not.toContain('ogc-badge');
  });

  it('the set still holds non-frame stems without confusing a frame reader', () => {
    // /api/og-cards lists every stem under meta/ — fn-, audio-, set-, card-.
    _setOgCardSet(['fn-a-note', 'audio-a-track', 'set-a-set', 'card-abc123']);
    expect(archiveHtml(), 'a frame must not match someone else\'s stem').not.toContain('ogc-badge');
    expect(_hasOgCard('fn-a-note')).toBe(true);
  });
});
