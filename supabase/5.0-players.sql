-- Skyline Smash 5.0 test area: the 51 new players, and recruit offers for testers.
-- Run in Supabase → SQL Editor AFTER 5.0-test-area.sql. Safe to run again. Written by scripts/players-v5-sql.mjs.
-- The new players are marked released_in '5.0', so the normal (4.x) career never offers them.

insert into public.characters (id, name, rarity, enabled, country, released_in, career_strength) values
  ('lin_dan', 'Lin Dan', 'champion', true, 'CHN', '5.0', 380),
  ('viktor_axelsen', 'Viktor Axelsen', 'champion', true, 'DEN', '5.0', 380),
  ('lee_chong_wei', 'Lee Chong Wei', 'champion', true, 'MAS', '5.0', 380),
  ('chen_long', 'Chen Long', 'champion', true, 'CHN', '5.0', 380),
  ('taufik_hidayat', 'Taufik Hidayat', 'champion', true, 'INA', '5.0', 380),
  ('kento_momota', 'Kento Momota', 'champion', true, 'JPN', '5.0', 380),
  ('pe_hoyer_larsen', 'Poul-Erik Høyer Larsen', 'legendary', true, 'DEN', '5.0', 300),
  ('chen_jin', 'Chen Jin', 'legendary', true, 'CHN', '5.0', 300),
  ('peter_gade', 'Peter Gade', 'legendary', true, 'DEN', '5.0', 300),
  ('hendrawan', 'Hendrawan', 'legendary', true, 'INA', '5.0', 300),
  ('ji_xinpeng', 'Ji Xinpeng', 'legendary', true, 'CHN', '5.0', 300),
  ('rudy_hartono', 'Rudy Hartono', 'legendary', true, 'INA', '5.0', 300),
  ('allan_budikusuma', 'Allan Budikusuma', 'legendary', true, 'INA', '5.0', 300),
  ('ardy_wiranata', 'Ardy Wiranata', 'legendary', true, 'INA', '5.0', 300),
  ('rashid_sidek', 'Rashid Sidek', 'legendary', true, 'MAS', '5.0', 300),
  ('sony_dwi_kuncoro', 'Sony Dwi Kuncoro', 'legendary', true, 'INA', '5.0', 300),
  ('sun_jun', 'Sun Jun', 'mythic', true, 'CHN', '5.0', 260),
  ('xia_xuanze', 'Xia Xuanze', 'mythic', true, 'CHN', '5.0', 260),
  ('dong_jiong', 'Dong Jiong', 'mythic', true, 'CHN', '5.0', 260),
  ('lee_hyun_il', 'Lee Hyun-il', 'mythic', true, 'KOR', '5.0', 260),
  ('shon_seung_mo', 'Shon Seung-mo', 'mythic', true, 'KOR', '5.0', 260),
  ('bao_chunlai', 'Bao Chunlai', 'mythic', true, 'CHN', '5.0', 260),
  ('wong_choong_hann', 'Wong Choong Hann', 'mythic', true, 'MAS', '5.0', 260),
  ('pullela_gopichand', 'Pullela Gopichand', 'mythic', true, 'IND', '5.0', 260),
  ('boonsak_ponsana', 'Boonsak Ponsana', 'mythic', true, 'THA', '5.0', 260),
  ('kenneth_jonassen', 'Kenneth Jonassen', 'mythic', true, 'DEN', '5.0', 260),
  ('chen_hong', 'Chen Hong', 'mythic', true, 'CHN', '5.0', 260),
  ('peter_rasmussen', 'Peter Rasmussen', 'mythic', true, 'DEN', '5.0', 260),
  ('m_hafiz_hashim', 'Muhammad Hafiz Hashim', 'mythic', true, 'MAS', '5.0', 260),
  ('joko_suprianto', 'Joko Suprianto', 'mythic', true, 'INA', '5.0', 260),
  ('heryanto_arbi', 'Heryanto Arbi', 'mythic', true, 'INA', '5.0', 260),
  ('simon_santoso', 'Simon Santoso', 'elite', true, 'INA', '5.0', 225),
  ('tommy_sugiarto', 'Tommy Sugiarto', 'elite', true, 'INA', '5.0', 225),
  ('du_pengyu', 'Du Pengyu', 'elite', true, 'CHN', '5.0', 225),
  ('sho_sasaki', 'Sho Sasaki', 'elite', true, 'JPN', '5.0', 225),
  ('kenichi_tago', 'Kenichi Tago', 'elite', true, 'JPN', '5.0', 225),
  ('marc_zwiebler', 'Marc Zwiebler', 'elite', true, 'GER', '5.0', 225),
  ('hk_vittinghus', 'Hans-Kristian Vittinghus', 'elite', true, 'DEN', '5.0', 225),
  ('wang_zhengming', 'Wang Zhengming', 'elite', true, 'CHN', '5.0', 225),
  ('nguyen_tien_minh', 'Nguyen Tien Minh', 'elite', true, 'VIE', '5.0', 225),
  ('parupalli_kashyap', 'Parupalli Kashyap', 'elite', true, 'IND', '5.0', 225),
  ('wei_nan', 'Wei Nan', 'elite', true, 'CHN', '5.0', 225),
  ('chen_yuekun', 'Chen Yuekun', 'elite', true, 'CHN', '5.0', 225),
  ('rajiv_ouseph', 'Rajiv Ouseph', 'elite', true, 'ENG', '5.0', 225),
  ('roslin_hashim', 'Roslin Hashim', 'elite', true, 'MAS', '5.0', 225),
  ('lee_dong_keun', 'Lee Dong-keun', 'elite', true, 'KOR', '5.0', 225),
  ('ronald_susilo', 'Ronald Susilo', 'elite', true, 'SGP', '5.0', 225),
  ('kazushi_yamada', 'Kazushi Yamada', 'elite', true, 'JPN', '5.0', 225),
  ('t_saensomboonsuk', 'Tanongsak Saensomboonsuk', 'elite', true, 'THA', '5.0', 225),
  ('d_hayom_rumbaka', 'Dionysius Hayom Rumbaka', 'elite', true, 'INA', '5.0', 225),
  ('przemyslaw_wacha', 'Przemysław Wacha', 'elite', true, 'POL', '5.0', 225)
on conflict (id) do update set name = excluded.name, rarity = excluded.rarity, enabled = excluded.enabled,
  country = excluded.country, released_in = excluded.released_in, career_strength = excluded.career_strength;

-- Which career an offer came from, so v5 and normal offers never mix.
alter table public.career_offers add column if not exists edition int not null default 4;

-- Is this player out for the logged-in player in the 5.0 test area? (Out already, or a 5.0 player for a tester.)
create or replace function public.released_v5(v text) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_released(v) or (v = '5.0' and public.v5_allowed());
$$;
revoke execute on function public.released_v5(text) from public, anon, authenticated;

create or replace function public.pick_candidates5(p_user uuid, p_field text[], p_tier text, p_place int) returns text[]
language sql security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from (
    select c.id from public.characters c
    where c.id = any(p_field) and c.enabled and public.released_v5(c.released_in) and c.id <> 'default_player'
      and c.rarity = any(public.offer_rarities(p_tier))
      and not exists (select 1 from public.owned_characters o where o.user_id = p_user and o.character_id = c.id)
    order by -ln(greatest(random(), 1e-9)) / power(case p_place when 1 then 3.0 when 2 then 1.8 else 1.0 end,
      array_position(public.offer_rarities(p_tier), c.rarity) - 1)
    limit 3) x;
$$;
revoke execute on function public.pick_candidates5(uuid, text[], text, int) from public, anon, authenticated;

/** A 5.0 test-area win: make (or return) its offer. Same limits as the normal career (6 offers a day in all). */
create or replace function public.offer5_create(p_tournament text, p_tier text, p_field text[], p_place int) returns json
language plpgsql security definer set search_path = '' as $$
declare today int; ids text[]; o record;
begin
  if auth.uid() is null or not public.v5_allowed() then raise exception 'not a v5 tester'; end if;
  if cardinality(p_field) > 64 or p_tier !~ '^[A-Z0-9_]{2,12}$' or p_tournament !~ '^[a-z0-9_]{1,48}$' then raise exception 'bad offer request'; end if;
  if p_place not in (1, 2, 3) or (p_place > 1 and p_tier not in ('S100', 'S300', 'S500')) then raise exception 'bad offer request'; end if;
  select * into o from public.career_offers where user_id = auth.uid() and status = 'open' and edition = 5 and tournament_id = p_tournament
    and created_at > now() - interval '1 day' order by id desc limit 1;
  if found then return json_build_object('id', o.id, 'candidates', o.candidates, 'rerolled', o.rerolled); end if;
  select count(*) into today from public.career_offers where user_id = auth.uid() and created_at > now() - interval '1 day';
  if today >= 6 then return json_build_object('limited', true); end if;
  update public.career_offers set status = 'expired', decided_at = now() where user_id = auth.uid() and status = 'open' and edition = 5;
  ids := public.pick_candidates5(auth.uid(), p_field, p_tier, p_place);
  if cardinality(ids) = 0 then return json_build_object('candidates', '{}'::text[]); end if;
  insert into public.career_offers (user_id, tournament_id, tier, field, candidates, edition)
    values (auth.uid(), p_tournament, p_tier, p_field, ids, 5) returning * into o;
  return json_build_object('id', o.id, 'candidates', o.candidates, 'rerolled', false);
end;
$$;
revoke execute on function public.offer5_create(text, text, text[], int) from public, anon;
grant execute on function public.offer5_create(text, text, text[], int) to authenticated;

/** One reroll per 5.0 offer. (Choosing uses the normal offer_choose.) */
create or replace function public.offer5_reroll(p_offer bigint) returns json language plpgsql security definer set search_path = '' as $$
declare o record; ids text[];
begin
  select * into o from public.career_offers where id = p_offer and user_id = auth.uid() and status = 'open' and edition = 5 for update;
  if not found or o.rerolled then return json_build_object('ok', false); end if;
  ids := public.pick_candidates5(auth.uid(), array(select unnest(o.field) except select unnest(o.candidates)), o.tier, 1);
  if cardinality(ids) = 0 then return json_build_object('ok', false); end if;
  update public.career_offers set candidates = ids, rerolled = true where id = p_offer;
  return json_build_object('ok', true, 'id', p_offer, 'candidates', ids, 'rerolled', true);
end;
$$;
revoke execute on function public.offer5_reroll(bigint) from public, anon;
grant execute on function public.offer5_reroll(bigint) to authenticated;
