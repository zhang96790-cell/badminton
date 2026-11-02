import type { V2 } from './math';
import type { Hand } from './shots';

export interface ShotStat { by: 0 | 1; /** Player id (doubles has four). */ pid: number; label: string; speedKmh: number; hand: Hand | 'serve'; landing: V2 | null }

export interface RallyStat {
  shots: number;
  winner: 0 | 1;
  /** Which side played the last shot, and which player. */
  hitter: 0 | 1;
  hitterPid: number;
  /** Last shot landed in untouched (winner) or went out / into the net (error). */
  kind: 'winner' | 'error' | 'delay';
  forced: boolean;
  lastLabel: string;
  lastHand: Hand | 'serve';
}

export interface PlayerSummary {
  points: number;
  winners: number;
  unforced: number;
  forced: number;
  smashes: number;
  topSmash: number;
  forehandWinners: number;
  backhandWinners: number;
  challengesWon: number;
  challengesMade: number;
  landings: V2[];
}

/** One player's line in the doubles breakdown. */
export interface IndividualSummary { shots: number; winners: number; errors: number; smashes: number; topSmash: number }

export class MatchStats {
  shots: ShotStat[] = [];
  rallies: RallyStat[] = [];
  challenges = [{ made: 0, won: 0 }, { made: 0, won: 0 }];
  /** Match time in real seconds, excluding pauses. */
  seconds = 0;
  private ended = false;

  tick(realDt: number) { if (!this.ended) this.seconds += realDt; }
  finish() { this.ended = true; }

  get longestRally(): number { return this.rallies.reduce((m, r) => Math.max(m, r.shots), 0); }

  /** An overturned challenge flips the last rally. */
  reviseLast(winner: 0 | 1, kind: 'winner' | 'error') {
    const r = this.rallies[this.rallies.length - 1];
    if (!r) return;
    r.winner = winner;
    r.kind = kind;
    r.forced = false;
  }

  /** Per-player numbers by stable player id (doubles). */
  individual(pid: number): IndividualSummary {
    const mine = this.shots.filter((s) => s.pid === pid && s.hand !== 'serve');
    const smashes = mine.filter((s) => /smash/i.test(s.label));
    return {
      shots: mine.length,
      winners: this.rallies.filter((r) => r.kind === 'winner' && r.hitterPid === pid).length,
      errors: this.rallies.filter((r) => r.kind === 'error' && r.hitterPid === pid).length,
      smashes: smashes.length,
      topSmash: smashes.reduce((m, s) => Math.max(m, s.speedKmh), 0),
    };
  }

  summary(i: 0 | 1): PlayerSummary {
    const mine = this.shots.filter((s) => s.by === i);
    const smashes = mine.filter((s) => /smash/i.test(s.label));
    const won = this.rallies.filter((r) => r.winner === i);
    const myWinners = this.rallies.filter((r) => r.kind === 'winner' && r.hitter === i);
    const myErrors = this.rallies.filter((r) => r.kind === 'error' && r.hitter === i);
    return {
      points: won.length,
      winners: myWinners.length,
      unforced: myErrors.filter((r) => !r.forced).length,
      forced: myErrors.filter((r) => r.forced).length,
      smashes: smashes.length,
      topSmash: smashes.reduce((m, s) => Math.max(m, s.speedKmh), 0),
      forehandWinners: myWinners.filter((r) => r.lastHand === 'forehand' || r.lastHand === 'round-the-head').length,
      backhandWinners: myWinners.filter((r) => r.lastHand === 'backhand').length,
      challengesWon: this.challenges[i].won,
      challengesMade: this.challenges[i].made,
      landings: mine.map((s) => s.landing).filter((l): l is V2 => l !== null),
    };
  }
}
