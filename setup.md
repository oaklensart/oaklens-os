# Worker Setup

There are two ways to stand up an instance. Pick one.

> **Already deployed and wondering what to do next?** This file is the install
> and the operating manual. **[quickstart.md](quickstart.md)** is the half hour
> after it — the settings and console moves that a finished install has no way to
> discover on its own.

## First, either way: you need a repo you can push to

Your site publishes by **committing to your own GitHub repo** — you write a
post in the Field Console, it saves to GitHub, and (once connected) Cloudflare
rebuilds the site from there. So the copy of this code you work from has to be
one you can push to.

- **The one-click button does this for you.** It copies the repo into your own
  GitHub account as part of the install. Skip ahead.
- **Going the CLI route? Fork first.** Use the **Fork** button (or *Use this
  template*), then clone **your fork**:

  ```bash
  git clone https://github.com/YOUR-USERNAME/YOUR-REPO
  cd YOUR-REPO
  ```

> **Why this matters more than it looks.** If you `git clone` the upstream
> repo instead of forking, everything below still works — resources get
> created, the site deploys, the console loads. It breaks later, at your first
> **Publish**, because you cannot push to a repo you do not own. That failure
> arrives hours after its cause, which is exactly the kind that wastes an
> afternoon. Fork now.

## The quick way — one click

If this repo is published behind a **Deploy to Cloudflare** button, clicking it
does the whole thing in a browser: it copies the repo into your own GitHub
account, creates your photo storage, database and subscriber list on your
Cloudflare account, wires them up, and deploys. It also sets up automatic
redeploys, so from then on saving a change publishes it.

The button URL is your repo's URL wrapped like this:

```
https://deploy.workers.cloudflare.com/?url=https://github.com/<owner>/<repo>
```

Two things the engine does so that flow can work at all:

- **Your password.** The dialog can ask you for secrets, but it cannot ask you
  to produce a bcrypt hash. So the login accepts either `AUTH_PASSWORD_HASH`
  (scrambled — what `setup.sh` writes) **or** `AUTH_PASSWORD` (the password
  itself). If both are set, the scrambled one wins. To have the dialog ask for
  it, uncomment the `"secrets"` line in `wrangler.jsonc` — but read the note
  there first: a secret listed that way becomes *required* to deploy, which
  blocks the CLI route below.
- **The signing key.** `SESSION_SECRET` needs no dialog. Leave it unset and the
  Worker generates a real 32-byte key on first use and keeps it in your KV
  namespace. Nobody has to invent random text.
- **Your database tables.** The button creates the database, and the tables
  come from the repo's own deploy step: `package.json`'s `deploy` script runs
  `npx wrangler d1 migrations apply DB --remote` before every deploy (Cloudflare
  runs that script on the button path — the button does *not* apply migrations
  on its own). The migration files are idempotent, so re-running them is
  always safe. And if a deploy ever happens without them, nothing breaks
  loudly: the features that need a table answer "not configured yet" with the
  exact command to run, instead of erroring.

  Three tables get created, one per feature that needs one:

  | Table | Feature |
  |---|---|
  | `fn_drafts` | Field Notes cloud drafts — write on one device, finish on another |
  | `bench_entries` | the Bench, the RAW-file queue |
  | `pulses` | **Pulse** — the immediate card on your homepage |

  ⚠️ **Adding a table later is the one case this does not cover.** If you
  connected your repo (below), your Deploy command is `npx wrangler deploy`,
  which skips the migration step — so an engine update that adds a table brings
  you the code and not the table. When that happens the console says so plainly
  and names the command; run
  `npx wrangler d1 migrations apply <your-database-name> --remote` once and it is
  fixed. `pulses` is the first table this has applied to.

## Before either way: switch on R2

Every other Cloudflare service used here works the moment you have an account.
**R2 — the photo and video storage — does not.** It needs a one-time
subscription added from the dashboard, and there is no CLI equivalent: wrangler
answers `code: 10042 — Please enable R2 through the Cloudflare Dashboard` and
cannot do anything about it.

> Dashboard → **Storage & databases** → **R2 Object Storage** → **Overview** →
> **Add R2 subscription to my account** → complete the checkout.
> Some accounts shorten it to **R2**, and some show it directly in the sidebar
> with no "Storage & databases" above it. Cloudflare is rolling a redesign out
> account by account, so both are current.
>
> Done correctly, you land on an R2 overview reading `$0.00` billable usage,
> *No billable usage incurred yet*, and `0 B` total storage. There is an **Add
> Budget Alert** button on that panel; setting it is a good habit and a good
> thing to recommend to anyone you hand this to.

**The checkout asks for a payment method and still bills nothing.** Card, Apple
Pay, Google Pay, PayPal or bank, plus a billing address; the page reads
`Total Due Now $0.00` / `$0 per month`, and the authorisation is for usage
*above* the free allowance. Cloudflare may place a temporary hold to validate
the payment method. This is worth saying out loud in your own docs if you fork
this: it is the single most likely place a non-technical installer stops,
because "free" and "enter your card" arriving together reads as a trap.

Verified against the real checkout, 2026-08-08. The free allowance is 10 GB
storage, 1 M Class A (write) operations and 10 M Class B (read) operations per
month. For this engine that is roughly 25,000 photographs (about 350 KB each
across the three generated sizes), and reads are cheaper than they look because
`handleCdnProxy` serves repeat views from `caches.default` (manual §3.4). The
binding constraint on a fork is the Workers free tier's 100,000 requests/day,
not R2.

Skip it and the first `npx wrangler deploy` dies on a bucket that does not exist.
`setup.sh` now checks for this before it creates anything and stops with these
instructions, and `doctor.sh` reports it — but neither can flip the switch for
you.

## The guided way — one command

```bash
npx wrangler login      # sign in to Cloudflare
bash scripts/setup.sh   # eight steps, asks a few questions, ends with your site live
bash scripts/doctor.sh  # confirms it all worked
```

`setup.sh` creates the same resources and never asks you to copy an ID out of
your terminal. It also **deploys for you** and prints the resulting
`.workers.dev` address — both on purpose:

- The two required secrets are stored *on a Worker*, so until something has
  deployed there is nothing to attach them to. Wrangler asks whether to create
  the Worker and reads the answer from stdin, which is the same stdin the secret
  is piped to, so the prompt eats the secret and the command fails. Deploying
  first removes the whole failure mode.
- The address otherwise scrolls past inside wrangler's output, and people
  genuinely could not find their own site.

It also **commits your filled-in `wrangler.jsonc` and `site.config.js`** before
it deploys. That is not tidiness: those two files ship *tracked and full of
placeholders*, `setup.sh` fills them in on your computer only, and Cloudflare
Builds deploys from what is on **GitHub**. Committing here removes the step
people forget. Pushing is still yours to do — see "Connect your repo".

Everything below is the manual version of what it does.

> **On Windows, run these in Git Bash** — the terminal that comes with
> [Git for Windows](https://git-scm.com/downloads), not PowerShell and not
> Command Prompt. `setup.sh` and `doctor.sh` are shell scripts; PowerShell will
> say it doesn't recognise `bash` and stop there. WSL works too if you already
> have it. Everything else in this file is the same on every platform.

After you're live, finish the job: **connect your repo** (section below). It is
not an extra — it is what makes the Field Console's Publish button put anything
live. Until you do it, Publish saves your work to GitHub and your site carries
on serving the old copy.

---

## Install dependencies

```bash
npm install
```

## Generate bcrypt password hash

```bash
node -e "const b = require('bcryptjs'); b.hash('YOUR_PASSWORD', 12).then(h => console.log(h))"
```

## Set worker secrets

Only two secrets are **required** — a fresh instance runs with just these:

```bash
npx wrangler secret put AUTH_PASSWORD_HASH
# paste the bcrypt hash from above
# (or set AUTH_PASSWORD to the password itself — see "one click" above.
#  The hash wins if both are set.)

npx wrangler secret put SESSION_SECRET
# paste a random 32-char string, e.g.: openssl rand -hex 32
# (optional: with a SUBSCRIBERS KV binding the Worker generates and stores
#  one itself on first use, so you can skip this one entirely.)
```

Everything else is **optional** and gates one feature — with one exception,
next. `GITHUB_TOKEN` + `GITHUB_REPO` are what the Publish button runs on, and a
site you cannot publish from is a demo. Treat them as required. Until a secret is set,
its endpoint answers `501 { notConfigured: true }` and the console shows
"not configured" instead of an error. The worker logs which features are off
(`[health] …`, once per isolate — visible in `npx wrangler tail`).

### `GITHUB_TOKEN` + `GITHUB_REPO` — what makes Publish work

These two are worth doing carefully; they are the fiddliest part of the whole
install, and together they are what lets the Field Console save your photos
and posts to your repo. Until both are set, Publish answers *"not
configured"* — deliberate, not a fault, but also not a finished site.

**One token, two jobs.** The same fine-grained token is what git asks for as a
"password" when you push (see "Connect your repo"). Make it once, save it once,
use it in both places.

**Make the token** (GitHub → your avatar → **Settings** → **Developer
settings** → **Personal access tokens**). Two kinds exist; the first is
better:

- **Fine-grained** (recommended) → *Generate new token*
  - **Token name / Description:** labels for your own benefit — nothing
    depends on the exact words. A name like "My site" and an empty
    description are fine.
  - **Expiration:** if you'd rather not think about it, pick the longest
    GitHub offers; the 90-day default is also fine if you prefer a shorter
    leash. When it expires, Publish starts failing and the console will say
    the token was rejected — that is your cue to make a new one and re-run the
    command below, not a sign anything broke. Your `git push` will start
    failing at the same moment, for the same reason. A calendar note near the
    date turns the surprise into a chore.
  - **Repository access:** *Only select repositories* → pick your site's repo.
  - **Permissions:** *Repository permissions* → **Contents** → **Read and
    write**. That is the only one needed — it covers both the reading and the
    committing your site does. Leave everything else alone. (GitHub adds
    **Metadata: Read-only** by itself and marks it *Required* — that is
    normal, leave it too.)
- **Classic** → *Generate new token (classic)*, scope **`repo`**. Simpler to
  find, but it grants access to **every** repo you own, so prefer fine-grained.

**Then set both secrets:**

**The token is shown exactly once.** Put it in your password manager on the
page that shows it, not afterwards — there is no way to look it up later, only
to throw it away and make another.

```bash
npx wrangler secret put GITHUB_TOKEN
# paste the token you just made

npx wrangler secret put GITHUB_REPO
# value: owner/repo — e.g. yourname/your-site. Just those two parts, no
# https://, no .git, no branch. Copy it from your repo's address bar rather
# than typing it: a typo here does not fail loudly — every GitHub call the
# worker makes just answers "Not Found".

npx wrangler secret put ADMIN_KEY
# key for /api/subscribers/export

# B2_BUCKET_NAME + B2_KEY_ID + B2_APP_KEY (+ B2_ENDPOINT/B2_REGION overrides)
#   — bench RAW cold-storage proxy
# ARCHIVE_S3_ACCESS + ARCHIVE_S3_SECRET
#   — daily Wayback archive cron
```

**Then prove the pair works, end to end — thirty seconds.** In the Field
Console, open **Publish** and press **↓ Sync from GitHub**. Green with a list
like `buffer:0 · archive:0 · …` means token and repo name both work. A red
message naming a repo means `GITHUB_REPO` has a typo — the message shows
exactly what the worker asked for, so compare it against your repo's address
and re-run the command. "Bad credentials" means the token itself — re-run
`npx wrangler secret put GITHUB_TOKEN` with a fresh one.

## Deploy

```bash
npx wrangler deploy
```

## Connect your repo — this is what makes Publish work

**Not optional.** When you hit **Publish** in the Field Console, your changes are
committed to your GitHub repo. Whether they then *appear on your site* depends
on one thing: whether Cloudflare is watching that repo.

- **Repo connected:** Cloudflare notices the commit, rebuilds, and your site
  updates in about a minute. Publish → done. No terminal.
- **Repo not connected:** the commit happens, the console says it published, and
  your live site keeps serving the old files until you run `npx wrangler deploy`
  yourself. Nothing looks broken. That is the trap.

(The one-click **Deploy to Cloudflare** button sets this connection up for
you — this section is for everyone who used `setup.sh` instead.)

### Do these in order. The order is the whole thing.

**1. Get your settings onto GitHub, before you connect anything.**

`wrangler.jsonc` is tracked in git and ships full of placeholders.
`setup.sh` fills it in **on your computer**. Cloudflare Builds checks out
**GitHub's** copy. If those two disagree at the moment you connect, the first
build reads the template and:

- deploys under the name `your-worker-name` instead of yours,
- **auto-provisions a junk R2 bucket literally called `your-bucket-name`**,
- and dies on `KV namespace 'YOUR_KV_NAMESPACE_ID' is not valid. [code: 10042]`.

Your site keeps running on its last hand-deploy throughout, so nothing tells
you. Verified on a real install, 2026-08-08.

```bash
git add -A
git commit -m "my site's settings"
git push
```

Then **look at `wrangler.jsonc` on github.com** and check it says your worker
name, not `your-worker-name`. Thirty seconds, and it is the only proof that
matters.

> **The push asks for a username and a password, and the password is not your
> password.** GitHub stopped accepting account passwords over git years ago; what
> it wants is a **personal access token** — the same one from
> `GITHUB_TOKEN` above, if you have made it, since a fine-grained token with
> **Contents: Read and write** works for both jobs. Your real password is
> rejected with an authentication error that looks like a broken login and is
> not. Paste the token where it says Password.

**2. Connect the repo in the Cloudflare dashboard.**

**Compute → Workers & Pages** → your Worker → **Settings** → **Build** →
**Connect a repository**, and pick your site's GitHub repo.
*(Accounts still on the older sidebar have **Workers & Pages** at the top level,
with no **Compute** above it. Same destination.)*

GitHub will ask you to install the **Cloudflare Workers and Pages** app. "Only
select repositories" is enough — you do not have to grant it everything you own.

Then, in the panel that appears:

| Field | What to put |
|---|---|
| Build command | **Leave empty.** This site has no build step. |
| Deploy command | `npx wrangler deploy` — already filled in; leave it. |
| Production branch | `main` |
| Builds for non-production branches | **Untick it.** Your site deploys from `main` only. |

**3. Turn the flag on, and let that be the first build.**

In `site.config.js`, change `repoConnected: false` to `true`. It ships as a live
line, so this is an edit, not an uncomment. It only changes what the console's
Publish screen tells you — but an honest console is the difference between
"published" meaning something and meaning nothing.

```bash
git add site.config.js
git commit -m "repo connected"
git push
```

Cloudflare's Build panel says *"You can now push a commit to your Git repository
to start your first build"* — this is that commit. Watch it under the
**Deployments** tab; it should finish green in about a minute.

**4. Prove it.** Open the Field Console, change something small, press
**Publish**, and watch a new build appear. That is the loop working. If no build
appears, the repo is not really connected; if a build appears and fails, read
step 1 again.

### If you connected before reading this

Two things to clean up, neither urgent:

- **The junk bucket.** Cloudflare made an R2 bucket called `your-bucket-name`.
  It is empty and costs nothing, but delete it so it never confuses you:
  dashboard → **R2** → `your-bucket-name` → Settings → Delete, or
  `npx wrangler r2 bucket delete your-bucket-name`.
- **The name-mismatch banner.** Cloudflare shows an orange
  *"Update wrangler.jsonc in your repo to keep settings consistent"* box, and
  offers to open a pull request fixing the name. Don't take it — it fixes one
  line and leaves the KV and R2 placeholders. Push your real config instead,
  and the banner goes away on the next build.

### The one habit that changes

Once connected, **your repo is the source of truth**. Going forward you go live
with `git push origin main` (or by hitting Publish), and you **stop running
`npx wrangler deploy` by hand**. A hand deploy is not in the repo, so the next
publish-triggered rebuild quietly puts things back the way the repo has them,
undoing it.


## Keeping your site up to date with the engine

Your site is a **fork**. It's yours — your config, your photos, your changes —
but the engine underneath it keeps getting fixes. Here's how to take them.

Do this once, to tell git where the engine lives:

```bash
git remote add upstream https://github.com/oaklensart/oaklens-os.git
```

Then whenever you want the latest:

```bash
git fetch upstream
git merge upstream/main
```

Run `npm test` afterwards, and if it's green, `git push origin main` — your site
redeploys itself.

**Read [CHANGELOG.md](CHANGELOG.md) first.** It lists what changed since your
last merge, and flags the rare entry that needs you to *do* something (create a
Cloudflare resource, change a setting) rather than just merge. Anything not
flagged is safe to take without reading further.

**Two files will conflict, and it's the same two every time:** `site.config.js`
and `wrangler.jsonc`. That's not a bug. Those hold *your* identity and *your*
Cloudflare resources, while the engine ships example versions of both. **Always
keep yours:**

```bash
git checkout --ours site.config.js wrangler.jsonc
git add site.config.js wrangler.jsonc
```

For anything else that conflicts, take the engine's copy (`git checkout --theirs
<file>`) unless you deliberately changed that file yourself.

> **Worth a skim before you merge:** the engine's `site.config.example.js`
> sometimes gains new options, and `wrangler.jsonc` occasionally gains a new
> setting that matters (`preview_urls: false` was one — it stops every deployed
> version from getting its own public address, which you want on a site with an
> admin console). Diffing your two files against the examples after a merge
> takes a minute and is worth it.

**If you started from the "Deploy to Cloudflare" button:** that copied the code
into a brand-new repo rather than a git fork, so your history and the engine's
have nothing in common. Your *first* merge needs an extra flag and will report
conflicts on a lot of files at once:

```bash
git merge upstream/main --allow-unrelated-histories
```

Resolve them the same way (yours for the two config files, the engine's for the
rest). It's a one-time tax — after that first merge the two share history and
updates are ordinary.

## Join a webring (optional)

Webrings are the old-web way of finding good work: a set of independent sites
that link to each other, so a visitor to one can wander to the rest. No feed, no
algorithm, no company in the middle.

**ANALOGS.NETWORK** ([analogs.network](https://analogs.network)) is one, for
people who run their own sites — photographers, writers, artists, coders. This
engine has built-in support for it, switched **off**. Nothing appears on your
site, and nothing links anywhere, until you decide to join. That is deliberate:
forking someone's code should never sign you up to their network.

**If you want in:**

1. Email `themonitor@analogs.network` with your site, your name, and what you
   make — or open a pull request adding your node file to the registry at
   [github.com/oaklensart/analogs.network](https://github.com/oaklensart/analogs.network).
   Either way a person reads it and adds you by hand.
2. When you're merged you get a **permanent node number** and a slug.
3. Put them in `site.config.js`:

   ```js
   webring: { node: 7, slug: 'your-slug' },
   ```

That's it. Your footer grows a small `ANALOGS //007` chip next to the `OS` one,
and your site starts serving a one-line ownership claim at
`/.well-known/analogs.txt`. The claim is optional but worth having: because only
you can serve a file at your own domain, it's what lets you change or remove
your listing later without an email round-trip, and what protects your number if
the domain ever lapses.

You are never required to display anything. Remove the `webring` line and
everything goes away again.

### The `OS` chip

Your homepage footer carries a small `OS` chip linking to the project this site
runs on. It's two letters on one page, it loads nothing, and it's there so a
visitor who likes your site can find out how to make their own.

If you'd rather not have it, remove it:

```js
poweredBy: false,
```

No hard feelings and no licence problem — the MIT licence never asked for
attribution on your pages.

## Short links on your own domain (optional)

Sooner or later you'll want to say a link out loud, or print one on a card, or
post one where the full URL looks terrible. You can make your own domain do
that. In `site.config.js`:

```js
shortLinks: {
  prints: 'https://your-print-shop.example/gallery',
  talk:   'https://some-conference.example/schedule/you',
},
```

Now `yoursite.com/prints` sends people to your shop. The real value shows up
later: when the shop moves, you change this one line and every card, post and
business card you already handed out keeps working.

A few rules, all of them friendly:

- **One lowercase word** — letters, digits and hyphens. No slashes, no dots.
- **It can't hide your own pages.** Name one `about` and it's simply ignored;
  your About page still wins. Same for anything the site itself uses.
- **The destination has to be a full URL**, starting `https://`.
- **Nothing is cached**, on purpose — that's what lets you re-point a link and
  have it take effect immediately instead of a year from now.

Leave the setting out entirely and nothing redirects, which is how a fresh site
ships.

**If you run more than one hostname**, you can give the links to just one of
them:

```js
shortLinkHost: 'go.',
```

Now `go.yoursite.com/prints` works and `yoursite.com/prints` doesn't — it stays
a normal path on your main site. Useful if, like this site, you keep a
subdomain for a different side of what you do and want the links to belong
there rather than to everything. Leave it out on a single domain. (One thing to
know: scoped links won't answer on `localhost`, so test them on the real
address.)

## Console access (secure by default)

The Field Console document (`/dev/field-console`) is served only to an
authenticated session: your first visit shows a minimal login page, and the
same password that authenticates the API also sets a 30-day `console_shell`
cookie that unlocks the page. No extra secrets or steps — it rides on
`AUTH_PASSWORD_HASH` + `SESSION_SECRET`. Logging out from the console's
settings re-locks it. If you genuinely want the shell public again (nothing
sensitive on the instance), set `consoleShellPublic: true` in `site.config.js`.

### Optional hardening: Cloudflare Access (recommended)

For sites holding anything private (client work, a subscriber list),
add an identity wall at Cloudflare's edge — enforced **before** any request
reaches the worker, free for up to 50 users, zero code:

1. Cloudflare dashboard → **Zero Trust → Access controls →
   Applications → Add an application → Self-hosted**.
   *(This sidebar entry has been renamed in both directions. Accounts on the
   older dashboard show it as **Cloudflare One**; the redesigned one says
   **Zero Trust**. Same screens either way — go by whichever you can see.)*
2. **Click "+ Add public hostname" first**, before touching anything else.
   Then **delete the pre-filled Private IP row** — leaving it blank is not
   enough, and the save fails with
   `use_clientless_isolation_app_launcher_url can only be enabled for apps
   with private destinations`.
3. Add **two** destinations (domain = your apex, subdomain blank):
   path `dev/field-console` **and** path `dev/field-console.html`. The worker
   answers on both (`worker.js`, console-shell gate) and the service worker
   uses the `.html` form — gate only one and the other stays open.
4. Name the app, set **Session Duration** (1 week is a sane default).
5. Build the policy under **Access controls → Policies → Add a policy**:
   Action *Allow*, Include → *Emails* → your email. Then attach it to the app
   (**Applications → your app → Access policies → Add current policies**).
   An app with no policy is not protected — verify the Policies column shows
   your policy, not `--`.

Leave `/api/*` out of the Access app — the console and the `bench-upload.sh`
CLI authenticate those with the bearer token.

**Pick a login email on a different provider than the domain you're gating.**
An address on the gated domain is delivered via that domain's MX records, in
the same account holding the lock — so a DNS mistake locks you out, and an
account compromise lets an attacker repoint MX and receive the code. An
independent mailbox (or a passkey-backed account login) breaks the loop.

Verify before trusting it: in a private window, both console URLs should
challenge, and your apex + `/dev` should not.

## Smoke tests

```bash
# Login
curl -s -X POST https://your-site.example/api/auth \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://your-site.example' \
  -d '{"password":"YOUR_PASSWORD"}' | jq .

# Sync (replace TOKEN)
curl -s "https://your-site.example/api/sync?files=data/buffer.json" \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Origin: https://your-site.example' | jq .

# Upload test (replace TOKEN)
echo "test" > /tmp/test.webp
curl -s -X POST https://your-site.example/api/upload \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Origin: https://your-site.example' \
  -F 'files=@/tmp/test.webp;filename=archive/test-480w.webp' | jq .
```

---

## Next

Your site is up and you can sign in to the console. **[quickstart.md](quickstart.md)**
takes it from there: picking one of the five looks, turning pages on and off,
the Apple Music and analytics switches, setting focal points so thumbnails crop
where you want, putting a photograph on your homepage, making the card people
see when they share your link, and publishing. About half an hour, one step at
a time.
