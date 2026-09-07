// src/shared/podcast.js — the validators, on their own.
//
// Everything here is about what happens when a fork owner types something
// slightly wrong into site.config.js. The rule throughout is that a malformed
// value falls to the SAFE side, and for a submission-gating field the safe side
// is ABSENT — because an invalid category is rejected by Apple exactly as a
// missing one is, only silently, which leaves the console's readiness card
// telling the owner everything is fine.
import { describe, it, expect } from 'vitest';
import {
  PODCAST_CATEGORIES, PODCAST_BLOCKERS, DEFAULT_LANGUAGE, DEFAULT_TYPE,
  podcastSettings, podcastReadiness, podcastSubmittable,
  categoryTag, ownerTag, podcastNamespaceTags, artworkHref,
} from '../src/shared/podcast.js';

const full = {
  category: 'Science', subcategory: 'Nature',
  owner: { name: 'A Person', email: 'show@example.org' },
  image: '/cover.png', copyright: '(c) 2026', locked: true,
  funding: { url: 'https://example.org/give', label: 'Give' },
  language: 'fr', type: 'serial', explicit: true,
};

describe('the category taxonomy', () => {
  it('is Apple\'s list, spelled the way Apple matches it', () => {
    // ⚠️ These strings are the WIRE FORMAT, not labels: Apple matches them
    // literally, ampersands and all. Re-casing one silently invalidates it.
    expect(PODCAST_CATEGORIES['Health & Fitness']).toContain('Mental Health');
    expect(PODCAST_CATEGORIES['TV & Film']).toContain('Film Reviews');
    expect(Object.keys(PODCAST_CATEGORIES)).toContain('Society & Culture');
    // The four with no sub-categories of their own are still categories.
    expect(PODCAST_CATEGORIES.Technology).toEqual([]);
  });

  it('drops a category that is not in the taxonomy', () => {
    // "Photography" is a plausible thing to type on a photographer's site and
    // is not one of Apple's categories.
    expect(podcastSettings({ category: 'Photography' }).category).toBe('');
  });

  it('drops a sub-category that does not belong to its parent', () => {
    const p = podcastSettings({ category: 'Arts', subcategory: 'Astronomy' });
    expect(p.category).toBe('Arts');      // the parent still stands
    expect(p.subcategory).toBe('');
  });

  it('emits a bare category tag when there is no sub-category', () => {
    expect(categoryTag(podcastSettings({ category: 'History' })))
      .toContain('<itunes:category text="History"/>');
  });

  it('escapes the ampersand rather than breaking the document', () => {
    expect(categoryTag(podcastSettings({ category: 'Kids & Family' })))
      .toContain('text="Kids &amp; Family"');
  });
});

describe('the owner block', () => {
  it('drops a malformed address instead of shipping it', () => {
    for (const email of ['not-an-email', 'a b@example.org', 'x@example', '', null]) {
      expect(podcastSettings({ owner: { email } }).ownerEmail).toBe('');
    }
  });

  it('drops the name too when there is no address to attach it to', () => {
    // <itunes:owner> carrying a name and no email is exactly the block Apple
    // rejects, so half of it is worse than none of it.
    const p = podcastSettings({ owner: { name: 'A Person' } });
    expect(p.ownerName).toBe('');
    expect(ownerTag(p)).toBe('');
  });

  it('emits name and address together when both are good', () => {
    const tag = ownerTag(podcastSettings(full));
    expect(tag).toContain('<itunes:name>A Person</itunes:name>');
    expect(tag).toContain('<itunes:email>show@example.org</itunes:email>');
  });
});

describe('the podcast: namespace tags', () => {
  it('does not emit podcast:locked without an owner address to lock it to', () => {
    // The tag is a claim ADDRESSED to that mailbox — a platform is told to
    // write there for permission. With no address there is nobody to ask.
    const p = podcastSettings({ locked: true });
    expect(p.locked).toBe(null);
    expect(podcastNamespaceTags(p)).toEqual([]);
  });

  it('emits locked=no as a real statement when it is explicitly false', () => {
    const p = podcastSettings({ owner: { email: 'a@b.co' }, locked: false });
    expect(podcastNamespaceTags(p)[0]).toContain('>no</podcast:locked>');
  });

  it('says nothing at all when locked was never mentioned', () => {
    // ⚠️ `<podcast:locked>no</…>` means "any platform may import this show",
    // which an instance that never mentioned it has not said. This is why the
    // config default is null rather than false.
    const p = podcastSettings({ owner: { email: 'a@b.co' } });
    expect(p.locked).toBe(null);
    expect(podcastNamespaceTags(p)).toEqual([]);
  });

  it('refuses a funding URL that is not http(s)', () => {
    // This lands in a document other people's software fetches and renders.
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '/support', 'ftp://x.co']) {
      expect(podcastSettings({ funding: { url } }).fundingUrl).toBe('');
    }
  });

  it('gives a funding link a label when none was written', () => {
    const p = podcastSettings({ funding: { url: 'https://example.org/give' } });
    expect(podcastNamespaceTags(p)[0]).toContain('>Support the show<');
  });
});

describe('tier 1 — a default that is a true statement', () => {
  it('falls back to en / episodic / not explicit on an empty block', () => {
    const p = podcastSettings({});
    expect(p.language).toBe(DEFAULT_LANGUAGE);
    expect(p.type).toBe(DEFAULT_TYPE);
    expect(p.explicit).toBe(false);
  });

  it('accepts a BCP-47 tag and rejects a malformed one', () => {
    expect(podcastSettings({ language: 'pt-BR' }).language).toBe('pt-BR');
    expect(podcastSettings({ language: 'Portuguese' }).language).toBe(DEFAULT_LANGUAGE);
    expect(podcastSettings({ language: 'en_US' }).language).toBe(DEFAULT_LANGUAGE);
  });

  it('rejects a show type it does not understand', () => {
    expect(podcastSettings({ type: 'weekly' }).type).toBe(DEFAULT_TYPE);
  });

  it('treats anything but true as not explicit', () => {
    expect(podcastSettings({ explicit: 'yes' }).explicit).toBe(false);
  });
});

describe('readiness — what the console card is told', () => {
  it('reports booleans only, so no value can travel over a public endpoint', () => {
    // ⚠️ GET /api/site/settings is public and unauthenticated. The owner email
    // is a real person's address that appears nowhere on the rendered site.
    const r = podcastReadiness(full);
    for (const v of Object.values(r)) expect(typeof v).toBe('boolean');
    expect(JSON.stringify(r)).not.toContain('example.org');
    expect(JSON.stringify(r)).not.toContain('A Person');
  });

  it('is not submittable until all four blockers are satisfied', () => {
    expect(podcastSubmittable(podcastReadiness({}))).toBe(false);
    expect(podcastSubmittable(podcastReadiness(full))).toBe(true);
  });

  it('counts a disabled /listen page as a blocker', () => {
    // Every item's <link> and <guid> is /listen/?a=<slug>: with that page off
    // the feed keeps serving happily and every episode 404s in every
    // subscriber's app. It is the one blocker invisible in the feed itself.
    const r = podcastReadiness(full, false);
    expect(r.listenPage).toBe(false);
    expect(podcastSubmittable(r)).toBe(false);
  });

  it('names exactly the fields a directory refuses a show without', () => {
    expect([...PODCAST_BLOCKERS].sort())
      .toEqual(['hasArtwork', 'hasCategory', 'hasOwnerEmail', 'listenPage']);
  });
});

describe('a config block that is not a config block', () => {
  it('survives null, a string and an array without throwing', () => {
    for (const junk of [null, undefined, 'podcast', ['Arts'], 42]) {
      const p = podcastSettings(junk);
      expect(p.category).toBe('');
      expect(p.language).toBe(DEFAULT_LANGUAGE);
    }
  });

  it('returns no artwork href when there is no artwork', () => {
    expect(artworkHref(podcastSettings({}), 'https://example.com')).toBe('');
  });
});
