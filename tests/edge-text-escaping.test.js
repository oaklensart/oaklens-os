// The site chrome hands the runtime RAW text wherever it uses text mode.
//
// HTMLRewriter's setInnerContent(content) escapes `content` itself unless
// `{ html: true }` is passed. Escaping it first escapes it twice: a site named
// "Smith & Co" rendered as the literal text "Smith &amp; Co" on the homepage
// hero and About's Support button (maintenance review 2026-10-15, D4, proved in
// workerd). The other chrome tests use rewriter mocks that do not escape, so
// they could not see it. This one renders text the way workerd does and checks
// what a visitor reads.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: Object.freeze({
      ...actual.default,
      name: 'Smith & Co',
      tagline: 'Stills & <Sound> "live"',
      wordmark: { stem: 'SMITH & CO', accent: '' },
      location: { ...actual.default.location, name: 'A & B', region: '' },
    }),
  };
});

const { injectSiteChrome } = await import('../src/edge/chrome.js');

const escapeLikeWorkerd = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Collect handlers, then run each element handler once and record the markup
// the runtime would emit for its inner content.
function render(selector) {
  const handlers = [];
  injectSiteChrome({ on(sel, h) { handlers.push({ sel, h }); return this; } },
    new URL('https://example.com/'));
  const h = handlers.find((x) => x.sel === selector);
  let emitted = null;
  h.h.element({
    getAttribute: () => null, setAttribute() {}, removeAttribute() {}, remove() {},
    setInnerContent(content, opts) {
      emitted = opts && opts.html ? String(content) : escapeLikeWorkerd(content);
    },
  });
  return emitted;
}

describe('text-mode chrome reads as written', () => {
  it.each([
    ['[data-site-name]', 'Smith & Co'],
    ['[data-site-tagline]', 'Stills & <Sound> "live"'],
    ['[data-site-location]', 'A & B'],
  ])('%s shows the config value once-escaped', (selector, raw) => {
    const out = render(selector);
    expect(out).not.toContain('&amp;amp;');
    expect(decode(out)).toBe(raw);
  });

  it('the wordmark (html mode) is escaped exactly once too', () => {
    const out = render('[data-site-wordmark]');
    expect(out).toBe('SMITH &amp; CO');
  });
});
