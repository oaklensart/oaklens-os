// Hostile or broken input gets a 400, never the runtime's error page.
//
// Maintenance review 2026-10-15:
//   D7 · a malformed percent-escape in a CDN or bench-raw path threw URIError
//        out of the router (`decodeURIComponent('%E0%A4%A')`).
//   D9 · a JSON body of `null` parses, and the handler's first property read
//        threw past its own try/catch.
// Both reached Cloudflare's 1101 page: a 500 with no CORS header, which the
// console cannot read and a monitor counts as an outage.
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';
import { createToken, _resetSessionSecretCache } from '../src/shared/auth.js';

const env = {
  SESSION_SECRET: 'test-secret-for-bad-input-0123456789abcdef',
  AUTH_PASSWORD: 'correct horse',
  GITHUB_TOKEN: 'x', GITHUB_REPO: 'o/r',
  DB: { prepare() { throw new Error('should not be reached'); } },
  SUBSCRIBERS: { get: async () => null, put: async () => {} },
  CDN: { get: async () => null, put: async () => {}, delete: async () => {} },
  ASSETS: { async fetch() { return new Response('nope', { status: 404 }); } },
};
const ctx = { waitUntil() {} };
const call = (method, path, init = {}) =>
  worker.fetch(new Request(`https://example.com${path}`, { method, ...init }), env, ctx);

describe('D7: a malformed escape is a 400', () => {
  it.each(['/api/cdn/archive/%E0%A4%A.webp', '/api/bench/raw/%E0%A4%A'])('%s', async (path) => {
    const res = await call('GET', path);
    expect(res.status).toBe(400);
  });
});

describe('D9: a body of `null` is a 400', () => {
  it.each([
    ['POST', '/api/auth', false],
    ['POST', '/api/subscribe', false],
    ['POST', '/api/publish', true],
    ['POST', '/api/delete-assets', true],
    ['POST', '/api/pulse', true],
  ])('%s %s', async (method, path, authed) => {
    _resetSessionSecretCache();
    const headers = { 'Content-Type': 'application/json' };
    if (authed) headers.Authorization = `Bearer ${await createToken(env)}`;
    const res = await call(method, path, { headers, body: 'null' });
    expect(res.status).toBe(400);
  });
});
