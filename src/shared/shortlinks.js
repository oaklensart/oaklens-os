// ---- Branded short links ----
//
// `site.config.js` → `shortLinks: { demo: 'https://…' }` makes `<origin>/demo`
// a 302 to that URL. It exists so an instance can hand out a link on its OWN
// domain — in a post, on a card, said out loud — instead of a generated
// hostname nobody can remember or trust, and can re-point it later without
// reprinting anything that already went out.
//
// WHY THIS AND NOT THE PORTAL'S `/p/<code>`: that one is a D1-backed, hashed,
// expiring capability that mints a session cookie, so it has to live in a
// database. These carry no secret at all — they are public signposts — so they
// belong in versioned config, where a fork can read its own redirects out of a
// diff and revert one with `git revert`.
//
// THE ORDER MATTERS. The router consults this AFTER every worker-owned route
// and BEFORE the asset layer, which is the only placement where a bare
// `/demo` can work at all — but it also means a code could shadow a real page.
// Two guards, because a config typo is silent and "why is /about a redirect
// now" is a bad afternoon:
//   - resolve time: a code must be one plain lowercase segment, and must not
//     be a public page or a worker/asset prefix (RESERVED below).
//   - CI: tests/shortlinks.test.js walks the repo's actual top-level entries
//     and fails if a configured code collides with any file or directory on
//     disk, so the list below cannot drift behind a newly added folder.
//
// The redirect is 302 + no-store on purpose. These are meant to be re-pointed
// (a demo moves, a fork gets its own domain), and a 301 that a browser cached
// for a year is a link you no longer own.

import siteConfig from './config.js';
import { PUBLIC_PAGES } from './pages.js';

// One plain segment: lowercase letters, digits and hyphens, 1–32 chars. No
// slashes, no dots — a code with a dot reads as a file to every asset layer
// and every link parser that has to guess where the URL ends.
const CODE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// Worker-owned routes and served asset directories. Public pages come from
// PUBLIC_PAGES so this list never has to repeat them.
export const RESERVED_SEGMENTS = Object.freeze([
  'api', 'c', 'p', 'dev', 'assets', 'audit', 'css', 'data', 'docs', 'fonts',
  'img', 'js', 'migrations', 'portal', 'posts', 'scripts', 'src', 'tests',
  '.well-known',
]);

const RESERVED = new Set([
  ...RESERVED_SEGMENTS,
  ...PUBLIC_PAGES.map((p) => p.replace(/^\//, '')).filter(Boolean),
]);

/** Config keys, lowercased once — the lookup is case-insensitive either side. */
const TABLE = new Map(
  Object.entries(siteConfig.shortLinks || {})
    .map(([code, target]) => [String(code).toLowerCase(), target]),
);

// Optional hostname scope (`site.config.js` → `shortLinkHost`). A fork has one
// domain and leaves this empty, so its links answer wherever the site answers.
// An instance that runs a second hostname for a different side of what it does
// sets the prefix of the host the links belong to, and then the other hostname
// keeps those paths for itself — a link that answers on both is two addresses
// for one destination, which is exactly what the split was drawn to avoid.
//
// A PREFIX, matched the same way the router's `os.` block matches, so it stays
// domain-agnostic: `'os.'` and `'os.example.com'` both work, and neither
// hardcodes an apex. Note it also means short links do not resolve on
// `localhost` — check them against the real host, or with `curl -H Host:`.
const HOST_SCOPE = String(siteConfig.shortLinkHost || '');

/**
 * The absolute URL a request path should redirect to, or null for "not a short
 * link" — which is every path on a site that configures none.
 * @param {string} pathname request pathname, e.g. `/demo` or `/demo/`
 * @param {string} [hostname] request hostname, checked against `shortLinkHost`
 * @returns {string|null}
 */
export function resolveShortLink(pathname, hostname = '') {
  if (!TABLE.size) return null;
  if (HOST_SCOPE && !String(hostname).startsWith(HOST_SCOPE)) return null;
  const code = pathname.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  if (!CODE_RE.test(code) || RESERVED.has(code)) return null;
  const target = TABLE.get(code);
  if (typeof target !== 'string') return null;
  // Absolute http(s) only. The value is owner-written, so this is not a trust
  // boundary — it is a typo boundary: a relative path or a `javascript:` paste
  // would either loop through this same resolver or ship a redirect the
  // browser refuses, and both fail as a blank page nobody can diagnose.
  try {
    const url = new URL(target);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
