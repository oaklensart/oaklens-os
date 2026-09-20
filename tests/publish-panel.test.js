// @vitest-environment happy-dom
//
// The publish-page change panel (js/console/publish.js).
//
// A summary card's "+N ▲" used to be the whole story — N gestures, no names.
// Tapping a card with staged changes now expands one shared panel listing that
// surface's ledger rows (STATE.stagedLog): what changed, by name, with a kind
// glyph and a ×n fold count. These pin the panel's contract: the tile→surface
// key bridge (fn→posts etc.), the catch-all row for gestures the ledger has no
// row for, the no-changes no-op, and collapse when the stage clears.
import { describe, it, expect, beforeEach } from 'vitest';

// console-state.js reaches these through the global scope at call time.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
for (const fn of ['renderBuffer', 'renderArchive', 'renderFN', 'fnNewPost',
  'renderWall', 'renderBarrel', 'renderNetwork', 'renderLibrary', 'renderAudio']) {
  globalThis[fn] = () => {};
}
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE, sessionTrash, stageChange, clearStage } = await import('../js/console-state.js');
const { renderPublish, publishToggleChanges, _renderSyncReadout } = await import('../js/console-ui.js');

const SURFACES = ['buffer', 'archive', 'posts', 'wallpapers', 'barrel', 'friends', 'library', 'audio'];
const TILES = ['buffer', 'archive', 'fn', 'wall', 'barrel', 'network', 'audio', 'cards'];

function seedDom() {
  const sumCards = TILES
    .map((k) => `<div class="summary-card" id="sum-${k}"><span id="sum-count-${k}"></span><span id="sum-delta-${k}"></span></div>`)
    .join('');
  document.body.innerHTML = `
    <div id="toast-host"></div>
    ${sumCards}<span id="sum-count-library"></span>
    <div id="publish-changes-panel" style="display:none;"></div>
  `;
}

const panel = () => document.getElementById('publish-changes-panel');

beforeEach(() => {
  seedDom();
  localStorage.clear();
  SURFACES.forEach((s) => { STATE[s] = []; });
  STATE.staged = Object.fromEntries(SURFACES.map((s) => [s, 0]));
  STATE.stagedLog = [];
  sessionTrash.length = 0;
  // Collapse any panel state left over from a previous test.
  renderPublish();
  publishToggleChanges('buffer');   // no changes staged → guaranteed no-op
});

describe('publishToggleChanges', () => {
  it('expands a card with staged changes and lists its rows by name', () => {
    stageChange('buffer', { id: 'f1', label: 'f#241 — focal point' });
    stageChange('buffer', { id: 'f1', label: 'f#241 — card crop' });
    stageChange('buffer', { ids: ['f2', 'f1'], label: 'RAW card: f#242 ← f#241', kind: 'feature' });
    renderPublish();

    publishToggleChanges('buffer');
    expect(panel().style.display).toBe('block');
    expect(panel().textContent).toContain('RAW card: f#242 ← f#241');
    expect(panel().textContent).toContain('f#241 — card crop');
    expect(panel().textContent, 'two gestures folded into one row').toContain('×2');
    expect(document.getElementById('sum-buffer').classList.contains('changes-open')).toBe(true);
  });

  it('bridges the legacy tile keys to STATE surfaces (fn→posts)', () => {
    stageChange('posts', { id: 'p1', label: 'FN-021: Last Light — hero layout' });
    renderPublish();
    publishToggleChanges('fn');
    expect(panel().style.display).toBe('block');
    expect(panel().textContent).toContain('Last Light');
  });

  it('a card with nothing staged does not expand', () => {
    renderPublish();
    publishToggleChanges('archive');
    expect(panel().style.display).toBe('none');
  });

  it('tapping the open card again collapses the panel', () => {
    stageChange('audio', { id: 't1', label: 'Track — details edited' });
    renderPublish();
    publishToggleChanges('audio');
    expect(panel().style.display).toBe('block');
    publishToggleChanges('audio');
    expect(panel().style.display).toBe('none');
    expect(document.querySelector('.changes-open')).toBeNull();
  });

  it('switching cards swaps the list in place', () => {
    stageChange('buffer', { id: 'f1', label: 'f#1 — focal point' });
    stageChange('barrel', { id: 'b1', label: 'Show announcement — new' });
    renderPublish();
    publishToggleChanges('buffer');
    publishToggleChanges('barrel');
    expect(panel().textContent).toContain('Show announcement');
    expect(panel().textContent).not.toContain('focal point');
  });

  it('escapes labels — a title is text, never markup', () => {
    stageChange('barrel', { id: 'b1', label: '<img src=x onerror=alert(1)> — new' });
    renderPublish();
    publishToggleChanges('barrel');
    expect(panel().innerHTML).not.toContain('<img');
    expect(panel().textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('the catch-all row — counters stay authoritative', () => {
  it('gestures without ledger rows show as "+N other changes"', () => {
    stageChange('wallpapers', { id: 'w1', label: 'Dusk — focal point' });
    // Two legacy-shaped gestures: counted, but no row (id-less).
    stageChange('wallpapers', {});
    stageChange('wallpapers', {});
    renderPublish();

    publishToggleChanges('wall');
    expect(panel().textContent).toContain('Dusk — focal point');
    expect(panel().textContent).toContain('+2 other changes');
  });

  it('clamps at zero — folded gestures never go negative', () => {
    stageChange('archive', { id: 'a1', label: 'Entry — updated' });
    stageChange('archive', { id: 'a1', label: 'Entry — updated' });
    renderPublish();
    publishToggleChanges('archive');
    expect(panel().textContent).not.toContain('other change');
  });
});

describe('collapse on clear', () => {
  it('publishing (clearStage + renderPublish) closes the panel', () => {
    stageChange('buffer', { id: 'f1', label: 'f#1 — focal point' });
    renderPublish();
    publishToggleChanges('buffer');
    expect(panel().style.display).toBe('block');

    clearStage();       // what publishToServer and Clear Staged both run
    renderPublish();
    expect(panel().style.display).toBe('none');
    expect(document.querySelector('.changes-open')).toBeNull();
  });
});


// ============================================================================
// THE SYNC READOUT
//
// What a sync brought back used to be one dot-joined sentence assigned to
// textContent — `✓ synced 4:41:31 PM · buffer:716 · archive:93 · …` for twelve
// surfaces — which wraps wherever the panel ends, so no surface sits under the
// one above it and reading "how many cards" means scanning a paragraph. It is
// a grid now: the verdict on its own line, one cell per surface, name and
// number in columns that line up because they ARE columns.
// ============================================================================
describe('the sync readout', () => {
  const host = () => document.getElementById('sync-status');
  const seed = () => { document.body.innerHTML = '<div id="sync-status"></div>'; };

  it('puts the verdict on its own line and one cell per surface', () => {
    seed();
    _renderSyncReadout(host(), '✓ synced 4:41:31 PM',
      [['buffer', '716'], ['archive', '93'], ['cards', '11']]);
    expect(host().querySelector('.sync-readout-head').textContent)
      .toBe('✓ synced 4:41:31 PM');
    const cells = host().querySelectorAll('.sync-readout-cell');
    expect(cells).toHaveLength(3);
    expect([...cells].map((c) => c.querySelector('.sync-readout-k').textContent))
      .toEqual(['buffer', 'archive', 'cards']);
    expect([...cells].map((c) => c.querySelector('.sync-readout-v').textContent))
      .toEqual(['716', '93', '11']);
  });

  it('still reads as one sentence to textContent and to a screen reader', () => {
    // tests/sync-skip.test.js asserts on this element's textContent, and a
    // screen reader walks the same tree. The SHAPE changed; the facts did not.
    seed();
    _renderSyncReadout(host(), '✓ up to date (29aa99c)', [['posts', '12']]);
    expect(host().textContent).toContain('up to date (29aa99c)');
    expect(host().textContent).toContain('posts');
    expect(host().textContent).toContain('12');
  });

  it('rebuilds, so a second sync does not stack on the first', () => {
    seed();
    _renderSyncReadout(host(), 'first', [['buffer', '1'], ['archive', '2']]);
    _renderSyncReadout(host(), 'second', [['buffer', '9']]);
    expect(host().querySelectorAll('.sync-readout-head')).toHaveLength(1);
    expect(host().querySelectorAll('.sync-readout-cell')).toHaveLength(1);
    expect(host().textContent).not.toContain('first');
  });

  it('writes text, never markup — a surface name is data', () => {
    // The names come back from the worker. They are set with textContent so a
    // crafted one is a string on screen, not a node in the document.
    seed();
    _renderSyncReadout(host(), 'ok', [['<img src=x onerror=alert(1)>', '1']]);
    expect(host().querySelector('img')).toBeNull();
    expect(host().querySelector('.sync-readout-k').textContent)
      .toBe('<img src=x onerror=alert(1)>');
  });

  it('survives a verdict with nothing to list, and a missing host', () => {
    seed();
    _renderSyncReadout(host(), '✓ up to date (29aa99c)', []);
    expect(host().querySelector('.sync-readout-grid')).toBeNull();
    expect(host().textContent).toContain('up to date');
    expect(() => _renderSyncReadout(null, 'x', [['a', '1']])).not.toThrow();
  });
});
