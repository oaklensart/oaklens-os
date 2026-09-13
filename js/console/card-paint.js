// OAKLENS Field Console — the card painter.
//
// THE SHARE IMAGE IS THE CARD (owner decision, docs/cards-core-complete.md
// §2.1(3), built as chunk 7). Until now a link preview was a third design of
// the same thing: a photograph with a FRAME // date rail bolted under it, which
// looked like nothing on the site and could only ever describe a frame. A note
// with no hero had no image at all; an audio card, a set and a composed card
// had none either.
//
// So there is one painter, and it draws the card the homepage draws. It is fed
// by `RecentIndex.cardComposition(item)` — the engine's own answer to which
// title, which caption, which label, which picture, which crop, which band —
// so the painter decides NOTHING about what is on a card. It decides only how
// to put those values on a canvas, at three ratios.
//
// ⚠️ THIS IS A SECOND RENDERER, and the one thing that keeps a second renderer
// honest is a test that compares it to the first. tests/card-paint.test.js
// asserts, for every kind and layout, that what this paints is what buildCard
// renders. Pixels are not asserted; composition is. If you add a value to the
// paint, add it to the composition first — never read the record here.
//
// The split is chunk 3's: the pure half (geometry, keys, text fitting) is
// exported and pinned by tests; the impure half loads the picture and touches a
// canvas. A painter whose arithmetic nobody can test is a guess.
//
// New in chunk 7. See dev/console-module-plan.md.

import { SITE_NAME, SITE_WORDMARK_STEM, SITE_WORDMARK_ACCENT } from './assets.js';

// ============== THE THREE RATIOS ==============
//
// Three outputs, and no square unless the owner asks (§2.2):
//   og      every link preview — iMessage, RCS, WhatsApp, Bluesky, a DM
//   native  the card itself, at the proportion a feed post wants
//   story   the full-bleed vertical
export const SHARE_RATIOS = {
  og: { w: 1200, h: 630 },
  native: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};

// The card face, in CARD-WIDTH units.
//
// The picture well is 4:5 EXACTLY, because that is what the homepage crops to
// and a share image that re-framed the photograph would be showing something
// the card does not. The footer under it, and the height of the kinds that have
// no picture, come from the row: every card in a row is the same height, so one
// number describes all four kinds.
//
// These are the painter's own proportions rather than the stylesheet's. A
// canvas cannot read rem, and a painter that measured a mounted card would
// produce a different image on a phone than on a desktop — the one thing a
// published asset must not do.
export const CARD_WELL = 1.25;   // 4:5
// The footer is what .wk-body actually needs at the reference card size: its
// own padding (12px top, 13px bottom), a headline that may run to the two lines
// .wk-composed .wk-title clamps at, the 5px gap, and the caption line — 0.185 of
// the card's width, rounded up so a two-line title never clips. Deeper than
// that and the painted card has a band of empty ground under its words that
// the real card does not (found by opening the page, not by a test).
export const CARD_FOOT = 0.20;
export const CARD_H = CARD_WELL + CARD_FOOT;   // 1.45 — card height ÷ card width

// ============== THE KEYS ==============
//
// A stamp's address on R2. Frames keep `meta/<base>-og.webp` untouched, so
// every card stamped before this chunk keeps serving and `_ogImage` and
// `/api/og-cards` need no change. The four other stems are prefixed by what
// they identify, because a track slug, a set slug and a card id are different
// namespaces that may legitimately collide (chunk 4 §3).
//
// ⚠️ THE EDGE SPELLS THESE TOO — src/edge/chrome.js, one line per branch, and
// it cannot import this file (a Worker module and a browser module share no
// build). tests/share-keys.test.js compares the two sides so they cannot drift.
export function shareStem(target) {
  const t = target || {};
  const id = String(t.id || '').trim();
  if (!id) return '';
  if (t.kind === 'frame') return `meta/${id}`;          // id = the image basename
  if (t.kind === 'fn') return `meta/fn-${id}`;          // id = the note's fn_id
  if (t.kind === 'audio') return `meta/audio-${id}`;    // id = the track slug
  if (t.kind === 'set') return `meta/set-${id}`;        // id = the set slug
  if (t.kind === 'card') return `meta/card-${id}`;      // id = the composed id
  return '';
}

// One stem, three files. `og` keeps the historic suffix so nothing re-stamps.
export function shareKey(stem, ratio) {
  if (!stem || !SHARE_RATIOS[ratio]) return '';
  return `${stem}-${ratio === 'og' ? 'og' : ratio}.webp`;
}

// ============== GEOMETRY (pure) ==============
//
// Where the card sits on each ground, and what else the ground carries. Pure
// and exported so the three ratios are pinned numbers rather than a sentence.
//
// `og` is the only one that is not simply "the card, framed": a 1.91:1 ground
// is far wider than any card, so the card takes the left and its title takes
// the space beside it — which is also what every messaging app shows at a
// glance, a picture with a line of type next to it.
//
// ⚠️ `native` is 4:5 and the card is NOT: a card is a 4:5 picture well plus its
// footer. Filling the frame edge to edge would mean re-cropping the photograph,
// which is the one thing this painter must not do — so native is the card at
// its largest, with the ground as a frame.
// WHICH BOX THIS CARD IS.
//
// A card is its 4:5 picture well plus a footer — EXCEPT under the overlay
// layout, where the words move onto the picture and the card IS the well
// (css/main.css resets the shell for exactly that reason). Painting an overlay
// card into the taller box would crop the photograph deeper than the homepage
// does, which is the one thing this painter must not do. Found by putting the
// two side by side; no test could see it, because both were "a card".
export function cardAspect(comp) {
  return (comp && comp.overlay) ? CARD_WELL : CARD_H;
}

export function shareGeometry(ratio, aspect = CARD_H) {
  const r = SHARE_RATIOS[ratio];
  if (!r) return null;
  const { w: W, h: H } = r;
  const CARD_H = aspect;   // shadowed on purpose: one name for "the card's shape"

  if (ratio === 'og') {
    const pad = 46;
    const h = H - pad * 2;
    const w = Math.round(h / CARD_H);
    const x = pad + 16;
    const gap = 52;
    return {
      W, H, ratio,
      card: { x, y: pad, w, h },
      text: { x: x + w + gap, y: Math.round(H * 0.34), w: W - (x + w + gap) - pad },
      wordmark: { x: x + w + gap, y: H - pad - 10, align: 'left' },
    };
  }

  if (ratio === 'native') {
    const pad = 34;
    const h = H - pad * 2;
    const w = Math.round(h / CARD_H);
    return {
      W, H, ratio,
      card: { x: Math.round((W - w) / 2), y: pad, w, h },
      text: null,
      wordmark: null,   // the card fills the frame; a wordmark on top of it is clutter
    };
  }

  // story — the card centred, the wordmark below it (§7 Q3, owner default).
  const pad = 96;
  const w = W - pad * 2;
  const h = Math.round(w * CARD_H);
  // Lifted above centre to leave the wordmark its own air, but never so far
  // that a squarer card (overlay) rides off the top.
  const y = Math.max(pad, Math.round((H - h) / 2) - 70);
  return {
    W, H, ratio,
    card: { x: pad, y, w, h },
    text: null,
    wordmark: { x: Math.round(W / 2), y: y + h + 104, align: 'center' },
  };
}

// The source rect a cover-crop of aspect `ar` keeps at a focal point. The same
// arithmetic focal.js's sampler uses, restated here rather than imported
// because this module sits BELOW focal in the layer order — and pinned against
// it in tests/card-paint.test.js so the two can never answer differently.
export function coverRect(sw, sh, ar, fx, fy) {
  let cw = sw, ch = sw / ar;
  if (ch > sh) { ch = sh; cw = sh * ar; }
  return { sx: (sw - cw) * (fx / 100), sy: (sh - ch) * (fy / 100), cw, ch };
}

// The focal point as numbers — the one string format, parsed the one way.
export function focusPct(str) {
  const m = /(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(str || '');
  const c = (n) => Math.max(0, Math.min(100, n));
  return m ? { x: c(+m[1]), y: c(+m[2]) } : { x: 50, y: 50 };
}

// ============== TOKENS ==============
//
// COLOUR IS DERIVED, NEVER ENUMERATED (§4). A canvas cannot resolve a CSS
// variable, which is how the old painter ended up with two hardcoded reds that
// shipped this instance's brand into every fork's link previews. So the colours
// are READ, at paint time, from computed style on a card that is actually
// mounted — the card wears the site's own preset and theme by construction.
//
// The fallbacks below are the neutral greys a canvas needs when there is no
// document at all (a test, a worker). They are not anyone's brand: the accent
// falls back to the same generic red the previous painter used.
// ONE literal, named. --brand and --accent are different tokens (see
// readCardTokens) but they fall back to the same generic red, and writing it
// twice would read as a palette with a house colour in it.
const NEUTRAL_ACCENT = '#FF0000';
export const FALLBACK_TOKENS = {
  ground: '#0b0b0b',
  surface: '#121212',
  surfaceAlt: '#161616',
  line: '#242424',
  ink: '#ececec',
  body: '#dedede',
  muted: '#9b9b9b',
  faint: '#7a7a7a',
  brand: NEUTRAL_ACCENT,
  accent: NEUTRAL_ACCENT,
  accentText: '#9b9b9b',
  // The accent as a bare triplet — the same generic red as NEUTRAL_ACCENT, for
  // the one place a canvas needs `rgba(r, g, b, a)` rather than a colour.
  accentRgb: '255, 0, 0',
  // THE ATMOSPHERE, and empty on purpose. `--pulse-rgb` exists only on a card
  // that wears a palette and `--audio-rgb` only on an audio card, so the probe
  // reads them off the mounted card and an empty answer means "no palette":
  // the painter draws the plain surface, exactly as the CSS does. Nothing here
  // is a palette value — the five hues live in css/main.css and nowhere else.
  pulseRgb: '',
  audioRgb: '',
  // The veils and the LED housing, at the values the stylesheet gives them in
  // the dark theme; the probe replaces them with the theme's own (DAYLIGHT
  // inverts the veil to white and softens the bezel — the painter must not
  // know that, only read it).
  pulseVeil: 'rgba(0, 0, 0, 0.55)',
  audioVeil: 'rgba(0, 0, 0, 0.55)',
  ledBezel: 'rgba(0, 0, 0, 0.9)',
  ledSpec: 'rgba(255, 255, 255, 0.4)',
  // The card's own border colour as the mounted card computes it — a palette
  // card tints its edge, and the tint is in the stylesheet, not here.
  cardLine: '',
  display: '"Syne", ui-sans-serif, system-ui, sans-serif',
  bodyFace: 'ui-sans-serif, system-ui, sans-serif',
  meta: '"Syne Mono", ui-monospace, monospace',
};

// ============== THE CARD'S OWN TYPE SCALE ==============
//
// In CARD-WIDTH units, so a painted card is the same card at a different size.
//
// Every number here is the stylesheet's own rem size divided by a 340px
// reference card — roughly what a card measures on the homepage grid and on
// its own page. That derivation is the point: the alternative is a painter with
// its own idea of how big a headline is, which is how the old OG card ended up
// looking like nothing on the site. When a rule in css/main.css moves, the
// matching line here moves with it, and the comment says which rule.
export const TYPE = {
  // .wk-kicker  0.56rem, .18em tracking, uppercase
  kicker: 0.0264, kickerTrack: 0.0048,
  // .wk-t-title 1.18rem, weight 680, NOT uppercase
  tTitle: 0.0556,
  // .wk-snip, by tier — 1.55rem standard, 1.95 feature, ~2.6 statement
  snip: { standard: 0.0729, feature: 0.0918, statement: 0.1224 },
  // .wk-dropcap 3em of the snip (3.3em at feature)
  dropcap: 3, dropcapFeature: 3.3,
  // .wk-t-meta 0.6rem, .08em tracking, uppercase, rule above
  tMeta: 0.0282, tMetaTrack: 0.0023,
  // .wk-title 0.8rem, weight 640, uppercase
  title: 0.0376,
  // THE PLATE (main.css "THE PLATE"): the overlay band's headline by data-scale
  // — 2.7rem statement (the clamp's middle), 2.1 feature, 1.5 standard, 1.18
  // compact — with its leading, then the caption line at 0.58rem / .14em
  // tracking, the 22×2px accent rule above it and the two gaps around the rule.
  plate: { statement: 0.127, feature: 0.099, standard: 0.0705, compact: 0.0555 },
  plateLead: { statement: 0.98, feature: 1.02, standard: 1.08, compact: 1.14 },
  plateMeta: 0.0273, plateMetaTrack: 0.0038,
  plateRuleW: 0.065, plateRuleH: 0.006, plateGap: 0.018, plateRuleGap: 0.026,
  // .wk-body padding under the band: 16px on the near edge, 48px on the fade
  platePad: 0.047, platePadFar: 0.141,
  // .wk-meta 0.62rem, .06em tracking
  meta: 0.0292, metaTrack: 0.0018,
  // .wk-tag 0.5rem, .16em tracking, uppercase
  tag: 0.0235, tagTrack: 0.0038,
  // .wk-text padding 16px; .wk-body padding 12px 13px; .wk-body gap 5px
  textPad: 0.047, bodyPadY: 0.035, bodyPadX: 0.038, bodyGap: 0.0147,
  // .wk-p-text — 1.35rem standard, 1.5 feature, ~2.0 statement (a clamp)
  pulseText: { standard: 0.0635, feature: 0.0706, statement: 0.0941 },
  // .wk-p-glyph — 1.7rem standard, 2.4 feature, 3.4 statement, big when alone
  pulseGlyph: { standard: 0.080, feature: 0.113, statement: 0.160, glyph: 0.210 },
};

/**
 * Read the palette off a mounted card. `node` is any real `.wk-card` in the
 * document — the composer's card is the obvious one. Every value the painter
 * uses comes from here, so a preset the console has never heard of still
 * paints correctly.
 */
export function readCardTokens(node) {
  const out = { ...FALLBACK_TOKENS };
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return out;
  let cs = null;
  const read = (el) => {
    if (!el) return null;
    try {
      const got = getComputedStyle(el);
      // ⚠️ A DETACHED NODE RESOLVES NOTHING. getComputedStyle on an element
      // that is not in the document answers '' for every custom property —
      // silently, so the painter would draw a whole card in the hardcoded
      // fallbacks and only a preset that is not dark would show it. Found
      // exactly that way, in a light preset. So an empty answer falls through
      // to the document, not to the greys.
      const any = ['--surface', '--bg', '--fg', '--accent', '--brand', '--muted']
        .some((n) => (got.getPropertyValue(n) || '').trim());
      return any ? got : null;
    } catch { return null; }
  };
  cs = read(node) || read(document.documentElement);
  if (!cs) return out;
  const v = (name, fb) => {
    const raw = (cs.getPropertyValue(name) || '').trim();
    return raw || fb;
  };
  out.ground = v('--bg', v('--surface', out.ground));
  out.surface = v('--surface', out.surface);
  out.surfaceAlt = v('--surface-2', out.surface);
  out.line = v('--line', out.line);
  out.ink = v('--fg-strong', v('--fg', out.ink));
  out.body = v('--fg', out.ink);
  out.muted = v('--muted', out.muted);
  out.faint = v('--faint', out.muted);
  // --accent is the preset's brand as the PAGE wears it (it swaps to the paper
  // tier in DAYLIGHT); --brand is the constant mark the console defines per
  // preset. The card uses both — the drop cap and the kicker dot follow the
  // page, the wordmark follows the brand — so the painter reads both rather
  // than picking one and being wrong half the time.
  //
  // ⚠️ --brand falls back to --accent, NOT to the neutral red. It is defined in
  // css/field-console.css and not in css/main.css, so anywhere the painter runs
  // outside the console it is empty — and a hardcoded red there is precisely
  // the "every fork's previews carry this instance's colour" bug wearing new
  // clothes. A site's own accent is always the better answer than a literal.
  out.accent = v('--accent', out.brand);
  out.brand = v('--brand', out.accent);
  out.accentText = v('--accent-text', out.muted);
  out.accentRgb = v('--accent-rgb', out.accentRgb);
  // THE ATMOSPHERE IS READ OFF THE CARD, never looked up (§4: colour is derived,
  // never enumerated). `.wk-composed[data-state="velvet"]` sets --pulse-rgb on
  // the card root and `.wk-audio` sets --audio-rgb; on the document root both
  // are empty, which is the honest answer for a card with no palette. A first
  // pass here carried the five triplets in a table beside this function — a
  // second copy of css/main.css that would have drifted the day a hue moved,
  // and painted every fork's `signal` in this instance's red.
  out.pulseRgb = v('--pulse-rgb', '');
  out.audioRgb = v('--audio-rgb', '');
  out.pulseVeil = v('--pulse-veil', out.pulseVeil);
  out.audioVeil = v('--audio-veil', out.audioVeil);
  out.ledBezel = v('--led-bezel', out.ledBezel);
  out.ledSpec = v('--led-spec', out.ledSpec);
  // The edge the card actually draws — tinted by the palette, inverted by the
  // theme, all in the stylesheet. Only meaningful when the node IS the card.
  if (node && cs !== null && node.classList && node.classList.contains('wk-card')) {
    const edge = (cs.borderTopColor || '').trim();
    if (edge && edge !== 'transparent') out.cardLine = edge;
  }
  out.bodyFace = v('--font-body', out.bodyFace);
  out.display = v('--font-display', out.display);
  out.meta = v('--font-meta', out.meta);
  return out;
}

// ============== TEXT (pure enough to test with a stub ctx) ==============

function setFont(ctx, family, size, weight, track) {
  ctx.font = `${weight || 400} ${Math.round(size)}px ${family}`;
  try { ctx.letterSpacing = `${(track || 0).toFixed(2)}px`; } catch { /* not everywhere */ }
}

/** One line, cut with an ellipsis where it will not fit. */
export function fitLine(ctx, text, maxWidth) {
  const s = String(text == null ? '' : text);
  if (!s) return '';
  if (ctx.measureText(s).width <= maxWidth) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${s.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${s.slice(0, lo).trimEnd()}…` : '';
}

/**
 * Word-wrapped lines, capped — the last one ellipsised if there is more.
 *
 * `maxWidth` may be a NUMBER or a function `(lineIndex) => width`. The function
 * form exists for one caller and one reason: a drop cap is a float, so the
 * lines it displaces have a narrower column than the lines below it. Wrapping
 * everything to the narrow width cost the tease about a quarter of its measure
 * on every line past the cap — visible beside the real card, which a code
 * review spotted independently of the comment that had called it deliberate.
 */
export function wrapLines(ctx, text, maxWidth, maxLines) {
  const widthAt = typeof maxWidth === 'function' ? maxWidth : () => maxWidth;
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= widthAt(lines.length) || !line) { line = next; continue; }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  // DID ANY WORD FAIL TO LAND? Counted in WORDS, not characters.
  //
  // This compared `lines.join(' ').length` to `text.trim().length` until a code
  // review found it: the lines are joined with exactly one space, so any run of
  // consecutive whitespace in the source — a double space between two words, a
  // tab, a newline — made the two lengths differ even when every word had
  // fitted, and the card got an ellipsis it had not earned. Words are what the
  // wrap actually places, so words are what the check counts.
  const shown = lines.reduce((n, l) => n + l.split(' ').length, 0);
  if (shown < words.length && lines.length) {
    // The manual ellipsis is NOT redundant: fitLine only cuts a string that
    // overflows, and this line fits by construction — so handing it the bare
    // line would return it unchanged and the reader would never learn there was
    // more. Appending first is what forces fitLine to make room for it.
    lines[lines.length - 1] = fitLine(ctx, `${lines[lines.length - 1]}…`, widthAt(lines.length - 1));
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// ============== THE CARD FACE ==============
//
// One function per shape, mirroring the engine's one renderer per kind. Each
// takes the composition and a rect and draws inside it; nothing reads a record.

// THE ATMOSPHERE — the ground a palette card, an audio card and a pulse card
// share (css/main.css: `.wk-composed[data-state]`, `.wk-audio`, `.wk-pulse`).
// The same four layers in the same order, bottom to top: the theme's recessed
// surface, a veil, a directional 168° wash, a corner light. The hue and the
// veil come in as TOKENS read off the mounted card — the veil is what DAYLIGHT
// inverts (black over ink, white over paper), and a painter that wrote
// `rgba(0,0,0,…)` here would put a dark slab on every light-theme share image.
// Only the alphas differ per kind, and those are the stylesheet's own numbers.
function drawAtmosphericBackground(ctx, rect, rgbStr, tokens, opts = {}) {
  const {
    cornerX = 0.84,
    cornerY = 0.08,
    cornerRadius = 0.58,
    cornerAlpha = 0.20,
    linearAlphaStart = 0.11,
    linearAlphaMid = 0.03,
    veil = tokens.pulseVeil,
  } = opts;

  // 1. Base surface
  ctx.fillStyle = tokens.surfaceAlt || tokens.surface;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // 2. The veil, as the theme paints it
  if (veil) {
    ctx.fillStyle = veil;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // 3. Directional linear gradient at 168deg (tilted down towards bottom-left)
  if (typeof ctx.createLinearGradient === 'function') {
    const x1 = rect.x + rect.w * 0.4;
    const y1 = rect.y;
    const x2 = rect.x + rect.w * 0.15;
    const y2 = rect.y + rect.h;
    const linGrad = ctx.createLinearGradient(x1, y1, x2, y2);
    linGrad.addColorStop(0, `rgba(${rgbStr}, ${linearAlphaStart})`);
    if (linearAlphaMid > 0) {
      linGrad.addColorStop(0.58, `rgba(${rgbStr}, ${linearAlphaMid})`);
    }
    linGrad.addColorStop(1, `rgba(${rgbStr}, 0)`);
    ctx.fillStyle = linGrad;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // 4. Radial corner glow
  if (typeof ctx.createRadialGradient === 'function') {
    const gx = rect.x + rect.w * cornerX;
    const gy = rect.y + rect.h * cornerY;
    const gr = rect.w * cornerRadius;
    const radGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    radGrad.addColorStop(0, `rgba(${rgbStr}, ${cornerAlpha})`);
    radGrad.addColorStop(0.58, `rgba(${rgbStr}, 0)`);
    radGrad.addColorStop(1, `rgba(${rgbStr}, 0)`);
    ctx.fillStyle = radGrad;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
}

// The on-media chip. The same theme-independent treatment .wk-tag has in CSS —
// white type on a dark pill — because it sits on a photograph in every preset.
// Under a TOP-placed overlay band it crosses to the other end, exactly as the
// stylesheet moves it (chunk 3's second browser-only bug).
function drawTag(ctx, rect, text, comp, u, tokens) {
  const label = String(text || '').toUpperCase();
  if (!label) return;
  setFont(ctx, tokens.meta, u * TYPE.tag, 400, u * TYPE.tagTrack);
  const padX = u * 0.018, padY = u * 0.012;
  const w = ctx.measureText(label).width + padX * 2;
  const h = u * TYPE.tag + padY * 2;
  const topBand = comp.overlay && comp.overlay.place === 'top';
  const x = topBand ? rect.x + u * 0.022 : rect.x + rect.w - w - u * 0.022;
  const y = topBand ? rect.y + rect.h - h - u * 0.022 : rect.y + u * 0.022;
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  roundRect(ctx, x, y, w, h, u * 0.012);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + padX, y + h / 2);
}

// The picture well. Cover-cropped at 4:5 from the card's own focal point, so
// the share image keeps exactly what the card keeps.
function drawWell(ctx, rect, comp, img, tokens) {
  ctx.save();
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 0);
  ctx.clip();
  ctx.fillStyle = tokens.surfaceAlt;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (img && (img.naturalWidth || img.width)) {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const f = focusPct(comp.media && comp.media.focus);
    const c = coverRect(sw, sh, rect.w / rect.h, f.x, f.y);
    ctx.drawImage(img, c.sx, c.sy, c.cw, c.ch, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

// WHICH FOOTER HEADLINE IS UPPERCASED, and why the painter must not decide.
//
// A picture card's headline is a LABEL and lands in `.wk-title`, which CSS
// uppercases. A note leading with its hero puts the same line in `.wk-t-title`,
// which is prose and carries no text-transform at all — so the painter shouting
// "ON WALKING" where the site says "On Walking" is a second opinion about
// somebody else's stylesheet. Found by a code review; the parity test could not
// see it, because casing is applied at PAINT time and the composition carries
// the title as authored.
//
// The rule is therefore stated once, here, against the class each kind's
// renderer actually uses — and tests/card-paint.test.js reads both halves out
// of the real card and the real stylesheet rather than trusting this comment.
export function titleIsUppercased(comp) {
  // On the band the plate takes over and sets both kinds in sentence case
  // (main.css: `.wk-card[data-layout="overlay"] .wk-title { text-transform:
  // none }`), so a photo's label voice stops at the overlay layout.
  return !!comp && comp.kind === 'photo' && !comp.overlay;
}

/** The footer headline as it should be PAINTED — one spelling, both callers. */
function headlineOf(comp) {
  const t = String((comp && comp.title) || '');
  return titleIsUppercased(comp) ? t.toUpperCase() : t;
}

// The footer pair — the title and its caption, in the picture card's grammar.
// `ink` and `muted` are passed rather than read so the overlay band can hand
// this the derived ink instead of the theme's.
function drawFooterText(ctx, box, comp, tokens, ink, muted, u) {
  let y = box.y;
  const titleSize = u * TYPE.title;
  setFont(ctx, tokens.display, titleSize, 640, 0);
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  // Two lines, the way .wk-composed .wk-title is line-clamped — a typed title
  // that ran on would grow the footer and shove the picture around.
  const titleLines = wrapLines(ctx, headlineOf(comp), box.w, 2);
  for (const line of titleLines) {
    ctx.fillText(line, box.x, y);
    y += titleSize * 1.15;
  }
  if (comp.meta) {
    y += u * TYPE.bodyGap;
    const metaSize = u * TYPE.meta;
    setFont(ctx, tokens.meta, metaSize, 400, u * TYPE.metaTrack);
    ctx.fillStyle = muted;
    ctx.fillText(fitLine(ctx, comp.meta, box.w), box.x, y);
    y += metaSize * 1.2;
  }
  return y;
}

// THE PLATE — the band's type, as main.css draws it: the headline at the scale
// the engine stamped (comp.overlay.scale), sentence case, up to three lines,
// closed by the accent full stop where the engine stamped a mark; then the
// caption as a tracked uppercase line under a short accent rule. Measures the
// same block it paints (`measure: true`), so the veil behind it hugs the type
// exactly as the stylesheet's band does. `centre` centres every line and the
// rule, the way the CSS does.
function drawPlateText(ctx, box, comp, tokens, ink, muted, u, opts) {
  const measure = !!(opts && opts.measure);
  const centre = comp.overlay && comp.overlay.place === 'centre';
  const scale = (comp.overlay && comp.overlay.scale) || 'standard';
  const titleSize = u * (TYPE.plate[scale] || TYPE.plate.standard);
  const lead = TYPE.plateLead[scale] || TYPE.plateLead.standard;
  let y = box.y;
  setFont(ctx, tokens.display, titleSize, 700, -titleSize * 0.02);
  const lines = wrapLines(ctx, headlineOf(comp), box.w, 3);
  const mark = comp.overlay && comp.overlay.mark === 'dot';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    const last = i === lines.length - 1;
    if (!measure) {
      const w = ctx.measureText(line).width;
      const dotW = (last && mark) ? ctx.measureText('.').width : 0;
      const x = centre ? box.x + (box.w - w - dotW) / 2 : box.x;
      ctx.textAlign = 'left';
      ctx.fillStyle = ink;
      ctx.fillText(line, x, y);
      if (last && mark) {
        ctx.fillStyle = tokens.accent;
        ctx.fillText('.', x + w, y);
      }
    }
    y += titleSize * lead;
  });
  if (comp.meta) {
    y += u * TYPE.plateGap;
    const ruleW = u * TYPE.plateRuleW;
    const ruleH = u * TYPE.plateRuleH;
    if (!measure) {
      ctx.fillStyle = tokens.accent;
      ctx.fillRect(centre ? box.x + (box.w - ruleW) / 2 : box.x, y, ruleW, ruleH);
    }
    y += ruleH + u * TYPE.plateRuleGap;
    const metaSize = u * TYPE.plateMeta;
    setFont(ctx, tokens.meta, metaSize, 400, u * TYPE.plateMetaTrack);
    const metaLines = wrapLines(ctx, String(comp.meta).toUpperCase(), box.w, 2);
    for (const line of metaLines) {
      if (!measure) {
        const w = ctx.measureText(line).width;
        ctx.textAlign = 'left';
        ctx.fillStyle = muted;
        ctx.fillText(line, centre ? box.x + (box.w - w) / 2 : box.x, y);
      }
      y += metaSize * 1.5;
    }
  }
  return y - box.y;
}

// A picture card — photo, RAW, or a note leading with its hero. With the
// overlay layout the same two lines move ONTO the picture inside a band, using
// the record's own place/treat/blur and the ink the engine derived.
function drawPictureCard(ctx, rect, comp, tokens, img) {
  const u = rect.w;
  const overlay = comp.overlay;
  const wellH = overlay ? rect.h : Math.round(rect.w * CARD_WELL);
  const well = { x: rect.x, y: rect.y, w: rect.w, h: wellH };
  drawWell(ctx, well, comp, img, tokens);

  const padX = u * TYPE.bodyPadX;
  if (!overlay) {
    ctx.fillStyle = tokens.surface;
    ctx.fillRect(rect.x, rect.y + wellH, rect.w, rect.h - wellH);
    const footRgb = paletteRgbOf(comp, tokens);
    if (footRgb) {
      const rgb = footRgb;
      if (typeof ctx.createLinearGradient === 'function') {
        const footGrad = ctx.createLinearGradient(rect.x, rect.y + wellH, rect.x, rect.y + rect.h);
        footGrad.addColorStop(0, `rgba(${rgb}, 0.12)`);
        footGrad.addColorStop(1, `rgba(${rgb}, 0.04)`);
        ctx.fillStyle = footGrad;
        ctx.fillRect(rect.x, rect.y + wellH, rect.w, rect.h - wellH);
      }
    }
    drawFooterText(
      ctx,
      { x: rect.x + padX, y: rect.y + wellH + u * TYPE.bodyPadY, w: rect.w - padX * 2 },
      comp, tokens, tokens.ink, tokens.muted, u,
    );
    drawTag(ctx, well, comp.label, comp, u, tokens);
    return;
  }

  // ---- the band ----
  // Measure the block first, then paint the veil behind exactly that height —
  // the stylesheet's band hugs its content too.
  const light = overlay.ink === 'light';
  // THE BAND'S TWO COLOURS ARE A POLARITY, NOT A PALETTE. White type or black
  // type, and a veil that is the opposite — the argument .wk-tag's fixed
  // rgba() already makes in CSS, because this band sits on a photograph rather
  // than on the page, and a theme-derived pair goes pale in a light preset
  // under light ink (chunk 3's first divergence). Everything else on the card
  // is read from the theme.
  const ink = light ? 'rgba(244,244,244,1)' : 'rgba(17,17,17,1)';
  const muted = light ? 'rgba(244,244,244,0.78)' : 'rgba(17,17,17,0.72)';
  // The band hugs the plate: the near edge (the one the band is anchored to)
  // keeps the body's own padding, the far edge carries the fade. `centre` has
  // no far edge and pads both sides alike.
  const near = u * TYPE.platePad;
  const far = overlay.place === 'centre' ? u * TYPE.platePad * 1.4 : u * TYPE.platePadFar;
  const padBefore = overlay.place === 'top' ? near : far;   // above the type
  const padAfter = overlay.place === 'top' ? far : near;    // below the type
  const blockH = drawPlateText(
    ctx, { x: rect.x + near, y: 0, w: rect.w - near * 2 },
    comp, tokens, ink, muted, u, { measure: true },
  );
  const bandH = blockH + padBefore + padAfter;
  const bandY = overlay.place === 'top' ? rect.y
    : overlay.place === 'centre' ? Math.round(rect.y + (rect.h - bandH) / 2)
      : rect.y + rect.h - bandH;

  ctx.save();
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 0);
  ctx.clip();
  if (overlay.treat === 'blur') {
    // THE VEIL IS THE OPPOSITE OF THE INK, never the theme's ground (chunk 3's
    // first divergence): this band sits on a photograph, and a theme-derived
    // veil goes pale in a light preset under light type and destroys the exact
    // legibility the layout exists for.
    const supported = typeof ctx.filter === 'string';
    if (supported) {
      ctx.save();
      roundRect(ctx, rect.x, bandY, rect.w, bandH, 0);
      ctx.clip();
      ctx.filter = `blur(${(u * 0.012 * overlay.blur).toFixed(1)}px)`;
      if (img && (img.naturalWidth || img.width)) {
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        const f = focusPct(comp.media && comp.media.focus);
        const c = coverRect(sw, sh, rect.w / rect.h, f.x, f.y);
        ctx.drawImage(img, c.sx, c.sy, c.cw, c.ch, rect.x, rect.y, rect.w, rect.h);
      }
      ctx.filter = 'none';
      ctx.restore();
    }
    ctx.fillStyle = light ? 'rgba(0,0,0,0.34)' : 'rgba(255,255,255,0.42)';
    ctx.fillRect(rect.x, bandY, rect.w, bandH);
  } else if (overlay.treat === 'scrim') {
    const grad = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
    const a = light ? '0,0,0' : '255,255,255';
    const stops = overlay.place === 'top'
      ? [[0, 0.72], [1, 0]]
      : overlay.place === 'centre'
        ? [[0, 0], [0.5, 0.6], [1, 0]]
        : [[0, 0], [1, 0.78]];
    for (const [at, alpha] of stops) grad.addColorStop(at, `rgba(${a},${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(rect.x, bandY, rect.w, bandH);
  }
  ctx.restore();

  drawPlateText(
    ctx,
    { x: rect.x + near, y: bandY + padBefore, w: rect.w - near * 2 },
    comp, tokens, ink, muted, u,
  );
  drawTag(ctx, well, comp.label, comp, u, tokens);
}

// The hue a palette card wears, or '' for a card with none. `comp.palette` is
// the card's word for it ('' when default, as cardComposition spells it); the
// TRIPLET is whatever the mounted card computed for --pulse-rgb. A card that
// names a palette the probe could not read (no document — a test, a worker)
// falls back to the accent, which is at least the site's own colour.
function paletteRgbOf(comp, tokens) {
  if (!comp.palette) return '';
  return tokens.pulseRgb || tokens.accentRgb || '';
}

// The kicker non-picture cards wear: the square LED component (.wk-dot, the
// same part as the pulse card's .wk-p-led) and a label in the meta face at
// .wk-kicker's size and tracking. The housing — bezel and specular — comes from
// the theme's tokens, because DAYLIGHT seats the part in a lighter housing.
function drawKicker(ctx, x, y, text, tokens, u, dotColor) {
  const size = u * TYPE.kicker;
  const chipSize = Math.max(5, Math.round(u * 0.018));
  const chipY = Math.round(y + (size - chipSize) * 0.5);
  const chipX = Math.round(x);
  const color = dotColor || tokens.accent;

  // 1. SMD chip body (1px corner radius)
  ctx.fillStyle = color;
  roundRect(ctx, chipX, chipY, chipSize, chipSize, Math.max(1, Math.round(chipSize * 0.18)));
  ctx.fill();

  // 2. The bezel
  ctx.strokeStyle = tokens.ledBezel;
  ctx.lineWidth = Math.max(1, Math.round(chipSize * 0.16));
  ctx.stroke();

  // 3. The specular, top edge
  ctx.fillStyle = tokens.ledSpec;
  const specW = Math.max(1, Math.round(chipSize * 0.45));
  const specH = Math.max(1, Math.round(chipSize * 0.25));
  ctx.fillRect(chipX + 1, chipY + 1, specW, specH);

  setFont(ctx, tokens.meta, size, 400, u * TYPE.kickerTrack);
  ctx.fillStyle = tokens.accentText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text || '').toUpperCase(), chipX + chipSize + u * 0.020, y + size * 0.5);
  return y + size * 2.2;
}

// The words tile — the field note's own card, and the one shape where the type
// IS the design. So it follows the stylesheet exactly: the kicker in the meta
// face, the headline in the DISPLAY face and not uppercased, the tease in the
// BODY face (or the display face at statement tier, where it becomes a pull
// quote), and the drop cap as a graphic initial in the accent.
//
// The first pass of this painter set the headline in the meta face, uppercased,
// in muted — three things the card does not do. A green suite could not see it;
// opening the page could.
function drawWordsCard(ctx, rect, comp, tokens) {
  const u = rect.w;
  // A palette card is the atmosphere (`.wk-composed[data-state]`); a card
  // without one is the plain recessed surface, byte-for-byte the old painter.
  const rgb = paletteRgbOf(comp, tokens);
  if (rgb) {
    drawAtmosphericBackground(ctx, rect, rgb, tokens, { veil: tokens.pulseVeil });
  } else {
    ctx.fillStyle = tokens.surfaceAlt;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  const pad = u * TYPE.textPad;
  const x = rect.x + pad;
  const w = rect.w - pad * 2;
  let y = rect.y + pad;

  // The LED takes the palette's hue (`.wk-composed[data-state] .wk-dot`).
  y = drawKicker(ctx, x, y, comp.label, tokens, u, rgb ? `rgb(${rgb})` : null);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (comp.title) {
    const titleSize = u * TYPE.tTitle;
    setFont(ctx, tokens.display, titleSize, 680, -titleSize * 0.015);
    ctx.fillStyle = tokens.ink;
    for (const line of wrapLines(ctx, comp.title, w, 2)) {
      ctx.fillText(line, x, y);
      y += titleSize * 1.1;
    }
    y += u * 0.030;
  }

  // The tier ladder, the stylesheet's own. Statement is a display pull quote in
  // --fg-strong and carries no cap (the engine already answered that by leaving
  // `initial` empty); the other two are body copy in --fg.
  const statement = comp.tier === 'statement';
  const size = u * (TYPE.snip[comp.tier] || TYPE.snip.standard);
  const face = statement ? tokens.display : tokens.bodyFace;
  const weight = statement ? 560 : 400;
  const leading = statement ? 1.12 : (comp.tier === 'feature' ? 1.26 : 1.36);
  setFont(ctx, face, size, weight, 0);
  ctx.fillStyle = statement ? tokens.ink : tokens.body;

  // The foot (place and year) takes its own strip with the rule above it, so
  // the tease wraps into whatever is left rather than running under it.
  const footH = comp.meta ? u * (TYPE.tMeta * 1.2 + 0.040) : 0;
  const room = (rect.y + rect.h - pad - footH) - y;
  const maxLines = Math.max(1, Math.floor(room / (size * leading)));

  // MEASURE THE CAP BEFORE WRAPPING. It steals width from every line it
  // displaces, so the wrap has to run against the narrower column — and the
  // reserve has to BE the cap's width rather than an estimate of it. It was
  // `size * 2.2` until a code review: a wide initial (W, M, O in the display
  // face at 720) measures nearer `3 * size`, so the indented line was placed
  // further right than the wrap had allowed for and overhung the card's edge.
  //
  // Deliberately conservative in one direction: the lines BELOW the cap get the
  // narrow column too, though they could have the full width. Wrapping twice to
  // reclaim it would buy a few characters on line three and cost a second pass
  // over every tease; overhanging the card would be a defect.
  let capW = 0, capLines = 0;
  if (comp.initial) {
    const capSize = size * (comp.tier === 'feature' ? TYPE.dropcapFeature : TYPE.dropcap);
    setFont(ctx, tokens.display, capSize, 720, 0);
    capW = ctx.measureText(comp.initial).width + size * 0.32;
    // HOW MANY LINES THE FLOAT DISPLACES — one number, used by the wrap and by
    // the draw, so the column the text was measured against and the column it
    // is painted into cannot disagree. (The inked height of a cap-height letter
    // is about 0.66 of its em box, near enough.)
    capLines = Math.max(1, Math.ceil((capSize * 0.66) / (size * leading)));
  }
  setFont(ctx, face, size, weight, 0);
  // Only the displaced lines pay for the cap; the ones below it get the full
  // measure back, the way text wrapping around a float actually behaves.
  const lines = wrapLines(ctx, comp.words, (i) => (i < capLines ? w - capW : w), maxLines);

  // THE DROP CAP IS A FLOAT, and a float displaces every line it is tall enough
  // to reach — not just the first. Indenting only line one left the cap sitting
  // on top of line two, which is what `float: left` in .wk-dropcap exists to
  // prevent. Invisible to a test that only checks the words are on the canvas;
  // obvious the moment two of them are side by side.
  if (comp.initial) {
    const capSize = size * (comp.tier === 'feature' ? TYPE.dropcapFeature : TYPE.dropcap);
    setFont(ctx, tokens.display, capSize, 720, 0);
    ctx.fillStyle = tokens.accent;
    ctx.fillText(comp.initial, x, y - capSize * 0.06);
  }
  setFont(ctx, face, size, weight, 0);
  ctx.fillStyle = statement ? tokens.ink : tokens.body;
  lines.forEach((line, i) => {
    const indented = capW > 0 && i < capLines;
    const text = i === 0 && comp.initial
      ? line.slice(comp.initial.length).replace(/^\s+/, '')
      : line;
    ctx.fillText(text, x + (indented ? capW : 0), y);
    y += size * leading;
  });

  if (comp.meta) {
    const fy = rect.y + rect.h - pad - u * TYPE.tMeta;
    ctx.strokeStyle = tokens.line;
    ctx.lineWidth = Math.max(1, u * 0.002);
    ctx.beginPath();
    ctx.moveTo(x, fy - u * 0.022);
    ctx.lineTo(x + w, fy - u * 0.022);
    ctx.stroke();
    setFont(ctx, tokens.meta, u * TYPE.tMeta, 400, u * TYPE.tMetaTrack);
    ctx.fillStyle = tokens.faint;
    ctx.fillText(fitLine(ctx, String(comp.meta).toUpperCase(), w), x, fy);
  }
}

// The audio card. The waveform is the hero (§2.2): bars drawn from the track's
// stored peaks, the name of what is playing above them, and the author's words
// — a caption, never a statement — underneath.
function drawAudioCard(ctx, rect, comp, tokens) {
  const u = rect.w;
  // THE LISTENING ROOM (`.wk-audio`): the same recipe as a pulse, quieter at
  // every layer. Its hue is --audio-rgb as the card computes it — the accent,
  // unless a preset says otherwise — and its veil is --audio-veil.
  const rgb = tokens.audioRgb || tokens.accentRgb;
  drawAtmosphericBackground(ctx, rect, rgb, tokens, {
    cornerX: 0.88,
    cornerY: 0,
    cornerRadius: 0.58,
    cornerAlpha: 0.12,
    linearAlphaStart: 0.055,
    linearAlphaMid: 0.018,
    veil: tokens.audioVeil,
  });
  const pad = u * TYPE.textPad;
  const x = rect.x + pad;
  const w = rect.w - pad * 2;
  let y = rect.y + pad;

  y = drawKicker(ctx, x, y, comp.label, tokens, u);

  // The name of what is playing, in the words tile's headline size — it is a
  // name, not a label, so it is not uppercased (.wk-a-title).
  const nameSize = u * TYPE.tTitle;
  setFont(ctx, tokens.display, nameSize, 680, 0);
  ctx.fillStyle = tokens.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (comp.title) {
    for (const line of wrapLines(ctx, comp.title, w, 2)) {
      ctx.fillText(line, x, y);
      y += nameSize * 1.15;
    }
  }

  // The artist line (.wk-a-sub). The single card has one and the playlist card
  // deliberately does not — the count and running time are the foot's job — so
  // this follows the composition rather than the shape.
  if (comp.meta) {
    y += u * 0.012;
    setFont(ctx, tokens.meta, u * TYPE.meta, 400, u * TYPE.metaTrack);
    ctx.fillStyle = tokens.muted;
    ctx.fillText(fitLine(ctx, comp.meta, w), x, y);
    y += u * TYPE.meta * 1.4;
  }

  // ---- the waveform ----
  y += u * 0.045;
  const waveH = u * 0.30;
  const peaks = peakValues(comp.tracks);
  const bars = Math.max(24, Math.min(64, Math.round(w / (u * 0.022))));
  const bw = w / bars;
  ctx.fillStyle = tokens.brand;
  for (let i = 0; i < bars; i++) {
    const v = peaks.length ? peaks[Math.floor((i / bars) * peaks.length)] : 0.35;
    const h = Math.max(u * 0.008, waveH * Math.min(1, Math.max(0.04, v)));
    ctx.globalAlpha = 0.34 + 0.5 * Math.min(1, v);
    ctx.fillRect(x + i * bw, y + (waveH - h) / 2, Math.max(1, bw * 0.55), h);
  }
  ctx.globalAlpha = 1;
  y += waveH + u * 0.05;

  // THE AUTHOR'S CAPTION SITS UNDER THE WAVEFORM, above the index's rule —
  // chunk 5's contract, and for its reason: below the index it reads as a
  // third track. It was at the foot of the card until the two were put side
  // by side.
  if (comp.caption) {
    if (comp.caption.title) {
      setFont(ctx, tokens.display, u * TYPE.title, 640, 0);
      ctx.fillStyle = tokens.ink;
      ctx.fillText(fitLine(ctx, comp.caption.title.toUpperCase(), w), x, y);
      y += u * TYPE.title * 1.45;
    }
    if (comp.caption.tease) {
      setFont(ctx, tokens.meta, u * TYPE.meta, 400, u * TYPE.metaTrack);
      ctx.fillStyle = tokens.muted;
      ctx.fillText(fitLine(ctx, comp.caption.tease, w), x, y);
      y += u * TYPE.meta * 1.9;
    }
  }

  // The track index, where there is more than one thing playing.
  if (comp.tracks.length > 1) {
    setFont(ctx, tokens.meta, u * TYPE.meta, 400, u * TYPE.metaTrack);
    ctx.fillStyle = tokens.muted;
    const shown = comp.tracks.slice(0, 4);
    shown.forEach((t, i) => {
      ctx.fillText(fitLine(ctx, `${String(i + 1).padStart(2, '0')}  ${t.title || t.slug || ''}`, w), x, y);
      y += u * 0.062;
    });
    if (comp.tracks.length > shown.length) {
      ctx.fillText(`+${comp.tracks.length - shown.length} more`, x, y);
      y += u * 0.062;
    }
  }

}

// The pulse card. It has no share address of its own (nothing points at a state
// that expires), but it is a kind, and a painter that refused one kind would be
// a second registry — the thing §1.2 exists to stop.
function drawPulseCard(ctx, rect, comp, tokens) {
  const u = rect.w;
  const p = comp.pulse || {};
  // A pulse ALWAYS wears the atmosphere — `.wk-pulse` paints it in every state,
  // the default being the site's accent — so there is no plain branch here.
  const rgb = tokens.pulseRgb || tokens.accentRgb;
  drawAtmosphericBackground(ctx, rect, rgb, tokens, { veil: tokens.pulseVeil });
  const pad = u * TYPE.textPad;
  const x = rect.x + pad;
  const w = rect.w - pad * 2;

  drawKicker(ctx, x, rect.y + pad, comp.label, tokens, u, `rgb(${rgb})`);
  if (p.localTime) {
    setFont(ctx, tokens.meta, u * TYPE.kicker, 400, u * TYPE.kickerTrack);
    ctx.fillStyle = tokens.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.localTime, x + w, rect.y + pad + u * 0.018);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  // The same three-tier ladder the words tile uses — one vocabulary, both card
  // types (css/main.css says so where it defines them). The glyph scales with
  // the tier rather than having a ladder of its own.
  const statement = comp.tier === 'statement';
  const textSize = u * (TYPE.pulseText[comp.tier] || TYPE.pulseText.standard);
  const glyphSize = u * (TYPE.pulseGlyph[comp.tier] || TYPE.pulseGlyph.standard);
  const lines = p.text ? wrapLines(ctx, p.text, w, 5) : [];
  const blockH = (p.glyphs ? glyphSize * 1.5 : 0) + lines.length * textSize * 1.3;
  // .wk-p-center is centred in the card, not hung off the top.
  let y = Math.max(rect.y + rect.h * 0.28, rect.y + (rect.h - blockH) / 2);
  if (p.glyphs) {
    setFont(ctx, tokens.bodyFace, glyphSize, 400, 0);
    ctx.fillStyle = tokens.ink;
    ctx.fillText(fitLine(ctx, p.glyphs, w), x, y);
    y += glyphSize * 1.5;
  }
  if (lines.length) {
    setFont(ctx, statement ? tokens.display : tokens.bodyFace, textSize, statement ? 560 : 400, 0);
    ctx.fillStyle = statement ? tokens.ink : tokens.body;
    for (const line of wrapLines(ctx, p.text, w, 5)) {
      ctx.fillText(line, x, y);
      y += textSize * 1.3;
    }
  }
  if (p.footLeft || p.footRight) {
    setFont(ctx, tokens.meta, u * TYPE.tMeta, 400, u * TYPE.tMetaTrack);
    ctx.fillStyle = tokens.faint;
    const fy = rect.y + rect.h - pad - u * TYPE.tMeta;
    ctx.textAlign = 'left';
    if (p.footLeft) ctx.fillText(fitLine(ctx, p.footLeft, w * 0.5), x, fy);
    ctx.textAlign = 'right';
    if (p.footRight) ctx.fillText(fitLine(ctx, p.footRight, w * 0.5), x + w, fy);
    ctx.textAlign = 'left';
  }
}

// A track's stored waveform, as numbers. `peaks` is the registry's own compact
// string; anything unreadable draws the flat default rather than nothing, for
// the reason a broken image is worse than a plain one.
export function peakValues(tracks) {
  const t = (tracks || []).find((x) => x && x.peaks);
  if (!t) return [];
  const raw = String(t.peaks);
  const nums = raw.split(/[^\d.]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return [];
  // reduce, not Math.max(...nums): a spread pushes every sample onto the
  // argument stack, and a long waveform would blow it. The registry writes short
  // strings today; a helper that only works for short input is a trap for
  // whoever lengthens them.
  const max = nums.reduce((m, n) => (n > m ? n : m), 1);
  return nums.map((n) => n / max);
}

/** Draw one card face into `rect`. Dispatches on the composition's shape. */
export function drawCardFace(ctx, rect, comp, tokens, img) {
  const tk = tokens || FALLBACK_TOKENS;
  ctx.save();
  if (comp.shape === 'picture') drawPictureCard(ctx, rect, comp, tk, img);
  else if (comp.shape === 'audio') drawAudioCard(ctx, rect, comp, tk);
  else if (comp.shape === 'pulse') drawPulseCard(ctx, rect, comp, tk);
  else drawWordsCard(ctx, rect, comp, tk);
  // The card's own hairline, last, so nothing paints over it — the edge the
  // mounted card computed (a palette tints it, DAYLIGHT lifts it), else --line.
  ctx.strokeStyle = tk.cardLine || tk.line;
  ctx.lineWidth = Math.max(1, rect.w * 0.003);
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  ctx.restore();
}

// The wordmark. Two segments so the accent half carries the brand — BOTH the
// text and the colour out of the instance's own config, because a published
// image with either one hardcoded ships this instance's identity into every
// fork's link previews (the bug the old painter was fixed for).
function drawWordmark(ctx, at, tokens, u) {
  if (!at) return;
  const size = u * 0.034;
  setFont(ctx, tokens.meta, size, 400, size * 0.14);
  const stem = SITE_WORDMARK_STEM || SITE_NAME || '';
  const accent = SITE_WORDMARK_ACCENT || '';
  const wStem = ctx.measureText(stem).width;
  const wAccent = accent ? ctx.measureText(accent).width : 0;
  let x = at.x;
  if (at.align === 'center') x = at.x - (wStem + wAccent) / 2;
  else if (at.align === 'right') x = at.x - (wStem + wAccent);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = tokens.ink;
  ctx.fillText(stem, x, at.y);
  if (accent) {
    ctx.fillStyle = tokens.brand;
    ctx.fillText(accent, x + wStem, at.y);
  }
}

// The OG ground's right-hand column: what the card is, in one line of type,
// next to it. Not a second design — it is the card's own title and caption, set
// larger, because a 1.91:1 preview is read at a glance and at thumbnail size.
function drawOgAside(ctx, at, comp, tokens, W) {
  if (!at) return;
  const u = W * 0.5;
  let y = at.y;
  if (comp.label) {
    setFont(ctx, tokens.meta, u * 0.042, 400, u * 0.006);
    ctx.fillStyle = tokens.accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(comp.label).toUpperCase(), at.x, y);
    y += u * 0.085;
  }
  const headline = comp.title || comp.words || '';
  if (headline) {
    const size = u * 0.078;
    setFont(ctx, tokens.display, size, 640, 0);
    ctx.fillStyle = tokens.ink;
    for (const line of wrapLines(ctx, headline, at.w, 3)) {
      ctx.fillText(line, at.x, y);
      y += size * 1.2;
    }
  }
  const second = comp.meta || (comp.caption && comp.caption.tease) || '';
  if (second) {
    y += u * 0.024;
    setFont(ctx, tokens.meta, u * 0.042, 400, u * 0.003);
    ctx.fillStyle = tokens.muted;
    for (const line of wrapLines(ctx, second, at.w, 2)) {
      ctx.fillText(line, at.x, y);
      y += u * 0.062;
    }
  }
}

// The faces the card is set in have to be DECODED before the canvas draws with
// them, or the first paint silently falls back to a system font — the trap
// FocalModal's own ensureFont() existed to dodge, folded in here so every
// caller of the painter inherits it instead of remembering it.
export async function ensureShareFonts(tokens) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const tk = tokens || FALLBACK_TOKENS;
  try {
    await Promise.all([
      document.fonts.load(`640 40px ${tk.display}`),
      document.fonts.load(`400 26px ${tk.meta}`),
    ]);
    await document.fonts.ready;
  } catch { /* a face that will not load is not a reason to refuse the image */ }
}

/** The picture a composition needs, through the same-origin proxy so the
 *  canvas is never tainted. Resolves to null rather than rejecting: a card
 *  whose picture will not load still paints, with its well left as ground. */
export function loadCardImage(comp, width = 2048) {
  return new Promise((resolve) => {
    const m = comp && comp.media;
    if (!m || !m.filename || typeof Image === 'undefined') return resolve(null);
    const base = m.filename.replace(/\.[^.]+$/, '');
    const url = (w) => `/api/cdn/${m.folder}/${encodeURIComponent(base)}-${w}w.webp`;
    let fellBack = false;
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => {
      if (!fellBack) { fellBack = true; im.src = url(1024); return; }
      resolve(null);
    };
    im.src = url(width);
  });
}

/**
 * PAINT THE CARD.
 *
 * `item` is exactly what `RecentIndex.buildCard` takes — the same object the
 * homepage row is built from — so nothing has to be re-derived for a share
 * image. `ratio` is one of SHARE_RATIOS. `opts.tokens` is a palette from
 * readCardTokens (a mounted card); `opts.image` is a pre-loaded picture, for
 * callers that already have one decoded.
 *
 * `opts.focus` overrides the crop — and ONLY the crop. The framing modal is the
 * one caller that needs it: it is SETTING the point, so the preview has to show
 * a crop that is not on the record yet. Nothing else may pass it, because a
 * share image cropped differently from the card is the drift this painter
 * exists to end.
 *
 * Async, which the brief did not ask for: a card's picture has to be fetched
 * and decoded before it can be drawn, and a painter that returned a canvas
 * before its photograph arrived would hand back a grey rectangle.
 */
export async function paintCard(item, ratio, opts = {}) {
  const RI = (typeof window !== 'undefined' && window.RecentIndex) || null;
  if (!RI || typeof RI.cardComposition !== 'function') throw new Error('card engine not loaded');
  if (!SHARE_RATIOS[ratio]) throw new Error(`unknown share ratio: ${ratio}`);
  const comp = RI.cardComposition(item);
  if (opts.focus && comp.media) comp.media = { ...comp.media, focus: opts.focus };
  const geo = shareGeometry(ratio, cardAspect(comp));
  const tokens = opts.tokens || probeCardTokens(item, opts.tokenNode);
  // THE FACES AND THE PICTURE, TOGETHER. ensureShareFonts' own docstring said it
  // was folded in here "so every caller inherits it instead of remembering it"
  // — and then paintCard never called it, so only FocalModal (which happened to
  // call it itself) got decoded faces. Every other caller, chunk 8's share
  // sheet included, would have drawn the first card in a system fallback font
  // and had nothing to say so. Found by a code review; the exact doc-says-
  // code-doesn't drift §1.2 exists to catch.
  //
  // Concurrent, not sequential: they are independent waits and a share sheet
  // stamping three ratios should not pay for the faces three times over (the
  // browser's font cache makes the later calls free, but the ordering matters
  // for the first).
  const [, img] = await Promise.all([
    ensureShareFonts(tokens),
    opts.image !== undefined ? opts.image : loadCardImage(comp),
  ]);

  const cv = opts.canvas || document.createElement('canvas');
  cv.width = geo.W;
  cv.height = geo.H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = tokens.ground;
  ctx.fillRect(0, 0, geo.W, geo.H);
  drawCardFace(ctx, geo.card, comp, tokens, img);
  if (geo.text) drawOgAside(ctx, geo.text, comp, tokens, geo.W);
  if (geo.wordmark) drawWordmark(ctx, geo.wordmark, tokens, geo.W);
  return cv;
}

/**
 * The tokens for THIS card: buildCard's own element, mounted for one read.
 *
 * readCardTokens off the document root answers the page's palette — surface,
 * ink, accent — but not the card's: --pulse-rgb lives on a card that wears a
 * palette, --audio-rgb on an audio card, and the tinted edge and the inverted
 * veil are computed per card, per theme. So the painter asks the renderer for
 * the card (one renderer per kind — the same element the homepage would draw),
 * mounts it out of sight, reads every token off it, and takes it down again.
 * Nothing is enumerated: a hue the stylesheet moves, moves here the same day.
 *
 * `node` short-circuits it for a caller that already has the card mounted.
 */
export function probeCardTokens(item, node) {
  if (node) return readCardTokens(node);
  if (typeof document === 'undefined' || !document.body) return readCardTokens();
  const RI = (typeof window !== 'undefined' && window.RecentIndex) || null;
  if (!RI || typeof RI.buildCard !== 'function') return readCardTokens();
  let holder = null;
  try {
    const card = RI.buildCard(item);
    if (!card || !card.classList || !card.classList.contains('wk-card')) return readCardTokens();
    holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    // `card-face` is the console's frame for a mounted real card: the console
    // never loads main.css, so every card rule it needs — the palette hues, the
    // veils, DAYLIGHT's inversions — is restated under that class in
    // field-console.css (`.card-face .wk-card[data-state]`, …). A card mounted
    // outside it reads as if it wore no palette at all. On a public page the
    // class matches nothing and main.css applies to the card directly.
    holder.className = 'card-face';
    holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:300px;visibility:hidden;pointer-events:none';
    holder.appendChild(card);
    document.body.appendChild(holder);
    return readCardTokens(card);
  } catch {
    return readCardTokens();
  } finally {
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
  }
}

/** The painter's own view of a card, for callers that need it without a canvas
 *  (the share sheet's filenames, a test). Delegates — it does not restate. */
export function compositionOf(item) {
  const RI = (typeof window !== 'undefined' && window.RecentIndex) || null;
  return (RI && typeof RI.cardComposition === 'function') ? RI.cardComposition(item) : null;
}
