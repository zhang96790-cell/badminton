// Career mode numbers, all in one place. Tuned with the economy simulation (docs/3.0-notes.md).
import type { Level } from '../config';
import type { Rarity } from '../../shared/characters';

export type Tier = 'S100' | 'S300' | 'S500' | 'S750' | 'S1000' | 'WTF' | 'WORLDS' | 'OLYMPICS';
export type Round = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F' | 'W';
export type Difficulty = 'relaxed' | 'normal' | 'hard';
export type TravelClass = 'economy' | 'premium' | 'business' | 'first';
export type HotelTier = 'hostel' | 'three' | 'four' | 'five';
export type StaffRole = 'coach' | 'physio';

export const CAREER_CFG = {
  dataVersion: 1,
  startYear: 2027,
  startMoney: 2500,
  startEnergy: 100,

  // ── Prize money ──
  /** Purse = prize_pool_usd × moneyScale (a Super 100's 140k is a 14,000 purse). */
  moneyScale: 0.11,
  /** Share of the purse by how far you got. The winner gets 7.5%; losing early still pays a little. */
  prizeShare: { W: 0.058, F: 0.044, SF: 0.035, QF: 0.028, R16: 0.014, R32: 0.007, R64: 0.004 } as Record<Round, number>,

  // ── Travel, hotels, recovery (3.3: "Hard": energy is scarce and recovering costs real money) ──
  // 4.4.7: flights were out of scale with the (game-sized) prize money: a long-haul trip cost more than winning a Super 100.
  travel: { domestic: 80, regional: 220, intercontinental: 450 },
  /** Travel classes: price × economy, and the share of the travel energy they save. */
  travelClass: {
    economy: { label: 'Economy', cost: 1, energySaved: 0 },
    premium: { label: 'Premium economy', cost: 1.6, energySaved: 0.25 },
    business: { label: 'Business', cost: 2.6, energySaved: 0.5 },
    first: { label: 'First class', cost: 4.2, energySaved: 0.8 },
  } as Record<TravelClass, { label: string; cost: number; energySaved: number }>,
  /** Hotels: price a night (× the city's cost) and energy back each night. You stay one night per round you play. */
  hotels: {
    hostel: { label: 'Hostel', perNight: 18, recover: 0, note: 'Cheap, noisy, no real rest' },
    three: { label: '3-star', perNight: 60, recover: 2, note: 'A decent night’s sleep' },
    four: { label: '4-star', perNight: 110, recover: 4, note: 'Good rest and a proper breakfast' },
    five: { label: '5-star by the venue', perNight: 260, recover: 7, note: 'The best rest, no commute' },
  } as Record<HotelTier, { label: string; perNight: number; recover: number; note: string }>,
  /** How expensive each region's hotels are. */
  cityCost: { SEA: 0.8, 'SOUTH ASIA': 0.7, 'EAST ASIA': 1.2, EUROPE: 1.3, AMERICAS: 1.3, OCEANIA: 1.25, 'MIDDLE EAST': 1.1, AFRICA: 0.8 } as Record<string, number>,
  food: { cost: 60, energy: 5 },
  physio: { cost: 300, energy: 15 },
  rest: { cost: 120, energy: 30 },
  /** A week where you don't play still gives some energy back (3.5.1). */
  idleWeekEnergy: 10,

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
  injury: { below: 25, perPoint: 0.02, max: 0.5, weeks: [2, 4] as [number, number], treatment: 400 },

  // ── Staff and sponsors ──
  staff: {
    coach: { label: 'Coach', wage: 250, note: 'Sharper timing and aim in your matches (+3%).' },
    physio: { label: 'Physio', wage: 200, note: '+4 energy every week, half the injury risk, physio sessions half price.' },
  } as Record<StaffRole, { label: string; wage: number; note: string }>,
  /**
   * Sponsor pay by world ranking band: per week, and a bonus per title. 3.14.3: cut to about a third (was 900/5000,
   * 500/2500, 250/1200, 120/600, 60/300): the top bonus was over 10× the prize for winning a Super 100.
   */
  sponsorBands: [
    { rank: 10, weekly: 300, bonus: 1000 }, { rank: 20, weekly: 200, bonus: 600 }, { rank: 50, weekly: 120, bonus: 350 },
    { rank: 100, weekly: 70, bonus: 200 }, { rank: 200, weekly: 35, bonus: 100 },
  ],
  /** The two offers: steady (more weekly, smaller bonus) or bonus-heavy (less weekly, bigger bonus). */
  sponsorSteady: { weekly: 1.2, bonus: 0.5 },
  sponsorBonusy: { weekly: 0.6, bonus: 1.6 },
  sponsorNames: ['Northwind Sports', 'Apex Strings', 'Kestrel Air', 'Lumen Water', 'Halcyon Energy', 'Orbit Shoes', 'Tidal Telecom', 'Granite Insurance', 'Summit Grip', 'Blue Heron Bank'],

  // ── Recruiting ──
  /** Lower-level events: 1st, 2nd and 3rd all get a recruit offer (better places, better odds). Elsewhere only the winner. */
  recruitTop3: ['S100', 'S300', 'S500'] as string[],
  /** 3rd place: the semi-final prize plus this share. */
  bronzeBonus: 0.15,
  // 3.12.1: you earned the offer, so Commons are free and the rest cost far less (was 600 / 1800 / 4000 / 8000 / 15000 / 25000 / 40000 / 60000).
  /** 3.12.7: what you pay of recruitCost by where you finished (Commons have their own: free if you win). */
  recruitPlaceShare: { 1: 0.5, 2: 0.75, 3: 1 } as Record<1 | 2 | 3, number>,
  recruitCommonShare: { 1: 0, 2: 0.5, 3: 1 } as Record<1 | 2 | 3, number>,
  recruitCost: { common: 300, rare: 400, super_rare: 900, epic: 1800, elite: 3500, mythic: 6000, legendary: 10000, champion: 15000 } as Record<Rarity, number>,
  rerollCost: 150,

  // ── Soft-lock protection ──
  /** Offered free when you can't afford any event: 16 players, tiny prize, small energy cost. */
  clubOpen: { purse: 6000, energyPerRound: 4, tier: 'CLUB' as const },
  /** 3.9.4: bigger events cost more to attend (flights and hotels × this), so money stays tight as you climb. */
  tierCost: { S100: 1, S300: 1.15, S500: 1.35, S750: 1.65, S1000: 2, WTF: 2.2, WORLDS: 2, OLYMPICS: 2.2 } as Record<string, number>,
  /** 3.9.1: below this much money you can't go on tour: Club Opens only until you've earned it back. */
  tourMinMoney: 1500,
  /**
   * 5.0 entry lists (v5 only), like the real tour: a world ranking this good gets you straight into the main draw;
   * a bit lower and you go through qualifying (only where an event has it; Super 100s take anyone into qualifying).
   * Worlds, Olympics and the Tour Finals keep their rank limits (top 64, 32 and 8).
   */
  entryList: {
    S100: { direct: 140, qual: 999 }, S300: { direct: 90, qual: 180 }, S500: { direct: 55, qual: 110 },
    S750: { direct: 36, qual: 0 }, S1000: { direct: 26, qual: 0 }, WORLDS: { direct: 64, qual: 0 }, OLYMPICS: { direct: 32, qual: 0 }, WTF: { direct: 8, qual: 0 },
  } as Record<string, { direct: number; qual: number }>,
  /** 5.0 (v5 only): every round pays: early rounds pay this much more, and a qualifying loss pays a share of the first-round prize. */
  everyRoundPays: { early: 1.8, qualLoss: [0.25, 0.45] as [number, number] },
  /** 5.0: the semi-fresh start keeps at most this much money. */
  v5MoneyCap: 25000,
  /** 4.1: the big events pay less (prizes there grew much faster than costs). Purse × this. */
  // 4.4.7: the small events pay more, so going deep at a Super 100 or 300 pays for the trip.
  prizeCut: { S100: 1.8, S300: 1.6, S500: 1.3, S750: 0.65, S1000: 0.62, WORLDS: 0.62, WTF: 0.6, OLYMPICS: 0.6 } as Record<string, number>,
  /** 4.1: your team grows as you climb: weekly costs by world ranking. */
  teamCosts: [{ rank: 10, weekly: 900 }, { rank: 20, weekly: 600 }, { rank: 50, weekly: 350 }, { rank: 100, weekly: 180 }],
  /** 4.1: coaches. One at a time; each has its own perk (and gives you notes after every match). */
  coaches: {
    club: { label: 'Club coach', wage: 150, perk: 'Slightly better timing (+2%).', mod: { timing: 1.02 } },
    technical: { label: 'Technical coach', wage: 300, perk: 'More accurate net shots and aim.', mod: { netAim: 0.94, aim: 0.97 } },
    fitness: { label: 'Fitness coach', wage: 300, perk: 'You tire 20% slower and stay sharper in long rallies.', mod: { fatigue: 0.85 } },
    tactical: { label: 'Tactical analyst', wage: 350, perk: 'Scouting notes before every match, and sharper defence (+3%).', mod: { defenceTiming: 1.03 } },
    elite: { label: 'Elite head coach', wage: 900, perk: 'A bit of everything: timing, aim and stamina, and you tire 20% slower.', mod: { timing: 1.03, aim: 0.97, fatigue: 0.92 } },
  } as Record<string, { label: string; wage: number; perk: string; mod: Record<string, number> }>,
  /** 4.1: other staff and upgrades (weekly). */
  extras: {
    nutritionist: { label: 'Nutritionist', wage: 120, perk: '+5% Rested every night at an event.' },
    psychologist: { label: 'Sports psychologist', wage: 200, perk: 'Steadier under pressure: a little better timing (+2%).' },
    stringing: { label: 'Stringing service', wage: 80, perk: 'Freshly strung rackets: smashes 2% harder.' },
  } as Record<string, { label: string; wage: number; perk: string }>,
  /** 4.1: a custom racket in your colours (once). */
  rackets: { cost: 6000, colours: ['Gold', 'Black and red', 'White and blue', 'Neon green', 'Purple'] },
  /** 4.4.3: the frame colour each custom racket is drawn in. */
  racketHex: { Gold: '#f2c230', 'Black and red': '#e01b2f', 'White and blue': '#3d7bff', 'Neon green': '#39ff14', Purple: '#9b4dff' } as Record<string, string>,
  /**
   * 4.4.3: training camps: a week and money for +3 to a stat (at most 5 camps per stat). Each one costs more.
   * A training base adds +1 more to every camp per base level (so +4, +5 or +6), instead of the old discount.
   */
  camp: { cost: 3000, step: 0.5, max: 5, points: 3, basePerLevel: 1, staminaPerPoint: 0.03, baseDiscount: 0.7 },
  /** 4.1: a training base: weeks off rest you more (+10 a level) and camps give more (+1 a level). */
  base: { buy: 25000, upgrade: [15000, 30000], restPerLevel: 10 },
  /** 4.1: a house in a country: free nights and +25% Rested a night at events there. Price × the city's cost. */
  house: 30000,
  /** 4.4.2: house prices: × the region's cost × (0.2 + 0.6 × events there a season) × the local property market. */
  housePerEvent: 0.6,
  houseMarket: {
    SGP: 2.2, HKG: 2.0, SUI: 1.8, MAC: 1.5, ENG: 1.5, JPN: 1.3, USA: 1.3, DEN: 1.2, AUS: 1.2, FRA: 1.2, GER: 1.1, KOR: 1.1, CAN: 1.1,
    TPE: 1.0, CHN: 0.9, FIN: 0.9, MAS: 0.75, THA: 0.7, INA: 0.65, IND: 0.6, VIE: 0.55, PHI: 0.55,
  } as Record<string, number>,
  /** 4.1: walk-on looks (cosmetic). */
  walkOns: { gold: { label: 'Gold', cost: 2500 }, fire: { label: 'Fire', cost: 2500 }, ice: { label: 'Ice', cost: 2500 }, royal: { label: 'Royal purple', cost: 4000 } } as Record<string, { label: string; cost: number }>,
  /**
   * 4.1: the Rested bar (replaces the old energy). Matches tire you by how long they were; travel tires you by
   * distance and seat; nights in a hotel (or your own house) and weeks off bring it back. Being low never stops
   * you playing, it just makes you slower and less sharp, more so the lower you go.
   */
  rested: {
    // 4.4.4: nothing below 60% happens until you're under it; then mostly timing and aim (movement a little).
    tiers: [
      { min: 80, label: 'Fresh', p: 0, aim: 0 },
      { min: 60, label: 'Good', p: 0, aim: 0 },
      { min: 45, label: 'Tired', p: 0.03, aim: 0 },
      { min: 30, label: 'Weary', p: 0.05, aim: 0.02 },
      { min: 18, label: 'Exhausted', p: 0.08, aim: 0.04 },
      { min: 8, label: 'Drained', p: 0.11, aim: 0.06 },
      { min: 0, label: 'Running on empty', p: 0.14, aim: 0.09 },
    ],
    /** 4.4.4: how a tier's penalty splits: movement gets this share, timing and aim more. */
    effect: { move: 0.2, timing: 1.3, aim: 1.2 }, // 4.4.5: movement much less (was 0.5)
    /** 4.4.4: adrenaline: being tired hurts this much in a semi-final (×) and final / bronze match (×). */
    adrenaline: { SF: 0.5, F: 0 },
    match: { base: 3, per10Shots: 0.5, thirdGame: 6, deuceGame: 2 },
    travel: { domestic: 3, regional: 8, intercontinental: 15 } as Record<string, number>,
    night: { hostel: 8, three: 16, four: 22, five: 30 } as Record<string, number>,
    /** A night in your own house (an event in a country where you own one). */
    house: 25,
    weekOff: 35,
    weekAfterEvent: 15,
  },
  /**
   * 3.19: can't afford an event? Go through qualifying instead: two one-game matches against lower-level
   * players, free, with travel and hotel paid by the event if you get through. Losing still earns a share of the
   * first-round ranking points (round 1 loss, round 2 loss).
   */
  qualifying: { rounds: 2, lossPoints: [0.25, 0.5] as [number, number] },
  /**
   * 3.19: a tour loan. Borrow once at a time; you owe it back plus the fee. A share of every prize goes to it
   * automatically, you can pay it off any time, and anything still owed grows by seasonInterest each new season.
   * How much you can borrow depends on your best world ranking.
   */
  loan: { fee: 0.15, repayShare: 0.4, seasonInterest: 0.1, amounts: [1500, 3000, 6000, 12000, 25000],
    limitByRank: [{ rank: 20, max: 25000 }, { rank: 50, max: 12000 }, { rank: 100, max: 6000 }, { rank: 999, max: 3000 }] },

  // ── Entry ──
  /**
   * What opens each level: reaching a final at the level below, or a world ranking this good. Worlds and the
   * World Tour Finals go by ranking only (the Finals take the world's top 8 that week).
   */
  /** Levels closed to everyone for now (3.14.2): Super 500 and up wait until more players are in the game. */
  closedTiers: ['S500', 'S750', 'S1000', 'WTF', 'WORLDS', 'OLYMPICS'] as string[],
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
