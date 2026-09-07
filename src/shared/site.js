// Config-derived helpers shared by worker.js and the portal worker.

import siteConfig from './config.js';
import { declaresShow } from './podcast.js';
import { escapeHtml } from './text.js';

// The CDN root for image/video assets: the configured custom domain, or the
// worker's own /api/cdn/* R2 proxy on the serving origin (the zero-config
// default for a fresh fork).
export function cdnBase(origin) {
  return (siteConfig.cdnBase || `${origin}/api/cdn`).replace(/\/+$/, '');
}

function attrEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

// ---- The wordmark ---------------------------------------------------------
//
// The site's brand as it is displayed: nav logo, footer, page <title>, console
// chrome. Config splits it in two (`wordmark: { stem, accent }`) so the accent
// half can be coloured by the surface's own class; a config without a wordmark
// falls back to `name`, which every fork has. Nothing here reaches markup
// directly — src/edge/chrome.js injects it, so served HTML stays neutral.
export function wordmark() {
  const w = siteConfig.wordmark || {};
  const stem = String(w.stem || siteConfig.name || '').trim();
  const accent = String(w.accent || '').trim();
  return { stem, accent, text: `${stem}${accent}` };
}

// The wordmark as markup, with the accent half wrapped so CSS can colour it
// (`.dot-art` in the nav, `.accent` in the footer). No class, or no accent half
// configured → plain escaped text, for surfaces that colour the whole thing.
export function wordmarkHtml(accentClass) {
  const { stem, accent, text } = wordmark();
  if (!accent || !accentClass) return escapeHtml(text);
  return `${escapeHtml(stem)}<span class="${escapeHtml(accentClass)}">${escapeHtml(accent)}</span>`;
}

// The footer's place line: "CITY, ST", or just the city when no region is
// configured. `location.region` is optional — a fork that only wants a city
// leaves it out.
export function locationLabel() {
  const loc = siteConfig.location || {};
  const name = String(loc.name || '').trim();
  const region = String(loc.region || '').trim();
  return region ? `${name}, ${region}` : name;
}

// Meta tags every HTML page gets, so client JS can resolve the CDN root, the
// default location and the site's own name/wordmark without hardcoding any of
// them. Prepended to <head> — some pages load scripts inside <head> that read
// these tags, so they must come first. The Atom link rides along so feed
// readers can autodiscover /feed.xml from any page (the worker's handleFeed
// renders it from data/posts.json).
//
// site-wordmark carries the whole wordmark (share titles, document.title);
// site-wordmark-accent carries just the accent half, so a canvas renderer that
// colours the two halves separately (the console's OG cards) can split it back
// apart without a second source of truth.
export function siteMetaTags(origin) {
  const mark = wordmark();
  return (
    `<meta name="cdn-base" content="${attrEscape(cdnBase(origin))}">` +
    `<meta name="site-location" content="${attrEscape(siteConfig.location.name)}">` +
    `<meta name="site-name" content="${attrEscape(siteConfig.name)}">` +
    `<meta name="site-wordmark" content="${attrEscape(mark.text)}">` +
    `<meta name="site-wordmark-accent" content="${attrEscape(mark.accent)}">` +
    // The Apple Music flag rides to the client the same way as the wordmark:
    // js/markdown-engine.js (post page AND console preview import it) reads
    // this to decide whether a bare share link becomes a player or stays a
    // plain link. CSP frame-src is the enforcement; this keeps the rendered
    // page honest about it.
    `<meta name="site-apple-music" content="${siteConfig.appleMusicEmbeds === true ? 'on' : 'off'}">` +
    `<link rel="alternate" type="application/atom+xml" title="${attrEscape(`${siteConfig.name} — Field Notes`)}" href="/feed.xml">` +
    // The podcast feed, for the crawlers and podcast apps that look for one.
    //
    // ⚠️ GATED ON CONFIG, NOT ON EPISODE COUNT, and it has to be: this runs
    // synchronously inside an HTMLRewriter element handler, which cannot await
    // a read of data/audio.json — and adding a data fetch to every HTML
    // response is exactly the hot-path cost the working agreement forbids. So
    // config declares the show for machines (an instance that filled in a
    // `podcast` block means to have one), while the human-facing Subscribe
    // block on /listen and the sitemap listing are both driven by the data.
    (declaresShow()
      ? `<link rel="alternate" type="application/rss+xml" title="${attrEscape(`${siteConfig.name} — Podcast`)}" href="/podcast.xml">`
      : '')
  );
}

// Entity JSON-LD for the homepage <head>: Organization (the brand as the
// public-facing entity) + WebSite (unlocks site-name display in results).
// Values come from site.config.js `entity`; URLs anchor to the configured
// canonical origin so the entity stays stable even when the page is served
// from an alias origin (*.workers.dev), falling back to the request origin
// on unconfigured forks. Returns '' when the config has no entity block.
export function entityJsonLd(origin) {
  const entity = siteConfig.entity;
  if (!entity) return '';

  const canonical = (siteConfig.url || origin).replace(/\/+$/, '');
  const orgId = `${canonical}/#organization`;

  const graph = [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: entity.name,
      url: `${canonical}/`,
      description: siteConfig.tagline,
      logo: `${canonical}${entity.logo}`,
      sameAs: entity.sameAs,
    },
    {
      '@type': 'WebSite',
      '@id': `${canonical}/#website`,
      name: entity.name,
      // The styled domain form (EXAMPLE.COM), derived from the canonical host.
      alternateName: new URL(`${canonical}/`).host.toUpperCase(),
      url: `${canonical}/`,
      publisher: { '@id': orgId },
    },
  ];

  // The engine this site runs on, as a node in the same graph — declared only
  // when `entity.codeRepository` names one.
  //
  // CONFIG-DERIVED, NOT HARDCODED, and that is the whole point. This function
  // ships to every fork, so a literal repo URL here would have every fork's
  // homepage publishing structured data claiming ITS source lives in somebody
  // else's repository. Nothing would have caught it either: the leak scan hunts
  // the wordmark, and a GitHub org slug is not the wordmark. Absent key, no
  // node, which is also the right default — a fork that has not published its
  // code has no repository to point a crawler at.
  if (entity.codeRepository) {
    graph.push({
      '@type': 'SoftwareSourceCode',
      '@id': `${canonical}/#engine`,
      name: entity.codeName || 'OAKLENS OS',
      description: `The open-source engine that powers ${new URL(`${canonical}/`).host}.`,
      codeRepository: entity.codeRepository,
      programmingLanguage: 'JavaScript',
      author: { '@id': orgId },
    });
  }

  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
    .replace(/</g, '\\u003c'); // never let markup break out of the script tag
  return `<script type="application/ld+json">${json}</script>`;
}
