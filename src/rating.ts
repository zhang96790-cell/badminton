// Ranking tiers shown next to ratings (everyone starts at 1000, which is Silver).

export interface Tier { name: string; color: string }

const TIERS: [min: number, tier: Tier][] = [
  [1500, { name: 'Champion', color: '#c084fc' }],
  [1300, { name: 'Platinum', color: '#67e8f9' }],
  [1100, { name: 'Gold', color: '#fbbf24' }],
  [900, { name: 'Silver', color: '#cbd5e1' }],
  [0, { name: 'Bronze', color: '#d08a52' }],
];

export const tierOf = (rating: number): Tier => TIERS.find(([min]) => rating >= min)![1];
