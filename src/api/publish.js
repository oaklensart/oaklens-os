// ---- GitHub publish + sync (POST /api/publish, GET /api/sync) ----
//
// The Field Console commits the site's data manifests (data/*.json) and post
// bodies straight to the instance's GitHub repo via the contents/git APIs, and
// pulls them back on sync. Extracted from worker.js (decomposition, manual
// §6.7). Requires GITHUB_TOKEN + GITHUB_REPO (optional secrets — the handlers
// answer 501 notConfigured when unset). worker.js re-exports the two pure
// guard helpers for tests/publish-guard.test.js.

import { verifyToken } from '../shared/auth.js';
import { jsonRes, notConfiguredRes } from '../shared/http.js';

// ---- GitHub helpers ----

function _ghHeaders(token) {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'oaklens-worker/1.0',
  };
}

// Throws with `status` attached on an HTTP error, so a caller can tell a real
// 404 ("this file is genuinely not on main") from a rate limit, a 5xx, or a
// dropped connection ("we do not know what is on main"). The safety guard below
// treats those two very differently; before the status was surfaced it could
// not, and it guessed the permissive answer. `status` is 0 when the request
// never completed at all.
async function _ghFetch(token, owner, repo, path, options = {}) {
  const url = `https://api.github.com/repos/${owner}/${repo}/${path}`;
  let res;
  try {
    res = await fetch(url, { ...options, headers: { ..._ghHeaders(token), ...(options.headers || {}) } });
  } catch (err) {
    throw Object.assign(new Error(`GitHub request failed on ${path}: ${err.message}`), { status: 0 });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(
      new Error(json?.message || `GitHub API ${res.status} on ${path}`),
      { status: res.status }
    );
  }
  return json;
}

// UTF-8 string -> standard base64 (GitHub blob encoding). Replaces the
// deprecated `unescape(encodeURIComponent(...))` idiom.
function _utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// main's current commit SHA, by two roads.
//
// The git-refs endpoint is the direct one, but it is not the only one that
// knows the answer, and it fails on its own sometimes — a transient 5xx, a
// secondary rate limit on a burst of parallel calls, a token whose grant
// covers the contents API but not the git plumbing. A sync that reads eight
// manifests fine and then reports "couldn't read main's revision" is that
// case: the link is up, one endpoint blinked.
//
// So when it does, ask the commits endpoint — same REST family as the file
// reads that just succeeded, same answer. Only if BOTH roads fail does the
// caller get null, and the stale-base guard genuinely has nothing to stand on.
// The first road's error is the one reported: it is the one that describes the
// intended call.
export async function _headSha(token, owner, repo) {
  try {
    const ref = await _ghFetch(token, owner, repo, 'git/ref/heads/main');
    return ref.object.sha;
  } catch (refErr) {
    try {
      const commit = await _ghFetch(token, owner, repo, 'commits/main');
      if (!commit?.sha) throw new Error('commits/main returned no sha');
      console.warn('[sync] git/ref/heads/main failed (%s) — fell back to commits/main', refErr.message);
      return commit.sha;
    } catch {
      throw refErr;
    }
  }
}

// ---- Publish safety guard ----
// Every published data manifest (data/*.json) is a JSON array. The Field Console
// rebuilds each manifest from its in-memory state on every publish, so if that
// state was lost — a stale morning session, evicted localStorage, a sync that
// never ran — it can serialize an EMPTY array and quietly wipe live content.
// That is exactly what blanked data/posts.json (12 → 0) and emptied the FN//Blog
// listing on 2026-07-10 while the underlying posts/*.md survived. This guard
// refuses any commit that would replace a non-empty manifest array on main with
// an empty one; deliberately emptying a manifest is not a console workflow.
export function _isEmptyJsonArray(content) {
  try {
    const v = JSON.parse(content);
    return Array.isArray(v) && v.length === 0;
  } catch {
    return false;   // non-JSON or unparseable — not this guard's concern
  }
}

// Pure decision (unit-tested): given the incoming files and a lookup of each
// path's CURRENT content on main (string, or null/undefined if absent), return
// the first manifest that would be wiped, or null when the commit is safe.
export function _emptyOverwriteGuard(files, currentByPath) {
  for (const f of files) {
    if (!/^data\/[^/]+\.json$/.test(f.path)) continue;   // only top-level data manifests
    if (!_isEmptyJsonArray(f.content)) continue;          // incoming isn't empty → fine
    let current;
    try { current = JSON.parse(currentByPath[f.path]); } catch { continue; }
    if (Array.isArray(current) && current.length > 0) {
      return { path: f.path, was: current.length };
    }
  }
  return null;
}

async function _commitFiles(token, owner, repo, files, expectedHeadSha) {
  // Get current HEAD
  const ref = await _ghFetch(token, owner, repo, 'git/ref/heads/main');
  const commitSha = ref.object.sha;
  // Optimistic-concurrency check (git non-fast-forward equivalent): the console
  // stamps every publish with the HEAD it last synced from. If main has advanced
  // since — another device published in between — this bundle was built on stale
  // state and committing it would silently revert whatever landed meanwhile. This
  // is the atomic spot to catch it: `commitSha` is the exact parent we'd build on.
  if (expectedHeadSha && commitSha !== expectedHeadSha) {
    throw Object.assign(new Error('stale base'), { code: 'stale_base', currentSha: commitSha });
  }
  const currentCommit = await _ghFetch(token, owner, repo, `git/commits/${commitSha}`);
  const treeSha = currentCommit.tree.sha;

  // Create blobs concurrently — each is an independent POST; only the tree/commit
  // steps below depend on the results. Promise.all preserves array order.
  const treeItems = await Promise.all(files.map(async ({ path, content }) => {
    const encoded = _utf8ToBase64(content);
    const blob = await _ghFetch(token, owner, repo, 'git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: encoded, encoding: 'base64' }),
    });
    return { path, mode: '100644', type: 'blob', sha: blob.sha };
  }));

  // Create tree
  const newTree = await _ghFetch(token, owner, repo, 'git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: treeSha, tree: treeItems }),
  });

  // Create commit
  const newCommit = await _ghFetch(token, owner, repo, 'git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: 'publish: field console update',
      tree: newTree.sha,
      parents: [commitSha],
    }),
  });

  // Update ref.
  //
  // The stale-base check above closes the window before this function starts,
  // but not the one INSIDE it: blobs, tree and commit are several round-trips,
  // and another device can publish while they run. Git catches that — the ref
  // PATCH is not a fast-forward, so GitHub answers 422 — but the error came
  // back as a generic 500 carrying GitHub's wording, so the console's conflict
  // handling never fired for the one race the guard exists for. It is the same
  // conflict with the same remedy, so it gets the same code.
  try {
    await _ghFetch(token, owner, repo, 'git/refs/heads/main', {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    });
  } catch (err) {
    if (err.status === 422) {
      // Best-effort: report the sha that beat us so the console can say what
      // to sync. A failure here must not mask the conflict itself.
      const ref2 = await _ghFetch(token, owner, repo, 'git/ref/heads/main').catch(() => null);
      throw Object.assign(new Error('stale base'), {
        code: 'stale_base',
        currentSha: ref2?.object?.sha || null,
      });
    }
    throw err;
  }

  return newCommit.sha;
}

// ---- POST /api/publish ----

export async function handlePublish(request, env) {
  if (!await verifyToken(request, env)) {
    return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return notConfiguredRes('GitHub publish', ['GITHUB_TOKEN', 'GITHUB_REPO']);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ ok: false, error: 'invalid request body' }, 400);
  }

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return jsonRes({ ok: false, error: 'no files provided' }, 400);
  }

  // WHICH PATHS A PUBLISH MAY TOUCH (2026-08-07).
  //
  // This used to accept any path the client sent. That was untidy while a
  // commit was just a commit — and it stopped being merely untidy the moment
  // an instance connects its repo to Cloudflare's git integration, because
  // then a push triggers a BUILD. The chain that opens:
  //
  //   console session -> publish `package.json` with a postinstall script
  //     -> push lands on main -> Workers Build runs `npm install`
  //     -> arbitrary code executes holding the build's Cloudflare API token
  //
  // and that token carries account-level Workers deploy rights, because
  // Cloudflare has no per-Worker scope for it. So an admin password on one
  // site reached every Worker on the account. `.github/workflows/*` is the
  // same story through a different door.
  //
  // buildBundle() (js/console/publish.js) only ever emits `data/*.json` and
  // `posts/*.md`, so enforcing exactly that server-side costs the console
  // nothing. The read path (handleSync) already validated its paths; the write
  // path never did, which is the wrong way round.
  //
  // No path separator is allowed inside a segment, so traversal cannot pass.
  const PUBLISHABLE_PATH = /^(?:data\/[A-Za-z0-9._-]+\.json|posts\/[A-Za-z0-9._-]+\.md)$/;
  const disallowed = body.files
    .map((f) => (f && typeof f.path === 'string' ? f.path : '(missing path)'))
    .filter((p) => !PUBLISHABLE_PATH.test(p));
  if (disallowed.length) {
    // Refuse the WHOLE publish. A partial commit that dropped the bad paths
    // would leave the author believing everything landed.
    return jsonRes({
      ok: false,
      code: 'path_not_publishable',
      paths: disallowed.slice(0, 10),
      error: 'Publish only writes data/*.json and posts/*.md. '
        + `Refused: ${disallowed.slice(0, 3).join(', ')}`,
    }, 400);
  }

  const [owner, repo] = env.GITHUB_REPO.split('/');

  // Safety guard: never let a publish blank a live data manifest. Only pay the
  // extra GitHub round-trips when an incoming manifest is actually empty — the
  // normal (non-empty) publish path is untouched.
  //
  // body.allowEmpty: manifests the console VOUCHES are deliberately empty — the
  // author trashed the last item(s), and the trash held previously-published
  // entries to prove it. The accident this guard exists for (a stale session
  // serializing lost state) leaves the trash empty, so it still trips. Without
  // this, deleting the only item on a surface wedged publish permanently: the
  // guard refused 1 → 0, and the retry-sync re-imported the deleted item.
  const allowEmpty = Array.isArray(body.allowEmpty)
    ? body.allowEmpty.filter((p) => typeof p === 'string' && /^data\/[^/]+\.json$/.test(p))
    : [];
  const suspects = body.files.filter(
    (f) => f && typeof f.path === 'string'
      && /^data\/[^/]+\.json$/.test(f.path) && _isEmptyJsonArray(f.content)
      && !allowEmpty.includes(f.path)
  );
  if (suspects.length) {
    const currentByPath = {};
    // FAIL CLOSED. Every failure here used to be recorded as `null` — "absent
    // on main, nothing to protect" — so the guard waved the publish through on
    // exactly the anomalous day it exists for: a rate limit or a GitHub 5xx
    // reads as "the file isn't there" and the empty manifest lands. Only a real
    // 404 means absent. Anything else means we don't KNOW what is on main, and
    // the only safe answer to that is to refuse and let the author retry.
    const unknown = [];
    await Promise.all(suspects.map(async (f) => {
      try {
        const data = await _ghFetch(env.GITHUB_TOKEN, owner, repo, `contents/${f.path}?ref=main`);
        currentByPath[f.path] = new TextDecoder().decode(
          Uint8Array.from(atob(data.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))
        );
      } catch (err) {
        if (err.status === 404) {
          currentByPath[f.path] = null;   // genuinely absent on main → nothing to protect
        } else {
          unknown.push({ path: f.path, status: err.status ?? null, message: err.message });
        }
      }
    }));
    if (unknown.length) {
      const first = unknown[0];
      console.error(`[publish] guard check failed for ${first.path}: ${first.message}`);
      return jsonRes({
        ok: false,
        code: 'guard_check_failed',
        paths: unknown.map((u) => u.path),
        error: `Publish held: couldn't read ${first.path} from main to check it won't be `
          + `blanked (${first.message}). Nothing was committed — wait a moment and publish again.`,
      }, 503);
    }
    const wipe = _emptyOverwriteGuard(suspects, currentByPath);
    if (wipe) {
      return jsonRes({
        ok: false,
        code: 'empty_overwrite_blocked',
        error: `Refusing to publish: ${wipe.path} would drop ${wipe.was} entries to 0. `
          + `The console likely lost its synced data — click "Sync from main" to reload it, then retry.`,
      }, 409);
    }
  }

  try {
    const sha = await _commitFiles(
      env.GITHUB_TOKEN, owner, repo, body.files,
      typeof body.baseSha === 'string' && body.baseSha ? body.baseSha : null
    );
    return jsonRes({ ok: true, sha }, 200);
  } catch (err) {
    if (err.code === 'stale_base') {
      return jsonRes({
        ok: false,
        code: 'stale_base',
        currentSha: err.currentSha,
        error: 'Publish rejected: main has changed since this device last synced '
          + '(another device published in between). Sync from main to pull those '
          + 'changes, then publish again.',
      }, 409);
    }
    console.error('[publish] GitHub commit failed:', err.message);
    return jsonRes({ ok: false, error: err.message }, 500);
  }
}

// ---- GET /api/sync ----

export async function handleSync(request, env) {
  if (!await verifyToken(request, env)) {
    return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return notConfiguredRes('GitHub sync', ['GITHUB_TOKEN', 'GITHUB_REPO']);
  }

  const url = new URL(request.url);
  const filesParam = url.searchParams.get('files') || '';
  const requestedFiles = filesParam.split(',').map(f => f.trim()).filter(Boolean);

  const defaultFiles = [
    'data/buffer.json',
    'data/archive.json',
    'data/posts.json',
    'data/wallpapers.json',
    'data/barrel.json',
    'data/friends.json',
    'data/library.json',
  ];
  const filesToFetch = requestedFiles.length > 0 ? requestedFiles : defaultFiles;

  const [owner, repo] = env.GITHUB_REPO.split('/');
  const results = {};

  // Current main HEAD, fetched alongside the files. The console records this as
  // the base revision of the snapshot it just pulled and stamps it onto the next
  // publish, so the worker can reject a publish built on stale state (see
  // _commitFiles).
  //
  // A failure here is non-fatal for the sync — the files themselves are still
  // useful — but it is NOT harmless: a null headSha means the next publish
  // carries no baseSha, which silently disarms the stale-base guard for that
  // snapshot. So the response says so (`headShaError`) and the console surfaces
  // it, rather than the protection quietly evaporating.
  let headShaError = null;
  const headShaPromise = _headSha(env.GITHUB_TOKEN, owner, repo)
    .catch((err) => {
      headShaError = err.message || 'ref fetch failed';
      console.error('[sync] main HEAD unavailable:', headShaError);
      return null;
    });

  // Fetch all requested files concurrently — each had its own GitHub round-trip
  // awaited in series before. Per-file try/catch keeps one failure from sinking
  // the batch; writes to distinct `results` keys are safe on the single thread.
  await Promise.all(filesToFetch.map(async (filePath) => {
    // Prevent path traversal
    if (filePath.includes('..') || filePath.startsWith('/')) return;
    try {
      const data = await _ghFetch(env.GITHUB_TOKEN, owner, repo, `contents/${filePath}?ref=main`);
      const content = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(data.content.replace(/\s/g, '')), c => c.charCodeAt(0))
        )
      );
      results[filePath] = { ok: true, content };
    } catch (err) {
      results[filePath] = { ok: false, error: err.message };
    }
  }));

  const headSha = await headShaPromise;
  return jsonRes({
    ok: true,
    files: results,
    // Which repo the worker actually asked GitHub for. The console shows this
    // when every read fails — "Not Found" on its own is undebuggable, but
    // "github.com/<what-you-typed> was not found" points straight at a
    // mistyped GITHUB_REPO secret (the cold-run-4 failure). The endpoint is
    // console-authed, so naming the repo leaks nothing.
    repo: env.GITHUB_REPO,
    headSha,
    ...(headSha ? {} : {
      headShaError: headShaError || 'main HEAD unavailable',
      // Explicit, so the console never has to infer it from a missing field.
      staleBaseGuard: 'disarmed',
    }),
  }, 200);
}
