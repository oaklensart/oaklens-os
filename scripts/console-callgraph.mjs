#!/usr/bin/env node
// Call-graph analysis for js/console-ui.js — design input for the decomposition.
//
// The point is to group code by DEPENDENCY DIRECTION rather than by topic. The
// previous split grouped by topic (media / surfaces / publish) and produced a
// knot in which seven of nine modules imported each other, so changing one file
// re-versioned nearly all of them and the cache win never materialised.
//
// Method: every top-level declaration in this file starts at column 0, so a
// declaration owns every line from its own down to the next one. That is more
// robust than brace-matching a file full of template literals containing `${}`,
// backticks and regex literals. Attribution is line-based and therefore
// approximate at the edges — good enough to choose module boundaries, not a
// substitute for reading the code before moving it.
//
// Usage:  node scripts/console-callgraph.mjs [file]
// Writes: dev/console-callgraph.json  (full graph)
//         dev/console-callgraph.md    (human summary)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// The console is mid-decomposition, so "the console" is console-ui.js plus
// whatever has already been extracted into js/console/. Concatenating them keeps
// the graph whole as modules move out — otherwise every extraction shrinks the
// analysis to the shrinking remainder and the plan silently stops being checked
// against anything. Extracted files come FIRST so their declarations are already
// known when the barrel's own code is scanned.
const TARGETS = process.argv.length > 2
  ? process.argv.slice(2)
  : [
      ...readdirSync(join(ROOT, 'js/console'), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.js'))
        .map((e) => `js/console/${e.name}`)
        .sort(),
      'js/console-ui.js',
    ].filter((f) => existsSync(join(ROOT, f)));

// Import statements are the seam between files; they are not code we analyse,
// and a re-export barrel would otherwise look like a pile of references. Blanked
// rather than dropped so line numbers stay meaningful within each file.
const stripImports = (t) => t.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
                             .replace(/^export\s+\*\s+from\s+['"][^'"]+['"];?$/gm, '');

const fileOf = [];   // line index -> source file, so a function can be traced back
const lines = [];
for (const t of TARGETS) {
  for (const l of stripImports(readFileSync(join(ROOT, t), 'utf8')).split('\n')) {
    lines.push(l);
    fileOf.push(t);
  }
}
const TARGET = TARGETS.join(' + ');
const src = lines.join('\n');

// ---------------------------------------------------------------- declarations

const DECL_RE = /^(export\s+)?(async\s+)?(function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

const decls = [];
lines.forEach((line, i) => {
  const m = line.match(DECL_RE);
  if (!m) return;
  decls.push({
    name: m[4],
    kind: m[3].startsWith('function') ? 'function' : m[3] === 'class' ? 'class' : 'state',
    exported: Boolean(m[1]),
    start: i + 1,
  });
});

// A declaration owns lines up to the next top-level declaration — except a
// function or class, which ends at its own closing brace in column 0. Without
// that, the LAST function in the file absorbs every trailing top-level
// statement, which is how `document.addEventListener("DOMContentLoaded", init)`
// was attributed to clearDoneBenchEntries() and invented a bench → init edge
// that made the module graph look cyclic.
decls.forEach((d, i) => {
  const hardEnd = i + 1 < decls.length ? decls[i + 1].start - 1 : lines.length;
  if (d.kind !== 'function' && d.kind !== 'class') { d.end = hardEnd; return; }
  d.end = hardEnd;
  for (let j = d.start; j < hardEnd; j++) {
    if (/^\}/.test(lines[j])) { d.end = j + 1; break; }
  }
});

const byName = new Map(decls.map((d) => [d.name, d]));
const functions = decls.filter((d) => d.kind === 'function' || d.kind === 'class');
const stateVars = decls.filter((d) => d.kind === 'state');

// Banner comments are the author's own seams — useful as a sanity check against
// whatever the graph suggests.
const banners = [];
lines.forEach((line, i) => {
  const m = line.match(/^\/\/\s*={3,}\s*(.+?)\s*={3,}\s*$/);
  if (m) banners.push({ name: m[1].trim(), line: i + 1 });
});

// ---------------------------------------------------------------------- edges

/** Blank out comments and string bodies so identifiers inside them are not
 *  mistaken for code, while KEEPING `${...}` interpolations — those are real
 *  code and carry real calls.
 *
 *  This is a character scanner rather than a set of regexes because regex
 *  pairing cannot survive this file. The previous version blanked `'...'`
 *  globally, so the apostrophe in a template literal's prose — `⚠ couldn't
 *  reach main` — paired with the next unrelated quote and swallowed everything
 *  between. syncFromServer() went from 3,975 characters to 396 and reported
 *  ZERO calls. Whole regions of the graph were missing, which means the
 *  "0 upward dependencies" the plan is validated on was measuring far less than
 *  it claimed. Same character count out as in, so line numbers stay aligned. */
function codeOnly(text) {
  const out = [];
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  // Whether a `/` here starts a regex literal rather than a division: look back
  // at the last significant character. Without this, the `'` inside
  // `.replace(/'/g, …)` opens a phantom string.
  const regexCanFollow = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      const ch = out[k];
      if (ch === ' ' || ch === '\n' || ch === '\t') continue;
      return '(,=:[!&|?{};+-*%~^<>'.includes(ch);
    }
    return true;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i], d = text[i + 1];

    if (c === '/' && d === '/') {
      while (i < text.length && text[i] !== '\n') out.push(blank(text[i++]));
      continue;
    }
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      while (i < stop) out.push(blank(text[i++]));
      continue;
    }
    if (c === '/' && regexCanFollow()) {
      out.push(' '); i++;
      while (i < text.length && text[i] !== '/' && text[i] !== '\n') {
        if (text[i] === '\\') { out.push(' '); i++; }
        if (i < text.length) out.push(blank(text[i++]));
      }
      if (i < text.length && text[i] === '/') { out.push(' '); i++; }
      continue;
    }
    if (c === "'" || c === '"') {
      out.push(' '); i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { out.push(' '); i++; }
        if (i < text.length) out.push(blank(text[i++]));
      }
      if (i < text.length) { out.push(' '); i++; }
      continue;
    }
    if (c === '`') {
      out.push(' '); i++;
      while (i < text.length && text[i] !== '`') {
        if (text[i] === '\\') { out.push(' '); i++; if (i < text.length) out.push(blank(text[i++])); continue; }
        if (text[i] === '$' && text[i + 1] === '{') {
          // Interpolation: emit the inner code verbatim, tracking brace depth so
          // an object literal or a nested template inside it does not end it early.
          out.push(' ', ' '); i += 2;
          let depth = 1;
          const start = i;
          while (i < text.length && depth > 0) {
            const ch = text[i];
            if (ch === '{') depth++;
            else if (ch === '}') { if (--depth === 0) break; }
            i++;
          }
          const inner = text.slice(start, i);
          for (const ch of codeOnly(inner)) out.push(ch);
          if (i < text.length) { out.push(' '); i++; }   // the closing }
          continue;
        }
        out.push(blank(text[i++]));
      }
      if (i < text.length) { out.push(' '); i++; }
      continue;
    }
    out.push(c); i++;
  }
  return out.join('');
}

const bodyOf = (d) => codeOnly(lines.slice(d.start, d.end).join('\n'));

const calls = new Map();     // fn -> Set(fn)  — direct calls: real IMPORT coupling
const handlers = new Map();  // fn -> Set(fn)  — calls named inside on*= strings
const reads = new Map();     // fn -> Set(state)
const writes = new Map();    // fn -> Set(state)

/** Function names invoked from inline on*= handlers in a function's HTML output.
 *  These execute via the window bridge at click time, so they are a runtime
 *  dependency but NOT an import dependency — the distinction that decides
 *  whether the module graph can be acyclic. */
function handlerTargets(rawBody) {
  const out = new Set();
  for (const m of rawBody.matchAll(/\bon[a-z]+\s*=\s*\\?["']([^"']*)["']/g)) {
    for (const c of m[1].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const t = byName.get(c[2]);
      if (t && (t.kind === 'function' || t.kind === 'class')) out.add(t.name);
    }
  }
  return out;
}

for (const fn of functions) {
  const raw = lines.slice(fn.start, fn.end).join('\n');
  const body = bodyOf(fn);
  const c = new Set(); const r = new Set(); const w = new Set();

  for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const t = byName.get(m[2]);
    if (t && t.name !== fn.name && (t.kind === 'function' || t.kind === 'class')) c.add(t.name);
  }
  // A function used as a VALUE — chosen in a ternary, passed as a callback,
  // stored in a map — must be imported exactly as much as one that is called,
  // but `name(` never matches it. These count as direct calls for that reason.
  //
  // Missing them is how a module gets extracted with a dangling reference that
  // only fails in the browser: listNudge() once picked its renderer with
  // `listKey === "wallpapers" ? renderWall : renderBarrel` (the barrel was
  // retired 2026-09-20 and the ternary with it), so chrome looked like a leaf
  // when it was really reaching two layers up. `body` has already
  // had string literals blanked, so a name inside a message or an on*= handler
  // is not mistaken for a reference.
  for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\b(?!\s*\()/g)) {
    const t = byName.get(m[2]);
    if (t && t.name !== fn.name && (t.kind === 'function' || t.kind === 'class')) c.add(t.name);
  }
  const h = handlerTargets(raw);
  h.delete(fn.name);
  handlers.set(fn.name, h);
  for (const sv of stateVars) {
    const rd = new RegExp(`(^|[^.\\w$])${sv.name}\\b`);
    const wr = new RegExp(`(^|[^.\\w$])${sv.name}\\s*(=(?!=)|\\+\\+|--|\\+=|-=)`);
    if (wr.test(body)) w.add(sv.name);
    else if (rd.test(body)) r.add(sv.name);
  }
  calls.set(fn.name, c); reads.set(fn.name, r); writes.set(fn.name, w);
}

// ------------------------------------------------------------------ Tarjan SCC

function tarjan(nodes, edgesOf) {
  let idx = 0; const stack = []; const onStack = new Set();
  const index = new Map(); const low = new Map(); const out = [];

  function strong(v) {
    index.set(v, idx); low.set(v, idx); idx++;
    stack.push(v); onStack.add(v);
    for (const w of edgesOf(v)) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      out.push(comp);
    }
  }
  for (const n of nodes) if (!index.has(n)) strong(n);
  return out;
}

const names = functions.map((f) => f.name);

// Graph A — direct calls only. This is what an `import` between modules would
// have to express, so it is the graph that decides whether the split is acyclic.
const sccs = tarjan(names, (n) => [...(calls.get(n) || [])])
  .map((c) => c.sort())
  .sort((a, b) => b.length - a.length);

// Graph B — direct calls plus handler-driven ones. Cycles present here but
// absent above are exactly the edges the previous attempt converted into real
// imports, which is what tangled its module graph.
const combined = tarjan(names, (n) => [...(calls.get(n) || []), ...(handlers.get(n) || [])])
  .map((c) => c.sort())
  .sort((a, b) => b.length - a.length);
const combinedCyclic = combined.filter((c) => c.length > 1);

const sccOf = new Map();
sccs.forEach((c, i) => c.forEach((n) => sccOf.set(n, i)));

// Layer each SCC: longest path from a leaf in the condensation (0 = imports nothing).
const condEdges = new Map(sccs.map((_, i) => [i, new Set()]));
for (const [fn, targets] of calls) {
  const a = sccOf.get(fn);
  for (const t of targets) {
    const b = sccOf.get(t);
    if (b !== undefined && a !== undefined && a !== b) condEdges.get(a).add(b);
  }
}
const layer = new Map();
function layerOf(i, seen = new Set()) {
  if (layer.has(i)) return layer.get(i);
  if (seen.has(i)) return 0;
  seen.add(i);
  let d = 0;
  for (const j of condEdges.get(i)) d = Math.max(d, layerOf(j, seen) + 1);
  layer.set(i, d);
  return d;
}
sccs.forEach((_, i) => layerOf(i));

// ---------------------------------------------------------------- fan-in / out

const fanIn = new Map(names.map((n) => [n, 0]));
for (const [, targets] of calls) for (const t of targets) fanIn.set(t, (fanIn.get(t) || 0) + 1);

const stateSharers = stateVars.map((sv) => ({
  name: sv.name,
  writers: names.filter((n) => writes.get(n)?.has(sv.name)),
  readers: names.filter((n) => reads.get(n)?.has(sv.name)),
})).sort((a, b) => (b.writers.length + b.readers.length) - (a.writers.length + a.readers.length));

// ------------------------------------------------- sections (the author's seams)

// Each banner comment opens a section that runs to the next banner. Grouping by
// these first respects how the file was actually written, then the cross-section
// edge counts show which sections are genuinely separable and which are one unit
// wearing two names.
const sections = banners.map((b, i) => ({
  name: b.name,
  start: b.line,
  end: i + 1 < banners.length ? banners[i + 1].line - 1 : lines.length,
  fns: [],
}));
if (!sections.length || sections[0].start > 1) {
  sections.unshift({ name: '«preamble»', start: 1, end: sections.length ? sections[0].start - 1 : lines.length, fns: [] });
}

const sectionOf = new Map();
for (const f of functions) {
  const s = sections.find((sec) => f.start >= sec.start && f.start <= sec.end) || sections[sections.length - 1];
  s.fns.push(f);
  sectionOf.set(f.name, s.name);
}

// Direct-call edges between sections.
const secEdges = new Map();
for (const [fn, targets] of calls) {
  const a = sectionOf.get(fn);
  for (const t of targets) {
    const b = sectionOf.get(t);
    if (!a || !b || a === b) continue;
    const k = `${a} → ${b}`;
    secEdges.set(k, (secEdges.get(k) || 0) + 1);
  }
}

const sectionRows = sections
  .filter((s) => s.fns.length)
  .map((s) => {
    const ls = s.fns.map((f) => layer.get(sccOf.get(f.name)));
    const outbound = [...secEdges.entries()].filter(([k]) => k.startsWith(`${s.name} →`)).reduce((a, [, v]) => a + v, 0);
    const inbound = [...secEdges.entries()].filter(([k]) => k.endsWith(`→ ${s.name}`)).reduce((a, [, v]) => a + v, 0);
    return {
      name: s.name,
      fns: s.fns.length,
      lines: s.end - s.start + 1,
      minLayer: Math.min(...ls),
      maxLayer: Math.max(...ls),
      outbound,
      inbound,
    };
  })
  .sort((a, b) => b.lines - a.lines);

// ------------------------------------------------------------------- reporting

const cyclic = sccs.filter((c) => c.length > 1);
const maxLayer = Math.max(...layer.values());

const json = {
  target: TARGET,
  totalLines: lines.length,
  counts: {
    functions: functions.length,
    exported: functions.filter((f) => f.exported).length,
    stateVars: stateVars.length,
    banners: banners.length,
    callEdges: [...calls.values()].reduce((a, s) => a + s.size, 0),
    handlerEdges: [...handlers.values()].reduce((a, s) => a + s.size, 0),
    sccs: sccs.length,
    cyclicSccs: cyclic.length,
    largestCycle: cyclic.length ? cyclic[0].length : 0,
    cyclicSccsWithHandlers: combinedCyclic.length,
    largestCycleWithHandlers: combinedCyclic.length ? combinedCyclic[0].length : 0,
    layers: maxLayer + 1,
  },
  banners,
  functions: functions.map((f) => ({
    name: f.name, exported: f.exported, start: f.start, end: f.end, lines: f.end - f.start + 1,
    layer: layer.get(sccOf.get(f.name)), scc: sccOf.get(f.name),
    fanIn: fanIn.get(f.name), fanOut: calls.get(f.name).size,
    calls: [...calls.get(f.name)].sort(),
    reads: [...reads.get(f.name)].sort(),
    writes: [...writes.get(f.name)].sort(),
  })),
  cycles: cyclic.map((c) => ({ size: c.length, layer: layer.get(sccOf.get(c[0])), members: c })),
  cyclesWithHandlers: combinedCyclic.map((c) => ({ size: c.length, members: c })),
  stateSharers,
};
writeFileSync(join(ROOT, 'dev/console-callgraph.json'), JSON.stringify(json, null, 2));

const topHubs = [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
const byLayer = new Map();
for (const f of functions) {
  const L = layer.get(sccOf.get(f.name));
  if (!byLayer.has(L)) byLayer.set(L, []);
  byLayer.get(L).push(f);
}

const md = `# console-ui.js call graph

Generated by \`scripts/console-callgraph.mjs\`. Line-based attribution, so treat
edge counts as close-but-approximate — enough to choose module boundaries, not a
substitute for reading the code before moving it.

- **${json.totalLines}** lines, **${json.counts.functions}** top-level functions (${json.counts.exported} exported)
- **${json.counts.stateVars}** module-level state declarations
- **${json.counts.callEdges}** direct call edges, **${json.counts.handlerEdges}** handler-driven edges
- **${json.counts.layers}** dependency layers after collapsing cycles

## The finding that decides the split

Two graphs matter, and they differ:

| graph | what an edge means | cycles | largest |
|---|---|---|---|
| direct calls | one function calls another — an \`import\` between modules | **${json.counts.cyclicSccs}** | ${json.counts.largestCycle} |
| + handler calls | plus names invoked from inline \`on*=\` strings, which resolve on \`window\` at click time | **${json.counts.cyclicSccsWithHandlers}** | ${json.counts.largestCycleWithHandlers} |

Handler-driven calls already travel through the window bridge, so they impose **no
import dependency**. Turning them into explicit imports is what tangled the
previous attempt — it made every surface import every other. Leave them on the
bridge and the module graph can stay acyclic.

## Cycles in the direct-call graph (must be broken, or kept inside one module)

${cyclic.length === 0 ? '_None — the direct-call graph is already a DAG._' : cyclic.slice(0, 10).map((c) => `- **${c.length} fns** (layer ${layer.get(sccOf.get(c[0]))}): ${c.slice(0, 12).join(', ')}${c.length > 12 ? `, … +${c.length - 12}` : ''}`).join('\n')}

## Cycles introduced by treating handler calls as imports

${combinedCyclic.length === 0 ? '_None._' : combinedCyclic.slice(0, 6).map((c) => `- **${c.length} fns**: ${c.slice(0, 14).join(', ')}${c.length > 14 ? `, … +${c.length - 14}` : ''}`).join('\n')}

## Layers (0 = calls nothing else in this file)

${[...byLayer.keys()].sort((a, b) => a - b).map((L) => {
  const fns = byLayer.get(L);
  const total = fns.reduce((a, f) => a + (f.end - f.start + 1), 0);
  return `- **layer ${L}** — ${fns.length} fns, ~${total} lines`;
}).join('\n')}

## Most-called functions (natural bottom layer)

${topHubs.map(([n, c]) => `- \`${n}\` — called by ${c}`).join('\n')}

## Most-shared state (each one is a module boundary hazard)

${stateSharers.slice(0, 15).map((s) => `- \`${s.name}\` — ${s.writers.length} writers, ${s.readers.length} readers`).join('\n')}

## Sections (the author's own banner seams)

\`in\`/\`out\` are direct call edges crossing the section boundary. A section with
low traffic in both directions is a clean lift; heavy traffic means it belongs
with whatever it talks to.

| section | fns | lines | layers | in | out |
|---|---:|---:|---:|---:|---:|
${sectionRows.map((s) => `| ${s.name} | ${s.fns} | ${s.lines} | ${s.minLayer}–${s.maxLayer} | ${s.inbound} | ${s.outbound} |`).join('\n')}

## Heaviest cross-section dependencies

${[...secEdges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `- ${k} — ${v}`).join('\n')}
`;
writeFileSync(join(ROOT, 'dev/console-callgraph.md'), md);

console.log(`${json.counts.functions} fns · ${json.counts.callEdges} edges · ${json.counts.layers} layers · ${json.counts.cyclicSccs} cycles (largest ${json.counts.largestCycle})`);
console.log('wrote dev/console-callgraph.json + dev/console-callgraph.md');
