// ---- Public page list + config-driven page gating ----
//
// Extracted from worker.js (decomposition, manual §6.7). Shared by the router,
// the sitemap, the nav injector, and the daily Wayback-archive cron — all of
// which need to know which public pages exist and which are switched off in
// site.config.js. worker.js re-exports pageDisabled/publicPages so the public
// contract (and tests/page-gate.test.js) is unchanged.

import siteConfig from './config.js';

// Every public page. Shared by the sitemap and the daily Wayback-archive cron.
export const PUBLIC_PAGES = ['/', '/about', '/archive', '/field-notes', '/support', '/wall'];

// `/dev/fixxer` is listed alongside `/dev` rather than left to be crawled off
// the index: the Fixxer page WAS `/dev` until 2026-09-20, so it was in the
// sitemap and in the daily Wayback run, and moving it a directory deeper would
// otherwise have dropped a real page out of both without anybody deciding to.
// It needs no PAGE_ROUTES entry of its own — `dev: '/dev'` already gates the
// whole subtree, so `pages.dev: false` still switches both off together.
//
// pages[key] === false turns a public page off end to end: the route 404s,
// the sitemap and Wayback cron drop it, and nav items pointing at it are
// filtered. A missing key means enabled, so existing configs change nothing.
// `listen` (the audio permalink + index) is deliberately absent from
// PUBLIC_PAGES above: an instance with no audio would otherwise advertise an
// empty page in its sitemap. handleSitemap adds it only when data/audio.json
// actually has something in it, so the page earns its listing rather than
// needing a fork to switch it off. It still lives here so `pages.listen:
// false` can turn it off end to end like any other page.
// `card` (/card/<id>, one composed card at its own address) is absent for the
// same reason and one more: bare /card is not a page at all — there is no
// index of cards, only addresses — so the sitemap lists the live ids it finds
// and nothing else.
export const PAGE_ROUTES = {
  archive: '/archive', fieldNotes: '/field-notes', wall: '/wall',
  about: '/about', support: '/support',
  listen: '/listen', card: '/card',
};

// Console infrastructure under /dev/ that must never be gated — disabling the
// public /dev page must not lock the owner out of their own console.
export const CONSOLE_PATHS = [
  '/dev/field-console', '/dev/console-gate.html', '/dev/sw.js',
  '/dev/manifest.webmanifest', '/dev/icon-180.png', '/dev/icon.svg',
];

export function pageDisabled(pathname) {
  const pages = siteConfig.pages;
  if (!pages) return false;
  if (CONSOLE_PATHS.some((p) => pathname === p || pathname.startsWith(p))) return false;
  for (const [key, root] of Object.entries(PAGE_ROUTES)) {
    if (pages[key] === false && (pathname === root || pathname.startsWith(root + '/'))) return true;
  }
  return false;
}

export function publicPages() {
  return PUBLIC_PAGES.filter((p) => !pageDisabled(p));
}
