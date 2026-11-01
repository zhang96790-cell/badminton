import { COURT } from './config';
import type { Rect } from './court';
import type { Side, V2 } from './math';
import type { Match } from './rules';

export type Signal = 'none' | 'in' | 'out';

export interface Official {
  kind: 'umpire' | 'service' | 'line';
  pos: V2;
  /** Seat height. */
  seat: number;
  facing: V2;
  /** Line judges: which line they watch, on which half and which side. */
  duty?: { line: 'side' | 'back'; half: Side; xs: number };
  signal: Signal;
  signalT: number;
}

/** A line call on a landing, and the truth Hawk-Eye would show. */
export interface LineCall {
  landing: V2;
  rect: Rect;
  /** Distance of the footprint centre inside (+) or outside (−) the area. */
  signed: number;
  truthIn: boolean;
  callIn: boolean;
  hitter: 0 | 1;
  isServe: boolean;
  challenged: boolean;
  judge: Official | null;
}

/** Umpire on the high chair at one post, service judge at the other, line judges watching each line. */
export function createOfficials(): Official[] {
  const o = (kind: Official['kind'], pos: V2, seat: number, facing: V2, duty?: Official['duty']): Official =>
    ({ kind, pos, seat, facing, duty, signal: 'none', signalT: 0 });
  const list = [
    o('umpire', { x: -(COURT.postX + 1.4), y: 0 }, 1.3, { x: 1, y: 0 }),
    o('service', { x: COURT.postX + 0.9, y: 0 }, 0.45, { x: -1, y: 0 }),
  ];
  for (const half of [-1, 1] as Side[]) {
    for (const xs of [-1, 1]) {
      // Sideline judges sit behind the court in line with the sideline; back-line judges in line with the back line.
      list.push(o('line', { x: xs * (COURT.singlesHalfWidth - 0.02), y: half * (COURT.halfLength + (half > 0 ? 2.3 : 3.4)) }, 0.45, { x: 0, y: -half }, { line: 'side', half, xs }));
      list.push(o('line', { x: xs * (COURT.doublesHalfWidth + 1.8), y: half * (COURT.halfLength - 0.02) }, 0.45, { x: -xs, y: 0 }, { line: 'back', half, xs }));
    }
  }
  return list;
}

/** The line judge responsible for a landing, or null if it's nowhere near a line. */
export function judgeFor(officials: Official[], p: V2, r: Rect): Official | null {
  const half: Side = p.y < 0 ? -1 : 1, xs = p.x < 0 ? -1 : 1;
  const dSide = Math.min(p.x - r.xMin, r.xMax - p.x);
  const backY = half > 0 ? r.yMax : r.yMin, frontY = half > 0 ? r.yMin : r.yMax;
  const dBack = (backY - p.y) * half, dFront = (p.y - frontY) * half;
  const d = Math.min(dSide, dBack, dFront);
  if (d > 0.6) return null;
  const line: 'side' | 'back' = d === dBack ? 'back' : 'side';
  return officials.find((o) => o.duty && o.duty.half === half && o.duty.line === line && o.duty.xs === xs) ?? null;
}

const num = (n: number) => (n === 0 ? 'love' : String(n));

/** The umpire's score call: server's score first, "all" when level, game/match point when it applies. */
export function scoreCall(m: Match, serviceOver: boolean): string {
  const s = m.server, a = m.scores[s], b = m.scores[(1 - s) as 0 | 1];
  const point = (i: 0 | 1) => (m.atMatchPoint(i) ? 'match point' : m.atGamePoint(i) ? 'game point' : null);
  const sp = point(s), rp = point((1 - s) as 0 | 1);
  let call: string;
  if (a === b) call = `${num(a)} all${sp ? `, ${sp}` : ''}`;
  else if (sp) call = `${num(a)}, ${sp}, ${num(b)}`;
  else call = `${num(a)}, ${num(b)}${rp ? `, ${rp}` : ''}`;
  return `${serviceOver ? 'Service over. ' : ''}${call[0].toUpperCase()}${call.slice(1)}.`;
}

export function gameStartCall(gameNumber: number, gamesToWin: number): string {
  if (gameNumber === 1) return 'Love all, play.';
  return `${gameNumber === 2 * gamesToWin - 1 ? 'Final' : 'Second'} game, love all, play.`;
}

export const gameWonCall = (name: string, w: number, l: number) => `Game won by ${name}, ${w}, ${l}.`;

export function matchWonCall(name: string, games: [number, number][], winner: 0 | 1): string {
  return `Match won by ${name}, ${games.map((g) => `${g[winner]}, ${g[1 - winner]}`).join('; ')}.`;
}
