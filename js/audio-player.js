/* ============================================================
   AUDIO-PLAYER.JS — the frameless waveform player
   ------------------------------------------------------------
   Classic script (window.AudioPlayer) — same posture as recent-index.js and
   lighttable.js: loaded via <script src>, copied verbatim into the
   site-in-a-ZIP export, and rendered offline from the data island. No build
   step, no imports, no third party. Native <audio> does the playing; the CSP
   already allows it (media-src 'self' + CDN), so this widens nothing.

   ONE player, three surfaces — the homepage card, the /listen permalink, and
   inline in a field note (where consecutive tracks auto-group into a
   tracklist). It has NO box, stroke or background of its own: every color is
   a theme token, so it reads as drawn into the page rather than dropped onto
   it, and every preset/theme gets it for free.

   THE WAVEFORM IS PRE-COMPUTED. Peaks (PEAK_COUNT values, 0–1) are measured
   ONCE in the console at attach time and travel in data/audio.json, so a
   visitor never downloads an audio file just to render a card. The <audio> is
   preload="none" — bytes are fetched only when someone presses play. That is
   what keeps a 12-track tracklist as cheap as a paragraph of text.

   Progress is ONE CSS custom property (--ap-progress, 0–1): the fill bar row
   is clipped to it, so painting is a single style write and the colors stay
   in CSS where the theme can reach them.
   ============================================================ */
(function () {
  'use strict';

  // Stored resolution. Every track in data/audio.json carries this many peaks;
  // display resamples DOWN per variant, so one stored array serves every
  // surface and changing a bar count never re-measures audio.
  var PEAK_COUNT = 96;

  // Bars drawn per variant. Deterministic (never measured from layout) — a
  // runtime auto-fit would cause layout shift and break the offline export,
  // the same reason recent-index.js tiers text by length instead of fitting.
  var BAR_COUNTS = { card: 56, full: 96, row: 40 };

  // A silent sample still gets a sliver of bar: a zero-height gap reads as a
  // rendering fault, a floor reads as intent.
  var BAR_FLOOR = 0.06;

  var SEEK_STEP = 5;   // seconds per arrow key

  // ---- pure helpers (exported for the test suite + the console) ----

  function clamp01(n) {
    var v = Number(n);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function normalizePeaks(peaks) {
    if (!peaks || typeof peaks.length !== 'number') return [];
    var out = [];
    for (var i = 0; i < peaks.length; i++) out.push(clamp01(peaks[i]));
    return out;
  }

  // Resample a peak array to `count` bars by bucket-averaging. Handles both
  // directions: downsampling averages each bucket, upsampling repeats the
  // nearest source value (start === end collapses to one sample).
  function resamplePeaks(peaks, count) {
    var src = normalizePeaks(peaks);
    var n = Math.floor(Number(count) || 0);
    if (!src.length || n < 1) return [];
    var out = [];
    for (var i = 0; i < n; i++) {
      var start = Math.floor((i * src.length) / n);
      var end = Math.floor(((i + 1) * src.length) / n);
      if (end <= start) end = start + 1;
      var sum = 0, seen = 0;
      for (var j = start; j < end && j < src.length; j++) { sum += src[j]; seen++; }
      out.push(seen ? sum / seen : 0);
    }
    return out;
  }

  // Peaks serialize as a compact comma string (2 decimals ≈ 4 bytes/bar, so a
  // 96-peak track costs ~400 bytes in data/audio.json — cheap enough to keep
  // in git, which is where derived-but-versioned content belongs).
  function peaksToString(peaks) {
    return normalizePeaks(peaks).map(function (p) {
      return String(Math.round(p * 100) / 100);
    }).join(',');
  }

  function peaksFromString(str) {
    if (!str) return [];
    return String(str).split(',').reduce(function (acc, part) {
      var t = part.trim();
      if (t !== '') acc.push(clamp01(parseFloat(t)));
      return acc;
    }, []);
  }

  // m:ss, or h:mm:ss once an hour is on the clock (podcast episodes get long).
  function formatTime(sec) {
    var s = Math.floor(Number(sec) || 0);
    if (!isFinite(s) || s < 0) s = 0;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var rest = s % 60;
    var mm = h ? (m < 10 ? '0' + m : String(m)) : String(m);
    return (h ? h + ':' : '') + mm + ':' + (rest < 10 ? '0' + rest : String(rest));
  }

  // The card badge — a duration reads better rounded up to whole minutes than
  // as a false-precision clock ("24 MIN", not "23:41").
  function durationLabel(sec) {
    var s = Math.floor(Number(sec) || 0);
    if (!isFinite(s) || s <= 0) return '';
    if (s < 60) return s + ' SEC';
    return Math.max(1, Math.round(s / 60)) + ' MIN';
  }

  // Split a list of elements into runs of DOM-adjacent siblings. This is what
  // turns "the author dropped three audio shortcodes in a row" into one
  // numbered tracklist, while a lone shortcode elsewhere in the post stays a
  // standalone player. Pure (it only reads `nextElementSibling`), so the
  // grouping rule is pinned by the test suite without a browser.
  function groupAdjacent(els) {
    var list = (els && typeof els.length === 'number') ? Array.prototype.slice.call(els) : [];
    var runs = [];
    var current = [];
    for (var i = 0; i < list.length; i++) {
      var prev = current.length ? current[current.length - 1] : null;
      if (prev && prev.nextElementSibling === list[i]) {
        current.push(list[i]);
      } else {
        if (current.length) runs.push(current);
        current = [list[i]];
      }
    }
    if (current.length) runs.push(current);
    return runs;
  }

  // A click at x within a track of width w → a fraction of the duration.
  function seekFraction(x, width) {
    var w = Number(width) || 0;
    if (w <= 0) return 0;
    return clamp01(Number(x) / w);
  }

  // ---- sets ----
  //
  // A SET is a named, ordered list of tracks with its own address
  // (/listen/?set=<slug>), saved on the audio shelf. Tracks are referenced BY
  // SLUG, never copied: a slug is already a track's permanent address, so a set
  // survives a re-titled track, and a track that goes away simply drops out.
  //
  // This resolver lives HERE, in the shared audio module, because three
  // surfaces ask the same question and "what does this set play" must not have
  // three answers: the console's SETS shelf, the /listen/?set= page, and the
  // homepage audio card. The console loads this file for exactly that reason —
  // the same move the Cards view makes with recent-index.js.
  //
  // Dropped silently: a slug with no entry, and one whose entry is a RETIRED
  // tombstone — an address reserved with no media behind it. The set is a list
  // of intentions; the registry is the truth about what exists.
  function resolveSetTracks(set, registry) {
    var byTrack = {};
    (registry || []).forEach(function (t) {
      if (t && t.slug && t.filename && !t.retired) byTrack[t.slug] = t;
    });
    return ((set && set.tracks) || [])
      .map(function (slug) { return byTrack[slug]; })
      .filter(function (t) { return !!t; });
  }

  var g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  var API = {
    PEAK_COUNT: PEAK_COUNT,
    BAR_COUNTS: BAR_COUNTS,
    BAR_FLOOR: BAR_FLOOR,
    clamp01: clamp01,
    normalizePeaks: normalizePeaks,
    resamplePeaks: resamplePeaks,
    peaksToString: peaksToString,
    peaksFromString: peaksFromString,
    formatTime: formatTime,
    durationLabel: durationLabel,
    seekFraction: seekFraction,
    groupAdjacent: groupAdjacent,
    resolveSetTracks: resolveSetTracks,
  };
  g.AudioPlayer = API;

  // Everything below needs a DOM. Bailing here keeps the Node import pure so
  // the vitest suite can exercise the helpers above without a browser.
  if (typeof document === 'undefined') return;

  // ---- CDN audio URL — mirrors recent-index.js frameSrc() ----
  function cdnRoot() {
    var meta = document.querySelector('meta[name="cdn-base"]');
    return ((meta && meta.content) || (location.origin + '/api/cdn')).replace(/\/+$/, '');
  }

  function audioSrc(filename) {
    var f = String(filename || '');
    if (/^(https?:)?\/\//.test(f) || f.charAt(0) === '/') return f;  // already a URL
    return cdnRoot() + '/audio/' + encodeURIComponent(f);
  }
  API.audioSrc = audioSrc;

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ---- one-at-a-time playback ----
  // Every mounted player registers here so starting one stops the rest. This
  // is what makes a tracklist feel like a record rather than a pile of
  // widgets. Also covers players on different surfaces of the same page.
  var mounted = [];
  function pauseOthers(except) {
    for (var i = 0; i < mounted.length; i++) {
      if (mounted[i] !== except) mounted[i].pause();
    }
  }

  // ---- scrolling title ----
  // A title too long for its box slides, but only when there is something to
  // see: paused-by-default, driven by a CSS animation, and switched off
  // entirely under prefers-reduced-motion (the CSS handles that half).
  function marquee(node) {
    if (!node) return;
    // Measure after layout — scrollWidth is only meaningful once painted.
    var check = function () {
      var overflows = node.scrollWidth - node.clientWidth > 1;
      node.classList.toggle('is-long', overflows);
      if (overflows) {
        // Distance to travel, as a CSS var, so the animation runs at a
        // constant speed regardless of how much overflow there is.
        var over = node.scrollWidth - node.clientWidth;
        node.style.setProperty('--ap-scroll', '-' + over + 'px');
        node.style.setProperty('--ap-scroll-dur', Math.max(4, over / 22) + 's');
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(check);
    else check();
  }
  API.marquee = marquee;

  // ---- copy / share (mirrors js/page-wall.js shareWallpaper) ----
  //
  // Split apart because /listen's Subscribe block needs the clipboard on its
  // own: a feed address goes INTO a podcast app, so a button labelled COPY has
  // to copy on every device rather than open an OS share sheet on some of
  // them. `share` still prefers the sheet where there is one and falls back to
  // exactly this, so there remains one clipboard implementation and one
  // copied-state affordance.
  function copy(url, btn) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(url).then(function () {
      if (!btn) return;
      var was = btn.getAttribute('aria-label') || '';
      btn.classList.add('copied');
      btn.setAttribute('aria-label', 'Link copied');
      setTimeout(function () {
        btn.classList.remove('copied');
        btn.setAttribute('aria-label', was);
      }, 1500);
    }).catch(function () {});
  }
  API.copy = copy;

  function share(url, title, btn) {
    if (navigator.share) {
      navigator.share({ title: title || '', url: url }).catch(function () {});
      return;
    }
    copy(url, btn);
  }
  API.share = share;

  // ---- the player ----
  // opts: { src|filename, peaks, duration, variant, title, sub }
  function create(opts) {
    var o = opts || {};
    var variant = BAR_COUNTS[o.variant] ? o.variant : 'full';
    var barCount = BAR_COUNTS[variant];
    var duration = Number(o.duration) || 0;

    var root = el('div', 'ap ap-' + variant);
    root.style.setProperty('--ap-progress', '0');

    // -- play/pause: a bare mark, no circle or pill --
    var play = el('button', 'ap-play');
    play.type = 'button';
    play.setAttribute('aria-label', 'Play');
    play.innerHTML =
      '<svg class="ap-glyph ap-glyph-play" viewBox="0 0 14 16" aria-hidden="true" focusable="false">' +
      '<path d="M1 1.2 L13 8 L1 14.8 Z"/></svg>' +
      '<svg class="ap-glyph ap-glyph-pause" viewBox="0 0 14 16" aria-hidden="true" focusable="false">' +
      '<path d="M2 1.5h3.4v13H2z M8.6 1.5H12v13H8.6z"/></svg>';

    // -- waveform: the whole thing is the seek surface --
    var wave = el('div', 'ap-wave');
    wave.setAttribute('role', 'slider');
    wave.setAttribute('tabindex', '0');
    wave.setAttribute('aria-label', 'Seek');
    wave.setAttribute('aria-valuemin', '0');
    wave.setAttribute('aria-valuemax', String(Math.round(duration)));
    wave.setAttribute('aria-valuenow', '0');
    wave.setAttribute('aria-valuetext', formatTime(0));

    var heights = resamplePeaks(o.peaks, barCount);
    if (!heights.length) {
      // No peaks (a legacy or hand-written entry) — a flat, quiet rail still
      // seeks and still reads as a player, so the surface degrades instead of
      // collapsing.
      heights = [];
      for (var k = 0; k < barCount; k++) heights.push(0.34);
      root.classList.add('ap-flat');
    }

    function barRow(cls) {
      var row = el('div', 'ap-bars ' + cls);
      var frag = document.createDocumentFragment();
      for (var i = 0; i < heights.length; i++) {
        var b = el('span', 'ap-bar');
        var h = Math.max(BAR_FLOOR, heights[i]);
        b.style.height = (Math.round(h * 1000) / 10) + '%';
        frag.appendChild(b);
      }
      row.appendChild(frag);
      row.setAttribute('aria-hidden', 'true');
      return row;
    }
    wave.appendChild(barRow('ap-bars-base'));
    wave.appendChild(barRow('ap-bars-fill'));

    var time = el('span', 'ap-time');
    time.textContent = duration ? formatTime(duration) : '--:--';

    root.appendChild(play);
    root.appendChild(wave);
    root.appendChild(time);

    // -- the audio element: created now, fetched on INTENT --
    //
    // `preload="none"` is load-bearing and stays: a homepage carrying this card,
    // or a post carrying a six-track list, must not pull audio nobody asked for.
    // Drawing the waveform from stored peaks is what buys that.
    //
    // But "nothing until the click" also means the click is where the entire
    // round trip *begins* — connection, headers, first bytes — and that is the
    // pause between pressing play and hearing anything. So the fetch starts one
    // beat earlier, on intent: reaching for the transport with a pointer,
    // putting a finger down on it, or tabbing to it. A visitor who never
    // reaches for the player still downloads nothing.
    var audio = el('audio');
    audio.preload = 'none';
    audio.src = audioSrc(o.src || o.filename);
    if (o.title) audio.setAttribute('title', o.title);
    root.appendChild(audio);

    // Has this visitor pressed play on this player yet? Once they have, the
    // opt-in is no longer in question, so later tracks buffer as soon as they
    // are loaded rather than waiting for another press.
    var engaged = false;

    function warm() {
      // Only from a standing start: readyState 0 with no request in flight.
      // Calling load() on a player that is already buffering (or playing)
      // would abort and restart it — the opposite of the point.
      if (!audio.paused || audio.readyState !== 0) return;
      if (audio.networkState === 2 /* NETWORK_LOADING */) return;
      audio.preload = 'auto';
      try { audio.load(); } catch (e) {}
    }

    function loadTrack(newOpts, autoPlay) {
      o = newOpts || {};
      duration = Number(o.duration) || 0;
      audio.pause();
      // A queue advance on an engaged player: start fetching with the src, not
      // with the play() that follows it.
      audio.preload = engaged ? 'auto' : 'none';
      audio.src = audioSrc(o.src || o.filename);
      if (o.title) audio.setAttribute('title', o.title);
      else audio.removeAttribute('title');
      audio.currentTime = 0;

      heights = resamplePeaks(o.peaks, barCount);
      if (!heights.length) {
        heights = [];
        for (var k = 0; k < barCount; k++) heights.push(0.34);
        root.classList.add('ap-flat');
      } else {
        root.classList.remove('ap-flat');
      }
      wave.innerHTML = '';
      wave.appendChild(barRow('ap-bars-base'));
      wave.appendChild(barRow('ap-bars-fill'));
      wave.setAttribute('aria-valuemax', String(Math.round(duration)));

      // A new track starts clean. fail() latches is-error on the ROOT, which
      // outlives the track that caused it — so without this a single 404 in a
      // playlist left every later track painted as unavailable, with the dead
      // "could not be loaded" tooltip still on the card.
      root.classList.remove('is-error');
      root.removeAttribute('title');
      play.setAttribute('aria-label', 'Play');

      paint();
      if (autoPlay) start();
    }

    var api = {
      root: root,
      audio: audio,
      pause: function () { try { audio.pause(); } catch (e) {} },
      play: function () { try { start(); } catch (e) {} },
      loadTrack: loadTrack,
      warm: warm,
    };

    function knownDuration() {
      return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    }

    function paint() {
      var total = knownDuration();
      var pct = total > 0 ? clamp01(audio.currentTime / total) : 0;
      root.style.setProperty('--ap-progress', String(pct));
      wave.setAttribute('aria-valuenow', String(Math.round(audio.currentTime || 0)));
      wave.setAttribute('aria-valuetext', formatTime(audio.currentTime || 0));
      // Count DOWN while playing (how much is left is the useful number), and
      // show the full length at rest.
      time.textContent = (!audio.paused && total > 0)
        ? '-' + formatTime(Math.max(0, total - audio.currentTime))
        : (total > 0 ? formatTime(total) : '--:--');
    }

    function setPlayingUi(playing) {
      root.classList.toggle('is-playing', playing);
      play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      // Surfaces that wrap the player (the card wants its title to scroll
      // while the track runs) get told rather than reaching into it.
      if (typeof o.onstate === 'function') o.onstate(playing);
    }

    // -- failure has to be visible --
    // Every play() rejection and every media error used to land in an empty
    // catch, so a track that could not load looked exactly like a track nobody
    // had pressed yet: the button did nothing in Chromium, and Safari flashed
    // play→pause and settled. That is the worst possible reading of a broken
    // file, because it blames the click. The player now says so — on itself,
    // to assistive tech, and once in the console for whoever is debugging.
    function fail(why) {
      root.classList.add('is-error');
      root.classList.remove('is-playing');
      time.textContent = '—';
      play.setAttribute('aria-label', 'Unavailable');
      root.setAttribute('title', 'This track could not be loaded.');
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[audio-player] ' + (o.title || 'track') + ': ' + why, audio.src);
      }
    }

    // A media error is the file's fault (404, wrong type, codec) and is final.
    audio.addEventListener('error', function () {
      var code = audio.error && audio.error.code;
      fail('could not load' + (code ? ' (media error ' + code + ')' : ''));
    });

    function start() {
      var p = audio.play();
      // Older browsers return undefined rather than a promise.
      if (p && typeof p.catch === 'function') {
        p.catch(function (err) {
          // NotAllowedError is the autoplay policy talking, not a broken file —
          // the visitor pressed the button, so this only fires for programmatic
          // starts, and it must not paint a track as unavailable.
          if (err && err.name === 'NotAllowedError') return;
          fail(err && err.name ? err.name : 'playback failed');
        });
      }
    }

    play.addEventListener('click', function (e) {
      // The card wraps this player in a link; a press here is a transport
      // control, never navigation.
      e.preventDefault();
      e.stopPropagation();
      if (audio.paused) start();
      else audio.pause();
    });

    // Intent, in the three ways it arrives. `pointerenter` is the big one on a
    // desktop — the hover before a click is worth hundreds of milliseconds —
    // and `pointerdown` is what a phone gives you, which is still the whole
    // press-and-release gap. `focus` covers the keyboard.
    ['pointerenter', 'pointerdown', 'focus'].forEach(function (evt) {
      play.addEventListener(evt, warm);
      wave.addEventListener(evt, warm);
    });

    audio.addEventListener('play', function () {
      engaged = true;
      pauseOthers(api);
      setPlayingUi(true);
      paint();
    });
    audio.addEventListener('pause', function () { setPlayingUi(false); paint(); });
    audio.addEventListener('ended', function () {
      setPlayingUi(false);
      audio.currentTime = 0;
      paint();
      if (typeof o.onended === 'function') {
        o.onended();
        return;
      }
      // Surfaces that lay tracks out as sibling rows get auto-advance for free.
      // A surface that drives its own queue (the homepage playlist card) passes
      // onended above and returns before reaching this. `.wk-playlist-track`
      // used to be listed here and matches nothing in the markup — the playlist
      // row is `.wk-pl-item`.
      var trackContainer = root.closest('.fn-track, .wk-pl-item, .lt-row');
      if (trackContainer && trackContainer.nextElementSibling) {
        var nextPlayBtn = trackContainer.nextElementSibling.querySelector('.ap-play');
        if (nextPlayBtn) nextPlayBtn.click();
      }
    });
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('loadedmetadata', function () {
      if (isFinite(audio.duration) && audio.duration > 0) {
        wave.setAttribute('aria-valuemax', String(Math.round(audio.duration)));
      }
      paint();
    });

    // -- seeking: press anywhere on the wave, drag to scrub --
    function seekToEvent(ev) {
      var total = knownDuration();
      if (total <= 0) return;
      var rect = wave.getBoundingClientRect();
      var x = (ev.clientX != null ? ev.clientX : 0) - rect.left;
      audio.currentTime = seekFraction(x, rect.width) * total;
      paint();
    }

    var scrubbing = false;
    wave.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      scrubbing = true;
      try { wave.setPointerCapture(ev.pointerId); } catch (e) {}
      seekToEvent(ev);
    });
    wave.addEventListener('pointermove', function (ev) {
      if (scrubbing) seekToEvent(ev);
    });
    function endScrub(ev) {
      if (!scrubbing) return;
      scrubbing = false;
      try { wave.releasePointerCapture(ev.pointerId); } catch (e) {}
    }
    wave.addEventListener('pointerup', endScrub);
    wave.addEventListener('pointercancel', endScrub);

    // Keyboard: the wave is a slider, so arrows scrub and space toggles.
    wave.addEventListener('keydown', function (ev) {
      var total = knownDuration();
      var handled = true;
      if (ev.key === 'ArrowRight') audio.currentTime = Math.min(total, audio.currentTime + SEEK_STEP);
      else if (ev.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - SEEK_STEP);
      else if (ev.key === 'Home') audio.currentTime = 0;
      else if (ev.key === 'End') audio.currentTime = Math.max(0, total - 0.25);
      else if (ev.key === ' ' || ev.key === 'Enter') {
        if (audio.paused) start(); else audio.pause();
      } else handled = false;
      if (handled) { ev.preventDefault(); ev.stopPropagation(); paint(); }
    });

    // A click anywhere on the player chrome shouldn't follow the card's link.
    root.addEventListener('click', function (ev) {
      if (ev.target === root) return;
      ev.stopPropagation();
    });

    mounted.push(api);
    paint();
    return api;
  }
  API.create = create;

  // ---- warming a track that is not mounted yet ----
  //
  // A surface driving a queue (the soundboard card) knows which file is coming
  // next while the current one is still playing, and that is dead time the
  // network could be using. `warm(src)` buffers it on a detached element, so
  // the switch swaps between buffers instead of starting a round trip. The same
  // call serves a hover over a row further down the list, which is a stronger
  // signal of intent than "it is next".
  //
  // ONE element, reused — a six-track card must warm the next track, not pull
  // six files at once — and only ever after the visitor has started playback,
  // which is the caller's job to respect.
  var warmEl = null;
  var warmedUrl = '';
  function warm(src) {
    if (typeof document === 'undefined') return;
    var url = audioSrc(src);
    if (!url || url === warmedUrl) return;
    if (!warmEl) {
      warmEl = document.createElement('audio');
      warmEl.preload = 'auto';
      warmEl.muted = true;   // never mounted and never started, but belt and braces
    }
    warmedUrl = url;
    warmEl.src = url;
    try { warmEl.load(); } catch (e) {}
  }
  API.warm = warm;

  // Mount every [data-ap-src] placeholder under `root`. This is how the
  // markdown renderer and the permalink page get players without either of
  // them knowing how one is built.
  function scan(root) {
    var host = root || document;
    var nodes = host.querySelectorAll('[data-ap-src]:not([data-ap-ready])');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      node.setAttribute('data-ap-ready', '1');
      var player = create({
        src: node.getAttribute('data-ap-src'),
        peaks: peaksFromString(node.getAttribute('data-ap-peaks')),
        duration: parseFloat(node.getAttribute('data-ap-duration')) || 0,
        variant: node.getAttribute('data-ap-variant') || 'full',
        title: node.getAttribute('data-ap-title') || '',
      });
      node.appendChild(player.root);
    }
  }
  API.scan = scan;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(); });
  } else {
    scan();
  }
})();
