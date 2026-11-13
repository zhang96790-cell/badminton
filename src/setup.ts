// MatchSetup: one description of a match that every match start goes through. Today's flows build it
// from the menu settings; later features (daily challenges, career) will build their own.
import { DEFAULT_CHARACTER } from '../shared/characters';
import type { Level, Style } from './config';

export type SetupMode = 'cpu' | 'ranked' | 'friendly' | 'practice';

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

export interface MatchSetup {
  mode: SetupMode;
  format: { games: 1 | 3; points: 15 | 21 };
  player: { characterId: string };
  opponent: { kind: 'cpu' | 'remote'; characterId?: string; cpuLevel?: Level; style?: Style };
  restrictions: Restrictions;
}

/** Restrictions are a developer tool for now: they only apply on the dev server or with this flag set. */
export function restrictionsAllowed(): boolean {
  if (import.meta.env.DEV) return true;
  try { return localStorage.getItem('badminton.dev') === '1'; } catch { return false; }
}

export function defaultSetup(mode: SetupMode, games: 1 | 3, points: 15 | 21, characterId = DEFAULT_CHARACTER): MatchSetup {
  return { mode, format: { games, points }, player: { characterId }, opponent: { kind: mode === 'ranked' || mode === 'friendly' ? 'remote' : 'cpu' }, restrictions: {} };
}
