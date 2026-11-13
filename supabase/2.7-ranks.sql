-- Skyline Smash 2.7: rank tiers, seasons, rating history, friend-room Elo, players (characters),
-- unlock picks, featured players and score disputes. Run after schema.sql (and admin.sql, leaderboards.sql).
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Safe to run again.

-- ── Rank tiers ──────────────────────────────────────────────────────────────
-- 0 Rookie, 1 Club 900, 2 Regional 1050, 3 National 1200, 4 International 1350, 5 Elite 1500,
-- 6 World Class 1700, 7 Legend 1900. You drop a tier only 20 points below its threshold.
create or replace function public.tier_floor(t int) returns int language sql immutable as $$
  select (array[0, 900, 1050, 1200, 1350, 1500, 1700, 1900])[t + 1];
$$;

create or replace function public.tier_of(r int) returns int language sql immutable as $$
  select case when r >= 1900 then 7 when r >= 1700 then 6 when r >= 1500 then 5 when r >= 1350 then 4
              when r >= 1200 then 3 when r >= 1050 then 2 when r >= 900 then 1 else 0 end;
$$;

/** New tier after a rating change: promote as soon as you reach a threshold, demote only 20 below yours. */
create or replace function public.tier_after(r int, current_tier int) returns int language plpgsql immutable as $$
declare t int := greatest(current_tier, public.tier_of(r));
begin
  while t > 0 and r < public.tier_floor(t) - 20 loop t := t - 1; end loop;
  return t;
end;
$$;

alter table public.profiles add column if not exists rank_tier int;
alter table public.profiles add column if not exists peak_tier int;
alter table public.profiles add column if not exists peak_rating int;
alter table public.profiles add column if not exists season_peak_tier int;
alter table public.profiles add column if not exists tiers_reached int[] not null default '{}';
alter table public.profiles add column if not exists rated_games int not null default 0;

-- ── Seasons ─────────────────────────────────────────────────────────────────
-- Quarterly. Season 1 runs from release to 31 Dec 2026 (UTC); after that, calendar quarters.
create table if not exists public.seasons (
  id int primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  rolled boolean not null default false
);
alter table public.seasons enable row level security;
revoke all on public.seasons from anon, authenticated;
insert into public.seasons (id, starts_at, ends_at) values (1, now(), '2027-01-01 00:00:00+00') on conflict (id) do nothing;

/** Titles and card frames for the best tier you reached in a season. */
create table if not exists public.season_rewards (
  user_id uuid references public.profiles on delete cascade,
  season_id int not null,
  tier int not null,
  title text not null,
  frame text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, season_id)
);
alter table public.season_rewards enable row level security;
drop policy if exists "Players see their own rewards" on public.season_rewards;
create policy "Players see their own rewards" on public.season_rewards for select using (auth.uid() = user_id);
revoke insert, update, delete on public.season_rewards from anon, authenticated;

create or replace function public.tier_name(t int) returns text language sql immutable as $$
  select (array['Rookie', 'Club', 'Regional', 'National', 'International', 'Elite', 'World Class', 'Legend'])[t + 1];
$$;

/**
 * Start the next season if the current one has ended (safe to call any time, from anything: it does the work
 * once). Everyone's season reward is saved, then ratings are squeezed halfway back to 1000.
 */
create or replace function public.rollover_season() returns int language plpgsql security definer set search_path = '' as $$
declare s record; next_start timestamptz; next_end timestamptz;
begin
  loop
    select * into s from public.seasons where not rolled order by id desc limit 1 for update;
    if not found then
      select * into s from public.seasons order by id desc limit 1;
      return s.id;
    end if;
    if now() < s.ends_at then return s.id; end if;
    insert into public.season_rewards (user_id, season_id, tier, title, frame)
      select id, s.id, season_peak_tier, public.tier_name(season_peak_tier) || ' · Season ' || s.id, 'tier_' || season_peak_tier
      from public.profiles p where season_peak_tier is not null
        and exists (select 1 from public.rating_events e where e.user_id = p.id and e.season_id = s.id)
      on conflict do nothing;
    update public.profiles set
      rating = round(1000 + 0.5 * (rating - 1000)),
      rank_tier = public.tier_of(round(1000 + 0.5 * (rating - 1000))::int),
      season_peak_tier = public.tier_of(round(1000 + 0.5 * (rating - 1000))::int);
    update public.seasons set rolled = true where id = s.id;
    next_start := s.ends_at;
    next_end := date_trunc('quarter', s.ends_at) + interval '3 months';
    insert into public.seasons (id, starts_at, ends_at) values (s.id + 1, next_start, next_end) on conflict (id) do nothing;
  end loop;
end;
$$;
revoke execute on function public.rollover_season() from public, anon;
grant execute on function public.rollover_season() to authenticated, service_role;

-- Existing players: tiers from their current rating (and the tiers below it count as reached).
update public.profiles set
  rank_tier = coalesce(rank_tier, public.tier_of(rating)),
  peak_tier = coalesce(peak_tier, public.tier_of(rating)),
  peak_rating = coalesce(peak_rating, rating),
  season_peak_tier = coalesce(season_peak_tier, public.tier_of(rating))
where rank_tier is null;

-- ── Rating history ──────────────────────────────────────────────────────────
create table if not exists public.rating_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete cascade,
  season_id int not null,
  source text not null check (source in ('ranked', 'friendly', 'daily')),
  delta int not null,
  rating_after int not null,
  opponent uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rating_events_user on public.rating_events (user_id, created_at desc);
alter table public.rating_events enable row level security;
drop policy if exists "Players see their own rating history" on public.rating_events;
create policy "Players see their own rating history" on public.rating_events for select using (auth.uid() = user_id);
revoke insert, update, delete on public.rating_events from anon, authenticated;

alter table public.matches add column if not exists season_id int;
alter table public.matches add column if not exists source text not null default 'ranked';

-- ── Players (characters), unlock picks, featured ────────────────────────────
-- The roster itself lives in the game (src/roster/roster.json); supabase/roster.sql copies the ids here.
create table if not exists public.characters (
  id text primary key check (id ~ '^[a-z_]{1,20}$'),
  name text not null,
  rarity text not null,
  enabled boolean not null default true
);
alter table public.characters enable row level security;
revoke all on public.characters from anon, authenticated;

create table if not exists public.featured (
  season_id int not null,
  character_id text not null references public.characters on delete cascade,
  primary key (season_id, character_id)
);
alter table public.featured enable row level security;
revoke all on public.featured from anon, authenticated;

create table if not exists public.owned_characters (
  user_id uuid references public.profiles on delete cascade,
  character_id text not null,
  source text not null default 'pick',
  created_at timestamptz not null default now(),
  primary key (user_id, character_id)
);
alter table public.owned_characters enable row level security;
revoke all on public.owned_characters from anon, authenticated;

/** One free pick each time you first reach a tier from Regional up. 'pending' until you choose. */
create table if not exists public.unlock_picks (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete cascade,
  tier int not null,
  status text not null default 'pending' check (status in ('pending', 'chosen')),
  offered text[] not null default '{}',
  chosen text,
  created_at timestamptz not null default now(),
  unique (user_id, tier)
);
alter table public.unlock_picks enable row level security;
revoke all on public.unlock_picks from anon, authenticated;

/** Grant picks for any tier from Regional (2) up that you've reached for the first time. */
create or replace function public.grant_tier_picks(p_user uuid, p_tier int) returns void language plpgsql security definer set search_path = '' as $$
declare reached int[]; t int;
begin
  select tiers_reached into reached from public.profiles where id = p_user for update;
  for t in 0..p_tier loop
    if not (t = any(reached)) then
      reached := reached || t;
      if t >= 2 then insert into public.unlock_picks (user_id, tier) values (p_user, t) on conflict do nothing; end if;
    end if;
  end loop;
  update public.profiles set tiers_reached = reached where id = p_user;
end;
$$;
revoke execute on function public.grant_tier_picks(uuid, int) from public, anon, authenticated;

-- Existing players already at Regional or above earn their picks now.
do $$ declare p record; begin
  for p in select id, rank_tier from public.profiles where cardinality(tiers_reached) = 0 loop
    perform public.grant_tier_picks(p.id, p.rank_tier);
  end loop;
end $$;

create or replace function public.featured_now() returns text[] language sql security definer set search_path = '' stable as $$
  select coalesce(array_agg(f.character_id), '{}') from public.featured f join public.characters c on c.id = f.character_id
  where c.enabled and f.season_id = (select max(id) from public.seasons where starts_at <= now());
$$;
grant execute on function public.featured_now() to anon, authenticated;

create or replace function public.my_characters() returns json language sql security definer set search_path = '' stable as $$
  select json_build_object(
    'owned', coalesce((select array_agg(character_id) from public.owned_characters where user_id = auth.uid()), '{}'),
    'featured', public.featured_now(),
    'pending', (select count(*) from public.unlock_picks where user_id = auth.uid() and status = 'pending'));
$$;
revoke execute on function public.my_characters() from public, anon;
grant execute on function public.my_characters() to authenticated;

/**
 * Your oldest waiting pick: up to 3 random players you don't have (Common to Elite). The same offer comes back
 * until you choose, so reloading can't reroll it. Empty if there's nobody to offer yet.
 */
create or replace function public.offer_pick() returns text[] language plpgsql security definer set search_path = '' as $$
declare pk record; ids text[];
begin
  select * into pk from public.unlock_picks where user_id = auth.uid() and status = 'pending' order by tier limit 1 for update;
  if not found then return '{}'; end if;
  if cardinality(pk.offered) > 0 then return pk.offered; end if;
  select coalesce(array_agg(id), '{}') into ids from (
    select c.id from public.characters c
    where c.enabled and c.id <> 'default_player' and c.rarity in ('common', 'rare', 'super_rare', 'epic', 'elite')
      and not exists (select 1 from public.owned_characters o where o.user_id = auth.uid() and o.character_id = c.id)
    order by random() limit 3) x;
  if cardinality(ids) > 0 then update public.unlock_picks set offered = ids where id = pk.id; end if;
  return ids;
end;
$$;
revoke execute on function public.offer_pick() from public, anon;
grant execute on function public.offer_pick() to authenticated;

create or replace function public.choose_pick(p_character text) returns text language plpgsql security definer set search_path = '' as $$
declare pk record;
begin
  select * into pk from public.unlock_picks where user_id = auth.uid() and status = 'pending' order by tier limit 1 for update;
  if not found or not (p_character = any(pk.offered)) then return null; end if;
  insert into public.owned_characters (user_id, character_id, source) values (auth.uid(), p_character, 'pick') on conflict do nothing;
  update public.unlock_picks set status = 'chosen', chosen = p_character where id = pk.id;
  return p_character;
end;
$$;
revoke execute on function public.choose_pick(text) from public, anon;
grant execute on function public.choose_pick(text) to authenticated;

-- ── Recording a rated result (room server only) ─────────────────────────────
/**
 * K 32 with the usual 400-divisor expectation, times a margin factor (0.9 for a close match up to 1.15 for a
 * whitewash, from the share of points the winner won; it never flips win and loss), times 0.75 for an Elo
 * friend-room match. Friend rooms count for at most 3 matches a day between the same two players.
 */
create or replace function public.record_result(p_winner uuid, p_loser uuid, p_score text, p_forfeit boolean,
  p_points_w int, p_points_l int, p_source text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  season int; rw int; rl int; wn text; ln text; tw int; tl int; expected float; share float;
  margin float; mult float; base float; change int; nw int; nl int; ntw int; ntl int; today int;
begin
  season := public.rollover_season();
  if p_source = 'friendly' then
    select count(*) into today from public.matches
    where source = 'friendly' and created_at > now() - interval '1 day'
      and ((winner = p_winner and loser = p_loser) or (winner = p_loser and loser = p_winner));
    if today >= 3 then return json_build_object('capped', true); end if;
  end if;
  select rating, username, rank_tier into rw, wn, tw from public.profiles where id = p_winner for update;
  select rating, username, rank_tier into rl, ln, tl from public.profiles where id = p_loser for update;
  if rw is null or rl is null then raise exception 'unknown player'; end if;
  expected := 1.0 / (1.0 + power(10.0, (rl - rw) / 400.0));
  share := case when p_points_w + p_points_l > 0 then p_points_w::float / (p_points_w + p_points_l) else 0.5 end;
  margin := 0.9 + 0.25 * least(1, greatest(0, (share - 0.5) / 0.5));
  mult := case when p_source = 'friendly' then 0.75 else 1 end;
  base := 32 * (1 - expected);
  change := greatest(1, round(base * margin * mult));
  nw := rw + change;
  nl := greatest(100, rl - change);
  ntw := public.tier_after(nw, coalesce(tw, public.tier_of(rw)));
  ntl := public.tier_after(nl, coalesce(tl, public.tier_of(rl)));
  update public.profiles set rating = nw, wins = wins + 1, rated_games = rated_games + 1, rank_tier = ntw,
    peak_tier = greatest(coalesce(peak_tier, 0), ntw), peak_rating = greatest(coalesce(peak_rating, 0), nw),
    season_peak_tier = greatest(coalesce(season_peak_tier, 0), ntw) where id = p_winner;
  update public.profiles set rating = nl, losses = losses + 1, rated_games = rated_games + 1, rank_tier = ntl where id = p_loser;
  perform public.grant_tier_picks(p_winner, ntw);
  insert into public.matches (winner, loser, winner_name, loser_name, score, winner_change, loser_change, forfeit, season_id, source)
    values (p_winner, p_loser, wn, ln, p_score, change, -(rl - nl), p_forfeit, season, p_source);
  insert into public.rating_events (user_id, season_id, source, delta, rating_after, opponent) values
    (p_winner, season, p_source, change, nw, p_loser), (p_loser, season, p_source, -(rl - nl), nl, p_winner);
  return json_build_object('winner_rating', nw, 'loser_rating', nl, 'change', change, 'loser_change', rl - nl,
    'base', round(base::numeric, 1), 'margin', round(margin::numeric, 2), 'mult', mult,
    'winner_tier', ntw, 'loser_tier', ntl, 'winner_was', tw, 'loser_was', tl, 'capped', false);
end;
$$;
revoke execute on function public.record_result(uuid, uuid, text, boolean, int, int, text) from public, anon, authenticated;
grant execute on function public.record_result(uuid, uuid, text, boolean, int, int, text) to service_role;

-- ── What the game shows you ─────────────────────────────────────────────────
create or replace function public.my_rank()
returns table (rating int, tier int, peak_tier int, peak_rating int, season int, season_end timestamptz, title text, frame text, matches int)
language plpgsql security definer set search_path = '' as $$
declare s int;
begin
  s := public.rollover_season();
  return query
    select p.rating, coalesce(p.rank_tier, public.tier_of(p.rating)), coalesce(p.peak_tier, 0), coalesce(p.peak_rating, p.rating),
      s, (select ends_at from public.seasons where id = s),
      (select r.title from public.season_rewards r where r.user_id = p.id order by r.season_id desc limit 1),
      (select r.frame from public.season_rewards r where r.user_id = p.id order by r.season_id desc limit 1),
      p.rated_games
    from public.profiles p where p.id = auth.uid();
end;
$$;
revoke execute on function public.my_rank() from public, anon;
grant execute on function public.my_rank() to authenticated;

create or replace function public.my_rating_history()
returns table (delta int, rating_after int, source text, created_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select delta, rating_after, source, created_at from (
    select * from public.rating_events where user_id = auth.uid() order by created_at desc limit 30) x
  order by created_at;
$$;
revoke execute on function public.my_rating_history() from public, anon;
grant execute on function public.my_rating_history() to authenticated;

/** The rating leaderboard is this season's: players with a rated match this season (everyone, until anyone has one). */
create or replace function public.leaderboard()
returns table (username text, rating int, wins int, losses int)
language sql security definer set search_path = '' stable as $$
  with s as (select max(id) as id from public.seasons where starts_at <= now()),
  active as (select distinct user_id from public.rating_events where season_id = (select id from s))
  select p.username, p.rating, p.wins, p.losses from public.profiles p
  where p.wins + p.losses > 0 and (not exists (select 1 from active) or p.id in (select user_id from active))
  order by p.rating desc, p.wins desc limit 50;
$$;
grant execute on function public.leaderboard() to anon, authenticated;

-- ── Disputed results ────────────────────────────────────────────────────────
create table if not exists public.disputes (
  id bigint generated always as identity primary key,
  room text not null,
  host uuid references public.profiles on delete set null,
  guest uuid references public.profiles on delete set null,
  host_score text not null,
  guest_score text not null,
  created_at timestamptz not null default now()
);
alter table public.disputes enable row level security;
revoke all on public.disputes from anon, authenticated;

create or replace function public.log_dispute(p_room text, p_host uuid, p_guest uuid, p_host_score text, p_guest_score text) returns void
language sql security definer set search_path = '' as $$
  insert into public.disputes (room, host, guest, host_score, guest_score) values (p_room, p_host, p_guest, p_host_score, p_guest_score);
$$;
revoke execute on function public.log_dispute(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_dispute(text, uuid, uuid, text, text) to service_role;
