// GET /podcast.xml — the RSS 2.0 feed podcast apps subscribe to.
//
// This is a SEPARATE document from /feed.xml, and the separation is the
// feature: Apple Podcasts and friends require RSS 2.0 (the blog feed is Atom,
// which they cannot read), and only tracks the author marked `episode` belong
// in a subscriber's queue. A demo or a voice memo leaking into someone's
// podcast app is the failure this guards against.
//
// The enclosure is what actually plays, so its three attributes are asserted
// directly: a wrong `length` makes clients mis-scrub, and a wrong `type` makes
// them refuse the file outright.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../worker.js';
import { cdnBase } from '../src/shared/site.js';
import siteConfig from '../src/shared/config.js';

const ORIGIN = 'https://example.com';
// Derived, never hardcoded: an instance with a custom CDN domain and a
// zero-config fork (which serves through /api/cdn) must both read the same
// here — and a real domain does not belong in a test file either way.
const CDN = cdnBase(ORIGIN);

const TRACKS = [
  {
    id: '1', slug: 'ep-004', filename: 'ep-004.mp3', title: 'Episode 4',
    sub: 'The ferry at dawn', duration: 2400, size: 38_400_000,
    mime: 'audio/mpeg', added_at: '2026-08-12', episode: true,
  },
  {
    id: '2', slug: 'ep-003', filename: 'ep-003.m4a', title: 'Episode 3',
    duration: 1800, size: 28_000_000, mime: 'audio/mp4',
    added_at: '2026-08-05', episode: true,
  },
  // Marked featured but NOT an episode: a loose demo that belongs on the
  // homepage card and nowhere near a podcast app.
  {
    id: '3', slug: 'take-one', filename: 'take-one.mp3', title: 'Take One',
    duration: 214, size: 3_400_000, added_at: '2026-08-14', featured: true,
  },
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

const feed = (env) => worker.fetch(new Request(`${ORIGIN}/podcast.xml`), env, { waitUntil() {} });
const body = async (env) => (await feed(env)).text();

describe('/podcast.xml — the document podcast apps expect', () => {
  it('serves RSS 2.0 with the iTunes namespace, not Atom', async () => {
    const res = await feed(envWith(TRACKS));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    const xml = await res.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('http://www.itunes.com/dtds/podcast-1.0.dtd');
  });

  it('carries only tracks marked as episodes', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('Episode 4');
    expect(xml).toContain('Episode 3');
    // The whole point of the per-track switch.
    expect(xml).not.toContain('Take One');
  });

  it('orders newest first', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml.indexOf('Episode 4')).toBeLessThan(xml.indexOf('Episode 3'));
  });
});

describe('the enclosure — what actually plays', () => {
  it('names the file, its exact byte length, and its MIME type', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain(
      `<enclosure url="${CDN}/audio/ep-004.mp3" length="38400000" type="audio/mpeg"/>`
    );
  });

  it('uses each track\'s own recorded type rather than assuming mp3', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('type="audio/mp4"');
  });

  it('falls back to a type derived from the extension when none was recorded', async () => {
    const xml = await body(envWith([
      { slug: 'x', filename: 'x.flac', title: 'X', size: 10, added_at: '2026-01-01', episode: true },
    ]));
    expect(xml).toContain('type="audio/flac"');
  });

  it('emits a zero length rather than an empty attribute when size is unknown', async () => {
    // An absent length attribute is invalid; "0" is a value clients handle.
    const xml = await body(envWith([
      { slug: 'x', filename: 'x.mp3', title: 'X', added_at: '2026-01-01', episode: true },
    ]));
    expect(xml).toContain('length="0"');
  });
});

describe('per-item metadata', () => {
  it('gives every item a permalink guid pointing at its /listen page', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('<guid isPermaLink="true">https://example.com/listen/?a=ep-004</guid>');
  });

  it('emits pubDate in RFC-822, not ISO', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('<pubDate>Wed, 12 Aug 2026 00:00:00 GMT</pubDate>');
    expect(xml).not.toContain('<pubDate>2026-08-12T');
  });

  it('survives an unparseable date instead of emitting Invalid Date', async () => {
    const xml = await body(envWith([
      { slug: 'x', filename: 'x.mp3', title: 'X', size: 1, added_at: 'whenever', episode: true },
    ]));
    expect(xml).not.toContain('Invalid Date');
    expect(xml).toContain('<pubDate>');
  });

  it('reports duration in seconds', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('<itunes:duration>2400</itunes:duration>');
  });

  it('escapes a title rather than breaking the document', async () => {
    const xml = await body(envWith([
      { slug: 'x', filename: 'x.mp3', title: 'Bits & <Pieces>', size: 1, added_at: '2026-01-01', episode: true },
    ]));
    expect(xml).toContain('Bits &amp; &lt;Pieces&gt;');
    expect(xml).not.toContain('<Pieces>');
  });
});

describe('a site with no show', () => {
  it('serves a valid, empty channel when nothing is marked an episode', async () => {
    const xml = await body(envWith([TRACKS[2]]));
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('</channel>');
    expect(xml).not.toContain('<item>');
  });

  it('serves an empty channel when the registry is missing (an un-seeded fork)', async () => {
    const res = await feed({
      ASSETS: { async fetch() { return new Response('nope', { status: 404 }); } },
      CDN: {},
    });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('<item>');
  });

  it('503s on a transient read failure instead of serving an empty show', async () => {
    // A client that sees zero items can drop the subscription — so "I could
    // not read it" must never look like "there are no episodes".
    const res = await feed({
      ASSETS: { async fetch() { throw new Error('upstream down'); } },
      CDN: {},
    });
    expect(res.status).toBe(503);
  });

  it('omits itunes:image when the instance has configured no artwork', async () => {
    // Apple needs it before a submission; emitting a broken or non-square URL
    // to satisfy a validator would be worse than leaving it out.
    const xml = await body(envWith(TRACKS));
    expect(xml).not.toContain('<itunes:image');
  });
});

// ---- the three-tier posture, unconfigured half ----
//
// This file runs against the repo's real site.config.js, which declares no
// `podcast` block — so it IS the fork case. Its pair,
// tests/podcast-feed-configured.test.js, proves the same fields appear once
// they are configured; vi.mock is hoisted per file, so the split is structural
// rather than stylistic.

describe('tier 1 — always emitted, because the default is a true statement', () => {
  it('declares a language', async () => {
    // The shipped pages are `<html lang="en">`, so `en` is not a guess here.
    expect(await body(envWith(TRACKS))).toContain('<language>en</language>');
  });

  it('declares the show episodic and not explicit', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('<itunes:type>episodic</itunes:type>');
    expect(xml).toContain('<itunes:explicit>false</itunes:explicit>');
  });

  it('names the software that built it', async () => {
    expect(await body(envWith(TRACKS))).toContain('<generator>');
  });
});

describe('lastBuildDate', () => {
  it('is the newest episode\'s pubDate, never the current time', async () => {
    // ⚠️ THE LOAD-BEARING ASSERTION. `new Date()` here would change the body on
    // every request, defeating the one-hour cache and every conditional GET a
    // podcast client makes — and it would not be true, because nothing was
    // built. The newest episode is ep-004, added 2026-08-12.
    const xml = await body(envWith(TRACKS));
    expect(xml).toContain('<lastBuildDate>Wed, 12 Aug 2026 00:00:00 GMT</lastBuildDate>');
    // Not "now": today's date must not appear as a build date. Compared as the
    // RSS day form ("DD Mon YYYY") so it cannot collide with an episode's own
    // 00:00:00 time — the old year+hour check false-matched "2026 00:00:00"
    // for the whole UTC-midnight hour, one red hour a day for no real reason.
    const today = new Date().toUTCString().slice(5, 16);
    expect(xml).not.toContain(today);
  });

  it('is omitted entirely when there are no episodes', async () => {
    // Nothing was ever built, so there is no date to state.
    expect(await body(envWith([TRACKS[2]]))).not.toContain('<lastBuildDate>');
  });
});

describe('tier 2 — absent, and the absence IS the un-submittability', () => {
  it('emits no category, owner or copyright on an unconfigured instance', async () => {
    const xml = await body(envWith(TRACKS));
    expect(xml).not.toContain('<itunes:category');
    expect(xml).not.toContain('<itunes:owner>');
    expect(xml).not.toContain('<copyright>');
  });

  it('never invents an owner email from the site contact address', async () => {
    // ⚠️ The single worst available idea in this file. Apple republishes the
    // feed, so defaulting the owner to siteConfig.email would publish a fork
    // owner's contact address into a public directory listing without anyone
    // opting in. Asserted against the real config, so the instance's own
    // address is what would show up if this ever regressed.
    const xml = await body(envWith(TRACKS));
    expect(xml).not.toContain('<itunes:email>');
    expect(xml).not.toContain(siteConfig.email);
  });

  it('declares no podcast: namespace when it emits no podcast: tag', async () => {
    // An unused namespace on every fork's feed is noise a validator may flag.
    const xml = await body(envWith(TRACKS));
    expect(xml).not.toContain('xmlns:podcast');
    expect(xml).not.toContain('<podcast:');
  });

  it('still serves valid, parseable RSS — un-submittable is not broken', async () => {
    // The serving contract: an unconfigured fork that uploads a voice memo gets
    // a real feed. Only a directory submission is gated, and the console card
    // is what makes that discoverable before Apple does.
    const res = await feed(envWith(TRACKS));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('</rss>');
    expect(xml).not.toContain('undefined');
    expect(xml).not.toContain('[object Object]');
  });
});
