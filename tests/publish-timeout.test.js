// @vitest-environment happy-dom
//
// A publish that runs out of time must SAY so (2026-10-14).
//
// The owner's iPad gave up on three publishes in a row on weak Wi-Fi; the log
// read "✕ Fetch is aborted" and the toast "Publish failed: Fetch is aborted".
// That is WebKit's own wording: when a fetch's signal is aborted by
// AbortSignal.timeout(), Safari rejects with a plain AbortError instead of the
// signal's TimeoutError reason. console-api.js treated every AbortError as the
// caller's cancel and passed it straight through, so a timeout skipped the
// "did not confirm — check GitHub before re-publishing" branch the publish
// flow keeps for exactly this, and an idempotent read that timed out was
// never retried. Held here: only the caller's own signal makes a cancel.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// A fetch that hangs until its signal fires, then rejects the way `style` does.
function hangingFetch(style) {
  vi.stubGlobal('fetch', (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      if (style === 'webkit') reject(new DOMException('Fetch is aborted', 'AbortError'));
      else reject(init.signal.reason);   // Chromium/Firefox: the signal's own reason
    }, { once: true });
  }));
}

let api;
beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="sys-lamp"></div><div id="toast-zone"></div>';
  api = await import('../js/console-api.js');
  api.API_TIMEOUTS.commit = 20;
  api.API_TIMEOUTS.upload = 20;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a deadline is a timeout in every engine', () => {
  it.each(['webkit', 'chromium'])('%s: a publish past its deadline is a status-0 "timed out", not an AbortError', async (style) => {
    hangingFetch(style);
    const err = await api.publishFiles([{ path: 'data/posts.json', content: '[]' }], 'sha').catch((e) => e);
    expect(err).toBeInstanceOf(api.ApiError);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/^timed out after \d+s$/);
  });

  it('the caller\'s own cancel is still an AbortError (the upload SKIP)', async () => {
    api.API_TIMEOUTS.upload = 60000;
    hangingFetch('webkit');
    const ac = new AbortController();
    const p = api.uploadFiles([new File(['x'], 'a.jpg')], { signal: ac.signal }).catch((e) => e);
    ac.abort();
    const err = await p;
    expect(err.name).toBe('AbortError');
  });

  it('an abort nobody asked for is a network failure, not a cancel', async () => {
    api.API_TIMEOUTS.commit = 60000;
    vi.stubGlobal('fetch', async () => { throw new DOMException('Fetch is aborted', 'AbortError'); });
    const err = await api.publishFiles([{ path: 'data/posts.json', content: '[]' }], 'sha').catch((e) => e);
    expect(err).toBeInstanceOf(api.ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/cut off/);
  });
});

describe('the publish flow answers a status-0 failure with "check GitHub", not "failed"', () => {
  it('keeps the did-not-confirm branch ahead of the generic one', () => {
    const pub = readFileSync(join(ROOT, 'js/console/publish.js'), 'utf8');
    const confirm = pub.indexOf('if (err.status === 0) {');
    const generic = pub.indexOf('toast(`⚠ Publish failed: ${err.message}');
    expect(confirm).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(confirm);
    expect(pub.slice(confirm, generic)).toMatch(/the commit did NOT confirm/);
  });

  it('a commit waits longer than an ordinary read', async () => {
    vi.resetModules();
    const fresh = await import('../js/console-api.js');
    expect(fresh.API_TIMEOUTS.commit).toBeGreaterThan(fresh.API_TIMEOUTS.json);
  });
});
