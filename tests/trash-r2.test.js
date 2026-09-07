// Guards the fix for the "trash offers to restore permanently-deleted R2 files"
// bug. When a publish commit (or the manual purge) PERMANENTLY deletes an item's
// R2 variants, its sessionTrash row must lose its ↩ RESTORE affordance — the
// media is gone and the removal is committed to main, so a restore can't work.
// dropTrashForDeletedR2() is the surgical drop, keyed off the deletes that
// actually fired (so a deferred library delete keeps its still-valid restore).
import { describe, it, expect, beforeEach } from 'vitest';

// console-state.js calls renderTrash() through the global scope (the console
// mirrors UI renderers onto window at runtime); stub it before importing.
let renderCalls = 0;
globalThis.renderTrash = () => { renderCalls++; };

const { sessionTrash, dropTrashForDeletedR2, cancelPendingDeleteForKeys, _pendingR2Deletes, setPendingR2Deletes } =
  await import('../js/console-state.js');

function seedTrash(entries) {
  sessionTrash.length = 0;
  sessionTrash.push(...entries);
}

describe('dropTrashForDeletedR2', () => {
  beforeEach(() => { renderCalls = 0; sessionTrash.length = 0; });

  it('drops the trash row whose R2 objects were just deleted', () => {
    seedTrash([
      { surface: 'buffer', item: { id: 'f1' }, label: 'f1' },
      { surface: 'archive', item: { id: 'f2' }, label: 'f2' },
    ]);
    const dropped = dropTrashForDeletedR2([{ entryId: 'f1', keys: ['archive/f1-480w.webp'] }]);
    expect(dropped).toBe(1);
    expect(sessionTrash.map((t) => t.item.id)).toEqual(['f2']);
    expect(renderCalls).toBe(1);
  });

  it('keeps rows whose deletes did NOT fire (e.g. deferred library)', () => {
    seedTrash([
      { surface: 'library', item: { id: 'lib1' }, label: 'lib1' },
    ]);
    // Publish fires only the non-library deletes; the library one stays queued.
    const dropped = dropTrashForDeletedR2([{ entryId: 'f9' }]);
    expect(dropped).toBe(0);
    expect(sessionTrash.map((t) => t.item.id)).toEqual(['lib1']);
    expect(renderCalls).toBe(0);
  });

  it('drops several rows and re-renders once', () => {
    seedTrash([
      { surface: 'buffer', item: { id: 'a' }, label: 'a' },
      { surface: 'buffer', item: { id: 'b' }, label: 'b' },
      { surface: 'buffer', item: { id: 'c' }, label: 'c' },
    ]);
    const dropped = dropTrashForDeletedR2([{ entryId: 'a' }, { entryId: 'c' }]);
    expect(dropped).toBe(2);
    expect(sessionTrash.map((t) => t.item.id)).toEqual(['b']);
    expect(renderCalls).toBe(1);
  });

  it('is a no-op for empty inputs (no render, no throw)', () => {
    seedTrash([{ surface: 'buffer', item: { id: 'x' }, label: 'x' }]);
    expect(dropTrashForDeletedR2([])).toBe(0);
    expect(dropTrashForDeletedR2(undefined)).toBe(0);
    expect(dropTrashForDeletedR2([{ keys: ['k'] }])).toBe(0); // no entryId
    expect(sessionTrash).toHaveLength(1);
    expect(renderCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The other half of the queue's lifetime: a key that something LIVE takes back
// before the queued delete ever fires.
//
// The trap this closes: trash `x.mp3` (queues audio/x.mp3) → re-attach a new
// file with the same name → the upload overwrites that object → publish commits
// a registry pointing at it → the queue THEN deletes it. Every step reported
// success and the site was left with a manifest entry whose media was gone.
describe('cancelPendingDeleteForKeys', () => {
  beforeEach(() => { setPendingR2Deletes([]); });

  it('un-arms a queued delete when the same key is uploaded again', () => {
    setPendingR2Deletes([{ surface: 'audio', entryId: 'old', keys: ['audio/x.mp3'] }]);
    const dropped = cancelPendingDeleteForKeys(['audio/x.mp3']);
    expect(dropped).toBe(1);
    expect(_pendingR2Deletes, 'nothing left to delete, so no row survives').toHaveLength(0);
  });

  it('leaves other queued deletes alone', () => {
    setPendingR2Deletes([
      { surface: 'audio', entryId: 'a', keys: ['audio/keep.mp3'] },
      { surface: 'audio', entryId: 'b', keys: ['audio/x.mp3'] },
    ]);
    cancelPendingDeleteForKeys(['audio/x.mp3']);
    expect(_pendingR2Deletes.map((d) => d.entryId)).toEqual(['a']);
  });

  it('drops only the re-claimed key from a multi-variant entry', () => {
    // An image entry queues three variants; re-uploading one size must not
    // strand the other two as un-deletable orphans in R2.
    setPendingR2Deletes([{
      surface: 'archive', entryId: 'f1',
      keys: ['archive/f1-480w.webp', 'archive/f1-1024w.webp', 'archive/f1-2048w.webp'],
    }]);
    const dropped = cancelPendingDeleteForKeys(['archive/f1-1024w.webp']);
    expect(dropped).toBe(1);
    expect(_pendingR2Deletes[0].keys).toEqual([
      'archive/f1-480w.webp', 'archive/f1-2048w.webp',
    ]);
  });

  it('is a no-op for an empty or absent key list', () => {
    setPendingR2Deletes([{ surface: 'audio', entryId: 'a', keys: ['audio/x.mp3'] }]);
    expect(cancelPendingDeleteForKeys([])).toBe(0);
    expect(cancelPendingDeleteForKeys(undefined)).toBe(0);
    expect(_pendingR2Deletes).toHaveLength(1);
  });
});
