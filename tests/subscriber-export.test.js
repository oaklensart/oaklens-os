// GET /api/subscribers/export — the KV namespace holds more than subscribers:
// rate-limit counters, failed-auth counters, and (on a one-click install with
// no SESSION_SECRET set) the KV-generated token-signing secret under
// `__oaklens_session_secret`. The export must never read or ship any of them.
// The internal-key case is the one with teeth: before the `__` filter the
// export get()'d the signing secret's row and shipped its key name as a junk
// "email" — the value survived only because it happens to fail JSON.parse,
// which is one refactor away from not being true. ADMIN_KEY (which gates this
// endpoint) is a weaker credential than the signing secret it was reading.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleExport } from '../src/api/subscribers.js';

function listKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  const gets = [];
  return {
    store,
    gets,
    async get(k) { gets.push(k); return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async list() {
      return {
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}

const exportReq = (key = 'the-admin-key') => new Request('https://example.com/api/subscribers/export', {
  headers: { Authorization: `Bearer ${key}`, 'CF-Connecting-IP': '9.9.9.9' },
});
const exportUrl = new URL('https://example.com/api/subscribers/export');

describe('GET /api/subscribers/export — internal keys never travel', () => {
  it('exports subscriber rows only, skipping ratelimit/authfail/__ keys', async () => {
    const kv = listKV({
      'reader@example.com': JSON.stringify({ subscribed_at: '2026-08-01T00:00:00Z', source: 'wall' }),
      'second@example.com': JSON.stringify({ subscribed_at: '2026-08-02T00:00:00Z', source: 'about' }),
      'ratelimit:1.2.3.4': '2',
      'authfail:5.6.7.8': '1',
      '__oaklens_session_secret': 'deadbeef'.repeat(8),
      // The /dev feed's cached payload shares this namespace too (2026-09-20,
      // src/api/devfeed.js). Named here so the filter is pinned against the
      // keys that actually exist, not just the one it was written for.
      '__devfeed': JSON.stringify({ ok: true, grid: null, log: [] }),
    });
    const res = await handleExport(exportReq(), exportUrl, { ADMIN_KEY: 'the-admin-key', SUBSCRIBERS: kv });
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.map((r) => r.email).sort()).toEqual(['reader@example.com', 'second@example.com']);
    expect(rows.some((r) => r.email.startsWith('__'))).toBe(false);
  });

  it("never get()s the signing secret's row — the filter runs before the reads", async () => {
    const kv = listKV({
      'reader@example.com': JSON.stringify({ source: 'wall' }),
      '__oaklens_session_secret': 'deadbeef'.repeat(8),
    });
    await handleExport(exportReq(), exportUrl, { ADMIN_KEY: 'the-admin-key', SUBSCRIBERS: kv });
    expect(kv.gets).not.toContain('__oaklens_session_secret');
  });

  // The `__` rule used to be "starts with __", which quietly dropped a real
  // subscriber whose address starts with two underscores — a paying reader
  // silently missing from their own export. It is narrowed to "starts with __
  // AND has no @", which reads no internal key while losing no subscriber.
  it('still exports a subscriber whose address starts with __', async () => {
    const kv = listKV({
      '__hidden@example.com': JSON.stringify({ source: 'wall' }),
      '__oaklens_session_secret': 'deadbeef'.repeat(8),
    });
    const res = await handleExport(exportReq(), exportUrl, { ADMIN_KEY: 'the-admin-key', SUBSCRIBERS: kv });
    const rows = await res.json();
    expect(rows.map((r) => r.email)).toEqual(['__hidden@example.com']);
    expect(kv.gets).not.toContain('__oaklens_session_secret');
  });
});

// The narrowed filter rests on one property: no internal key contains an `@`.
// Checked against the real source rather than restated by hand — if someone
// adds `__cache@v2` later, this fails here instead of leaking it.
describe('internal KV key names stay free of @', () => {
  it('no `__`-prefixed key literal in src/ contains an @', () => {
    const files = ['shared/auth.js', 'api/subscribers.js', 'api/console-auth.js'];
    for (const rel of files) {
      const src = readFileSync(join(import.meta.dirname, '..', 'src', rel), 'utf8');
      for (const [, literal] of src.matchAll(/['"`](__[A-Za-z0-9_:.-]*)['"`]/g)) {
        expect(literal, `${rel}: internal key "${literal}" must not contain @`).not.toContain('@');
      }
      // Same for the two counter prefixes the export filters by name.
      for (const [, literal] of src.matchAll(/['"`]((?:ratelimit|authfail):)/g)) {
        expect(literal, `${rel}: counter prefix "${literal}" must not contain @`).not.toContain('@');
      }
    }
  });
});
