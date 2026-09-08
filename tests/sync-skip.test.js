// @vitest-environment happy-dom
//
// The post-publish revert, closed on the console side (js/console/publish.js).
//
// The failure this pins (2026-08-23 maintenance log): publishToServer used to
// schedule syncFromServer 2.5s after a successful commit, and syncFromServer
// imported whatever came back — through importIntoSurface, which replaces every
// _imported entry with the remote copy. GitHub's contents API is eventually
// consistent, so that sync could still serve the PREVIOUS commit and quietly
// revert the publish (and any focal/pin edits made since). The console showed
// "✓ Published!", the counters stayed lit, and the author had to redo the
// settings and publish twice.
//
// The fix has two halves, both here:
//  · publishToServer schedules no follow-up sync at all — after a successful
//    commit, local state IS the snapshot at data.sha (source-shape pins).
//  · syncFromServer skips the import pass whenever the response's headSha
//    matches the last fully-imported revision (_lastImportedSha) — main has
//    nothing we don't already hold, and a redundant import is exactly where
//    local edits used to get eaten.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Renderers repaint the whole console after an import — real DOM they need is
// half the shell, and none of it is what these tests observe. Stub the paint,
// keep everything else in each module real.
vi.mock('../js/console/chrome.js', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshStageIndicators: () => {},
  toast: () => {},
}));
vi.mock('../js/console/buffer.js', async (importOriginal) => ({
  ...(await importOriginal()), renderBuffer: () => {},
}));
vi.mock('../js/console/archive.js', async (importOriginal) => ({
  ...(await importOriginal()), renderArchive: () => {},
}));
vi.mock('../js/console/fn-editor.js', async (importOriginal) => ({
  ...(await importOriginal()), renderFN: () => {},
}));
vi.mock('../js/console/more-views.js', async (importOriginal) => ({
  ...(await importOriginal()),
  renderWall: () => {}, renderBarrel: () => {}, renderNetwork: () => {}, renderLibrary: () => {},
}));
vi.mock('../js/console/audio.js', async (importOriginal) => ({
  ...(await importOriginal()), renderAudio: () => {},
}));

// console-state.js reaches these through the global scope at call time.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};

const { STATE, sessionTrash } = await import('../js/console-state.js');
const { syncFromServer, _setLastImportedSha, _getLastImportedSha } =
  await import('../js/console-ui.js');

const SURFACES = ['buffer', 'archive', 'posts', 'wallpapers', 'barrel', 'friends', 'library', 'audio', 'cards'];
const FILES = SURFACES.map((s) => `data/${s}.json`);

// isLoggedIn() only parses the JWT payload for exp — no signature check client-side.
function loginForTest() {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  sessionStorage.setItem('oaklens_session', `h.${payload}.s`);
}

// A /api/sync answer: every surface reads ok. `contentBySurface` overrides
// individual manifests; `fail` marks surfaces as unreadable.
function syncResponse(headSha, { contentBySurface = {}, fail = [] } = {}) {
  const files = {};
  for (const s of SURFACES) {
    files[`data/${s}.json`] = fail.includes(s)
      ? { ok: false, error: 'boom' }
      : { ok: true, content: contentBySurface[s] || [] };
  }
  return { ok: true, files, headSha, repo: 'owner/repo' };
}

function stubFetch(syncBody) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/api/sync')) return new Response(JSON.stringify(syncBody), { status: 200 });
    if (u.includes('/api/drafts')) return new Response(JSON.stringify({ ok: true, drafts: [] }), { status: 200 });
    throw new Error(`unexpected fetch: ${u}`);
  });
}

// renderPublish() runs on the import path and getElementById's these unguarded.
function seedDom() {
  const sumCards = ['buffer', 'archive', 'fn', 'wall', 'barrel', 'network', 'audio', 'cards']
    .map((k) => `<div id="sum-${k}"><span id="sum-count-${k}"></span><span id="sum-delta-${k}"></span></div>`)
    .join('');
  document.body.innerHTML = `
    <div id="toast-host"></div><div id="sync-status"></div>
    ${sumCards}<span id="sum-count-library"></span>
  `;
}

beforeEach(() => {
  vi.restoreAllMocks();
  seedDom();
  loginForTest();
  SURFACES.forEach((s) => { STATE[s] = []; });
  STATE.staged = Object.fromEntries(SURFACES.map((s) => [s, 0]));
  sessionTrash.length = 0;
  _setLastImportedSha(null);
});

describe('syncFromServer — the sha-gated import skip', () => {
  it('skips the import pass when main is the revision this session already holds', async () => {
    // The exact post-publish shape: our marker is S1, GitHub's ref answers S1 —
    // but the (eventually-consistent) content it returns is stale/empty. The
    // old code imported it and wiped the local entries.
    _setLastImportedSha('S1');
    STATE.buffer = [{ id: 'f1', filename: 'x.webp', focus: '30% 40%', featured: true, _imported: true }];
    stubFetch(syncResponse('S1', { contentBySurface: { buffer: [{ id: 'f1', filename: 'x.webp' }] } }));

    await syncFromServer();

    expect(STATE.buffer).toHaveLength(1);
    expect(STATE.buffer[0].focus, 'the local edit must survive an up-to-date sync').toBe('30% 40%');
    expect(STATE.buffer[0].featured).toBe(true);
    expect(document.getElementById('sync-status').textContent).toMatch(/up to date/);
  });

  it('still imports when main has genuinely moved', async () => {
    _setLastImportedSha('S1');
    STATE.buffer = [{ id: 'f1', filename: 'x.webp', _imported: true }];
    stubFetch(syncResponse('S2', {
      contentBySurface: { buffer: [{ id: 'f1', filename: 'x.webp' }, { id: 'f2', filename: 'y.webp' }] },
    }));

    await syncFromServer();

    expect(STATE.buffer.map((e) => e.id).sort()).toEqual(['f1', 'f2']);
    expect(_getLastImportedSha(), 'a fully-imported snapshot advances the marker').toBe('S2');
  });

  it('a partial import does not vouch for the revision', async () => {
    // One unreadable surface means we hold a mixed snapshot — the next sync
    // must run the import pass again, so the marker stays cleared.
    stubFetch(syncResponse('S3', { fail: ['audio'] }));
    await syncFromServer();
    expect(_getLastImportedSha()).toBeNull();
  });

  it('never skips on a fresh page load, even against the same revision', async () => {
    // _lastImportedSha is deliberately in-memory: a reloaded console starts at
    // null and must hydrate from its first sync no matter what sha main is at.
    STATE.buffer = [];
    stubFetch(syncResponse('S1', { contentBySurface: { buffer: [{ id: 'f1', filename: 'x.webp' }] } }));
    await syncFromServer();
    expect(STATE.buffer).toHaveLength(1);
  });
});

describe('publishToServer — no follow-up sync, marker advanced (source shape)', () => {
  const src = readFileSync(join(process.cwd(), 'js/console/publish.js'), 'utf8');

  it('schedules no deferred sync anywhere in the module', () => {
    // The +2.5s post-publish sync was the revert vector. A deferred sync has
    // no legitimate caller in this module: reconnect resume and the 409
    // recovery both sync inline and deliberately.
    expect(src).not.toMatch(/setTimeout\(\s*syncFromServer/);
  });

  it('stamps the just-committed sha as the imported baseline', () => {
    expect(src).toMatch(/_lastImportedSha = data\.sha/);
  });
});
