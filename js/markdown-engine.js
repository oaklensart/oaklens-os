// OAKLENS // FN// markdown engine (ES module).
//
// THE renderer for Field Notes — both the console's live preview
// (js/console-ui.js imports it) and the published post page
// (field-notes/post.html imports it), so preview and published output are
// the same pixels by construction. Dependency-free: this module replaced
// the CDN-loaded marked.js on the public site (v2), which kept the
// published site literally dependency-free and closed a preview/publish
// divergence — marked passed raw HTML through while v1 of this engine
// escaped it, so `<video>` clips and `.buffer-inline` embeds previewed as
// literal text.
//
// The dialect is deliberately small (see renderMarkdown) — the FN voice
// doesn't use tables/code fences/nesting, and the console preview is the
// contract for what publishes.
//
// fnInlineImageCache maps a markdown image src to a local preview data-URL
// (populated by the editor's inline image drop); renderMarkdown resolves
// through it so dropped-but-unpublished images still show in the preview.

// -- Inline image cache for local previews --
export const fnInlineImageCache = {};

// ---- attribute safety (v1 review Mo3) ----
//
// renderMarkdown escapes &, < and > wholesale before it builds any tag, so the
// DOUBLE QUOTE is the only dangerous character left — and it is the one that
// matters, because an unescaped `"` ends the attribute and everything after it
// is parsed as markup. `![24" monitor](x)` was enough to do it: a benign note
// about a monitor emitted `alt="24" monitor"`, and `![a](x" onerror="alert(1))`
// emitted a live onerror.
//
// The published pages were never exposed — their strict CSP has no
// 'unsafe-inline', which neuters both an inline handler and a `javascript:`
// href. But the CONSOLE PREVIEW runs the relaxed /dev policy and renders with
// this same engine, so there it was author-scoped self-XSS: paste someone
// else's markdown into your own editor and it runs. Relying on the CSP to be
// the only thing between a quote and an event handler is the kind of
// single-layer defence that stops being true the moment a surface moves.
const attrEscape = (v) => String(v).replace(/"/g, '&quot;');

// A URL with no scheme is relative (`/wall`, `#anchor`, `img.webp`) and always
// fine. One WITH a scheme has to be on the list. Control characters and spaces
// are stripped before the test — a literal tab inside `java<TAB>script:` is the
// classic bypass, and
// entity-encoded variants are already dead because & was escaped upstream.
const hasScheme = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u);
const normalizeUrl = (u) => String(u).replace(/[\u0000-\u0020]+/g, '');

// Links: the web's schemes plus the two a note might legitimately reach for.
const safeHref = (u) => {
  const v = normalizeUrl(u);
  return !hasScheme(v) || /^(?:https?|mailto|tel):/i.test(v);
};

// Images: http(s), relative, or the data: URL the inline image cache hands back
// for a dropped-but-unpublished preview (FileReader.readAsDataURL -> an
// image/* payload). Narrowed to image/ on purpose — nothing else belongs in a
// src, and a bare `data:` allowance is a hole for no benefit.
const safeImgSrc = (u) => {
  const v = normalizeUrl(u);
  return !hasScheme(v) || /^https?:/i.test(v) || /^data:image\//i.test(v);
};

// ============== APPLE MUSIC EMBEDS ==============
// Apple Music's desktop site hands you a full <iframe> embed snippet, but the
// iOS/iPadOS share sheet only gives a plain link (e.g.
// https://music.apple.com/us/station/.../ra.cp-1885140644 — no embed code).
// These helpers turn that bare link into the same player widget, so the iPad
// workflow matches the laptop one: drop the link, get the player.

// Whether this instance builds Apple Music players at all (site.config.js →
// `appleMusicEmbeds`, worker-injected as <meta name="site-apple-music">, the
// site-wordmark seam). Off, a bare share link renders as a plain link instead
// of a player the CSP (frame-src 'none') would block into a dead grey box —
// the policy is the enforcement, this is honesty, and the console preview
// reads the same meta so previews don't lie. No document (tests, the
// classicized file:// export shim) or no meta (pages served before the flag
// existed) keeps the players: enforcement never rests on this check.
export function appleMusicEmbedsEnabled() {
  if (typeof document === 'undefined') return true;
  const meta = document.querySelector('meta[name="site-apple-music"]');
  return meta ? meta.content !== 'off' : true;
}

// Normalize any Apple Music URL into an embeddable player src, or null if the
// string isn't a recognizable link. The only difference between a share link
// and an embed src is the host (embed.music.apple.com) — the path/query
// (album, playlist, song's ?i=, station, artist) is otherwise identical.
export function appleMusicEmbedSrc(url) {
  const m = String(url || "").trim().match(/^https?:\/\/(?:embed\.)?music\.apple\.com\/([^\s"'<>]+)$/i);
  return m ? "https://embed.music.apple.com/" + m[1] : null;
}

// Build the Apple Music <iframe> snippet from an embed src — mirrors the markup
// Apple's own "Embed" button emits. Songs get the compact 175px player;
// albums/playlists/stations get the tall 450px one. theme=dark is left to the
// renderers (they append it on the way out), so it isn't doubled here.
export function appleMusicIframe(embedSrc) {
  const isSong = /\/song\//i.test(embedSrc) || /[?&]i=/.test(embedSrc);
  const height = isSong ? 175 : 450;
  return `<iframe allow="autoplay *; encrypted-media *;" frameborder="0" height="${height}" `
    + `style="width:100%;max-width:660px;overflow:hidden;background:transparent;" `
    + `sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" `
    + `src="${embedSrc}"></iframe>`;
}

// Tiny markdown subset — expanded in v0.7; raw-HTML stash generalized in v2;
// frame refs (f#N — manual §5.20) added in v3
export function renderMarkdown(md) {
  if (!md) return "";

  // Stash the raw HTML the FN dialect allows (pasted music iframes, <video>
  // clips, .buffer-inline embed divs) before escaping, so author markup
  // survives — and, critically, so the inline rules can't chew on attribute
  // text (`allow="autoplay *;"` once grew an <em> mid-iframe). Everything
  // else that looks like HTML still gets escaped. Restored at the very end.
  // Flat by design: the dialect has no nested raw blocks.
  const htmlBlocks = [];
  const stash = (block) => {
    htmlBlocks.push(block);
    return `%%FNHTML_${htmlBlocks.length - 1}%%`;
  };
  let tempMd = md.replace(/<(iframe|video|div)\b[\s\S]*?<\/\1\s*>/gi, stash);

  // A bare Apple Music link on its own line (the iPad share sheet gives no
  // embed code) becomes a player too: convert it to an iframe and stash it
  // alongside the pasted ones so it gets the same dark-theme + wrapper pass.
  // With embeds off it becomes a plain link instead — a recognized URL has
  // passed appleMusicEmbedSrc's charset (no quotes or angle brackets), so it
  // is safe to place in an href. Pasted iframes and ::music blocks still pass
  // through: on a public page frame-src 'none' blocks those anyway.
  tempMd = tempMd.replace(/^[ \t]*(https?:\/\/(?:embed\.)?music\.apple\.com\/\S+?)[ \t]*$/gim, (line, url) => {
    const src = appleMusicEmbedSrc(url);
    if (!src) return line;
    if (!appleMusicEmbedsEnabled()) return stash(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
    return stash(appleMusicIframe(src));
  });

  // Legacy ::music block — stashed pre-escape for the same attribute safety
  tempMd = tempMd.replace(/^::music\s+(\S+)$/gm, (_, url) =>
    stash(`<iframe allow="autoplay *; encrypted-media *;" frameborder="0" height="150" sandbox="allow-forms allow-popups allow-same-origin allow-scripts" src="${url}"></iframe>`));

  // Escape standard HTML
  let html = tempMd.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Restore <strong>, </strong>, <em>, </em>, <br> passthrough
  html = html.replace(/&lt;strong&gt;/g, "<strong>").replace(/&lt;\/strong&gt;/g, "</strong>");
  html = html.replace(/&lt;em&gt;/g, "<em>").replace(/&lt;\/em&gt;/g, "</em>");
  html = html.replace(/&lt;br\s*\/?&gt;/g, "<br>");

  // images — ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    // Check inline image cache for local previews
    const resolved = fnInlineImageCache[src] || src;
    // A src the engine will not vouch for degrades to the alt text rather than
    // emitting a tag: the note still reads, and nothing is silently swallowed.
    if (!safeImgSrc(resolved)) return alt;
    return `<img src="${attrEscape(resolved)}" alt="${attrEscape(alt)}">`;
  });

  // headings (longest marker first so ###/## aren't eaten by the # rule) —
  // match marked.js on the live site, which renders every level
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // hr
  html = html.replace(/^---$/gm, "<hr>");
  // bold/italic/code
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // links — external ones open a new tab; internal (/wall, #anchor) navigate
  // in place like any site link
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
    // An unsafe scheme keeps its words and loses its link — the same posture as
    // the image above, and what every markdown sanitizer does with a
    // `javascript:` href.
    if (!safeHref(href)) return text;
    const h = attrEscape(href);
    return /^https?:/i.test(href)
      ? `<a href="${h}" target="_blank">${text}</a>`
      : `<a href="${h}">${text}</a>`;
  });
  // frame refs — f#234 / frame#234, case-insensitive, zero-padding optional
  // (manual §5.20). Never inside a code span (`f#12` stays literal); stashed
  // raw HTML is already out of reach (%%FNHTML_n%% placeholders). Emits an
  // unresolved anchor — no href: the renderer stays DOM-free and data-free,
  // and resolution against buffer.json happens at hydrate time (post page +
  // console preview both own that step).
  html = html.split(/(<code>[\s\S]*?<\/code>)/).map((seg, i) =>
    i % 2 ? seg : seg.replace(/\b(?:frame|f)#(\d+)\b/gi, (m, num) =>
      `<a class="frame-ref" data-frame="${parseInt(num, 10)}">${m}</a>`)
  ).join("");

  // Process blocks: paragraphs, lists, blockquotes
  const blocks = html.split(/\n{2,}/);
  const rendered = blocks.map(b => {
    const trimmed = b.trim();
    if (!trimmed) return "";
    // Already an HTML block element (or a stashed raw-HTML block)
    if (/^(<(h1|h2|h3|hr|iframe|div|img)|%%FNHTML_\d+%%)/i.test(trimmed)) return trimmed;
    // Unordered list block (lines starting with - )
    if (/^- /m.test(trimmed) && trimmed.split("\n").every(l => l.trim() === "" || /^- /.test(l.trim()))) {
      const items = trimmed.split("\n")
        .filter(l => /^- /.test(l.trim()))
        .map(l => `<li>${l.trim().replace(/^- /, "")}</li>`);
      return `<ul>${items.join("")}</ul>`;
    }
    // Ordered list block (lines starting with 1. 2. etc)
    if (/^\d+\. /m.test(trimmed) && trimmed.split("\n").every(l => l.trim() === "" || /^\d+\. /.test(l.trim()))) {
      const items = trimmed.split("\n")
        .filter(l => /^\d+\. /.test(l.trim()))
        .map(l => `<li>${l.trim().replace(/^\d+\. /, "")}</li>`);
      return `<ol>${items.join("")}</ol>`;
    }
    // Blockquote block (lines starting with > )
    if (/^&gt; /m.test(trimmed)) {
      const lines = trimmed.split("\n")
        .map(l => l.replace(/^&gt;\s?/, ""))
        .join("<br>");
      return `<blockquote>${lines}</blockquote>`;
    }
    return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
  });

  // Restore stashed raw HTML last, after every text rule has run. Apple
  // Music iframes (pasted, bare-link, ::music alike) get theme=dark and the
  // styled wrapper on the way out; video/div blocks pass through untouched.
  return rendered.join("\n").replace(/%%FNHTML_(\d+)%%/g, (_, idx) => {
    let block = htmlBlocks[parseInt(idx)];
    if (/<iframe[^>]*\bsrc="[^"]*music\.apple\.com/i.test(block)) {
      if (!block.includes("theme=dark")) {
        block = block.replace(/src="([^"]+)"/, (m, url) => `src="${url}${url.includes("?") ? "&" : "?"}theme=dark"`);
      }
      return `<div class="apple-music-embed">${block}</div>`;
    }
    return block;
  });
}
