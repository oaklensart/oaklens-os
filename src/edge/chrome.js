// ---- Edge HTML transform: per-frame Open Graph + config-driven site chrome ----
//
// Extracted from worker.js (decomposition, manual §6.7). Two jobs, both run via
// HTMLRewriter on every HTML response:
//   1. Per-frame OG/twitter tags (link-preview crawlers strip the #fragment, so
//      a frame's identity rides in a `?f=`/`?slug=` query the server resolves).
//   2. Site chrome — meta tags, nav, mailto, split/folio heroes, the support
//      page's tiers, absolute og: URLs — filled from site.config.js so the
//      static HTML carries no identity.
//
// worker.js re-exports _navLinksHtml for tests/page-gate.test.js.

import siteConfig from '../shared/config.js';
import { cdnBase, siteMetaTags, entityJsonLd, wordmark, wordmarkHtml, locationLabel } from '../shared/site.js';
import { pageDisabled } from '../shared/pages.js';
import { webringNode, ringNodeId, ringHref } from '../shared/webring.js';
import { escapeHtml, localDay } from '../shared/text.js';
import { loadDataJson } from './data.js';

export const OG_IMG_WIDTH = 1024;        // CDN has 480 / 1024 / 2048 variants
export const HERO_PRELOAD_WIDTH = 2048;  // full-res hero preload for post pages

// Both archive frames and rolling-buffer frames live under the same /archive/
// CDN prefix (see js/lighttable.js — CDN = '…/archive').
export function _frameImg(origin, filename, width) {
  if (!filename) return null;
  const base = encodeURIComponent(String(filename).replace(/\.[^.]+$/, ''));
  return `${cdnBase(origin)}/archive/${base}-${width}w.webp`;
}

// OG card override. The field console can stamp a branded 1200x630 card for a
// frame and upload it to meta/<base>-og.webp. When one exists it becomes the
// og:image — it already bakes in the photo + FRAME // date + wordmark rail, so
// platforms show a consistent, on-brand unfurl. Falls back to the raw frame.
// Keyed by image basename so a buffer frame and its archived copy share a card.
function _cardKey(filename) {
  if (!filename) return null;
  return `meta/${String(filename).replace(/\.[^.]+$/, '')}-og.webp`;
}
// Whether a stamped OG card exists for this frame. The R2 head() used to run on
// every unfurl; cache the boolean at the edge (short TTL) so repeat crawls skip
// the round-trip. A freshly stamped card may take up to the TTL to surface.
const _OG_CACHE_TTL = 300; // seconds
async function _cardExists(env, origin, key) {
  if (!key) return false;
  try {
    const cache = caches.default;
    const ck = new Request(`${origin}/__cardexists/${key}`);
    const cached = await cache.match(ck);
    if (cached) return (await cached.text()) === '1';
    const exists = !!(await env.CDN.head(key));
    await cache.put(ck, new Response(exists ? '1' : '0', {
      headers: { 'Cache-Control': `public, max-age=${_OG_CACHE_TTL}` },
    }));
    return exists;
  } catch (err) {
    console.error('[og] card head failed:', err.message);
    return false;
  }
}
export async function _ogImage(env, origin, filename) {
  const key = _cardKey(filename);
  if (key && await _cardExists(env, origin, key)) return `${cdnBase(origin)}/${key}`;
  return _frameImg(origin, filename, OG_IMG_WIDTH);
}

// The audio equivalent, keyed by slug (a track has no image basename to key
// off). Returns null rather than a fallback when no card has been stamped:
// audio has no photograph to fall back TO, and injectOg skips a null, so the
// page's own og:image stands and the link unfurls as the site instead of as a
// broken image.
export async function _audioOgImage(env, origin, slug) {
  if (!slug) return null;
  const key = `meta/audio-${slug}-og.webp`;
  return (await _cardExists(env, origin, key)) ? `${cdnBase(origin)}/${key}` : null;
}

// Parse a field-notes post's frontmatter into a flat field map (or null).
export async function getPostMeta(url, env) {
  const slug = url.searchParams.get('slug');
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return null;
  try {
    const mdRes = await env.ASSETS.fetch(new Request(`${url.origin}/posts/${slug}.md`));
    if (!mdRes.ok) return null;
    const content = await mdRes.text();
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const fields = {};
    for (const line of m[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        fields[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
    return fields.hero ? fields : null;
  } catch {
    return null;
  }
}

// Resolve { title, description, image, ogUrl } for an archive/buffer frame, or
// null if there's no `?f=` param or no matching entry.
export async function getFrameOgData(url, env, page) {
  const f = url.searchParams.get('f');
  if (!f) return null;
  try {
    if (page === 'archive') {
      const data = await loadDataJson(url.origin, env, 'data/archive.json');
      const e = Array.isArray(data) && data.find(x => x.slug === f);
      if (!e) return null;
      return {
        title: `${e.title || 'Frame'} — ${siteConfig.name.toUpperCase()}`,
        description: [e.sub, e.location].filter(Boolean).join(' · ') || siteConfig.tagline,
        image: await _ogImage(env, url.origin, e.filename),
        ogUrl: `${url.origin}/archive/?f=${encodeURIComponent(f)}`,
      };
    }
    if (page === 'buffer') {
      const data = await loadDataJson(url.origin, env, 'data/buffer.json');
      const e = Array.isArray(data) && data.find(x => x.id === f);
      if (!e) return null;
      const day = localDay(e.captured_at || e.published_at, siteConfig.timezone);
      return {
        // Quiet title: the domain row already shows the site's own host, and
        // the card image carries the FRAME // date branding — so the title
        // de-screams to just the project name (no site-name echo).
        title: 'The Rolling Buffer',
        description: ['Capture first. Process later.', day].filter(Boolean).join(' · '),
        image: await _ogImage(env, url.origin, e.filename),
        ogUrl: `${url.origin}/archive/buffer/?f=${encodeURIComponent(f)}`,
      };
    }
  } catch (err) {
    console.error('[og] resolve failed:', err.message);
  }
  return null;
}

// Resolve { title, description, image, ogUrl } for one track on /listen, or
// null when there's no `?a=` param or no matching registry entry (bare /listen
// is the index, and keeps the page's own tags).
export async function getAudioOgData(url, env) {
  const a = url.searchParams.get('a');
  // Bare /listen is the index. It still returns og data (rather than null) so
  // the page gets exactly ONE injected block either way — shipping static tags
  // as well would duplicate og:title on the per-track view, and crawlers take
  // the first one they find.
  const indexOg = {
    type: 'website',
    title: `Listen — ${siteConfig.name.toUpperCase()}`,
    description: siteConfig.tagline || 'Audio.',
    image: null,
    ogUrl: `${url.origin}/listen`,
  };
  if (!a || !/^[a-z0-9-]+$/i.test(a)) return indexOg;
  try {
    const data = await loadDataJson(url.origin, env, 'data/audio.json');
    // `x.filename` is not decoration: a RETIRED track is a tombstone carrying a
    // reserved slug and no media (manual §3.9), so matching on slug alone would
    // unfurl a share link with the title of something that no longer plays.
    const e = Array.isArray(data) && data.find((x) => x && x.slug === a && x.filename);
    if (!e) return indexOg;
    const mins = e.duration > 0 ? `${Math.max(1, Math.round(e.duration / 60))} min` : '';
    return {
      title: `${e.title || 'Audio'} — ${siteConfig.name.toUpperCase()}`,
      description: [e.sub, mins].filter(Boolean).join(' · ') || siteConfig.tagline,
      image: await _audioOgImage(env, url.origin, e.slug),
      ogUrl: `${url.origin}/listen/?a=${encodeURIComponent(a)}`,
    };
  } catch (err) {
    console.error('[og] audio resolve failed:', err.message);
  }
  return indexOg;
}

// Inject per-frame og:/twitter: tags. Buffer already ships a static default
// card, so for it we override the existing tags' content; archive and post
// pages have no tags, so we append a fresh block.
export function injectOg(rewriter, og, hasExistingTags) {
  if (hasExistingTags) {
    const set = (sel, val) =>
      rewriter.on(sel, { element(el) { if (val != null) el.setAttribute('content', val); } });
    set('meta[property="og:title"]', og.title);
    set('meta[property="og:description"]', og.description);
    set('meta[property="og:image"]', og.image);
    set('meta[property="og:url"]', og.ogUrl);
    set('meta[name="twitter:title"]', og.title);
    set('meta[name="twitter:description"]', og.description);
    set('meta[name="twitter:image"]', og.image);
    return;
  }
  // A field with no value is OMITTED rather than stamped. Frames and posts
  // always resolve an image, but audio only has one once a waveform card has
  // been stamped — and `<meta property="og:image" content="null">` is a
  // broken-image unfurl, which is worse than no image tag at all.
  const tag = (attr, name, val) =>
    (val == null || val === '') ? null : `<meta ${attr}="${name}" content="${escapeHtml(val)}">`;
  const tags = [
    tag('property', 'og:type', og.type || 'article'),
    tag('property', 'og:title', og.title),
    tag('property', 'og:description', og.description),
    tag('property', 'og:image', og.image),
    tag('property', 'og:url', og.ogUrl),
    tag('name', 'twitter:card', og.image ? 'summary_large_image' : 'summary'),
    tag('name', 'twitter:title', og.title),
    tag('name', 'twitter:description', og.description),
    tag('name', 'twitter:image', og.image),
  ].filter(Boolean).join('\n');
  rewriter.on('head', { element(el) { el.append(tags, { html: true }); } });
}

// ---- Site chrome injection (config-driven, every HTML response) ----
//
// Keeps the static HTML free of hardcoded identity: pages carry placeholder
// nav/mailto/brand markup and root-relative asset paths, and the edge fills in
// the real values from site.config.js + the request origin. Injected per request:
//   - <meta name="cdn-base"> / site-location / site-name / site-wordmark for
//     client JS
//   - the nav bar (desktop .nav-links + mobile .nav-mobile) from config.nav
//   - the contact address on every mailto: link from config.email
//   - the wordmark: page <title>, nav logo, footer brand, og:/twitter: title
//     fallbacks — see injectWordmark
//   - the support page's tiers, blurb and footer note from config.support
//   - absolute og:/twitter: URLs (crawlers require absolute URLs; the HTML
//     stores root-relative paths so pages work on any origin)

function _navActive(href, pathname) {
  if (href === '/') return pathname === '/' || pathname === '/index.html';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function _navLinksHtml(pathname) {
  const links = _enabledNav().map((item) => {
    const cls = ['nav-link', item.class, _navActive(item.href, pathname) ? 'active' : '']
      .filter(Boolean).join(' ');
    return `<a href="${escapeHtml(item.href)}" class="${cls}">${escapeHtml(item.label)}</a>`;
  });
  links.push(`<a href="mailto:${escapeHtml(siteConfig.email)}" class="nav-mail" title="Contact">&#9993;</a>`);
  if ((siteConfig.theme || {}).toggle !== false) links.push(_modeToggleHtml());
  return links.join('\n    ');
}

// Rendered only when theme.toggle is on — pages carry no toggle markup, so a
// toggle-off config leaves nothing to hide. Behavior lives in js/mode-toggle.js.
function _modeToggleHtml() {
  return '<button class="mode-toggle" type="button" aria-label="Switch light/dark mode">&#9680;</button>';
}

// The pages{} map is the single source of truth — nav items pointing at a
// disabled page drop out at the edge, whatever the config's nav[] says.
function _enabledNav() {
  return siteConfig.nav.filter((item) => !pageDisabled(item.href.split(/[?#]/)[0]));
}

function _navMobileHtml(pathname) {
  const links = _enabledNav().map((item) => {
    const active = _navActive(item.href, pathname) ? ' class="active"' : '';
    return `<a href="${escapeHtml(item.href)}"${active}>${escapeHtml(item.label)}</a>`;
  });
  links.push(`<a href="mailto:${escapeHtml(siteConfig.email)}">&#9993; Contact</a>`);
  if ((siteConfig.theme || {}).toggle !== false) links.push(_modeToggleHtml());
  return links.join('\n  ');
}

// The display-font preload in each page's <head> (data-font-preload) is
// retargeted to the active preset's face so the LCP-critical font starts
// downloading immediately regardless of which preset the config picks.
const PRESET_DISPLAY_FONT = {
  'aperture': '/fonts/archivo-latin-var.woff2',
  'passe-partout': '/fonts/fraunces-latin-var.woff2',
  'noir': '/fonts/syne-latin-var.woff2',
  'selenium': '/fonts/fraunces-latin-var.woff2',
  'cyanotype': '/fonts/fraunces-latin-var.woff2',
};

// Homepage split hero (noir preset). Values come from site.config.js →
// splitHero and are edge-injected here, so index.html ships neutral hero markup
// with no identity. Wired only when the config block exists: the data-split-hero
// flag it stamps on <html> is what flips noir from the folio hero to the split
// hero (main.css), so a fork that omits splitHero falls back to the folio hero.
// The .hero-headline / .hero-cta selectors match both the desktop panels and
// the mobile stack, so each is filled once here. setAttribute/setInnerContent
// escape their inputs, so raw config values are safe.
function injectSplitHero(rewriter) {
  const sh = siteConfig.splitHero;
  if (!sh || !sh.code || !sh.photo) return;
  const { code, photo } = sh;

  rewriter.on('html', { element(el) { el.setAttribute('data-split-hero', ''); } });

  // Code / tool panel.
  rewriter.on('.hero-panel--code .hero-panel-bg', {
    element(el) {
      el.setAttribute('style',
        `background-image: url('${code.image}');` +
        (code.imagePosition ? ` background-position: ${code.imagePosition};` : ''));
    },
  });
  rewriter.on('.hero-headline--labeled', { element(el) { el.setInnerContent(code.headline || ''); } });
  rewriter.on('a.hero-cta--os', {
    element(el) {
      el.setAttribute('href', (code.cta && code.cta.href) || '#');
      if (code.cta && code.cta.ariaLabel) el.setAttribute('aria-label', code.cta.ariaLabel);
    },
  });
  rewriter.on('.hero-cta--os .os-cta-badge', {
    element(el) { el.setInnerContent((code.cta && code.cta.label) || ''); },
  });

  // Photo panel.
  rewriter.on('.hero-panel--photo .hero-panel-bg', {
    element(el) { el.setAttribute('style', `background-image: url('${photo.image}');`); },
  });
  rewriter.on('.hero-headline--open', { element(el) { el.setInnerContent(photo.headline || ''); } });
  rewriter.on('a.hero-cta--gallery', {
    element(el) {
      el.setAttribute('href', (photo.cta && photo.cta.href) || '#');
      el.setInnerContent((photo.cta && photo.cta.label) || '');
    },
  });

  // Preload the code-panel image (LCP) — appended here so index.html ships no
  // hero image reference of its own.
  rewriter.on('head', {
    element(el) {
      el.append(
        `<link rel="preload" as="image" href="${escapeHtml(code.image)}" fetchpriority="high">`,
        { html: true }
      );
    },
  });
}

// ---- The support page's tiers ----
//
// Where the money goes is identity, in the same way the wordmark is: until
// 2026-08-05 `support/index.html` carried four live checkout links typed
// straight into the markup, so any fork of the engine shipped a support page
// that paid THIS instance's owner. The copy was just as instance-specific ("one
// very necessary espresso"). All of it is now `site.config.js` → `support`, and
// the page ships a neutral placeholder grid the edge replaces — same posture as
// the nav (_navLinksHtml).
//
// No tiers configured is a real state, not an error: the grid renders the
// site-wide empty-state idiom rather than leaving placeholders on screen
// pretending to be someone's donation options.

// A string or a list of lines -> escaped HTML, one <br> between lines.
function _lines(value) {
  return [].concat(value ?? [])
    .map((line) => String(line).trim())
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>');
}

function _tierCardHtml(tier) {
  const price = [
    escapeHtml(tier.price || ''),
    tier.per ? `<span class="sub">${escapeHtml(tier.per)}</span>` : '',
  ].filter(Boolean).join(' ');
  const body = [
    tier.icon ? `<div class="tier-icon">${escapeHtml(tier.icon)}</div>` : '',
    `<div class="tier-name">${escapeHtml(tier.name || '')}</div>`,
    price ? `<div class="tier-price">${price}</div>` : '',
    `<div class="tier-desc">${escapeHtml(tier.desc || '')}</div>`,
  ].filter(Boolean).join('\n      ');
  // rel="noopener" on every outbound checkout link; a tier with no url is a
  // card, not a dead <a>.
  return tier.url
    ? `<a href="${escapeHtml(tier.url)}" target="_blank" rel="noopener" class="tier-card">\n      ${body}\n    </a>`
    : `<div class="tier-card">\n      ${body}\n    </div>`;
}

// Takes the config block rather than reading it, so the states that matter —
// no tiers, no support block at all — are drivable in a test against a frozen
// config (same reason _navLinksHtml takes a pathname).
export function _supportTiersHtml(support = siteConfig.support) {
  const tiers = (support || {}).tiers;
  if (!Array.isArray(tiers) || !tiers.length) {
    return '<div class="page-empty">// NO SUPPORT TIERS YET'
      + '<span class="page-empty-hint">Add them to site.config.js &rarr; support.tiers.</span></div>';
  }
  return `\n    ${tiers.map(_tierCardHtml).join('\n\n    ')}\n  `;
}

// Registered on every HTML response, like the nav: `.tier-grid` and the two
// footer hooks exist only on the support page, so the handlers are inert
// everywhere else — including when the page is switched off in pages{} and the
// 404 document is served in its place.
export function injectSupport(rewriter, support = siteConfig.support || {}) {
  rewriter.on('.tier-grid', {
    element(el) { el.setInnerContent(_supportTiersHtml(support), { html: true }); },
  });

  // Blurb: the markup's own generic copy stands when none is configured, so a
  // fork that enabled the page but hasn't written its pitch yet still reads.
  const blurb = _lines(support.blurb);
  if (blurb) {
    rewriter.on('[data-support-blurb]', {
      element(el) {
        el.setInnerContent(blurb, { html: true });
        el.removeAttribute('data-support-blurb');
      },
    });
  }

  // The footer line and its disclaimer are decoration around a payment
  // processor nobody else uses — with nothing configured they come out
  // entirely rather than leaving stray `//` marks behind.
  const note = _lines(support.note);
  rewriter.on('[data-support-note]', {
    element(el) {
      if (!note) return el.remove();
      el.setInnerContent(
        `<span class="accent">//</span> ${note} <span class="accent">//</span>`, { html: true });
      el.removeAttribute('data-support-note');
    },
  });
  const disclaimer = _lines(support.disclaimer);
  rewriter.on('[data-support-disclaimer]', {
    element(el) {
      if (!disclaimer) return el.remove();
      el.setInnerContent(disclaimer, { html: true });
      el.removeAttribute('data-support-disclaimer');
    },
  });
}

// ---- Footer chips: attribution + webring membership ----
//
// Two small hairline chips in the homepage footer, both edge-injected from a
// single `<span data-site-chips>` hook so the served markup carries neither.
//
// One hook, not two, and not a `.footer-right` handler: that class exists on
// every page in the tree, so keying off it would silently widen a one-page
// feature to nine. Placement is the scope. It also keeps the pair as one unit —
// one handler owns the ordering, the spacing and the both-off case.
//
// The OS chip is the template's only self-promotion, and it is deliberately two
// letters: enough for someone who wonders what this site runs on to click,
// quiet enough that nobody else's site reads as an advertisement. `poweredBy:
// false` removes it — MIT never required it, and a fork should not feel stuck
// carrying it.
//
// Both reuse `.powered-chip` verbatim (css/main.css), so the ring chip is the
// same object as the attribution chip and the footer reads as one system —
// and no stylesheet change means no cache-bust across every page.
const OS_PROJECT_URL = 'https://github.com/oaklensart';

// Takes the whole config rather than reading it, so on/off/both-off are
// drivable against a frozen object (same reason as _supportTiersHtml).
export function _footerChipsHtml(config = siteConfig) {
  const chips = [];

  if (config.poweredBy !== false) {
    chips.push(
      `<a class="powered-chip" href="${OS_PROJECT_URL}" rel="noopener"`
      + ` title="Built with Oaklens OS" aria-label="Built with Oaklens OS">OS</a>`);
  }

  // webringNode() returns null for any half-filled block, so a config that is
  // mid-edit renders nothing rather than a chip pointing at a seat that isn't
  // yours. Note node 0 is a real seat — see the guard in shared/webring.js.
  const node = webringNode(config.webring);
  if (node) {
    const id = ringNodeId(node.node);
    const label = `Member of the ANALOGS network — node ${id}`;
    chips.push(
      `<a class="powered-chip" href="${escapeHtml(ringHref(node))}" rel="noopener"`
      + ` title="${label}" aria-label="${label}">ANALOGS <strong>//${id}</strong></a>`);
  }

  return chips.join('');
}

// Registered on every HTML response like the nav and the support hooks. The
// placeholder lives only in the homepage footer, so this is inert everywhere
// else — including on the 404 document served in a gated page's place.
export function injectFooterChips(rewriter, config = siteConfig) {
  const html = _footerChipsHtml(config);
  rewriter.on('[data-site-chips]', {
    element(el) {
      // Nothing configured: take the placeholder out rather than leave an
      // empty span trailing the footer text (same posture as [data-support-note]).
      if (!html) return el.remove();
      el.setInnerContent(html, { html: true });
      el.removeAttribute('data-site-chips');
    },
  });
}

// ---- The Field Console's optional surfaces ----
//
// A console surface can be real, working, auth-gated code and still be useless
// to anybody but this instance. The bench (§5.14) is the case that forced this:
// its only feeder is `scripts/bench-upload.sh`, a macOS CLI that does NOT travel
// with the engine, so a fork inherited a BENCH tab it could never put a frame
// into — a dead surface reading "BENCH EMPTY // no frames in queue" forever.
// It returns as a designed v2 (docs/bench-decision.md); until then it is off
// for everyone but the owner.
//
// Cutting the module out of the extraction was the alternative, and it would
// mean asserted patches against the console barrel, init.js's view registration
// and the shell markup — structural fork-vs-instance divergence in the most
// fragile part of the tree, re-broken by every future console change. So the
// engine keeps ONE console and the config decides what it shows.
//
// The switch is OPT-IN — the opposite of pages{}, where a missing key means
// enabled. A fork's config says nothing about `console`, so a fork ships
// without these surfaces, which is the entire point.
//
//   site.config.js -> console: { bench: true }
//
// The markup carries `data-console-feature="<name>"`; the edge strips the hook
// (on) or removes the element outright (off), same posture as the support
// page's tiers. Only the SHELL is gated: the /api/bench routes stay mounted
// either way. They are Bearer-gated already, and a second, weaker
// authorization story next to the real one is worse than no second story.
export function consoleFeatureOn(name, features = siteConfig.console) {
  return (features || {})[name] === true;
}

export function injectConsoleFeatures(rewriter, features = siteConfig.console) {
  rewriter.on('[data-console-feature]', {
    element(el) {
      if (consoleFeatureOn(el.getAttribute('data-console-feature'), features)) {
        el.removeAttribute('data-console-feature');
      } else {
        // remove(), not a `hidden` attribute: an off surface leaves nothing
        // behind to inspect, style back on, or wire a stray handler to.
        el.remove();
      }
    },
  });
}

// The brand, injected everywhere it is displayed. Before this, the wordmark and
// the city were typed into the markup of all ten pages and the console — so a
// fork shipped a site named after this instance, which is the one thing the
// engine/instance split exists to prevent. The markup now carries neutral
// placeholders and four hooks:
//
//   <title data-site-title>About</title>          -> "About — WORDMARK"
//   <title data-site-title="prefix">CONSOLE</title> -> "WORDMARK // CONSOLE"
//   <title data-site-title="brand">…</title>      -> "WORDMARK" (homepage)
//   <x data-site-wordmark>            plain-text wordmark
//   <x data-site-wordmark="accent">   wordmark with the accent half in .accent
//   <x data-site-location>            "CITY, ST" from location.name/region
//   <meta … data-site-suffix>         content + " — WORDMARK"
//   <meta … data-site-suffix="tagline">  content + " <tagline>."
//
// The meta hook only fills the STATIC og:/twitter: fallbacks. Frame and post
// pages resolve a real per-item title, and injectOg registers after this, so
// its setAttribute lands last and still wins.
function injectWordmark(rewriter) {
  const mark = wordmark();

  // <title>: the page's own name ships in the markup, the site's name is added
  // here. HTMLRewriter hands text back in arbitrary chunks (a long title, or one
  // split across the network buffer), so accumulate and only rewrite on the last
  // chunk of the text node — rewriting per chunk would repeat the wordmark.
  let titleBuf = '';
  let titleMode = '';
  rewriter.on('title[data-site-title]', {
    element(el) {
      titleBuf = '';
      titleMode = el.getAttribute('data-site-title') || '';
      el.removeAttribute('data-site-title');
    },
    text(chunk) {
      titleBuf += chunk.text;
      if (!chunk.lastInTextNode) {
        chunk.remove();
        return;
      }
      const page = titleBuf.trim();
      titleBuf = '';
      chunk.replace(_composeTitle(titleMode, page, mark.text));
    },
  });

  rewriter.on('[data-site-wordmark]', {
    element(el) {
      el.setInnerContent(wordmarkHtml(el.getAttribute('data-site-wordmark')), { html: true });
      el.removeAttribute('data-site-wordmark');
    },
  });

  rewriter.on('[data-site-location]', {
    element(el) {
      el.setInnerContent(locationLabel());
      el.removeAttribute('data-site-location');
    },
  });

  rewriter.on('meta[data-site-suffix]', {
    element(el) {
      const base = (el.getAttribute('content') || '').trim();
      const mode = el.getAttribute('data-site-suffix') || '';
      el.setAttribute('content', mode === 'tagline' ? _withTagline(base) : _withWordmark(base, mark.text));
      el.removeAttribute('data-site-suffix');
    },
  });
}

function _composeTitle(mode, page, brand) {
  if (!brand) return page;
  if (mode === 'brand') return brand;
  if (mode === 'prefix') return page ? `${brand} // ${page}` : brand;
  return page ? `${page} — ${brand}` : brand;
}

function _withWordmark(base, brand) {
  if (!brand) return base;
  return base ? `${base} — ${brand}` : brand;
}

// Sentence-appended, not dash-joined: this is a description, and the tagline
// finishes it ("Capture first. Process later." + the site's own one-liner).
function _withTagline(base) {
  const tagline = String(siteConfig.tagline || '').trim();
  if (!tagline) return base;
  const sentence = /[.!?]$/.test(tagline) ? tagline : `${tagline}.`;
  return base ? `${base} ${sentence}` : sentence;
}

export function injectSiteChrome(rewriter, url) {
  // Theme identity is config-driven and stamped at the edge so first paint is
  // already in the right preset — pages carry no hardcoded identity. The
  // pre-paint mode script in each page reads data-theme-default; HTMLRewriter
  // streams top-down, so the attribute exists before that script runs.
  const theme = siteConfig.theme || {};
  rewriter.on('html', {
    element(el) {
      el.setAttribute('data-preset', theme.preset || 'aperture');
      el.setAttribute('data-theme-default', theme.defaultMode || 'midnight');
    },
  });
  rewriter.on('link[data-font-preload]', {
    element(el) {
      el.setAttribute('href', PRESET_DISPLAY_FONT[theme.preset] || PRESET_DISPLAY_FONT.aperture);
    },
  });

  // Prepend (not append): field-notes/post.html loads lighttable.js inside
  // <head>, and scripts must be able to read the meta tags when they run.
  rewriter.on('head', {
    element(el) { el.prepend(siteMetaTags(url.origin), { html: true }); },
  });

  // The brand: <title>, nav logo, footer, static og:/twitter: title fallbacks.
  injectWordmark(rewriter);

  // Homepage only: the Organization + WebSite entity graph (config.entity).
  // One page is enough for entity resolution, and the homepage is the
  // canonical URL the graph anchors to.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const ld = entityJsonLd(url.origin);
    if (ld) {
      rewriter.on('head', { element(el) { el.append(ld, { html: true }); } });
    }
    injectSplitHero(rewriter);
    // Folio hero image (all presets; also noir's fallback). Edge-injected so
    // index.html carries a neutral placeholder rather than identity.
    const folio = siteConfig.folioHero;
    if (folio && folio.image) {
      rewriter.on('.folio-hero-media img', {
        element(el) {
          el.setAttribute('src', folio.image);
          if (folio.alt != null) el.setAttribute('alt', folio.alt);
        },
      });
    }
  }

  rewriter.on('.nav-links', {
    element(el) { el.setInnerContent(_navLinksHtml(url.pathname), { html: true }); },
  });
  rewriter.on('.nav-mobile', {
    element(el) { el.setInnerContent(_navMobileHtml(url.pathname), { html: true }); },
  });

  // The support page's tiers + copy (selectors exist only on that page).
  injectSupport(rewriter);

  // The footer's OS + webring chips (the hook exists only on the homepage).
  injectFooterChips(rewriter);

  // Config-gated console surfaces. Registered unconditionally like the rest:
  // the data-console-feature hook exists only in the console shell, so this is
  // inert on every public page.
  injectConsoleFeatures(rewriter);

  // Folio-hero identity: the template carries placeholder copy; the config
  // decides the real name/tagline (same posture as the mailto rewrite below).
  rewriter.on('[data-site-name]', {
    element(el) { el.setInnerContent(escapeHtml(siteConfig.name)); },
  });
  rewriter.on('[data-site-tagline]', {
    element(el) { el.setInnerContent(escapeHtml(siteConfig.tagline || '')); },
  });

  // Static HTML keeps a placeholder address; the config decides the real one.
  // Preserves any ?subject=… suffix (e.g. the about page's "suggest a node").
  rewriter.on('a[href^="mailto:"]', {
    element(el) {
      const href = el.getAttribute('href') || '';
      const qs = href.indexOf('?');
      el.setAttribute('href', `mailto:${siteConfig.email}${qs >= 0 ? href.slice(qs) : ''}`);
    },
  });

  const absolutize = {
    element(el) {
      const content = el.getAttribute('content') || '';
      if (content.startsWith('/')) el.setAttribute('content', url.origin + content);
    },
  };
  rewriter.on('meta[property="og:image"]', absolutize);
  rewriter.on('meta[property="og:url"]', absolutize);
  rewriter.on('meta[name="twitter:image"]', absolutize);
}
