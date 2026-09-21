// site-export-core.js — the site-in-a-ZIP exporter's pure engine.
// Unit tests hit the mapping/rewriting/harvesting functions with synthetic
// references; the integration tests run the real repo pages and data files
// through the same pipeline the console uses, with the worker's edge chrome
// simulated (cdn-base meta + injected nav), and assert the saved HTML holds
// no origin-dependent references the offline runtime can't cover.
import { describe, it, expect } from 'vitest';
import { HAS_CONTENT } from './helpers/instance-content.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  relPrefix,
  buildRoutes,
  mapReference,
  rewriteCssText,
  rewriteHtml,
  inlineCssFonts,
  stripEsmExports,
  injectOfflineRuntime,
  harvestCdnKeys,
  tierForKey,
  expandImageRules,
  mergeKeyTiers,
  zipPathForKey,
  buildOfflineDataJs,
  buildOfflineShimJs,
  buildReadme,
  buildExportReport,
} from '../js/site-export-core.js';
import { EXPORT_MANIFEST } from '../js/export-manifest.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const ROUTES = buildRoutes(EXPORT_MANIFEST.pages);
const CDN_BASES = ['https://cdn.example.com', 'https://example.com/api/cdn', '/api/cdn'];
const ctxAt = (file) => ({ prefix: relPrefix(file), routes: ROUTES, cdnBases: CDN_BASES });

describe('relPrefix / buildRoutes', () => {
  it('computes the climb back to the zip root from a page depth', () => {
    expect(relPrefix('index.html')).toBe('');
    expect(relPrefix('archive/index.html')).toBe('../');
    expect(relPrefix('archive/buffer/index.html')).toBe('../../');
  });

  it('maps manifest routes to files, root included', () => {
    expect(ROUTES['/']).toBe('index.html');
    expect(ROUTES['/archive']).toBe('archive/index.html');
    // Canonical extensionless post route + its .html alias (old shared links)
    // both resolve to the same saved file.
    expect(ROUTES['/field-notes/post']).toBe('field-notes/post.html');
    expect(ROUTES['/field-notes/post.html']).toBe('field-notes/post.html');
  });

  it('fetches each page exactly once (aliases add routes, not fetches)', () => {
    const files = EXPORT_MANIFEST.pages.map((p) => p.file);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe('mapReference', () => {
  const ctx = ctxAt('archive/index.html');

  it('maps every CDN spelling into cdn/ and harvests the key', () => {
    for (const ref of [
      '/api/cdn/archive/x-480w.webp',
      'https://example.com/api/cdn/archive/x-480w.webp',
      'https://cdn.example.com/archive/x-480w.webp',
    ]) {
      expect(mapReference(ref, ctx)).toEqual({
        out: '../cdn/archive/x-480w.webp',
        cdnKey: 'archive/x-480w.webp',
      });
    }
  });

  it('maps a bare CDN base (the cdn-base meta) with no key to harvest', () => {
    expect(mapReference('https://cdn.example.com', ctx)).toEqual({ out: '../cdn', cdnKey: null });
  });

  it('maps routes and keeps their query (post?slug= means something)', () => {
    expect(mapReference('/field-notes/post?slug=fn-010', ctx).out)
      .toBe('../field-notes/post.html?slug=fn-010');
    // The .html alias (old shared links baked into saved content) still maps
    // with its query intact.
    expect(mapReference('/field-notes/post.html?slug=fn-010', ctx).out)
      .toBe('../field-notes/post.html?slug=fn-010');
    expect(mapReference('/archive/', ctx).out).toBe('../archive/index.html');
    expect(mapReference('/', ctx).out).toBe('../index.html');
  });

  it('maps plain files and sheds their cache-buster query', () => {
    expect(mapReference('/js/lighttable.js?v=1', ctx).out).toBe('../js/lighttable.js');
    expect(mapReference('css/main.css?v=11', ctx).out).toBe('css/main.css');
  });

  it('keeps a same-page hash on a mapped reference', () => {
    expect(mapReference('/about#network', ctx).out).toBe('../about/index.html#network');
  });

  it('leaves what the export cannot or should not carry', () => {
    expect(mapReference('/dev', ctx)).toBeNull(); // extensionless non-route
    expect(mapReference('//cdn.example/x.webp', ctx)).toBeNull(); // protocol-relative
    expect(mapReference('https://bsky.app/profile/x', ctx)).toBeNull();
    expect(mapReference('mailto:you@example.com', ctx)).toBeNull();
    expect(mapReference('#lightbox', ctx)).toBeNull();
    expect(mapReference('post.html?slug=fn-001', ctx)).toBeNull(); // relative route keeps query
  });
});

describe('rewriteHtml', () => {
  const ctx = ctxAt('index.html');

  it('rewrites href/src/poster/content in both quote styles and harvests', () => {
    const { html, cdnKeys } = rewriteHtml(
      `<a href="/archive">a</a><img src='/api/cdn/homepage/h-1024w.webp'>` +
      `<video poster="/api/cdn/blog/p.webp"></video>` +
      `<meta property="og:image" content="https://example.com/api/cdn/meta/x-og.webp">`,
      ctx
    );
    expect(html).toContain('href="archive/index.html"');
    expect(html).toContain(`src='cdn/homepage/h-1024w.webp'`);
    expect(html).toContain('poster="cdn/blog/p.webp"');
    expect(html).toContain('content="cdn/meta/x-og.webp"');
    expect([...cdnKeys].sort()).toEqual([
      'blog/p.webp', 'homepage/h-1024w.webp', 'meta/x-og.webp',
    ]);
  });

  it('rewrites the edge-injected cdn-base meta to the relative cdn root', () => {
    const ctx2 = ctxAt('field-notes/post.html');
    const { html } = rewriteHtml('<meta name="cdn-base" content="https://cdn.example.com">', ctx2);
    expect(html).toContain('content="../cdn"');
  });

  it('rewrites srcset entries and inline style url()', () => {
    const { html, cdnKeys } = rewriteHtml(
      `<img srcset="/api/cdn/archive/a-480w.webp 480w, /api/cdn/archive/a-1024w.webp 1024w">` +
      `<div style="background-image: url('/api/cdn/homepage/bg-1024w.webp');"></div>`,
      ctx
    );
    expect(html).toContain('srcset="cdn/archive/a-480w.webp 480w, cdn/archive/a-1024w.webp 1024w"');
    expect(html).toContain(`url('cdn/homepage/bg-1024w.webp')`);
    expect(cdnKeys.size).toBe(3);
  });

  it('never touches string literals inside inline scripts', () => {
    const script = `<script>const res = await fetch('/data/archive.json'); a.href = "/archive";</script>`;
    expect(rewriteHtml(script, ctx).html).toBe(script);
  });
});

describe('vendor + font handling', () => {
  it('maps a vendored third-party script URL to its local mirror', () => {
    const ctx = {
      ...ctxAt('field-notes/post.html'),
      vendors: { 'https://cdn.jsdelivr.net/npm/marked/marked.min.js': 'js/vendor/marked.min.js' },
    };
    const { html } = rewriteHtml(
      '<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>', ctx);
    expect(html).toContain('src="../js/vendor/marked.min.js"');
  });

  it('inlines font url()s as data: URIs, leaving misses untouched', async () => {
    const css = "@font-face { src: url('../fonts/a.woff2') format('woff2'); }\n" +
      "@font-face { src: url('../fonts/missing.woff2'); }\n" +
      ".x { background: url('../cdn/homepage/pic.webp'); }";
    const out = await inlineCssFonts(css, async (ref) =>
      ref.endsWith('a.woff2') ? 'data:font/woff2;base64,AAAA' : null);
    expect(out).toContain("url('data:font/woff2;base64,AAAA')");
    expect(out).toContain("url('../fonts/missing.woff2')");
    expect(out).toContain("url('../cdn/homepage/pic.webp')"); // non-font untouched
  });

  it('strips font preloads (CORS-blocked on file://; faces are inlined)', () => {
    const out = injectOfflineRuntime(
      '<head><link rel="preload" href="/fonts/a.woff2" as="font" type="font/woff2" crossorigin>\n<meta charset="utf-8"></head>', '');
    expect(out).not.toContain('as="font"');
    expect(out).toContain('<meta charset="utf-8">');
  });

  it('classicizes a dependency-free ES module for file://', () => {
    const src = stripEsmExports('export const A = 1;\nexport function f() { return A; }\nexport async function g() {}\nconst inner = 2;');
    expect(src).toBe('const A = 1;\nfunction f() { return A; }\nasync function g() {}\nconst inner = 2;');
    expect(() => new Function(src)).not.toThrow();
    expect(() => stripEsmExports("import x from './y.js';")).toThrow(/dependency-free/);
  });

  it('classicizes the real markdown engine into working globals', () => {
    const src = stripEsmExports(read('js/markdown-engine.js'));
    const sandbox = {};
    new Function(src + '\nthis.renderMarkdown = renderMarkdown;').call(sandbox);
    expect(sandbox.renderMarkdown('**b**')).toContain('<strong>b</strong>');
  });

  it('injects classicized modules between data island and shim', () => {
    const out = injectOfflineRuntime('<head></head>', '../', ['offline/markdown-engine.js']);
    const order = ['site-data.js', 'markdown-engine.js', 'offline-shim.js'].map((f) => out.indexOf(f));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(out).toContain('src="../offline/markdown-engine.js"');
  });
});

describe('injectOfflineRuntime', () => {
  it('lands the runtime first in <head>, before any page script', () => {
    const out = injectOfflineRuntime(
      '<html><head>\n<meta charset="utf-8">\n<script src="/js/lighttable.js"></script></head></html>',
      '../'
    );
    const data = out.indexOf('offline/site-data.js');
    const shim = out.indexOf('offline/offline-shim.js');
    expect(data).toBeGreaterThan(-1);
    expect(data).toBeLessThan(shim);
    expect(shim).toBeLessThan(out.indexOf('lighttable'));
    expect(out).toContain('src="../offline/site-data.js"');
  });
});

describe('harvest + expansion + tiers', () => {
  it('harvests CDN media refs out of free text', () => {
    const keys = harvestCdnKeys(
      'x src="/api/cdn/blog/clip.mp4" y https://cdn.example.com/archive/f-480w.webp z',
      CDN_BASES
    );
    expect([...keys].sort()).toEqual(['archive/f-480w.webp', 'blog/clip.mp4']);
  });

  it('tiers videos apart from images', () => {
    expect(tierForKey('blog/clip.mp4')).toBe('video');
    expect(tierForKey('archive/f-480w.webp')).toBe('web');
  });

  it('dark frames contribute no media keys (their R2 objects are gone by design)', () => {
    const keys = expandImageRules(
      {
        'data/buffer.json': [
          { id: 'live', filename: 'alive.webp' },
          { id: 'gone', filename: 'retired.webp', dark: true, darked_at: 'x' },
        ],
      },
      EXPORT_MANIFEST.imageRules
    );
    const names = keys.map((k) => k.key);
    expect(names).toContain('archive/alive-480w.webp');
    expect(names.some((k) => k.includes('retired'))).toBe(false);
  });

  it('expands manifest rules: frames to 3 variants, wallpapers + originals', () => {
    const keys = expandImageRules(
      {
        'data/archive.json': [{ filename: 'shot one.webp' }],
        'data/wallpapers.json': [
          { filename: 'w.webp', fullres: 'w.png' },
          { filename: 'old.webp', fullres: null },
        ],
      },
      EXPORT_MANIFEST.imageRules
    );
    const byKey = Object.fromEntries(keys.map((k) => [k.key, k.tier]));
    expect(byKey['archive/shot%20one-480w.webp']).toBe('web');
    expect(byKey['archive/shot%20one-2048w.webp']).toBe('hires');
    expect(byKey['wallpaper/w-1024w.webp']).toBe('web');
    expect(byKey['wallpaper/full/w.png']).toBe('full'); // fullres keeps its extension
    expect(byKey['wallpaper/full/old.jpg']).toBe('full'); // pre-fullres assumes .jpg
  });

  it('a field-note hero travels at the tier the homepage hero card asks for', () => {
    // The picture-led field-note card (js/recent-index.js textHeroCard) builds
    // its background at 1024w through frameSrc(), so an exported tree that
    // carries the note but not that object renders a blank tile from file://.
    // posts.json heroes ride the archive/ prefix, same as a frame.
    const keys = expandImageRules(
      { 'data/posts.json': [{ fn_id: 'fn-001', hero: 'note hero.webp', card: { layout: 'hero' } }] },
      EXPORT_MANIFEST.imageRules
    );
    const byKey = Object.fromEntries(keys.map((k) => [k.key, k.tier]));
    expect(byKey['archive/note%20hero-1024w.webp']).toBe('web');
  });

  it('an overlay card needs nothing the picture card did not already carry', () => {
    // THE OVERLAY LAYOUT ADDS NO ASSET AND NO FETCH (docs/cards-core-complete.md
    // chunk 3). That is the whole reason its legibility decision is measured in
    // the console and stored on the record: the exported tree runs from file://
    // with no network, so a card that sampled its own picture at render time
    // would be a blank band there and a correct card everywhere else.
    //
    // So the only thing the export owes it is the same 1024w object the plain
    // picture card already asks for — and `img.lum` travels inside
    // data/cards.json as a number, costing nothing.
    const card = {
      id: 'c-ov', order: 1, media: 'over water.webp', kind: 'photo',
      card: { layout: 'overlay' },
      overlay: { place: 'top', treat: 'blur', blur: 2 },
      img: { lum: { top: 0.42, mid: 0.61, bottom: 0.18 } },
    };
    const withOverlay = expandImageRules({ 'data/cards.json': [card] }, EXPORT_MANIFEST.imageRules);
    const plain = { ...card };
    delete plain.card; delete plain.overlay; delete plain.img;
    const without = expandImageRules({ 'data/cards.json': [plain] }, EXPORT_MANIFEST.imageRules);
    expect(withOverlay).toEqual(without);
    expect(withOverlay.map((k) => k.key)).toContain('archive/over%20water-1024w.webp');
  });

  it('merges duplicates keeping the most essential tier', () => {
    const merged = mergeKeyTiers([
      { key: 'archive/a-2048w.webp', tier: 'hires' },
      { key: 'archive/a-2048w.webp', tier: 'web' }, // directly referenced too
    ]);
    expect(merged.get('archive/a-2048w.webp')).toBe('web');
  });

  it('stores decoded object names on disk so encoded srcs resolve', () => {
    expect(zipPathForKey('homepage/Slanted%2Blight-1024w.webp')).toBe('cdn/homepage/Slanted+light-1024w.webp');
  });
});

describe('generated offline runtime', () => {
  it('data island is valid JS and cannot break out of its script tag', () => {
    const src = buildOfflineDataJs({
      files: { 'posts/fn-000.md': 'body with </script><script>alert(1)' },
      api: {},
    });
    expect(src).not.toContain('</script');
    expect(() => new Function(src)).not.toThrow();
  });

  it('shim is valid classic JS with the route table embedded', () => {
    const src = buildOfflineShimJs(ROUTES);
    // new Function() parses as a classic script body — an import/export
    // statement (module-only syntax) would throw right here.
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('"/archive":"archive/index.html"');
    // Runtime-built post links (published entries store the canonical
    // extensionless URL) must resolve offline via the shim's route table.
    expect(src).toContain('"/field-notes/post":"field-notes/post.html"');
  });

  it('readme and report carry the numbers they are given', () => {
    const info = {
      host: 'example.com', origin: 'https://example.com', date: '2026-07-08',
      generated: 'now', tiers: ['web'], pageCount: 8, assetCount: 6,
      dataCount: 7, postCount: 11, imageCount: 42, mb: '12.3',
      skipped: ['a'], failures: ['cdn/x.webp (HTTP 404)'],
    };
    const readme = buildReadme(info);
    expect(readme).toContain('42 media files');
    // Failed downloads surface in the README and point at the report.
    expect(readme).toContain('1 media download failed');
    expect(readme).toContain('export-report.txt');
    const report = buildExportReport(info);
    expect(report).toContain('FAILED DOWNLOADS (1)');
    expect(report).toContain('cdn/x.webp (HTTP 404)');
  });

  it('readme stays quiet when nothing failed', () => {
    const info = {
      host: 'example.com', origin: 'https://example.com', date: '2026-07-08',
      generated: 'now', tiers: ['web'], pageCount: 8, assetCount: 6,
      dataCount: 7, postCount: 11, imageCount: 42, mb: '12.3',
      skipped: [], failures: [],
    };
    const readme = buildReadme(info);
    expect(readme).not.toContain('HEADS-UP');
    expect(readme).not.toContain('export-report.txt');
  });
});

// ---- integration: the real pages + real data through the real pipeline ----

// The worker injects site chrome at the edge; exports fetch pages as served.
// Simulate the parts that matter to rewriting: the cdn-base meta and the
// config-driven nav with its root-absolute links.
function withEdgeChrome(html) {
  return html.replace(/<head([^>]*)>/i, (m, a) =>
    `<head${a}><meta name="cdn-base" content="https://cdn.example.com">`
  ).replace(/<body([^>]*)>/i, (m, a) =>
    `<body${a}><div class="nav-links"><a href="/">Home</a><a href="/archive">theArchive</a>` +
    `<a href="/field-notes">FN//Blog</a><a href="/wall">theWall</a><a href="/about">About</a></div>`
  // The folio hero ships a neutral data: placeholder and gets its real src from
  // site.config.js at the edge (injectSiteChrome). The export runs against
  // pages AS SERVED, so the harvester only ever sees the injected form —
  // stamping it here is what makes this an integration test rather than a test
  // of the static file.
  ).replace(
    /(<div class="folio-hero-media"[\s\S]*?<img src=")[^"]*/i,
    '$1/api/cdn/homepage/folio-hero-2048w.webp'
  );
}

describe('integration: repo pages survive the export rewrite', () => {
  // Repo-backed pages only — /archive/manifest.html is worker-rendered.
  const repoPages = EXPORT_MANIFEST.pages.filter((p) => existsSync(join(ROOT, p.file)));

  it.each(repoPages.map((p) => [p.file]))('%s', (file) => {
    const ctx = ctxAt(file);
    const { html } = rewriteHtml(withEdgeChrome(read(file)), ctx);
    const out = injectOfflineRuntime(html, ctx.prefix);

    // No attribute may still point at the CDN proxy or carry a root-absolute
    // path (inline-script string literals are the offline shim's job). The
    // one root-absolute survivor is /dev — the console needs the live API,
    // so the export deliberately doesn't carry or remap it.
    expect(out).not.toMatch(/\s(?:href|src|poster|content|srcset)=["'][^"']*\/api\/cdn\//);
    expect(out).not.toMatch(/\sstyle=["'][^"']*url\(['"]?\/api\/cdn\//);
    const survivors = out.replace(/\s(?:href|src|poster)=["']\/dev["']/g, ' ');
    expect(survivors).not.toMatch(/\s(?:href|src|poster)=["']\/(?!\/)/);

    // The offline runtime is wired with the right depth.
    expect(out).toContain(`src="${ctx.prefix}offline/offline-shim.js"`);
    // The cdn-base meta now points inside the zip.
    expect(out).toContain(`content="${ctx.prefix}cdn"`);
  });

  it('homepage harvest finds the edge-injected hero media', () => {
    // Was "hardcoded hero/panel media" until 2026-08-05. The homepage's last
    // hardcoded CDN references lived inside the commented-out Prints &
    // Editions block; removing it left index.html with ZERO hardcoded media,
    // which is the correct end state for an engine — identity and imagery both
    // come from config now. So this exercises the served form instead.
    const ctx = ctxAt('index.html');
    const { cdnKeys } = rewriteHtml(withEdgeChrome(read('index.html')), ctx);
    expect([...cdnKeys].some((k) => k.startsWith('homepage/'))).toBe(true);
  });

  it('the shipped homepage carries no hardcoded CDN media of its own', () => {
    // The other half, and the reason the test above had to change: a fork must
    // not inherit this instance's photographs through the markup.
    expect(read('index.html')).not.toMatch(/\/api\/cdn\//);
  });

  it('real css relativizes its font urls', () => {
    const keys = new Set();
    const css = rewriteCssText(read('css/main.css'), ctxAt('css/main.css'), keys);
    expect(css).toContain(`url('../fonts/syne-latin-var.woff2')`);
    expect(css).not.toMatch(/url\(['"]?\//);
  });

  it.skipIf(!HAS_CONTENT)('real data files expand to a plausible media set', () => {
    const datasets = Object.fromEntries(
      EXPORT_MANIFEST.dataFiles.map((p) => [p, readJson(p)])
    );
    const merged = mergeKeyTiers(expandImageRules(datasets, EXPORT_MANIFEST.imageRules));
    const tiers = [...merged.values()];
    // 556 buffer + 84 archive frames × 2 web variants, plus wallpapers.
    expect(tiers.filter((t) => t === 'web').length).toBeGreaterThan(1200);
    expect(tiers.filter((t) => t === 'hires').length).toBeGreaterThan(600);
    expect(tiers.filter((t) => t === 'full').length).toBe(readJson('data/wallpapers.json').length);
    for (const key of merged.keys()) {
      expect(key).toMatch(/^(archive|wallpaper)\/[^\s"']+\.(webp|jpe?g|png)$/);
    }
  });

  // A set is a list of SLUGS riding a data file — no media of its own, so it
  // needs no image rule. What it does need is to be carried, and to be readable
  // from file:// through the offline data island: the listen page reads it on
  // every render, and the exporter treats a dataFile as required (a 404 sinks
  // the whole export). Both halves are asserted, because "it works online" is
  // exactly the thing that would hide here.
  it('carries the sets registry into the zip and the offline data island', () => {
    expect(EXPORT_MANIFEST.dataFiles).toContain('data/audio-sets.json');
    expect(existsSync(join(ROOT, 'data/audio-sets.json'))).toBe(true);
    expect(Array.isArray(readJson('data/audio-sets.json'))).toBe(true);
  });

  // THE READ LIST AND THE SHIPPED LIST MUST AGREE. js/recent-index.js runs from
  // file:// inside the export, where every fetch is answered by the data island
  // — so a data file the homepage reads and the manifest does not carry is a
  // card that silently vanishes offline, with nothing red anywhere to say so.
  // Chunk 5 added the seventh read (data/audio-sets.json); this is the guard
  // that makes the eighth impossible to forget.
  it('every data file the homepage reads is one the export carries', () => {
    const src = readFileSync(join(ROOT, 'js/recent-index.js'), 'utf8');
    const reads = [...src.matchAll(/getJson\('\/(data\/[a-z0-9-]+\.json)'\)/g)].map((m) => m[1]);
    expect(reads.length).toBeGreaterThan(3);
    for (const file of reads) {
      expect(EXPORT_MANIFEST.dataFiles, `${file} is read by the homepage`).toContain(file);
    }
  });

  // THE CARD PAGE (chunk 6). One saved file for every address, the way /listen
  // carries one file for every track — and the same guard on both halves: the
  // page has to be in the manifest AND its script has to travel with it, or the
  // saved page is a blank main element with nothing to fill it.
  it('carries the card page and the script that fills it', () => {
    const routes = EXPORT_MANIFEST.pages.map((p) => p.route);
    expect(routes).toContain('/card/');
    expect(EXPORT_MANIFEST.assets).toContain('js/page-card.js');
    expect(existsSync(join(ROOT, 'card/index.html'))).toBe(true);
    expect(existsSync(join(ROOT, 'js/page-card.js'))).toBe(true);
  });

  // The path form needs a server to map /card/<id> onto a file, and file:// has
  // none — so the page reads `?id=` too. That fallback is the ONLY thing making
  // the exported page mean anything, so it is asserted here rather than only in
  // the page's own test file, where a later refactor would not connect the two.
  it('the card page can still resolve an id with no server in front of it', () => {
    const src = readFileSync(join(ROOT, 'js/page-card.js'), 'utf8');
    expect(src).toMatch(/\[\?&\]id=/);
  });

  it('a set contributes no CDN key — it references tracks, it does not hold media', () => {
    const datasets = {
      'data/audio-sets.json': [{ id: 's1', slug: 'm', name: 'M', tracks: ['one', 'two'] }],
    };
    const merged = mergeKeyTiers(expandImageRules(datasets, EXPORT_MANIFEST.imageRules));
    expect([...merged.keys()]).toEqual([]);
  });

  it.skipIf(!HAS_CONTENT)('real post bodies surface their inline CDN media', () => {
    const keys = harvestCdnKeys(read('posts/fn-004.md'), CDN_BASES);
    expect([...keys]).toContain('blog/rolling_buffer_update_v2.mp4');
  });
});
