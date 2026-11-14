// Characters: who you play as. Five stats (Power, Speed, Net, Defence, Stamina), each 10–35, with 20 in
// every stat being exactly today's player. The roster lives in src/roster/roster.json (the owner fills it
// in; see docs/roster-guide.md). Shared by the game and the room server.
import roster from '../src/roster/roster.json';
import rosterConfig from '../src/roster/roster-config.json';

export const STAT_NAMES = ['Power', 'Speed', 'Net', 'Defence', 'Stamina'] as const;
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

export const STYLES = ['all-rounder', 'attacker', 'defender', 'net player', 'deceptive', 'fast retriever', 'defensive wall'] as const;
export type CharStyle = (typeof STYLES)[number];

/** A signature or skill: what it's called and its plain-language text (numbers live in data/signatures.json). */
export interface Ability { id: string; tier: 'S' | 'SS'; name: string; text: string; slot: 'signature' | 'skill' }

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
export function characterById(id: string | null | undefined): Character {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_CHARACTER)!;
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
export const rosterFor = (appVersion: string) => ROSTER.filter((c) => releasedIn(c, appVersion));

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
}

export const NEUTRAL: Effective = { smash: 1, clearDepth: 1, move: 1, swingWait: 1, netAim: 1, netTiming: 1, defenceTiming: 1, defenceDepth: 1, timing: 1, aim: 1, shotSpeed: 1 };

/** How much each point away from 20 changes things (tuned with simulations; see docs/2.7-notes.md). */
export const PER_POINT = { power: 0.005, speed: 0.007, netAim: 0.01, netTiming: 0.006, defenceTiming: 0.01, defenceDepth: 0.004 };

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
  perPoint: { power: 0.016, speed: 0.024, netAim: 0.032, netTiming: 0.024, defenceTiming: 0.032, defenceDepth: 0.016 },
  clamp: 0.18,
  smash: [0.95, 1.1] as [number, number],
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
  const [smLo, smHi] = career ? CAREER.smash : [0.95, 1.08];
  const src = career ? (c.base_stats ?? c.stats).map((v) => v * careerMult(c)) : c.stats;
  const [p, sp, n, d] = src.map((v) => clamp(v, 10, career ? 35 * careerMult(c) : 35) - 20);
  const e: Effective = {
    smash: 1 + P.power * p,
    clearDepth: 1 + P.power * p,
    move: 1 + P.speed * sp,
    swingWait: 1 - P.speed * sp,
    netAim: 1 - P.netAim * n,
    netTiming: 1 + P.netTiming * n,
    defenceTiming: 1 + P.defenceTiming * d,
    defenceDepth: 1 - P.defenceDepth * d,
    timing: 1, aim: 1, shotSpeed: 1,
  };
  for (const m of modifiers) for (const k of Object.keys(m) as (keyof Effective)[]) e[k] *= m[k] ?? 1;
  for (const k of Object.keys(e) as (keyof Effective)[]) e[k] = k === 'smash' ? clamp(e[k], smLo, smHi) : clamp(e[k], 1 - lim, 1 + lim);
  return e;
}

export const statTotal = (c: Character) => c.stats.reduce((a, b) => a + b, 0);
