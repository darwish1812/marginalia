# Adding words — how the pipeline works

Written for changing it. Every stage is named by its function rather than its line number,
because line numbers rot the moment anything above them moves. `ARCHITECTURE.md` covers the
rest of the app; this file is only the path a word takes from a list you typed to a card on
the page.

---

## The shape of it

```
   you type or paste a list
             │
             ▼
   ┌──────────────────────┐   split, de-duplicate, sort into four buckets
   │  check               │   norm() decides "already have it"
   └──────────┬───────────┘   stem() only suggests a near-match
              │
       ┌──────┴───────┐
       ▼              ▼
  buildPrompt    addnow                 two ways out of stage 1
  (or build-     "add as needs-
   Propose-       detail now"           → bare rows, no definition,
   Prompt)            │                    land in Waiting for detail
       │              │
       ▼              │
  you carry it to     │
  a model, bring      │
  the reply back      │
       │              │
       ▼              │
  ┌────────────────┐  │        strip fences, JSON.parse,
  │ paste handler  │  │        unwrap {fields,words} if present
  └───────┬────────┘  │
          ▼           │
  ┌────────────────┐  │        validate → corrections → drawings
  │  mergeArray    │  │        → carry pictures → save
  └───────┬────────┘  │
          └─────┬─────┘
                ▼
        store.addWords(add, retired)
                │
       ┌────────┴────────┐
       ▼                 ▼
  localStore         cloudStore
  localStorage       merge_words() — one transaction
                │
                ▼
       render() · loadProgress() · showLocal()
```

Two entry points, one exit. Everything below `mergeArray` is indifferent to which entry was
used, and `mergeArray` itself is indifferent to where its array came from — that is the seam
that matters most, and §4 explains why.

---

## 1. Stage one — `check`

The click handler on `#check`. Takes the textarea and produces four buckets plus the working
list `fresh`.

**Splitting.** `raw.split(/[\n,;]+/)`, then each item has leading list numbering stripped
(`/^\s*\d+[.)]\s*/`) and is trimmed. Empty items are dropped. So newlines, commas,
semicolons, `1.` and `1)` all work; tabs and bullet characters (`-`, `•`) do **not**.

**De-duplication at this stage is on the raw string**, via `new Set`. That matters: `fealty`
and `Fealty!` are two different raw strings and both survive into the buckets. See §5.

**The two normalisers.**

| | What it does | What it is for |
|---|---|---|
| `norm(s)` | lowercase → NFKD → strip everything but `a-z`, space, hyphen → trim | The definition of "already have this word", everywhere in the app. The database carries `unique (user_id, norm)`, not `unique (user_id, w)`. |
| `stem(s)` | `norm` then two passes stripping `ingly edly ously fully ing ed ies es s ly ness ment tion ion ity ous ful` | **Only** to suggest a near-match. It never blocks anything. |

`norm` is deliberately brutal: `café` → `cafe`, `ne'er-do-well` → `neerdo-well`. Two spellings
that normalise alike are the same word as far as this app is concerned.

**The four buckets.**

| Bucket | Test | What happens to it |
|---|---|---|
| `dups` | `norm` matches a word that **has** a definition | Dropped. Shown greyed, not offered. |
| `again` | `norm` matches a word with **no** definition | **Re-offered.** Otherwise nothing in the panel could ever reach a captured-but-bare word. |
| `nears` | `stem` matches an enriched word | Offered, labelled `≈ existing`. Your call. |
| `fresh` | none of the above | Offered. |

Then `again` and `nears` are appended into `fresh`, so `fresh` is the full list the prompt
will ask about. `renderReport` draws a removable chip per item; dropping a chip splices it
out of `fresh` and rebuilds the prompt.

Note `stems` is built only from words that have definitions, so near-match detection is blind
to pending words.

**`showQueue` / the queue button** is a shortcut into the same state: it sets `fresh` to every
word in `W` with no definition and calls `renderReport([], [], pend)`. It bypasses the
textarea entirely.

---

## 2. Stage two — the prompt

Two functions, chosen by whether the booklet has any fields.

**`buildPrompt()` — the normal one.** Prints the field list as `id = name: note`, then ten
numbered rules. The rules cover: one object per word in order; base forms and misspelling
correction returned as `x`; the field as an integer **or `null`**; part of speech; the shape
of `d` and `e`; the Arabic; when a caution is earned; a no-markup rule; and when a drawing
is appropriate.

The field `note` is doing real work here — it is the only thing telling the model what
belongs where. A field with a blank note quietly degrades every later classification.

**`buildProposePrompt()` — when `FIELDS` is empty.** A blank booklet, or every field deleted.
Asks the model to propose the taxonomy from this first batch *and then* file into it,
returning an **object** `{"fields":[…],"words":[…]}` instead of a bare array. The reasoning:
nobody knows their eight fields before they own fifty words, and they do know them afterwards.

**`setReady(on)`** is what gates steps 2 and 3 — it toggles the `waiting` class and the
`disabled` attribute on `copyp`, `addnow`, `merge` and `incoming`.

---

## 3. The escape hatch — `addnow`

"Add as needs-detail now". Skips the model entirely.

Builds `{w, f: null, p:'', d:'', e:'', a:''}` for each item in `fresh`, **filtered against
both `W` and itself** by `norm` — so a word already captured, or two typings that normalise
alike, cannot be inserted twice. Reports how many it passed over. If nothing is new it says
so and leaves the chips and the prompt standing, because step 2 is where those words were
going anyway.

A row with no `d` renders in the synthetic **Waiting for detail** section regardless of `f`.

---

## 4. Stage three — the reply comes back

The click handler on `#merge`. This is the only code that knows about textareas and markdown.

1. `.trim()` then strip a wrapping ` ```json ` fence.
2. `JSON.parse`. On failure the message reports the character position, prints the text
   around it, and names the likely cause — a drawing written with double quotes.
3. **Unwrap.** If the result is not an array but has a `.words` array, this is a
   propose-fields reply: the proposed fields are validated (name present, no `<`), **every
   `"f"` in the reply is checked against the fields that are about to exist**, and only then
   are the fields created. Nothing is written unless the whole reply hangs together.
4. Hand the bare array to `mergeArray`.

**This split is the app's most deliberate seam.** `mergeArray` takes a parsed array and knows
nothing about textareas, fences, or where the array came from — so an array fetched from an
API arrives at exactly the same validation, sanitising and save. Any automation you add
should enter here and nowhere else.

---

## 5. Stage four — `mergeArray(arr)`

**Validate, all-or-nothing.** Per object, in this order:

1. `w` must be a non-empty string.
2. `f` must be `null`/absent, or an id in `FIELDS`. A non-existent id is an error — that is a
   mistake, not a decision.
3. `d` must be a non-empty string.
4. None of `PLAIN = ['w','d','e','a','n']` may contain `<` or `&`.

Any failure returns `{ok:false, errors}` and **nothing is written**.

**Corrections.** An `x` key holds the word as you actually typed it. Where `norm(x) !== norm(w)`,
a `{wrong, right}` pair is recorded, and `norm(x)` joins the retired set so the card filed
under the misspelling does not linger. The `x` key is then deleted so it never reaches an
export. Pairs are de-duplicated against each other and against `CORRECTIONS`.

**Drawings.** An `s` key holds raw SVG. `artToSrc(s)` returns `{src}` or `{why}`:

- Strips a wrapping code fence, an `<?xml …?>` declaration, a `<!DOCTYPE>`.
- Requires the string to start `<svg`, and to be under `2 × MAXART` characters.
- Parses with `DOMParser` as `image/svg+xml`; rejects a `parsererror` (usually a missing
  `</svg>`).
- Requires `viewBox`, **case-corrected** if the model wrote `viewbox`.
- Removes `script`, `foreignObject`, `image`, `iframe`, `style`, `a`, `use`, `animate`, `set`,
  and every `on*` and `href`-like attribute.
- Re-serialises, rejects over `MAXART` (2600), returns a `data:image/svg+xml` URI.

The result becomes the `src` of an `<img>` — **never inline markup** — so the browser will not
run script even if some survived the strip. A rejected drawing does not block the merge; the
reason is reported in the merge message.

**Carry pictures across.** A word being re-enriched keeps its existing picture unless this
reply drew a new one, and a corrected spelling inherits the picture from the misspelling.

**Save.**

```js
const enriched = new Set(arr.map(x => norm(x.w)));   // plus every retired misspelling
const kept     = W.filter(x => !enriched.has(norm(x.w)));
const add      = arr.filter(x => !already.has(norm(x.w)));
const canon    = add.map(rowToWord);                 // canonical key order for export
W = kept.concat(canon);
await store.addWords(add, enriched);
```

`store.addWords(add, retired)` is delete-then-insert. In the cloud it is one call to the
`merge_words()` Postgres function, so both halves are a single transaction. Locally it
rewrites the additions list and clears any tombstones for words that have come back.

**A merge is a replace, not an update.** The old row is destroyed and a new one built from the
reply. That is why pictures need carrying across explicitly — and it is the root of the first
defect below.

---

## 6. Known defects

Present in the code today. §6b and §6d were reproduced by driving the real functions; §6a was
reproduced in part and the table below says exactly which part.

### 6a. A merge overwrites what the model does not own

Because a merge replaces the row, **anything the app knows about a word that the reply does
not carry is not carried either**. The ✓ tick is the current example, and it behaves
differently in the two stores — which is worth stating precisely, because the obvious
description of this bug is wrong:

| | Re-enriched, same spelling | Spelling corrected via `x` |
|---|---|---|
| **local** | Tick survives. `doneList()` is a list of word *strings* in `localStorage`, and the string did not change. | Tick lost. The list still holds the old spelling and no card carries it. |
| **cloud** | **Tick lost on the next load.** The row is deleted and reinserted with `done` defaulting to `false`. It looks fine until you reload, because the in-memory `done` set is not rebuilt. | Tick lost. |

So this is mainly a cloud-mode defect with a delayed symptom, which is the most awkward kind
to notice. Verified in local mode: a same-spelling re-enrichment keeps the tick, so do not
expect to reproduce the cloud behaviour without an account.

Related bookkeeping drift: `loadProgress()` does not clear `done` before repopulating it, so
entries for words that no longer exist linger in memory and `paint()` can report a count
higher than the number of visible ticks.

This all becomes considerably worse the moment the capture extension lands, because
`met_sentence`, `met_url` and `times_met` would be lost the same way — and *that* loss is
silent and permanent. The fix is to generalise the picture carry-across into a rule:

```js
// the model owns w, f, p, d, e, a, n, i — everything else on the row is the reader's
const MINE = ['done', 'met_sentence', 'met_url', 'met_title', 'met_at', 'times_met'];
```

### 6b. `mergeArray` does not de-duplicate within the batch

`add` is filtered against `kept` only — never against itself:

```js
const add = arr.filter(x => !already.has(norm(x.w)));
```

So a reply containing two objects whose `w` normalises alike puts both into the insert and
violates `unique (user_id, norm)`, failing the whole transaction. Rule 1 of the prompt forbids
it, but a prompt is not a constraint.

Reproduced: merging `zizzle` and `Zizzle!` in one array passes validation and lands **both**
in `W`. Locally that gives two cards for one word; against Postgres it fails the insert.

The upstream cause is that `check` de-duplicates on the **raw** string, so both spellings can
reach the prompt in the first place. `addnow` was fixed for exactly this; `mergeArray` was not.

### 6c. `W` is mutated before the save is known to have succeeded

`W = kept.concat(canon)` runs *before* `await store.addWords(...)`. If the save throws, the
database is consistent — `merge_words` is a transaction — but **the app's memory is not**. The
panel says nothing was merged while `W` already believes otherwise, and stays wrong until a
reload. Moving the assignment after the await fixes it.

### 6d. `f` is not coerced

`ids.has(x.f)` is a strict check, so a string id fails. Reproduced: `"f": "1"` returns
**"qqqq: field 1 does not exist"** — a message that names the field and denies it in the same
breath, and sends the reader looking for a problem in their fields. One `Number()` would make
it forgiving.

---

## 7. Where the friction actually is

Ranked by how much they cost a real user, not by how hard they are to fix.

1. **Four manual steps and a second tool.** Copy the prompt, switch app, paste, wait, copy
   the reply, switch back, paste. This is the whole cost of the loop, and it is why the
   backlog grows.
2. **All-or-nothing validation.** One bad object in a reply of twenty rejects the batch. The
   errors are reported, but the reader must go back to the model and re-ask for everything.
3. **No partial retry.** There is no "merge the nineteen that were fine".
4. **Silence between steps.** The prompt is a wall of text with no indication of how long the
   reply should take or how big a batch is sensible.
5. **The bare-word backlog has no pressure.** `Queue the N waiting` exists, but nothing
   suggests doing it.

---

## 8. Enhancement options

Ordered by value per unit of work, with what each one actually touches.

### A. Enrich through the app — a server-side function

**The one that matters.** An Edge Function holding the model API key; the app posts `fresh`
and gets back the same array a human would have pasted. Four steps become one button.

Touches: a new function, a new `store` method or direct `fetch`, and the paste handler's
entry point — `mergeArray` itself does not change at all, which is what it was designed for.

Do the defects in §6 first, especially 6a and 6c. Automation multiplies whatever is broken.

### B. Salvage a partial reply

Return the valid objects and the errors separately instead of rejecting the batch, and offer
*"merge these 19, re-ask for 1"*. Turns the most common failure from a restart into a
footnote.

Touches: `mergeArray`'s return shape and the paste handler's message. No storage change.

### C. Normalise earlier

Move `check`'s de-duplication from the raw string onto `norm`, and add batch-internal
de-duplication to `mergeArray`. Closes 6b and removes a class of confusing failure.

Touches: `check`, `mergeArray`. Small and self-contained — a good first change.

### D. Capture instead of typing

The Chrome extension in `extension/SPEC.md`. Replaces stage one with a keystroke and brings
the real sentence the word was met in — which can then feed the prompt and make the model's
sense-selection unambiguous.

**Do not build this before A.** Frictionless capture with manual enrichment fills the backlog
faster than anyone can drain it.

### E. Batch sizing and progress

Warn above ~40 words, and show that a reply is expected. Cheap, and it prevents the failure
where a reader pastes 200 words and gets a truncated reply.

### F. Let a reply arrive from a file

`serialise()` exists; there is no inverse. An import path would also give you a recovery
route, and it is the same entry point as A — parse, unwrap, `mergeArray`.

---

## 9. If you change one thing, keep this true

`mergeArray` receives a parsed array and knows nothing about where it came from. Every future
source — an API call, a file, the extension, a paste — should converge on it, so that
validation, sanitising, the corrections table, the picture rules and the save exist exactly
once. It is the reason this pipeline is worth enhancing rather than replacing.
