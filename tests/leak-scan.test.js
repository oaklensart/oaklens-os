// scripts/os-leak-scan.sh §4 — local git credentials.
//
// .git/config never gets committed, so a token pasted into a remote URL can't
// leak through a push. It leaks the other way: it sits in plaintext in the
// working copy, where any tool pointed at the tree can read it — which is
// exactly how one surfaced in a chat transcript.
//
// Two properties matter enough to pin:
//   1. It fires on the shapes that actually carry credentials.
//   2. It NEVER prints the secret itself. A leak scan that echoes the token
//      into a terminal (and from there into scrollback, CI logs, or a
//      transcript) has re-committed the original sin. Fingerprint only.
//
// The script does `cd "$(dirname "$0")/.."`, so these tests copy it into a
// throwaway git repo and run it there — that repo's .git/config becomes the
// thing under test, with no reliance on the developer's real config.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'os-leak-scan.sh');

// Built by concatenation on purpose: a literal token-shaped string in a tracked
// file would be flagged by the scan's own §1 secret patterns.
const FAKE_PAT = 'ghp_' + 'A'.repeat(36);
const FAKE_FINE = 'github_pat_' + 'B'.repeat(40);
// Same reason: a literal proxy credential or PEM header in a tracked file is
// itself a §1 hit. (Both of these WERE literals until 2026-08-04 — they never
// fired because §1 was silently dead, which is exactly the bug below.)
const FAKE_PROXY_CRED = 'local_proxy@127.0.0.1' + ':' + '41729';
const FAKE_KEY_HEADER = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';

let dir;

const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

function runScan() {
  try {
    return { code: 0, out: execFileSync('bash', [join(dir, 'scripts', 'os-leak-scan.sh')], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oaklens-leakscan-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'scripts', 'os-leak-scan.sh'));
  writeFileSync(join(dir, 'readme.md'), 'nothing to see here\n');
  git('init', '-q', '.');
  git('add', '-A');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a clean working copy', () => {
  it('exits 0 and says so', () => {
    git('remote', 'add', 'origin', 'https://github.com/example/example.git');
    const { code, out } = runScan();
    expect(code).toBe(0);
    expect(out).toContain('Clean — no leaks found.');
  });

  it('does not flag userinfo without a secret (the local-proxy remote shape)', () => {
    // Sandboxed agent environments rewrite the remote to `user@127.0.0.1:PORT`
    // with no password. Flagging that would cry wolf on every session, which is
    // how a check earns its way onto the ignore list.
    git('remote', 'add', 'origin', `http://${FAKE_PROXY_CRED}/git/example/example`);
    const { code, out } = runScan();
    expect(code).toBe(0);
    expect(out).not.toContain('remote.origin.url embeds');
  });

  // os-extract.mjs ships the fork a comments-only (EMPTY) IDENTITY_PATTERNS
  // array to fill in — and macOS's default bash is 3.2, where expanding an
  // empty array under `set -u` is a fatal "unbound variable". Found 2026-08-07:
  // the extracted tree's whole leak-scan suite was red on a Mac clone while
  // Linux CI (bash 5, where empty expansion is fine) stayed green. Reproduce
  // the extractor's blanking here so the instance suite fails on the OS that
  // actually breaks, instead of only inside a fork nobody tests on a Mac.
  it("survives the fork's blanked identity list on macOS bash 3.2", () => {
    const p = join(dir, 'scripts', 'os-leak-scan.sh');
    const s = readFileSync(p, 'utf8');
    const a = s.indexOf('IDENTITY_PATTERNS=(');
    const b = s.indexOf('\n)', a);
    expect(a, 'blanking anchor must exist (os-extract.mjs cuts on the same one)').toBeGreaterThan(-1);
    expect(b, 'array close anchor must exist').toBeGreaterThan(a);
    writeFileSync(p, `${s.slice(0, a)}IDENTITY_PATTERNS=(${s.slice(b)}`);
    git('remote', 'add', 'origin', 'https://github.com/example/example.git');
    const { code, out } = runScan();
    expect(out).not.toContain('unbound variable');
    expect(code).toBe(0);
    expect(out).toContain('Clean — no leaks found.');
  });
});

describe('a token in the remote URL', () => {
  it('is flagged, and the full token is never printed', () => {
    git('remote', 'add', 'origin', `https://${FAKE_PAT}@github.com/example/example.git`);
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('remote.origin.url embeds a GitHub token');
    // The load-bearing assertion: fingerprint, not secret.
    expect(out).not.toContain(FAKE_PAT);
    expect(out).toMatch(/ghp_\S*…\S{4}/);
  });

  it('catches fine-grained tokens too', () => {
    git('remote', 'add', 'origin', `https://${FAKE_FINE}@github.com/example/example.git`);
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('embeds a GitHub token');
    expect(out).not.toContain(FAKE_FINE);
  });

  // Classic and fine-grained tokens live on two different GitHub settings pages.
  // Rotating one leaves the other live — which is how a classic push token
  // survived a rotation of the fine-grained Worker secret sitting next to it.
  // The scan has to name the type and point at the matching page.
  it('names a classic token as classic and warns about account-wide scope', () => {
    git('remote', 'add', 'origin', `https://${FAKE_PAT}@github.com/example/example.git`);
    const { out } = runScan();
    expect(out).toContain('CLASSIC token');
    expect(out).toContain('every');
    expect(out).toContain('https://github.com/settings/tokens');
  });

  it('sends a fine-grained token to the other settings page', () => {
    git('remote', 'add', 'origin', `https://${FAKE_FINE}@github.com/example/example.git`);
    const { out } = runScan();
    expect(out).toContain('Fine-grained token');
    expect(out).toContain('https://github.com/settings/personal-access-tokens');
    expect(out).not.toContain('CLASSIC token');
  });

  it('catches a token hidden behind an insteadOf rewrite', () => {
    git('config', '--local', `url.https://${FAKE_PAT}@github.com/.insteadOf`, 'https://github.com/');
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('embeds a GitHub token');
    expect(out).not.toContain(FAKE_PAT);
  });

  it('flags a non-GitHub password in the URL as well', () => {
    git('remote', 'add', 'origin', 'https://someuser:hunter2@git.example.com/example.git');
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('embeds a password or token in the URL');
    expect(out).not.toContain('hunter2');
  });
});

describe('a baked-in Authorization header', () => {
  it('is flagged without echoing the header value', () => {
    git('config', '--local', 'http.extraheader', 'AUTHORIZATION: basic c2VjcmV0dmFsdWU=');
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('baked-in Authorization header');
    expect(out).not.toContain('c2VjcmV0dmFsdWU=');
  });
});

describe('reporting', () => {
  it('counts credential issues separately from publish-blocking leaks', () => {
    git('remote', 'add', 'origin', `https://${FAKE_PAT}@github.com/example/example.git`);
    git('config', '--local', 'http.extraheader', 'AUTHORIZATION: basic c2VjcmV0');
    const { out } = runScan();
    expect(out).toContain('Found 2 local credential issue(s)');
    // No tracked-file leaks in this fixture, so the publish line must stay off.
    expect(out).not.toContain('to review before publishing');
  });
});

// ---------------------------------------------------------------------------
// §1 and §3 actually search — the "silently dead scan" regression
// ---------------------------------------------------------------------------
//
// Found 2026-08-04 while extracting the engine tree. Every search in this
// script tolerates failure (`|| true`), which is correct — a scan should not
// crash a release. But it meant two total failures came back indistinguishable
// from "nothing found", and the scan reported a clean bill of health without
// having read a single file:
//
//   1. `git grep -- <pattern> :!dist` with no positive pathspec first aborts
//      with `fatal: :!dist: no such path in the working tree` for any excluded
//      directory that does not exist locally. dist/ and .wrangler/ usually do
//      not. So §1 had never worked.
//   2. Outside a git repository, `git grep` fails outright — which is the
//      state of a freshly extracted engine tree, i.e. precisely the tree this
//      scan exists to check before it is made public.
//
// A scan that cannot fail is not the same as a scan that passes. These pin
// that it finds a planted secret in both environments.

describe('the scan actually searches (not silently dead)', () => {
  const plant = (name, body) => {
    writeFileSync(join(dir, name), body);
    git('add', '-A');
  };

  it('finds a planted token in a tracked file', () => {
    plant('leaky.js', `const t = '${FAKE_PAT}';\n`);
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('leaky.js');
    expect(out).toContain('to review before publishing');
  });

  it('finds a planted private key', () => {
    plant('key.pem', `${FAKE_KEY_HEADER}\nabc\n`);
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('key.pem');
  });

  it('finds the same token with NO git repository at all', () => {
    // The extracted-tree case. Before the fix this returned a confident pass.
    plant('leaky.js', `const t = '${FAKE_PAT}';\n`);
    rmSync(join(dir, '.git'), { recursive: true, force: true });
    const { code, out } = runScan();
    expect(out).toContain('not a git repository');
    expect(out).toContain('leaky.js');
    expect(code).toBe(1);
  });

  it('is clean on a tree that genuinely has nothing', () => {
    // The other half: it must not cry wolf, or nobody reads it.
    const { code, out } = runScan();
    expect(code).toBe(0);
    expect(out).not.toContain('to review before publishing');
  });
});

// §3, local filesystem paths — the shape, not the value.
//
// Added 2026-09-16 after a committed `.npm/_logs/*.log` was found being SERVED
// on the live origin with the owner's home directory in it four times. Every
// identity pattern above hunts a VALUE (an email, the wordmark, a bucket name),
// and none of them could see it — `\bNick\b` does not even match the `inick`
// in that path, because both neighbours are word characters.
//
// Two properties worth pinning, and the second is the one that was wrong first:
//   1. It fires on a home path in a tracked file, in any file type.
//   2. It does NOT require a trailing slash. `verbose cwd /Users/someone` with
//      nothing after it is exactly what an npm log writes, and the first draft
//      of this check required the slash and sailed straight past it.
describe('§3 local filesystem paths', () => {
  const plant = (name, body) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
    git('add', '-A');
  };

  // Built by concatenation for the same reason as FAKE_PAT above: a literal
  // home path in this tracked file would be flagged by the check it tests.
  const HOME = '/Users' + '/someone';
  const LINUX_HOME = '/home' + '/someone';

  it('flags a home path inside a deeper path — the npm-log shape', () => {
    plant('.npm/_logs/debug.log', `12 verbose cwd ${HOME}/site/.claude/worktrees/x\n`);
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('local filesystem path');
    expect(out).toContain('.npm/_logs/debug.log');
  });

  it('flags a BARE home path with nothing after it', () => {
    // The miss in the first draft: requiring a trailing slash made this pass.
    plant('notes.md', `ran from ${HOME}\n`);
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('local filesystem path');
    expect(out).toContain('notes.md');
  });

  it('flags the Linux spelling too, not just macOS', () => {
    plant('notes.md', `ran from ${LINUX_HOME}/site\n`);
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('local filesystem path');
  });

  it('does not fire on a tree with no home path in it', () => {
    // The other half — this check sits in the section that already reports 400+
    // expected lines against the instance repo, so a false positive here is
    // genuinely costly: it teaches people to skim section 3.
    plant('notes.md', 'a path like ./js/console/audio.js is not a home directory\n');
    const { code, out } = runScan();
    expect(code).toBe(0);
    expect(out).not.toContain('local filesystem path');
  });

  it('respects ALLOWLIST_FILES — the scan must not flag its own comments', () => {
    // scan() does not apply the allowlist, so this check filters by hand. It is
    // easy to "simplify" that back into scan() and have the script report
    // itself on every run, which is how a gate stops being read.
    const { out } = runScan();
    expect(out).not.toMatch(/^ *scripts\/os-leak-scan\.sh:/m);
  });
});

// §2, resource IDs — the gate that has to tell two situations apart:
//
//   a deployed instance's OWN wrangler.jsonc, which must hold real KV/D1 IDs
//   or the Worker cannot deploy at all           -> allowed, silently
//   the same ID pasted into any other file       -> flagged (this is G1, the
//   (a doc, a script, CLAUDE.md)                    leak that started section 2)
//
// Both halves matter. Before 2026-08-07 the first one failed every fork that
// followed setup.md: os-extract adds this scan as a CI step, setup.sh writes
// real IDs into wrangler.jsonc, so the first push to main went red and stayed
// red. It hid because `os-extract --verify` scans a freshly extracted tree,
// where wrangler.jsonc is still the all-YOUR_* example.
describe('§2 resource IDs — a fork may hold its own, and only its own', () => {
  const plant = (name, body) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
    git('add', '-A');
  };
  // Built by concatenation for the same reason as the tokens above.
  const REAL_ID = '4f7351f406a746ae' + 'aeb8e448b9c8fed0';
  const wranglerWithRealIds = `{
  "name": "some-fork",
  "kv_namespaces": [{ "binding": "SUBSCRIBERS", "id": "${REAL_ID}" }]
}
`;

  it('passes a filled-in wrangler.jsonc — the state every deployed fork is in', () => {
    plant('wrangler.jsonc', wranglerWithRealIds);
    const { code, out } = runScan();
    expect(code, 'a fork that ran setup.sh must not have red CI forever').toBe(0);
    expect(out).not.toContain('to review before publishing');
  });

  it('still flags that same ID in any other file', () => {
    plant('docs/notes.md', `the namespace is "id": "${REAL_ID}"\n`);
    const { code, out } = runScan();
    expect(code, 'the G1 class — an ID pasted into prose — must still fire').toBe(1);
    expect(out).toContain('docs/notes.md');
  });

  it('flags an ID in a NEIGHBOURING wrangler file, not just any name with wrangler in it', () => {
    // The allowlist is matched per path; a lookalike must not inherit it.
    plant('wrangler.jsonc.bak', wranglerWithRealIds);
    const { code, out } = runScan();
    expect(code).toBe(1);
    expect(out).toContain('wrangler.jsonc.bak');
  });
});
