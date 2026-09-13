// The console side of Pulse — written after two bugs shipped past a green suite.
//
// Both were the same shape: code that is fine in isolation and never actually
// reached at runtime. Nothing in 1353 passing tests noticed, because every one
// of them tested a function directly rather than asking "can the console load
// this, and does it have rules to draw it with?"
//
//   1. THE PACKS NEVER LOADED. js/pulse-packs.js shipped as a classic script
//      hanging window.MoodPacks, but dev/field-console.html carried no
//      <script src> tags at all — it is an ES-module surface with an import
//      map. So the composer rendered its "starter packs" heading above nothing.
//      (2026-08-23: the console now loads exactly ONE classic script on
//      purpose — the public homepage's js/recent-index.js, so the Cards view
//      previews with the real selection logic. The rule below names it rather
//      than counting to zero.)
//   2. THE CARD HAD NO STYLES. The card markup uses .wk-pulse/.wk-p-*, which
//      live in css/main.css, and the console loads only css/field-console.css.
//      It came out as two lines of unstyled text.
//
// So these check REACHABILITY, not behaviour.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKS, pulseFrom, allPulses, trayGlyphs, glyphGroups } from '../js/pulse-packs.js';
import { PULSE_LABEL } from '../src/shared/pulse.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const consoleHtml = read('dev/field-console.html');
const consoleCss = read('css/field-console.css');
const pulseModule = read('js/console/pulse.js');
const packsSrc = read('js/pulse-packs.js');

describe('the packs are reachable from the console', () => {
  it('js/pulse-packs.js is an ES MODULE, not a global-hanging classic script', () => {
    expect(packsSrc).toMatch(/^export /m);
    // Nothing loads this file as a classic script, so a global it hung would
    // never be defined — the original bug, exactly.
    expect(packsSrc).not.toMatch(/globalThis\.(Mood|Pulse)Packs|window\.(Mood|Pulse)Packs/);
  });

  it('loads same-origin classic scripts ONLY to run real public-page code', () => {
    // This read "no <script src> tags at all" until the Cards view landed, and
    // the rule it protected is unchanged: a console MODULE is reachable only
    // through the import map, so anything that hangs a global is a dead file.
    // The exceptions are deliberate and named here, and they are all the same
    // exception — a PUBLIC page's own classic script, loaded so the console
    // runs the real code instead of a second copy of it that drifts:
    //
    //   js/recent-index.js  the homepage grid, for the Cards view's preview
    //   js/audio-player.js  the shared audio module, for the SETS shelf's
    //                       AudioPlayer.resolveSetTracks (cards chunk 4)
    //
    // A new entry here that is NOT that — anything hanging a global purely for
    // the console's own benefit — is the old bug coming back, and whoever adds
    // one has to say so here on purpose.
    const sameOrigin = [...consoleHtml.matchAll(/<script\b[^>]*\ssrc=["'](\/[^"']+)["']/gi)]
      .map((m) => m[1].split('?')[0]);
    expect(sameOrigin).toEqual(['/js/recent-index.js', '/js/audio-player.js']);
    // Both must be files the public site actually serves to visitors, which is
    // the whole justification for loading them here.
    for (const src of sameOrigin) {
      expect(read('index.html') + read('listen/index.html')).toContain(src);
    }
  });

  it('every js/ file the pulse module imports is listed in the import map', () => {
    const imports = [...pulseModule.matchAll(/^import\s[\s\S]*?from\s+['"]([^'"]+)['"];?$/gm)]
      .map((m) => m[1])
      .filter((s) => s.startsWith('.'));
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      // '../pulse-packs.js' → '/js/pulse-packs.js'; './chrome.js' → '/js/console/chrome.js'
      const path = spec.startsWith('../')
        ? `/js/${spec.slice(3)}`
        : `/js/console/${spec.replace('./', '')}`;
      expect(
        consoleHtml,
        `${spec} is imported by js/console/pulse.js but has no import-map entry — `
        + 'it will load unversioned and never cache-bust.',
      ).toContain(`"${path}"`);
    }
  });

  it('the pulse module is registered in the barrel and the service worker', () => {
    expect(read('js/console-ui.js')).toContain('./console/pulse.js');
    const sw = read('dev/sw.js');
    expect(sw).toMatch(/\/js\/console\/pulse\.js\?v=\d+/);
    expect(sw).toMatch(/\/js\/pulse-packs\.js\?v=\d+/);
  });

  it('nothing still points at the pre-rename paths', () => {
    // The rename moved five files at once. A leftover /js/console/mood.js in the
    // import map or the service worker is a 404 on a surface that caches
    // aggressively — it would fail quietly and only for people who already had
    // the console installed.
    for (const [label, src] of [['import map / shell', consoleHtml], ['service worker', read('dev/sw.js')]]) {
      expect(src, `${label} still references a mood-era path`).not.toMatch(/js\/(console\/)?mood/);
    }
  });

  it('Pulse has a topbar chip, not just a More-sheet entry', () => {
    // The one-handed path. Pulse is a secondary surface like the Wall, but it is
    // the only one you reach for standing up and in a hurry — two taps through
    // a sheet is fine for "edit the wall", not for "post what I am doing now".
    // The chip lives in the same cluster as the lamp and the settings pair and
    // uses the same class, so it matches them by construction rather than by
    // someone remembering to.
    expect(consoleHtml).toMatch(/class="settings-btn"[^>]*id="pulse-topbar-btn"/);
    expect(consoleHtml).toMatch(/id="pulse-topbar-btn"[^>]*onclick="showView\('pulse'\)"/);
  });

  it('the topbar chip and the More-sheet entry wear the SAME glyph', () => {
    // Finger memory only works if the two places Pulse appears look like one
    // thing. If someone changes one glyph, this fails rather than quietly
    // leaving a smiley up top and something else in the sheet.
    const chip = consoleHtml.match(/id="pulse-topbar-btn"[^>]*>([^<]+)</);
    const sheet = consoleHtml.match(/<span class="sheet-icon">([^<]+)<\/span>\s*Pulse/);
    expect(chip, 'the Pulse topbar chip is missing').toBeTruthy();
    expect(sheet, 'the Pulse More-sheet entry is missing').toBeTruthy();
    expect(chip[1].trim()).toBe(sheet[1].trim());
  });

  it('the composer view exists in the console markup and is in the nav', () => {
    expect(consoleHtml).toContain('id="view-pulse"');
    expect(consoleHtml).toContain('id="pulse-body"');
    expect(consoleHtml).toContain('data-view="pulse"');
    expect(read('js/console/chrome.js')).toMatch(/MORE_VIEWS\s*=\s*\[[^\]]*"pulse"/);
  });
});

describe('the card can actually be drawn', () => {
  // The console does not load css/main.css, so every class the card emits needs
  // a rule in the console's own stylesheet.
  it.each(['.wk-pulse', '.wk-p-kicker', '.wk-p-led', '.wk-p-center', '.wk-p-glyph', '.wk-p-text', '.wk-p-foot'])(
    '%s is styled in css/field-console.css',
    (cls) => {
      expect(
        consoleCss,
        `${cls} is emitted by the composer but has no rule in the console stylesheet — `
        + 'it will render unstyled, which is exactly what shipped.',
      ).toContain(cls);
    },
  );

  it('the card carries all six palettes, like the public card', () => {
    for (const s of ['ember', 'dawn', 'flow', 'velvet', 'tide']) {
      expect(consoleCss).toContain(`[data-state="${s}"]`);
    }
  });

  it('the card styles every tier the tier function can return', () => {
    for (const t of ['statement', 'feature', 'standard', 'glyph']) {
      expect(consoleCss).toContain(`[data-tier="${t}"]`);
    }
  });

  it('the tier function does not depend on a global the console never defines', () => {
    // The first cut called globalThis.RecentIndex, which is a classic script
    // loaded only on public pages — so every card silently read `statement`.
    // Comments are stripped first: this module explains that bug in prose, and
    // a guard that cannot tell an explanation from the mistake is not a guard.
    const code = pulseModule.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/globalThis\.RecentIndex/);
  });
});

describe('the SMD indicator', () => {
  const mainCss = read('css/main.css');

  it.each([['css/main.css', mainCss], ['css/field-console.css', consoleCss]])(
    '%s draws the LED from tokens, never a hardcoded colour',
    (_label, css) => {
      // The snippet this came from hardcoded #fff and rgba(0,0,0,0.9). Both are
      // wrong in Daylight — a blown highlight and a hard black ring on paper —
      // so the housing is a token that flips with the theme, like the veil.
      expect(css.includes('--led-bezel'), 'the LED housing is not a token').toBe(true);
      expect(css.includes('--led-spec'), 'the LED specular is not a token').toBe(true);
    },
  );

  it('the card LED and the SYS lamp both keep the inset specular at the trough', () => {
    // The snippet set `box-shadow: none` at rest, which drops the inset
    // highlight along with the glow and flattens the part to a painted square
    // between beats. Only the outer glow should go.
    for (const [label, css, frames] of [
      ['card', mainCss, /@keyframes wk-p-led \{[\s\S]*?\n\}/],
      ['sys lamp', consoleCss, /@keyframes lamp-smd \{[\s\S]*?\n\}/],
    ]) {
      const block = css.match(frames);
      expect(block, `the ${label} LED has no SMD keyframes`).toBeTruthy();
      expect(block[0], `the ${label} LED drops its inset specular at rest`).not.toMatch(/box-shadow:\s*none/);
      expect(block[0]).toContain('inset 0 0 2px');
    }
  });

  it('both LEDs have a reduced-motion escape', () => {
    // A permanently blinking indicator is exactly what prefers-reduced-motion
    // exists for, and this one sits on a homepage.
    expect(mainCss).toMatch(/prefers-reduced-motion[\s\S]{0,400}\.wk-p-led\s*\{[^}]*animation:\s*none/);
    expect(consoleCss).toMatch(/prefers-reduced-motion[\s\S]{0,600}\.sys-lamp-led[^}]*animation:\s*none/);
  });

  it('the SYS lamp keeps a distinct animation per state', () => {
    // Only `idle` took the SMD stutter. `busy` is HDD chatter and `error` is a
    // double-blink; both carry meaning that one uniform blink would erase.
    for (const [state, anim] of [['idle', 'lamp-smd'], ['busy', 'lamp-flicker'], ['error', 'lamp-error'], ['offline', 'lamp-offline']]) {
      const rule = consoleCss.match(new RegExp(`#sys-lamp\\[data-state="${state}"\\] \\.sys-lamp-led \\{[^}]*\\}`));
      expect(rule, `the SYS lamp has no ${state} rule`).toBeTruthy();
      expect(rule[0], `${state} lost its own animation`).toContain(anim);
    }
  });
});

describe('the studio is bounded, not a scrolling form', () => {
  // The redesign's whole claim. The old view was three screens tall on a phone
  // and over 100vh on desktop, and it compensated with a sticky preview and a
  // sticky action bar that covered the inputs underneath it.
  it('the view is a bounded flex column, not a scrolling document', () => {
    expect(consoleHtml).toContain('class="view view--bounded"');
    // The SHELL's rule — the unindented one. Media queries override pieces of
    // it (the tab-bar band widens the bottom gutter), and those blocks are
    // indented, so anchoring to column 0 keeps this reading the base rule
    // rather than whichever override happens to come first in the file.
    const rule = consoleCss.match(/^\.view--bounded\.active \{[^}]*\}/m);
    expect(rule, '.view--bounded.active has no rule').toBeTruthy();
    expect(rule[0]).toMatch(/height:\s*100%/);
    expect(rule[0]).toMatch(/overflow:\s*hidden/);
  });

  it('the rails own the overflow, so the page never scrolls', () => {
    const rule = consoleCss.match(/\.pulse-rail-body \{[^}]*\}/);
    expect(rule, '.pulse-rail-body has no rule').toBeTruthy();
    expect(rule[0]).toMatch(/overflow-y:\s*auto/);
  });

  it('nothing in the studio is sticky or floating over the content', () => {
    // The specific defect: `.pulse-actions { position: sticky; bottom: … }` with
    // 190px of view padding underneath to claw back the space it covered. A
    // bounded column does not need the trick, and the dock is in flow.
    //
    // This forbids `sticky`, not `fixed`, and that is the distinction and not an
    // oversight: the recent-pulses bottom sheet is `position: fixed` and is
    // legitimate. A sheet the author OPENS, and closes, is a different thing
    // from a bar that permanently sits over the controls underneath it.
    const block = consoleCss.slice(consoleCss.indexOf('PULSE STUDIO (view-pulse)'));
    expect(block, 'something in the pulse studio went back to position: sticky').not.toMatch(/\.pulse-[\w-]*\s*\{[^}]*position:\s*sticky/);
    expect(block).not.toMatch(/padding-bottom:\s*190px/);
  });

  it('the hidden footer is actually hidden', () => {
    // The composer sets `foot.hidden = true` when both cells are empty, matching
    // the public card, which drops the row entirely. But the card's own
    // `display: flex` (0,2,0) outranks the user-agent's `[hidden]` (0,1,0), so
    // the attribute alone does nothing and the empty row renders on every card.
    // Caught by hand, not by a test — hence this one.
    expect(pulseModule).toMatch(/foot\.hidden = /);
    expect(
      consoleCss,
      'the composer hides the empty footer with [hidden], but no rule makes that stick',
    ).toMatch(/\.wk-p-foot\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it('the line is a real labelled field, not an unlabelled box in a card', () => {
    // You type INTO the card now, which is the point — but a textarea whose only
    // visible context is a decorative kicker still needs a programmatic label.
    expect(pulseModule).toMatch(/<label class="pulse-sr" for="pulse-line">/);
    expect(pulseModule).toMatch(/id="pulse-line"/);
    expect(consoleCss).toContain('.pulse-sr');
  });
});

describe('the composer only touches DOM that exists', () => {
  // The surgical-update handlers reach for elements by id instead of rebuilding
  // the view. That is the right trade — it keeps focus, scroll and the keyboard,
  // and here it is load-bearing rather than an optimisation, because the line
  // you are typing lives INSIDE the card that would be rebuilt. But it fails
  // SILENTLY when an id is renamed in the markup and not in the handler: the
  // control just stops working and nothing errors. Same failure family as the
  // two bugs that shipped, so it gets the same guard.
  const ids = [...pulseModule.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]);

  it('finds the handlers reaching for ids (scanner sanity)', () => {
    expect(new Set(ids).size).toBeGreaterThan(5);
  });

  it.each([...new Set(ids)])('#%s is rendered by the module or the console shell', (id) => {
    const rendered = pulseModule.includes(`id="${id}"`) || consoleHtml.includes(`id="${id}"`);
    expect(
      rendered,
      `js/console/pulse.js reaches for #${id} but nothing renders that id — `
      + 'the control it belongs to will silently do nothing.',
    ).toBe(true);
  });

  it('rebuilds the whole view only when the view is opened', () => {
    // Every other path updates in place. A stray renderPulse() in a chip handler
    // would destroy the textarea the author is typing into — focus, caret and
    // the soft keyboard, mid-sentence.
    // Strip comments (this module explains the old behaviour in prose) and match
    // only call sites — the declaration ends in `{`, a call ends in `;`.
    const code = pulseModule.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const calls = [...code.matchAll(/(?<![\w.])renderPulse\(\);/g)];
    expect(calls).toHaveLength(1);
    expect(pulseModule).toMatch(/render\(\)\s*\{\s*renderPulse\(\);/);
  });

  it('the card repaint never writes the line back into the textarea', () => {
    // paintCard() runs on every keystroke. If it ever set #pulse-line's value,
    // it would fight the author's own typing — caret jumps to the end, IME
    // composition breaks. The value is written only by syncFields(), which runs
    // when something OTHER than typing changed it.
    const paint = pulseModule.match(/function paintCard\(\) \{[\s\S]*?\n\}/);
    expect(paint, 'paintCard() is gone — check this guard still means something').toBeTruthy();
    expect(paint[0]).not.toContain('pulse-line');
    expect(paint[0]).not.toContain('syncFields');
  });
});

describe('the starter pack itself', () => {
  it('ships all six disciplines with six pulses each — 36, live, to every fork', () => {
    expect(PACKS).toHaveLength(6);
    expect(PACKS.map((p) => p.key)).toEqual(
      ['photography', 'writing', 'music', 'filmmaking', 'tech', 'podcasting'],
    );
    for (const p of PACKS) expect(p.pulses, p.key).toHaveLength(6);
    expect(allPulses()).toHaveLength(36);
  });

  it('every pulse carries a glyph and a line', () => {
    for (const m of allPulses()) {
      expect(m.glyphs.trim(), m.text).not.toBe('');
      expect(m.text.trim()).not.toBe('');
    }
  });

  it('a lane seeds a LINE, never a title — the card names itself', () => {
    // This is the inverse of the assertion that used to live here, which read
    // `expect(m.kicker).toBe('MUSIC')`. That behaviour is the defect: tapping a
    // starter stamped the discipline onto the card, so the same feature
    // introduced itself as PHOTOGRAPHY on one post and TECH / DEV on the next.
    for (const m of allPulses()) {
      expect(Object.keys(m), 'a starter is seeding a card title again').not.toContain('kicker');
    }
    const m = pulseFrom('music', 0);
    expect(m.text).toBe('Eight bar loop. Send help.');
    // No gear slot, no take number, no seeded metadata — free text or nothing.
    expect(m.footLeft).toBe('');
    expect(m.footRight).toBe('');
  });

  it('the composer prints the same constant the public card does', () => {
    // js/console/pulse.js cannot import from src/ either, so it holds its own
    // literal. Three copies of one word is two too many to trust to memory.
    const m = pulseModule.match(/const PULSE_LABEL = '([^']+)';/);
    expect(m, 'js/console/pulse.js no longer declares PULSE_LABEL').toBeTruthy();
    expect(m[1]).toBe(PULSE_LABEL);
    expect(pulseModule, 'the composer stopped rendering the constant').toContain('</span>${PULSE_LABEL}<');
  });

  it('there is no label input left to type a category into', () => {
    expect(pulseModule).not.toContain('id="pulse-kicker"');
    expect(pulseModule).not.toMatch(/_pulseSetField\('kicker'/);
  });

  it('every pack palette is one the server will accept', () => {
    const valid = ['ember', 'dawn', 'flow', 'velvet', 'tide', 'signal'];
    for (const m of allPulses()) expect(valid).toContain(m.state);
  });

  it('an unknown pack or index returns null rather than throwing', () => {
    expect(pulseFrom('astrology', 0)).toBeNull();
    expect(pulseFrom('music', 99)).toBeNull();
  });
});

describe('the glyph menu', () => {
  // Six came free by mapping the lane's starter lines. It was tidy and it was
  // not enough to write with (owner, 2026-08-13), so each lane carries its own
  // list of twelve.
  it.each(PACKS.map((p) => [p.key]))('%s offers twelve', (key) => {
    expect(trayGlyphs(key)).toHaveLength(12);
  });

  it('every section leads with its own starter glyphs, in order', () => {
    // This is what makes the HEADING mean something. Without it the extra six
    // could drift into a generic set and "Photography" would stop describing
    // the twelve underneath it.
    for (const p of PACKS) {
      expect(trayGlyphs(p.key).slice(0, 6), p.key).toEqual(p.pulses.map((m) => m.glyphs));
    }
  });

  it('no lane repeats a glyph — a duplicate wastes one of twelve slots', () => {
    for (const p of PACKS) {
      const tray = trayGlyphs(p.key);
      expect(new Set(tray).size, `${p.key} repeats a glyph`).toBe(tray.length);
      expect(tray.every((g) => g && g.trim()), `${p.key} has a blank slot`).toBe(true);
    }
  });

  it('an unknown lane returns [] rather than throwing', () => {
    // The tray is a shortcut. Losing it should cost a shortcut, not the composer.
    expect(trayGlyphs('astrology')).toEqual([]);
  });

  // ---- universal, not per-lane (owner, 2026-08-24) ----
  //
  // The inverse of the assertion that used to live here, which pinned
  // `trayGlyphs(activePack)` — i.e. pinned the behaviour being fixed. Choosing a
  // lane silently narrowed the vocabulary to twelve, so a photographer writing
  // about a late edit had to leave the lane seeding their line to reach ☕.
  it('glyphGroups() offers every discipline, in PACKS order, with its label', () => {
    const groups = glyphGroups();
    expect(groups.map((g) => g.key)).toEqual(PACKS.map((p) => p.key));
    expect(groups.map((g) => g.label)).toEqual(PACKS.map((p) => p.label));
    for (const g of groups) expect(g.glyphs, g.key).toEqual(trayGlyphs(g.key));
    expect(groups.reduce((n, g) => n + g.glyphs.length, 0)).toBe(72);
  });

  it('the menu renders every group, and no longer filters by the open lane', () => {
    const code = pulseModule.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain('glyphGroups()');
    expect(code, 'the menu went back to showing one lane at a time').not.toContain('trayGlyphs(activePack)');
    expect(code, 'the menu is back to mapping the starter lines').not.toMatch(/pulses\.map\(\(m\) => m\.glyphs\)/);
  });

  it('each group is a labelled section the composer can mark by lane', () => {
    expect(pulseModule).toContain('class="pulse-glyph-head"');
    expect(pulseModule).toMatch(/data-lane="\$\{escapeHTML\(g\.key\)\}"/);
    for (const cls of ['.pulse-glyph-group', '.pulse-glyph-head', '.pulse-glyph-grid']) {
      expect(consoleCss, `${cls} is emitted by the menu but has no rule`).toContain(cls);
    }
    // The open lane is MARKED, not filtered — so the menu's order can stay put.
    expect(consoleCss).toMatch(/\.pulse-glyph-group\.is-lane/);
    expect(pulseModule).toMatch(/function syncTrayLane\(/);
  });

  it('a lane tap moves a class instead of rebuilding the panel', () => {
    // Rebuilding it would throw away the author's scroll position in a
    // six-section menu, and could do it while their thumb was mid-flick.
    const fn = pulseModule.match(/export function _pulseSetPack\(key\) \{[\s\S]*?\n\}/);
    expect(fn, '_pulseSetPack is gone').toBeTruthy();
    expect(fn[0], 'the lane rebuilds the glyph menu again').not.toMatch(/tray\.innerHTML/);
    expect(fn[0]).toContain('syncTrayLane()');
  });

  it('the panel is actually the width it claims', () => {
    // The shipped rule was `left: 50%; transform: translateX(-50%)` with no
    // `width` and no `right`, so the containing block ran from the stage's
    // midpoint to its right edge and the panel shrink-to-fit into half a stage
    // — three glyphs wide on a phone with room for six.
    const rule = consoleCss.match(/^\.pulse-tray \{[^}]*\}/m);
    expect(rule, '.pulse-tray has no base rule').toBeTruthy();
    expect(rule[0], 'a centred absolute panel with no width shrink-to-fits').toMatch(/\n\s*width:/);
    expect(rule[0], 'the panel needs a cap, or a six-section menu runs off the stage')
      .toMatch(/max-height:/);
  });

  it('the panel scrolls inside itself, and contains that scroll', () => {
    const rule = consoleCss.match(/\.pulse-tray-body \{[^}]*\}/);
    expect(rule, '.pulse-tray-body has no rule').toBeTruthy();
    expect(rule[0]).toMatch(/overflow-y:\s*auto/);
    expect(rule[0], 'a flick through the glyphs can chain into the view behind the panel')
      .toMatch(/overscroll-behavior-y:\s*contain/);
  });

  it('the scroll cue is drawn IN FRONT, and only at an edge with more behind it', () => {
    // The CSS-only `background-attachment: local` version was written first and
    // does not work here: background layers paint behind an element's content,
    // and every tile carries an opaque --surface-2, so the shadow strip was
    // covered by whatever row sat at the edge. Verified in Chromium.
    for (const sel of ['.pulse-tray-scroll::before', '.pulse-tray-scroll::after']) {
      expect(consoleCss, `${sel} is gone — the menu stopped saying it continues`).toContain(sel);
    }
    expect(consoleCss).toMatch(/\.pulse-tray-scroll\[data-up\]::before \{[^}]*opacity:\s*1/);
    expect(consoleCss).toMatch(/\.pulse-tray-scroll\[data-down\]::after \{[^}]*opacity:\s*1/);
    // A cue you can tap is a cue that eats a glyph.
    const edge = consoleCss.match(/\.pulse-tray-scroll::before,\s*\.pulse-tray-scroll::after \{[^}]*\}/);
    expect(edge, 'the shared edge rule is gone').toBeTruthy();
    expect(edge[0]).toMatch(/pointer-events:\s*none/);
    // Both halves or neither: the attributes have to be set by something.
    expect(pulseModule).toMatch(/export function _pulseTrayCue\(/);
    expect(pulseModule).toContain('onscroll="_pulseTrayCue()"');
  });

  it('the glyph tiles are bigger than the 46px they replaced, and stay tappable', () => {
    // The owner's note against the original mockup: "the glyphs were larger and
    // centered." A tile that shrinks under the tap floor on a narrow phone is
    // the other way to fail this.
    const rule = consoleCss.match(/^\.pulse-glyph \{[^}]*\}/m);
    expect(rule, '.pulse-glyph has no rule').toBeTruthy();
    expect(rule[0]).toMatch(/min-height:\s*44px/);
    const size = rule[0].match(/font-size:\s*([\d.]+)rem/);
    expect(size, '.pulse-glyph has no font-size').toBeTruthy();
    expect(Number(size[1])).toBeGreaterThan(1.4);
  });

  it('the whole emoji set arrives as a keyboard doorway, not a bundled table', () => {
    // The answer to "is there a cost to making all the emoji available?" —
    // ~1,900 emoji of payload, as many colour-font nodes to paint on open, tofu
    // on older platform fonts, and a list that goes stale every Unicode
    // release. The device already solves all four, with search. This guard
    // fails if someone ships the table instead.
    expect(pulseModule).toContain('id="pulse-glyph-any"');
    expect(pulseModule).toMatch(/export function _pulseSetGlyphAny\(/);
    const fn = pulseModule.match(/export function _pulseSetGlyphAny\([\s\S]*?\n\}/);
    expect(fn[0], 'the doorway keeps what you typed — two elements claiming to be the glyph')
      .toMatch(/box\.value = ''/);
    expect(fn[0], 'the doorway shuts the panel out from under the keyboard it just opened')
      .not.toContain('closeTray()');
    // It rides .pulse-input, which carries the 16px floor that stops iOS
    // zooming the page on focus.
    expect(pulseModule).toMatch(/class="pulse-input pulse-tray-any"/);
  });

  it('the menu closes on Escape and on a tap outside', () => {
    expect(pulseModule).toMatch(/export function _pulseCloseTray\(/);
    expect(pulseModule).toContain('id="pulse-tray-scrim"');
    // Shown by the panel's own state, so the two cannot drift apart.
    expect(consoleCss).toMatch(/\.pulse-tray\.open \+ \.pulse-tray-scrim \{[^}]*display:\s*block/);
    expect(read('js/console/init.js'), 'the glyph menu is not in the Escape ladder')
      .toContain('pulse-tray")?.classList.contains("open")');
  });

  it('the menu clear says NO GLYPH, so only one control on screen says "clear"', () => {
    // The dock's RESET CARD sits a thumb away. Two buttons both saying CLEAR
    // while meaning "drop one emoji" and "empty the whole card" is how a
    // mis-tap becomes a lost draft.
    expect(pulseModule).toContain('>NO GLYPH<');
    expect(pulseModule, 'a second CLEAR came back to this surface').not.toMatch(/>CLEAR</);
  });

  it('every glyph on the card can be taken back off, one at a time', () => {
    // Second pass, 2026-08-24: "you can't remove an individual glyph or
    // character without pressing reset card" — and RESET CARD also throws away
    // the line. So the panel carries a removable chip per glyph, which is the
    // ONLY way back for an emoji picked from the platform keyboard (it has no
    // curated tile to un-toggle).
    expect(pulseModule).toContain('id="pulse-tray-picked"');
    expect(pulseModule).toMatch(/export function _pulseRemoveGlyph\(/);
    expect(pulseModule).toMatch(/onclick="_pulseRemoveGlyph\(\$\{i\}\)"/);
    for (const cls of ['.pulse-tray-picked', '.pulse-picked']) {
      expect(consoleCss, `${cls} is emitted but has no rule`).toContain(cls);
    }
    // Removing a glyph works on the LIST, so it cannot corrupt a multi-glyph
    // string the way a substring replace would.
    expect(pulseModule).toMatch(/function glyphList\(/);
  });

  it('a curated tile is a toggle, and shows whether it is on', () => {
    // The tile no longer fires once and closes the menu — it toggles, so the
    // owner can try glyphs "without losing context". A toggle has to look
    // toggled, so the tile carries data-glyph + aria-pressed and an is-on class.
    expect(pulseModule).toMatch(/data-glyph="\$\{escapeHTML\(ch\)\}"/);
    expect(pulseModule).toMatch(/aria-pressed=/);
    expect(consoleCss).toMatch(/\.pulse-glyph\.is-on/);
    // and it must NOT close the panel — that was the reopen-per-try cost.
    const fn = pulseModule.match(/export function _pulseSetGlyph\(glyph\)[\s\S]*?\n\}/);
    expect(fn, '_pulseSetGlyph is gone').toBeTruthy();
    expect(fn[0], 'a curated tap still closes the menu').not.toContain('closeTray()');
  });

  it('the menu yields to the PLATFORM emoji keyboard instead of stacking under it', () => {
    // The reported stack: emoji keyboard over the menu, menu over the card. The
    // curated grid has nowhere to be while the OS picker is up and is not what
    // is being used, so it collapses to a bar (title + chips + field) and drops
    // into flow so the card stays visible above it.
    //
    // :has(#pulse-glyph-any:focus), not :focus-within — a curated tile taking
    // focus is not this state — and gated on body.kb-open so a desktop click
    // into the field keeps the whole menu.
    const rule = consoleCss.match(/body\.kb-open #view-pulse[^\n]*:has\(#pulse-glyph-any:focus\)[\s\S]{0,400}?\{[^}]*\}/);
    expect(rule, 'nothing collapses the menu under the platform emoji keyboard').toBeTruthy();
    // The grid and NO GLYPH fold.
    expect(consoleCss).toMatch(/:has\(#pulse-glyph-any:focus\) \.pulse-tray-scroll,[\s\S]{0,200}?display:\s*none/);
    // The dock and status fold, and the header meta with them — that stack was
    // 46% of the surface once the keys landed.
    expect(consoleCss).toMatch(/#view-pulse:has\(#pulse-glyph-any:focus\) \.pulse-dock[\s\S]{0,40}?display:\s*none/);
    expect(consoleCss).toMatch(/body\.kb-open #view-pulse \.view-header--tight \.view-meta[\s\S]{0,40}?display:\s*none/);
  });
});

describe('the card survives the keyboard', () => {
  // The 2026-08-24 report: on a phone you could not see the line you were
  // typing. Nothing was covering it — --kb-inset lifted the whole studio above
  // the keys correctly. The CARD collapsed: every row on this stage is
  // `flex: 0 0 auto` except .pulse-card-slot, so the one elastic child paid the
  // whole ~350px in a single step and came out ~90px tall, and the textarea
  // inside it (`min-height: 0`, in a card that clips its overflow) was crushed
  // out of existence while the empty card's 4rem glyph placeholder held its
  // size.
  //
  // These are the guards that were missing. The existing viewport suite checks
  // that --kb-inset is COUNTED; nothing checked what happens to the card once
  // it is.
  const WRITE_MODE = /body\.kb-open #view-pulse/g;

  it('the field the author types into has a floor, not min-height: 0', () => {
    const rule = consoleCss.match(/\.pulse-card-slot \.wk-p-text \{[^}]*\}/);
    expect(rule, '.wk-p-text has no rule in the console stylesheet').toBeTruthy();
    expect(
      rule[0],
      'min-height: 0 is back — the textarea can be flexed to nothing and clipped away',
    ).not.toMatch(/min-height:\s*0\s*;/);
    expect(rule[0]).toMatch(/min-height:\s*[\d.]+em/);
  });

  it('write mode exists and folds the rows that are not typing', () => {
    expect([...consoleCss.matchAll(WRITE_MODE)].length, 'no body.kb-open rules on the pulse stage')
      .toBeGreaterThan(0);
    const folded = consoleCss.match(/body\.kb-open #view-pulse[\s\S]*?\{[^}]*display:\s*none[^}]*\}/);
    expect(folded, 'write mode folds nothing').toBeTruthy();
    for (const cls of ['.pulse-lanes', '.pulse-strip', '.pulse-palette', '.pulse-log-btn']) {
      expect(folded[0], `${cls} still holds its row while the keyboard is up`).toContain(cls);
    }
  });

  it('the POST button is never one of the folded rows', () => {
    // The whole point of getting the keys up is to finish a line and send it.
    const folded = consoleCss.match(/body\.kb-open #view-pulse[\s\S]*?\{[^}]*display:\s*none[^}]*\}/)[0];
    expect(folded, 'write mode hides the dock — you can type but not post').not.toMatch(/\.pulse-dock\b/);
  });

  it('an OPEN footer fold is exempt, so a focused field is never collapsed', () => {
    // Collapsing a fold with focus inside it blurs the field and drops the
    // keyboard — the reported bug wearing the fix's clothes.
    const folded = consoleCss.match(/body\.kb-open #view-pulse[\s\S]*?\{[^}]*display:\s*none[^}]*\}/)[0];
    expect(folded).toMatch(/\.pulse-more:not\(\[open\]\)/);
  });

  it('the glyph yields to a fixed size instead of riding the tier ladder', () => {
    // An empty card is tier `glyph`, whose 4rem hero is exactly what was eating
    // the room the field needed.
    const rule = consoleCss.match(/body\.kb-open #view-pulse[^{]*\.wk-p-glyph \{[^}]*\}/);
    expect(rule, 'nothing caps the glyph while the keyboard is up').toBeTruthy();
    const size = Number(rule[0].match(/font-size:\s*([\d.]+)rem/)[1]);
    expect(size, 'the capped glyph is no smaller than the 4rem hero it caps').toBeLessThan(4);
  });

  it('the card has a floor, and the field is capped so it cannot eat the card', () => {
    // Both came out of measuring eight device sizes in Chromium rather than
    // reading the CSS. Without the floor a 320x568 phone still clipped the
    // field (that device leaves the whole studio ~151px once the keys land);
    // without the cap an uncapped `flex: 1 1 auto` field grew to 450px inside a
    // tablet's 4:5 card, and the half below the keyboard line is a field you
    // cannot see — worse than the crushed one, not better.
    const card = consoleCss.match(/body\.kb-open #view-pulse[^{]*\.wk-pulse \{[^}]*\}/);
    expect(card, 'write mode no longer touches the card box').toBeTruthy();
    expect(card[0], 'the card lost its floor').toMatch(/min-height:\s*\d+px/);
    const field = consoleCss.match(/body\.kb-open #view-pulse[^{]*\.wk-p-text \{[^}]*\}/);
    expect(field, 'write mode no longer touches the field').toBeTruthy();
    expect(field[0], 'the field can grow without limit again').toMatch(/max-height:/);
  });

  it('a surface too short for the floor scrolls instead of clipping the dock', () => {
    // The release valve. It is gated on a height, not on body.kb-open alone:
    // `height: auto` un-anchors every `height: 100%` inside the view, and
    // applied unconditionally it cost an iPad in PORTRAIT the `max-height` that
    // keeps its card at a true 4:5 — on a surface that needed no valve at all.
    const at = consoleCss.search(/body\.kb-open #view-pulse\.view--bounded\.active/);
    expect(at, 'the release valve is gone').toBeGreaterThan(-1);
    const opener = consoleCss.lastIndexOf('@media', at);
    expect(consoleCss.slice(opener, at), 'the valve is no longer gated on a short viewport')
      .toMatch(/max-height:\s*\d+px/);
    const rule = consoleCss.slice(at).match(/^[^{]*\{[^}]*\}/)[0];
    expect(rule).toMatch(/height:\s*auto/);
    expect(rule).toMatch(/min-height:\s*100%/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
    // overflow-y ONLY: the shell shorthand's overflow-x: hidden has to survive,
    // or the lane reel scrolls the page sideways.
    expect(rule, 'an overflow shorthand here lets the lane reel scroll the page')
      .not.toMatch(/overflow:\s/);
  });

  it('write mode lives in THE BAND, not only in the 900px block', () => {
    // Same regression shape as tests/console-viewport.test.js was written for:
    // an iPad Mini in landscape is 1133px and coarse, sails past 900px, and is
    // the shortest surface of all once the keys are up.
    const at = consoleCss.search(/body\.kb-open #view-pulse/);
    const opener = consoleCss.lastIndexOf('@media', at);
    expect(consoleCss.slice(opener, at)).toContain('(pointer: coarse)');
  });
});

describe('the starter strip truncates instead of clipping', () => {
  // `text-overflow: ellipsis` applies to a BLOCK CONTAINER's inline content. A
  // flex container's children are flex items, so the property on the .pulse-chip
  // button did nothing and `overflow: hidden` cut mid-word — "Tones are sing".
  // The rule has to be on the span, which is what this asserts: a guard that
  // accepted it on the button would pass on the exact bug.
  it('the chip renders a text span that can be truncated', () => {
    expect(pulseModule).toContain('class="pulse-chip-text"');
  });

  it('.pulse-chip-text truncates, and can shrink enough to need to', () => {
    const rule = consoleCss.match(/\.pulse-chip-text \{[^}]*\}/);
    expect(rule, '.pulse-chip-text has no rule').toBeTruthy();
    expect(rule[0]).toMatch(/text-overflow:\s*ellipsis/);
    // Without min-width:0 a flex item never shrinks below its content, so it
    // never overflows and the ellipsis never appears.
    expect(rule[0], 'min-width: 0 is missing, so the ellipsis can never trigger').toMatch(/min-width:\s*0/);
  });

  it.each([
    ['.pulse-lanes', /\.pulse-lanes \{[^}]*\}/g],
    ['.pulse-strip', /\.pulse-strip \{[^}]*\}/g],
  ])('%s contains its overscroll', (label, re) => {
    // A sideways swipe must not chain into the page or trip the browser's back
    // gesture. The console sets this posture for its shells; these two are newer.
    //
    // Both selectors carry more than one rule (a desktop `display: none` and the
    // real one inside the 900px block), so this looks for the rule that actually
    // scrolls rather than whichever comes first.
    const rules = [...consoleCss.matchAll(re)].map((m) => m[0]);
    expect(rules.length, `${label} has no rule`).toBeGreaterThan(0);
    const scroller = rules.find((r) => /overflow-x:\s*auto/.test(r));
    expect(scroller, `${label} no longer scrolls horizontally — recheck this guard`).toBeTruthy();
    expect(scroller, `${label} can chain its scroll into the page`).toMatch(/overscroll-behavior-x:\s*contain/);
  });
});

describe('the dock says what it does', () => {
  it('the two destructive-sounding buttons name their blast radius', () => {
    // Reported as "the clear button does not seem wired up… does not affect the
    // live site". It never was meant to — but nothing said so. One touches the
    // site, one touches the draft, and now the words carry that.
    expect(pulseModule).toContain('>TAKE DOWN<');
    expect(pulseModule).toContain('>RESET CARD<');
    expect(pulseModule, 'RETIRE/CLEAR came back — they do not say what they touch').not.toMatch(/>RETIRE<|>CLEAR</);
  });

  it('RESET CARD reports what it did', () => {
    const fn = pulseModule.match(/export function _pulseReset\(\) \{[\s\S]*?\n\}/);
    expect(fn, '_pulseReset is gone — recheck this guard').toBeTruthy();
    expect(fn[0], 'the reset is silent again, which is what read as a dead button').toContain('toast(');
  });

  it('RESET CARD is disabled when there is nothing to reset', () => {
    expect(pulseModule).toContain('id="pulse-reset-btn"');
    const fn = pulseModule.match(/function syncDockState\(\) \{[\s\S]*?\n\}/);
    expect(fn, 'syncDockState is gone').toBeTruthy();
    expect(fn[0]).toMatch(/disabled = draftIsEmpty\(\)/);
    // It has to run on every repaint or the button goes stale mid-typing.
    const paint = pulseModule.match(/function paintCard\(\) \{[\s\S]*?\n\}/);
    expect(paint[0]).toContain('syncDockState()');
  });
});

describe('the recent list is reachable on a phone', () => {
  it('the sheet exists and rides the console\'s own sheet pattern', () => {
    expect(consoleHtml).toContain('id="pulse-log-sheet"');
    expect(consoleHtml).toMatch(/class="sheet-overlay hidden" id="pulse-log-sheet"/);
    expect(consoleHtml).toContain('id="pulse-log-mobile"');
  });

  it('the trigger exists and is gated to where the desktop rail disappears', () => {
    expect(pulseModule).toContain('id="pulse-log-btn"');
    // Hidden by default; the 900px block that kills .pulse-rail turns it on.
    expect(consoleCss).toMatch(/\.pulse-log-btn \{[^}]*display:\s*none/);
    const mobile = consoleCss.slice(consoleCss.indexOf('@media (max-width: 900px)'));
    expect(mobile).toMatch(/\.pulse-rail \{ display: none; \}/);
    expect(mobile, 'the trigger does not appear where the rail vanishes').toMatch(/\.pulse-log-btn \{ display: inline-flex/);
  });

  it('the log renders into BOTH hosts, so neither frame goes stale', () => {
    const fn = pulseModule.match(/export function renderPulseLog\(\) \{[\s\S]*?\n\}/);
    expect(fn, 'renderPulseLog is gone').toBeTruthy();
    expect(fn[0]).toContain("'pulse-log'");
    expect(fn[0]).toContain("'pulse-log-mobile'");
  });

  it('the sheet closes on Escape and on a grabber drag, like every other one', () => {
    const init = read('js/console/init.js');
    expect(init, 'the sheet is not in the Escape ladder').toContain('pulse-log-sheet")?.classList.contains("hidden")');
    expect(init, 'the sheet cannot be swiped shut').toContain('_wireSheetDrag("pulse-log-sheet"');
  });

  it('loading a past pulse closes the sheet it was tapped from', () => {
    const fn = pulseModule.match(/export function _pulseReuse\(id\) \{[\s\S]*?\n\}/);
    expect(fn, '_pulseReuse is gone').toBeTruthy();
    expect(fn[0], 'the sheet stays open over the card it just loaded').toContain('_pulseCloseLog()');
  });
});

describe('the warn toast severity is fully implemented', () => {
  // Pulse introduced `warn` and owns every call site in the repo, including the
  // one a new fork owner is most likely to see first. Both halves or neither:
  // a duration with no colour still looks like an unstyled info toast.
  it('has a duration of its own, not the info fallback', () => {
    expect(read('js/console-telemetry.js')).toMatch(/TOAST_MS = \{[^}]*warn:\s*\d+/);
  });

  it('has a border colour, like success and error', () => {
    expect(consoleCss).toMatch(/\.toast\.warn \{[^}]*border-left-color/);
  });
});
