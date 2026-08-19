// @vitest-environment happy-dom
//
// Console truthfulness — regression tests for the 2026-07-29 broken-image
// incident (docs/resume-console-truthfulness.md).
//
// Root cause (thread 2): the archive COMPOSE flow runs its upload detached
// from any entry — archiveIngestPhoto uploads and records the outcome only on
// the form (view-archive's dataset), and its failure fallback reverts the form
// to the local preview + the RAW camera filename. archiveStage then built a
// flag-free entry from that form, so _failedUploads(), _uploadsPending() and
// buildBundle()'s filters had nothing to see: commit b361560 published
// "IMG_1523.jpeg" — a filename with no CDN object behind it.
//
// The fix arms the same entry-level flags every other ingest path uses:
// archiveIngestPhoto stamps dataset.uploadState, and archiveStage translates a
// 'failed' compose into entry._uploadError (NEW mode) or refuses the image
// swap (UPDATE mode — swapping would also queue the GOOD variants for delete).
//
// Thread 1 (same incident, why nothing auto-recovered): _uploadDismiss()
// dropped failed queue items outright, destroying the in-memory variants that
// are the ONLY copy — after a dismiss, reconnect had nothing to requeue.
//
// Thread 3: "✓ R2 cleanup: N objects removed" claimed existence the code never
// checked (R2 delete is idempotent). The honest wording is "keys cleared".
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// console-state.js resolves these through the global scope at call time (the
// real console mirrors its renderers onto window) — stub before importing.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE, _pendingR2Deletes, setPendingR2Deletes } =
  await import('../js/console-state.js');
const ui = await import('../js/console-ui.js');

// Every element the exercised paths touch. archiveStage/archiveClear/
// renderArchive and the upload queue's render family all getElementById
// without null guards — the fixture is the price of driving the real code.
function seedDom() {
  document.body.innerHTML = `
    <div id="view-archive">
      <button class="btn-stage btn-full">▲ Stage to Archive</button>
    </div>
    <input id="arch-title"><input id="arch-sub"><input id="arch-loc">
    <input id="arch-cam"><datalist id="arch-cam-memory"></datalist>
    <input id="arch-lens"><datalist id="arch-lens-memory"></datalist>
    <input id="arch-med"><datalist id="arch-med-memory"></datalist>
    <input type="checkbox" id="arch-gear-remember">
    <input id="arch-hash">
    <div id="archive-preview-wrap"></div><div id="archive-filename"></div>
    <div id="arch-tag-preview"></div>
    <div id="archive-display"></div><span id="archive-count"></span><span id="archive-stats"></span>
    <div id="buffer-display"></div><span id="buffer-count"></span><span id="buffer-stats"></span>
    <div id="wall-list"></div><span id="wall-stats"></span>
    <div id="library-display"></div><span id="library-count"></span><span id="library-stats"></span>
    <div id="upload-queue-panel"></div><div id="upload-queue-status"></div>
  `;
}

function resetState() {
  STATE.buffer = []; STATE.archive = []; STATE.posts = [];
  STATE.wallpapers = []; STATE.barrel = []; STATE.friends = []; STATE.library = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0 };
  setPendingR2Deletes([]);
}

const composeView = () => document.getElementById('view-archive');

beforeEach(() => {
  seedDom();
  resetState();
  ui.archiveClear();
  document.getElementById('arch-title').value = 'test';
});

// ---------- Thread 2: the compose flow must arm the publish guards ----------

describe('archiveStage after a failed compose upload (the IMG_1523 hole)', () => {
  beforeEach(() => {
    // The exact form state archiveIngestPhoto's failure fallback leaves behind:
    // local preview + RAW camera filename, upload never landed.
    const view = composeView();
    view.dataset.image = 'blob:https://console/preview';
    view.dataset.filename = 'IMG_1523.jpeg';
    view.dataset.hash = 'sha256:5e1dcb61';
    view.dataset.uploadState = 'failed';
  });

  it('stages the entry carrying _uploadError so it renders ✕ FAILED', () => {
    ui.archiveStage();
    expect(STATE.archive).toHaveLength(1);
    expect(STATE.archive[0]._uploadError).toBeTruthy();
  });

  it('the publish gate (_failedUploads) now sees the entry', () => {
    ui.archiveStage();
    const failed = ui._failedUploads();
    expect(failed.some(f => f.surface === 'archive' && f.entry.id === STATE.archive[0].id)).toBe(true);
  });

  it('buildBundle refuses to commit it (the last-line guarantee)', () => {
    ui.archiveStage();
    const published = JSON.parse(ui.buildBundle()['data/archive.json']);
    expect(published.some(a => a.filename === 'IMG_1523.jpeg')).toBe(false);
  });

  it('a compose still uploading cannot be staged at all', () => {
    composeView().dataset.uploadState = 'uploading';
    ui.archiveStage();
    expect(STATE.archive).toHaveLength(0);
  });

  it('a confirmed upload stages clean (no false ✕ FAILED)', () => {
    const view = composeView();
    view.dataset.image = '';
    view.dataset.filename = 'IMG_1523__5e1dcb61.webp';
    view.dataset.uploadState = 'done';
    ui.archiveStage();
    expect(STATE.archive).toHaveLength(1);
    expect(STATE.archive[0]._uploadError).toBeUndefined();
  });
});

describe('archiveStage UPDATE mode with a failed replacement upload', () => {
  it('keeps the previous image instead of swapping in a broken reference', () => {
    STATE.archive = [{
      id: 'a1', filename: 'good__abc123.webp', slug: 'good', title: 'Good',
      sub: '', location: '', camera: 'Test Body', lens: 'Prime', medium: 'Digital',
      hash: 'sha256:abc123', added_at: '2026-07-01', _uploaded: true,
    }];
    ui.archiveEdit('a1');
    // Replacement photo dropped, Wi-Fi died — the fallback form state again.
    const view = composeView();
    view.dataset.image = 'blob:https://console/preview2';
    view.dataset.filename = 'IMG_9999.jpeg';
    view.dataset.uploadState = 'failed';
    ui.archiveStage();

    const a = STATE.archive[0];
    expect(a.filename).toBe('good__abc123.webp');   // swap refused
    expect(a._uploadError).toBeUndefined();          // the live frame stays publishable
    // and the GOOD variants were not queued for deletion
    expect(_pendingR2Deletes.some(d => d.entryId === 'a1')).toBe(false);
  });
});

describe('compose-form laundering routes', () => {
  it('editing an entry clears a stale uploadState left by an abandoned compose', () => {
    composeView().dataset.uploadState = 'failed';   // abandoned failed compose
    STATE.archive = [{
      id: 'a2', filename: 'fine__def456.webp', slug: 'fine', title: 'Fine',
      sub: '', location: '', camera: 'Test Body', lens: 'Prime', medium: 'Digital',
      hash: 'sha256:def456', added_at: '2026-07-02', _uploaded: true,
    }];
    ui.archiveEdit('a2');
    expect(composeView().dataset.uploadState).toBeUndefined();
  });

  it('bufferPromote refuses a frame whose upload failed', () => {
    STATE.buffer = [{ id: 'b1', filename: 'x.webp', captured_at: '2026-07-29T00:00:00Z', _uploadError: 'boom' }];
    ui.bufferPromote('b1');
    expect(STATE.buffer[0].archived).toBeFalsy();
  });

  it('the asset library picker hides failed/uploading entries', () => {
    STATE.archive = [
      { id: 'ok1', filename: 'ok.webp', title: 'OK', added_at: '2026-07-01' },
      { id: 'bad1', filename: 'broken.jpeg', title: 'Broken', added_at: '2026-07-02', _uploadError: 'x' },
    ];
    STATE.buffer = [{ id: 'bad2', filename: 'mid.webp', added_at: '2026-07-03', _uploading: true }];
    STATE.library = [{ id: 'bad3', filename: 'lib.webp', added_at: '2026-07-04', _uploadError: 'x' }];
    const files = ui.getAssetLibraryItems().map(i => i.filename);
    expect(files).toContain('ok.webp');
    expect(files).not.toContain('broken.jpeg');
    expect(files).not.toContain('mid.webp');
    expect(files).not.toContain('lib.webp');
  });
});

// ---------- Thread 1: dismissing the panel must not destroy the retry ----------

describe('upload queue: dismiss keeps net-failed items recoverable', () => {
  async function failOneUploadOffline() {
    sessionStorage.setItem('oaklens_session', 'test-token');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    STATE.buffer = [{ id: 'e1', filename: 'shot.webp', captured_at: '2026-07-29T00:00:00Z', _uploading: true }];
    ui._enqueueUpload('e1', 'buffer', [new File(['x'], 'archive/shot-480w.webp')], 'shot.webp');
    // drain is async — wait for the offline failure to mark the entry
    for (let i = 0; i < 50 && !STATE.buffer[0]._uploadError; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    expect(STATE.buffer[0]._uploadError).toBeTruthy();
  }

  it('a dismissed offline-failed upload still auto-recovers on reconnect', async () => {
    await failOneUploadOffline();

    ui._uploadDismiss();   // the incident: this used to drop the failed item

    // Signal returns; the upload endpoint now works.
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, uploaded: ['archive/shot-480w.webp'] }), { status: 200 });

    ui._resumeAfterReconnect();
    for (let i = 0; i < 50 && !STATE.buffer[0]._uploaded; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    expect(STATE.buffer[0]._uploaded).toBe(true);
    expect(STATE.buffer[0]._uploadError).toBeUndefined();
  });
});

// ---------- Thread 3: say what was verified, not what sounds finished ----------

describe('R2 cleanup messages claim only what the code verified', () => {
  // Scan the whole console source tree rather than named files: the
  // decomposition moves these call sites between modules (the publish-view
  // cleanup line has already travelled console-ui.js → console/publish.js),
  // and a path-pinned assertion would fail on a pure move while a genuinely
  // reworded message slipped through in a file nobody listed.
  const ROOT = join(import.meta.dirname, '..');
  const files = [
    ...readdirSync(join(ROOT, 'js')).filter((f) => /^console.*\.js$/.test(f)).map((f) => `js/${f}`),
    ...(existsSync(join(ROOT, 'js/console'))
      ? readdirSync(join(ROOT, 'js/console')).filter((f) => f.endsWith('.js')).map((f) => `js/console/${f}`)
      : []),
  ];
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');

  it('no console surface claims "objects removed" off an idempotent delete', () => {
    // env.CDN.delete() succeeds for keys that never existed, so deleted.length
    // counts delete CALLS, not objects that were present. "removed" overstates;
    // "cleared" (the key now verifiably does not exist) is what we know.
    const offenders = files.filter((p) => /objects removed/.test(read(p)));
    expect(offenders, `still says "objects removed": ${offenders.join(', ')}`).toEqual([]);
  });

  it('the honest wording is in place on every surface that reports a cleanup', () => {
    // Wherever a deleteAssets() result is counted into a message, that message
    // must be the honest one. Ties the assertion to the CODE SHAPE, so it
    // follows the call sites wherever the split moves them next.
    const reporters = files.filter((p) => /\(data\.deleted|\(delData\.deleted/.test(read(p)));
    expect(reporters.length, 'no cleanup reporters found — did the scan break?').toBeGreaterThan(0);
    const dishonest = reporters.filter((p) => !/keys cleared/.test(read(p)));
    expect(dishonest, `reports a cleanup without the honest wording: ${dishonest.join(', ')}`).toEqual([]);
  });
});

// ---------- Cold run 4: a sync where GitHub never answered painted green -----
//
// A mistyped GITHUB_REPO secret 404s every file fetch AND the HEAD read, but
// the worker's batch still answers 200 ok — and the D1 drafts that sync right
// after are healthy, so the ledger read "✓ sync · drafts:0" and the toast said
// "Synced from GitHub main" while not one byte had come from GitHub. The
// verdict helper is the pure decision syncFromServer now renders from.

describe('_syncVerdict: what a sync response actually proves', () => {
  const FILES = ['data/buffer.json', 'data/archive.json', 'data/barrel.json'];
  const nf = { ok: false, error: 'Not Found' };

  it('all files failed + no HEAD → the GitHub link itself is down', () => {
    const v = ui._syncVerdict({
      files: { 'data/buffer.json': nf, 'data/archive.json': nf, 'data/barrel.json': nf },
      headSha: null, headShaError: 'Not Found',
    }, FILES);
    expect(v.mode).toBe('github-down');
    expect(v.error).toBe('Not Found');
  });

  it('a fresh fork\'s legitimate 404s stay ok while HEAD reads fine', () => {
    // archive/posts/wallpapers are deliberately absent on a new fork (missing
    // file → bundled samples render), so per-file 404s alone must not alarm.
    const v = ui._syncVerdict({
      files: { 'data/buffer.json': { ok: true, content: [] }, 'data/archive.json': nf, 'data/barrel.json': { ok: true, content: [] } },
      headSha: 'HEAD_SHA',
    }, FILES);
    expect(v.mode).toBe('ok');
  });

  it('files arrived but HEAD did not → guard-disarmed warning, not an outage', () => {
    const v = ui._syncVerdict({
      files: { 'data/buffer.json': { ok: true, content: [] }, 'data/archive.json': nf, 'data/barrel.json': { ok: true, content: [] } },
      headSha: null, headShaError: 'API rate limit exceeded',
    }, FILES);
    expect(v.mode).toBe('no-head');
  });

  it('falls back to a file\'s error when the HEAD read gave none', () => {
    const v = ui._syncVerdict({
      files: { 'data/buffer.json': nf, 'data/archive.json': nf, 'data/barrel.json': nf },
      headSha: null,
    }, FILES);
    expect(v.mode).toBe('github-down');
    expect(v.error).toBe('Not Found');
  });
});

describe('_githubHint: config mistakes get their fix named', () => {
  it('"Not Found" points at GITHUB_REPO', () => {
    expect(ui._githubHint('Not Found')).toMatch(/GITHUB_REPO/);
  });
  it('"Bad credentials" points at GITHUB_TOKEN', () => {
    expect(ui._githubHint('Bad credentials')).toMatch(/GITHUB_TOKEN/);
  });
  it('anything else stays unmapped — the raw error stands', () => {
    expect(ui._githubHint('API rate limit exceeded')).toBeNull();
    expect(ui._githubHint(undefined)).toBeNull();
  });
});
