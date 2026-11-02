// Player accounts (Supabase). Players only ever see a username and passcode; behind the scenes the
// username becomes an internal email address, because Supabase signs people in by email.
// Loaded on demand so the game starts without it.
import { createClient, type AuthError } from '@supabase/supabase-js';

// Both values are meant to be public: what each player may do is enforced by the database's row level security.
const SUPABASE_URL = 'https://xyadhxnoqdanzbppgxni.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Js004F487ToqbD1Cz6t1QQ_ZqpcIyjl';
const EMAIL_DOMAIN = 'players.airphysicsrevision.online';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'badminton.account' },
});

export interface Account { id: string; username: string }
export type Result = { ok: true; account: Account } | { ok: false; error: string };

const emailFor = (username: string) => `${username}@${EMAIL_DOMAIN}`;
const usernameOf = (email: string | undefined) => (email ?? '').split('@')[0];

export const normalise = (username: string) => username.trim().toLowerCase();

/** Why a username / passcode can't be used (null if fine). Matches the database's own check. */
export function problemWith(username: string, passcode: string): string | null {
  if (!/^[a-z0-9_]{3,16}$/.test(username)) return 'Usernames are 3–16 letters, numbers or underscores';
  if (passcode.length < 6) return 'Passcodes need at least 6 characters';
  return null;
}

/** Plain-English version of whatever Supabase said went wrong. */
function explain(e: AuthError | Error | null): string {
  const m = e?.message ?? '';
  if (/already registered|already exists/i.test(m)) return 'That username is taken';
  if (/invalid login credentials/i.test(m)) return 'Wrong username or passcode';
  if (/password should be|weak password/i.test(m)) return 'Pick a longer passcode (at least 6 characters)';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again';
  if (/fetch|network|failed to/i.test(m)) return 'Can’t reach the account server. Check your connection';
  if (/database error saving new user/i.test(m)) return 'That username can’t be used';
  return m || 'Something went wrong. Try again';
}

export async function current(): Promise<Account | null> {
  const { data } = await supabase.auth.getSession();
  const u = data.session?.user;
  return u ? { id: u.id, username: usernameOf(u.email) } : null;
}

export async function signUp(username: string, passcode: string): Promise<Result> {
  const { data, error } = await supabase.auth.signUp({ email: emailFor(username), password: passcode, options: { data: { username } } });
  if (error) return { ok: false, error: explain(error) };
  // No session means the project still wants email confirmation, which usernames can't do.
  if (!data.session || !data.user) return { ok: false, error: 'Sign-up isn’t switched on yet (email confirmation needs turning off)' };
  return { ok: true, account: { id: data.user.id, username } };
}

export async function logIn(username: string, passcode: string): Promise<Result> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: emailFor(username), password: passcode });
  if (error || !data.user) return { ok: false, error: explain(error) };
  return { ok: true, account: { id: data.user.id, username } };
}

export async function logOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function changePasscode(passcode: string): Promise<string | null> {
  const { error } = await supabase.auth.updateUser({ password: passcode });
  return error ? explain(error) : null;
}

/** The settings saved to this account, or null if none yet (or the profiles table isn't set up). */
export async function loadSettings(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('profiles').select('settings').eq('id', id).maybeSingle();
  if (error || !data) return null;
  const s = data.settings as Record<string, unknown>;
  return s && Object.keys(s).length ? s : null;
}

export async function saveSettings(id: string, settings: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from('profiles').update({ settings, updated_at: new Date().toISOString() }).eq('id', id);
  return !error;
}
