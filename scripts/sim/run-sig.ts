// Signature balance (docs/3.0-notes.md, simulation 5): the same Common player on both sides; one side gets the
// abilities named. Single games to 21, career stats, hard CPU. Args: abilityIds(comma) n seed.
import { playCareerWith } from './char-sim';
import { ROSTER } from '../../shared/characters';
import { rng } from '../../src/careermode/world';
import { SIGNATURES } from '../../src/careermode/signatures';

const [, , ids, nStr, seedStr] = process.argv;
const r = rng(Number(seedStr));
const commons = ROSTER.filter((c) => c.rarity === 'common' && c.id !== 'default_player');
const abil = ids.split(',').map((id) => { const d = SIGNATURES.get(id)!; return { id, tier: d.tier, name: d.name, text: d.text, slot: 'signature' as const }; });
let wins = 0, pa = 0, pb = 0, fires = 0;
const n = Number(nStr);
for (let k = 0; k < n; k++) {
  const base = commons[Math.floor(r() * commons.length)];
  const a = { ...base, abilities: abil }, b = { ...base, abilities: [] };
  const flip = k % 2 === 1;
  const res = flip ? playCareerWith(b, a, 1) : playCareerWith(a, b, 0);
  const ia = flip ? 1 : 0;
  if (res.winner === ia) wins++;
  pa += res.points[ia]; pb += res.points[1 - ia]; fires += res.fires;
}
console.log(JSON.stringify({ n, wins, pa, pb, sa: fires, sb: 0 }));
