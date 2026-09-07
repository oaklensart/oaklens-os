// OAKLENS Field Console — the Cards view.
//
// One question, answered in one place: **what does the homepage grid hold right
// now, and what will it hold after the next publish?** Before this view the
// answer was scattered across three surfaces — ★ on a buffer frame, ★ TRACK on
// the audio shelf, posts implicitly — plus the live pulse, and the only way to
// find out was to publish and go look.
//
// THE TRICK IS THAT THERE IS NO TRICK. This does not re-implement the grid's
// selection rule; it RUNS it. js/recent-index.js is the classic script the
// homepage itself loads, and dev/field-console.html now loads it here too — so
// `window.RecentIndex.pickRecent` composes both columns with the exact code the
// public page runs: slot order, pin budget, RAW cap, playlist ordering, the
// pulse yield, all of it. A second implementation would be a preview that
// drifts, which is worse than no preview at all.
//
// Two columns, one logic, different INPUTS:
//   LIVE   — the same five sources the homepage reads (/data/archive.json,
//            /data/posts.json, /api/buffer-summary, /data/audio.json,
//            /api/pulse), fetched plainly. These are public reads; they carry
//            no auth and belong in no telemetry channel.
//   STAGED — composed from STATE in memory, through the same filters
//            buildBundle() applies on the way to a publish.
// The pulse is fetched ONCE and appears in both: it is live already and no
// publish will change it (js/console/pulse.js — posting one costs no deploy).
//
// SCHEMATIC TILES, NOT CLONED CARDS. The console does not load css/main.css —
// its tokens are `:root`-scoped and would collide — so the slots render in the
// console's own vocabulary: slot number, kind kicker, a thumbnail for the
// picture kinds, the title or f#NNN, and the diff marker. Faithful in
// COMPOSITION (which card, which slot, why), honest that pixel truth lives on
// the homepage one click away.
//
// ACTIONS ROUTE THROUGH THE EXISTING MUTATORS, ALWAYS. Nothing here writes a
// flag itself. Starring is toggleBufferFeatured() in focal.js, the audio card is
// _audioPromote()/_audioClearCard() in audio.js, the crop is bufferCardFocal().
// That is not politeness about code reuse — those functions carry the STAGING
// LAW (one gesture, one bumpStage, +1 ALWAYS, never a tally), the exclusive-star
// sweep, and the ledger rows that name every id a gesture touched. A second
// write path here would be a second place for that to be wrong.
//
// Only the STAGED column is actionable. The LIVE column is a record of what is
// already published — there is nothing to change about the past, and every
// change you make shows up beside it as a marker flipping. That IS the feedback
// loop this view exists to close.
//
// UNDO IS STRUCTURAL, NOT A STACK (docs/cards-console-vision.md §2.4). Every
// action is a toggle or a swap whose reverse is the same affordance: unstar is
// the same ★ you pressed, and a displaced frame comes back through the ↩ RE-PIN
// chip, which re-runs the same exclusive path (so the chip then offers the other
// frame — the swap is symmetric by construction). Nothing is live until publish,
// and the view says so in its own copy.

import { STATE } from '../console-state.js';
import { escapeHTML, escapeAttrJS, registerView, showView } from './chrome.js';
import { cdnThumb } from './assets.js';
import { getBufferFrameNumbers } from './fn-editor.js';
import { toggleBufferFeatured, getLastFeaturedSwap, bufferCardFocal } from './focal.js';
import { _audioPromote, _audioClearCard, _audioRestoreCard, _audioCardRestoreTarget } from './audio.js';

// How many slots the homepage fetches. Not a knob: the 3-visible/4-fetched grid
// is a recorded owner decision (docs/pulse-card-vision.md §4) and the ground the
// pin-budget rule is argued from. This view PRESENTS that reality; it does not
// parameterise it — which is also why the fourth tile is badged rather than
// hidden.
const GRID_SIZE = 4;
// The server hands the homepage at most this many featured RAW frames
// (_featuredRawFrames' `limit` in src/api/site-meta.js); rawPick() then takes
// one. Mirrored, not re-decided.
const RAW_LIMIT = 4;

// The five reads, in the order recent-index.js' own render() makes them.
const LIVE_SOURCES = [
  '/data/archive.json',
  '/data/posts.json',
  '/api/buffer-summary',
  '/data/audio.json',
  '/api/pulse',
];

// The engine, as the browser sees it. A getter rather than a captured value:
// the classic <script> tag and this module load independently, and a stale
// snapshot taken at import time would be `undefined` forever.
function engine() {
  return (typeof window !== 'undefined' && window.RecentIndex) || null;
}

// ---- the staged RAW list ----
//
// A mirror of _featuredRawFrames() in src/api/site-meta.js: the same filter →
// sort → slice, and positional frame numbers taken over the WHOLE buffer. It
// exists because that endpoint runs on the PUBLISHED buffer.json, and the whole
// point of the staged column is to answer the question before the publish.
// Duplicated logic across the console/Worker barrier is a drift risk, so it is
// pinned the way the tier ladder already is — a parity test runs one fixture
// through both and asserts the outputs are identical (tests/cards-view.test.js).
//
// No _uploadError/_uploading filter here, unlike the archive/posts/audio lists
// below, and that is deliberate on both halves: the numbers must be the same
// f#NNN the rest of the console cites (getBufferFrameNumbers is that authority),
// and publish REFUSES to run while any frame is pending or failed, so at the
// moment this column describes, the two sets are the same set anyway.
export function _stagedFeaturedRaw(limit = RAW_LIMIT) {
  const nums = getBufferFrameNumbers();
  return (STATE.buffer || [])
    .filter((e) => e && e.featured && !e.dark && e.filename)
    .sort((a, b) => (b.captured_at || '').localeCompare(a.captured_at || ''))
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      filename: e.filename,
      num: nums.get(e.id) || 0,
      focus: e.focus || '',
      cardFocus: e.cardFocus || '',
      captured_at: e.captured_at || e.published_at || '',
    }));
}

// ---- what the next publish would hand the homepage ----
//
// The arrays are STATE's own, narrowed by the filters buildBundle() applies on
// the way out (js/console/publish.js). The load-bearing one is `status`: a
// DRAFT lives in STATE.posts and never reaches posts.json, so handing STATE.posts
// straight to pickRecent would put an unpublished note on the preview — exactly
// the class of lie this view exists to remove. The upload filters ride along so
// there is one rule here rather than three: "what publish would emit."
//
// Entries are passed through as-is, not re-serialised — pickRecent reads the
// same field names on either side (`hero_filename` and `hero` both satisfy the
// hero gate), and copying buildBundle's projection would be a second place for
// the shape to drift.
export function _stagedInputs() {
  return {
    archive: (STATE.archive || []).filter((a) => a && !a._uploadError && !a._uploading),
    posts: (STATE.posts || []).filter((p) => p && (!p.status || p.status === 'published')),
    rawFeatured: _stagedFeaturedRaw(),
    audio: (STATE.audio || []).filter((a) => a && !a._uploadError && !a._uploading),
  };
}

// ---- the live reads ----
//
// Mirrors recent-index.js' own getJson(), including the null-vs-[] split that
// decides sample fallback: a MISSING file is an un-seeded fork and falls back
// to the bundled samples; a file that loads as [] was cleared on purpose and
// stays empty.
//
// A 404 is therefore NOT a failure — it is the documented fresh-fork state, and
// a fork whose data files do not exist yet must not be told its preview is
// broken. `failed` collects only the reads that genuinely could not happen
// (offline, or a server error), so the column can say what it is missing
// instead of quietly showing a grid built on holes.
async function _liveInputs() {
  const failed = [];
  const results = await Promise.all(LIVE_SOURCES.map(async (path) => {
    try {
      const res = await fetch(path);
      if (!res.ok) {
        if (res.status !== 404) failed.push(path);
        return null;
      }
      return await res.json();
    } catch {
      failed.push(path);
      return null;
    }
  }));

  const RI = engine();
  const [archiveRaw, postsRaw, summaryRaw, audioRaw, pulseRaw] = results;
  const summary = (summaryRaw && !Array.isArray(summaryRaw)) ? summaryRaw : {};
  return {
    archive: RI ? RI.withSampleFallback(archiveRaw, RI.sampleFrames()) : [],
    posts: RI ? RI.withSampleFallback(postsRaw, [RI.sampleNote()]) : [],
    rawFeatured: Array.isArray(summary.featured) ? summary.featured : [],
    audio: Array.isArray(audioRaw) ? audioRaw : [],
    pulse: (pulseRaw && !Array.isArray(pulseRaw)) ? pulseRaw : null,
    failed,
  };
}

// ---- a picked item → a schematic tile ----
//
// Everything a slot tile shows, derived from the SAME item pickRecent produced
// and the same helpers the card renderer uses (layoutFor for the field-note
// hero opt-in, recentTier/tierLen for the tease ladder). `key` is the slot's
// identity and the only thing the diff compares: two renders of the same
// occupant must produce the same key, and any other occupant a different one.
//
// `id` and `view` are what make a tile actionable: the entity the mutators take,
// and the surface this card actually lives on so "open it" is one tap rather
// than a hunt through the sidebar.
export function _slotOf(item) {
  if (!item) return null;
  const RI = engine();
  const data = item.data || {};

  if (item.kind === 'pulse') {
    return {
      kind: 'pulse',
      key: `pulse:${data.id || ''}`,
      kicker: 'PULSE',
      title: (data.text || '').trim() || (data.glyphs || '').trim(),
      sub: RI ? RI.pulseTier(data) : '',
      thumb: '',
      live: true,
      view: 'pulse',
    };
  }

  if (item.kind === 'audio') {
    if (data.isPlaylist && Array.isArray(data.tracks)) {
      const slugs = data.tracks.map((t) => t.slug || '').join(',');
      return {
        kind: 'audio',
        key: `audio:playlist:${slugs}`,
        kicker: `AUDIO · ${data.tracks.length} TRACKS`,
        title: data.tracks[0] ? (data.tracks[0].title || data.tracks[0].slug || '') : '',
        sub: 'playlist',
        thumb: '',
        playlist: true,
        view: 'audio',
      };
    }
    return {
      kind: 'audio',
      key: `audio:${data.slug || ''}`,
      kicker: 'AUDIO',
      title: data.title || data.slug || '',
      sub: data.sub || '',
      thumb: '',
      id: data.id || '',
      view: 'audio',
    };
  }

  if (item.kind === 'photo' && item.raw) {
    return {
      kind: 'raw',
      key: `raw:${data.id || ''}`,
      kicker: 'RAW',
      title: `f#${String(data.num || 0).padStart(3, '0')}`,
      sub: String(data.captured_at || '').slice(0, 10),
      thumb: cdnThumb({ filename: data.filename }),
      focus: RI ? RI.cardFocus(data) : '',
      id: data.id || '',
      view: 'buffer',
    };
  }

  if (item.kind === 'photo') {
    return {
      kind: 'archive',
      key: `photo:${data.slug || ''}`,
      kicker: 'ARCHIVE',
      title: data.title || data.slug || '',
      sub: [data.camera, data.location].filter(Boolean).join(' · '),
      // The whole entry, not a synthetic { filename }: cdnThumb() prefers an
      // entry's local dataURL, so a frame staged but not yet uploaded still
      // shows the picture the author is looking at.
      thumb: cdnThumb(data),
      focus: RI ? RI.cardFocus(data) : '',
      id: data.id || '',
      view: 'archive',
    };
  }

  // Text — and the one kind that can wear a second layout today. The hero
  // opt-in is a GATE, not a flag: layoutFor() answers "can this entry actually
  // wear it", so a note that opted in without a usable picture reads as the
  // text tile here for the same reason it renders as one on the homepage.
  const layout = RI ? RI.layoutFor('text', data) : 'default';
  const excerpt = RI ? RI.recentExcerpt(data.body) : '';
  return {
    kind: 'text',
    key: `text:${data.fn_id || ''}`,
    kicker: layout === 'hero' ? 'FIELD NOTE · HERO' : 'FIELD NOTE',
    title: data.title || '',
    sub: RI && layout !== 'hero' ? RI.recentTier(RI.tierLen(excerpt)) : '',
    thumb: layout === 'hero' && RI ? cdnThumb({ filename: RI.heroFilename(data) }) : '',
    focus: layout === 'hero' && RI ? RI.cardFocus(data) : '',
    id: data.id || '',
    view: 'fn',
  };
}

// Run the shipped selection logic over one set of inputs and describe the row.
// Always GRID_SIZE long: an unfilled slot is a real answer ("nothing lands
// here"), and a short array would silently hide a GONE.
export function _cardSlots(inputs) {
  const RI = engine();
  if (!RI) return [];
  const picks = RI.pickRecent(
    inputs.archive, inputs.posts, inputs.rawFeatured, inputs.audio, inputs.pulse,
  );
  const slots = [];
  for (let i = 0; i < GRID_SIZE; i++) slots.push(_slotOf(picks[i]) || null);
  return slots;
}

// NEW (staged only) · REPLACED (different occupant) · UNCHANGED · GONE (live
// only). Compared per slot INDEX, because the slot is what the visitor sees:
// the same card moving from slot 2 to slot 1 is a change to the homepage, not
// a non-event.
export function _diffSlots(live, staged) {
  const marks = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    const l = live[i];
    const s = staged[i];
    if (!l && !s) marks.push('');
    else if (!l) marks.push('NEW');
    else if (!s) marks.push('GONE');
    else marks.push(l.key === s.key ? 'UNCHANGED' : 'REPLACED');
  }
  return marks;
}

// ---- actions ----
//
// Every one of these is an exported function called from an inline on*=
// attribute, which runs in GLOBAL scope: the window bridge mirrors exports onto
// window at boot, so a handler can call an exported function but can never see a
// module-scope binding. (tests/inline-handlers.test.js enforces the first half;
// the swap record is read through getLastFeaturedSwap() rather than a bare
// export for the second.)
//
// None of them writes a flag. Each hands off to the mutator that owns the
// gesture — which stages it, saves, repaints its own surface and toasts — and
// then repaints these tiles.

// The star, from the card instead of from the buffer grid. Same exclusive
// path, so starring a different frame un-stars this one in the same gesture and
// the ↩ chip below appears offering it back.
export function cardsToggleRaw(id) {
  if (!id) return;
  toggleBufferFeatured(id);
  _repaint();
}

// The 4:5 card crop, framed against the card it is actually for. The modal is
// asynchronous, so the tiles repaint through the callback rather than now —
// otherwise the preview would keep the old crop until you left the view and
// came back, which is exactly the kind of small lie this view exists to remove.
export function cardsCropRaw(id) {
  if (!id) return;
  bufferCardFocal(id, _repaint);
}

// Take one track off the homepage card. _audioPromote is a toggle; from here it
// can only ever be demoting, because a track that is not on the card has no tile
// to press. Putting one ON stays where every track already lives — ★ TRACK on
// the Audio shelf.
export function cardsDemoteAudio(id) {
  if (!id) return;
  _audioPromote(id);
  _repaint();
}

// The whole playlist at once. Per-track ordering belongs on the shelf, which is
// one tap away on the same tile.
// The Cards view's mirror of the shelf's ↩ RESTORE CARD. Same module memory,
// same live resolution — the chip is offered here because this is the view that
// shows the card coming down, and reversibility layer 2 says the reverse of a
// displacing action belongs in the view that made it.
export function cardsRestoreAudioCard() {
  _audioRestoreCard();
  renderCards();
}

export function cardsClearAudioCard() {
  _audioClearCard();
  _repaint();
}

// ↩ RE-PIN — undo a star that displaced something, by re-running the same
// exclusive path on the frame that yielded. Structural undo: the swap record
// flips, so the chip now offers the frame you just left, and pressing twice
// returns you exactly where you started (+1 staged each time — the counter
// tallies GESTURES, never featured frames).
export function cardsRepinSwap() {
  const target = _repinTarget();
  if (!target) return;
  toggleBufferFeatured(target.id);
  _repaint();
}

// The "ready to re-feature" shelf. A frame that was featured once keeps its
// cardFocus with no `featured` flag — not cruft, a free marker that this frame
// has already been framed for the tall card. Stateless, so unlike the swap chip
// it survives a reload.
export function cardsRefeature(id) {
  if (!id) return;
  toggleBufferFeatured(id);
  _repaint();
}

// Open the surface a card actually lives on.
export function cardsOpen(view) {
  if (view) showView(view);
}

// The frame the ↩ chip would restore, or null when there is nothing to offer.
//
// The swap record is module state in focal.js: it outlives a render, a view
// change and every other action, which is what makes the chip useful a minute
// later — and also what makes it capable of naming a frame that has since been
// retired, deleted, or starred again by some other route. So the chip is
// resolved against the buffer as it is NOW, not against the memory: a dead
// button that silently does nothing is worse than no button.
export function _repinTarget() {
  const swap = getLastFeaturedSwap();
  if (!swap || !swap.prevId) return null;
  const p = (STATE.buffer || []).find((b) => b && b.id === swap.prevId);
  // Already back on the card (or gone, or retired) — nothing left to undo.
  if (!p || p.dark || p.featured || !p.filename) return null;
  return p;
}

// Frames carrying an orphaned card crop, newest first — the shelf's contents.
// Exported so the test can assert the rule rather than read it off the markup.
export function _refeatureReady() {
  return (STATE.buffer || [])
    .filter((b) => b && b.cardFocus && !b.featured && !b.dark && b.filename)
    .sort((a, b) => (b.captured_at || '').localeCompare(a.captured_at || ''));
}

// ---- markup ----

// The action row for one staged tile. Empty for a kind with nothing to act on,
// which collapses to no row at all rather than a lonely "open" button.
function actionsHtml(slot) {
  if (!slot) return '';
  const q = (v) => `'${escapeAttrJS(String(v || ''))}'`;
  const acts = [];
  if (slot.kind === 'raw' && slot.id) {
    acts.push(`<button class="slot-act" onclick="cardsToggleRaw(${q(slot.id)})"
      title="Unstar this frame — it leaves the homepage on the next publish">★ UNSTAR</button>`);
    acts.push(`<button class="slot-act" onclick="cardsCropRaw(${q(slot.id)})"
      title="Set the tall 4:5 crop this card uses">▯ CROP</button>`);
  }
  if (slot.kind === 'audio') {
    if (slot.playlist) {
      acts.push(`<button class="slot-act" onclick="cardsClearAudioCard()"
        title="Take every track off the homepage card">✕ CLEAR CARD</button>`);
    } else if (slot.id) {
      acts.push(`<button class="slot-act" onclick="cardsDemoteAudio(${q(slot.id)})"
        title="Take this track off the homepage card">✕ OFF CARD</button>`);
    }
  }
  // The pulse is live already and no publish touches it, so its only affordance
  // is the composer — which is where taking it down lives too.
  if (slot.view) {
    acts.push(`<button class="slot-act slot-act--quiet" onclick="cardsOpen(${q(slot.view)})"
      title="Open the surface this card comes from">OPEN ↗</button>`);
  }
  return acts.length ? `<div class="slot-actions">${acts.join('')}</div>` : '';
}

function tileHtml(slot, index, mark, actionable) {
  // The marker and the tablet badge are a grid CELL, not an overlay. Absolutely
  // positioning them was the first cut and it read fine at desktop width, then
  // sat straight on top of the meta line on a phone — where this console is
  // most often held.
  const status = `<div class="slot-status">`
    + `${mark ? `<span class="slot-mark" data-mark="${mark}">${mark}</span>` : ''}`
    + `${index === 3 ? '<span class="slot-badge">TABLET ONLY</span>' : ''}`
    + `</div>`;
  const n = `<span class="slot-n">${String(index + 1).padStart(2, '0')}</span>`;
  if (!slot) {
    return `<article class="card-slot is-empty">${n}
      <div class="slot-meta"><div class="slot-kick">— EMPTY —</div></div>
      ${status}
    </article>`;
  }
  // An <img>, the way every other console surface renders a thumbnail — and
  // object-position carries the card's own 4:5 crop (cardFocus → focus →
  // centre), so a frame framed for the tall tile previews the way it will
  // actually sit in it.
  const thumb = slot.thumb
    ? `<div class="slot-thumb"><img src="${escapeHTML(slot.thumb)}" alt=""` +
      `${slot.focus ? ` style="object-position:${escapeHTML(slot.focus)}"` : ''}></div>`
    : '<div class="slot-thumb is-blank" aria-hidden="true"></div>';
  const live = slot.live
    ? '<div class="slot-live">LIVE · NOT PART OF PUBLISH</div>'
    : '';
  return `<article class="card-slot" data-kind="${slot.kind}">${n}
    ${thumb}
    <div class="slot-meta">
      <div class="slot-kick">${escapeHTML(slot.kicker)}</div>
      <div class="slot-title">${escapeHTML(slot.title)}</div>
      ${slot.sub ? `<div class="slot-sub">${escapeHTML(slot.sub)}</div>` : ''}
      ${live}
      ${actionable ? actionsHtml(slot) : ''}
    </div>
    ${status}
  </article>`;
}

function columnHtml({ title, note, slots, marks, warn, actionable, extra }) {
  const tiles = slots.map((s, i) => tileHtml(s, i, marks ? marks[i] : '', actionable)).join('');
  return `<section class="cards-col">
    <header class="cards-col-head">
      <span class="cards-col-title">${escapeHTML(title)}</span>
      <span class="cards-col-note">${escapeHTML(note)}</span>
    </header>
    ${warn ? `<div class="cards-warn">${escapeHTML(warn)}</div>` : ''}
    <div class="cards-col-body">${tiles}</div>
    ${extra || ''}
  </section>`;
}

// ---- the two undo affordances, under the staged column ----
//
// Both answer "I just changed the wrong thing" without a stack. The chip is the
// live memory of the last displacing star; the shelf is the stateless one, read
// straight off the data, so it is still there tomorrow.
function undoHtml() {
  const nums = getBufferFrameNumbers();
  const label = (id) => `f#${String(nums.get(id) || 0).padStart(3, '0')}`;
  const prev = _repinTarget();
  const ready = _refeatureReady();
  const audioBack = _audioCardRestoreTarget();
  if (!prev && !ready.length && !audioBack) return '';

  const audioChip = audioBack
    ? `<button class="cards-chip cards-chip--undo" onclick="cardsRestoreAudioCard()"
         title="Put the ${audioBack.length} track${audioBack.length === 1 ? '' : 's'} you just cleared back on the audio card">
         ↩ RESTORE AUDIO CARD</button>`
    : '';

  const chip = prev
    ? `<button class="cards-chip cards-chip--undo" onclick="cardsRepinSwap()"
         title="Put the frame this star displaced back on the card">
         ↩ RE-PIN ${escapeHTML(label(prev.id))}</button>`
    : '';

  const shelf = ready.length
    ? `<div class="cards-shelf">
         <div class="cards-shelf-head">READY TO RE-FEATURE
           <span>frames already framed for this card</span></div>
         <div class="cards-shelf-body">${ready.map((b) => `
           <button class="cards-chip" onclick="cardsRefeature('${escapeAttrJS(b.id)}')"
             title="Feature this frame — its saved 4:5 crop comes with it">
             <img src="${escapeHTML(cdnThumb({ filename: b.filename }))}" alt=""
               style="object-position:${escapeHTML(b.cardFocus)}">
             ★ ${escapeHTML(label(b.id))}</button>`).join('')}</div>
       </div>`
    : '';

  return `<div class="cards-undo">${chip}${audioChip}${shelf}</div>`;
}

// The degraded state that must never be a throw: recent-index.js is a separate
// <script> tag, and a stale service-worker copy or a blocked request means the
// engine simply is not there. Say so plainly — the console is still fully
// usable, only the preview is missing.
function unavailableHtml() {
  return `<div class="cards-unavailable">
    <div class="cards-unavailable-mark">// PREVIEW UNAVAILABLE</div>
    <p>The homepage's own grid logic (<code>/js/recent-index.js</code>) did not load,
       so there is nothing honest to show here. Everything else in the console works.
       Reload the page — if you are offline with an older copy installed, it comes
       back with the next connection.</p>
  </div>`;
}

// The last LIVE read, kept so an action can repaint without going back to the
// network. This is not a cache for speed's sake: the LIVE column is the
// PUBLISHED site, and nothing you do in this console can change it — only a
// publish can. Re-fetching five files to redraw a column whose inputs provably
// did not move would make every star feel slow and say nothing new.
let _liveCache = null;

// Paint both columns from a set of live inputs already in hand.
function _paint(host, live) {
  const staged = { ..._stagedInputs(), pulse: live.pulse };
  const liveSlots = _cardSlots(live);
  const stagedSlots = _cardSlots(staged);
  const marks = _diffSlots(liveSlots, stagedSlots);

  const warn = live.failed.length
    ? `Could not reach ${live.failed.join(', ')} — this column is missing that source.`
    : '';

  host.innerHTML = `
    <div class="cards-note">
      Three tiles show on a phone and a desktop; the fourth appears only on a tablet
      held upright. Act on the STAGED column — nothing there is on your site until
      you publish, and every change shows up as a marker beside what is live now.
    </div>
    <div class="cards-columns">
      ${columnHtml({ title: 'LIVE', note: 'your homepage right now', slots: liveSlots, warn })}
      ${columnHtml({
        title: 'STAGED', note: 'after the next publish', slots: stagedSlots, marks,
        actionable: true, extra: undoHtml(),
      })}
    </div>`;
}

// Redraw after an action. Falls back to a full render if there is nothing
// cached — which cannot happen from a tile that is on screen, but an exported
// handler is reachable from anywhere and must not depend on that.
function _repaint() {
  const host = document.getElementById('cards-body');
  if (!host) return;
  if (!engine()) { host.innerHTML = unavailableHtml(); return; }
  if (!_liveCache) { renderCards(); return; }
  _paint(host, _liveCache);
}

export async function renderCards() {
  const host = document.getElementById('cards-body');
  if (!host) return;

  if (!engine()) {
    host.innerHTML = unavailableHtml();
    return;
  }

  host.innerHTML = '<div class="cards-loading">// READING LIVE CARDS…</div>';

  const live = await _liveInputs();

  // The engine can disappear between the guard above and here only if the
  // script was evicted mid-render, but re-checking costs nothing and the
  // alternative is a throw inside an async view render.
  if (!engine()) {
    host.innerHTML = unavailableHtml();
    return;
  }

  _liveCache = live;
  _paint(host, live);
}

// Registered at module top level, the way pulse.js does it: the barrel's
// `export *` evaluates this file at boot, so the nav button is live with no
// entry in init.js. Miss this and the button is simply dead —
// tests/console-boot.test.js asserts every [data-view] target has a renderer.
registerView('cards', {
  render() {
    renderCards();
  },
});
