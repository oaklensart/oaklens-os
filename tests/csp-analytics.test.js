// The opt-in Web Analytics widening: site.config.js → webAnalytics: true adds
// Cloudflare's beacon hosts to the policy, and NOTHING else. Isolated in its
// own file because vi.mock is hoisted per-file and tests/csp.test.js needs the
// real (analytics-off) config to prove the shipped default names no
// third-party host at all.
//
// The pairing matters: the default-off assertion is only meaningful if turning
// the flag on demonstrably changes the header, and the flag is only safe if it
// widens by exactly two hosts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../site.config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: Object.freeze({ ...actual.default, webAnalytics: true }) };
});

const { buildCsp } = await import('../src/shared/csp.js');
const { cdnBase } = await import('../src/shared/site.js');

const ORIGIN = 'https://example.com';
const CDN = new URL(cdnBase(ORIGIN)).origin;
const thirdParty = (list) => list.filter((h) => h !== CDN);
const directive = (policy, name) =>
  policy.split('; ').find((d) => d.startsWith(`${name} `)) || '';
const hosts = (policy, name) =>
  directive(policy, name).split(' ').slice(1).filter((s) => /^https?:\/\//.test(s));

describe('site.config.js → webAnalytics: true', () => {
  it('adds the beacon script host to the strict policy', () => {
    expect(hosts(buildCsp(ORIGIN, true), 'script-src'))
      .toEqual(['https://static.cloudflareinsights.com']);
  });

  it('adds the beacon connect host to the strict policy', () => {
    expect(thirdParty(hosts(buildCsp(ORIGIN, true), 'connect-src')))
      .toEqual(['https://cloudflareinsights.com']);
  });

  it('adds exactly the beacon hosts to the relaxed policy — jsDelivr stays, nothing else joins', () => {
    const policy = buildCsp(ORIGIN, false);
    expect(hosts(policy, 'script-src'))
      .toEqual(['https://cdn.jsdelivr.net', 'https://static.cloudflareinsights.com']);
    expect(thirdParty(hosts(policy, 'connect-src')))
      .toEqual(['https://cdn.jsdelivr.net', 'https://cloudflareinsights.com']);
  });

  it('does not weaken the strict policy in any other way', () => {
    const policy = buildCsp(ORIGIN, true);
    expect(directive(policy, 'script-src')).not.toContain('unsafe-inline');
    expect(policy).toContain("object-src 'none'");
  });
});
