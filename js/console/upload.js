// OAKLENS Field Console — upload.
//
// The R2 upload queue: enqueue, the re-entrant drain loop with SKIP/CANCEL/
// RETRY, per-entry done/failed marking, the floating panel, the progress-rail
// mirror, and the publish gates (_uploadsPending / _failedUploads) that keep a
// frame with no CDN asset from ever committing.
//
// Sits BELOW the surfaces it repaints: repaints go through refreshSurface()
// (the third seam) and the queue speaks STATE keys while the registry speaks
// view names — _VIEW_OF_SURFACE translates, here, because that vocabulary is
// the queue's, not the router's. The library auto-sync's gate is served
// downward through _libraryUploadsPending (fourth seam, wired in init), and
// the reconnect resume path calls _requeueNetFailedUploads()/
// _hasNetFailedUploads() rather than touching queue state it cannot own.
//
// Dismiss keeps net-failed items (hidden via _dismissed): their in-memory
// variants are the ONLY copy of the upload — see the truthfulness write-up.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE, stageChange, save, cancelPendingDeleteForKeys } from '../console-state.js';
import { getToken, uploadFilesWithRetry } from '../console-api.js';
import { showToast, startProgress, updateProgress, endProgress } from '../console-telemetry.js';
import { toast, refreshSurface } from './chrome.js';
import { scheduleLibrarySync } from './sync.js';

// ============== UPLOAD QUEUE ==============
// Items persist in the queue (with a status field) until the panel auto-hides,
// so the panel can show DONE/FAILED rows alongside in-flight ones.
//   item = { entryId, surface, variants, filename, status }
//   status: 'queued' | 'uploading' | 'done' | 'failed' | 'skipped'
let _uploadQueue = [];
let _uploadActive = false;     // re-entrancy lock for the drain loop
let _uploadAbort = null;       // AbortController for the in-flight upload (SKIP)
let _uploadHideTimer = null;   // auto-hide timer for the panel

export function _enqueueUpload(entryId, surface, variants, filename) {
  // Uploading a key is a statement that you want the object at that key, so it
  // un-arms any queued R2 delete for it. Without this, trashing a file and then
  // re-adding one with the same name had publish commit a registry pointing at
  // the new object and THEN delete it — every step reporting success. Each
  // variant File is named with its full R2 key path by the calling surface.
  cancelPendingDeleteForKeys((variants || []).map(v => v && v.name).filter(Boolean));
  _uploadQueue.push({ entryId, surface, variants, filename, status: 'queued' });
  if (_uploadHideTimer) { clearTimeout(_uploadHideTimer); _uploadHideTimer = null; }
  _refreshUploadUI();
  _drainUploadQueue();
}

// True while any item still needs to upload — used to block publishing.
export function _uploadsPending() {
  return _uploadActive ||
    _uploadQueue.some(i => i.status === 'queued' || i.status === 'uploading');
}

// The library auto-sync's view of this queue: true while any library upload
// still has to land. sync sits BELOW this module, so it cannot read
// _uploadQueue itself — init() hands it this probe instead (see
// _registerLibraryUploadProbe, the fourth seam).
export function _libraryUploadsPending() {
  return _uploadQueue.some(q => q.surface === 'library' &&
    (q.status === 'queued' || q.status === 'uploading'));
}

// True when something here would recover on reconnect — the visibility
// fallback (session-land) uses this to keep ordinary tab switches a no-op.
export function _hasNetFailedUploads() {
  return _uploadQueue.some(i => i.status === 'failed' && i._netFail);
}

// Requeue everything that failed for network reasons and restart the drain.
// Called by the reconnect/visibility resume paths, which live ABOVE this
// module: the queue, its item flags, and the panel's hide timer are all
// module state owned here, so the whole mutation is one exported operation —
// the caller gets the count back and owns the user-facing narration.
export function _requeueNetFailedUploads() {
  const netFailed = _uploadQueue.filter(i => i.status === 'failed' && i._netFail);
  if (!netFailed.length) return 0;
  netFailed.forEach(i => {
    i.status = 'queued';
    delete i._netFail;
    delete i._wasOffline;
    delete i._dismissed;   // panel resurfaces with the live retry row
    const entry = (STATE[i.surface] || []).find(e => e.id === i.entryId);
    if (entry) { delete entry._uploadError; entry._uploading = true; }
  });
  if (_uploadHideTimer) { clearTimeout(_uploadHideTimer); _uploadHideTimer = null; }
  _refreshUploadUI();
  _drainUploadQueue();
  return netFailed.length;
}

// Entries whose upload explicitly failed: `_uploadError` is set, so their
// filename points at a CDN object that was never created. The flag is cleared
// on retry (see _uploadRetry) and is never set on a confirmed or imported
// entry, so it reliably marks frames that are *currently* missing their asset.
// Publishing these would commit a broken reference — the exact failure that
// left blank IMG_* frames in the buffer. Gates below block on this; buildBundle
// also filters it out as a belt-and-suspenders guarantee.
export function _failedUploads() {
  const out = [];
  for (const surface of ['buffer', 'archive', 'wallpapers', 'library', 'audio']) {
    for (const e of (STATE[surface] || [])) {
      // _uploading with no live queue item = orphan (load() normally converts
      // these, but belt-and-suspenders: never let one slip past a publish)
      if (e && (e._uploadError || (e._uploading && !_uploadQueue.some(q => q.entryId === e.id)))) {
        out.push({ surface, entry: e });
      }
    }
  }
  return out;
}

export async function _drainUploadQueue() {
  if (_uploadActive) return;
  const item = _uploadQueue.find(i => i.status === 'queued');
  if (!item) { _maybeScheduleHide(); return; }

  _uploadActive = true;
  item.status = 'uploading';
  _refreshUploadUI();

  const token = getToken();
  if (!token) {
    item.status = 'failed';
    _markEntryUploadFailed(item, 'Not logged in — log in to upload');
    _uploadActive = false;
    _refreshUploadUI();
    return _drainUploadQueue();
  }

  _uploadAbort = new AbortController();

  let lastErr = null;
  try {
    // SKIP CURRENT flips item.status to 'skipped' and aborts the in-flight
    // request; uploadFilesWithRetry resolves { aborted } instead of throwing.
    await uploadFilesWithRetry(item.variants, {
      signal: _uploadAbort.signal,
      shouldAbort: () => item.status === 'skipped',
      // Honest backoff: the row says "RETRY IN Ns" instead of a frozen UPLOADING
      onRetryWait: (s) => {
        item._retryWait = s;
        _renderUploadPanel();
        setTimeout(() => {
          if (item._retryWait === s) { delete item._retryWait; _renderUploadPanel(); }
        }, s * 1000);
      },
    });
  } catch (err) {
    if (item.status !== 'skipped') {
      lastErr = err;
      // status 0 = never completed (offline / timeout / dropped signal) —
      // these auto-requeue when the connection returns
      item._netFail = !(err.status > 0);
      item._wasOffline = err.offline === true;
    }
  }
  _uploadAbort = null;

  if (item.status === 'skipped') {
    // entry already marked by the SKIP handler — nothing to do
  } else if (lastErr) {
    item.status = 'failed';
    _markEntryUploadFailed(item, lastErr.message);
    if (lastErr.offline) {
      // One coalesced toast for the whole batch — not one per photo.
      showToast('⊘ offline — upload queued; auto-retries when the signal returns', { kind: 'warning', id: 'upload-offline' });
    } else {
      toast(`⚠ Upload failed: ${lastErr.message}`, 'error');
    }
  } else {
    item.status = 'done';
    _markEntryUploadDone(item);
  }

  _uploadActive = false;
  _refreshUploadUI();
  _drainUploadQueue();
}

// SKIP CURRENT — abandon the item that's uploading right now, advance to the next.
export function _uploadSkipCurrent() {
  const item = _uploadQueue.find(i => i.status === 'uploading');
  if (!item) return;
  item.status = 'skipped';
  _markEntryUploadFailed(item, 'Skipped by user');
  if (_uploadAbort) _uploadAbort.abort();   // cancel in-flight fetch; drain advances
  _refreshUploadUI();
}

// CANCEL REMAINING — drop everything still queued; the current upload finishes.
export function _uploadCancelRemaining() {
  _uploadQueue.forEach(i => {
    if (i.status === 'queued') {
      i.status = 'skipped';
      _markEntryUploadFailed(i, 'Cancelled');
    }
  });
  _refreshUploadUI();
  _drainUploadQueue();   // no-op if an item is mid-upload; else schedules the hide
}

// RETRY — re-queue a single failed item (its variants are still in memory).
// The queue deals in STATE keys; the view registry is keyed by view name, and
// the two disagree for wallpapers. Kept here rather than in chrome because it is
// the queue's vocabulary, not the router's.
const _VIEW_OF_SURFACE = { buffer: 'buffer', archive: 'archive', wallpapers: 'wall', library: 'library', audio: 'audio' };

export function _uploadRetry(entryId) {
  const item = _uploadQueue.find(i => i.entryId === entryId);
  if (!item || item.status !== 'failed') return;
  item.status = 'queued';
  delete item._dismissed;
  const arr = STATE[item.surface];
  const entry = arr && arr.find(e => e.id === item.entryId);
  if (entry) { delete entry._uploadError; entry._uploading = true; }
  refreshSurface(_VIEW_OF_SURFACE[item.surface]);
  if (_uploadHideTimer) { clearTimeout(_uploadHideTimer); _uploadHideTimer = null; }
  _refreshUploadUI();
  _drainUploadQueue();
}

// Manually close the panel; keeps any still-pending items.
//
// Net-failed items are kept too, only hidden (_dismissed): their in-memory
// variants are the ONLY copy of the upload, so dropping them here silently
// destroyed both the RETRY buttons and the reconnect auto-requeue — the frame
// stayed ✕ FAILED forever with the console claiming "back online". Non-network
// failures (size/type rejections) still clear: a retry with the same bytes
// cannot succeed, and the frame itself keeps its ✕ FAILED badge.
export function _uploadDismiss() {
  if (_uploadHideTimer) { clearTimeout(_uploadHideTimer); _uploadHideTimer = null; }
  _uploadQueue = _uploadQueue.filter(i =>
    i.status === 'queued' || i.status === 'uploading' ||
    (i.status === 'failed' && i._netFail));
  _uploadQueue.forEach(i => { if (i.status === 'failed') i._dismissed = true; });
  _refreshUploadUI();
}

// When the queue is fully drained, auto-hide after 3s — but keep the panel open
// if anything failed, so the RETRY buttons stay reachable.
export function _maybeScheduleHide() {
  if (_uploadActive || !_uploadQueue.length) return;
  const allTerminal = _uploadQueue.every(i =>
    i.status === 'done' || i.status === 'failed' || i.status === 'skipped');
  const anyFailed = _uploadQueue.some(i => i.status === 'failed');
  if (allTerminal && !anyFailed) {
    if (_uploadHideTimer) clearTimeout(_uploadHideTimer);
    _uploadHideTimer = setTimeout(() => {
      _uploadQueue = [];
      _uploadHideTimer = null;
      _refreshUploadUI();
    }, 3000);
  }
}

export function _markEntryUploadDone(item) {
  const arr = STATE[item.surface];
  const entry = arr && arr.find(e => e.id === item.entryId);
  if (!entry) return;
  delete entry._uploading;
  entry._uploaded = true;
  entry.image = null;  // drop local blob; CDN URL via cdnThumb()
  entry.src = null;    // also clear src for wallpapers
  // Stage into the publish count only now that upload is confirmed.
  stageChange(item.surface, {
    id: entry.id,
    label: `${entry.title || entry.filename || item.surface + ' item'} — new`,
    kind: 'add',
  });
  save();
  refreshSurface(_VIEW_OF_SURFACE[item.surface]);
  if (item.surface === 'library') scheduleLibrarySync();
}

export function _markEntryUploadFailed(item, msg) {
  const arr = STATE[item.surface];
  const entry = arr && arr.find(e => e.id === item.entryId);
  if (!entry) return;
  delete entry._uploading;
  entry._uploadError = msg;
  refreshSurface(_VIEW_OF_SURFACE[item.surface]);
}

export function _refreshUploadUI() {
  _refreshUploadQueueStatus();   // Publish-tab one-liner
  _renderUploadPanel();          // floating queue panel
  _syncUploadRail();             // progress rail + lamp numbers
}

// Mirror the queue onto the progress rail: done = terminal items. startProgress
// once per burst so the total updates as more drops enqueue mid-drain.
let _uploadRailActive = false;
function _syncUploadRail() {
  const total = _uploadQueue.length;
  const pending = _uploadQueue.filter(i => i.status === 'queued' || i.status === 'uploading').length;
  if (total && pending) {
    if (!_uploadRailActive) { startProgress('r2-queue', 'R2 ▲', total); _uploadRailActive = true; }
    updateProgress('r2-queue', total - pending, total);
  } else if (_uploadRailActive) {
    endProgress('r2-queue');
    _uploadRailActive = false;
  }
}

// Publish-tab one-liner — simplified to a pending count.
export function _refreshUploadQueueStatus() {
  const el = document.getElementById('upload-queue-status');
  if (!el) return;
  const pending = _uploadQueue.filter(i =>
    i.status === 'queued' || i.status === 'uploading').length;
  el.style.display = pending > 0 ? 'block' : 'none';
  el.textContent = `${pending} UPLOAD${pending !== 1 ? 'S' : ''} IN QUEUE`;
}

const _UQ_GLYPH = { queued: '◻', uploading: '▲', done: '✓', failed: '✕', skipped: '⊘' };
const _UQ_LABEL = { queued: 'QUEUED', uploading: 'UPLOADING', done: 'DONE', failed: 'FAILED', skipped: 'SKIPPED' };

export function _renderUploadPanel() {
  const panel = document.getElementById('upload-queue-panel');
  if (!panel) return;
  // Dismissed net-failed items stay in the queue (their variants are the only
  // copy, and reconnect requeues them) but are not shown — the user asked for
  // the panel to go away.
  const visible = _uploadQueue.filter(i => !i._dismissed);
  if (!visible.length) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

  const total = visible.length;
  const complete = visible.filter(i =>
    i.status === 'done' || i.status === 'failed' || i.status === 'skipped').length;
  const hasUploading = visible.some(i => i.status === 'uploading');
  const hasQueued = visible.some(i => i.status === 'queued');

  const rows = visible.map(i => {
    const retry = i.status === 'failed'
      ? `<button class="uqp-retry" onclick="_uploadRetry('${i.entryId}')">RETRY</button>` : '';
    const name = (i.filename || '(file)').replace(/</g, '&lt;');
    return `
      <div class="uqp-row q-${i.status}">
        <span class="uqp-glyph">${_UQ_GLYPH[i.status]}</span>
        <span class="uqp-name" title="${name}">${name}</span>
        <span class="uqp-status">${i.status === 'uploading' && i._retryWait ? `RETRY IN ${i._retryWait}s` : (i.status === 'failed' && i._wasOffline ? 'QUEUED · OFFLINE' : _UQ_LABEL[i.status])}</span>
        ${retry}
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="uqp-head">
      <span>UPLOAD QUEUE — ${complete} of ${total} complete</span>
      <button class="uqp-dismiss" onclick="_uploadDismiss()" title="Dismiss">×</button>
    </div>
    <div class="uqp-rows">${rows}</div>
    <div class="uqp-foot">
      <button class="uqp-btn" onclick="_uploadSkipCurrent()" ${hasUploading ? '' : 'disabled'}>Skip Current</button>
      <button class="uqp-btn" onclick="_uploadCancelRemaining()" ${hasQueued ? '' : 'disabled'}>Cancel Remaining</button>
    </div>`;
  panel.style.display = 'block';
}
