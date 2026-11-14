// Ranking simulation check (docs/3.0-notes.md, simulation 4). Bundled with esbuild and run in Node:
// how many of the top 10 after a simulated season are Rare (the strongest rarity out in 3.0), over 8 seeds.
import { characterById } from '../../shared/characters';
import { CAREER_CFG } from '../../src/careermode/config';
import { newCareer, world } from '../../src/careermode/state';
import { absWeek } from '../../src/careermode/world';
for (const [scale, entry] of JSON.parse(process.argv[2] ?? '[[18,5]]')) {
  CAREER_CFG.simScale = scale; CAREER_CFG.formEntry = entry;
  const counts: number[] = []; let ms = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const s = newCareer({ name: 'T', homeCountry: 'GBR', characterId: 'dritan_berisha', difficulty: 'relaxed', seed });
    s.year = 2027; s.week = 52;
    const t0 = performance.now(); const w = world(s, '3.0'); ms += performance.now() - t0;
    counts.push(w.rankingAt(absWeek(2027, 52)).slice(0, 10).filter((x) => characterById(x.id).rarity === 'rare').length);
  }
  console.log(`simScale ${scale}, formEntry ${entry}: Rares in top 10 = ${counts.join(', ')} (mean ${(counts.reduce((a, b) => a + b) / 8).toFixed(1)}), ${(ms / 8).toFixed(0)} ms per world`);
}
