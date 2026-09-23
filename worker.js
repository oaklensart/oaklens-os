import {
  createRawToken, sha256Hex, verifyShellRequest,
} from './src/shared/auth.js';
import siteConfig from './src/shared/config.js';
import { withCors, handleCORS, demoModeRes, jsonRes } from './src/shared/http.js';
import { securityHeaders, withCsp } from './src/shared/csp.js';
import { readCachedTemp, refreshLocalTemp } from './src/edge/weather.js';
import { pageDisabled, publicPages } from './src/shared/pages.js';
import { resolveShortLink } from './src/shared/shortlinks.js';
import { runArchiveCapture } from './src/cron/archive.js';
import {
  handlePublish, handleSync, _isEmptyJsonArray, _emptyOverwriteGuard,
} from './src/api/publish.js';
import {
  handleGetBench, handleAddBenchEntries, handleUpdateBenchEntry,
  handleDeleteBenchEntry, handleClearDoneBenchEntries, handleBenchRawDownload,
} from './src/api/bench.js';
import { handleGetDrafts, handlePutDraft, handleDeleteDraft } from './src/api/drafts.js';
import { handleGetPulse, handlePostPulse, handleDeletePulse, handlePulseLog } from './src/api/pulse.js';
import { handleAuth, handleLogout } from './src/api/console-auth.js';
import { handleSubscribe, handleExport } from './src/api/subscribers.js';
import { handleUpload, handleDeleteAssets, handleCdnProxy, handleOgCards } from './src/api/assets.js';
import {
  getPostMeta, getFrameOgData, getAudioOgData, getCardRecord, getCardOgData, _fnOgImage,
  _validCardId, injectOg, injectSiteChrome,
  _frameImg, _ogImage, _navLinksHtml, HERO_PRELOAD_WIDTH,
} from './src/edge/chrome.js';
import {
  handleManifest, handleSitemap, handleFeed, handlePodcastFeed, handleBufferSummary, handleSiteSettings, handleVersion,
  handleAnalogsToken,
} from './src/api/site-meta.js';
import { handleDevFeed, warmDevFeed } from './src/api/devfeed.js';

// Re-exported for the public contract: tests/page-gate.test.js imports the page
// helpers + _navLinksHtml, and tests/publish-guard.test.js imports the two pure
// publish guards. Definitions live in the src/ modules named above.
export { pageDisabled, publicPages };
export { _isEmptyJsonArray, _emptyOverwriteGuard };
export { _navLinksHtml };

// Portal session cookie lifetime. Revocation is enforced per-request against the
// originating link (see portal-worker.js), so this can stay generous for UX.
const PORTAL_SESSION_TTL = 30 * 24 * 60 * 60; // 30 days (seconds)

// One log per isolate on first request: which optional features are off, and —
// loudly — whether a required secret is missing. Wrangler tail / observability
// picks this up, so a misconfigured fork is diagnosable from logs alone.
let _healthLogged = false;
function logSecretHealth(env) {
  if (_healthLogged) return;
  _healthLogged = true;
  // Each requirement can be satisfied more than one way, so this checks the
  // *capability*, not a fixed list of names:
  //   password  — AUTH_PASSWORD_HASH (setup.sh) or AUTH_PASSWORD (one-click)
  //   signing   — SESSION_SECRET, or a KV namespace to generate and keep one in
  const missingRequired = [];
  if (!env.AUTH_PASSWORD_HASH && !env.AUTH_PASSWORD) {
    missingRequired.push('AUTH_PASSWORD_HASH (or AUTH_PASSWORD)');
  }
  if (!env.SESSION_SECRET && !env.SUBSCRIBERS) {
    missingRequired.push('SESSION_SECRET (or a SUBSCRIBERS KV binding to generate one)');
  }
  if (missingRequired.length) {
    console.error(`[health] REQUIRED secrets missing: ${missingRequired.join(', ')} — console login is broken until they are set`);
  }
  const offFeatures = [
    ['GitHub publish/sync', ['GITHUB_TOKEN', 'GITHUB_REPO']],
    ['subscriber export', ['ADMIN_KEY']],
    ['Wayback archive cron', ['ARCHIVE_S3_ACCESS', 'ARCHIVE_S3_SECRET']],
    ['bench RAW cold storage', ['B2_BUCKET_NAME', 'B2_KEY_ID', 'B2_APP_KEY']],
  ].filter(([, keys]) => keys.some((k) => !env[k]));
  if (offFeatures.length) {
    console.log(`[health] optional features off (secrets unset): ${offFeatures.map(([name]) => name).join(', ')}`);
  }
}

// ---- Legacy URL redirects ----
//
// Old Squarespace navigation paths are still indexed by search engines (Brave,
// Google, etc.) and surface as dead links. Map each retired path to its current
// home with a permanent 301 so crawlers update their index and visitors who
// click an old result land on the right page. Keys are normalised: lower-cased,
// no trailing slash. manifest.html is intentionally left untouched.
const LEGACY_REDIRECTS = {
  // Map any retired URL to its new home, e.g. if your old site had /blog:
  //   '/blog': '/field-notes',
  // Keys are normalised: lower-cased, no trailing slash. Leave this empty and
  // set `legacyRedirects: false` in site.config.js if you have no old URLs.
};

// ---- Exact-match route table (manual §6.7) ----
//
// Declarative `Map` keyed by "METHOD pathname" — the replacement for the old
// route-7 `if` ladder. Every value is `(request, env, url) => Response`. The
// dispatcher (fetch) wraps `/api/*` results in withCors; the rendered-page
// GETs (manifest/sitemap/feed) deliberately carry no CORS header, exactly as
// before. Order-sensitive routes — host redirects, legacy redirects, `/c/`,
// preflight, and the prefix routes (`/api/bench/raw/…`, `/api/cdn/…`, `/p/…`),
// plus the console-shell gate and asset serving — stay as ordered logic below,
// because for them *order is behavior*. New exact API routes: add a line here.
const EXACT_ROUTES = new Map([
  ['GET /archive/manifest.html', (request, env) => handleManifest(request, env)],
  ['GET /sitemap.xml', (request, env) => handleSitemap(request, env)],
  ['GET /feed.xml', (request, env) => handleFeed(request, env)],
  // RSS 2.0, separate from the Atom blog feed on purpose — podcast apps need
  // RSS, and only tracks the author marked `episode` belong in one.
  ['GET /podcast.xml', (request, env) => handlePodcastFeed(request, env)],
  ['GET /api/buffer-summary', (request, env) => handleBufferSummary(request, env)],
  // The /dev page's commit grid + activity log. Public and cache-first;
  // 404s unless site.config.js names repos under `devFeed`.
  ['GET /api/devfeed', (request, env, url, ctx) => handleDevFeed(request, env, url, ctx)],
  ['GET /api/site/settings', (request, env) => handleSiteSettings(request, env)],
  ['GET /api/version', (request, env) => handleVersion(env)],
  ['GET /.well-known/analogs.txt', () => handleAnalogsToken()],
  ['POST /api/auth', (request, env) => handleAuth(request, env)],
  ['POST /api/logout', () => handleLogout()],
  ['POST /api/upload', (request, env) => handleUpload(request, env)],
  ['POST /api/publish', (request, env) => handlePublish(request, env)],
  ['GET /api/sync', (request, env) => handleSync(request, env)],
  ['POST /api/delete-assets', (request, env) => handleDeleteAssets(request, env)],
  ['POST /api/subscribe', (request, env) => handleSubscribe(request, env)],
  ['GET /api/subscribers/export', (request, env, url) => handleExport(request, url, env)],
  ['GET /api/bench', (request, env) => handleGetBench(request, env)],
  ['POST /api/bench/entries', (request, env) => handleAddBenchEntries(request, env)],
  ['PATCH /api/bench/entries', (request, env) => handleUpdateBenchEntry(request, env)],
  ['DELETE /api/bench/entries', (request, env) => handleDeleteBenchEntry(request, env)],
  ['DELETE /api/bench/done', (request, env) => handleClearDoneBenchEntries(request, env)],
  ['GET /api/drafts', (request, env) => handleGetDrafts(request, env)],
  ['PUT /api/drafts', (request, env) => handlePutDraft(request, env)],
  ['DELETE /api/drafts', (request, env) => handleDeleteDraft(request, env)],
  ['GET /api/og-cards', (request, env) => handleOgCards(request, env)],
  // Pulse. The GET is public and edge-cached (60s) — it feeds the homepage card
  // the way /api/buffer-summary feeds the RAW daily. The rest is console-only.
  ['GET /api/pulse', (request, env) => handleGetPulse(request, env)],
  ['POST /api/pulse', (request, env) => handlePostPulse(request, env)],
  ['DELETE /api/pulse', (request, env) => handleDeletePulse(request, env)],
  ['GET /api/pulse/log', (request, env) => handlePulseLog(request, env)],
]);

// Allowed methods per exact pathname, DERIVED from the table above rather than
// hand-kept — a second list would be one more thing to forget when a route is
// added. Used only to answer 405 (see the dispatcher); it can never add a route.
const EXACT_METHODS = (() => {
  const byPath = new Map();
  for (const key of EXACT_ROUTES.keys()) {
    const [method, pathname] = key.split(' ');
    if (!byPath.has(pathname)) byPath.set(pathname, new Set());
    byPath.get(pathname).add(method);
  }
  return byPath;
})();

// Demo mode (site.config.js → demoMode: true): every route that writes —
// or reads subscriber PII — answers a deliberate 403 { demoMode: true }
// (see demoModeRes). Keyed exactly like EXACT_ROUTES so the gate cannot
// drift from the table above; checked BEFORE dispatch so no handler's own
// auth/validation can route around it. Login/logout stay open (the demo
// console is meant to be explored), reads stay open, and the gate is config,
// not auth — the owner writes via a non-demo deployment on the same
// bindings. tests/demo-mode.test.js walks this set against the real worker.
export const DEMO_LOCKED_ROUTES = new Set([
  'POST /api/upload',
  'POST /api/publish',
  'POST /api/delete-assets',
  'POST /api/subscribe',            // a demo must not collect visitor emails
  'GET /api/subscribers/export',    // …nor hand out any it somehow has
  'POST /api/bench/entries',
  'PATCH /api/bench/entries',
  'DELETE /api/bench/entries',
  'DELETE /api/bench/done',
  'PUT /api/drafts',
  'DELETE /api/drafts',
  // A demo console must not be able to write to the demo's own homepage.
  // The pulse READ stays open — the demo should show a pulse card like any site.
  'POST /api/pulse',
  'DELETE /api/pulse',
]);

// ---- Main handler ----

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runArchiveCapture(env));
    // Warm the /dev commit feed once a day, so the page is fresh for the
    // first visitor rather than because of them. Without this the feed is
    // purely traffic-driven: a stale entry is only noticed when somebody
    // arrives, and that visitor sees the OLD payload while the refresh runs
    // behind them. A quiet week would mean a week-old log.
    // Independent of the archive run — neither should be able to skip the
    // other — and silent when `devFeed` is unconfigured (it returns null).
    ctx.waitUntil(warmDevFeed(env));
  },

  async fetch(request, env, ctx) {
    logSecretHealth(env);
    const url = new URL(request.url);

    // www → apex (universal; the apex host is whatever the rest of the
    // hostname is, so no domain needs to be configured)
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    // LEGACY SQUARESPACE PATHS → current pages (permanent). Gated behind
    // config — template forks have no Squarespace history to redirect.
    if (siteConfig.legacyRedirects) {
      const legacyKey = url.pathname.replace(/\/+$/, '').toLowerCase() || '/';
      if (legacyKey !== '/' && LEGACY_REDIRECTS[legacyKey]) {
        url.pathname = LEGACY_REDIRECTS[legacyKey];
        return Response.redirect(url.toString(), 301);
      }
    }

    // Handle all /api/* preflight requests uniformly
    if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return withCors(handleCORS(), url.origin);
    }

    // Exact-match routes (EXACT_ROUTES table above). `/api/*` results get the
    // per-origin CORS header; the rendered-page GETs (manifest/sitemap/feed)
    // deliberately do not — same as the old ladder. Prefix routes below aren't
    // in the table because their pathname varies (bench/raw filename, cdn key,
    // shortlink code).
    const routeKey = `${request.method} ${url.pathname}`;
    if (siteConfig.demoMode && DEMO_LOCKED_ROUTES.has(routeKey)) {
      return withCors(demoModeRes(routeKey.split(' ')[1]), url.origin);
    }
    const exactRoute = EXACT_ROUTES.get(routeKey);
    if (exactRoute) {
      // ctx rides along so a handler can defer background work with
      // waitUntil (devfeed's stale-while-revalidate refresh). Handlers
      // that don't need it simply declare fewer parameters.
      const res = await exactRoute(request, env, url, ctx);
      return url.pathname.startsWith('/api/') ? withCors(res, url.origin) : res;
    }

    // A KNOWN path with the WRONG method: answer 405 here rather than letting it
    // fall through. Two reasons, and the second is the expensive one:
    //   - `DELETE /api/pulse` answering with the site's HTML 404 page is a lie a
    //     client cannot act on; 405 + Allow is the honest answer and tells the
    //     caller what the path does support.
    //   - everything below this point is the PAGE path — the weather read, the
    //     OG lookups, the HTMLRewriter — and a malformed API call was paying for
    //     all of it to render a 404 nobody reads.
    // Exact pathnames only, so the prefix routes below (bench/raw, cdn, /p/,
    // short links) are untouched: their pathnames are never in this map.
    const allowed = EXACT_METHODS.get(url.pathname);
    if (allowed && !allowed.has(request.method)) {
      // HEAD is GET without a body and the runtime strips the body itself, so a
      // path that answers GET must not 405 a HEAD probe (uptime monitors send
      // them, and the /api/cdn proxy already learned this the hard way).
      if (!(request.method === 'HEAD' && allowed.has('GET'))) {
        // HEAD is supported wherever GET is (the branch above lets it through),
        // so Allow says so — it is meant to list what the resource answers.
        const allow = [...new Set([...allowed, ...(allowed.has('GET') ? ['HEAD'] : [])])]
          .sort().join(', ');
        const res = jsonRes({ ok: false, error: `${request.method} not allowed on ${url.pathname}` }, 405);
        res.headers.set('Allow', allow);
        return url.pathname.startsWith('/api/') ? withCors(res, url.origin) : res;
      }
    }

    // BENCH RAW download (prefix — filename varies)
    if (url.pathname.startsWith('/api/bench/raw/') && request.method === 'GET') {
      const filename = decodeURIComponent(url.pathname.slice('/api/bench/raw/'.length));
      return withCors(await handleBenchRawDownload(request, env, filename), url.origin);
    }

    // Same-origin R2 proxy for CDN assets (src/api/assets.js) — the default
    // serving path when no custom cdnBase is configured, the field console's
    // canvas-safe frame source, and the sample-frame fallback on a fork.
    // `ctx` rides along so the proxy can populate its edge cache in the
    // background without holding the image response. HEAD matches too:
    // GET-only routing sent `curl -I` and uptime monitors' HEAD probes past
    // the proxy into the asset layer, which answered 404 for every real
    // image (the runtime strips the body from a HEAD response itself).
    if (url.pathname.startsWith('/api/cdn/')
      && (request.method === 'GET' || request.method === 'HEAD')) {
      return handleCdnProxy(request, env, url, ctx);
    }

    // BRANDED SHORT LINKS (site.config.js → shortLinks). A memorable path on
    // the site's own domain that points somewhere else — the instance's demo,
    // a fork, a talk. Empty on a fresh fork, in which case this costs one
    // Map.size check per request. See src/shared/shortlinks.js for why the
    // check sits HERE: after every worker-owned route, before the asset layer.
    //
    // The hostname rides along for the optional `shortLinkHost` scope. This
    // instance scopes them to `os.` — the apex is a photographer, the
    // subdomain is the software, and these links belong to the software.
    if (request.method === 'GET' || request.method === 'HEAD') {
      const shortTarget = resolveShortLink(url.pathname, url.hostname);
      if (shortTarget) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': shortTarget,
            // Re-pointable by design: nothing caches this hop.
            'Cache-Control': 'no-store',
            ...securityHeaders(url.origin, true),
          },
        });
      }
    }

    // CARD PERMALINK — /card/<id> (docs/cards-core-complete.md chunk 6).
    //
    // A composed card is a content type and a content type has an address. The
    // id lives in the PATH (a share link is read by people, and `?id=` reads
    // like machinery), so nothing is on disk at that URL — this resolves the id
    // and serves the one `card/index.html` document for it, the console-gate
    // precedent for an alternate-asset fetch. The page then renders the card
    // client-side from data/cards.json, the way /listen renders a track.
    //
    // A RETIRED id answers 410 here, before the page is served: the record is a
    // tombstone reserving the address so a future card can never quietly answer
    // someone's old link, and 410 is the honest thing to tell a crawler holding
    // it (owner decision, 2026-09-11 — plan §7 Q2). An UNKNOWN id falls through
    // to the page's own plain state, because "typed wrong" is the common case
    // and it is not the visitor's fault.
    //
    // ⚠️ THIS ROUTE CLAIMS ONLY WHAT IS ACTUALLY AN ADDRESS. `/card/<id>` where
    // <id> is one valid segment — nothing else. A path with a further slash in
    // it is not a card address and falls through to the asset layer, which is
    // what makes `/card/anything/else.css` a plain 404 instead of this page
    // served as text/html. It matters because THIS PAGE IS SERVED AT TWO
    // DEPTHS: `/card/<id>` and `/card/<id>/` are the same address, so any
    // document-relative reference on the page resolves under /card/ for one of
    // them (the page's own refs are root-relative for exactly that reason, and
    // a stylesheet answered with text/html is refused by every browser).
    let cardPageId = null;
    let cardPageRecord = null;
    if ((request.method === 'GET' || request.method === 'HEAD')
      && url.pathname.startsWith('/card/') && !pageDisabled('/card')) {
      let raw = url.pathname.slice('/card/'.length).replace(/\/+$/, '');
      try { raw = decodeURIComponent(raw); } catch { /* keep the raw form */ }
      if (_validCardId(raw)) {
        const found = await getCardRecord(url.origin, env, raw);
        if (found.state === 'retired') {
          return new Response('This card has been retired. Its address stays reserved.', {
            status: 410,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
              ...securityHeaders(url.origin, true),
            },
          });
        }
        cardPageId = raw;
        // Held for the OG branch below, so a live card is looked up ONCE.
        cardPageRecord = found.state === 'live' ? found.card : null;
      }
    }

    // FIELD CONSOLE SHELL GATE — secure-by-default (opt out: site.config.js →
    // consoleShellPublic: true). The admin console *document* is served only
    // to a valid console-shell cookie — the same posture the portal already
    // takes for /c/* (cookie-gated template, bare page for everyone else).
    // Unauthenticated visitors get a minimal login page (401 + no-store: the
    // status keeps the PWA service worker from ever caching the login page
    // over the shell — its network-first cache only stores res.ok).
    // On successful login /api/auth sets the cookie and the page reloads into
    // the console. API auth is unchanged (Bearer, scope 'console'); the
    // cookie authorizes ONLY this document read, so it has no CSRF surface —
    // mutations remain Bearer-only and reject the cookie's scope.
    const isConsoleShell =
      url.pathname === '/dev/field-console' || url.pathname === '/dev/field-console.html';
    if (isConsoleShell && siteConfig.consoleShellPublic !== true) {
      if (!(await verifyShellRequest(request, env))) {
        const gate = await env.ASSETS.fetch(new Request(`${url.origin}/dev/console-gate.html`));
        // The gate carries the console's lighting, and light needs a colour.
        // Stamp the PALETTE and nothing else, so a fork's login page is in its
        // own brand. Deliberately NOT the site-chrome rewriter: the name,
        // tagline, coordinates and OG card must never reach an
        // unauthenticated visitor. One attribute, one element handler — and
        // a palette name is already on every public page of the same site.
        const lit = new HTMLRewriter().on('html', {
          element(el) {
            el.setAttribute('data-preset', (siteConfig.theme || {}).preset || 'aperture');
          },
        }).transform(gate);
        return new Response(lit.body, {
          status: 401,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            // /dev surface: relaxed CSP (the gate carries an inline script).
            // securityHeaders, not buildCsp: this Response is built from
            // scratch, so `_headers` never touches it — X-Frame-Options was
            // missing on the admin login page until 2026-08-07.
            ...securityHeaders(url.origin, false),
          },
        });
      }
    }

    // Config-gated page (pages{} in site.config.js): serve the site's real
    // 404 page through the normal rewriter flow below so it gets nav chrome
    // like any page (console-gate precedent for the alternate-asset fetch).
    // CONSOLE_PATHS are already carved out inside pageDisabled.
    const isGatedPage = request.method === 'GET' && pageDisabled(url.pathname);

    // --- Asset serving + HTML rewriting ---
    const response = isGatedPage
      ? await env.ASSETS.fetch(new Request(`${url.origin}/404.html`))
      : cardPageId !== null
        ? await env.ASSETS.fetch(new Request(`${url.origin}/card/`))
        : await env.ASSETS.fetch(request);

    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('text/html')) {
      // A miss must never outlive itself: Workers Assets applies `_headers`
      // rules by URL pattern, status-blind — so a 404 for a missing /*.webp
      // or /js/* URL was answering with that rule's `immutable, max-age=1y`
      // and the edge cache kept the 404 for a year (observed live:
      // cf-cache-status HIT on a 404). Same guard on the HTML path below.
      if (response.status === 404) {
        const miss = new Response(response.body, response);
        miss.headers.set('Cache-Control', 'no-store');
        return miss;
      }
      return response;
    }

    // Weather: read cache only (never block on upstream); refresh in background
    // when the entry is cold or older than the freshness window.
    const cachedTemp = await readCachedTemp(url.origin);
    const temp = cachedTemp ? cachedTemp.temp : null;
    if (!cachedTemp || cachedTemp.stale) {
      ctx.waitUntil(refreshLocalTemp(url.origin));
    }

    // Page detection for per-frame Open Graph (manifest.html already returned).
    const p = url.pathname;
    const isBufferPage =
      p === '/archive/buffer' || p === '/archive/buffer/' || p === '/archive/buffer/index.html';
    const isArchivePage =
      !isBufferPage && (p === '/archive' || p === '/archive/' || p === '/archive/index.html');
    const isPostPage = p.includes('/field-notes/post');
    const isListenPage = p === '/listen' || p === '/listen/' || p === '/listen/index.html';

    let ogData = null;
    let heroUrl = null;
    if (isArchivePage) {
      ogData = await getFrameOgData(url, env, 'archive');
    } else if (isBufferPage) {
      ogData = await getFrameOgData(url, env, 'buffer');
    } else if (isListenPage) {
      ogData = await getAudioOgData(url, env);
    } else if (cardPageRecord) {
      ogData = await getCardOgData(url, env, cardPageRecord);
    } else if (isPostPage) {
      const postMeta = await getPostMeta(url, env);
      if (postMeta) {
        // Only a note that HAS a hero preloads one.
        if (postMeta.hero) heroUrl = _frameImg(url.origin, postMeta.hero, HERO_PRELOAD_WIDTH);
        const slug = url.searchParams.get('slug');
        ogData = {
          title: `${postMeta.title || 'Field Note'} — ${siteConfig.name.toUpperCase()}`,
          description: [postMeta.location, postMeta.date].filter(Boolean).join(' · ') || `Field notes from ${siteConfig.name}.`,
          // Prefer the stamped card when the console has published one; _ogImage
          // falls back to the raw hero otherwise. A note with NO hero has no
          // photograph to fall back to, so it asks for its own stem instead
          // (meta/fn-<slug>-og.webp, the painter's words tile — chunk 7) and
          // takes null until one is stamped, which injectOg skips.
          image: postMeta.hero
            ? await _ogImage(env, url.origin, postMeta.hero)
            : await _fnOgImage(env, url.origin, slug),
          // Canonical post URL is the extensionless route (the .html form
          // 307s to it), so shares and feed entries converge on one URL.
          ogUrl: `${url.origin}/field-notes/post?slug=${encodeURIComponent(slug)}`,
        };
      }
    }

    // Every HTML response gets the config-driven site chrome (meta tags, nav,
    // contact email, absolute og: URLs); weather/OG/hero rules join as needed.
    const rewriter = new HTMLRewriter();
    injectSiteChrome(rewriter, url);

    if (temp !== null) {
      rewriter.on('#wx-temp', {
        element(el) {
          el.setInnerContent(`${temp}°`);
        },
      });
    }

    if (heroUrl) {
      const preloadTag = `<link rel="preload" as="image" href="${heroUrl}" fetchpriority="high">`;
      rewriter.on('head', {
        element(el) {
          el.append(preloadTag, { html: true });
        },
      });
    }

    if (ogData) {
      injectOg(rewriter, ogData, isBufferPage);
    }

    const transformed = rewriter.transform(response);
    if (response.status === 404 && !isGatedPage) {
      // The natural asset-layer 404 (404.html via not_found_handling) still
      // gets full site chrome from the rewriter above — but its Cache-Control
      // must not come from a `_headers` URL rule (see the non-HTML guard):
      // a missing .webp/.css/.js URL serves this HTML page, and `immutable`
      // stamped by pattern would cache the miss for a year.
      const miss = new Response(transformed.body, transformed);
      miss.headers.set('Cache-Control', 'no-store');
      return withCsp(miss, url.origin, url.pathname);
    }
    if (isGatedPage) {
      // A disabled page is a 404, and no-store so flipping the config back
      // on isn't shadowed by a cached miss. It's a public path → strict CSP.
      return new Response(transformed.body, {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...securityHeaders(url.origin, true),
        },
      });
    }
    if (isConsoleShell) {
      // The gated document must not outlive its session in the HTTP cache
      // (logout would otherwise leave a servable copy behind). Offline
      // relaunch is owned by the PWA service worker's own cache, unaffected.
      // /dev surface → relaxed CSP (the console is inline-heavy).
      const gated = new Response(transformed.body, transformed);
      gated.headers.set('Cache-Control', 'no-store');
      for (const [k, v] of Object.entries(securityHeaders(url.origin, false))) {
        gated.headers.set(k, v);
      }
      return gated;
    }
    return withCsp(transformed, url.origin, url.pathname);
  },
};
