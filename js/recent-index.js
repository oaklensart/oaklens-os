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
   audio is fetched until someone presses play. The owner's own COMPOSED cards
   (data/cards.json) are overlaid on that row and drawn by the same renderers:
   a composed card names a kind and overrides some of its fields, and there is
   no fifth renderer (docs/cards-core-complete.md, chunk 1). A MISSING data
   file (an un-seeded fork) falls back to the bundled CC0 samples — the same
   split the archive/wall pages make (missing → samples, empty → empty); audio
   has no samples and so treats both the same.
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

    // NOTHING REORDERS THE ROW AFTER THIS SORT. Publish order is the whole
    // promise of the automatic grid: what went up most recently leads, and the
    // owner can predict the homepage from the console without running this
    // function in their head.
    //
    // A swap lived here from 2026-07-22 to 2026-09-13 ("Evaluation adjustment":
    // if the only text card landed in slot 4, trade it with slot 3 so a note
    // showed in the visible 3-up row). It was written when the site held barely
    // more than a grid's worth of frames, and it aged into a lie: publish three
    // photographs after your newest note and the note jumps the queue anyway,
    // pushing a freshly published photograph into the tablet-only slot almost
    // nobody sees. Owner report 2026-09-13 —
    // docs/maintenance/2026-09-13-cards-automatic-publish-order.md.
    //
    // The row still mixes: ensure('text') above trades the OLDEST of the four
    // picks for the newest note, so a full grid is never single-type. That rule
    // acts on the GRID, which is where a mixing rule belongs; escalating it to
    // the visible three was the part that overrode recency. A fresh fork keeps
    // its mixed visible row because the bundled samples carry dates that
    // interleave (sampleFrames/sampleNote below) — earned by publish order like
    // everything else, not by a special case here.
    return picks;
  }

  // ---- COMPOSED CARDS — the owner's own cards, overlaid on the automatic row ----
  //
  // A composed card is one the owner built in the console: a picture chosen from
  // anywhere on the site (or uploaded), words typed onto the card itself, or
  // both. It is an OVERRIDE on the grid, never a replacement for it — the row
  // still fills itself and a composed card simply takes a place near the front.
  //
  // AND IT IS NOT A KIND OF ITS OWN (docs/cards-core-complete.md chunk 1,
  // 2026-09-10). A composed record names a kind — photo, text, audio — and
  // overrides some of that kind's fields; the kind's own renderer draws it.
  // One renderer per kind, so a composed words card IS the field-note tile
  // (drop cap, caret and all) and a composed picture card IS the archive card,
  // rather than a copy of each that drifts. The renderers read each
  // overridable field through the record first and the entry second (the
  // `overrides` helpers below the DOM bail); the one place that knows a card
  // is composed is cardRoot, which stamps the marker attributes the
  // stylesheet binds to.
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
  function composedPick(cards, audio, audioSets) {
    return (cards || [])
      .filter(function (c) {
        if (!c) return false;
        // A RETIRED card is a tombstone (chunk 6): its id stays reserved so the
        // share link that pointed at it can never quietly answer with a
        // different card, but it holds nothing and shows nothing. Dropped here
        // rather than later so COMPOSED_MAX stays a budget of LIVE cards — two
        // tombstones must not lock the grid into filling itself.
        if (c.retired) return false;
        if (heroFilename({ hero: c.media }) || String(c.title || c.tease || '').trim()) return true;
        // An audio card shows a PLAYER, and the tracks are its content — so it
        // is the one kind that earns a slot with no picture and no typed line.
        // It is asked the only question that matters for it: does anything
        // play? (docs/cards-core-complete.md chunk 5.)
        return composedKind(c) === 'audio' && composedTracks(c, audio, audioSets).length > 0;
      })
      .sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); })
      .slice(0, COMPOSED_MAX)
      .map(function (c) { return composedItem(c, audio, audioSets); });
  }

  // ---- what a composed AUDIO card plays ----
  // Two sources, and only two. A record naming a set (`set: '<slug>'`) borrows
  // that set — resolved through AudioPlayer.resolveSetTracks, the ONE answer to
  // "what does this set play" that the shelf and /listen/ also ask (chunk 4).
  // A record naming none plays THE HOMEPAGE TRACKS: the same featured list the
  // automatic audio card draws, read live off the registry rather than copied
  // onto the record.
  //
  // That second rule is why taking the audio slot over cannot lose the player
  // (the 2026-09-07 hole): a takeover copies no tracks, so there is nothing to
  // fall out of step with the shelf, and the card keeps playing what it played.
  //
  // A retired set plays nothing — its slug is a reservation, not a playlist —
  // and a retired TRACK drops out of a set silently (resolveSetTracks' rule).
  // The cap is applied here as well as on write: a hand-edited data file must
  // not be able to publish a twenty-row card.
  function composedSet(card, audioSets) {
    var slug = (card && typeof card.set === 'string') ? card.set : '';
    if (!slug) return null;
    var hit = (audioSets || []).filter(function (s) {
      return s && s.slug === slug && !s.retired;
    });
    return hit.length ? hit[0] : null;
  }

  function composedTracks(card, audio, audioSets) {
    var slug = (card && typeof card.set === 'string') ? card.set : '';
    if (slug) {
      var set = composedSet(card, audioSets);
      var AP = g.AudioPlayer;
      if (!set || !AP || typeof AP.resolveSetTracks !== 'function') return [];
      return AP.resolveSetTracks(set, audio || []).slice(0, AUDIO_MAX_PLAYLIST);
    }
    return audioPick(audio, AUDIO_MAX_PLAYLIST);
  }

  // ---- the normalizer: which KIND a composed record renders as ----
  // A record written since chunk 1 says so (`kind`). One written by the
  // earlier console says nothing, and is read the way that console's renderer
  // read it — the SHAPE decides: a usable picture that the layout does not
  // push aside is the photo kind, anything else the text kind. That rule
  // reproduces the old renderer byte for byte (tests/cards-legacy-fixtures.test.js),
  // which is the whole contract: a fork merging this sees no change on its
  // homepage. The old `plain` layout is therefore not a layout any more — it
  // meant "the words, please", and the text kind is exactly that.
  //
  // A stated `photo` with no usable picture degrades to `text` the way `hero`
  // gates to default: a picture card without a picture is a hole, not a card.
  function composedKind(card) {
    var kind = card && card.kind;
    if (kind === 'text' || kind === 'audio') return kind;
    if (kind === 'photo') return composedMedia(card) ? 'photo' : 'text';
    return (composedMedia(card) && cardDescriptor(card).layout !== 'plain') ? 'photo' : 'text';
  }

  // One made item, in the shape buildCard takes for every card: the kind to
  // dispatch on, the entry, and the record itself as the overrides. The entry
  // is EMPTY on purpose — a composed record carries everything it shows (the
  // console copies what it borrows at takeover, and `source` is provenance,
  // not a pointer the renderer follows), so nothing of the entry it came from
  // can leak into the bytes: the record froze them.
  function composedItem(card, audio, audioSets) {
    var kind = composedKind(card);
    // ⚠️ THE AUDIO KIND IS THE ONE EXCEPTION TO THE EMPTY ENTRY, and it is an
    // exception on purpose rather than a leak. Every other kind freezes what it
    // shows onto the record; an audio card CANNOT — a track is a file, a
    // duration and a waveform that live in the registry, and a copy of them on
    // the card would be a second answer to "what plays here" the moment a track
    // is renamed, re-peaked or retired. So the record names a source (a set, or
    // nothing meaning the homepage tracks) and the registry answers. Nothing of
    // a track's own prose reaches the card's words: the author's caption is
    // read from `over` alone (audioCaption below).
    if (kind === 'audio') {
      var tracks = composedTracks(card, audio, audioSets);
      // Mirrors pickAutomatic's own rule — more than one track is the playlist
      // card, exactly one is the single card — so taking the audio slot over
      // does not change the shape of the card that was already there.
      var data = tracks.length > 1 ? { isPlaylist: true, tracks: tracks } : (tracks[0] || {});
      return { kind: kind, data: data, over: card, set: composedSet(card, audioSets), d: card.added_at || '' };
    }
    return { kind: kind, data: {}, over: card, d: card.added_at || '' };
  }

  // Which of the stylesheet's surfaces a composed record paints — `picture`
  // (the photo kind, or the text kind wearing hero) or `words` — the value the
  // root carries as data-shape. Asked by the console so the composer's face
  // and the live card can never disagree; tests/card-composer.test.js pins
  // that this answer and the rendered attribute agree.
  function composedShape(card) {
    var kind = composedKind(card);
    if (kind === 'photo') return 'picture';
    // A note wearing hero OR overlay is picture-led — both are drawn by
    // textHeroCard, which stamps 'picture' on the root. Asking for the layout
    // rather than listing the two names would be shorter and wrong: 'default'
    // is the words tile and any further layout has to say for itself.
    if (kind === 'text') {
      var l = layoutFor('text', {}, card);
      return (l === 'hero' || l === 'overlay') ? 'picture' : 'words';
    }
    return kind;
  }

  // Only a same-origin path is honoured as a composed card's link. This is
  // authored content that rides publish, so a bad value is an editing mistake
  // rather than an attack — but a card that silently sent visitors off-site
  // would be a bad surprise either way, and a plain <div> is the honest
  // degradation (pulseCard already proves a card need not be an anchor).
  function composedLink(card) {
    var h = card && card.link;
    if (typeof h !== 'string') return '';
    h = h.trim();
    return (h.charAt(0) === '/' && h.charAt(1) !== '/') ? h : '';
  }

  // ---- WHICH ENTRY A ROW ITEM IS — the key the dedupe below asks for ----
  // A composed card records where it came from as `source: { surface, id }`,
  // in the console's own SLOT_SURFACE vocabulary (cards.js). For the row to be
  // asked "are you the thing that card took over", it has to answer in the same
  // words. Kind plus the raw marker is the whole mapping: the newest-first pool
  // holds archive photos and posts, and the two pins are a buffer frame and a
  // track.
  function itemSurface(item) {
    if (!item) return '';
    if (item.kind === 'photo') return item.raw ? 'buffer' : 'archive';
    if (item.kind === 'text') return 'posts';
    if (item.kind === 'audio') return 'audio';
    return '';
  }

  // ⚠️ THE ID IS `id`, NEVER `fn_id`. A field note carries both and they are
  // never equal (`k3e9xba` vs `fn-011`). The console writes `entry.id` onto the
  // card (cards.js `_slotOf` reads `data.id` for every kind, and cardsEditSlot
  // seeds `source.id` from it), so reaching for `fn_id` here would compare two
  // different namespaces, never match, and leave every field-note takeover
  // duplicating — the exact bug this dedupe exists to close, hidden because
  // photographs would still look fixed. `fn_id` is the publish-order label
  // pickAutomatic filters on; it is not identity. Pinned in
  // tests/card-composer.test.js.
  function sourceKey(surface, id) {
    return (surface && id) ? (surface + ':' + id) : '';
  }
  function composedSourceKey(card) {
    var s = card && card.source;
    return s ? sourceKey(s.surface, s.id) : '';
  }
  function itemSourceKey(item) {
    return (item && item.data) ? sourceKey(itemSurface(item), item.data.id) : '';
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
  function pickRecent(archive, posts, rawFeatured, audioFeatured, pulse, composed, audioSets) {
    var row = pickAutomatic(archive, posts, rawFeatured, audioFeatured, pulse);
    var made = composedPick(composed, audioFeatured, audioSets);
    if (!made.length) return row;
    // A composed AUDIO card has taken the audio slot over, so the automatic
    // audio item steps aside. Two players on a three-card homepage is not a
    // richer grid — it is the same card twice, and usually the same tracks
    // twice. Same rule as usedMedia below, asked at the granularity audio has:
    // an audio card is identified by being one, not by a filename.
    var madeAudio = made.some(function (m) { return m.kind === 'audio'; });
    if (madeAudio) {
      row = row.filter(function (item) { return !item || item.kind !== 'audio'; });
    }
    // ---- WHAT A COMPOSED CARD SUPPRESSES: two keys, strongest first ----
    //
    // PROVENANCE FIRST. A takeover records the entry it came from, and that is
    // identity — it survives re-cropping, re-titling, clearing the picture, and
    // choosing a different file for it. A filename survives none of those.
    // cardsPickImage rewrites `media` from the asset library, which lists an
    // original upload beside its own derivative, so picking "the same
    // photograph" routinely writes a different string and the automatic card
    // came back beside the composed one. That is how 333 Market shipped twice
    // (docs/maintenance/2026-09-18-cards-duplicate-and-draft-publish.md). The
    // answer was on the record the whole time and this function was not reading
    // it.
    //
    // It also closes the quieter half: `media` is legitimately EMPTY on a card
    // whose picture was cleared, or taken over from a slot with no thumb. A
    // filename key has nothing to compare there and the source stayed in the
    // row; a provenance key still knows.
    var usedSources = made.map(function (m) { return composedSourceKey(m.over); }).filter(Boolean);
    if (usedSources.length) {
      row = row.filter(function (item) {
        var key = itemSourceKey(item);
        return !key || usedSources.indexOf(key) === -1;
      });
    }
    // THE FILENAME SECOND, and it is not redundant. A free-form card
    // (cardsCompose) records no source at all, and a card whose picture was
    // re-picked from a DIFFERENT entry should still suppress that entry. It is
    // the weaker key, so it runs after the strong one rather than instead of it.
    var usedMedia = made.map(function (m) { return composedMedia(m.over); }).filter(Boolean);
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
    // 'overlay': the words sit ON the picture, in a band (see the overlay
    // section below). Registered on both picture-capable kinds because it is a
    // way of dressing A PICTURE, not a feature of one kind — gated on there
    // being a picture to write on.
    photo: ['default', 'overlay'],
    // 'hero': a field note leads with its hero picture instead of the
    // typographic tile. Opt-in per post (the FN composer writes
    // card: { layout: 'hero' }) and gated on the picture actually being
    // there — see CARD_GATES below.
    text: ['default', 'hero', 'overlay'],
    audio: ['default'],
    pulse: ['default'],
    // No `composed` here. A composed card is one of the kinds above wearing
    // that kind's layouts — composedKind decides which. (It was a fifth kind
    // with its own `default | hero | plain` until 2026-09-10; `plain` is now
    // the text kind, and a picture record that asked for `hero` is the photo
    // kind, which has only its one shape and so nothing to name.)
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
  // A gate sees the composed overrides too (`over`, absent for an automatic
  // card): a composed text card WITH a picture can wear hero, one without
  // falls back to the words tile rather than rendering a hole.
  // ONE GATE, THREE DOORS. Every picture-backed layout asks the same question —
  // "is there a picture this card can actually paint?" — so it is asked once
  // here and the table points three entries at it. The field name differs by
  // kind (a note names its picture `hero`, a frame names it `filename`, a
  // composed record names it `media`), which is the only reason the photo door
  // is not literally the same closure.
  function hasNotePicture(entry, over) {
    return !!(composedMedia(over) || heroFilename(entry));
  }
  function hasFramePicture(entry, over) {
    return !!(composedMedia(over) || heroFilename({ hero: entry && entry.filename }));
  }
  var CARD_GATES = {
    photo: {
      overlay: hasFramePicture,
    },
    text: {
      hero: hasNotePicture,
      overlay: hasNotePicture,
    },
  };

  // Resolve the layout NAME, then let its gate veto it. 'default' has no gate
  // and never gets one — it is what everything falls back to. A composed
  // record's own descriptor wins when it carries one; the entry's answers
  // otherwise — over.card ?? entry.card, the same rule as every other field.
  function layoutFor(kind, entry, over) {
    var want = (over && cardDescriptor(over).layout) || cardDescriptor(entry).layout;
    var layout = resolveLayout(kind, want);
    var gate = CARD_GATES[kind] && CARD_GATES[kind][layout];
    return (gate && !gate(entry, over)) ? 'default' : layout;
  }

  // ---- the overlay layout: the image ladder, v1 ----
  // docs/cards-core-complete.md chunk 3. Writing on a picture is a legibility
  // problem, and this engine FORBIDS runtime auto-fit — no measuring the DOM,
  // no reading a canvas at render time (the offline export runs from file://
  // with no network and no layout to measure, and a measured card would shift
  // after paint). So the decision is split in two:
  //
  //   the AUTHOR picks   where the band sits and how it is treated — a closed
  //                      set of chips in the console, never a slider, so a card
  //                      can only ever be in a state the stylesheet describes
  //   the ENGINE picks   the ink, from luminance MEASURED ONCE in the console
  //                      at pick/crop time and stored on the record (`img.lum`)
  //
  // Nothing here computes a colour or a gradient: every answer leaves as a
  // data-* attribute and css/main.css owns the rest.
  var OVERLAY_PLACES = ['bottom', 'top', 'centre'];
  var OVERLAY_TREATS = ['scrim', 'blur', 'none'];
  var OVERLAY_BLURS = [1, 2, 3];
  // The TITLE'S SCALE on the band — the museum-plate ladder (owner, 2026-09-11:
  // "use typographic scale, don't be afraid to let the text be large in an
  // intentional way"). Like the words tile's tier it is stamped from length,
  // not authored: a two-word title is a statement and gets the room a
  // statement needs; a forty-character one steps down until it fits its three
  // lines. Same shape as the tease ladder for the same reason — one grid, one
  // type system — but a title is a line, not a paragraph, so the steps are
  // its own. The mark (below) is the plate's full stop, in the site's accent.
  var OVERLAY_SCALES = ['statement', 'feature', 'standard', 'compact'];
  function overlayScale(title) {
    var n = tierLen(title);
    if (n <= 12) return 'statement';
    if (n <= 24) return 'feature';
    if (n <= 40) return 'standard';
    return 'compact';
  }
  // A full stop in the accent closes the title on the band — the one flourish
  // the plate carries, and only where the author did not already end the line.
  // Terminal punctuation, a closing quote or bracket, or an empty title get no
  // mark: a second full stop is a typo the stylesheet made.
  function overlayMark(title) {
    var s = String(title == null ? '' : title).replace(/\s+$/, '');
    if (!s) return '';
    return /[.,!?:;…—\-"'”’)\]]$/.test(s) ? '' : 'dot';
  }

  // The record's three measured bands are named for the crop (top / mid /
  // bottom); a PLACEMENT is named for where the band sits. They line up except
  // in the middle, where 'centre' reads the 'mid' band — so the two
  // vocabularies stay readable in their own contexts instead of one borrowing
  // the other's word.
  var OVERLAY_BAND = { top: 'top', centre: 'mid', bottom: 'bottom' };

  // Read the record's overlay choices, with every unknown or absent value
  // falling back to the safe default rather than to nothing: bottom, scrimmed,
  // medium blur. A card published by a NEWER console — a placement this engine
  // has never heard of — degrades to a legible card, the same contract
  // resolveLayout makes for layout names.
  function overlayOf(over) {
    var o = (over && over.overlay) || {};
    return {
      place: OVERLAY_PLACES.indexOf(o.place) !== -1 ? o.place : 'bottom',
      treat: OVERLAY_TREATS.indexOf(o.treat) !== -1 ? o.treat : 'scrim',
      blur: OVERLAY_BLURS.indexOf(o.blur) !== -1 ? o.blur : 2,
    };
  }

  // INK IS DERIVED, NEVER AUTHORED (docs/cards-core-complete.md §2.2). The band
  // is asked what it is sitting on and the type takes the side that can be read.
  // Pure, and exported, so the threshold is a pinned number rather than a
  // sentence in a comment.
  //
  // 0.55 rather than 0.5: light type on a mid-grey band reads better than dark
  // type does, so the tie goes to light and the swap to dark waits for a
  // genuinely bright band.
  //
  // An UNMEASURED card answers 'light' — a card picked before this landed, a
  // measurement that failed, a hand-edited record. Paired with the default
  // scrim (which is dark under light ink) that is legible on any picture, which
  // is exactly why scrim is the default treatment and not 'none'.
  var INK_THRESHOLD = 0.55;
  function overlayInk(over, place) {
    var lum = over && over.img && over.img.lum;
    var v = lum ? lum[OVERLAY_BAND[place] || 'bottom'] : null;
    if (typeof v !== 'number' || !isFinite(v)) return 'light';
    return v >= INK_THRESHOLD ? 'dark' : 'light';
  }

  // Hang the band on the picture. The NODES are the kind's own — same classes,
  // same text, same order — and the only structural difference between an
  // overlay card and its default is which element the body is appended to.
  // That is what keeps this a layout rather than a fifth renderer: a kind that
  // learns overlay learns one call, not a second copy of its markup.
  function applyOverlay(root, img, body, over) {
    var o = overlayOf(over);
    root.setAttribute('data-place', o.place);
    root.setAttribute('data-treat', o.treat);
    // Only meaningful under the blur treatment, and absent otherwise — an
    // attribute nothing reads is a value somebody will later believe in.
    if (o.treat === 'blur') root.setAttribute('data-blur', String(o.blur));
    root.setAttribute('data-ink', overlayInk(over, o.place));
    // The plate's type: how large the title runs and whether it closes with the
    // accent mark. Read off the headline the kind already built — the body's
    // first node is the title in every renderer that reaches here — so the
    // scale can never disagree with the words on the card. Both are
    // attributes; css/main.css owns the sizes and the mark itself.
    var headline = body.firstChild ? body.firstChild.textContent : '';
    root.setAttribute('data-scale', overlayScale(headline));
    var mark = overlayMark(headline);
    if (mark) root.setAttribute('data-mark', mark);
    root.appendChild(img);
    img.appendChild(body);
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
  // them.
  //
  // The sample frames and the sample note carry DATES, and the dates are the
  // reason a brand-new fork's visible 3-up row reads photo · photo · note
  // rather than three photographs. pickAutomatic sorts newest-first and nothing
  // reorders it afterwards, so the only way to put writing in a fork's opening
  // row is for the sample note to have been "published" between two of the
  // sample frames — which is exactly what these dates say. Undated samples all
  // tie at '' and sort by insertion order, which is how the row ended up
  // single-type and earned the reorder hack pickAutomatic used to carry.
  //
  // sampleNote's date mirrors posts/fn-sample.md and js/page-fn-list.js; the
  // three must agree (tests/recent-index.test.js pins it). The frames' dates
  // are homepage-only — js/page-archive.js renders its twelve samples in array
  // order and never sorts — and they stay inside 2026 so nothing contradicts
  // the 'Sample City, 2026' the card and the archive both show.
  function sampleFrames() {
    var dates = ['2026-01-05', '2026-01-04', '2026-01-02'];
    return ['First Shadow', 'In Flight', 'Golden Ray'].map(function (title, i) {
      return {
        slug: 'sample-' + String(i).padStart(2, '0'),
        filename: 'sample-' + String(i).padStart(2, '0'),
        title: title,
        location: 'Sample City, 2026',
        camera: 'Mirrorless',
        date: dates[i],
      };
    });
  }
  function sampleNote() {
    return {
      fn_id: 'fn-sample',
      title: 'Learning to See Again',
      location: 'Sample City',
      date: '2026-01-03',
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
    composedKind: composedKind,
    composedItem: composedItem,
    composedShape: composedShape,
    // What a composed audio card plays, and the set it borrows (or null) — the
    // studio asks both so the rail can never disagree with the card.
    composedTracks: composedTracks,
    composedSet: composedSet,
    composedMedia: composedMedia,
    composedFolder: composedFolder,
    composedLabel: composedLabel,
    composedLink: composedLink,
    COMPOSED_MAX: COMPOSED_MAX,
    // The cap a set and the homepage card share, read by the studio's rail so
    // the console never restates the number (tests/audio-playlist-card.test.js
    // refuses a literal on either side).
    AUDIO_MAX_PLAYLIST: AUDIO_MAX_PLAYLIST,
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
    // The overlay layout's vocabulary and its one derived value. The console
    // draws its chips from these arrays rather than restating them, so a
    // placement the engine cannot render can never be offered; overlayInk is
    // exported because a threshold nobody can test is a guess.
    overlayPlaces: OVERLAY_PLACES,
    overlayTreats: OVERLAY_TREATS,
    overlayBlurs: OVERLAY_BLURS,
    overlayScales: OVERLAY_SCALES,
    overlayOf: overlayOf,
    overlayInk: overlayInk,
    overlayScale: overlayScale,
    overlayMark: overlayMark,
    INK_THRESHOLD: INK_THRESHOLD,
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
    // A SAVED SET (chunk 4). Its own parameter, not the track's: a set and a
    // track may legitimately carry the same slug, and `?a=` and `?set=` answer
    // different things. Empty for a set with no slug, which every caller below
    // reads as "fall back to what this card would otherwise point at".
    if (kind === 'set') return (e && e.slug) ? '/listen/?set=' + encodeURIComponent(e.slug) : '';
    // A COMPOSED CARD'S OWN ADDRESS (chunk 6). Not a visitor kind like the four
    // above — a composed record is drawn by one of them — but it is a content
    // type, and a content type has a permanent URL. This is the address the
    // studio's LINK block copies and the share sheet points at; it is NOT where
    // the card on the grid goes (that is composedLink, the record's own `link`),
    // because a card spawned from an archive photo should still open the photo.
    // Spelled here so the console, the sitemap and the page can never disagree.
    if (kind === 'composed') return e.id ? '/card/' + encodeURIComponent(e.id) : '';
    return '';
  }

  // ---- overrides: how a composed record reaches a kind's renderer ----
  // Each renderer takes the entry it has always taken plus `over`, the composed
  // record (null for an automatic card), and reads every field it can override
  // through these. The rule is over.field ?? entry.field; the helpers exist
  // because three fields have a composed DEFAULT of their own — a link only
  // where the record says, a chip that reads "Featured" when blank, and a
  // caption that is the typed tease or nothing — and spelling that rule once
  // keeps four renderers agreeing on it.

  // over.field ?? entry.field, as text.
  function textOf(over, entry, name) {
    var v = (over && over[name] != null) ? over[name] : (entry ? entry[name] : '');
    return v == null ? '' : String(v);
  }

  // Where the card goes. An automatic card goes to its entry's canonical
  // address; a composed card only where its record says (composedLink —
  // same-origin or nothing).
  function hrefOf(kind, entry, over) {
    return over ? composedLink(over) : entryHref(kind, entry);
  }

  // The on-media chip / the kicker: a composed card's label, "Featured" when it
  // has none; the kind's own word otherwise.
  function labelOf(over, fallback) {
    return over ? composedLabel(over) : fallback;
  }

  // The same question on a card whose kicker already SAYS something — the audio
  // card's "Audio" and "Audio // Multi-track". There the kind's word is the
  // better default than "Featured": a tile with a waveform on it labelled
  // Featured tells a cold reader less than the one it replaced. So the author's
  // badge still wins; its absence falls back to the kind rather than to the
  // generic word. (chunk 5 — the picture and words shapes keep "Featured",
  // which their fixtures pin.)
  function badgeOf(over, kindWord) {
    var s = over && typeof over.label === 'string' ? over.label.trim() : '';
    return s || kindWord;
  }

  // The picture-shape caption line. An automatic card always has one (the
  // kind's own text — empty at worst, and the tile keeps the line). A composed
  // card's is the tease it was typed with, and WITHOUT one there is no line at
  // all (null): the legacy fixtures froze it that way, and a blank line under a
  // headline the author wrote reads as a gap, not a caption.
  function captionOf(over, entryText) {
    if (!over) return entryText;
    return over.tease ? String(over.tease) : null;
  }

  // ---- the card root ----
  // Every card starts here. An automatic card is an anchor to its entry's
  // canonical address (or a plain div for the kinds that go nowhere). A
  // COMPOSED card links only where its record says — and this is the ONE place
  // that knows a card is composed: it stamps `wk-composed`, `data-shape` and
  // `data-state`, the three hooks the palette CSS and the console bind to, and
  // nothing downstream branches on it again.
  //
  // The composed root sets href before class, the automatic root the other way
  // round: both orders are frozen by fixtures (the legacy composed shapes and
  // the pre-engine automatic grids), and attribute order is bytes.
  function cardRoot(kindCls, href, over, shape) {
    var cls = 'wk-card' + (over ? ' wk-composed' : '') + (kindCls ? ' ' + kindCls : '');
    if (!over) {
      var a = el(href ? 'a' : 'div', cls);
      if (href) a.href = href;
      return a;
    }
    var root = el(href ? 'a' : 'div');
    if (href) root.href = href;
    root.className = cls;
    root.setAttribute('data-shape', shape);
    if (over.palette && over.palette !== 'default') root.setAttribute('data-state', over.palette);
    return root;
  }

  function photoCard(entry, isRaw, over, layout) {
    var o = over || null;
    // RAW cards deep-link to the buffer frame (by id — always exact); archive
    // cards to the curated frame (by slug). One builder, entryHref.
    var a = cardRoot('', hrefOf(isRaw ? 'raw' : 'archive', entry, o), o, 'picture');
    var img = el('div', 'wk-img');
    img.style.backgroundImage = "url('"
      + frameSrc(composedMedia(o) || entry.filename, 1024, composedFolder(o)) + "')";
    var cardPos = cardFocus(o) || cardFocus(entry);
    if (cardPos) img.style.backgroundPosition = cardPos;
    var tag = el('span', 'wk-tag');
    tag.textContent = labelOf(o, isRaw ? 'RAW' : 'Archive');
    img.appendChild(tag);
    var body = el('div', 'wk-body');
    // The picture card's caption grammar (.wk-title / .wk-meta) for a composed
    // card too — NOT the words-tile headline: a composed card with a photo has
    // to read like the archive card beside it, or its title looms over the row
    // and competes with the picture. (owner, 2026-09-07)
    var title = el('div', 'wk-title');
    // A buffer frame has no title — its identity IS the permanent frame number.
    title.textContent = isRaw ? frameTag(entry.num) : textOf(o, entry, 'title');
    body.appendChild(title);
    var metaText = captionOf(o, isRaw
      ? String(entry.captured_at || '').slice(0, 4)
      : [entry.camera, yearOf(entry)].filter(Boolean).join(' · '));
    if (metaText != null) {
      var meta = el('div', 'wk-meta');
      meta.textContent = metaText;
      body.appendChild(meta);
    }
    if (layout === 'overlay') applyOverlay(a, img, body, o);
    else { a.appendChild(img); a.appendChild(body); }
    return a;
  }

  function textCard(post, over) {
    var o = over || null;
    // The words: the tease typed onto a composed card, else the note's body —
    // measured by the same ladder either way, so one grid never carries two
    // type systems.
    var words = (o && o.tease != null) ? o.tease : post.body;
    var excerpt = recentTruncate(recentStrip(words), TEASE_MAX);
    // Grapheme-counted, like the pulse card: a tease in Japanese or one carrying
    // emoji used to over-count and tier a step too small.
    var tier = recentTier(tierLen(excerpt));
    var initial = recentInitial(excerpt);

    var a = cardRoot('wk-text', hrefOf('text', post, o), o, 'words');
    a.setAttribute('data-tier', tier);

    var kicker = el('span', 'wk-kicker');
    var dot = el('span', 'wk-dot');
    dot.setAttribute('aria-hidden', 'true');
    kicker.appendChild(dot);
    kicker.appendChild(document.createTextNode(labelOf(o, 'Field Note')));

    var title = el('div', 'wk-t-title');
    title.textContent = textOf(o, post, 'title');

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

    a.appendChild(kicker);
    a.appendChild(title);
    a.appendChild(snip);
    // The place-and-year line belongs to a note. A composed card has neither —
    // every word on it was typed — so it carries no line rather than an empty
    // one (its tease is the snip above, not a caption).
    if (!o) {
      var meta = el('div', 'wk-t-meta');
      meta.textContent = [post.location, yearOf(post)].filter(Boolean).join(' · ');
      a.appendChild(meta);
    }
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
  function textHeroCard(post, over, layout) {
    var o = over || null;
    var a = cardRoot('wk-text', hrefOf('text', post, o), o, 'picture');

    var img = el('div', 'wk-img');
    img.style.backgroundImage = "url('"
      + frameSrc(composedMedia(o) || heroFilename(post), 1024, composedFolder(o)) + "')";
    var cardPos = cardFocus(o) || cardFocus(post);
    if (cardPos) img.style.backgroundPosition = cardPos;
    var tag = el('span', 'wk-tag');
    tag.textContent = labelOf(o, 'Field Note');
    img.appendChild(tag);

    var body = el('div', 'wk-body');
    var title = el('div', 'wk-t-title');
    title.textContent = textOf(o, post, 'title');
    body.appendChild(title);
    var metaText = captionOf(o, [post.location, yearOf(post)].filter(Boolean).join(' · '));
    if (metaText != null) {
      var meta = el('div', 'wk-meta');
      meta.textContent = metaText;
      body.appendChild(meta);
    }

    if (layout === 'overlay') applyOverlay(a, img, body, o);
    else { a.appendChild(img); a.appendChild(body); }
    return a;
  }

  // (There is no composedCard(). A composed card is a photo, text or audio card
  // with overrides — see the `overrides` helpers and cardRoot above, and
  // composedKind for how a record chooses. docs/cards-core-complete.md chunk 1.)

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

  // ---- the author's caption on an audio card ----
  // The picture card's footer grammar (.wk-title / .wk-meta), sitting UNDER the
  // waveform. Deliberately not the card's headline: the headline names what is
  // PLAYING — the set, the soundboard, the track — and that is the registry's
  // to write, not the author's. §2.2 of docs/cards-core-complete.md is the
  // rule: words on an audio card are a caption, never a statement, because the
  // waveform is the hero. No tier ladder, no drop cap, no display face.
  //
  // Absent entirely when the author typed neither, for captionOf's reason: a
  // blank line under a waveform reads as a gap, not as a caption.
  function audioCaption(over) {
    if (!over) return null;
    var title = String(over.title || '').trim();
    var tease = String(over.tease || '').trim();
    if (!title && !tease) return null;
    var body = el('div', 'wk-body');
    if (title) {
      var t = el('div', 'wk-title');
      t.textContent = title;
      body.appendChild(t);
    }
    if (tease) {
      var m = el('div', 'wk-meta');
      m.textContent = tease;
      body.appendChild(m);
    }
    return body;
  }

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

  // `over` and `set` are a COMPOSED card's record and the set it borrows (both
  // null for the automatic card, which is why its bytes are untouched). The set
  // supplies the card's name and its address; the record supplies the caption.
  function audioPlaylistCard(tracks, over, set) {
    var o = over || null;
    var card = cardRoot('wk-audio wk-audio-playlist', '', o, 'audio');
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
    kicker.appendChild(document.createTextNode(badgeOf(o, 'Audio // Multi-track')));

    // WHAT IS PLAYING, not what the author wrote — a borrowed set is named by
    // the set, and its address is the set's own (chunk 4's /listen/?set=), so
    // the card and the page it opens can never be about different things.
    var setName = set ? (set.name || set.slug || '') : '';
    var setHref = entryHref('set', set);
    var boardName = setName || 'Soundboard';
    var boardHref = setHref || (o ? (composedLink(o) || '/listen/') : '/listen/');

    var title = el('div', 'wk-a-title');
    var link = el('a');
    link.href = boardHref;
    link.textContent = boardName;
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

    // UNDER THE WAVEFORM, which on this card means inside the HEAD — above the
    // index's rule, not below it. Placed after the index instead, the caption
    // sat flush against the last track and read as a third row rather than as
    // the author's line about the set (found by opening the page). The card is
    // a title block over a tracklist; the caption belongs to the title block.
    var caption = audioCaption(o);
    if (caption) card.appendChild(caption);

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
    share.setAttribute('aria-label', set ? 'Share this set' : 'Share this soundboard');
    share.innerHTML = SHARE_SVG;
    share.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (hasPlayer) AP.share(location.origin + boardHref, boardName, share);
    });
    foot.appendChild(share);

    card.appendChild(foot);
    return card;
  }

  // Exposed for the test contract (the pure helpers go up on g.RecentIndex
  // above the DOM bail; this one needs a document, so it is added here).
  // Harmless in the browser — same posture as worker.js's test re-exports.
  g.RecentIndex.audioPlaylistCard = audioPlaylistCard;

  // A composed audio card names a SOURCE and the registry answers — see
  // composedItem. `set` is the set it borrows, or null (chunk 5).
  function audioCard(entry, over, set) {
    if (entry && entry.isPlaylist && Array.isArray(entry.tracks)) {
      return audioPlaylistCard(entry.tracks, over, set);
    }
    var o = over || null;
    var card = cardRoot('wk-audio', '', o, 'audio');
    // The TRACK's title, never the override: on an audio card the author's
    // words are the caption underneath (audioCaption), and a headline taken
    // from the record would leave the thing actually playing unnamed.
    var name = (set && (set.name || set.slug)) || String((entry && entry.title) || '');

    var kicker = el('span', 'wk-kicker');
    var led = el('span', 'wk-p-led');
    led.setAttribute('aria-hidden', 'true');
    kicker.appendChild(led);
    kicker.appendChild(document.createTextNode(badgeOf(o, 'Audio')));

    // Name and address agree: a card titled with a set's name opens that set.
    var href = entryHref('set', set) || listenHref(entry);

    card.appendChild(kicker);
    var title = null;
    // NO NAME, NO LINE. An empty headline leaves a blank band above the
    // transport that reads as a rendering fault — captionOf's argument, applied
    // to the card's own title. Newly reachable on a composed card whose set was
    // deleted out from under it (its words still show, and the rail says why);
    // an automatic card always has a track to name.
    if (name) {
      title = el('div', 'wk-a-title');
      var link = el('a');
      link.href = href;
      link.textContent = name;
      title.appendChild(link);
      card.appendChild(title);
    }

    if (entry.sub) {
      var sub = el('div', 'wk-a-sub');
      sub.textContent = entry.sub;
      card.appendChild(sub);
    }

    // The player is progressive enhancement: if audio-player.js failed to load
    // the card still reads and still links to the permalink, rather than
    // rendering as a broken tile.
    var AP = g.AudioPlayer;
    // A composed card whose source resolves to nothing (an emptied homepage
    // card, a set whose every track retired) still renders — it has words, or
    // composedPick would have dropped it — but it must not mount a transport
    // over a track that is not there. An automatic card always has a filename
    // (audioPick gates on it), so its bytes do not move.
    var hasPlayer = AP && typeof AP.create === 'function' && !!entry.filename;
    if (hasPlayer) {
      var player = AP.create({
        src: entry.filename,
        peaks: AP.peaksFromString(entry.peaks),
        duration: entry.duration,
        variant: 'card',
        title: name,
        // The card owns its own playing state so the title can scroll while
        // the track runs — the player tells it rather than the CSS reaching in.
        onstate: function (playing) { card.classList.toggle('is-playing', playing); },
      });
      card.appendChild(player.root);
      if (title) AP.marquee(title);
    }

    var caption = audioCaption(o);
    if (caption) card.appendChild(caption);

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
      if (hasPlayer) AP.share(location.origin + href, name, share);
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
  // exactly as the old ternary chain did. `item.over` is a composed record's
  // overrides (composedItem); an automatic item carries none.
  var CARD_KINDS = {
    pulse: function (item) { return pulseCard(item.data); },
    audio: function (item) { return audioCard(item.data, item.over, item.set); },
    photo: function (item, layout) { return photoCard(item.data, item.raw, item.over, layout); },
    // 'overlay' on a note is the HERO card with its words moved onto the
    // picture — one picture-led builder, two layouts, rather than a second
    // picture branch in the typographic tile.
    text: function (item, layout) {
      return (layout === 'hero' || layout === 'overlay')
        ? textHeroCard(item.data, item.over, layout)
        : textCard(item.data, item.over);
    },
  };

  // ---- THE COMPOSITION: what a card is MADE OF, without any markup ----
  //
  // docs/cards-core-complete.md chunk 7. The share image is the card, and a
  // canvas cannot be handed a DOM node — so something has to answer "which
  // title, which caption, which label, which picture, which crop, which band"
  // for a painter that draws the same card with shapes instead of elements.
  //
  // That is a SECOND RENDERER, and the only thing that keeps a second renderer
  // honest is that it never decides anything for itself. So every value below
  // comes out of the SAME helper the kind's own renderer calls — textOf,
  // captionOf, labelOf/badgeOf, composedMedia/composedFolder, cardFocus,
  // frameSrc, layoutFor, overlayOf, overlayInk, recentTier — and this function
  // adds no rule of its own.
  //
  // ⚠️ IT NEEDS A DOM, and it sits below this file's `typeof document` bail for
  // that reason: `media.src` comes from frameSrc(), which reads the cdn-base
  // meta tag. An earlier version of this comment claimed the opposite — "runs
  // in a test and in the offline export alike" — which a code review caught. In
  // a pure Node context RecentIndex.cardComposition is simply not attached, and
  // paintCard's "card engine not loaded" is what a caller sees. Do not move it
  // above the bail without giving frameSrc a DOM-free path.
  //
  // tests/card-paint.test.js asserts every field against the card buildCard
  // actually renders. When a renderer moves and this does not, that test is
  // what goes red — which is the whole reason to describe a card in one place
  // rather than to eyeball two.
  function cardComposition(item) {
    var it = item || {};
    var kind = CARD_KINDS[it.kind] ? it.kind : 'text';
    var entry = it.data || {};
    var o = it.over || null;
    var layout = layoutFor(kind, entry, o);
    var c = {
      kind: kind,
      layout: layout,
      composed: !!o,
      // The palette the card wears, as cardRoot stamps it: 'default' is the
      // absence of a choice and reaches the markup as no attribute at all.
      palette: (o && o.palette && o.palette !== 'default') ? o.palette : '',
      shape: '',        // picture | words | audio | pulse — cardRoot's word
      href: '',
      label: '',        // the on-media chip, or the kicker's word
      title: '',
      meta: null,       // the second line, or null where the card draws none
      media: null,      // { filename, folder, src, focus } or null
      overlay: null,    // { place, treat, blur, ink, scale, mark } — only under that layout
      tier: '',         // the words ladder, or the playlist ladder
      words: '',        // the excerpt the words tile prints
      initial: '',      // its drop cap, '' where the tier carries none
      tracks: [],       // what an audio card plays
      caption: null,    // an audio card's typed words — { title, tease }
      pulse: null,      // the pulse card's own cells
    };

    if (kind === 'pulse') {
      c.shape = 'pulse';
      c.label = PULSE_LABEL;
      c.tier = pulseTier(entry);
      c.pulse = {
        state: entry.state || 'signal',
        localTime: entry.localTime || '',
        glyphs: (entry.glyphs || '').trim(),
        text: (entry.text || '').trim(),
        footLeft: (entry.footLeft || '').trim(),
        footRight: (entry.footRight || '').trim(),
      };
      c.title = c.pulse.text;
      c.palette = c.pulse.state;   // pulseCard stamps state as data-state
      return c;
    }

    if (kind === 'audio') {
      c.shape = 'audio';
      var set = it.set || null;
      var playlist = !!(entry && entry.isPlaylist && Array.isArray(entry.tracks));
      c.tracks = playlist ? entry.tracks.slice() : (entry && entry.filename ? [entry] : []);
      c.label = badgeOf(o, playlist ? 'Audio // Multi-track' : 'Audio');
      var setName = set ? (set.name || set.slug || '') : '';
      if (playlist) {
        c.title = setName || 'Soundboard';
        c.href = entryHref('set', set)
          || (o ? (composedLink(o) || '/listen/') : '/listen/');
        c.tier = playlistTier(c.tracks.length);
      } else {
        c.title = setName || String((entry && entry.title) || '');
        c.href = entryHref('set', set) || listenHref(entry);
        c.meta = entry.sub ? String(entry.sub) : null;
      }
      // The author's words on an audio card are a CAPTION under the waveform
      // (§2.2), never the headline — audioCaption's rule, read the same way.
      var capTitle = o ? String(o.title || '').trim() : '';
      var capTease = o ? String(o.tease || '').trim() : '';
      if (capTitle || capTease) c.caption = { title: capTitle, tease: capTease };
      return c;
    }

    var isRaw = !!it.raw;
    var picture = (kind === 'photo') || layout === 'hero' || layout === 'overlay';
    if (picture) {
      c.shape = 'picture';
      var filename = composedMedia(o)
        || (kind === 'photo' ? entry.filename : heroFilename(entry));
      var folder = composedFolder(o);
      c.media = {
        filename: filename || '',
        folder: folder,
        src: frameSrc(filename, 1024, folder),
        focus: cardFocus(o) || cardFocus(entry),
      };
      if (kind === 'photo') {
        c.href = hrefOf(isRaw ? 'raw' : 'archive', entry, o);
        c.label = labelOf(o, isRaw ? 'RAW' : 'Archive');
        c.title = isRaw ? frameTag(entry.num) : textOf(o, entry, 'title');
        c.meta = captionOf(o, isRaw
          ? String(entry.captured_at || '').slice(0, 4)
          : [entry.camera, yearOf(entry)].filter(Boolean).join(' · '));
      } else {
        c.href = hrefOf('text', entry, o);
        c.label = labelOf(o, 'Field Note');
        c.title = textOf(o, entry, 'title');
        c.meta = captionOf(o, [entry.location, yearOf(entry)].filter(Boolean).join(' · '));
      }
      if (layout === 'overlay') {
        var ov = overlayOf(o);
        c.overlay = {
          place: ov.place, treat: ov.treat, blur: ov.blur, ink: overlayInk(o, ov.place),
          // The plate's type, off the same headline the card stamps them from.
          scale: overlayScale(c.title), mark: overlayMark(c.title),
        };
      }
      return c;
    }

    // The words tile.
    c.shape = 'words';
    c.href = hrefOf('text', entry, o);
    c.label = labelOf(o, 'Field Note');
    c.title = textOf(o, entry, 'title');
    var words = (o && o.tease != null) ? o.tease : entry.body;
    c.words = recentTruncate(recentStrip(words), TEASE_MAX);
    c.tier = recentTier(tierLen(c.words));
    var ini = recentInitial(c.words);
    c.initial = (ini && c.tier !== 'statement') ? ini : '';
    // A composed card carries no place-and-year line — every word on it was
    // typed (textCard's rule), so the line is absent rather than empty.
    c.meta = o ? null : [entry.location, yearOf(entry)].filter(Boolean).join(' · ');
    return c;
  }

  function buildCard(item) {
    var renderKind = CARD_KINDS[item.kind] || CARD_KINDS.text;
    var layout = layoutFor(item.kind, item.data, item.over);
    var node = renderKind(item, layout);
    // 'default' must add nothing (the byte-identity contract, see the engine
    // seam comment above) — only a real choice reaches the markup.
    if (layout !== 'default') node.setAttribute('data-layout', layout);
    return node;
  }
  g.RecentIndex.buildCard = buildCard;
  // What a card is made of, for the painter (chunk 7) and for anything else
  // that has to reason about a card without rendering one.
  g.RecentIndex.cardComposition = cardComposition;
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
      // The saved sets (chunk 4). Only a composed audio card that borrows one
      // reads this, and missing and empty mean the same thing — a fork with no
      // sets has no card that could name one.
      getJson('/data/audio-sets.json'),
    ])
      .then(function (res) {
        var archive = withSampleFallback(res[0], sampleFrames());
        var posts = withSampleFallback(res[1], [sampleNote()]);
        var summary = (res[2] && !Array.isArray(res[2])) ? res[2] : {};
        var rawFeatured = Array.isArray(summary.featured) ? summary.featured : [];
        var audio = Array.isArray(res[3]) ? res[3] : [];
        var pulse = (res[4] && !Array.isArray(res[4])) ? res[4] : null;
        var composed = Array.isArray(res[5]) ? res[5] : [];
        var audioSets = Array.isArray(res[6]) ? res[6] : [];
        var picks = pickRecent(archive, posts, rawFeatured, audio, pulse, composed, audioSets);
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
