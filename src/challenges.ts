// Challenges: short scored drills against the feeder, each worth up to three stars. Your best stars
// are kept on this computer (and added to your account's career, for the leaderboard).
import type { FeedType, HitInfo, LandInfo, Panel, Session } from './practice';
import type { Game } from './game';
import { pick } from './math';

export interface ChallengeDef {
  id: string;
  name: string;
  /** What counts, in a few words (shown on screen). */
  goal: string;
  feeds: FeedType[];
  /** How many feeds an attempt gets. */
  tries: number;
  /** A streak: the attempt ends at the first miss. */
  streak?: boolean;
  /** Score needed for one, two and three stars. */
  stars: [number, number, number];
  /** The target box on the far court, as depths past the net (m), highlighted while you play. */
  zone?: { d0: number; d1: number };
  /** Does this landing count? (Your shot, landed in the court.) */
  counts?: (l: LandInfo) => boolean;
  /** Or does this hit count? */
  countsHit?: (h: HitInfo) => boolean;
}

export const CHALLENGES: ChallengeDef[] = [
  { id: 'drops', name: 'Drop zone', goal: 'Land drops in the front box (between the net and the short service line)', feeds: ['liftBack'], tries: 15, stars: [4, 7, 10],
    zone: { d0: 0, d1: 1.98 }, counts: (l) => /drop/i.test(l.label) && l.depth < 1.98 },
  { id: 'defence', name: 'Smash defence', goal: 'Return smashes into the court, in a row', feeds: ['smash'], tries: 15, streak: true, stars: [3, 5, 8],
    counts: () => true },
  { id: 'clears', name: 'Deep clears', goal: 'Clear to the back 1.2 m of the court', feeds: ['liftBack'], tries: 12, stars: [4, 7, 10],
    zone: { d0: 5.5, d1: 6.7 }, counts: (l) => /clear|lift/i.test(l.label) && l.depth > 5.5 },
  { id: 'netshots', name: 'Tight at the net', goal: 'Net shots that land within 1 m of the net', feeds: ['net', 'net', 'netLoose'], tries: 12, stars: [4, 7, 10],
    zone: { d0: 0, d1: 1.0 }, counts: (l) => /net shot/i.test(l.label) && l.depth < 1.0 },
  { id: 'smashes', name: 'Smash attack', goal: 'Smash short lifts into the court', feeds: ['liftMid'], tries: 12, stars: [5, 8, 11],
    counts: (l) => /smash/i.test(l.label) },
  { id: 'drives', name: 'Drive battle', goal: 'Return drives into the court, in a row', feeds: ['drive'], tries: 15, streak: true, stars: [4, 7, 11],
    counts: () => true },
  { id: 'timing', name: 'Perfect timing', goal: 'Hit with perfect timing (any shot)', feeds: ['liftBack', 'liftMid', 'net', 'drive'], tries: 15, stars: [6, 9, 12],
    countsHit: (h) => h.timing === 'perfect' },
];

const KEY = 'badminton.challengeStars';
export type StarRecord = Record<string, { stars: number; best: number }>;
export function loadStars(): StarRecord {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as StarRecord; } catch { return {}; }
}
export const totalStars = (r: StarRecord = loadStars()) => Object.values(r).reduce((a, x) => a + x.stars, 0);
export const starsFor = (c: ChallengeDef, score: number) => c.stars.filter((s) => score >= s).length;
const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

export class Challenges implements Session {
  readonly kind = 'challenge';
  done = false;
  private pick = 0;
  private fed = 0;
  private score = 0;
  private over = false;
  private record = loadStars();
  /** Called when an attempt ends (main adds the stars to your career and checks achievements). */
  onResult: ((c: ChallengeDef, stars: number, score: number) => void) | null = null;

  private get c(): ChallengeDef { return CHALLENGES[this.pick]; }

  start(g: Game) { this.begin(g, 1.2); }

  private begin(g: Game, delay: number) {
    g.targetZone = this.c.zone ?? null;
    this.fed = 0;
    this.score = 0;
    this.over = false;
    this.feed(g, delay);
  }

  private feed(g: Game, delay: number) {
    this.fed++;
    g.feed(pick(this.c.feeds), delay);
  }

  update() {}

  onHit(_g: Game, h: HitInfo) {
    if (!this.over && this.c.countsHit?.(h)) this.score++;
  }

  onLand(g: Game, l: LandInfo) {
    if (this.over) return;
    const c = this.c;
    const yours = l.hitter === 0 && l.inCourt && !l.isServe;
    if (c.counts && yours && c.counts(l)) { this.score++; g.zoneFlash = 0; }
    if ((c.streak && !yours) || this.fed >= c.tries) { this.finish(g); return; }
    this.feed(g, 0.8);
  }

  private finish(g: Game) {
    this.over = true;
    const c = this.c, stars = starsFor(c, this.score);
    const prev = this.record[c.id] ?? { stars: 0, best: 0 };
    const better = this.score > prev.best;
    this.record[c.id] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, this.score) };
    try { localStorage.setItem(KEY, JSON.stringify(this.record)); } catch { /* storage unavailable */ }
    g.banner = {
      title: `${starText(stars)}  ${c.name}`,
      sub: `${this.score} ${c.streak ? 'in a row' : `of ${c.tries}`}${better && prev.best ? ' · new best!' : ''} · Enter to try again`,
      color: stars === 3 ? '#ffd166' : stars ? '#8fd3ff' : '#c9d1dc', t: 0,
    };
    g.idle();
    this.onResult?.(c, stars, this.score);
  }

  onReview() {}
  onReplay() {}

  /** Enter: try again (or restart a running attempt). */
  skip(g: Game) {
    g.banner = null;
    this.begin(g, 0.6);
  }

  key(g: Game, code: string) {
    const n = Number(code.replace('Digit', '')) - 1;
    if (n >= 0 && n < CHALLENGES.length && n !== this.pick) {
      this.pick = n;
      g.banner = null;
      this.begin(g, 0.6);
    }
  }

  panel(): Panel {
    const c = this.c, best = this.record[c.id];
    return {
      tag: `CHALLENGE ${this.pick + 1}/${CHALLENGES.length}`,
      title: `${c.name}: ${c.goal}`,
      text: CHALLENGES.map((d, i) => `${i + 1} ${d.name} ${starText(this.record[d.id]?.stars ?? 0)}`).join('   ·   '),
      progress: [Math.min(this.score, c.stars[2]), c.stars[2]],
      footer: `Score ${this.score}${c.streak ? ' in a row' : `   ·   Shuttle ${Math.min(this.fed, c.tries)} of ${c.tries}`}   ·   ★ ${c.stars[0]}  ★★ ${c.stars[1]}  ★★★ ${c.stars[2]}${best ? `   ·   Best ${best.best}` : ''}   ·   Enter restart   ·   Esc quit`,
    };
  }
}
