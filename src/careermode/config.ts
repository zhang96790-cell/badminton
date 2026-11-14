// Career mode numbers, all in one place. Tuned with the economy simulation (docs/3.0-notes.md).
import type { Level } from '../config';
import type { Rarity } from '../../shared/characters';

export type Tier = 'S100' | 'S300' | 'S500' | 'S750' | 'S1000' | 'WTF' | 'WORLDS' | 'OLYMPICS';
export type Round = 'R32' | 'R16' | 'QF' | 'SF' | 'F' | 'W';
export type Difficulty = 'relaxed' | 'normal' | 'hard';

export const CAREER_CFG = {
  dataVersion: 1,
  startYear: 2027,
  startMoney: 1500,
  startEnergy: 100,

  // ── Prize money ──
  /** Purse = prize_pool_usd × moneyScale (a Super 100's 140k is a 14,000 purse). */
  moneyScale: 0.1,
  /** Share of the purse by how far you got. The winner gets 7.5%; losing early still pays a little. */
  prizeShare: { W: 0.075, F: 0.058, SF: 0.046, QF: 0.036, R16: 0.012, R32: 0.006 } as Record<Round, number>,

  // ── Travel, hotels, refuelling ──
  travel: { domestic: 120, regional: 350, intercontinental: 750 },
  /** Business class: about 2.2× economy, saves about 40% of the travel energy. */
  business: { cost: 2.2, energySaved: 0.4 },
  /** Per round actually played (so an early exit costs less hotel). */
  hotelPerRound: 40,
  food: { cost: 50, energy: 10 },
  physio: { cost: 200, energy: 30 },
  rest: { cost: 60, energy: 15 },
  /** A week where you don't play or rest still gives a little back. */
  idleWeekEnergy: 5,

  // ── Energy ──
  /** Energy used per round played, and for travelling. */
  energyPerRound: 9,
  travelEnergy: { domestic: 3, regional: 8, intercontinental: 15 },
  /** No penalty from this energy up; below it, a straight line down to `maxPenalty` at 0 (6%: 12% cost twice the spec's 6–12 point target). */
  energyPenaltyFrom: 60,
  maxPenalty: 0.06,
  /** Stamina (career stats) changes energy use: each point above 20 uses this much less. */
  staminaPerPoint: 0.015,

  // ── Recruiting ──
  recruitCost: { common: 600, rare: 1800, super_rare: 4000, epic: 8000, elite: 15000, mythic: 25000, legendary: 40000, champion: 60000 } as Record<Rarity, number>,
  rerollCost: 150,

  // ── Soft-lock protection ──
  /** Offered free when you can't afford any event: 16 players, tiny prize, small energy cost. */
  clubOpen: { purse: 900, energyPerRound: 4, tier: 'CLUB' as const },

  // ── Entry ──
  /** S300: after reaching a Super 100 final, or a career ranking of 150 or better. */
  gate: { S300: { finalIn: 'S100' as Tier, rankAtMost: 150 } },
  draw: { S100: 16, S300: 16 } as Partial<Record<Tier, number>>,
  /** Who's in a draw, by rarity weight. Later tiers come from data. */
  fieldWeights: {
    S100: { common: 80, rare: 20 },
    S300: { common: 40, rare: 60 },
    /** Only as unseen world events in 3.0 (you can't enter Super 500s yet). */
    S500: { common: 30, rare: 70, super_rare: 40 },
  } as Partial<Record<Tier, Partial<Record<Rarity, number>>>>,
  /** Chance per draw of a Champion wildcard (0 until 3.2 adds the data). */
  wildcardChance: { S100: 0, S300: 0 } as Partial<Record<Tier, number>>,
  minHostPlayers: 2,
  maxPerCountry: 3,

  // ── World ranking points (TODO-verify against the 2027 BWF points table) ──
  points: {
    S100: { W: 5500, F: 4680, SF: 3850, QF: 3030, R16: 2110, R32: 1290 },
    S300: { W: 7000, F: 5950, SF: 4900, QF: 3850, R16: 2750, R32: 1670 },
    S500: { W: 9200, F: 7800, SF: 6420, QF: 5040, R16: 3600, R32: 2220 },
    CLUB: { W: 300, F: 240, SF: 180, QF: 120, R16: 60, R32: 30 },
  } as Record<string, Record<Round, number>>,
  /** Ranking counts your best results in the last 52 weeks. */
  bestOf: 10,

  // ── CPU opponents ──
  /**
   * CPU level range by the opponent's rarity, on the career ladder (1 Hard, 2 Expert, 3 Pro, 4 Elite, 5 World
   * Class, 6 Legend); picked per match from the tournament seed.
   */
  cpuLevel: { common: [1, 2], rare: [2, 4], super_rare: [3, 5], epic: [4, 6], elite: [5, 6], mythic: [6, 6], legendary: [6, 6], champion: [6, 6] } as Record<Rarity, [number, number]>,
  /** Bigger events: their players play this many levels higher (capped at Legend). */
  tierLevelBonus: { CLUB: 0, S100: 0, S300: 1, S500: 1, S750: 2, S1000: 2 } as Record<string, number>,

  // ── Result simulator (NPC matches) ──
  /** Win chance = 1 / (1 + e^(−(strength gap) / simScale)); each character also has a fixed ±simSpread form. */
  simScale: 12,
  simSpread: 10,
  /** Per-match noise on top. */
  simNoise: 8,
  /**
   * Other tournaments around the world (never shown, NPCs only) so the ranking isn't decided by the handful of
   * events in your calendar: this many extra per year, by tier.
   */
  worldEvents: { S100: 14, S300: 8, S500: 6 } as Partial<Record<Tier, number>>,
  /** Players in better form enter more events: entry weight × e^(form / formEntry). */
  formEntry: 5,
};

/** The career ladder: level 1 is Hard (the easiest career opponent), level 6 Legend. */
export const LEVELS: Level[] = ['hard', 'expert', 'pro', 'elite', 'world', 'legend'];
export const ROUND_LABEL: Record<Round, string> = { R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', F: 'Final', W: 'Winner' };
export const TIER_LABEL: Record<string, string> = { S100: 'Super 100', S300: 'Super 300', S500: 'Super 500', S750: 'Super 750', S1000: 'Super 1000', WTF: 'World Tour Finals', WORLDS: 'World Championships', OLYMPICS: 'Olympics', CLUB: 'Local club open' };
