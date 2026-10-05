# speak — OpenAI text-to-speech through the gateway

`POST /speak` with `{text, voice}` and a reader Bearer token; MP3 bytes back.
`GET` nothing; anything else is 404.

## Deploy

```bash
supabase functions deploy speak
```

Needs, like `enrich`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
function's environment, plus the `tts-voice.sql` migration run once in the SQL
editor (columns on `app_config`, the `tts_log` table).

## Prove it

Without a reader session there is nothing to prove it with from here — sign in
as the administrator, open `admin.html`, set the Voice engine to OpenAI, and
press **Test voice**. Hearing *fealty* means the key, the endpoint, the voice
and the log row all worked. That press also marks the voice tested, which is
what offers it to readers.

## Refusals worth checking

- Unsigned in → 401. Voice switch off, or never tested → 409. No OpenAI key
  behind the named-or-in-use provider → 409 that says so.
- Text outside 1–2000 characters, or outside letters, marks, digits and
  sentence punctuation → 400. A 2000-character ceiling is generosity and a
  spending cap in one number.
- Voice outside the thirteen OpenAI names → 400. The list is fixed in the
  function so a typo can never reach the key.
- Upstream failure → 502 with the reason, and the reader's app falls back to
  the device voice without saying anything. A failed call still writes its
  `tts_log` row, marked with the error.
- No quota is enforced — the reader chose none. Every call is logged with its
  character count for the day one is wanted.
