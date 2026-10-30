// Footer buttons — the owner's own small badges, ahead of the footer chips.
//
// The claims this file holds: a button renders only when it is whole (read
// exact-shaped, like the webring seat); its image is always a key on the site's
// own CDN, so the CSP never widens and the Site-in-a-ZIP mirrors it; it can
// never stretch the footer; and a fork inherits none.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: Object.freeze({
      ...actual.default,
      cdnBase: 'https://cdn.example.com',
      footerButtons: [{ href: 'https://friend.example', image: 'buttons/friend.gif', width: 88, height: 31, alt: 'A friend' }],
    }),
  };
});

const { footerButtonList, _footerChipsHtml } = await import('../src/edge/chrome.js');
const { buildCsp } = await import('../src/shared/csp.js');
const { mapReference } = await import('../js/site-export-core.js');
const { resolveConfig } = await import('../src/shared/config.js');
const example = (await import('../site.config.example.js')).default;

const WHOLE = Object.freeze({ href: 'https://friend.example', image: 'buttons/friend.gif', width: 88, height: 31, alt: 'A friend' });
const only = (b) => ({ poweredBy: false, footerButtons: [b] });

describe('footerButtonList() — whole entries only', () => {
  it('keeps a whole entry, and a root-relative link', () => {
    expect(footerButtonList({ footerButtons: [WHOLE] })).toEqual([WHOLE]);
    expect(footerButtonList({ footerButtons: [{ ...WHOLE, href: '/about' }] })).toHaveLength(1);
  });

  it.each([
    ['no block', {}],
    ['not a list', { footerButtons: WHOLE }],
    ['an empty entry', { footerButtons: [{}] }],
    ['no alt', { footerButtons: [{ ...WHOLE, alt: '' }] }],
    ['an alt of spaces', { footerButtons: [{ ...WHOLE, alt: '   ' }] }],
    ['a plain-http link', { footerButtons: [{ ...WHOLE, href: 'http://friend.example' }] }],
    ['a script link', { footerButtons: [{ ...WHOLE, href: 'javascript:alert(1)' }] }],
    ['a protocol-relative link', { footerButtons: [{ ...WHOLE, href: '//friend.example' }] }],
    ['an image URL (a hotlink)', { footerButtons: [{ ...WHOLE, image: 'https://friend.example/b.gif' }] }],
    ['a root-absolute image', { footerButtons: [{ ...WHOLE, image: '/buttons/friend.gif' }] }],
    ['an image climbing out', { footerButtons: [{ ...WHOLE, image: 'buttons/../secret.gif' }] }],
    ['an image that is not a picture', { footerButtons: [{ ...WHOLE, image: 'buttons/friend.svg' }] }],
    ['a size as a string', { footerButtons: [{ ...WHOLE, width: '88' }] }],
    ['no height', { footerButtons: [{ ...WHOLE, height: 0 }] }],
    ['taller than an 88x31', { footerButtons: [{ ...WHOLE, height: 32 }] }],
    ['wider than 240', { footerButtons: [{ ...WHOLE, width: 241 }] }],
    ['emissive as a word', { footerButtons: [{ ...WHOLE, emissive: 'yes' }] }],
  ])('drops %s', (_, config) => {
    expect(footerButtonList(config)).toEqual([]);
  });

  it('drops the broken entry and keeps the whole one beside it', () => {
    expect(footerButtonList({ footerButtons: [{ ...WHOLE, image: '' }, WHOLE] })).toEqual([WHOLE]);
  });
});

describe('the markup', () => {
  it('puts the image on the site\'s own CDN', () => {
    const html = _footerChipsHtml({ ...only(WHOLE), cdnBase: 'https://cdn.example.com/' });
    expect(html).toContain('src="https://cdn.example.com/buttons/friend.gif"');
    expect(html).toContain('href="https://friend.example"');
    expect(html).toContain('width="88" height="31"');
  });

  it('falls back to the Worker\'s own CDN route on a site with no cdnBase', () => {
    expect(_footerChipsHtml(only(WHOLE), 'https://site.example'))
      .toContain('src="https://site.example/api/cdn/buttons/friend.gif"');
  });

  it('escapes the owner\'s words', () => {
    const html = _footerChipsHtml(only({ ...WHOLE, alt: 'Tom & "Jerry"' }));
    expect(html).toContain('alt="Tom &amp; &quot;Jerry&quot;"');
    expect(html).not.toContain('"Jerry"');
  });

  it('comes ahead of the chips, so the platform\'s two keep the edge', () => {
    const html = _footerChipsHtml({ footerButtons: [WHOLE], webring: { node: 7, slug: 'your-slug' } });
    const at = (s) => html.indexOf(s);
    expect(at('footer-button')).toBeGreaterThanOrEqual(0);
    expect(at('footer-button')).toBeLessThan(at('>OS<'));
    expect(at('>OS<')).toBeLessThan(at('ANALOGS'));
  });

  it('sits level with the chips without growing the footer (top, not middle)', () => {
    expect(_footerChipsHtml(only(WHOLE))).toContain('vertical-align:top');
  });

  it('blends an emissive button into the footer\'s ground, and only an emissive one', () => {
    expect(_footerChipsHtml(only({ ...WHOLE, emissive: true }))).toContain('mix-blend-mode:difference');
    expect(_footerChipsHtml(only(WHOLE))).not.toContain('mix-blend-mode');
    expect(_footerChipsHtml(only({ ...WHOLE, emissive: false }))).not.toContain('mix-blend-mode');
  });

  it('adds nothing when there are none', () => {
    expect(_footerChipsHtml({ poweredBy: false })).toBe('');
    expect(_footerChipsHtml({ poweredBy: false, footerButtons: [] })).toBe('');
  });
});

describe('what it costs the rest of the site: nothing', () => {
  it('widens no CSP directive', () => {
    const img = buildCsp('https://site.example', true).split(';').map((d) => d.trim()).find((d) => d.startsWith('img-src'));
    expect(img).not.toContain('friend.example');
    expect(img.split(/\s+/).slice(1).sort()).toEqual(["'self'", 'blob:', 'data:', 'https://cdn.example.com'].sort());
  });

  it('travels with the Site-in-a-ZIP: the export reads its image as a CDN key to mirror', () => {
    const src = _footerChipsHtml(only(WHOLE), '').match(/src="([^"]+)"/)[1];
    // with no cdnBase in the passed config the src is the Worker route; with the site's, the CDN
    const cdnSrc = _footerChipsHtml({ ...only(WHOLE), cdnBase: 'https://cdn.example.com' }).match(/src="([^"]+)"/)[1];
    expect(src).toBe('/api/cdn/buttons/friend.gif');
    expect(mapReference(cdnSrc, { cdnBases: ['https://cdn.example.com'], prefix: '' }))
      .toEqual({ out: 'cdn/buttons/friend.gif', cdnKey: 'buttons/friend.gif' });
  });

  it('is none at all on a fork: the example config lists no buttons', () => {
    expect(footerButtonList(resolveConfig(example))).toEqual([]);
  });
});
