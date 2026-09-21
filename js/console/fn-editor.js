// OAKLENS Field Console — fn-editor.
//
// The Field Notes editor, whole: compose/stage/preview, the cover slot, the
// preview panel and the insert drawer, keyboard + inline-image enhancements,
// the D1-backed cloud drafts (LWW upsert, merge on sync), the buffer-dates
// picker and the frame browser. The two pickers and the draft sync are mutually
// recursive with the editor (fnInsertAtCursor ↔ fnDebouncedSave,
// fnClearBufferDates → fnRender), so splitting them out is the one grouping
// that produces a genuine cycle — they stay together.
//
// fnCurrentId is exported as a live binding: the focal entry point and the
// reconnect resume (above this module) read it; only the editor assigns it.
//
// Extracted from console-ui.js 2026-07-29. See dev/console-module-plan.md.
//
// ---- 2026-08-23: the studio rewrite ----
// The DOM half of this module was rebuilt against new markup (a manuscript
// canvas, not a two-pane compose grid — see the FIELD NOTES STUDIO section of
// css/field-console.css and docs/maintenance/2026-08-23-field-notes-studio.md).
// The DATA half — stage/publish, cloud drafts, the merge, the two pickers' own
// rendering — was deliberately not touched: none of it was what was broken.
//
// The one behavioural change worth knowing: fnRender() no longer renders
// markdown on every keystroke. It updates the counters and returns unless the
// preview panel is open. The old split pane was always on screen, so it had no
// choice; a closed overlay should cost nothing.

import { STATE, save, stageChange, trashItem, toggleFnBar } from '../console-state.js';
import { getToken, isLoggedIn, pushDraft, deleteDraft, uploadFilesWithRetry } from '../console-api.js';
import { renderMarkdown } from '../markdown-engine.js';
import { toast, escapeHTML, openSheet, closeSheet } from './chrome.js';
import { CDN_BASE, SITE_LOCATION, _resizeToWebP, generateVariants } from './assets.js';
import { cleanFilename, readFileAsDataURL, todayISO, uid, ymd } from './utils.js';

let fnCurrentBufferDates = [];   // selected dates for current post's buffer_dates field
let fnSelectedFrameIds = new Set(); // selected frames in frame browser

// Which overlays are open. fnPreviewOpen is load-bearing rather than cosmetic:
// it is what lets fnRender() skip the markdown pass.
let fnPreviewOpen = false;
let _fnDrawerTab = "frames";

// ============== FN// MARKDOWN ==============
export let fnCurrentId = null;

// ---- studio chrome: the three things every load / new / stage has to say ----

// The accent underline on the studio's bar and the DRAFT/LIVE stamp beside the
// note's id are one fact shown twice — keep it written in one place.
function _fnSetStatus(status) {
  const draft = status === "draft";
  document.querySelector(".fn-studio")?.classList.toggle("is-draft", draft);
  const badge = document.getElementById("fn-status-badge");
  if (!badge) return;
  badge.textContent = draft ? "DRAFT" : "LIVE";
  badge.dataset.state = draft ? "draft" : "live";
}

// Delete lives in the ⋯ menu, and only for a note that has been saved.
function _fnSetDeletable(on) {
  const btn = document.getElementById("fn-delete-btn");
  if (btn) btn.style.display = on ? "flex" : "none";
}

// Point the one document picker at whatever is open (including "nothing yet").
function _fnSyncPicker() {
  const sel = document.getElementById("fn-doc-select");
  if (!sel) return;
  sel.value = STATE.posts.some((p) => p.id === fnCurrentId) ? fnCurrentId : "";
}

export function fnNewPost() {
  fnCurrentId = uid();
  fnCurrentBufferDates = [];
  fnSelectedFrameIds = new Set();
  // Drafts no longer claim an fn-NNN up front — you may have several going and not
  // know which you'll publish first, so the number is assigned at stage/publish time
  // (see nextFnId()/fnStage). Leave the field blank; type one to override if you want.
  document.getElementById("fn-id").value = "";
  document.getElementById("fn-title").value = "";
  document.getElementById("fn-location").value = SITE_LOCATION;
  document.getElementById("fn-date").value = ymd(new Date());
  document.getElementById("fn-body").value = "";
  _fnSetStatus("draft");
  _fnSetDeletable(false);
  fnHeroClear();
  _fnSyncPicker();
  fnRender();
}

export function fnLoadPost(id) {
  if (!id) return;
  const post = STATE.posts.find(x => x.id === id);
  if (!post) return;
  fnCurrentId = post.id;
  document.getElementById("fn-id").value = post.fn_id || "";
  document.getElementById("fn-title").value = post.title || "";
  document.getElementById("fn-location").value = post.location || SITE_LOCATION;
  document.getElementById("fn-date").value = post.date || "";
  document.getElementById("fn-body").value = post.body || "";
  // Elastic band (craft pass): the bar wears its accent underline, and the stamp
  // beside the id reads DRAFT, only while the open note is unpublished.
  _fnSetStatus(post.status === "draft" ? "draft" : "published");
  _fnSetDeletable(true);
  fnCurrentBufferDates = post.buffer_dates ? post.buffer_dates.split(',').map(d => d.trim()).filter(Boolean) : [];
  fnSelectedFrameIds = new Set();
  // Restore the hero focal point before fnHeroSet() so its thumbnail preview
  // reflects the stored crop (fnHeroClear() drops it when there's no hero).
  const _heroSlot = document.getElementById("fn-hero-slot");
  if (post.focus) _heroSlot.dataset.focus = post.focus; else delete _heroSlot.dataset.focus;
  // Same idea for the homepage card layout: restore it BEFORE fnHeroSet() so
  // the opt-in button comes up in the right state (and fnHeroClear() drops it
  // when the note has no hero to lead with).
  if (post.card && post.card.layout) _heroSlot.dataset.cardLayout = post.card.layout;
  else delete _heroSlot.dataset.cardLayout;
  if (post.hero && post.hero.startsWith("data:")) fnHeroSet(post.hero, post.hero_filename || "hero");
  else if (post.hero_filename || (post.hero && !post.hero.startsWith("data:"))) {
    const filename = post.hero_filename || post.hero;
    fnHeroSet("", filename);
  }
  else fnHeroClear();
  _fnSyncPicker();
  fnRender();
}

export function fnDeletePost() {
  if (!fnCurrentId) return;
  const p = STATE.posts.find(x => x.id === fnCurrentId);
  if (!p) return;
  if (!confirm(`Delete ${p.fn_id || "post"}: ${p.title || "Untitled"}?`)) return;
  // Drop its cloud draft row too, so a deleted draft doesn't resurrect on next sync.
  if (p.status === "draft") { fnCloudDeleteDraft(fnCurrentId); _setCloudStatus(''); }
  trashItem("posts", fnCurrentId);
  // No reset needed here: trashItem's `posts` renderer already runs
  // `renderFN(); fnNewPost()`, which rebuilds the picker without the deleted
  // note and leaves a blank one open.
}

export function fnHeroSet(dataURL, filename) {
  const slot = document.getElementById("fn-hero-slot");
  slot.dataset.image = dataURL;
  slot.dataset.filename = filename;
  // A class, not the shape of an inline style: the CSS switches the slot from
  // dashed dropzone to solid cover banner off this one fact.
  slot.classList.add("has-cover");
  document.getElementById("fn-hero-empty").style.display = "none";
  const thumb = document.getElementById("fn-hero-thumb");
  const base = encodeURIComponent((filename || '').replace(/\.[^.]+$/, ''));
  thumb.src = dataURL || `${CDN_BASE}/archive/${base}-480w.webp`;
  thumb.style.display = "block";
  const name = document.getElementById("fn-hero-name");
  name.textContent = filename;
  name.style.display = "block";
  document.getElementById("fn-hero-clear").style.display = "inline-flex";
  document.getElementById("fn-hero-focal").style.display = "inline-flex";
  document.getElementById("fn-hero-card").style.display = "inline-flex";
  _fnHeroCardSync();
  // Preview the current crop focal point on the slot thumbnail.
  thumb.style.objectPosition = slot.dataset.focus || "50% 50%";
  fnRender();
}

export function fnHeroClear() {
  const slot = document.getElementById("fn-hero-slot");
  delete slot.dataset.image;
  delete slot.dataset.filename;
  delete slot.dataset.focus;
  // No picture, no picture-led card. The homepage gate would fall back to the
  // text tile anyway; clearing it here keeps the composer from showing an
  // opt-in that has nothing to act on.
  delete slot.dataset.cardLayout;
  slot.classList.remove("has-cover");
  document.getElementById("fn-hero-empty").style.display = "flex";
  document.getElementById("fn-hero-thumb").style.display = "none";
  document.getElementById("fn-hero-name").style.display = "none";
  document.getElementById("fn-hero-clear").style.display = "none";
  document.getElementById("fn-hero-focal").style.display = "none";
  document.getElementById("fn-hero-card").style.display = "none";
  _fnHeroCardSync();
  fnRender();
}

// ---- the homepage card layout for this note (card: { layout }) ----
// A field note can lead the homepage card with its hero picture instead of
// rendering as the typographic tile (js/recent-index.js, CARD_LAYOUTS.text).
// Offered only when a hero exists, because with no picture the layout falls
// back to the text tile anyway and a control that could still be switched on
// would be lying about what publish will produce.
//
// Stored on the hero slot next to the focal point and applied on stage/update,
// exactly like ◎ FOCAL: the slot's dataset is the draft, fnStage() is the
// commit. Nothing here bumps the stage counter — fnStage() already counts the
// whole edit as one change.
function _fnHeroCardSync() {
  const slot = document.getElementById("fn-hero-slot");
  const btn = document.getElementById("fn-hero-card");
  if (!slot || !btn) return;
  const on = slot.dataset.cardLayout === "hero";
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.textContent = on ? "▣ HERO CARD" : "▢ HERO CARD";
}

export function fnToggleHeroCard() {
  const slot = document.getElementById("fn-hero-slot");
  if (!slot) return;
  if (!slot.dataset.filename && !slot.dataset.image) return toast("add a hero image first", "error");
  if (slot.dataset.cardLayout === "hero") delete slot.dataset.cardLayout;
  else slot.dataset.cardLayout = "hero";
  _fnHeroCardSync();
  fnMarkDirty();
  toast(slot.dataset.cardLayout
    ? "✓ homepage card leads with the picture — applies on stage/update"
    : "✓ homepage card back to the text tile — applies on stage/update", "success");
}

export async function fnHeroIngest(files) {
  const file = files[0];
  if (file && window.RawLens?.isRaw(file.name)) return window.RawLens.intake([file], 'fnhero');
  if (!file?.type.startsWith("image/")) return toast("not an image", "error");

  const baseName = cleanFilename(file.name).replace(/\.[^.]+$/, '');

  // Show local preview immediately while upload runs
  let previewSrc;
  try {
    const preview = await _resizeToWebP(file, 1024);
    previewSrc = URL.createObjectURL(preview);
  } catch {
    previewSrc = await readFileAsDataURL(file);
  }
  fnHeroSet(previewSrc, `${baseName}.webp`);

  if (getToken()) {
    toast('▲ Generating variants & uploading to R2…');
    try {
      const variants = await generateVariants(file, baseName);
      await uploadFilesWithRetry(variants);
      // Switch thumb to CDN-backed reference — slot.dataset.image stays '' so
      // save() writes hero_filename to posts.json (not a data URL blob)
      fnHeroSet('', `${baseName}.webp`);
      toast('✓ Variants uploaded to R2', 'success');
    } catch (err) {
      // Keep local preview so editing isn't blocked; warn that CDN is missing
      toast(`⚠ R2 upload failed: ${err.message} — stored locally`, 'error');
    }
  } else {
    toast('⚠ Not logged in — image stored locally only. Log in to upload.', 'error');
  }
}

// Next sequential fn-NNN, derived only from posts that already carry one (i.e.
// published posts). Drafts hold no number, so this stays stable no matter how many
// drafts are in flight — the number is claimed at publish time, in publish order.
export function nextFnId() {
  let maxNum = -1;
  STATE.posts.forEach(p => {
    const m = (p.fn_id || "").match(/^fn-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  return "fn-" + String(maxNum + 1).padStart(3, "0");
}

// A note you have not named is still a note. The cold run put it exactly right:
// the cursor blinks in an editor that silently refuses to keep anything, which
// is a poor first impression from a surface whose own header advertises
// AUTO-SAVE. So the title is required to PUBLISH — a post going out into the
// world under "Draft 2026-08-08 15:42" helps nobody — and not to save.
//
// Untitled drafts get a timestamp for a name so they are still findable in the
// drafts picker, which is the only thing the name was ever load-bearing for.
function draftStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Draft ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const _draftStamp = draftStamp;
const isPlaceholderTitle = (t) => !t || /^Draft \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t);
export const _isPlaceholderTitle = isPlaceholderTitle;

export function fnStage(explicitStatus = null) {
  if (!fnCurrentId) return toast("click + New Draft first", "error");
  let fn_id = document.getElementById("fn-id").value.trim();
  let title = document.getElementById("fn-title").value.trim();
  const slot = document.getElementById("fn-hero-slot");

  const existingPost = STATE.posts.find(p => p.id === fnCurrentId);
  let finalStatus;
  if (explicitStatus) {
    finalStatus = explicitStatus;
  } else if (existingPost) {
    finalStatus = existingPost.status || "published";
  } else {
    finalStatus = "draft";
  }

  // Gate on the RESOLVED status, not the argument. `fnStage()` with no argument
  // inherits the post's existing status, so keying off `explicitStatus` would
  // let an edit to an already-published post go out under a placeholder name.
  if (finalStatus === "published") {
    // Ask, rather than refuse. "title required" named the problem and left you
    // to find it; this puts the cursor in the field that needs you.
    if (isPlaceholderTitle(title)) {
      document.getElementById("fn-title").focus();
      toast("Give it a title before it goes out", "error");
      return;
    }
  } else if (!title) {
    title = draftStamp();
    document.getElementById("fn-title").value = title;
  }

  // Claim an fn-NNN the moment a draft is staged for publish (not before). Drafts keep
  // an empty fn_id; a manually-typed one is always respected.
  if (finalStatus === "published" && !fn_id) {
    fn_id = nextFnId();
    document.getElementById("fn-id").value = fn_id;
  }

  const post = {
    id: fnCurrentId,
    fn_id,
    title,
    location: document.getElementById("fn-location").value.trim() || SITE_LOCATION,
    date: document.getElementById("fn-date").value || ymd(new Date()),
    body: document.getElementById("fn-body").value,
    hero: slot.dataset.image || null,
    hero_filename: slot.dataset.filename || null,
    focus: (slot.dataset.focus && slot.dataset.focus !== '50% 50%') ? slot.dataset.focus : null,
    // The card descriptor the homepage engine reads. An object rather than a
    // bare string so future per-card decisions join it as keys — see the CARD
    // ENGINE block in js/recent-index.js.
    card: slot.dataset.cardLayout ? { layout: slot.dataset.cardLayout } : null,
    buffer_dates: fnCurrentBufferDates.length ? fnCurrentBufferDates.join(', ') : null,
    added_at: todayISO(),
    status: finalStatus,
  };
  // Preserve _imported flag so trash staging counts correctly
  if (existingPost && existingPost._imported) post._imported = true;
  if (existingPost && existingPost._cloud_updated) post._cloud_updated = existingPost._cloud_updated;

  const idx = STATE.posts.findIndex(p => p.id === fnCurrentId);
  if (idx >= 0) STATE.posts[idx] = post;
  else STATE.posts.unshift(post);

  if (finalStatus === "published") {
    // A draft graduating to published leaves the D1 drafts table — publish carries
    // it to GitHub/posts.json from here on.
    fnCloudDeleteDraft(fnCurrentId);
    _setCloudStatus('');
    stageChange("posts", {
      id: post.id,
      label: `${post.fn_id ? post.fn_id.toUpperCase() + ': ' : ''}${post.title}`
        + `${post.card?.layout === 'hero' ? ' — hero layout' : ''}`,
      kind: existingPost && existingPost._imported ? 'edit' : 'add',
    });
    toast(`✓ ${fn_id || "post"} staged for publish`, "success");
  } else {
    // Push the draft to D1 immediately (don't wait for the debounce) on an explicit save.
    fnCloudPushDraft(fnCurrentId);
    toast(`✓ draft saved`, "success");
  }

  save();
  renderFN();
  _fnSetStatus(finalStatus);
  _fnSetDeletable(true);
}

export function fnPreview() {
  if (!fnCurrentId) return toast("click + New Draft first", "error");
  const slot = document.getElementById("fn-hero-slot");

  const previewData = {
    id: document.getElementById("fn-id").value.trim() || fnCurrentId,
    title: document.getElementById("fn-title").value.trim() || "Untitled Preview",
    location: document.getElementById("fn-location").value.trim() || SITE_LOCATION,
    date: document.getElementById("fn-date").value || ymd(new Date()),
    // post.html builds the hero <img> from a CDN filename (like a published post),
    // so pass the filename — not the base64/blob preview, which it can't resolve
    // (and a blob: URL wouldn't survive the jump to a new tab anyway). Fall back to
    // a data: URL if that's somehow all we have (it's self-contained and will load).
    hero: slot.dataset.filename || (slot.dataset.image && slot.dataset.image.startsWith('data:') ? slot.dataset.image : null),
    buffer_dates: fnCurrentBufferDates.length ? fnCurrentBufferDates.join(', ') : null,
    body: document.getElementById("fn-body").value
  };

  localStorage.setItem("fn_preview_draft", JSON.stringify(previewData));
  window.open("/field-notes/post?preview=draft", "_blank");
}


// The counters, the auto-grow, and — only if the preview panel is actually
// open — the markdown pass. Every call site in this module still says
// fnRender(); what changed is what that costs when nothing is watching.
export function fnRender() {
  _fnStats();
  if (fnPreviewOpen) _fnRenderPreview();
}

// Cheap, and runs on every keystroke. The two `ch`-width slots in the bar mean
// writing a longer number in here cannot move a button (see the CSS section's
// invariant 2), which is the whole reason the readout is allowed to be live.
function _fnStats() {
  const body = document.getElementById("fn-body");
  if (!body) return;
  const words = (body.value.match(/\S+/g) || []).length;
  const wc = document.getElementById("fn-word-count");
  if (wc) wc.textContent = `${words} words`;
  const rt = document.getElementById("fn-read-time");
  if (rt) rt.textContent = words > 0 ? `· ${Math.max(1, Math.ceil(words / 230))} min` : "";
  _fnAutoGrow();
}

// The textarea has no height of its own: it grows to fit what you have written
// and the CANVAS scrolls. That is what keeps a caret visible over an on-screen
// keyboard without any of the scroll maths the old nested panes needed.
// rAF-throttled, because this forces a reflow and it is called per keystroke.
let _fnGrowQueued = false;
export function _fnAutoGrow() {
  if (_fnGrowQueued) return;
  _fnGrowQueued = true;
  requestAnimationFrame(() => {
    _fnGrowQueued = false;
    const ta = document.getElementById("fn-body");
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  });
}

function _fnRenderPreview() {
  const title = document.getElementById("fn-title").value || "Untitled";
  const loc = document.getElementById("fn-location").value || SITE_LOCATION;
  const date = document.getElementById("fn-date").value || ymd(new Date());
  const body = document.getElementById("fn-body").value;
  const _heroSlot = document.getElementById("fn-hero-slot");
  const _heroDataURL = _heroSlot?.dataset.image || null;
  const _heroFilename = _heroSlot?.dataset.filename || null;
  let heroSrc = _heroDataURL;
  if (!heroSrc && _heroFilename) {
    const base = encodeURIComponent(_heroFilename.replace(/\.[^.]+$/, ''));
    heroSrc = `${CDN_BASE}/archive/${base}-1024w.webp`;
  }
  const heroHtml = heroSrc ? `<img class="fn-hero-rendered" src="${heroSrc}" alt="">` : '';

  // Legacy buffer_dates placeholder (for posts loaded with old frontmatter approach)
  let bufferDatesHtml = '';
  if (fnCurrentBufferDates.length > 0) {
    const byDay = {};
    STATE.buffer.forEach(e => {
      const day = ymd(e.captured_at || e.published_at);
      (byDay[day] = byDay[day] || []).push(e);
    });
    Object.values(byDay).forEach(arr => arr.sort((a, b) => (a.filename || '').localeCompare(b.filename || '')));
    bufferDatesHtml = fnCurrentBufferDates.map(d => {
      const count = (byDay[d] || []).length;
      const countStr = count > 0 ? ` (${count})` : '';
      return `<div class="fn-preview-placeholder">⚡ BUFFER EMBED: ${d}${countStr}</div>`;
    }).join('');
  }

  // Pre-process body: stash buffer-inline, buffer-date, and frame-inline divs before markdown escapes them
  const inlineStrips = [];
  const inlineDateBlocks = [];
  const inlineAssetFrames = [];
  const inlineVideos = [];
  const inlineAudio = [];
  let processedBody = body.replace(
    /<div class="buffer-inline"[^>]*data-frames="([^"]*)"[^>]*>\s*<\/div>/g,
    (_, frames) => { inlineStrips.push(frames); return `%%BUFSTRIP_${inlineStrips.length - 1}%%`; }
  );
  processedBody = processedBody.replace(
    /<div class="buffer-date"[^>]*data-date="([^"]*)"[^>]*>\s*<\/div>/g,
    (_, date) => { inlineDateBlocks.push(date); return `%%BUFDATE_${inlineDateBlocks.length - 1}%%`; }
  );
  processedBody = processedBody.replace(
    /<div class="frame-inline"[^>]*data-files="([^"]*)"[^>]*>\s*<\/div>/g,
    (_, files) => { inlineAssetFrames.push(files); return `%%ASSETFRAME_${inlineAssetFrames.length - 1}%%`; }
  );
  processedBody = processedBody.replace(
    /<div class="video-embed"[^>]*data-src="([^"]*)"[^>]*>\s*<\/div>/g,
    (m, src) => {
      const capM = m.match(/data-caption="([^"]*)"/);
      inlineVideos.push({ src, caption: capM ? capM[1] : '' });
      return `%%VIDEO_${inlineVideos.length - 1}%%`;
    }
  );
  processedBody = processedBody.replace(
    /<div class="audio-embed"[^>]*data-slug="([^"]*)"[^>]*>\s*<\/div>/g,
    (_, slug) => { inlineAudio.push(slug); return `%%AUDIO_${inlineAudio.length - 1}%%`; }
  );

  let bodyHtml = renderMarkdown(processedBody);

  // Restore inline strip placeholders
  bodyHtml = bodyHtml.replace(/%%BUFSTRIP_(\d+)%%/g, (_, idx) => {
    const frames = inlineStrips[parseInt(idx)];
    const count = frames.split(',').filter(s => s.trim()).length;
    return `<div class="fn-preview-placeholder fn-preview-strip">📷 STRIP: ${count} frame${count !== 1 ? 's' : ''}</div>`;
  });

  // Restore inline asset-frame placeholders
  bodyHtml = bodyHtml.replace(/%%ASSETFRAME_(\d+)%%/g, (_, idx) => {
    const files = inlineAssetFrames[parseInt(idx)];
    const count = files.split(',').filter(s => s.trim()).length;
    return `<div class="fn-preview-placeholder fn-preview-strip">◎ ASSET: ${count} frame${count !== 1 ? 's' : ''}</div>`;
  });

  // Restore inline video banners — render the real <video> so the loop plays live
  bodyHtml = bodyHtml.replace(/%%VIDEO_(\d+)%%/g, (_, idx) => {
    const v = inlineVideos[parseInt(idx)];
    const base = v.src.replace(/\.[^.]+$/, '');
    const videoUrl = `${CDN_BASE}/videos/${encodeURIComponent(v.src)}`;
    const posterUrl = `${CDN_BASE}/videos/posters/${encodeURIComponent(base)}.webp`;
    const cap = v.caption ? `<figcaption>${escapeHTML(v.caption)}</figcaption>` : '';
    return `<figure class="fn-video"><video src="${videoUrl}" poster="${posterUrl}" muted loop autoplay playsinline preload="metadata"></video>${cap}</figure>`;
  });

  // Restore inline audio embeds
  bodyHtml = bodyHtml.replace(/(?:<p>)?%%AUDIO_(\d+)%%(?:<\/p>)?/g, (_, idx) => {
    const slug = inlineAudio[parseInt(idx, 10)];
    const track = (STATE.audio || []).find((a) => a.slug === slug) || { slug, title: slug, duration: 0, peaks: '' };
    const dur = track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '--:--';
    const sub = [track.sub, dur].filter(Boolean).join(' · ');

    const peaks = String(track.peaks || '').split(',').map((p) => parseFloat(p)).filter((p) => Number.isFinite(p));
    let spark = '<div class="aud-spark empty">// no waveform</div>';
    if (peaks.length) {
      const step = Math.max(1, Math.floor(peaks.length / 40));
      const bars = [];
      for (let i = 0; i < peaks.length; i += step) {
        bars.push(`<span style="height:${Math.max(6, Math.round(peaks[i] * 100))}%"></span>`);
      }
      spark = `<div class="aud-spark">${bars.join('')}</div>`;
    }

    return `<div class="fn-preview-audio">
      <div class="fn-pa-head">
        <span class="fn-pa-icon">♪</span>
        <span class="fn-pa-title">${escapeHTML(track.title || track.filename || track.slug)}</span>
        <span class="fn-pa-dur">${dur}</span>
      </div>
      ${sub ? `<div class="fn-pa-sub">${escapeHTML(sub)}</div>` : ''}
      ${spark}
    </div>`;
  });

  // Frame refs (f#N, manual §5.20) — the engine emits unresolved anchors;
  // resolve them here against STATE.buffer with the same positional numbering
  // the live site uses (sort by day + filename, number 1..N), so the author
  // sees the working red link — or a loud not-found — while writing.
  if (bodyHtml.includes('class="frame-ref"')) {
    const numToEntry = new Map();
    [...STATE.buffer].sort((a, b) => {
      const dayA = ymd(a.captured_at || a.published_at);
      const dayB = ymd(b.captured_at || b.published_at);
      const c = dayA.localeCompare(dayB);
      if (c !== 0) return c;
      return (a.filename || '').localeCompare(b.filename || '');
    }).forEach((e, i) => numToEntry.set(i + 1, e));
    bodyHtml = bodyHtml.replace(/<a class="frame-ref" data-frame="(\d+)">([^<]*)<\/a>/g, (m, num, text) => {
      const entry = numToEntry.get(parseInt(num, 10));
      if (!entry) {
        return `<span class="frame-ref-missing" title="No frame ${num} in the buffer — check the number">${text} ⚠ NOT FOUND</span>`;
      }
      const darkNote = entry.dark ? ' · DARK FRAME (citation stays valid)' : '';
      return `<a class="frame-ref" target="_blank" rel="noopener" title="${escapeHTML(entry.filename || entry.id)}${darkNote}" href="/archive/buffer/?f=${encodeURIComponent(entry.id)}">${text}</a>`;
    });
  }

  // Restore inline buffer-date placeholders
  const byDayAll = {};
  STATE.buffer.forEach(e => {
    const day = ymd(e.captured_at || e.published_at);
    (byDayAll[day] = byDayAll[day] || []).push(e);
  });
  bodyHtml = bodyHtml.replace(/%%BUFDATE_(\d+)%%/g, (_, idx) => {
    const date = inlineDateBlocks[parseInt(idx)];
    const count = (byDayAll[date] || []).length;
    const countStr = count > 0 ? ` · ${count} frame${count !== 1 ? 's' : ''}` : '';
    return `<div class="fn-preview-placeholder">📅 BUFFER DATE: ${date.replace(/-/g, '·')}${countStr}</div>`;
  });

  // Join what exists: a fork that has not set a location in site.config would
  // otherwise preview its notes under "NOTES // // 2026-08-23".
  const metaLine = ['NOTES', loc, date].filter(Boolean).join(' // ');
  document.getElementById("fn-preview").innerHTML = `
    ${heroHtml}
    ${bufferDatesHtml}
    <div class="fn-meta"><span class="arr">↪</span> ${metaLine}</div>
    <div class="fn-title">${title}</div>
    ${bodyHtml}
  `;
}

export function renderFN() {
  // The editor is ALWAYS live. Opening Field Notes used to give you a blinking
  // cursor in a box that refused to keep anything, because every save path
  // starts `if (!fnCurrentId) return` and nothing had created a draft — you had
  // to know to press + NEW DRAFT first. Nothing on screen said so.
  //
  // Creating one here rather than at the view switch covers every way in: boot,
  // the sidebar, the tab bar, and returning after a publish. `+ NEW DRAFT`
  // keeps its job, which is starting a SECOND one.
  if (!fnCurrentId) fnNewPost();

  const drafts    = STATE.posts.filter(p => p.status === "draft");
  const published = STATE.posts.filter(p => !p.status || p.status === "published");

  // ONE picker, two <optgroup>s. Two side-by-side selects spent half the bar's
  // width on a single decision, and neither of them could show you which note
  // was actually open — this one does, because its value IS the open note.
  const sel = document.getElementById("fn-doc-select");
  if (sel) {
    const row = (p, mark) => `<option value="${p.id}">${mark} ${p.date ? p.date + ' · ' : ''}`
      + `${p.fn_id ? escapeHTML(p.fn_id) + ' · ' : ''}${escapeHTML(p.title || 'Untitled')}</option>`;
    const group = (label, rows) => rows ? `<optgroup label="${label}">${rows}</optgroup>` : '';
    const any = drafts.length + published.length;
    sel.innerHTML =
      `<option value="">${any ? '— open a note —' : '— no notes yet —'}</option>`
      + group(`DRAFTS (${drafts.length})`, drafts.map(p => row(p, '◇')).join(''))
      + group(`PUBLISHED (${published.length})`, published.map(p => row(p, p._imported ? '⤓' : '●')).join(''));
    _fnSyncPicker();
  }
  fnRender();
}

// ============== FN// THE PREVIEW PANEL ==============
// An overlay, not a second pane. It slides over the manuscript on a wide screen
// and covers it on a phone, and while it is shut fnRender() does no markdown
// work at all. `fnPreview()` above is the OTHER preview — the real published
// page in a new tab — and both are offered: this one to glance, that one to be
// sure. (The panel's header carries a link to it.)
export function fnOpenPreview() {
  const panel = document.getElementById("fn-preview-panel");
  if (!panel) return;
  fnPreviewOpen = true;
  panel.hidden = false;
  _fnRenderPreview();
  // Two frames so the slide transition runs from its start value — same shape
  // as chrome.js openSheet(), for the same reason.
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add("open")));
  document.getElementById("fn-preview-btn")?.setAttribute("aria-expanded", "true");
}

export function fnClosePreview() {
  const panel = document.getElementById("fn-preview-panel");
  if (!panel || !fnPreviewOpen) return;
  fnPreviewOpen = false;
  panel.classList.remove("open");
  setTimeout(() => { if (!fnPreviewOpen) panel.hidden = true; }, 380);   // past --dur-3
  document.getElementById("fn-preview-btn")?.setAttribute("aria-expanded", "false");
}

export function fnTogglePreview() {
  if (fnPreviewOpen) fnClosePreview(); else fnOpenPreview();
}

// ============== FN// THE INSERT DRAWER ==============
// Everything you can put INTO a note, behind one door. Three tabs rather than
// six, because six chips is a row that cannot survive a 320px screen: two
// buffer pickers, and one list of the surfaces that own their own modal.
//
// Rides the console's shared .sheet-overlay/.sheet pair (chrome.js
// openSheet/closeSheet), so it inherits the scrim, the spring and the grabber
// drag instead of becoming a fourth way to present a panel.
export function fnOpenDrawer(tab) {
  _fnDrawerTab = tab || _fnDrawerTab;
  _fnPaintDrawer();
  openSheet("fn-drawer");
}

export function fnCloseDrawer() {
  closeSheet("fn-drawer");
  document.getElementById("fn-frames-btn")?.classList.remove("active");
  document.getElementById("fn-dates-btn")?.classList.remove("active");
}

export function fnDrawerTab(tab) {
  _fnDrawerTab = tab;
  _fnPaintDrawer();
}

const _FN_DRAWER_PANES = {
  frames: "fn-frame-browser",
  days:   "fn-buffer-dates-panel",
  media:  "fn-media-pane",
};

function _fnPaintDrawer() {
  for (const [name, id] of Object.entries(_FN_DRAWER_PANES)) {
    const pane = document.getElementById(id);
    if (pane) pane.hidden = name !== _fnDrawerTab;
    document.getElementById(`fn-tab-${name}`)
      ?.setAttribute("aria-selected", name === _fnDrawerTab ? "true" : "false");
  }
  // The dock's two shortcuts light up for the tab they opened.
  document.getElementById("fn-frames-btn")?.classList.toggle("active", _fnDrawerTab === "frames");
  document.getElementById("fn-dates-btn")?.classList.toggle("active", _fnDrawerTab === "days");
  if (_fnDrawerTab === "frames") fnRenderFrameBrowser();
  if (_fnDrawerTab === "days") fnRenderBufferDates();
}

// ============== FN// THE ⋯ MENU ==============
// The controls you reach for once a session, kept out of a row that has to
// survive a 320px screen. One handler, so a new entry is one line in the
// markup and one case here.
export function fnToggleMenu(force) {
  const menu = document.getElementById("fn-menu");
  if (!menu) return;
  const open = typeof force === "boolean" ? force : menu.hidden;
  menu.hidden = !open;
  document.getElementById("fn-menu-btn")?.setAttribute("aria-expanded", open ? "true" : "false");
}

// FIFTH SEAM. Sharing a note means painting its card, and the painter lives
// several layers up — so the ⋯ menu keeps its one handler and the thing above
// registers with it, the same way sync gets its upload probe. Wired in
// js/console/init.js; unset, the menu item simply is not offered.
let _shareNote = null;
export function _registerFnShare(fn) { _shareNote = fn; }

export function fnMenuRun(action) {
  fnToggleMenu(false);
  if (action === "focus") fnToggleFocus();
  else if (action === "realpreview") fnPreview();
  else if (action === "tabbar") toggleFnBar();
  else if (action === "share") _shareNote?.();
  else if (action === "delete") fnDeletePost();
}

// ============== FN// v0.7 ENHANCEMENTS ==============


// -- Auto-save with debounce --
let fnAutoSaveTimer = null;
let fnIsDirty = false;

// ---- the one live readout ----
// Local autosave and the D1 push used to own a span each, side by side in the
// same wrapping row as the toolbar — so every save changed that row's width and
// the buttons jumped between one line and two. They share ONE fixed-width slot
// now (.fn-sync, 9ch), which is why a live readout is safe to have at all.
//
// _fnSyncSeq guards the fade-out: a clear scheduled 2s ago must not wipe a
// status written since. Whoever wrote last owns the slot.
let _fnSyncSeq = 0;
function _fnSyncPill(text, state) {
  const el = document.getElementById("fn-sync");
  const seq = ++_fnSyncSeq;
  if (el) { el.textContent = text; el.dataset.state = state || ""; }
  return seq;
}
function _fnSyncClearLater(seq, ms) {
  setTimeout(() => {
    if (seq !== _fnSyncSeq) return;      // someone wrote after us — leave it
    const el = document.getElementById("fn-sync");
    if (el) { el.textContent = ""; el.dataset.state = ""; }
  }, ms);
}

export function fnMarkDirty() {
  fnIsDirty = true;
  _fnSyncPill("UNSAVED", "saving");
}

export function fnMarkClean() {
  fnIsDirty = false;
}

export function fnAutoSave() {
  if (!fnCurrentId) return;
  _fnSyncPill("SAVING…", "saving");

  const fn_id = document.getElementById("fn-id").value.trim();
  const title = document.getElementById("fn-title").value.trim();
  const slot = document.getElementById("fn-hero-slot");

  const existingPost = STATE.posts.find(p => p.id === fnCurrentId);
  const currentStatus = existingPost ? (existingPost.status || "published") : "draft";

  const post = {
    id: fnCurrentId,
    fn_id,
    title: title || "Untitled",
    location: document.getElementById("fn-location").value.trim() || SITE_LOCATION,
    date: document.getElementById("fn-date").value || ymd(new Date()),
    body: document.getElementById("fn-body").value,
    hero: slot.dataset.image || null,
    hero_filename: slot.dataset.filename || null,
    focus: (slot.dataset.focus && slot.dataset.focus !== '50% 50%') ? slot.dataset.focus : null,
    card: slot.dataset.cardLayout ? { layout: slot.dataset.cardLayout } : null,
    buffer_dates: fnCurrentBufferDates.length ? fnCurrentBufferDates.join(', ') : null,
    added_at: todayISO(),
    status: currentStatus,
  };
  // Preserve _imported flag so trash staging counts correctly
  if (existingPost && existingPost._imported) post._imported = true;
  // Preserve the cloud-sync watermark so re-sync conflict checks stay accurate
  if (existingPost && existingPost._cloud_updated) post._cloud_updated = existingPost._cloud_updated;

  const idx = STATE.posts.findIndex(p => p.id === fnCurrentId);
  if (idx >= 0) STATE.posts[idx] = post;
  else STATE.posts.unshift(post);

  save();

  // Drafts are mirrored to D1 so they survive tab close / device switch. Published
  // posts already flow to GitHub via Publish, so they don't go to the drafts table.
  if (currentStatus === "draft") fnScheduleCloudDraft(fnCurrentId);

  setTimeout(() => {
    fnMarkClean();
    // A logged-in draft is about to report its cloud state into the same slot,
    // so don't flash "SAVED" first and make the readout stutter.
    if (currentStatus === "draft" && isLoggedIn()) return;
    _fnSyncClearLater(_fnSyncPill("SAVED", "saved"), 2000);
  }, 300);
}

export function fnDebouncedSave() {
  fnMarkDirty();
  clearTimeout(fnAutoSaveTimer);
  fnAutoSaveTimer = setTimeout(fnAutoSave, 1500);
}

// ============== CLOUD DRAFTS (D1-backed) ==============
// localStorage stays the fast local cache; D1 is the durable source of truth for
// drafts so a tab close, a cleared cache, or a second device never loses WIP. The
// cloud push is debounced longer than the local auto-save (which fires every 1.5s)
// to batch keystrokes into fewer writes. A failed push is non-fatal — the draft is
// safe in localStorage and the next save (or next login sync) reconciles it.
const _draftCloudTimers = {};

// Same slot as the local save (see _fnSyncPill). Cloud state is the more
// meaningful signal when it exists, so it lands last and stays put — only
// `saved` fades, because "☁ SYNCED" forever is noise, while "☁ RETRY" is not.
export function _setCloudStatus(state) {
  // Words, not glyphs: a ☁ that resolves out of a fallback face has no width
  // this layout can reserve for, and a clipped status is worse than none.
  const map = {
    saving:  ['SYNCING…',   'saving'],
    saved:   ['SYNCED',     'saved'],
    offline: ['LOCAL ONLY', ''],
    error:   ['RETRYING',   'error'],
    '':      ['',           ''],
  };
  const [txt, tone] = map[state] || ['', ''];
  const seq = _fnSyncPill(txt, tone);
  if (state === 'saved') _fnSyncClearLater(seq, 2600);
}

export function fnScheduleCloudDraft(id) {
  if (!id || !isLoggedIn()) return;
  clearTimeout(_draftCloudTimers[id]);
  _draftCloudTimers[id] = setTimeout(() => fnCloudPushDraft(id), 2500);
}

export async function fnCloudPushDraft(id, { force = false } = {}) {
  if (!id || !isLoggedIn()) return;
  const post = STATE.posts.find(p => p.id === id);
  if (!post || post.status !== 'draft') return;   // only drafts live in the cloud table

  // Never ship base64 hero previews to D1 — store the CDN filename only (mirrors the
  // localStorage strip); the preview re-derives from the filename on load.
  const hero_filename = (post.hero_filename && !String(post.hero_filename).startsWith('data:'))
    ? post.hero_filename : null;

  const payload = {
    id: post.id,
    fn_id: post.fn_id || '',
    title: post.title || 'Untitled',
    location: post.location || SITE_LOCATION,
    date: post.date || '',
    body: post.body || '',
    hero_filename,
    buffer_dates: post.buffer_dates || null,
    // The version this device last saw from the server. The worker applies the
    // write only while the row still matches it, so a device that has been
    // asleep with a stale copy can no longer overwrite newer work — it gets a
    // 409 and asks (below). `updated_at` is the server's to stamp now.
    base_updated_at: post._cloud_updated || 0,
    ...(force ? { force: true } : {}),
  };

  _setCloudStatus('saving');
  try {
    const data = await pushDraft(payload);
    // Stamp the watermark on the live STATE entry so a later re-sync won't clobber
    // this version with an equal-or-older cloud copy.
    const live = STATE.posts.find(p => p.id === id);
    if (live && data.updated_at) live._cloud_updated = data.updated_at;
    _setCloudStatus('saved');   // fades itself; see _fnSyncClearLater
  } catch (err) {
    if (err.status === 409 && err.data && err.data.code === 'draft_conflict') {
      _fnDraftConflict(id, payload, err.data.draft);
      return;
    }
    // Server rejected the draft → 'error' (retry pip); network gone or session
    // expired → 'offline' (localStorage still has it; next login reconciles).
    _setCloudStatus(err.status && err.status !== 401 ? 'error' : 'offline');
  }
}

// A 409 from the conditional draft write: the row moved after this device loaded
// it. Two cases, and telling them apart is what keeps this from crying wolf.
//
// 1. The server's copy is what we just tried to write. That is our OWN earlier
//    save whose response we never saw (dropped on cellular), so the base
//    version was stale through no fault of another device. Adopt the server's
//    version silently — otherwise the base stays stale and every later save
//    reports a conflict that never happened.
// 2. It genuinely differs — another device has been editing. Ask. Never
//    force-overwrite on our own initiative: losing a field note to a silent
//    resolution is the whole failure this replaced.
function _fnDraftConflict(id, sent, server) {
  const same = server && ['fn_id', 'title', 'location', 'date', 'body', 'hero_filename', 'buffer_dates']
    .every(k => (server[k] ?? '') === (sent[k] ?? ''));
  const live = STATE.posts.find(p => p.id === id);

  if (same) {
    if (live) live._cloud_updated = server.updated_at || 0;
    save();
    _setCloudStatus('saved');
    return;
  }

  _setCloudStatus('error');
  toast('⚠ draft changed on another device', 'error');
  const when = server.updated_at ? new Date(server.updated_at).toLocaleString() : 'unknown time';
  const keepMine = !confirm(
    `"${sent.title || 'Untitled'}" was edited on another device (${when}).\n\n` +
    `OK — load that version here (this device's unsaved edits to this draft are replaced).\n` +
    `Cancel — keep what is on screen and overwrite the other device's version.`
  );

  if (keepMine) {
    // Explicit, user-chosen overwrite. The base moves to the server's version so
    // the retry is a deliberate force, not a blind one.
    if (live) live._cloud_updated = server.updated_at || 0;
    fnCloudPushDraft(id, { force: true });
    return;
  }

  // Take the other device's version.
  if (live) {
    Object.assign(live, {
      fn_id: server.fn_id || '',
      title: server.title || 'Untitled',
      location: server.location || SITE_LOCATION,
      date: server.date || '',
      body: server.body || '',
      hero: null,
      hero_filename: server.hero_filename || null,
      buffer_dates: server.buffer_dates || null,
      _cloud_updated: server.updated_at || 0,
    });
  }
  save();
  renderFN();
  if (fnCurrentId === id) fnLoadPost(id);   // refresh the open editor in place
  toast('↓ loaded the other device\'s version', 'info');
  _setCloudStatus('saved');
}

export async function fnCloudDeleteDraft(id) {
  if (!id || !isLoggedIn()) return;
  clearTimeout(_draftCloudTimers[id]);
  try {
    await deleteDraft(id);
  } catch { /* non-critical — a stale row gets reconciled on the next publish/sync */ }
}

// Merge cloud drafts into STATE.posts on login sync. Unlike the GitHub-backed
// surfaces, drafts are NOT flagged _imported — they're editable local entries that
// keep persisting to localStorage and re-pushing to D1. Conflict rule: take the
// cloud copy only when it's strictly newer than what we last synced locally, so
// unsynced local edits are never overwritten (single-user, last-writer-wins).
//
// SAFETY: only ever call this with an AUTHORITATIVE, successful /api/drafts fetch
// (the call site gates on `dData.ok && Array.isArray(dData.drafts)`). The returned
// array is the complete draft set, which is what makes deletion reconciliation
// safe — a failed/partial fetch must never reach here or it would look like
// "everything was deleted".
export function mergeCloudDrafts(cloudDrafts) {
  if (!Array.isArray(cloudDrafts)) return { changed: 0, removed: 0 };
  let changed = 0;
  const cloudIds = new Set(cloudDrafts.map(d => d && d.id).filter(Boolean));

  // 1) Add / update from the authoritative cloud set.
  cloudDrafts.forEach(cd => {
    if (!cd || !cd.id) return;
    const idx = STATE.posts.findIndex(p => p.id === cd.id);
    const draft = {
      id: cd.id,
      fn_id: cd.fn_id || '',
      title: cd.title || 'Untitled',
      location: cd.location || SITE_LOCATION,
      date: cd.date || '',
      body: cd.body || '',
      hero: null,
      hero_filename: cd.hero_filename || null,
      buffer_dates: cd.buffer_dates || null,
      added_at: todayISO(),
      status: 'draft',
      _cloud_updated: cd.updated_at || 0,
    };
    if (idx === -1) {
      STATE.posts.unshift(draft);
      changed++;
    } else {
      const local = STATE.posts[idx];
      // Don't touch a post that's already been promoted to published locally.
      if (local.status && local.status !== 'draft') return;
      if ((cd.updated_at || 0) > (local._cloud_updated || 0)) {
        STATE.posts[idx] = draft;
        changed++;
      }
    }
  });

  // 2) Reconcile cross-device deletions. A LOCAL draft that was previously synced
  //    to the cloud (carries a `_cloud_updated` watermark) but is no longer in the
  //    authoritative cloud set was deleted on another device — drop it here too.
  //    Drafts WITHOUT a watermark are brand-new/offline and have simply not been
  //    pushed yet, so they're kept (they'll push on the next save). The draft open
  //    in the editor right now is never yanked out from under an active session.
  const before = STATE.posts.length;
  STATE.posts = STATE.posts.filter(p => {
    if (p.status !== 'draft') return true;     // published / imported posts untouched
    if (p.id === fnCurrentId) return true;     // never nuke the open draft
    if (!p._cloud_updated) return true;        // never synced → keep (it'll push)
    if (cloudIds.has(p.id)) return true;       // still in cloud → keep
    return false;                              // synced before, gone now → deleted elsewhere
  });
  const removed = before - STATE.posts.length;

  return { changed, removed };
}

// -- Focus mode --
// Everything that is not the writing goes; the dock and the actions stay,
// dimmed, so this is never a room you can only leave with a keystroke.
// Re-measures the textarea afterwards — the measure changes when the chrome does.
export function fnToggleFocus() {
  document.body.classList.toggle("fn-focus");
  _fnAutoGrow();
}

// -- The frontmatter no longer collapses, because there is nothing to reclaim --
// It used to be four stacked form fields costing 121px of a pane that had 239px
// left to write in, so it shipped with a TITLE ▾ toggle. It is one inline row of
// about 30px now (.fn-meta), which is cheaper than the button that hid it — and
// that button had a history: it used to take the cover dropzone down with it,
// putting the cover out of reach on exactly the screens where space was tight.
// A control that isn't needed cannot regress.

// -- Insert text at cursor in textarea --
export function fnInsertAtCursor(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const replacement = before + selected + (after || "");
  textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
  // Place cursor after inserted text or select the wrapped text
  if (selected) {
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = start + before.length + selected.length;
  } else {
    textarea.selectionStart = textarea.selectionEnd = start + before.length;
  }
  textarea.focus();
  fnRender();
  fnDebouncedSave();
}

// -- Keyboard shortcuts --
export function fnHandleKeyboard(e) {
  const textarea = document.getElementById("fn-body");
  const inFn = document.getElementById("view-fn")?.classList.contains("active");

  // Escape unwinds the overlays newest-first, then focus mode. Works from
  // anywhere in the view, not just the textarea — you press it having just
  // clicked something in the thing you want closed.
  if (e.key === "Escape" && inFn) {
    if (document.getElementById("fn-menu") && !document.getElementById("fn-menu").hidden) {
      e.preventDefault(); fnToggleMenu(false); return;
    }
    if (!document.getElementById("fn-drawer")?.classList.contains("hidden")) {
      e.preventDefault(); fnCloseDrawer(); return;
    }
    if (fnPreviewOpen) { e.preventDefault(); fnClosePreview(); return; }
    if (document.body.classList.contains("fn-focus")) { e.preventDefault(); fnToggleFocus(); return; }
  }

  // ⌘P toggles the preview from anywhere in the view (it is a view-level
  // overlay, not a textarea command) — and stops the browser print dialog.
  if (inFn && (e.metaKey || e.ctrlKey) && e.key === "p") {
    e.preventDefault();
    fnTogglePreview();
    return;
  }

  // Everything below edits text, so it needs the caret.
  if (document.activeElement !== textarea) return;

  const isMod = e.metaKey || e.ctrlKey;

  // Tab → insert 2 spaces
  if (e.key === "Tab" && !isMod) {
    e.preventDefault();
    fnInsertAtCursor(textarea, "  ", "");
    return;
  }

  if (!isMod) return;

  // Cmd+B → bold
  if (e.key === "b") {
    e.preventDefault();
    fnInsertAtCursor(textarea, "**", "**");
    return;
  }
  // Cmd+I → italic
  if (e.key === "i") {
    e.preventDefault();
    fnInsertAtCursor(textarea, "*", "*");
    return;
  }
  // Cmd+K → link
  if (e.key === "k") {
    e.preventDefault();
    const sel = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
    if (sel) {
      fnInsertAtCursor(textarea, "[", "](url)");
    } else {
      fnInsertAtCursor(textarea, "[link text](", ")");
    }
    return;
  }
  // Cmd+Enter → stage post
  if (e.key === "Enter") {
    e.preventDefault();
    fnStage();
    return;
  }
}

// -- Inline image drop on textarea --
export function fnHandleImageDrop(e) {
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  const images = [...files].filter(f => f.type.startsWith("image/"));
  if (!images.length) return;
  e.preventDefault();

  const textarea = document.getElementById("fn-body");
  images.forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      const base = cleanFilename(file.name).replace(/\.[^.]+$/, "");
      const cdnPath = `/api/cdn/archive/${base}-1024w.webp`;
      // Cache local preview
      fnInlineImageCache[cdnPath] = reader.result;
      // Insert markdown at cursor
      const snippet = `\n![${base}](${cdnPath})\n`;
      fnInsertAtCursor(textarea, snippet, "");
    };
    reader.readAsDataURL(file);
  });
}

// -- Wire everything up on load --
export function fnSetupEnhancements() {
  const body = document.getElementById("fn-body");
  const title = document.getElementById("fn-title");
  const loc = document.getElementById("fn-location");
  const date = document.getElementById("fn-date");
  const fnId = document.getElementById("fn-id");

  // Auto-save + live preview on input
  [body, title, loc, date, fnId].forEach(el => {
    if (!el) return;
    el.addEventListener("input", () => {
      fnRender();
      fnDebouncedSave();
    });
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", fnHandleKeyboard);

  // Paste handler: a bare Apple Music share link (all the iPad share sheet
  // gives you) auto-expands to the full embed snippet, so dropping the link in
  // behaves exactly like pasting the laptop "Embed" code. Anything else pastes
  // normally.
  if (body) {
    body.addEventListener("paste", e => {
      const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
      const src = appleMusicEmbedSrc(text);
      if (!src) return;
      e.preventDefault();
      fnInsertAtCursor(body, `\n${appleMusicIframe(src)}\n`, "");
      toast("✓ Apple Music link expanded to player", "success");
    });
  }

  // Drop handler: frame strips from browser take priority over image drop
  if (body) {
    body.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    body.addEventListener("drop", e => {
      const frameIds = e.dataTransfer.getData('text/plain');
      if (frameIds && /^[a-z0-9,\s]+$/.test(frameIds)) {
        e.preventDefault();
        const shortcode = `\n<div class="buffer-inline" data-frames="${frameIds}"></div>\n`;
        const start = body.selectionStart;
        body.value = body.value.slice(0, start) + shortcode + body.value.slice(body.selectionEnd);
        body.selectionStart = body.selectionEnd = start + shortcode.length;
        body.focus();
        fnRender();
        fnDebouncedSave();
        toast(`✓ inserted frame strip`, "success");
        return;
      }
      fnHandleImageDrop(e);
    });
  }

  // The textarea has no scrollbar of its own to sync any more — it grows and
  // the canvas scrolls — so re-measure it whenever its content changes by a
  // route that isn't typing (a load, an insert, a paste).
  if (body) body.addEventListener("input", _fnAutoGrow);

  // Click-away closes the ⋯ menu. Capture phase, so a click on a control
  // inside the menu still runs its own handler first (fnMenuRun closes it).
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("fn-menu");
    if (!menu || menu.hidden) return;
    if (e.target.closest("#fn-menu") || e.target.closest("#fn-menu-btn")) return;
    fnToggleMenu(false);
  });

  // The measure changes with the window, so the grown height has to as well.
  window.addEventListener("resize", _fnAutoGrow);
}

// ============== PHASE 4: BUFFER DATES PICKER ==============

export function getBufferFrameNumbers() {
  const sorted = [...STATE.buffer].sort((a, b) => {
    const dayA = ymd(a.captured_at || a.published_at);
    const dayB = ymd(b.captured_at || b.published_at);
    const dayCmp = dayA.localeCompare(dayB);
    if (dayCmp !== 0) return dayCmp;
    return (a.filename || '').localeCompare(b.filename || '');
  });
  const map = new Map();
  sorted.forEach((e, i) => map.set(e.id, i + 1));
  return map;
}

// Clear the selected buffer dates. Exported because the Clear button is rendered
// into innerHTML and fires in global scope — see _assetLibrarySetFilter above.
export function fnClearBufferDates() {
  fnCurrentBufferDates = [];
  fnRenderBufferDates();
  fnRender();
}

export function fnRenderBufferDates() {
  const container = document.getElementById("fn-buffer-dates-panel");
  if (!container) return;

  if (!STATE.buffer.length) {
    container.innerHTML = `<div style="padding:10px 14px; font-size:0.62rem; color:var(--text-faint); letter-spacing:1.5px;">// BUFFER EMPTY — import buffer.json or drop photos in Buffer view</div>`;
    return;
  }

  const byDay = {};
  STATE.buffer.forEach(e => {
    const day = ymd(e.captured_at || e.published_at);
    (byDay[day] = byDay[day] || []).push(e);
  });
  Object.values(byDay).forEach(arr => arr.sort((a, b) => (a.filename || '').localeCompare(b.filename || '')));
  const days = Object.keys(byDay).sort().reverse();
  const selectedSet = new Set(fnCurrentBufferDates);

  const checkboxesHtml = days.map(day => {
    const count = byDay[day].length;
    const checked = selectedSet.has(day) ? 'checked' : '';
    return `<label class="bd-date-row">
      <input type="checkbox" class="bd-checkbox" ${checked} onchange="fnToggleBufferDate('${day}')">
      <span class="bd-date">${day.replace(/-/g, '·')}</span>
      <span class="bd-count">${count} frame${count !== 1 ? 's' : ''}</span>
    </label>`;
  }).join('');

  const currentVal = fnCurrentBufferDates.length > 0
    ? `${fnCurrentBufferDates.length} date${fnCurrentBufferDates.length !== 1 ? 's' : ''} selected`
    : '// no dates selected';

  container.innerHTML = `
    <div class="fb-toolbar">
      <span class="fb-selected-count">${currentVal}</span>
      <button class="btn btn-sm btn-stage" onclick="fnInsertDateBlocks()" style="padding:3px 10px; font-size:0.6rem;">Insert Date(s)</button>
      <button class="btn btn-sm btn-ghost" onclick="fnClearBufferDates()" style="padding:3px 8px; font-size:0.6rem;">Clear</button>
    </div>
    <div class="bd-list">${checkboxesHtml}</div>`;
}

export function fnToggleBufferDate(date) {
  const idx = fnCurrentBufferDates.indexOf(date);
  if (idx >= 0) fnCurrentBufferDates.splice(idx, 1);
  else { fnCurrentBufferDates.push(date); fnCurrentBufferDates.sort().reverse(); }
  fnRenderBufferDates();
  fnRender();
}

// ============== PHASE 4: FRAME BROWSER ==============

export function fnRenderFrameBrowser() {
  const panel = document.getElementById("fn-frame-browser");
  if (!panel) return;

  if (!STATE.buffer.length) {
    panel.innerHTML = `<div style="padding:16px 14px; font-size:0.62rem; color:var(--text-faint); letter-spacing:1.5px;">// BUFFER EMPTY — import buffer.json or drop photos in Buffer view</div>`;
    return;
  }

  const frameNumbers = getBufferFrameNumbers();
  const byDay = {};
  STATE.buffer.forEach(e => {
    const day = ymd(e.captured_at || e.published_at);
    (byDay[day] = byDay[day] || []).push(e);
  });
  Object.values(byDay).forEach(arr => arr.sort((a, b) => (a.filename || '').localeCompare(b.filename || '')));
  const days = Object.keys(byDay).sort().reverse();

  const html = days.map(day => {
    const entries = byDay[day];
    const thumbs = entries.map(e => {
      const num = String(frameNumbers.get(e.id) || 0).padStart(3, '0');
      const base = (e.filename || '').replace(/\.webp$/, '');
      const src = e.image || `${CDN_BASE}/archive/${encodeURIComponent(base)}-480w.webp`;
      const selected = fnSelectedFrameIds.has(e.id) ? ' fb-selected' : '';
      return `<div class="fb-thumb${selected}" data-id="${e.id}"
          onclick="fnToggleFrameSelect('${e.id}')"
          draggable="true" ondragstart="fnDragFrame('${e.id}', event)">
          <img src="${src}" alt="" onerror="this.style.display='none'">
          <div class="fb-num">${num}</div>
        </div>`;
    }).join('');
    return `<div class="fb-day">
        <div class="fb-day-hdr">
          <span style="color:var(--accent);">//</span>
          <span>${day.replace(/-/g, '·')}</span>
          <span class="fb-day-count">${entries.length} fr</span>
        </div>
        <div class="fb-grid">${thumbs}</div>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="fb-toolbar">
      <span class="fb-selected-count" id="fb-selected-count">${fnSelectedFrameIds.size} selected</span>
      <button class="btn btn-sm btn-stage" onclick="fnInsertFrameStrip()" style="padding:3px 10px; font-size:0.6rem;">Insert Strip</button>
      <button class="btn btn-sm btn-ghost" onclick="fnClearFrameSelection()" style="padding:3px 8px; font-size:0.6rem;">Clear</button>
    </div>
    <div class="fb-scroll">${html}</div>
  `;
}

export function fnToggleFrameSelect(id) {
  if (fnSelectedFrameIds.has(id)) fnSelectedFrameIds.delete(id);
  else fnSelectedFrameIds.add(id);
  fnRenderFrameBrowser();
}

export function fnClearFrameSelection() {
  fnSelectedFrameIds.clear();
  fnRenderFrameBrowser();
}

export function fnDragFrame(id, e) {
  fnSelectedFrameIds.add(id);
  const ids = [...fnSelectedFrameIds].join(', ');
  e.dataTransfer.setData('text/plain', ids);
  e.dataTransfer.effectAllowed = 'copy';
}

export function fnInsertFrameStrip() {
  if (!fnSelectedFrameIds.size) return toast("no frames selected", "error");
  const ids = [...fnSelectedFrameIds].join(', ');
  const shortcode = `\n<div class="buffer-inline" data-frames="${ids}"></div>\n`;
  const textarea = document.getElementById("fn-body");
  fnInsertAtCursor(textarea, shortcode, "");
  toast(`✓ inserted strip: ${fnSelectedFrameIds.size} frame${fnSelectedFrameIds.size !== 1 ? 's' : ''}`, "success");
  fnCloseDrawer();   // the drawer's job is done; get back to the page
}

export function fnInsertDateBlocks() {
  if (!fnCurrentBufferDates.length) return toast("no dates selected", "error");
  const tags = fnCurrentBufferDates
    .map(d => `<div class="buffer-date" data-date="${d}"></div>`)
    .join('\n');
  const textarea = document.getElementById("fn-body");
  fnInsertAtCursor(textarea, '\n' + tags + '\n', '');
  const count = fnCurrentBufferDates.length;
  fnCurrentBufferDates = [];
  fnRenderBufferDates();
  toast(`✓ inserted ${count} date block${count !== 1 ? 's' : ''}`, "success");
  fnCloseDrawer();
}
