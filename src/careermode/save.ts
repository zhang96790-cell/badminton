// Career saves: the account server is the real copy; a local copy covers short outages. Each save says which
// revision it came from, so a save from a stale copy (another device) is caught and the player chooses.
import { CAREER_CFG } from './config';
import { migrate, type CareerState } from './state';

type Account = typeof import('../account');
const localKey = (userId: string) => `badminton.career.${userId}`;

export interface Loaded { state: CareerState | null; rev: number; offline: boolean }
export type Conflict = { mine: CareerState; theirs: CareerState; theirRev: number; theirTime: string };

export class CareerSaves {
  rev = 0;
  /** A save that couldn't reach the server, waiting to be sent. */
  private unsent = false;
  constructor(private acc: Account, private userId: string) {}

  private cache(state: CareerState | null, rev: number, unsent: boolean) {
    try {
      if (state) localStorage.setItem(localKey(this.userId), JSON.stringify({ rev, unsent, state }));
      else localStorage.removeItem(localKey(this.userId));
    } catch { /* storage blocked */ }
  }
  private cached(): { rev: number; unsent: boolean; state: unknown } | null {
    try { return JSON.parse(localStorage.getItem(localKey(this.userId)) ?? 'null'); } catch { return null; }
  }

  async load(): Promise<Loaded & { conflict?: Conflict }> {
    const local = this.cached();
    const remote = await this.acc.careerGet().catch(() => undefined);
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
      if (mine) return { state: theirs, rev: remote.rev, offline: false, conflict: { mine, theirs, theirRev: remote.rev, theirTime: remote.updated_at } };
    }
    this.rev = remote.rev;
    this.cache(theirs, remote.rev, false);
    return { state: theirs, rev: remote.rev, offline: false };
  }

  /** Save. Returns 'ok', 'offline' (kept locally, sent later) or a conflict to settle. */
  async save(state: CareerState): Promise<'ok' | 'offline' | Conflict> {
    const r = await this.acc.careerPut(this.rev, CAREER_CFG.dataVersion, state).catch(() => null);
    if (!r) { this.unsent = true; this.cache(state, this.rev, true); return 'offline'; }
    if (r.ok) { this.rev = r.rev; this.unsent = false; this.cache(state, r.rev, false); return 'ok'; }
    const theirs = migrate(r.state);
    if (!theirs) { return this.overwrite(state); }
    return { mine: state, theirs, theirRev: r.rev, theirTime: r.updated_at };
  }

  /** Keep this copy (replacing the other device's). */
  async overwrite(state: CareerState): Promise<'ok' | 'offline'> {
    const r = await this.acc.careerPut(-1, CAREER_CFG.dataVersion, state).catch(() => null);
    if (!r || !r.ok) { this.unsent = true; this.cache(state, this.rev, true); return 'offline'; }
    this.rev = r.rev; this.unsent = false; this.cache(state, r.rev, false);
    return 'ok';
  }

  /** Keep the other device's copy. */
  adopt(theirs: CareerState, rev: number) { this.rev = rev; this.unsent = false; this.cache(theirs, rev, false); }

  get pending() { return this.unsent; }
}
