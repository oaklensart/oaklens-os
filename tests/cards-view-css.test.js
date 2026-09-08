// The Cards view's stylesheet must describe the markup the console actually
// renders.
//
// Same gate as tests/audio-shelf-css.test.js, and written for the same defect
// class: CSS that *looks* authored and silently does nothing. The audio shelf
// shipped six emitted-but-unstyled classes and two fully-styled classes nothing
// rendered, for weeks, with a green suite — because neither a test run nor a
// code review opens the page.
//
// This view earned its own copy the moment it was rebuilt from a mockup. That
// mockup carried the exact failure this file catches: rules for a `.fn-hero-body`
// element that appears nowhere in its own HTML, and four `--r-sm`/`--r-md`-style
// radius tokens the console has never defined, which resolve to nothing and
// square every corner without a single error anywhere.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'css', 'field-console.css'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'css', 'main.css'), 'utf8');
const VIEW = readFileSync(join(ROOT, 'js', 'console', 'cards.js'), 'utf8');

// The view's own class prefixes. `is-*` state modifiers are checked separately:
// they are always interpolated onto a base class, so the scan below cannot see
// them and a prefix match would collide with every other surface's states.
const PREFIX = /^(cards-|card-slot|slot-|studio-|control-|layout-|reuse-)[a-z-]*$/;

// Class attributes, with `${…}` interpolations blanked first — most classes in
// this file are built as `class="cards-pill${cond ? ' is-active' : ''}"`, and a
// raw scan would read the whole expression as one unmatchable token and quietly
// check nothing.
const emitted = [...new Set(
  [...VIEW.replace(/\$\{[^}]*\}/g, ' ').matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => PREFIX.test(c)),
)].sort();

// The block runs from its banner to the end of the file.
const START = CSS.indexOf('   CARDS (view-cards)');
const BLOCK = CSS.slice(START);

describe('the Cards view stylesheet matches its markup', () => {
  it('finds classes to check at all', () => {
    // A rewrite to createElement would make every assertion below pass on an
    // empty list, which is worse than not having them.
    expect(START, 'the Cards CSS block moved or lost its banner').toBeGreaterThan(-1);
    expect(emitted.length).toBeGreaterThan(15);
  });

  it('every class the view emits has at least one rule', () => {
    const unstyled = emitted.filter((c) => !new RegExp(`\\.${c}(?![a-z-])`).test(CSS));
    expect(
      unstyled,
      `emitted but unstyled — the browser renders these as bare divs:\n  .${unstyled.join('\n  .')}`,
    ).toEqual([]);
  });

  it('styles the state modifiers the view actually toggles', () => {
    // These ride an interpolation, so the scan above is blind to them — and they
    // are the ones that carry meaning: which slot is focused, which layout is
    // chosen, which option cannot be used.
    for (const rule of [
      '.cards-pill.is-active', '.cards-seg-btn.is-on',
      '.layout-chip.is-on', '.layout-chip.is-blocked',
      '.cards-pending.is-quiet', '.grid-cell.is-active', '.wk-card.is-empty',
      // The badge vocabulary. Each tone must be visibly its own thing, or the
      // strip stops being glanceable and becomes four grey chips.
      '.tone-badge[data-tone="live"]', '.tone-badge[data-tone="staged"]',
      '.tone-badge[data-tone="going"]', '.tone-badge[data-tone="quiet"]',
      // The one control that answers "which card am I looking at".
      '.cards-pill.is-active', '.cards-pill:focus-visible',
      // The card's two shapes. `data-shape` decides which half is visible, and
      // both halves stay in the DOM so a picture can be added or removed without
      // rebuilding the fields being typed into.
      '[data-shape="words"]',
    ]) {
      expect(
        CSS.includes(rule),
        `${rule} is toggled by cards.js but has no rule — the state is invisible`,
      ).toBe(true);
    }
  });

  it('names no custom property the CONSOLE never defines', () => {
    // `var(--nope)` is not a safe default — it is a missing value that silently
    // drops the declaration. The mockup this view was built from invented four.
    //
    // ⚠️ Checked against css/field-console.css ALONE. An earlier version of this
    // test unioned the console's tokens with css/main.css's and therefore passed
    // `var(--font-body)` — a token main.css defines and the console does not.
    // The console never loads main.css, so the declaration was dropped at
    // computed-value time and the card's body copy silently inherited the mono
    // chrome face: a headline and a paragraph in the same typeface, which is
    // exactly what makes type look accidental. A token defined somewhere the
    // surface cannot see is not defined.
    const declared = (src) => [...src.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]);
    const defined = new Set(declared(CSS));
    const used = new Set([...BLOCK.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
    const missing = [...used].filter((v) => !defined.has(v));
    expect(
      missing,
      `undefined in the console (main.css does not count — it is never loaded here): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('pairs a display face with a reading face, per preset', () => {
    // The preview's whole job is showing the relationship between the site's two
    // faces. If a preset sets one and not the other, the card renders its
    // headline and its body in the same typeface and looks accidental.
    const blocks = [...CSS.matchAll(/:root(\[data-preset="[a-z-]+"\])?\s*\{([\s\S]*?)\n\}/g)];
    const withDisplay = blocks.filter(([, , body]) => /--font-display:/.test(body));
    expect(withDisplay.length, 'no preset blocks found — the scan broke').toBeGreaterThan(3);
    for (const [, sel = ':root', body] of withDisplay) {
      expect(
        /--font-body:/.test(body),
        `${sel} sets --font-display but no --font-body`,
      ).toBe(true);
    }
  });

  it('enumerates no colour of its own', () => {
    // Every ground here is a token, so the block follows the instance's preset
    // and both themes for free. A literal hex is a colour that is right on one
    // preset and wrong on the other four.
    const rules = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '');
    const hexes = [...rules.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
    expect(hexes, `hardcoded colours in the Cards block: ${hexes.join(', ')}`).toEqual([]);
  });

  it('carries no rule for markup the view no longer renders', () => {
    // The two-column layout these described was replaced by the source toggle.
    // Dead CSS is not free: it is what makes the next person believe a selector
    // is load-bearing. Comments are stripped first — this file explains the
    // removal in prose, and a prose mention is not a rule.
    const rules = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '');
    // `studio-card` and `card-slot` were the schematic row tile; `slot-act` its
    // compact chips; `cards-panorama` the grid it lived in. All replaced by one
    // faithful card renderer shared by the grid and the studio.
    for (const dead of [
      'cards-columns', 'cards-col', 'cards-col-head', 'cards-shelf',
      'studio-card', 'card-slot', 'slot-act', 'cards-panorama', 'slot-thumb',
      // Three badge classes collapsed into one .tone-badge vocabulary.
      'slot-mark', 'slot-badge', 'cards-pill-badge',
    ]) {
      expect(
        new RegExp(`\\.${dead}(?![a-z-])`).test(rules),
        `.${dead} has rules but nothing renders it — delete it or render it`,
      ).toBe(emitted.includes(dead));
    }
    // The studio stopped drawing a blank 4:5 well for picture-less kinds, so the
    // rule that filled one has to go with it — otherwise the next person reads
    // it as proof the empty well is still a considered state.
    expect(
      rules.includes('.studio-media.is-blank'),
      '.studio-media.is-blank is styled but studioCardHtml no longer renders it',
    ).toBe(false);
  });

  it('makes the reuse shelf one scroll container with unshrinkable children', () => {
    // The bug this replaced: a scroller nested between two `flex-shrink: 0`
    // siblings took `flex: 1`, computed to ~44px on a 393px phone, hid its own
    // scrollbar and was then clipped by an ancestor — so the chips on the right
    // were unreachable with no way to know they existed.
    expect(CSS).toMatch(/\.cards-reuse-track\s*\{[^}]*overflow-x:\s*auto/);
    expect(
      CSS,
      'the reuse label must scroll WITH the chips, not sit beside them as a rigid sibling',
    ).toMatch(/\.cards-reuse-label,\s*\.reuse-chip\s*\{\s*flex:\s*0 0 auto/);
    // Same shape, same reason, for the slot ribbon.
    expect(CSS).toMatch(/\.cards-ribbon\s*\{[^}]*overflow-x:\s*auto/);
    expect(CSS).toMatch(/\.cards-ribbon-label,\s*\.cards-pill\s*\{\s*flex:\s*0 0 auto/);
  });

  it('unbinds the view at the SAME breakpoint the rail drops under the stage', () => {
    // The bug this pins, and it is the reuse-shelf bug in a second costume: the
    // rail stops being a column and becomes a stacked ROW at 1180, but the rules
    // that let the view scroll shipped at 640. Between the two — every tablet,
    // which is the console's field device — the stage and the rail were crushed
    // into one `height: 100%; overflow: hidden` box. Measured on an 834 × 700
    // viewport: the card came out 296 × 139 (picture 138, words ~1) and the rail
    // showed 203px of its natural 674 through its own thin nested scrollbar.
    // The stack and the scroll are ONE change and must stay in one query.
    // Scoped to the Cards block — the console has an earlier 1180px query of
    // its own, and matching that one would test nothing.
    const q = BLOCK.match(/@media \(max-width: 1180px\) \{\n([\s\S]*?)\n\}/);
    expect(q, 'the 1180px block moved or lost its shape').not.toBeNull();
    const block = q[1];
    expect(block, 'this is the query that stacks the rail')
      .toMatch(/\.cards-studio\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(block, 'so it is the query that must let the page scroll')
      .toMatch(/#view-cards\.view--bounded\.active\s*\{[^}]*overflow:\s*visible/);
    expect(block, 'and the studio itself must stop clipping its second row')
      .toMatch(/\.cards-studio\.is-composing\s*\{[^}]*overflow:\s*visible/);
  });
});
