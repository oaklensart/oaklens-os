// Shared HTTP helpers — CORS, JSON responses, and the optional-secret 501
// shape. Extracted from worker.js (decomposition, manual §6.7) so every
// subsystem module can build responses without reaching back into the entry
// point. No instance identity here — pure transport plumbing.

// ---- CORS ----
//
// The allowed origin is the request's own origin (all consumers — site pages,
// field console — are same-origin), set per-response by withCors() in the
// router so no domain is hardcoded and a fork works on *.workers.dev.

export const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function withCors(response, origin) {
  response.headers.set('Access-Control-Allow-Origin', origin);
  return response;
}

// `nosniff` is set here rather than inherited from `_headers`: that file only
// applies to responses Workers Assets serves, and every API reply is built
// from scratch. Declared literally (not imported from csp.js) to keep this
// module free of the site config that csp.js pulls in.
export function jsonRes(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...CORS_HEADERS,
    },
  });
}

export function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
}

// ---- Optional-secret degradation ----
// Only AUTH_PASSWORD_HASH + SESSION_SECRET are required to run an instance;
// every other secret gates one feature. A missing optional secret answers 501
// with notConfigured:true — a deliberate "this feature is off" the console can
// tell apart from a real fault (it must never red-latch the system lamp or be
// retried; the client's retry set is 0/502/503/504).
export function notConfiguredRes(feature, secrets) {
  return jsonRes({
    ok: false,
    notConfigured: true,
    error: `${feature} not configured — set ${secrets.join(' + ')} (see setup.md)`,
  }, 501);
}

// Demo mode (site.config.js → demoMode: true): the instance is a public
// showcase whose console is fully explorable but whose writes are off. The
// refusal is deliberate and explained — same posture as notConfigured, its
// own shape (403 + demoMode:true) so the console shows "demo — browsing
// only" copy instead of red-latching or retrying. It gates on CONFIG, not on
// who is logged in: the owner writes to the same KV/D1/R2 from a non-demo
// deployment (or local wrangler dev) with their own credentials, while the
// deployed demo Worker stays locked no matter whose password logs in.
export function demoModeRes(action) {
  return jsonRes({
    ok: false,
    demoMode: true,
    error: `${action} is off in demo mode — this console is browse-only`,
  }, 403);
}

// The same deliberate 501 for a D1 database that is bound but unmigrated —
// the state every install lands in when nothing ran the migrations (a
// one-click Deploy whose Workers Builds deploy command doesn't run the
// package.json `deploy` script, for example). SQLite's "no such table" is not
// a fault to red-latch on; it means "the feature's tables haven't been
// created yet", and the fix is a command, not a secret.
export function isMissingTableError(err) {
  return /no such table/i.test(String((err && err.message) || err || ''));
}

// The same deliberate 501 one step earlier: D1 is not BOUND at all.
//
// This answered 500 until 2026-09-16, which read as a fault and red-latched the
// console over what is plainly a config gap — and an even clearer one than the
// unmigrated case below, which already answered 501. A fork that has not made a
// database yet has not broken anything; it has not switched the feature on.
//
// Two different sentences on purpose. "Bind a database" and "run the
// migrations" are different actions, and a message that covers both covers
// neither — this is the error a fork owner reads while following setup.md.
export function d1MissingRes(feature) {
  return jsonRes({
    ok: false,
    notConfigured: true,
    error: `${feature} not configured — no D1 database is bound to this Worker; `
      + `create one and add a d1_databases binding named DB (see setup.md)`,
  }, 501);
}

export function d1TablesMissingRes(feature) {
  return jsonRes({
    ok: false,
    notConfigured: true,
    error: `${feature} not configured — the D1 tables haven't been created yet; `
      + `run: npx wrangler d1 migrations apply <your-database-name> --remote (see setup.md)`,
  }, 501);
}
