// Strict script-src for the public site. The CSP is worker-owned (worker.js →
// buildCsp), not in _headers, so it can be config-derived and per-surface. The
// only inline script the public pages carry is the pre-paint mode-resolution
// block in <head>, allowed by a sha256 hash. These guards keep the invariants
// that make that safe: the hash matches the block byte-for-byte, no public page
// re-introduces an inline script or handler, lighttable.js emits no inline
// onerror, and the strict policy really drops 'unsafe-inline'.
import { describe, it, expect, vi } from 'vitest';
import { THEMED_PAGES } from './helpers/pages.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// The policy asserted here is the ENGINE DEFAULT — what a fork gets out of the
// box (site.config.example.js ships neither `webAnalytics` nor
// `appleMusicEmbeds`). Both are mocked off rather than read from this
// instance's config on purpose: THIS instance opts into Cloudflare Web
// Analytics and Apple Music embeds, and without the mock the fork-facing
// guarantee below would silently become a test of one site's private choices.
// What each flag adds when it IS on is pinned separately, in
// tests/csp-analytics.test.js and tests/csp-apple-music.test.js.
vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  // cdnBase mocked out too: the engine default serves assets through the
  // origin's own /api/cdn proxy, so a fork's img-src/media-src name no host
  // but the serving origin. This instance's custom CDN domain is its choice,
  // not the default under test.
  return { default: Object.freeze({
    ...actual.default, webAnalytics: false, appleMusicEmbeds: false, cdnBase: undefined,
  }) };
});

const { buildCsp, PREPAINT_CSP_HASH } = await import('../src/shared/csp.js');

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Derived from what this checkout ships — see tests/helpers/pages.js. `/dev`
// is excluded: it is an admin surface and keeps the relaxed policy.
const PUBLIC = THEMED_PAGES.filter((p) => !p.startsWith('dev/'));

// The browser hashes the exact text between the tags of the first <script>
// (the pre-paint block). Reproduce that and format as a CSP source token.
function prepaintHash(html) {
  const inner = html.split('<script>')[1].split('</script>')[0];
  return "'sha256-" + createHash('sha256').update(inner, 'utf8').digest('base64') + "'";
}

// CSP lives in src/shared/csp.js (extracted from worker.js — decomposition,
// manual §6.7). The Worker imports buildCsp/withCsp/PREPAINT_CSP_HASH from it.
const worker = read('src/shared/csp.js');
// Behavioural assertions below call the real thing rather than reading it.
const { withCsp } = await import('../src/shared/csp.js');
const hashDecl = worker.match(/PREPAINT_CSP_HASH\s*=\s*"([^"]+)"/);

describe('pre-paint hash stays in sync with the block', () => {
  it('csp.js declares PREPAINT_CSP_HASH', () => {
    expect(hashDecl, 'PREPAINT_CSP_HASH constant').toBeTruthy();
  });

  it.each(PUBLIC.map((p) => [p]))('%s pre-paint block hashes to the worker constant', (p) => {
    expect(prepaintHash(read(p))).toBe(hashDecl[1]);
  });

  it('every public page carries the identical pre-paint block (one hash covers all)', () => {
    const hashes = new Set(PUBLIC.map((p) => prepaintHash(read(p))));
    expect(hashes.size).toBe(1);
  });
});

describe('public pages carry no inline script or handler', () => {
  it.each(PUBLIC.map((p) => [p]))('%s', (p) => {
    const html = read(p);
    // Exactly one attribute-less <script> — the pre-paint block. Everything
    // else is <script src=…> (external, covered by 'self').
    const inline = (html.match(/<script>/g) || []).length;
    expect(inline, 'inline <script> blocks').toBe(1);
    expect(html, 'inline event handler').not.toMatch(
      /\son(click|error|submit|load|change|input|keydown|keyup|focus|blur|mouse\w+)=/i
    );
  });
});

describe('CSP is worker-owned and strict for the public site', () => {
  it('_headers no longer sets a Content-Security-Policy', () => {
    expect(read('_headers')).not.toMatch(/Content-Security-Policy:/i);
  });

  // Built, not read: these call buildCsp and assert on the policy a browser
  // would actually receive. The earlier versions scanned the source text for a
  // line containing 'unsafe-inline', which passed as long as the *string*
  // existed somewhere — it could not see what the assembled header says.
  const directive = (policy, name) =>
    policy.split('; ').find((d) => d.startsWith(`${name} `)) || '';

  it('strict drops unsafe-inline and carries the pre-paint hash; relaxed keeps it', () => {
    const strict = directive(buildCsp('https://example.com', true), 'script-src');
    expect(strict).toContain(PREPAINT_CSP_HASH);
    expect(strict).not.toContain('unsafe-inline');
    expect(directive(buildCsp('https://example.com', false), 'script-src')).toContain("'unsafe-inline'");
  });

  // The dependency-free claim, enforced against the policy itself: on a default
  // install a public page may not even be *permitted* to run, call, or frame a
  // third party. jsDelivr (the console's two SRI-pinned libs) and the
  // Cloudflare Web Analytics beacon sat here unconditionally until 2026-08-06,
  // and embed.music.apple.com in frame-src until 2026-08-07 — hidden precisely
  // because this test used to enumerate script-src and connect-src instead of
  // sweeping the whole policy. Every directive is in scope now: the only
  // allowed absolute URL is the instance's own configured CDN host
  // (img-src/media-src), which on the mocked default resolves to the serving
  // origin itself.
  it('the strict policy names no third-party host in ANY directive by default', () => {
    const origin = 'https://example.com';
    const policy = buildCsp(origin, true);
    for (const d of policy.split('; ')) {
      const [name, ...sources] = d.split(' ');
      const thirdParty = sources.filter((s) => /^https?:\/\//.test(s) && !s.startsWith(origin));
      expect(thirdParty, `${name} third-party hosts`).toEqual([]);
    }
  });

  it("the default policy pins frame-src to 'none', never omits it", () => {
    // This policy has no default-src: a missing frame-src is unrestricted
    // framing, so "no third-party frames" must be said explicitly. No served
    // public page ships an <iframe> (verified 2026-08-07), so 'none' costs
    // nothing on a default install.
    expect(directive(buildCsp('https://example.com', true), 'frame-src')).toBe("frame-src 'none'");
    expect(directive(buildCsp('https://example.com', false), 'frame-src')).toBe("frame-src 'none'");
  });

  it('the relaxed policy still reaches jsDelivr for the console libs', () => {
    const policy = buildCsp('https://example.com', false);
    expect(directive(policy, 'script-src')).toContain('https://cdn.jsdelivr.net');
    expect(directive(policy, 'connect-src')).toContain('https://cdn.jsdelivr.net');
  });

  it('the CDN host is still allowed for images and media (config-derived, both surfaces)', () => {
    // Removing third-party *script* hosts must not touch the instance's own
    // asset host — a fork serving through /api/cdn resolves it from the origin.
    for (const strict of [true, false]) {
      const policy = buildCsp('https://fork.example.workers.dev', strict);
      expect(directive(policy, 'img-src'), `img-src (strict=${strict})`).toMatch(/https?:\/\//);
    }
  });

  // Behavioural, not source-scraping. The previous version of this test read
  // the `startsWith('…')` literals back out of csp.js and checked them against
  // a list — which meant it agreed, correctly, that `startsWith('/dev')` was
  // fine, because '/dev' IS an admin surface. What it could not see is that the
  // same literal also matches `/devlog`. A test that asks the function what it
  // does answers that question; a test that reads the source cannot.
  describe('withCsp — which surfaces get the relaxed admin policy', () => {
    const policyFor = (pathname) => withCsp(
      new Response('x'), 'https://example.com', pathname,
    ).headers.get('Content-Security-Policy');

    // SCRIPT-SRC specifically, not the policy as a whole: style-src carries
    // 'unsafe-inline' on both surfaces by design, so a whole-string search
    // reports every page as relaxed and the test can never fail. (It did, on
    // the first run of this rewrite — which is the same mistake the helper
    // above this describe() block was written to stop.)
    const isRelaxed = (pathname) => {
      const policy = policyFor(pathname);
      const scriptSrc = policy.split('; ').find((d) => d.startsWith('script-src ')) || '';
      return scriptSrc.includes("'unsafe-inline'");
    };

    it('relaxes the console surfaces', () => {
      expect(isRelaxed('/dev'), '/dev').toBe(true);
      expect(isRelaxed('/dev/field-console'), '/dev/field-console').toBe(true);
      expect(isRelaxed('/dev/sw.js'), '/dev/sw.js').toBe(true);
    });

    it('does NOT relax a public path that merely starts with the letters "dev"', () => {
      // The 2026-09-16 fix. Each of these would have been served the admin CSP
      // — 'unsafe-inline' on a public page — under the old prefix match.
      for (const p of ['/devlog', '/developer', '/devotional', '/dev-notes']) {
        expect(isRelaxed(p), `${p} must stay strict`).toBe(false);
      }
    });

    it('keeps every ordinary public page strict', () => {
      for (const p of ['/', '/archive', '/field-notes', '/about', '/listen', '/wall']) {
        expect(isRelaxed(p), `${p} must stay strict`).toBe(false);
      }
    });

    it('relaxes the portal where there is one, and not where there is not', () => {
      // ⚠️ DERIVED, and it has to be. scripts/os-extract.mjs rewrites
      // isAdminSurface for the fork and drops the `/c/` arm with the frozen
      // portal — so a flat `expect(isRelaxed('/c/…')).toBe(true)` passes here
      // and fails in every extracted tree, for a reason that is not a defect.
      //
      // That is not hypothetical. The source-scraping test this block replaced
      // carried a comment saying exactly this; the first behavioural draft
      // copied the comment and hardcoded the assertion anyway, and it was
      // caught by `node scripts/os-extract.mjs <dir> --verify` — which runs the
      // extracted suite — and by nothing else. Run that before changing a test
      // that names a frozen or instance-only surface.
      const portalIsRouted = worker.includes("'/c/'");
      expect(isRelaxed('/c/a-project')).toBe(portalIsRouted);
    });
  });
});

describe('lighttable.js emits no inline onerror', () => {
  it('generated markup uses delegation, not onerror="…"', () => {
    expect(read('js/lighttable.js')).not.toMatch(/onerror=/);
  });
});
