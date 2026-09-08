// Enforces the project's documented #1 silent miss: a versioned asset whose
// content changed but whose ?v= did not.
//
// tests/guards.test.js already checks that every reference to a given file
// agrees on ONE version. That catches a half-applied bump, but it cannot catch a
// bump that never happened — edit js/console-ui.js, leave ?v=31 alone, and every
// reference still agrees. CI goes green and every installed PWA keeps serving
// the old cached copy from the service worker. Browser tabs revalidate and look
// fine, which is exactly how this hides.
//
// This closes that gap by diffing against the merge-base with origin/main: if a
// js/ or css/ file's content moved and its version did not, fail.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanVersionMap } from './helpers/versions.js';

const ROOT = join(import.meta.dirname, '..');

function rawGit(cmd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** For refs and listings, where surrounding whitespace is noise. */
function tryGit(cmd) {
  const out = rawGit(cmd);
  return out === null ? null : out.trim();
}

/**
 * The commit this branch diverged from origin/main.
 *
 * Returns null rather than a guessed ref when it cannot be resolved. An earlier
 * version of this guard fell back to the literal string 'origin/main'; when that
 * ref was stale the entire check silently passed, which is worse than not having
 * it at all. The test below turns null into a loud failure.
 */
function resolveBaseRef() {
  const base = tryGit('merge-base HEAD origin/main');
  if (!base || !tryGit(`rev-parse --verify ${base}^{commit}`)) return null;

  // On main itself — a local commit before `git push origin main`, or CI's
  // post-push checkout — the merge-base IS HEAD, which would compare the tree
  // against itself and pass trivially. Step back one commit so the change that
  // was just made still gets checked. On a root commit there is nothing behind
  // HEAD; returning base makes this a no-op rather than a false alarm.
  const head = tryGit('rev-parse HEAD');
  if (base === head) {
    // …UNLESS the change under test is still in the working tree. Stepping back
    // then compares against HEAD~1, and HEAD's own (correct) bump satisfies the
    // check on the LATER edit's behalf — so a second round of changes to the
    // same file, on top of a commit that is already on origin/main, sails
    // through at the version that commit published. Found the hard way, in
    // exactly that shape: field-console.css bumped 51→52 and pushed, then
    // edited again, and this guard saw 52 ≠ 51 and passed.
    const dirty = tryGit('status --porcelain -- js css');
    if (dirty) return base;
    return tryGit('rev-parse HEAD~1') ?? base;
  }
  return base;
}

function readWorking(file) {
  try { return readFileSync(join(ROOT, file), 'utf8'); } catch { return null; }
}

// NOT tryGit: trimming would strip a file's trailing newline and make every
// unchanged file compare as changed.
const readAtRef = (ref, file) => rawGit(`show ${ref}:${file}`);

function filesAt(ref, predicate) {
  const list = tryGit(`ls-tree -r --name-only ${ref}`);
  return list ? list.split('\n').filter(predicate) : [];
}

/** Versioned asset files — the things a ?v= is attached to. */
const isVersionedAsset = (p) =>
  (p.startsWith('js/') || p.startsWith('css/')) && (p.endsWith('.js') || p.endsWith('.css'));

/** Files that can carry a ?v= reference to some other file. */
const isScanTarget = (p) => p.endsWith('.html') || p.endsWith('.js') || p === 'dev/sw.js';

const baseRef = resolveBaseRef();

// A shallow clone genuinely has no history to diff against — that is the
// environment's doing, not a mistake in the tree, so it must not red-flag CI.
// `actions/checkout` is shallow by default; adding `fetch-depth: 0` to the
// workflow is what lets this guard run there too. Everywhere else (any normal
// local clone) an unresolvable base IS a fixable problem and fails loudly.
const isShallow = tryGit('rev-parse --is-shallow-repository') === 'true';
// No git at all — e.g. the freshly extracted engine tree before its first
// commit, or a tarball download. There is nothing to diff and nothing wrong.
const isGitRepo = tryGit('rev-parse --is-inside-work-tree') === 'true';

describe('?v= bumped-on-change', () => {
  it('requires ?v= to be bumped when a js/ or css/ file changes', (ctx) => {
    if (!baseRef) {
      // Skip VISIBLY — ctx.skip() surfaces in the run summary, where a
      // console.warn does not. The whole point of this file is that a check
      // which quietly verifies nothing is worse than no check at all, so it
      // must not be possible for this to read as a pass.
      if (!isGitRepo) ctx.skip('not a git repository: nothing to diff against');
      if (isShallow) ctx.skip('shallow clone: no merge-base with origin/main');
      expect(
        baseRef,
        'Could not resolve `git merge-base HEAD origin/main`. Run `git fetch origin main` — ' +
        'this guard cannot verify anything without it.',
      ).not.toBeNull();
      return;
    }

    const assets = filesAt(baseRef, isVersionedAsset);
    expect(assets.length, 'No versioned js/css files found at the base commit.').toBeGreaterThan(10);

    const baseVersions = scanVersionMap((f) => readAtRef(baseRef, f), filesAt(baseRef, isScanTarget));
    const currentVersions = scanVersionMap(readWorking);

    const failures = [];
    const untracked = [];

    for (const file of assets) {
      const current = readWorking(file);
      const base = readAtRef(baseRef, file);
      if (current === null || base === null) continue; // added or deleted — nothing to compare

      // Compare with version query strings stripped, so a file whose only change
      // is its own bumped import specifiers does not trigger on itself.
      if (current.replace(/\?v=\d+/g, '') === base.replace(/\?v=\d+/g, '')) continue;

      const baseVer = baseVersions.get(file);
      const curVer = currentVersions.get(file);

      if (baseVer === undefined && curVer === undefined) {
        untracked.push(file);
      } else if (baseVer !== undefined && curVer === baseVer) {
        failures.push(
          `${file} changed since ${baseRef.slice(0, 7)} but is still ?v=${curVer} — bump it in ` +
          'the HTML tag, every cross-module import specifier, dev/sw.js SHELL_ASSETS, ' +
          'and the SW CACHE name.',
        );
      }
    }

    if (untracked.length) {
      console.log(`[changed but carries no ?v= reference]\n  ${untracked.join('\n  ')}`);
    }

    expect(failures, `\n${failures.join('\n')}\n`).toEqual([]);
  // This check reads every versioned asset at the base ref through its own
  // `git show`, so it spends its time in dozens of subprocesses rather than in
  // JS. Vitest's 5s default was never a budget chosen for that: it holds when
  // the file runs alone (~2.5s) and blows when the full suite runs it alongside
  // a hundred others competing for the same CPU, which reads as a flaky guard
  // and trains people to re-run instead of look. The number is deliberate — if
  // this ever genuinely takes 30s, the batching is the thing to fix.
  }, 30000);
});
