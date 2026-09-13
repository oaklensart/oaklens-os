// @vitest-environment happy-dom
//
// The card painter — js/console/card-paint.js, chunk 7 of
// docs/cards-core-complete.md.
//
// THE POINT OF THIS FILE IS THE PARITY DESCRIBE. The painter is a second
// renderer: it draws, with shapes on a canvas, the card that buildCard draws
// with elements in a document. Two renderers drift — that is not a risk, it is
// what happened to the OG card for a year, which is why a link preview stopped
// looking like anything on the site.
//
// The discipline that makes the second one honest: every value it paints comes
// from RecentIndex.cardComposition(item), and this file asserts, kind by kind
// and layout by layout, that the composition equals what buildCard ACTUALLY
// RENDERS — read back out of the DOM, not out of the record. Pixels are not
// asserted; composition is. So a renderer that moves without the composition
// moving turns this red, and the painter can never quietly be a third design.
//
// The rest of the file pins the arithmetic: the three ratio geometries, the R2
// key stems, the cover crop (against focal.js's own, so the share image cannot
// frame a photograph differently from the card), and the text fitters.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SHARE_RATIOS, CARD_WELL, CARD_FOOT, CARD_H,
  shareStem, shareKey, shareGeometry, cardAspect, coverRect, focusPct, titleIsUppercased,
  fitLine, wrapLines, peakValues, readCardTokens, probeCardTokens, FALLBACK_TOKENS, TYPE,
  drawCardFace, paintCard,
} from '../js/console/card-paint.js';
import { _coverRect } from '../js/console/focal.js';

// js/console/assets.js reads the site's identity from edge-injected meta tags
// at MODULE SCOPE, so these have to exist before the import graph is evaluated.
// A wordmark no one could have hardcoded is the whole point of the test below.
vi.hoisted(() => {
  const add = (name, content) => {
    const m = document.createElement('meta');
    m.setAttribute('name', name);
    m.setAttribute('content', content);
    document.head.appendChild(m);
  };
  add('site-wordmark', 'ZZTESTMARK');
  add('site-wordmark-accent', 'MARK');
  add('site-name', 'ZZ Test');
});

const ROOT = join(import.meta.dirname, '..');

/** A module's source with its whole-line comments stripped — the barrel test's
 *  own technique. Prose may name the console; only code may not name a site. */
const codeOf = (rel) => readFileSync(join(ROOT, rel), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Deterministic CDN base — the engine reads this meta before falling back to
// location.origin (tests/card-engine.test.js does the same).
const meta = document.createElement('meta');
meta.setAttribute('name', 'cdn-base');
meta.setAttribute('content', 'https://cdn.example/api/cdn');
document.head.appendChild(meta);

const ARCHIVE = {
  slug: 'evening-light', filename: 'SAMPLE_Evening.webp', title: 'Evening Light',
  location: 'Sample City, 2025', camera: 'Mirrorless', added_at: '2026-09-01T00:00:00Z',
  focus: '40% 60%',
};
const RAW = {
  id: 'abc1234', filename: 'SAMPLE_Raw.webp', captured_at: '2026-09-02T10:00:00Z',
  num: 641, cardFocus: '0% 76%',
};
const POST = {
  fn_id: 'fn-012', title: 'On Walking', location: 'Sample City',
  body: 'The first walk with a new camera is never about the pictures — it is about learning to see again.',
  added_at: '2026-09-03T00:00:00Z',
};
const HERO_POST = {
  ...POST, fn_id: 'fn-014', title: 'The Long Way Round',
  hero: 'SAMPLE_Hero.webp', focus: '30% 70%', card: { layout: 'hero' },
};
const TRACK = {
  slug: 'field-hum', filename: 'field-hum.mp3', title: 'Field Hum', sub: 'ambient sketch',
  duration: 94, peaks: '12,40,80,30,60', added_at: '2026-09-04T00:00:00Z',
};
const PULSE = {
  state: 'ember', text: 'Printing the last of the dusk rolls.', glyphs: '🌆',
  localTime: '21:14', footLeft: 'studio', footRight: 'late',
};

globalThis.fetch = async () => new Response('null', {
  status: 200, headers: { 'content-type': 'application/json' },
});

let RI;
beforeAll(async () => {
  await import('../js/recent-index.js');
  RI = globalThis.RecentIndex;
});

// ---------------------------------------------------------------- the parity

/** What the rendered card actually says, read back out of the DOM. */
function renderedFacts(node) {
  const txt = (sel) => {
    const el = node.querySelector(sel);
    return el ? el.textContent : null;
  };
  const attr = (name) => (node.hasAttribute(name) ? node.getAttribute(name) : '');
  const img = node.querySelector('.wk-img');
  return {
    layout: attr('data-layout') || 'default',
    shape: attr('data-shape'),
    palette: attr('data-state'),
    href: node.getAttribute('href') || '',
    tier: attr('data-tier'),
    tag: txt('.wk-tag'),
    kicker: txt('.wk-kicker'),
    title: txt('.wk-title'),
    tTitle: txt('.wk-t-title'),
    aTitle: txt('.wk-a-title'),
    meta: txt('.wk-meta'),
    tMeta: txt('.wk-t-meta'),
    snip: txt('.wk-snip'),
    dropcap: txt('.wk-dropcap'),
    bg: img ? img.style.backgroundImage : '',
    bgPos: img ? img.style.backgroundPosition : '',
    place: attr('data-place'),
    treat: attr('data-treat'),
    blur: attr('data-blur'),
    ink: attr('data-ink'),
    scale: attr('data-scale'),
    mark: attr('data-mark'),
  };
}

describe('parity — the composition is what buildCard renders', () => {
  const cases = [
    ['photo · archive · default', { kind: 'photo', data: ARCHIVE, d: ARCHIVE.added_at }],
    ['photo · RAW · default', { kind: 'photo', data: RAW, raw: true, d: RAW.captured_at }],
    ['photo · overlay · scrim bottom', {
      kind: 'photo', data: ARCHIVE, d: ARCHIVE.added_at,
      over: { id: 'c-1', media: ARCHIVE.filename, title: 'Typed title', tease: 'Typed caption',
        card: { layout: 'overlay' }, overlay: { place: 'bottom', treat: 'scrim' } },
    }],
    ['photo · overlay · blur top, dark ink', {
      kind: 'photo', data: ARCHIVE, d: ARCHIVE.added_at,
      over: { id: 'c-2', media: ARCHIVE.filename, title: 'Bright', label: 'Notice',
        card: { layout: 'overlay' }, overlay: { place: 'top', treat: 'blur', blur: 3 },
        img: { lum: { top: 0.9, mid: 0.5, bottom: 0.2 } } },
    }],
    ['photo · overlay · none, centre', {
      kind: 'photo', data: ARCHIVE, d: ARCHIVE.added_at,
      over: { id: 'c-3', media: ARCHIVE.filename, title: 'Middle', palette: 'ember',
        card: { layout: 'overlay' }, overlay: { place: 'centre', treat: 'none' } },
    }],
    ['text · words tile · default', { kind: 'text', data: POST, d: POST.added_at }],
    ['text · hero', { kind: 'text', data: HERO_POST, d: HERO_POST.added_at }],
    ['text · overlay', {
      kind: 'text', data: HERO_POST, d: HERO_POST.added_at,
      over: { id: 'c-4', title: 'On the way', card: { layout: 'overlay' } },
    }],
    ['text · composed words', {
      kind: 'text', data: {}, d: '2026-09-05',
      over: { id: 'c-5', title: 'A card', tease: 'Some words typed into the studio.', link: '/archive/' },
    }],
    ['audio · single track', { kind: 'audio', data: TRACK, d: TRACK.added_at }],
    ['audio · playlist with a caption', {
      kind: 'audio', d: '2026-09-06',
      data: { isPlaylist: true, tracks: [TRACK, { ...TRACK, slug: 't-2', title: 'Second' }] },
      over: { id: 'c-6', title: 'Late summer', tease: 'Two of them.' },
      set: { slug: 'late-summer', name: 'Late summer mix' },
    }],
    ['pulse', { kind: 'pulse', data: PULSE, d: '2026-09-07' }],
  ];

  for (const [name, item] of cases) {
    it(`${name} — every painted value comes off the real card`, () => {
      const comp = RI.cardComposition(item);
      const node = RI.buildCard(item);
      const dom = renderedFacts(node);

      expect(comp.layout, 'layout').toBe(dom.layout);
      if (item.kind !== 'pulse') expect(comp.shape, 'shape').toBe(dom.shape || comp.shape);
      expect(comp.palette, 'palette').toBe(dom.palette || '');

      if (comp.shape === 'picture') {
        expect(dom.bg, 'the picture the card paints').toContain(comp.media.src);
        expect(dom.bgPos || '', 'the crop').toBe(comp.media.focus);
        expect(dom.tag, 'the on-media chip').toBe(comp.label);
        expect(dom.title ?? dom.tTitle, 'the headline').toBe(comp.title);
        expect(dom.meta, 'the caption line').toBe(comp.meta);
        expect(node.getAttribute('href') || '', 'where it goes').toBe(comp.href);
        if (comp.overlay) {
          expect(dom.place).toBe(comp.overlay.place);
          expect(dom.treat).toBe(comp.overlay.treat);
          expect(dom.ink).toBe(comp.overlay.ink);
          // data-blur is stamped only under the blur treatment — an attribute
          // nothing reads is a value somebody will later believe in.
          expect(dom.blur).toBe(comp.overlay.treat === 'blur' ? String(comp.overlay.blur) : '');
          // The plate's two decisions ride the composition too, off the same
          // headline — or the painter sets a size the card never wore.
          expect(dom.scale, 'the title scale').toBe(comp.overlay.scale);
          expect(dom.mark, 'the accent mark').toBe(comp.overlay.mark || '');
        } else {
          expect(dom.place, 'no band, no band attributes').toBe('');
        }
      } else if (comp.shape === 'words') {
        expect(dom.kicker, 'the kicker word').toBe(comp.label);
        expect(dom.tTitle, 'the headline').toBe(comp.title);
        expect(dom.snip, 'the tease, after the ladder cut it').toBe(comp.words);
        expect(dom.tier, 'the tier').toBe(comp.tier);
        expect(dom.dropcap ?? '', 'the drop cap').toBe(comp.initial);
        expect(dom.tMeta, 'the place-and-year line').toBe(comp.meta);
        expect(node.getAttribute('href') || '').toBe(comp.href);
      } else if (comp.shape === 'audio') {
        expect(dom.kicker, 'the kicker word').toBe(comp.label);
        expect(dom.aTitle ?? '', 'what is playing').toBe(comp.title);
        const link = node.querySelector('.wk-a-title a');
        if (link) expect(link.getAttribute('href'), 'and where that opens').toBe(comp.href);
        if (comp.tier) expect(dom.tier).toBe(comp.tier);
        if (comp.caption) {
          expect(node.querySelector('.wk-body .wk-title').textContent).toBe(comp.caption.title);
          expect(node.querySelector('.wk-body .wk-meta').textContent).toBe(comp.caption.tease);
        } else {
          expect(node.querySelector('.wk-body'), 'no words, no caption body').toBeNull();
        }
      } else {
        expect(dom.tier, 'the pulse tier').toBe(comp.tier);
        expect(node.querySelector('.wk-p-text').textContent).toBe(comp.pulse.text);
        expect(node.querySelector('.wk-p-glyph').textContent).toBe(comp.pulse.glyphs);
        expect(node.querySelector('.wk-p-time').textContent).toBe(comp.pulse.localTime);
      }
    });
  }

  it('a legacy record — no kind, the shipped console\'s shape — composes as it renders', () => {
    const legacy = { id: 'c-old', order: 1, layout: 'plain', title: 'Old card', tease: 'Written before chunk 1.' };
    const item = RI.composedItem(legacy, [], []);
    const comp = RI.cardComposition(item);
    const node = RI.buildCard(item);
    expect(comp.shape).toBe('words');
    expect(node.getAttribute('data-shape')).toBe('words');
    expect(node.querySelector('.wk-t-title').textContent).toBe(comp.title);
    expect(node.querySelector('.wk-snip').textContent).toBe(comp.words);
  });

  it('an unknown kind composes as the text renderer draws it', () => {
    // buildCard falls through to the text renderer for an unknown kind; the
    // composition has to make the same fallback or the painter draws a shape
    // the card never had.
    const item = { kind: 'nonesuch', data: POST, d: POST.added_at };
    expect(RI.cardComposition(item).kind).toBe('text');
    expect(RI.buildCard(item).classList.contains('wk-text')).toBe(true);
  });
});

// ---------------------------------------------------------------- the ratios

describe('geometry — three ratios, pinned', () => {
  it('the three output sizes are the ones §2.2 names', () => {
    expect(SHARE_RATIOS.og).toEqual({ w: 1200, h: 630 });
    expect(SHARE_RATIOS.native).toEqual({ w: 1080, h: 1350 });
    expect(SHARE_RATIOS.story).toEqual({ w: 1080, h: 1920 });
    expect(Object.keys(SHARE_RATIOS), 'no square unless the owner asks').toEqual(['og', 'native', 'story']);
  });

  it('the card face is a 4:5 well plus its footer', () => {
    expect(CARD_WELL).toBe(1.25);
    expect(CARD_H).toBeCloseTo(CARD_WELL + CARD_FOOT, 10);
  });

  for (const ratio of Object.keys(SHARE_RATIOS)) {
    it(`${ratio} — the card sits inside the ground at the card's own proportion`, () => {
      const g = shareGeometry(ratio);
      expect(g.W).toBe(SHARE_RATIOS[ratio].w);
      expect(g.H).toBe(SHARE_RATIOS[ratio].h);
      expect(g.card.x).toBeGreaterThanOrEqual(0);
      expect(g.card.y).toBeGreaterThanOrEqual(0);
      expect(g.card.x + g.card.w).toBeLessThanOrEqual(g.W);
      expect(g.card.y + g.card.h).toBeLessThanOrEqual(g.H);
      expect(g.card.h / g.card.w).toBeCloseTo(CARD_H, 1);
    });
  }

  it('og puts the words BESIDE the card, the other two do not', () => {
    const og = shareGeometry('og');
    expect(og.text).toBeTruthy();
    expect(og.text.x).toBeGreaterThan(og.card.x + og.card.w);
    expect(og.text.w).toBeGreaterThan(100);
    expect(shareGeometry('native').text).toBeNull();
    expect(shareGeometry('story').text).toBeNull();
  });

  it('story carries the wordmark below the card, native carries none', () => {
    const story = shareGeometry('story');
    expect(story.wordmark.y).toBeGreaterThan(story.card.y + story.card.h);
    expect(story.wordmark.align).toBe('center');
    expect(story.wordmark.y).toBeLessThan(story.H);
    expect(shareGeometry('native').wordmark).toBeNull();
  });

  it('an unknown ratio is null, never a guessed canvas', () => {
    expect(shareGeometry('square')).toBeNull();
    expect(shareGeometry('')).toBeNull();
  });

  // The layout decides the BOX, and it has to: an overlay card's words sit on
  // the picture and the card IS the 4:5 well, so painting it into the taller
  // default box would crop the photograph deeper than the homepage does. That
  // is the one thing this painter exists to prevent, and it shipped in the
  // first pass because both boxes looked like "a card".
  it('an overlay card is its picture well; every other card is well + footer', () => {
    const plain = RI.cardComposition({ kind: 'photo', data: ARCHIVE });
    const band = RI.cardComposition({
      kind: 'photo', data: ARCHIVE,
      over: { id: 'c-o', media: ARCHIVE.filename, card: { layout: 'overlay' } },
    });
    expect(cardAspect(plain)).toBe(CARD_H);
    expect(cardAspect(band)).toBe(CARD_WELL);
    expect(cardAspect(band), 'and that is exactly 4:5').toBeCloseTo(5 / 4, 10);
  });

  for (const ratio of Object.keys(SHARE_RATIOS)) {
    it(`${ratio} — an overlay card still fits its ground`, () => {
      const g = shareGeometry(ratio, CARD_WELL);
      expect(g.card.x).toBeGreaterThanOrEqual(0);
      expect(g.card.y).toBeGreaterThanOrEqual(0);
      expect(g.card.x + g.card.w).toBeLessThanOrEqual(g.W);
      expect(g.card.y + g.card.h).toBeLessThanOrEqual(g.H);
      expect(g.card.h / g.card.w).toBeCloseTo(CARD_WELL, 1);
      if (g.wordmark) expect(g.wordmark.y, 'and the wordmark is still on it').toBeLessThan(g.H);
    });
  }
});

// ------------------------------------------------------------------ the keys

describe('keys — one stem per namespace, three files each', () => {
  it('a frame keeps the historic key, so nothing already stamped re-stamps', () => {
    expect(shareStem({ kind: 'frame', id: 'SAMPLE_Evening' })).toBe('meta/SAMPLE_Evening');
    expect(shareKey('meta/SAMPLE_Evening', 'og')).toBe('meta/SAMPLE_Evening-og.webp');
  });

  it('the four new stems are prefixed by what they identify', () => {
    expect(shareStem({ kind: 'fn', id: 'fn-012' })).toBe('meta/fn-fn-012');
    expect(shareStem({ kind: 'audio', id: 'field-hum' })).toBe('meta/audio-field-hum');
    expect(shareStem({ kind: 'set', id: 'field-hum' })).toBe('meta/set-field-hum');
    expect(shareStem({ kind: 'card', id: 'c-abc' })).toBe('meta/card-c-abc');
  });

  it('a set and a track with the SAME slug cannot overwrite each other', () => {
    expect(shareStem({ kind: 'audio', id: 'dusk' })).not.toBe(shareStem({ kind: 'set', id: 'dusk' }));
  });

  it('the three ratios are three files off one stem', () => {
    const stem = shareStem({ kind: 'card', id: 'c-abc' });
    expect(shareKey(stem, 'og')).toBe('meta/card-c-abc-og.webp');
    expect(shareKey(stem, 'native')).toBe('meta/card-c-abc-native.webp');
    expect(shareKey(stem, 'story')).toBe('meta/card-c-abc-story.webp');
  });

  it('no id and no known kind produce no key, never a half-formed one', () => {
    expect(shareStem({ kind: 'card', id: '' })).toBe('');
    expect(shareStem({ kind: 'nonesuch', id: 'x' })).toBe('');
    expect(shareKey('', 'og')).toBe('');
    expect(shareKey('meta/x', 'square')).toBe('');
  });

  it('every stem the console writes is under a prefix /api/assets admits', () => {
    const src = readFileSync(join(ROOT, 'src/api/assets.js'), 'utf8');
    const prefixes = /const UPLOAD_KEY_PREFIXES = \[([^\]]*)\]/.exec(src)[1]
      .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    for (const kind of ['frame', 'fn', 'audio', 'set', 'card']) {
      const stem = shareStem({ kind, id: 'x' });
      expect(prefixes.some((p) => stem.startsWith(p)), `${kind} → ${stem}`).toBe(true);
    }
  });

  it('/api/og-cards still indexes every og stamp, new stems included', () => {
    // The handler's own regex, read from source rather than restated.
    const src = readFileSync(join(ROOT, 'src/api/assets.js'), 'utf8');
    const literal = /const m = (\/\^meta.*?\/)\.exec\(o\.key\)/.exec(src)[1];
    const re = new RegExp(literal.slice(1, -1));
    for (const kind of ['frame', 'fn', 'audio', 'set', 'card']) {
      expect(re.test(shareKey(shareStem({ kind, id: 'x' }), 'og')), kind).toBe(true);
    }
    // …and does NOT list the other two ratios as og cards.
    expect(re.test('meta/card-x-native.webp')).toBe(false);
    expect(re.test('meta/card-x-story.webp')).toBe(false);
  });
});

// ------------------------------------------------------------------ the crop

describe('the crop — the share image frames what the card frames', () => {
  it('coverRect answers exactly what focal.js\'s sampler answers', () => {
    const cases = [[4000, 3000, 0.8, 50, 50], [1200, 1600, 0.8, 0, 76], [900, 900, 1.91, 40, 60]];
    for (const [sw, sh, ar, fx, fy] of cases) {
      expect(coverRect(sw, sh, ar, fx, fy)).toEqual(_coverRect(sw, sh, ar, fx, fy));
    }
  });

  it('focusPct parses the one string format and clamps', () => {
    expect(focusPct('40% 60%')).toEqual({ x: 40, y: 60 });
    expect(focusPct('')).toEqual({ x: 50, y: 50 });
    expect(focusPct('-10% 400%')).toEqual({ x: 0, y: 100 });
  });
});

// ------------------------------------------------------------------- fitting

describe('text fitting', () => {
  // A stub whose glyphs are 10px wide, so widths are countable by hand.
  const ctx = { measureText: (s) => ({ width: s.length * 10 }) };

  it('fitLine leaves a line that fits alone', () => {
    expect(fitLine(ctx, 'SHORT', 100)).toBe('SHORT');
  });
  it('fitLine ellipsises rather than overflowing', () => {
    const out = fitLine(ctx, 'A MUCH LONGER LINE THAN FITS', 100);
    expect(out.endsWith('…')).toBe(true);
    expect(ctx.measureText(out).width).toBeLessThanOrEqual(100);
  });
  it('fitLine on nothing is nothing', () => {
    expect(fitLine(ctx, '', 100)).toBe('');
    expect(fitLine(ctx, null, 100)).toBe('');
  });
  it('wrapLines breaks on words and never exceeds the cap', () => {
    const lines = wrapLines(ctx, 'one two three four five six seven', 100, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(ctx.measureText(l).width).toBeLessThanOrEqual(100);
  });
  it('a word longer than the line still gets a line', () => {
    expect(wrapLines(ctx, 'antidisestablishmentarianism', 50, 2).length).toBe(1);
  });

  // ---- the ellipsis means TRUNCATED, and nothing else ----
  //
  // It compared `lines.join(' ').length` to `text.trim().length` until a code
  // review: the lines are joined with exactly one space, so any run of
  // consecutive whitespace in the source made the two unequal even when every
  // word had fitted — and the card got an ellipsis it had not earned. The
  // check counts words now, because words are what the wrap places.
  it('does not ellipsise text that fits, however it is spaced', () => {
    for (const text of ['Evening  Light', 'Evening\tLight', 'Evening\nLight', '  Evening Light  ']) {
      const lines = wrapLines(ctx, text, 80, 2);
      expect(lines.join(' '), JSON.stringify(text)).toBe('Evening Light');
      expect(lines.some((l) => l.includes('…')), JSON.stringify(text)).toBe(false);
    }
  });

  it('still ellipsises when a word genuinely could not be placed', () => {
    const lines = wrapLines(ctx, 'one two three four five six seven eight', 60, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…'), 'the reader has to know there was more').toBe(true);
  });

  it('a single line that fits exactly is left alone', () => {
    expect(wrapLines(ctx, 'one two', 200, 2)).toEqual(['one two']);
  });
  it('wrapLines takes a per-line width, for the column a drop cap narrows', () => {
    // Lines the float displaces have a narrower measure than the ones below it.
    // Wrapping everything to the narrow width cost the tease about a quarter of
    // its measure on every line past the cap.
    const narrow = wrapLines(ctx, 'one two three four five six', 60, 4);
    const stepped = wrapLines(ctx, 'one two three four five six', (i) => (i < 1 ? 60 : 200), 4);
    expect(stepped.length, 'the wider lines below fit more').toBeLessThan(narrow.length);
    expect(stepped[0], 'and the first line still respects the cap').toBe(narrow[0]);
  });

  it('peakValues survives a waveform too long to spread onto the stack', () => {
    const huge = Array.from({ length: 200000 }, (_, i) => (i % 100) + 1).join(',');
    expect(() => peakValues([{ peaks: huge }])).not.toThrow();
    expect(peakValues([{ peaks: huge }]).length).toBe(200000);
  });

  it('peakValues normalises the registry string, and survives one without', () => {
    expect(peakValues([{ peaks: '10,20,40' }])).toEqual([0.25, 0.5, 1]);
    expect(peakValues([{ peaks: '' }])).toEqual([]);
    expect(peakValues([])).toEqual([]);
    expect(peakValues([{ peaks: 'not numbers' }])).toEqual([]);
  });
});

// ------------------------------------------------------------------ painting

/** A recording 2d context: every call kept, nothing drawn. */
function recorder() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const ctx = {
    calls,
    canvas: null,
    fillStyle: '', strokeStyle: '', font: '', letterSpacing: '', filter: '',
    textAlign: '', textBaseline: '', lineWidth: 0, globalAlpha: 1,
    measureText: (s) => ({ width: String(s).length * 9 }),
    createLinearGradient: (...args) => { calls.push(['createLinearGradient', ...args]); return { addColorStop: rec('addColorStop') }; },
    createRadialGradient: (...args) => { calls.push(['createRadialGradient', ...args]); return { addColorStop: rec('addColorStop') }; },
    save: rec('save'), restore: rec('restore'), clip: rec('clip'),
    beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arcTo: rec('arcTo'), arc: rec('arc'),
    drawImage: rec('drawImage'), stroke: rec('stroke'), strokeRect: rec('strokeRect'),
  };
  // The font is recorded as its own entry so a bounds check can replay each
  // fillText in the face it was actually drawn with.
  Object.defineProperty(ctx, 'font', {
    get() { return ctx._font || ''; },
    set(v) { ctx._font = v; calls.push(['setFont', v]); },
    configurable: true,
  });
  ctx.fill = (...a) => { calls.push(['fill', ctx.fillStyle, ...a]); };
  ctx.fillRect = (...a) => { calls.push(['fillRect', ctx.fillStyle, ...a]); };
  ctx.fillText = (...a) => { calls.push(['fillText', ctx.fillStyle, ...a]); };
  return ctx;
}

const fakeCanvas = () => {
  const ctx = recorder();
  const cv = { width: 0, height: 0, getContext: () => ctx, _ctx: ctx };
  ctx.canvas = cv;
  return cv;
};

const textOf = (ctx) => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => String(c[2]));

describe('paintCard — the ground, the card, the furniture', () => {
  const items = {
    photo: { kind: 'photo', data: ARCHIVE, d: ARCHIVE.added_at },
    text: { kind: 'text', data: POST, d: POST.added_at },
    audio: { kind: 'audio', data: TRACK, d: TRACK.added_at },
    pulse: { kind: 'pulse', data: PULSE, d: '2026-09-07' },
    overlay: {
      kind: 'photo', data: ARCHIVE, d: ARCHIVE.added_at,
      over: { id: 'c-9', media: ARCHIVE.filename, title: 'On the picture',
        card: { layout: 'overlay' }, overlay: { place: 'bottom', treat: 'blur', blur: 2 } },
    },
  };

  for (const [name, item] of Object.entries(items)) {
    for (const ratio of Object.keys(SHARE_RATIOS)) {
      it(`${name} × ${ratio} — the canvas is the ratio's own size`, async () => {
        const cv = fakeCanvas();
        // image: null — the painter must produce a card without its picture
        // rather than waiting on a network that a test does not have.
        await paintCard(item, ratio, { canvas: cv, image: null, tokens: FALLBACK_TOKENS });
        expect(cv.width).toBe(SHARE_RATIOS[ratio].w);
        expect(cv.height).toBe(SHARE_RATIOS[ratio].h);
        expect(cv._ctx.calls.length, 'it drew something').toBeGreaterThan(4);
      });
    }
  }

  it('the card\'s own words reach the canvas', async () => {
    const cv = fakeCanvas();
    await paintCard(items.text, 'native', { canvas: cv, image: null, tokens: FALLBACK_TOKENS });
    const painted = textOf(cv._ctx).join(' ');
    expect(painted).toContain('On Walking');
    expect(painted.toLowerCase()).toContain('first walk');
    expect(painted, 'the place-and-year line is uppercased, .wk-t-meta\'s own rule')
      .toContain('SAMPLE CITY');
  });

  it('a headline is cased the way the card cases it, kind by kind', async () => {
    // The words tile sets its headline in the DISPLAY face as authored
    // (.wk-t-title has no text-transform); the picture card's is a label and is
    // uppercased (.wk-title). The first pass of this painter uppercased both,
    // which no test could see and one look at the page could.
    const words = fakeCanvas();
    await paintCard(items.text, 'native', { canvas: words, image: null, tokens: FALLBACK_TOKENS });
    expect(textOf(words._ctx)).toContain('On Walking');

    const picture = fakeCanvas();
    await paintCard(items.photo, 'native', { canvas: picture, image: null, tokens: FALLBACK_TOKENS });
    expect(textOf(picture._ctx)).toContain('EVENING LIGHT');
  });

  it('the words tile draws every one of its four parts', () => {
    const ctx = recorder();
    drawCardFace(ctx, { x: 0, y: 0, w: 400, h: 620 },
      RI.cardComposition(items.text), FALLBACK_TOKENS, null);
    const faces = ctx.calls.filter((c) => c[0] === 'fillText').length;
    expect(faces, 'the kicker, the headline, the tease and the foot').toBeGreaterThan(3);
  });

  it('the wordmark comes from the site\'s own config, never a literal', async () => {
    // The wordmark meta is injected before this module is evaluated (the
    // vi.hoisted block at the top), so the constant the painter closes over is
    // a value no one could have hardcoded. A published image with either the
    // text OR the colour written in ships this instance's identity into every
    // fork's link previews — the bug the old painter was fixed for.
    const cv = fakeCanvas();
    await paintCard(items.photo, 'story', { canvas: cv, image: null, tokens: FALLBACK_TOKENS });
    const painted = textOf(cv._ctx).join(' ');
    expect(painted).toContain('ZZTEST');
    expect(painted).toContain('MARK');
    expect(/ZZTEST/.test(codeOf('js/console/card-paint.js')), 'a wordmark written into the painter').toBe(false);
  });

  it('the source file names no site\'s identity and no palette table', () => {
    const src = readFileSync(join(ROOT, 'js/console/card-paint.js'), 'utf8');
    // The header banner names the console, the way every module's does; what
    // must not appear is an identity in the CODE, where it would reach a
    // published image.
    const code = codeOf('js/console/card-paint.js');
    // Colour is derived, never enumerated (§4). The only hex in the file is the
    // neutral no-document fallback block at the top; past it, every colour is
    // either a token read from a mounted card or the band's own white/black
    // polarity, which is .wk-tag's precedent and not a palette.
    const body = src.slice(src.indexOf('// ============== TEXT'));
    expect(/#[0-9a-fA-F]{6}/.test(body), 'a hex outside FALLBACK_TOKENS').toBe(false);
    expect(/oaklens/i.test(code), 'an instance name in engine code').toBe(false);
  });

  it('an overlay card paints its band and a default one does not', async () => {
    const plain = fakeCanvas();
    await paintCard(items.photo, 'native', { canvas: plain, image: null, tokens: FALLBACK_TOKENS });
    const band = fakeCanvas();
    await paintCard(items.overlay, 'native', { canvas: band, image: null, tokens: FALLBACK_TOKENS });
    // The blur treatment paints a translucent veil; the default card paints an
    // opaque footer instead. The veil is the tell.
    const veil = (ctx) => ctx.calls.some((c) => c[0] === 'fillRect' && /rgba\(/.test(String(c[1])));
    expect(veil(band._ctx)).toBe(true);
    expect(veil(plain._ctx)).toBe(false);
  });

  // ---- THE ATMOSPHERE (2026-09-12) ----
  //
  // A palette card, an audio card and a pulse card share a ground in CSS: the
  // theme's surface, a veil, a directional wash, a corner light, all in the
  // card's hue. The painter draws the same four layers — and every colour in
  // them is a TOKEN READ OFF THE MOUNTED CARD, never a value the painter knows.
  // The first pass at this carried the five palette triplets in a table beside
  // the painter; the tests below are what make that a red suite rather than a
  // quiet second copy of main.css.
  const withPalette = (palette) => ({
    kind: 'text', data: POST, d: POST.added_at, over: { id: 'c-test', palette },
  });
  const stops = (ctx) => ctx.calls.filter((c) => c[0] === 'addColorStop').map((c) => String(c[2]));
  const fills = (ctx) => ctx.calls.filter((c) => c[0] === 'fillRect').map((c) => String(c[1]));

  it('a palette card paints the atmosphere in the hue the card computed, not a hue of its own', async () => {
    const tokens = { ...FALLBACK_TOKENS, pulseRgb: '7, 8, 9' };
    const cv = fakeCanvas();
    await paintCard(withPalette('velvet'), 'native', { canvas: cv, image: null, tokens });
    expect(cv._ctx.calls.some((c) => c[0] === 'createRadialGradient'), 'the corner light').toBe(true);
    expect(cv._ctx.calls.some((c) => c[0] === 'createLinearGradient'), 'the directional wash').toBe(true);
    const colours = stops(cv._ctx);
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.every((c) => c.includes('7, 8, 9')), `every stop wears --pulse-rgb: ${colours}`).toBe(true);
    // …and the LED beside the kicker takes the same hue.
    expect(cv._ctx.calls.some((c) => c[0] === 'fill' && c[1] === 'rgb(7, 8, 9)'), 'the kicker LED').toBe(true);
  });

  it('the veil is the theme\'s — a light theme paints a white veil, not a dark slab', async () => {
    const tokens = { ...FALLBACK_TOKENS, pulseRgb: '7, 8, 9', pulseVeil: 'rgba(255, 255, 255, 0.45)' };
    const cv = fakeCanvas();
    await paintCard(withPalette('dawn'), 'native', { canvas: cv, image: null, tokens });
    expect(fills(cv._ctx)).toContain('rgba(255, 255, 255, 0.45)');
    expect(fills(cv._ctx)).not.toContain('rgba(0, 0, 0, 0.55)');
  });

  it('a card with no palette is the plain surface — the bytes the old painter drew', async () => {
    const cv = fakeCanvas();
    await paintCard(items.text, 'native', { canvas: cv, image: null, tokens: FALLBACK_TOKENS });
    expect(cv._ctx.calls.some((c) => c[0] === 'createRadialGradient')).toBe(false);
    expect(fills(cv._ctx)).toContain(FALLBACK_TOKENS.surfaceAlt);
  });

  it('an audio card is the listening room, in --audio-rgb under --audio-veil', async () => {
    const tokens = { ...FALLBACK_TOKENS, audioRgb: '4, 5, 6', audioVeil: 'rgba(255, 255, 255, 0.5)' };
    const cv = fakeCanvas();
    await paintCard(items.audio, 'native', { canvas: cv, image: null, tokens });
    expect(cv._ctx.calls.some((c) => c[0] === 'createRadialGradient'), 'the corner light').toBe(true);
    expect(stops(cv._ctx).every((c) => c.includes('4, 5, 6'))).toBe(true);
    expect(fills(cv._ctx)).toContain('rgba(255, 255, 255, 0.5)');
  });

  it('a pulse always wears the atmosphere — its default IS the site\'s accent', async () => {
    const tokens = { ...FALLBACK_TOKENS, pulseRgb: '1, 2, 3' };
    const cv = fakeCanvas();
    await paintCard(items.pulse, 'native', { canvas: cv, image: null, tokens });
    expect(cv._ctx.calls.some((c) => c[0] === 'createRadialGradient')).toBe(true);
    expect(stops(cv._ctx).every((c) => c.includes('1, 2, 3'))).toBe(true);
  });

  it('the card\'s edge is the edge the card computed', async () => {
    const tokens = { ...FALLBACK_TOKENS, pulseRgb: '7, 8, 9', cardLine: 'rgba(7, 8, 9, 0.28)' };
    const cv = fakeCanvas();
    await paintCard(withPalette('ember'), 'native', { canvas: cv, image: null, tokens });
    const strokes = cv._ctx.calls.filter((c) => c[0] === 'strokeRect');
    expect(strokes.length).toBeGreaterThan(0);
    expect(cv._ctx.strokeStyle).toBe('rgba(7, 8, 9, 0.28)');
  });

  it('the LED housing comes from the theme too', async () => {
    const tokens = { ...FALLBACK_TOKENS, ledBezel: 'rgba(0, 0, 0, 0.28)', ledSpec: 'rgba(255, 255, 255, 0.75)' };
    const cv = fakeCanvas();
    await paintCard(items.text, 'native', { canvas: cv, image: null, tokens });
    expect(cv._ctx.calls.some((c) => c[0] === 'stroke')).toBe(true);
    expect(fills(cv._ctx)).toContain('rgba(255, 255, 255, 0.75)');
  });

  // The guard itself: the painter names no palette. The five hues are
  // css/main.css's, read off a mounted card; a triplet here is a second copy.
  it('enumerates no palette of its own', () => {
    const src = codeOf('js/console/card-paint.js');
    const css = readFileSync(join(ROOT, 'css/main.css'), 'utf8');
    const hues = [...css.matchAll(/--pulse-rgb:\s*(\d+,\s*\d+,\s*\d+)/g)].map((m) => m[1]);
    expect(hues.length, 'the palette lives in main.css').toBeGreaterThan(3);
    for (const h of hues) expect(src, `painter carries ${h}`).not.toContain(h);
    expect(src).not.toMatch(/PALETTE_RGB|paletteRgb\(/);
  });

  // The probe: buildCard's own element, mounted for one read, gone after.
  it('probes the card\'s tokens off a mounted card and leaves nothing behind', () => {
    const before = document.querySelectorAll('.wk-card').length;
    const tokens = probeCardTokens(withPalette('tide'));
    expect(document.querySelectorAll('.wk-card').length, 'the probe card is taken down').toBe(before);
    for (const k of ['pulseRgb', 'audioRgb', 'pulseVeil', 'audioVeil', 'ledBezel', 'ledSpec', 'cardLine']) {
      expect(tokens, `has ${k}`).toHaveProperty(k);
    }
    // A node the caller already has short-circuits the mount.
    const node = document.createElement('div');
    node.className = 'wk-card';
    document.body.appendChild(node);
    expect(probeCardTokens(withPalette('tide'), node)).toBeTruthy();
    node.remove();
  });

  it('waits for the card\'s faces before it draws with them', async () => {
    // ensureShareFonts' docstring said it was folded into the painter "so every
    // caller inherits it instead of remembering it" — and paintCard never
    // called it, so only FocalModal (which happened to call it itself) got
    // decoded faces. Chunk 8's share sheet would have stamped its first card in
    // a system fallback with nothing to say so.
    const asked = [];
    const realFonts = document.fonts;
    let release;
    const held = new Promise((r) => { release = r; });
    document.fonts = {
      load: (spec) => { asked.push(spec); return held; },
      ready: Promise.resolve(),
    };

    const cv = fakeCanvas();
    const painting = paintCard(items.text, 'native', { canvas: cv, image: null, tokens: FALLBACK_TOKENS });
    await Promise.resolve();
    expect(asked.length, 'it asked for the faces').toBeGreaterThan(0);
    expect(cv._ctx.calls, 'and drew nothing while they were still decoding').toHaveLength(0);

    release();
    await painting;
    expect(cv._ctx.calls.length, 'then it drew').toBeGreaterThan(4);
    document.fonts = realFonts;
  });

  it('a face that will not load is not a reason to refuse the image', async () => {
    const realFonts = document.fonts;
    document.fonts = { load: () => Promise.reject(new Error('no font')), ready: Promise.resolve() };
    const cv = fakeCanvas();
    await paintCard(items.photo, 'og', { canvas: cv, image: null, tokens: FALLBACK_TOKENS });
    expect(cv._ctx.calls.length).toBeGreaterThan(4);
    document.fonts = realFonts;
  });

  it('paintCard refuses an unknown ratio instead of guessing one', async () => {
    await expect(paintCard(items.photo, 'square', { canvas: fakeCanvas(), image: null }))
      .rejects.toThrow(/ratio/i);
  });

  // ---- THE DROP CAP'S COLUMN ----
  //
  // The cap steals width from every line it displaces, so the wrap has to run
  // against the narrower column — and the reserve has to BE the cap's width,
  // not an estimate of it. It was `size * 2.2` until a code review: a wide
  // initial (W, M, O in the display face at weight 720) measures nearer
  // `3 * size`, so the indented line was placed further right than the wrap had
  // allowed for and overhung the card's edge.
  //
  // The recorder used everywhere else in this file gives every glyph the same
  // width, which is exactly why it could not see this. This one measures the
  // way a real face does: proportional to the font size, and wide letters wide.
  function proportional() {
    const ctx = recorder();
    ctx.measureText = (str) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || 16);
      const em = [...String(str)].reduce(
        (n, ch) => n + (/[WMO@]/.test(ch) ? 1.05 : 0.55), 0);
      return { width: em * size };
    };
    return ctx;
  }

  it('a wide drop cap does not push its line off the card', () => {
    const ctx = proportional();
    const rect = { x: 40, y: 20, w: 520, h: 754 };
    const comp = RI.cardComposition({
      kind: 'text',
      data: {
        fn_id: 'fn-w', title: 'On Watching', location: 'Sample City',
        body: 'Watching the weather move over the western ridge, which is most of what a morning is for.',
      },
    });
    expect(comp.initial, 'this fixture exists for its wide initial').toBe('W');

    drawCardFace(ctx, rect, comp, FALLBACK_TOKENS, null);

    // Replay the fillText calls, measuring each in the font it was drawn with.
    let font = '';
    for (const call of ctx.calls) {
      if (call[0] === 'setFont') font = call[1];
      if (call[0] !== 'fillText') continue;
      const [, , text, x] = call;
      if (!String(text).trim()) continue;
      ctx.font = font;
      const right = x + ctx.measureText(text).width;
      expect(right, `"${text}" runs past the card`).toBeLessThanOrEqual(rect.x + rect.w + 1);
    }
  });

  it('drawCardFace stays inside the rect it is given', async () => {
    const ctx = recorder();
    const rect = { x: 100, y: 50, w: 400, h: 620 };
    drawCardFace(ctx, rect, RI.cardComposition(items.photo), FALLBACK_TOKENS, null);
    for (const call of ctx.calls.filter((c) => c[0] === 'fillRect')) {
      const [, , x, y, w, h] = call;
      expect(x).toBeGreaterThanOrEqual(rect.x - 1);
      expect(y).toBeGreaterThanOrEqual(rect.y - 1);
      expect(x + w).toBeLessThanOrEqual(rect.x + rect.w + 1);
      expect(y + h).toBeLessThanOrEqual(rect.y + rect.h + 1);
    }
  });
});

describe('tokens — read from a mounted card, never enumerated', () => {
  it('falls back to neutral greys with no document to read', () => {
    expect(readCardTokens(null).brand).toBe(FALLBACK_TOKENS.brand);
  });

  it('a DETACHED node falls through to the document, not to the greys', () => {
    // getComputedStyle on an element that is not in the document answers '' for
    // every custom property — silently. Before this, such a node painted a
    // whole card in the hardcoded fallbacks, which looked plausible in a dark
    // preset and wrong in every other one. Found by opening the page in
    // DAYLIGHT; no test could have seen it, because the greys ARE a palette.
    document.documentElement.style.setProperty('--surface', 'rgb(9, 9, 9)');
    document.documentElement.style.setProperty('--muted', 'rgb(8, 8, 8)');
    const orphan = document.createElement('div');   // never appended
    expect(readCardTokens(orphan).muted).toBe('rgb(8, 8, 8)');
    document.documentElement.style.removeProperty('--surface');
    document.documentElement.style.removeProperty('--muted');
  });

  it('--brand falls back to the site\'s accent, never to a literal red', () => {
    // --brand lives in css/field-console.css, so anywhere the painter runs
    // outside the console it is empty. A hardcoded red there would ship one
    // instance's colour into every fork's link previews — the exact bug the
    // old painter was fixed for, in new clothes.
    const host = document.createElement('div');
    host.style.setProperty('--accent', 'rgb(30, 63, 219)');
    document.body.appendChild(host);
    expect(readCardTokens(host).brand).toBe('rgb(30, 63, 219)');
    host.remove();
  });

  it('a mounted card\'s own variables win over the fallbacks', () => {
    const host = document.createElement('div');
    host.style.setProperty('--brand', 'rgb(3, 4, 5)');
    host.style.setProperty('--muted', 'rgb(6, 7, 8)');
    document.body.appendChild(host);
    const tokens = readCardTokens(host);
    expect(tokens.brand).toBe('rgb(3, 4, 5)');
    expect(tokens.muted).toBe('rgb(6, 7, 8)');
    host.remove();
  });
});

// ------------------------------------------------------------- the type scale

describe('TYPE — derived from css/main.css, not invented', () => {
  // THE POINT: every size the painter uses is a rem value out of the stylesheet
  // divided by a 340px reference card. Written down once and never checked, that
  // derivation rots the first time someone resizes a headline in CSS — the
  // painter keeps drawing the old card and nothing goes red. So it is checked.
  const css = readFileSync(join(ROOT, 'css/main.css'), 'utf8');
  const REF = 340;

  /** The font-size, in rem, of the first rule matching `selector`. */
  function remOf(selector) {
    const i = css.indexOf(`${selector} {`);
    expect(i, `${selector} is gone from css/main.css`).toBeGreaterThan(-1);
    const body = css.slice(i, css.indexOf('}', i));
    const m = /font-size:\s*([\d.]+)rem/.exec(body);
    expect(m, `${selector} no longer sets a rem font-size`).toBeTruthy();
    return Number(m[1]);
  }

  const cases = [
    ['.wk-kicker', 'kicker', (t) => t.kicker],
    ['.wk-t-title', 'tTitle', (t) => t.tTitle],
    ['.wk-snip', 'snip.standard', (t) => t.snip.standard],
    ['.wk-t-meta', 'tMeta', (t) => t.tMeta],
    ['.wk-title', 'title', (t) => t.title],
    ['.wk-meta', 'meta', (t) => t.meta],
    ['.wk-tag', 'tag', (t) => t.tag],
  ];

  for (const [selector, name, get] of cases) {
    it(`${name} is ${selector}'s own size`, () => {
      expect(get(TYPE) * REF / 16).toBeCloseTo(remOf(selector), 2);
    });
  }

  it('the feature tier steps up from standard exactly as the ladder does', () => {
    const i = css.indexOf('.wk-text[data-tier="feature"] .wk-snip {');
    const rem = Number(/font-size:\s*([\d.]+)rem/.exec(css.slice(i, css.indexOf('}', i)))[1]);
    expect(TYPE.snip.feature * REF / 16).toBeCloseTo(rem, 2);
  });

  it('statement is the biggest and carries no drop cap', () => {
    // Its CSS size is a clamp() and cannot be read as one number, so the ladder
    // is asserted by ORDER instead — which is the property that matters.
    expect(TYPE.snip.statement).toBeGreaterThan(TYPE.snip.feature);
    expect(TYPE.snip.feature).toBeGreaterThan(TYPE.snip.standard);
    const statement = RI.cardComposition({ kind: 'text', data: { fn_id: 'x', title: 'T', body: 'Short.' } });
    expect(statement.tier).toBe('statement');
    expect(statement.initial, 'the engine already answered this').toBe('');
  });

  // ---- casing is the STYLESHEET's call, not the painter's ----
  //
  // A picture card's headline is a label and lands in .wk-title, which CSS
  // uppercases. A note leading with its hero puts the same line in .wk-t-title,
  // which is prose and carries no text-transform — so the painter shouting
  // "ON WALKING" where the site says "On Walking" is a second opinion about
  // somebody else's stylesheet. The parity describe above could not catch it:
  // casing is applied at PAINT time, and the composition holds the title as
  // authored. So both halves are read here — which class the real card used,
  // and what the real stylesheet does to it.
  describe('title casing follows the class the renderer chose', () => {
    /** Does css/main.css uppercase this class — on the footer, or on the band?
     *  The plate (2026-09-11) resets both headline classes to sentence case
     *  under the overlay layout, so the rule that applies is the layout's when
     *  the card wears it, and the class's own otherwise. */
    const uppercases = (cls, overlay) => {
      const sel = overlay ? `.wk-card[data-layout="overlay"] ${cls}` : `${cls} {`;
      const i = css.indexOf(sel);
      expect(i, `${sel} is gone from css/main.css`).toBeGreaterThan(-1);
      const rule = css.slice(i, css.indexOf('}', i));
      if (/text-transform:\s*none/.test(rule)) return false;
      if (/text-transform:\s*uppercase/.test(rule)) return true;
      // The band rule inherits the class's own transform when it sets none.
      return overlay ? uppercases(cls, false) : false;
    };

    const cases = [
      ['a photo card', { kind: 'photo', data: ARCHIVE }, '.wk-title'],
      ['a note leading with its hero', { kind: 'text', data: HERO_POST }, '.wk-t-title'],
      ['a note with words on the picture', {
        kind: 'text', data: HERO_POST,
        over: { id: 'c-u', title: 'On the way', card: { layout: 'overlay' } },
      }, '.wk-t-title'],
      ['a photo with words on the picture', {
        kind: 'photo', data: ARCHIVE,
        over: { id: 'c-v', title: 'Evening Light', card: { layout: 'overlay' } },
      }, '.wk-title'],
    ];

    for (const [name, item, cls] of cases) {
      it(`${name} paints its headline the way ${cls} renders it`, () => {
        const comp = RI.cardComposition(item);
        const node = RI.buildCard(item);
        // The card really does use that class for its footer headline…
        expect(node.querySelector(`.wk-body ${cls}, ${cls}`), cls).toBeTruthy();
        // …and the painter's casing agrees with what CSS does to it.
        expect(titleIsUppercased(comp), `${cls} → uppercase?`).toBe(uppercases(cls, !!comp.overlay));
      });
    }

    it('and a photo on the band keeps its sentence case on the canvas', async () => {
      const c = fakeCanvas();
      await paintCard({ kind: 'photo', data: ARCHIVE,
        over: { id: 'c-w', title: 'Evening Light', card: { layout: 'overlay' } } }, 'native',
      { canvas: c, image: null, tokens: FALLBACK_TOKENS });
      expect(textOf(c._ctx)).toContain('Evening Light');
      expect(textOf(c._ctx)).not.toContain('EVENING LIGHT');
      // The plate's full stop, painted as its own glyph in the accent.
      const dots = c._ctx.calls.filter((k) => k[0] === 'fillText' && k[2] === '.');
      expect(dots.length).toBe(1);
      expect(dots[0][1], 'in the accent').toBe(FALLBACK_TOKENS.accent);
    });

    it('and the painted canvas actually says so', async () => {
      const hero = fakeCanvas();
      await paintCard({ kind: 'text', data: HERO_POST }, 'native',
        { canvas: hero, image: null, tokens: FALLBACK_TOKENS });
      expect(textOf(hero._ctx), 'a note keeps its sentence case').toContain('The Long Way Round');

      const photo = fakeCanvas();
      await paintCard({ kind: 'photo', data: ARCHIVE }, 'native',
        { canvas: photo, image: null, tokens: FALLBACK_TOKENS });
      expect(textOf(photo._ctx), 'a frame keeps its label case').toContain('EVENING LIGHT');
    });
  });

  it('the pulse ladder is the words tile\'s ladder, at the pulse card\'s sizes', () => {
    const size = (sel) => {
      const i = css.indexOf(`${sel} {`);
      const m = /font-size:\s*([\d.]+)rem/.exec(css.slice(i, css.indexOf('}', i)));
      return Number(m[1]);
    };
    expect(TYPE.pulseText.standard * REF / 16).toBeCloseTo(size('.wk-p-text'), 2);
    expect(TYPE.pulseText.feature * REF / 16)
      .toBeCloseTo(size('.wk-pulse[data-tier="feature"] .wk-p-text'), 2);
    expect(TYPE.pulseGlyph.standard * REF / 16)
      .toBeCloseTo(size('.wk-pulse[data-tier="standard"] .wk-p-glyph'), 2);
    expect(TYPE.pulseGlyph.feature * REF / 16)
      .toBeCloseTo(size('.wk-pulse[data-tier="feature"] .wk-p-glyph'), 2);
    expect(TYPE.pulseGlyph.statement * REF / 16)
      .toBeCloseTo(size('.wk-pulse[data-tier="statement"] .wk-p-glyph'), 2);
  });

  it('the drop cap is 3em of the tease, 3.3 at feature — .wk-dropcap\'s recipe', () => {
    const i = css.indexOf('.wk-dropcap {');
    expect(/font-size:\s*3em/.test(css.slice(i, css.indexOf('}', i)))).toBe(true);
    expect(TYPE.dropcap).toBe(3);
    expect(TYPE.dropcapFeature).toBe(3.3);
  });
});
