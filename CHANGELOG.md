# Changelog

What changed in the engine, and whether you have to do anything about it.

**How to read this.** Your site is a fork, and you take updates by merging:

```bash
git fetch upstream
git merge upstream/main
```

There are no released versions to pin to, so a merge brings you everything
since the last one. Skim the entries above the date you last merged, look for
the flag below, then merge.

> ⚠️ **ACTION REQUIRED** marks the only entries you cannot ignore. Everything
> else is safe to merge and forget: it either changes nothing you touch, or it
> is a fix you want. If an entry needs you to create a Cloudflare resource,
> edit your config, or change a setting, it says so in the entry and tells you
> what to run.

Two files conflict on every merge, always, and that is by design:
`site.config.js` and `wrangler.jsonc` hold your identity and your Cloudflare
resources. Keep yours. [setup.md](setup.md) has the exact commands.

---

## 2026-08-19

**Fixed: the archive's Camera, Lens and Medium fields were somebody else's
gear.** They were dropdowns with a fixed set of options — two camera bodies, two
lens types, Digital or Film — which meant a frame you made on anything else
could not be described without editing the HTML, and a brand-new site arrived
listing equipment it had never seen.

**They're write-in fields now, and they remember.** Type whatever fits your work
— a camera, a scanner, a pen, "iPhone 15", "oil on linen". What you type comes
back as a suggestion the next time, and the last gear you staged prefills the
next frame, so a session of frames from one setup is typed once.

- **Remember this gear** (the toggle under the fields) is on by default. Switch
  it off for a borrowed camera you don't want in the list — the frame still
  records it, your device just doesn't keep it.
- **Forget saved** clears the suggestions on that device.
- Suggestions live in your browser, not on your site: nothing to set up, nothing
  published, and each device keeps its own list.

**Any of the three can be left blank now.** A blank one simply drops out of the
line under the photo instead of leaving a stray `|` behind it — on the frame
card and in the lightbox alike.

Nothing to do on your side. Your existing frames keep their gear exactly as it
is, and it shows up as suggestions the first time you open the Archive view.

## 2026-08-14 (third change today)

**Fixed: taking tracks off the homepage audio card left you with no way to
publish it.** If you removed a featured track — or hit CLEAR CARD — the console
counted that as *undoing* a pending change instead of *making* one. With nothing
else waiting, the publish screen said "NO PENDING CHANGES" and refused to run,
so the card stayed live on your site with no way to take it down.

Removing something is a change like any other now, and it stages like one. The
publish screen also gained an **Audio** card in its summary grid — audio was
staged but shown nowhere on that screen.

If you are sitting in front of this right now: un-feature your tracks (or CLEAR
CARD) once more, and PUBLISH will light up.

## 2026-08-14 (later the same day)

**Audio starts faster, and the multi-track card has a better name.**

It's called the **Soundboard** now, not "Featured Playlist" — a playlist is a
music word, and that card is for whatever you make: a score, a field recording,
an episode, a voice memo, a loop.

**Playback stopped making people wait.** Three things were adding up:

- Nothing was fetched until you *clicked* play, so the click is where the whole
  download started. It now starts a beat earlier — when a visitor's pointer
  reaches the play button or a track row, or when they tab to it. A visitor who
  never reaches for the player still downloads nothing, which was always the
  point.
- The next track in a soundboard now buffers while the current one plays, so
  moving down the list is a swap rather than a fresh wait.
- **If your site serves files through the built-in `/api/cdn` proxy** (that's
  every fork without a custom CDN domain), audio was the one thing that never
  got cached at Cloudflare's edge: browsers ask for media with a byte range, and
  the proxy was treating "give me the whole file" as a partial request and going
  back to storage every time. Fixed — second and later plays now come from the
  edge.

**One thing only you can fix:** the file itself. An uncompressed WAV is about
four times the size of a good MP3 for the same seconds of sound, and your
visitors download every byte before they hear anything. The Audio shelf now
tells you at upload time when a file is heavy, with the numbers. It's a warning,
not a refusal — nothing is stopped or converted behind your back.

## 2026-08-14

**The homepage audio card looks like a record now.** If you have pinned two or
more tracks, the card that shows them was rebuilt: the waveform sits at the top
as the card's header, at proper size, and the track list hangs underneath it
under a hairline — instead of the list floating in the middle of the tile with
the waveform stranded above it. The list also fills the card properly whether
you have pinned two tracks or six.

The card sits on a deeper ground than the tiles beside it — near black in a dark
theme, a lifted panel on a light one, with a wash of **your** accent colour
across the top corner. Nothing is hardcoded: it is derived from whatever preset
and mode you are running, so it looks right in all of them.

Nothing to do — merge and it is there. If you had pinned tracks and a browser
that still shows you the old card, it is a cached stylesheet; a hard refresh
settles it.

## 2026-08-13 (later the same day)

**This is a creative platform, not a photography platform.** Nothing in your
site changed and there is nothing to merge carefully — this is a rewrite of how
the project describes itself, and the reason it's here is that one line of it
lands in *your* config.

The engine used to call itself "a photography site, field-notes blog and
print-drop storefront." It doesn't any more. It's a digital studio you own:
portfolio, blog, audio and storefront. That was already true in the code — the
audio layer, the podcast feed, text-only cards sized to their own writing, and
six starter packs covering photography, writing, music, filmmaking, tech and
podcasting all shipped in the days before this — but the landing page and the
install guide still promised "a real photography website", which is the sentence
that tells everyone else the door isn't for them.

**The one thing that touches your files:** the starter tagline in
`site.config.example.js` changed from `'Photography portfolio'` to
`'Selected work'`. If you already filled your own tagline in — which the install
guide asks you to do at step 7 — this changes nothing for you. If you never did,
your site currently says "Photography portfolio" and you can put whatever you
like there.

**If you shoot, nothing was taken away.** RAW ingest, EXIF extraction, permanent
frame numbers, dark frames and the privacy scrub are all still here and still
what they were. They stopped being the definition of the product. They didn't
stop being.

---

## 2026-08-13

**New: Pulse — post what you're doing, straight to your homepage.** A fourth kind
of card on your front page: a glyph, a line, and a colour. Open the console,
tap **Pulse**, pick a starter or write your own, and send. It is live in about a
minute.

Three things worth knowing:

- **It does not need a publish.** Every other thing you write here stages up and
  waits for you to hit publish, which rebuilds your site. A pulse skips all of
  that — it saves straight to your database and appears. Post as many as you
  like; none of them cost a build.
- **It clears itself after 18 hours.** A pulse is about right now, and a stale one
  makes a site look abandoned. When it expires your homepage closes over the gap
  on its own. Change the window with `pulse: { ttlHours: 18 }` in
  `site.config.js`, or take one down early with **TAKE DOWN** — your homepage
  goes straight back to your work. (**RESET CARD** is the other button: it only
  empties what you're writing, and never touches your site.)
- **Six starter packs ship with it** — photography, writing, music, filmmaking,
  tech, podcasting — and you get all six, whatever you make. They are starting
  points: tapping one fills the card so you can edit the line before sending.

**Every card says PULSE**, and there is nothing to configure about that. It is
the one word telling a first-time visitor what the tile is, so it is the same on
your site and everyone else's. The footer cells underneath are yours and free
text — a take number, a kiln temperature, a chapter, nothing at all.

You compose it by typing **into the card itself**: what you are looking at is
what your homepage will draw, colour and text size included. The whole screen
fits without scrolling, on a laptop and on a phone. Twelve glyphs per lane are a
tap away, and every pulse you post is kept — **RECENT** brings a good one back
onto the card so you can send it again.

### ⚠️ ACTION REQUIRED — Pulse needs a new table in your database

**Only if you're updating an existing site.** A fresh install creates it for you.

Run this once:

```bash
npx wrangler d1 migrations apply <your-database-name> --remote
```

That creates the `pulses` table (setup.md, "Your database tables"). It's safe to
re-run — the migration does nothing if the table is already there.

**Why you have to do it by hand.** If you connected your repo to Cloudflare, the
Deploy command we told you to use is `npx wrangler deploy`, and that one skips
migrations. So merging this update brings you the code but not the table. We're
building a button in the console to do this for you; until then, it's one command.

**Nothing breaks while you get to it.** Your site carries on exactly as before —
the console just tells you Pulse needs its table, and your homepage runs without
a pulse card.

---

## 2026-08-12 (earlier)

**Fixed: deleting the last item on a shelf now publishes cleanly.** Trashing
your only audio track (or the last item on any shelf) used to trap you in a
loop: publish refused to blank the manifest, the console re-synced to recover,
and the sync brought the deleted item straight back. Now a sync never
resurrects something sitting in your trash, and publish accepts an emptied
shelf when your trash shows you emptied it on purpose. The protection this
guard exists for — a glitched session accidentally wiping live content — still
blocks exactly as before. Nothing to do; merge and it works.

**New: your site can play audio.** A track, a podcast episode, a voice memo —
drop it on the new **Audio** shelf in the console (next to Library) and it can
appear as a play-card on your homepage, inside a field note, or on its own page
at `/listen`. Nothing to install and nothing to configure; if you never upload
audio, nothing about your site changes.

What you get:

- **A waveform player** that looks drawn into the page rather than dropped onto
  it — no box, no border, and it takes its colors from whichever preset and
  light/dark mode you run.
- **Tracklists for free.** Drop two or more tracks in a row in a field note and
  they become a numbered list; playing one stops the others. One on its own
  stays a single player.
- **A page per track** at `/listen/?a=<name>`, which is what a share button
  sends. Links unfurl with the track's own title in Messages, WhatsApp and
  Slack.
- **A podcast feed** at `/podcast.xml`. Mark a track as an **episode** on the
  shelf and it appears there — Apple Podcasts, Spotify and Overcast can
  subscribe to that address directly. Cloudflare does not charge for the
  bandwidth, so hosting a show costs you nothing extra.
- Everything travels in **Export Site**, so a saved copy plays offline too.

It is quick on purpose: the waveform is measured once when you add the file, so
visitors' browsers draw it without downloading any audio. A track is only
fetched when someone presses play.

> **Optional, and only if you want a podcast in Apple Podcasts:** Apple will not
> accept a feed without square cover art. Add a `podcast` block to
> `site.config.js` (see `site.config.example.js` for the shape) pointing at a
> square image, 1400×1400 or larger. Everywhere else works without it.

**Fixed: text-only posts shared as a broken image.** A field note with no hero
photo was sending an empty image reference to social platforms, so the preview
showed a broken thumbnail instead of falling back to the title and summary. It
now unfurls as a clean text preview.

---

## 2026-08-11

**Fixed: writing a field note on a phone.** With the on-screen keyboard up,
the console's Field Notes editor could end up mostly hidden behind the keys —
its height came from a guess about how much header sat above it, and on a
phone the guess was off by about double. The editor now sizes itself to
exactly the space the keyboard leaves: start typing and the title block and
draft pickers tuck away so the writing area fills the screen above the keys,
with WRITE/PREVIEW and SAVE/STAGE still in reach; tap out of the editor and
they return. Phone screens also drop the keyboard-shortcut hint line (those
⌘ keys don't exist on a phone) and put the draft pickers on one row.

**Fixed: the floating ⛓ LINK button on the buffer.** On phones and tablets it
was hiding *behind* the bottom tab bar — a barely-visible sliver at the screen
edge. It now sits on top of the bar like the rest of the floating controls,
and steps aside while the LINK/CANCEL action bar is up on narrow screens.

Also: save/stage toast messages now appear above the keyboard instead of
under it. Safe to merge — no config changes, nothing to do.

---

## 2026-08-10 (night)

**New: [quickstart.md](quickstart.md) — the guide for the hour after the
install.** `setup.md` ends the moment your site answers at an address. Nothing
covered what comes next, so the settings and console moves that make a site
yours were discoverable only by clicking around and hoping. This is that hour,
one step at a time: **Part 0** your two addresses and the two ways a change goes
live, **Part 1** eight `site.config.js` switches (your name and wordmark, the
five looks, turning pages on and off, the Apple Music player, Web Analytics,
`repoConnected`, the footer chips, short links), **Part 2** seven console moves
(dropping photos in, focal points, featuring a frame on your homepage, the card
people see when they share your link, promoting to the archive, retiring without
breaking frame numbers, publishing).

Every item says what it does, what to do, and **how you know it worked** —
including what it looks like when it hasn't, so a non-result reads as a state
rather than a failure.

Two things in there are worth knowing even if you skip the rest:

- **Cloudflare Web Analytics needs two switches, not one.** Turning it on in the
  Cloudflare dashboard is only half. Your site's security policy blocks the
  script it adds until `webAnalytics: true` is also set in `site.config.js`. Do
  only the dashboard half and you get no numbers at all, with nothing visibly
  wrong.
- **"The card" is two different cards.** The **★** star plus the **▯** card-crop
  button makes the tall card on *your* homepage. The **▲ Publish Card** button
  *inside* the **◎** focal picker makes the wide card other people see when your
  link lands in a message. Different buttons, different pictures — setting one
  does not set the other.

Nothing to do: it's a new file, it changes no behaviour, and it merges clean.

## 2026-08-10 (evening)

**New: dress one nav item as a button.** Give any entry in
`site.config.js` → `nav[]` the class `cta` and it renders as a small
bordered button in your site's accent color instead of a plain menu link —
for the one action you want visitors to always see (the nav is sticky, so
it travels with them). One line, works in every preset, changes nothing
unless you opt in:

```js
{ label: 'Buy prints', href: '/support', class: 'cta' },
```

---

## 2026-08-10 (later)

**Changed: new forks now start on `selenium`.** The example config ships
`preset: 'selenium'`, so a fresh install begins on the folio look instead of
aperture, and `setup.sh` offers it as the pre-selected answer. **Your site
does not change**: your config names its own preset and that always wins —
this only affects installs that haven't happened yet. (Configs that omit
`theme{}` entirely also keep rendering aperture, deliberately.)

---

## 2026-08-10

**New: two theme presets — `selenium` and `cyanotype`.** The folio pair:
serif headings (Fraunces), a clean reading column, hairlines instead of
cards — built for sites with a lot of writing. `selenium` is a cool
neutral gray with a coral accent, named for the toner that gives darkroom
prints their cool blacks; `cyanotype` is the same layout in Prussian-blue
ink on cool paper, named for the contact print. Both come in Midnight and
Daylight, both re-skin the Field Console to match, and both use faces the
engine already ships — no new downloads. Switching is the usual one line
(`site.config.js` → `theme.preset`), and `scripts/setup.sh` now offers all
five presets on first run. Nothing to do — your current preset is
untouched.

---

## 2026-08-09 (morning)

**Fixed: a field-note draft could still be overwritten by an older copy.**
Cloud drafts already refused a save from a device holding a stale version —
that's the "changed on another device" warning. But the check compared
timestamps in milliseconds, and two saves that landed inside the same
millisecond looked identical to it, so the guard waved the second one through
and the newer work was lost. Rare in real writing, and it was showing up as a
test that failed about one run in three rather than as a complaint. Each save
now always advances the draft's version, whatever the clock says. Nothing to
do — merge and it's yours.

**New: branded short links.** You can now point a memorable path on your own
domain at any URL — `yoursite.com/prints`, `yoursite.com/talk` — and change
where it goes later without reprinting anything you already handed out. Add a
line to `site.config.js`:

```js
shortLinks: {
  prints: 'https://your-print-shop.example/gallery',
},
```

That's the whole feature. Off unless you fill it in, so merging changes
nothing for you. A code is one lowercase word (letters, digits, hyphens) and
it can't hide one of your own pages — if you name one after a page you have,
it's ignored rather than shadowing it. The redirect is deliberately
uncached, which is what lets you re-point it later.

If you run a second hostname and want the links to belong only to that one,
add `shortLinkHost: 'go.'` beside it. Leave it out on a single domain.

## 2026-08-09 (small hours)

On Android Chrome, tapping a frame in the buffer or archive flashed a grey
highlight over the image — the browser's built-in "you tapped this" overlay,
which the public stylesheet never turned off (the console's already did).
Suppressed site-wide; the hover and light-table states are the real feedback.
Nothing to do — merge and it's yours.

## 2026-08-09 (night)

`setup.sh` broke on Linux — quietly. The deploy-log temp directory was made
with a BSD-only `mktemp` flag that macOS accepts and GNU refuses ("too few
X's"), so on every Linux machine the script lost the "Your site is live at:"
address read-back while still exiting 0. Fixed with a portable template, and
a guard test now keeps BSD-isms out of every script a fork runs. Nothing to
do — merge and it's yours. If you installed from Linux and never saw your
address printed, this was why.

The console is stamped v0.13.1 (the sync-failure reporting below).

## 2026-08-09 (even later)

A mistyped `GITHUB_REPO` secret used to look like a *working* site. Every
GitHub read failed with "Not Found", but the console's sync still painted
green — the only data in the ledger line (`✓ sync · drafts:0`) came from the
site's own database, not GitHub — and the Publish button failed with a bare
"Not Found" that pointed at nothing. A fresh install hit exactly this.

Nothing to do on your end unless you are seeing it: sync now says plainly when
**nothing** came from GitHub, names the repo the worker asked for (so a typo
is visible on sight), and both sync and Publish translate GitHub's two classic
config errors into their fixes — "Not Found" → check `GITHUB_REPO`,
"Bad credentials" → check `GITHUB_TOKEN`.

- `/api/sync` now returns `repo` (which repo the worker queried) alongside the
  per-file results. Console-authed, additive, ignored by older consoles.
- A sync where files arrived but main's HEAD didn't still warns about the
  disarmed stale-base guard, exactly as before. The new failure mode is only
  the total one: no files *and* no HEAD.

## 2026-08-09 (later)

Connecting your repo to Cloudflare — the thing that makes the console's
**Publish** button actually put changes live — was broken, and broken in the
worst way: silently. This fixes it and promotes the whole flow from optional to
required.

### ⚠️ ACTION REQUIRED — if you connected your repo, check what GitHub has

`wrangler.jsonc` ships tracked and full of placeholders. `setup.sh` fills it in
**on your computer**. Nothing ever told anyone to commit it — so the moment you
connected the repo, Cloudflare built from GitHub's copy: it deployed under the
name `your-worker-name`, auto-provisioned an R2 bucket literally called
`your-bucket-name`, and stopped on
`KV namespace 'YOUR_KV_NAMESPACE_ID' is not valid`. Your site carried on serving
its last hand-deploy the whole time, so nothing looked wrong.

Run `bash scripts/doctor.sh`. It now checks this directly and tells you in one
line. If it flags you:

```bash
git add wrangler.jsonc site.config.js
git commit -m "my site's settings"
git push
```

Then delete the junk `your-bucket-name` bucket if Cloudflare made one
(`npx wrangler r2 bucket delete your-bucket-name`). It is empty and costs
nothing, but it will confuse you later.

### What changed

- **`setup.sh` commits your settings for you**, as a new step 6 of 8, before it
  deploys. If git does not know who you are yet it asks once and records the
  answer against this project only.
- **`doctor.sh` reports on your project's history**: whether the saved copy of
  your settings is the real one, whether anything is uncommitted, and whether
  anything is waiting to be pushed. All offline — it never asks GitHub, so it
  cannot hang on a password prompt.
- **`setup.md`'s "Connect your repo" is rewritten** in the order that works,
  with the field-by-field dashboard settings and a recovery section.
- **Every `wrangler` command in `setup.md` is now `npx wrangler`.** A global
  install was never a prerequisite and the bare form fails on a clean machine.
- **The console stops claiming a deploy that is not happening.** After Publish
  it used to say "Cloudflare Pages deploying (~30s)" every time; on an
  unconnected repo nothing was deploying at all. It now says which of the two
  actually happened.
- **`repoConnected` ships live and `false`** in `site.config.example.js`
  instead of commented out, so turning it on is an edit rather than an
  excavation. No behaviour change — `false` was already the default.
- **Re-running `setup.sh` no longer resets your look.** The theme question
  defaulted to option 1 every time, so a re-run quietly put a `passe-partout`
  site back to `aperture`. It now defaults to whatever you already chose.
- **The fork's docs stop describing the client portal**, which forks do not
  have. `RESEND_API_KEY` went with it.

---

## 2026-08-09

Three first-run bugs, all found by watching a stranger install this from
nothing. None of them affect a site that is already up and running — but the
first one may be quietly true of yours, so it is worth two minutes.

### ⚠️ ACTION REQUIRED — check your photo storage actually exists

`setup.sh` used to treat *any* failure from `wrangler r2 bucket create` as
"it must already exist". There is another reason it fails: R2 is not switched
on for the account, which needs a one-time subscription added from the
Cloudflare dashboard and cannot be done from the terminal.

When that happened the script said **"Photo storage ready"**, wrote the bucket
name into `wrangler.jsonc` anyway, and from then on skipped the storage step
entirely because the placeholder was filled. The bucket was never created. The
only symptom was a deploy that failed minutes later on a bucket that had never
existed.

Check yours:

```bash
bash scripts/doctor.sh
```

It now verifies that the storage your config *names* is really on your account,
rather than trusting the config to be telling the truth. If it reports the
bucket missing, switch R2 on (dashboard → **Storage & databases** → **R2**),
then re-run `bash scripts/setup.sh` — it will create it and pick up from there.

If your site is serving photographs today, your bucket exists and there is
nothing to do.

### `setup.sh` now deploys, and tells you your web address

Two required secrets are stored *on a Worker*, and until something has deployed
there is no Worker to attach them to. Wrangler asks whether to create one and
reads the answer from stdin — the same stdin the secret is piped to — so the
prompt ate the secret and the command failed. The script then reported
`check you're online`, which was wrong every single time it fired.

Setup is seven steps now instead of six: it deploys before setting secrets, so
they always attach, and it reads your `.workers.dev` address back out of the
deploy and prints it on a line of its own. Finding your own site used to mean
scrolling back through wrangler's output.

Failures quote wrangler's actual words instead of guessing.

If your repo is connected to Cloudflare, the new deploy step skips itself — a
hand-deploy on a connected repo is undone by the next automatic build.

### The R2 sign-up wants a payment method, and the docs now say so

Switching on R2 goes through a Cloudflare checkout that asks for a card, Apple
Pay, Google Pay, PayPal or a bank account, plus a billing address — while
showing `Total Due Now $0.00` and `$0/month`. Both things are true: you are
authorising charges only above the free allowance.

The README and the install guide used to say "no card required", which was
wrong. They now say what actually happens, and spell out what the allowance
holds in terms you can check: 10 GB is roughly 25,000 photographs at the three
sizes this engine generates, and the limit you would really meet first is the
Workers free tier's 100,000 requests a day, not storage.

Nothing to do. This is a documentation correction, not a change to your site.

### Dashboard names, both of them

Cloudflare is rolling out a redesigned dashboard account by account, so
**Workers & Pages** now sits under **Compute**, and **Cloudflare One** is
**Zero Trust** again. The scripts and `setup.md` name both labels rather than
picking the one that is wrong for half of you.

---

## 2026-08-08

The engine repository went public. Everything below shipped alongside that.

### New optional config: `entity.codeRepository`

If your own fork's code is public, naming it credits you as the author of your
engine in the homepage's structured data:

```js
entity: {
  // ...
  codeRepository: 'https://github.com/YOUR-USERNAME/YOUR-REPO',
  codeName: 'YOUR ENGINE NAME',   // optional, defaults to OAKLENS OS
},
```

Leave it empty and nothing is emitted, which is the right default: pointing a
crawler at a private repository weakens your entity signal instead of helping
it. Nothing to do unless you want it.

This is also the first key to arrive since configs became forward-compatible,
so it is the shape every future one will take: optional, defaulted, and
inert until you fill it in.

### Your config is now forward-compatible

New config keys can no longer break your site. The engine reads
`site.config.js` through a defaults layer (`src/shared/config.js`), so any key
it gains in future resolves to a sensible default on configs written before
that key existed.

This matters because the merge that brings you engine updates deliberately
never touches your `site.config.js`. Before this, a new key the engine read
directly would have been missing from your file, and a missing key on the
page-rendering path is a site-wide error delivered by a merge that reported no
conflicts at all. `location` was one read that way.

Nothing to do. Your existing config keeps working exactly as it did, and every
value you set still wins over the default.

### `npm test` works on current Node

Node 24 and newer define their own empty `localStorage`, which shadowed the one
the test environment installs and made two console test files fail to load on a
fresh clone. The suite is green on Node 22 through 26 now. This also un-skipped
30 tests that had been quietly skipping.

### Windows setup is documented properly

The setup scripts are shell scripts, so they need **Git Bash** (which comes
with [Git for Windows](https://git-scm.com/downloads)) or WSL. PowerShell
cannot run them and fails with an error that explains nothing. Git is now
listed as a prerequisite as well, since step one of the install clones a repo.

If you installed on Windows and got stuck at `bash scripts/setup.sh`, that was
this, and it was our documentation's fault rather than yours.

### Community docs

`CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) and a rewritten `README.md`.
`CONTRIBUTING.md` had a cache-discipline instruction that contradicted a test
the CI actually runs: it told you to put a `?v=` on cross-module `import`
specifiers, which `tests/guards.test.js` fails on. Versions belong in the
import map. Corrected.

---

## Before this

The engine ran as a single private instance. Its history up to this point is in
the commit log rather than here.
