// The extracted console modules, checked against the plan they were extracted
// from — using their real `import` statements rather than a derived graph.
//
// scripts/console-module-plan.mjs validates the *proposal*: it replays a call
// graph inferred from source text. That inference has been wrong twice already
// (a function used as a value was invisible; the last function in a file
// absorbed trailing top-level code). Once a module is a real file its imports
// are no longer inferred, so this asserts the thing that actually ships.
//
// The rule: js/console/ is layered. A module may import ones declared BELOW it
// in the plan and nothing else. Break that and the split stops paying for
// itself — an upward edge is a cycle waiting to happen, and a cycle is what
// re-versions every module whenever one changes, which is the failure the whole
// decomposition exists to avoid.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'js/console');

/** Module order, bottom-up, read from the plan so the two can never disagree. */
function planOrder() {
  const src = readFileSync(join(ROOT, 'scripts/console-module-plan.mjs'), 'utf8');
  const block = src.match(/const PLAN = \[([\s\S]*?)\n\];/);
  expect(block, 'could not find PLAN in scripts/console-module-plan.mjs').toBeTruthy();
  return [...block[1].matchAll(/^\s*\['([\w-]+)',/gm)].map((m) => m[1]);
}

const ORDER = planOrder();
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.js')).sort() : [];

/** Relative import specifiers in a module, with the ?v= already gone (Phase 2). */
function importsOf(file) {
  const text = readFileSync(join(DIR, file), 'utf8');
  return [...text.matchAll(/^import\s[\s\S]*?from\s+['"]([^'"]+)['"];?$/gm)].map((m) => m[1]);
}

describe('console module layering', () => {
  it('the plan lists chrome first — it is the leaf everything else sits on', () => {
    expect(ORDER[0]).toBe('chrome');
    expect(ORDER).toContain('init');
    expect(ORDER.at(-1)).toBe('init');
  });

  it.runIf(files.length)('every extracted file is a module named in the plan', () => {
    const unknown = files.map((f) => f.replace(/\.js$/, '')).filter((n) => !ORDER.includes(n));
    expect(unknown, `js/console/ holds modules the plan does not name: ${unknown.join(', ')}`).toEqual([]);
  });

  it.runIf(files.length)('no module imports one that comes later in the plan', () => {
    const violations = [];
    for (const file of files) {
      const from = file.replace(/\.js$/, '');
      for (const spec of importsOf(file)) {
        const m = spec.match(/^\.\/([\w-]+)\.js$/);
        if (!m) continue;
        const to = m[1];
        if (ORDER.indexOf(to) >= ORDER.indexOf(from)) {
          violations.push(`${from} imports ${to}, which is not below it (plan order: ${ORDER.join(' < ')})`);
        }
      }
    }
    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });

  it.runIf(files.length)('no module imports the barrel it was extracted from', () => {
    // js/console-ui.js re-exports these modules. A module importing it back is a
    // genuine cycle — and one the browser resolves to a half-initialised module
    // rather than an error, so it fails as an undefined-is-not-a-function at
    // click time rather than at load.
    const offenders = [];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (/console-ui\.js$/.test(spec)) offenders.push(`${file} imports ${spec}`);
      }
    }
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });

  it.runIf(files.length)('leaves no dangling reference in the barrel', () => {
    // The one that got through. CDN_BASE and SITE_LOCATION were module-level
    // consts, not functions — they moved into assets.js while code left behind
    // in console-ui.js still named them. Nothing failed at load: ES modules
    // resolve fine, and the ReferenceError only fires when the line actually
    // runs. So the console booted, every test passed, and opening the asset
    // library threw — shipped, and found by the owner on an iPad.
    //
    // The extraction tooling only re-imported exported FUNCTIONS, which is
    // exactly the blind spot. This checks every top-level declaration.
    const ui = readFileSync(join(ROOT, 'js/console-ui.js'), 'utf8');
    const imported = new Set();
    for (const m of ui.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/console\/[\w-]+\.js['"]/g)) {
      m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => imported.add(n));
    }
    // Line comments stripped only — pairing-based stripping mis-pairs on an
    // apostrophe in prose and would hide real references.
    //
    // Module specifiers are blanked too, and that is not optional: the barrel
    // is now nothing BUT `export * from './console/<name>.js'` lines, and a
    // module whose name is also one of its exports (init.js exports init)
    // matched its own path — `/init` in the specifier reads as a bare
    // reference. Only the quoted string after `from` is removed, which cannot
    // contain code, so a real reference still cannot hide behind this.
    const uiCode = ui
      .replace(/^\s*\/\/[^\n]*$/gm, ' ')
      .replace(/(\bfrom\s*)['"][^'"]+['"]/g, '$1""');

    const dangling = [];
    for (const file of files) {
      const src = readFileSync(join(DIR, file), 'utf8');
      for (const m of src.matchAll(/^(export\s+)?(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
        const [, isExported, name] = m;
        if (imported.has(name)) continue;
        if (new RegExp(`(^|[^.\\w$])${name}\\b`, 'm').test(uiCode)) {
          dangling.push(
            `${name} (js/console/${file}) is used in console-ui.js but not imported` +
            (isExported ? ' — add it to the import list' : ' — it is module-private; export it, then import it')
          );
        }
      }
    }
    expect(dangling, `\n${dangling.join('\n')}\n`).toEqual([]);
  });

  it.runIf(files.length)('leaves no dangling reference BETWEEN modules either', () => {
    // The guard above watches the barrel. This watches the twenty-one modules,
    // because the same bug lives there and hid twice:
    //
    //   init.js:71   called _registerLibraryUploadProbe() (sync.js) — logged as
    //                Mo2 in the 2026-08-24 review, still open three weeks later
    //   focal.js:272 called hideOverlay() (chrome.js) — not logged anywhere,
    //                found by generalising this check on 2026-09-16
    //
    // Neither threw. The bridge mirrors every namespace onto `window`, so a
    // module that names something it never imported resolves anyway — until a
    // bootstrap without that mirror runs it, and then it is a ReferenceError in
    // a code path nobody exercises often. Both were one-line fixes; finding
    // them was the hard part, and is what this automates.
    const HANDLER = /\bon[a-z]+\s*=\s*\\?"[^"]*"|\bon[a-z]+\s*=\s*\\?'[^']*'/g;
    const exportsOf = new Map();
    for (const f of files) {
      const names = new Set();
      for (const m of readFileSync(join(DIR, f), 'utf8')
        .matchAll(/^export\s+(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
      exportsOf.set(f, names);
    }

    const dangling = [];
    for (const f of files) {
      const raw = readFileSync(join(DIR, f), 'utf8');
      // Inline `on*=` handler bodies are BLANKED, not scanned: they execute in
      // global scope on purpose, and tests/helpers/inline-handlers.js is what
      // checks those resolve. Without this, every onclick in buffer.js and
      // more-views.js reads as a dangling call.
      const code = raw
        .replace(HANDLER, (m) => ' '.repeat(m.length))
        .replace(/(\bfrom\s*)['"][^'"]+['"]/g, '$1""');

      const imported = new Set();
      for (const m of raw.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
        m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop().trim())
          .filter(Boolean).forEach((n) => imported.add(n));
      }
      // Any declaration in the file, nested ones included — a module-private
      // helper may share a name with another module's export.
      const declared = new Set();
      for (const m of code.matchAll(/(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

      const lineOf = (i) => code.slice(0, i).split('\n').length;
      const lineStart = (i) => code.lastIndexOf('\n', i) + 1;

      for (const [other, names] of exportsOf) {
        if (other === f) continue;
        for (const n of names) {
          if (imported.has(n) || declared.has(n)) continue;
          const re = new RegExp(`(^|[^.\\w$])${n.replace(/\$/g, '\\$')}\\s*\\(`, 'gm');
          for (const m of code.matchAll(re)) {
            // Comments are skipped per-MATCH rather than stripped wholesale:
            // this repo is full of `https://` and `FN//` inside real strings,
            // and a global strip would eat live code (same reasoning as the
            // line-based check in tests/helpers/inline-handlers.js). A trailing
            // `// … via cdnThumb()` is a real example that fired here.
            const before = code.slice(lineStart(m.index), m.index);
            if (before.includes('//') || before.trimStart().startsWith('*')) continue;
            dangling.push(
              `js/console/${f}:${lineOf(m.index)} calls ${n}() — exported by ${other}, `
              + 'but never imported here. It only resolves through the window mirror.',
            );
            break;
          }
        }
      }
    }
    expect(dangling, `\n${dangling.join('\n')}\n`).toEqual([]);
  });

  it.runIf(files.length)('every module is versioned in the import map and precached', () => {
    // A module in a subdirectory is exactly what the old ?v= scanner could not
    // see, so this states the requirement directly rather than trusting it.
    const bridge = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
    const map = JSON.parse(bridge.match(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/i)[1]).imports;
    const sw = readFileSync(join(ROOT, 'dev/sw.js'), 'utf8');
    const missing = [];
    for (const file of files) {
      const path = `/js/console/${file}`;
      if (!map[path]) missing.push(`${path} has no import map entry — it would load unversioned and cache forever`);
      else if (!sw.includes(`'${map[path]}'`)) missing.push(`${map[path]} is not in dev/sw.js SHELL_ASSETS`);
    }
    expect(missing, `\n${missing.join('\n')}\n`).toEqual([]);
  });
});
