// @vitest-environment happy-dom
//
// /listen's Subscribe block — the human half of feed discovery.
//
// The feed is the entire point of marking a track as an EPISODE, and until this
// nothing on the site pointed at it: you had to already know the address to
// find the address.
//
// Two gates here, and they are deliberately different from each other:
//
//  · This block is DATA-driven — a site earns it by actually having an episode.
//    Its mirror, the crawler-facing <link rel="alternate">, is CONFIG-driven,
//    because it is injected at the edge inside a synchronous HTMLRewriter
//    handler that cannot read data/audio.json. Same truth, two gates, and the
//    reason for each is why neither can be "simplified" into the other.
//  · Public pages run a STRICT CSP: no inline <script>, no onclick=. A handler
//    wired the wrong way does not throw here — it silently does nothing in the
//    browser, which is exactly the failure a test has to catch instead.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PAGE = readFileSync(join(ROOT, 'listen', 'index.html'), 'utf8');
const SRC = readFileSync(join(ROOT, 'js', 'page-listen.js'), 'utf8');

const TRACKS = [
  { slug: 'ep-001', filename: 'ep-001.mp3', title: 'One', added_at: '2026-08-12', episode: true },
  { slug: 'demo', filename: 'demo.mp3', title: 'Demo', added_at: '2026-08-05' },
];

const copied = [];
globalThis.AudioPlayer = {
  durationLabel: () => '',
  peaksFromString: () => [],
  audioSrc: (f) => `/audio/${f}`,
  create: () => ({ root: document.createElement('div') }),
  share: () => {},
  copy: (url) => copied.push(url),
};

let _tracks = TRACKS;
globalThis.fetch = async () => new Response(JSON.stringify(_tracks), { status: 200 });

document.body.innerHTML = '<main class="listen-wrap" id="listen"></main>';
await import('../js/page-listen.js');
const { hasEpisodes } = globalThis.PageListen;

// The script is a classic IIFE that renders as soon as it evaluates and
// exposes no render(). Re-evaluating the module is therefore how a case gets a
// fresh render — which is also closer to what the browser does than poking at
// internals would be.
async function renderWith(tracks) {
  _tracks = tracks;
  document.body.innerHTML = '<main class="listen-wrap" id="listen"></main>';
  vi.resetModules();
  await import('../js/page-listen.js');
  await new Promise((r) => setTimeout(r, 0));   // one turn for the fetch chain
  return document.getElementById('listen');
}

beforeEach(() => { copied.length = 0; });

describe('hasEpisodes — the gate', () => {
  it('is true only for a track that is an episode AND playable', () => {
    expect(hasEpisodes(TRACKS)).toBe(true);
    expect(hasEpisodes([{ slug: 'x', filename: 'x.mp3' }])).toBe(false);
    // Marked an episode but with no file: it is not in the feed either, since
    // handlePodcastFeed filters on the same three fields.
    expect(hasEpisodes([{ slug: 'x', episode: true }])).toBe(false);
    expect(hasEpisodes(null)).toBe(false);
  });
});

describe('the Subscribe block', () => {
  it('appears when the site has an episode', async () => {
    const host = await renderWith(TRACKS);
    expect(host.querySelector('.lt-subscribe')).not.toBeNull();
    expect(host.textContent).toContain('Subscribe');
  });

  it('does not appear on a site with tracks but no episodes', async () => {
    // A musician posting demos has no show, and should not be told to
    // subscribe to one.
    const host = await renderWith([TRACKS[1]]);
    expect(host.querySelector('.lt-subscribe')).toBeNull();
  });

  it('shows the address as readable text, not only on the clipboard', async () => {
    // A clipboard write can be refused; a URL you can see is a URL you can
    // retype.
    const host = await renderWith(TRACKS);
    const link = host.querySelector('.lt-sub-url');
    expect(link.textContent).toContain('/podcast.xml');
    expect(link.getAttribute('href')).toBe('/podcast.xml');
  });

  it('copies the absolute feed address, not the relative path', async () => {
    // A relative path pasted into a podcast app is not an address.
    const host = await renderWith(TRACKS);
    host.querySelector('button.lt-action').dispatchEvent(new Event('click'));
    expect(copied).toEqual([location.origin + '/podcast.xml']);
  });

  it('appears on a single-track permalink too', async () => {
    // Someone reading one episode is exactly who wants the feed.
    const host = await renderWith(TRACKS);
    expect(host.querySelector('.lt-subscribe')).not.toBeNull();
  });
});

describe('the strict CSP holds', () => {
  it('wires the copy button with addEventListener and no inline handler', async () => {
    // Asserted on the RENDERED element rather than on the source, so a comment
    // mentioning onclick cannot pass for the real thing in either direction.
    const host = await renderWith(TRACKS);
    const btn = host.querySelector('.lt-subscribe button.lt-action');
    expect(btn.getAttribute('onclick')).toBe(null);
    expect(SRC).toContain('addEventListener');
    // It has to actually be wired, or the button is decoration.
    btn.dispatchEvent(new Event('click'));
    expect(copied.length).toBe(1);
  });

  it('adds no inline <script> to the page', () => {
    // The one pre-paint <head> block is allowed by a sha256 hash in
    // src/shared/csp.js; a second one would be blocked outright.
    const inline = [...PAGE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
    expect(inline.length).toBe(1);
  });
});

describe('the Subscribe styles describe the markup', () => {
  // Same defect class as the Audio shelf's stylesheet drift
  // (tests/audio-shelf-css.test.js): CSS that looks authored and silently does
  // nothing. Only opening the page catches it, and nobody opens every page.
  it('every lt-sub* class the script emits has a rule on the page', () => {
    const emitted = [...new Set(
      [...SRC.matchAll(/el\('[a-z]+', '(lt-sub[a-z-]*|lt-subscribe)'\)/g)].map((m) => m[1]),
    )];
    expect(emitted.length).toBeGreaterThan(3);
    const unstyled = emitted.filter((c) => !new RegExp(`\\.${c}(?![a-z-])`).test(PAGE));
    expect(unstyled, `emitted but unstyled:\n  .${unstyled.join('\n  .')}`).toEqual([]);
  });

  it('names no custom property the stylesheets never define', () => {
    const main = readFileSync(join(ROOT, 'css', 'main.css'), 'utf8');
    const block = PAGE.slice(PAGE.indexOf('.lt-subscribe'));
    const used = [...new Set([...block.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
    const undefinedTokens = used.filter((t) => !new RegExp(`${t}\\s*:`).test(main + PAGE));
    expect(undefinedTokens).toEqual([]);
  });
});
