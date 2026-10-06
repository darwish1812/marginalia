-- Marginalia — spoken words (OpenAI TTS through the gateway)
--
-- Run this once, whole, after gateway.sql. Dashboard → SQL Editor → New query → paste → Run.
-- Idempotent, like gateway.sql, and safe to run again after an edit.
--
-- Three columns on app_config and one log table. No quotas are enforced — the reader
-- chose none — but every synthesis is written down with its character count, so the
-- day a quota is wanted there is history to bill against instead of a guess.
--
-- The log table has no policies at all, like every other gateway table: row level
-- security with zero policies denies everything to everyone except the service role,
-- which exists only inside an Edge Function. The admin page reads through the
-- function, never through PostgREST.

alter table public.app_config
  add column if not exists tts_enabled boolean not null default false;
alter table public.app_config
  add column if not exists tts_voice text not null default 'nova';
alter table public.app_config
  add column if not exists tts_model text not null default 'gpt-4o-mini-tts';
alter table public.app_config
  add column if not exists tts_provider_id integer;
alter table public.app_config
  add column if not exists tts_tested_at timestamptz;

-- One row per synthesis: who, how much, in which voice, and whether it worked.
create table if not exists public.tts_log (
  id         bigint generated always as identity primary key,
  app_id     text not null default 'marginalia',
  subject    uuid not null references auth.users on delete cascade,
  chars      integer not null default 0,
  voice      text not null default '',
  error      text,
  started_at timestamptz not null default now()
);
alter table public.tts_log enable row level security;
-- deliberately no policies (see above)

-- ---------------------------------------------------------------- voice instructions
-- How the voice delivers, sent as `instructions` with every synthesis. A single
-- global string, edited in the gateway console's Voice block. Only honoured by
-- the gpt-4o-mini-tts family — a tts-1 model answers with an error instead, and
-- the Test voice button is how that is found before any reader hears it.
--
-- Cedar is the default voice: a calm adult read, and the one the instructions
-- were written for. Saved voices are left alone — only new rows inherit it.
alter table public.app_config
  add column if not exists tts_instructions text not null default '';

update public.app_config
  set tts_instructions = $$You are a clear, patient English language teacher helping an adult learner build vocabulary. Speak naturally and conversationally, with excellent pronunciation and moderate pacing. When saying the vocabulary word, articulate it clearly and slightly deliberately without exaggerating individual syllables. When reading the example sentence, use natural conversational English and normal intonation. Do not sound theatrical, overly enthusiastic, childish, robotic, or excessively slow. Use subtle pauses between the vocabulary word, meaning, and example sentence. Prioritize natural pronunciation, clarity, and listening comfort.$$
  where tts_instructions = '';

alter table public.app_config alter column tts_voice set default 'cedar';

notify pgrst, 'reload schema';
