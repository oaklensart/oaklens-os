#!/usr/bin/env node
// Validates a proposed module split for js/console-ui.js.
//
// Takes the section->module grouping below, replays the direct-call graph from
// dev/console-callgraph.json through it, and reports whether the resulting
// module graph is acyclic — the property the previous attempt lost. Cheap to
// re-run, so the grouping can be tuned until it comes out clean BEFORE any code
// moves.
//
// Handler-driven calls are deliberately excluded: they resolve on the window
// bridge at click time and impose no import dependency. Treating them as imports
// is what tangled the last split.
//
// Usage: node scripts/console-module-plan.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const graph = JSON.parse(readFileSync(join(ROOT, 'dev/console-callgraph.json'), 'utf8'));

// ---------------------------------------------------------------- the proposal
// Ordered bottom-up: a module may only depend on ones listed ABOVE it.

// Granularity is a deliberate choice, signed off 2026-07-29. Three layouts were
// validated clean (11 / 15 / 21 modules); this is the 15. The coarser 11 kept
// all seven surfaces in one 1363-line module, so editing the buffer re-shipped
// every surface to every installed PWA — which defeats half the point. The finer
// 21 bought little beyond this on the paths that actually get edited, at the
// cost of a browser checkpoint per module. The rule applied: a surface the owner
// edits often earns its own module; quiet surfaces ride together.

const PLAN = [
  ['chrome', [
    'TOAST', 'THEME — STUDIO (dark) / DAYLIGHT (light)',
    'STICKY HEADERS (iOS large-title compression)',
    'KEYBOARD INSETS (visualViewport → --kb-inset)',
    'TOUCH SHEETS — animated dismiss + grabber drag',
    'LIST DRAG-REORDER',
    'STAGE INDICATORS (UI) — counters live in console-state.js',
    'DROPZONE WIRING', 'VIEW ROUTING',
    'MORE SHEET (tab bar secondary surfaces)',
    'ACTION SHEET (long-press context menu)',
  ]],
  // The canvas bloom (phase 2 of the lighting pass). A true leaf: it imports
  // nothing, discovers its emitters by the [data-lit] attribute rather than by
  // name, and is called once from init(). It sits directly above chrome because
  // it is chrome's own kind of thing — generic surface plumbing that knows
  // nothing about buffers, frames or publishing — and because nothing below
  // chrome exists for it to sit under.
  ['lighting', []],
  // Never lived in the monolith — it arrived whole, so its section list is
  // empty on purpose (dev/console-module-plan.md, the `lighting` precedent).
  ['help', []],
  ['assets', ['IMAGE RESIZING', 'CDN PREVIEW HELPER', 'SERVER API']],
  // Was `trash`, renamed 2026-07-29: line attribution had filed nine generic
  // date/file/hash helpers under the SESSION TRASH banner, and only
  // renderTrash() was actually trash. The helpers are a true leaf named for
  // what they hold; renderTrash() moved to `publish` via OVERRIDES — the panel
  // it renders lives inside #view-publish and its one import-graph caller is
  // renderPublish() (console-state reaches it through the window bridge, which
  // imposes no import edge). The UTILS banner rides along for `uid`: chrome's
  // extraction rightly left that const behind, which stranded it in the barrel
  // while the plan still attributed it to chrome — the CDN_BASE failure shape,
  // caught before it shipped this time.
  ['utils', ['UTILS', 'SESSION TRASH (UI) — mutations live in console-state.js']],
  // Sits below the surfaces: libraryRemove() schedules a sync, and nothing in
  // the sync path calls back into a surface. Keeping it inside the upload/media
  // group was the last remaining upward edge.
  ['sync', ['LIBRARY AUTO-SYNC']],
  // BELOW the surfaces it repaints, not above them. The ingests enqueue and the
  // queue repaints, which is a two-way coupling until the repaint goes through
  // refreshSurface() — see the surface refresh registry seam below.
  ['upload', ['UPLOAD QUEUE']],
  // The surfaces reachable only through the More sheet — precisely the
  // MORE_VIEWS constant in VIEW ROUTING, minus bench (which is big enough and
  // self-contained enough to stand alone). They are read-mostly and change
  // rarely, so they ride together rather than paying a module each.
  // LIST DRAG-REORDER is here, not in chrome, despite reading like a generic UI
  // primitive: both functions mutate STATE[listKey] and then re-render the
  // surface that owns the list. That re-render used to be a ternary rather than
  // a call — `listKey === "wallpapers" ? renderWall : renderBarrel` — which the
  // original scanner never saw, so chrome looked like a leaf when it was
  // reaching two layers up. The barrel was retired 2026-09-20 and the wall is
  // the only reorderable list left, so it is now a plain renderWall() call;
  // renderWall ↔ wireListDrag remains an ordinary cycle inside one module.
  ['more-views', [
    'LIBRARY (PRE-STAGE)', 'NETWORK · FRIENDS OF (About §004)', 'WALL',
    'LIST DRAG-REORDER',
  ]],
  ['archive', ['ARCHIVE']],
  // Burst linking is bound to the buffer surface and only ever manipulates it
  // (exitBurstLinkMode → renderBuffer), so it is part of buffer, not a peer.
  ['buffer', ['BUFFER', 'BURST LINKING']],
  // The two FN pickers and the D1 draft sync are mutually recursive with the
  // editor (fnInsertAtCursor ↔ fnDebouncedSave, fnClearBufferDates → fnRender).
  // Splitting them out is the one grouping that produces a genuine cycle, so
  // they stay in one module.
  ['fn-editor', [
    'FN// MARKDOWN', 'FN// v0.7 ENHANCEMENTS', 'FN// PORTRAIT PANES (WRITE / PREVIEW)',
    'PHASE 4: FRAME BROWSER', 'PHASE 4: BUFFER DATES PICKER', 'CLOUD DRAFTS (D1-backed)',
  ]],
  // The card painter (chunk 7). Like `cards`, it has no callgraph sections —
  // it was written as a module — and it is a leaf: assets for the wordmark,
  // and the card engine through the window bridge, which imposes no import
  // edge. It sits BELOW focal because focal's card mode is now one of its
  // callers, and below `cards` for the same reason chunk 8's share block will
  // be.
  ['card-paint', []],
  ['focal', ['FOCAL POINT PICKER']],
  // The share block (chunk 8) — the four gestures over one card, and the only
  // thing that ever asks the painter for a `native` or a `story`. Written as a
  // module, so no callgraph sections. It sits ABOVE card-paint (it paints),
  // above buffer (it writes the stamped marker into the set the buffer's badge
  // reads) and above fn-editor (it reads the open note, which cannot hand a
  // target upward — hence the _registerFnShare seam); BELOW audio and cards,
  // which build their own targets and hand them over, the same shape focal's
  // per-surface entry points have.
  ['share', []],
  ['asset-library', ['ASSET LIBRARY']],
  // Above fn-editor because attaching a track from the editor inserts its
  // shortcode (fnInsertAtCursor) — same direction asset-library already runs.
  ['audio', ['AUDIO SHELF']],
  // The Cards view. No callgraph sections of its own — it was written as a
  // module, never extracted from console-ui.js — so its entry carries an empty
  // section list and contributes no inferred edges. Its real imports are what
  // tests/console-modules.test.js checks, and they all point below: state,
  // chrome, assets, fn-editor. It sits under publish so Chunk 4's actions can
  // reach focal/audio without either of them reaching back.
  ['cards', []],
  ['publish', ['PUBLISH', 'IMPORT EXISTING DATA']],
  ['session', ['SESSION AUTH (UI)']],
  ['bench', ['BENCH']],
  // The pulse composer. Sits high in the order because nothing else calls it:
  // it stages nothing, touches no publish counter, and its one job is a POST.
  ['pulse', ['PULSE']],
  ['init', ['INIT']],
];

// ----------------------------------------------------------------------- seams
// Edges that a small, deliberate indirection removes. Each one is a case where a
// low-level piece of chrome hard-codes knowledge of a high-level surface; the fix
// is for the surface to register itself instead, so chrome depends on nobody.
// Listed here so the plan can be validated BEFORE the seams are built.

const SEAMS = [
  {
    name: 'view registry',
    why: 'showView() hard-codes which renderer each view uses, so the router imports every surface. '
       + 'Invert it: chrome exposes registerView(name, { render, onLeave }) and init registers each surface. '
       + 'Note showView() reaches upward for TWO reasons, not one: it picks a renderer (render), and it '
       + 'runs leave-cleanup for the surface being left — `if (name !== "buffer" && burstLinkMode) '
       + 'exitBurstLinkMode()`. A render-only registry would strand that call and leave chrome importing '
       + 'buffer, so the entry must carry both halves.',
    from: ['showView'],
  },
  {
    name: 'long-press action registry',
    why: '_initLongPress() builds the context menu by naming surface actions directly. '
       + 'Invert it: each surface registers its own long-press actions at init.',
    from: ['_initLongPress'],
  },
];
const seamSources = new Set(SEAMS.flatMap((s) => s.from));

// The third seam is target-shaped rather than caller-shaped: ANY upward call to
// a surface renderer goes through refreshSurface(name) instead of importing it.
const REFRESH_SEAM = {
  name: 'surface refresh registry',
  why: 'Low-level code often has to repaint a surface above it — the upload queue marks a frame '
     + 'done and the buffer must redraw. Naming renderBuffer() there makes the queue import the '
     + 'buffer while the buffer\'s ingest already calls into the queue, which is a cycle. '
     + 'chrome exposes refreshSurface(view), backed by the same registry the router uses, so the '
     + 'caller names a surface instead of importing its renderer.',
  matches: (target) => /^render[A-Z]/.test(target),
};

// Banner comments do not always bracket their own functions: a few sit
// physically inside the previous section. Section attribution is line-based, so
// those need naming explicitly. Each entry is a fact about where the code lives
// versus what it is, not a judgement call.
const OVERRIDES = {
  publishToServer: 'publish',      // lives inside the LIBRARY AUTO-SYNC banner
  publishExportBundle: 'publish',
  buildBundle: 'publish',
  confirmPublish: 'publish',       // sits under the SESSION AUTH banner; is pure publish
  // Filed under SERVER API, which put this 92-line function second from the
  // bottom of the stack. It is the opposite: a reconcile that pulls main and
  // then rebuilds every surface, drafts and imports included. It belongs beside
  // publish, the other thing that talks to GitHub and reconciles state.
  syncFromServer: 'publish',
  _resumeAfterReconnect: 'publish',
  // Renders the session-trash panel that lives inside #view-publish; its only
  // import-graph caller is renderPublish(). Filed under its own banner, which
  // otherwise holds generic helpers — see the `utils` note in PLAN.
  renderTrash: 'publish',
};

// ------------------------------------------------------------------- resolution

const order = PLAN.map(([m]) => m);
const rank = new Map(order.map((m, i) => [m, i]));
const moduleOfSection = new Map();
for (const [mod, secs] of PLAN) for (const s of secs) moduleOfSection.set(s, mod);

// Rebuild section membership the same way the callgraph script did.
const banners = graph.banners;
const sectionAt = (line) => {
  let name = '«preamble»';
  for (const b of banners) { if (b.line <= line) name = b.name; else break; }
  return name;
};

const moduleOf = new Map();
const unassigned = new Map();
for (const f of graph.functions) {
  const sec = sectionAt(f.start);
  const mod = OVERRIDES[f.name] || moduleOfSection.get(sec);
  if (!mod) {
    if (!unassigned.has(sec)) unassigned.set(sec, []);
    unassigned.get(sec).push(f.name);
    continue;
  }
  moduleOf.set(f.name, mod);
}

// ------------------------------------------------------------ module edge graph

const edges = new Map();   // "a → b" -> count
const examples = new Map();
const seamRemoved = [];
for (const f of graph.functions) {
  const a = moduleOf.get(f.name);
  if (!a) continue;
  for (const t of f.calls) {
    const b = moduleOf.get(t);
    if (!b || a === b) continue;
    // A seam replaces this direct call with registration, so it is not an import.
    if (REFRESH_SEAM.matches(t) && rank.get(a) <= rank.get(b)) {
      seamRemoved.push(`${f.name}() → ${t}()  [${a} → ${b}]  via refreshSurface()`);
      continue;
    }
    if (seamSources.has(f.name) && rank.get(a) <= rank.get(b)) {
      seamRemoved.push(`${f.name}() → ${t}()  [${a} → ${b}]`);
      continue;
    }
    const k = `${a} → ${b}`;
    edges.set(k, (edges.get(k) || 0) + 1);
    if (!examples.has(k)) examples.set(k, `${f.name}() → ${t}()`);
  }
}

// Any edge pointing at a module declared later in PLAN is an upward dependency,
// i.e. the thing that would force a cycle or a bad extraction order.
const violations = [];
for (const [k, n] of edges) {
  const [a, b] = k.split(' → ');
  if (rank.get(a) <= rank.get(b)) violations.push({ edge: k, count: n, example: examples.get(k) });
}

// Cycle check on the module graph itself.
const adj = new Map(order.map((m) => [m, new Set()]));
for (const k of edges.keys()) { const [a, b] = k.split(' → '); adj.get(a).add(b); }
const WHITE = 0, GREY = 1, BLACK = 2;
const colour = new Map(order.map((m) => [m, WHITE]));
const cycles = [];
function dfs(v, path) {
  colour.set(v, GREY); path.push(v);
  for (const w of adj.get(v)) {
    if (colour.get(w) === GREY) cycles.push([...path.slice(path.indexOf(w)), w].join(' → '));
    else if (colour.get(w) === WHITE) dfs(w, path);
  }
  path.pop(); colour.set(v, BLACK);
}
for (const m of order) if (colour.get(m) === WHITE) dfs(m, []);

// ---------------------------------------------------------------------- report

const sizes = new Map(order.map((m) => [m, { fns: 0, lines: 0 }]));
for (const f of graph.functions) {
  const m = moduleOf.get(f.name);
  if (!m) continue;
  const s = sizes.get(m);
  s.fns++; s.lines += f.lines;
}

// `--members <name>` lists what a module actually contains, which is the first
// thing you need before extracting it. Line numbers are positions in the
// CONCATENATED stream (js/console/*.js then js/console-ui.js), so use the
// section banners to find the real ranges in the file you are cutting from.
const membersOf = process.argv.includes('--members')
  ? process.argv[process.argv.indexOf('--members') + 1]
  : null;
if (membersOf) {
  const rows = graph.functions
    .filter((f) => moduleOf.get(f.name) === membersOf)
    .sort((a, b) => a.start - b.start);
  if (!rows.length) {
    console.log(`No module "${membersOf}". Known: ${order.join(', ')}`);
    process.exit(1);
  }
  const sections = new Set();
  for (const f of rows) {
    sections.add(sectionAt(f.start));
    console.log(`  ${String(f.start).padStart(5)}-${String(f.end).padEnd(5)} ${f.exported ? 'export' : '      '} ${f.name}`);
  }
  console.log(`\n${rows.length} functions, ${rows.reduce((a, f) => a + f.lines, 0)} lines`);
  console.log(`\nBanner sections to cut on:`);
  for (const s of sections) console.log(`  · ${s}`);
  console.log(`\nNOTE: module-level const/let declared in these sections move too, and are`);
  console.log(`the easiest thing to miss — they are not functions, so nothing re-imports`);
  console.log(`them automatically. tests/console-modules.test.js catches a dangling one.`);
  process.exit(0);
}

console.log('Proposed modules (bottom-up):\n');
for (const m of order) {
  const s = sizes.get(m);
  const out = [...edges.entries()].filter(([k]) => k.startsWith(`${m} →`));
  console.log(`  ${m.padEnd(11)} ${String(s.fns).padStart(3)} fns  ${String(s.lines).padStart(5)} lines  depends on: ${out.length ? out.map(([k, n]) => `${k.split(' → ')[1]}(${n})`).join(' ') : '—'}`);
}

console.log(`\nAssigned ${moduleOf.size}/${graph.functions.length} functions.`);
if (unassigned.size) {
  console.log('\nUNASSIGNED sections:');
  for (const [sec, fns] of unassigned) console.log(`  ${sec} — ${fns.length} fns`);
}

console.log(`\nSeams applied (${SEAMS.length + 1}) — direct calls replaced by registration:`);
for (const s of [...SEAMS, REFRESH_SEAM]) console.log(`  • ${s.name}: ${s.why}`);
console.log(`  removed ${seamRemoved.length} upward edge(s):`);
for (const e of seamRemoved) console.log(`    ${e}`);

console.log(`\nModule graph cycles: ${cycles.length}`);
for (const c of cycles) console.log(`  ${c}`);

console.log(`\nUpward dependencies (would break bottom-up extraction order): ${violations.length}`);
for (const v of violations.sort((a, b) => b.count - a.count)) {
  console.log(`  ${v.edge} — ${v.count}  e.g. ${v.example}`);
}

process.exitCode = cycles.length || violations.length ? 1 : 0;
