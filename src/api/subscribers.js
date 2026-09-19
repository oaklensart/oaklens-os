// ---- Newsletter subscribers: POST /api/subscribe, GET /api/subscribers/export ----
//
// Extracted from worker.js (decomposition, manual §6.7). Emails live in the
// SUBSCRIBERS KV namespace keyed by address; export is gated on the optional
// ADMIN_KEY secret (501 when unset) and reuses the failed-auth limiter from
// console-auth.js so PII can't be brute-scraped.

import { jsonRes, notConfiguredRes, CORS_HEADERS } from '../shared/http.js';
import { isRateLimited, recordFailedAttempt, timingSafeEqual } from './console-auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleSubscribe(request, env) {
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for') ||
    'unknown';

  // Rate limit: max 3 attempts per IP per 60s — skip if KV is unavailable.
  //
  // READ first, WRITE last (2026-08-07). This is the only unauthenticated
  // endpoint that writes to KV, and it used to increment the counter before
  // parsing the body — so every malformed POST and every honeypot hit cost a
  // KV write. KV's free tier is ~1k writes/day, and this namespace also holds
  // the token-signing key a one-click install generates (src/shared/auth.js),
  // so anonymous traffic could burn the write budget the ADMIN surface depends
  // on. The 429 check still happens up front; only a request that is actually
  // a well-formed subscribe attempt is worth a write.
  const rlKey = `ratelimit:${ip}`;
  let rlCount = 0;
  try {
    const rlRaw = await env.SUBSCRIBERS.get(rlKey);
    rlCount = rlRaw ? parseInt(rlRaw, 10) : 0;
    if (rlCount >= 3) {
      return jsonRes({ ok: false, error: 'too many attempts' }, 429);
    }
  } catch (err) {
    console.error('[subscribe] rate-limit KV failed, allowing through:', err.message);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ ok: false, error: 'invalid email' }, 400);
  }

  // Honeypot — silently succeed
  if (body && body.website) {
    return jsonRes({ ok: true }, 200);
  }

  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return jsonRes({ ok: false, error: 'invalid email' }, 400);
  }

  const source = typeof body.source === 'string' ? body.source.slice(0, 32) : 'unknown';

  // Now that the request is known-good, charge it against the IP's budget.
  try {
    await env.SUBSCRIBERS.put(rlKey, String(rlCount + 1), { expirationTtl: 60 });
  } catch (err) {
    console.error('[subscribe] rate-limit KV write failed:', err.message);
  }

  try {
    await env.SUBSCRIBERS.put(email, JSON.stringify({
      subscribed_at: new Date().toISOString(),
      source,
    }));
  } catch (err) {
    console.error('[subscribe] KV write failed:', err.message);
    return jsonRes({ ok: false, error: 'server error' }, 500);
  }

  return jsonRes({ ok: true }, 200);
}

export async function handleExport(request, url, env) {
  // No ADMIN_KEY secret = the export feature is off, not "everyone is
  // unauthorized" — answer 501 before the rate limiter so a fork poking its
  // own endpoint doesn't get lockout-penalized for a config gap.
  if (!env.ADMIN_KEY) {
    return notConfiguredRes('subscriber export', ['ADMIN_KEY']);
  }

  // The admin key is read from a header — never the query string. A key in the
  // URL leaks into Cloudflare request logs (observability is enabled), proxy
  // logs, browser history, and the Referer header. The response is subscriber
  // PII, so this endpoint is also rate-limited like /api/auth.
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for') ||
    'unknown';
  if (await isRateLimited(env, ip)) {
    return jsonRes({ error: 'too many attempts' }, 429);
  }

  const auth = request.headers.get('Authorization') || '';
  const headerKey = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : (request.headers.get('X-Admin-Key') || '');
  if (!headerKey || !timingSafeEqual(headerKey, env.ADMIN_KEY)) {
    await recordFailedAttempt(env, ip);
    return jsonRes({ error: 'unauthorized' }, 401);
  }

  try {
    const subscribers = [];
    let cursor;

    do {
      const result = await env.SUBSCRIBERS.list({ cursor, limit: 1000 });
      const names = result.keys
        .map((k) => k.name)
        // Everything in this namespace that is NOT a subscriber email must be
        // excluded here: the rate-limit counters, and — critically — any
        // `__`-prefixed internal key. `__oaklens_session_secret` (the KV-kept
        // token-signing key on a one-click install, src/shared/auth.js) lives
        // in this same namespace, and this export used to `get()` it and ship
        // its key name as a junk "email" row. The value never leaked (it fails
        // the JSON.parse below), but an ADMIN_KEY-gated endpoint reading the
        // admin signing secret is one refactor away from an escalation —
        // ADMIN_KEY is the weaker credential of the two.
        //
        // The `__` rule is narrowed by "has no @": every internal key is a
        // bare token, and EMAIL_RE guarantees a subscriber key contains one,
        // so this still reads no internal key while no longer silently
        // dropping a real subscriber whose address starts with `__`. That
        // invariant is enforced, not assumed — see tests/subscriber-export.test.js.
        .filter((name) => !name.startsWith('ratelimit:')
          && !name.startsWith('authfail:')
          && !(name.startsWith('__') && !name.includes('@')));
      const page = await Promise.all(names.map(async (name) => {
        try {
          const raw = await env.SUBSCRIBERS.get(name);
          const meta = raw ? JSON.parse(raw) : {};
          return { email: name, ...meta };
        } catch {
          return { email: name };
        }
      }));
      subscribers.push(...page);
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return new Response(JSON.stringify(subscribers, null, 2), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    console.error('[export] KV list failed:', err.message);
    return jsonRes({ error: 'export temporarily unavailable' }, 503);
  }
}
