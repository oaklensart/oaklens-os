// ---- PULSE (D1) ----
//
// The homepage's immediate card: a glyph, a line, a state, posted in two taps
// and live in seconds.
//
// WHY THIS IS NOT A data/*.json FILE. Every other piece of content here travels
// console → data/*.json → GitHub commit → Workers Build → live. That road is
// right for frames and posts and wrong for a pulse: it would cost a full site
// redeploy per post, land minutes later, and burn a fork's free build minutes
// doing it. A pulse is mutable, personal, short-lived state — the D1 tier by the
// storage rule in CLAUDE.md, and the reason posting one costs no deploy at all.
//
// ONE TABLE, TWO JOBS (migrations/0002_pulses.sql). The current pulse is the
// newest row whose expires_at is still ahead of now; the log is every row. So
// expiry needs no cron and no second store, and retiring a pulse early moves
// expires_at rather than deleting the row — the log keeps it either way.
//
// AT MOST ONE PULSE IS LIVE AT A TIME, and that is an invariant this file
// ENFORCES rather than a property the read merely simulates. The first cut let
// posting rely on "newest unexpired wins": true of the homepage, false of the
// data. With an 18-hour TTL every pulse posted in the last 18 hours stayed
// unexpired, stacked up behind the visible one — so taking one down expired
// only the newest and handed the slot to the runner-up. Take down three times,
// get three old pulses back. (Reported 2026-08-13; the same fault showed in the
// console's log as several rows wearing a LIVE badge at once.)
//
// So: POST expires the previous live rows in the same batch as its insert,
// DELETE expires every live row rather than one, and the log derives `live`
// from "is this the newest unexpired row" instead of trusting the flag. The
// read below is left alone — it was already correct, and it stays defensive
// against any row that slips past the writers.
//
// THE PUBLIC READ NEVER FAILS. GET /api/pulse answers 200 { pulse: null } for
// every degraded state there is: no D1 binding, an unmigrated database, a
// query that throws, nothing posted, everything expired. A pulse is a garnish —
// it can never be the reason a homepage looks broken. The console's writes keep
// the louder shapes (401 / 500 / the standard 501 notConfigured) because the
// author DOES need to be told.

import { verifyToken } from '../shared/auth.js';
import { jsonRes, d1MissingRes, isMissingTableError, d1TablesMissingRes, CORS_HEADERS } from '../shared/http.js';
import { normalizePulseInput, pulseToPublic, defaultTtlHours } from '../shared/pulse.js';

// No `kicker`. The card names itself (src/shared/pulse.js PULSE_LABEL), so there
// is no per-row title to select, insert or hand to the browser.
const COLS = 'id, text, glyphs, state, foot_left, foot_right, local_time, posted_at, expires_at';

// 60s: fresh enough that a pulse posted from the darkroom feels live, cheap
// enough that a front page does not put D1 on the hot path of every visit.
const PUBLIC_CACHE = 'public, max-age=60';

function publicRes(pulse) {
  return new Response(JSON.stringify({ pulse: pulse || null }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': PUBLIC_CACHE, ...CORS_HEADERS },
  });
}

// ---- GET /api/pulse — public ----
export async function handleGetPulse(request, env) {
  if (!env.DB) return publicRes(null);
  try {
    const row = await env.DB.prepare(
      `SELECT ${COLS} FROM pulses WHERE expires_at > ?1 ORDER BY posted_at DESC LIMIT 1`
    ).bind(Date.now()).first();
    return publicRes(pulseToPublic(row));
  } catch (err) {
    // Includes the unmigrated-D1 case. The homepage asked a question it can
    // live without an answer to, so it gets the same "no pulse" it would get on
    // a quiet Tuesday. Logged, not surfaced.
    console.error('[pulse] read failed:', err.message);
    return publicRes(null);
  }
}

// ---- POST /api/pulse — console ----
export async function handlePostPulse(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('Pulse');

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ ok: false, error: 'invalid request body' }, 400);
  }

  const parsed = normalizePulseInput(body);
  if (!parsed.ok) return jsonRes({ ok: false, error: parsed.error }, 400);
  const m = parsed.pulse;
  const id = crypto.randomUUID().slice(0, 12);

  try {
    // Posting REPLACES the live pulse rather than stacking a second one behind
    // it. Both statements go through `batch()`, which D1 runs as a single
    // transaction — so there is no instant where two pulses are live and no
    // way for the retire to succeed while the expiry did not.
    //
    // The retire runs FIRST and is bounded by `expires_at > ?`, so it touches
    // only rows that were live, never the log's history. It also cleans up
    // after the old behaviour: the first post on a database carrying a backlog
    // of unexpired rows collapses them all.
    await env.DB.batch([
      env.DB.prepare('UPDATE pulses SET expires_at = ?1 WHERE expires_at > ?1').bind(m.posted_at),
      env.DB.prepare(
        `INSERT INTO pulses (id, text, glyphs, state, foot_left, foot_right,
                             local_time, posted_at, expires_at, ambient)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      ).bind(
        id, m.text, m.glyphs, m.state, m.foot_left, m.foot_right,
        m.local_time, m.posted_at, m.expires_at, m.ambient
      ),
    ]);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('Pulse');
    console.error('[pulse] post failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }

  // Returning the stored shape lets the console show exactly what the homepage
  // will show, without a second round trip to read it back.
  return jsonRes({ ok: true, pulse: pulseToPublic({ id, ...m }) }, 200);
}

// ---- DELETE /api/pulse — console ----
//
// Takes the pulse OFF the homepage. Moves expires_at instead of deleting the
// row: the log is the point, and a pulse you took down is part of the record —
// the console's RECENT list can still bring it back.
//
// EVERY live row, not just the newest. The first cut expired one row, which is
// the same thing only while the invariant above holds — and it did not, so
// taking a pulse down promoted whatever was behind it and the homepage showed a
// stale pulse instead of returning to real work. Bounded by `expires_at > ?`,
// so it can only touch what was actually live; expired rows keep their original
// timestamps and the history stays honest.
//
// This is also the repair path for a database that accumulated a backlog under
// the old behaviour: one press collapses the lot.
export async function handleDeletePulse(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('Pulse');
  const now = Date.now();
  try {
    const res = await env.DB.prepare(
      'UPDATE pulses SET expires_at = ?1 WHERE expires_at > ?1'
    ).bind(now).run();
    // `changes` is how many rows were live. The console only needs to know
    // whether there was anything to take down, but the count is the honest
    // answer and it makes a stacked backlog visible in the response.
    const retired = (res && res.meta && res.meta.changes) || 0;
    return jsonRes({ ok: true, retired }, 200);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('Pulse');
    console.error('[pulse] retire failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

// ---- GET /api/pulse/log — console ----
//
// The owner's diary, and the console's "post it again" list — anything you
// wrote and want back is already here, which is why there is no separate
// saved-states table. Console-only: this is not a public feed.
const LOG_LIMIT_DEFAULT = 50;
const LOG_LIMIT_MAX = 200;

export async function handlePulseLog(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('Pulse');

  const url = new URL(request.url);
  const asked = parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Math.min(LOG_LIMIT_MAX, Math.max(1, Number.isFinite(asked) ? asked : LOG_LIMIT_DEFAULT));

  try {
    const { results } = await env.DB.prepare(
      `SELECT ${COLS} FROM pulses ORDER BY posted_at DESC LIMIT ?1`
    ).bind(limit).all();
    const now = Date.now();

    // `live` means "this is the one on the homepage right now" — so exactly ONE
    // row can carry it, and it is decided the same way the public read decides:
    // newest unexpired wins. Rows are already newest-first, so that is the first
    // unexpired one.
    //
    // The obvious version — `live: expires_at > now`, per row — is what shipped,
    // and it badged several rows at once. That was not a labelling bug on top of
    // a working system; it was the log honestly reporting the stacking fault the
    // writers above now prevent. Deriving it here keeps the console truthful even
    // against a database that predates the fix, or one edited by hand.
    const liveRow = (results || []).find((r) => Number(r.expires_at) > now);
    const liveId = liveRow ? liveRow.id : null;

    return jsonRes({
      ok: true,
      ttlHours: defaultTtlHours(),
      pulses: (results || []).map((r) => ({ ...pulseToPublic(r), live: r.id === liveId })),
    }, 200);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('Pulse');
    console.error('[pulse] log failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}
