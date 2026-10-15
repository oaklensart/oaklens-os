// Owner-written text reaches the public pages' markup escaped
// (maintenance review 2026-10-15, D8).
//
// The archive, the wall and the Field Notes list built their cards from
// template literals with titles, places and captions dropped in raw: a quote
// cut a title's alt text short, and a `<` or `&` swallowed what followed. The
// strict CSP kept it from being a script hole on the live site, but a
// Site-in-a-ZIP export runs from file:// with no CSP behind it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// site-common.js is a classic script whose declarations are globals.
const escapeHtml = new Function(`${read('js/site-common.js').split('/* ---- CDN base resolution')[0]}; return escapeHtml;`)();

describe('escapeHtml (site-common.js)', () => {
  it('escapes the five characters, like the server\'s', () => {
    expect(escapeHtml(`Smith & Co "night" <3 'x'`))
      .toBe('Smith &amp; Co &quot;night&quot; &lt;3 &#39;x&#39;');
  });
  it('is empty for nothing, rather than the word "undefined"', () => {
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('no owner field goes into a card raw', () => {
  // Every `${x.field}` interpolation of a text field in these renderers is
  // wrapped. Filenames/focus go through URL helpers or are numbers and CSS.
  const cases = [
    ['js/page-archive.js', 'entry', ['title', 'sub', 'location', 'hash']],
    ['js/page-wall.js', 'w', ['title']],
    ['js/page-fn-list.js', 'post', ['title', 'location', 'fn_id']],
  ];
  it.each(cases)('%s', (file, obj, fields) => {
    const src = read(file);
    for (const f of fields) {
      // `${x.f}` or `${x.f || …}` is the value going in raw; `${x.f ? …` is a
      // condition, and its branches are checked by the same rule.
      const raw = new RegExp(`\\$\\{\\s*${obj}\\.${f}\\s*(\\}|\\|\\|)`);
      expect(raw.test(src), `${file} interpolates ${obj}.${f} unescaped`).toBe(false);
    }
  });
});
