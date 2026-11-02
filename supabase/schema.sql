-- Badminton Games: player accounts.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Safe to run again.

-- One row per player: their username and their saved game settings (key binds, assists, match options).
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,16}$'),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row level security: a player can only read and change their own row.
alter table public.profiles enable row level security;

drop policy if exists "Players read their own profile" on public.profiles;
create policy "Players read their own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "Players update their own profile" on public.profiles;
create policy "Players update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Players can only change their settings, not their username (logging in depends on it).
revoke update on public.profiles from anon, authenticated;
grant update (settings, updated_at) on public.profiles to authenticated;

-- Create the profile automatically when someone signs up (the username comes from the sign-up form).
create or replace function public.handle_new_player()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_player();
