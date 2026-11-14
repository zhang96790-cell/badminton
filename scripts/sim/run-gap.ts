// Career strength gaps: n matches of a random player of rarity A against one of rarity B (same CPU level),
// sides swapped every match. Args: rarityA rarityB n seed [careerOverrides JSON] [energyA].
import { playCareer } from './char-sim';
import { CAREER, ROSTER, type Rarity } from '../../shared/characters';
import { energyModifier } from '../../src/careermode/state';
import { rng } from '../../src/careermode/world';

const [, , ra, rb, nStr, seedStr, over, energyA] = process.argv;
if (over) { const o = JSON.parse(over); if (o.k !== undefined) CAREER.k = o.k; if (o.scale) for (const k of Object.keys(CAREER.perPoint) as (keyof typeof CAREER.perPoint)[]) CAREER.perPoint[k] *= o.scale; if (o.clamp) CAREER.clamp = o.clamp; }
const r = rng(Number(seedStr));
const of = (x: string) => ROSTER.filter((c) => c.rarity === (x as Rarity) && c.id !== 'default_player');
const A = of(ra), B = of(rb);
let wins = 0, pa = 0, pb = 0, sa = 0, sb = 0;
const n = Number(nStr);
for (let k = 0; k < n; k++) {
  const a = A[Math.floor(r() * A.length)], b = rb === ra && energyA ? a : B[Math.floor(r() * B.length)];
  const mods: [any[], any[]] = [energyA ? [energyModifier(Number(energyA))] : [], []];
  const flip = k % 2 === 1;
  const res = flip ? playCareer(b, a, 'hard', 3, [mods[1], mods[0]]) : playCareer(a, b, 'hard', 3, mods);
  const ia = flip ? 1 : 0;
  if (res.winner === ia) wins++;
  pa += res.points[ia]; pb += res.points[1 - ia];
  sa = Math.max(sa, res.topSmash[ia]); sb = Math.max(sb, res.topSmash[1 - ia]);
}
console.log(JSON.stringify({ n, wins, pa, pb, sa, sb }));
