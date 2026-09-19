// OAKLENS Field Console — chrome.
//
// The bottom layer of the console UI: toast, theme, the view router, sheets and
// their drag-to-dismiss, sticky headers, keyboard insets, stage indicators,
// dropzone wiring, and the HTML escapers. Everything here is generic UI
// plumbing — it knows nothing about buffers, frames, posts or publishing.
//
// It imports NO surface, and that is load-bearing: every other console module
// sits above this one, so a dependency pointing outward from here would put a
// cycle in the module graph. Where this layer used to name a surface directly —
// which renderer a view uses, what a long press offers — the surface now
// registers itself instead (registerView / registerLongPress, wired in init()).
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { showToast } from '../console-telemetry.js';
import { STATE, totalStaged } from '../console-state.js';

// ============== TOAST ==============
// Thin wrapper over the telemetry engine — every legacy call site gets
// coalescing, severity-aware lifetimes, and the stack cap for free.
export function toast(msg, kind = "info") {
  showToast(msg, { kind });
}

// ============== THEME — STUDIO (dark) / DAYLIGHT (light) ==============
// The <head> boot script already resolved the pre-paint theme; this section
// owns the toggle + persistence. Default follows the system; a manual choice
// sticks via localStorage (same pattern as the sidebar collapse).
const THEME_KEY = "console_theme";
const THEME_BAR = { dark: "#000000", light: "#f4f1ea" };   // matches --surface-0

// localStorage THROWS rather than returning null in a partitioned browser or
// with site data blocked, and themeInit() runs at boot — so an unguarded read
// here took the whole console down before it painted a pixel. Every other
// surface already try/catches its storage access; console-state.js states the
// rule as "guard the block, never the function", which is what these are: the
// block is the access itself, and a theme preference that cannot be read or
// kept is a degraded preference, never a failed boot.
const themePref = () => {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
};
const rememberTheme = (mode) => {
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* preference won't stick; the theme still applies */ }
};

export function applyTheme(mode) {
  document.documentElement.dataset.theme = mode === "light" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_BAR[mode] || THEME_BAR.dark);
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    // Glyph shows what a tap switches TO: sun from the studio, lamp from the field.
    btn.textContent = mode === "light" ? "◗" : "☀";
    btn.title = mode === "light" ? "Switch to STUDIO (dark)" : "Switch to DAYLIGHT (light)";
  }
}

export function themeInit() {
  const saved = themePref();
  const system = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(saved || system);
  // No manual override → keep tracking the system as it changes (e.g. iPadOS
  // auto dark at sunset). A saved choice always wins.
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", e => {
    if (!themePref()) applyTheme(e.matches ? "light" : "dark");
  });
}

export function themeToggle() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  rememberTheme(next);
  applyTheme(next);
}

// ============== STICKY HEADERS (iOS large-title compression) ==============
// In the tab-bar band, view headers pin to the top as glass and compress once
// the content starts moving. One passive scroll listener, one body class —
// the size/padding change is pure CSS transition.
export function _initStickyHeaders() {
  const main = document.querySelector(".main");
  if (!main) return;
  let raf = 0;
  main.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      document.body.classList.toggle("hdr-compact", main.scrollTop > 24);
    });
  }, { passive: true });
}

// ============== ACTION SHEET (long-press context menu) ==============
// Generic bottom action sheet. Long-press on a buffer frame opens one with
// that frame's actions — the touch replacement for the hover action cluster.
let _actionSheetActions = [];

export function openActionSheet(title, actions) {
  const t = document.getElementById("action-sheet-title");
  const list = document.getElementById("action-sheet-items");
  const ov = document.getElementById("action-sheet");
  if (!t || !list || !ov) return;
  _actionSheetActions = actions;
  t.textContent = title;
  list.innerHTML = actions.map((a, i) =>
    `<button class="sheet-item${a.danger ? " danger" : ""}" onclick="_actionSheetRun(${i})">
       <span class="sheet-icon">${a.icon || "·"}</span> ${a.label}
     </button>`).join("");
  ov.classList.remove("hidden", "closing");
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("open")));
}

export function _actionSheetRun(i) {
  const fn = _actionSheetActions[i]?.fn;
  closeActionSheet();
  if (fn) fn();
}

export function closeActionSheet() {
  const ov = document.getElementById("action-sheet");
  if (!ov || ov.classList.contains("hidden")) return;
  ov.classList.remove("open");
  setTimeout(() => ov.classList.add("hidden"), 380);
}

// Long-press detection on buffer frames (coarse pointers only). Delegated on
// the stable container; >10px of travel or an early lift cancels, so scroll
// and plain taps are never hijacked. Burst-link mode owns its own taps.
let _lpFired = false;   // swallow the ghost click that trails a fired long-press

// Surfaces register their own menus rather than being named here. This layer
// owns the *gesture*; what a long press offers is the surface's business. The
// menu was hard-coded to the buffer's four frame actions, which meant the
// lowest layer of the console reached up into three surfaces above it —
// including bufferFocal(), which lives higher still.
//
// `enabled` is checked at pointerdown, exactly where the old `|| burstLinkMode`
// test sat, so a surface that owns its own taps (Link mode) suppresses the
// press before the timer starts rather than after it fires.
const _longPressTargets = [];

export function registerLongPress(config) {
  _longPressTargets.push(config);
}

export function _initLongPress() {
  for (const cfg of _longPressTargets) _wireLongPress(cfg);
  // One global swallow, not one per host: the ghost click lands on document.
  document.addEventListener("click", e => {
    if (_lpFired) { e.stopPropagation(); e.preventDefault(); _lpFired = false; }
  }, true);
}

function _wireLongPress({ hostId, itemSelector, title, actions, enabled }) {
  const host = document.getElementById(hostId);
  if (!host) return;
  let timer = 0, x0 = 0, y0 = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  host.addEventListener("pointerdown", e => {
    _lpFired = false;
    if (!matchMedia("(pointer: coarse)").matches) return;
    if (enabled && !enabled()) return;
    const item = e.target.closest(itemSelector);
    if (!item) return;
    x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => {
      timer = 0;
      const menu = actions(item.dataset.id, item);
      if (!menu || !menu.length) return;
      // The lift that ends this press still synthesizes a click — without the
      // flag it would land on the fresh sheet's backdrop and dismiss it.
      _lpFired = true;
      setTimeout(() => { _lpFired = false; }, 700);   // in case no click arrives (iOS)
      if (navigator.vibrate) navigator.vibrate(10);
      openActionSheet(title, menu);
    }, 450);
  });
  host.addEventListener("pointermove", e => {
    if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel();
  });
  host.addEventListener("pointerup", cancel);
  host.addEventListener("pointercancel", cancel);
}

// ============== KEYBOARD INSETS (visualViewport → --kb-inset) ==============
// iPadOS never resizes the LAYOUT viewport for the on-screen keyboard — only
// the visual viewport shrinks. Height-bound surfaces (the FN compose) and
// bottom-pinned chrome would sit behind the keys without this. We publish the
// stolen height as --kb-inset and flag body.kb-open so CSS can duck the tab
// bar and shrink the writing surface to what is actually visible.
//
// THE DEADBAND IS LOAD-BEARING, not a tidy-up. iPadOS 26 web apps report a
// visual viewport that is persistently tens of px shorter than the layout
// viewport with no keyboard anywhere — so the raw difference is not "the
// keyboard", it is a standing offset. Published as-is it silently shortens
// every surface that subtracts --kb-inset (the FN compose, now the Pulse
// studio) for the entire session, which looks like a layout bug and is
// invisible to reason about. Anything under the same 80px that already
// gates body.kb-open is not a keyboard, so it publishes zero.
export const KB_MIN = 80;

export function _initKeyboardInsets() {
  const vv = window.visualViewport;
  if (!vv) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const raw = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    // >80px = a real keyboard, not a URL-bar twitch, a floating mini-keyboard,
    // or the iPadOS 26 standing offset.
    const open = raw > KB_MIN;
    document.documentElement.style.setProperty("--kb-inset", (open ? raw : 0) + "px");
    document.body.classList.toggle("kb-open", open);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  update();
}

// ============== VIEW ROUTING ==============
// Views reachable only through the More sheet — the More tab lights up as
// their proxy in the tab bar.
const MORE_VIEWS = ["wall", "barrel", "friends", "library", "audio", "cards", "pulse", "bench"];

// Surfaces register themselves; the router does not know them by name. Each
// entry is { render, onLeave? } — `render` draws the view, `onLeave` cleans up
// when the user navigates away from it.
const _views = new Map();

export function registerView(name, handlers) {
  _views.set(name, typeof handlers === "function" ? { render: handlers } : handlers);
}

// Redraw a surface WITHOUT navigating to it — the same registry the router
// uses, so anything that can be shown can be refreshed.
//
// This is the third seam, and it exists for the same reason as the other two.
// Low-level code often has to redraw a surface above it: the upload queue marks
// a frame done and the buffer must repaint. Naming renderBuffer() there makes
// the queue import the buffer, while the buffer's ingest already calls into the
// queue — a cycle, and cycles are what re-version every module whenever one
// changes. Asking for a surface by name costs one map lookup and removes the
// import entirely.
//
// Callers pass a VIEW name ('wall'), which is not always the STATE key
// ('wallpapers'); translating between the two is the caller's business, not
// this layer's.
export function refreshSurface(name) {
  _views.get(name)?.render?.();
}

// Test seams. Registration replaced a hard-coded table, which traded a compile-
// time mistake ("renderWall is not defined") for a silent one — miss a
// registerView() call and the nav button just does nothing, which is exactly the
// class of dead control this refactor already shipped once. These let
// tests/console-boot.test.js assert the markup's data-view targets and the
// registered names are the same set.
export function _registeredViews() { return [..._views.keys()]; }
export function _registeredLongPress() { return _longPressTargets.slice(); }

// Which surface is showing. Seeded from the markup's own .view.active on first
// use so no view name is hard-coded here, then tracked explicitly — reading it
// back off the DOM every time would lose the thread the moment a view has no
// container (a config-gated surface), silently stopping every later onLeave.
let _currentView = null;

export function showView(name) {
  if (_currentView === null) {
    _currentView = document.querySelector(".view.active")?.id.replace(/^view-/, "") ?? null;
  }
  // Run the outgoing view's cleanup before the swap. This replaces a hard-coded
  // `if (name !== "buffer" && burstLinkMode) exitBurstLinkMode()`: Link mode is
  // bound to the buffer surface and can only be active while it is showing, so
  // "leaving buffer" and that condition are the same event — but expressed this
  // way the router needs to know neither burstLinkMode nor exitBurstLinkMode.
  // (Selection is ephemeral and must not persist across surface switches.)
  if (_currentView && _currentView !== name) _views.get(_currentView)?.onLeave?.();
  _currentView = name;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name)?.classList.add("active");
  // Sidebar, tab bar, and More sheet all share the data-view contract.
  document.querySelectorAll(".nav-btn, .tab-btn, .sheet-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(`.nav-btn[data-view="${name}"], .tab-btn[data-view="${name}"], .sheet-item[data-view="${name}"]`)
    .forEach(b => b.classList.add("active"));
  document.getElementById("tab-more-btn")?.classList.toggle("active", MORE_VIEWS.includes(name));
  _views.get(name)?.render?.();
}
export function openPublishView() { showView("publish"); }

// ============== BOTTOM SHEETS ==============
//
// Any `.sheet-overlay` opens and closes the same way, so the mechanics live here
// once. Generalised when Pulse needed a second sheet (its recent list, which the
// mobile layout has no room for as a rail): copying the two-frame open and the
// 380ms teardown into a second module is how two sheets end up animating
// differently a year later.
export function openSheet(id) {
  const ov = document.getElementById(id);
  if (!ov) return;
  ov.classList.remove("hidden");
  // Two-frame open so the slide/fade transitions run from their start values.
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("open")));
}

export function closeSheet(id) {
  const ov = document.getElementById(id);
  if (!ov || ov.classList.contains("hidden")) return;
  ov.classList.remove("open");
  setTimeout(() => ov.classList.add("hidden"), 380);   // past --dur-3
}

// ---- the More sheet (tab bar secondary surfaces) ----
export function openMoreSheet() { openSheet("more-sheet"); }
export function closeMoreSheet() { closeSheet("more-sheet"); }

export function sheetGo(view) {
  closeMoreSheet();
  showView(view);
}

// ============== TOUCH SHEETS — animated dismiss + grabber drag ==============
// In the tab-bar band every modal presents as a bottom sheet (CSS owns the
// geometry); this section owns the exits: an animated hide that slides the
// sheet home, and a pointer-drag on the grabber with flick/threshold dismiss.
const SHEET_MQ = "(max-width: 1180px), (pointer: coarse)";
const _sheetMode = () => matchMedia(SHEET_MQ).matches;

export function hideOverlay(id) {
  const ov = document.getElementById(id);
  if (!ov || ov.classList.contains("hidden")) return;
  if (!_sheetMode()) { ov.classList.add("hidden"); return; }   // desktop: instant
  ov.classList.add("closing");
  setTimeout(() => {
    // Re-open during the exit animation wins — only finish if still closing.
    if (ov.classList.contains("closing")) {
      ov.classList.remove("closing");
      ov.classList.add("hidden");
    }
  }, 230);   // just past --dur-2
}

export function _wireSheetDrag(overlayId, closeFn) {
  const ov = document.getElementById(overlayId);
  const panel = ov?.querySelector(".modal, .sheet");
  const grab = ov?.querySelector(".modal-grabber, .sheet-grabber");
  if (!ov || !panel || !grab) return;
  let y0 = 0, dy = 0, t0 = 0, live = false;
  grab.addEventListener("pointerdown", e => {
    if (!_sheetMode()) return;
    live = true; y0 = e.clientY; dy = 0; t0 = performance.now();
    panel.style.transition = "none";
    grab.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grab.addEventListener("pointermove", e => {
    if (!live) return;
    dy = Math.max(0, e.clientY - y0);          // only downward tracking
    panel.style.transform = `translateY(${dy}px)`;
  });
  const settle = () => {
    if (!live) return;
    live = false;
    const flick = dy > 60 && (performance.now() - t0) < 300;
    if (flick || dy > panel.offsetHeight * 0.3) {
      panel.style.transition = "transform var(--dur-2) var(--ease-out)";
      panel.style.transform = "translateY(105%)";
      closeFn();
    } else {
      panel.style.transition = "transform var(--dur-2) var(--ease-spring)";
      panel.style.transform = "";
    }
    setTimeout(() => { panel.style.transition = ""; panel.style.transform = ""; }, 400);
  };
  grab.addEventListener("pointerup", settle);
  grab.addEventListener("pointercancel", settle);
}

// ============== STAGE INDICATORS (UI) — counters live in console-state.js ==============
export function refreshStageIndicators() {
  const total = totalStaged();
  const btn = document.getElementById("publish-btn");
  const stat = document.getElementById("topbar-stage-stat");
  const pip = document.getElementById("nav-stage-pip");
  // The topbar button is a STATUS LIGHT: lit or unlit, no number. It is a
  // wayfinding control in the corner furthest from a thumb, and as the card
  // system adds change types its count only grew more abstract — "17" tells
  // you nothing you can act on. The number still has two honest homes: the
  // status strip beside it (glanceable telemetry, desktop) and the tab-bar
  // badge on touch, where the tab bar owns publish and there is no strip.
  // The itemised answer lives on the publish page itself.
  // And it is LIT, not merely outlined (2026-09-14, owner's call on phase 2 of
  // the lighting pass). "The publish button with work pending" was already one
  // of the four states design-spec.md §6.5 licenses to carry light, and the
  // only one of the four with no way to express it: the SYS lamp and the
  // progress rail glow in CSS, but this button's indicator is the flat square
  // pip, fenced against exactly that since 2026-08-23 so it can never read as
  // a second SYS lamp. data-lit lights the BUTTON and never touches the pip —
  // and it is the one steady light in the console, so it is also what the
  // canvas bloom pools from (js/console/lighting.js).
  //
  // ⚠️ BOTH publish controls, because they are one control at two breakpoints.
  // The topbar button is `display: none` under 1181px AND on any coarse
  // pointer, where the tab bar owns publish instead — so lighting only the
  // topbar would have shipped a feature that does nothing on an iPad, which is
  // this owner's primary surface. The hidden one measures 0×0 and the bloom
  // skips it, so the pair costs nothing at either width.
  const tabPublish = document.querySelector('.tab-btn[data-view="publish"]');
  if (total > 0) {
    btn.classList.remove("empty");
    btn.dataset.pending = "1";
    btn.setAttribute("data-lit", "accent");
    tabPublish?.setAttribute("data-lit", "accent");
    btn.setAttribute("aria-label", `Publish — ${total} pending change${total === 1 ? '' : 's'}`);
    stat.innerHTML = `<span class="accent">${total} PENDING</span>`;
    pip.style.display = "block";
  } else {
    btn.classList.add("empty");
    btn.dataset.pending = "0";
    btn.removeAttribute("data-lit");
    tabPublish?.removeAttribute("data-lit");
    btn.setAttribute("aria-label", "Publish — no pending changes");
    stat.textContent = "NO PENDING CHANGES";
    pip.style.display = "none";
  }
  // Sidebar counts
  document.getElementById("nav-count-buffer").textContent  = STATE.buffer.length;
  document.getElementById("nav-count-archive").textContent = STATE.archive.length;
  document.getElementById("nav-count-fn").textContent      = STATE.posts.length;
  document.getElementById("nav-count-wall").textContent    = STATE.wallpapers.length;
  document.getElementById("nav-count-barrel").textContent  = STATE.barrel.length;
  document.getElementById("nav-count-friends").textContent = STATE.friends.length;
  document.getElementById("nav-count-library").textContent = STATE.library.length;
  const navAudio = document.getElementById("nav-count-audio");
  if (navAudio) navAudio.textContent = (STATE.audio || []).length;
  // Guarded like audio's, for the same reason: this markup can trail the module
  // in a fork mid-merge, and an unguarded write here throws on boot.
  const navCards = document.getElementById("nav-count-cards");
  if (navCards) navCards.textContent = (STATE.cards || []).length;

  // Tab bar + More sheet mirrors (guarded — markup may trail the module)
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const tabBadge = document.getElementById("tab-publish-badge");
  if (tabBadge) { tabBadge.textContent = total; tabBadge.classList.toggle("zero", total === 0); }
  setTxt("tab-count-buffer",  STATE.buffer.length  || "");   // :empty hides zeros
  setTxt("tab-count-fn",      STATE.posts.length   || "");
  setTxt("tab-count-archive", STATE.archive.length || "");
  setTxt("sheet-count-wall",    STATE.wallpapers.length);
  setTxt("sheet-count-barrel",  STATE.barrel.length);
  setTxt("sheet-count-friends", STATE.friends.length);
  setTxt("sheet-count-library", STATE.library.length);
  setTxt("sheet-count-audio",   (STATE.audio || []).length);
  setTxt("sheet-count-cards",   (STATE.cards || []).length);
}

// ============== IGNITION (the console armed, while a commit is in flight) ==============
//
// Owner's call, 2026-09-15. The commit used to announce itself by washing the
// whole publish panel in canvas bloom; it now announces itself by ARMING the
// controls — they take the accent and glow hot, like the spoolr dashboard's
// hood ornament coming up to heat, and stay that way until the commit is
// confirmed one way or the other.
//
// ⚠️ Not a fifth licensed light (design-spec.md §6.5): "the publish bar while
// it commits" was already licensed, and this is that same state wearing the
// controls instead of the panel behind them.
//
// The set is the console's action surface at that moment — the two buttons that
// can still change the outcome, and the three topbar chips plus the publish
// control, so the cluster ignites together rather than one chip staying cold
// among its neighbours. Missing ids are skipped: a fork's markup can trail the
// module, and half a set is better than a thrown boot.
const ARMED_CONTROLS = [
  '#gh-publish-btn',        // ▲ PUBLISH TO GITHUB
  '#gh-clear-staged-btn',   // ⌫ CLEAR STAGED
  '#pulse-topbar-btn',      // ☺  post a pulse
  '#theme-toggle',          // ☀  STUDIO / DAYLIGHT
  '#settings-topbar-btn',   // ⚙  settings — carries the logged-in dot
  '#publish-btn',           // the topbar publish control
];

// Must outlast --arm-cool (2.6s), or the attribute is pulled mid-fade and the
// glow snaps off instead of decaying.
const ARM_COOL_MS = 2700;
let _armCoolTimer = 0;

/**
 * Arm or disarm the console. `on` is the whole API — publish.js says what is
 * happening and this decides what that looks like.
 *
 * ⚠️ The two-step is not superstition. A `filter` interpolates only against a
 * matching function list, so going straight from no filter to the hot one makes
 * the control BLINK on rather than ignite. So: set the resting attribute (which
 * declares every function at its no-op value), force one layout flush so the
 * browser actually computes that state, and only then go hot. On the way down
 * the reverse — drop to resting, and remove the attribute only once the cool
 * has finished.
 */
export function setCommitArmed(on) {
  const els = ARMED_CONTROLS
    .map((sel) => document.querySelector(sel))
    .filter(Boolean);
  if (!els.length) return;
  clearTimeout(_armCoolTimer);
  els.forEach((el) => el.setAttribute("data-armed", ""));
  if (on) {
    void document.body.offsetWidth;   // flush, so the resting state is real
    els.forEach((el) => el.setAttribute("data-armed", "on"));
  } else {
    _armCoolTimer = setTimeout(() => {
      els.forEach((el) => el.removeAttribute("data-armed"));
    }, ARM_COOL_MS);
  }
}

// Escape a string for safe injection into innerHTML.
export function escapeHTML(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Escape for embedding inside an onclick="fn('...')" handler: JS-escape the
// single-quoted string body first, then HTML-escape for the attribute context.
// Which build is actually running, read from the page and the service worker
// rather than from a hand-maintained constant, so it cannot drift out of date.
//
// The sidebar footer already carries a version string, but the sidebar is
// display:none below 1180px — so on an iPad, where this console mostly gets
// used, there was no way to tell whether an update had landed. Since a refactor
// deliberately changes nothing visible, "did the PWA refresh?" was unanswerable,
// and a test run against stale code looks exactly like a passing one.
//
// Both halves are observed, not declared. The import map is the page's own
// statement of its module versions, so if a stale field-console.html is being
// served from cache this reports the stale numbers — which is precisely the
// question. The cache name comes from the installed worker and is bumped on
// every deploy. Together they answer whether the update took.
export async function renderBuildStamp() {
  const el = document.getElementById('settings-build');
  if (!el) return;

  let imports = {};
  try {
    imports = JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || '{}').imports || {};
  } catch { /* malformed or absent — reported as unknown below */ }
  const mods = Object.keys(imports).sort().map((path) => {
    const v = (imports[path] || '').match(/\?v=(\d+)/)?.[1];
    return `${path.replace(/^\/js\//, '').replace(/\.js$/, '')} v${v ?? '?'}`;
  });

  let sw;
  try {
    sw = (await caches.keys()).find((k) => k.startsWith('oaklens-console-')) || '// not cached yet';
  } catch { sw = '// cache API unavailable'; }

  el.innerHTML =
    `<div>service worker &nbsp;<span class="accent">${escapeHTML(sw)}</span></div>` +
    `<div style="margin-top:6px; word-break:break-word;">${
      mods.length ? mods.map(escapeHTML).join(' · ') : '// no import map — modules are unversioned'
    }</div>`;
}

// What the device actually gives the console to draw in, next to the build
// stamp and for the same reason: an installed PWA is a black box from the
// outside. A layout that comes up wrong on someone's tablet is otherwise
// diagnosed by guessing at numbers nobody can see — and the two guesses that
// produce an identical-looking gap at the bottom of the screen (a wrong
// safe-area inset vs. a viewport shorter than its window) are told apart by
// exactly these values. iPadOS 26's windowed web apps are the live case:
// env(safe-area-inset-*) is unreliable there, so what the CSS believes and
// what the screen shows have to be readable side by side.
//
// The insets are read back off a probe element rather than assumed, because
// env() is only resolvable in CSS — JS has no other way to see it.
export function _viewportReadout() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;" +
    "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) " +
    "env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v) => Math.round(parseFloat(v) || 0);
  const safe = {
    top: px(cs.paddingTop), right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom), left: px(cs.paddingLeft),
  };
  probe.remove();

  const vv = window.visualViewport;
  const modes = ["standalone", "fullscreen", "minimal-ui", "browser"];
  return {
    safe,
    layout: { w: window.innerWidth, h: window.innerHeight },
    visual: vv
      ? { w: Math.round(vv.width), h: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop) }
      : null,
    screen: { w: window.screen?.width ?? 0, h: window.screen?.height ?? 0 },
    dpr: window.devicePixelRatio || 1,
    mode: modes.find((m) => matchMedia(`(display-mode: ${m})`).matches) || "unknown",
  };
}

// ============== THE BOTTOM DOUBLE-COUNT (iPadOS 26) ==============
// Measured on an iPad Mini, iPadOS 26.5.2, console installed to the Home Screen:
//
//   layout 744x1101 · screen 744x1133 · safe area t32 r0 b20 l0
//
// `layout + safe-top` is exactly `screen`, and the topbar's own geometry
// confirms the canvas starts at screen y=0 — content really does draw under the
// status bar, which is what viewport-fit=cover asks for. So the 32px the system
// reserved for the status bar did not come off the top: it is stranded at the
// BOTTOM, outside the canvas, and nothing the page does can paint there.
//
// The bug we CAN fix is that the device then also reports a 20px bottom inset.
// That inset means "leave room, the home indicator overlaps you" — and it does
// not overlap us, because the system already held 32px below the canvas for it.
// Paying it twice pushes the tab bar's icons a further 20px up from an edge
// they were already short of, which is most of what "the console doesn't fill
// the window" looks like.
//
// So: pad only for whatever the inset asks BEYOND what the system already held.
// The formula can only ever reduce padding, never add it, so the worst case if
// a device reports something strange is losing up to one inset of clearance —
// not chrome pushed off-screen. Browser tabs are left alone: there the
// difference between the window and the screen is just a window, not an inset.
// Takes the readout rather than fetching it, so the arithmetic is a pure
// function of six numbers and can be checked against a real device's reading
// without a real device.
export function _correctSafeBottom(readout) {
  const r = readout || _viewportReadout();
  if (r.mode !== "standalone" && r.mode !== "fullscreen") return null;

  // screen.width/height do not swap with orientation on every engine — take the
  // axis by size and compare like with like.
  const portrait = r.layout.h >= r.layout.w;
  const screenH = portrait
    ? Math.max(r.screen.w, r.screen.h)
    : Math.min(r.screen.w, r.screen.h);
  if (!screenH) return null;

  const held = Math.max(0, screenH - r.layout.h);
  const pad = Math.max(0, r.safe.bottom - held);
  document.documentElement.style.setProperty("--sys-below", held + "px");
  document.documentElement.style.setProperty("--safe-bottom", pad + "px");
  return { held, pad };
}

export function _initViewportFrame() {
  const apply = () => _correctSafeBottom();
  apply();
  // Orientation flips both the insets and which screen axis is the height.
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
}

export function renderViewportStamp() {
  const el = document.getElementById("settings-display");
  if (!el) return;
  const r = _viewportReadout();
  const row = (label, value) =>
    `<div>${escapeHTML(label)} &nbsp;<span class="accent">${escapeHTML(value)}</span></div>`;
  // The shortfall is the whole point of the panel: how much shorter the console's
  // viewport is than the screen it is drawn on. Zero means the console owns its
  // window; a positive number is space the system kept. screen.width/height do
  // not swap with orientation on every engine, so take the axis by size rather
  // than by name and compare like with like.
  const screenH = r.layout.w > r.layout.h
    ? Math.min(r.screen.w, r.screen.h)
    : Math.max(r.screen.w, r.screen.h);
  el.innerHTML =
    row("mode", r.mode) +
    row("layout", `${r.layout.w} x ${r.layout.h}`) +
    row("visual", r.visual ? `${r.visual.w} x ${r.visual.h} @${r.visual.offsetTop}` : "unavailable") +
    row("screen", `${r.screen.w} x ${r.screen.h} @${r.dpr}x`) +
    row("safe area", `t${r.safe.top} r${r.safe.right} b${r.safe.bottom} l${r.safe.left}`) +
    row("held below", `${Math.max(0, screenH - r.layout.h)}px`) +
    row("bottom pad", getComputedStyle(document.documentElement)
      .getPropertyValue("--safe-bottom").trim() || "—") +
    `<div style="margin-top:6px; font-size:0.6rem; line-height:1.6;">` +
    `“held below” is screen the system kept outside the console's canvas — ` +
    `nothing can be drawn there. “bottom pad” is what the chrome adds on top ` +
    `of it, and it drops to 0 when the system already held enough.</div>`;
}

export function escapeAttrJS(str) {
  return escapeHTML(String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// ============== DROPZONE WIRING ==============
export function wireDropzone(id, fileInputId, onFiles) {
  const dz = document.getElementById(id);
  const input = document.getElementById(fileInputId);
  if (!dz || !input) return;
  dz.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files?.length) onFiles([...input.files]);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); })
  );
  ["dragleave", "drop"].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); })
  );
  dz.addEventListener("drop", e => {
    if (e.dataTransfer?.files?.length) onFiles([...e.dataTransfer.files]);
  });
}
