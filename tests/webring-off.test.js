// The shipped fork default: no ring, no chip, no route.
//
// This is the file that proves the claim the feature rests on — a fork inherits
// no link into someone else's webring, and the attribution chip is genuinely
// removable. Paired with tests/webring-route.test.js, which turns both on.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  const config = { ...actual.default, poweredBy: false };
  delete config.webring;
  // and none of the owner's footer buttons, which share the hook (this
  // instance lists one; tests/footer-buttons.test.js turns them on)
  delete config.footerButtons;
  return { default: Object.freeze(config) };
});

const worker = (await import('../worker.js')).default;
const { _footerChipsHtml, injectFooterChips } = await import('../src/edge/chrome.js');
const { configuredNode, analogsToken } = await import('../src/shared/webring.js');

const ORIGIN = 'https://example.com';

describe('no webring configured', () => {
  it('404s the ownership claim', async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/.well-known/analogs.txt`), {}, { waitUntil() {} });
    expect(res.status).toBe(404);
  });

  it('does not cache the miss — joining is a config edit plus a redeploy', async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/.well-known/analogs.txt`), {}, { waitUntil() {} });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reads no seat from config', () => {
    expect(configuredNode()).toBeNull();
    expect(analogsToken()).toBeNull();
  });
});

describe('poweredBy: false with no ring', () => {
  it('produces no chip markup at all', () => {
    expect(_footerChipsHtml()).toBe('');
  });

  it('removes the placeholder rather than leaving an empty span in the footer', () => {
    // The three-state posture [data-support-note] already uses: fill and strip
    // the hook when there is content, remove the element outright when there
    // is not. A bare <span> trailing "WE OBSERVE. WE DO NOT CONSUME." would be
    // invisible but would still be a stray node in every fork's export.
    let handler;
    const rewriter = { on(sel, h) { if (sel === '[data-site-chips]') handler = h; } };
    injectFooterChips(rewriter);
    expect(handler).toBeDefined();

    const calls = [];
    handler.element({
      remove: () => calls.push('remove'),
      setInnerContent: () => calls.push('setInnerContent'),
      removeAttribute: () => calls.push('removeAttribute'),
    });
    expect(calls).toEqual(['remove']);
  });
});
