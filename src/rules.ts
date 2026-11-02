import type { ScoringFormat } from './config';

export interface PointOutcome { gameOver: boolean; matchOver: boolean; interval: boolean }

/** The other player on the same doubles team (players 0 and 2 are the near pair, 1 and 3 the far pair). */
export const partnerIdx = (i: number) => (i < 2 ? i + 2 : i - 2);

/**
 * Rally-point scoring. Index 0 = the near side (player 1 / your pair), 1 = the far side.
 * Doubles also tracks which player of each pair stands in the right service court.
 */
export class Match {
  scores: [number, number] = [0, 0];
  games: [number, number] = [0, 0];
  /** Completed game scores. */
  history: [number, number][] = [];
  server: 0 | 1 = 0;
  /** Doubles: player index in each team's right service court. */
  right: [number, number] = [0, 1];
  /** Doubles: who stands in the right courts at the start of each game (online, set from the lineup). */
  startRight: [number, number] = [0, 1];
  private intervalTaken = false;

  constructor(public format: ScoringFormat, public gamesToWin: number, public doubles = false) {}

  /**
   * Winner of the rally scores and serves next. In doubles, a pair that wins a point on its own serve
   * swaps service courts; a pair that wins the serve back stays put (Laws 11.3–11.4).
   */
  award(w: 0 | 1): PointOutcome {
    if (this.doubles && w === this.server) this.right[w] = partnerIdx(this.right[w]);
    this.scores[w]++;
    this.server = w;
    const [a, b] = this.scores;
    if (this.gameWon(a, b) || this.gameWon(b, a)) {
      this.history.push([a, b]);
      this.games[w]++;
      return { gameOver: true, matchOver: this.games[w] >= this.gamesToWin, interval: false };
    }
    if (!this.intervalTaken && Math.max(a, b) === this.format.intervalAt) {
      this.intervalTaken = true;
      return { gameOver: false, matchOver: false, interval: true };
    }
    return { gameOver: false, matchOver: false, interval: false };
  }

  private gameWon(me: number, them: number): boolean {
    const f = this.format;
    return (me >= f.pointsToWin && me - them >= f.winBy) || me >= f.pointCap;
  }

  /** The previous game's winner serves first (server already points at them). */
  newGame() {
    this.scores = [0, 0];
    this.right = [...this.startRight];
    this.intervalTaken = false;
  }

  /** True if player i wins the game by winning the next rally. */
  atGamePoint(i: 0 | 1): boolean {
    const me = this.scores[i] + 1, them = this.scores[1 - i];
    return this.gameWon(me, them);
  }

  atMatchPoint(i: 0 | 1): boolean {
    return this.atGamePoint(i) && this.games[i] + 1 >= this.gamesToWin;
  }

  /** Save/restore everything a point changes, so an overturned line call can be re-scored. */
  snapshot(): string {
    return JSON.stringify({ s: this.scores, g: this.games, h: this.history, v: this.server, i: this.intervalTaken, r: this.right });
  }

  restore(snap: string) {
    const o = JSON.parse(snap);
    this.scores = o.s;
    this.games = o.g;
    this.history = o.h;
    this.server = o.v;
    this.intervalTaken = o.i;
    this.right = o.r;
  }

  /** Serve from the right service court on an even score, left on odd. */
  serverInRightCourt(): boolean {
    return this.scores[this.server] % 2 === 0;
  }

  /** Player index of the server: in doubles, whoever of the serving pair is in the court their score says. */
  serverIdx(): number {
    if (!this.doubles) return this.server;
    const r = this.right[this.server];
    return this.serverInRightCourt() ? r : partnerIdx(r);
  }

  /** Player index of the receiver: diagonally opposite, so in the same-named service court. */
  receiverIdx(): number {
    const t = (1 - this.server) as 0 | 1;
    if (!this.doubles) return t;
    const r = this.right[t];
    return this.serverInRightCourt() ? r : partnerIdx(r);
  }

  /** Swap two players' indices (auto-switch control swaps who is player 0 and 2). */
  swapIndices(a: number, b: number) {
    this.right = this.right.map((i) => (i === a ? b : i === b ? a : i)) as [number, number];
  }

  get gameNumber(): number { return this.history.length + 1; }
}
