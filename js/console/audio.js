// OAKLENS Field Console — audio.
//
// The Audio shelf: the ONE place a track exists, however it got here. Drop a
// file on the shelf or attach one inside a field note and it lands in the same
// registry (STATE.audio → data/audio.json), so there is never a second copy to
// keep in sync and the file is only ever stored once on R2.
//
// The waveform is measured HERE, once, at attach time — decodeAudioData over
// the file the author just picked, boiled down to PEAK_COUNT values that ride
// in the registry. That is what lets the public player draw a card without
// downloading a byte of audio. A browser that cannot decode the codec still
// gets a usable entry: duration comes off a probe <audio> element and the
// player falls back to its flat rail.
//
// Promote-to-card lives on every row rather than only here (see _audioPromote):
// the owner should never have to walk back to this shelf to feature something
// they just uploaded from somewhere else. The CARD still reads only the
// registry — the action travels, the data does not. Multiple tracks can be
// featured to form a playlist on the homepage audio card.
//
// The handlers below are called from inline on*= attributes in the rendered
// rows, which run in global scope, so every one of them must stay an exported
// function (see the asset-library header for what happens otherwise).

import { STATE, save, stageChange, unstageChange, ledgerRowFor, trashItem, sessionTrash,
  _pendingR2Deletes, cancelPendingDeleteForKeys } from '../console-state.js';
import { logEvent } from '../console-telemetry.js';
import { toast, escapeHTML, escapeAttrJS, hideOverlay } from './chrome.js';
import { todayISO, uid, cleanFilename } from './utils.js';
import { _enqueueUpload } from './upload.js';
import { fnInsertAtCursor } from './fn-editor.js';

// Must match js/audio-player.js PEAK_COUNT — one stored resolution serves every
// display variant, so this number only changes if BOTH sides change together.
const PEAK_COUNT = 96;

// Mirrors the server's ALLOWED_AUDIO_TYPES (src/api/assets.js). Kept as a
// suffix list because that is what a file picker actually hands back.
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i;
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;

// Above this, a visitor waits on the file rather than on the network. 48KB per
// second of audio is ~384kbps — comfortably above any sane compressed export,
// and about a quarter of what an uncompressed WAV costs (≈172KB/s for CD
// stereo). Everything under it plays as fast as the connection allows.
const HEAVY_BYTES_PER_SEC = 48 * 1024;

// ---- pure helpers ----

// "This will be slow to play, and here is the number" — said once, at attach
// time, because that is the only moment the author can do anything about it.
// Nothing is blocked: a heavy file is a choice, not an error, and the engine
// has no transcoder (deliberately — see docs/audio-card-vision.md). But a
// 1.4MB WAV holding eight seconds of audio is the difference between a card
// that plays instantly and one that makes the visitor wait, and until this
// nothing in the console said so. Returns '' when the file is fine.
export function audioWeightHint(bytes, seconds, filename) {
  const b = Number(bytes) || 0;
  const s = Number(seconds) || 0;
  if (b <= 0 || s <= 0) return '';                 // undecodable: no honest rate
  if (b / s <= HEAVY_BYTES_PER_SEC) return '';
  const mb = (b / 1024 / 1024).toFixed(1);
  const lossless = /\.(wav|flac|aiff?)$/i.test(String(filename || ''));
  return `⚠ ${mb}MB for ${Math.round(s)}s`
    + (lossless ? ' — an uncompressed file' : ' — a very high bitrate')
    + '. Visitors wait for every byte; exporting as MP3 plays far sooner.';
}

// A slug is the track's permanent address (/listen/?a=<slug>) and its handle in
// a post shortcode, so it must be URL-clean and must not collide. Exported for
// the test suite.
export function audioSlugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')      // drop a file extension
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'track';
}

// Collision-proof the slug against the registry. Renaming a track later must
// never silently steal another one's permalink, so `skipId` lets an edit keep
// its own slug.
export function audioUniqueSlug(base, existing, skipId) {
  const taken = new Set((existing || [])
    .filter((e) => e && e.id !== skipId && e.slug)
    .map((e) => e.slug));
  let slug = audioSlugify(base);
  if (!taken.has(slug)) return slug;
  for (let n = 2; n < 999; n++) {
    const next = `${slug}-${n}`;
    if (!taken.has(next)) return next;
  }
  return `${slug}-${Date.now()}`;
}

// Normalize measured samples to the loudest peak. Without this a quietly
// recorded voice memo draws a nearly flat line while a mastered track fills the
// card — the waveform would read as "how loud was this" rather than "what is
// its shape", which is not what it is for.
export function audioNormalizePeaks(peaks) {
  const list = (peaks || []).map((p) => (Number.isFinite(p) ? Math.abs(p) : 0));
  const max = list.reduce((m, p) => (p > m ? p : m), 0);
  if (max <= 0) return list.map(() => 0);
  return list.map((p) => Math.min(1, p / max));
}

export function audioPeaksToString(peaks) {
  return (peaks || []).map((p) => String(Math.round(p * 100) / 100)).join(',');
}

// ---- measurement ----

// Peak-per-bucket (not average): a transient that survives averaging is what
// makes a waveform look like the music rather than like a hill.
function _peaksFromBuffer(buf) {
  const ch = buf.getChannelData(0);
  const size = Math.max(1, Math.floor(ch.length / PEAK_COUNT));
  const peaks = [];
  for (let i = 0; i < PEAK_COUNT; i++) {
    const start = i * size;
    let peak = 0;
    for (let j = 0; j < size && start + j < ch.length; j++) {
      const v = Math.abs(ch[start + j]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  return audioNormalizePeaks(peaks);
}

// Duration without decoding — the fallback when a codec is not decodable in
// this browser (some .flac / .opus builds). Resolves 0 rather than rejecting:
// an entry with no duration is still a working track.
function _probeDuration(file) {
  return new Promise((resolve) => {
    let url;
    try { url = URL.createObjectURL(file); } catch { resolve(0); return; }
    const el = new Audio();
    const done = (d) => { try { URL.revokeObjectURL(url); } catch {} resolve(d); };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    el.src = url;
  });
}

export async function audioMeasure(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    let ctx = null;
    try {
      ctx = new Ctx();
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      return { peaks: _peaksFromBuffer(buf), duration: buf.duration || 0 };
    } catch (err) {
      logEvent(`◇ audio: could not decode ${file.name} for a waveform (${err.message}) — `
        + 'storing duration only', 'info');
    } finally {
      try { ctx && ctx.close && ctx.close(); } catch {}
    }
  }
  return { peaks: [], duration: await _probeDuration(file) };
}

// ---- ingest ----

// The single entry point for adding audio, wherever it came from. `insertInto`
// is the field-note path: after the track lands, drop its shortcode at the
// cursor so attaching from the editor is one gesture.
export async function audioAddFiles(files, opts) {
  const list = [...(files || [])];
  if (!list.length) return [];
  const options = opts || {};
  const added = [];

  for (const file of list) {
    if (!AUDIO_EXT_RE.test(file.name || '')) {
      toast(`✕ Not an audio file: ${file.name}`, 'error');
      continue;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      toast(`✕ ${file.name} is over 128MB`, 'error');
      continue;
    }

    const filename = cleanFilename(file.name);
    if (STATE.audio.some((a) => a.filename === filename)) {
      toast(`⚠ Already on the shelf: ${filename}`, 'error');
      continue;
    }
    // A trashed track is not on the shelf but still OWNS its R2 key, and its
    // deletion is armed until publish. Re-adding the same filename used to
    // overwrite that object and then have publish delete it. The upload path
    // now un-arms the delete (cancelPendingDeleteForKeys), so this is no longer
    // destructive — but silently resurrecting a file the author just threw away
    // is not what they asked for either. Point them at RESTORE, which brings
    // the metadata back too.
    if (sessionTrash.some((t) => t.surface === 'audio' && t.item.filename === filename)) {
      toast(`⚠ ${filename} is in the trash — use ↩ RESTORE to bring it back`, 'error');
      continue;
    }

    // Title defaults to the filename with its extension and separators tidied
    // — a sensible thing to publish if the author never opens the edit field.
    const guessTitle = String(file.name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Untitled';

    toast(`◇ Reading ${filename}…`, 'info');
    const { peaks, duration } = await audioMeasure(file);

    const heavy = audioWeightHint(file.size, duration, filename);
    if (heavy) toast(heavy, 'warning');

    const entry = {
      id: uid(),
      slug: audioUniqueSlug(guessTitle, STATE.audio),
      filename,
      title: guessTitle,
      sub: '',
      duration: Math.round(duration),
      peaks: audioPeaksToString(peaks),
      size: file.size,
      mime: file.type || '',
      featured: false,
      episode: false,
      download: false,
      added_at: todayISO(),
      _uploading: true,
    };
    STATE.audio.unshift(entry);
    save();

    // One canonical object — no variants to generate, which is why audio needs
    // none of the image pipeline.
    _enqueueUpload(entry.id, 'audio', [new File([file], `audio/${filename}`, { type: file.type })], filename);
    added.push(entry);

    if (options.insertInto) audioInsertShortcode(entry.slug);
  }

  renderAudio();
  if (!document.getElementById('audio-library-modal')?.classList.contains('hidden')) {
    renderAudioLibrary();
  }
  return added;
}

export function audioInsertShortcode(slug) {
  const textarea = document.getElementById('fn-body');
  if (!textarea) return;
  // Slug only. Everything else resolves from the registry at render time, so a
  // track renamed later is renamed in every post that ever embedded it.
  fnInsertAtCursor(textarea, `\n<div class="audio-embed" data-slug="${slug}"></div>\n`, '');
  toast('✓ Track inserted — drop another right below it for a tracklist', 'success');
}

// ---- row actions (called from inline on*= handlers) ----

export function _audioPromote(id) {
  const t = STATE.audio.find((a) => a.id === id);
  if (!t) return;
  if (t.featured) {
    t.featured = false;
    delete t.featured_order;
    const remaining = STATE.audio.filter((a) => a.featured)
      .sort((a, b) => (Number(a.featured_order) || 0) - (Number(b.featured_order) || 0));
    remaining.forEach((a, idx) => { a.featured_order = idx + 1; });
    // +1, NOT -1. STATE.staged counts UNPUBLISHED CHANGES, the way every other
    // surface in the console uses it — not how many tracks are on the card.
    // Read as a tally of featured tracks it decremented on the way out, so
    // taking a live card apart after a publish left the counter clamped at 0 by
    // bumpStage's Math.max: the console said NO PENDING CHANGES and publish
    // refused to run, and the card could not be removed from the site at all.
    stageChange('audio', { id: t.id, label: `${t.title || t.filename} — off the homepage card`, kind: 'feature' });
    toast('Removed from homepage card', 'info');
  } else {
    const currentFeatured = STATE.audio.filter((a) => a.featured);
    if (currentFeatured.length >= 6) {
      toast('⚠ Maximum 6 tracks on the homepage card', 'warning');
      return;
    }
    t.featured = true;
    t.featured_order = currentFeatured.length + 1;
    stageChange('audio', { id: t.id, label: `${t.title || t.filename} — on the homepage card`, kind: 'feature' });
    toast(currentFeatured.length === 0 ? '✓ Added to homepage card' : `✓ Added to homepage playlist (#${t.featured_order})`, 'success');
  }
  save();
  if (typeof renderAudio === 'function') renderAudio();
}

// What the last CLEAR CARD took down, so it can be put back. Layer 2 of the
// reversibility rule (CLAUDE.md): one chip naming what a displacing action
// pushed out — the `↩ RE-PIN` shape — not a history.
//
// ⚠️ Module memory, deliberately, NOT orphaned `featured_order` values left in
// the registry as a stateless marker. js/recent-index.js picks the card with
// `a.featured || a.featured_order`, so an order left behind would keep that
// track ON THE LIVE HOMEPAGE — the clear would not have cleared anything.
let _lastCardClear = null;

// Resolve the chip against the shelf AS IT IS NOW. A track that has since been
// deleted, trashed or re-featured is dropped, and when nothing restorable is
// left the chip disappears rather than becoming a button that does nothing.
export function _audioCardRestoreTarget() {
  if (!_lastCardClear || !_lastCardClear.length) return null;
  const live = _lastCardClear
    .filter(({ id }) => {
      const t = STATE.audio.find((a) => a.id === id);
      return t && !t.featured;
    })
    .sort((a, b) => (Number(a.featured_order) || 0) - (Number(b.featured_order) || 0));
  return live.length ? live : null;
}

export function _audioRestoreCard() {
  const target = _audioCardRestoreTarget();
  if (!target) return;
  // Re-feature THROUGH _audioPromote rather than by writing the flags back, so
  // the 6-track cap, the dense renumber and one staged gesture per track all
  // stay honest by construction. Ascending order, so the card comes back in the
  // sequence it went down in.
  target.forEach(({ id }) => _audioPromote(id));
  _lastCardClear = null;
  if (typeof renderAudio === 'function') renderAudio();
  toast(`✓ Homepage card restored (${target.length} track${target.length === 1 ? '' : 's'})`, 'success');
}

export function _audioClearCard() {
  const cleared = STATE.audio
    .filter((a) => a.featured)
    .map((a) => ({ id: a.id, featured_order: Number(a.featured_order) || 0 }));
  if (!cleared.length) return;

  const names = STATE.audio.filter((a) => a.featured)
    .map((a) => a.title || a.filename || 'Untitled').join(', ');
  // Single-track delete has always asked; clearing up to six tracks did not.
  if (!confirm(
    `Take ${cleared.length} track${cleared.length === 1 ? '' : 's'} off the homepage card?\n\n${names}\n\n` +
    'The tracks stay on the shelf. You can put the card back with ↩ RESTORE CARD until you leave this tab.'
  )) return;

  _lastCardClear = cleared;
  const clearedIds = cleared.map((c) => c.id);
  STATE.audio.forEach((a) => {
    a.featured = false;
    delete a.featured_order;
  });
  // One gesture, one staged change — see _audioPromote above for why this is
  // not `-count`. Every cleared track's id rides the one row: each of them
  // changed, so each needs sync protection.
  stageChange('audio', {
    ids: clearedIds,
    label: `homepage card cleared (${clearedIds.length} track${clearedIds.length === 1 ? '' : 's'})`,
    kind: 'feature',
  });
  save();
  if (typeof renderAudio === 'function') renderAudio();
  toast('Homepage audio card cleared — ↩ RESTORE CARD puts it back', 'info');
}

export function _audioToggleEpisode(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  entry.episode = !entry.episode;
  // Taking a track OUT of the feed is a change to publish, exactly like putting
  // one in — see _audioPromote above.
  stageChange('audio', { id: entry.id, label: `${entry.title || entry.filename} — ${entry.episode ? 'into' : 'out of'} the podcast feed` });
  save();
  renderAudio();
  // The distinction that matters: the feed is what podcast apps subscribe to,
  // so a loose sketch marked as an episode reaches every subscriber.
  toast(entry.episode ? '✓ In the podcast feed' : 'Removed from the podcast feed',
    entry.episode ? 'success' : 'warning');
}

export function _audioToggleDownload(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  entry.download = !entry.download;
  stageChange('audio', { id: entry.id, label: `${entry.title || entry.filename} — download link ${entry.download ? 'shown' : 'hidden'}` });
  save();
  renderAudio();
  toast(entry.download ? '✓ Download link shown' : 'Download link hidden',
    entry.download ? 'success' : 'warning');
}

// The last ✎ EDIT, kept so the gesture has a named reverse.
//
// The reversibility rule (CLAUDE.md) calls out this exact shape: *"a
// window.prompt that overwrites a field with no way back"*. Two prompts in a
// row, no confirm, no undo — type over a title, press OK, and what was there is
// gone. This is layer 2: ONE chip, not a history, resolved against the shelf as
// it is now.
//
// `ledgerRow` is the ledger row as it stood BEFORE the edit — a deep copy,
// because stageChange folds repeated gestures into an existing row (bumping
// `n`, overwriting `label`, letting the newest `kind` win). Deleting that row on
// undo would discard the item's earlier pending changes and un-protect it from
// the next sync. Snapshot, then hand it back.
let _lastAudioEdit = null;

/**
 * Resolve the undo chip live. It is offered only while the entry still exists
 * AND still holds exactly what the edit wrote — so a track that was trashed, or
 * edited again since, drops the chip instead of leaving a button that would
 * write two-edits-ago values over one-edit-ago values.
 */
export function _audioEditUndoTarget() {
  if (!_lastAudioEdit) return null;
  const entry = STATE.audio.find((a) => a.id === _lastAudioEdit.id);
  if (!entry) return null;
  const { after } = _lastAudioEdit;
  if (entry.title !== after.title || entry.sub !== after.sub || entry.slug !== after.slug) return null;
  return { entry, before: _lastAudioEdit.before };
}

export function _audioUndoEdit() {
  const target = _audioEditUndoTarget();
  if (!target) return;
  const { entry, before } = target;
  entry.title = before.title;
  entry.sub = before.sub;
  entry.slug = before.slug;
  // The exact reverse of the one gesture the edit staged, ledger row included.
  unstageChange('audio', entry.id, _lastAudioEdit.ledgerRow);
  _lastAudioEdit = null;
  save();
  renderAudio();
  toast('✓ Edit undone', 'success');
}

export function _audioEdit(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  const title = window.prompt('Title:', entry.title || '');
  if (title === null) return;
  const sub = window.prompt('Subtitle (artist, episode number, anything):', entry.sub || '');
  if (sub === null) return;

  // Captured before anything is written, and only kept if something actually
  // changed — an OK on an unedited prompt is not a gesture to offer an undo for.
  const before = { title: entry.title, sub: entry.sub, slug: entry.slug };
  const ledgerRow = ledgerRowFor('audio', entry.id);

  entry.title = title.trim() || entry.title;
  entry.sub = sub.trim();
  // The slug is the permanent address: once published, a share link and every
  // post shortcode point at it, so renaming the TITLE must not move the track.
  // A never-published entry has nothing pointing at it yet and can still be
  // re-slugged to match its new name.
  if (!entry._imported) {
    entry.slug = audioUniqueSlug(entry.title, STATE.audio, entry.id);
  }

  if (entry.title === before.title && entry.sub === before.sub && entry.slug === before.slug) {
    return;   // nothing changed: no stage, no chip, no toast claiming otherwise
  }

  _lastAudioEdit = {
    id: entry.id,
    before,
    after: { title: entry.title, sub: entry.sub, slug: entry.slug },
    ledgerRow,
  };
  stageChange('audio', { id: entry.id, label: `${entry.title || entry.filename} — details edited` });
  save();
  renderAudio();
  toast('✓ Updated — ↩ UNDO EDIT puts the old details back', 'success');
}

export function _audioInsert(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  audioInsertShortcode(entry.slug);
}

// ---- retiring a PUBLISHED track ----
//
// A slug is a track's permanent address. Once published, three things point at
// it and none of them are ours to break: a share link, every post shortcode
// carrying that slug, and the episode's <guid> in /podcast.xml — which is how
// every subscriber's app knows what it has already downloaded.
//
// Deleting the entry outright freed the slug for immediate reuse, and that is
// the quiet failure: name a new track the same thing and it takes the dead
// address. The old share link then plays DIFFERENT audio, and the new episode
// is invisible to everyone already subscribed, because its guid is one their
// app has seen. Nothing errors. Nothing looks wrong in the console.
//
// So a published track is RETIRED to a tombstone — `retired: true` plus the id
// and the slug, every display field stripped, the R2 object queued for delete.
// Exactly the dark-frame rule for buffer frames (manual §5.20), for exactly the
// same reason: the address outlives the media.
//
// The slug reservation costs nothing to enforce: the tombstone is still in
// STATE.audio, so audioUniqueSlug already counts its slug as taken, and it
// travels in data/audio.json so a second device knows too. Every public
// consumer already requires `filename`, so a tombstone is invisible on the site.
export function _audioRetire(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry || entry.retired) return;
  if (!confirm(
    `RETIRE "${entry.title || entry.filename}"?\n\n`
    + `This track is published, so its address /listen/?a=${entry.slug} stays reserved forever — `
    + `a share link or a post shortcode pointing at it will never quietly play something else, `
    + `and no future episode can reuse its podcast id.\n\n`
    + `The audio file is deleted from the CDN on the next publish. `
    + `↩ UNDO RETIRE puts it back until you leave this tab.`
  )) return;

  const ledgerRow = ledgerRowFor('audio', entry.id);
  const tombstone = {
    id: entry.id,
    slug: entry.slug,
    retired: true,
    retired_at: new Date().toISOString(),
  };
  if (entry._imported) tombstone._imported = true;   // still tracked as "on main"
  const index = STATE.audio.indexOf(entry);
  STATE.audio[index] = tombstone;

  // One canonical object per track — no derived variants to chase.
  const keys = entry.filename ? [`audio/${entry.filename}`] : [];
  if (keys.length) _pendingR2Deletes.push({ keys, surface: 'audio', entryId: entry.id });

  _lastAudioRetire = { id: entry.id, entry, index, ledgerRow, keys };
  stageChange('audio', {
    id: entry.id,
    label: `${entry.title || entry.filename || entry.slug} — retired`,
    kind: 'remove',
  });
  save();
  renderAudio();
  toast('◼ retired — the address stays reserved, media queued for delete', 'success');
}

// The last retire, for the layer-2 chip. Nothing is irreversible before
// publish: the R2 delete is only QUEUED, so putting the track back is a matter
// of un-arming it and restoring the entry.
let _lastAudioRetire = null;

export function _audioRetireUndoTarget() {
  if (!_lastAudioRetire) return null;
  const current = STATE.audio.find((a) => a.id === _lastAudioRetire.id);
  // Valid only while the tombstone is still exactly the tombstone we wrote.
  return (current && current.retired) ? _lastAudioRetire : null;
}

export function _audioUndoRetire() {
  const target = _audioRetireUndoTarget();
  if (!target) return;
  const i = STATE.audio.findIndex((a) => a.id === target.id);
  if (i < 0) return;
  STATE.audio[i] = target.entry;
  // The delete never fired — it was queued for the next publish — so un-arming
  // it is the whole reversal. Same primitive the re-upload path uses.
  if (target.keys.length) cancelPendingDeleteForKeys(target.keys);
  unstageChange('audio', target.id, target.ledgerRow);
  _lastAudioRetire = null;
  save();
  renderAudio();
  toast('✓ Retire undone — the track is back', 'success');
}

export function _audioDelete(id) {
  const entry = STATE.audio.find((a) => a.id === id);
  if (!entry) return;
  if (entry.retired) return;   // a tombstone has nothing left to delete
  // A published track keeps its address; a never-published one has nothing
  // pointing at it yet, so it goes to the trash and can come straight back.
  if (entry._imported) return _audioRetire(id);
  if (!confirm(`Move "${entry.title || entry.filename}" to trash?\n\nIts audio file is removed from the CDN on the next publish.`)) return;
  trashItem('audio', id);
}

// ---- render ----

function _fmtDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (!s) return '--:--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

function _fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (!b) return '';
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.round(b / 1024)}KB`;
}

// A miniature of the published waveform, drawn from the SAME stored peaks the
// public player uses — so what the shelf shows is literally what ships.
function _sparkline(peaksStr) {
  const peaks = String(peaksStr || '').split(',')
    .map((p) => parseFloat(p))
    .filter((p) => Number.isFinite(p));
  if (!peaks.length) return '<div class="aud-spark empty">// no waveform</div>';
  const step = Math.max(1, Math.floor(peaks.length / 40));
  const bars = [];
  for (let i = 0; i < peaks.length; i += step) {
    bars.push(`<span style="height:${Math.max(6, Math.round(peaks[i] * 100))}%"></span>`);
  }
  return `<div class="aud-spark">${bars.join('')}</div>`;
}

// ============================================================
// THE PODCAST FEED CARD
// ============================================================
//
// "Feed management… a way to get the feed links" — the owner's ask, and until
// now the only way to learn your feed was not submittable was a rejection
// email from Apple days later. This card says it here instead.
//
// Three facts, in the order you need them: WHERE the feed is, HOW MUCH is in
// it, and WHAT is still blocking a submission — naming the exact config key,
// because "add a category" is not actionable and `podcast.category` is.
//
// ⚠️ THE COPY BELOW IS THE SERVER'S CONTRACT, DUPLICATED. The readiness
// booleans come from GET /api/site/settings (src/shared/podcast.js), which is
// browser-unreachable as an import — the same duplication the ring card's
// discipline list carries. tests/podcast-console-card.test.js pins the two key
// sets together so neither can grow a member the other has never heard of.
//
// ⚠️ That endpoint is PUBLIC AND UNAUTHENTICATED and returns booleans only.
// Nothing here should ever start rendering a value from it.

const FEED_PATH = '/podcast.xml';

// ---- the beta label ----
//
// This card is honest about what a directory wants and silent about how much
// road the feed has actually seen. One short show has been through a real
// submission; that is not enough to promise anyone else a clean one. So the
// card says BETA next to its own name rather than letting a fork owner find
// out from a rejection email — the same reason the checklist exists at all.
//
// Scoped deliberately to the FEED. The player, the waveforms, the per-track
// addresses and the tracklists in posts are not beta and must not read as if
// they were; the label lives here, on the feed card, and nowhere else on the
// shelf.
//
// The address is the engine's issue tracker, not this instance's — it travels
// to every fork, and a fork owner's rejection message is the only way this
// label ever comes off. Mirrored in CHANGELOG.md and site.config.example.js.
const BETA_ISSUES = 'https://github.com/oaklensart/oaklens-os/issues';
const BETA_TITLE = 'The feed works and is valid RSS — but only one short show '
  + 'has been through a real directory submission so far.';
const BETA_NOTE = `<div class="aud-feed-note beta">🧪 <strong>Podcast publishing is in beta.</strong>
    The feed is valid and this checklist is accurate, but one short show has been through a real
    directory submission so far. Everything else on this shelf is not beta. If you send your feed
    to Apple, Spotify or Overcast, please say how it went at
    <a href="${BETA_ISSUES}" target="_blank" rel="noopener">${BETA_ISSUES.replace('https://', '')}</a>
    — paste the rejection in full if you got one.</div>`;

// Blocking first, then the ones worth having. `key` is what the owner types
// into site.config.js; `unlocks` is one plain sentence on why they would.
const FEED_CHECKS = [
  { flag: 'hasArtwork', blocking: true, key: 'podcast.image',
    unlocks: 'Square cover art, 1400px or larger. Every directory refuses a show without it.' },
  { flag: 'hasCategory', blocking: true, key: 'podcast.category',
    unlocks: 'One of Apple\'s fixed categories, spelled exactly. A missing or invented one is an instant rejection.' },
  { flag: 'hasOwnerEmail', blocking: true, key: 'podcast.owner.email',
    unlocks: 'Where Apple writes to you about the show. It travels in the feed, so anyone can read it — put one there only if you mean to.' },
  { flag: 'listenPage', blocking: true, key: 'pages.listen',
    unlocks: 'Every episode links back to /listen. Switched off, the feed keeps serving and every episode 404s in every subscriber\'s app.' },
  { flag: 'hasCopyright', blocking: false, key: 'podcast.copyright',
    unlocks: 'Your own claim on the recordings. Never written for you — it is a legal statement.' },
  { flag: 'hasLocked', blocking: false, key: 'podcast.locked',
    unlocks: 'Tells hosting platforms they may not import your show without asking you first. The reason to self-host, in one tag.' },
  { flag: 'hasFunding', blocking: false, key: 'podcast.funding.url',
    unlocks: 'Puts a support link inside the listener\'s podcast app, beside the play button.' },
];

// Set once at boot from applyInstancePosture (js/console/session.js, which sits
// above this module and may import it). null means "not read yet, or the fetch
// failed" — a state the card renders as an honest silence rather than as a
// clean bill of health.
let _feedReadiness = null;

export function applyPodcastPosture(readiness) {
  _feedReadiness = (readiness && typeof readiness === 'object') ? readiness : null;
  renderPodcastCard();
}

export function feedUrl() {
  return location.origin + FEED_PATH;
}

export function copyFeedUrl() {
  navigator.clipboard.writeText(feedUrl()).then(
    () => toast('✓ feed address copied', 'success'),
    () => toast('Copy failed — the address is ' + feedUrl(), 'warning'),
  );
}

export function renderPodcastCard() {
  const host = document.getElementById('audio-feed-card');
  if (!host) return;

  // Retired tombstones are reserved addresses, not tracks — they are in neither
  // number, or "1 of 4 tracks" would count things that cannot be played.
  const total = STATE.audio.filter((a) => !a.retired).length;
  const episodes = STATE.audio.filter((a) => a.episode && a.slug && a.filename).length;

  const url = feedUrl();
  const head = `<div class="aud-feed-head">
      <span class="aud-feed-tag">◉ PODCAST FEED</span>
      <span class="aud-feed-beta" title="${escapeHTML(BETA_TITLE)}">BETA</span>
      <a class="aud-feed-url" href="${escapeHTML(FEED_PATH)}" target="_blank" rel="noopener">${escapeHTML(url)}</a>
      <button class="btn btn-sm btn-ghost" onclick="copyFeedUrl()" title="Copy the feed address">⧉ COPY</button>
    </div>`;

  // No episodes is not a blocked submission — it is an empty show, and saying
  // so plainly beats a checklist of things to fix about a feed with nothing in
  // it. The ○ EPISODE button is named because that is the next gesture.
  if (!episodes) {
    host.innerHTML = `<div class="aud-feed">${head}
      <div class="aud-feed-note">No tracks are marked EPISODE yet, so the feed serves an empty show.
        ${total ? 'Press ○ EPISODE on any track below to put it in the feed.' : 'Drop a track above, then press ○ EPISODE on it.'}</div>
      ${BETA_NOTE}
    </div>`;
    return;
  }

  const count = `<div class="aud-feed-note">${episodes} of ${total} track${total === 1 ? '' : 's'}
    ${episodes === 1 ? 'is' : 'are'} in the feed — that is what a subscriber downloads.</div>`;

  // A failed settings read must not render as "everything is fine". Say what
  // is unknown and stop.
  if (!_feedReadiness) {
    host.innerHTML = `<div class="aud-feed">${head}${count}
      <div class="aud-feed-note dim">// could not read this site's config — reload to check what a directory still needs</div>
      ${BETA_NOTE}
    </div>`;
    return;
  }

  const rows = FEED_CHECKS.map((c) => {
    const ok = _feedReadiness[c.flag] === true;
    const mark = ok ? '✓' : (c.blocking ? '✕' : '·');
    const cls = ok ? 'ok' : (c.blocking ? 'blocked' : 'opt');
    return `<li class="aud-feed-check ${cls}">
      <span class="aud-feed-mark">${mark}</span>
      <code class="aud-feed-key">${escapeHTML(c.key)}</code>
      <span class="aud-feed-why">${escapeHTML(c.unlocks)}</span>
    </li>`;
  }).join('');

  const blocked = FEED_CHECKS.filter((c) => c.blocking && _feedReadiness[c.flag] !== true);
  const verdict = blocked.length
    ? `<div class="aud-feed-verdict blocked">Apple would reject this feed today — ${blocked.length} required
        ${blocked.length === 1 ? 'field is' : 'fields are'} missing. Edit site.config.js and deploy.</div>`
    : '<div class="aud-feed-verdict ok">Ready to submit — paste the address above into Apple Podcasts, Spotify or Overcast.</div>';

  host.innerHTML = `<div class="aud-feed">${head}${count}${verdict}
    <ul class="aud-feed-list">${rows}</ul>
    ${BETA_NOTE}
  </div>`;
}

export function renderAudio() {
  // Before the empty-shelf early return below: a site with no tracks still
  // wants to be told where its feed is and that nothing is in it.
  renderPodcastCard();

  const host = document.getElementById('audio-display');
  if (!host) return;

  // A tombstone is a reserved address, not a track: it holds no media, no
  // duration and nothing to play, so it is counted separately everywhere.
  const live = STATE.audio.filter((a) => !a.retired);
  const retired = STATE.audio.length - live.length;

  const count = document.getElementById('audio-count');
  if (count) count.textContent = live.length;
  const stats = document.getElementById('audio-stats');
  if (stats) {
    const total = live.reduce((n, a) => n + (a.duration || 0), 0);
    stats.textContent = live.length
      ? `${live.length} track${live.length === 1 ? '' : 's'} · ${_fmtDuration(total)}`
        + (retired ? ` · ${retired} retired` : '')
      : '— tracks';
  }

  if (!STATE.audio.length) {
    host.innerHTML = '<div class="empty-state">// NO AUDIO YET — DROP A TRACK, AN EPISODE, OR A VOICE MEMO ABOVE</div>';
    return;
  }

  const featured = STATE.audio.filter((a) => a.featured)
    .sort((a, b) => (Number(a.featured_order) || 0) - (Number(b.featured_order) || 0));

  // The restore chip is rendered wherever the banner is: beside CLEAR CARD when
  // a card is up (a clear-then-restore is one gesture away), and ALONE when the
  // card is empty but the last clear is still undoable. Resolved live, so it
  // vanishes the moment it stops being real.
  const restorable = _audioCardRestoreTarget();
  const restoreBtn = restorable
    ? `<button class="btn btn-sm btn-ghost" onclick="_audioRestoreCard()"
        title="Put the ${restorable.length} track${restorable.length === 1 ? '' : 's'} you just cleared back on the homepage card">↩ RESTORE CARD</button>`
    : '';

  let playlistBanner = '';
  if (!featured.length && restorable) {
    playlistBanner = `<div class="aud-playlist-banner">
      <div class="aud-pl-info">
        <span class="aud-pl-tag">☆ NO HOMEPAGE CARD</span>
        <span class="aud-pl-names">Cleared ${restorable.length} track${restorable.length === 1 ? '' : 's'} — restorable until you leave this tab</span>
      </div>
      <div class="aud-pl-actions">${restoreBtn}</div>
    </div>`;
  } else if (featured.length > 1) {
    playlistBanner = `<div class="aud-playlist-banner">
      <div class="aud-pl-info">
        <span class="aud-pl-tag">★ HOMEPAGE PLAYLIST</span>
        <span class="aud-pl-names">${featured.length} tracks pinned · ${escapeHTML(featured.map((t) => t.title || t.filename || 'Untitled').join(', '))}</span>
      </div>
      <div class="aud-pl-actions">
        <button class="btn btn-sm btn-ghost" onclick="_audioClearCard()">CLEAR CARD</button>${restoreBtn}
      </div>
    </div>`;
  } else if (featured.length === 1) {
    playlistBanner = `<div class="aud-playlist-banner">
      <div class="aud-pl-info">
        <span class="aud-pl-tag">★ HOMEPAGE CARD</span>
        <span class="aud-pl-names">Single track: "${escapeHTML(featured[0].title || featured[0].filename || 'Untitled')}"</span>
      </div>
      <div class="aud-pl-actions">
        <button class="btn btn-sm btn-ghost" onclick="_audioClearCard()">CLEAR CARD</button>${restoreBtn}
      </div>
    </div>`;
  }

  // Resolved once per render, against the shelf as it is now — the chip appears
  // on exactly the row whose details were last overwritten, and nowhere else.
  const undoTarget = _audioEditUndoTarget();

  const retireUndo = _audioRetireUndoTarget();

  const rows = STATE.audio.map((a) => {
    // The tombstone cell — inert, and deliberately visible. The owner should be
    // able to see that an address is spoken for; a reservation nothing shows is
    // a rule that surprises you later.
    if (a.retired) {
      return `<div class="aud-row aud-row-retired">
      <div class="aud-main">
        <div class="aud-title">// RETIRED<span class="aud-badge retired">ADDRESS RESERVED</span></div>
        <div class="aud-meta">${escapeHTML(`/listen/?a=${a.slug}`)}${a.retired_at ? ` · ${escapeHTML(a.retired_at.slice(0, 10))}` : ''}</div>
      </div>
      <div class="aud-actions">${retireUndo && retireUndo.id === a.id ? `
        <button class="btn btn-sm btn-ghost aud-undo" onclick="_audioUndoRetire()"
          title="Put this track back and cancel the queued file deletion">↩ UNDO RETIRE</button>` : ''}
      </div>
    </div>`;
    }
    const state = a._uploadError ? 'err' : a._uploading ? 'up' : '';
    const badge = a._uploadError ? '<span class="aud-badge err">✕ FAILED</span>'
      : a._uploading ? '<span class="aud-badge up">↑ UPLOADING</span>'
        : '';
    const meta = [_fmtDuration(a.duration), _fmtSize(a.size), a.slug].filter(Boolean).join(' · ');
    // There is ONE homepage card; these numbers are a track's position in its
    // playlist, not a card of its own. Labelling them "CARD #2" read as a
    // second card and confused what the button does.
    const cardLabel = a.featured
      ? (featured.length > 1 ? `★ TRACK #${a.featured_order || ''}` : '★ ON CARD')
      : '☆ CARD';

    return `<div class="aud-row ${state}">
      <div class="aud-main">
        <div class="aud-title">${escapeHTML(a.title || a.filename || 'Untitled')}${badge}</div>
        <div class="aud-sub">${escapeHTML(a.sub || '')}</div>
        ${_sparkline(a.peaks)}
        <div class="aud-meta">${escapeHTML(meta)}</div>
      </div>
      <div class="aud-actions">
        <button class="btn btn-sm ${a.featured ? 'btn-stage' : 'btn-ghost'}"
          onclick="_audioPromote('${escapeAttrJS(a.id)}')"
          title="Toggle on/off homepage audio card playlist">${cardLabel}</button>
        <button class="btn btn-sm ${a.episode ? 'btn-stage' : 'btn-ghost'}"
          onclick="_audioToggleEpisode('${escapeAttrJS(a.id)}')"
          title="Include this track in the podcast feed at /podcast.xml">${a.episode ? '◉ EPISODE' : '○ EPISODE'}</button>
        <button class="btn btn-sm ${a.download ? 'btn-stage' : 'btn-ghost'}"
          onclick="_audioToggleDownload('${escapeAttrJS(a.id)}')"
          title="Offer a download link on the track page">↓ DL</button>
        <button class="btn btn-sm btn-ghost" onclick="_audioInsert('${escapeAttrJS(a.id)}')"
          title="Insert into the open field note">✎ INSERT</button>
        <button class="btn btn-sm btn-ghost" onclick="_audioEdit('${escapeAttrJS(a.id)}')">✎ EDIT</button>${undoTarget && undoTarget.entry.id === a.id ? `
        <button class="btn btn-sm btn-ghost aud-undo" onclick="_audioUndoEdit()"
          title="Put back the title and subtitle this track had before your last edit">↩ UNDO EDIT</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="_audioDelete('${escapeAttrJS(a.id)}')">✕</button>
      </div>
    </div>`;
  }).join('');

  host.innerHTML = playlistBanner + rows;
}


// ============================================================
// AUDIO LIBRARY / PICKER MODAL
// ============================================================
let _audioLibCallback = null;
let _audioLibMultiSelect = false;
let _audioLibSelected = new Set(); // set of slugs in selection order
let _audioLibFilter = 'all';       // 'all' | 'tracks' | 'episodes' | 'card'
let _audioLibSortBy = 'recent';    // 'recent' | 'alpha'
let _audioLibSearch = '';
let _audioLibProbeAudio = null;
let _audioLibPlayingSlug = null;

export function _audioLibSetFilter(f) {
  _audioLibFilter = f;
  renderAudioLibrary();
}

export function _audioLibToggleSort() {
  _audioLibSortBy = _audioLibSortBy === 'recent' ? 'alpha' : 'recent';
  renderAudioLibrary();
}

let _audioLibSearchTimer = null;
export function _audioLibSearchDebounced() {
  clearTimeout(_audioLibSearchTimer);
  _audioLibSearchTimer = setTimeout(renderAudioLibrary, 150);
}

export function openAudioLibrary(callback, multiSelect = false) {
  _audioLibCallback = callback;
  _audioLibMultiSelect = !!multiSelect;
  _audioLibSelected = new Set();
  _audioLibFilter = 'all';
  _audioLibSortBy = 'recent';
  _audioLibSearch = '';
  _audioLibPlayingSlug = null;
  if (_audioLibProbeAudio) {
    try { _audioLibProbeAudio.pause(); } catch {}
    _audioLibProbeAudio = null;
  }
  const ov = document.getElementById('audio-library-modal');
  if (ov) {
    ov.classList.remove('hidden', 'closing');
    renderAudioLibrary();
    if (matchMedia('(pointer: fine)').matches) {
      setTimeout(() => {
        const s = document.getElementById('audio-lib-search');
        if (s) s.focus();
      }, 100);
    }
  }
}

export function closeAudioLibrary() {
  hideOverlay('audio-library-modal');
  if (_audioLibProbeAudio) {
    try { _audioLibProbeAudio.pause(); } catch {}
    _audioLibProbeAudio = null;
  }
  _audioLibCallback = null;
  _audioLibMultiSelect = false;
  _audioLibSelected = new Set();
}

// ESC closes audio library modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('audio-library-modal')?.classList.contains('hidden')) {
    e.preventDefault();
    e.stopPropagation();
    closeAudioLibrary();
  }
}, true);

export function renderAudioLibrary() {
  const toolbar = document.getElementById('audio-lib-toolbar');
  const listEl = document.getElementById('audio-lib-list');
  const emptyEl = document.getElementById('audio-lib-empty');
  if (!toolbar || !listEl || !emptyEl) return;

  const prevSearch = document.getElementById('audio-lib-search');
  const searchVal = prevSearch?.value || '';
  const searchWasFocused = document.activeElement === prevSearch;
  const caretPos = prevSearch ? prevSearch.selectionStart : null;

  toolbar.innerHTML = `
    <button class="audio-lib-pill${_audioLibFilter === 'all' ? ' active' : ''}" onclick="_audioLibSetFilter('all')">ALL (${(STATE.audio || []).filter((a) => a.filename && a.slug).length})</button>
    <button class="audio-lib-pill${_audioLibFilter === 'card' ? ' active' : ''}" onclick="_audioLibSetFilter('card')">ON CARD</button>
    <button class="audio-lib-pill${_audioLibFilter === 'episodes' ? ' active' : ''}" onclick="_audioLibSetFilter('episodes')">EPISODES</button>
    <input class="audio-lib-search" id="audio-lib-search" placeholder="search audio…"
      value="${escapeHTML(searchVal)}"
      oninput="_audioLibSearchDebounced()">
    <button class="audio-lib-sort" onclick="_audioLibToggleSort()">
      ${_audioLibSortBy === 'recent' ? '↓ RECENT' : '↓ A-Z'}
    </button>
    <button class="btn btn-sm btn-stage audio-lib-upload-btn" onclick="_audioLibUploadTrigger()">+ UPLOAD</button>
  `;

  if (searchWasFocused) {
    const newSearch = document.getElementById('audio-lib-search');
    if (newSearch) {
      newSearch.focus();
      const pos = caretPos == null ? newSearch.value.length : caretPos;
      try { newSearch.setSelectionRange(pos, pos); } catch {}
    }
  }

  // `a.filename` already excludes retired tombstones — they hold a reserved
  // address and no media, so there is nothing to insert or play.
  let items = (STATE.audio || []).filter((a) => !a._uploadError && a.filename && a.slug);

  if (_audioLibFilter === 'card') {
    items = items.filter((a) => a.featured);
  } else if (_audioLibFilter === 'episodes') {
    items = items.filter((a) => a.episode);
  }

  const query = searchVal.toLowerCase().trim();
  if (query) {
    items = items.filter((a) =>
      (a.title || '').toLowerCase().includes(query) ||
      (a.sub || '').toLowerCase().includes(query) ||
      (a.filename || '').toLowerCase().includes(query) ||
      (a.slug || '').toLowerCase().includes(query)
    );
  }

  if (_audioLibSortBy === 'recent') {
    items.sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')));
  } else {
    items.sort((a, b) => String(a.title || a.filename).localeCompare(String(b.title || b.filename)));
  }

  _audioLibUpdateInsertBar();

  if (!items.length) {
    listEl.innerHTML = '';
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.innerHTML = `<div class="audio-lib-empty">// NO AUDIO TRACKS FOUND${query ? ' FOR "' + escapeHTML(query.toUpperCase()) + '"' : ''}</div>`;
    return;
  }

  listEl.style.display = 'flex';
  emptyEl.style.display = 'none';

  const selOrder = [..._audioLibSelected];

  listEl.innerHTML = items.map((track) => {
    const selIdx = selOrder.indexOf(track.slug);
    const isSel = selIdx >= 0;
    const isPlaying = _audioLibPlayingSlug === track.slug;

    return `<div class="audio-lib-item${isSel ? ' selected' : ''}" data-slug="${escapeHTML(track.slug)}" onclick="_audioLibItemClick('${escapeAttrJS(track.slug)}')">
      <div class="aud-lib-col-play">
        <button type="button" class="aud-lib-play-btn" onclick="event.stopPropagation(); _audioLibProbePlay('${escapeAttrJS(track.slug)}', '${escapeAttrJS(track.filename)}')">
          ${isPlaying ? '⏸' : '▶'}
        </button>
      </div>
      <div class="aud-lib-col-main">
        <div class="aud-lib-title">${escapeHTML(track.title || track.filename)}</div>
        <div class="aud-lib-sub">${escapeHTML(track.sub || '')}</div>
        ${_sparkline(track.peaks)}
        <div class="aud-lib-meta">${_fmtDuration(track.duration)} · ${_fmtSize(track.size)} · ${escapeHTML(track.slug)}</div>
      </div>
      <div class="aud-lib-col-select">
        ${_audioLibMultiSelect
          ? (isSel ? `<div class="audio-lib-select-badge">${selIdx + 1}</div>` : '<div class="audio-lib-select-check">○</div>')
          : '<button class="btn btn-sm btn-ghost">INSERT →</button>'}
      </div>
    </div>`;
  }).join('');
}

export function _audioLibItemClick(slug) {
  if (_audioLibMultiSelect) _audioLibToggleSelect(slug);
  else _audioLibPickTrack(slug);
}

export function _audioLibToggleSelect(slug) {
  if (_audioLibSelected.has(slug)) _audioLibSelected.delete(slug);
  else _audioLibSelected.add(slug);
  _audioLibRefreshSelection();
}

export function _audioLibRefreshSelection() {
  const order = [..._audioLibSelected];
  document.querySelectorAll('#audio-lib-list .audio-lib-item').forEach((item) => {
    const idx = order.indexOf(item.dataset.slug);
    const selCol = item.querySelector('.aud-lib-col-select');
    if (idx >= 0) {
      item.classList.add('selected');
      if (selCol) selCol.innerHTML = `<div class="audio-lib-select-badge">${idx + 1}</div>`;
    } else {
      item.classList.remove('selected');
      if (selCol) selCol.innerHTML = '<div class="audio-lib-select-check">○</div>';
    }
  });
  _audioLibUpdateInsertBar();
}

export function _audioLibUpdateInsertBar() {
  const bar = document.getElementById('audio-lib-insert-bar');
  if (!bar) return;
  if (!_audioLibMultiSelect) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  const count = _audioLibSelected.size;
  const dis = count ? '' : 'disabled';
  bar.style.display = 'flex';
  bar.innerHTML = `
    <span class="audio-lib-insert-count">${count} TRACK${count !== 1 ? 'S' : ''} SELECTED</span>
    <button class="btn btn-sm btn-ghost" onclick="_audioLibClearSelection()" ${dis}>CLEAR</button>
    <button class="btn btn-sm btn-stage" onclick="_audioLibInsertSelected()" ${dis}>
      ${count > 1 ? 'INSERT TRACKLIST' : 'INSERT TRACK'}
    </button>
  `;
}

export function _audioLibClearSelection() {
  _audioLibSelected.clear();
  _audioLibRefreshSelection();
}

export function _audioLibInsertSelected() {
  const slugs = [..._audioLibSelected];
  if (!slugs.length) { toast('no tracks selected', 'error'); return; }
  const tracks = slugs.map((s) => STATE.audio.find((a) => a.slug === s)).filter(Boolean);
  if (_audioLibCallback) {
    _audioLibCallback(tracks);
  } else {
    const textarea = document.getElementById('fn-body');
    if (textarea) {
      const shortcodes = tracks.map((t) => `<div class="audio-embed" data-slug="${t.slug}"></div>`).join('\n');
      fnInsertAtCursor(textarea, `\n${shortcodes}\n`, '');
      toast(tracks.length > 1 ? `✓ Inserted tracklist: ${tracks.length} tracks` : '✓ Track inserted', 'success');
    }
  }
  closeAudioLibrary();
}

export function _audioLibPickTrack(slug) {
  const track = STATE.audio.find((a) => a.slug === slug);
  if (!track) return;
  if (_audioLibCallback) {
    _audioLibCallback(track);
  } else {
    audioInsertShortcode(track.slug);
  }
  closeAudioLibrary();
}

export function _audioLibUploadTrigger() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac';
  input.multiple = true;
  input.addEventListener('change', async () => {
    if (input.files && input.files.length) {
      const added = await audioAddFiles(input.files, { insertInto: false });
      if (added && added.length) {
        added.forEach((t) => _audioLibSelected.add(t.slug));
        renderAudioLibrary();
      }
    }
  });
  input.click();
}

export function _audioLibProbePlay(slug, filename) {
  if (_audioLibPlayingSlug === slug && _audioLibProbeAudio) {
    _audioLibProbeAudio.pause();
    _audioLibPlayingSlug = null;
    renderAudioLibrary();
    return;
  }
  if (_audioLibProbeAudio) {
    try { _audioLibProbeAudio.pause(); } catch {}
  }
  const root = (document.querySelector('meta[name="cdn-base"]')?.content || (location.origin + '/api/cdn')).replace(/\/+$/, '');
  const url = `${root}/audio/${encodeURIComponent(filename)}`;
  _audioLibProbeAudio = new Audio(url);
  _audioLibPlayingSlug = slug;
  _audioLibProbeAudio.addEventListener('ended', () => {
    if (_audioLibPlayingSlug === slug) {
      _audioLibPlayingSlug = null;
      renderAudioLibrary();
    }
  });
  _audioLibProbeAudio.play().catch((err) => {
    if (err && err.name === 'AbortError') return;
    if (_audioLibPlayingSlug === slug) {
      toast('Preview audio could not be played', 'error');
      _audioLibPlayingSlug = null;
      renderAudioLibrary();
    }
  });
  renderAudioLibrary();
}

// The FN editor's "attach audio" button. Opens the audio library modal so the
// author can choose from existing tracks or upload new ones.
export function fnAttachAudio() {
  openAudioLibrary((selected) => {
    const textarea = document.getElementById('fn-body');
    if (!textarea) return;
    if (Array.isArray(selected)) {
      const shortcodes = selected.map((t) => `<div class="audio-embed" data-slug="${t.slug}"></div>`).join('\n');
      fnInsertAtCursor(textarea, `\n${shortcodes}\n`, '');
      toast(selected.length > 1 ? `✓ Inserted tracklist: ${selected.length} tracks` : '✓ Track inserted', 'success');
    } else if (selected && selected.slug) {
      fnInsertAtCursor(textarea, `\n<div class="audio-embed" data-slug="${selected.slug}"></div>\n`, '');
      toast('✓ Track inserted', 'success');
    }
  }, true);
}
