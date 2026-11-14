// Career economy simulation (docs/3.0-notes.md, simulation 3): bots with a base win rate against Commons play
// 3 seasons using the real career rules (entry, travel, hotels, energy, prizes, ranking, recruiting).
// Matches are decided by win chance, not played. Bundled with esbuild and run in Node.
import { characterById, ROSTER } from '../../shared/characters';
import { CAREER_CFG as CFG } from '../../src/careermode/config';
import { advanceWeek, canEnter, clubEvent, energyPenalty, enter, eventThisWeek, myRank, newCareer, nextMatch, payFor, recordMatch, refuel, softLocked, world } from '../../src/careermode/state';
import { rng } from '../../src/careermode/world';

const logit = (p: number) => Math.log(p / (1 - p)), sig = (x: number) => 1 / (1 + Math.exp(-x));
/** From the strength simulation: a Rare beats a Common 68% of the time. */
const RARE_EDGE = logit(0.683);
const tierOf = (r: string) => (r === 'rare' ? 1 : 0);

function run(base: number, seed: number) {
  const start = ROSTER.find((c) => c.rarity === 'common' && c.id !== 'default_player')!;
  const s = newCareer({ name: 'Bot', homeCountry: 'MAS', characterId: start.id, difficulty: 'relaxed', seed });
  const r = rng(seed * 7 + 1);
  const log = { titles: [0, 0, 0], s300Titles: [0, 0, 0], income: [0, 0, 0], costs: [0, 0, 0], rank: [0, 0, 0], recruitWeek: null as string | null, clubOpens: 0, softLockedWeeks: 0, events: 0, qfS100: [] as number[] };
  let myTier = 0;
  while (s.year < CFG.startYear + 3) {
    const yi = s.year - CFG.startYear;
    const w = world(s, '3.0');
    s.recap = null;
    let x = eventThisWeek(s, '3.0');
    if (x && !canEnter(s, x, w).ok) x = null;
    if (!x && softLocked(s, w)) { log.softLockedWeeks++; x = clubEvent(s); log.clubOpens++; }
    if (x && s.energy >= 35) {
      const before = s.money;
      enter(s, x);
      log.events++;
      while (s.current) {
        const nm = nextMatch(s, w, x)!;
        const edge = logit(base) + (myTier - tierOf(nm.opponent.rarity)) * RARE_EDGE;
        const p = sig(edge) * (1 - energyPenalty(s.energy) * 1.5);
        const won = r() < p;
        recordMatch(s, w, x, won, won ? [[21, 15], [21, 15]] : [[15, 21], [15, 21]], nm.opponent.id);
      }
      const h = s.history[s.history.length - 1];
      if (x.tier === 'S100' && h.round === 'QF') log.qfS100.push(s.money - before);
      if (h.round === 'W') { log.titles[yi]++; if (x.tier === 'S300') log.s300Titles[yi]++; }
      // Recruit a Rare when one's offered and affordable (keep a travel float).
      if (s.offerDue) {
        const cands = s.offerDue.field.filter((id) => characterById(id).rarity === 'rare').slice(0, 1);
        if (cands.length && myTier === 0 && s.money >= CFG.recruitCost.rare + 600) { payFor(s, 'Recruit', CFG.recruitCost.rare); myTier = 1; log.recruitWeek = `${s.year} w${s.week}`; }
        s.offerDue = null;
      }
      advanceWeek(s, 'next', '3.0');
      if (s.recap !== null) log.rank[s.recap - CFG.startYear] = myRank(s, world(s, '3.0'), (s.recap) * 52 + 51) ?? 999;
    } else {
      if (s.energy < 60 && s.money >= CFG.rest.cost + 400) advanceWeek(s, 'rest', '3.0');
      else { if (s.energy < 40 && s.money > 800) refuel(s, 'physio'); advanceWeek(s, 'next', '3.0'); }
    }
    if (s.recap !== null) log.rank[s.recap - CFG.startYear] = myRank(s, world(s, '3.0'), s.recap * 52 + 51) ?? 999;
  }
  for (const l of s.ledger) { const yi = l.year - CFG.startYear; if (yi >= 0 && yi < 3) { if (l.amount > 0) log.income[yi] += l.amount; else log.costs[yi] -= l.amount; } }
  return { ...log, money: s.money };
}

const out: string[] = ['| Base win rate vs Common | Titles (y1/y2/y3) | Super 300 titles | Year-end rank (y1/y2/y3) | Income − costs per year | Recruited a Rare | Club Opens | Final money | S100 QF exit, net |', '|---|---|---|---|---|---|---|---|---|'];
for (const base of [0.35, 0.45, 0.55, 0.65, 0.75, 0.85]) {
  const runs = [1, 2, 3, 4, 5, 6].map((seed) => run(base, seed));
  const avg = (f: (x: (typeof runs)[0]) => number) => (runs.reduce((t, x) => t + f(x), 0) / runs.length);
  const per = (f: (x: (typeof runs)[0], i: number) => number) => [0, 1, 2].map((i) => avg((x) => f(x, i)).toFixed(1)).join(' / ');
  const qf = runs.flatMap((x) => x.qfS100);
  out.push(`| ${Math.round(base * 100)}% | ${per((x, i) => x.titles[i])} | ${per((x, i) => x.s300Titles[i])} | ${per((x, i) => x.rank[i])} | ${[0, 1, 2].map((i) => Math.round(avg((x) => x.income[i] - x.costs[i]))).join(' / ')} | ${runs.filter((x) => x.recruitWeek).length}/6 (first: ${runs.map((x) => x.recruitWeek).filter(Boolean).sort()[0] ?? '–'}) | ${avg((x) => x.clubOpens).toFixed(1)} | ${Math.round(avg((x) => x.money))} | ${qf.length ? Math.round(qf.reduce((a, b) => a + b, 0) / qf.length) : '–'} |`);
}
console.log(out.join('\n'));
