// OAKLENS Field Console — send it out (K67).
//
// The site is where a piece lives first; the platforms are where it is
// announced. This is the drawer for the second step, opened from the Bridge
// on the newest piece that has an address (a published note, an archive
// photograph, a frame on the light table). The owner, 2026-10-06: "You
// publish to ground you own first, then push to the platforms, never the
// reverse." Three things, in the order they are used:
//
//   1. HOW IT UNFURLS. The page itself is read, the way a link preview reads
//      it: its og:/twitter: tags exactly as the edge injected them, and its
//      picture actually loaded. Drawn three ways (iMessage, Bluesky, X), with
//      a plain verdict per tag, and a STAMP when the picture is missing.
//   2. THE POST. The words and the full page address (the owner's call: no
//      short links on the apex), counted the way each platform counts:
//      Bluesky in graphemes (300), X in its weighting, where any link is 23.
//   3. THE STORY CARD. The 1080 × 1920 card with a QR home and the address
//      under it, inside the band a story's chrome leaves clear.
//
// It reuses the share layer for everything a share already knows (the target,
// the stamp) and adds nothing to the edge: no route, no CSP change. The
// console is the site's own origin, so reading a page is a plain fetch.

import { STATE } from '../console-state.js';
import { toast, escapeHTML, openSheet, closeSheet, copyText, hideOverlay } from './chrome.js';
import { cdnThumb } from './assets.js';
import { paintCard, shareStem } from './card-paint.js';
import { shareTarget, shareStampImages, shareIsStamped, canvasBlob, shareFileName } from './share.js';
import { getBufferFrameNumbers } from './fn-editor.js';

const $ = (id) => document.getElementById(id);
const RI = () => (typeof window !== 'undefined' && window.RecentIndex) || null;
const dateOf = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
const base = (filename) => String(filename || '').replace(/\.[^.]+$/, '');

// ---- what to send ----

/**
 * Every live piece that has an address, newest first: a published note (it
 * has an fn_id and is on main), an archive photograph, a light-table frame, a
 * track (K81, the ship station: anything can go out, not only the newest). A
 * pulse has no page, and a draft or a staged entry is not live yet.
 */
export function addressablePieces(state = STATE) {
  // "Live" is read the way the Bridge's days-since reads it (bridge.js
  // lastLive): what a sync marked as on main (`_imported`), or, on a surface
  // no sync has marked yet, everything published there.
  const live = (list, ok) => {
    const all = (list || []).filter((e) => e && ok(e));
    return all.some((e) => e._imported) ? all.filter((e) => e._imported) : all;
  };
  const pieces = [];
  for (const p of live(state.posts, (p) => p.fn_id && (!p.status || p.status === 'published'))) {
    pieces.push({ kind: 'text', entry: p, at: dateOf(p.added_at || p.date), title: p.title || p.fn_id });
  }
  for (const a of live(state.archive, (a) => a.slug && !a.retired)) {
    pieces.push({ kind: 'archive', entry: a, at: dateOf(a.added_at), title: a.title || a.slug });
  }
  // A frame has no title of its own; it is called by its permanent number.
  const frames = live(state.buffer, (f) => !f.dark && f.filename);
  const nums = frames.length ? getBufferFrameNumbers() : new Map();
  for (const f of frames) {
    const n = nums.get(f.id);
    pieces.push({ kind: 'raw', entry: f, num: n || 0, at: dateOf(f.published_at || f.added_at), title: f.title || (n ? `Frame f#${n}` : 'A frame') });
  }
  // A track's address is its slug on /listen (recent-index.js listenHref).
  for (const t of live(state.audio, (t) => t.slug && !t.retired)) {
    pieces.push({ kind: 'audio', entry: t, at: dateOf(t.added_at), title: t.title || t.slug });
  }
  pieces.sort((x, y) => y.at - x.at);
  return pieces;
}

/** The newest of them, the one the slot sends with a single tap. */
export function latestAddressable(state = STATE) {
  return addressablePieces(state)[0] || null;
}

/** The share target for a piece: the card the homepage would draw, its stamp's
 *  stem (the edge's own spelling) and its full address on this site. */
export function sendOutTarget(piece) {
  const ri = RI();
  if (!piece || !ri) return null;
  const card = _cardOf(piece, ri);
  const path = ri.entryHref(piece.kind, piece.entry);
  if (!path) return null;
  return shareTarget({ ...card, url: location.origin + path, name: piece.title });
}

/** The card a piece is drawn as, and its stamp's stem. */
function _cardOf(piece, ri = RI()) {
  const { kind, entry } = piece;
  let item, stem;
  if (kind === 'audio') {
    // The card the Audio shelf shares (audio.js _audioShare): the waveform,
    // with the player's own play mark on it (card-paint.js drawAudioCard).
    item = { kind: 'audio', data: entry };
    stem = shareStem({ kind: 'audio', id: entry.slug });
  } else if (kind === 'text') {
    const hero = ri && ri.heroFilename ? ri.heroFilename(entry) : '';
    item = { kind: 'text', data: hero ? { ...entry, card: { layout: 'hero' } } : entry };
    stem = hero ? shareStem({ kind: 'frame', id: base(hero) }) : shareStem({ kind: 'fn', id: entry.fn_id });
  } else {
    // The homepage draws a photograph and a frame as one kind, `photo`, a
    // frame flagged raw and carrying its number (the shape focal.js hands the
    // painter); `kind` stays the address's ('archive' or 'raw').
    item = kind === 'raw'
      ? { kind: 'photo', data: { ...entry, num: piece.num }, raw: true }
      : { kind: 'photo', data: entry };
    stem = shareStem({ kind: 'frame', id: base(entry.filename) });
  }
  return { item, stem };
}

// ---- counting, the way each platform counts ----

/** Graphemes, as Bluesky counts them (an emoji with its modifiers is one). */
export function graphemes(text) {
  const s = String(text || '');
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) n++;
    return n;
  }
  return [...s].length;
}

/**
 * X's weighting: every link is 23 whatever its length; a character from the
 * wide scripts and emoji counts 2, the rest 1.
 */
export function xWeight(text) {
  const URL_RE = /https?:\/\/\S+/g;
  const s = String(text || '');
  const links = s.match(URL_RE) || [];
  let n = links.length * 23;
  for (const ch of s.replace(URL_RE, '')) {
    const cp = ch.codePointAt(0);
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

export const LIMITS = { bluesky: 300, x: 280 };

/** The words a post starts from: the title, then the address on its own line. */
export function postText(target) {
  return target ? `${target.name}\n\n${target.url}` : '';
}

// ---- reading the page as a link preview does ----

/** The og:/twitter: tags of an HTML document, as a map. */
export function unfurlTags(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const out = {};
  for (const m of doc.querySelectorAll('meta[property], meta[name]')) {
    const key = (m.getAttribute('property') || m.getAttribute('name') || '').trim();
    if (/^(og|twitter):/.test(key) && !(key in out)) out[key] = (m.getAttribute('content') || '').trim();
  }
  if (!out['og:title']) out['og:title'] = (doc.querySelector('title')?.textContent || '').trim();
  return out;
}

/** What a preview needs, and whether it has it. */
export function unfurlVerdict(tags, image) {
  const lines = [];
  lines.push(tags['og:title'] ? ['ok', 'Title', tags['og:title']] : ['bad', 'Title', 'none — a preview shows the bare address']);
  lines.push(tags['og:description'] ? ['ok', 'Description', tags['og:description']] : ['warn', 'Description', 'none — the title stands alone']);
  if (!tags['og:image']) lines.push(['bad', 'Picture', 'none — stamp the share images and it will unfurl with the card']);
  else if (image && image.ok) lines.push(['ok', 'Picture', `${image.w} × ${image.h}${image.w < 600 ? ' — small; some apps show it as a thumbnail' : ''}`]);
  else if (image) lines.push(['bad', 'Picture', 'the page names one, but it does not load']);
  lines.push(tags['twitter:card'] === 'summary_large_image' ? ['ok', 'X card', 'large picture'] : ['warn', 'X card', tags['twitter:card'] ? `${tags['twitter:card']} — a small one` : 'none — X shows a plain link']);
  return lines;
}

function _loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight, src });
    img.onerror = () => resolve({ ok: false, src });
    img.src = src;
  });
}

async function _inspect(url) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(`the page answered ${res.status}`);
  const tags = unfurlTags(await res.text());
  const image = await _loadImage(tags['og:image']);
  return { tags, image };
}

// ---- the drawer ----

let _target = null;
let _story = null;   // the painted story card, kept for its download

/** Open the drawer on a piece: the one chosen at the station, or with none
 *  (the slot itself) the newest. */
export function sendOutOpen(piece) {
  const t = sendOutTarget(piece && piece.entry ? piece : latestAddressable());
  if (!t) return toast('Nothing live with an address yet: publish a note or a photograph first', 'warning');
  _target = t;
  _story = null;
  _render();
  openSheet('sendout-sheet');
  _check();
  _paintStory();
}

export function sendOutClose() {
  _target = null;
  closeSheet('sendout-sheet');
}

function _host(url) { try { return new URL(url).host; } catch { return ''; } }

function _render() {
  const t = _target;
  const body = $('sendout-body');
  if (!t || !body) return;
  $('sendout-title').textContent = `Send it out — ${t.name}`;
  const text = postText(t);
  body.innerHTML = `
    <section class="so-part">
      <div class="so-h">How it unfurls</div>
      <div class="so-unfurls" id="so-unfurls"><div class="so-note">Reading the page…</div></div>
      <ul class="so-verdict" id="so-verdict"></ul>
    </section>
    <section class="so-part">
      <div class="so-h">The post</div>
      <textarea class="so-text" id="so-text" rows="4" oninput="sendOutCount()">${escapeHTML(text)}</textarea>
      <div class="so-counts" id="so-counts"></div>
      <div class="so-keys">
        <button type="button" class="btn btn-sm" onclick="sendOutCopyText()">⧉ Copy the post</button>
        <button type="button" class="btn btn-sm" onclick="sendOutCopyLink()">⧉ Copy the link</button>
      </div>
    </section>
    <section class="so-part">
      <div class="so-h">Story card <span class="so-note">1080 × 1920</span>
        <button type="button" class="so-switch" id="so-qr" role="switch" aria-checked="${_qrOn() ? 'true' : 'false'}" onclick="sendOutToggleQr()">QR home</button></div>
      <div class="so-story"><canvas id="so-story" width="270" height="480" aria-label="The story card"></canvas></div>
      <div class="so-keys">
        <button type="button" class="btn btn-sm" id="so-story-save" onclick="sendOutSaveStory()" disabled>⤓ Save the story</button>
      </div>
    </section>`;
  sendOutCount();
}

export function sendOutCount() {
  const el = $('so-counts');
  const text = $('so-text')?.value || '';
  if (!el) return;
  const b = graphemes(text), x = xWeight(text);
  const one = (name, n, max) => `<span class="so-count${n > max ? ' is-over' : ''}">${name} ${n} / ${max}</span>`;
  el.innerHTML = one('Bluesky', b, LIMITS.bluesky) + one('X', x, LIMITS.x);
}

// The copy first, in the gesture (iOS writes the clipboard only there); the
// slot's answer after.
export function sendOutCopyText() { const r = copyText($('so-text')?.value || '', { ok: '✓ post copied', what: 'the post' }); _sent(); return r; }
export function sendOutCopyLink() { if (!_target) return null; const r = copyText(_target.url, { ok: '✓ link copied', what: 'the address' }); _sent(); return r; }

// The slot answers a piece going out (K81): its slit comes up on the
// console's heat and goes down on its cool, the way a bay takes a drop, with
// the crest where the rise ends (BAY_WAKE_HOLD_MS's reasoning, chrome.js). A
// class, not data-heat: the generic hot rule would put a filter over the
// whole key, and the slit's light is one registered dial (--seam-level),
// which the engine follows as it transitions. A hand on the slot warms it as
// well (css: .br-mailslot:hover); this is the touch screen's "it went".
const SENT_HOLD_MS = 1500;   // = --arm-heat
let _sentCool = 0;
function _sent() {
  const slot = typeof document !== 'undefined' && document.getElementById('br-mailslot');
  if (!slot) return;
  clearTimeout(_sentCool);
  slot.classList.add('is-sent');
  _sentCool = setTimeout(() => slot.classList.remove('is-sent'), SENT_HOLD_MS);
}

async function _check() {
  const t = _target;
  if (!t) return;
  const box = $('so-unfurls'), verdict = $('so-verdict');
  let result;
  try { result = await _inspect(t.url); } catch (err) {
    if (box) box.innerHTML = `<div class="so-note is-bad">Could not read the page: ${escapeHTML(err.message)}</div>`;
    return;
  }
  if (_target !== t) return;   // the drawer moved on
  const { tags, image } = result;
  const host = _host(tags['og:url'] || t.url);
  const pic = image && image.ok ? `<img src="${escapeHTML(image.src)}" alt="">` : '<div class="so-nopic">no picture</div>';
  const title = escapeHTML(tags['og:title'] || t.url);
  const desc = escapeHTML(tags['og:description'] || '');
  if (box) box.innerHTML = `
    <figure class="so-unfurl so-imessage"><div class="so-pic">${pic}</div><figcaption><b>${title}</b><span>${escapeHTML(host)}</span></figcaption><div class="so-who">iMessage</div></figure>
    <figure class="so-unfurl so-bluesky"><div class="so-pic">${pic}</div><figcaption><span>${escapeHTML(host)}</span><b>${title}</b><i>${desc}</i></figcaption><div class="so-who">Bluesky</div></figure>
    <figure class="so-unfurl so-x"><div class="so-pic">${pic}<span class="so-x-host">${escapeHTML(host)}</span></div><div class="so-who">X</div></figure>`;
  const lines = unfurlVerdict(tags, image);
  if (verdict) {
    verdict.innerHTML = lines.map(([state, name, said]) => `<li class="is-${state}"><span>${state === 'ok' ? '✓' : state === 'warn' ? '·' : '✕'} ${escapeHTML(name)}</span> ${escapeHTML(said)}</li>`).join('')
      + (!image || !image.ok ? `<li class="so-fix"><button type="button" class="btn btn-sm" onclick="sendOutStamp()"${shareIsStamped(t.stem) ? ' disabled' : ''}>▲ Stamp the share images</button></li>` : '');
  }
}

export async function sendOutStamp() {
  if (!_target) return;
  await shareStampImages(_target.stem);
  _check();
}

// ---- the QR on the story card: on or off, remembered on this device ----

const QR_KEY = 'oaklens_sendout_qr';
function _qrOn() {
  try { return localStorage.getItem(QR_KEY) !== '0'; } catch { return true; }
}
export function sendOutToggleQr() {
  const on = !_qrOn();
  try { localStorage.setItem(QR_KEY, on ? '1' : '0'); } catch {}
  $('so-qr')?.setAttribute('aria-checked', on ? 'true' : 'false');
  _paintStory();
}

async function _paintStory() {
  const t = _target;
  const cv = $('so-story');
  if (!t || !cv) return;
  const save = $('so-story-save');
  if (save) save.disabled = true;
  _story = null;
  try {
    // With the QR home, or (switched off, K81) the plain story: the card
    // centred and the wordmark under it.
    const card = await paintCard(t.item, 'story', _qrOn() ? { qr: t.url } : {});
    if (_target !== t) return;
    _story = card;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(card, 0, 0, cv.width, cv.height);
    if (save) save.disabled = false;
  } catch (err) {
    toast('⚠ could not draw the story card: ' + err.message, 'error');
  }
}

/** Where the story goes. A touch device with a share sheet for files (an iPad,
 *  a phone) gets the sheet: straight to Photos or a story. A desktop (a mouse or
 *  trackpad drives it, the console's usual test) gets a download, even where it
 *  has a sheet: the Mac's offers AirDrop, Mail and Notes but no folder, so the
 *  file had nowhere on the computer to go (the owner, 2026-10-23). */
export function storySaveRoute(file) {
  let desktop = false;
  try { desktop = matchMedia('(pointer: fine)').matches; } catch { /* no matchMedia: ask the sheet */ }
  if (desktop) return 'download';
  return navigator.canShare && navigator.canShare({ files: [file] }) ? 'share' : 'download';
}

/** Save the story: the share sheet or a download, by storySaveRoute. A sheet
 *  that fails (not one that is dismissed) falls back to the download. */
export async function sendOutSaveStory() {
  if (!_story || !_target) return;
  const blob = await canvasBlob(_story);
  const name = shareFileName(_target.stem, 'story');
  const file = new File([blob], name, { type: blob.type || 'image/webp' });
  _sent();
  if (storySaveRoute(file) === 'share') {
    try { await navigator.share({ files: [file], title: _target.name }); return; } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('✓ story card saved', 'success');
}

// ---- choose your media (K81) ----
//
// The station's three keys (▦ pictures, ✎ notes, ♪ audio: the tab bar's own
// icons) open one picker on their own bucket. It wears the asset library's
// toolbar and grid, so it reads as the library, but it lists PIECES, each
// with an address, not files: a wallpaper or an upload has no page to send.
// A pick hands the piece to the drawer, and everything after is the drawer.

export const PICK_BUCKETS = [
  ['all', 'All'],
  ['pictures', '▦ Pictures'],
  ['notes', '✎ Notes'],
  ['audio', '♪ Audio'],
];
const BUCKET_OF = { archive: 'pictures', raw: 'pictures', text: 'notes', audio: 'audio' };

/** The pieces a bucket shows, matching a search on the title or an f#. */
export function pickPieces(pieces, bucket = 'all', query = '') {
  const q = String(query || '').trim().toLowerCase().replace(/^f#?(?=\d)/, '');
  return pieces.filter((p) => {
    if (bucket !== 'all' && BUCKET_OF[p.kind] !== bucket) return false;
    if (!q) return true;
    if (String(p.title || '').toLowerCase().includes(q)) return true;
    return p.kind === 'raw' && p.num && String(p.num).startsWith(q);
  });
}

let _pickBucket = 'all';
let _pickShown = [];
let _pickTimer = 0;

export function sendOutPick(bucket = 'all') {
  _pickBucket = PICK_BUCKETS.some(([k]) => k === bucket) ? bucket : 'all';
  const ov = $('sendpick-modal');
  if (!ov) return;
  const search = $('sendpick-search');
  if (search) search.value = '';
  ov.classList.remove('hidden', 'closing');
  _renderPick();
  // The search takes the keys on a desk only: on a touch screen it would
  // raise the keyboard over the picker before a thumbnail is seen.
  if (search && matchMedia('(pointer: fine)').matches) setTimeout(() => search.focus(), 100);
}

export function sendOutPickClose() {
  hideOverlay('sendpick-modal');
  if (_pickSeen) _pickSeen.disconnect();
  _pickShown = [];
}

export function sendOutPickFilter(bucket) {
  _pickBucket = bucket;
  _renderPick();
}

export function sendOutPickSearch() {
  clearTimeout(_pickTimer);
  _pickTimer = setTimeout(_renderPick, 120);
}

export function sendOutPickChoose(i) {
  const piece = _pickShown[i];
  if (!piece) return;
  sendOutPickClose();
  sendOutOpen(piece);
}

const _when = (at) => at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const _length = (s) => { const n = Math.round(Number(s) || 0); return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : ''; };

function _pickItemHTML(p, i) {
  const stamped = shareIsStamped(_cardOf(p).stem) ? '<span class="sendpick-stamp" title="Its share images are stamped">▲</span>' : '';
  if (p.kind === 'archive' || p.kind === 'raw') {
    const thumb = cdnThumb(p.entry, 'archive', 480);
    const tag = p.kind === 'raw' ? (p.num ? `f#${p.num}` : 'frame') : 'archive';
    // A frame's number is its badge; only a title of its own is said again.
    const label = p.kind === 'raw' && p.title === `Frame f#${p.num}` ? '' : `<span class="asset-lib-item-label">${escapeHTML(p.title)}</span>`;
    return `<button type="button" class="asset-lib-item sendpick-pic" data-tier="card" onclick="sendOutPickChoose(${i})" aria-label="${escapeHTML(p.title)}">
      <img src="${escapeHTML(thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
      <span class="asset-lib-badge">${escapeHTML(tag)}</span>${stamped}${label}
    </button>`;
  }
  const glyph = p.kind === 'audio' ? '♪' : '✎';
  const meta = [_when(p.at), p.kind === 'audio' ? _length(p.entry.duration) : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="sendpick-row" data-tier="card" onclick="sendOutPickChoose(${i})">
    <span class="sendpick-glyph" aria-hidden="true">${glyph}</span>
    <span class="sendpick-name">${escapeHTML(p.title)}</span>
    <span class="sendpick-meta">${escapeHTML(meta)}</span>${stamped}
  </button>`;
}

// A page at a time (K81, measured: all 823 pictures at once was a 350–550 ms
// frame in WebKit at iPad size, and 235 ms in Brave at 4× CPU). The first
// page is more than a screen; the next is built as the scroll nears the end
// of this one, appended, never rebuilt.
export const PICK_PAGE = 48;
let _pickBuilt = 0;
let _pickSeen = null;

function _renderPick() {
  const pills = $('sendpick-pills'), grid = $('sendpick-grid'), rows = $('sendpick-rows'), empty = $('sendpick-empty');
  if (!grid || !rows) return;
  if (pills) {
    pills.innerHTML = PICK_BUCKETS.map(([k, name]) =>
      `<button type="button" class="asset-lib-pill${_pickBucket === k ? ' active' : ''}" aria-pressed="${_pickBucket === k}" onclick="sendOutPickFilter('${k}')">${escapeHTML(name)}</button>`).join('');
  }
  _pickShown = pickPieces(addressablePieces(), _pickBucket, $('sendpick-search')?.value || '');
  grid.innerHTML = '';
  rows.innerHTML = '';
  _pickBuilt = 0;
  _pickMore();
  const scroll = grid.closest('.sendpick-scroll');
  if (scroll) scroll.scrollTop = 0;
  if (empty) {
    empty.hidden = _pickShown.length > 0;
    empty.textContent = $('sendpick-search')?.value ? '// nothing live by that name' : '// nothing live here yet';
  }
}

/** Build the next page of the list, and watch for the scroll to need another. */
function _pickMore() {
  const grid = $('sendpick-grid'), rows = $('sendpick-rows');
  if (!grid || !rows) return;
  const end = Math.min(_pickShown.length, _pickBuilt + PICK_PAGE);
  const pics = [], lines = [];
  for (let i = _pickBuilt; i < end; i++) {
    const p = _pickShown[i];
    (BUCKET_OF[p.kind] === 'pictures' ? pics : lines).push(_pickItemHTML(p, i));
  }
  if (pics.length) grid.insertAdjacentHTML('beforeend', pics.join(''));
  if (lines.length) rows.insertAdjacentHTML('beforeend', lines.join(''));
  _pickBuilt = end;
  grid.hidden = !grid.firstElementChild;
  rows.hidden = !rows.firstElementChild;
  if (_pickSeen) _pickSeen.disconnect();
  if (_pickBuilt >= _pickShown.length || typeof IntersectionObserver !== 'function') return;
  // The last item built, a screen before it is reached.
  const last = (rows.lastElementChild && !rows.hidden) ? rows.lastElementChild : grid.lastElementChild;
  _pickSeen = new IntersectionObserver((seen) => {
    if (seen.some((e) => e.isIntersecting)) _pickMore();
  }, { root: grid.closest('.sendpick-scroll'), rootMargin: '0px 0px 600px 0px' });
  if (last) _pickSeen.observe(last);
}

// Escape closes the drawer, before anything under it hears the key.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const pick = document.getElementById('sendpick-modal');
    const picking = !!pick && !pick.classList.contains('hidden');
    if (!_target && !picking) return;
    e.preventDefault();
    e.stopPropagation();
    if (_target) sendOutClose(); else sendOutPickClose();
  }, true);
}
