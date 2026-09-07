// site.config.example.js — starter defaults for a fresh OAKLENS OS fork.
//
// Copy to site.config.js (scripts/setup.sh does this for you), then edit
// every field. Identity never lives in code: everything a fork changes is in
// this one file, and everything else derives from the request origin at
// runtime, so a fresh fork works on *.workers.dev with zero extra config.
export default Object.freeze({
  name: 'Your Studio',
  tagline: 'Selected work',
  email: 'you@example.com',
  contactName: 'You',
  // The display wordmark: nav logo, footer, page <title>, console chrome.
  // Optionally split in two so the second half takes the theme's accent colour
  // — { stem: 'STUDIO', accent: '.COM' } renders STUDIO.COM with .COM in
  // accent. Leave `accent` empty for a single-colour wordmark, or delete the
  // line entirely to fall back to `name`.
  wordmark: { stem: 'YOUR STUDIO', accent: '' },
  location: {
    name: 'YOUR CITY',
    region: '',     // optional; joined as "YOUR CITY, ST" in the footer
    coords: [0, 0], // weather API (Open-Meteo) — your city's lat/lon
  },
  // Nav bar (desktop + mobile), injected at the edge. Items pointing at a
  // page disabled in pages{} below are filtered automatically.
  nav: [
    { label: 'Work', href: '/archive' },
    { label: 'Field Notes', href: '/field-notes' },
    { label: 'About', href: '/about' },
  ],
  // Starter look: 'selenium' (the folio — serif headings, coral accent,
  // built for long reads) is the default. 'aperture' (contemporary studio,
  // cobalt), 'passe-partout' (fine-art gallery, oxblood on warm paper),
  // 'noir' (tech-noir terminal: black / white / red) and 'cyanotype'
  // (the folio in Prussian-blue ink on cool paper) are one-word swaps.
  // defaultMode: 'midnight' | 'daylight' | 'auto' (follows the visitor's OS).
  theme: { preset: 'selenium', defaultMode: 'midnight', toggle: true },
  // Featured image for the folio hero (the aperture/passe-partout homepage
  // hero, and noir's fallback). Ships pointing at a bundled CC0 sample frame so
  // a fresh fork renders immediately; swap for your own (a repo path or a
  // `/api/cdn/…` key once you've uploaded frames).
  folioHero: {
    image: '/assets/samples/sample-hero-2048w.webp',
    alt: 'Featured work',
  },
  // Homepage split hero — NOIR preset only (a two-panel tool/code + photo hero
  // instead of the folio hero). Omit it and noir falls back to the folio hero.
  // Uncomment and fill in to use it:
  // splitHero: {
  //   code:  { image: '/assets/samples/sample-01-2048w.webp', imagePosition: '50% 50%',
  //            headline: 'CODE THE TOOL.', cta: { href: '/os', label: 'OS', ariaLabel: 'Read more' } },
  //   photo: { image: '/assets/samples/sample-hero-2048w.webp',
  //            headline: 'SHOOT THE WORLD.', cta: { href: '/archive', label: 'view archive' } },
  // },
  // The support page (/support) — off by default in pages{} below, so this is
  // here ready for the day you turn it on. Every tier is edge-injected into the
  // page, which ships neutral placeholders: the payment links and the copy
  // around them are yours, never the engine's. `url` is whatever hosted
  // checkout you use — Stripe, Ko-fi, Liberapay, PayPal, anything with a link.
  // A tier with no `url` renders as a plain card; an empty `tiers` list (or no
  // `support` block at all) shows the page's empty state. `blurb` and
  // `disclaimer` take a string or a list of lines, joined with a line break.
  support: {
    blurb: [
      'This site is made by hand and paid for out of pocket.',
      'If it has been useful to you, here are a few ways to help keep it running.',
    ],
    tiers: [
      {
        icon: '☕', name: 'Coffee', price: 'OPEN / PWYW',
        desc: 'Whatever it is worth to you. Covers hosting for a week.',
        url: 'https://example.com/donate/coffee',
      },
      {
        icon: '🎞', name: 'Film', price: '15.00 USD',
        desc: 'A roll and the developing. Keeps new work coming.',
        url: 'https://example.com/donate/film',
      },
      {
        icon: '💽', name: 'Archive', price: '50.00 USD',
        desc: 'Storage and backups, so nothing published here disappears.',
        url: 'https://example.com/donate/archive',
      },
    ],
    note: 'Payments handled by your provider',
    disclaimer: '',
  },
  // Public-page switches — false turns a page off end to end (route 404s,
  // sitemap drops it, nav filters it). The starter ships the minimal trio;
  // theWall (wallpapers + Photo Lab) and the support page are one-line enables
  // when you want them.
  pages: {
    archive: true, fieldNotes: true, about: true,
    wall: false, support: false,
  },
  // Field Console surfaces that are opt-in. Unlike pages{} above, a missing or
  // false key here means OFF — nothing in this block is needed for a working
  // console, and the whole block can stay as it is.
  //   bench — a RAW-processing worklist. It is off because the engine has no
  //   way to *fill* it yet: today's only feeder is a macOS command-line script
  //   that isn't part of the template. The in-browser version (pick RAWs on a
  //   memory card, no terminal, no extra storage account) is designed and
  //   waiting to be built — see docs/bench-decision.md. Leave this alone until
  //   then; switching it on just shows an empty tab.
  console: { bench: false },
  // BRANDED SHORT LINKS. `{ code: 'https://…' }` makes yoursite.com/<code>
  // a 302 to that URL — a link on your own domain that you can re-point
  // later without reprinting anything you already handed out. Empty here, so
  // a fresh site redirects nothing. A code is one lowercase word (letters,
  // digits, hyphens) and cannot shadow one of your own pages.
  //   shortLinks: { prints: 'https://…', talk: 'https://…' },
  shortLinks: {},
  // If you run more than one hostname and want the short links to belong to
  // only one of them, name its prefix — e.g. 'links.' or 'go.'. Empty (the
  // default) means they answer wherever your site answers, which is what you
  // want on a single domain.
  shortLinkHost: '',
  // Squarespace-era redirect table in worker.js — template forks have no
  // such history.
  legacyRedirects: false,
  // Cloudflare Web Analytics (privacy-friendly, no cookies). OFF by default:
  // the beacon is third-party JavaScript, and the published site's promise is
  // that public pages load none. Turning this on widens the public
  // Content-Security-Policy to allow Cloudflare's beacon — nothing else.
  // If you enable Web Analytics in the Cloudflare dashboard, set this too, or
  // the browser will block the auto-injected script.
  // webAnalytics: true,
  // Apple Music players in Field Notes. OFF by default for the same reason:
  // the player is a third-party iframe (embed.music.apple.com), and the
  // default policy is frame-src 'none'. Turning this on widens the
  // Content-Security-Policy to allow exactly that one host, and lets the
  // Field Notes renderer turn a pasted music.apple.com share link into a
  // player. Left off, a share link in a post renders as a plain link.
  // appleMusicEmbeds: true,
  // Demo mode: run this instance as a public, browse-only showcase. Everyone
  // can log in with the password you share and explore the whole console, but
  // every write — uploads, deletes, drafts, publish, even the subscribe form —
  // answers a polite "off in demo mode" instead of changing anything. It's a
  // config switch, not a login rule: to add or refresh content, run a second
  // deployment (or `npx wrangler dev`) WITHOUT this flag against the same
  // storage, using your own password. OFF by default — a normal site never
  // wants this.
  // demoMode: true,
  // Have you connected this repo to Cloudflare, so that publishing goes live
  // on its own? Flip this to `true` the moment you finish that (setup.md,
  // "Connect your repo"). It changes what the console's Publish screen tells
  // you: connected sites are told Cloudflare is rebuilding and the change will
  // be live in about a minute, unconnected ones are told to run
  // `npx wrangler deploy` themselves — which is the truth until you connect.
  // The Worker cannot see the connection from the inside, so this line is how
  // it knows. It ships LIVE and false on purpose: a switch you can see is a
  // switch you can find again.
  repoConnected: false,
  // The small "OS" chip in the homepage footer — one quiet link back to the
  // engine this site runs on, for a visitor who decides they want one too. It
  // is the only self-promotion in the template, it is deliberately unbranded,
  // and it is on one page, not nine. Set this to remove it entirely; the
  // licence never required it.
  // poweredBy: false,
  // ANALOGS.NETWORK — a webring of independent, creative-run sites. OFF by
  // default, and this default is load-bearing: your site must never inherit a
  // link into someone else's ring just because you forked the code. Nothing
  // renders and no route exists until you have actually joined and been given
  // a seat of your own.
  // To join: email themonitor@analogs.network, or open a pull request adding
  // your node file to github.com/oaklensart/analogs.network. A maintainer
  // merges it by hand — that merge is the moderation gate, and it is how you
  // get your number. Numbers are permanent and never reused (they start at 0).
  // Then put your seat here. The footer grows a matching ANALOGS //<n> chip
  // next to the OS one, and the site serves your ownership claim as plain text
  // at /.well-known/analogs.txt — which is optional, but it is what lets you
  // change or remove your listing later without an email round-trip, and what
  // protects your seat if the domain ever lapses.
  // webring: { node: 7, slug: 'your-slug' },
  // Podcast channel details for /podcast.xml — the RSS 2.0 feed carrying every
  // track you marked as an EPISODE on the Audio shelf. The feed serves with or
  // without this block (title and description fall back to your site name and
  // tagline), and R2 charges nothing for bandwidth, so the site can host a show
  // outright.
  //
  // 🧪 BETA — the one part of the audio layer that is. The feed is valid RSS
  // and the readiness card on your Audio shelf names every field a directory
  // wants, but exactly one short show has been through an actual submission so
  // far. Nothing is switched off; the label is here so you are not the first to
  // find out something in your own inbox. If you submit your feed anywhere,
  // please say how it went at github.com/oaklensart/oaklens-os/issues — paste
  // the rejection in full if you got one. The rest of the audio layer (player,
  // waveforms, track addresses, tracklists in posts) is not beta.
  //
  // ⚠️ SUBMITTING IT ANYWHERE NEEDS THREE FIELDS. Apple Podcasts rejects a feed
  // that is missing any of `image`, `category` or `owner.email` — Spotify and
  // Overcast are looser, but Apple's listing is the one everything else copies
  // from. The Audio shelf in your console shows exactly which of the three you
  // are still missing, so you can check before you submit rather than after a
  // rejection email. Nothing here is guessed for you, and your `email` above is
  // deliberately NOT reused: Apple republishes this feed, so the owner address
  // becomes public the moment you submit. Put one here only if you mean to.
  //
  //   image        square artwork, 1400×1400 minimum, 3000×3000 ideal
  //   category     one of Apple's fixed categories, spelled exactly —
  //                Arts · Business · Comedy · Education · Fiction · Government ·
  //                History · Health & Fitness · Kids & Family · Leisure · Music ·
  //                News · Religion & Spirituality · Science · Society & Culture ·
  //                Sports · Technology · TV & Film · True Crime
  //   subcategory  optional, and only one that belongs to your category
  //                (e.g. 'Visual Arts' under 'Arts'); a mismatch is dropped
  //   owner.email  where Apple writes about the show. Not shown to listeners,
  //                but it IS in the feed, which anyone can read
  //
  // The rest are optional. `explicit: true` marks the whole show explicit,
  // `language` takes a BCP-47 tag if your show is not in English, `type:
  // 'serial'` tells apps to play oldest-first, `copyright` is your own claim to
  // make, `locked: true` tells hosting platforms they may not import your show
  // without asking you first (the reason to self-host, in one tag), and
  // `funding` puts a support link inside the listener's podcast app.
  // podcast: {
  //   title: 'Your Show',
  //   description: 'What it is, in a sentence.',
  //   image: '/assets/podcast-cover.png',
  //   category: 'Arts',
  //   subcategory: 'Visual Arts',
  //   owner: { name: 'Your Name', email: 'show@example.com' },
  //   explicit: false,
  //   language: 'en',
  //   type: 'episodic',
  //   copyright: '© 2026 Your Name',
  //   locked: true,
  //   funding: { url: 'https://example.com/support', label: 'Support the show' },
  // },
  // Search-engine entity (Organization + WebSite JSON-LD on the homepage).
  // sameAs: only live, crawlable profile URLs — an empty list is fine.
  entity: {
    name: 'YOUR STUDIO',
    logo: '/favicon.svg',
    sameAs: [],
    // Optional: if your fork's code is public, naming it here adds a
    // SoftwareSourceCode node to the homepage entity graph, credited to you.
    // Leave empty and no node is emitted — a private repo would only point
    // crawlers at a 404, which weakens the entity signal rather than helping.
    // codeName defaults to 'OAKLENS OS'; set it if you renamed your fork.
    codeRepository: '',
    codeName: '',
  },
});
