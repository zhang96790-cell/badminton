// Talking to the Supabase accounts database from the game server.
// Checking who a player is uses their own login token; recording a ranked result uses the
// project's secret key (a Cloudflare secret, never sent to players).

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE: string;
  /** Set with `wrangler secret put SUPABASE_SECRET`. Without it, ranked results can't be saved. */
  SUPABASE_SECRET?: string;
}

export interface Player { id: string; name: string; rating: number }

/** Who this login token belongs to, with their rating, or null if it isn't valid. */
export async function verifyPlayer(env: SupabaseEnv, token: string): Promise<Player | null> {
  if (!token || token.length > 4096) return null;
  const auth = { apikey: env.SUPABASE_PUBLISHABLE, Authorization: `Bearer ${token}` };
  const u = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: auth });
  if (!u.ok) return null;
  const user = (await u.json()) as { id?: string };
  if (!user.id) return null;
  const s = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/my_stats`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
  if (!s.ok) return null;
  const rows = (await s.json()) as { username: string; rating: number }[];
  return rows[0] ? { id: user.id, name: rows[0].username, rating: rows[0].rating } : null;
}

export interface RecordedResult { winner_rating: number; loser_rating: number; change: number }

/** Save a ranked result and update both ratings. Throws if the server can't. */
export async function recordMatch(env: SupabaseEnv, winner: string, loser: string, score: string, forfeit: boolean): Promise<RecordedResult> {
  const key = env.SUPABASE_SECRET;
  if (!key) throw new Error('SUPABASE_SECRET is not set');
  // New-style secret keys go in the apikey header; an older service_role key (a JWT) also needs Authorization.
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_match`, {
    method: 'POST', headers, body: JSON.stringify({ p_winner: winner, p_loser: loser, p_score: score, p_forfeit: forfeit }),
  });
  if (!r.ok) throw new Error(`record_match failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as RecordedResult;
}
