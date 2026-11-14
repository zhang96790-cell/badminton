-- Skyline Smash 3.3.7: the ranked leaderboard shows everyone who has played a rated match, by rating.
-- (Since 2.7 it only showed players with a rated match this season, which hid nearly everyone.) Safe to run again.
create or replace function public.leaderboard()
returns table (username text, rating int, wins int, losses int)
language sql security definer set search_path = '' stable as $$
  select p.username, p.rating, p.wins, p.losses from public.profiles p
  where p.wins + p.losses > 0
  order by p.rating desc, p.wins desc, p.username
  limit 50;
$$;
grant execute on function public.leaderboard() to anon, authenticated;
