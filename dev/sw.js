// OAKLENS Field Console — offline shell, cellular-hardened.
//
// Precaches the console document + every extracted asset (CSS, the ES
// modules, self-hosted fonts) so the console launches instantly at zero bars,
// and — crucially — with ONE flaky bar: network-first requests race a 3.5s
// deadline and fall back to the cached copy instead of hanging the launch on
// a dying socket. The late network response still lands in the cache, so the
// next launch is fresh (stale-while-revalidate under pressure).
//
// Pinned third-party libs (exifr/jszip — versioned, SRI'd, immutable URLs)
// are cache-first: identical bytes forever, so the network is only touched
// once. Their <script> tags are async and the console guards their globals,
// so a miss degrades (EXIF dates fall back to today, ZIP export explains)
// rather than blocking.
//
// Mutations (/api/* upload, publish, sync) always require the network and are
// never intercepted or cached — this SW only serves the static shell.

const CACHE = 'oaklens-console-v119';
const SHELL = '/dev/field-console.html';
// Same-origin shell assets. The js/ versions here must match the import map in
// field-console.html exactly — that map is where a module's version is decided,
// this list is what gets precached for offline. A SW cannot read the page's
// import map, so the duplication is unavoidable; tests/guards.test.js keeps the
// two in step. CSS is a plain <link>, so its ?v= still lives on the tag.
const SHELL_ASSETS = [
  '/css/field-console.css?v=41',
  '/js/console-state.js?v=8',
  '/js/console-api.js?v=11',
  '/js/markdown-engine.js?v=4',
  '/js/console-ui.js?v=61',
  '/js/console/chrome.js?v=10',
  '/js/console/assets.js?v=4',
  '/js/console/utils.js?v=2',
  '/js/console/sync.js?v=1',
  '/js/console/upload.js?v=2',
  '/js/console/more-views.js?v=4',
  '/js/console/archive.js?v=2',
  '/js/console/buffer.js?v=2',
  '/js/console/fn-editor.js?v=4',
  '/js/console/focal.js?v=3',
  '/js/console/asset-library.js?v=1',
  '/js/console/audio.js?v=6',
  '/js/console/publish.js?v=9',
  '/js/console/session.js?v=8',
  '/js/console/bench.js?v=1',
  '/js/pulse-packs.js?v=2',
  '/js/console/pulse.js?v=2',
  '/js/console/init.js?v=8',
  '/js/console-telemetry.js?v=2',
  '/js/raw-lens.js?v=5',
  '/js/jpeg-privacy.js?v=1',
  '/js/raw-extract.js?v=4',
  '/js/site-export.js?v=4',
  '/js/site-export-core.js?v=3',
  '/js/export-manifest.js?v=13',
  // Every preset's console faces, not just noir's. The console re-skins its
  // typography with `data-preset` now, so precaching only Syne would have left
  // an installed PWA on aperture or passe-partout dropping to system fonts the
  // moment it went offline — the same "true for one preset" bug as the CSS it
  // follows. Costs ~150KB once at install; a browser still only *renders* the
  // faces the active preset names.
  '/fonts/syne-latin-var.woff2',
  '/fonts/syne-mono-latin.woff2',
  '/fonts/fraunces-latin-var.woff2',
  '/fonts/archivo-latin-var.woff2',
  '/fonts/ibm-plex-mono-latin-400.woff2',
  '/fonts/ibm-plex-mono-latin-500.woff2',
];
// Version-pinned cross-origin libs — cache-first (immutable by URL).
const CDN_LIBS = [
  'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
];
// How long a network-first request may stall before the cached copy wins.
// Cellular sockets can hang for 60s+ without erroring; 3.5s covers slow-but-
// alive connections while keeping a flaky launch feeling instant.
const NET_DEADLINE_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) =>
        c.addAll([SHELL, ...SHELL_ASSETS])
          // Libs are best-effort: an unreachable CDN must not fail the whole
          // install (the shell is still fully usable without them).
          .then(() => Promise.allSettled(CDN_LIBS.map((u) => c.add(u))))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first with a deadline. Resolution order:
//  1. network responds before the deadline → serve it (and re-cache if ok)
//  2. deadline fires and a cached copy exists → serve cache; the network
//     response still updates the cache in the background when it lands
//  3. network errors → cache; no cache → the network error propagates
function networkFirst(req, cacheKey, matchOpts) {
  return caches.open(CACHE).then((cache) => new Promise((resolve) => {
    let settled = false;
    const useCache = () =>
      cache.match(cacheKey, matchOpts).then((hit) => {
        if (hit && !settled) { settled = true; resolve(hit); }
        return hit;
      });
    const deadline = setTimeout(useCache, NET_DEADLINE_MS);
    fetch(req)
      .then((res) => {
        clearTimeout(deadline);
        if (res.ok) cache.put(cacheKey, res.clone()).catch(() => {});
        if (!settled) { settled = true; resolve(res); }
      })
      .catch(() => {
        clearTimeout(deadline);
        useCache().then((hit) => {
          if (!hit && !settled) { settled = true; resolve(Response.error()); }
        });
      });
  }));
}

// Cache-first for immutable pinned libs: bytes at these URLs never change.
function cacheFirst(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      })
    )
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pinned libs are the only cross-origin requests we touch.
  if (CDN_LIBS.includes(url.href)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  const isShell = url.pathname.startsWith('/dev/field-console');
  const isShellAsset = SHELL_ASSETS.some((a) => a.split('?')[0] === url.pathname);
  if (!isShell && !isShellAsset) return;

  // Shell requests normalize to one cache key (the page is reachable as
  // /dev/field-console and .html); assets are keyed by their own request,
  // matched ignoring ?v= so a bumped version still has an offline fallback.
  event.respondWith(
    isShell
      ? networkFirst(req, SHELL)
      : networkFirst(req, req, { ignoreSearch: true })
  );
});
