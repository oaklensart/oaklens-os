// @vitest-environment happy-dom
//
// importIntoSurface vs. local unpublished edits (js/console/publish.js).
//
// The other half of the 2026-08-23 first-publish settings loss: the import
// pass used to drop EVERY _imported entry and take the remote copy, so any
// sync — focus-sync, login sync, conflict-recovery sync — reverted any local
// edit to a published entry. Now entries whose ids appear in the staged-change
// ledger (console-state.js stagedLog) keep their local copy: local-dirty wins
// whole-entry, and true concurrent divergence surfaces at publish time as a
// stale-base conflict instead of a silent revert. Deliberately NOT gated on
// refusing to sync (that re-opens the 2026-08-11 undeletable-track wedge) —
// the protection lives in the merge itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// clearImported repaints the console through real module imports; stub the
// paint (same shape as sync-skip.test.js), keep everything else real.
vi.mock('../js/console/chrome.js', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshStageIndicators: () => {},
  toast: () => {},
}));
vi.mock('../js/console/buffer.js', async (importOriginal) => ({
  ...(await importOriginal()), renderBuffer: () => {},
}));
vi.mock('../js/console/archive.js', async (importOriginal) => ({
  ...(await importOriginal()), renderArchive: () => {},
}));
vi.mock('../js/console/fn-editor.js', async (importOriginal) => ({
  ...(await importOriginal()), renderFN: () => {},
}));
vi.mock('../js/console/more-views.js', async (importOriginal) => ({
  ...(await importOriginal()),
  renderWall: () => {}, renderNetwork: () => {}, renderLibrary: () => {},
}));
vi.mock('../js/console/audio.js', async (importOriginal) => ({
  ...(await importOriginal()), renderAudio: () => {},
}));

// console-state.js reaches these through the global scope at call time.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
for (const fn of ['renderBuffer', 'renderArchive', 'renderFN', 'fnNewPost',
  'renderWall', 'renderNetwork', 'renderLibrary', 'renderAudio']) {
  globalThis[fn] = () => {};
}
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE, sessionTrash, stageChange, clearStage, trashItem } =
  await import('../js/console-state.js');
const { importIntoSurface, clearImported } = await import('../js/console-ui.js');

const SURFACES = ['buffer', 'archive', 'posts', 'wallpapers', 'friends', 'library', 'audio', 'cards'];

beforeEach(() => {
  document.body.innerHTML = '<div id="toast-host"></div>';
  localStorage.clear();
  SURFACES.forEach((s) => { STATE[s] = []; });
  STATE.staged = Object.fromEntries(SURFACES.map((s) => [s, 0]));
  STATE.stagedLog = [];
  sessionTrash.length = 0;
});

const imported = (id, extra = {}) => ({ id, filename: `${id}.webp`, _imported: true, ...extra });

describe('importIntoSurface — local dirty edits survive the replace', () => {
  it('a dirty imported entry keeps its local copy over the remote one', () => {
    STATE.buffer = [imported('f1', { focus: '30% 40%', featured: true })];
    stageChange('buffer', { id: 'f1', label: 'f#241 — focal point' });

    // What main answers in the loss window: the entry WITHOUT the edits.
    importIntoSurface('buffer', [{ id: 'f1', filename: 'f1.webp' }]);

    expect(STATE.buffer).toHaveLength(1);
    expect(STATE.buffer[0].focus).toBe('30% 40%');
    expect(STATE.buffer[0].featured).toBe(true);
  });

  it('a clean imported entry is still replaced by the remote copy', () => {
    STATE.buffer = [imported('f1', { title: 'stale local title' })];
    importIntoSurface('buffer', [{ id: 'f1', filename: 'f1.webp', title: 'fresh from main' }]);
    expect(STATE.buffer[0].title).toBe('fresh from main');
  });

  it('a dirty entry deleted on main survives until its change publishes', () => {
    STATE.buffer = [imported('f1', { focus: '30% 40%' })];
    stageChange('buffer', { id: 'f1', label: 'f#241 — focal point' });
    importIntoSurface('buffer', []);
    expect(STATE.buffer, 'the pending local change wins until published').toHaveLength(1);
  });

  it('a clean entry deleted on main is dropped, exactly as before', () => {
    STATE.buffer = [imported('f1')];
    importIntoSurface('buffer', []);
    expect(STATE.buffer).toHaveLength(0);
  });

  it('every id of a multi-id change is protected — both sides of the featured swap', () => {
    STATE.buffer = [imported('fNew', { featured: true }), imported('fPrev')];
    stageChange('buffer', { ids: ['fNew', 'fPrev'], label: 'RAW card: f#2 ← f#1', kind: 'feature' });

    // Main still says fPrev is the featured one.
    importIntoSurface('buffer', [
      { id: 'fNew', filename: 'fNew.webp' },
      { id: 'fPrev', filename: 'fPrev.webp', featured: true },
    ]);

    expect(STATE.buffer.find((e) => e.id === 'fNew').featured).toBe(true);
    expect(STATE.buffer.find((e) => e.id === 'fPrev').featured,
      'the un-starring must not be resurrected by the sync').toBeUndefined();
  });

  it('remote entries new to this session still land alongside protected ones', () => {
    STATE.buffer = [imported('f1', { focus: '1% 1%' })];
    stageChange('buffer', { id: 'f1', label: 'edit' });
    importIntoSurface('buffer', [{ id: 'f1', filename: 'f1.webp' }, { id: 'f2', filename: 'f2.webp' }]);
    expect(STATE.buffer.map((e) => e.id).sort()).toEqual(['f1', 'f2']);
  });

  it('trash outranks the ledger — a dirty-then-trashed id stays out', () => {
    // Editing an entry and then deleting it: the deletion is the change that
    // stands, and the sync must neither resurrect the entry nor unprotect the
    // pending deletion.
    STATE.audio = [{ id: 't1', title: 't1', filename: 't1.mp3', _imported: true }];
    stageChange('audio', { id: 't1', label: 't1 — retitle' });
    trashItem('audio', 't1');

    importIntoSurface('audio', [{ id: 't1', title: 't1', filename: 't1.mp3' }]);
    expect(STATE.audio).toHaveLength(0);
    expect(sessionTrash).toHaveLength(1);
  });

  it('after publish clears the stage, the protection releases', () => {
    // Post-publish: everything is committed, clearStage() empties the ledger,
    // and from then on main's copy is canonical again.
    STATE.buffer = [imported('f1', { focus: '30% 40%' })];
    stageChange('buffer', { id: 'f1', label: 'edit' });
    clearStage();
    importIntoSurface('buffer', [{ id: 'f1', filename: 'f1.webp', focus: '70% 70%' }]);
    expect(STATE.buffer[0].focus).toBe('70% 70%');
  });
});

describe('clearImported — the same protection', () => {
  it('keeps a dirty imported entry when imported data is cleared', () => {
    document.body.innerHTML += '<div id="sync-status"></div>';
    const sumCards = ['buffer', 'archive', 'fn', 'wall', 'network', 'audio', 'cards']
      .map((k) => `<div id="sum-${k}"><span id="sum-count-${k}"></span><span id="sum-delta-${k}"></span></div>`)
      .join('');
    document.body.innerHTML += `${sumCards}<span id="sum-count-library"></span>`;

    STATE.buffer = [imported('clean'), imported('dirty', { focus: '30% 40%' })];
    stageChange('buffer', { id: 'dirty', label: 'edit' });

    clearImported();
    expect(STATE.buffer.map((e) => e.id)).toEqual(['dirty']);
  });
});
