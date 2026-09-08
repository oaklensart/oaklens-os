// @vitest-environment happy-dom
//
// Delete-then-sync must stay deleted, and deleting the LAST item on a surface
// must be publishable.
//
// The failure this pins (found on a fork, 2026-08-11): trash the only audio
// track → publish is refused by the empty-overwrite guard (1 → 0 looks like a
// wipe) → the console auto-syncs to recover → the sync re-imports the track
// from main, resurrecting the deletion. A perfect loop; the track was
// undeletable. Two halves of the fix, each tested here:
//
//  · importIntoSurface skips ids sitting in the session trash — a pending
//    deletion is not a gap for the sync to refill.
//  · _vouchedEmptyManifests names the manifests emptied on purpose (trash
//    holds their previously-published items), which the publish sends as
//    `allowEmpty` so the worker guard can wave exactly those through.
//    (The worker half lives in tests/publish-guard.test.js.)
import { describe, it, expect, beforeEach } from 'vitest';

// console-state.js reaches these through the global scope at call time (the
// real console mirrors its renderers onto window) — stub before importing.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
// trashItem repaints the affected surface through the same globals.
for (const fn of ['renderBuffer', 'renderArchive', 'renderFN', 'fnNewPost',
  'renderWall', 'renderBarrel', 'renderNetwork', 'renderLibrary', 'renderAudio']) {
  globalThis[fn] = () => {};
}
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE, sessionTrash, trashItem } = await import('../js/console-state.js');
const { importIntoSurface, _vouchedEmptyManifests } = await import('../js/console-ui.js');

const SURFACES = ['buffer', 'archive', 'posts', 'wallpapers', 'barrel', 'friends', 'library', 'audio', 'cards'];

beforeEach(() => {
  document.body.innerHTML = '<div id="toast-host"></div>';
  SURFACES.forEach((s) => { STATE[s] = []; });
  STATE.staged = Object.fromEntries(SURFACES.map((s) => [s, 0]));
  sessionTrash.length = 0;
});

const track = (id) => ({ id, title: id, filename: `${id}.mp3`, _imported: true });

describe('importIntoSurface vs. the session trash', () => {
  it('does not resurrect a trashed item still present on main', () => {
    STATE.audio = [track('t1')];
    trashItem('audio', 't1');
    expect(STATE.audio).toHaveLength(0);

    // The deletion hasn't published, so main's manifest still lists t1.
    importIntoSurface('audio', [{ id: 't1', title: 't1', filename: 't1.mp3' }]);
    expect(STATE.audio).toHaveLength(0);
    expect(sessionTrash).toHaveLength(1);   // still restorable
  });

  it('still imports entries that are NOT in the trash', () => {
    STATE.audio = [track('t1')];
    trashItem('audio', 't1');

    importIntoSurface('audio', [
      { id: 't1', title: 't1', filename: 't1.mp3' },
      { id: 't2', title: 't2', filename: 't2.mp3' },
    ]);
    expect(STATE.audio.map((a) => a.id)).toEqual(['t2']);
  });

  it('trash on one surface never shields the same id on another', () => {
    STATE.audio = [track('t1')];
    trashItem('audio', 't1');

    importIntoSurface('barrel', [{ id: 't1', name: 'coincidence' }]);
    expect(STATE.barrel).toHaveLength(1);
  });
});

describe('_vouchedEmptyManifests', () => {
  it('vouches for a surface emptied by trashing its last published item', () => {
    STATE.audio = [track('t1')];
    trashItem('audio', 't1');
    expect(_vouchedEmptyManifests()).toEqual(['data/audio.json']);
  });

  it('vouches for nothing when the trash is empty (the state-loss wipe stays blocked)', () => {
    // STATE.audio empty but nothing in the trash — exactly what a session that
    // lost its data looks like. No vouch, so the worker guard still refuses.
    expect(_vouchedEmptyManifests()).toEqual([]);
  });

  it('does not vouch while the surface still has entries', () => {
    STATE.audio = [track('t1'), track('t2')];
    trashItem('audio', 't1');
    expect(_vouchedEmptyManifests()).toEqual([]);
  });

  it('trashing a never-published item vouches for nothing (nothing on main to overwrite)', () => {
    STATE.audio = [{ id: 'new1', title: 'new', filename: 'new.mp3', _uploaded: true }];
    trashItem('audio', 'new1');
    expect(_vouchedEmptyManifests()).toEqual([]);
  });
});
