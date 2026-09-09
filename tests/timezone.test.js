// The calendar an instance keeps.
//
// `localDay()` is the project's one server-side date formatter, and until
// 2026-09-08 it hardcoded a single instance's zone — so every fork rendered that
// city's dates, and grouped its frame days into that city's buckets. This file
// is the proof that the zone is configuration now: that a fork elsewhere gets
// its own answer, that omitting it degrades to UTC instead of to someone else's
// hometown, and that no call site quietly drops the argument.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { localDay } from '../src/shared/text.js';

// 22:12 on 2026-09-07 in Los Angeles is already 05:12Z on the 8th. That one
// timestamp separates every zone below, which is the whole point: an evening
// publish is the case a UTC-slicing formatter gets wrong.
const EVENING_PACIFIC = '2026-09-08T05:12:00.000Z';

describe('localDay is configured, not hardcoded', () => {
  it('renders the local calendar day for the zone it is given', () => {
    expect(localDay(EVENING_PACIFIC, 'America/Los_Angeles')).toBe('2026-09-07');
    expect(localDay(EVENING_PACIFIC, 'UTC')).toBe('2026-09-08');
  });

  it('gives a fork its own day, not the author instance one', () => {
    // The bug this file exists for: these three used to be identical, because
    // the zone was a constant in engine code.
    const berlin = localDay(EVENING_PACIFIC, 'Europe/Berlin');
    const tokyo = localDay(EVENING_PACIFIC, 'Asia/Tokyo');
    const pacific = localDay(EVENING_PACIFIC, 'America/Los_Angeles');

    expect(berlin).toBe('2026-09-08');
    expect(tokyo).toBe('2026-09-08');
    expect(pacific).toBe('2026-09-07');
    expect(new Set([berlin, pacific]).size).toBe(2);
  });

  it('degrades to the UTC slice rather than throwing on a bad zone', () => {
    // A fork typo ('Europe/Berlyn') must not 500 the archive manifest.
    expect(localDay(EVENING_PACIFIC, 'Not/AZone')).toBe('2026-09-08');
    expect(localDay(EVENING_PACIFIC, undefined)).toBe('2026-09-08');
    expect(localDay(EVENING_PACIFIC, '')).toBe('2026-09-08');
  });

  it('passes bare YYYY-MM-DD through untouched — no zone can shift it', () => {
    // A date with no time carries no instant to convert; converting one would
    // walk it backwards a day.
    expect(localDay('2026-09-07', 'Asia/Tokyo')).toBe('2026-09-07');
    expect(localDay('2026-09-07', 'America/Los_Angeles')).toBe('2026-09-07');
  });

  it('is empty for an empty input', () => {
    expect(localDay('', 'UTC')).toBe('');
    expect(localDay(null, 'UTC')).toBe('');
    expect(localDay(undefined, 'UTC')).toBe('');
  });
});

describe('the engine ships no instance zone', () => {
  const SRC = 'src';

  // Both checks below read CODE, not prose. Comments legitimately name zones —
  // the example typo in text.js, the ones listed for forks in the example config
  // — and a scanner that cannot tell the difference would push authors toward
  // vaguer comments to keep a test quiet, which is a bad trade.
  function codeOf(file) {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  }

  function jsFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return jsFiles(full);
      return e.isFile() && e.name.endsWith('.js') ? [full] : [];
    });
  }

  it('names no IANA zone anywhere in src/ — that is site.config.js’ job', () => {
    // Zone literals look like Region/City. The engine default is 'UTC', which
    // has no slash, so any hit here is instance identity in engine code.
    const ZONE_RE = /['"](Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+['"]/;
    const offenders = jsFiles(SRC).filter((f) => ZONE_RE.test(codeOf(f)));
    expect(offenders).toEqual([]);
  });

  it('has every localDay call site pass a zone', () => {
    // The argument is deliberately not defaulted (see src/shared/text.js), so a
    // dropped argument is a silent fall back to UTC rather than a crash. This
    // is the test that makes it loud.
    const bare = [];
    for (const f of jsFiles(SRC)) {
      for (const m of codeOf(f).matchAll(/\blocalDay\(([^;]*?)\)(?=[\s,;.)\]}])/g)) {
        if (m[1].includes('siteConfig.timezone')) continue;
        if (/^\s*iso\s*,\s*tz\s*$/.test(m[1])) continue;   // the definition itself
        bare.push(`${f}: localDay(${m[1]})`);
      }
    }
    expect(bare).toEqual([]);
  });
});

describe('config', () => {
  it('defaults to UTC in the engine, and this instance names its own', async () => {
    const { BACKFILL } = await import('../src/shared/config.js');
    expect(BACKFILL.timezone).toBe('UTC');

    const siteConfig = (await import('../site.config.js')).default;
    // Resolved config always has one — absence is a bug, per BACKFILL.
    const resolved = (await import('../src/shared/config.js')).default;
    expect(typeof resolved.timezone).toBe('string');
    expect(resolved.timezone.length).toBeGreaterThan(0);
    expect(resolved.timezone).toBe(siteConfig.timezone || 'UTC');
  });
});
