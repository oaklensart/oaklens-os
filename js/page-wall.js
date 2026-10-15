// theWall / Photo Lab page. Loaded deferred, after site-common.js (submitGTD,
// cdnUrl / cdnImgError, onViewportSettle). Externalized from an inline
// <script> so the page satisfies a strict script-src (no 'unsafe-inline').

// The site's own identity, from the worker-injected meta tags
// (src/shared/site.js siteMetaTags) — share sheets and download filenames carry
// the brand, and this module must not.
const SITE_WORDMARK = document.querySelector('meta[name="site-wordmark"]')?.content || '';
// Filename-safe prefix for downloads: "STUDIO_Title_MONO.jpg". The console's
// sanitizeWallTitle strips the same prefix when such a file is re-uploaded.
const SITE_FILE_PREFIX = (document.querySelector('meta[name="site-name"]')?.content || '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '');

// Locks THE DROP button after a successful lab signup (replaces the old
// btn.onclick = null, which strict CSP forbids).
let labLocked = false;
// submitGTD comes from site-common.js; the Photo-Lab-specific wrappers below
// build on it.
function toggleLabGTD() {
  if (labLocked) return;
  var panel = document.getElementById('gtd-lab-panel');
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'flex';
  if (!open) document.getElementById('gtd-lab-email').focus();
}

function submitLabGTD() {
  submitGTD('gtd-lab-email','gtd-lab-form','gtd-lab-ok','gtd-lab-err','photolab');
  setTimeout(function() {
    var btn = document.getElementById('gtd-lab-btn');
    if (btn && document.getElementById('gtd-lab-ok').style.display !== 'none') {
      btn.innerHTML = '<span class="gtd-dot gtd-dot--solid" style="margin-right:6px;"></span>LOCKED IN';
      labLocked = true;   // was btn.onclick = null (no inline handlers under strict CSP)
      btn.style.cursor = 'default';
    }
  }, 500);
}

document.getElementById('gtd-wall-email').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); document.querySelector('#gtd-wall-form .gtd-submit').click(); }
});
document.getElementById('gtd-lab-email').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); submitLabGTD(); }
});

// theWall renders from the wallpaper CDN section. cdnUrl / cdnImgError /
// CDN_PLACEHOLDER come from site-common.js.
const CDN_SECTION = 'wallpaper';
let wallpapers = [];
let currentIdx = 0;
let currentProcess = 'color';

function cdnSrc(filename, size) { return cdnUrl(CDN_SECTION, filename, size); }

function cdnFull(filename) {
  if (!filename) return '';
  const root = `${cdnRoot()}/${CDN_SECTION}`;
  // Pre-fullres entries store filename as .webp — strip and assume original is .jpg
  if (filename.endsWith('.webp')) {
    const base = encodeURIComponent(filename.replace(/\.webp$/, ''));
    return `${root}/full/${base}.jpg`;
  }
  // fullres entries store the original filename with its actual extension
  return `${root}/full/${encodeURIComponent(filename)}`;
}

// ---- Load wallpapers ----
async function loadWall() {
  const grid = document.getElementById('wall-grid');
  const countEl = document.getElementById('wall-count');

  try {
    const res = await fetch('/data/wallpapers.json');
    if (res.ok) {
      wallpapers = await res.json();
    } else throw new Error('no json');
  } catch {
    // Missing data file — an un-seeded fork gets the bundled CC0 samples.
    wallpapers = getSampleWallpapers();
  }

  // An empty file used to fall through to the samples too, which meant clearing
  // your wallpapers made sample photos appear in their place — indistinguishable
  // from a delete that silently failed. Empty now reads as empty.
  if (!wallpapers.length) {
    grid.innerHTML =
      '<div class="page-empty">// NO WALLPAPERS YET' +
      '<span class="page-empty-hint">Publish frames to the wall from the Field Console.</span></div>';
    countEl.innerHTML = '<span class="accent">0</span> WALLPAPERS';
    return;
  }

  wallpapers.forEach((w, i) => {
    const card = document.createElement('div');
    card.className = 'wall-card';
    card.dataset.index = i;

    const badgeHtml = w.isNew
      ? '<div class="wall-badge"><span>NEW</span></div>'
      : '';

    card.innerHTML = `
      ${badgeHtml}
      <img src="${cdnSrc(w.filename || w.src, 1024)}" alt="${escapeHtml(w.title)}" loading="lazy" ${w.focus ? `style="object-position:${w.focus}"` : ''}>
      <div class="wall-card-info">
        <div class="wall-card-info-title">${escapeHtml(w.title)}</div>
      </div>
    `;

    card.addEventListener('click', () => openLab(i));
    grid.appendChild(card);
  });

  const newCount = wallpapers.filter(w => w.isNew).length;
  countEl.innerHTML = `<span class="accent">${wallpapers.length}</span> WALLPAPERS${newCount ? ` · ${newCount} NEW` : ''}`;

  initGridHover();
}

// ---- Grid hover ----
function initGridHover() {
  const grid = document.getElementById('wall-grid');
  let clearTimer = null;

  grid.addEventListener('mouseenter', (e) => {
    const card = e.target.closest('.wall-card');
    if (!card) return;
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
    grid.querySelectorAll('.wall-card.is-active').forEach(c => c.classList.remove('is-active'));
    grid.classList.add('is-hovering');
    card.classList.add('is-active');
  }, true);

  grid.addEventListener('mouseleave', (e) => {
    const card = e.target.closest('.wall-card');
    if (!card) return;
    card.classList.remove('is-active');
    clearTimer = setTimeout(() => {
      if (!grid.querySelector('.wall-card.is-active')) {
        grid.classList.remove('is-hovering');
      }
      clearTimer = null;
    }, 80);
  }, true);
}

// ---- Photo Lab ----
const lab = document.getElementById('lab');
const labImg = document.getElementById('lab-img');
const labTitle = document.getElementById('lab-title');
const labDesc = document.getElementById('lab-desc');
const labSpecs = document.getElementById('lab-specs');
const labDownload = document.getElementById('lab-download');

// The viewer shows the original. When the original is not there (a saved copy
// made without wallpaper originals, or an original never uploaded) it steps
// down through the display sizes instead of leaving the panel empty, then
// settles on the placeholder. Its own chain, not cdnImgError's: that one
// retries the same URL first and knows nothing of an original's sizes.
let labSteps = [];
let labOnOriginal = true;
labImg.addEventListener('error', () => {
  labOnOriginal = false;
  labImg.src = labSteps.shift() || CDN_PLACEHOLDER;
});

function openLab(idx) {
  currentIdx = idx;
  const w = wallpapers[idx];
  const fullUrl = cdnFull(w.fullres || w.filename);

  labSteps = [2048, 1024, 480].map((size) => cdnSrc(w.filename, size)).filter(Boolean);
  labOnOriginal = true;
  labImg.src = fullUrl;
  labImg.style.filter = 'none';
  labTitle.textContent = w.title;
  labDesc.textContent = w.desc || '';
  labSpecs.textContent = '';
  labDownload.href = fullUrl;

  // Reset process buttons
  document.querySelectorAll('.lab-process-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.lab-process-btn[data-filter="none"]').classList.add('active');
  currentProcess = 'color';

  lab.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  // Get image dimensions once loaded
  labImg.onload = () => {
    labSpecs.textContent = labOnOriginal ? `RAW: ${labImg.naturalWidth} × ${labImg.naturalHeight}px` : '';
  };
}

function closeLab() {
  lab.classList.remove('is-open');
  document.body.style.overflow = '';
}

document.getElementById('lab-close').addEventListener('click', closeLab);
lab.addEventListener('click', (e) => {
  if (e.target === lab) closeLab();
});

// Arrow key navigation
document.addEventListener('keydown', (e) => {
  if (!lab.classList.contains('is-open')) return;
  if (e.key === 'Escape') closeLab();
  if (e.key === 'ArrowRight') openLab((currentIdx + 1) % wallpapers.length);
  if (e.key === 'ArrowLeft') openLab((currentIdx - 1 + wallpapers.length) % wallpapers.length);
});

// Process filter
function setProcess(btn) {
  document.querySelectorAll('.lab-process-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  labImg.style.filter = btn.dataset.filter;
  currentProcess = btn.dataset.process || 'color';
}

// Download with current filter baked into canvas (all modes, Safari-safe)
function downloadWallpaper(e) {
  e.preventDefault();
  const w = wallpapers[currentIdx];
  if (!w) return false;
  // The file the viewer is actually showing: the original, or the display
  // size it stepped down to when there is no original to fetch.
  const fullUrl = labOnOriginal ? cdnFull(w.fullres || w.filename) : (labImg.currentSrc || labImg.src);
  const baseName = (w.filename || w.src || 'wallpaper').replace(/\.[^.]+$/, '');
  const fileName = (process, ext) => (SITE_FILE_PREFIX
    ? `${SITE_FILE_PREFIX}_${baseName}_${process}.${ext}`
    : `${baseName}_${process}.${ext}`);

  // A saved copy (file://) has no origin, so no picture can be drawn onto a
  // canvas and read back, and no browser will force a download of one local
  // file from another (Chrome and WebKit both just navigate to it). So open
  // the file the viewer shows, in colour, in its own tab, where the visitor
  // can save it and the Wall stays where they left it.
  if (location.protocol === 'file:') {
    const a = document.createElement('a');
    a.href = labImg.currentSrc || labImg.src;
    a.target = '_blank';
    a.rel = 'noopener';
    a.download = fileName('COLOR', (a.href.match(/\.([a-z0-9]+)(?:[?#]|$)/i) || [, 'jpg'])[1].toLowerCase());
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return false;
  }

  const filterMap = {
    color: 'none',
    noir:  'grayscale(100%) contrast(1.1)',
    dim:   'brightness(0.55) contrast(1.15) saturate(0.8)',
  };
  const cssFilter = filterMap[currentProcess] || 'none';

  const btn = document.getElementById('lab-download');
  const originalText = btn.textContent.trim();
  btn.textContent = 'PROCESSING…';

  const img = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');

    // Set filter BEFORE drawing — Safari requires this order
    if (cssFilter && cssFilter !== 'none') {
      ctx.filter = cssFilter;
    }
    ctx.drawImage(img, 0, 0);
    ctx.filter = 'none';

    canvas.toBlob(blob => {
      if (!blob) {
        btn.textContent = originalText;
        alert('Download failed — try right-clicking the image instead.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName(currentProcess.toUpperCase(), 'jpg');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      btn.textContent = originalText;
    }, 'image/jpeg', 0.92);
  };

  img.onerror = () => {
    btn.textContent = originalText;
    alert('Download failed — could not load image. Please try again.');
  };

  // Cache-bust to force a fresh CORS-credentialed load
  img.src = fullUrl + (fullUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
  return false;
}

// Share
function shareWallpaper() {
  const w = wallpapers[currentIdx];
  const url = window.location.origin + '/wall#' + (w.id || currentIdx);

  if (navigator.share) {
    navigator.share({
      title: SITE_WORDMARK ? w.title + ' — ' + SITE_WORDMARK : w.title,
      text: w.title + ': ' + (w.desc || (SITE_WORDMARK ? 'Free wallpaper from ' + SITE_WORDMARK : 'Free wallpaper')),
      url: url,
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('lab-share');
      btn.textContent = 'COPIED';
      setTimeout(() => btn.textContent = 'SHARE', 1500);
    });
  }
}

// ---- Sample data ----
function getSampleWallpapers() {
  // Neutral CC0 sample frames bundled at /assets/samples/ (served via the
  // /api/cdn sample fallback in worker.js). Replace with your own wallpapers.
  const items = [
    ['Nocturne', 'Vertical Lines', true], ['In Flight', 'Wings Over Water', true],
    ['Golden Ray', 'Light Study', false], ['Underpass', 'Concrete & Steel', false],
    ['Blue Hour', 'Signage', false], ['Interval', 'Six', false],
    ['Low Fog', 'Soft Horizon', false], ['Chained', 'Still Life', false],
    ['Reflections', 'Glass Facade', false], ['The Shop', 'Interior', false],
    ['Crossing', 'Motion', false], ['Texture', 'Surface Study', false],
  ];
  return items.map(([title, desc, isNew], i) => ({
    id: `w${i + 1}`, title, desc, filename: `sample-${String(i).padStart(2, '0')}`, isNew,
  }));
}

// ---- Init ----
loadWall();

// ---- Re-fit the open Photo Lab after the viewport settles (iPad rotation) ----
onViewportSettle(() => {
  if (lab.classList.contains('is-open')) {
    lab.style.display = 'none';
    void lab.offsetHeight;
    lab.style.display = '';
  }
});

// ---- Control wiring (was inline on* handlers) ----
document.querySelector('#gtd-wall-form .gtd-submit')
  ?.addEventListener('click', () => submitGTD('gtd-wall-email', 'gtd-wall-form', 'gtd-wall-ok', 'gtd-wall-err', 'wall'));
document.querySelectorAll('.lab-process-btn')
  .forEach((b) => b.addEventListener('click', () => setProcess(b)));
document.getElementById('lab-download')?.addEventListener('click', downloadWallpaper);
document.getElementById('lab-share')?.addEventListener('click', shareWallpaper);
document.getElementById('gtd-lab-btn')?.addEventListener('click', toggleLabGTD);
document.querySelector('#gtd-lab-form .gtd-submit')?.addEventListener('click', submitLabGTD);

// CDN image load failures route to the shared graceful fallback (was inline
// onerror). Errors bubble to this capture-phase listener; cdnImgError no-ops
// on non-CDN images.
window.addEventListener('error', (e) => {
  if (e.target === labImg) return;  // the viewer runs its own chain (openLab)
  if (e.target && e.target.tagName === 'IMG') cdnImgError(e.target);
}, true);

