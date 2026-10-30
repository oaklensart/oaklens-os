// @vitest-environment happy-dom
// The `live` text layout (js/recent-index.js textLiveCard, manual §5.32): a
// note's interactive block drifting in its homepage card under the title.
// Three doors must all be open before a card wears it — the instance switched
// live cards on, the note carries a block naming a same-origin module, and the
// note (or its card) asked for `live`. Any one shut is the words tile.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BLOCK = '<div class="fn-interactive" data-module="/embeds/x/lattice.js?v=3"></div>';
const POST = {
  fn_id: 'fn-020', title: 'A Note That Moves', location: 'Sample City',
  body: `${BLOCK}\n\nThe words of the note.`, added_at: '2026-10-24T00:00:00Z',
  card: { layout: 'live' },
};

const cdn = document.createElement('meta');
cdn.setAttribute('name', 'cdn-base');
cdn.setAttribute('content', 'https://cdn.example/api/cdn');
document.head.appendChild(cdn);

let flag = null;
function liveCards(on) {
  if (!flag) {
    flag = document.createElement('meta');
    flag.setAttribute('name', 'site-live-cards');
    document.head.appendChild(flag);
  }
  flag.setAttribute('content', on ? 'on' : 'off');
}

let RI;
beforeAll(async () => {
  await import('../js/recent-index.js');
  RI = globalThis.RecentIndex;
});
afterEach(() => liveCards(false));

describe('the live layout gate', () => {
  it('is the words tile while the instance has live cards off (the engine default)', () => {
    liveCards(false);
    expect(RI.layoutFor('text', POST)).toBe('default');
    const node = RI.buildCard({ kind: 'text', data: POST });
    expect(node.hasAttribute('data-layout')).toBe(false);
    expect(node.querySelector('.wk-live')).toBeNull();
  });

  it('is the words tile when the note carries no interactive block', () => {
    liveCards(true);
    expect(RI.layoutFor('text', { ...POST, body: 'Just words.' })).toBe('default');
  });

  it('is opt-in: a note with a block that did not ask stays the words tile', () => {
    liveCards(true);
    const { card, ...plain } = POST;
    expect(RI.layoutFor('text', plain)).toBe('default');
  });

  it.each([
    'https://evil.example/x.js',
    '//evil.example/x.js',
    '/embeds/../src/x.js',
    '/embeds/x.json',
  ])('refuses a block naming %s', (src) => {
    liveCards(true);
    const body = `<div class="fn-interactive" data-module="${src}"></div>`;
    expect(RI.layoutFor('text', { ...POST, body })).toBe('default');
  });

  it('wears live when all three hold', () => {
    liveCards(true);
    expect(RI.layoutFor('text', POST)).toBe('live');
  });
});

describe('the live card', () => {
  it('is one link: the title on top, the stage under it, nothing else to press', () => {
    liveCards(true);
    const node = RI.buildCard({ kind: 'text', data: POST });
    expect(node.tagName).toBe('A');
    expect(node.getAttribute('href')).toBe('/field-notes/post?slug=fn-020');
    expect(node.getAttribute('data-layout')).toBe('live');
    expect(node.querySelector('.wk-t-title').textContent).toBe('A Note That Moves');
    const stage = node.querySelector('.wk-live');
    expect(stage).toBeTruthy();
    expect(stage.getAttribute('aria-hidden')).toBe('true');
    // the title comes before the stage, and the tease is gone: the block IS the body
    expect(node.querySelector('.wk-t-title').compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(node.querySelector('.wk-snip')).toBeNull();
    expect(node.querySelectorAll('a, button')).toHaveLength(0);
  });

  it('never takes a pointer, so a tap on the drawing still opens the note', () => {
    const css = readFileSync(join(ROOT, 'css/main.css'), 'utf8');
    const rule = css.match(/\.wk-text\[data-layout="live"\] \.wk-live \{([^}]*)\}/)[1];
    expect(rule).toMatch(/pointer-events:\s*none/);
  });

  it('bleeds to both edges, centred: negative margins with an automatic width', () => {
    // width: 100% plus margin: 0 -16px slid the stage 16px left of the card's
    // centre (owner report, 2026-10-24) — the bleed needs width: auto.
    const css = readFileSync(join(ROOT, 'css/main.css'), 'utf8');
    const rule = css.match(/\.wk-text\[data-layout="live"\] \.wk-live \{([^}]*)\}/)[1];
    expect(rule).toMatch(/width:\s*auto/);
    expect(rule).toMatch(/margin:\s*0 -16px/);
  });
});

describe('one rule for which modules a note may name', () => {
  it('the card engine and the post page use the same pattern', () => {
    const engine = readFileSync(join(ROOT, 'js/recent-index.js'), 'utf8')
      .match(/var LIVE_MODULE_RE = (\/.*\/);/)[1];
    const post = readFileSync(join(ROOT, 'js/page-fn-post.js'), 'utf8')
      .match(/return typeof src === 'string' && (\/.*\/)\.test\(src\)/)[1];
    expect(engine).toBe(post);
    // the FN list's live thumbnail (js/page-fn-list.js) is the third reader
    const list = readFileSync(join(ROOT, 'js/page-fn-list.js'), 'utf8')
      .match(/const LIVE_MODULE_RE = (\/.*\/);/)[1];
    expect(list).toBe(engine);
  });

  it('the FN list only swaps "// NO HERO" for a block behind the same switch, never over a hero', () => {
    const list = readFileSync(join(ROOT, 'js/page-fn-list.js'), 'utf8');
    expect(list).toMatch(/const liveSrc = !post\.hero && liveCardsOn\(\) \? interactiveModule\(post\) : '';/);
    expect(list).toContain("m.default(entry.querySelector('.fn-live-stage'), { ambient: true })");
    const html = readFileSync(join(ROOT, 'field-notes/index.html'), 'utf8');
    const rule = html.match(/\.fn-entry-thumb \.fn-live-stage \{([^}]*)\}/)[1];
    expect(rule).toMatch(/pointer-events:\s*none/);
    // two classes, so it outranks the block's own `.shl { position: relative }`
    expect(rule).toMatch(/position:\s*absolute/);
  });

  it('the engine ships with live cards off', () => {
    const config = readFileSync(join(ROOT, 'src/shared/config.js'), 'utf8');
    expect(config).toMatch(/\n\s*liveCards: false,/);
    const site = readFileSync(join(ROOT, 'src/shared/site.js'), 'utf8');
    expect(site).toContain('<meta name="site-live-cards" content="${siteConfig.liveCards === true ? \'on\' : \'off\'}">');
  });
});
