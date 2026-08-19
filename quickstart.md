# Quick Start

**You've installed it. It's live. Now what?**

[setup.md](setup.md) got your site standing up. This picks up the moment after
that — the twenty or so things you'd otherwise have to find by clicking around,
in the order you'd actually want them.

Every step below is one rep: **what it does**, **do this**, and **how you know
it worked**. Nothing here is required. Skip anything that isn't yours yet and
come back to it.

Budget about half an hour for Part 1 and Part 2 together. You can stop after
Part 1 and have a site that already looks like you.

> **You should have finished [setup.md](setup.md) first** — your site answers at
> a real address and you can sign in to the console. If either of those isn't
> true yet, go back; nothing here will work without them.

---

## Part 0 — You're live. Here's what you're looking at.

### Your two addresses

**Your site** is whatever address the install gave you — a `.workers.dev`
address at first, your own domain if you've connected one.

**Your console** is that same address with `/dev/field-console` on the end.
That's where photographs and writing go in.

**Bookmark the console now.** It's the address you'll want most and the one
that's easiest to lose. If you later move to your own domain, the console moves
with it — same path, new front half.

### Two ways to change things, and they're different

This trips people up once and then never again:

| You changed… | How it goes live |
|---|---|
| **Photos, posts, anything in the console** | Hit **▲ Publish to GitHub** in the console |
| **Settings — anything in `site.config.js`** | Save the file and `git push` |

Both end the same way: GitHub tells Cloudflare, Cloudflare rebuilds, and your
change is live in about a minute. There's no separate "deploy the front end"
step and no second place to check.

**If you haven't connected your repo to Cloudflare yet,** that automatic rebuild
isn't happening and pushing does nothing on its own. Go do it — it's the
"Connect your repo" section of [setup.md](setup.md), it takes a few minutes, and
it's the difference between publishing from your phone and publishing from a
terminal.

### The shape of the console

Six places you'll actually use, whatever the screen size:

- **BUFFER** — everything you've dropped in, newest first. Raw, unsorted, yours.
- **FN** — Field Notes. The writing.
- **ARCHIVE** — the curated work, with titles and gear details.
- **LIBRARY** — images staged for reuse without being published anywhere.
- **PUBLISH** — the button that sends it all live, plus sync and export.
- **⚙** — session status and sign-out.

On a desktop these are down the left. On a phone or tablet the four you use most
sit in a bar along the bottom, and the rest live behind **More**.

---

## Part 1 — The five-minute wins

Everything in Part 1 happens in **one file: `site.config.js`**, in the folder you
cloned. Open it in a text editor. It's long, it's commented throughout, and it's
the only file that knows anything about you.

**The rhythm for all eight:** edit → save → `git push` → wait about a minute →
reload your site.

> **A note on the commented-out lines.** Several switches ship with `//` in front
> of them, like `// appleMusicEmbeds: true,`. Those two slashes mean "ignore this
> line." Turning the feature on means deleting just the slashes, not the whole
> line. Leaving them is how the setting stays visible and findable when it's off.

### 01 · Your name, your city, your wordmark

**What it does.** Fills in every place your site says who it belongs to — the
nav, the footer, browser tabs, share cards, and the structured data search
engines read.

**Do it.** The block at the very top:

```js
name: 'Your Studio',
tagline: 'Selected work',
email: 'you@example.com',
contactName: 'You',
wordmark: { stem: 'YOUR STUDIO', accent: '' },
location: {
  name: 'YOUR CITY',
  region: '',
  coords: [0, 0],
},
```

`wordmark` is the logo text. Split it in two if you want the second half in your
theme's accent colour — `{ stem: 'STUDIO', accent: '.COM' }` renders
**STUDIO**`.COM` with the `.COM` coloured. Leave `accent` empty for one colour.

`coords` is your city's latitude and longitude, and it's used for one thing: the
small weather reading in the footer. Any "what are the coordinates of…" search
gives you the two numbers.

**How you know it worked.** Your name is in the browser tab and the footer, and
the footer weather is your weather instead of a spot in the Atlantic.

### 02 · Pick your look

**What it does.** Changes the entire visual design of the site — typefaces,
colours, layout, the homepage hero — in one word.

**Do it.**

```js
theme: { preset: 'selenium', defaultMode: 'midnight', toggle: true },
```

Five presets ship:

| Preset | What it is |
|---|---|
| `selenium` | The folio — serif headings, coral accent, built for long reads. The default. |
| `aperture` | Contemporary studio, cobalt |
| `passe-partout` | Fine-art gallery, oxblood on warm paper |
| `noir` | Tech-noir terminal — black, white, red |
| `cyanotype` | The folio again, in Prussian-blue ink on cool paper |

`defaultMode` is what a first-time visitor sees: `'midnight'` (dark),
`'daylight'` (light), or `'auto'` to follow whatever their device is set to.
`toggle: true` gives visitors the switch to change it themselves.

**How you know it worked.** The site looks like a different site. Try all five
before settling — it's a one-word change and a one-minute wait, so the cost of
looking is nearly nothing.

### 03 · Turn pages on and off

**What it does.** Switches a whole page on or off — the route, its place in the
nav, and its line in the sitemap, all together.

**Do it.**

```js
pages: {
  archive: true, fieldNotes: true, about: true,
  wall: false, support: false,
},
```

A fresh site ships with the first three on. **The Wall** (wallpapers, plus the
Photo Lab) and **Support** (a tip-jar page) are off until you want them.

Turning a page off is complete: the address returns "not found", the nav link
disappears on its own, and search engines are never pointed at it. You don't
have to edit the nav separately — it filters itself.

**How you know it worked.** Set `wall: true`, push, and there's a new link in
your nav. Set it back to `false` and it's gone again.

### 04 · Turn on the Apple Music player

**What it does.** Paste a `music.apple.com` share link into a field note and it
becomes a real, playable player instead of a blue link.

**It's off on purpose.** The player is an Apple iframe, and your site's default
promise is that public pages load nothing from anyone else. Turning it on widens
that promise by exactly one address — `embed.music.apple.com` — and nothing else.
That's a fair trade if you write about music, and pointless if you don't.

**Do it.** Find this line and delete the two slashes:

```js
// appleMusicEmbeds: true,
```

**How you know it worked.** Put an Apple Music share link in a field note and
publish. A player = it's on. Still a plain blue link = the push hasn't finished,
or the slashes are still there.

**Left off, nothing breaks.** A share link in a post just renders as a link.
That's the designed behaviour, not a failure.

### 05 · Turn on Cloudflare Web Analytics

**What it does.** Tells you how many people visited and what they looked at. No
cookies, no consent banner, nothing that follows anyone around.

**This one has two halves, and the second is the one people miss.**

**Do it — half one, in Cloudflare.** In the Cloudflare dashboard, turn on Web
Analytics for your site. This is what generates the beacon in the first place.

**Do it — half two, in your config.** Delete the slashes:

```js
// webAnalytics: true,
```

**Why both.** The dashboard adds a small tracking script to your pages
automatically. Your site's security policy blocks scripts it hasn't been told
about — including that one. This line is how it gets told. Turn on the dashboard
half alone and the browser silently blocks the script and you get no numbers at
all, with nothing visibly wrong.

**How you know it worked.** Visit your own site, then check the Web Analytics
page in Cloudflare. A visit shows up within a few minutes.

### 06 · Tell the console your repo is connected

**What it does.** Changes what the console's Publish screen tells you after you
hit the button.

**Do it.** Once you've connected your repo to Cloudflare (setup.md, "Connect your
repo"), find this line and change `false` to `true`:

```js
repoConnected: false,
```

**Why it isn't automatic.** Your site genuinely cannot see, from the inside,
whether Cloudflare is watching your repo. So this line is how it knows. It ships
switched off and fully visible — a switch you can see is a switch you can find
again.

**How you know it worked.** Publish something. The console says Cloudflare is
rebuilding and your change will be live in about a minute. Before you flip it,
it tells you to run a deploy command yourself — which is the honest answer right
up until you connect.

### 07 · The OS chip, and the webring

**What they are.** Two small links in your homepage footer. Both are about
belonging to something, and both are entirely your call.

**The OS chip** is a quiet, unbranded link back to the engine your site runs on,
for a visitor who decides they want one too. It's on one page, not nine, it's the
only self-promotion in the whole template, and the licence never required it.
Remove it whenever you like:

```js
// poweredBy: false,
```

**The webring** is ANALOGS.NETWORK — a ring of independent, creative-run sites.
It's **off**, and unlike the others this default is load-bearing: your site must
never inherit a link into somebody else's network just because you forked their
code. Nothing renders and no address exists until you've actually joined and been
given a seat of your own. The config comment above the setting has the two ways
to ask.

Once you have a seat number, it goes here:

```js
// webring: { node: 7, slug: 'your-slug' },
```

**How you know it worked.** A matching chip appears in your homepage footer, and
your ownership claim serves as plain text at `/.well-known/analogs.txt`.

> **Seat numbers start at zero,** and zero is a real seat. If you're given node
> `0`, it works exactly like any other.

### 08 · Short links on your own domain

**What it does.** Makes `yoursite.com/prints` forward anywhere you want — and
lets you re-point it later without reprinting anything you've already handed out.

**Do it.**

```js
shortLinks: { prints: 'https://your-print-shop.example/gallery' },
```

Each code is one lowercase word — letters, digits and hyphens. A code can't
shadow a page you already have, and the site will tell you rather than quietly
breaking a page.

**How you know it worked.** Visit `yoursite.com/prints`. It forwards.

**The reason to bother:** the link on the back of a card stays good forever, even
when the shop behind it changes.

---

## Part 2 — Your first frames

Now into the console — `yoursite.com/dev/field-console`. Sign in.

The whole loop, before the detail: **drop photos → set how they crop → publish.**
Everything else is refinement.

### 09 · Drop photos into the buffer

**What it does.** Takes a photo off your desk and puts it on your site's storage,
resized and ready, without you exporting anything first.

**Do it.** Open **BUFFER** and drag photos onto it. Or tap the drop zone on a
phone and pick from your camera roll.

Each photo is resized into three sizes, uploaded, and fingerprinted so the same
photo can't sneak in twice. You'll see progress in the bottom-left panel.

**How you know it worked.** Each frame shows **✓ CDN** underneath. That means the
image is on your storage, not just in your browser.

**A few things worth knowing:**

- **Nothing is public yet.** The buffer is your desk. Publishing is step 15.
- **RAW files are welcome.** A `.CR2` or `.RW2` gets routed into the RAW Lens,
  which pulls the camera's own preview out on your device. Browsers can't read
  RAW directly, so this is how it works at all.
- **If an upload fails, keep the row.** Dismissing the panel throws away the only
  copy your browser holds. Leave it and hit **RETRY** — it also retries itself
  when you're back on signal.

### 10 · Set the focal point ◎

**What it does.** Decides what stays in frame when a photo gets cropped to a
small square-ish thumbnail. This is the single biggest "why does my site look
like that" fix, and it's invisible until you know it exists.

**The problem it solves.** Thumbnails crop to the middle of the photo. If your
subject is near an edge — a face on the left, a horizon low in the frame — the
middle is exactly the wrong place to keep.

**Do it.** On any frame, click **◎**. Drag the point onto what matters. Hit
**✓ Set Focal Point**.

Some notes from inside the modal:

- The reading at the side (`50% / 50%`) is the point's position. Centre is the
  default, so a photo you never touch is unchanged.
- **↺ Center** puts it back.
- **The full-frame view is never cropped.** Click a photo on your live site and
  you always get the whole thing. This only ever affects the small versions.
- One point covers every thumbnail shape on the site. You set it once.

**How you know it worked.** The frame's own thumbnail in the console re-crops
immediately.

### 11 · Feature a frame on the homepage ☆ → ★

**What it does.** Puts one raw frame on your homepage as a **RAW** card — a
"here's what I shot this week" slot that doesn't need a title or a write-up.

**Nothing appears on your homepage unless you ask.** The buffer is raw and large
by design, so featuring is per-frame and deliberate.

**Do it — and it's two buttons, not one.**

1. Click **☆** on the frame. It fills in to **★**.
2. A new **▯** button appears next to it. Click that and set the **4:5 card
   crop** — the homepage card is a tall shape, taller than a normal thumbnail, so
   it gets its own point.
3. Publish (step 15).

**Do step 2.** Skipping it is the most common reason a featured frame looks wrong
or doesn't seem to land properly on the homepage.

**How you know it worked.** A **★** badge sits on the frame in the console, and
after publishing there's a RAW card on your homepage.

> **The homepage shows one RAW card** — the most recently featured one wins.
> Featuring several doesn't break anything; the extras simply wait.

To take it down: click **★** again. It's off the homepage at your next publish.

### 12 · Make the share card ▣

**What it does.** Controls the image people see when someone drops a link to your
site into iMessage, Slack, WhatsApp or a social post. Set nothing and you're at
the mercy of whatever gets auto-cropped.

**This is a different card from step 11.** Worth saying plainly, because the
names are close:

| | Where it shows | How you make it |
|---|---|---|
| **Homepage RAW card** | Your own homepage | **★** then **▯** — step 11 |
| **Share card** | Other people's apps | Inside **◎** — right here |

**Do it.** Click **◎** on a frame (yes, the same focal-point button). Alongside
the picker you'll see a live 1200×630 share card being drawn — your photo, your
wordmark, the frame number and date. Drag the point and both update together:
**one point, two outputs.**

Two guides sit on the photo while you drag: **solid = what the share card keeps,
dashed = what the thumbnail keeps.** There's a checkbox to hide them.

Then, in the footer of that modal:

- **▲ Publish Card** — saves it. This is the one that matters.
- **⧉ Copy Link** — the address that unfurls into this card, ready to paste.
- **⤓ Download** — the card as a file, for anywhere else you want it.

**How you know it worked.** A **▣** badge appears on the frame. Paste the copied
link into a message to yourself and watch it unfurl.

### 13 · Promote to the archive ▲

**What it does.** Moves a frame out of the raw buffer into your curated
archive — the work with a title, a location, and the camera details.

**Do it.** Click **▲** on the frame, then fill in the fields: title, subtitle,
location, and the three gear fields — camera, lens, medium. Those three are
write-in, so put whatever fits your work in them ("Hasselblad 500", "35mm",
"oil on linen"), and leave any of them blank if it doesn't apply. What you type
is remembered on this device and offered back next time, so you only type your
setup once. Shooting with something borrowed? Switch **Remember this gear** off
for that frame.

**How you know it worked.** The frame says **ARCHIVED**, and it turns up under
**ARCHIVE** with everything you typed.

**The buffer is not a waiting room.** Plenty of frames are happiest staying there
forever. Promote the ones that have earned a title.

### 14 · Retire, don't delete ◼

**What it does.** Takes a published frame off your site while keeping its number.

**Read this before you go tidying.** Frames are numbered by position, and those
numbers are quotable — `f#234` in a field note, a share link someone saved.
Genuinely deleting a published frame would shift every number after it and break
every one of those references at once.

So the console gives you two different buttons, and which one you see depends on
whether the frame has ever been published:

| Button | Appears on | What happens |
|---|---|---|
| **×** | Frames never published | A true delete. Nothing has ever pointed at it. |
| **◼** | Frames already published | Retired to a **dark frame** — the number stays forever, the image goes. |

A dark frame shows as an inert marker in your buffer, labelled `DARK`. It's a
headstone with the plot number intact.

**How you know it worked.** The frame reads **RETIRED** with a `DARK` badge, and
every frame after it keeps the number it had.

**There is no un-retire.** The console asks you to confirm, and it means it.

### 15 · Publish

**What it does.** Sends everything above out into the world, all at once.

**Do it.** Open **PUBLISH** and click **▲ Publish to GitHub**.

Everything staged goes as a single commit — photos, posts, archive entries,
settings — all or nothing. There's no partial state to land in, and no order you
have to do things in.

**How you know it worked.** The console confirms the publish, and — if you set
`repoConnected: true` in step 06 — tells you Cloudflare is rebuilding. Give it
about a minute and reload your site.

**A few things about that button:**

- **It never quietly retries.** If a publish doesn't confirm, the console says
  exactly that and tells you to check GitHub before trying again. A blind retry
  could commit twice.
- **Nothing is lost by a failure.** Your staged work stays staged through every
  failure path, including going offline mid-publish.
- **↓ Sync from GitHub** pulls the other direction — use it when you've published
  from a different device, or you're on a fresh browser.
- **Publishing triggers a rebuild.** So it's also how a config change you pushed
  earlier gets picked up, if you happened to do both.

### 16 · Post a pulse — the one thing that skips all of the above

**What it does.** Puts a small card on your homepage — a glyph, a line, a colour
— that goes live in about a minute and clears itself after eighteen hours.

**Do it.** Tap the **☺** in the top bar (it's also in **MORE**). Tap a lane, tap
a starter to fill the card, edit the line, pick a colour, hit **POST PULSE ▲**.

**The thing worth understanding.** Everything else in this guide stages up and
waits for step 15. A pulse does not. It saves straight to your database and
appears — **no publish, no rebuild, no build minutes.** That's the whole reason
it exists: a card you might post three times a day can't cost a deploy each time.

**A few things about it:**

- **You type into the card itself.** What you're looking at is what your homepage
  will draw — the colour, and the text size, which steps up for a short line and
  down for a long one.
- **Every card says PULSE.** That's fixed, on your site and everyone else's. It's
  the word that tells a first-time visitor what the tile is. The two footer cells
  are yours — free text, or leave them empty and the row doesn't render.
- **All six starter packs are yours** whatever you make — photography, writing,
  music, filmmaking, tech, podcasting. Tapping one fills the card so you can edit
  the line before sending. They're a starting point, not a menu.
- **TAKE DOWN** removes the live one early and your homepage goes straight back
  to your work. **RESET CARD** is the other one — it only empties what you're
  writing and never touches your site.
- **Posted a good one?** It's kept. Tap **RECENT** under the card (on a phone) or
  look at the left-hand list (on a laptop) to load any past pulse back onto the
  card and send it again.

**If it says it needs a database table**, that's the migration from setup.md —
run `npx wrangler d1 migrations apply <your-database-name> --remote`. Nothing
else breaks while you get to it; your homepage just carries on without a card.

---

## Part 3 — Where to go next

You now have a site that looks like you, with your photographs on it, published
from a browser.

- **[setup.md](setup.md)** — the full operating manual. Connecting your repo,
  every optional secret, custom domains, locking the console behind Cloudflare
  Access, and keeping up with engine updates.
- **[README.md](README.md)** — what this thing is, what it costs, and how it
  works under the hood.
- **[CHANGELOG.md](CHANGELOG.md)** — what's changed, and when.

**Two habits worth keeping:**

1. **Run `npm test` before you push a code change.** It's the same suite the
   build runs, and it's faster to find out on your machine.
2. **`scripts/doctor.sh` when something feels off.** It's read-only — it looks at
   your setup and tells you what it sees, and it changes nothing.

**Found something confusing?** So did someone else. Open an issue — the install
and this guide both get better that way, and "I didn't know that existed" is a
completely valid bug report.
