// @vitest-environment happy-dom
//
// The console's podcast feed card.
//
// The owner's ask, verbatim: "feed management… a way to get the feed links."
// Until this, the only way to learn your feed was not submittable was a
// rejection email from Apple days later.
//
// One thing here is load-bearing beyond ordinary render behavior: the card's
// checklist DUPLICATES the server's readiness contract. src/shared/podcast.js
// is Worker code and the browser cannot import it, so the copy lives in
// js/console/audio.js — the same duplication the ring card's discipline list
// carries, and the same reason it needs a gate. A flag added on one side and
// not the other is a checklist item that silently never renders, or a key the
// card asks for that the server never sends.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { podcastReadiness } from '../src/shared/podcast.js';

globalThis.refreshStageIndicators = () => {};
globalThis.renderTrash = () => {};
globalThis.fetch = async () => new Response('[]', { status: 200 });

const { STATE } = await import('../js/console-state.js');
const { renderPodcastCard, applyPodcastPosture, feedUrl, renderAudio } =
  await import('../js/console/audio.js');

const ROOT = join(import.meta.dirname, '..');
const AUDIO_SRC = readFileSync(join(ROOT, 'js', 'console', 'audio.js'), 'utf8');

const EPISODE = { id: '1', slug: 'ep-001', filename: 'ep-001.mp3', title: 'One', episode: true };
const DEMO = { id: '2', slug: 'demo', filename: 'demo.mp3', title: 'Demo' };

const READY = {
  hasCategory: true, hasOwnerEmail: true, hasArtwork: true,
  hasCopyright: true, hasFunding: true, hasLocked: true, listenPage: true,
};

const card = () => document.getElementById('audio-feed-card').textContent;
const html = () => document.getElementById('audio-feed-card').innerHTML;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="audio-feed-card"></div>
    <div id="audio-display"></div>
    <div id="toast-host"></div>
  `;
  STATE.audio = [];
  applyPodcastPosture(null);
});

describe('the checklist matches the server contract', () => {
  it('names every readiness flag the endpoint sends, and invents none', () => {
    // The gate. Both halves matter: a server flag with no checklist row is a
    // blocker the owner is never told about, and a checklist row with no
    // server flag renders as permanently unsatisfied.
    const flags = [...AUDIO_SRC.matchAll(/flag:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]).sort();
    expect(flags.length).toBeGreaterThan(3);
    expect(flags).toEqual(Object.keys(podcastReadiness({})).sort());
  });

  it('gives every check a config key and a sentence saying what it unlocks', () => {
    const checks = [...AUDIO_SRC.matchAll(/\{ flag: '[a-zA-Z]+', blocking: (true|false),\s*key: '([^']+)',\s*\n\s*unlocks: '/g)];
    expect(checks.length).toBe(Object.keys(podcastReadiness({})).length);
    // Every key is a real path into site.config.js, not prose.
    for (const m of checks) expect(m[2]).toMatch(/^[a-z]+(\.[a-zA-Z]+)*$/);
  });
});

describe('with nothing marked as an episode', () => {
  it('says the show is empty rather than showing a blocked checklist', () => {
    STATE.audio = [DEMO];
    applyPodcastPosture(READY);
    expect(card()).toContain('No tracks are marked EPISODE yet');
    expect(html()).not.toContain('aud-feed-check');
  });

  it('names the next gesture — and a different one when the shelf is empty', () => {
    STATE.audio = [DEMO];
    renderPodcastCard();
    expect(card()).toContain('Press ○ EPISODE');

    STATE.audio = [];
    renderPodcastCard();
    expect(card()).toContain('Drop a track above');
  });

  it('still shows the feed address — that is what people came for', () => {
    STATE.audio = [];
    renderPodcastCard();
    expect(card()).toContain('/podcast.xml');
    expect(feedUrl().endsWith('/podcast.xml')).toBe(true);
  });
});

describe('with episodes in the feed', () => {
  beforeEach(() => { STATE.audio = [EPISODE, DEMO]; });

  it('counts what a subscriber actually downloads, not the whole shelf', () => {
    applyPodcastPosture(READY);
    expect(card()).toContain('1 of 2 tracks');
  });

  it('says plainly that Apple would reject a feed missing a required field', () => {
    applyPodcastPosture({ ...READY, hasCategory: false });
    expect(card()).toContain('Apple would reject this feed today');
    expect(card()).toContain('podcast.category');
  });

  it('counts the blockers rather than listing them twice', () => {
    applyPodcastPosture({ ...READY, hasCategory: false, hasArtwork: false });
    expect(card()).toContain('2 required');
  });

  it('treats a disabled /listen page as a blocker like any other', () => {
    // Invisible in the feed itself: it keeps serving while every episode 404s
    // in every subscriber's app.
    applyPodcastPosture({ ...READY, listenPage: false });
    expect(card()).toContain('Apple would reject this feed today');
    expect(card()).toContain('pages.listen');
  });

  it('says it is ready once nothing is blocking', () => {
    applyPodcastPosture(READY);
    expect(card()).toContain('Ready to submit');
    expect(card()).not.toContain('would reject');
  });

  it('still lists the optional keys once submission is unblocked', () => {
    // hasCopyright/hasLocked/hasFunding are worth having and never blocking.
    applyPodcastPosture({ ...READY, hasCopyright: false, hasFunding: false, hasLocked: false });
    expect(card()).toContain('Ready to submit');
    expect(card()).toContain('podcast.locked');
  });
});

describe('when the settings read failed', () => {
  it('says what it does not know instead of implying all is well', () => {
    // A failed fetch that renders as a clean bill of health is how an owner
    // submits a feed Apple rejects.
    STATE.audio = [EPISODE];
    applyPodcastPosture(null);
    expect(card()).toContain('could not read this site');
    expect(card()).not.toContain('Ready to submit');
    expect(html()).not.toContain('aud-feed-check');
  });
});

describe('the beta label', () => {
  // Why this is pinned rather than left as copy: the label is the only warning
  // a fork owner gets before they hand this feed to a directory, and the one
  // way it ever comes off is someone telling us what happened. A render branch
  // that quietly drops it puts them back where the checklist found them — one
  // rejection email behind.
  const STATES = [
    ['an empty show',            () => { STATE.audio = [DEMO]; applyPodcastPosture(READY); }],
    ['a settings read that failed', () => { STATE.audio = [EPISODE]; applyPodcastPosture(null); }],
    ['a feed ready to submit',   () => { STATE.audio = [EPISODE]; applyPodcastPosture(READY); }],
  ];

  for (const [name, setup] of STATES) {
    it(`shows the chip and the note with ${name}`, () => {
      setup();
      expect(html()).toContain('aud-feed-beta');
      expect(card()).toContain('BETA');
      expect(card()).toContain('Podcast publishing is in beta');
    });
  }

  it('says where to send a rejection, since that is the only way the label lifts', () => {
    STATE.audio = [EPISODE];
    applyPodcastPosture(READY);
    // The engine's tracker, not this instance's — it travels to every fork.
    expect(html()).toContain('https://github.com/oaklensart/oaklens-os/issues');
  });

  it('scopes the label to the feed, not to the shelf around it', () => {
    // The player, the waveforms, the per-track addresses and the tracklists in
    // posts are not beta. A label that leaks onto the track rows says they are.
    STATE.audio = [EPISODE, DEMO];
    applyPodcastPosture(READY);
    renderAudio();
    expect(document.getElementById('audio-display').innerHTML).not.toContain('BETA');
    expect(card()).toContain('Everything else on this shelf is not beta');
  });
});
