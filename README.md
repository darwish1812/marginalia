# Marginalia

Words caught while watching, reading and playing — collected, translated and given context.
A single-page vocabulary reader, no build step and no dependencies. 150 words across eight themed fields, each with a definition,
an example sentence, an Arabic gloss, and pronunciation audio.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app. No build step, no dependencies. |
| `words.json` | **The data.** Never edit by hand — the app generates it. |
| `manifest.json`, `icon.svg` | Make "Add to Home Screen" work on iPad. |

## Putting it online

1. Create a new GitHub repository (public — GitHub Pages needs this on free accounts).
2. Upload all four files to the root.
3. **Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save.**
4. Wait a minute. Your URL will be `https://YOURNAME.github.io/REPO-NAME/`.

On the iPad, open that URL in Safari, tap Share, then **Add to Home Screen**. It launches full-screen with its own icon, and stores your progress far more durably than a normal tab.

## Adding words — the weekly loop

1. Collect English words as you meet them (Google Translate, notes app, anywhere).
2. In the booklet, tap **+ Add words** and paste the list. Any format works — commas,
   new lines, numbered. Duplicates are dropped; near-matches are flagged so you can decide.
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
- **Settings** holds the picture switch, the reading voice and the reading speed. Like the ✓
  marks, they are per-device — set them once on the iPad and once on the laptop. The voice row
  hides itself where the device offers only one English voice.
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
