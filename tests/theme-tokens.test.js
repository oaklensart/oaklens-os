// Starter-template token system (design-spec §3): main.css must carry all
// six preset×mode blocks, noir/Midnight must equal the pre-template legacy
// literals (the live site's no-regression contract), and the compat shim
// must keep every legacy variable name resolving. These are parsed from the
// stylesheet text — the palette is data, so the test pins it as data.
import { describe, it, expect } from 'vitest';
import { THEMED_PAGES } from './helpers/pages.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, '..', 'css', 'main.css'), 'utf8');

// Grab the declaration body for a selector prelude. Naive brace matching is
// fine here: token blocks contain no nested braces.
function block(selector) {
  const start = css.indexOf(selector);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[`--${m[1]}`] = m[2].trim();
  return out;
}

const PRESET_BLOCKS = {
  'aperture · Midnight': ':root {\n  /* aperture · Midnight */',
  'aperture · Daylight': ':root[data-theme="light"] {',
  'passe-partout · Midnight': ':root[data-preset="passe-partout"] {',
  'passe-partout · Daylight': ':root[data-preset="passe-partout"][data-theme="light"] {',
  'noir · Midnight': ':root[data-preset="noir"] {',
  'noir · Daylight': ':root[data-preset="noir"][data-theme="light"] {',
  'selenium · Midnight': ':root[data-preset="selenium"] {',
  'selenium · Daylight': ':root[data-preset="selenium"][data-theme="light"] {',
  'cyanotype · Midnight': ':root[data-preset="cyanotype"] {',
  'cyanotype · Daylight': ':root[data-preset="cyanotype"][data-theme="light"] {',
};

describe('preset × mode blocks', () => {
  it.each(Object.entries(PRESET_BLOCKS))('%s exists and sets the core tokens', (_label, selector) => {
    const body = block(selector);
    expect(body, selector).toBeTruthy();
    const t = tokens(body);
    for (const name of ['--bg', '--bg-rgb', '--surface', '--fg', '--muted', '--accent', '--accent-rgb', '--accent-wash', '--on-accent']) {
      expect(t[name], name).toBeTruthy();
    }
  });

  it('every preset block pairs --bg with matching --bg-rgb channels', () => {
    for (const selector of Object.values(PRESET_BLOCKS)) {
      const t = tokens(block(selector));
      const hex = t['--bg'];
      const got = t['--bg-rgb'].split(',').map((n) => parseInt(n, 10));
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(got, `${selector} --bg-rgb vs --bg`).toEqual(want);
    }
  });

  it('every preset block pairs --accent with matching --accent-rgb channels', () => {
    for (const selector of Object.values(PRESET_BLOCKS)) {
      const t = tokens(block(selector));
      const hex = t['--accent'];
      const [r, g, b] = t['--accent-rgb'].split(',').map((n) => parseInt(n, 10));
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect([r, g, b], `${selector} --accent-rgb vs --accent`).toEqual(want);
    }
  });
});

describe('noir Midnight = the legacy literals (live-site no-regression)', () => {
  // The exact values css/main.css :root carried before the template pass.
  const LEGACY = {
    '--bg': '#000000',        // was --black
    '--surface': '#0A0A0A',   // was --gray-900 (#0a0a0a)
    '--surface-2': '#1A1A1A',
    '--line': '#1A1A1A',      // was --gray-800
    '--line-2': '#333333',    // was --gray-700
    '--fg': '#E0E0E0',        // was --white
    '--fg-strong': '#F0F0F0', // was --white-bright
    '--muted': '#919191',     // was --gray-300
    '--faint': '#555555',     // was --gray-500
    '--accent': '#FF0000',    // was --red
    '--accent-rgb': '255, 0, 0',
    '--font-display': "'Syne', sans-serif",
    '--font-body': "'Syne Mono', monospace",
    '--font-meta': "'Syne Mono', monospace",
  };

  const t = tokens(block(PRESET_BLOCKS['noir · Midnight']));
  it.each(Object.entries(LEGACY))('%s = %s', (name, value) => {
    expect((t[name] || '').toLowerCase()).toBe(value.toLowerCase());
  });
});

describe('compat shim', () => {
  // Every legacy name page-local <style> blocks may still use.
  const LEGACY_NAMES = [
    '--black', '--white', '--white-bright', '--red', '--red-dim', '--red-glow',
    '--gray-300', '--gray-500', '--gray-700', '--gray-800', '--gray-900', '--font-mono',
  ];
  const shimStart = css.indexOf('COMPAT SHIM');
  const shim = tokens(css.slice(shimStart, css.indexOf('}', css.indexOf(':root', shimStart))));

  it.each(LEGACY_NAMES.map((n) => [n]))('%s is shimmed', (name) => {
    expect(shim[name], name).toBeTruthy();
  });

  it('--red-dim/--red-glow keep their legacy alphas via --accent-rgb (noir pixel parity)', () => {
    expect(shim['--red-dim'].replace(/\s/g, '')).toBe('rgba(var(--accent-rgb),0.2)');
    expect(shim['--red-glow'].replace(/\s/g, '')).toBe('rgba(var(--accent-rgb),0.35)');
  });
});

describe('page wiring', () => {
  // Derived from what this checkout ships — see tests/helpers/pages.js.
  const PAGES = THEMED_PAGES;
  it.each(PAGES.map((p) => [p]))('%s: pre-paint script before stylesheet, tagged preload', (page) => {
    const html = readFileSync(join(import.meta.dirname, '..', page), 'utf8');
    const script = html.indexOf('Pre-paint mode resolution');
    const sheet = html.indexOf('main.css?v=');
    expect(script, 'pre-paint script present').toBeGreaterThan(-1);
    expect(script, 'pre-paint script precedes the stylesheet').toBeLessThan(sheet);
    expect(html).toContain('data-font-preload');
    expect(html).toContain('js/mode-toggle.js');
  });
});

// ---------------------------------------------------------------------------
// The console wears the SITE's brand, not this instance's (2026-08-08 cold run).
//
// A fork installed on the aperture preset opened Field Notes and found the //
// marks in the rendered preview still noir red, because `.fn-preview-area`
// pinned `--accent: #ff2b2b` along with the dark palette it legitimately pins.
// The OG card canvas had the same bug in a harder place: canvas cannot resolve
// CSS variables, so two brand marks were drawn from `'#FF0000'` literals and
// every fork's link previews carried this instance's colour.
//
// Both are the same mistake — a brand value written down instead of derived —
// and the leak scan cannot catch either, because a hex code is not a wordmark.
describe('the console derives its brand rather than hardcoding it', () => {
  const consoleCss = readFileSync(
    join(import.meta.dirname, '..', 'css', 'field-console.css'), 'utf8');

  // The L1 primitives are the ONE place a brand literal belongs. Everything
  // after that first :root block has to go through a token.
  const primitivesEnd = consoleCss.indexOf('}', consoleCss.indexOf('--brand-rgb'));
  const NOIR_LITERALS = /#ff0000|#ff2b2b|#c41111|#5a0000/gi;

  it('keeps every noir brand literal inside the L1 primitives block', () => {
    const strays = [...consoleCss.matchAll(NOIR_LITERALS)]
      .filter((m) => m.index > primitivesEnd)
      .map((m) => `${m[0]} at offset ${m.index}`);
    expect(strays, 'a brand literal outside the primitives cannot follow the preset').toEqual([]);
  });

  it('the rendered preview takes its accent from a token, not a hex', () => {
    // The preview proxies the PUBLIC page, which is dark whatever mode the
    // console is in, so it pins the dark palette locally. Pinning the MODE is
    // right; pinning the BRAND was not — an aperture site previewed its // marks
    // in noir red. (Renamed .fn-preview-area → .fn-preview-body in the 2026-08-23
    // studio rewrite, when the split pane became a slide-over panel.)
    const start = consoleCss.indexOf('.fn-preview-body');
    expect(start, '.fn-preview-body — the preview palette pin — is missing').toBeGreaterThan(-1);
    const body = consoleCss.slice(start, consoleCss.indexOf('}', start));
    const accent = body.match(/--accent:\s*([^;]+);/);
    expect(accent, '.fn-preview-body still pins its own --accent').toBeTruthy();
    expect(accent[1].trim(), 'pin the dark MODE, derive the BRAND').toMatch(/^var\(--/);
  });

  // The contract this pins MOVED in chunk 7 (docs/cards-core-complete.md): the
  // share image is no longer composited in focal.js, it is painted by
  // js/console/card-paint.js from the card's own record. The rule is unchanged
  // and asserted harder — a canvas cannot resolve a CSS variable, so EVERY
  // colour it draws with has to be read at paint time or a fork's link previews
  // wear this instance's preset. It is now the whole palette, not just --brand.
  it('the share painter reads its palette at paint time, never a table', () => {
    const paint = readFileSync(
      join(import.meta.dirname, '..', 'js', 'console', 'card-paint.js'), 'utf8');
    expect(paint, 'canvas has to pull --brand, it cannot inherit it')
      .toMatch(/getPropertyValue\(\s*name\s*\)|getPropertyValue\(\s*['"]--brand['"]\s*\)/);
    for (const token of ['--brand', '--fg-strong', '--muted', '--surface', '--line', '--font-display', '--font-meta']) {
      expect(paint, `${token} has to be read, not restated`).toContain(token);
    }
    // The hexes are allowed in exactly one place: the no-document fallback
    // block, which is neutral greys plus the generic red the old painter used.
    const afterFallbacks = paint.slice(paint.indexOf('export function readCardTokens'));
    expect(/#[0-9a-fA-F]{3,8}\b/.test(afterFallbacks), 'a colour literal past the fallbacks').toBe(false);
    const reds = paint.match(/#(?:FF0000|ff0000|ff2b2b)/gi) || [];
    expect(reds.length, `expected at most a single fallback, found ${reds.length}`)
      .toBeLessThanOrEqual(1);
  });

  it('focal.js no longer draws a share image itself', () => {
    // Its card mode is one paintCard() call. A second compositing path here is
    // how the OG card became a third design of the card in the first place.
    const focal = readFileSync(
      join(import.meta.dirname, '..', 'js', 'console', 'focal.js'), 'utf8');
    expect(focal).toContain("from './card-paint.js'");
    expect(/drawSegments|PHOTO_H|cardCoverRect/.test(focal), 'the old rail geometry is gone').toBe(false);
    const reds = focal.match(/#(?:FF0000|ff0000|ff2b2b)/gi) || [];
    expect(reds.length, 'no brand literal left in the modal at all').toBe(0);
  });
});
