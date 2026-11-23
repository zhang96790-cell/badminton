// Career saves: the account server is the real copy; a local copy covers short outages. Each save says which
// revision it came from, so a save from a stale copy (another device) is caught and the player chooses.
import { CAREER_CFG } from './config';
import { migrate, type CareerState } from './state';

type Account = typeof import('../account');
/** 5.0: the v5 test career is a separate save (its own server table and local copy). */
const localKey = (userId: string, slot = 'v4') => `badminton.career${slot === 'v5' ? '5' : ''}.${userId}`;

/** The same data gives the same text whatever order its keys are in (the server may reorder them). */
const same = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));

export interface Loaded { state: CareerState | null; rev: number; offline: boolean }
export type Conflict = { mine: CareerState; theirs: CareerState; theirRev: number; theirTime: string };

export class CareerSaves {
  rev = 0;
  /** A save that couldn't reach the server, waiting to be sent. */
  private unsent = false;
  /** 4.5: saves go one at a time (two at once both claimed the same revision, so the second looked like
   * another device's change). */
  private chain: Promise<unknown> = Promise.resolve();
  /** What we last sent: if the server's copy is exactly that (a reply lost on the way), it's ours, not another device's. */
  private lastSent = '';
  constructor(private acc: Account, private userId: string, private slot: 'v4' | 'v5' = 'v4') {}
  private get get() { return this.slot === 'v5' ? this.acc.career5Get : this.acc.careerGet; }
  private get put() { return this.slot === 'v5' ? this.acc.career5Put : this.acc.careerPut; }

  private cache(state: CareerState | null, rev: number, unsent: boolean) {
    try {
      if (state) localStorage.setItem(localKey(this.userId, this.slot), JSON.stringify({ rev, unsent, state }));
      else localStorage.removeItem(localKey(this.userId, this.slot));
    } catch { /* storage blocked */ }
  }
  private cached(): { rev: number; unsent: boolean; state: unknown } | null {
    try { return JSON.parse(localStorage.getItem(localKey(this.userId, this.slot)) ?? 'null'); } catch { return null; }
  }

  async load(): Promise<Loaded & { conflict?: Conflict }> {
    const local = this.cached();
    const remote = await this.get().catch(() => undefined);
    if (remote === undefined || (remote === null && local?.unsent)) {
      // Offline (or a save never reached the server): use the local copy.
      const st = migrate(local?.state);
      this.rev = local?.rev ?? 0;
      this.unsent = !!local?.unsent;
      return { state: st, rev: this.rev, offline: remote === undefined };
    }
    if (!remote) { this.rev = 0; this.cache(null, 0, false); return { state: null, rev: 0, offline: false }; }
    const theirs = migrate(remote.state);
    // A local save that never got through, made from the same revision: send it now.
    if (local?.unsent && local.rev === remote.rev) {
      this.rev = remote.rev;
      const mine = migrate(local.state);
      if (mine) { await this.save(mine); return { state: mine, rev: this.rev, offline: false }; }
    }
    if (local?.unsent && local.rev !== remote.rev && theirs) {
      const mine = migrate(local.state);
      this.rev = remote.rev;
      if (mine && same(mine) === same(theirs)) { this.cache(theirs, remote.rev, false); return { state: theirs, rev: remote.rev, offline: false }; }
      if (mine) return { state: theirs, rev: remote.rev, offline: false, conflict: { mine, theirs, theirRev: remote.rev, theirTime: remote.updated_at } };
    }
    this.rev = remote.rev;
    this.cache(theirs, remote.rev, false);
    return { state: theirs, rev: remote.rev, offline: false };
  }

  /** Save. Returns 'ok', 'offline' (kept locally, sent later) or a conflict to settle. */
  save(state: CareerState): Promise<'ok' | 'offline' | Conflict> {
    // A copy now, so later changes to the live state don't leak into a save that's waiting its turn.
    const snap = JSON.stringify(state);
    const run = this.chain.then(() => this.saveNow(JSON.parse(snap) as CareerState, snap));
    this.chain = run.catch(() => null);
    return run;
  }
  private async saveNow(state: CareerState, json: string): Promise<'ok' | 'offline' | Conflict> {
    const prevSent = this.lastSent;
    this.lastSent = same(state);
    void json;
    const r = await this.put(this.rev, CAREER_CFG.dataVersion, state).catch(() => null);
    if (!r) { this.unsent = true; this.cache(state, this.rev, true); return 'offline'; }
    if (r.ok) { this.rev = r.rev; this.unsent = false; this.cache(state, r.rev, false); return 'ok'; }
    const theirs = migrate(r.state);
    if (!theirs) { return this.overwrite(state); }
    // The server's copy is one we sent ourselves (its reply was lost, or an older save of ours landed late):
    // not another device, so catch up to its revision and save again.
    const theirJson = same(r.state);
    if (theirJson === this.lastSent || theirJson === prevSent || same(theirs) === same(state)) {
      this.rev = r.rev;
      const again = await this.put(this.rev, CAREER_CFG.dataVersion, state).catch(() => null);
      if (!again) { this.unsent = true; this.cache(state, this.rev, true); return 'offline'; }
      if (again.ok) { this.rev = again.rev; this.unsent = false; this.cache(state, again.rev, false); return 'ok'; }
    }
    return { mine: state, theirs, theirRev: r.rev, theirTime: r.updated_at };
  }

  /** Keep this copy (replacing the other device's). */
  async overwrite(state: CareerState): Promise<'ok' | 'offline'> {
    const r = await this.put(-1, CAREER_CFG.dataVersion, state).catch(() => null);
    if (!r || !r.ok) { this.unsent = true; this.cache(state, this.rev, true); return 'offline'; }
    this.rev = r.rev; this.unsent = false; this.cache(state, r.rev, false);
    return 'ok';
  }

  /** Keep the other device's copy. */
  adopt(theirs: CareerState, rev: number) { this.rev = rev; this.unsent = false; this.cache(theirs, rev, false); }

  get pending() { return this.unsent; }
}
