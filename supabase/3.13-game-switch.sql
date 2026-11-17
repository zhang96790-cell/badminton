-- Skyline Smash 3.13: the game switch. Admins can shut the whole game for maintenance, or block single players.
-- Run after admin.sql. Safe to run again.

create table if not exists public.app_flags (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security; -- no policies: only the functions below touch it

create table if not exists public.blocked_players (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.blocked_players enable row level security; -- no policies

-- What the game checks on start and every minute. p_was: a username this browser was blocked as before (so
-- logging out doesn't get round a block). Says only yes/no about you, never anything about anyone else.
create or replace function public.game_status(p_was text default null)
returns json language sql security definer set search_path = '' stable as $$
  select json_build_object(
    'maintenance', coalesce((select (value ->> 'on')::boolean from public.app_flags where key = 'maintenance'), false),
    'message', (select value ->> 'message' from public.app_flags where key = 'maintenance'),
    'admin', exists (select 1 from public.admins where id = auth.uid()),
    'blocked', exists (select 1 from public.blocked_players b where b.user_id = auth.uid()
                       or (p_was is not null and b.username = lower(p_was))),
    'reason', (select b.reason from public.blocked_players b where b.user_id = auth.uid()
               or (p_was is not null and b.username = lower(p_was)) limit 1)
  );
$$;
grant execute on function public.game_status(text) to anon, authenticated;

create or replace function public.admin_set_maintenance(p_on boolean, p_message text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  insert into public.app_flags (key, value, updated_at)
    values ('maintenance', json_build_object('on', p_on, 'message', nullif(trim(coalesce(p_message, '')), ''))::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

create or replace function public.admin_block(p_username text, p_block boolean, p_reason text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  select id into uid from public.profiles where username = lower(p_username);
  if uid is null then return false; end if;
  if uid = auth.uid() then raise exception 'you can''t block yourself'; end if;
  if p_block then
    insert into public.blocked_players (user_id, username, reason) values (uid, lower(p_username), nullif(trim(coalesce(p_reason, '')), ''))
      on conflict (user_id) do update set reason = excluded.reason;
  else
    delete from public.blocked_players where user_id = uid;
  end if;
  return true;
end;
$$;

create or replace function public.admin_blocked()
returns json language plpgsql security definer set search_path = '' stable as $$
begin
  if not exists (select 1 from public.admins where id = auth.uid()) then raise exception 'not an admin'; end if;
  return (select coalesce(json_agg(json_build_object('username', username, 'reason', reason, 'at', created_at) order by created_at desc), '[]'::json)
          from public.blocked_players);
end;
$$;

revoke execute on function public.admin_set_maintenance(boolean, text) from public, anon;
revoke execute on function public.admin_block(text, boolean, text) from public, anon;
revoke execute on function public.admin_blocked() from public, anon;
grant execute on function public.admin_set_maintenance(boolean, text) to authenticated;
grant execute on function public.admin_block(text, boolean, text) to authenticated;
grant execute on function public.admin_blocked() to authenticated;
