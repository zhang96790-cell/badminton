-- Skyline Smash: delete the two test accounts made while building the game (claude_test_1, claude_test_2).
-- Supabase → SQL Editor → New query → Run. Their profiles, friends and invites go with them; matches they
-- played stay in the other player's history with the name kept. Safe to run again.
delete from auth.users where email in ('claude_test_1@players.airphysicsrevision.online', 'claude_test_2@players.airphysicsrevision.online');
select count(*) as test_accounts_left from public.profiles where username in ('claude_test_1', 'claude_test_2');
