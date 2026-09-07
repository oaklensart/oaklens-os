// ---- The podcast channel: what a directory needs before it will accept you ----
//
// /podcast.xml has always been valid RSS. It has never been *submittable*:
// Apple hard-requires <itunes:category> and an owner email, and neither had a
// config key behind them. The only way an owner found out was a rejection
// email days later. This module is the one home for that knowledge, so the
// feed (src/api/site-meta.js) and the console's readiness card
// (GET /api/site/settings → js/console/audio.js) can never disagree about
// what is missing.
//
// Shaped like src/shared/webring.js on purpose: a frozen taxonomy constant,
// exact-shaped validators that fall to the safe side, and pure builders. No
// I/O, no request, no siteConfig read except the one named accessor at the
// bottom — so a test can resolve a config this module never sees.
//
// THREE TIERS, and every field lands in exactly one:
//
//   1. Always emitted, because the engine default is a TRUE statement.
//      <language> (the shipped pages are `<html lang="en">`), <itunes:type>
//      (a show is episodic until it says otherwise), <itunes:explicit>
//      (false), <generator>, <lastBuildDate>.
//   2. Omitted when unset, because their ABSENCE IS THE UN-SUBMITTABILITY —
//      and that is honest. <itunes:image>, <itunes:category>, <itunes:owner>,
//      <copyright>, <podcast:locked>, <podcast:funding>.
//   3. Never guessed. There is nothing on a creative site to derive Apple's
//      fixed taxonomy from, and nothing that makes a copyright claim on a
//      stranger's behalf anything but a liability.
//
// ⚠️ THE OWNER EMAIL IS NEVER DEFAULTED TO siteConfig.email. Apple republishes
// the feed, so that would publish a fork owner's contact address into a
// directory listing without anyone opting in. It is asked for or it is absent.
//
// The serving contract does NOT change: the feed never fails and never emits a
// placeholder. An unconfigured fork gets valid RSS that simply is not
// submittable — the console card is what makes that discoverable before Apple
// does.

import siteConfig from './config.js';
import { escapeHtml } from './text.js';

/**
 * Apple's podcast category taxonomy — the complete fixed list, exactly as it
 * must appear in `text=""`. Sub-categories nest inside their parent.
 *
 * ⚠️ THESE STRINGS ARE THE WIRE FORMAT, not labels. Apple matches them
 * literally (ampersands and all), so they are never re-cased, re-spelled or
 * localised. A category outside this table is dropped rather than emitted:
 * an invalid one fails the submission just as surely as a missing one, but
 * silently, which is worse.
 */
export const PODCAST_CATEGORIES = Object.freeze({
  'Arts': Object.freeze(['Books', 'Design', 'Fashion & Beauty', 'Food', 'Performing Arts', 'Visual Arts']),
  'Business': Object.freeze(['Careers', 'Entrepreneurship', 'Investing', 'Management', 'Marketing', 'Non-Profit']),
  'Comedy': Object.freeze(['Comedy Interviews', 'Improv', 'Stand-Up']),
  'Education': Object.freeze(['Courses', 'How To', 'Language Learning', 'Self-Improvement']),
  'Fiction': Object.freeze(['Comedy Fiction', 'Drama', 'Science Fiction']),
  'Government': Object.freeze([]),
  'History': Object.freeze([]),
  'Health & Fitness': Object.freeze(['Alternative Health', 'Fitness', 'Medicine', 'Mental Health', 'Nutrition', 'Sexuality']),
  'Kids & Family': Object.freeze(['Education for Kids', 'Parenting', 'Pets & Animals', 'Stories for Kids']),
  'Leisure': Object.freeze(['Animation & Manga', 'Automotive', 'Aviation', 'Crafts', 'Games', 'Hobbies', 'Home & Garden', 'Video Games']),
  'Music': Object.freeze(['Music Commentary', 'Music History', 'Music Interviews']),
  'News': Object.freeze(['Business News', 'Daily News', 'Entertainment News', 'News Commentary', 'Politics', 'Sports News', 'Tech News']),
  'Religion & Spirituality': Object.freeze(['Buddhism', 'Christianity', 'Hinduism', 'Islam', 'Judaism', 'Religion', 'Spirituality']),
  'Science': Object.freeze(['Astronomy', 'Chemistry', 'Earth Sciences', 'Life Sciences', 'Mathematics', 'Natural Sciences', 'Nature', 'Physics', 'Social Sciences']),
  'Society & Culture': Object.freeze(['Documentary', 'Personal Journals', 'Philosophy', 'Places & Travel', 'Relationships']),
  'Sports': Object.freeze(['Baseball', 'Basketball', 'Cricket', 'Fantasy Sports', 'Football', 'Golf', 'Hockey', 'Rugby', 'Running', 'Soccer', 'Swimming', 'Tennis', 'Volleyball', 'Wilderness', 'Wrestling']),
  'Technology': Object.freeze([]),
  'TV & Film': Object.freeze(['After Shows', 'Film History', 'Film Interviews', 'Film Reviews', 'TV Reviews']),
  'True Crime': Object.freeze([]),
});

// Tier-1 defaults. Each is a true statement about a fork that has configured
// nothing: the shipped pages declare `<html lang="en">`, a show with no stated
// order is episodic, and a show that has not said it is explicit is not.
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_TYPE = 'episodic';
const SHOW_TYPES = ['episodic', 'serial'];

// The engine's own name, for <generator>. Follows entity.codeName the same way
// the homepage's SoftwareSourceCode node does, so a renamed fork is credited
// as itself rather than as us.
export function generatorName() {
  const entity = siteConfig.entity;
  return (entity && entity.codeName) || 'OAKLENS OS';
}

// BCP-47 shape only — `en`, `en-GB`, `pt-BR`. Deliberately not a registry
// lookup: the engine has no business rejecting a valid tag it has not heard
// of, and a malformed one is the only thing worth catching.
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

// Feed-safe absolute http(s) URL. `podcast:funding` and remote artwork both go
// into a document other people's software fetches, so a `javascript:` or
// `data:` value is refused rather than escaped and shipped.
function httpUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  return /^https?:\/\/\S+$/i.test(value.trim()) ? value.trim() : '';
}

// The shape of an email, not its deliverability — nothing here can verify an
// address, and refusing a valid-but-unusual one would be worse than passing it
// through. Whitespace and angle brackets are what actually break the document.
const EMAIL_RE = /^[^\s<>@]+@[^\s<>@.]+(\.[^\s<>@.]+)+$/;

/**
 * Normalise the `podcast` config block into exactly what the feed emits.
 *
 * Every field falls to the safe side when malformed, and for a tier-2 field
 * the safe side is ABSENT — a wrong category is rejected at Apple just as a
 * missing one is, only silently, so dropping it keeps the readiness card
 * honest about what is still needed.
 *
 * ⚠️ NO DEFAULT PARAMETER, for webringNode's reason: a caller passing some
 * other instance's config block must never fall through to this one's.
 * `configuredPodcast()` at the bottom is the single named siteConfig read.
 *
 * @param {object|null|undefined} config the `podcast` block
 */
export function podcastSettings(config) {
  const c = (config && typeof config === 'object' && !Array.isArray(config)) ? config : {};

  // --- tier 2: absent unless configured ---
  const category = Object.prototype.hasOwnProperty.call(PODCAST_CATEGORIES, c.category)
    ? c.category
    : '';
  // A sub-category only means anything under its own parent; one that does not
  // belong is dropped and the parent still stands on its own.
  const subcategory = (category && typeof c.subcategory === 'string'
    && PODCAST_CATEGORIES[category].includes(c.subcategory))
    ? c.subcategory
    : '';

  const owner = (c.owner && typeof c.owner === 'object') ? c.owner : {};
  const ownerEmail = (typeof owner.email === 'string' && EMAIL_RE.test(owner.email.trim()))
    ? owner.email.trim()
    : '';
  // The name is optional and rides only when there is an address to attach it
  // to — <itunes:owner> with a name and no email is exactly the block Apple
  // rejects, so half of it is worse than none of it.
  const ownerName = (ownerEmail && typeof owner.name === 'string' && owner.name.trim())
    ? owner.name.trim()
    : '';

  // Raw, with no fallback applied: the site-name/tagline fallback belongs to the
  // caller, which is the only thing that knows the site. Here so the feed reads
  // ONE resolved object instead of dipping back into siteConfig.podcast.
  const title = (typeof c.title === 'string' && c.title.trim()) ? c.title.trim() : '';
  const description = (typeof c.description === 'string' && c.description.trim())
    ? c.description.trim() : '';

  const image = (typeof c.image === 'string' && c.image.trim()) ? c.image.trim() : '';
  const copyright = (typeof c.copyright === 'string' && c.copyright.trim()) ? c.copyright.trim() : '';

  // <podcast:locked owner="…"> is a claim ADDRESSED to the owner email — a
  // platform trying to import the feed is told to write to that address for
  // permission. With no address there is nobody to ask, so the tag is not
  // emitted at all rather than emitted unaddressed.
  const locked = (ownerEmail && typeof c.locked === 'boolean') ? c.locked : null;

  const funding = (c.funding && typeof c.funding === 'object') ? c.funding : {};
  const fundingUrl = httpUrl(funding.url);
  const fundingLabel = fundingUrl
    ? ((typeof funding.label === 'string' && funding.label.trim()) || 'Support the show')
    : '';

  // --- tier 1: always emitted, default is a true statement ---
  const language = (typeof c.language === 'string' && LANG_RE.test(c.language.trim()))
    ? c.language.trim()
    : DEFAULT_LANGUAGE;
  const type = SHOW_TYPES.includes(c.type) ? c.type : DEFAULT_TYPE;
  const explicit = c.explicit === true;

  return {
    title, description,
    category, subcategory,
    ownerName, ownerEmail,
    image, copyright, locked,
    fundingUrl, fundingLabel,
    language, type, explicit,
  };
}

/**
 * What is still standing between this instance and a directory submission —
 * as BOOLEANS ONLY.
 *
 * ⚠️ This travels over GET /api/site/settings, which is PUBLIC and
 * UNAUTHENTICATED. It must never carry a value: not the owner email, not the
 * funding URL, not the copyright line. The console renders the key names and
 * its own copy; the server only says which ones are filled in.
 *
 * `listenPage` is not a config key on the podcast block at all, and belongs
 * here anyway: every item's <link> and <guid> is /listen/?a=<slug>, so
 * `pages.listen: false` 404s every episode in every subscriber's app while the
 * feed itself keeps serving happily. It is the one blocker you cannot see by
 * reading the feed.
 */
export function podcastReadiness(config, listenPageEnabled = true) {
  const p = podcastSettings(config);
  return {
    hasCategory: !!p.category,
    hasOwnerEmail: !!p.ownerEmail,
    hasArtwork: !!p.image,
    hasCopyright: !!p.copyright,
    hasFunding: !!p.fundingUrl,
    hasLocked: p.locked !== null,
    listenPage: listenPageEnabled !== false,
  };
}

/** The three Apple hard-requires, plus the one that silently 404s every item. */
export const PODCAST_BLOCKERS = Object.freeze(['hasCategory', 'hasOwnerEmail', 'hasArtwork', 'listenPage']);

/** True once a submission to Apple would not be rejected out of hand. */
export function podcastSubmittable(readiness) {
  return PODCAST_BLOCKERS.every((k) => readiness && readiness[k] === true);
}

// ---- tag builders ----
//
// Each returns '' when its field is unset, so the feed composes by
// concatenation and an unconfigured fork simply renders fewer lines.

/**
 * <itunes:category>, nested when a sub-category is set. Apple reads the FIRST
 * category as the show's primary one; the engine emits exactly one, because a
 * second guessed category is a worse listing than one accurate one.
 */
export function categoryTag(p, indent = '    ') {
  if (!p.category) return '';
  if (!p.subcategory) return `${indent}<itunes:category text="${escapeHtml(p.category)}"/>`;
  return `${indent}<itunes:category text="${escapeHtml(p.category)}">\n`
    + `${indent}  <itunes:category text="${escapeHtml(p.subcategory)}"/>\n`
    + `${indent}</itunes:category>`;
}

/** <itunes:owner> — the address Apple writes to. Absent without an email. */
export function ownerTag(p, indent = '    ') {
  if (!p.ownerEmail) return '';
  return `${indent}<itunes:owner>\n`
    + (p.ownerName ? `${indent}  <itunes:name>${escapeHtml(p.ownerName)}</itunes:name>\n` : '')
    + `${indent}  <itunes:email>${escapeHtml(p.ownerEmail)}</itunes:email>\n`
    + `${indent}</itunes:owner>`;
}

/**
 * The Podcast Namespace tags — the genuinely self-hosting-specific win.
 * <podcast:locked> tells a hosting platform it may not import this feed
 * without asking the owner first; <podcast:funding> puts a support link
 * directly in the listener's app.
 *
 * Returns [] when neither is configured, which is how the caller knows not to
 * declare the namespace.
 */
export function podcastNamespaceTags(p, indent = '    ') {
  const tags = [];
  if (p.locked !== null) {
    tags.push(`${indent}<podcast:locked owner="${escapeHtml(p.ownerEmail)}">${p.locked ? 'yes' : 'no'}</podcast:locked>`);
  }
  if (p.fundingUrl) {
    tags.push(`${indent}<podcast:funding url="${escapeHtml(p.fundingUrl)}">${escapeHtml(p.fundingLabel)}</podcast:funding>`);
  }
  return tags;
}

/**
 * The channel artwork as an address a podcast client can fetch from anywhere.
 * A configured path is root-relative to the serving origin; an absolute URL is
 * left alone, because cover art commonly lives on a CDN the site does not
 * serve from. Returns '' when no artwork is configured.
 */
export function artworkHref(p, origin) {
  if (!p.image) return '';
  if (/^https?:/i.test(p.image)) return p.image;
  return `${origin}${p.image.startsWith('/') ? '' : '/'}${p.image}`;
}

export const PODCAST_NS = 'https://podcastindex.org/namespace/1.0';

/** This instance's own show config — the single named siteConfig read. */
export function configuredPodcast() {
  return podcastSettings(siteConfig.podcast);
}

/** Does this instance declare a show at all? Gates the crawler-facing
 *  <link rel="alternate"> in siteMetaTags, which is sync inside an
 *  HTMLRewriter handler and cannot read data/audio.json to count episodes. */
export function declaresShow() {
  const p = siteConfig.podcast;
  return !!(p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length);
}
