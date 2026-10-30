// Short links scoped to one hostname (`site.config.js` → `shortLinkHost`).
//
// Third file in the set, for the usual vi.mock-is-hoisted-per-file reason:
// tests/shortlinks.test.js proves the unscoped default answers everywhere and
// tests/shortlinks-off.test.js proves an empty table is inert, so this one has
// to configure a scope of its own to prove the scope bites.
//
// The prefix mocked here is NOT this instance's, so it reads the same on a fork.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: Object.freeze({
      ...actual.default,
      shortLinkHost: 'links.',
      shortLinks: {
        talk: 'https://example.com/a-talk',
        // a link naming its own host: the OTHER side of a two-host instance
        notes: { url: 'https://example.com/field-notes/post?slug=fn-001', host: 'example.com' },
        // malformed values resolve to nothing, like a typo
        broken: { host: 'example.com' },
        odd: 42,
      },
    }),
  };
});

const worker = (await import('../worker.js')).default;
const { resolveShortLink } = await import('../src/shared/shortlinks.js');

const ENV = { ASSETS: { fetch: async () => new Response('nope', { status: 404 }) } };
const get = (host, path) =>
  worker.fetch(new Request(`https://${host}${path}`), ENV, { waitUntil() {} });

describe('a scoped table answers on its own host only', () => {
  it('redirects on the scoped host', async () => {
    const res = await get('links.example.com', '/talk');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://example.com/a-talk');
  });

  // The whole reason to scope: the other host keeps that path for itself. Not
  // a redirect to the scoped host — a 404, so there is exactly one address for
  // the link rather than two that both work.
  it('is invisible everywhere else — the path falls through to the site', async () => {
    let reached = false;
    const env = {
      ASSETS: {
        fetch: async () => { reached = true; return new Response('404', { status: 404 }); },
      },
    };
    const res = await worker.fetch(
      new Request('https://example.com/talk'), env, { waitUntil() {} },
    );
    expect(res.status).toBe(404);
    expect(reached, 'the apex must keep its own path').toBe(true);
  });

  it('matches by prefix, so the scope names no apex', () => {
    // Both spellings of the same intent resolve; neither hardcodes a domain.
    expect(resolveShortLink('/talk', 'links.example.com')).toBeTruthy();
    expect(resolveShortLink('/talk', 'links.somewhere-else.test')).toBeTruthy();
    expect(resolveShortLink('/talk', 'example.com')).toBeNull();
    // Not a substring match: the prefix has to start the hostname.
    expect(resolveShortLink('/talk', 'my.links.example.com')).toBeNull();
  });

  it('treats a missing hostname as out of scope, never as a wildcard', () => {
    expect(resolveShortLink('/talk')).toBeNull();
  });
});

describe('a link that names its own host', () => {
  it('answers on its host even though the table is scoped elsewhere', async () => {
    const res = await get('example.com', '/notes');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://example.com/field-notes/post?slug=fn-001');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('is a 404 on the table\'s host — one address, not two', () => {
    expect(resolveShortLink('/notes', 'links.example.com')).toBeNull();
  });

  it('leaves the rest of the table on the table\'s scope', () => {
    expect(resolveShortLink('/talk', 'example.com')).toBeNull();
    expect(resolveShortLink('/talk', 'links.example.com')).toBe('https://example.com/a-talk');
  });

  it('ignores an entry with no url, or one that is not a link at all', () => {
    expect(resolveShortLink('/broken', 'example.com')).toBeNull();
    expect(resolveShortLink('/odd', 'example.com')).toBeNull();
    expect(resolveShortLink('/odd', 'links.example.com')).toBeNull();
  });
});
