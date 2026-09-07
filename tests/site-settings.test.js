import { describe, it, expect } from 'vitest';
import { PAGE_ROUTES } from '../src/shared/pages.js';
import worker from '../worker.js';
import siteConfig from '../site.config.js';

// GET /api/site/settings — the console's read-only Site Settings card feed.
// Public by design (everything in it is already visible on the rendered
// site), so the shape is a contract: exactly ok/name/theme/pages, nothing
// else can ever leak through it.

const env = {
  SESSION_SECRET: 'test-secret-please-ignore',
  SUBSCRIBERS: { get: async () => null, put: async () => {} },
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
};
const ctx = { waitUntil() {} };

const getSettings = async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/site/settings'), env, ctx
  );
  return { res, body: await res.json() };
};

describe('GET /api/site/settings', () => {
  it('answers 200 with the template state', async () => {
    const { res, body } = await getSettings();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe(siteConfig.name);
    expect(body.theme.preset).toBe(siteConfig.theme.preset);
    expect(body.theme.defaultMode).toBe(siteConfig.theme.defaultMode);
    expect(body.theme.toggle).toBe(true);
  });

  it('resolves every PAGE_ROUTES key to a boolean (missing key = enabled)', async () => {
    const { body } = await getSettings();
    const keys = Object.keys(body.pages).sort();
    // Derived from PAGE_ROUTES, not a literal: the extracted engine tree drops
    // the OAKLENS marketing pages, and this contract travels with it.
    expect(keys).toEqual(Object.keys(PAGE_ROUTES).sort());
    for (const v of Object.values(body.pages)) expect(typeof v).toBe('boolean');
  });

  it('leaks no unexpected keys — the response is ONLY ok/name/theme/pages + the posture flags', async () => {
    const { body } = await getSettings();
    expect(Object.keys(body).sort()).toEqual(
      ['demoMode', 'name', 'ok', 'pages', 'podcast', 'repoConnected', 'theme', 'webring']);
    expect(Object.keys(body.theme).sort()).toEqual(['defaultMode', 'preset', 'toggle']);
  });

  // ⚠️ The podcast block is READINESS, not settings: which keys a directory
  // still needs, never what is in them. The owner email is the one that
  // matters — it is a real person's address, it is not on the rendered site
  // anywhere, and this endpoint is public and unauthenticated. A `typeof`
  // sweep is the guard, because the failure mode is someone helpfully
  // returning the value "so the card can show it".
  it('carries podcast readiness as booleans and nothing else', async () => {
    const { body } = await getSettings();
    expect(Object.keys(body.podcast).sort()).toEqual([
      'hasArtwork', 'hasCategory', 'hasCopyright', 'hasFunding',
      'hasLocked', 'hasOwnerEmail', 'listenPage',
    ]);
    for (const [k, v] of Object.entries(body.podcast)) {
      expect(typeof v, `${k} must be a boolean, never a value`).toBe('boolean');
    }
    expect(JSON.stringify(body.podcast)).not.toContain('@');
  });

  // The webring seat is public by construction — the footer chip renders it and
  // /.well-known/analogs.txt serves it — so it belongs here. What must NOT
  // happen is the whole config block leaking through: only the two validated
  // fields travel, and a non-member answers null rather than {} or undefined.
  it('carries the webring seat as null or exactly {node, slug}', async () => {
    const { body } = await getSettings();
    if (body.webring === null) return;
    expect(Object.keys(body.webring).sort()).toEqual(['node', 'slug']);
    expect(Number.isInteger(body.webring.node)).toBe(true);
    expect(body.webring.node).toBeGreaterThanOrEqual(0);
    expect(typeof body.webring.slug).toBe('string');
  });

  it('reports the posture flags as booleans (absent config = false)', async () => {
    const { body } = await getSettings();
    expect(body.demoMode).toBe(siteConfig.demoMode === true);
    expect(body.repoConnected).toBe(siteConfig.repoConnected === true);
  });

  it('POST is not routed (read-only endpoint)', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/site/settings', { method: 'POST' }), env, ctx
    );
    expect(res.status).not.toBe(200);
  });
});
