// PUT /api/drafts — the lost-update race (src/api/drafts.js).
//
// Cloud drafts exist for one advertised reason: keep writing on the iPad, pick
// it up on the laptop. That is exactly the two-writer race, and the handler was
// a blind upsert stamped with the CLIENT's clock — the last device to save won
// even if it had been asleep for an hour with a stale copy, and a wrong clock
// could stamp the survivor OLDER than the work it destroyed (which is the
// ordering login-sync then trusts to decide what to keep).
//
// The write is conditional now: the client sends the version it loaded and the
// UPDATE applies only while the row still matches it. These drive the real
// device sequence through worker.fetch against a D1 stub that enforces the
// guard the way SQLite does — an upsert whose DO UPDATE ... WHERE fails leaves
// the row alone and returns no rows, without raising.
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

const SESSION_SECRET = 'test-secret-please-ignore';

// D1 stub over one in-memory fn_drafts table, executing the SQL the way SQLite
// would — including the upsert guard, whose whole point is that a failed
// `DO UPDATE ... WHERE` leaves the row alone and returns nothing WITHOUT
// raising. `run()` and `first()` share one execution path, so the OLD blind
// upsert runs here too: against the old handler these tests fail by losing the
// update (200 where a 409 belongs, B's paragraphs gone from the table), not
// merely by issuing different SQL.
function makeDB(rows = {}) {
  const table = new Map(Object.entries(rows));
  const seen = [];

  function exec(sql, binds) {
    if (/^\s*SELECT/i.test(sql)) return table.get(String(binds[0])) || null;
    if (!/^\s*INSERT INTO fn_drafts/i.test(sql)) throw new Error(`unexpected SQL: ${sql}`);

    const [id, fn_id, title, location, date, body, hero_filename, buffer_dates, clockStamp] = binds;
    const key = String(id);
    const existing = table.get(key);

    if (existing && / WHERE fn_drafts\.updated_at <= \?/.test(sql)) {
      if (!(existing.updated_at <= binds[9])) return null;   // guard held: no-op
    }
    // `updated_at=MAX(excluded.updated_at, fn_drafts.updated_at + 1)` — the row's
    // stamp only ever moves forward, even when two writes read the same
    // millisecond off the clock. Without it a same-ms save left the row looking
    // untouched, and the next stale write sailed through the guard above.
    const updated_at = existing
      ? Math.max(clockStamp, existing.updated_at + 1)
      : clockStamp;
    table.set(key, {
      id: key, fn_id, title, location, date, body, hero_filename, buffer_dates, updated_at,
    });
    return { updated_at };
  }

  return {
    table,
    seen,
    prepare(sql) {
      const rec = { sql, binds: [] };
      seen.push(rec);
      const stmt = {
        bind(...binds) { rec.binds = binds; return stmt; },
        async first() { return exec(sql, rec.binds); },
        async run() { return { meta: { changes: exec(sql, rec.binds) ? 1 : 0 } }; },
      };
      return stmt;
    },
  };
}

const env = (db) => ({ SESSION_SECRET, DB: db });

async function put(db, body) {
  const e = env(db);
  const token = await createToken(e);
  return worker.fetch(new Request('https://example.com/api/drafts', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), e);
}

const draft = (over = {}) => ({
  id: 'd1', fn_id: '', title: 'Field note', location: 'CITY', date: '2026-08-06',
  body: 'first pass', hero_filename: null, buffer_dates: null, ...over,
});

describe('PUT /api/drafts — two devices, one draft', () => {
  // One test freezes Date.now to make the same-millisecond race deterministic;
  // every other test needs the real clock back.
  afterEach(() => vi.restoreAllMocks());

  it('the stale writer is refused and the newer work survives', async () => {
    const db = makeDB();

    // Device A creates the draft; both devices load it at that version.
    const created = await put(db, { ...draft(), base_updated_at: 0 });
    expect(created.status).toBe(200);
    const base = (await created.json()).updated_at;

    // Device B saves real work against that base — applies.
    const bWrote = await put(db, { ...draft({ body: 'B wrote two more paragraphs' }), base_updated_at: base });
    expect(bWrote.status).toBe(200);

    // Device A, still holding the old copy, saves. THIS is the lost update:
    // the old code took it, and B's paragraphs were gone.
    const aStale = await put(db, { ...draft({ body: 'first pass' }), base_updated_at: base });
    expect(aStale.status).toBe(409);
    const body = await aStale.json();
    expect(body.code).toBe('draft_conflict');
    expect(db.table.get('d1').body, "B's work must still be there").toBe('B wrote two more paragraphs');

    // And A is told what it would have destroyed, not just "no".
    expect(body.draft.body).toBe('B wrote two more paragraphs');
    expect(body.draft.updated_at).toBeGreaterThanOrEqual(base);
  });

  it("A's forced retry wins, but only because it was explicit", async () => {
    const db = makeDB();
    const base = (await (await put(db, { ...draft(), base_updated_at: 0 })).json()).updated_at;
    await put(db, { ...draft({ body: 'B version' }), base_updated_at: base });

    const refused = await put(db, { ...draft({ body: 'A version' }), base_updated_at: base });
    expect(refused.status).toBe(409);

    // The console asks the author first; `force` is what their answer sends.
    const forced = await put(db, { ...draft({ body: 'A version' }), base_updated_at: base, force: true });
    expect(forced.status).toBe(200);
    expect(db.table.get('d1').body).toBe('A version');
  });

  // The bug the MAX(...) stamp exists for, pinned so it cannot come back as a
  // coin flip. `updated_at` is epoch-MILLISECONDS and two saves can share one,
  // which used to leave the row looking untouched and let the next stale write
  // through the guard. Freezing the clock makes that certain instead of
  // occasional — this test failed roughly one run in three before the fix, as
  // an unexplained flake in the case below it.
  it('two saves inside one millisecond still order', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_754_700_000_000);

    const db = makeDB();
    const base = (await (await put(db, { ...draft(), base_updated_at: 0 })).json()).updated_at;

    // B saves against that base — applies, and must move the row forward even
    // though the clock has not.
    const bWrote = await put(db, { ...draft({ body: 'B version' }), base_updated_at: base });
    expect(bWrote.status).toBe(200);
    expect((await bWrote.json()).updated_at).toBeGreaterThan(base);

    // A, still holding the old copy, must now be refused.
    const aStale = await put(db, { ...draft({ body: 'A version' }), base_updated_at: base });
    expect(aStale.status).toBe(409);
    expect(db.table.get('d1').body, "B's work must survive").toBe('B version');
  });

  it('a fresh id still inserts (nothing to conflict with)', async () => {
    const db = makeDB();
    const res = await put(db, { ...draft({ id: 'brand-new' }), base_updated_at: 0 });
    expect(res.status).toBe(200);
    expect(db.table.has('brand-new')).toBe(true);
  });

  it('repeated saves from the SAME device keep applying', async () => {
    // The guard must not turn ordinary typing into a conflict: each save moves
    // the base forward, which is what the console stores from the response.
    const db = makeDB();
    let base = (await (await put(db, { ...draft(), base_updated_at: 0 })).json()).updated_at;
    for (const body of ['second', 'third', 'fourth']) {
      const res = await put(db, { ...draft({ body }), base_updated_at: base });
      expect(res.status, body).toBe(200);
      base = (await res.json()).updated_at;
    }
    expect(db.table.get('d1').body).toBe('fourth');
  });
});

describe('PUT /api/drafts — the timestamp is the server\'s', () => {
  it('ignores a client updated_at, however wrong', async () => {
    // A device with a clock a year ahead used to stamp the row from the future,
    // so every honest save after it looked older and lost the sync comparison.
    const db = makeDB();
    const future = Date.now() + 365 * 24 * 3600 * 1000;
    const res = await put(db, { ...draft(), updated_at: future, base_updated_at: 0 });
    const { updated_at } = await res.json();

    expect(updated_at).not.toBe(future);
    expect(updated_at).toBeLessThanOrEqual(Date.now());
    expect(db.table.get('d1').updated_at).toBe(updated_at);
  });

  it('the write is one statement — no read-then-write window', async () => {
    // A guard implemented as SELECT-then-UPDATE would race two devices landing
    // between the two statements. The applied path issues exactly one.
    const db = makeDB();
    await put(db, { ...draft(), base_updated_at: 0 });
    expect(db.seen).toHaveLength(1);
    expect(db.seen[0].sql).toMatch(/^\s*INSERT INTO fn_drafts/);
  });
});

describe('PUT /api/drafts — compatibility and edges', () => {
  it('a client that sends no base writes unconditionally (older cached console)', async () => {
    // Same allowance /api/publish makes for a client with no baseSha: a console
    // still serving from the service worker must not lose the ability to save.
    const db = makeDB();
    await put(db, { ...draft(), base_updated_at: 0 });
    const res = await put(db, draft({ body: 'legacy client save' }));
    expect(res.status).toBe(200);
    expect(db.table.get('d1').body).toBe('legacy client save');
  });

  it('still refuses a base64 hero', async () => {
    const db = makeDB();
    await put(db, { ...draft({ hero_filename: 'data:image/webp;base64,AAAA' }), base_updated_at: 0 });
    expect(db.table.get('d1').hero_filename).toBeNull();
  });

  it('401s without a token and 501s notConfigured without D1', async () => {
    const db = makeDB();
    const unauth = await worker.fetch(new Request('https://example.com/api/drafts', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft()),
    }), env(db));
    expect(unauth.status).toBe(401);

    const e = { SESSION_SECRET };
    const token = await createToken(e);
    const noDb = await worker.fetch(new Request('https://example.com/api/drafts', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(draft()),
    }), e);
    // 501, not 500 — see the note in tests/bench.test.js (v1 review Mo5).
    expect(noDb.status).toBe(501);
    expect((await noDb.json()).notConfigured).toBe(true);
  });
});
