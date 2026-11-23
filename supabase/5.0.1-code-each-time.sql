-- Skyline Smash 5.0 test area: the code is now typed every time you go into v5, so only WRONG codes count
-- toward the limit of 8 tries an hour. Run after 5.0-test-area.sql. Safe to run again.
create or replace function public.v5_redeem(p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  if (select count(*) from public.v5_code_tries where user_id = auth.uid() and at > now() - interval '1 hour') >= 8 then return false; end if;
  if not exists (select 1 from public.v5_settings where id = 1 and code = trim(p_code)) then
    insert into public.v5_code_tries (user_id) values (auth.uid());
    return false;
  end if;
  insert into public.v5_testers (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end $$;
grant execute on function public.v5_redeem(text) to authenticated;
