// Career mode numbers, all in one place. Tuned with the economy simulation (docs/3.0-notes.md).
import type { Level } from '../config';
import type { Rarity } from '../../shared/characters';

export type Tier = 'S100' | 'S300' | 'S500' | 'S750' | 'S1000' | 'WTF' | 'WORLDS' | 'OLYMPICS';
export type Round = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F' | 'W';
export type Difficulty = 'relaxed' | 'normal' | 'hard';
export type TravelClass = 'economy' | 'premium' | 'business';
export type HotelTier = 'hostel' | 'three' | 'four' | 'five';
export type StaffRole = 'coach' | 'physio';

export const CAREER_CFG = {
  dataVersion: 1,
  startYear: 2027,
  startMoney: 1500,
  startEnergy: 100,

  // ── Prize money ──
  /** Purse = prize_pool_usd × moneyScale (a Super 100's 140k is a 14,000 purse). */
  moneyScale: 0.1,
  /** Share of the purse by how far you got. The winner gets 7.5%; losing early still pays a little. */
  prizeShare: { W: 0.075, F: 0.058, SF: 0.046, QF: 0.036, R16: 0.012, R32: 0.006, R64: 0.003 } as Record<Round, number>,

  // ── Travel, hotels, recovery (3.3: "Hard": energy is scarce and recovering costs real money) ──
  travel: { domestic: 200, regional: 550, intercontinental: 1200 },
  /** Travel classes: price × economy, and the share of the travel energy they save. */
  travelClass: {
    economy: { label: 'Economy', cost: 1, energySaved: 0 },
    premium: { label: 'Premium economy', cost: 1.6, energySaved: 0.25 },
    business: { label: 'Business', cost: 2.6, energySaved: 0.45 },
  } as Record<TravelClass, { label: string; cost: number; energySaved: number }>,
  /** Hotels: price a night (× the city's cost) and energy back each night. You stay one night per round you play. */
  hotels: {
    hostel: { label: 'Hostel', perNight: 25, recover: 0, note: 'Cheap, noisy, no real rest' },
    three: { label: '3-star', perNight: 70, recover: 2, note: 'A decent night’s sleep' },
    four: { label: '4-star', perNight: 160, recover: 4, note: 'Good rest and a proper breakfast' },
    five: { label: '5-star by the venue', perNight: 380, recover: 7, note: 'The best rest, no commute' },
  } as Record<HotelTier, { label: string; perNight: number; recover: number; note: string }>,
  /** How expensive each region's hotels are. */
  cityCost: { SEA: 0.8, 'SOUTH ASIA': 0.7, 'EAST ASIA': 1.2, EUROPE: 1.3, AMERICAS: 1.3, OCEANIA: 1.25, 'MIDDLE EAST': 1.1, AFRICA: 0.8 } as Record<string, number>,
  food: { cost: 90, energy: 5 },
  physio: { cost: 450, energy: 15 },
  rest: { cost: 200, energy: 10 },
  /** A week where you don't play or rest gives nothing back (3.3). */
  idleWeekEnergy: 0,

  // ── Energy ──
  /** Energy used per round played, and for travelling. */
  energyPerRound: 16,
  travelEnergy: { domestic: 6, regional: 15, intercontinental: 28 },
  /** No penalty from this energy up; below it, a straight line down to `maxPenalty` at 0. */
  energyPenaltyFrom: 70,
  maxPenalty: 0.08,
  /** Stamina (career stats) changes energy use: each point above 20 uses this much less. */
  staminaPerPoint: 0.015,
  /** Starting a match below this energy risks an injury: (threshold − energy) × perPoint, at most max. */
  injury: { below: 25, perPoint: 0.02, max: 0.5, weeks: [2, 4] as [number, number], treatment: 600 },

  // ── Staff and sponsors ──
  staff: {
    coach: { label: 'Coach', wage: 250, note: 'Sharper timing and aim in your matches (+3%).' },
    physio: { label: 'Physio', wage: 200, note: '+4 energy every week, half the injury risk, physio sessions half price.' },
  } as Record<StaffRole, { label: string; wage: number; note: string }>,
  /** Sponsor pay by world ranking band: per week, and a bonus per title. */
  sponsorBands: [
    { rank: 10, weekly: 900, bonus: 5000 }, { rank: 20, weekly: 500, bonus: 2500 }, { rank: 50, weekly: 250, bonus: 1200 },
    { rank: 100, weekly: 120, bonus: 600 }, { rank: 200, weekly: 60, bonus: 300 },
  ],
  sponsorNames: ['Northwind Sports', 'Apex Strings', 'Kestrel Air', 'Lumen Water', 'Halcyon Energy', 'Orbit Shoes', 'Tidal Telecom', 'Granite Insurance', 'Summit Grip', 'Blue Heron Bank'],

  // ── Recruiting ──
  recruitCost: { common: 600, rare: 1800, super_rare: 4000, epic: 8000, elite: 15000, mythic: 25000, legendary: 40000, champion: 60000 } as Record<Rarity, number>,
  rerollCost: 150,

  // ── Soft-lock protection ──
  /** Offered free when you can't afford any event: 16 players, tiny prize, small energy cost. */
  clubOpen: { purse: 900, energyPerRound: 4, tier: 'CLUB' as const },

  // ── Entry ──
  /**
   * What opens each level: reaching a final at the level below, or a world ranking this good. Worlds and the
   * World Tour Finals go by ranking only (the Finals take the world's top 8 that week).
   */
  gates: {
    S300: { finalIn: 'S100', rankAtMost: 150 },
    S500: { finalIn: 'S300', rankAtMost: 100 },
    S750: { finalIn: 'S500', rankAtMost: 60 },
    S1000: { finalIn: 'S750', rankAtMost: 40 },
    WORLDS: { rankAtMost: 64 },
    WTF: { rankAtMost: 8 },
    OLYMPICS: { rankAtMost: 32 },
  } as Partial<Record<Tier, { finalIn?: Tier; rankAtMost: number }>>,
  /**
   * Who's in a draw, by rarity weight. Anyone can appear anywhere (stars play the big events, even ones you
   * can't recruit yet); what you can recruit is a separate list (obtainable).
   */
  fieldWeights: {
    S100: { common: 70, rare: 24, super_rare: 6 },
    S300: { common: 35, rare: 42, super_rare: 18, epic: 5 },
    S500: { common: 12, rare: 33, super_rare: 32, epic: 18, elite: 5 },
    S750: { rare: 18, super_rare: 32, epic: 30, elite: 14, mythic: 4, legendary: 2 },
    S1000: { rare: 8, super_rare: 22, epic: 32, elite: 20, mythic: 10, legendary: 6, champion: 2 },
    WORLDS: { common: 6, rare: 16, super_rare: 24, epic: 28, elite: 14, mythic: 7, legendary: 4, champion: 1 },
    OLYMPICS: { rare: 10, super_rare: 22, epic: 30, elite: 18, mythic: 10, legendary: 7, champion: 3 },
  } as Partial<Record<Tier, Partial<Record<Rarity, number>>>>,
  /** Who you can recruit after winning each level (the owner's table). */
  obtainable: {
    S100: ['common'], S300: ['common', 'rare'], S500: ['common', 'rare', 'super_rare'], S750: ['super_rare', 'epic'],
    S1000: ['epic', 'elite', 'mythic'], WTF: ['elite', 'mythic', 'legendary'], WORLDS: ['mythic', 'legendary', 'champion'], OLYMPICS: ['legendary', 'champion'],
  } as Partial<Record<Tier, Rarity[]>>,
  /** Chance per draw of a Champion wildcard (0: champions already play the big events by weight). */
  wildcardChance: {} as Partial<Record<Tier, number>>,
  minHostPlayers: 2,
  maxPerCountry: 4,

  // ── World ranking points (TODO-verify against the 2027 BWF points table) ──
  points: {
    S100: { W: 5500, F: 4680, SF: 3850, QF: 3030, R16: 2110, R32: 1290, R64: 680 },
    S300: { W: 7000, F: 5950, SF: 4900, QF: 3850, R16: 2750, R32: 1670, R64: 920 },
    S500: { W: 9200, F: 7800, SF: 6420, QF: 5040, R16: 3600, R32: 2220, R64: 1220 },
    S750: { W: 11000, F: 9350, SF: 7700, QF: 6050, R16: 4320, R32: 2660, R64: 1460 },
    S1000: { W: 12000, F: 10200, SF: 8400, QF: 6600, R16: 4800, R32: 3000, R64: 1680 },
    WORLDS: { W: 13000, F: 11000, SF: 9200, QF: 7200, R16: 5300, R32: 3600, R64: 2000 },
    WTF: { W: 15000, F: 12800, SF: 10500, QF: 8800, R16: 0, R32: 0, R64: 0 },
    /** The real Olympics give no ranking points; the game gives Worlds-like points so they count. */
    OLYMPICS: { W: 14000, F: 12000, SF: 10000, QF: 7800, R16: 5600, R32: 3800, R64: 2000 },
    CLUB: { W: 300, F: 240, SF: 180, QF: 120, R16: 60, R32: 30, R64: 15 },
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
  tierLevelBonus: { CLUB: 0, S100: 0, S300: 1, S500: 1, S750: 2, S1000: 2, WORLDS: 2, WTF: 2, OLYMPICS: 2 } as Record<string, number>,

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
  worldEvents: {} as Partial<Record<Tier, number>>,
  /** Players in better form enter more events: entry weight × e^(form / formEntry). */
  formEntry: 5,
};

/** The career ladder: level 1 is Hard (the easiest career opponent), level 6 Legend. */
export const LEVELS: Level[] = ['hard', 'expert', 'pro', 'elite', 'world', 'legend'];
export const ROUND_LABEL: Record<Round, string> = { R64: 'Round of 64', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', F: 'Final', W: 'Winner' };
export const TIER_LABEL: Record<string, string> = { S100: 'Super 100', S300: 'Super 300', S500: 'Super 500', S750: 'Super 750', S1000: 'Super 1000', WTF: 'World Tour Finals', WORLDS: 'World Championships', OLYMPICS: 'Olympics', CLUB: 'Local club open' };
