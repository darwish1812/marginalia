-- Marginalia — database schema
--
-- Run this once, whole, in your Supabase project: Dashboard → SQL Editor → New query
-- → paste → Run. It is idempotent, so running it again after an edit is safe.
--
-- Every table here is reachable from the browser with the anon key, which is public and
-- printed in index.html. That is by design: the key identifies the project, not the
-- person. Row level security is the only thing keeping one reader out of another's
-- words, which is why RLS is enabled in the same statement that creates each table and
-- never left for later.

-- ---------------------------------------------------------------- profiles
-- One row per account. Exists for a single question: has this account been stocked with
-- the starter words yet? Without it, an account whose words were all deleted would be
-- re-seeded on the next sign-in and the deletions would undo themselves.
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  seeded_at  timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------- words
-- The card, one row apiece. Column names are the app's own single letters rather than
-- prose: they match the JSON the model returns and the keys render() reads, so a row
-- travels from Postgres to a card without being translated on the way.
--
--   w  the word            f  field id (matches fields[] in words.json)
--   p  part of speech      d  definition
--   e  example sentence    a  the Arabic
--   n  a caution, or null  i  a picture: img/… path, or a data: URI
--
-- `norm` is the app's norm(w) — lowercased, stripped of everything but letters, spaces
-- and hyphens. It is what "already have this word" means everywhere in the app, so it
-- carries the uniqueness rather than `w` doing it.
create table if not exists public.words (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  w          text not null,
  norm       text not null,
  f          integer not null,
  p          text,
  d          text,
  e          text,
  a          text,
  n          text,
  i          text,
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, norm)
);

alter table public.words enable row level security;

drop policy if exists "own words" on public.words;
create policy "own words" on public.words
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Every read the app makes is "my words", so the index matches that exactly. The unique
-- constraint above already indexes (user_id, norm), which is what the seeding upsert
-- collides against.
create index if not exists words_user_created_idx
  on public.words (user_id, created_at);

-- ---------------------------------------------------------------- corrections
-- The misspellings table: what you typed, what it should have been. `hint` is written by
-- hand and is the one field allowed to carry markup, so the app renders it raw and
-- escapes the other two.
create table if not exists public.corrections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  wrong      text not null,
  norm_wrong text not null,
  "right"    text not null,          -- quoted: RIGHT is a reserved word in SQL
  hint       text,
  created_at timestamptz not null default now(),
  unique (user_id, norm_wrong)
);

alter table public.corrections enable row level security;

drop policy if exists "own corrections" on public.corrections;
create policy "own corrections" on public.corrections
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- new accounts
-- A profile row the moment an account exists, so the app never has to decide whether a
-- missing profile means "new" or "something went wrong mid-signup". Seeding the words
-- themselves stays in the client: they come from words.json, which the browser has
-- already fetched and the database has never seen.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
