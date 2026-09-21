// OAKLENS Field Console — more-views.
//
// The three surfaces reachable only through the More sheet — Library
// (pre-stage), Wall, Network — plus LIST DRAG-REORDER. Precisely the
// MORE_VIEWS constant in the router, minus bench (self-contained enough to
// stand alone). Read-mostly surfaces that change rarely, so they ride
// together rather than paying three modules' overhead.
//
// LIST DRAG-REORDER lives here, not in chrome, despite reading like a generic
// UI primitive: listNudge()/wireListDrag() mutate STATE[listKey] and then
// call renderWall() to re-render the surface that owns the list — an ordinary
// cycle inside one module instead of chrome reaching two layers up. The wall
// is the only reorderable list left (the barrel was retired 2026-09-20); the
// listKey parameter stays because the mutation is generic and the next
// reorderable surface should not have to reintroduce it.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE, save, stageChange, trashItem } from '../console-state.js';
import { getToken } from '../console-api.js';
import { showToast, startProgress, updateProgress, endProgress, logEvent } from '../console-telemetry.js';
import { toast, escapeHTML } from './chrome.js';
import { generateVariants, cdnThumb, cdnVariant, isVideoAsset, SITE_FILE_PREFIX } from './assets.js';
import { todayISO, uid, cleanFilename, readFileAsDataURL, computeHash, findDuplicateByHash } from './utils.js';
import { scheduleLibrarySync } from './sync.js';
import { _enqueueUpload } from './upload.js';

// ============== LIBRARY (PRE-STAGE) ==============
// A lightweight staging area: images uploaded to R2 (archive/ folder) that
// aren't assigned to any surface yet. They appear in the asset library picker
// and can be pulled into buffer/archive/wall later. Never published.

const LIBRARY_VIDEO_TYPES = ['video/mp4', 'video/webm'];

export async function libraryIngest(files) {
  // RAW files route to the RAW LENS (extracts embedded JPEG, calls back here).
  const raws = window.RawLens ? files.filter(f => window.RawLens.isRaw(f.name)) : [];
  if (raws.length) {
    files = files.filter(f => !window.RawLens.isRaw(f.name));
    window.RawLens.intake(raws, 'library');
    if (!files.length) return;
  }
  const media = files.filter(f => f.type.startsWith('image/') || LIBRARY_VIDEO_TYPES.includes(f.type));
  if (!media.length) return toast('no image or video files dropped', 'error');

  const canUpload = !!getToken();
  startProgress('ingest-library', 'PROC', media.length);
  showToast(`processing 0/${media.length}…`, { id: 'ingest-library', sticky: true });

  let _fileNo = 0;
  for (const file of media) {
    _fileNo++;
    updateProgress('ingest-library', _fileNo - 1);
    showToast(`processing ${_fileNo}/${media.length}…`, { id: 'ingest-library', sticky: true });
    const isVideo = LIBRARY_VIDEO_TYPES.includes(file.type);
    const rawName = cleanFilename(file.name);
    // Sanitize the base to match what the worker stores (it strips disallowed
    // chars on upload) so the library filename always resolves on the CDN.
    const baseName = rawName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '');
    const ext = isVideo ? ((rawName.match(/\.[^.]+$/)?.[0] || '.mp4').toLowerCase()) : '.webp';
    // Content-unique filename for images: append __<hash8> so re-uploads with the
    // same original filename produce a fresh CDN URL instead of colliding with a
    // stale edge-cached version. Videos keep the raw name (stored as-is, no variants).
    // Hash is computed below after this initial setup — uploadBase is set after the
    // hash block.
    const entryId = uid();

    // Hash + dupe check across all surfaces.
    let hash = null;
    try {
      hash = await computeHash(file);
      const dupe = findDuplicateByHash(hash);
      if (dupe) {
        toast(`⚠ Duplicate detected: already in ${dupe.surface} as ${dupe.entry.filename || '—'}`, 'error');
        continue;
      }
    } catch (e) {
      console.warn('hash failed:', e);
    }

    // Video must go to R2 (no useful local fallback) — require login.
    if (isVideo && !canUpload) {
      toast('⚠ Log in to stage video (R2 upload required)', 'error');
      continue;
    }

    // Build the upload filename. For images, append __<hash8> so re-uploads with
    // the same camera filename land at a fresh CDN URL (avoids stale edge cache).
    // Videos keep the raw baseName (stored as-is, no WebP variants to collide).
    const hash8 = hash ? hash.replace('sha256:', '') : Math.random().toString(36).slice(2, 10);
    const uploadBase = isVideo ? baseName : `${baseName}__${hash8}`;
    const filename = `${uploadBase}${ext}`;

    if (canUpload) {
      STATE.library.unshift({
        id: entryId,
        filename,
        ...(isVideo ? { kind: 'video' } : {}),
        hash: hash,
        added_at: todayISO(),
        _uploading: true,
      });
      save();
      renderLibrary();

      try {
        let uploads;
        if (isVideo) {
          // Store the original clip as-is under videos/. Best-effort poster from
          // the first frame so the banner has no blank flash before autoplay.
          uploads = [new File([file], `videos/${filename}`, { type: file.type })];
          const poster = await _videoPosterWebP(file).catch(() => null);
          if (poster) uploads.push(new File([poster], `videos/posters/${uploadBase}.webp`, { type: 'image/webp' }));
        } else {
          uploads = await generateVariants(file, uploadBase);
        }
        _enqueueUpload(entryId, 'library', uploads, filename);
      } catch (err) {
        const entry = STATE.library.find(e => e.id === entryId);
        if (entry) { delete entry._uploading; entry._uploadError = err.message; }
        renderLibrary();
        toast(`⚠ Processing failed: ${err.message}`, 'error');
      }
    } else {
      const dataURL = await readFileAsDataURL(file);
      STATE.library.unshift({
        id: entryId,
        image: dataURL,
        filename: rawName,
        hash: hash,
        added_at: todayISO(),
      });
      stageChange('library', { id: entryId, label: `${rawName} — new (local only)`, kind: 'add' });
      save();
      renderLibrary();
    }
  }

  endProgress('ingest-library');
  if (!canUpload) showToast('⚠ Not logged in — images stored locally only', { id: 'ingest-library', kind: 'error' });
  else showToast(`✓ ${media.length} file${media.length > 1 ? 's' : ''} staged`, { id: 'ingest-library', kind: 'success' });
}

// Best-effort: grab a frame near the start of a video and encode it as a webp
// poster so the banner has no blank flash before autoplay (and degrades to a
// still if autoplay is blocked). Resolves to a Blob, or null on any failure.
export function _videoPosterWebP(file) {
  return new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('loadeddata', () => {
      try { video.currentTime = Math.min(0.1, (video.duration || 1) / 2); }
      catch { finish(null); }
    });
    video.addEventListener('seeked', () => {
      try {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return finish(null);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(video, 0, 0, w, h);
        canvas.toBlob(b => finish(b), 'image/webp', 0.82);
      } catch { finish(null); }
    });
    video.addEventListener('error', () => finish(null));
    video.src = url;
  });
}

export function renderLibrary() {
  const display = document.getElementById('library-display');
  const countEl = document.getElementById('library-count');
  const statsEl = document.getElementById('library-stats');
  if (!display) return;

  countEl.textContent = STATE.library.length;
  statsEl.textContent = `${STATE.library.length} images`;

  if (!STATE.library.length) {
    display.innerHTML = '<div class="empty">// LIBRARY EMPTY · DROP IMAGES ABOVE TO PRE-STAGE</div>';
    return;
  }

  display.innerHTML = STATE.library.map(item => {
    // Cache-bust real CDN URLs so a stale 404 (from a render that fired
    // mid-upload) can't stick after the upload completes — `?v=1` is a stable
    // key once uploaded, `Date.now()` is unique if we somehow render too early.
    // Never append to a local data: URL (the not-logged-in fallback) — that
    // would corrupt the base64 payload.
    const raw = cdnThumb(item);
    const thumbSrc = raw.startsWith('data:')
      ? raw
      : raw + '?v=' + (item._uploaded ? '1' : Date.now());

    // Mirror renderBuffer(): while uploading/errored, show a placeholder rather
    // than pointing <img> at a CDN object that doesn't exist yet. Otherwise the
    // 404 fires onerror, the img is hidden, and the cached 404 keeps the thumb
    // invisible even after the upload finishes.
    let thumbHtml;
    if (item._uploading) {
      thumbHtml = '<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;letter-spacing:1px;color:var(--accent);">▲ UPLOADING</div>';
    } else if (item._uploadError) {
      thumbHtml = '<div class="thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;letter-spacing:1px;color:var(--accent);">✕ FAILED</div>';
    } else {
      thumbHtml = `<div class="thumb"><img src="${thumbSrc}" alt="" onerror="this.style.display='none'"></div>`;
    }

    return `
    <div class="archive-card">
      ${thumbHtml}
      <div class="info">
        <div class="title">${escapeHTML(item.filename)}</div>
        <div class="sub">${item.hash || '—'}</div>
        <div class="tag">${item._uploading ? '▲ UPLOADING' : item._uploadError ? '✕ FAILED' : item._uploaded ? '✓ CDN' : 'LOCAL'}${isVideoAsset(item) ? ' · ▶ VIDEO' : ''}</div>
      </div>
      <button class="icon-btn" onclick="event.stopPropagation(); libraryHeroLine('${item.id}')" title="Copy the homepage hero line for this image">⌂</button>
      <button class="icon-btn danger" onclick="event.stopPropagation(); libraryRemove('${item.id}')" title="Remove">×</button>
    </div>`;
  }).join('');
}

// "How does one change the hero image? … This will be the first thing someone
// will want to do next to just writing." — 2026-08-08 cold run.
//
// The honest answer today is one line of site.config.js and a deploy, because
// `folioHero` is read by injectSiteChrome(), which is SYNCHRONOUS and takes no
// env — it cannot see published data, so the console genuinely cannot set this
// without restructuring the hot path. Doing that properly is its own change.
//
// What it can do is delete the twenty minutes of hunting: hand over the exact
// line, already filled in, ready to paste. Not the finished feature; the whole
// of the finished feature's value minus one paste.
export function libraryHeroLine(id) {
  const item = STATE.library.find(x => x.id === id);
  if (!item) return;
  if (!item._uploaded) {
    return showToast('Upload this to the CDN first — a local image has no address yet', { kind: 'warning' });
  }
  const line = `  folioHero: { image: '${cdnVariant(item, 2048)}', alt: '' },`;
  navigator.clipboard.writeText(line).then(
    () => showToast('Hero line copied — paste it into site.config.js, then deploy'),
    () => showToast('Copy failed — the address is ' + cdnVariant(item, 2048), { kind: 'warning' }),
  );
}

export function libraryRemove(id) {
  trashItem('library', id);
  scheduleLibrarySync();
}

// ============== WALL ==============
// Wallpaper downloads are named "<BRAND>_Title.jpg" (js/page-wall.js), so a
// re-uploaded file arrives with the site's own prefix on it. Strip whatever
// prefix THIS site uses, not a hardcoded one — SITE_FILE_PREFIX is derived from
// site.config.js `name`, the same value page-wall.js builds its filenames from.
export function sanitizeWallTitle(filename) {
  let t = cleanFilename(filename).replace(/\.[^.]+$/, "");
  if (SITE_FILE_PREFIX) t = t.replace(new RegExp(`^${SITE_FILE_PREFIX}[-_]`, 'i'), "");
  t = t.replace(/[-_]+/g, " ");
  return t.trim();
}

export async function wallIngest(files) {
  const imgs = [...files].filter(f => f.type.startsWith("image/"));
  if (!imgs.length) return;

  const canUpload = !!getToken();
  startProgress('ingest-wall', 'PROC', imgs.length);
  showToast(`processing 0/${imgs.length}…`, { id: 'ingest-wall', sticky: true });

  let _fileNo = 0;
  for (const file of imgs) {
    _fileNo++;
    updateProgress('ingest-wall', _fileNo - 1);
    showToast(`processing ${_fileNo}/${imgs.length}…`, { id: 'ingest-wall', sticky: true });
    const rawName = cleanFilename(file.name);          // original filename, extension preserved
    const baseName = rawName.replace(/\.[^.]+$/, '');  // strip extension for variant names
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
      // bumpStage deferred to _markEntryUploadDone — stage only once upload confirms.
      STATE.wallpapers.unshift({
        id: entryId,
        filename: `${baseName}.webp`,  // base name used by wall renderer for sized variants
        fullres: rawName,              // original filename stored for full-res download URL
        title: sanitizeWallTitle(file.name),
        desc: "",
        isNew: true,
        added_at: todayISO(),
        hash,
        _uploading: true,
      });
      save();
      renderWall();

      try {
        const variants = await generateVariants(file, baseName, 'wallpaper');
        // Original full-res file uploaded to wallpaper/full/ for downloads.
        // Unlike every other ingest path (canvas re-encode strips EXIF), this
        // one ships the user's original bytes to the public CDN — scrub
        // GPS/EXIF-bearing metadata first, without re-encoding (pixels
        // untouched; fail-safe returns the original on anything unparseable).
        let originalBytes = file;
        try {
          const { bytes, removed } = stripJpegPrivacyMetadata(await file.arrayBuffer());
          if (removed.length) {
            originalBytes = new Blob([bytes], { type: file.type });
            logEvent(`◇ wall: stripped ${[...new Set(removed)].join(' + ')} from ${rawName} before full-res upload`, 'info');
          }
        } catch { /* keep the original — the scrub must never block an upload */ }
        const originalFile = new File([originalBytes], `wallpaper/full/${rawName}`, { type: file.type });
        _enqueueUpload(entryId, 'wallpapers', [...variants, originalFile], `${baseName}.webp`);
      } catch (err) {
        const entry = STATE.wallpapers.find(e => e.id === entryId);
        if (entry) { delete entry._uploading; entry._uploadError = err.message; }
        renderWall();
        toast(`⚠ Resize failed: ${err.message}`, 'error');
      }
    } else {
      const dataURL = await readFileAsDataURL(file);
      STATE.wallpapers.unshift({
        id: entryId,
        src: dataURL,
        filename: `${baseName}.webp`,
        fullres: rawName,
        title: sanitizeWallTitle(file.name),
        desc: "",
        isNew: true,
        added_at: todayISO(),
        hash,
      });
      stageChange('wallpapers', { id: entryId, label: `${sanitizeWallTitle(file.name)} — new (local only)`, kind: 'add' });
      save();
      renderWall();
    }
  }

  endProgress('ingest-wall');
  if (!canUpload) showToast('⚠ Not logged in — wallpapers stored locally only. Log in to upload.', { id: 'ingest-wall', kind: 'error' });
  else showToast(`✓ ${imgs.length} wallpaper${imgs.length > 1 ? "s" : ""} queued — uploading to R2…`, { id: 'ingest-wall', kind: 'success' });
}

let wallEditId = null;

export function wallEdit(id) {
  const w = STATE.wallpapers.find(x => x.id === id);
  if (!w) return;
  wallEditId = id;
  document.getElementById("wall-url").value = w.filename || "";
  document.getElementById("wall-title").value = w.title || "";
  document.getElementById("wall-desc").value = w.desc || "";
  const btn = document.querySelector('#view-wall .btn-stage');
  btn.textContent = "✓ Update";
  btn.style.borderColor = "var(--green)";
  btn.style.color = "var(--green)";
  document.getElementById("wall-cancel-btn").style.display = "";
  toast(`Editing: ${w.title}`, "success");
}

export function wallClearEdit() {
  wallEditId = null;
  ["wall-url","wall-title","wall-desc"].forEach(id => document.getElementById(id).value = "");
  const btn = document.querySelector('#view-wall .btn-stage');
  btn.textContent = "+ Add";
  btn.style.borderColor = "";
  btn.style.color = "";
  document.getElementById("wall-cancel-btn").style.display = "none";
}

export function wallAdd() {
  const filename = document.getElementById("wall-url").value.trim();
  const title = document.getElementById("wall-title").value.trim();
  const desc = document.getElementById("wall-desc").value.trim();
  if (!title) return toast("title required", "error");

  // UPDATE MODE
  if (wallEditId) {
    const w = STATE.wallpapers.find(x => x.id === wallEditId);
    if (!w) return toast("entry not found", "error");
    if (filename) w.filename = filename;
    w.title = title;
    w.desc = desc;
    wallEditId = null;
    stageChange("wallpapers", { id: w.id, label: `${title} — updated` });
    save();
    ["wall-url","wall-title","wall-desc"].forEach(id => document.getElementById(id).value = "");
    const btn = document.querySelector('#view-wall .btn-stage');
    btn.textContent = "+ Add";
    btn.style.borderColor = "";
    btn.style.color = "";
    document.getElementById("wall-cancel-btn").style.display = "none";
    renderWall();
    toast(`✓ ${title} updated`, "success");
    return;
  }

  // NEW MODE
  if (!filename) return toast("filename + title required", "error");
  STATE.wallpapers.unshift({ id: uid(), filename, title, desc, isNew: true, added_at: todayISO() });
  stageChange("wallpapers", { id: STATE.wallpapers[0].id, label: `${title} — new`, kind: 'add' });
  save();
  ["wall-url","wall-title","wall-desc"].forEach(id => document.getElementById(id).value = "");
  renderWall();
  toast(`✓ ${title} added`, "success");
}

export function wallToggleNew(id) {
  const w = STATE.wallpapers.find(w => w.id === id);
  if (w) {
    w.isNew = !w.isNew;
    stageChange("wallpapers", { id: w.id, label: `${w.title || w.filename} — NEW badge ${w.isNew ? 'on' : 'off'}` });
    save(); renderWall();
  }
}
export function wallRemove(id) {
  trashItem("wallpapers", id);
}

export function renderWall() {
  const missing = STATE.wallpapers.filter(w => !w.filename).length;
  document.getElementById("wall-stats").textContent =
    `${STATE.wallpapers.length} wallpapers` + (missing ? ` · ${missing} missing filename` : "");
  const list = document.getElementById("wall-list");
  if (!STATE.wallpapers.length) {
    list.innerHTML = `<div class="empty">// WALL EMPTY</div>`;
    return;
  }
  list.innerHTML = STATE.wallpapers.map((w, i) => {
    let thumbHtml;
    if (w._uploading) {
      thumbHtml = `<div class="list-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;letter-spacing:1px;color:var(--accent);">▲ UPLOADING</div>`;
    } else if (w._uploadError) {
      thumbHtml = `<div class="list-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;letter-spacing:1px;color:var(--accent);">✕ FAILED</div>`;
    } else {
      thumbHtml = `<img class="list-thumb" src="${w.src || cdnThumb(w, 'wallpaper')}" alt=""${w.focus ? ` style="object-position:${w.focus}"` : ''} onerror="this.style.background='var(--bg-elev-2)'">`;
    }
    return `
    <div class="list-row${w._imported ? ' imported' : ''}" draggable="true" data-id="${w.id}" data-list="wallpapers" onclick="wallEdit('${w.id}')" style="cursor:pointer;">
      <span class="list-handle">⋮⋮</span>
      ${thumbHtml}
      <div class="list-info">
        <div class="l-title">${w.title}${!w.filename ? ' <span style="color:var(--accent);font-size:0.7rem;">⚠ NO FILE</span>' : ''}</div>
        <div class="l-sub">${w.filename ? w.filename : w.desc || "—"}</div>
      </div>
      <div class="list-actions">
        <span class="list-nudge">
          <button class="icon-btn" onclick="event.stopPropagation(); listNudge('wallpapers','${w.id}',-1)" title="Move up">▲</button>
          <button class="icon-btn" onclick="event.stopPropagation(); listNudge('wallpapers','${w.id}',1)" title="Move down">▼</button>
        </span>
        <button class="icon-btn" onclick="event.stopPropagation(); wallFocal('${w.id}')" title="Focal point">◎</button>
        <button class="list-toggle ${w.isNew ? "on" : ""}" onclick="event.stopPropagation(); wallToggleNew('${w.id}')" title="NEW badge"></button>
        <button class="icon-btn danger" onclick="event.stopPropagation(); wallRemove('${w.id}')">×</button>
      </div>
    </div>`;
  }).join("");
  wireListDrag("wall-list", "wallpapers");
}

// ============== NETWORK · FRIENDS OF (About §004) ==============
// Lived in the barrel section until that surface was retired (2026-09-20);
// the network list draws the same ↗ glyph on an off-site link.
export function isExternalUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

let networkEditId = null;

export function networkAdd() {
  const name = document.getElementById("friends-name").value.trim();
  const tag = document.getElementById("friends-tag").value.trim();
  const location = document.getElementById("friends-location").value.trim();
  const url = document.getElementById("friends-url").value.trim();
  if (!name) return toast("name required", "error");
  if (url && !/^https?:\/\//i.test(url) && url[0] !== '/') {
    return toast("URL must start with http(s):// or /", "error");
  }

  // UPDATE MODE
  if (networkEditId) {
    const f = STATE.friends.find(x => x.id === networkEditId);
    if (!f) return toast("node not found", "error");
    f.name = name;
    f.tag = tag;
    f.location = location;
    f.url = url;
    networkEditId = null;
    stageChange("friends", { id: f.id, label: `${name} — updated` });
    save();
    ["friends-name","friends-tag","friends-location","friends-url"].forEach(id => document.getElementById(id).value = "");
    const btn = document.querySelector('#view-friends .btn-stage');
    btn.textContent = "+ Add";
    btn.style.borderColor = "";
    btn.style.color = "";
    document.getElementById("friends-cancel-btn").style.display = "none";
    renderNetwork();
    toast(`✓ ${name} updated`, "success");
    return;
  }

  // NEW MODE
  STATE.friends.unshift({
    id: uid(),
    name,
    tag,
    location,
    url,
    added_at: todayISO(),
  });
  stageChange("friends", { id: STATE.friends[0].id, label: `${name} — new node`, kind: 'add' });
  save();
  ["friends-name","friends-tag","friends-location","friends-url"].forEach(id => document.getElementById(id).value = "");
  renderNetwork();
  toast(`✓ ${name} added`, "success");
}

export function networkEdit(id) {
  const f = STATE.friends.find(x => x.id === id);
  if (!f) return;
  networkEditId = id;
  document.getElementById("friends-name").value = f.name || "";
  document.getElementById("friends-tag").value = f.tag || "";
  document.getElementById("friends-location").value = f.location || "";
  document.getElementById("friends-url").value = f.url || "";
  const btn = document.querySelector('#view-friends .btn-stage');
  btn.textContent = "✓ Update";
  btn.style.borderColor = "var(--accent)";
  btn.style.color = "var(--accent)";
  document.getElementById("friends-cancel-btn").style.display = "";
  document.getElementById("friends-name").focus();
}

export function networkClearEdit() {
  networkEditId = null;
  ["friends-name","friends-tag","friends-location","friends-url"].forEach(id => document.getElementById(id).value = "");
  const btn = document.querySelector('#view-friends .btn-stage');
  btn.textContent = "+ Add";
  btn.style.borderColor = "";
  btn.style.color = "";
  document.getElementById("friends-cancel-btn").style.display = "none";
}

export function networkRemove(id) {
  trashItem("friends", id);
}

export function renderNetwork() {
  document.getElementById("friends-stats").textContent = `${STATE.friends.length} nodes`;
  const list = document.getElementById("friends-list");
  if (!STATE.friends.length) {
    list.innerHTML = `<div class="empty">// NO NODES · ADD A CREATOR-RUN SITE TO POPULATE ABOUT §004</div>`;
    return;
  }
  list.innerHTML = STATE.friends.map(f => {
    const meta = [f.tag, f.location].filter(Boolean).map(escapeHTML).join(" / ");
    const externalGlyph = isExternalUrl(f.url)
      ? `<span class="external-glyph">↗</span>` : "";
    return `
    <div class="list-row${f._imported ? ' imported' : ''}" data-id="${f.id}" data-list="friends" onclick="networkEdit('${f.id}')" style="cursor:pointer;">
      <div class="list-info">
        <div class="l-title">${escapeHTML(f.name || "")}${externalGlyph}</div>
        <div class="l-sub">${meta || "—"}${f.url ? ` · ${escapeHTML(f.url)}` : ""}</div>
      </div>
      <div class="list-actions">
        <button class="icon-btn danger" onclick="event.stopPropagation(); networkRemove('${f.id}')" title="Remove">×</button>
      </div>
    </div>`;
  }).join("");
}

// ============== LIST DRAG-REORDER ==============
// Touch path for reorder: HTML5 drag needs an undiscoverable long-press on
// iPad, so coarse pointers get explicit ▲▼ nudges (same mutation as a drop).
export function listNudge(listKey, id, dir) {
  const arr = STATE[listKey];
  const i = arr.findIndex(x => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  const [item] = arr.splice(i, 1);
  arr.splice(j, 0, item);
  stageChange(listKey, { id: item.id, label: `${item.title || item.filename || 'entry'} — reordered` });
  save();
  renderWall();
}

let dragSrc = null;
export function wireListDrag(containerId, listKey) {
  const c = document.getElementById(containerId);
  c.querySelectorAll(".list-row").forEach(row => {
    row.addEventListener("dragstart", e => {
      dragSrc = row.dataset.id;
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", e => {
      row.classList.remove("dragging");
      c.querySelectorAll(".list-row").forEach(r => r.classList.remove("drag-over"));
    });
    row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("drag-over"); });
    row.addEventListener("dragleave", e => row.classList.remove("drag-over"));
    row.addEventListener("drop", e => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const targetId = row.dataset.id;
      if (!dragSrc || dragSrc === targetId) return;
      const arr = STATE[listKey];
      const fromIdx = arr.findIndex(x => x.id === dragSrc);
      const toIdx = arr.findIndex(x => x.id === targetId);
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      stageChange(listKey, { id: item.id, label: `${item.title || item.filename || 'entry'} — reordered` });
      save();
      renderWall();
    });
  });
}
