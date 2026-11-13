-- Skyline Smash: the roster, for unlock picks and featured players. Written by npm run roster:check.
-- Run it in Supabase → SQL Editor after changing src/roster/roster.json (after characters.sql). Safe to run again.
insert into public.characters (id, name, rarity, enabled) values
  ('default_player', 'Club Player', 'common', true)
on conflict (id) do update set name = excluded.name, rarity = excluded.rarity, enabled = excluded.enabled;
update public.characters set enabled = false where id not in ('default_player');
