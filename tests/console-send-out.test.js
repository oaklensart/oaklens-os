// @vitest-environment happy-dom
//
// Send it out (js/console/send-out.js, K67): the newest live piece, how its
// link unfurls (read from the page itself), the post counted the way each
// platform counts, and the story card with a QR home inside the band a
// story's chrome leaves clear. The owner: "You publish to ground you own
// first, then push to the platforms, never the reverse."

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

let O, P;
beforeAll(async () => {
  O = await import('../js/console/send-out.js');
  P = await import('../js/console/card-paint.js');
});

describe('what goes out', () => {
  it('the newest live piece with an address: a note, a photograph or a frame; never a draft, never a dark frame', () => {
    const state = {
      posts: [
        { id: 'n1', fn_id: 'fn-001', title: 'Older note', status: 'published', added_at: '2026-09-01T00:00:00Z', _imported: true },
        { id: 'd1', fn_id: '', title: 'Draft', status: 'draft', added_at: '2026-10-05T00:00:00Z' },
      ],
      archive: [{ id: 'a1', slug: 'say-yes', title: 'Say Yes', added_at: '2026-10-02T00:00:00Z', _imported: true }],
      buffer: [
        { id: 'f1', filename: 'x.jpg', captured_at: '2026-10-04T00:00:00Z', published_at: '2026-10-04T00:00:00Z', _imported: true, dark: true },
        { id: 'f2', filename: 'y.jpg', captured_at: '2026-09-01T00:00:00Z', published_at: '2026-09-01T00:00:00Z', _imported: true },
      ],
    };
    const p = O.latestAddressable(state);
    expect(p.kind).toBe('archive');
    expect(p.title).toBe('Say Yes');
  });

  it('on a surface a sync has marked, only what is on main counts', () => {
    const p = O.latestAddressable({
      posts: [
        { id: 'n1', fn_id: 'fn-001', title: 'Live', status: 'published', added_at: '2026-09-01T00:00:00Z', _imported: true },
        { id: 'n2', fn_id: 'fn-002', title: 'Staged, not live', status: 'published', added_at: '2026-10-01T00:00:00Z' },
      ],
    });
    expect(p.title).toBe('Live');
  });

  it('nothing live is nothing to send', () => {
    expect(O.latestAddressable({ posts: [], archive: [], buffer: [] })).toBeNull();
  });
});

describe('counting, the way each platform counts', () => {
  it('Bluesky counts graphemes: an emoji with its modifiers is one', () => {
    expect(O.graphemes('abc')).toBe(3);
    expect(O.graphemes('👍🏽')).toBe(1);
    expect(O.graphemes('Building 🦆 Logic')).toBe(16);
  });
  it('X counts any link as 23, and wide characters as 2', () => {
    expect(O.xWeight('hello https://example.com/a/very/long/path/that/goes/on')).toBe(6 + 23);
    expect(O.xWeight('日本')).toBe(4);
    expect(O.LIMITS).toEqual({ bluesky: 300, x: 280 });
  });
  it('the post starts as the title and the full page address', () => {
    expect(O.postText({ name: 'Say Yes', url: 'https://example.com/archive/?f=say-yes' })).toBe('Say Yes\n\nhttps://example.com/archive/?f=say-yes');
  });
});

describe('how it unfurls, read from the page', () => {
  const page = `<!doctype html><html><head><title>Fallback</title>
    <meta property="og:title" content="Say Yes — SITE">
    <meta property="og:description" content="CITY · 2026">
    <meta property="og:image" content="https://cdn.example.com/meta/x-og.webp">
    <meta name="twitter:card" content="summary_large_image"></head><body></body></html>`;
  it('reads the og: and twitter: tags as the edge injected them', () => {
    const t = O.unfurlTags(page);
    expect(t['og:title']).toBe('Say Yes — SITE');
    expect(t['twitter:card']).toBe('summary_large_image');
  });
  it('says plainly what a preview will be missing', () => {
    const ok = O.unfurlVerdict(O.unfurlTags(page), { ok: true, w: 1200, h: 630 });
    expect(ok.every(([s]) => s === 'ok')).toBe(true);
    const bare = O.unfurlVerdict(O.unfurlTags('<html><head><title>Only a title</title></head></html>'), null);
    expect(bare.find(([, n]) => n === 'Picture')[0]).toBe('bad');
    expect(bare.find(([, n]) => n === 'Title')[2]).toBe('Only a title');
    const broken = O.unfurlVerdict(O.unfurlTags(page), { ok: false });
    expect(broken.find(([, n]) => n === 'Picture')[2]).toMatch(/does not load/);
  });
  it('reads the page in the console, so the edge gains no route and the CSP no host', () => {
    const src = readFileSync(join(ROOT, 'js/console/send-out.js'), 'utf8');
    expect(src).toMatch(/await fetch\(url, \{ credentials: 'omit', cache: 'no-store' \}\)/);
    expect(src).not.toMatch(/\/api\/og/);
  });
});

describe('the story card with its way home', () => {
  it('keeps the card, the QR and the address inside the band a story leaves clear', () => {
    for (const aspect of [1.45, 1.25, 1.0]) {
      const g = P.storyQrGeometry(aspect);
      expect(g.W).toBe(1080);
      expect(g.H).toBe(1920);
      for (const box of [g.card, { x: g.qr.x, y: g.qr.y, w: g.qr.size, h: g.qr.size }]) {
        expect(box.y, `aspect ${aspect}`).toBeGreaterThanOrEqual(P.STORY_SAFE);
        expect(box.y + box.h, `aspect ${aspect}`).toBeLessThanOrEqual(1920 - P.STORY_SAFE);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(1080);
      }
      expect(g.address.y).toBeLessThanOrEqual(1920 - P.STORY_SAFE);
    }
  });
  it('is the download only: the stamped story keeps its geometry', () => {
    const src = readFileSync(join(ROOT, 'js/console/card-paint.js'), 'utf8');
    expect(src).toMatch(/const withQr = ratio === 'story' && opts\.qr;/);
    expect(P.shareGeometry('story').wordmark).toBeTruthy();
  });
  it('the Bridge sends from the ship station under its days-since instrument', () => {
    const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
    // The slot is the control and carries no words (the owner, K82 notes);
    // what it sends is its name, for a screen reader.
    expect(html).toMatch(/<button type="button" class="br-mailslot" id="br-mailslot" onclick="sendOutOpen\(\)" aria-label="Send the newest piece out">\s*<span class="br-mailslot-mouth"[^>]*>[\s\S]*?<\/span>\s*<\/button>/);
    expect(html).not.toMatch(/br-sendout|br-ship-subject|br-slit-sheet/);
  });
});

describe('the card that goes out is the homepage\'s', () => {
  it('a photograph and a frame are drawn as the engine\'s photo kind, a frame flagged raw with its number', () => {
    const src = readFileSync(join(ROOT, 'js/console/send-out.js'), 'utf8');
    expect(src).toMatch(/\{ kind: 'photo', data: \{ \.\.\.entry, num: piece\.num \}, raw: true \}/);
    expect(src).toMatch(/: \{ kind: 'photo', data: entry \};/);
  });
});

// ---- K81: the ship station ----
// The owner, 2026-10-07: "it's a ship station within the console … where you
// can stamp and prepare content to send out", a mail slot with "a slit of
// light radiating from the slot", and the media types under it (the tab
// bar's icons) going to one picker. Anything live can go out, a track too.

const HTML = () => readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const CSS = () => readFileSync(join(ROOT, 'css/field-console.css'), 'utf8');

const SHELF = {
  posts: [{ id: 'n1', fn_id: 'fn-001', title: 'A note', status: 'published', added_at: '2026-09-20T00:00:00Z', _imported: true }],
  archive: [{ id: 'a1', slug: 'say-yes', filename: 'say.jpg', title: 'Say Yes', added_at: '2026-10-02T00:00:00Z', _imported: true }],
  buffer: [],
  audio: [
    { id: 't1', slug: 'night-drive', title: 'Night Drive', duration: 185, added_at: '2026-10-05T00:00:00Z', _imported: true },
    { id: 't2', slug: 'gone', title: 'Retired', added_at: '2026-10-06T00:00:00Z', _imported: true, retired: true },
    { id: 't3', slug: 'staged', title: 'Not live', added_at: '2026-10-06T00:00:00Z' },
  ],
};

describe('anything live can go out', () => {
  it('every piece with an address, newest first, a live track among them', () => {
    const all = O.addressablePieces(SHELF);
    expect(all.map((p) => [p.kind, p.title])).toEqual([
      ['audio', 'Night Drive'], ['archive', 'Say Yes'], ['text', 'A note'],
    ]);
  });
  it('the slot still sends the newest, the same answer as before', () => {
    expect(O.latestAddressable(SHELF)).toEqual(O.addressablePieces(SHELF)[0]);
    expect(O.latestAddressable({})).toBeNull();
  });
  it('a track goes out as the Audio shelf shares it: its card, its stamp, its page on /listen', () => {
    globalThis.window.RecentIndex = {
      entryHref: (kind, e) => (kind === 'audio' ? '/listen/?a=' + encodeURIComponent(e.slug) : ''),
    };
    try {
      const t = O.sendOutTarget(O.addressablePieces(SHELF)[0]);
      expect(t.item).toEqual({ kind: 'audio', data: SHELF.audio[0] });
      expect(t.stem).toBe(P.shareStem({ kind: 'audio', id: 'night-drive' }));
      expect(t.url).toBe(location.origin + '/listen/?a=night-drive');
      expect(t.name).toBe('Night Drive');
    } finally { delete globalThis.window.RecentIndex; }
  });
});

describe('choose your media', () => {
  const pieces = [
    { kind: 'raw', num: 728, title: 'Frame f#728' },
    { kind: 'archive', title: 'Say Yes' },
    { kind: 'text', title: 'Money Talks' },
    { kind: 'audio', title: 'Night Drive' },
  ];
  it('three buckets, the tab bar\'s icons: pictures (photographs and frames), notes, audio', () => {
    expect(O.PICK_BUCKETS.map(([k]) => k)).toEqual(['all', 'pictures', 'notes', 'audio']);
    expect(O.pickPieces(pieces, 'pictures').map((p) => p.title)).toEqual(['Frame f#728', 'Say Yes']);
    expect(O.pickPieces(pieces, 'notes').map((p) => p.title)).toEqual(['Money Talks']);
    expect(O.pickPieces(pieces, 'audio').map((p) => p.title)).toEqual(['Night Drive']);
    expect(O.pickPieces(pieces, 'all')).toHaveLength(4);
  });
  it('a search finds a title, or a frame by its number, written with or without f#', () => {
    expect(O.pickPieces(pieces, 'all', 'money').map((p) => p.title)).toEqual(['Money Talks']);
    expect(O.pickPieces(pieces, 'all', 'f#72').map((p) => p.title)).toEqual(['Frame f#728']);
    expect(O.pickPieces(pieces, 'pictures', '728').map((p) => p.title)).toEqual(['Frame f#728']);
    expect(O.pickPieces(pieces, 'notes', 'night')).toEqual([]);
  });
  it('builds a page at a time, so a big archive opens without a long frame', () => {
    expect(O.PICK_PAGE).toBeLessThanOrEqual(60);
    const src = readFileSync(join(ROOT, 'js/console/send-out.js'), 'utf8');
    expect(src).toMatch(/const end = Math\.min\(_pickShown\.length, _pickBuilt \+ PICK_PAGE\);/);
    expect(src).toMatch(/grid\.insertAdjacentHTML\('beforeend'/);
  });
  it('a pick hands the drawer the piece chosen, not the newest', () => {
    const src = readFileSync(join(ROOT, 'js/console/send-out.js'), 'utf8');
    expect(src).toMatch(/export function sendOutOpen\(piece\) \{\n  const t = sendOutTarget\(piece && piece\.entry \? piece : latestAddressable\(\)\);/);
    expect(src).toMatch(/export function sendOutPickChoose\(i\) \{[\s\S]*?sendOutOpen\(piece\);/);
  });
  it('the picker is the asset library\'s modal, toolbar and grid, with its own ids', () => {
    const html = HTML();
    const modal = html.slice(html.indexOf('id="sendpick-modal"'), html.indexOf('id="pulse-log-sheet"'));
    expect(modal).toMatch(/class="modal sendpick-modal"/);
    expect(modal).toMatch(/CHOOSE YOUR MEDIA/);
    expect(modal).toMatch(/class="asset-lib-toolbar"/);
    expect(modal).toMatch(/class="asset-lib-grid sendpick-grid" id="sendpick-grid"/);
  });
});

describe('the station on the Bridge', () => {
  const station = () => { const h = HTML(); return h.slice(h.indexOf('<div class="br-station">'), h.indexOf('id="br-storage"')); };
  it('is static markup beside the painted readout, never inside it', () => {
    const s = station();
    expect(s).toMatch(/<div class="br-inst br-inst--since" id="br-since"><\/div>/);
    // Always in its slot (K84): never hidden while the data is on its way.
    expect(s).toMatch(/<div class="br-ship" id="br-ship" data-tier="panel" data-seam="box" data-backlit role="group" aria-label="Outgoing">/);
    expect(s).not.toMatch(/id="br-ship"[^>]*hidden/);
    const bridge = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    // The painter names the slot on the control, and only when it changes.
    expect(bridge).toMatch(/if \(slot && slot\.getAttribute\('aria-label'\) !== label\) slot\.setAttribute\('aria-label', label\);/);
    expect(bridge).not.toMatch(/paintHTML\(\$\('br-ship/);
  });
  it('the slot is a seam along its lower lip, so its light falls out of it and down', () => {
    expect(station()).toMatch(/class="br-mailslot-mouth" id="br-mailslot-mouth" data-seam="bottom"/);
    expect(CSS()).toMatch(/\.br-mailslot-mouth \{\n  --seam-level: var\(--emit-panel\);/);
  });
  it('a send heats one registered dial, not the generic hot filter over the key', () => {
    const css = CSS();
    expect(css).toMatch(/\.br-mailslot\.is-sent \.br-mailslot-mouth, \.br-mailslot:active \.br-mailslot-mouth \{ --seam-level: 1; \}/);
    // The journey only where motion is welcome; reduced motion keeps the states.
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\n  \.br-mailslot-mouth \{ transition: --seam-level var\(--arm-cool\); \}[\s\S]{0,200}\.br-mailslot\.is-sent \.br-mailslot-mouth \{ transition: --seam-level var\(--arm-heat\); \}/);
    const src = readFileSync(join(ROOT, 'js/console/send-out.js'), 'utf8');
    expect(src).toMatch(/slot\.classList\.add\('is-sent'\)/);
    expect(src).not.toMatch(/heat\(slot/);
  });
  it('three keys under the slot, the tab bar\'s icons, each opening its own bucket; every word lit as an act', () => {
    const s = station();
    const keys = [...s.matchAll(/<button type="button" class="br-ship-key" data-text="act" onclick="sendOutPick\('(\w+)'\)"><span class="br-ship-icon" aria-hidden="true">(.)<\/span>/g)].map((m) => [m[1], m[2]]);
    expect(keys).toEqual([['pictures', '▦'], ['notes', '✎'], ['audio', '♪']]);
    const tab = HTML().slice(HTML().indexOf('<nav class="tabbar"'));
    expect(tab).toMatch(/<span class="tab-icon">▦<\/span><span class="tab-label">Archive/);
    expect(tab).toMatch(/<span class="tab-icon">✎<\/span><span class="tab-label">FN\/\//);
  });
});

describe('the story card, with the QR or without', () => {
  it('the switch is remembered on this device and repaints the card', () => {
    const src = readFileSync(join(ROOT, 'js/console/send-out.js'), 'utf8');
    expect(src).toMatch(/paintCard\(t\.item, 'story', _qrOn\(\) \? \{ qr: t\.url \} : \{\}\)/);
    expect(src).toMatch(/try \{ return localStorage\.getItem\(QR_KEY\) !== '0'; \} catch \{ return true; \}/);
  });
  it('without the QR it is the plain story, which keeps the band a story leaves clear', () => {
    const g = P.shareGeometry('story', 1.25);
    expect(g.qr).toBeUndefined();
    expect(g.card.y).toBeGreaterThanOrEqual(0);
    expect(g.card.y + g.card.h).toBeLessThanOrEqual(1920);
  });
});

describe('saving the story: a download on a desktop, the sheet on a touch device', () => {
  const file = new File(['x'], 'f-story.webp', { type: 'image/webp' });
  const as = (fine, canShare) => {
    globalThis.matchMedia = (q) => ({ matches: q === '(pointer: fine)' && fine });
    Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true, writable: true });
  };
  afterEach(() => { delete globalThis.matchMedia; delete navigator.canShare; });

  it('a desktop downloads, even with a share sheet that takes files (the Mac\'s has no folder)', () => {
    as(true, () => true);
    expect(O.storySaveRoute(file)).toBe('download');
  });
  it('a touch device with a sheet for files gets the sheet: straight to Photos or a story', () => {
    as(false, () => true);
    expect(O.storySaveRoute(file)).toBe('share');
  });
  it('a touch device without one downloads', () => {
    as(false, () => false);
    expect(O.storySaveRoute(file)).toBe('download');
    as(false, undefined);
    expect(O.storySaveRoute(file)).toBe('download');
  });
  it('the save goes through the route, and a dismissed sheet saves nothing', () => {
    const src = readFileSync(join(ROOT, 'js/console/send-out.js'), 'utf8');
    expect(src).toMatch(/if \(storySaveRoute\(file\) === 'share'\)/);
    expect(src).toMatch(/if \(err && err\.name === 'AbortError'\) return;/);
  });
});

describe('a track carries the player\'s play mark', () => {
  it('the mark sits at the head of the waveform, on its middle, the player\'s glyph proportions', () => {
    const u = 600, waveH = u * 0.3;
    const b = P.playMarkBox(40, 100, waveH, u);
    expect(b.x).toBe(40);
    expect(b.y + b.h / 2).toBeCloseTo(100 + waveH / 2, 6);
    expect(b.w / b.h).toBeCloseTo(13 / 15, 6);
    expect(b.h).toBeLessThan(waveH);
  });
  it('the waveform starts after it', () => {
    const src = readFileSync(join(ROOT, 'js/console/card-paint.js'), 'utf8');
    expect(src).toMatch(/const wx = mark\.x \+ mark\.w \+ mark\.gap;/);
    expect(src).toMatch(/ctx\.fillRect\(wx \+ i \* bw,/);
  });
});

// ---- K82: the module seats with the room ----
// The owner, 2026-10-07: on every load the station "just 'pops' in after the
// ignition sequence, not unified"; "a physical module that was pushed into a
// spring loaded slot with contacts … now the physical module is in and lit";
// OUTGOING "in volumetric red emissive neon letters inset", the slit "much
// thinner and run hotter w/ sharper haze".

describe('the module seats with the room', () => {
  let B;
  beforeAll(async () => { B = await import('../js/console/bridge.js'); });
  it('is in its slot from the first frame, whatever the data: the painter never hides it', () => {
    // K84: on a device that keeps nothing, the station waited for the sync
    // and arrived mid-ignition already lit, the owner's "pop".
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    const ship = src.slice(src.indexOf('function _paintShip() {'), src.indexOf('function _lineHTML'));
    expect(ship).not.toMatch(/\.hidden/);
    expect(ship).toMatch(/slot\.setAttribute\('aria-label', label\)/);
  });
  it('its lamps are the room\'s level, never quite 1 while the clock holds them', () => {
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(src).toMatch(/const level = ignitionLevel\(\);\n      for \(const \[el, rest\] of lamps\) el\.style\.opacity = Math\.min\(SHIP_OPACITY_CAP, rest \* level\)\.toFixed\(3\);/);
    expect(B.SHIP_OPACITY_CAP).toBeLessThan(1);
  });
  it('dark until the clock takes them, on their own layers while it runs', () => {
    const css = CSS();
    expect(css).toMatch(/:root\[data-ignition\] \.br-ship:not\(\[data-seat\]\) \.br-ship-lamp \{ opacity: 0; \}/);
    expect(css).toMatch(/:root\[data-ignition\] \.br-ship-lamp \{ will-change: opacity; \}/);
  });
  it('the face: two contacts and the neon word, which is a lamp, not type', () => {
    const h = HTML();
    const face = h.slice(h.indexOf('<div class="br-ship-face"'), h.indexOf('<button type="button" class="br-mailslot"'));
    expect([...face.matchAll(/<span class="br-contact"><i class="br-ship-lamp" data-lamp="contact"><\/i><\/span>/g)]).toHaveLength(2);
    // A point of light, no ring round it (the owner, K82 notes).
    expect(CSS()).toMatch(/\.br-contact \{ position: relative; flex: none; width: 9px; height: 9px; border-radius: 50%; \}/);
    for (const layer of ['lip', 'cut', 'haze', 'glow', 'tube']) expect(face).toMatch(new RegExp(`class="br-neon-${layer}[ "]`));
    expect(face).not.toMatch(/data-text=/);
    expect(CSS()).not.toMatch(/\.br-neon[^{]*\{[^}]*text-shadow/);
  });
  it('the slit is a hairline', () => {
    expect(CSS()).toMatch(/\.br-slit \{\n  position: absolute; left: 4px; right: 4px; bottom: 1px; height: 1px;/);
  });
});

describe('the days-since stat is one line (K84)', () => {
  it('the label holds; when, then what went live, gives way to an ellipsis', () => {
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(src).toMatch(/say\.figure\(n\) \+ '<div class="br-since-row">' \+\n    say\.label\(/);
    expect(src).toMatch(/say\.meta\(`\$\{escapeHTML\(new Date\(last\.at\)/);
    const css = CSS();
    expect(css).toMatch(/\.br-since-row \{ display: flex; align-items: baseline; gap: 0\.7em; min-width: 0; white-space: nowrap; \}/);
    expect(css).toMatch(/\.br-since-row > \.br-meta \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
  });
});

describe('the module\'s glow stays on its glass (K84)', () => {
  it('a short backlight, centred, its haze short', () => {
    const css = CSS();
    const rule = css.slice(css.indexOf('.br-ship {\n  display: grid;'), css.indexOf('}', css.indexOf('.br-ship {\n  display: grid;')));
    expect(rule).toMatch(/--backlight-overhang: 3px;/);
    expect(rule).toMatch(/--backlight-haze: 0\.9;/);
    expect(rule).toMatch(/--backlight-y: 0;/);
  });
});

// ---- K85: the alignment pass ----
// The owner, 2026-10-07: "days since" and OUTGOING "independent within the
// layout"; the unit "closer to this boundary"; LIVE "neatly underneath the
// storage section … remove the smd chip"; "objects are spaced so they are
// independent … not giant dead areas of negative space, a visual rhythm";
// "check the alignment of the drop and the circle on the dropzone".

describe('the top row stands on one floor (K85)', () => {
  it('days since at the top of its column, the unit on the floor; storage at the top, LIVE on the floor', () => {
    const css = CSS();
    expect(css).toMatch(/\.br-station \{\n  display: flex; flex-direction: column; justify-content: space-between; align-self: stretch;/);
    expect(css).toMatch(/\.br-store \{\n  grid-area: store; display: flex; flex-direction: column; justify-content: space-between; align-self: stretch;/);
    expect(css).toMatch(/\.br-top > \.br-bay \{ grid-area: bay; align-self: end;/);
  });
  it('the ◎ and DROP on one centre line', () => {
    expect(CSS()).toMatch(/\.br-bay \.dz-prompt \{ font-size: var\(--t-micro\); margin: 0; line-height: 1; \}/);
  });
});

describe('the bottom row: the spark and the frames meet (K85)', () => {
  it('side by side, 04 and 05 share their rows', () => {
    expect(CSS()).toMatch(/@container \(min-width: 721px\) \{\n  \.br-foot \{ grid-template-rows: auto auto; \}\n  \.br-intake, \.br-recent \{ grid-row: span 2; grid-template-rows: subgrid; \}/);
  });
  it('five frames as large as the spark is tall, the spark two lines at that height', () => {
    const css = CSS();
    expect(css).toMatch(/\.br-cite \{ flex: 0 0 min\(51px, calc\(\(100% - 32px\) \/ 5\)\); min-width: 0; \}/);
    expect(css).toMatch(/min-height: calc\(2 \* 1\.4em \+ 6px\);/);
  });
  it('a frame with no picture is a picture\'s size: the key fills its slot', () => {
    // A button shrinks to its content, and the lit panel's content is one
    // letter: with the pictures not loading the frames were 37 px, on a
    // fork's frame without one 24 (found 2026-10-07, standby fork).
    expect(CSS()).toMatch(/\.br-cite-key \{\n  display: grid; justify-items: center; gap: 4px; padding: 0; margin: 0; width: 100%;/);
  });
});
