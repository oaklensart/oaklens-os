// The homepage audio PLAYLIST card — the tile that appears once two or more
// tracks are pinned. These pin the three things that were wrong when the layer
// was first wired, each of which passed the suite and looked fine in a browser
// on the happy path:
//
//   1. The card painted itself with `var(--well, …)`. No theme defines --well,
//      so every instance took the hardcoded near-black fallback and the card
//      rendered as a dark slab on every LIGHT preset.
//   2. Auto-advance passed `onended: player.onended` when loading the next
//      track — a property the player API does not expose. It was always
//      undefined, so the queue died silently after the second track.
//   3. The DOM-sibling auto-advance fallback looked for `.wk-playlist-track`,
//      a class the markup never had.
//
// The tier ladder is here too, so the "layout adapts to the track count"
// behaviour is a contract rather than a look someone can quietly regress.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../js/recent-index.js';

const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// These tests scan source text, so they have to read the CODE and not the
// prose around it — every one of them describes the bug it guards, and a
// comment naming the old token or the dead class would otherwise trip the very
// assertion it explains. Whole-line `//` only, so `https://` and regex
// literals inside real code survive.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const { playlistTier } = globalThis.RecentIndex;
const CSS = stripComments(read('css/main.css'));
const PLAYER = stripComments(read('js/audio-player.js'));
const CARD = stripComments(read('js/recent-index.js'));

// ---------------------------------------------------------------------------
// The ladder: how many tracks → how the index is laid out.

describe('playlistTier — track count → layout tier', () => {
  it.each([
    [1, 'roomy'],
    [2, 'roomy'],
    [3, 'balanced'],
    [4, 'balanced'],
    [5, 'dense'],
    [6, 'dense'],
  ])('%i track(s) → %s', (n, tier) => {
    expect(playlistTier(n)).toBe(tier);
  });

  it('is total — junk and out-of-range counts still land on a rung', () => {
    for (const bad of [undefined, null, NaN, -3, 0, 99, '4']) {
      expect(['roomy', 'balanced', 'dense']).toContain(playlistTier(bad));
    }
  });

  it('covers every count the card can actually be built with', () => {
    // audioPick caps the playlist; the console refuses a 7th pin. Both ends of
    // that range must have a tier or the card renders untiered.
    for (let n = 2; n <= 6; n++) {
      expect(typeof playlistTier(n)).toBe('string');
    }
  });

  it('ships a CSS rule for every rung the ladder can return', () => {
    for (const tier of ['roomy', 'balanced', 'dense']) {
      expect(CSS, `no rules for the "${tier}" tier`)
        .toContain(`.wk-audio-playlist[data-tier="${tier}"]`);
    }
  });
});

// ---------------------------------------------------------------------------
// Theming: the card has to be built out of tokens, like everything else.

describe('the audio cards are themed from tokens', () => {
  it('defines every custom property the stylesheet reads', () => {
    // --ap-* are written by JS at runtime (the marquee), so they are the one
    // legitimate exception; everything else must resolve to a real token or a
    // light preset silently takes a hardcoded fallback.
    const defined = new Set(
      [...CSS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1].toLowerCase()),
    );
    const used = new Set(
      [...CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1].toLowerCase()),
    );
    const missing = [...used].filter(
      (v) => !defined.has(v) && !v.startsWith('--ap-'),
    );
    expect(missing, `undefined custom properties: ${missing.join(', ')}`).toEqual([]);
  });

  it('no longer reaches for the token that never existed', () => {
    expect(CSS).not.toContain('--well');
  });

  it('gives the playlist card no background of its own', () => {
    // It inherits .wk-audio's surface. A second declaration is how the two
    // drifted apart the first time.
    const block = CSS.slice(
      CSS.indexOf('.wk-audio-playlist {'),
      CSS.indexOf('.wk-audio-playlist .ap'),
    );
    expect(block).not.toMatch(/background:/);
  });

  it('deepens the ground from the theme surface instead of naming a colour', () => {
    // The near-black is DERIVED — a veil laid over whatever --surface-2 the
    // active theme defines, exactly as the pulse card does it. A literal hex
    // here would be the --well bug again wearing a different name: right on
    // this preset, a hole punched in every other one.
    const block = CSS.slice(CSS.indexOf('.wk-audio {'), CSS.indexOf('.wk-audio .wk-kicker'));
    expect(block).toContain('var(--surface-2)');
    expect(block).toMatch(/--audio-veil:\s*rgba\(0, 0, 0/);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('inverts that veil on a light theme rather than staying dark', () => {
    const light = CSS.slice(CSS.indexOf(':root[data-theme="light"] .wk-audio'));
    expect(light.slice(0, 160)).toMatch(/--audio-veil:\s*rgba\(255, 255, 255/);
  });

  it('sets the head over the index rather than centring one stack', () => {
    // The waveform is the card's header: the kicker, title and player sit at
    // the top and the index hangs beneath them under a full-bleed rule. A
    // centred card floats the index in the middle of the tile with the
    // waveform stranded above it, which is what this replaced.
    const block = CSS.slice(
      CSS.indexOf('.wk-audio-playlist {'),
      CSS.indexOf('.wk-audio-playlist .ap'),
    );
    expect(block).toMatch(/justify-content:\s*flex-start/);

    const index = CSS.slice(CSS.indexOf('.wk-pl-index {'), CSS.indexOf('[data-tier="roomy"]'));
    expect(index).toMatch(/border-top:\s*1px solid/);
    expect(index).toMatch(/margin:\s*[\w.]+\s+-16px/);   // the rule bleeds to the card edge
  });

  it('keeps the foot on the bottom edge', () => {
    const foot = CSS.slice(CSS.indexOf('.wk-audio-playlist .wk-a-foot'));
    expect(foot.slice(0, 80)).toMatch(/margin-top:\s*auto/);
  });

  it('caps how tall a row may grow at every rung', () => {
    // Rows absorb the tile's slack, so without a cap two tracks would be two
    // rows marooned half a tile apart — and the now-playing highlight would
    // grow into a slab. Every rung the ladder can return needs one.
    for (const tier of ['roomy', 'balanced', 'dense']) {
      const rule = CSS.match(
        new RegExp(`\\.wk-audio-playlist\\[data-tier="${tier}"\\] \\.wk-pl-item \\{([^}]*)\\}`),
      );
      expect(rule, `${tier} has no row rule`).not.toBeNull();
      expect(rule[1], `${tier} row is uncapped`).toMatch(/max-height:\s*\d+px/);
    }
  });
});

describe('the waveform cannot print over the readout beside it', () => {
  it('clips the bar row instead of letting it overflow the seek surface', () => {
    // A bar will not shrink below 1px, so a variant's bar count is a floor on
    // the waveform's width. Squeeze the column under it and the bars used to
    // spill out and draw across the time.
    const wave = CSS.slice(CSS.indexOf('.ap-wave {'), CSS.indexOf('.ap-wave:focus-visible'));
    expect(wave).toMatch(/overflow:\s*hidden/);
  });
});

// ---------------------------------------------------------------------------
// The queue: every track handed to the player carries the same callbacks.

describe('playlist auto-advance survives past the second track', () => {
  it('never passes the property the player does not expose', () => {
    expect(CARD).not.toContain('player.onended');
  });

  it('builds its track options in ONE place', () => {
    // Two hand-rolled option literals inside the playlist card is how the two
    // call sites' callbacks drifted apart. (The single-track audio card below
    // has its own, legitimately — so scope the count to this function.)
    expect(CARD).toContain('function trackOpts(');
    const fn = slice(CARD, 'function audioPlaylistCard(', '\n  function audioCard(');
    const literals = fn.match(/variant:\s*'card'/g) || [];
    expect(literals.length, 'more than one hand-built card option literal').toBe(1);
  });

  it('hands every loaded track the same advance callback', () => {
    expect(CARD).toMatch(/onended:\s*advance/);
  });
});

describe('the player fallback targets classes that exist', () => {
  it('does not look for the class the markup never had', () => {
    expect(PLAYER).not.toContain('wk-playlist-track');
  });

  it('looks for the playlist row class the card actually renders', () => {
    expect(PLAYER).toContain('.wk-pl-item');
    expect(CARD).toContain("'wk-pl-item'");
  });
});

// ---------------------------------------------------------------------------
// A failed track must not poison the ones after it.

describe('loadTrack clears the latched failure state', () => {
  it('drops is-error, the tooltip and the Unavailable label', () => {
    const fn = slice(PLAYER, 'function loadTrack(', '\n    var api = {');
    expect(fn).toContain("root.classList.remove('is-error')");
    expect(fn).toContain("root.removeAttribute('title')");
    expect(fn).toMatch(/play\.setAttribute\('aria-label',\s*'Play'\)/);
  });
});

function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `could not find ${from}`).toBeGreaterThan(-1);
  expect(b, `could not find ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

// ---------------------------------------------------------------------------
// The cap lives in two files and they have to agree.

describe('the 6-track cap agrees across the console and the card', () => {
  // Tightened with cards chunk 4. The console used to refuse on a bare literal
  // (`currentFeatured.length >= 6`), so this test compared a NAMED constant in
  // one file against an anonymous number in the other — it could tell you the
  // two disagreed, but nothing in the console said what that 6 was. The cap now
  // has the same name on both sides, and a SET is bounded by it too: a set
  // exists to be borrowed by the homepage card, so one that could not fit would
  // be a promise the card cannot keep.
  it('the renderer cap and the console constant are the same number', () => {
    const cardCap = /AUDIO_MAX_PLAYLIST\s*=\s*(\d+)/.exec(CARD);
    const consoleCap = /AUDIO_MAX_PLAYLIST\s*=\s*(\d+)/.exec(read('js/console/audio.js'));
    expect(cardCap, 'AUDIO_MAX_PLAYLIST vanished from the card').not.toBeNull();
    expect(consoleCap, 'AUDIO_MAX_PLAYLIST vanished from the console').not.toBeNull();
    expect(consoleCap[1]).toBe(cardCap[1]);
  });

  it('the console refuses a seventh track, and a seventh set entry, by that name', () => {
    const src = read('js/console/audio.js');
    // Not a literal anywhere near the refusals — that is the drift this pins.
    expect(src).toMatch(/currentFeatured\.length\s*>=\s*AUDIO_MAX_PLAYLIST/);
    expect(src).toMatch(/set\.tracks\.length\s*>=\s*AUDIO_MAX_PLAYLIST/);
    expect(src).not.toMatch(/currentFeatured\.length\s*>=\s*\d/);
  });
});

// ---------------------------------------------------------------------------
// Wording: one card, many tracks.

describe('the console calls them tracks, not cards', () => {
  const src = read('js/console/audio.js');

  it('numbers a pinned track as a TRACK', () => {
    expect(src).toContain('★ TRACK #');
  });

  it('never numbers them as if each were its own card', () => {
    expect(src).not.toMatch(/★ CARD #/);
  });
});
