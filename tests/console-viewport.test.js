// @vitest-environment happy-dom
//
// The console's relationship with the viewport it is handed — the part that
// only misbehaves on a real installed tablet, which is exactly why it needs
// tests that do not require one.
//
// Written after an owner report from an iPad Mini on iPadOS 26: the Pulse
// studio's dock and both rail tails sat UNDER the glass tab bar, and the whole
// shell looked like it stopped short of the bottom of its window. Two separate
// causes, both invisible to the existing suite:
//
//   1. THE 900/1180 DESYNC. The tab bar turns on at `(max-width: 1180px),
//      (pointer: coarse)`. Pulse's own mobile rules start at 900px. An iPad
//      Mini in landscape is 1133px and coarse — it got the bar and none of the
//      clearance, and because a BOUNDED view never scrolls, the covered rows
//      were simply unreachable rather than merely below the fold.
//   2. THE PHANTOM KEYBOARD INSET. iPadOS 26 reports a visual viewport
//      persistently shorter than the layout viewport with no keyboard present,
//      so the raw difference is a standing offset, not the keys. Published
//      as --kb-inset it shortens every height-bound surface for the session.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const css = read('css/field-console.css');

// The band — where the tab bar exists. The stylesheet opens that query in
// several places (it is a band, not a section), so collect every block and
// brace-match each one: slicing to the first `}` would stop inside the first
// rule, and taking only the first block would miss the rule under test.
const BAND_OPEN = '@media (max-width: 1180px), (pointer: coarse) {';
const band = (() => {
  const blocks = [];
  for (let at = css.indexOf(BAND_OPEN); at >= 0; at = css.indexOf(BAND_OPEN, at + 1)) {
    let depth = 0;
    for (let i = at + BAND_OPEN.length - 1; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) { blocks.push(css.slice(at, i + 1)); break; }
    }
  }
  return blocks.join('\n');
})();

describe('a bounded view reserves the tab bar out of its HEIGHT', () => {
  it('the band query exists and was found', () => {
    expect(band, 'the tab-bar band query moved or was renamed').not.toBe('');
  });

  it('the clearance lives in THE BAND, not only in the 900px block', () => {
    // This is the regression. The clearance used to live only under
    // `max-width: 900px`, which every tablet in landscape sails straight past.
    expect(band).toMatch(/\.view--bounded\.active \{[^}]*--bounded-pad-b/);
  });

  it('the clearance counts the bar, the safe area AND the keyboard', () => {
    const rule = band.match(/\.view--bounded\.active \{[^}]*\}/)[0];
    expect(rule).toContain('--tabbar-rsv');
    expect(rule).toContain('--safe-bottom');
    expect(rule, 'the keys bury the dock without this').toContain('--kb-inset');
  });

  it('the bounded shell READS the variable instead of hardcoding a gutter', () => {
    // The shell's own rule is later in the file at equal specificity, so a
    // plain `padding-bottom` in the band would lose to its `padding`
    // shorthand — silently, and only on the devices that need it.
    // The shell's rule is the unindented one — the band's and the mobile
    // block's both sit inside a media query.
    const shell = css.match(/^\.view--bounded\.active \{[\s\S]*?\n\}/m)[0];
    expect(shell).toMatch(/padding:[^;]*var\(--bounded-pad-b/);
  });

  it('the shorthand that could clobber it is gone from the mobile block', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 900px)'));
    const rule = mobile.match(/^ {2}\.view--bounded\.active \{[\s\S]*?\n {2}\}/m)[0];
    expect(rule).toContain('--bounded-pad-b');
    expect(rule, 'a padding shorthand here overwrites the band again')
      .not.toMatch(/padding:\s/);
  });
});

describe('the no-scroll claim has a floor, and it is narrow', () => {
  const backstop = css.slice(css.indexOf('@media (max-height: 460px)'));

  it('a phone in landscape scrolls rather than clipping the dock', () => {
    // 390px tall leaves the stage ~120px for a card, a palette, three buttons
    // and a footer row. Reachable-below-the-fold beats unreachable-under-glass.
    expect(css).toContain('@media (max-height: 460px)');
    expect(backstop).toMatch(/\.view--bounded\.active \{[^}]*overflow-y: auto/);
  });

  it('the floor is under every device the studio was designed for', () => {
    // An iPad Mini in landscape is 744px tall and a phone in portrait ~844 —
    // both stay bounded. Raising this cliff would quietly give the whole
    // redesign's claim away.
    const cliff = Number(css.match(/@media \(max-height: (\d+)px\)/)[1]);
    expect(cliff).toBeLessThan(744);
  });
});

describe('the short-landscape stage turns sideways instead of squashing', () => {
  // A tablet in landscape keeps the three-rail canvas but not the height. The
  // card is the only flexible row, so it absorbed the whole shortfall and came
  // out a letterbox — a 4:5 preview that no longer matched what it previews.
  const sideways = css.slice(css.indexOf('(min-width: 901px) and (max-width: 1180px) and (max-height: 880px)'));

  it('is scoped to where the tab bar is, in both of the band\'s arms', () => {
    expect(css).toContain('(min-width: 901px) and (max-width: 1180px) and (max-height: 880px)');
    expect(css, 'a coarse tablet wider than 1180px has the bar too')
      .toContain('(min-width: 901px) and (pointer: coarse) and (max-height: 880px)');
  });

  it('gives the card every row of the stage', () => {
    expect(sideways).toMatch(/\.pulse-card-slot \{[^}]*grid-row: 1 \/ -1/);
  });

  it('keeps the DOM order — the grid places the rows, it does not reorder them', () => {
    // Screen-reader order is the source order; explicit placement must follow it.
    const rowOf = (sel) =>
      Number(sideways.match(new RegExp(`\\${sel}\\s*\\{ grid-column: 2; grid-row: (\\d)`))[1]);
    expect(rowOf('.pulse-stage-status')).toBeLessThan(rowOf('.pulse-palette'));
    expect(rowOf('.pulse-palette')).toBeLessThan(rowOf('.pulse-dock'));
    expect(rowOf('.pulse-dock')).toBeLessThan(rowOf('.pulse-more'));
  });

  it('stacks the dock — three buttons do not fit a 230px column', () => {
    expect(sideways).toMatch(/\.pulse-dock \{[^}]*flex-direction: column/);
  });
});

describe('the keyboard inset ignores a standing offset', () => {
  let chrome;

  beforeEach(async () => {
    document.body.innerHTML = '';
    chrome = await import('../js/console/chrome.js');
  });
  afterEach(() => {
    delete window.visualViewport;
    vi.restoreAllMocks();
  });

  const runWith = (visualHeight) => {
    const listeners = {};
    window.visualViewport = {
      height: visualHeight,
      width: 1133,
      offsetTop: 0,
      addEventListener: (ev, fn) => { listeners[ev] = fn; },
    };
    window.innerHeight = 744;
    chrome._initKeyboardInsets();
    return document.documentElement.style.getPropertyValue('--kb-inset');
  };

  it('publishes zero for the iPadOS 26 standing offset, not a fake keyboard', () => {
    // 744 - 705 = 39px with no keyboard anywhere. Published, it would shorten
    // the FN compose and the Pulse studio for the whole session.
    expect(runWith(705)).toBe('0px');
    expect(document.body.classList.contains('kb-open')).toBe(false);
  });

  it('still publishes a real keyboard in full', () => {
    expect(runWith(744 - 320)).toBe('320px');
    expect(document.body.classList.contains('kb-open')).toBe(true);
  });

  it('the deadband is the same threshold that already gated kb-open', () => {
    // One number, one meaning — a value that does not open the bar's duck must
    // not shorten the surfaces either.
    expect(chrome.KB_MIN).toBe(80);
    expect(runWith(744 - chrome.KB_MIN)).toBe('0px');
    expect(runWith(744 - chrome.KB_MIN - 1)).toBe(`${chrome.KB_MIN + 1}px`);
  });
});

describe('the bottom inset is not paid twice', () => {
  // Real numbers, iPad Mini (A17 Pro) / iPadOS 26.5.2 / installed to the Home
  // Screen, read off the console's own Display panel:
  //
  //   mode standalone · layout 744x1101 · screen 744x1133 · safe area t32 b20
  //
  // layout + safe-top == screen exactly, and the topbar's geometry confirms the
  // canvas starts at screen y=0 — so the 32px the system reserved for the
  // status bar is stranded BELOW the canvas. The device then also asks for a
  // 20px bottom inset for a home indicator that is already outside us.
  let chrome, __D;

  const device = ({ layoutH = 1101, layoutW = 744, screenW = 744, screenH = 1133,
                    safeBottom = 20, mode = 'standalone' } = {}) => ({
    safe: { top: 32, right: 0, bottom: safeBottom, left: 0 },
    layout: { w: layoutW, h: layoutH },
    visual: { w: layoutW, h: layoutH, offsetTop: 0 },
    screen: { w: screenW, h: screenH },
    dpr: 2,
    mode,
  });

  beforeEach(async () => {
    document.documentElement.style.removeProperty('--safe-bottom');
    chrome = await import('../js/console/chrome.js');
  });
  afterEach(() => vi.restoreAllMocks());

  it('pays nothing extra when the system already held more than the inset', () => {
    expect(chrome._correctSafeBottom(device())).toEqual({ held: 32, pad: 0 });
  });

  it('pays only the remainder when the system held less than the inset', () => {
    __D = device({ layoutH: 1125, safeBottom: 20 });   // held 8, inset 20
    expect(chrome._correctSafeBottom(__D)).toEqual({ held: 8, pad: 12 });
  });

  it('leaves a well-behaved device alone — the canvas reaches the floor', () => {
    __D = device({ layoutH: 1133, safeBottom: 20 });   // held 0
    expect(chrome._correctSafeBottom(__D)).toEqual({ held: 0, pad: 20 });
  });

  it('takes the screen axis by SIZE, so landscape is not compared to portrait', () => {
    // Same device turned sideways: screen still reports 744x1133 on some
    // engines, and comparing 1101 against 1133 there would invent a shortfall.
    __D = device({ layoutW: 1133, layoutH: 712, screenW: 744, screenH: 1133, safeBottom: 20 });
    expect(chrome._correctSafeBottom(__D)).toEqual({ held: 32, pad: 0 });
  });

  it('never ADDS padding — the correction can only ever reduce', () => {
    // held 233, far past the inset
    expect(chrome._correctSafeBottom(device({ layoutH: 900 })).pad).toBe(0);
  });

  it('leaves a browser tab alone — that gap is a window, not an inset', () => {
    __D = device({ mode: 'browser' });
    expect(chrome._correctSafeBottom(__D)).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('');
  });

  it('runs before the keyboard watcher, and re-runs when the device turns', () => {
    const init = read('js/console/init.js');
    expect(init).toContain('_initViewportFrame()');
    expect(init.indexOf('_initViewportFrame()'))
      .toBeLessThan(init.indexOf('_initKeyboardInsets()'));
    const fn = read('js/console/chrome.js')
      .match(/export function _initViewportFrame\(\) \{[\s\S]*?\n\}/)[0];
    expect(fn).toContain('orientationchange');
  });
});

describe('the console can report the viewport it was handed', () => {
  // An installed web app is a black box from the outside. A wrong safe-area
  // inset and a viewport shorter than its window produce an identical gap at
  // the bottom of the screen and want opposite fixes; these are the numbers
  // that tell them apart.
  it('the Settings panel has somewhere to put it', () => {
    expect(read('dev/field-console.html')).toContain('id="settings-display"');
  });

  it('opening Settings fills it, like the build stamp beside it', () => {
    const session = read('js/console/session.js');
    expect(session).toMatch(/import \{[^}]*renderViewportStamp[^}]*\} from '\.\/chrome\.js'/);
    const open = session.match(/export function openSettings\(\) \{[\s\S]*?\n\}/)[0];
    expect(open).toContain('renderViewportStamp()');
  });

  it('reads the safe-area insets back off a probe rather than assuming them', () => {
    // env() resolves only in CSS — JS has no other way to see what the device
    // actually reported, and assuming is what put us here.
    const src = read('js/console/chrome.js');
    const fn = src.match(/export function _viewportReadout\(\) \{[\s\S]*?\n\}/)[0];
    expect(fn).toContain('env(safe-area-inset-top');
    expect(fn).toContain('getComputedStyle');
    expect(fn, 'the probe is left in the document').toContain('probe.remove()');
  });

  it('reports every value needed to tell the two causes apart', async () => {
    const chrome = await import('../js/console/chrome.js');
    const r = chrome._viewportReadout();
    expect(r).toHaveProperty('safe.bottom');
    expect(r).toHaveProperty('layout.h');
    expect(r).toHaveProperty('screen.h');
    expect(r).toHaveProperty('mode');
  });
});

describe('the tablet pass — a wide, short screen spends width, not height', () => {
  // Reported from an iPad Mini in Safari (≈1133×620 of page): Archive ran
  // 2188px tall with 1620px of scroll under it, Publish 1242px, and both
  // pushed sideways. The cause was one expired rule, not a hundred small ones.
  // Assertions must read the RULES, not the prose. These comment blocks quote
  // the very declarations they warn against ("an unqualified
  // `#view-publish { display: grid }` would…"), so a raw text match finds the
  // warning and calls it the bug.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const tablet = strip(css.slice(css.indexOf('THE TABLET PASS')));

  it('the compose forms no longer collapse to one column at tablet width', () => {
    // THE REGRESSION. `@media (min-width: 921px) and (max-width: 1180px)` set
    // `.archive-compose, .fn-compose { grid-template-columns: 1fr }` because
    // the sidebar was assumed to still be on screen there. The tab-bar band
    // hides it, so the main column is ~1085px — and stacking put a full-width
    // 3:2 photo well (713px tall) above the form.
    const legacy = strip(css.slice(
      css.indexOf('@media (min-width: 921px) and (max-width: 1180px)'),
      css.indexOf('THE TABLET PASS')));
    expect(legacy).not.toMatch(/\.archive-compose[^{]*\{[^}]*grid-template-columns:\s*1fr/);
    expect(legacy).not.toMatch(/--sidebar-w/);
  });

  it('the photo well is capped, so it cannot grow with the window', () => {
    expect(tablet).toMatch(/\.compose-photo \.preview-wrap \{[^}]*max-height/);
  });

  it('the archive form pairs its fields instead of one per row', () => {
    expect(tablet).toMatch(/\.compose-form \{[^}]*grid-template-columns: 1fr 1fr/);
    // The rows that are already grids must still span, or the 3-up
    // camera/lens/medium row would be squeezed into half the form.
    expect(tablet).toContain('.compose-form > .field-row');
    // .field's own margin plus the parent gap was double-spacing every row.
    expect(tablet).toMatch(/\.compose-form \.field \{ margin-bottom: 0/);
  });

  it('publish lays its cards out two-up, and stays hidden when inactive', () => {
    // The two-up layout was written here and is no longer the tablet's alone:
    // desktop makes the same trade for the same reason, so the rule moved to a
    // `min-width: 901px` block in the PUBLISH VIEW section and the tablet pass
    // keeps only the sizes that are its own. Assert it against the whole
    // stylesheet, and pin the floor separately — a phone must keep the stack.
    const all = strip(css);
    expect(all).toMatch(/#view-publish\.active \{[^}]*display: grid/);
    // `.view { display: none }` hides inactive views — an unqualified
    // `#view-publish` would out-specify that and show it over every other view.
    expect(all, 'the grid rule must be scoped to .active')
      .not.toMatch(/#view-publish \{[^}]*display: grid/);
    // Two columns need a screen that can hold them. Whatever media block the
    // rule lives in, its opening query must carry a min-width, or a 375px
    // phone is handed a two-column settings panel.
    const at = all.indexOf('#view-publish.active {');
    const query = all.lastIndexOf('@media', at);
    expect(at, 'no two-up rule at all').toBeGreaterThan(0);
    expect(
      all.slice(query, all.indexOf('{', query)),
      'the two-up publish grid is not behind a min-width — phones get it too',
    ).toMatch(/min-width:\s*(9|\d{4})/);
  });

  it('the archive action row shares its width instead of overflowing', () => {
    // `.btn-full` is width:100%, so Stage + Clear asked for 100% + a button.
    expect(tablet).toMatch(/\.compose-form \.btn-row \.btn-full \{[^}]*width: auto/);
  });

  it('is scoped to tablets, in both arms of the band', () => {
    expect(css).toContain('@media (min-width: 901px) and (max-width: 1180px),\n       (min-width: 901px) and (pointer: coarse) {');
  });
});

describe('the publish queue is a settings surface, not a scroll', () => {
  // Owner report, 2026-09-19: the queue ran ~1180px of content in an 848px
  // pane on a 1512×900 desktop, and the counter rail — nine surfaces — broke
  // onto a second line with seven cards above and two beside a wide blank.
  //
  // Assertions read the RULES, not the prose: the comment blocks in the
  // stylesheet quote the very declarations they warn against, so a raw text
  // match would find the warning and call it the fix.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('the counter rail is one line, however many surfaces there are', () => {
    // THE BUG, and it is a class of bug: `repeat(7, 1fr)` with a comment
    // naming the seven surfaces, written when there were seven. Audio and
    // Cards made nine and the number stayed. A track count is a fact about the
    // markup — so this test DERIVES the count from the markup rather than
    // restating it, and would have failed the day the eighth card landed.
    const cards = (read('dev/field-console.html')
      .match(/class="summary-card"/g) || []).length;
    expect(cards, 'the publish view has no counter cards at all')
      .toBeGreaterThan(6);

    const rail = bare.match(/^\.publish-summary \{[\s\S]*?^\}/m);
    expect(rail, '.publish-summary has no base rule').toBeTruthy();

    const hardcoded = rail[0].match(/repeat\(\s*(\d+)/);
    expect(
      hardcoded && Number(hardcoded[1]),
      `the rail lays out ${hardcoded && hardcoded[1]} tracks for ${cards} counter `
      + 'cards. Even matched, a literal count goes stale the next time a surface '
      + 'is added — which is exactly how audio and cards ended up on line two.',
    ).toBeFalsy();

    // What replaces it: equal shares of whatever width is there. A zero basis
    // always fits, so the cards shrink together instead of wrapping.
    expect(rail[0], 'the rail is not a flex row').toMatch(/display:\s*flex/);
    expect(bare, 'the counter cards do not take an equal share')
      .toMatch(/^\.summary-card \{[\s\S]*?flex:\s*1 1 0/m);
    // A long label must clip, not wrap: a wrapped label makes its own card
    // taller than the eight beside it and the rail grows a second line again.
    expect(bare).toMatch(/\.summary-card \.label \{[^}]*white-space:\s*nowrap/);
  });

  it('one button on the surface is loud, and it is the one you press most', () => {
    // Red is this console's ONE loud colour and the publish surface was
    // spending it three times over: PUBLISH TO GITHUB filled, CLEAR STAGED
    // outlined beside it, EXPORT SITE (.ZIP) filled the same red one column
    // across. Owner, 2026-09-19: *"the publish to github only needs the full
    // red treatment all the time since it gets the most use."*
    const html = read('dev/field-console.html');
    const btn = (id) => html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';

    expect(btn('gh-publish-btn'), 'the primary lost its fill').toContain('btn-primary');
    for (const id of ['site-export-btn', 'gh-clear-staged-btn']) {
      expect(btn(id), `${id} is filled red again — that is three loud buttons`)
        .not.toContain('btn-primary');
      expect(btn(id), `${id} is not unlit at rest`).toContain('btn--unlit');
    }
    // Exactly one filled primary in the publish view, whatever gets added next.
    const view = html.slice(html.indexOf('id="view-publish"'),
      html.indexOf('</section>', html.indexOf('id="view-publish"')));
    expect((view.match(/btn-primary/g) || [])).toHaveLength(1);
  });

  it('unlit ignites for a keyboard, not only for a mouse', () => {
    // A control that only announces itself on hover is invisible to anyone
    // tabbing. Both arms, one rule.
    const lit = bare.match(/\.btn--unlit:hover,\s*\n?\s*\.btn--unlit:focus-visible \{[^}]*\}/);
    expect(lit, '.btn--unlit has no hover+focus-visible ignite').toBeTruthy();
    expect(lit[0]).toMatch(/color:\s*var\(--accent\)/);
  });

  it('unlit dims the colours, never the pixels', () => {
    // The first cut used `opacity: 0.55` — the topbar idle button's trick —
    // which put the label near 3.5:1 against the panel. That button is a
    // status light wearing a word; this one is a control you have to READ
    // before deciding to press it. Opacity here means one thing: disabled.
    const rest = bare.match(/^\.btn--unlit \{[^}]*\}/m);
    expect(rest, '.btn--unlit has no rest rule').toBeTruthy();
    expect(rest[0], 'unlit is dimming with opacity again').not.toMatch(/opacity/);
    expect(bare).toMatch(/\.btn--unlit:disabled[^{]*\{[^}]*opacity/);
  });

  it('a commit in flight still lights an unlit control', () => {
    // setCommitArmed() lights gh-clear-staged-btn among others, and the arm
    // recolours everything that is not already a filled primary. That only
    // reaches an unlit button if it is declared AFTER it — equal specificity,
    // source order decides. Armed and unlit at the same time would read as
    // "this control is off" during the one moment it is busy.
    const unlit = bare.indexOf('.btn--unlit {');
    const armed = bare.indexOf('[data-armed="on"]:not(.btn-primary)');
    expect(unlit, 'no .btn--unlit rule').toBeGreaterThan(-1);
    expect(armed, 'the arm no longer recolours non-primaries').toBeGreaterThan(-1);
    expect(armed, 'unlit now outranks the arm — armed controls stay grey')
      .toBeGreaterThan(unlit);
  });

  it('the panels carry no inline layout left over from the stack', () => {
    // Every one of these was a `style=` attribute placing a row by hand when
    // the view was one scrolling column: two panel margins, three centred
    // rows, a centred status line, four identical label styles. An inline
    // style can only be answered with !important, which is why the two-column
    // block could not simply left-align them. They are classes now.
    const html = read('dev/field-console.html');
    const view = html.slice(html.indexOf('id="view-publish"'),
      html.indexOf('</section>', html.indexOf('id="view-publish"')));
    for (const dead of [/justify-content:\s*center/, /text-align:\s*center/,
      /class="publish-action[^"]*"\s+style="margin-top/]) {
      expect(view, `${dead} is back in the publish markup`).not.toMatch(dead);
    }
    // …and the classes that replaced them exist in the stylesheet.
    for (const cls of ['.publish-act-row', '.se-tiers', '.se-tier', '.publish-legacy']) {
      expect(bare, `${cls} is used in the markup but has no rule`).toContain(cls);
    }
  });

  it('the two panels are named, not counted', () => {
    // `.publish-action:nth-of-type(1)` was the first attempt at "the publish
    // card, then the export card". They are both `div`s among other `div`s, so
    // nth-of-type counts siblings of type div and matched neither — silently,
    // with the layout falling back to auto-placement and looking nearly right.
    const html = read('dev/field-console.html');
    expect(html, 'the publish card lost its name').toContain('publish-action publish-commit');
    expect(html, 'the export card lost its name').toContain('publish-action publish-export');
    expect(bare, 'the layout is picking panels out by position again')
      .not.toMatch(/#view-publish\.active[^{]*\.publish-action:nth-/);
  });
});

describe('the split preview pane is gone, and stays gone', () => {
  // This block used to pin the two-pane compose grid's details — that its
  // preview carried no caption, that its action group sat at the trailing edge,
  // that portrait dropped the whole row. All three were patches on a layout
  // that has since been replaced outright: the preview is a slide-over overlay
  // now, and the writing surface is a single manuscript canvas.
  //
  // What is worth keeping from here is the negative: the pane must not come
  // back, because holding a live preview beside the writing is what made the
  // surface width-hungry — which is what wrapped the toolbar, which is what let
  // every autosave move the buttons. The studio's own invariants live in
  // tests/fn-studio.test.js. Reasoning:
  // docs/maintenance/2026-08-23-field-notes-studio.md.
  const html = read('dev/field-console.html').replace(/<!--[\s\S]*?-->/g, '');

  it('no second writing pane in the markup', () => {
    // `preview-pane` needs the boundary: the studio's own overlay is
    // #fn-preview-panel, which contains the dead name as a substring.
    for (const dead of [/\bpreview-pane\b/, /fn-compose/, /fn-pane-hdr/, /fn-portrait-bar/]) {
      expect(html, `${dead} is back — the split pane returned`).not.toMatch(dead);
    }
  });

  it('no rules left styling one', () => {
    for (const dead of ['.fn-compose', '.preview-pane', '.fn-pane-hdr', '.fn-portrait-bar']) {
      expect(css, `${dead} is back in the stylesheet`).not.toContain(dead);
    }
  });

  it('the preview is an overlay, and it renders only while it is open', () => {
    const js = read('js/console/fn-editor.js');
    // The old pane was always on screen, so it re-rendered markdown on every
    // keystroke and had no choice. A closed overlay must cost nothing.
    expect(js).toMatch(/export function fnRender\(\)\s*\{[^}]*if \(fnPreviewOpen\) _fnRenderPreview\(\)/);
  });
});


// ============================================================================
// THE HELP MARKS FOLD UNDER THE FIXED BARS
//
// The console has two fixed bars — the topbar, and on the tab-bar band a
// bottom one — and the content scrolls UNDER both. The help overlay's marks
// did not: they were clipped to the WINDOW, so a region taller than the screen
// had its mark drawn from y=0 — a red frame lying across the wordmark and the
// header controls, with the topbar's own marks sitting inside it. Owner,
// 2026-09-19, with a screenshot: *"I guess my expectation is that they would
// fold underneath the header like everything else."*
//
// This is geometry, so it is tested as geometry and not by reading the source:
// a stubbed topbar, tab bar and target, through the two functions the marks
// and the spotlight both go through.
// ============================================================================
const HELP_MOD = await import('../js/console/help.js');
const HELP_SRC = read('js/console/help.js');

describe('a help mark folds under the bars, like the thing it marks', () => {
  const VW = 1000;
  const VH = 620;
  const TOPBAR_H = 52;
  const TABBAR_H = 56;
  const PAD = 4;   // help.js's own breathing room, on the edges it keeps

  /** An element with the rect we say it has — happy-dom lays nothing out. */
  const at = (el, top, bottom, left = 100, right = 900) => {
    el.getBoundingClientRect = () => ({
      top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top,
    });
    return el;
  };

  const build = ({ tabbar = true } = {}) => {
    document.body.innerHTML =
      '<header class="topbar"><button id="chrome-btn"></button></header>'
      + '<div class="layout"><div class="main"><div id="target"></div></div></div>'
      + (tabbar ? '<nav class="tabbar"><button id="tab"></button></nav>' : '');
    at(document.querySelector('.topbar'), 0, TOPBAR_H, 0, VW);
    if (tabbar) at(document.querySelector('.tabbar'), VH - TABBAR_H, VH, 0, VW);
    window.innerWidth = VW;
    window.innerHeight = VH;
  };

  it('a content control gets the field between the bars', () => {
    build();
    const field = HELP_MOD._fieldFor(document.getElementById('target'));
    expect(field.top).toBe(TOPBAR_H);
    expect(field.bottom).toBe(VH - TABBAR_H);
  });

  it('a control that IS a bar gets the whole window', () => {
    // Clipping the header's own marks to the content area would erase exactly
    // the marks the header needs — that control is not under anything.
    build();
    const field = HELP_MOD._fieldFor(document.getElementById('chrome-btn'));
    expect(field.top).toBe(0);
    expect(field.bottom).toBe(VH);
  });

  it('a target scrolled under the topbar is cut at the bar, not at y=0', () => {
    build();
    const el = at(document.getElementById('target'), 20, 400);   // top under a 52px bar
    const box = HELP_MOD._visibleRect(el);
    expect(box.top, 'the mark is being drawn over the topbar again').toBe(TOPBAR_H);
    // The free edge still gets its padding; the clipped one gets none.
    expect(box.top + box.height).toBe(400 + PAD);
  });

  it('a target running under the tab bar is cut at the tab bar', () => {
    build();
    const el = at(document.getElementById('target'), 200, VH + 300);
    const box = HELP_MOD._visibleRect(el);
    expect(box.top + box.height).toBe(VH - TABBAR_H);
  });

  it('with no tab bar on screen the content field reaches the floor', () => {
    // Desktop: the bar is not rendered, and a mark must not stop short of the
    // bottom of a window with nothing in the way.
    build({ tabbar: false });
    expect(HELP_MOD._fieldFor(document.getElementById('target')).bottom).toBe(VH);
  });

  it('a hidden tab bar owns nothing — measured, never assumed from a breakpoint', () => {
    // The bar comes and goes for four reasons (width, pointer, the FN bar-hide
    // toggle, the on-screen keyboard), which is why _bottomInset measures it.
    build();
    document.querySelector('.tabbar').style.display = 'none';
    expect(HELP_MOD._fieldFor(document.getElementById('target')).bottom).toBe(VH);
  });

  it('the spotlight is cut from the same rect, so it folds too', () => {
    // One place computes the box for both the mark and the scrim hole.
    // Un-dimming the topbar to show off a control in the scroller would light
    // the wrong thing.
    const marks = HELP_SRC.slice(HELP_SRC.indexOf('function _placeMarks'));
    expect(marks, 'the marks stopped going through _visibleRect')
      .toMatch(/_visibleRect\(el, PAD, field\)/);
    expect(HELP_SRC, 'card mode stopped going through _visibleRect')
      .toMatch(/const rect = _visibleRect\(_target\)/);
  });

  it('an edge is only drawn where the control really ends', () => {
    // A hairline at the bar is the BAR's edge, not the thing's — the same
    // argument the module already made about the window's edge.
    const marks = HELP_SRC.slice(HELP_SRC.indexOf('function _placeMarks'));
    for (const side of ['field.top', 'field.left', 'field.bottom', 'field.right']) {
      expect(marks, `the ${side} edge test still measures the window`).toContain(side);
    }
  });
});

// 2026-09-22. The owner: on desktop, scrolling up to the drop zone "hesitates
// for like 1-2 seconds, and then perfectly snaps to the top row"; on a phone,
// "a lil resistance and choppy … like a glitch". Two causes, both about the
// console moving the page when the user had not asked it to.
describe('the console leaves the scroll where the user left it', () => {
  const RULES = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Proximity snapping on `.main`, with a point on every frame, reached
  // 247px at 1280×832. Stopping with the drop zone on screen was pulled
  // down to the first row. A shared scroller cannot snap safely.
  it('does not snap the main scroller, or seat snap points in its grids', () => {
    expect(RULES).not.toMatch(/scroll-snap-type:\s*y/);
    expect(RULES).not.toMatch(/\.buffer-grid\s*>\s*\*[^{]*\{[^}]*scroll-snap-align/);
    expect(RULES).not.toMatch(/\.archive-list\s*>\s*\*[^{]*\{[^}]*scroll-snap-align/);
  });

  // The header shrank 21px at the threshold. Scroll anchoring moved
  // scrollTop to compensate, back across the threshold, and it flipped 35
  // times in 1.5s. Compaction must leave the header's margin box, and so
  // everything after it, exactly where it was.
  const bandRule = (sel) => {
    const at = band.indexOf(`${sel} {`);
    expect(at, `${sel} in the band`).toBeGreaterThanOrEqual(0);
    const open = band.indexOf('{', at);
    return band.slice(open + 1, band.indexOf('}', open));
  };
  const px = (decl, prop) => {
    const m = decl.match(new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+);`));
    return m ? m[1].trim().split(/\s+/).map((v) => parseFloat(v)) : null;
  };

  it('compacts the header without moving anything below it', () => {
    const base = bandRule('.view:not(#view-fn) .view-header');
    const compact = bandRule('body.hdr-compact .view:not(#view-fn) .view-header');
    const [pt, , pb] = px(base, 'padding');         // 10px 32px 14px
    const [, , mb] = px(base, 'margin');             // 0 -32px 24px
    const cpt = px(compact, 'padding-top')[0];
    const cpb = px(compact, 'padding-bottom')[0];
    const cmb = px(compact, 'margin-bottom')?.[0];
    expect(cmb, 'compact must hand the padding back as margin').not.toBeUndefined();
    expect(cpt + cpb + cmb).toBe(pt + pb + mb);
    // …on the same curve, or the sum is only constant at the two ends.
    expect(base).toMatch(/transition:[^;]*padding var\(--dur-2\) var\(--ease-out\)[^;]*margin var\(--dur-2\) var\(--ease-out\)/);
  });

  it('shrinks the title with a transform, never a size', () => {
    const title = bandRule('body.hdr-compact .view:not(#view-fn) .view-title');
    expect(title).toMatch(/transform:\s*scale\(/);
    expect(title).not.toMatch(/font-size|margin|padding|height/);
  });

  describe('the compact switch has two thresholds', () => {
    let chrome;
    let main;
    let y = 0;
    const scrollTo = (v) => {
      y = v;
      main.dispatchEvent(new Event('scroll'));
    };
    const compact = () => document.body.classList.contains('hdr-compact');

    beforeEach(async () => {
      // Runs the frame at once and hands back 0, as if it had already fired:
      // the listener guards on the handle, and a live one would swallow every
      // later scroll.
      vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 0; });
      document.body.className = '';
      document.body.innerHTML = '<div class="main"></div>';
      main = document.querySelector('.main');
      Object.defineProperty(main, 'scrollTop', { get: () => y, configurable: true });
      chrome = await import('../js/console/chrome.js');
      chrome._initStickyHeaders();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('compacts past the top line and releases only near the top', () => {
      scrollTo(30);
      expect(compact()).toBe(true);
      // The loop's landing spot: anchoring pulled 30 → 9. It must hold.
      scrollTo(9);
      expect(compact()).toBe(true);
      scrollTo(5);
      expect(compact()).toBe(false);
      // …and on the way down, the band in between does not compact.
      scrollTo(15);
      expect(compact()).toBe(false);
      scrollTo(25);
      expect(compact()).toBe(true);
    });
  });
});
