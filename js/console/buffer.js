// OAKLENS Field Console — buffer.
//
// The rolling buffer: drop-ingest with EXIF dates and the duplicate guard,
// retire-to-dark-frame (frame numbers are positional and citable — a published
// frame is never deleted, manual §5.20), promote-to-archive, the day-grouped
// renderer, and BURST LINKING — which is part of this module, not a peer: its
// selection state is ephemeral buffer state and every operation ends in
// renderBuffer().
//
// burstLinkMode is exported as a live binding: the composition root reads it
// (view onLeave, long-press enabled, click delegation) but only this module
// ever assigns it. bufferPromote refuses frames flagged _uploading/_uploadError
// — the compose form carries no flags, so promoting one would launder a broken
// reference past the publish guards (see the truthfulness write-up).
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE, save, stageChange, trashItem, _pendingR2Deletes } from '../console-state.js';
import { getToken } from '../console-api.js';
import { showToast, startProgress, updateProgress, endProgress } from '../console-telemetry.js';
import { toast, showView } from './chrome.js';
import { cdnThumb, generateVariants, SITE_LOCATION } from './assets.js';
import { cleanFilename, computeHash, findDuplicateByHash, readEXIFDate, readFileAsDataURL, todayISO, uid, ymd } from './utils.js';
import { _enqueueUpload } from './upload.js';
import { _setArchiveComposeFocus, _setArchiveComposeCardFocus } from './archive.js';

// ---- Burst linking (buffer surface) — ephemeral selection state, never persisted ----
export let burstLinkMode = false;            // is Link mode active on the buffer surface
let burstSelectedIds = new Set();     // ids of frames currently selected for linking
let burstSelectedDay = null;          // day section the current selection is constrained to

// ============== BUFFER ==============
export async function bufferIngest(files) {
  // RAW files can't decode in a browser — route them into the RAW LENS,
  // which extracts the embedded camera JPEG and calls back in here.
  const raws = window.RawLens ? files.filter(f => window.RawLens.isRaw(f.name)) : [];
  if (raws.length) {
    files = files.filter(f => !window.RawLens.isRaw(f.name));
    window.RawLens.intake(raws, 'buffer');
    if (!files.length) return;
  }
  const photos = files.filter(f => f.type.startsWith("image/"));
  if (!photos.length) return toast("no image files dropped", "error");

  const canUpload = !!getToken();
  startProgress('ingest-buffer', 'PROC', photos.length);
  showToast(`processing 0/${photos.length}…`, { id: 'ingest-buffer', sticky: true });

  let _fileNo = 0;
  for (const file of photos) {
    _fileNo++;
    updateProgress('ingest-buffer', _fileNo - 1);
    showToast(`processing ${_fileNo}/${photos.length}…`, { id: 'ingest-buffer', sticky: true });
    const exif = await readEXIFDate(file);
    const rawName = cleanFilename(file.name);
    const baseName = rawName.replace(/\.[^.]+$/, '');
    const entryId = uid();

    // Duplicate guard — hash the original bytes, compare across all surfaces
    let hash = null;
    try { hash = await computeHash(file); } catch { hash = null; }
    const dup = findDuplicateByHash(hash);
    if (dup) {
      toast(`⚠ Duplicate detected: already in ${dup.surface} as ${dup.entry.filename || '—'}`, 'error');
      continue;
    }

    if (canUpload) {
      // Optimistic entry with uploading indicator.
      // NOTE: bumpStage is intentionally deferred to _markEntryUploadDone so the
      // entry is only staged into the publish count once the upload confirms.
      STATE.buffer.unshift({
        id: entryId,
        filename: `${baseName}.webp`,
        captured_at: exif ? exif.toISOString() : todayISO(),
        published_at: todayISO(),
        added_at: todayISO(),
        archived: false,
        hash,
        _uploading: true,
      });
      save();
      renderBuffer();

      try {
        const variants = await generateVariants(file, baseName);
        _enqueueUpload(entryId, 'buffer', variants, `${baseName}.webp`);
      } catch (err) {
        const entry = STATE.buffer.find(e => e.id === entryId);
        if (entry) { delete entry._uploading; entry._uploadError = err.message; }
        renderBuffer();
        toast(`⚠ Resize failed: ${err.message}`, 'error');
      }
    } else {
      // No Upload Key — store as dataURL (local-only fallback). Kept locally, so stage now.
      const dataURL = await readFileAsDataURL(file);
      STATE.buffer.unshift({
        id: entryId,
        image: dataURL,
        filename: rawName,
        captured_at: exif ? exif.toISOString() : todayISO(),
        published_at: todayISO(),
        added_at: todayISO(),
        archived: false,
        hash,
      });
      stageChange('buffer', { id: entryId, label: `${rawName} — new frame (local only)`, kind: 'add' });
      save();
      renderBuffer();
    }
  }

  endProgress('ingest-buffer');
  if (!canUpload) showToast('⚠ Not logged in — photos stored locally only. Log in to upload.', { id: 'ingest-buffer', kind: 'error' });
  else showToast(`✓ ${photos.length} frame${photos.length > 1 ? "s" : ""} ingested — uploading to R2…`, { id: 'ingest-buffer', kind: 'success' });
}

export function bufferRemove(id) {
  trashItem("buffer", id);
}

// Retire a published frame to a DARK FRAME (manual §5.20). Frame numbers are
// positional (assignFrameNumbers sorts by day + filename and numbers 1..N),
// so deleting a published entry would renumber every frame after it — and
// break every citation and share link pointing at those numbers. Retiring
// keeps the entry as a tombstone: dark:true + the numbering sort keys
// (captured_at + filename) survive, every other display field is stripped,
// and the R2 variants are queued for deletion on the next publish. True
// delete (bufferRemove → trash) remains only for never-published frames.
export function bufferRetire(id) {
  const item = STATE.buffer.find(p => p.id === id);
  if (!item || item.dark) return;
  if (!confirm(
    `RETIRE TO DARK FRAME?\n\n${item.filename || item.id}\n\n` +
    `The frame's slot is kept forever (every other frame keeps its number and ` +
    `citations stay valid); the image variants are deleted from R2 on the next ` +
    `publish. There is no un-retire.`
  )) return;

  const tombstone = {
    id: item.id,
    filename: item.filename,
    captured_at: item.captured_at,
    dark: true,
    darked_at: new Date().toISOString(),
  };
  if (item.burst_id) tombstone.burst_id = item.burst_id; // stack counts stay honest
  if (item._imported) tombstone._imported = true;        // still tracked as "on main"
  STATE.buffer[STATE.buffer.indexOf(item)] = tombstone;

  const base = (item.filename || '').replace(/\.[^.]+$/, '');
  if (base) {
    _pendingR2Deletes.push({
      keys: [
        `archive/${base}-480w.webp`,
        `archive/${base}-1024w.webp`,
        `archive/${base}-2048w.webp`,
      ],
      surface: 'buffer',
      entryId: item.id,
    });
  }
  stageChange('buffer', { id: item.id, label: `${item.filename || 'frame'} — retired to dark frame`, kind: 'remove' });
  save();
  renderBuffer();
  toast('◼ retired to dark frame — slot kept, media queued for delete', 'success');
}

export function bufferPromote(id) {
  const item = STATE.buffer.find(p => p.id === id);
  if (!item) return;
  // A frame whose asset never reached the CDN must not launder itself into a
  // clean archive entry through the compose form (the form carries no flags).
  if (item._uploading) return toast('▲ still uploading — promote once it finishes', 'error');
  if (item._uploadError) return toast('✕ upload failed — re-drop this frame before promoting', 'error');
  item.archived = true;
  // Pre-populate archive form with this photo
  showView("archive");
  setTimeout(() => {
    const imgSrc = item.image || cdnThumb(item);
    document.getElementById("archive-preview-wrap").innerHTML =
      `<img src="${imgSrc}" alt="">`;
    document.getElementById("archive-filename").textContent = cleanFilename(item.filename);
    _setArchiveComposeFocus(item.focus || '');
    _setArchiveComposeCardFocus(item.cardFocus || '');
    const year = new Date(item.captured_at).getFullYear();
    document.getElementById("arch-loc").value =
      SITE_LOCATION ? `${SITE_LOCATION}, ${year}` : `${year}`;
    // Stash on form for the stage handler
    document.getElementById("view-archive").dataset.fromBuffer = item.id;
    document.getElementById("view-archive").dataset.image = item.image || '';
    document.getElementById("view-archive").dataset.filename = cleanFilename(item.filename);
    delete document.getElementById("view-archive").dataset.uploadState;   // frame's asset is already confirmed
    document.getElementById("arch-title").focus();
  }, 80);
  toast("✓ promoted to archive — fill in metadata", "success");
}

// Which cards already have a live share stamp on R2 — the MARKER, which is the
// R2 key with `meta/` and `-og.webp` taken off it. renderBuffer draws the ▣
// badge from this. Owned here because the renderer is the consumer; the
// producers sit ABOVE this module (loadOgCards fetches the index, the focal
// modal and the share block add one) and write through the setters, because an
// imported binding cannot be assigned.
// The extraction guard caught this one as a ReferenceError in the suite — the
// same dangling-const class as CDN_BASE, stopped by the test this time.
//
// ⚠️ NOT ONLY FRAMES SINCE CHUNK 8. A frame's marker is its image basename, but
// /api/og-cards lists every stem under `meta/` — so the set also holds
// `fn-<slug>`, `audio-<slug>`, `set-<slug>` and `card-<id>`. The buffer looks up
// bare basenames and simply never asks about those, which is why one set can
// serve both readers.
let OG_CARD_SET = new Set();
export function _setOgCardSet(bases) { OG_CARD_SET = new Set(bases); }
export function _addOgCard(base) { OG_CARD_SET.add(base); }
// The reader, for js/console/share.js — the share block says "stamped" or "not
// stamped yet" off the same set the buffer's badge reads, so the two can never
// disagree about what is on R2.
export function _hasOgCard(base) { return OG_CARD_SET.has(base); }

export function renderBuffer() {
  const display = document.getElementById("buffer-display");
  const count = document.getElementById("buffer-count");
  const stats = document.getElementById("buffer-stats");
  const darkCount = STATE.buffer.filter(p => p.dark).length;
  count.textContent = darkCount
    ? `${STATE.buffer.length} · ${darkCount} DARK`
    : STATE.buffer.length;

  if (!STATE.buffer.length) {
    display.innerHTML = `<div class="empty">// BUFFER EMPTY · DROP PHOTOS ABOVE</div>`;
    stats.textContent = "0 frames · 0 days";
    return;
  }

  // Sort by captured_at ascending (matches live site renderer)
  const sorted = [...STATE.buffer].sort((a, b) => {
    const da = a.captured_at || a.published_at || '';
    const db = b.captured_at || b.published_at || '';
    return da.localeCompare(db);
  });

  // Group by capture date (sorted order preserves within-day sequence)
  const byDay = {};
  sorted.forEach(p => {
    const day = ymd(p.captured_at || p.published_at);
    (byDay[day] = byDay[day] || []).push(p);
  });
  // Sort within each day by filename (camera sequence order)
  Object.values(byDay).forEach(arr => arr.sort((a, b) => (a.filename || '').localeCompare(b.filename || '')));

  const days = Object.keys(byDay).sort().reverse();
  stats.textContent = `${STATE.buffer.length} frames · ${days.length} days`
    + (darkCount ? ` · ${darkCount} dark` : '');

  display.innerHTML = days.map(day => {
    const items = byDay[day];
    // Map burst_id -> ordered list of frame ids within this day, for "BURST n/N" badges.
    // burst_ids are unique within a day, so grouping within the day is sufficient.
    const burstGroups = {};
    items.forEach(p => { if (p.burst_id) (burstGroups[p.burst_id] = burstGroups[p.burst_id] || []).push(p.id); });
    return `
      <div class="buffer-day">
        <div class="buffer-day-hdr">
          <span class="mark">//</span>
          <span class="date">${day.replace(/-/g, "·")}</span>
          <span class="dots"></span>
          <span class="count">${items.length} frame${items.length > 1 ? "s" : ""}</span>
        </div>
        <div class="buffer-grid" data-day="${day}">
          ${items.map(p => {
            const t = new Date(p.captured_at);
            const time = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
            // Dark frames (retired tombstones, manual §5.20): no image, no
            // actions — the slot is permanent. Small DARK badge only.
            if (p.dark) {
              return `
            <div class="buffer-frame buffer-frame-dark${p._imported ? " imported" : ""}" data-id="${p.id}">
              <div class="dark-cell"><span aria-hidden="true">//</span></div>
              <div class="dark-badge" title="Dark frame — retired ${p.darked_at ? p.darked_at.slice(0, 10) : ''}">DARK</div>
              <div class="frame-meta"><span>${time}</span><span>RETIRED</span></div>
            </div>`;
            }
            let inner;
            if (p._uploading) {
              inner = `<div class="upload-progress-wrap">
                <div class="upload-bar"><div class="upload-bar-fill" style="width:60%"></div></div>
                <div class="upload-label">▲ UPLOADING…</div>
              </div>`;
            } else if (p._uploadError) {
              inner = `<div class="upload-progress-wrap">
                <div class="upload-label" style="color:var(--accent);">✕ UPLOAD FAILED</div>
                <div style="font-size:0.48rem;color:var(--text-faint);letter-spacing:1px;margin-top:4px;padding:0 8px;text-align:center;">${p._uploadError.slice(0, 50)}</div>
              </div>`;
            } else {
              inner = `<img src="${cdnThumb(p)}" alt=""${p.focus ? ` style="object-position:${p.focus}"` : ''}>`;
            }
            let burstClass = "", burstBadge = "";
            if (p.burst_id && burstGroups[p.burst_id]) {
              const grp = burstGroups[p.burst_id];
              burstClass = " burst-linked";
              burstBadge = `<div class="burst-badge">BURST ${grp.indexOf(p.id) + 1}/${grp.length}</div>`;
            }
            const burstSel = burstSelectedIds.has(p.id) ? " burst-selected" : "";
            return `
            <div class="buffer-frame${p.archived ? " selected" : ""}${p._imported ? " imported" : ""}${burstClass}${burstSel}"
                 data-id="${p.id}">
              ${inner}
              ${burstBadge}
              ${OG_CARD_SET.has((p.filename || '').replace(/\.[^.]+$/, '')) ? '<div class="ogc-badge" title="Live OG card on R2">▣</div>' : ''}
              ${p.featured ? '<div class="raw-badge" title="Featured as a RAW card on the homepage">★</div>' : ''}
              <div class="frame-actions">
                ${p._importing || p._uploading ? '' : `<button class="frame-action${p.featured ? ' featured' : ''}" title="${p.featured ? 'Featured on homepage — click to unfeature' : 'Feature as RAW card on the homepage'}"
                  onclick="event.stopPropagation(); toggleBufferFeatured('${p.id}')">${p.featured ? '★' : '☆'}</button>`
                + (p.featured ? `<button class="frame-action" title="Card crop — 4:5 homepage RAW card"
                  onclick="event.stopPropagation(); bufferCardFocal('${p.id}')">▯</button>` : '')
                + `<button class="frame-action" title="Focal point"
                  onclick="event.stopPropagation(); bufferFocal('${p.id}')">◎</button>` + (p._imported ? `<button class="frame-action" title="RETIRE TO DARK FRAME — slot + number kept forever, media deleted"
                  onclick="event.stopPropagation(); bufferRetire('${p.id}')">◼</button>` : `<button class="frame-action promote" title="Promote to Archive"
                  onclick="event.stopPropagation(); bufferPromote('${p.id}')">▲</button>
                <button class="frame-action" title="Remove (never published — true delete)"
                  onclick="event.stopPropagation(); bufferRemove('${p.id}')">×</button>`)}
              </div>
              <div class="frame-meta"><span>${time}</span><span>${p.archived ? "ARCHIVED" : p._uploaded ? "✓ CDN" : ""}</span></div>
            </div>`;
          }).join("")}
        </div>
      </div>`;
  }).join("");
}

export function loadSampleBuffer() {
  const samples = [
    { color: "#3a4a3a", time: "09:14", day: -0 },
    { color: "#5a3a3a", time: "11:42", day: -0 },
    { color: "#3a3a5a", time: "14:33", day: -0 },
    { color: "#4a4a4a", time: "18:55", day: -0 },
    { color: "#2a3a4a", time: "22:11", day: -2 },
    { color: "#3a2a2a", time: "07:22", day: -4 },
    { color: "#5a4a3a", time: "09:01", day: -4 },
    { color: "#4a3a2a", time: "16:02", day: -4 },
  ];
  samples.forEach(s => {
    const d = new Date();
    d.setDate(d.getDate() + s.day);
    const [h, m] = s.time.split(":");
    d.setHours(parseInt(h), parseInt(m), 0);
    // Generate a plain colored canvas as the placeholder image
    const c = document.createElement("canvas");
    c.width = 600; c.height = 400;
    const ctx = c.getContext("2d");
    ctx.fillStyle = s.color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.font = "20px monospace";
    ctx.fillText(`SAMPLE · ${s.time}`, 20, 380);
    STATE.buffer.unshift({
      id: uid(), image: c.toDataURL("image/jpeg", 0.9),
      filename: `sample-${s.time.replace(":","")}.jpg`,
      captured_at: d.toISOString(), published_at: d.toISOString(), archived: false,
    });
    stageChange("buffer", { id: STATE.buffer[0].id, label: `${STATE.buffer[0].filename} — sample frame`, kind: 'add' });
  });
  save();
  renderBuffer();
  toast("✓ sample data loaded", "success");
}

// ============== BURST LINKING ==============
// Group buffer frames into a burst sequence by writing a shared burst_id to their
// entries. Selection is ephemeral; only the committed burst_id persists (via the
// standard publish flow). All changes are marked PENDING and never auto-published.

export function toggleBurstLinkMode() {
  if (burstLinkMode) exitBurstLinkMode();
  else enterBurstLinkMode();
}

// Both the toolbar button and the floating FAB reflect Link-mode state, so the
// active accent shows wherever the operator's eyes are.
function _setBurstBtnActive(on) {
  ["burst-link-btn", "buffer-link-fab"].forEach(id =>
    document.getElementById(id)?.classList.toggle("burst-active", on));
}

export function enterBurstLinkMode() {
  burstLinkMode = true;
  document.body.classList.add("buffer-link-mode");
  _setBurstBtnActive(true);
  updateBurstActionBar();
}

export function exitBurstLinkMode() {
  burstLinkMode = false;
  burstSelectedIds.clear();
  burstSelectedDay = null;
  document.body.classList.remove("buffer-link-mode");
  _setBurstBtnActive(false);
  updateBurstActionBar();
  renderBuffer();
}

export function burstCancel() {
  exitBurstLinkMode();
}

// Toggle a frame's membership in the current selection. Selection is constrained to a
// single day section — touching a frame in a different day clears the prior selection.
export function burstToggleFrame(id, day) {
  const entry = STATE.buffer.find(b => b.id === id);
  if (!entry || entry._uploading || entry._uploadError || entry._importing) return;

  if (burstSelectedDay && burstSelectedDay !== day) {
    burstSelectedIds.clear();
    burstSelectedDay = null;
  }

  if (burstSelectedIds.has(id)) {
    burstSelectedIds.delete(id);
  } else {
    burstSelectedIds.add(id);
    burstSelectedDay = day;
  }
  if (!burstSelectedIds.size) burstSelectedDay = null;

  renderBuffer();
  updateBurstActionBar();
}

// Show/hide the floating action bar and pick LINK vs UNLINK based on the selection.
export function updateBurstActionBar() {
  const bar = document.getElementById("burst-actionbar");
  const label = document.getElementById("burst-bar-label");
  const actionBtn = document.getElementById("burst-link-action");
  if (!bar) return;

  const n = burstSelectedIds.size;
  if (!burstLinkMode || n < 2) { bar.classList.remove("visible"); return; }

  // UNLINK only when every selected frame already shares the same burst_id. Any mix of
  // linked + unlinked (or differing burst_ids) shows LINK BURST — linking takes priority.
  const sel = STATE.buffer.filter(b => burstSelectedIds.has(b.id));
  const ids = sel.map(b => b.burst_id).filter(Boolean);
  const allSameBurst = ids.length === sel.length && new Set(ids).size === 1;

  bar.classList.add("visible");
  if (allSameBurst) {
    label.innerHTML = `UNLINK BURST // <span class="accent">${n} FRAMES</span>`;
    actionBtn.textContent = "UNLINK";
    actionBtn.onclick = commitBurstUnlink;
  } else {
    label.innerHTML = `LINK BURST // <span class="accent">${n} FRAMES</span>`;
    actionBtn.textContent = "LINK BURST";
    actionBtn.onclick = commitBurstLink;
  }
}

// Generate the next sequential, collision-free burst_id for a day section.
export function generateBurstId(day) {
  const prefix = `burst-${day}-`;
  const used = new Set();
  STATE.buffer.forEach(b => {
    if (b.burst_id && b.burst_id.startsWith(prefix)) {
      const num = parseInt(b.burst_id.slice(prefix.length), 10);
      if (!isNaN(num)) used.add(num);
    }
  });
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${String(n).padStart(3, "0")}`;
}

export function commitBurstLink() {
  if (burstSelectedIds.size < 2 || !burstSelectedDay) return;
  const burstId = generateBurstId(burstSelectedDay);
  let count = 0;
  STATE.buffer.forEach(b => {
    if (burstSelectedIds.has(b.id)) { b.burst_id = burstId; count++; }
  });
  // marks PENDING + persists to localStorage; every linked frame changed
  if (count) {
    stageChange("buffer", {
      ids: [...burstSelectedIds],
      label: `burst linked: ${count} frames → ${burstId}`,
    });
  }
  toast(`✓ linked burst: ${count} frames → ${burstId}`, "success");
  exitBurstLinkMode();
}

export function commitBurstUnlink() {
  if (!burstSelectedIds.size) return;
  let count = 0;
  const unlinkedIds = [];
  STATE.buffer.forEach(b => {
    if (burstSelectedIds.has(b.id) && b.burst_id) { delete b.burst_id; count++; unlinkedIds.push(b.id); }
  });
  if (count) {
    stageChange("buffer", {
      ids: unlinkedIds,
      label: `burst unlinked: ${count} frame${count !== 1 ? 's' : ''}`,
    });
  }
  toast(`✓ unlinked ${count} frame${count !== 1 ? "s" : ""}`, "success");
  exitBurstLinkMode();
}
