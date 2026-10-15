// OAKLENS // FIELD CONSOLE — network & API layer (ES module).
//
// Phase 4 of the console decomposition: every request the console makes goes
// through this module. apiFetch standardizes the auth header, JSON parsing,
// error shaping (ApiError), and 401 handling — an expired session clears the
// token and drops to the login modal in one place instead of per call site.
// The exported endpoint wrappers are the only functions that touch fetch();
// UI flows in field-console.html orchestrate them and own all toasts,
// rendering, and optimistic-update rollback.
//
// Error contract: wrappers either resolve with the parsed response body or
// throw ApiError. err.status === 0 means the request never completed — the
// network failed, the per-class deadline (API_TIMEOUTS) expired, or the
// device is offline (err.offline === true, thrown without touching the
// radio and never latched red — the lamp already shows OFFLINE).
// err.status === 401 means the session expired (already handled centrally —
// callers usually just return); anything else is a server-reported error with
// the server's message. AbortError passes through untouched — only when the
// caller's own signal fired — so callers can distinguish a user-driven cancel
// from a failure.
//
// Cellular hardening: idempotent wrappers retry transient failures (status 0
// and 502/503/504) with exponential backoff inside one telemetry span, so the
// lamp stays honestly busy through the backoff. publishFiles NEVER
// auto-retries — a lost response can mean the commit actually landed, and a
// blind retry would double-commit; the publish flow surfaces that explicitly.
//
// Telemetry: every request runs inside a beginActivity() span, so the system
// lamp flickers amber while anything is in flight and latches red when a
// request fails (per-endpoint channel/label via the wrappers' tel option;
// latch:false demotes a failure to a ledger entry — used for retried upload
// attempts, cosmetic fetches, and wrong-password logins).
//
// Transitional coupling: the central 401 handler pings window.checkAuth and
// window._updateSettingsDots (login-modal UI in console-ui.js).

import { beginActivity, latchError, logEvent, setSystemState, showToast } from './console-telemetry.js';

// ============== SESSION / TOKEN ==============
// The console JWT lives in sessionStorage only (cleared on tab close) — never
// localStorage, never a cookie. See manual §5.2.
export const SESSION_KEY = 'oaklens_session';

export function getToken() { return sessionStorage.getItem(SESSION_KEY) || null; }
export function setToken(token) { sessionStorage.setItem(SESSION_KEY, token); }
export function clearToken() { sessionStorage.removeItem(SESSION_KEY); }

// Seconds until the JWT expires — 0 for a missing, malformed, or lapsed token.
export function _tokenSecondsLeft() {
  const token = getToken();
  if (!token) return 0;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const pl = JSON.parse(atob(b64 + pad));
    return Math.max(0, (pl.exp || 0) - Math.floor(Date.now() / 1000));
  } catch { return 0; }
}

export function isLoggedIn() { return _tokenSecondsLeft() > 0; }

// ============== CORE REQUEST HELPER ==============
export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;   // HTTP status; 0 = the network itself failed
    this.data = data;       // parsed response body, when there was one
  }
}

// A 501 { notConfigured: true } from the worker means the feature's optional
// secret isn't set on this instance — deliberate state, not a fault. Callers
// branch on this to show "not configured" copy instead of an error toast, and
// apiFetch keeps it off the red system lamp.
export const isNotConfigured = (err) =>
  err instanceof ApiError && err.data?.notConfigured === true;

// A 403 { demoMode: true } means this instance is a public demo whose writes
// are deliberately off (site.config.js → demoMode). Same posture as
// notConfigured: state, not fault — info copy, no red latch, no retry.
export const isDemoMode = (err) =>
  err instanceof ApiError && err.data?.demoMode === true;

// ============== TIMEOUTS & RETRY POLICY ==============
// Per-class request deadlines (ms). A dying cellular socket can hang for
// minutes without erroring — a deadline turns that into a retryable failure
// so the UI always resolves. 0 disables (multi-minute RAW downloads).
// Exported so field tuning (or tests) can adjust without a deploy.
// commit is longer than json on purpose: a publish is several GitHub
// round-trips behind one request, it is never auto-retried, and on a weak
// link it legitimately outran 30s — the owner's iPad gave up on a commit that
// went through first time on a hotspot (2026-10-14). The deadline only decides
// when we stop waiting, so waiting longer costs nothing but a slower "did not
// confirm" on a socket that is truly dead.
export const API_TIMEOUTS = { json: 20000, upload: 90000, commit: 60000, raw: 0 };

// Compose the caller's signal (manual SKIP) with the deadline. In Chromium and
// Firefox the abort *reason* survives composition, so a timeout surfaces as
// TimeoutError and a user cancel as AbortError. WebKit does not: it rejects a
// deadline-aborted fetch with its own AbortError ("Fetch is aborted"), so
// _requestOnce asks the signals themselves which one fired.
function _composeSignal(deadline, upstream) {
  if (!deadline) return upstream;
  if (!upstream) return deadline;
  if (AbortSignal.any) return AbortSignal.any([upstream, deadline]);
  const c = new AbortController();   // Safari < 17.4 fallback
  const relay = (sig) => sig.addEventListener('abort', () => c.abort(sig.reason), { once: true });
  relay(upstream); relay(deadline);
  return c.signal;
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Transient = worth retrying: never-completed requests (unless offline — the
// reconnect listener owns that) and Cloudflare's transient 5xx trio.
const _retryable = (err) =>
  err instanceof ApiError && !err.offline && !err.portal &&
  (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504);

// One attempt: no telemetry, throws ApiError / AbortError. 401 side effects
// (token drop, login modal, NO.AUTH baseline) happen here exactly once.
async function _requestOnce(path, { method, headers, body, auth, signal, raw, timeoutMs }) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const e = new ApiError('offline — request not sent', 0);
    e.offline = true;
    throw e;
  }

  const h = { ...headers };
  if (auth) {
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }

  const deadline = timeoutMs ? AbortSignal.timeout(timeoutMs) : null;
  let res;
  try {
    res = await fetch(path, { method, headers: h, body, signal: _composeSignal(deadline, signal) });
  } catch (err) {
    // Only the caller's own signal makes a cancel. Any other abort is a
    // failure: the deadline (named as such even where WebKit calls it plain
    // AbortError), or the browser cutting the request off. Passing those
    // through as AbortError made a Safari timeout look like a SKIP — no
    // retry, no lamp, and a publish that said "Fetch is aborted" instead of
    // "did not confirm, check GitHub" (2026-10-14).
    if (err.name === 'AbortError' && signal?.aborted) throw err;   // caller-driven cancel, not a failure
    if (err.name === 'TimeoutError' || deadline?.aborted) {
      throw new ApiError(`timed out after ${Math.round(timeoutMs / 1000)}s`, 0);
    }
    if (err.name === 'AbortError') throw new ApiError(`network: the request was cut off (${err.message})`, 0);
    throw new ApiError(`network: ${err.message}`, 0);
  }

  if (res.status === 401 && auth) {
    // Session died mid-flight — one handling everywhere: drop the token and
    // fall back to the login modal. Not a system fault, so no red latch —
    // a ledger entry + NO.AUTH baseline.
    logEvent('✕ session expired — please log in again', 'error');
    clearToken();
    setSystemState('logged-out');
    window.checkAuth?.();
    window._updateSettingsDots?.();
    const e = new ApiError('session expired — please log in again', 401);
    e.authExpiry = true;
    throw e;
  }

  if (raw) {
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    return res;
  }

  // A web page where the API's JSON should be is the network lying, not an
  // answer: a captive Wi-Fi portal, or an expired Access session, answering
  // 200 with its sign-in page. It used to parse to {} and fail downstream as
  // "Cannot read properties of undefined (reading 'data/buffer.json')", with
  // the lamp still green (2026-10-06, the Bridge field probe). Named here,
  // once, for every caller (K68).
  if (res.ok && /text\/html/i.test(res.headers.get('content-type') || '')) {
    const e = new ApiError('the network answered with a sign-in page, not the console\'s data', 0);
    e.portal = true;
    throw e;
  }
  const text = await res.text().catch(() => '');
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch {
      if (res.ok) throw new ApiError('the answer could not be read (not JSON)', 0);
    }
  }
  if (data === null) data = {};
  if (!res.ok || data.ok === false) {
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data);
  }
  return data;
}

async function apiFetch(path, { method = 'GET', headers = {}, body, auth = true, signal, raw = false, tel,
                                timeoutMs = API_TIMEOUTS.json, retries = 0 } = {}) {
  const t = { channel: 'net', label: 'NET ▲', latch: true, ...tel };
  const end = beginActivity(t.channel, t.label);   // one span across all attempts

  for (let attempt = 0; ; attempt++) {
    try {
      const out = await _requestOnce(path, { method, headers, body, auth, signal, raw, timeoutMs });
      end(true);
      return out;
    } catch (err) {
      if (err.name === 'AbortError') { end(true); throw err; }
      if (err.authExpiry) { end(true); throw err; }   // logged + handled in _requestOnce

      if (attempt < retries && _retryable(err)) {
        const waitS = Math.pow(2, attempt + 1);   // 2s, 4s, 8s…
        logEvent(`▸ ${t.channel}: retry ${attempt + 2}/${retries + 1} in ${waitS}s — ${err.message}`, 'info');
        await _sleep(waitS * 1000);
        continue;
      }

      // Final failure. Offline is not a system fault (the lamp already shows
      // OFFLINE) — ledger only, never a red latch that outlives the outage.
      // Same for a 501 notConfigured: the feature is off by configuration, and
      // a red latch would cry wolf on every login of a GitHub-less instance.
      if (err.offline) { end(true); logEvent(`⊘ ${t.channel}: offline — not sent`, 'error'); }
      else if (err.portal) {
        // Said once, loudly, whatever the channel: every read behind it is
        // failing for the same reason, and the fix is outside the console.
        end(true);
        latchError('net', 'the network answered with a sign-in page');
        showToast('⚠ The network answered with a sign-in page (Wi-Fi or Access). Sign in there, then come back: nothing here can load until then.',
          { kind: 'error', id: 'net-portal' });
      }
      else if (isNotConfigured(err)) { end(true); logEvent(`▸ ${t.channel}: ${err.message}`, 'info'); }
      else if (isDemoMode(err)) { end(true); logEvent(`▸ ${t.channel}: ${err.message}`, 'info'); }
      else if (t.latch) end(false, err.message);
      else { end(true); logEvent(`✕ ${t.channel}: ${err.message}`, 'error'); }
      throw err;
    }
  }
}

const jsonBody = (obj) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

// ============== AUTH ==============
// auth:false — a 401 here means "wrong password", which must not trigger the
// central expired-session handling. err.data carries the server's message.
// latch:false — a typo shouldn't turn the system lamp red.
export function login(password) {
  return apiFetch('/api/auth', { method: 'POST', auth: false, ...jsonBody({ password }),
    tel: { channel: 'auth', label: 'AUTH ▲', latch: false } });
}

// Clears the console-shell cookie server-side so the document gate re-engages
// (see worker.js). The bearer token is client-held — logout() in console-ui.js
// clears it from sessionStorage; this call only retires the cookie.
// latch:false — a failed logout ping is cosmetic (the cookie still expires).
export function logoutServer() {
  return apiFetch('/api/logout', { method: 'POST', auth: false,
    tel: { channel: 'auth', label: 'AUTH ✕', latch: false } });
}

// ============== R2 UPLOAD / DELETE ==============
/**
 * `meta` is an optional { "<r2 key>": "<style>" } sidecar, ridden by share
 * stamps so the object remembers which style it was painted in (the server
 * writes it as R2 customMetadata — src/api/assets.js). Everything else ignores
 * it, and the server drops anything outside its closed set.
 */
export function uploadFiles(files, { meta, signal, tel } = {}) {
  const fd = new FormData();
  files.forEach(f => fd.append('files', f, f.name));
  if (meta && Object.keys(meta).length) fd.append('meta', JSON.stringify(meta));
  return apiFetch('/api/upload', { method: 'POST', body: fd, signal,
    timeoutMs: API_TIMEOUTS.upload,
    tel: { channel: 'r2', label: 'R2 ▲', ...tel } });
}

// Standard console upload policy: 3 attempts, exponential backoff (2s/4s).
// Resolves { ok, data } on success, { aborted: true } when shouldAbort() turned
// true (the upload-queue SKIP path), and throws the last error otherwise.
// A 401 fails fast — retrying with a dead session can't succeed.
// Telemetry: individual attempts don't latch (latch:false) — only exhausting
// every attempt turns the lamp red. onRetryWait(seconds, attempt) fires before
// each backoff sleep so the UI can show honest "retrying in Ns" feedback.
export async function uploadFilesWithRetry(files, { attempts = 3, signal, shouldAbort, onRetryWait } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (shouldAbort?.()) return { aborted: true };
    try {
      const data = await uploadFiles(files, { signal, tel: { latch: false } });
      return { ok: true, data };
    } catch (err) {
      if (shouldAbort?.()) return { aborted: true };
      if (err.name === 'AbortError' || err.status === 401) throw err;
      if (err.offline) throw err;   // don't burn attempts with no radio — the
                                    // reconnect listener requeues automatically
      lastErr = err;
      if (attempt < attempts) {
        const waitS = Math.pow(2, attempt);
        onRetryWait?.(waitS, attempt);
        logEvent(`▸ r2: retry ${attempt + 1}/${attempts} in ${waitS}s — ${err.message}`, 'info');
        await new Promise(r => setTimeout(r, waitS * 1000));
      }
    }
  }
  latchError('r2', lastErr.message);   // all attempts exhausted — now it's real
  throw lastErr;
}

export function deleteAssets(keys) {
  return apiFetch('/api/delete-assets', { method: 'POST', ...jsonBody({ files: keys }),
    retries: 2,   // idempotent — deleting a deleted key is a no-op
    tel: { channel: 'r2', label: 'R2 CLEAN' } });
}

// ============== PUBLISH / SYNC (GitHub via worker) ==============
export function publishFiles(files, baseSha, allowEmpty) {
  // retries: 0 — NOT idempotent. A lost response can mean the commit landed;
  // a blind retry would stack a duplicate commit. The publish flow tells the
  // user to verify instead.
  // baseSha: the main HEAD this bundle was built on. The worker rejects the
  // publish (409 stale_base) if main has moved since — see console-ui publish flow.
  // allowEmpty: data manifests the console vouches are deliberately emptied
  // (last item trashed this session) — exempted from the empty-overwrite guard.
  return apiFetch('/api/publish', { method: 'POST', ...jsonBody({ files, baseSha, allowEmpty }),
    timeoutMs: API_TIMEOUTS.commit,
    tel: { channel: 'publish', label: 'COMMIT ▲' } });
}

export function syncFiles(filesCsv) {
  return apiFetch(`/api/sync?files=${encodeURIComponent(filesCsv)}`,
    { retries: 2, tel: { channel: 'sync', label: 'SYNC ▼' } });
}

// ============== CLOUD DRAFTS (D1) ==============
export function fetchDrafts() {
  return apiFetch('/api/drafts', { retries: 2, tel: { channel: 'draft', label: 'DRAFT ▼' } });
}
export function pushDraft(draft) {
  // retries: 0 — the write is CONDITIONAL now (draft.base_updated_at; see
  // fnCloudPushDraft). A retry after a lost response would send the same base
  // against a row its own first attempt already advanced, and come back 409 as
  // if another device had edited it. Nothing is lost by not retrying: the draft
  // is safe in localStorage and the next save (or the login sync) reconciles.
  // The conflict handler also recognises its own landed write, so even a lost
  // response can't strand the base version.
  return apiFetch('/api/drafts', { method: 'PUT', ...jsonBody(draft),
    tel: { channel: 'draft', label: 'DRAFT ☁' } });
}
export function deleteDraft(id) {
  return apiFetch('/api/drafts', { method: 'DELETE', ...jsonBody({ id }),
    retries: 1, tel: { channel: 'draft', label: 'DRAFT ✕' } });
}

// ============== PULSE ==============
// The one write path in the console that does NOT stage anything for publish:
// a pulse lands in D1 and is live in seconds, with no commit and no build. That
// is the whole point of the feature, so these deliberately do not touch
// STATE's staging counters.
export function postPulse(pulse) {
  return apiFetch('/api/pulse', { method: 'POST', ...jsonBody(pulse),
    tel: { channel: 'pulse', label: 'PULSE ▲' } });
}
export function retirePulse() {
  return apiFetch('/api/pulse', { method: 'DELETE',
    retries: 1,   // idempotent — retiring a retired pulse is a no-op
    tel: { channel: 'pulse', label: 'PULSE ✕' } });
}
// latch:false — the log is a convenience list. A fork whose D1 has not been
// migrated yet should see the composer, not a red lamp.
//
// The readouts below take `{ timeoutMs, retries }` from a caller that shows
// the last value meanwhile (the Bridge, K68), so a dead network is called in
// seconds, not after the full 20 s deadline and its retries.
export function fetchPulseLog(limit, { timeoutMs, retries = 1 } = {}) {
  return apiFetch(`/api/pulse/log?limit=${encodeURIComponent(limit || 30)}`,
    { retries, timeoutMs, tel: { channel: 'pulse', label: 'PULSE ▼', latch: false } });
}

// ============== OG CARDS ==============
// latch:false — badge decoration; a failure belongs in the ledger, not the lamp.
export function fetchOgCards() {
  return apiFetch('/api/og-cards', { retries: 1, tel: { channel: 'ogc', label: 'OGC ▼', latch: false } });
}

// ============== DEPLOYED VERSION ==============
// Public, never cached (src/api/site-meta.js handleVersion): { version,
// deployed }. The Bridge watches it after a publish to say when the build is
// live. latch:false — a readout, not a fault.
export function fetchVersion({ timeoutMs, retries = 1 } = {}) {
  return apiFetch('/api/version', { retries, timeoutMs, tel: { channel: 'site', label: 'VER ▼', latch: false } });
}

// ============== STORAGE ==============
// How full storage is (src/api/storage.js): measured daily on the server, so
// a read costs no listing. remeasure() asks for a fresh one, which the server
// holds to once per ten minutes. latch:false — a gauge, not a fault.
export function fetchStorage({ timeoutMs, retries = 1 } = {}) {
  return apiFetch('/api/storage', { retries, timeoutMs, tel: { channel: 'site', label: 'STORE ▼', latch: false } });
}
export function remeasureStorage() {
  return apiFetch('/api/storage', { method: 'POST', tel: { channel: 'site', label: 'STORE ↻', latch: false } });
}

// ============== SITE TEMPLATE SETTINGS ==============
// Public read-only endpoint; no auth. latch:false — the Site Settings card
// is informational, a failure belongs in the ledger, not the lamp.
// The first-run welcome is decided by the site, once (src/api/welcome.js).
// latch:false — a welcome that can't be asked about is simply not shown.
export function fetchWelcome() {
  return apiFetch('/api/welcome', { tel: { channel: 'site', label: 'SITE ▼', latch: false } });
}
export function markWelcomed() {
  return apiFetch('/api/welcome', { method: 'POST', tel: { channel: 'site', label: 'SITE ▲', latch: false } });
}

export function fetchSiteSettings() {
  return apiFetch('/api/site/settings', { retries: 1, tel: { channel: 'site', label: 'SITE ▼', latch: false } });
}

// The Publish key, set from the console and kept by the site
// (src/api/publish-key.js). Never read back: GET answers its last four.
export function fetchPublishKey({ check = false } = {}) {
  return apiFetch(`/api/publish/key${check ? '?check=1' : ''}`, { tel: { channel: 'site', label: 'KEY ▼', latch: false } });
}
export function setPublishKey(token, repo) {
  return apiFetch('/api/publish/key', { method: 'PUT', ...jsonBody({ token, repo: repo || undefined }),
    tel: { channel: 'site', label: 'KEY ▲', latch: false } });
}
export function removePublishKey() {
  return apiFetch('/api/publish/key', { method: 'DELETE', tel: { channel: 'site', label: 'KEY ✕', latch: false } });
}

// ============== BENCH (darkroom RAW queue, D1 + B2) ==============
export function fetchBench({ timeoutMs, retries = 2 } = {}) {   // resolves a raw array
  return apiFetch('/api/bench', { retries, timeoutMs, tel: { channel: 'bench', label: 'BENCH ▼' } });
}
export function patchBenchEntry(patch) {
  // json_set on fixed fields — same patch twice converges, safe to retry
  return apiFetch('/api/bench/entries', { method: 'PATCH', ...jsonBody(patch),
    retries: 2, tel: { channel: 'bench', label: 'BENCH ▲' } });
}
export function deleteBenchEntry(id) {
  return apiFetch('/api/bench/entries', { method: 'DELETE', ...jsonBody({ id }),
    retries: 1, tel: { channel: 'bench', label: 'BENCH ✕' } });
}
export function clearBenchDone() {
  return apiFetch('/api/bench/done', { method: 'DELETE',
    retries: 1, tel: { channel: 'bench', label: 'BENCH ✕' } });
}

// Auth-gated blob download — RAW originals stream through the worker's signed
// B2 proxy (/api/bench/raw/{file}); item.raw_url overrides when present.
export async function fetchRawBlob(url) {
  // timeoutMs 0: a 20-80MB RAW over cellular legitimately takes minutes —
  // an arbitrary deadline would kill more downloads than it saves.
  const res = await apiFetch(url, { raw: true, timeoutMs: API_TIMEOUTS.raw,
    tel: { channel: 'bench', label: 'RAW ▼' } });
  return res.blob();
}
