# speak — OpenAI text-to-speech through the gateway

`POST /speak` with `{text, voice}` and a reader Bearer token; MP3 bytes back.
`GET` nothing; anything else is 404.

## Deploy

```bash
supabase functions deploy speak
```

Needs, like `enrich`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
function's environment, plus both migrations run once in the SQL editor:
`tts-voice.sql` for the `tts_` columns on `app_config` and the `tts_log` table,
and `gateway.sql` for `app_capabilities` and `providers.voice_model`.

`gateway.sql` also retires two of the columns `tts-voice.sql` created —
`tts_provider_id` and `tts_model` — so run them in that order on a fresh
project. The four that remain (`tts_enabled`, `tts_voice`, `tts_instructions`,
`tts_tested_at`) are this function's own and are read on every call.

## Prove it

Without a reader session there is nothing to prove it with from here — sign in
as the administrator, open `admin.html`, set the Voice engine to OpenAI, and
press **Test voice**. Hearing *fealty* means the key, the endpoint, the voice
and the log row all worked. That press also marks the voice tested, which is
what offers it to readers.

## Which provider speaks

The one holding the **Voice** column in the console — the `speech` row of
`app_capabilities` — and no other. There used to be a fallback to whichever
provider was doing the words, which walked a key towards Anthropic (no
`/audio/speech` to call) and meant nobody could tell by looking which provider
was about to be charged. The model is that provider's `voice_model`.

## Refusals worth checking

- Unsigned in → 401. Voice switch off, or never tested → 409.
- No provider holds the voice, the one that does is not an OpenAI shape, has no
  `voice_model`, or has no key → 502 naming which of the four it was.
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
