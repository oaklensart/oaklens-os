// ---- Content-Security-Policy ----
// Set per-response in the Worker (not in _headers) so it can be config-derived
// and differ by surface. The public site runs a strict script-src: no
// 'unsafe-inline', with the one inline block every page needs — the pre-paint
// mode-resolution script in <head> — allowed by its sha256 hash. /dev (the
// Field Console) and /c/ (the portal) still carry inline logic, so they get a
// relaxed policy that keeps 'unsafe-inline'.
//
// PREPAINT_CSP_HASH must match the byte-exact contents of that inline block;
// tests/csp.test.js recomputes it from the served pages and fails if it drifts.

import siteConfig from './config.js';
import { cdnBase } from './site.js';

export const PREPAINT_CSP_HASH = "'sha256-eKGihvdTeSS/Kojs21/kofBNpwKQjXgvZtiAkYR2Z4c='";

// The console's two pinned, SRI'd libraries (exifr + jszip) load from jsDelivr.
// That is a /dev need only — the published site ships zero third-party runtime
// JS — so the host belongs on the relaxed policy and nowhere else. It sat in
// the strict policy until 2026-08-06, quietly pre-authorizing a CDN for every
// public page that has no business calling one.
const CONSOLE_LIB_HOST = 'https://cdn.jsdelivr.net';

// Cloudflare Web Analytics. The beacon is third-party runtime JS, so it cannot
// be a default on the public site — it is opt-in per instance via
// `site.config.js` → `webAnalytics: true`, the same config-derived shape
// `cdnBase` uses. Off (the shipped default) means the strict policy names no
// third-party host at all. If the beacon is enabled in the Cloudflare dashboard
// but this flag is not set, Cloudflare's auto-injected script is CSP-blocked —
// deliberately: the launch claim is checkable by reading the policy.
const ANALYTICS_SCRIPT_HOST = 'https://static.cloudflareinsights.com';
const ANALYTICS_CONNECT_HOST = 'https://cloudflareinsights.com';

// Apple Music players in Field Notes. Same shape as webAnalytics: a
// third-party host cannot be a default, so the allowance is opt-in per
// instance via `site.config.js` → `appleMusicEmbeds: true`. It sat in the
// policy unconditionally until 2026-08-07, naming a third-party host on every
// surface of every fork. Off (the shipped default) the directive is
// `frame-src 'none'` — NOT omitted: this policy has no default-src, so a
// missing frame-src would mean unrestricted framing, widening instead of
// narrowing. The renderer (js/markdown-engine.js) mirrors the flag via a
// worker-injected meta and degrades bare share links to plain links; this
// directive is the enforcement, that fallback is honesty.
const APPLE_MUSIC_FRAME_HOST = 'https://embed.music.apple.com';

export function buildCsp(origin, strict) {
  // Instance CDN host (site.config.js cdnBase, or same-origin /api/cdn on a
  // fork) — the only identity-specific token, derived not hardcoded.
  const cdnHost = new URL(cdnBase(origin)).origin;
  const analytics = siteConfig.webAnalytics === true;
  const appleMusic = siteConfig.appleMusicEmbeds === true;
  const scriptSrc = [
    'script-src',
    "'self'",
    ...(strict ? [PREPAINT_CSP_HASH] : ["'unsafe-inline'", CONSOLE_LIB_HOST]),
    ...(analytics ? [ANALYTICS_SCRIPT_HOST] : []),
  ].join(' ');
  const connectSrc = [
    'connect-src',
    "'self'",
    ...(strict ? [] : [CONSOLE_LIB_HOST]),
    ...(analytics ? [ANALYTICS_CONNECT_HOST] : []),
  ].join(' ');
  return [
    // The catch-all. Until 2026-08-07 this policy named no default-src, which
    // meant every directive it did NOT list was unrestricted — style-src and
    // font-src among them. So the policy that enforces "zero third-party
    // runtime" enforced it for scripts and images while a third-party
    // stylesheet or font sailed through. A fetch type nobody has thought of yet
    // now lands on 'self' instead of on nothing.
    "default-src 'self'",
    // None of these three fall back to default-src — the spec gives them no
    // fallback at all — so leaving them out is the same unrestricted default.
    // base-uri closes the <base> rewrite that turns one injected tag into a
    // site-wide redirect; frame-ancestors is the CSP half of X-Frame-Options
    // (see STATIC_SECURITY_HEADERS, which the Worker's hand-built responses
    // used to miss entirely).
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `frame-src ${appleMusic ? APPLE_MUSIC_FRAME_HOST : "'none'"}`,
    // Images: self + the configured CDN only. No third-party host belongs here.
    // One did until 2026-08-05 — a QR-code service the support page called to
    // render its donate links — which handed every visitor's IP to a party
    // nobody chose and rendered as broken images in the offline site export.
    `img-src 'self' ${cdnHost} data: blob:`,
    `media-src 'self' ${cdnHost} data: blob:`,
    // 'unsafe-inline' is load-bearing here and not a hole: the public pages
    // carry <style> blocks and style="…" attributes, and CSS style attributes
    // need it. It costs nothing that matters — script-src is hash-locked, so
    // there is no gadget to style — while naming the directive at all is what
    // stops a fork from pulling a stylesheet off a third-party host.
    "style-src 'self' 'unsafe-inline'",
    // Every face is self-hosted from /fonts/ (see css/main.css @font-face).
    "font-src 'self'",
    scriptSrc,
    "worker-src 'self' blob:",
    connectSrc,
  ].join('; ');
}

// Static security headers. `_headers` declares these too, but that file only
// reaches responses Workers Assets serves — every Response the Worker builds
// from scratch (the console login gate, a config-gated 404, every JSON API
// reply) shipped without them, including X-Frame-Options on the one page you
// least want framed. This is the single source of the set; securityHeaders()
// below is how a hand-built Response gets it.
export const STATIC_SECURITY_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

/**
 * The full header set for a response the Worker builds itself: the static
 * headers plus the surface-appropriate CSP. Spread it into a `headers` object
 * literal, or iterate it onto an existing Response.
 * @param {string} origin request origin (the CSP's CDN host is derived from it)
 * @param {boolean} strict false only for the admin surfaces (/dev, /c/)
 */
export function securityHeaders(origin, strict) {
  return { ...STATIC_SECURITY_HEADERS, 'Content-Security-Policy': buildCsp(origin, strict) };
}

// Copy a response and stamp the surface-appropriate CSP plus the static
// security headers. /dev + /c/ keep 'unsafe-inline'; everything else is strict.
//
// ⚠️ SEGMENT MATCH, NOT PREFIX MATCH. This was `startsWith('/dev')` until
// 2026-09-16, which is true of `/devlog`, `/developer` and anything else a
// future page might be called — and each would have been handed the ADMIN
// CSP, quietly re-allowing 'unsafe-inline' on a public page. Nothing named
// that exists today; the point is that adding one would have been silent.
// `/c/` was always written with its slash and was never exposed.
const isAdminSurface = (pathname) =>
  pathname === '/dev' || pathname.startsWith('/dev/');

export function withCsp(resp, origin, pathname) {
  const strict = !isAdminSurface(pathname);
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(securityHeaders(origin, strict))) r.headers.set(k, v);
  return r;
}
