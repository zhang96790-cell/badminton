-- Skyline Smash 4.4: feedback and bug reports, game analytics for admins, and achievement rarity.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Safe to run again.

-- ── Feedback and bug reports ─────────────────────────────────────────────────
-- Anyone can send one (logged in or not) through send_feedback(); only admins can read them.
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete set null,
  username text,
  kind text not null check (kind in ('idea', 'bug', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  log text check (log is null or char_length(log) <= 12000),
  version text check (version is null or char_length(version) <= 16),
  page text check (page is null or char_length(page) <= 200),
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists feedback_recent on public.feedback (created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

create or replace function public.send_feedback(p_kind text, p_message text, p_log text, p_version text, p_page text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if p_kind not in ('idea', 'bug', 'other') or coalesce(char_length(trim(p_message)), 0) = 0 then return false; end if;
  -- Spam guard: at most 8 an hour per account, and 60 an hour from everyone not logged in.
  if uid is not null and (select count(*) from public.feedback where user_id = uid and created_at > now() - interval '1 hour') >= 8 then return false; end if;
  if uid is null and (select count(*) from public.feedback where user_id is null and created_at > now() - interval '1 hour') >= 60 then return false; end if;
  insert into public.feedback (user_id, username, kind, message, log, version, page)
  values (uid, (select username from public.profiles where id = uid), p_kind, left(trim(p_message), 2000), left(p_log, 12000), left(p_version, 16), left(p_page, 200));
  return true;
end $$;
grant execute on function public.send_feedback(text, text, text, text, text) to anon, authenticated;

create or replace function public.admin_feedback(p_limit int default 100)
returns json language plpgsql security definer set search_path = '' stable as $$
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  return (select coalesce(json_agg(f), '[]'::json) from (
    select id, username, kind, message, log, version, page, done, created_at from public.feedback
    order by done, created_at desc limit least(greatest(p_limit, 1), 300)) f);
end $$;
grant execute on function public.admin_feedback(int) to authenticated;

create or replace function public.admin_feedback_done(p_id bigint, p_done boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  update public.feedback set done = p_done where id = p_id;
  return found;
end $$;
grant execute on function public.admin_feedback_done(bigint, boolean) to authenticated;

-- ── Game analytics ───────────────────────────────────────────────────────────
-- The game logs when a match starts, finishes or is quit (mode, CPU level, score), nothing personal.
create table if not exists public.game_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete set null,
  kind text not null check (kind in ('start', 'finish', 'quit')),
  mode text check (mode is null or char_length(mode) <= 16),
  level text check (level is null or char_length(level) <= 16),
  points int,
  seconds int,
  created_at timestamptz not null default now()
);
create index if not exists game_events_recent on public.game_events (created_at desc);
alter table public.game_events enable row level security;
revoke all on public.game_events from anon, authenticated;

create or replace function public.log_game_event(p_kind text, p_mode text, p_level text, p_points int, p_seconds int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if p_kind not in ('start', 'finish', 'quit') then return; end if;
  -- At most 300 a day per account (and 3000 an hour from players not logged in).
  if uid is not null and (select count(*) from public.game_events where user_id = uid and created_at > now() - interval '1 day') >= 300 then return; end if;
  if uid is null and (select count(*) from public.game_events where user_id is null and created_at > now() - interval '1 hour') >= 3000 then return; end if;
  insert into public.game_events (user_id, kind, mode, level, points, seconds)
  values (uid, p_kind, left(p_mode, 16), left(p_level, 16), p_points, p_seconds);
end $$;
grant execute on function public.log_game_event(text, text, text, int, int) to anon, authenticated;

-- What the admin Analytics page shows: the last 30 days.
create or replace function public.admin_analytics()
returns json language plpgsql security definer set search_path = '' stable as $$
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  return json_build_object(
    'by_level', (select coalesce(json_agg(r order by r.started desc), '[]'::json) from (
      select level, count(*) filter (where kind = 'start') as started, count(*) filter (where kind = 'finish') as finished,
             count(*) filter (where kind = 'quit') as quit
      from public.game_events where created_at > now() - interval '30 days' and level is not null group by level) r),
    'by_mode', (select coalesce(json_agg(r order by r.started desc), '[]'::json) from (
      select mode, count(*) filter (where kind = 'start') as started, count(*) filter (where kind = 'finish') as finished,
             count(*) filter (where kind = 'quit') as quit
      from public.game_events where created_at > now() - interval '30 days' group by mode) r),
    -- When people quit: how many points had been played (buckets of 5).
    'quit_points', (select coalesce(json_agg(r order by r.bucket), '[]'::json) from (
      select (coalesce(points, 0) / 5) * 5 as bucket, count(*) as quits
      from public.game_events where kind = 'quit' and created_at > now() - interval '30 days' group by 1) r),
    'per_day', (select coalesce(json_agg(r order by r.day), '[]'::json) from (
      select date_trunc('day', created_at)::date as day, count(*) filter (where kind = 'start') as started
      from public.game_events where created_at > now() - interval '30 days' group by 1) r)
  );
end $$;
grant execute on function public.admin_analytics() to authenticated;

-- ── Achievement rarity ───────────────────────────────────────────────────────
-- For each achievement: the share of players who have played at least once that have it.
create or replace function public.achievement_rarity()
returns json language sql security definer set search_path = '' stable as $$
  with players as (select career from public.profiles where coalesce((career ->> 'matches')::int, 0) > 0),
  total as (select greatest(count(*), 1) as n from players),
  keys as (select k from players, jsonb_object_keys(career) k where k like 'max\_ach\_%' and (career ->> k)::numeric > 0)
  select coalesce(json_object_agg(substr(k, 9), round(100.0 * c / (select n from total), 1)), '{}'::json)
  from (select k, count(*) as c from keys group by k) x;
$$;
grant execute on function public.achievement_rarity() to anon, authenticated;
