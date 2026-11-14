// Development only (never in the built game): a pretend account server for career mode, kept in this
// browser, so every career screen can be tried without logging in. Turn on with
// localStorage['badminton.fakeCareer'] = '1' on the dev server.
import { characterById, rosterFor } from '../../shared/characters';

const K = 'badminton.fake.';
const get = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(K + k) ?? 'null') ?? d; } catch { return d; } };
const put = (k: string, v: unknown) => localStorage.setItem(K + k, JSON.stringify(v));

export const fakeOn = () => import.meta.env.DEV && localStorage.getItem('badminton.fakeCareer') === '1';
export const fakeAccount = { id: 'dev-player', username: 'dev_player' };
export const fakeOwned = () => new Set<string>(['default_player', ...get<string[]>('owned', [])]);

export function fakeModule() {
  const own = (id: string) => put('owned', [...new Set([...get<string[]>('owned', []), id])]);
  const day = () => new Date().toISOString().slice(0, 10);
  const boss = () => rosterFor('3.0').filter((c) => c.rarity === 'rare')[new Date().getUTCDate() % 50].id;
  return {
    careerGet: async () => get<null | { rev: number; data_version: number; state: unknown; updated_at: string }>('save', null),
    careerPut: async (expected: number, dv: number, state: unknown) => {
      const cur = get<{ rev: number; state: unknown; updated_at: string } | null>('save', null);
      if (cur && expected !== -1 && cur.rev !== expected) return { ok: false as const, conflict: true as const, rev: cur.rev, state: cur.state, updated_at: cur.updated_at };
      const rev = (cur?.rev ?? 0) + 1;
      put('save', { rev, data_version: dv, state, updated_at: new Date().toISOString() });
      return { ok: true as const, rev };
    },
    careerStarter: async (id: string) => { if (get('starter', false)) return null; put('starter', true); own(id); return id; },
    offerCreate: async (_t: string, _tier: string, field: string[]) => {
      const owned = fakeOwned();
      const c = field.filter((x) => !owned.has(x) && characterById(x).id === x).sort(() => Math.random() - 0.5).slice(0, 3);
      const o = { id: Date.now(), candidates: c, rerolled: false };
      put('offer', { ...o, field });
      return o;
    },
    offerReroll: async (_id: number) => { const o = get<{ field: string[]; candidates: string[] } | null>('offer', null); if (!o) return { ok: false }; const c = o.field.filter((x) => !o.candidates.includes(x)).slice(0, 3); put('offer', { ...o, candidates: c }); return { ok: true, candidates: c }; },
    offerChoose: async (_id: number, ch: string | null) => { if (ch) own(ch); put('offer', null); return ch; },
    dailyGet: async () => ({ challenge: { day: day(), opponent: boss(), handicaps: ['no_drop', 'start_behind'], behind: 3, difficulty: 2, reward: 8, next_at: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString() }, claimed: get('claimed', '') === day(), reward_got: get('claimed', '') === day() ? 8 : null, season_total: 0, season_cap: 75 }),
    dailyStart: async () => ({ ok: true, token: 'dev', challenge: (await fakeModule().dailyGet()).challenge }),
    dailyClaim: async () => { put('claimed', day()); return { ok: true, reward: 8, rating: 1008, full_reward: 8, season_total: 8 }; },
  };
}
