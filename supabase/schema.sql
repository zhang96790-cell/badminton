-- Skyline Smash: player accounts.
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
declare
  name text := lower(new.raw_user_meta_data ->> 'username');
begin
  -- Same blocked words as the game (shared/names.ts), checked with non-letters removed.
  if regexp_replace(name, '[^a-z]', '', 'g') ~ '(fuck|shit|cunt|bitch|pussy|penis|vagina|porn|nigg|fag|retard|nazi|hitler|whore|slut|wank|twat|bastard|asshole|killyourself)' then
    raise exception 'username not allowed';
  end if;
  insert into public.profiles (id, username) values (new.id, name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_player();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.1: ratings, friends, invites and match history
-- ═══════════════════════════════════════════════════════════════════════════

-- Rating (Elo, everyone starts at 1000), record and when the player was last online.
-- Players can't edit these: only the settings column is granted for update above.
alter table public.profiles add column if not exists rating int not null default 1000;
alter table public.profiles add column if not exists wins int not null default 0;
alter table public.profiles add column if not exists losses int not null default 0;
alter table public.profiles add column if not exists last_seen timestamptz;

-- "I'm online": the game calls this every minute while it's open.
create or replace function public.heartbeat()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set last_seen = now() where id = auth.uid();
$$;
revoke execute on function public.heartbeat() from public, anon;
grant execute on function public.heartbeat() to authenticated;

-- Top 50 by rating (only players who have played a ranked match). Usernames and ratings only.
create or replace function public.leaderboard()
returns table (username text, rating int, wins int, losses int)
language sql security definer set search_path = '' stable as $$
  select username, rating, wins, losses from public.profiles
  where wins + losses > 0 order by rating desc, wins desc limit 50;
$$;
grant execute on function public.leaderboard() to anon, authenticated;

-- My own rating and record.
create or replace function public.my_stats()
returns table (username text, rating int, wins int, losses int)
language sql security definer set search_path = '' stable as $$
  select username, rating, wins, losses from public.profiles where id = auth.uid();
$$;
revoke execute on function public.my_stats() from public, anon;
grant execute on function public.my_stats() to authenticated;

-- Friends: a request from one player to another, accepted by the other.
create table if not exists public.friendships (
  requester uuid not null references public.profiles on delete cascade,
  addressee uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
alter table public.friendships enable row level security;
drop policy if exists "Players see their own friendships" on public.friendships;
create policy "Players see their own friendships" on public.friendships
  for select using (auth.uid() in (requester, addressee));
-- No direct writes: everything goes through the functions below.
revoke insert, update, delete on public.friendships from anon, authenticated;

create or replace function public.send_friend_request(target text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them uuid;
begin
  if me is null then raise exception 'not logged in'; end if;
  select id into them from public.profiles where username = lower(target);
  if them is null then return 'no_such_player'; end if;
  if them = me then return 'self'; end if;
  if exists (select 1 from public.friendships where requester = me and addressee = them)
     or exists (select 1 from public.friendships where requester = them and addressee = me and status = 'accepted') then
    return 'already';
  end if;
  -- They already asked you: that's a yes.
  if exists (select 1 from public.friendships where requester = them and addressee = me) then
    update public.friendships set status = 'accepted' where requester = them and addressee = me;
    return 'accepted';
  end if;
  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 30 then
    return 'too_many';
  end if;
  insert into public.friendships (requester, addressee) values (me, them);
  return 'sent';
end;
$$;

create or replace function public.respond_friend_request(other uuid, accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if accept then
    update public.friendships set status = 'accepted' where requester = other and addressee = auth.uid();
  else
    delete from public.friendships where requester = other and addressee = auth.uid();
  end if;
end;
$$;

-- Unfriend, or cancel a request you sent.
create or replace function public.remove_friend(other uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friendships
  where (requester = auth.uid() and addressee = other) or (requester = other and addressee = auth.uid());
$$;

-- Everyone in my friends list, with whether they're online (seen in the last 2 minutes).
-- direction: 'friend', 'incoming' (they asked me) or 'outgoing' (I asked them).
create or replace function public.friends_list()
returns table (id uuid, username text, rating int, online boolean, direction text)
language sql security definer set search_path = '' stable as $$
  select p.id, p.username, p.rating,
         coalesce(p.last_seen > now() - interval '2 minutes', false),
         case when f.status = 'accepted' then 'friend' when f.requester = auth.uid() then 'outgoing' else 'incoming' end
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  order by (f.status = 'accepted') desc, p.username;
$$;

revoke execute on function public.send_friend_request(text) from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.friends_list() from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.friends_list() to authenticated;

-- Invites: "come and play in my room". Only between friends; they expire after 2 minutes.
create table if not exists public.invites (
  id bigint generated always as identity primary key,
  from_id uuid not null references public.profiles on delete cascade,
  to_id uuid not null references public.profiles on delete cascade,
  room text not null check (room ~ '^[A-HJ-NP-Z2-9]{5}$'),
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
drop policy if exists "Players see invites to or from them" on public.invites;
create policy "Players see invites to or from them" on public.invites
  for select using (auth.uid() in (from_id, to_id));
revoke insert, update, delete on public.invites from anon, authenticated;

create or replace function public.send_invite(friend uuid, room text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.friendships
                 where status = 'accepted' and ((requester = auth.uid() and addressee = friend) or (requester = friend and addressee = auth.uid()))) then
    return 'not_friends';
  end if;
  delete from public.invites where from_id = auth.uid() and to_id = friend;
  insert into public.invites (from_id, to_id, room) values (auth.uid(), friend, room);
  return 'sent';
end;
$$;

create or replace function public.my_invites()
returns table (id bigint, from_name text, room text, created_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select i.id, p.username, i.room, i.created_at from public.invites i
  join public.profiles p on p.id = i.from_id
  where i.to_id = auth.uid() and i.created_at > now() - interval '2 minutes'
  order by i.created_at desc;
$$;

create or replace function public.dismiss_invite(invite bigint)
returns void language sql security definer set search_path = '' as $$
  delete from public.invites where id = invite and to_id = auth.uid();
$$;

revoke execute on function public.send_invite(uuid, text) from public, anon;
revoke execute on function public.my_invites() from public, anon;
revoke execute on function public.dismiss_invite(bigint) from public, anon;
grant execute on function public.send_invite(uuid, text) to authenticated;
grant execute on function public.my_invites() to authenticated;
grant execute on function public.dismiss_invite(bigint) to authenticated;

-- Ranked match history. Written only by the room server (record_match below).
create table if not exists public.matches (
  id bigint generated always as identity primary key,
  winner uuid references public.profiles on delete set null,
  loser uuid references public.profiles on delete set null,
  winner_name text not null,
  loser_name text not null,
  score text not null,
  winner_change int not null,
  loser_change int not null,
  forfeit boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.matches enable row level security;
drop policy if exists "Players see their own matches" on public.matches;
create policy "Players see their own matches" on public.matches
  for select using (auth.uid() in (winner, loser));
revoke insert, update, delete on public.matches from anon, authenticated;

-- My last 20 ranked matches, from my side.
create or replace function public.my_matches()
returns table (opponent text, won boolean, score text, change int, forfeit boolean, created_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select case when winner = auth.uid() then loser_name else winner_name end,
         winner = auth.uid(),
         score,
         case when winner = auth.uid() then winner_change else loser_change end,
         forfeit, created_at
  from public.matches where auth.uid() in (winner, loser)
  order by created_at desc limit 20;
$$;
revoke execute on function public.my_matches() from public, anon;
grant execute on function public.my_matches() to authenticated;

-- Record a ranked result: Elo with K = 32, both players' ratings and records updated together.
-- Only the room server can call this (with the project's secret key).
create or replace function public.record_match(p_winner uuid, p_loser uuid, p_score text, p_forfeit boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  rw int; rl int; wn text; ln text; expected float; change int;
begin
  select rating, username into rw, wn from public.profiles where id = p_winner for update;
  select rating, username into rl, ln from public.profiles where id = p_loser for update;
  if rw is null or rl is null then raise exception 'unknown player'; end if;
  expected := 1.0 / (1.0 + power(10.0, (rl - rw) / 400.0));
  change := greatest(1, round(32 * (1 - expected)));
  update public.profiles set rating = rating + change, wins = wins + 1 where id = p_winner;
  update public.profiles set rating = greatest(100, rating - change), losses = losses + 1 where id = p_loser;
  insert into public.matches (winner, loser, winner_name, loser_name, score, winner_change, loser_change, forfeit)
  values (p_winner, p_loser, wn, ln, p_score, change, -change, p_forfeit);
  return json_build_object('winner_rating', rw + change, 'loser_rating', greatest(100, rl - change), 'change', change);
end;
$$;
revoke execute on function public.record_match(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.record_match(uuid, uuid, text, boolean) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2.2: career stats (fastest smash, longest rally, streaks, totals)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists career jsonb not null default '{}'::jsonb;

-- Add one finished match to your career. Keys starting max_ keep the best, now_ replace, the rest add up
-- (same rule as src/career.ts). Values outside sensible limits are ignored.
create or replace function public.add_career(delta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cur jsonb;
  res jsonb;
  k text;
  v jsonb;
  n numeric;
begin
  select career into cur from public.profiles where id = auth.uid() for update;
  if cur is null then raise exception 'not logged in'; end if;
  res := cur;
  for k, v in select * from jsonb_each(delta) loop
    if jsonb_typeof(v) <> 'number' or k !~ '^[a-z_]{1,32}$' then continue; end if;
    n := (v #>> '{}')::numeric;
    -- One match can't add more than this: a match is at most a few hundred points.
    if n < 0 or n > 20000 or (k = 'max_smash' and n > 650) then continue; end if;
    if k like 'max\_%' then
      res := jsonb_set(res, array[k], to_jsonb(greatest(coalesce((cur ->> k)::numeric, 0), n)));
    elsif k like 'now\_%' then
      res := jsonb_set(res, array[k], to_jsonb(n));
    else
      res := jsonb_set(res, array[k], to_jsonb(coalesce((cur ->> k)::numeric, 0) + n));
    end if;
  end loop;
  update public.profiles set career = res where id = auth.uid();
  return res;
end;
$$;

create or replace function public.my_career()
returns jsonb language sql security definer set search_path = '' stable as $$
  select career from public.profiles where id = auth.uid();
$$;

revoke execute on function public.add_career(jsonb) from public, anon;
revoke execute on function public.my_career() from public, anon;
grant execute on function public.add_career(jsonb) to authenticated;
grant execute on function public.my_career() to authenticated;
