-- Skyline Smash: undo a player's most recent ranked LOSS (both players' rating and win/loss record go
-- back, and the match is removed from history). For a loss caused by the other player's connection.
-- Supabase → SQL Editor → New query. Change the username on both lines marked ◀ if needed.

-- 1) Look first: the match that will be undone.
select created_at, winner_name, loser_name, score, winner_change, loser_change, forfeit
from public.matches
where loser = (select id from public.profiles where username = 'barry_zhang')   -- ◀
order by created_at desc limit 1;

-- 2) Undo it (run this once you're happy it's the right match).
with m as (
  select * from public.matches
  where loser = (select id from public.profiles where username = 'barry_zhang')   -- ◀
  order by created_at desc limit 1
), w as (
  update public.profiles p set rating = p.rating - m.winner_change, wins = greatest(0, p.wins - 1)
  from m where p.id = m.winner returning p.username, p.rating
), l as (
  update public.profiles p set rating = p.rating - m.loser_change, losses = greatest(0, p.losses - 1)
  from m where p.id = m.loser returning p.username, p.rating
), gone as (
  delete from public.matches where id in (select id from m) returning id
)
select (select username || ' now ' || rating from w) as winner_now,
       (select username || ' now ' || rating from l) as loser_now,
       (select count(*) from gone) as matches_removed;
