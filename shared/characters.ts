// Characters: who you play as. Five stats (Power, Speed, Net, Defence, Stamina), each 10–35, with 20 in
// every stat being exactly today's player. The roster lives in src/roster/roster.json (the owner fills it
// in; see docs/roster-guide.md). Shared by the game and the room server.
import roster from '../src/roster/roster.json';
import rosterV5 from '../src/roster/roster-v5.json';
import rosterConfig from '../src/roster/roster-config.json';

export const STAT_NAMES_V4 = ['Power', 'Speed', 'Net', 'Defence', 'Stamina'] as const;
/** 5.0: the new five (same slots: Defence's became Reach, Stamina's became Accuracy). */
export const STAT_NAMES_V5 = ['Power', 'Speed', 'Net', 'Reach', 'Accuracy'] as const;

// ── 5.0 test area: the game runs as v4 for everyone; inside the hidden v5 test area it switches to v5
// (the v5 roster and what the new stats do). Flipped on for everyone at the official launch.
let edition: 4 | 5 = 4;
export const getEdition = () => edition;
export function setEdition(e: 4 | 5) { edition = e; }
/** The stat names in play right now. */
export const statNames = (): readonly string[] => (edition === 5 ? STAT_NAMES_V5 : STAT_NAMES_V4);
/** Kept for older callers: today's names. */
export const STAT_NAMES = STAT_NAMES_V4;
export type Stats = [power: number, speed: number, net: number, defence: number, stamina: number];

export const RARITIES = ['common', 'rare', 'super_rare', 'epic', 'elite', 'mythic', 'legendary', 'champion'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * Per rarity: the label, the five-stat total a character of that rarity must have, and a frame colour.
 * Colours are picked to stay distinct for colour-blind players, and every card also shows the label.
 */
const BUDGETS = (rosterConfig.budgets as Record<string, Record<Rarity, number>>)[rosterConfig.rankedBudgetMode] ?? rosterConfig.budgets.sheet;
export const RARITY: Record<Rarity, { label: string; budget: number; color: string; order: number }> = {
  common: { label: 'Common', budget: BUDGETS.common, color: '#9aa4b2', order: 0 },
  rare: { label: 'Rare', budget: BUDGETS.rare, color: '#4d9de0', order: 1 },
  super_rare: { label: 'Super Rare', budget: BUDGETS.super_rare, color: '#2ec4b6', order: 2 },
  epic: { label: 'Epic', budget: BUDGETS.epic, color: '#8a5cf6', order: 3 },
  elite: { label: 'Elite', budget: BUDGETS.elite, color: '#e15a97', order: 4 },
  mythic: { label: 'Mythic', budget: BUDGETS.mythic, color: '#f08a24', order: 5 },
  legendary: { label: 'Legendary', budget: BUDGETS.legendary, color: '#f2c14e', order: 6 },
  champion: { label: 'Champion', budget: BUDGETS.champion, color: '#f5f5f5', order: 7 },
};

export const STYLES = ['all-rounder', 'attacker', 'defender', 'net player', 'deceptive', 'fast retriever', 'defensive wall', 'control'] as const;
export type CharStyle = (typeof STYLES)[number];

/** A signature or skill: what it's called and its plain-language text (numbers live in data/signatures.json). */
export interface Ability { id: string; tier: 'S' | 'SS' | 'SSS' | 'U'; name: string; text: string; slot: 'signature' | 'skill' }

export interface Character {
  /** Made from the name: lowercase letters and underscores (stats are saved under it). */
  id: string;
  /** The owner's sheet row id (kept for reference only). */
  sheet_id?: string;
  name: string;
  /** ISO 3166 alpha-3, e.g. GBR. */
  country: string;
  rarity: Rarity;
  style: CharStyle;
  handedness: 'right' | 'left';
  /** Ranked and friendly stats (the sheet's, or squeezed to the cap10 totals: see roster-config.json). */
  stats: Stats;
  /** The sheet's stats: career mode uses these, scaled by career strength. */
  base_stats: Stats;
  ranked_stat_total?: number;
  /** Career mode strength (Common 100 … Champion 380). */
  career_strength: number;
  abilities: Ability[];
  released_in: string;
  enabled: boolean;
  description: string;
}

/** The one character everyone always has (never locked). */
export const DEFAULT_CHARACTER = 'default_player';

export const ROSTER: Character[] = (roster.characters as Character[]).filter((c) => c.enabled);

const BY_ID = new Map(ROSTER.map((c) => [c.id, c]));
/** 5.0: the v5 roster (new stats, the top-tier players). Only used while the edition is 5. */
export const ROSTER_V5: Character[] = (rosterV5.characters as Character[]).filter((c) => c.enabled);
const BY_ID_V5 = new Map(ROSTER_V5.map((c) => [c.id, c]));
export function characterById(id: string | null | undefined): Character {
  const m = edition === 5 ? BY_ID_V5 : BY_ID;
  return (id && m.get(id)) || m.get(DEFAULT_CHARACTER)!;
}

/** Compare versions part by part ("3.10" is after "3.9"): negative if a is older. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(/[.–-]/).map(Number), y = b.split(/[.–-]/).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
/** Out in this version of the game (players for later versions stay hidden). */
export const releasedIn = (c: Character, appVersion: string) => compareVersions(c.released_in, appVersion) <= 0;
/** Everyone available in this version of the game. */
export const rosterFor = (appVersion: string) => (edition === 5 ? ROSTER_V5.filter((c) => releasedIn(c, '5.0')) : ROSTER.filter((c) => releasedIn(c, appVersion)));

/** A short fingerprint of the roster, so two pages with different rosters can tell (part of the version check). */
export const ROSTER_HASH = (() => {
  let h = 2166136261;
  for (const ch of JSON.stringify(roster)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
})();

/**
 * What a character's stats do in play, as multipliers on today's values (1 = unchanged). Each point
 * away from 20 moves one of these a little; every one is hard-limited so no stat combination can stray
 * far from today's game (smash speed −5% to +8%, everything else ±10%).
 */
export interface Effective {
  /** 5.0 Ultra (King of Backhand): this player's backhand power and aim error, in place of the game's usual ones. */
  backhandPower?: number;
  backhandNoise?: number;
  /** 5.0 Ultra (Untouchable): net kills from this much (m) lower than anyone else, and taps likewise. */
  killMargin?: number;
  /** Smash (and other hard overhead) speed. */
  smash: number;
  /** How deep clears go. */
  clearDepth: number;
  /** Footwork speed. */
  move: number;
  /** Wait after a hit before the next swing (lower is quicker). */
  swingWait: number;
  /** Aim error on net shots (lower is more accurate). */
  netAim: number;
  /** Perfect-timing window on net shots. */
  netTiming: number;
  /** Perfect-timing window on lifts and blocks. */
  defenceTiming: number;
  /** Depth error on lifts and blocks (lower is more accurate). */
  defenceDepth: number;
  /** Perfect-timing window on every shot (energy and abilities). */
  timing: number;
  /** Aim error on every shot (lower is more accurate). */
  aim: number;
  /** Speed of fast shots that aren't smashes (drives, pushes, flicks). */
  shotSpeed: number;
  /** 3.7: how far over the tape net shots pass (lower is tighter: Net). */
  netClearance: number;
  /** 3.7: extra reach (m) when defending a smash (Defence). */
  defReach: number;
  /** 3.7: how fast you tire in long rallies and games (lower tires slower: Stamina). */
  fatigue: number;
  /** 3.7: a heavy smash (Power): the defender's timing window is divided by this. Smash speed is unchanged. */
  heavy: number;
  /** 3.7: footwork speed in the front court (Net). */
  netMove: number;
}

export const NEUTRAL: Effective = { smash: 1, clearDepth: 1, move: 1, swingWait: 1, netAim: 1, netTiming: 1, defenceTiming: 1, defenceDepth: 1, timing: 1, aim: 1, shotSpeed: 1, netClearance: 1, defReach: 0, fatigue: 1, heavy: 1, netMove: 1 };

/** How much each point away from 20 changes things (tuned with simulations; see docs/2.7-notes.md). */
// 3.11: Net and Defence count double what they did (Speed unchanged; Power's smash still only 0.95–1.08).
export const PER_POINT = { power: 0.005, speed: 0.007, netAim: 0.02, netTiming: 0.012, defenceTiming: 0.02, defenceDepth: 0.008 };
/**
 * 3.7: jobs for the stats beyond Speed (ranked, friendly and quick play; career keeps its own tuning).
 * Power: drives, pushes and flicks are faster. Net: net shots skim the tape tighter. Defence: longer reach
 * against smashes. Stamina: you tire more slowly in long rallies and games.
 */
export const STAT_JOBS = {
  // 3.11: all about doubled.
  drivePerPower: 0.007,
  heavyPerPower: 0.022, heavy: [0.8, 1.33] as [number, number],
  netClearancePerNet: 0.02, netClearance: [0.7, 1.2] as [number, number],
  netMovePerNet: 0.016, netMoveWithin: 2.3,
  defReachPerDefence: 0.008, defReach: [-0.08, 0.12] as [number, number],
  fatiguePerStamina: 0.05, fatigue: [0.4, 1.5] as [number, number],
  /** Tiring: each shot you play adds 1; a new point keeps `keep` of it; a new game clears it. */
  fadePerShot: 0.0035, fadeMax: 0.11, keep: 0.55,
  /** 3.11: ranked limit for the non-Speed stats (Speed keeps ±10%). */
  otherLim: 0.2,
};

/** Later systems (energy, abilities, …) add modifiers: multipliers on the derived values. */
export type Modifier = Partial<Record<keyof Effective, number>>;

/**
 * Career mode: stats are the sheet's base stats times the career multiplier, each point counts for more, and
 * the limits are wider (±18%, smash −5% to +10%). Ranked and friendly never use this. Tuned with the
 * simulations in docs/3.0-notes.md.
 */
export const CAREER = {
  /** mult = 1 + (career_strength − 100) / 100 × k */
  k: 0.4,
  // 4.1: Speed halved (was 0.024: the fastest players moved 24% faster, which looked unrealistic).
  perPoint: { power: 0.016, speed: 0.012, netAim: 0.032, netTiming: 0.024, defenceTiming: 0.032, defenceDepth: 0.016 },
  /** 4.1: the most Speed can add to movement in career (+13%). */
  moveMax: 0.13,
  /** ±24% (3.2: was ±18%, which Super Rares and Epics hit, so they were barely stronger than Rares). */
  clamp: 0.24,
  smash: [0.95, 1.1] as [number, number],
};

/** 5.0: Accuracy's aim change per point (ranked, career), and how much Reach's extra reach counts in career. */
export const V5_STATS = {
  acc: 0.01, accCareer: 0.016, reachCareer: 1.5,
  /** 5.0: stat totals go up to 200 (Champion), so a stat can reach 50 (was 35). */
  maxStat: 50,
  /** Past 35 every point counts this much (so 200-total players are stronger, not absurd). */
  softFrom: 15, softRate: 0.6,
  /** Speed: past 30 each point counts half (as before), past 40 a quarter. */
  speedSoft2: 20, speedRate2: 0.25,
  /** A little more room at the top than 4.x, so the best players stand out against hard CPUs. */
  rankedMoveLim: 0.12, rankedSmashHi: 1.11, careerSmashHi: 1.14, otherLimMult: 1.2,
};

export const careerMult = (c: Character) => 1 + ((c.career_strength - 100) / 100) * CAREER.k;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The single place gameplay reads a character's stats from. 'ranked' (also friendly and quick play) uses the
 * ranked stats with the 2.7 limits; 'career' uses base stats × career multiplier with wider limits.
 * Modifiers (energy, abilities) apply before the limits, so nothing can push past them.
 */
export function getEffectiveStats(c: Character, modifiers: Modifier[] = [], mode: 'ranked' | 'career' = 'ranked'): Effective {
  const career = mode === 'career';
  const P = career ? CAREER.perPoint : PER_POINT;
  const lim = career ? CAREER.clamp : 0.1;
  const v5 = edition === 5, V = V5_STATS;
  const [smLo, smHi0] = career ? CAREER.smash : [0.95, 1.08];
  const smHi = v5 ? (career ? V.careerSmashHi : V.rankedSmashHi) : smHi0;
  const top = v5 ? V.maxStat : 35;
  const src = career ? (c.base_stats ?? c.stats).map((v) => v * careerMult(c)) : c.stats;
  // 5.0: high stats count less past 35 (soft cap), so the 200-total players aren't absurd.
  const soft = (x: number) => (!v5 || x <= V.softFrom ? x : V.softFrom + (x - V.softFrom) * V.softRate);
  const raw = src.map((v) => clamp(v, 10, career ? top * careerMult(c) : top) - 20);
  const [p, , n, d, st0] = raw.map(soft);
  // 5.0: slot 3 is Reach (Defence's jobs, plus extra reach in career too), slot 4 is Accuracy (aim on every
  // shot; Stamina's tiring is gone: the Rested bar and coaches do that now).
  const acc = v5 ? st0 : 0, st = v5 ? 0 : st0;
  // 4.1: diminishing returns on Speed above 30: each point past it counts half. 5.0: past 40, a quarter.
  const sp0 = raw[1];
  const sp = sp0 <= 10 ? sp0 : !v5 || sp0 <= V.speedSoft2 ? 10 + (sp0 - 10) * 0.5 : 15 + (sp0 - V.speedSoft2) * V.speedRate2;
  const J = STAT_JOBS;
  const e: Effective = {
    smash: 1 + P.power * p,
    clearDepth: 1 + P.power * p,
    move: 1 + P.speed * sp,
    swingWait: 1 - P.speed * sp,
    netAim: 1 - P.netAim * n,
    netTiming: 1 + P.netTiming * n,
    defenceTiming: 1 + P.defenceTiming * d,
    defenceDepth: 1 - P.defenceDepth * d,
    timing: 1, aim: v5 ? 1 - (career ? V5_STATS.accCareer : V5_STATS.acc) * acc : 1,
    shotSpeed: career ? 1 : 1 + J.drivePerPower * p,
    netClearance: career ? 1 : 1 - J.netClearancePerNet * n,
    defReach: career && !v5 ? 0 : J.defReachPerDefence * d * (v5 && career ? V5_STATS.reachCareer : 1),
    // 3.9: career has no energy any more, so Stamina works there through tiring too.
    fatigue: 1 - J.fatiguePerStamina * st,
    heavy: career ? 1 : 1 + J.heavyPerPower * p,
    netMove: career ? 1 : 1 + J.netMovePerNet * n,
  };
  for (const m of modifiers) for (const k of Object.keys(m) as (keyof Effective)[]) if (e[k] !== undefined) (e as unknown as Record<string, number>)[k] *= m[k] ?? 1;
  for (const k of Object.keys(e) as Exclude<keyof Effective, 'backhandPower' | 'backhandNoise' | 'killMargin'>[]) {
    e[k] = k === 'smash' ? clamp(e[k], smLo, smHi)
      : k === 'netClearance' ? clamp(e[k], ...J.netClearance)
      : k === 'defReach' ? clamp(e[k], ...J.defReach)
      : k === 'heavy' ? clamp(e[k], ...J.heavy)
      : k === 'fatigue' ? clamp(e[k], ...J.fatigue)
      : k === 'move' && career ? clamp(e[k], 1 - lim, 1 + CAREER.moveMax)
      : (k === 'move' || k === 'swingWait') && !career && v5 ? clamp(e[k], 1 - V.rankedMoveLim, 1 + V.rankedMoveLim)
      : k === 'move' || k === 'swingWait' || career ? clamp(e[k], 1 - lim, 1 + lim)
      : clamp(e[k], 1 - J.otherLim * (v5 ? V.otherLimMult : 1), 1 + J.otherLim * (v5 ? V.otherLimMult : 1));
  }
  return e;
}

export const statTotal = (c: Character) => c.stats.reduce((a, b) => a + b, 0);
