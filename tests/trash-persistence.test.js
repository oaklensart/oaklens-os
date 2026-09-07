// The session trash survives a reload.
//
// It is called "session" trash and for a long time it behaved like it: a
// refresh emptied it. That looked like losing one convenience — the ↩ RESTORE
// button — and it was actually losing three things, two of which are
// correctness, not convenience:
//
//   1. ↩ RESTORE. The layer-2 affordance the reversibility rule in CLAUDE.md
//      requires: one named control that undoes the gesture you just made.
//   2. importIntoSurface's resurrection guard. A trash row is what tells a sync
//      "this item is a PENDING DELETION, not a gap to refill" — main still
//      lists it until the deletion publishes. Lose the row and the next sync
//      brings the item back: delete → refresh → sync → it is back.
//   3. _vouchedEmptyManifests(). A deliberate 1 → 0 is vouched for by a trash
//      row holding the last _imported item. Lose the row and the publish
//      empty-overwrite guard 409s a legitimate publish — that is the
//      2026-08-12 last-track wedge, re-opened by a refresh.
//
// The blobs are stripped on the way out, exactly as save() strips them from
// STATE. That is not a compromise: a restored entry comes back the same way a
// non-trashed one does across a reload, so no new loss class is introduced.
import { describe, it, expect, beforeEach } from 'vitest';

// showToast bails on a missing toast zone, so a document with no elements is
// all the DOM this file needs — and keeping it out of happy-dom means our own
// localStorage stub below is the one the module sees.
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({}),
  addEventListener: () => {},
};
globalThis.confirm = () => true;

// console-state.js reaches its renderers through the global scope at call time
// (the real console mirrors them onto window) — stub the family before importing.
for (const fn of [
  'renderTrash', 'refreshStageIndicators', 'renderBuffer', 'renderArchive',
  'renderFN', 'fnNewPost', 'renderWall', 'renderBarrel', 'renderNetwork',
  'renderLibrary', 'renderAudio', 'showView', 'scheduleLibrarySync',
  'updatePurgeR2Button', 'isVideoAsset',
]) globalThis[fn] = () => {};

// A localStorage the module can actually write to. The rest of save()'s work
// (STATE serialization) rides along harmlessly.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  STATE, sessionTrash, trashItem, trashRestore, dropTrashForDeletedR2,
  persistSessionTrash, load, save,
} = await import('../js/console-state.js');

const KEY = 'oaklens_session_trash';
const read = () => JSON.parse(store.get(KEY) || '[]');

beforeEach(() => {
  store.clear();
  sessionTrash.length = 0;
  STATE.audio = [];
  STATE.buffer = [];
  STATE.stagedLog = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0, audio: 0 };
});

describe('writing', () => {
  it('persists a trashed item under its own key, not inside STATE', () => {
    // Its own key for the same reason the R2 queue has one: the ~5MB STATE
    // budget is the thing that fails silently first.
    STATE.audio = [{ id: 'a1', slug: 'ep-001', filename: 'ep-001.mp3', title: 'One', _imported: true }];
    trashItem('audio', 'a1');
    const rows = read();
    expect(rows).toHaveLength(1);
    expect(rows[0].surface).toBe('audio');
    expect(rows[0].item.id).toBe('a1');
    expect(store.get('oaklens_console_v01')).not.toContain('"deletedAt"');
  });

  it('strips base64 blobs, which is what makes it affordable at all', () => {
    STATE.buffer = [{ id: 'f1', filename: 'f1.jpg', image: 'data:image/jpeg;base64,AAAA', hero: 'data:x', src: 'data:y' }];
    trashItem('buffer', 'f1');
    const item = read()[0].item;
    expect(item.image).toBeUndefined();
    expect(item.hero).toBeUndefined();
    expect(item.src).toBeUndefined();
    // Everything that identifies the entry survives — a restore needs the
    // metadata, and the picture re-draws from the CDN.
    expect(item.id).toBe('f1');
    expect(item.filename).toBe('f1.jpg');
  });

  it('keeps a non-data src rather than stripping every field with that name', () => {
    STATE.buffer = [{ id: 'f1', src: '/wallpaper/f1.webp' }];
    trashItem('buffer', 'f1');
    expect(read()[0].item.src).toBe('/wallpaper/f1.webp');
  });

  it('clears the key when the trash empties, rather than leaving a stale array', () => {
    STATE.audio = [{ id: 'a1', filename: 'a.mp3' }];
    trashItem('audio', 'a1');
    expect(store.has(KEY)).toBe(true);
    trashRestore(0);
    expect(store.has(KEY)).toBe(false);
  });

  it('persists from the publish path without a full STATE write', () => {
    // dropTrashForDeletedR2 runs mid-publish. It must not route a storage
    // failure through save()'s error latch and toast, which are UI.
    sessionTrash.push({ surface: 'audio', item: { id: 'a1' }, label: 'a1' },
                      { surface: 'audio', item: { id: 'a2' }, label: 'a2' });
    persistSessionTrash();
    expect(read()).toHaveLength(2);
    dropTrashForDeletedR2([{ entryId: 'a1' }]);
    expect(read().map((r) => r.item.id)).toEqual(['a2']);
  });
});

describe('reading back', () => {
  it('restores the rows on load, so a refresh keeps the pending deletion', () => {
    STATE.audio = [{ id: 'a1', slug: 'ep-001', filename: 'ep-001.mp3', _imported: true }];
    trashItem('audio', 'a1');
    // …the tab reloads.
    sessionTrash.length = 0;
    load();
    expect(sessionTrash).toHaveLength(1);
    expect(sessionTrash[0].item.id).toBe('a1');
    expect(sessionTrash[0].surface).toBe('audio');
  });

  it('keeps the ledger stash, so a restore still owes the right count back', () => {
    // `cancelled` and `ledgerRows` are what make ↩ RESTORE reinstate the exact
    // gestures the trash cancelled. A row that survives the reload without them
    // restores wrongly, which is worse than not restoring.
    STATE.audio = [{ id: 'a1', filename: 'a.mp3' }];
    STATE.stagedLog = [{ surface: 'audio', ids: ['a1'], kind: 'add', n: 3 }];
    STATE.staged.audio = 3;
    trashItem('audio', 'a1');
    sessionTrash.length = 0;
    load();
    expect(sessionTrash[0].cancelled).toBe(3);
    expect(sessionTrash[0].ledgerRows).toHaveLength(1);
  });

  it('drops a shapeless row rather than handing readers a broken record', () => {
    // Every reader assumes `.item.id` and `.surface`. Storage is editable by
    // anyone with devtools, and rows written before this shipped do not exist —
    // either way the safe answer is to skip the row, not to crash the console
    // on boot.
    store.set(KEY, JSON.stringify([
      { surface: 'audio', item: { id: 'ok' } },
      { surface: 'audio' },
      { item: { id: 'no-surface' } },
      null,
      'garbage',
    ]));
    load();
    expect(sessionTrash.map((t) => t.item.id)).toEqual(['ok']);
  });

  it('treats unreadable storage as an empty trash instead of throwing', () => {
    store.set(KEY, '{not json');
    expect(() => load()).not.toThrow();
    expect(sessionTrash).toHaveLength(0);
  });
});

describe('what a wipe means', () => {
  it('clears the persisted trash too, or a reload repopulates it', async () => {
    STATE.audio = [{ id: 'a1', filename: 'a.mp3' }];
    trashItem('audio', 'a1');
    const { resetConsole } = await import('../js/console-state.js');
    resetConsole();
    expect(store.has(KEY)).toBe(false);
    expect(store.has('oaklens_pending_r2_deletes')).toBe(false);
  });
});
