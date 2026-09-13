/* ============================================================
   PAGE-CARD.JS — a composed card at its own address
   ------------------------------------------------------------
   Classic script, same posture as page-listen.js and recent-index.js: no
   imports, no build step, no third party. Renders from data/cards.json (and
   therefore from the offline export's data island through its fetch shim).

   A card is a content type, and a content type has a permanent URL
   (docs/cards-core-complete.md, owner decision 2.1(1)). This page is that URL:
   one card, at its native 4:5, with its label and a link through to whatever
   it opens. Nothing else.

   THE CARD IS NOT DRAWN HERE. It is drawn by js/recent-index.js — buildCard,
   the same function the homepage calls, fed by composedItem, the same resolver
   composedPick uses. One renderer per kind, on this page too: a second
   implementation would be the exact drift chunk 1 spent itself removing.

   TWO SPELLINGS OF THE ADDRESS, one canonical:
     /card/<id>     the real address — the worker serves this document for it
     /card/?id=<id> the same card, for a context with no worker in front of it
   The second is what makes the page mean anything inside the offline export,
   where there is no server to map a path onto a file. Path wins when both are
   present, because that is the one a share link carries.
   ============================================================ */
(function () {
  'use strict';

  // ---- pure helpers (exported for the test suite) ----

  // The id this page is showing, from the path first and the query second.
  // Kept pure (takes the two strings) so the routing is testable without a
  // browser. An id is whatever the console mints — `c-<uid>` today — so this
  // validates the SHAPE rather than the prefix: a permanent address must not
  // stop resolving because a later console mints ids differently.
  function idFromLocation(pathname, search) {
    var m = /^\/card\/([^/?#]+)\/?$/.exec(String(pathname || ''));
    // A SEGMENT WITH A DOT IN IT IS A FILE, NOT A CARD. The edge's _validCardId
    // already refuses one, so `/card/index.html` never reaches the route and
    // falls through to the asset layer — which serves THIS page, query and all.
    // Without this the path branch then claimed "index.html" as the id and
    // ignored the ?id= beside it, so every card was "no card here" on a static
    // server, a staging host, or any preview that spells out index.html. Found
    // by a code review; the file:// export dodged it only because its pathname
    // does not start at /card/.
    if (m && m[1].indexOf('.') === -1) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    var q = /[?&]id=([^&]*)/.exec(String(search || ''));
    if (!q) return '';
    try { return decodeURIComponent(q[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
  }

  // The record at this address, or null. A RETIRED card is a tombstone — a
  // reserved id holding nothing — so it never matches here either. Online the
  // worker has already answered 410 before this document was served; this is
  // the same answer for every other context (the export, a stale copy), and
  // the two must not disagree about what a tombstone means.
  function findCard(cards, id) {
    if (!id) return null;
    var found = (Array.isArray(cards) ? cards : []).find(function (c) {
      return c && c.id === id && !c.retired;
    });
    return found || null;
  }

  var g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  g.PageCard = {
    idFromLocation: idFromLocation,
    findCard: findCard,
  };

  if (typeof document === 'undefined') return;

  // `no-cache` — revalidate, never serve the browser's copy blind. /data/*.json
  // is served with a five-minute freshness window (the _headers rule), which is
  // right for the homepage and wrong for THIS page: its whole job is to answer
  // one address, and the common way to reach it is a link pasted the minute the
  // card was published. A browser that had cards.json from before that publish
  // would say "no card here" for five minutes. Revalidation is a 304 when
  // nothing moved, so the cost is one round trip, not the file.
  //
  // Deliberately NOT a `?t=<now>` cache-buster: that would miss the CDN cache
  // on every visit too, re-downloading audio.json (which carries every track's
  // waveform) for every visitor of every card, and the offline export's fetch
  // shim would have to strip it. Revalidation asks the same question politely.
  function getJson(path) {
    return fetch(path, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // Nothing at this address. Deliberately not an error: the common way to land
  // here is a link typed wrong or a card that was never published, and neither
  // is the visitor's fault.
  function renderEmpty(host) {
    var box = el('div', 'cardp-empty');
    box.innerHTML = '// no card at this address<br><a href="/">Back to the homepage</a>';
    host.appendChild(box);
  }

  function render() {
    var host = document.getElementById('card-page');
    if (!host) return;
    var id = idFromLocation(location.pathname, location.search);
    var RI = g.RecentIndex;
    if (!id || !RI || typeof RI.buildCard !== 'function') return renderEmpty(host);

    Promise.all([
      getJson('/data/cards.json'),
      // Only an audio card reads these two, and it reads them the way the
      // homepage does — the registry answers what a card plays, the record
      // never copies it (chunk 5). Missing and empty mean the same thing.
      getJson('/data/audio.json'),
      getJson('/data/audio-sets.json'),
    ]).then(function (res) {
      var card = findCard(res[0], id);
      if (!card) return renderEmpty(host);
      var audio = Array.isArray(res[1]) ? res[1] : [];
      var sets = Array.isArray(res[2]) ? res[2] : [];

      // NO EYEBROW ABOVE THE CARD. There was one, and opening the page killed
      // it: every card already wears its own label — the kicker on a words
      // tile, the on-media chip on a picture — so a line above the card saying
      // FEATURED over a card saying FEATURED is the same word twice, and the
      // page's copy is the one that is not part of the design.
      var shell = el('div', 'cardp-card');
      shell.appendChild(RI.buildCard(RI.composedItem(card, audio, sets)));
      host.appendChild(shell);

      // Where the card opens, spelled once by the engine — composedLink is the
      // same same-origin guard the grid applies, so this page can never send a
      // visitor somewhere the homepage would refuse to.
      var through = RI.composedLink ? RI.composedLink(card) : '';
      if (through) {
        var a = el('a', 'cardp-through');
        a.href = through;
        a.textContent = 'Open the full thing →';
        host.appendChild(a);
      }

      // The served <title> is composed at the edge and is already card-aware
      // there; a tab opened from an in-page link never went through the edge.
      // Only the leading word is swapped — the site's own suffix, whatever
      // shape it takes, is left alone. (The /listen precedent, same reason.)
      var suffix = /^Card([\s\S]*)$/.exec(document.title);
      var name = String(card.title || '').trim();
      if (name) document.title = name + (suffix ? suffix[1] : '');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
