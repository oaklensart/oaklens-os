// A known /api/ path with the wrong method answers 405, not the site's 404 page.
//
// Logged 2026-08-24 as E7, fixed 2026-09-16. Two things were wrong with the
// fallthrough, and the second is why it is worth a route rather than a shrug:
//
//   · `DELETE /api/pulse` (a real route, wrong verb) answered with the HTML
//     404 PAGE. A client asking an API gets a page telling a human the address
//     does not exist, when the address exists and the verb does not.
//   · everything past the exact-route table is the PAGE path — the weather
//     cache read, the OG lookups, the HTMLRewriter pass. A malformed API call
//     paid for all of it in order to render a 404 nobody reads.
//
// The allowed-method map is DERIVED from EXACT_ROUTES rather than hand-kept,
// so it cannot drift behind a new route; the last test here pins that.
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';

// Minimal env. The 405 branch returns before the asset layer, but the tests that
// assert a request is NOT 405'd fall through to it — a plain non-HTML 404 is
// enough for those, and keeps the HTMLRewriter/weather path out of this file.
const env = {
  ASSETS: { async fetch() { return new Response('nope', { status: 404 }); } },
};
const ctx = { waitUntil() {} };
const call = (method, path) =>
  worker.fetch(new Request(`https://example.com${path}`, { method }), env, ctx);

describe('405 on a known path with the wrong method', () => {
  it('answers JSON, not the HTML 404 page', async () => {
    const res = await call('DELETE', '/api/buffer-summary');
    expect(res.status).toBe(405);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('/api/buffer-summary');
  });

  it('names what the path DOES support, in an Allow header', async () => {
    const res = await call('PUT', '/api/pulse');
    expect(res.status).toBe(405);
    // /api/pulse is GET + POST + DELETE in the table.
    const allow = (res.headers.get('Allow') || '').split(', ');
    expect(allow).toContain('GET');
    expect(allow).toContain('POST');
    expect(allow).toContain('DELETE');
  });

  it('lists HEAD alongside GET, because the route answers it', async () => {
    // RFC 9110: Allow names the methods the RESOURCE supports, and the branch
    // above deliberately lets a HEAD through to a GET route. Saying GET but not
    // HEAD would describe a rule the code does not follow.
    const res = await call('PUT', '/api/pulse');
    expect((res.headers.get('Allow') || '').split(', ')).toContain('HEAD');
  });

  it('does NOT invent HEAD on a write-only path', async () => {
    // /api/auth is POST only — nothing there answers a HEAD.
    const res = await call('GET', '/api/auth');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('still carries the CORS header — a 405 a browser cannot read is useless', async () => {
    const res = await call('PUT', '/api/pulse');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
  });

  it('does not 405 a HEAD on a GET route', async () => {
    // HEAD is GET without a body and the runtime strips the body itself. Uptime
    // monitors and `curl -I` send it; the /api/cdn proxy already learned this
    // the hard way when GET-only routing sent every HEAD probe to a 404.
    const res = await call('HEAD', '/api/buffer-summary');
    expect(res.status).not.toBe(405);
  });

  it('leaves an UNKNOWN path alone — that is a real 404, not a 405', async () => {
    // The map holds exact pathnames only, so prefix routes (/api/cdn/<key>,
    // /api/bench/raw/<file>, /p/<code>, short links) and ordinary pages are
    // never shadowed by this branch.
    const res = await call('DELETE', '/api/not-a-route');
    expect(res.status).not.toBe(405);
  });

  it('a correct method still reaches its handler', async () => {
    // The other half: this branch must not intercept anything valid.
    const res = await call('GET', '/api/version');
    expect(res.status).toBe(200);
  });
});

describe('the allowed-method map is derived, not hand-kept', () => {
  it('every method in EXACT_ROUTES is accepted on its own path', async () => {
    // Guards the drift this replaced a hand-written list to avoid: add a route
    // to the table and its method is allowed by construction.
    const src = (await import('node:fs')).readFileSync(
      new URL('../worker.js', import.meta.url), 'utf8',
    );
    const keys = [...src.matchAll(/\['([A-Z]+) (\/[^']*)',/g)].map((m) => [m[1], m[2]]);
    expect(keys.length, 'no routes parsed — did EXACT_ROUTES change shape?').toBeGreaterThan(10);
    for (const [method, path] of keys) {
      const res = await call(method, path);
      expect(res.status, `${method} ${path} must not 405 — it is in the table`).not.toBe(405);
    }
  });
});
