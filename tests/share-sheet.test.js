// @vitest-environment happy-dom
//
// THE SHARE BLOCK — js/console/share.js, chunk 8 of docs/cards-core-complete.md.
//
// Chunk 7 built the painter and nothing asked it for a `native` or a `story`;
// `meta/fn-*`, `meta/set-*` and `meta/card-*` resolved at the edge and returned
// null forever, because no button wrote one. This file is about the button.
//
// Three properties, and each one is a real failure mode rather than a
// formality:
//
//   1. THE KEYS. The console uploads to an address the edge heads. A drifted
//      key is silent — nothing red, every shared link unfurling with nothing.
//      tests/share-keys.test.js holds the two spellings together; this file
//      holds what the SURFACES pick, which is the half that decides which key
//      is even asked for (a note with a hero keys off the hero, one without
//      keys off itself — the edge makes that split, so the studio must too).
//
//   2. NOTHING HALF-DRAWN REACHES R2. A stamp writes to a permanent address
//      that link previews already point at, so a paint that fails must upload
//      nothing at all rather than two files out of three. Chunk 7's code review
//      found ▲ Publish shipping a card whose photograph had not arrived.
//
//   3. NULL IS AN ANSWER. A pulse has no page, the automatic playlist is nobody
//      saved set, and a note that has never been staged has no address yet.
//      Each has to read as "no block", not as a block with four dead buttons.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  const add = (name, content) => {
    const m = document.createElement('meta');
    m.setAttribute('name', name);
    m.setAttribute('content', content);
    document.head.appendChild(m);
  };
  add('site-name', 'ZZ Test');
  add('site-wordmark', 'ZZTESTMARK');
  add('cdn-base', 'https://cdn.example/api/cdn');
});

// The painter is stubbed, not exercised — tests/card-paint.test.js owns what it
// draws. What matters here is WHICH ratios are asked for and in what order, so
// the stub records and hands back a canvas-shaped thing.
const painted = [];
let paintFails = '';
vi.mock('../js/console/card-paint.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    paintCard: async (item, ratio) => {
      if (paintFails === ratio) throw new Error('picture never arrived');
      painted.push({ item, ratio });
      return { toBlob: (cb) => cb(new Blob([`fake-${ratio}`], { type: 'image/webp' })) };
    },
  };
});

const uploaded = [];
let uploadFails = false;
vi.mock('../js/console-api.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getToken: () => 'a-token',
    uploadFiles: async (files) => {
      if (uploadFails) throw new Error('R2 said no');
      uploaded.push(files.map((f) => f.name));
      return { ok: true };
    },
  };
});

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

await import('../js/audio-player.js');
await import('../js/recent-index.js');
const RI = globalThis.RecentIndex;
const { STATE } = await import('../js/console-state.js');
const share = await import('../js/console/share.js');
const cards = await import('../js/console/cards.js');
const audio = await import('../js/console/audio.js');
const { _setOgCardSet } = await import('../js/console/buffer.js');
const { shareStem, shareKey } = await import('../js/console/card-paint.js');

const POST_HERO = {
  id: 'n-1', fn_id: 'on-walking', title: 'On Walking', body: 'Words enough to tease.',
  hero_filename: 'SAMPLE_Hero.webp', card: { layout: 'hero' }, added_at: '2026-09-03',
};
const POST_WORDS = {
  id: 'n-2', fn_id: 'just-words', title: 'Just Words', body: 'A note that leads with its writing.',
  added_at: '2026-09-02',
};
const TRACK = {
  id: 'a-1', slug: 'field-hum', filename: 'field-hum.mp3', title: 'Field Hum',
  sub: 'ambient sketch', duration: 94, peaks: '12,40,80,30,60', added_at: '2026-09-04',
};
const FRAME = {
  id: 'ar-1', slug: 'evening-light', filename: 'SAMPLE_Evening.webp', title: 'Evening Light',
  added_at: '2026-09-01',
};

beforeEach(() => {
  document.body.innerHTML = '<div id="cards-body"></div><div id="toast-host"></div>'
    // The two modals whose own module-scope Escape listeners share `document`
    // with this one. asset-library's reads `.classList` with no optional chain,
    // so its element has to exist or ANY Escape in this file throws inside its
    // handler — which is the shipped shell's shape anyway.
    + '<div class="modal-overlay hidden" id="asset-library-modal"></div>'
    + '<div class="modal-overlay hidden" id="audio-library-modal"></div>'
    + '<div class="sheet-overlay hidden" id="share-sheet">'
    + '<div class="sheet"><div class="sheet-title" id="share-sheet-title"></div>'
    + '<div id="share-sheet-body"></div><p id="share-sheet-note"></p></div></div>'
    + '<div id="toast-zone"></div>';
  for (const k of ['buffer', 'archive', 'posts', 'audio', 'audioSets', 'cards', 'wallpapers']) STATE[k] = [];
  painted.length = 0;
  uploaded.length = 0;
  paintFails = '';
  uploadFails = false;
  _setOgCardSet([]);
});

// ------------------------------------------------------- what a slot shares

/** The slot the studio would build for one item, straight from the view's own
 *  describer — so this file never restates what a slot is. */
const slotOf = (item) => cards._slotOf(item);

describe('what a slot can be shared as', () => {
  it('an archive frame keys off its image basename, the historic stamp', () => {
    const t = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    expect(t.stem).toBe('meta/SAMPLE_Evening');
    expect(t.url).toBe(`${location.origin}/archive/?f=evening-light`);
  });

  it('a RAW frame keys the same way and points at the buffer page', () => {
    const t = cards._shareOf(slotOf({ kind: 'photo', raw: true, data: { ...FRAME, id: 'buf-9', num: 641 } }));
    expect(t.stem).toBe('meta/SAMPLE_Evening');
    expect(t.url).toBe(`${location.origin}/archive/buffer/?f=buf-9`);
  });

  // ⚠️ THE SPLIT THE EDGE MAKES. worker.js reads meta/<heroBase>-og.webp for a
  // note that has a hero and meta/fn-<slug>-og.webp for one that does not.
  // Stamping the other key writes a file nothing will ever read.
  it('a note with a hero keys off the hero — nothing already stamped re-stamps', () => {
    const t = cards._shareOf(slotOf({ kind: 'text', data: POST_HERO }));
    expect(t.stem).toBe('meta/SAMPLE_Hero');
    expect(t.url).toBe(`${location.origin}/field-notes/post?slug=on-walking`);
  });

  it('a note that leads with words gets its own stem — the gap chunk 7 opened', () => {
    const t = cards._shareOf(slotOf({ kind: 'text', data: POST_WORDS }));
    expect(t.stem).toBe('meta/fn-just-words');
  });

  it('a note never staged for publish has no address, so no block', () => {
    const { fn_id, ...draft } = POST_WORDS;
    expect(cards._shareOf(slotOf({ kind: 'text', data: draft }))).toBeNull();
  });

  it('a track keys off its slug and points at its permalink', () => {
    const t = cards._shareOf(slotOf({ kind: 'audio', data: TRACK }));
    expect(t.stem).toBe('meta/audio-field-hum');
    expect(t.url).toBe(`${location.origin}/listen/?a=field-hum`);
  });

  it('the automatic playlist is nobody\'s saved set — nothing to stamp', () => {
    const slot = slotOf({ kind: 'audio', data: { isPlaylist: true, tracks: [TRACK, { ...TRACK, slug: 'two' }] } });
    expect(cards._shareOf(slot)).toBeNull();
  });

  it('a pulse has no page of its own, and so no share block', () => {
    const slot = slotOf({ kind: 'pulse', data: { id: 'p-1', text: 'Live now', state: 'signal' } });
    expect(cards._shareOf(slot)).toBeNull();
  });

  it('a composed card shares as itself, at its own permanent address', () => {
    const card = { id: 'c-abc123', title: 'A Card', label: 'Featured', added_at: '2026-09-10' };
    const t = cards._shareOf(slotOf(RI.composedItem(card, [], [])));
    expect(t.stem).toBe('meta/card-c-abc123');
    expect(t.url).toBe(`${location.origin}/card/c-abc123`);
  });

  // A STAGED address is reserved, not answering (2026-09-12): the owner pasted a
  // fresh card's link and got "no card at this address", because nothing is on
  // the site until publish. The target says so, and the copy-link toast reads it.
  // ⚠️ The first cut read `t.slot.live` — a field no target has ever carried, so
  // the toast could never change. `_imported` is the console's own mark for
  // "this record came from the live data".
  it('knows whether the address answers yet — staged until the record is published', () => {
    const fresh = { id: 'c-new', title: 'New', added_at: '2026-09-12' };
    const live = { ...fresh, id: 'c-old', _imported: true };
    expect(cards._shareOf(slotOf(RI.composedItem(fresh, [], []))).staged).toBe(true);
    expect(cards._shareOf(slotOf(RI.composedItem(live, [], []))).staged).toBe(false);
    // The same for a track and a note: an address that publish has not written.
    expect(cards._shareOf(slotOf({ kind: 'audio', data: TRACK })).staged).toBe(true);
    expect(cards._shareOf(slotOf({ kind: 'audio', data: { ...TRACK, _imported: true } })).staged).toBe(false);
    expect(cards._shareOf(slotOf({ kind: 'text', data: POST_WORDS })).staged).toBe(true);
    expect(cards._shareOf(slotOf({ kind: 'text', data: { ...POST_WORDS, _imported: true } })).staged).toBe(false);
  });

  it('the copy-link toast says a staged link works once you publish', async () => {
    const fresh = { id: 'c-new', title: 'New', added_at: '2026-09-12' };
    const t = cards._shareOf(slotOf(RI.composedItem(fresh, [], [])));
    const written = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (s) => { written.push(s); } }, configurable: true,
    });
    share.shareBlockBody(t);              // arms the target under its stem
    share.shareCopyLink(t.stem);
    await new Promise((r) => setTimeout(r, 0));
    expect(written).toEqual([t.url]);
    expect(document.getElementById('toast-zone').textContent).toContain('once you publish');
  });
});

// ----------------------------------------------------------- a saved set

describe('a saved set is an address too', () => {
  it('the engine spells /listen/?set= in one place now', () => {
    expect(RI.entryHref('set', { slug: 'late-summer' })).toBe('/listen/?set=late-summer');
    expect(RI.entryHref('set', {}), 'no slug, no address').toBe('');
    expect(RI.entryHref('set', { slug: 'a b/c' })).toBe('/listen/?set=a%20b%2Fc');
  });

  it('a set and a track with the same slug keep separate stamps', () => {
    expect(shareStem({ kind: 'set', id: 'dusk' })).not.toBe(shareStem({ kind: 'audio', id: 'dusk' }));
  });

  it('the shelf opens the sheet on the set\'s own card', () => {
    STATE.audio = [TRACK];
    STATE.audioSets = [{ id: 's-1', slug: 'late-summer', name: 'Late Summer', tracks: ['field-hum'] }];
    audio._setShare('s-1');
    expect(document.getElementById('share-sheet').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('share-sheet-title').textContent).toContain('Late Summer');
    expect(document.getElementById('share-sheet-body').innerHTML).toContain('/listen/?set=late-summer');
  });

  it('an empty set is not offered a share sheet — there is no card to paint', () => {
    STATE.audioSets = [{ id: 's-2', slug: 'empty', name: 'Empty', tracks: [] }];
    audio._setShare('s-2');
    expect(document.getElementById('share-sheet').classList.contains('hidden')).toBe(true);
  });
});

// ------------------------------------------------------------- the stamp

/** Focus a target the way a rendered block does, and hand back its stem. */
function arm(item, over) {
  const t = cards._shareOf(slotOf(over ? RI.composedItem(over, [], []) : item));
  share.shareBlockBody(t);
  return t.stem;
}

describe('▲ STAMP SHARE IMAGES', () => {
  it('paints all three ratios and uploads all three keys in one request', async () => {
    const stem = arm({ kind: 'photo', data: FRAME });
    await share.shareStampImages(stem);
    expect(painted.map((p) => p.ratio)).toEqual(['og', 'native', 'story']);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toEqual([
      shareKey(stem, 'og'), shareKey(stem, 'native'), shareKey(stem, 'story'),
    ]);
  });

  // The og key keeps the historic suffix on purpose: it is the one an unfurl
  // reads, and every card stamped before chunk 7 has to keep serving.
  it('the og file keeps the name every stamped card already has', async () => {
    const stem = arm({ kind: 'photo', data: FRAME });
    await share.shareStampImages(stem);
    expect(uploaded[0][0]).toBe('meta/SAMPLE_Evening-og.webp');
  });

  it('hands the painter the same item the card is built from, not a re-derivation', async () => {
    const stem = arm({ kind: 'text', data: POST_HERO });
    await share.shareStampImages(stem);
    expect(painted[0].item.kind).toBe('text');
    expect(painted[0].item.data.fn_id).toBe('on-walking');
  });

  // Property 2: a permanent address must never receive a partial set.
  it('a paint that fails uploads NOTHING — not two files out of three', async () => {
    const stem = arm({ kind: 'photo', data: FRAME });
    paintFails = 'story';
    await share.shareStampImages(stem);
    expect(painted.map((p) => p.ratio)).toEqual(['og', 'native']);
    expect(uploaded, 'no half-stamped card reaches R2').toEqual([]);
  });

  it('a failed upload leaves the card unmarked, so the block still offers the stamp', async () => {
    const t = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    share.shareBlockBody(t);
    uploadFails = true;
    await share.shareStampImages(t.stem);
    expect(share.shareIsStamped(t.stem)).toBe(false);
    expect(share.shareBlockBody(t)).toContain('▲ STAMP SHARE IMAGES');
  });

  it('marks the card stamped, and the block says so', async () => {
    const t = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    share.shareBlockBody(t);
    expect(share.shareBlockAside(t)).toBe('not stamped yet');
    await share.shareStampImages(t.stem);
    expect(share.shareIsStamped(t.stem)).toBe(true);
    expect(share.shareBlockAside(t)).toBe('stamped');
    expect(share.shareBlockBody(t)).toContain('↻ RE-STAMP SHARE IMAGES');
  });

  // The marker survives a reload because it lives in R2, not in a local flag:
  // /api/og-cards lists every stem under meta/, loadOgCards() fills the set at
  // boot, and the block reads the same set the buffer's ▣ badge reads.
  it('the stamped state comes back from /api/og-cards after a reload', () => {
    const t = cards._shareOf(slotOf({ kind: 'text', data: POST_WORDS }));
    expect(share.shareIsStamped(t.stem)).toBe(false);
    _setOgCardSet(['SAMPLE_Evening', 'fn-just-words', 'card-c-abc123']);
    expect(share.shareIsStamped(t.stem)).toBe(true);
    expect(share.shareMarker(t.stem)).toBe('fn-just-words');
  });

  it('a stem nobody armed does nothing at all', async () => {
    await share.shareStampImages('meta/never-rendered');
    expect(painted).toEqual([]);
    expect(uploaded).toEqual([]);
  });
});

// ---------------------------------------------------------- the downloads

describe('⤓ DOWNLOAD', () => {
  it('paints exactly the ratio asked for, and never uploads', async () => {
    const stem = arm({ kind: 'photo', data: FRAME });
    globalThis.URL.createObjectURL = () => 'blob:x';
    globalThis.URL.revokeObjectURL = () => {};
    await share.shareDownload(stem, 'story');
    expect(painted.map((p) => p.ratio)).toEqual(['story']);
    expect(uploaded).toEqual([]);
  });

  it('refuses a ratio the painter does not have', async () => {
    const stem = arm({ kind: 'photo', data: FRAME });
    await share.shareDownload(stem, 'square');
    expect(painted).toEqual([]);
  });

  // The old OG download shipped every fork a file with THIS instance's name on
  // it. The prefix is read from site config through the edge-injected meta.
  it('names the file for the site, never for a literal', () => {
    expect(share.shareFileName('meta/fn-just-words', 'native')).toBe('ZZTEST-fn-just-words-native.webp');
  });
});

// ------------------------------------------------------------- the copy

describe('the block\'s own copy', () => {
  it('says what stamping is for, in words a photographer reads', () => {
    const t = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    expect(share.shareBlockNote(t)).toMatch(/pastes this link/);
    expect(share.shareBlockNote(t)).not.toMatch(/og:image|R2|CDN/);
  });

  it('on LIVE it says the gesture does not wait for publish', () => {
    const t = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    expect(share.shareBlockNote(t, { live: true })).toMatch(/not a staged change/);
  });

  it('once stamped it says a stale stamp keeps showing until you re-stamp', async () => {
    const t = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    share.shareBlockBody(t);
    await share.shareStampImages(t.stem);
    expect(share.shareBlockNote(t)).toMatch(/Re-stamp/);
  });

  // The composer rail already shows the address in chunk 6's CARD ADDRESS block
  // two inches up, with its own COPY. Both halves go — the redundancy was never
  // the line, it was two buttons three inches apart copying one URL.
  it('drops the address AND the copy where the surface already shows one', () => {
    const t = cards._shareOf(slotOf(RI.composedItem({ id: 'c-1', title: 'X' }, [], [])));
    expect(share.shareBlockBody(t)).toContain('share-addr');
    expect(share.shareBlockBody(t)).toContain('COPY LINK');
    const trimmed = share.shareBlockBody(t, { showLink: false });
    expect(trimmed).not.toContain('share-addr');
    expect(trimmed).not.toContain('COPY LINK');
    // What is left is the half the address block cannot do.
    expect(trimmed).toContain('STAMP SHARE IMAGES');
    expect(share.shareBlockNote(t, { showLink: false })).toContain('the address above');
  });

  it('no target, no markup — never a header over four dead buttons', () => {
    expect(share.shareBlockBody(null)).toBe('');
    expect(share.shareBlockAside(null)).toBe('');
    expect(share.shareBlockNote(null)).toBe('');
  });
});

// --------------------------------------------- the things a review found
//
// Five defects a green suite could not see, each pinned by the case that was
// red before its fix.

describe('one stamp at a time', () => {
  it('greys EVERY stamp button while one is in flight, not just its own', async () => {
    const a = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    const b = cards._shareOf(slotOf({ kind: 'text', data: POST_WORDS }));
    share.shareBlockBody(a); share.shareBlockBody(b);
    let seen = null;
    // Catch the markup MID-STAMP: the painter stub runs inside the await, so
    // this fires while _busy is set.
    const pending = share.shareStampImages(a.stem);
    seen = { a: share.shareBlockBody(a), b: share.shareBlockBody(b) };
    await pending;
    expect(seen.a, 'the one stamping says so').toContain('◌ STAMPING…');
    expect(seen.b, 'the other one does NOT claim to be stamping').not.toContain('◌ STAMPING…');
    expect(seen.b, 'but it is still greyed — one at a time').toContain('disabled');
    expect(seen.b).toContain('Another card is being stamped');
  });

  it('a click that slips through says why instead of doing nothing', async () => {
    const a = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    const b = cards._shareOf(slotOf({ kind: 'text', data: POST_WORDS }));
    share.shareBlockBody(a); share.shareBlockBody(b);
    const pending = share.shareStampImages(a.stem);
    await share.shareStampImages(b.stem);      // the dead click
    await pending;
    expect(uploaded, 'only the first one uploaded').toHaveLength(1);
    expect(uploaded[0][0]).toBe('meta/SAMPLE_Evening-og.webp');
    expect(painted.every((x) => x.item.data.filename === 'SAMPLE_Evening.webp'),
      'the second card was never painted').toBe(true);
  });

  it('and the lock lifts when the stamp finishes', async () => {
    const a = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    await share.shareStampImages(share.shareBlockBody(a) && a.stem);
    expect(share.shareBlockBody(a)).not.toContain('disabled');
  });
});

describe('Escape closes the sheet, and the key stops there', () => {
  const esc = () => {
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    return e;
  };

  it('closes an open sheet', () => {
    STATE.audio = [TRACK];
    audio._audioShare('a-1');
    expect(document.getElementById('share-sheet').classList.contains('hidden')).toBe(false);
    esc();
    expect(share._shareSheetOpen()).toBe(false);
  });

  // ⚠️ THE HALF THAT IS THE BUG. This sheet opens over the field-note editor,
  // whose own Escape unwinds its menu, its drawer, its preview and then FOCUS
  // MODE. A bubble-phase listener would let one press close the sheet AND drop
  // the writer out of focus mode behind it.
  it('stops the key, so a handler underneath never also fires', () => {
    STATE.audio = [TRACK];
    audio._audioShare('a-1');
    let underneath = 0;
    const spy = () => { underneath += 1; };
    document.addEventListener('keydown', spy);           // bubble phase, like fn-editor's
    const e = esc();
    document.removeEventListener('keydown', spy);
    expect(underneath, 'the handler below must not see it').toBe(0);
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores Escape when no sheet is open — it belongs to whatever is', () => {
    let underneath = 0;
    const spy = () => { underneath += 1; };
    document.addEventListener('keydown', spy);
    esc();
    document.removeEventListener('keydown', spy);
    expect(underneath).toBe(1);
  });
});

describe('copying without a clipboard', () => {
  // navigator.clipboard is undefined outside a secure context — an iPad on
  // http://<LAN ip>:8787 against `wrangler dev`. Reading .writeText off it
  // throws synchronously, before any .then exists to catch it, and from an
  // inline handler that is an unhandled TypeError: the button does nothing and
  // says nothing.
  it('says the address instead of throwing', () => {
    const t = cards._shareOf(slotOf({ kind: 'photo', data: FRAME }));
    share.shareBlockBody(t);
    const saved = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      expect(() => share.shareCopyLink(t.stem)).not.toThrow();
    } finally {
      if (saved) Object.defineProperty(navigator, 'clipboard', saved);
      else delete navigator.clipboard;
    }
  });
});

describe('what a card is called', () => {
  // '— untitled —' is what a TILE prints when there is nothing to print. It is
  // not a name, and a toast reading "✓ — untitled — — share images stamped" is
  // two em-dashes colliding around a placeholder.
  it('an untitled composed card is "this card", not the tile placeholder', () => {
    const t = cards._shareOf(slotOf(RI.composedItem({ id: 'c-blank' }, [], [])));
    expect(t.name).not.toContain('untitled');
    expect(t.name).toBe('this card');
  });

  // A card with no title but a tease is named by its tease — the tile's own
  // rule. The composer used to build its own target and answer 'this card' to
  // the same question; tests/cards-composer.test.js holds the two together now.
  it('a card with only a tease is named by its tease', () => {
    const card = { id: 'c-tease', tease: 'A quiet morning on the water.', added_at: '2026-09-10' };
    expect(cards._shareOf(slotOf(RI.composedItem(card, [], []))).name)
      .toBe('A quiet morning on the water.');
  });
});

// ------------------------------------------------------- the field note

// The editor's DOM, trimmed to what fnLoadPost writes into — the same fixture
// tests/fn-hero-card.test.js keeps, and tests/console-boot.test.js is what keeps
// either of them honest against the shipped shell.
const FN_DOM = `
  <div class="fn-studio">
    <input id="fn-id"><input id="fn-title"><input id="fn-location"><input id="fn-date">
    <textarea id="fn-body"></textarea>
    <span id="fn-status-badge"></span>
    <button id="fn-delete-btn"></button>
    <div class="fn-hero" id="fn-hero-slot">
      <div id="fn-hero-empty"></div>
      <img id="fn-hero-thumb"><div id="fn-hero-name"></div>
      <button id="fn-hero-focal"></button>
      <button id="fn-hero-card" aria-pressed="false">▢ HERO CARD</button>
      <button id="fn-hero-clear"></button>
    </div>
    <div id="fn-preview"></div>
    <span id="fn-sync"></span><span id="fn-word-count"></span><span id="fn-read-time"></span>
    <select id="fn-doc-select"></select>
  </div>`;

describe('sharing the open field note', () => {
  let fn;
  beforeEach(async () => {
    fn = await import('../js/console/fn-editor.js');
    document.body.insertAdjacentHTML('beforeend', FN_DOM);
  });

  it('needs an address: with no note open there is nothing to share', () => {
    STATE.posts = [POST_WORDS];
    expect(share.fnShareTarget()).toBeNull();
  });

  it('a published note that leads with words gets its own stem', () => {
    STATE.posts = [POST_WORDS];
    fn.fnLoadPost('n-2');
    const t = share.fnShareTarget();
    expect(t.stem).toBe('meta/fn-just-words');
    expect(t.url).toBe(`${location.origin}/field-notes/post?slug=just-words`);
  });

  it('a DRAFT is refused — fn_id is minted when a note is staged', () => {
    STATE.posts = [{ ...POST_WORDS, status: 'draft' }];
    fn.fnLoadPost('n-2');
    expect(share.fnShareTarget()).toBeNull();
  });

  it('a note with a hero shares as its hero-forward card, off the hero key', () => {
    STATE.posts = [POST_HERO];
    fn.fnLoadPost('n-1');
    const t = share.fnShareTarget();
    expect(t.stem).toBe('meta/SAMPLE_Hero');
    expect(t.item.data.card).toEqual({ layout: 'hero' });
  });

  it('and the menu action says why when there is no address yet', () => {
    STATE.posts = [{ ...POST_WORDS, status: 'draft' }];
    fn.fnLoadPost('n-2');
    share.shareNote();
    expect(document.getElementById('share-sheet').classList.contains('hidden')).toBe(true);
  });
});
