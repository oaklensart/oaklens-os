// Edge-cached data-JSON loader. Extracted from worker.js (decomposition,
// manual §6.7). Used by OG resolution (chrome.js) and the feed/buffer-summary
// endpoints (site-meta.js) so buffer.json (~134 KB) / archive.json aren't
// re-fetched from the asset bundle on every crawler hit. (Only the FETCH is
// saved — cache.match returns bytes and hit.json() re-parses them on every
// request. This comment claimed the parse was saved too; it never was.)
//
// THE KEY CARRIES THE DEPLOY. `assets.directory: "."` means one deploy ships
// code AND content, so every publish produces a new Worker version — and
// env.CF_VERSION_METADATA.id (the `version_metadata` binding, wrangler.jsonc)
// changes with it. Folding that id into the key makes a deploy invalidate every
// entry at once, so a publish is visible the moment the build lands instead of
// up to _DATA_CACHE_TTL afterwards. Nothing is purged and nothing needs to be:
// entries under the previous id are orphaned and age out on their own TTL.
// (A purge could never have done this job anyway — caches.default is per-colo,
// so it would only ever clear the one data centre that ran it. See the
// 2026-08-23 maintenance log for the three shapes that were rejected.)
//
// A fork whose wrangler.jsonc carries no version_metadata binding gets the
// constant token below and EXACTLY the old behaviour: a TTL-bounded stale
// window, never an error. The binding is two lines and ships in
// wrangler.example.jsonc, so every new fork has it from the start.
// Degrade, never throw — `env` is a plain object in the test suite.

const _DATA_CACHE_TTL = 300; // seconds

// The colo cache, or null where there is none (`caches` is a Workers global
// that the unit tests mostly leave undefined). A missing cache is "always a
// miss", never a fault.
export function edgeCache() {
  try {
    return (typeof caches !== 'undefined' && caches.default) || null;
  } catch {
    return null;
  }
}

// Run a cache write without holding the response (CLAUDE.md: side effects go
// under waitUntil). With no ctx it is still started, just not waited on, and a
// failure is swallowed: a cache that did not fill is a miss next time.
export function inBackground(ctx, promise) {
  const p = Promise.resolve(promise).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  return p;
}

// The deploy token every cache key is scoped by. Sanitised to [A-Za-z0-9-] so
// it is always one safe path segment whatever a future runtime puts in `id`,
// and clamped so a pathological value can't blow out the key. 'v0' is the
// no-binding fallback — a legible "this instance has no version token".
export function _deployToken(env) {
  const id = env && env.CF_VERSION_METADATA && env.CF_VERSION_METADATA.id;
  if (typeof id !== 'string') return 'v0';
  return id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || 'v0';
}

export async function loadDataJson(origin, env, path) {
  // No cache (a test, a non-Workers host) is a read straight from the assets.
  const cache = edgeCache();
  const cacheKey = new Request(`${origin}/__datacache/${_deployToken(env)}/${path}`);
  const hit = cache ? await cache.match(cacheKey) : null;
  if (hit) return hit.json();
  const res = await env.ASSETS.fetch(new Request(`${origin}/${path}`));
  if (!res.ok) {
    // Carry the status so callers can tell a MISSING file (404 — an un-seeded
    // fork ships without some data/*.json, see manual §5.21) from a transient
    // read failure. The feed maps 404 to an empty feed rather than a 503.
    const err = new Error(`fetch ${path} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.text();
  if (cache) {
    await cache.put(cacheKey, new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${_DATA_CACHE_TTL}` },
    }));
  }
  return JSON.parse(body);
}
