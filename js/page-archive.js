// theArchive page. Loaded deferred, after site-common.js (cdnUrl / cdnSrcsetFor
// / cdnImgError / onViewportSettle). Externalized from an inline <script> so
// the page satisfies a strict script-src (no 'unsafe-inline').

// theArchive renders from the archive CDN section. cdnUrl / cdnSrcsetFor /
// cdnImgError / CDN_PLACEHOLDER come from site-common.js.
const CDN_SECTION = 'archive';
function cdnSrc(filename, size) { return cdnUrl(CDN_SECTION, filename, size); }
function cdnSrcset(filename) { return cdnSrcsetFor(CDN_SECTION, filename); }

// The site's calendar day (site.config.js → timezone, edge-injected as
// <meta name="site-timezone">): the same rule as the buffer page's light table
// and the server's localDay, so a date reads the same for every visitor. It
// read the visitor's own zone until 2026-10-15 (maintenance review, D1). A bare
// YYYY-MM-DD passes through; an invalid zone reads the UTC date; no meta at
// all keeps the device's day.
let _archiveDayFmt;
function localDay(iso) {
  if (!iso) return '';
  const s = String(iso);
  if (s.length <= 10 || !s.includes('T')) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d)) return s.slice(0, 10);
  if (_archiveDayFmt === undefined) {
    const tz = document.querySelector('meta[name="site-timezone"]')?.content;
    _archiveDayFmt = null;
    if (tz) {
      try {
        _archiveDayFmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        });
      } catch { _archiveDayFmt = 'utc'; }
    }
  }
  if (_archiveDayFmt === 'utc') return d.toISOString().slice(0, 10);
  if (_archiveDayFmt) return _archiveDayFmt.format(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The frame's gear line. Camera / lens / medium are free text the owner types
// in the console (they were fixed dropdowns until 2026-08-19), so any of the
// three can be blank — joining unconditionally left a dangling "|". Blank parts
// drop out; all three blank drops the line.
function gearLine(entry) {
  return [entry.camera, entry.lens, entry.medium]
    .map(v => (v || '').trim()).filter(Boolean)
    .map(escapeHtml)
    .join('<span class="pipe">|</span>');
}

// ---- Render archive card ----
function renderCard(entry) {
  const card = document.createElement('div');
  card.className = 'archive-card';
  card.dataset.entry = JSON.stringify(entry);

  const hashLine = entry.hash
    ? `<div class="archive-card-hash">${escapeHtml(entry.hash)}</div>`
    : '';

  card.innerHTML = `
    <div class="archive-card-img-wrap">
      <img
        class="archive-card-img"
        src="${cdnSrc(entry.filename, 1024)}"
        srcset="${cdnSrcset(entry.filename)}"
        sizes="(max-width: 560px) 100vw, (max-width: 1100px) 50vw, 33vw"
        alt="${escapeHtml(entry.title)}"
        loading="lazy"
        ${entry.focus ? `style="object-position:${entry.focus}"` : ''}
      >
    </div>
    <div class="archive-card-tag">
      <div class="archive-card-title">${escapeHtml(entry.title)}</div>
      ${entry.sub ? `<div class="archive-card-sub">${escapeHtml(entry.sub)}</div>` : ''}
      <div class="archive-card-location">${escapeHtml(entry.location)}</div>
      <div class="archive-card-meta">
        ${gearLine(entry)}
      </div>
      ${hashLine}
    </div>
  `;

  card.addEventListener('click', () => openLightbox(entry));
  return card;
}

// ---- Load archive data ----
async function loadArchive() {
  const grid = document.getElementById('archive-grid');
  const countLine = document.getElementById('archive-count-line');

  let entries;

  try {
    const res = await fetch('/data/archive.json');
    if (res.ok) {
      entries = await res.json();
    } else {
      throw new Error('no json');
    }
  } catch {
    // No data file at all — an un-seeded fork. Show the bundled CC0 samples so
    // the page still reads as a photography site. An *empty* file is a
    // different thing (below): that content was cleared on purpose.
    entries = getSampleData();
  }

  if (!entries.length) {
    grid.innerHTML =
      '<div class="page-empty">// ARCHIVE EMPTY' +
      '<span class="page-empty-hint">Curate frames from the buffer in the Field Console.</span></div>';
    countLine.innerHTML = '<span class="accent">0</span> FRAMES';
    return;
  }

  // Render cards
  entries.forEach((entry, i) => {
    const card = renderCard(entry);
    card.style.animationDelay = `${Math.min(i * 0.06, 0.6)}s`;
    card.classList.add('reveal');
    grid.appendChild(card);
  });

  // Count line
  // Frames with no camera recorded would otherwise leave a dangling separator.
  const cameras = [...new Set(entries.map(e => e.camera).filter(Boolean))];
  countLine.innerHTML =
    `<span class="accent">${entries.length}</span> FRAMES${cameras.length ? ` · ${cameras.join(' · ')}` : ''}`;

  // Deep linking — open lightbox for /archive/?f=<slug> (crawlable, so link
  // previews resolve the frame) or the legacy /archive#<slug> form.
  archiveEntries = entries;
  openFromUrl();
}

let archiveEntries = [];
function openFromUrl() {
  const params = new URLSearchParams(location.search);
  const slug = params.get('f') || decodeURIComponent(location.hash.slice(1) || '');
  if (!slug) return;
  const entry = archiveEntries.find(e => e.slug === slug);
  if (entry) openLightbox(entry);
}
window.addEventListener('hashchange', openFromUrl);

// ---- Load buffer strip data ----
async function loadBufferStrip() {
  const thumb = document.getElementById('buffer-thumb');
  const meta = document.getElementById('buffer-meta');

  try {
    // Fetch a tiny precomputed summary instead of the full buffer.json (~134 KB)
    // just to render one thumbnail + counts. The worker computes it from the
    // edge-cached buffer data. See /api/buffer-summary in worker.js.
    const res = await fetch('/api/buffer-summary');
    if (res.ok) {
      const s = await res.json();
      if (s.frames > 0 && s.latest) {
        thumb.onerror = () => cdnImgError(thumb);
        thumb.src = cdnSrc(s.latest.filename, 480);
        thumb.style.objectPosition = s.latest.focus || '';
        thumb.alt = 'Latest buffer frame';
        meta.textContent = `${s.frames} frames · ${s.days} days · last: ${s.lastDate}`;
        return;
      }
    }
  } catch {}

  // Fallback
  thumb.style.display = 'none';
  meta.textContent = '// AWAITING FRAMES';
}

// ---- Sample data for preview ----
function getSampleData() {
  // Neutral CC0 sample frames bundled at /assets/samples/. A fresh fork with no
  // data/archive.json renders these; the /api/cdn sample fallback (worker.js)
  // serves the images. Replace with your own frames + data/archive.json.
  const titles = ['First Shadow', 'In Flight', 'Golden Ray', 'Underpass', 'Blue Hour',
    'Interval', 'Low Fog', 'Chained', 'Reflections', 'The Shop', 'Crossing', 'Texture'];
  return titles.map((title, i) => ({
    slug: `sample-${String(i).padStart(2, '0')}`,
    filename: `sample-${String(i).padStart(2, '0')}`,
    title,
    location: 'Sample City, 2026',
    camera: 'Mirrorless', lens: i % 2 ? 'Telephoto' : 'Prime', medium: 'Digital',
  }));
}

// ---- Lightbox ----
const lightbox = document.getElementById('lightbox');
const lbImg = document.getElementById('lightbox-img');
const lbTitle = document.getElementById('lightbox-title');
const lbSub = document.getElementById('lightbox-sub');
const lbLocation = document.getElementById('lightbox-location');
const lbMeta = document.getElementById('lightbox-meta');
const lbHash = document.getElementById('lightbox-hash');
const lbClose = document.getElementById('lightbox-close');

function openLightbox(entry) {
  // Reflect slug in a query param so the open frame is shareable AND crawlable
  // by link-preview bots (which drop #fragments before fetching).
  if (entry.slug) {
    const want = `${location.pathname}?f=${encodeURIComponent(entry.slug)}`;
    if (location.pathname + location.search !== want) {
      history.replaceState(null, '', want);
    }
  }
  // Use 2048w for the full-size view
  lbImg.src = cdnSrc(entry.filename, 2048);
  lbImg.alt = entry.title;
  lbTitle.textContent = entry.title;
  lbSub.textContent = entry.sub || '';
  lbLocation.textContent = entry.location;
  lbMeta.innerHTML = gearLine(entry);
  lbHash.textContent = entry.hash || '';
  lightbox.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.classList.remove('is-open');
  document.body.style.overflow = '';
  if (location.search || location.hash) {
    history.replaceState(null, '', location.pathname);
  }
}

lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox || e.target === lbImg) closeLightbox();
});
lbClose.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// ---- Grid hover state (cross-browser, debounced to prevent gap flicker) ----
function initGridHover() {
  const grid = document.getElementById('archive-grid');
  let clearTimer = null;

  grid.addEventListener('mouseenter', (e) => {
    const card = e.target.closest('.archive-card');
    if (!card) return;
    // Cancel any pending clear
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
    // Remove active from all, set on current
    grid.querySelectorAll('.archive-card.is-active').forEach(c => c.classList.remove('is-active'));
    grid.classList.add('is-hovering');
    card.classList.add('is-active');
  }, true);

  grid.addEventListener('mouseleave', (e) => {
    const card = e.target.closest('.archive-card');
    if (!card) return;
    card.classList.remove('is-active');
    // Delay clearing so gap crossings don't flicker
    clearTimer = setTimeout(() => {
      if (!grid.querySelector('.archive-card.is-active')) {
        grid.classList.remove('is-hovering');
      }
      clearTimer = null;
    }, 80);
  }, true);
}

// ---- Mobile one-time "tap to expand" hint ----
// Archive page only. Most mobile visitors don't realize the full-viewport
// thumbnails expand to the full frame; this nudges them once, then never again.
// Gated to touch + a localStorage flag, self-dismissing, no dependencies.
function initArchiveHint() {
  const KEY = 'oaklens-archive-hint-seen';
  if (!window.matchMedia('(hover: none)').matches) return;   // touch / mobile only
  try { if (localStorage.getItem(KEY)) return; } catch {}

  const hint = document.createElement('div');
  hint.className = 'archive-hint';
  hint.setAttribute('role', 'status');
  hint.textContent = '[ tap any image to expand ]';
  document.body.appendChild(hint);

  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    document.removeEventListener('click', dismiss, true);
    hint.classList.remove('is-visible');               // fade out (CSS, ~450ms)
    setTimeout(() => hint.remove(), 500);
  };

  setTimeout(() => {
    hint.classList.add('is-visible');                  // fade in (CSS, ~450ms)
    try { localStorage.setItem(KEY, '1'); } catch {}
    document.addEventListener('click', dismiss, true); // tap anywhere dismisses early
    setTimeout(dismiss, 3500);                         // otherwise auto-dismiss after hold
  }, 1800);
}

// ---- Init ----
loadArchive();
loadBufferStrip();
initGridHover();
initArchiveHint();

// ---- Re-fit the open lightbox after the viewport settles (iPad rotation) ----
onViewportSettle(() => {
  const lb = document.getElementById('lightbox');
  if (lb && lb.classList.contains('is-open')) {
    lb.style.display = 'none';
    void lb.offsetHeight;
    lb.style.display = '';
  }
});

// CDN images route their load failures through delegation (was an inline
// onerror attr): errors bubble to this capture-phase listener, which hands
// them to the shared graceful-fallback handler. cdnImgError no-ops on
// non-CDN images, so delegating every <img> error here is safe.
window.addEventListener('error', (e) => {
  if (e.target && e.target.tagName === 'IMG') cdnImgError(e.target);
}, true);
