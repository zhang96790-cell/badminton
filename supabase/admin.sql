-- Skyline Smash: admin overview (who's playing). Run after schema.sql.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Safe to run again.

-- Who is an admin. Row level security with no policies: nobody can read or change this table from the
-- game, only from the Supabase dashboard (or SQL editor), so making yourself an admin needs the dashboard.
create table if not exists public.admins (
  id uuid primary key references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- Is the logged-in player an admin? (The game only shows its Admin button if so.)
create or replace function public.am_i_admin()
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.admins where id = auth.uid());
$$;

-- Everything the Admin panel shows. Refuses anyone who isn't an admin.
create or replace function public.admin_overview()
returns json language plpgsql security definer set search_path = '' stable as $$
declare
  res json;
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  select json_build_object(
    'players', (select count(*) from public.profiles),
    'signups_today', (select count(*) from public.profiles where created_at > now() - interval '1 day'),
    'signups_week', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'online_now', (select count(*) from public.profiles where last_seen > now() - interval '2 minutes'),
    'active_today', (select count(*) from public.profiles where last_seen > now() - interval '1 day'),
    'active_week', (select count(*) from public.profiles where last_seen > now() - interval '7 days'),
    'ranked_today', (select count(*) from public.matches where created_at > now() - interval '1 day'),
    'ranked_total', (select count(*) from public.matches),
    'matches_played', (select coalesce(sum((career ->> 'matches')::numeric), 0) from public.profiles),
    'hours_played', (select round(coalesce(sum((career ->> 'seconds')::numeric), 0) / 3600, 1) from public.profiles),
    'recent', (select coalesce(json_agg(r), '[]'::json) from (
      select username, created_at, last_seen, rating, wins, losses,
             coalesce((career ->> 'matches')::int, 0) as matches,
             coalesce(last_seen > now() - interval '2 minutes', false) as online
      from public.profiles order by coalesce(last_seen, created_at) desc limit 30) r)
  ) into res;
  return res;
end;
$$;

revoke execute on function public.am_i_admin() from public, anon;
revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.am_i_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
