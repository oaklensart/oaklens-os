// @vitest-environment happy-dom
// ============================================================================
// THE HELP FILAMENT — the mark is a rod in a channel, and it obeys the licence.
//
// 2026-09-21. The owner's mockups (docs/ideas/field-console-help-filament-
// mockup.html and the avionics communicator beside it) replaced the help
// overlay's corner brackets with a filament: a glass rod recessed along the
// control's edge, cold iron at rest, warming under a pointer, igniting when
// picked and unfurling the card out of itself. That is a touch point rather
// than a drawing, which is the whole reason the help feature exists.
//
// What can rot is not the look but the RULES it was built under, every one of
// which has a written reason elsewhere and a failure mode that looks fine:
//
//   • browse lights only the EMBER (2026-09-22, the owner's amendment of
//     design-spec.md §6.5 for this surface: "an organic emissive situation")
//     — a faint gradient under each rod, dimmer than warm, dimmer than hot;
//     a warm rod is still opacity, and only [data-hot] carries a halo;
//   • cold iron derives from --lit-rgb, so it follows the theme and the preset
//     and DAYLIGHT needs no twin;
//   • heat and cool are the ignition's own asymmetric pair, not a new timing;
//   • the resting rule declares every drop-shadow the hot one does, in order,
//     or the rod BLINKS on instead of heating (the ignition's filter trap);
//   • no heartbeat, no mix-blend-mode — the one-heartbeat rule and the iPad
//     cliff, both pinned elsewhere for the console and re-pinned here for the
//     surface most likely to grow a "subtle idle pulse";
//   • and the marks SURVIVE card mode, so the rod can cool: a rebuilt mark is a
//     new node, and a new node cannot transition from hot.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');
const SRC = readFileSync(join(ROOT, 'js/console/help.js'), 'utf8');
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const HELP_SECTION = RULES.slice(RULES.indexOf('.help-target:focus-visible'));

/** The declarations of one rule, by its exact selector line. */
const rule = (selector) => {
  const at = RULES.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = RULES.indexOf('{', at);
  return RULES.slice(open + 1, RULES.indexOf('}', open));
};

describe('cold iron is the resting half of the one licence', () => {
  it('declares the ladder once, derived from --lit-rgb', () => {
    for (const t of ['--lit-cold-0:', '--lit-cold-1:', '--lit-cold-2:']) {
      expect(CSS, `${t} must be declared`).toContain(t);
      expect(CSS, `${t} must derive from the emitter colour, not restate one`)
        .toMatch(new RegExp(`${t}\\s*rgba\\(var\\(--lit-rgb\\)`));
    }
  });

  it('DAYLIGHT needs no twin', () => {
    // Same argument --lit-halo makes: one token, no [data-theme] branch.
    const light = CSS.slice(CSS.indexOf(':root[data-theme="light"]'));
    expect(light.slice(0, light.indexOf('}'))).not.toContain('--lit-cold');
  });

  it('the ? wears it at rest, and only at rest', () => {
    expect(rule('#help-topbar-btn:not([data-lit])')).toContain('var(--lit-cold-2)');
  });
});

describe('the rod lights only once picked', () => {
  it('browse warms with opacity and nothing else', () => {
    // Warm is the pre-ignition of the one control you are about to press. It
    // must not become a glow: ten warm rods would be ten lit controls.
    const warm = [...RULES.matchAll(/\.help-mark\[data-warm\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(warm.length).toBeGreaterThan(0);
    for (const decl of warm) {
      expect(decl).not.toMatch(/box-shadow|filter|--lit-halo|drop-shadow/);
      expect(decl).toMatch(/opacity:/);
    }
  });

  it('only [data-hot] carries a halo', () => {
    const lit = [...HELP_SECTION.matchAll(/([^{}]+)\{[^}]*--lit-halo[^}]*\}/g)].map((m) => m[1].trim());
    expect(lit.length).toBeGreaterThan(0);
    for (const sel of lit) expect(sel, `${sel} lights without being picked`).toContain('[data-hot]');
  });

  it('heats on --arm-heat and cools on --arm-cool — the ignition\'s own pair', () => {
    expect(rule('.help-strand')).toContain('var(--arm-cool)');
    expect(rule('.help-mark[data-hot] .help-strand')).toContain('var(--arm-heat)');
    expect(rule('.help-mark[data-hot] .help-core::after')).toContain('var(--arm-heat)');
    // No third timing invented for this surface.
    expect(HELP_SECTION).not.toMatch(/transition:[^;]*\d\.\ds cubic-bezier/);
  });

  it('declares the same drop-shadows at rest as hot, so it heats rather than blinks', () => {
    // The trap chrome.js setCommitArmed() documents: a filter interpolates only
    // against a matching function list. Mutation: delete one resting
    // drop-shadow and this fails.
    const rest = rule('.help-strand').match(/filter:\s*([^;]*);/)[1];
    const hot = rule('.help-mark[data-hot] .help-strand').match(/filter:\s*([^;]*);/)[1];
    const count = (v) => (v.match(/drop-shadow\(/g) || []).length;
    expect(count(rest)).toBe(count(hot));
    expect(count(hot)).toBeGreaterThan(0);
    expect(rest, 'resting drop-shadows must be at their no-op value')
      .not.toMatch(/drop-shadow\(0 0 [1-9]/);
  });

  it('spends no heartbeat and blends nothing', () => {
    expect(HELP_SECTION).not.toMatch(/animation:[^;]*infinite/);
    expect(HELP_SECTION).not.toMatch(/mix-blend-mode/);
  });

  it('keeps the reduced-motion bargain — the state, not the journey', () => {
    const rm = HELP_SECTION.slice(HELP_SECTION.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toContain('.help-strand');
    expect(rm).toMatch(/\.help-layer\.carded \.help-card \{ animation: none; \}/);
  });
});

describe('the card unfurls out of the rod', () => {
  it('reveals from the edge it hangs on', () => {
    for (const side of ['below', 'above', 'right', 'left']) {
      expect(rule(`.help-card[data-side="${side}"]`), side).toContain('--unfurl-from:');
    }
    expect(RULES).toMatch(/@keyframes help-unfurl/);
  });

  it('rests on a clip that leaves the arrow alone', () => {
    // The pointer sits 14px outside the box. A clip that settles at inset(0)
    // cuts it off for good — the animation would end with a card and no arrow.
    const kf = RULES.slice(RULES.indexOf('@keyframes help-unfurl'));
    const to = kf.slice(kf.indexOf('to'), kf.indexOf('}', kf.indexOf('to')));
    expect(to).toMatch(/clip-path:\s*inset\(-\d+px\)/);
  });

  it('rests dark — no crown, no lit edge, no socket', () => {
    // Owner, after the first cut: "a thin white stroke … pasted on". The stroke
    // was the rod's crown at 40% plus --edge-up's inset highlight; the pasted-on
    // thing was a socket bead outside the control's box.
    expect(rule('.help-strand::before')).toMatch(/opacity:\s*0;/);
    expect(rule('.help-strand')).not.toContain('--edge-up');
    expect(RULES).not.toMatch(/\.help-filament::before/);
  });

  it('the brackets are gone', () => {
    expect(RULES).not.toContain('--help-bracket');
    expect(RULES).not.toContain('data-narrow');
    expect(SRC).not.toContain('data-narrow');
  });
});

describe('the ember — light, not an object, and no edge anywhere', () => {
  // 2026-09-22. Magnified, the top bar showed each rod as a black 8px pill
  // wider than its button, biting the button's outline, with a line that
  // stopped on a dim stub at each end. The owner: "half finished or even kind
  // of like a jagged edge". The channel is light in the seam now.
  it('has no opaque slab under the control', () => {
    const f = rule('.help-filament');
    expect(f).not.toMatch(/background|box-shadow/);
    // As wide as the CONTROL: the mark's 4px PAD taken back on both sides.
    expect(f).toMatch(/left:\s*4px/);
    expect(f).toMatch(/right:\s*4px/);
    expect(rule('.help-strand')).not.toMatch(/background:/);
  });

  it('drops the hairline on the edge the rod rides', () => {
    expect(rule('.help-mark[data-lamp="b"]')).toMatch(/border-bottom-width:\s*0/);
    expect(rule('.help-mark[data-lamp="t"]')).toMatch(/border-top-width:\s*0/);
  });

  it('dissolves the core at both ends instead of stopping on a stub', () => {
    for (const sel of ['.help-core', '.help-core::after']) {
      const bg = rule(sel).match(/linear-gradient\(90deg,([\s\S]*?)\);/)[1];
      const stops = bg.split(/,(?![^(]*\))/).map((x) => x.trim());
      expect(stops[0], `${sel} starts transparent`).toBe('transparent');
      expect(stops.at(-1), `${sel} ends transparent`).toBe('transparent');
    }
  });

  // Bloom tiers, in order: [y-offset, blur, alpha]. Physical light (owner,
  // 2026-09-22: an ellipse "looks pasted on not like physical light") takes
  // the SHAPE of its emitter — box-shadow blur off the emitter's own box — in
  // tiers that get wider as they get fainter (VP-1 §2.1: core, mid, wash).
  // A zero offset or spread is written bare (`0`), everything else in px.
  const tiers = (decl) => [...decl.matchAll(/(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+([\d.]+)px(?:\s+-?[\d.]+(?:px)?)?\s+rgba\(var\(--[\w-]+\),\s*([\d.]+)\)/g)]
    .map((m) => [Number(m[2]), Number(m[3]), Number(m[4])]);
  const bloom = (sel) => {
    const decl = rule(sel);
    expect(decl, `${sel} draws no shape of its own`).not.toMatch(/gradient|background/);
    const t = tiers(decl);
    expect(t.length, `${sel} blooms in tiers, not one flat halo`).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < t.length; i++) {
      expect(t[i][1], `${sel} tier ${i} is wider`).toBeGreaterThan(t[i - 1][1]);
      expect(t[i][2], `${sel} tier ${i} is fainter`).toBeLessThan(t[i - 1][2]);
    }
    return t;
  };

  it('the ember is bloom that follows the rod, and it is not the licensed halo', () => {
    bloom('.help-filament::after');
    expect(rule('.help-filament::after')).not.toMatch(/filter|--lit-halo/);
  });

  it('ember < warm < hot — picking one still reads as the light coming on', () => {
    const op = (sel) => Number(rule(sel).match(/opacity:\s*([\d.]+)/)[1]);
    const rest = op('.help-filament::after');
    const warm = op('.help-mark[data-warm] .help-filament::after');
    const hot = op('.help-mark[data-hot] .help-filament::after');
    expect(rest).toBeGreaterThan(0);
    expect(rest).toBeLessThan(0.5);
    expect(warm).toBeGreaterThan(rest);
    expect(hot).toBeGreaterThan(warm);
  });

  it('DAYLIGHT drops the ember with the pools', () => {
    expect(RULES).toMatch(/:root\[data-theme="light"\] \.help-filament::after/);
  });

  it('the ? blooms off its own outline, and its wash falls on the deck below', () => {
    const t = bloom('.help-arm-glow');
    // Every tier but the widest is centred on the lamp; the widest is the
    // VP-1 §2.5 floor footprint — dropped, so the window's top edge (11px
    // above the button) can never cut it.
    for (const [y] of t.slice(0, -1)) expect(y).toBe(0);
    expect(t.at(-1)[0]).toBeGreaterThan(0);
  });
});

describe('the sidebar waveguide — one licensed selection, no chaser', () => {
  it('seats a cold bead on every item and lights only the current view', () => {
    expect(rule('.nav-btn::before')).toContain('var(--lit-cold-1)');
    expect(rule('.nav-btn::before')).not.toContain('--lit-halo');
    expect(rule('.nav-btn.active::before')).toContain('var(--lit-halo)');
    expect(rule('.nav-group::before')).toContain('var(--edge-in)');
  });

  it('runs no idle chaser down the track', () => {
    // The mockup's soundboard cascade is an ambient infinite loop — a second
    // heartbeat. Declined; the SYS lamp has the only one.
    expect(RULES).not.toMatch(/\.nav-[\w-]*[^{]*\{[^}]*animation/);
  });

  it('keeps the reduced-motion bargain for the bead', () => {
    expect(RULES).toMatch(/prefers-reduced-motion[\s\S]{0,1200}\.nav-btn::before \{ transition: none; \}/);
  });
});

// ---- behaviour ---------------------------------------------------------------
// A stubbed console — happy-dom lays nothing out, so every rect is stated —
// driven through the module's public doors and its capture listeners.
const HELP_MOD = await import('../js/console/help.js');

describe('the filament under a thumb', () => {
  const VW = 1000;
  const VH = 620;
  const TOPBAR_H = 52;
  const at = (el, top, bottom, left = 100, right = 900) => {
    el.getBoundingClientRect = () => ({
      top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top,
    });
    el.getClientRects = () => [el.getBoundingClientRect()];
    return el;
  };

  beforeEach(() => {
    HELP_MOD.helpClose();
    document.body.innerHTML =
      '<header class="topbar"></header>'
      + '<div class="layout"><div class="main">'
      + '<section class="view active" id="view-buffer">'
      + '<div class="dropzone" id="buffer-dropzone"></div>'
      + '<button id="buffer-raw-lens-btn"></button>'
      + '</section></div></div>';
    at(document.querySelector('.topbar'), 0, TOPBAR_H, 0, VW);
    at(document.getElementById('buffer-dropzone'), 100, 300);
    at(document.getElementById('buffer-raw-lens-btn'), 320, 352, 100, 220);
    window.innerWidth = VW;
    window.innerHeight = VH;
  });

  const marks = () => [...document.querySelectorAll('.help-mark')];
  const markFor = (id) => marks().find((m) => m.dataset.helpFor === `#${id}`);

  it('builds a rod into every mark, on the control\'s bottom edge', () => {
    HELP_MOD.helpToggle();
    expect(marks().length).toBeGreaterThanOrEqual(2);
    for (const m of marks()) {
      expect(m.querySelector('.help-filament > .help-strand > .help-core')).toBeTruthy();
    }
    expect(markFor('buffer-dropzone').dataset.lamp).toBe('b');
  });

  it('moves the rod to the top edge when the bottom is under a bar, and draws none when both are', () => {
    // Placement is pure geometry, so it is tested as geometry.
    const el = at(document.getElementById('buffer-dropzone'), 100, VH + 200);
    const mark = document.createElement('div');
    HELP_MOD._placeMark({ el, mark });
    expect(mark.dataset.lamp).toBe('t');
    at(el, 20, VH + 200);     // top under the topbar as well
    HELP_MOD._placeMark({ el, mark });
    expect(mark.dataset.lamp).toBe('');
  });

  it('warms the rod under the pointer and only that one', () => {
    HELP_MOD.helpToggle();
    const dz = document.getElementById('buffer-dropzone');
    dz.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(markFor('buffer-dropzone').hasAttribute('data-warm')).toBe(true);
    expect(markFor('buffer-raw-lens-btn').hasAttribute('data-warm')).toBe(false);
    document.body.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(markFor('buffer-dropzone').hasAttribute('data-warm')).toBe(false);
  });

  it('sinks the rod on press and lets it back up on release', () => {
    HELP_MOD.helpToggle();
    const dz = document.getElementById('buffer-dropzone');
    dz.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(markFor('buffer-dropzone').hasAttribute('data-press')).toBe(true);
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(markFor('buffer-dropzone').hasAttribute('data-press')).toBe(false);
  });

  it('ignites the picked rod, keeps the node, and cools it on the way back', () => {
    HELP_MOD.helpToggle();
    const before = markFor('buffer-dropzone');
    document.getElementById('buffer-dropzone')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const layer = document.getElementById('help-layer');
    expect(layer.classList.contains('carded')).toBe(true);
    const hot = markFor('buffer-dropzone');
    expect(hot.hasAttribute('data-hot')).toBe(true);
    expect(markFor('buffer-raw-lens-btn').hasAttribute('data-hot')).toBe(false);
    // The SAME element. A rebuilt mark is a new node, and a new node cannot
    // transition from hot to cold — the rod would just vanish.
    expect(hot).toBe(before);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(layer.classList.contains('carded')).toBe(false);
    expect(markFor('buffer-dropzone')).toBe(before);
    expect(before.hasAttribute('data-hot')).toBe(false);
  });

  it('does not warm in card mode — the pointer is on the dim', () => {
    HELP_MOD.helpToggle();
    document.getElementById('buffer-dropzone')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.getElementById('buffer-raw-lens-btn')
      .dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(markFor('buffer-raw-lens-btn').hasAttribute('data-warm')).toBe(false);
  });

  // 2026-09-22. On a phone the marks trailed their controls through every
  // scroll: the page scrolls on its own thread and the marks are placed by
  // script a frame or more behind. Under a finger they now let go while the
  // page moves and are measured once where it comes to rest. A mouse keeps the
  // live tracking — that is the half that worked, and it must not regress.
  describe('under a scroll', () => {
    const main = () => document.querySelector('.main');
    const scroll = () => main().dispatchEvent(new Event('scroll'));
    const down = (pointerType) => {
      const e = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      document.getElementById('view-buffer').dispatchEvent(e);
    };
    const layer = () => document.getElementById('help-layer');
    const topOf = (id) => parseFloat(markFor(id).style.top);

    afterEach(() => vi.useRealTimers());

    it('follows the page live under a mouse', () => {
      HELP_MOD.helpToggle();
      down('mouse');
      at(document.getElementById('buffer-raw-lens-btn'), 280, 312, 100, 220);
      scroll();
      expect(layer().classList.contains('scrolling')).toBe(false);
      expect(topOf('buffer-raw-lens-btn')).toBe(280 - 4);
    });

    it('lets go under a finger and re-seats once the page is still', () => {
      vi.useFakeTimers();
      HELP_MOD.helpToggle();
      down('touch');
      const was = topOf('buffer-raw-lens-btn');
      at(document.getElementById('buffer-raw-lens-btn'), 280, 312, 100, 220);
      scroll();
      // Mid-gesture: hidden, and NOT chased — a mark moved here would be a
      // frame late on a real phone, which is the bug.
      expect(layer().classList.contains('scrolling')).toBe(true);
      expect(topOf('buffer-raw-lens-btn')).toBe(was);
      // Momentum keeps scrolling; each event holds the marks down again.
      vi.advanceTimersByTime(100);
      scroll();
      vi.advanceTimersByTime(100);
      expect(layer().classList.contains('scrolling')).toBe(true);
      vi.advanceTimersByTime(100);
      expect(layer().classList.contains('scrolling')).toBe(false);
      expect(topOf('buffer-raw-lens-btn')).toBe(280 - 4);
    });

    it('a wheel after a touch is a mouse again', () => {
      HELP_MOD.helpToggle();
      down('touch');
      window.dispatchEvent(new Event('wheel'));
      scroll();
      expect(layer().classList.contains('scrolling')).toBe(false);
    });

    it('opening a card or closing help drops a pending settle', () => {
      vi.useFakeTimers();
      HELP_MOD.helpToggle();
      down('touch');
      scroll();
      document.getElementById('buffer-dropzone')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(layer().classList.contains('carded')).toBe(true);
      // The hot rod lives in the marks host; a card under a held fade would
      // have nothing lit beneath it.
      expect(layer().classList.contains('scrolling')).toBe(false);
      HELP_MOD.helpClose();
      vi.advanceTimersByTime(500);
      expect(layer().classList.contains('scrolling')).toBe(false);
    });

    it('starts on the finger\'s pointercancel — the pan taking over — not the first scroll', () => {
      vi.useFakeTimers();
      HELP_MOD.helpToggle();
      const e = new Event('pointercancel', { bubbles: true });
      Object.defineProperty(e, 'pointerType', { value: 'touch' });
      document.getElementById('view-buffer').dispatchEvent(e);
      expect(layer().classList.contains('scrolling')).toBe(true);
      vi.advanceTimersByTime(200);
      expect(layer().classList.contains('scrolling')).toBe(false);
    });

    it('a mouse\'s pointercancel is not a scroll', () => {
      HELP_MOD.helpToggle();
      const e = new Event('pointercancel', { bubbles: true });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      document.getElementById('view-buffer').dispatchEvent(e);
      expect(layer().classList.contains('scrolling')).toBe(false);
    });

    it('spends nothing mid-flick — a resize while let go waits for the settle', () => {
      vi.useFakeTimers();
      HELP_MOD.helpToggle();
      down('touch');
      scroll();
      const was = topOf('buffer-raw-lens-btn');
      at(document.getElementById('buffer-raw-lens-btn'), 280, 312, 100, 220);
      window.dispatchEvent(new Event('resize'));
      expect(topOf('buffer-raw-lens-btn')).toBe(was);
      vi.advanceTimersByTime(200);
      expect(topOf('buffer-raw-lens-btn')).toBe(280 - 4);
    });

    it('keeps a bar\'s marks and cut-outs apart, so the header never blinks', () => {
      HELP_MOD.helpToggle();
      const bar = marks().filter((m) => m.hasAttribute('data-fixed'));
      const content = marks().filter((m) => !m.hasAttribute('data-fixed'));
      // The fixture's topbar is empty, so the only bar hole is the `?`'s — and
      // it has no button here. What matters: content holes land in the group
      // that hides, and nothing on the content is flagged as fixed.
      expect(bar).toEqual([]);
      expect(content.length).toBeGreaterThanOrEqual(2);
      expect(document.getElementById('help-scrim-holes').children.length).toBe(content.length);
      expect(document.getElementById('help-scrim-fixed')).toBeTruthy();
    });

    it('flags a mark on the topbar as fixed', () => {
      document.querySelector('.topbar').innerHTML = '<span id="sys-lamp"></span>';
      at(document.getElementById('sys-lamp'), 12, 38, 20, 46);
      HELP_MOD.helpToggle();
      const lamp = marks().find((m) => m.dataset.helpFor === '#sys-lamp');
      expect(lamp, 'the topbar lamp has a help entry').toBeTruthy();
      expect(lamp.hasAttribute('data-fixed')).toBe(true);
      expect(document.getElementById('help-scrim-fixed').children.length).toBeGreaterThanOrEqual(1);
    });

    it('vanishes on the way out and eases only on the way back', () => {
      // The flick tear: an exit that fades is an exit that lingers where the
      // controls used to be. `transition: none` on the ENTERING state governs
      // only the exit; the return runs on .help-mark's own transition.
      const sel = '.help-layer.scrolling .help-mark:not([data-fixed]),\n.help-layer.scrolling #help-scrim-holes';
      const out = rule(sel);
      expect(out, 'the scrolling rule, by its exact selector').toMatch(/opacity:\s*0/);
      expect(out).toMatch(/transition:\s*none/);
      expect(rule('.help-mark')).toMatch(/transition:\s*opacity var\(--dur-2\)/);
      expect(rule('#help-scrim-holes')).toMatch(/transition:\s*opacity var\(--dur-2\)/);
    });
  });

  describe('the armed ?', () => {
    beforeEach(() => {
      document.querySelector('.topbar').innerHTML =
        '<button class="settings-btn" id="help-topbar-btn"></button>';
      at(document.getElementById('help-topbar-btn'), 11.25, 39.75, 941.5, 970.1);
    });

    it('hangs its light off the lamp\'s own box — no shape of its own', () => {
      HELP_MOD.helpToggle();
      const box = HELP_MOD._placeArmGlow();
      // It was a 120px circle, then a 178px ellipse. Light takes the shape of
      // its emitter, so the element IS the button and the tiers do the rest.
      expect(box).toEqual({ left: 941.5, top: 11.25, width: 970.1 - 941.5, height: 39.75 - 11.25 });
    });

    it('cuts its hole flush — no ring of its own halo, no half-pixel sliver', () => {
      HELP_MOD.helpToggle();
      const holes = [...document.getElementById('help-scrim-fixed').children];
      const arm = holes.find((r) => Number(r.getAttribute('x')) === 941.5);
      expect(arm, 'a hole at the button\'s own left edge, unrounded').toBeTruthy();
      expect(Number(arm.getAttribute('width'))).toBeCloseTo(970.1 - 941.5, 2);
      expect(arm.getAttribute('rx')).toBe('0');
    });
  });

  it('leaves nothing behind on close', () => {
    HELP_MOD.helpToggle();
    HELP_MOD.helpClose();
    expect(marks()).toEqual([]);
    expect(document.querySelectorAll('.help-target').length).toBe(0);
  });
});
