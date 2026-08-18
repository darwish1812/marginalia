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
   ┌──────────────────────┐   split, de-duplicate on norm(), sort into
   │  check               │   four buckets, report them in one sentence
   └──────────┬───────────┘
              │  fresh[]
       ┌──────┴───────────────┐
       ▼                      ▼
  promptText()          POST /run            two ways to reach a reply
  you carry it          the gateway          — manual, and one press
  to a model            assembles the
       │                same prompt
       │                      │
       ▼                      ▼
  paste it back        preview: keep or discard
       │                      │
       └──────────┬───────────┘
                  ▼
          parseReply(text)          strip fences, JSON.parse,
                  │                 unwrap {fields,words} if present
                  ▼
          mergeArray(arr)           validate → corrections → drawings
                  │                 → carry pictures → save
                  ▼
   store.addWords(add, retired, renames)
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
  localStore            cloudStore
  localStorage          merge_words() — one transaction
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

**De-duplication is on `norm`**, not on the raw string. `fealty` and `Fealty!` are two
different strings and one word, and letting both through used to send both to the model,
which sent back two objects that collide on the unique index. The first spelling typed is
the one kept.

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

Then `again` and `nears` are appended into `fresh`, so `fresh` is the full list the reply
will be asked for. `renderReport` writes one sentence — how many are to be enriched, and
which words were dropped and why. It used to draw a removable chip per word; the words are
in the box directly above with a cursor in it, which is a better place to edit a list.

Note `stems` is built only from words that have definitions, so near-match detection is blind
to pending words.

---

## 2. Stage two — the prompt

Two functions, chosen by whether the booklet has any fields.

**`DEFAULT_TEMPLATE` — the normal one.** Prints the field list as `id = name: note`, then ten
numbered rules. The rules cover: one object per word in order; base forms and misspelling
correction returned as `x`; the field as an integer **or `null`**; part of speech; the shape
of `d` and `e`; the Arabic; when a caution is earned; a no-markup rule; and when a drawing
is appropriate.

The field `note` is doing real work here — it is the only thing telling the model what
belongs where. A field with a blank note quietly degrades every later classification.

**`DEFAULT_PROPOSE` — used when `FIELDS` is empty.** A blank booklet, or every field deleted.
Asks the model to propose the taxonomy from this first batch *and then* file into it,
returning an **object** `{"fields":[…],"words":[…]}` instead of a bare array. The reasoning:
nobody knows their eight fields before they own fifty words, and they do know them afterwards.

Both live as constants (`DEFAULT_TEMPLATE`, `DEFAULT_PROPOSE`) and are assembled by one
function, `promptText()`, which substitutes `{{WORDS}}`, `{{FIELDS}}` and `{{COUNT}}` exactly
as the gateway does. `TEMPLATE` and `PROPOSE` are filled from `app_config` at load and fall
back to the constants — so a booklet with no gateway, or one whose config will not load,
behaves as it always did.

**`setReady(on)`** gates the later steps: the `waiting` class, and `disabled` on `copyp`,
`merge`, `incoming` and `enrich`.

**`setEnrichMode(mode)`** is one class on `<body>`. Automatic mode hides the prompt, Copy,
the paste box and the download; nothing is removed from the DOM, so every failure falls back
to the manual loop with a class flip rather than a re-render.

---

## 3. The one press — `#enrich`

Posts `{items: fresh, fields: FIELDS}` to the gateway. **Structured data only, never the
assembled prompt** — a shared key that forwards whatever text a browser sends is an open
proxy, so the function builds the prompt itself from a template it holds.

What comes back goes to `parseReply` and then either straight into `mergeArray`
(`auto_merge` on) or into a preview: the words as words, split into what is ready to keep
and what came back wrong, with `Keep` counting only the former. A batch already answered for
cannot be sent again until it is kept or discarded — without that guard, pressing twice
charged the allowance twice for one list.

Every failure calls `setEnrichMode('manual')` and writes the reason into `#mergemsg`: the
service unreachable, the key refused, the allowance spent, a reply that will not parse. In
the last case the raw text is put in the paste box so it can be fixed by hand rather than
lost.

**"Add as needs-detail now" is gone.** It captured a word bare, with no definition, and
existed because enriching was slow enough that a backlog beat losing the word. Nothing
creates bare rows now — but they can still exist from before, and the capture extension will
create them again, so the **Waiting for detail** section and the `!x.d` test that draws it
both stay.

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

## 6. The defects that were here, and how they were closed

All four are fixed. They are kept because the reasoning is the useful part — each one is a
shape of bug this pipeline can grow again, and three of the four were invisible until
something was driven at them deliberately.

### 6a. A merge overwrote what the model does not own

A merge replaces the row rather than updating it, so anything the app knew about a word that
the reply did not carry was not carried either. The ✓ tick was the example, and it behaved
differently in the two stores:

| | Re-enriched, same spelling | Spelling corrected via `x` |
|---|---|---|
| **local** | Tick survived — `doneList()` is a list of word *strings*, and the string had not changed. | Tick lost. |
| **cloud** | **Tick lost on the next load**, because the row was rebuilt with `done` defaulting to false. Nothing looked wrong until a reload. | Tick lost. |

**Closed in `merge_words`**, which now reads the ticks before the delete — in the same
snapshot, so it still sees rows the delete is removing — and carries them onto the incoming
words. A corrected spelling inherits the tick from the misspelling it supersedes, which
needed a third argument (`p_rename`) because a rename is by definition two different norms
and nothing joins them otherwise.

**When the capture extension lands, extend the same mechanism.** `met_sentence`, `met_url`,
`met_title`, `met_at` and `times_met` are reader-owned in exactly the same way, and that loss
would be silent and permanent. The rule the function now embodies:

```
the model owns w, f, p, d, e, a, n, i — everything else on the row is the reader's
```

Still open, and small: `loadProgress()` does not clear `done` before repopulating it, so
entries for words that no longer exist linger in memory and `paint()` can report a count
higher than the number of visible ticks.

### 6b. `mergeArray` did not de-duplicate within the batch

`add` was filtered against `kept` only, never against itself, so two objects whose `w`
normalises alike both went into the insert and violated `unique (user_id, norm)` — failing
the whole transaction. Rule 1 of the prompt forbids it, but a prompt is not a constraint.

**Closed at both ends.** `check` now de-duplicates on `norm` rather than on the raw string,
so two spellings of one word cannot reach the model together; and `mergeArray` measures the
batch against itself as well as against the book, first spelling wins. `merge_words` also
gained `on conflict do update`, which it had never had.

### 6c. `W` was mutated before the save was known to have worked

`W = kept.concat(canon)` ran before `await store.addWords(...)`. The database half had been
one transaction since `merge_words`, but memory was not: a throw left the panel reporting
that nothing had merged while `W` already believed otherwise, and the two disagreed until a
reload. **Closed** by moving the assignment after the await.

### 6d. `f` was not coerced

`ids.has(x.f)` is strict, so `"f": "1"` returned *"field 1 does not exist"* — a message that
names the field and denies it in the same breath. **Closed** with a `Number()` and an
integer check, so a string id is accepted and real rubbish is still refused.

---

## 7. Where the friction actually is

Ranked by how much they cost a real user, not by how hard they are to fix.

1. ~~**Four manual steps and a second tool.**~~ **Gone in automatic mode.** Copy, switch app,
   paste, wait, copy, switch back, paste — one press. It remains the whole cost of the loop
   for anyone with no gateway behind them, and that fallback is permanent.
2. **All-or-nothing validation.** One bad object in a reply of twenty still rejects the
   batch. The preview softens this — a word that comes back wrong is separated out rather
   than mixed in — but that only sorts a reply that parsed. A reply with one malformed
   object still merges nothing.
3. **No partial retry.** There is no "merge the nineteen that were fine". §8B.
4. **No progress during a long run.** Sixty words go to the model in three sequential chunks
   and the button says "Asking…" for all of it. At four words that is fine; at sixty it
   reads as hung. The function already returns how many chunks it sent.
5. **A bare-word backlog has no way back.** Nothing creates bare rows now, so this is
   dormant — and it wakes the moment the capture extension does. See `extension/SPEC.md` §2.

---

## 8. Enhancement options

Ordered by value per unit of work, with what each one actually touches.

### A. Enrich through the app — ~~a server-side function~~ **done**

Built. `supabase/functions/enrich` holds the key, assembles the prompt from a template in
`app_config`, enforces two ceilings, and returns text. `admin.html` configures it, and
`supabase/functions/enrich/README.md` is how it is deployed and proved.

`mergeArray` did not change, which is what it was designed for.

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
