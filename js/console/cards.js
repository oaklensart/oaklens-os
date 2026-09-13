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
  STATE, save, stageChange, unstageChange, trashItem, ledgerRowFor, restoreStagedRow,
} from '../console-state.js';
import { escapeHTML, escapeAttrJS, registerView, showView, toast } from './chrome.js';
import { cdnThumb, cdnVariant } from './assets.js';
import { uid, todayISO } from './utils.js';
import { openAssetLibrary } from './asset-library.js';
import { getBufferFrameNumbers } from './fn-editor.js';
import {
  toggleBufferFeatured, getLastFeaturedSwap, bufferCardFocal, openFocalModal,
  measureCardBands,
} from './focal.js';
import {
  _audioPromote, _audioReorderFeatured, _audioClearCard, _audioRestoreCard, _audioCardRestoreTarget,
  openAudioLibrary,
} from './audio.js';
import {
  shareTarget, shareBlockBody, shareBlockAside, shareBlockNote,
} from './share.js';
import { shareStem } from './card-paint.js';

// How many slots the homepage fetches. Not a knob: the 3-visible/4-fetched grid
// is a recorded owner decision (docs/pulse-card-vision.md §4) and the ground the
// pin-budget rule is argued from. This view PRESENTS that reality; it does not
// parameterise it — which is also why the fourth tile is badged rather than
// hidden.
const GRID_SIZE = 4;

// What a composed card with nothing on it yet is CALLED on screen. A const
// rather than a literal because two readers need it: the tile prints it, and
// _shareOf has to recognise it — a share toast reading "✓ — untitled — — share
// images stamped" is two em-dashes colliding around a placeholder that was only
// ever meant for a tile.
const UNTITLED = '— untitled —';
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
  '/data/audio-sets.json',
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
  // No `composed`: a composed card is a photo, text or audio card with
  // overrides, and the engine's composedKind() says which (docs/cards-core-
  // complete.md chunk 1). Its dressing is chosen by cardsSetDressing below,
  // which writes kind + layout onto the record; cardsSetLayout is for entries.
};

// Where an entry of each slot kind actually lives, and which staging surface
// owns it. The pulse is absent on purpose: it is live already, no publish
// touches it, and it has no STATE array to edit.
// Where a composed card's provenance opens. The record names a SURFACE
// (`source.surface`, the console's own words for its lists); the views are
// registered under slightly different names (field notes are `fn`), so this is
// the one place the two vocabularies meet.
const SOURCE_VIEW = Object.freeze({ buffer: 'buffer', archive: 'archive', posts: 'fn', audio: 'audio' });
function _sourceView(card) {
  const surface = card && card.source && card.source.surface;
  return (surface && SOURCE_VIEW[surface]) || '';
}

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
    // The saved sets, so a card borrowing one previews the tracks it will
    // actually publish with rather than an empty player.
    audioSets: STATE.audioSets || [],
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
// ⚠️ EVERY READ REVALIDATES (`cache: 'no-cache'`). These files are served with
// a freshness window and a day of stale-while-revalidate (`_headers`,
// `/data/*.json`: max-age=300, s-w-r=86400; `/api/buffer-summary`: 60/300) —
// right for a visitor's homepage, and exactly wrong here: a plain fetch let the
// browser hand back the copy it already had and refresh it in the BACKGROUND,
// so this grid was always one publish behind — the owner published, watched the
// site change, came back to LIVE and saw the old grid, and a hard reload did
// not help because it reloads the document, not a fetch made after it
// (2026-09-12, docs/maintenance/2026-09-12-cards-live-grid-stale.md). A
// revalidation is one round trip and a 304 when nothing moved, and the Worker's
// own data cache is keyed by the deploy, so the answer is the deployed truth the
// moment the build lands.
async function _liveInputs() {
  const failed = [];
  const results = await Promise.all(LIVE_SOURCES.map(async (path) => {
    try {
      const res = await fetch(path, { cache: 'no-cache' });
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
  const [archiveRaw, postsRaw, summaryRaw, audioRaw, pulseRaw, cardsRaw, setsRaw] = results;
  const summary = (summaryRaw && !Array.isArray(summaryRaw)) ? summaryRaw : {};
  return {
    archive: RI ? RI.withSampleFallback(archiveRaw, RI.sampleFrames()) : [],
    posts: RI ? RI.withSampleFallback(postsRaw, [RI.sampleNote()]) : [],
    rawFeatured: Array.isArray(summary.featured) ? summary.featured : [],
    audio: Array.isArray(audioRaw) ? audioRaw : [],
    pulse: (pulseRaw && !Array.isArray(pulseRaw)) ? pulseRaw : null,
    composed: Array.isArray(cardsRaw) ? cardsRaw : [],
    audioSets: Array.isArray(setsRaw) ? setsRaw : [],
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

  // A composed card — the owner's own. It is the only kind that is EDITABLE
  // here rather than merely actionable, so the tile carries the card record
  // itself and the studio composes straight onto it. The engine hands it over
  // as one of the real kinds carrying `over` (the record) — that is the
  // marker; `kind: 'composed'` below is this view's own vocabulary.
  if (item.over) {
    const data = item.over;
    const media = RI ? RI.composedMedia(data) : '';
    // An audio card's own title is the registry's (the set, the soundboard, the
    // track), so the tile names that rather than falling through to '— untitled
    // —' for a card that is perfectly well described by what it plays.
    const audio = item.kind === 'audio';
    const plays = audio ? (item.set ? (item.set.name || item.set.slug) : 'Soundboard') : '';
    return {
      kind: 'composed',
      key: `composed:${data.id || ''}`,
      kicker: `${RI ? RI.composedLabel(data) : 'Featured'} · COMPOSED`,
      title: (data.title || '').trim() || (data.tease || '').trim() || plays || UNTITLED,
      sub: audio ? plays : (media ? '' : (RI ? RI.recentTier(RI.tierLen(data.tease || '')) : '')),
      tease: data.tease || '',
      thumb: media ? cdnThumb({ filename: media }, RI ? RI.composedFolder(data) : 'archive') : '',
      focus: RI ? RI.cardFocus(data) : '',
      palette: data.palette || '',
      id: data.id || '',
      composed: true,
      // OPEN ↗ goes to where the card CAME FROM — the frame, the photo, the
      // note, the track it took over — and a card made from nothing has
      // nowhere to go, so it gets no button. It said `cards` before, which
      // put an OPEN CARDS ↗ on the Cards view that reopened the view it was
      // already on: a button that does nothing is worse than none.
      view: _sourceView(data),
      item,
    };
  }

  const data = item.data || {};
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
    inputs.composed, inputs.audioSets,
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

// ---- LIVE's one action ----
//
// The live side is a record of what is published and offers nothing to change
// — except the way to the card that WILL publish in its place. One press flips
// the source and lands on the same card in the staged row, found by its KEY
// (entry identity, never the index: a live pulse shifts every index by one),
// so a live hero note is one click from its picker instead of two toggles and
// a hunt. Landing on a composed card opens its composer, exactly as a ribbon
// click would — the same decision, made by cardsSelectSlot.
export function cardsEditStaged(key) {
  if (!key) return;
  _source = 'staged';
  _repaint();                 // _lastSlots is the staged row from here on
  const at = (_lastSlots || []).findIndex((s) => s && s.key === key);
  if (at < 0) {
    toast('That card is not on the next publish — this is the row that replaces it', 'info');
    return;
  }
  cardsSelectSlot(at);
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
  // A composed card's layout is one half of its DRESSING (kind + layout), and
  // cardsSetDressing owns both halves together — a layout written here alone
  // could describe a card the kind cannot draw.
  if (slotKind === 'composed') return;
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

// A PICTURE card's title is a caption, not an essay: capped so it stays the two
// lines the grid gives it (paired with the .wk-composed .wk-title line-clamp) and
// never grows the footer into the picture. Bounds TYPING; a longer seeded title
// (from an archive entry) still displays clamped and its data is left intact.
//
// A WORDS card's title is the tile's own headline — the field note's title
// field has no cap and the tier ladder already bounds the tease — so the cap
// applies only where the title is a caption (chunk 2, docs/cards-core-complete.md).
const COMPOSED_TITLE_MAX = 48;
export function _titleCap(card) {
  // The audio caption is the picture caption's grammar in the picture caption's
  // place, so it takes the picture caption's bound (chunk 5).
  return (_composedIsPicture(card) || _composedIsAudio(card)) ? COMPOSED_TITLE_MAX : Infinity;
}

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
  // A tombstone is empty on purpose and must survive the sweep: discarding it
  // would free the address it exists to reserve, which is the one thing
  // retiring a card is for.
  if (card.retired) return false;
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
  // The other half of the dressing (cardsSetDressing writes kind + layout
  // together), so Cancel puts back "Always the words" as a whole.
  ['initialKind', 'kind'],
  // The overlay band's three chips, and the measurement the ink is derived from.
  // The chips are an edit like any other and revert like one; `img` is in here
  // because the picture reverts too, and a measurement of the picture you no
  // longer have is worse than none — overlayInk's unmeasured answer is at least
  // legible.
  ['initialOverlay', 'overlay'],
  ['initialImg', 'img'],
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
        if (_editSnapshot.initialKind) card.kind = _editSnapshot.initialKind;
        else delete card.kind;
        // The overlay band's chips and the luminance the ink is derived from.
        // They revert with the picture they describe.
        if (_editSnapshot.initialOverlay) card.overlay = { ..._editSnapshot.initialOverlay };
        else delete card.overlay;
        if (_editSnapshot.initialImg) card.img = { ..._editSnapshot.initialImg };
        else delete card.img;
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

// The cards the studio can SHOW — live ones, in rank order. A retired card is a
// tombstone (chunk 6): it holds an address and nothing else, so there is no
// slot to focus, no words to edit and no picture to crop. Filtered here, in the
// one accessor every surface already goes through, so the grid, the budget, the
// ORDER chips and the compaction all agree without any of them asking.
export function _composedCards() {
  return _cards().filter((c) => c && !c.retired)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
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
  if (_composedCards().length >= COMPOSED_MAX) {
    toast(`The homepage holds ${COMPOSED_MAX} composed cards — clear one first`, 'warn');
    return null;
  }
  const card = {
    id: `c-${uid()}`,
    // The next LIVE rank. `_cards().length` counted tombstones too, which after
    // a retire mints a card at order 3 in a row of one — harmless to the sort,
    // but it breaks the 1..n-and-contiguous invariant _recompact exists to hold.
    order: _composedCards().length + 1,
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
  const v = String(value == null ? '' : value);
  card[field] = field === 'title' ? v.slice(0, _titleCap(card)) : v;
  _stageCard(card, 'edit');
  _paintComposed(card);
}

// The fields are the card's own text nodes made editable (composerCardHtml),
// so a keystroke arrives as an element, not a value. Read it, note whether it
// is empty (the placeholder is CSS on that attribute — an attribute write,
// never a value write), and hand the words to the mutator above.
export function cardsFieldInput(el, id, field) {
  if (!el) return;
  const text = el.innerText != null ? el.innerText : el.textContent;
  const value = String(text || '').replace(/\u00a0/g, ' ');
  if (value.trim()) el.removeAttribute('data-empty');
  else el.setAttribute('data-empty', '');
  cardsSetText(id, field, value);
}

// The cap, felt at the keyboard rather than discovered on the homepage. A
// contenteditable has no maxlength, so an insert that would run the title past
// the cap is refused BEFORE it lands — the field and the record can never
// disagree by more than an edge case (an IME commit, which cardsSetText's
// slice then bounds). Deleting is always allowed; a words headline has no cap.
export function cardsGuardTitle(event, id) {
  const card = _cardById(id);
  if (!card || !event || !/^insert/.test(event.inputType || '')) return;
  const cap = _titleCap(card);
  if (cap === Infinity) return;
  const el = event.currentTarget || event.target;
  const have = String((el && (el.innerText != null ? el.innerText : el.textContent)) || '').length;
  const sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null;
  const replaced = (sel && el && sel.anchorNode && el.contains(sel.anchorNode)) ? String(sel).length : 0;
  const data = event.data != null ? String(event.data)
    : (event.dataTransfer ? String(event.dataTransfer.getData('text/plain') || '') : '');
  const add = data.length || 1;
  if (have - replaced + add > cap) event.preventDefault();
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

// ---- the dressing: kind + layout, chosen as one control ----
//
// The rail keeps the three words the owner already knows — Automatic / Always
// the picture / Always the words — and each is a (kind, layout) pair written
// onto the record, so the engine's own normalizer (composedKind) and gate
// (layoutFor) decide what publish draws; nothing here restates either.
//
//   auto     no kind, no layout — the engine reads the SHAPE: a usable picture
//            is the photo kind, anything else the text kind
//   picture  photo — or text + hero when the card came from a note, so it
//            stays the note's own hero card rather than an archive tile
//   words    text — the field-note tile, drop cap and caret and all
//   <name>   the resolved kind wearing a further registered layout (none
//            today; chunk 3 registers `overlay` and it appears here by itself)
//
// AUTOMATIC IS THE ABSENCE OF A KIND, NOT A KIND WRITTEN DOWN. The brief said
// "derived kind"; writing the derived kind would freeze it — a words card
// dressed Automatic would stay a words card after gaining a picture, which is
// the opposite of what the word promises. The absence is what every legacy
// record already means and what the engine already reads.
//
// REVERSIBILITY IS STRUCTURAL: Automatic is always one of the chips and always
// on screen, and pressing it runs this same mutator — the picker rule
// (cardsSetLayout above, vision §5.4). +1 staged in every direction, folded
// with the card's other edits by _stageCard; Cancel puts the pair back whole
// (EDIT_FIELDS carries `kind` and `card`).
export const DRESSING_LABEL = Object.freeze({
  auto: 'Automatic', picture: 'Always the picture', words: 'Always the words',
});

// Which dressing a record wears as it stands. A record the shipped console
// wrote (no `kind`, a `plain` / `hero` layout) is read the way the engine
// reads it, so the right chip lights before _normalizeCard has touched it.
export function _dressingOf(card) {
  const RI = engine();
  if (!card || !RI) return 'auto';
  const layout = RI.cardDescriptor(card).layout;
  if (card.kind === 'audio') return 'audio';
  if (card.kind === 'text') {
    const l = RI.resolveLayout('text', layout);
    return l === 'hero' ? 'picture' : (l === 'default' ? 'words' : l);
  }
  if (card.kind === 'photo') {
    const l = RI.resolveLayout('photo', layout);
    return l === 'default' ? 'picture' : l;
  }
  if (layout === 'plain') return 'words';
  if (layout === 'hero') return 'picture';
  return 'auto';
}

// The (kind, layout) pair a dressing writes onto THIS card, or null when the
// card cannot wear it — which is also why its chip is greyed. Empty strings
// mean "remove the field".
function _dressingTarget(card, key) {
  const RI = engine();
  if (!RI || !card) return null;
  if (key === 'auto') return { kind: '', layout: '' };
  if (key === 'words') return { kind: 'text', layout: '' };
  if (key === 'picture') {
    if (!RI.composedMedia(card)) return null;
    const fromNote = !!(card.source && card.source.surface === 'posts');
    return fromNote ? { kind: 'text', layout: 'hero' } : { kind: 'photo', layout: '' };
  }
  // A further registered layout of the kind the card resolves to today, asked
  // of the gate with a probe of the record as it would be written.
  const kind = RI.composedKind(card);
  if (kind === 'audio' || RI.resolveLayout(kind, key) !== key) return null;
  const probe = { ...card, kind, card: { ...(card.card || {}), layout: key } };
  return RI.layoutFor(kind, {}, probe) === key ? { kind, layout: key } : null;
}

export function cardsSetDressing(id, key) {
  const card = _cardById(id);
  const RI = engine();
  if (!card || !RI || !key) return;
  const target = _dressingTarget(card, key);
  if (!target) {
    toast(key === 'picture'
      ? 'Give the card a picture first — then it can always lead with it'
      : `This card can't wear the ${key} layout yet`, 'warn');
    return;
  }
  const rest = { ...(card.card || {}) };
  delete rest.layout;
  const desc = target.layout ? { ...rest, layout: target.layout } : rest;
  const probe = { ...card, card: desc };
  if (target.kind) probe.kind = target.kind; else delete probe.kind;
  // Already worn (a photo card asked to lead with its picture, a note's hero
  // card asked the same): nothing changes, so nothing is staged.
  if (_dressingOf(probe) === _dressingOf(card)) return;

  if (target.kind) card.kind = target.kind; else delete card.kind;
  if (Object.keys(desc).length) card.card = desc; else delete card.card;
  _stageCard(card, 'edit');
  toast(key === 'auto'
    ? '✓ Back to automatic — the picture leads when there is one'
    : `✓ ${DRESSING_LABEL[key] || key} — applies on publish`, 'success');
  _repaint();
}

// ---- the overlay band: three closed sets, no sliders ----
//
// docs/cards-core-complete.md §2.2: "Overlay controls are a closed set, not
// sliders. Ink is never chosen by the author — it is derived from measured
// luminance." So the author gets nine chips across three questions, every one of
// them a value the stylesheet has a rule for, and the tenth decision — which
// colour the type is — is not theirs to make. A slider would let them park the
// card in a state nobody has designed and nobody can test.
//
// REVERSIBILITY IS STRUCTURAL (vision §5.4): each row's DEFAULT is always one of
// the chips and always on screen, pressing it runs this same mutator, and it
// stages +1 in both directions. No undo chip, because there is nothing an undo
// chip could do that the row does not already do.
export const OVERLAY_LABEL = Object.freeze({
  place: { bottom: 'Bottom', top: 'Top', centre: 'Middle' },
  treat: { scrim: 'Shaded', blur: 'Frosted', none: 'Bare' },
  blur: { 1: 'Soft', 2: 'Medium', 3: 'Heavy' },
});

// Write one of the three choices. Only what DIFFERS from the engine's defaults
// is stored, and a card back on all three defaults loses the key entirely — so
// "I tried moving it and put it back" publishes the same bytes as "I never
// touched it" (the serialization law, and the same idiom cardFocus and the
// layout descriptor already use).
export function cardsSetOverlay(id, key, value) {
  const card = _cardById(id);
  const RI = engine();
  if (!card || !RI || !OVERLAY_LABEL[key]) return;
  const v = key === 'blur' ? Number(value) : String(value);
  const allowed = key === 'place' ? RI.overlayPlaces
    : key === 'treat' ? RI.overlayTreats : RI.overlayBlurs;
  if (allowed.indexOf(v) === -1) return;
  const now = RI.overlayOf(card);
  if (now[key] === v) return;                 // already worn — nothing changed, nothing staged
  const next = { ...now, [key]: v };
  const base = RI.overlayOf(null);            // the defaults, asked of the engine
  const lean = {};
  for (const k of ['place', 'treat', 'blur']) if (next[k] !== base[k]) lean[k] = next[k];
  if (Object.keys(lean).length) card.overlay = lean; else delete card.overlay;
  _stageCard(card, 'edit');
  _repaint();
}

// The OVERLAY block, shown only while the focused card actually wears the layout
// — a band's settings on a card with no band is furniture, and the dressing
// picker one block up is where the layout itself is chosen.
function overlayBlockHtml(card) {
  const RI = engine();
  if (!RI || !card || typeof RI.overlayOf !== 'function') return '';
  const kind = RI.composedKind(card);
  if (RI.layoutFor(kind, {}, card) !== 'overlay') return '';
  const o = RI.overlayOf(card);
  const q = `'${escapeAttrJS(card.id)}'`;

  const row = (label, key, values) => `<div class="cards-ov-row">
    <span class="cards-ov-label">${escapeHTML(label)}</span>
    <div class="layout-chips">${values.map((val) => {
      const on = o[key] === val;
      return `<button class="layout-chip${on ? ' is-on' : ''}"
        onclick="cardsSetOverlay(${q},'${escapeAttrJS(key)}','${escapeAttrJS(String(val))}')"
        aria-pressed="${on ? 'true' : 'false'}"
        title="${escapeHTML(`${label}: ${OVERLAY_LABEL[key][val]}`)}">
        <span class="layout-chip-label">${escapeHTML(OVERLAY_LABEL[key][val])}</span>
      </button>`;
    }).join('')}</div>
  </div>`;

  const ink = RI.overlayInk(card, o.place);
  const lum = card.img && card.img.lum;
  const band = { top: 'top', centre: 'mid', bottom: 'bottom' }[o.place];
  const reading = (lum && typeof lum[band] === 'number')
    ? `${Math.round(lum[band] * 100)}% bright`
    : 'not measured yet';

  return controlBlock('WORDS ON THE PICTURE', `
    ${row('Where', 'place', RI.overlayPlaces)}
    ${row('Behind', 'treat', RI.overlayTreats)}
    ${o.treat === 'blur' ? row('Frost', 'blur', RI.overlayBlurs) : ''}
    ${readoutHtml([
      ['Type', ink === 'dark' ? 'dark, on a bright picture' : 'light, on a darker picture'],
      ['Under the words', reading],
    ])}`, {
    aside: OVERLAY_LABEL.place[o.place],
    note: 'The colour of the type is not a setting — your site measures how bright '
      + 'the picture is where the words land and picks the one that can be read. '
      + 'Re-crop the picture and it measures again.',
  });
}

// ---- the audio source: two places tracks can come from, and only two ----
//
// A composed audio card names a source; the registry answers (recent-index.js
// composedItem). So the studio's job here is to name one — not to hold a copy
// of a track list, which would be the second answer to "what plays here" that
// chunk 4 spent a whole log arguing against.
//
// THE PICKER IS THE UNDO. Both options are always on screen and pressing the
// other one is the whole reverse — reversibility layer 1, the same shape as
// the dressing chips and the palette swatches. Nothing here earns a chip.
const AUDIO_SOURCE_LABEL = Object.freeze({
  tracks: '♪ The homepage tracks',
  set: '▤ A saved set',
});

// Which source a card is on. `set` is the only field, so its presence IS the
// answer — there is no third state to get out of step with.
export function _audioSourceOf(card) {
  return (card && typeof card.set === 'string' && card.set) ? 'set' : 'tracks';
}

function _liveSets() {
  return (STATE.audioSets || []).filter((s) => s && s.slug && !s.retired);
}

// Move the card between the two sources. Going back to the homepage tracks
// drops the key entirely (the serialization law: a card that never borrowed a
// set publishes the bytes it always did), and going to a set with none saved
// refuses out loud rather than writing a slug that resolves to nothing.
export function cardsSetAudioSource(id, source) {
  const card = _cardById(id);
  const RI = engine();
  if (!card || !RI || RI.composedKind(card) !== 'audio') return;
  if (source === _audioSourceOf(card)) return;          // already there — nothing staged
  if (source === 'set') {
    const sets = _liveSets();
    if (!sets.length) {
      toast('Make a set on the Audio shelf first — then this card can borrow it', 'info');
      return;
    }
    card.set = sets[0].slug;
  } else {
    delete card.set;
  }
  _stageCard(card, 'edit');
  _repaint();
}

// Borrow a different set. The <select> only ever offers live sets, so the value
// cannot name a retired slug — but the guard stays, because a stale DOM after a
// retire elsewhere is exactly the dead-button case the reversibility rule calls
// out.
export function cardsPickSet(id, slug) {
  const card = _cardById(id);
  if (!card) return;
  if (!_liveSets().some((s) => s.slug === slug)) return;
  if (card.set === slug) return;
  card.set = slug;
  _stageCard(card, 'edit');
  _repaint();
}

// ♪ CHOOSE TRACKS — the studio as a SECOND FRONT DOOR on the shelf's own
// mutator, never a second write path. The library hands back the slugs the
// owner ticked; every track whose featured state must change is toggled through
// _audioPromote, which is where the cap, the dense renumber and the staged row
// already live. _audioRestoreCard does the same thing for the same reason.
//
// This writes the HOMEPAGE TRACKS, so it changes the automatic audio card too —
// which is the point: there is one featured list, and the studio is a place to
// edit it rather than a place to shadow it.
export function cardsChooseTracks() {
  const reg = STATE.audio || [];
  const cap = engine()?.AUDIO_MAX_PLAYLIST ?? 6;
  // Opens showing what the card already plays, ticked — see openAudioLibrary.
  const already = reg.filter((t) => t && t.featured)
    .sort((a, b) => (Number(a.featured_order) || 0) - (Number(b.featured_order) || 0))
    .map((t) => t.slug);
  openAudioLibrary((picked) => {
    // The library hands back TRACK RECORDS, in the order they were ticked.
    const list = (Array.isArray(picked) ? picked : [picked]).filter(Boolean);
    if (list.length > cap) {
      toast(`⚠ The homepage card holds at most ${cap} tracks`, 'warning');
      return;
    }
    const order = list.map((t) => t.slug);
    const want = new Set(order);
    // Off first, then on: toggling one on before the removals land would meet
    // _audioPromote's cap on a list that is about to shrink.
    (STATE.audio || []).filter((t) => t && t.featured && !want.has(t.slug))
      .forEach((t) => _audioPromote(t.id));
    order.map((slug) => (STATE.audio || []).find((t) => t && t.slug === slug))
      .filter((t) => t && !t.featured)
      .forEach((t) => _audioPromote(t.id));
    // THEN THE ORDER. _audioPromote only ever appends, so the two loops above
    // settle WHICH tracks play and nothing at all about the order they play in
    // — re-ticking two already-featured tracks the other way round used to be a
    // no-op the author could see no reason for. The picker hands back the order
    // it was ticked in, and this is the mutator that owns it.
    _audioReorderFeatured(order);
    _repaint();
  }, true, { preselect: already, confirmLabel: 'USE THESE TRACKS' });
}

// ---- ♪ ADD AUDIO: any composed card can become the audio card, from here ----
//
// The owner's ask (2026-09-11): compile a track list inside the composer, not
// on the Audio shelf. The picker already exists (cardsChooseTracks, above) —
// it was only reachable from a card that was ALREADY the audio kind, and the
// only way to get one was to take the automatic audio slot over. So this is
// one word on the record — `kind: 'audio'` — and then the picker, in that
// order: the card is an audio card the moment the modal opens, so what the
// owner ticks is what it plays. Nothing else on the record moves: the picture,
// the words, the badge and the palette are all KEPT, because the reverse of
// this gesture (cardsRemoveAudio, the same block) has to give them back — and
// a picture on an audio card is chunk 5's noted future layout, not a defect.
// Cancelling the picker leaves an audio card playing the homepage tracks,
// which is the state the automatic takeover starts in too.
export function cardsAddAudio(id) {
  const card = _cardById(id);
  const RI = engine();
  if (!card || !RI) return;
  if (RI.composedKind(card) === 'audio') return;         // already is — nothing staged
  card.kind = 'audio';
  _stageCard(card, 'edit');
  toast('✓ This card plays audio now — pick what it plays', 'success');
  _repaint();
  cardsChooseTracks();
}

// The reverse, in the same block. Dropping `kind` lets the engine read the
// card by its shape again — a picture if it kept one, the words if not — and
// `set` goes with it, because a set is a thing only the audio kind can name.
// A card seeded by taking the automatic audio slot over becomes an empty
// words card here; ↩ RESET TO AUTOMATIC is the gesture for that one.
export function cardsRemoveAudio(id) {
  const card = _cardById(id);
  const RI = engine();
  if (!card || !RI) return;
  if (RI.composedKind(card) !== 'audio') return;
  delete card.kind;
  delete card.set;
  _stageCard(card, 'edit');
  toast(`✓ Audio removed — the card reads as ${RI.composedShape(card) === 'picture' ? 'its picture' : 'words'} again`, 'info');
  _repaint();
}

// The shipped console wrote its dressing as a LAYOUT on a kindless record
// (`plain` for the words, `hero` for the picture). The engine reads that
// forever — chunk 1's normalizer is the fork guarantee — but this console
// writes one shape, so a legacy record is rewritten on the way into the view,
// silently: the rendered card is byte-identical either way (pinned in
// tests/cards-composer.test.js against the engine), so there is nothing to
// stage, and the new bytes ride the next publish with whatever else moved.
// Exported for that test.
export function _normalizeCard(card) {
  if (!card || card.kind) return false;
  const layout = card.card && card.card.layout;
  if (layout !== 'plain' && layout !== 'hero' && layout !== 'default') return false;
  const rest = { ...card.card };
  delete rest.layout;
  if (layout === 'plain') card.kind = 'text';
  else if (layout === 'hero') card.kind = 'photo';
  if (Object.keys(rest).length) card.card = rest; else delete card.card;
  return true;
}
function _normalizeCards() {
  let changed = false;
  for (const c of _cards()) if (_normalizeCard(c)) changed = true;
  if (changed) save();
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
    // A new picture invalidates the old crop's measurement — and would otherwise
    // hand the overlay layout the previous photograph's brightness.
    delete card.img;
    _stageCard(card, 'edit');
    toast('✓ Picture set — crop it for the tall card if you like', 'success');
    _repaint();
    _measurePicture(card);
  }, 'archive');
}

// ---- the one measurement: how bright the picture is, band by band ----
//
// THE OVERLAY LAYOUT'S INK IS DERIVED, AND THIS IS WHERE THE NUMBER COMES FROM
// (docs/cards-core-complete.md chunk 3). The engine may not measure a picture at
// render time — recent-index.js runs from `file://` in the offline export, and a
// card that re-inked itself after paint would shift — so the three band
// luminances of the 4:5 crop are sampled HERE, once, and stored on the record.
//
// Called on pick and on re-crop, the only two gestures that change what is under
// the words. Deliberately NOT awaited by either: it decodes an image off the CDN
// and the card must not sit there un-editable while it does. It stages nothing of
// its own — the gesture that triggered it already counted (the staging law: one
// gesture, one bump) and this is that gesture's own arithmetic finishing.
//
// FAILURE IS A NORMAL STATE. measureCardBands never rejects; a null answer leaves
// the card unmeasured, which overlayInk reads as "light ink over the scrim" — the
// legible default. A picture the console cannot sample is still a picture the
// owner can use, so nothing is toasted and nothing latches red.
function _measurePicture(card) {
  const RI = engine();
  const media = RI ? RI.composedMedia(card) : '';
  if (!card || !media) return Promise.resolve(null);
  const src = cdnVariant({ filename: media }, 1024, RI.composedFolder(card));
  return measureCardBands(src, card.cardFocus || '').then((lum) => {
    // The card may have been cancelled, deleted or re-pictured while the image
    // decoded. Only write when the record still wants THIS measurement.
    if (!lum || !_cardById(card.id) || RI.composedMedia(card) !== media) return null;
    card.img = { lum };
    save();
    // Repaint only when this card is the one on screen — the ink may have just
    // flipped under the band.
    if (_composing === card.id) _repaint();
    return lum;
  });
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
  // The measurement and the band's settings describe a picture that is gone.
  // Leaving them would publish a record claiming a brightness nothing has.
  delete card.img;
  delete card.overlay;
  // A dressing that leads with a picture cannot survive losing the picture. The
  // engine would degrade it anyway (a `photo` with no picture renders as text,
  // `hero` and `overlay` gate to default); clearing it keeps the rail from
  // showing "Always the picture" pressed on a card that has none (the FN
  // composer's rule).
  if (card.card && (card.card.layout === 'hero' || card.card.layout === 'overlay')) delete card.card;
  if (card.kind === 'photo') delete card.kind;
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
      // A re-crop moves what is under the words, so the overlay's ink is
      // re-measured against the new framing.
      _measurePicture(card);
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
  if (_composedCards().length >= COMPOSED_MAX) {
    toast(`The homepage holds ${COMPOSED_MAX} composed cards — reset one first`, 'warn');
    return;
  }

  // THE AUDIO SLOT HAS ITS OWN SEED, and the shape of it is the whole point of
  // chunk 5. Every other kind is taken over by COPYING what it showed — the
  // words, the picture, the crop — so editing the card never writes back. An
  // audio card cannot be copied that way: a track is a file, a duration and a
  // waveform living in the registry, so the card names a SOURCE instead and the
  // registry answers (recent-index.js composedItem).
  //
  // Seeding with no `set` means the source is THE HOMEPAGE TRACKS — exactly
  // what this slot was already playing — so the transport survives the takeover
  // with nothing copied and nothing to fall out of step with the shelf. That
  // closes the "audio takeover loses the player" hole of 2026-09-07.
  //
  // No `source` either, and deliberately: a playlist has no single entry, and a
  // single-track card is playing a LIST OF ONE that the shelf can change under
  // it. Provenance that can go stale is worse than none.
  //
  // And NO `link`. Every other kind seeds one because a takeover must keep
  // opening what the visitor tapped; an audio card's address is decided by what
  // it PLAYS — the set's own page, or /listen/ — which is the rule that keeps
  // its name and its address agreeing. A seeded link would either say the same
  // thing twice or disagree with the card's own headline, and the control to
  // clear it would have nothing to change.
  if (slot.kind === 'audio') {
    const made = {
      id: `c-${uid()}`,
      // The next LIVE rank — see cardsCompose.
      order: _composedCards().length + 1,
      kind: 'audio',
      title: '',
      tease: '',
      label: 'Audio',
      added_at: todayISO(),
    };
    _cards().push(made);
    _recompact();
    _stageCard(made, 'add');
    _slotIndex = Number(index);
    _focusComposed(made.id);
    _editSnapshot = { id: made.id, isNewFromAuto: true, ..._captureEditFields(made) };
    toast('✓ This card is yours now — it keeps playing, and the words are yours', 'success');
    _repaint();
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
    // The next LIVE rank — see cardsCompose for why this is not _cards().length.
    order: _composedCards().length + 1,
    // Seeded copies (editing them never touches the source) — but the link and
    // provenance ride along, so the card still opens where the original did.
    ...(media ? { media, folder: _folderFor(media) } : {}),
    ...(entry && (entry.cardFocus || entry.focus)
      ? { cardFocus: entry.cardFocus || entry.focus } : {}),
    ...(link ? { link } : {}),
    ...(entry && entry.id && home ? { source: { surface: home.surface, id: entry.id } } : {}),
    // A note that leads with its hero keeps leading with it: the takeover is
    // dressed `text + hero`, so the card the visitor saw (the note's own
    // class, the display-face title) is the card the author starts from.
    // Everything else starts Automatic — no `kind` — and the engine reads the
    // shape (cardsSetDressing, below).
    ...(slot.kind === 'text' && media ? { kind: 'text', card: { layout: 'hero' } } : {}),
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
// (recent-index.js composedShape — the value the card root wears as
// data-shape). One rule, asked from both the full paint and the surgical one.
function _composedIsAudio(card) {
  const RI = engine();
  return !!RI && RI.composedShape(card) === 'audio';
}

function _composedIsPicture(card) {
  const RI = engine();
  if (!RI) return Boolean(card && card.media);
  return RI.composedShape(card) === 'picture';
}

function _paintComposed(card) {
  const RI = engine();
  if (!card || typeof document === 'undefined') return;
  const root = document.getElementById('composer-card');
  if (root) {
    const picture = _composedIsPicture(card);
    // Asked of the engine, not derived from `picture` — an audio card is a
    // third answer, and stamping it 'words' would put the typographic tile's
    // rules on a card that is a waveform.
    root.setAttribute('data-shape', RI ? RI.composedShape(card) : (picture ? 'picture' : 'words'));
    // The tier ladder binds to the words tile only: a picture card carries no
    // data-tier on the homepage (textHeroCard / photoCard stamp none), so it
    // carries none here either.
    if (!picture && RI) root.setAttribute('data-tier', RI.recentTier(RI.tierLen(card.tease || '')));
  }
  // The fields size themselves — they are the card's own text nodes, editable
  // in place — so nothing here touches a height, a value, the caret or the IME.

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
  if (card.retired) return;
  // A PUBLISHED card keeps its address. Everything else about this gesture is
  // unchanged — see _cardRetire for why the two paths differ.
  if (card._imported) return _cardRetire(id);
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

// The card's address as a full URL, ready to paste anywhere. The path half is
// the engine's (entryHref); the origin is this console's own, so a fork copies
// its own domain without anything being configured.
export function cardsCopyAddress(id) {
  const card = _cardById(id);
  const RI = engine();
  const path = (card && RI && RI.entryHref) ? RI.entryHref('composed', card) : '';
  if (!path) return;
  const url = location.origin + path;
  // Same guard as shareCopyLink's, for the same reason and on the same screen:
  // `navigator.clipboard` is undefined outside a secure context (an iPad on
  // `http://<LAN ip>:8787` against `wrangler dev`), and reading `.writeText` off
  // it throws before any `.then` can catch. Fixing one of these two buttons and
  // not the other would be worse than fixing neither.
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    return toast('Copy needs a secure connection — the address is ' + url, 'warning');
  }
  // A staged card's address is reserved, not yet answering — say so on the
  // gesture, because a pasted link that 404s is the one report this came from.
  const msg = (card && !card._imported) ? '✓ card address copied — it works once you publish' : '✓ card address copied';
  navigator.clipboard.writeText(url).then(
    () => toast(msg, 'success'),
    () => toast('Copy failed — the address is ' + url, 'warning'),
  );
}

// ---- retiring a PUBLISHED card ----
//
// The fourth tombstone, and the same argument as the first three. A composed
// card's id is its permanent address at /card/<id> from the moment it is
// published: a share link points at it, the sitemap lists it, and (chunk 7) a
// stamped share image is keyed by it. Deleting the record outright would free
// the id, and the next card minted could quietly answer someone's old link with
// different words and a different picture. So a published card RETIRES to a
// tombstone that keeps the id and nothing else, /card/<id> answers 410, and
// composedPick drops it so COMPOSED_MAX stays a budget of live cards.
//
// No R2 queue here, deliberately: a card owns no media. Its picture belongs to
// the archive photo, the wallpaper or the note it came from, and retiring a
// card must never take that down.
export function _cardRetire(id) {
  const card = _cardById(id);
  if (!card || card.retired) return;
  const named = (card.title || '').trim();
  if (!confirm(
    `RETIRE ${named ? `“${named}”` : 'this card'}?\n\n`
    + `This card is published, so its address /card/${card.id} stays reserved forever — `
    + `a link pointing at it will never quietly show a different card.\n\n`
    + `The slot goes back to filling itself, and the photo or note it came from is untouched. `
    + `↩ UNDO RETIRE puts it back until you leave this tab.`
  )) return;

  const ledgerRow = ledgerRowFor('cards', card.id);
  const tombstone = {
    id: card.id,
    order: Number(card.order) || 0,
    retired: true,
    retired_at: new Date().toISOString(),
  };
  if (card._imported) tombstone._imported = true;
  const index = _cards().indexOf(card);
  _cards()[index] = tombstone;

  _lastCardRetire = { id: card.id, card, index, ledgerRow };
  stageChange('cards', {
    id: card.id,
    label: `${named || 'Untitled card'} — homepage card retired`,
    kind: 'remove',
  });
  _recompact();
  save();
  toast('◼ retired — the address stays reserved', 'success');
  _focusComposed(null);
  _repaint();
}

let _lastCardRetire = null;

// Resolved against state as it is NOW, never against the memory — the chip must
// not be able to name a card that has since come back by another route (vision
// §2.4, layer 2: one chip, not a history).
export function _cardRetireUndoTarget() {
  if (!_lastCardRetire) return null;
  const current = _cardById(_lastCardRetire.id);
  if (!current || !current.retired) return null;
  // ...and there has to be somewhere to put it back. Retiring frees a place, so
  // the owner can compose into it before undoing — and restoring on top of that
  // would put a third card in a two-card budget, where the third is invisible
  // on the homepage (composedPick slices) but present in the studio. The chip
  // is resolved against state AS IT IS NOW precisely so it can be withdrawn
  // rather than become a button that has to refuse; _repinTarget takes the same
  // posture for the same reason.
  if (_composedCards().length >= COMPOSED_MAX) return null;
  return _lastCardRetire;
}

export function _cardUndoRetire() {
  const target = _cardRetireUndoTarget();
  if (!target) return;
  const i = _cards().findIndex((c) => c && c.id === target.id);
  if (i < 0) return;
  _cards()[i] = target.card;
  unstageChange('cards', target.id, target.ledgerRow);
  _lastCardRetire = null;
  _recompact();
  save();
  toast('✓ Retire undone — the card is back', 'success');
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

// ---- what this slot can be shared as ----
//
// One target builder for every kind the grid draws, so the SHARE block does not
// have to know what a slot is. Null is a real answer and the block reads it as
// "do not draw me": a pulse has no address at all, the automatic playlist is
// nobody's saved set, and a note that has never been staged has no `fn_id` yet.
//
// ⚠️ THE STEM RULES ARE THE EDGE'S, NOT THIS VIEW'S. A frame keys off its image
// basename and a note off its hero's — the historic keys, so nothing already
// stamped re-stamps — and only a note with no picture gets its own `fn-` stem.
// src/edge/chrome.js and worker.js are the authority; tests/share-keys.test.js
// holds the two spellings together.
export function _shareOf(slot) {
  const RI = engine();
  if (!slot || !slot.item || !RI || !RI.entryHref) return null;
  const item = slot.item;
  const data = item.data || {};
  // The card's name, for the one sentence a toast says about it. The tile's
  // placeholder is not a name — it is what a tile prints when there is nothing
  // to print — so it reads as "this card" here instead.
  // The placeholder skips the kicker too: "✓ Featured · COMPOSED — share images
  // stamped" names a category, not a card, which is no better than the em-dashes.
  const name = slot.title === UNTITLED ? 'this card'
    : (slot.title || slot.kicker || 'this card');
  const abs = (path) => (path ? location.origin + path : '');

  // `staged`: the address is minted now but answers only once the record is
  // published — the copy-link toast says so, because a link that 404s is the
  // one thing a share must not quietly hand out. `_imported` is the console's
  // own mark for "this came from the live data".
  if (slot.kind === 'composed') {
    const card = item.over || {};
    return shareTarget({
      item, stem: shareStem({ kind: 'card', id: card.id }),
      url: abs(RI.entryHref('composed', card)), name, staged: !card._imported,
    });
  }
  if (slot.kind === 'raw' || slot.kind === 'archive') {
    const base = String(data.filename || '').replace(/\.[^.]+$/, '');
    return shareTarget({
      item, stem: shareStem({ kind: 'frame', id: base }),
      url: abs(RI.entryHref(slot.kind, data)), name,
    });
  }
  if (slot.kind === 'text') {
    if (!data.fn_id) return null;          // never staged: no address to share
    const hero = RI.heroFilename(data);
    return shareTarget({
      item,
      stem: hero
        ? shareStem({ kind: 'frame', id: hero.replace(/\.[^.]+$/, '') })
        : shareStem({ kind: 'fn', id: data.fn_id }),
      url: abs(RI.entryHref('text', data)), name, staged: !data._imported,
    });
  }
  if (slot.kind === 'audio') {
    // A SET, when the card plays one — its own address and its own stem. The
    // automatic playlist is not a set: it is the shelf's featured list, which
    // has no address of its own and so nothing to stamp.
    const set = item.set || null;
    if (set && set.slug) {
      return shareTarget({
        item, stem: shareStem({ kind: 'set', id: set.slug }),
        url: abs(RI.entryHref('set', set)), name: set.name || set.slug, staged: !set._imported,
      });
    }
    if (data.isPlaylist || !data.slug) return null;
    return shareTarget({
      item, stem: shareStem({ kind: 'audio', id: data.slug }),
      url: abs(RI.entryHref('audio', data)), name, staged: !data._imported,
    });
  }
  return null;   // the pulse: live already, no page of its own, nothing to stamp
}

// The block, framed as one more instrument in the inspector. Empty markup when
// there is nothing to share, which collapses to no block rather than to a
// header over four dead buttons.
function shareHtml(slot, opts) {
  const target = _shareOf(slot);
  if (!target) return '';
  return controlBlock('SHARE', shareBlockBody(target, opts), {
    aside: shareBlockAside(target),
    note: shareBlockNote(target, opts),
  });
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
    // The studio as a SECOND FRONT DOOR on the shelf's featured list (chunk 5).
    // It is offered on the automatic audio slot as well as on a composed audio
    // card, because there is exactly one homepage list and this is a place the
    // owner is already looking at it.
    acts.push(`<button class="btn btn-full btn-stage" onclick="cardsChooseTracks()"
      title="Pick the tracks on the homepage card — the same list the Audio shelf edits">
      ♪ CHOOSE TRACKS</button>`);
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

  // ONE CHIP, NOT A HISTORY (vision §2.4, layer 2). Retiring is the one gesture
  // here whose reverse is not the same control still on screen — the card it
  // acted on is gone from the grid — so it earns a chip, resolved against state
  // as it is NOW so it can never be a dead button. Only on STAGED: LIVE is what
  // is published, and nothing there is undoable.
  const retired = actionable ? _cardRetireUndoTarget() : null;
  const undoRetire = retired
    ? `<button class="btn btn-sm btn-ghost cards-undo-retire" onclick="_cardUndoRetire()"
         title="Put the retired card back — until you publish">
         ↩ UNDO RETIRE</button>`
    : '';

  // The one way to ask the site again without leaving the view. Entering the
  // view already re-reads (renderCards), and every read revalidates; this is for
  // the minute after a publish, while Cloudflare is still building.
  const refresh = `<button class="btn btn-sm btn-ghost" onclick="cardsRefreshLive()"
       title="Read the published grid again — after a publish, once the build has landed">
       ↻ REFRESH LIVE</button>`;

  return `<header class="cards-head">
    <div class="cards-head-left">${modes}${sources}</div>
    <div class="cards-head-right">${refresh}${pill}${undoRetire}${compose}</div>
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
// `asideTone` colours the aside the way a tone badge is coloured (`live` is
// green, `staged` the accent) — the aside is TEXT and is escaped, so a caller
// that wants a badge asks for the tone rather than passing markup in.
function controlBlock(title, body, opts) {
  const { note, aside, asideId, asideTone } = opts || {};
  return `<section class="control-block">
    <header class="control-block-head">${escapeHTML(title)}
      ${aside ? `<span class="control-block-aside"${asideId ? ` id="${escapeHTML(asideId)}"` : ''}${asideTone ? ` data-tone="${escapeHTML(asideTone)}"` : ''}>${escapeHTML(aside)}</span>` : ''}</header>
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
  text: { default: 'Standard tile', hero: 'Hero forward', overlay: 'Words on the picture' },
  // `overlay` is the photo kind's only choice besides its one shape, so its
  // default needs a name here too — the picker only draws for a kind with two.
  photo: { default: 'Picture and caption', overlay: 'Words on the picture' },
  // A composed card's three words live in DRESSING_LABEL: they name (kind,
  // layout) PAIRS, not layouts, and dressingPickerHtml draws them.
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
  if (!RI || !slot || !slot.id || slot.composed) return '';
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

// ---- the dressing picker: the composed card's CARD LAYOUT block ----
//
// The same chips as the layout picker above, because it IS one: three dressings
// (kind + layout pairs, see cardsSetDressing) plus any further layout the
// engine registers for the kind the card resolves to — read off
// RecentIndex.cardLayouts, so chunk 3's `overlay` appears here the day it is
// registered and nothing in this function changes. A chip the card cannot wear
// is greyed, never hidden; the small word under each label is the engine's own
// name for what it writes, so the record is never a mystery.
function dressingPickerHtml(card) {
  const RI = engine();
  if (!RI || !card) return '';
  const kind = RI.composedKind(card);
  if (kind === 'audio') return '';
  const current = _dressingOf(card);
  const extra = ((RI.cardLayouts && RI.cardLayouts[kind]) || [])
    .filter((n) => n !== 'default' && n !== 'hero');
  const q = `'${escapeAttrJS(card.id)}'`;
  const chips = ['auto', 'picture', 'words'].concat(extra).map((key) => {
    const on = key === current;
    const target = _dressingTarget(card, key);
    const usable = !!target;
    const label = DRESSING_LABEL[key] || layoutLabel(kind, key);
    const name = !target ? '—'
      : `${target.kind || kind}${target.layout ? ` · ${target.layout}` : ''}`;
    const tip = !usable ? 'Needs a picture on the card before it can lead with one'
      : key === 'auto' ? 'The picture leads when there is one; the words when there is not'
        : key === 'picture' ? 'Lead with the picture, whatever else the card carries'
          : key === 'words' ? 'The words tile, picture or not — drop cap and all'
            : `Show this card as: ${label}`;
    return `<button class="layout-chip${on ? ' is-on' : ''}${usable ? '' : ' is-blocked'}"
      onclick="cardsSetDressing(${q},'${escapeAttrJS(key)}')"
      aria-pressed="${on ? 'true' : 'false'}" title="${escapeHTML(tip)}">
      <span class="layout-chip-label">${escapeHTML(label)}</span>
      <span class="layout-chip-name">${escapeHTML(name)}</span>
    </button>`;
  }).join('');
  return controlBlock('CARD LAYOUT', `<div class="layout-chips">${chips}</div>`, {
    aside: DRESSING_LABEL[current] || layoutLabel(kind, current),
    note: 'What the card IS stays fixed — this changes only how it is dressed. '
      + 'Automatic puts it back.',
  });
}

// ---- the AUDIO block: what this card plays ----
//
// Only ever drawn for a card the engine resolves to the audio kind. The two
// source chips are the same object as the dressing chips — a picker whose
// default is always on screen — and under them sits the one action that source
// implies. A set is chosen from a <select> rather than a chip row because the
// shelf's sets are unbounded and a rail is not.
function audioBlockHtml(card) {
  const RI = engine();
  if (!RI || !card || RI.composedKind(card) !== 'audio') return '';
  const q = `'${escapeAttrJS(card.id)}'`;
  const source = _audioSourceOf(card);
  const sets = _liveSets();
  const tracks = RI.composedTracks(card, STATE.audio || [], STATE.audioSets || []);
  const borrowed = RI.composedSet(card, STATE.audioSets || []);

  const chips = ['tracks', 'set'].map((key) => {
    const on = key === source;
    const usable = key === 'tracks' || sets.length > 0;
    const tip = key === 'tracks'
      ? 'The same tracks the automatic audio card plays — one list, edited here or on the shelf'
      : usable ? 'Borrow a set from the Audio shelf; the card keeps the set\'s own address'
        : 'Make a set on the Audio shelf first';
    return `<button class="layout-chip${on ? ' is-on' : ''}${usable ? '' : ' is-blocked'}"
      onclick="cardsSetAudioSource(${q},'${escapeAttrJS(key)}')"
      aria-pressed="${on ? 'true' : 'false'}" title="${escapeHTML(tip)}">
      <span class="layout-chip-label">${escapeHTML(AUDIO_SOURCE_LABEL[key])}</span>
      <span class="layout-chip-name">${key === 'tracks' ? 'featured' : 'set'}</span>
    </button>`;
  }).join('');

  const action = source === 'set'
    ? `<select class="composer-input" id="cards-set-pick"
         aria-label="The set this card plays"
         onchange="cardsPickSet(${q},this.value)">
         ${sets.map((set) => `<option value="${escapeHTML(set.slug)}"${set.slug === card.set ? ' selected' : ''}>
           ${escapeHTML(set.name || set.slug)}</option>`).join('')}
       </select>`
    : `<div class="action-dock">
         <button class="btn btn-full btn-ghost" onclick="cardsChooseTracks()"
           title="Pick the tracks on the homepage card — the same list the Audio shelf edits">
           ♪ CHOOSE TRACKS</button>
       </div>`;

  // What it actually plays, right now, resolved by the engine — so the rail and
  // the card cannot disagree about an empty set or a retired track.
  const names = tracks.map((t) => t.title || t.slug).join(' · ');
  const readout = tracks.length
    ? `<div class="cards-plays">${escapeHTML(names)}</div>`
    : `<div class="control-empty">${escapeHTML(source === 'set'
      ? (borrowed ? 'Every track in this set has been retired — it plays nothing.'
        : 'That set is not on the shelf any more.')
      : 'No tracks on the homepage card yet — choose some and this card plays them.')}</div>`;

  // The way back sits in the same block as the way in (composerRailHtml's
  // SOUND block) — reversibility layer 1, the reverse is the same affordance.
  const remove = `<div class="action-dock">
       <button class="btn btn-full btn-danger" onclick="cardsRemoveAudio(${q})"
         title="Stop this card playing audio — it goes back to its picture or its words">
         ✕ REMOVE AUDIO</button>
     </div>`;

  return controlBlock('WHAT THIS CARD PLAYS', `<div class="layout-chips">${chips}</div>${action}${readout}${remove}`, {
    aside: tracks.length ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}` : 'nothing yet',
    note: source === 'set'
      ? 'A set keeps its own address, so this card opens the set\'s page. Reorder it on the Audio shelf and the card follows.'
      : 'One list: change it here and the Audio shelf agrees, because there is only one homepage card.',
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

// The takeover button. Every slot has one now — the audio card was the last
// holdout, and chunk 5 gave it a seed that keeps its player (cardsEditSlot).
function takeoverHtml(slot, index, inGrid) {
  if (!slot) return '';
  return `<button class="btn ${inGrid ? 'btn-sm btn-stage grid-edit' : 'btn-stage'}" onclick="cardsEditSlot(${index})"
    title="Take this card over — write your own words on it">✎ EDIT THIS CARD</button>`;
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
    : (actionable && slot ? takeoverHtml(slot, index, true) : '');
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
//
// THE RENDERER'S OWN CARD, MADE EDITABLE — not a restatement of it (chunk 2,
// docs/cards-core-complete.md). buildCard draws the record exactly as the
// homepage will, and this function then marks the two text leaves the author
// types on: the headline and the tease on the words tile (`.wk-t-title`,
// `.wk-snip`), the caption pair on the picture shapes (`.wk-title` or the hero
// card's `.wk-t-title`, and `.wk-meta`). Everything else on the card — the
// kicker, the chip, the picture and its crop, the palette, the tier, the
// absence of a place-and-year line — is the engine's, so the composer and the
// live card cannot disagree about a card by construction.
//
// A FIELD CANNOT CARRY A CHILD ELEMENT. On the homepage the drop cap is a
// <span> and the caret is a <span>; on an editable leaf both are restated in
// CSS (`::first-letter`, `::after` — css/field-console.css, the composer
// block), the one place this card is a restatement rather than the real
// markup. The tease is shown whole, not the render-time excerpt: you cannot
// edit a truncation.
//
// The handlers are written out as literal `on…="…"` attributes so
// tests/inline-handlers.test.js can see the functions they call.
function composerCardHtml(card) {
  const RI = engine();
  if (!RI) return '';
  const node = RI.buildCard(RI.composedItem(card, STATE.audio || [], STATE.audioSets || []));
  // A takeover keeps its link, and the composer must not be one: the card is a
  // surface to type on here, not a way off the page (realCardHtml's rule).
  node.removeAttribute('href');
  node.setAttribute('role', 'article');
  node.id = 'composer-card';

  const shape = node.getAttribute('data-shape');
  const picture = shape === 'picture';
  // An AUDIO card writes its words in the same caption grammar the picture
  // shapes use (.wk-body > .wk-title / .wk-meta — §2.2), so it reaches for the
  // same two leaves. What it does NOT share is the body: audioCaption() omits
  // it entirely when nothing is typed, and a card you cannot type on is not a
  // composer. So the body is added here, exactly as the renderer would draw it
  // the moment there is a word — the same move the tease line already makes.
  const caption = picture || shape === 'audio';
  if (shape === 'audio' && !node.querySelector('.wk-body')) {
    const body = document.createElement('div');
    body.className = 'wk-body';
    // WHERE THE RENDERER PUTS IT, not merely somewhere on the card: under the
    // waveform, which on the playlist card means above the index's rule and on
    // the single card means above the foot. Inserted at the wrong one, the
    // author types the caption in a place it will not be when it publishes —
    // which a green suite cannot see and opening the page shows immediately.
    node.insertBefore(body, node.querySelector('.wk-pl-index') || node.querySelector('.wk-a-foot'));
  }
  const q = `'${escapeAttrJS(card.id)}'`;
  const cls = (el) => escapeHTML(el.className);
  const empty = (v) => (!(v || '').trim() ? ' data-empty=""' : '');

  let title = node.querySelector(caption ? '.wk-body .wk-title, .wk-body .wk-t-title' : '.wk-t-title');
  if (shape === 'audio' && !title) {
    title = document.createElement('div');
    title.className = 'wk-title';
    node.querySelector('.wk-body').appendChild(title);
  }
  if (title) {
    title.outerHTML = `<div class="${cls(title)}" id="composer-title" contenteditable="plaintext-only"
      role="textbox" aria-label="The card's headline" data-placeholder="Say it in a line"${empty(card.title)}
      oninput="cardsFieldInput(this,${q},'title')" onbeforeinput="cardsGuardTitle(event,${q})">${escapeHTML(card.title || '')}</div>`;
  }
  let tease = node.querySelector(caption ? '.wk-body .wk-meta' : '.wk-snip');
  if (caption && !tease) {
    // captionOf() draws no caption line for a card with no tease; the composer
    // needs the line to type the tease INTO, so it adds the one the renderer
    // will draw the moment there is a word — same class, same place.
    tease = document.createElement('div');
    tease.className = 'wk-meta';
    (node.querySelector('.wk-body') || node).appendChild(tease);
  }
  if (tease) {
    tease.outerHTML = `<div class="${cls(tease)}" id="composer-tease" contenteditable="plaintext-only"
      role="textbox" aria-label="The card's line underneath"
      data-placeholder="${caption ? 'A caption, if it wants one' : 'And a little more, if it needs it'}"${empty(card.tease)}
      oninput="cardsFieldInput(this,${q},'tease')">${escapeHTML(card.tease || '')}</div>`;
  }

  // The label echoes — the chip on the picture, the kicker's word on the words
  // tile — that _paintComposed moves as CARD BADGE is typed into.
  const tag = node.querySelector('.wk-tag');
  if (tag) tag.setAttribute('data-label-echo', '');
  const kicker = node.querySelector('.wk-kicker');
  if (kicker && kicker.lastChild && kicker.lastChild.nodeType === 3) {
    const echo = document.createElement('span');
    echo.setAttribute('data-label-echo', '');
    echo.textContent = kicker.lastChild.textContent;
    kicker.replaceChild(echo, kicker.lastChild);
  }
  return `<div class="card-face is-editing">${node.outerHTML}</div>`;
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

  // SOUND, right under PICTURE: the card can play audio instead, and the track
  // list is compiled here — in the picker modal — rather than on the Audio
  // shelf (owner, 2026-09-11). The cap is the engine's own, said out loud.
  const cap = RI ? RI.AUDIO_MAX_PLAYLIST : 6;
  const sound = controlBlock('SOUND', `<div class="action-dock">
      <button class="btn btn-full btn-ghost" onclick="cardsAddAudio(${q})"
        title="Make this the audio card and choose its tracks right here">
        ♪ ADD AUDIO</button>
    </div>`, {
    aside: 'none',
    note: `Turns this into an audio card and opens the track picker — browse and pick up to ${cap} tracks without leaving. Your picture and words are kept, so ✕ REMOVE AUDIO brings them straight back.`,
  });

  // An audio card's kicker already SAYS something — the kind's own word — so
  // leaving the badge empty falls back to that rather than to “Featured”
  // (recent-index.js badgeOf). The copy has to say which, or it is a small lie.
  const isAudio = _composedIsAudio(card);
  const badgeFallback = isAudio ? 'Audio' : 'Featured';
  const chip = controlBlock('CARD BADGE', `<input class="composer-input" type="text"
      value="${escapeHTML(card.label || '')}" placeholder="${escapeHTML(badgeFallback)}" maxlength="24"
      aria-label="The small label on the card"
      oninput="cardsSetText(${q},'label',this.value)">`, {
    aside: 'optional',
    note: isAudio
      ? 'The small label on the card (e.g. “Listen”, “Episode”, “Demo”). Leave empty and the card says what it is.'
      : 'The small label on the card (e.g. “Featured”, “Project”, “Journal”). Leave empty for “Featured”.',
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
          onclick="cardsSetPalette(${q},'${p.key}')">
          <span class="cards-swatch-pip"></span>
          <span class="cards-swatch-label">${escapeHTML(p.label)}</span>
        </button>`;
      }).join('')}
    </div>`, {
    aside: curPal.charAt(0).toUpperCase() + curPal.slice(1),
    asideId: 'cards-palette-name',
    note: 'Tints the card\u2019s ground and the little light beside its label. Default is your site\u2019s own theme.',
  });

  // Only when the card carries a link — a spawned card keeps the one it inherited,
  // and this both SHOWS that it still opens the source and lets the owner cut it
  // loose. A from-scratch card has none, so the block simply is not there.
  // Not on an audio card: its address follows what it plays (see cardsEditSlot),
  // so there is no seeded link to cut it loose from and the button would be one
  // that does nothing.
  // Has this card been published? Two blocks below read it — the address (which
  // becomes permanent on the first publish) and THIS SLOT (whose gesture stops
  // being a plain removal at the same moment) — and they are two faces of the
  // one fact, so it is asked once.
  const published = !!card._imported;

  // THE CARD'S OWN ADDRESS (chunk 6). Every composed card has one from the
  // moment it exists — `/card/<id>` — and it is spelled by the engine's own
  // entryHref so the studio and the grid can never disagree about it. Shown
  // read-only with a COPY, because the address is not something the owner
  // chooses: it is minted with the card and, once published, permanent.
  const addr = RI && RI.entryHref ? RI.entryHref('composed', card) : '';
  // LIVE or STAGED, said in the badge's own colours — the one thing the owner
  // asked this block to make plain: a copied link to a staged card does not
  // work until the card is published.
  const address = addr ? controlBlock('CARD ADDRESS', `
    <div class="cards-address">
      <code class="cards-address-path">${escapeHTML(addr)}</code>
      <button class="btn btn-sm btn-ghost" onclick="cardsCopyAddress(${q})"
        title="Copy this card's address">COPY</button>
    </div>`, {
    aside: published ? 'LIVE' : 'STAGED',
    asideTone: published ? 'live' : 'staged',
    note: published
      ? 'This card is published, so this address is permanent \u2014 it will never point at a different card.'
      : 'A page of its own. The link only works once you publish \u2014 the address is reserved on publish and permanent from then on.',
  }) : '';

  const target = _composedIsAudio(card) ? null : _linkTarget(card);
  const link = target ? controlBlock('LINK', `<div class="action-dock">
      <button class="btn btn-full btn-ghost" onclick="cardsClearLink(${q})"
        title="Cut this card loose from its source — it will point nowhere">
        ✕ MAKE FREE-FORM</button>
    </div>`, {
    aside: 'opens source',
    note: `Tapping the card opens ${escapeHTML(target.label)} \u2014 editing the words here never changes it.`,
  }) : '';

  const order = list.length > 1 ? controlBlock('ORDER', `<div class="action-dock">
      <button class="btn btn-full btn-ghost" onclick="cardsReorder(${q},'up')"
        ${at <= 0 ? 'disabled' : ''}>▲ MOVE EARLIER</button>
      <button class="btn btn-full btn-ghost" onclick="cardsReorder(${q},'down')"
        ${at >= list.length - 1 ? 'disabled' : ''}>▼ MOVE LATER</button>
    </div>`, { aside: `${at + 1} of ${list.length}` }) : '';

  // A PUBLISHED card cannot simply be removed — its address is spoken for — so
  // the button says what will actually happen. Same gesture, same place, same
  // one control: the difference is the card's own history, not a second
  // affordance the owner has to find.
  const reset = controlBlock('THIS SLOT', `<div class="action-dock">
      <button class="btn btn-full btn-danger" onclick="cardsResetToAuto(${q})"
        title="${published
          ? 'Retire this card — the slot fills itself again and the address stays reserved'
          : 'Remove this card — the slot goes back to filling itself'}">
        ${published ? '◼ RETIRE THIS CARD' : '↩ RESET TO AUTOMATIC'}</button>
    </div>`, {
    note: published
      ? 'The slot fills itself again. The address stays reserved forever, so an old link never lands on a different card.'
      : 'The slot fills itself again. Nothing is live until you publish, and \u21a9 RESTORE in the publish view brings the card back until then.',
  });

  // A picture on an audio card is not in this program (chunk 5's out-of-scope
  // line, noted as a possible future layout), so the audio card gets the block
  // that says what it plays where every other kind gets its picture.
  const audio = audioBlockHtml(card);

  // SHARE, directly under the address it shares. `showLink: false` because that
  // block is right there with the same string and the same COPY — the share
  // block carries its own address everywhere else, and here it would be the
  // second button in three inches copying one URL.
  //
  // ⚠️ THROUGH _slotOf → _shareOf, NOT a target built by hand. This composed the
  // target itself until a review caught the first thing to drift: an untitled
  // words card reads as "this card" here and as its own tease on the studio
  // rail, because two places were deciding what a card is called. The stem, the
  // address and the name are one builder now — the same one the grid's rail
  // uses — so the composer and the studio cannot disagree about a card they are
  // both looking at.
  const shareBlock = (() => {
    const item = RI && RI.composedItem
      ? RI.composedItem(card, STATE.audio || [], STATE.audioSets || [])
      : null;
    const target = item ? _shareOf(_slotOf(item)) : null;
    if (!target) return '';
    return controlBlock('SHARE', shareBlockBody(target, { showLink: false }), {
      aside: shareBlockAside(target),
      note: shareBlockNote(target, { showLink: false }),
    });
  })();

  return `<aside class="studio-rail">${audio || (picture + sound)}${chip}${palette}
    ${dressingPickerHtml(card)}${overlayBlockHtml(card)}${link}${address}${shareBlock}${order}${reset}</aside>`;
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
    // The one thing the live side can do: go to the card that publishes in
    // this one's place (cardsEditStaged). Everything else stays read-only.
    // SHARING IS THE ONE THING THE LIVE SIDE CAN DO, and it is here for exactly
    // that reason: a stamp and a copied link act on the card that is on the site
    // right now, so the live grid is where you would reach for them. It is not a
    // staged change and does not wait for publish — the block's own copy says
    // so, because a control on a read-only panel had better explain itself.
    return `<aside class="studio-rail">${status}${controlBlock('READ ONLY',
      `<div class="control-empty">This is your published homepage grid. Switch to STAGED at the top
        to customize cards or review upcoming changes.</div>
      <div class="action-dock">
        <button class="btn btn-full btn-stage" onclick="cardsEditStaged('${escapeAttrJS(slot.key)}')"
          title="Switch to STAGED with this same card focused">✎ EDIT THE STAGED CARD</button>
      </div>`)}${shareHtml(slot, { live: true })}</aside>`;
  }

  const acts = actionsHtml(slot);
  return `<aside class="studio-rail">${status}${layoutPickerHtml(slot)}
    ${acts ? controlBlock('ACTIONS', acts) : ''}${shareHtml(slot)}</aside>`;
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
    : 'This is the grid as it is published right now. Just published? Cloudflare takes about a '
      + 'minute to rebuild — ↻ REFRESH LIVE once it lands. Switch to STAGED to change what the '
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
           ${actionable && focused ? takeoverHtml(focused, _slotIndex, false) : ''}
           ${actionable ? undoChipsHtml() : ''}</div>
         ${railHtml(focused, marks[_slotIndex], actionable)}
       </div>`;

  const body = _mode === 'studio' ? studio
    : `<div class="cards-grid">${showing
        .map((s, i) => gridCellHtml(s, i, actionable ? marks[i] : '', actionable)).join('')}</div>`;

  // THE RAIL KEEPS ITS PLACE. Every gesture repaints the whole view, and the
  // rail and the stage are their own scrollers (css: .studio-rail / .studio-stage
  // overflow-y: auto) — so replacing them put both back at the top, and a chip
  // pressed in the FROST row three blocks down meant scrolling back to it after
  // every press (owner, 2026-09-11). Read the offsets off the old nodes, paint,
  // put them back on the new ones. A scroller that was not there stays wherever
  // the new one starts.
  const kept = ['.studio-rail', '.studio-stage']
    .map((sel) => [sel, host.querySelector(sel)])
    .filter(([, n]) => n && n.scrollTop > 0)
    .map(([sel, n]) => [sel, n.scrollTop]);

  host.innerHTML = `
    ${headHtml(pending, actionable)}
    ${ribbonHtml(showing, marks, actionable)}
    ${warn ? `<div class="cards-warn">${escapeHTML(warn)}</div>` : ''}
    <div class="cards-note">${escapeHTML(note)}</div>
    ${body}
    ${actionable ? reuseShelfHtml() : ''}`;

  for (const [sel, top] of kept) {
    const n = host.querySelector(sel);
    if (n) n.scrollTop = top;
  }
}

// Redraw after an action. Falls back to a full render if there is nothing
// cached — which cannot happen from a tile that is on screen, but an exported
// handler is reachable from anywhere and must not depend on that.
//
// Also the seam the share block repaints through (registerShareRepaint, wired
// in js/console/init.js): a stamp finishes inside share.js, which is below this
// module and cannot call up. Exported under its own name rather than as
// `_repaint` because the window bridge would then carry a name that reads like
// a private.
//
// ⚠️ NEVER A FIRST RENDER. The share sheet also opens from the Audio shelf and
// the field-note editor, where this view has never been drawn — and _repaint's
// fallback is renderCards(), which fetches seven sources. A stamp from another
// surface must not quietly cost the network a homepage load, so with no cache
// there is nothing on screen to repaint and this does nothing.
export function cardsRepaint() { if (_liveCache) _repaint(); }

// ↻ REFRESH LIVE — read the published grid again. renderCards() is the whole
// gesture (it always re-reads, and every read revalidates); the toast is so a
// press that changed nothing still says it looked.
export async function cardsRefreshLive() {
  await renderCards();
  toast('✓ live grid re-read from the site', 'info');
}

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

  // Records the shipped console wrote, and ghosts left by an earlier session,
  // before anything is drawn from them.
  _normalizeCards();
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
