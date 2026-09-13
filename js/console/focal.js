// OAKLENS Field Console — focal.
//
// The unified framing modal (FocalModal): a per-image focal point that every
// cover crop reads as object-position, plus — given a card context — the share
// image PAINTED from the SAME point. The per-surface entry points (archive,
// archive-card, buffer, buffer-card, wall, FN hero) and the OG-card index load
// live here with it.
//
// Since chunk 7 this file no longer knows what a share image looks like: it
// hands a card item to js/console/card-paint.js and owns only the point. What
// it lost was 90 lines of rail geometry and two hardcoded reds.
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
import { CDN_BASE, cdnThumb, SITE_NAME, SITE_FILE_PREFIX } from './assets.js';
import { paintCard, probeCardTokens, ensureShareFonts, loadCardImage, compositionOf,
  shareStem, shareKey, CARD_WELL } from './card-paint.js';
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
// context) paints the share image from the SAME point — one setting, two
// outputs. The stage shows the full frame with the focal dot plus two crop
// safety-guides (solid red = what the share image keeps, dashed = the thumbnail
// crop) so you can see what each output keeps as you drag; the side shows the
// live card. Publish saves it to R2 AND persists the focal point (thumbnails
// benefit too). The canvas is fed from the same-origin /api/cdn/ proxy so it
// isn't CORS-tainted.
//
// ⚠️ THE SHARE IMAGE IS NOW THE CARD (chunk 7, docs/cards-core-complete.md).
// This modal no longer knows what a share image looks like: it hands the card's
// own item to paintCard() and gets back the canvas. What it still owns is the
// POINT — and the red guide is 4:5, the card's picture well, rather than the
// old 2.353 photo zone of a rail that no longer exists. A guide that showed a
// crop nothing produces would be worse than no guide at all.
export const FocalModal = (() => {
  const $ = id => document.getElementById(id);
  const clamp = n => Math.max(0, Math.min(100, n));
  // What the share image keeps: the card's picture well, which is 4:5 — the
  // homepage's own crop. The ratio geometry itself lives in card-paint.js.
  const OG_ASPECT = 1 / CARD_WELL;

  let onSaveCb = null, wired = false;
  let focus = { x: 50, y: 50 };
  let thumbAspect = 1.5;     // numeric thumbnail crop aspect (from opts.aspect)
  let card = null;           // { item, stem, shareUrl, canPublish, marker } or null
  let painting = null;          // the in-flight paint, or null
  let repaintQueued = false;
  let cardReady = Promise.resolve();   // the picture this card is waiting on
  let cardImg = null;        // same-origin source for the canvas
  let cardTokens = null;     // the card's own palette, probed once per open (see drawCard)

  // One parser for the one string format — _focusPct, at the foot of this file,
  // where the luminance sampler needs the same answer (declarations hoist).
  function parseFocus(str) { return _focusPct(str); }
  function focusStr() { return `${Math.round(focus.x)}% ${Math.round(focus.y)}%`; }
  function aspectNum(s) { const m = /([\d.]+)\s*[/:]\s*([\d.]+)/.exec(s || ''); return m ? (+m[1]) / (+m[2]) : 1.5; }
  function setStatus(msg, cls) { const s = $('ogc-status'); if (s) { s.textContent = msg || ''; s.className = 'ogc-status ' + (cls || ''); } }

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

  // ---- the share image ----
  //
  // Nothing here knows what a share image looks like any more. The painter
  // takes the card's own item — the same object the homepage row is built from
  // — and draws the card. What this modal contributes is the POINT: `focus` is
  // being dragged right now and is not on the record yet, which is the one
  // reason paintCard() accepts a crop override at all.
  //
  // Re-entrant on purpose. A drag fires dozens of repaints and each one is
  // async; without the gate they interleave and the canvas ends up showing a
  // crop from halfway through the gesture. One in flight, one queued, the rest
  // collapsed — and it RETURNS the in-flight paint, so a caller that needs the
  // finished canvas can wait for it (see settled()).
  function drawCard() {
    const cv = $('ogc-canvas');
    if (!cv || !card) return Promise.resolve();
    if (painting) { repaintQueued = true; return painting; }
    painting = paintCard(card.item, 'og', {
      canvas: cv,
      image: cardImg,
      focus: focusStr(),
      // THE CARD'S tokens, not the page's: a palette card tints its edge and
      // wears its own hue, and only the mounted card knows them. Probed once
      // per open — a drag fires dozens of repaints, and a mount per frame
      // would be paid for nothing, since nothing the drag changes is a colour.
      tokens: cardTokens || (cardTokens = probeCardTokens(card.item)),
    })
      .catch((err) => { setStatus(err.message || 'could not paint the card', 'err'); })
      .then(() => {
        painting = null;
        if (repaintQueued) { repaintQueued = false; return drawCard(); }
        return undefined;
      });
    return painting;
  }

  // ⚠️ THE CANVAS IS THE ARTEFACT, so nothing may read it until it holds the
  // finished card. The picture is fetched and decoded in the background while
  // the modal is already open and already painted — so a press of ▲ Publish or
  // ⤓ Download a beat too early used to hand toBlob() a card with an EMPTY
  // WELL, and publish writes that to R2 under a key a link already points at.
  // Found by a code review; no test could see it, because the race needs a
  // network. Both actions wait here: first for the picture, then for a paint
  // that includes it.
  async function settled() {
    try { await cardReady; } catch { /* a picture that will not load still paints */ }
    await drawCard();
    // AND DRAIN ANYTHING THAT QUEUED WHILE WE WAITED.
    //
    // Normally a no-op: drawCard()'s .then() RETURNS drawCard() when a repaint
    // is queued, and a promise that resolves to another promise adopts it, so
    // the await above already waits for the whole chain. A code review doubted
    // that, and the doubt is the point — the canvas is the artefact, and an
    // invariant that decides what gets written to a permanent R2 key should not
    // rest on the reader spotting one `return` keyword.
    //
    // Bounded on purpose: a drag that never stops must not hang ▲ Publish.
    for (let i = 0; painting && i < 5; i += 1) await painting;
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
    cardTokens = null;
    $('focal-cardwrap').style.display = card ? '' : 'none';
    $('focal-thumbwrap').style.display = card ? 'none' : '';
    $('focal-card-actions').style.display = card ? '' : 'none';
    $('focal-modal-title').textContent = card ? '▣ FRAME // SHARE IMAGE' : '◎ FOCAL POINT';
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
      // The faces first, then the picture — a canvas that draws before its
      // fonts have decoded silently falls back to a system face. The picture
      // is loaded ONCE here (through the same-origin proxy, so the canvas is
      // never tainted) and handed to every repaint of the drag; a card whose
      // picture will not load still paints, with its well left as ground.
      const opened = card;
      // Composed ONCE. It was called twice — once to load, once to decide
      // whether a failure was worth reporting — and the second call had no
      // guard: compositionOf() answers null when the card engine has not
      // loaded, so `.media` on it threw a TypeError inside a promise chain with
      // no .catch, i.e. an unhandled rejection rather than a message. Found by
      // a code review.
      const comp = compositionOf(opened.item);
      cardReady = ensureShareFonts()
        .then(() => loadCardImage(comp))
        .then((im) => {
          if (card !== opened) return;           // the modal moved on while we waited
          cardImg = im;
          if (!im && comp && comp.media) setStatus('source image failed', 'err');
          paint();
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
  function close() {
    hideOverlay('focal-modal');
    onSaveCb = null; card = null; cardImg = null; cardTokens = null;
    cardReady = Promise.resolve();
  }
  function toBlob() {
    return new Promise((res, rej) => $('ogc-canvas').toBlob(b => (b && b.size) ? res(b) : rej(new Error('canvas export failed')), 'image/webp', 0.9));
  }
  // The downloaded file is named for the site and the stem, so a folder of them
  // sorts by what they are. SITE_FILE_PREFIX rather than a literal: the old name
  // was hardcoded to this instance and every fork downloaded files with someone
  // else's name on them.
  async function download() {
    if (!card) return;
    try {
      await settled();
      const b = await toBlob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${SITE_FILE_PREFIX || 'share'}-${(card.stem || 'card').replace(/^meta\//, '')}-og.webp`;
      a.click();
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
    if (!card || !card.stem) return;
    if (!getToken()) return toast('log in to publish', 'error');
    try {
      setStatus('publishing…');
      await settled();
      const blob = await toBlob();
      // ONE SPELLING OF THE KEY. shareStem/shareKey built it when the modal
      // opened; a second literal here is how the edge and the console start
      // looking for different files (chunk 6's last "watch for").
      const file = new File([blob], shareKey(card.stem, 'og'), { type: 'image/webp' });
      await uploadFiles([file]);
      if (card.marker) _addOgCard(card.marker);   // buffer owns the set — see js/console/buffer.js
      if (onSaveCb) onSaveCb(focusStr());   // persist the focal point too — thumbnails use it
      setStatus('✓ published to R2', 'ok');
      toast('✓ share image published — the link now unfurls with it', 'success');
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
//
// EACH ONE HANDS THE MODAL A CARD ITEM, not a description of a share image.
// `item` is exactly what RecentIndex.buildCard takes; `stem` is the R2 address
// the stamp lives at. Before chunk 7 each of these restated a label, a date
// string and a folder for a rail that no longer exists — four places that had
// to agree with a painter none of them could see.
function frameCard(item, filename, shareUrl, extra) {
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  if (!base) return null;
  return {
    item,
    stem: shareStem({ kind: 'frame', id: base }),
    // A frame's stamp is the one the buffer marks as "already made live", and
    // that set is keyed by basename — so the marker is passed rather than
    // derived from the stem, which is a path.
    marker: base,
    shareUrl: shareUrl || null,
    ...(extra || {}),
  };
}

export function openArchiveFocal() {
  const img = document.querySelector('#archive-preview-wrap img');
  if (!img || !img.getAttribute('src')) return toast('drop a photo first', 'error');
  // Card mode only for an EXISTING archive entry (its image is on the CDN and it
  // has a ?f= page that unfurls). A brand-new compose stays focal-only.
  let card = null;
  const a = archiveEditId ? STATE.archive.find(x => x.id === archiveEditId) : null;
  if (a && a.filename) {
    card = frameCard({ kind: 'photo', data: a }, a.filename,
      `${location.origin}/archive/?f=${encodeURIComponent(a.slug || a.id)}`);
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
  const num = getBufferFrameNumbers().get(id);
  openFocalModal({
    src: cdnThumb(p),
    focus: p.focus,
    aspect: '3 / 2',
    // The RAW card the homepage would draw for this frame — same builder, so
    // the share image carries the citable f#NNN the card carries.
    card: frameCard({ kind: 'photo', data: { ...p, num }, raw: true }, p.filename,
      `${location.origin}/archive/buffer/?f=${encodeURIComponent(p.id)}`),
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
  // A wallpaper is not a content kind the homepage draws, so it borrows the
  // picture card the way a composed record does: the overrides name its file,
  // its folder and its chip, and the photo renderer does the rest. One renderer
  // per kind, even for a surface that has no card of its own.
  const card = (!w.src && w.filename) ? frameCard(
    { kind: 'photo', data: w, over: { media: w.filename, folder: 'wallpaper', label: w.title || SITE_NAME, title: w.title || '' } },
    w.filename,
    null,
    { canPublish: false },       // no per-item unfurl, so download-only
  ) : null;
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
  // THE NOTE'S OWN CARD, hero-forward — the layout the homepage gives a note
  // that leads with its picture. Before chunk 7 this was a photograph with the
  // note's title on a rail beside it, which was not a shape the site had
  // anywhere. The hero's basename still keys the stamp (`meta/<base>-og.webp`),
  // so a note already stamped keeps serving until it is re-stamped.
  const card = (!dataImg && base && isPublished) ? frameCard(
    {
      kind: 'text',
      data: {
        ...existing,
        hero: filename,
        title: existing.title || document.getElementById('fn-title').value || '',
        card: { layout: 'hero' },
      },
    },
    filename,
    `${location.origin}/field-notes/post?slug=${encodeURIComponent(existing.fn_id)}`,
  ) : null;

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

// ============== BAND LUMINANCE — the image ladder's one measurement ==============
//
// The overlay layout writes on a picture, and whether the words can be READ
// depends on how bright the picture is where they sit. The engine is forbidden
// from finding that out at render time — js/recent-index.js ships verbatim into
// Site-in-a-ZIP and renders from `file://` with no network, and a card that
// measured itself after paint would shift — so the answer is measured ONCE here,
// in the console, at pick or crop time, and stored on the record (`img.lum`).
// buildCard then turns it into one attribute (`data-ink`) and the stylesheet
// does the rest. See docs/cards-core-complete.md chunk 3.
//
// It lives beside the card canvas because it is the same piece of arithmetic the
// OG card already does — a cover-crop of a same-origin image, drawn small — and
// splitting it off would be a second place for the crop maths to drift.

// The card's picture well, and the sample grid drawn into it. 48 × 60 is plenty:
// the three band averages are what matters and the downscale is itself an
// average, so a bigger canvas would cost time to compute the same three numbers.
const LUM_AR = 4 / 5;
const LUM_W = 48, LUM_H = 60;

// The focal point as numbers. Module-level because the sampler needs the same
// parse the modal does, and two readers for one string format is one too many.
export function _focusPct(str) {
  const m = /(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(str || '');
  const c = n => Math.max(0, Math.min(100, n));
  return m ? { x: c(+m[1]), y: c(+m[2]) } : { x: 50, y: 50 };
}

// ---- the pure half: three band averages over an ImageData ----
//
// Relative luminance per WCAG — the sRGB channels are LINEARISED before they are
// weighted, which is the whole point: a mid-grey pixel is 0.21, not 0.5, and a
// naive average of gamma-encoded bytes reads a dark photograph as far brighter
// than the eye does. That error lands exactly where it hurts, on the pictures
// where the ink decision is close.
//
// Returns { top, mid, bottom } in 0–1, rounded to two places so the published
// record stays small and a re-measure of the same crop produces the same bytes.
// An unusable input returns null rather than three zeroes: "too dark to read" and
// "never measured" are different states and overlayInk treats them differently.
//
// Pure, and exported, because a measurement nobody can test is a guess.
export function bandLuminance(img) {
  if (!img || !img.data || !img.width || !img.height) return null;
  const { data, width, height } = img;
  if (data.length < width * height * 4) return null;
  // Fewer than three rows cannot BE three bands — one of them would be empty and
  // average to zero, which claims a black stripe rather than admitting there was
  // nothing to read. The sampler's own canvas is 60 rows; this is the boundary
  // for anything else that calls in.
  if (height < 3) return null;
  const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  // Row boundaries of the three bands. Integer rows, so the middle band absorbs
  // a height that does not divide by three and no row is counted twice.
  const cut = [0, Math.round(height / 3), Math.round((height * 2) / 3), height];
  const out = [];
  for (let b = 0; b < 3; b++) {
    let sum = 0, n = 0;
    for (let y = cut[b]; y < cut[b + 1]; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // Alpha is ignored on purpose: the canvas is opaque (it is filled before
        // the draw), so a transparent pixel here means the source did not cover
        // the crop, and counting the fill is the honest answer.
        sum += 0.2126 * lin(data[i] / 255)
          + 0.7152 * lin(data[i + 1] / 255)
          + 0.0722 * lin(data[i + 2] / 255);
        n += 1;
      }
    }
    out.push(n ? Math.round((sum / n) * 100) / 100 : 0);
  }
  return { top: out[0], mid: out[1], bottom: out[2] };
}

// The source rect a cover-crop of aspect `ar` keeps at a focal point — the same
// rule the painter applies to a card's picture well, at the card's own 4:5 and
// with the card's own focus. Exported for the test suite, which also pins it
// against card-paint.js's copy so the two can never crop differently.
export function _coverRect(sw, sh, ar, fx, fy) {
  let cw = sw, ch = sw / ar;
  if (ch > sh) { ch = sh; cw = sh * ar; }
  return { sx: (sw - cw) * (fx / 100), sy: (sh - ch) * (fy / 100), cw, ch };
}

// ---- the impure half: load the picture, draw the crop, hand it to the sampler ----
//
// `src` must be same-origin (the /api/cdn proxy — cdnVariant builds it) or the
// canvas is tainted and getImageData throws. NEVER REJECTS: a measurement that
// fails resolves to null and the card simply stays unmeasured, which overlayInk
// already reads as "use light ink over the default scrim". A picture the owner
// cannot measure must not be a picture they cannot use.
export function measureCardBands(src, focus) {
  return new Promise((resolve) => {
    if (!src || typeof Image === 'undefined') return resolve(null);
    const p = _focusPct(focus);
    const im = new Image();
    im.onerror = () => resolve(null);
    im.onload = () => {
      try {
        const sw = im.naturalWidth, sh = im.naturalHeight;
        if (!sw || !sh) return resolve(null);
        const cv = document.createElement('canvas');
        cv.width = LUM_W; cv.height = LUM_H;
        const ctx = cv.getContext('2d');
        // Opaque ground first, so a source that cannot fill the crop reads as
        // mid-dark rather than as transparent nothing (see bandLuminance).
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, LUM_W, LUM_H);
        const r = _coverRect(sw, sh, LUM_AR, p.x, p.y);
        ctx.drawImage(im, r.sx, r.sy, r.cw, r.ch, 0, 0, LUM_W, LUM_H);
        resolve(bandLuminance(ctx.getImageData(0, 0, LUM_W, LUM_H)));
      } catch (_) {
        resolve(null);
      }
    };
    im.src = src;
  });
}
