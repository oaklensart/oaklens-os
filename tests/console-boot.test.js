// @vitest-environment happy-dom
//
// Boots the field console the way the browser does and checks that it actually
// came up.
//
// This exists because of a specific failure: during an earlier attempt to split
// console-ui.js, the `document.addEventListener("DOMContentLoaded", init)` line
// ended up in a module nothing imported. init() never ran, so nothing on the
// page was wired — and every test still passed, because no test had ever
// executed console code against a DOM. The console looked normal and did
// nothing.
//
// So this test does three things no other test does:
//   1. assembles the window bridge exactly as dev/field-console.html does,
//      reading the module list OUT of that file so the two cannot drift apart
//   2. proves the bridge is collision-free — Object.assign lets a later
//      namespace silently overwrite an earlier one, which would mean inline
//      handlers calling the wrong function with no error anywhere
//   3. fires DOMContentLoaded and asserts observable effects of init(), including
//      a real drag event to prove a listener is genuinely attached

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** Module specifiers from the bridge, in bridge order. */
function bridgeSpecifiers(html) {
  const script = html.match(/<script\s+type=["']module["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('No <script type="module"> bridge found in dev/field-console.html');
  return [...script[1].matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)]
    .map(([, ns, spec]) => ({ ns, spec }));
}

const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const specs = bridgeSpecifiers(html);

const namespaces = [];
const bootErrors = [];

beforeAll(async () => {
  // The console never reaches the network in this test: init() calls
  // loadOgCards() and checkAuth(), and an unstubbed fetch would either hang or
  // throw noise that masks the assertions below.
  globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

  // Real markup, minus its scripts — we play the role of the bridge ourselves.
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');

  window.addEventListener('error', (e) => bootErrors.push(e.message));

  for (const { ns, spec } of specs) {
    // '/js/console-ui.js' -> '../js/console-ui.js'. The bridge carries no ?v=
    // any more — the import map resolves versions in the browser, and Node
    // resolves the bare path straight to the file.
    const rel = `..${spec}`;
    const mod = await import(/* @vite-ignore */ rel);
    namespaces.push({ ns, spec, mod });
  }

  // The bridge itself.
  Object.assign(window, ...namespaces.map((n) => n.mod));

  document.dispatchEvent(new Event('DOMContentLoaded'));
  // init() schedules follow-up work; let microtasks settle before asserting.
  await new Promise((r) => setTimeout(r, 0));
});

describe('field console boots', () => {
  it('loads every module the bridge declares', () => {
    expect(specs.length).toBeGreaterThanOrEqual(7);
    expect(namespaces.length).toBe(specs.length);
    for (const { spec, mod } of namespaces) {
      expect(Object.keys(mod).length, `${spec} exported nothing`).toBeGreaterThan(0);
    }
  });

  it('puts every exported name on window', () => {
    const missing = [];
    for (const { spec, mod } of namespaces) {
      for (const name of Object.keys(mod)) {
        if (!(name in window)) missing.push(`${name} (from ${spec})`);
      }
    }
    expect(missing, 'Exported but absent from window — inline on*= handlers cannot reach these.').toEqual([]);
  });

  it('has no duplicate export names across bridge modules', () => {
    // Object.assign is last-wins and silent. Two modules exporting the same name
    // means one implementation is unreachable and the handlers that wanted it
    // quietly call the other. This is the single most likely way the upcoming
    // console-ui.js split breaks something without failing a test.
    const owners = new Map();
    const collisions = [];
    for (const { ns, mod } of namespaces) {
      for (const name of Object.keys(mod)) {
        if (owners.has(name)) collisions.push(`${name}: ${owners.get(name)} then ${ns} (${ns} wins)`);
        else owners.set(name, ns);
      }
    }
    expect(collisions, 'Duplicate export names on the window bridge.').toEqual([]);
  });

  it('runs init() on DOMContentLoaded', () => {
    // checkAuth() takes the logged-out branch (no token in localStorage) and
    // writes this exact string. If init never ran, the element is empty.
    const sync = document.getElementById('sync-status');
    expect(sync, '#sync-status missing from the markup').not.toBeNull();
    expect(sync.textContent).toBe('// Log in to enable auto-sync');
  });

  it('applies a theme during init', () => {
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
  });

  it('wires the dropzones — verified by a real drag event', () => {
    // Asserting a listener exists is not possible; asserting it *responds* is.
    // wireDropzone adds .over on dragover, so this fails if init() skipped it.
    const dz = document.getElementById('buffer-dropzone');
    expect(dz, '#buffer-dropzone missing from the markup').not.toBeNull();
    expect(dz.classList.contains('over')).toBe(false);

    dz.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    expect(dz.classList.contains('over'), 'dragover did not reach a handler — dropzone never wired').toBe(true);

    dz.dispatchEvent(new Event('dragleave', { bubbles: true, cancelable: true }));
    expect(dz.classList.contains('over')).toBe(false);
  });

  it('boots without throwing', () => {
    expect(bootErrors).toEqual([]);
  });
});

// The two seams that let chrome (toast/theme/routing/sheets) sit at the bottom
// of the module stack without importing the surfaces above it. Both replace a
// hard-coded table with registration, and both fail *silently* when a
// registration is missed — a dead nav button, a long press that does nothing —
// so each one is asserted rather than assumed.
describe('view registry', () => {
  it('registers a renderer for every data-view target in the markup', () => {
    const inMarkup = [...new Set(
      [...document.querySelectorAll('[data-view]')].map((el) => el.dataset.view)
    )].sort();
    const registered = window._registeredViews().sort();
    expect(inMarkup.length, 'no [data-view] targets found — selector is wrong').toBeGreaterThan(5);
    expect(registered, 'a nav/tab/sheet target with no registered renderer is a dead button')
      .toEqual(expect.arrayContaining(inMarkup));
  });

  it('routes to a view and runs its renderer', () => {
    let rendered = 0;
    window.registerView('__probe', () => { rendered++; });
    window.showView('__probe');
    expect(rendered, 'showView did not call the registered render()').toBe(1);
  });

  it('runs the outgoing view onLeave when navigating away, not on re-entry', () => {
    const seen = [];
    window.registerView('__leaver', { render: () => {}, onLeave: () => seen.push('left') });
    window.showView('__leaver');
    expect(seen, 'onLeave fired on entry').toEqual([]);
    window.showView('__leaver');
    expect(seen, 'onLeave fired when re-selecting the same view').toEqual([]);
    window.showView('buffer');
    expect(seen, 'onLeave did not fire when navigating away').toEqual(['left']);
  });

  it('exits Burst Link mode when leaving the buffer', () => {
    // The behaviour the old hard-coded `if (name !== "buffer" && burstLinkMode)`
    // line provided, now carried by the buffer's own onLeave. Link selection is
    // ephemeral and must not survive a surface switch.
    window.showView('buffer');
    window.enterBurstLinkMode();
    expect(document.body.classList.contains('buffer-link-mode'), 'link mode did not engage').toBe(true);
    window.showView('archive');
    expect(document.body.classList.contains('buffer-link-mode'), 'link mode survived leaving the buffer').toBe(false);
  });
});

describe('surface refresh registry', () => {
  it('repaints a surface without navigating to it', () => {
    let painted = 0;
    window.registerView('__refreshable', () => { painted++; });
    window.showView('buffer');
    const before = document.querySelector('.view.active')?.id;
    window.refreshSurface('__refreshable');
    expect(painted, 'refreshSurface did not run the registered render()').toBe(1);
    expect(document.querySelector('.view.active')?.id, 'refreshSurface navigated — it must not').toBe(before);
  });

  it('is a no-op for an unregistered surface', () => {
    // The upload queue maps a STATE key to a view name and passes the result
    // straight in; an unmapped surface must do nothing, exactly as the old
    // if/else chain did when no branch matched.
    expect(() => window.refreshSurface('nope')).not.toThrow();
    expect(() => window.refreshSurface(undefined)).not.toThrow();
  });

  it.each([
    ['buffer', 'buffer'],
    ['archive', 'archive'],
    ['wallpapers', 'wall'],
    ['library', 'library'],
  ])('a finished %s upload repaints the "%s" view', (surface, view) => {
    // Driven through the real _markEntryUploadDone() rather than by reading the
    // lookup table, because the failure this guards is the table being *wrong*:
    // the queue's STATE keys are not the view names ('wallpapers' → 'wall'), and
    // a bad entry silently stops that surface repainting after an upload with
    // nothing else going red.
    const original = window._registeredViews().includes(view);
    expect(original, `"${view}" is not a registered view`).toBe(true);

    let painted = 0;
    const realRender = () => {};
    window.registerView(view, () => { painted++; });
    try {
      window.STATE[surface] = [{ id: 'probe-1', _uploading: true }];
      window._markEntryUploadDone({ surface, entryId: 'probe-1' });
      expect(painted, `finishing a ${surface} upload did not repaint "${view}"`).toBe(1);
    } finally {
      window.STATE[surface] = [];
      window.registerView(view, realRender);
    }
  });
});

describe('field-notes editor defaults', () => {
  // What these two tests guarded — that reclaiming writing room must not take
  // the cover dropzone with it — is now structural rather than behavioural.
  // There is no collapse toggle: the note's id/place/date are ONE inline row
  // (.fn-meta), which is cheaper than the button that used to hide them. So the
  // assertion is that both are simply there, unconditionally, with nothing in
  // the markup able to switch either off.
  //
  // See docs/maintenance/2026-08-23-field-notes-studio.md § Not doing.
  it('the note\u2019s meta row and its cover are both always on screen', () => {
    const meta = document.querySelector('.fn-meta');
    const hero = document.getElementById('fn-hero-slot');
    expect(meta, '.fn-meta missing').not.toBeNull();
    expect(hero, '#fn-hero-slot missing').not.toBeNull();
    expect(meta.classList.contains('collapsed'), 'the meta row shipped collapsed').toBe(false);
    expect(hero.classList.contains('collapsed'), 'the cover shipped collapsed').toBe(false);
  });

  it('the collapse toggle is gone, not merely restyled', () => {
    // It came back once already, wearing a different label. If a future change
    // wants it back, it needs to argue with the log first.
    expect(document.getElementById('fn-collapse-btn'), 'the frontmatter collapse toggle is back').toBeNull();
    expect(typeof window.fnToggleFrontmatter, 'fnToggleFrontmatter is back').toBe('undefined');
  });

  it('every field the editor writes into exists in the shipped markup', () => {
    // The DOM contract between dev/field-console.html and fn-editor.js. A
    // rename on one side and not the other is a silent no-op at runtime — the
    // exact failure mode tests/inline-handlers.test.js was written for.
    for (const id of ['fn-doc-select', 'fn-id', 'fn-title', 'fn-location', 'fn-date',
                      'fn-body', 'fn-status-badge', 'fn-sync', 'fn-word-count',
                      'fn-read-time', 'fn-hero-slot', 'fn-hero-thumb', 'fn-preview',
                      'fn-preview-panel', 'fn-drawer', 'fn-menu', 'fn-delete-btn']) {
      expect(document.getElementById(id), `#${id} missing from the console shell`).not.toBeNull();
    }
  });
});

describe('build stamp', () => {
  // A refactor changes nothing visible, so "did the PWA actually update?" has no
  // answer from the UI — and a test run against stale code looks exactly like a
  // passing one. The sidebar footer cannot serve here: it is display:none below
  // 1180px, which is every iPad. Settings is reachable at any width.
  const el = () => document.getElementById('settings-build');

  it('has somewhere to render that Settings can reach', () => {
    expect(el(), '#settings-build missing from the Settings modal').not.toBeNull();
  });

  it('reports versions read from the page, not from a constant', async () => {
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({
      imports: { '/js/console-ui.js': '/js/console-ui.js?v=41', '/js/console/chrome.js': '/js/console/chrome.js?v=7' },
    });
    document.head.appendChild(map);
    try {
      await window.renderBuildStamp();
      // The numbers must come from the map — hard-coding them anywhere would
      // report a build that is not the one running.
      expect(el().textContent).toContain('console-ui v41');
      expect(el().textContent).toContain('console/chrome v7');
    } finally {
      map.remove();
    }
  });

  it('degrades instead of throwing when there is no import map or cache API', async () => {
    // happy-dom has no caches API, and a browser without import-map support
    // ignores the tag entirely — neither may leave the panel stuck on "reading…".
    await expect(window.renderBuildStamp()).resolves.not.toThrow();
    expect(el().textContent).not.toContain('reading…');
    expect(el().textContent.trim().length).toBeGreaterThan(0);
  });
});

// The first-run note (2026-08-08 cold run). A stranger reached a live site and
// a working console and then had to ask how to get rid of the sample photos,
// how to change the hero, and whether link previews were on. Every answer
// existed and none was anywhere they would look.
//
// Tested here rather than by reading the source, because the failure modes are
// both behavioural: showing to someone who has been running the site for a year
// (patronising, and they cannot make it stop), and never showing at all
// (silently useless). Both need a real DOM and the real markup.
describe('the first-run welcome', () => {
  const card = () => document.getElementById('welcome-card');
  const reset = () => {
    localStorage.removeItem('oaklens-console-welcomed');
    card().classList.add('hidden');
    card().classList.remove('open');
  };

  it('shows on a console with nothing in it', () => {
    reset();
    window.maybeShowWelcome({ posts: [], buffer: [], archive: [], wallpapers: [], library: [] });
    expect(card().classList.contains('hidden'), 'a brand new owner should see it').toBe(false);
  });

  it('stays away from a site that already has work in it', () => {
    reset();
    window.maybeShowWelcome({ posts: [], buffer: [{ id: 'f1' }], archive: [], wallpapers: [], library: [] });
    expect(card().classList.contains('hidden')).toBe(true);
  });

  it('does not lie in wait for the day an existing site empties its buffer', () => {
    // The subtle one. Skipping without recording it leaves the card primed, so
    // a year-old site that clears its buffer gets welcomed to its new space.
    reset();
    window.maybeShowWelcome({ posts: [{ id: 'p1' }], buffer: [], archive: [], wallpapers: [], library: [] });
    expect(localStorage.getItem('oaklens-console-welcomed')).toBe('1');
  });

  it('shows once, then never again', () => {
    reset();
    const empty = { posts: [], buffer: [], archive: [], wallpapers: [], library: [] };
    window.maybeShowWelcome(empty);
    window.dismissWelcome();
    expect(localStorage.getItem('oaklens-console-welcomed')).toBe('1');
    card().classList.add('hidden');
    window.maybeShowWelcome(empty);
    expect(card().classList.contains('hidden'), 'dismissed means dismissed').toBe(true);
  });

  it('answers the four questions the cold run actually asked', () => {
    // Content, not chrome: this card exists for these specific unknowns, and a
    // future tidy-up that drops one silently removes the only place it is said.
    const text = card().textContent;
    expect(text, 'the sample photographs').toMatch(/sample/i);
    expect(text, 'where the hero image comes from').toMatch(/folioHero/);
    expect(text, 'link previews are already on').toMatch(/link preview/i);
    expect(text, 'it installs as an app').toMatch(/install/i);
  });
});

describe('long-press registry', () => {
  const bufferTarget = () => window._registeredLongPress().find((t) => t.hostId === 'buffer-display');

  it('registers the buffer frame actions', () => {
    const t = bufferTarget();
    expect(t, 'no long-press target for #buffer-display — long press is dead on touch').toBeTruthy();
    expect(t.itemSelector).toBe('.buffer-frame');
    expect(t.actions('f1').map((a) => a.label))
      .toEqual(['Promote to Archive', 'Focal point', 'Link burst…', 'Remove frame']);
  });

  it('declines the press while Burst Link mode owns the taps', () => {
    window.showView('buffer');
    window.exitBurstLinkMode();
    expect(bufferTarget().enabled(), 'long press should be live when not linking').toBe(true);
    window.enterBurstLinkMode();
    expect(bufferTarget().enabled(), 'long press must stand down in link mode').toBe(false);
    window.exitBurstLinkMode();
  });
});


// ---- E5: storage that throws must not take the console down ----
//
// localStorage does not merely return null when site data is blocked or the
// browser partitions storage — the accessor THROWS. themeInit() runs at boot,
// so an unguarded read there kills the console before it paints, and the person
// sees a blank page with no clue why. Every other surface already try/catches
// its storage access; chrome.js's theme block did not until 2026-09-16.
//
// These drive the real exported functions against a localStorage that throws on
// everything, which is what a partitioned browser actually hands you.
describe('the theme survives a localStorage that throws', () => {
  let realStorage;
  const hostile = () => {
    realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        return {
          getItem() { throw new DOMException('denied', 'SecurityError'); },
          setItem() { throw new DOMException('denied', 'SecurityError'); },
          removeItem() { throw new DOMException('denied', 'SecurityError'); },
        };
      },
    });
  };
  const restore = () => {
    if (realStorage) Object.defineProperty(window, 'localStorage', realStorage);
  };

  it('themeInit() still applies a theme instead of throwing', () => {
    hostile();
    try {
      expect(() => window.themeInit()).not.toThrow();
      // It fell back to the system preference rather than leaving the document
      // unthemed — an unstyled console is not a graceful degradation.
      expect(['dark', 'light']).toContain(document.documentElement.dataset.theme);
    } finally { restore(); }
  });

  it('themeToggle() still flips the theme, it just cannot remember it', () => {
    hostile();
    try {
      document.documentElement.dataset.theme = 'dark';
      expect(() => window.themeToggle()).not.toThrow();
      expect(document.documentElement.dataset.theme).toBe('light');
    } finally { restore(); }
  });

  it('a working localStorage still persists the choice', () => {
    // The other half — the guards must not have turned persistence into a no-op.
    document.documentElement.dataset.theme = 'dark';
    window.themeToggle();
    expect(localStorage.getItem('console_theme')).toBe('light');
    window.themeToggle();
    expect(localStorage.getItem('console_theme')).toBe('dark');
  });
});
