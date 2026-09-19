// ---- Bench Queue API (D1) + Bench RAW proxy (B2) ----
//
// The RAW-processing worklist. Migrated from a single data/bench.json blob in R2
// (read-modify-write the whole array on every op -> lost-update race +
// wipe-on-read-error) to the `bench_entries` D1 table, so every mutation is an
// atomic single-row statement. See migrations/0001_console_tables.sql. Entries are
// schemaless on the client, so the full object lives in the `data` JSON column;
// `id`/`status` are broken out for PK and filtering, and status/notes writes use
// json_set() to keep both in sync without a read-modify-write.
//
// Extracted from worker.js (decomposition, manual §6.7).

import { verifyToken } from '../shared/auth.js';
import { jsonRes, d1MissingRes, notConfiguredRes, isMissingTableError, d1TablesMissingRes, CORS_HEADERS } from '../shared/http.js';

export async function handleGetBench(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('bench queue');

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');

  try {
    const stmt = statusFilter
      ? env.DB.prepare('SELECT data FROM bench_entries WHERE status = ? ORDER BY created_at ASC').bind(statusFilter)
      : env.DB.prepare('SELECT data FROM bench_entries ORDER BY created_at ASC');
    const { results } = await stmt.all();
    const entries = (results || []).map(r => JSON.parse(r.data));
    return jsonRes(entries, 200);
  } catch (err) {
    // An unmigrated D1 (one-click install, migrations never ran) is a
    // deliberate 501, not a fault or a retryable 503 — the console must not
    // red-latch on it.
    if (isMissingTableError(err)) return d1TablesMissingRes('bench queue');
    console.error('[bench] list failed:', err);
    return jsonRes({ ok: false, error: 'bench temporarily unavailable' }, 503);
  }
}

export async function handleAddBenchEntries(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('bench queue');

  let newEntries;
  try {
    newEntries = await request.json();
    if (!Array.isArray(newEntries)) throw new Error('Expected array');
  } catch {
    return jsonRes({ ok: false, error: 'invalid request body' }, 400);
  }

  // INSERT OR IGNORE makes each insert atomic and idempotent on id; meta.changes
  // is 1 for a new row, 0 when the id already existed (skipped). A monotonically
  // increasing created_at keeps queue order stable within the batch.
  const base = Date.now();
  const stmts = [];
  let candidates = 0;
  for (const entry of newEntries) {
    if (!entry || !entry.id) continue;
    const id = String(entry.id);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO bench_entries (id, status, data, created_at, updated_at)
         VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING`
      ).bind(id, entry.status || 'queued', JSON.stringify(entry), base + candidates, base)
    );
    candidates++;
  }

  if (stmts.length === 0) return jsonRes({ added: 0, skipped: 0 }, 200);

  try {
    const res = await env.DB.batch(stmts);
    const added = res.reduce((n, r) => n + (r.meta?.changes || 0), 0);
    return jsonRes({ added, skipped: candidates - added }, 200);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('bench queue');
    console.error('[bench] add failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

export async function handleUpdateBenchEntry(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('bench queue');

  let updateReq;
  try {
    updateReq = await request.json();
    if (!updateReq.id) throw new Error('Missing id');
  } catch {
    return jsonRes({ ok: false, error: 'invalid request body' }, 400);
  }

  // Atomic field update via json_set — no read-modify-write, so a concurrent
  // status PATCH and notes PATCH can't clobber each other. The `status` column
  // is kept in sync with data.$.status for the filter index.
  const cols = [];
  const jsonPairs = [];
  const binds = [];
  if (updateReq.status !== undefined) {
    cols.push('status = ?');
    binds.push(updateReq.status);
    jsonPairs.push("'$.status', ?");
  }
  if (updateReq.notes !== undefined) {
    jsonPairs.push("'$.notes', ?");
  }
  if (jsonPairs.length === 0) {
    return jsonRes({ ok: false, error: 'nothing to update' }, 400);
  }
  // json_set value binds, in the order the pairs appear above.
  if (updateReq.status !== undefined) binds.push(updateReq.status);
  if (updateReq.notes !== undefined) binds.push(updateReq.notes);

  const setClause = [...cols, `data = json_set(data, ${jsonPairs.join(', ')})`, 'updated_at = ?'].join(', ');
  binds.push(Date.now(), String(updateReq.id));

  try {
    const row = await env.DB.prepare(
      `UPDATE bench_entries SET ${setClause} WHERE id = ? RETURNING data`
    ).bind(...binds).first();
    if (!row) return jsonRes({ ok: false, error: 'not found' }, 404);
    return jsonRes(JSON.parse(row.data), 200);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('bench queue');
    console.error('[bench] update failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

export async function handleDeleteBenchEntry(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('bench queue');

  let delReq;
  try {
    delReq = await request.json();
    if (!delReq.id) throw new Error('Missing id');
  } catch {
    return jsonRes({ ok: false, error: 'invalid request body' }, 400);
  }

  const id = String(delReq.id);
  try {
    // RETURNING gives us the row's preview key in the same atomic statement.
    const row = await env.DB.prepare('DELETE FROM bench_entries WHERE id = ? RETURNING data').bind(id).first();
    if (!row) return jsonRes({ ok: false, error: 'not found' }, 404);

    let preview;
    try { preview = JSON.parse(row.data).preview; } catch { /* malformed row — nothing to purge */ }
    if (preview) {
      try {
        await env.CDN.delete(preview);
      } catch (err) {
        console.error(`[bench] failed to delete preview for ${id}:`, err);
      }
    }
    return jsonRes({ deleted: true }, 200);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('bench queue');
    console.error('[bench] delete failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

export async function handleClearDoneBenchEntries(request, env) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return d1MissingRes('bench queue');

  try {
    // Delete and reclaim the rows atomically; purge their R2 previews after.
    const { results } = await env.DB.prepare(
      "DELETE FROM bench_entries WHERE status = 'done' RETURNING data"
    ).all();
    const done = results || [];

    for (const r of done) {
      let preview;
      try { preview = JSON.parse(r.data).preview; } catch { continue; }
      if (preview) {
        try {
          await env.CDN.delete(preview);
        } catch (err) {
          console.error('[bench] failed to delete preview:', err);
        }
      }
    }

    return jsonRes({ cleared: done.length }, 200);
  } catch (err) {
    if (isMissingTableError(err)) return d1TablesMissingRes('bench queue');
    console.error('[bench] clear-done failed:', err);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

// ---- Bench RAW Proxy (B2) ----

export async function handleBenchRawDownload(request, env, filename) {
  if (!await verifyToken(request, env)) return jsonRes({ ok: false, error: 'unauthorized' }, 401);

  if (!filename || filename.includes('..') || filename.includes('/')) {
    return jsonRes({ ok: false, error: 'invalid filename' }, 400);
  }

  const bucketName = env.B2_BUCKET_NAME;
  const keyId = env.B2_KEY_ID;
  const appKey = env.B2_APP_KEY;

  if (!bucketName || !keyId || !appKey) {
    return notConfiguredRes('bench RAW cold storage', ['B2_BUCKET_NAME', 'B2_KEY_ID', 'B2_APP_KEY']);
  }

  const endpoint = env.B2_ENDPOINT || `https://s3.us-west-004.backblazeb2.com`;
  const objectKey = `raw/${filename}`;
  const url = `${endpoint}/${bucketName}/${objectKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const region = env.B2_REGION || 'us-west-004';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = `/${bucketName}/${objectKey}`;
  const canonicalQuerystring = '';
  const canonicalHeaders = `host:${new URL(endpoint).host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'GET', canonicalUri, canonicalQuerystring,
    canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'
  ].join('\n');

  const encoder = new TextEncoder();

  async function hmacSha256(key, msg) {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(msg)));
  }

  async function sha256Hex(msg) {
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(msg));
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  let signingKey = encoder.encode(`AWS4${appKey}`);
  for (const part of [dateStamp, region, service, 'aws4_request']) {
    signingKey = await hmacSha256(signingKey, part);
  }
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  const signature = [...signatureBytes].map(b => b.toString(16).padStart(2, '0')).join('');

  const authorization = `AWS4-HMAC-SHA256 Credential=${keyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const b2Response = await fetch(url, {
    headers: {
      'Host': new URL(endpoint).host,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amzDate,
      'Authorization': authorization,
    },
  });

  if (!b2Response.ok) {
    console.error(`[bench-raw] B2 fetch failed: ${b2Response.status}`);
    return jsonRes({ ok: false, error: 'file not found' }, 404);
  }

  const ext = filename.split('.').pop().toLowerCase();
  const contentTypes = {
    rw2: 'image/x-panasonic-rw2', cr2: 'image/x-canon-cr2', cr3: 'image/x-canon-cr3',
    arw: 'image/x-sony-arw', nef: 'image/x-nikon-nef', dng: 'application/x-adobe-dng',
    raf: 'image/x-fuji-raf', orf: 'image/x-olympus-orf',
  };
  const contentType = contentTypes[ext] || 'application/octet-stream';

  return new Response(b2Response.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': b2Response.headers.get('Content-Length') || '',
      'Cache-Control': 'private, no-store',
      ...CORS_HEADERS,
    },
  });
}
