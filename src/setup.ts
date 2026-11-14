// MatchSetup: one description of a match that every match start goes through. Today's flows build it
// from the menu settings; later features (daily challenges, career) will build their own.
import { DEFAULT_CHARACTER, type Modifier } from '../shared/characters';
import type { Level, Style } from './config';

export type SetupMode = 'cpu' | 'ranked' | 'friendly' | 'practice' | 'career' | 'daily';

export interface Restrictions {
  /** You can't smash (hard overheads become drives). */
  noSmash?: boolean;
  /** You can't drop (soft overheads become clears). */
  noDropShot?: boolean;
  /** The opponent moves this much faster or slower. */
  opponentSpeedMult?: number;
  /** The game starts at this score (you, them). */
  startScore?: [number, number];
}

/** Career and the daily challenge use career stats (base stats × career strength, wider limits). */
export const usesCareerStats = (mode: SetupMode) => mode === 'career' || mode === 'daily';

export interface MatchSetup {
  mode: SetupMode;
  format: { games: 1 | 3; points: 11 | 15 | 21 };
  /** modifiers: energy and the like (career). abilities: signature effects switched on for this match. */
  player: { characterId: string; modifiers?: Modifier[]; abilities?: boolean };
  opponent: { kind: 'cpu' | 'remote'; characterId?: string; cpuLevel?: Level; style?: Style; modifiers?: Modifier[]; abilities?: boolean };
  /** Restrictions from a mode itself (the daily challenge), applied even outside development. */
  forced?: boolean;
  /** What to call the match on the scoreboard (e.g. the event and round). */
  label?: string;
  restrictions: Restrictions;
}

/** Restrictions are a developer tool for now: they only apply on the dev server or with this flag set. */
export function restrictionsAllowed(): boolean {
  if (import.meta.env.DEV) return true;
  try { return localStorage.getItem('badminton.dev') === '1'; } catch { return false; }
}

export function defaultSetup(mode: SetupMode, games: 1 | 3, points: 11 | 15 | 21, characterId = DEFAULT_CHARACTER): MatchSetup {
  return { mode, format: { games, points }, player: { characterId }, opponent: { kind: mode === 'ranked' || mode === 'friendly' ? 'remote' : 'cpu' }, restrictions: {} };
}
