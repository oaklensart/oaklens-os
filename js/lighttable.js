/* ============================================
   LIGHTTABLE.JS — shared module
   window.LightTable namespace
   Used by: archive/buffer/index.html, field-notes/post.html
   ============================================ */

window.LightTable = (() => {
  'use strict';

  // CDN root from the worker-injected <meta name="cdn-base"> (site.config
  // cdnBase, or this origin's /api/cdn R2 proxy on a fresh fork).
  const CDN_ROOT = (document.querySelector('meta[name="cdn-base"]')?.content
    || `${window.location.origin}/api/cdn`).replace(/\/+$/, '');
  const CDN = `${CDN_ROOT}/archive`;
  const DEFAULT_ZOOM = 2.5;   // loupe magnification; a session may override per-image

  const BOLT_SVG = `<svg viewBox="0 0 10 16" xmlns="http://www.w3.org/2000/svg"><path d="M6.2 0L0 9.2h3.8L3 16l7-9.8H6.2L8.5 0z"/></svg>`;

  // ---- Date helper: the SITE's calendar day ----
  //
  // A frame's day decides its number (f#, positional and permanent), its day
  // block and which note embeds it, so it must be the same day for every
  // reader. This read the VISITOR's zone until 2026-10-15: a reader in London
  // saw 93 of 731 frames under different numbers than the owner, and the
  // homepage's RAW card (numbered on the server, in the site's zone) could
  // disagree with this page (maintenance review, D1). The zone now comes from
  // the edge (<meta name="site-timezone">, site.config.js → timezone), the
  // same one src/shared/text.js localDay uses, and the rules match it:
  //   · a bare YYYY-MM-DD passes through (no instant to convert);
  //   · an unparseable value or an invalid zone degrades to the UTC date;
  //   · no meta at all (a page saved before this) keeps the old device-local
  //     behaviour rather than guessing.
  let _dayFmt;   // undefined: not resolved yet · null: device local · 'utc'
  function _siteDayFormat() {
    if (_dayFmt !== undefined) return _dayFmt;
    const tz = document.querySelector('meta[name="site-timezone"]')?.content;
    _dayFmt = null;
    if (tz) {
      try {
        _dayFmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        });
      } catch { _dayFmt = 'utc'; }
    }
    return _dayFmt;
  }

  function localDate(isoStr) {
    if (!isoStr) return '';
    const s = String(isoStr);
    if (s.length <= 10 || !s.includes('T')) return s.slice(0, 10);
    const d = new Date(s);
    if (isNaN(d)) return s.slice(0, 10);
    const f = _siteDayFormat();
    if (f === 'utc') return d.toISOString().slice(0, 10);
    if (f) return f.format(d);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---- CDN helpers ----

  function cdnSrc(filename, size) {
    if (!filename) return '';
    const base = encodeURIComponent(filename.replace(/\.[^.]+$/, ''));
    return `${CDN}/${base}-${size}w.webp`;
  }

  function cdnSrcset(filename) {
    if (!filename) return '';
    return [480, 1024, 2048].map(w => `${cdnSrc(filename, w)} ${w}w`).join(', ');
  }

  // ---- Graceful CDN image fallback ----
  // A freshly-uploaded R2 object can 404 at the edge for a few seconds before
  // it propagates. Rather than hiding the <img>, retry the same URL once (cache-
  // busted), then try an alternate size variant, then settle on a neutral dark
  // placeholder. Scoped to the resolved CDN root; capped via data-fb so it
  // never loops. Wired via a capture-phase 'error' delegator (registered at
  // module load, see the bottom of this IIFE) rather than an inline onerror
  // attribute, which a strict script-src forbids.
  const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'>" +
    "<rect width='100%' height='100%' fill='#0a0a0a'/>" +
    "<text x='50%' y='50%' fill='#2b2b2b' font-family='monospace' " +
    "font-size='18' text-anchor='middle' dominant-baseline='central'>//</text></svg>"
  );

  function imgError(img) {
    const url = img.currentSrc || img.src || '';
    if (url.indexOf(CDN_ROOT) === -1) return;            // CDN images only
    const step = img.dataset.fb || '0';
    if (step === 'done') return;
    if (img.srcset) img.removeAttribute('srcset');        // pin to our .src

    if (step === '0') {
      // 1 — retry the same variant once, after the propagation window.
      img.dataset.fb = '1';
      const base = url.split('#')[0].split('?')[0];
      setTimeout(() => { img.src = base + '?r=' + Date.now(); }, 1500);
      return;
    }
    if (step === '1') {
      // 2 — try an alternate size variant if one is constructible.
      const m = url.match(/-(\d+)w\.webp/);
      if (m) {
        img.dataset.fb = '2';
        const alt = m[1] === '480' ? 1024 : 480;
        img.src = url.split('#')[0].split('?')[0]
          .replace(/-\d+w\.webp/, '-' + alt + 'w.webp') + '?r=' + Date.now();
        return;
      }
    }
    // 3 — give up gracefully: neutral dark box, no broken-image icon.
    img.dataset.fb = 'done';
    img.src = PLACEHOLDER;
  }

  function formatDayHeader(dateStr) {
    return dateStr.replace(/-/g, '·');
  }

  // Per-frame focal point → object-position on the cover-fit thumbnail. Emitted
  // only when set (centered frames fall back to the CSS default). Lets a frame
  // steer which part of itself survives the contact-sheet crop.
  function focusStyle(item) {
    return item && item.focus ? ` style="object-position:${item.focus}"` : '';
  }

  // ---- Data helpers ----

  function assignFrameNumbers(entries) {
    const sorted = [...entries].sort((a, b) => {
      const dayA = localDate(a.captured_at || a.published_at);
      const dayB = localDate(b.captured_at || b.published_at);
      const dayCmp = dayA.localeCompare(dayB);
      if (dayCmp !== 0) return dayCmp;
      return (a.filename || '').localeCompare(b.filename || '');
    });
    const map = new Map();
    sorted.forEach((e, i) => map.set(e.id, i + 1));
    return map;
  }

  function groupByDay(entries) {
    const sorted = [...entries].sort((a, b) => {
      const da = a.captured_at || a.published_at || '';
      const db = b.captured_at || b.published_at || '';
      return da.localeCompare(db);
    });
    const byDay = {};
    sorted.forEach(e => {
      const day = localDate(e.captured_at || e.published_at);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(e);
    });
    // Sort within each day by filename (camera sequence order)
    Object.values(byDay).forEach(arr => arr.sort((a, b) => (a.filename || '').localeCompare(b.filename || '')));
    const days = Object.keys(byDay).sort().reverse();
    return { days, byDay };
  }

  // ---- HTML renderers ----

  // A dark frame — the tombstone of a retired frame (manual §5.20). It holds
  // the frame's positional slot forever so every other frame keeps its number:
  // same grid footprint, same frame tag, zero network (no <img> — the media is
  // gone by design). The '//' glyph sits one shade above black, matching the
  // imgError placeholder palette. Not interactive: the lightbox, loupe and
  // keyboard nav all skip .frame-dark.
  function renderDarkCell(item, frameNumbers, day) {
    const num = String(frameNumbers.get(item.id) || 0).padStart(3, '0');
    return `<figure class="frame frame-dark"
          data-frame="${num}"
          data-date="${day}"
          aria-label="Frame ${num} — dark frame (retired)">
          <div class="frame-tag"><span class="tag-id">${num}</span></div>
          <div class="emulsion"><span class="dark-glyph" aria-hidden="true">//</span></div>
        </figure>`;
  }

  // A single regular contact-sheet frame (unchanged markup — the .frame class
  // and its lightbox/light-table behavior are not touched by burst rendering).
  function renderFrameCell(item, frameNumbers, day) {
    if (item.dark) return renderDarkCell(item, frameNumbers, day);
    const num = String(frameNumbers.get(item.id) || 0).padStart(3, '0');
    const archivedClass = item.archived ? ' archived' : '';
    return `<figure class="frame${archivedClass}"
          data-src="${cdnSrc(item.filename, 2048)}"
          data-frame="${num}"
          data-date="${day}"
          data-filename="${item.filename}">
          <div class="frame-tag"><span class="tag-id">${num}</span></div>
          <div class="emulsion">
            <img
              src="${cdnSrc(item.filename, 480)}"
              srcset="${cdnSrcset(item.filename)}"
              sizes="(max-width: 400px) 33vw, (max-width: 640px) 90px, 120px"
              alt=""
              loading="lazy"${focusStyle(item)}
             >
          </div>
        </figure>`;
  }

  // A burst sequence renders as two separate pieces matched by data-burst-id:
  //   1. renderBurstCell — the interactive "film gate". It is one ordinary grid
  //      child, so the contact grid flows uninterrupted (no full-row break).
  //   2. renderBurstStrip — the (collapsed) contact strip, emitted by
  //      renderDayBlock AFTER the contact grid (still inside the day-block
  //      article). It drops into normal document flow below the grid when
  //      expanded. BurstCell wires up the behavior post-render.
  function renderBurstCell(burstId, frames, day, frameNumbers) {
    const count = frames.length;
    const pad2 = n => String(n).padStart(2, '0');
    // The cover + cycling set exclude dark frames (their media is gone); the
    // count badge keeps the full total so the stack stays honest.
    const live = frames.filter(f => !f.dark);
    if (!live.length) {
      // Every frame of the burst is retired — the whole stack is one dark cell.
      return renderDarkCell(frames[0], frameNumbers, day);
    }
    const first = live[0];
    const safeId = String(burstId).replace(/[^\w.\-:]/g, '');
    const globalNums = live.map(f => frameNumbers ? (frameNumbers.get(f.id) || 0) : 0);
    const firstNum = String(globalNums[0]).padStart(3, '0');

    return `<div class="burst-cell" data-burst-id="${safeId}" data-burst-day="${day}" data-burst-globals="${globalNums.join(',')}"
          tabindex="0" role="button" aria-expanded="false"
          aria-label="Burst sequence, ${count} frames. Click to expand.">
          <img class="burst-img" src="${cdnSrc(first.filename, 480)}" alt=""${focusStyle(first)}>
          <div class="burst-counter">
            <span class="burst-dot"></span>
            <span class="burst-counter-text">${firstNum}</span>
          </div>
          <div class="burst-rebate">BURST // ${count}</div>
          <div class="burst-hint">CLICK TO EXPAND</div>
        </div>`;
  }

  // The collapsed contact strip for a burst. Sits below the contact grid (NOT a
  // grid child), matched to its film-gate cell by data-burst-id, and expands in
  // place when that cell is activated.
  function renderBurstStrip(burstId, frames) {
    const count = frames.length;
    const pad2 = n => String(n).padStart(2, '0');
    const safeId = String(burstId).replace(/[^\w.\-:]/g, '');

    // Dark frames keep their slot in the strip (the count stays honest) but
    // render the tombstone cell: no <img>, no lightbox, not part of cycling.
    const stripFramesHtml = frames.map((f, i) => f.dark ? `
          <div class="strip-frame strip-frame-dark"
               aria-label="Frame ${i + 1} of ${count} — dark frame (retired)">
            <span class="dark-glyph" aria-hidden="true">//</span>
            <span class="strip-frame-tag">${pad2(i + 1)}/${pad2(count)}</span>
          </div>` : `
          <div class="strip-frame" data-filename="${f.filename}" data-index="${i}"
               role="button" tabindex="-1" aria-label="Frame ${i + 1} of ${count}">
            <img src="${cdnSrc(f.filename, 1024)}" loading="lazy" decoding="async" alt=""${focusStyle(f)}>
            <span class="strip-frame-tag">${pad2(i + 1)}/${pad2(count)}</span>
          </div>`).join('');

    return `<div class="burst-strip-wrapper" data-burst-id="${safeId}">
          <div class="burst-strip-inner">
            <div class="burst-strip">
              <div class="strip-header">
                <span class="strip-header-label">BURST // ${count} FRAMES // FILM STRIP VIEW</span>
                <button class="strip-close" aria-label="Close film strip" tabindex="-1">&#10005;</button>
              </div>
              <div class="sprocket-edge sprocket-top" aria-hidden="true"></div>
              <div class="strip-scroll">${stripFramesHtml}</div>
              <div class="sprocket-edge sprocket-bottom" aria-hidden="true"></div>
            </div>
          </div>
        </div>`;
  }

  function renderDayBlock(dayEntries, frameNumbers, options = {}) {
    if (!dayEntries || !dayEntries.length) return '';
    const day = localDate(dayEntries[0].captured_at || dayEntries[0].published_at);

    // Pass 1 — group every entry that carries a burst_id. Built in the array's
    // existing order (groupByDay sorts each day by filename), so a group's
    // frames stay in filename order even when they are not adjacent.
    const burstGroups = new Map();
    dayEntries.forEach(item => {
      const bid = item.burst_id;
      if (!bid) return;
      if (!burstGroups.has(bid)) burstGroups.set(bid, []);
      burstGroups.get(bid).push(item);
    });

    // Pass 2 — walk dayEntries in the same (filename) order. The first time a
    // burst_id is seen, emit its film-gate cell inline at that position and
    // collect its contact strip separately (the strips are appended below the
    // grid so the grid never breaks into a sparse row). Later frames of the same
    // burst are consumed (skipped). Non-burst entries pass through.
    const emitted = new Set();
    const stripsHtml = [];
    const gridHtml = dayEntries.map(item => {
      const bid = item.burst_id;
      if (bid && burstGroups.has(bid)) {
        if (emitted.has(bid)) return '';
        emitted.add(bid);
        const frames = burstGroups.get(bid);
        stripsHtml.push(renderBurstStrip(bid, frames));
        return renderBurstCell(bid, frames, day, frameNumbers);
      }
      return renderFrameCell(item, frameNumbers, day);
    }).join('');

    return `<article class="day-block" data-date="${day}">
      <header class="day-header" data-day="${day}">
        <span class="day-mark">//</span>
        <button class="ignite-btn" aria-label="Toggle light table for ${day}">${BOLT_SVG}</button>
        <span class="day-date">${formatDayHeader(day)}</span>
        <span class="day-dots"></span>
        <span class="day-count">${dayEntries.length} frame${dayEntries.length !== 1 ? 's' : ''}</span>
      </header>
      <div class="contact-grid">${gridHtml}</div>
      ${stripsHtml.join('')}
      <div class="day-end-mark"></div>
    </article>`;
  }

  function renderFrameStrip(entries, frameNumbers) {
    if (!entries || !entries.length) return '';

    const gridHtml = entries.map(item => {
      const num = String(frameNumbers.get(item.id) || 0).padStart(3, '0');
      const archivedClass = item.archived ? ' archived' : '';
      const day = localDate(item.captured_at || item.published_at);
      if (item.dark) return renderDarkCell(item, frameNumbers, day);
      return `<figure class="frame${archivedClass}"
          data-src="${cdnSrc(item.filename, 2048)}"
          data-frame="${num}"
          data-date="${day}"
          data-filename="${item.filename}"
          tabindex="0"
          role="button"
          aria-label="Frame ${num}">
          <div class="frame-tag"><span class="tag-id">${num}</span></div>
          <div class="emulsion">
            <img
              src="${cdnSrc(item.filename, 480)}"
              srcset="${cdnSrcset(item.filename)}"
              sizes="130px"
              alt=""
              loading="lazy"${focusStyle(item)}
             >
          </div>
        </figure>`;
    }).join('');

    return `<div class="frame-strip-nav">
      <button class="strip-arrow strip-arrow-left" aria-label="Scroll left" tabindex="0">‹</button>
      <div class="contact-grid">${gridHtml}</div>
      <button class="strip-arrow strip-arrow-right" aria-label="Scroll right" tabindex="0">›</button>
    </div>`;
  }

  // ---- Light table interactivity ----

  function toggleDay(dayBlock, igniteBtn, state) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (state && !state.userHasInteracted) {
      state.userHasInteracted = true;
      const container = dayBlock.parentElement;
      if (container) {
        container.querySelectorAll('.ignite-btn').forEach(b => b.classList.remove('pulsing'));
        container.querySelectorAll('.day-header').forEach(h => h.classList.remove('hint-pulse'));
      }
    }
    const isLit = dayBlock.classList.contains('lit') || dayBlock.classList.contains('igniting');
    if (isLit) {
      dayBlock.classList.remove('lit', 'igniting');
      if (igniteBtn) igniteBtn.classList.remove('lit');
    } else {
      if (prefersReducedMotion) {
        dayBlock.classList.add('lit');
      } else {
        dayBlock.classList.add('igniting');
        setTimeout(() => {
          dayBlock.classList.remove('igniting');
          dayBlock.classList.add('lit');
        }, 820);
      }
      if (igniteBtn) igniteBtn.classList.add('lit');
    }
  }

  function initLightTable(container) {
    const state = { userHasInteracted: false };
    const dayBlocks = Array.from(container.querySelectorAll('.day-block'));
    const igniteButtons = dayBlocks.map(b => b.querySelector('.ignite-btn'));

    // Burst sequences self-wire here so both consumers (buffer page + post
    // embeds) get them with no markup changes. Runs at every viewport width —
    // bursts are interactive on mobile too.
    const burstCells = initBursts(container);

    if (window.innerWidth > 640) {
      dayBlocks.forEach((block, i) => {
        const igniteBtn = igniteButtons[i];
        const dayHeader = block.querySelector('.day-header');

        if (igniteBtn) {
          igniteBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggleDay(block, igniteBtn, state);
          });
        }
        if (dayHeader) {
          dayHeader.addEventListener('click', () => {
            toggleDay(block, igniteBtn, state);
          });
        }
      });
    }

    return { dayBlocks, igniteButtons, state, burstCells };
  }

  function runIgnitionSequence(dayBlocks, igniteButtons, state) {
    if (!dayBlocks || !dayBlocks.length) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const container = dayBlocks[0].parentElement;

    const viewportBlocks = dayBlocks.filter(b =>
      b.getBoundingClientRect().top < window.innerHeight
    );
    const viewportButtons = igniteButtons.filter((_, i) =>
      dayBlocks[i] && dayBlocks[i].getBoundingClientRect().top < window.innerHeight
    );

    setTimeout(() => {
      viewportBlocks.forEach(b => {
        if (prefersReducedMotion) b.classList.add('lit');
        else b.classList.add('igniting');
      });
      viewportButtons.forEach(b => { if (b) b.classList.add('lit'); });
    }, 300);

    if (!prefersReducedMotion) {
      setTimeout(() => {
        viewportBlocks.forEach(b => {
          b.classList.remove('igniting');
          b.classList.add('lit');
        });
      }, 1100);
    }

    setTimeout(() => {
      for (let i = viewportBlocks.length - 1; i >= 1; i--) {
        const delay = (viewportBlocks.length - 1 - i) * 150;
        setTimeout(() => {
          viewportBlocks[i].classList.remove('lit');
          if (viewportButtons[i]) viewportButtons[i].classList.remove('lit');
        }, delay);
      }
    }, 2200);

    const pulseDelay = 2200 + (viewportBlocks.length * 150) + 1000;
    setTimeout(() => {
      if (state && !state.userHasInteracted && window.innerWidth > 640) {
        igniteButtons.forEach((btn, i) => {
          if (i !== 0 && btn) btn.classList.add('pulsing');
        });
        if (container) {
          container.querySelectorAll('.day-header').forEach((h, i) => {
            if (i !== 0) h.classList.add('hint-pulse');
          });
        }
      }
    }, pulseDelay);
  }

  // ---- Lightbox (singleton) ----

  const LB = {
    el: null,
    imgEl: null,
    metaEl: null,
    counterEl: null,
    minimapEl: null,
    thumbEl: null,
    reticleEl: null,
    frames: [],
    currentIdx: 0,
    isZoomed: false,
    ZOOM_LEVEL: DEFAULT_ZOOM,
    loupeReady: false,
    keyNavReady: false,
    zoomFirstMode: false,   // single-image hero inspect: open zoomed, click/Esc exits
  };

  function ensureLightboxDOM() {
    if (LB.el) return;
    let el = document.querySelector('.lightbox');
    if (!el) {
      el = document.createElement('div');
      el.className = 'lightbox';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML = `
        <div class="lightbox-stage">
          <img class="lightbox-img" src="" alt="">
          <button class="lightbox-close" type="button" aria-label="Close">&#215;</button>
        </div>
        <p class="lightbox-meta"></p>
        <div class="lightbox-counter"></div>
        <div class="minimap-hud">
          <img class="minimap-thumb" src="" alt="">
          <div class="minimap-reticle"></div>
        </div>
      `;
      document.body.appendChild(el);
    }
    LB.el = el;
    LB.imgEl = el.querySelector('.lightbox-img');
    LB.metaEl = el.querySelector('.lightbox-meta');
    LB.counterEl = el.querySelector('.lightbox-counter');
    LB.minimapEl = el.querySelector('.minimap-hud');
    LB.thumbEl = el.querySelector('.minimap-thumb');
    LB.reticleEl = el.querySelector('.minimap-reticle');

    el.addEventListener('click', e => {
      if (e.target === el) closeLightbox();
    });

    // Explicit close affordance — the obvious way out on touch (no hover loupe,
    // little backdrop to tap) and a clear escape on desktop too.
    const closeBtn = el.querySelector('.lightbox-close');
    if (closeBtn) closeBtn.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });

    document.addEventListener('keydown', e => {
      if (!LB.el || !LB.el.classList.contains('is-open')) return;
      if (e.key === 'Escape') {
        // zoom-first inspect (hero): Esc exits the whole viewer, not just zoom.
        if (LB.zoomFirstMode) closeLightbox();
        else if (LB.isZoomed) exitZoom();
        else closeLightbox();
      }
    });
  }

  function openFrame(idx) {
    // Cancel any in-flight close so a quick re-open doesn't get torn down.
    if (LB._closeTimer) { clearTimeout(LB._closeTimer); LB._closeTimer = null; }
    LB._closing = false;
    if (LB.el) LB.el.classList.remove('is-closing', 'is-returning');
    // Wipe any leftover FLIP/loupe transform so a fresh open starts at fit.
    if (LB.imgEl) {
      LB.imgEl.style.transition = '';
      LB.imgEl.style.transform = '';
      LB.imgEl.style.transformOrigin = '';
    }
    if (LB.isZoomed) exitZoom();
    LB.currentIdx = idx;
    const frame = LB.frames[idx];
    if (!frame) return;
    const src = frame.dataset.src;
    const num = frame.dataset.frame;
    const date = frame.dataset.date;
    const filename = frame.dataset.filename;
    LB.imgEl.src = src;
    // A caller (e.g. the field-note hero) can override the caption/counter via
    // the descriptor; real grid frames carry neither, so they keep the default.
    LB.metaEl.innerHTML = frame.dataset.meta || `FRAME ${num} <span class="accent">//</span> ${date}`;
    LB.counterEl.textContent = (frame.dataset.counter != null)
      ? frame.dataset.counter
      : `${num} / ${String(LB.frames.length).padStart(3, '0')}`;
    LB.el.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    const isDesktop = window.matchMedia('(hover: hover)').matches;
    if (isDesktop && LB.thumbEl && filename) {
      LB.thumbEl.src = cdnSrc(filename, 480);
    }
  }

  function closeLightbox() {
    if (!LB.el || !LB.el.classList.contains('is-open') || LB._closing) return;
    LB._closing = true;

    // Return-to-shelf: when the viewer was opened from a specific element (the
    // field-note hero), animate the photo back down to that element's spot on
    // the page — it recedes onto its shelf — instead of a flat fade. The buffer
    // never passes a return element, so it keeps the standard dissolve.
    const returnEl = LB._returnEl;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (returnEl && document.contains(returnEl) && !reduce) {
      returnToShelf(returnEl);
      return;
    }

    // Mirror the open: zoom the image back out (scale → 1 via the .lightbox-img
    // transition) and dissolve the overlay so it recedes back into the page,
    // instead of a hard display:none cut. Tear down only once it finishes.
    if (LB.isZoomed) exitZoom();
    LB.el.classList.add('is-closing');
    LB._closeTimer = setTimeout(finalizeClose, 340);
  }

  // Tear-down shared by every close path: drop the open/transition classes,
  // wipe any inline transform the loupe or shelf-return left behind, and reset
  // the per-session overrides so the next open starts clean.
  function finalizeClose() {
    LB._closeTimer = null;
    LB._closing = false;
    if (!LB.el) return;
    if (LB.imgEl) {
      LB.imgEl.style.transition = '';
      LB.imgEl.style.transform = '';
      LB.imgEl.style.transformOrigin = '';
    }
    LB.isZoomed = false;
    LB.el.classList.remove('is-open', 'is-closing', 'is-returning', 'is-zoomed', 'lb-blog');
    LB.zoomFirstMode = false;     // reset so other surfaces keep zoom-toggle behavior
    LB.ZOOM_LEVEL = DEFAULT_ZOOM; // reset any per-session zoom override
    LB._returnEl = null;
    document.body.style.overflow = '';
  }

  // FLIP the lightbox photo from wherever it currently sits (zoomed or fit) onto
  // the page element it came from, so it visibly "returns to its shelf." We use
  // transform-origin 0 0 throughout so a single translate+scale maps the image's
  // own box onto any target rect; the start transform reproduces the current
  // (possibly zoomed) visual exactly, so the motion is continuous with no snap.
  function returnToShelf(returnEl) {
    const img = LB.imgEl;
    if (!img) { LB.el.classList.add('is-closing'); LB._closeTimer = setTimeout(finalizeClose, 340); return; }

    // Current on-screen box (includes any active zoom transform).
    const current = img.getBoundingClientRect();

    // Measure the untransformed fit box without painting the bare state: kill the
    // transition, clear the transform, read, then restore a start transform that
    // reproduces `current` — all synchronously, before the browser paints.
    img.style.transition = 'none';
    img.style.transformOrigin = '0 0';
    img.style.transform = 'none';
    const fit = img.getBoundingClientRect();
    if (!fit.width || !fit.height) {  // safety: nothing to measure → plain fade
      img.style.transition = ''; img.style.transform = ''; img.style.transformOrigin = '';
      LB.el.classList.add('is-closing');
      LB._closeTimer = setTimeout(finalizeClose, 340);
      return;
    }

    const startTf = `translate(${current.left - fit.left}px, ${current.top - fit.top}px) `
                  + `scale(${current.width / fit.width})`;
    img.style.transform = startTf;
    void img.offsetWidth;             // commit the start so the next change animates

    // The mini-map, counter and close affordance drop out immediately; the
    // backdrop dissolves while the photo glides home (see .is-returning CSS).
    LB.isZoomed = false;
    LB.el.classList.remove('is-zoomed');
    LB.el.classList.add('is-returning');

    const dest = returnEl.getBoundingClientRect();
    const endTf = `translate(${dest.left - fit.left}px, ${dest.top - fit.top}px) `
                + `scale(${dest.width / fit.width})`;
    img.style.transition = 'transform 0.44s cubic-bezier(0.4, 0, 0.2, 1)';
    img.style.transform = endTf;

    LB._closeTimer = setTimeout(finalizeClose, 460);
  }

  // Enter zoom for the zoom-first hero inspect so the loupe + mini-map are live
  // the instant the viewer opens. We zoom into the point the user actually
  // clicked (clientX/clientY mapped onto the lightbox image) rather than the
  // image center — matching the buffer, where "wherever your mouse is when you
  // click in is where the zoom goes." Starting at the cursor means the first
  // mousemove is a sub-pixel delta instead of a jarring jump from center to
  // pointer (the "trying to recenter" glitch). Falls back to center when no
  // pointer coords are supplied or the image hasn't laid out yet.
  function enterZoomAtClient(clientX, clientY) {
    if (!LB.imgEl || !LB.reticleEl) return;
    let xPct = 50, yPct = 50;
    const rect = LB.imgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 &&
        typeof clientX === 'number' && typeof clientY === 'number') {
      xPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      yPct = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    }
    LB.isZoomed = true;
    LB.el.classList.add('is-zoomed');
    LB.imgEl.style.transform = `scale(${LB.ZOOM_LEVEL})`;
    LB.imgEl.style.transformOrigin = `${xPct}% ${yPct}%`;
    const reticleSize = 100 / LB.ZOOM_LEVEL;
    LB.reticleEl.style.width = reticleSize + '%';
    LB.reticleEl.style.height = reticleSize + '%';
    LB.reticleEl.style.left = `calc(${xPct}% - ${reticleSize / 2}%)`;
    LB.reticleEl.style.top = `calc(${yPct}% - ${reticleSize / 2}%)`;
  }

  function exitZoom() {
    LB.isZoomed = false;
    if (LB.el) LB.el.classList.remove('is-zoomed');
    if (LB.imgEl) {
      LB.imgEl.style.transform = 'scale(1)';
      setTimeout(() => { if (LB.imgEl) LB.imgEl.style.transformOrigin = 'center center'; }, 300);
    }
  }

  function updateZoomPosition(e) {
    if (!LB.imgEl || !LB.reticleEl) return;
    const rect = LB.imgEl.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    LB.imgEl.style.transformOrigin = `${xPct}% ${yPct}%`;
    const reticleSize = 100 / LB.ZOOM_LEVEL;
    LB.reticleEl.style.width = reticleSize + '%';
    LB.reticleEl.style.height = reticleSize + '%';
    LB.reticleEl.style.left = `calc(${xPct}% - ${reticleSize / 2}%)`;
    LB.reticleEl.style.top = `calc(${yPct}% - ${reticleSize / 2}%)`;
  }

  function initLightbox(container) {
    ensureLightboxDOM();
    // Dark frames (retired tombstones) are never viewable — the lightbox and
    // its arrow-key nav only ever see live frames.
    const newFrames = Array.from(container.querySelectorAll('.frame:not(.frame-dark)'));
    newFrames.forEach(frame => {
      if (LB.frames.includes(frame)) return;
      const idx = LB.frames.length;
      LB.frames.push(frame);
      frame.addEventListener('click', () => openFrame(idx));
    });
  }

  function initLoupe(container) {
    ensureLightboxDOM();
    if (LB.loupeReady) return;
    LB.loupeReady = true;

    const isDesktop = window.matchMedia('(hover: hover)').matches;
    if (!isDesktop || !LB.imgEl) {
      // Touch: no hover loupe, so a tap on the image is the intuitive "close"
      // (tap hero to expand, tap image to dismiss) — backdrop is often tiny.
      if (LB.imgEl) {
        LB.imgEl.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });
      }
      return;
    }

    LB.imgEl.addEventListener('click', e => {
      e.stopPropagation();
      // zoom-first inspect (hero): the viewer opens already zoomed, so a click
      // just exits — there's no intermediate fit view to learn.
      if (LB.zoomFirstMode) { closeLightbox(); return; }
      LB.isZoomed = !LB.isZoomed;
      if (LB.isZoomed) {
        LB.el.classList.add('is-zoomed');
        LB.imgEl.style.transform = `scale(${LB.ZOOM_LEVEL})`;
        updateZoomPosition(e);
      } else {
        exitZoom();
      }
    });

    LB.imgEl.addEventListener('mousemove', e => {
      if (!LB.isZoomed) return;
      updateZoomPosition(e);
    });
  }

  function initKeyboardNav(container) {
    ensureLightboxDOM();
    if (LB.keyNavReady) return;
    LB.keyNavReady = true;

    document.addEventListener('keydown', e => {
      if (!LB.el || !LB.el.classList.contains('is-open') || LB.isZoomed) return;
      if (e.key === 'ArrowRight') openFrame((LB.currentIdx + 1) % LB.frames.length);
      if (e.key === 'ArrowLeft') openFrame((LB.currentIdx - 1 + LB.frames.length) % LB.frames.length);
    });
  }

  // ---- Burst → lightbox bridge ----
  // Public entry point used by burst strips: open the shared lightbox over an
  // arbitrary list of filenames (not the page's pre-registered .frame nodes).
  // It reuses every existing lightbox feature (arrow nav, loupe, minimap, ESC,
  // 2048w) by temporarily swapping LB.frames for lightweight, frame-shaped
  // descriptors, then restoring the grid frames when the lightbox closes — so
  // none of the existing lightbox code needs to change.
  function open(frameArray, clickedIndex, onClose, opts = {}) {
    ensureLightboxDOM();
    if (!frameArray || !frameArray.length) return;
    const total = frameArray.length;
    const synthetic = frameArray.map((filename, i) => ({
      dataset: {
        src: cdnSrc(filename, 2048),
        frame: String(i + 1).padStart(2, '0') + '/' + String(total).padStart(2, '0'),
        date: opts.date || 'BURST',
        filename: filename,
        ...(opts.meta ? { meta: opts.meta } : {}),
        ...(opts.counter != null ? { counter: opts.counter } : {}),
      },
    }));
    if (LB._gridFrames == null) LB._gridFrames = LB.frames;
    LB.frames = synthetic;
    LB._burstOnClose = (typeof onClose === 'function') ? onClose : null;
    ensureBurstRestore();

    // Per-session zoom magnification (landscape heroes zoom a touch less so more
    // of the frame stays visible) + optional blog-exclusive red theme.
    LB.ZOOM_LEVEL = (typeof opts.zoomLevel === 'number') ? opts.zoomLevel : DEFAULT_ZOOM;
    if (LB.el) LB.el.classList.toggle('lb-blog', opts.theme === 'blog');

    // Optional element to return to on close (the hero "shelf"). When set, the
    // closer FLIPs the photo back onto it instead of dissolving.
    LB._returnEl = (opts.originEl && document.contains(opts.originEl)) ? opts.originEl : null;

    const idx = Math.max(0, Math.min(total - 1, clickedIndex | 0));
    openFrame(idx);
    // Optional zoom-first mode (single-image hero inspect): open straight into
    // the loupe/mini-map view. Desktop only — the loupe needs hover to pan.
    if (opts.zoomFirst && window.matchMedia('(hover: hover)').matches) {
      LB.zoomFirstMode = true;
      // Push IN with the bezier transform transition (matching the buffer) rather
      // than hard-cutting: commit a fit-scale baseline, then zoom next frame so
      // the CSS transition has a "from" state to animate.
      LB.imgEl.style.transition = 'none';
      LB.imgEl.style.transform = 'scale(1)';
      LB.imgEl.style.transformOrigin = '50% 50%';
      void LB.imgEl.offsetWidth;                       // commit the baseline
      requestAnimationFrame(() => {
        LB.imgEl.style.transition = '';                // restore CSS bezier
        // Zoom into the point the user clicked (not the center) so the pointer
        // already sits on the zoom focus — no recenter jump on first mousemove.
        enterZoomAtClient(opts.originX, opts.originY);
      });
    } else {
      LB.zoomFirstMode = false;
    }
  }

  // When the lightbox closes (backdrop, ESC, or programmatic) restore the real
  // grid frames and report the last-viewed index back to the strip. Scoped to
  // the lightbox element — no global listeners, no edits to closeLightbox().
  function ensureBurstRestore() {
    if (LB._restoreObserver || !LB.el) return;
    const obs = new MutationObserver(() => {
      if (LB.el && !LB.el.classList.contains('is-open') && LB._gridFrames != null) {
        const cb = LB._burstOnClose;
        const lastIdx = LB.currentIdx;
        LB.frames = LB._gridFrames;
        LB._gridFrames = null;
        LB._burstOnClose = null;
        if (cb) cb(lastIdx);
      }
    });
    obs.observe(LB.el, { attributes: true, attributeFilter: ['class'] });
    LB._restoreObserver = obs;
  }

  // ---- Burst rendering: coordination layer + per-cell controller ----

  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // One controller per day block. Enforces "single active burst": exactly one
  // burst is the auto-cycling primary; the rest are dormant. Also enforces a
  // single open strip per day.
  class DayBlockController {
    constructor() {
      this.activeBurstId = null;
      this.cells = [];
    }
    register(cell) {
      this.cells.push(cell);
    }
    // Called once after every burst in the day is registered. The first burst
    // in DOM/filename order (cells[0]) is the default primary, independent of
    // IntersectionObserver timing — this is what guarantees the FIRST burst
    // auto-cycles on load rather than whichever happens to be observed first.
    init() {
      if (this.cells.length) this.promote(this.cells[0].burstId);
    }
    promote(burstId) {
      this.activeBurstId = burstId;
      this.cells.forEach(c => (c.burstId === burstId ? c.makePrimary() : c.makeDormant()));
    }
    demoteAll() {
      this.activeBurstId = null;
      this.cells.forEach(c => c.makeDormant());
    }
    anyStripOpen() {
      return this.cells.some(c => c.isExpanded);
    }
    // A burst's strip just opened: close any other open strip, then make it
    // the primary and demote the rest.
    notifyStripOpen(cell) {
      this.cells.forEach(c => { if (c !== cell && c.isExpanded) c.collapse(); });
      this.demoteAll();
      this.promote(cell.burstId);
    }
    // A burst scrolled into view. While a strip is open the observer never
    // re-promotes. The first burst (cells[0]) is promoted on init(), so the
    // observer only HANDS OFF when the established primary has genuinely
    // scrolled away — it was in the viewport and has since left — letting the
    // newcomer take over so something visible is always cycling. A primary that
    // simply hasn't fired its first IntersectionObserver callback yet still
    // counts as present, so initial-load callback ordering can never steal
    // promotion from cells[0].
    notifyEnterViewport(cell) {
      if (this.anyStripOpen()) return;
      const active = this.cells.find(c => c.burstId === this.activeBurstId);
      if (!active) { this.promote(cell.burstId); return; }
      if (active.hasBeenInViewport && !active.inViewport) this.promote(cell.burstId);
    }
  }

  // Fully self-contained burst cell. All state lives on the instance; every
  // listener/timer/observer is scoped to this cell and torn down in destroy().
  class BurstCell {
    constructor(cellEl, controller) {
      this.cell = cellEl;
      this.controller = controller;
      this.burstId = cellEl.dataset.burstId;
      // The strip now lives below the contact grid (not as the cell's sibling),
      // so locate it by matching data-burst-id within this day-block article.
      const dayBlock = cellEl.closest('.day-block');
      this.stripWrapper = dayBlock
        ? dayBlock.querySelector(`.burst-strip-wrapper[data-burst-id="${this.burstId}"]`)
        : null;
      this.img = cellEl.querySelector('.burst-img');
      this.counterText = cellEl.querySelector('.burst-counter-text');
      this.stripFrameEls = this.stripWrapper
        ? Array.from(this.stripWrapper.querySelectorAll('.strip-frame'))
        : [];
      // Dark frames sit in the strip as inert tombstones (no data-filename):
      // they join the cascade animation but never cycle, click, or lightbox.
      this.liveFrameEls = this.stripFrameEls.filter(el => el.dataset.filename);
      this.frames = this.liveFrameEls.map(el => el.dataset.filename);
      this.globalNums = (cellEl.dataset.burstGlobals || '').split(',').map(Number);

      this.currentFrame = 0;
      this.cycleMs = 300;
      this.cycleTimer = null;
      this.resumeTimer = null;
      this.cascadeTimer = null;
      this.isExpanded = false;
      this.isHovering = false;
      this.isDormant = true;
      this.inViewport = false;
      this.hasBeenInViewport = false;
      this.tempActive = false;
      this.preloaded = false;
      this.touchScrubbing = false;
      this.touchStartX = 0;
      this.touchStartY = 0;
      this.touchStartFrame = 0;

      this.cell.classList.add('dormant');

      this.ac = new AbortController();
      const sig = { signal: this.ac.signal };
      this.cell.addEventListener('click', () => this.toggleStrip(), sig);
      this.cell.addEventListener('mouseenter', () => this.onMouseEnter(), sig);
      this.cell.addEventListener('mouseleave', () => this.onMouseLeave(), sig);
      this.cell.addEventListener('keydown', e => this.onKeyDown(e), sig);
      this.cell.addEventListener('wheel', e => this.onWheel(e), { passive: false, signal: this.ac.signal });
      this.cell.addEventListener('touchstart', e => this.onTouchStart(e), { passive: true, signal: this.ac.signal });
      this.cell.addEventListener('touchmove', e => this.onTouchMove(e), { passive: false, signal: this.ac.signal });
      this.cell.addEventListener('touchend', () => this.onTouchEnd(), sig);

      if (this.stripWrapper) {
        const closeBtn = this.stripWrapper.querySelector('.strip-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', e => { e.stopPropagation(); this.collapse(); }, sig);
        }
        this.liveFrameEls.forEach((el, i) => {
          el.addEventListener('click', e => { e.stopPropagation(); this.openLightbox(i); }, sig);
        });
      }

      this.io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            if (!this.inViewport) { this.inViewport = true; this.onEnterViewport(); }
          } else if (this.inViewport) {
            this.inViewport = false;
            this.onExitViewport();
          }
        });
      }, { rootMargin: '200px 0px', threshold: 0.1 });
      this.io.observe(this.cell);
    }

    pad2(n) { return String(n).padStart(2, '0'); }

    updateImg() {
      if (!this.frames.length) return;
      const f = this.frames[this.currentFrame];
      if (this.img) this.img.src = cdnSrc(f, 480);
      if (this.counterText) {
        const globalNum = this.globalNums[this.currentFrame] || (this.currentFrame + 1);
        this.counterText.textContent = String(globalNum).padStart(3, '0');
      }
    }

    preloadFrames() {
      if (this.preloaded) return;
      this.preloaded = true;
      this.frames.forEach(f => { const im = new Image(); im.src = cdnSrc(f, 480); });
    }

    startCycle() {
      if (this.cycleTimer || this.isExpanded || !this.inViewport || this.frames.length < 2) return;
      this.preloadFrames();
      this.cell.classList.add('cycling');
      this.cycleTimer = setInterval(() => {
        this.currentFrame = (this.currentFrame + 1) % this.frames.length;
        this.updateImg();
      }, this.cycleMs);
    }

    stopCycle() {
      if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
      this.cell.classList.remove('cycling');
    }

    makePrimary() {
      this.isDormant = false;
      this.cell.classList.remove('dormant');
      if (!this.isExpanded && this.inViewport && !this.isHovering) this.startCycle();
    }

    makeDormant() {
      this.isDormant = true;
      this.cell.classList.add('dormant');
      if (!this.isExpanded) {
        this.stopCycle();
        if (!this.isHovering) { this.currentFrame = 0; this.updateImg(); }
      }
    }

    onEnterViewport() {
      this.hasBeenInViewport = true;
      this.controller.notifyEnterViewport(this);
      if (!this.isDormant && !this.isExpanded && !this.isHovering) this.startCycle();
    }

    onExitViewport() {
      this.stopCycle();
    }

    onMouseEnter() {
      this.isHovering = true;
      clearTimeout(this.resumeTimer);
      if (this.isExpanded) return;
      if (this.isDormant) {
        // Dormant burst temporarily comes alive while hovered.
        this.tempActive = true;
        this.startCycle();
      } else {
        // Primary burst pauses so the user can read the "click to expand" hint.
        this.stopCycle();
      }
    }

    onMouseLeave() {
      this.isHovering = false;
      if (this.isExpanded) return;
      if (this.isDormant) {
        if (this.tempActive) {
          this.tempActive = false;
          this.stopCycle();
          this.currentFrame = 0;
          this.updateImg();
        }
      } else {
        this.resumeTimer = setTimeout(() => {
          if (this.inViewport && !this.isExpanded && !this.isDormant && !this.isHovering) this.startCycle();
        }, 400);
      }
    }

    scrub(dir) {
      if (!this.frames.length) return;
      this.stopCycle();
      const n = this.frames.length;
      this.currentFrame = (this.currentFrame + dir + n) % n;
      this.updateImg();
    }

    onWheel(e) {
      // CRITICAL: only Shift+wheel scrubs. Without the Shift guard we must NOT
      // call preventDefault — normal vertical scrolling stays untouched.
      if (!e.shiftKey || this.isExpanded) return;
      e.preventDefault();
      this.scrub(e.deltaY > 0 ? 1 : -1);
    }

    onTouchStart(e) {
      if (e.touches.length !== 1) return;
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
      this.touchStartFrame = this.currentFrame;
      this.touchScrubbing = false;
    }

    onTouchMove(e) {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - this.touchStartX;
      const dy = e.touches[0].clientY - this.touchStartY;
      if (!this.touchScrubbing) {
        // Lock to horizontal scrub only once the gesture is clearly sideways;
        // anything vertical falls through to the browser (touch-action: pan-y).
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
          this.touchScrubbing = true;
          this.stopCycle();
        } else {
          return;
        }
      }
      e.preventDefault();
      const n = this.frames.length;
      if (!n) return;
      const steps = Math.round(dx / 30); // 30px per frame step
      this.currentFrame = ((this.touchStartFrame + steps) % n + n) % n;
      this.updateImg();
    }

    onTouchEnd() {
      this.touchScrubbing = false;
    }

    onKeyDown(e) {
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); this.scrub(1); break;
        case 'ArrowLeft': e.preventDefault(); this.scrub(-1); break;
        case 'Enter':
        case ' ':
        case 'Spacebar':
          e.preventDefault(); this.toggleStrip(); break;
        case 'Escape':
          if (this.isExpanded) { e.preventDefault(); this.collapse(); }
          break;
        default: break;
      }
    }

    toggleStrip() {
      if (this.isExpanded) this.collapse();
      else this.expand();
    }

    expand() {
      if (this.isExpanded || !this.stripWrapper) return;
      this.isExpanded = true;
      this.controller.notifyStripOpen(this); // closes siblings, makes this primary
      this.stopCycle();
      this.cell.classList.remove('cycling', 'dormant');
      this.cell.classList.add('strip-open', 'static');
      this.cell.setAttribute('aria-expanded', 'true');
      this.stripWrapper.classList.add('expanded');
      this.runCascade('in');
    }

    collapse() {
      if (!this.isExpanded || !this.stripWrapper) return;
      const finish = () => {
        this.stripWrapper.classList.remove('expanded');
        this.isExpanded = false;
        this.cell.classList.remove('strip-open', 'static');
        this.cell.setAttribute('aria-expanded', 'false');
        // Reset cascade state once the row has finished collapsing.
        setTimeout(() => {
          this.stripFrameEls.forEach(f => {
            f.classList.remove('igniting', 'dimming');
            f.style.animationDelay = '';
          });
        }, 480);
        if (!this.isDormant && this.inViewport && !this.isHovering) this.startCycle();
      };
      clearTimeout(this.cascadeTimer);
      if (prefersReducedMotion()) {
        this.stripFrameEls.forEach(f => {
          f.classList.remove('igniting', 'dimming');
          f.style.animationDelay = '';
        });
        finish();
        return;
      }
      const dur = this.runCascade('out');
      this.cascadeTimer = setTimeout(finish, dur);
    }

    // Cascade the strip frames bright (in) or dim (out). Returns the time, in
    // ms, until the caller may proceed (used by collapse to delay the row
    // collapse until the dim cascade — plus a ~100ms pause — has finished).
    runCascade(direction) {
      const frames = this.stripFrameEls;
      const count = frames.length;
      if (!count) return 0;
      if (prefersReducedMotion()) {
        frames.forEach(f => { f.classList.remove('igniting', 'dimming'); f.style.animationDelay = ''; });
        return 0;
      }
      const FRAME_MS = 200;
      const total = count * 80; // ~640ms for 8 frames, scales with frame count

      if (direction === 'in') {
        frames.forEach((f, i) => {
          f.classList.remove('dimming');
          const t = i / count;
          const delay = total * (1 - Math.pow(1 - t, 2)); // accelerating L→R
          f.style.animationDelay = delay.toFixed(1) + 'ms';
          f.classList.add('igniting');
        });
        const dur = total + FRAME_MS + 40;
        this.cascadeTimer = setTimeout(() => {
          frames.forEach(f => { f.classList.remove('igniting'); f.style.animationDelay = ''; });
        }, dur);
        return dur;
      }

      // direction === 'out'
      frames.forEach((f, i) => {
        f.classList.remove('igniting');
        const t = (count - 1 - i) / count;
        const delay = total * (1 - Math.pow(1 - t, 2)); // decelerating R→L
        f.style.animationDelay = delay.toFixed(1) + 'ms';
        f.classList.add('dimming');
      });
      return total + FRAME_MS + 100; // cascade + ~100ms pause before collapse
    }

    openLightbox(index) {
      this.setActiveStripFrame(index);
      open(this.frames, index, finalIdx => this.setActiveStripFrame(finalIdx));
    }

    setActiveStripFrame(index) {
      this.liveFrameEls.forEach((f, i) => f.classList.toggle('active', i === index));
    }

    destroy() {
      this.stopCycle();
      clearTimeout(this.resumeTimer);
      clearTimeout(this.cascadeTimer);
      if (this.io) this.io.disconnect();
      if (this.ac) this.ac.abort();
    }
  }

  // Scan a rendered container, build a DayBlockController per day block, and
  // instantiate a BurstCell for every burst. Safe no-op on pages/days that
  // contain no bursts. Returns the created cells for optional teardown.
  function initBursts(container) {
    const instances = [];
    container.querySelectorAll('.day-block').forEach(dayBlock => {
      const cells = dayBlock.querySelectorAll('.burst-cell');
      if (!cells.length) return;
      const controller = new DayBlockController();
      cells.forEach(cellEl => {
        const bc = new BurstCell(cellEl, controller);
        controller.register(bc);
        instances.push(bc);
      });
      // Promote the first burst as the default primary, independent of any
      // viewport timing race during initial page load.
      controller.init();
    });
    return instances;
  }

  // CDN <img> load failures route to imgError via delegation instead of an
  // inline onerror attribute (forbidden under a strict script-src): the error
  // event bubbles to this capture-phase listener. imgError no-ops off CDN_ROOT,
  // so delegating every image error here is safe.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('error', (e) => {
      if (e.target && e.target.tagName === 'IMG') imgError(e.target);
    }, true);
  }

  return {
    cdnSrc,
    cdnSrcset,
    imgError,
    formatDayHeader,
    // The site's calendar day for a timestamp: the one rule frame numbers,
    // day blocks and note embeds all bucket by.
    siteDay: localDate,
    assignFrameNumbers,
    groupByDay,
    renderDayBlock,
    renderFrameStrip,
    toggleDay,
    initLightTable,
    runIgnitionSequence,
    initLightbox,
    initLoupe,
    initKeyboardNav,
    initBursts,
    open,
  };
})();
