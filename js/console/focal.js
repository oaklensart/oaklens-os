// OAKLENS Field Console — focal.
//
// The unified framing modal (FocalModal): a per-image focal point that every
// cover crop reads as object-position, plus — given a card context — the
// 1200×630 OG card composited from the SAME point. The per-surface entry
// points (archive, archive-card, buffer, buffer-card, wall, FN hero) and the
// OG-card index load live here with it.
//
// Sits ABOVE the surfaces on purpose: the entry points read each surface's
// live state (archiveEditId, the compose focal bindings, fnCurrentId) and
// persist through each surface's own functions. State it must WRITE goes
// through downward setters (_setArchiveComposeFocus/-CardFocus, _setOgCardSet/
// _addOgCard) — an imported binding cannot be assigned.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE, save, stageChange } from '../console-state.js';
import { getToken, uploadFiles, fetchOgCards } from '../console-api.js';
import { toast } from './chrome.js';
import { CDN_BASE, cdnThumb, SITE_NAME, SITE_WORDMARK_STEM, SITE_WORDMARK_ACCENT } from './assets.js';
import { ymd } from './utils.js';
import { renderBuffer, _setOgCardSet, _addOgCard } from './buffer.js';
import { archiveEditId, archiveComposeFocus, archiveComposeCardFocus, _setArchiveComposeFocus, _setArchiveComposeCardFocus, renderArchive } from './archive.js';
import { renderWall } from './more-views.js';
import { fnCurrentId, fnMarkDirty, getBufferFrameNumbers } from './fn-editor.js';

// ============== FOCAL POINT PICKER ==============
// A reusable modal that sets a per-image "focal point" — Squarespace-style.
// The site's thumbnails are object-fit:cover boxes, so by default they crop to
// the image center. The focal point is stored as a ready-to-use `object-position`
// string (e.g. "50% 30%") and applied to every cover thumbnail of that image
// (archive cards, the buffer strip, the buffer contact sheet, wall cards). The
// full-frame lightbox (object-fit:contain) is unaffected — it always shows the
// whole story. One point works across all the responsive crop ratios, and no
// new CDN derivatives are needed. Absent/center ("50% 50%") is the default, so
// every existing entry is unchanged.
// Unified framing modal: sets the per-image focal point AND (when given a `card`
// context) composites the 1200×630 OG card from the SAME point — one setting,
// two outputs. The stage shows the full frame with the focal dot plus two crop
// safety-guides (solid red = OG-card crop, dashed = thumbnail crop) so you can
// see what each output keeps as you drag; the side shows the live card. Publish
// saves the card to meta/<base>-og.webp AND persists the focal point (thumbnails
// benefit too). The card canvas is fed from the same-origin /api/cdn/ proxy so
// it isn't CORS-tainted.
export const FocalModal = (() => {
  const $ = id => document.getElementById(id);
  const clamp = n => Math.max(0, Math.min(100, n));
  const CW = 1200, CH = 630, RAIL = 120, PHOTO_H = CH - RAIL;   // card geometry
  const OG_ASPECT = CW / PHOTO_H;                               // 2.353 — card photo-zone crop

  let onSaveCb = null, wired = false;
  let focus = { x: 50, y: 50 };
  let thumbAspect = 1.5;     // numeric thumbnail crop aspect (from opts.aspect)
  let card = null;           // { base, folder, label, dateStr, shareUrl } or null
  let cardImg = null;        // same-origin source for the canvas

  function parseFocus(str) {
    const m = /(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(str || '');
    return m ? { x: clamp(+m[1]), y: clamp(+m[2]) } : { x: 50, y: 50 };
  }
  function focusStr() { return `${Math.round(focus.x)}% ${Math.round(focus.y)}%`; }
  function aspectNum(s) { const m = /([\d.]+)\s*[/:]\s*([\d.]+)/.exec(s || ''); return m ? (+m[1]) / (+m[2]) : 1.5; }
  function setStatus(msg, cls) { const s = $('ogc-status'); if (s) { s.textContent = msg || ''; s.className = 'ogc-status ' + (cls || ''); } }
  async function ensureFont() { try { await document.fonts.load('400 26px "Syne Mono"'); await document.fonts.ready; } catch {} }

  // Displayed rect of the contain-fit image inside the stage (so the dot/guides
  // map to the *image*, not the letterboxed container).
  function imageRect() {
    const stage = $('focal-stage'), img = $('focal-img');
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const nw = img.naturalWidth || 3, nh = img.naturalHeight || 2;
    const cAR = cw / ch, iAR = nw / nh;
    let w, h, x, y;
    if (iAR > cAR) { w = cw; h = cw / iAR; x = 0; y = (ch - h) / 2; }
    else { h = ch; w = ch * iAR; y = 0; x = (cw - w) / 2; }
    return { x, y, w, h, iAR };
  }

  // Stage-px rect that a cover-crop of aspect A keeps at the current focal point.
  function cropRectPx(A) {
    const r = imageRect();
    let vw, vh, vx, vy;
    if (r.iAR >= A) { vw = A / r.iAR; vh = 1; vx = (1 - vw) * (focus.x / 100); vy = 0; }
    else { vw = 1; vh = r.iAR / A; vx = 0; vy = (1 - vh) * (focus.y / 100); }
    return { left: r.x + vx * r.w, top: r.y + vy * r.h, w: vw * r.w, h: vh * r.h };
  }
  function paintGuides() {
    const og = $('focal-guide-og'), th = $('focal-guide-thumb');
    if (!card || !$('focal-guide-toggle').checked) { og.style.display = th.style.display = 'none'; return; }
    const place = (el, A) => { const c = cropRectPx(A); el.style.display = 'block';
      el.style.left = c.left + 'px'; el.style.top = c.top + 'px'; el.style.width = c.w + 'px'; el.style.height = c.h + 'px'; };
    place(th, thumbAspect); place(og, OG_ASPECT);
  }

  // ---- card compositing ----
  function cardCoverRect(sw, sh) {
    const scale = Math.max(CW / sw, PHOTO_H / sh);
    const cw = CW / scale, ch = PHOTO_H / scale;
    return { sx: (sw - cw) * (focus.x / 100), sy: (sh - ch) * (focus.y / 100), cw, ch };
  }
  function drawSegments(ctx, segs, x, y, size, align) {
    ctx.font = `400 ${size}px "Syne Mono", ui-monospace, monospace`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    try { ctx.letterSpacing = `${Math.round(size * 0.09)}px`; } catch {}
    const widths = segs.map(s => ctx.measureText(s.t).width);
    let cx = align === 'right' ? x - widths.reduce((a, b) => a + b, 0) : x;
    segs.forEach((s, i) => { ctx.fillStyle = s.c; ctx.fillText(s.t, cx, y); cx += widths[i]; });
  }
  // The card is drawn to a canvas, and a canvas cannot resolve CSS variables —
  // which is why the two brand marks below were hardcoded red, and why every
  // fork's link previews carried this instance's colour no matter which preset
  // it ran. Read the token instead, at draw time, so the card wears the site's
  // own brand. --brand rather than --accent: the card is always on black, and
  // --accent swaps to the paper tier in DAYLIGHT while the card never does.
  function brandColor() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
    return v || '#FF0000';
  }
  function drawCard() {
    const cv = $('ogc-canvas'); if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
    if (cardImg) {
      const r = cardCoverRect(cardImg.naturalWidth || cardImg.width, cardImg.naturalHeight || cardImg.height);
      ctx.drawImage(cardImg, r.sx, r.sy, r.cw, r.ch, 0, 0, CW, PHOTO_H);
    }
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, PHOTO_H, CW, 1);
    const cy = PHOTO_H + RAIL / 2;
    const brand = brandColor();
    const leftSegs = [{ t: `${(card.label || '').toUpperCase()} `, c: '#9b9b9b' }];
    if (card.dateStr && card.dateStr !== '—') leftSegs.push({ t: '//', c: brand }, { t: ` ${card.dateStr}`, c: '#9b9b9b' });
    drawSegments(ctx, leftSegs, 44, cy, 26, 'left');
    // The wordmark rail. Two segments so the accent half carries the brand, both
    // the TEXT and the COLOUR from the site's own config and preset — the card
    // is a published image, so either one hardcoded here ships this instance's
    // identity in every fork's link previews.
    const brandSegs = [{ t: SITE_WORDMARK_STEM, c: '#E0E0E0' }];
    if (SITE_WORDMARK_ACCENT) brandSegs.push({ t: SITE_WORDMARK_ACCENT, c: brand });
    drawSegments(ctx, brandSegs, CW - 44, cy, 24, 'right');
  }

  function paint() {
    const r = imageRect(), dot = $('focal-dot');
    dot.style.left = (r.x + focus.x / 100 * r.w) + 'px';
    dot.style.top = (r.y + focus.y / 100 * r.h) + 'px';
    $('focal-readout').textContent = `${Math.round(focus.x)}% / ${Math.round(focus.y)}%`;
    if (card) { drawCard(); paintGuides(); }
    else { $('focal-crop-img').style.objectPosition = focusStr(); }
  }

  function setFromPointer(e) {
    const r = imageRect(), box = $('focal-stage').getBoundingClientRect();
    focus.x = clamp(((e.clientX - box.left) - r.x) / r.w * 100);
    focus.y = clamp(((e.clientY - box.top) - r.y) / r.h * 100);
    paint();
  }

  function wire() {
    if (wired) return;
    wired = true;
    const stage = $('focal-stage');
    let dragging = false;
    stage.addEventListener('pointerdown', e => {
      dragging = true; setFromPointer(e);
      try { stage.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });
    stage.addEventListener('pointermove', e => { if (dragging) setFromPointer(e); });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('resize', () => { if (!$('focal-modal').classList.contains('hidden')) paint(); });
    $('focal-guide-toggle').addEventListener('change', paintGuides);
    // Escape backs out of the crop, the way clicking the scrim and dragging the
    // sheet down already do. It also STOPS THERE: this modal opens from the
    // Cards composer, whose own Escape exits edit mode — so before this, one
    // press cancelled the crop AND dropped the card out of edit mode behind the
    // still-open modal.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('focal-modal').classList.contains('hidden')) return;
      e.stopPropagation();
      close();
    });
  }

  function open(opts) {
    wire();
    onSaveCb = opts.onSave || null;
    focus = parseFocus(opts.focus);
    thumbAspect = aspectNum(opts.aspect);
    card = opts.card || null;
    cardImg = null;
    $('focal-cardwrap').style.display = card ? '' : 'none';
    $('focal-thumbwrap').style.display = card ? 'none' : '';
    $('focal-card-actions').style.display = card ? '' : 'none';
    $('focal-modal-title').textContent = card ? '▣ FRAME // OG CARD' : '◎ FOCAL POINT';
    // Clear any stale guides — thumbnail mode never re-paints them; card mode
    // re-shows them via paintGuides(). Per-action buttons depend on the surface.
    $('focal-guide-og').style.display = 'none';
    $('focal-guide-thumb').style.display = 'none';
    if (card) {
      $('focal-btn-copy').style.display = card.shareUrl ? '' : 'none';        // only where a page unfurls this card
      $('focal-btn-publish').style.display = (card.canPublish !== false) ? '' : 'none';
    }
    setStatus('');
    const img = $('focal-img');
    img.onload = paint;
    img.src = opts.src;
    if (card) {
      $('focal-guide-toggle').checked = true;
      ensureFont().then(() => {
        let fb = false;
        const ci = new Image();   // same-origin proxy → untainted canvas
        ci.onload = () => { cardImg = ci; paint(); };
        ci.onerror = () => {
          if (!fb) { fb = true; ci.src = `/api/cdn/${card.folder}/${encodeURIComponent(card.base)}-1024w.webp`; return; }
          cardImg = null; paint(); setStatus('source image failed', 'err');
        };
        ci.src = `/api/cdn/${card.folder}/${encodeURIComponent(card.base)}-2048w.webp`;
      });
    } else {
      $('focal-crop-preview').style.aspectRatio = (opts.aspect || '3 / 2').replace('/', ' / ');
      $('focal-crop-img').src = opts.src;
    }
    $('focal-modal').classList.remove('hidden', 'closing');
    if (img.complete && img.naturalWidth) paint();
  }

  // "Set Focal Point" — persist the point and close (works in either mode).
  function save() { const f = focusStr(); const cb = onSaveCb; close(); if (cb) cb(f); }
  function reset() { focus = { x: 50, y: 50 }; paint(); }
  function close() { hideOverlay('focal-modal'); onSaveCb = null; card = null; cardImg = null; }
  function toBlob() {
    return new Promise((res, rej) => $('ogc-canvas').toBlob(b => (b && b.size) ? res(b) : rej(new Error('canvas export failed')), 'image/webp', 0.9));
  }
  async function download() {
    if (!card) return;
    try {
      const b = await toBlob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `oaklens-${card.base}-og.webp`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus('downloaded', 'ok');
    } catch (e) { toast('⚠ ' + e.message, 'error'); }
  }
  async function copyLink() {
    if (!card || !card.shareUrl) return;
    try { await navigator.clipboard.writeText(card.shareUrl); setStatus('link copied', 'ok'); toast('✓ share link copied', 'success'); }
    catch { setStatus('copy blocked — link shown', 'err'); window.prompt('Copy the share link:', card.shareUrl); }
  }
  async function publish() {
    if (!card) return;
    if (!getToken()) return toast('log in to publish', 'error');
    try {
      setStatus('publishing…');
      const blob = await toBlob();
      const file = new File([blob], `meta/${card.base}-og.webp`, { type: 'image/webp' });
      await uploadFiles([file]);
      _addOgCard(card.base);   // buffer owns the set — see js/console/buffer.js
      if (onSaveCb) onSaveCb(focusStr());   // persist the focal point too — thumbnails use it
      setStatus('✓ published to R2', 'ok');
      toast('✓ OG card published — the link now unfurls with it', 'success');
      renderBuffer();
    } catch (e) { setStatus('failed', 'err'); toast('⚠ publish failed: ' + e.message, 'error'); }
  }

  return { open, save, reset, close, publish, download, copyLink };
})();

// Convenience wrapper used by every surface's entry point.
export function openFocalModal(opts) { FocalModal.open(opts); }

// Ledger labels want the citable frame number ("f#241"), same zero-padding as
// every surface that prints one.
function _frameLabel(id) {
  return `f#${String(getBufferFrameNumbers().get(id) || 0).padStart(3, '0')}`;
}

// ---- Per-surface entry points ----

export function openArchiveFocal() {
  const img = document.querySelector('#archive-preview-wrap img');
  if (!img || !img.getAttribute('src')) return toast('drop a photo first', 'error');
  // Card mode only for an EXISTING archive entry (its image is on the CDN and it
  // has a ?f= page that unfurls). A brand-new compose stays focal-only.
  let card = null;
  const a = archiveEditId ? STATE.archive.find(x => x.id === archiveEditId) : null;
  if (a && a.filename) {
    card = {
      base: a.filename.replace(/\.[^.]+$/, ''), folder: 'archive',
      label: a.title || 'ARCHIVE',
      dateStr: ymd(a.added_at) || '',
      shareUrl: `${location.origin}/archive/?f=${encodeURIComponent(a.slug || a.id)}`,
    };
  }
  openFocalModal({
    src: img.src,
    focus: archiveComposeFocus,
    aspect: '3 / 2',
    card,
    onSave: f => {
      const focus = (f === '50% 50%') ? '' : f;
      _setArchiveComposeFocus(focus);
      // Existing entry: persist straight to the entry + stage it, like the buffer/wall
      // focal flows. Otherwise the focus only ever reaches archive.json on a separate
      // "UPDATE ENTRY" click, so publishing the OG card alone left the /archive thumbnail
      // (object-position) stale and nothing dirty to publish. A brand-new compose has no
      // entry yet, so it stays transient and gets applied when archiveStage() creates it.
      if (a) {
        if (focus) a.focus = focus; else delete a.focus;
        stageChange('archive', { id: a.id, label: `${a.title || 'archive entry'} — focal point` });
        save(); renderArchive();
        toast('✓ focal point set — publish archive to update the thumbnail', 'success');
      } else {
        toast('✓ focal point set — applies on stage', 'success');
      }
    },
  });
}

// Changelog-card crop. The homepage "recent work" card is a TALL 4:5 portrait —
// a different shape from the 3:2 archive thumbnail — so it gets its own point.
// When unset it falls back to the main focal point (recent-index.js reads
// `cardFocus || focus`), so you only reach for this on frames where the tall
// card wants a different framing than the thumbnail. Focal-only (no OG card).
export function openArchiveCardFocal() {
  const img = document.querySelector('#archive-preview-wrap img');
  if (!img || !img.getAttribute('src')) return toast('drop a photo first', 'error');
  const a = archiveEditId ? STATE.archive.find(x => x.id === archiveEditId) : null;
  openFocalModal({
    src: img.src,
    // Seed from the card point if set, else the thumbnail point — so the picker
    // opens where the card is actually cropping today.
    focus: archiveComposeCardFocus || archiveComposeFocus,
    aspect: '4 / 5',
    onSave: f => {
      const focus = (f === '50% 50%') ? '' : f;
      _setArchiveComposeCardFocus(focus);
      if (a) {
        if (focus) a.cardFocus = focus; else delete a.cardFocus;
        stageChange('archive', { id: a.id, label: `${a.title || 'archive entry'} — card crop` });
        save(); renderArchive();
        toast('✓ card crop set — publish archive to update the homepage card', 'success');
      } else {
        toast('✓ card crop set — applies on stage', 'success');
      }
    },
  });
}

export function bufferFocal(id) {
  const p = STATE.buffer.find(x => x.id === id);
  if (!p || !p.filename) return;
  const base = p.filename.replace(/\.[^.]+$/, '');
  const num = getBufferFrameNumbers().get(id);
  openFocalModal({
    src: cdnThumb(p),
    focus: p.focus,
    aspect: '3 / 2',
    card: {
      base, folder: 'archive',                              // buffer frames live under /archive/ on the CDN
      label: `FRAME ${String(num || 0).padStart(3, '0')}`,
      dateStr: ymd(p.captured_at || p.published_at) || '—',
      shareUrl: `${location.origin}/archive/buffer/?f=${encodeURIComponent(p.id)}`,
    },
    onSave: f => {
      if (f === '50% 50%') delete p.focus; else p.focus = f;
      stageChange('buffer', { id: p.id, label: `${_frameLabel(p.id)} — focal point` });
      save(); renderBuffer();
      toast('✓ focal point set', 'success');
    },
  });
}

// Feature a raw buffer frame ("daily") on the homepage as a "RAW · f#NNN" card.
// Opt-in per frame — the buffer is raw and large, so nothing shows on the front
// page unless the owner flags it. EXCLUSIVE: the homepage shows exactly one RAW
// card, so starring a frame un-stars the previous one in the same gesture.
// (The old model left every flag set and let the server's newest-captured-first
// sort pick a winner — starring an OLDER frame then visibly did nothing while
// two ★ badges glowed. The server keeps that tolerant sort for legacy data;
// the console write path is where exclusivity lives.) The displaced frame keeps
// its cardFocus — a saved card crop makes it one tap to re-feature — and is
// remembered below so a mis-star is one tap to reverse.
let _lastFeaturedSwap = null;   // { newId, prevId } from the most recent displacing star

// Getter, not a bare export: the console's window bridge snapshots exports at
// boot, so inline handlers (and cards-view code) must read this through a call.
export function getLastFeaturedSwap() { return _lastFeaturedSwap; }

export function toggleBufferFeatured(id) {
  const p = STATE.buffer.find(x => x.id === id);
  if (!p || p.dark) return;
  if (p.featured) {
    delete p.featured;
    // One gesture, one staged change — +1, NOT -1, and never a tally of
    // featured frames. STATE.staged counts UNPUBLISHED CHANGES; a decrement
    // model clamps at 0 and wedges publish (see _audioPromote in audio.js for
    // the incident this rule comes from).
    stageChange('buffer', { id: p.id, label: `${_frameLabel(p.id)} — unfeatured`, kind: 'feature' });
    save(); renderBuffer();
    toast('☆ unfeatured — off the homepage on next publish', 'success');
  } else {
    let prev = null;
    for (const f of STATE.buffer) {
      if (f !== p && f.featured) {
        if (!prev) prev = f;        // at most one exists on the new model; keep the first for the toast
        delete f.featured;          // sweep them all regardless (legacy multi-featured data)
      }
    }
    p.featured = true;
    _lastFeaturedSwap = prev ? { newId: p.id, prevId: prev.id } : null;
    // The whole swap (un-star previous + star new) is ONE gesture → ONE bump —
    // but the ledger row names BOTH ids: the frame that lost the star changed
    // too, and sync must protect it the same way.
    stageChange('buffer', prev
      ? { ids: [p.id, prev.id], label: `RAW card: ${_frameLabel(p.id)} ← ${_frameLabel(prev.id)}`, kind: 'feature' }
      : { id: p.id, label: `${_frameLabel(p.id)} — featured as RAW card`, kind: 'feature' });
    save(); renderBuffer();
    if (prev) {
      const num = getBufferFrameNumbers().get(prev.id);
      toast(`★ featured as RAW card — replaced f#${String(num || 0).padStart(3, '0')}; set the 4:5 card crop (▯), then publish`, 'success');
    } else {
      toast('★ featured as RAW card — set the 4:5 card crop (▯), then publish', 'success');
    }
  }
}

// The 4:5 homepage RAW card is a tall crop, so a featured frame gets its own
// `cardFocus` (parity with archive's ◎ CARD CROP). Falls back to the frame's
// thumbnail focus when unset; recent-index.js reads `cardFocus || focus`.
//
// `after` is an optional callback run once the crop is saved. The modal is
// asynchronous and closes back onto whichever surface opened it, so a caller
// that is NOT the buffer needs a way to repaint itself — the Cards view opens
// this from a tile that previews the very crop being set (js/console/cards.js).
// Optional and additive: every existing call site passes nothing and behaves
// exactly as before.
export function bufferCardFocal(id, after) {
  const p = STATE.buffer.find(x => x.id === id);
  if (!p || !p.filename) return;
  openFocalModal({
    src: cdnThumb(p),
    focus: p.cardFocus || p.focus,
    aspect: '4 / 5',
    onSave: f => {
      if (f === '50% 50%') delete p.cardFocus; else p.cardFocus = f;
      stageChange('buffer', { id: p.id, label: `${_frameLabel(p.id)} — card crop` });
      save(); renderBuffer();
      toast('✓ card crop set — publish to update the homepage card', 'success');
      if (typeof after === 'function') after();
    },
  });
}

// Basenames of frames that already have a live OG card on R2 (meta/<base>-og.webp).
// Loaded once from /api/og-cards so the "already made live" marker persists across
// reloads — most cards are set once and reused many times. The set itself lives
// with its consumer, renderBuffer (js/console/buffer.js) — written through the
// buffer's setters from here.
export async function loadOgCards() {
  try {
    const d = await fetchOgCards();
    if (d && Array.isArray(d.cards)) {
      _setOgCardSet(d.cards);
      renderBuffer();
    }
  } catch { /* non-fatal: badges just won't show until next publish */ }
}

export function wallFocal(id) {
  const w = STATE.wallpapers.find(x => x.id === id);
  if (!w) return;
  // Wall has no ?f= unfurl route, so the card is download-only (no Publish/Copy).
  // Only for items already on the CDN (w.src present = local, not-yet-uploaded).
  const base = (w.filename || '').replace(/\.[^.]+$/, '');
  const card = (!w.src && base) ? {
    base, folder: 'wallpaper',
    label: w.title || SITE_NAME,
    dateStr: '',                 // wall has no date
    shareUrl: null,              // no per-item unfurl
    canPublish: false,           // download-only
  } : null;
  openFocalModal({
    src: w.src || cdnThumb(w, 'wallpaper'),
    focus: w.focus,
    aspect: '16 / 10',
    card,
    onSave: f => {
      if (f === '50% 50%') delete w.focus; else w.focus = f;
      stageChange('wallpapers', { id: w.id, label: `${w.title || w.filename || 'wallpaper'} — focal point` });
      save(); renderWall();
      toast('✓ focal point set', 'success');
    },
  });
}

// Field-note hero. The post page itself shows the full, uncropped hero, but the
// FN index thumbnail (3:2) and the social OG card (1200×630) are both cropped —
// this point steers what survives those crops. Card/Publish mode is offered only
// for a published post whose hero is on the CDN (a data: preview can't be
// composited same-origin, and a draft has no live page to unfurl).
export function openFnFocal() {
  const slot = document.getElementById('fn-hero-slot');
  const filename = slot.dataset.filename;
  const dataImg = slot.dataset.image;
  const base = filename ? filename.replace(/\.[^.]+$/, '') : '';
  const src = dataImg || (base ? `${CDN_BASE}/archive/${encodeURIComponent(base)}-1024w.webp` : '');
  if (!src) return toast('add a hero image first', 'error');

  const existing = STATE.posts.find(p => p.id === fnCurrentId);
  const isPublished = existing && (!existing.status || existing.status === 'published') && existing.fn_id;
  const card = (!dataImg && base && isPublished) ? {
    base, folder: 'archive',                              // FN heroes live under /archive/ on the CDN
    label: existing.title || document.getElementById('fn-title').value || 'FIELD NOTE',
    dateStr: ymd(existing.date) || document.getElementById('fn-date').value || '',
    shareUrl: `${location.origin}/field-notes/post?slug=${encodeURIComponent(existing.fn_id)}`,
  } : null;

  openFocalModal({
    src,
    focus: slot.dataset.focus,
    aspect: '3 / 2',
    card,
    onSave: f => {
      if (f === '50% 50%') delete slot.dataset.focus; else slot.dataset.focus = f;
      const thumb = document.getElementById('fn-hero-thumb');
      if (thumb) thumb.style.objectPosition = slot.dataset.focus || '50% 50%';
      fnMarkDirty();
      toast('✓ focal point set — applies on stage/update', 'success');
    },
  });
}
