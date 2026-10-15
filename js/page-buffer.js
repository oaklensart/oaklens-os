// theBuffer (rolling contact sheet) page. Loaded deferred, after lighttable.js
// (which now delegates image-error handling) and mode-toggle.js. Externalized
// from an inline <script> so the page satisfies a strict script-src (no
// 'unsafe-inline').

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

function getMonthLabel(dateStr) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const [y, m] = dateStr.split('-');
  return `${months[parseInt(m) - 1]} ${y}`;
}

// ---- Mobile scroll reveal (buffer-page specific) ----
let _dayBlocks = [];
let mobileObserver = null;

// Stable id <-> positional frame-number maps for shareable per-frame URLs.
// Frame numbers are positional and roll as the buffer turns over, so share
// links key on entry.id; these maps bridge to the number-based lightbox.
let _idToNum = new Map();
let _numToId = new Map();

function initMobileScrollReveal() {
  if (window.innerWidth > 640) {
    if (mobileObserver) {
      mobileObserver.disconnect();
      mobileObserver = null;
    }
    return;
  }

  if (mobileObserver) mobileObserver.disconnect();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('lit');
      } else {
        entry.target.classList.remove('lit');
      }
    });
  }, {
    rootMargin: '0% 0px -65% 0px',
    threshold: 0
  });

  _dayBlocks.forEach(block => observer.observe(block));
  mobileObserver = observer;

  const endEl = document.querySelector('.buffer-end');
  if (endEl) {
    const bottomObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        _dayBlocks.forEach(block => {
          const rect = block.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            block.classList.add('lit');
          }
        });
      }
    }, { threshold: 0 });
    bottomObserver.observe(endEl);
  }
}

// ---- Frame Search ----
const _fsInput = document.getElementById('frame-search-input');
const _fsBtn   = document.getElementById('frame-search-btn');

function openFrameByNumber(num) {
  const padded = String(num).padStart(3, '0');
  const target = document.querySelector('.frame[data-frame="' + padded + '"]');
  if (!target) return false;
  target.click();
  const dayBlock = target.closest('.day-block');
  if (dayBlock) {
    if (!dayBlock.classList.contains('lit')) dayBlock.classList.add('lit');
    dayBlock.scrollIntoView({ behavior: 'auto', block: 'center' });
  }
  return true;
}

function _fsShakeError() {
  _fsInput.classList.remove('shake');
  void _fsInput.offsetWidth;
  _fsInput.classList.add('shake');
  _fsInput.addEventListener('animationend', function() {
    _fsInput.classList.remove('shake');
    _fsInput.value = '';
  }, { once: true });
}

function _fsDoSearch() {
  const val = _fsInput.value.trim();
  if (!val) return;
  const num = parseInt(val, 10);
  if (isNaN(num) || num < 1) { _fsShakeError(); return; }
  if (!openFrameByNumber(num)) _fsShakeError();
  else _fsInput.value = '';
}

_fsInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); _fsDoSearch(); }
});
_fsBtn.addEventListener('click', _fsDoSearch);

// ---- URL Hash Routing ----
const _lbEl      = document.getElementById('lightbox');
const _lbCounter = document.getElementById('lightbox-counter');
const _lbMeta    = document.getElementById('lightbox-meta');
let   _lbWasOpen = false;

function _getHashFrameNum() {
  if (!_lbMeta || _lbMeta.textContent.includes('BURST')) return null;
  if (!_lbCounter || !_lbCounter.textContent) return null;
  const m = _lbCounter.textContent.trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Write a crawlable ?f=<id> share URL for the open frame, falling back to the
// legacy #frame-<n> form if the id isn't known (e.g. burst frames).
function _writeFrameUrl(num) {
  const id = _numToId.get(num);
  if (id) history.replaceState(null, '', '?f=' + encodeURIComponent(id));
  else history.replaceState(null, '', '#frame-' + num);
}

// Detect lightbox open / close
new MutationObserver(function() {
  const isOpen = _lbEl.classList.contains('is-open');
  if (isOpen && !_lbWasOpen) {
    _lbWasOpen = true;
    const num = _getHashFrameNum();
    if (num) _writeFrameUrl(num);
  } else if (!isOpen && _lbWasOpen) {
    _lbWasOpen = false;
    history.replaceState(null, '', window.location.pathname);
  }
}).observe(_lbEl, { attributes: true, attributeFilter: ['class'] });

// Detect frame changes while lightbox stays open (arrow key nav)
new MutationObserver(function() {
  if (_lbEl.classList.contains('is-open')) {
    const num = _getHashFrameNum();
    if (num) _writeFrameUrl(num);
  }
}).observe(_lbCounter, { childList: true });

// Open a frame from /archive/buffer/?f=<id> (crawlable) or legacy #frame-<n>.
function handleUrlOpen() {
  const fid = new URLSearchParams(window.location.search).get('f');
  if (fid) {
    const num = _idToNum.get(fid);
    if (num) { openFrameByNumber(num); return; }
  }
  const m = window.location.hash.match(/^#frame-(\d+)$/);
  if (m) {
    const num = parseInt(m[1], 10);
    if (num >= 1) openFrameByNumber(num);
  }
}

window.addEventListener('hashchange', handleUrlOpen);

// ---- Mobile lightbox nav ----
document.getElementById('lb-nav-prev').addEventListener('click', function(e) {
  e.stopPropagation();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
});
document.getElementById('lb-nav-next').addEventListener('click', function(e) {
  e.stopPropagation();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
});

// ---- Month rail: the roll's index ----
//
// One mark per month, newest first, spread over whatever height sits between
// the nav and the footer (the rail is bounded in CSS; the marks share it). It
// replaced a decorative column of rotated "MON YYYY" labels, 125px a month,
// that had outgrown an iPad's landscape viewport at six months (2026-10-15).
//   · the month you are reading is lit, and the year above the rail follows it;
//   · a tap scrolls to that month's newest day;
//   · with less than DENSE_PX a month, labels give way to ticks except on the
//     first month, each January and the current one (.is-dense).
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DENSE_PX = 26;
let _railMonths = [];
let _railCurrent = '';

function _railFit() {
  const rail = document.getElementById('month-rail');
  const track = rail && rail.querySelector('.rail-track');
  if (!rail || rail.hidden || !track || !_railMonths.length) return;
  rail.classList.toggle('is-dense', track.clientHeight / _railMonths.length < DENSE_PX);
}

function _railSetCurrent(month) {
  if (!month || month === _railCurrent) return;
  _railCurrent = month;
  document.querySelectorAll('#rail-marks .rail-month').forEach((b) => {
    const on = b.dataset.month === month;
    b.classList.toggle('current', on);
    if (on) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  const year = document.getElementById('rail-year');
  if (year) year.textContent = month.slice(0, 4);
}

function buildMonthRail(days) {
  const rail = document.getElementById('month-rail');
  const marks = document.getElementById('rail-marks');
  if (!rail || !marks) return;
  _railMonths = [...new Set(days.map((d) => d.slice(0, 7)))];
  // One month has nothing to index.
  if (_railMonths.length < 2) return;

  _railMonths.forEach((m, i) => {
    const [y, mo] = m.split('-');
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-month' + ((i === 0 || mo === '01') ? ' is-anchor' : '');
    btn.dataset.month = m;
    btn.setAttribute('aria-label', `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`);
    // A January opens a year, so it says which: the year above the rail only
    // names the month you are in, and a dense rail can hold several Januaries.
    const yr = mo === '01' ? `<span class="rail-label-yr">\u2019${y.slice(2)}</span>` : '';
    btn.innerHTML = '<span class="rail-tick" aria-hidden="true"></span>'
      + `<span class="rail-label" aria-hidden="true">${getMonthLabel(m + '-01').slice(0, 3)}${yr}</span>`;
    btn.addEventListener('click', () => {
      const target = document.querySelector(`.day-block[data-date^="${m}"]`);
      if (!target) return;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    });
    li.appendChild(btn);
    marks.appendChild(li);
  });
  rail.hidden = false;
  _railSetCurrent(_railMonths[0]);
  _railFit();

  // The month being read is the one whose day block crosses a thin band
  // a little above the middle of the viewport.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) _railSetCurrent((e.target.dataset.date || '').slice(0, 7));
      }
    }, { rootMargin: '-38% 0px -58% 0px', threshold: 0 });
    document.querySelectorAll('#binder .day-block').forEach((b) => io.observe(b));
  }
}

// ---- Load buffer ----
async function loadBuffer() {
  const binder = document.getElementById('binder');
  const endEl = document.getElementById('buffer-end');

  let entries;
  try {
    const res = await fetch('/data/buffer.json');
    if (res.ok) {
      entries = await res.json();
      if (!entries.length) throw new Error('empty');
    } else throw new Error('no json');
  } catch {
    entries = [];
  }

  if (!entries.length) {
    binder.innerHTML =
      '<div class="page-empty">// BUFFER EMPTY' +
      '<span class="page-empty-hint">Drop photos in the Field Console to start the roll.</span></div>';
    return;
  }

  const frameNumbers = LightTable.assignFrameNumbers(entries);
  _idToNum = frameNumbers;
  _numToId = new Map();
  frameNumbers.forEach((num, id) => _numToId.set(num, id));
  const { days, byDay } = LightTable.groupByDay(entries);

  // Update stats
  document.getElementById('stat-frames').textContent = `${entries.length} FRAMES`;
  document.getElementById('stat-days').textContent = `${days.length} DAYS`;
  document.getElementById('stat-month').textContent = getMonthLabel(days[0]);

  // Render day blocks into a DocumentFragment, then commit once — a single DOM
  // insertion (one reflow) instead of appending to the live tree per day-block.
  const frag = document.createDocumentFragment();
  days.forEach(day => {
    const blockHtml = LightTable.renderDayBlock(byDay[day], frameNumbers);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = blockHtml;
    if (wrapper.firstElementChild) frag.appendChild(wrapper.firstElementChild);
  });
  binder.appendChild(frag);

  // Wire up interactivity
  const { dayBlocks, igniteButtons, state } = LightTable.initLightTable(binder);
  _dayBlocks = dayBlocks;
  LightTable.initLightbox(binder);
  LightTable.initLoupe(binder);
  LightTable.initKeyboardNav(binder);

  // End line
  endEl.innerHTML = '<span class="accent">//</span> END_OF_BUFFER <span class="accent">//</span>';

  buildMonthRail(days);

  const _hasFrameParam = new URLSearchParams(window.location.search).has('f');
  if (_hasFrameParam || /^#frame-\d+$/.test(window.location.hash)) {
    // Fast-path: direct link to a frame — skip ignition, open immediately
    handleUrlOpen();
    setTimeout(initMobileScrollReveal, 500);
  } else {
    // Normal path: full ignition sequence + delayed mobile reveal
    LightTable.runIgnitionSequence(dayBlocks, igniteButtons, state);
    const viewportBlockCount = dayBlocks.filter(b =>
      b.getBoundingClientRect().top < window.innerHeight
    ).length;
    const mobileRevealDelay = 2200 + (viewportBlockCount * 150) + 1500;
    setTimeout(initMobileScrollReveal, mobileRevealDelay);
  }
}

loadBuffer();

let __mobileRevealTimer;
window.addEventListener('resize', () => {
  clearTimeout(__mobileRevealTimer);
  __mobileRevealTimer = setTimeout(() => { initMobileScrollReveal(); _railFit(); }, 200);
});
window.addEventListener('orientationchange', () => {
  setTimeout(initMobileScrollReveal, 300);
});
