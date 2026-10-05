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
--   w  the word            f  field id, or null for unfiled
--   p  part of speech      d  definition
--   e  example sentence    a  the Arabic
--   n  a caution, or null  i  a picture: img/… path, or a data: URI
--
-- `f` is nullable on purpose. A word with no field is a normal thing to own: it was
-- captured before there were any fields, or the model was asked to choose and honestly
-- could not. The app gathers those under "Unfiled" and lets them sit there as long as
-- they like. Forcing a field would only mean filing words wrongly and calling it done.
--
-- `norm` is the app's norm(w) — lowercased, stripped of everything but letters, spaces
-- and hyphens. It is what "already have this word" means everywhere in the app, so it
-- carries the uniqueness rather than `w` doing it.
create table if not exists public.words (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  w          text not null,
  norm       text not null,
  f          integer,
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

-- `create table if not exists` leaves a table that already exists exactly as it was, so
-- a column that changed after the first run has to be stated again here or the change
-- never reaches a database made before it. Running this on a new database does nothing:
-- the column is already nullable.
alter table public.words alter column f drop not null;

-- ---------------------------------------------------------------- fields
-- The eight inks down the side of the page, and the one table that took longest to
-- arrive. Words went per-account when accounts did; the taxonomy did not, so everybody
-- read their own words filed under one person's categories. A booklet about medicine or
-- contracts had nowhere to put anything, and the two vaguest fields became junk drawers.
--
-- `id` is small and per-account rather than a uuid, because it is what `words.f` holds and
-- what the enrichment prompt prints as a menu for the model to choose from. It means
-- nothing outside one account.
--
-- `ink` is a real colour now, not "var(--ink-1)". A field the reader made has no stylesheet
-- variable waiting for it, and the app offers the same eight inks as a fixed palette —
-- picking from a palette keeps the booklet looking like itself.
create table if not exists public.fields (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  id         integer not null,
  name       text not null,
  ink        text not null,
  note       text not null default '',
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.fields enable row level security;

drop policy if exists "own fields" on public.fields;
create policy "own fields" on public.fields
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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

-- ---------------------------------------------------------------- writes that must
--                                                                  happen all at once
-- Everything above is one statement at a time, which PostgREST does perfectly well. The
-- three below are not: each is several statements that are only correct together, and a
-- browser that loses its connection between them leaves an account in a state no screen
-- describes. A plpgsql function body is one transaction, so either all of it lands or
-- none of it does.
--
-- All three are security invoker (the default, stated because it matters): they run as
-- the caller, so row level security applies to them exactly as it applies to the app.
-- A function is not a way around the policies, only a way to be atomic inside them.

-- Stocking a new account: fields, words, corrections, then the stamp that says it is
-- done. Guarded by profiles.seeded_at rather than by "are there any words yet", so an
-- account emptied on purpose stays empty. Every insert ignores conflicts, so a seed
-- interrupted halfway is simply completed by the next sign-in.
create or replace function public.seed_account(p_fields jsonb, p_words jsonb, p_corrections jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  already timestamptz;
begin
  if uid is null then raise exception 'seed_account: nobody is signed in'; end if;

  insert into public.profiles (id) values (uid) on conflict (id) do nothing;
  select seeded_at into already from public.profiles where id = uid;
  if already is not null then return; end if;

  insert into public.fields (user_id, id, name, ink, note, sort)
  select uid, f.id, f.name, f.ink, coalesce(f.note, ''), coalesce(f.sort, f.id)
    from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb))
      as f(id integer, name text, ink text, note text, sort integer)
  on conflict (user_id, id) do nothing;

  insert into public.words (user_id, w, norm, f, p, d, e, a, n, i)
  select uid, x.w, x.norm, x.f, x.p, x.d, x.e, x.a, x.n, x.i
    from jsonb_to_recordset(coalesce(p_words, '[]'::jsonb))
      as x(w text, norm text, f integer, p text, d text, e text, a text, n text, i text)
  on conflict (user_id, norm) do nothing;

  insert into public.corrections (user_id, wrong, norm_wrong, "right", hint)
  select uid, c.wrong, c.norm_wrong, c."right", c.hint
    from jsonb_to_recordset(coalesce(p_corrections, '[]'::jsonb))
      as c(wrong text, norm_wrong text, "right" text, hint text)
  on conflict (user_id, norm_wrong) do nothing;

  update public.profiles set seeded_at = now() where id = uid;
end;
$$;

-- Merging a reply. The delete retires the words this batch replaces — a re-enriched card,
-- or the misspelling a correction supersedes — and the insert puts the new ones in. Done
-- from the browser as two requests, a connection dropped between them destroyed the
-- retired words and never delivered their replacements, while the panel reported that
-- nothing had been merged. Here they are one statement or none.
-- A merge is a replace, not an update: the old row goes and a new one is built from the
-- reply. So anything the reply does not carry is not carried either, and `done` is the
-- reader's own — the model has no opinion about whether they have learned the word. It was
-- dropped on every re-enrichment, and only visibly so after the next load.
--
-- p_rename maps a misspelling to the word that supersedes it. Without it the tick is still
-- lost whenever a spelling is corrected, because the incoming norm and the retired norm are
-- by definition different and nothing joins them.
--
-- When the capture extension lands, met_sentence, met_url, met_title, met_at and times_met
-- are reader-owned in exactly the same way and must be carried here too. That loss would be
-- silent and permanent.
-- `create or replace` cannot change a signature — it would leave the old two-argument
-- version standing beside the new one, and because p_rename has a default, a two-argument
-- call would then match both and fail as ambiguous. Drop the old signature by name first.
drop function if exists public.merge_words(jsonb, text[]);

create or replace function public.merge_words(p_add jsonb, p_retire text[], p_rename jsonb default '[]'::jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'merge_words: nobody is signed in'; end if;

  with incoming as (
    select x.w, x.norm, x.f, x.p, x.d, x.e, x.a, x.n, x.i
      from jsonb_to_recordset(coalesce(p_add, '[]'::jsonb))
        as x(w text, norm text, f integer, p text, d text, e text, a text, n text, i text)
  ),
  renames as (
    select r.wrong, r."right"
      from jsonb_to_recordset(coalesce(p_rename, '[]'::jsonb))
        as r(wrong text, "right" text)
  ),
  /* Read before the delete. Every CTE in one statement sees the same snapshot, so this
     still finds rows the delete below is removing — which is the point. */
  held as (
    select w.norm, w.done
      from public.words w
     where w.user_id = uid
       and w.done
  ),
  gone as (
    delete from public.words
     where user_id = uid
       and p_retire is not null
       and norm = any(p_retire)
    returning 1
  )
  insert into public.words (user_id, w, norm, f, p, d, e, a, n, i, done)
  select uid, i.w, i.norm, i.f, i.p, i.d, i.e, i.a, i.n, i.i,
         coalesce(mine.done, was.done, false)
    from incoming i
    /* the word kept its spelling */
    left join held mine on mine.norm = i.norm
    /* or it is the corrected spelling of something that was ticked */
    left join renames rn on rn."right" = i.norm
    left join held was on was.norm = rn.wrong
  /* The delete above is invisible to this insert — same snapshot — so a retired norm that
     is also incoming still collides. Updating on conflict is what makes that harmless, and
     it makes the whole function idempotent besides. */
  on conflict (user_id, norm) do update set
    w = excluded.w, f = excluded.f, p = excluded.p, d = excluded.d,
    e = excluded.e, a = excluded.a, n = excluded.n, i = excluded.i,
    done = excluded.done;
end;
$$;

-- Removing a field. Its words are moved first and the field goes second, so there is no
-- instant where a word points at a field that has already gone. p_move_to null sends them
-- to Unfiled, which is the honest default: the reader deleted the category, not the words.
create or replace function public.remove_field(p_id integer, p_move_to integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'remove_field: nobody is signed in'; end if;

  update public.words set f = p_move_to where user_id = uid and f = p_id;
  delete from public.fields where user_id = uid and id = p_id;
end;
$$;

-- ---------------------------------------------------------------- faults
-- Where the booklet says what broke, so the person who has to fix it does not learn about
-- it from an email that never comes. Every fault the reader is shown — a word that would
-- not move, a booklet that would not load — is written here too.
--
-- Insert only, and only for the person signed in. There is no anonymous policy on purpose:
-- the anon key is public, and a table anyone can write to is a table anyone can fill. The
-- cost of that choice is real and worth stating — a sign-in that fails has nobody to write
-- as, so the faults that happen at the gate are exactly the ones this will never see.
--
-- Nothing from a word goes in here. Not the word, not its meaning, not the Arabic. What is
-- kept is what a fix needs: what broke, where in the code, which build, and on what kind of
-- screen. `at` is set by the database rather than the browser, because a device with a
-- wrong clock should not be able to file a fault in the wrong week.
create table if not exists public.faults (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  at      timestamptz not null default now(),
  kind    text not null,                       -- 'uncaught' | 'promise' | 'sync' | 'boot'
  message text not null,
  stack   text,
  build   text,                                -- the VERSION constant in index.html
  page    text,                                -- origin and path, never the query string
  agent   text,
  screen  text
);

alter table public.faults enable row level security;

-- Insert, and nothing else. The reader has no reason to read these back and the app never
-- asks for them; they are read in the dashboard, as the service role, by whoever is fixing
-- it. No select policy means no select, which is the smallest door that still works.
drop policy if exists "file my own faults" on public.faults;
create policy "file my own faults" on public.faults
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Read newest-first while looking for what is going wrong today.
create index if not exists faults_at_idx on public.faults (at desc);

-- ---------------------------------------------------------------- last line
-- PostgREST answers the browser from a cached picture of what this database offers, and
-- it does not always notice a function that appeared a moment ago. Without this, a schema
-- that ran perfectly can still be met with "could not find the function … in the schema
-- cache" until the cache happens to refresh. Harmless to run at any time.
notify pgrst, 'reload schema';
