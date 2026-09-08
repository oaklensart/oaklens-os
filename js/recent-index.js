/* ============================================================
   RECENT-INDEX.JS — homepage "recent work" grid
   ------------------------------------------------------------
   Classic script (window.RecentIndex) — same posture as lighttable.js: loaded
   via <script src>, copied verbatim into the site-in-a-ZIP export
   (js/export-manifest.js `assets`), and rendered offline from the data island
   through the export's fetch() shim. No build step, no imports, no third party.

   Merges data/archive.json (photo cards) + data/posts.json (Field-Note text
   cards) + data/audio.json (audio cards), takes the most recent items, and
   renders a 3-up mixed row into #recent-index. Rendering goes through the
   card-engine seam (CARD_LAYOUTS / resolveLayout / CARD_KINDS / buildCard):
   kind is fixed identity, layout is a per-entry choice, and the default
   layout is byte-identical to the pre-engine renderer. Text cards carry the
   adaptive-tier craft: a render-time drop cap, a blinking editor caret, and
   statement/feature/standard sizing so short posts read as intentional and
   long ones fill like the preview. A note can instead opt into the `hero`
   layout and lead with its picture — gated on the picture actually being
   there, so a missing hero falls back to the text tile. Audio cards carry a
   waveform player drawn from pre-measured peaks (js/audio-player.js) — no
   audio is fetched until someone presses play. A MISSING data file (an un-seeded fork) falls back to
   the bundled CC0 samples — the same split the archive/wall pages make
   (missing → samples, empty → empty); audio has no samples and so treats both
   the same.
   ============================================================ */
(function () {
  'use strict';

  var GRID_SIZE = 4;
  // The excerpt is a TEASE, not a summary — a line or two that ends on a clean
  // thought and makes a reader open the post. Deliberately short: a wall of
  // text on the homepage buries the tile's neighbours and gets skipped. Long
  // posts get trimmed to their first sentence(s); the type scales up to fill.
  var TEASE_MAX = 150;

  // ---- strip: mirror worker.js feedSummary()'s cleaning so a card reads the
  //      same as the feed — drop HTML + shortcode divs, markdown images,
  //      links→text, headings, bare embed URLs (Apple Music), emphasis/code
  //      chars; collapse whitespace. No truncation here (tiering wants the full
  //      length). ----
  function recentStrip(md) {
    if (!md) return '';
    return String(md)
      .replace(/<[^>]*>/g, ' ')                  // HTML passthrough + shortcode divs
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // markdown images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links → their text
      .replace(/^#{1,6}\s+/gm, '')               // headings
      .replace(/^https?:\/\/\S+$/gm, ' ')        // bare embed links (Apple Music)
      .replace(/[*_`>~]/g, '')                   // emphasis/code/quote chars
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---- truncate: cut long text to `max`, preferring a clean sentence end in
  //      the back half (reads finished, no dangling ellipsis) and falling back
  //      to a word boundary + ellipsis. Short text is returned whole. ----
  function recentTruncate(t, max) {
    if (max == null) max = TEASE_MAX;
    if (!t || t.length <= max) return t || '';
    var cut = t.slice(0, max);
    var sent = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    if (sent > max * 0.55) return cut.slice(0, sent + 1);
    var brk = cut.lastIndexOf(' ');
    return cut.slice(0, brk > 0 ? brk : max) + '…';
  }

  // strip + truncate, for callers/tests that want the finished excerpt in one.
  function recentExcerpt(md, max) {
    return recentTruncate(recentStrip(md), max);
  }

  // ---- tier: the TEASE length → statement | feature | standard. Deterministic
  //      (no runtime auto-fit — that causes layout shift and breaks the offline
  //      export). Type size steps DOWN as the tease gets longer (see the
  //      .wk-text[data-tier] rules) so a one-liner becomes a big pull-quote and
  //      a two/three-line tease a slightly smaller one — every tier stays
  //      glanceable and fills the tile with balanced margins, never a wall. ----
  function recentTier(len) {
    if (len <= 55) return 'statement';
    if (len <= 105) return 'feature';
    return 'standard';
  }

  // ---- tierLen: how long a line is TO A READER. String.length counts UTF-16
  //      code units, which over-counts everything interesting: an emoji with a
  //      variation selector is 2, a ZWJ sequence 3+, and "日暮れ" is fine but a
  //      surrogate-pair character is not. Over-counting tiers a short line as a
  //      long one and costs it the display treatment. Intl.Segmenter counts
  //      graphemes — what a person would call a character. Shared by the pulse
  //      card and the field-note text card so both ladders agree, and mirrored
  //      server-side by pulseTierLen() in src/shared/pulse.js. ----
  var _seg = null;
  function tierLen(text) {
    var s = String(text == null ? '' : text);
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      if (!_seg) _seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
      var n = 0;
      // eslint-disable-next-line no-unused-vars
      for (var _ of _seg.segment(s)) n += 1;
      return n;
    }
    return (typeof Array.from === 'function' ? Array.from(s) : s.split('')).length;
  }

  // ---- drop-cap initial: the first grapheme, but only when it is a Latin
  //      letter. A leading quote / number / emoji / non-Latin char (or an empty
  //      excerpt) returns '' and the caller skips the cap — never render a
  //      broken cap. ----
  function recentInitial(text) {
    var s = String(text || '');
    var ch = (typeof Array.from === 'function' ? Array.from(s) : s.split(''))[0] || '';
    return /[A-Za-z]/.test(ch) ? ch : '';
  }

  // ---- card focal point: the recent-work card is a tall 4:5 crop, so a frame
  //      may carry its own `cardFocus` tuned for it. Fall back to the shared
  //      thumbnail `focus`, then '' (CSS center). Keeping this pure lets the
  //      test suite pin the fallback without a DOM. ----
  function cardFocus(entry) {
    return (entry && (entry.cardFocus || entry.focus)) || '';
  }

  // ---- RAW (buffer) cards: the owner can "feature" a raw buffer frame — a
  //      daily — onto the grid, cited as "RAW · f#NNN". Capped to ONE card for
  //      now (RAW_MAX); the server hands over a few featured frames so opening
  //      this up to fill more slots later is a one-line change here. Pure so the
  //      cap is pinned by the test suite. ----
  var RAW_MAX = 1;
  function rawPick(featured, max) {
    if (max == null) max = RAW_MAX;
    return (featured || []).filter(function (r) { return r && r.filename; }).slice(0, max);
  }

  // A featured RAW daily is PINNED and always shows, no matter its capture date
  // — so the owner can feature ANY frame from ANY period and have it land on
  // the homepage. Where it lands is pinTop's job (below); with no featured
  // frame the caller keeps the normal newest-first mix and the freshest item
  // reclaims the card.

  // ---- Audio cards: fed ONLY from the audio registry (data/audio.json), never
  //      deduced from a post's mix of text and media. An entry the owner flags
  //      `featured` surfaces as a play-card, exactly the way a buffer frame's
  //      `featured` surfaces the RAW daily. Capped to one for now — a card is a
  //      single statement; an EP is a field note with a tracklist. ----
  var AUDIO_MAX_PLAYLIST = 6;
  function audioPick(list, max) {
    var limit = max != null ? max : 1;
    var featured = (list || [])
      .filter(function (a) { return a && (a.featured || a.featured_order) && a.filename && a.slug; });
    featured.sort(function (a, b) {
      var ordA = typeof a.featured_order === 'number' ? a.featured_order : 999;
      var ordB = typeof b.featured_order === 'number' ? b.featured_order : 999;
      if (ordA !== ordB) return ordA - ordB;
      return 0;
    });
    return featured.slice(0, limit);
  }

  // A featured track outranks the RAW daily, so with both up the running order
  // is audio then RAW (see pinTop for the rank and why it is an order rather
  // than a card number).

  // ---- Pulse: the live card, pinned to the FIRST slot ----
  // Fed from /api/pulse (D1), not from a data file — posting a pulse must not
  // cost a deploy. It only exists while it is fresh; the endpoint hands back
  // nothing once it expires, so the grid heals with no cleanup here.
  function pulsePick(payload) {
    var m = payload && payload.pulse;
    if (!m) return null;
    // A pulse needs a line or a glyph. An empty tile on the homepage is not a
    // statement, it is a bug that looks like a decision.
    var hasText = !!(m.text && m.text.trim());
    var hasGlyph = !!(m.glyphs && m.glyphs.trim());
    return (hasText || hasGlyph) ? m : null;
  }

  // ---- THE PIN RANK: pins own an ORDER, never a card number ----
  // Ranked pulse → audio → RAW, the live pins take the FIRST cards of the row
  // and the newest-first pool fills whatever is left. So a pulse leads whenever
  // one is live, the content pin sits directly under it, and the most recent
  // work lands in card 2 or card 3 depending on how many pins are up. Pins
  // COMPACT: with no pulse the content pin moves up to card 1 rather than
  // holding a chair for something that isn't there.
  //
  // ⚠️ This replaced three ABSOLUTE slot indexes (pulse 0, audio 1, RAW 2)
  // spliced in one after another, pulse LAST. Every splice shifted everything
  // after it, so a live pulse pushed the RAW pin from card 3 to card 4 — the
  // tablet-only card, hidden on desktop and phone. The owner starred a frame
  // and the homepage never showed it. Absolute indexes were the bug, and they
  // were individually right and collectively wrong: nothing in them said "a pin
  // sits after the pins above it", so they only held while one pin was in play.
  // Keep pins ordered; do not give one a number back.
  // (2026-08-27 — docs/maintenance/2026-08-27-starred-frame-hidden-fourth-slot.md)
  //
  // THE PIN BUDGET rides on top of the rank. Desktop shows 3 of the 4 cards, so
  // three pins would mean a homepage where NOTHING is actually recent — three
  // owner-chosen tiles and no work. At most TWO pins are visible at once: when a
  // pulse is live, the OLDER of (featured audio, featured RAW) yields its pin
  // and DOES NOT RENDER this cycle. It is not demoted into the newest-first
  // pool: that pool holds archive + posts only, and a featured item can be from
  // any period — a starred 2019 frame would lose every date comparison in it
  // anyway, so it would vanish either way, but *sometimes*, depending on what
  // else was published. Deterministic absence beats random presence. (This
  // comment claimed the demotion happened until 2026-08-23; the code never did
  // it, and the code is right.) At least one card is always genuinely recent.
  // VISIBLE_PINS is enforced HERE, not just described: pinTop takes the pins in
  // rank order and stops at two, so the third card can never be a pin no matter
  // what the caller hands over. yieldOlderPin already decides WHICH pin gives
  // way — this is the structural floor under it, and it is what keeps the
  // "at least one card is genuinely recent" invariant true by construction if a
  // fourth pin is ever added above.
  var VISIBLE_PINS = 2;
  function pinTop(pins, items, gridSize) {
    var row = [];
    for (var i = 0; i < (pins || []).length && row.length < VISIBLE_PINS; i++) {
      if (pins[i]) row.push(pins[i]);
    }
    return row.concat(items || []).slice(0, gridSize);
  }

  // Which of the two content pins keeps its slot when a pulse is live. Newer
  // wins; a missing date sorts last. Pure, so the rule is pinned by tests.
  // A pulse's tier comes off the SAME ladder the text cards use — recentTier —
  // measured in graphemes. The one extra rung is `glyph`: a pulse with no words
  // at all is a legitimate post, and it wants the whole tile for its mark
  // rather than a display line's worth of space with nothing in it.
  function pulseTier(pulse) {
    var text = (pulse && pulse.text) || '';
    if (!text.trim()) return 'glyph';
    return recentTier(tierLen(text.trim()));
  }

  function yieldOlderPin(audioItem, rawItem) {
    if (!audioItem || !rawItem) return { audio: audioItem, raw: rawItem, yielded: null };
    var ad = String(audioItem.d || '');
    var rd = String(rawItem.d || '');
    if (ad >= rd) return { audio: audioItem, raw: null, yielded: 'raw' };
    return { audio: null, raw: rawItem, yielded: 'audio' };
  }

  // ---- dates ----
  // Mirror worker.js feedDate(): added_at (ISO) then date (YYYY-MM-DD).
  function itemDate(x) { return x.added_at || x.date || ''; }
  // Meta year: prefer a trailing 4-digit year in a frame's location ("San
  // Francisco, 2025" → the shoot year the archive shows); else the record year.
  function yearOf(x) {
    var m = String(x.location || '').match(/(\d{4})\D*$/);
    if (m) return m[1];
    var y = String(itemDate(x)).slice(0, 4);
    return /^\d{4}$/.test(y) ? y : '';
  }

  // ---- selection: newest first, but keep the row mixed ----
  // The barrel this replaces was a mixed "Latest" feed; the owner wants the
  // recent-work grid to surface both the photography and the writing. So when
  // both datasets are non-empty but the top-N came out single-type, trade the
  // oldest pick for the newest item of the missing type, then re-sort by date.
  //
  // ⚠️ THIS IS THE AUTOMATIC ROW, AND ITS BODY MUST NOT CHANGE. Composed cards
  // are overlaid by pickRecent() below rather than woven in here, so a site with
  // no composed cards gets an array that is identical to the one this function
  // has always returned — the fork guarantee holds by construction rather than
  // by a test remembering to check it (docs/ideas/homepage-card-system.md, "the
  // default layer is load-bearing and comes first").
  function pickAutomatic(archive, posts, rawFeatured, audioFeatured, pulse) {
    var items = []
      .concat((archive || [])
        .filter(function (e) { return e && e.filename && e.slug; })
        .map(function (e) { return { kind: 'photo', data: e, d: itemDate(e) }; }))
      .concat((posts || [])
        .filter(function (p) { return p && p.fn_id; })
        .map(function (p) { return { kind: 'text', data: p, d: itemDate(p) }; }));

    items.sort(function (a, b) { return String(b.d).localeCompare(String(a.d)); });

    // Featured items are PINNED and always show regardless of date — the rest
    // fills newest-first behind them, in the rank pinTop applies. When nothing
    // is featured, fall through to the normal mixed newest-first grid.
    var audio = audioPick(audioFeatured, AUDIO_MAX_PLAYLIST);
    var raw = rawPick(rawFeatured);
    var live = pulsePick(pulse);

    var audioItem = null;
    if (audio.length > 1) {
      audioItem = { kind: 'audio', data: { isPlaylist: true, tracks: audio }, d: audio[0].added_at || '' };
    } else if (audio.length === 1) {
      audioItem = { kind: 'audio', data: audio[0], d: audio[0].added_at || '' };
    }
    var rawItem = raw.length ? { kind: 'photo', raw: true, data: raw[0], d: raw[0].captured_at || '' } : null;

    // With a live pulse there are three candidate pins for two visible cards —
    // the older content pin yields and does not render this cycle (the budget
    // and the reason it is absence rather than demotion are on pinTop above).
    if (live && audioItem && rawItem) {
      var kept = yieldOlderPin(audioItem, rawItem);
      audioItem = kept.audio;
      rawItem = kept.raw;
    }

    if (live || audioItem || rawItem) {
      return pinTop([
        live ? { kind: 'pulse', data: live, d: '' } : null,
        audioItem,
        rawItem,
      ], items, GRID_SIZE);
    }

    var picks = items.slice(0, GRID_SIZE);

    var hasPhoto = items.some(function (i) { return i.kind === 'photo'; });
    var hasText = items.some(function (i) { return i.kind === 'text'; });
    function ensure(kind) {
      if (picks.length < GRID_SIZE) return;
      if (picks.some(function (i) { return i.kind === kind; })) return;
      var newest = items.find(function (i) { return i.kind === kind; });
      if (newest) picks[picks.length - 1] = newest;
    }
    if (hasPhoto && hasText) { ensure('photo'); ensure('text'); }

    picks.sort(function (a, b) { return String(b.d).localeCompare(String(a.d)); });

    // Evaluation adjustment: if the only text card is in the 4th slot,
    // swap it with the 3rd slot so it displays in 3-card (desktop/mobile) views.
    if (picks.length === 4 && picks[3].kind === 'text' && !picks.slice(0, 3).some(function (i) { return i.kind === 'text'; })) {
      var temp = picks[2];
      picks[2] = picks[3];
      picks[3] = temp;
    }

    return picks;
  }

  // ---- COMPOSED CARDS — the owner's own cards, overlaid on the automatic row ----
  //
  // A composed card is one the owner built in the console: a picture chosen from
  // anywhere on the site (or uploaded), words typed onto the card itself, or
  // both. It is an OVERRIDE on the grid, never a replacement for it — the row
  // still fills itself and a composed card simply takes a place near the front.
  //
  // ORDER, NOT A SLOT INDEX. Composed cards carry `order` (1, 2, …) and compact:
  // delete the first and the second moves up. Absolute slot indexes are the
  // mistake this project has already paid for once — three of them let a live
  // pulse push a starred frame into the tablet-only fourth card, which nobody
  // saw for weeks (docs/maintenance/2026-08-27-starred-frame-hidden-fourth-slot.md).
  // pinTop learned it; so does this.
  var COMPOSED_MAX = 2;

  // A card needs SOMETHING to show. One with neither a picture nor a line is a
  // draft the owner never finished, and rendering an empty tile would be worse
  // than leaving the slot to the automatic pick.
  function composedPick(cards) {
    return (cards || [])
      .filter(function (c) {
        return c && (heroFilename({ hero: c.media }) || String(c.title || c.tease || '').trim());
      })
      .sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); })
      .slice(0, COMPOSED_MAX)
      .map(function (c) { return { kind: 'composed', data: c, d: c.added_at || '' }; });
  }

  // The automatic row, with the owner's cards inserted after the pulse.
  //
  // A LIVE PULSE STILL LEADS (owner, 2026-09-07). The pulse is live, costs no
  // deploy and expires on its own in 18h; a composed card that suppressed it
  // would make posting one silently do nothing. So composed cards fill in behind
  // it and everything automatic shifts down, falling off the end at GRID_SIZE.
  //
  // Note what is NOT touched: pinTop, VISIBLE_PINS and yieldOlderPin all behave
  // exactly as before. Composed cards are not pins — the pin budget still
  // governs only the automatic audio/RAW pair, and "card 3 is never an automatic
  // pin" stays true.
  function pickRecent(archive, posts, rawFeatured, audioFeatured, pulse, composed) {
    var row = pickAutomatic(archive, posts, rawFeatured, audioFeatured, pulse);
    var made = composedPick(composed);
    if (!made.length) return row;
    var usedMedia = made.map(function (m) { return composedMedia(m.data); }).filter(Boolean);
    if (usedMedia.length) {
      row = row.filter(function (item) {
        if (!item || !item.data) return true;
        var fn = item.data.filename || item.data.hero_filename || item.data.slug;
        return !fn || usedMedia.indexOf(fn) === -1;
      });
    }
    var lead = (row[0] && row[0].kind === 'pulse') ? 1 : 0;
    return row.slice(0, lead).concat(made).concat(row.slice(lead)).slice(0, GRID_SIZE);
  }

  // ---- THE CARD ENGINE (core seam) ----
  // A card is a KIND wearing a LAYOUT. Kind is identity and is fixed — photo,
  // text, audio, pulse — and each kind owns a small named set of layouts.
  // 'default' is always in the set and must ADD NOTHING to the markup: the
  // untouched grid has to stay byte-identical to the pre-engine renderer
  // (tests/card-engine.test.js pins this against captured fixtures), which is
  // what lets a fork that configures nothing keep publishing untouched.
  // A non-default layout surfaces as data-layout on the card root; JS sets
  // attributes, CSS owns everything downstream — the same division the tier
  // ladder already uses (data-tier), so a layout is a stylesheet concern the
  // moment it leaves this file.
  var CARD_LAYOUTS = {
    photo: ['default'],
    // 'hero': a field note leads with its hero picture instead of the
    // typographic tile. Opt-in per post (the FN composer writes
    // card: { layout: 'hero' }) and gated on the picture actually being
    // there — see CARD_GATES below.
    text: ['default', 'hero'],
    audio: ['default'],
    pulse: ['default'],
    // A composed card is the owner's own: its 'default' is SMART — picture-led
    // when it has a usable picture, the typographic tile when it does not — so
    // the common case needs no choice at all. 'hero' and 'plain' are the escape
    // hatch: force the picture, or force the words, when the automatic call is
    // not the one you wanted.
    composed: ['default', 'hero', 'plain'],
  };

  // An unknown or unregistered layout resolves to 'default', never to a broken
  // card: content published by a NEWER console (or hand-edited data) must
  // degrade to today's rendering on an older engine, not throw.
  function resolveLayout(kind, want) {
    var set = CARD_LAYOUTS[kind] || ['default'];
    return (typeof want === 'string' && set.indexOf(want) !== -1) ? want : 'default';
  }

  // The per-entry descriptor: an entry may carry `card: { layout: '<name>' }`.
  // The object shape (not a bare string) is deliberate — future per-card
  // decisions (slot intent, source) join it as keys instead of new top-level
  // fields on every content type. Absent, malformed, or unknown → default.
  function cardDescriptor(entry) {
    var c = entry && entry.card;
    return { layout: (c && typeof c.layout === 'string') ? c.layout : '' };
  }

  // ---- the image gate (v1) ----
  // The one thing a picture-backed layout needs is a picture it can build a
  // CDN URL from, and that means a bare filename: a data:/blob: composer
  // preview, an absolute URL or a path all resolve to a broken tile. Anything
  // doubtful returns '' — and a broken image on the homepage is worse than a
  // text card, so the layout falls back SILENTLY rather than half-rendering.
  // Deliberately a simple gate, not the full image ladder (owner decision,
  // 2026-08-23 — docs/cards-console-vision.md §3 Chunk 2).
  function heroFilename(entry) {
    var h = entry && (entry.hero_filename || entry.hero);
    if (typeof h !== 'string') return '';
    h = h.trim();
    if (!h || h.indexOf('/') !== -1 || /^[a-z][a-z0-9+.-]*:/i.test(h)) return '';
    return h;
  }

  // A composed card names its picture in `media`, under exactly the same rules —
  // one gate, two field names, so a card and a note cannot disagree about what
  // counts as a usable picture.
  function composedMedia(card) {
    return heroFilename({ hero: card && card.media });
  }

  // Which R2 folder a composed card's picture lives in. Wallpapers are the one
  // source whose derivatives sit outside `archive/`, so the card records the
  // folder when it is picked rather than making the renderer guess from the
  // filename.
  function composedFolder(card) {
    return (card && card.folder === 'wallpaper') ? 'wallpaper' : 'archive';
  }

  // The small chip on the card — what KIND of thing this is, in the owner's own
  // words ("Featured", "Archive", "New work").
  //
  // ⚠️ Deliberately NOT sharing the pulse card's old field name. A pre-rename
  // pulse row carries a discipline name in that field, and a renderer that read
  // one put a category title back on the homepage — tests/pulse-card.test.js
  // greps this whole file to forbid it, and that guard should keep its teeth.
  // One bad field name is not worth resurrecting for a different feature.
  function composedLabel(card) {
    var s = card && typeof card.label === 'string' ? card.label.trim() : '';
    return s || 'Featured';
  }

  // A registered layout answers "does the engine know this name". A GATE
  // answers "can THIS entry actually wear it" — the first is the engine's
  // vocabulary, the second is the content's, and they fail differently. Gates
  // live in a table rather than a branch in buildCard so the next picture-aware
  // layout (the image ladder, still future) lands as a rule here instead of a
  // special case in the dispatcher.
  var CARD_GATES = {
    text: {
      hero: function (entry) { return !!heroFilename(entry); },
    },
    composed: {
      // Forcing the picture forward needs a picture. Without one this falls back
      // to 'default', which for a composed card is already the text tile — so a
      // card that lost its image degrades quietly instead of rendering a hole.
      hero: function (entry) { return !!composedMedia(entry); },
    },
  };

  // Resolve the layout NAME, then let its gate veto it. 'default' has no gate
  // and never gets one — it is what everything falls back to.
  function layoutFor(kind, entry) {
    var layout = resolveLayout(kind, cardDescriptor(entry).layout);
    var gate = CARD_GATES[kind] && CARD_GATES[kind][layout];
    return (gate && !gate(entry)) ? 'default' : layout;
  }

  // ---- sample fallback: a MISSING data file is an un-seeded fork ----
  // Same contract as the archive/wall pages (manual §5.21): a file that fails
  // to load falls back to bundled CC0 samples, while a file that loads as []
  // means the content was cleared on purpose and stays empty. Before this the
  // homepage hid the recent-work section in both states, so a fresh fork's
  // homepage read emptier than its own archive page.
  //
  // The photo entries mirror the first three of page-archive.js
  // getSampleData() — same slugs, so the card links open the same sample
  // frames in the archive lightbox. The note mirrors posts/fn-sample.md
  // (which also ships in a fork, so the card's link renders a real post);
  // its body must stay in sync with that file — the test suite compares
  // them. Everything is dateless on purpose: with three photos ahead of one
  // note, pickRecent keeps concat order and its slot-3 swap lands the row as
  // photo · photo · note in the 3-up view — the fresh-fork target.
  function sampleFrames() {
    return ['First Shadow', 'In Flight', 'Golden Ray'].map(function (title, i) {
      return {
        slug: 'sample-' + String(i).padStart(2, '0'),
        filename: 'sample-' + String(i).padStart(2, '0'),
        title: title,
        location: 'Sample City, 2026',
        camera: 'Mirrorless',
      };
    });
  }
  function sampleNote() {
    return {
      fn_id: 'fn-sample',
      title: 'Learning to See Again',
      location: 'Sample City',
      body: 'The first walk with a new camera is never about the pictures — it is about learning to see again. Every block becomes an audition: the light on a wall you have passed a hundred times, the geometry of a stairwell that turns out to have rhythm.\n\nNothing from the first day survives the edit. That is fine. The frames were never the point — the point was recalibrating, walking slower, letting the eye catch on things the errand-brain filters out. A camera is just a reason to look.\n\nThis is a sample field note. It ships with the engine so a brand-new site has something on its Field Notes page and its homepage from the first minute — a stand-in, not a seed. Publish your first real note from the Field Console and this one steps aside.',
    };
  }
  // null = the fetch failed (missing file / un-seeded fork) → samples.
  // Anything else (including []) is real data and passes through.
  function withSampleFallback(data, samples) {
    return data === null ? samples : (Array.isArray(data) ? data : []);
  }

  // Expose the pure helpers for the test suite (Node) and for the offline
  // global. Harmless in the browser.
  var g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);
  g.RecentIndex = {
    recentStrip: recentStrip,
    recentTruncate: recentTruncate,
    recentExcerpt: recentExcerpt,
    recentTier: recentTier,
    tierLen: tierLen,
    recentInitial: recentInitial,
    pulsePick: pulsePick,
    pinTop: pinTop,
    yieldOlderPin: yieldOlderPin,
    pickAutomatic: pickAutomatic,
    composedPick: composedPick,
    composedMedia: composedMedia,
    composedFolder: composedFolder,
    composedLabel: composedLabel,
    composedLink: composedLink,
    COMPOSED_MAX: COMPOSED_MAX,
    pulseTier: pulseTier,
    playlistTier: playlistTier,
    cardFocus: cardFocus,
    rawPick: rawPick,
    audioPick: audioPick,
    pickRecent: pickRecent,
    cardLayouts: CARD_LAYOUTS,
    resolveLayout: resolveLayout,
    cardDescriptor: cardDescriptor,
    cardGates: CARD_GATES,
    layoutFor: layoutFor,
    heroFilename: heroFilename,
    sampleFrames: sampleFrames,
    sampleNote: sampleNote,
    withSampleFallback: withSampleFallback,
  };

  // Everything below needs a DOM. Bailing here keeps the Node import pure so the
  // vitest suite can exercise the helpers above without a browser.
  if (typeof document === 'undefined') return;

  // ---- CDN image URL — mirror archive/index.html cdnSrc() ----
  function cdnRoot() {
    var meta = document.querySelector('meta[name="cdn-base"]');
    return ((meta && meta.content) || (location.origin + '/api/cdn')).replace(/\/+$/, '');
  }
  // `folder` defaults to 'archive' — where every frame, hero and buffer picture
  // lives. A composed card may point at a wallpaper, whose derivatives sit under
  // `wallpaper/` instead, so the folder is a parameter rather than a constant.
  // Every existing caller passes nothing and behaves exactly as before.
  function frameSrc(filename, size, folder) {
    var base = encodeURIComponent(String(filename).replace(/\.[^.]+$/, ''));
    return cdnRoot() + '/' + (folder || 'archive') + '/' + base + '-' + size + 'w.webp';
  }

  // ---- DOM helpers ----
  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ---- frame number → f#NNN (zero-padded to 3, matching the console/light-table) ----
  function frameTag(num) { return 'f#' + String(num || 0).padStart(3, '0'); }

  // The canonical same-origin link to an entry, by the VISITOR kind it wears on
  // the grid — the ONE place a card's destination is spelled. The kind cards
  // (photo/RAW/text/audio) each call it, and a COMPOSED card spawned from one of
  // them copies its result into `card.link` so "edit this card" keeps the click
  // it inherited (the console seeds it; composedLink honours it). One source of
  // truth means the console can never point somewhere the grid would not.
  // 'audio' delegates to listenHref (defined below; declarations hoist) so the
  // audio permalink stays authored in exactly one place too.
  function entryHref(kind, entry) {
    var e = entry || {};
    if (kind === 'raw') return '/archive/buffer/?f=' + encodeURIComponent(e.id || '');
    if (kind === 'archive') return '/archive/?f=' + encodeURIComponent(e.slug || '');
    if (kind === 'text') return '/field-notes/post?slug=' + encodeURIComponent(e.fn_id || '');
    if (kind === 'audio') return listenHref(e);
    return '';
  }

  function photoCard(entry, isRaw) {
    var a = el('a', 'wk-card');
    // RAW cards deep-link to the buffer frame (by id — always exact); archive
    // cards to the curated frame (by slug). One builder, entryHref.
    a.href = entryHref(isRaw ? 'raw' : 'archive', entry);
    var img = el('div', 'wk-img');
    img.style.backgroundImage = "url('" + frameSrc(entry.filename, 1024) + "')";
    var cardPos = cardFocus(entry);
    if (cardPos) img.style.backgroundPosition = cardPos;
    var tag = el('span', 'wk-tag');
    tag.textContent = isRaw ? 'RAW' : 'Archive';
    img.appendChild(tag);
    var body = el('div', 'wk-body');
    var title = el('div', 'wk-title');
    // A buffer frame has no title — its identity IS the permanent frame number.
    title.textContent = isRaw ? frameTag(entry.num) : (entry.title || '');
    var meta = el('div', 'wk-meta');
    meta.textContent = isRaw
      ? String(entry.captured_at || '').slice(0, 4)
      : [entry.camera, yearOf(entry)].filter(Boolean).join(' · ');
    body.appendChild(title);
    body.appendChild(meta);
    a.appendChild(img);
    a.appendChild(body);
    return a;
  }

  function textCard(post) {
    var excerpt = recentTruncate(recentStrip(post.body), TEASE_MAX);
    // Grapheme-counted, like the pulse card: a tease in Japanese or one carrying
    // emoji used to over-count and tier a step too small.
    var tier = recentTier(tierLen(excerpt));
    var initial = recentInitial(excerpt);

    var a = el('a', 'wk-card wk-text');
    a.href = entryHref('text', post);
    a.setAttribute('data-tier', tier);

    var kicker = el('span', 'wk-kicker');
    var dot = el('span', 'wk-dot');
    dot.setAttribute('aria-hidden', 'true');
    kicker.appendChild(dot);
    kicker.appendChild(document.createTextNode('Field Note'));

    var title = el('div', 'wk-t-title');
    title.textContent = post.title || '';

    var snip = el('div', 'wk-snip');
    if (excerpt) {
      // Drop cap opens feature + standard (a bold graphic initial); statement
      // is all-display type, so no cap — the words are already the flourish.
      if (initial && tier !== 'statement') {
        var cap = el('span', 'wk-dropcap');
        cap.textContent = initial;
        snip.appendChild(cap);
        snip.appendChild(document.createTextNode(excerpt.slice(initial.length)));
      } else {
        snip.appendChild(document.createTextNode(excerpt));
      }
    }
    // Blinking editor caret — the note is "still being written." Text cards only.
    var caret = el('span', 'ed-caret');
    caret.setAttribute('aria-hidden', 'true');
    snip.appendChild(caret);

    var meta = el('div', 'wk-t-meta');
    meta.textContent = [post.location, yearOf(post)].filter(Boolean).join(' · ');

    a.appendChild(kicker);
    a.appendChild(title);
    a.appendChild(snip);
    a.appendChild(meta);
    return a;
  }

  // ---- field-note card, HERO layout (CARD_LAYOUTS.text: 'hero') ----
  // The engine's first real layout, and hero-FORWARD rather than "newsy"
  // (docs/field-note-card-vision.md): the picture does the visual work, the
  // title sits under it as a caption, and the note's identity is carried by
  // the same on-media chip the archive and RAW cards wear — not by a headline
  // stamped across the photograph. Nothing else touches the image, so the only
  // scrim in play is the one .wk-tag already brings, which is theme-
  // independent by construction because it sits on a photo rather than on the
  // page.
  //
  // Structurally this IS photoCard: same 4:5 background-image tile, same
  // cardFocus → focus → CSS-centre fallback, so a note whose hero was framed
  // for the wide OG crop degrades to a centred crop rather than to nothing.
  // The display face on the title is the one thing kept from the text tile — a
  // note's title is prose where a frame's is a label, and the type says so.
  //
  // Only reachable through the gate above: by the time this runs the entry has
  // a usable hero filename.
  function textHeroCard(post) {
    var a = el('a', 'wk-card wk-text');
    a.href = entryHref('text', post);

    var img = el('div', 'wk-img');
    img.style.backgroundImage = "url('" + frameSrc(heroFilename(post), 1024) + "')";
    var cardPos = cardFocus(post);
    if (cardPos) img.style.backgroundPosition = cardPos;
    var tag = el('span', 'wk-tag');
    tag.textContent = 'Field Note';
    img.appendChild(tag);

    var body = el('div', 'wk-body');
    var title = el('div', 'wk-t-title');
    title.textContent = post.title || '';
    var meta = el('div', 'wk-meta');
    meta.textContent = [post.location, yearOf(post)].filter(Boolean).join(' · ');
    body.appendChild(title);
    body.appendChild(meta);

    a.appendChild(img);
    a.appendChild(body);
    return a;
  }

  // ---- the composed card ----
  //
  // The owner's own card: a picture chosen from anywhere on the site (or none),
  // words typed onto the card itself (or none), and a link back to whatever it
  // came from (or none — a free-form card points nowhere, the way a pulse does).
  //
  // Deliberately NOT a new visual language. Picture-led is photoCard's shape;
  // text-led is textCard's, tier ladder included. A composed card should look
  // like it belongs on the grid, because it does.
  //
  // Only a same-origin path is honoured as a link. This is authored content that
  // rides publish, so a bad value is an editing mistake rather than an attack —
  // but a card that silently sent visitors off-site would be a bad surprise
  // either way, and a plain <div> is the honest degradation (pulseCard already
  // proves a card need not be an anchor).
  function composedLink(card) {
    var h = card && card.link;
    if (typeof h !== 'string') return '';
    h = h.trim();
    return (h.charAt(0) === '/' && h.charAt(1) !== '/') ? h : '';
  }

  function composedCard(card, layout) {
    var media = composedMedia(card);
    var picture = !!media && layout !== 'plain';
    var href = composedLink(card);
    var root = href ? el('a', '') : el('div', '');
    if (href) root.href = href;
    root.className = 'wk-card wk-composed' + (picture ? '' : ' wk-text');
    // data-shape is what the palette's picture-card tint binds to: without it the
    // atmospheric ground paints the root, which the full-bleed image and body
    // cover, so a palette on a picture card showed NOTHING on the live grid (and
    // in the console grid, which renders through here). The words shape reads the
    // ground on the root directly, but stamping both keeps one rule for the CSS.
    root.setAttribute('data-shape', picture ? 'picture' : 'words');
    if (card.palette && card.palette !== 'default') {
      root.setAttribute('data-state', card.palette);
    }

    if (picture) {
      var img = el('div', 'wk-img');
      img.style.backgroundImage = "url('"
        + frameSrc(media, 1024, composedFolder(card)) + "')";
      var pos = cardFocus(card);
      if (pos) img.style.backgroundPosition = pos;
      var tag = el('span', 'wk-tag');
      tag.textContent = composedLabel(card);
      img.appendChild(tag);

      var body = el('div', 'wk-body');
      // The picture card's caption, NOT the words-tile headline: a composed card
      // with a photo has to read like the archive card beside it (same .wk-title
      // scale and weight), or its title looms over the row and competes with the
      // picture. The big .wk-t-title is for the words shape, where the type IS the
      // card. (owner, 2026-09-07)
      var title = el('div', 'wk-title');
      title.textContent = card.title || '';
      body.appendChild(title);
      if (card.tease) {
        var meta = el('div', 'wk-meta');
        meta.textContent = card.tease;
        body.appendChild(meta);
      }
      root.appendChild(img);
      root.appendChild(body);
      return root;
    }

    // No picture (or 'plain'): the typographic tile, measured by the same ladder
    // the field-note card uses, so one grid never carries two type systems.
    var kicker = el('div', 'wk-kicker');
    kicker.appendChild(el('span', 'wk-dot'));
    kicker.appendChild(document.createTextNode(composedLabel(card)));

    var tTitle = el('div', 'wk-t-title');
    tTitle.textContent = card.title || '';

    var tease = recentTruncate(recentStrip(card.tease || ''), TEASE_MAX);
    root.setAttribute('data-tier', recentTier(tierLen(tease)));

    var snip = el('div', 'wk-snip');
    if (tease) snip.appendChild(document.createTextNode(tease));

    root.appendChild(kicker);
    root.appendChild(tTitle);
    root.appendChild(snip);
    return root;
  }

  // ---- audio card ----
  // Built from a registry entry, so every value on it was typed by the author
  // rather than guessed from a post's contents.
  //
  // The whole tile links to the /listen permalink through a stretched overlay
  // on the title's anchor. That keeps ONE anchor and ONE button in the markup:
  // a <button> nested inside an <a> is invalid HTML and unreadable to a screen
  // reader, which is the trap this pattern exists to avoid. CSS raises the
  // player and the share button above the overlay so they stay pressable.
  // A track's slug is its permanent address. WITHOUT one — a playlist card, or
  // a caller holding no entry at all — the honest destination is the listen page
  // itself: `/listen/?a=` with nothing after it is a dangling query that reads
  // as a broken link and tells the page to open a track that does not exist.
  function listenHref(entry) {
    var slug = (entry && entry.slug) || '';
    return slug ? '/listen/?a=' + encodeURIComponent(slug) : '/listen/';
  }

  var SHARE_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 0.9 11.25 4.15 9.95 5.45 8.9 4.4 8.9 10.5 7.1 10.5 7.1 4.4 6.05 5.45 4.75 4.15Z"/>'
    + '<path d="M2.6 6.8h2.3v6.5h6.2V6.8h2.3v8.3H2.6z"/></svg>';

  // ---- playlist tier: HOW MANY tracks → roomy | balanced | dense. The same
  //      idea as recentTier, measured in rows instead of graphemes: the index
  //      always fills the tile and stays optically centred, so two tracks get
  //      generous type and air while six tighten up rather than overflowing or
  //      leaving the card half empty. Deterministic — no runtime auto-fit, for
  //      the same reason the text ladder has none (layout shift, and the
  //      offline export has no layout to measure). The card is only built for
  //      2..AUDIO_MAX_PLAYLIST, but 1 is handled so the ladder is total. ----
  function playlistTier(count) {
    var n = Math.floor(Number(count) || 0);
    if (n <= 2) return 'roomy';
    if (n <= 4) return 'balanced';
    return 'dense';
  }

  function audioPlaylistCard(tracks) {
    var card = el('div', 'wk-card wk-audio wk-audio-playlist');
    var list = tracks || [];
    // Drives the .wk-audio-playlist[data-tier] rules, exactly as the text card
    // is driven by its own data-tier. data-tracks is the raw count, so a theme
    // can reach a single row count without re-deriving the ladder.
    card.setAttribute('data-tier', playlistTier(list.length));
    card.setAttribute('data-tracks', String(list.length));

    var kicker = el('span', 'wk-kicker');
    var led = el('span', 'wk-p-led');
    led.setAttribute('aria-hidden', 'true');
    kicker.appendChild(led);
    // SOUNDBOARD, not "Featured Playlist" (owner call, 2026-08-14). A playlist
    // is a music word, and the card is for whatever a studio makes noise with —
    // a score, a field recording, an episode, a voice memo, a loop. The kicker
    // carries the kind and the title carries the name, so neither repeats the
    // other.
    kicker.appendChild(document.createTextNode('Audio // Multi-track'));

    var title = el('div', 'wk-a-title');
    var link = el('a');
    link.href = '/listen/';
    link.textContent = 'Soundboard';
    title.appendChild(link);

    var totalSec = list.reduce(function (sum, t) { return sum + (Number(t.duration) || 0); }, 0);
    var AP = g.AudioPlayer;
    var hasPlayer = AP && typeof AP.create === 'function';
    var totalLabel = hasPlayer ? AP.durationLabel(totalSec) : '';

    var currentTrackIdx = 0;

    // No sub line here. The count and running time are the foot's job — the
    // card used to print "3 tracks · 59 SEC" under the title AND again in the
    // foot, the same six words twice on a tile the size of a postcard. The
    // single audio card's sub is a different thing (the artist line), which is
    // why that one stays.
    card.appendChild(kicker);
    card.appendChild(title);

    var player = null;
    var rowEls = [];

    function updateActiveUi(idx, isPlaying) {
      currentTrackIdx = idx;
      for (var r = 0; r < rowEls.length; r++) {
        rowEls[r].classList.toggle('is-active', r === idx);
        rowEls[r].classList.toggle('is-playing', r === idx && isPlaying);
      }
      card.classList.toggle('is-playing', isPlaying);
    }

    // ONE options builder, so every track the player is handed carries the SAME
    // callbacks. Both call sites used to spell the options out and pass
    // `onended: player.onended` when advancing — a property the player API
    // never exposed, so it was always undefined. The first track advanced (its
    // handler was written inline), the second inherited undefined and fell
    // through to the DOM-sibling fallback, which looks for a class this card
    // does not use. Auto-advance therefore stopped dead after track two.
    function trackOpts(idx) {
      var t = list[idx] || {};
      return {
        src: t.filename,
        peaks: AP.peaksFromString(t.peaks),
        duration: t.duration,
        variant: 'card',
        title: t.title || '',
        onstate: function (playing) {
          updateActiveUi(idx, playing);
          // Playback started, so the next track is no longer a guess — it is
          // what happens when this one ends. Buffer it while there is nothing
          // else to wait for, and the advance becomes a swap rather than a
          // fresh round trip. Nothing is warmed before the first press.
          if (playing) warmNext(idx);
        },
        onended: advance,
      };
    }

    function warmNext(idx) {
      var next = list[idx + 1];
      if (next && hasPlayer && typeof AP.warm === 'function') AP.warm(next.filename);
    }

    function advance() {
      var next = currentTrackIdx + 1;
      if (next < list.length) playTrack(next);
      else updateActiveUi(0, false);   // ran out — settle back on the top
    }

    function playTrack(idx) {
      if (!player) return;
      updateActiveUi(idx, true);
      player.loadTrack(trackOpts(idx), true);
    }

    if (hasPlayer && list.length) {
      player = AP.create(trackOpts(0));
      card.appendChild(player.root);
    }

    var listWrap = el('div', 'wk-pl-index');
    list.forEach(function (track, i) {
      var row = el('div', 'wk-pl-item' + (i === 0 ? ' is-active' : ''));

      var num = el('span', 'wk-pl-num');
      num.textContent = String(i + 1).padStart(2, '0');
      row.appendChild(num);

      var trackLink = el('a', 'wk-pl-name');
      trackLink.href = listenHref(track);
      trackLink.textContent = track.title || 'Untitled';
      row.appendChild(trackLink);

      var leader = el('span', 'wk-pl-leader');
      leader.setAttribute('aria-hidden', 'true');
      row.appendChild(leader);

      if (track.duration && hasPlayer) {
        var durSpan = el('span', 'wk-pl-dur');
        durSpan.textContent = AP.formatTime(track.duration);
        row.appendChild(durSpan);
      }

      // Reaching for a row is intent, the same as reaching for the transport:
      // start the fetch on the way in rather than on the press. Warming the
      // row that is ALREADY loaded is the player's own job (it holds the
      // element), so hand that one to the player and the rest to the shared
      // warmer.
      function warmThisRow() {
        if (!hasPlayer) return;
        if (currentTrackIdx === i) {
          if (player && typeof player.warm === 'function') player.warm();
        } else if (typeof AP.warm === 'function') {
          AP.warm(track.filename);
        }
      }
      row.addEventListener('pointerenter', warmThisRow);
      row.addEventListener('pointerdown', warmThisRow);

      row.addEventListener('click', function (ev) {
        if (ev.target && ev.target.tagName === 'A' && (ev.metaKey || ev.ctrlKey)) return;
        ev.preventDefault();
        ev.stopPropagation();

        if (!player) return;
        if (currentTrackIdx === i) {
          if (player.audio.paused) player.play();
          else player.pause();
        } else {
          playTrack(i);
        }
      });

      rowEls.push(row);
      listWrap.appendChild(row);
    });

    card.appendChild(listWrap);

    var foot = el('div', 'wk-a-foot');
    var meta = el('div', 'wk-a-meta');
    meta.textContent = list.length + ' tracks' + (totalLabel ? ' · ' + totalLabel : '');
    foot.appendChild(meta);

    var share = el('button', 'wk-a-share');
    share.type = 'button';
    share.setAttribute('aria-label', 'Share this soundboard');
    share.innerHTML = SHARE_SVG;
    share.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (hasPlayer) AP.share(location.origin + '/listen/', 'Soundboard', share);
    });
    foot.appendChild(share);

    card.appendChild(foot);
    return card;
  }

  // Exposed for the test contract (the pure helpers go up on g.RecentIndex
  // above the DOM bail; this one needs a document, so it is added here).
  // Harmless in the browser — same posture as worker.js's test re-exports.
  g.RecentIndex.audioPlaylistCard = audioPlaylistCard;

  function audioCard(entry) {
    if (entry && entry.isPlaylist && Array.isArray(entry.tracks)) {
      return audioPlaylistCard(entry.tracks);
    }
    var card = el('div', 'wk-card wk-audio');

    var kicker = el('span', 'wk-kicker');
    var led = el('span', 'wk-p-led');
    led.setAttribute('aria-hidden', 'true');
    kicker.appendChild(led);
    kicker.appendChild(document.createTextNode('Audio'));

    var title = el('div', 'wk-a-title');
    var link = el('a');
    link.href = listenHref(entry);
    link.textContent = entry.title || '';
    title.appendChild(link);

    card.appendChild(kicker);
    card.appendChild(title);

    if (entry.sub) {
      var sub = el('div', 'wk-a-sub');
      sub.textContent = entry.sub;
      card.appendChild(sub);
    }

    // The player is progressive enhancement: if audio-player.js failed to load
    // the card still reads and still links to the permalink, rather than
    // rendering as a broken tile.
    var AP = g.AudioPlayer;
    var hasPlayer = AP && typeof AP.create === 'function';
    if (hasPlayer) {
      var player = AP.create({
        src: entry.filename,
        peaks: AP.peaksFromString(entry.peaks),
        duration: entry.duration,
        variant: 'card',
        title: entry.title || '',
        // The card owns its own playing state so the title can scroll while
        // the track runs — the player tells it rather than the CSS reaching in.
        onstate: function (playing) { card.classList.toggle('is-playing', playing); },
      });
      card.appendChild(player.root);
      AP.marquee(title);
    }

    var foot = el('div', 'wk-a-foot');
    var meta = el('div', 'wk-a-meta');
    var bits = [];
    var dur = hasPlayer ? AP.durationLabel(entry.duration) : '';
    if (dur) bits.push(dur);
    var yr = yearOf(entry);
    if (yr) bits.push(yr);
    meta.textContent = bits.join(' · ');
    foot.appendChild(meta);

    var share = el('button', 'wk-a-share');
    share.type = 'button';
    share.setAttribute('aria-label', 'Share this track');
    share.innerHTML = SHARE_SVG;
    share.addEventListener('click', function (ev) {
      // Sits over the stretched card link — a press here shares, never navigates.
      ev.preventDefault();
      ev.stopPropagation();
      if (hasPlayer) AP.share(location.origin + listenHref(entry), entry.title || '', share);
    });
    foot.appendChild(share);

    card.appendChild(foot);
    return card;
  }

  // ---- pulse card ----
  // Every value on it was typed by the author. The tile is NOT a link — a pulse
  // goes nowhere — so it is a plain <div> with no pointer affordance, rather
  // than an <a> that lies about being clickable.
  //
  // THE LABEL IS A CONSTANT, not a field. A card that titled itself from the
  // starter pack the author happened to tap read PHOTOGRAPHY on one post and
  // TECH / DEV on the next, which told a cold reader nothing about what the tile
  // was. Every pulse says PULSE — including rows written before the change, so
  // the value is never read off the record.
  //
  // ⚠️ Mirrors PULSE_LABEL in src/shared/pulse.js. This file is a CLASSIC SCRIPT
  // on public pages and cannot import from src/, which is the same reason
  // tierLen is duplicated below. tests/pulse-card.test.js asserts the two agree.
  var PULSE_LABEL = 'PULSE';

  function pulseCard(pulse) {
    var card = el('div', 'wk-card wk-pulse');
    card.setAttribute('data-state', pulse.state || 'signal');
    card.setAttribute('data-tier', pulseTier(pulse));

    var kicker = el('div', 'wk-p-kicker');
    var label = el('span', 'wk-p-label');
    var led = el('span', 'wk-p-led');
    led.setAttribute('aria-hidden', 'true');
    label.appendChild(led);
    label.appendChild(document.createTextNode(PULSE_LABEL));
    kicker.appendChild(label);
    // The author's clock at the moment of posting, frozen server-side. Never
    // recomputed here: rendering it from the visitor's Date() would show a
    // reader in another time zone a time the author never experienced.
    if (pulse.localTime) {
      var time = el('span', 'wk-p-time');
      time.textContent = pulse.localTime;
      kicker.appendChild(time);
    }
    card.appendChild(kicker);

    var center = el('div', 'wk-p-center');
    if (pulse.glyphs && pulse.glyphs.trim()) {
      var glyph = el('div', 'wk-p-glyph');
      glyph.textContent = pulse.glyphs.trim();
      // Emoji are decoration here, not content — a screen reader announcing
      // "film frames red circle" before the line is noise, and the line
      // already says what the pulse is.
      glyph.setAttribute('aria-hidden', 'true');
      center.appendChild(glyph);
    }
    if (pulse.text && pulse.text.trim()) {
      var text = el('div', 'wk-p-text');
      text.textContent = pulse.text.trim();
      center.appendChild(text);
    }
    card.appendChild(center);

    // Two free-text cells, both empty unless the author filled them — and with
    // nothing in either, the row does not render at all.
    if ((pulse.footLeft && pulse.footLeft.trim()) || (pulse.footRight && pulse.footRight.trim())) {
      var foot = el('div', 'wk-p-foot');
      var left = el('span', 'wk-p-foot-left');
      left.textContent = pulse.footLeft || '';
      var right = el('span', 'wk-p-foot-right');
      right.textContent = pulse.footRight || '';
      foot.appendChild(left);
      foot.appendChild(right);
      card.appendChild(foot);
    }
    return card;
  }

  // ---- the kind registry: one renderer per kind ----
  // Replaces the old dispatch ternary. Each renderer takes the picked item and
  // the RESOLVED layout name. A new layout lands as (1) its name in
  // CARD_LAYOUTS above, (2) a gate in CARD_GATES if it needs anything from the
  // entry, and (3) a branch on the layout argument here or a data-layout rule
  // in css/main.css — never a new kind. A renderer that has only one layout
  // ignores the argument. An unknown kind falls through to the text renderer,
  // exactly as the old ternary chain did.
  var CARD_KINDS = {
    pulse: function (item) { return pulseCard(item.data); },
    audio: function (item) { return audioCard(item.data); },
    photo: function (item) { return photoCard(item.data, item.raw); },
    text: function (item, layout) {
      return layout === 'hero' ? textHeroCard(item.data) : textCard(item.data);
    },
    composed: function (item, layout) { return composedCard(item.data, layout); },
  };

  function buildCard(item) {
    var renderKind = CARD_KINDS[item.kind] || CARD_KINDS.text;
    var layout = layoutFor(item.kind, item.data);
    var node = renderKind(item, layout);
    // 'default' must add nothing (the byte-identity contract, see the engine
    // seam comment above) — only a real choice reaches the markup.
    if (layout !== 'default') node.setAttribute('data-layout', layout);
    return node;
  }
  g.RecentIndex.buildCard = buildCard;
  // Exposed for the console: it seeds a spawned composed card's `link` from the
  // SAME builder the grid renders with, so the two can never disagree.
  g.RecentIndex.entryHref = entryHref;

  // null = the data file is MISSING (an un-seeded fork), [] = it loaded empty
  // (cleared on purpose). The caller maps null to the sample fallback — the
  // same missing-vs-empty split the archive and wall pages make (manual §5.21).
  function getJson(path) {
    return fetch(path)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function render() {
    var host = document.getElementById('recent-index');
    if (!host) return;
    // /api/buffer-summary is a tiny precomputed endpoint (also snapshotted into
    // the offline export) — it carries the featured RAW frames so the homepage
    // never downloads the full buffer.json just to show one daily.
    Promise.all([
      getJson('/data/archive.json'),
      getJson('/data/posts.json'),
      getJson('/api/buffer-summary'),
      // The audio registry. No sample fallback here on purpose: the engine
      // ships sample FRAMES and a sample NOTE, but no sample audio file — an
      // un-seeded fork should show no audio card rather than a play button
      // that 404s. Missing and empty therefore mean the same thing.
      getJson('/data/audio.json'),
      // The live pulse (D1, via a 60s-cached endpoint). Not a data file: posting
      // one must not cost a deploy. Every degraded state — no D1, unmigrated,
      // nothing posted, everything expired — answers { pulse: null }, so this
      // resolves to "no pulse card" and never to a broken grid.
      getJson('/api/pulse'),
      // The owner's composed cards. No sample fallback, for the audio reason:
      // an un-seeded fork has composed nothing, and missing and empty both mean
      // "the grid fills itself" — which is the default this whole feature is an
      // override on top of.
      getJson('/data/cards.json'),
    ])
      .then(function (res) {
        var archive = withSampleFallback(res[0], sampleFrames());
        var posts = withSampleFallback(res[1], [sampleNote()]);
        var summary = (res[2] && !Array.isArray(res[2])) ? res[2] : {};
        var rawFeatured = Array.isArray(summary.featured) ? summary.featured : [];
        var audio = Array.isArray(res[3]) ? res[3] : [];
        var pulse = (res[4] && !Array.isArray(res[4])) ? res[4] : null;
        var composed = Array.isArray(res[5]) ? res[5] : [];
        var picks = pickRecent(archive, posts, rawFeatured, audio, pulse, composed);
        var section = host.closest ? host.closest('.cl-work') : null;
        if (!picks.length) {
          if (section) section.hidden = true;
          return;
        }
        var frag = document.createDocumentFragment();
        picks.forEach(function (item) {
          frag.appendChild(buildCard(item));
        });
        host.textContent = '';
        host.appendChild(frag);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
