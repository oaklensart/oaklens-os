// @vitest-environment happy-dom
//
// The canvas bloom (js/console/lighting.js) — phase 2 of the lighting pass.
//
// Two kinds of assertion here, and the split is deliberate.
//
// The BEHAVIOUR tests drive paint() against a recording 2D context. They cannot
// check that the light looks right — no test can, which is why the pass was
// measured in a browser with getImageData and the numbers written into the
// module — but they can check the things that would quietly stop being true:
// that the emitter set is exactly `[data-lit]`, that the colour is read off the
// element rather than tabled, that DAYLIGHT paints nothing, and that every
// emitter gets punched back out of the frame.
//
// The SOURCE tests pin the three promises the module makes in prose, because
// each one is a rule from somewhere else in the project that a future edit
// would break without any visible symptom: the licence (design-spec §6.5), the
// one-heartbeat budget (motion-language.md), and the iPad cliff that
// mix-blend-mode walks off.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'js', 'console', 'lighting.js'), 'utf8');
// Prose that explains a rule is not the same as code that keeps it — every
// source assertion below runs against the file with its comments removed.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------- the stubs

let calls = [];
let rects = new Map();
let props = new Map();

/** A 2D context that records instead of rasterising. */
function recordingCtx() {
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    clearRect(...a) { calls.push(['clearRect', ...a]); },
    beginPath() { calls.push(['beginPath']); },
    roundRect(...a) { calls.push(['roundRect', ...a]); },
    rect(...a) { calls.push(['rect', ...a]); },
    // The composite op AT FILL TIME is the whole point: it is what separates
    // drawing the pool from punching the control back out of it.
    fill() {
      calls.push(['fill', this.globalCompositeOperation, this.fillStyle,
        this.shadowColor, this.shadowBlur]);
    },
    drawImage() { calls.push(['drawImage', this.globalAlpha]); },
  };
  return ctx;
}

/** Give one element a box and a resolved --lit-rgb. */
function lamp(el, { x = 10, y = 10, w = 100, h = 30, rgb = '255, 0, 0' } = {}) {
  el.setAttribute('data-lit', 'accent');
  rects.set(el, { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
  props.set(el, { '--lit-rgb': rgb });
  return el;
}

async function load() {
  vi.resetModules();
  return import('../js/console/lighting.js');
}

beforeEach(() => {
  calls = [];
  rects = new Map();
  props = new Map();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');

  HTMLCanvasElement.prototype.getContext = () => recordingCtx();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });

  Element.prototype.getBoundingClientRect = function () {
    return rects.get(this) || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  // STUDIO by default: the bloom is on.
  props.set(document.documentElement, { '--bloom-gain': '1' });
  window.getComputedStyle = (el) => ({
    borderTopLeftRadius: '0px',
    getPropertyValue: (name) => (props.get(el) || {})[name] ?? '',
  });
});

afterEach(() => { vi.resetModules(); });

/** Boot the module and paint one frame synchronously. */
async function painted() {
  const m = await load();
  m.lightingInit();
  m._lighting.paint();
  return m;
}

// ------------------------------------------------------------- the behaviour

describe('the bloom finds its emitters by the licence, and only by it', () => {
  it('lights an element with data-lit and ignores everything else', async () => {
    document.body.innerHTML = `
      <button id="lit"></button>
      <button id="plain"></button>
      <div id="selected" class="is-selected" aria-selected="true"></div>`;
    lamp(document.getElementById('lit'));
    // The two controls that must NOT glow: "this one is picked" is a fact, not
    // activity, and demoting six of those halos is what K37 was for.
    rects.set(document.getElementById('plain'), { left: 0, top: 0, width: 80, height: 20, right: 80, bottom: 20 });
    rects.set(document.getElementById('selected'), { left: 0, top: 40, width: 80, height: 20, right: 80, bottom: 60 });

    const m = await painted();
    expect(m._lighting.emitters().map((e) => e.id)).toEqual(['lit']);
    expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(2); // one pool, one punch
  });

  it('names no surface, view or id of its own', () => {
    // The moment this module knows what a publish button is, the licence lives
    // in two places and they drift.
    expect(CODE).not.toMatch(/publish|buffer|archive|cards|pulse|sys-lamp|tab-btn/i);
    expect(CODE.match(/querySelectorAll\([^)]*\)/g)).toEqual(['querySelectorAll(\'[data-lit]\')']);
  });

  it('paints nothing at all when nothing is lit', async () => {
    document.body.innerHTML = '<button id="plain"></button>';
    await painted();
    expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(0);
    expect(calls.filter((c) => c[0] === 'drawImage')).toHaveLength(0);
    // …but it still clears, or the last frame would burn in after the light
    // goes out.
    expect(calls.filter((c) => c[0] === 'clearRect').length).toBeGreaterThan(0);
  });

  it('skips a control the breakpoint has hidden', async () => {
    // Both publish controls carry data-lit at once and only one is ever on
    // screen; the hidden one measures 0×0. Without this guard it would burn a
    // shadow blur at the origin every frame.
    document.body.innerHTML = '<button id="hidden"></button>';
    const el = document.getElementById('hidden');
    el.setAttribute('data-lit', 'accent');
    props.set(el, { '--lit-rgb': '255, 0, 0' });
    rects.set(el, { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
    await painted();
    expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(0);
  });

  it('skips an emitter scrolled far out of view', async () => {
    document.body.innerHTML = '<div id="far"></div>';
    lamp(document.getElementById('far'), { y: 4000, h: 40 });
    await painted();
    expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(0);
  });
});

describe('colour is read at paint time, never tabled', () => {
  it('takes each emitter colour off the element', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    lamp(document.getElementById('a'), { rgb: '39, 201, 63' });
    lamp(document.getElementById('b'), { y: 100, rgb: '230, 168, 23' });
    await painted();
    const pools = calls.filter((c) => c[0] === 'fill' && c[1] === 'lighter');
    expect(pools.map((c) => c[3])).toEqual([
      'rgba(39, 201, 63, 0.85)', 'rgba(230, 168, 23, 0.85)',
    ]);
  });

  it('carries no colour literal of its own', () => {
    // Same rule tests/theme-tokens.test.js puts on card-paint.js. A table here
    // would be wrong in DAYLIGHT, wrong in five of six presets, and wrong in
    // every fork. The one literal allowed is the punch-out's, which is a MASK:
    // destination-out reads alpha only, so its colour is never seen.
    const literals = CODE.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+/g) || [];
    expect(literals).toEqual(['#000']);
    expect(CODE).toContain("getPropertyValue('--lit-rgb')");
  });

  it('refuses a malformed --lit-rgb rather than painting the last colour', async () => {
    // fillStyle silently ignores an invalid value and keeps whatever was set
    // before, so a bad token would paint the PREVIOUS emitter's colour.
    document.body.innerHTML = '<div id="bad"></div>';
    lamp(document.getElementById('bad'), { rgb: 'var(--nope)' });
    await painted();
    expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(0);
  });
});

describe('the bloom does not redraw the control', () => {
  it('punches every emitter back out of the finished frame', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    lamp(document.getElementById('a'));
    lamp(document.getElementById('b'), { y: 200 });
    await painted();
    const punches = calls.filter((c) => c[0] === 'fill' && c[1] === 'destination-out');
    expect(punches).toHaveLength(2);
    // …and hands the canvas back, or the next thing drawn would erase instead.
    const lastOp = calls.filter((c) => c[0] === 'fill').at(-1)[1];
    expect(lastOp).toBe('destination-out');
    const m = await load();
    expect(SRC).toMatch(/globalCompositeOperation = 'source-over';\s*\n}/);
    expect(typeof m.lightingRepaint).toBe('function');
  });

  it('spreads the pool with a shadow, not a hard fill', async () => {
    // The measured finding: a flat rect cannot pool, because bilinear upscaling
    // stops at the neighbouring pixel. If this ever goes back to a plain fill
    // the light dies 30px out and nobody notices in a screenshot.
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'), { w: 100, h: 30 });
    await painted();
    const pool = calls.find((c) => c[0] === 'fill' && c[1] === 'lighter');
    expect(pool[4], 'the pool must carry a shadow blur').toBeGreaterThan(0);
  });
});

describe('DAYLIGHT paints no bloom', () => {
  it('reads --bloom-gain and stops at zero', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'));
    props.set(document.documentElement, { '--bloom-gain': '0' });
    const m = await painted();
    expect(m._lighting.bloomGain()).toBe(0);
    expect(calls.filter((c) => c[0] === 'fill')).toHaveLength(0);
    expect(calls.filter((c) => c[0] === 'drawImage')).toHaveLength(0);
  });

  it('has no [data-theme] branch of its own', () => {
    // On paper "lit" is a ring and a contact shadow, and that is one token
    // override in CSS — not a second code path here.
    // It may WATCH data-theme — that is how it learns the gain changed — but
    // it may never branch on the value, which is the table this whole module
    // refuses to keep.
    expect(CODE).toContain("attributeFilter: ['data-theme']");
    expect(CODE).not.toMatch(/===\s*['"](light|dark)['"]|dataset\.theme\s*[=!]==/);
  });
});

describe('--bloom-gain is a dial that actually turns', () => {
  // ⚠️ THE BUG THIS EXISTS FOR. The first spelling was `globalAlpha = gain`,
  // and the canvas spec CLAMPS globalAlpha to [0,1] — so every value above 1
  // was a silent no-op. The owner asked for 3, it would have rendered exactly
  // like 1, and nothing anywhere would have said so. A knob that looks like it
  // works and does nothing is worse than no knob.
  const passes = () => calls.filter((c) => c[0] === 'drawImage').map((c) => c[1]);

  it('spends gain above 1 as accumulating passes, not as a clamped alpha', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'));
    props.set(document.documentElement, { '--bloom-gain': '3' });
    await painted();
    expect(passes(), 'three whole passes at full alpha').toEqual([1, 1, 1]);
  });

  it('is byte-identical to what shipped at gain 1 and below', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'));
    await painted();
    expect(passes()).toEqual([1]);

    calls = [];
    props.set(document.documentElement, { '--bloom-gain': '0.5' });
    await painted();
    expect(passes()).toEqual([0.5]);
  });

  it('spends a fractional remainder rather than rounding it away', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'));
    props.set(document.documentElement, { '--bloom-gain': '2.5' });
    await painted();
    expect(passes()).toEqual([1, 1, 0.5]);
  });

  it('clamps a typo instead of drawing the canvas three hundred times', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'));
    props.set(document.documentElement, { '--bloom-gain': '300' });
    const m = await painted();
    expect(m._lighting.bloomGain()).toBe(m._lighting.GAIN_MAX);
    expect(passes().length).toBe(m._lighting.GAIN_MAX);
  });
});

describe('it spends no heartbeat', () => {
  it('never re-arms itself — the repaint is the end of the frame', () => {
    // docs/ideas/motion-language.md allows one heartbeat per page and the SYS
    // lamp owns it. Measured at zero requestAnimationFrame calls across two
    // idle seconds in the browser; this is the source-level guard on that.
    expect(CODE).not.toMatch(/setInterval/);
    // The only scheduling in the file is the coalescing one, and what makes it
    // a scheduler rather than a loop is that its CALLBACK schedules nothing.
    const sched = CODE.slice(CODE.indexOf('export function lightingRepaint'));
    const body = sched.slice(0, sched.indexOf('\n}'));
    const cb = body.match(/raf\(\(\) => \{([\s\S]*)\}\)/)[1];
    expect(cb).not.toMatch(/raf\(|requestAnimationFrame|lightingRepaint\(|setTimeout/);
    // …and no other function in the file schedules a frame at all.
    expect(CODE.slice(0, CODE.indexOf('export function lightingRepaint')))
      .not.toMatch(/requestAnimationFrame|setTimeout/);
  });

  it('coalesces every event into at most one paint per frame', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    lamp(document.getElementById('a'));
    const m = await load();
    m.lightingInit();
    let scheduled = 0;
    const real = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { scheduled++; return real ? real(cb) : 1; };
    try {
      m.lightingRepaint(); m.lightingRepaint(); m.lightingRepaint();
      expect(scheduled).toBeLessThanOrEqual(1);
    } finally { globalThis.requestAnimationFrame = real; }
  });
});

describe('it is inert where a canvas cannot be had', () => {
  it('boots without a 2D context instead of taking the console down with it', async () => {
    // happy-dom returns null from getContext, which is exactly the shape of a
    // locked-down browser. tests/console-boot.test.js goes red if this throws.
    HTMLCanvasElement.prototype.getContext = () => null;
    const m = await load();
    expect(() => m.lightingInit()).not.toThrow();
    expect(document.getElementById('lighting-canvas')).toBeNull();
    expect(() => m.lightingRepaint()).not.toThrow();
    expect(() => m._lighting.paint()).not.toThrow();
  });

  it('is built at runtime and appends exactly one canvas, once', async () => {
    const m = await load();
    m.lightingInit();
    m.lightingInit();
    expect(document.querySelectorAll('canvas#lighting-canvas')).toHaveLength(1);
    // Decorative and unreadable — it must never reach the accessibility tree.
    expect(document.getElementById('lighting-canvas').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the composite stays off the compositor cliff', () => {
  it('never asks for mix-blend-mode', () => {
    // The bench blends with `screen`, which forces the whole document through a
    // blended composite every paint. The additive part happens inside the
    // emissive buffer instead, where it costs one quarter-scale canvas.
    expect(CODE).not.toMatch(/mixBlendMode|mix-blend-mode/);
    expect(CODE).toContain("globalCompositeOperation = 'lighter'");
  });
});
