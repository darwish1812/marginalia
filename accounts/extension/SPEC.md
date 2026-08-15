# Marginalia Capture — a Chrome extension

A capture device for the booklet. Highlight a word anywhere on the web, press one key, and
it is in your account before you have finished the paragraph.

This is the specification, written before the code. `../ARCHITECTURE.md` describes the
booklet it feeds.

---

## 1. What it is, and what it is not

The extension does **one** thing: it gets a word, and the sentence you met it in, into your
Marginalia account. That is the whole job.

It is **not** a second booklet. No cards, no reading, no search, no study mode, no fields
editor, no enrichment. Every one of those already exists in the web app and would be worse
in a 360px popup. The popup reports — who you are, how big the backlog is, what you caught
recently — and hands you a link back to the real thing.

The reason to be strict about this: the extension has to survive Chrome's periodic breakage
of everything, and the smaller it is, the cheaper that is. Every feature added here is a
feature maintained twice.

### The one capability that justifies it

Convenience alone would not — you can already paste a list into step 1. What an extension
can do that the web app structurally cannot is capture **the sentence you actually met the
word in**, and where.

The cover of the booklet says it: *"Read the definition, then read the sentence: the
sentence is where the word actually works."* Today that sentence is invented by a model.
The extension supplies the real one, which is both a better memory hook and — see §8 — a
way to make enrichment itself more accurate.

---

## 2. The life of a captured word

| State | What is true of the row | What the reader sees |
|---|---|---|
| **Sighted** | nothing yet | Highlight, `Alt+M` |
| **Captured** | `w`, `norm`, `f: null`, `d: ''`, `met_*` | In **Waiting for detail** at the top of the booklet, searchable at once, on every device |
| **Queued** | unchanged | *Queue the N waiting* sweeps it into a prompt with the others |
| **Enriched** | gains `d`, `e`, `a`, `f`; keeps `met_*` | Moves to its field; the sighting stays on the card |
| **Learned** | `done: true` | Ticked |

Capturing a word already in the booklet is a separate, shorter path: nothing is inserted,
`times_met` is bumped, and the toast reports where the word already lives.

**Nothing in the booklet needs inventing for this.** A captured word is exactly the shape
that *Add as needs-detail now* already produces — bare, unfiled, waiting — and the whole
downstream path already exists.

---

## 3. Layout

```
extension/
  manifest.json
  background.js        service worker: auth, all writes, the capture queue
  content.js           injected on demand: reads the selection, draws the toast
  content.css          the toast's styles, namespaced hard (see §6)
  popup.html/.js       sign in, backlog count, recent captures
  lib/
    supabase.js        the vendored client (no CDN in an extension)
    shared.js          norm(), the row shape — imported by BOTH codebases (§9)
```

### Permissions

```json
{
  "manifest_version": 3,
  "permissions": ["activeTab", "storage", "contextMenus", "scripting"],
  "host_permissions": ["https://YOURPROJECT.supabase.co/*"],
  "commands": {
    "capture": {
      "suggested_key": { "default": "Alt+M" },
      "description": "Add the highlighted word to Marginalia"
    }
  }
}
```

**No `<all_urls>`, and no declared content scripts.** `activeTab` is granted on a user
gesture — a `commands` shortcut, a context-menu click — and `chrome.scripting.executeScript`
injects only then, only into that tab. The extension therefore has no standing access to any
page you visit.

That is worth the small extra work twice over: it is the honest design, and it is the
difference between a store review that asks what you are doing with everyone's browsing
history and one that does not.

---

## 4. Signing in

The extension runs its own supabase-js client against the same project and the same anon
key. It needs no new backend, no new policies and no new trust: row level security is what
separates one reader's words from another's, and it applies to a request from an extension
exactly as it applies to a request from the page.

Sessions live in `chrome.storage.local` through a custom adapter:

```js
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: {
      getItem:    k => chrome.storage.local.get(k).then(r => r[k] ?? null),
      setItem:    (k, v) => chrome.storage.local.set({ [k]: v }),
      removeItem: k => chrome.storage.local.remove(k)
    },
    persistSession: true,
    autoRefreshToken: false      // see below — the timer cannot be trusted here
  }
});
```

### The MV3 trap

A service worker is killed after roughly thirty seconds of inactivity. Any timer
`autoRefreshToken` sets dies with it, so a token that looks fine when you sign in is expired
and unrefreshed by the time you capture something an hour later.

So: **refresh on demand, at the top of every capture**, and treat "expired" as an ordinary
branch rather than an error.

```js
async function session() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const expiresIn = session.expires_at * 1000 - Date.now();
  if (expiresIn > 60_000) return session;
  const { data, error } = await sb.auth.refreshSession();
  return error ? null : data.session;
}
```

Signing in happens in the popup, with the same email-and-password form the gate uses. OAuth
can come later via `chrome.identity.launchWebAuthFlow`; it is not needed for v1.

---

## 5. Capture, step by step

1. **Gesture.** `chrome.commands` fires, or the context menu item is clicked.
2. **Inject.** `chrome.scripting.executeScript` runs `content.js` in the active tab.
3. **Read.** The content script takes `window.getSelection()`, and walks up to the nearest
   block ancestor to extract the *sentence* containing it (§6).
4. **Send.** `{ text, sentence, url, title }` goes to the service worker.
5. **Authenticate.** `session()` as above. No session → toast invites sign-in, opens the
   popup, and the capture is queued (§7).
6. **Look it up.** `select w, f, done from words where norm = ?`. One round trip; the
   extension never mirrors the booklet.
7. **Branch.**
   - **Known** → `update words set times_met = times_met + 1 where norm = ?`. Toast reports
     the field and whether it is learned.
   - **New** → insert. Toast confirms, offers Undo.
8. **Toast.** Drawn by the content script, bottom-right, never stealing focus. You are
   mid-paragraph; you should not have to look away.

### The insert

```js
{
  w: text.trim(),
  norm: norm(text),           // the shared one — §9
  f: null,                    // unfiled: the model decides at enrichment
  p: '', d: '', e: '', a: '', // bare, so it lands in Waiting for detail
  met_sentence: sentence,
  met_url: url,
  met_title: title,
  met_at: new Date().toISOString()
}
```

`user_id` defaults to `auth.uid()` in the table, so it is never sent and cannot be spoofed.

### Undo

For eight seconds the toast offers Undo, which deletes the row by `norm`. After that it is
an ordinary word and the booklet's own `⋯ → Remove this word` is the way out. Undo is worth
having because a misfired selection is the most likely mistake, and it is much cheaper to
offer than to explain.

---

## 6. What counts as a word

Two guards, both in the content script, both before anything reaches the network.

**Too long is not a word.** Reject a selection over ~40 characters or 5 words with a toast
saying so — a highlighted paragraph is a misfire, and inserting it as a headword makes a
mess that has to be cleaned up by hand. Phrases stay legitimate (`ad hominem`, `beg the
question`), so this cannot be a one-word rule.

**Empty or punctuation-only** is silently ignored — no toast. A stray shortcut press should
cost nothing.

Everything else goes through untouched. **No stemming, no lemmatising, no cleverness in the
extension**: rule 2 of the enrichment prompt already says *"`w` = base form (infinitive verb,
singular noun) … correct obvious misspellings"*, so a captured `running` becomes `run` at
enrichment. Doing it twice, differently, in two languages, is how the two halves drift apart.

### Extracting the sentence

From the selection's `anchorNode`, walk up to the nearest block-level ancestor, take its
`innerText`, and cut the sentence containing the selection on `.`, `?`, `!`, `—` and line
breaks. Cap it at ~300 characters, keeping the selection centred if it must be trimmed.

This will occasionally get it wrong on a badly structured page. **That is why the toast
shows the sentence it caught** — a wrong grab is visible immediately and undoable, rather
than being discovered months later on a card.

### The toast must not fight the page

It is injected into a document with unknown CSS. Namespace every class (`.mgn-cap-*`), set
the properties that matter explicitly rather than inheriting, and use a high `z-index`. Do
**not** use a shadow root unless the styling proves troublesome — it complicates the undo
click handling for no certain gain.

---

## 7. When capture fails

Capture happens while reading, often on a train. Failure has to be ordinary.

Anything that cannot be sent — offline, expired session, database asleep — goes into a
queue in `chrome.storage.local` and the toast says *"caught, not yet saved."* The queue is
drained on the next successful capture, on browser start, and when the popup opens.

Two rules for the queue. **De-duplicate on `norm` before sending**, or ten offline captures
of the same word become ten insert failures against the unique index. And **cap it** — a
few hundred entries, dropping oldest — so a long-broken configuration cannot fill the
extension's storage quota.

---

## 8. What the booklet has to change

Three changes, all small, all in `accounts/`.

### 8a. The columns

```sql
alter table public.words
  add column if not exists met_sentence text,
  add column if not exists met_url      text,
  add column if not exists met_title    text,
  add column if not exists met_at       timestamptz,
  add column if not exists times_met    integer not null default 1;
```

RLS already covers them; the existing `own words` policy needs no change.

### 8b. The merge must stop destroying them — this is the important one

`mergeArray` does not update a word on enrichment. It deletes the row and inserts a new one
built from the model's reply, and that reply contains no `met_*`. **The first enrichment
would silently destroy the best thing the extension captured**, and you would not find out
until you went looking for a word's source and it was gone.

Pictures already survive this, by explicit carry-across. Rather than adding a second special
case, generalise it — the real rule is that *some columns belong to the model and the rest
belong to the reader*:

```js
// The model owns w, f, p, d, e, a, n, i. Everything else on the row is the reader's,
// and a merge must carry it across rather than write over it.
const MINE = ['done', 'met_sentence', 'met_url', 'met_title', 'met_at', 'times_met'];
```

This also fixes, in the same stroke, the ✓ mark that is currently lost whenever a word is
re-enriched or has its spelling corrected.

### 8c. The card shows the sighting

Under the example sentence, a dashed rule and a short block: *Where you met it*, the
sentence, then the page title and host as a link, and the date. Hidden when `met_sentence`
is null, so nothing changes for words added by hand.

---

## 9. The shared `norm()`

`norm()` is the uniqueness key — `unique (user_id, norm)` — and it is about to have a second
writer. If the two implementations ever disagree by a character, you get duplicate rows and
false "already yours" reports, and the bug will be nearly invisible.

So `norm`, `stem` and the word shape move into `lib/shared.js`, imported by both the
extension and `accounts/index.html`. The booklet is a classic script, so either it gains a
`type="module"` entry or `shared.js` is written to work as both. This is the refactor
flagged in the original review; the extension is what makes it non-optional.

---

## 10. The prompt gains the sighting

With a real sentence, the model does not have to guess which sense you meant. Rule 1
currently says *"if a word has two strong senses, take the one likelier in serious
reading"* — pure guesswork that the sighting removes.

```
Words:
- evaporate
    met in: "…the balance did not so much collapse as evaporate — and every
             arrangement that had depended on him went with it."
- emollient
- interregnum
    met in: "The interregnum lasted four months and nobody governed at all."
```

And one rule added:

> 11. Where a word is given with a sentence I met it in, take the sense from that sentence,
>     and make `e` demonstrate the same sense. The sentence is context, not a model to copy:
>     still write your own example.

So capture does not merely decorate the card — it makes enrichment measurably better, using
data you already have. `buildPrompt()` is the only function that changes.

---

## 11. Build order

1. **The booklet changes first** (§8), especially 8b. Capturing into a booklet that eats the
   metadata would mean re-capturing everything later.
2. **`lib/shared.js`** (§9), and point the booklet at it.
3. **Extension skeleton**: manifest, popup, sign-in, `session()`. No capture yet — prove the
   auth survives a service-worker restart before building on it.
4. **Capture, new words only.** Shortcut, injection, selection, insert, toast.
5. **The known-word branch**, the queue, Undo.
6. **The prompt change** (§10), once there are real sightings to feed it.

---

## 12. Out of scope, deliberately

- **Enrichment in the extension.** It would need an API key, and an extension bundle is
  trivially unpacked — the key would be public the day it shipped. Enrichment belongs behind
  an Edge Function that the booklet calls.
- **Mirroring the booklet into `chrome.storage`.** One query on `norm` per capture is
  cheaper, always right, and avoids inventing a sync problem.
- **A reader in the popup.** See §1.
- **Firefox and Safari.** MV3 mostly travels; find out whether anyone uses this first.
- **Realtime.** A booklet open in another tab will not see a capture until it reloads.
  Supabase realtime would fix it in a few lines — wait until that actually annoys somebody.
- **A `sightings` table.** One word met in four places is genuinely interesting, and
  `times_met` on the row is enough until it is not.

---

## 13. The risk worth naming

**Frictionless capture creates a backlog that manual enrichment cannot drain.**

Capture is slow today, which keeps the two halves of the loop balanced. Make it one
keystroke and there will be two hundred bare words within a fortnight — while enrichment is
still copy the prompt, paste into a chat, paste the reply back, by hand, in batches.

At that point *Waiting for detail* stops being an inbox and becomes a pile nobody opens,
which is the failure that kills homegrown vocabulary systems.

The mitigation is not to make capture worse. It is to build the Edge Function enrichment
alongside this, not after it. It was already next on the roadmap and `mergeArray` was
explicitly written to accept an array from anywhere; the extension is what makes it urgent.
