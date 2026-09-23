import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';

// The console gate wears the console's lighting (2026-09-21). It cannot LOAD
// css/field-console.css — the login page is deliberately self-contained (no
// shared CSS/JS, so it works on a fork before any branding exists and tells an
// unauthenticated visitor nothing) — so its token ladder is a copy.
//
// A copy is the price of that. A SILENT copy is not: these tests fail when the
// two files disagree, which is the whole reason the duplication is allowed.

// Tokens the gate deliberately RE-SPELLS rather than copies. The console
// resolves these through the --brand-* hex family, which exists per preset and
// per face; the gate carries raw channels only (it loads no fonts and needs no
// hex tier), so the same semantic token is reached by a different route. The
// list is short on purpose — anything not on it must match exactly.
const RESPELLED = new Set(['--accent-text']);

const css = readFileSync(new URL('../css/field-console.css', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../dev/console-gate.html', import.meta.url), 'utf8');

/** Every `--token: value;` inside the first block matching `selector {`. */
function tokensIn(source, selector) {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no block for ${selector}`);
  // The block closes at the first `}` alone on a line, at ANY indentation —
  // the gate's tokens live inside an indented <style>, so `\n}` would run
  // straight past them into the preset blocks below.
  const end = source.slice(start).search(/\n\s*\}/);
  // Comments out first: both files EXPLAIN their tokens, and a sentence that
  // mentions `--bloom-gain:` is not a declaration of it.
  const body = source.slice(start, start + end).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim().replace(/\s+/g, ' ');
  }
  return out;
}

describe('the gate copies the console ladder without drifting from it', () => {
  it('shares every token it redeclares from :root', () => {
    const src = tokensIn(css, ':root');
    const copy = tokensIn(gate, ':root');
    const shared = Object.keys(copy).filter((k) => k in src && !RESPELLED.has(k));
    // Guard the guard: if the gate stops naming these, the comparison below
    // silently passes on an empty set.
    expect(shared.length).toBeGreaterThan(20);
    for (const name of shared) {
      expect(copy[name], `${name} drifted from css/field-console.css`).toBe(src[name]);
    }
  });

  it('shares every token it redeclares from DAYLIGHT', () => {
    const src = tokensIn(css, ':root[data-theme="light"]');
    const copy = tokensIn(gate, ':root[data-theme="light"]');
    const shared = Object.keys(copy).filter((k) => k in src && !RESPELLED.has(k));
    expect(shared.length).toBeGreaterThan(10);
    for (const name of shared) {
      expect(copy[name], `${name} drifted from DAYLIGHT`).toBe(src[name]);
    }
  });

  it('carries every preset the console does, in the console’s channels', () => {
    for (const preset of ['aperture', 'passe-partout', 'selenium', 'cyanotype']) {
      const src = tokensIn(css, `:root[data-preset="${preset}"]`);
      const line = gate.match(new RegExp(`:root\\[data-preset="${preset}"\\][^}]+}`));
      expect(line, `the gate has no ${preset} block`).toBeTruthy();
      expect(line[0], `${preset} channels`).toContain(`--brand-rgb: ${src['--brand-rgb']}`);
      const ink = tokensIn(css, `:root[data-preset="${preset}"][data-theme="light"]`);
      expect(line[0], `${preset} ink channels`).toContain(`--brand-ink-rgb: ${ink['--brand-ink-rgb']}`);
    }
  });
});

describe('the gate lights nothing it has not earned', () => {
  it('names no literal colour in a lit rule — every glow derives from --lit-rgb', () => {
    // The point of the copy is that a fork in cyanotype gets a BLUE filament.
    // A hardcoded red anywhere in the filament defeats it.
    // Same for the annunciator: its bezel, its cap and its press all read the
    // ladder, so the button is machined in DAYLIGHT (90% rim) as well as in
    // STUDIO (4.5%) without a second rule.
    for (const [name, from, to] of [
      ['the filament', '.gate-filament {', '  h1 {'],
      ['the annunciator', '  button {', '  #gate-error {'],
    ]) {
      const block = gate.slice(gate.indexOf(from), gate.indexOf(to));
      expect(block.length, name).toBeGreaterThan(200);
      expect(block, name).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(block, name).not.toMatch(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/);
    }
  });

  it('declares the resting drop-shadows at their no-op values, in the hot order', () => {
    // The same filter-list trap the help filament has: a resting rule with no
    // drop-shadow at all makes the glow BLINK on instead of heating.
    const rest = gate.match(/\n  \.gate-strand \{[^}]+\}/)[0];
    const hot = gate.match(/form\[data-state="live"\] \.gate-strand \{[^}]+\}/)[0];
    const warm = gate.match(/:not\(:placeholder-shown\)\) \.gate-strand \{[^}]+\}/)[0];
    const tiers = (rule) => (rule.match(/drop-shadow\(/g) || []).length;
    // Every tier the lit rules declare must exist at rest as a no-op, or the
    // filter list changes length and the glow blinks on instead of heating.
    expect(tiers(rest)).toBe(tiers(hot));
    expect(tiers(rest)).toBe(tiers(warm));
    expect(tiers(rest)).toBeGreaterThanOrEqual(3);
    expect((rest.match(/drop-shadow\(0 0 0 rgba\(var\(--lit-rgb\), 0\)\)/g) || []).length).toBe(tiers(rest));
    expect(rest).toContain('transition: filter var(--arm-cool)');
    expect(hot).toContain('transition: filter var(--arm-heat)');
    // Warm declares NO transition of its own: it inherits --arm-cool from the
    // resting rule, so it rises exactly as slowly as it falls.
    expect(warm).not.toContain('transition:');
  });

  it('ignites only while the credentials are in flight', () => {
    // Light is licensed for what is DOING something. Resting is cold iron.
    expect(gate).toContain("form.setAttribute('data-state', 'live')");
    expect((gate.match(/form\.removeAttribute\('data-state'\)/g) || []).length).toBe(2);
  });

  it('collapses its curves under prefers-reduced-motion', () => {
    expect(gate).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe('the edge stamps the palette on the gate, and nothing else', () => {
  const ctx = { waitUntil() {} };
  const assets = {
    async fetch() {
      return new Response('<!DOCTYPE html><html><body>gate</body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  };

  it('runs a one-attribute rewriter over the 401, never the site-chrome one', async () => {
    // Identity must not reach an unauthenticated visitor: this asserts the
    // shape of the handler, because a pass-through HTMLRewriter stub is the
    // only one Node has.
    const branch = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')   // the CODE, not the comment about it
      .match(/const gate = await env\.ASSETS\.fetch[\s\S]{0,900}?return new Response\(lit\.body/);
    expect(branch, 'the gate branch no longer transforms the response').toBeTruthy();
    expect(branch[0]).toContain("setAttribute('data-preset'");
    expect(branch[0]).not.toContain('injectSiteChrome');
    expect(branch[0]).not.toMatch(/siteMetaTags|wordmark|tagline/);
  });

  it('still answers 401 + no-store with the gate document', async () => {
    const seen = [];
    globalThis.HTMLRewriter = class {
      on(sel, handler) { seen.push([sel, handler]); return this; }
      transform(res) { return new Response(res.body, res); }
    };
    const res = await worker.fetch(
      new Request('https://example.com/dev/field-console'),
      { SESSION_SECRET: 's', AUTH_PASSWORD_HASH: 'h', ASSETS: assets },
      ctx
    );
    delete globalThis.HTMLRewriter;
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('gate');
    expect(seen.map(([sel]) => sel)).toEqual(['html']);
  });
});

describe('there is one door, and the console never draws a second', () => {
  // A password box is a habit: an owner who learns to type their password into
  // whatever box appears will type it into a box someone else drew. So a
  // console with no usable token bounces to the gate instead of raising its
  // own modal — on logout, on an expired token, and in every new tab (the
  // bearer lives in per-tab sessionStorage; the shell cookie is 30 days).
  // Asserted against the source: importing session.js pulls the console's
  // whole dependency graph for a contract that is four lines long.
  const src = readFileSync(new URL('../js/console/session.js', import.meta.url), 'utf8');
  const bounce = src.match(/function _bounceToGate\(\) \{[\s\S]*?\n\}/)[0];
  const logout = src.match(/export function logout\(\) \{[\s\S]*?\n\}/)[0];
  const checkAuth = src.match(/export function checkAuth\(\) \{[\s\S]*?\n\}/)[0];

  it('retires the shell cookie before reloading', () => {
    // Without this the reload is served this same document and nothing moves.
    expect(bounce).toMatch(/logoutServer\(\)[\s\S]*\.then\(\(\) => \{ try \{ location\.reload\(\)/);
  });

  it('reloads even when that request fails', () => {
    expect(bounce.indexOf('.catch(')).toBeGreaterThan(-1);
    expect(bounce.indexOf('.then(')).toBeGreaterThan(bounce.indexOf('.catch('));
  });

  it('tries exactly once per tab, so a failed retire cannot loop', () => {
    expect(bounce).toContain('sessionStorage.getItem(GATE_BOUNCE_KEY)');
    expect(bounce).toContain('sessionStorage.setItem(GATE_BOUNCE_KEY');
    // Storage unavailable (private mode) means no guard, so do not bounce.
    expect(bounce).toMatch(/catch \{ return false; \}/);
  });

  it('never shows the modal while the bounce is in flight', () => {
    // The whole point. checkAuth() un-hides the modal, so calling it — or
    // delaying the reload behind a timer — puts the second door on screen for
    // exactly as long as the wait.
    expect(logout).toMatch(/if \(!_bounceToGate\(\)\) checkAuth\(\)/);
    expect(logout).not.toMatch(/setTimeout/);
    expect(checkAuth).toMatch(/if \(_bounceToGate\(\)\) return;[\s\S]*loginModal\.classList\.remove\('hidden'\)/);
  });

  it('still clears the local token first', () => {
    // The reload must never be the only thing between a logged-out owner and a
    // live bearer token sitting in sessionStorage.
    expect(logout.indexOf('clearToken()')).toBeLessThan(logout.indexOf('_bounceToGate()'));
  });
});
