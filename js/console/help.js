// ============================================================================
// HELP — "what does this do?", answered at the control being asked about.
//
// The console's only explanation channel before this was the `title=` tooltip.
// A tablet cannot show one, and the console's own iPad pass already ruled out
// hover-gated affordances (manual §5.17). So the teaching copy that existed was
// invisible to exactly the person most likely to need it, and the ledger has the
// receipts: a cold-run tester "clicked around and didn't know things", and a bug
// filed as a caching failure turned out to be a missing sentence
// (docs/maintenance/2026-08-10-quickstart-v1-and-maintenance-mode.md).
//
// THREE STATES, and the middle one is the point:
//
//   off    — nothing rendered. Only the `?` key is listening.
//   browse — every control on this view that has an entry wears a mark: a
//            hairline field and a FILAMENT along its edge, cold until you are
//            on it (2026-09-21; the brackets it replaced are in the manual).
//            A HUD line says to pick one.
//   card   — you tapped one. Its filament ignites, the screen dims around
//            that control and ONE card unfurls out of the rod to explain it.
//            Tap anywhere → back to browse (the rod cools). Esc → browse.
//
// Why one card and not all of them: the design sketch this came from drew every
// card at once with curved leader lines and a collision resolver, and in the
// owner's own screenshot three of the six cards were clipped or overlapping. A
// solver that is 90% right is a permanent tax that breaks again every time a
// field is added to a form. One card needs no solver, fits a phone, and does not
// decay as the console grows.
//
// Why the copy lives here and not in the markup: it is ENGINE copy. Every fork
// ships it verbatim, so it carries no instance name, no domain, and never names
// one discipline as the category (docs/os-positioning.md §"Vocabulary rules").
// tests/console-help.test.js holds that line mechanically — including a
// banned-jargon list, because the whole feature is worthless the moment it
// starts sounding like the thing it is explaining.
//
// This module imports NOTHING. It reads the active view off the DOM and finds
// its targets by selector, which is what lets it sit second in the layer order
// and explain surfaces that are drawn entirely by modules far above it.
// ============================================================================

// ---- THE COPY ---------------------------------------------------------------
// `view: '*'` is the top bar — offered on every view. Everything else names a
// real `#view-<name>` section.
//
// Shape is the rep rhythm the preflight gym proved on this audience
// (docs/maintenance/2026-08-10-…:139): what it does → what that means for you →
// and, in `note`, the NON-result named so it reads as a state rather than a
// failure ("leave it and the middle of the frame is used").
//
// `sel` is a CSS selector, not an id, because the newest surfaces (Cards, Pulse)
// are rendered entirely from JS and hang their structure on classes. Entries
// whose target is not on screen right now are skipped silently — that is also
// what keeps a config-gated view (Bench) and a not-yet-rendered panel honest.
export const HELP = [
  // ---- the top bar — present on every view ----
  {
    sel: '#publish-btn', view: '*',
    title: 'Publish',
    body: 'Opens the page where you send your work live. Nothing you do anywhere else in here reaches your site until you go there and press publish.',
    note: 'The dot lights up when something is waiting.',
  },
  {
    sel: '#topbar-stage-stat', view: '*',
    title: "What's waiting",
    body: 'Counts the changes you have made that are not live yet. It goes back to nothing the moment you publish.',
    note: 'Every change counts as one, including removing something.',
  },
  {
    sel: '#sys-lamp', view: '*',
    title: 'The activity lamp',
    body: 'Your status light. It stirs while the console is busy in the background and settles when it is done.',
    note: 'Press it for a list of what just happened.',
  },
  {
    sel: '#pulse-topbar-btn', view: '*',
    title: 'Post a pulse',
    body: 'A one-line note that appears on your site within seconds. It is the one thing in here that does not wait for publish.',
    note: 'It clears itself later — it is not meant to last.',
  },
  {
    sel: '#theme-toggle', view: '*',
    title: 'Studio or daylight',
    body: 'Switches this console between dark and light. Dark for working on pictures indoors, light for working in the sun.',
    note: 'Only the console changes. Your site is untouched.',
  },
  {
    sel: '#settings-topbar-btn', view: '*',
    title: 'Settings',
    body: "Where your sign-in, your site's basics and the console's own options live.",
    note: 'The small dot appears when something in there needs you.',
  },

  // ---- buffer ----
  {
    sel: '#buffer-dropzone', view: 'buffer',
    title: 'Drop work here first',
    body: 'Anything you drop lands here and waits. Nothing needs a title, a date or a description — the date is read out of the file itself.',
    note: 'This is the fast lane. Tidy it up later, or never.',
  },
  {
    sel: '#buffer-raw-lens-btn', view: 'buffer',
    title: 'Straight off the card',
    body: 'Opens a reader for camera card files and pulls the full-size picture out of each one, right here on your own machine.',
    note: 'Nothing is sent anywhere while you browse.',
  },
  {
    sel: '#burst-link-btn', view: 'buffer',
    title: 'Group a sequence',
    body: 'Turns on linking. Pick two or more frames from the same moment and they become one swipeable set on your site instead of separate posts.',
    note: 'Each frame keeps its own number, so older links still work.',
  },
  {
    sel: '#buffer-display', view: 'buffer',
    title: 'The marks under each frame',
    body: 'Every frame carries a small row of controls — feature it, move it into your curated collection, or retire it.',
    note: 'Pressing the same mark again undoes it.',
  },

  // ---- archive ----
  // The pair the 2026-08-10 log named as Trap 2: two near-identical buttons,
  // side by side, doing different jobs, explained only in a tooltip.
  {
    sel: '#archive-focal-btn', view: 'archive',
    title: 'The part to keep',
    body: 'Your work gets cropped into squares and other shapes around the site. Drop a pin on what matters and every crop keeps it in view.',
    note: 'Leave it and the middle of the frame is used.',
  },
  {
    sel: '#archive-card-crop-btn', view: 'archive',
    title: 'The tall homepage card',
    body: 'Your homepage shows one piece taller than it really is. This sets what that taller version includes.',
    note: 'Leave it and it follows the pin you set above.',
  },
  {
    sel: '.gear-memory', view: 'archive',
    title: 'Remembered kit',
    body: 'The camera, lens and medium you type are kept on this device and offered back next time you fill the form.',
    note: 'Any words work — it is not a fixed list.',
  },
  {
    sel: '#archive-stage-btn', view: 'archive',
    title: 'Add to the archive',
    body: 'Files this piece, with its title and details, into your curated collection. It still waits for publish like everything else.',
    note: 'Smaller versions for the web are prepared as you do it.',
  },

  // ---- field notes ----
  {
    sel: '.fn-bar-telemetry, #fn-sync', view: 'fn',
    title: 'It saves itself',
    body: 'Your writing is saved as you type. This row tells you when it last happened, and how much you have written.',
    note: 'You never have to press save.',
  },
  {
    sel: '.fn-dock, .fn-btn--insert', view: 'fn',
    title: 'Drop things into the writing',
    body: 'The insert tools. Put a frame, a picture, a video, a track or a day right where the cursor is, without leaving the page.',
    note: 'Each one becomes a permanent reference that keeps working.',
  },
  {
    sel: '#fn-preview-btn', view: 'fn',
    title: 'See it as a reader will',
    body: 'Shows the finished note beside what you are typing, without closing anything.',
  },
  {
    sel: '.fn-btn--stage', view: 'fn',
    title: 'Ready to go out',
    body: 'Marks this note as finished and lines it up for the next publish.',
    note: 'Saving is not the same thing — a saved note stays private.',
  },

  // ---- wall ----
  {
    sel: '#wall-dropzone', view: 'wall',
    title: 'The wallpaper gallery',
    body: 'A separate page of images made to be downloaded and set as desktop backgrounds. Nothing here touches your main gallery.',
  },
  {
    sel: '#wall-url', view: 'wall',
    title: 'Adding one by name',
    body: 'If a picture is already stored with your site, type its filename here instead of dropping the file again.',
  },

  // ---- network ----
  {
    sel: '#ring-card', view: 'friends',
    title: 'A ring of independent sites',
    body: 'An optional list of sites run by other people making things. Joining adds a small link in your footer and changes nothing else.',
    note: 'Off unless you ask to join.',
  },
  {
    sel: '#friends-name', view: 'friends',
    title: 'Sites you point people to',
    body: 'Anyone you add shows up on your about page. A name is enough; the rest is optional.',
  },

  // ---- library ----
  {
    sel: '#library-dropzone', view: 'library',
    title: 'A shelf, not a page',
    body: 'Pictures and video parked here are ready to use but are not on your site yet. Pick them later from anywhere that asks for an image.',
  },
  {
    sel: '#library-display', view: 'library',
    title: 'What is on the shelf',
    body: 'Everything you have parked. None of it is visible to anyone until you place it somewhere.',
  },

  // ---- audio ----
  {
    sel: '#audio-dropzone', view: 'audio',
    title: 'One home for sound',
    body: 'Tracks, episodes and voice memos all live here, however they arrived. Each gets its own page and can be dropped into your writing.',
    note: 'The shape of the sound is measured once, so listeners never wait for it.',
  },
  {
    sel: '#audio-feed-card', view: 'audio',
    title: 'Ready for podcast apps',
    body: 'Your tracks can be followed in any podcast app. This card lists whatever is still missing before you can submit them.',
    note: 'Ignore it entirely and your tracks still play on your site.',
  },
  // A shelf with no tracks on it shows neither of these; they appear with the
  // first upload, which is exactly when someone wants them (owner, 2026-09-19).
  {
    sel: '.aud-row .aud-main', view: 'audio',
    title: 'What a track carries',
    body: 'Its name, the shape of the sound, how long it runs, and the address it lives at. The shape is measured once when you drop it in.',
    note: 'The address is permanent once published, so a link you shared keeps playing the same thing.',
  },
  {
    sel: '.aud-row .aud-actions', view: 'audio',
    title: 'What you can do with it',
    body: 'Put it on your homepage, add it to the feed people follow, offer it as a download, drop it into whatever you are writing, share it, or change its details.',
    note: 'The first two are different: your homepage holds a few, the feed holds everything you mark for it.',
  },
  {
    sel: '#audio-new-set-btn', view: 'audio',
    title: 'A set is a playlist',
    body: 'A named, ordered run of tracks with its own address you can share.',
    note: 'Once published, that address is yours for good — it is never handed to anything else.',
  },

  // ---- cards ----
  {
    sel: '.cards-head', view: 'cards',
    title: 'Now, and next',
    body: 'Your homepage twice over: what it holds right now, and what your next publish will make it. Only the next one can be changed.',
  },
  {
    sel: '.cards-ribbon', view: 'cards',
    title: 'The slots',
    body: 'Your homepage holds a set number of pieces. This strip shows which slot each one has taken.',
  },
  {
    sel: '.cards-grid, .cards-studio', view: 'cards',
    title: 'The tiles',
    body: 'A sketch of your homepage, arranged by the same rules your real site uses — so what you see here is what lands.',
  },

  // ---- pulse ----
  {
    sel: '#pulse-line', view: 'pulse',
    title: 'One line, live now',
    body: 'Say what you are doing in a sentence. It goes up within seconds and clears itself later.',
  },
  {
    sel: '#pulse-palette', view: 'pulse',
    title: 'The mark beside it',
    body: 'A small glyph that sets the tone of the line. Pick one or leave it.',
  },
  {
    sel: '#pulse-post-btn', view: 'pulse',
    title: 'Straight out',
    body: 'Sends the line to your site immediately. This is the only thing in the console that does not wait for publish.',
  },

  // ---- bench ----
  {
    sel: '.bench-grid-container, #bench-grid', view: 'bench',
    title: 'The workbench',
    body: 'A queue for pieces you want to come back to and finish properly. Each one carries its own notes and its own stage.',
  },
  {
    sel: '.filter-bar', view: 'bench',
    title: 'Narrow the list',
    body: 'Shows only the pieces at one stage of work.',
  },

  // ---- publish ----
  {
    sel: '.publish-summary', view: 'publish',
    title: 'What is waiting',
    body: 'One tile per part of your site, with how much has changed. Press one to read the list.',
  },
  {
    sel: '#gh-publish-btn', view: 'publish',
    title: 'Send it all live',
    body: 'Takes everything waiting and sends it out in one go. It is all or nothing — there is no half-published state to get stuck in.',
    note: 'Give it a couple of minutes to appear.',
  },
  {
    sel: '#site-export-btn', view: 'publish',
    title: 'A copy you can hold',
    body: 'Downloads your whole published site as one file: pages, work and words. Open it from a memory stick with no internet at all.',
    note: 'It doubles as a backup.',
  },
];

// ---- STATE ------------------------------------------------------------------
// A synchronous variable, not a class on the DOM. Every close in this console
// defers `.hidden` by 230–380ms so the animation can finish, which makes the DOM
// an unreliable guard for a key handler firing in between (js/console/share.js
// learned this the hard way — see its Escape note).
let _mode = 'off';            // 'off' | 'browse' | 'card'
let _lit = [];                 // [{ item, el, mark }] while browsing
let _target = null;            // the element the open card explains
let _wired = false;
let _touch = false;            // was the last pointer down a finger or a pen?
let _settle = 0;               // the timer that re-seats the marks after a touch scroll

const GUTTER = 16;             // keep the card this far off every edge
const PAD = 4;                 // breathing room around the lit control
const SETTLE_MS = 140;         // scroll quiet this long = the page has come to rest

/**
 * How much of the bottom of the screen the tab bar owns right now, measured
 * rather than derived from a breakpoint. The bar comes and goes for four
 * different reasons — width, pointer type, the FN bar-hide toggle, and the
 * on-screen keyboard — and a card placed under it is a card you cannot read.
 */
/**
 * Is the card presenting as a sheet rather than beside its control?
 *
 * WIDTH only. This also tested `(pointer: coarse)` until 2026-09-19, which made
 * every touchscreen a sheet — an iPad Pro in landscape and a touch laptop
 * included, where a two-sentence card then stretched across 1366 or 1920px.
 * Width is also the honest question: the sheet exists because no side of a
 * phone-width control has room for a 300px card beside it, and at 1024px every
 * side does. It is testable, too — a desktop browser cannot be made to report a
 * coarse pointer, so the old rule had a branch that only shipped devices ran. */
function _isSheet() {
  return window.matchMedia('(max-width: 700px)').matches;
}

function _bottomInset() {
  const bar = document.querySelector('.tabbar');
  if (!bar) return 0;
  const cs = getComputedStyle(bar);
  if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
  const r = bar.getBoundingClientRect();
  if (!r.height) return 0;
  return Math.max(0, Math.round(window.innerHeight - r.top));
}

/** The topbar's mirror. Measured, not read off `--topbar-h`, for the same
 *  reason: the bar is one element and its height is whatever it renders as. */
function _topInset() {
  const bar = document.querySelector('.topbar');
  if (!bar) return 0;
  const cs = getComputedStyle(bar);
  if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
  const r = bar.getBoundingClientRect();
  if (!r.height) return 0;
  return Math.max(0, Math.round(r.bottom));
}

/**
 * The field a control's mark is allowed to occupy — and the reason there is
 * more than one.
 *
 * The console has two fixed bars, the topbar and (on the tab-bar band) the
 * bottom bar, and **the content scrolls under both**. Marks did not: they were
 * clipped to the WINDOW, so a region taller than the screen had its mark drawn
 * from y=0, a red frame lying across the wordmark and the header controls with
 * the topbar's own marks sitting inside it. Owner, 2026-09-19: *"I guess my
 * expectation is that they would fold underneath the header like everything
 * else."*
 *
 * So a mark on a CONTENT control gets the content's field and disappears under
 * the bars exactly as its control does. A mark on a control that IS a bar gets
 * the whole window — that control is not under anything, and clipping it to
 * the content would erase the very marks the header needs.
 *
 * It follows for the spotlight too, because both are cut from this one rect:
 * un-dimming the topbar to show off a control in the scroller would light the
 * wrong thing.
 */
/** A control that IS one of the fixed bars — it scrolls with nothing. */
function _onBar(el) {
  return !!el?.closest?.('.topbar, .tabbar');
}

export function _fieldFor(el) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (_onBar(el)) {
    return { top: 0, bottom: vh, left: 0, right: vw };
  }
  return { top: _topInset(), bottom: vh - _bottomInset(), left: 0, right: vw };
}

function _activeView() {
  return document.querySelector('.view.active')?.id.replace(/^view-/, '') ?? null;
}

/** Entries whose target is on this view AND actually on screen right now. */
function _entriesForView() {
  const view = _activeView();
  const out = [];
  for (const item of HELP) {
    if (item.view !== '*' && item.view !== view) continue;
    // A selector may name alternatives, because a surface can render one of two
    // shapes for the same job — the Cards view is a grid OR a studio, Field
    // Notes puts its insert tools in a dock OR in the bar. The first one that is
    // actually on screen wins; the rest are simply the other layout.
    let el = null;
    for (const part of item.sel.split(',')) {
      const one = part.trim();
      if (!one) continue;
      el = item.view === '*'
        ? document.querySelector(one)
        : document.querySelector(`#view-${item.view} ${one}`);
      // A real box, not merely a rect: an empty container (the save readout
      // before the first save, the bench grid with nothing queued) reports
      // width but zero height, and spotlighting a hairline says nothing.
      if (el && el.getBoundingClientRect().height >= 4) break;
      el = null;
    }
    if (!el) continue;
    out.push({ item, el });
  }
  return out;
}

/** The overlay's own furniture, built once and reused. */
function _layer() {
  let el = document.getElementById('help-layer');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'help-layer';
  el.className = 'help-layer';
  el.innerHTML =
    '<div class="help-catch" id="help-catch"></div>'
    + '<svg class="help-scrim" id="help-scrim" aria-hidden="true">'
    + '<defs><mask id="help-scrim-mask" maskUnits="userSpaceOnUse">'
    + '<rect id="help-scrim-field" x="0" y="0" fill="#fff"></rect>'
    + '<g id="help-scrim-holes"></g><g id="help-scrim-fixed"></g></mask></defs>'
    + '<rect id="help-scrim-fill" x="0" y="0" mask="url(#help-scrim-mask)"></rect>'
    + '</svg>'
    + '<div class="help-marks" id="help-marks"></div>'
    + '<div class="help-hole" id="help-hole"></div>'
    + '<div class="help-glow" id="help-glow"></div>'
    + '<div class="help-arm-glow" id="help-arm-glow"></div>'
    + '<div class="help-card" id="help-card" role="dialog" aria-live="polite" tabindex="-1"></div>'
    + '<div class="help-bar" id="help-bar">'
    + '<span class="help-bar-text">Pick anything marked'
    + ' <span class="help-bar-count" id="help-bar-count"></span></span>'
    + '<button class="help-bar-btn" type="button">Done <kbd>Esc</kbd></button>'
    + '</div>';
  document.body.appendChild(el);
  return el;
}

// ---- BROWSE -----------------------------------------------------------------

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/**
 * Browse mode. The target itself is left ALONE — it borrows a tab stop and
 * nothing else. What you see is drawn over it, in this module's own element,
 * for two reasons that are not taste:
 *
 *   An outline on the target can LOSE. It competes with that control's own
 *   rules and `overflow: hidden` on any ancestor clips it, which is how the
 *   first pass came out as grey dashes that read as disabled.
 *
 *   And this layer promised to change no other module's appearance. A class
 *   that restyles ten arbitrary controls is what it promised not to be.
 *
 * The mark is a machinist's: a hairline field and two corner brackets, lifted
 * from ANALOGS.NETWORK's own `.frame`. It does not glow — design-spec.md §6.5
 * licenses light for things that are DOING something, and ten controls marked
 * as available-to-ask-about are selection, not liveness.
 */
function _outline(on) {
  for (const { el, mark } of _lit) {
    el.classList.remove('help-target');
    // Only ever remove what we added.
    if (el.dataset.helpTab === '1') { el.removeAttribute('tabindex'); delete el.dataset.helpTab; }
    mark?.remove();
  }
  _lit = [];
  const host = document.getElementById('help-marks');
  if (host) host.textContent = '';
  if (!on) return;
  for (const { item, el } of _entriesForView()) {
    el.classList.add('help-target');
    // Half the explained targets are plain containers — the dropzones, the gear
    // block, the publish tiles, the card ribbon. A mouse can point at them and
    // a keyboard cannot reach them at all, which would make the help itself the
    // least accessible thing in the console. They borrow a tab stop while help
    // is on, and hand it straight back.
    if (!el.matches(FOCUSABLE)) { el.setAttribute('tabindex', '0'); el.dataset.helpTab = '1'; }
    const mark = document.createElement('div');
    mark.className = 'help-mark';
    // Which control this frame belongs to. Nothing reads it at runtime — it is
    // here so the overlay can be inspected and audited without re-deriving the
    // table's order, which is NOT the DOM's order and quietly mis-pairs
    // anything that assumes it is.
    mark.dataset.helpFor = item.sel;
    // A control IN a bar never scrolls, so its mark stays put when a finger
    // scrolls the content (see _onScroll) — the stylesheet reads this.
    if (_onBar(el)) mark.dataset.fixed = '';
    // The touch point: a glass rod in a channel along the control's edge, cold
    // iron until you are on it, lit only once you have picked it. Static
    // markup — every state it has is an attribute the stylesheet reads
    // (data-warm, data-press, data-hot), so this module never styles it.
    mark.innerHTML = '<div class="help-filament"><span class="help-strand"><i class="help-core"></i></span></div>';
    host?.appendChild(mark);
    _lit.push({ item, el, mark });
  }
  const count = document.getElementById('help-bar-count');
  if (count) count.textContent = `· ${_lit.length} on this screen`;
  _placeMarks();
}

/**
 * Punch the scrim. The console dims and these rectangles stay at full
 * brightness — the real control showing through a real gap, not a lightened
 * copy of it.
 *
 * Card mode used to do this with the hole's own `box-shadow` spread past the
 * viewport, which is ten lines and perfect for ONE hole. Browse needs one per
 * marked control plus the `?` itself, and N spread-shadows stack into N layers
 * of dark, each one covering the others' holes. A mask is the tool that takes
 * a list.
 */
function _cutScrim(rects) {
  const svg = document.getElementById('help-scrim');
  if (!svg) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const id of ['help-scrim-field', 'help-scrim-fill']) {
    const r = document.getElementById(id);
    r.setAttribute('width', w);
    r.setAttribute('height', h);
  }
  // Two groups: what scrolls, and what sits on a bar. Under a finger the first
  // is hidden while the page moves (see _onScroll) and the second stays cut.
  const holes = document.getElementById('help-scrim-holes');
  const fixed = document.getElementById('help-scrim-fixed');
  holes.textContent = '';
  fixed.textContent = '';
  const screen = w * h;
  for (const r of rects) {
    if (!r || r.width < 1 || r.height < 1) continue;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    // To the hundredth, not the pixel. Rounding moved a hole up to half a
    // pixel off its control, which a padded hole hides and a flush one (the
    // `?`, see _armRect) shows as a bright sliver down one side.
    el.setAttribute('x', r.left.toFixed(2));
    el.setAttribute('y', r.top.toFixed(2));
    el.setAttribute('width', r.width.toFixed(2));
    el.setAttribute('height', r.height.toFixed(2));
    el.setAttribute('rx', String(r.rx ?? 3));
    // A mask reads LUMINANCE: black hides the scrim completely, white keeps it,
    // and grey lifts it part way. Small controls get black — a real gap. The
    // buffer's contact sheet is 75% of the screen, and cutting that out did not
    // highlight it, it switched the dim off: the thumbnails stayed at full
    // brightness and nothing looked dimmed at all (owner, 2026-09-19). Past
    // roughly a fifth of the screen the lift ramps down, so a big region reads
    // as RAISED while its contents still sit under the veil.
    const frac = (r.width * r.height) / screen;
    const lift = frac <= 0.10 ? 1 : Math.max(0.2, 1 - (frac - 0.10) / 0.25);
    const v = Math.round(255 * (1 - lift));
    el.setAttribute('fill', `rgb(${v},${v},${v})`);
    (r.fixed ? fixed : holes).appendChild(el);
  }
}

/**
 * A control's box, padded, and clipped to what is actually on screen — where
 * "on screen" is the control's FIELD (see _fieldFor), not the window.
 *
 * The buffer's contact sheet measures 29,148px tall — the whole scrollable
 * grid — so its unclipped box put the mark's bottom-right bracket a screen and
 * a half below the fold, and made the "how big is this" sum meaningless. A mark
 * is a picture of what you can SEE, same as the spotlight — and what you can
 * see of a scrolling control stops at the fixed bar it slides under.
 *
 * The one place both the mark and the scrim hole get their box, which is why
 * the fold only had to be written once.
 */
export function _visibleRect(el, pad = PAD, field = _fieldFor(el)) {
  const b = el.getBoundingClientRect();
  const left = Math.max(field.left, b.left - pad);
  const top = Math.max(field.top, b.top - pad);
  return {
    left,
    top,
    width: Math.max(0, Math.min(field.right, b.right + pad) - left),
    height: Math.max(0, Math.min(field.bottom, b.bottom + pad) - top),
  };
}

/**
 * The `?` stays lit while it is on, so it is a hole too.
 *
 * TIGHT, and that matters. It was padded by 10px, which un-dimmed a hard-edged
 * rectangle twice the size of the button — and a hard edge around a glow is
 * what makes it read as a sticker rather than as something emitting (owner,
 * 2026-09-19: "it feels like it was pasted on in photoshop"). The falloff is
 * _placeArmGlow's job; this is just the crisp control.
 *
 * And FLUSH, since 2026-09-22. At 2px it still cut a ring out of the button's
 * own halo (`--lit-halo`, a 12px glow): full strength inside the ring, dimmed
 * outside it, so the `?` wore a hard square of light. At 0 the hole ends on the
 * button's own border, and the whole halo sits evenly under the dim, where the
 * pool above takes over.
 */
function _armRect() {
  const btn = document.getElementById('help-topbar-btn');
  if (!btn || !btn.getBoundingClientRect().height) return null;
  // Flush means the corners too: the padded holes' 3px rounding would dim the
  // four corners of a square button.
  const rx = parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 0;
  return { ..._visibleRect(btn, 0), fixed: true, rx };
}

/**
 * The bloom around the armed `?`. The element IS the button's box, and the
 * stylesheet hangs the light off its outline in tiers (see `.help-arm-glow`).
 *
 * Two drafts before this, both shapes of their own. First a circle 1.6× the
 * button, which the window's top edge sliced while still at ~10%. Then an
 * ellipse fitted to the bar, which no edge could cut, and which the owner
 * called exactly (2026-09-22): "it looks pasted on not like physical light".
 * Light takes the shape of its emitter, so the emitter's box is all this
 * places. Returns the box, for the test.
 */
export function _placeArmGlow() {
  const glow = document.getElementById('help-arm-glow');
  const btn = document.getElementById('help-topbar-btn');
  if (!glow || !btn) return null;
  const r = btn.getBoundingClientRect();
  if (!r.height) { glow.style.display = 'none'; return null; }
  const box = { left: r.left, top: r.top, width: r.width, height: r.height };
  glow.style.display = 'block';
  glow.style.left = `${box.left}px`;
  glow.style.top = `${box.top}px`;
  glow.style.width = `${box.width}px`;
  glow.style.height = `${box.height}px`;
  // Round like the lamp: square corners blur round on their own, and a
  // rounded button must not bloom from a square box.
  glow.style.borderRadius = getComputedStyle(btn).borderTopLeftRadius;
  return box;
}

/** Marks follow their controls, on the listeners the spotlight already uses. */
function _placeMarks() {
  // Browse needs the tab bar's height too — the HUD line sits above it, and a
  // value only written in card mode left the line lying across the tab labels.
  document.getElementById('help-layer')?.style.setProperty('--help-foot', `${_bottomInset()}px`);
  for (const entry of _lit) _placeMark(entry);
  // The dim, and the reason the marks can now be quiet: the bright thing is the
  // control itself, not a colour laid over it.
  const cut = _lit
    .filter(({ mark }) => mark.style.display !== 'none')
    .map(({ el }) => ({ ..._visibleRect(el), fixed: _onBar(el) }));
  const arm = _armRect();
  if (arm) cut.push(arm);
  _cutScrim(cut);
  _placeArmGlow();
  _dockBar();
}

/**
 * Put one mark over its control — or hide it, when there is nothing honest to
 * draw. Shared by browse (every mark) and card mode (the hot one), because the
 * filament has to sit in exactly the same place in both.
 */
export function _placeMark({ el, mark }) {
  const r = el.getBoundingClientRect();
  const field = _fieldFor(el);
  // Scrolled off, or clipped to nothing by a scroller or by a bar: draw no
  // mark rather than a sliver pinned to an edge.
  if (r.bottom <= field.top || r.top >= field.bottom
      || r.right <= field.left || r.left >= field.right || r.height < 4) {
    mark.style.display = 'none';
    return;
  }
  const box = _visibleRect(el, PAD, field);
  // …and the same for what is LEFT once the bars have taken their share: a
  // control with 3px showing under the topbar gets no mark, not a hairline
  // that reads as the bar's own underline.
  if (box.height < 6 || box.width < 6) { mark.style.display = 'none'; return; }
  mark.style.display = 'block';
  mark.style.left = `${box.left}px`;
  mark.style.top = `${box.top}px`;
  mark.style.width = `${box.width}px`;
  mark.style.height = `${box.height}px`;
  // Only the edges the CONTROL actually has. A target taller than the screen
  // used to get a full frame drawn at the viewport boundary — a hairline that
  // is really the window's edge, not the thing's, and one that slides as you
  // scroll. An edge clipped away simply is not drawn.
  const edges = [];
  if (r.top - PAD >= field.top) edges.push('t');
  if (r.left - PAD >= field.left) edges.push('l');
  if (r.bottom + PAD <= field.bottom) edges.push('b');
  if (r.right + PAD <= field.right) edges.push('r');
  mark.dataset.edges = edges.join(' ');
  // The filament rides the control's bottom edge — under it, where a caption
  // goes. When that edge is under a bar it moves to the top; when both are, it
  // is not drawn at all, for the reason the hairline is not: a rod lying along
  // the window's edge is the window's, not the thing's. The control is still
  // there to press; it just has no rod, and the field says which it is.
  mark.dataset.lamp = edges.includes('b') ? 'b' : edges.includes('t') ? 't' : '';
}

/**
 * Put the HUD line where it is not standing on a mark. Three berths, tried in
 * order, exactly like the card's four sides — bottom-right, bottom-left, then
 * top-centre, where the worst it can cover is the view's own title.
 *
 * On a phone the stylesheet collapses those to two, both full width: above the
 * tab bar and under the top bar. It still has to choose, and more so — a single
 * column puts marked controls at the bottom of the screen constantly, and with
 * one berth the line hid 85% of one of them.
 */
function _dockBar() {
  const bar = document.getElementById('help-bar');
  if (!bar) return;
  // Cost is how much of each mark a berth would take away, as a fraction of
  // that mark — not how many it touches. Clipping a corner off the buffer
  // contact sheet costs nothing you needed; sitting on a 21px readout erases
  // the control.
  //
  // Two weights, because the line has two kinds of surface. The bar passes taps
  // THROUGH to whatever it covers, so overlapping it only obscures. The button
  // does not, so overlapping that is the control gone — and it is weighted an
  // order of magnitude higher. On Field Notes at phone width both berths
  // overlap something, and this is what puts the button on the side that costs
  // nothing rather than over the save readout.
  const btn = bar.querySelector('.help-bar-btn');
  const slice = (a, m) => {
    const w = Math.min(a.right, m.right) - Math.max(a.left, m.left);
    const h = Math.min(a.bottom, m.bottom) - Math.max(a.top, m.top);
    if (w <= 0 || h <= 0) return 0;
    const own = m.width * m.height;
    return own > 0 ? (w * h) / own : 1;
  };
  const cost = (dock) => {
    if (dock) bar.dataset.dock = dock; else delete bar.dataset.dock;
    const b = bar.getBoundingClientRect();
    const t = btn?.getBoundingClientRect();
    let c = 0;
    for (const { mark } of _lit) {
      if (mark.style.display === 'none') continue;
      const m = mark.getBoundingClientRect();
      c += slice(b, m) * 0.12;
      if (t) c += slice(t, m);
    }
    return c;
  };
  let best = null;
  let bestCost = Infinity;
  for (const dock of [null, 'bl', 'tc']) {
    const c = cost(dock);
    if (c === 0) return;                       // free berth: take it and stop
    if (c < bestCost) { bestCost = c; best = dock; }
  }
  cost(best);
}

function _enterBrowse() {
  const layer = _layer();
  const was = _target;
  // Back from a card, the marks are still there — card mode faded the others
  // and heated the one you picked. Keep them: the rod then COOLS on the
  // --arm-cool curve, which a rebuilt mark could not do, and the view under
  // them cannot have changed while every click was absorbed.
  const fromCard = _mode === 'card' && _lit.length > 0;
  _mode = 'browse';
  _hideCard();
  if (fromCard) {
    for (const { mark } of _lit) mark.removeAttribute('data-hot');
    _placeMarks();
  } else {
    _outline(true);
  }
  layer.classList.add('open');
  layer.classList.remove('carded');
  document.body.classList.add('help-on');
  // The console's own vocabulary for a control that is currently doing
  // something: data-lit gets the fill, the edge and the halo, and
  // js/console/lighting.js finds it by that attribute and pools light around it
  // without being told this surface exists.
  document.getElementById('help-topbar-btn')?.setAttribute('data-lit', 'accent');
  // Coming back from a card, the control you asked about keeps the focus, so a
  // keyboard carries on from where it was rather than at the top of the view.
  if (was?.isConnected) was.focus({ preventScroll: true });
  document.getElementById('help-topbar-btn')?.setAttribute('aria-expanded', 'true');
}

// ---- CARD -------------------------------------------------------------------

function _hideCard() {
  _target = null;
  const layer = document.getElementById('help-layer');
  layer?.classList.remove('carded');
}

/**
 * Place the card on the first side that fits: below, above, right, left. Four
 * cases and a clamp — deliberately not a solver. With one card on screen there
 * is nothing to collide with, so "does it fit in the viewport" is the whole
 * question. Under 700px (or on a coarse pointer) CSS lifts the card into a
 * bottom sheet and this positioning is ignored entirely.
 */
function _placeCard(card, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight - _bottomInset();
  if (_isSheet()) {
    card.style.left = '';
    card.style.top = '';
    // Which edge the sheet takes is decided by where the control ended up, not
    // by a breakpoint. A bounded view (Field Notes, Pulse) pins its actions to
    // the bottom of the screen and cannot scroll them anywhere — a bottom sheet
    // lands squarely on them — so a control sitting low gets a sheet at the top
    // instead. Everything else has already been lifted into the upper band.
    card.dataset.side = (rect.top + rect.height / 2) > vh / 2 ? 'sheet-top' : 'sheet';
    return;
  }
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const fits = {
    below: rect.bottom + 10 + h <= vh - GUTTER,
    above: rect.top - 10 - h >= GUTTER,
    right: rect.right + 10 + w <= vw - GUTTER,
    left: rect.left - 10 - w >= GUTTER,
  };
  const side = ['below', 'above', 'right', 'left'].find((s) => fits[s]) ?? 'below';
  let x;
  let y;
  if (side === 'below' || side === 'above') {
    x = rect.left + rect.width / 2 - w / 2;
    y = side === 'below' ? rect.bottom + 10 : rect.top - 10 - h;
  } else {
    x = side === 'right' ? rect.right + 10 : rect.left - 10 - w;
    y = rect.top + rect.height / 2 - h / 2;
  }
  card.dataset.side = side;
  const cx = Math.max(GUTTER, Math.min(vw - w - GUTTER, x));
  const cy = Math.max(GUTTER, Math.min(vh - h - GUTTER, y));
  card.style.left = `${cx}px`;
  card.style.top = `${cy}px`;
  // The clamp above can slide the card sideways off the control — a top-bar
  // button near the right edge is the usual one — and a pointer pinned to the
  // card's own centre then aims at empty chrome. Point it at the control.
  const along = (side === 'below' || side === 'above')
    ? { axis: '--arrow-x', v: rect.left + rect.width / 2 - cx, span: w }
    : { axis: '--arrow-y', v: rect.top + rect.height / 2 - cy, span: h };
  card.style.setProperty(along.axis, `${Math.max(12, Math.min(along.span - 12, along.v))}px`);
}

const VIEW_LABEL = {
  buffer: 'Buffer', archive: 'Archive', fn: 'Field Notes', wall: 'Wall',
  friends: 'Network', library: 'Library', audio: 'Audio',
  cards: 'Cards', pulse: 'Pulse', bench: 'Bench', publish: 'Publish',
};

function _paintCard(item) {
  const card = document.getElementById('help-card');
  card.textContent = '';
  // Which surface this belongs to, in the console's own sub-line voice. The
  // top-bar entries say "Everywhere", because they are.
  const eyebrow = document.createElement('div');
  eyebrow.className = 'help-card-eyebrow';
  eyebrow.append(
    document.createTextNode(item.view === '*' ? 'Everywhere' : (VIEW_LABEL[item.view] ?? item.view)),
    document.createElement('i'),
  );
  card.append(eyebrow);
  const h = document.createElement('h3');
  h.className = 'help-card-title';
  h.textContent = item.title;
  const p = document.createElement('p');
  p.className = 'help-card-body';
  p.textContent = item.body;
  card.append(h, p);
  if (item.note) {
    const n = document.createElement('p');
    n.className = 'help-card-note';
    n.textContent = item.note;
    card.append(n);
  }
  return card;
}

function _reflow() {
  // Let go under a finger: nothing on the content is showing, and _seat()
  // measures everything once the page stops. Doing it here — a ResizeObserver
  // tick, a resize — would spend the main thread in the middle of a flick.
  if (_mode === 'browse') { if (!_settle) _placeMarks(); return; }
  if (_mode !== 'card' || !_target) return;
  if (!_target.getClientRects().length) { _enterBrowse(); return; }
  // Clamped to the viewport, because the hole is a picture of what you can SEE.
  // A control can overhang the screen honestly (a long row scrolled halfway) or
  // by accident — #publish-btn measured 112px inside a 52px top bar until the
  // `.empty` collision was fixed — and in both cases spotlighting the
  // off-screen part is just a box with nothing in it.
  const rect = _visibleRect(_target);
  // Scrolled fully out of view: an explanation with its subject off-screen is
  // just a floating paragraph, so go back to browse and let them pick again.
  if (rect.width === 0 || rect.height === 0) { _enterBrowse(); return; }
  rect.right = rect.left + rect.width;
  rect.bottom = rect.top + rect.height;
  const layer = document.getElementById('help-layer');
  layer.style.setProperty('--help-foot', `${_bottomInset()}px`);
  _cutScrim([rect, _armRect()]);
  _placeArmGlow();
  const hole = document.getElementById('help-hole');
  hole.style.left = `${rect.left}px`;
  hole.style.top = `${rect.top}px`;
  hole.style.width = `${rect.width}px`;
  hole.style.height = `${rect.height}px`;
  // The pool, sized off the control rather than fixed: a chip throws a small
  // one and a dropzone a wide one, which is the difference between light and a
  // decal pasted on at one size.
  const spread = Math.max(64, Math.min(180, Math.max(rect.width, rect.height) * 0.55));
  const glow = document.getElementById('help-glow');
  glow.style.left = `${rect.left - spread}px`;
  glow.style.top = `${rect.top - spread}px`;
  glow.style.width = `${rect.width + spread * 2}px`;
  glow.style.height = `${rect.height + spread * 2}px`;
  _placeCard(document.getElementById('help-card'), rect);
  // The filament under the picked control stays, hot, and moves with it.
  const hot = _lit.find(({ el }) => el === _target);
  if (hot) _placeMark(hot);
}

/**
 * A scroll, and who is driving it.
 *
 * Under a mouse or a wheel the marks follow the page live, as they always have.
 * Under a FINGER they cannot: a phone or tablet scrolls on its own thread, and
 * this handler — and the marks it moves — only hear about it a frame or more
 * later. Each call also re-measures every mark and re-cuts the dim, 14ms on a
 * desktop Mac at phone width, so on a phone the marks moved in late jumps while
 * the controls glided under them (owner, 2026-09-22: the overlays "separate
 * from their objects as you scroll"). No amount of speed closes a gap that is
 * one thread behind by construction.
 *
 * So under touch the marks stop pretending to track. The first scroll of a
 * gesture lets go of them — they vanish and the dim closes over the page while
 * it moves — and once the page has been still for SETTLE_MS they are measured
 * ONCE, where everything now is, and fade back in. Momentum scrolling keeps
 * firing scroll events, so a flick holds them down until it actually stops.
 *
 * ⚠️ VANISH, don't fade. The first cut faded them out over --dur-1, which was
 * right for a slow drag and a tear on a flick (owner, same evening: "for the
 * muscle reaction flick … the fade still lags and registers as a tear"). A hard
 * flick moves the page a few hundred pixels in 120ms, and for all of it the
 * marks and the bright cut-outs sat where the controls USED to be. Anything
 * that lingers while the page races is a tear, so the way out is instant and
 * only the way back is eased. The stylesheet carries that asymmetry.
 *
 * Only the CONTENT lets go. A mark on a bar never moves, so it stays lit and
 * its cut-out lives in its own mask group — blinking the whole header on every
 * flick would be the overlay flickering, not getting out of the way.
 *
 * Browse only: in card mode the catch layer owns every touch, so the page
 * cannot be scrolled by a finger and any scroll is our own _bringIntoView,
 * which the spotlight has to follow exactly.
 */
function _onScroll() {
  if (_mode !== 'browse' || !_touch) { _reflow(); return; }
  _letGo();
}

/** Hide what the page is about to carry away, and (re)arm the settle. */
function _letGo() {
  document.getElementById('help-layer')?.classList.add('scrolling');
  clearTimeout(_settle);
  _settle = setTimeout(_seat, SETTLE_MS);
}

/** The page has come to rest: put every mark where its control now is, and show them. */
function _seat() {
  _settle = 0;
  if (_mode === 'browse') _placeMarks();
  document.getElementById('help-layer')?.classList.remove('scrolling');
}

/** Drop a pending re-seat — leaving browse, or opening a card, needs no settle. */
function _unsettle() {
  clearTimeout(_settle);
  _settle = 0;
  document.getElementById('help-layer')?.classList.remove('scrolling');
}

/** The nearest ancestor that actually scrolls — the console has fourteen. */
function _scrollerFor(el) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return document.querySelector('.main');
}

/**
 * Put the control somewhere the card can be read beside it.
 *
 * Two jobs, and they used to be one. A sheet owns the bottom of the screen, and
 * on a phone most controls ARE near the bottom — 13 of 82 explanations landed on
 * their own subject before this existed, so `reserve` is the card's height and
 * the control is lifted above it. But a control can simply be below the fold on
 * any width: at 760px, six of them were, and picking one did nothing visible
 * because the spotlight had no viewport left to draw in. Same scroll, same fix.
 *
 * A control taller than the free band (the buffer grid, the publish tiles)
 * cannot clear it entirely; its top in view is the honest best, and the hole
 * still says which one is meant.
 */
function _bringIntoView(el, reserve) {
  const top = 8;
  const floor = window.innerHeight - _bottomInset() - reserve - 8;
  const r = el.getBoundingClientRect();
  if (r.top >= top && r.bottom <= floor) return false;
  // A control TALLER than the band can never satisfy the test above, so it
  // scrolled every single time — picking a frame inside the buffer's contact
  // sheet hauled the whole grid up to put its top at 8px, and coming back to
  // browse the view had moved under you (owner, 2026-09-19: "the stroke over
  // the buttons shifts"). The marks were right; the scroll was the surprise.
  //
  // So for those, "enough of it is showing" replaces "all of it fits". Anything
  // that CAN fit keeps the original rule untouched — that is what stops a sheet
  // landing on its own subject on a phone, and it is not worth loosening.
  const band = floor - top;
  if (r.height > band) {
    const shown = Math.min(r.bottom, floor) - Math.max(r.top, top);
    if (shown >= band * 0.25) return false;
  }
  const scroller = _scrollerFor(el);
  if (!scroller) return false;
  // A control that fits rides a third of the way down, which reads as "this
  // one" rather than as a scroll. One taller than the band (a whole contact
  // sheet, the publish tiles) goes to the top instead: it is going to be partly
  // under the card whatever happens, so the useful move is to show as much of
  // it as the screen holds rather than to centre a thing that cannot be centred.
  const rest = r.height >= floor - top
    ? top
    : Math.max(top, Math.min(floor - r.height, top + (floor - top) * 0.3));
  const was = scroller.scrollTop;
  scroller.scrollTop += r.top - rest;
  return scroller.scrollTop !== was;
}

/**
 * The invariant, enforced rather than reasoned about: a sheet must never end up
 * on top of the control it explains. _bringIntoView and the edge choice in
 * _placeCard get this right today for all forty entries, but both depend on the
 * CARD'S HEIGHT, which depends on the copy — so editing one sentence could push
 * a card onto its target with nothing to catch it. This catches it: if less of
 * the spotlight is showing than the spotlight is tall, take the other edge.
 */
function _forceClear(el) {
  const card = document.getElementById('help-card');
  const hole = document.getElementById('help-hole').getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const top = card.dataset.side === 'sheet-top';
  const shown = top
    ? Math.min(hole.bottom, window.innerHeight) - Math.max(hole.top, cr.bottom)
    : Math.min(hole.bottom, cr.top) - Math.max(hole.top, 0);
  if (shown >= Math.min(24, hole.height)) return;
  card.dataset.side = top ? 'sheet' : 'sheet-top';
}

function _showCard(item, el) {
  _layer();
  _unsettle();
  _mode = 'card';
  _target = el;
  // The marks stay. The stylesheet fades every one but the picked control's,
  // whose rod ignites on --arm-heat — its resting rule already declares every
  // filter at zero, so the attribute alone is the ignition; no layout flush is
  // needed here the way setCommitArmed() needs one.
  for (const entry of _lit) {
    entry.mark.toggleAttribute('data-hot', entry.el === el);
    entry.mark.removeAttribute('data-warm');
    entry.mark.removeAttribute('data-press');
  }
  _paintCard(item);
  document.getElementById('help-layer').classList.add('carded');
  // The card is measurable as soon as it is shown, so the scroll happens BEFORE
  // the only reflow rather than after a throwaway one.
  const reserve = _isSheet() ? document.getElementById('help-card').offsetHeight : 0;
  _bringIntoView(el, reserve);
  _reflow();
  if (_isSheet()) _forceClear(el);
  // Focus LAST. The card is display:none until `carded` lands and the layout
  // flushes, and focus() on a hidden element is silently a no-op.
  document.getElementById('help-card').focus({ preventScroll: true });
}

// ---- ENTRY POINTS -----------------------------------------------------------

/** Turn help on, or off if it is already on. Bound to `?` and the top-bar button. */
export function helpToggle() {
  // Only the overlay check — NOT helpKeyBlocked(). Where the caret is decides
  // whether the KEY means "help" or "a question mark"; it says nothing about a
  // deliberate press of the button.
  if (_mode === 'off') {
    if (_overlayOwnsScreen()) return;
    _wire();
    _enterBrowse();
  } else {
    helpClose();
  }
}

/** Leave help entirely, from any state. */
export function helpClose() {
  _mode = 'off';
  _unsettle();
  _outline(false);
  _hideCard();
  const layer = document.getElementById('help-layer');
  layer?.classList.remove('open', 'carded');
  document.body.classList.remove('help-on');
  _cutScrim([]);
  const btn = document.getElementById('help-topbar-btn');
  btn?.removeAttribute('data-lit');
  btn?.setAttribute('aria-expanded', 'false');
}

/** True while help is showing anything — read by the key handler in init.js. */
export function helpIsOpen() { return _mode !== 'off'; }

/** An overlay already owns the screen, and Escape belongs to it. */
function _overlayOwnsScreen() {
  return !!document.querySelector(
    '.modal-overlay:not(.hidden), .sheet-overlay:not(.hidden), .rl-overlay:not(.hidden)',
  );
}

/**
 * Should the `?` KEY be ignored right now? Two reasons: you are typing — `?` is
 * a character and belongs in the field — or an overlay owns the screen.
 *
 * ⚠️ Only the key. This used to gate `helpToggle()` as well, on the reasoning
 * that two doors into one state should agree; they should not. Leaving help on
 * a view with a text field puts focus back in that field, and the next press of
 * the BUTTON then did nothing at all — a control that silently refuses because
 * of where the caret happens to be. Clicking the button is unambiguous.
 */
export function helpKeyBlocked() {
  const el = document.activeElement;
  if (el && el.matches?.('input, textarea, select, [contenteditable], [contenteditable="true"]')) return true;
  return _overlayOwnsScreen();
}

// ---- LISTENERS --------------------------------------------------------------
// Wired once, on first use, so a console that never opens help pays nothing.
function _wire() {
  if (_wired) return;
  _wired = true;

  // Capture phase, and it stops here. EVERY click in help mode is ours — which
  // is what stops a tap firing the control it is asking about, and is the whole
  // reason you can safely ask what Publish does.
  //
  // ⚠️ A click on the dim is ABSORBED, not an exit. It used to close help, and
  // that made a mode you were reading in disappear under an ordinary stray
  // click (owner, 2026-09-19: "too easy to click out of the help if I'm
  // clicking around"). There are three deliberate ways out — the `?` that let
  // you in, the Done button, and Escape — and no accidental ones.
  document.addEventListener('click', (e) => {
    if (_mode === 'off') return;
    e.preventDefault();
    e.stopPropagation();
    // The way out is the way in. The inline onclick on the button cannot fire
    // while help is open, because this handler stops the event first.
    if (e.target.closest?.('#help-topbar-btn') || e.target.closest?.('#help-bar')) {
      helpClose();
      return;
    }
    if (_mode === 'card') {
      if (!e.target.closest?.('#help-card')) _enterBrowse();
      return;
    }
    const hit = _lit.find(({ el }) => el === e.target || el.contains(e.target));
    if (hit) _showCard(hit.item, hit.el);
    // Anything else: absorbed.
  }, true);

  // Our own Escape, guarded on the synchronous state — NOT a line in init.js's
  // chain, which is bubble-phase and runs after the editor's.
  document.addEventListener('keydown', (e) => {
    if (_mode === 'off') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (_mode === 'card') _enterBrowse(); else helpClose();
      return;
    }
    // Tab to a marked control, then open it the way any control opens.
    if (_mode !== 'browse' || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (document.activeElement?.closest?.('#help-bar')) return;   // Done is real
    e.preventDefault();
    e.stopPropagation();
    // Absorbed for anything else focused, for the same reason a click is: the
    // keyboard must not reach a control the pointer cannot.
    const hit = _lit.find(({ el }) => el === document.activeElement);
    if (hit) _showCard(hit.item, hit.el);
  }, true);

  // The rod answers the touch before the tap. A pointer (or the keyboard's
  // focus) on a marked control warms its filament; a press sinks it into its
  // channel. Both are attributes on the mark and nothing else — the control
  // under the pointer is left exactly alone, as always — and both are inert
  // outside browse, so the listeners cost nothing while help is off.
  const markFor = (t) => _lit.find(({ el }) => el === t || el.contains?.(t))?.mark;
  const warm = (e) => {
    if (_mode !== 'browse') return;
    const m = markFor(e.target);
    for (const { mark } of _lit) mark.toggleAttribute('data-warm', mark === m);
  };
  document.addEventListener('pointerover', warm, true);
  document.addEventListener('focusin', warm, true);
  document.addEventListener('pointerdown', (e) => {
    if (_mode !== 'browse') return;
    markFor(e.target)?.setAttribute('data-press', '');
  }, true);
  for (const ev of ['pointerup', 'pointercancel']) {
    document.addEventListener(ev, () => {
      for (const { mark } of _lit) mark.removeAttribute('data-press');
    }, true);
  }

  window.addEventListener('resize', _reflow);
  // Late layout. A view can finish rendering AFTER help opens — Bench and
  // Publish both do, and the Cards view takes a network round trip — which
  // leaves every mark, and the HUD line's choice of berth, sitting on the
  // layout as it was a moment ago. An observer on the scroller catches the
  // content settling; `_reflow` is a no-op whenever help is off.
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => _reflow());
    const main = document.querySelector('.main');
    if (main) ro.observe(main);
  }
  // Capture, at the window. `scroll` does not bubble, so a listener on `.main`
  // never hears the console's fourteen nested scrollers — the Field Notes
  // canvas holds `.fn-dock`, which is an explained target, and scrolling it
  // left the spotlight stranded where the dock used to be.
  window.addEventListener('scroll', _onScroll, { passive: true, capture: true });
  // Who is driving the next scroll (see _onScroll). A pan starts with a
  // pointerdown before the browser takes it over, so the last one down names
  // the input; a wheel is always a mouse or a trackpad, whatever came before.
  // Read off the event, not a media query: a touch laptop is both.
  document.addEventListener('pointerdown', (e) => { _touch = e.pointerType === 'touch' || e.pointerType === 'pen'; }, true);
  // …and a finger's pointercancel is the browser saying "this touch is a
  // scroll now", sent as it takes the gesture over — before the first scroll
  // event reaches us. On a flick that head start is the difference.
  document.addEventListener('pointercancel', (e) => {
    if (_mode !== 'browse' || (e.pointerType !== 'touch' && e.pointerType !== 'pen')) return;
    _touch = true;
    _letGo();
  }, true);
  window.addEventListener('wheel', () => { _touch = false; }, { passive: true, capture: true });
}

/** Wired from init.js — the `?` key, and the outline refresh when a view changes. */
export function _initHelp() {
  document.addEventListener('keydown', (e) => {
    // `?` is Shift-something on most layouts, so shiftKey is expected and not
    // checked. The others are not ours: ⌘⇧/ opens the application Help menu on
    // macOS, and swallowing it would be taking a system shortcut.
    if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (_mode === 'off' && helpKeyBlocked()) return;
    e.preventDefault();
    helpToggle();
  });
}

