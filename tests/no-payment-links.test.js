// No live payment endpoints in served markup.
//
// The homepage carried a commented-out "Prints & Editions" block holding two
// real `buy.stripe.com` checkout links. It rendered nothing — it had been
// cosmetically pulled in July 2026 and left in place "for easy revival" — so
// nothing on the live site was wrong, and no test or scan looked at it.
//
// It became a real problem the moment the engine was extracted for forking:
// the block travels with `index.html`, and anyone who un-commented it would
// have been selling prints into the ORIGINAL owner's Stripe account. A
// commented-out block is still shipped source; "it doesn't render" is not the
// same as "it isn't there".
//
// Removed 2026-08-05 (owner call — Prints & Editions is deferred to a v2 that
// gets designed properly rather than revived from a comment). This guard is
// what stops it, or anything like it, coming back by accident.
//
// Scope note: this looks at *served* files only. A payment link in the Field
// Console is a different question — that surface is authenticated and owner-
// only — but none exists today and the list below covers it anyway.
//
// The support page followed on 2026-08-05: its four live Stripe links moved into
// site.config.js and are edge-injected, so this guard now enforces ZERO rather
// than allowing one documented exception.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Hosted-checkout and payment-request endpoints. Each of these is a live
// money-moving URL tied to one account — never something an engine should
// carry, and never something a fork should inherit.
const PAYMENT_PATTERNS = [
  ['Stripe checkout', /buy\.stripe\.com/i],
  ['Stripe payment link', /checkout\.stripe\.com/i],
  ['Stripe donation link', /donate\.stripe\.com/i],
  ['PayPal', /paypal\.(com|me)\/(donate|paypalme|cgi-bin)/i],
  ['Gumroad', /gumroad\.com\/l\//i],
  ['Ko-fi', /ko-fi\.com\/[a-z0-9_-]+/i],
  ['Buy Me a Coffee', /buymeacoffee\.com\/[a-z0-9_-]+/i],
  ['Square', /squareup\.com\/(gift|store)/i],
];

// The two config files are the ONE place an instance's payment links belong:
// they hold identity by definition, `.assetsignore` keeps them off the origin,
// and the extractor swaps the example in for a fork (scripts/os-extract.mjs).
// Everything else here is "served source" and must be clean.
const CONFIG_FILES = ['site.config.js', 'site.config.example.js'];

/** Everything that ships to a browser: markup, styles, client scripts. */
function servedFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    // `.claude` — agent scratch, and `.claude/worktrees/` holds whole checkouts
    // of this repo. Same list tests/guards.test.js keeps, same reason.
    if (['node_modules', '.git', '.claude', '.wrangler', 'docs', 'tests', 'dist'].includes(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) servedFiles(abs, out);
    else {
      const rel = relative(ROOT, abs);
      if (/\.(html|css|js)$/.test(name) && !CONFIG_FILES.includes(rel)) out.push(rel);
    }
  }
  return out;
}

describe('no live payment links in served source', () => {
  const files = servedFiles();

  it('finds files to check (guard against a broken walker)', () => {
    // A silently-empty file list would make every assertion below pass.
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('index.html');
  });

  // Zero exceptions. There used to be exactly one — the support page, whose
  // four Stripe links were live and rendering — and it is closed: the tiers are
  // config now (site.config.js -> support), injected at the edge.
  it.each(PAYMENT_PATTERNS)('%s', (_label, re) => {
    const offenders = [];
    for (const rel of files) {
      read(rel).split('\n').forEach((line, i) => {
        if (re.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(
      offenders,
      `live payment endpoint in served source — a fork would inherit it:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the config exemption is real: those files are not served', () => {
    // The exemption above is only honest while `.assetsignore` actually keeps
    // both configs off the origin. If that ever changes, this fails here rather
    // than quietly turning the guard into a blindfold.
    const ignored = read('.assetsignore').split('\n').map((l) => l.trim());
    for (const f of CONFIG_FILES) expect(ignored, `${f} in .assetsignore`).toContain(f);
  });

  it('catches them inside HTML comments too', () => {
    // The specific way the original hid: commented out, therefore invisible to
    // anyone reading the rendered page, and to any check that parsed the DOM.
    const fake = '<!-- <a href="https://buy.stripe.com/abc123">Buy</a> -->';
    const [, stripe] = PAYMENT_PATTERNS[0];
    expect(stripe.test(fake)).toBe(true);
  });
});

describe('the Prints & Editions block is gone, not hidden', () => {
  it('index.html carries no drops markup', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/class="drops/);
    expect(html).not.toMatch(/drop-card|drop-thumb|drop-season/);
    expect(html).not.toMatch(/PRINTS &amp; EDITIONS/i);
  });

  it('main.css carries no orphaned drops rules', () => {
    // Dead CSS for a section nobody can see is how the markup got left behind
    // in the first place — it still "looked" supported.
    const css = readFileSync(join(ROOT, 'css', 'main.css'), 'utf8');
    expect(css).not.toMatch(/^\.drops?\b/m);
    expect(css).not.toMatch(/^\.drop-/m);
  });
});

describe('the support page carries no identity of its own', () => {
  const support = read('support/index.html');

  it('ships no checkout link at all', () => {
    expect(support).not.toMatch(/stripe\.com|paypal|ko-fi|gumroad|buymeacoffee/i);
  });

  it('ships the hooks the worker fills instead', () => {
    // Lose a hook and the page renders placeholder tiers to real visitors — no
    // identity pattern would notice, because there is no identity left to find.
    for (const hook of ['tier-grid', 'data-support-blurb', 'data-support-note',
                        'data-support-disclaimer']) {
      expect(support, hook).toContain(hook);
    }
  });
});

describe('no third-party runtime request from a public page', () => {
  // The support page rendered each tier as a QR code fetched from
  // api.qrserver.com. That handed every visitor's IP to a service nobody chose,
  // and the images could not load from `file://`, so the Site-in-a-ZIP export
  // shipped four broken images. Removed 2026-08-05; Worker-side QR generation
  // is logged in docs/os-launch-plan.md for the v2 commerce work.
  it('nothing reaches the QR service, including the CSP', () => {
    const offenders = servedFiles().filter((rel) => /api\.qrserver\.com/i.test(read(rel)));
    expect(offenders, 'the QR service is back').toEqual([]);
  });

  it('img-src allows no host beyond self and the configured CDN', () => {
    // The allowance outliving the page is the quiet failure: a widened policy
    // for a service nobody calls. `${cdnHost}` is derived, so a literal
    // https:// host in this directive is by definition a third party.
    const imgSrc = read('src/shared/csp.js').split('\n').find((l) => l.includes('img-src'));
    expect(imgSrc, 'img-src directive').toBeTruthy();
    expect([...imgSrc.matchAll(/https?:\/\/[^\s`'"]+/g)].map((m) => m[0])).toEqual([]);
  });
});
