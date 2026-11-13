// Ranking tiers (2.7): eight, everyone starts at 1000 (Club). You go up a tier as soon as you reach its
// rating, and only drop back once you're 20 below it (so one bad match on the line doesn't demote you).
// The account server keeps the real tier; these match its numbers for showing progress.

export interface Tier { index: number; name: string; min: number; color: string }

export const TIERS: Tier[] = [
  { index: 0, name: 'Rookie', min: 0, color: '#b08968' },
  { index: 1, name: 'Club', min: 900, color: '#9aa4b2' },
  { index: 2, name: 'Regional', min: 1050, color: '#5fb3a1' },
  { index: 3, name: 'National', min: 1200, color: '#4d9de0' },
  { index: 4, name: 'International', min: 1350, color: '#8a5cf6' },
  { index: 5, name: 'Elite', min: 1500, color: '#e15a97' },
  { index: 6, name: 'World Class', min: 1700, color: '#f08a24' },
  { index: 7, name: 'Legend', min: 1900, color: '#f2c14e' },
];

/** How far below a tier you can fall before you drop out of it. */
export const DEMOTION_BUFFER = 20;

/** The tier a rating reaches on its own (no buffer). */
export const tierIndex = (rating: number): number => { let t = 0; while (t < 7 && rating >= TIERS[t + 1].min) t++; return t; };

/** Your tier after a change, from the tier you had. */
export function tierAfter(rating: number, current: number): number {
  let t = Math.max(current, tierIndex(rating));
  while (t > 0 && rating < TIERS[t].min - DEMOTION_BUFFER) t--;
  return t;
}

/** A rating's tier (or the server's tier, when you have it). */
export const tierOf = (rating: number, serverTier?: number | null): Tier => TIERS[serverTier ?? tierIndex(rating)] ?? TIERS[0];

/** Points to the next tier (null at Legend). */
export const toNext = (rating: number, tier: number): number | null => (tier >= 7 ? null : Math.max(0, TIERS[tier + 1].min - rating));
