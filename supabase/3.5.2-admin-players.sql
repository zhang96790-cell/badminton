-- Skyline Smash 3.5.2: the Admin tab can look up any account (its players, stats and career save).
-- Run after admin.sql and career.sql. Safe to run again. Refuses anyone who isn't in the admins table.

-- Every account (newest activity first), with its career player and how many players it owns.
create or replace function public.admin_players()
returns json language plpgsql security definer set search_path = '' stable as $$
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  return (select coalesce(json_agg(r), '[]'::json) from (
    select p.username, p.created_at, p.last_seen, p.rating, p.wins, p.losses,
           coalesce((p.career ->> 'matches')::int, 0) as matches,
           coalesce(p.last_seen > now() - interval '2 minutes', false) as online,
           (select count(*) from public.owned_characters o where o.user_id = p.id) as owned,
           (select s.state ->> 'characterId' from public.career_saves s where s.user_id = p.id) as career_player
    from public.profiles p order by coalesce(p.last_seen, p.created_at) desc limit 2000) r);
end;
$$;

-- One account in full: profile, all-time stats, owned players and the career save.
create or replace function public.admin_player(p_username text)
returns json language plpgsql security definer set search_path = '' stable as $$
declare uid uuid; res json;
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  select id into uid from public.profiles where username = p_username;
  if uid is null then return null; end if;
  select json_build_object(
    'username', p.username, 'created_at', p.created_at, 'last_seen', p.last_seen,
    'rating', p.rating, 'peak_rating', p.peak_rating, 'wins', p.wins, 'losses', p.losses,
    'stats', p.career,
    'owned', (select coalesce(json_agg(json_build_object('id', o.character_id, 'source', o.source, 'at', o.created_at) order by o.created_at), '[]'::json)
              from public.owned_characters o where o.user_id = uid),
    'career', (select s.state from public.career_saves s where s.user_id = uid),
    'career_updated', (select s.updated_at from public.career_saves s where s.user_id = uid)
  ) into res from public.profiles p where p.id = uid;
  return res;
end;
$$;

revoke execute on function public.admin_players() from public, anon;
revoke execute on function public.admin_player(text) from public, anon;
grant execute on function public.admin_players() to authenticated;
grant execute on function public.admin_player(text) to authenticated;
