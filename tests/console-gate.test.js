import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import worker from '../worker.js';
import {
  createToken, createRawToken, createShellToken, verifyShellRequest,
  parseCookies, shellCookie, shellCookieClear, SHELL_COOKIE,
} from '../src/shared/auth.js';

// The Field Console shell gate: the admin console *document* is served only
// to a valid console-shell cookie — the portal's cookie-gated-template
// posture applied to the admin surface (secure-by-default, opt out via
// site.config.js → consoleShellPublic). These tests pin the load-bearing
// contracts:
//   - no cookie → 401 login page (never the shell), Cache-Control: no-store
//     (the PWA service worker's network-first cache only stores res.ok, so
//     the 401 also keeps the login page from ever shadowing the cached shell)
//   - only scope 'console-shell' unlocks the document — a portal cookie or a
//     bearer-scope token pasted into the cookie is rejected (scope boundary)
//   - /api/auth mints the cookie alongside the bearer token; /api/logout
//     retires it
//   - the cookie can never authorize an API mutation (verifyToken boundary,
//     covered from the other side in auth.test.js)

const SESSION_SECRET = 'test-secret-please-ignore';
const PASSWORD = 'correct horse battery staple';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4); // low cost — test speed only

const kvStub = { get: async () => null, put: async () => {} };

const GATE_MARKER = 'gate page marker';
const SHELL_MARKER = 'console shell marker';

// Minimal ASSETS stub: records what was requested, serves distinguishable
// bodies for the gate page and the console shell.
function makeAssets() {
  const requested = [];
  return {
    requested,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      requested.push(path);
      if (path === '/dev/console-gate.html') {
        return new Response(`<!DOCTYPE html><html><body>${GATE_MARKER}</body></html>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      if (path === '/dev/field-console.html' || path === '/dev/field-console') {
        return new Response(`<!DOCTYPE html><html><head></head><body>${SHELL_MARKER}</body></html>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  };
}

function makeEnv(assets = makeAssets()) {
  return {
    SESSION_SECRET,
    AUTH_PASSWORD_HASH: PASSWORD_HASH,
    SUBSCRIBERS: kvStub,
    ASSETS: assets,
  };
}

const ctx = { waitUntil() {} };

// The authed path falls through to the HTML transform. Node has no
// HTMLRewriter / caches.default — stub a pass-through rewriter and a warm
// weather cache (a fresh `ts` keeps refreshLocalTemp from firing a real
// network call inside waitUntil). Real-HTMLRewriter behavior is exercised
// separately under Miniflare (workerd), not here.
let _savedRewriter, _savedCaches;
beforeEach(() => {
  _savedRewriter = globalThis.HTMLRewriter;
  _savedCaches = globalThis.caches;
  globalThis.HTMLRewriter = class {
    on() { return this; }
    transform(res) { return new Response(res.body, res); }
  };
  globalThis.caches = {
    default: {
      async match() {
        return new Response(JSON.stringify({ temp: 60, ts: Date.now() }));
      },
      async put() {},
    },
  };
});
afterEach(() => {
  globalThis.HTMLRewriter = _savedRewriter;
  globalThis.caches = _savedCaches;
});

const shellReq = (cookie, path = '/dev/field-console') =>
  new Request(`https://example.com${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

describe('console shell gate', () => {
  it('serves the login page (401, no-store) when there is no cookie', async () => {
    const assets = makeAssets();
    const res = await worker.fetch(shellReq(null), makeEnv(assets), ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain(GATE_MARKER);
    expect(body).not.toContain(SHELL_MARKER);
    // The shell document itself was never fetched from assets.
    expect(assets.requested).toEqual(['/dev/console-gate.html']);
  });

  it('gates the .html form of the URL too', async () => {
    const res = await worker.fetch(shellReq(null, '/dev/field-console.html'), makeEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it('serves the shell (no-store) to a valid console-shell cookie', async () => {
    const env = makeEnv();
    const cookie = `${SHELL_COOKIE}=${await createShellToken(env)}`;
    const res = await worker.fetch(shellReq(cookie), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain(SHELL_MARKER);
  });

  it('rejects a bearer-scope (console) token pasted into the cookie', async () => {
    const env = makeEnv();
    const cookie = `${SHELL_COOKIE}=${await createToken(env)}`; // scope 'console'
    const res = await worker.fetch(shellReq(cookie), env, ctx);
    expect(res.status).toBe(401);
  });

  it('rejects a portal-style token (no scope) in the cookie', async () => {
    const env = makeEnv();
    const tok = await createRawToken(SESSION_SECRET, { project: 'x', role: 'admin', lh: 'h' });
    const res = await worker.fetch(shellReq(`${SHELL_COOKIE}=${tok}`), env, ctx);
    expect(res.status).toBe(401);
  });

  it('rejects an expired shell token', async () => {
    const env = makeEnv();
    const expired = await createRawToken(SESSION_SECRET, { scope: 'console-shell' }, -10);
    const res = await worker.fetch(shellReq(`${SHELL_COOKIE}=${expired}`), env, ctx);
    expect(res.status).toBe(401);
  });

  it('rejects a tampered shell token', async () => {
    const env = makeEnv();
    const tok = await createShellToken(env);
    const res = await worker.fetch(shellReq(`${SHELL_COOKIE}=${tok}x`), env, ctx);
    expect(res.status).toBe(401);
  });

  it('leaves other /dev/ assets ungated', async () => {
    // The gate is scoped to the console document; generic engine assets
    // (login page, icons, manifest) stay public.
    const res = await worker.fetch(shellReq(null, '/dev/console-gate.html'), makeEnv(), ctx);
    expect(res.status).toBe(200);
  });
});

describe('/api/auth issues the shell cookie alongside the bearer token', () => {
  const authReq = (password) =>
    new Request('https://example.com/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

  it('sets an HttpOnly, Secure, SameSite=Strict cookie scoped to /dev on success', async () => {
    const env = makeEnv();
    const res = await worker.fetch(authReq(PASSWORD), env, ctx);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain(`${SHELL_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/dev');
    // The minted cookie actually unlocks the document…
    const token = setCookie.split(';')[0].split('=').slice(1).join('=');
    const ok = await verifyShellRequest(
      new Request('https://example.com/dev/field-console', { headers: { Cookie: `${SHELL_COOKIE}=${token}` } }),
      env
    );
    expect(ok).toBe(true);
    // …and the response still carries the bearer token for the API layer.
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.token).toBe('string');
  });

  it('sets no cookie on a failed login', async () => {
    const res = await worker.fetch(authReq('wrong password'), makeEnv(), ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  // A CORRECT password that cannot be signed. resolveSessionSecret answers null
  // with no SESSION_SECRET and no SUBSCRIBERS KV to keep a generated one in —
  // and until 2026-09-16 the endpoint shipped that null straight through as
  // `{ok: true, token: null}` with `Set-Cookie: console_shell=null`. The login
  // reported success, then every Bearer call 401'd with nothing on screen
  // saying why. Fail loud instead.
  describe('a correct password the server cannot sign', () => {
    const unsignable = () => ({
      AUTH_PASSWORD_HASH: PASSWORD_HASH,
      ASSETS: makeAssets(),
      // no SESSION_SECRET, and no SUBSCRIBERS KV to generate one into
    });

    it('answers 500 rather than a cheerful 200', async () => {
      const res = await worker.fetch(authReq(PASSWORD), unsignable(), ctx);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.ok).toBe(false);
      // Diagnostic, and it names the fix: this is the one failure a fork hits
      // when it skips the secret, so the message has to be the documentation.
      expect(data.error).toMatch(/SESSION_SECRET/);
    });

    it('never ships a null token', async () => {
      const res = await worker.fetch(authReq(PASSWORD), unsignable(), ctx);
      const data = await res.json();
      expect(data.token, 'a null token is worse than no token').toBeUndefined();
    });

    it('never sets console_shell=null', async () => {
      // The other half of the same bug, and the more dangerous one: a literal
      // "null" cookie is a value the gate then has to reject on every request.
      const res = await worker.fetch(authReq(PASSWORD), unsignable(), ctx);
      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie === null || !setCookie.includes(`${SHELL_COOKIE}=null`)).toBe(true);
    });

    it('still refuses a WRONG password the same way — 401, not 500', async () => {
      // Order matters: the signing check must sit AFTER the password check, or
      // a misconfigured instance starts answering 500 to credential-stuffing
      // and leaks that the deployment is broken to anyone who knocks.
      const res = await worker.fetch(authReq('wrong password'), unsignable(), ctx);
      expect(res.status).toBe(401);
    });
  });
});

describe('/api/logout', () => {
  it('retires the shell cookie (Max-Age=0)', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/logout', { method: 'POST' }),
      makeEnv(),
      ctx
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain(`${SHELL_COOKIE}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });
});

describe('shared cookie/scope primitives', () => {
  it('parseCookies handles multiple cookies and = inside values', () => {
    const parsed = parseCookies('a=1; console_shell=abc.def=ghi; b=2');
    expect(parsed.console_shell).toBe('abc.def=ghi');
    expect(parsed.a).toBe('1');
    expect(parsed.b).toBe('2');
  });

  it('shellCookie / shellCookieClear carry the hardened attributes', () => {
    for (const value of [shellCookie('tok'), shellCookieClear()]) {
      expect(value).toContain('HttpOnly');
      expect(value).toContain('Secure');
      expect(value).toContain('SameSite=Strict');
      expect(value).toContain('Path=/dev');
    }
    expect(shellCookieClear()).toContain('Max-Age=0');
  });

  it('verifyShellRequest is false with no cookie header at all', async () => {
    const ok = await verifyShellRequest(new Request('https://example.com/dev/field-console'), makeEnv());
    expect(ok).toBe(false);
  });
});
