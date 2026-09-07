// OAKLENS // SITE EXPORT MANIFEST — what "the whole site" means, as data.
//
// js/site-export.js walks this manifest to build the site-in-a-ZIP export:
// every page is fetched from the serving origin (so the worker's edge-injected
// chrome — nav, meta, weather — is baked into the saved HTML), every asset and
// data file is copied, and every image the data references is mirrored out of
// the CDN into the zip's cdn/ folder.
//
// Fork checklist: this file is the whole story of your deployment's shape.
// Running a different setup — extra pages, another storage layout, different
// image variants — edit the lists and rules below; the exporter itself never
// hardcodes a path. It pairs with site.config.js the same way: config for
// identity, manifest for structure.
//
// ⚠️ This file is REWRITTEN BY os-extract.mjs on the way to a fork (the /os
// entries come out). So its `?v=` has to be bumped whenever *that transform*
// changes, even though nothing here moved — the fork's copy changed, and a
// fork's installed console would otherwise keep serving the cached old one
// from the service worker. That is not hypothetical: the ?v=6 → 7 bump exists
// because the fork's copy still listed js/page-os.js, a file forks do not
// have, and site-export throws on the first asset it cannot fetch.

// ---- image-key helpers (mirror the public pages' CDN URL construction) ----

// The upload pipeline publishes each frame as <base>-{480,1024,2048}w.webp.
// Tiers let the export UI include/exclude size classes: 'web' (480+1024, the
// browsing set), 'hires' (2048, the lightbox set), 'full' (originals).
const _base = (f) => encodeURIComponent(String(f).replace(/\.[^.]+$/, ''));

function sizeVariants(prefix, filename) {
  if (!filename) return [];
  const b = _base(filename);
  return [
    { key: `${prefix}/${b}-480w.webp`, tier: 'web' },
    { key: `${prefix}/${b}-1024w.webp`, tier: 'web' },
    { key: `${prefix}/${b}-2048w.webp`, tier: 'hires' },
  ];
}

// Mirrors wall/index.html cdnFull(): fullres entries store the original
// filename with its real extension; pre-fullres entries stored the display
// .webp — strip and assume the original was a .jpg.
function wallpaperFull(entry) {
  const f = entry.fullres || entry.filename;
  if (!f) return [];
  const key = f.endsWith('.webp')
    ? `wallpaper/full/${encodeURIComponent(f.replace(/\.webp$/, ''))}.jpg`
    : `wallpaper/full/${encodeURIComponent(f)}`;
  return [{ key, tier: 'full' }];
}

export const EXPORT_MANIFEST = {
  // Public pages: fetched from `route` (edge chrome included), written to
  // `file`. The same table drives link rewriting — root-absolute links to a
  // route become relative links to its file — and rides into the offline
  // runtime so links built by page JS at runtime resolve on disk too.
  pages: [
    { route: '/', file: 'index.html' },
    { route: '/archive', file: 'archive/index.html' },
    { route: '/archive/buffer', file: 'archive/buffer/index.html' },
    { route: '/field-notes', file: 'field-notes/index.html' },
    // Canonical post route is extensionless; the .html spelling still serves
    // (the worker 307s it) and old shared links may carry it, so it rides as
    // an alias — both map to the same saved file, fetched once.
    { route: '/field-notes/post', file: 'field-notes/post.html', aliases: ['/field-notes/post.html'] },
    { route: '/wall', file: 'wall/index.html' },
    // The audio permalink + index. One saved file serves both views: the
    // per-track view is a query (?a=slug), which the page resolves client-side
    // from the data island, so no per-track export entry is needed.
    { route: '/listen', file: 'listen/index.html', aliases: ['/listen/'] },
    { route: '/about', file: 'about/index.html' },
    { route: '/support', file: 'support/index.html' },
    { route: '/archive/manifest.html', file: 'archive/manifest.html' },
    { route: '/404.html', file: '404.html' },
  ],

  // Same-origin static assets copied verbatim (CSS gets its url() paths
  // relativized in transit). Everything the pages above reference.
  assets: [
    'css/main.css',
    'js/lighttable.js',
    'js/mode-toggle.js',
    // Shared per-page boilerplate (mobile nav, CDN helpers, submitGTD, viewport
    // reflow) loaded by every public page — classic script, copied verbatim.
    'js/site-common.js',
    // Per-page render scripts — externalized from inline <script> blocks for a
    // strict script-src (no 'unsafe-inline'). Copied verbatim.
    'js/page-index.js',
    'js/page-about.js',
    'js/page-archive.js',
    'js/page-buffer.js',
    'js/page-wall.js',
    'js/page-fn-list.js',
    'js/page-fn-post.js',
    // Homepage recent-work grid — classic script, copied verbatim; renders from
    // the offline data island via the fetch shim (like lighttable.js).
    'js/recent-index.js',
    // The waveform player — classic script, copied verbatim. Its peaks travel
    // in data/audio.json, so a player draws offline with no audio decoded;
    // pressing play then reads the track file the imageRules below carry.
    'js/audio-player.js',
    'js/page-listen.js',
    'fonts/syne-latin-var.woff2',
    'fonts/syne-mono-latin.woff2',
    // Preset faces (starter template) — main.css declares all of them, so an
    // exported tree must carry them for whichever preset the instance runs.
    'fonts/archivo-latin-var.woff2',
    'fonts/sora-latin-var.woff2',
    'fonts/ibm-plex-mono-latin-400.woff2',
    'fonts/ibm-plex-mono-latin-500.woff2',
    'fonts/fraunces-latin-var.woff2',
    'fonts/hanken-grotesk-latin-var.woff2',
    'favicon.svg',
    'apple-touch-icon.png',
  ],

  // Content source of truth — included both as real files (so the zip doubles
  // as a git-restorable backup) and embedded in the offline data island the
  // fetch shim answers from (fetch() of local files is blocked on file://).
  dataFiles: [
    'data/buffer.json',
    'data/archive.json',
    'data/posts.json',
    'data/wallpapers.json',
    'data/barrel.json',
    'data/friends.json',
    'data/library.json',
    'data/audio.json',
  ],

  // Field-note markdown: one file per published entry in `data`, at
  // <dir>/<fn_id>.md — mirrors how post.html fetches them.
  posts: { data: 'data/posts.json', dir: 'posts', idField: 'fn_id' },

  // Worker API responses captured at export time so data-driven widgets
  // (the archive landing's buffer strip) render offline from a snapshot.
  apiSnapshots: ['/api/buffer-summary'],

  // Third-party scripts a public page loads from a CDN. The exporter mirrors
  // each into the zip and rewrites the matching <script src> to the local
  // copy, so the export works with the network cable pulled. Empty since the
  // published site went fully dependency-free (post.html's marked → the
  // in-house js/markdown-engine.js); kept for forks that add a library.
  vendor: [],

  // Site ES modules a page loads dynamically. import() of a local module is
  // CORS-blocked on file://, so the exporter ships a classicized copy
  // (export keywords stripped → globals) loaded before the page scripts;
  // the page falls back to the global when the import fails offline.
  offlineModules: [
    { src: '/js/markdown-engine.js?v=4', file: 'offline/markdown-engine.js' },
  ],

  // Worker-rendered documents worth carrying for completeness even though
  // they only mean anything online (their links are absolute by design).
  // Fetched best-effort — a 501/absent route never sinks the export.
  extras: ['/sitemap.xml', '/feed.xml', '/podcast.xml'],

  // Which CDN objects the data implies. `source` names a dataFile; `expand`
  // maps one entry to CDN keys + tiers. Keys referenced directly in HTML,
  // markdown, or JSON (homepage heroes, inline blog media, OG cards) don't
  // need rules — the exporter harvests those from the content it processes.
  imageRules: [
    // Dark frames (dark:true — retired tombstones, manual §5.20) keep their
    // buffer.json slot but have no R2 objects: they contribute no media keys.
    { source: 'data/buffer.json', expand: (e) => e.dark ? [] : sizeVariants('archive', e.filename) },
    { source: 'data/archive.json', expand: (e) => sizeVariants('archive', e.filename) },
    { source: 'data/posts.json', expand: (e) => sizeVariants('archive', e.hero_filename || e.hero) },
    {
      source: 'data/wallpapers.json',
      expand: (e) => [...sizeVariants('wallpaper', e.filename), ...wallpaperFull(e)],
    },
    // Audio has no derived tiers — one canonical object per track. Carrying it
    // is what makes an exported tree PLAY offline rather than just draw the
    // waveform (the peaks are already in data/audio.json).
    { source: 'data/audio.json', expand: (e) => (e.filename ? [`audio/${e.filename}`] : []) },
  ],
};
