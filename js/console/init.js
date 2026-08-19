// OAKLENS Field Console — init.
//
// The composition root, and the only module that knows every other one. It
// exists so nothing else has to: registerSurfaces() hands chrome its view
// renderers, its leave-cleanups and its long-press menus, and hands sync the
// upload probe — the four seams, all wired in one place. init() then boots
// state, chrome, dropzones, the resume-sync listeners and the service worker,
// and registers itself on DOMContentLoaded.
//
// Being last in the layer order is what lets it import freely: every name here
// points DOWN. Anything that ever needs to point up from a lower module gets a
// registration here instead — that is the pattern, and adding a direct import
// in the other direction is what re-tangles the graph.
//
// Extracted from console-ui.js 2026-07-29 — the last of fifteen. See
// dev/console-module-plan.md.

import { STATE, load, restoreSidebar, restoreFnBar, resetConsole } from '../console-state.js';
import { isLoggedIn } from '../console-api.js';
import { registerView, registerLongPress, refreshStageIndicators, themeInit, wireDropzone, _wireSheetDrag, _initKeyboardInsets, _initViewportFrame, _initStickyHeaders, _initLongPress, closeActionSheet, closeMoreSheet } from './chrome.js';
import { updatePurgeR2Button } from './sync.js';
import { _libraryUploadsPending } from './upload.js';
import { renderWall, renderBarrel, renderNetwork, renderLibrary, wallIngest, libraryIngest } from './more-views.js';
import { renderArchive, archiveIngestPhoto, archiveUpdatePreview, restoreGearMemory, setGearRemember } from './archive.js';
import { renderBuffer, bufferIngest, bufferPromote, bufferRemove, burstLinkMode, burstToggleFrame, enterBurstLinkMode, exitBurstLinkMode } from './buffer.js';
import { renderFN, fnHeroIngest, fnHeroClear, fnSetupEnhancements, _applyFnFrontmatter } from './fn-editor.js';
import { FocalModal, bufferFocal, loadOgCards } from './focal.js';
import { closeAssetLibrary } from './asset-library.js';
import { renderAudio, audioAddFiles } from './audio.js';
import { _pulseCloseLog } from './pulse.js';
import { renderPublish, syncFromServer } from './publish.js';
import { checkAuth, closeSettings, _updateSettingsDots, _checkSessionExpiry, _initOfflineIndicator, applyInstancePosture, _wireRingJoin, maybeShowWelcome } from './session.js';
import { renderBench } from './bench.js';

// ============== INIT ==============
// Develop-in thumbnails (craft pass): grid images carry opacity:0 until
// is-loaded lands. load doesn't bubble but IS capturable, so one document
// listener covers every render path (innerHTML included) with no per-render
// wiring; the sweep catches images whose load beat this listener.
export function wireDevelopIn() {
  const mark = (img) => img.classList.add('is-loaded');
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement) mark(e.target);
  }, true);
  document.querySelectorAll('img').forEach((img) => { if (img.complete) mark(img); });
  // Failsafe for any cache-hit whose load fired before the listener could
  // see it: sweep freshly-inserted subtrees for already-complete images. A
  // thumbnail must never be able to stay at opacity:0.
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        const imgs = node.matches?.('img') ? [node] : node.querySelectorAll?.('img') || [];
        for (const img of imgs) if (img.complete && img.naturalWidth) mark(img);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// The composition root: the one place that knows both the chrome primitives and
// every surface, so neither has to know the other. Runs first in init(), before
// anything can route or long-press.
export function registerSurfaces() {
  // Fourth seam: sync must not commit the library index while library uploads
  // are in flight, and the queue lives above it — hand sync the probe here,
  // where both sides are visible, like every other registration below.
  _registerLibraryUploadProbe(_libraryUploadsPending);

  registerView("buffer", {
    render: renderBuffer,
    // Link mode is entered only from the buffer and its selection is ephemeral,
    // so navigating away backs out of it.
    onLeave: () => { if (burstLinkMode) exitBurstLinkMode(); },
  });
  registerView("archive", renderArchive);
  registerView("fn",      renderFN);
  registerView("wall",    renderWall);
  registerView("barrel",  renderBarrel);
  registerView("friends", renderNetwork);
  registerView("library", renderLibrary);
  registerView("audio",   renderAudio);
  registerView("publish", renderPublish);
  registerView("bench",   () => renderBench().catch(err => console.error('Bench render error:', err)));

  registerLongPress({
    hostId: "buffer-display",
    itemSelector: ".buffer-frame",
    title: "FRAME ACTIONS",
    enabled: () => !burstLinkMode,   // Link mode owns its own taps
    actions: (id) => [
      { icon: "▲", label: "Promote to Archive", fn: () => bufferPromote(id) },
      { icon: "◎", label: "Focal point",        fn: () => bufferFocal(id) },
      { icon: "⛓", label: "Link burst…",        fn: () => enterBurstLinkMode() },
      { icon: "×", label: "Remove frame", danger: true, fn: () => bufferRemove(id) },
    ],
  });
}

export function init() {
  registerSurfaces();
  _applyFnFrontmatter();
  load();
  themeInit();
  restoreSidebar();
  restoreFnBar();
  wireDevelopIn();
  loadOgCards();   // mark frames that already have a live OG card (persists across reloads)
  refreshStageIndicators();
  _updateSettingsDots();
  updatePurgeR2Button();

  wireDropzone("buffer-dropzone", "buffer-file-input", bufferIngest);
  wireDropzone("archive-dropzone", "archive-file-input", archiveIngestPhoto);
  wireDropzone("wall-dropzone", "wall-file-input", wallIngest);
  wireDropzone("fn-hero-slot", "fn-hero-input", fnHeroIngest);
  wireDropzone("library-dropzone", "library-file-input", libraryIngest);
  wireDropzone("audio-dropzone", "audio-file-input", (files) => audioAddFiles(files));
  document.getElementById("fn-hero-clear")?.addEventListener("click", e => {
    e.stopPropagation();
    fnHeroClear();
  });

  // Grabber drag-to-dismiss on every sheet-presented surface (touch band only;
  // the wiring is inert on desktop where modals stay centered dialogs).
  _wireSheetDrag("settings-modal", closeSettings);
  _wireSheetDrag("focal-modal", () => FocalModal.close());
  _wireSheetDrag("asset-library-modal", closeAssetLibrary);
  _wireSheetDrag("more-sheet", closeMoreSheet);
  _wireSheetDrag("pulse-log-sheet", _pulseCloseLog);

  let _lastFocusSync = 0;
  checkAuth();
  _wireRingJoin();          // ring join mailto; must be built at runtime, not markup
  applyInstancePosture();   // demo badge + truthful deploy copy; async, cosmetic
  maybeShowWelcome(STATE);  // first run only; no-ops on a site with any content
  if (isLoggedIn()) {
    setTimeout(syncFromServer, 400);
    _lastFocusSync = Date.now();
  } else {
    const el = document.getElementById('sync-status');
    if (el) el.textContent = '// Log in to enable auto-sync';
  }

  // Auto-sync when the app regains focus. A phone/tablet keeps a PWA's page
  // alive across backgrounding, so init()'s one-shot sync never reruns — a
  // console left open for hours (an iPad mini overnight) silently drifts from
  // main and can then republish stale state over another device's fresh commit.
  // Re-pulling on resume keeps returning-to-the-app fresh. Throttled so rapid
  // app switches don't hammer GitHub; skipped when logged out or offline.
  //
  // Three signals for full Android + iOS coverage, all funneled through one
  // throttle so overlapping events fire at most one sync:
  //   • visibilitychange   — the reliable app/tab foreground signal on both
  //     Android Chrome and iOS Safari, standalone PWAs included.
  //   • focus              — window refocus (desktop, some mobile).
  //   • pageshow(persisted) — back/forward bfcache restore, which on both
  //     platforms can skip visibilitychange entirely.
  const FOCUS_SYNC_MIN_GAP = 60_000;   // at most one resume-driven pull per minute
  function _autoSyncOnFocus() {
    if (document.visibilityState === 'hidden') return;
    if (!isLoggedIn() || !navigator.onLine) return;
    const now = Date.now();
    if (now - _lastFocusSync < FOCUS_SYNC_MIN_GAP) return;
    _lastFocusSync = now;
    syncFromServer();
  }
  document.addEventListener('visibilitychange', _autoSyncOnFocus);
  window.addEventListener('focus', _autoSyncOnFocus);
  window.addEventListener('pageshow', (e) => { if (e.persisted) _autoSyncOnFocus(); });

  // Lite offline shell + session-lifetime watch (field/iPad QOL)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/dev/sw.js').catch(() => {});
  }
  _initOfflineIndicator();
  // Before the keyboard watcher: it reads the same viewport, and the safe-area
  // correction decides how tall the bottom chrome is.
  _initViewportFrame();
  _initKeyboardInsets();
  _initStickyHeaders();
  _initLongPress();
  setInterval(_checkSessionExpiry, 60_000);

  // All six are text inputs now — camera/lens/medium stopped being <select>s
  // when the gear list opened up (2026-08-19), and "input" covers typing and
  // picking a saved suggestion alike.
  ["arch-title","arch-sub","arch-loc","arch-cam","arch-lens","arch-med"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", archiveUpdatePreview);
  });
  // Gear memory: fill the camera/lens/medium suggestion lists and prefill the
  // compose form with the last gear staged. Safe here — load() ran at the top
  // of init(), so the lists can already draw on the frames in STATE.
  restoreGearMemory();
  document.getElementById("arch-gear-remember")?.addEventListener("change", e => {
    setGearRemember(e.target.checked);
  });
  archiveUpdatePreview();

  ["fn-id","fn-title","fn-location","fn-date","fn-body"].forEach(id => {
    // Handled by fnSetupEnhancements — kept for reference
  });
  fnSetupEnhancements();

  renderBuffer();
  renderArchive();
  renderFN();
  renderWall();
  renderBarrel();
  renderNetwork();
  renderLibrary();
  renderAudio();

  document.addEventListener("keydown", e => {
    if (e.altKey && e.key.toLowerCase() === "r") { e.preventDefault(); resetConsole(); }
  });

  // --- Burst linking: frame selection (delegated on the stable buffer container) ---
  document.getElementById("buffer-display")?.addEventListener("click", e => {
    if (!burstLinkMode) return;            // normal click behavior preserved otherwise
    const frame = e.target.closest(".buffer-frame");
    if (!frame) return;
    e.preventDefault();
    e.stopPropagation();
    burstToggleFrame(frame.dataset.id, frame.closest(".buffer-grid")?.dataset.day);
  });

  // --- Escape: close the open sheet, else exit Link mode ---
  // Link mode is entered ONLY by an explicit action — the ⛓ LINK button
  // (toggleBurstLinkMode) or the long-press "Link burst…" menu item. There is
  // deliberately no Shift/keyboard shortcut: a bare Shift used to flip the
  // buffer into Link mode, so ordinary keystrokes hijacked clicks into linking
  // frames "out of nowhere." Escape still backs out cleanly.
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("action-sheet")?.classList.contains("hidden")) { closeActionSheet(); return; }
    if (!document.getElementById("more-sheet")?.classList.contains("hidden")) { closeMoreSheet(); return; }
    if (!document.getElementById("pulse-log-sheet")?.classList.contains("hidden")) { _pulseCloseLog(); return; }
    if (burstLinkMode) { exitBurstLinkMode(); return; }
  });
}

document.addEventListener("DOMContentLoaded", init);
