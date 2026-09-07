// @vitest-environment happy-dom
//
// The console's Audio shelf.
//
// Two things here are load-bearing beyond ordinary helper behavior:
//
//  · The SLUG is a track's permanent address — /listen/?a=<slug> is what gets
//    shared, and a post shortcode carries nothing else. So it has to be
//    collision-proof, and renaming a PUBLISHED track must not move it.
//  · Featuring is CAPPED, not exclusive. The homepage audio card holds up to
//    six tracks (the Soundboard, 2026-08-14), ordered by `featured_order`, and
//    the cap is duplicated in js/recent-index.js — so the two must agree or the
//    console pins a seventh track the card will never draw.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// console-state.js reaches these through the global scope at call time (the
// real console mirrors its renderers onto window) — stub before importing.
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const {
  audioSlugify, audioUniqueSlug, audioNormalizePeaks, audioPeaksToString,
  _audioPromote, _audioToggleEpisode, _audioToggleDownload, renderAudio,
  audioWeightHint, _audioClearCard, _audioEdit, audioAddFiles,
  _audioRestoreCard, _audioCardRestoreTarget,
} = await import('../js/console/audio.js');
const { sessionTrash } = await import('../js/console-state.js');

beforeEach(() => {
  document.body.innerHTML = `
    <div id="audio-display"></div>
    <span id="audio-count"></span>
    <span id="audio-stats"></span>
    <div id="toast-host"></div>
  `;
  STATE.audio = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0, audio: 0 };
  STATE.stagedLog = [];
  sessionTrash.length = 0;
  // CLEAR CARD asks before taking up to six tracks down (2026-08-31); happy-dom
  // has no real dialog, so cases that are not ABOUT the confirm assume "yes".
  window.confirm = () => true;
});

const track = (over) => ({
  id: 'a1', slug: 'take-one', filename: 'take-one.mp3', title: 'Take One',
  sub: '', duration: 214, peaks: '', added_at: '2026-08-12', ...over,
});

describe('audioSlugify — a title becomes a permanent address', () => {
  it.each([
    ['Midnight, Take One', 'midnight-take-one'],
    ['  Spaced  Out  ', 'spaced-out'],
    ['Episode #4: The Ferry', 'episode-4-the-ferry'],
    ["Don't Look Down", 'dont-look-down'],
    ['take-one.mp3', 'take-one'],
    ['Réverie', 'r-verie'],
  ])('%s → %s', (input, expected) => {
    expect(audioSlugify(input)).toBe(expected);
  });

  it('never returns an empty slug — a track with no usable title still gets an address', () => {
    expect(audioSlugify('')).toBe('track');
    expect(audioSlugify('...')).toBe('track');
    expect(audioSlugify(null)).toBe('track');
    expect(audioSlugify('!!!')).toBe('track');
  });

  it('is URL-safe: only lowercase, digits and hyphens survive', () => {
    expect(audioSlugify('A/B?c=d&e #1')).toMatch(/^[a-z0-9-]+$/);
  });

  it('caps length so a rambling title cannot mint an unusable URL', () => {
    expect(audioSlugify('word '.repeat(60)).length).toBeLessThanOrEqual(60);
  });
});

describe('audioUniqueSlug — two tracks never share a permalink', () => {
  const existing = [{ id: 'x', slug: 'take-one' }, { id: 'y', slug: 'take-one-2' }];

  it('passes an unused slug through untouched', () => {
    expect(audioUniqueSlug('Something Else', existing)).toBe('something-else');
  });

  it('suffixes past every taken variant', () => {
    expect(audioUniqueSlug('Take One', existing)).toBe('take-one-3');
  });

  it('lets an entry keep its own slug when it is edited', () => {
    // Without skipId, renaming a track to (almost) its own name would bump it
    // to -2 and silently break every link already pointing at it.
    expect(audioUniqueSlug('Take One', existing, 'x')).toBe('take-one');
  });

  it('handles an empty or absent registry', () => {
    expect(audioUniqueSlug('First', [])).toBe('first');
    expect(audioUniqueSlug('First', null)).toBe('first');
  });
});

describe('audioNormalizePeaks — shape, not loudness', () => {
  it('scales to the loudest peak so a quiet recording still fills the card', () => {
    expect(audioNormalizePeaks([0.1, 0.2, 0.05])).toEqual([0.5, 1, 0.25]);
  });

  it('never exceeds 1', () => {
    audioNormalizePeaks([3, 1, 0.5]).forEach((p) => expect(p).toBeLessThanOrEqual(1));
  });

  it('returns silence for silence instead of dividing by zero', () => {
    expect(audioNormalizePeaks([0, 0, 0])).toEqual([0, 0, 0]);
    expect(audioNormalizePeaks([])).toEqual([]);
  });

  it('treats junk samples as silence', () => {
    expect(audioNormalizePeaks([NaN, 1, undefined])).toEqual([0, 1, 0]);
  });

  it('serializes at the same 2-decimal precision the public player parses', () => {
    expect(audioPeaksToString([0.126, 1])).toBe('0.13,1');
  });
});

describe('featuring tracks on the homepage card', () => {
  it('promoting a track features it and assigns featured_order', () => {
    STATE.audio = [track(), track({ id: 'a2', slug: 'two', title: 'Two' })];
    _audioPromote('a1');
    expect(STATE.audio.filter((a) => a.featured).map((a) => a.id)).toEqual(['a1']);
    expect(STATE.audio[0].featured_order).toBe(1);
  });

  it('promoting again un-features it (the toggle is the way off the card)', () => {
    STATE.audio = [track({ featured: true, featured_order: 1 })];
    _audioPromote('a1');
    expect(STATE.audio[0].featured).toBe(false);
    expect(STATE.audio[0].featured_order).toBeUndefined();
  });

  it('allows selecting multiple tracks up to 6 for a playlist card', () => {
    STATE.audio = [
      track({ id: 'a1' }), track({ id: 'a2' }), track({ id: 'a3' }),
      track({ id: 'a4' }), track({ id: 'a5' }), track({ id: 'a6' }), track({ id: 'a7' }),
    ];
    _audioPromote('a1');
    _audioPromote('a3');
    _audioPromote('a5');
    expect(STATE.audio.filter((a) => a.featured).map((a) => a.id)).toEqual(['a1', 'a3', 'a5']);
    expect(STATE.audio.find((a) => a.id === 'a1').featured_order).toBe(1);
    expect(STATE.audio.find((a) => a.id === 'a3').featured_order).toBe(2);
    expect(STATE.audio.find((a) => a.id === 'a5').featured_order).toBe(3);

    // Un-promoting a middle track re-indexes remaining
    _audioPromote('a3');
    expect(STATE.audio.filter((a) => a.featured).map((a) => a.id)).toEqual(['a1', 'a5']);
    expect(STATE.audio.find((a) => a.id === 'a5').featured_order).toBe(2);
  });

  it('caps the card at 6 tracks max', () => {
    STATE.audio = [
      track({ id: 'a1' }), track({ id: 'a2' }), track({ id: 'a3' }),
      track({ id: 'a4' }), track({ id: 'a5' }), track({ id: 'a6' }), track({ id: 'a7' }),
    ];
    for (let i = 1; i <= 6; i++) _audioPromote(`a${i}`);
    expect(STATE.audio.filter((a) => a.featured)).toHaveLength(6);
    // 7th should be rejected
    _audioPromote('a7');
    expect(STATE.audio.filter((a) => a.featured)).toHaveLength(6);
    expect(STATE.audio.find((a) => a.id === 'a7').featured).toBeFalsy();
  });

  // THE BUG THIS FILE HELD IN PLACE. The test that used to live here was named
  // "stages the change and decrements when un-featured" and asserted exactly
  // that: feature → 1, un-feature → 0. It passes on the broken model, because
  // it never crosses a publish. STATE.staged counts UNPUBLISHED CHANGES, not
  // tracks on the card, so taking a LIVE track off the card has to stage one —
  // and it did not: bumpStage clamps at 0, so the console reported NO PENDING
  // CHANGES, publish refused to run, and the card could not be removed from the
  // site at all.
  it('stages a change when a LIVE track is taken off the card', () => {
    STATE.audio = [track({ featured: true, featured_order: 1 })];
    STATE.staged = { audio: 0 };          // the state right after a publish

    _audioPromote('a1');

    expect(STATE.audio[0].featured).toBe(false);
    expect(STATE.staged.audio, 'removal staged nothing — publish would refuse').toBe(1);
  });

  it('stages a change every time, never cancelling one out', () => {
    STATE.audio = [track()];
    STATE.staged = { audio: 0 };
    _audioPromote('a1');                  // on
    _audioPromote('a1');                  // off — two edits, two things to publish
    expect(STATE.staged.audio).toBe(2);
  });

  it('CLEAR CARD stages one change for the gesture', () => {
    STATE.audio = [
      track({ id: 'a1', slug: 's1', featured: true, featured_order: 1 }),
      track({ id: 'a2', slug: 's2', featured: true, featured_order: 2 }),
      track({ id: 'a3', slug: 's3', featured: true, featured_order: 3 }),
    ];
    STATE.staged = { audio: 0 };

    _audioClearCard();

    expect(STATE.audio.every((a) => !a.featured)).toBe(true);
    expect(STATE.staged.audio, 'clearing a live card staged nothing').toBe(1);
  });

  it('ignores an unknown id rather than throwing', () => {
    STATE.audio = [track()];
    expect(() => _audioPromote('nope')).not.toThrow();
  });
});

describe('episode and download are independent per-track switches', () => {
  it('marks a track as a podcast episode without touching the card', () => {
    STATE.audio = [track()];
    _audioToggleEpisode('a1');
    expect(STATE.audio[0].episode).toBe(true);
    expect(STATE.audio[0].featured).toBeFalsy();
  });

  it('is a toggle, and does not go exclusive — a show has many episodes', () => {
    STATE.audio = [track(), track({ id: 'a2', slug: 'two' })];
    _audioToggleEpisode('a1');
    _audioToggleEpisode('a2');
    expect(STATE.audio.filter((a) => a.episode)).toHaveLength(2);
    _audioToggleEpisode('a1');
    expect(STATE.audio.filter((a) => a.episode)).toHaveLength(1);
  });

  it('toggles the download offer', () => {
    STATE.audio = [track()];
    _audioToggleDownload('a1');
    expect(STATE.audio[0].download).toBe(true);
  });
});

describe('renderAudio', () => {
  it('says so plainly when the shelf is empty', () => {
    renderAudio();
    expect(document.getElementById('audio-display').textContent).toContain('NO AUDIO YET');
  });

  it('escapes a title rather than injecting it as markup', () => {
    STATE.audio = [track({ title: '<img src=x onerror=alert(1)>' })];
    renderAudio();
    expect(document.getElementById('audio-display').querySelector('img')).toBeNull();
  });

  it('shows an in-flight upload as such, so a half-added track is never mistaken for a live one', () => {
    STATE.audio = [track({ _uploading: true })];
    renderAudio();
    expect(document.getElementById('audio-display').textContent).toContain('UPLOADING');
  });
});

// The console measures peaks and the public player resamples them. If those two
// disagreed about how many were stored, every waveform on the site would be
// subtly wrong in a way nothing else would catch — the count is not derivable
// from the data, so it has to be asserted across the file boundary.
describe('PEAK_COUNT agrees on both sides of the wire', () => {
  const read = (p) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const countIn = (src) => Number(/PEAK_COUNT\s*=\s*(\d+)/.exec(src)[1]);

  it('js/console/audio.js and js/audio-player.js store the same resolution', () => {
    expect(countIn(read('js/console/audio.js'))).toBe(countIn(read('js/audio-player.js')));
  });
});


// The console is the only place an author can act on file weight — there is no
// transcoder here on purpose, so the one useful thing to do is say the number
// at the moment they attach the file.
describe('audioWeightHint — a heavy file is a warning, never a refusal', () => {
  it('says nothing about a normally compressed track', () => {
    // 3 minutes at 192kbps ≈ 4.3MB.
    expect(audioWeightHint(4.3 * 1024 * 1024, 180, 'take.mp3')).toBe('');
  });

  it('flags an uncompressed file, with the number that makes the point', () => {
    // The real case that prompted this: 8 seconds costing 1.4MB.
    const hint = audioWeightHint(1463588, 8, 'bells.wav');
    expect(hint).toContain('1.4MB for 8s');
    expect(hint).toContain('uncompressed');
    expect(hint).toContain('MP3');
  });

  it('leaves a fat-but-reasonable export alone', () => {
    // 320kbps ≈ 40KB/s. Heavy, deliberate, and it still plays promptly — the
    // hint is for files that make a visitor wait, not for every large one.
    expect(audioWeightHint(1922718, 48, 'piano.mp3')).toBe('');
  });

  it('flags a compressed file that is simply enormous', () => {
    // ~640kbps: compressed, so the wording drops the "uncompressed" line.
    const hint = audioWeightHint(4.8 * 1024 * 1024, 60, 'piano.mp3');
    expect(hint).toContain('very high bitrate');
    expect(hint).not.toContain('uncompressed');
  });

  it('stays quiet when it cannot measure a rate', () => {
    // An undecodable file has no duration, and a rate needs both numbers.
    expect(audioWeightHint(9e6, 0, 'broken.wav')).toBe('');
    expect(audioWeightHint(0, 30, 'empty.mp3')).toBe('');
  });
});


// Same defect, the other switch: taking a track OUT of the podcast feed is a
// change subscribers see, so it has to be publishable.
describe('leaving the feed is a change too', () => {
  it('stages a change when an episode is switched off', () => {
    STATE.audio = [track({ episode: true })];
    STATE.staged = { audio: 0 };
    _audioToggleEpisode('a1');
    expect(STATE.audio[0].episode).toBe(false);
    expect(STATE.staged.audio).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Slug permanence — the contract manual §5.29 states and nothing pinned.
//
// A published track's slug is its address: /listen/?a=<slug> is what gets
// shared, every post shortcode carries nothing else, and the podcast feed uses
// that permalink as <guid isPermaLink="true">. Moving it breaks all three at
// once, and for a subscriber it silently re-downloads the episode.
//
// This is why the post-publish `_imported` promotion has to include audio: it
// is the ONLY thing telling _audioEdit that a track is already out in the world.
describe('a published track keeps its address', () => {
  it('renaming a published track does not move its slug', () => {
    STATE.audio = [track({ _imported: true })];
    window.prompt = (label) => (/^Title/.test(label) ? 'A Completely Different Name' : '');

    _audioEdit('a1');

    expect(STATE.audio[0].title).toBe('A Completely Different Name');
    expect(STATE.audio[0].slug, 'the permalink is permanent once published').toBe('take-one');
  });

  it('renaming a never-published track DOES move its slug', () => {
    // Nothing points at it yet, so the address can still follow the name.
    STATE.audio = [track({ _imported: false })];
    window.prompt = (label) => (/^Title/.test(label) ? 'Second Thoughts' : '');

    _audioEdit('a1');

    expect(STATE.audio[0].slug).toBe('second-thoughts');
  });

  it('a slug already taken by another track is never handed out twice', () => {
    STATE.audio = [
      track({ id: 'a1', slug: 'take-one', _imported: false }),
      track({ id: 'a2', slug: 'second-thoughts', filename: 'b.mp3' }),
    ];
    window.prompt = (label) => (/^Title/.test(label) ? 'Second Thoughts' : '');

    _audioEdit('a1');

    expect(STATE.audio[0].slug).not.toBe('second-thoughts');
    expect(new Set(STATE.audio.map((a) => a.slug)).size, 'slugs stay unique').toBe(2);
  });
});

// ---------------------------------------------------------------------------
// A trashed track still owns its R2 key until publish fires the queued delete.
describe('re-adding a trashed filename', () => {
  it('is refused, and points at RESTORE instead', async () => {
    sessionTrash.push({
      surface: 'audio',
      item: { id: 'gone', filename: 'take-one.mp3', slug: 'take-one', _imported: true },
      label: 'Take One',
      deletedAt: '12:00:00',
      ledgerRows: [],
    });

    const file = new File([new Uint8Array(8)], 'take-one.mp3', { type: 'audio/mpeg' });
    const added = await audioAddFiles([file]);

    expect(added, 'the shelf refuses the duplicate').toHaveLength(0);
    expect(STATE.audio, 'and nothing was minted').toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reversibility, layer 2 (CLAUDE.md): one chip naming what a displacing action
// pushed out, resolved against state as it is NOW so it is never a dead button.
describe('↩ RESTORE CARD', () => {
  beforeEach(() => { window.confirm = () => true; });

  it('puts the cleared tracks back in their original order', () => {
    STATE.audio = [
      track({ id: 'a1', slug: 's1', filename: '1.mp3', featured: true, featured_order: 1 }),
      track({ id: 'a2', slug: 's2', filename: '2.mp3', featured: true, featured_order: 2 }),
      track({ id: 'a3', slug: 's3', filename: '3.mp3', featured: true, featured_order: 3 }),
    ];
    _audioClearCard();
    expect(STATE.audio.every((a) => !a.featured), 'card is down').toBe(true);
    expect(STATE.audio.every((a) => a.featured_order === undefined),
      'no orphaned order — recent-index.js would keep those tracks live').toBe(true);

    _audioRestoreCard();
    const back = STATE.audio.filter((a) => a.featured)
      .sort((a, b) => a.featured_order - b.featured_order).map((a) => a.id);
    expect(back).toEqual(['a1', 'a2', 'a3']);
  });

  it('asks before clearing, and does nothing when declined', () => {
    window.confirm = () => false;
    STATE.audio = [track({ featured: true, featured_order: 1 })];
    _audioClearCard();
    expect(STATE.audio[0].featured, 'a declined confirm changes nothing').toBe(true);
  });

  it('restores through _audioPromote, so staging counts one gesture per track', () => {
    STATE.audio = [
      track({ id: 'a1', slug: 's1', filename: '1.mp3', featured: true, featured_order: 1 }),
      track({ id: 'a2', slug: 's2', filename: '2.mp3', featured: true, featured_order: 2 }),
    ];
    _audioClearCard();
    const afterClear = STATE.staged.audio;
    _audioRestoreCard();
    expect(STATE.staged.audio, 'two tracks back on = two more gestures').toBe(afterClear + 2);
  });

  it('drops a track that has since been deleted, and keeps the rest', () => {
    STATE.audio = [
      track({ id: 'a1', slug: 's1', filename: '1.mp3', featured: true, featured_order: 1 }),
      track({ id: 'a2', slug: 's2', filename: '2.mp3', featured: true, featured_order: 2 }),
    ];
    _audioClearCard();
    STATE.audio = STATE.audio.filter((a) => a.id !== 'a1');

    expect(_audioCardRestoreTarget().map((t) => t.id)).toEqual(['a2']);
    _audioRestoreCard();
    expect(STATE.audio.filter((a) => a.featured).map((a) => a.id)).toEqual(['a2']);
  });

  it('offers nothing when there is nothing restorable', () => {
    STATE.audio = [track({ featured: false })];
    expect(_audioCardRestoreTarget(), 'a chip that does nothing is worse than no chip').toBeNull();
  });

  it('stops offering once the cleared tracks are featured again by hand', () => {
    STATE.audio = [track({ id: 'a1', featured: true, featured_order: 1 })];
    _audioClearCard();
    _audioPromote('a1');
    expect(_audioCardRestoreTarget()).toBeNull();
  });
});
