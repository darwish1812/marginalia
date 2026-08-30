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
| `restock(pack)` | Forgets the tombstones and the overrides, then stocks the pack as if for the first time. | The same writes as a seed, by the ordinary paths — `remove_field` for the fields the pack does not name, `upsert` for the ones it does, `merge_words` for its words. |
| `addFixes(fixes)` | Appends to the local corrections list. | `upsert` on `(user_id, norm_wrong)`, ignoring duplicates. |
| `doneList()` | The `vocab-booklet-progress` array. | `this.ready`, taken straight off the loaded rows' `done` column. |
| `setDone(w, on)` | Rewrites the whole array from the in-memory set; the arguments are ignored. | Updates that one row. Optimistic — the tick has already moved on screen, and a failure is reported in the status line rather than snatched back. |
| `clearDone()` | Empties the array. | `update({done:false})` across the account. |

`savedNote` is a per-store string appended to the merge confirmation, so the same message
says "Saved in this browser" locally and "Saved to your account" in the cloud.

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

**Restocking is a different call on purpose.** Emptying the booklet leaves a reader in the
one state the first-run picker was written for — fields standing, not a word in them — so the
picker is offered there too, and `store.restock(pack)` is what its start button reaches. It
cannot be `seed_account()`: that is guarded by `seeded_at`, and the guard is doing exactly
its job. So `restock()` asks for the same four writes through the ordinary paths instead —
the fields the pack names replace the ones standing, including all of them when it names
none — which is also the honest description of what it is. Locally there is one more thing to
undo first: `removeAllWords()` writes every word into the tombstone list, and without
clearing it the pack's words would be filtered straight back out on the way in.

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

### 3.6a The shell

Everything used to hang off one sticky toolbar: the search box, the mark filter, two reading
lenses, a mode, a settings menu and a running tally — seven controls of three different kinds
in a single row. It held that row only above 1400px. Between 1400 and 720 two media queries
tightened the gaps, the padding, the letter-spacing and the search box's minimum to buy back
the forty pixels an iPad in landscape was short of. Below 720 the compromise gave out and
four of the seven folded behind a `⋯`. Underneath the bar hung three panels — Add words,
Settings, Edit fields — which meant the app's whole navigation model was one bar and a
drawer, with nowhere to put anything new.

What stands there now is an app shell: **Book, Add, Study, You**, in a sidebar at 1180px and
up, a 78px rail with the field index beside it between 720 and 1180, and a bar along the
bottom under 720. `.shell` is a two-column grid and that is the whole of the layout; the
three arrangements are three `grid-template-columns` and a handful of rules about which way
the rail runs.

**The page is still the scroller.** The nav is `position:sticky` with `height:100dvh` rather
than a pane with its own overflow, and the head above the book is sticky the way the bar was.
That is deliberate and load-bearing: `keepStill()`, every `scroll-margin-top` in the
stylesheet, the print rules and the splash observer all assume the document scrolls, and a
shell that took the scroll away would have broken four things to tidy one.

Three modules went with the bar, and nothing replaced them:

- **`sizePanels()`**, `--barh` and `--panelmax`. A panel dropping out of a sticky bar had to
  be told how much room was left underneath it, measured on every scroll frame. A panel is a
  destination now, in the page's own flow, so there is nothing left to measure.
- **`openMore()`** and the `.bar-extra` sheet. Study mode and العربية moved into the View
  lens, Settings became a destination, and what is left in the head fits a phone in one row.
  There is nothing to overflow.
- **The swatch strip.** The eight inks with their counts sat on the cover, so the index of
  the whole booklet was gone on the first flick. `renderIndex()` draws the same list twice —
  a column for a screen with room for one, a strip of chips for a screen without — and both
  carry `data-field`, so one delegated handler serves them.

**`openPanel()` became the router.** It already knew how to show one panel and hide the rest;
it now also hides the book and the head, and lights the matching tab. `go(dest)` is the four
destinations on top of it, and Study is the odd one: the deck is a fixed overlay rather than a
view, so it opens over whatever you were reading and `fcClose()` hands the tab back.

**The field filter is the third question `applyFilters()` answers.** The search box and the
mark filter were always answered together there, because two handlers each writing `display`
on its own terms undo each other. Choosing a field in the index is the same kind of question,
so it goes in the same function — and it hides sections rather than cards, since the section
is the thing that carries the field.

**A card opens where it sits.** At rest it is the word, its part of speech, its meaning and
its speaker; `.card.open` adds the sentence, the picture, the caution and the Arabic. The
toggle goes through `keepStill()`, like every other change to a card's height. Study mode
keeps its own reveal and the open state stands aside for it. The speaker is never hidden:
hearing a word is the point of this booklet, and it stays on the card at every width.

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

### 3.6b Running to the edges

Added to an iPad's Home Screen the app owns the whole display, but it was stopping short of
it: the strip holding the clock and the battery was not the booklet's navy, so it read as a
page pasted onto the screen. Everything iOS needs was already in the markup —
`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`,
`theme-color` — except `viewport-fit=cover`, without which iOS insets the web view to the
safe area and `black-translucent` never gets to mean anything.

iOS always draws the clock and the battery; no web app can remove them, and only Safari's
Fullscreen API can hide them outright, which does not apply to a Home Screen launch. What
changed is that the background now runs underneath them.

Covering the whole screen makes the whole screen ours to keep clear, and nothing in the repo
used `env(safe-area-inset-*)` before. The insets are added to padding that already existed —
the cover's top, `.wrap`'s gutters, `body`'s bottom, all four sides of the flash-card overlay,
and the signed-out grid — so on anything without insets they resolve to `0px` and the layout
is what it always was. The panel's is subtracted in the stylesheet rather than in
`sizePanels()`, because a stylesheet can read `env()` and a script cannot.

The sticky bar takes its inset only while it is stuck (`.bar-wrap.stuck`, set from the rect
`sizePanels()` already holds). Padding it unconditionally would have put the same ~24px back
above the toolbar in the middle of the page, which is the measurement the bar was cut down to
save in the first place.

**An installed Home Screen app caches the meta tags from when it was added**, so
`viewport-fit` does not reach an existing icon: it has to be deleted and re-added.

### 3.6c Settings, and the two actions that ask

Settings held three kinds of thing in one flat list: three doors to other panels, a bulk
action, and four preferences. A reader after the download had to know it lived under a gear
beside a voice picker. They are grouped now — **Your words**, then **This device only**, then
**Starting over** — and the middle line is the app's own, not a new one: words, marks and
corrections follow the account, while pictures, voice and speed are per-device on purpose.
The two actions there is no way back from sit together and last, behind a fold that is shut
when the panel opens.

**Keep a copy was removed on 2026-08-29,** and `download()` and `serialise()` with it —
nothing else called either. It offered a `words.json` and a `progress.json`, and it dated
from before accounts, when a download was how a word survived closing the tab. It is worth
naming what went with it: there is now no export at all, so a copy running with no Supabase
project behind it keeps words in the browser and has no way to get them out. Four messages
that pointed a reader at that button — the merge confirmation, the add-words hint, the
account hint and the accounts-are-not-set-up panel — were rewritten to stop promising it.
`automerge` looks like a preference but persists on the account through `/me`, so it stays
with the doors, under the one it changes.

**Empty this booklet** moved here out of the account panel. It acts on the booklet, not on
the account, and it now stands beside the other thing that acts on everything.

**Reset marks moved here out of the toolbar, and it asks.** It wore the same pill as Study
mode and fired on a single click — `done.clear()` and `store.clearDone()`, every tick gone
from every device — which made the cheapest gesture in the app the one that threw away every
decision in it. Removing a single word already asks twice. Now this asks too, and the
confirmation names the count, because "reset marks" does not say what you are about to lose
and "Reset 55 marks" does. The button is disabled
when nothing is marked, and `openPanel()` calls `resetIdle()` and `emptyIdle()` whenever
Settings opens, so neither confirmation is ever found half-open and the disabled state is
recomputed against a count that moves while you read.

**The panel is one grid, three columns wide.** `#settings` carries
`auto minmax(240px,1fr) minmax(180px,auto)`, and the groups and the rows are both
`display:contents`, so every row's three cells — name, reason, control — fall through into
the panel's own columns rather than into columns of their own. That is the whole of the
alignment: laid out row by row, each reason began wherever its title happened to end and no
two controls shared an edge; even a grid per group left three different title columns,
because a group can only measure its own rows.

Both columns that can flex carry a floor, and they need one each. The control column was
`auto` first: sized to the widest control in the panel — then Keep a copy's two buttons — it held
that width on a narrow screen too, and since the `1fr` reason column had a min of `0` it
absorbed every pixel of the shrinking and collapsed to 76px on an iPad held upright. With a
floor on each, the control column is what gives, and those two buttons stack, which is the
right row to sacrifice.

That held down to about 1024px and no further, which is not what this paragraph used to
claim. `152 + 240 + 180` and two gaps is 612px, and an iPad held upright leaves the panel
435 once the rail and the field index have taken theirs — so it overflowed by 132px and put
a horizontal scrollbar under the whole app. Floors stop a column collapsing; they cannot
make three columns fit in the width of two. Below 1024px the panel stops being a grid
entirely — see 3.6d.

That is also what fixed the confirmations. They live in the control cell and wrap inside it,
so a row grows downward while its right edge stays where every other right edge is — the two
bulk actions no longer need blocks of their own, and no longer start at the left margin while
eight other controls sit on the right.

**An empty cell is still a row.** Both bulk rows keep a `<p class="note">` for their
confirmation to speak on, and a childless `<p>` is a grid item like any other: its own bottom
margin claimed an 8px track under each of them, so those two rows sat 8px further apart than
every other pair in the panel. `:empty` takes them out of the grid until they have something
to say. The status line above the groups is a child of the grid too, and needs
`grid-column:1/-1` or it reports being offline down 152px of title column.

**The rows carry no hairline.** Three columns holding their line is structure enough; a rule
every forty pixels through ten rows is a fence around every word. Only the groups keep one —
and below 1024px, where there are no columns to hold the line, the rows do get one.

**The page under the bar is never shorter than the screen,** and that is what fixed the bar
drifting up an iPhone. `.views` carries `min-height:100dvh` on a phone. **You** is the one
destination whose content does not fill 844px, and it was the one the bar jumped on, while
Add — 83px taller, and so scrollable — was not. On a page that cannot scroll, WebKit lays a
`position:fixed` element out against the document rather than the viewport, and does not
re-lay it out until something scrolls: which is why the bar stayed up after walking back to
the book. Every destination is at least a screen tall now, and the fault has gone.

It measured perfectly in Chromium throughout — flush to the viewport bottom on every
destination, with no ancestor making a containing block for it — so it was found by
correlation rather than by measurement: the one destination that could not scroll was the one
that misbehaved.

**The bar is also opaque and carries no backdrop-filter,** which was the *first* guess and
was wrong: it shipped a deploy earlier and the bar went on moving. It stays removed on its
own merits — at `rgba(20,22,52,.97)` the blur was doing nothing anybody could see, and a
`backdrop-filter` promotes a fixed element into its own composited layer for no gain. The
safe-area inset is the bar's padding rather than an addition to it: it is already the height
of the home indicator, and Apple's own bars sit their labels directly on top of it.

**`.views` also ends above the bar** — a plain fault found while looking for the other one.
The page ended 30px below its last card while a 60px bar stood over it, so the last card in
the book could only be read by scrolling it underneath.

If a fixed bar ever misbehaves here again, the answer is to stop using `position:fixed` on a
phone at all: give `.shell` the viewport height and let `.views` be the scroller, so the bar
is a grid row that cannot move. That changes which element scrolls, which `keepStill()`, the
splash observer and every `window.scrollTo` in `openPanel()` are all written against — worth
doing only against a fault that has been reproduced.

### 3.6c2 Removing a word, and the booklet's first dialog

The confirmation used to be built inside the card, on the argument that this booklet asks
every question where you are standing and has no dialogs anywhere. The card turned out to be
the problem rather than the place: a message made of the card's own serif, the card's own
grey and a hairline exactly like the one under the Arabic reads as more entry however it is
worded. Three treatments that kept it in the card — its own recessed surface, a takeover, a
band bleeding past the margins — were all answers to *make it look less like the card*. A
sheet is not on the card at all.

**One dialog, at every width.** Below 720px it rises from the bottom edge, which is where a
thumb is; above, it stands in the middle, because a bottom edge two feet across is nowhere
near a mouse. Same ink, same words, same two answers — only where it sits changes. `.ask-row`
is one column on a phone and two on a desk: side by side on a phone, a thumb reaching across
for the safe answer passes over the destructive one on the way.

**The answers name outcomes.** *Remove the word* and *Keep it*, not Remove and Cancel —
Cancel names the mechanism, and on a question there is no way back from the safe answer
should read clearest. The safe one holds focus when it opens, the way emptying does.

**`askUp` is the state, not the class.** Opening waits a frame before adding `.up`, so the
browser has laid the sheet out at `translateY(102%)` and has something to transition from.
An Escape inside that frame closed a sheet which then opened itself when the frame arrived —
and stayed open, because the tidy-up 300ms later read the class, saw `.up`, and left it. One
flag both halves agree on.

**A failure keeps it up and speaks in it.** The card is behind a scrim and cannot be read, so
`cardFault()` alone would put the reason somewhere invisible — the same fault the status line
already had, one layer further out. `removeWord()` returns whether the word actually went,
and the sheet comes down only if it did.

**What it costs.** This is the first dialog in the booklet, and it brings what a dialog
brings: a focus trap on Tab, Escape at the head of the chain the rest of the app answers on,
`body.ask-on{overflow:hidden}` for the scroll, and a downward drag — the handle promises a
throw, so it has to be one. The drag is on the whole sheet rather than the 38px handle, since
a thumb aiming at a 38px bar is a thumb aiming at nothing, and the two answers are excluded
or pressing one would sometimes count as a drag.

### 3.6d You, where the panel is narrow

Below 1024px the same rows become what a phone settings screen is. This is one media query
and the markup those rows need; nothing above the breakpoint changes.

**1024 and not 719,** which is where the rest of the shell turns. The panel does not get the
whole screen: an iPad upright is 834px wide and leaves it 435, narrower than the phone the
layout is named after. The width is a question about the panel, not about the device.

**A card, then folds.** The panel opens on `#youcard` — the account, whether it is saving,
and the tally with a bar. Those were three separate things: the tally floated above the list
in the smallest type on the page, attached to nothing, and the account was a row whose
control said **Signed in**, which is a state wearing a button's clothes. The card is also the
door to the account panel, which is where **Sign out** lives — the same place an iPhone keeps
it, behind the name at the top of Settings. `#tally2` and the Account row are hidden here;
they are what the desk uses instead.

**A row is one line:** name on the left, the answer on the right. The reason is hidden and
the control loses its pill — on a line already headed PICTURES, a button reading *Pictures
on* says the word twice and tells you nothing a plain **On** does not. Every control carries
both lengths on `data-long` / `data-short`; `ctlLabel()` writes them and `relabel()` swaps
them, including when a phone is turned sideways across the breakpoint.

**The reasons are hidden, not deleted.** `youDescribe()` gives each `.set-d` an id and points
its control at it with `aria-describedby`, so a row drawing only *Reading speed* is still
read out with *slower is easier to shadow aloud when a word is new* behind it. A referenced
element is announced even when it is `display:none`, which is the whole reason this works.

**The tap target is the row, not the chevron.** A chevron is 14px wide on a line 343px long,
so the click is forwarded in script — but only on rows with exactly one button to forward it
to, and never on the two that ask, where a stray thumb should not land. Those two keep their
own small target and an ellipsis on the label, which says *this one stops to ask* without
repeating the row's own name.

**While a bulk action asks, its row gives the confirmation a line of its own,** through an
`.asking` class set where the confirmation is built and cleared by `resetIdle()` /
`emptyIdle()`. Two pills and a sentence do not fit beside a name in 343px, and without it the
name is squeezed to nothing.

**The folds remember.** `vocab-you-folds` holds one boolean per group. Your words is open at
rest and the other two are shut: a reader who opens **You** is likelier to be adding words
than changing a voice, and a fold is a small piece of distance to put in front of the two
things there is no way back from. The heading is a `<button>` because down here it does
something; above the breakpoint `foldSync()` takes it out of the tab order and strips its
`aria-expanded`, since a control that does nothing should not stop a keyboard.

**The panel gives up its own frame.** `#settings` is a box in the same ink as the rows inside
it, so a card drawn on top read as a card inside a card and neither looked like either — and
the 24px it was holding is 13% of the width of a phone.

**`.set-t` and `.set-d` are scoped to `.panel` on purpose.** Unscoped they lose to `.panel p`
— and had been losing. A title asks for 12px, `--paper` and 5px beneath it, and was rendering
at 15px, dim, with 16px: the same grey as its own description, and three lines of air where
one was asked for. That single override was about a quarter of the panel's height.

### 3.7 Auth gate

One form, three modes (`in`, `up`, `reset`), sharing the email and password fields because
they are the same two questions asked for different reasons; only the heading, the button and
the submit handler change. `authText()` rewrites the five Supabase errors worth saying better.

The OAuth buttons are not hard-coded: the gate fetches `/auth/v1/settings` from the project
and renders one button per provider actually switched on, so there are never dead buttons and
nothing to keep in step by hand. Marks are drawn inline for Google, Apple, Microsoft
(`azure`) and GitHub; the rest get a labelled button.

Two providers hand back the account you used last without asking. That is right for a site
nobody leaves and wrong for a booklet somebody has just signed out of — signing out and
straight back in as the same person is not a sign-in, it is a stutter with no way past it. So
Google and `azure` are sent `prompt=select_account`, the providers' own parameter, passed
through `queryParams` untouched. The rest have no equivalent and are sent nothing.

Above 900px the sign-in page is two panes: the form on the left, where the reading starts,
and the cover on the right, introducing the booklet. That cover is a logo more than a cover,
so it drops the eyebrow — a reading of how many words and how many fields, taken off a
booklet the reader does not have yet — and carries the splash's strip of eight inks under
the wordmark instead, held still. The strip's shape is `.inks`, shared; only `.splash .inks
span` animates. It is a grid on `#app` under
`body.signed-out`, which by then holds nothing else — the bar, the book and the empty-search
line are all already hidden in that state. Below 900px it is the single column it always was.
The wordmark is sized for a whole page, so it is brought down to a half one there.

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
7. Narrow the window under 720px: the head should stay one row, the four destinations should
   move to a bar along the bottom, and the field strip should stick under the head.
8. Open **You** and drag the window across 1024px in both directions. Under it: a card, three
   folds, one-line rows, and short control names. Over it: three columns, every reason, the
   long names, no card — and no horizontal scrollbar on either side of the line, which is the
   fault the width was chosen for.
9. Empty the booklet from **You → Starting over**; the picker should come back, offering the
   packs and a way to leave it empty.

### Deploy

Commit and push. That is the whole deployment — GitHub Pages serves the four files that
matter. There is no build artefact and nothing to invalidate.

---

## 5. Key modules & file summary

### Files

| File | What it is |
|---|---|
| `index.html` | The booklet — markup, CSS and JavaScript in one file. Everything a reader touches. |
| `index.legacy.html` | The same file before the shell, kept whole: one sticky toolbar, panels dropping out of it, the ink strip on the cover. Nothing links to it and nothing serves it; it is there to diff against. |
| `admin.html` | The gateway console. One administrator's page: providers, the prompt template, the ceilings, and the switch. Never served to readers, and holds no secret of its own. |
| `tests/` | The harness. A Playwright suite run against `index.html` with the accounts blanked at run time — built each run, never a copy kept in the repo, because a copy goes stale and then passes while testing an app that no longer exists. |
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
| **faults** | `VERSION`, `fault()`, and the two window listeners. Writes what broke to the `faults` table: uncaught errors, unhandled rejections, the two sync failures the reader is already shown, and a booklet that would not open. Signed in only, twelve rows a session, deduplicated, and never a word of anybody's content. Never throws and never blocks: a reporter that can break the app is a second fault, not a first. |
| **speech** | Voice discovery and filtering, the remembered choice, rate, and `speak()`. `refreshVoices()` re-reads the list when the app returns to the front and when You opens — it was read twice in the life of a page, which is not enough on a phone that downloads voices and resumes rather than reloads. `pickVoice()` also has to call `showVoiceRow(true)`: the row only ever knew how to take itself away, and Chrome answers the first `getVoices()` with an empty list, so the row hid itself during load and stayed hidden for the life of the page while `refreshVoices()` refilled a `<select>` nobody could see. Degrades to nothing where `speechSynthesis` is absent. |
| **You, where the panel is narrow** | `isPhone()`, `ctlLabel()`, `relabel()`, `youCard()`, `foldInit()`, `foldSync()`, `youDescribe()`. Below 1024px the settings panel is a card and three folding groups of one-line rows; the stylesheet draws it and this does the four things a stylesheet cannot — one control name in two lengths, the card's contents, the folds and their memory, and the hidden reasons kept reachable through `aria-describedby`. The width lives in `narrowQuery()` and must match the media query. |
| **render** | `esc()`, `posTags()`, `render()`, and the ink index. Rebuilds the whole book from `W`. |
| **what is on the page** | `applyFilters()`, `markFilter`, `fieldFilter`, and the `.seg` control. The single owner of card `display`: the search text, the ✓ filter and the chosen field, answered together. |
| **flash cards** | `fcOpen()`, `fcPool()`, `fcDraw()`, `fcNext()`. `fcSel` holds the ticked fields; `fcPool()` takes a set of them. A deck built on start and dropped on close; it marks through `setLearned()`, never its own store. |
| **holding the scroll still** | `keepStill()` and `topCard()`. Any toggle that changes a card's height goes through it. |
| **the card menu** | The `⋯` on a card — not the one in the bar, below. Filing and unfiling, the in-card removal confirm, and the delegated click handler covering speak / Arabic / ✓ / study-mode reveal. |
| **the shell** | `go()`, `openPanel()`, `renderIndex()`, `setField()`, and the View lens. Four destinations, the ink index that is also the filter, and the one function that decides what is on screen. |
| **resetting the marks** | `resetIdle()` and the `#resetrow` handler — the second of the two bulk actions, and the second to ask before it acts. |
| **data loading** | `norm`, `stem`, the ink palette, the `localStorage` accessors, `apply()` and `boot()`. |
| **the storage seam** | `localStore` — the device-only half, including the overrides and tombstones that let a committed file be edited around. |
| **the same seam, against an account** | `cloudStore` — `rowToWord`/`wordToRow`, the Supabase half, and the offline row mirror. |
| **stocking a new account** | `asError`, `errText`, `seedAccount()`. |
| **first run** | The pack list, `loadPack()`, `showFirstRun()` and the picker — offered again, as `restocking`, to a booklet that has just been emptied. |
| **signed in, signed out** | `enter()`, `setAcctState()`, `syncNote()`. |
| **the sign-in gate** | The three-mode form, OAuth provider discovery, sign-out, `authText()`. |
| **fields** | `renderFields()`, the inline editor, the ink palette and the eight-field cap. |
| **emptying the booklet** | The one bulk action, behind the same two-button confirmation Reset marks uses. It asked you to type the word `empty` until 2026-08-29; the count on the button does that work now. |
| **add words** | `check`, `renderReport()`, `artToSrc()`, and the panel plumbing. |
| **automatic or by hand** | `GATEWAY`, `setEnrichMode()`, `showQuota()`. Every failure path returns to the manual loop with the reason written where the reader is already looking. |
| **a model on this machine** | `localTarget()` and `askLocal()`. An Edge Function cannot dial your desk, so a provider on localhost is unreachable through the gateway however it is configured; this page calls it directly instead — but only from localhost, only for an administrator, and only when the provider in use is itself local. No key is involved, because a local endpoint has nobody to present one to. |
| **the prompt** | `promptText()` and `buildPrompt()`. The one place a prompt is assembled, so the button, the direct call and the gateway cannot disagree about what it says. |
| **what came back** | `previewProblems()`, `previewRow()`, the preview and its keep/discard. |
| **the one press** | The `enrich` handler: the run, the fall back to manual, the quota. |
| **merging a reply** | `mergeArray()`, `mergeMsg()`, and the paste handler that unwraps and feeds it. |
| **turning a reply into an array** | `parseReply()`, and the search filter. |

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

`serialise()` held the single definition of what a `words.json` is, so an export and a commit
could never disagree. It went with Keep a copy — the booklet only reads that format now, it
does not write it.
