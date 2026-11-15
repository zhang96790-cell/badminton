-- Skyline Smash 3.5: recruit offers for 1st, 2nd and 3rd at Super 100, 300 and 500 events (the winner only
-- elsewhere), with better places giving better odds of the rarer players. Up to 6 offers a day (was 3).
-- Run after career.sql. Safe to run again. The older 3-argument functions stay (rerolls still use them).

-- Pick up to 3 players from the draw, weighted toward the rarer allowed rarities by finishing place:
-- each step up in rarity is 3x as likely for a winner, 1.8x for a runner-up and even odds for 3rd place.
create or replace function public.pick_candidates(p_user uuid, p_field text[], p_tier text, p_place int) returns text[]
language sql security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from (
    select c.id from public.characters c
    where c.id = any(p_field) and c.enabled and public.is_released(c.released_in) and c.id <> 'default_player'
      and c.rarity = any(public.offer_rarities(p_tier))
      and not exists (select 1 from public.owned_characters o where o.user_id = p_user and o.character_id = c.id)
    order by -ln(greatest(random(), 1e-9)) / power(case p_place when 1 then 3.0 when 2 then 1.8 else 1.0 end,
      array_position(public.offer_rarities(p_tier), c.rarity) - 1)
    limit 3) x;
$$;
revoke execute on function public.pick_candidates(uuid, text[], text, int) from public, anon, authenticated;

create or replace function public.offer_create(p_tournament text, p_tier text, p_field text[], p_place int) returns json
language plpgsql security definer set search_path = '' as $$
declare today int; ids text[]; o record;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if cardinality(p_field) > 64 or p_tier !~ '^[A-Z0-9_]{2,12}$' or p_tournament !~ '^[a-z0-9_]{1,48}$' then raise exception 'bad offer request'; end if;
  if p_place not in (1, 2, 3) or (p_place > 1 and p_tier not in ('S100', 'S300', 'S500')) then raise exception 'bad offer request'; end if;
  select * into o from public.career_offers where user_id = auth.uid() and status = 'open' and tournament_id = p_tournament
    and created_at > now() - interval '1 day' order by id desc limit 1;
  if found then return json_build_object('id', o.id, 'candidates', o.candidates, 'rerolled', o.rerolled); end if;
  select count(*) into today from public.career_offers where user_id = auth.uid() and created_at > now() - interval '1 day';
  if today >= 6 then return json_build_object('limited', true); end if;
  update public.career_offers set status = 'expired', decided_at = now() where user_id = auth.uid() and status = 'open';
  ids := public.pick_candidates(auth.uid(), p_field, p_tier, p_place);
  if cardinality(ids) = 0 then return json_build_object('candidates', '{}'::text[]); end if;
  insert into public.career_offers (user_id, tournament_id, tier, field, candidates) values (auth.uid(), p_tournament, p_tier, p_field, ids) returning * into o;
  return json_build_object('id', o.id, 'candidates', o.candidates, 'rerolled', false);
end;
$$;
revoke execute on function public.offer_create(text, text, text[], int) from public, anon;
grant execute on function public.offer_create(text, text, text[], int) to authenticated;
