// Demo mode (site.config.js → demoMode: true): the instance is a public
// showcase — console fully explorable, every write deliberately off. This
// matters most where a shared demo password sits upstream of a real repo and
// build pipeline: the publish path-allowlist cut the escalation edge, and
// this flag closes the remaining write surface (uploads, deletes, drafts,
// bench, the subscribe form's PII, the subscriber export).
//
// Isolated in its own file because vi.mock is hoisted per-file — the rest of
// the suite runs the real (demo-off) config, which is itself the proof that
// the flag is dormant by default: every mutation test in the suite would 403
// if the gate leaked into the off state.
//
// The contract pinned here:
//   · every DEMO_LOCKED_ROUTES entry answers 403 { demoMode: true } BEFORE
//     its handler runs (no auth check, no storage touched — env is empty)
//   · login stays open (the demo is meant to be explored) and reads survive
//   · the gate and the route table stay in lockstep — a locked key that
//     drifts from EXACT_ROUTES would silently gate nothing
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: Object.freeze({ ...actual.default, demoMode: true }) };
});

const worker = (await import('../worker.js')).default;
const { DEMO_LOCKED_ROUTES } = await import('../worker.js');
const siteConfig = (await import('../site.config.js')).default;

// Deliberately minimal env: if a locked route reaches its handler, the
// missing bindings throw and the test fails loudly instead of passing by
// accident.
const env = {
  SESSION_SECRET: 'test-secret-please-ignore',
  SUBSCRIBERS: { get: async () => null, put: async () => {} },
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
};
const ctx = { waitUntil() {} };

const call = (key) => {
  const [method, path] = key.split(' ');
  return worker.fetch(new Request(`https://example.com${path}`, { method }), env, ctx);
};

describe('the gate is testable at all — this file overrides the suite-wide strip', () => {
  // tests/setup.js strips demoMode from the instance config for the WHOLE
  // suite, so a demo instance's CI is not permanently red (its own config
  // would otherwise 403 every write test). That strip must never win here, or
  // every assertion below would pass vacuously against an ungated worker.
  // This is the canary: file-level vi.mock registers after setupFiles, so
  // demoMode is true in this file and only this file.
  it('sees demoMode: true despite the global strip', () => {
    expect(siteConfig.demoMode).toBe(true);
  });
});

describe('demoMode: true — every locked route refuses, explained', () => {
  it.each([...DEMO_LOCKED_ROUTES].map((k) => [k]))('%s → 403 demoMode', async (key) => {
    const res = await call(key);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.demoMode).toBe(true);
    expect(body.ok).toBe(false);
    // The refusal must explain itself — the console shows this string.
    expect(body.error).toMatch(/demo mode/i);
  });

  it('a HEAD on a locked GET is locked too', async () => {
    // HEAD runs the GET handler (D3, 2026-10-15). It must be resolved to the
    // GET key BEFORE the demo gate, or HEAD would walk round the PII lock.
    const res = await worker.fetch(
      new Request('https://example.com/api/subscribers/export', { method: 'HEAD' }), env, ctx);
    expect(res.status).toBe(403);
  });

  it('locks the routes that write or touch PII — the full expected set', () => {
    // Pinned as a literal so ADDING a mutation route to EXACT_ROUTES forces a
    // decision here: lock it or consciously leave it open.
    expect([...DEMO_LOCKED_ROUTES].sort()).toEqual([
      'DELETE /api/bench/done',
      'DELETE /api/bench/entries',
      'DELETE /api/drafts',
      'GET /api/subscribers/export',
      'PATCH /api/bench/entries',
      'POST /api/bench/entries',
      'DELETE /api/pulse',
      'POST /api/delete-assets',
      'POST /api/pulse',
      'POST /api/publish',
      'POST /api/subscribe',
      'POST /api/upload',
      'POST /api/welcome',
      'PUT /api/drafts',
      'PUT /api/publish/key',
      'DELETE /api/publish/key',
    ].sort());
  });
});

describe('demoMode: true — exploration stays open', () => {
  it('login still answers (wrong password = 401, not a demo refusal)', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'nope' }),
      }), { ...env, AUTH_PASSWORD_HASH: 'a'.repeat(64) }, ctx);
    expect(res.status).toBe(401);
    expect((await res.json()).demoMode).toBeUndefined();
  });

  it('a demo console is never welcomed as a new site (src/api/welcome.js)', async () => {
    const { createToken } = await import('../src/shared/auth.js');
    const res = await worker.fetch(new Request('https://example.com/api/welcome', {
      headers: { Authorization: `Bearer ${await createToken(env)}` },
    }), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, show: false, reason: 'demo' });
  });

  it('reads are untouched (site settings reports demoMode: true)', async () => {
    const res = await call('GET /api/site/settings');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.demoMode).toBe(true);
  });
});
