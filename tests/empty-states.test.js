// @vitest-environment happy-dom
//
// Every fork starts with no content, and every instance returns to that state
// the moment its data is cleared. Before this, three of the four public
// surfaces rendered a *blank page* in that situation:
//
//   - archive    -> zero cards, and a count line reading "0 FRAMES · "
//                   (trailing separator, because the camera list was empty)
//   - field notes-> zero entries, "0 FIELD NOTES"
//   - wall       -> silently fell through to the bundled CC0 samples, so
//                   deleting your wallpapers made *other photos* appear in
//                   their place — indistinguishable from a failed delete
//   - buffer     -> handled it correctly; it is the idiom the others adopted
//
// So these run each page module against its real markup with the data file
// answering `[]`, and assert the surface says so out loud. Source-text
// matching would not have caught the wall case, because the guard it was
// missing was a *branch*, not a string.
//
// The second describe block pins the other half of the contract: a data file
// that is missing entirely (an un-seeded fork) still falls back to sample
// content, so a fresh clone looks like a photography site rather than a bug.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The four public surfaces that render a list from a data file, with the
// element the empty state lands in and the phrase it must show.
const SURFACES = [
  { name: 'archive',     page: 'archive/index.html',        mod: 'js/page-archive.js', data: '/data/archive.json',    holder: 'archive-grid', says: 'ARCHIVE EMPTY' },
  { name: 'buffer',      page: 'archive/buffer/index.html', mod: 'js/page-buffer.js',  data: '/data/buffer.json',     holder: 'binder',       says: 'BUFFER EMPTY' },
  { name: 'wall',        page: 'wall/index.html',           mod: 'js/page-wall.js',    data: '/data/wallpapers.json', holder: 'wall-grid',    says: 'NO WALLPAPERS YET' },
  { name: 'field notes', page: 'field-notes/index.html',    mod: 'js/page-fn-list.js', data: '/data/posts.json',      holder: 'fn-list',      says: 'NO FIELD NOTES YET' },
];

/**
 * Load a page's real body markup, stub the globals site-common.js and
 * lighttable.js would have defined, and run the page module against it.
 *
 * `respond` decides what the data fetch does, which is the whole variable
 * under test: `[]` for cleared content, a 404 for an un-seeded fork.
 */
async function renderSurface({ page, mod }, respond) {
  const html = read(page);
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');

  globalThis.fetch = async (url) => respond(String(url));

  // Provided by site-common.js on the real page; none of them are reached on
  // the empty path, but the module bodies close over them.
  const w = globalThis;
  w.cdnRoot = () => '/api/cdn';
  w.cdnUrl = (section, file, size) => `/api/cdn/${section}/${file}-${size}w.webp`;
  w.cdnSrcsetFor = () => '';
  w.cdnImgError = () => {};
  w.CDN_PLACEHOLDER = '';
  w.onViewportSettle = () => {};
  w.initMobileNav = () => {};
  w.submitGTD = () => {};
  w.initViewportReflow = () => {};
  w.setVhVar = () => {};
  w.escapeHtml = (v) => (v == null ? '' : String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  // lighttable.js — the buffer's numbering/grouping helpers.
  w.LightTable = {
    assignFrameNumbers: () => new Map(),
    groupByDay: () => ({ days: [], byDay: new Map() }),
  };

  const src = read(mod);
  // Classic scripts, not ES modules: indirect eval runs them in global scope
  // exactly as a <script> tag would, so their top-level `const`s resolve.
  (0, eval)(src);

  // The loaders are async and self-invoked; let their promise chain settle.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const emptyJson = () =>
  new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response('not found', { status: 404 });

describe('a surface whose data file is empty says so', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { delete globalThis.fetch; });

  it.each(SURFACES.map((s) => [s.name, s]))('%s', async (_name, surface) => {
    await renderSurface(surface, (url) =>
      url.includes(surface.data) ? emptyJson() : emptyJson());

    const holder = document.getElementById(surface.holder);
    expect(holder, `#${surface.holder} is missing from ${surface.page}`).toBeTruthy();

    const empty = holder.querySelector('.page-empty');
    expect(empty, `${surface.name} rendered nothing at all on empty data`).toBeTruthy();
    expect(empty.textContent).toContain(surface.says);

    // The state is useless if it does not say what to do next.
    expect(empty.querySelector('.page-empty-hint')).toBeTruthy();

    // And nothing else: no cards, no rows, no samples smuggled in.
    expect(holder.children.length).toBe(1);
  });
});

describe('the empty state is one shared idiom, not four', () => {
  it('every surface uses .page-empty from main.css', () => {
    const css = read('css/main.css');
    expect(css).toMatch(/^\.page-empty\s*\{/m);
    expect(css).toMatch(/^\.page-empty-hint\s*\{/m);

    for (const s of SURFACES) {
      expect(read(s.mod), `${s.mod} should use the shared class`).toContain('page-empty');
    }
  });

  it('no surface keeps a private copy of the empty-state styles', () => {
    // The buffer had its own `.buffer-empty` block before this consolidation.
    for (const s of SURFACES) {
      expect(read(s.page)).not.toMatch(/^\.\w[\w-]*-empty\s*\{/m);
    }
  });
});

describe('a surface with no data file at all still shows sample content', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { delete globalThis.fetch; });

  // The buffer is deliberately excluded: it has no sample set, so a missing
  // file and an empty one are the same state and both read as empty.
  const SEEDED = SURFACES.filter((s) => s.name !== 'buffer');

  it.each(SEEDED.map((s) => [s.name, s]))('%s falls back to samples', async (_name, surface) => {
    await renderSurface(surface, () => notFound());

    const holder = document.getElementById(surface.holder);
    expect(holder.querySelector('.page-empty'),
      `${surface.name} showed an empty state for a *missing* file — an un-seeded fork should see samples`).toBeFalsy();
    expect(holder.children.length).toBeGreaterThan(0);
  });
});

// The server-rendered sibling of the block above, and the one that was wrong.
//
// /archive/manifest.html is built by the Worker, not a page module, and it read
// data/archive.json with a bare env.ASSETS.fetch that collapsed every failure
// into 500 — including the 404 an un-seeded fork legitimately produces, because
// os-extract's DATA_OMITTED deliberately ships forks without that file. And
// /sitemap.xml advertises the page. So a brand-new fork handed crawlers a
// server error from day one, invisible on any seeded instance (2026-08-23).
describe('the crawlable archive manifest on an un-seeded fork', () => {
  let _savedCaches;
  beforeEach(() => {
    // loadDataJson reads through caches.default — give it a cold one.
    _savedCaches = globalThis.caches;
    globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
  });
  afterEach(() => { globalThis.caches = _savedCaches; });

  const ctx = { waitUntil() {} };
  const req = () => new Request('https://example.com/archive/manifest.html');
  const envWith = (respond) => ({
    SESSION_SECRET: 'test-secret-please-ignore',
    SUBSCRIBERS: { get: async () => null, put: async () => {} },
    ASSETS: { fetch: async () => respond() },
  });

  it('serves an empty manifest, not a 500, when archive.json is absent', async () => {
    const { default: worker } = await import('../worker.js');
    const res = await worker.fetch(req(), envWith(() => new Response('nope', { status: 404 })), ctx);

    expect(res.status, 'an un-seeded fork must not answer crawlers with a server error').toBe(200);
    const html = await res.text();
    expect(html).toContain('<html');
    expect(html, 'a real page, just with nothing in it yet').not.toContain('Internal Server Error');
  });

  it('still answers 500 when the read genuinely fails', async () => {
    // The distinction that matters: an empty manifest served during an outage
    // would tell the Wayback Machine this archive is empty, and that snapshot
    // is the thing we cannot take back.
    const { default: worker } = await import('../worker.js');
    const res = await worker.fetch(req(), envWith(() => new Response('boom', { status: 500 })), ctx);
    expect(res.status).toBe(500);
  });

  it('renders entries normally when the file is there', async () => {
    const { default: worker } = await import('../worker.js');
    const entry = { slug: 'evening-light', filename: 'OAKLENS_Evening.webp', title: 'Evening Light', added_at: '2026-08-01T00:00:00Z' };
    const res = await worker.fetch(req(), envWith(
      () => new Response(JSON.stringify([entry]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    ), ctx);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Evening Light');
  });
});
