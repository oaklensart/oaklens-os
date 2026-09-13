/* ============================================================
   PAGE-LISTEN.JS — the /listen permalink + audio index
   ------------------------------------------------------------
   Classic script, same posture as recent-index.js: no imports, no build step,
   no third party. Renders from data/audio.json (and therefore from the offline
   export's data island through its fetch shim).

   Three views out of one page:
     /listen             → the index: every track, newest first, as rows
     /listen/?a=<slug>   → one track, full-size, with the rest listed beneath
     /listen/?set=<slug> → a saved set, in its own order, played top to bottom

   The per-track view is what a share link points at, and what the worker
   resolves OG tags for at the edge (src/edge/chrome.js getAudioOgData) — so
   the unfurl is correct even though the body below renders client-side.
   ============================================================ */
(function () {
  'use strict';

  // ---- pure helpers (exported for the test suite) ----

  // Newest first. `added_at` is the registry's own date; a missing one sorts
  // last rather than throwing the whole list out of order.
  function sortTracks(list) {
    return (Array.isArray(list) ? list.slice() : [])
      .filter(function (t) { return t && t.slug && t.filename; })
      .sort(function (a, b) {
        return String(b.added_at || '').localeCompare(String(a.added_at || ''));
      });
  }

  // The Subscribe block is DATA-driven, not config-driven: a site earns the
  // affordance by actually having an episode in the feed. (The crawler-facing
  // <link rel="alternate"> is the mirror image — config-driven, because it is
  // injected at the edge where the registry cannot be read. Two gates, one
  // truth, for a reason each.)
  function hasEpisodes(list) {
    return (Array.isArray(list) ? list : []).some(function (t) {
      return t && t.episode && t.slug && t.filename;
    });
  }

  function findTrack(list, slug) {
    if (!slug) return null;
    var found = (Array.isArray(list) ? list : []).find(function (t) {
      return t && t.slug === slug;
    });
    return found || null;
  }

  // ?a= / ?set= from a URL. Kept pure (takes a search string) so the routing is
  // testable without a browser.
  function paramFromSearch(search, key) {
    var m = new RegExp('[?&]' + key + '=([^&]*)').exec(String(search || ''));
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
  }
  function slugFromSearch(search) { return paramFromSearch(search, 'a'); }
  function setSlugFromSearch(search) { return paramFromSearch(search, 'set'); }

  // A set is matched on slug alone — unlike a track, whose lookup also requires
  // `filename` — because a set has no media of its own. What it must not match
  // is a RETIRED set: that record is a reserved address and nothing else, so
  // answering an old link with it would render an empty page under a name that
  // used to mean something.
  function findSet(sets, slug) {
    if (!slug) return null;
    var found = (Array.isArray(sets) ? sets : []).find(function (s) {
      return s && s.slug === slug && !s.retired;
    });
    return found || null;
  }

  var g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  g.PageListen = {
    sortTracks: sortTracks,
    hasEpisodes: hasEpisodes,
    findTrack: findTrack,
    findSet: findSet,
    slugFromSearch: slugFromSearch,
    setSlugFromSearch: setSlugFromSearch,
  };

  if (typeof document === 'undefined') return;

  var AP = g.AudioPlayer;

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function href(track) {
    return '/listen/?a=' + encodeURIComponent(track.slug || '');
  }

  function setHref(set) {
    return '/listen/?set=' + encodeURIComponent((set && set.slug) || '');
  }

  var SHARE_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 0.9 11.25 4.15 9.95 5.45 8.9 4.4 8.9 10.5 7.1 10.5 7.1 4.4 6.05 5.45 4.75 4.15Z"/>'
    + '<path d="M2.6 6.8h2.3v6.5h6.2V6.8h2.3v8.3H2.6z"/></svg>';
  var DOWNLOAD_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M7.1 0.9h1.8v6.1l1.05-1.05 1.3 1.3L8 10.5 4.75 7.25l1.3-1.3L7.1 7Z"/>'
    + '<path d="M2.6 11.2h2.3v2.1h6.2v-2.1h2.3v3.9H2.6z"/></svg>';

  function meta(track) {
    var bits = [];
    var dur = AP ? AP.durationLabel(track.duration) : '';
    if (dur) bits.push(dur);
    var yr = String(track.added_at || '').slice(0, 4);
    if (/^\d{4}$/.test(yr)) bits.push(yr);
    return bits.join(' · ');
  }

  function mountPlayer(host, track, variant) {
    if (!AP || typeof AP.create !== 'function') return;
    host.appendChild(AP.create({
      src: track.filename,
      peaks: AP.peaksFromString(track.peaks),
      duration: track.duration,
      variant: variant,
      title: track.title || '',
    }).root);
  }

  // ---- the featured track ----
  function renderFeature(host, track) {
    var eyebrow = el('div', 'lt-eyebrow');
    eyebrow.textContent = 'Audio';

    var title = el('h1', 'lt-title');
    title.textContent = track.title || 'Untitled';

    host.appendChild(eyebrow);
    host.appendChild(title);

    if (track.sub) {
      var sub = el('div', 'lt-sub');
      sub.textContent = track.sub;
      host.appendChild(sub);
    }

    var player = el('div', 'lt-player');
    mountPlayer(player, track, 'full');
    host.appendChild(player);

    var foot = el('div', 'lt-foot');
    var m = el('div', 'lt-meta');
    m.textContent = meta(track);
    foot.appendChild(m);

    var share = el('button', 'lt-action');
    share.type = 'button';
    share.innerHTML = SHARE_SVG + '<span>Share</span>';
    share.addEventListener('click', function () {
      if (AP) AP.share(location.origin + href(track), track.title || '', share);
    });
    foot.appendChild(share);

    // Off by default — a musician sharing stems opts in per track, and the
    // file already lives at a URL either way, so this is an invitation rather
    // than a lock.
    if (track.download && AP) {
      var dl = el('a', 'lt-action');
      dl.href = AP.audioSrc(track.filename);
      dl.setAttribute('download', '');
      dl.innerHTML = DOWNLOAD_SVG + '<span>Download</span>';
      foot.appendChild(dl);
    }

    host.appendChild(foot);
  }

  // ---- the list ----
  function renderList(host, tracks, label) {
    var head = el('div', 'lt-list-head');
    head.textContent = label;
    host.appendChild(head);

    tracks.forEach(function (track, i) {
      var row = el('div', 'lt-row');

      var num = el('div', 'lt-num');
      num.textContent = String(i + 1).padStart(2, '0');
      row.appendChild(num);

      var main = el('div', 'lt-row-main');

      var rt = el('div', 'lt-row-title');
      var link = el('a');
      link.href = href(track);
      link.textContent = track.title || 'Untitled';
      rt.appendChild(link);
      main.appendChild(rt);

      var rs = el('div', 'lt-row-sub');
      rs.textContent = [track.sub, meta(track)].filter(Boolean).join(' · ');
      main.appendChild(rs);

      mountPlayer(main, track, 'row');
      row.appendChild(main);
      host.appendChild(row);
    });
  }

  // ---- a saved set ----
  //
  // The set's own order, top to bottom, one row player each — so "play the
  // whole thing" is a tap and a scroll, and nothing downloads until one of
  // them is pressed, exactly as on the index.
  function renderSet(host, set, tracks) {
    var eyebrow = el('div', 'lt-eyebrow');
    eyebrow.textContent = 'Set';

    var title = el('h1', 'lt-title');
    title.textContent = set.name || 'Untitled set';

    host.appendChild(eyebrow);
    host.appendChild(title);

    var foot = el('div', 'lt-foot');
    var m = el('div', 'lt-meta');
    var total = tracks.reduce(function (n, t) { return n + (Number(t.duration) || 0); }, 0);
    m.textContent = [
      tracks.length + (tracks.length === 1 ? ' track' : ' tracks'),
      AP && total ? AP.durationLabel(total) : '',
    ].filter(Boolean).join(' · ');
    foot.appendChild(m);

    var share = el('button', 'lt-action');
    share.type = 'button';
    share.innerHTML = SHARE_SVG + '<span>Share</span>';
    share.addEventListener('click', function () {
      if (AP) AP.share(location.origin + setHref(set), set.name || '', share);
    });
    foot.appendChild(share);
    host.appendChild(foot);

    renderList(host, tracks, 'In this set');
  }

  // ---- subscribe ----
  //
  // The feed is the whole point of marking a track as an EPISODE, and until now
  // nothing on the site pointed at it — you had to already know the address.
  // The address is shown as text as well as wired to a button, because "copy"
  // fails silently in a browser with no clipboard permission and a URL you can
  // read is a URL you can retype.
  //
  // ⚠️ Public pages run a STRICT CSP: no inline <script>, no onclick=. Wired
  // with addEventListener, like every other control on this page.
  function renderSubscribe(host) {
    var url = location.origin + '/podcast.xml';

    var box = el('div', 'lt-subscribe');

    var head = el('div', 'lt-sub-head');
    head.textContent = 'Subscribe';
    box.appendChild(head);

    var note = el('div', 'lt-sub-note');
    note.textContent = 'Paste this address into Apple Podcasts, Overcast, Pocket Casts — any podcast app.';
    box.appendChild(note);

    var row = el('div', 'lt-sub-row');

    var link = el('a', 'lt-sub-url');
    link.href = '/podcast.xml';
    link.textContent = url;
    row.appendChild(link);

    var copy = el('button', 'lt-action');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy feed address');
    copy.innerHTML = SHARE_SVG + '<span>Copy</span>';
    copy.addEventListener('click', function () {
      if (AP) AP.copy(url, copy);
    });
    row.appendChild(copy);

    box.appendChild(row);
    host.appendChild(box);
  }

  function render() {
    var host = document.getElementById('listen');
    if (!host) return;

    // Two reads, one render. The sets file is OPTIONAL: a fork that has never
    // made one has no data/audio-sets.json, and a 404 must leave the track
    // views working exactly as before — so it resolves to [] rather than
    // sinking the page.
    Promise.all([
      fetch('/data/audio.json')
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; }),
      fetch('/data/audio-sets.json')
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; }),
    ])
      .then(function (both) {
        var data = both[0];
        var sets = Array.isArray(both[1]) ? both[1] : [];
        var tracks = sortTracks(data);
        var slug = slugFromSearch(location.search);
        var featured = findTrack(tracks, slug);
        // A set is resolved against the WHOLE registry, not the sorted list:
        // sortTracks is the index's newest-first ordering, and a set's own
        // order is the only one that matters here.
        var set = findSet(sets, setSlugFromSearch(location.search));
        var setTracks = (set && AP && AP.resolveSetTracks) ? AP.resolveSetTracks(set, data) : [];
        // A set whose every track has gone falls back to the index rather than
        // rendering a title over nothing.
        if (!setTracks.length) set = null;

        host.textContent = '';
        host.setAttribute('data-view', set ? 'set' : featured ? 'track' : 'index');

        if (!tracks.length) {
          var empty = el('div', 'lt-empty');
          empty.textContent = '// nothing here yet';
          host.appendChild(empty);
          return;
        }

        if (set) {
          renderSet(host, set, setTracks);
          // Same title swap the track view makes, for the same reason: the
          // served <title> is composed at the edge and is set-aware there, but
          // a tab opened from an in-page link never went through the edge.
          var setSuffix = /^Listen([\s\S]*)$/.exec(document.title);
          if (set.name) document.title = set.name + (setSuffix ? setSuffix[1] : '');
        } else if (featured) {
          renderFeature(host, featured);
          var rest = tracks.filter(function (t) { return t.slug !== featured.slug; });
          if (rest.length) renderList(host, rest, 'More');
          // The served <title> is track-neutral ("Listen — WORDMARK", composed
          // at the edge); once we know which track this is, say so, so the tab
          // and any bookmark carry the track name like the og:title already
          // does. Only the leading word is swapped — the site's own suffix,
          // whatever shape it takes, is left alone.
          var suffix = /^Listen([\s\S]*)$/.exec(document.title);
          if (featured.title) document.title = featured.title + (suffix ? suffix[1] : '');
        } else {
          renderList(host, tracks, tracks.length + (tracks.length === 1 ? ' track' : ' tracks'));
        }

        // Last, on both views: someone reading one episode is exactly who wants
        // the feed, and someone reading the index has just been shown the show.
        if (hasEpisodes(tracks)) renderSubscribe(host);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
