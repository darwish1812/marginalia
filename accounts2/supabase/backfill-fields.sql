-- ONE-OFF. Run this once, now, and then delete it. It is not part of schema.sql and must
-- not be added to it.
--
-- The problem it fixes: seed_account() returns early once profiles.seeded_at is stamped, so
-- an account stocked before the fields table existed never receives any fields. It reads an
-- empty table, FIELDS becomes [], and every word falls into Unfiled — not lost, but a
-- booklet with no fields and 150 unfiled words in it.
--
-- Why it must not become permanent: the only thing it can test is "this account has no
-- fields", and that is also true of somebody who chose the blank pack at first run, or who
-- deleted all eight on purpose. Re-running it later would hand them a taxonomy about castles
-- and scripture that they explicitly declined. It is safe today only because no such account
-- exists yet — every account predates the fields table. That stops being true the moment
-- anybody picks "I'll build my own".
insert into public.fields (user_id, id, name, ink, note, sort)
select p.id, f.id, f.name, f.ink, f.note, f.id
  from public.profiles p
  cross join (values
    (1, 'The Feudal World', '#C9922F', 'Castles, guilds, gutters and archaic speech — the register of historical fiction and fantasy.'),
    (2, 'Faith & Philosophy', '#3F9A85', 'How thinkers argue about scripture: literal or symbolic, human-shaped or beyond shape entirely.'),
    (3, 'Power & Conflict', '#C4485C', 'What rulers do, what subjects endure, and what happens when either pushes too far.'),
    (4, 'Rhetoric & Deception', '#8C6FD4', 'The vocabulary of political argument — most of these appear in news analysis and opinion writing.'),
    (5, 'Character & Temperament', '#4E8AD6', 'Words that judge a person. Nearly all carry approval or contempt, so they are rarely neutral.'),
    (6, 'Mind & Abstraction', '#C77FB0', 'Formal, essay-register words. These lift academic and professional writing more than any other group here.'),
    (7, 'Body, Vice & Survival', '#6E9E4E', 'The physical and the disreputable. A few are blunt — the notes tell you when to be careful.'),
    (8, 'Hardship & Social Order', '#6E7899', 'Poverty, policing, and the language of who holds power over whom. This is the register of journalism and social science — and it is the field your list has grown into most.')
  ) as f(id, name, ink, note)
 where p.seeded_at is not null
   and not exists (select 1 from public.fields x where x.user_id = p.id)
on conflict (user_id, id) do nothing;

notify pgrst, 'reload schema';
