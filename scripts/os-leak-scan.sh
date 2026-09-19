#!/usr/bin/env bash
# os-leak-scan.sh — pre-publish audit for the open-source extraction.
#
# Run this against the *extracted* oaklens-os tree (or this repo, to see what an
# extraction would need to strip) before flipping a repo public. It flags:
#   1. Secret-shaped strings   (PATs, AWS keys, private keys, bcrypt hashes)
#   2. Real Cloudflare resource IDs in wrangler.jsonc (should be YOUR_* examples)
#   3. Instance identity        (real email, personal name, CDN domain, private
#                                repo/user slugs) — the things that must not ship
#                                in a generic engine
#   4. Local git credentials    (a token pasted into .git/config) — not a *commit*
#                                leak, but readable by anything pointed at the
#                                working copy, agents included
#
# Exit 0 = clean, exit 1 = something to review. This is a checklist you can run,
# not a guarantee — read the hits, don't just trust the exit code.
#
# A fork edits the INSTANCE IDENTITY list below to its own values.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# ---- what counts as an instance-identity leak (edit per instance) ----
IDENTITY_PATTERNS=(
  # EDIT THESE to your own values before you publish anything.
  # Each entry is a regex; prefix with '-i:' to match case-insensitively.
  # These are examples of the SHAPES that matter — an empty list means this
  # section checks nothing at all.
  #   'you@example\.com'      # your real contact email
  #   'cdn\.example\.com'    # your CDN domain
  #   '\bYourUserName\b'     # your GitHub owner / user slug
  #   '\bYourName\b'         # your personal name
  #   '-i:yourbrand'          # your wordmark, in any casing
  #   '-i:yourbrand *<'       # ...and split by the markup that styles it
  #   '-i:yourcity'           # anywhere your location is baked into markup
)
# Files where a reference to the live instance is intentional and allowed.
ALLOWLIST_FILES=(
  'README.md'
  # The fork's README in source form: os-extract.mjs writes this file out as
  # the fork's README.md verbatim, so it earns README.md's exemption above one
  # step upstream.
  'docs/fork-readme.md'
  # This file necessarily spells out every pattern it hunts for. Exempt by path,
  # which is also why scripts/os-extract.mjs runs its verification copy AT this
  # path rather than beside it.
  'scripts/os-leak-scan.sh'
  # This scan's own tests construct the very strings it hunts for.
  'tests/leak-scan.test.js'
  # Upstream attribution, which travels with the engine and should: the MIT
  # copyright holder and the npm package author are the project's author, not
  # the fork's owner.
  'LICENSE'
  'package.json'
)
# Files allowed to contain a resource-ID-SHAPED string (section 2 only). Kept
# separate from ALLOWLIST_FILES on purpose: a test fixture may legitimately
# carry a fake 32-hex id, and that is no reason to stop checking the same file
# for a real email or the wordmark.
ID_ALLOWLIST_FILES=(
  # Feeds setup.sh's config parser a synthetic namespace id to parse.
  'tests/setup-script.test.js'
  # The one file whose whole job is to hold this instance's resource IDs.
  # Added 2026-08-07, after building the demo's real deploy tree and watching
  # this gate fail it: the extractor adds the scan as a CI step to every fork,
  # `setup.sh` writes real KV/D1 IDs here (a Worker cannot deploy without
  # them), so EVERY fork that followed the documented path got permanently red
  # CI on its first push — for doing exactly what setup.md says. It stayed
  # hidden because `os-extract --verify` runs the scan against a *freshly
  # extracted* tree, where this file is still the all-YOUR_* example and
  # passes.
  #
  # Nothing meaningful is given up. These IDs are not secrets
  # (wrangler.example.jsonc says so in its own header) — they are account-
  # scoped names, useless without credentials. The public engine repo's copy
  # of this file is the placeholder example *by construction*: os-extract.mjs
  # installs wrangler.example.jsonc AS wrangler.jsonc on every extraction, so
  # the scan was never what kept it clean. And the leak this section exists to
  # catch (G1) was a resource name in CLAUDE.md — a *markdown* file; the
  # whole-tree check that catches that class stays exactly as it was for all
  # 228 other files.
  'wrangler.jsonc'
)

# ---- secret-shaped patterns (never legitimate in a public tree) ----
SECRET_PATTERNS=(
  'github_pat_[A-Za-z0-9_]{20,}'          # fine-grained GitHub PAT
  'ghp_[A-Za-z0-9]{30,}'                  # classic GitHub PAT
  'AKIA[0-9A-Z]{16}'                      # AWS access key id
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'    # private key block
  '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}' # bcrypt hash
  '[a-z_]+@127\.0\.0\.1:[0-9]+'           # session-local proxy URL (tool residue,
                                          # e.g. a rewritten package.json repository.url)
)

EXCLUDES=(':!.git' ':!node_modules' ':!dist' ':!.wrangler'
          ':!package-lock.json' ':!fonts' ':!*.woff2' ':!*.webp'
          ':!*.png' ':!*.jpg' ':!*.mp4')

hits=0

# git grep is fast and honours .gitignore, but it FAILS OUTRIGHT outside a git
# repository — and because every call here tolerates failure, that failure read
# as "nothing found". A freshly extracted engine tree has no .git yet, which is
# exactly when this scan matters most, so it was handing back a clean bill of
# health on a tree it had never looked at.
#
# So: git grep inside a repo, plain grep outside one. Same patterns, same
# exclusions, same output shape.
IN_GIT_REPO=0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && IN_GIT_REPO=1
[ "$IN_GIT_REPO" = "0" ] && printf '\033[33mNote: not a git repository — scanning the working tree directly.\033[0m\n'

# Plain-grep equivalents of EXCLUDES above.
GREP_EXCLUDES=(
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist
  --exclude-dir=.wrangler --exclude-dir=fonts
  --exclude=package-lock.json
  --exclude=*.woff2 --exclude=*.webp --exclude=*.png --exclude=*.jpg --exclude=*.mp4
)

# search REGEX [extra flags] -> "path:line:text" lines, or nothing.
#
# The `'.'` pathspec is load-bearing. Without a positive pathspec first, git
# grep validates the negative ones on their own and aborts —
#   fatal: :!dist: no such path in the working tree
# — for any exclusion that does not exist here (dist/ and .wrangler/ usually
# do not). Every call site tolerates failure, so that fatal came back as "no
# matches": the scan reported clean without having searched. This is how the
# secret-shaped-strings section came to be silently dead.
search() {
  local re="$1"; shift
  if [ "$IN_GIT_REPO" = "1" ]; then
    git grep -nIE "$@" -e "$re" -- '.' "${EXCLUDES[@]}" 2>/dev/null || true
  else
    grep -rnIE "$@" "${GREP_EXCLUDES[@]}" -e "$re" . 2>/dev/null | sed 's|^\./||' || true
  fi
}

scan() { # scan "label" "regex" [extra grep args...]
  local label="$1" re="$2"; shift 2
  local out
  out="$(search "$re" "$@")"
  if [ -n "$out" ]; then
    printf '\n\033[31m● %s\033[0m\n' "$label"
    printf '%s\n' "$out" | sed 's/^/    /'
    hits=$((hits + $(printf '%s\n' "$out" | grep -c .)))
  fi
}

allow_re="$(IFS='|'; echo "${ALLOWLIST_FILES[*]}")"

echo "OAKLENS OS — open-source leak scan"

echo; echo "1. Secret-shaped strings"
for re in "${SECRET_PATTERNS[@]}"; do scan "secret: $re" "$re"; done

echo; echo "2. Real resource IDs (anywhere in the tree)"
# Scoped to wrangler.jsonc until 2026-08-07, which meant a resource ID pasted
# into a doc, a script or a comment was invisible here — and the identity
# section could not see it either unless someone had thought to add that exact
# string. A Cloudflare KV/D1 ID is a distinctive shape; look for the shape,
# everywhere, instead of trusting one filename.
id_re='"(id|database_id|preview_id|account_id)": *"[0-9a-f]{16,}[0-9a-f-]*"'
id_allow_re="$(IFS='|'; echo "${ID_ALLOWLIST_FILES[*]}")"
id_out="$(search "$id_re" | grep -vE "^($allow_re|$id_allow_re):" || true)"
if [ -n "$id_out" ]; then
  printf '\033[31m● real Cloudflare resource IDs — ship the YOUR_* examples instead\033[0m\n'
  printf '%s\n' "$id_out" | sed 's/^/    /'
  hits=$((hits + $(printf '%s\n' "$id_out" | grep -c .)))
fi

echo; echo "3. Instance identity (allowlisted files excluded)"
# The `[@]+` guard matters: the fork ships this array EMPTY (comments only,
# see os-extract.mjs), and macOS's default bash 3.2 treats an empty-array
# expansion under `set -u` as a fatal unbound variable — Linux bash does not,
# which is how a scan that crashed on every Mac clone stayed green in CI.
for entry in ${IDENTITY_PATTERNS[@]+"${IDENTITY_PATTERNS[@]}"}; do
  # An entry may carry grep flags as a `-i:` style prefix — the wordmark checks
  # need case-insensitivity, the personal-name check must NOT have it (or every
  # "nick" inside an unrelated word fires).
  flags=()
  re="$entry"
  if [[ "$entry" == -*:* ]]; then
    flags=("${entry%%:*}")
    re="${entry#*:}"
  fi
  out="$(search "$re" "${flags[@]+"${flags[@]}"}" | grep -vE "^($allow_re):" || true)"
  if [ -n "$out" ]; then
    printf '\n\033[31m● identity: %s\033[0m\n' "$re"
    printf '%s\n' "$out" | sed 's/^/    /'
    hits=$((hits + $(printf '%s\n' "$out" | grep -c .)))
  fi
done

# LOCAL FILESYSTEM PATHS. Added 2026-09-16, after a committed npm debug log
# (`.npm/_logs/…`) was found being SERVED on the live origin with the owner's
# home directory in it four times. Nothing above could see it: the identity
# patterns are values (an email, the wordmark, a bucket name), and a home path
# is a SHAPE — `\bNick\b` does not even match the `inick` in that log, because
# both sides of it are word characters.
#
# This is its own check rather than another IDENTITY_PATTERNS entry because it
# is not instance identity: a fork leaking ITS owner's home path is the same
# defect, and the pattern that catches it is the same pattern. So this one does
# NOT get edited per instance — it travels as-is.
#
# No per-file exemption for the known-benign hits, deliberately. Against THIS
# repo it fires on the `/Users/you` placeholder in `js/page-preflight.js` and on
# paths quoted inside `docs/maintenance/` — and BOTH are stripped at extraction
# (os-extract.mjs EXCLUDEs the preflight module and the whole of docs/), so the
# fork CI this gate actually guards never sees either. Adding them to
# ALLOWLIST_FILES would exempt those files from EVERY identity check, which is
# far too much given away to silence a handful of lines that cannot reach a fork.
#
# The trailing slash is NOT required by the pattern. `verbose cwd /Users/someone`
# with nothing after it is exactly the shape an npm log writes, and requiring a
# slash silently missed it in the first draft of this check.
# Filtered through ALLOWLIST_FILES by hand rather than via scan(), which does
# not apply it — this file spells the pattern out in its own comments, and
# `README.md` and the fork readme are allowed to talk about paths.
path_out="$(search '/(Users|home)/[A-Za-z0-9_.-]+' | grep -vE "^($allow_re):" || true)"
if [ -n "$path_out" ]; then
  printf '\n\033[31m● local filesystem path — a home directory in a tracked file\033[0m\n'
  printf '%s\n' "$path_out" | sed 's/^/    /'
  hits=$((hits + $(printf '%s\n' "$path_out" | grep -c .)))
fi

echo; echo "4. Local git credentials (.git/config)"
# .git/config is never committed, so this can't leak *through* a push — but it
# sits in plaintext in every working copy, and anything with read access to the
# tree (a coding agent, a backup, a screen share) can read it. A token pasted
# into a remote URL is the common way this happens: `git remote set-url origin
# https://<token>@github.com/...` works, so people do it, and then forget.
#
# Fingerprints only — this scan must never print a live secret. Compare the
# fingerprint against your password manager to identify which token it is.
cred_hits=0
TOKEN_RE='gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}'
USERPASS_RE='://[^/@]+:[^/@]+@'

# Secret → comparable fingerprint. Enough to match against a password manager
# entry, not enough to use.
redact() { sed -E 's/^(.{7}).{4,}(.{4})$/\1…\2/'; }
# Config KEYS can carry the secret too — `url.https://<token>@github.com/.insteadOf`
# puts it in the key and leaves the value innocent. Anything echoed goes through
# this first, or the scan leaks the very thing it is reporting.
scrub() { sed -E "s#(gh[pousr]_|github_pat_)[A-Za-z0-9_]+#\1<redacted>#g; s#$USERPASS_RE#://<redacted>@#g"; }
cred_flag() { printf '\n\033[31m● %s\033[0m\n' "$1"; cred_hits=$((cred_hits+1)); }

while IFS= read -r line; do
  key="${line%%=*}"
  safe_key="$(printf '%s' "$key" | scrub)"
  case "$key" in
    remote.*.url|url.*.insteadof)
      # Scan the whole line: the credential may sit in either half.
      tok="$(printf '%s' "$line" | grep -oE "$TOKEN_RE" | head -1 || true)"
      if [ -n "$tok" ]; then
        cred_flag "$safe_key embeds a GitHub token — $(printf '%s' "$tok" | redact)"
        # Which KIND matters, and not just for pedantry. The two types live on
        # two different settings pages, so "I rotated my token" can be true and
        # still leave this one live — that is exactly how one got missed here.
        case "$tok" in
          github_pat_*)
            echo "    Fine-grained token — limited to the repositories it names."
            echo "    Revoke: https://github.com/settings/personal-access-tokens"
            ;;
          *)
            echo "    CLASSIC token — scoped by permission, NOT by repository. Pushing to a"
            echo "    private repo requires 'repo' scope, which grants read/write to every"
            echo "    private repo on the account. Assume the blast radius is the whole account."
            echo "    Revoke: https://github.com/settings/tokens"
            ;;
        esac
        echo "    These are two SEPARATE pages — rotating one does not touch the other."
        echo "    Then drop the credential from the URL:"
        echo "      git remote set-url origin https://github.com/OWNER/REPO.git"
      elif printf '%s' "$line" | grep -qE "$USERPASS_RE"; then
        cred_flag "$safe_key embeds a password or token in the URL"
        echo "    Move it to a credential helper: git config --global credential.helper <helper>"
      fi
      ;;
    http.*extraheader)
      cred_flag "$safe_key is set — a baked-in Authorization header (usually CI residue)"
      echo "    Clear it: git config --local --unset-all '$safe_key'"
      ;;
  esac
done < <(git config --local --list 2>/dev/null || true)

echo
total=$((hits + cred_hits))
if [ "$total" -eq 0 ]; then
  printf '\033[32mClean — no leaks found.\033[0m\n'
  exit 0
fi
if [ "$hits" -gt 0 ]; then
  printf '\033[31mFound %d line(s) to review before publishing.\033[0m\n' "$hits"
  echo "(Against the live instance repo, hits in site.config.js / wrangler.jsonc are"
  echo " expected — those are exactly the files you replace with examples on extract.)"
fi
if [ "$cred_hits" -gt 0 ]; then
  printf '\033[31mFound %d local credential issue(s) in .git/config — revoke, then re-point the remote.\033[0m\n' "$cred_hits"
fi
exit 1
