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
    <button class="publish-btn empty" id="publish-btn" data-pending="0"><span class="pip" id="publish-pip"></span> Publish</button>
    <div id="topbar-stage-stat"></div>
    <div id="nav-stage-pip"></div>
    <span class="tab-badge zero" id="tab-publish-badge">0</span>
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
    expect(btn().classList.contains('empty')).toBe(true);
    expect(btn().textContent).not.toMatch(/\d/);
    expect(document.getElementById('topbar-stage-stat').textContent).toBe('NO PENDING CHANGES');
  });

  it('lights up when changes are staged — still with no number on it', () => {
    STATE.staged.buffer = 3;
    STATE.staged.audio = 14;
    refreshStageIndicators();

    expect(btn().dataset.pending).toBe('1');
    expect(btn().classList.contains('empty')).toBe(false);
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
