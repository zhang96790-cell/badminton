// Shared doubles judgement: who of a pair is better placed to take the shuttle.
import { DOUBLES, PLAYER } from './config';
import type { Player } from './player';
import type { PathSample } from './shuttle';
import type { V3 } from './math';

/** Distance coverable from rest in time T with accel a and top speed vmax. */
export function coverable(T: number, vmax: number, a: number): number {
  if (T <= 0) return 0;
  const tAcc = vmax / a;
  return T < tAcc ? 0.5 * a * T * T : vmax * (T - tAcc / 2);
}

/**
 * How many metres short a player would be of reaching the incoming shuttle in time (negative = time
 * to spare), at the best point along its flight, and where that is. Shuttles on the forehand side
 * count as a little easier, so the forehand player takes the ones down the middle.
 */
export function interceptSlack(p: Player, samples: PathSample[], reaction: number, top = PLAYER.reachMaxZ): { slack: number; point: V3 | null } {
  const vmax = PLAYER.maxSpeed * p.speedMult;
  let slack = Infinity, point: V3 | null = null;
  for (const s of samples) {
    if (s.p.y * p.side < 0.3 || s.p.z < PLAYER.reachMinZ + 0.1 || s.p.z > top) continue;
    const reach = p.reachFor(s.p.z) * 0.85;
    const d = Math.max(0, Math.hypot(s.p.x - p.pos.x, s.p.y - p.pos.y) - reach);
    let v = d - coverable(s.t - reaction, vmax, PLAYER.accel);
    if ((s.p.x - p.pos.x) * p.racketSide > 0) v -= DOUBLES.forehandBias;
    if (v < slack) { slack = v; point = s.p; }
  }
  return { slack, point };
}
