-- Skyline Smash: global leaderboards from career stats (2.5). Run after schema.sql.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Safe to run again.

-- Top 50 for one career record. Only the stats listed here can be asked for, and anyone can see them
-- (like the rating leaderboard). 'stars' adds up challenge stars; 'achievements' counts unlocked ones.
create or replace function public.leaderboard_stat(stat text)
returns table (username text, value numeric)
language plpgsql security definer set search_path = '' stable as $$
begin
  if stat = 'stars' then
    return query
      select p.username, s.total from public.profiles p
      cross join lateral (select coalesce(sum(e.value::numeric), 0) as total from jsonb_each_text(p.career) e where e.key like 'max\_star\_%') s
      where s.total > 0 order by s.total desc, p.username limit 50;
  elsif stat = 'achievements' then
    return query
      select p.username, s.total from public.profiles p
      cross join lateral (select count(*)::numeric as total from jsonb_each_text(p.career) e where e.key like 'max\_ach\_%') s
      where s.total > 0 order by s.total desc, p.username limit 50;
  elsif stat in ('wins', 'max_smash', 'max_rally', 'perfect_hits', 'max_streak', 'matches', 'smash_winners', 'aces') then
    return query
      select p.username, (p.career ->> stat)::numeric from public.profiles p
      where coalesce((p.career ->> stat)::numeric, 0) > 0
      order by (p.career ->> stat)::numeric desc, p.username limit 50;
  else
    raise exception 'unknown leaderboard';
  end if;
end;
$$;

grant execute on function public.leaderboard_stat(text) to anon, authenticated;
