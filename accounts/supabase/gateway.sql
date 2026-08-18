-- Marginalia — the LLM gateway
--
-- Run this once, whole, after schema.sql. Dashboard → SQL Editor → New query → paste → Run.
-- Idempotent, like schema.sql, and safe to run again after an edit.
--
-- This file is OPTIONAL. The booklet works without any of it — the manual loop is the
-- fallback and stays in the app forever. Nothing here is required to read, print, add or
-- export words. It exists only so a reader can press one button instead of carrying a
-- prompt to a chat window and carrying the reply back.
--
-- The design is `LLM-GATEWAY.md`, and the findings F1–F6 cited below are its numbering.
-- Read that before changing anything here; several of these decisions look like
-- over-caution until you know what they prevent.
--
-- The most important property of this file: FOUR OF THESE TABLES HAVE NO POLICIES AT ALL.
-- Row level security with zero policies denies everything to everyone except the service
-- role, and the service role exists only inside an Edge Function. That is deliberate and it
-- is the whole security model. Adding a policy "so the admin page can read it" would undo
-- it — the admin page reads through the function, never through PostgREST.

-- ---------------------------------------------------------------- admins
-- F1. Privilege must not live on a row its subject can write.
--
-- The obvious design is `profiles.is_admin`, and it is exploitable: the `own profile`
-- policy in schema.sql is `for all`, which includes `update`, so any reader could grant
-- themselves administrator with a single PostgREST call — and the anon key is public by
-- design, so they would not even need the app to do it.
--
-- Privilege therefore lives in its own table with no policy for `authenticated` at all.
-- Grant by hand in the SQL editor; there is no UI for it and should not be one until there
-- is a second administrator to grant it to:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com';
create table if not exists public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- deliberately no policies (F1)

-- ---------------------------------------------------------------- providers
-- A credential and how to talk to it. Separate from app_config because a provider is a
-- thing you hold an account with, while everything describing how *this app* talks to a
-- model is a property of this app's task.
--
-- `adapter` selects the request shape, not the company: 'openai' covers OpenAI, Groq,
-- Together, Mistral, DeepSeek, OpenRouter, Fireworks, vLLM, Ollama and LM Studio, because
-- they all speak the same body. 'anthropic' is the one other shape worth carrying.
--
-- The scalar defaults exist so per-app values can be nullable overrides. Unused on day one
-- and free to add now; a migration later.
create table if not exists public.providers (
  id          integer primary key generated always as identity,
  name        text not null,
  adapter     text not null default 'openai',
  endpoint    text not null,
  key_last4   text not null default '',
  temperature numeric default 0.3,
  max_tokens  integer default 4000,
  batch_size  integer default 20,
  created_at  timestamptz not null default now()
);
alter table public.providers enable row level security;
-- no policies: the function reads this, nobody else needs to

-- ---------------------------------------------------------------- provider_secrets
-- F4. A secret in a table is a secret in every backup of that table.
--
-- Row level security keeps other users out. It does not keep the key out of a database
-- dump, and a Supabase backup is not something this app can rotate. So: its own table, no
-- policies, never returned to any client. The admin page shows presence and a last-four,
-- and cannot show more because the function will not send more.
--
-- `user_id` is null today and means "the shared key". It costs nothing now and is what
-- makes "each reader brings their own key" a coalesce rather than a migration.
create table if not exists public.provider_secrets (
  provider_id integer not null references public.providers on delete cascade,
  user_id     uuid references auth.users on delete cascade,
  api_key     text not null,
  updated_at  timestamptz not null default now()
);
create unique index if not exists provider_secrets_shared_idx
  on public.provider_secrets (provider_id) where user_id is null;
create unique index if not exists provider_secrets_own_idx
  on public.provider_secrets (provider_id, user_id) where user_id is not null;
alter table public.provider_secrets enable row level security;
-- deliberately no policies (F4)

-- ---------------------------------------------------------------- app_config
-- Behaviour, per app. `app_id` is fixed to 'marginalia' here and exists anyway, because it
-- is one column and it is the difference between extracting a shared gateway later and
-- rebuilding one.
--
-- Nullable temperature/max_tokens/batch_size inherit from the provider.
--
-- `enabled` defaults FALSE. A freshly run gateway does nothing at all until an
-- administrator has set a key, chosen a model, and watched a test come back correct.
create table if not exists public.app_config (
  app_id           text primary key,
  provider_id      integer references public.providers,
  model            text not null default '',
  temperature      numeric,
  max_tokens       integer,
  batch_size       integer,
  template         text not null default '',
  template_prev    text,
  propose_template text not null default '',
  monthly_per_user integer not null default 500,
  max_per_run      integer not null default 60,
  app_budget       integer not null default 8000,
  enabled          boolean not null default false,
  tested_at        timestamptz,
  updated_at       timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- The one table here a reader may read, and only read.
--
-- The template is not a secret (LLM-GATEWAY §6.1). Keeping it readable is what lets the
-- manual "Copy prompt" button produce the exact string the function uses — which preserves
-- the most useful debugging move available: paste that prompt into a chat with a larger
-- model and find out whether the fault is the template or the model. The moment the
-- automated path grows a system message the manual copy lacks, that stops being a
-- diagnostic. Do not let them diverge.
--
-- There is no insert/update/delete policy, so a reader cannot write it. The admin page
-- writes through the function.
drop policy if exists "read config" on public.app_config;
create policy "read config" on public.app_config
  for select to authenticated
  using (true);

insert into public.app_config (app_id) values ('marginalia')
on conflict (app_id) do nothing;

-- ---------------------------------------------------------------- runs
-- Quota accounting. NOT observability.
--
-- Never store prompts, replies, or the items sent. The counts answer every question worth
-- asking, and the content would make this the largest table in the project within a month —
-- as well as putting every reader's vocabulary into a table that exists for billing.
--
-- `merged` is asserted by the client after it has written the words. It is advisory and is
-- never what quota is computed from: a client that lies about it should not be able to
-- lower its own bill.
create table if not exists public.runs (
  id         uuid primary key default gen_random_uuid(),
  app_id     text not null default 'marginalia',
  subject    uuid,
  started_at timestamptz not null default now(),
  model      text,
  requested  integer not null default 0,
  returned   integer not null default 0,
  merged     integer,
  error      text,
  ms         integer
);
create index if not exists runs_app_month_idx on public.runs (app_id, started_at);
create index if not exists runs_subject_idx   on public.runs (app_id, subject, started_at);
alter table public.runs enable row level security;
-- no policies: /me reports a reader their own count; nobody reads this table directly

-- ---------------------------------------------------------------- quota_overrides
create table if not exists public.quota_overrides (
  app_id  text not null,
  subject uuid not null references auth.users on delete cascade,
  monthly integer not null,
  primary key (app_id, subject)
);
alter table public.quota_overrides enable row level security;
-- no policies

-- ---------------------------------------------------------------- the reader's own choice
-- Whether a fetched reply merges straight into the booklet or waits to be looked at first.
-- Per reader, not the administrator's to decide: it is a question about whether you review
-- your own words before they enter your own booklet.
--
-- Default false. `LLM-GATEWAY.md` F6 explains why there is no undo — the write path
-- replaces rows rather than appending them, so deleting by run id would take words the
-- reader owned before the run. Review before the write is the answer instead, and this
-- default is that review.
alter table public.profiles
  add column if not exists auto_merge boolean not null default false;

notify pgrst, 'reload schema';
