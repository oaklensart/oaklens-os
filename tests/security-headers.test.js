// Security headers, on EVERY response — not just the ones Workers Assets serves.
//
// Two gaps this pins, both found in the 2026-08-07 pre-fork review:
//
//   1. buildCsp named no `default-src`, so every directive it did not list was
//      unrestricted. The policy enforcing "zero third-party runtime" enforced
//      it for scripts and images while a third-party stylesheet or font walked
//      straight through. base-uri, form-action and frame-ancestors have no
//      fallback at all, so omitting them was the same unrestricted default.
//
//   2. `_headers` declares X-Frame-Options and friends and claims they "still
//      apply to every response" — but that file only reaches responses the
//      asset layer serves. Three Worker paths build a Response from scratch
//      (the console login gate, a config-gated 404, every JSON API reply) and
//      shipped without them. The admin login page was framable.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Same mock as tests/csp.test.js: assert the ENGINE DEFAULT a fork receives,
// not this instance's opt-ins (webAnalytics / appleMusicEmbeds / custom CDN).
vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: Object.freeze({
    ...actual.default, webAnalytics: false, appleMusicEmbeds: false, cdnBase: undefined,
  }) };
});

const { buildCsp, withCsp, securityHeaders, STATIC_SECURITY_HEADERS } =
  await import('../src/shared/csp.js');

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const ORIGIN = 'https://example.com';
const directive = (policy, name) =>
  policy.split('; ').find((d) => d.startsWith(`${name} `)) || '';

describe('the CSP closes its own fallbacks', () => {
  // Without default-src, an unlisted directive is unrestricted. This is the
  // guard that makes every OTHER directive assertion meaningful.
  it("names default-src 'self' on both surfaces", () => {
    for (const strict of [true, false]) {
      expect(directive(buildCsp(ORIGIN, strict), 'default-src'),
        `default-src (strict=${strict})`).toBe("default-src 'self'");
    }
  });

  // These three do not fall back to default-src — the spec gives them none —
  // so they have to be said out loud or they are wide open.
  it.each([
    ['base-uri', "base-uri 'self'"],
    ['form-action', "form-action 'self'"],
    ['frame-ancestors', "frame-ancestors 'none'"],
  ])('pins %s, which has no default-src fallback', (name, expected) => {
    for (const strict of [true, false]) {
      expect(directive(buildCsp(ORIGIN, strict), name), `${name} (strict=${strict})`).toBe(expected);
    }
  });

  it('governs styles and fonts, so a fork cannot pull either from a third party', () => {
    const policy = buildCsp(ORIGIN, true);
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(policy, 'font-src')).toBe("font-src 'self'");
  });

  // 'unsafe-inline' in style-src is deliberate and must not be mistaken for
  // the script-src rule slipping. The public pages carry <style> blocks and
  // style="…" attributes; CSS attributes need it. script-src stays hash-locked.
  it('keeps unsafe-inline out of script-src even though style-src has it', () => {
    const policy = buildCsp(ORIGIN, true);
    expect(directive(policy, 'style-src')).toContain("'unsafe-inline'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('still names no third-party host in any directive by default', () => {
    // Re-asserted here because this file ADDS directives: a future one that
    // reaches for a CDN must fail loudly rather than ride in behind the fix.
    for (const d of buildCsp(ORIGIN, true).split('; ')) {
      const [name, ...sources] = d.split(' ');
      expect(sources.filter((s) => /^https?:\/\//.test(s) && !s.startsWith(ORIGIN)),
        `${name} third-party hosts`).toEqual([]);
    }
  });
});

describe('the static header set reaches hand-built responses', () => {
  it('securityHeaders carries the static set plus a CSP', () => {
    const h = securityHeaders(ORIGIN, true);
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['Content-Security-Policy']).toContain("default-src 'self'");
  });

  it('withCsp stamps the static set too, not only the policy', () => {
    const res = withCsp(new Response('hi'), ORIGIN, '/about');
    for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) {
      expect(res.headers.get(k), `withCsp should set ${k}`).toBe(v);
    }
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  // The set `_headers` declares and the set the Worker stamps must be the same
  // set. If they drift, half the site gets one posture and half the other —
  // and the half that misses out is whichever one nobody tested.
  it('matches what _headers declares for the asset path', () => {
    const headers = read('_headers');
    for (const name of Object.keys(STATIC_SECURITY_HEADERS)) {
      expect(headers, `_headers should still declare ${name}`).toContain(`${name}:`);
    }
  });

  // Source-level, because these three build a Response literal rather than
  // going through withCsp — the exact reason they were missed.
  it('no Worker path hand-rolls a bare Content-Security-Policy header', () => {
    const worker = read('worker.js');
    expect(worker, 'worker.js should stamp headers via securityHeaders(), not buildCsp()')
      .not.toContain("'Content-Security-Policy': buildCsp");
    expect(worker).not.toContain("headers.set('Content-Security-Policy', buildCsp");
    // ...and it really does use the shared helper, in all five places. The
    // count is pinned on purpose: adding a hand-built Response to the router
    // should fail here until you have shown it carries the header set. The
    // fifth is the 410 a retired card's address answers with (chunk 6) — a
    // hand-built Response like the four before it, and it carries the set.
    expect(worker.match(/securityHeaders\(url\.origin/g)?.length).toBe(5);
  });

  it('JSON API replies carry nosniff', async () => {
    const { jsonRes } = await import('../src/shared/http.js');
    expect(jsonRes({ ok: true }, 200).headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
