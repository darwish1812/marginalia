# Marginalia — the accounts version

Words caught while watching, reading and playing — collected, translated and given context.
A single-page vocabulary reader, no build step and no bundler. Every word gets a definition,
an example sentence, an Arabic gloss, and pronunciation audio, and lives in a field of your
own choosing — or in none, until you know where it belongs.

This copy adds sign-in. Everyone who signs in gets their **own** booklet: their own words,
and their own fields, chosen at the start from a handful of starter packs or named
themselves as they go. Nothing is downloaded, nothing is committed by hand — a word is saved
the moment it is merged, and it is there on the other device too.

> The original single-user booklet lives on unchanged at
> [darwish1812/marginalia](https://github.com/darwish1812/marginalia). This is a separate copy,
> not a replacement — that one keeps working exactly as it did.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app. One dependency, loaded from a CDN: the Supabase client. |
| `index.legacy.html` | The booklet as it was before the shell — one sticky toolbar, panels dropping out of it, the ink strip on the cover. Kept as it was, and not served. |
| `words.json` | The literary starter pack — 150 words and eight fields. Read once, to stock a new booklet. |
| `packs/` | The other starter packs. Same shape as `words.json`; add your own by dropping a file in. |
| `supabase/schema.sql` | Tables and the security policies that keep accounts apart. |
| `img/` | Optional pictures for the few words that can have one. |
| `manifest.json`, `icon.svg` | Make "Add to Home Screen" work on iPad. |
| `ARCHITECTURE.md` | How it is put together inside, for whoever has to change it. |

## Setup — about ten minutes

**1. Make a Supabase project.** [supabase.com](https://supabase.com) → New project. The free
plan is enough; note the database password somewhere, though the app never uses it.

**2. Create the tables.** Dashboard → **SQL Editor** → New query → paste the whole of
`supabase/schema.sql` → **Run**. It is safe to run more than once.

**Run it again whenever the file changes.** `create table if not exists` leaves a table that
already exists exactly as it was, so altered columns and new functions are stated separately
at the foot of the file and only reach an older project when you re-run it. If you skip this
the app will tell you rather than failing obscurely — *"this Supabase project has not been
set up for this version of the booklet"* is what a missing function looks like.

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
if you want to sign in while working on it locally. Confirmation, reset and social sign-in
links all land back on these; a URL that isn't listed here is refused.

**5. Put it online.** Same as before — a public repo, then
**Settings → Pages → Source: Deploy from a branch → `main` / `root`.**

Leave step 3 undone and the app still runs: no sign-in, words kept in that browser, and the
**Download words.json** button as the way they leave it. That is the fallback the whole way
down, not a broken state.

## Signing in

An email and a password, or a social account if you switch one on. **Create an account**
takes an address and a password of at least six characters, sends one confirmation email,
and that is that. **Forgot password?** sends a reset link that brings you back here to
choose a new one.

The first sign-in asks one question — **what do you read?** — and stocks the booklet from
the pack you pick: the original 150 words on castles and scripture and rhetoric, a set of
fields fitted to business or to exam writing, or nothing at all if you would rather name
your own. After that everything in it is yours, and editing, filing, marking or removing
affects nobody else's copy. Nothing is chosen for you and every answer is a good one.

If you start blank, the prompt in step 2 changes: it asks the model to **propose** your
fields from your first batch of words and then file them, so you get a taxonomy drawn from
your own reading instead of having to invent eight categories before you own fifty words.

### Social sign-in

On a wide screen the sign-in page is two panes: the form on the left, the booklet
introducing itself on the right. On a phone or a tablet held upright it is one column, the
cover and then the form.

Signing in with **Google** or **Microsoft** asks which account you want every time, rather
than silently reusing the last one — signing out and being signed straight back in as the
same person is not a sign-in.

The gate reads the project's own settings and shows a button for **every provider you have
switched on** — nothing to edit in the code, and no dead buttons for providers you haven't
set up. Dashboard → **Authentication → Providers**, turn one on, fill in its client id and
secret, reload the page and its button is there.

What each one costs you in setup:

| Provider | What it needs |
|---|---|
| **Google** | A free Google Cloud project and an OAuth client. Half an hour, no money. Start here. |
| **GitHub** | A free OAuth app in your GitHub settings. Easiest of the lot. |
| **Microsoft** | An Azure app registration. Free, but Azure's console is a maze. Supabase calls this provider `azure`. |
| **Apple** | An Apple Developer account — **$99 a year**. Only worth it if your readers are iPhone-first. |
| **SSO / SAML** | A **paid Supabase plan**. Not available on free. |

Icons are drawn in the page for Google, Apple, Microsoft and GitHub; other providers get a
labelled button with no mark, which is fine and still works.

## Adding words — the loop

1. Collect English words as you meet them (Google Translate, notes app, anywhere).
2. Tap **Add** — the second of the four along the side, or along the bottom on a phone —
   paste the list, then **Check list**. Any format works —
   commas, new lines, numbered. Duplicates are dropped; near-matches are flagged so you can
   decide. Steps 2 and 3 stay greyed out until the list is checked.
3. Tap **Copy prompt**, paste it into a Claude chat, and copy the JSON reply.
4. Paste that into step 3 and tap **Validate & merge**. Bad input is rejected without changing
   anything.

That is the whole loop. **There is nothing to save at the end** — the words are already in
your account and already on your other devices. A download is offered rather than demanded:
take a copy when you want one of your own.

A word that is checked but not yet enriched waits in a **"Waiting for detail"** section at
the top of the book — searchable and printable straight away, just bare. Enrich it later and
it moves to its proper field.

### Enriching without leaving the page

Steps 2 and 3 are the loop that always works, with no account and no keys. If an
administrator has configured the gateway, an **Enrich these** button appears instead and does
the same thing in one press — same prompt, same reply, same review before anything is kept.
Whenever it cannot (no key, a ceiling reached, the model unreachable) the page falls back to
the copy-and-paste loop and says why. See `supabase/functions/enrich/README.md`.

## Testing yourself

**Study** covers the book with one word at a time. Choose how to be asked —
**the word**, or **by ear**, where it is spoken and the word itself is hidden — then tick as
many fields as you want in the deck; **All** and **None** are there for the two extremes. The
button underneath keeps a running count of what you have chosen, and starts when you press it.
Turn each card over and swipe: right if you had it, left to see it again. Buttons and the
arrow keys do the same thing. *I know it* ticks the same ✓ the card in
the book carries, so the tally and the **Not yet** filter follow along; *Again* puts the word
at the back of the pile. By default the deck leaves out the words you have already
ticked, which is the difference between a deck that shrinks and one that never ends.

Words already ticked can be hidden from the book itself with **All / Not yet / Learned**,
and **Study mode** collapses every card to the word alone if you would rather work down the
page than through a deck. Both live under **View** at the top of the book, along with the
Arabic — one control for how the book is being read, rather than three loose buttons
competing with the navigation. The button says which filter is live, so a hidden word is
never a lost one.

## Filing, unfiling, removing

A word that fits none of your fields is left **unfiled** rather than pushed into whichever
one is least wrong — the prompt asks for that, and says why. Unfiled words sit in their own
section at the top of the book: searchable, printable, and perfectly fine to leave there.

Every card has a **⋯** button carrying the three things you can do to it: file it under any
field, send it back to Unfiled, or remove it. An unfiled card also grows a dashed
**File under** chip, which opens the same menu. Removing asks first, in the card.

To change the fields themselves, **You → Edit fields**: rename them, give them a
different ink, add one, or remove one. Removing a field never removes its words — they go
to Unfiled, and the button says how many before you press it. Eight fields at most, and each
ink can only belong to one of them, because the ink index down the side is the index of
the whole book.

**You → The whole booklet** holds the three things that act on all of it at once —
keeping a copy, resetting the marks, and emptying it. **Reset marks** puts every card back to
unlearned and asks first, naming the number it is about to clear; the words are untouched.
**Empty this booklet** clears every word at once. It asks you to type
the word `empty`, because it cannot be undone. What is left is the same empty booklet a new
account starts with, so you are asked the same question a new account is asked — **what do
you read?** — and can stock it from any of the packs, or leave it empty and go on with the
fields you already had.

## Notes

- **Everything you own follows you.** Words, corrections and the ✓ marks all live on your
  account, so a word ticked on the iPad is ticked on the laptop. Preferences — pictures,
  voice, speed — stay per-device on purpose: the iPad and the laptop want different voices.
- **Opening it** shows the wordmark while the booklet is fetched and your session is
  checked. It goes as soon as there is something to read, and it is there because that wait
  is real — a free Supabase project waking from a pause takes a few seconds, and a blank
  blue screen for that long reads as a broken app.
- **Offline** the booklet still opens: the last load is mirrored into the browser, so you can
  read, search, print and take the Arabic on a train with no signal. Saving needs a
  connection, and says so plainly rather than pretending.
- **A free Supabase project pauses after about a week of no use, and does not resume on its
  own.** Waiting and reloading will not bring it back: someone has to open the project in the
  [Supabase dashboard](https://supabase.com/dashboard) and press **Resume**, which takes a
  minute or two. The booklet links straight to your project's page from the message it shows
  when a load fails, including on the sign-in screen, since a paused project is the one fault
  you cannot sign in your way past. It is offered there, at the moment it means something,
  rather than standing in the account panel every other day of the week.
  Meanwhile the last cached copy still opens, so you can read; saving waits. A paid plan
  removes the pausing entirely and changes nothing else.
- **Audio** uses your device's built-in speech engine, so voices differ between iPad and
  laptop. Rare words are occasionally mispronounced — verify anything that sounds odd.
- **Printing** (Ctrl/Cmd+P) reflows into a two-column paper booklet, one field per page.
  Whatever language mode is on prints with it.
- **Four places, and they do not move.** **Book**, **Add**, **Study**, **You** — a sidebar
  on a laptop, a narrower rail on a tablet, a bar along the bottom on a phone. Whatever you
  are doing, every one of them is one press away, and Add is no longer two rooms deep inside
  Settings.
- **The sidebar folds.** The chevron beside the wordmark takes it down to a rail of icons
  and the ink index as a strip of colour — the names go, the counts move to the tooltip, and
  the filter goes on working. Remembered per device, like the voice and the pictures: a
  laptop and an iPad want different amounts of rail. An iPad held upright folds too — there
  the column of field names gives way to the same strip of chips a phone shows, so the index
  changes shape rather than going away. Only a phone has nothing to fold, its nav being a bar
  along the bottom already, and there the button is not shown at all.
- **The ink index stays on screen.** The eight fields and their counts used to sit on the
  cover, which meant the index of the whole booklet was gone on the first flick. It stands
  beside the book now — and it is the filter as well as the map: press a field to hold the
  book to it, press it again to let it out. On a phone the strip sticks under the head
  rather than travelling with the page, so it is there wherever you are in the booklet.
- **The head is one row on a phone.** The search box and **View** share it; the tally moves to
  **You**, since it is a reading rather than a control and a phone has no row to spare for one.
  On a tablet and a laptop the tally stays in the head, where a row costs nothing.
- **Nothing folds away on a phone.** There is no `⋯` sheet any more, because there is
  nothing left to hide in one: Study mode and العربية moved into **View**, Settings became a
  place of its own, and what is left above the book — the search box and that one button —
  fits a phone in a single row.
- **A card opens where it sits.** At rest it carries the word, what it is, what it means and
  its speaker; press it and the sentence, the Arabic and the picture unfold in place. The
  same press does the same thing on every screen. Hearing a word never goes behind a
  gesture, so the speaker is on the card at every size.
- **Sign-in is per browser.** Signing in on the iPad and on the laptop is two sign-ins, and
  signing out of one leaves the other alone.

## How the data is kept apart

All four tables — words, fields, corrections, profiles — have row level security on, with
one policy each: you can see and change a row only if its `user_id` is your own account. It
is enforced by Postgres, not by the app — a doctored copy of this page, or a hand-written
request with the anon key, gets exactly the same answer as the app does. The starter packs
are the one thing everybody shares, and they are read-only.

Three of the writes are several statements that are only correct together — stocking a new
booklet, merging a reply, removing a field — so each is a Postgres function, which makes it
one transaction. They run as **security invoker**, meaning the same policies apply to them
as to everything else: a function there is a way to be atomic inside the rules, never a way
around them.

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

`f` is the field id — **or `null`** for a word you have not filed, which the booklet gathers
under "Unfiled" and leaves alone until you do. `n` is a caution shown only where one is
earned, `i` an optional picture: either a path in `img/` or a `data:` URI for a drawing that
came back with the reply.

A downloaded copy is the format the original booklet used, so the two versions can still
trade files — with one exception worth knowing. An unfiled word exports as `"f": null`, and
the original filters on a matching field id, so it would quietly skip those cards. File them
first if you are sending a copy that way.
