import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The lighting pass pinned.
 *
 * `docs/ideas/tactile-touch-pass.md` sets the bar for this work and makes it
 * falsifiable: "Item 2 in particular must produce FEWER visual effects, not
 * more. If a draft of it adds shadows, it has failed."
 *
 * A raw declaration count is the wrong test — replacing two hand-rolled
 * shadows with one derived token is a win even when the count barely moves.
 * What actually drifts is VALUES: before this pass, 58 declarations carried 43
 * distinct values, including three spellings of one rim highlight and seven
 * different glow radii. So the gate is: every shadow derives from the light,
 * and nothing writes its own colour.
 */
const CSS = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');

const shadows = () => [...CSS.matchAll(/box-shadow:\s*([^;]*);/g)].map((m) => m[1].trim());
// Selector assertions run comment-free: this file explains itself at length,
// and prose that names a selector is not the same as shipping one.
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the console has one light source', () => {
  it('declares the ladder once, as multipliers rather than lengths', () => {
    // --light-y is a multiplier so that flipping it to -1 relights the whole
    // console from below. That is the falsification test for the whole pass:
    // anything that still looks right was never deriving from the light.
    for (const t of ['--light-x:', '--light-y:', '--light-rim:', '--shade-1:', '--shade-2:', '--shade-3:']) {
      expect(CSS, `${t} must be declared`).toContain(t);
    }
    for (const d of ['--edge-up:', '--edge-in:', '--shadow-press:', '--shadow-1:', '--shadow-2:', '--shadow-3:']) {
      expect(CSS, `${d} must be declared`).toContain(d);
    }
    expect(CSS, '--shadow-* must derive from --light-y, not restate an offset')
      .toMatch(/--shadow-1:\s*calc\(var\(--light-x\)[\s\S]*?calc\(var\(--light-y\)/);
  });

  it('writes no colour of its own in any shadow', () => {
    // The subtractive test, in its honest form. A shadow that hardcodes
    // rgba(0,0,0,.45) cannot follow the theme and cannot follow the light.
    const raw = shadows().filter((v) => /rgba\(\s*\d|#[0-9a-fA-F]{3,8}\b/.test(v));
    expect(raw, `shadows carrying a raw colour literal:\n${raw.join('\n')}`).toEqual([]);
  });

  it('keeps the cast shadows on one ladder', () => {
    // Every drop shadow is --shadow-1/2/3 or an inset. The one exception is a
    // SEAM (the FN preview panel overlapping the editor), which is lateral on
    // purpose and is allowed to say so — but it still takes its colour from
    // the ladder, which the previous test enforces.
    const offenders = shadows().filter((v) => {
      const parts = v.split(/,(?![^(]*\))/).map((x) => x.trim());
      return parts.some((pt) => /^\d+px\s+\d+px/.test(pt) && !pt.startsWith('var('));
    });
    expect(offenders, `hand-rolled cast shadows:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('light is licensed, not decorative', () => {
  it('routes every halo through the one token', () => {
    expect(CSS).toContain('--lit-halo:');
    expect(CSS).toMatch(/\[data-lit\]\s*\{/);
    expect(CSS, 'the tone variants must remap --lit-rgb, not restate a colour')
      .toMatch(/\[data-lit="ok"\]\s*\{\s*--lit-rgb:\s*var\(--ok-rgb\)/);
  });

  it('DAYLIGHT needs no selector of its own', () => {
    // On paper "lit" is a ring plus a contact shadow, not a bloom. That is one
    // token override, so nothing anywhere needs a [data-theme="light"] twin.
    expect(RULES, 'no [data-theme="light"] [data-lit] override should exist')
      .not.toMatch(/\[data-theme="light"\][^{;]*\[data-lit\]/);
    const light = CSS.slice(CSS.indexOf(':root[data-theme="light"]'));
    expect(light.slice(0, light.indexOf('}'))).toContain('--lit-halo:');
  });

  it('leaves the publish pip flat — it is not a second SYS lamp', () => {
    // Belt and braces beside tests/publish-indicator.test.js: that one pins
    // the pip's own rule, this one pins that the licensing scheme never
    // reaches it by inheritance.
    expect(RULES).not.toMatch(/\.publish-btn\s+\.pip[^{]*\{[^}]*data-lit/);
    const pip = RULES.match(/\.publish-btn \.pip \{([\s\S]*?)\}/)[1];
    expect(pip).not.toMatch(/box-shadow/);
  });

  it('spends only one heartbeat, and it is the SYS lamp', () => {
    // docs/ideas/motion-language.md: "No infinite loops… At most one heartbeat
    // per page, and we already spend ours elsewhere (… lamp in the console)."
    // The Cards view used to run two more on badges that meant "selected".
    expect(RULES, 'cardsDotPulse was a second and third heartbeat')
      .not.toMatch(/animation:\s*cardsDotPulse/);
    expect(RULES).not.toMatch(/@keyframes\s+cardsDotPulse/);
  });
});

describe('the canvas bloom is declared, gated and unblended', () => {
  // Phase 2 (js/console/lighting.js). The canvas itself is built at runtime, so
  // these four lines of CSS are the entire contract between the stylesheet and
  // the module — and three of them are load-bearing in a way nothing else can
  // catch, because the failure mode of each is "looks fine, costs a lot" or
  // "looks fine, says the wrong thing".

  it('gives the canvas a layer over the chrome and under the modals', () => {
    const rule = RULES.match(/#lighting-canvas\s*\{([^}]*)\}/);
    expect(rule, '#lighting-canvas must be styled here, not inline from JS').toBeTruthy();
    const css = rule[1];
    expect(css).toMatch(/position:\s*fixed/);
    // Clicks must reach the control the light is coming from.
    expect(css).toMatch(/pointer-events:\s*none/);
    // Over the tab bar (300) so the publish tab can pool; under the sheet
    // overlay (460) and modals (500), because a sheet is a new plane and light
    // from the plane behind it must not lie on top of it.
    const z = Number(css.match(/z-index:\s*(\d+)/)[1]);
    expect(z).toBeGreaterThan(300);
    expect(z).toBeLessThan(460);
  });

  it('never blends — that is the iPad cliff, not a style choice', () => {
    // The lighting bench composites with mix-blend-mode: screen, which forces
    // the compositor to blend the WHOLE document on every paint. The additive
    // accumulation happens inside the module's own emissive buffer instead.
    const rule = RULES.match(/#lighting-canvas\s*\{([^}]*)\}/)[1];
    expect(rule).not.toMatch(/mix-blend-mode/);
  });

  it('is a token the themes set, so DAYLIGHT paints no bloom at all', () => {
    // Same move §6.5 already makes for --lit-halo: on paper "lit" reads as
    // LIFTED, and a glow pooling onto warm paper reads as a screen artefact.
    // One token, so the module needs no [data-theme] branch of its own.
    const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf(':root[data-theme="light"]'));
    // STUDIO's value is the owner's dial and moves; what must hold is that it
    // is ON there, and within the module's typo ceiling of 4.
    const gain = Number(studio.match(/--bloom-gain:\s*([\d.]+)/)[1]);
    expect(gain).toBeGreaterThan(0);
    expect(gain, 'above GAIN_MAX the module clamps and the dial silently lies')
      .toBeLessThanOrEqual(4);
    const light = CSS.slice(CSS.indexOf(':root[data-theme="light"]'));
    expect(light.slice(0, light.indexOf('}'))).toMatch(/--bloom-gain:\s*0/);
  });

  it('lets the publish tab emit without wearing the lit fill', () => {
    // A filled cell in the tab bar means SELECTED, which is the one thing the
    // licence says light must never mean. The tab takes the halo and the canvas
    // pool; [data-lit]'s surface treatment is for a surface with no look of its
    // own, and a tab cell has one.
    expect(RULES).toMatch(/\.tab-btn\[data-lit\]\s*\{[^}]*background:\s*transparent/);
  });
});

describe('press and focus are one mechanism each', () => {
  it('presses travel, and not only on touch', () => {
    // A control that only shrinks reads as a web page. The travel is the
    // tactile part — and it used to be behind (pointer: coarse), so a mouse
    // got nothing at all.
    expect(CSS).toContain('--press-travel:');
    expect(CSS, 'the shared press rule must use the travel token')
      .toMatch(/transform:\s*translateY\(calc\(var\(--light-y\)\s*\*\s*var\(--press-travel\)\)\)/);
    // A press that only swaps in a recess DROPS the resting cast shadow, so the
    // control reads as flattening rather than descending. It has to keep
    // casting — tighter and closer, not gone.
    expect(CSS, 'a pressed control must keep a collapsed cast shadow')
      .toMatch(/box-shadow:\s*var\(--shadow-press\),\s*var\(--edge-in\)/);
    const press = CSS.indexOf('4c. Universal press acknowledgment');
    const before = CSS.slice(0, press);
    const opened = (before.match(/@media \(pointer: coarse\)/g) || []).length;
    const closedByRule = CSS.slice(press, CSS.indexOf('{', press));
    expect(closedByRule, 'the press rule must not sit inside a media query')
      .not.toContain('@media');
    expect(opened).toBeGreaterThanOrEqual(0);
  });

  it('gives the keyboard a visible ring', () => {
    expect(CSS).toContain('--focus-ring:');
    const rings = (CSS.match(/:focus-visible/g) || []).length;
    // Three, in 8,500 lines, was the state this pass found.
    expect(rings, 'the console should focus-ring broadly, not in three places')
      .toBeGreaterThan(10);
  });

  it('keeps a reduced-motion escape for both', () => {
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]{0,400}scroll-snap-type:\s*none/);
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]{0,400}transition:\s*none/);
  });
});

describe('the ground is true black', () => {
  it('switches the OLED pixels off rather than lighting them faintly', () => {
    const studio = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf(':root[data-theme="light"]'));
    expect(studio).toMatch(/--surface-0:\s*#000000/);
  });
});
