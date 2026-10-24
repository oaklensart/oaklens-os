// @vitest-environment happy-dom
//
// The Bridge on a bad network (K68). Measured 2026-10-06 under the capture
// rig (docs/maintenance/2026-10-06-bridge-field-probe.md): offline, it listed
// the engine's sample frames as the front page and "Nothing live" over a
// live pulse; a web page answering for the API failed as "Cannot read
// properties of undefined"; one malformed remembered value stopped the paint
// halfway; and an unreadable saved state was written over within seconds of
// boot. Held here: each fact that cannot be read says so, and keeps its age;
// nothing is invented; nothing saved is lost without a copy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'dev/field-console.html'), 'utf8');
const BODY = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
const LIVE_KEY = 'oaklens_bridge_live';
const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
// Two days, not an hour: the tests below run on a clock pinned to midday, which
// can be later than the real time plus an hour.
const TOKEN = `${b64({ alg: 'none' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 2 * 86400 })}.x`;
const SAMPLE_TITLES = ['First Shadow', 'In Flight', 'Golden Ray', 'Learning to See Again'];

const text = (id) => (document.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();
const settle = () => new Promise((r) => setTimeout(r, 30));

// fetch, answered by path: a function (url) → Response, or a status number.
function answer(table) {
  vi.stubGlobal('fetch', async (u) => {
    const url = String(u?.url || u);
    for (const [pat, a] of table) {
      if (pat.test(url)) {
        if (typeof a === 'function') return a(url);
        return new Response('{"error":"boom"}', { status: a, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
const json = (body) => () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function bridge({ remembered = null } = {}) {
  vi.resetModules();
  document.body.innerHTML = BODY;
  localStorage.clear();
  sessionStorage.setItem('oaklens_session', TOKEN);
  if (remembered) localStorage.setItem(LIVE_KEY, typeof remembered === 'string' ? remembered : JSON.stringify(remembered));
  document.getElementById('view-bridge').classList.add('active');
  const B = await import('../js/console/bridge.js');
  return B;
}

// Midday, and the clock is pinned to it (pinClock). A fact seen today reads as
// a time ("as of 23:59"); one seen yesterday reads "just now" or "yesterday".
// WARM's facts are a minute old, so on the real clock a run in the first minute
// after midnight saw them as yesterday's and failed (CI, 2026-10-24 00:00 UTC).
const NOW = new Date().setHours(12, 0, 0, 0);
const pinClock = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); };
const WARM = {
  slots: [{ key: 'a', kind: 'archive', kicker: 'archive', title: 'Say Yes', thumb: '' }],
  frontPulse: null,
  pulse: { id: 'p', text: 'Building Logic', live: true, postedAt: NOW - 36e5, expiresAt: NOW + 5 * 36e5 },
  lastPulseAt: NOW - 36e5,
  version: { ok: true, version: 'x', deployed: new Date(NOW - 30 * 6e4).toISOString() },
  benchQueued: 3,
  storage: { ok: true, measuredAt: NOW - 36e5, r2: { bytes: 1.2e9, folders: {} }, r2FreeBytes: 10e9 },
  seen: { front: NOW - 6e4, pulse: NOW - 6e4, version: NOW - 6e4, bench: NOW - 6e4, storage: NOW - 6e4 },
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('nothing answers: each fact says so, none is invented', () => {
  beforeEach(pinClock);

  it('cold (nothing remembered): no LIVE claim, no front page, no "Nothing live"', async () => {
    answer([[/./, 500]]);
    const B = await bridge();
    B.renderBridge();
    await settle();
    B.renderBridge();
    expect(text('br-status')).toContain('NO ANSWER FROM THE SITE');
    expect(text('br-status')).not.toMatch(/LIVE · DEPLOYED/);
    expect(text('br-front')).toBe('The live site did not answer.');
    expect(text('br-pulse')).toContain("Can't see the pulse");
    expect(text('br-pulse')).not.toContain('Nothing live');
    // No composer while the pulse can't be read: a second one sent blind is not what anyone meant.
    expect(document.getElementById('br-say').hidden).toBe(true);
    expect(text('br-storage')).toContain('no answer from the site');
  });

  it('warm: the last facts stay, each with its age, and the pulse is "unconfirmed"', async () => {
    answer([[/./, 500]]);
    const B = await bridge({ remembered: WARM });
    B.renderBridge();
    await settle();
    B.renderBridge();
    expect(text('br-status')).toMatch(/NO ANSWER · SEEN LIVE \d\d:\d\d/);
    expect(text('br-status')).not.toMatch(/LIVE · DEPLOYED/);
    expect(document.querySelector('#br-status .lm-smd')).toBeNull();   // no green
    expect(text('br-pulse')).toContain('Building Logic');
    expect(text('br-pulse')).toMatch(/unconfirmed: no answer from the site · last seen \d\d:\d\d/);
    expect(text('br-waiting')).toMatch(/3 RAWs queued · as of \d\d:\d\d/);
  });

  it('a pulse the site really says is gone reads "Nothing live"; one it could not be asked about never does', async () => {
    answer([[/\/api\/pulse\/log/, json({ pulses: [] })], [/\/api\/version/, json({ ok: true, version: 'x', deployed: new Date().toISOString() })]]);
    const B = await bridge({ remembered: WARM });
    B.renderBridge();
    await settle();
    B.renderBridge();
    expect(text('br-pulse')).toContain('Nothing live');
    expect(document.getElementById('br-say').hidden).toBe(false);
  });

  it('the source: a failed source keeps the last good slots, never the samples', () => {
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(src).toMatch(/if \(!front \|\| failed\.length\) \{ _live\.frontRead = 'failed'; return; \}/);
    expect(src).toMatch(/if \(front && !failed\.includes\('\/api\/pulse'\)\)/);
  });
});

describe('the front page, when the live site will not answer', () => {
  beforeEach(pinClock);

  it('says how old what it shows is, and shows no sample frame', async () => {
    await import('../js/recent-index.js');
    answer([[/\/data\//, 503], [/\/api\/buffer-summary/, 503]]);
    const B = await bridge({ remembered: WARM });
    B.renderBridge();
    await settle();
    B.renderBridge();
    const front = text('br-front');
    expect(front).toMatch(/^as of \d\d:\d\d · no answer/);
    expect(front).toContain('Say Yes');
    for (const t of SAMPLE_TITLES) expect(front).not.toContain(t);
  });
});

describe('one bad remembered value does not blank the page', () => {
  it('malformed slots, pulse and storage are dropped or coerced, and every painter still runs', async () => {
    answer([[/./, 500]]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const B = await bridge({ remembered: { slots: [null, { title: 5, kind: {} }], pulse: { text: 3 }, version: 'x', storage: { ok: true }, seen: { front: 'yesterday' } } });
    B.renderBridge();
    expect(errors.mock.calls.filter((c) => String(c[0]).startsWith('bridge '))).toEqual([]);
    expect(text('br-storage')).not.toBe('');
    errors.mockRestore();
  });

  it('_recallSlot keeps only the drawn fields, as strings', async () => {
    const B = await bridge();
    expect(B._recallSlot(null)).toBe(null);
    expect(B._recallSlot('x')).toBe(null);
    expect(B._recallSlot({ title: 5, kind: {}, key: 'k', extra: 'no' })).toEqual({ key: 'k', kind: '', kicker: '', title: '5', thumb: '' });
  });

  it('a painter that throws says so in its own place and once in the ledger, and the rest paint', () => {
    const src = readFileSync(join(ROOT, 'js/console/bridge.js'), 'utf8');
    expect(src).toMatch(/for \(const \[id, el, paint\] of PAINTERS\) _paintSafe\(id, el, paint, now\);/);
    expect(src).toMatch(/for \(const r of _regions\) _paintSafe\(r\.id, r\.fit, r\.paint, now\);/);
    expect(src).toMatch(/if \(_broken\.get\(id\) !== err\.message\)/);
  });

  it('a picture that will not load becomes the lit panel', async () => {
    const B = await bridge();
    const li = document.createElement('li');
    li.innerHTML = '<img class="br-thumb" data-kind="A">';
    document.body.append(li);
    B.bridgeThumbFailed(li.firstChild);
    const panel = li.firstChild;
    expect(panel.tagName).toBe('SPAN');
    expect(panel.className).toBe('br-thumb br-thumb--type');
    expect(panel.hasAttribute('data-backlit')).toBe(true);
    expect(panel.textContent).toBe('A');
  });
});

describe('a web page where the data should be (captive Wi-Fi, an Access sign-in)', () => {
  it('is named once, latches the lamp, and is not retried', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return new Response('<!doctype html><title>Sign in</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }); });
    const api = await import('../js/console-api.js');
    await expect(api.fetchVersion()).rejects.toMatchObject({ portal: true, status: 0 });
    expect(calls).toBe(1);
    expect(document.getElementById('sys-lamp').dataset.state).toBe('error');
    expect(text('toast-zone')).toContain('sign-in page');
  });

  it('a 200 that is not JSON is an error, not an empty answer', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', async () => new Response('garbled{', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const api = await import('../js/console-api.js');
    await expect(api.fetchStorage({ retries: 0 })).rejects.toMatchObject({ status: 0 });
  });

  it('the sync does not repeat it in worse words, and never reads files off nothing', () => {
    const pub = readFileSync(join(ROOT, 'js/console/publish.js'), 'utf8');
    expect(pub).toMatch(/if \(err\.portal\) \{/);
    expect(pub).not.toMatch(/data\.files\[file\]/);
  });
});

describe('unreadable saved work is kept, never written over', () => {
  const KEY = 'oaklens_console_v01';
  async function boot(raw, { noRoom = false } = {}) {
    vi.resetModules();
    document.body.innerHTML = BODY;
    localStorage.clear();
    localStorage.setItem(KEY, raw);
    if (noRoom) {
      const real = localStorage.setItem.bind(localStorage);
      vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
        if (String(k).includes('.unreadable-')) throw new Error('QuotaExceededError');
        return real(k, v);
      });
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const S = await import('../js/console-state.js');
    S.load();
    return S;
  }
  afterEach(() => vi.restoreAllMocks());

  it('a copy, byte for byte, before any save; the lamp and a sticky toast say so', async () => {
    const raw = '{"posts":[{"id":"a","body":"mine"}],"buffer":';
    const S = await boot(raw);
    const copies = S.unreadableCopies();
    expect(copies).toHaveLength(1);
    expect(localStorage.getItem(copies[0].key)).toBe(raw);
    S.save();
    expect(localStorage.getItem(copies[0].key)).toBe(raw);
    expect(document.getElementById('sys-lamp').dataset.state).toBe('error');
    expect(text('toast-zone')).toContain("couldn't be read");
  });

  it('a second boot that finds the same blob does not stack another copy', async () => {
    const raw = 'not json';
    await boot(raw);
    vi.resetModules();
    const S = await import('../js/console-state.js');
    localStorage.setItem(KEY, raw);
    S.load();
    expect(S.unreadableCopies()).toHaveLength(1);
  });

  it('what can be read is kept: one bad surface is set aside, the rest loads', async () => {
    const S = await boot(JSON.stringify({ posts: 'oops', buffer: [{ id: 'f1' }], staged: { buffer: 1 } }));
    expect(S.STATE.buffer.map((f) => f.id)).toEqual(['f1']);
    expect(Array.isArray(S.STATE.posts)).toBe(true);
    expect(S.unreadableCopies()).toHaveLength(1);
  });

  it('with no room for a copy, nothing saves over it until it is downloaded', async () => {
    const raw = '{"posts":[{"id":"only-copy"}]';
    const S = await boot(raw, { noRoom: true });
    S.save();
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(S.unreadableCopies()[0].key).toBe('');
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => {};
    expect(S.downloadUnreadable('')).toBe(true);
    expect(localStorage.getItem(KEY)).not.toBe(raw);   // saving resumed
  });

  it('a readable state makes no copy', async () => {
    const S = await boot(JSON.stringify({ posts: [], buffer: [] }));
    expect(S.unreadableCopies()).toEqual([]);
  });
});

describe('the lamp says what it is waiting on', () => {
  it('after 10 s in flight the label names it and counts', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = BODY;
    const T = await import('../js/console-telemetry.js');
    const end = T.beginActivity('site', 'VER ▼');
    expect(text('sys-lamp-label')).toBe('VER ▼');
    vi.advanceTimersByTime(12_000);
    expect(text('sys-lamp-label')).toMatch(/^WAITING · VER 1[12]s$/);
    end(true);
    expect(text('sys-lamp-label')).not.toMatch(/WAITING/);
  });
});
