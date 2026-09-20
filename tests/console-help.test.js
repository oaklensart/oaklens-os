// ============================================================================
// HELP — the copy is the product here, so the copy is what gets gated.
//
// The logic in js/console/help.js is small and boring on purpose. What can
// actually rot is the forty sentences it ships: a control gets renamed and an
// entry quietly points at nothing, or a future session writes "stages into
// archive.json" and the whole feature becomes the thing it was built to fix.
//
// Both are mechanical, so both are tests.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const MODULE = readFileSync(join(ROOT, 'js/console/help.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');

/** The table, read out of the module the way the console loads it. */
const HELP = (await import(join(ROOT, 'js/console/help.js'))).HELP;

/** Every `#view-<name>` section the console actually ships. */
const VIEWS = [...SHELL.matchAll(/id="view-([\w-]+)"/g)].map((m) => m[1]);

/** The markup the console can produce: the shell plus every module that draws. */
const RENDERED = SHELL + ['cards', 'pulse', 'fn-editor', 'audio']
  .map((m) => readFileSync(join(ROOT, `js/console/${m}.js`), 'utf8')).join('');

describe('help entries point at controls that exist', () => {
  it('found the table at all (regex sanity)', () => {
    expect(HELP.length).toBeGreaterThan(30);
    expect(VIEWS.length).toBeGreaterThan(10);
  });

  // THE anti-drift gate. A renamed control becomes a red suite naming the
  // entry, instead of a help card that lights up nothing and says nothing.
  it.each(HELP.map((h) => [h.sel, h]))('%s resolves in the shipped markup', (sel, item) => {
    // Every alternative is checked, not just the first — an either/or selector
    // whose second half has rotted is exactly the silent rot this gate is for.
    // And every TOKEN within one: `.aud-row .aud-actions` is two classes, and a
    // rename of either half breaks it just as completely.
    for (const part of sel.split(',').map((x) => x.trim())) {
      const tokens = part.match(/[#.][\w-]+/g) ?? [];
      expect(tokens.length, `${part} (${item.title}) names no id or class`).toBeGreaterThan(0);
      for (const token of tokens) {
        const name = token.slice(1);
        const pattern = token.startsWith('#')
          ? new RegExp(`id=["']${name}["']`)
          : new RegExp(`class=["'][^"']*\\b${name}\\b`);
        expect(pattern.test(RENDERED), `${token} in "${part}" (${item.title}) matches nothing the console renders`)
          .toBe(true);
      }
    }
  });

  it('names only views the console has', () => {
    const bad = HELP.filter((h) => h.view !== '*' && !VIEWS.includes(h.view));
    expect(bad.map((h) => `${h.sel} → ${h.view}`)).toEqual([]);
  });

  // A `?` that says nothing on a view reads as broken, not as "nothing to say".
  it('leaves no view without an answer', () => {
    const covered = new Set(HELP.map((h) => h.view));
    expect(VIEWS.filter((v) => !covered.has(v)), 'views with no help entry').toEqual([]);
  });

  it('offers the top bar everywhere', () => {
    expect(HELP.filter((h) => h.view === '*').length).toBeGreaterThanOrEqual(5);
  });
});

describe('the copy stays plain', () => {
  const text = (h) => [h.title, h.body, h.note ?? ''].join(' ');

  // Not style policing — this is the feature's whole premise. Every one of
  // these was in the design sketch's copy, which is exactly why it is a list
  // and not a note in a review. docs/ideas/yvonne-test.md is the standard:
  // "Would Yvonne get this sentence cold — no follow-up question?"
  const JARGON = [
    'R2', 'KV', 'D1', 'JSON', 'localStorage', 'srcset', 'WebP', 'endpoint',
    'API', 'CDN', 'manifest', 'client-side', 'bearer', 'SHA-256', 'repo',
    'git', 'commit', 'cache', 'metadata', 'boolean', 'config',
  ];
  it.each(JARGON)('says nothing about "%s"', (word) => {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    const hits = HELP.filter((h) => re.test(text(h))).map((h) => `${h.sel}: ${h.title}`);
    expect(hits, `"${word}" appears in help copy`).toEqual([]);
  });

  // docs/os-positioning.md: naming a discipline as an EXAMPLE is fine; naming
  // one as the category is not — and this copy ships verbatim to every fork.
  it.each(['photography site', 'photo site', 'photography platform'])(
    'never calls the product a "%s"', (phrase) => {
      const hits = HELP.filter((h) => text(h).toLowerCase().includes(phrase));
      expect(hits.map((h) => h.sel)).toEqual([]);
    },
  );

  // Engine copy carries no instance. A fork must not read someone else's name.
  it('carries no instance identity', () => {
    const hits = HELP.filter((h) => /oaklens|\.art\b|https?:\/\//i.test(text(h)));
    expect(hits.map((h) => h.sel), 'help copy naming an instance').toEqual([]);
  });

  // Brevity is the ask, so brevity is enforced rather than hoped for.
  it('stays short enough to read standing up', () => {
    const over = [];
    for (const h of HELP) {
      if (h.title.length > 32) over.push(`${h.sel} title ${h.title.length}/32`);
      if (h.body.length > 220) over.push(`${h.sel} body ${h.body.length}/220`);
      if ((h.note ?? '').length > 120) over.push(`${h.sel} note ${h.note.length}/120`);
    }
    expect(over).toEqual([]);
  });

  it('gives every entry a title and a body', () => {
    const thin = HELP.filter((h) => !h.title?.trim() || !h.body?.trim());
    expect(thin.map((h) => h.sel)).toEqual([]);
  });
});

describe('the overlay is wired into the console', () => {
  it('puts a ? in the top bar, beside the other chrome', () => {
    expect(SHELL).toMatch(/id="help-topbar-btn"[\s\S]{0,200}?onclick="helpToggle\(\)"/);
    expect(SHELL, 'the ? button rides the existing .settings-btn cluster')
      .toMatch(/class="settings-btn" id="help-topbar-btn"/);
  });

  it('styles every class the module emits', () => {
    const classes = new Set(
      [...MODULE.matchAll(/class="(help-[\w-]+)"/g)].map((m) => m[1]),
    );
    classes.add('help-target');
    const missing = [...classes].filter((c) => !CSS.includes(`.${c}`));
    expect(missing, 'help classes with no rule in field-console.css').toEqual([]);
  });

  it('names no colour of its own', () => {
    const section = CSS.slice(CSS.indexOf('   HELP — "what does this do?"'));
    const literals = [...section.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g)].map((m) => m[0]);
    expect(literals, 'the help layer must wear the site accent, not its own')
      .toEqual([]);
  });

  it('sits under the modals and over the sheets', () => {
    expect(CSS).toMatch(/\.help-layer\s*\{[\s\S]*?z-index:\s*470/);
  });

  // The bug this whole shape exists to avoid: the sketch mutated other
  // components with !important to make them look lit. The hole does that job.
  it('mutates no other module\'s styling', () => {
    expect(MODULE).not.toMatch(/!important/);
    expect(MODULE).not.toMatch(/\.style\.(color|filter|background|opacity)\s*=/);
  });
});
