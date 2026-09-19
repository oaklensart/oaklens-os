// ---- Console login: POST /api/auth, POST /api/logout + failed-auth rate limit ----
//
// Extracted from worker.js (decomposition, manual §6.7). One password login
// mints two credentials: the 24h bearer token (full admin API) and the 30-day
// shell cookie (unlocks serving the console document — see the shell gate in
// worker.js fetch). The KV-backed failed-attempt limiter is shared with the
// subscriber-export endpoint, which is why _isRateLimited / _recordFailedAttempt
// and the constant-time compare live here and are re-used, not duplicated.

import bcrypt from 'bcryptjs';
import { createToken, createShellToken, shellCookie, shellCookieClear } from '../shared/auth.js';
import { jsonRes } from '../shared/http.js';

// ---- Rate Limiting (KV-backed, best-effort; fail-open) ----
//
// Failed-auth counts live in the SUBSCRIBERS KV namespace under an `authfail:`
// prefix. This is best-effort throttling, not a hard global gate: the counter
// is shared within a colo (better than the old in-memory Map, which saw one
// isolate's traffic), but the get→put increment is non-atomic and KV
// cross-colo propagation (~60s) equals the whole AUTH_RL_WINDOW — a
// distributed attacker sees mostly-independent per-colo budgets. That's fine:
// the bcrypt work factor is the real gate, and Cloudflare Access is the
// deadbolt for anyone who wants one. KV errors fail open on the *rate limit
// only* — bcrypt still gates the actual password, so a KV blip can't bypass
// auth.

const AUTH_RL_MAX = 5;      // failed attempts ...
const AUTH_RL_WINDOW = 60;  // ... per IP per this many seconds

// ---- The console password ----
//
// Two ways to configure it, and the hash always wins when both are set:
//
//   AUTH_PASSWORD_HASH  a bcrypt hash. What `scripts/setup.sh` writes, and the
//                       recommended form for anyone using the CLI.
//   AUTH_PASSWORD       the password itself.
//
// The plaintext form exists for one-click "Deploy to Cloudflare" installs. That
// dialog can prompt for secrets, but it cannot ask a photographer to produce a
// bcrypt hash — so without this, one-click could not set up a login at all, and
// the whole flow would end at a terminal.
//
// Is storing the password itself worse? Barely, and not in a way that matters
// here. Both live in the same place: Cloudflare's encrypted secret store, which
// only the account owner can read and which the Worker cannot print. A bcrypt
// hash protects against a *leaked database* — but this is not a database, and
// the same store already holds SESSION_SECRET, which fully unlocks the admin
// API on its own. Anyone who can read one can read the other.
//
// The real residual risk is password reuse: a leaked account exposes a password
// the owner may have used elsewhere. So the docs recommend the hash, setup.sh
// still writes the hash, and doctor.sh says which form is in use.
function hasConfiguredPassword(env) {
  return Boolean(env.AUTH_PASSWORD_HASH || env.AUTH_PASSWORD);
}

async function checkPassword(env, password) {
  if (env.AUTH_PASSWORD_HASH) {
    return bcrypt.compare(password, env.AUTH_PASSWORD_HASH);
  }
  if (env.AUTH_PASSWORD) {
    // Digest both sides first, then compare fixed-length bytes: the existing
    // timingSafeEqual short-circuits on a length difference, which is fine for
    // the admin key (a fixed-length token) but would leak the *length* of a
    // human-chosen password to anyone timing the login endpoint.
    return digestEqual(password, env.AUTH_PASSWORD);
  }
  return false;
}

/**
 * Constant-time comparison that does not leak either input's length.
 * @returns {Promise<boolean>}
 */
async function digestEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export const _checkPassword = checkPassword;
export const _hasConfiguredPassword = hasConfiguredPassword;

export async function isRateLimited(env, ip) {
  try {
    const raw = await env.SUBSCRIBERS.get(`authfail:${ip}`);
    return raw ? parseInt(raw, 10) >= AUTH_RL_MAX : false;
  } catch {
    return false;
  }
}

export async function recordFailedAttempt(env, ip) {
  try {
    const key = `authfail:${ip}`;
    const raw = await env.SUBSCRIBERS.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    await env.SUBSCRIBERS.put(key, String(count + 1), { expirationTtl: AUTH_RL_WINDOW });
  } catch { /* best-effort */ }
}

// Constant-time string compare — avoids leaking the admin key via response
// timing on a byte-by-byte `!==`. Length difference still short-circuits.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// ---- POST /api/auth ----

export async function handleAuth(request, env) {
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for') ||
    'unknown';

  if (await isRateLimited(env, ip)) {
    return jsonRes({ ok: false, error: 'too many attempts' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ ok: false, error: 'invalid request' }, 400);
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || !hasConfiguredPassword(env)) {
    await recordFailedAttempt(env, ip);
    return jsonRes({ ok: false, error: 'invalid credentials' }, 401);
  }

  const match = await checkPassword(env, password);
  if (!match) {
    await recordFailedAttempt(env, ip);
    return jsonRes({ ok: false, error: 'invalid credentials' }, 401);
  }

  // Two credentials from one login: the 24h bearer token (full admin API,
  // sessionStorage) and the 30-day shell cookie (unlocks serving the console
  // *document* only — see the shell gate in fetch()). Same password, same two
  // required secrets; the cookie just closes the "admin surface served to
  // anyone" gap the portal never had.
  //
  // ⚠️ MINT BOTH BEFORE ANSWERING, AND CHECK THEM. Until 2026-09-16 this shipped
  // whatever createToken() returned — and it returns **null** when no signing
  // secret resolves (auth.js resolveSessionSecret: no SESSION_SECRET and no
  // SUBSCRIBERS KV to keep a generated one in, or a KV outage). The reply was
  // then `{ok: true, token: null}` with `Set-Cookie: console_shell=null`: the
  // password was right, the login said it worked, and every Bearer call after
  // it 401'd with nothing on screen explaining why.
  //
  // 500, not the 501 notConfigured shape, on purpose. That shape means "this
  // optional feature is off" and the console is required not to red-latch on
  // it — but signing is not optional, the caller's password was CORRECT, and
  // we still cannot issue a credential. That is a fault and should read as one.
  // It also covers the transient KV case honestly: either way the answer is
  // "the server could not sign this right now", which is exactly a 500.
  const token = await createToken(env);
  const shell = await createShellToken(env);
  if (!token || !shell) {
    console.error('[auth] password accepted but no signing secret resolved — '
      + 'set SESSION_SECRET (or bind a SUBSCRIBERS KV namespace); see setup.md');
    return jsonRes({
      ok: false,
      error: 'server cannot sign a session — SESSION_SECRET is unset or unreachable (see setup.md)',
    }, 500);
  }
  const res = jsonRes({ ok: true, token }, 200);
  res.headers.set('Set-Cookie', shellCookie(shell));
  return res;
}

// ---- POST /api/logout ----
// Clears the console-shell cookie so the document gate re-engages for this
// browser. The bearer token is client-held (sessionStorage) — the console
// clears it locally; there is no server-side session state to revoke.
export function handleLogout() {
  const res = jsonRes({ ok: true }, 200);
  res.headers.set('Set-Cookie', shellCookieClear());
  return res;
}
