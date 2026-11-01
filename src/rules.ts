import type { ScoringFormat } from './config';

export interface PointOutcome { gameOver: boolean; matchOver: boolean; interval: boolean }

/** Rally-point scoring. Index 0 = player 1 (near), 1 = player 2 (far). */
export class Match {
  scores: [number, number] = [0, 0];
  games: [number, number] = [0, 0];
  /** Completed game scores. */
  history: [number, number][] = [];
  server: 0 | 1 = 0;
  private intervalTaken = false;

  constructor(public format: ScoringFormat, public gamesToWin: number) {}

  /** Winner of the rally scores and serves next. */
  award(w: 0 | 1): PointOutcome {
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
    return JSON.stringify({ s: this.scores, g: this.games, h: this.history, v: this.server, i: this.intervalTaken });
  }

  restore(snap: string) {
    const o = JSON.parse(snap);
    this.scores = o.s;
    this.games = o.g;
    this.history = o.h;
    this.server = o.v;
    this.intervalTaken = o.i;
  }

  /** Serve from the right service court on an even score, left on odd. */
  serverInRightCourt(): boolean {
    return this.scores[this.server] % 2 === 0;
  }

  get gameNumber(): number { return this.history.length + 1; }
}
