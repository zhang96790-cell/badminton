// Player accounts (Supabase). Players only ever see a username and passcode; behind the scenes the
// username becomes an internal email address, because Supabase signs people in by email.
// Loaded on demand so the game starts without it.
import { createClient, type AuthError } from '@supabase/supabase-js';
import { isOffensive } from '../shared/names';

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

/** What a typed username becomes: lowercase, spaces turned into underscores ("Barry Zhang" → "barry_zhang"). */
export const normalise = (username: string) => username.trim().toLowerCase().replace(/\s+/g, '_');

/** Why a username / passcode can't be used (null if fine). Matches the database's own check. */
export function problemWith(username: string, passcode: string): string | null {
  if (!/^[a-z0-9_]{3,16}$/.test(username)) return 'Usernames are 3–16 letters, numbers or underscores';
  if (isOffensive(username)) return 'That username isn’t allowed. Pick another';
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
  if (/database error saving new user/i.test(m)) return 'That username isn’t allowed. Pick another';
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

// ── 2.1: ranking, friends and invites ─────────────────────────────────────────

/** Your current login token (the quick-match server checks it to know who you are). */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * A login token that's good for a while yet: renewed first if it runs out within two minutes (a laptop
 * that slept, or a tab left in the background, can miss the automatic renewal). Null if it can't be renewed.
 */
export async function freshToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) return null;
  if ((s.expires_at ?? 0) * 1000 - Date.now() > 120_000) return s.access_token;
  const { data: r, error } = await supabase.auth.refreshSession();
  return error ? null : r.session?.access_token ?? null;
}

/** Called when the login ends without you logging out (it expired and couldn't be renewed). */
export function onLoggedOut(cb: () => void) {
  supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') cb(); });
}

export interface Stats { username: string; rating: number; wins: number; losses: number }
export interface MatchRow { opponent: string; won: boolean; score: string; change: number; forfeit: boolean; created_at: string }
export interface Friend { id: string; username: string; rating: number; online: boolean; direction: 'friend' | 'incoming' | 'outgoing' }
export interface Invite { id: number; from_name: string; room: string; created_at: string }

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) { console.warn(`${name}:`, error.message); return null; }
  return data as T;
}

export const myStats = async () => (await rpc<Stats[]>('my_stats'))?.[0] ?? null;
export const myMatches = async () => (await rpc<MatchRow[]>('my_matches')) ?? [];
export const leaderboard = async () => (await rpc<Stats[]>('leaderboard')) ?? [];
/** Top 50 for a career record, challenge stars or achievements (null if the database isn't set up for it yet). */
export const leaderboardStat = (stat: string) => rpc<{ username: string; value: number }[]>('leaderboard_stat', { stat });
export const friendsList = async () => (await rpc<Friend[]>('friends_list')) ?? [];
export const myInvites = async () => (await rpc<Invite[]>('my_invites')) ?? [];
export const heartbeat = () => rpc('heartbeat');
export const respondFriendRequest = (other: string, accept: boolean) => rpc('respond_friend_request', { other, accept });
export const removeFriend = (other: string) => rpc('remove_friend', { other });
export const dismissInvite = (invite: number) => rpc('dismiss_invite', { invite });

/** 'sent', 'accepted' (they'd already asked you), 'already', 'no_such_player', 'self', 'too_many', or null on error. */
export const sendFriendRequest = (target: string) => rpc<string>('send_friend_request', { target: normalise(target) });
/** 'sent' or 'not_friends' (or null on error). */
export const sendInvite = (friend: string, room: string) => rpc<string>('send_invite', { friend, room });

// ── Admin (accounts listed in the admins table, set from the Supabase dashboard) ──
export interface AdminPlayer { username: string; created_at: string; last_seen: string | null; rating: number; wins: number; losses: number; matches: number; online: boolean }
export interface AdminOverview {
  players: number; signups_today: number; signups_week: number; online_now: number; active_today: number; active_week: number;
  ranked_today: number; ranked_total: number; matches_played: number; hours_played: number; recent: AdminPlayer[];
}
export const amIAdmin = async () => (await rpc<boolean>('am_i_admin')) === true;
export const adminOverview = () => rpc<AdminOverview>('admin_overview');

// ── 2.2: career stats ─────────────────────────────────────────────────────────
export const myCareer = async () => (await rpc<Record<string, number>>('my_career')) ?? null;
export const addCareer = (delta: Record<string, number>) => rpc<Record<string, number>>('add_career', { delta });
