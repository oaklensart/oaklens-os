// The engine's view of site.config.js: the fork's own file, laid over a
// complete set of engine defaults. Every server module reads config through
// here rather than importing site.config.js directly.
//
// WHY THIS EXISTS. A fork takes engine updates with `git merge upstream/main`,
// and the one file that merge deliberately never touches is `site.config.js` —
// it holds their identity, so setup.md tells them to always keep their own
// copy. Which means every config key the engine adds is a key that every
// existing fork's config does not have. Read straight, that is a TypeError on
// the path that renders every page, delivered by a merge that reported no
// conflicts at all. `siteConfig.location.name` in site.js was exactly that
// shape: two call sites guarded `location` with `|| {}` and a third read
// `.name` off it directly.
//
// THE RULE WHEN YOU ADD A KEY: give it a default here, in the same change.
// Never make the engine require a key that a fork's existing file cannot
// contain, and never rename one — add the new name and keep reading the old
// until you are willing to break somebody's site.
//
// TWO CATEGORIES, and the difference between them is load-bearing:
//
//   BACKFILL — absence is a bug. Nothing in the engine treats a missing `name`
//   or `location` as a decision, so these are filled in whether the fork
//   mentioned them or not.
//
//   SHAPE — absence is a SIGNAL the engine already honours, and overruling it
//   would undo a deliberate deletion. No `wordmark` means "fall back to name".
//   No `entity` means "emit no JSON-LD". No `support` means "show the page's
//   empty state". No `pages` means "nothing is disabled". These are merged
//   only when the fork supplied the key at all — and then their sub-keys ARE
//   filled in, so a new page or a new console surface added upstream arrives
//   with the engine's default instead of `undefined`.

import userConfig from '../../site.config.js';

/** Absence is a bug: always present after resolution. */
export const BACKFILL = Object.freeze({
  name: 'Untitled Site',
  tagline: '',
  email: '',
  contactName: '',
  // The crash this whole module exists to prevent. `coords` must be a
  // two-number array: weather.js destructures it without looking.
  location: { name: '', region: '', coords: [0, 0] },
  // Filtered against pages{} before render, so an empty nav is a valid site.
  nav: [],
  // The IANA zone this project keeps its calendar in — the one `localDay()`
  // formats server-rendered dates in (src/shared/text.js). It matters because
  // the Worker runs in UTC while the console stamps a frame's date with the
  // photographer's LOCAL getDate(): a frame shot at 22:12 Pacific is already
  // tomorrow in UTC, so without this the manifest and the buffer summary would
  // disagree with the date baked into the picture.
  //
  // UTC is the engine default deliberately. This was hardcoded to one
  // instance's zone until 2026-09-08, which silently gave every fork Pacific
  // dates — identity in engine code, exactly what CLAUDE.md forbids. A neutral
  // default is wrong for everyone equally and right for nobody by accident, so
  // an instance that cares names its own zone (see site.config.example.js).
  timezone: 'UTC',
  // The backfill stays 'aperture' on purpose, even though the example config
  // now ships 'selenium': this value only applies when a config OMITS theme{}
  // entirely, and every such site has been rendering aperture since the
  // template landed. Changing it here would silently re-skin those sites on
  // their next upstream merge; new forks get selenium from the example file.
  theme: { preset: 'aperture', defaultMode: 'midnight', toggle: true },
  // Pulse — the homepage's immediate card. BACKFILL, not SHAPE: the TTL is
  // load-bearing (a pulse with no expiry outlives its moment and makes a site
  // read abandoned), so a config that omits pulse{} still gets a working one.
  // One key only: the starter packs are bundled engine content, the console's
  // glyph tray follows whichever pack is open, and the card's label is a
  // constant — so none of the three needs configuring.
  pulse: { ttlHours: 18 },
  // Every one of these is already read with an explicit `=== true` or
  // `!== false`, so they need no protection. They are written out anyway:
  // BACKFILL plus SHAPE is meant to be a complete, readable statement of the
  // config shape, and a flag that only exists in a comment gets forgotten.
  // Branded short links, `{ code: 'https://…' }`. An empty table is a complete
  // statement of "this instance redirects nothing", so it backfills rather
  // than shaping — there are no sub-keys to fill in, the keys ARE the data.
  shortLinks: {},
  // Hostname prefix the short links answer on, or '' for every host this site
  // serves — which is the right default, because a fork has one domain.
  shortLinkHost: '',
  legacyRedirects: false,
  webAnalytics: false,
  appleMusicEmbeds: false,
  demoMode: false,
  repoConnected: false,
  poweredBy: true,
  // The client portal (`/c/*` + `/p/<code>` links). OFF unless explicitly true.
  // Instance-scoped: the engine strips the portal from forks entirely (see
  // scripts/os-extract.mjs), so the code that reads this flag exists only on an
  // instance — a fork carries the default here and nothing acts on it. The
  // portal is frozen and deferred to a proper rebuild; off is its safe resting
  // state (every /c/* and /p/ request is inert). See CLAUDE.md's portal note
  // and docs/maintenance/2026-08-24-v1-code-review.md.
  portalEnabled: false,
});

/** Absence is a signal: filled in only when the fork supplied the key. */
export const SHAPE = Object.freeze({
  wordmark: { stem: '', accent: '' },
  folioHero: { image: '', alt: '' },
  pages: { archive: true, fieldNotes: true, about: true, wall: false, support: false },
  console: { bench: false },
  entity: { name: '', logo: '/favicon.svg', sameAs: [], codeRepository: '', codeName: '' },
  support: { blurb: '', tiers: [], note: '', disclaimer: '' },
  webring: { node: null, slug: '' },
  // Channel-level fields for /podcast.xml. SHAPE, not BACKFILL: omitting the
  // block means "this show is just the site" — title and description fall back
  // to the site's own name and tagline, and every submission-gating tag is
  // simply not emitted.
  //
  // Apple hard-requires THREE of these before it will accept a submission —
  // `image` (square, 1400px minimum), `category`, and `owner.email` — and
  // rejects the feed outright without them. Nothing here is guessed: there is
  // nothing on a creative site to derive Apple's fixed taxonomy from, and
  // `owner.email` is NEVER defaulted to `email` above, because Apple
  // republishes the feed and that would publish a fork owner's contact address
  // into a public directory listing without anyone opting in.
  //
  // `locked` is null rather than false on purpose: `<podcast:locked>no</…>` is
  // a real statement ("any platform may import this show"), and an instance
  // that never mentioned it has not made it. See src/shared/podcast.js for the
  // three-tier posture and which tag each field lands in.
  podcast: {
    title: '', description: '', image: '',
    category: '', subcategory: '',
    owner: { name: '', email: '' },
    copyright: '', locked: null,
    funding: { url: '', label: '' },
    // Tier 1 — always emitted, and these defaults are true statements about a
    // fork that has configured nothing (the shipped pages are `<html lang="en">`,
    // and a show is episodic until it says otherwise).
    language: '', type: '', explicit: false,
  },
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Arrays replace wholesale rather than merging, in both directions: a fork's
// three-item `nav` is the whole nav, not an addition to ours, and the same
// goes for `coords`, `sameAs` and `tiers`.
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Exported for the test suite, which resolves configs this module never sees. */
export function resolveConfig(user) {
  const src = isPlainObject(user) ? user : {};
  const merged = deepMerge(BACKFILL, src);
  for (const [key, shape] of Object.entries(SHAPE)) {
    if (isPlainObject(src[key])) merged[key] = deepMerge(shape, src[key]);
  }
  return merged;
}

// Frozen at the top level, matching what site.config.js itself does.
export default Object.freeze(resolveConfig(userConfig));
