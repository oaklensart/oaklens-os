// markdown-engine.js — THE FN// renderer (console preview + post.html).
// Dialect tests pin the subset's behavior; the corpus tests run every
// published post body through the engine and assert the invariants that
// the marked.js → engine consolidation was audited against (2026-07-08):
// raw-HTML embeds survive, music iframes get the dark theme + wrapper, and
// no inline rule ever chews on stashed attribute text.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdown, appleMusicEmbedSrc, appleMusicIframe, appleMusicEmbedsEnabled } from '../js/markdown-engine.js';
import { hasPosts } from './helpers/instance-content.js';

// The dialect tests below are engine behaviour and always run. The corpus
// tests need this instance's published posts, which the extracted engine tree
// ships none of — see tests/helpers/instance-content.js.
const POSTS = join(import.meta.dirname, '..', 'posts');
const HAS_POSTS = hasPosts();
const bodyOf = (p) => {
  const c = readFileSync(join(POSTS, p), 'utf8');
  const m = c.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/);
  return m ? m[1] : c;
};

describe('dialect basics', () => {
  it('renders paragraphs, breaks, bold, italic, code, headings, hr', () => {
    const out = renderMarkdown('# H1\n\n## H2\n\nline one\nline two **bold** *it* `c`\n\n---');
    expect(out).toContain('<h1>H1</h1>');
    expect(out).toContain('<h2>H2</h2>');
    expect(out).toContain('line one<br>line two <strong>bold</strong> <em>it</em> <code>c</code>');
    expect(out).toContain('<hr>');
  });

  it('links: external opens a new tab, internal navigates in place', () => {
    const out = renderMarkdown('[ext](https://example.com) and [wall](/wall)');
    expect(out).toContain('<a href="https://example.com" target="_blank">ext</a>');
    expect(out).toContain('<a href="/wall">wall</a>');
  });

  it('lists and blockquotes', () => {
    const out = renderMarkdown('- a\n- b\n\n1. x\n2. y\n\n> quoted\n> lines');
    expect(out).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(out).toContain('<ol><li>x</li><li>y</li></ol>');
    expect(out).toContain('<blockquote>quoted<br>lines</blockquote>');
  });
});

describe('raw-HTML dialect (the marked parity surface)', () => {
  it('passes <video> through unescaped', () => {
    const out = renderMarkdown('before\n\n<video src="/api/cdn/blog/clip.mp4" autoplay loop muted playsinline></video>\n\nafter');
    expect(out).toContain('<video src="/api/cdn/blog/clip.mp4" autoplay loop muted playsinline></video>');
    expect(out).not.toContain('&lt;video');
  });

  it('passes .buffer-inline embed divs through unescaped', () => {
    const out = renderMarkdown('<div class="buffer-inline" data-frames="a1, b2"></div>');
    expect(out).toContain('<div class="buffer-inline" data-frames="a1, b2"></div>');
    expect(out).not.toContain('&lt;div');
  });

  it('still escapes HTML outside the dialect', () => {
    const out = renderMarkdown('<script>alert(1)</script> and <span onclick="x()">t</span>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&lt;span');
    expect(out).not.toContain('<script>');
  });

  it('never lets inline rules chew on stashed attributes (the em-in-iframe bug)', () => {
    const iframe = '<iframe allow="autoplay *; encrypted-media *;" frameborder="0" height="150" src="https://embed.music.apple.com/us/album/x/1?i=2"></iframe>';
    const out = renderMarkdown(`text\n\n${iframe}\n\nmore`);
    expect(out).toContain('allow="autoplay *; encrypted-media *;"');
    expect(out).not.toContain('<em>; encrypted-media </em>');
  });
});

describe('Apple Music embeds', () => {
  it('normalizes share links to embed srcs', () => {
    expect(appleMusicEmbedSrc('https://music.apple.com/us/album/a/1?i=2'))
      .toBe('https://embed.music.apple.com/us/album/a/1?i=2');
    expect(appleMusicEmbedSrc('not a link')).toBeNull();
  });

  it('songs get the compact player, albums the tall one', () => {
    expect(appleMusicIframe('https://embed.music.apple.com/us/album/a/1?i=2')).toContain('height="175"');
    expect(appleMusicIframe('https://embed.music.apple.com/us/album/a/1')).toContain('height="450"');
  });

  it('a bare link on its own line becomes a dark-themed wrapped player', () => {
    const out = renderMarkdown('https://music.apple.com/us/album/a/1?i=2\n\nprose');
    expect(out).toContain('<div class="apple-music-embed"><iframe');
    expect(out).toContain('theme=dark');
  });

  it('pasted iframes and legacy ::music get the same treatment', () => {
    const pasted = renderMarkdown('<iframe src="https://embed.music.apple.com/us/album/a/1"></iframe>');
    expect(pasted).toContain('class="apple-music-embed"');
    expect(pasted).toContain('theme=dark');
    const legacy = renderMarkdown('::music https://embed.music.apple.com/us/album/a/1');
    expect(legacy).toContain('class="apple-music-embed"');
    expect(legacy).toContain('theme=dark');
  });
});

describe('appleMusicEmbeds off (site.config.js flag, via the worker-injected meta)', () => {
  // The engine reads <meta name="site-apple-music"> (src/shared/site.js
  // injects it, same seam as site-wordmark). Fake just enough document for
  // that one read; afterEach restores the no-document (= embeds on) default.
  const metaDocument = (content) => ({
    querySelector: (sel) =>
      sel === 'meta[name="site-apple-music"]' ? { content } : null,
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a bare share link degrades to a plain link, not a player', () => {
    vi.stubGlobal('document', metaDocument('off'));
    const out = renderMarkdown('https://music.apple.com/us/album/a/1?i=2\n\nprose');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('apple-music-embed');
    expect(out).toContain(
      '<a href="https://music.apple.com/us/album/a/1?i=2" target="_blank" rel="noopener">https://music.apple.com/us/album/a/1?i=2</a>');
  });

  it('meta "on" and a missing meta both keep the player', () => {
    // "on" is the flag; the missing-meta default protects pages rendered
    // before the meta existed (and the classicized file:// export shim).
    // Enforcement is CSP frame-src, never this check.
    vi.stubGlobal('document', metaDocument('on'));
    expect(renderMarkdown('https://music.apple.com/us/album/a/1?i=2')).toContain('apple-music-embed');
    vi.stubGlobal('document', { querySelector: () => null });
    expect(renderMarkdown('https://music.apple.com/us/album/a/1?i=2')).toContain('apple-music-embed');
  });

  it('exposes the check itself for other surfaces', () => {
    vi.stubGlobal('document', metaDocument('off'));
    expect(appleMusicEmbedsEnabled()).toBe(false);
    vi.stubGlobal('document', metaDocument('on'));
    expect(appleMusicEmbedsEnabled()).toBe(true);
  });
});

describe('frame refs (f#N — manual §5.20)', () => {
  it('emits an unresolved anchor: class + normalized data-frame, no href', () => {
    const out = renderMarkdown('see f#234 mid-sentence');
    expect(out).toContain('<a class="frame-ref" data-frame="234">f#234</a>');
    expect(out).not.toMatch(/frame-ref[^>]*href=/);
  });

  it('accepts frame#N, any case, optional zero padding — keeping the author spelling', () => {
    const out = renderMarkdown('Frame#0042 and F#7');
    expect(out).toContain('<a class="frame-ref" data-frame="42">Frame#0042</a>');
    expect(out).toContain('<a class="frame-ref" data-frame="7">F#7</a>');
  });

  it('never matches inside a code span or mid-word', () => {
    const out = renderMarkdown('literal `f#12` in code, and shelf#2 stays text');
    expect(out).toContain('<code>f#12</code>');
    expect(out).not.toContain('data-frame="12"');
    expect(out).not.toContain('data-frame="2"');
  });

  it('never matches inside stashed raw HTML', () => {
    const out = renderMarkdown('<div class="buffer-inline" data-frames="f#9"></div>\n\nreal f#9 here');
    expect(out).toContain('data-frames="f#9"');           // attribute untouched
    expect(out.match(/class="frame-ref"/g).length).toBe(1); // only the prose ref
  });

  it('plays alongside the other inline rules', () => {
    const out = renderMarkdown('**bold f#3** and *em*');
    expect(out).toContain('<strong>bold <a class="frame-ref" data-frame="3">f#3</a></strong>');
  });
});

describe.skipIf(!HAS_POSTS)('published corpus invariants', () => {
  // Collected even when skipped, so this must not touch a missing directory.
  const posts = HAS_POSTS ? readdirSync(POSTS).filter((f) => f.endsWith('.md')).sort() : [];

  it.each(posts.map((p) => [p]))('%s renders cleanly', (p) => {
    const out = renderMarkdown(bodyOf(p));
    // no escaped dialect HTML leaking as text
    expect(out).not.toMatch(/&lt;(video|iframe|div)/i);
    // no inline-rule damage inside embed attributes
    expect(out).not.toContain('<em>; encrypted-media');
    // every music player is themed and wrapped
    for (const m of out.matchAll(/<iframe[^>]*music\.apple\.com[^>]*>/gi)) {
      expect(m[0]).toContain('theme=dark');
    }
  });

  it('fn-004 keeps its video, fn-007 its buffer-inline embed', () => {
    expect(renderMarkdown(bodyOf('fn-004.md'))).toContain('<video src="/api/cdn/blog/rolling_buffer_update_v2.mp4"');
    expect(renderMarkdown(bodyOf('fn-007.md'))).toContain('<div class="buffer-inline"');
  });
});


// ---- Mo3: attributes are escaped, schemes are checked ----
//
// The engine escapes &, < and > before it builds any tag, which left the DOUBLE
// QUOTE as the only way out of an attribute — and no scheme check at all on a
// link. Logged 2026-08-24 as Mo3, fixed 2026-09-16.
//
// The published pages were never exposed: their strict CSP carries no
// 'unsafe-inline', which kills both an inline handler and a javascript: href.
// The CONSOLE PREVIEW is the surface that was — it runs the relaxed /dev policy
// through this same engine, so it was author-scoped self-XSS. These tests are
// on the ENGINE for that reason: the CSP is a second layer, not the only one,
// and a renderer that is only safe because of where it happens to run stops
// being safe the day it runs somewhere else.
describe('attribute escaping', () => {
  it('a quote in alt text does not end the attribute', () => {
    // The benign case that proves it, and the reason this is a correctness bug
    // before it is a security one: a note about a 24" monitor.
    const out = renderMarkdown('![24" monitor](/img.webp)');
    expect(out).toContain('alt="24&quot; monitor"');
    expect(out).not.toContain('alt="24" monitor"');
  });

  // Note what these assert and what they do NOT. The text `onerror=` still
  // appears in the output — inside the src VALUE, inert, because the quotes
  // around it are escaped. Asserting /\sonerror=/ is absent fails against
  // correct output, which is how the first draft of these two tests failed.
  // What must be absent is `onerror="` with a REAL quote: that is the form
  // that would close the value and start a live attribute.
  it('a quote in an image src cannot open a second attribute', () => {
    const out = renderMarkdown('![a](x" onerror="boom)');
    expect(out, 'a live onerror attribute must not survive').not.toContain('onerror="');
    expect(out, 'the quotes are what neutralise it').toContain('&quot;');
  });

  it('a quote in an href cannot open a second attribute', () => {
    const out = renderMarkdown('[t](/a" onclick="boom)');
    expect(out).not.toContain('onclick="');
    expect(out).toContain('&quot;');
  });
});

describe('link and image schemes', () => {
  it('keeps the words and drops the link for a javascript: href', () => {
    const out = renderMarkdown('[click me](javascript:boom)');
    expect(out).not.toContain('javascript:');
    expect(out, 'the text survives — nothing is silently swallowed').toContain('click me');
    expect(out).not.toMatch(/<a\b/);
  });

  it('is not fooled by a control character inside the scheme', () => {
    // The classic bypass. Entity-encoded variants are already dead upstream
    // (& is escaped before any of this runs), so the raw form is what is left.
    const out = renderMarkdown('[x](java\tscript:boom)');
    expect(out).not.toMatch(/<a\b/);
  });

  it('still allows the schemes a note actually uses', () => {
    expect(renderMarkdown('[e](https://example.com)')).toContain('<a href="https://example.com"');
    expect(renderMarkdown('[m](mailto:someone@example.com)')).toContain('<a href="mailto:someone@example.com"');
    expect(renderMarkdown('[w](/wall)')).toContain('<a href="/wall">');
    expect(renderMarkdown('[a](#anchor)')).toContain('<a href="#anchor">');
  });

  it('allows the data:image URL the inline preview cache hands back', () => {
    // fn-editor drops an image, FileReader gives a data: URL, and the preview
    // resolves through fnInlineImageCache. Breaking this breaks image drop.
    const out = renderMarkdown('![a](data:image/webp;base64,AAAA)');
    expect(out).toContain('<img src="data:image/webp;base64,AAAA"');
  });

  it('refuses a data: URL that is not an image', () => {
    const out = renderMarkdown('![a](data:text/html,<script>boom</script>)');
    expect(out).not.toContain('data:text/html');
  });
});
