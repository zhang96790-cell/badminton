// Characters: who you play as. Five stats (Power, Speed, Net, Defence, Stamina), each 10–35, with 20 in
// every stat being exactly today's player. The roster lives in src/roster/roster.json (the owner fills it
// in; see docs/roster-guide.md). Shared by the game and the room server.
import roster from '../src/roster/roster.json';

export const STAT_NAMES = ['Power', 'Speed', 'Net', 'Defence', 'Stamina'] as const;
export type Stats = [power: number, speed: number, net: number, defence: number, stamina: number];

export const RARITIES = ['common', 'rare', 'super_rare', 'epic', 'elite', 'mythic', 'legendary', 'champion'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * Per rarity: the label, the five-stat total a character of that rarity must have, and a frame colour.
 * Colours are picked to stay distinct for colour-blind players, and every card also shows the label.
 */
export const RARITY: Record<Rarity, { label: string; budget: number; color: string }> = {
  common: { label: 'Common', budget: 100, color: '#9aa4b2' },
  rare: { label: 'Rare', budget: 101, color: '#4d9de0' },
  super_rare: { label: 'Super Rare', budget: 103, color: '#2ec4b6' },
  epic: { label: 'Epic', budget: 104, color: '#8a5cf6' },
  elite: { label: 'Elite', budget: 106, color: '#e15a97' },
  mythic: { label: 'Mythic', budget: 107, color: '#f08a24' },
  legendary: { label: 'Legendary', budget: 109, color: '#f2c14e' },
  champion: { label: 'Champion', budget: 110, color: '#f5f5f5' },
};

export const STYLES = ['all-rounder', 'attacker', 'defender', 'net player', 'deceptive', 'fast retriever', 'defensive wall'] as const;
export type CharStyle = (typeof STYLES)[number];

export interface Character {
  id: string;
  name: string;
  /** ISO 3166 alpha-3, e.g. GBR. */
  country: string;
  rarity: Rarity;
  style: CharStyle;
  handedness: 'right' | 'left';
  stats: Stats;
  /** Not used until 3.0. */
  career_strength: number;
  released_in: string;
  enabled: boolean;
  description: string;
}

/** The one character everyone always has (never locked). */
export const DEFAULT_CHARACTER = 'default_player';

export const ROSTER: Character[] = (roster.characters as Character[]).filter((c) => c.enabled);

export function characterById(id: string | null | undefined): Character {
  return ROSTER.find((c) => c.id === id) ?? ROSTER.find((c) => c.id === DEFAULT_CHARACTER)!;
}

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
}

export const NEUTRAL: Effective = { smash: 1, clearDepth: 1, move: 1, swingWait: 1, netAim: 1, netTiming: 1, defenceTiming: 1, defenceDepth: 1 };

/** How much each point away from 20 changes things (tuned with simulations; see docs/2.7-notes.md). */
export const PER_POINT = { power: 0.005, speed: 0.007, netAim: 0.01, netTiming: 0.006, defenceTiming: 0.01, defenceDepth: 0.004 };

/** Later systems (training, form, …) add modifiers; 2.7 has none. */
export type Modifier = Partial<Record<keyof Effective, number>>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const within10 = (v: number) => clamp(v, 0.9, 1.1);

/** The single place gameplay reads a character's stats from. */
export function getEffectiveStats(c: Character, modifiers: Modifier[] = []): Effective {
  const [p, sp, n, d] = c.stats.map((s) => clamp(s, 10, 35) - 20);
  const e: Effective = {
    smash: clamp(1 + PER_POINT.power * p, 0.95, 1.08),
    clearDepth: within10(1 + PER_POINT.power * p),
    move: within10(1 + PER_POINT.speed * sp),
    swingWait: within10(1 - PER_POINT.speed * sp),
    netAim: within10(1 - PER_POINT.netAim * n),
    netTiming: within10(1 + PER_POINT.netTiming * n),
    defenceTiming: within10(1 + PER_POINT.defenceTiming * d),
    defenceDepth: within10(1 - PER_POINT.defenceDepth * d),
  };
  for (const m of modifiers) for (const k of Object.keys(m) as (keyof Effective)[]) e[k] *= m[k] ?? 1;
  return e;
}

export const statTotal = (c: Character) => c.stats.reduce((a, b) => a + b, 0);
