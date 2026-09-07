// @vitest-environment happy-dom
//
// The staged-change ledger (js/console-state.js).
//
// STATE.staged counts gestures; STATE.stagedLog records which ITEMS those
// gestures touched — one row per (surface, primary id), repeated gestures
// folding into the row's `n`. The ledger is not bookkeeping for display: it is
// the protection set that tells importIntoSurface which _imported entries
// carry unpublished local edits (tests/sync-merge-protection.test.js) and
// tells save() which imported entries must stay in localStorage across a
// reload. These pin its semantics.
import { describe, it, expect, beforeEach } from 'vitest';

// console-state.js reaches these through the global scope at call time.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
for (const fn of ['renderBuffer', 'renderArchive', 'renderFN', 'fnNewPost',
  'renderWall', 'renderBarrel', 'renderNetwork', 'renderLibrary', 'renderAudio']) {
  globalThis[fn] = () => {};
}
globalThis.fetch = async () => new Response('[]', { status: 200 });

const {
  STATE, STORAGE_KEY, LEDGER_CAP, sessionTrash,
  stageChange, stagedIdsFor, clearStage, bumpStage,
  trashItem, trashRestore, save, load,
} = await import('../js/console-state.js');

const SURFACES = ['buffer', 'archive', 'posts', 'wallpapers', 'barrel', 'friends', 'library', 'audio'];

beforeEach(() => {
  document.body.innerHTML = '<div id="toast-host"></div>';
  localStorage.clear();
  SURFACES.forEach((s) => { STATE[s] = []; });
  STATE.staged = Object.fromEntries(SURFACES.map((s) => [s, 0]));
  STATE.stagedLog = [];
  sessionTrash.length = 0;
});

describe('stageChange — one row per item, gestures fold into n', () => {
  it('creates a row and bumps the counter on first touch', () => {
    stageChange('buffer', { id: 'f1', label: 'f#241 — focal point' });
    expect(STATE.staged.buffer).toBe(1);
    expect(STATE.stagedLog).toEqual([expect.objectContaining({
      surface: 'buffer', ids: ['f1'], label: 'f#241 — focal point', kind: 'edit', n: 1,
    })]);
  });

  it('repeated gestures on the same item update the row, not the row count', () => {
    stageChange('buffer', { id: 'f1', label: 'f#241 — focal point' });
    stageChange('buffer', { id: 'f1', label: 'f#241 — card crop' });
    stageChange('buffer', { id: 'f1', label: 'f#241 — focal point' });

    expect(STATE.staged.buffer, 'counters keep the one-gesture-one-bump law').toBe(3);
    expect(STATE.stagedLog).toHaveLength(1);
    expect(STATE.stagedLog[0].n).toBe(3);
    expect(STATE.stagedLog[0].label, 'latest label wins').toBe('f#241 — focal point');
  });

  it('the same id on different surfaces gets different rows', () => {
    stageChange('buffer', { id: 'x1', label: 'a' });
    stageChange('archive', { id: 'x1', label: 'b' });
    expect(STATE.stagedLog).toHaveLength(2);
  });

  it('a multi-id change (the featured swap) protects every id it names', () => {
    stageChange('buffer', { ids: ['fNew', 'fPrev'], label: 'RAW card: f#241 ← f#217', kind: 'feature' });
    const dirty = stagedIdsFor('buffer');
    expect(dirty.has('fNew')).toBe(true);
    expect(dirty.has('fPrev'), 'the frame that LOST the star changed too').toBe(true);
    expect(STATE.stagedLog).toHaveLength(1);
  });

  it('an id-less call still bumps the counter (incremental-migration escape hatch)', () => {
    stageChange('audio', {});
    expect(STATE.staged.audio).toBe(1);
    expect(STATE.stagedLog).toHaveLength(0);
  });

  it('the ledger caps; the counters stay authoritative past it', () => {
    for (let i = 0; i < LEDGER_CAP + 25; i++) {
      stageChange('barrel', { id: `b${i}`, label: `entry ${i}` });
    }
    expect(STATE.stagedLog).toHaveLength(LEDGER_CAP);
    expect(STATE.staged.barrel).toBe(LEDGER_CAP + 25);
    expect(STATE.stagedLog[0].ids[0], 'oldest rows fall off first').toBe('b25');
  });

  it('clearStage wipes rows and counters together', () => {
    stageChange('buffer', { id: 'f1', label: 'x' });
    clearStage();
    expect(STATE.staged.buffer).toBe(0);
    expect(STATE.stagedLog).toHaveLength(0);
  });
});

describe('trash mirroring — the ± logic, now with rows', () => {
  it('trashing a never-published item pulls its rows and stashes them for restore', () => {
    STATE.buffer = [{ id: 'f1', filename: 'x.webp', _uploaded: true }];
    stageChange('buffer', { id: 'f1', label: 'f#241 — new frame', kind: 'add' });
    stageChange('buffer', { id: 'f1', label: 'f#241 — focal point' });
    expect(STATE.staged.buffer).toBe(2);

    trashItem('buffer', 'f1');
    expect(STATE.stagedLog, 'a cancelled add leaves no row behind').toHaveLength(0);
    // Was `toBe(1)` until 2026-08-31, which asserted the defect: the counter
    // dropped by a flat 1 no matter how many gestures the item had staged, so
    // a twice-touched draft left a permanent +1 for something that no longer
    // exists. Staging counts gestures, so the cancellation counts them too.
    expect(STATE.staged.buffer, 'trashing cancels every gesture the item staged').toBe(0);

    trashRestore(0);
    expect(STATE.stagedLog, 'restore reinstates the stashed rows exactly').toHaveLength(1);
    expect(STATE.stagedLog[0].n).toBe(2);
    expect(STATE.staged.buffer, 'restore owes back the same count it cancelled').toBe(2);
    expect(stagedIdsFor('buffer').has('f1')).toBe(true);
  });

  it('trashing a FAILED upload moves the counter by nothing', () => {
    // stageChange only fires on upload SUCCESS, so a failed row never staged a
    // +1. The old flat -1 cancelled some OTHER item's pending add instead.
    STATE.audio = [{ id: 'ok', title: 'Landed', filename: 'ok.mp3', _uploaded: true }];
    stageChange('audio', { id: 'ok', label: 'Landed — new', kind: 'add' });
    expect(STATE.staged.audio).toBe(1);

    STATE.audio.unshift({ id: 'bad', title: 'Failed', filename: 'bad.mp3', _uploadError: 'boom' });
    trashItem('audio', 'bad');

    expect(STATE.staged.audio, "a failed upload's deletion is not a change").toBe(1);
    expect(stagedIdsFor('audio').has('ok'), "the landed track keeps its pending add").toBe(true);
  });

  it('trashing an imported item stages a remove row; restore cancels it', () => {
    STATE.audio = [{ id: 't1', title: 'Track', filename: 't1.mp3', _imported: true }];
    trashItem('audio', 't1');

    expect(STATE.staged.audio, 'a deletion of live content is a pending change').toBe(1);
    expect(STATE.stagedLog).toEqual([expect.objectContaining({
      surface: 'audio', ids: ['t1'], kind: 'remove', label: 'Track',
    })]);

    trashRestore(0);
    expect(STATE.staged.audio).toBe(0);
    expect(STATE.stagedLog).toHaveLength(0);
  });

  it('restoring an edited imported item brings its edit rows back', () => {
    // Edit a live frame, trash it, restore it: the edit is still on the entry,
    // so its protection row must come back too — without it the next sync
    // replaces the entry and the edit dies silently.
    STATE.buffer = [{ id: 'f1', filename: 'x.webp', focus: '30% 40%', _imported: true }];
    stageChange('buffer', { id: 'f1', label: 'f#241 — focal point' });

    trashItem('buffer', 'f1');
    trashRestore(0);

    expect(stagedIdsFor('buffer').has('f1'), 'the edit keeps its sync protection').toBe(true);
    expect(STATE.stagedLog.some((r) => r.kind === 'remove'), 'the deletion itself is cancelled').toBe(false);
  });
});

describe('persistence — dirty imported entries survive a reload', () => {
  it('save() keeps an imported entry that carries a ledger-tracked edit', () => {
    STATE.buffer = [
      { id: 'clean', filename: 'a.webp', _imported: true },
      { id: 'dirty', filename: 'b.webp', focus: '30% 40%', _imported: true },
      { id: 'local', filename: 'c.webp', _uploaded: true },
    ];
    stageChange('buffer', { id: 'dirty', label: 'f#2 — focal point' });

    save();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(stored.buffer.map((e) => e.id).sort(),
      'clean imported drops (re-syncs), dirty imported and local both persist')
      .toEqual(['dirty', 'local']);
    expect(stored.stagedLog, 'the ledger rides along in STATE').toHaveLength(1);
  });

  it('load() normalizes a pre-ledger saved state', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buffer: [], staged: STATE.staged }));
    STATE.stagedLog = undefined;
    load();
    expect(Array.isArray(STATE.stagedLog)).toBe(true);
  });
});

describe('stagedIdsFor — the derived protection set', () => {
  it('collects every id across a surface, and only that surface', () => {
    stageChange('buffer', { ids: ['a', 'b'], label: 'swap', kind: 'feature' });
    stageChange('buffer', { id: 'c', label: 'edit' });
    stageChange('archive', { id: 'd', label: 'other surface' });
    expect([...stagedIdsFor('buffer')].sort()).toEqual(['a', 'b', 'c']);
    expect(stagedIdsFor('archive').has('c')).toBe(false);
  });

  it('bumpStage alone contributes nothing — the counter is not the ledger', () => {
    bumpStage('buffer');
    expect(stagedIdsFor('buffer').size).toBe(0);
  });
});
