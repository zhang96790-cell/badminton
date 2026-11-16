-- Skyline Smash 3.8.1: reaching a new ranked tier no longer gives a player pick. Run after 2.7-ranks.sql
-- and career.sql. Safe to run again. Players already chosen from picks stay owned.

-- Still remember which tiers each account has reached, but grant nothing.
create or replace function public.grant_tier_picks(p_user uuid, p_tier int) returns void language plpgsql security definer set search_path = '' as $$
declare reached int[]; t int;
begin
  select tiers_reached into reached from public.profiles where id = p_user for update;
  for t in 0..p_tier loop
    if not (t = any(reached)) then reached := reached || t; end if;
  end loop;
  update public.profiles set tiers_reached = reached where id = p_user;
end;
$$;
revoke execute on function public.grant_tier_picks(uuid, int) from public, anon, authenticated;

-- Picks that were waiting are cleared (nobody can choose from them any more).
delete from public.unlock_picks where status = 'pending';

-- Older game pages that still ask get nothing.
create or replace function public.offer_pick() returns text[] language sql security definer set search_path = '' as $$
  select '{}'::text[];
$$;
create or replace function public.choose_pick(p_character text) returns text language sql security definer set search_path = '' as $$
  select null::text;
$$;
revoke execute on function public.offer_pick() from public, anon;
revoke execute on function public.choose_pick(text) from public, anon;
grant execute on function public.offer_pick() to authenticated;
grant execute on function public.choose_pick(text) to authenticated;
