// @vitest-environment happy-dom
//
// The publish indicator (js/console/chrome.js refreshStageIndicators).
//
// The topbar control used to carry the count itself. As the card system adds
// change types that number only grows more abstract — "17" beside a button in
// the corner furthest from a thumb tells you nothing you can act on — so the
// button became a STATUS LIGHT (lit / unlit) and the number kept the two homes
// where it is actually read: the status strip on desktop, and the tab-bar badge
// on touch, where the tab bar owns publish and there is no strip.
//
// These pin that split, and the one rule the hardware-indicator language puts
// on a new light: it must not become a second SYS lamp.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const { refreshStageIndicators } = await import('../js/console-ui.js');

const SURFACES = ['buffer', 'archive', 'posts', 'wallpapers', 'barrel', 'friends', 'library', 'audio', 'cards'];

// Everything refreshStageIndicators writes, unguarded ids included.
function seedDom() {
  const navCounts = ['buffer', 'archive', 'fn', 'wall', 'barrel', 'friends', 'library', 'audio']
    .map((k) => `<span id="nav-count-${k}"></span>`).join('');
  document.body.innerHTML = `
    <button class="publish-btn publish-btn--idle" id="publish-btn" data-pending="0"><span class="pip" id="publish-pip"></span> Publish</button>
    <div id="topbar-stage-stat"></div>
    <div id="nav-stage-pip"></div>
    <button class="tab-btn" data-view="publish"><span class="tab-badge zero" id="tab-publish-badge">0</span></button>
    ${navCounts}
    <span id="tab-count-buffer"></span><span id="tab-count-fn"></span><span id="tab-count-archive"></span>
    <span id="sheet-count-wall"></span><span id="sheet-count-barrel"></span>
    <span id="sheet-count-friends"></span><span id="sheet-count-library"></span><span id="sheet-count-audio"></span>
  `;
}

const btn = () => document.getElementById('publish-btn');

beforeEach(() => {
  seedDom();
  SURFACES.forEach((s) => { STATE[s] = []; });
  STATE.staged = Object.fromEntries(SURFACES.map((s) => [s, 0]));
  STATE.stagedLog = [];
});

describe('the topbar control is a light, not a counter', () => {
  it('unlit and marked clean when nothing is staged', () => {
    refreshStageIndicators();
    expect(btn().dataset.pending).toBe('0');
    expect(btn().classList.contains('publish-btn--idle')).toBe(true);
    expect(btn().textContent).not.toMatch(/\d/);
    expect(document.getElementById('topbar-stage-stat').textContent).toBe('NO PENDING CHANGES');
  });

  it('lights up when changes are staged — still with no number on it', () => {
    STATE.staged.buffer = 3;
    STATE.staged.audio = 14;
    refreshStageIndicators();

    expect(btn().dataset.pending).toBe('1');
    expect(btn().classList.contains('publish-btn--idle')).toBe(false);
    expect(btn().textContent, 'the count belongs to the strip, not the button').not.toMatch(/\d/);
  });

  it('the count stays readable in the status strip', () => {
    STATE.staged.buffer = 17;
    refreshStageIndicators();
    expect(document.getElementById('topbar-stage-stat').textContent).toBe('17 PENDING');
  });

  it('the iPad tab badge keeps its number — it is the only signal on that band', () => {
    // The topbar (strip included) is hidden at tab-bar widths, so a dot there
    // would leave no count anywhere until the publish page.
    STATE.staged.posts = 4;
    refreshStageIndicators();
    const tab = document.getElementById('tab-publish-badge');
    expect(tab.textContent).toBe('4');
    expect(tab.classList.contains('zero')).toBe(false);
  });

  it('announces the pending state to screen readers, where the number belongs', () => {
    refreshStageIndicators();
    expect(btn().getAttribute('aria-label')).toMatch(/no pending changes/i);
    STATE.staged.barrel = 1;
    refreshStageIndicators();
    expect(btn().getAttribute('aria-label')).toMatch(/1 pending change\b/i);
  });

  it('library never lights the button — it auto-syncs and never publishes', () => {
    STATE.staged.library = 6;
    refreshStageIndicators();
    expect(btn().dataset.pending).toBe('0');
  });
});

describe('the publish control carries light while work is waiting', () => {
  // Owner's call, 2026-09-14 (phase 2 of the lighting pass): "when you have
  // unpublished work sitting there, the PUBLISH button should glow." It was
  // already one of the four states design-spec.md §6.5 licenses to carry light,
  // and the only one of the four with no way to express it — its own indicator
  // is the flat square pip, fenced against glowing since 2026-08-23. data-lit
  // lights the button; the pip stays flat; js/console/lighting.js pools the
  // wide half onto the chassis around it.
  const tab = () => document.querySelector('.tab-btn[data-view="publish"]');

  it('is unlit with nothing staged', () => {
    refreshStageIndicators();
    expect(btn().hasAttribute('data-lit')).toBe(false);
    expect(tab().hasAttribute('data-lit')).toBe(false);
  });

  it('lights BOTH publish controls, because they are one control at two widths', () => {
    // ⚠️ The topbar button is display:none under 1181px AND on any coarse
    // pointer, where the tab bar owns publish instead. Lighting only the topbar
    // ships a feature that does nothing on an iPad. The hidden one measures 0×0
    // and the bloom skips it, so the pair costs nothing at either width.
    STATE.staged.buffer = 2;
    refreshStageIndicators();
    expect(btn().getAttribute('data-lit')).toBe('accent');
    expect(tab().getAttribute('data-lit')).toBe('accent');
  });

  it('puts the light out again when the work is published', () => {
    STATE.staged.buffer = 2;
    refreshStageIndicators();
    STATE.staged.buffer = 0;
    refreshStageIndicators();
    expect(btn().hasAttribute('data-lit')).toBe(false);
    expect(tab().hasAttribute('data-lit')).toBe(false);
  });

  it('survives markup that trails the module', () => {
    // A fork mid-merge can have the module without the tab bar. An unguarded
    // write here throws on boot — the same guard the nav counts already carry.
    tab().remove();
    STATE.staged.posts = 1;
    expect(() => refreshStageIndicators()).not.toThrow();
    expect(btn().getAttribute('data-lit')).toBe('accent');
  });
});

describe('the pip is not a second SYS lamp', () => {
  const css = readFileSync(join(process.cwd(), 'css', 'field-console.css'), 'utf8');
  const pipRule = css.match(/\.publish-btn \.pip \{([\s\S]*?)\}/)[1];

  it('is square, where the lamp LED is rounded and bezelled', () => {
    expect(pipRule).toMatch(/border-radius:\s*0/);
    expect(pipRule, 'no bezel border — that housing belongs to the lamp').not.toMatch(/border:/);
  });

  it('does not glow or animate', () => {
    // "Deboss don't glow" — a glowing, flickering indicator reads as a system
    // state (the lamp's job), not as "you have work to publish".
    expect(pipRule).not.toMatch(/box-shadow:[^;]*rgba/);
    expect(pipRule).not.toMatch(/animation:/);
  });
});

// A control's STATE is a modifier on that control. A block utility is a
// layout for a whole panel. When the two share a bare word, the utility wins
// on whatever property it declares — and nothing warns you, because the rule
// looks authored and the markup looks fine.
//
// This is not hypothetical. `#publish-btn` carried `class="publish-btn empty"`
// from launch until 2026-09-19, while `.empty { padding: 48px 20px }` is the
// block six renderers use for "// ARCHIVE EMPTY". The button computed 112px
// tall inside a 52px top bar and overhung it by ~30px in both directions,
// which put a live Publish click target under the top-right of the content
// area. It hid for months because the same state dims the border to near
// black, so the oversized box never read against a dark console.
describe('no control wears a block utility as its state', () => {
  const SHELL = readFileSync(join(process.cwd(), 'dev/field-console.html'), 'utf8');
  const CSS = readFileSync(join(process.cwd(), 'css/field-console.css'), 'utf8');

  // Bare, unscoped rules — the ones that match on a word alone and so can land
  // on anything that happens to use it.
  const BLOCK_UTILITIES = [...CSS.matchAll(/^\.([a-z][\w-]*)\s*\{/gm)]
    .map((m) => m[1])
    .filter((c) => !c.includes('--'));

  it('found the utilities and the buttons (scanner sanity)', () => {
    expect(BLOCK_UTILITIES).toContain('empty');
    expect(SHELL.match(/<button\b/g).length).toBeGreaterThan(30);
  });

  it.each(['empty', 'hint', 'hint-text', 'filename', 'count'])(
    'keeps the "%s" block off every button in the shell', (utility) => {
      const offenders = [...SHELL.matchAll(/<button\b[^>]*class="([^"]+)"[^>]*>/g)]
        .filter((m) => m[1].split(/\s+/).includes(utility))
        .map((m) => m[0].slice(0, 90));
      expect(offenders, `"${utility}" is a block utility — a button needs its own modifier`)
        .toEqual([]);
    },
  );

  it('gives the publish button a namespaced idle state', () => {
    expect(SHELL).toMatch(/class="publish-btn publish-btn--idle" id="publish-btn"/);
    expect(CSS).toMatch(/^\.publish-btn--idle \{/m);
    expect(CSS, 'the old bare-word modifier is gone').not.toMatch(/\.publish-btn\.empty\b/);
  });
});
