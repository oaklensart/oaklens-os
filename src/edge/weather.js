// ---- Weather (stale-while-revalidate; never blocks the response) ----
//
// The footer temp used to be `await`-ed on the hot path of every HTML response,
// so a cache miss stalled TTFB on the Open-Meteo round-trip. Now the request
// path only ever reads cache (instant); a stale/cold entry triggers a
// background refresh via ctx.waitUntil. The cache entry carries a long max-age
// so it stays servable, and our own `ts` field drives the 90-min freshness.
//
// Extracted from worker.js (decomposition, manual §6.7). Coordinates come from
// site.config.js → location.coords, so nothing here is instance-hardcoded.

import siteConfig from '../shared/config.js';

// The scale is in the key so switching `units` can't serve the old number for
// 90 minutes. Fahrenheit keeps the original key: every existing cache entry
// (and tests/card-address.test.js's seeded one) is fahrenheit.
const wxCacheKey = (origin) =>
  `${origin}/__wx_cache${temperatureUnit() === 'celsius' ? '_c' : ''}`;
const WX_FRESH_MS = 90 * 60 * 1000; // revalidate in the background after 90 min

// Read the cached temp without ever touching the upstream API.
// Returns { temp, stale } or null when the cache is cold.
export async function readCachedTemp(origin) {
  if (!weatherEnabled()) return null;
  const cached = await caches.default.match(new Request(wxCacheKey(origin)));
  if (!cached) return null;
  try {
    const { temp, ts } = await cached.json();
    if (typeof temp !== 'number') return null;
    return { temp, stale: !ts || (Date.now() - ts) > WX_FRESH_MS };
  } catch {
    return null;
  }
}

// Is there a place to report on? `[0, 0]` is the shipped default — both the
// engine backfill and the example config — and a real temperature for the sea
// off West Africa in a new fork's footer is worse than none (maintenance
// review 2026-10-15, D5). Anything that is not two finite numbers is off too.
export function weatherEnabled(location = siteConfig.location) {
  const c = location && location.coords;
  if (!Array.isArray(c) || c.length !== 2) return false;
  const [lat, lon] = c.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return !(lat === 0 && lon === 0);
}

// Open-Meteo's own unit names. Anything unrecognised reads as fahrenheit,
// which is what every site showed before the key existed.
export function temperatureUnit(location = siteConfig.location) {
  return location && location.units === 'celsius' ? 'celsius' : 'fahrenheit';
}

// One refresh per isolate at a time. While the entry is stale EVERY HTML
// request asks for one, and without this each of them started its own
// Open-Meteo call (maintenance review 2026-10-15, W6).
let _inflight = null;

// Fetch Open-Meteo and refresh the cache. Safe to run inside ctx.waitUntil.
export function refreshLocalTemp(origin) {
  if (!weatherEnabled()) return Promise.resolve();
  if (!_inflight) {
    _inflight = _refresh(origin).finally(() => { _inflight = null; });
  }
  return _inflight;
}

async function _refresh(origin) {
  try {
    const [lat, lon] = siteConfig.location.coords;
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=${temperatureUnit()}`
    );
    if (!res.ok) {
      console.error(`[wx] Open-Meteo responded ${res.status}`);
      return;
    }
    const json = await res.json();
    const temp = Math.round(json.current_weather.temperature);
    await caches.default.put(wxCacheKey(origin), new Response(
      JSON.stringify({ temp, ts: Date.now() }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } }
    ));
  } catch (err) {
    console.error('[wx] refresh failed:', err.message);
  }
}
