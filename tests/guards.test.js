// Structural guards — cheap tests that keep three standing promises true:
//
//  1. The published site is dependency-free: no public page loads a script
//     from a third-party origin. The Field Console is the one exemption, for
//     exactly its two pinned, SRI'd libs (exifr + jszip).
//  2. Every nav destination in site.config.js is a page the site-in-a-ZIP
//     export carries (js/export-manifest.js), so exported nav links resolve
//     offline. `/dev` is the documented exception — the console needs the
//     live API and is deliberately not exported.
//  3. Cache discipline (manual §5): a js/css module is referenced with ONE
//     ?v= everywhere — the console bridge, dev/sw.js SHELL_ASSETS, cross-
//     module imports, public pages — so a bump can never be partial.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import siteConfig from '../site.config.js';
import { EXPORT_MANIFEST } from '../js/export-manifest.js';
import { buildRoutes } from '../js/site-export-core.js';
import { scanVersions } from './helpers/versions.js';

const ROOT = join(import.meta.dirname, '..');
// Everything in here describes SERVED markup — third-party scripts on public
// pages, mailto: placeholders, and `?v=` cache discipline — so the walk must
// see only what the origin actually serves. `docs/`, `tests/` and `dist/` are
// `.assetsignore`'d (and `docs/` does not even travel to the fork), and
// sweeping them was quietly wrong in both directions: repo-only HTML got
// judged as a public page, and — the one with teeth — `docs/os-drafts/*.html`
// carry their own frozen `css/main.css?v=N` links, so the next legitimate CSS
// bump would have failed the `?v=` consistency check on a file nobody serves.
// Same exclusion list `tests/no-payment-links.test.js` already uses.
// `.claude` is agent scratch space, and `.claude/worktrees/` holds whole
// CHECKOUTS of this repo — so an agent working in a second worktree put a full
// copy of every page inside the tree this walker sweeps, and its (correctly
// different) `?v=` numbers failed the consistency check below. A false red that
// depends on who else is working, which is the worst kind.
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', '.wrangler', 'docs', 'tests', 'dist']);

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(relative(ROOT, p));
  }
  return out;
}

const htmlFiles = walk(ROOT, '.html');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('no third-party scripts on public pages', () => {
  // The console's two pinned libs — the only cross-origin scripts allowed
  // anywhere, and only in the console shell.
  const CONSOLE_ALLOWED = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(exifr|jszip)@/;

  it.each(htmlFiles.map((f) => [f]))('%s', (file) => {
    const externals = [...read(file).matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)]
      .map((m) => m[1])
      .filter((src) => /^(https?:)?\/\//i.test(src));
    if (file === join('dev', 'field-console.html')) {
      for (const src of externals) expect(src).toMatch(CONSOLE_ALLOWED);
    } else {
      expect(externals).toEqual([]);
    }
  });
});

describe('nav routes are exported pages', () => {
  const routes = buildRoutes(EXPORT_MANIFEST.pages);
  // The console lives behind the live API; the export neither carries nor
  // remaps /dev (see tests/site-export.test.js integration notes).
  const LIVE_ONLY = new Set(['/dev']);

  it('every site.config.js nav destination is in the export manifest', () => {
    for (const item of siteConfig.nav) {
      const path = item.href.split(/[?#]/)[0];
      if (LIVE_ONLY.has(path)) continue;
      // An external nav link (another site entirely — the demo's "Install It
      // Yourself" pointing at the engine's guide is the worked example) can't
      // be an exported page by definition; in the ZIP it stays a live link,
      // which is exactly right. Only same-site paths must ride the export.
      if (/^https?:\/\//i.test(path)) continue;
      expect(routes[path], `nav "${item.label}" → ${item.href}`).toBeTruthy();
    }
  });
});

describe('the About page keeps a way to reach the owner', () => {
  // The editorial redesign (2059933) replaced the vault layout and silently
  // took the contact controls with it, leaving only the nav envelope — the
  // site's only "hire me / talk to me" surface disappeared for weeks without
  // failing a single test. These are the guards that would have caught it.
  const about = () => read(join('about', 'index.html'));

  it('renders a contact block with a mailto action', () => {
    expect(about(), '.ab-contact block').toMatch(/class="[^"]*\bab-contact\b/);
    const inBody = about().slice(about().indexOf('<main'));
    expect(inBody, 'a mailto: action outside the nav').toMatch(/href="mailto:/);
  });

  it('wires every subscribe control it renders', () => {
    const ids = ['gtd-about-btn', 'gtd-about-panel', 'gtd-about-form',
                 'gtd-about-email', 'gtd-about-ok', 'gtd-about-err'];
    for (const id of ids) expect(about(), `#${id} in markup`).toContain(`id="${id}"`);

    // No inline handlers are possible under the strict CSP, so the controls are
    // only live if the page's module actually binds them.
    const js = read(join('js', 'page-about.js'));
    for (const id of ['gtd-about-btn', 'gtd-about-panel', 'gtd-about-email']) {
      expect(js, `#${id} bound in page-about.js`).toContain(id);
    }
    expect(js, 'submits through the shared helper').toContain('submitGTD(');
    expect(about(), 'page-about.js loaded').toMatch(/src="\/js\/page-about\.js\?v=\d+"/);
  });
});

describe('contact addresses stay neutral placeholders', () => {
  // Identity is edge-injected: src/edge/chrome.js rewrites every mailto: from
  // site.config.js `email`. A real address in served markup is an identity
  // leak into engine code AND breaks every fork (manual §2, CLAUDE.md).
  it.each(htmlFiles.map((f) => [f]))('%s', (file) => {
    for (const m of read(file).matchAll(/href="mailto:([^"?]*)/g)) {
      expect(m[1], 'hardcoded instance address').toBe('you@example.com');
    }
  });
});

describe('footer attribution stays edge-injected', () => {
  // The homepage footer's OS + webring chips are built by _footerChipsHtml and
  // injected into a neutral <span data-site-chips> hook. Before that, the chip
  // was static markup carrying a github.com URL — the last identity-shaped
  // string in served HTML, and the reason a fork's index.html differed from
  // the engine's. Keeping it injected means every fork serves the same bytes
  // and `poweredBy: false` can actually remove it.
  it('index.html carries the hook and no hardcoded chip', () => {
    const html = read('index.html');
    expect(html, 'the injection hook').toContain('data-site-chips');
    expect(html, 'chip markup belongs in src/edge/chrome.js').not.toContain('powered-chip');
    expect(html, 'no project URL in served markup').not.toContain('github.com');
  });
});

describe('?v= cache discipline', () => {
  // One scanner, shared with tests/version-bump.test.js. This file used to
  // carry its own copy whose character class was [\w-]+ — blind to any path
  // with a directory in it, so a js/console/*.js module would have been silently
  // skipped by the very guard meant to catch it. Two scanners that disagree is
  // worse than one, because the weaker one still reads as a pass.
  const scanFiles = [
    ...htmlFiles,
    ...walk(join(ROOT, 'js'), '.js').map((p) => p),
    join('dev', 'sw.js'),
  ];
  const seen = scanVersions((f) => { try { return read(f); } catch { return null; } }, scanFiles);

  /** dev/sw.js SHELL_ASSETS as Map('js/foo.js' → '3'); unversioned entries (fonts) are skipped. */
  const swAssets = () => {
    const block = read(join('dev', 'sw.js')).match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)[1];
    return new Map(
      [...block.matchAll(/'\/((?:js|css)\/[\w/-]+\.(?:js|css))\?v=(\d+)'/g)].map((m) => [m[1], m[2]])
    );
  };

  it('found the console bridge modules at all (regex sanity)', () => {
    expect(seen.has('js/console-ui.js')).toBe(true);
    expect(seen.has('css/field-console.css')).toBe(true);
  });

  it.each([...seen.keys()].map((k) => [k]))('%s carries one version everywhere', (base) => {
    const byVersion = seen.get(base);
    const detail = [...byVersion.entries()]
      .map(([v, files]) => `?v=${v} in ${files.join(', ')}`)
      .join(' · ');
    expect(byVersion.size, detail).toBe(1);
  });

  it('dev/sw.js SHELL_ASSETS matches the bridge versions exactly', () => {
    const swVersions = swAssets();
    expect(swVersions.size).toBeGreaterThan(0);
    for (const [base, version] of swVersions) {
      const byVersion = seen.get(base);
      expect(byVersion, `${base} is precached but never referenced`).toBeTruthy();
      expect([...byVersion.keys()], base).toEqual([version]);
    }
  });

  // The console resolves module versions through an import map, so that map is
  // the authority. A SW cannot read it, so SHELL_ASSETS restates it — and a
  // module precached at the wrong version is an offline copy of code the page
  // never runs. These two must be the same set, not merely overlapping.
  it('the import map and SHELL_ASSETS cover the same js modules at the same versions', () => {
    const bridge = read(join('dev', 'field-console.html'));
    const mapBlock = bridge.match(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/i);
    expect(mapBlock, 'no <script type="importmap"> in dev/field-console.html').toBeTruthy();

    const imports = JSON.parse(mapBlock[1]).imports;
    const mapped = new Map();
    for (const [key, value] of Object.entries(imports)) {
      const m = value.match(/^(\/(?:js|css)\/[\w/-]+\.(?:js|css))\?v=(\d+)$/);
      expect(m, `import map value "${value}" is not a versioned same-origin asset`).toBeTruthy();
      expect(m[1], `import map key "${key}" should point at its own path`).toBe(key);
      mapped.set(key.slice(1), m[2]);
    }

    const swJs = new Map([...swAssets()].filter(([p]) => p.startsWith('js/')));
    expect([...mapped.keys()].sort(), 'import map vs SHELL_ASSETS js entries').toEqual([...swJs.keys()].sort());
    for (const [path, version] of mapped) {
      expect(swJs.get(path), `${path}: import map says v${version}, SHELL_ASSETS says v${swJs.get(path)}`).toBe(version);
    }
  });

  // The regression guard for the cascade the import map exists to remove. A
  // versioned cross-module specifier means bumping that module edits this file
  // too, which changes its content, which forces it to bump — repeat up the
  // stack. One re-added ?v= quietly reintroduces that, so it is worth failing on.
  it('no js/ module imports another with a ?v= — versions belong in the import map', () => {
    const offenders = [];
    for (const file of walk(join(ROOT, 'js'), '.js')) {
      for (const m of read(file).matchAll(/from\s+['"](\.{1,2}\/[\w/-]+\.js)\?v=(\d+)['"]/g)) {
        offenders.push(`${file}: '${m[1]}?v=${m[2]}' — drop the ?v=, the import map carries it`);
      }
    }
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });
});

describe('deferred DOM lookups do not outlive the DOM', () => {
  // A timer callback that reaches for `document` runs at some later moment
  // that the code around it does not control. In a browser that is a torn-down
  // view; in the suite it is a test file whose environment has already gone,
  // and the throw lands as an UNHANDLED error — every test still passes, the
  // run still exits 1. That is exactly how this shipped: checkAuth() deferred
  // a `document.getElementById(...).focus()` by 100ms, the console-features
  // file finished in less than that, and CI went red on a green suite.
  //
  // The fix is always the same shape: resolve the node NOW, close over it, and
  // let the callback touch only what it was handed.
  it('no js/ timer callback dereferences document', () => {
    const offenders = [];
    for (const file of walk(join(ROOT, 'js'), '.js')) {
      const src = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      for (const m of src.matchAll(/set(?:Timeout|Interval)\(\s*(?:\(\)\s*=>|function\s*\(\s*\)\s*\{)\s*document\./g)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(
          `${file.replace(ROOT + '/', '')}:${line} — resolve the element before the timer, not inside it`,
        );
      }
    }
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });
});

describe('shell scripts stay portable across BSD and GNU', () => {
  // setup.sh runs on whatever machine a stranger owns. `mktemp -d -t name` is
  // the trap that already fired once: macOS accepts it, GNU mktemp refuses
  // with "too few X's", and the fallout was silent — deploy_dir came back
  // empty, the wrangler log path degraded to /deploy.log, and every Linux
  // install (and CI) lost the address read-back while the script exited 0.
  // The portable spelling is an explicit template: mktemp -d "$dir/name.XXXXXX".
  it('no `mktemp -t` in any script a fork runs', () => {
    const dir = join(ROOT, 'scripts');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.sh'))
      .filter((f) => /mktemp[^\n|;)]*\s-t\b/.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => `scripts/${f}`);
    expect(offenders, `BSD-only mktemp -t (GNU refuses it): ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('a card\'s internal layering cannot escape the card', () => {
  // The bug this pins, reported 2026-08-13 with screenshots: scrolling the
  // homepage on a phone, the audio card's waveform and share button and the
  // pulse card's text painted straight OVER the fixed footer.
  //
  // One shared cause, two card types. Several cards stack things inside
  // themselves — the pulse card lifts its content above its own painted
  // gradients, the audio card lifts the player above the stretched title link
  // so the transport stays pressable. Those numbers are only meant to be read
  // against the card. But `overflow: hidden` does NOT create a stacking
  // context, so they resolved against the root one and outranked a footer
  // sitting at level 0.
  //
  // Two independent guards, because either alone leaves a way back in.
  // Comments are stripped FIRST. Both rules below explain themselves in prose
  // that names the very declaration being asserted, so a raw match passes on the
  // explanation alone — caught here by deleting the real declaration and
  // watching the guard stay green. Same rule as tests/pulse-console.test.js: a
  // guard that cannot tell an explanation from the mistake is not a guard.
  const css = readFileSync(join(ROOT, 'css', 'main.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('.wk-card isolates, so an inner z-index is scoped to its own card', () => {
    const rule = css.match(/^\.wk-card \{[\s\S]*?^\}/m);
    expect(rule, '.wk-card has no base rule').toBeTruthy();
    expect(
      rule[0],
      'Cards stack content internally. Without a stacking context those z-indexes '
      + 'resolve against the root and paint over the fixed footer — which is exactly '
      + 'what shipped. Keep `isolation: isolate` on the shared card base so a new '
      + 'card type cannot reintroduce it.',
    ).toMatch(/isolation:\s*isolate/);
  });

  it('the homepage footer is the same fixed bar as every other page', () => {
    // This guard used to ask a narrower question — whether the MOBILE homepage
    // override kept its stacking level — because the homepage opted out of the
    // fixed footer at desktop (`position: relative`, `z-index: auto`) from when
    // it was one screen tall, and the mobile block had to put both back.
    //
    // The recent-work grid made the homepage scroll, so that opt-out dropped
    // the site's one persistent piece of chrome below the fold on the front
    // door alone (owner report, 2026-09-19). There is no override left to ask
    // about; the two things that hold now are asserted instead.
    const rule = css.match(/^\.footer \{[\s\S]*?^\}/m);
    expect(rule, '.footer has no base rule').toBeTruthy();
    expect(
      rule[0],
      'Every page keeps its footer on screen. This is the rule that does it.',
    ).toMatch(/position:\s*fixed/);
    expect(
      rule[0],
      'A fixed footer overlays the page, so it must outrank it. Left at `z-index: auto` '
      + 'it paints below any positioned content.',
    ).toMatch(/z-index:\s*\d+/);
    expect(
      css,
      'the homepage is opting out of the shared footer again — whatever the '
      + 'declaration, that is the bug this guard was rewritten for.',
    ).not.toMatch(/\.page--home \.footer \{/);
  });
});


// The staged counter means "changes waiting to be published". Every surface in
// the console bumps it by one for ANY edit — including deletions, because
// undoing something live is itself a change to publish.
//
// The audio shelf read it as "how many tracks are on the card" and passed
// negative deltas, so taking a published track off the card decremented toward
// zero, `bumpStage`'s Math.max clamped it there, and the console answered a
// real change with "NO PENDING CHANGES" — publish refused to run and the card
// could not be removed from the live site. (2026-08-14; the suite had a test
// asserting the broken model, so the gate was holding it in place.)
describe('staging counts changes, not things', () => {
  it('no console SURFACE passes a negative delta to bumpStage', () => {
    // The one legitimate decrementer is the ledger itself: `trashItem` cancels
    // a pending ADD when you delete something that was never published, and
    // `trashRestore` cancels a pending DELETION when you put a published item
    // back. Those undo a staged change rather than making a new one, which is
    // the opposite of what a surface's toggle does. Everything else — every
    // feature, edit, clear and switch — is +1. `stageChange` (the ledger-row
    // wrapper around bumpStage) is scanned the same way: a surface must not
    // sneak a negative in via its `delta` meta either.
    const LEDGER = 'js/console-state.js';
    const offenders = [];
    for (const file of walk(join(ROOT, 'js'), '.js')) {
      if (file.split(/[\\/]/).join('/') === LEDGER) continue;
      const src = readFileSync(join(ROOT, file), 'utf8');
      // bumpStage('x', -1) · bumpStage('x', -count) · bumpStage('x', n ? 1 : -1)
      for (const m of src.matchAll(/bumpStage\s*\([^)]*?-\s*[A-Za-z0-9_]/g)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line} — ${m[0].trim()}`);
      }
      // stageChange('x', { ..., delta: -1 }) — same law through the wrapper.
      for (const m of src.matchAll(/stageChange\s*\([^)]*?delta:\s*-/g)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line} — ${m[0].trim()}`);
      }
    }
    expect(
      offenders,
      `a change is a change; removing something stages one too:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every surface in SURFACE_MANIFEST is promoted to _imported after publish', () => {
    // A surface missing from the post-publish promotion is invisible in exactly
    // the way the 2026-08-14 log warned about: items published this session stay
    // flagged "new/local", so trashing one DECREMENTS instead of staging a
    // removal, _vouchedEmptyManifests() cannot vouch for a deliberate 1 → 0, and
    // an edit re-slugs a permalink that is supposed to be permanent. `audio` and
    // `friends` were both missing from a hand-written list for two weeks.
    //
    // The fix was to DERIVE both lists from SURFACE_MANIFEST, so this guard
    // pins the derivation rather than re-typing the surfaces — a hand-written
    // list here would drift the same way the code did.
    const pub = readFileSync(join(ROOT, 'js', 'console', 'publish.js'), 'utf8');

    const manifest = pub.match(/const SURFACE_MANIFEST = \{([\s\S]*?)\};/);
    expect(manifest, 'SURFACE_MANIFEST is the single source of truth here').toBeTruthy();
    const surfaces = [...manifest[1].matchAll(/(\w+):\s*'data\//g)].map((m) => m[1]);
    expect(surfaces, 'audio must be a published surface').toContain('audio');
    expect(surfaces, 'friends must be a published surface').toContain('friends');

    expect(
      pub,
      'the post-publish _imported promotion must derive from SURFACE_MANIFEST, not a literal list',
    ).toMatch(/Object\.keys\(SURFACE_MANIFEST\)\s*\n?\s*\.filter\(surface => surface !== 'posts'\)/);

    expect(
      pub,
      'hasImported() must derive from SURFACE_MANIFEST too — it drifted three surfaces',
    ).toMatch(/hasImported\(\)\s*\{[\s\S]{0,200}Object\.keys\(SURFACE_MANIFEST\)/);
  });

  it('the publish summary can show every surface that stages changes', () => {
    // A staged surface with no card on the publish screen moves the total badge
    // and shows its delta nowhere — which is how audio shipped.
    const pub = readFileSync(join(ROOT, 'js', 'console', 'publish.js'), 'utf8');
    const shell = readFileSync(join(ROOT, 'dev', 'field-console.html'), 'utf8');
    const stagedMap = pub.match(/const stagedMap = \{([\s\S]*?)\};/)[1];
    const surfaces = [...stagedMap.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);

    expect(surfaces, 'audio is staged but was absent from the summary').toContain('audio');
    for (const s of surfaces) {
      expect(shell, `no #sum-count-${s} card in the console shell`).toContain(`id="sum-count-${s}"`);
      expect(shell, `no #sum-delta-${s} in the console shell`).toContain(`id="sum-delta-${s}"`);
    }
  });
});
