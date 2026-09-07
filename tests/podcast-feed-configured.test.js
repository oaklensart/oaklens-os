// GET /podcast.xml with a show actually configured — the submittable half.
//
// Isolated in its own file for the same reason as tests/webring-route.test.js:
// vi.mock is hoisted per file, and its pair (tests/podcast-feed.test.js) has to
// run against the repo's real config to prove the FORK case — a feed that is
// valid RSS and deliberately not submittable. The pairing is the point: "absent
// unless you configure it" only means something if configuring it demonstrably
// changes the document.
//
// The mocked show is deliberately not this instance's: every assertion here
// must read the same on a stranger's fork.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: Object.freeze({
      ...actual.default,
      podcast: {
        title: 'Example Show',
        description: 'A show about examples.',
        image: '/assets/cover.png',
        category: 'Arts',
        subcategory: 'Visual Arts',
        owner: { name: 'Example Owner', email: 'show@example.org' },
        explicit: true,
        language: 'pt-BR',
        type: 'serial',
        copyright: '(c) 2026 Example Owner',
        locked: true,
        funding: { url: 'https://example.org/support', label: 'Back the show' },
      },
    }),
  };
});

const worker = (await import('../worker.js')).default;

const ORIGIN = 'https://example.com';
const TRACKS = [
  { slug: 'ep-002', filename: 'ep-002.mp3', title: 'Two', size: 2, added_at: '2026-08-12', episode: true },
  { slug: 'ep-001', filename: 'ep-001.mp3', title: 'One', size: 1, added_at: '2026-08-05', episode: true },
];

const envWith = (tracks) => ({
  ASSETS: {
    async fetch(req) {
      if (new URL(req.url).pathname === '/data/audio.json') {
        return new Response(JSON.stringify(tracks), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  },
  CDN: {},
});

let _savedCaches;
beforeEach(() => {
  _savedCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = store.get(typeof req === 'string' ? req : req.url);
        return hit ? new Response(hit) : undefined;
      },
      async put(req, res) { store.set(typeof req === 'string' ? req : req.url, await res.text()); },
    },
  };
});
afterEach(() => { globalThis.caches = _savedCaches; });

const get = (path, env) => worker.fetch(new Request(`${ORIGIN}${path}`), env, { waitUntil() {} });
const body = async (env = envWith(TRACKS)) => (await get('/podcast.xml', env)).text();

describe('the three fields Apple hard-requires', () => {
  it('emits the category, nested with its sub-category', async () => {
    const xml = await body();
    expect(xml).toContain('<itunes:category text="Arts">');
    expect(xml).toContain('<itunes:category text="Visual Arts"/>');
    expect(xml).toContain('</itunes:category>');
  });

  it('emits the owner block with the configured name and address', async () => {
    const xml = await body();
    expect(xml).toContain('<itunes:name>Example Owner</itunes:name>');
    expect(xml).toContain('<itunes:email>show@example.org</itunes:email>');
  });

  it('resolves relative artwork against the serving origin', async () => {
    // A podcast client fetches this from anywhere; a root-relative path is not
    // an address it can resolve.
    expect(await body()).toContain(`<itunes:image href="${ORIGIN}/assets/cover.png"/>`);
  });

  it('leaves an absolute artwork URL alone', async () => {
    // Artwork commonly lives on a CDN the site does not serve from, so an
    // absolute URL must not get the origin glued onto the front of it.
    const { artworkHref } = await import('../src/shared/podcast.js');
    expect(artworkHref({ image: 'https://cdn.example.net/cover.png' }, ORIGIN))
      .toBe('https://cdn.example.net/cover.png');
  });
});

describe('tier 1 follows the config rather than the default', () => {
  it('carries the configured language and show type', async () => {
    const xml = await body();
    expect(xml).toContain('<language>pt-BR</language>');
    expect(xml).toContain('<itunes:type>serial</itunes:type>');
  });

  it('marks the show explicit on the channel AND on every item', async () => {
    // A single re-hosted episode has to carry its own rating; a client that
    // sees only the item must still get the truth.
    const xml = await body();
    expect(xml).toContain('<itunes:explicit>true</itunes:explicit>');
    expect(xml).not.toContain('<itunes:explicit>false</itunes:explicit>');
    expect((xml.match(/<itunes:explicit>true<\/itunes:explicit>/g) || []).length).toBe(3);
  });
});

describe('the podcast: namespace tags — the self-hosting win', () => {
  it('declares the namespace only because it emits tags from it', async () => {
    const xml = await body();
    expect(xml).toContain('xmlns:podcast="https://podcastindex.org/namespace/1.0"');
  });

  it('locks the feed to the owner address, so no platform can import it silently', async () => {
    expect(await body()).toContain('<podcast:locked owner="show@example.org">yes</podcast:locked>');
  });

  it('puts the support link in the listener\'s app', async () => {
    expect(await body()).toContain('<podcast:funding url="https://example.org/support">Back the show</podcast:funding>');
  });

  it('carries the copyright line verbatim, because it is a claim we never write', async () => {
    expect(await body()).toContain('<copyright>(c) 2026 Example Owner</copyright>');
  });
});

describe('title and description come from the show, not the site', () => {
  it('prefers the configured show title over the site name', async () => {
    const xml = await body();
    expect(xml).toContain('<title>Example Show</title>');
    expect(xml).toContain('<description>A show about examples.</description>');
  });
});

// ---- discovery ----
//
// A correct feed nobody can find is worth nothing. Both gates live here because
// both need the config present; their negative halves are in the unconfigured
// file.

describe('discovery', () => {
  it('advertises the feed from every HTML page', async () => {
    // ⚠️ Gated on CONFIG, not on episode count: siteMetaTags runs synchronously
    // inside an HTMLRewriter element handler and cannot read data/audio.json,
    // and a data fetch on every HTML response is exactly the hot-path cost the
    // working agreement forbids.
    const { siteMetaTags } = await import('../src/shared/site.js');
    const tags = siteMetaTags(ORIGIN);
    expect(tags).toContain('type="application/rss+xml"');
    expect(tags).toContain('href="/podcast.xml"');
    // The blog's Atom feed is a different document and must survive alongside.
    expect(tags).toContain('type="application/atom+xml"');
  });

  it('lists /podcast.xml in the sitemap once an episode exists', async () => {
    const xml = await (await get('/sitemap.xml', envWith(TRACKS))).text();
    expect(xml).toContain(`<loc>${ORIGIN}/podcast.xml</loc>`);
  });

  it('keeps /podcast.xml out of the sitemap when no track is an episode', async () => {
    // The feed still serves. Advertising a channel with no items invites a
    // crawler to fetch an empty show, and a client that sees zero items can
    // drop the subscription.
    const xml = await (await get('/sitemap.xml', envWith([
      { slug: 'demo', filename: 'demo.mp3', title: 'Demo', added_at: '2026-01-01' },
    ]))).text();
    expect(xml).not.toContain('/podcast.xml');
    // …while /listen, which has something to play, is still listed.
    expect(xml).toContain(`<loc>${ORIGIN}/listen</loc>`);
  });
});
