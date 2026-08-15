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

**One design decision explains most of the rest: a database row, a rendered card and a line
in `words.json` are the same shape.** The single-letter column names (`w`, `f`, `p`, `d`,
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
| **Backend** | Supabase — Postgres for data, GoTrue for auth. There is no server-side code of the project's own, and no Edge Functions. |
| **Storage** | Postgres when signed in; `localStorage` when not, and as an offline mirror when signed in. |
| **Speech** | The browser's own `speechSynthesis`. No audio files, no network. |
| **Offline** | A hand-rolled cache in `localStorage`. There is no service worker; the app is *installable* via `manifest.json` but not precached. |

### The two modes

The whole app hangs off one boolean, computed once at `index.html:674`:

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
┌─────────────────────────────────────────────────────────────┐
│  UI — render() · search · speech · panels · the add-words    │
│  loop · print styles.  Knows about cards, never about rows.  │
└───────────────────────────┬─────────────────────────────────┘
                            │  load · addWords · addFixes
                            │  doneList · setDone · clearDone
┌───────────────────────────▼─────────────────────────────────┐
│  `store` — the seam.  One of two objects, chosen by whether  │
│  a session exists.  Same five questions, either way.         │
└───────┬─────────────────────────────────────┬───────────────┘
        │                                     │
┌───────▼──────────────────┐   ┌──────────────▼───────────────┐
│ localStore               │   │ cloudStore                    │
│ words.json + localStorage│   │ Supabase — words, corrections, │
│ Committed file is truth. │   │ profiles.  RLS scopes every    │
│                          │   │ read and write to auth.uid().  │
│                          │   │ Mirrors rows to localStorage.  │
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

### 3.1 Boot — `boot()` at `index.html:1193`

1. `fetch('words.json')`. On success it is also written to `localStorage['vocab-words-cache']`.
   On failure, that cache is read instead; if neither works, `failed()` prints a diagnosis
   that distinguishes a `file://` open from a 404 from a dead network.
2. The parsed file becomes the module-level `SEED`. It is needed for two things forever
   after: `SEED.fields` (the eight fields, which are *not* stored per account) and
   `SEED.words` (the 150 starter words, used only to stock a brand-new account).
3. If `ACCOUNTS` is false — show the book, `store` stays `localStore`, `apply(SEED)`, done.
4. Otherwise ask `sb.auth.getSession()` who is already here, hand the answer to `enter()`,
   and then subscribe to `onAuthStateChange` so every later change goes through the same
   function. A magic link, an OAuth return and a reset link all arrive as a session in the
   URL fragment which `supabase-js` picks up on its own.

### 3.2 Signed in / signed out — `enter(session)` at `index.html:1240`

One function owns the difference, and it is the only place `store` is reassigned.

**With a session:** record `uid`/`email` on `cloudStore`, point `store` at it, clear the
in-memory `done` set, hide the gate, then `apply(SEED)`. If the load throws, `failed()`
explains it — including the "a free project pauses after a week and may be waking up" case,
which is the most likely reason a load fails in practice.

**Without one:** reset `cloudStore`, point `store` back at `localStore`, empty `W` and
`CORRECTIONS`, show the gate in place of the book. The cover's eyebrow is rewritten from
`SEED` here, because `render()` — which normally writes the real counts — never runs when
signed out.

`apply(data)` at `:1150` is the join: it sets `FIELDS`, calls `store.load()`, assigns the
results to the globals `W` and `CORRECTIONS`, and then runs the four painters —
`render()`, `loadProgress()`, `showLocal()`, `renderFix()`.

### 3.3 The storage seam — `localStore` at `:968`, `cloudStore` at `:1012`

Both answer the same six calls. This is the most load-bearing structure in the file: the
merge path and the learned-marks path were written once and never learn where they save to.

| Call | `localStore` | `cloudStore` |
|---|---|---|
| `load(seed)` | `seed.words` plus this device's unsaved additions layered on top. A word already in the committed file always wins. | `seedAccount()`, then `select *` from `words` and `corrections`. Writes the rows to a per-account cache. On any failure, falls back to that cache and sets the global `offline`. |
| `addWords(add, retired)` | Rewrites the local additions list, dropping retired norms. | `delete().in('norm', retired)` then `insert(add)`. |
| `addFixes(fixes)` | Appends to the local corrections list. | `upsert` on `(user_id, norm_wrong)`, ignoring duplicates. |
| `doneList()` | The `vocab-booklet-progress` array. | `this.ready`, taken straight off the loaded rows' `done` column. |
| `setDone(w, on)` | Rewrites the whole array from the in-memory set; the arguments are ignored. | Updates that one row. Optimistic — the tick has already moved on screen, and a failure is reported in the status line rather than snatched back. |
| `clearDone()` | Empties the array. | `update({done:false})` across the account. |

`savedNote` is a per-store string appended to the merge confirmation, so the same message
says "Download the file and commit it" locally and "Saved to your account" in the cloud.

The offline mirror (`vocab-rows-<uid>`) is what lets the booklet open on a train. Reads come
from it when the network does not answer; writes always require a connection and say so.

### 3.4 Stocking a new account — `seedAccount(seed, uid)` at `:1129`

The starter words come from `words.json`, which the browser has already fetched, so the
database never needs its own copy. The guard is `profiles.seeded_at` — not "does this
account have any words" — because an account whose words were all deleted on purpose would
otherwise be re-stocked on the next sign-in and the deletions would undo themselves.

Both inserts are upserts with `ignoreDuplicates`, so a seed interrupted halfway is harmless:
the next sign-in completes it. `seeded_at` is stamped last.

The `profiles` row itself is created by a Postgres trigger (`handle_new_user`, a
`security definer` function) the instant the auth user exists, so the client never has to
decide whether a missing profile means "new" or "something broke mid-signup".

### 3.5 The add-words loop

This is where most of the app's real logic lives.

**Step 1 — `check` (`:1603`).** The pasted blob is split on newlines, commas and semicolons,
numbering like `3.` or `4)` is stripped, and each item is sorted into one of four buckets
using two normalisers:

- `norm(s)` (`:952`) — lowercase, NFKD, strip everything but letters, spaces and hyphens.
  This is what "already have this word" means everywhere in the app, which is why the
  database carries the uniqueness on `norm` rather than on `w`.
- `stem(s)` (`:953`) — `norm` plus two passes of suffix stripping. Used only to *suggest* a
  near-match; it never blocks anything.

| Bucket | Meaning | Fate |
|---|---|---|
| `dups` | Already here, with a definition. | Dropped, shown greyed. |
| `again` | Already here but bare — captured, not enriched. | Re-offered, so the panel can reach them. |
| `nears` | Shares a stem with an existing word. | Offered with a `≈ existing` note; your call. |
| `fresh` | Genuinely new. | Offered. |

Every offered chip can be removed individually. Steps 2 and 3 stay disabled until this runs.

**Step 2 — `buildPrompt()` (`:1639`).** Writes a prompt carrying the field list with its
notes and ten numbered rules covering base forms, misspelling correction (returned as `x`),
field choice, part of speech, the shape of `d` and `e`, the Arabic, when a caution is earned,
a no-markup rule, and when a drawing (`s`) is and is not appropriate.

**Step 3 — `mergeArray(arr)` (`:1724`).** Deliberately split from the paste handler: it takes
a parsed array and knows nothing about textareas, markdown fences or where the array came
from. That is the seam a future API call would use without touching any of the below.

1. **Validate.** Every object needs a non-empty `w`, an `f` that exists in `FIELDS`, and a
   non-empty `d`. The five plain-text keys (`w`, `d`, `e`, `a`, `n`) are rejected if they
   contain `<` or `&`. Any failure rejects the whole batch and changes nothing.
2. **Corrections.** An `x` key holds the word as it was actually typed. Where it differs from
   `w`, a `{wrong, right}` pair is recorded for the misspellings table and the norm is added
   to the retired set, so the card filed under the wrong spelling does not linger. The `x`
   key is then deleted so it never reaches `words.json`.
3. **Drawings.** An `s` key holds raw SVG typed by a model. `artToSrc()` (`:1691`) requires
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

**The escape hatch — "Add as needs-detail now" (`:1674`).** Inserts the words with `f: 0` and
empty everything. `render()` treats field `0` as a synthetic "Waiting for detail" section at
the top of the book; the words are searchable immediately and move to their real field when
enriched. "Queue the N waiting" loads every bare word back into a fresh prompt.

### 3.6 Rendering — `render()` at `:787`

Rebuilds the entire book from `W` on every change. Sections come from `FIELDS`, plus up to
two synthetic ones at the top:

- **Waiting for detail** (id `0`) — any word with no definition.
- **Unfiled** (id `-1`) — a word that has a definition but no field, *or* a field id that
  is not in `FIELDS`.

That second clause is the load-bearing one. Together the three tests are exhaustive and
disjoint, so every word in `W` renders exactly once no matter what `f` holds — which is
what lets a field be deleted without its words falling off the page. They are released to
Unfiled rather than lost.

Cards are built as HTML strings and
everything model-authored goes through `esc()` first — including before the `*asterisk*`
transform, never after, because a signed-in session token lives in this browser and an
unescaped card is how someone would take it. Each card also carries a flattened
`data-s` string, which is the entire search index: search sets `display` on cards and then
hides sections with no visible card left.

`loadProgress()` reads `store.doneList()` and re-applies the ✓ marks to the freshly built
DOM, which is why it always runs immediately after `render()`.

### 3.7 Auth gate — `:1322`–`:1454`

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

1. `SUPABASE_URL` and `SUPABASE_ANON_KEY` at `index.html:671-672`. Both belong in the file
   and in git.
2. `supabase/schema.sql`, run whole in the SQL editor. It is idempotent.
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

### Deploy

Commit and push. That is the whole deployment — GitHub Pages serves the four files that
matter. There is no build artefact and nothing to invalidate.

---

## 5. Key modules & file summary

### Files

| File | What it is |
|---|---|
| `index.html` | The entire application — markup, ~460 lines of CSS, and ~1,180 lines of JavaScript. |
| `words.json` | 150 starter words, 8 fields, 5 corrections. Read on every load; used to stock new accounts and to supply `FIELDS`. Shared and read-only. |
| `supabase/schema.sql` | Three tables, three RLS policies, one index, one signup trigger. Idempotent. |
| `img/` | Optional drawings for a few concrete words. A missing file removes the figure rather than showing a broken icon. |
| `manifest.json`, `icon.svg`, `icon-512.png`, `apple-touch-icon.png` | Make "Add to Home Screen" work. |
| `README.md` | Setup and use. |
| `ARCHITECTURE.md` | This file. |

### Logical modules inside `index.html`

The script is one scope with no module boundaries; these are the sections it is organised
into, in source order.

| Lines | Module | Responsibility |
|---|---|---|
| 671–681 | **Config & globals** | The two Supabase constants, the `ACCOUNTS` flag, the client, and the four globals `FIELDS`, `W`, `SEED`, `CORRECTIONS`. |
| 683–767 | **Speech** | Voice discovery and filtering, the remembered choice, rate, and `speak()`. Degrades to nothing where `speechSynthesis` is absent. |
| 769–857 | **Render** | `esc()`, `posTags()`, `render()`, the swatch strip. Rebuilds the whole book from `W`. |
| 859–948 | **Progress & card interaction** | The `done` set, the tally, the delegated click handler covering speak / Arabic / ✓ / study-mode reveal, and reset. |
| 950–990 | **Local storage helpers + `localStore`** | `norm`, `stem`, the `localStorage` accessors, and the device-only half of the seam. |
| 992–1104 | **`cloudStore`** | `rowToWord`/`wordToRow`, the Supabase half of the seam, and the offline row mirror. |
| 1106–1148 | **Errors & seeding** | `asError`, `errText`, and `seedAccount()`. |
| 1150–1234 | **Load & boot** | `apply()`, `renderFix()`, `failed()`, `boot()`. |
| 1236–1301 | **Session** | `enter()`, `setAcctState()`, `syncNote()`. |
| 1303–1467 | **Auth gate** | The three-mode form, OAuth provider discovery, sign-out, `authText()`. |
| 1468–1568 | **Panels & preferences** | `showLocal()`, `openPanel()`, the outside-click and Escape handling, pictures toggle. |
| 1570–1712 | **Add words** | `check`, `renderReport()`, `buildPrompt()`, `showQueue()`, `addnow`, `artToSrc()`. |
| 1714–1809 | **Merge** | `mergeArray()`, `mergeMsg()`, and the paste handler that feeds it. |
| 1811–1845 | **Export & search** | `download()`, `serialise()`, the two download buttons, the search filter. |

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

`serialise()` (`:1819`) is the single definition of what a `words.json` is, so an export and
a commit can never disagree. Words still waiting for detail are deliberately left out: a
blank definition is a note to self, not a booklet entry.
