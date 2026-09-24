// @vitest-environment happy-dom
//
// The help overlay's BEHAVIOUR, driven against a small shell. The static tests
// (tests/console-help.test.js) gate the copy and the wiring; this file holds
// the four things the 2026-09-24 review found could quietly stop being true:
//
//   • the marks follow a render that happens AFTER help opens;
//   • a bar control is never "brought into view" by scrolling the content, and
//     a control under the topbar is not counted as in view;
//   • a file dropped on the console while help is on lands nowhere;
//   • the card is a dialog with a name.
//
// Geometry is stubbed: happy-dom lays nothing out, so every element measures
// what the test says it does, exactly as tests/console-lighting.test.js does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let rects;
function box(el, { x = 0, y = 100, w = 200, h = 24 } = {}) {
  rects.set(el, { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
  return el;
}

const SHELL = `
  <header class="topbar">
    <button id="publish-btn"></button>
    <button id="help-topbar-btn" aria-expanded="false">?</button>
  </header>
  <div class="layout"><div class="main">
    <section class="view active" id="view-publish">
      <div class="publish-summary" id="summary-1"></div>
    </section>
  </div></div>
  <nav class="tabbar"></nav>`;

// Held at file scope so afterEach can close it: the module's listeners live on
// the shared document and outlast vi.resetModules(), and a previous test's
// instance left in browse would absorb this test's events.
let help = null;
async function boot() {
  vi.resetModules();
  help = await import('../js/console/help.js');
  return help;
}

beforeEach(() => {
  rects = new Map();
  document.body.innerHTML = SHELL;
  document.body.className = '';
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.matchMedia = () => ({ matches: false });
  Element.prototype.getBoundingClientRect = function () {
    return rects.get(this) || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  Element.prototype.getClientRects = function () {
    const r = this.getBoundingClientRect();
    return r.height ? [r] : [];
  };
  // The bars are real boxes; everything else is placed by the test.
  box(document.querySelector('.topbar'), { y: 0, w: 1280, h: 52 });
  box(document.querySelector('.tabbar'), { y: 800, w: 1280, h: 0 });
  box(document.getElementById('publish-btn'), { x: 1100, y: 10, w: 80, h: 32 });
  box(document.getElementById('help-topbar-btn'), { x: 1200, y: 10, w: 32, h: 32 });
  box(document.getElementById('summary-1'), { y: 120, w: 600, h: 80 });
});

afterEach(() => { help?.helpClose(); help = null; vi.resetModules(); });

const marks = () => [...document.querySelectorAll('.help-mark')].map((m) => m.dataset.helpFor);
const relayout = () => window.dispatchEvent(new Event('resize'));

describe('the marks follow a render that finishes after help opens', () => {
  it('re-derives the set when a marked node is replaced or a new control appears', async () => {
    const help = await boot();
    help.helpToggle();
    expect(marks()).toEqual([
      '#publish-btn, .tabbar .tab-btn[data-view="publish"]',
      '.publish-summary',
    ]);
    // A sync finishes and renderPublish() rebuilds the tiles — new nodes, same
    // selector — and the export button renders for the first time.
    const view = document.getElementById('view-publish');
    view.innerHTML = '<div class="publish-summary" id="summary-2"></div><button id="site-export-btn"></button>';
    box(document.getElementById('summary-2'), { y: 120, w: 600, h: 80 });
    box(document.getElementById('site-export-btn'), { y: 300, w: 120, h: 32 });
    relayout();
    expect(marks()).toEqual([
      '#publish-btn, .tabbar .tab-btn[data-view="publish"]',
      '.publish-summary',
      '#site-export-btn',
    ]);
    expect(document.getElementById('help-bar-count').textContent).toBe('· 3 on this screen');
    // The borrowed tab stop moved with it, and the old node kept nothing.
    expect(document.getElementById('summary-2').getAttribute('tabindex')).toBe('0');
  });

  it('keeps the same mark nodes when nothing changed, so a rod can cool in place', async () => {
    const help = await boot();
    help.helpToggle();
    const before = [...document.querySelectorAll('.help-mark')];
    relayout();
    expect([...document.querySelectorAll('.help-mark')]).toEqual(before);
  });

  it('watches the view for the render, not just the window for a resize', async () => {
    const help = await boot();
    const observed = [];
    const RealMO = globalThis.MutationObserver;
    globalThis.MutationObserver = class { observe(el, opts) { observed.push([el.id, opts.childList]); } disconnect() {} };
    try {
      help.helpToggle();
      expect(observed).toEqual([['view-publish', true]]);
    } finally { globalThis.MutationObserver = RealMO; }
  });
});

describe('bringing a control into view', () => {
  function pick(id) {
    document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  it('never scrolls the content to chase a bar control', async () => {
    const help = await boot();
    const main = document.querySelector('.main');
    main.scrollTop = 500;
    help.helpToggle();
    pick('publish-btn');
    expect(document.getElementById('help-layer').classList.contains('carded')).toBe(true);
    expect(main.scrollTop).toBe(500);
  });

  it('counts a control under the topbar as out of view and scrolls it clear', async () => {
    const help = await boot();
    const main = document.querySelector('.main');
    main.scrollTop = 500;
    // 6px showing under a 52px bar: tappable, and not "in view".
    box(document.getElementById('summary-1'), { y: 20, w: 600, h: 38 });
    help.helpToggle();
    pick('summary-1');
    expect(main.scrollTop).toBeLessThan(500);
  });
});

describe('a file dropped while help is on lands nowhere', () => {
  it('absorbs the drop and prevents the browser from opening the file', async () => {
    const help = await boot();
    const zone = document.getElementById('summary-1');
    let ingested = 0;
    zone.addEventListener('drop', () => { ingested++; });
    const drop = () => {
      const e = new Event('drop', { bubbles: true, cancelable: true });
      zone.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(drop()).toBe(false);
    expect(ingested).toBe(1);
    help.helpToggle();
    expect(drop()).toBe(true);
    expect(ingested).toBe(1);
    help.helpClose();
    drop();
    expect(ingested).toBe(2);
  });
});

describe('the card is a dialog with a name', () => {
  it('is labelled by the title it shows', async () => {
    const help = await boot();
    help.helpToggle();
    document.getElementById('summary-1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const card = document.getElementById('help-card');
    expect(card.getAttribute('role')).toBe('dialog');
    const title = document.getElementById(card.getAttribute('aria-labelledby'));
    expect(title.textContent).toBe('What is waiting');
  });
});

describe('the long-press menu is gated on help', () => {
  it('is registered with helpIsOpen() in its enabled probe', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'js', 'console', 'init.js'), 'utf8');
    expect(src).toMatch(/enabled: \(\) => !burstLinkMode && !helpIsOpen\(\)/);
    expect(src).toMatch(/import \{[^}]*helpIsOpen[^}]*\} from '\.\/help\.js'/);
  });
});
