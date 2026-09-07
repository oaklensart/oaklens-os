// OAKLENS Field Console — session.
//
// Login/logout, the auth check, the Settings sheet (including the read-only
// site-template card and its copy-prompt helper), the status dots, the
// session-expiry warning, and the offline indicator.
//
// The offline indicator is the console's reconnect nerve: the `online` event
// resumes interrupted work, and — because iOS Safari does not reliably fire
// `online` for a PWA waking from the background — a visibilitychange fallback
// re-checks on foreground. It is gated on there actually being something to
// resume (a net-failed upload, a deferred library sync, a deferred login sync),
// so an ordinary tab switch stays a no-op. Those three reads are live-binding
// imports from upload/sync/publish; this module never assigns them.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { SESSION_KEY, getToken, setToken, clearToken, _tokenSecondsLeft, isLoggedIn, login, logoutServer, fetchSiteSettings } from '../console-api.js';
import { showToast, setSystemState } from '../console-telemetry.js';
import { toast, hideOverlay, renderBuildStamp, renderViewportStamp } from './chrome.js';
import { _librarySyncFailed } from './sync.js';
import { _hasNetFailedUploads } from './upload.js';
import { syncFromServer, _resumeAfterReconnect, _syncPendingReconnect } from './publish.js';
import { applyPodcastPosture } from './audio.js';

// ============== SESSION AUTH (UI) ==============
// Token storage, JWT parsing, and the /api/auth request live in
// js/console-api.js (SESSION_KEY, getToken, setToken, clearToken, isLoggedIn,
// _tokenSecondsLeft, login). This section owns the login modal + settings UI.

export function logout() {
  clearToken();
  // Retire the console-shell cookie too, so the document gate re-locks for
  // this browser (best-effort — the cookie's own expiry backstops it; the
  // already-loaded shell stays up with the login modal, same UX as before).
  logoutServer().catch(() => {});
  closeSettings();
  checkAuth();
  toast('Logged out', 'info');
}

export async function loginSubmit() {
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const pw = document.getElementById('login-password').value;
  if (!pw) return;

  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = '';

  try {
    const data = await login(pw);
    setToken(data.token);
    _expiryWarned = false;
    document.getElementById('login-password').value = '';
    checkAuth();
    _updateSettingsDots();
    setTimeout(syncFromServer, 200);
  } catch (err) {
    const msg = err.status === 0 ? 'network error — try again' : (err.data?.error || 'invalid credentials');
    if (errEl) errEl.textContent = '✕ ' + msg;
    document.getElementById('login-password').value = '';
    document.getElementById('login-password').focus();
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function checkAuth() {
  setSystemState(isLoggedIn() ? 'idle' : 'logged-out');
  const loginModal = document.getElementById('login-modal');
  if (!loginModal) return;
  if (!isLoggedIn()) {
    loginModal.classList.remove('hidden');
    // Resolve the field NOW, not inside the timer. A deferred document lookup
    // outlives whatever tore the page down around it — in the suite that means
    // the timer firing after the DOM global is gone, which surfaced as an
    // unhandled "document is not defined" that failed CI on a green run.
    const pwField = document.getElementById('login-password');
    if (pwField) setTimeout(() => pwField.focus(), 100);
  } else {
    loginModal.classList.add('hidden');
  }
}

export function openSettings() {
  _renderSettingsStatus();
  _renderSiteSettings();
  renderBuildStamp();   // async; the panel fills in a tick later
  renderViewportStamp();
  document.getElementById('settings-modal').classList.remove('hidden', 'closing');
}

// ---- Site Settings card (starter template, read-only v1) ----
// Shows the live template state from GET /api/site/settings and assembles a
// ready-to-paste prompt for the owner's AI maintainer. Deliberately no write
// path — settings live in site.config.js and deploy with the site.
let _siteSettings = null;

export async function _renderSiteSettings() {
  const el = document.getElementById('site-settings-card');
  if (!el) return;
  try {
    const s = await fetchSiteSettings();
    _siteSettings = s;
    const chip = (label, on) =>
      `<span style="display:inline-block; margin:2px 6px 2px 0; padding:1px 8px;` +
      ` border:1px solid var(--line-2); border-radius:var(--r-1, 3px);` +
      ` color:${on ? 'var(--ink-2, var(--text))' : 'var(--ink-3, var(--text-faint))'};">` +
      `${label} ${on ? '·on' : '·off'}</span>`;
    el.innerHTML =
      `<div>preset <span style="color:var(--accent-text, var(--accent));">${s.theme.preset}</span>` +
      ` · mode ${s.theme.defaultMode} · visitor toggle ${s.theme.toggle ? 'on' : 'off'}</div>` +
      `<div style="margin-top:4px;">${Object.entries(s.pages).map(([k, v]) => chip(k, v)).join('')}</div>` +
      `<div style="margin-top:4px;">${chip('demo mode', s.demoMode)}${chip('git deploy', s.repoConnected)}</div>`;
  } catch {
    _siteSettings = null;
    el.innerHTML = '// unavailable — the worker answers /api/site/settings once deployed';
  }
}

// ---- First run ----
//
// A console that has never published anything belongs to someone who has been
// an owner for about ninety seconds. The cold run got a live site, opened the
// console, and had nowhere to learn the four things every new owner asks in
// their first five minutes. All four answers already existed; none of them was
// discoverable, which is the same as not existing.
//
// Two conditions, both required, so this never surprises a working site:
//   · nothing published yet — a real site has posts, frames or archive entries
//   · not dismissed before — one localStorage key, set on close
// The key is checked FIRST and is the cheap one, so the usual path is a single
// read and a return.
const WELCOME_KEY = 'oaklens-console-welcomed';

export function maybeShowWelcome(state) {
  let seen = false;
  try { seen = localStorage.getItem(WELCOME_KEY) === '1'; } catch { /* private mode */ }
  if (seen) return;
  const empty = ['posts', 'buffer', 'archive', 'wallpapers', 'library']
    .every((k) => !(state?.[k] || []).length);
  if (!empty) {
    // An existing site should never see this, and should never see it LATER
    // either — mark it read rather than leaving a card primed to appear the
    // first time someone empties their buffer.
    dismissWelcome();
    return;
  }
  const el = document.getElementById('welcome-card');
  if (!el) return;
  el.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
}

export function dismissWelcome() {
  try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* private mode */ }
  const el = document.getElementById('welcome-card');
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => el.classList.add('hidden'), 200);
}

// ---- Instance posture (boot) ----
// Two config flags the shell reflects without a reload: demoMode shows the
// topbar "DEMO · BROWSE-ONLY" badge (writes answer 403 demoMode — see
// worker.js DEMO_LOCKED_ROUTES), and repoConnected swaps the publish card's
// deploy line from "run npx wrangler deploy" (the shipped default — true for
// an unconnected fork) to the auto-deploy promise, which is only true once
// the repo is wired to Cloudflare Builds. Config-driven because a Worker
// cannot detect its own git integration. Failure here is cosmetic: the
// defaults in the markup already tell a fork the truth.
export async function applyInstancePosture() {
  let s;
  try { s = await fetchSiteSettings(); } catch { return; }
  _siteSettings = s;
  const badge = document.getElementById('demo-badge');
  if (badge && s.demoMode) badge.style.display = '';
  const hint = document.getElementById('publish-deploy-hint');
  if (hint) {
    // Also PARKED ON THE ELEMENT, not just rendered into it. publish.js sits
    // below this module in the layer order and cannot import from it, but it
    // has to tell the truth about what a finished publish just did — "Cloudflare
    // is rebuilding" is a lie on an unconnected fork, and it was the exact lie
    // that hid a broken deploy through a whole cold run. A dataset flag is a
    // DOM read, not an upward import.
    hint.dataset.repoConnected = s.repoConnected ? '1' : '0';
    if (s.repoConnected) {
      hint.textContent = 'Cloudflare rebuilds from the repo — live in about a minute. No ZIP, no terminal, no cleanup.';
    }
  }
  applyRingPosture(s.webring);
  // The Audio shelf's feed card. Fed from HERE rather than fetched again: this
  // is the one place the console reads GET /api/site/settings, and audio.js
  // sits below this module in the layer order, so a plain import is legal and
  // a second request would only be a second chance to disagree.
  applyPodcastPosture(s.podcast);
}

// ---- ANALOGS.NETWORK: the ring card in the NETWORK view ----
//
// Mirrors analogs.network's own join overlay. The two constants below are
// duplicated from src/shared/webring.js — the source of truth — because this
// is browser code and cannot import from the Worker's src/ tree. The
// duplication is pinned by tests/webring.test.js so the two cannot drift.
//
// ORDER IS PART OF THE CONTRACT: the email asks the applicant to pick a
// discipline BY NUMBER, so renumbering this list changes what they are asking
// for. It is the ring's palette order (nodes/node.schema.json).
const RING_DISCIPLINES = [
  'Photography', 'Digital Art', 'Writing', 'Code', 'Music', 'Design', 'Architecture',
];
const RING_HOST = 'analogs.network';

// Assembled at runtime, never a literal in the markup. The console document
// goes through the same HTMLRewriter as every public page, and its
// `a[href^="mailto:"]` handler would rewrite a literal ring address to this
// site's own contact address — silently, and only in production.
export function _wireRingJoin() {
  const cta = document.getElementById('ring-join-cta');
  if (!cta) return;
  const body = [
    'my site: ',
    'my name (or studio): ',
    'my discipline (pick a number): ',
    ...RING_DISCIPLINES.map((m, i) => `  [${i + 1}] ${m.toLowerCase()}`),
    '',
  ].join('\r\n');
  cta.href = 'mailto:' + ['themonitor', RING_HOST].join('@')
    + '?subject=' + encodeURIComponent('add me')
    + '&body=' + encodeURIComponent(body);
}

// Upgrade the card from the join pitch to the membership state. The markup's
// default is the fork truth ("not on the ring yet"), so a failed settings
// fetch leaves an honest card rather than a wrong one.
export function applyRingPosture(webring) {
  if (!webring) return;
  const id = String(webring.node).padStart(3, '0');
  const status = document.getElementById('ring-status');
  if (status) status.textContent = `// on the ring · node ${id} · ${webring.slug}`;
  const cta = document.getElementById('ring-join-cta');
  if (cta) {
    cta.href = `https://${RING_HOST}/#/${webring.slug}`;
    cta.textContent = 'View your node ↗';
  }
}

export function copySiteSettingsPrompt() {
  const s = _siteSettings;
  const cur = s
    ? `  preset=${s.theme.preset} defaultMode=${s.theme.defaultMode} toggle=${s.theme.toggle}\n` +
      `  pages: ${Object.entries(s.pages).map(([k, v]) => `${k}:${v}`).join(', ')}`
    : '  (unavailable — describe your current setup)';
  const prompt =
// Deliberately does NOT name a discipline. Every fork owner copies this
// straight into an assistant, so "my Oaklens OS photography site" (what it said
// until 2026-08-13) handed a writer or a musician a prompt that described
// someone else's practice — and the assistant would then reason from it.
`You are the AI maintainer for my Oaklens OS site.

Current settings (from /api/site/settings):
${cur}

Change request: <DESCRIBE THE CHANGE — e.g. "switch to the passe-partout
preset and enable theWall page">

Ground rules:
- Site settings live in site.config.js (theme{}, pages{}, nav[]).
- Theme presets are token blocks in css/main.css; the design spec is
  docs/starter-template/design-spec.md — follow it.
- Do not modify worker auth/publish/portal code for a settings change.
- Run \`npm test\` and keep it green. Commit with a clear message.`;
  navigator.clipboard.writeText(prompt).then(
    () => showToast('AI-maintainer prompt copied', { kind: 'success' }),
    () => showToast('Copy failed — clipboard unavailable', { kind: 'error' }),
  );
}

export function closeSettings() {
  hideOverlay('settings-modal');
}

export function _renderSettingsStatus() {
  const el = document.getElementById('settings-status');
  if (!el) return;
  const ok = isLoggedIn();
  el.innerHTML =
    `<span style="color:${ok ? 'var(--green)' : 'var(--accent)'};">` +
    `${ok ? '✓' : '✕'} Session ${ok ? 'active' : 'not authenticated'}</span>`;
}

export function _updateSettingsDots() {
  const color = isLoggedIn() ? 'var(--green)' : 'var(--accent)';
  ['settings-dot', 'sidebar-settings-dot', 'sheet-settings-dot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.background = color;
  });
}

// ---- Session expiry warning ----
// The 24h token used to lapse silently and surface only as a 401 mid-publish.
// Poll once a minute: warn ~10 min out, and drop to the login modal on expiry
// so a long editing session never loses a publish to a surprise auth failure.
let _expiryWarned = false;
export function _checkSessionExpiry() {
  if (!getToken()) return;            // logged out — checkAuth/login modal owns this
  const left = _tokenSecondsLeft();
  if (left <= 0) {
    clearToken();
    checkAuth();
    _updateSettingsDots();
    toast('Session expired — please log in again', 'error');
    _expiryWarned = false;
    return;
  }
  if (left <= 600 && !_expiryWarned) {
    _expiryWarned = true;
    toast(`⚠ Session expires in ~${Math.ceil(left / 60)} min — re-auth soon to avoid losing a publish`, 'error');
  }
}

// ---- Offline indicator (lite PWA) ----
// Self-contained banner — no markup template changes. Surfaces connectivity so
// it's obvious in the field when a change can't sync yet.
export function _initOfflineIndicator() {
  const el = document.createElement('div');
  el.id = 'offline-indicator';
  el.textContent = "⚠ OFFLINE — changes won't sync until reconnected";
  el.style.cssText =
    'position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:9999;' +
    'background:var(--accent);color:#000;font-family:var(--font-mono);font-size:0.62rem;' +
    'letter-spacing:1.5px;padding:6px 14px;border-radius:4px;display:none;pointer-events:none;';
  document.body.appendChild(el);
  const sync = () => { el.style.display = navigator.onLine ? 'none' : 'block'; };
  window.addEventListener('online', () => { sync(); toast('✓ Back online', 'success'); _resumeAfterReconnect(); });
  window.addEventListener('offline', () => { sync(); toast("⚠ Offline — changes won't sync", 'error'); });
  // iOS Safari doesn't reliably fire `online` for a PWA resuming from the
  // background — the radio can come back while the page is suspended and no
  // event ever lands. Foregrounding is the moment the user is looking again,
  // so re-check then. Gated on there being something to actually resume, so an
  // ordinary tab switch stays a no-op (no stray toasts, no redundant syncs).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    sync();
    if (navigator.onLine && (
      _hasNetFailedUploads() || _librarySyncFailed || _syncPendingReconnect)) {
      _resumeAfterReconnect();
    }
  });
  sync();
}
