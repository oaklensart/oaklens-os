// Small text/format utilities shared by the edge HTML transform and the
// server-rendered pages (manifest, feed). Extracted from worker.js
// (decomposition, manual §6.7). Pure — no config, no I/O.

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function baseName(filename) {
  if (!filename) return '';
  return String(filename).replace(/\.[^.]+$/, '');
}

// The on-image FRAME stamp (field console `ymd()` / lighttable `localDate()`)
// renders the capture date with local getDate() calls, so on the photographer's
// machine it reads their own calendar day. This worker runs in UTC, so
// slicing the raw ISO string surfaces the UTC day instead and can land a day
// ahead (e.g. a frame shot 22:12 PT is 05:12Z the next morning). Format in the
// project's home timezone so server-rendered dates match the date baked into the
// card image. Bare YYYY-MM-DD values carry no time/zone, so pass them through
// untouched — converting them would shift the day backward.
//
// `tz` is an IANA zone name and comes from `siteConfig.timezone`.
//
// ⚠️ NO DEFAULT PARAMETER, deliberately — the same lesson src/shared/webring.js
// records at length. A default would have to name one instance's zone, and this
// module is imported by the engine every fork runs: until 2026-09-08 the zone
// was a hardcoded `PROJECT_TZ` constant naming the author's own city, so every
// fork on earth rendered that city's dates and mis-bucketed its frame days.
// Callers name the config they mean. This file also stays pure — no config
// import — because src/api/site-meta.js already imports from src/edge/chrome.js
// and both import this, so a config import here is a cycle waiting to happen.
//
// Two ways to have no usable zone, and both land on UTC:
//   - MISSING (undefined/'') → `tz || 'UTC'`, spelled out rather than left to
//     Intl. Passing `timeZone: undefined` does NOT throw: Intl quietly formats
//     in the HOST's zone, so a dropped argument returned the Worker's UTC in
//     production and the developer's own city on their laptop — an
//     environment-dependent date, and the kind of bug that only shows up in
//     someone else's timezone. Naming UTC makes the fallback the same
//     everywhere.
//   - INVALID (a typo like 'Europe/Berlyn') → throws inside Intl, caught below,
//     degrades to the raw date slice, which is UTC by construction.
// So a fork that misconfigures this gets UTC, never a stranger's calendar.
//
// ⚠️ ONE FORMATTER PER ZONE, KEPT. Building an Intl.DateTimeFormat costs ~80 µs
// and formatting with one costs almost nothing, and /api/buffer-summary calls
// this inside a sort comparator: 7,383 constructions per request on 731
// frames, ~0.5 s of CPU against the free plan's 10 ms (maintenance review
// 2026-10-15, W1). A zone that fails to construct is remembered as null, so a
// typo pays the throw once per isolate rather than once per call.
const _dayFormatters = new Map();
function _dayFormatter(tz) {
  const zone = tz || 'UTC';
  if (!_dayFormatters.has(zone)) {
    let f = null;
    try {
      // en-CA yields YYYY-MM-DD, matching the stamp format.
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      });
    } catch { /* invalid zone: the UTC slice below */ }
    _dayFormatters.set(zone, f);
  }
  return _dayFormatters.get(zone);
}

export function localDay(iso, tz) {
  if (!iso) return '';
  const s = String(iso);
  if (s.length <= 10 || !s.includes('T')) return s.slice(0, 10);
  const f = _dayFormatter(tz);
  if (!f) return s.slice(0, 10);
  try {
    return f.format(new Date(s));
  } catch {
    // An unparseable instant (format throws RangeError on Invalid Date).
    return s.slice(0, 10);
  }
}
