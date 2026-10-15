# Customizing your site

What to change, where, and what each kind of change means the next time you
update. Written for you, and for any AI you ask to help. It is short on
purpose: most changes are one line in one file.

> **If you are an AI helping the owner:** read this whole file before changing
> anything, and follow [Rules for AI helpers](#rules-for-ai-helpers). For words
> and settings, this file is all you need. Before changing code (`js/`, `css/`,
> `src/`, `worker.js`), also read [`CLAUDE.md`](CLAUDE.md).

## First: how updates work

Your site is your own copy of the engine. When the engine improves, you can
take the update by merging it into your copy. **Updates are opt-in**: nothing on
your site changes unless you merge one, and never updating is a valid choice.
You just don't get the fixes.

Some changes you make will carry through every update untouched, some may need
redoing, and some become yours to keep working. That's the three kinds below,
and it's worth knowing which one you're making *before* you make it.

If you installed with the Deploy to Cloudflare button, your **first** update needs a
computer with a terminal, once. After that, updates are ordinary. See
[Keeping your site up to date](setup.md#keeping-your-site-up-to-date-with-the-engine).

## The three kinds of change

| Kind | What it covers | At update time |
|---|---|---|
| **Safe** | `site.config.js`, and everything you do in the console: posts, pictures, audio, Pulse | Carries through. `site.config.js` shows as a conflict on every update, by design: keep yours |
| **Watch** | Words written into a page file, like the About page | Usually fine. If an update changes the same file, you redo your edit; the update names the file |
| **Yours to maintain** | Anything in `js/`, `css/`, `src/` or `worker.js` | Works today. Not promised to survive the next version: keeping it working is on you |

When the same result is possible more than one way, pick the Safe way.

## I want to change…

| Change | Where | Kind |
|---|---|---|
| Site name | `site.config.js` → `name`, and `wordmark` (the logo text) | Safe |
| Tagline | `site.config.js` → `tagline` | Safe |
| Contact email | `site.config.js` → `email`. Every email link on the site is filled from it | Safe |
| City in the footer | `site.config.js` → `location` | Safe |
| Menu links | `site.config.js` → `nav`. **Not** the links written in the page files: those are replaced live and editing them does nothing | Safe |
| Colours and look | `site.config.js` → `theme.preset`: `selenium`, `aperture`, `passe-partout`, `noir` or `cyanotype`. `defaultMode`: `midnight`, `daylight` or `auto` | Safe |
| Homepage featured picture | `site.config.js` → `folioHero` | Safe |
| Turn pages on or off | `site.config.js` → `pages` | Safe |
| Support page words and payment links | `site.config.js` → `support` | Safe |
| Remove the small "OS" link in the footer | `site.config.js` → add `poweredBy: false` | Safe |
| Your own short links (`yoursite.com/prints`) | `site.config.js` → `shortLinks` | Safe |
| Dates in your time zone (and which day, so which frame number, a photo gets) | `site.config.js` → `timezone` | Safe |
| Posts, pictures, audio, Pulse | The console, at `/dev/field-console` on your site | Safe |
| About page words | `about/index.html`: the text inside `<main>` | Watch |
| Other wording on a page (a heading, a label) | That page's `.html` file | Watch |
| Colours, fonts or spacing beyond the themes | `css/` | Yours to maintain |
| How anything works | `js/`, `src/`, `worker.js` | Yours to maintain |

`site.config.js` is a JavaScript file: change the values between the quotes,
keep the quotes, commas and brackets as they are. Its comments explain every
setting. A typo in it can stop the next deploy, in which case your site keeps
running the version before; fix the typo and commit again.

## Leave these alone: placeholders

Some text in the page files is a stand-in the site replaces live from
`site.config.js`. Editing it does nothing, or breaks the link to your settings.
Change the setting instead.

- Anything on an element with a `data-site-…` attribute: `data-site-name`,
  `data-site-tagline`, `data-site-wordmark`, `data-site-title`,
  `data-site-location`, `data-site-suffix`. That's where `SITE.NAME`,
  `Your site name` and similar come from.
- The menu blocks, `class="nav-links"` and `class="nav-mobile"`: filled from
  `nav`.
- `you@example.com` in any email link: filled from `email`.
- Anything with a `data-support-…` attribute: filled from `support`.

Never type your real name or email into a page file to "fix" one of these.

## Checking and undoing

Every commit to `main` goes live in about a minute (on a button install, and
on any install whose repo is connected to Cloudflare). There's no preview step,
so look at the site after each change.

To undo a change from GitHub's website: open the file, press **History**, open
the version from before your change, copy its contents, then edit the file,
paste, and commit. From a computer, `git revert <commit>` does the same in one
step.

## Rules for AI helpers

1. **Name the kind before you change anything.** For a Safe change, go ahead,
   and say it's safe through updates. For a **Watch** or **Yours to maintain**
   change, your first reply is *only* the question, with no edit in it: say
   which kind it is and what that means in plain words, for example: "This
   works now, but a future update could undo it or break it. Want me to go
   ahead?" Then wait for a yes, and make the edit in your next reply.
2. **Offer the Safe route first.** If `site.config.js` or the console can do
   it, do it there, even if editing a page file looks quicker.
3. **Never edit a placeholder** (see above), and never put the owner's real
   name, email or location into a page file. It belongs in `site.config.js`.
4. **Log every Watch and Yours-to-maintain change** in `MY-CHANGES.md` at the
   top of the repo, as part of the same edit. Create it if it's missing (format
   below), and date the entry today; if you don't know today's date, ask. Safe
   changes need no entry.
5. **Touching `js/` or `css/`?** Follow the Definition of Done in
   [`CLAUDE.md`](CLAUDE.md): those files are cached hard, and each edit needs
   its `?v=` version bumped everywhere the file is referenced.
6. **One change per commit**, with a message that says what changed in plain
   words, so it is easy to find and undo.

## MY-CHANGES.md

The list of things that differ from the engine, so update day is a checklist
instead of detective work. The engine never ships this file, so it never
conflicts. One entry per change:

```markdown
## 2026-10-02 · About page intro rewritten (Watch)
- File: about/index.html
- What: replaced the three example paragraphs with my own story
- Why: the example text was placeholder
```

After merging an update, check each entry: is your change still there, and does
it still work?

## Using a chat app instead of an agent

If your AI can't open your repo (a free chat app on your phone, say), paste it
this file first, then the file you want changed, then this:

> My website runs on OAKLENS OS. The first thing I pasted is its customizing
> guide; follow its rules, especially "Rules for AI helpers". The second is the
> file I want to change. Tell me which kind of change this is before you do
> anything. Then give me the complete new file, changed only where it needs to
> be, so I can paste it back on GitHub.
