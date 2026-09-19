// Bench worklist handlers (worker.js): GET /api/bench and POST/PATCH/DELETE
// /api/bench/entries, backed by the bench_entries D1 table. These were
// Miniflare-only; here a recording D1 stub drives the handlers through
// worker.fetch so the SQL shape, bind ordering (the json_set update path is
// order-sensitive), auth/validation gates, and error mapping are pinned.
import { describe, it, expect } from 'vitest';
import worker from '../worker.js';
import { createToken } from '../src/shared/auth.js';

const SESSION_SECRET = 'test-secret-please-ignore';

// Records every prepare(sql).bind(...) so a test can assert the statement the
// handler built, and returns canned all()/first()/batch() results.
function makeDB(resp = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const rec = { sql, binds: [] };
      calls.push(rec);
      const stmt = {
        bind(...a) { rec.binds = a; return stmt; },
        async all() { if (resp.allThrows) throw new Error('boom'); return resp.all ?? { results: [] }; },
        async first() { return typeof resp.first === 'function' ? resp.first(rec) : (resp.first ?? null); },
      };
      return stmt;
    },
    async batch(stmts) { if (resp.batchThrows) throw new Error('boom'); return resp.batch ?? stmts.map(() => ({ meta: { changes: 1 } })); },
  };
  return db;
}

function makeCdn() {
  const deleted = [];
  return { deleted, async delete(k) { deleted.push(k); } };
}

async function call(method, path, { db, cdn, body, auth = true } = {}) {
  const env = { SESSION_SECRET, DB: db, CDN: cdn };
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${await createToken(env)}`;
  const init = { method, headers };
  if (body !== undefined) { init.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  return worker.fetch(new Request('https://example.com' + path, init), env);
}

describe('bench auth + config gates', () => {
  it('401s without a token', async () => {
    const res = await call('GET', '/api/bench', { db: makeDB(), auth: false });
    expect(res.status).toBe(401);
  });

  // 501 notConfigured, not 500. Changed 2026-09-16 (v1 review Mo5): an unbound
  // D1 is a config gap, not a fault — and the console must not red-latch on it.
  // The bound-but-unmigrated case next door already answered 501; answering 500
  // one step earlier made "no database yet" look worse than "database with no
  // tables", which is backwards.
  it('501s notConfigured when D1 is not bound at all', async () => {
    const res = await call('GET', '/api/bench', { db: undefined });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.notConfigured, 'the console keys its "feature off" copy off this').toBe(true);
    // The message names the action, and it is a DIFFERENT action from the
    // unmigrated case's "run the migrations".
    expect(body.error).toMatch(/D1/);
    expect(body.error).toMatch(/binding|bound/i);
  });

  it('is not in the client retry set (0/502/503/504) — a config gap must not be retried', () => {
    // Pinned as a number rather than prose because this is the whole reason the
    // status changed: 501 is deliberate and terminal, 503 would spin.
    expect([0, 502, 503, 504]).not.toContain(501);
  });
});

describe('GET /api/bench', () => {
  it('returns the parsed entries', async () => {
    const rows = [{ data: JSON.stringify({ id: 'a', status: 'queued' }) },
                  { data: JSON.stringify({ id: 'b', status: 'done' }) }];
    const res = await call('GET', '/api/bench', { db: makeDB({ all: { results: rows } }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'a', status: 'queued' }, { id: 'b', status: 'done' }]);
  });

  it('passes ?status= through as a bound filter', async () => {
    const db = makeDB({ all: { results: [] } });
    await call('GET', '/api/bench?status=queued', { db });
    const stmt = db.calls.at(-1);
    expect(stmt.sql).toMatch(/WHERE status = \?/);
    expect(stmt.binds).toEqual(['queued']);
  });

  it('unfiltered list carries no bind', async () => {
    const db = makeDB({ all: { results: [] } });
    await call('GET', '/api/bench', { db });
    const stmt = db.calls.at(-1);
    expect(stmt.sql).not.toMatch(/WHERE/);
    expect(stmt.binds).toEqual([]);
  });

  it('503s when the query throws', async () => {
    const res = await call('GET', '/api/bench', { db: makeDB({ allThrows: true }) });
    expect(res.status).toBe(503);
  });
});

describe('POST /api/bench/entries (add)', () => {
  it('400s a non-array body', async () => {
    const res = await call('POST', '/api/bench/entries', { db: makeDB(), body: { id: 'a' } });
    expect(res.status).toBe(400);
  });

  it('skips entries with no id and reports added/skipped from batch changes', async () => {
    const db = makeDB({ batch: [{ meta: { changes: 1 } }, { meta: { changes: 0 } }] });
    const res = await call('POST', '/api/bench/entries', {
      db, body: [{ id: 'a' }, { nope: true }, { id: 'b' }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1, skipped: 1 });
    // two INSERTs prepared (the id-less entry was skipped before prepare)
    const inserts = db.calls.filter((c) => /INSERT INTO bench_entries/.test(c.sql));
    expect(inserts).toHaveLength(2);
    // first insert binds: id, status (default 'queued'), data JSON, created_at, updated_at
    expect(inserts[0].binds[0]).toBe('a');
    expect(inserts[0].binds[1]).toBe('queued');
    expect(JSON.parse(inserts[0].binds[2])).toEqual({ id: 'a' });
  });

  it('honors an explicit status and does nothing for an all-empty batch', async () => {
    const db = makeDB();
    const res = await call('POST', '/api/bench/entries', { db, body: [{ noid: 1 }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 0, skipped: 0 });
    // no statements prepared, batch never runs
    expect(db.calls.filter((c) => /INSERT/.test(c.sql))).toHaveLength(0);
  });
});

describe('PATCH /api/bench/entries (update)', () => {
  it('400s a missing id', async () => {
    const res = await call('PATCH', '/api/bench/entries', { db: makeDB(), body: { status: 'done' } });
    expect(res.status).toBe(400);
  });

  it('400s when there is nothing to update', async () => {
    const res = await call('PATCH', '/api/bench/entries', { db: makeDB(), body: { id: 'a' } });
    expect(res.status).toBe(400);
  });

  it('status-only: binds [status, json status, updated_at, id] in order', async () => {
    const db = makeDB({ first: { data: JSON.stringify({ id: 'a', status: 'done' }) } });
    const res = await call('PATCH', '/api/bench/entries', { db, body: { id: 'a', status: 'done' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'a', status: 'done' });
    const stmt = db.calls.at(-1);
    expect(stmt.sql).toMatch(/UPDATE bench_entries SET/);
    expect(stmt.sql).toMatch(/RETURNING data/);
    expect(stmt.binds).toEqual(['done', 'done', expect.any(Number), 'a']);
  });

  it('status+notes: json_set binds stay in pair order [status,status,notes,updated_at,id]', async () => {
    const db = makeDB({ first: { data: JSON.stringify({ id: 'a', status: 'done', notes: 'hi' }) } });
    await call('PATCH', '/api/bench/entries', { db, body: { id: 'a', status: 'done', notes: 'hi' } });
    const stmt = db.calls.at(-1);
    expect(stmt.binds).toEqual(['done', 'done', 'hi', expect.any(Number), 'a']);
  });

  it('notes-only omits the status column but still json_sets notes', async () => {
    const db = makeDB({ first: { data: JSON.stringify({ id: 'a', notes: 'hi' }) } });
    await call('PATCH', '/api/bench/entries', { db, body: { id: 'a', notes: 'hi' } });
    const stmt = db.calls.at(-1);
    expect(stmt.sql).not.toMatch(/status = \?/);
    expect(stmt.binds).toEqual(['hi', expect.any(Number), 'a']);
  });

  it('404s when the row does not exist', async () => {
    const res = await call('PATCH', '/api/bench/entries', {
      db: makeDB({ first: null }), body: { id: 'ghost', status: 'done' },
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/bench/entries', () => {
  it('400s a missing id', async () => {
    const res = await call('DELETE', '/api/bench/entries', { db: makeDB(), body: {} });
    expect(res.status).toBe(400);
  });

  it('404s when the row does not exist', async () => {
    const res = await call('DELETE', '/api/bench/entries', {
      db: makeDB({ first: null }), cdn: makeCdn(), body: { id: 'ghost' },
    });
    expect(res.status).toBe(404);
  });

  it('deletes and purges the row preview from R2', async () => {
    const cdn = makeCdn();
    const db = makeDB({ first: { data: JSON.stringify({ id: 'a', preview: 'bench/a-preview.jpg' }) } });
    const res = await call('DELETE', '/api/bench/entries', { db, cdn, body: { id: 'a' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(cdn.deleted).toEqual(['bench/a-preview.jpg']);
  });

  it('deletes a row with no preview without touching R2', async () => {
    const cdn = makeCdn();
    const db = makeDB({ first: { data: JSON.stringify({ id: 'a' }) } });
    const res = await call('DELETE', '/api/bench/entries', { db, cdn, body: { id: 'a' } });
    expect(res.status).toBe(200);
    expect(cdn.deleted).toEqual([]);
  });
});
