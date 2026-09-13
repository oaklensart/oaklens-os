// OAKLENS Field Console — share.
//
// The author-facing half of sharing: four gestures over one card, in one place,
// wherever that card is made. Chunk 8 of docs/cards-core-complete.md.
//
// Chunk 7 built the painter (js/console/card-paint.js) and stopped: it could
// draw any card at any of three ratios and nothing but the framing modal ever
// asked it to. So `meta/fn-*`, `meta/set-*`, `meta/card-*` and every `-native`
// / `-story` file resolved at the edge and returned null forever, because no
// button wrote one. This module is the button.
//
// The four gestures, and why exactly these four:
//
//   ⧉ COPY LINK       — the card's address. Spelled by the engine's entryHref,
//                       never here, so the console can never hand out a URL the
//                       grid would not.
//   ▲ STAMP           — paint all three ratios, upload all three to R2. This is
//                       what makes a pasted link unfurl with the card instead
//                       of with a bare line of text.
//   ⤓ DOWNLOAD NATIVE — the feed shape, for posting by hand.
//   ⤓ DOWNLOAD STORY  — the full-bleed vertical, same.
//
// ONE BODY, TWO FRAMES. The studio rail is an inspector and shows the block
// inline; the audio shelf and the field-note editor have no rail, so they open
// the same body in a sheet. shareBlockBody() is the single renderer — a second
// markup for the sheet is how the two would drift apart by the third session.
//
// WHERE IT SITS. Above card-paint (it paints) and above fn-editor (it reads the
// open note), below audio and cards (they build their own targets and hand them
// over — the same shape focal.js's per-surface entry points have, and the
// reason a set's tracks are resolved by the audio shelf rather than here).

import { STATE } from '../console-state.js';
import { getToken, uploadFiles } from '../console-api.js';
import { toast, escapeHTML, escapeAttrJS, openSheet, closeSheet } from './chrome.js';
import { SITE_FILE_PREFIX } from './assets.js';
import { _addOgCard, _hasOgCard } from './buffer.js';
import { fnCurrentId } from './fn-editor.js';
import { paintCard, shareStem, shareKey, SHARE_RATIOS } from './card-paint.js';

// The three files a stamp writes, in the order they are painted. `og` first on
// purpose: it is the one an unfurl reads, so if a later ratio fails the most
// load-bearing image is already in the batch.
const STAMP_RATIOS = ['og', 'native', 'story'];

// ============== THE TARGET ==============
//
// Everything a share needs to know about one card:
//
//   item   what RecentIndex.buildCard takes — the painter's whole input
//   stem   its address on R2, from card-paint's shareStem (one spelling)
//   url    its address on the site, from the engine's entryHref
//   name   what to call it in a toast, in the owner's own words
//
// The MARKER — what /api/og-cards lists — is the stem with its `meta/` prefix
// off. focal.js passes one explicitly because it predates the other four stems;
// here it is derived, because `meta/<x>` → `<x>` is the same string either way
// and a second field is a second thing to get wrong.
export function shareMarker(stem) {
  return String(stem || '').replace(/^meta\//, '');
}

/** Assemble a target. Returns null when the card has no address to share — a
 *  pulse, an unpublished note, the automatic playlist that is nobody's set. A
 *  null target is how every surface decides NOT to draw the block, so this is
 *  the one gate rather than five. */
export function shareTarget({ item, stem, url, name, staged }) {
  if (!item || !stem || !url) return null;
  // `staged`: the address exists but does not answer yet — the record has not
  // been published. Only the copy-link toast reads it (a stamp and a download
  // are honest either way; a link that 404s is not).
  return { item, stem, url, name: String(name || '').trim() || 'this card', staged: !!staged };
}

// The live targets, keyed by stem — the token an inline handler carries.
//
// Refreshed by every render of the block (the rail repaints after every
// mutation, the sheet on every open), so what a button acts on is the card as
// it is now, not as it was when the page last painted.
const _targets = new Map();

export function _shareTargetAt(stem) { return _targets.get(String(stem || '')) || null; }

// Which stem is mid-stamp, so its button can say so and cannot be pressed twice.
let _busy = '';

/** Has this card been stamped? Reads the set /api/og-cards filled at boot,
 *  which lists the `og` stamp only — the two download ratios are not an unfurl
 *  and are not indexed (chunk 7 pinned that). */
export function shareIsStamped(stem) {
  return !!stem && _hasOgCard(shareMarker(stem));
}

// ============== THE SEAM ==============
//
// The studio rail draws this block and lives ABOVE this module, so a stamp that
// finishes here cannot repaint it directly. cards.js registers instead — the
// house pattern (CLAUDE.md: the thing above registers with the thing below),
// wired in js/console/init.js with the rest.
let _repaintRail = null;
export function registerShareRepaint(fn) { _repaintRail = fn; }

function _afterChange() {
  if (_sheetStem) _renderSheet();
  if (typeof _repaintRail === 'function') _repaintRail();
}

// ============== THE BLOCK ==============

/**
 * The body of the SHARE block: the four buttons, and the address above them
 * unless the surface already shows it.
 *
 * Markup only — the caller frames it. The studio rail wraps it in its own
 * controlBlock (so it reads as one more instrument in the inspector); the sheet
 * drops it straight in.
 *
 * `opts.showLink` false on the composer rail ONLY, where chunk 6's CARD ADDRESS
 * block sits two inches above with the same string and its own COPY. It drops
 * BOTH halves — the address line and the copy button — because the redundancy
 * was never the line, it was two buttons three inches apart copying one URL.
 * What is left there is the half that block cannot do: the images.
 */
export function shareBlockBody(target, opts = {}) {
  if (!target) return '';
  _targets.set(target.stem, target);
  const q = `'${escapeAttrJS(target.stem)}'`;
  const stamped = shareIsStamped(target.stem);
  // ONE STAMP AT A TIME, and every button knows it — not just the one that
  // started it. A stamp takes three paints and an upload, which is long enough
  // to click away and try another card; that second button used to look live and
  // then do nothing at all, because the handler's own `if (_busy) return` is
  // silent. `mine` is the one that says STAMPING…; the others just go quiet.
  const mine = _busy === target.stem;
  const busy = !!_busy;
  const link = opts.showLink !== false;
  const address = !link ? '' : `
    <div class="share-addr">
      <code class="share-addr-path">${escapeHTML(target.url)}</code>
    </div>`;
  return `${address}
    <div class="action-dock share-dock">
      ${link ? `<button class="btn btn-full btn-ghost" onclick="shareCopyLink(${q})"
        title="Copy this card's address">⧉ COPY LINK</button>` : ''}
      <button class="btn btn-full ${stamped ? 'btn-ghost' : 'btn-stage'}" ${busy ? 'disabled' : ''}
        onclick="shareStampImages(${q})"
        title="${mine ? 'Drawing all three sizes and putting them on your CDN'
          : busy ? 'Another card is being stamped — one at a time'
          : 'Paint this card at all three sizes and put them on your CDN'}">
        ${mine ? '◌ STAMPING…' : stamped ? '↻ RE-STAMP SHARE IMAGES' : '▲ STAMP SHARE IMAGES'}</button>
      <div class="share-dock-pair">
        <button class="btn btn-ghost" onclick="shareDownload(${q},'native')"
          title="Save the card at feed proportions (1080×1350)">⤓ NATIVE</button>
        <button class="btn btn-ghost" onclick="shareDownload(${q},'story')"
          title="Save the card full-screen vertical (1080×1920)">⤓ STORY</button>
      </div>
    </div>`;
}

/** The one-word state for a block header's aside. */
export function shareBlockAside(target) {
  if (!target) return '';
  return shareIsStamped(target.stem) ? 'stamped' : 'not stamped yet';
}

/** The sentence under the block. Says what stamping is for in the owner's
 *  language, and — on the live grid — that this gesture is not a staged change. */
export function shareBlockNote(target, opts = {}) {
  if (!target) return '';
  const it = opts.showLink === false ? 'the address above' : 'this link';
  const base = shareIsStamped(target.stem)
    ? `Paste ${it} anywhere and the card shows with it. Re-stamp after you change the card, `
      + 'or the old picture keeps showing.'
    : `Stamping makes the picture that appears when someone pastes ${it} into a message or a post. `
      + 'The downloads are for posting by hand.';
  return opts.live
    ? `${base} Sharing happens now — it is not a staged change and does not wait for publish.`
    : base;
}

// ============== THE FOUR GESTURES ==============
//
// Each takes the stem, because an inline on*= handler can carry a string and
// not an object. The target is looked up fresh, so a card edited since the last
// paint is shared as it is now.

export function shareCopyLink(stem) {
  const t = _shareTargetAt(stem);
  if (!t) return;
  const url = /^https?:/i.test(t.url) ? t.url : location.origin + t.url;
  // ⚠️ `navigator.clipboard` IS UNDEFINED OUTSIDE A SECURE CONTEXT, and the
  // console is reachable from one that is not: a phone or an iPad opening it at
  // `http://<LAN ip>:8787` while `wrangler dev` runs. Reading `.writeText` off
  // undefined throws synchronously, before any `.then` exists to catch it — and
  // from an inline on*= handler that is an unhandled TypeError, so the button
  // does nothing and says nothing. Show the address instead; it is the whole
  // point of the gesture and the owner can select it.
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    toast('Copy needs a secure connection — the address is ' + url, 'warning');
    return;
  }
  const msg = t.staged ? '✓ link copied — it works once you publish' : '✓ link copied';
  navigator.clipboard.writeText(url).then(
    () => toast(msg, 'success'),
    () => toast('Copy failed — the address is ' + url, 'warning'),
  );
}

/** A canvas as a WebP blob. Rejects rather than resolving empty: an empty blob
 *  uploaded to a permanent key is a broken image on every future unfurl. */
export function canvasBlob(canvas) {
  return new Promise((res, rej) => {
    if (!canvas || typeof canvas.toBlob !== 'function') return rej(new Error('canvas export failed'));
    canvas.toBlob((b) => ((b && b.size) ? res(b) : rej(new Error('canvas export failed'))), 'image/webp', 0.9);
  });
}

/** What a downloaded file is called. The site's own prefix, never a literal —
 *  the old OG download shipped every fork a file with this instance's name on
 *  it, and that is the bug the prefix exists for. */
export function shareFileName(stem, ratio) {
  return `${SITE_FILE_PREFIX || 'share'}-${shareMarker(stem)}-${ratio}.webp`;
}

export async function shareDownload(stem, ratio) {
  const t = _shareTargetAt(stem);
  if (!t || !SHARE_RATIOS[ratio]) return;
  try {
    const canvas = await paintCard(t.item, ratio);
    const blob = await canvasBlob(canvas);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = shareFileName(stem, ratio);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`✓ ${ratio} image downloaded`, 'success');
  } catch (err) {
    toast('⚠ could not draw the card: ' + err.message, 'error');
  }
}

/**
 * STAMP. Paint all three ratios, upload all three in one request.
 *
 * ⚠️ EVERY PAINT FINISHES BEFORE ANYTHING UPLOADS. paintCard resolves only once
 * its picture and its faces have decoded, and one `await` per ratio is what
 * makes that true for all three — chunk 7's code review found ▲ Publish
 * shipping a card whose photograph had not arrived, to a permanent key link
 * previews already point at. A half-drawn card at a permanent address is worse
 * than no card, so a failure anywhere uploads NOTHING.
 *
 * Not automatic on publish, deliberately (open question 4, owner took the
 * default): a stamp for every entry on every publish is R2 churn a fork did not
 * ask for. Stamping is an author's gesture.
 */
export async function shareStampImages(stem) {
  const t = _shareTargetAt(stem);
  if (!t) return;
  // Belt to the disabled attribute's braces. A block rendered BEFORE a stamp
  // started can still be on screen unrepainted (cardsRepaint deliberately does
  // nothing when the Cards view has never been drawn), so a live button can
  // outlive the state that should have greyed it. Saying why beats a dead click.
  if (_busy) return toast('one at a time — another card is still stamping', 'warning');
  if (!getToken()) return toast('log in to stamp share images', 'error');
  _busy = stem;
  _afterChange();
  try {
    const files = [];
    for (const ratio of STAMP_RATIOS) {
      const canvas = await paintCard(t.item, ratio);
      const blob = await canvasBlob(canvas);
      files.push(new File([blob], shareKey(t.stem, ratio), { type: 'image/webp' }));
    }
    await uploadFiles(files);
    _addOgCard(shareMarker(t.stem));
    toast(`✓ ${t.name} — share images stamped; the link now unfurls with the card`, 'success');
  } catch (err) {
    toast('⚠ stamp failed: ' + err.message, 'error');
  } finally {
    _busy = '';
    _afterChange();
  }
}

// ============== THE SHEET ==============
//
// For the surfaces with no inspector to hang a block on. Same body, same
// gestures; a title so the owner knows which card they are sharing.

let _sheetStem = '';

function _renderSheet() {
  const host = document.getElementById('share-sheet-body');
  const title = document.getElementById('share-sheet-title');
  const note = document.getElementById('share-sheet-note');
  const t = _shareTargetAt(_sheetStem);
  if (!host || !t) return;
  if (title) title.textContent = `Share — ${t.name}`;
  host.innerHTML = shareBlockBody(t);
  if (note) note.textContent = shareBlockNote(t);
}

/** Open the sheet on a target a surface built. Returns false when there is
 *  nothing to share, so the caller can say why in its own words. */
export function shareOpen(target) {
  if (!target) return false;
  _targets.set(target.stem, target);
  _sheetStem = target.stem;
  _renderSheet();
  openSheet('share-sheet');
  return true;
}

/** Is the sheet up? A getter, not a bare export: the console's window bridge
 *  snapshots exports at boot, so a module `let` read through window is stale
 *  forever (the CDN_BASE failure shape). Also the honest answer where the DOM
 *  is not — closeSheet() defers `.hidden` by 380ms for the exit animation. */
export function _shareSheetOpen() { return !!_sheetStem; }

export function shareCloseSheet() {
  _sheetStem = '';
  closeSheet('share-sheet');
}

// ESC closes the share sheet, in the CAPTURE phase, and the key stops here.
//
// Both halves matter, and the second one is the bug. This sheet opens over two
// surfaces that own their own Escape: the field-note editor unwinds its ⋯ menu,
// its drawer, its preview and then FOCUS MODE (fnHandleKeyboard), and the Cards
// composer exits editing. A bubble-phase listener would let one press close the
// sheet AND drop the writer out of focus mode behind it — which is exactly the
// incident js/console/asset-library.js's own capture listener was written after,
// so this is that pattern rather than a new one.
//
// ⚠️ Guarded on `_sheetStem`, not on the overlay's `.hidden` class. closeSheet()
// defers `.hidden` by 380ms for the exit animation, so a class check answers
// "still open" for a third of a second after it closed — while `_sheetStem` is
// cleared synchronously by every path that closes this sheet (this function,
// the backdrop click, the grabber drag).
//
// Deliberately NOT a line in init.js's Escape chain: that chain is bubble-phase
// and runs after fn-editor's, which is the whole problem. One home, not two.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !_sheetStem) return;
    e.preventDefault();
    e.stopPropagation();
    shareCloseSheet();
  }, true);
}

// ============== THE FIELD NOTE'S OWN ENTRY POINT ==============
//
// The one surface whose target is built HERE rather than by the surface: the FN
// editor sits below this module, so it cannot hand a target up. It registers
// instead (see _registerFnShare in js/console/fn-editor.js) and this is what it
// gets.
//
// ⚠️ THE KEY DEPENDS ON THE HERO, because the EDGE's does. worker.js reads
// `meta/<heroBase>-og.webp` for a note that has one and `meta/fn-<slug>-og.webp`
// for a note that does not — the split chunk 7 introduced so a note leading with
// words finally had an image without re-stamping every note that already had
// one. Stamping the other key would write a file nothing ever reads.
export function fnShareTarget() {
  const post = (STATE.posts || []).find((p) => p && p.id === fnCurrentId);
  // An address is what is being shared, and a draft has none: `fn_id` is minted
  // when the note is first staged for publish.
  if (!post || !post.fn_id) return null;
  if (post.status && post.status !== 'published') return null;
  const RI = (typeof window !== 'undefined' && window.RecentIndex) || null;
  if (!RI) return null;
  const hero = RI.heroFilename(post);
  const stem = hero
    ? shareStem({ kind: 'frame', id: hero.replace(/\.[^.]+$/, '') })
    : shareStem({ kind: 'fn', id: post.fn_id });
  return shareTarget({
    // The card the homepage would draw for this note — hero-forward when it has
    // a picture, the words tile when it does not. One builder, so the stamp is
    // the card.
    item: { kind: 'text', data: hero ? { ...post, card: { layout: 'hero' } } : post },
    stem,
    url: location.origin + RI.entryHref('text', post),
    name: post.title || 'this note',
    staged: !post._imported,
  });
}

// Registered onto fn-editor's ⋯ menu (`fnMenuRun('share')`), which has already
// closed the menu by the time this runs.
export function shareNote() {
  if (!shareOpen(fnShareTarget())) {
    toast('stage this note for publish first — a share link needs an address', 'error');
  }
}
