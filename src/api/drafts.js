// ---- FN CLOUD DRAFTS (D1) ----
//
// Field-note drafts are mutable work-in-progress, so they live in D1 (strongly
// consistent) rather than only in the browser's localStorage — this lets a draft
// survive a tab close, a cleared cache, or a switch between the iPad and the
// laptop. Published posts are unaffected: they still flow to GitHub via
// /api/publish, and a draft's row is deleted once it graduates to published.
//
// Table (see migrations/0001_console_tables.sql):
//   fn_drafts(id PK, fn_id, title, location, date, body, hero_filename,
//             buffer_dates, updated_at INTEGER epoch-ms, created_at)
// Hero is stored as a CDN filename only — never a base64 preview blob.
//
// CONCURRENCY (2026-08-06). The advertised use case — iPad ↔ laptop — is the
// two-writer race, and PUT was a blind upsert stamped with a CLIENT clock: the
// device that saved last won, even if it had been offline for an hour with a
// stale copy, and a skewed clock could stamp the survivor *older* than the work
// it replaced. The write is conditional now: the client sends the version it
// loaded (`base_updated_at`) and the UPDATE applies only while the row has not
// moved since. A newer row answers 409 with the server's copy, so the console
// can show what it would have clobbered instead of silently discarding it. The
// new `updated_at` is stamped server-side; a client clock is no longer trusted
// for ordering.
//
// Extracted from worker.js (decomposition, manual §6.7).

import { verifyToken } from '../shared/auth.js';
import { jsonRes, d1MissingRes, isMissingTableError, d1TablesMissingRes } from '../shared/http.js';

export async function handleGetDrafts(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('FN cloud drafts');
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, fn_id, title, location, date, body, hero_filename, buffer_dates, updated_at
       FROM fn_drafts ORDER BY updated_at DESC`
    ).all();
    return jsonRes({ ok: true, drafts: results || [] }, 200);
  } catch (err) {
    // An unmigrated D1 (one-click install, migrations never ran) is a
    // deliberate 501, not a fault — the console must not red-latch on it.
    if (isMissingTableError(err)) return d1TablesMissingRes('FN cloud drafts');
    console.error('[drafts] list failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

const DRAFT_COLS = 'id, fn_id, title, location, date, body, hero_filename, buffer_dates, updated_at';

export async function handlePutDraft(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('FN cloud drafts');

  let d;
  try {
    d = await request.json();
    if (!d || !d.id) throw new Error('missing id');
  } catch {
    return jsonRes({ ok: false, error: 'invalid request body' }, 400);
  }

  // Defensive: never persist a base64 hero preview — filename only.
  const hero = (d.hero_filename && !String(d.hero_filename).startsWith('data:'))
    ? String(d.hero_filename) : null;
  // Server clock, always. The client's `updated_at` used to be written straight
  // through, which let a device with a wrong clock stamp its save older than
  // what it overwrote — the ordering that login-sync then trusted.
  const updated_at = Date.now();

  // The base version the client is editing from. `force: true` is the explicit
  // "I saw the conflict and chose to overwrite" path (the console asks first —
  // a silent force would put the race back). A request with no base at all is
  // an older cached console: it writes unconditionally, the same allowance
  // /api/publish makes for a client that sends no baseSha (manual §5.6).
  const hasBase = Number.isFinite(d.base_updated_at);
  const conditional = hasBase && d.force !== true;

  const values = [
    String(d.id),
    d.fn_id || null,
    d.title || null,
    d.location || null,
    d.date || null,
    d.body || '',
    hero,
    d.buffer_dates || null,
    updated_at,
  ];

  // ONE statement does the whole decision. SQLite's upsert takes a WHERE on the
  // DO UPDATE: when it fails the row is left alone and RETURNING yields nothing
  // — no error, no read-modify-write window, nothing to race. A brand-new id
  // still takes the INSERT path (there is no conflict to guard).
  const guard = conditional ? ' WHERE fn_drafts.updated_at <= ?' : '';
  const sql =
    `INSERT INTO fn_drafts (${DRAFT_COLS})
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       fn_id=excluded.fn_id, title=excluded.title, location=excluded.location,
       date=excluded.date, body=excluded.body, hero_filename=excluded.hero_filename,
       buffer_dates=excluded.buffer_dates,
       updated_at=MAX(excluded.updated_at, fn_drafts.updated_at + 1)${guard}
     RETURNING updated_at`;

  try {
    const binds = conditional ? [...values, d.base_updated_at] : values;
    const row = await env.DB.prepare(sql).bind(...binds).first();
    // The stamp the row actually got, which is NOT always the clock read above:
    // `MAX(…, stored + 1)` above forces it strictly forward.
    //
    // WHY. `updated_at` is epoch-MILLISECONDS, and two saves can land inside
    // one of those. When they did, the second write stamped the same value the
    // first one had, so the row never appeared to move — and the next save
    // from a device holding that same base passed `stored <= base` and
    // overwrote work it had never seen. That is precisely the lost update this
    // whole conditional exists to stop, hiding in the resolution of the clock
    // it was measured with. It surfaced as an intermittently red
    // tests/drafts-conflict.test.js ("A's forced retry wins") rather than as a
    // report, because two writes in the same millisecond is a test loop's
    // normal day and a human author's rare one.
    if (row) return jsonRes({ ok: true, id: d.id, updated_at: row.updated_at }, 200);

    // Nothing written: the row moved since the client loaded it. Hand back the
    // server's copy so the console can show what it would have overwritten.
    const current = await env.DB.prepare(
      `SELECT ${DRAFT_COLS} FROM fn_drafts WHERE id = ?`
    ).bind(String(d.id)).first();
    if (!current) {
      // No row and no write is not a conflict — it's a failed insert we should
      // not paper over as one.
      return jsonRes({ ok: false, error: 'draft not written' }, 500);
    }
    return jsonRes({
      ok: false,
      code: 'draft_conflict',
      draft: current,
      updated_at: current.updated_at,
      error: 'This draft was changed on another device after this one loaded it. '
        + 'Reload it here, or re-save to overwrite that version.',
    }, 409);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('FN cloud drafts');
    console.error('[drafts] put failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

export async function handleDeleteDraft(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('FN cloud drafts');

  let id;
  try {
    const b = await request.json();
    id = b && b.id;
    if (!id) throw new Error('missing id');
  } catch {
    return jsonRes({ ok: false, error: 'invalid request body' }, 400);
  }

  try {
    await env.DB.prepare('DELETE FROM fn_drafts WHERE id = ?').bind(String(id)).run();
    return jsonRes({ ok: true, deleted: id }, 200);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('FN cloud drafts');
    console.error('[drafts] delete failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}
