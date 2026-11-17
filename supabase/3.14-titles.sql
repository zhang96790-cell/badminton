-- Skyline Smash 3.14: weighted career titles and player cards. Run after leaderboards.sql. Safe to run again.
-- Titles count by tier (career stats ct_<tier>); the weights match src/titles.ts. Titles won before 3.14
-- have no tier saved and count 3 points each.

create or replace function public.title_points(c jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce((c ->> 'ct_olympics')::numeric, 0) * 50 + coalesce((c ->> 'ct_worlds')::numeric, 0) * 35
       + coalesce((c ->> 'ct_finals')::numeric, 0) * 25 + coalesce((c ->> 'ct_s_thousand')::numeric, 0) * 18
       + coalesce((c ->> 'ct_s_seven')::numeric, 0) * 12 + coalesce((c ->> 'ct_s_five')::numeric, 0) * 8
       + coalesce((c ->> 'ct_s_three')::numeric, 0) * 5 + coalesce((c ->> 'ct_s_hundred')::numeric, 0) * 3
       + coalesce((c ->> 'ct_club')::numeric, 0) * 1
       + greatest(0, coalesce((c ->> 'career_titles')::numeric, 0) - (
           coalesce((c ->> 'ct_olympics')::numeric, 0) + coalesce((c ->> 'ct_worlds')::numeric, 0) + coalesce((c ->> 'ct_finals')::numeric, 0)
         + coalesce((c ->> 'ct_s_thousand')::numeric, 0) + coalesce((c ->> 'ct_s_seven')::numeric, 0) + coalesce((c ->> 'ct_s_five')::numeric, 0)
         + coalesce((c ->> 'ct_s_three')::numeric, 0) + coalesce((c ->> 'ct_s_hundred')::numeric, 0) + coalesce((c ->> 'ct_club')::numeric, 0))) * 3;
$$;

-- The Career titles board: top 50 by title points, with each player's titles (only the title keys).
create or replace function public.leaderboard_titles()
returns table (username text, points numeric, stats jsonb)
language sql security definer set search_path = '' stable as $$
  select p.username, public.title_points(p.career),
         (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(p.career) e
          where e.key = 'career_titles' or e.key = 'max_career_best_rank' or e.key like 'ct\_%')
  from public.profiles p
  where public.title_points(p.career) > 0
  order by 2 desc, p.username
  limit 50;
$$;
grant execute on function public.leaderboard_titles() to anon, authenticated;

-- A player's public card: rating and record, plus the career stats that are on leaderboards anyway.
create or replace function public.player_card(p_username text)
returns json language sql security definer set search_path = '' stable as $$
  select json_build_object(
    'username', p.username, 'rating', p.rating, 'wins', p.wins, 'losses', p.losses,
    'title_points', public.title_points(p.career),
    'title_rank', (select count(*) + 1 from public.profiles q where public.title_points(q.career) > public.title_points(p.career)),
    'rating_rank', case when p.wins + p.losses > 0 then (select count(*) + 1 from public.profiles q where q.wins + q.losses > 0 and q.rating > p.rating) end,
    'stats', (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(p.career) e
              where e.key in ('matches', 'wins', 'max_smash', 'max_rally', 'max_streak', 'perfect_hits', 'aces', 'smash_winners',
                              'career_titles', 'career_matches', 'career_wins', 'career_prize', 'max_career_best_rank')
                 or e.key like 'ct\_%'),
    'achievements', (select count(*) from jsonb_each_text(p.career) e where e.key like 'max\_ach\_%')
  ) from public.profiles p where p.username = lower(p_username);
$$;
grant execute on function public.player_card(text) to anon, authenticated;
