// ---- Server-rendered site metadata: manifest, sitemap, Atom feed, buffer summary ----
//
// Extracted from worker.js (decomposition, manual §6.7). These four GET
// endpoints render straight from data JSON (through the edge cache) rather than
// the HTMLRewriter path:
//   GET /archive/manifest.html — full archive listing (also the Wayback target)
//   GET /sitemap.xml           — every enabled public page
//   GET /feed.xml              — Atom syndication of published field notes
//   GET /api/buffer-summary    — ~120-byte precomputed buffer counts
//   GET /.well-known/analogs.txt — webring ownership claim (config-gated)
//   GET /api/version           — which deploy is this origin serving

import siteConfig from '../shared/config.js';
import { cdnBase } from '../shared/site.js';
import { PAGE_ROUTES, pageDisabled, publicPages } from '../shared/pages.js';
import { configuredNode, analogsToken } from '../shared/webring.js';
import {
  configuredPodcast, podcastReadiness, categoryTag, ownerTag,
  podcastNamespaceTags, generatorName, artworkHref, PODCAST_NS,
} from '../shared/podcast.js';
import { escapeHtml, baseName, localDay } from '../shared/text.js';
import { CORS_HEADERS, jsonRes } from '../shared/http.js';
import { loadDataJson, _deployToken } from '../edge/data.js';
import { _frameImg, OG_IMG_WIDTH } from '../edge/chrome.js';

// ---- GET /api/version ----
//
// Which deploy is this origin serving? Before this there was no way to answer
// that from outside the Cloudflare dashboard — which is how a correct publish
// spent five minutes looking broken (2026-08-23): the build had landed, but
// nothing on the site could say so. `version` is the SAME token loadDataJson
// keys its edge cache on, so "the version changed" and "the data cache turned
// over" are one fact instead of two you have to correlate by hand.
//
// PUBLIC and identity-free on purpose. The id is an opaque UUID Cloudflare
// assigns per version and the timestamp is when it went live; neither names
// the instance, its owner, its resources or its repo. `tag` is deliberately
// NOT returned — it is operator-set free text and a fork could have typed
// anything into it.
//
// no-store, not the usual max-age: a cached answer to "is it live yet" is a
// wrong answer, and being current is this endpoint's entire job. (Same
// reasoning as handleAnalogsToken's 404 above.)
//
// An instance whose wrangler.jsonc has no version_metadata binding answers
// { version: null } — an honest "unknown", never a 404 and never a guess.
export function handleVersion(env) {
  const meta = (env && env.CF_VERSION_METADATA) || null;
  const res = jsonRes({
    ok: true,
    version: (meta && typeof meta.id === 'string') ? meta.id : null,
    deployed: (meta && typeof meta.timestamp === 'string') ? meta.timestamp : null,
    // What the edge data cache is scoped by — equals `version` when the
    // binding is present, 'v0' when it is not. Surfaced so a stale-content
    // report can be diagnosed without reading the source.
    cacheScope: _deployToken(env),
  }, 200);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

// ---- GET /api/site/settings ----
//
// Public, read-only template state for the console's Site Settings card. No
// secrets: everything in it is already visible on the rendered site.
export function handleSiteSettings(request, env) {
  const theme = siteConfig.theme || {};
  const pages = {};
  for (const key of Object.keys(PAGE_ROUTES)) {
    pages[key] = !(siteConfig.pages && siteConfig.pages[key] === false);
  }
  return jsonRes({
    ok: true,
    name: siteConfig.name,
    theme: {
      preset: theme.preset || 'aperture',
      defaultMode: theme.defaultMode || 'midnight',
      toggle: theme.toggle !== false,
    },
    pages,
    // Instance posture, both config-driven and public by nature: demoMode is
    // announced to visitors in the console chrome, and repoConnected only
    // decides which deploy instruction the publish card shows (the Worker
    // cannot detect Cloudflare git integration itself, so config carries it).
    demoMode: siteConfig.demoMode === true,
    repoConnected: siteConfig.repoConnected === true,
    // Webring seat, or null when this instance has not joined. Both values are
    // already public by design — the footer chip renders them and
    // /.well-known/analogs.txt serves them as a deliberately readable claim —
    // so this exposes nothing new. It lets the console's ring card show the
    // real state without a second request.
    webring: configuredNode(),
    // Podcast submission readiness for the console's feed card — WHICH keys are
    // filled in, never WHAT is in them.
    //
    // ⚠️ BOOLEANS ONLY. This endpoint is public and unauthenticated, so the
    // owner email, the funding URL and the copyright line must never travel
    // here — the whole point of the card is to say "you still need
    // podcast.owner.email", which needs no value at all. podcastReadiness()
    // enforces the shape; keep it that way.
    //
    // `listenPage` rides along because it is the one blocker you cannot see by
    // reading the feed: every item's <link> and <guid> is /listen/?a=<slug>, so
    // pages.listen:false 404s every episode in every subscriber's app while the
    // feed itself keeps serving happily.
    podcast: podcastReadiness(siteConfig.podcast, pages.listen !== false),
  }, 200);
}

// ---- GET /.well-known/analogs.txt ----
//
// The ANALOGS.NETWORK ownership claim: one line naming this site's seat on the
// ring. It is a claim, not a key — anyone can copy the text, but only the
// domain's operator can serve it at this URL, which is the whole point. It buys
// a member self-service listing changes without accounts, and protects a seat
// if the domain ever lapses (the token stops answering, so the ring can dim
// the listing instead of pointing at whoever picked the domain up).
//
// 404 when the instance is not a member, which is every fork by default.
export function handleAnalogsToken() {
  const token = analogsToken();
  if (!token) {
    // no-store, not the usual max-age: joining the ring is a config edit and a
    // redeploy, and a cached miss must not shadow the seat for an hour after.
    return new Response('Not found\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(`${token}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      // Set literally rather than through withCors: this is a public claim
      // meant to be fetched cross-origin by the ring, and withCors reflects a
      // per-request origin and is only applied on /api/*.
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ---- GET /archive/manifest.html ----

export async function handleManifest(request, env) {
  const url = new URL(request.url);
  let data;
  try {
    // Through loadDataJson, like every other data reader: it shares the
    // deploy-scoped edge cache (§2.4) instead of re-reading the asset bundle on
    // every crawler hit, AND it carries the status through, which is what makes
    // the split below possible.
    data = await loadDataJson(url.origin, env, 'data/archive.json');
  } catch (err) {
    // Same split as the Atom and podcast feeds: a MISSING archive.json is not
    // an outage, it is how an un-seeded fork ships — os-extract omits it
    // (DATA_OMITTED) so the bundled samples render. An empty manifest is that
    // instance's truth. This used to answer 500 for it, and /sitemap.xml
    // advertises this page, so every brand-new fork was handing crawlers a
    // server error until its owner published a first archive entry. Invisible
    // on a seeded instance, which is why it survived (2026-08-23).
    //
    // Anything else IS a transient read failure and keeps the 500 — an empty
    // manifest served under a real outage would tell the Wayback Machine this
    // archive is empty, and that snapshot is the thing we cannot take back.
    if (err.status !== 404) {
      console.error('[manifest]', err.message);
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    data = [];
  }

  if (!Array.isArray(data)) {
    data = [];
  }

  data.sort((a, b) => {
    const da = a.added_at || '';
    const db = b.added_at || '';
    if (da < db) return 1;
    if (da > db) return -1;
    return 0;
  });

  const siteName = escapeHtml(siteConfig.name.toUpperCase());
  const articles = data.map(entry => {
    const hashHtml = entry.hash ? `\n  <p class="hash">${escapeHtml(entry.hash)}</p>` : '';
    return `<article id="${escapeHtml(entry.slug)}">
  <img src="${cdnBase(url.origin)}/archive/${encodeURIComponent(baseName(entry.filename))}-480w.webp"
       width="480" alt="${escapeHtml(entry.title)}" loading="lazy">
  <h2>${escapeHtml(entry.title)}</h2>
  <p class="sub">${escapeHtml(entry.sub)}</p>
  <p class="meta">${escapeHtml(entry.location)} · ${localDay(entry.added_at)}</p>${hashHtml}
</article>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${siteName} Archive Manifest</title>
<meta name="description" content="A complete manifest of the ${escapeHtml(siteConfig.name)} archive.">
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
  article { border-bottom: 1px solid #eee; padding-bottom: 24px; margin-bottom: 24px; }
  img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
  h2 { margin: 16px 0 4px; }
  p { margin: 4px 0; color: #555; }
  .hash { font-family: monospace; font-size: 0.85em; color: #888; }
</style>
</head>
<body>
<h1>${siteName} Archive Manifest (${data.length})</h1>
${articles}
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ---- GET /sitemap.xml ----

export async function handleSitemap(request, env) {
  const HOST = new URL(request.url).origin;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
  for (const path of publicPages()) {
    xml += `\n  <url><loc>${HOST}${path}</loc></url>`;
  }
  if (!pageDisabled('/archive/manifest.html')) {
    xml += `\n  <url><loc>${HOST}/archive/manifest.html</loc></url>`;
  }
  // /listen is listed only once it has something to play. Advertising an empty
  // page is thin content on every fork that never uploads a track, and asking
  // those forks to switch a page off by hand is the wrong default — so this is
  // derived from the data, not from config. A read failure lists nothing,
  // which is the same safe answer as an empty registry.
  if (!pageDisabled('/listen')) {
    try {
      const audio = await loadDataJson(HOST, env, 'data/audio.json');
      // `t.filename` excludes retired tombstones — reserved addresses with no
      // media. A registry holding only those has nothing to play, so /listen is
      // still the empty page this gate exists to keep out of the sitemap.
      if (Array.isArray(audio) && audio.some((t) => t && t.filename)) {
        xml += `\n  <url><loc>${HOST}/listen</loc></url>`;
      }
      // /podcast.xml on the same terms, and off the same read — the registry is
      // already in hand, so this costs nothing. Gated on an actual EPISODE
      // rather than on any track: the feed serves either way, but listing a
      // channel with no items invites a crawler to fetch an empty show, and a
      // podcast client that sees zero items can drop the subscription.
      if (Array.isArray(audio) && audio.some((t) => t && t.episode && t.filename && t.slug)) {
        xml += `\n  <url><loc>${HOST}/podcast.xml</loc></url>`;
      }
    } catch { /* no registry, no listing */ }
  }
  xml += '\n</urlset>';

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

// ---- GET /feed.xml (Atom) ----
//
// Field Notes syndication — table stakes for a blog engine. Atom over RSS2
// (real spec, sane dates), rendered from data/posts.json through the same
// edge cache as OG resolution (loadDataJson). posts.json holds published
// posts only (drafts live in D1), so nothing unpublished can appear here.
// Every page advertises it via <link rel="alternate"> (siteMetaTags).

const FEED_MAX_ENTRIES = 20;

// Plain-text summary from a post's markdown body: HTML passthrough and embed
// shortcodes stripped, markdown syntax dropped, cut on a word boundary.
function feedSummary(md, max = 280) {
  if (!md) return '';
  const t = String(md)
    .replace(/<[^>]*>/g, ' ')                  // HTML passthrough + shortcode divs
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // markdown images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links → their text
    .replace(/^#{1,6}\s+/gm, '')               // headings
    .replace(/^https?:\/\/\S+$/gm, ' ')        // bare embed links (Apple Music)
    .replace(/[*_`>~]/g, '')                   // emphasis/code/quote chars
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const brk = cut.lastIndexOf(' ');
  return `${cut.slice(0, brk > 0 ? brk : max)}…`;
}

// RFC3339 timestamp for an entry. Posts carry added_at (ISO) and date
// (YYYY-MM-DD); either parses. Epoch fallback keeps a malformed row from
// sinking the whole feed.
function feedDate(post) {
  const d = new Date(post.added_at || post.date || 0);
  return isNaN(d) ? new Date(0).toISOString() : d.toISOString();
}

export async function handleFeed(request, env) {
  const origin = new URL(request.url).origin;
  let posts;
  try {
    const data = await loadDataJson(origin, env, 'data/posts.json');
    posts = Array.isArray(data) ? data : [];
  } catch (err) {
    // A MISSING posts.json is not an outage — it is how an un-seeded fork
    // ships (the extractor omits it so the sample fallback renders, manual
    // §5.21). An empty feed is that instance's truth. Anything else is a
    // transient read that must not serve an empty feed — readers would drop
    // every entry — so 503 tells them to come back.
    if (err.status === 404) {
      posts = [];
    } else {
      console.error('[feed]', err.message);
      return new Response('feed temporarily unavailable', { status: 503 });
    }
  }

  posts = posts
    .filter((p) => p && p.fn_id)
    .sort((a, b) => feedDate(b).localeCompare(feedDate(a)))
    .slice(0, FEED_MAX_ENTRIES);

  const feedTitle = `${siteConfig.name} — Field Notes`;
  const updated = posts.length ? feedDate(posts[0]) : new Date().toISOString();

  const entries = posts.map((p) => {
    const link = `${origin}/field-notes/post?slug=${encodeURIComponent(p.fn_id)}`;
    const hero = p.hero ? _frameImg(origin, p.hero, OG_IMG_WIDTH) : null;
    const summary = feedSummary(p.body);
    return `  <entry>
    <id>${escapeHtml(link)}</id>
    <title>${escapeHtml(p.title || p.fn_id)}</title>
    <link rel="alternate" type="text/html" href="${escapeHtml(link)}"/>${hero ? `
    <link rel="enclosure" type="image/webp" href="${escapeHtml(hero)}"/>` : ''}
    <updated>${feedDate(p)}</updated>
    <summary>${escapeHtml(summary || p.location || '')}</summary>
  </entry>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${origin}/feed.xml</id>
  <title>${escapeHtml(feedTitle)}</title>
  <subtitle>${escapeHtml(siteConfig.tagline || '')}</subtitle>
  <link rel="self" type="application/atom+xml" href="${origin}/feed.xml"/>
  <link rel="alternate" type="text/html" href="${origin}/field-notes/"/>
  <updated>${updated}</updated>
  <author><name>${escapeHtml(siteConfig.name)}</name></author>
${entries}
</feed>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ---- GET /podcast.xml (RSS 2.0 + iTunes) ----
//
// A SEPARATE document from /feed.xml, for two reasons that are not negotiable:
//
//  1. Apple Podcasts (and most apps) require RSS 2.0. /feed.xml is Atom — a
//     real spec with sane dates, correct for a blog, and unreadable to a
//     podcast client. Bolting <enclosure> onto it would not make it
//     subscribable; it would just make it heavier.
//  2. The audiences differ. Marking a track `episode` is the author saying
//     "this belongs in a podcast app". Loose sketches, demos and voice memos
//     stay off this feed and out of every subscriber's queue — which is the
//     entire point of the per-track switch.
//
// Everything a client needs is derived: the enclosure's byte length and MIME
// type come from the registry (recorded at upload), duration from the same
// decode that measured the waveform. The ONE thing an instance must supply
// before Apple will accept a submission is square channel artwork —
// `podcast: { image: '…' }` in site.config.js. Without it the feed is still
// valid RSS and every app that does not gate on artwork will play it, so a
// fork is never blocked; it just is not submittable yet.

const PODCAST_MAX_ENTRIES = 300;

const AUDIO_EXT_MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
};

function audioMime(entry) {
  if (entry.mime) return entry.mime;
  const ext = String(entry.filename || '').split('.').pop().toLowerCase();
  return AUDIO_EXT_MIME[ext] || 'audio/mpeg';
}

// RSS 2.0 wants RFC-822. toUTCString() is RFC-1123, which every reader accepts;
// an unparseable date falls back to the epoch rather than emitting "Invalid
// Date" and poisoning the item.
function rssDate(value) {
  const d = new Date(value || 0);
  return (isNaN(d) ? new Date(0) : d).toUTCString();
}

// itunes:duration takes seconds or H:MM:SS; seconds is unambiguous.
function itunesDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return s ? String(s) : '';
}

export async function handlePodcastFeed(request, env) {
  const origin = new URL(request.url).origin;
  let tracks;
  try {
    const data = await loadDataJson(origin, env, 'data/audio.json');
    tracks = Array.isArray(data) ? data : [];
  } catch (err) {
    // Same split as the Atom feed: a missing registry is an un-seeded fork
    // (empty show), any other read failure is transient and must not serve an
    // empty feed — a podcast client that sees zero items can drop the show.
    if (err.status === 404) {
      tracks = [];
    } else {
      console.error('[podcast]', err.message);
      return new Response('feed temporarily unavailable', { status: 503 });
    }
  }

  const episodes = tracks
    .filter((t) => t && t.episode && t.filename && t.slug)
    .sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')))
    .slice(0, PODCAST_MAX_ENTRIES);

  // One home for the channel's submission-gating fields (src/shared/podcast.js),
  // so this document and the console's readiness card cannot disagree about
  // what is still missing. Every tier-2 builder returns '' when unset — an
  // unconfigured fork renders fewer lines, never a placeholder.
  const p = configuredPodcast();

  const artworkUrl = artworkHref(p, origin);
  // The show's own title/description when it has them, the site's otherwise —
  // "this show is just the site" is a complete and common answer.
  const title = p.title || siteConfig.name;
  const description = p.description || siteConfig.tagline || '';
  // Channel-level explicit is the show's own rating and every item inherits it.
  // Apple treats a missing item value as the channel's anyway, but stating it
  // per item is what keeps a re-hosted single episode honest.
  const explicit = p.explicit ? 'true' : 'false';

  const items = episodes.map((t) => {
    const link = `${origin}/listen/?a=${encodeURIComponent(t.slug)}`;
    const url = `${cdnBase(origin)}/audio/${encodeURIComponent(t.filename)}`;
    const dur = itunesDuration(t.duration);
    return `    <item>
      <title>${escapeHtml(t.title || t.slug)}</title>
      <link>${escapeHtml(link)}</link>
      <guid isPermaLink="true">${escapeHtml(link)}</guid>
      <description>${escapeHtml(t.sub || '')}</description>
      <pubDate>${rssDate(t.added_at)}</pubDate>
      <enclosure url="${escapeHtml(url)}" length="${Number(t.size) || 0}" type="${escapeHtml(audioMime(t))}"/>${dur ? `
      <itunes:duration>${dur}</itunes:duration>` : ''}
      <itunes:title>${escapeHtml(t.title || t.slug)}</itunes:title>
      <itunes:explicit>${explicit}</itunes:explicit>
    </item>`;
  }).join('\n');

  // ⚠️ THE NEWEST EPISODE'S pubDate, NEVER `new Date()`. A body that changes on
  // every request defeats the one-hour cache above and every conditional GET a
  // podcast client makes — and it is not true: nothing was built. With no
  // episodes there is no build date to state, so the tag is omitted rather
  // than invented.
  const lastBuild = episodes.length ? rssDate(episodes[0].added_at) : '';

  // The podcast: namespace is declared ONLY when one of its tags is emitted.
  // An unused namespace declaration on every fork's feed is noise a validator
  // is entitled to complain about.
  const nsTags = podcastNamespaceTags(p);
  const nsAttr = nsTags.length ? ` xmlns:podcast="${PODCAST_NS}"` : '';

  const channelLines = [
    `    <title>${escapeHtml(title)}</title>`,
    `    <link>${origin}/listen</link>`,
    `    <description>${escapeHtml(description)}</description>`,
    `    <language>${escapeHtml(p.language)}</language>`,
    `    <generator>${escapeHtml(generatorName())}</generator>`,
    lastBuild ? `    <lastBuildDate>${lastBuild}</lastBuildDate>` : '',
    p.copyright ? `    <copyright>${escapeHtml(p.copyright)}</copyright>` : '',
    `    <atom:link href="${origin}/podcast.xml" rel="self" type="application/rss+xml"/>`,
    `    <itunes:author>${escapeHtml(siteConfig.name)}</itunes:author>`,
    `    <itunes:summary>${escapeHtml(description)}</itunes:summary>`,
    `    <itunes:type>${escapeHtml(p.type)}</itunes:type>`,
    `    <itunes:explicit>${explicit}</itunes:explicit>`,
    categoryTag(p),
    ownerTag(p),
    artworkUrl ? `    <itunes:image href="${escapeHtml(artworkUrl)}"/>` : '',
    ...nsTags,
  ].filter(Boolean).join('\n');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"${nsAttr}>
  <channel>
${[channelLines, items].filter(Boolean).join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// Featured RAW frames for the homepage "recent work" grid. A buffer frame the
// owner flags with `featured` surfaces there as a "RAW · f#NNN" card. Two things
// happen here so the homepage never has to ship the full ~134 KB buffer.json:
//
//  1. Frame numbers (f#NNN) are POSITIONAL — mirror the client's
//     LightTable.assignFrameNumbers (js/lighttable.js) and the console's
//     getBufferFrameNumbers: sort EVERY entry (dark tombstones included, so
//     retired slots stay permanent) by day (project TZ, via localDay — matches
//     the owner's console view) then filename, and number 1..N.
//  2. Return only the featured, non-dark frames — newest first, with the point
//     data the card needs (`focus` + the 4:5 `cardFocus`).
//
// `limit` returns a few even though the homepage shows one today, so opening it
// up to more card slots later is a front-end-only change (no Worker redeploy).
export function _featuredRawFrames(arr, limit = 4) {
  const entries = Array.isArray(arr) ? arr : [];
  const numbered = [...entries].sort((a, b) => {
    const d = localDay(a.captured_at || a.published_at)
      .localeCompare(localDay(b.captured_at || b.published_at));
    return d !== 0 ? d : (a.filename || '').localeCompare(b.filename || '');
  });
  const numById = new Map();
  numbered.forEach((e, i) => numById.set(e.id, i + 1));

  return entries
    .filter((e) => e && e.featured && !e.dark && e.filename)
    .sort((a, b) => (b.captured_at || '').localeCompare(a.captured_at || ''))
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      filename: e.filename,
      num: numById.get(e.id) || 0,
      focus: e.focus || '',
      cardFocus: e.cardFocus || '',
      captured_at: e.captured_at || e.published_at || '',
      // The homepage card descriptor, so a featured frame's chosen layout
      // survives the trip the way its crop already does. Conditional, so a frame
      // that never chose one adds nothing to the payload — and mirrored exactly
      // by _stagedFeaturedRaw() in js/console/cards.js, which the parity test in
      // tests/cards-view.test.js runs against this function on one fixture.
      ...(e.card ? { card: e.card } : {}),
    }));
}

// ---- GET /api/buffer-summary ----
//
// The archive landing page used to download the full buffer.json (~134 KB) just
// to render one strip thumbnail + frame/day counts. This returns a ~120-byte
// precomputed summary instead (plus any featured RAW frames for the homepage —
// see _featuredRawFrames). buffer.json is read through the edge cache
// (loadDataJson), whose key is scoped by the deploy, so a publish is reflected
// here as soon as its build lands.
//
// SIXTY seconds, not 300. This header is the OTHER staleness layer, and it is
// the one that outlives a deploy in the author's own browser: the edge fix
// above makes the origin answer correctly the moment a build lands, but a
// `max-age=300` response already sitting in a tab keeps the old answer
// regardless. That is why the 2026-08-23 report only reproduced in normal
// windows — a fresh private window has nothing cached, so it was reading past
// this layer to the stale edge behind it. Fixing one without the other would
// have left the author waiting while a stranger saw the change immediately.
//
// stale-while-revalidate keeps the cost honest: a repeat visitor still renders
// instantly from cache while the refresh happens behind them, so origin hits
// are bounded by revalidation rather than hard misses — the same trade
// `_headers` already makes for /data/*.json. Staleness caps at 60s.
const BUFFER_SUMMARY_CACHE = 'public, max-age=60, stale-while-revalidate=300';

export async function handleBufferSummary(request, env) {
  const url = new URL(request.url);
  const empty = (extra = {}) =>
    new Response(JSON.stringify({ frames: 0, ...extra }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': BUFFER_SUMMARY_CACHE, ...CORS_HEADERS },
    });
  try {
    const data = await loadDataJson(url.origin, env, 'data/buffer.json');
    const arr = Array.isArray(data) ? data : [];
    if (!arr.length) return empty();

    // Newest by captured_at — unshift() order can't be trusted when backlogged
    // photos with old EXIF dates are uploaded later (mirrors the client logic).
    const latest = arr.reduce((a, b) => ((a.captured_at || '') > (b.captured_at || '') ? a : b));
    const days = new Set(arr.map((b) => localDay(b.captured_at || b.published_at))).size;
    const lastDate = localDay(latest.captured_at || latest.published_at).slice(5).replace('-', '.');

    return new Response(JSON.stringify({
      frames: arr.length,
      days,
      lastDate,
      latest: { filename: latest.filename, focus: latest.focus || '' },
      featured: _featuredRawFrames(arr),
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': BUFFER_SUMMARY_CACHE, ...CORS_HEADERS },
    });
  } catch (err) {
    console.error('[buffer-summary]', err.message);
    return empty();
  }
}
