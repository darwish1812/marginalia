# Marginalia — the accounts version

Words caught while watching, reading and playing — collected, translated and given context.
A single-page vocabulary reader, no build step and no bundler. 150 words across eight themed
fields, each with a definition, an example sentence, an Arabic gloss, and pronunciation audio.

This copy adds sign-in. Everyone who signs in gets their **own** booklet, seeded with the same
150 words and theirs to add to from then on. Nothing is downloaded, nothing is committed by
hand: a word is saved the moment it is merged, and it is there on the other device too.

> The original single-user booklet lives on unchanged at
> [darwish1812/marginalia](https://github.com/darwish1812/marginalia). This is a separate copy,
> not a replacement — that one keeps working exactly as it did.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app. One dependency, loaded from a CDN: the Supabase client. |
| `words.json` | The starter words and the eight fields. Read once, to stock new accounts. |
| `supabase/schema.sql` | Tables and the security policies that keep accounts apart. |
| `img/` | Optional pictures for the few words that can have one. |
| `manifest.json`, `icon.svg` | Make "Add to Home Screen" work on iPad. |

## Setup — about ten minutes

**1. Make a Supabase project.** [supabase.com](https://supabase.com) → New project. The free
plan is enough; note the database password somewhere, though the app never uses it.

**2. Create the tables.** Dashboard → **SQL Editor** → New query → paste the whole of
`supabase/schema.sql` → **Run**. It is safe to run more than once.

**3. Point the app at the project.** Dashboard → **Settings → API**, then copy the two values
into the top of the `<script>` in `index.html`:

```js
const SUPABASE_URL      = 'https://YOURPROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci…';
```

Both belong in the file and in git. The anon key names the project, not you — it is the
policies from step 2 that keep one person's words away from another's, and the key does
nothing without a signed-in session.

**4. Tell Supabase where the app lives.** Dashboard → **Authentication → URL Configuration**.
Set **Site URL** to your deployed address, and add `http://localhost:8001` to **Redirect URLs**
if you want to sign in while working on it locally. Sign-in links land back on these; a URL
that isn't listed here is refused.

**5. Put it online.** Same as before — a public repo, then
**Settings → Pages → Source: Deploy from a branch → `main` / `root`.**

Leave step 3 undone and the app still runs: no sign-in, words kept in that browser, and the
**Download words.json** button as the way they leave it. That is the fallback the whole way
down, not a broken state.

## Signing in

Enter an email, get a link, click it. No password to remember and none to lose. The first
sign-in stocks the account with the 150 starter words — after that they are yours, and
editing, marking or deleting them affects nobody else's copy.

## Adding words — the loop

1. Collect English words as you meet them (Google Translate, notes app, anywhere).
2. Tap **Settings → + Add words**, paste the list, then **Check list**. Any format works —
   commas, new lines, numbered. Duplicates are dropped; near-matches are flagged so you can
   decide. Steps 2 and 3 stay greyed out until the list is checked.
3. Tap **Copy prompt**, paste it into a Claude chat, and copy the JSON reply.
4. Paste that into step 3 and tap **Validate & merge**. Bad input is rejected without changing
   anything.

That is the whole loop. **There is no step 5** — the words are already saved to your account
and already on your other devices. Step 4 of the panel now offers a download rather than
demanding one: take a copy when you want one of your own.

If you don't want to enrich immediately, tap **Add as needs-detail now**. The words appear as
cards straight away in a "Waiting for detail" section at the top, searchable but bare. Enrich
them later and they move to their proper field. To come back to them, tap
**Queue the N waiting** — it loads every bare word into a fresh prompt.

## Notes

- **Everything you own follows you.** Words, corrections and the ✓ marks all live on your
  account, so a word ticked on the iPad is ticked on the laptop. Preferences — pictures,
  voice, speed — stay per-device on purpose: the iPad and the laptop want different voices.
- **Offline** the booklet still opens: the last load is mirrored into the browser, so you can
  read, search, print and take the Arabic on a train with no signal. Saving needs a
  connection, and says so plainly rather than pretending.
- **A free Supabase project pauses after about a week of no use.** The first load afterwards
  may fail while it wakes up — the cached copy is shown meanwhile, and reloading a minute
  later picks it up. The paid plan removes the pausing; nothing else changes.
- **Audio** uses your device's built-in speech engine, so voices differ between iPad and
  laptop. Rare words are occasionally mispronounced — verify anything that sounds odd.
- **Printing** (Ctrl/Cmd+P) reflows into a two-column paper booklet, one field per page.
  Whatever language mode is on prints with it.
- **Sign-in is per browser.** Signing in on the iPad and on the laptop is two sign-ins, and
  signing out of one leaves the other alone.

## How the data is kept apart

Every table has row level security on, with one policy: you can see and change a row only if
its `user_id` is your own account. It is enforced by Postgres, not by the app — a doctored
copy of this page, or a hand-written request with the anon key, gets exactly the same answer
as the app does. `words.json` is the one thing everybody shares, and it is read-only.

`supabase/schema.sql` is the whole of it, comments included; it is worth reading once before
trusting it with anything.

## Data shape

A row and a card are deliberately the same shape, so a word travels from Postgres to the
screen without being translated on the way:

```json
{
  "w": "fealty",  "f": 1,          "p": "noun",
  "d": "A sworn oath of loyalty, especially from a vassal to a lord.",
  "e": "The knight knelt and pledged *fealty* to the new king.",
  "a": "وَلاء",   "n": null,       "i": "img/loom.png"
}
```

`f` is the field id, `n` a caution shown only where one is earned, `i` an optional picture —
either a path in `img/` or a `data:` URI for a drawing that came back with the reply. A
downloaded copy is byte-for-byte the format the original booklet used, so the two versions can
still trade files.
