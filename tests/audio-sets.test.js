// @vitest-environment happy-dom
//
// SETS — a named, ordered list of tracks with its own address.
//
// A set is audio content, not a card feature. It lives on the Audio shelf, it
// answers /listen/?set=<slug>, and the homepage card BORROWS one rather than
// owning it (cards chunk 5). That ordering is the whole point: a playlist you
// can only build inside a card is a playlist you cannot link to.
//
// Three things here are load-bearing beyond ordinary helper behavior:
//
//  · Tracks are referenced BY SLUG, never copied. The registry stays the one
//    home for a track, so a set survives a re-title and a removed track simply
//    drops out of what the set plays.
//  · "What does this set play" has exactly ONE implementation —
//    AudioPlayer.resolveSetTracks in js/audio-player.js. The console loads that
//    public script to call it. A copy in the console would be the second
//    implementation that lets the shelf say four while the page plays three.
//  · A published set's slug is its permanent address, so deleting one RETIRES
//    it to a tombstone. Same rule as a track's, same reason. (The retire itself
//    is pinned in tests/audio-retire.test.js, beside the track's.)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

// The console reaches the resolver through the global the public script hangs —
// so the test has to load it the same way the console page does.
await import('../js/audio-player.js');

const { STATE, sessionTrash } = await import('../js/console-state.js');
const {
  _setCreate, _setRename, _setPushTrack, _setMoveTrack, _setRemoveTrack,
  _setRemoveUndoTarget, _setUndoRemove, _setDelete, setUniqueSlug,
  renderAudioSets, renderAudio,
} = await import('../js/console/audio.js');

const TRACKS = () => [
  { id: 't1', slug: 'one', filename: 'one.mp3', title: 'One', duration: 60, added_at: '2026-09-01' },
  { id: 't2', slug: 'two', filename: 'two.mp3', title: 'Two', duration: 90, added_at: '2026-09-02' },
  { id: 't3', slug: 'three', filename: 'three.mp3', title: 'Three', duration: 30, added_at: '2026-09-03' },
];

const seedSet = (over = {}) => {
  const s = { id: 's1', slug: 'late-mix', name: 'Late mix', tracks: [], added_at: '2026-09-10', ...over };
  STATE.audioSets = [s];
  return s;
};

beforeEach(() => {
  document.body.innerHTML = `
    <div id="audio-display"></div>
    <div id="audio-sets-display"></div>
    <span id="audio-count"></span>
    <span id="audio-sets-count"></span>
    <span id="audio-stats"></span>
    <div id="toast-host"></div>
  `;
  STATE.audio = TRACKS();
  STATE.audioSets = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, friends: 0,
    library: 0, audio: 0, audioSets: 0, cards: 0 };
  STATE.stagedLog = [];
  sessionTrash.length = 0;
  window.confirm = () => true;
});

// ---------------------------------------------------------------------------
// One resolver, and it is not in the console.

describe('resolving what a set plays', () => {
  const resolve = (set, reg) => globalThis.AudioPlayer.resolveSetTracks(set, reg);

  it('answers in the SET’s order, not the registry’s', () => {
    expect(resolve({ tracks: ['three', 'one'] }, TRACKS()).map((t) => t.slug))
      .toEqual(['three', 'one']);
  });

  it('drops a slug nothing on the shelf answers to', () => {
    expect(resolve({ tracks: ['one', 'ghost', 'two'] }, TRACKS()).map((t) => t.slug))
      .toEqual(['one', 'two']);
  });

  it('drops a RETIRED track — a reserved address is not something you can play', () => {
    const reg = [...TRACKS(), { id: 't4', slug: 'gone', retired: true }];
    expect(resolve({ tracks: ['one', 'gone'] }, reg).map((t) => t.slug)).toEqual(['one']);
  });

  it('survives an empty, absent or malformed set without throwing', () => {
    expect(resolve(null, TRACKS())).toEqual([]);
    expect(resolve({}, TRACKS())).toEqual([]);
    expect(resolve({ tracks: ['one'] }, null)).toEqual([]);
  });

  // The rule the plan's §1.2 exists for, asserted against the source rather
  // than the behavior: behavior can agree today and drift tomorrow.
  it('the console does not carry a second copy of it', () => {
    const src = read('js/console/audio.js');
    expect(src).not.toMatch(/function\s+resolveSetTracks/);
    expect(src).toContain('AudioPlayer.resolveSetTracks');
  });
});

// ---------------------------------------------------------------------------
// Creating, naming, addressing.

describe('creating a set', () => {
  it('names it, slugs it, stages exactly one change', () => {
    window.prompt = () => 'Late Summer Mix';
    _setCreate();
    expect(STATE.audioSets).toHaveLength(1);
    expect(STATE.audioSets[0]).toMatchObject({ name: 'Late Summer Mix', slug: 'late-summer-mix', tracks: [] });
    expect(STATE.staged.audioSets).toBe(1);
  });

  it('a cancelled prompt creates nothing and stages nothing', () => {
    window.prompt = () => null;
    _setCreate();
    expect(STATE.audioSets).toHaveLength(0);
    expect(STATE.staged.audioSets).toBe(0);
  });

  it('refuses a blank name — an address needs something to be made of', () => {
    window.prompt = () => '   ';
    _setCreate();
    expect(STATE.audioSets).toHaveLength(0);
  });

  it('collision-guards the slug against the other sets', () => {
    seedSet({ slug: 'late-mix' });
    window.prompt = () => 'Late mix';
    _setCreate();
    expect(STATE.audioSets[0].slug).toBe('late-mix-2');
  });

  it('a track and a set may share a slug — they answer different parameters', () => {
    // setUniqueSlug is guarded over the SETS namespace only; /listen/?a=x and
    // /listen/?set=x are two addresses, not one ambiguous one.
    expect(setUniqueSlug('one', STATE.audioSets)).toBe('one');
  });

  it('renaming never moves the address', () => {
    const s = seedSet();
    window.prompt = () => 'Even later mix';
    _setRename('s1');
    expect(s.name).toBe('Even later mix');
    expect(s.slug).toBe('late-mix');
  });
});

// ---------------------------------------------------------------------------
// Adding, ordering, removing — and the one chip that reverses the last removal.

describe('the tracks in a set', () => {
  it('adds by slug, in the order added, one staged gesture each', () => {
    seedSet();
    _setPushTrack('s1', 'two');
    _setPushTrack('s1', 'one');
    expect(STATE.audioSets[0].tracks).toEqual(['two', 'one']);
    // The staging law: one gesture, one bump, +1 always — two adds are two
    // changes to publish. The LEDGER is what folds, into one row for the set
    // carrying n=2, so the publish view lists the set once rather than twice.
    expect(STATE.staged.audioSets).toBe(2);
    const rows = STATE.stagedLog.filter((r) => r.surface === 'audioSets');
    expect(rows).toHaveLength(1);
    expect(rows[0].n).toBe(2);
  });

  it('refuses a duplicate — a set is a sequence, not a multiset', () => {
    seedSet({ tracks: ['one'] });
    _setPushTrack('s1', 'one');
    expect(STATE.audioSets[0].tracks).toEqual(['one']);
  });

  it('refuses a slug the shelf cannot play', () => {
    seedSet();
    _setPushTrack('s1', 'ghost');
    expect(STATE.audioSets[0].tracks).toEqual([]);
  });

  it('caps a set at AUDIO_MAX_PLAYLIST, the number the homepage card can draw', () => {
    const cap = Number(/AUDIO_MAX_PLAYLIST\s*=\s*(\d+)/.exec(read('js/console/audio.js'))[1]);
    STATE.audio = Array.from({ length: cap + 1 }, (_, i) => ({
      id: `x${i}`, slug: `s${i}`, filename: `s${i}.mp3`, title: `T${i}`, duration: 10,
    }));
    seedSet();
    for (let i = 0; i <= cap; i++) _setPushTrack('s1', `s${i}`);
    expect(STATE.audioSets[0].tracks).toHaveLength(cap);
  });

  it('reorders within the set, and the reverse move is the other button', () => {
    seedSet({ tracks: ['one', 'two', 'three'] });
    _setMoveTrack('s1', 'three', -1);
    expect(STATE.audioSets[0].tracks).toEqual(['one', 'three', 'two']);
    _setMoveTrack('s1', 'three', 1);
    expect(STATE.audioSets[0].tracks).toEqual(['one', 'two', 'three']);
  });

  it('a move off either end is a no-op, not a wrap', () => {
    seedSet({ tracks: ['one', 'two'] });
    _setMoveTrack('s1', 'one', -1);
    _setMoveTrack('s1', 'two', 1);
    expect(STATE.audioSets[0].tracks).toEqual(['one', 'two']);
  });

  it('removes, and ↩ UNDO puts it back where it was', () => {
    seedSet({ tracks: ['one', 'two', 'three'] });
    _setRemoveTrack('s1', 'two');
    expect(STATE.audioSets[0].tracks).toEqual(['one', 'three']);
    expect(_setRemoveUndoTarget()).toMatchObject({ setId: 's1', slug: 'two', index: 1 });
    _setUndoRemove();
    expect(STATE.audioSets[0].tracks).toEqual(['one', 'two', 'three']);
    expect(_setRemoveUndoTarget()).toBeNull();
  });

  // Layer 2 of the reversibility rule: resolved against state AS IT IS NOW, so
  // the chip can never be a button that does nothing.
  it('the undo chip disappears when the track is already back', () => {
    seedSet({ tracks: ['one', 'two'] });
    _setRemoveTrack('s1', 'two');
    _setPushTrack('s1', 'two');
    expect(_setRemoveUndoTarget()).toBeNull();
  });

  it('the undo chip disappears when its set is gone', () => {
    seedSet({ tracks: ['one', 'two'] });
    _setRemoveTrack('s1', 'two');
    STATE.audioSets = [];
    expect(_setRemoveUndoTarget()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Deleting a set that was never published.

describe('deleting an unpublished set', () => {
  it('goes to the session trash, so ↩ RESTORE brings it back whole', () => {
    seedSet({ tracks: ['one'] });
    _setDelete('s1');
    expect(STATE.audioSets).toHaveLength(0);
    expect(sessionTrash[0]).toMatchObject({ surface: 'audioSets' });
    expect(sessionTrash[0].item.tracks).toEqual(['one']);
  });

  it('takes no track with it — a set is a list, not a copy', () => {
    seedSet({ tracks: ['one', 'two'] });
    _setDelete('s1');
    expect(STATE.audio.map((t) => t.slug)).toEqual(['one', 'two', 'three']);
  });

  it('a declined confirm changes nothing', () => {
    window.confirm = () => false;
    seedSet({ tracks: ['one'] });
    _setDelete('s1');
    expect(STATE.audioSets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The shelf itself.

describe('the SETS shelf renders', () => {
  it('says what a set IS when there are none — an empty state is a normal state', () => {
    renderAudioSets();
    expect(document.getElementById('audio-sets-display').textContent)
      .toContain('NO SETS YET');
  });

  it('shows the address, the tally and the tracks in order', () => {
    seedSet({ tracks: ['three', 'one'] });
    renderAudioSets();
    const html = document.getElementById('audio-sets-display').innerHTML;
    expect(html).toContain('/listen/?set=late-mix');
    expect(html).toContain('2 tracks');
    expect(html.indexOf('Three')).toBeLessThan(html.indexOf('One'));
    expect(document.getElementById('audio-sets-count').textContent).toBe('1');
  });

  // Found by opening the page, not by a green suite: .aud-title ellipses, so a
  // tally sitting beside the name there is cut off exactly when it has the most
  // to say ("2 tracks · 3 li"). It belongs on the meta line, which wraps.
  it('keeps the tally out of the ellipsing title line', () => {
    seedSet({ tracks: ['one', 'two', 'three'] });
    renderAudioSets();
    const el = document.querySelector('.aud-set:not(.aud-set-retired)');
    expect(el.querySelector('.aud-title').textContent).toBe('Late mix');
    expect(el.querySelector('.aud-meta').textContent).toContain('3 tracks');
  });

  it('says so when a slug no longer resolves, rather than quietly shortening', () => {
    seedSet({ tracks: ['one', 'ghost'] });
    renderAudioSets();
    expect(document.getElementById('audio-sets-display').textContent)
      .toContain('1 no longer on the shelf');
  });

  it('renders from renderAudio too, so a shelf with no tracks still shows its sets', () => {
    STATE.audio = [];
    seedSet();
    renderAudio();
    expect(document.getElementById('audio-sets-display').textContent).toContain('Late mix');
  });

  it('escapes a name — it comes from a prompt, so it is untrusted text', () => {
    seedSet({ name: '<img src=x onerror=alert(1)>' });
    renderAudioSets();
    const html = document.getElementById('audio-sets-display').innerHTML;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
