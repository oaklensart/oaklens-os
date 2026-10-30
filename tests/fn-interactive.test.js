// Interactive blocks in a field note (manual §5.11): js/page-fn-post.js
// imports the module a `.fn-interactive[data-module]` div names. The guard
// below decides which names it will import; the strict CSP ('self') is the
// enforcement, this is what keeps a typo or a pasted URL from being tried.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdown } from '../js/markdown-engine.js';

const ROOT = join(import.meta.dirname, '..');
const src = readFileSync(join(ROOT, 'js/page-fn-post.js'), 'utf8');
const fnSrc = src.match(/function isInteractiveModule\(src\) \{[\s\S]*?\n\}/)[0];
const isInteractiveModule = new Function(`${fnSrc}; return isInteractiveModule;`)();

describe('fn-interactive module guard', () => {
  it('accepts a root-relative .js path, with or without a ?v=', () => {
    expect(isInteractiveModule('/embeds/x/lattice.js')).toBe(true);
    expect(isInteractiveModule('/embeds/x/lattice.js?v=1')).toBe(true);
  });

  it.each([
    'https://evil.example/x.js',
    '//evil.example/x.js',
    'embeds/x.js',
    '/embeds/../src/x.js',
    '/embeds/x.json',
    '/embeds/x.js?v=1&y=2',
    'javascript:alert(1)',
    '',
    undefined,
  ])('refuses %s', (bad) => {
    expect(isInteractiveModule(bad)).toBe(false);
  });

  it('the block survives the markdown engine intact', () => {
    const html = renderMarkdown('<div class="fn-interactive" data-module="/embeds/x/a.js?v=1"></div>\n\nWords.');
    expect(html).toContain('<div class="fn-interactive" data-module="/embeds/x/a.js?v=1"></div>');
    expect(html).toContain('<p>Words.</p>');
  });
});

// The extractor is instance tooling and is not in a fork's tree, so this runs
// here only; the fork's own guarantee is that it has no embeds/ at all.
const EXTRACTOR = join(ROOT, 'scripts/os-extract.mjs');
describe.skipIf(!existsSync(EXTRACTOR))('embeds/ is instance content (instance)', () => {
  it('is not a directory the fork extractor copies', () => {
    const extractor = readFileSync(EXTRACTOR, 'utf8');
    const include = extractor.match(/const INCLUDE_DIRS = \[([\s\S]*?)\];/)[1];
    expect(include).not.toMatch(/'embeds/);
  });

  // A stray fragment in a stylesheet makes the browser drop the NEXT rule
  // block: on 2026-10-23 a leftover `}, .6); }` swallowed the lattice's phone
  // layout and squeezed it to zero width on every phone.
  it('the lattice stylesheet has balanced braces and no stray fragments', () => {
    const lattice = readFileSync(join(ROOT, 'embeds/small-honesty/lattice.js'), 'utf8');
    const css = lattice.match(/const CSS = `([\s\S]*?)`;/)[1].replace(/\$\{[^}]*\}/g, 'X');
    let depth = 0;
    for (const ch of css) { depth += ch === '{' ? 1 : ch === '}' ? -1 : 0; expect(depth).toBeGreaterThanOrEqual(0); }
    expect(depth).toBe(0);
    // every closing brace ends a rule or a block: nothing but whitespace, a
    // comment, or the next selector/at-rule may follow it on its line
    expect(css).not.toMatch(/\}[ \t]*[,)]/);
  });
});
