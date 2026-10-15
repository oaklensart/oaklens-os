/* site-common.js — shared client boilerplate for every public page.
   ============================================================================
   Classic (non-module) script: its top-level function declarations are globals,
   so inline handlers (onclick="submitGTD(...)", onerror="cdnImgError(this)")
   and each page's own render code can call them directly.

   Load it SYNCHRONOUSLY (no defer) right before a page's trailing inline
   script — never with defer. Page render scripts run at parse time, before any
   deferred script executes, so the helpers below must already be defined when
   the parser reaches them. Loaded near the end of <body>, the DOM chrome (nav,
   footer) is already parsed, so the auto-init at the bottom finds its elements.

   This consolidates blocks that were copy-pasted across index / about / os /
   archive / wall / field-notes / support / 404:
     - mobile-nav toggle           (auto-init; every page has the nav)
     - CDN image URL helpers        (cdnRoot / cdnUrl / cdnSrcsetFor)
     - graceful CDN image fallback  (cdnImgError + CDN_PLACEHOLDER)
     - the "get the drop" subscribe (submitGTD)
     - a debounced viewport-settle hook (onViewportSettle) for overlay re-fit
     - escapeHtml, for owner text going into a template literal

   Per-page code keeps only what is genuinely page-specific — e.g. each page's
   one-line cdnSrc(filename, size) adapter that binds its CDN section, plus
   page-only helpers (wall's cdnFull, archive's localDay, field-notes'
   formatDate). Keeping cdnSrc's call sites byte-identical is deliberate: the
   shared code changes, the thousands of `cdnSrc(x, 480)` calls do not. */

/* ---- Text into markup -------------------------------------------------------
   Owner-written text (a title, a caption, a place) becomes HTML on several
   pages through template literals. Unescaped, a quote in a title cut its alt
   text short and a `<` or `&` swallowed what followed; a Site-in-a-ZIP export
   runs from file:// with no CSP behind it (maintenance review 2026-10-15, D8).
   Same five characters as src/shared/text.js escapeHtml. */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---- CDN base resolution ---------------------------------------------------
   CDN root from the worker-injected <meta name="cdn-base"> (site.config.js
   cdnBase, or this origin's /api/cdn R2 proxy on a fresh fork). */
function cdnRoot() {
  return (document.querySelector('meta[name="cdn-base"]')?.content
    || `${location.origin}/api/cdn`).replace(/\/+$/, '');
}

/* Build one CDN variant URL. Encode + and other reserved chars so Android
   browsers don't reinterpret them. `section` is the CDN sub-path
   (archive / wallpaper / …); the -{size}w.webp variant convention is shared. */
function cdnUrl(section, filename, size) {
  if (!filename) return '';
  const base = encodeURIComponent(filename.replace(/\.[^.]+$/, ''));
  return `${cdnRoot()}/${section}/${base}-${size}w.webp`;
}

/* The three-variant srcset for a filename in a CDN section. */
function cdnSrcsetFor(section, filename) {
  if (!filename) return '';
  const base = encodeURIComponent(filename.replace(/\.[^.]+$/, ''));
  const root = cdnRoot();
  return [
    `${root}/${section}/${base}-480w.webp 480w`,
    `${root}/${section}/${base}-1024w.webp 1024w`,
    `${root}/${section}/${base}-2048w.webp 2048w`,
  ].join(', ');
}

/* ---- Graceful CDN image fallback -------------------------------------------
   A freshly-uploaded R2 object can 404 at the edge for a few seconds before it
   propagates. Rather than hiding the <img>, retry the same URL once (cache-
   busted), then try an alternate size variant, then settle on a neutral dark
   placeholder. Scoped to the resolved CDN root; capped via data-fb so it never
   loops. Wire it with onerror="cdnImgError(this)". */
const CDN_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'>" +
  "<rect width='100%' height='100%' fill='#0a0a0a'/>" +
  "<text x='50%' y='50%' fill='#2b2b2b' font-family='monospace' " +
  "font-size='18' text-anchor='middle' dominant-baseline='central'>//</text></svg>"
);

function cdnImgError(img) {
  const url = img.currentSrc || img.src || '';
  // CDN images only. Compare against the root RESOLVED against this page: in a
  // Site-in-a-ZIP copy the meta holds a relative `../cdn` while currentSrc is
  // an absolute file:// URL, so the raw string never matched and no saved
  // page ever fell back to another size.
  if (url.indexOf(new URL(cdnRoot(), location.href).href) === -1) return;
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
  img.src = CDN_PLACEHOLDER;
}

/* ---- "Get the drop" subscribe ----------------------------------------------
   The shared POST /api/subscribe flow behind every email capture (theWall,
   About, /os, the Photo Lab). Honeypot-guarded, disables the button in flight,
   swaps the form for the confirmation on success. */
async function submitGTD(inputId, formId, okId, errId, source) {
  const input = document.getElementById(inputId);
  const form = document.getElementById(formId);
  const ok = document.getElementById(okId);
  const err = document.getElementById(errId);
  const email = input.value.trim();
  if (!email) return;
  var hp = form.querySelector('.gtd-hp input');
  if (hp && hp.value) return;
  var btn = form.querySelector('.gtd-submit');
  if (btn) btn.disabled = true;
  if (err) err.textContent = '';
  try {
    var res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, source: source })
    });
    var data = await res.json();
    if (data.ok) {
      form.style.display = 'none';
      ok.style.display = 'flex';
    } else {
      if (err) err.textContent = data.error || 'something went wrong';
      if (btn) btn.disabled = false;
    }
  } catch (e) {
    if (err) err.textContent = 'connection error, try again';
    if (btn) btn.disabled = false;
  }
}

/* ---- Viewport settle hook ---------------------------------------------------
   A debounced resize/orientationchange callback. (This used to also refresh a
   --vh var for the old Safari 100vh workaround; that's retired — no CSS reads
   var(--vh), the layouts use svh/dvh.) Kept because a couple of pages re-fit an
   open overlay once the viewport settles — archive's lightbox, theWall's Photo
   Lab. Opt-in: only those pages call it. */
function onViewportSettle(cb) {
  let t;
  function onChange() {
    clearTimeout(t);
    t = setTimeout(cb, 150);
  }
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
}

/* ---- Mobile nav -------------------------------------------------------------
   The hamburger opens .nav-mobile; tapping any link inside it closes both.
   Guarded so it no-ops on a page without the nav chrome. */
function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const mobileNav = document.getElementById('nav-mobile');
  if (!toggle || !mobileNav) return;
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('is-open');
    mobileNav.classList.toggle('is-open');
  });
  mobileNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      toggle.classList.remove('is-open');
      mobileNav.classList.remove('is-open');
    });
  });
}

/* ---- Auto-init --------------------------------------------------------------
   Runs synchronously when the script is reached near the end of <body>, so the
   nav chrome above is already parsed. Only the universally-wanted nav is
   auto-wired; the viewport-settle hook stays opt-in (see onViewportSettle). */
initMobileNav();
