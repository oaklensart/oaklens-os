// OAKLENS Field Console — the bloom.
//
// Phase 2 of the lighting pass (K37 built phase 1: the ladder, the licence, the
// press). This is the half the ladder cannot do: CSS can put a halo INSIDE a
// control's own box, but it cannot pool light onto the chassis around it. A
// `box-shadow` glow is clipped by every ancestor with `overflow: hidden`, it
// cannot cross a stacking context, and it stops dead at the edge of the topbar.
// Real light does none of those things — so the wide, soft part of it is
// painted on one body-level canvas that sits over the whole console.
//
// ⚠️ THIS MODULE MAY NOT DECIDE WHAT GLOWS. That is a licence, not a style, and
// it is written down: `docs/starter-template/design-spec.md` §6.5 — light is
// for things that are DOING something, and selection is not liveness. A surface
// opts in with `data-lit="accent|ok|warn"` and this module finds it; nothing
// here names a surface, a view or an id, and adding one would make the bloom
// the fifth place the licence lives.
//
// Four things follow from the brief (`docs/next-session-brief.md` §0) and each
// one is load-bearing:
//
//   1. NO `mix-blend-mode: screen`. The bench uses it, and on a page this size
//      it forces the compositor to blend the whole document every paint — an
//      iPad cliff. `lighter` inside the emissive buffer gets the additive
//      accumulation where it is actually needed; the composite to screen is
//      ordinary source-over, which over a true-black ground is the same read.
//   2. COLOUR IS READ AT PAINT TIME, never tabled. `--lit-rgb` resolves through
//      the theme, the preset and the tone variant, so a table here would be six
//      copies of a value that already exists and would be wrong in DAYLIGHT, in
//      every preset but one, and in every fork. Same rule
//      `tests/theme-tokens.test.js` puts on card-paint.js, for the same reason.
//   3. EVENT-DRIVEN, NOT A LOOP. `docs/ideas/motion-language.md` allows one
//      heartbeat per page and the SYS lamp already spends it. So this repaints
//      on resize, scroll, theme change and `data-lit` change — and then stops.
//      Measured at zero `requestAnimationFrame` calls across two idle seconds,
//      which is why it needs no exemption and no battery governor.
//   4. THE BLOOM MUST NOT REDRAW THE BUTTON. One of the bench's four subtractive
//      findings. The canvas is ABOVE the console (z-index 310, over the tab bar,
//      under sheets), so a naive composite lays a blurred duplicate of every
//      emitter over the crisp original and the panel starts reading as an
//      illustration. Each emitter's own footprint is punched back out of the
//      finished frame; what reaches the screen is only the light AROUND it.
//
// A leaf: it imports nothing and is imported by nobody. init() calls
// lightingInit() once. See dev/console-module-plan.md.

// ---------------------------------------------------------------- the optics
//
// One emissive buffer at a quarter of CSS pixels, upscaled over the page. That
// is the whole pipeline, and the shape of it was decided by measurement rather
// than by the bench:
//
//   • THE SPREAD COMES FROM THE SHADOW, NOT FROM A BLUR CHAIN. The first draft
//     filled a flat rect and leaned on a mip chain to widen it. It does not:
//     upscaling is bilinear, so a source pixel's influence ends at its
//     neighbour's centre, and the pool died 30px out however the tiers were
//     weighted. A blur chain SOFTENS a falloff; it cannot invent one.
//   • A RADIAL GRADIENT WAS THE SECOND DRAFT AND IS WRONG OFF-SQUARE. Scaling
//     one circle into an oblong puts the emitter's edge at a different point
//     along the ramp per axis: the publish bar measured 0.18 above and 0.035 at
//     its sides — the same lamp, five times dimmer sideways.
//   • SO THE POOL IS THE SHAPE'S OWN SHADOW, cast in the emitter's colour at
//     zero offset. It is the only 2D-canvas primitive that spreads a fill the
//     same distance on every side of an arbitrary rounded rect. Measured 0.137
//     above and 0.133 beside, on the shape that was five times out.
//   • AND THE MIP CHAIN THEN EARNED NOTHING. With the shadow doing the
//     spreading, four weighted tiers measured slightly BRIGHTER near the
//     emitter and slightly SHORTER in the tail than the single buffer alone —
//     three extra canvases, a ping-pong downscale and four composites to make
//     the light a little more contrasty. Removed. This is the subtractive pass;
//     a technique that cannot show its work does not ship.
const EM_SCALE = 0.25;

// The alpha an emitter casts at its own edge, before --bloom-gain. Not a token:
// it is the painter's own unit, and the dial an author reaches for lives in CSS.
const EMIT_ALPHA = 0.85;

// How far the pool reaches past the emitter's edge, in CSS pixels: a floor plus
// a share of the emitter's short side, so a 32px button pools ~82px and the
// publish bar pools ~240px. Bigger lamps throw further; the energy spreads with
// them, so the big one is not brighter — measured 0.137 at the bar's rim
// against 0.125 at the button's.
const POOL_BASE = 56;
const POOL_SHARE = 0.8;

// How far the punch-out sits inside the emitter's box. A hair in, so the
// control's own edge keeps the contact halation that makes it sit IN the light
// rather than in a hole cut out of it.
const PUNCH_INSET = 1.5;

// The most gain anyone can ask for. See bloomGain(): a typo guard on a value
// that costs one full-canvas composite per unit.
const GAIN_MAX = 4;

// An emitter this far outside the viewport contributes nothing but a blurred
// fill. Generous enough that one just past the fold still spills into view,
// which is what tells you something is lit up there.
const CULL_MARGIN = 320;

let canvas = null;
let ctx = null;
let em = null;
let emx = null;
let dirty = false;
let queued = 0;
let sized = { w: 0, h: 0, dpr: 0 };
let ro = null;
let watched = new Set();   // the emitters the size observer is pointed at right now

/** Every element currently licensed to emit. The attribute IS the contract. */
function emitters() {
  return [...document.querySelectorAll('[data-lit]')];
}

/**
 * The emitter's colour, resolved through theme + preset + tone variant at the
 * moment of painting. `--lit-rgb` is a bare `r, g, b` triplet by construction
 * (see the ARMED / LIVE block in field-console.css), which is what lets the
 * same token feed an rgba() in CSS and a fillStyle here.
 */
function litRgb(el) {
  try {
    const raw = (getComputedStyle(el).getPropertyValue('--lit-rgb') || '').trim();
    // Three integers or nothing. A malformed value must not reach fillStyle,
    // where it is silently ignored and the previous colour paints instead.
    return /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(raw) ? raw : null;
  } catch { return null; }
}

/**
 * The master dial, read from the root at paint time for the same reason the
 * colour is. DAYLIGHT sets it to 0: on paper "lit" reads as LIFTED — a ring and
 * a contact shadow — and a glow pooling onto warm paper reads as a screen
 * artefact. That is one token, not a `[data-theme]` branch in here.
 */
function bloomGain() {
  try {
    const raw = (getComputedStyle(document.documentElement)
      .getPropertyValue('--bloom-gain') || '').trim();
    const n = parseFloat(raw);
    // The ceiling is a typo guard, not a design limit: gain is spent as whole
    // composite passes (see paint step 2), so a stray `--bloom-gain: 300`
    // would cost 300 full-canvas draws a frame.
    return Number.isFinite(n) ? Math.max(0, Math.min(GAIN_MAX, n)) : 0;
  } catch { return 0; }
}

function roundRect(g, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  // Safari < 16.4 has no roundRect. A square pool is a fine degradation; a
  // thrown TypeError in the paint path is not.
  if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, rad);
  else g.rect(x, y, w, h);
}

/** Size the canvas + buffer to the viewport. */
function resize() {
  const w = Math.max(1, window.innerWidth || 0);
  const h = Math.max(1, window.innerHeight || 0);
  // Capped: a 3× phone gains nothing on a surface that is one big blur, and it
  // is the device least able to pay for it.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (sized.w === w && sized.h === h && sized.dpr === dpr) return;
  sized = { w, h, dpr };

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  em.width = Math.max(1, Math.round(w * EM_SCALE));
  em.height = Math.max(1, Math.round(h * EM_SCALE));
}

/** One frame. Cheap enough to be called from a scroll handler; called from one. */
function paint() {
  if (!ctx || !emx) return;
  resize();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const gain = bloomGain();
  const lit = gain > 0 ? emitters() : [];
  // Re-point the size observer here rather than from the mutation callback:
  // `childList` on the whole body fires for every render in the console, and
  // a document-wide querySelectorAll per batch is a real cost on a grid of
  // several hundred frames. The frame already knows who is lit.
  //
  // ⚠️ Only the CHANGE in that set may touch the observer (2026-09-24). A
  // ResizeObserver delivers an initial notification for every `observe()` —
  // by spec, not by accident — so `disconnect()` + re-observe every paint
  // meant: paint → observe → "here is its size" → repaint → observe → … one
  // frame after another, for as long as anything was lit. Headless Chromium
  // measured 120 rAF callbacks in two idle seconds with one emitter and 0
  // with none — a 60fps loop hiding behind the promise of "event-driven",
  // running whenever work was waiting to publish, which is nearly always.
  observeSizes(lit);
  if (!lit.length) return;

  // Rects first: getBoundingClientRect forces layout, so read every one before
  // touching a canvas rather than interleaving reads and writes.
  const boxes = [];
  for (const el of lit) {
    const rgb = litRgb(el);
    if (!rgb) continue;
    const r = el.getBoundingClientRect();
    // A zero box is a control the breakpoint has hidden — the topbar publish
    // button under 1181px, the tab-bar one over it. Both carry the attribute at
    // once and only one is ever on screen.
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.bottom < -CULL_MARGIN || r.top > sized.h + CULL_MARGIN) continue;
    if (r.right < -CULL_MARGIN || r.left > sized.w + CULL_MARGIN) continue;
    boxes.push({ r, rgb, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 });
  }
  if (!boxes.length) return;

  // 1 — the emissive buffer. `lighter` is the whole reason for a separate
  //     buffer: two emitters near each other must ADD, the way two lamps do,
  //     not paint one over the other.
  emx.clearRect(0, 0, em.width, em.height);
  emx.globalCompositeOperation = 'lighter';
  for (const { r, rgb, radius } of boxes) {
    const reach = POOL_BASE + Math.min(r.width, r.height) * POOL_SHARE;
    emx.save();
    emx.shadowColor = `rgba(${rgb}, ${EMIT_ALPHA})`;
    emx.shadowBlur = reach * EM_SCALE;
    emx.shadowOffsetX = 0;
    emx.shadowOffsetY = 0;
    // The fill under the shadow is the CORE — the contact halation at the rim,
    // as bright as the thing making it. Step 3 takes it back off the control,
    // so what survives is the millimetre of light around the edge.
    emx.fillStyle = `rgba(${rgb}, ${EMIT_ALPHA})`;
    roundRect(emx, r.left * EM_SCALE, r.top * EM_SCALE,
      r.width * EM_SCALE, r.height * EM_SCALE, radius * EM_SCALE);
    emx.fill();
    emx.restore();
  }
  emx.globalCompositeOperation = 'source-over';

  // 2 — upscale onto the page, once per unit of gain.
  //
  // ⚠️ NOT `globalAlpha = gain`. The canvas spec CLAMPS globalAlpha to [0,1],
  // so that spelling made every value above 1 a silent no-op — the dial looked
  // like it worked and did nothing, which is the worst kind of knob. Gain is
  // spent as repeated composites instead: each pass adds what the last one left
  // room for, so N passes at alpha a resolve to 1-(1-a)^N. That lifts the faint
  // outer tail almost linearly while the core saturates, which is how a
  // brighter lamp actually reads — not a flat multiply that would just clip the
  // middle. At gain ≤ 1 this is one pass at `alpha = gain`: byte-identical to
  // what shipped.
  for (let left = gain; left > 0.004; left -= 1) {
    ctx.globalAlpha = Math.min(1, left);
    ctx.drawImage(em, 0, 0, canvas.width, canvas.height);
  }
  ctx.globalAlpha = 1;

  // 3 — punch the emitters back out. Without this the canvas lays a blurred
  //     copy of every lit control over the crisp one and the console reads as
  //     a picture of itself.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  const s = sized.dpr;
  for (const { r, radius } of boxes) {
    roundRect(ctx,
      (r.left + PUNCH_INSET) * s, (r.top + PUNCH_INSET) * s,
      Math.max(0, r.width - PUNCH_INSET * 2) * s,
      Math.max(0, r.height - PUNCH_INSET * 2) * s,
      Math.max(0, radius - PUNCH_INSET) * s);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Mark the frame stale. At most one paint per animation frame no matter how
 * many events land — which is what makes a scroll handler affordable — and the
 * request is dropped while the tab is hidden, where rAF does not run anyway.
 */
export function lightingRepaint() {
  dirty = true;
  if (queued) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  queued = raf(() => { queued = 0; if (dirty) { dirty = false; paint(); } }) || 1;
}

/**
 * Build the canvas and bind the four things that can move light, once.
 * Idempotent, and inert wherever a 2D context cannot be had — happy-dom returns
 * null from getContext, and a console that will not boot in the test
 * environment is a worse outcome than one with no bloom.
 */
export function lightingInit() {
  if (canvas || typeof document === 'undefined') return;

  const c = document.createElement('canvas');
  c.id = 'lighting-canvas';
  c.setAttribute('aria-hidden', 'true');
  let cx = null;
  let e = null;
  let ex = null;
  try {
    cx = c.getContext('2d');
    e = document.createElement('canvas');
    ex = e.getContext('2d');
  } catch { cx = null; }
  if (!cx || !ex) return;

  canvas = c; ctx = cx; em = e; emx = ex;
  document.body.appendChild(canvas);

  addEventListener('resize', lightingRepaint, { passive: true });
  // Capture, because the console scrolls inside .main and the rails inside
  // themselves — scroll does not bubble, but it does capture, so one listener
  // covers every scroller the console has and every one it grows.
  document.addEventListener('scroll', lightingRepaint, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // Clear the in-flight handle before asking for a frame. A rAF queued just
    // before the tab hid is PARKED, not cancelled — browsers resume it, so in
    // practice this is belt and braces; but if one were ever dropped instead,
    // `queued` would stay non-zero and every later repaint would return at the
    // coalescing guard. The bloom would simply stop, with nothing to see.
    queued = 0;
    lightingRepaint();
  });

  // The theme decides --bloom-gain and --lit-rgb both, and it changes by an
  // attribute write on <html> rather than an event.
  new MutationObserver(lightingRepaint)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // The licence itself. Anything anywhere gaining or losing data-lit is the
  // only signal this module takes from the rest of the console.
  // childList as well as the attribute: a surface that re-renders while one of
  // its children is lit (renderPublish() during a commit) replaces the element
  // rather than changing it, and the light would be left painted at the old
  // node's coordinates.
  new MutationObserver(lightingRepaint)
    .observe(document.body, {
      attributes: true, attributeFilter: ['data-lit'], subtree: true, childList: true,
    });

  // A lit surface that grows under its own content (the publish bar gains a log
  // as it commits) moves its own light, and neither scroll nor resize fires.
  if (typeof ResizeObserver === 'function') ro = new ResizeObserver(lightingRepaint);

  lightingRepaint();
}

/**
 * Re-point the size observer at the emitters this frame found — by DIFF, never
 * by disconnect-and-rebuild (see the note in paint()). A newly lit control
 * costs one initial notification and so one extra paint; a control lit since
 * the last frame costs nothing at all.
 */
function observeSizes(lit) {
  if (!ro) return;
  const next = new Set(lit);
  for (const el of watched) if (!next.has(el)) ro.unobserve(el);
  for (const el of next) if (!watched.has(el)) ro.observe(el);
  watched = next;
}

// Test seam: the paint is pure DOM + canvas and has no other way in.
export const _lighting = { emitters, litRgb, bloomGain, paint, EM_SCALE, EMIT_ALPHA, GAIN_MAX };
