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
// Two grids, one logic, different INPUTS:
//   LIVE   — the same five sources the homepage reads (/data/archive.json,
//            /data/posts.json, /api/buffer-summary, /data/audio.json,
//            /api/pulse), fetched plainly. These are public reads; they carry
//            no auth and belong in no telemetry channel.
//   STAGED — composed from STATE in memory, through the same filters
//            buildBundle() applies on the way to a publish.
// The pulse is fetched ONCE and appears in both: it is live already and no
// publish will change it (js/console/pulse.js — posting one costs no deploy).
//
// THE SHELL: a slot ribbon over two modes. STUDIO focuses one slot beside an
// inspector rail that carries its controls; PANORAMA shows the whole row at
// once. A source toggle swaps which grid is on screen.
//
// ⚠️ The view shipped (K16/K17) with LIVE and STAGED as side-by-side columns,
// and the toggle replaced them (owner, 2026-09-07). BOTH grids are still
// composed on every paint and _diffSlots still runs across the pair, because the
// per-slot markers — not the two columns — are the signal: they are what made
// the hidden-fourth-slot pin bug visible (K18). The marks ride the staged tiles,
// and the head carries the count in both sources, so "something is waiting" can
// never be hidden by which grid you happen to be looking at. A redesign that
// dropped that would be a regression wearing a new layout.
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
// Only STAGED is actionable. LIVE is a record of what is already published —
// there is nothing to change about the past, and every change you make shows up
// as a marker flipping. That IS the feedback loop this view exists to close.
//
// UNDO IS STRUCTURAL, NOT A STACK (docs/cards-console-vision.md §2.4). Every
// action is a toggle or a swap whose reverse is the same affordance: unstar is
// the same ★ you pressed, a displaced frame comes back through the ↩ RE-PIN chip
// which re-runs the same exclusive path (so the chip then offers the other frame
// — the swap is symmetric by construction), and the LAYOUT PICKER reverses by
// pressing the standard option, which is always on screen and runs the same
// mutator. Nothing is live until publish, and the view says so in its own copy.
//
// The reuse shelf along the bottom is a shelf of things to use AGAIN, never a
// list of states to restore — see reuseShelfHtml() for why that line matters.

import {
  STATE, save, stageChange, trashItem, ledgerRowFor, restoreStagedRow,
} from '../console-state.js';
import { escapeHTML, escapeAttrJS, registerView, showView, toast } from './chrome.js';
import { cdnThumb, cdnVariant } from './assets.js';
import { uid, todayISO } from './utils.js';
import { openAssetLibrary } from './asset-library.js';
import { getBufferFrameNumbers } from './fn-editor.js';
import {
  toggleBufferFeatured, getLastFeaturedSwap, bufferCardFocal, openFocalModal,
} from './focal.js';
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
  '/data/cards.json',
];

// The engine, as the browser sees it. A getter rather than a captured value:
// the classic <script> tag and this module load independently, and a stale
// snapshot taken at import time would be `undefined` forever.
function engine() {
  return (typeof window !== 'undefined' && window.RecentIndex) || null;
}

// A slot's kind is what the VISITOR sees on the grid (a starred buffer frame and
// an archive photo are different cards); the engine's kind is what the RENDERER
// dispatches on, and both photos are `photo` to it. Two vocabularies for two
// jobs — this is the only place they meet.
const ENGINE_KIND = {
  raw: 'photo', archive: 'photo', text: 'text', audio: 'audio', pulse: 'pulse',
  composed: 'composed',
};

// Where an entry of each slot kind actually lives, and which staging surface
// owns it. The pulse is absent on purpose: it is live already, no publish
// touches it, and it has no STATE array to edit.
const SLOT_SURFACE = {
  raw: { list: () => STATE.buffer, surface: 'buffer', noun: 'frame' },
  archive: { list: () => STATE.archive, surface: 'archive', noun: 'photo' },
  text: { list: () => STATE.posts, surface: 'posts', noun: 'field note' },
  audio: { list: () => STATE.audio, surface: 'audio', noun: 'track' },
  composed: { list: () => STATE.cards, surface: 'cards', noun: 'card' },
};

// ---- view state ----
//
// Module-scope, never exported as bindings. The window bridge SNAPSHOTS exports
// at boot, so an exported `let` read through window is stale forever — the
// CDN_BASE failure shape. Inline handlers call the exported setters below, which
// read and write these from inside the module where the live binding is real.
//
//   _mode   — 'studio' focuses one slot with its inspector; 'panorama' shows the
//             whole row at once. Two questions, two layouts: "what is this card
//             doing" and "what does the grid look like".
//   _source — 'staged' (what the next publish makes) or 'live' (what is on the
//             site now). Replaces the side-by-side columns the view shipped
//             with. ⚠️ The per-slot diff MARKERS are computed either way and
//             stay on the staged tiles: they are the signal that caught the
//             hidden-fourth-slot pin bug (K18), and a redesign that dropped them
//             would be a regression wearing a new layout. In LIVE the count
//             still shows, so the pending diff is never invisible.
let _mode = 'studio';
let _source = 'staged';
let _slotIndex = 0;

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
      // Mirrors _featuredRawFrames' own conditional spread — see the note there.
      ...(e.card ? { card: e.card } : {}),
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
    // The owner's composed cards. No filter: a card names its picture in
    // `media`, never uploads one of its own, and so can never be the
    // pending-upload case the other lists guard against.
    composed: STATE.cards || [],
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
  const [archiveRaw, postsRaw, summaryRaw, audioRaw, pulseRaw, cardsRaw] = results;
  const summary = (summaryRaw && !Array.isArray(summaryRaw)) ? summaryRaw : {};
  return {
    archive: RI ? RI.withSampleFallback(archiveRaw, RI.sampleFrames()) : [],
    posts: RI ? RI.withSampleFallback(postsRaw, [RI.sampleNote()]) : [],
    rawFeatured: Array.isArray(summary.featured) ? summary.featured : [],
    audio: Array.isArray(audioRaw) ? audioRaw : [],
    pulse: (pulseRaw && !Array.isArray(pulseRaw)) ? pulseRaw : null,
    composed: Array.isArray(cardsRaw) ? cardsRaw : [],
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

  // A composed card — the owner's own. It is the only kind that is EDITABLE
  // here rather than merely actionable, so the tile carries the card record
  // itself and the studio composes straight onto it.
  if (item.kind === 'composed') {
    const media = RI ? RI.composedMedia(data) : '';
    return {
      kind: 'composed',
      key: `composed:${data.id || ''}`,
      kicker: `${RI ? RI.composedLabel(data) : 'Featured'} · COMPOSED`,
      title: (data.title || '').trim() || (data.tease || '').trim() || '— untitled —',
      sub: media ? '' : (RI ? RI.recentTier(RI.tierLen(data.tease || '')) : ''),
      tease: data.tease || '',
      thumb: media ? cdnThumb({ filename: media }, RI ? RI.composedFolder(data) : 'archive') : '',
      focus: RI ? RI.cardFocus(data) : '',
      palette: data.palette || '',
      id: data.id || '',
      composed: true,
      view: 'cards',
      item,
    };
  }

  if (item.kind === 'pulse') {
    return {
      kind: 'pulse',
      key: `pulse:${data.id || ''}`,
      kicker: 'PULSE',
      title: (data.text || '').trim() || (data.glyphs || '').trim(),
      text: data.text || '',
      glyphs: data.glyphs || '',
      localTime: data.localTime || '',
      state: data.state || 'signal',
      footLeft: data.footLeft || '',
      footRight: data.footRight || '',
      tier: RI ? RI.pulseTier(data) : 'statement',
      sub: '',
      tease: '',
      thumb: '',
      live: true,
      view: 'pulse',
      item,
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
        item,
      };
    }
    return {
      kind: 'audio',
      key: `audio:${data.slug || ''}`,
      kicker: 'AUDIO',
      title: data.title || data.slug || '',
      sub: data.sub || '',
      tease: '',
      thumb: '',
      id: data.id || '',
      view: 'audio',
      item,
    };
  }

  if (item.kind === 'photo' && item.raw) {
    return {
      kind: 'raw',
      key: `raw:${data.id || ''}`,
      kicker: 'RAW',
      title: `f#${String(data.num || 0).padStart(3, '0')}`,
      sub: String(data.captured_at || '').slice(0, 10),
      tease: '',
      thumb: cdnThumb({ filename: data.filename }),
      focus: RI ? RI.cardFocus(data) : '',
      id: data.id || '',
      view: 'buffer',
      item,
    };
  }

  if (item.kind === 'photo') {
    return {
      kind: 'archive',
      key: `photo:${data.slug || ''}`,
      kicker: 'ARCHIVE',
      title: data.title || data.slug || '',
      sub: [data.camera, data.location].filter(Boolean).join(' · '),
      tease: '',
      // The whole entry, not a synthetic { filename }: cdnThumb() prefers an
      // entry's local dataURL, so a frame staged but not yet uploaded still
      // shows the picture the author is looking at.
      thumb: cdnThumb(data),
      focus: RI ? RI.cardFocus(data) : '',
      id: data.id || '',
      view: 'archive',
      item,
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
    // The tease is the card's body copy, so the preview can run the real tier
    // ladder over it. A hero note has none — the picture leads and the tier
    // rules have nothing to bind to (§5.31).
    tease: layout === 'hero' ? '' : excerpt,
    sub: data.location || '',
    thumb: layout === 'hero' && RI ? cdnThumb({ filename: RI.heroFilename(data) }) : '',
    focus: layout === 'hero' && RI ? RI.cardFocus(data) : '',
    id: data.id || '',
    view: 'fn',
    item,
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
    inputs.composed,
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

// ---- the shell's own controls ----
//
// Pure view state: none of these touch STATE, stage anything, or reach the
// network. They repaint from _liveCache, so switching mode or source is
// instant and costs no reads — the LIVE column cannot have changed, because
// only a publish can change it.

export function cardsSetMode(mode) {
  if (mode !== 'studio' && mode !== 'panorama') return;
  _mode = mode;
  _repaint();
}

export function cardsSetSource(source) {
  if (source !== 'staged' && source !== 'live') return;
  _source = source;
  _repaint();
}

export function cardsSelectSlot(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= GRID_SIZE) return;
  // A `_composing` whose card is gone from under the studio (removed by a sync,
  // a restore, or a state reload) must not read as "something is being edited":
  // the re-decision below is skipped while one is, so the next click on the same
  // pill would be a dead one.
  if (_composing && !_cardById(_composing)) { _composing = null; _editSnapshot = null; }
  const changed = i !== _slotIndex;
  _slotIndex = i;
  // Picking a slot decides what the studio is doing: land on a card you
  // composed and you are editing it; land on anything else and you are not.
  // Without this, a half-finished card stayed open behind whatever slot you
  // clicked next.
  const slots = _lastSlots || [];
  const at = slots[i];
  // Landing anywhere other than the card being composed LEAVES it, so an
  // unfinished one is abandoned here too (_discardIfGhost). Before the block
  // below, so the budget it frees is available on the same click.
  if (_composing && !(at && at.composed && at.id === _composing)) _discardIfGhost(_composing);
  // Re-decide what the studio is doing whenever the slot changed OR nothing is
  // being edited yet — so clicking the pill of the slot you are already parked
  // on (a read-only preview, or after Done/Esc) opens its composer too, rather
  // than dead-clicking because the index did not move.
  if (changed || !_composing) {
    if (at && at.composed) {
      // Landing on a composed card IS editing it (this is why Cancel has to have
      // something to revert to) — so seed the snapshot, exactly as the ✎ EDIT
      // button does. Without this the composer opened but Cancel did nothing.
      _focusComposed(at.id);
      _snapshotExisting(_cardById(at.id));
    } else {
      // Leaving for a non-composed slot: drop the snapshot too, so a later edit
      // of a different card can never revert against a stale one.
      _focusComposed(null);
      _editSnapshot = null;
    }
  }
  _mode = 'studio';
  _repaint();
}

// The entry a slot points at, in the STATE array that owns it. Null for the
// pulse, for an empty slot, and for anything the console does not hold.
function _entryOf(slot) {
  const home = slot && SLOT_SURFACE[slot.kind];
  if (!home || !slot.id) return null;
  return (home.list() || []).find((e) => e && e.id === slot.id) || null;
}

// ---- the layout picker ----
//
// REVERSIBILITY IS STRUCTURAL HERE, AND THAT IS THE WHOLE DESIGN. A picker is an
// overwrite, which normally earns a snapshot and an undo chip (the rule's layer
// 2). It does not here, because `default` is always one of the options and it is
// always on screen: pressing it IS the reverse of pressing `hero`, it runs this
// same function, and it stages the same way. One mutator, both directions — the
// FN composer's ▢/▣ HERO CARD toggle generalised to a set. No chip, no ledger
// snapshot, no new machinery. (CLAUDE.md "Reversibility"; §2.4 of the vision.)
//
// +1 STAGED IN BOTH DIRECTIONS, like every other gesture in this console.
// STATE.staged counts unpublished CHANGES, never a tally of things — going back
// to the default is a change to publish, not the undoing of a count.
//
// The gate is checked against a PROBE rather than the live entry, so a layout
// the entry cannot actually wear is refused before anything is written. A
// control that could be switched on to no effect would be lying about what
// publish will produce — the same reason fnToggleHeroCard() refuses without a
// hero image.
export function cardsSetLayout(slotKind, id, layout) {
  const home = SLOT_SURFACE[slotKind];
  const RI = engine();
  if (!home || !id || !layout || !RI) return;

  const entry = (home.list() || []).find((e) => e && e.id === id);
  if (!entry) return;

  const kind = ENGINE_KIND[slotKind] || 'text';
  if (RI.resolveLayout(kind, layout) !== layout) return;

  // The descriptor is an object so future per-card decisions join it as keys
  // rather than as new top-level fields on every content type. So going back to
  // the default removes the LAYOUT key, and drops `card` entirely only when
  // nothing else is left on it.
  const rest = { ...(entry.card || {}) };
  delete rest.layout;
  const next = layout === 'default' ? null : { ...rest, layout };

  if (next && RI.layoutFor(kind, { ...entry, card: next }) !== layout) {
    toast(`This ${home.noun} can't wear the ${layout} layout yet — it needs a picture first`, 'warn');
    return;
  }
  if (RI.layoutFor(kind, entry) === layout) return; // already there; nothing to stage

  if (next) entry.card = next;
  else if (Object.keys(rest).length) entry.card = rest;
  else delete entry.card;

  const name = entry.title || entry.slug || entry.filename || id;
  stageChange(home.surface, {
    id,
    label: `${name} — homepage card: ${layout}`,
    kind: 'feature',
  });
  save();
  toast(layout === 'default'
    ? '✓ Back to the standard card — applies on publish'
    : `✓ Card layout: ${layout} — applies on publish`, 'success');
  _repaint();
}

// ============================================================================
// THE COMPOSER — building a card rather than inspecting one
// ============================================================================
//
// Everything above answers "what is on the grid". Everything below lets the
// owner PUT something there: pick a source from anywhere on the site, write the
// card's own words, crop its picture, and clear the whole thing back to
// automatic.
//
// THE CARD OWNS ITS TEXT (owner, 2026-09-07). A composed card's title and tease
// belong to the card itself.
// Typing on a card NEVER edits the post it came from — that is the whole reason
// the text lives on the card record instead of being written through to the
// source, and it is what makes composing safe to experiment with.
//
// ONE GESTURE, ONE STAGED CHANGE, +1 ALWAYS. _stageCard folds repeat edits to
// the same card into one ledger row, so typing does not inflate the count.

const COMPOSED_MAX = 2;

// A composed card's title is a caption, not an essay: capped so it stays the two
// lines the grid gives it (paired with the .wk-composed .wk-title line-clamp) and
// never grows the footer into the picture. Bounds TYPING; a longer seeded title
// (from an archive entry) still displays clamped and its data is left intact.
const COMPOSED_TITLE_MAX = 48;

// Which composed card the studio is editing, or null. Module state for the same
// reason _mode is: the window bridge snapshots exports at boot, so an exported
// binding read through window would be stale forever.
let _composing = null;
let _editSnapshot = null;
// The slots as last painted, so a click on the ribbon can ask what it landed on
// without recomposing the whole grid to find out.
let _lastSlots = null;

function _focusComposed(id) { _composing = id; }
export function _composingId() { return _composing; }
export function _activeMode() { return _mode; }

// Exit edit mode, returning the studio to clean read-only preview.
export function cardsDoneEditing() {
  if (!_composing) return;
  const card = _cardById(_composing);
  const dropped = _discardIfGhost(_composing);
  _composing = null;
  _editSnapshot = null;
  if (dropped) {
    toast('Empty card discarded — the slot fills itself again', 'info');
  } else if (card) {
    toast('✓ Card preview — click Edit to modify words or layout', 'info');
  }
  _repaint();
}

// Remove a card's staged ledger row and give back the one gesture it counted.
// Shared by the two places a composed edit is undone whole: discarding the card
// (below) and cancelling an edit whose typing CREATED the row (cardsCancelEdit).
// Discard a composed card from state, recompacting order and cancelling every
// gesture its row counted. The counter/ledger reversal lives in the ledger layer
// (restoreStagedRow) — a surface stages +1 and never hands a change back itself
// (tests/guards.test.js). A null snapshot means "remove the row and give back
// all of it," which is exactly a whole-card discard.
function _discardComposedCard(cardId) {
  const idx = _cards().findIndex((c) => c.id === cardId);
  if (idx > -1) _cards().splice(idx, 1);
  _recompact();
  restoreStagedRow('cards', cardId, null);   // removes the row, gives back its gestures, saves
}

// ⚠️ A GHOST CARD — the lockout this closes.
//
// A composed card with neither a usable picture nor a word is invisible
// EVERYWHERE: composedPick declines to render it, so it reaches no slot, no
// ribbon pill and no grid cell — and every control that could delete it (↩ RESET
// TO AUTOMATIC, ✕ CANCEL) lives on a slot. Left in STATE it is a ghost that
// still counts against COMPOSED_MAX, so two of them disable ＋ COMPOSE A CARD
// for good with four automatic slots on screen and no card to reset.
//
// The emptiness rule is the ENGINE's own — composedMedia() is the very filter
// composedPick runs — asked here rather than restated, so the console and the
// homepage can never disagree about what "nothing to show" means.
function _isGhostCard(card) {
  if (!card) return false;
  const RI = engine();
  const media = RI ? RI.composedMedia(card) : (card.media || '');
  return !media && !String(card.title || '').trim() && !String(card.tease || '').trim();
}

// Abandon an unfinished card rather than filing it. Called from every path that
// STOPS composing one — Done, Esc, clicking the well, selecting another slot,
// starting a second card, taking a slot over — which is exactly what ✕ CANCEL
// already did for a brand-new card. Returns whether it dropped anything, so the
// caller can say so instead of claiming a preview that is not there.
function _discardIfGhost(cardId) {
  const card = _cardById(cardId);
  if (!card || !_isGhostCard(card)) return false;
  _discardComposedCard(card.id);
  if (_composing === card.id) { _composing = null; _editSnapshot = null; }
  return true;
}

// Ghosts that arrived from STORAGE rather than from a gesture. `_composing` does
// not survive a reload, so a card left empty when the tab closed comes back with
// nothing able to select it. Swept on the way INTO the view and never from
// _repaint(): the card being composed right now is legitimately empty and must
// be left exactly where it is.
function _sweepGhostCards() {
  for (const c of _cards().slice()) {
    if (c && c.id !== _composing && _isGhostCard(c)) _discardComposedCard(c.id);
  }
}

// Every field an edit session can touch, as snapshot key → card field.
//
// ONE list, because keeping two by hand is exactly how this drifted twice. The
// snapshot captured a field, the Cancel check compared a shorter list written
// out longhand beside it, and the gap was silent both times: first the link and
// its provenance (2026-09-07 — restored in the revert branch below), then
// `cardFocus` (2026-09-08 — a crop on a taken-over slot was discarded with no
// confirm, because a check that never looked at it concluded nothing had
// changed). Capture and comparison now read this table, so a new field is
// covered by both the moment it lands here, or by neither.
//
// `initialLayout` → `card` is why this is a table and not a naming convention:
// the rail's layout picker writes `card.card = { layout }`, so the key and the
// field genuinely differ.
const EDIT_FIELDS = Object.freeze([
  ['initialTitle', 'title'],
  ['initialTease', 'tease'],
  ['initialLabel', 'label'],
  ['initialMedia', 'media'],
  // The source folder travels with the filename: a wallpaper's derivatives live
  // outside archive/, so a media revert that forgot the folder rebuilds a 404.
  ['initialFolder', 'folder'],
  ['initialCardFocus', 'cardFocus'],
  ['initialPalette', 'palette'],
  // The link and the provenance behind it. ✕ MAKE FREE-FORM deletes both, and
  // a Cancel that could not put them back turned "changed my mind" into a
  // permanent loss: the card kept its words and its picture but the way home
  // to the archive photo / field note / track was gone, with no gesture left
  // that could rebuild it. They travel together — a link with no source cannot
  // name where it points, and a source with no link is a card that remembers
  // the archive photo but no longer opens it.
  ['initialLink', 'link'],
  ['initialSource', 'source'],
  ['initialLayout', 'card'],
]);

// The `initial*` half of a snapshot, read off the card as it stands now.
// Objects are copied, not referenced — a snapshot that aliased `card.card` would
// mutate along with the edit it exists to undo.
function _captureEditFields(card) {
  const snap = {};
  for (const [key, field] of EDIT_FIELDS) {
    const v = card[field];
    snap[key] = (v && typeof v === 'object') ? { ...v } : (v || '');
  }
  return snap;
}

// Has anything this session could touch actually changed? Only fields the
// snapshot really captured are compared, so a thinner snapshot stays honest
// rather than reporting phantom edits against keys it never held.
function _editIsUntouched(card, snap) {
  return EDIT_FIELDS.every(([key, field]) => {
    if (!(key in snap)) return true;
    const was = snap[key];
    const now = card[field];
    if ((was && typeof was === 'object') || (now && typeof now === 'object')) {
      return JSON.stringify(was || null) === JSON.stringify(now || null);
    }
    return (now || '') === (was || '');
  });
}

// The snapshot Cancel reverts to, for an EXISTING composed card becoming the one
// edited — whether reached through ✎ EDIT THIS CARD (cardsEditSlot) or by
// selecting the card's slot (cardsSelectSlot). Without it, Cancel has nothing to
// restore and silently KEEPS the edits — the bug that hid because selecting a
// slot is a live edit path the tests only ever reached via cardsEditSlot.
//
// It captures every field an edit session can touch — words, label, the picture
// AND its source folder (a wallpaper's derivatives live outside archive/, so a
// media revert that forgot the folder rebuilds a 404 URL), palette, crop, and
// the layout descriptor the rail's picker writes — plus `preEditRow`: the ledger
// row exactly as it stood before, so Cancel gives the counter back the precise
// gestures this session added and no more. A richer snapshot already set for the
// same card — a brand-new or just-taken-over card, which Cancel must DISCARD
// rather than revert — is left untouched.
function _snapshotExisting(card) {
  if (!card || (_editSnapshot && _editSnapshot.id === card.id)) return;
  _editSnapshot = {
    id: card.id,
    isNewFromAuto: false,
    preEditRow: ledgerRowFor('cards', card.id),
    ..._captureEditFields(card),
  };
}

// Cancel editing. If an automatic card was taken over or a new card created,
// and cancelled without changes, cleanly discard the staged override.
export function cardsCancelEdit() {
  if (_composing) {
    const card = _cardById(_composing);
    if (card && _editSnapshot && _editSnapshot.id === card.id) {
      if (_editSnapshot.isBrandNew) {
        _discardComposedCard(card.id);
        toast('New card cancelled', 'info');
      } else if (_editSnapshot.isNewFromAuto) {
        const untouched = _editIsUntouched(card, _editSnapshot);
        if (untouched) {
          _discardComposedCard(card.id);
          toast('Edit cancelled — slot returned to automatic', 'info');
        } else {
          if (confirm('Discard changes and return slot to automatic?')) {
            _discardComposedCard(card.id);
            toast('Edit cancelled — slot returned to automatic', 'info');
          } else {
            return;
          }
        }
      } else {
        card.title = _editSnapshot.initialTitle;
        card.tease = _editSnapshot.initialTease;
        card.label = _editSnapshot.initialLabel;
        if (_editSnapshot.initialMedia) {
          card.media = _editSnapshot.initialMedia;
          // Restore the SOURCE FOLDER with the filename — a wallpaper's
          // derivatives live outside archive/, so reverting the picture without
          // it rebuilds a 404 URL on the live card.
          if (_editSnapshot.initialFolder) card.folder = _editSnapshot.initialFolder;
          else delete card.folder;
        } else {
          delete card.media;
          delete card.folder;
        }
        if (_editSnapshot.initialCardFocus) {
          card.cardFocus = _editSnapshot.initialCardFocus;
        } else {
          delete card.cardFocus;
        }
        if (_editSnapshot.initialPalette) {
          card.palette = _editSnapshot.initialPalette;
        } else {
          delete card.palette;
        }
        // The rail's layout picker (cardsSetLayout) writes card.card = { layout }
        // and stages it while editing, so a revert has to put it back too — else
        // a Hero pick survives Cancel and rides silently into the next publish.
        if (_editSnapshot.initialLayout) card.card = { ..._editSnapshot.initialLayout };
        else delete card.card;
        // The pair ✕ MAKE FREE-FORM cuts. They travel together — a link with no
        // source cannot name where it points, and a source with no link is a
        // card that remembers the archive photo but no longer opens it.
        if (_editSnapshot.initialLink) card.link = _editSnapshot.initialLink;
        else delete card.link;
        if (_editSnapshot.initialSource) card.source = { ..._editSnapshot.initialSource };
        else delete card.source;
        // Put the ledger row and the pending count back exactly as they stood
        // before this edit — the row and its whole count go when the edit created
        // it, or fold back to the earlier gesture count when it did not — and
        // refresh the on-screen badge. The reversal lives in the ledger layer.
        restoreStagedRow('cards', card.id, _editSnapshot.preEditRow);
        toast('Edit cancelled — changes reverted', 'info');
      }
    }
  }
  _composing = null;
  _editSnapshot = null;
  _repaint();
}

// Click outside the card in the stage well exits edit mode.
export function cardsHandleStageClick(event) {
  if (event && event.target === event.currentTarget && _composing) {
    cardsDoneEditing();
  }
}

if (typeof window !== 'undefined' && !window._cardsEscBound) {
  window._cardsEscBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _composing) {
      const activeView = document.querySelector('.view.active');
      if (!activeView || activeView.id !== 'view-cards') return;
      // A MODAL ON TOP OWNS THE KEY. The crop and the picture library both open
      // FROM the composer, so one Escape meant to back out of the crop used to
      // close the composer underneath it as well — two things for one press,
      // and the one the author wanted was the one that did not happen. (Those
      // modals stop the key themselves; this is the guard that does not depend
      // on their doing so.)
      if (document.querySelector('.modal-overlay:not(.hidden)')) return;
      e.preventDefault();
      cardsDoneEditing();
    }
  });
}

function _cards() { return STATE.cards || (STATE.cards = []); }

export function _composedCards() {
  return _cards().slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function _cardById(id) { return _cards().find((c) => c && c.id === id) || null; }

// One row per card, folded. The label names the card the way the owner would.
// If the card is already in the ledger for this session, update its label and save
// without inflating the stage counter per keystroke or duplicate action.
function _stageCard(card, kind) {
  const existingRow = (STATE.stagedLog || []).find((r) => r.surface === 'cards' && r.ids[0] === card.id);
  if (existingRow) {
    existingRow.label = `${(card.title || '').trim() || 'Untitled card'} — homepage card`;
    existingRow.ts = Date.now();
    save();
    return;
  }
  stageChange('cards', {
    id: card.id,
    label: `${(card.title || '').trim() || 'Untitled card'} — homepage card`,
    kind: kind || 'edit',
  });
  save();
}

// Ranks are 1..n and CONTIGUOUS after every mutation. Nothing reads a gap as
// meaningful, and compacting here means a delete can never leave a hole that
// later reads as "slot 2 is empty" — the positional-slot trap, closed at the
// source rather than defended against downstream.
function _recompact() {
  _composedCards().forEach((c, i) => { c.order = i + 1; });
}

// Start a card. Empty is a legitimate state: the composer opens on it and the
// engine simply declines to render a card with neither picture nor words, so a
// half-finished one is invisible on the site rather than an empty tile.
export function cardsCompose() {
  // Pressing ＋ COMPOSE again abandons the unfinished card rather than filing it,
  // and it runs BEFORE the budget check so the freed place is usable at once.
  if (_composing) _discardIfGhost(_composing);
  if (_cards().length >= COMPOSED_MAX) {
    toast(`The homepage holds ${COMPOSED_MAX} composed cards — clear one first`, 'warn');
    return null;
  }
  const card = {
    id: `c-${uid()}`,
    order: _cards().length + 1,
    title: '',
    tease: '',
    added_at: todayISO(),
  };
  _cards().push(card);
  _recompact();
  _stageCard(card, 'add');
  toast('✓ New card — give it a picture or a line', 'success');
  _mode = 'studio';
  _focusComposed(card.id);
  // Built the same way as the other two, though Cancel on a brand-new card
  // discards unconditionally and compares nothing today. Five hand-written empty
  // strings implied a comparison that never happened; one helper keeps all three
  // snapshots the same shape, so the day this branch does need to ask "did they
  // write anything?", the answer is already captured.
  _editSnapshot = {
    id: card.id,
    isBrandNew: true,
    ..._captureEditFields(card),
  };
  _repaint();
  return card;
}

// ⚠️ TYPING MUST NOT REPAINT THE CARD. The field being typed into lives INSIDE
// the card, so rebuilding it would destroy the caret, the selection, the IME
// composition and the soft keyboard mid-sentence. This writes state and moves
// the readouts only — never the field's own value, and never the whole view.
// The same discipline js/console/pulse.js is built on, and pinned the same way.
export function cardsSetText(id, field, value) {
  if (field !== 'title' && field !== 'tease' && field !== 'label') return;
  const card = _cardById(id);
  if (!card) return;
  card[field] = value;
  _stageCard(card, 'edit');
  _paintComposed(card);
}

export const PALETTE_PRESETS = [
  { key: 'default', label: 'Default', note: 'site theme' },
  { key: 'signal', label: 'Signal', note: 'your accent' },
  { key: 'ember', label: 'Ember', note: 'safelight red' },
  { key: 'dawn', label: 'Dawn', note: 'first light' },
  { key: 'flow', label: 'Flow', note: 'deep green' },
  { key: 'velvet', label: 'Velvet', note: 'late violet' },
  { key: 'tide', label: 'Tide', note: 'cold blue' },
];

export function cardsSetPalette(id, paletteKey) {
  const card = _cardById(id);
  if (!card) return;
  const val = (paletteKey === 'default' || !paletteKey) ? '' : paletteKey;
  if (card.palette === val) return;
  if (val) card.palette = val;
  else delete card.palette;
  _stageCard(card, 'edit');

  if (typeof document !== 'undefined') {
    const cardEl = document.getElementById('composer-card');
    if (cardEl) {
      if (val) cardEl.setAttribute('data-state', val);
      else cardEl.removeAttribute('data-state');
    }
    const aside = document.getElementById('cards-palette-name');
    if (aside) aside.textContent = val ? val.charAt(0).toUpperCase() + val.slice(1) : 'Default';
    const row = document.getElementById('cards-palette-row');
    if (row) {
      const btns = row.querySelectorAll('.cards-swatch');
      btns.forEach((b) => {
        const isAct = (b.getAttribute('data-palette') === (val || 'default'));
        b.classList.toggle('is-active', isAct);
        b.setAttribute('aria-pressed', isAct ? 'true' : 'false');
      });
    }
  }
}

// Pick the picture from anywhere on the site. The library picker already lists
// archive frames, buffer frames, wallpapers, field-note heroes and unassigned
// uploads — every source the owner asked for, in one modal that already exists.
export function cardsPickImage(id) {
  const card = _cardById(id);
  if (!card) return;
  openAssetLibrary((filename) => {
    if (!filename) return;
    card.media = filename;
    card.folder = _folderFor(filename);
    _stageCard(card, 'edit');
    toast('✓ Picture set — crop it for the tall card if you like', 'success');
    _repaint();
  }, 'archive');
}

// Which folder a chosen filename actually lives in. The picker hands back a
// bare filename with no folder, and a wallpaper's derivatives sit outside
// archive/ — so resolve it against the wallpaper registry rather than guessing.
function _folderFor(filename) {
  const isWall = (STATE.wallpapers || []).some((w) => w && w.filename === filename);
  return isWall ? 'wallpaper' : 'archive';
}

export function cardsClearImage(id) {
  const card = _cardById(id);
  if (!card || !card.media) return;
  delete card.media;
  delete card.folder;
  delete card.cardFocus;
  // A layout that leads with a picture cannot survive losing the picture. The
  // gate would fall back anyway; clearing it keeps the console from showing an
  // opt-in with nothing to act on (the FN composer's rule, same reasoning).
  if (card.card && card.card.layout === 'hero') delete card.card;
  _stageCard(card, 'edit');
  toast('✓ Picture removed — the card reads as words now', 'info');
  _repaint();
}

// Friendly names for where a spawned card points, keyed by the source surface it
// remembers. A card composed from nothing has no source and no link — the block
// that uses this only renders when there is a link to describe.
const LINK_LABEL = {
  buffer: 'the buffer frame', archive: 'the archive photo',
  posts: 'the field note', audio: 'the track',
};
function _linkTarget(card) {
  if (!card || !card.link) return null;
  const surf = card.source && card.source.surface;
  return { href: card.link, label: (surf && LINK_LABEL[surf]) || 'a page on your site' };
}

// Cut a spawned card loose from its source: it keeps its words and picture but
// points nowhere, the way a from-scratch card does. Reversible — re-taking the
// slot over reseeds the link.
export function cardsClearLink(id) {
  const card = _cardById(id);
  if (!card || !card.link) return;
  delete card.link;
  delete card.source;
  _stageCard(card, 'edit');
  toast('✓ Link removed — this card points nowhere now', 'info');
  _repaint();
}

// The tall 4:5 crop, framed against the card it is actually for. Points the
// existing modal at an arbitrary image — the path openFnFocal already proves.
export function cardsCropCard(id) {
  const card = _cardById(id);
  const RI = engine();
  if (!card || !RI) return;
  const media = RI.composedMedia(card);
  if (!media) return toast('Give the card a picture first', 'warn');
  openFocalModal({
    src: cdnVariant({ filename: media }, 2048, RI.composedFolder(card)),
    focus: card.cardFocus || '',
    aspect: '4 / 5',
    onSave: (f) => {
      // Centre is the default and is never serialized — the idiom every other
      // focal caller uses, so an untouched card stays byte-identical.
      if (f === '50% 50%') delete card.cardFocus; else card.cardFocus = f;
      _stageCard(card, 'edit');
      toast('✓ Card crop set', 'success');
      _repaint();
    },
  });
}

// Move a card up or down the rank. Order is a rank, so this is a swap, and the
// row recompacts underneath it.
export function cardsReorder(id, dir) {
  const list = _composedCards();
  const at = list.findIndex((c) => c.id === id);
  const to = at + (dir === 'up' ? -1 : 1);
  if (at < 0 || to < 0 || to >= list.length) return;
  const a = list[at].order;
  list[at].order = list[to].order;
  list[to].order = a;
  _recompact();
  _stageCard(list[at], 'edit');
  _repaint();
}

// ---- EDIT THIS CARD — promote any slot into one you own ----
//
// A RAW frame has no title to type on; an archive photo's caption belongs to the
// archive. So "edit this card" cannot mean writing through to whatever the grid
// picked — it means taking that card over: a composed card seeded with the same
// picture and the same crop, whose words are yours.
//
// SEEDED COPIES, BUT IT KEEPS THE LINK (owner, 2026-09-07). The words and the
// picture become the card's OWN copies — editing them never reaches back into
// the archive/post/track, the same promise typing already makes. But the card
// also inherits the slot's LINK (RI.entryHref) and remembers its `source`: a
// card spawned from an archive photo still opens the archive photo, a field note
// card still opens the note. Losing that made an edited archive card publish as a
// dead-end picture — the reported bug. A link is navigation, not write-back, so
// it does not compromise the isolation; the card still owns everything it shows.
//
// The entry it came from is untouched. The slot it occupied is now yours too, so
// ↩ RESET TO AUTOMATIC hands both back at once.
export function cardsEditSlot(index) {
  _mode = 'studio';
  // Taking another slot over leaves whatever was being composed — same rule as
  // Done and as selecting a pill, and same reason it runs before the budget
  // check below.
  if (_composing) _discardIfGhost(_composing);
  const slot = (_lastSlots || [])[Number(index)];
  if (!slot) {
    _repaint();
    return;
  }
  if (slot.composed) {
    _slotIndex = Number(index);
    _focusComposed(slot.id);
    _snapshotExisting(_cardById(slot.id));
    _repaint();
    return;
  }
  if (slot.live) {
    // The pulse is live D1 and costs no deploy; it has its own composer, so
    // "edit" here just takes the owner straight there rather than taking it over
    // on the publish path (which would be a worse version of what already exists).
    showView('pulse');
    return;
  }
  if (_cards().length >= COMPOSED_MAX) {
    toast(`The homepage holds ${COMPOSED_MAX} composed cards — reset one first`, 'warn');
    return;
  }

  const RI = engine();
  const entry = _entryOf(slot);
  const home = SLOT_SURFACE[slot.kind];
  const media = slot.thumb && entry
    ? (RI && slot.kind === 'text' ? RI.heroFilename(entry) : entry.filename) || ''
    : '';
  // The link this slot carried, built by the SAME helper the grid renders with,
  // so the card can never point somewhere the automatic card would not.
  //
  // A PLAYLIST has no single entry and so no id, which made entryHref build
  // `/listen/?a=` with nothing after it — a dangling query published onto the
  // homepage. The playlist card's own title already points at /listen/; a
  // takeover of it points at the same place.
  const link = !RI ? ''
    : entry ? RI.entryHref(slot.kind, entry)
      : (slot.kind === 'audio' ? '/listen/' : '');
  const card = {
    id: `c-${uid()}`,
    order: _cards().length + 1,
    // Seeded copies (editing them never touches the source) — but the link and
    // provenance ride along, so the card still opens where the original did.
    ...(media ? { media, folder: _folderFor(media) } : {}),
    ...(entry && (entry.cardFocus || entry.focus)
      ? { cardFocus: entry.cardFocus || entry.focus } : {}),
    ...(link ? { link } : {}),
    ...(entry && entry.id && home ? { source: { surface: home.surface, id: entry.id } } : {}),
    title: slot.kind === 'raw' ? '' : (slot.title || ''),
    tease: '',
    label: (slot.kicker || '').split(' · ')[0] || 'Featured',
    added_at: todayISO(),
  };
  _cards().push(card);
  _recompact();
  _stageCard(card, 'add');
  _slotIndex = Number(index);
  _focusComposed(card.id);
  // The full capture, not a hand-picked subset: a takeover writes `link` and
  // `source` onto the card before this runs, so a snapshot that omitted them let
  // ✕ MAKE FREE-FORM count as "nothing changed" and discard without asking.
  _editSnapshot = {
    id: card.id,
    isNewFromAuto: true,
    ..._captureEditFields(card),
  };
  toast('✓ This card is yours now — write on it', 'success');
  _repaint();
}

// ---- surgical repaint, for the typing path only ----
//
// Moves the attributes and readouts that depend on the text, and NOTHING else.
// It must never write a field's value back, and must never rebuild the card:
// both destroy the caret and the soft keyboard mid-sentence. Everything that is
// not typing goes through _repaint() instead.
//
// tests/cards-composer.test.js greps this function to keep it honest, the
// way tests/pulse-console.test.js does for paintCard().
// Picture-led or words-led, decided the way the LIVE renderer decides it
// (recent-index.js composedCard): a picture, and a layout that has not been set
// to `plain`. One rule, asked from both the full paint and the surgical one.
function _composedIsPicture(card) {
  const RI = engine();
  if (!RI) return Boolean(card && card.media);
  return Boolean(RI.composedMedia(card)) && RI.layoutFor('composed', card) !== 'plain';
}

function _growFields() {
  if (typeof document === 'undefined') return;
  for (const id of ['composer-title', 'composer-tease']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.height = 'auto';
    // Guarded: an environment that computes no layout (a headless render, a
    // hidden view) reports 0, and writing that back would collapse the field to
    // nothing. Leaving it `auto` there is correct — the browser sizes it.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }
}

function _paintComposed(card) {
  const RI = engine();
  if (!card || typeof document === 'undefined') return;
  const root = document.getElementById('composer-card');
  if (root) {
    const tier = RI ? RI.recentTier(RI.tierLen(card.tease || '')) : 'standard';
    root.setAttribute('data-tier', tier);
    root.setAttribute('data-shape', _composedIsPicture(card) ? 'picture' : 'words');
  }
  // Grow each field to exactly its content. A fixed `rows` means a one-line
  // headline reserves two lines and opens a dead gap above the tease — which is
  // precisely what makes a card look pasted together rather than set. Height is
  // a style, not a value: this never touches the caret, the selection or the IME.
  _growFields();

  // Both echoes at once — the chip on the picture and the kicker in the words
  // shape are the same label wearing two hats.
  const label = RI ? RI.composedLabel(card) : 'Featured';
  document.querySelectorAll('[data-label-echo]').forEach((el) => {
    if (el.textContent !== label) el.textContent = label;
  });
}

// ↩ RESET TO AUTOMATIC — the whole point of "override per slot". Deleting the
// card hands the slot straight back to the automatic rule, and the delete goes
// to the session trash, so the publish horizon is the way back (layer 3).
export function cardsResetToAuto(id) {
  const card = _cardById(id);
  if (!card) return;
  const named = (card.title || '').trim();
  if (!confirm(`Remove ${named ? `“${named}”` : 'this card'} from the homepage?\n\n`
    + 'The slot goes back to filling itself. Nothing is live until you publish, '
    + 'and ↩ RESTORE in the publish view brings it back until then.')) return;
  trashItem('cards', card.id);
  _recompact();
  save();
  toast('✓ Slot back to automatic', 'info');
  _focusComposed(null);
  _repaint();
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
    acts.push(`<button class="btn btn-full btn-stage" onclick="cardsCropRaw(${q(slot.id)})"
      title="Set the tall 4:5 crop this card uses">▯ SET THE 4:5 CROP</button>`);
    acts.push(`<button class="btn btn-full btn-danger" onclick="cardsToggleRaw(${q(slot.id)})"
      title="Unstar this frame — it leaves the homepage on the next publish">★ UNSTAR FRAME</button>`);
  }
  if (slot.kind === 'audio') {
    if (slot.playlist) {
      acts.push(`<button class="btn btn-full btn-danger" onclick="cardsClearAudioCard()"
        title="Take every track off the homepage card">✕ CLEAR THE CARD</button>`);
    } else if (slot.id) {
      acts.push(`<button class="btn btn-full btn-danger" onclick="cardsDemoteAudio(${q(slot.id)})"
        title="Take this track off the homepage card">✕ TAKE OFF CARD</button>`);
    }
  }
  if (slot.view) {
    acts.push(`<button class="btn btn-full btn-ghost" onclick="cardsOpen(${q(slot.view)})"
      title="Open the surface this card comes from">OPEN ${escapeHTML(slot.view.toUpperCase())} ↗</button>`);
  }
  return acts.length ? `<div class="action-dock">${acts.join('')}</div>` : '';
}

// ---- the shell ----

// A segmented control. Every option stays pressable — including the one already
// on — because pressing the active option is how a picker becomes its own undo,
// and a disabled control cannot do that.
//
// ⚠️ The buttons are written out with LITERAL handler names rather than built
// from an {onclick} field. A handler that is nothing but an interpolation
// (onclick="${call}") is opaque to tests/inline-handlers.test.js, which is the
// guard that catches a control wired to a function nobody exported. Four lines
// of repetition keep these inside it; a generic helper would buy tidiness by
// stepping outside the one check that proves the buttons work.
function segHtml(label, buttons, extraClass) {
  return `<div class="cards-seg${extraClass ? ` ${extraClass}` : ''}" role="group" aria-label="${escapeHTML(label)}">${buttons}</div>`;
}

function headHtml(pending, actionable) {
  const on = (cond) => (cond ? ' is-on' : '');
  // The mode toggle wears the current source's colour (green in LIVE, red in
  // STAGED), so the whole header says which grid you are working on at a glance.
  const modes = segHtml('View mode',
    `<button class="cards-seg-btn${on(_mode === 'studio')}"
        aria-pressed="${_mode === 'studio' ? 'true' : 'false'}"
        onclick="cardsSetMode('studio')">EDIT CARD</button>
     <button class="cards-seg-btn${on(_mode === 'panorama')}"
        aria-pressed="${_mode === 'panorama' ? 'true' : 'false'}"
        onclick="cardsSetMode('panorama')">THE GRID</button>`,
    _source === 'live' ? 'cards-seg--live-ctx' : '');
  // LIVE reads GREEN when active — the same green as the slot's LIVE badge, so
  // "this is the published site" says the same thing wherever it appears.
  const sources = segHtml('Which grid',
    `<button class="cards-seg-btn${on(_source === 'staged')}"
        aria-pressed="${_source === 'staged' ? 'true' : 'false'}"
        onclick="cardsSetSource('staged')">STAGED</button>
     <button class="cards-seg-btn cards-seg-btn--live${on(_source === 'live')}"
        aria-pressed="${_source === 'live' ? 'true' : 'false'}"
        onclick="cardsSetSource('live')">LIVE</button>`);
  // The pending count is the diff signal surviving the source toggle. Looking at
  // LIVE you would otherwise have no way to know anything was waiting, which is
  // exactly the blind spot the two-column layout never had.
  const pill = pending
    ? `<span class="cards-pending" title="Slots that change on the next publish">
         ${pending} SLOT${pending === 1 ? '' : 'S'} CHANGE</span>`
    : '<span class="cards-pending is-quiet">NO SLOT CHANGES</span>';
  // The one thing this surface exists for gets the one filled button. Hidden
  // while looking at LIVE (there is nothing to compose about what is already
  // published) and disabled at the budget, with the reason in the tooltip
  // rather than a control that silently does nothing.
  const room = _composedCards().length < COMPOSED_MAX;
  const compose = actionable
    ? `<button class="btn btn-primary cards-compose" onclick="cardsCompose()"
         ${room ? '' : 'disabled'}
         title="${room
           ? 'Build a card from anything on your site — or from nothing at all'
           : `The homepage holds ${COMPOSED_MAX} composed cards. Reset one to automatic first.`}">
         ＋ COMPOSE A CARD</button>`
    : '';

  return `<header class="cards-head">
    <div class="cards-head-left">${modes}${sources}</div>
    <div class="cards-head-right">${pill}${compose}</div>
  </header>`;
}

// The slot ribbon. Horizontally scrollable as ONE strip with every child
// unshrinkable — not a scroller nested between rigid siblings, which is how a
// tape strip ends up 44px wide on a phone with its scrollbar hidden.
// One badge per pill, and slot 4's is not negotiable.
//
// Showing only on a tablet held upright is a PERMANENT fact about that slot, and
// it outranks whatever is happening to it this minute. An earlier ordering let a
// change marker hide it — which is how a card ends up composed into the slot
// almost nobody sees, the K18 incident in miniature. The change marker still
// rides the card itself, so the pill can be given to the fact.
// ONE badge, one vocabulary, wherever a slot has to say what it is. Three
// near-identical classes lived here before (a pill badge, a grid flag and a diff
// marker) and drifted apart in colour and size, which is the opposite of
// glanceable: the same fact read differently depending where you saw it.
//
// The tones carry meaning and nothing else does: green is LIVE (already on the
// site, no publish involved), the accent is CHANGING (this slot moves on the
// next publish), amber is GOING, and grey is a permanent structural fact.
function toneBadge(text, tone) {
  return `<span class="tone-badge" data-tone="${tone}">${escapeHTML(text)}</span>`;
}

function pillBadge(slot, mark, i) {
  if (_composing && slot && slot.id === _composing) return toneBadge('EDITING', 'editing');
  if (i === 3) return toneBadge('TABLET ONLY', 'quiet');
  if (slot && slot.live) return toneBadge('LIVE', 'live');
  if (mark) return toneBadge(mark, mark === 'GONE' ? 'going' : 'staged');
  return '';
}

function ribbonHtml(slots, marks, showMarks) {
  const pills = slots.map((slot, i) => {
    const mark = showMarks && marks[i] && marks[i] !== 'UNCHANGED' ? marks[i] : '';
    return `<button class="cards-pill${i === _slotIndex ? ' is-active' : ''}"
      onclick="cardsSelectSlot(${i})" aria-pressed="${i === _slotIndex ? 'true' : 'false'}">
      <span class="cards-pill-n">${String(i + 1).padStart(2, '0')}</span>
      <span class="cards-pill-name">${escapeHTML(slot ? slot.kicker : '— EMPTY —')}</span>
      ${pillBadge(slot, mark, i)}
    </button>`;
  }).join('');
  return `<nav class="cards-ribbon" aria-label="Homepage slots">
    <span class="cards-ribbon-label">SLOTS</span>${pills}</nav>`;
}

// The focused card. Still a SCHEMATIC — bigger, but not a clone of the
// homepage's markup. The console does not load css/main.css, and a second copy
// of the card styles here would be a preview that drifts. Faithful about which
// card is in which slot and why; pixel truth is one tap away on the site.
// A rail block: a display-face title with an optional right-hand status word,
// then its body, then an optional plain-language note. The `aside` is what you
// read BEFORE the controls — the mockup's `Signal` beside PALETTE GROUND.
function controlBlock(title, body, opts) {
  const { note, aside, asideId } = opts || {};
  return `<section class="control-block">
    <header class="control-block-head">${escapeHTML(title)}
      ${aside ? `<span class="control-block-aside"${asideId ? ` id="${escapeHTML(asideId)}"` : ''}>${escapeHTML(aside)}</span>` : ''}</header>
    ${body}
    ${note ? `<p class="control-block-note">${escapeHTML(note)}</p>` : ''}
  </section>`;
}

// The inset readout — label/value rows on their own recessed ground, so a panel
// of facts reads as an instrument rather than as body copy.
function readoutHtml(rows) {
  return `<dl class="readout">${rows.filter(Boolean).map(([k, v, tone]) => `
    <div class="readout-row"><dt>${escapeHTML(k)}</dt>
    <dd${tone ? ` class="is-${tone}"` : ''}>${escapeHTML(v)}</dd></div>`).join('')}</dl>`;
}

// Plain-language names for the registered layouts, PER KIND — because the same
// name means different things to different cards. A field note's `default` is
// the typographic tile; a composed card's `default` is smart, leading with the
// picture when there is one and with the words when there is not. Calling both
// "Standard tile" would be a straightforward lie about what publish produces.
//
// A layout added later shows up under its own engine name rather than
// disappearing — the picker reads the registry, so it widens by itself and this
// map only makes it friendlier.
const LAYOUT_LABEL = {
  text: { default: 'Standard tile', hero: 'Hero forward' },
  composed: {
    default: 'Automatic',
    hero: 'Always the picture',
    plain: 'Always the words',
  },
};
function layoutLabel(kind, name) {
  return (LAYOUT_LABEL[kind] && LAYOUT_LABEL[kind][name]) || name;
}

// ---- the layout picker ----
//
// Populated from the engine's own registry (RecentIndex.cardLayouts), so it can
// never offer a layout buildCard() would not honour. Hidden entirely for a kind
// with one registered layout: a picker that cannot pick is furniture.
function layoutPickerHtml(slot) {
  const RI = engine();
  if (!RI || !slot || !slot.id) return '';
  const kind = ENGINE_KIND[slot.kind];
  const names = (RI.cardLayouts && RI.cardLayouts[kind]) || ['default'];
  if (names.length < 2) return '';
  const entry = _entryOf(slot);
  if (!entry) return '';

  const current = RI.layoutFor(kind, entry);
  const chips = names.map((name) => {
    const on = name === current;
    // A layout this entry cannot actually wear is shown BLOCKED rather than
    // hidden: the option exists, and knowing why it is unavailable is more
    // useful than wondering where it went. layoutFor() is the same gate the
    // homepage applies, asked here with a probe.
    const usable = name === 'default'
      || RI.layoutFor(kind, { ...entry, card: { ...(entry.card || {}), layout: name } }) === name;
    const tip = usable
      ? `Show this card as: ${layoutLabel(kind, name)}`
      : 'Needs a picture on the entry before this layout can be used';
    return `<button class="layout-chip${on ? ' is-on' : ''}${usable ? '' : ' is-blocked'}"
      onclick="cardsSetLayout('${escapeAttrJS(slot.kind)}','${escapeAttrJS(slot.id)}','${escapeAttrJS(name)}')"
      aria-pressed="${on ? 'true' : 'false'}" title="${escapeHTML(tip)}">
      <span class="layout-chip-label">${escapeHTML(layoutLabel(kind, name))}</span>
      <span class="layout-chip-name">${escapeHTML(name)}</span>
    </button>`;
  }).join('');

  return controlBlock('CARD LAYOUT', `<div class="layout-chips">${chips}</div>`, {
    aside: layoutLabel(kind, current),
    note: 'What the card IS stays fixed — this changes only how it is dressed. '
      + 'Pressing the standard option puts it back.',
  });
}

// ---- a faithful card, read-only ----
//
// Reuses the shipped buildCard renderer directly when available, ensuring
// pixel-for-pixel fidelity with the live homepage grid.
function realCardHtml(slot) {
  if (!slot) {
    return `<div class="card-face">
      <article class="wk-card is-empty"><span>— nothing lands here —</span></article></div>`;
  }
  const RI = engine();
  let innerHtml = '';
  if (RI && typeof RI.buildCard === 'function' && slot.item) {
    try {
      const node = RI.buildCard(slot.item);
      if (node.tagName === 'A') {
        node.removeAttribute('href');
        node.setAttribute('role', 'article');
      }
      innerHtml = node.outerHTML;
    } catch (_) {
      innerHtml = '';
    }
  }
  if (!innerHtml) {
    if (slot.kind === 'pulse') {
      const glyph = slot.glyphs ? `<div class="wk-p-glyph" aria-hidden="true">${escapeHTML(slot.glyphs)}</div>` : '';
      const text = slot.text || slot.title || '';
      const time = slot.localTime ? `<span class="wk-p-time">${escapeHTML(slot.localTime)}</span>` : '';
      const foot = (slot.footLeft || slot.footRight) ? `<div class="wk-p-foot">
        <span class="wk-p-foot-left">${escapeHTML(slot.footLeft || '')}</span>
        <span class="wk-p-foot-right">${escapeHTML(slot.footRight || '')}</span>
      </div>` : '';
      innerHtml = `<article class="wk-card wk-pulse" data-state="${escapeHTML(slot.state || 'signal')}" data-tier="${escapeHTML(slot.tier || 'statement')}">
        <div class="wk-p-kicker"><span class="wk-p-label"><span class="wk-p-led" aria-hidden="true"></span>PULSE</span>${time}</div>
        <div class="wk-p-center">${glyph}<div class="wk-p-text">${escapeHTML(text)}</div></div>
        ${foot}
      </article>`;
    } else {
      const picture = !!slot.thumb;
      const bg = picture
        ? `background-image:url('${escapeHTML(slot.thumb)}')`
          + (slot.focus ? `;background-position:${escapeHTML(slot.focus)}` : '')
        : '';
      const tease = slot.tease || '';
      const tier = RI ? RI.recentTier(RI.tierLen(tease)) : 'standard';
      const paletteAttr = (slot.palette && slot.palette !== 'default') ? ` data-state="${escapeHTML(slot.palette)}"` : '';
      innerHtml = `<article class="wk-card wk-composed" data-kind="${escapeHTML(slot.kind)}"
        data-shape="${picture ? 'picture' : 'words'}" data-tier="${tier}"${paletteAttr}>
      <div class="wk-img" style="${bg}"><span class="wk-tag">${escapeHTML(slot.kicker)}</span></div>
      <div class="wk-body">
        <div class="wk-kicker"><span class="wk-dot"></span>${escapeHTML(slot.kicker)}</div>
        <div class="wk-t-title">${escapeHTML(slot.title)}</div>
        ${tease ? `<div class="wk-snip">${escapeHTML(tease)}</div>` : ''}
        ${slot.sub ? `<div class="wk-meta">${escapeHTML(slot.sub)}</div>` : ''}
      </div>
    </article>`;
    }
  }
  return `<div class="card-face">${innerHtml}</div>`;
}

// One grid cell: the card as it will publish, plus the two things only the
// console can tell you — whether this slot changes on the next publish, and how
// to take it over.
function gridCellHtml(slot, index, mark, actionable) {
  const isEditing = Boolean(_composing && slot && slot.id === _composing);
  const badge = isEditing
    ? toneBadge('EDITING', 'editing')
    : (mark && mark !== 'UNCHANGED' ? toneBadge(mark, mark === 'GONE' ? 'going' : 'staged') : '');
  const tablet = index === 3 ? toneBadge('TABLET ONLY', 'quiet') : '';
  const live = slot && slot.live ? toneBadge('LIVE', 'live') : '';
  const editBar = isEditing
    ? `<div class="cards-grid-editing-bar">
         <span class="cards-grid-editing-label"><span class="cards-composer-dot"></span>EDITING THIS CARD</span>
         <div class="cards-grid-editing-actions">
           <button class="btn btn-sm btn-ghost cards-cancel-btn" onclick="cardsCancelEdit()" title="Cancel editing">✕ CANCEL</button>
           <button class="btn btn-sm btn-stage cards-done-btn" onclick="cardsDoneEditing()" title="Done editing">✓ DONE</button>
         </div>
       </div>`
    : (actionable && slot
      ? `<button class="btn btn-sm btn-stage grid-edit" onclick="cardsEditSlot(${index})"
           title="Take this card over — write your own words on it">✎ EDIT THIS CARD</button>`
      : '');
  return `<article class="grid-cell${index === _slotIndex ? ' is-active' : ''}${isEditing ? ' is-editing' : ''}">
    <header class="grid-cell-head">
      <button class="grid-cell-n" onclick="cardsSelectSlot(${index})"
        title="Focus this slot in the studio">SLOT ${String(index + 1).padStart(2, '0')}</button>
      <span class="grid-cell-flags">${live}${badge}${tablet}</span>
    </header>
    ${realCardHtml(slot)}
    ${editBar}
  </article>`;
}

// ---- the composer card: the one card in this console you can type on ----
function composerCardHtml(card) {
  const RI = engine();
  const media = RI ? RI.composedMedia(card) : '';
  // THE SAME RULE THE PUBLISHED CARD USES. composedCard() gates the picture on
  // `media && layout !== 'plain'`, so "Always the words" shows the typographic
  // tile even when the card has a photo. Asking only "is there a picture" here
  // left the photo on screen after the author chose the words — the composer
  // and the live card disagreeing about the same card, which is the one thing
  // this surface exists not to do.
  const picture = _composedIsPicture(card);
  const tier = RI ? RI.recentTier(RI.tierLen(card.tease || '')) : 'standard';
  const bg = media
    ? `background-image:url('${escapeHTML(cdnThumb({ filename: media }, RI.composedFolder(card)))}')`
    : '';
  const pos = card.cardFocus ? `;background-position:${escapeHTML(card.cardFocus)}` : '';
  const q = `'${escapeAttrJS(card.id)}'`;
  const paletteAttr = (card.palette && card.palette !== 'default') ? ` data-state="${escapeHTML(card.palette)}"` : '';

  return `<div class="card-face is-editing">
    <article class="wk-card wk-composed" id="composer-card"
      data-shape="${picture ? 'picture' : 'words'}" data-tier="${tier}"${paletteAttr}>
      <div class="wk-img" id="composer-media" style="${bg}${pos}">
        <span class="wk-tag" data-label-echo>${escapeHTML(RI ? RI.composedLabel(card) : 'Featured')}</span>
      </div>
      <div class="wk-body">
        <!-- The words-only shape wears a kicker where the picture shape wears
             its chip — the same two jobs the real text and hero cards split. -->
        <div class="wk-kicker"><span class="wk-dot"></span><span
          data-label-echo>${escapeHTML(RI ? RI.composedLabel(card) : 'Featured')}</span></div>
        <label class="composer-sr" for="composer-title">The card's headline</label>
        <textarea class="wk-t-title" id="composer-title" rows="1"
          placeholder="Say it in a line" maxlength="${COMPOSED_TITLE_MAX}"
          oninput="cardsSetText(${q},'title',this.value)">${escapeHTML(card.title || '')}</textarea>
        <label class="composer-sr" for="composer-tease">The card's line underneath</label>
        <textarea class="wk-snip" id="composer-tease" rows="1"
          placeholder="And a little more, if it needs it"
          oninput="cardsSetText(${q},'tease',this.value)">${escapeHTML(card.tease || '')}</textarea>
      </div>
    </article>
  </div>`;
}

function composerRailHtml(card) {
  const RI = engine();
  const media = RI ? RI.composedMedia(card) : '';
  const q = `'${escapeAttrJS(card.id)}'`;
  const list = _composedCards();
  const at = list.findIndex((c) => c.id === card.id);

  const picture = controlBlock('PICTURE', `<div class="action-dock">
      <button class="btn btn-full ${media ? 'btn-ghost' : 'btn-stage'}"
        onclick="cardsPickImage(${q})"
        title="Choose from your archive, buffer, wallpapers or anything uploaded">
        ◎ ${media ? 'CHANGE PICTURE' : 'CHOOSE A PICTURE'}</button>
      ${media ? `<button class="btn btn-full btn-ghost" onclick="cardsCropCard(${q})"
        title="Set the tall 4:5 crop this card uses">▯ SET THE 4:5 CROP</button>
      <button class="btn btn-full btn-danger" onclick="cardsClearImage(${q})"
        title="Remove the picture — the card becomes a words card">✕ REMOVE PICTURE</button>` : ''}
    </div>`, {
    aside: media ? 'set' : 'none',
    note: media
      ? 'Pick from anywhere on your site — archive, buffer, wallpapers, or uploads. Set the 4:5 crop to frame the photo.'
      : 'Without a picture, your card displays your words with clean, prominent typography.',
  });

  const chip = controlBlock('CARD BADGE', `<input class="composer-input" type="text"
      value="${escapeHTML(card.label || '')}" placeholder="Featured" maxlength="24"
      aria-label="The small label on the card"
      oninput="cardsSetText(${q},'label',this.value)">`, {
    aside: 'optional',
    note: 'The small label on the card (e.g. “Featured”, “Project”, “Journal”). Leave empty for “Featured”.',
  });

  const curPal = card.palette || 'default';
  const palette = controlBlock('COLOR PALETTE', `
    <div class="cards-palette-row" id="cards-palette-row">
      ${PALETTE_PRESETS.map((p) => {
        const active = curPal === p.key;
        return `<button type="button" class="cards-swatch cards-swatch--${p.key}${active ? ' is-active' : ''}"
          data-palette="${p.key}" aria-pressed="${active ? 'true' : 'false'}"
          title="${escapeHTML(`${p.label} — ${p.note}`)}"
          aria-label="${escapeHTML(`${p.label}, ${p.note}`)}"
          onclick="cardsSetPalette(${q},'${p.key}')"></button>`;
      }).join('')}
    </div>`, {
    aside: curPal.charAt(0).toUpperCase() + curPal.slice(1),
    asideId: 'cards-palette-name',
    note: 'Tint the card surface with an atmospheric ground hue, matching the Pulse palette.',
  });

  // Only when the card carries a link — a spawned card keeps the one it inherited,
  // and this both SHOWS that it still opens the source and lets the owner cut it
  // loose. A from-scratch card has none, so the block simply is not there.
  const target = _linkTarget(card);
  const link = target ? controlBlock('LINK', `<div class="action-dock">
      <button class="btn btn-full btn-ghost" onclick="cardsClearLink(${q})"
        title="Cut this card loose from its source — it will point nowhere">
        ✕ MAKE FREE-FORM</button>
    </div>`, {
    aside: 'opens source',
    note: `Editing this card's words never touches ${escapeHTML(target.label)} — but tapping the `
      + `card still opens it, the same as before you took it over.`,
  }) : '';

  const order = list.length > 1 ? controlBlock('ORDER', `<div class="action-dock">
      <button class="btn btn-full btn-ghost" onclick="cardsReorder(${q},'up')"
        ${at <= 0 ? 'disabled' : ''}>▲ MOVE EARLIER</button>
      <button class="btn btn-full btn-ghost" onclick="cardsReorder(${q},'down')"
        ${at >= list.length - 1 ? 'disabled' : ''}>▼ MOVE LATER</button>
    </div>`, { aside: `${at + 1} of ${list.length}` }) : '';

  const reset = controlBlock('THIS SLOT', `<div class="action-dock">
      <button class="btn btn-full btn-danger" onclick="cardsResetToAuto(${q})"
        title="Remove this card — the slot goes back to filling itself">
        ↩ RESET TO AUTOMATIC</button>
    </div>`, {
    note: 'The grid fills itself automatically unless you say otherwise. Nothing is live until you publish.',
  });

  return `<aside class="studio-rail">${picture}${chip}${palette}
    ${layoutPickerHtml({ kind: 'composed', id: card.id })}${link}${order}${reset}</aside>`;
}

// The inspector. Everything about the focused slot, and every control that acts
// on it — all of them routed through the mutators that already own the gesture.
function railHtml(slot, mark, actionable) {
  if (!slot) {
    return `<aside class="studio-rail">${controlBlock('SLOT DETAILS',
      '<div class="control-empty">Nothing lands in this slot right now. Star a frame, publish a note, '
      + 'or put a track on the homepage card and it fills.</div>')}</aside>`;
  }
  const where = SLOT_SURFACE[slot.kind];
  const pending = mark && mark !== 'UNCHANGED';
  const status = controlBlock('SLOT DETAILS', readoutHtml([
    ['Content', slot.kicker],
    ['Publish status', slot.live ? 'live already' : (pending ? mark : 'no change pending'), slot.live ? 'ok' : (pending ? 'hot' : 'calm')],
    where && ['Source', where.surface.toUpperCase()],
  ]), { aside: slot.live ? 'live' : (pending ? 'changing' : 'steady') });

  if (!actionable) {
    return `<aside class="studio-rail">${status}${controlBlock('READ ONLY',
      '<div class="control-empty">This is your published homepage grid. Switch to STAGED at the top '
      + 'to customize cards or review upcoming changes.</div>')}</aside>`;
  }

  const acts = actionsHtml(slot);
  return `<aside class="studio-rail">${status}${layoutPickerHtml(slot)}
    ${acts ? controlBlock('ACTIONS', acts) : ''}</aside>`;
}

// ---- the two undo affordances, under the staged column ----
//
// Both answer "I just changed the wrong thing" without a stack. The chip is the
// live memory of the last displacing star; the shelf is the stateless one, read
// straight off the data, so it is still there tomorrow.
function _frameLabel(id) {
  const nums = getBufferFrameNumbers();
  return `f#${String(nums.get(id) || 0).padStart(3, '0')}`;
}

// The undo chips, and ONLY the chips. They belong beside the card they affect —
// reversibility layer 2 says the reverse of a displacing action lives in the
// view that made it — which is also why they are deliberately NOT in the reuse
// shelf below. A chip resolved against state as it is now and a strip of things
// you might use again are different objects; filing the chip among them would
// turn one live control into an entry in a history, which is the shape §2.4
// rejects.
function undoChipsHtml() {
  const prev = _repinTarget();
  const audioBack = _audioCardRestoreTarget();
  if (!prev && !audioBack) return '';

  const chip = prev
    ? `<button class="cards-chip cards-chip--undo" onclick="cardsRepinSwap()"
         title="Put the frame this star displaced back on the card">
         ↩ RE-PIN ${escapeHTML(_frameLabel(prev.id))}</button>`
    : '';
  const audioChip = audioBack
    ? `<button class="cards-chip cards-chip--undo" onclick="cardsRestoreAudioCard()"
         title="Put the ${audioBack.length} track${audioBack.length === 1 ? '' : 's'} you just cleared back on the audio card">
         ↩ RESTORE AUDIO CARD</button>`
    : '';
  return `<div class="cards-undo">${chip}${audioChip}</div>`;
}

// ---- the reuse shelf ----
//
// A REUSE SHELF, NOT A CHANGE HISTORY (owner, 2026-09-07). What is on it is work
// you already did that is ready to be used AGAIN — not a list of past states to
// restore. That distinction is the whole reason it is allowed to exist beside a
// reversibility rule that rejects an undo stack: nothing here rolls anything
// back, every chip is a forward action, and the strip is derived from data
// rather than from a log of what you pressed.
//
// v1 carries the frames already framed for this card: a frame that was featured
// once keeps its cardFocus with no `featured` flag — not cruft, a free marker
// that someone already framed it for the tall tile. Stateless, so unlike a chip
// it is still here tomorrow.
//
// Past pulses are deliberately NOT duplicated here. The Pulse composer already
// owns "that one again" (_pulseReuse, js/console/pulse.js) reading /api/pulse/log,
// and one home per kind of thing beats two that drift. The tile's OPEN ↗ is the
// route there.
function reuseShelfHtml() {
  const ready = _refeatureReady();
  if (!ready.length) return '';
  // One frame-number map for the whole strip. getBufferFrameNumbers() copies and
  // sorts the ENTIRE buffer on every call, so calling it per chip (through
  // _frameLabel) was O(chips · N log N) on a surface that repaints on every
  // action — cheap on a demo, not on a photographer's full buffer. Resolve once.
  const nums = getBufferFrameNumbers();
  const frameLabel = (id) => `f#${String(nums.get(id) || 0).padStart(3, '0')}`;
  const chips = ready.map((b) => `
    <button class="reuse-chip" onclick="cardsRefeature('${escapeAttrJS(b.id)}')"
      title="Feature this frame — its saved 4:5 crop comes with it">
      <img src="${escapeHTML(cdnThumb({ filename: b.filename }))}" alt=""
        style="object-position:${escapeHTML(b.cardFocus)}">
      <span class="reuse-chip-meta">
        <span class="reuse-chip-title">★ ${escapeHTML(frameLabel(b.id))}</span>
        <span class="reuse-chip-sub">saved 4:5 crop</span>
      </span>
    </button>`).join('');

  // ONE scroll container, every child unshrinkable. The label is inside the
  // scroller rather than a rigid sibling beside it, so a narrow screen scrolls
  // the whole strip instead of starving the reel down to a sliver it then clips.
  return `<footer class="cards-reuse" aria-label="Ready to re-feature">
    <div class="cards-reuse-track">
      <span class="cards-reuse-label">READY TO RE-FEATURE
        <span>already framed for this card</span></span>
      ${chips}
    </div>
  </footer>`;
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

  // Both grids are composed every paint, whichever one is on screen: the diff is
  // computed from the pair, and the marks are the point of the view.
  const actionable = _source !== 'live';
  const showing = actionable ? stagedSlots : liveSlots;

  const warn = live.failed.length
    ? `Could not reach ${live.failed.join(', ')} — the live grid is missing that source.`
    : '';
  const pending = marks.filter((m) => m && m !== 'UNCHANGED').length;

  const note = actionable
    ? 'Three tiles show on a phone and a desktop; the fourth appears only on a tablet held '
      + 'upright. Nothing here is on your site until you publish.'
    : 'This is the grid as it is published right now. Switch to STAGED to change what the '
      + 'next publish makes.';

  // A composed card in the focused slot turns the studio into the COMPOSER: the
  // card becomes editable in place and the rail carries the controls that build
  // it. Everything else keeps the read-only inspector. One surface, two jobs,
  // decided by what is in the slot rather than by a mode the owner has to pick.
  _lastSlots = showing;
  // ⚠️ WHERE THE COMPOSED CARD ACTUALLY LANDED — not where the button was.
  //
  // Composed cards carry a RANK, not a slot index (recent-index.js, pickRecent):
  // the engine files them in behind a live pulse, so taking over slot 04
  // publishes at slot 01, or 02 when a pulse leads. The banner named the slot
  // that was PRESSED, so it said "EDITING SLOT 04" about a card on slot 01 —
  // and ✓ DONE then dropped focus back onto whatever automatic item still sat at
  // index 3, which reads exactly like losing the edit. So the studio follows the
  // card to where the engine put it, asked of the row just composed rather than
  // re-derived with arithmetic that could drift from it.
  const composedAt = (actionable && _composing)
    ? showing.findIndex((s) => s && s.composed && s.id === _composing)
    : -1;
  if (composedAt > -1) _slotIndex = composedAt;
  const focused = showing[_slotIndex];
  // ⚠️ The composer is driven by WHAT IS BEING COMPOSED, not by what reached the
  // grid. A brand-new card has neither picture nor words, and the engine
  // deliberately refuses to render one — so asking the grid where it went
  // answered "nowhere", the composer never opened, and pressing COMPOSE looked
  // like it did nothing but raise a toast. The card being edited is module
  // state; that is the thing to ask.
  const composing = actionable ? _cardById(_composing) : null;

  const composerBar = `
    <div class="cards-composer-bar">
      <div class="cards-composer-info">
        <span class="cards-composer-dot"></span>
        <span class="cards-composer-title">${composedAt > -1
          ? `EDITING SLOT ${String(_slotIndex + 1).padStart(2, '0')}`
          : 'NEW CARD · NO SLOT YET'}</span>
      </div>
      <div class="cards-composer-actions">
        <button class="btn btn-sm btn-ghost cards-cancel-btn" onclick="cardsCancelEdit()"
          title="Cancel editing (discards untouched overrides)">✕ CANCEL</button>
        <button class="btn btn-sm btn-stage cards-done-btn" onclick="cardsDoneEditing()"
          title="Done editing — view card preview (Esc)">✓ DONE</button>
      </div>
    </div>`;

  const studio = composing
    ? `<div class="cards-studio is-composing">
         <div class="studio-stage" onclick="cardsHandleStageClick(event)"
           title="Click background or press Esc to exit edit mode">
           ${composerBar}
           ${composerCardHtml(composing)}
           ${undoChipsHtml()}
         </div>
         ${composerRailHtml(composing)}
       </div>`
    : `<div class="cards-studio">
         <div class="studio-stage">
           ${realCardHtml(focused)}
           ${actionable && focused ? `<button class="btn btn-stage"
             onclick="cardsEditSlot(${_slotIndex})"
             title="Take this card over — write your own words on it">✎ EDIT THIS CARD</button>` : ''}
           ${actionable ? undoChipsHtml() : ''}</div>
         ${railHtml(focused, marks[_slotIndex], actionable)}
       </div>`;

  const body = _mode === 'studio' ? studio
    : `<div class="cards-grid">${showing
        .map((s, i) => gridCellHtml(s, i, actionable ? marks[i] : '', actionable)).join('')}</div>`;

  host.innerHTML = `
    ${headHtml(pending, actionable)}
    ${ribbonHtml(showing, marks, actionable)}
    ${warn ? `<div class="cards-warn">${escapeHTML(warn)}</div>` : ''}
    <div class="cards-note">${escapeHTML(note)}</div>
    ${body}
    ${actionable ? reuseShelfHtml() : ''}`;

  // The fields carry their height as an inline style, so a fresh paint has to
  // size them once — otherwise a card opens with its tease clipped to one line
  // and only settles after the first keystroke.
  if (composing) _growFields();
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

  // Ghosts left by an earlier session, before anything is drawn from them.
  _sweepGhostCards();

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
