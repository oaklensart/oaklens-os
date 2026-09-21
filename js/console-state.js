// OAKLENS // FIELD CONSOLE — state core (ES module).
//
// Phase 3 of the console decomposition: the in-memory STATE, its localStorage
// persistence, stage counters, session trash, the pending R2-delete queue, and
// persisted UI preferences (sidebar) live here. dev/field-console.html imports
// this module and mirrors its exports onto window, so the remaining classic
// script and inline on*-handlers keep working unchanged.
//
// Network calls go through js/console-api.js (real import below).
//
// Toasts + error latching route through js/console-telemetry.js (imported).
//
// Transitional coupling: functions here still call rendering globals that
// js/console-ui.js defines (refreshStageIndicators, renderTrash, the render*
// family incl. renderAudio, showView, fnNewPost, isVideoAsset,
// scheduleLibrarySync, updatePurgeR2Button). Those resolve through the global
// scope at call time.
//
// Mutable-array contract: sessionTrash and _pendingR2Deletes are const arrays
// mutated in place (never reassigned), so the module bindings and the window
// mirrors are always the same object. Replace contents via setPendingR2Deletes
// or .length = 0 — never with `= []`.

import { deleteAssets, isLoggedIn } from './console-api.js';
import { showToast, latchError } from './console-telemetry.js';

// ============== STATE ==============
export const STATE = {
  buffer:     [],   // {id, image (dataURL), filename, captured_at, published_at, archived: false}
  archive:    [],   // {id, image, filename, title, sub, location, camera, lens, medium, hash, slug, added_at}
  posts:      [],   // {id, fn_id, title, location, date, body (markdown), added_at}
  wallpapers: [],   // {id, src, filename, title, desc, isNew}
  friends:    [],   // {id, name, tag, location, url, added_at} — About §004 NETWORK / FRIENDS OF
  library:    [],   // {id, filename, hash, added_at, _uploaded, _uploading, _uploadError} — pre-staged, never published
  audio:      [],   // {id, slug, filename, title, sub, duration, peaks, featured, episode, download, added_at}
  // Saved audio sets — a named, ordered list of tracks referenced BY SLUG, with
  // its own permanent address (/listen/?set=<slug>). Its own surface rather
  // than a second record shape inside `audio`, because a set is not a track:
  // every public consumer of the registry already discriminates on `filename`
  // to skip retired tombstones, and a second filename-less record kind would
  // ride through that guard by accident.
  // {id, slug, name, tracks: [slug], added_at, retired, retired_at}
  audioSets:  [],
  // Composed homepage cards — the owner's own, overlaid on the automatic grid.
  // {id, order, source, media, folder, focus, cardFocus, title, tease, label, link, card, img, added_at}
  cards:      [],
  staged:     {     // tracks unpublished changes per surface
    buffer: 0, archive: 0, posts: 0, wallpapers: 0, friends: 0, library: 0, audio: 0,
    audioSets: 0, cards: 0
  },
  stagedLog:  []    // per-ITEM ledger of those changes — see STAGE TRACKING below
};

export const STORAGE_KEY = "oaklens_console_v01";

// ============== R2 CLEANUP QUEUE ==============
// Tracks R2 keys to delete when publishing or library auto-syncing.
// Entries: { keys: [...], surface: 'buffer'|'archive'|..., entryId: '...' }
export const _pendingR2Deletes = [];

// Replace the queue's contents in place (identity-preserving — see header).
export function setPendingR2Deletes(items) {
  _pendingR2Deletes.length = 0;
  _pendingR2Deletes.push(...items);
}

// Un-arm a queued R2 delete when something LIVE has taken that key back.
//
// The queue is armed at trash time and fires AFTER the publish commit, so a
// key can be re-claimed in between: trash `x.mp3` (queues `audio/x.mp3`) →
// re-attach a new `x.mp3` → the upload overwrites the same object → publish
// commits a registry pointing at it → the queue then deletes it. The site is
// left with a manifest entry whose media is gone, and the console shows no
// error because every step "succeeded".
//
// Called from the upload path, so the rule is simply: uploading a key is a
// statement that you want the object at that key. Surface-general on purpose —
// the same trap bites a re-added photo whose basename matches a trashed one.
export function cancelPendingDeleteForKeys(keys) {
  if (!keys || !keys.length) return 0;
  const claimed = new Set(keys);
  let dropped = 0;
  const kept = [];
  for (const d of _pendingR2Deletes) {
    const survivors = (d.keys || []).filter(k => !claimed.has(k));
    dropped += (d.keys || []).length - survivors.length;
    // An entry whose every key has been re-claimed has nothing left to delete.
    if (survivors.length) kept.push({ ...d, keys: survivors });
  }
  if (dropped) setPendingR2Deletes(kept);
  return dropped;
}

// ============== PERSISTENCE ==============
export function save() {
  try {
    // Strip base64 image blobs before saving — they eat localStorage
    const lean = JSON.parse(JSON.stringify(STATE));
    lean.buffer.forEach(b => { delete b.image; });
    lean.archive.forEach(a => { delete a.image; });
    lean.posts.forEach(p => { if (p.hero && p.hero.startsWith("data:")) delete p.hero; });
    lean.wallpapers.forEach(w => { if (w.src && w.src.startsWith("data:")) delete w.src; });
    lean.library.forEach(l => { delete l.image; });

    // Drop imported entries — they re-sync from GitHub on next login, so spending
    // the (~5MB) localStorage budget persisting them risks a silent quota failure
    // that loses locally-created entries. Library now syncs from GitHub too (and
    // auto-publishes on change), so its imported entries are safe to drop as well —
    // locally-created library entries carry no _imported flag and are kept here as
    // a fallback until the next sync re-imports them.
    //
    // EXCEPT the dirty ones: an imported entry with a ledger-tracked
    // unpublished edit is the only copy of that edit anywhere — the next login
    // sync would re-import the PRE-edit version from main. Keeping just those
    // (blobs already stripped above, row count capped by LEDGER_CAP) costs
    // almost nothing and closes the reload half of the 2026-08-23
    // first-publish settings loss.
    const keep = (surface) => {
      const dirty = stagedIdsFor(surface);
      return (e) => !e._imported || dirty.has(e.id);
    };
    lean.buffer = lean.buffer.filter(keep('buffer'));
    lean.archive = lean.archive.filter(keep('archive'));
    lean.wallpapers = lean.wallpapers.filter(keep('wallpapers'));
    lean.friends = lean.friends.filter(keep('friends'));
    lean.posts = lean.posts.filter(keep('posts'));
    lean.library = lean.library.filter(keep('library'));
    lean.audio = (lean.audio || []).filter(keep('audio'));
    lean.audioSets = (lean.audioSets || []).filter(keep('audioSets'));
    lean.cards = (lean.cards || []).filter(keep('cards'));

    const json = JSON.stringify(lean);
    const sizeKB = Math.round(json.length / 1024);

    localStorage.setItem(STORAGE_KEY, json);

    // Persist pending R2 deletions so queued cleanups survive tab closes.
    // Stored separately to avoid bloating the main STATE budget.
    try {
      if (_pendingR2Deletes.length) {
        localStorage.setItem('oaklens_pending_r2_deletes', JSON.stringify(_pendingR2Deletes));
      } else {
        localStorage.removeItem('oaklens_pending_r2_deletes');
      }
    } catch { /* non-critical — main STATE was already saved */ }

    // Session trash, on the same terms and for a much bigger reason than the
    // ↩ RESTORE button. Three things read it, and a reload used to silently
    // drop all three:
    //   1. ↩ RESTORE — the layer-2 affordance the reversibility rule requires.
    //   2. importIntoSurface's `trashedIds` guard — without it, the next sync
    //      RESURRECTS an item you deleted (delete → refresh → sync → it's back).
    //   3. _vouchedEmptyManifests() — a deliberate 1 → 0 is vouched for by a
    //      trash row holding the last _imported item. Lose the row and the
    //      empty-overwrite guard 409s a legitimate publish. That is the
    //      2026-08-12 last-track wedge, re-opened by a refresh.
    // Blobs are stripped exactly as above: a restored entry comes back the same
    // way a non-trashed one does across a reload, so this adds no new loss.
    persistSessionTrash();

    // Warn when approaching 4MB (localStorage limit is ~5MB)
    if (sizeKB > 4000) {
      console.warn(`[save] localStorage: ${sizeKB}KB — approaching 5MB limit`);
      showToast(`⚠ Storage: ${sizeKB}KB / ~5000KB — consider clearing old buffer entries`, { kind: 'error' });
    }
  } catch (e) {
    console.error('[save] localStorage write failed:', e);
    latchError('storage', 'localStorage full — data NOT saved');
    showToast("⚠ localStorage full — data NOT saved. Clear old entries or export.", { kind: 'error' });
  }
}
export function load() {
  // ⚠️ `return` here would abort the WHOLE function, not just this block —
  // and everything below it (the session trash, the R2 delete queue, the
  // interrupted-upload reconciliation) is restored from OTHER keys. A console
  // whose STATE key is absent or unreadable still has those to restore, and
  // silently skipping them is the failure this shape invites. Guard the block,
  // never the function.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(STATE, JSON.parse(raw));
  } catch(e){ console.warn("load failed", e); }
  // States saved before the ledger existed have no stagedLog key (or a
  // corrupted one) — normalize so every reader can assume an array.
  if (!Array.isArray(STATE.stagedLog)) STATE.stagedLog = [];
  // Same for the sets shelf: a state saved before sets existed simply has no
  // audioSets key (Object.assign leaves the default standing), but a corrupted
  // or hand-edited one could put a non-array where every reader assumes one.
  if (!Array.isArray(STATE.audioSets)) STATE.audioSets = [];

  // The barrel was retired 2026-09-20. Object.assign above copies whatever the
  // saved blob holds, so a session saved before that date puts `barrel` and
  // `staged.barrel` BACK onto a STATE that no longer declares them — and a
  // non-zero counter there is a pending-changes badge for a surface that can
  // never publish and so can never clear. Drop all three shapes; the next
  // save() writes the state without them and this stops mattering per browser.
  delete STATE.barrel;
  if (STATE.staged) delete STATE.staged.barrel;
  STATE.stagedLog = STATE.stagedLog.filter(r => r && r.surface !== 'barrel');

  // Restore the session trash BEFORE anything reads it — importIntoSurface's
  // resurrection guard and _vouchedEmptyManifests both consult it, and a login
  // sync can run before the first render.
  try {
    const trashRaw = localStorage.getItem('oaklens_session_trash');
    if (trashRaw) {
      const restored = JSON.parse(trashRaw);
      if (Array.isArray(restored) && restored.length) {
        sessionTrash.length = 0;
        // Rows written before this shipped, or hand-edited storage, must not
        // put a shapeless object where every reader expects `.item.id`.
        sessionTrash.push(...restored.filter((t) => t && t.item && t.item.id && t.surface));
      }
    }
  } catch { /* non-critical — an unreadable trash is an empty trash */ }

  // Restore persisted R2 deletion queue (survives tab close)
  try {
    const r2Raw = localStorage.getItem('oaklens_pending_r2_deletes');
    if (r2Raw) {
      const restored = JSON.parse(r2Raw);
      if (Array.isArray(restored) && restored.length) {
        setPendingR2Deletes(restored);
        console.log(`[load] restored ${restored.length} pending R2 deletion(s)`);
      }
    }
  } catch { /* non-critical */ }

  // Reconcile uploads interrupted by a reload/tab kill. The upload queue holds
  // generated variants in memory only, so an entry still flagged _uploading
  // after a restart has NO upload behind it and never will — the image bytes
  // are gone (iOS jetsams backgrounded PWA tabs; no blob persistence by
  // design). Convert to a visible failure so the publish gates block it, the
  // frame shows ✕ FAILED, and the user knows exactly which files to re-drop.
  // Without this, the entry would sail through publish and commit a filename
  // pointing at a CDN object that doesn't exist.
  let interrupted = 0;
  for (const surface of ['buffer', 'archive', 'wallpapers', 'library', 'audio']) {
    for (const e of STATE[surface] || []) {
      if (e && e._uploading) {
        delete e._uploading;
        e._uploadError = 'interrupted by reload — re-drop this file';
        interrupted++;
      }
    }
  }
  if (interrupted) {
    const n = interrupted, pl = n > 1 ? 's' : '';
    latchError('upload', `${n} upload${pl} interrupted by reload — re-drop the ✕ FAILED frame${pl}`);
    showToast(`⚠ ${n} upload${pl} interrupted by reload — marked ✕ FAILED, re-drop to recover`, { kind: 'error' });
  }
}

// ============== STAGE TRACKING ==============
export function bumpStage(surface, delta) {
  if (delta === undefined) delta = 1;
  STATE.staged[surface] = Math.max(0, (STATE.staged[surface] || 0) + delta);
  refreshStageIndicators();
  save();
}

// The staged-change LEDGER. STATE.staged counts gestures ("+3 ▲"); the ledger
// records which ITEMS those gestures touched, so the publish view can list
// changes by name and — load-bearing, not cosmetic — so sync and save() know
// which _imported entries carry unpublished local edits and must not be
// replaced by the remote copy or dropped from localStorage (the 2026-08-23
// first-publish settings loss). One row per (surface, primary id); repeated
// gestures on the same item fold into the row's `n` rather than adding rows,
// which keeps the counters' one-gesture-one-bump law untouched while the list
// stays readable.
//
// Row: { surface, ids, label, kind: 'add'|'edit'|'remove'|'feature', n, ts }
//   ids   — entry ids the change touches; [0] is primary (the dedupe key).
//           The featured swap passes [newId, prevId]: both entries changed,
//           both need sync protection.
//   label — composed by the CALLER (it knows frame numbers and titles; this
//           module deliberately knows nothing above itself).
export const LEDGER_CAP = 200;   // rows; counters stay authoritative past it

export function stageChange(surface, meta = {}) {
  const { id, ids, label, kind = 'edit', delta = 1 } = meta;
  const idList = ids || (id !== undefined && id !== null ? [id] : []);
  if (idList.length) {
    const row = STATE.stagedLog.find(r => r.surface === surface && r.ids[0] === idList[0]);
    if (row) {
      row.n += 1;
      row.ts = Date.now();
      if (label) row.label = label;
      row.kind = kind;   // the latest change wins the glyph
      row.ids = [...new Set([...row.ids, ...idList])];
    } else {
      STATE.stagedLog.push({
        surface, ids: idList,
        label: label || surface + ' item',
        kind, n: 1, ts: Date.now(),
      });
      if (STATE.stagedLog.length > LEDGER_CAP) STATE.stagedLog.shift();
    }
  }
  bumpStage(surface, delta);   // bumpStage runs the indicator refresh + save
}

/**
 * The exact reverse of ONE stageChange: give back the gesture it counted, and
 * put the ledger row back the way it was.
 *
 * A caller cannot just delete the row. `stageChange` FOLDS repeated gestures on
 * an item into one row — bumping `n`, refreshing `ts`, overwriting `label`, and
 * letting the newest `kind` win the glyph — so the row after an edit may be a
 * pre-existing row that now reads differently. Deleting it would silently
 * discard the item's earlier pending changes and un-protect it from the next
 * sync (the 2026-08-23 loss class). So the caller snapshots the row BEFORE the
 * gesture and hands it back here; `null` means there was no row, and the row
 * the gesture created goes.
 *
 * This is layer 1 of the reversibility rule (CLAUDE.md): the reverse runs
 * through the same accounting as the forward gesture, so the counters stay
 * honest by construction rather than by arithmetic that has to be got right
 * twice.
 *
 * @param {string} surface
 * @param {string} id primary entry id — the ledger's dedupe key
 * @param {object|null} rowSnapshot deep copy of the row before the gesture
 */
export function unstageChange(surface, id, rowSnapshot = null) {
  const i = STATE.stagedLog.findIndex(r => r.surface === surface && r.ids[0] === id);
  if (rowSnapshot) {
    if (i >= 0) STATE.stagedLog[i] = rowSnapshot;
    else STATE.stagedLog.push(rowSnapshot);
  } else if (i >= 0) {
    STATE.stagedLog.splice(i, 1);
  }
  bumpStage(surface, -1);   // bumpStage runs the indicator refresh + save
}

/**
 * Restore a surface's ledger row to a prior SNAPSHOT — the reverse of a whole
 * EDIT SESSION rather than of a single stageChange (that is unstageChange). An
 * edit can fold several counted gestures onto one row (typing, then a layout
 * pick), so the counter reversal is the EXACT delta — (snapshot gestures −
 * current gestures), read off each row's `n` — never a flat −1. `rowSnapshot`
 * null means there was no row before: the row and every gesture it counted go.
 *
 * Like unstageChange, this belongs to the ledger and NOT to a surface — a
 * surface's every gesture is +1, and the one place allowed to hand a change back
 * is here (tests/guards.test.js pins that boundary). bumpStage runs the indicator
 * refresh and the save, so the on-screen "PENDING" badge cannot go stale.
 *
 * @param {string} surface
 * @param {string} id primary entry id — the ledger's dedupe key
 * @param {object|null} rowSnapshot deep copy of the row before the edit began
 */
export function restoreStagedRow(surface, id, rowSnapshot = null) {
  const i = STATE.stagedLog.findIndex(r => r.surface === surface && r.ids[0] === id);
  const curN = i >= 0 ? (STATE.stagedLog[i].n || 1) : 0;
  const preN = rowSnapshot ? (rowSnapshot.n || 1) : 0;
  if (rowSnapshot) {
    const copy = JSON.parse(JSON.stringify(rowSnapshot));
    if (i >= 0) STATE.stagedLog[i] = copy; else STATE.stagedLog.push(copy);
  } else if (i >= 0) {
    STATE.stagedLog.splice(i, 1);
  }
  bumpStage(surface, preN - curN);   // exact reversal; bumpStage refreshes + saves
}

/** The ledger row a gesture is about to fold into, deep-copied for the reverse. */
export function ledgerRowFor(surface, id) {
  const row = STATE.stagedLog.find(r => r.surface === surface && r.ids[0] === id);
  return row ? JSON.parse(JSON.stringify(row)) : null;
}

// Every id on a surface with a ledger-tracked unpublished change. Derived on
// demand, never stored — the protection set importIntoSurface and save() key on.
export function stagedIdsFor(surface) {
  const out = new Set();
  for (const r of STATE.stagedLog) {
    if (r.surface === surface) r.ids.forEach(i => out.add(i));
  }
  return out;
}

export function clearStage() {
  Object.keys(STATE.staged).forEach(k => STATE.staged[k] = 0);
  STATE.stagedLog.length = 0;
  refreshStageIndicators();
  save();
}
export function totalStaged() {
  // Library is a staging area only — it never publishes, so it doesn't
  // contribute to the "pending changes" count surfaced in the publish UI.
  return Object.entries(STATE.staged)
    .filter(([surface]) => surface !== 'library')
    .reduce((sum, [, n]) => sum + n, 0);
}

// ============== SESSION TRASH ==============
export const sessionTrash = [];

// A trash row, minus the base64 blobs — the same four fields save() strips from
// STATE, for the same reason (the ~5MB localStorage budget). A restored entry
// therefore comes back exactly as a non-trashed one does across a reload:
// _imported and _uploaded items re-draw from the CDN, and a never-uploaded local
// item loses its preview either way. No new loss class, one smaller record.
function _leanTrashRow(t) {
  const item = { ...t.item };
  delete item.image;
  if (typeof item.hero === 'string' && item.hero.startsWith('data:')) delete item.hero;
  if (typeof item.src === 'string' && item.src.startsWith('data:')) delete item.src;
  return { ...t, item };
}

/**
 * Write the trash to its own storage key. Standalone rather than only inside
 * save(), so the two callers that mutate the trash from the PUBLISH path
 * (dropTrashForDeletedR2, trashClearAll) can persist without dragging a full
 * STATE serialization — and, more importantly, without routing a storage
 * failure through save()'s error latch and toast, which are UI.
 *
 * Swallows everything: a trash that cannot be written is worth strictly less
 * than the publish it must not interrupt.
 */
export function persistSessionTrash() {
  try {
    if (sessionTrash.length) {
      localStorage.setItem('oaklens_session_trash', JSON.stringify(sessionTrash.map(_leanTrashRow)));
    } else {
      localStorage.removeItem('oaklens_session_trash');
    }
  } catch { /* non-critical */ }
}

export function trashItem(surface, id) {
  const arr = STATE[surface];
  const idx = arr.findIndex(x => x.id === id);
  if (idx < 0) return;
  const [removed] = arr.splice(idx, 1);
  const label = removed.title || removed.fn_id || removed.filename || (surface + " item");

  // Ledger mirror of the ± logic below. A never-published item's rows are the
  // pending add + edits this trash cancels — pull them out, but STASH them on
  // the trash record so ↩ RESTORE can reinstate them exactly. An imported
  // item's rows describe edits to something that no longer exists locally;
  // the one true pending change is now the deletion itself.
  const ledgerRows = [];
  for (let i = STATE.stagedLog.length - 1; i >= 0; i--) {
    const r = STATE.stagedLog[i];
    if (r.surface === surface && r.ids[0] === id) {
      ledgerRows.unshift(...STATE.stagedLog.splice(i, 1));
    }
  }

  // How many staged gestures this trash actually cancels. Counted from the
  // ledger rows we just harvested rather than assumed to be 1, because both
  // assumptions were wrong:
  //   - a FAILED upload never staged anything (stageChange only fires on upload
  //     success, js/console/upload.js), so the old flat -1 silently cancelled
  //     some OTHER item's pending add;
  //   - an item edited three times then trashed staged +3 and un-staged -1,
  //     leaving the counter permanently high.
  // Staging counts gestures, not things — so the cancellation has to count them
  // too. `n` is the fold count stageChange keeps on a repeated row.
  const cancelled = ledgerRows.reduce((sum, r) => sum + (r.n || 1), 0);

  sessionTrash.unshift({
    surface,
    item: removed,
    deletedAt: new Date().toLocaleTimeString(),
    label,
    ledgerRows,
    cancelled,
  });
  // Imported items were already published — trashing them is a new pending deletion (+1).
  // Newly-added items (never published) — trashing cancels exactly the gestures
  // they staged, which may be zero (a failed upload) or many (an edited draft).
  if (removed._imported) {
    stageChange(surface, { id, label, kind: 'remove' });
  } else if (cancelled) {
    bumpStage(surface, -cancelled);
  }

  // ⚠️ A COMPOSED CARD NEVER QUEUES AN R2 DELETE. Its picture is always either
  // shared with the entry it was picked from (an archive frame, a wallpaper) or
  // a library asset that defers its own delete — so deleting the card must not
  // take the object with it. Deleting a card removes a PRESENTATION, never a
  // picture. (It would not match the guard below anyway, since a card names its
  // image in `media` rather than `filename`; saying so here is cheaper than
  // rediscovering why it matters.)
  //
  // Queue R2 cleanup for uploaded items
  if (surface !== 'cards' && (removed._uploaded || removed._imported) && removed.filename) {
    const base = removed.filename.replace(/\.[^.]+$/, '');
    let keys;
    if (surface === 'audio') {
      // One canonical object per track — no derived variants to chase, which
      // is the whole reason audio lives in its own flat prefix.
      keys = [`audio/${removed.filename}`];
    } else if (surface === 'library' && isVideoAsset(removed)) {
      // Video assets live under videos/ as the original clip + a poster webp
      keys = [
        `videos/${removed.filename}`,
        `videos/posters/${base}.webp`,
      ];
    } else {
      const folder = surface === 'wallpapers' ? 'wallpaper' : 'archive';
      keys = [
        `${folder}/${base}-480w.webp`,
        `${folder}/${base}-1024w.webp`,
        `${folder}/${base}-2048w.webp`,
      ];
      if (surface === 'wallpapers' && removed.fullres) {
        keys.push(`wallpaper/full/${removed.fullres}`);
      }
    }
    _pendingR2Deletes.push({ keys, surface, entryId: removed.id });
  }

  save();
  renderTrash();
  // Re-render affected surface
  // ⚠️ Read off the global, every one of them. This module's header says the
  // render* family "resolve through the global scope at call time", and until
  // 2026-09-07 this map did not honour it: eight bare identifiers, all evaluated
  // while BUILDING the object, so a renderer that happened not to be defined
  // threw a ReferenceError that took down the whole delete gesture — not just
  // the repaint it was reaching for. The `?.()` below was already written to
  // tolerate a missing renderer; this makes that tolerance real.
  const R = globalThis;
  const renderers = {
    buffer: R.renderBuffer,
    archive: R.renderArchive,
    posts: () => { R.renderFN?.(); R.fnNewPost?.(); },
    wallpapers: R.renderWall,
    friends: R.renderNetwork,
    library: R.renderLibrary,
    audio: R.renderAudio,
    audioSets: R.renderAudioSets,
    cards: R.renderCards,
  };
  renderers[surface]?.();
  showToast("Moved to trash: " + sessionTrash[0].label, { kind: 'warning' });
}

export function trashRestore(trashIndex) {
  const trashed = sessionTrash.splice(trashIndex, 1)[0];
  if (!trashed) return;
  STATE[trashed.surface].unshift(trashed.item);
  // Reverse of trashItem, ledger included: restoring a published item cancels
  // the pending deletion (-1, and its 'remove' row goes); restoring a new item
  // reinstates the pending add (+1). EITHER way the rows stashed at trash time
  // come back — for an imported item they are its unpublished edits, and
  // without them the next sync would replace the restored entry and eat those
  // edits (the exact loss class this ledger exists to close).
  if (trashed.item._imported) {
    for (let i = STATE.stagedLog.length - 1; i >= 0; i--) {
      const r = STATE.stagedLog[i];
      if (r.surface === trashed.surface && r.ids[0] === trashed.item.id && r.kind === 'remove') {
        STATE.stagedLog.splice(i, 1);
      }
    }
  }
  if (Array.isArray(trashed.ledgerRows) && trashed.ledgerRows.length) {
    STATE.stagedLog.push(...trashed.ledgerRows);
  }
  // Mirror of the count trashItem cancelled — not a flat 1. A restored draft
  // that carried three staged edits owes three gestures back, and a restored
  // failed upload owes none. `cancelled` is absent on rows trashed before this
  // shipped, so fall back to the old behaviour for them.
  const owed = trashed.cancelled == null ? 1 : trashed.cancelled;
  bumpStage(trashed.surface, trashed.item._imported ? -1 : owed);
  // ⚠️ RANKS STAY UNIQUE. A composed card carries `order` — a rank, never a slot
  // index — and every card mutator recompacts so the row can have no holes and
  // no ties. Restoring one puts its OLD rank back into a row that may have moved
  // on (a card composed since took the rank it vacated), and two cards sharing
  // `order: 1` leaves the grid sorting them by whatever the array happens to
  // hold. Recompact on the way back in: the restored card keeps its place, and
  // everything after it shifts down by one the way a fresh insert would.
  if (trashed.surface === 'cards') {
    STATE.cards
      .slice()
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .forEach((c, i) => { c.order = i + 1; });
  }
  // Cancel any queued R2 deletion for this item
  setPendingR2Deletes(_pendingR2Deletes.filter(d => d.entryId !== trashed.item.id));
  save();
  if (trashed.surface === 'library') scheduleLibrarySync();
  renderBuffer(); renderArchive(); renderFN();
  renderWall(); renderNetwork(); renderLibrary(); renderAudio(); renderTrash();
  globalThis.renderCards?.();
  showToast("Restored: " + trashed.label, { kind: 'success' });
}

export function trashClearAll() {
  if (!sessionTrash.length) return;
  if (!confirm("Permanently discard " + sessionTrash.length + " trashed item(s)?")) return;

  // Determine which R2 deletions can fire immediately vs. must wait for publish.
  // - Non-imported items: safe to delete now (no live JSON reference).
  // - Imported LIBRARY items: also safe — library is never rendered on the live site,
  //   and autoSyncLibrary() already committed the updated index.
  // - Imported non-library items (archive/buffer/wall): defer to publish —
  //   their R2 files are still referenced by the live site until the JSON is committed.
  if (_pendingR2Deletes.length && isLoggedIn()) {
    const immediateIds = new Set(
      sessionTrash
        .filter(t => !t.item._imported || t.surface === 'library')
        .map(t => t.item.id)
    );
    const immediateDeletes = _pendingR2Deletes.filter(d => immediateIds.has(d.entryId));
    const deferredDeletes = _pendingR2Deletes.filter(d => !immediateIds.has(d.entryId));

    if (immediateDeletes.length) {
      const keys = immediateDeletes.flatMap(d => d.keys);
      // "keys cleared", never "removed": R2's delete is idempotent, so
      // data.deleted counts delete calls that succeeded — a cleared key
      // verifiably no longer exists, but may never have (e.g. a failed upload).
      deleteAssets(keys)
        .then(data => showToast(`✓ R2 cleanup: ${(data.deleted || []).length} keys cleared`, { kind: 'success' }))
        .catch(err => showToast(`⚠ R2 cleanup ${err.status ? 'error' : 'failed'}: ${err.message}`, { kind: 'error' }));
    }

    setPendingR2Deletes(deferredDeletes);
    save();  // persist updated queue

    if (deferredDeletes.length) {
      const deferredKeys = deferredDeletes.flatMap(d => d.keys).length;
      showToast(`Trash emptied · ${deferredKeys} R2 objects queued for next publish`, { kind: 'warning' });
    }
  }

  sessionTrash.length = 0;
  persistSessionTrash();   // the emptied trash is persisted state now
  renderTrash();
  if (!_pendingR2Deletes.length) showToast("Trash emptied", { kind: 'success' });
  updatePurgeR2Button();
}

// Once an item's R2 variants are PERMANENTLY deleted — the publish commit fires
// the queued deletes, or the owner drains them via "Purge Queued R2" — its
// sessionTrash entry can no longer be restored: the media is gone for good and
// (for published/live surfaces) the removal is already committed to main. Leaving
// a ↩ RESTORE button on it is the bug the owner hit — the trash offering to
// "restore" frames whose R2 files no longer exist. Drop the matching entries so
// the affordance disappears exactly when it stops being real. Keyed off the
// deletes that ACTUALLY fired, so a trashed library item (its R2 delete is
// deferred, not fired here) keeps its still-valid restore. Caller passes the
// fired-delete descriptors ({ entryId }); returns how many trash rows were dropped.
export function dropTrashForDeletedR2(firedDeletes) {
  if (!sessionTrash.length || !Array.isArray(firedDeletes) || !firedDeletes.length) return 0;
  const goneIds = new Set(firedDeletes.map((d) => d.entryId).filter(Boolean));
  if (!goneIds.size) return 0;
  let dropped = 0;
  for (let i = sessionTrash.length - 1; i >= 0; i--) {
    if (goneIds.has(sessionTrash[i].item.id)) {
      sessionTrash.splice(i, 1);
      dropped++;
    }
  }
  if (dropped) { persistSessionTrash(); renderTrash(); }
  return dropped;
}

// ============== SIDEBAR COLLAPSE ==============
// Reclaim the 200px nav strip without dropping into full focus mode. Persisted so
// the choice sticks across sessions (focus mode stays the separate "go dark" path).
const SIDEBAR_KEY = 'oaklens_sidebar_collapsed';
function _applySidebarBtn(collapsed) {
  const btn = document.getElementById('sidebar-toggle');
  if (!btn) return;
  btn.textContent = collapsed ? '››' : '‹‹';
  btn.title = collapsed ? 'Show navigation' : 'Collapse navigation';
}
export function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch {}
  _applySidebarBtn(collapsed);
}
export function restoreSidebar() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === '1'; } catch {}
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  _applySidebarBtn(collapsed);
}

// The mobile sibling of the sidebar collapse: on the tab-bar band (phone/tablet)
// there's no sidebar to reclaim — the bottom tab bar is the chrome eating writing
// space. This hides it while in Field Notes (the CSS gates the effect to #view-fn
// so the preference never strands the user bar-less on a nav-only surface).
// Persisted so a travel-keyboard setup sticks across sessions. Full focus mode
// stays the separate "go dark" path.
const FN_BAR_KEY = 'oaklens_fn_bar_hidden';
function _applyFnBarBtns(hidden) {
  // ONE toggle, in the FN editor's ⋯ menu (it used to be two — a labelled one
  // in the editor header and a glyph-only twin on the portrait action bar —
  // which is two places to keep in step for one boolean). Writes into the
  // item's parts rather than over its textContent, because a menu row is a
  // mark, a label and a hint, not a string.
  const btn = document.getElementById('fn-bar-toggle');
  if (!btn) return;
  const label = hidden ? 'Show the bottom nav' : 'Hide the bottom nav';
  const mark = btn.querySelector('.fn-menu-mark');
  const text = btn.querySelector('.fn-bar-toggle-label');
  if (mark) mark.textContent = hidden ? '▴' : '▾';
  if (text) text.textContent = label;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
}
export function toggleFnBar() {
  const hidden = document.body.classList.toggle('fn-bar-hidden');
  try { localStorage.setItem(FN_BAR_KEY, hidden ? '1' : '0'); } catch {}
  _applyFnBarBtns(hidden);
}
export function restoreFnBar() {
  let hidden = false;
  try { hidden = localStorage.getItem(FN_BAR_KEY) === '1'; } catch {}
  document.body.classList.toggle('fn-bar-hidden', hidden);
  _applyFnBarBtns(hidden);
}

// ============== RESET ==============

export function resetConsole() {
  if (!confirm("Wipe ALL in-memory data? This clears localStorage. Cannot be undone.")) return;
  localStorage.removeItem(STORAGE_KEY);
  // The trash and the R2 queue live under their own keys — a wipe that left
  // them behind would repopulate the trash from storage on the next reload,
  // which is not what "wipe ALL" says.
  try { localStorage.removeItem('oaklens_session_trash'); } catch {}
  try { localStorage.removeItem('oaklens_pending_r2_deletes'); } catch {}
  sessionTrash.length = 0;
  setPendingR2Deletes([]);
  Object.assign(STATE, {
    buffer: [], archive: [], posts: [], wallpapers: [], friends: [], library: [], audio: [],
    audioSets: [], cards: [],
    staged: { buffer: 0, archive: 0, posts: 0, wallpapers: 0, friends: 0, library: 0, audio: 0,
      audioSets: 0, cards: 0 },
    stagedLog: []
  });
  refreshStageIndicators();
  renderTrash();
  showView("buffer");
  showToast("✓ console reset", { kind: 'success' });
}
