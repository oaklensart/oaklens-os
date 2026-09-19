// OAKLENS Field Console — utils.
//
// The generic helpers every surface leans on: date formatting (todayISO, ymd,
// ymdDots), filenames and slugs (cleanFilename, slugify), file IO
// (readFileAsDataURL, readEXIFDate), content hashing + the cross-surface
// duplicate check (computeHash, findDuplicateByHash), and uid — the id minter
// behind every entry.
//
// A leaf: imports nothing but console-state (findDuplicateByHash scans STATE).
// This module was carved out of the old `trash` grouping, which line
// attribution had misnamed — see dev/console-module-plan.md. uid moved here
// deliberately: it is an arrow const the callgraph cannot see, and leaving it
// behind while its callers extract is exactly how CDN_BASE stranded once
// before.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE } from '../console-state.js';

// ============== UTILS ==============
export const uid = () => Math.random().toString(36).slice(2, 9);

export function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
export async function readEXIFDate(file) {
  try {
    // RAW LENS extractions carry the capture date parsed straight from the
    // RAW container — trust it over re-parsing the embedded JPEG.
    if (file._rawCaptureDate instanceof Date) return file._rawCaptureDate;
    if (!window.exifr) return null;
    const data = await window.exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
    const d = data?.DateTimeOriginal || data?.CreateDate;
    return d ? new Date(d) : null;
  } catch(e){ return null; }
}
export function todayISO() {
  return new Date().toISOString();
}
export function ymd(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function ymdDots(date) {
  return ymd(date).replace(/-/g, "·");
}
export function slugify(s) {
  return (s || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Characters an R2 object key may hold — the client half of the charset in
// src/api/assets.js (R2_KEY_CHARS). The two MUST agree: whatever the console
// records as an item's `filename` is the key the page later asks the CDN for,
// so any character the server strips on upload and the console keeps is a file
// stored under one name and requested under another — a 400 the visitor sees
// as a dead image or a player that will not start. Keep this in lockstep with
// the server list; tests/audio-key-contract.test.js pins that they match.
const R2_SAFE_CHARS = /[^\p{L}\p{M}\p{N}_ .+=()/-]/gu;

// Strip oakpush size suffixes from dropped filenames, drop anything an R2 key
// cannot carry, and trim whitespace — including the invisible kind sitting
// right before the extension ("Earpiece .jpg"), which otherwise mints variant
// keys with a space the author can't see ("archive/Earpiece -480w.webp").
export function cleanFilename(name) {
  return (name || "")
    .trim()
    .replace(/-(480|1024|2048)w(?=\.\w+$)/, "")
    .replace(R2_SAFE_CHARS, "")
    .replace(/\s+(?=\.\w+$)/, "")
    .trim();
}

// SHA-256 of the original file bytes → 'sha256:' + first 8 hex chars.
// Small files hash on the main thread; large files offload to an inline Worker.
export async function computeHash(file) {
  if (file.size < 5 * 1024 * 1024) {
    const ab = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', ab);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return 'sha256:' + hashHex.slice(0, 8);
  }
  // Large file: hash in a Web Worker so the UI stays responsive
  return new Promise((resolve, reject) => {
    const workerCode = `
      self.onmessage = async (e) => {
        const hashBuffer = await crypto.subtle.digest('SHA-256', e.data);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0')).join('');
        self.postMessage('sha256:' + hashHex.slice(0, 8));
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    file.arrayBuffer().then(ab => {
      worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
      worker.onerror = (e) => { reject(e); worker.terminate(); };
      worker.postMessage(ab, [ab]);
    }).catch(reject);
  });
}

// Look for an existing entry (any surface) that already carries this hash.
export function findDuplicateByHash(hash) {
  if (!hash) return null;
  const surfaces = [
    { name: 'buffer', data: STATE.buffer },
    { name: 'archive', data: STATE.archive },
    { name: 'wallpapers', data: STATE.wallpapers },
    { name: 'library', data: STATE.library },
  ];
  for (const { name, data } of surfaces) {
    const match = data.find(e => e.hash === hash);
    if (match) return { surface: name, entry: match };
  }
  return null;
}
