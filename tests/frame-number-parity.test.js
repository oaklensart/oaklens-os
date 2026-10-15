// @vitest-environment happy-dom
//
// Frame numbers (f#N) are positional and permanent: a citation in a field
// note must point at the same frame in the console, on the live light table,
// and in the homepage's featured RAW card. Three implementations number the
// Buffer: the console's getBufferFrameNumbers (js/console/fn-editor.js), the
// public LightTable.assignFrameNumbers (js/lighttable.js, a classic script)
// and the server's _featuredRawFrames (src/api/site-meta.js).
//
// ALL THREE BUCKET DAYS IN THE SITE'S ZONE since 2026-10-15 (maintenance
// review, D1). Before, the clients read the device's own day, and this file ran
// them in the site's zone to stay green, noting the gap. Measured on the live
// buffer, a reader in London saw 93 of 731 frames under different numbers. The
// zone now reaches the clients as <meta name="site-timezone">, and the last
// block below runs them on a device in other zones and asks for one answer.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import siteConfig from '../src/shared/config.js';

process.env.TZ = siteConfig.timezone || 'UTC';
const ROOT = join(import.meta.dirname, '..');
globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const lightTable = () => {
  const src = readFileSync(join(ROOT, 'js', 'lighttable.js'), 'utf8');
  const win = { location: { origin: 'https://example.com' }, matchMedia: () => ({ matches: false }) };
  new Function('window', 'document', src)(win, globalThis.document);
  return win.LightTable;
};

// The data the site publishes, when the checkout has it, plus the cases a
// real buffer does not happen to contain: the same day across midnight UTC,
// a dark tombstone, filename order within a day, an undated entry.
const sample = () => {
  const f = join(ROOT, 'data', 'buffer.json');
  const real = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  return [...(Array.isArray(real) ? real : []),
    { id: 'p1', filename: 'b.jpg', captured_at: '2026-03-02T07:30:00.000Z', featured: true },
    { id: 'p2', filename: 'a.jpg', captured_at: '2026-03-02T09:00:00.000Z', featured: true },
    { id: 'p3', filename: 'c.jpg', captured_at: '2026-03-01T23:59:00.000Z', featured: true, dark: true },
    { id: 'p4', filename: 'd.jpg', published_at: '2026-03-03T12:00:00.000Z', featured: true },
  ];
};

let F, S, M;
beforeAll(async () => {
  F = await import('../js/console/fn-editor.js');
  S = await import('../js/console-state.js');
  M = await import('../src/api/site-meta.js');
});

describe('one f# for every frame, wherever it is read', () => {
  it('the console and the live light table agree on every frame', () => {
    const frames = sample();
    S.STATE.buffer = frames;
    const con = F.getBufferFrameNumbers();
    const lt = lightTable().assignFrameNumbers(frames);
    const differ = frames.filter((e) => con.get(e.id) !== lt.get(e.id)).map((e) => e.id);
    expect(differ).toEqual([]);
    expect(con.size).toBe(frames.length);
  });

  it('…and the server\'s featured frames carry the same numbers', () => {
    const frames = sample().map((e) => ({ ...e, featured: true, dark: false, filename: e.filename || `${e.id}.jpg` }));
    S.STATE.buffer = frames;
    const con = F.getBufferFrameNumbers();
    const served = M._featuredRawFrames(frames, frames.length);
    expect(served.length).toBeGreaterThan(0);
    for (const f of served) expect(f.num, f.id).toBe(con.get(f.id));
  });

  it('an undated entry is day \'\' in the console as on the site (it sorted last as NaN)', () => {
    S.STATE.buffer = [
      { id: 'u', filename: 'z.jpg' },
      { id: 'd', filename: 'a.jpg', captured_at: '2026-01-01T12:00:00.000Z' },
    ];
    const con = F.getBufferFrameNumbers();
    const lt = lightTable().assignFrameNumbers(S.STATE.buffer);
    expect(con.get('u')).toBe(lt.get('u'));
    expect(con.get('u')).toBe(1);
  });

  it('the editor\'s preview resolves f# through the same numbering, not a copy of it', () => {
    const src = readFileSync(join(ROOT, 'js', 'console', 'fn-editor.js'), 'utf8');
    expect(src).toMatch(/const numToEntry = new Map\(\[\.\.\.getBufferFrameNumbers\(\)\]/);
  });
});

// The same numbering read from a device in another zone. The page carries
// the site's zone in a meta (as the edge injects it), the process runs in a
// different one, and every implementation must still agree with the server.
describe('one f# for every reader, whatever their zone (D1)', () => {
  const SITE_TZ = 'America/Los_Angeles';
  const withMeta = () => {
    let m = document.querySelector('meta[name="site-timezone"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'site-timezone'); document.head.appendChild(m); }
    m.setAttribute('content', SITE_TZ);
  };
  // Frames shot around a Pacific evening, filenames from two cameras so the
  // within-day order is NOT time order: the case where zones disagreed.
  const evening = [
    { id: 'e1', filename: 'IMG_9000.jpg', captured_at: '2026-05-25T18:00:00.000Z' },
    { id: 'e2', filename: 'DSC_0001.jpg', captured_at: '2026-05-26T05:30:00.000Z' },  // 22:30 PDT on the 25th
    { id: 'e3', filename: 'AAA_0001.jpg', captured_at: '2026-05-26T16:00:00.000Z' },
    { id: 'e4', filename: 'IMG_0002.jpg', captured_at: '2026-05-26T06:59:00.000Z' },  // 23:59 PDT on the 25th
  ];
  const serverNums = (frames) => {
    // The server numbers by the configured zone; compute the reference with
    // the same rule directly so this file does not depend on the instance's.
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: SITE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const rows = frames.map((e) => ({ e, d: fmt.format(new Date(e.captured_at)) }));
    rows.sort((a, b) => a.d.localeCompare(b.d) || a.e.filename.localeCompare(b.e.filename));
    return new Map(rows.map((r, i) => [r.e.id, i + 1]));
  };

  for (const deviceTz of ['Europe/London', 'Asia/Tokyo', 'UTC']) {
    it(`a device in ${deviceTz} numbers like the site`, async () => {
      const saved = process.env.TZ;
      process.env.TZ = deviceTz;
      try {
        withMeta();
        const U = await import('../js/console/utils.js');
        U._resetSiteDay();
        const want = serverNums(evening);
        const lt = lightTable().assignFrameNumbers(evening);
        S.STATE.buffer = evening.map((e) => ({ ...e }));
        const con = F.getBufferFrameNumbers();
        for (const e of evening) {
          expect(lt.get(e.id), `light table ${e.id}`).toBe(want.get(e.id));
          expect(con.get(e.id), `console ${e.id}`).toBe(want.get(e.id));
        }
        // …and the day a note embeds is the site's day (D2).
        expect(lightTable().siteDay('2026-05-26T05:30:00.000Z')).toBe('2026-05-25');
      } finally {
        process.env.TZ = saved;
      }
    });
  }
});
