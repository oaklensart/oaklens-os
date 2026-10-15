// @vitest-environment happy-dom
//
// The buffer page's month rail (archive/buffer/index.html + js/page-buffer.js).
//
// It was a column of rotated "MON YYYY" labels, 125px a month, centred on the
// whole viewport: at six months it stood 692px tall, so on an iPad in landscape
// the newest month slid under the nav and the oldest into the fixed footer
// (2026-10-15, the owner on the iPad; measured in Chromium at 1024×768: OCT at
// 38px under a 52px nav, MAY ending 7px above the footer, and every month adds
// 125px). It is now bounded between the nav and the footer with its months
// sharing the height, follows the scroll, and a tap jumps to the month.
//
// Layout is measured in a real browser (the maintenance log records it); this
// file pins the contract a browser-free suite can see: the bounds are in the
// CSS, the marks are real buttons, the current month and the jump work, and a
// one-month buffer shows no rail at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = read('archive/buffer/index.html');

// Midday UTC, so the day is the same in any site zone.
const frame = (id, day) => ({ id, filename: `${id}.jpg`, captured_at: `${day}T12:00:00.000Z` });

async function renderBuffer(entries) {
  const body = PAGE.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  globalThis.fetch = async () => new Response(JSON.stringify(entries), { status: 200 });
  // The real light table (classic script), run in global scope like a <script>.
  (0, eval)(read('js/lighttable.js'));
  globalThis.LightTable.runIgnitionSequence = () => {};
  (0, eval)(read('js/page-buffer.js'));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
}

describe('the month rail', () => {
  let scrolled;
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function () { scrolled.push(this.dataset.date); };
  });
  afterEach(() => { delete globalThis.fetch; document.body.innerHTML = ''; });

  it('is bounded by the nav and the footer in the CSS, and its months share the height', () => {
    const css = PAGE.slice(PAGE.indexOf('/* ---- MONTH RAIL ---- */'), PAGE.indexOf('/* ---- BUFFER FOOTER ---- */'));
    expect(css).toMatch(/\.month-rail\s*\{[^}]*top:\s*calc\(var\(--nav-h\)/);
    expect(css).toMatch(/\.month-rail\s*\{[^}]*bottom:\s*calc\(/);
    expect(css).toMatch(/\.rail-marks\s*\{[^}]*justify-content:\s*space-between/);
    // The old shape: full-height, centred, a fixed gap per month.
    expect(css).not.toMatch(/height:\s*100vh/);
    expect(css).not.toMatch(/gap:\s*56px/);
  });

  it('marks each month, newest first, as a button that names it in full', async () => {
    await renderBuffer([frame('a', '2026-10-14'), frame('b', '2026-09-30'), frame('c', '2026-08-02'), frame('d', '2026-08-01')]);
    const rail = document.getElementById('month-rail');
    expect(rail.hidden).toBe(false);
    const marks = [...rail.querySelectorAll('button.rail-month')];
    expect(marks.map((b) => b.dataset.month)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(marks.map((b) => b.getAttribute('aria-label'))).toEqual(['October 2026', 'September 2026', 'August 2026']);
    expect(marks.map((b) => b.textContent)).toEqual(['OCT', 'SEP', 'AUG']);
  });

  it('starts on the newest month, with its year above the rail', async () => {
    await renderBuffer([frame('a', '2026-10-14'), frame('b', '2025-12-30')]);
    const cur = document.querySelector('.rail-month.current');
    expect(cur.dataset.month).toBe('2026-10');
    expect(cur.getAttribute('aria-current')).toBe('true');
    expect(document.getElementById('rail-year').textContent).toBe('2026');
  });

  it('a tap goes to that month\'s newest day', async () => {
    await renderBuffer([frame('a', '2026-10-14'), frame('b', '2026-09-30'), frame('c', '2026-09-02')]);
    document.querySelector('.rail-month[data-month="2026-09"]').click();
    expect(scrolled).toEqual(['2026-09-30']);
  });

  it('a January says its year, since the rail can hold several', async () => {
    await renderBuffer([frame('a', '2026-02-01'), frame('b', '2026-01-10'), frame('c', '2025-12-30')]);
    const jan = document.querySelector('.rail-month[data-month="2026-01"]');
    expect(jan.textContent).toBe('JAN’26');
    expect(jan.classList.contains('is-anchor')).toBe(true);
  });

  it('a buffer with one month shows no rail: there is nothing to index', async () => {
    await renderBuffer([frame('a', '2026-10-14'), frame('b', '2026-10-02')]);
    expect(document.getElementById('month-rail').hidden).toBe(true);
  });
});
