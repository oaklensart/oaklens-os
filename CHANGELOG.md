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

## 2026-09-13 (and the single-card view fits too)

**Nothing to do on merge.** The other half of the entry below.

- **The card canvas no longer scrolls, in any view.** Editing one card, or just
  looking at one, the card now sizes itself to the space it has instead of
  overflowing it. On a laptop this had been showing up as a thin scrollbar that
  was always there — the card was about four pixels too tall for its own well.
- **The card gets smaller, never squashed.** It scales by width, so the picture
  keeps its exact shape at every size. On a tall screen you get the full-size
  card as before; on a short one a slightly smaller one, correctly proportioned.
- **A card that is all words is left at full width on purpose** — narrowing text
  makes it taller, not shorter, so capping it would have made the problem worse.

---

## 2026-09-13 (the card grid fits your screen)

**Nothing to do on merge.** A same-day follow-up to the entry below.

- **THE GRID in the Cards studio no longer scrolls — the cards scale to fit.**
  The row now takes whatever height the window has left and sizes the four cards
  to it, instead of the cards deciding the height and the grid scrolling when
  they did not fit. On a shorter laptop that means slightly smaller cards and
  all four ✎ EDIT THIS CARD buttons where you can reach them.
- **An iPad held sideways works now.** It was scrolling by about 90px, and had
  been for a while. Held upright it still scrolls — two rows of cards need more
  height than a tablet has, and shrinking them enough to fit would make them too
  small to read, so they stay full size and you scroll one row.
- **Two smaller fixes you may have seen.** A text card squeezed by a short row
  used to print its opening lines straight over its own location and date; it
  now trims cleanly instead. And a card with words on the picture sized its
  title to the browser window rather than to the card, so on a narrow card the
  last word ran off the edge of the photograph. Both only affected the studio —
  your published homepage never did either.

---

## 2026-09-13 (your homepage row follows what you published, and a one-press reset)

**Nothing to do on merge** — but one behaviour changes, so it is worth thirty
seconds of your time.

- **The automatic homepage row now follows publish order, full stop.** There
  was a rule that quietly promoted a field note into the third card whenever it
  would otherwise have landed in the fourth. On a young site that was helpful.
  On a site with a few dozen frames it meant a photograph you published *this
  week* could be pushed into the fourth card — the one only a tablet held
  upright ever shows — to make room for a note from two months ago. That rule
  is gone. Whatever you published most recently leads, every time.
- **The row still mixes.** If your four newest items are all pictures, the
  oldest of the four still steps aside for your newest note, so the grid of four
  is never all one kind. What changed is that the note no longer *jumps the
  queue*: it takes the place it earned by date. If your newest note is older
  than your third-newest picture, a phone and a desktop will show three pictures
  and the note will sit in the tablet card. That is the trade, and it is now
  predictable — you can look at what you published and know what the homepage
  will do.
- **Fresh installs are unaffected.** A brand-new site still opens
  picture · picture · note. The bundled sample frames and the sample note now
  carry dates that interleave, so that row happens for the same reason every
  other row does, rather than because of a special case in the code.
- **New: `⌫ ALL SLOTS AUTOMATIC` in the Cards studio.** A danger-zone footer
  that hands the whole homepage back to automatic in one press — for when you
  have been composing cards for something, the something is over, and you want
  the grid filling itself again. It only appears when you actually have composed
  cards. It asks first and names every card by title; published cards keep their
  `/card/<id>` address reserved exactly as `◼ RETIRE THIS CARD` does, one
  `↩ UNDO RETIRE` puts them all back, and anything you never published waits in
  the session trash. Nothing is live until you publish, as always.

---

## 2026-09-11 (words on a picture look like a plate, and audio from the composer)

**Nothing to do on merge.** Four refinements from the owner's first day with
the finished card studio.

- **A card with words on the picture is all picture now.** The picture fills
  the card to its floor instead of stopping at 4:5 and leaving a bare strip of
  the card's ground underneath it next to a taller neighbour.
- **The words on the picture are set like a museum label.** The title runs in
  the display face, sentence case, and steps up as it gets shorter — a
  two-word title is large on purpose — closing on a full stop in your site's
  accent; the caption sits under a short accent rule. Nothing to configure:
  the size comes from the title's length, the same way the words tile already
  works. Share images draw the same plate.
- **The composer's side panel stays where you scrolled it.** Pressing a chip
  no longer sends the panel back to the top.
- **♪ ADD AUDIO, right under the picture.** Any card you compose can become
  the audio card from its own panel, and the track picker opens on the spot —
  browse and pick up to six tracks without going to the Audio shelf. Your
  picture and words are kept, so ✕ REMOVE AUDIO brings them straight back.

---

## 2026-09-12 (the stamped card is the card, in colour)

**Nothing to do on merge.** Fixes from the first week of living with the card
studio.

- **Stamped share images carry the card's atmosphere.** A words card with a
  palette, an audio card and a pulse card used to stamp as a flat grey tile;
  they now paint the same ground the homepage draws — the hue, the veil, the
  corner light — read off your site's own stylesheet at stamp time, in
  whichever theme you are in. Re-stamp a card to pick it up.
- **The little light beside a card's label is a part now, not a dot.** The
  words tile's kicker dot (`.wk-dot`) is the same square LED the pulse card
  wears, in the palette's colour on a palette card. Visible on every words
  card on your homepage after you merge; nothing to configure.
- **The composer shows the card at the homepage's proportions** — the picture
  holds 4:5 and the footer is as tall as its words, instead of the footer
  eating two thirds of the card.
- **A staged card's address says so.** The CARD ADDRESS block wears STAGED
  until you publish and LIVE after, and copying a staged link tells you it
  works once you publish — because it does not before.
- **Palette swatches are labelled buttons** with a real tap target on a phone.

---

## 2026-09-11 (a SHARE button on everything you make)

**Nothing to do on merge.** The share images the last update could draw now have
buttons that actually make them — and one more thing finished with them: the
homepage card system is **done**.

- **A SHARE block, wherever the thing is made.** On the focused card in the
  Cards studio, on a card you compose, on every track and every set on the Audio
  shelf, and in the field-note editor's ⋯ menu. Four things, always the same
  four: **copy the link**, **stamp the share images**, **download NATIVE**
  (the shape a feed post wants), **download STORY** (full-screen vertical).
- **Stamping is what makes a pasted link show your card.** Press it once and all
  three sizes go up together. Press it again after you change the card — until
  you do, the old picture keeps showing, and the block says so.
- **It tells you what it has.** "not stamped yet" or "stamped", read from your
  own CDN rather than from a local flag, so it is still right after a reload and
  still right on another device.
- **It works on the LIVE grid too.** Sharing is the one thing that acts on what
  is already published: it happens now and does not wait for a publish.
- **Nothing is ever half-stamped.** If a picture fails to load while the images
  are being drawn, nothing is uploaded at all — a permanent link is never left
  pointing at half a card.
- **Still your gesture, never automatic.** Publishing does not stamp anything by
  itself. A stamp for every entry on every publish would be storage churn you
  did not ask for.

**And with it, the card program is complete.** Over nine updates the homepage
card system went from "four tiles the site picked for you" to: cards you compose
yourself, a second layout that puts your words on the picture, audio sets as a
first-class thing, an address for every card, share images that *are* the card,
and now the buttons that publish them. Everything stayed opt-in — a site that
does nothing publishes exactly the bytes it always did.

---

## 2026-09-11 (your share image looks like your card)

**Nothing to do on merge.** When you paste one of your links into a message,
the little picture that appears is now **your card** — the same card your
homepage shows, drawn at the size each app wants.

- **Every kind gets one, not just photographs.** A field note that leads with
  words instead of a picture had no share image at all before; now it gets its
  own words tile. So do audio tracks, saved sets, and the cards you compose.
- **It is the card, not a picture of a card.** Same crop, same palette, same
  type, same chip, same band if you wrote on the picture — because it is drawn
  from the same record your homepage draws from. Change the card, re-stamp, and
  the preview changes with it.
- **It wears YOUR colours.** The old share image had two reds baked into it, so
  every fork's link previews came out in someone else's brand no matter which
  preset they ran. The colours are now read from your own theme at the moment
  the image is drawn.
- **Three sizes.** The wide one for link previews, a tall one for a feed post,
  and a full-height one for a story. Today the framing modal still publishes
  only the wide one; the buttons for the other two arrive in the next update.
- **Nothing you already stamped changes.** Your existing share images keep
  serving at the same addresses until you re-stamp them.
- **Publish waits for your photo.** Pressing publish the instant the window
  opens used to be able to save a card with an empty space where the picture
  goes. It waits now — and for your fonts too, so the first one you stamp is
  set in your typefaces rather than a browser default.
- **Reordering the tracks on your audio card sticks.** Picking the same tracks
  in a different order used to do nothing at all.
- **A card's page works on a preview server.** Opening it at
  `/card/index.html?id=…` — how a staging host or a local preview spells it —
  showed "no card here". It finds the card now.

---

## 2026-09-11 (every card has an address)

**Nothing to do on merge.** Every card you compose now has a page of its own —
a real link you can text, post or put in a newsletter.

- **Its own address.** A card you build in the studio lives at
  `yoursite.com/card/<id>` as well as on your homepage. The rail shows it, with
  a **COPY** button, the moment the card exists.
- **Once you publish it, it's permanent.** That address will never point at a
  different card — the same promise a track's `/listen/?a=` link and a frame
  number already make. So removing a published card **retires** it: the slot
  goes back to filling itself, and the old link tells anyone who follows it
  that the card is gone rather than quietly showing them something else.
  `↩ UNDO RETIRE` in the Cards header puts it back, until you publish.
- **A card you never published** still just goes to the trash, with
  `↩ RESTORE` in the publish view, exactly as before — nothing was pointing at
  it yet.
- **It unfurls properly.** Paste a card link into a message and it shows your
  own title and words, not the bare site.
- Your card pages are listed in your sitemap and ride along in Export Site.

Nothing about your existing cards changes: the homepage renders exactly the
same, and a card still opens whatever it opened before when someone taps it.

---

## 2026-09-10 (the audio card, in the studio)

**Nothing to do on merge.** The homepage's audio card can now be composed in the
Cards studio like every other card — and taking it over no longer loses the
player, which was the one reason the studio used to refuse.

- **Take it over.** Console → CARDS → focus the audio card → `✎ EDIT THIS CARD`.
  It keeps playing exactly what it was playing; the words are now yours.
- **Choose what plays.** A new **WHAT THIS CARD PLAYS** block in the rail. Two
  options, both always on screen, so picking the other one is the undo:
  - **♪ The homepage tracks** — the tracks you've put on the card, the same list
    the Audio shelf edits. `♪ CHOOSE TRACKS` opens your library with the current
    ones already ticked, so you can add or drop without rebuilding it.
  - **▤ A saved set** — borrow one of your sets. The card takes the set's name
    and opens the set's own page, and reordering the set on the shelf reorders
    the card. (Sets are the entry above this one.)
- **Write on it.** A title and a line render under the waveform as a caption —
  the same quiet grammar a photo card's caption uses. The card's own headline
  stays the name of what's playing, so the two never say the same thing twice.
  Leave both empty and there's no caption at all.
- **The badge.** Leave it blank and an audio card says what it is (`Audio`,
  `Audio // Multi-track`) instead of `Featured`.
- **`♪ CHOOSE TRACKS` is on the plain audio card too**, so you can change the
  homepage tracks from the studio without going to the shelf. There's still one
  list — change it in either place and both agree.

---

## 2026-09-10 (make a set, give it an address)

**Nothing to do on merge.** The Audio shelf can hold **sets** — a named, ordered
list of tracks that lives at its own web address, so you can send someone *this*
handful of tracks in *this* order with one link.

- **Where to find it.** Console → AUDIO → a new **SETS** block above your
  tracks. `+ NEW SET` names it, `+ ADD TRACK` picks from the shelf you already
  have, `▲`/`▼` reorder, and `✕` takes a track out (with one `↩ UNDO` if that
  was a mistake). A set holds up to six tracks — the same six the homepage
  audio card can play.
- **Every set has its own page.** `/listen/?set=<name>` plays it in your order,
  and sharing that link unfurls with the set's name and how many tracks are in
  it, the same way a single track's link already does. It shows up in your
  sitemap once it actually has something to play.
- **A set is a list, not a copy.** It points at tracks by their address, so
  renaming a track doesn't break anything, and taking one off the shelf just
  makes it quietly drop out of the set. Your tracks are never duplicated and
  never deleted by anything you do to a set.
- **Renaming never moves the address.** Once a set is published, its link is
  permanent: deleting it leaves the address reserved rather than freeing it for
  the next set to take, so nobody's old link ever quietly plays something else.
  A set you haven't published yet just goes to the trash, and comes straight
  back.
- **Your podcast feed is untouched, in both directions.** Putting an episode in
  a set changes nothing for your subscribers, and gathering tracks into a set is
  never a way to publish them to a podcast app.
- **Coming next:** the homepage audio card will be able to borrow a set, so what
  plays on your front page and what lives at that link are the same thing.

---

## 2026-09-10 (words on a picture)

**Nothing to do on merge.** Homepage cards learned a new look: **the words can
sit on the picture** instead of under it.

- **Where to find it.** Card Studio → a card with a picture → `CARD LAYOUT` →
  *Words on the picture*. A new block appears underneath with three choices:
  **where** the words sit (bottom, top or middle), **what is behind them**
  (shaded, frosted, or bare picture), and **how heavy the frost** is. Every
  option is a button, the standard one is always on screen, and pressing it puts
  the card back — there is nothing to undo.
- **You never pick the text colour.** When you choose a picture or re-crop one,
  your site measures how bright it is at the top, the middle and the bottom, and
  picks light or dark type for wherever your words land. If it can't measure a
  picture — it's offline, it's still uploading — the card still works: light
  type over a soft shade, which reads on anything.
- **It works on the automatic cards too.** An archive photo or a starred frame
  now offers the same *Words on the picture* option in the layout picker,
  using the standard shading.
- **Nothing about your existing cards changed.** A card that doesn't ask for the
  new layout publishes exactly the bytes it did before.

---

## 2026-09-10 (the studio catches up with its cards)

**Nothing to do on merge.** Three things in the Card Studio:

- **The dressing chips are back** — *Automatic / Always the picture / Always
  the words* — and *Always the words* now gives you the real field-note tile,
  drop cap and blinking caret included. Under the hood each chip writes which
  kind of card yours is; *Automatic* writes nothing and lets the site decide
  from the shape, which is also how every card you dressed before this update
  is read. A card you dressed earlier is quietly rewritten in the new shape the
  next time you open the studio, and renders exactly as it did.
- **What you type on is the card itself.** The composer used to draw its own
  copy of the card; now it shows the very card the homepage will draw and lets
  you type straight into its headline and its line. A picture card's headline
  is still capped at 48 characters (it is a caption); a words card's headline
  runs as long as a field note's title does.
- **Edit a live card in one click.** On the LIVE side every slot offers
  `✎ EDIT THE STAGED CARD`, which takes you to that same card on the STAGED
  side with its controls open.

One thing the studio will not do yet: take over the audio card. That arrives
with the audio update; until then the button's place says so.

---

## 2026-09-10 (a composed card is one of your real cards)

**Nothing to do on merge — your cards render the same.** Under the hood, a
composed homepage card (one you built in the Card Studio) used to be its own
fifth kind of card with its own renderer, a near-copy of the archive card and
the field-note tile that had already started to drift. Now it is one of the
real kinds — a picture card, a words card, an audio card — with your words and
picture laid over it, drawn by the same code that draws every other card on
the grid. Every record you have already published is read exactly as before.

**One visible change, on purpose:** a composed *words* card is now the real
field-note tile, drop cap and blinking caret included, instead of a slightly
plainer copy of it. Picture cards are byte-for-byte what they were.

**One control is resting for a session:** the Card Studio's *Automatic / Always
the picture / Always the words* chips are hidden on composed cards until the
next update, which teaches them the new shape. Cards you already dressed keep
their dressing.

---

## 2026-09-08 (your site knows what day it is)

**Your dates were being rendered in California.** The engine had one timezone
written into its code — the author's — so no matter where you are, the dates the
site printed came from Pacific time. If you publish in the evening (or the
morning, if you are east of UTC), the archive's dates and your buffer's "days"
count could be a day off from the date stamped on the picture itself.

**Set yours:**

```js
// site.config.js
timezone: 'Europe/Berlin',   // your IANA zone name
```

Any name from the tz database works — `Asia/Tokyo`, `America/New_York`,
`Australia/Sydney`. Leave it out and you get **UTC**, which is neutral and
predictable rather than someone else's hometown. A typo falls back to UTC too,
rather than breaking the page.

Not action-required — nothing breaks if you skip it — but it is a one-line edit
that makes your dates yours.

**Also in this release, nothing you need to do:**

- **Cards: Cancel asks before it throws work away.** Taking over an automatic
  card slot and then cropping the picture, or cutting its link with ✕ MAKE
  FREE-FORM, counted as "nothing changed" — so Cancel discarded it silently. It
  now asks first, and keeps the card if you say no.
- **A field that did nothing stopped being published.** Composed cards carried
  an `img` entry in the published data that nothing ever wrote or read. Removed.

## 2026-09-07 (build your own homepage cards)

**You can now make a card.** Open Cards and press **＋ COMPOSE A CARD**. You get
a real card you can build:

- **Pick its picture from anywhere on your site** — the archive, the buffer, your
  wallpapers, a field note's hero, or anything you have uploaded and not used yet.
  Or give it no picture at all.
- **Write on the card itself.** The headline and the line underneath are typed
  straight onto the card, at the size they will actually publish at.
- **Crop it** to the tall 4:5 shape the homepage card uses.
- **Choose how it is dressed** — Automatic, Always the picture, or Always the
  words. Automatic is the right answer nearly always: it leads with the picture
  when there is one and with your words when there is not.

**The words belong to the card.** If you build a card from a field note and then
rewrite its headline, your post is untouched — the card carries its own text.
Clear it and the card falls back to the post's own title.

**Your grid still fills itself.** Composed cards are an override, not a
replacement: up to two of them, and `↩ RESET TO AUTOMATIC` hands the slot back.
A site with no composed cards behaves exactly as it did before — byte for byte.

**A live Pulse still leads.** Posting one never silently does nothing; your
composed cards move down a slot while it is up and come back when it expires.

**Nothing to do on merge.** A new `data/cards.json` ships empty. If you never
compose a card, your published files are unchanged.

---

## 2026-09-07 (the Cards view becomes a place you compose, not just look)

**Cards is now a studio.** Open it and you get a row of your four homepage
slots along the top — tap one to focus it. **STUDIO** shows that card on its own
with everything that acts on it beside it; **PANORAMA** shows the whole row at
once. A **STAGED / LIVE** toggle switches between what your next publish will
make and what is on your site right now, replacing the two side-by-side columns.

Nothing about the preview got less honest in the move. Each slot still carries
its `NEW` / `REPLACED` / `UNCHANGED` / `GONE` marker, and the header always tells
you how many slots change on the next publish — including while you are looking
at the live side, so a pending change can never hide behind the toggle.

**New: you can choose a card's layout.** Focus a field note and the rail offers
**Standard tile** or **Hero forward**. Until now that choice lived only in the
Field Notes editor. Two things worth knowing:

- **Pressing the standard option is the undo.** There is no separate undo
  button, because the way back is the control you are already looking at.
- **A layout your entry cannot wear is greyed, not hidden** — a note with no
  picture cannot lead with one, and the rail says so instead of quietly dropping
  the option.

Right now field notes are the only kind with a second layout, so the picker
appears there and nowhere else. It will show new layouts automatically as they
are added — nothing for you to configure.

**Under the hood**, a card's chosen layout now travels with buffer frames,
archive photos and audio tracks on publish, the way it already did for posts. If
you never choose a layout, your published files are byte-for-byte what they were
before. Nothing to do on merge.

**Also moved:** the "ready to re-feature" frames — the ones you already cropped
for this card — are now a strip along the bottom that scrolls sideways instead of
a wrapped block. It is a shelf of things to use again, so the two `↩` undo
buttons stayed up beside the card they undo rather than being filed among them.

---

## 2026-09-07 (the podcast feed is in beta, and we'd like to hear from you)

**No code changed here — this is a label.** `/podcast.xml` and the readiness
card on the Audio shelf now say **BETA** out loud, because that is the honest
state of them: the feed is valid RSS, the card names every field Apple wants,
and exactly **one** short show has actually been through a directory submission
— the author's, as a test. Everything else on the Audio shelf is not beta. The
player, the waveforms, the per-track addresses and the tracklists inside posts
have been live and unchanged for weeks.

Nothing is switched off and nothing needs doing. Publish a show if you want one;
the feed serves the same way it did yesterday.

**What would help.** If you point a podcast app at your feed, or submit it to
Apple, Spotify or Overcast, tell us how it went at
<https://github.com/oaklensart/oaklens-os/issues>. A rejection message pasted in
full is more useful than a careful bug report — the directories each fail in
their own way, and one person's show cannot find all of it.

The label comes off when enough real feeds have landed in enough real apps.

---

## 2026-09-02 (undo where there wasn't any, and a deleted track keeps its address)

**Editing a track's title can now be undone.** ✎ EDIT asked you two questions
and overwrote what was there, with nothing to click if you'd typed the wrong
thing. The row now grows a **↩ UNDO EDIT** button that puts the old title and
subtitle back. It disappears once you edit that track again or delete it, so it
is never a button that would undo something other than what you just did.

**Deleting a published track no longer frees up its web address.** This one was
quiet and it mattered. A track's address — the `/listen/?a=name` in a share
link, in every post that embeds it, and in the id every podcast app uses to
recognise an episode — used to become available again the moment you deleted the
track. Name a new track the same thing and it inherited that address: the link
you'd shared started playing something else, and the new episode was invisible
to everyone already subscribed, because their app had seen that id before.
Nothing looked wrong anywhere.

A published track is now **retired** instead: the shelf keeps a dimmed
`// RETIRED` row showing the address it holds, the audio file is still deleted
from the CDN on the next publish, and nothing new can ever take that address.
Your site shows no trace of it. A track you never published still goes to the
trash exactly as before — nothing was pointing at it yet. And **↩ UNDO RETIRE**
brings it straight back until you publish, because up to that moment the file
deletion has only been queued.

**Your trash survives a refresh.** Delete something, reload the console, and it
used to be as if you'd never deleted it — the ↩ RESTORE button was gone, the
next sync could quietly bring the item back, and publishing could refuse to run
when you'd deleted the last item on a page. All three are fixed. The trash is
now saved the same way your pending file cleanups already were.

---

## 2026-09-01 (your podcast feed, ready for Apple — and findable)

> ⚠️ **ACTION REQUIRED — only if you want your show in a podcast directory.**
> Apple Podcasts refuses a feed missing any of **three** fields, and until now
> your site had a config key for one of them. Add the other two to
> `site.config.js` before you submit anywhere:
>
> ```js
> podcast: {
>   image: '/assets/podcast-cover.png',   // square, 1400×1400 or larger
>   category: 'Arts',                     // one of Apple's fixed categories
>   owner: { name: 'Your Name', email: 'show@example.com' },
> },
> ```
>
> `site.config.example.js` lists every category and every optional field. **Your
> console now tells you which ones you are still missing** — Audio shelf, top of
> the page — so you can check before you submit rather than after a rejection.
> If you have no podcast, or you never submit it anywhere, nothing here needs
> doing: your feed keeps serving exactly as before.

**Your feed can now be accepted by a podcast directory.** It was always valid —
it just quietly omitted things Apple treats as mandatory, and the only way to
find that out was a rejection email days later. The feed now carries a category,
an owner contact, a copyright line, a language, and whether the show is explicit
or episodic — each one only when you have actually said so. Two optional extras
came along: **`podcast.locked`** tells hosting platforms they may not import your
show without asking you first (the whole reason to host it yourself, in one
line), and **`podcast.funding`** puts a support link inside the listener's
podcast app, next to the play button.

Nothing is filled in for you. Your contact email is **never** reused as the
show's owner address — a podcast feed gets republished by Apple, so that address
becomes public the moment you submit, and that is your decision to make. The
same goes for the copyright line: it is a legal claim, and the engine does not
write one on your behalf.

**Your console now shows you the feed.** The Audio shelf has a card at the top
with the feed's address and a COPY button — the "where is my feed link" answer,
which previously you had to already know. Under it: how many of your tracks are
actually in the feed, and a checklist naming the exact setting still standing
between you and a submission, with one sentence on what each one gets you. With
nothing marked as an episode it says so plainly instead of showing you a list of
problems with an empty show.

**People can now find your feed.** Nothing on the site pointed at it before —
not the pages, not the sitemap, not the export. Now: podcast apps and search
engines discover it from any page on your site, it is listed in your sitemap
once you have an episode, it travels in **Export Site**, and **/listen grows a
Subscribe block** with the address and a copy button as soon as one of your
tracks is marked as an episode. A site with tracks but no episodes shows none of
this — demos are not a show.

**One thing deliberately left alone:** the address each episode is identified by
in your subscribers' apps. Changing it would make everyone who follows you
re-download your entire back catalogue.

---

## 2026-08-31 (undo on the audio shelf, and four fixes to publishing)

**Clearing your homepage audio card can now be undone.** It used to take up to
six tracks off with no warning and no way back — the order they were in was
simply gone. It now asks first, names the tracks, and leaves a **↩ RESTORE
CARD** button that puts the card back exactly as it was, until you close the
tab. The same button appears in the Cards view next to ↩ RE-PIN.

**Fixed: deleting something could cancel a different pending change.** If an
upload failed and you removed the failed row, the console quietly cancelled some
*other* item's pending change instead — so something you meant to publish
stopped being counted. Editing an item several times and then deleting it left
the opposite problem: a change counter stuck above zero for something that no
longer existed. Both now count correctly, and putting an item back out of the
trash restores exactly what it cancelled.

**Fixed: publishing could delete a file you had just re-uploaded.** Throw a file
away, add a new one with the same name, and publish would save your site
pointing at the new file and then delete it — with every step reporting success.
Uploading a file now cancels any pending deletion for that name. The Audio shelf
also stops you re-adding a track that is sitting in the trash, and points you at
↩ RESTORE, which brings its details back too.

**Fixed: removing a track you had published in the same session.** Audio (and
your Friends list) were missing from a step that runs after publishing, which
meant the console still thought those items were brand new. Three things went
wrong because of it: deleting a track you had just published showed no pending
change, so **Publish refused to run**; deleting your *only* track blocked the
publish outright; and renaming a track you had just published silently moved its
web address — breaking the link you had shared, every post that embedded it, and
its entry for anyone subscribed to your podcast feed.

**The Audio shelf looks like a list again.** It was being drawn into the photo
grid's layout, so every track sat in a narrow column with its six buttons
wrapped underneath, and most of the styling the page asked for did not exist at
all. Tracks now stack cleanly and fold sensibly on a phone.

Nothing for you to do — merge and publish once.

---

## 2026-08-27 (homepage pin fix)

**Fixed: a starred frame could land in the card only a tablet shows.** Your
homepage grid loads four cards but shows three — the fourth appears only on a
tablet held upright. If you had a **pulse live** and a **starred frame** (or a
featured track) at the same time, the pulse pushed your pin down into that
fourth card, so you starred something and nothing changed on your desktop or
phone homepage.

Pins now fill the row **from the top**, in order: a live pulse takes card 1, your
starred frame or featured track takes card 2, and your most recent work follows.
With no pulse live, the pin moves up to card 1. Card 3 is never a pin, so there
is always at least one genuinely recent thing on the page. Nothing for you to
do — just merge.

---

## 2026-08-24 (dark-frame fix)

**Fixed: retiring a frame now sticks after you publish.** When you retire a
published frame to a **dark frame** (it keeps its slot and number, but its
image is removed), that "retired" state used to be dropped the next time you
published — the frame came back as a *live* cell pointing at a photo that no
longer exists, so it rendered blank. Publish now keeps the dark-frame marker,
so a retired frame stays retired. Nothing for you to do — just merge.

---

## 2026-08-24 (the Cards view)

**New: a Cards view in your console that shows the homepage before you publish
it.** Open **Cards** in the console sidebar. It shows your homepage's card grid
twice, side by side: **what's on it right now**, and **what it will be after
your next publish** — with the slots that change marked (`NEW`, `REPLACED`,
`UNCHANGED`, `GONE`). No more "star something, publish, open the homepage, and
only then find out." The pulse card shows up too, marked as already-live so you
know it isn't waiting on a publish.

It isn't a mock-up of the logic — it *is* the logic. The preview runs the exact
code your public homepage uses to choose and order its cards, so what you see is
what you'll get, down to which card lands in which slot.

**New: star, crop and take a card down from the card itself.** The staged side
is interactive. On a photo card: `★ UNSTAR` to pull it off the homepage, or
`▯ CROP` to set the tall crop the card uses. On an audio card: take one track
off, or clear the whole card. Every one of these does exactly what the same
button does elsewhere in the console — it's the same action, now reachable from
the card you're looking at instead of three views away.

**New: one-tap undo, no thinking required.** Because your homepage shows exactly
one starred photo, starring a new frame un-stars the old one automatically (this
fixes a real snag where starring an *older* frame appeared to do nothing). If
that wasn't what you meant, a **↩ RE-PIN** button names the frame that just
stepped down — one tap puts it back, crop and all. And any frame you've featured
before shows up on a small "ready to re-feature" row, so bringing it back is
always one click.

Nothing to do — merge and it's there. No new Cloudflare resources, no config, no
change to how publishing works: the cards still go live through your normal
publish, exactly as before.

## 2026-08-24

**Fixed: on a phone, the Pulse card no longer shrinks away while you type.** With
the on-screen keyboard up, the card was the only part of the screen that could
give up room — so it gave up all of it, and the line you were writing got squeezed
out of the card entirely. Now, while the keyboard is up, the things you are not
using step aside (the lane row, the starter suggestions, the colour dots) and the
card keeps the space. They all come back the moment you put the keyboard away.

**Changed: the glyph picker is one menu, and it holds everything.** It used to
show only the twelve glyphs belonging to whichever lane you had open, so picking
"Photography" quietly took the rest away. Now every discipline is in the same
menu under its own heading — scroll through the lot — with the lane you are in
marked at the top. The glyphs are bigger, and the menu closes on a tap outside or
the Escape key.

**Changed: add and remove glyphs freely, without wiping your card.** Tap a glyph
to add it; tap it again to take it off. Every glyph on your card also shows as a
little chip at the top of the menu with an ✕ — tap that to remove just that one.
The menu stays open while you experiment, so you can try a few combinations
against your line without it disappearing every time, and your writing is never
touched. (Before, the only way to drop a glyph was RESET CARD, which cleared
everything.)

**New: any emoji you want, from your own keyboard.** There is a small field at
the top of the glyph menu. Tap it, use your phone or laptop's own emoji key, and
whatever you pick goes on the card. Nothing extra is downloaded to your site —
it's your device's emoji picker, so it always has everything and it always
matches what your readers' devices can draw. The curated glyphs stay for when you
just want something quick. On a phone, when your keyboard's emoji panel opens, the
menu steps aside so you can still see your card while you pick.

Nothing to do — merge and it's there.

**Changed: the Field Notes editor is rebuilt.** Writing a note used to happen in
a box beside a live preview, which only really fitted on a laptop — on a phone or
a tablet the buttons wrapped onto two and three rows, the row jumped every time
your work auto-saved, and the writing area fought the on-screen keyboard.

It is one page now. Your note sits in the middle of the screen the way a page
sits on a desk: cover picture, title, a single line for the date and place, and
the writing. Nothing scrolls except the page.

What moved:

- **Preview is a button, not a second column.** `◫ PREVIEW` slides the rendered
  note in over your writing; close it and it goes away. `↗ REAL PAGE` inside it
  still opens the true published page in a new tab.
- **One list of notes** instead of two dropdowns — drafts and published in the
  same list, and it always shows which one you have open.
- **The insert tools are together.** FRAMES, DAYS, PICTURE, VIDEO, MUSIC and
  AUDIO live on one floating bar at the bottom. On a phone or a tablet in
  portrait they collapse into a single `⊕ INSERT` button that opens the same
  drawer, and PREVIEW / SAVE / ▲ STAGE move down to your thumbs.
- **The save indicator has its own reserved space**, so watching it can no longer
  shove the buttons around.
- **`⌘P`** toggles the preview. Everything else you knew still works: ⌘B, ⌘I,
  ⌘K, ⌘↵ to stage, Esc to leave focus mode.
- **Fewer controls, on purpose.** The `TITLE ▾` collapse is gone (the fields it
  hid are one short line now, so there was nothing left to reclaim), and the
  hide-the-bottom-nav toggle moved into the new `⋯` menu along with focus mode
  and delete.

Nothing about your posts changed — same Markdown, same files, same publish. This
is the editor around them.

**Nothing to do.** Your browser may hold the old console for one load; a refresh
picks up the new one.

---

## 2026-08-23 (evening)

**Fixed: a brand-new site no longer shows an error page to Google.** Your site
has a plain-text listing of your archive at `/archive/manifest.html` — it's what
search engines and the Internet Archive read. On a site that hadn't published
any archive entries yet, that page returned a server error instead of just being
empty, and your sitemap was pointing search engines straight at it. Now it
renders an empty page until you have work in it, which is the truth. If a read
genuinely fails it still reports an error, so an outage can't get mistaken for
"this archive is empty" and archived that way. No action required.

**Fixed: your changes now appear as soon as the deploy finishes.** Publishing
saves to GitHub, Cloudflare rebuilds, and your site goes live — but for up to
five minutes *after* that rebuild finished, the site could still hand visitors
the previous version of your data. It was a cache that had no idea a new
version had shipped. That's why a correct publish could look like it hadn't
worked, and why opening a private window didn't help: the stale copy was
sitting at Cloudflare, not in your browser.

The cache now knows which deploy it belongs to, so a new build simply doesn't
see the old copy. Same speed for repeat visitors, no more waiting for a timer
to run out.

**⚙️ Worth doing after you merge this one.** The fix uses one small setting in
`wrangler.jsonc` — the file you always keep your own version of. Open yours and
add these three lines near the top, alongside `"observability"`:

```jsonc
"version_metadata": {
  "binding": "CF_VERSION_METADATA"
},
```

Nothing breaks if you skip it — your site behaves exactly as it does today. You
just don't get the improvement. New forks get it automatically.

**Also: the homepage picks up a new starred frame within a minute.** The bit of
your site that decides which photo is pinned to the homepage was telling
browsers to hold onto their copy for five minutes. Now it's one minute, and
repeat visitors still get an instant page while the fresh copy loads behind it.

**New: you can ask your site which version it's running.** Visit
`your-site.com/api/version` (or `curl` it from a phone) and it tells you which
deploy it's currently serving and when that went live. Handy for the one
question that used to have no answer: "has my publish actually landed yet, or
am I still looking at an old copy?"

## 2026-08-23 (later the same day)

**Fixed: settings you set before a photo's first publish no longer get lost.**
If you dropped a photo in, set its focal point or starred it, and published —
those settings often didn't make it. You'd go back, set them again, publish a
second time, and it would stick. Not you: a real bug, and this closes it.

What was happening, in plain terms: publishing saves your work to GitHub, and
the console used to immediately fetch it back a couple of seconds later to stay
in step. But GitHub's "read" side runs a few seconds behind its "write" side, so
that fetch could return the *older* version of your data — and the console
trusted it over what was on your screen, quietly undoing the settings you'd just
made. The counter still said you had changes, so publishing again worked.

Three things changed. The console no longer re-fetches after publishing (it
already knows what it just saved). When it does sync, it now asks GitHub for one
exact version rather than "whatever main is right now", so it can't get a mix of
new and old. And it now keeps track of *which specific items* you've edited, so
a sync — or closing the tab — can't overwrite an edit you haven't published yet.
**No action required.** If you had frames that lost their settings, they were
never published with them; set them once more and this time they'll hold.

**New: the publish page tells you what you're about to publish.** The summary
cards along the top showed a count — "+3 ▲" — and that was all you got. Now tap
any card with changes and it opens a list of exactly what changed: *f#241 — card
crop*, *RAW card: f#242 ← f#241*, a post's title with *— hero layout*. Repeated
tweaks to the same item collapse into one line with a ×3 rather than three
lines.

**Changed: the Publish button is now a light, not a counter.** The button in the
top-right no longer carries a number — it's simply lit when you have unpublished
work and unlit when you don't. The number hasn't gone anywhere: it's in the
status text beside it ("17 PENDING"), on the Publish tab badge on iPad, and
itemised on the publish page itself. As the console grows more kinds of changes,
a single big number was becoming something you couldn't act on. No action
required.

## 2026-08-23

**New: a field note can lead its homepage card with its picture.** Field notes
have always rendered on the homepage as a typographic tile — kicker, title, a
short tease. Now each note can instead lead with its own hero image: the
picture fills the card the way an archive frame does, the title sits under it,
and a small **Field Note** chip in the corner says what it is. No headline
stamped across the photograph.

It's per post and off by default, so every note you already have looks exactly
as it did. To switch one on, open it in Field Notes and press **▢ HERO CARD**
next to ◎ FOCAL on the hero slot — the button only appears once the note has a
hero image. It applies on stage/update like the focal point does, and publishes
with the post.

Two things worth knowing: the card crops tall (4:5), so a hero framed for the
wide post banner may want its own crop — ◎ FOCAL steers both. And if the
picture ever goes missing, the card quietly goes back to being a text tile
rather than showing a broken image. No action required.

**Changed: starring a buffer frame for the homepage now un-stars the previous
one.** The homepage shows exactly one RAW card, but the star used to just add a
flag — star a second frame and both stayed starred, with the newest capture
date winning silently. Starring an older frame looked like it did nothing.
Now the star is exclusive: starring a frame steps the previous one down in the
same click, and the toast names the frame that yielded. The displaced frame
keeps its 4:5 card crop, so re-starring it later is one click. Data published
by an older console (several starred frames) still renders fine — newest wins,
and the flags heal the next time you star anything. No action required.

**Internal: the homepage grid renders through a card engine now.** The four
card builders (photo, text, audio, pulse) sit behind a small registry with a
per-kind layout seam — groundwork for optional card layouts (a field note
leading with its hero image is first up). With no layout chosen, the grid's
markup is byte-for-byte identical to before — a test compares the new renderer
against captured output from the old one — so nothing about your homepage
changes until you choose something. No action required.

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
>
> **Correction, 2026-09-01:** cover art is not Apple's only requirement — a
> category and an owner email are mandatory too, and there were no config keys
> for them until that date's entry above. Follow that one instead.

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
