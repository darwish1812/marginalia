# Marginalia

Words caught while watching, reading and playing — collected, translated and given context.
A single-page vocabulary reader, no build step and no dependencies. 150 words across eight themed fields, each with a definition,
an example sentence, an Arabic gloss, and pronunciation audio.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app. No build step, no dependencies. |
| `words.json` | **The data.** Never edit by hand — the app generates it. |
| `img/` | Optional pictures for the few words that can have one. |
| `manifest.json`, `icon.svg` | Make "Add to Home Screen" work on iPad. |

## Putting it online

1. Create a new GitHub repository (public — GitHub Pages needs this on free accounts).
2. Upload all four files to the root.
3. **Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save.**
4. Wait a minute. Your URL will be `https://YOURNAME.github.io/REPO-NAME/`.

On the iPad, open that URL in Safari, tap Share, then **Add to Home Screen**. It launches full-screen with its own icon, and stores your progress far more durably than a normal tab.

## Adding words — the weekly loop

1. Collect English words as you meet them (Google Translate, notes app, anywhere).
2. In the booklet, tap **Settings → + Add words** and paste the list, then tap **Check list**.
   Any format works — commas, new lines, numbered. Duplicates are dropped; near-matches are
   flagged so you can decide. Steps 2 and 3 stay greyed out until this list is checked.
3. Tap **Copy prompt**, paste it into a Claude chat, and copy the JSON reply.
4. Paste that into step 3 and tap **Validate & merge**. Bad input is rejected without
   changing anything.
5. Tap **Download words.json**, then on GitHub open `words.json` → pencil icon →
   select all → paste → Commit.

Step 5 is what makes new words permanent and visible on your other devices. Until you do it,
they live only in that browser — the panel tells you how many are waiting.

If you don't want to enrich immediately, tap **Add as needs-detail now**. The words appear
as cards straight away in a "Waiting for detail" section at the top, searchable but bare.
Enrich them later and they move to their proper field.

To come back to them, open the panel and tap **Queue the N waiting** — it loads every bare
word into a fresh prompt. Typing them into step 1 again works too: words that are still
waiting for detail are offered again rather than dismissed as duplicates.

## Notes

- **Progress is per-device.** The ✓ marks live in that browser only. Use **Export progress**
  before clearing Safari data.
- **Settings** — the ⚙ button at the end of the bar, set apart from the view toggles — holds
  add-words, the picture switch, the reading voice and the reading speed. It drops from the
  bar over wherever you are reading, so it never sends you back to the top; Escape or a tap
  outside closes it. Like the ✓ marks, the preferences are per-device — set them once on the
  iPad and once on the laptop. The voice row hides itself where the device offers only one
  English voice.
- **Audio** uses your device's built-in speech engine, so voices differ between iPad and
  laptop. Rare words are occasionally mispronounced — verify anything that sounds odd.
- **Printing** (Ctrl/Cmd+P) reflows into a two-column paper booklet, one field per page.
  Whatever language mode is on prints with it.
- **Offline**: the last successfully loaded word list is cached, so the app opens without
  internet. Adding words offline works; only the GitHub upload needs a connection.

## Data shape

```json
{
  "schema": 1,
  "updated": "2026-08-11",
  "fields": [{ "id": 1, "name": "The Feudal World", "ink": "var(--ink-1)", "note": "…" }],
  "words": [{
    "w": "fealty",
    "f": 1,
    "p": "noun",
    "d": "A sworn oath of loyalty, especially from a vassal to a lord.",
    "e": "The knight knelt and pledged *fealty* to the new king.",
    "a": "ولاء مقسم عليه",
    "n": "optional usage warning"
  }]
}
```

Asterisks in `e` mark the target word for highlighting. `f` must match a field `id`.
`n` is optional. `schema` is there so future versions can migrate old files.

## Pictures

A word may carry `"i"`, a relative path to an image: `{ "w": "loom", "i": "img/loom.png" }`.

It sits in the bottom-right corner of the card as a faint watermark, behind the text and
outside the layout, so a card with a picture is exactly as tall as one without and the grid
row never stretches to accommodate it. It belongs to the revealed part of the card, so study
mode still asks you to recall the meaning first. Printing leaves images out, and **Settings →
Pictures** turns them off for good — the cards do not move either way.

The blend is `multiply`, not plain transparency: the light parts of the picture disappear into
the paper and only the subject's ink stays, so it reads as printed into the card rather than
pasted on top of it.

Keep it to words you could point at — `radish`, `tavern`, `apothecary`, `coffers`.
For `fealty`, `nuance` or `penury` a picture illustrates a scene rather than the meaning,
and you end up remembering the scene. Perhaps fifteen or twenty words here deserve one.

### Where the picture comes from

Two ways, and `i` ends up holding a different kind of string in each.

**Drawn by the reply.** The prompt asks for `"s"` — a small flat SVG — but only for words
naming something you could photograph. Merging converts it to a `data:` URI and stores that
in `i`. The model never supplies a *link*: ask for image URLs and you get plausible-looking
ones that mostly 404, each needing to be opened to find out. A drawing can be judged on sight.

That SVG is markup typed by a model and pasted through a chat window, so it is never written
into the card's HTML. It becomes the `src` of an `<img>`, where a browser will not run script
even if the markup carries some. On top of that, merging strips `<script>`, `on*` handlers,
`href`s and external references, requires a `viewBox`, and rejects anything over ~2.6 KB.
A drawing that fails any of this is dropped and the word simply keeps no picture — the merge
still goes through, and the message says how many were discarded.

**Committed by hand.** Put a file in `img/` and point `i` at it: `"i": "img/loom.png"`.
Better for anything you will reuse or edit — the diff stays readable and the browser caches it.

This is the one case where editing `words.json` by hand is fine, despite the rule above. The
hazard is real but narrow: the app rewrites the whole file on download, so if you hand-edit on
GitHub and then download from a browser holding a stale cached copy, your edits are gone.
**After any hand-edit, load the app online once before you download again.** Everything else
preserves `i` — re-enriching a word keeps its picture, including across a spelling correction.

**The subject has to be cut out.** A photograph with its own background shows up as a
translucent rectangle in the corner, which looks like a mistake. What works is a subject on
white or on nothing: a transparent PNG, or an SVG drawing. This narrows where the pictures
can come from — a stock photo of a loom is no use, an illustration of one is.

`img/` currently holds ten drawings: `radish`, `rodent`, `holdfast`, `porridge`, `coffers`,
`apothecary`, `jade`, `incense`, `tavern`, `seamstress`. They share one style — dark outline,
thick strokes, two or three flat colours — because ten pictures in ten styles look like a
jumble rather than a set. Match it, or replace the lot.

Roughly 400–600px wide, under about 60 KB; the card never draws it wider than 200px, so
anything larger is waste, and every visitor downloads what you commit. A missing file removes
itself from the card rather than leaving a broken icon — which is also what happens offline,
since only `words.json` is cached.

A `corrections` array holds the misspelling table shown at the end of the booklet:

```json
"corrections": [
  { "wrong": "brazon", "right": "brazen", "hint": "rhymes with <i>raisin</i>" }
]
```

It grows as new misspellings turn up, and the section hides itself when the array is empty.

Most of it fills itself. The prompt asks for an `"x"` key holding the word as you originally
typed it whenever the corrected spelling differs; merging records that as a `wrong` / `right`
pair, retires the card filed under the wrong spelling, and drops the key so `x` never reaches
`words.json`. The `hint` column stays hand-written — add those yourself when a word deserves one.

## Opening it locally

Double-clicking `index.html` will **not** work — browsers block `file://` pages from reading
`words.json`. The app will tell you this if it happens. To preview locally, run
`python3 -m http.server` in this folder and open `localhost:8000`.
