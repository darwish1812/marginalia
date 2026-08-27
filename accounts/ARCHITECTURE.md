# Marginalia — architecture

How the booklet is put together, for whoever has to change it. `README.md` is the other half
of this: what the app does and how to stand one up. This file is about the inside.

---

## 1. Overview & purpose

Marginalia is a single-page vocabulary reader. Words are collected wherever they are met —
a film, a novel, a game, a video — and the app gives them somewhere to live: a definition,
an example sentence that shows the word actually working, a Modern Standard Arabic gloss,
a spoken pronunciation, and a field to belong to.

The problem it solves is not "look up a word". Dictionaries do that. The problem is that
words collected in a notes app never come back — they sit in a list with no context, no
translation, no example, and no reason to be reread. This app turns a bare list into cards
worth returning to, and then keeps them across every device the reader owns.

Enrichment is deliberately not automated. The app builds a precise prompt, you take it to a
model, and you bring the reply back. That keeps the app free of API keys, free of a server,
and free of a per-word cost — and it puts a human between the model and the booklet.

A word does not have to be filed. Where none of the reader's fields genuinely fits, the
prompt asks for `null` and the booklet gathers those under "Unfiled" — because a word filed
wrongly is worse than a word not filed at all, and a taxonomy that quietly absorbs whatever
does not fit stops meaning anything within a month.

**One design decision explains most of the rest: a database row, a rendered card and a line
in a starter pack are the same shape.** The single-letter column names (`w`, `f`, `p`, `d`,
`e`, `a`, `n`, `i`) are not shorthand for its own sake — they are the exact keys the model
returns and the exact keys `render()` reads. A word travels from Postgres to the screen
without being translated on the way, and the only mapping code in the app
(`rowToWord`/`wordToRow`) exists to add and drop bookkeeping columns, nothing more.

---

## 2. Architecture & tech stack

| Layer | What it is |
|---|---|
| **Language** | Plain HTML, CSS and ES2020 JavaScript. No framework, no bundler, no build step, no transpiler. |
| **Dependencies** | Exactly one: `@supabase/supabase-js@2`, loaded from jsDelivr as a classic `<script>`. Google Fonts are loaded but optional. |
| **Hosting** | Any static file server. GitHub Pages in practice. |
| **Backend** | Supabase — Postgres for data, GoTrue for auth. No server of the project’s own and no Edge Functions; the only server-side code is three Postgres functions, for writes that must happen all at once. |
| **Storage** | Postgres when signed in; `localStorage` when not, and as an offline mirror when signed in. |
| **Speech** | The browser's own `speechSynthesis`. No audio files, no network. |
| **Offline** | A hand-rolled cache in `localStorage`. There is no service worker; the app is *installable* via `manifest.json` but not precached. |

### The two modes

The whole app hangs off one boolean, computed once at the top of the `<script>`:

```js
const ACCOUNTS = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
```

- **Configured** → sign-in gate, per-account words in Postgres, sync across devices.
- **Not configured, or the CDN is unreachable** → the original single-user booklet: words in
  this browser, `words.json` download as the way they leave it.

Neither is a degraded state. The second is the fallback the whole way down, and the code
paths above the storage seam cannot tell them apart.

### The three layers

```
┌──────────────────────────────────────────────────────────────┐
│ UI — render() · search · speech · panels · the add-words     │
│ loop · print styles.  Knows about cards, never about rows.   │
└───────────────────────────┬──────────────────────────────────┘
                            │  load · addWords · saveField · setField
                            │  removeWord · seeded · stock · setDone …
┌───────────────────────────▼──────────────────────────────────┐
│ `store` — the seam.  One of two objects, chosen by whether   │
│ a session exists.  Same eleven questions, either way.        │
└───────┬─────────────────────────────────────┬────────────────┘
        │                                     │
┌───────▼──────────────────┐   ┌──────────────▼────────────────┐
│ localStore               │   │ cloudStore                    │
│ A starter pack plus      │   │ Supabase — words, fields,     │
│ localStorage: additions, │   │ corrections, profiles.  RLS   │
│ field edits, overrides,  │   │ scopes every read and write   │
│ tombstones.              │   │ to auth.uid().  Mirrors rows  │
│                          │   │ to localStorage for offline.  │
└──────────────────────────┘   └───────────────────────────────┘
```

### Security model, in one paragraph

The anon key is public and lives in the file and in git. It names the project, not the
person. Every table has row level security enabled in the same statement that creates it,
with a single policy: a row is visible and writable only when its `user_id` equals
`auth.uid()`. Separation is enforced by Postgres, not by the app — a doctored copy of the
page or a hand-written `curl` with the anon key gets exactly the same answer the app does.
Consequently, none of the client's `select()` calls filter by user; they do not need to.

---

## 3. Core data flow & logic

### 3.1 Boot — `boot()`

1. `fetch('words.json')`. On success it is also written to `localStorage['vocab-words-cache']`.
   On failure, that cache is read instead; if neither works, `failed()` prints a diagnosis
   that distinguishes a `file://` open from a 404 from a dead network.
2. The parsed file becomes the module-level `SEED` — the literary starter pack. It is used
   for one thing only: stocking a booklet that has never been stocked. Fields and words both
   belong to the booklet from that moment on, and `SEED` is not consulted again.
3. If `ACCOUNTS` is false — show the book, `store` stays `localStore`. A device that has
   never been stocked gets the first-run picker; otherwise `apply(SEED)`.
4. Otherwise ask `sb.auth.getSession()` who is already here, hand the answer to `enter()`,
   and then subscribe to `onAuthStateChange` so every later change goes through the same
   function. A magic link, an OAuth return and a reset link all arrive as a session in the
   URL fragment which `supabase-js` picks up on its own.

### 3.2 Signed in / signed out — `enter(session)`

One function owns the difference, and it is the only place `store` is reassigned.

**With a session:** record `uid`/`email` on `cloudStore`, point `store` at it, clear the
in-memory `done` set, hide the gate, then ask `store.seeded()`. A booklet that has never been
stocked gets the first-run picker; otherwise `apply(SEED)`. A network failure answers *yes* on
purpose — nobody should be offered a fresh start because their connection hiccupped. If the load throws, `failed()`
explains it — including the "a free project pauses after a week and may be waking up" case,
which is the most likely reason a load fails in practice.

**Without one:** reset `cloudStore`, point `store` back at `localStore`, empty `W` and
`CORRECTIONS`, show the gate in place of the book. The cover's eyebrow is rewritten from
`SEED` here, because `render()` — which normally writes the real counts — never runs when
signed out.

`apply(data)` is the join: it calls `store.load()` and assigns all three results to the
globals `FIELDS`, `W` and `CORRECTIONS` — fields come from the store now, not from the file —
then runs the painters: `render()`, `loadProgress()`, `showLocal()`, `renderFix()`,
`renderFields()`.

### 3.3 The storage seam — `localStore`, `cloudStore`

Both answer the same eleven calls. This is the most load-bearing structure in the file: the
merge path, the learned marks, filing, removal and the first-run stocking were each written
once and none of them learns where it is saving to.

| Call | `localStore` | `cloudStore` |
|---|---|---|
| `load(seed)` | `seed.words` plus this device's unsaved additions, with its overrides and removals laid over the top. A word already in the committed file otherwise wins. | `seedAccount()`, then `select *` from `words`, `corrections` and `fields`. Writes the rows to a per-account cache. On any failure, falls back to that cache and sets the global `offline`. |
| `addWords(add, retired)` | Rewrites the local additions list, dropping retired norms. | One `merge_words()` call — retire and insert in a single transaction. |
| `saveField(f)` / `removeField(id, moveTo)` | Rewrites the local field list; `removeField` records the moves. | `upsert` / one `remove_field()` call. |
| `setField(w, f)` / `removeWord(w)` | Records an override or a tombstone beside the file. | `update` / `delete` on that one row. |
| `removeAllWords()` | Clears local additions and tombstones the rest. | `delete` across the account. Fields are left standing. |
| `addFixes(fixes)` | Appends to the local corrections list. | `upsert` on `(user_id, norm_wrong)`, ignoring duplicates. |
| `doneList()` | The `vocab-booklet-progress` array. | `this.ready`, taken straight off the loaded rows' `done` column. |
| `setDone(w, on)` | Rewrites the whole array from the in-memory set; the arguments are ignored. | Updates that one row. Optimistic — the tick has already moved on screen, and a failure is reported in the status line rather than snatched back. |
| `clearDone()` | Empties the array. | `update({done:false})` across the account. |

`savedNote` is a per-store string appended to the merge confirmation, so the same message
says "Download the file and commit it" locally and "Saved to your account" in the cloud.

The offline mirror (`vocab-rows-<uid>`) is what lets the booklet open on a train. Reads come
from it when the network does not answer; writes always require a connection and say so.

### 3.4 Stocking a new account — `seedAccount(seed, uid)`

The starter pack comes from `words.json`, which the browser has already fetched, so the
database never needs its own copy. The guard is `profiles.seeded_at` — not "does this
account have any words" — because an account whose words were all deleted on purpose would
otherwise be re-stocked on the next sign-in and the deletions would undo themselves.

Fields, words, corrections and the stamp are four writes that are only correct together, so
the client makes one call to `seed_account()` and Postgres does them in one transaction.
Every insert ignores conflicts, so a seed interrupted halfway is harmless: the next sign-in
completes it. `seeded_at` is stamped last.

**Three functions exist for exactly this reason** — `seed_account`, `merge_words` and
`remove_field`. Each is several statements that are only right as a unit, and a browser
that loses its connection partway through would otherwise leave an account in a state no
screen describes. All three are `security invoker`, so row level security applies to them
exactly as it applies to the app: a function here is a way to be atomic *inside* the
policies, never a way around them.

The `profiles` row itself is created by a Postgres trigger (`handle_new_user`, a
`security definer` function) the instant the auth user exists, so the client never has to
decide whether a missing profile means "new" or "something broke mid-signup".

### 3.5 The add-words loop

This is where most of the app's real logic lives.

**Step 1 — `check`.** The pasted blob is split on newlines, commas and semicolons,
numbering like `3.` or `4)` is stripped, and each item is sorted into one of four buckets
using two normalisers:

- `norm(s)` — lowercase, NFKD, strip everything but letters, spaces and hyphens.
  This is what "already have this word" means everywhere in the app, which is why the
  database carries the uniqueness on `norm` rather than on `w`.
- `stem(s)` — `norm` plus two passes of suffix stripping. Used only to *suggest* a
  near-match; it never blocks anything.

| Bucket | Meaning | Fate |
|---|---|---|
| `dups` | Already here, with a definition. | Dropped, shown greyed. |
| `again` | Already here but bare — captured, not enriched. | Re-offered, so the panel can reach them. |
| `nears` | Shares a stem with an existing word. | Offered with a `≈ existing` note; your call. |
| `fresh` | Genuinely new. | Offered. |

Every offered chip can be removed individually. Steps 2 and 3 stay disabled until this runs.

**Step 2 — `buildPrompt()`.** Writes a prompt carrying the field list with its notes and ten
numbered rules covering base forms, misspelling correction (returned as `x`), field choice,
part of speech, the shape of `d` and `e`, the Arabic, when a caution is earned, a no-markup
rule, and when a drawing (`s`) is and is not appropriate. Rule 3 permits `"f": null` and
explains when to use it: a word left unfiled is honest and easy to file later, a word filed
wrongly is neither.

There is a **second prompt**, `buildProposePrompt()`, used only when the booklet has no
fields at all — a blank start, or every field deleted. It asks the model to propose the
taxonomy from this first batch and then file into it, returning `{"fields":…, "words":…}`
instead of a bare array. This is the one moment where that is the better question: nobody
knows their eight fields before they own fifty words, and they do know them afterwards. The
prompt is emphatic about the field `note`, because that sentence is the only thing telling
anyone — model or reader — where a new word belongs later.

**Step 3 — `mergeArray(arr)`.** Deliberately split from the paste handler: it takes
a parsed array and knows nothing about textareas, markdown fences or where the array came
from. That is the seam a future API call would use without touching any of the below.

1. **Validate.** Every object needs a non-empty `w`, an `f` that exists in `FIELDS`, and a
   non-empty `d`. The five plain-text keys (`w`, `d`, `e`, `a`, `n`) are rejected if they
   contain `<` or `&`. Any failure rejects the whole batch and changes nothing.
2. **Corrections.** An `x` key holds the word as it was actually typed. Where it differs from
   `w`, a `{wrong, right}` pair is recorded for the misspellings table and the norm is added
   to the retired set, so the card filed under the wrong spelling does not linger. The `x`
   key is then deleted so it never reaches `words.json`.
3. **Drawings.** An `s` key holds raw SVG typed by a model. `artToSrc()` requires
   it to parse as SVG with a `viewBox`, strips `script`, `foreignObject`, `image`, `iframe`,
   `style`, `a`, `use`, `animate` and `set`, removes every `on*` and every `href`-like
   attribute, re-serialises, enforces a 2,600-character ceiling, and returns a
   `data:image/svg+xml` URI. It becomes the `src` of an `<img>` — never inline markup — so
   the browser will not run script even if some survived. Anything malformed is dropped
   without blocking the merge.
4. **Carry pictures across.** A word being re-enriched keeps its existing picture unless the
   reply drew a new one, and a corrected spelling inherits the picture from the misspelling.
5. **Save.** `W` is recomputed as `kept ∪ new`, the new words are normalised through
   `rowToWord` so a freshly merged word and a reloaded one are byte-identical in an export,
   and `store.addWords(add, retired)` writes them. Then `render()`, `loadProgress()`,
   `showLocal()`.

**The escape hatch — "Add as needs-detail now".** Inserts the words with `f: null` and empty
everything. Anything without a definition renders in the synthetic "Waiting for detail"
section at the top of the book; the words are searchable immediately and move to their real
field when enriched. The batch is measured against the book *and against itself* first, so a
word already captured, or two typings that normalise alike, cannot be inserted twice.
"Queue the N waiting" loads every bare word back into a fresh prompt.

**The object reply.** The paste handler unwraps `{fields, words}` before anything else,
creating the proposed fields and then handing on the bare array — so `mergeArray` still
receives an array and still knows nothing about where it came from. Every `"f"` in the reply
is checked against the fields that are *about* to exist before any of them are written,
because `mergeArray` can only validate against `FIELDS`, which is exactly what has not been
saved yet. A reply that does not hang together writes nothing at all.

### 3.6 Rendering — `render()`

Rebuilds the entire book from `W` on every change. Sections come from `FIELDS`, plus up to
two synthetic ones at the top:

- **Waiting for detail** (id `0`) — any word with no definition.
- **Unfiled** (id `-1`) — a word that has a definition but no field, *or* a field id that
  is not in `FIELDS`.

That second clause is the load-bearing one. Together the three tests are exhaustive and
disjoint, so every word in `W` renders exactly once no matter what `f` holds — which is
what lets a field be deleted without its words falling off the page. They are released to
Unfiled rather than lost.

Within a section the words are sorted alphabetically by `localeCompare`, at base
sensitivity. Insertion order meant something only to whoever typed the list; a field of
thirty is findable by eye only if it reads like a glossary. The card numbers follow the
render, so they number the page rather than the history.

Cards are built as HTML strings and
everything model-authored goes through `esc()` first — including before the `*asterisk*`
transform, never after, because a signed-in session token lives in this browser and an
unescaped card is how someone would take it. Each card also carries a flattened
`data-s` string, which is the entire search index.

`applyFilters()` is the only thing that sets `display` on a card. The search box and the
mark filter — All / Not yet / Learned, three segments in the bar — are two questions about
the same card, and one function answers both before hiding any section with no visible card
left. Two handlers hiding on their own terms would undo each other: a keystroke would bring
back a card the filter had just taken away. Ticking a card that the current filter no longer
wants fades it out over 160ms rather than dropping it on the frame, so the next card does
not spring up under a finger still coming down.

### 3.6a The bar on a phone

The toolbar holds one row down to 1400px and two down to 720px, then falls apart: three rows
at 710, four at 520, five at 375 — where it was 246px of `position:sticky` chrome eating 30%
of the screen and never scrolling away. Under 720px the search box and the mark filter stay in
the open bar, for the reason above, and everything else — Study mode, Flash cards, العربية,
Reset marks, Settings and the tally — goes behind a `⋯` that opens a sheet. That is 116px, two
rows. `719px` is the measured boundary rather than a round number.

`.bar-extra` is `display:contents` on a wide screen, so its children are ordinary members of
the bar and the desktop layout is untouched — the same elements, moved by CSS and never by
script, so their listeners and their `aria-pressed` states carry across without knowing where
they are. The one cost is that `display:contents` needs a contiguous run in the markup, so the
filter moved up beside the search box and a handful of `order` rules put it back. Those rules
are scoped to `.bar`: `.seg` is also the flash-card picker's "the word / by ear" control, and
unscoped, the order pushed it below the field grid there.

The search box goes to 16px on a phone. Below 16px, iOS Safari zooms the page in when the
field takes focus and does not zoom back out.

### 3.6b Flash cards

A mode rather than a page: a fixed overlay over the book, opened from the bar. The picker
asks two things — **how to ask** (the word, or by ear) and **which fields** — then `fcPool()`
builds the deck: enriched words only, since a bare capture has no meaning to hide, and by
default without the ones already ticked. The deck is shuffled, lives in a local array, and
is dropped when the overlay closes. Nothing about it is persisted.

The fields are checkboxes, so any number of them can go into one deck. `fcPool()` takes a
`Set` of field ids and `fcSel` holds the ticks, out at module scope rather than read off the
DOM, so a finished round returns to a picker with the same fields still ticked. Everything
the book cannot place — no field, or a field since deleted — falls into one bucket the
picker calls **Unfiled**, so no enriched word is unreachable.

Ticking is no longer starting: with several fields in play the deck cannot be built until
you say you are done choosing, so there is a start button carrying the running total. That
costs a single field one extra tap, which is the price of the other seven being reachable
together. Only the total is recomputed on a tick — a field's own count depends solely on the
skip setting, so nothing else on the screen can have changed, and re-rendering would take
the focus off the box just ticked. The skip setting does re-render, and a field it empties is
disabled and dropped from `fcSel` rather than left ticked and untestable.

One field keeps its own ink; a mixed deck belongs to no field and takes `--ink-1` rather than
borrowing a colour that would be a lie.

`.fc-body` centres with `justify-content: safe center`. The picker can be taller than a phone
— eight fields, both fronts, a start button — and plain `center` splits the overrun between
both ends, putting the heading above the top of the scroller where no scrolling can reach it
and the start button off the bottom. `safe` centres only while it fits. The guard is
`:not(.answering)`: a word you are being tested on must not be able to scroll away.

Both fronts turn over into the same full card, so there is one thing to learn rather than
two. On the ear front the circle is the single exception to *tap turns the card over*: it
replays the word, and it earns the exception by looking like a play button. By ear is
offered only when `fcCanHear()` finds a voice — a listening test with nothing to hear is
worse than no option at all.

`fcSpeak()` clears `current` before delegating, which makes the two speakers here behave
differently from the book's. In the book a second tap on the same button stops a sentence
part-way, and that is right there. Here it is wrong twice: the ear card speaks itself on
arrival, so the first press of the circle would have silenced it rather than repeated it,
and the circle and the pill are two ways of asking for one thing — pressing one after the
other should say the word twice, not say it and then stop it. Each control is also passed
as its own button, so the speaking highlight lands on the one that was pressed. Both are
real `<button>` elements: the circle began as a `<div>`, which put it outside the tab order
and left it unnamed to a screen reader.

Turning an ear card over removes its listening face — circle, waveform and the row of dots
standing in for the hidden word — and drops the narrow listening width. All three were
answering a question that has just been answered, and leaving them made the card top-heavy
with its text cramped into 340px. The revealed word then moves up to lead the card: left
inside the reveal it sat beneath a horizontal rule, so the card appeared to begin somewhere
above its own top edge.

Two pieces of copy are dropped on turning for the same reason — they describe a state that
has passed. "Tap to turn over" goes (its 22px top margin had been holding it clear of
content the ear card sheds, so leaving it stranded that margin at the top of the card), and
the hint beneath the buttons stops saying *turn it over* and says *swipe to answer*. Turned,
both fronts are the same ordinary card: word, part of speech, rule, meaning, gloss,
sentence, replay.

The turn is animated, and `fcReveal()` exists so that it can be. The obvious build — two
faces in one box, one rotated 180° behind the other — does not work here, because the faces
are different sizes: the listening card is 340px and short, the answer 560px and tall, and a
two-faced box has to be one height. So `fcTurn()` rotates the card a quarter turn onto its
edge, calls `fcReveal()` while it is invisible, drops it to −90° with no transition and
swings it back. The change of size happens at 90°, where there is nothing to see. The deck
carries the `perspective`; without one the rotation is an affine squash rather than a turn.
Anyone who has asked not to be moved gets `fcReveal()` on its own. The inline transform is
cleared at the end, because from then on the drag owns it.

Answering is a swipe, with buttons and arrow keys saying the same thing. **The pointer is
captured only once the drag has committed to the horizontal, never on `pointerdown`** —
capturing early retargets the subsequent `click` to the card, and since both speakers sit
inside the card, every tap on them was being swallowed and read as "turn the card over".
It survived a first round of testing because a programmatic `.click()` fires no pointer
events at all; only a real click reproduces it. Dragging is live only once the card is face up, so a swipe can never grade a word that was never looked at,
and `fcNext()` turns a face-down card instead of recording an answer — answering before
looking is how a reader fools themselves. The first ten pixels of a drag decide whether the
gesture is a swipe or a scroll and it stays decided, because a slightly diagonal flick that
both scrolls and answers is unusable; `touch-action: pan-y` leaves the vertical to the
browser. **I know it** writes through `setLearned()` — the one place a ✓ moves — so the
book's card, the tally and the *Not yet* filter update together and cannot drift apart.
**Again** pushes the word to the back of the deck rather than dropping it.

Every way of answering goes through `fcAnswer()`, which sends the card off the screen and
then calls `fcNext()`. The buttons used to call `fcNext()` directly, so a card answered by
button was replaced on the spot while the same answer given by swipe was thrown — one
decision with two different faces. `fcAnswer()` also guards the gap: a card already on its
way out ignores further presses, so a double-click cannot burn two words. Reduced motion
skips the throw and answers immediately.

Dragging works with a mouse as well as a finger and is left enabled at every width — there
is no page scroll inside a fixed overlay for it to fight, and it costs nothing to leave on.
What does change with the pointer is the wording: `fcTapText()` says *tap* on a coarse
pointer and *click* on a fine one, and it lives on the card because the card is the thing
being acted on. The line under the buttons stays empty until there is something new to say.

The answer buttons arrive **disabled** and are handed over by `fcReveal()`. Two presses to
answer a card you already knew is not an accident and not friction to be removed — it is
the method, and Anki works the same way: a deck you can tick without looking stops meaning
anything, because a word you half-remembered gets written into the book as learned and the
*Not yet* filter stops showing you the one word you needed. What was wrong was that the
buttons looked live on a face-down card and, when pressed, quietly turned it instead. A
control that does something other than its label is worse than one that waits its turn.

The answer controls move with the grip, not the width alone: a row across the bottom on a
phone, the two bottom corners on a tablet where the thumbs already are, and a centred pair
with the keys named beneath them on a desktop, where there is no thumb to reach with.

`loadProgress()` re-applies the ✓ marks to the freshly built DOM and then re-applies the
filter over it, which is why it always runs immediately after `render()` — a merge would
otherwise leave the filter showing a page it no longer describes. It marks the union of
`store.doneList()` and the in-memory `done` set: on a device that quietly refused to save,
the store's word alone would rub out ticks the tally still counts.

### 3.7 Auth gate

One form, three modes (`in`, `up`, `reset`), sharing the email and password fields because
they are the same two questions asked for different reasons; only the heading, the button and
the submit handler change. `authText()` rewrites the five Supabase errors worth saying better.

The OAuth buttons are not hard-coded: the gate fetches `/auth/v1/settings` from the project
and renders one button per provider actually switched on, so there are never dead buttons and
nothing to keep in step by hand. Marks are drawn inline for Google, Apple, Microsoft
(`azure`) and GitHub; the rest get a labelled button.

A password-reset link arrives as a perfectly valid session, which would otherwise drop the
user straight into the booklet and skip the form the link was sent to open. A dedicated
`PASSWORD_RECOVERY` listener sets a `recovering` flag that the main `onAuthStateChange`
handler checks and defers to.

---

## 4. Setup & execution

### Prerequisites

- A modern browser. Nothing else is required to read the code.
- Any static file server. **`file://` will not work** — the browser blocks `fetch` of
  `words.json`, and the app says so explicitly rather than failing blank.
- A Supabase project, if you want accounts. Without one the app still runs.

### Run it locally

```bash
python3 -m http.server 8001
```

Then open `http://localhost:8001`. Any static server does — `npx serve`, `php -S`, whatever
is already installed. Port 8001 is only a convention because it is the one the README tells
you to add to Supabase's redirect URLs.

### Configure accounts

Four places, all covered step by step in `README.md`:

1. `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of the `<script>`. Both belong in the
   file and in git.
2. `supabase/schema.sql`, run **whole** in the SQL editor. It is idempotent, and it must
   be re-run after any change to it — `create table if not exists` leaves an existing table
   alone, so altered columns and new functions are stated separately at the foot of the file.
   The app recognises a project running an older schema and says so in plain words.
3. **Authentication → URL Configuration** — Site URL, plus `http://localhost:8001` in
   Redirect URLs for local work. Confirmation, reset and OAuth links all land on these, and
   a URL not listed is refused.
4. **Settings → Pages** → deploy from a branch, root.

### Test it

There is no test suite, no linter and no CI. This is a stated fact, not an oversight to be
inferred: nothing in the repo runs anything. The manual round-trip that exercises the most
code is worth knowing —

1. Sign in on a fresh account; confirm 150 words appear and `profiles.seeded_at` is stamped.
2. Add a word list, check it, copy the prompt, paste a reply, merge.
3. Tick a card, reload, confirm the tick survived; open the same account elsewhere and
   confirm it is ticked there too.
4. Go offline, reload, confirm the booklet still opens and says it is showing a cached copy.
5. `Ctrl/Cmd+P` and confirm the print booklet reflows.
6. Tick two fields in the flash-card picker, confirm the start button's total is their sum,
   and run the deck to the end.
7. Narrow the window under 720px: the bar should fall to two rows with a `⋯`, and everything
   behind it should still work. Widen it again and the bar should be one row, unchanged.

### Deploy

Commit and push. That is the whole deployment — GitHub Pages serves the four files that
matter. There is no build artefact and nothing to invalidate.

---

## 5. Key modules & file summary

### Files

| File | What it is |
|---|---|
| `index.html` | The booklet — markup, CSS and JavaScript in one file. Everything a reader touches. |
| `admin.html` | The gateway console. One administrator's page: providers, the prompt template, the ceilings, and the switch. Never served to readers, and holds no secret of its own. |
| `words.json` | The literary starter pack — 150 words, 8 fields, 5 corrections. Kept at the root under its own name so a booklet can still trade files with the original. |
| `packs/` | The other starter packs, same shape. A new one is a file; nothing in the app needs changing. |
| `supabase/schema.sql` | Four tables, four RLS policies, one index, one signup trigger, and three functions for the writes that must happen all at once. Idempotent. |
| `supabase/gateway.sql` | The gateway's own tables — providers, their secrets, and `app_config` — plus the migrations applied since. Four of them have no RLS policies at all: only the service role reads them, and it exists only inside the function. Idempotent. |
| `supabase/functions/enrich/` | The Edge Function that holds the API key and calls the model, with the README that deploys and proves it. |
| `extension/` | The capture extension. Its own spec, its own storage; it adds words and never enriches. |
| `img/` | Optional drawings for a few concrete words. A missing file removes the figure rather than showing a broken icon. |
| `manifest.json`, `icon.svg`, `icon-512.png`, `apple-touch-icon.png` | Make "Add to Home Screen" work. |
| `README.md` | Setup and use. |
| `ARCHITECTURE.md` | This file. |

### Logical modules inside `index.html`

The script is one scope with no module boundaries; these are the sections it is organised
into, in source order, each one carrying a banner comment of the same name.

This list used to carry line numbers. It stopped being true twice — once when the capture
queue was removed and once when enrichment grew a second path — which is the argument the
section next to it was already making: a line reference is wrong the moment anything above it
changes, and a banner comment is not. Search for the name.

| Module | Responsibility |
|---|---|
| **accounts** | The two Supabase constants, the `ACCOUNTS` flag, `FN_BASE`, the client, and the globals `FIELDS`, `W`, `SEED`, `CORRECTIONS`. |
| **speech** | Voice discovery and filtering, the remembered choice, rate, and `speak()`. Degrades to nothing where `speechSynthesis` is absent. |
| **render** | `esc()`, `posTags()`, `render()`, the swatch strip. Rebuilds the whole book from `W`. |
| **what is on the page** | `applyFilters()`, `markFilter`, and the `.seg` control. The single owner of card `display`: search text and the ✓ filter, answered together. |
| **flash cards** | `fcOpen()`, `fcPool()`, `fcDraw()`, `fcNext()`. `fcSel` holds the ticked fields; `fcPool()` takes a set of them. A deck built on start and dropped on close; it marks through `setLearned()`, never its own store. |
| **holding the scroll still** | `keepStill()` and `topCard()`. Any toggle that changes a card's height goes through it. |
| **the card menu** | The `⋯` on a card — not the one in the bar, below. Filing and unfiling, the in-card removal confirm, and the delegated click handler covering speak / Arabic / ✓ / study-mode reveal. |
| **the bar on a phone** | `openMore()`, `.bar-extra`, `.morebtn`. The `⋯` in the toolbar, which exists only under 720px. Moves nothing: the controls are the same elements the wide bar shows in a row. |
| **data loading** | `norm`, `stem`, the ink palette, the `localStorage` accessors, `apply()` and `boot()`. |
| **the storage seam** | `localStore` — the device-only half, including the overrides and tombstones that let a committed file be edited around. |
| **the same seam, against an account** | `cloudStore` — `rowToWord`/`wordToRow`, the Supabase half, and the offline row mirror. |
| **stocking a new account** | `asError`, `errText`, `seedAccount()`. |
| **first run** | The pack list, `loadPack()`, `showFirstRun()` and the picker. |
| **signed in, signed out** | `enter()`, `setAcctState()`, `syncNote()`. |
| **the sign-in gate** | The three-mode form, OAuth provider discovery, sign-out, `authText()`. |
| **fields** | `renderFields()`, the inline editor, the ink palette and the eight-field cap. |
| **emptying the booklet** | The one bulk action, behind a typed confirmation. |
| **add words** | `check`, `renderReport()`, `artToSrc()`, and the panel plumbing. |
| **automatic or by hand** | `GATEWAY`, `setEnrichMode()`, `showQuota()`. Every failure path returns to the manual loop with the reason written where the reader is already looking. |
| **a model on this machine** | `localTarget()` and `askLocal()`. An Edge Function cannot dial your desk, so a provider on localhost is unreachable through the gateway however it is configured; this page calls it directly instead — but only from localhost, only for an administrator, and only when the provider in use is itself local. No key is involved, because a local endpoint has nobody to present one to. |
| **the prompt** | `promptText()` and `buildPrompt()`. The one place a prompt is assembled, so the button, the direct call and the gateway cannot disagree about what it says. |
| **what came back** | `previewProblems()`, `previewRow()`, the preview and its keep/discard. |
| **the one press** | The `enrich` handler: the run, the fall back to manual, the quota. |
| **merging a reply** | `mergeArray()`, `mergeMsg()`, and the paste handler that unwraps and feeds it. |
| **turning a reply into an array** | `parseReply()`, and `download()`/`serialise()` with the search filter. |

---

## 6. Data shape

A word, in all three of its homes:

```json
{
  "w": "fealty",  "f": 1,          "p": "noun",
  "d": "A sworn oath of loyalty, especially from a vassal to a lord.",
  "e": "The knight knelt and pledged *fealty* to the new king.",
  "a": "وَلاء",   "n": null,       "i": "img/loom.png"
}
```

| Key | Column | Meaning |
|---|---|---|
| `w` | `w` | The word, base form, lowercase unless a proper noun. |
| `f` | `f` | Field id, matching `fields[]` in `words.json` — or `null` for a word with no field. |
| `p` | `p` | Part of speech. A slashed pair like `"noun / verb"` renders as two pills. |
| `d` | `d` | One plain sentence. Its absence is what makes a word "waiting for detail". |
| `e` | `e` | An example sentence, with the inflected target word in `*asterisks*`. |
| `a` | `a` | Modern Standard Arabic for that specific sense. |
| `n` | `n` | A caution, only where one is earned. Usually absent. |
| `i` | `i` | A picture — a path in `img/`, or a `data:` URI produced by `artToSrc()`. |
| — | `norm` | `norm(w)`. Carries the uniqueness constraint. Never leaves the database. |
| — | `done` | The ✓ mark. Per account, which is what makes a tick on the iPad show on the laptop. |
| — | `id`, `user_id`, `created_at` | Bookkeeping. Dropped by `rowToWord`. |

Two conventions are worth knowing because code depends on them:

- **`n` and `i` are absent rather than `null` in the file.** `rowToWord()` enforces this so
  an export from an account is byte-for-byte the format the original single-user booklet
  wrote, and the two versions can still trade files.
- **Key order is fixed** — `w`, `f`, `[i]`, `p`, `d`, `e`, `a`, `[n]` — for the same reason.

`serialise()` is the single definition of what a `words.json` is, so an export and
a commit can never disagree. Words still waiting for detail are deliberately left out: a
blank definition is a note to self, not a booklet entry.
