// @vitest-environment happy-dom
//
// Retiring a published track, and undoing an edit — the two remaining
// reversibility debts on the Audio shelf (CLAUDE.md's rule, three layers).
//
// **The retire exists because a slug outlives its media.** Once a track is
// published, three things point at its address and none of them are ours to
// break: a share link, every post shortcode carrying that slug, and the
// episode's <guid> in /podcast.xml — which is exactly how a subscriber's app
// decides what it has already downloaded.
//
// Deleting the entry outright freed the slug for immediate reuse, and that is
// the quiet failure this file guards: name a new track the same thing, it takes
// the dead address, the old share link plays DIFFERENT audio, and the new
// episode is invisible to everyone already subscribed because its guid is one
// their app has seen. Nothing errors.
//
// Same rule as the dark frame for buffer slots (manual §5.20), same reason.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// console-state.js reaches its renderers through the global scope at call time.
for (const fn of [
  'refreshStageIndicators', 'renderTrash', 'renderBuffer', 'renderArchive',
  'renderFN', 'fnNewPost', 'renderWall', 'renderBarrel', 'renderNetwork',
  'renderLibrary', 'showView', 'scheduleLibrarySync', 'updatePurgeR2Button',
  'isVideoAsset', 'renderAudio',
]) globalThis[fn] = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE, sessionTrash, _pendingR2Deletes } = await import('../js/console-state.js');
const {
  _audioDelete, _audioRetire, _audioUndoRetire, _audioRetireUndoTarget,
  _audioEdit, _audioUndoEdit, _audioEditUndoTarget,
  audioUniqueSlug, renderAudio,
  _setDelete, _setRetire, _setUndoRetire, _setRetireUndoTarget,
  setUniqueSlug, renderAudioSets,
} = await import('../js/console/audio.js');
const { buildBundle } = await import('../js/console/publish.js');

const PUBLISHED = () => ({
  id: 'a1', slug: 'ferry-at-dawn', filename: 'ferry.mp3', title: 'Ferry at Dawn',
  sub: 'Field recording', duration: 214, size: 3_400_000, peaks: '0.1,0.9',
  added_at: '2026-08-12', episode: true, _imported: true,
});
const LOCAL = () => ({
  id: 'a2', slug: 'take-one', filename: 'take-one.mp3', title: 'Take One', sub: '',
  added_at: '2026-08-14',
});

beforeEach(() => {
  document.body.innerHTML = `
    <div id="audio-display"></div><span id="audio-count"></span>
    <span id="audio-stats"></span><div id="audio-feed-card"></div>
    <div id="audio-sets-display"></div><span id="audio-sets-count"></span>
    <div id="toast-host"></div>`;
  STATE.audio = [];
  STATE.audioSets = [];
  STATE.posts = []; STATE.buffer = []; STATE.archive = [];
  STATE.wallpapers = []; STATE.barrel = []; STATE.friends = []; STATE.library = [];
  STATE.staged = { buffer: 0, archive: 0, posts: 0, wallpapers: 0, barrel: 0, friends: 0, library: 0,
    audio: 0, audioSets: 0, cards: 0 };
  STATE.stagedLog = [];
  sessionTrash.length = 0;
  _pendingR2Deletes.length = 0;
  vi.stubGlobal('confirm', () => true);
});

describe('deleting the right way for the right entry', () => {
  it('retires a PUBLISHED track instead of removing it', () => {
    STATE.audio = [PUBLISHED()];
    _audioDelete('a1');
    expect(STATE.audio).toHaveLength(1);
    expect(STATE.audio[0].retired).toBe(true);
    expect(sessionTrash).toHaveLength(0);
  });

  it('still trashes a never-published one, which has nothing pointing at it', () => {
    // No share link, no shortcode, no guid — the address was never public, so
    // there is nothing to reserve and the trash's ↩ RESTORE is the better
    // affordance.
    STATE.audio = [LOCAL()];
    _audioDelete('a2');
    expect(STATE.audio).toHaveLength(0);
    expect(sessionTrash).toHaveLength(1);
  });

  it('does nothing when asked to delete a tombstone', () => {
    STATE.audio = [{ id: 'a1', slug: 'gone', retired: true }];
    _audioDelete('a1');
    expect(STATE.audio).toHaveLength(1);
  });

  it('does not retire when the confirm is declined', () => {
    vi.stubGlobal('confirm', () => false);
    STATE.audio = [PUBLISHED()];
    _audioDelete('a1');
    expect(STATE.audio[0].retired).toBeUndefined();
    expect(STATE.staged.audio).toBe(0);
  });
});

describe('the tombstone', () => {
  beforeEach(() => { STATE.audio = [PUBLISHED()]; _audioRetire('a1'); });

  it('keeps the id and the slug and strips everything else', () => {
    const t = STATE.audio[0];
    expect(t.id).toBe('a1');
    expect(t.slug).toBe('ferry-at-dawn');
    expect(t.retired).toBe(true);
    expect(t.retired_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    // No media, no metadata — the file is being deleted.
    expect(t.filename).toBeUndefined();
    expect(t.peaks).toBeUndefined();
    expect(t.episode).toBeUndefined();
    expect(t.title).toBeUndefined();
  });

  it('reserves the slug, which is the entire point', () => {
    // THE regression this guards. audioUniqueSlug reads STATE.audio, and the
    // tombstone is still in it — so a new track named the same thing is pushed
    // to -2 instead of silently inheriting a published address.
    expect(audioUniqueSlug('Ferry at Dawn', STATE.audio)).toBe('ferry-at-dawn-2');
  });

  it('queues the R2 object for deletion on the next publish', () => {
    expect(_pendingR2Deletes).toEqual([
      { keys: ['audio/ferry.mp3'], surface: 'audio', entryId: 'a1' },
    ]);
  });

  it('stages exactly one removal', () => {
    expect(STATE.staged.audio).toBe(1);
    expect(STATE.stagedLog.filter((r) => r.surface === 'audio')).toHaveLength(1);
    expect(STATE.stagedLog[0].kind).toBe('remove');
  });

  it('stays a tombstone through buildBundle', () => {
    // ⚠️ The dark-frame bug, exactly: running a tombstone through the live-track
    // whitelist drops `retired` and republishes it as a live track pointing at
    // media that was just deleted — a retire that silently un-retires.
    const audio = JSON.parse(buildBundle()['data/audio.json']);
    expect(audio).toEqual([
      { id: 'a1', slug: 'ferry-at-dawn', retired: true, retired_at: expect.any(String) },
    ]);
  });

  it('renders as an inert row naming the reserved address', () => {
    renderAudio();
    const html = document.getElementById('audio-display').innerHTML;
    expect(html).toContain('aud-row-retired');
    expect(html).toContain('/listen/?a=ferry-at-dawn');
    // A reservation nothing shows is a rule that surprises you later.
    expect(html).toContain('ADDRESS RESERVED');
  });

  it('is counted apart from the tracks, never among them', () => {
    STATE.audio.push(LOCAL(), { ...LOCAL(), id: 'a3', slug: 'ep-x', filename: 'x.mp3', episode: true });
    renderAudio();
    expect(document.getElementById('audio-count').textContent).toBe('2');
    expect(document.getElementById('audio-stats').textContent).toContain('1 retired');
    // …and it is not one of the "N of M tracks" in the podcast feed card: two
    // playable tracks, one of them an episode, and a reserved address is
    // neither.
    expect(document.getElementById('audio-feed-card').textContent).toContain('1 of 2 tracks');
  });
});

describe('↩ UNDO RETIRE — nothing is irreversible before publish', () => {
  beforeEach(() => { STATE.audio = [PUBLISHED()]; _audioRetire('a1'); });

  it('puts the whole track back, not a reconstruction of it', () => {
    _audioUndoRetire();
    expect(STATE.audio).toEqual([PUBLISHED()]);
  });

  it('un-arms the queued file deletion — it had not fired yet', () => {
    _audioUndoRetire();
    expect(_pendingR2Deletes).toEqual([]);
  });

  it('gives back the staged gesture rather than leaving the counter high', () => {
    _audioUndoRetire();
    expect(STATE.staged.audio).toBe(0);
    expect(STATE.stagedLog.filter((r) => r.surface === 'audio')).toHaveLength(0);
  });

  it('restores the ledger row the retire folded into, not a blank slate', () => {
    // A track edited and THEN retired had a pre-existing row; deleting it on
    // undo would discard that pending edit and un-protect the entry from the
    // next sync (the 2026-08-23 loss class).
    STATE.audio = [PUBLISHED()];
    STATE.staged.audio = 0;
    STATE.stagedLog = [];
    let call = 0;
    vi.stubGlobal('prompt', () => (call++ === 0 ? 'Renamed' : 'new sub'));
    _audioEdit('a1');
    const afterEdit = JSON.parse(JSON.stringify(STATE.stagedLog));
    _audioRetire('a1');
    _audioUndoRetire();
    expect(STATE.stagedLog).toEqual(afterEdit);
    expect(STATE.staged.audio).toBe(1);
  });

  it('offers the chip only while the tombstone is still the one it wrote', () => {
    expect(_audioRetireUndoTarget()).not.toBeNull();
    STATE.audio = [];                       // the entry is gone another way
    expect(_audioRetireUndoTarget()).toBeNull();
  });

  it('is spent after one use — one chip, not a history', () => {
    _audioUndoRetire();
    expect(_audioRetireUndoTarget()).toBeNull();
  });
});

describe('↩ UNDO EDIT — the prompt pair that overwrote with no way back', () => {
  beforeEach(() => {
    STATE.audio = [PUBLISHED()];
    let call = 0;
    vi.stubGlobal('prompt', () => (call++ === 0 ? 'A New Name' : 'A new subtitle'));
  });

  it('puts the old title and subtitle back', () => {
    _audioEdit('a1');
    expect(STATE.audio[0].title).toBe('A New Name');
    _audioUndoEdit();
    expect(STATE.audio[0].title).toBe('Ferry at Dawn');
    expect(STATE.audio[0].sub).toBe('Field recording');
  });

  it('gives back exactly the one gesture the edit staged', () => {
    _audioEdit('a1');
    expect(STATE.staged.audio).toBe(1);
    _audioUndoEdit();
    expect(STATE.staged.audio).toBe(0);
    expect(STATE.stagedLog).toHaveLength(0);
  });

  it('leaves a published slug alone in both directions', () => {
    // The slug is the address; renaming a PUBLISHED track must not move it, so
    // there is nothing for the undo to put back either.
    _audioEdit('a1');
    expect(STATE.audio[0].slug).toBe('ferry-at-dawn');
    _audioUndoEdit();
    expect(STATE.audio[0].slug).toBe('ferry-at-dawn');
  });

  it('restores a never-published track\'s slug, which the edit DID move', () => {
    STATE.audio = [LOCAL()];
    _audioEdit('a2');
    expect(STATE.audio[0].slug).toBe('a-new-name');
    _audioUndoEdit();
    expect(STATE.audio[0].slug).toBe('take-one');
  });

  it('offers nothing when the prompts changed nothing', () => {
    // An OK on an unedited prompt is not a gesture: no stage, no chip, and no
    // toast claiming an update happened.
    vi.stubGlobal('prompt', (label) => (/Title/.test(label) ? 'Ferry at Dawn' : 'Field recording'));
    _audioEdit('a1');
    expect(STATE.staged.audio).toBe(0);
    expect(_audioEditUndoTarget()).toBeNull();
  });

  it('drops the chip once the track is edited again', () => {
    // One chip, not a history: the remembered "before" is two edits back and
    // writing it now would clobber the edit in between.
    _audioEdit('a1');
    expect(_audioEditUndoTarget()).not.toBeNull();
    let call = 0;
    vi.stubGlobal('prompt', () => (call++ === 0 ? 'Third Name' : 'x'));
    _audioEdit('a1');
    const t = _audioEditUndoTarget();
    expect(t.before.title).toBe('A New Name');   // the chip tracks the LATEST edit
  });

  it('drops the chip when the track is gone', () => {
    _audioEdit('a1');
    STATE.audio = [];
    expect(_audioEditUndoTarget()).toBeNull();
  });

  it('renders the chip on the edited row and nowhere else', () => {
    STATE.audio = [PUBLISHED(), LOCAL()];
    _audioEdit('a1');
    renderAudio();
    const rows = document.getElementById('audio-display').innerHTML;
    expect((rows.match(/UNDO EDIT/g) || []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A SET retires on exactly the same terms, and for exactly the same reason.
//
// A set's slug is its address the moment it is published: a share link points
// at it, and (cards chunk 7) a stamped share image is keyed by it. Free the
// slug and the next set named the same thing quietly answers someone else's
// old link with a different playlist. Nothing errors.
//
// The one difference from a track: a set owns no media, so there is no R2
// delete to pair with the tombstone. Retiring one takes down a PRESENTATION.

const PUB_SET = () => ({
  id: 's1', slug: 'late-mix', name: 'Late mix', tracks: ['ferry-at-dawn'],
  added_at: '2026-09-10', _imported: true,
});
const LOCAL_SET = () => ({
  id: 's2', slug: 'drafts', name: 'Drafts', tracks: [], added_at: '2026-09-10',
});

describe('a published set retires; an unpublished one is trashed', () => {
  it('retires rather than removing, and keeps id + slug and nothing else', () => {
    STATE.audioSets = [PUB_SET()];
    _setDelete('s1');
    expect(STATE.audioSets).toHaveLength(1);
    expect(STATE.audioSets[0]).toMatchObject({ id: 's1', slug: 'late-mix', retired: true });
    expect(STATE.audioSets[0].name).toBeUndefined();
    expect(STATE.audioSets[0].tracks).toBeUndefined();
    expect(sessionTrash).toHaveLength(0);
  });

  it('queues NO R2 delete — a set owns no media', () => {
    STATE.audioSets = [PUB_SET()];
    _setDelete('s1');
    expect(_pendingR2Deletes).toHaveLength(0);
  });

  it('leaves the tracks alone', () => {
    STATE.audio = [PUBLISHED()];
    STATE.audioSets = [PUB_SET()];
    _setDelete('s1');
    expect(STATE.audio).toHaveLength(1);
    expect(STATE.audio[0].retired).toBeUndefined();
  });

  it('reserves the slug forever — a new set cannot take the dead address', () => {
    STATE.audioSets = [PUB_SET()];
    _setRetire('s1');
    expect(setUniqueSlug('Late mix', STATE.audioSets)).toBe('late-mix-2');
  });

  it('trashes a never-published set instead, which has nothing pointing at it', () => {
    STATE.audioSets = [LOCAL_SET()];
    _setDelete('s2');
    expect(STATE.audioSets).toHaveLength(0);
    expect(sessionTrash).toHaveLength(1);
  });

  it('↩ UNDO RETIRE puts the whole set back, tracks and all', () => {
    STATE.audioSets = [PUB_SET()];
    _setRetire('s1');
    expect(_setRetireUndoTarget()).not.toBeNull();
    _setUndoRetire();
    expect(STATE.audioSets[0]).toMatchObject({ name: 'Late mix', tracks: ['ferry-at-dawn'] });
    expect(STATE.audioSets[0].retired).toBeUndefined();
    expect(STATE.staged.audioSets).toBe(0);
    expect(_setRetireUndoTarget()).toBeNull();
  });

  it('drops the chip when the tombstone is no longer the tombstone we wrote', () => {
    STATE.audioSets = [PUB_SET()];
    _setRetire('s1');
    STATE.audioSets = [];
    expect(_setRetireUndoTarget()).toBeNull();
  });

  it('renders the tombstone as a visible reservation, not a gap', () => {
    STATE.audioSets = [PUB_SET()];
    _setRetire('s1');
    renderAudioSets();
    const html = document.getElementById('audio-sets-display').innerHTML;
    expect(html).toContain('ADDRESS RESERVED');
    expect(html).toContain('/listen/?set=late-mix');
    expect(html).toContain('UNDO RETIRE');
    // A reservation is not a set you can add to.
    expect(html).not.toContain('ADD TRACK');
  });
});

// The trap CLAUDE.md names by name: the live whitelist drops the tombstone flag
// and republishes the record as live. Three record kinds now need their own
// branch in buildBundle() — dark frames, retired tracks, retired sets.
describe('the set tombstone survives a publish', () => {
  it('serializes as a tombstone, not as a live set with an empty track list', () => {
    STATE.audioSets = [PUB_SET()];
    _setRetire('s1');
    const out = JSON.parse(buildBundle()['data/audio-sets.json']);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: 's1', slug: 'late-mix', retired: true, retired_at: expect.any(String) });
  });

  it('a live set keeps its name and its order', () => {
    STATE.audioSets = [{ id: 's3', slug: 'a-mix', name: 'A mix', tracks: ['b', 'a'], added_at: '2026-09-10' }];
    const out = JSON.parse(buildBundle()['data/audio-sets.json']);
    expect(out[0]).toEqual({ id: 's3', slug: 'a-mix', name: 'A mix', tracks: ['b', 'a'], added_at: '2026-09-10' });
  });

  it('a site with no sets publishes an empty array, never a missing file', () => {
    // The ZIP exporter treats every dataFile as required — a 404 sinks the
    // whole export — and the listen page reads it on every render.
    STATE.audioSets = [];
    expect(buildBundle()['data/audio-sets.json']).toBe('[]');
  });
});
