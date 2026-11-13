// Node runner for the character simulations: `node scripts/sim/run.mjs <test> <games>` (see build-sims below).
import { playMatch, SIM_OVERRIDE } from './char-sim';
import type { Stats } from '../../shared/characters';

const [, , aJson, bJson, nStr] = process.argv;
const a = aJson === 'null' ? null : (JSON.parse(aJson) as Stats), b = bJson === 'null' ? null : (JSON.parse(bJson) as Stats), n = Number(nStr);
if (process.env.SIM_OVERRIDE) Object.assign(SIM_OVERRIDE, JSON.parse(process.env.SIM_OVERRIDE));
let wins = 0, pa = 0, pb = 0, sA = 0, sB = 0;
for (let k = 0; k < n; k++) {
  const flip = k % 2 === 1;
  const r = flip ? playMatch(b, a) : playMatch(a, b);
  const ia = flip ? 1 : 0, ib = 1 - ia;
  if (r.winner === ia) wins++;
  pa += r.points[ia]; pb += r.points[ib];
  sA = Math.max(sA, r.topSmash[ia]); sB = Math.max(sB, r.topSmash[ib]);
}
console.log(JSON.stringify({ n, wins, pa, pb, sA, sB }));
