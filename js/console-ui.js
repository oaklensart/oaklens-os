// OAKLENS // FIELD CONSOLE — the barrel.
//
// This file used to be the console: ~5,600 lines of every surface, modal and
// handler. It is now the seam between the console's twenty modules and the
// page that loads them, and holds no logic of its own.
//
// Two jobs:
//
//   1. One import for the bridge. dev/field-console.html does
//      `import * as ConsoleUI from '/js/console-ui.js'` and mirrors the
//      namespace onto window, because the markup binds events with inline
//      on*= attributes that resolve in global scope. Re-exporting everything
//      from here means the bridge never has to learn the module list.
//   2. Boot. `export * from './console/init.js'` evaluates that module, which
//      registers init() on DOMContentLoaded. Nothing else starts the console.
//
// The order below is the LAYER order (bottom-up, chrome first): a module may
// import only ones listed above it. That is the property the whole split
// exists to protect — tests/console-modules.test.js asserts it against the
// real import statements, and scripts/console-module-plan.mjs re-derives it
// from the call graph. `export *` is order-insensitive at runtime, so this is
// documentation for the next reader rather than a constraint on the loader.
//
// State, network, telemetry and markdown are NOT re-exported here: the bridge
// imports console-state.js / console-api.js / console-telemetry.js /
// markdown-engine.js directly, and each console module imports what it needs.
//
// Adding a module: create js/console/<name>.js, add it to PLAN in
// scripts/console-module-plan.mjs, add an `export *` line here in layer
// order, and register it in dev/field-console.html's import map AND
// dev/sw.js SHELL_ASSETS (bumping the SW CACHE name). See
// dev/console-module-plan.md.

// Labels sit ABOVE their export, not trailing it: the dangling-reference guard
// in tests/console-modules.test.js strips whole-line comments only (pairing-
// based stripping mis-fires on an apostrophe in prose, which is how a real
// reference once hid), so a trailing `// toast, …` reads to it as live code.

// toast, theme, the view router, sheets, dropzones, escapers
export * from './console/chrome.js';
// the canvas bloom: light pooled onto the chassis around whatever is data-lit
export * from './console/lighting.js';
// "what does this do?" — the help overlay and every word it says
export * from './console/help.js';
// CDN URLs, WebP variant generation, the publish base-revision marker
export * from './console/assets.js';
// dates, filenames, content hashing, the id minter
export * from './console/utils.js';
// library index auto-commit + the queued R2 delete drain
export * from './console/sync.js';
// the R2 upload queue, its panel, and the no-broken-frame publish gates
export * from './console/upload.js';
// Library / Wall / Network + list drag-reorder
export * from './console/more-views.js';
// the curated-frames compose form, stage/edit, renderer
export * from './console/archive.js';
// the rolling buffer, dark-frame retire, promote, burst linking
export * from './console/buffer.js';
// the Field Notes editor, cloud drafts, pickers, frame browser
export * from './console/fn-editor.js';
// the share painter: one renderer for every card, at three ratios
export * from './console/card-paint.js';
// the framing modal, per-surface focal entry points, OG cards
export * from './console/focal.js';
// the share block: copy the link, stamp three ratios, download two
export * from './console/share.js';
// the media picker + per-surface selection callbacks
export * from './console/asset-library.js';
// the audio shelf: one registry, waveform measured at attach, promote-to-card
export * from './console/audio.js';
// the Cards view: the homepage grid, LIVE vs STAGED, run through its own logic
export * from './console/cards.js';
// bundle + commit to main, sync down, exports, the publish view
export * from './console/publish.js';
// auth, the Settings sheet, expiry warning, offline indicator
export * from './console/session.js';
// the darkroom RAW queue (D1 + the signed B2 download proxy)
export * from './console/bench.js';
// the pulse composer: six starter packs, one POST, no publish
export * from './console/pulse.js';
// the composition root — wires every seam, boots on DOMContentLoaded
export * from './console/init.js';
