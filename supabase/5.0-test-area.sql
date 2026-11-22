-- Skyline Smash 5.0 test area: a hidden v5 area for a few testers before the official launch.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Safe to run again.
--
-- CHANGE THE CODE: edit the line marked "the test code" below before running (or run the update at the
-- bottom later). Anyone logged in who types the code in the game becomes a tester.

-- ── Settings: the test code, and whether v5 is open to everyone (the launch switch) ──
create table if not exists public.v5_settings (
  id int primary key default 1 check (id = 1),
  code text not null,
  open_to_all boolean not null default false
);
alter table public.v5_settings enable row level security;
revoke all on public.v5_settings from anon, authenticated;
insert into public.v5_settings (id, code) values (1, 'skyline-v5-test') -- the test code
  on conflict (id) do nothing;

-- ── Testers ──
create table if not exists public.v5_testers (
  user_id uuid primary key references public.profiles on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.v5_testers enable row level security;
revoke all on public.v5_testers from anon, authenticated;

-- Can the logged-in player use v5? (A tester, or v5 is open to everyone.)
create or replace function public.v5_status()
returns json language sql security definer set search_path = '' stable as $$
  select json_build_object(
    'tester', exists (select 1 from public.v5_testers where user_id = auth.uid()),
    'open', coalesce((select open_to_all from public.v5_settings where id = 1), false));
$$;
grant execute on function public.v5_status() to anon, authenticated;

-- Type the code to become a tester. A few wrong tries per hour at most.
create table if not exists public.v5_code_tries (user_id uuid not null, at timestamptz not null default now());
alter table public.v5_code_tries enable row level security;
revoke all on public.v5_code_tries from anon, authenticated;
create or replace function public.v5_redeem(p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  if (select count(*) from public.v5_code_tries where user_id = auth.uid() and at > now() - interval '1 hour') >= 8 then return false; end if;
  insert into public.v5_code_tries (user_id) values (auth.uid());
  if not exists (select 1 from public.v5_settings where id = 1 and code = trim(p_code)) then return false; end if;
  insert into public.v5_testers (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end $$;
grant execute on function public.v5_redeem(text) to authenticated;

-- ── The v5 career save (separate from the normal career, so testing never touches it) ──
create table if not exists public.career_saves_v5 (
  user_id uuid primary key references public.profiles on delete cascade,
  data_version int not null default 1,
  rev int not null default 0,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.career_saves_v5 enable row level security;
revoke all on public.career_saves_v5 from anon, authenticated;

create or replace function public.v5_allowed() returns boolean language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.v5_testers where user_id = auth.uid()) or coalesce((select open_to_all from public.v5_settings where id = 1), false);
$$;

create or replace function public.career5_get() returns json language sql security definer set search_path = '' stable as $$
  select json_build_object('rev', rev, 'data_version', data_version, 'state', state, 'updated_at', updated_at)
  from public.career_saves_v5 where user_id = auth.uid() and public.v5_allowed();
$$;
revoke execute on function public.career5_get() from public, anon;
grant execute on function public.career5_get() to authenticated;

create or replace function public.career5_put(p_expected_rev int, p_data_version int, p_state jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare cur record;
begin
  if auth.uid() is null or not public.v5_allowed() then raise exception 'not a v5 tester'; end if;
  if octet_length(p_state::text) > 400000 then raise exception 'career save too big'; end if;
  select * into cur from public.career_saves_v5 where user_id = auth.uid() for update;
  if not found then
    insert into public.career_saves_v5 (user_id, data_version, rev, state) values (auth.uid(), p_data_version, 1, p_state);
    return json_build_object('ok', true, 'rev', 1);
  end if;
  if p_expected_rev <> -1 and cur.rev <> p_expected_rev then
    return json_build_object('ok', false, 'conflict', true, 'rev', cur.rev, 'state', cur.state, 'updated_at', cur.updated_at);
  end if;
  update public.career_saves_v5 set rev = cur.rev + 1, data_version = p_data_version, state = p_state, updated_at = now() where user_id = auth.uid();
  return json_build_object('ok', true, 'rev', cur.rev + 1);
end $$;
revoke execute on function public.career5_put(int, int, jsonb) from public, anon;
grant execute on function public.career5_put(int, int, jsonb) to authenticated;

-- The semi-fresh start reads your normal career once (to carry over squad, ranking and up to $25,000).
create or replace function public.career5_seed() returns json language sql security definer set search_path = '' stable as $$
  select state from public.career_saves where user_id = auth.uid() and public.v5_allowed();
$$;
revoke execute on function public.career5_seed() from public, anon;
grant execute on function public.career5_seed() to authenticated;

-- ── Admin: who's testing ──
create or replace function public.admin_v5_testers()
returns json language plpgsql security definer set search_path = '' stable as $$
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  return (select coalesce(json_agg(t order by t.added_at desc), '[]'::json) from (
    select p.username, v.added_at, exists (select 1 from public.career_saves_v5 c where c.user_id = v.user_id) as has_career
    from public.v5_testers v join public.profiles p on p.id = v.user_id) t);
end $$;
grant execute on function public.admin_v5_testers() to authenticated;

-- Later: change the code with   update public.v5_settings set code = 'new-code' where id = 1;
-- Launch day: open v5 to everyone with   update public.v5_settings set open_to_all = true where id = 1;
