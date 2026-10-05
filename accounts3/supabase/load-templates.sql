update public.app_config set
  template = 'Add these to my vocabulary booklet. Return ONLY a raw JSON array — no prose, no markdown fences.

Words:
{{WORDS}}

Fields — choose by the sense the word carries, not its topic:
{{FIELDS}}

Where two fields fit, prefer the one matching the register a reader would meet the word in over the one matching its subject.

Rules:
1. One object per word above, in the same order. Never two objects with the same "w". If a word has two strong senses, take the one likelier in serious reading and mention the other in "n".
2. "w" = base form (infinitive verb, singular noun), lowercase unless strictly a proper noun. Correct obvious misspellings. If your "w" differs from what I typed, add "x" holding the exact string I typed; otherwise leave "x" out.
3. "f" = unquoted integer, one of the ids above — or null if none of them genuinely fits. Never force a word into the closest field: a word left unfiled is honest and easy to file later, a word filed wrongly is neither.
4. "p" = one of: noun, verb, adjective, adverb, phrase — or a slashed pair like "noun / verb" when both are common.
5. "d" = exactly one plain-English sentence that does not restate the word inside itself.
6. "e" = one natural, concrete sentence of 10-20 words in the register of the chosen field, wrapping the inflected target word in a single pair of *asterisks*. It has to demonstrate the sense given in "d".
7. "a" = Modern Standard Arabic for that specific sense, with diacritics on the head word. Keep it short; add " — " and a brief clarifier only where the bare gloss is ambiguous.
8. "n" = a short warning only where one is earned: archaic or offensive register, a stress or spelling trap, a false friend, or a near-synonym worth distinguishing. Otherwise null — most words get null.
9. Plain text in "w", "d", "e", "a" and "n". No angle brackets, no ampersands, no HTML entities there: write "and", not "&".
10. "s" = a drawing, for any word naming something that could be photographed — a radish, a tankard, a loom, a wound, a ledger. Abstractions get none: there is no drawing of magnanimity or of nuance, and a vague shape is worse than none. Otherwise lean towards drawing. A drawing that arrives malformed is discarded on the way in and costs the word nothing, so attempting one carries no risk.
    Write a flat SVG and put every attribute value in single quotes — viewBox=''0 0 600 400'', stroke=''#8b0000'', fill=''none'' — since it travels inside a JSON string, where double quotes would each need escaping. Finish with a closing </svg>. This is the shape of a valid value, not a template to copy:
    <svg viewBox=''0 0 600 400''><circle cx=''300'' cy=''200'' r=''120'' fill=''none'' stroke=''#7a4b2a'' stroke-width=''14''/></svg>
    The subject fills most of the frame and touches no edge. No background rectangle — the card supplies the paper. Three colours at most, dark outlines, thick strokes, no text, no <style> blocks, presentation attributes only, under 1800 characters.

Schema: {"w":…, "x":…, "f":…, "p":…, "d":…, "e":…, "a":…, "n":…, "s":…}
Straight quotes only, valid JSON, nothing before or after the array.',
  propose_template = 'These are the first words in a new vocabulary booklet, which has no fields yet. Return ONLY a raw JSON object — no prose, no markdown fences.

Words:
{{WORDS}}

First propose the fields. At most 8, and fewer is better than padding to the limit. Judge them by the register and sense these words carry, not by their topic — a field should be somewhere a reader would recognise meeting a word, not a subject heading. Each needs:
  "id"   = a small integer, 1 upwards
  "name" = two or three words, the way a chapter is named
  "note" = one sentence saying what belongs there. Write it carefully: it is the only thing that tells anyone, later, where a new word should go.

Then file every word above into one of them, or into null where none genuinely fits.

Return: {"fields":[{"id":…,"name":…,"note":…}], "words":[ … ]}

Each object in "words" follows these rules:
1. One object per word above, in the same order. Never two objects with the same "w". If a word has two strong senses, take the one likelier in serious reading and mention the other in "n".
2. "w" = base form (infinitive verb, singular noun), lowercase unless strictly a proper noun. Correct obvious misspellings. If your "w" differs from what I typed, add "x" holding the exact string I typed; otherwise leave "x" out.
3. "f" = unquoted integer, one of the ids you just proposed — or null if none of them genuinely fits.
4. "p" = one of: noun, verb, adjective, adverb, phrase — or a slashed pair like "noun / verb" when both are common.
5. "d" = exactly one plain-English sentence that does not restate the word inside itself.
6. "e" = one natural, concrete sentence of 10-20 words in the register of the chosen field, wrapping the inflected target word in a single pair of *asterisks*. It has to demonstrate the sense given in "d".
7. "a" = Modern Standard Arabic for that specific sense, with diacritics on the head word. Keep it short; add " — " and a brief clarifier only where the bare gloss is ambiguous.
8. "n" = a short warning only where one is earned: archaic or offensive register, a stress or spelling trap, a false friend, or a near-synonym worth distinguishing. Otherwise null — most words get null.
9. Plain text in "w", "d", "e", "a" and "n". No angle brackets, no ampersands, no HTML entities there: write "and", not "&". Field names and notes are ordinary prose and may use "&" freely.

Straight quotes only, valid JSON, nothing before or after the object.',
  updated_at = now()
where app_id = 'marginalia';

notify pgrst, 'reload schema';
