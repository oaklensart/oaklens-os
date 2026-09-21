// @vitest-environment happy-dom
//
// A TAKEOVER IS A DRAFT UNTIL YOU TOUCH IT — and a card's provenance has to
// stay true when its picture changes.
//
// **Why this file exists.** `data/cards.json` reached ten records in a week and
// every one of them was a retired tombstone. The loop: ✎ EDIT THIS CARD seeds a
// card from the slot it took over — picture, crop, title — which makes it
// renderable immediately. Publish is an all-or-nothing snapshot of every
// surface, so the next publish of ANYTHING committed it; `_imported` then
// flipped ↩ RESET TO AUTOMATIC into ◼ RETIRE THIS CARD, a permanent address
// reservation behind a confirm dialog. Every card the owner merely looked at
// became a tombstone.
//
// The other half is the duplicate that started the report: dedupe keyed on the
// composed card's `media` filename, and the picture picker lists an original
// upload beside its own derivative — so re-picking "the same photograph" wrote
// a different string, the automatic card was no longer suppressed, and 333
// Market shipped on the homepage twice. `source` is identity; a filename is
// not. This file pins the console half; tests/card-composer.test.js pins the
// engine half.
//
// docs/maintenance/2026-09-18-cards-duplicate-and-draft-publish.md
import { describe, it, expect, beforeEach } from 'vitest';

// console-state.js reaches its renderers through the global scope at call time.
for (const fn of [
  'refreshStageIndicators', 'renderTrash', 'renderBuffer', 'renderArchive',
  'renderFN', 'fnNewPost', 'renderWall', 'renderNetwork',
  'renderLibrary', 'showView', 'scheduleLibrarySync', 'updatePurgeR2Button',
  'isVideoAsset', 'renderAudio', 'renderCards',
]) globalThis[fn] = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

await import('../js/audio-player.js');
await import('../js/recent-index.js');
const { STATE, sessionTrash } = await import('../js/console-state.js');
const { _sourceForMedia } = await import('../js/console/cards.js');
const { buildBundle } = await import('../js/console/publish.js');

const CARD = (over) => ({
  id: 'c-1', order: 1, title: 'Mine', media: 'G.webp', folder: 'archive',
  added_at: '2026-09-18T00:00:00Z', source: { surface: 'archive', id: 'p-1' },
  ...over,
});

beforeEach(() => {
  document.body.innerHTML = '<div id="toast-host"></div>';
  for (const k of ['buffer', 'archive', 'posts', 'audio', 'audioSets', 'wallpapers',
    'friends', 'library', 'cards']) STATE[k] = [];
  STATE.staged = {
    buffer: 0, archive: 0, posts: 0, wallpapers: 0,
    friends: 0, library: 0, audio: 0, cards: 0,
  };
  STATE.stagedLog = [];
  sessionTrash.length = 0;
});

const cardsOut = () => JSON.parse(buildBundle()['data/cards.json']);

describe('a draft card is not committed', () => {
  it('leaves a _draft card out of the bundle', () => {
    STATE.cards = [CARD({ _draft: true })];
    expect(cardsOut()).toEqual([]);
  });

  it('commits the same card once the draft mark is gone', () => {
    STATE.cards = [CARD()];
    const out = cardsOut();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c-1');
  });

  it('never writes the private mark into the published file', () => {
    // buildBundle uses a field whitelist, so this is belt and braces — but the
    // whole point of the flag is that it stays in the console.
    STATE.cards = [CARD()];
    expect(JSON.stringify(cardsOut())).not.toContain('_draft');
  });

  it('commits the live cards beside a draft rather than bailing on the file', () => {
    STATE.cards = [CARD({ id: 'c-live' }), CARD({ id: 'c-draft', order: 2, _draft: true })];
    expect(cardsOut().map((c) => c.id)).toEqual(['c-live']);
  });

  it('still writes a retired tombstone, which is not a draft', () => {
    // The tombstone branch reserves a published id forever. A draft was never
    // published, so the two must not be confused for one another.
    STATE.cards = [{ id: 'c-dead', order: 1, retired: true, retired_at: '2026-09-18T00:00:00Z' }];
    const out = cardsOut();
    expect(out).toHaveLength(1);
    expect(out[0].retired).toBe(true);
  });
});

describe('a card the bundle left behind is not stamped as published', () => {
  // ⚠️ THE BACK DOOR. After a successful publish the console marks every entry
  // on every surface `_imported = true`. Stamping a held-back card there would
  // hand it the permanent address it never got — the same tombstone loop, one
  // publish later and much harder to see. Asserted against the real source so
  // a refactor of that loop cannot quietly drop the guard.
  it('guards the post-publish stamp with the draft flag', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(import.meta.dirname, '..', 'js', 'console', 'publish.js'), 'utf8');
    expect(src).toMatch(/if \(!e\._draft\) e\._imported = true;/);
  });
});

describe('provenance follows the picture, or it goes', () => {
  it('finds the archive entry that owns a filename', () => {
    STATE.archive = [{ id: 'p-1', slug: 'granite', filename: 'G.webp' }];
    expect(_sourceForMedia('G.webp')).toEqual({ surface: 'archive', id: 'p-1' });
  });

  it('finds a buffer frame', () => {
    STATE.buffer = [{ id: 'f-1', filename: 'F.webp' }];
    expect(_sourceForMedia('F.webp')).toEqual({ surface: 'buffer', id: 'f-1' });
  });

  it("finds a field note by its hero, and answers with the post's id", () => {
    // Not fn_id. The engine dedupes on `id` because that is what the console
    // writes; see tests/card-composer.test.js for the other end of this.
    STATE.posts = [{ id: 'n-1', fn_id: 'fn-1', hero_filename: 'H.webp' }];
    expect(_sourceForMedia('H.webp')).toEqual({ surface: 'posts', id: 'n-1' });
  });

  it('answers null for a file no entry claims', () => {
    // A wallpaper or an unassigned upload has no automatic card to suppress, so
    // claiming provenance for it would be a lie the grid acts on.
    STATE.wallpapers = [{ id: 'w-1', filename: 'W.webp' }];
    expect(_sourceForMedia('W.webp')).toBeNull();
    expect(_sourceForMedia('nothing.webp')).toBeNull();
    expect(_sourceForMedia('')).toBeNull();
  });

  it('does not answer with an entry that has no id', () => {
    STATE.archive = [{ slug: 'granite', filename: 'G.webp' }];
    expect(_sourceForMedia('G.webp')).toBeNull();
  });
});
