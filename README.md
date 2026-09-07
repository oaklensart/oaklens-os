# OAKLENS OS

**Your work. Published free.**

[![CI](https://github.com/oaklensart/oaklens-os/actions/workflows/ci.yml/badge.svg)](https://github.com/oaklensart/oaklens-os/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)

<img width="1448" height="1238" alt="image" src="https://github.com/user-attachments/assets/f12ee42f-55f8-4c47-9dc7-e9400f6fe7c4" />

A digital studio you own: portfolio, blog, audio and storefront on a single
Cloudflare Worker. No framework, no build step, no monthly bill, and no platform
standing between you and the people looking at your work.

You publish from a console in your browser: drop pictures straight off the
camera or phone, put up the track you mixed last night, write the post on the
train, hit publish. The site commits to **your** GitHub repo and rebuilds
itself. Nothing you make lives anywhere you can't reach.

Whatever you make is what it's for. It began as one photographer's site and the
image tools show it — but the writing surface, the audio layer and the feeds are
first-class, not accessories, and nothing here assumes a camera.

**New to this?** Follow the
[interactive install guide](https://os.oaklens.art/install). It walks you
through the whole setup one step at a time, says what each step is for before it
tells you what to type, and remembers where you got to if you close the tab. It
was written for people who don't do this for a living. Start there and you can
ignore everything below.

Prefer to read it all at once? [setup.md](setup.md) is the same ground in
reference form, plus everything about operating the site once it's up.

---

## Engine vs. instance

This repo is the **engine**. A live site is one **configuration** of it.

Identity never lives in code. Everything a fork changes sits in one file,
`site.config.js` (name, tagline, contact, nav, location, theme, CDN base), and
everything else derives from the request origin at runtime. So a fresh fork
works on its free `*.workers.dev` address with zero extra setup, and attaching
your own domain later changes nothing in the code.

## What you get

- **A console built for the field.** Cull, write and publish from a phone or an
  iPad on a café table. Two viewing modes: high-contrast for direct sun, OLED
  black for editing in the dark.
- **Pictures in, web-ready out.** Drop JPEGs or camera RAW files in the browser
  and they're resized, variant-generated and live in seconds. GPS and EXIF are
  stripped on the way out, so your art ships and your location doesn't.
- **Audio that's part of the site, not embedded from one.** Attach a file and
  the console measures its waveform once; every surface then draws bars from
  numbers, and nothing downloads until someone presses play. You get a player on
  the homepage, a permanent address per track, numbered tracklists inside posts,
  and a real RSS 2.0 podcast feed at `/podcast.xml`. No library, no iframe, no
  CSP change. **The podcast half of this is in beta** — the feed is valid RSS and
  the console tells you which fields a directory still wants, but exactly one
  short show has been through a real submission so far. If you point an app at
  your feed or send it to a directory, please
  [say what happened](https://github.com/oaklensart/oaklens-os/issues) — a
  rejection message is worth more to us than a bug report. The rest of the audio
  layer is not beta.
- **Writing that stands on its own.** Field Notes is Markdown with a live
  editor, and a post with no picture in it still gets a homepage card — sized to
  the writing, so a single good line lands like a pull quote instead of rattling
  around in a frame built for something else.
- **Permanent numbers.** Every published image gets a number (`f#234`) and a
  SHA-256 fingerprint at intake. Numbers are never reused or reordered, and
  retiring one leaves a dark placeholder behind, so no link to your work ever
  breaks. Cite a number in a post and the link opens a preview inline — words
  and work stay tied together across years.
- **Survives a bad connection.** Lose signal and your work is held locally, then
  uploads when you're back. Close the tab mid-upload and it pauses rather than
  publishing something half-formed.
- **An escape hatch.** Export the whole site, pages and images and code, as a
  single ZIP that runs from `file://` with no server and no network.
- **Nothing third-party on the public pages.** A fork ships zero third-party
  runtime JavaScript to visitors. Analytics and media embeds exist, but they are
  off by default and each one widens exactly the one thing it needs.

## Quick start

### 1. Get your own copy

**Fork this repo** (button, top right, or *Use this template*), then clone
**your fork**:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO
cd YOUR-REPO
```

> **Why a fork and not a clone of this one.** Your site publishes by *committing
> to your own repo*. You write a post in the console, it saves to GitHub, and
> Cloudflare rebuilds from there. That needs a repo you can push to. Clone this
> one directly and everything works right up until your first Publish, hours
> later. Fork now; it takes five seconds.

### 2. Switch on R2

One click, in your browser, and it has to happen before the next step.

Cloudflare dashboard, then **Storage & databases**, then **R2 Object Storage**,
then **Add R2 subscription to my account**. R2 is where your pictures and audio live,
and it is the only piece here that a new Cloudflare account does not already
have switched on. No command can do it for you.

It asks for a payment method and charges nothing. See
[What it costs](#what-it-costs) below before you get there, so it is not a
surprise. When it is done the R2 page reads `$0.00` billable usage and `0 B`
stored, and there is an **Add Budget Alert** button worth thirty seconds.

### 3. Stand it up

```bash
npm install
npx wrangler login      # sign in to Cloudflare
bash scripts/setup.sh   # creates your storage, deploys, prints your address
bash scripts/doctor.sh  # confirms it all worked
```

That's the whole install. `setup.sh` asks a few questions, creates the
Cloudflare resources for you, puts the site online and tells you its
`.workers.dev` address. `doctor.sh` says in plain English if anything is still
missing, including storage your settings name but your account does not have.

### 4. Make it yours

Open `site.config.js` and fill in every field: your name, your tagline, your
contact address, your city. Then connect the repo to Cloudflare so publishing
goes live on its own. Both are walked through in [setup.md](setup.md).

Then read **[quickstart.md](quickstart.md)** — it picks up the moment your site
answers, and walks you through the settings and console moves you'd otherwise
have to find by clicking around: picking a look, turning pages on, cropping
thumbnails properly, putting your own work on the homepage, and hitting publish.

## What it costs

Nothing, for a normal site. But you do have to put a payment method on
file, and we would rather you heard that here than at step 2.

**Cloudflare asks for a payment method to switch on R2**, the media storage.
Card, Apple Pay, Google Pay, PayPal or bank, plus a billing address. The
checkout says **Due today $0.00** and **$0/month**, and you are agreeing to be
charged only for usage above the free allowance. Nothing else in this install
asks for one, and GitHub hosts your repo free.

So the accurate sentence is "free, but you have to hand over a card number to
prove it." Here is what the allowance actually holds, so the word "free" means
something you can check:

| Free every month | What that is, in this site's terms |
|---|---|
| **10 GB of storage** | An image is stored in three sizes and averages about **350 KB** all in, so roughly **25,000 pictures**. The same 10 GB is about **170 hours of audio** at podcast quality. Writing is free in any practical sense — a post is a few kilobytes. If you also keep full resolution originals in there, think **1,000 to 1,500** instead. |
| **1 million uploads** | Three writes per image, so about **300,000 pictures uploaded per month**. You will not meet this. |
| **10 million reads** | Repeat views are served from Cloudflare's edge cache and cost **zero** reads, so in practice this is hundreds of thousands of page views. |

The limit you would actually meet first is not R2 at all. It is the Worker's
**100,000 requests a day**, which is roughly **2,000 to 3,000 page views a day**
for a media-heavy site, or somewhere around 60,000 to 90,000 a month. That is a
lot of traffic for a portfolio, and if you get there consistently you are having
a good year. Cloudflare's own pricing pages are the source of truth for what
happens past it, not this README.

The honest caveat: free tiers have limits, and R2 storage and Worker requests
are the ones you'd meet first. A personal site with thousands of pictures, or a
few hundred hours of audio, sits well inside them. A site serving serious
traffic will eventually cross into paid
usage, and Cloudflare's own pricing pages are the source of truth there, not
this README.

## Requirements

- A **GitHub account**, free
- A **Cloudflare account**, free. The account itself asks for no card; the R2
  storage in step 2 does. See [What it costs](#what-it-costs)
- **Node 22 or newer**. The Cloudflare tooling refuses to run on older versions,
  with an error that doesn't explain itself
- **Git**, and a terminal you can paste into. On Windows use **Git Bash** (it
  comes with [Git for Windows](https://git-scm.com/downloads)) or WSL, because
  the setup scripts are shell scripts and PowerShell can't run them

Budget about fifteen minutes if you already have those, and an hour the first
time if you don't.

## How it works

For the curious, or anyone deciding whether to trust it:

- **One Worker, one deploy.** `worker.js` is a thin router; every subsystem
  lives in `src/`. Static assets and server code ship together, so there's no
  front-end/back-end split to keep in sync.
- **No build step.** Hand-authored HTML, CSS and native ES modules. The code you
  read is the code that runs. Open a file, change it, push.
- **Identity is injected at the edge.** Pages are served with neutral
  placeholders and filled in from your config by HTMLRewriter on every response.
- **Storage picked per job.** D1 (SQLite) for mutable state, R2 for image
  variants, KV for subscribers, git for anything versioned.
- **The Worker is the only gate.** Every secret is a Worker binding; the browser
  only ever holds a short-lived scoped token. Privileged routes verify it.
- **1,000+ tests** run on every push, alongside a build check and a scan that
  fails the build if instance identity leaks into the code.

## Docs

| File | What's in it |
|------|--------------|
| [Install guide](https://os.oaklens.art/install) | The interactive walkthrough, one step at a time |
| [setup.md](setup.md) | Deploying and operating an instance: accounts, secrets, storage, the console |
| [quickstart.md](quickstart.md) | Your first half hour after the install: the config switches and console moves, one at a time |
| [CHANGELOG.md](CHANGELOG.md) | What changed in the engine, and whether you need to do anything about it |
| [CONTRIBUTING.md](CONTRIBUTING.md) | The engine-vs-instance model and the ground rules |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability privately |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | How we treat each other here |
| [CLAUDE.md](CLAUDE.md) | The working agreement for AI coding agents, and the fastest tour of the architecture if you're human |

## Contributing

Issues and pull requests are welcome. The one rule worth reading before you open
either: **no instance identity in engine code.** No real emails, coordinates,
domains or storage keys in a diff. Anything that identifies a particular site
belongs in `site.config.js`. `CONTRIBUTING.md` explains why, and
`scripts/os-leak-scan.sh` checks it.

Run `npm test` before you push; CI runs the same suite. By taking part you agree
to the [Code of Conduct](CODE_OF_CONDUCT.md). The short version is that the
person who got stuck is not the problem, the step that confused them is.

## Security

Please report vulnerabilities **privately** through GitHub's
*Security → Report a vulnerability*, not a public issue. Details and scope are
in [SECURITY.md](SECURITY.md). Test only against your own deployment.

## Licence

MIT, so fork it, change it, ship it, and sell what you make with it. See
[LICENSE](LICENSE). Attribution in the footer is on by default and removable in
one line.

## Also from OakLens

[**Fixxer**](https://github.com/oaklensart/fixxer), photography workflow
automation. Fixxer organises the shoot; OAKLENS OS puts it on the web.
