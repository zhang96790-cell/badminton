-- Skyline Smash 3.0: career saves, career starter, recruit offers and the daily challenge.
-- Run in Supabase → SQL Editor AFTER 2.7-ranks.sql and BEFORE roster.sql. Safe to run again.

-- ── Game settings the server needs ──────────────────────────────────────────
create table if not exists public.game_config (key text primary key, value text not null);
alter table public.game_config enable row level security;
revoke all on public.game_config from anon, authenticated;
-- The newest game version that's out: players with a later released_in stay hidden (and can't be offered).
insert into public.game_config (key, value) values ('app_version', '3.0') on conflict (key) do update set value = excluded.value;

alter table public.characters add column if not exists country text, add column if not exists released_in text, add column if not exists career_strength int;

/** Is this version out yet? Compares part by part ("3.10" is after "3.9"). */
create or replace function public.is_released(v text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(string_to_array(coalesce(nullif(v, ''), '0'), '.')::int[]
    <= string_to_array((select value from public.game_config where key = 'app_version'), '.')::int[], true);
$$;
revoke execute on function public.is_released(text) from public, anon, authenticated;

-- 2.7's rank-up picks now only offer players who are out.
create or replace function public.offer_pick() returns text[] language plpgsql security definer set search_path = '' as $$
declare pk record; ids text[];
begin
  select * into pk from public.unlock_picks where user_id = auth.uid() and status = 'pending' order by tier limit 1 for update;
  if not found then return '{}'; end if;
  if cardinality(pk.offered) > 0 then return pk.offered; end if;
  select coalesce(array_agg(id), '{}') into ids from (
    select c.id from public.characters c
    where c.enabled and public.is_released(c.released_in) and c.id <> 'default_player'
      and c.rarity in ('common', 'rare', 'super_rare', 'epic', 'elite')
      and not exists (select 1 from public.owned_characters o where o.user_id = auth.uid() and o.character_id = c.id)
    order by random() limit 3) x;
  if cardinality(ids) > 0 then update public.unlock_picks set offered = ids where id = pk.id; end if;
  return ids;
end;
$$;
revoke execute on function public.offer_pick() from public, anon;
grant execute on function public.offer_pick() to authenticated;

-- ── Career saves ────────────────────────────────────────────────────────────
-- One career per account. rev goes up by one with every save; a save that expects an older rev is refused
-- (the career was changed on another device) and the newer copy is sent back so the player can choose.
create table if not exists public.career_saves (
  user_id uuid primary key references public.profiles on delete cascade,
  data_version int not null default 1,
  rev int not null default 0,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.career_saves enable row level security;
revoke all on public.career_saves from anon, authenticated;

create or replace function public.career_get() returns json language sql security definer set search_path = '' stable as $$
  select json_build_object('rev', rev, 'data_version', data_version, 'state', state, 'updated_at', updated_at)
  from public.career_saves where user_id = auth.uid();
$$;
revoke execute on function public.career_get() from public, anon;
grant execute on function public.career_get() to authenticated;

/** Save. p_expected_rev: the rev this copy was loaded from (0 for a new career; -1 to overwrite on purpose). */
create or replace function public.career_put(p_expected_rev int, p_data_version int, p_state jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare cur record;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if octet_length(p_state::text) > 300000 then raise exception 'career save too big'; end if;
  select * into cur from public.career_saves where user_id = auth.uid() for update;
  if not found then
    insert into public.career_saves (user_id, data_version, rev, state) values (auth.uid(), p_data_version, 1, p_state);
    return json_build_object('ok', true, 'rev', 1);
  end if;
  if p_expected_rev <> -1 and cur.rev <> p_expected_rev then
    return json_build_object('ok', false, 'conflict', true, 'rev', cur.rev, 'state', cur.state, 'updated_at', cur.updated_at);
  end if;
  update public.career_saves set rev = cur.rev + 1, data_version = p_data_version, state = p_state, updated_at = now() where user_id = auth.uid();
  return json_build_object('ok', true, 'rev', cur.rev + 1);
end;
$$;
revoke execute on function public.career_put(int, int, jsonb) from public, anon;
grant execute on function public.career_put(int, int, jsonb) to authenticated;

/** A new career's free Common player (once per account, ever). Returns the player, or null if already used. */
create or replace function public.career_starter(p_character text) returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return null; end if;
  if exists (select 1 from public.owned_characters where user_id = auth.uid() and source = 'starter') then return null; end if;
  if not exists (select 1 from public.characters where id = p_character and enabled and rarity = 'common' and public.is_released(released_in)) then return null; end if;
  insert into public.owned_characters (user_id, character_id, source) values (auth.uid(), p_character, 'starter')
    on conflict (user_id, character_id) do update set source = 'starter';
  return p_character;
end;
$$;
revoke execute on function public.career_starter(text) from public, anon;
grant execute on function public.career_starter(text) to authenticated;

-- ── Recruit offers ──────────────────────────────────────────────────────────
-- Winning a career tournament earns an offer: the server picks 3 players from that tournament's field
-- (ones you don't own, rarities that tier can hold), stores them, and only grants a player it offered.
-- At most 3 offers a real day per account. Money is the game's own business (it's in the career save).
create table if not exists public.career_offers (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  tournament_id text not null,
  tier text not null,
  field text[] not null,
  candidates text[] not null,
  rerolled boolean not null default false,
  status text not null default 'open' check (status in ('open', 'chosen', 'skipped', 'expired')),
  chosen text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists career_offers_user on public.career_offers (user_id, created_at desc);
alter table public.career_offers enable row level security;
revoke all on public.career_offers from anon, authenticated;

-- Who you can recruit after winning each level (the owner's "obtainable from" table). Anyone can appear in any
-- draw; this only limits recruiting. Players not released yet are never offered (pick_candidates checks).
create or replace function public.offer_rarities(p_tier text) returns text[] language sql immutable as $$
  select case p_tier
    when 'S100' then array['common']
    when 'S300' then array['common', 'rare']
    when 'S500' then array['common', 'rare', 'super_rare']
    when 'S750' then array['super_rare', 'epic']
    when 'S1000' then array['epic', 'elite', 'mythic']
    when 'WTF' then array['elite', 'mythic', 'legendary']
    when 'WORLDS' then array['mythic', 'legendary', 'champion']
    when 'OLYMPICS' then array['legendary', 'champion']
    else array[]::text[] end;
$$;

create or replace function public.pick_candidates(p_user uuid, p_field text[], p_tier text) returns text[]
language sql security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from (
    select c.id from public.characters c
    where c.id = any(p_field) and c.enabled and public.is_released(c.released_in) and c.id <> 'default_player'
      and c.rarity = any(public.offer_rarities(p_tier))
      and not exists (select 1 from public.owned_characters o where o.user_id = p_user and o.character_id = c.id)
    order by random() limit 3) x;
$$;
revoke execute on function public.pick_candidates(uuid, text[], text) from public, anon, authenticated;

/** A tournament win: make (or return) its offer. Any older open offer expires. */
create or replace function public.offer_create(p_tournament text, p_tier text, p_field text[]) returns json
language plpgsql security definer set search_path = '' as $$
declare today int; ids text[]; o record;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if cardinality(p_field) > 64 or p_tier !~ '^[A-Z0-9_]{2,12}$' or p_tournament !~ '^[a-z0-9_]{1,48}$' then raise exception 'bad offer request'; end if;
  select * into o from public.career_offers where user_id = auth.uid() and status = 'open' and tournament_id = p_tournament
    and created_at > now() - interval '1 day' order by id desc limit 1;
  if found then return json_build_object('id', o.id, 'candidates', o.candidates, 'rerolled', o.rerolled); end if;
  select count(*) into today from public.career_offers where user_id = auth.uid() and created_at > now() - interval '1 day';
  if today >= 3 then return json_build_object('limited', true); end if;
  update public.career_offers set status = 'expired', decided_at = now() where user_id = auth.uid() and status = 'open';
  ids := public.pick_candidates(auth.uid(), p_field, p_tier);
  if cardinality(ids) = 0 then return json_build_object('candidates', '{}'::text[]); end if;
  insert into public.career_offers (user_id, tournament_id, tier, field, candidates) values (auth.uid(), p_tournament, p_tier, p_field, ids) returning * into o;
  return json_build_object('id', o.id, 'candidates', o.candidates, 'rerolled', false);
end;
$$;
revoke execute on function public.offer_create(text, text, text[]) from public, anon;
grant execute on function public.offer_create(text, text, text[]) to authenticated;

/** One reroll per offer (the game charges for it). */
create or replace function public.offer_reroll(p_offer bigint) returns json language plpgsql security definer set search_path = '' as $$
declare o record; ids text[];
begin
  select * into o from public.career_offers where id = p_offer and user_id = auth.uid() and status = 'open' for update;
  if not found or o.rerolled then return json_build_object('ok', false); end if;
  ids := public.pick_candidates(auth.uid(), array(select unnest(o.field) except select unnest(o.candidates)), o.tier);
  if cardinality(ids) = 0 then return json_build_object('ok', false); end if;
  update public.career_offers set candidates = ids, rerolled = true where id = p_offer;
  return json_build_object('ok', true, 'id', p_offer, 'candidates', ids, 'rerolled', true);
end;
$$;
revoke execute on function public.offer_reroll(bigint) from public, anon;
grant execute on function public.offer_reroll(bigint) to authenticated;

/** Recruit one of the offered players (or skip with p_character null). They join your account for every mode. */
create or replace function public.offer_choose(p_offer bigint, p_character text) returns text language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  select * into o from public.career_offers where id = p_offer and user_id = auth.uid() and status = 'open' for update;
  if not found then return null; end if;
  if p_character is null then
    update public.career_offers set status = 'skipped', decided_at = now() where id = p_offer;
    return null;
  end if;
  if not (p_character = any(o.candidates)) then return null; end if;
  insert into public.owned_characters (user_id, character_id, source) values (auth.uid(), p_character, 'career') on conflict do nothing;
  update public.career_offers set status = 'chosen', chosen = p_character, decided_at = now() where id = p_offer;
  return p_character;
end;
$$;
revoke execute on function public.offer_choose(bigint, text) from public, anon;
grant execute on function public.offer_choose(bigint, text) to authenticated;

-- ── Daily challenge ─────────────────────────────────────────────────────────
-- One challenge per UTC day, the same for everyone, chosen here (so nobody can pick an easier one).
-- It's a single-player result, so this is trust-based: the token, the 90-second minimum, score checks,
-- one claim a day, 75 points a season and the World Class ceiling are there to limit what cheating can win.
create table if not exists public.daily_claims (
  user_id uuid not null references public.profiles on delete cascade,
  day date not null,
  token uuid not null default gen_random_uuid(),
  starts int not null default 1,
  started_at timestamptz not null default now(),
  claimed_at timestamptz,
  score jsonb,
  reward int,
  primary key (user_id, day)
);
alter table public.daily_claims enable row level security;
revoke all on public.daily_claims from anon, authenticated;

/** Today's challenge: opponent (from the strongest released players, Rare or better), 1–2 handicaps, difficulty, reward. */
create or replace function public.daily_today() returns json language plpgsql stable security definer set search_path = '' as $$
declare d date := (now() at time zone 'utc')::date; h bytea; pool text[]; boss text; brar text; hs text[] := '{}';
  all_h text[] := array['no_smash', 'no_drop', 'fast_opponent', 'start_behind', 'to_11', 'half_energy'];
  sev int := 0; diff int; reward int; n int; i int; pick text;
begin
  h := decode(md5('skyline-daily-' || d::text), 'hex');
  select array_agg(id order by id) into pool from public.characters
  where enabled and public.is_released(released_in) and rarity <> 'common' and id <> 'default_player'
    and career_strength = (select max(career_strength) from public.characters where enabled and public.is_released(released_in) and rarity <> 'common' and id <> 'default_player');
  if pool is null then
    select array_agg(id order by id) into pool from public.characters where enabled and public.is_released(released_in) and id <> 'default_player';
  end if;
  if pool is null then return null; end if;
  boss := pool[1 + (get_byte(h, 0) * 256 + get_byte(h, 1)) % cardinality(pool)];
  select rarity into brar from public.characters where id = boss;
  n := 1 + get_byte(h, 2) % 2;
  i := get_byte(h, 3) % 6;
  while cardinality(hs) < n loop
    pick := all_h[1 + i % 6];
    if not (pick = any(hs)) and not (pick = 'start_behind' and 'to_11' = any(hs)) and not (pick = 'to_11' and 'start_behind' = any(hs)) then hs := hs || pick; end if;
    i := i + 1 + get_byte(h, 4) % 5;
  end loop;
  -- Severity: smashes and a faster opponent hurt most.
  foreach pick in array hs loop
    sev := sev + case pick when 'no_smash' then 2 when 'fast_opponent' then 2 when 'start_behind' then 1 when 'no_drop' then 1 when 'half_energy' then 1 else 0 end;
  end loop;
  diff := least(5, greatest(1, case brar when 'common' then 0 when 'rare' then 1 when 'super_rare' then 2 when 'epic' then 3 else 4 end + sev));
  reward := (array[5, 8, 10, 13, 15])[diff];
  return json_build_object('day', d, 'opponent', boss, 'handicaps', hs, 'behind', 1 + get_byte(h, 5) % 5,
    'difficulty', diff, 'reward', reward, 'next_at', (d + 1)::timestamp at time zone 'utc');
end;
$$;
revoke execute on function public.daily_today() from public, anon, authenticated;

/** Today's challenge plus where you stand: started, claimed, and this season's daily points so far. */
create or replace function public.daily_get() returns json language plpgsql stable security definer set search_path = '' as $$
declare c record; t json; s int;
begin
  t := public.daily_today();
  select * into c from public.daily_claims where user_id = auth.uid() and day = (now() at time zone 'utc')::date;
  s := (select max(id) from public.seasons where starts_at <= now());
  return json_build_object('challenge', t, 'claimed', c.claimed_at is not null, 'reward_got', c.reward,
    'season_total', coalesce((select sum(delta) from public.rating_events where user_id = auth.uid() and source = 'daily' and season_id = s), 0),
    'season_cap', 75);
end;
$$;
revoke execute on function public.daily_get() from public, anon;
grant execute on function public.daily_get() to authenticated;

/** Start (or restart) today's attempt: a token valid for 3 hours. At most 20 starts a day. */
create or replace function public.daily_start() returns json language plpgsql security definer set search_path = '' as $$
declare c record; d date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  select * into c from public.daily_claims where user_id = auth.uid() and day = d for update;
  if found and c.claimed_at is not null then return json_build_object('ok', false, 'claimed', true); end if;
  if found and c.starts >= 20 then return json_build_object('ok', false, 'limited', true); end if;
  insert into public.daily_claims (user_id, day) values (auth.uid(), d)
    on conflict (user_id, day) do update set token = gen_random_uuid(), started_at = now(), starts = public.daily_claims.starts + 1
    returning * into c;
  return json_build_object('ok', true, 'token', c.token, 'challenge', public.daily_today());
end;
$$;
revoke execute on function public.daily_start() from public, anon;
grant execute on function public.daily_start() to authenticated;

/** A finished badminton game? (to = 21, 15 or 11; win by 2, capped at 30 / 21 / 15.) */
create or replace function public.valid_game(a int, b int, target int) returns boolean language sql immutable as $$
  select case when a < 0 or b < 0 then false else
    (with w as (select greatest(a, b) as w, least(a, b) as l, case target when 21 then 30 when 15 then 21 else 15 end as cap)
     select (w = target and l <= target - 2) or (w > target and w < cap and w - l = 2) or (w = cap and l = cap - 1) from w) end;
$$;

/**
 * Claim today's win. p_games: [[yours, theirs], …] in order. Rating: the reward, cut so this season's daily
 * total stays within 75 and you never rise past the top of Elite (1699) from daily points.
 */
create or replace function public.daily_claim(p_token uuid, p_games jsonb) returns json language plpgsql security definer set search_path = '' as $$
declare c record; t jsonb; target int; won int := 0; lost int := 0; g jsonb; a int; b int; s int; got int; r int; tr int;
  nr int; nt int; v_delta int;
begin
  select * into c from public.daily_claims where user_id = auth.uid() and day = (now() at time zone 'utc')::date for update;
  if not found or c.token <> p_token then return json_build_object('ok', false, 'reason', 'no_attempt'); end if;
  if c.claimed_at is not null then return json_build_object('ok', false, 'reason', 'claimed'); end if;
  if now() > c.started_at + interval '3 hours' then return json_build_object('ok', false, 'reason', 'expired'); end if;
  if now() < c.started_at + interval '90 seconds' then return json_build_object('ok', false, 'reason', 'too_fast'); end if;
  t := public.daily_today()::jsonb;
  target := case when (t->'handicaps') ? 'to_11' then 11 else 21 end;
  if jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) not between 1 and 3 then return json_build_object('ok', false, 'reason', 'bad_score'); end if;
  for g in select * from jsonb_array_elements(p_games) loop
    a := (g->>0)::int; b := (g->>1)::int;
    if not public.valid_game(a, b, target) then return json_build_object('ok', false, 'reason', 'bad_score'); end if;
    if a > b then won := won + 1; else lost := lost + 1; end if;
  end loop;
  -- One game to 11, otherwise a single game to 21 (the daily challenge format).
  if won <> 1 or lost <> 0 then return json_build_object('ok', false, 'reason', 'not_won'); end if;
  s := public.rollover_season();
  got := coalesce((select sum(delta) from public.rating_events where user_id = auth.uid() and source = 'daily' and season_id = s), 0);
  select rating, rank_tier into r, tr from public.profiles where id = auth.uid() for update;
  v_delta := greatest(0, least((t->>'reward')::int, 75 - got, 1699 - r));
  update public.daily_claims set claimed_at = now(), score = p_games, reward = v_delta where user_id = c.user_id and day = c.day;
  if v_delta > 0 then
    nr := r + v_delta;
    nt := public.tier_after(nr, coalesce(tr, public.tier_of(r)));
    update public.profiles set rating = nr, rank_tier = nt, peak_tier = greatest(coalesce(peak_tier, 0), nt),
      peak_rating = greatest(coalesce(peak_rating, 0), nr), season_peak_tier = greatest(coalesce(season_peak_tier, 0), nt) where id = auth.uid();
    perform public.grant_tier_picks(auth.uid(), nt);
    insert into public.rating_events (user_id, season_id, source, delta, rating_after) values (auth.uid(), s, 'daily', v_delta, nr);
  end if;
  return json_build_object('ok', true, 'reward', v_delta, 'rating', coalesce(nr, r), 'full_reward', (t->>'reward')::int, 'season_total', got + v_delta);
end;
$$;
revoke execute on function public.daily_claim(uuid, jsonb) from public, anon;
grant execute on function public.daily_claim(uuid, jsonb) to authenticated;
