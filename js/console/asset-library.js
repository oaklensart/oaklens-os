// OAKLENS Field Console — asset-library.
//
// The reusable media picker: one modal over everything already in STATE (and
// therefore already on the CDN), with surface pills, filename search,
// recent/alpha sort, folder-restricted mode, and ordered multi-select for FN
// frame strips. Plus the per-surface selection callbacks that turn a picked
// filename into an entry (assetToBuffer, assetToArchiveForm, assetToWallForm,
// assetToHero, assetToPostBody/Video) and the Apple Music embed insert.
//
// getAssetLibraryItems() excludes entries flagged _uploadError/_uploading:
// their filename has no CDN object behind it yet, and picking one would mint a
// clean `_uploaded: true` copy on another surface — laundering a broken
// reference past the publish guards (see the truthfulness write-up).
//
// The toolbar mutators MUST stay exported functions: the pills and sort button
// render into innerHTML and fire as inline on*= handlers, which run in global
// scope and cannot see a module-scope `let`. The ESC handler registers at
// module load in the capture phase, so it beats the focus-mode handler.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.

import { STATE, save, stageChange } from '../console-state.js';
import { appleMusicEmbedSrc, appleMusicIframe } from '../markdown-engine.js';
import { toast, escapeHTML, escapeAttrJS, hideOverlay } from './chrome.js';
import { CDN_BASE, cdnThumb, isVideoAsset } from './assets.js';
import { uid, todayISO } from './utils.js';
import { renderBuffer } from './buffer.js';
import { archiveUpdatePreview, _setArchiveComposeFocus, _setArchiveComposeCardFocus } from './archive.js';
import { fnInsertAtCursor, fnHeroSet } from './fn-editor.js';

// ============== ASSET LIBRARY ==============
// A reusable modal that lets any image field/dropzone pick from images
// already tracked in STATE (and therefore already on the CDN). Reads from
// STATE arrays only — never queries R2 directly.

export function getAssetLibraryItems() {
  const items = [];

  // Entries whose upload failed or is still in flight have no CDN object
  // behind their filename yet — offering them here would mint clean, flag-free
  // copies on other surfaces (assetToBuffer sets _uploaded) and launder a
  // broken reference straight past the publish guards.
  const usable = (e) => !e._uploadError && !e._uploading;

  STATE.archive.forEach(e => {
    if (e.filename && usable(e)) items.push({
      filename: e.filename,
      label: e.title || e.filename,
      surface: 'archive',
      folder: 'archive',
      added_at: e.added_at || null,
    });
  });

  STATE.buffer.forEach(e => {
    if (e.filename && usable(e)) items.push({
      filename: e.filename,
      label: e.filename,
      surface: 'buffer',
      folder: 'archive',  // buffer images also live in archive/ on R2
      added_at: e.added_at || e.published_at || null,
    });
  });

  STATE.wallpapers.forEach(e => {
    if (e.filename && usable(e)) items.push({
      filename: e.filename,
      label: e.title || e.filename,
      surface: 'wallpaper',
      folder: 'wallpaper',
      added_at: e.added_at || null,
    });
  });

  // Hero images from posts (deduplicate against archive/buffer)
  const seen = new Set(items.map(i => i.filename));
  STATE.posts.forEach(p => {
    const heroFile = p.hero_filename || p.hero;
    if (heroFile && !heroFile.startsWith('data:') && !seen.has(heroFile)) {
      seen.add(heroFile);
      items.push({
        filename: heroFile,
        label: `Hero: ${p.title || p.fn_id}`,
        surface: 'hero',
        folder: 'archive',
        added_at: p.added_at || null,
      });
    }
  });

  // Pre-staged library images (lowest priority — only surfaced if not already
  // present on another surface). Library uploads live in archive/ on R2.
  STATE.library.forEach(e => {
    if (e.filename && usable(e) && !seen.has(e.filename)) {
      seen.add(e.filename);
      const isVid = isVideoAsset(e);
      items.push({
        filename: e.filename,
        label: e.filename,
        surface: isVid ? 'video' : 'library',
        folder: isVid ? 'videos' : 'archive',
        kind: isVid ? 'video' : undefined,
        added_at: e.added_at || null,
      });
    }
  });

  // Dedup archive/buffer overlap (same filename lives in both surfaces).
  // Priority: archive > buffer > wallpaper > hero — keep the first occurrence,
  // which getAssetLibraryItems pushes in that order above.
  const deduped = [];
  const kept = new Set();
  items.forEach(i => {
    if (kept.has(i.filename)) return;
    kept.add(i.filename);
    deduped.push(i);
  });
  return deduped;
}

let _assetLibraryCallback = null;  // function(filename) called on selection
let _assetLibraryFilter = 'all';   // 'all' | 'archive' | 'buffer' | 'wallpaper' | 'hero' | 'library'
let _assetLibrarySortBy = 'recent'; // 'recent' | 'alpha'
let _assetLibraryFolderFilter = null; // null = all | 'archive' | 'wallpaper' — restricts to one R2 folder
let _assetLibraryMultiSelect = false; // multi-pick mode (FN// post body strip inserts)
let _assetLibrarySelected = new Set(); // filenames picked in multi-select mode (insertion = selection order)

// Toolbar mutators. These MUST stay functions: the pills/sort button are rendered
// into innerHTML and fire as inline on*= handlers, which run in global scope and
// therefore cannot see a module-scope `let`. Assigning the binding directly from
// the handler only creates a same-named property on window, which nothing reads —
// so the control silently does nothing. Route every handler-driven mutation of
// module state through an exported setter.
export function _assetLibrarySetFilter(f) {
  _assetLibraryFilter = f;
  renderAssetLibrary();
}

export function _assetLibraryToggleSort() {
  _assetLibrarySortBy = _assetLibrarySortBy === 'recent' ? 'alpha' : 'recent';
  renderAssetLibrary();
}

// Debounce the search re-render so typing doesn't rebuild the grid on every keystroke.
let _assetLibSearchTimer = null;
export function _assetLibSearchDebounced() {
  clearTimeout(_assetLibSearchTimer);
  _assetLibSearchTimer = setTimeout(renderAssetLibrary, 200);
}

export function openAssetLibrary(callback, folderFilter, multiSelect = false) {
  _assetLibraryCallback = callback;
  _assetLibraryFolderFilter = folderFilter || null;
  _assetLibraryMultiSelect = !!multiSelect;
  _assetLibrarySelected = new Set();
  _assetLibraryFilter = 'all';
  _assetLibrarySortBy = 'recent';
  const ov = document.getElementById('asset-library-modal');
  ov.classList.remove('hidden', 'closing');
  renderAssetLibrary();
  // Focus search after render — fine pointers only. On touch this would pop
  // the keyboard over half the picker before a single thumbnail is seen.
  if (matchMedia('(pointer: fine)').matches) {
    setTimeout(() => {
      const search = document.getElementById('asset-lib-search');
      if (search) search.focus();
    }, 100);
  }
}

export function closeAssetLibrary() {
  hideOverlay('asset-library-modal');
  _assetLibraryCallback = null;
  _assetLibraryMultiSelect = false;
  _assetLibrarySelected = new Set();
}

export function renderAssetLibrary() {
  const toolbar = document.getElementById('asset-lib-toolbar');
  const gridEl = document.getElementById('asset-lib-grid');
  const emptyEl = document.getElementById('asset-lib-empty');

  let items = getAssetLibraryItems();

  // Restrict to a single R2 folder when the picker was opened for a specific
  // surface (e.g. buffer/archive/hero → archive/, wall → wallpaper/). Prevents
  // picking an image that lives in a folder the target surface can't resolve.
  if (_assetLibraryFolderFilter) {
    items = items.filter(i => i.folder === _assetLibraryFolderFilter);
  }

  // Capture search value + focus state before we rebuild the toolbar, so
  // typing isn't interrupted (innerHTML reassignment destroys the input).
  const prevSearch = document.getElementById('asset-lib-search');
  const searchVal = prevSearch?.value || '';
  const searchWasFocused = document.activeElement === prevSearch;
  const caretPos = prevSearch ? prevSearch.selectionStart : null;

  // Build toolbar. When a folder filter is active, only show the surface pills
  // that live in that folder (the ALL pill always shows).
  const folderSurfaces = {
    archive: ['all', 'archive', 'buffer', 'hero', 'library'],
    wallpaper: ['all', 'wallpaper'],
    videos: ['all', 'video'],
  };
  const filters = _assetLibraryFolderFilter
    ? folderSurfaces[_assetLibraryFolderFilter]
    : ['all', 'archive', 'buffer', 'wallpaper', 'hero', 'library', 'video'];

  toolbar.innerHTML = `
    ${filters.map(f => `<button class="asset-lib-pill${_assetLibraryFilter === f ? ' active' : ''}"
      onclick="_assetLibrarySetFilter('${f}')">${f.toUpperCase()}</button>`).join('')}
    <input class="asset-lib-search" id="asset-lib-search" placeholder="search filename…"
      value="${escapeHTML(searchVal)}"
      oninput="_assetLibSearchDebounced()">
    <button class="asset-lib-sort" onclick="_assetLibraryToggleSort()">
      ${_assetLibrarySortBy === 'recent' ? '↓ RECENT' : '↓ A-Z'}
    </button>
  `;

  // Restore focus + caret to the rebuilt search input so real-time search works
  if (searchWasFocused) {
    const newSearch = document.getElementById('asset-lib-search');
    if (newSearch) {
      newSearch.focus();
      const pos = caretPos == null ? newSearch.value.length : caretPos;
      try { newSearch.setSelectionRange(pos, pos); } catch (e) {}
    }
  }

  // Reflect multi-select mode on the grid + insert bar (runs on every path,
  // including the empty-results early return below).
  gridEl.classList.toggle('multi-select', _assetLibraryMultiSelect);
  _assetLibraryUpdateInsertBar();

  // Filter by surface
  if (_assetLibraryFilter !== 'all') {
    items = items.filter(i => i.surface === _assetLibraryFilter);
  }

  // Filter by search
  const query = searchVal.toLowerCase().trim();
  if (query) {
    items = items.filter(i =>
      i.filename.toLowerCase().includes(query) ||
      i.label.toLowerCase().includes(query)
    );
  }

  // Sort
  if (_assetLibrarySortBy === 'recent') {
    items.sort((a, b) => {
      const ta = a.added_at ? new Date(a.added_at).getTime() : 0;
      const tb = b.added_at ? new Date(b.added_at).getTime() : 0;
      return tb - ta;  // newest first
    });
  } else {
    items.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  // Render grid
  if (!items.length) {
    gridEl.innerHTML = '';
    gridEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.innerHTML = `<div class="asset-lib-empty">// NO IMAGES FOUND${query ? ' FOR "' + escapeHTML(query.toUpperCase()) + '"' : ''}</div>`;
    return;
  }

  gridEl.style.display = 'grid';
  emptyEl.style.display = 'none';

  // In multi-select mode each thumbnail toggles into _assetLibrarySelected
  // (selection order) instead of firing the single-pick callback.
  const selOrder = _assetLibraryMultiSelect ? [..._assetLibrarySelected] : [];

  gridEl.innerHTML = items.map(item => {
    const isVideo = item.kind === 'video';
    const thumbUrl = cdnThumb(item, item.folder);
    const hqUrl = isVideo
      ? `${CDN_BASE}/videos/${encodeURIComponent(item.filename)}`
      : `${CDN_BASE}/${item.folder}/${encodeURIComponent(item.filename.replace(/\.[^.]+$/, ''))}-2048w.webp`;
    const selIdx = selOrder.indexOf(item.filename);
    const isSel = selIdx >= 0;
    const onClick = _assetLibraryMultiSelect
      ? `_assetLibraryToggleSelect('${escapeAttrJS(item.filename)}')`
      : `selectAssetLibraryItem('${escapeAttrJS(item.filename)}')`;
    return `<div class="asset-lib-item${isSel ? ' selected' : ''}${isVideo ? ' is-video' : ''}" data-filename="${escapeHTML(item.filename)}" onclick="${onClick}">
      <button class="asset-lib-open" onclick="event.stopPropagation(); window.open('${escapeAttrJS(hqUrl)}', '_blank')" title="${isVideo ? 'Open video in new tab' : 'Open 2048w in new tab'}">↗</button>
      <img src="${thumbUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="asset-lib-badge${isVideo ? ' video' : ''}">${escapeHTML(item.surface)}</div>
      <div class="asset-lib-item-label">${escapeHTML(item.label)}</div>
      ${isSel ? `<div class="asset-lib-select-num">${selIdx + 1}</div>` : ''}
    </div>`;
  }).join('');
}

export function selectAssetLibraryItem(filename) {
  if (_assetLibraryCallback) {
    _assetLibraryCallback(filename);
    closeAssetLibrary();
    toast(`✓ Selected: ${filename}`, 'success');
  } else {
    // Browse mode (opened with a null callback) — just surface the filename for
    // reference and keep the modal open so the user can keep browsing.
    toast(filename, 'info');
  }
}

// ---- Multi-select (strip picker) ----

// Toggle a thumbnail in/out of the selection. Updates badges in place rather
// than rebuilding the grid so the scroll position is preserved while picking.
export function _assetLibraryToggleSelect(filename) {
  if (_assetLibrarySelected.has(filename)) _assetLibrarySelected.delete(filename);
  else _assetLibrarySelected.add(filename);
  _assetLibraryRefreshSelection();
}

// Repaint selected state + order numbers on the currently rendered thumbnails.
export function _assetLibraryRefreshSelection() {
  const order = [..._assetLibrarySelected];
  document.querySelectorAll('#asset-lib-grid .asset-lib-item').forEach(item => {
    const idx = order.indexOf(item.dataset.filename);
    let num = item.querySelector('.asset-lib-select-num');
    if (idx >= 0) {
      item.classList.add('selected');
      if (!num) {
        num = document.createElement('div');
        num.className = 'asset-lib-select-num';
        item.appendChild(num);
      }
      num.textContent = idx + 1;
    } else {
      item.classList.remove('selected');
      if (num) num.remove();
    }
  });
  _assetLibraryUpdateInsertBar();
}

// Build/refresh the bottom insert bar (count + CLEAR + INSERT STRIP).
export function _assetLibraryUpdateInsertBar() {
  const bar = document.getElementById('asset-lib-insert-bar');
  if (!bar) return;
  if (!_assetLibraryMultiSelect) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  const count = _assetLibrarySelected.size;
  const dis = count ? '' : 'disabled';
  bar.style.display = 'flex';
  bar.innerHTML = `
    <span class="asset-lib-insert-count">${count} SELECTED</span>
    <button class="btn btn-sm btn-ghost" onclick="_assetLibraryClearSelection()" ${dis}>CLEAR</button>
    <button class="btn btn-sm btn-stage" onclick="_assetLibraryInsertStrip()" ${dis}>INSERT STRIP</button>
  `;
}

export function _assetLibraryClearSelection() {
  _assetLibrarySelected.clear();
  _assetLibraryRefreshSelection();
}

// Commit the picked filenames as a single frame-inline strip shortcode.
export function _assetLibraryInsertStrip() {
  const files = [..._assetLibrarySelected];
  if (!files.length) { toast('no images selected', 'error'); return; }
  const textarea = document.getElementById('fn-body');
  const shortcode = `\n<div class="frame-inline" data-files="${files.join(',')}"></div>\n`;
  fnInsertAtCursor(textarea, shortcode, '');
  const count = files.length;
  closeAssetLibrary();
  toast(`✓ Inserted strip: ${count} frame${count !== 1 ? 's' : ''}`, 'success');
}

// ESC closes the asset library. Registered in the capture phase so it runs
// before the focus-mode ESC handler, and stops propagation so that handler
// never also fires.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('asset-library-modal').classList.contains('hidden')) {
    // The key stops here. This modal opens from the Cards composer, whose own
    // Escape exits edit mode — without this, one press closed the picker AND the
    // composer behind it. (hideOverlay defers `.hidden` by a frame on a phone,
    // so a "is anything open" check downstream cannot be relied on alone.)
    e.stopPropagation();
    e.preventDefault();
    e.stopPropagation();
    closeAssetLibrary();
  }
}, true);

// ---- Per-surface selection callbacks ----

export function assetToBuffer(filename) {
  // Check if already in buffer
  if (STATE.buffer.find(e => e.filename === filename)) {
    toast('⚠ Already in buffer: ' + filename, 'error');
    return;
  }
  STATE.buffer.unshift({
    id: uid(),
    filename: filename,
    captured_at: todayISO(),
    published_at: todayISO(),
    added_at: todayISO(),
    archived: false,
    _uploaded: true,  // already on CDN
  });
  stageChange('buffer', { id: STATE.buffer[0].id, label: `${filename} — new frame (from library)`, kind: 'add' });
  save();
  renderBuffer();
}

export function assetToArchiveForm(filename) {
  const view = document.getElementById('view-archive');
  const base = encodeURIComponent(filename.replace(/\.[^.]+$/, ''));
  const previewUrl = `${CDN_BASE}/archive/${base}-1024w.webp`;

  document.getElementById('archive-preview-wrap').innerHTML = `<img src="${previewUrl}" alt="">`;
  document.getElementById('archive-filename').textContent = filename;
  _setArchiveComposeFocus('');
  _setArchiveComposeCardFocus('');
  view.dataset.image = '';
  view.dataset.filename = filename;
  delete view.dataset.uploadState;   // image already verified on CDN
  // No hash — image already on CDN, we don't have the original bytes
  view.dataset.hash = '';
  document.getElementById('arch-hash').value = '// existing CDN image';
  archiveUpdatePreview();
  document.getElementById('arch-title').focus();
  toast('✓ Image loaded from library — fill in metadata', 'success');
}

export function assetToWallForm(filename) {
  document.getElementById('wall-url').value = filename;
  document.getElementById('wall-title').focus();
  toast('✓ Filename loaded — add title and description', 'success');
}

export function assetToHero(filename) {
  // fnHeroSet(dataURL, filename) — pass empty dataURL so it uses CDN path
  fnHeroSet('', filename);
  toast('✓ Hero set from library', 'success');
}

export function assetToPostBody(filename) {
  // Insert a frame-inline shortcode at the cursor. post.html renders this as a
  // full lighttable frame (emulsion filter, lightbox zoom/loupe) from the
  // filename alone — no buffer.json lookup needed. Comma-separate multiple
  // filenames in data-files for a horizontal strip. fnInsertAtCursor() handles
  // the re-render + autosave.
  const textarea = document.getElementById('fn-body');
  const shortcode = `\n<div class="frame-inline" data-files="${filename}"></div>\n`;
  fnInsertAtCursor(textarea, shortcode, '');
  toast('✓ Frame inserted into post body', 'success');
}

export function assetToPostVideo(filename) {
  // Insert a looping video banner shortcode at the cursor. post.html (Phase 6)
  // renders this as a full-width, muted, auto-looping <figure class="fn-video">
  // from the filename alone — the clip lives in videos/ on R2. An optional
  // caption renders beneath it (the magazine credit line).
  const textarea = document.getElementById('fn-body');
  const caption = (window.prompt('Optional caption (leave blank for none):', '') || '').trim();
  const capAttr = caption ? ` data-caption="${caption.replace(/"/g, '&quot;')}"` : '';
  const shortcode = `\n<div class="video-embed" data-src="${filename}"${capAttr}></div>\n`;
  fnInsertAtCursor(textarea, shortcode, '');
  toast('✓ Video banner inserted', 'success');
}

export function fnInsertMusic() {
  // Accepts either a bare Apple Music link (all the iPad share sheet gives you)
  // or a full <iframe> embed snippet (the laptop "Embed" button). Either way we
  // land on the same player widget — the renderers dark-theme + wrap it.
  const raw = (window.prompt('Paste an Apple Music share link or embed code:', '') || '').trim();
  if (!raw) return;
  let snippet;
  if (/<iframe[\s\S]*<\/iframe>/i.test(raw)) {
    snippet = raw;                              // full embed code — drop in as-is
  } else {
    const src = appleMusicEmbedSrc(raw);        // share link → embeddable src
    if (!src) { toast('Not an Apple Music link', 'error'); return; }
    snippet = appleMusicIframe(src);
  }
  fnInsertAtCursor(document.getElementById('fn-body'), `\n${snippet}\n`, '');
  toast('✓ Apple Music player inserted', 'success');
}
