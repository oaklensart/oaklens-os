// Field-note post page. Loaded deferred, after lighttable.js (image-error
// delegation) and mode-toggle.js. Externalized from two inline <script> blocks
// so the page satisfies a strict script-src (no 'unsafe-inline'). The buffer-
// frame cards' image errors route through lighttable.js's error delegator.

// Hamburger
const toggle = document.getElementById('nav-toggle');
const mobileNav = document.getElementById('nav-mobile');
toggle.addEventListener('click', () => {
  toggle.classList.toggle('is-open');
  mobileNav.classList.toggle('is-open');
});
mobileNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    toggle.classList.remove('is-open');
    mobileNav.classList.remove('is-open');
  });
});

// CDN root from the worker-injected <meta name="cdn-base"> (site.config
// cdnBase, or this origin's /api/cdn R2 proxy on a fresh fork).
const CDN_ROOT = (document.querySelector('meta[name="cdn-base"]')?.content
  || `${location.origin}/api/cdn`).replace(/\/+$/, '');
const CDN = `${CDN_ROOT}/archive`;

// The site's display wordmark, also worker-injected (src/shared/site.js).
const SITE_WORDMARK = document.querySelector('meta[name="site-wordmark"]')?.content || '';

function cdnSrc(filename, size) {
  if (!filename) return '';
  const base = encodeURIComponent(filename.replace(/\.[^.]+$/, ''));
  return `${CDN}/${base}-${size}w.webp`;
}

function cdnSrcset(filename) {
  if (!filename) return '';
  const base = encodeURIComponent(filename.replace(/\.[^.]+$/, ''));
  return [
    `${CDN}/${base}-480w.webp 480w`,
    `${CDN}/${base}-1024w.webp 1024w`,
    `${CDN}/${base}-2048w.webp 2048w`,
  ].join(', ');
}

// A bare Apple Music link on its own line (the iPad share sheet gives only a
// link, no embed code) becomes a player. Expand it to an <iframe> before
// markdown runs; wrapAppleMusicEmbeds() then dark-themes + wraps it like any
// pasted embed. The only difference between a share link and an embed src is
// the host (embed.music.apple.com); songs get the compact 175px player,
// albums/playlists/stations the tall 450px one.
// FN bodies render through the site's own engine (js/markdown-engine.js) —
// the exact renderer the Field Console previews with, so preview and
// published output match by construction. It owns the Apple Music expansion
// (bare links + pasted iframes → dark-themed players) and the raw-HTML
// dialect (video, buffer-inline divs) that used to live here as helpers
// around the CDN-loaded marked.js. Loaded as an ES module online; the
// site-in-a-ZIP export ships a classicized copy that provides the global
// (dynamic import of a local module is CORS-blocked on file://).
async function loadMarkdownEngine() {
  if (window.renderMarkdown) return window;
  return import('/js/markdown-engine.js?v=5');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Get the post slug from the URL path
// e.g., /field-notes/fn-021 → "fn-021"
function getSlug() { const p = new URLSearchParams(window.location.search); if (p.get("slug")) return p.get("slug");
  const path = window.location.pathname.replace(/\/$/, '');
  const parts = path.split('/');
  return parts[parts.length - 1];
}

// Parse frontmatter from markdown
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      meta[key] = val;
    }
  });

  return { meta, body: match[2] };
}

async function loadPost() {
  const wrap = document.getElementById('post-wrap');
  const loading = document.getElementById('post-loading');
  const urlParams = new URLSearchParams(window.location.search);
  const isPreview = urlParams.get('preview') === 'draft';
  const slug = getSlug();

  if (!isPreview && (!slug || slug === 'field-notes')) {
    window.location.href = '/field-notes/';
    return;
  }

  try {
    let meta = {};
    let body = "";

    if (isPreview) {
      const draftData = localStorage.getItem("fn_preview_draft");
      if (!draftData) throw new Error("No preview draft found");
      const draft = JSON.parse(draftData);
      meta = {
        id: draft.id || 'preview',
        title: draft.title || 'Untitled',
        location: draft.location,
        date: draft.date,
        hero: draft.hero,
        buffer_dates: draft.buffer_dates
      };
      body = draft.body || '';
      localStorage.removeItem('fn_preview_draft');
    } else {
      const res = await fetch(`/posts/${slug}.md`);
      if (!res.ok) throw new Error('Post not found');

      const raw = await res.text();
      const parsed = parseFrontmatter(raw);
      meta = parsed.meta;
      body = parsed.body;
    }

    // Parse buffer_dates frontmatter field
    const bufferDates = meta.buffer_dates
      ? meta.buffer_dates.split(',').map(d => d.trim()).filter(Boolean)
      : [];

    // Update page title. The site's own name comes from the worker-injected
    // <meta name="site-wordmark"> (site.config.js), same as the server-rendered
    // <title> — the module carries no brand of its own.
    document.title = SITE_WORDMARK
      ? `${meta.title || slug} — ${SITE_WORDMARK}`
      : (meta.title || slug);

    // Hero banner — shown whenever hero is set, regardless of buffer embeds.
    // Normally `meta.hero` is a CDN filename (published posts + console previews),
    // but a draft preview may hand us a raw data:/http URL — use it as-is then.
    const heroIsRawUrl = meta.hero && /^(data:|blob:|https?:)/i.test(meta.hero);
    const heroSrc = meta.hero ? (heroIsRawUrl ? meta.hero : cdnSrc(meta.hero, 2048)) : '';
    // Inspect (loupe + minimap via the shared lightbox) needs CDN size variants,
    // so it's offered only for published heroes — not raw draft-preview URLs.
    const heroCanInspect = meta.hero && !heroIsRawUrl;
    // The ignition's red-hot snap is a second, statically-tone-mapped copy of the
    // photo (1024w is plenty for the brief peak; keeps the extra decode light).
    const heroFlashSrc = meta.hero ? (heroIsRawUrl ? heroSrc : cdnSrc(meta.hero, 1024)) : '';
    const attrEsc = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const heroCaption = `${meta.title || ''} <span class='accent'>//</span> ${formatDate(meta.date)}`;
    const heroHtml = meta.hero
      ? `<div class="post-hero">
           <button class="hero-frame" type="button"
                   ${heroCanInspect
                     ? `data-hero="${attrEsc(meta.hero)}" data-caption="${attrEsc(heroCaption)}"`
                     : 'disabled'}
                   aria-label="${heroCanInspect ? 'Inspect photo — zoom and loupe' : attrEsc(meta.title)}">
             <img class="hero-img-base" src="${heroSrc}"
                  ${heroIsRawUrl ? '' : `srcset="${cdnSrcset(meta.hero)}"`}
                  sizes="(max-width: 760px) 100vw, 760px"
                  alt="${attrEsc(meta.title)}"
                  loading="eager"
                  fetchpriority="high"
             >
             <img class="hero-flash-layer" src="${heroFlashSrc}" alt="" aria-hidden="true" loading="eager" decoding="async">
             ${heroCanInspect ? `<span class="hero-hud" aria-hidden="true">
               <span class="hero-hud-corner tl"></span>
               <span class="hero-hud-corner tr"></span>
               <span class="hero-hud-corner bl"></span>
               <span class="hero-hud-corner br"></span>
               <span class="hero-hud-label">&#9678; Inspect</span>
             </span>` : ''}
           </button>
         </div>`
      : '';

    // Inject preload for hero as early as possible (skip for data: URLs — already inline)
    if (meta.hero && !/^data:/i.test(meta.hero)) {
      const preload = document.createElement('link');
      preload.rel = 'preload';
      preload.as = 'image';
      preload.href = heroSrc;
      document.head.appendChild(preload);
    }

    // Render markdown — same engine, same output as the console preview
    const { renderMarkdown } = await loadMarkdownEngine();
    const rendered = renderMarkdown(body);

    wrap.innerHTML = `
      <header class="post-header reveal">
        <div class="post-fn-id">FIELD NOTE // ${meta.id || (isPreview ? 'PREVIEW' : slug)}</div>
        <h1 class="post-title">${meta.title || (isPreview ? 'Untitled Preview' : slug)}</h1>
        <div class="post-meta">
          ${meta.location || ''}<span class="sep">·</span>${formatDate(meta.date)}
        </div>
      </header>
      ${heroHtml}
      ${bufferDates.length ? '<section class="buffer-embed" id="buffer-embed"></section>' : ''}
      <div class="post-body reveal reveal-d2">
        ${rendered}
      </div>
      <a href="/field-notes" class="post-back reveal reveal-d3">
        <span class="arrow">←</span> ALL FIELD NOTES
      </a>
    `;

    // ---- Hero light-table: ignition on load + click-to-inspect (loupe + minimap) ----
    // Reuses the shared lightbox bridge so the hero gets the exact zoom/loupe/
    // mini-map experience as the buffer's contact frames — no bespoke viewer.
    (function() {
      const frame = wrap.querySelector('.hero-frame');
      if (!frame) return;
      const img = frame.querySelector('img');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Power-on ignition once the pixels are ready (skip under reduced-motion).
      if (img && !reduce) {
        const ignite = () => {
          frame.classList.add('igniting');
          setTimeout(() => frame.classList.remove('igniting'), 1200);
        };
        if (img.complete && img.naturalWidth) ignite();
        else img.addEventListener('load', ignite, { once: true });
      }

      // Click → shared lightbox with loupe + minimap (published heroes only;
      // disabled draft-preview buttons have no data-hero and fall through).
      const heroFile = frame.dataset.hero;
      if (heroFile && window.LightTable) {
        LightTable.initLoupe(document);
        LightTable.initKeyboardNav(document);
        frame.addEventListener('click', (e) => {
          // Landscape frames zoom a touch less so more of the photo stays in
          // view; portraits keep the tighter preset (they fill the viewport).
          const landscape = img && img.naturalWidth && img.naturalHeight
            ? img.naturalWidth > img.naturalHeight : false;
          LightTable.open([heroFile], 0, null, {
            meta: frame.dataset.caption || '',
            counter: '',
            zoomFirst: true,            // one click in (loupe + mini-map), one click out
            zoomLevel: landscape ? 2.3 : 2.5,
            theme: 'blog',             // darkroom-red safelight ambiance
            originEl: img,             // FLIP back onto the hero on close (its "shelf")
            originX: e.clientX,        // zoom into the clicked point, not the center
            originY: e.clientY,
          });
        });
      }
    })();

    // ---- Fetch buffer.json once for all embed types ----
    const inlineDateEls = [...document.querySelectorAll('.buffer-date[data-date]')];
    const inlineFrameEls = [...document.querySelectorAll('.buffer-inline')];
    const frameRefEls = [...document.querySelectorAll('.frame-ref')];
    const needsBuffer = bufferDates.length || inlineDateEls.length || inlineFrameEls.length
      || frameRefEls.length;

    let allEntries = null;
    let frameNumbers = null;

    if (needsBuffer) {
      const bufRes = await fetch('/data/buffer.json');
      allEntries = await bufRes.json();
      frameNumbers = LightTable.assignFrameNumbers(allEntries);
    }

    // ---- Phase 2: Buffer hero embed (from frontmatter buffer_dates) ----
    if (bufferDates.length && allEntries) {
      const embedContainer = document.getElementById('buffer-embed');

      bufferDates.forEach(date => {
        const dayEntries = allEntries.filter(e =>
          (e.captured_at || e.published_at || '').startsWith(date)
        );
        if (!dayEntries.length) return;

        const blockHtml = LightTable.renderDayBlock(dayEntries, frameNumbers);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = blockHtml;
        embedContainer.appendChild(wrapper.firstElementChild);
      });

      const { dayBlocks, igniteButtons, state } = LightTable.initLightTable(embedContainer);
      LightTable.initLightbox(embedContainer);
      LightTable.initLoupe(embedContainer);
      LightTable.initKeyboardNav(embedContainer);
      LightTable.runIgnitionSequence(dayBlocks, igniteButtons, state);

      embedContainer.querySelectorAll('.day-block').forEach(block => {
        const date = block.dataset.date;
        const link = document.createElement('a');
        link.href = `/archive/buffer#${date}`;
        link.className = 'buffer-view-full';
        link.textContent = '→ VIEW FULL DAY ON BUFFER';
        block.appendChild(link);
      });
    }

    // ---- Phase 3: Inline buffer-date tags in post body ----
    if (inlineDateEls.length && allEntries) {
      inlineDateEls.forEach(el => {
        const date = el.dataset.date;
        const dayEntries = allEntries.filter(e =>
          (e.captured_at || e.published_at || '').startsWith(date)
        );
        if (!dayEntries.length) {
          const empty = document.createElement('div');
          empty.className = 'buffer-date-empty';
          empty.textContent = `// NO FRAMES: ${date}`;
          el.replaceWith(empty);
          return;
        }
        const blockHtml = LightTable.renderDayBlock(dayEntries, frameNumbers);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = blockHtml;
        const block = wrapper.firstElementChild;
        const viewLink = document.createElement('a');
        viewLink.href = `/archive/buffer#${date}`;
        viewLink.className = 'buffer-view-full';
        viewLink.textContent = '→ VIEW FULL DAY ON BUFFER';
        block.appendChild(viewLink);
        el.replaceWith(block);
      });

      const postBody = document.querySelector('.post-body');
      if (postBody && postBody.querySelector('.day-block')) {
        const { dayBlocks, igniteButtons, state } = LightTable.initLightTable(postBody);
        LightTable.initLightbox(postBody);
        LightTable.initLoupe(postBody);
        LightTable.initKeyboardNav(postBody);
        LightTable.runIgnitionSequence(dayBlocks, igniteButtons, state);
      }
    }

    // ---- Phase 4: Inline frame strips ----
    if (inlineFrameEls.length && allEntries) {
      const entryMap = new Map(allEntries.map(e => [e.id, e]));

      inlineFrameEls.forEach(el => {
        const ids = el.dataset.frames.split(',').map(s => s.trim()).filter(Boolean);
        const entries = ids.map(id => entryMap.get(id)).filter(Boolean);
        if (!entries.length) { el.remove(); return; }

        const stripHtml = LightTable.renderFrameStrip(entries, frameNumbers);
        const wrapper = document.createElement('div');
        wrapper.className = 'buffer-inline-container lit';
        wrapper.innerHTML = stripHtml;
        el.replaceWith(wrapper);
      });

      document.querySelectorAll('.buffer-inline-container').forEach(c => {
        LightTable.initLightbox(c);
        LightTable.initLoupe(c);
      });
    }

    // ---- Frame refs: f#234 citations → buffer deep links + hover card ----
    // The markdown engine emits unresolved <a class="frame-ref" data-frame="N">
    // anchors; here the number resolves through assignFrameNumbers (the same
    // positional map the buffer renders with) to the entry's stable id, and the
    // href becomes the buffer's crawlable ?f= deep link. Dark frames DO resolve
    // — citations stay valid forever; their card shows the tombstone. Numbers
    // that resolve to nothing degrade to a plain "frame not found" span.
    if (frameRefEls.length && allEntries) {
      const entryById = new Map(allEntries.map(e => [e.id, e]));
      const entryByNum = new Map();
      frameNumbers.forEach((num, id) => entryByNum.set(num, entryById.get(id)));
      initFrameRefs(frameRefEls, entryByNum);
    } else if (frameRefEls.length) {
      frameRefEls.forEach(el => degradeFrameRef(el));
    }

    function degradeFrameRef(el) {
      const span = document.createElement('span');
      span.className = 'frame-ref-missing';
      span.title = 'frame not found';
      span.textContent = el.textContent;
      el.replaceWith(span);
    }

    function initFrameRefs(refEls, entryByNum) {
      const touch = window.matchMedia('(hover: none)').matches;
      const bufferHref = entry => `/archive/buffer/?f=${encodeURIComponent(entry.id)}`;

      // One slide-mount card for the whole page, repositioned per link.
      const card = document.createElement('div');
      card.className = 'frame-ref-card';
      document.body.appendChild(card);
      let activeRef = null;
      let showTimer = null;
      let closeTimer = null;

      function buildCard(entry, num) {
        const pad = String(num).padStart(4, '0');
        const day = (entry.captured_at || entry.published_at || '').slice(0, 10).replace(/-/g, '·');
        const windowHtml = entry.dark
          ? `<span class="dark-glyph" aria-hidden="true">//</span><span class="frc-dark-label">DARK FRAME</span>`
          : `<img src="${cdnSrc(entry.filename, 480)}" alt=""${entry.focus ? ` style="object-position:${entry.focus}"` : ''}>`;
        card.innerHTML = `<div class="frc-window">${windowHtml}</div>
          <div class="frc-caption">FRAME ${pad} <span class="accent">//</span> ${day}</div>
          <a class="frc-open" href="${bufferHref(entry)}">OPEN IN BUFFER →</a>`;
      }

      function openCard(el, entry, num) {
        clearTimeout(closeTimer);
        buildCard(entry, num);
        // Below the link, clamped to the viewport; above when out of room.
        const r = el.getBoundingClientRect();
        const cardW = 240;
        const left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - cardW - 8));
        card.style.left = left + 'px';
        const estH = 220;
        const below = r.bottom + 8 + estH < window.innerHeight;
        card.style.top = (window.scrollY + (below ? r.bottom + 8 : r.top - estH - 8)) + 'px';
        card.classList.add('is-open');
        activeRef = el;
      }

      function closeCard() {
        clearTimeout(showTimer);
        clearTimeout(closeTimer);
        card.classList.remove('is-open');
        activeRef = null;
      }

      const scheduleClose = () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(closeCard, 140);
      };

      refEls.forEach(el => {
        const num = parseInt(el.dataset.frame, 10);
        const entry = entryByNum.get(num);
        if (!entry) { degradeFrameRef(el); return; }
        el.href = bufferHref(entry);

        if (touch) {
          // First tap opens the card (with its explicit OPEN IN BUFFER action);
          // a tap anywhere outside closes it. The link never navigates blind.
          el.addEventListener('click', e => {
            e.preventDefault();
            if (activeRef === el) { closeCard(); return; }
            openCard(el, entry, num);
          });
        } else {
          // Desktop: hover with a short delay; keyboard focus shows it too
          // (a11y). Click navigates — the card is a preview, not a gate.
          el.addEventListener('mouseenter', () => {
            // Cancel any pending close from the ref just left — otherwise its
            // 140ms close fires mid-way through this ref's 150ms open delay.
            clearTimeout(closeTimer);
            clearTimeout(showTimer);
            showTimer = setTimeout(() => openCard(el, entry, num), 150);
          });
          el.addEventListener('mouseleave', () => { clearTimeout(showTimer); scheduleClose(); });
          el.addEventListener('focus', () => openCard(el, entry, num));
          el.addEventListener('blur', scheduleClose);
        }
      });

      // Moving onto the card keeps it open (and its buffer link clickable).
      card.addEventListener('mouseenter', () => clearTimeout(closeTimer));
      card.addEventListener('mouseleave', scheduleClose);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && activeRef) closeCard(); });
      document.addEventListener('click', e => {
        if (activeRef && !card.contains(e.target) && !e.target.closest('.frame-ref')) closeCard();
      }, true);
    }

    // ---- Phase 5: Asset frame-inline strips (filename-based, no buffer.json needed) ----
    (function() {
      const assetFrameEls = [...document.querySelectorAll('.frame-inline[data-files]')];
      if (!assetFrameEls.length) return;

      assetFrameEls.forEach(el => {
        const filenames = el.dataset.files.split(',').map(s => s.trim()).filter(Boolean);
        if (!filenames.length) { el.remove(); return; }

        // Synthetic entries — frame-inline works from the filename alone, so fake
        // the { id, filename, … } shape renderFrameStrip expects (no dates/archive).
        const syntheticEntries = filenames.map((fname, i) => ({
          id: 'asset-' + i + '-' + fname.replace(/\W/g, ''),
          filename: fname,
          captured_at: null,
          published_at: null,
          archived: false,
        }));

        // Sequential 1-based frame numbers
        const frameNumbers = new Map();
        syntheticEntries.forEach((e, i) => frameNumbers.set(e.id, i + 1));

        const stripHtml = LightTable.renderFrameStrip(syntheticEntries, frameNumbers);
        const wrapper = document.createElement('div');
        wrapper.className = 'buffer-inline-container frame-strip lit';
        wrapper.innerHTML = stripHtml;
        el.replaceWith(wrapper);
      });

      // Wire up lightbox, loupe, and keyboard nav for the new strips
      document.querySelectorAll('.buffer-inline-container').forEach(c => {
        LightTable.initLightbox(c);
        LightTable.initLoupe(c);
        LightTable.initKeyboardNav(c);
      });

      // Wire up arrow navigation + keyboard for frame strips
      document.querySelectorAll('.buffer-inline-container.frame-strip').forEach(initFrameStripArrows);
    })();

    // ---- Frame strip arrow navigation + keyboard ----
    function initFrameStripArrows(container) {
      const nav = container.querySelector('.frame-strip-nav');
      if (!nav) return;

      const grid = nav.querySelector('.contact-grid');
      const leftBtn = nav.querySelector('.strip-arrow-left');
      const rightBtn = nav.querySelector('.strip-arrow-right');
      const frames = [...grid.querySelectorAll('.frame')];
      if (!grid || !leftBtn || !rightBtn || !frames.length) return;

      // How far to scroll per click — roughly 2 frames
      const scrollStep = () => {
        const frameW = frames[0].offsetWidth + 5; // frame width + gap
        return frameW * 2;
      };

      // ---- Boundary detection ----
      function updateArrows() {
        const sl = grid.scrollLeft;
        const maxScroll = grid.scrollWidth - grid.clientWidth;

        // If everything fits, hide both arrows
        if (maxScroll <= 1) {
          leftBtn.classList.add('hidden');
          rightBtn.classList.add('hidden');
          return;
        }
        leftBtn.classList.remove('hidden');
        rightBtn.classList.remove('hidden');

        // Dim at boundaries (2px tolerance)
        leftBtn.classList.toggle('at-end', sl <= 2);
        rightBtn.classList.toggle('at-end', sl >= maxScroll - 2);
      }

      // ---- Click handlers ----
      leftBtn.addEventListener('click', () => {
        grid.scrollBy({ left: -scrollStep(), behavior: 'smooth' });
      });
      rightBtn.addEventListener('click', () => {
        grid.scrollBy({ left: scrollStep(), behavior: 'smooth' });
      });

      // ---- Scroll listener for boundary updates ----
      grid.addEventListener('scroll', updateArrows, { passive: true });

      // ---- Initial state ----
      // Defer to let layout settle after replaceWith
      requestAnimationFrame(updateArrows);

      // ---- Keyboard navigation on frames ----
      grid.addEventListener('keydown', e => {
        const focused = document.activeElement;
        if (!focused || !grid.contains(focused)) return;
        const idx = frames.indexOf(focused);
        if (idx === -1) return;

        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = frames[idx + 1];
          if (next) {
            next.focus();
            next.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const prev = frames[idx - 1];
          if (prev) {
            prev.focus();
            prev.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          focused.click(); // opens lightbox via existing initLightbox handler
        } else if (e.key === 'Escape') {
          e.preventDefault();
          focused.blur();
        }
      });
    }

    // ---- Phase 6: Inline video banners (<div class="video-embed" data-src>) ----
    // Filename-based, no buffer.json needed. Renders a full-width, muted,
    // auto-looping figure. The clip lives in videos/ on the CDN; an optional
    // poster (videos/posters/{base}.webp) prevents a blank flash before autoplay.
    (function() {
      const VIDEO_CDN = `${CDN_ROOT}/videos`;
      const videoEls = [...document.querySelectorAll('.video-embed[data-src]')];
      videoEls.forEach(el => {
        const file = (el.dataset.src || '').trim();
        if (!file) { el.remove(); return; }
        const caption = (el.dataset.caption || '').trim();
        const base = file.replace(/\.[^.]+$/, '');

        const fig = document.createElement('figure');
        fig.className = 'fn-video';

        const vid = document.createElement('video');
        vid.src = `${VIDEO_CDN}/${encodeURIComponent(file)}`;
        vid.poster = `${VIDEO_CDN}/posters/${encodeURIComponent(base)}.webp`;
        vid.muted = true;
        vid.loop = true;
        vid.autoplay = true;
        vid.preload = 'metadata';
        // Attributes (not just properties) — Safari needs `muted` present in the
        // markup to honor muted autoplay.
        vid.setAttribute('muted', '');
        vid.setAttribute('playsinline', '');
        vid.setAttribute('webkit-playsinline', '');
        fig.appendChild(vid);

        if (caption) {
          const cap = document.createElement('figcaption');
          cap.textContent = caption;
          fig.appendChild(cap);
        }

        el.replaceWith(fig);
        // Muted autoplay normally starts on its own; nudge it once in the DOM.
        if (vid.play) vid.play().catch(() => {});
      });
    })();

    // ---- Phase 7: Inline audio (<div class="audio-embed" data-slug>) ----
    // The shortcode carries ONLY a slug: title, subtitle, duration and the
    // pre-measured waveform all come from data/audio.json, so a track renamed
    // in the console is renamed everywhere it was ever embedded — there is one
    // registry and the post references it.
    //
    // Consecutive shortcodes collapse into a numbered TRACKLIST; a lone one
    // stays a standalone player. That is the whole "an EP is a field note"
    // idea, and it costs the author nothing but dropping tracks in a row.
    await (async function() {
      const audioEls = [...document.querySelectorAll('.audio-embed[data-slug]')];
      if (!audioEls.length) return;

      const AP = window.AudioPlayer;
      if (!AP || typeof AP.create !== 'function') {
        // Player script missing — drop the placeholders rather than leaving
        // empty divs punched through the prose.
        audioEls.forEach(el => el.remove());
        return;
      }

      let registry = [];
      try {
        const res = await fetch('/data/audio.json');
        if (res.ok) registry = await res.json();
      } catch { /* no registry — every shortcode resolves to nothing below */ }

      if (isPreview) {
        try {
          const state = JSON.parse(localStorage.getItem('oaklens_console_v01') || '{}');
          if (Array.isArray(state.audio)) {
            const known = new Set((registry || []).map(t => t && t.slug));
            state.audio.forEach(t => {
              if (t && t.slug && !known.has(t.slug)) registry.push(t);
            });
          }
        } catch {}
      }

      const bySlug = new Map(
        (Array.isArray(registry) ? registry : [])
          .filter(t => t && t.slug && t.filename)
          .map(t => [t.slug, t])
      );

      const mount = (host, track, variant) => host.appendChild(AP.create({
        src: track.filename,
        peaks: AP.peaksFromString(track.peaks),
        duration: track.duration,
        variant,
        title: track.title || '',
      }).root);

      const metaLine = (track) => [track.sub, AP.durationLabel(track.duration)]
        .filter(Boolean).join(' · ');

      // Group BEFORE resolving, so an unresolvable slug doesn't silently split
      // a tracklist in two — it drops out of its run instead.
      for (const run of AP.groupAdjacent(audioEls)) {
        const tracks = run.map(el => bySlug.get((el.dataset.slug || '').trim()))
          .filter(Boolean);
        if (!tracks.length) { run.forEach(el => el.remove()); continue; }

        if (tracks.length === 1) {
          const fig = document.createElement('figure');
          fig.className = 'fn-audio';
          const t = tracks[0];
          const head = document.createElement('div');
          head.className = 'fn-audio-head';
          const title = document.createElement('a');
          title.className = 'fn-audio-title';
          title.href = `/listen/?a=${encodeURIComponent(t.slug)}`;
          title.textContent = t.title || 'Untitled';
          head.appendChild(title);
          const sub = metaLine(t);
          if (sub) {
            const s = document.createElement('div');
            s.className = 'fn-audio-sub';
            s.textContent = sub;
            head.appendChild(s);
          }
          fig.appendChild(head);
          mount(fig, t, 'full');
          run[0].replaceWith(fig);
          run.slice(1).forEach(el => el.remove());
          continue;
        }

        const list = document.createElement('div');
        list.className = 'fn-tracklist';
        tracks.forEach((t, i) => {
          const row = document.createElement('div');
          row.className = 'fn-track';

          const num = document.createElement('div');
          num.className = 'fn-track-num';
          num.textContent = String(i + 1).padStart(2, '0');
          row.appendChild(num);

          const main = document.createElement('div');
          main.className = 'fn-track-main';
          const title = document.createElement('a');
          title.className = 'fn-track-title';
          title.href = `/listen/?a=${encodeURIComponent(t.slug)}`;
          title.textContent = t.title || 'Untitled';
          main.appendChild(title);
          const sub = metaLine(t);
          if (sub) {
            const s = document.createElement('div');
            s.className = 'fn-track-sub';
            s.textContent = sub;
            main.appendChild(s);
          }
          mount(main, t, 'row');
          row.appendChild(main);
          list.appendChild(row);
        });
        run[0].replaceWith(list);
        run.slice(1).forEach(el => el.remove());
      }
    })();

  } catch (err) {
    wrap.innerHTML = isPreview
      ? `<div class="post-error">
           // PREVIEW DRAFT NOT FOUND<br><br>
           No draft data in localStorage. Open a draft in the console and click PREVIEW again.
         </div>`
      : `<div class="post-error">
           // POST NOT FOUND: ${slug}<br><br>
           <a href="/field-notes" style="color:var(--gray-500);">← back to FN//Blog</a>
         </div>`;
  }
}

loadPost();

// ---- Scroll-progress fallback (was a second inline <script>) ----
if (!CSS.supports('animation-timeline', 'scroll()')) {
  const bar = document.querySelector('.scroll-progress-bar');
  if (bar) {
    bar.style.animation = 'none';
    window.addEventListener('scroll', () => {
      const scrollTop = document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? scrollTop / docHeight : 0;
      bar.style.transform = `scaleX(${progress})`;
    }, { passive: true });
  }
}
