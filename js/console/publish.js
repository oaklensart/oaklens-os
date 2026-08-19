// OAKLENS Field Console — publish.
//
// Everything that reconciles local state with `main`: buildBundle() (the
// all-or-nothing snapshot, serialized through per-surface field whitelists),
// publishToServer() and its gates, the ZIP/JSON exports, the import path, the
// sync-down (syncFromServer, which pulls main and rebuilds every surface), the
// reconnect resume, and the publish view — including the session-trash panel,
// which lives inside #view-publish and is drawn by renderPublish().
//
// Filed by section, three of these functions would land elsewhere: renderTrash
// under a trash banner, confirmPublish under SESSION AUTH, syncFromServer
// under SERVER API (which put a 92-line whole-console reconcile second from
// the bottom of the stack). They are here because this is what they DO — see
// OVERRIDES in scripts/console-module-plan.mjs.
//
// _syncPendingReconnect is exported as a live binding: the offline indicator
// (session) reads it to decide whether foregrounding has anything to resume.
// The queue mutation on that path belongs to upload — this module calls
// _requeueNetFailedUploads() and owns only the narration.
//
// Two guards protect buildBundle's output and must not be routed around: the
// empty-overwrite guard (refuses to blank a non-empty live manifest — this
// once wiped posts.json 12→0) and the stale-base guard (refuses a publish
// built on a main that advanced underneath it).
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE, save, clearStage, totalStaged, sessionTrash, trashItem, dropTrashForDeletedR2, _pendingR2Deletes, setPendingR2Deletes } from '../console-state.js';
import { publishFiles, syncFiles, deleteAssets, fetchDrafts, isLoggedIn, isNotConfigured } from '../console-api.js';
import { showToast, logEvent, startProgress, endProgress } from '../console-telemetry.js';
import { toast, refreshStageIndicators } from './chrome.js';
import { getSyncedSha, setSyncedSha } from './assets.js';
import { ymd } from './utils.js';
import { scheduleLibrarySync, updatePurgeR2Button, _librarySyncFailed } from './sync.js';
import { _uploadsPending, _failedUploads, _requeueNetFailedUploads } from './upload.js';
import { renderWall, renderBarrel, renderNetwork, renderLibrary } from './more-views.js';
import { renderAudio } from './audio.js';
import { renderArchive } from './archive.js';
import { renderBuffer } from './buffer.js';
import { renderFN, mergeCloudDrafts, fnScheduleCloudDraft, fnCurrentId } from './fn-editor.js';

// ============== SESSION TRASH (UI) — mutations live in console-state.js ==============

export function renderTrash() {
  const container = document.getElementById("trash-container");
  if (!container) return;
  const wrapper = document.getElementById("trash-section");
  if (!sessionTrash.length) {
    if (wrapper) wrapper.style.display = "none";
    return;
  }
  if (wrapper) wrapper.style.display = "block";
  container.innerHTML = sessionTrash.map((t, i) => `
    <div class="list-row" style="border-bottom: 1px solid var(--border);">
      <div class="list-info">
        <div class="l-title" style="color: var(--text-dim);">${t.label}</div>
        <div class="l-sub">${t.surface.toUpperCase()} · deleted ${t.deletedAt}</div>
      </div>
      <div class="list-actions">
        <button class="btn btn-sm btn-stage"
          onclick="trashRestore(${i})"
          style="padding: 4px 10px; font-size: 0.6rem;">
          ↩ RESTORE
        </button>
      </div>
    </div>
  `).join("");
}
// ============== PUBLISH ==============
export function renderPublish() {
  const map = {
    buffer: STATE.buffer.length,
    archive: STATE.archive.length,
    fn: STATE.posts.length,
    wall: STATE.wallpapers.length,
    barrel: STATE.barrel.length,
    network: STATE.friends.length,
    // Audio was missing from both maps, so a staged track change moved the
    // total badge and showed `+n ▲` on no card at all — the publish screen
    // listed every surface except the one being edited.
    audio: (STATE.audio || []).length,
  };
  const stagedMap = {
    buffer: STATE.staged.buffer,
    archive: STATE.staged.archive,
    fn: STATE.staged.posts,
    wall: STATE.staged.wallpapers,
    barrel: STATE.staged.barrel,
    network: STATE.staged.friends,
    audio: STATE.staged.audio,
  };
  Object.entries(map).forEach(([k, v]) => {
    document.getElementById(`sum-count-${k}`).textContent = v;
    const delta = stagedMap[k];
    const card = document.getElementById(`sum-${k}`);
    const deltaEl = document.getElementById(`sum-delta-${k}`);
    if (delta > 0) {
      card.classList.add("has-changes");
      deltaEl.textContent = `+${delta} ▲`;
    } else {
      card.classList.remove("has-changes");
      deltaEl.textContent = "";
    }
  });
  // Library auto-syncs — it has no staged delta, so just show the current count.
  document.getElementById('sum-count-library').textContent = STATE.library.length;
  renderTrash();
}

export function buildBundle() {
  const bundle = {
    // .filter(!_uploadError): never commit a frame whose asset upload failed —
    // it would point at a CDN object that doesn't exist (blank/404). The gates
    // in publishToServer/publishExportBundle block on this too; this is the
    // last-line guarantee.
    "data/buffer.json":    JSON.stringify(STATE.buffer.filter(b => !b._uploadError && !b._uploading).map(b => ({
      id: b.id, filename: b.filename,
      captured_at: b.captured_at, published_at: b.published_at,
      added_at: b.added_at,
      archived: b.archived,
      hash: b.hash || null,
      // burst_id is additive — emitted only when the frame is part of a burst group,
      // matching the format the public renderer expects: burst-{YYYY-MM-DD}-{NNN}
      ...(b.burst_id ? { burst_id: b.burst_id } : {}),
      // focus: object-position for cover thumbnails; omitted when centered.
      ...(b.focus ? { focus: b.focus } : {}),
      // cardFocus: object-position for the tall 4:5 homepage RAW card.
      ...(b.cardFocus ? { cardFocus: b.cardFocus } : {}),
      // featured: surfaces this frame as a RAW card on the homepage. Both are
      // omitted when unset so unfeatured frames stay byte-identical to before.
      ...(b.featured ? { featured: true } : {}),
    })), null, 2),
    "data/archive.json":   JSON.stringify(STATE.archive.filter(a => !a._uploadError && !a._uploading).map(a => ({
      id: a.id, filename: a.filename, slug: a.slug,
      title: a.title, sub: a.sub, location: a.location,
      camera: a.camera, lens: a.lens, medium: a.medium,
      hash: a.hash || null,
      added_at: a.added_at,
      ...(a.focus ? { focus: a.focus } : {}),
      // cardFocus: object-position for the tall 4:5 homepage changelog card.
      ...(a.cardFocus ? { cardFocus: a.cardFocus } : {}),
    })), null, 2),
    "data/posts.json":     JSON.stringify(STATE.posts.filter(p => !p.status || p.status === "published").map(p => ({
      id: p.id, fn_id: p.fn_id, title: p.title,
      location: p.location, date: p.date,
      hero: p.hero_filename || (p.hero && !p.hero.startsWith("data:") ? p.hero : null),
      body: p.body || "",
      buffer_dates: p.buffer_dates || null,
      added_at: p.added_at,
      ...(p.focus ? { focus: p.focus } : {}),
    })), null, 2),
    "data/wallpapers.json": JSON.stringify(STATE.wallpapers.filter(w => !w._uploadError && !w._uploading).map(w => ({
      id: w.id,
      filename: w.filename || null,
      fullres: w.fullres || null,
      title: w.title,
      desc: w.desc || "",
      isNew: w.isNew || false,
      added_at: w.added_at,
      hash: w.hash || null,
      ...(w.focus ? { focus: w.focus } : {}),
    })), null, 2),
    "data/barrel.json":    JSON.stringify(STATE.barrel.map(b => {
      const { _imported, ...rest } = b;
      return rest;
    }), null, 2),
    "data/friends.json":   JSON.stringify(STATE.friends.map(f => ({
      id: f.id,
      name: f.name,
      tag: f.tag || "",
      location: f.location || "",
      url: f.url || "",
      added_at: f.added_at || null,
    })), null, 2),
    "data/library.json":   JSON.stringify(STATE.library.filter(l => !l._uploadError && !l._uploading).map(l => ({
      id: l.id,
      filename: l.filename || null,
      ...(l.kind ? { kind: l.kind } : {}),
      hash: l.hash || null,
      added_at: l.added_at || null,
    })), null, 2),
    // The audio registry — ONE home for every track, however it was attached
    // (Audio shelf or dropped into a field note). `peaks` is the pre-measured
    // waveform (a comma string, ~400 bytes) so no visitor ever downloads audio
    // just to draw a card; `featured` pins the homepage card the same way a
    // buffer frame's `featured` pins the RAW daily.
    "data/audio.json":     JSON.stringify(STATE.audio.filter(a => !a._uploadError && !a._uploading).map(a => ({
      id: a.id,
      slug: a.slug,
      filename: a.filename || null,
      title: a.title || "",
      sub: a.sub || "",
      duration: a.duration || 0,
      peaks: a.peaks || "",
      size: a.size || 0,
      mime: a.mime || "",
      added_at: a.added_at || null,
      // Omitted when unset so an ordinary track stays byte-identical.
      ...(a.featured ? { featured: true } : {}),
      ...(a.featured_order ? { featured_order: a.featured_order } : {}),
      ...(a.episode ? { episode: true } : {}),
      ...(a.download ? { download: true } : {}),
    })), null, 2),
  };
  // Posts as individual markdown files
  STATE.posts.forEach(p => {
    if (!p.fn_id || (p.status && p.status !== "published")) return;
    const heroFilename = p.hero_filename || (p.hero && !p.hero.startsWith("data:") ? p.hero : null);
    const heroLine = heroFilename ? `hero: ${heroFilename}\n` : "";
    const focusLine = p.focus ? `focus: "${p.focus}"\n` : "";
    const bufferDatesLine = p.buffer_dates ? `buffer_dates: "${p.buffer_dates}"\n` : "";
    const fm = `---\nid: ${p.fn_id}\ntitle: ${p.title}\nlocation: ${p.location}\ndate: ${p.date}\n${heroLine}${focusLine}${bufferDatesLine}---\n\n`;
    bundle[`posts/${p.fn_id || p.id}.md`] = fm + (p.body || "");
  });
  // Manifest
  bundle["MANIFEST.txt"] =
`OAKLENS BUNDLE · ${new Date().toISOString()}
=====================================================
Generated by Field Console v0.9.1

Drop into your site folder then:
  unzip -o ~/Downloads/oaklens-bundle-${ymd(new Date())}.zip
  git add .
  git commit -m "publish: ${totalStaged()} changes"
  git push

CONTENTS:
  data/buffer.json     ${STATE.buffer.length} entries (${STATE.buffer.filter(e=>e._imported).length} imported + ${STATE.buffer.filter(e=>!e._imported).length} new)
  data/archive.json    ${STATE.archive.length} entries (${STATE.archive.filter(e=>e._imported).length} imported + ${STATE.archive.filter(e=>!e._imported).length} new)
  data/posts.json      ${STATE.posts.length} entries (${STATE.posts.filter(e=>e._imported).length} imported + ${STATE.posts.filter(e=>!e._imported).length} new)
  data/wallpapers.json ${STATE.wallpapers.length} entries
  data/barrel.json     ${STATE.barrel.length} entries
  data/friends.json    ${STATE.friends.length} nodes
  data/library.json    ${STATE.library.length} entries
  posts/*.md           ${STATE.posts.length} markdown files

NOTE: Image files are NOT included in this bundle.
Upload images via oakpush, then stage metadata here.
`;
  return bundle;
}

export async function publishExportBundle() {
  if (_uploadsPending()) {
    return toast('⚠ Uploads in progress — wait for all photos to finish uploading', 'error');
  }
  const _failed = _failedUploads();
  if (_failed.length) {
    return toast(`⚠ ${_failed.length} frame${_failed.length > 1 ? 's' : ''} failed to upload (no CDN asset) — retry or remove before publishing`, 'error');
  }
  if (!totalStaged() && !hasImported()) return toast("nothing staged", "error");
  const bundle = buildBundle();
  
  if (typeof JSZip === "undefined") {
    toast("⚠ JSZip not loaded — falling back to individual files", "error");
    let count = 0;
    for (const [path, contents] of Object.entries(bundle)) {
      const blob = new Blob([contents], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.replace(/\//g, "_");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      count++;
      await new Promise(r => setTimeout(r, 80));
    }
    clearStage();
    renderPublish();
    toast(`✓ exported ${count} files · stage cleared`, "success");
    return;
  }
  
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(bundle)) {
    zip.file(path, contents);
  }
  startProgress('zip', 'ZIP ◫');
  let blob;
  try { blob = await zip.generateAsync({ type: "blob" }); } finally { endProgress('zip'); }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oaklens-bundle-${ymd(new Date())}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  clearStage();
  renderPublish();
  toast(`✓ bundle exported as ZIP · stage cleared`, "success");
}

export function publishExportJSON() {
  const strip = arr => arr.map(item => { const { _imported, image, ...rest } = item; return rest; });
  const data = {
    buffer: strip(STATE.buffer),
    archive: strip(STATE.archive),
    posts: strip(STATE.posts),
    wallpapers: strip(STATE.wallpapers),
    barrel: strip(STATE.barrel),
    exported_at: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oaklens-data-${ymd(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("✓ JSON exported", "success");
}

export function publishClearStaged() {
  if (!confirm("Clear all staged change indicators? (Data is kept; only the 'pending' counters reset.)")) return;
  clearStage();
  renderPublish();
  toast("staged cleared");
}

// ============== IMPORT EXISTING DATA ==============
export function hasImported() {
  return STATE.buffer.some(e => e._imported) ||
         STATE.archive.some(e => e._imported) ||
         STATE.posts.some(e => e._imported) ||
         STATE.wallpapers.some(e => e._imported) ||
         STATE.barrel.some(e => e._imported);
}

export async function handleImportFiles(fileList) {
  if (!fileList?.length) return;
  const results = [];
  for (const file of fileList) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const name = file.name.toLowerCase();
      
      if (name.includes("buffer")) {
        importIntoSurface("buffer", data);
        results.push(`buffer: ${data.length} entries`);
      } else if (name.includes("archive")) {
        importIntoSurface("archive", data);
        results.push(`archive: ${data.length} entries`);
      } else if (name.includes("post")) {
        data.forEach(p => { if (p.hero && !p.hero_filename) p.hero_filename = p.hero; });
        importIntoSurface("posts", data);
        results.push(`posts: ${data.length} entries`);
      } else if (name.includes("wallpaper")) {
        importIntoSurface("wallpapers", data);
        results.push(`wallpapers: ${data.length} entries`);
      } else if (name.includes("barrel")) {
        importIntoSurface("barrel", data);
        results.push(`barrel: ${data.length} entries`);
      } else if (name.includes("library")) {
        importIntoSurface("library", data);
        results.push(`library: ${data.length} entries`);
      } else {
        if (Array.isArray(data) && data.length > 0) {
          const sample = data[0];
          if (sample.captured_at || sample.published_at) {
            importIntoSurface("buffer", data);
            results.push(`buffer (detected): ${data.length} entries`);
          } else if (sample.slug && sample.hash !== undefined) {
            importIntoSurface("archive", data);
            results.push(`archive (detected): ${data.length} entries`);
          } else if (sample.fn_id || sample.hero !== undefined) {
            data.forEach(p => { if (p.hero && !p.hero_filename) p.hero_filename = p.hero; });
            importIntoSurface("posts", data);
            results.push(`posts (detected): ${data.length} entries`);
          } else {
            toast(`⚠ can't identify ${file.name} — name it buffer.json, archive.json, etc.`, "error");
          }
        }
      }
    } catch (e) {
      toast(`⚠ failed to parse ${file.name}`, "error");
    }
  }
  if (results.length) {
    save();
    refreshStageIndicators();
    renderBuffer();
    renderArchive();
    renderFN();
    renderWall();
    renderBarrel();
    renderLibrary();
    renderAudio();
    renderPublish();
    document.getElementById("sync-status").textContent =
      `✓ Imported: ${results.join(" · ")}`;
    toast(`✓ imported ${results.length} file${results.length > 1 ? "s" : ""}`, "success");
  }
  document.getElementById("import-file-input").value = "";
}

// Manifests that are empty ON PURPOSE: the author trashed the last
// previously-published (_imported) item(s) this session, and the trash proves
// it. Sent as `allowEmpty` so the worker's empty-overwrite guard skips exactly
// these paths and no others — a session that LOST its state has an empty
// trash, vouches for nothing, and the guard still catches the accidental wipe
// it was built for (the 2026-07-10 posts.json 12 → 0). Without this, deleting
// the only item on a surface wedged publish permanently: the guard refused
// 1 → 0, and the retry-sync re-imported the deleted item.
const SURFACE_MANIFEST = {
  buffer: 'data/buffer.json', archive: 'data/archive.json',
  posts: 'data/posts.json', wallpapers: 'data/wallpapers.json',
  barrel: 'data/barrel.json', friends: 'data/friends.json',
  library: 'data/library.json', audio: 'data/audio.json',
};
export function _vouchedEmptyManifests() {
  return Object.entries(SURFACE_MANIFEST)
    .filter(([surface]) => STATE[surface].length === 0
      && sessionTrash.some(t => t.surface === surface && t.item._imported))
    .map(([, path]) => path);
}

export function importIntoSurface(surface, data) {
  if (!Array.isArray(data)) return;
  STATE[surface] = STATE[surface].filter(e => !e._imported);

  const existingIds = new Set(STATE[surface].map(e => e.id));
  // An item sitting in the session trash is a pending deletion, not a gap to
  // refill. Until the deletion publishes, main still lists the item — so a
  // sync in between must not resurrect it (delete → auto-sync → item back).
  const trashedIds = new Set(
    sessionTrash.filter(t => t.surface === surface).map(t => t.item.id)
  );

  const imported = data
    .filter(entry => !existingIds.has(entry.id) && !trashedIds.has(entry.id))
    .map(entry => ({
      ...entry,
      _imported: true,
    }));
    
  STATE[surface] = [...STATE[surface], ...imported];
}

export function clearImported() {
  ["buffer", "archive", "posts", "wallpapers", "barrel", "friends", "library", "audio"].forEach(surface => {
    STATE[surface] = STATE[surface].filter(e => !e._imported);
  });
  save();
  refreshStageIndicators();
  renderBuffer();
  renderArchive();
  renderFN();
  renderWall();
  renderBarrel();
  renderNetwork();
  renderLibrary();
  renderAudio();
  renderPublish();
  document.getElementById("sync-status").textContent = "";
  toast("✓ imported data cleared", "success");
}

// When the signal returns, resume interrupted work automatically — nothing
// here re-fires publish (explicit + non-idempotent; the user decides that).
// Exported for the test contract (tests/console-truthfulness.test.js drives
// the dismiss→reconnect recovery path through it).
export function _resumeAfterReconnect() {
  // 1. Uploads that failed for network reasons (offline/timeout/drop) — their
  //    variants are still in the queue's memory, so a requeue fully recovers.
  //    Size/type rejections (_netFail unset) stay FAILED for manual review.
  //    The queue, its item flags, and the panel's hide timer are all module
  //    state owned by the upload section, so the whole mutation lives there
  //    (_requeueNetFailedUploads); this caller narrates and repaints.
  const requeued = _requeueNetFailedUploads();
  if (requeued) {
    toast(`↻ back online — retrying ${requeued} upload${requeued > 1 ? 's' : ''}`, 'info');
    logEvent(`↻ reconnect: requeued ${requeued} upload(s)`, 'info');
    renderBuffer(); renderArchive(); renderWall(); renderLibrary();
  }
  // 2. The open draft, if any — pushDraft is an LWW upsert, safe to re-fire.
  if (fnCurrentId) fnScheduleCloudDraft(fnCurrentId);
  // 3. A library index commit that failed while offline.
  if (_librarySyncFailed) scheduleLibrarySync();
  // 4. A login sync that couldn't run offline.
  if (_syncPendingReconnect) { _syncPendingReconnect = false; syncFromServer(); }
}

// ---- Pre-publish confirmation ----
// Summarize exactly what's about to hit main (per-surface staged counts + any
// queued R2 cleanup) before the atomic commit fires. Returns false to abort.
export function confirmPublish() {
  const labels = { buffer: 'Buffer', archive: 'Archive', posts: 'Field Notes', wallpapers: 'Wallpapers', barrel: 'Barrel', friends: 'Network', audio: 'Audio' };
  const lines = Object.entries(STATE.staged)
    .filter(([surface, n]) => surface !== 'library' && n > 0)
    .map(([surface, n]) => `  · ${labels[surface] || surface}: ${n} change${n !== 1 ? 's' : ''}`);
  const r2Keys = _pendingR2Deletes
    .filter(d => d.surface !== 'library')
    .reduce((n, d) => n + (d.keys ? d.keys.length : 0), 0);

  if (!lines.length && !r2Keys) {
    toast('Nothing staged to publish', 'info');
    return false;
  }
  let msg = 'Publish to GitHub — live in ~30s?\n\n';
  msg += lines.length ? lines.join('\n') : '  · No data changes';
  if (r2Keys) msg += `\n  · R2 cleanup: ${r2Keys} object${r2Keys !== 1 ? 's' : ''} to delete`;
  return confirm(msg);
}

// ============== SERVER API ==============

// Pure verdict (unit-tested): what a sync response actually proved about the
// GitHub link. The worker fetches per-file and never fails the batch, so a
// 200 with zero usable files is possible — and real: a mistyped GITHUB_REPO
// secret 404s every file AND the HEAD read, while the drafts that sync right
// after come from D1, not GitHub. Cold run 4 hit exactly that and the console
// painted it green ("✓ sync · drafts:0") with only the disarmed-guard warning
// hinting anything was wrong.
//   github-down — no file arrived and main's HEAD was unreadable: the repo
//                 link itself is broken (bad GITHUB_REPO / rejected token).
//   no-head     — files arrived but HEAD didn't: stale-base guard disarmed.
//   ok          — HEAD read fine. Per-file 404s are normal here: a fresh fork
//                 legitimately has no archive/posts/wallpapers manifest yet.
export function _syncVerdict(data, files) {
  const entries = files.map((f) => data.files?.[f]).filter(Boolean);
  const anyOk = entries.some((e) => e.ok);
  if (!data.headSha && !anyOk) {
    return {
      mode: 'github-down',
      error: data.headShaError || entries.find((e) => e.error)?.error || 'unknown',
    };
  }
  return { mode: data.headSha ? 'ok' : 'no-head' };
}

// The two config mistakes behind almost every total GitHub failure, said in
// terms of the fix. Anything else returns null and the raw error stands.
export function _githubHint(message) {
  const m = String(message || '');
  if (/not found/i.test(m)) {
    return 'The GITHUB_REPO secret probably doesn\'t match your repo — it must be '
      + 'exactly owner/repo-name as it appears on github.com. Re-run '
      + '"npx wrangler secret put GITHUB_REPO" to fix it.';
  }
  if (/bad credentials/i.test(m)) {
    return 'GitHub rejected the token — expired, revoked, or mis-pasted. Make a '
      + 'fresh one and re-run "npx wrangler secret put GITHUB_TOKEN".';
  }
  return null;
}

export let _syncPendingReconnect = false;   // an offline-deferred sync — rerun on reconnect

export async function syncFromServer() {
  const statusEl = document.getElementById('sync-status');
  if (!isLoggedIn()) {
    if (statusEl) statusEl.textContent = '// Not logged in';
    return;
  }
  if (statusEl) statusEl.textContent = '↓ fetching from main…';

  const surfaces = [
    { file: 'data/buffer.json',     surface: 'buffer' },
    { file: 'data/archive.json',    surface: 'archive' },
    { file: 'data/posts.json',      surface: 'posts' },
    { file: 'data/wallpapers.json', surface: 'wallpapers' },
    { file: 'data/barrel.json',     surface: 'barrel' },
    { file: 'data/friends.json',    surface: 'friends' },
    { file: 'data/library.json',    surface: 'library' },
    { file: 'data/audio.json',      surface: 'audio' },
  ];

  try {
    const filesParam = surfaces.map(s => s.file).join(',');
    const data = await syncFiles(filesParam);
    _syncPendingReconnect = false;
    const verdict = _syncVerdict(data, surfaces.map(s => s.file));
    // Record the base revision this snapshot came from — stamped onto the next
    // publish so the worker can reject a publish built on now-stale state.
    if (data.headSha) {
      setSyncedSha(data.headSha);
    } else if (verdict.mode === 'no-head') {
      // The worker got the files but not main's HEAD, so this snapshot carries
      // no base revision and the next publish runs with the stale-base guard
      // disarmed. That used to happen in total silence. It doesn't fail the
      // sync — the data is good — but the author gets to know a rail is down,
      // and that re-syncing is what puts it back.
      logEvent(`⚠ sync: main HEAD unavailable (${data.headShaError || 'unknown'}) — `
        + 'stale-base guard is disarmed for this snapshot; sync again to re-arm', 'error');
      // The reason rides along in the toast too, not just the event log: this
      // warning is the only thing most authors will see, and "couldn't read it"
      // without "because GitHub said X" is a dead end for whoever debugs it.
      showToast(`⚠ Couldn't read main's revision (${data.headShaError || 'unknown'}) — `
        + 'cross-device publish check is off until the next sync',
        { kind: 'warning', id: 'sync-nohead' });
    }
    // (github-down says its piece once, below — a disarmed-guard warning under
    // a link that is down entirely would be noise pointing at the wrong thing.)

    const results = [];
    for (const { file, surface } of surfaces) {
      const entry = data.files[file];
      if (!entry || !entry.ok) {
        console.warn(`[sync] ${file}:`, entry?.error);
        continue;
      }
      const content = entry.content;
      if (surface === 'posts') {
        content.forEach(p => { if (p.hero && !p.hero_filename) p.hero_filename = p.hero; });
      }
      importIntoSurface(surface, content);
      results.push(`${surface}:${content.length}`);
    }

    // Cloud drafts (D1) — fetched separately from the GitHub-backed surfaces and
    // merged without the _imported flag (they stay editable, local-cached entries).
    // SAFETY: mergeCloudDrafts only ever sees a successful, complete response —
    // fetchDrafts throws on anything else (see mergeCloudDrafts header).
    try {
      const dData = await fetchDrafts();
      if (Array.isArray(dData.drafts)) {
        const { changed, removed } = mergeCloudDrafts(dData.drafts);
        const tags = [];
        if (changed) tags.push(`+${changed}`);
        if (removed) tags.push(`-${removed}`);
        results.push(`drafts:${dData.drafts.length}${tags.length ? ` (${tags.join(' ')})` : ''}`);
      }
    } catch (err) { console.warn('[sync] drafts:', err.message); }

    if (verdict.mode === 'github-down') {
      // Drafts above may still have merged — they live in D1, not GitHub — so
      // keep the renders honest, but this sync must NOT read as a success:
      // nothing GitHub-backed arrived, and publishing is broken the same way.
      if (results.length) {
        save();
        refreshStageIndicators();
        renderBuffer(); renderArchive(); renderFN();
        renderWall(); renderBarrel(); renderNetwork(); renderLibrary(); renderAudio(); renderPublish();
      }
      const asked = data.repo ? ` — the worker asked for github.com/${data.repo}` : '';
      if (statusEl) statusEl.textContent = `✕ nothing synced from GitHub (${verdict.error})`;
      // kind:'error' also writes the ledger, so this is the one full record.
      showToast(`✕ Nothing synced — GitHub answered "${verdict.error}" for every file${asked}. `
        + (_githubHint(verdict.error) || 'Check the GITHUB_TOKEN and GITHUB_REPO secrets.'),
        { kind: 'error', id: 'sync-ghdown' });
    } else if (results.length) {
      save();
      refreshStageIndicators();
      renderBuffer(); renderArchive(); renderFN();
      renderWall(); renderBarrel(); renderNetwork(); renderLibrary(); renderAudio(); renderPublish();
      if (statusEl) statusEl.textContent =
        `✓ synced ${new Date().toLocaleTimeString()} · ${results.join(' · ')}`;
      logEvent(`✓ sync · ${results.join(' · ')}`, 'info');
      toast('✓ Synced from GitHub main', 'success');
      updatePurgeR2Button();
    } else {
      if (statusEl) statusEl.textContent = '⚠ sync failed — no data returned';
    }
  } catch (err) {
    if (err.status === 401) {
      if (statusEl) statusEl.textContent = '// Session expired — log in to sync';
      return;   // the API layer already dropped to the login modal
    }
    if (err.offline) {
      _syncPendingReconnect = true;   // reconnect listener reruns it
      if (statusEl) statusEl.textContent = '⊘ offline — sync queued for reconnect';
      showToast('⊘ offline — sync queued; runs when the signal returns', { kind: 'warning', id: 'sync-offline' });
      logEvent('⊘ sync deferred — offline', 'info');
      return;
    }
    if (isNotConfigured(err)) {
      // No GitHub secrets on this instance — local-only mode, not a fault.
      // Runs on every login (syncFromServer is part of the login flow), so it
      // must stay quiet: status line + ledger, no toast, no red latch.
      if (statusEl) statusEl.textContent = '// GitHub sync not configured — running local-only';
      return;
    }
    if (statusEl) statusEl.textContent = `⚠ sync error: ${err.message}`;
    toast(`⚠ Sync failed: ${err.message}`, 'error');
  }
}

export async function publishToServer() {
  if (_uploadsPending()) {
    return toast('⚠ Uploads in progress — wait for all photos to finish uploading', 'error');
  }
  const _failed = _failedUploads();
  if (_failed.length) {
    return toast(`⚠ ${_failed.length} frame${_failed.length > 1 ? 's' : ''} failed to upload (no CDN asset) — retry or remove before publishing`, 'error');
  }
  if (!isLoggedIn()) return toast('Not logged in', 'error');
  if (!confirmPublish()) return;

  const log = document.getElementById('publish-log');
  const btn = document.getElementById('gh-publish-btn');
  if (log) { log.innerHTML = ''; log.classList.add('visible'); }
  if (btn) btn.disabled = true;

  function logLine(msg, cls = 'log-info') {
    if (!log) return;
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  startProgress('publish', 'COMMIT ▲');
  try {
    logLine('▸ Building bundle…');
    const bundle = buildBundle();
    const files = [];
    for (const [path, content] of Object.entries(bundle)) {
      if (path === 'MANIFEST.txt') continue;
      logLine(`  · ${path}`);
      files.push({ path, content });
    }

    logLine('▸ Committing to GitHub via worker…');
    const data = await publishFiles(files, getSyncedSha(), _vouchedEmptyManifests());
    // main == this commit now — advance the base so the next publish isn't
    // flagged stale against the revision we just superseded.
    setSyncedSha(data.sha);

    // WHAT HAPPENS NEXT DEPENDS ON THE REPO, so say the one that is true.
    // This line used to promise "Cloudflare Pages deploying (~30s)" after every
    // publish — wrong twice over: it is Workers Builds, not Pages, and on a fork
    // whose repo is not connected to Cloudflare NOTHING is deploying. The commit
    // lands, the live site keeps serving the old build, and the console says it
    // worked. A cold run lost an evening to exactly that.
    // session.js parks the flag on the hint element at boot; it sits above this
    // module in the layer order, so this reads the DOM rather than importing it.
    const connected =
      document.getElementById('publish-deploy-hint')?.dataset.repoConnected === '1';
    const sha = data.sha.slice(0, 7);
    logLine(
      connected
        ? `✓ Published! ${sha} · Cloudflare is rebuilding — live in about a minute`
        : `✓ Published! ${sha} · saved to GitHub. Run npx wrangler deploy to put it live`,
      'log-ok',
    );
    logEvent(
      connected ? `✓ published ${sha} — Cloudflare rebuilding` : `✓ published ${sha} — deploy to go live`,
      'info',
    );

    // Execute queued R2 deletions for non-library surfaces
    const pubR2 = _pendingR2Deletes.filter(d => d.surface !== 'library');
    if (pubR2.length) {
      const allKeys = pubR2.flatMap(d => d.keys);
      logLine(`▸ Cleaning ${allKeys.length} orphaned R2 objects…`);
      try {
        // "keys cleared" — an idempotent R2 delete proves the key is gone,
        // not that an object was ever there (the incident's phantom "3
        // removed" claim was three keys a failed upload never wrote).
        const delData = await deleteAssets(allKeys);
        logLine(`✓ R2 cleanup: ${(delData.deleted || []).length} keys cleared`, 'log-ok');
      } catch (err) {
        logLine(`⚠ R2 cleanup ${err.status ? 'partial' : 'failed'}: ${err.message}`, 'log-err');
      }
      setPendingR2Deletes(_pendingR2Deletes.filter(d => d.surface === 'library'));
      // Those objects are gone for good and the removal is now committed to main,
      // so retire any sessionTrash rows that pointed at them — a ↩ RESTORE that
      // can't bring the media back is the confusing state we're closing.
      dropTrashForDeletedR2(pubR2);
    }

    // Everything just committed is now live on main — promote it to the "imported"
    // (live) baseline, exactly as a fresh sync would. Without this, items published
    // earlier in the same session stay flagged as "new/local", so trashItem() reads
    // them as never-published and DECREMENTS the stage counter (canceling a pending
    // add that no longer exists) instead of staging a deletion. That's why deleting a
    // just-published frame produced no Publish indicator until the page was refreshed
    // and re-synced (which finally tagged it _imported). Marking here closes that gap.
    // (_imported is stripped from the published JSON in buildBundle, so this never
    // leaks into committed data; save() drops these from localStorage and the
    // post-publish sync below re-imports them as the canonical copy.)
    ['buffer', 'archive', 'wallpapers', 'barrel', 'library'].forEach(surface => {
      STATE[surface].forEach(e => { e._imported = true; });
    });
    // Only published posts were committed — drafts stay local & unpublished.
    STATE.posts.forEach(p => { if (!p.status || p.status === 'published') p._imported = true; });

    clearStage();
    renderPublish();
    // Inked receipt (craft pass): the durable record of the stamp landing.
    // The toast stays — it announces; the receipt persists in the view.
    const receiptSlot = document.getElementById('publish-receipt-slot');
    if (receiptSlot) {
      const t = new Date();
      const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      receiptSlot.innerHTML =
        `<span class="publish-receipt">▲ PUBLISHED · ${hhmm} · ${data.sha.slice(0, 7)}</span>`;
    }
    toast('✓ Published! Deploy in progress…', 'success');
    setTimeout(syncFromServer, 2500);

  } catch (err) {
    if (err.status === 401) {
      logLine('✕ Session expired — please log in again', 'log-err');
      return;   // the API layer already dropped to the login modal
    }
    if (err.offline) {
      logLine('⊘ Offline — publish was NOT sent. Everything is still staged locally.', 'log-err');
      toast('⊘ Offline — publish not sent; changes are still staged. Retry when the signal returns.', 'error');
      return;
    }
    if (isNotConfigured(err)) {
      // User-initiated, so it deserves a clear answer — but a warning, not a
      // fault: the instance simply has no GitHub backing. Changes stay staged.
      logLine('⊘ GitHub publish is not configured on this instance.', 'log-err');
      logLine('  Set the GITHUB_TOKEN + GITHUB_REPO secrets to enable it (see setup.md).');
      logLine('  Your changes are still staged locally.');
      showToast('⊘ GitHub publish not configured — changes remain staged locally', { kind: 'warning', id: 'publish-noconf' });
      return;
    }
    if (err.status === 0) {
      // Dropped mid-flight (tunnel case): we cannot know if the commit landed.
      // Never auto-retry — verify first, or a duplicate commit stacks on main.
      logLine(`✕ ${err.message} — the commit did NOT confirm. Changes are still staged locally.`, 'log-err');
      logLine('▸ If the signal dropped after send, check github.com for the commit before re-publishing.', 'log-info');
      toast('⚠ Publish did not confirm — still staged. Check GitHub before retrying.', 'error');
      return;
    }
    if (err.status === 503 && err.data?.code === 'guard_check_failed') {
      // The worker could not read main to check whether this publish would
      // blank a live manifest, so it refused rather than guess. Transient by
      // definition (rate limit, GitHub 5xx, a dropped connection) — nothing was
      // committed and everything is still staged, so the answer is simply to
      // try again in a moment. Deliberately NOT auto-retried: if GitHub is
      // having a minute, hammering it is not help.
      logLine(`✕ ${err.message}`, 'log-err');
      logLine('▸ Nothing was committed. Wait a few seconds and press Publish again.', 'log-info');
      toast('⚠ Publish held — couldn\'t verify main. Nothing committed; retry shortly.', 'error');
      return;
    }
    if (err.status === 409 &&
        (err.data?.code === 'stale_base' || err.data?.code === 'empty_overwrite_blocked')) {
      // This device published on top of stale state (another device moved main,
      // or this PWA never re-synced after a reload). Nothing was committed — the
      // staged changes are intact. Pull main so local state is fresh, then the
      // user re-publishes on top of it. This is the cross-device guard doing its
      // job, not a failure.
      logLine(`✕ ${err.message}`, 'log-err');
      logLine('▸ Auto-syncing from main… re-publish once it completes.', 'log-info');
      toast('⚠ Out of sync with main — pulling latest, then re-publish.', 'error');
      syncFromServer();
      return;
    }
    logLine(`✕ ${err.message}`, 'log-err');
    // "Not Found" / "Bad credentials" from GitHub are config mistakes with
    // known fixes — say the fix, not just the symptom (cold run 4's publish
    // failed with a bare "Not Found" over a mistyped GITHUB_REPO secret).
    const hint = _githubHint(err.message);
    if (hint) logLine(`▸ ${hint}`, 'log-info');
    toast(`⚠ Publish failed: ${err.message}${hint ? ` — ${hint}` : ''}`, 'error');
  } finally {
    endProgress('publish');
    if (btn) btn.disabled = false;
  }
}
