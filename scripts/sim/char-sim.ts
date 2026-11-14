// Character balance simulations: two CPUs play each other with test characters. Run in the dev preview
// (it imports the game's own code); never imported by the game itself. See docs/2.7-notes.md for results.
import { Game, type Settings } from '../../src/game';
import { AIController } from '../../src/ai';
import { Input } from '../../src/input';
import { broadcastCamera } from '../../src/camera';
import { getEffectiveStats, NEUTRAL, type Character, type Modifier, type Stats } from '../../shared/characters';
import roster from './test-roster.json';
import { Signatures } from '../../src/careermode/signatures';

export const TEST = roster.characters as { id: string; rarity: string; stats: Stats }[];
const asChar = (stats: Stats): Character => ({ id: 'sim', name: 'sim', country: 'XXX', rarity: 'common', style: 'all-rounder', handedness: 'right', stats, career_strength: 0, released_in: '', enabled: true, description: '' });

const SETTINGS: Settings = {
  event: 'singles', opponent: 'hard', style: 'allround', partnerStyle: 'allround', autoSwitch: false, p1Control: 'keyboard', games: 1, points: 21,
  guides: false, timingLight: false, swingAssist: false, aim: 'realistic', voice: false, view: 'broadcast', performance: true,
} as Settings;

let input: Input | null = null;

/** Experiments: force some effects back to neutral for every character (e.g. { clearDepth: 1 }). */
export const SIM_OVERRIDE: Partial<Record<string, number>> = {};

export interface SimResult { winner: 0 | 1; points: [number, number]; topSmash: [number, number]; rallies: number }

/** One CPU-vs-CPU game to 21: side 0 plays as `a`, side 1 as `b` (null = no character code at all). */
export function playMatch(a: Stats | null, b: Stats | null, level: Settings['opponent'] = 'hard'): SimResult {
  input ??= new Input(document.createElement('div'));
  const g = new Game({ ...SETTINGS, opponent: level }, input, broadcastCamera(), 'match') as unknown as Record<string, any> & Game;
  const ctrls = g.controllers as unknown[];
  ctrls[0] = new AIController(g, g.players[0], level as never, 'allround');
  g.players[0].extraReach = g.players[1].extraReach;
  [a, b].forEach((s, i) => {
    const p = g.players[i];
    p.speedMult /= p.eff.move;
    p.eff = s ? { ...getEffectiveStats(asChar(s)), ...SIM_OVERRIDE } : NEUTRAL;
    p.speedMult *= p.eff.move;
  });
  g.startReplay = () => {};
  for (let i = 0; i < 400_000 && g.state !== 'matchOver'; i++) { g.update(0.05); g.events.length = 0; }
  const st = g.stats;
  return { winner: (g.match.games[0] > g.match.games[1] ? 0 : 1), points: [st.summary(0).points, st.summary(1).points], topSmash: [st.summary(0).topSmash, st.summary(1).topSmash], rallies: st.rallies.length };
}

/** n games of a against b, half with a on each side (to cancel any side advantage). a's win rate and point share. */
export function series(a: Stats | null, b: Stats | null, n: number, level: Settings['opponent'] = 'hard') {
  let wins = 0, pa = 0, pb = 0, smashA = 0, smashB = 0;
  for (let k = 0; k < n; k++) {
    const flip = k % 2 === 1;
    const r = flip ? playMatch(b, a, level) : playMatch(a, b, level);
    const [ia, ib] = flip ? [1, 0] : [0, 1];
    if (r.winner === ia) wins++;
    pa += r.points[ia]; pb += r.points[ib];
    smashA = Math.max(smashA, r.topSmash[ia]); smashB = Math.max(smashB, r.topSmash[ib]);
  }
  return { n, winRate: wins / n, pointShare: pa / (pa + pb), smashA, smashB };
}

/** Career-mode match between two roster characters (best of 3 to 21 unless told otherwise). */
export function playCareer(a: Character, b: Character, level: Settings['opponent'] = 'hard', games: 1 | 3 = 3, mods: [Modifier[], Modifier[]] = [[], []]): SimResult {
  input ??= new Input(document.createElement('div'));
  const g = new Game({ ...SETTINGS, opponent: level, games, points: 21 }, input, broadcastCamera(), 'match') as unknown as Record<string, any> & Game;
  const ctrls = g.controllers as unknown[];
  ctrls[0] = new AIController(g, g.players[0], level as never, 'allround');
  g.players[0].extraReach = g.players[1].extraReach;
  [a, b].forEach((c, i) => {
    const p = g.players[i];
    p.speedMult /= p.eff.move;
    p.eff = getEffectiveStats(c, mods[i], 'career');
    p.speedMult *= p.eff.move;
  });
  g.startReplay = () => {};
  for (let i = 0; i < 800_000 && g.state !== 'matchOver'; i++) { g.update(0.05); g.events.length = 0; }
  const st = g.stats;
  return { winner: (g.match.games[0] > g.match.games[1] ? 0 : 1), points: [st.summary(0).points, st.summary(1).points], topSmash: [st.summary(0).topSmash, st.summary(1).topSmash], rallies: st.rallies.length };
}

/** One game to 21 with career stats, where player `withSigs` (0 or 1) has its character's abilities switched on. */
export function playCareerWith(a: Character, b: Character, withSigs: 0 | 1, level: Settings['opponent'] = 'hard'): SimResult & { fires: number } {
  input ??= new Input(document.createElement('div'));
  const g = new Game({ ...SETTINGS, opponent: level, games: 1, points: 21 }, input, broadcastCamera(), 'match') as unknown as Record<string, any> & Game;
  const ctrls = g.controllers as unknown[];
  ctrls[0] = new AIController(g, g.players[0], level as never, 'allround');
  g.players[0].extraReach = g.players[1].extraReach;
  g.statMode = 'career';
  g.statChars = [a, b];
  g.baseMods = [[], []];
  [a, b].forEach((c, i) => { const p = g.players[i]; p.speedMult /= p.eff.move; p.eff = getEffectiveStats(c, [], 'career'); p.speedMult *= p.eff.move; });
  g.baseSpeed = g.players.map((p: any) => p.speedMult / p.eff.move);
  g.sigs = Signatures.forCharacters(withSigs === 0 ? [a, null] : [null, b], (i: number) => g.teamOf(i));
  g.startReplay = () => {};
  let fires = 0, last: unknown = null;
  for (let i = 0; i < 400_000 && g.state !== 'matchOver'; i++) { g.update(0.05); g.events.length = 0; if (g.sigs.last && g.sigs.last !== last) { fires++; last = g.sigs.last; } }
  const st = g.stats;
  return { winner: (g.match.games[0] > g.match.games[1] ? 0 : 1), points: [st.summary(0).points, st.summary(1).points], topSmash: [0, 0], rallies: st.rallies.length, fires };
}
