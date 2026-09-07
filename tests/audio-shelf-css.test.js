// The Audio shelf's stylesheet must describe the markup the console actually
// renders.
//
// It stopped doing that at some point and nobody noticed for weeks. renderAudio
// emitted `.aud-row` as the OUTER container plus `.aud-main`, `.aud-actions`,
// `.aud-title`, `.aud-sub`, `.aud-meta` and `.aud-badge` — and all six had zero
// declarations. Meanwhile `.aud-card` and `.aud-play-btn` were fully styled and
// emitted nowhere: the CSS was written for an earlier markup shape that had been
// replaced under it. The shelf also rendered into `.archive-list`, a
// `repeat(auto-fill, minmax(280px,1fr))` grid, so every row was a 280px cell
// with six action buttons wrapping inside it and the full-width playlist banner
// trapped in one column.
//
// This is the same defect class as the `--well` token the 2026-08-14 audit
// caught (docs/maintenance/2026-08-14-audio-layer-audit-and-card-theming.md):
// CSS that *looks* authored and silently does nothing. Neither a passing suite
// nor a code review catches it — only opening the page does, and nobody opens
// every page. So it gets a gate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'css', 'field-console.css'), 'utf8');
const AUDIO = readFileSync(join(ROOT, 'js', 'console', 'audio.js'), 'utf8');
const SHELL = readFileSync(join(ROOT, 'dev', 'field-console.html'), 'utf8');

// Every `aud-*` class the module puts in a class attribute.
const emitted = [...new Set(
  [...AUDIO.matchAll(/class="([^"]*\baud-[^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => /^aud-[a-z-]+$/.test(c)),
)].sort();

describe('the Audio shelf stylesheet matches its markup', () => {
  it('finds classes to check at all', () => {
    // If renderAudio is ever rewritten to build DOM instead of strings this
    // scan silently passes on an empty list, which would be worse than useless.
    expect(emitted.length).toBeGreaterThan(6);
  });

  it('every class the shelf emits has at least one rule', () => {
    const unstyled = emitted.filter(
      (c) => !new RegExp(`\\.${c}(?![a-z-])`).test(CSS),
    );
    expect(
      unstyled,
      `emitted but unstyled — the browser renders these as bare divs:\n  .${unstyled.join('\n  .')}`,
    ).toEqual([]);
  });

  it('names no custom property the stylesheet never defines', () => {
    // `var(--nope, #fff)` is not a safe default — it is a hardcoded colour
    // wearing a token's clothes, right on one preset and wrong on the rest.
    // This caught `--danger` on the way in; `--well` was the same shape.
    //
    // Declarations are matched anywhere, not just at line start: this file packs
    // several onto one line (`--dur-1: 120ms; --dur-2: 220ms;`), and a token can
    // be scoped to a selector rather than :root.
    const declared = (src) =>
      [...src.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]);
    const defined = new Set([
      ...declared(CSS),
      ...declared(readFileSync(join(ROOT, 'css', 'main.css'), 'utf8')),
    ]);

    const start = CSS.indexOf('/* ============ AUDIO SHELF');
    const end = CSS.indexOf('/* Audio Library modal styles */');
    expect(start, 'the audio shelf block moved').toBeGreaterThan(-1);
    expect(end, 'the audio library block moved').toBeGreaterThan(start);

    const used = new Set(
      [...CSS.slice(start, end).matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]),
    );
    const missing = [...used].filter((v) => !defined.has(v));
    expect(
      missing,
      `undefined custom properties in the audio shelf block: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('does not carry rules for markup nothing emits', () => {
    // .aud-card and .aud-play-btn were the leftovers. Dead CSS is not free: it
    // is the thing that makes the next person believe the shelf is styled.
    // Comments stripped first — this file explains in prose why those two were
    // removed, and a prose mention is not a rule.
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const dead of ['aud-card', 'aud-play-btn']) {
      expect(
        new RegExp(`\\.${dead}(?![a-z-])`).test(rules),
        `.${dead} has rules but nothing renders it — delete it or render it`,
      ).toBe(emitted.includes(dead));
    }
  });

  it('renders the shelf as a list, not into the archive card grid', () => {
    // .archive-list is a 280px auto-fill grid. A row of six buttons does not
    // fit one, and the playlist banner cannot span it.
    expect(SHELL).toContain('class="aud-list" id="audio-display"');
    expect(SHELL, 'the shelf borrowed the archive grid').not.toMatch(
      /class="archive-list" id="audio-display"/,
    );
    expect(CSS).toMatch(/\.aud-list\s*\{[^}]*flex-direction:\s*column/);
  });
});
