// Field Notes in the sitemap, and a robots.txt that points at it
// (maintenance review 2026-10-15, W9 + W10).
//
// The sitemap listed pages, the manifest, audio and cards — and not one Field
// Note, though the writing surface is first-class. And /robots.txt did not
// exist, so every crawler's first request rendered the 404 page.
import { describe, it, expect, vi } from 'vitest';
import worker from '../worker.js';

const POSTS = [
  { fn_id: 'fn-001', title: 'One', added_at: '2026-05-25T18:00:00.000Z' },
  { fn_id: 'fn-002', title: 'Two', date: '2026-06-01' },
  { fn_id: 'bad slug&x', title: 'Never listed' },
  { title: 'No id' },
];

const env = {
  ASSETS: {
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/data/posts.json') return new Response(JSON.stringify(POSTS));
      return new Response('nope', { status: 404 });
    },
  },
};
const ctx = { waitUntil() {} };
const get = (path, method = 'GET') =>
  worker.fetch(new Request(`https://example.com${path}`, { method }), env, ctx);

describe('the sitemap lists every published Field Note', () => {
  it('at the page address, with the date it went up', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    expect(xml).toContain('<loc>https://example.com/field-notes/post?slug=fn-001</loc><lastmod>2026-05-25</lastmod>');
    expect(xml).toContain('<loc>https://example.com/field-notes/post?slug=fn-002</loc><lastmod>2026-06-01</lastmod>');
  });

  it('skips anything that is not a page-shaped slug, so the XML stays valid', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    expect(xml).not.toContain('bad slug');
    expect(xml).not.toContain('&x');
    expect((xml.match(/field-notes\/post/g) || []).length).toBe(2);
  });
});

describe('/robots.txt', () => {
  it('names this origin\'s sitemap and keeps crawlers off the API', async () => {
    const res = await get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Sitemap: https://example.com/sitemap.xml');
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Disallow: /dev/field-console');
  });

  it('answers a HEAD too', async () => {
    expect((await get('/robots.txt', 'HEAD')).status).toBe(200);
  });
});

describe('the daily Wayback run, switched off (H3)', () => {
  it('says nothing when its keys are not set: off is a choice, not a fault', async () => {
    const { runArchiveCapture } = await import('../src/cron/archive.js');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await runArchiveCapture({});
    expect(err).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    err.mockRestore();
    fetchSpy.mockRestore();
  });
});
