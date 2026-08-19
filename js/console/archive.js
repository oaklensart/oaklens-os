// OAKLENS Field Console — archive.
//
// The curated-frames surface: the compose form (drop → variants → R2 upload,
// with dataset.uploadState arming the publish guards — see the truthfulness
// write-up for the incident that forced that), stage/update, edit, clear,
// remove (with auto-barrel cleanup), and the card renderer.
//
// Owns the gear memory too (camera / lens / medium): those three fields are
// free text — see the block comment above GEAR_KEY for why they stopped being
// <select>s — and the memory is what keeps free text from meaning "retype your
// camera every frame".
//
// Owns the compose form's focal state (archiveComposeFocus/-CardFocus,
// exported live bindings + setters): the focal entry points, the
// asset-library prefill, and bufferPromote all sit above this module and
// write through _setArchiveComposeFocus/-CardFocus, because an imported
// binding cannot be assigned. archiveEditId is exported for the focal entry
// points, which read it to decide compose-vs-edit behaviour.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE, save, bumpStage, trashItem, _pendingR2Deletes } from '../console-state.js';
import { getToken, uploadFilesWithRetry } from '../console-api.js';
import { toast, escapeHTML } from './chrome.js';
import { cdnThumb, generateVariants, _resizeToWebP } from './assets.js';
import { cleanFilename, slugify, todayISO, uid, ymd, readFileAsDataURL, findDuplicateByHash } from './utils.js';
import { upsertAutoBarrel, barrelDateFromYMD } from './more-views.js';

// ============== GEAR MEMORY ==============
// Camera / lens / medium were two hardcoded <option> lists — one photographer's
// two bodies — which made the form wrong for every fork and wrong for this
// instance the day it borrowed a camera. They are free text now, and this is
// the affordance the <select> used to give away: the values you have used
// before, offered back.
//
// Device-local on purpose. A fork gets this working with zero setup — no D1
// table, no migration, no publish round-trip — and the list is per-device,
// which is the honest scope for "the gear I shoot with on this iPad". If it
// ever needs to follow an owner across devices it graduates to D1 (the storage
// rule in CLAUDE.md), not to a JSON blob in the repo.
const GEAR_KEY = 'oaklens_gear_memory';
const GEAR_LIMIT = 12;       // MRU depth per field — a suggestion list, not an archive
const GEAR_MAX_LEN = 80;     // a gear name, not a caption
const GEAR_FIELDS = [
  { key: 'camera', input: 'arch-cam',  list: 'arch-cam-memory'  },
  { key: 'lens',   input: 'arch-lens', list: 'arch-lens-memory' },
  { key: 'medium', input: 'arch-med',  list: 'arch-med-memory'  },
];

function _readGearMemory() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(GEAR_KEY) || '{}') || {}; } catch { raw = {}; }
  // Absent key ⇒ remembering is ON. A fresh console should behave like the old
  // sticky <select> did, not make the owner find a switch first.
  const mem = { remember: raw.remember !== false };
  for (const f of GEAR_FIELDS) {
    mem[f.key] = (Array.isArray(raw[f.key]) ? raw[f.key] : [])
      .filter(v => typeof v === 'string' && v.trim())
      .map(v => v.trim().slice(0, GEAR_MAX_LEN))
      .slice(0, GEAR_LIMIT);
  }
  return mem;
}

function _writeGearMemory(mem) {
  try { localStorage.setItem(GEAR_KEY, JSON.stringify(mem)); } catch {}
}

/** The saved gear for one field, most-recently-used first. */
export function gearMemory(key) {
  return key ? _readGearMemory()[key] || [] : _readGearMemory();
}

/** Is the remember toggle on? Reads the checkbox when it exists, else storage. */
export function gearRememberOn() {
  const box = document.getElementById('arch-gear-remember');
  return box ? box.checked : _readGearMemory().remember;
}

/** Persist the toggle — called from its own change handler (init wires it). */
export function setGearRemember(on) {
  const mem = _readGearMemory();
  mem.remember = !!on;
  _writeGearMemory(mem);
}

/**
 * MRU-insert the staged values. Case-insensitive dedupe so "Prime" typed twice
 * with different capitalisation doesn't become two suggestions — the newest
 * spelling wins, because that is the one the owner just chose to type.
 */
export function rememberGear(values) {
  const mem = _readGearMemory();
  for (const f of GEAR_FIELDS) {
    const v = (values[f.key] || '').trim().slice(0, GEAR_MAX_LEN);
    if (!v) continue;
    mem[f.key] = [v, ...mem[f.key].filter(x => x.toLowerCase() !== v.toLowerCase())]
      .slice(0, GEAR_LIMIT);
  }
  _writeGearMemory(mem);
}

/**
 * Rebuild the three <datalist>s: saved values first (MRU), then anything the
 * archive already uses that isn't saved yet. That second half is what makes an
 * existing instance's list useful on the first load after this shipped — and
 * stays empty on a fork with no frames.
 */
export function refreshGearOptions() {
  const mem = _readGearMemory();
  for (const f of GEAR_FIELDS) {
    const list = document.getElementById(f.list);
    if (!list) continue;
    const seen = new Set(mem[f.key].map(v => v.toLowerCase()));
    const fromArchive = [];
    for (const a of STATE.archive) {
      const v = (a[f.key] || '').trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      fromArchive.push(v);
    }
    fromArchive.sort((a, b) => a.localeCompare(b));
    list.innerHTML = [...mem[f.key], ...fromArchive]
      .map(v => `<option value="${escapeHTML(v)}"></option>`).join('');
  }
}

/** The prefill for a blank compose form: the last gear staged, if remembering. */
function _applyGearDefaults() {
  const mem = _readGearMemory();
  for (const f of GEAR_FIELDS) {
    const el = document.getElementById(f.input);
    if (el) el.value = mem.remember ? (mem[f.key][0] || '') : '';
  }
}

/** Boot: sync the toggle from storage, fill the lists, prefill the form. */
export function restoreGearMemory() {
  const mem = _readGearMemory();
  const box = document.getElementById('arch-gear-remember');
  if (box) box.checked = mem.remember;
  refreshGearOptions();
  _applyGearDefaults();
}

/** "Forget saved" — drops the suggestions, keeps whatever is typed right now. */
export function archiveForgetGear() {
  const mem = _readGearMemory();
  if (!GEAR_FIELDS.some(f => mem[f.key].length)) return toast('nothing saved yet', 'info');
  if (!confirm('Forget the saved camera / lens / medium suggestions on this device?')) return;
  for (const f of GEAR_FIELDS) mem[f.key] = [];
  _writeGearMemory(mem);
  refreshGearOptions();
  // The lists also draw on gear your own frames already use, and forgetting a
  // saved value cannot un-publish a frame — so say so rather than let the list
  // look like it ignored the button.
  const stillListed = STATE.archive.some(a => a.camera || a.lens || a.medium);
  toast(stillListed
    ? '✓ saved gear forgotten — the list still shows gear your frames use'
    : '✓ saved gear forgotten', 'success');
}

// ============== ARCHIVE ==============
export async function archiveIngestPhoto(files) {
  const file = files[0];
  if (file && window.RawLens?.isRaw(file.name)) return window.RawLens.intake([file], 'archive');
  if (!file?.type.startsWith("image/")) return toast("not an image", "error");

  const baseName = cleanFilename(file.name).replace(/\.[^.]+$/, '');
  const view = document.getElementById("view-archive");

  // Show local preview immediately (resize to 1024w for display)
  let previewSrc;
  try {
    const preview = await _resizeToWebP(file, 1024);
    previewSrc = URL.createObjectURL(preview);
  } catch {
    previewSrc = await readFileAsDataURL(file);
  }
  document.getElementById("archive-preview-wrap").innerHTML = `<img src="${previewSrc}" alt="">`;
  document.getElementById("archive-filename").textContent = `${baseName}.webp`;
  // New image bytes → reset focal point to center (the old crop no longer applies).
  // Only fires when a fresh file is dropped, so metadata-only edits keep their focus.
  archiveComposeFocus = "";
  archiveComposeCardFocus = "";

  // SHA-256 from original file bytes
  let shortHash = '';
  try {
    const ab = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', ab);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    shortHash = 'sha256:' + hashHex.slice(0, 8);
    view.dataset.hash = shortHash;
    document.getElementById("arch-hash").value = shortHash;
  } catch {
    view.dataset.hash = '';
    document.getElementById("arch-hash").value = '// hash unavailable';
  }

  // When replacing the image on an existing frame (edit mode), give the new variants a
  // content-unique name (…__<hash8>) so they land at a fresh CDN URL. Overwriting the
  // same key would be served stale by the edge cache AND would make the old-asset
  // cleanup in archiveStage delete the file we just uploaded. New frames keep the clean
  // filename the photographer chose.
  const hash8 = shortHash ? shortHash.replace('sha256:', '') : Math.random().toString(36).slice(2, 10);
  const uploadBase = archiveEditId ? `${baseName}__${hash8}` : baseName;
  if (archiveEditId) document.getElementById("archive-filename").textContent = `${uploadBase}.webp`;

  // Duplicate guard — bail before uploading if this image already exists. The frame
  // currently being edited is excluded so re-staging its own image isn't a "duplicate".
  const dup = findDuplicateByHash(shortHash);
  if (dup && !(archiveEditId && dup.surface === 'archive' && dup.entry.id === archiveEditId)) {
    toast(`⚠ Duplicate detected: already in ${dup.surface} as ${dup.entry.filename || '—'}`, 'error');
    return;
  }

  // The compose upload runs detached from any entry, so its outcome is
  // recorded on the form (dataset.uploadState) and archiveStage translates it
  // into the entry-level flags every publish gate checks. Before this marker
  // existed, the failure fallback below left a form that staged a flag-free
  // entry — which is how a filename with no CDN object behind it published
  // (the IMG_1523 broken image, docs/resume-console-truthfulness.md).
  if (getToken()) {
    view.dataset.filename = `${uploadBase}.webp`;
    view.dataset.image = '';  // CDN serves from filename
    view.dataset.uploadState = 'uploading';
    toast('▲ Generating variants & uploading to R2…');
    try {
      const variants = await generateVariants(file, uploadBase);
      await uploadFilesWithRetry(variants);
      view.dataset.uploadState = 'done';
      toast('✓ Variants uploaded to R2', 'success');
    } catch (err) {
      // Fallback: keep local preview so the user isn't blocked
      view.dataset.image = previewSrc;
      view.dataset.filename = cleanFilename(file.name);
      view.dataset.uploadState = 'failed';
      toast(`⚠ R2 upload failed: ${err.message} — stored locally`, 'error');
    }
  } else {
    view.dataset.image = previewSrc;
    view.dataset.filename = cleanFilename(file.name);
    view.dataset.uploadState = 'local';
    toast('⚠ Not logged in — image stored locally only. Log in to upload.', 'error');
  }

  archiveUpdatePreview();
}

/**
 * The gear line, pipe-separated — blank fields drop out instead of leaving a
 * dangling separator. Free-text fields can be empty now (a <select> always had
 * a value), and `js/page-archive.js` renders the published line the same way.
 */
export function gearLine(entry, pipe = ' <span class="pipe">|</span> ') {
  return [entry.camera, entry.lens, entry.medium]
    .map(v => (v || '').trim()).filter(Boolean).join(pipe);
}

export function archiveUpdatePreview() {
  const t = document.getElementById("arch-title").value || "Title";
  const s = document.getElementById("arch-sub").value || "Subtitle";
  const l = document.getElementById("arch-loc").value || "Location, Year";
  const gear = gearLine({
    camera: document.getElementById("arch-cam").value,
    lens: document.getElementById("arch-lens").value,
    medium: document.getElementById("arch-med").value,
  });
  const h = document.getElementById("arch-hash").value;
  const hashLine = h && !h.startsWith("//") ? `<br><span class="hash">${h}</span>` : '';
  document.getElementById("arch-tag-preview").innerHTML =
    `<strong>${t}</strong><br>${s}<br>${l}<br>` +
    `<span class="meta">${gear || "Camera | Lens | Medium"}</span>${hashLine}`;
}

export let archiveEditId = null;

// Compose-form focal state. Owned HERE, with the form, though its writers are
// spread across three modules above this one (the focal entry points, the
// asset-library prefill, bufferPromote). They go through the setters because
// an imported binding cannot be assigned — the same invisible-variable-edge
// class the fourth seam closed for the upload queue. Reads may import the
// live bindings directly.
export let archiveComposeFocus = '';   // focal point for the frame being composed/edited
export let archiveComposeCardFocus = '';  // separate focal point for the tall 4:5 changelog card
export function _setArchiveComposeFocus(f) { archiveComposeFocus = f; }
export function _setArchiveComposeCardFocus(f) { archiveComposeCardFocus = f; }

export function archiveEdit(id) {
  const a = STATE.archive.find(x => x.id === id);
  if (!a) return;
  archiveEditId = id;

  document.getElementById("arch-title").value = a.title || "";
  document.getElementById("arch-sub").value = a.sub || "";
  document.getElementById("arch-loc").value = a.location || "";
  // Empty stays empty: a frame with no lens recorded must not silently acquire
  // one because the form had a default handy.
  document.getElementById("arch-cam").value = a.camera || "";
  document.getElementById("arch-lens").value = a.lens || "";
  document.getElementById("arch-med").value = a.medium || "";
  document.getElementById("arch-hash").value = a.hash || "// no hash";
  archiveComposeFocus = a.focus || "";
  archiveComposeCardFocus = a.cardFocus || "";

  // Show CDN preview
  const imgSrc = cdnThumb(a);
  if (imgSrc) {
    document.getElementById("archive-preview-wrap").innerHTML = `<img src="${imgSrc}" alt="">`;
  }
  document.getElementById("archive-filename").textContent = a.filename || "";

  // Store image/filename in view dataset. A stale uploadState from an
  // abandoned compose must not taint this entry — it describes a different
  // image's upload.
  const view = document.getElementById("view-archive");
  view.dataset.image = a.image || "";
  view.dataset.filename = a.filename || "";
  view.dataset.hash = a.hash || "";
  delete view.dataset.uploadState;

  // Swap button to update mode
  const btn = document.querySelector('#view-archive .btn-stage.btn-full');
  btn.textContent = "✓ UPDATE ENTRY";
  btn.style.borderColor = "var(--green)";
  btn.style.color = "var(--green)";

  archiveUpdatePreview();
  toast(`Editing: ${a.title} · drop a new photo to replace the image`, "success");
}

export function archiveStage() {
  const view = document.getElementById("view-archive");
  const image = view.dataset.image;
  const filename = view.dataset.filename;
  const title = document.getElementById("arch-title").value.trim();
  if (!title) return toast("title is required", "error");

  // Compose upload still in flight: staging now would mint an entry no upload
  // ever resolves (the compose flow doesn't know an entry exists yet).
  if (view.dataset.uploadState === 'uploading') {
    return toast('▲ image still uploading — wait for the ✓ (or the failure) before staging', 'error');
  }

  // UPDATE MODE: save back to existing entry
  if (archiveEditId) {
    const a = STATE.archive.find(x => x.id === archiveEditId);
    if (!a) return toast("entry not found", "error");
    a.title = title;
    a.sub = document.getElementById("arch-sub").value.trim();
    a.location = document.getElementById("arch-loc").value.trim();
    a.camera = document.getElementById("arch-cam").value.trim();
    a.lens = document.getElementById("arch-lens").value.trim();
    a.medium = document.getElementById("arch-med").value.trim();
    if (gearRememberOn()) rememberGear(a);
    a.slug = slugify(title);
    if (archiveComposeFocus) a.focus = archiveComposeFocus; else delete a.focus;
    if (archiveComposeCardFocus) a.cardFocus = archiveComposeCardFocus; else delete a.cardFocus;

    // Image replacement: a new photo dropped during edit carries a different filename
    // (archiveIngestPhoto gives replacements a content-unique name). Swap it in and
    // queue the OLD variants for R2 cleanup on the next publish, so the replaced crop
    // doesn't linger on the CDN. If only metadata changed, filename/hash are untouched.
    const newFilename = view.dataset.filename || '';
    if (newFilename && newFilename !== a.filename) {
      if (view.dataset.uploadState === 'failed') {
        // The replacement's upload never landed. Swapping filenames here would
        // trade a working live image for a broken reference AND queue the good
        // variants for deletion below. Keep the old image; metadata still saves.
        toast('⚠ replacement upload failed — keeping the previous image; re-drop to retry', 'error');
      } else {
        const oldBase = (a.filename || '').replace(/\.[^.]+$/, '');
        if (oldBase) {
          _pendingR2Deletes.push({
            keys: [
              `archive/${oldBase}-480w.webp`,
              `archive/${oldBase}-1024w.webp`,
              `archive/${oldBase}-2048w.webp`,
            ],
            surface: 'archive',
            entryId: a.id,
          });
        }
        a.filename = newFilename;
        a.image = view.dataset.image || '';
        if (view.dataset.hash) a.hash = view.dataset.hash;
        a._uploaded = true;
        delete a._uploadError;   // a confirmed re-upload clears an old failure
        toast('✓ image replaced — old CDN files cleaned up on publish', 'success');
      }
    }
    delete view.dataset.uploadState;   // consumed — the upload is referenced by the entry now

    bumpStage("archive");
    save();
    archiveClear();
    renderArchive();
    toast(`✓ "${title}" updated`, "success");
    return;
  }

  // NEW MODE: create new entry (original behavior)
  if (!image && !filename) return toast("drop a photo first", "error");

  const entry = {
    id: uid(), image, filename,
    title,
    sub: document.getElementById("arch-sub").value.trim(),
    location: document.getElementById("arch-loc").value.trim(),
    camera: document.getElementById("arch-cam").value.trim(),
    lens: document.getElementById("arch-lens").value.trim(),
    medium: document.getElementById("arch-med").value.trim(),
    hash: view.dataset.hash || '',
    slug: slugify(title),
    added_at: todayISO(),
    from_buffer: view.dataset.fromBuffer || null,
  };
  if (archiveComposeFocus) entry.focus = archiveComposeFocus;
  if (archiveComposeCardFocus) entry.cardFocus = archiveComposeCardFocus;
  if (gearRememberOn()) rememberGear(entry);
  // A failed compose upload stages HONESTLY: the entry carries _uploadError,
  // so it renders ✕ FAILED and every publish gate blocks it — the same
  // contract as the buffer/library ingest paths. This is the hole the
  // IMG_1523 broken publish went through: the compose form used to stage a
  // flag-free entry the guards couldn't see.
  if (view.dataset.uploadState === 'failed') {
    entry._uploadError = 'upload failed — re-drop this image';
  }
  delete view.dataset.uploadState;   // consumed — the entry now carries the state
  STATE.archive.unshift(entry);
  bumpStage("archive");
  // Auto-barrel entry
  upsertAutoBarrel({
    source: "archive",
    ref: entry.slug,
    date: barrelDateFromYMD(ymd(new Date())),
    title: `Archive: ${title}`,
    url: `/archive#${entry.slug}`,
  });
  save();
  archiveClear();
  renderArchive();
  toast(`✓ "${title}" staged + barrel updated`, "success");
}

export function archiveClear() {
  // Discarding a compose whose upload already landed leaves those variants on
  // R2 with nothing referencing them — say so instead of clearing silently.
  // (archiveStage consumes the marker on success, so this never fires on the
  // ordinary stage → clear sequence.)
  const _v = document.getElementById("view-archive");
  if (_v.dataset.uploadState === 'done' && _v.dataset.filename) {
    toast(`ℹ ${_v.dataset.filename} was already uploaded — its files stay on R2, unreferenced`, 'info');
  }
  archiveEditId = null;
  archiveComposeFocus = "";
  archiveComposeCardFocus = "";
  ["arch-title","arch-sub","arch-loc"].forEach(id => document.getElementById(id).value = "");
  // Gear carries over to the next frame (you rarely swap bodies mid-session) —
  // unless remembering is off, in which case the fields blank out.
  refreshGearOptions();
  _applyGearDefaults();
  document.getElementById("arch-hash").value = "";
  document.getElementById("archive-preview-wrap").innerHTML = `<div class="preview-empty">// NO IMAGE LOADED</div>`;
  document.getElementById("archive-filename").textContent = "";
  const view = document.getElementById("view-archive");
  delete view.dataset.image;
  delete view.dataset.filename;
  delete view.dataset.fromBuffer;
  delete view.dataset.hash;
  delete view.dataset.uploadState;
  // Reset button to stage mode
  const btn = document.querySelector('#view-archive .btn-stage.btn-full');
  btn.textContent = "▲ Stage to Archive";
  btn.style.borderColor = "";
  btn.style.color = "";
  archiveUpdatePreview();
}

export function archiveRemove(id) {
  // Capture the slug before the frame is spliced out so we can drop its matching
  // auto-barrel changelog entry too. Without this the homepage timeline keeps an
  // orphan "Archive: <title>" link pointing at /archive#<slug> after the frame is
  // gone — which is exactly why a deleted frame's barrel entry stayed live on the
  // site. Mirrors fnDeletePost(); filter() snapshots the match before splicing.
  const a = STATE.archive.find(x => x.id === id);
  const slug = a && a.slug;
  trashItem("archive", id);
  if (slug) {
    STATE.barrel
      .filter(b => b.type === "auto" && b.source === "archive" && b.ref === slug)
      .forEach(b => trashItem("barrel", b.id));
  }
}

export function renderArchive() {
  const display = document.getElementById("archive-display");
  document.getElementById("archive-count").textContent = STATE.archive.length;
  document.getElementById("archive-stats").textContent = `${STATE.archive.length} curated frames`;
  if (!STATE.archive.length) {
    display.innerHTML = `<div class="empty">// ARCHIVE EMPTY · STAGE FRAMES ABOVE</div>`;
    return;
  }
  display.innerHTML = STATE.archive.map(a => {
    // Mirror renderBuffer()/renderLibrary(): a frame with no CDN asset behind
    // it must SAY so — pointing <img> at the missing object would 404 quietly
    // and the card would just look empty instead of failed.
    const thumb = a._uploadError
      ? `<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;letter-spacing:1px;color:var(--accent);">✕ FAILED</div>`
      : `<div class="thumb">${(a.image || a.filename) ? `<img src="${cdnThumb(a)}" alt=""${a.focus ? ` style="object-position:${a.focus}"` : ''}>` : ''}</div>`;
    return `
    <div class="archive-card${a._imported ? ' imported' : ''}" onclick="archiveEdit('${a.id}')" style="cursor:pointer;">
      ${thumb}
      <div class="info">
        <div class="title">${a.title}</div>
        <div class="sub">${a._uploadError ? '✕ upload failed — open and re-drop the photo' : (a.sub || "—")}</div>
        <div class="tag">${gearLine(a) || '—'}</div>
        ${a.hash ? `<div class="hash">${a.hash}</div>` : ''}
      </div>
      <button class="icon-btn danger" onclick="event.stopPropagation(); archiveRemove('${a.id}')" title="Remove">×</button>
    </div>`;
  }).join("");
}
