// @vitest-environment happy-dom
//
// /card/<id> — a composed card at its own address.
//
// Owner decision 2.1(1) (docs/cards-core-complete.md chunk 6): a card is a
// content type, and a content type has a permanent URL. Three halves meet here,
// so they are tested together rather than scattered:
//
//   the ENGINE   — entryHref spells the address; composedPick drops a tombstone
//   the EDGE     — the route serves one document for every id, answers 410 for
//                  a retired one, and resolves the OG block a share link needs
//   the PAGE     — js/page-card.js resolves the id and finds the record, with
//                  no network and no worker in front of it (the export's shape)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../js/recent-index.js';
import '../js/page-card.js';
import worker from '../worker.js';
import { getCardRecord, getCardOgData, _validCardId } from '../src/edge/chrome.js';

// The edge data loader reads through caches.default, which Node has no notion
// of. A fresh map per test, for the reason tests/audio-listen.test.js gives:
// the loader keys by path, so one test's registry would stay warm for the next.
// HTMLRewriter only exists on the Workers runtime. The route tests here care
// about the STATUS and which document was served, not about the chrome
// injection (tests/console-features.test.js owns that), so a pass-through
// stand-in is exactly enough — except for the OG assertion, which drives the
// recorded handlers itself.
let _savedCaches, _savedRewriter;
let injected = [];
beforeEach(() => {
  _savedCaches = globalThis.caches;
  _savedRewriter = globalThis.HTMLRewriter;
  injected = [];
  globalThis.HTMLRewriter = class {
    on(sel, handler) {
      if (sel === 'head' && handler && handler.element) {
        handler.element({
          append: (html) => injected.push(html),
          prepend: (html) => injected.push(html),
          setAttribute() {}, setInnerContent() {}, remove() {},
          getAttribute() { return null; },
        });
      }
      return this;
    }
    // Pass-through: the document the route chose is what these tests are about,
    // and `injected` above holds whatever the worker asked to put in its head.
    transform(res) { return new Response(res.body, res); }
  };
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = store.get(typeof req === 'string' ? req : req.url);
        return hit ? new Response(hit) : undefined;
      },
      async put(req, res) {
        store.set(typeof req === 'string' ? req : req.url, await res.text());
      },
    },
  };
});
afterEach(() => {
  globalThis.caches = _savedCaches;
  globalThis.HTMLRewriter = _savedRewriter;
});

const { entryHref, composedPick } = globalThis.RecentIndex;
const { idFromLocation, findCard } = globalThis.PageCard;

const LIVE = { id: 'c-abc123', order: 1, title: 'The long way round', tease: 'Two hours of it.', added_at: '2026-09-11' };
const TOMB = { id: 'c-gone99', order: 2, retired: true, retired_at: '2026-09-11T00:00:00.000Z' };
const CARDS = [LIVE, TOMB];

// Serves data/cards.json out of ASSETS the way the real edge loader reads it,
// plus the one document the route serves for every address.
const envWith = (cards) => ({
  ASSETS: {
    async fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === '/data/cards.json') {
        return cards
          ? new Response(JSON.stringify(cards), { status: 200 })
          : new Response('not found', { status: 404 });
      }
      if (p === '/card/') {
        return new Response('<!DOCTYPE html><html><head></head><body><main id="card-page"></main></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return new Response('not found', { status: 404 });
    },
  },
  CDN: { async head() { return null; } },   // no stamped share image yet (chunk 7)
});

const hit = (path, env) =>
  worker.fetch(new Request(`https://example.com${path}`), env, { waitUntil() {} });

describe('entryHref — the address is spelled in exactly one place', () => {
  it('gives a composed card its own path', () => {
    expect(entryHref('composed', LIVE)).toBe('/card/c-abc123');
  });

  it('encodes the id rather than trusting it into a URL', () => {
    expect(entryHref('composed', { id: 'c-a b/c' })).toBe('/card/c-a%20b%2Fc');
  });

  it('answers nothing for a card with no id — a control with no address is no control', () => {
    expect(entryHref('composed', {})).toBe('');
    expect(entryHref('composed', null)).toBe('');
  });

  it('leaves the four visitor kinds exactly where they were', () => {
    expect(entryHref('archive', { slug: 's' })).toBe('/archive/?f=s');
    expect(entryHref('raw', { id: '7' })).toBe('/archive/buffer/?f=7');
    expect(entryHref('text', { fn_id: 'n' })).toBe('/field-notes/post?slug=n');
  });
});

describe('composedPick — a tombstone is not a card', () => {
  it('drops a retired record even though it has an id and an order', () => {
    const picked = composedPick([LIVE, TOMB], [], []);
    expect(picked.map((p) => p.over.id)).toEqual(['c-abc123']);
  });

  it('keeps COMPOSED_MAX a budget of LIVE cards — two tombstones do not lock the grid', () => {
    const cards = [
      { id: 'c-1', order: 1, retired: true },
      { id: 'c-2', order: 2, retired: true },
      { id: 'c-3', order: 3, title: 'Still here' },
    ];
    expect(composedPick(cards, [], []).map((p) => p.over.id)).toEqual(['c-3']);
  });
});

describe('_validCardId — an id in a path is untrusted input', () => {
  it.each(['c-abc123', 'c-A_b-9', 'anything-a-later-console-mints'])('accepts %s', (id) => {
    expect(_validCardId(id)).toBe(true);
  });

  it.each(['', '../../secrets', 'c-a/b', 'c a', 'c-é', 'x'.repeat(65), null, 7])(
    'refuses %s', (id) => {
      expect(_validCardId(id)).toBe(false);
    });
});

describe('the route — one document, three answers', () => {
  it('serves the card page for a live id', async () => {
    const res = await hit('/card/c-abc123', envWith(CARDS));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('id="card-page"');
  });

  it('answers 410 for a retired id — the address is reserved, not free', async () => {
    const res = await hit('/card/c-gone99', envWith(CARDS));
    expect(res.status).toBe(410);
  });

  it('never caches the 410 — a tombstone is undone by a publish, not by a TTL', async () => {
    const res = await hit('/card/c-gone99', envWith(CARDS));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('carries the security header set on the 410, which is hand-built', async () => {
    const res = await hit('/card/c-gone99', envWith(CARDS));
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('serves the page for an unknown id — the plain state, not an error', async () => {
    const res = await hit('/card/c-never-existed', envWith(CARDS));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="card-page"');
  });

  it('serves the page when the registry is missing entirely (an un-seeded fork)', async () => {
    const res = await hit('/card/c-abc123', envWith(null));
    expect(res.status).toBe(200);
  });

  it('serves the page for the trailing-slash spelling of the same address', async () => {
    expect((await hit('/card/c-abc123/', envWith(CARDS))).status).toBe(200);
    expect((await hit('/card/c-gone99/', envWith(CARDS))).status).toBe(410);
  });

  it('leaves bare /card/ to the asset layer — there is no index of cards', async () => {
    const res = await hit('/card/', envWith(CARDS));
    expect(res.status).toBe(200);
  });

  // ⚠️ THE ROUTE CLAIMS ONLY WHAT IS AN ADDRESS, and this is the regression it
  // exists for. The page is served at two depths (`/card/<id>` and
  // `/card/<id>/` are the same address), so a document-relative reference on it
  // resolves under /card/ for one of them. When the route swallowed every
  // sub-path, `/card/<id>/` asked for `/card/css/main.css` and got THIS PAGE
  // back as text/html — which every browser refuses as a stylesheet, rendering
  // the card page naked. The page's own refs are root-relative now; this keeps
  // the route from being able to answer for a sub-path at all.
  it('does not answer for a sub-path — that is not an address, it is a file', async () => {
    const res = await hit('/card/css/main.css', envWith(CARDS));
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type') || '').not.toContain('text/html');
  });

  it('refuses a malformed id rather than claiming it', async () => {
    const res = await hit('/card/..%2F..%2Fsite.config.js', envWith(CARDS));
    expect(res.status).toBe(404);
  });

  it('looks the registry up ONCE for a live card — the page and the unfurl share it', async () => {
    let reads = 0;
    const env = envWith(CARDS);
    const inner = env.ASSETS.fetch;
    env.ASSETS = { async fetch(req) {
      if (new URL(req.url).pathname === '/data/cards.json') reads++;
      return inner(req);
    } };
    await hit('/card/c-abc123', env);
    expect(reads).toBe(1);
  });
});

// The page is served at two depths, so nothing on it may be document-relative.
// Asserted against the file rather than only through the route, because the
// route test above cannot see an href that has not been requested yet.
describe('the page carries no depth-dependent reference', () => {
  it('links every asset root-relative', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const html = readFileSync(join(import.meta.dirname, '..', 'card', 'index.html'), 'utf8');
    const relative = [...html.matchAll(/\s(?:href|src)="(\.\.?\/[^"]*)"/g)].map((m) => m[1]);
    expect(relative, `document-relative on a page served at two depths: ${relative.join(', ')}`)
      .toEqual([]);
  });
});

describe('getCardRecord — live, retired, missing, and never a throw', () => {
  it('tells the three states apart', async () => {
    const env = envWith(CARDS);
    expect((await getCardRecord('https://example.com', env, 'c-abc123')).state).toBe('live');
    expect((await getCardRecord('https://example.com', env, 'c-gone99')).state).toBe('retired');
    expect((await getCardRecord('https://example.com', env, 'c-nope')).state).toBe('missing');
  });

  it('degrades an unreadable registry to `missing`, never to an error on a share link', async () => {
    const broken = { ASSETS: { async fetch() { throw new Error('down'); } }, CDN: {} };
    expect((await getCardRecord('https://example.com', broken, 'c-abc123')).state).toBe('missing');
  });
});

describe('getCardOgData — what a shared card link unfurls as', () => {
  const url = new URL('https://example.com/card/c-abc123');

  it('unfurls as the author\'s own words', async () => {
    const og = await getCardOgData(url, envWith(CARDS), LIVE);
    expect(og.title).toContain('The long way round');
    expect(og.description).toBe('Two hours of it.');
    expect(og.ogUrl).toBe('https://example.com/card/c-abc123');
  });

  it('falls back to the title, then to the site line, rather than to an empty tag', async () => {
    const env = envWith(CARDS);
    expect((await getCardOgData(url, env, { id: 'c-1', title: 'Just a caption' })).description)
      .toBe('Just a caption');
    expect((await getCardOgData(url, env, { id: 'c-1' })).description).toBeTruthy();
  });

  it('carries no image until something stamps one (chunk 7)', async () => {
    expect((await getCardOgData(url, envWith(CARDS), LIVE)).image).toBeNull();
  });

  it('uses the stamped share image once R2 has one, under the card\'s own key prefix', async () => {
    const seen = [];
    const env = { ...envWith(CARDS), CDN: { async head(key) { seen.push(key); return { key }; } } };
    const og = await getCardOgData(url, env, LIVE);
    expect(seen).toContain('meta/card-c-abc123-og.webp');
    expect(og.image).toContain('meta/card-c-abc123-og.webp');
  });

  it('injects the block into the served page, so a share link is never a bare site unfurl', async () => {
    await hit('/card/c-abc123', envWith(CARDS));
    const head = injected.join('');
    expect(head).toContain('og:title');
    expect(head).toContain('The long way round');
  });

  it('injects no card block for an id nothing answers to', async () => {
    await hit('/card/c-never-existed', envWith(CARDS));
    expect(injected.join('')).not.toContain('c-never-existed');
  });
});

describe('sitemap — a card earns its listing the way everything else does', () => {
  const sitemap = (env) => worker.fetch(new Request('https://example.com/sitemap.xml'), env, { waitUntil() {} });

  it('lists a live card at its own address', async () => {
    expect(await (await sitemap(envWith(CARDS))).text())
      .toContain('<loc>https://example.com/card/c-abc123</loc>');
  });

  it('omits a retired one — a reserved address with nothing behind it', async () => {
    expect(await (await sitemap(envWith(CARDS))).text()).not.toContain('c-gone99');
  });

  it('omits a draft with neither a picture nor a word', async () => {
    const xml = await (await sitemap(envWith([{ id: 'c-empty', order: 1 }]))).text();
    expect(xml).not.toContain('c-empty');
  });

  it('lists a picture card with no words, and an audio card that names a set', async () => {
    const xml = await (await sitemap(envWith([
      { id: 'c-pic', order: 1, media: 'X.webp' },
      { id: 'c-aud', order: 2, kind: 'audio', set: 'late-mix' },
    ]))).text();
    expect(xml).toContain('/card/c-pic');
    expect(xml).toContain('/card/c-aud');
  });

  it('lists nothing when there are no cards (an un-seeded fork)', async () => {
    expect(await (await sitemap(envWith(null))).text()).not.toContain('/card/');
  });
});

describe('the page — it resolves its own address, with or without a worker', () => {
  it('reads the id out of the canonical path', () => {
    expect(idFromLocation('/card/c-abc123', '')).toBe('c-abc123');
    expect(idFromLocation('/card/c-abc123/', '')).toBe('c-abc123');
  });

  it('reads it out of ?id= too — the export runs from file:// with no server', () => {
    expect(idFromLocation('/some/where/card/index.html', '?id=c-abc123')).toBe('c-abc123');
  });

  it('prefers the path when both are present — that is the one a share link carries', () => {
    expect(idFromLocation('/card/c-abc123', '?id=c-other')).toBe('c-abc123');
  });

  it('decodes what entryHref encoded, so the two are a round trip', () => {
    const weird = { id: 'c-a b' };
    expect(idFromLocation(entryHref('composed', weird), '')).toBe('c-a b');
  });

  it('answers empty for an address with no id at all', () => {
    expect(idFromLocation('/card/', '')).toBe('');
    expect(idFromLocation('/', '')).toBe('');
  });

  // A SEGMENT WITH A DOT IN IT IS A FILE, NOT A CARD.
  //
  // The edge's _validCardId refuses a dot, so /card/index.html is never claimed
  // by the route — it falls through to the asset layer, which serves this very
  // page with the query still attached. The path branch then claimed
  // "index.html" as the id and ignored the ?id= sitting right beside it, so
  // every card read "no card here" on a static server, a staging host, or any
  // preview that spells out index.html. The file:// export dodged it only
  // because its pathname does not begin at /card/. Found by a code review.
  it('does not mistake /card/index.html for a card id', () => {
    expect(idFromLocation('/card/index.html', '?id=c-abc123')).toBe('c-abc123');
    expect(idFromLocation('/card/index.html', '')).toBe('');
  });

  it('and refuses any other file sitting beside the page', () => {
    for (const file of ['style.css', 'page-card.js', 'favicon.ico']) {
      expect(idFromLocation(`/card/${file}`, ''), file).toBe('');
    }
  });

  it('an id the edge would accept still resolves from the path', () => {
    // The mirror of the rule above: _validCardId's character class has no dot
    // in it, so nothing this rejects could ever have been a live address.
    for (const id of ['c-abc123', 'c_ABC-123', 'abc123']) {
      expect(idFromLocation(`/card/${id}`, ''), id).toBe(id);
    }
  });

  it('finds the live record and refuses the tombstone — the same answer as the edge', () => {
    expect(findCard(CARDS, 'c-abc123')).toBe(LIVE);
    expect(findCard(CARDS, 'c-gone99')).toBeNull();
    expect(findCard(CARDS, 'c-nope')).toBeNull();
    expect(findCard(null, 'c-abc123')).toBeNull();
  });
});
