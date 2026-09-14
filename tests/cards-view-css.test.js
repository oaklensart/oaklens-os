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
      // The composed card's shape, stamped by the engine's cardRoot and moved by
      // the surgical repaint: the palette ground binds to it on picture cards.
      '[data-shape="picture"]',
      // The editable leaves — the composer is the renderer's own card since
      // chunk 2 — and the placeholder that lives on an attribute, not a value.
      '[contenteditable]', '[data-empty]::before',
      // The words tile's furniture, present on every mounted field-note card.
      '.wk-dropcap', '.ed-caret', '.card-face .wk-text',
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

  it('gives every chip in the rail a real tap target on a touch screen', () => {
    // The swatches were 28px circles with an invisible 44px halo (a ::before
    // bleeding 8px on every side). The labelled buttons that replaced them on
    // 2026-09-12 dropped the halo and measured 28px tall on a phone — a target
    // no thumb lands on twice. Same bargain the pills and the layout chips
    // already make, in the same query.
    // The Cards block carries two coarse-pointer queries (the composer's bar
    // buttons have their own); the one under test is the one with the pills.
    const blocks = [...BLOCK.matchAll(/@media \(pointer: coarse\) \{\n([\s\S]*?)\n\}/g)].map((m) => m[1]);
    const q = blocks.find((b) => b.includes('.cards-pill'));
    expect(q, 'the coarse-pointer block with the pills moved or lost its shape').toBeTruthy();
    for (const sel of ['.cards-pill', '.layout-chip', '.cards-swatch']) {
      expect(q, `${sel} takes --tap under a coarse pointer`)
        .toMatch(new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*min-height:\\s*var\\(--tap\\)`));
    }
  });

  it('the studio footer fills the card, the way the homepage\'s does', () => {
    // The grid stretches every card to its row. A footer that stops at its
    // text leaves the card's ground showing beneath it — on a palette card, a
    // tinted footer that "does not reach the bottom". A composer fix on
    // 2026-09-12 snugged `.wk-body` to `flex: 0 0 auto` for every card face and
    // the composed card came out 38px shorter than its neighbours.
    expect(CSS).toMatch(/\.card-face \.wk-body\s*\{[^}]*flex:\s*1 1 auto/);
    // The picture card's footer specifically — the audio caption and the
    // overlay band are different objects with their own sizing.
    expect(CSS, 'no picture-card rule may un-grow the footer')
      .not.toMatch(/\.card-face[^{]*data-shape="picture"[^{]*\.wk-body\s*\{[^}]*flex:\s*0 0 auto/);
  });

  it('keeps the unbounding and the stacked rail in ONE query, below the tablet', () => {
    // The bug this pins, and it is the reuse-shelf bug in a second costume: the
    // rail stops being a column and becomes a stacked ROW, but the rules that
    // let the page scroll ship at a different width. Between the two the stage
    // and the rail are crushed into one `height: 100%; overflow: hidden` box
    // with no scroller above them — measured once on an 834 × 700 viewport: the
    // card came out 296 × 139 (picture 138, words ~1) and the rail showed 203px
    // of its natural 674 through a thin nested scrollbar.
    //
    // These two have been split apart twice and had to be put back both times.
    // The rule that survives is the invariant, not the number: WHEREVER the
    // rail stacks under the stage, THAT query is also the one that unbinds the
    // view, because a stacked rail has no scroller of its own and only the page
    // can carry it. Beside the stage it is its own scroller and the view is
    // bounded — which is the tablet block below.
    const stack = BLOCK.match(
      /@media \(max-width: (\d+)px\) \{\n((?:(?!@media)[\s\S])*?\.studio-rail\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit[\s\S]*?)\n\}/);
    expect(stack, 'the query that stacks the rail moved or lost its shape').not.toBeNull();
    const block = stack[2];
    expect(block, 'stacked, the studio is one column')
      .toMatch(/\.cards-studio\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(block, 'the query that stacks the rail must also let the page scroll')
      .toMatch(/#view-cards\.view--bounded\.active\s*\{[^}]*overflow:\s*visible/);
    expect(block, 'and the studio itself must stop clipping its overflow')
      .toMatch(/\.cards-studio,\s*\n\s*\.cards-studio\.is-composing\s*\{[^}]*overflow:\s*visible/);

    // And the other half of the invariant: the stack may not reach up into the
    // tablet band, where the view is bounded on purpose.
    expect(Number(stack[1]), 'the rail may not stack where the view is bounded')
      .toBeLessThan(700);
  });

  it('keeps the studio two panes on a tablet, bounded, with the rail the one scroller', () => {
    // Two owner reports, one surface, 2026-09-12. The first: the settings were
    // "all over the place" on an iPad mini — the rail was dropping under the
    // stage for the whole band. The fix for THAT kept the page scrolling and
    // pinned the stage with `position: sticky`, and the second report named what
    // that costs: one flick drove the page and the card at two different rates,
    // "very floaty". A sticky pane inside a scrolling page is two scrollers by
    // construction. So the band is bounded like the desktop, the well holds
    // still, and `.studio-rail`'s own overflow is the only thing that moves.
    const q = BLOCK.match(/@media \(min-width: 700px\) and \(max-width: 1180px\) \{\n([\s\S]*?)\n\}/);
    expect(q, 'the tablet block moved or lost its shape').not.toBeNull();
    const block = q[1];

    // Two panes, and the rail keeps the desktop's 340px — the SHARE block's
    // address row has a min-content width of ~332px and hangs out of anything
    // narrower.
    const cols = block.match(/\.cards-studio,\s*\n\s*\.cards-studio\.is-composing\s*\{([^}]*)\}/);
    expect(cols, 'the tablet studio must declare both columns').not.toBeNull();
    expect(cols[1]).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) (3[4-9]\d|[4-9]\d\d)px/);

    // THE REGRESSION. Neither of the two shapes that put a second scroller on
    // this surface may come back: the stage is not sticky, and the view is not
    // unbound.
    expect(block, 'a sticky stage is the two-rate scroll — never again')
      .not.toMatch(/position:\s*sticky/);
    expect(block, 'the tablet view stays bounded')
      .not.toMatch(/#view-cards\.view--bounded\.active\s*\{[^}]*overflow:\s*visible/);

    // The well holds still AND answers the card's sizing — `container-type` is
    // what makes `cqh` mean anything, and `overflow: hidden` is what "locked"
    // means. They ship together or the card is measuring a box that can grow.
    //
    // ⚠️ Both now come from the BASE rules, not from this band. They were the
    // band's own until 2026-09-13, when the well stopped scrolling on every
    // screen rather than only on a tablet; the band's copies were deleted so one
    // formula could not drift into two. The invariant is unchanged and is
    // asserted against the whole block — what this band must still carry, and
    // the only thing that legitimately differs here, is its RESERVE.
    expect(BLOCK, 'the well is locked').toMatch(/\n\.studio-stage \{[^}]*overflow:\s*hidden/);
    expect(BLOCK, 'and it is the card\'s query container')
      .toMatch(/\n\.studio-stage \{[^}]*container-type:\s*size/);
    expect(block, 'the band restates its own reserve')
      .toMatch(/\.cards-studio \{\s*--card-rsv:\s*\d+px;?\s*\}/);

    // The card is sized to the well rather than the well to the card, and the
    // sum keeps its 300px cap through `min()` — which is also the fallback for a
    // browser with no container query units.
    expect(BLOCK, 'the card sum is declared once, on the studio')
      .toMatch(/--card-w:\s*min\(300px,\s*calc\(\(100cqh\s*-\s*var\(--card-rsv\)\)\s*\*\s*0\.8\)\)/);
    expect(BLOCK, 'and the card reads it').toMatch(/\.studio-stage \.card-face \.wk-card\s*\{[^}]*max-width:\s*var\(--card-w\)/);
    // ⚠️ THREE CLASSES, NEVER FOUR. At four it outranks WRITE MODE's
    // `body.kb-open .card-face .wk-card` and sizes the card against a well the
    // keyboard has already taken — a 113px card, seen on the way in. State goes
    // in `--card-rsv`, which is why that variable exists.
    expect(block, 'no state may be written into the card selector itself')
      .not.toMatch(/\.is-composing[^{]*\.wk-card\s*\{[^}]*max-width/);

    // Keys up the rail is hidden (WRITE MODE), so its column goes too — else the
    // card writes itself into two thirds of the width with 340px of nothing
    // beside it. That rule moved INTO write mode when write mode grew to cover
    // the whole band; a landscape tablet is 744px tall with ~350px of keyboard
    // on it and cannot afford the head, the ribbon or the rail.
    const write = BLOCK.match(/@media \(max-width: 1180px\) \{\n((?:(?!@media)[\s\S])*?body\.kb-open[\s\S]*?)\n\}/);
    expect(write, 'the WRITE MODE block moved or lost its shape').not.toBeNull();
    expect(write[1], 'with the rail hidden the studio is one column')
      .toMatch(/body\.kb-open \.cards-studio[\s\S]*?\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(write[1], 'keys up, the rail goes')
      .toMatch(/body\.kb-open \.cards-studio\.is-composing \.studio-rail\s*\{\s*display:\s*none/);
  });

  it('buys back the rows a bounded tablet needs, and says which', () => {
    // Bounded, the rows are finite and every one has to be earned. Two step
    // aside for the whole band and two more when the tablet is held sideways —
    // if any of them comes back without the height coming with it, the card is
    // what pays, and the card is the thing this surface is for.
    const band = BLOCK.match(/@media \(min-width: 700px\) and \(max-width: 1180px\) \{\n([\s\S]*?)\n\}/)[1];
    expect(band, 'the note steps aside band-wide').toMatch(/\.cards-note\s*\{\s*display:\s*none/);
    expect(band, 'and the re-feature strip while composing')
      .toMatch(/body:has\(\.cards-studio\.is-composing\) \.cards-reuse\s*\{\s*display:\s*none/);

    const short = BLOCK.match(
      /@media \(min-width: 700px\) and \(max-width: 1180px\) and \(max-height: (\d+)px\) \{\n([\s\S]*?)\n\}/);
    expect(short, 'the sideways block moved or lost its shape').not.toBeNull();
    // Above every 4:3 tablet in landscape (744, 768, 810, 820) and below every
    // one of them held upright (1024 and up) — the cut is the ORIENTATION.
    expect(Number(short[1])).toBeGreaterThanOrEqual(820);
    expect(Number(short[1])).toBeLessThan(1024);
    const sideways = short[2];
    expect(sideways, 'sideways, the strip goes entirely').toMatch(/\.cards-reuse\s*\{\s*display:\s*none/);
    expect(sideways, 'and the ribbon while composing')
      .toMatch(/body:has\(\.cards-studio\.is-composing\) \.cards-ribbon\s*\{\s*display:\s*none/);
    // The well turns sideways too: what was stacked over and under the card
    // stands beside it, which is where the card's height comes from.
    expect(sideways, 'the well lays its contents in a row').toMatch(/flex-flow:\s*row wrap/);
    expect(sideways, 'and the card takes a definite width to be the tall column')
      .toMatch(/body:not\(\.kb-open\) \.studio-stage \.card-face\s*\{[^}]*width:\s*var\(--card-w\)/);
    // A row layout carries less above and below the card, so the reserve the
    // sum spends is restated here rather than inherited from the column one.
    expect(sideways, 'the sideways reserve is restated for the layout it uses')
      .toMatch(/\.cards-studio\s*\{\s*--card-rsv:\s*\d+px/);
    // The danger zone is a shortcut, not structure, and at 744px its row is
    // ~30px of photograph on all four cards. It shipped without this and was
    // the only row in the band that had not been earned (2026-09-13).
    expect(sideways, 'the danger zone steps aside sideways too')
      .toMatch(/\.cards-danger\s*\{\s*display:\s*none/);
  });

  // ---- the grid fits the view (2026-09-13) ----
  //
  // The owner's report was "the grid is no longer static — you have to scroll";
  // the cause was that the row took its height from the tallest card and the
  // view had just gained a footer. A row sized to the SPACE cannot do that. The
  // pieces are load-bearing together and each one has a way of quietly going
  // missing, so each is named here.
  it('sizes the grid row to the space, and the cards to the row', () => {
    const grid = BLOCK.match(/\n\.cards-grid \{\n([\s\S]*?)\n\}/)[1];
    expect(grid, 'one row, taking what the bounded shell has left')
      .toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)/);
    expect(grid, 'the row is the query container the cards measure against')
      .toMatch(/container-type:\s*size/);
    expect(grid, 'and the reserve the sum spends is named, not inlined')
      .toMatch(/--cell-rsv:\s*\d+px/);

    const cap = BLOCK.match(/\.cards-grid > \.grid-cell \{\n([\s\S]*?)\n\}/)[1];
    // `0.8` is `1 / 1.25` — a card is a 4:5 picture over a footer, so its
    // height runs ~1.25 × its width and this goes back the other way. The same
    // sum sizes the card in the tablet studio; if one moves, both should.
    expect(cap, 'the cell is capped from the row height, via the reserve')
      .toMatch(/max-width:\s*min\(100%,\s*calc\(\(100cqh - var\(--cell-rsv\)\) \* 0\.8\)\)/);
  });

  it('stops the fit rule at two columns rather than shrinking to nothing', () => {
    // Two rows halve the height each card gets: held upright an iPad mini
    // leaves ~600px, and a card that still fits in half of that is 119px wide,
    // which is a preview of nothing. Below 900px the cap comes off and the grid
    // scrolls with the cards at full size — which is what it always did.
    const two = BLOCK.match(/@media \(max-width: 900px\) \{\n([\s\S]*?)\n\}\n/)[1];
    expect(two, 'the rows go back to natural height').toMatch(/grid-auto-rows:\s*auto/);
    expect(two, 'the grid stops being a size container').toMatch(/container-type:\s*normal/);
    expect(two, 'and the cap comes off the cell').toMatch(/max-width:\s*none/);
  });

  it('clips a squeezed tease instead of letting it paint over the caption', () => {
    // The card's children are `flex: 0 1 auto`, so a short row shrinks the
    // tease's box while its text keeps its height — and `overflow: visible` ran
    // the sentence straight through `San Francisco · 2026` and out of the card.
    expect(BLOCK, 'the tease clips in the studio grid')
      .toMatch(/\.grid-cell \.wk-text \.wk-snip\s*\{\s*overflow:\s*hidden/);
  });

  // ---- the well never scrolls either (2026-09-13) ----
  //
  // Same contract as the grid above, on the surface next door, and the owner
  // named it that way: "static in all views". The card is sized to the WELL,
  // which is the one move that neither clips the card nor changes its ratio.
  it('holds the studio well still and makes it the card\'s query container', () => {
    const stage = BLOCK.match(/\n\.studio-stage \{\n([\s\S]*?)\n\}/)[1];
    expect(stage, 'the well is not a scroller').toMatch(/overflow:\s*hidden/);
    expect(stage, 'and it is what the card measures itself against')
      .toMatch(/container-type:\s*size/);
    expect(stage, 'a scrollbar width here would mean it is still expected to scroll')
      .not.toMatch(/scrollbar-width/);
  });

  it('sizes the card to the well in EVERY view, not only on a tablet', () => {
    // The sum lived in the tablet band alone until a desktop was found carrying
    // a permanent 7px scrollbar: `min-height: 420px` + a 300px card + the
    // button came to 4px more than a 1440x900 well.
    // ONE `.cards-studio` rule, not two — the tokens live with it. A second
    // block of the same selector sixty lines away is how two reserves end up
    // disagreeing, and this assertion is what found it.
    const studios = [...BLOCK.matchAll(/\n\.cards-studio \{\n([\s\S]*?)\n\}/g)];
    expect(studios, 'the studio is declared once at the top level').toHaveLength(1);
    const studio = studios[0][1];
    expect(studio, 'the base reserve is named').toMatch(/--card-rsv:\s*\d+px/);
    expect(studio, 'and the base sum is the one every band inherits')
      .toMatch(/--card-w:\s*min\(300px,\s*calc\(\(100cqh - var\(--card-rsv\)\) \* 0\.8\)\)/);
    expect(BLOCK, 'composing holds more around the card, so it restates the reserve')
      .toMatch(/\.cards-studio\.is-composing \{\s*--card-rsv:\s*\d+px;?\s*\}/);

    const card = BLOCK.match(/\n\.studio-stage \.card-face \.wk-card \{\n([\s\S]*?)\n\}/)[1];
    expect(card, 'the card is capped from the well').toMatch(/max-width:\s*var\(--card-w\)/);
    // The 420px floor is what forced the overflow on a short well, and a 4:5
    // picture at the 300px cap already stands 375px tall without it.
    expect(card, 'and carries no floor to fight the cap').toMatch(/min-height:\s*0/);
    expect(card, 'the 420px floor must not come back').not.toMatch(/min-height:\s*420px/);
  });

  it('exempts a words-only tile, where narrower is TALLER', () => {
    // The cap trades width for height, which only works while the height it
    // buys back belongs to a picture. All type and no picture: narrowing it
    // reflows the tease onto more lines and makes the card bigger. Measured at
    // 1280x800 — capped to 197px it overflowed by 22px; at full width it fits.
    expect(BLOCK, 'a text card with no layout keeps its full width')
      .toMatch(/\.studio-stage \.card-face \.wk-card\.wk-text:not\(\[data-layout\]\)\s*\{\s*max-width:\s*300px/);
  });

  it('lets the composer be bounded by the well too', () => {
    // The 2026-09-12 pass took a scrolling well as "the cheaper wrong" against
    // a CRUSHED picture. Capping the width changes no ratio at all, so the
    // trade is gone and `max-height: none` with it.
    const composed = BLOCK.match(
      /\.cards-studio\.is-composing \.studio-stage \.card-face\.is-editing \.wk-card \{\n([\s\S]*?)\n\}/)[1];
    expect(composed, 'the composer card is bounded by the well').toMatch(/max-height:\s*100%/);
    expect(composed, 'and must not opt back out of it').not.toMatch(/max-height:\s*none/);
    // The picture stays rigid at 4:5 — that rule is what makes "smaller" not
    // mean "crushed", and it is the whole reason the trade above is gone.
    expect(BLOCK, 'the composer picture keeps its ratio')
      .toMatch(/\.wk-card\[data-shape="picture"\] \.wk-img \{[^}]*aspect-ratio:\s*4 \/ 5/);
  });

  it('keeps ONE copy of the card sum — the tablet band restates only its reserve', () => {
    // Two copies of one formula is one copy and a bug waiting: the band carried
    // its own `--card-w`, `container-type` and card cap until the base gained
    // them. What legitimately differs there is the reserve, and only that.
    const band = BLOCK.match(/@media \(min-width: 700px\) and \(max-width: 1180px\) \{\n([\s\S]*?)\n\}/)[1];
    expect(band, 'the band sets its own reserve').toMatch(/\.cards-studio \{\s*--card-rsv:\s*\d+px;?\s*\}/);
    expect(band, 'and does NOT restate the sum').not.toMatch(/--card-w:/);
    expect(band, 'nor the cap').not.toMatch(/max-width:\s*var\(--card-w\)/);
  });

  it('sizes the overlay plate to the card in the grid, not to the window', () => {
    // The plate's ladder is authored in `vw`, which is right in the composer
    // (window and card grow together) and wrong in the grid (the card is sized
    // to the row). A 171px card on a 1280px window asked for 41.6px type and
    // ran "Amigos." off the photograph. Same numbers against the card instead.
    expect(BLOCK, 'the card-face is the inline-size container')
      .toMatch(/\.grid-cell \.card-face\s*\{\s*container-type:\s*inline-size/);
    for (const [scale, ceiling] of [['statement', '3.4rem'], ['feature', '2.6rem']]) {
      const rule = BLOCK.match(
        new RegExp(`\\.grid-cell \\.card-face [^{]*data-scale="${scale}"[^{]*\\{\\n([^}]*)\\n\\}`));
      expect(rule, `the grid's ${scale} step went missing`).not.toBeNull();
      expect(rule[1], `${scale} tracks the card's own width`).toMatch(/cqw/);
      // The ceiling is the public ladder's, so nothing is bigger than it is
      // today — only a card narrower than the 300px reference scales down.
      expect(rule[1], `${scale} must not raise the public ceiling`).toContain(ceiling);
    }
  });
});

// ---- the overlay layout's attributes, in BOTH stylesheets (chunk 3) ----
//
// The layout's whole division of labour is "JS sets attributes, CSS owns
// everything downstream" — which means an attribute value with no rule is not a
// missing style, it is a card the author can compose and the browser will not
// draw. The values are read out of the ENGINE's own arrays rather than listed
// here, so a fourth placement fails this test the day it is registered instead
// of the day someone notices a band in the wrong place.
//
// Checked in main.css AND field-console.css: the console mounts buildCard's own
// node, so a rule that exists only on the public side means the composer shows
// the author something the homepage will not produce — the one thing that
// surface exists not to do.
describe('the overlay layout is described wherever its card is drawn', () => {
  const ENGINE = readFileSync(join(ROOT, 'js', 'recent-index.js'), 'utf8');
  const arr = (name) => {
    const m = new RegExp(`var ${name} = \\[([^\\]]*)\\]`).exec(ENGINE);
    expect(m, `${name} moved or changed shape in js/recent-index.js`).not.toBeNull();
    return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  };
  const places = arr('OVERLAY_PLACES');
  const treats = arr('OVERLAY_TREATS');
  const blurs = arr('OVERLAY_BLURS');
  const scales = arr('OVERLAY_SCALES');

  it('finds the engine\'s vocabulary at all', () => {
    expect(places.length).toBeGreaterThan(2);
    expect(treats.length).toBeGreaterThan(2);
    expect(blurs.length).toBeGreaterThan(2);
  });

  it.each([['css/main.css', MAIN], ['css/field-console.css', CSS]])(
    '%s has a rule for every value the engine can stamp', (_name, sheet) => {
      for (const p of places) expect(sheet).toContain(`[data-place="${p}"]`);
      for (const t of treats) expect(sheet).toContain(`[data-treat="${t}"]`);
      for (const b of blurs) expect(sheet).toContain(`[data-blur="${b}"]`);
      // The plate (2026-09-11): a scale the engine stamps with no size behind
      // it is a headline that silently stays small, and a mark with no rule is
      // a full stop that never appears.
      expect(scales.length).toBeGreaterThan(3);
      for (const sc of scales) expect(sheet).toContain(`[data-scale="${sc}"]`);
      expect(sheet).toContain('[data-mark="dot"]');
      // The picture is the card: the well fills it, in both sheets, or the
      // bare-strip footer comes back on one side.
      //
      // ⚠️ AND ITS WIDTH IS PINNED. `flex-grow` and `aspect-ratio` on one box
      // disagree across engines once it grows — WebKit lets the ratio compute
      // the width from the new height, which on the live site pushed the well
      // ~70px past the card and clipped the chip against `overflow: hidden`
      // ("AR" instead of "ARCHIVE", owner 2026-09-12). An explicit width is
      // definite everywhere, and a box with two definite sides ignores the
      // ratio. Dropping it re-opens the bug on Safari while every test and
      // every Chromium screenshot stays green, so the pairing is asserted.
      expect(sheet).toMatch(/\[data-layout="overlay"\] \.wk-img \{\s*flex: 1 0 auto;\s*width: 100%;/);
      // Both ink polarities. 'light' is the default and rides the base rule, so
      // only the flip needs its own selector — but the token pair it flips must
      // exist in both sheets or the type inherits the page's colour onto a
      // photograph.
      expect(sheet).toContain('[data-ink="dark"]');
      expect(sheet).toMatch(/--ov-ink:/);
      expect(sheet).toMatch(/--ov-veil:/);
    },
  );

  it('names no colour of its own in main.css either', () => {
    // Same rule as the console block below: the band's polarity is one token
    // pair of black-and-white alphas (the .wk-tag precedent — over a photo,
    // contrast is a luminance decision, not a theme one). A hex would be a
    // colour that is right on one preset and wrong on the other four.
    const start = MAIN.indexOf('OVERLAY layout (data-layout="overlay")');
    expect(start, 'the overlay block moved or lost its banner').toBeGreaterThan(-1);
    const block = MAIN.slice(start, MAIN.indexOf('@media (max-width: 900px)', start))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const hexes = [...block.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
    expect(hexes, `hardcoded colours in the overlay block: ${hexes.join(', ')}`).toEqual([]);
  });

  it('falls back to the scrim where backdrop-filter is unavailable', () => {
    // Frosted is the one treatment that can silently do NOTHING — an engine
    // without backdrop-filter drops the declaration and leaves bare type on a
    // photograph. The degradation must be a different look, never an unreadable
    // card.
    for (const sheet of [MAIN, CSS]) {
      expect(sheet).toMatch(/@supports not \(\(backdrop-filter/);
    }
  });

  it('scopes each card\'s own stacking context, in both sheets', () => {
    // `backdrop-filter` resolves its BACKDROP ROOT at the nearest stacking
    // context. Without `isolation: isolate` on the card, the frosted band
    // reaches PAST the card and samples whatever is behind it — in the console
    // that is the studio's ground, and the whole picture well painted flat
    // black. main.css has carried this on .wk-card since the pulse card (for
    // the sibling reason: an inner z-index escaping to the root); the console's
    // copy of the card had never needed it until chunk 3, and nothing would
    // have reported its absence but opening the page.
    expect(MAIN).toMatch(/\.wk-card\s*\{[\s\S]*?isolation:\s*isolate/);
    expect(CSS).toMatch(/\.card-face \.wk-card\s*\{[\s\S]*?isolation:\s*isolate/);
  });
});
