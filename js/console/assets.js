// OAKLENS Field Console — assets.
//
// Everything about an image as a FILE rather than as content: where its CDN URL
// is, and how a dropped photo becomes the WebP variants that get uploaded. Plus
// the base-revision marker that stamps each publish.
//
// A leaf: imports no other console module. The resize path is deliberately
// decode-once-draw-many because iPadOS enforces a per-page decoded-image budget
// and the old decode-per-variant path blew through it on a big drop.
//
// getSyncedSha/setSyncedSha were module-private; they are exported now because
// publishToServer() reads and writes the marker from across the boundary. That
// pairing is the cross-device stale-publish guard — see js/console/publish.js
// once it exists, and the worker's _commitFiles.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.


// ============== CDN PREVIEW HELPER ==============
// CDN root from the worker-injected <meta name="cdn-base"> (site.config
// cdnBase, or this origin's /api/cdn R2 proxy on a fresh fork).
export const CDN_BASE = (document.querySelector('meta[name="cdn-base"]')?.content
  || `${location.origin}/api/cdn`).replace(/\/+$/, '');

// Default location label from the worker-injected <meta name="site-location">
// (site.config location.name).
export const SITE_LOCATION = document.querySelector('meta[name="site-location"]')?.content || '';

// The site's own identity, also worker-injected (src/shared/site.js
// siteMetaTags). The console renders the brand in a few places the edge cannot
// reach — a canvas OG card, a download filename — so it reads the same values
// the markup gets rather than carrying a second copy of the name.
const _meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || '';
export const SITE_NAME = _meta('site-name');
export const SITE_WORDMARK = _meta('site-wordmark');
export const SITE_WORDMARK_ACCENT = _meta('site-wordmark-accent');
// The stem is whatever the wordmark is minus its accent half (STUDIO + .COM).
export const SITE_WORDMARK_STEM = SITE_WORDMARK_ACCENT && SITE_WORDMARK.endsWith(SITE_WORDMARK_ACCENT)
  ? SITE_WORDMARK.slice(0, -SITE_WORDMARK_ACCENT.length)
  : SITE_WORDMARK;
// Filename-safe brand prefix for downloads (STUDIO_Title.webp). Uppercased and
// stripped to A-Z0-9 so it is safe on every filesystem — which also means it
// can never carry a regex metacharacter into sanitizeWallTitle's RegExp.
// Empty config → no prefix.
export const SITE_FILE_PREFIX = SITE_NAME.toUpperCase().replace(/[^A-Z0-9]+/g, '');

// Detect video assets by explicit kind or filename extension (extension is the
// fallback so entries survive a library.json round-trip even if `kind` is lost).
export function isVideoAsset(entry) {
  if (!entry) return false;
  if (entry.kind === 'video') return true;
  return /\.(mp4|webm|mov)$/i.test(entry.filename || '');
}

export function cdnThumb(entry, folder = 'archive') {
  // If we have a local dataURL (from drag-drop), use it
  if (entry.image) return entry.image;
  // Video entries: the generated poster frame stands in for a thumbnail
  if (folder === 'videos' || isVideoAsset(entry)) {
    const base = (entry.filename || '').replace(/\.[^.]+$/, '');
    return `${CDN_BASE}/videos/posters/${base}.webp`;
  }
  // If we have a filename, construct CDN URL for the 1024w preview
  if (entry.filename) {
    const base = entry.filename.replace(/\.[^.]+$/, '');
    return `${CDN_BASE}/${folder}/${base}-1024w.webp`;
  }
  return '';
}

// The same address at a chosen width. cdnThumb() is hardcoded to 1024w because
// that is the only size a grid cell ever wants; anything pointing at a full
// frame (the homepage hero line, for one) needs 2048w, and building that string
// by hand at the call site is how a folder or a suffix drifts.
export function cdnVariant(entry, width = 2048, folder = 'archive') {
  if (!entry?.filename) return '';
  const base = entry.filename.replace(/\.[^.]+$/, '');
  return `${CDN_BASE}/${folder}/${base}-${width}w.webp`;
}

// ============== IMAGE RESIZING ==============
// Decode the source ONCE, then draw every size variant from that single bitmap.
// iOS Safari (iPad) enforces a per-page decoded-image budget; the old path
// decoded the full-resolution source three times in parallel (Promise.all of
// 480/1024/2048), which tipped large Photos exports over the edge — Safari then
// silently produced a blank canvas or a null toBlob, the entry was flagged
// _uploadError, yet still got published with no CDN asset behind it.

// Decode a blob to a drawable source (ImageBitmap, or <img> fallback).
// imageOrientation:'from-image' honors EXIF so portrait shots aren't rotated,
// matching the previous <img>-based behavior.
export async function _decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (_) {
      // Some inputs/engines reject createImageBitmap — fall back to <img>.
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { img._objectUrl = url; resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

// Release a decoded source promptly (frees memory between batched photos).
export function _releaseImage(src) {
  if (!src) return;
  if (typeof src.close === 'function') src.close();        // ImageBitmap
  if (src._objectUrl) URL.revokeObjectURL(src._objectUrl);  // <img> fallback
}

// Draw an already-decoded source down to a target width as a WebP blob.
export function _drawToWebP(src, targetWidth) {
  return new Promise((resolve, reject) => {
    const sw = src.naturalWidth || src.width;
    const sh = src.naturalHeight || src.height;
    if (!sw || !sh) return reject(new Error('Decoded image has zero dimensions'));
    const w = Math.min(sw, targetWidth);
    const h = Math.round(sh * (w / sw));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas 2D context unavailable'));
    ctx.drawImage(src, 0, 0, w, h);
    canvas.toBlob(
      blob => (blob && blob.size > 0)
        ? resolve(blob)
        : reject(new Error('Canvas toBlob returned null/empty')),
      'image/webp', 0.85
    );
  });
}

// Single-size helper (used for inline previews): decode once, draw once.
export async function _resizeToWebP(sourceBlob, targetWidth) {
  const src = await _decodeImage(sourceBlob);
  try {
    return await _drawToWebP(src, targetWidth);
  } finally {
    _releaseImage(src);
  }
}

export async function generateVariants(file, baseName, folder = 'archive') {
  const src = await _decodeImage(file);
  try {
    // Sequential from the single decoded source — largest first so a memory
    // failure surfaces immediately instead of after the small sizes succeed.
    const v2048 = await _drawToWebP(src, 2048);
    const v1024 = await _drawToWebP(src, 1024);
    const v480  = await _drawToWebP(src, 480);
    return [
      new File([v480],  `${folder}/${baseName}-480w.webp`,  { type: 'image/webp' }),
      new File([v1024], `${folder}/${baseName}-1024w.webp`, { type: 'image/webp' }),
      new File([v2048], `${folder}/${baseName}-2048w.webp`, { type: 'image/webp' }),
    ];
  } finally {
    _releaseImage(src);
  }
}

// ============== THE STAMPED SET ==============
//
// Which cards already have a live share stamp on R2 — the MARKER, which is the
// R2 key with `meta/` and `-og.webp` taken off it (shareMarker(), in
// card-paint.js). It is the ONE source of truth for "is this live", read by the
// buffer's ▣ badge, the archive's ▣ badge, the focal modal's live line and the
// share block, so none of the four can disagree about what is on R2.
//
// ⚠️ NOT ONLY FRAMES SINCE CHUNK 8. A frame's marker is its image basename, but
// /api/og-cards lists every stem under `meta/` — so the set also holds
// `fn-<slug>`, `audio-<slug>`, `set-<slug>` and `card-<id>`. A caller that only
// knows about basenames simply never asks about those, which is why one set
// serves every reader.
//
// ⚠️ IT LIVES DOWN HERE, and that is load-bearing rather than tidy. It was in
// buffer.js, whose own comment said it belonged with its consumer — but
// `archive` sits BELOW `buffer` in the plan order, so the archive could not
// import it and physically could not draw the badge. That is how the archive
// editor came to be the one frame surface that told an author nothing about
// what was live (2026-09-18). Storage bookkeeping belongs in the storage
// module, below every reader; buffer.js re-exports it so nothing else moved.
//
// Written through setters because an imported binding cannot be assigned — the
// producers (loadOgCards, the focal modal, the share block) all sit above.
// A MAP, not a Set, since 2026-09-18: the value is the STYLE the stamp was
// painted in ('card' | 'plain'), which /api/og-cards reads off R2 object
// metadata. It has to be known, or reopening a stamped frame would preview the
// wrong style and call it live — the same lie, one layer along.
// '' means a stamp made before styles existed, which every reader treats as
// 'card', because that is what all of them are.
let OG_CARD_SET = new Map();
/** Accepts bare markers (legacy, and every test that does not care about style)
 *  or [marker, style] pairs, which is what loadOgCards passes. */
export function _setOgCardSet(bases) {
  OG_CARD_SET = new Map((bases || []).map((b) => (Array.isArray(b) ? [b[0], b[1] || ''] : [b, ''])));
}
export function _addOgCard(base, style = '') { OG_CARD_SET.set(base, style || ''); }
// The counterpart to _addOgCard, for turning a stamp OFF. A stamp has no
// publish horizon in either direction: it is live the moment it lands on R2 and
// gone the moment it is deleted, so the set follows immediately rather than
// waiting for a publish.
export function _removeOgCard(base) { OG_CARD_SET.delete(base); }
export function _hasOgCard(base) { return OG_CARD_SET.has(base); }
/** Which style the live stamp is, or '' when unknown/unstamped. */
export function _ogCardStyle(base) { return OG_CARD_SET.get(base) || ''; }

// Base-revision tracking (cross-device stale-publish guard). We record the main
// HEAD each successful sync pulled from, persisted so it survives a PWA reload,
// and stamp it onto every publish. The worker rejects a publish whose base no
// longer matches main — i.e. another device published in between (see worker
// _commitFiles / handlePublish). This is what a stale iPad PWA republishing over
// a laptop's fresh commit would trip, instead of silently reverting it.
const SYNCED_SHA_KEY = 'oaklens_synced_sha';
export function getSyncedSha() {
  try { return localStorage.getItem(SYNCED_SHA_KEY) || null; } catch { return null; }
}
export function setSyncedSha(sha) {
  try {
    if (sha) localStorage.setItem(SYNCED_SHA_KEY, sha);
    else localStorage.removeItem(SYNCED_SHA_KEY);
  } catch { /* private mode / quota — the guard just falls back to skipped */ }
}
