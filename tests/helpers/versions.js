import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const VERSION_RE = /['"(=]([./]*(?:js|css)\/[\w/-]+\.(?:js|css))\?v=(\d+)/g;
export const RELATIVE_IMPORT_RE = /from\s+['"]\.\/([\w/-]+\.js)\?v=(\d+)['"]/g;

// `.claude` holds git worktrees (other sessions' checkouts, each with its own
// `?v=` state) — walking into them reports another branch's versions as this
// one's and fails the guard on a clean tree.
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', '.wrangler']);

function walk(dir, ext, root, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, root, out);
    else if (name.endsWith(ext)) out.push(relative(root, p).replace(/\\/g, '/'));
  }
  return out;
}

/**
 * Scans files (HTML, JS, dev/sw.js) to extract a map of asset versions.
 * @param {Function} getFileContent - Function taking relative path string and returning file content string (or null if missing).
 * @param {Array<string>} [scanFilesList] - Optional explicit list of relative file paths to scan.
 * @returns {Map<string, Map<string, Array<string>>>} Map of asset path -> Map(versionString -> Array of files where seen)
 */
export function scanVersions(getFileContent, scanFilesList) {
  if (!scanFilesList) {
    const root = join(import.meta.dirname, '../..');
    const htmlFiles = walk(root, '.html', root);
    const jsFiles = walk(join(root, 'js'), '.js', root);
    scanFilesList = [...htmlFiles, ...jsFiles, 'dev/sw.js'];
  }

  const seen = new Map();
  const record = (base, version, file) => {
    const byVersion = seen.get(base) || new Map();
    const where = byVersion.get(version) || [];
    where.push(file);
    byVersion.set(version, where);
    seen.set(base, byVersion);
  };

  for (const file of scanFilesList) {
    const text = getFileContent(file);
    if (!text) continue;

    for (const m of text.matchAll(VERSION_RE)) {
      record(m[1].replace(/^[./]+/, ''), m[2], file);
    }
    if (file.startsWith('js/')) {
      const dir = file.slice(0, file.lastIndexOf('/'));
      for (const m of text.matchAll(RELATIVE_IMPORT_RE)) {
        record(`${dir}/${m[1]}`, m[2], file);
      }
    }
  }

  return seen;
}

/**
 * Helper returning a flat Map of asset path -> version string (e.g. 'css/main.css' -> '21').
 */
export function scanVersionMap(getFileContent, scanFilesList) {
  const seen = scanVersions(getFileContent, scanFilesList);
  const map = new Map();
  for (const [base, byVersion] of seen.entries()) {
    const version = [...byVersion.keys()][0];
    if (version !== undefined) {
      map.set(base, version);
    }
  }
  return map;
}
