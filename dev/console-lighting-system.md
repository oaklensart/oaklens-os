# The emissive layer — the Field Console's lighting system

**Status:** shipped 2026-09-25 (K40, then K40b the same day — the light went
UNDER the glass; K41 on 2026-09-26 — the seams are emitters, and the room has
haze; K41b the same day — the ignition sequence, a cold start once per
session; K42 on 2026-10-02 — the bays heat on hover and wake on arrival, the
frame actions are backlit caps, and a modal is a plane that lights the air;
K43 the same day — the emission ladder: every line in the console has a tier;
K44 on 2026-10-03 — backlit glass: a light behind every panel, card and field;
K45 on 2026-10-04 — light layers: content light scrolls with its content; K50 the same day — glass with no strokes, a perceptual thermal pair, eye adaptation, the membrane in device pixels; K59 on 2026-10-06 — the text classes: what a piece of type is decides whether it gives light, §5.17) · repo-only · the contract for everything that lights in the console. The launch-plan entry (K40) is the
narrative of *why*; this is *how it works* and *how to add to it*.

**In a sentence:** in the Darkroom every surface is a lamp at some level, the
level is one physical quantity — **heat** — that changes on thermal curves and
never by class toggle, the light a thing gives lands on its neighbours in
proportion to that level, and depth is attenuation rather than shadow.

---

## 0. Why there is a system, and why now

Everything the console shipped between K37 and K39 that the owner kept — the
help filament, the sidebar prism, the commit ignition, the gate's rod and its
pool — is **emissive**: a thing that is dark until it lights. Everything from
before it is **reflective**: room light falling on machined metal (the rim
highlights, the cast shadows, "deboss, don't glow"). Both were right for their
medium. The medium changed on 2026-09-14 when the ground went true black
(`--surface-0: #000000`, verified on an OLED phone): on a screen whose black
pixels are *off*, the reflective model describes an object that is not there.
You cannot cast a shadow on a pixel that emits nothing. A rim highlight at 4%
white on a 5px rod reads as "a thin white stroke pasted on" (the owner's exact
words in K39b), because it *is* a stroke — there is no room light for it to be.

The owner's brief for the new leaf (2026-09-25, with four references — a cyan
avionics HUD, a phone lighting a face in a dark room, the owner's own rolling-
buffer avionics mockup, and a scanned HUD texture): *a lightweight emissive
interface; think about physics and how light emits; a screen is a concentrated
brick of light — design around that; the console is a static interface, so
precompute; tasteful low-CPU animation for the tactile feel; a lighting system
like our others that we can build on, modify easily, and that isn't a monolith;
and depth, where it makes sense.* The rules that had governed lighting were
explicitly suspended for the session.

So this document is the system those rules become. It **absorbs** the licence
(design-spec §6.5) rather than repealing it: the four licensed states and the
one licensed selection are the *lit* and *hot* rungs of one ladder, and
"selection is not liveness" becomes "selection is lit, not hot". The phone
photo is the whole argument. A screen in a dark room is a light source, and it
is bright *because the room is dark*: sparsity is what makes emission legible.

---

## 1. The model — two rooms, one token surface

### 1a. The light is under the glass (K40b)

The owner's second read of K40 gave the system its physical centre: *the source
of light is always coming from underneath the glass and out into the world …
nothing should feel pasted on … the frosted look can provide that sense of
light and depth … the interface on top with changing light underneath
corresponding to user actions.*

K38 put the bloom canvas **over** the console (z-index 310) so light could be
seen pooling around a button in a bar that paints its own ground. That is
light painted *on* a surface, which is exactly what a decal is, and it needed a
punch-out so the canvas would not lay a blurred copy over every control. K40b
turns the stack the right way up:

| layer | what | z |
|---|---|---|
| the ground | `<html>` paints `--bg`; `<body>` paints nothing | root |
| **the light** | `#lighting-canvas` | **-1** — above the ground, below every in-flow box |
| glass | `.topbar`, `.sidebar` (`--frost-0` since K41d/f — black glass, the light bleeding through), `.publish-action` (`--frost-1`), `.dropzone` (`--frost-0`), `.toast` (`--frost-2`), `.tabbar` (`--glass`) | in flow / their own |
| opaque | content cards, images, `--surface-1..3` panels | in flow |
| sheets, modals | unchanged | 460, 500 |

Rules that fall out of it:

- **A surface either transmits or it casts.** Chrome and bays are frosted
  glass and the light comes up through them, diffused. Content cards are
  opaque and cast their shape onto the pool around them. That contrast *is*
  the depth: a lit thing under glass reads as inside the object.
- **Frost is transmission, not blur.** The light is already blurred (it is a
  pool), so the glass only has to let it through; no `backdrop-filter` is
  spent on it. The tab bar keeps the blur it already had for content
  scrolling beneath it.
- **Each frost resolves to the tier it replaced when nothing is lit.**
  `--frost-1: rgba(20,20,20,.6)` over black is `#0c0c0c`, which is
  `--surface-1`; a dark console with nothing lit is byte-identical at rest.
  On the Desk nothing is beneath the paper, so the frost *is* the paper tier.
- **No punch-out.** A translucent control over its own pool is the backlit
  cap — the annunciator the mockups wanted, by physics rather than a skin.
- **Emission falls with area.** With the bay itself able to emit, the engine
  scales a big emitter's level by `sqrt(3200 / area)`, floored at 0.15, so a
  panel glows under its glass and never washes.
- **Changing light under the glass answers actions.** A commit heats the
  topbar cluster; a drop in flight heats the bay; a notification heats its
  corner. Any surface can join by carrying the attribute; the glass above it
  decides how it is seen.

| | **The Darkroom** (STUDIO) | **The Desk** (DAYLIGHT) |
|---|---|---|
| the medium | an OLED in a dark room: black is off, everything else emits | paper under a lamp: everything reflects, nothing emits |
| what "lit" means | the thing gives light, and the light lands around it | the thing is *lifted* — a ring and a contact shadow |
| depth | attenuation: farther is dimmer and greyer | the cast shadow, on the light ladder |
| the pool (`js/console/lighting.js`) | on (`--bloom-gain: 2`) | off (`--bloom-gain: 0`) |
| the strike | on (`--lit-strike`) | off (a glow behind ink is a print artefact) |

One token surface serves both. Nothing in the engine or the primitives branches
on the theme; the theme sets tokens and the layer reads them at paint time.
That is the property the whole system rests on, and `tests/console-lighting.test.js`
pins it ("has no `[data-theme]` branch of its own").

The reflective half — `--light-x/y`, `--edge-up/in`, `--shadow-1/2/3` — is
**not retired**. Recesses (`--edge-in`) are the one depth cue a black ground can
show (the bench's first finding: *depth is the inset, not the gradient*), and
the machined edges still read on the Desk. What this pass adds is the emissive
half that was missing, and what it stops doing is *adding* reflective cues to
emissive surfaces.

---

## 2. Heat — one quantity, one attribute, five rungs

| rung | what it is | how it is written | pools onto the canvas? |
|---|---|---|---|
| **off** | the ground; pixels off | nothing | — |
| **cold** | a thing that *can* light, showing that it has not — cold iron | `--lit-cold-0/1/2` in the surface's own CSS | no |
| **warm** | under a hand: hover, focus, a drag passing over | `:hover` / `:focus-visible` in CSS, or the parent's `:hover` for a rod | **never** — warm is in the box (one exception: a pointer over an ingestion bay heats it, §5.0) |
| **lit** | a thing that is *on*: where you are, what is waiting | `data-lit="accent\|ok\|warn"` | yes, at level 1 |
| **hot** | a thing *in flight*: a commit, an ingest | `data-heat="hot"` (resting half: `data-heat=""`) | yes, at level 1 (scaled by area), plus the ignition's own filter bloom |

Rules that fall out of it:

- **The attribute goes on the thing that emits.** A button, a bead, a toast —
  or a bay, now that the area law exists: a panel *may* emit when it is the
  event (a drop in flight), and it emits softly because the engine scales
  its level by its area. What stays wrong is lighting a panel to say
  something *inside* it is busy — that is the wash K38c took out.
- **Level is physical, so it moves on curves.** `--arm-heat` (1.5s, fast) up
  and `--arm-cool` (2.6s, slow) down — the coil's asymmetry, one pair for the
  whole console, read off the emitter by both CSS and the engine so the box
  glow and the pool heat *together*. A missing token is *no journey*, never a
  journey of the engine's own.
- **`data-heat` is the one word.** Until K40 it was `data-armed` (chrome),
  `data-hot`/`data-warm` (help's private marks) and the gate's own. Chrome and
  the new consumers are on `data-heat`; help's marks and the gate keep their
  private spellings for now (see §8).
- **Emission is inversely proportional to area.** A hot *point* on black is
  comfortable; a hot *panel* is glare. K38c found this by eye ("gain 3 right
  for the button, too much for the panel"); the engine already spreads a big
  emitter's energy so it is no brighter at its rim, and the licence for *hot*
  is small emitters only.
- **Sparsity is the medium.** The phone in the dark is bright because the room
  is dark. *Hot* is rare by construction (in flight only); *lit* is bounded
  (where you are, what is pending); everything else is cold or off.
- **Selection is lit — on the legend (K40b, owner's call).** The current view,
  the current tab and the filter that is on carry `--lit-legend`, a low steady
  text glow. Never a halo, never a pool; the canvas does not see it.
- **Boxes are cold; the long rules are seams (K40c → K40d).** K40c tinted
  every line tier 16% toward the accent and the owner's read was exact:
  *"your lines read as strokes … a regression."* A stroke is one colour along
  its whole length. A **seam of light is fed from an edge and attenuates as it
  travels** (the reference's gold lines are brightest where they enter the
  panel), and it blooms a little either side. So: `--ember` is back to a
  whisper (6% Darkroom, 4% Desk) on the three line tiers, which every box
  border derives from — an outline is not a light guide — and the long rules
  carry `--seam`, a 1px gradient fed from the console's **left edge** (where
  the sidebar, the brand mark and the current view already are), with
  `--seam-glow` on the standalone ones. Consumers: the view header and the
  stage rule (`::after`, so the halo is the line's and not the box's), the
  topbar's lower edge and the sidebar's right edge (`border-image`, which
  paints on the border area and does not scroll), the nav divider, and the
  date leaders (the seam through a dot mask). On paper a seam is flat ink and
  casts nothing.
- **Where you are is a resting light (K40d).** The current view's nav row
  carries `data-lit` (set by the router on every navigation, and once at boot by `init.js`, since the first view comes from the markup), keeps its own clothes, and turns
  its lamp down with **`--lit-level: 0.3`** — a per-surface dial the engine
  multiplies in at paint time, 0..1, default 1. With the area law that is a
  soft pool under the sidebar glass around the row: the console's one
  always-on lamp besides the SYS lamp, and the reason a still console no
  longer reads as unlit. Nav rows only; a lit tab cell means "pending".
- **A toast is not a coil.** The curves are read off the emitter, so a
  surface whose life is short declares short ones: `.toast` heats in 200ms
  and cools in 280ms, and its exit eases over the same span. The first cut
  cooled a 300ms toast on the 2.6s pair, painted from its last box — a glow
  lingering where the toast had been.
- **The seams are emitters, and the room has haze (K41).** The owner's
  emissive-seams mockup (`docs/ideas/emissive-seams-mockup.html`, 2026-09-26)
  asked for two things K40d's seams did not do: a seam whose light *leaves*
  the line and pools on the ground either side — "pure red, zero white lines"
  — and a **volumetric haze**, the cumulative light of every seam filling the
  OLED black, *the phone as a brick of light*, with a dial from void to brick.
  The mockup painted the haze by hand, a dozen radial gradients placed where
  its seams happened to be. Here it is physics: a seam is a **third licence**,
  `data-seam`, on the element whose *edge* is the seam (`top|right|bottom|
  left`), or on a rule that *is* the line (no value), or `box` for a bay's
  perimeter; the engine emits from the **strip** — a line source, never the
  panel — and every emitter, seam or lamp, casts a second, far, faint field
  whose **sum is the haze**. So the haze follows the seams wherever a view
  puts them, adds where two meet, and thins to true black between them. A
  seam is *lit* at rest by construction — the console's structure is a light
  guide — so it is not a new rung; it keeps a **level of its own** (a bay is
  a seam *and* goes hot, and its fill must still heat from dark). The core is
  the stylesheet's (`--seam`, now alphas of `--lit-rgb` end to end, fed from
  the left or top and dissolving at the far end); the tight halation is
  `--seam-glow` and, on a panel whose edge is the seam, the directional pair
  `--seam-glow-b/-t/-r` (a border-image cannot bloom); the pool and the haze
  are the canvas's. Two dials: **`--seam-level`** (0..1, the seam's
  brightness — core, halation and canvas strips all multiply it in) and
  **`--haze-gain`** (0..3, the room's, *squared* by the engine so the low end
  is quiet: 0 the void, 1.5 the shipped room, 3 the brick). Organic by
  construction, per the owner's read of the first calibration ("lighting can
  be organic, with some OLED black seepage"): a strip's fill attenuates along
  its run like the core, so its pool and haze are densest where the light
  enters, and the haze's reach is deliberately short of the mockup's, because
  at σ ≈ 100px a dozen fields summed to one flat wash. Measured at the
  shipped dials: 0.02 on the open ground, 0.21 at the top of the sidebar's
  spine falling to 0.035 at its foot, 0.02 on the bay's floor inside a rim at
  0.18; at 3, 0.30 on the ground and 0.58 at the spine.
- **Light leaves a panel, and the sidebar is the primary source (K41d).**
  The owner's read of K41c live: *"the left bar is a problem … it looks a
  little too web … the left bar could act as the primary source of light that
  directs from left to right."* It was the topbar's grey glass (`--frost-1`)
  against a true-black main, with a symmetric glow at its edge — a panel with
  a border. Two physical corrections. **An edge seam casts its haze outward:**
  the fattened source now sits on the open side of the line (a housing does
  not pool light back into itself), so the sidebar's edge throws right, the
  topbar's down, the tab bar's up; a rule that is the line still casts both
  ways; the pool (the tight halo) stays symmetric. **The sidebar is the
  darkest glass and the brightest lamp:** `--frost-0` so it melts into the
  ground, `--seam-level: 1` on its edge, and `--haze-boost: 2.4` — a per-host
  multiplier the engine applies to the haze alone (`hazeBoost()`, ceiling 4,
  default 1), the one token that says "primary source". The room is lit from
  the left and falls off to the right. `--haze-gain` 1.8 → 2.1 with it.
- **The ground is a substrate, and it shows only where light lands (K41e).**
  The owner's second mockup added a "nano-tech light-reactive substrate": a
  micro-perforated membrane over the whole document, `mix-blend-mode: screen`,
  tinted in the accent. The instinct is right — a black void has no depth; a
  black *surface* does — and the mockup's mechanics are the two things this
  system refuses: a whole-document blend (the compositor cliff) and a uniform
  tint over text and cards (wallpaper). So the membrane is what the light
  falls *on*: the engine bakes a pore tile once (6px pitch, staggered pores,
  rotated 18°, at the device ratio) and multiplies it into the composited
  light's alpha with `destination-in` — pores keep the light, the threads
  between them pass 1 − gain × 0.7 of it, and the black where nothing lands
  is untouched. The texture appears beside the seams and fades with the
  haze, under the glass like everything else, and that gradient of grain is
  the depth. At full resolution (not the quarter buffer, where a 6px pitch
  is a smear). `--substrate-gain` (0..1, 0.55 shipped) is the dial; 0
  removes it. **K78:** every canvas carries it as a CSS mask (the layers'
  periodic tile, `substrateTileURL()`), laid by the compositor. On the fixed
  canvas it was a pattern filled over the whole canvas on each repaint, and
  WebKit fills a pattern tile by tile on the CPU: about 100,000 tiles at 2×,
  and every slow frame of Safari's cold start (42 ms → 17 ms without it).
- **The console has a cold start (K41b).** The owner, after K41: *"an
  ignition sequence for the first load of the console that includes the
  organic breathing … a restrained rhythm and the interface elements glowing
  hot and cooling down … paying attention to the physics … and then we keep
  what we have already and the interface in practice is still just the SYS
  lamp."* Exactly the licensed shape: boot is an *event*, so its motion is
  bounded, and afterwards the one heartbeat holds. The physics is a light
  guide fed at the console's corner: the seams are dark; light enters at the
  top-left (the brand mark, the SYS lamp) and reaches each seam a little
  later the farther it sits from that corner; every filament overshoots
  **hot** and settles to its resting level on the console's own pair of
  curves; the bay's floor takes **two damped breaths** after its rim lights;
  then the console is still. **One dial does all of it:** `--ignite`, a
  registered `<number>` (so it interpolates and the engine can read it) that
  every seam host multiplies into its core, its halation (squared — a bloom
  overshoots more than its wire) and, through the engine, its pool and haze.
  That required the seam's *derived* tokens to move from `:root` onto
  `[data-seam]` — a custom property is substituted where it is declared, and
  the ignition is per host. `js/console/chrome.js` `igniteConsole()` writes
  each visible host's `--ignite-at` from its distance to the corner (a share
  of the viewport, so a phone fills in the same time as a desktop), marks
  `<html data-ignition>`, and clears both after `IGNITE_HOLD_MS`; hosts that
  appear later ignite on connection while the bus is live. The engine's only
  part is to keep its frames while the root says the ignition is running,
  so the pools follow the cores, and to park when the attribute comes off.
  It does not run under reduced motion, where `@property` is missing (an
  unregistered custom property snaps at the midpoint — the sequence would be
  a blink), in a hidden tab, or twice in a session (a reload mid-work comes
  back lit and still: the instrument was already on). On paper the seam is a
  printed rule and nothing ignites.

---

## 3. Depth — attenuation, not shadow

On a true-black ground nothing casts a shadow. What tells the eye that a lit
thing sits *in front of* the panel its light lands on is that the light
**cools with distance**: pure hue at the rim, sinking toward the ground in the
tail. The analogs ring does exactly this for its far side (toward a deep
desaturated red rather than plain black), and the owner's HUD reference does
it with rings: the near one bright and crisp, the far ones dimmer, thinner,
greyer.

Where depth already lives, under this reading:

| cue | what it is | the ladder it is on |
|---|---|---|
| surfaces | distance from the viewer: ground (off, farthest) → cards → wells → raised chips | `--surface-0..3` |
| emission | cold iron is the far/dim end of the same light that is white at its centre | `--lit-cold-0/1/2` → `rgb(var(--lit-rgb))` → `--lit-hot` |
| the pool | two shadows: the near field in the emitter's colour, the far field in that colour dimmed 40% and pulled 35% toward its own luminance | `lighting.js` `sprite()` — arithmetic on `--lit-rgb`, never a second colour |
| a rod's ends | the core dissolves to transparent over its first and last eighth, the way light leaves a fibre | `.lm-rod::before/::after` gradients |
| the recess | a lit thing set *into* the panel, the rim overhanging | `--edge-in` |

The rule for new work: **if you want something to read as farther away, give
it less light and less of its hue. Do not give it a shadow.**

---

## 4. The engine — `js/console/lighting.js`

One body-level `<canvas>` (z-index 310: over the tab bar, under sheets and
modals), one quarter-scale emissive buffer, no `mix-blend-mode`. A leaf module:
imports nothing, imported by nobody, names no surface. What K40 changed:

1. **Levels.** Every emitter has a level 0..1. A newly licensed emitter starts
   cold and heats on `--arm-heat`; one that loses its licence **cools in place**
   on `--arm-cool` and is forgotten once dark; one that leaves the DOM is
   dropped at once. Re-lighting mid-cool heats from where it is. The pool is
   drawn at the level.
2. **Bounded, not a loop.** A frame is requested only while a level is moving,
   in exactly one place, behind the in-flight flag. When every level rests the
   engine parks and a static console costs zero frames — K38's promise, and
   K39e's repair, now driven by a test with its own clock.
3. **The pool is baked once and replayed.** The shape's shadow is cast into a
   sprite the first time a shape+colour is seen (the analogs `makeGlow`
   pattern) and drawn from then on at `globalAlpha = level`. Measured per frame
   in headless Chromium, quarter-scale buffer:

   | emitters | shadowBlur per frame (before) | baked sprite (now) |
   |---|---|---|
   | 1 | 0.057 ms | 0.014 ms |
   | 4 | 0.087 ms | 0.028 ms |
   | 12 | 0.152 ms | 0.041 ms |
   | 36 | 0.381 ms | 0.067 ms |

   The bake is 0.3 ms once per shape. Honest read: at the console's one-to-six
   emitters both are noise. It ships because the frame cost is now *flat* while
   a level animates, and because the depth tint (§3) is a second fill per
   *bake* instead of per *frame*. The cache is capped at 32 shapes.
4. **The dither.** A quarter-scale ramp upscaled bilinearly bands on an OLED
   (every 1/255 step is a contour on a dark red). A gray-centred noise tile,
   baked once, is blitted `source-atop` into the buffer — onto the pool only,
   never onto the black ground — at 6%, the analogs LEAN amplitude. The offset
   moves per paint, so the grain is temporal while a level animates and holds
   still while the engine is parked.
5. **Reduced motion.** Levels jump to their target; the state, not the journey.
6. **Seams are strips (K41).** `[data-seam]` joins the licence selector. The
   value names the edge; `seamStrips()` turns the host's box into one strip
   (or four, for `box`) `SEAM_SRC` (4px — one buffer pixel; a 1px line has no
   energy at a quarter scale) thick, centred on the line the stylesheet
   draws. Seams live in a **second thermal map** with the same reconcile, so
   an element that is a seam *and* lit or hot has two levels. A strip's pool
   is drawn at `SEAM_POOL` (0.22) of its level — a filament's halo is a
   fraction of a lamp's; at 1.0 the line read as a neon tube — at
   `--seam-level`, with no area law and no radius. The strip's fill is a
   gradient from full at the fed end (left, or top) to `SEAM_FAR` (0.4), and
   the shadow follows the fill. **The fill itself is never in the sprite
   (2026-10-01):** a strip is one buffer pixel, and a hard pixel drawn at a
   fractional position changes shape with the fraction. As a rule scrolled,
   the canvas's copy of it pulsed 21% every 4 CSS px, which reads as a strobe
   on every horizontal seam. So the fill is drawn a canvas-height away and only
   its shadows land, the haze's trick. **Anything the canvas paints must be
   softer than a buffer pixel; the line is the stylesheet's.**
   (`docs/maintenance/2026-10-01-seams-strobe-on-scroll.md`)
7. **The haze (K41).** A second sprite per shape, `hazeSprite()`: the source
   fattened by `HAZE_SPREAD` (36px) on every side — a line cannot feed a
   field — and blurred by `HAZE_REACH` (120px; σ 60), drawn a canvas-height
   away with its shadow offset back, so *only the shadow* lands in the sprite
   and no slab does. Baked at `HAZE_ALPHA` (0.32, the ceiling's alpha) in the
   far tone and drawn at `level × (gain / HAZE_MAX)²`, `--haze-gain` read off
   the root at paint time like the gain. The sprite's margin is three σ of
   the blur (`HAZE_MARGIN`, 216px): at one blur the tail clipped at 13% and
   every field ended in a faint hard edge. `CULL_MARGIN` covers it, so a seam
   below the fold still fills the bottom of the room. The cache cap grew to
   48 for the second sprite per shape.

What did **not** change, because it was measured right the first time: the
spread is the shape's own shadow (a flat fill cannot pool; a radial gradient is
five times dimmer along an oblong's long axis); the mip chain earned nothing
and stays removed; the punch-out takes every emitter's footprint back out of
the frame so the canvas never redraws the control; gain is spent as whole
composite passes because `globalAlpha` clamps to 1.

---

## 5. The primitives

### 5.0 The ingestion bay — the bay is the event (K40b)

The first cut ran a rod along the bay's top edge; the owner's read was that it
felt crow-barred in, against the mockup's bay that reads as *an event*. So the
bay is now frosted glass (`--frost-0`) over the light and is itself the
emitter: `heat()` on drag-over brings the pool up under the glass (soft, by the
area law) and past the rim onto the ground, the rim lights from the inside
(inset shadows, both halves declared), and the chevrons and the legend glow on
`--lit-strike`. Cold at rest is a dark recess.

**Hover is the fade-up too, and a touch screen wakes it (2026-10-02, owner's
call).** The drag-over light was the bay's best moment and a mouse never saw
it, so a pointer over a bay `heat()`s it on the same coil — the one place warm
is allowed to pool, because a pointer over a drop target is a drop about to
happen. A touch screen has no hover, so the bays light themselves on
**arrival**: every time a view with a bay comes up, `wakeBays()` heats each
visible bay after `BAY_WAKE_AT_MS` (140), holds it `BAY_WAKE_HOLD_MS` (1500 —
exactly `--arm-heat`, so the rise crests as the cool begins, no plateau), and
lets it cool on `--arm-cool`. A second bay in the same view follows the first
by `BAY_WAKE_STEP_MS`. Leaving a view puts its bays out at once (they are
`display:none` by then), so every arrival lights from dark. Drag, hover and
wake share one cool timer per bay (`js/console/chrome.js`, "THE BAYS").
Bounded — one event per arrival, still once it has cooled — and off under
reduced motion, while the cold start runs (it lights the bays itself), and
wherever the pointer can hover. Boot wakes the first view when the cold start
did not run. Touch is excluded from the hover path: a tap opens the picker.

**The FN cover slot is a bay too, while it is empty.** It was a dashed band
— a stroke. It now carries `data-seam="box"` and the bay's three states at
its own scale; `fn-editor.js` takes the attribute off when a picture fills the
slot (a photograph is opaque, not glass) and puts it back when it clears, so
neither hover nor the wake lights a cover.

### 5.1 The filament — `.lm-rod`

A glass rod in a channel, stated once. The anatomy the help mark, the sidebar
bead and the gate's rail each built by hand. ⚠️ No console surface carries one
since K40b took it out of the bays; it stays as the migration target for the
two hand-built rods.

```html
<div class="dropzone" id="…">
  <i class="lm-rod" aria-hidden="true"></i>
  …
</div>
```

Three layers in one element: the element is the **channel** (a groove on the
light ladder, `--edge-groove`); `::before` is the **cold core** (cold iron, ends dissolving);
`::after` is the **hot core** with its three bloom tiers (core / mid / wash at a
rod's scale — the same three the help rod wears), and it is *opacity* that
heats, because a gradient does not interpolate. Warm is the parent's `:hover`
(CSS only). Hot is `data-heat="hot"` on the rod itself, so it inherits the
ignition's filter bloom from the generic `[data-heat]` rules and the canvas
pools around its own thin box. A host that needs the rod hidden at a compact
size hides it (`.compose-photo .dropzone > .lm-rod { display: none }`).

### 5.2 The strike — the release on every button

The press travels 1.5px on `--press-travel` (K37). The **strike** is the
release: the legend flashes to the emitter's light in the 60ms of the press and
settles over `--lit-settle` (480ms) on the way back up. A backlit legend has
persistence; the housing does not, so only the `text-shadow` carries the settle
and the edge snaps back on its own timing. On a touch screen this is the one
channel besides travel that says "that registered".

Pure CSS, no keyframe, no JS: the asymmetry is transition timing. Both halves
are declared (`--lit-strike-off` is a zero shadow, not `none`) so the lists
match and the flash interpolates — the ignition's own filter-list trap, avoided
the same way. Buttons only (`.btn`, `.publish-btn`, `.settings-btn`, `.nav-btn`,
`.tab-btn`, `.icon-btn`, `.frame-action`): a card's caption has no phosphor
behind it. A new button class adopts it by appending
`text-shadow var(--lit-settle) var(--ease-out)` to its transition list and
joining the two selector lists in the `4c-i` block.

### 5.3 The ignition — `[data-heat]` / `[data-heat="hot"]`

Unchanged in mechanics from K38c, renamed. The resting half declares every
filter function at its no-op value; the hot half is `brightness(1.3)
saturate(1.15)` and two drop-shadows on `--accent-rgb`. `js/console/chrome.js`
`heat(els, on, timer)` is the one way to write it: resting → the resting style
computed (a computed-filter read of each control since K56, not a page layout)
→ hot on the way up; resting → release after `ARM_COOL_MS` on the way down;
idempotent while hot (a `dragover` fires continuously). `setCommitArmed()`, the
cold start's top row and the bays all go through it.

**A floating key keeps the coil's curves (K56).** From K46 to K56 the glow
snapped: the keys' own transition lists (`.btn`, `.publish-btn`, and the top
row's `.topbar :is(.settings-btn, .sidebar-toggle)`) outranked the
`[data-heat]` lists, and none named `filter`. While a key carries the
attribute, `:is(.btn, .publish-btn, .settings-btn, .sidebar-toggle)[data-heat]
[data-heat]` restates the list as the coil's (filter, colour, border,
background on `--arm-heat` / `--arm-cool`) plus the key's own. The doubled
attribute outweighs the hover lists, because a hand is on PUBLISH when it is
pressed. Reduced motion turns it off with a rule of the same weight.

### 5.4 Notifications — a toast is light under the corner (K40b)

`showToast()` marks a toast `data-lit="ok|warn|accent"` for success, warn and
error (info carries no light: the console telling you something went right or
wrong is *doing something*; a plain note is not), the toast is `--frost-2`
glass, and the attribute comes off as the toast starts to fade so the light
cools while the toast leaves. The engine keeps cooling an emitter that leaves
the DOM mid-cool from its last box, for exactly this case.

### 5.5 The seam — `data-seam` (K41)

Not a class: the seam is wherever the stylesheet already draws one, and the
attribute tells the engine which edge. Consumers, all in `dev/field-console.html`
except the leader:

| host | attribute | the core | the halation |
|---|---|---|---|
| ~~`.topbar`~~ | none since K44b — there is no bar; its controls float over their own small backlights | — | — |
| `.sidebar` | `data-seam="box"` + `data-backlit` since K44b (it was `right`) | `border-color: var(--seam-rim)` (transparent since K50), rounded, inset from the window | `--glass-edge` |
| `.tabbar` | `data-seam="top"` | none since K50 (the engine's strip only) | — |
| ~~`.sidebar-foot`~~, ~~`.nav-divider`~~, ~~`.view-header` / `.stage-section`~~, ~~`.buffer-day-hdr .dots`~~ | none since K50 — no line runs along the interface; each is a gap of the same height | — | — |
| `.dropzone` | `data-seam="box"` | a transparent border; `--seam-level` 0.7 / 0.85 warm / 1 hot | `--glass-edge`, in all three heat states |

The dial is `--seam-level`, inherited from `:root`; a host that wants a quieter
seam sets it on itself. `tests/console-emissive.test.js` derives, never counts:
every `.dropzone`, `.view-header` and `.stage-section` in the markup must carry
its attribute.

### 5.6 The ignition — `data-ignition` (K41b; one dial since K64)

**K64 (2026-10-06):** the owner asked for "a simple, smooth, ramp/heat up from
oled black from the background light sources, and rubber banding back down to
its resting state." The sweep from the fed corner (each seam delayed by its
distance) and the bay's two breaths are gone. The whole room comes up on one
curve, and the earlier design below this table is history.

| piece | where | what |
|---|---|---|
| the curve (K78) | `js/console/chrome.js` `IGNITE_CURVE`, `igniteLevel(t)` | 0 (OLED black) → 1.16 at the end of the heat (`--arm-heat`'s 1.5s, on `--ease-heat`) → 0.95 → 1 on `--ease-cool`, read off the root (`easeToken`); 3s (`IGNITE_DUR_MS`) |
| the clock (K77, K78) | `igniteConsole()`'s frame loop, `ignitionTime()`, `ignitionLevel()` | each frame adds the time since the last; a gap over `IGNITE_STALL_MS` (100ms) is a stall and counts as one frame, so a stall freezes the sequence and a slow page keeps its time |
| the floor (K78) | `.room-floor`, a layer over the pane's grid cell | its gradient drawn at the crest (`--floor-crest` 1.16), its opacity `level / crest`, written by the clock: the compositor's |
| the engine | `lighting.js` `roomIgnite()` | the level, handed in by init (`lightingInit({ room })`), once a frame (`room`); the canvases' opacity × `min(1, room)` and nothing else: the light is drawn once, at rest, and nothing is redrawn for the room (K78) |
| the orchestrator | `js/console/chrome.js` `igniteConsole()` | the gates (once a session, reduced motion, `@property`, a hidden tab); the hold (`IGNITE_HOLD_MS` 3200 ≥ `IGNITE_DUR_MS` 3000) |
| the instrument row (K41c) | `igniteConsole()` → `heat()` | at the crest (`IGNITE_ROW_AT_MS` 1500) the top row's visible keys go hot together, hold `IGNITE_ROW_HOT_MS`, and cool on `--arm-cool`; the SYS lamp is never in the row |
| the tests | `tests/console-ignition-sequence.test.js` | the curve and its pair, the floor's layer, the clock (stall and slow page), the gates, the hold, the row, the engine's read |

**K78 (2026-10-06, real Safari through safaridriver):** until K78 the dial was
a registered number animated on the root (and `--floor` on `.main`), read by
the engine with `getComputedStyle`; the seams' pools took it whole and the
engine redrew every canvas through the cold start. Safari drew the ignition at
67 ms a frame (Brave 16.7), stretched to 6 s by K77's 34 ms step cap. Measured
one cause at a time: the root's animation restyled the page; each canvas
opacity write repainted everything stacked with the canvas (WebKit did not
composite it: the canvases are `will-change: opacity` now); and every repaint
of the fixed canvas filled the membrane's pattern at full resolution. After:
Safari 17 ms a frame, 189–191 frames in 3.5 s, the curve's shape unchanged on
video.

### 5.7 Already in the family, unchanged

The **SYS lamp** (an SMD LED; owns the page's one heartbeat), the **progress
rail**, the **sidebar coupler** (a cold bead per view, the current view's a lit
prism — the one licensed selection), the **help filament** (§ HELP in the
stylesheet; manual §5.36), the **gate's rail and wash** (`dev/console-gate.html`,
a diffed copy of the ladder).

### 5.8 The frame caps — backlit keys on a photograph (2026-10-02)

The buffer's frame actions were chips that filled solid red under the
pointer: paint, not light, and a fill says *selected*. A frame is opaque, so
nothing is beneath a cap for the canvas to pool through; the cap carries its
own lamp, with the annunciator's anatomy. At rest: dark glass
(`rgba(0,0,0,.62)` — they sit on photographs in both themes), a cold-iron edge
at 22% of `--lit-rgb`, a dim legend. Under the pointer the light comes up from
inside — a tint, an inset wash, a lit edge — the legend goes `--lit-hot` at its
core with a bloom in the cap's tone, and a 12px halo spills onto the picture.
Every shadow list is three entries at both ends, so it heats instead of
blinking, on `--dur-2` up and `--lit-settle` down. **Tone is the action's:**
promote sets `--lit-rgb: var(--ok-rgb)`; a featured star is a cap that is ON
and rests lit (the legend light and a breath of halo). The cluster comes up
left to right on hover, 45ms a cap, opacity only. No backdrop blur: on a touch
screen the caps are always visible, and a blur per cap across a grid of
hundreds is the iPad's compositor cliff.

### 5.9 Planes — a modal is a lamp held over the room (2026-10-02)

The owner's read of the pop-ups: *the lines are just strokes … not organically
emitting light, and not, through atmospheric haze and ambient lighting, subtly
lighting up the textured background.* A modal or a sheet is a **plane** above
the scrim (460/500), and the canvas is under everything (z −1) by design, so
the engine cannot light a plane's surroundings and must not try: **a plane
carries no `data-seam`.** Its light is the stylesheet's, in five parts, all
static once open:

| part | what | how |
|---|---|---|
| the rim | fed from above: top `0.85`, sides `0.42`, bottom `0.24` of `--seam-level` | per-edge `border-color` (a `border-image` cannot round a sheet's corners); an inset line and a short inset wash under the top edge — light entering the glass; `--seam-glow` either side |
| the rules | the header, footer and section underlines were seams, fed from the left; **gaps since K50** (no line runs along the interface) | a transparent border; the plane still resolves the seam's derived tokens (it is in the `[data-seam]` token block's selector list) for its edge |
| the near field | two soft outer shadows in the emitter's colour, biased upward | derived from `--seam-halo-a`, so on paper they are nothing and `--plane-shadow` (the Desk's lift) returns |
| the air | the overlay's `::before`, between the scrim and the plane (z −1 in the overlay's stacking context): a field of the plane's light centred where the layout puts the plane, **masked by the substrate** | `--substrate-pores` (a CSS copy of the engine's tile — 6px pitch, 0.95px pores, 18° — held to `lighting.js` by a test) plus a flat layer at `1 − gain × 0.7`, so `--substrate-gain` still drives the threads. Strength `--plane-haze` = `--haze-gain`² / 9, zero where `--bloom-gain` is |
| the open | the air rises 0 → 1 → `--plane-rest` (0.72) over 1.6s on the coil's two curves | `@keyframes plane-air`, opacity only; it restarts because an overlay goes from `display:none` on every open. Off under reduced motion |

Where the plane sits is the layout's to say, so `--plane-x/-y` follow the
same breakpoints that place it: centred dialogs on a desktop, sheets from the
bottom edge in the touch band, the welcome card and the login gate centred.
The rim does not animate on open, on purpose: a border-colour change repaints
the whole plane, thumbnails and all, every frame of the spring.

---

### 5.10 The emission ladder — every line has a tier (K43, 2026-10-02)

After K42 the owner pointed at what was left: the archive's image holder, its
metadata fields, its thumbs, the audio track cards — *"a class of lines that
are still reading as strokes rather than emissive, contributing to the overall
light of that surface and background reveal … there are classes/levels of
emission … metadata isn't going to glow as bright … the thumbs should have a
low emission resting state but light up a bit when hovered."* A sweep found
about 360 border declarations. Each is now one of eight classes, and the
inventory is **`dev/console-emission-catalog.md`** (a test fails if a tiered
class has no row there):

| class | level (`--seam-level`) | how |
|---|---|---|
| structure | 0.7, sidebar 1 | the K41 seams, unchanged |
| bay | its three states | K40b/K42, unchanged |
| panel | `--emit-panel` 0.34 | `data-tier="panel"` (+ `data-seam="box"` in a view) |
| card | `--emit-card` 0.2 → 0.55 under a hand | `data-tier="card"` |
| field | `--emit-field` 0.14 → 0.24 hover → 0.5 focus | `data-tier="field"` |
| control | `--edge-cold` → `--edge-warm` + legend | the control's own border, CSS only |
| rule | `--rule` / `--rule-v` | `border-image` on a divider, CSS only |
| signal | unchanged | the state rule's own colour, which still wins |

**How a tier lights.** `[data-tier]` resolves the seam's derived tokens (it is
in their selector list) and adds two: `--seam-rim`, the perimeter **fed from
above** (top 0.85, sides 0.5, bottom 0.3 of the level — the K42 plane's
profile, now shared), and `--seam-halo-k`, which scales the halation with the
level, so a field's bloom is a field's. Each tier sets its dial and its share of
the room's haze (`--haze-panel/-card/-field` as the host's `--haze-boost`, so a
grid of cards sums to a glow, not a wash). A tiered surface in a view also
carries `data-seam="box"`, and the engine pools and hazes it like any seam. One
inside a pop-up does not, because it sits above the canvas (§5.9).

**The dial moves under a hand, and the light moves with it.** `--seam-level` is
now a registered `<number>` (`@property`), so a card's hover and a field's focus
*transition* it on `--tier-rise` (280ms) up and `--tier-fall` (1.2s) down.
Every derived token on that host follows frame by frame, and the engine hears
the transition (`transitionrun`/`end`/`cancel` on `--seam-level`, the
`dialing()` set) and holds its frames for exactly that long, so the pool under
the card rises with its rim. A dial that changes without a transition (reduced
motion) still repaints once: the engine also listens for the pointer and focus
crossing into or out of a seam. The transition is declared on
`[data-tier][data-tier]` so it outranks a surface's own later `transition`.

**Two engine changes ride with it.** A seam now **enters lit** (level 1, no
journey): it is lit at rest by construction and its cold start is `--ignite`'s.
Before, a surface that re-rendered its cards (the archive, on every edit)
dropped their light and faded it back in over 1.5s. A lamp still heats from
cold. And `boxOf()` **culls before it reads any style**, since a grid of card
seams is mostly off screen. Measured in headless Chromium with 94 archive cards
tiered (163 seam hosts): about 0.2ms more per scrolled paint (median 0.8ms
against 0.6ms).

**What stayed a stroke, on purpose:** signals (selection, severity, LEDs, focal
guides, meaningful dashes), the buffer's frames (photographs; their controls
are the caps), the homepage card previews (they render the public card), and
on-media chips. The RAW Lens and the help overlay are deferred, with reasons, in
the catalog.

### 5.11 Backlit glass — a light behind every surface (K44, 2026-10-03)

The owner's reference (a new-tab render of two code panels) put the light
**behind** the glass, bigger than the panel, and the owner dialled it on a
bench built for the purpose (`docs/ideas/backlit-glass-mockup.html`, the take
"1st pass", `docs/ideas/backlit-glass-study.md` §7). Ported:

- **A fourth licence, `data-backlit`.** The engine draws the host's whole box,
  grown by `--backlight-overhang` (12px) and softened by `--backlight-soft`
  (58px), a little low (`--backlight-y`: 0.17 of the height), at the host's
  `--backlight` level, under the glass at z −1 where everything else paints.
  The sprite is the box's **shadow only** (`backlightSprite()`), so the light
  has no hard edge. It enters lit, with no journey. `--backlight` is a
  registered number, so a card's hover transitions it and `dialing()` holds
  the frames for exactly that long. A host off screen is culled before its
  style is read.
- **The area law, eased** (`BACKLIGHT_LAW` 0.35): a backlight is meant to be
  big, and the lamp's full law made a panel's light all but vanish.
- **Levels, calibrated rather than copied.** The bench's light (2.95) and haze
  (2.85) were dialled with backlights as the only emitters; raising the room's
  dials to match would have brightened every seam. So the backlight carries its
  own share: levels ×1.475 (the gain ratio, in the low-alpha regime the
  passes are in), and `--backlight-haze` 2.57 for a panel. **Cards (0.5) and
  fields (0.45) take a much smaller haze share** — the bench had eight cards,
  a real archive has ninety, and twelve on screen at a panel's share flooded
  the room with one red wash (measured on screen).
- **Bodies are glass.** `--glass-body` (on `[data-backlit]`) is a frost
  gradient from `--glass-near` (0.31) at the source to `--glass-far` (0.67)
  away from it, and each surface's own `background` resolves to it with its
  old tier as the fallback, the K43 pattern. On paper it is the paper.
- **Fields are lit too** (the owner, during the build: the archive's metadata
  *"read dark rather than emissive"*): on the bench they sat inside the lit
  metadata panel and borrowed its light, but in the console they stand on the
  page, so each carries a TIGHT light of its own (3px overhang, 22px soft) —
  seven lit panes, not one smear — rising under the pointer (0.36 → 0.48) and
  more with focus (0.75).
- **The light comes from below (Q1).** `--seam-rim` flipped: the bottom edge is
  hottest (0.85) and runs toward white (`color-mix`, 32%), the sides 0.5, the
  top 0.3. The K42 planes use the same rim now, with their inner wash at the
  bottom edge. The structural seams are lines fed from the left and keep it.
- **The slab has thickness:** `--seam-glow-box` (now `--glass-edge`, K50) gained an inner 1px line, on
  the halation's own dial (so it scales with the tier and is nothing on paper).
- **A selected member of a segmented set is a lit cap (Q2):** the FN drawer
  tabs, the cards segments and slot pills, the layout chips, the library and
  audio pills, the bench filters — fill in the hue, a chamfer along the top, a
  tight bloom, a `--lit-hot` legend (`--cap-*`). Declared last in the file so
  it outranks each set's own selected rule. On paper: tint and edge.
- **Corners (Q3):** `--r-surface` 8px on panels, cards, bays, the desktop
  modal and the welcome card; `--r-control` 4px on controls and fields. Pills,
  circles and Pulse's own rounder language are untouched.

**K44b, the same day — no bar, and the sidebar is a panel.** The owner,
before the merge: the sidebar *"should not have that hard line separating it
… a panel in and of itself … our rounded style"*, and the status rail
*"shouldn't be a horizontal bar. The buttons and info should intentionally
float up there."* So the topbar lost its glass, its seam and its halation
entirely (it is transparent, and `.layout` already starts below it, so nothing
scrolls under the controls), and each control in it carries `data-backlit` at
`--backlight-float` (0.32, tight: 2px overhang, 16px soft, a whisper of
haze) — lit glass hovering over the room. The SYS lamp is not one; it owns the
heartbeat. The sidebar's right-edge seam became a box: inset from the window
(`margin`), `--r-surface`, its whole rim the tiers' rim at `--seam-level` 1,
and a light behind its glass at `--backlight-sidebar` (0.42). It is still the
primary source, but its light now leaves four edges instead of one, so its
`--haze-boost` came down from 2.4 to 1.3.

**Not backlit, on purpose:** the publish log and the cards studio well (each
sits inside a backlit panel; a light behind a light is a wash) and every plane
(above the scrim, §5.9). **Cost**, measured with 94 backlit archive cards while
scrolling, desktop Chromium: 0.6ms median paint (0.3 without), 1.2ms p90, one
7ms frame for the one-time bake of the card shape.

### 5.12 Light layers — light that belongs to content scrolls with it (K45, 2026-10-04)

The fixed canvas lit everything, so everything inside the scroller had to be
redrawn on every scroll event — hundreds of ms of script and GPU per scroll,
measured on the owner's machine — and, because a real scroll runs on the
compositor, the light always trailed its content by at least a frame (on a
phone, visibly). The maintenance log has the numbers:
`docs/maintenance/2026-10-04-archive-scroll-and-light-layers.md`.

**The rule:** a scroller that carries **`data-light-layer`** (`.main`) gets a
canvas of its own as its child — `.lighting-layer`, absolutely positioned at
the top of its content, as tall as it, `z-index: -1` inside the host's own
stacking context (`isolation: isolate`). Every emitter inside the host (lamps,
seams, backlights alike) is drawn into it with the same `collect()` and
`drawLight()` the fixed canvas uses, at the emissive buffer's quarter scale,
and the browser upscales it. The compositor scrolls it with the content:

- **A scroll of the host costs the light nothing** — the engine ignores it.
  A scroll anywhere else repaints the fixed canvas only.
- **It repaints only when something in it may have changed:** a mutation, a
  resize, an emitter's size, a dial moving under a hand, the ignition. The
  host's content height is re-measured each repaint with the layer collapsed,
  so the layer never props its own scroll area open.
- **Nothing is culled** — the layer is painted whole, once. Past
  `LAYER_MAX_H` (16,000 layer px, 64,000 CSS px of content) it is unlit.
- **Gain** is the fixed composite's arithmetic run on the buffer itself
  (1-(1-a)^N through a scratch copy); the **dither** is the same pass.
- **The substrate is a CSS mask** on the layer element: a *periodic* tile of
  the same membrane (`substrateTileURL()` — the lattice turned atan(1/3), pitch
  19/√10, so it repeats on a whole-pixel 19px square), plus the threads'
  floor from `--substrate-gain`. A quarter-scale buffer cannot hold a 6px pore.

**The fixed canvas keeps the chrome:** the sidebar, the floating top controls,
the tab bar, toasts. Content light no longer reaches under the floating top
row, which is darker and cleaner for it.

**In the same pass:** hover is warm light (`--warm-fill`, fifteen rules that
painted a grey slab under the pointer), the top row's controls read sharp
(tight light, crisp lit edge, bright legend), and the Pulse lane's selected
pill is the K44 cap.

### 5.13 One source per panel, and every button floats (K46, 2026-10-04)

The owner, testing K45: the archive's metadata, with a light behind every
field, was *"a bit incoherent. Instead of each field being a light source we
should design it as a unified panel(s) as one source of light."* And: Stage to
Archive "still reading as a stroke rather than emissive"; every button should
"look like the floating info/login rail buttons"; the sidebar's hover "lags
mouse and it reads hard and not organic"; the collapse button should match
its neighbours.

- **A field is a well, never a lamp.** No `data-tier="field"` element carries
  `data-seam` or `data-backlit`. Fields sit inside a lit panel (the archive's
  is `.compose-fields`; the Wall and Network forms already sat in
  `entry-form-card`) and are wells cut into its glass: `--glass-body` darker
  than the panel's (`--well-top` / `--well-bottom`), the light's shadow
  falling in from the top (`--edge-in`), the panel's light catching the bottom
  lip. Their rim keeps the tier's faint dial. **Focus lifts the panel**, not
  the field: `[data-tier="panel"]:has([data-tier="field"]:focus)` raises
  `--seam-level` to `--emit-panel-warm` and `--backlight` to
  `--backlight-panel-warm`, on the tier's rising curve, and the engine follows
  the dial as it always has (`dialing()`). Fewer emitters, so it also costs
  less: the scroll bench's script time at CPU 4× fell from 17.5ms to 9.2ms.
- **Every `.btn` is a floating control, in CSS.** The look is the top row's:
  a crisp lit edge (`--float-edge`), a bright legend (`--float-ink`), light
  behind the glass coming up through the membrane's pores (`.btn::before`,
  masked by `--substrate-pores` like a plane's air), and a small spill under
  it. Every light in the recipe scales with `--float-glow`, a registered
  inherited number: a hand raises it in `--float-rise` (130ms) and it lets go
  over `--float-fall` (620ms). No engine emitter per button — a view's twenty
  buttons cost nothing, and the same recipe works inside a plane where the
  canvas cannot reach. `.btn-stage` (a surface's primary action) runs hotter,
  and its fill rides the glow so it fades up to the selected cap's fill
  instead of snapping; `.btn-primary` (the one hero action) is a lit cap at
  rest; `.btn--unlit` dims all of it. On paper `--float-k` is 0 and the keys
  are printed. The block is declared at class weight on purpose: heat, focus,
  press and a disabled insert bar are more specific and still win.
- **A sidebar row warms as a lens.** The warm fill was a gradient, which cannot
  transition, so a hard-edged block snapped on while the legend took 480ms to
  catch up. Now `--row-lens` is a radial pool from the bead that fades before
  the row's edges, its strength a registered number (`--row-warm`): up in
  110ms, down over 560ms, with the legend rising as fast as the light. The
  current row holds the same lens at 1.15 instead of a slab.
- **The collapse button** (`.sidebar-toggle`) lost its grey slab and wears
  the settings buttons' housing.

**K47 (the same day, the owner on K46).** *"The other buttons should be
concave not convex … they look like they are popping out."* The recipe lost
its inner bottom glow (which domed the key) and gained `--float-recess`
(`--edge-in`: the lip's shade falling in from the top); the light behind the
glass is a dish — darkest in the middle, gathering at the walls. The two
holdouts joined the recipe: the top row's **Publish** (stage heat while work
is pending, unlit — not 40% opacity — when not) and the buffer's floating
**Link** (frosted glass, since it sits over photographs; a lit cap while Link
mode is on). The sidebar's **counts** are lit readouts (glowing figures in a
window of lit glass, hot on the current surface) instead of a dark slab. The
**settings light** is the SMD part — the SYS lamp's square, bezelled,
specular LED, held steady — in the top row, the sidebar and the More sheet;
`session.js` sets `data-state` and the stylesheet colours it.

**K48 (the owner on K47: the buttons "are still reading as almost drawn on …
the code for the look of the top header floating buttons should be there").**
It is now. The top row's depth was never CSS: it is the engine's light behind
the key, coming up through the room's own pores (in phase with the ground
around it) and pooling under it. A CSS membrane inside the button could not
match that, so every `.btn` in the content is **licensed** like the top row —
`chrome.js licenseFloats()` sets `data-backlit` once per button, for the
content and for whatever any surface renders later (a MutationObserver on the
light layer's host) — and wears the top row's light (`--backlight-overhang`
0, `--backlight-soft` 6px, `--backlight-haze` 0.12) and edge. The level is
a touch above the top row's (`--backlight-float-key` 0.22 against 0.2): at
0.36 the keys outshone the top row and lost the contrast that makes them easy
to pick out (the owner, comparing the two), and at 0.2 a key on ground the
panels already light lost its interior; it rises under a hand
(`--backlight-float-warm`) on the float curve, and the engine follows the
dial. Two kinds keep the CSS light: a key in a plane (outside the host — the
canvas is under the scrim) and a key held in place over scrolling content
(fixed or sticky: the floating Link, the burst bar), whose light would be left
behind in the layer. Scroll bench unchanged: 0 dropped, 0 long frames.

### 5.14 Light that costs what changed, not what exists (K49, 2026-10-04)

The owner, on a phone: *"extremely slow … optimized from a longterm (more data)
perspective"*; light *"ghosted or misaligned"*; the content needs *"a separate
lighting condition for mobile only"*; and the brief: *"photo realistic
lighting with the least compute budget, faking it (pre compute) as much as
possible."* The maintenance log has the measurements:
`docs/maintenance/2026-10-04-phone-performance-and-ghost-light.md`.

**The principles** (the canvas guidance on web.dev and MDN, and the
`content-visibility` work on web.dev):
- bake expensive light once, offscreen;
- redraw only the region that changed;
- let the browser skip what is off screen;
- never do work on the scroll path.

How each lands in the engine:

- **Sprites are baked once and kept.** The cache is least recently used, with a count (`SPRITE_CAP` 160) and a pixel budget (`SPRITE_PX_BUDGET`). A sprite is baked at a quantised size (`spriteSize`: 4px steps under 160px, 8 under 640, 16 past it) and drawn stretched to the exact box, so a view's near-identical boxes share a handful of bakes. The 48-entry FIFO it replaced re-baked ~110 blurred sprites per paint.
- **A change redraws its own target, and in a layer its own region.** The fixed canvas has its own dirty flag (`fixedDirty`):
  - a toast or the nav's prism heating redraws the fixed canvas only;
  - a hover dial, a bay waking, or a lamp in the content redraws only the region its light reaches (`paintLayerPartial`: clip, clear, redraw everything that reaches in, from the boxes the last full paint collected);
  - full layer repaints are for mutations, resizes, theme changes and re-windowing.
- **A layer is a window.** `LAYER_WINDOW_BEFORE` (1) screens above the viewport to `LAYER_WINDOW_AFTER` (2) below. It is re-centred when the viewport comes within `LAYER_EDGE` (½ screen) of an edge, detected by two invisible markers and an IntersectionObserver rooted at the host, so a scroll never reads geometry. Its cost is bounded by a screenful of content, however long the content.
- **What is not rendered is not measured.** `boxOf` asks `checkVisibility({ contentVisibilityAuto: true })` before any rect, so hidden views and content the browser is skipping cost nothing and are never forced into layout. When skipped content comes back (`contentvisibilityautostatechange`), the layer is redrawn.
- **Held in place is the chrome's.** An emitter under a fixed or sticky ancestor inside a layer host (`heldInPlace`; on the touch band the view headers are sticky) is drawn on the fixed canvas. The fixed canvas gets one frame after a scroll of the host settles, not one per event.
- **The layer moves with the view.** When a child of the host enters with an animation (`view-in`), the layer runs the same fade, so light never shows before the thing that makes it. It is redrawn when the animation ends, because what it measured mid-flight was a few px off. Each child of the host is watched for size.
- **Read only what may have changed.** The emitter list is re-queried on full repaints only. The window's size is re-read on `resize` only: `innerWidth` forces a synchronous layout whenever anything has moved.
- **The content has a light profile.** `--light-content-backlight` and `--light-content-haze` (root, default 1) scale every backlight and the haze in the light layers, not the chrome. The phone's values live in one block, "THE PHONE'S LIGHT" in the stylesheet: 0.55 and 0.5. A future phone-only dial goes there and is read with `rootNum`.

**In the same pass:**
- The buffer is lazy and progressive: 480w/1024w `srcset`, `content-visibility: auto` per day, and the first ~96 frames built at once with the rest in chunks.
- FN's bar and cover-bay chips are keys (licensed like `.btn`), the DRAFT stamp is a lit readout, and the draft underline is a lit filament.


### 5.15 Glass with no strokes, a perceptual pair, eye adaptation (K50, 2026-10-04)

The owner's craft pass — *"polish and refinement, to an Apple level"* — with
four notes and, mid-session, a pivot: *"remove all the strokes from around the
panels so that it really feels like a floating clean clutter-free interface …
get rid of any lines running along the interface … the panels should feel
like a glass screen protector: a little bit of depth from the side and the
thickness of the glass, rather than a 2D illustrated drawn-on stroke."* The
maintenance log has the measurements:
`docs/maintenance/2026-10-04-craft-pass-glass-curves-exposure.md`.

**No stroke, no line.** `--seam-rim` is `transparent` on every host; the
border stays for layout and paints nothing. The structural lines went with
it — `--seam`, `--seam-v`, `--seam-solid` and the whole `--seam-glow` family
are gone, and the view header, the stage rule, the nav divider, the sidebar
foot and the buffer's day leader draw nothing and carry no `data-seam`. The
only seam hosts left are **boxes** (the sidebar, every bay, every tiered
panel and card) and the tab bar's top, and what they draw is the slab's
**thickness**, `--glass-edge`: two insets since K50d (four in K50) — the backlight entering along
the bottom lip (`--glass-lip`, the hue run toward white, like `--lit-hot`),
the same light faint up the two sides, and a cold white specular hairline
where the top face meets the air — all scaled by `--seam-halo`, so a tier's
edge is a tier's, the ignition flares it, and on paper (`--seam-halo-a: 0`)
it is nothing and the Desk keeps its printed rule (`--seam-rim: var(--line-2)`
there). The engine's strips and the backlight are what read as the edge
glowing; no line does. A bay's heat is now its own dial — `.dropzone:hover`
lifts `--seam-level` to 0.85 and hot to 1, both on the pair — instead of a
border colour. Planes are slabs too: the inset wash, the edge, the near
field; their header, footer and section rules are gaps. **Keys** are wells
with the same thickness at a key's scale (`--key-edge`, riding `--float-glow`
so a hand brightens the lip with the light behind the key), a faint body
(`--key-body`, so a key reads as a slab and not an underlined word) and a
transparent border (`--key-border`; the Desk sets it to cold iron). The top
row's controls are the same recipe. A selected cap's edge is transparent; its
fill, chamfer and bloom are what say "on".

**The thermal pair is perceptual.** The eye sees roughly the cube root of
light (CIE L*), so a curve that is smooth in the light's units is not smooth
to the eye: the old heat `(0.4, 0, 0.5, 1)` showed the pool 28% lit to the
eye a tenth of the way in — the owner's "sudden jump, then it starts fading
up" — and the old cool `(0.33, 0.05, 0.2, 1)` held at the crest and then fell
at a constant rate, which the eye reads as a hold and a linear slide. Now
`--ease-heat: cubic-bezier(0.8, 0, 0.45, 1)` and `--ease-cool: cubic-bezier(0.4,
0, 0.1, 1)`, fitted so the cube root of the light rises and falls on a
smooth S: a near-flat first third to the heat and no velocity at the crest; a
soft leave, the fastest fall at the middle and a long tail (Newton's
cooling, to the eye). `--arm-heat` / `--arm-cool`, `--tier-fall`,
`--float-fall` and `--row-warm`'s fall ride them; the ignition's keyframes
carry literal copies (a keyframe cannot read a custom property); a short UI
answer (≤360ms) keeps `--ease-out`, where latency matters more than shape.
**Every `cubic-bezier` in the stylesheet is a named easing** (`--ease-out`,
`--ease-spring`, `--ease-pop`, `--ease-heat`, `--ease-cool`) or a keyframe
copy of one — `tests/console-motion-vocabulary.test.js`. And the bay's
cascade is fixed: the generic `[data-heat]` rule (the coil's filter list,
declared late at the same weight) used to outrank `.dropzone`'s transition
list for the whole cool and drop `box-shadow` from it, so the wash snapped
off while the border faded; `.dropzone, .dropzone[data-heat]` (and the cover
bay) now declare the resting list at a weight that wins.

**Eye adaptation.** Measured before: the content's light ranged 1.2 (FN) to
2.85 (Publish) on one scale — a 2.3× step taken in one frame, the owner's
"eyes have to adjust". After a layer is painted the engine reads the band on
screen (`layerMean`: the **log-average** luma of the quarter buffer, every
other pixel — the geometric mean, the measure HDR eye adaptation uses, so a
few bright panels do not stand for the room), sets the layer's **exposure**
`clamp((ADAPT_REF / mean)^k, ADAPT_MIN, 1)` with `k` = `--light-adapt` off
the root, and writes it as the layer canvas's `opacity` — no repaint. The
engine only ever brings a bright surface *down* toward the quiet ones (the
exposure is ≤ 1): light that is not there cannot be amplified without
amplifying its noise. The first exposure is where a layer starts; after that
a surface that has just **arrived** (its view entered within
`ADAPT_ARRIVE_MS`) and would be brighter than it will settle at jumps
straight to its target — the engine never flashes a room bright and then
closes down, which is the very adjustment the eye was being asked to make —
and a darker one **glides** up on `--arm-cool`, frame by frame in the
engine's own loop (the eye opening; a style write per frame, then it parks).
The view-in fade now ends at the exposure, not at 1. `--light-adapt` 0.6
shipped; 0 is byte-identical to K49. Calibration (log-average, settled
exposure, 2026-10-04): Buffer 1.66 → 1.0 · FN 1.78 → 1.0 · Wall 4.7 → 0.63 ·
Library 10.9, Archive 19.8, Publish 26.0 → 0.5 (the floor). The floor is a
judgement — the bright surfaces sit at half their bench-dialled light — and
one constant.

**The membrane in device pixels.** The pitch was 6 CSS px, so a 2× display
doubled the dots with the type (12 device px between pores: the scale of a
letter's counters), and the keys' CSS membrane put the pores at full contrast
under the legend. Now `SUBSTRATE_PITCH` 7, `SUBSTRATE_PORE` 1.0 and
`SUBSTRATE_DEPTH` 0.55 are in **device** pixels — the same surface is a
finer grain on a sharper screen — and every copy is one tile: the fixed
canvas's pattern bakes at the canvas's ratio; the layers' mask is a periodic
`SUBSTRATE_CELL` (22 device px) supercell laid at `22 / dpr` CSS px; and the
engine writes `--substrate-pores` and `--substrate-size` onto the root
(`writeMembrane()`, at init and on resize) for the two places the canvas
cannot reach (a key in a plane, a plane's air). The stylesheet's values are
the engine's tile at 1×, the fallback until it runs, and a test holds them
equal. A key's CSS membrane has a third mask layer that is solid under its
legend: the pores show at the walls of the dish and never under the word.

**K50b, the same evening (the owner on the phone):** the tab bar is the
room's floor — tinted, emissive glass lit from below (`--floor-edge`, retired in K51; the
membrane through its `::before`, `data-backlit` at `--backlight-tabbar`
sitting high so the light spills up into the content); a phone view has no
title and no sticky glass header; a surface switch runs inside a View
Transition (`chrome.js showView`) so nothing goes black between surfaces;
`--edge-cold` / `--edge-warm` are transparent in the Darkroom (no control
draws a stroke); the settings LED sits back; and the bay's tint is an inset
shadow fill rather than a `background` gradient layer, which Chromium did
not interpolate (it snapped off at the first frame of the cool).

**K51, later that night (the owner on the iPad):** the floor is a solid
slab, not glass you see through. Frosted glass looks different over
different content, and a surface switch changes the content, so the bar
shifted on every crossfade. `--floor-base` is opaque and lit from the bar's
bottom edge. The top lip (`--floor-edge`) and the top seam strip are gone,
because together they read as a stroke. A 28px feather (`.tabbar::after`)
sinks the content into the slab, and `data-backlit` still lights the room
above it as a haze. The bar was its own View Transition layer
(`console-floor`, retired in K52, below), drawn live over the crossfade,
which only worked because it samples no backdrop. Every key
has a well under its legend at a level above the floor's (`--key-well`).
A tap strikes a pulse (`chrome.js tabPulse`, styles in § THE PULSE): one
launch with friction, a front each way whose head runs along the top
edge, a bloom where it meets each wall, and keys that catch it as it
passes. It is compositor-only keyframes; the engine never wakes for it.
`--tab-pulse` is its dial (0 on paper and under reduced motion).

**K55, later still (the owner):** every plane is one window. A modal was an
opaque slab and hid the plane's air, while a sheet was frosted glass and
showed it rising from its foot. All modals and sheets now wear
`--plane-body`: the sheet's glass plus a low wash of the hue entering the
bottom edge, so a centred desk dialog reads bottom-lit too. On paper they
stay the printed card, with no blur. The bays are backlit glass like the
panels (`data-backlit`, the panel's glass body and backlight, warm while
hot, on the bay's heat and cool curves), so at rest they hold a low ambient
light from below instead of going black.

**K54b, the same night (the owner: on the Archive "the dropzone ignition
was delayed and … at the end of the cool down the back lighting shifts";
and Publish's "ignition sequence ends up slowing down after 1 or 2
clicks"):** two faults in the eye adaptation. (1) It measured the room
while a lamp in it was mid-journey. The bay's heat and cool and the card
row's wake are attribute changes, each one a full layer repaint and a fresh
measure, so the surface's exposure chased its own ignition: on the phone it
sank 0.72 → 0.50 while the bay cooled and climbed back for 2.6s after,
about seven seconds of glide per arrival, still running into the next
surface. `journeying(host)` (`[data-heat]` or `[data-wake]` in the host)
now holds the exposure. The room is measured at rest: on arrival, and when
the attribute comes off, which is itself a repaint. (2) It read the light
canvas with `getImageData` about six times per switch, and Chrome said so
("Multiple readback operations using getImageData are faster with the
willReadFrequently attribute"). Past a few reads Chrome moves a canvas off
the GPU and every draw into it gets slower. `readBand` now copies the band
1:1 into one small probe canvas made for reading and reads that: the same
pixels and the same exposure (0.73 phone, 0.50 iPad, traced), with no
warning, and the light canvas stays on the GPU. A note for whoever
measures this next: a tracer that reads the light canvas back demotes it
itself. Our first trace "reproduced" the Publish slowdown that way.

**K54, later (the owner, on the phone and the iPad):** the top row "shouldn't
just be a hard edge … light coming up from the interface beneath it should
organically bleed into this bar … an organic soft roll off to black". The
content's light lives in a layer inside its scroller, and a scroller clips,
so the haze stopped at the scroller's top under a row that floats over plain
black. A host with `data-light-spill` (`.main`) now lets its light out of
its top edge: a small fixed canvas above the host is filled from the layer's
ROW of light at the host's visible top edge, stretched to the top of the
screen. Every column rises from what lies beneath it, and the light rolls off
to black on an eased curve (`SPILL_FADE`, applied `destination-in`). It is
drawn at an eighth of CSS pixels, wears the layer's membrane and exposure,
and fades in with it. `--spill-gain` is the dial: 1 in the touch band's
Darkroom, 0 on the desk and on paper. Measured at CPU ×4 with the real
data: 0.02–0.04ms an update, no layout, no style recalc, and scroll frames
unchanged (p95 16.7ms, none over 20ms).

**K73–K74:** `--spill-gain` is 1 on every dark screen, the desk included
(the owner: "technically everything on that top strip should be
'floating'"), and a light layer is at least its pane's height, so a short
surface stands in a lit room down to the floor. Under the scale (K74, a
large screen at 1× zooms the whole console), a rect and the window come back
zoomed: the engine divides them by the zoom (`uiZoom`, `unzoomed`) and
multiplies the device ratio by it, so it still works in the page's own px
and the canvas keeps a pixel per device pixel. A part that changes its own
text where it stands says so with `data-light-still` (the split-flap's
turning letter), and a change inside it moves no light (`movesLight`): WebKit
draws the canvas on the CPU, and a repaint per turned letter was a dropped
frame per letter (12–16 a flip; 1–2 since, both as the line is rebuilt).

**K53, that evening (the owner: "the transition from any surface to the
archive is janky … some stutter animation before a smooth ease up for the
lighting"):** the eye adaptation's arrival rule (a surface brighter than it
will settle at jumps to its exposure; it never fades up and then sinks) read
an arrival stamped by the view's entrance animation. Inside a View
Transition that animation starts a crossfade later than the light first
measures the new surface, so a bright surface was measured "not arrived". It
faded up to the previous surface's exposure (~0.99) and then glided down to
its own (~0.6 for the Archive) over the 2.6s of `--arm-cool`. The router now
sends `console-arrive` from the new view at the swap, and the engine stamps
it for any child of a layer host. Traced: the exposure settles inside the
transition's freeze (the old picture is still on screen), and the light
fades up once, to where it stays.

**K52, the next morning (the owner, on stock Chrome on Android):** "click,
stutter, then pulse". A View Transition stops the page drawing from the old
snapshot until the new surface is built (35–77ms per switch with the real
data at phone speed), and the wave froze with it. K52 replaced the View
Transition with a ghost crossfade, which kept the wave moving but lost the
dissolve: the old page's text sat over the new one, and its lights stayed
in the shared layer and in the eye adaptation's measure, so the arriving
surface's ignition hesitated. **K52b reverted the ghost.** The View
Transition and `console-floor` are back, and the wave waits for the page
instead: the press is the key's own light (CSS `:active`, instant, nothing
moving), and the wave leaves on the click once drawing resumes
(`chrome.js whenDrawing`, on the transition's `ready`), so the freeze falls
where nothing is in flight. Two parts of K52 stay. A tab key's press draws
no edges and does not dim. And the layer's window is measured from the
content (`contentHeight`, the lowest child, never the canvas or its
markers) and clamped to it (`layerWindow`). Without that, a scroll left
deep in a long surface stayed past the end of a short one after a switch,
held open by the canvas and the window's own top marker. K52's first fix
for that hid the canvas and markers before measuring, which re-laid out
the scroller on every layer resize: Archive taps went from 46 layout
passes to 55, and with the read-only measure they are 27.

**K50c, later the same night:** the `.dropzone[data-heat]` rule declares
only its transition (restating the base rule's padding under it had
overridden every size variant while the bay was hot — a 28–44px layout
shift at every wake); the hot bay's border is forced transparent against
the generic hot rule's accent stroke; the buffer builds **on demand** (a
sentinel the next chunk follows, `js/console/buffer.js`) instead of in the
background under the cold start; during the cold start the fixed canvas
repaints one frame in two and the layers one in four (`IGNITE_FIXED_EVERY`,
`IGNITE_LAYER_EVERY`), the exposure holds through the flare, and the glass
edge no longer carries the dial (above). `--backlight-tabbar` 0.38.

**K50d — the stroke, at last.** Every bay but the FN cover slot wore a
solid accent outline whenever it was hot (on a phone, through every wake).
The generic `[data-heat="hot"]:not(.btn-primary)` rule gives a hot key an
accent border; `:not()` takes its argument's weight, so that selector is two
classes — the same as `.dropzone[data-heat="hot"]` — and it sits later in
the file, so it won the tie. K50c's "override" was written and lost, and its
test checked the writing. The generic rule now excludes `.dropzone` and
`.fn-hero` itself, and the test holds that no other hot rule hands out the
accent border. In the same pass: the ignition's breath (`.dropzone::before`)
is sized to the closest side and follows the bay's radius (sized to the
farthest corner it was cut off by the box at its crest — a hard rectangle);
`--glass-edge` lost its side hairlines; a bay rests at a panel's level.

**K50f.** RAW Lens is a plane (z 490, above the canvas) and takes the plane
and key recipes: its buttons are `.btn` keys, its selected members join the
cap list, its room is lit from below through the membrane, and its slabs and
strokes are gone. **A row of cards can wake on arrival:** `data-wake-row` on
the row, and `chrome.js wakeRows()` plays each `[data-tier="card"]` child's
own hover — `data-wake` maps to the card's warm dial and backlight on the
tier's rise — one card after the next, then lets go on the tier's fall. The
engine follows the dial as it follows a hover. Publish's stats rail is the
first row. And the key's light (`--key-body`, `--key-edge`) is declared on
the keys, not `:root`: an unregistered custom property is substituted where
it is declared, so at the root it read `--float-glow` once and a hover never
reached it.

### 5.16 What a frame reads (K56, 2026-10-05)

The owner brought three outside optimisation reports. Two of them proposed
replacing the canvas with CSS glows animated by opacity; the third reviewed
this engine and agreed with keeping it. Each claim was measured before
anything was changed, in headless Chrome on the Mac's GPU (Apple M4,
hardware canvas and raster), at phone size with the CPU slowed 4× and the
real data.

- **The engine is not a paint problem.** A bay's heat and cool paints the bay
  for 7–10ms over 250 frames; all paint together is about 0.26ms a frame.
  The CSS replacement, applied as written, removed the engine's script but
  painted three times as much on Publish, held 2.5× the compositor layers,
  pulled the fixed tab bar out of place and drew no light, because a glow
  behind opaque glass does not show. Light from many sources has to ADD
  (`lighter`), and a CSS glow is clipped by `overflow` and stacking contexts.
  The canvas stays.
- **The cost was bookkeeping.** While a light moved, every frame re-read
  every emitter's whole description: 11–18 thousand computed-style reads in
  the five seconds of an arrival.

So a frame now reads only what moves.

- **Facts are read once per roster.** An emitter's licence (lamp, seam,
  backlight), the canvas its light belongs to (`hostOf`, a `closest()`), its
  colour and corner (`boxOf`), its haze boost (`boostOf`) and its backlight's
  shape are kept in `factsOf(el)`. A new roster starts with every full
  repaint: a mutation, a resize, the theme or the ignition. One element's
  facts are forgotten when a hand or a focus reaches it (`touched`) or a
  transition ends on it (`onDial`). That way a state rule that changes a
  colour without touching the licence is read on its next paint. **Dials**
  (`--seam-level`, `--backlight`, `--ignite`, `--lit-level`) and the **box**
  (a transform can carry it) are still read every frame.
- **The licence is split once per roster** (`roster.lit`, `roster.seam`,
  `roster.anyBack`, `onHost`), and `reconcile` skips its target pass when
  neither the roster nor the gain has changed.
- **The room's settings are read once per full repaint** (`setting()`):
  `--bloom-gain`, `--haze-gain`, `--substrate-gain`, the content profile,
  `--spill-gain` (on the scroll path before) and `--light-adapt`. The cache
  is the repaint's (`settingsGen`), not the roster's. On paper there is no
  roster, so a roster-keyed cache would hold the light off after a switch
  back to dark (tested).
- **Unchanged writes are skipped** (`restyle`, `L.opacity`).
- `@property --ignite` was `inherits: false`; only the engine read it.
  (K78: no registered number carries the room now; the engine is handed
  chrome.js's level.)

**Measured, from `main` to K56:**

| Phone-speed run | Before | After |
|---|---|---|
| Archive arrival, style reads | 14,204 | 4,949 |
| Publish arrival, style reads | 16,630 | 4,587 |
| Archive scroll, style reads | 2,059 | 717 |
| Archive scroll, engine frame time (3.5s) | 107ms | 77ms |
| Frame median, four arrivals | 1.26–1.91ms | 0.94–1.60ms |

Screenshots of four surfaces are pixel-identical (at most one level in a
handful of pixels).

**Tried and not shipped, with the measurement:**

- **The bay's hot wash as a pre-drawn `::after` faded by opacity:** no
  difference in paint, and its tint lay over the inner top highlight.
- **Reading 1/16 of the band for the eye:** the band is 103×202 at quarter
  scale. A warm read costs about 0.9ms whatever its size, because it waits
  for the GPU; the first read of a session costs up to about 7ms once.
  Sampling stayed within ±1.7% on every surface, but saved nothing.
- **The fixed canvas at quarter scale:** small on a GPU. Revisit only if a
  phone profile says otherwise.

**Where an arrival's time actually goes** (a first Archive arrival, phone
speed): the screen switch's capture, 22–72ms; the surface rebuilding its
grid (`renderArchive` runs on every arrival), 25–30ms; the first paint,
about 15ms; the engine, about 8.5ms on the first visit and 3ms after. The
next lever was the surfaces, not the light: K57 stops Archive and Wall
rebuilding an unchanged grid on arrival (`utils.js paintHTML`). The same
audit tried `content-visibility: auto` on their cards and rows. It cut the
arrival's longest task further, but every card entering range sent
`contentvisibilityautostatechange` and a full layer repaint: 2.2–2.9× the
engine's scroll cost. **K58** answers that event with a region repaint of the
emitters that came into range (the same `layerPartial` a hover uses):
Archive 223 → 26ms, Wall 130 → 16ms with the property on, and the layer
byte-identical to a whole-layer repaint at every position measured. The
property is still not on Archive and Wall, because their real heights vary
too much for one placeholder (cards 80–117px, phone Wall rows 55–168px).

### 5.17 The text classes — what a piece of type is decides its light (K59, 2026-10-06)

The owner annotated the Bridge on the iPad, in four colours of ink, and the
notes about light all asked the same question of different words. Actionable
text "should be emissive". The waiting count, "if this is a stat, should be
emissive or remove". The storage tiers and their age are "live info, low
emissive". And the two lit figures were circled as the reference for
"emissive txt". The ask behind them was explicit: *classes of text, with
rules, so the dashboard can change later without anyone hand-building its
light.* Before this, light on type was decided line by line (`.br-glow` on a
figure, `--lit-legend` on a hover, `--cap-legend` mid-drag), so every new line
reopened the question.

**Two questions about every piece of type, answered in two places.** The
**role** (`--type-headline/-figure/-line/-label/-whisper`) says how big it is
and which ink it sits in. The **class** (`data-text`) says whether it gives
light. They are independent on purpose. "Resume Publish" is a small line and
an act; "measured 2 h ago" is a dim whisper and a live readout. A class adds
light, never colour. The accent still means *needs you*, on `.is-needs`.

**Four classes, chosen by four questions asked in order** (stop at the first
yes):

| class | the question | at rest | under a hand | in an update |
|---|---|---|---|---|
| `stat` | Is it a measured number set as a figure? | lit, `--text-stat` 1 | — | flares to hot |
| `act` | Is its job to be tapped? | the accent, burning red, `--text-act` 0.7 (K61) | lit, `--text-act-warm` 1; pressed, hot | unchanged |
| `live` | Does it report the state of the site or the system right now? | low, `--text-live` 0.45 (K61) | — | flares to hot |
| `info` | Otherwise: it names, explains or gives context. | flat, always | flat | flat |

The order settles the edge cases. The storage tiers line holds a tappable
"measured 2 h ago", but its job is to be read, so it is `live`. A word count
under a draft describes the item, not the site, so it is `info`. A count of the
lines sitting right under it is a total, and **a total is not news**: the "4"
beside *waiting on you* failed the `stat` question and was removed rather than
lit.

**One recipe, one dial.** `[data-text]` draws three text-shadows from one
number, `--text-k` = `max(--text-emit, --text-flare) × --text-gain`: a 1px
white-hot core that appears only past half level (`clamp(0, 2k − 1, 1) × 55%`),
a 14px near halo in white (`k × 20%`), and a 36px far halo in the room's colour
(`k × 0.32`). At 1 that is exactly the lit figure the second pass shipped
(`--br-glow`, now gone). A class is a level and nothing else: each
`[data-text="…"]` rule sets `--text-emit` to its token. `--text-emit` and
`--text-flare` are registered, non-inheriting numbers, so a hand transitions the
dial on the ladder's own pair (`--tier-rise` up, `--tier-fall` down) and a
nested text keeps its own level. **The Desk:** `--text-gain: 0` is the one
switch, and since paper cannot glow, a hand inks an act in the accent instead.

**One event: the update.** When the live site changes from this device (a pulse
goes out, or a publish from here finishes deploying), the light runs through
the readouts in reading order. Every `stat` and `live` text under the root
flares to `--text-hot` (1.4) on the thermal pair (`@keyframes text-flare`: heat
for 18% of `--text-flare-dur` 1.4s, then cool) and settles back to its class.
The owner, on the iPad: hitting SEND "should 'pulse' light through the header
text". `js/console/text-light.js` holds it:
- `sweep(root)` finds the readouts in document order, which is reading order
  in every layout because the grid only restacks. It spaces them 90ms apart,
  compressed so the whole wave takes no more than 600ms.
- `flare(el, at)` restarts one flare. It settles the style, not the layout
  (the K56 lesson), and lets go of `data-flare` on its own `animationend` only.

Acts and info stay as they are, because an update is news and neither of them
is. The Bridge's headline is written word by word (`<span data-text="live">`
per word) so the wave travels through it instead of flashing it whole. It is
rewritten only when its words change, because a rewrite would put out a flare
in flight. All motion, the dial's travel and the flare, sits inside
`@media (prefers-reduced-motion: no-preference)`. With reduced motion a text
simply is its level, and an update changes nothing on screen.

**The rule that keeps it a system:** a surface never writes its own
`text-shadow`. It classifies its text and, if it must, moves one between the
named levels (the Bridge's drag holds its headline at `--text-hot`). The light
is CSS only: the canvas engine is not involved, `data-text` is not in its
licence, and no text pools onto the ground. `tests/console-text-classes.test.js`
holds the vocabulary closed, the levels ordered, the recipe single, the Desk
dark, the motion gated and the Bridge free of hand-written shadows.
`tests/console-bridge.test.js` paints the Bridge and fails on any visible word
with no class.

**The SMD part, as a primitive (same day).** The owner circled the Bridge's
two green dots: "SMD chip". `.lm-smd` is the SYS lamp's and the settings
light's component for any other status light: square with a 1px corner, a dark
bezel, an inset specular, a glow in its own colour. `--led-rgb` picks the colour
(ok by default) and `--smd-size` the package (6px; the Bridge's calm lamp is 9).
It is steady, because the SYS lamp owns the heartbeat. The two older lights keep
their own rules for now, since their states and tests are their own.

**Pass six (K61, same day): the classes made visible.** The owner's next
round of notes, on the iPad, showed that pass five's light could not be seen:
the act lines read as plain white, and SEND's update showed nothing. The
cause was white light laid over white letters. Changes:
- **An act is the accent, and burns red.** `[data-text="act"]` sets
  `color: var(--accent-text)`, a core in the room's colour (`--text-core`)
  and a tight bed of that light under the glyphs (`--text-pool`,
  `--text-act-pool` 0.55, 8px). The owner: action text "should contrast
  regular text … volumetric red emissive text, similar to the bottom bar
  surface buttons". So red on the Bridge now means *you can do this*, and
  NEEDS YOU is an act resting at its warm level (`.is-needs`).
- **The update is lit in the room's colour.** A flaring text gets the bed
  (`max(--text-pool, --text-flare × 0.4)`) and a 72px bloom drawn by the
  flare alone, so the wave reads on white type.
- **`--text-live` 0.3 → 0.45**, so a live readout is visibly lit.
- The calm lamp beside the headline is gone ("remove smd"). The front page's
  no-picture tile is a lit panel (backlit glass plus its own well).

## 6. Tokens — the whole vocabulary

In `:root` of `css/field-console.css`, in this order. Nothing here is a colour
literal except the white and the ground.

| group | tokens | notes |
|---|---|---|
| the room's light (reflective) | `--light-x/y`, `--light-rim`, `--shade-1/2/3`, `--edge-up`, `--edge-in`, `--edge-groove`, `--shadow-press`, `--shadow-1/2/3` | K37; `--edge-groove` (K40) is the shallow channel a rod lies in — `--edge-in` is a well and covered a 6px rod on paper |
| the emitter (on) | `--lit-rgb`, `--lit-fill`, `--lit-edge`, `--lit-halo` | `data-lit="ok\|warn"` remaps `--lit-rgb` |
| cold iron (resting) | `--lit-cold-0/1/2` | alphas of `--lit-rgb` |
| the white | `--lit-hot` | 92% white in STUDIO; the emitter colour on the Desk |
| the pool's dial | `--bloom-gain` | 2 in STUDIO, 0 on the Desk, ≤ 4 |
| the curves | `--ease-out`, `--ease-spring`, `--ease-pop`, `--ease-heat`, `--ease-cool`; `--arm-heat`, `--arm-cool` | every curve in the file is one of the five (K50, `tests/console-motion-vocabulary.test.js`); the coil's pair rides the perceptual two and is read by CSS and the engine |
| the press | `--press-travel`, `--press-scale`, `--press-dim` | K37 |
| the strike (K40) | `--lit-settle`, `--lit-strike`, `--lit-strike-off` | the Desk sets the strike to its off half |
| the legend (K40b) | `--lit-legend` | selection's low steady light; off on the Desk |
| the glass (K40b) | `--frost-0/1/2` | bay · chrome · raised; each resolves to the tier it replaced at rest; the paper tiers on the Desk |
| the ember (K40c) | `--ember`, `--line-1/2/3` | the whisper of accent in every box border: 6% Darkroom, 4% Desk; the gate mirrors `--line-2` and its drift test holds it |
| the glass (K50; the seams' lines K40d → K49 are gone) | `--seam-rim` (transparent; `--line-2` on the Desk), `--glass-lip`, `--glass-edge`; derived `--seam-halo` from `--seam-halo-a` / `--seam-halo-r` | no line is a stroke: the rim paints nothing and a box shows the slab's thickness — the lip and the top, scaled by the halation (the side hairlines went in K50d), nothing on paper (§5.15) |
| the seam dials (K41) | `--seam-level`, `--haze-gain` | the seam's brightness (0..1; the core, the halation and the canvas strips) and the room's haze (0..3, squared by the engine; 1.5 shipped); the Desk needs neither — `--bloom-gain: 0` is the one switch |
| the ignition (K41b; JS since K78) | retired: `--ignite`, `--ignite-at`, `--ignite-dur`, `--ignite-breath`, `--ignite-breath-at`; `--floor-crest` on `.room-floor` | the cold start's curve and clock are chrome.js's (`IGNITE_CURVE`, `IGNITE_DUR_MS`); the floor's layer is drawn at the crest and faded by opacity |
| the primary source (K41d) | `--haze-boost` | per host, multiplies the haze alone (0..4, default 1); `.sidebar` sets 2.4 and is the only source that should |
| light layers and warm hover (K45) | `data-light-layer` (markup), `.lighting-layer` (the engine's canvas); `--warm-fill` | §5.12; on paper the warm fill is the paper's raised tier |
| the backlight (K44) | `@property --backlight`; `--backlight-panel/-panel-warm/-card/-card-warm`, `--backlight-overhang/-soft/-y`, `--backlight-haze`, `--backlight-haze-card`; `--glass-near/-far`, `--glass-body` (on the host); the field well `--well-top/-bottom` and `--emit-panel-warm` (K46); `--r-surface`, `--r-control`; `--cap-ink/-top/-bottom/-edge/-chamfer/-bloom/-legend` | §5.11; the Desk maps the glass to paper and the cap to tint-and-edge |
| floating controls (K46 → K50) | `@property --float-glow`, `--float-k`, `--key-border`, `--key-body`, `--key-edge`, `--float-ink/-ink-hot`, `--float-rise/-fall`; `@property --row-warm`, `--row-lens` (on `.nav-btn`) | §5.13, §5.15; a key is a well with no stroke; the Desk sets `--float-k` 0, `--key-border` to cold iron and the keys back to ink |
| the content's light (K49, K50) | `--light-content-backlight`, `--light-content-haze` (root; the phone's in "THE PHONE'S LIGHT"); `--light-adapt` | §5.14; read by the engine for the light layers only; `--light-adapt` is eye adaptation's strength (§5.15), 0 off |
| the emission ladder (K43) | `--emit-panel/-card/-card-warm/-field/-field-warm/-field-hot`, `--haze-panel/-card/-field`, `--tier-rise/-fall`, `--tier-lift`, `--edge-cold/-warm`, `--rule/-v`; derived `--seam-rim`, `--seam-halo-k`; `@property --seam-level` | the levels of every non-structural line (§5.10); the Desk maps the edges and rules to ink and the lift to `--shadow-1` |
| the planes (2026-10-02) | `--substrate-pores`, `--plane-rest`, `--plane-shadow`; per overlay `--plane-x/-y/-rx/-ry`, `--plane-haze` | the membrane as a CSS image for the air above the scrim; how much of a plane's light stays once open; the plane's reflective lift (none in the Darkroom, `--shadow-3` on the Desk) |
| the substrate (K41e → K50) | `--substrate-gain`; `--substrate-pores`, `--substrate-size` (written by the engine) | the membrane the light falls on, 0..1 (0.55 shipped); a mask on the light's alpha, so 0 is no pass and the black ground is never touched; in device pixels since K50, one tile for every copy |
| the lamp dial (K40d) | `--lit-level` | per-surface brightness the engine multiplies in (0..1); `.nav-btn[data-lit]` sets 0.3 |
| the text classes (2026-10-06) | `--text-stat/-act/-act-warm/-live/-hot`, `--text-gain`, `--text-flare-dur`, `--flare-at` (per text, written by `text-light.js`); derived `--text-k`; `@property --text-emit`, `@property --text-flare` | §5.17; in their own `:root` in TYPE, with the type roles `--type-*`; the Desk sets the gain to 0 |
| the SMD part (2026-10-06) | `--led-rgb`, `--smd-size` (on `.lm-smd`), with the shared `--led-bezel`, `--led-spec` | §5.17 |
| focus | `--focus-ring` | K37 |

---

## 7. How to add an emitter

1. Decide what rung it is. If it is not *lit* (on) or *hot* (in flight), it is
   not an emitter — give it cold iron and a warm hover and stop.
2. Put the attribute on the thing that emits, not its container. `data-lit`
   for on, `data-heat` (via `heat()`) for in flight. Set `--lit-rgb` on it only
   if it needs a tone other than the accent.
3. The engine finds it. Do not touch `lighting.js`; it names no surface and a
   test fails if it does.
4. If it is a rod, use `.lm-rod`. If it is a button, it already has the strike.
5. Keep it small. A panel does not emit; the thing *in* the panel does.
6. Bump `?v=` on `field-console.css` (and any JS you touched) everywhere it is
   referenced, and the `dev/sw.js` `CACHE` name once.
7. **It is there from the first frame** (K84). Never hide a light source until
   data arrives: on a device that keeps nothing, data comes with the sync, a
   second or more into the cold start, and the emitter appears late, already
   lit. If there is nothing to say, say less; the hardware stays in its slot.
   (`tests/console-field-guide.test.js`.)
8. **It joins the ignition.** What the engine lights does so by itself. A CSS
   lamp is dark while `<html data-ignition>` is set until a clock takes it, then
   written as opacity: its resting value × `ignitionLevel()`, never quite 1 (a
   layer crossing opacity 1 is re-composited in WebKit), on its own layer while
   it runs. `bridge.js _seatShip` is the pattern.
9. **Measure it** in real browsers against the build before: frames, not
   script (canvas and compositing costs never show in JavaScript timings), one
   suspect per control run, and a recording's one-frame blips checked against a
   control before they are believed.

**To add a seam (K41 → K50):** draw no line. Give the host a tier
(`data-tier="panel|card"`) or the bay's recipe, and put `data-seam="box"` on
it — the engine pools and hazes off its perimeter, and the tier's
`--glass-edge` draws the slab's thickness at the tier's level. Do not put
`data-seam` on a container to light something inside it: the attribute names
an edge of *that* box. Since K50 no host draws a 1px line along an edge
(`--seam` and its family are gone); a divider between rows is `--rule`, a
divider between surfaces is spacing. **One exception, a lip (K81):** the ship
station's mail slot carries `data-seam="bottom"` on its opening, so the light
leaves the slot's lower edge and its haze falls downward (`seamStrips`' `out`),
like light under a door; its dial is the seam's own `--seam-level`, moved by
state and transitioned only under `prefers-reduced-motion: no-preference`, and
the engine follows it as it moves. A light that must rise for an event uses a
class on its host that moves that dial, not `data-heat`: the generic hot rule
would filter the whole control. **A part's own lamps on the cold start (K82):**
a lamp that is not the engine's (CSS light on a module's face) is dark while
`<html data-ignition>` is set until the part's clock takes it, then written as
opacity (its resting value times the room's curve, never quite 1, on its own
layer while it runs), so it comes up with the room instead of sitting lit on a
black screen (`bridge.js _seatShip`, after `_sweepGauge`).

**To add text (2026-10-06):** give it a role for its size and ink, then a
class: `data-text="stat|act|live|info"`, by the four questions in §5.17. Write
no `text-shadow`. If a moment of the surface's own needs light (something went
live), call `sweep(root)` from `js/console/text-light.js` on the part of the
page that reports it. On the Bridge, paint through the type kit (`say.figure`,
`say.label`, `say.meta`, `say.line` in `bridge.js`), which writes the role and
the class together.

---

## 8. What is deliberately not done yet

- **Help's marks still spell heat `data-warm`/`data-hot`** on their own private
  elements, and the gate's rail has its own copy of the anatomy. Both are the
  same physics; migrating them to `.lm-rod` + `data-heat` is a mechanical pass
  that touches 19 pinned tests and the gate's drift test, and it was not the
  work this session was for.
- **`--light-rim` on emissive surfaces.** The 4% white rim on every raised
  edge is a reflective cue that the Darkroom's medium cannot justify, and the
  owner's read of the rod's crown says the eye agrees. Not changed here: 58
  shadows derive from it and it still reads on the Desk. If it goes, it goes
  as one token in STUDIO, not as a sweep.
- **Selection as *lit* — done for legends (K40b).** The current view, tab,
  bench filter, cards segment/pill, layout chip, RAW-lens tool, pulse lane and
  sheet item carry `--lit-legend`. Slots, swatches and frames stay unlit.
- **More glass.** Only chrome, bays, the publish panel and toasts transmit.
  The Cards studio well, the FN drawer and the sheets are candidates; each is
  one token swap once a light is licensed beneath it.
- **Backdrop blur on the topbar and sidebar.** Not added: transmission does
  the frost and the light is pre-blurred; a real blur would cost a compositor
  pass per scrolled frame under each bar. Revisit only with a measurement.
- **The two-buffer split** (a steady layer composited once, a live layer per
  frame). Worth it only past a few dozen emitters; the sprite cache makes it
  unnecessary at the console's count.
- **Tilt-registered light** (`tactile-touch-pass.md` A2) — the engine now has a
  frame loop it can borrow for the duration of a tilt; still an opt-in behind
  an iOS permission gesture, still not built.
- **The mockup's "Option 2: waveguide"** (K41) — a bright anamorphic streak at
  the *centre* of every seam. Declined: a seam is fed from an edge (the
  owner's own K40d read of the reference), and a centre-bright line says the
  source is the middle of the line, which nothing in the console is. The
  filament model shipped.
- **An in-console optics HUD** (the mockup's panel of sliders). Not built: the
  dials are two tokens on `:root`, and a live panel is product surface every
  fork would ship. If the owner wants to tune by eye, the honest first step is
  a DevTools override of `--haze-gain` / `--seam-level`; a hidden `?optics`
  panel is a small follow-up if that proves too fiddly.
- **The pool sprite's own margin** equals its blur (two σ, 13% clipped) — K38's
  geometry, unchanged here because the pool's far tier is dim enough that no
  edge shows. If it ever does, it takes the same three-σ margin the haze got.

---

## 9. Where the rules live now

| question | answer |
|---|---|
| what may light | design-spec §6.5 (the licence, amended 2026-09-25 to the ladder above) |
| how it lights | this document |
| the engine's promises | `tests/console-lighting.test.js` |
| the primitives' promises | `tests/console-emissive.test.js` (the bay, the strike, selection, toasts, the seams and their hosts), `tests/console-ignition.test.js`, `tests/console-help-marks.test.js`, `tests/console-gate-lighting.test.js` |
| the seams and the haze (K41) | `tests/console-lighting.test.js` ("the seams are emitters", "the room has haze"), `tests/console-emissive.test.js` ("the long rules are seams of light") |
| the bays' hover and wake, the cover bay, the frame caps, the planes (2026-10-02) | `tests/console-planes.test.js` |
| the backlight, the glass, the cap, the corners (K44) | `tests/console-backlight.test.js`, `tests/console-lighting.test.js` ("the backlight") |
| the emission ladder and its catalog (K43) | `tests/console-emission-ladder.test.js`, `tests/console-lighting.test.js` ("the emission ladder") |
| the glass and the stack | `tests/console-lighting-css.test.js` ("under the glass", "frosts the chrome") |
| the ladder's promises | `tests/console-lighting-css.test.js` |
| the text classes and the update (2026-10-06) | `tests/console-text-classes.test.js`; every Bridge word classified, in `tests/console-bridge.test.js` |
| a light source is never hidden at load (K84); the station's seat (K82–K85) | `tests/console-field-guide.test.js`, `tests/console-send-out.test.js` |
| motion budget | `docs/ideas/motion-language.md` (one heartbeat; bounded curves are not heartbeats) |
| the research | `docs/ideas/vitreous-phosphor-lighting-spec.md`, `avionics-communicator-system.md`, `field-console-lighting.html` (the bench), `emissive-seams-mockup.html` (the owner's K41 mockup), and the analogs.network light engine |
