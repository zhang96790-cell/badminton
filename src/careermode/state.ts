// Career state and the rules that change it (entering events, playing rounds, money, energy, weeks).
// The state is the save; everything else (draws, NPC results, rankings) is worked out by World.
import { CAREER as CAREER_STATS, characterById, type Character, type Modifier } from '../../shared/characters';
import { PERK_TEXT, SPONSOR_BRANDS, eventLook, perkOf, type SponsorPerk } from '../brands';
import { CAREER_CFG as CFG, TIER_LABEL, type Difficulty, type HotelTier, type Round, type StaffRole, type TravelClass } from './config';
import { COUNTRIES, World, YOU, absWeek, pointsFor, calendar, cpuLevelFor, hash, nextRound, playOut, rng, roundsFor, travelBand, type Band, type PlayerResult, type TourEvent } from './world';
import type { Level } from '../config';

export interface LedgerLine { year: number; week: number; label: string; amount: number }
export interface RecruitOffer { id: number; tournamentId: string; candidates: string[]; rerolled: boolean; place?: 1 | 2 | 3 }

/** A tournament being played. */
export interface Active {
  eventId: string; year: number; week: number;
  /** Who you're playing as. */
  as: string;
  /** The round you play next (or are playing). */
  round: Round;
  opponents: string[];
  scores: [number, number][][];
  travel: number; hotel: number; business: boolean;
  /** The travel class and hotel booked for this event. */
  travelClass?: TravelClass; hotelTier?: HotelTier;
  /** Set once at the start of each match. */
  energyAtMatch?: number;
  /** A Local Club Open (offered when money runs out). */
  club?: boolean;
  /** 3.4.1: entered after early rounds became one game. Events entered before keep best of 3 throughout. */
  shortEarly?: boolean;
  /** Lost the semi-final: next is the match for 3rd place (against the other losing semi-finalist). */
  bronze?: boolean;
  /** A match left part-way (Save and leave): its score, so it carries on from any computer. */
  live?: LiveMatch;
  /** 3.19: going through qualifying: the round you're on and your two opponents. Gone once you're through. */
  qual?: { stage: 1 | 2; opps: [string, string] };
  /** 3.19: came through qualifying: the event pays your travel and hotel. */
  covered?: boolean;
}

/** A career match in progress: which match, and the score at the last serve (Match.snapshot()). */
export interface LiveMatch { eventId: string; round: Round; opp: string; snap: string; rally: boolean }

export interface CareerState {
  v: 1;
  name: string;
  homeCountry: string;
  currentLocation: string;
  characterId: string;
  /** Players you own that you've used or recruited in career. */
  squad: string[];
  money: number;
  energy: number;
  year: number;
  week: number;
  season: number;
  rngSeed: number;
  difficulty: Difficulty;
  history: PlayerResult[];
  pendingRecruitOffer: RecruitOffer | null;
  /** A win that's waiting for its offer to be made (e.g. it was offline). */
  /** place: 1st, 2nd or 3rd (lower-level events offer recruits for any of them; better places get better odds). */
  offerDue: { tournamentId: string; tier: string; field: string[]; place?: 1 | 2 | 3 } | null;
  /** s300 from 3.0; tiers: every level opened by reaching a final at the level below. */
  unlocks: { s300: boolean; tiers?: string[] };
  /** business: 3.0 saves (now travelClass). fasterEarlyRounds: no longer used (early rounds are one game, quarter-finals on best of 3). */
  settings: { fasterEarlyRounds: boolean; business: boolean; travelClass?: TravelClass; hotel?: HotelTier };
  /** Out injured: weeks to go. */
  injury?: { weeks: number } | null;
  staff?: Partial<Record<StaffRole, boolean>>;
  /** 3.14: this career's titles have been added to the account's per-tier title counts. */
  titleTiersSynced?: boolean;
  sponsorRescaled?: boolean;
  sponsor?: Sponsor | null;
  sponsorOffers?: Sponsor[] | null;
  /** 4.1: your world ranking as of the last check (for weekly team costs). */
  bestRankNow?: number | null;
  /** 4.1: set once the Rested bar is in use (older saves start fully rested). */
  restedSince?: string;
  /** 4.1: countries you own a house in (sleep there for free and rest better). */
  houses?: string[];
  /** 4.1: things you've bought or hired (coach tier, staff, upgrades, cosmetics). See the Shop. */
  shop?: Shop;
  /** 3.19: a tour loan you're paying back. */
  loan?: { owed: number; borrowed: number } | null;
  /** Milestones reached (ids), for the trophy cabinet. */
  milestones?: string[];
  /** Careers you've retired (kept when you start again). */
  hallOfFame?: HallEntry[];
  current: Active | null;
  ledger: LedgerLine[];
  titles: number;
  bestRank: number | null;
  /** The season recap to show (the year just finished). */
  recap: number | null;
  startedAt: string;
  /** Which reset this career belongs to (older careers start over). */
  epoch?: string;
}

/** Bump to restart everyone's career the next time they open it. */
export const CAREER_EPOCH = '3.3.1';

export interface Sponsor {
  name: string; weekly: number; bonus: number; band: number; year: number;
  /** 4.2: the brand (src/brands.ts), its perk, a home-country deal, and this season's request. */
  brandId?: string;
  perk?: SponsorPerk | null;
  /** Bonus for every match you win (drinks brands). */
  winBonus?: number;
  /** A brand from your country: double weekly pay in weeks you play an event at home. */
  home?: string;
  /** "Play our event": a bonus for entering it and a bigger one for reaching the quarter-finals. */
  request?: { eventId: string; name: string; enter: number; deep: number; entered?: boolean; paid?: boolean } | null;
}
/** 4.1: the shop. coach: the coach tier you employ; the rest are on/off or levels. */
export interface Shop {
  coach?: string | null;
  fitness?: boolean; nutritionist?: boolean; psychologist?: boolean; stringing?: boolean;
  racket?: string | null;
  /** Training base: region and level. */
  base?: { region: string; level: number } | null;
  /** Stat points gained at training camps: [Power, Speed, Net, Defence, Stamina]. */
  camps?: [number, number, number, number, number];
  cosmetics?: string[];
  equipped?: Record<string, string>;
}
export interface HallEntry { name: string; from: number; to: number; titles: number; bestRank: number | null; golds: number; silvers: number; bronzes: number; prize: number; as: string }

export const APP_VERSION_KEY = '3.0';
// 4.1: seats and hotels matter again (the Rested bar): your choice, economy and a 3-star by default.
export const travelClassOf = (s: CareerState): TravelClass => s.settings.travelClass ?? 'economy';
export const hotelOf = (s: CareerState): HotelTier => s.settings.hotel ?? 'three';

// ── 4.1: the Rested bar and the week's schedule ──
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/**
 * The day a round is played: qualifying and the first round Tuesday (a round of 32 runs Tuesday and Wednesday),
 * round of 16 Thursday, quarter-finals Friday, semi-finals Saturday, final (and bronze) Sunday.
 */
export function roundDay(ev: TourEvent, round: Round, seed: number, qual = false): number {
  if (qual) return 1;
  const order = roundsFor(ev.draw_size);
  const fromEnd = order.length - 1 - order.indexOf(round);
  const day = 6 - fromEnd; // F 6, SF 5, QF 4, R16 3, R32 2, R64 1
  if (round === 'R32' && order[0] === 'R32') return seed % 2 ? 1 : 2; // half the round of 32 on Tuesday
  return Math.max(1, day);
}
export const restedTier = (r: number) => CFG.rested.tiers.find((t) => r >= t.min) ?? CFG.rested.tiers[CFG.rested.tiers.length - 1];
/** How a Rested level plays: slower feet, a later swing, a smaller timing window, and lower down a bit less aim. */
export function restedModifier(r: number): Modifier {
  const t = restedTier(r);
  return t.p ? { move: 1 - t.p, swingWait: 1 + t.p, timing: 1 - t.p, ...(t.aim ? { aim: 1 + t.aim } : {}) } : {};
}
/** What one match takes out of you: its length (shots), a third game and long deuce games. */
export function matchDrain(shots: number, games: [number, number][], pointsToWin: number, s?: CareerState): number {
  const M = CFG.rested.match;
  const raw = M.base + (shots / 10) * M.per10Shots + (games.length >= 3 ? M.thirdGame : 0) + games.filter(([a, b]) => Math.max(a, b) > pointsToWin).length * M.deuceGame;
  return raw * (s?.shop?.coach === 'fitness' || s?.shop?.coach === 'elite' ? 0.8 : 1);
}
const addRest = (s: CareerState, n: number) => { s.energy = Math.max(0, Math.min(100, s.energy + n)); };
/** A night's sleep at this event: your house there, or the hotel you booked (plus a nutritionist). */
export const nightRest = (s: CareerState, ev: TourEvent) =>
  (s.houses?.includes(ev.host_country) ? CFG.rested.house : CFG.rested.night[hotelOf(s)] ?? 10) + (s.shop?.nutritionist ? 5 : 0);
export const travelRestCost = (s: CareerState, ev: TourEvent, cls: TravelClass = travelClassOf(s)) =>
  ev.tier === 'CLUB' ? 0 : Math.round((CFG.rested.travel[travelBand(s.currentLocation, ev.host_country)] ?? 8) * (1 - CFG.travelClass[cls].energySaved));
/** An opponent's Rested going into this round: worked out from the matches the draw gave them (the same every time). */
export function opponentRested(s: CareerState, ev: TourEvent, round: Round, oppId: string): number {
  const order = roundsFor(ev.draw_size), played = Math.max(0, order.indexOf(round));
  const r = rng(hash(s.rngSeed, s.year, ev.id, oppId, 'rest'));
  let v = 75 + r() * 25;
  for (let i = 0; i < played; i++) v = Math.min(100, v - (10 + r() * 26) + 10);
  return Math.round(Math.max(5, v));
}

export function newCareer(o: { name: string; homeCountry: string; characterId: string; difficulty: Difficulty; seed?: number }): CareerState {
  return {
    v: 1, name: o.name.slice(0, 24), homeCountry: o.homeCountry, currentLocation: o.homeCountry, characterId: o.characterId, squad: [o.characterId],
    money: CFG.startMoney, energy: CFG.startEnergy, year: CFG.startYear, week: 1, season: CFG.startYear,
    rngSeed: o.seed ?? Math.floor(Math.random() * 2 ** 31), difficulty: o.difficulty, history: [], pendingRecruitOffer: null, offerDue: null,
    unlocks: { s300: false }, settings: { fasterEarlyRounds: false, business: false, travelClass: 'economy', hotel: 'three' }, current: null, ledger: [], titles: 0, bestRank: null,
    recap: null, startedAt: new Date().toISOString(), epoch: CAREER_EPOCH, injury: null, staff: {}, sponsor: null, sponsorOffers: null, sponsorRescaled: true, milestones: [], hallOfFame: [],
  };
}

/** Older saves → this version (add new fields with safe values). */
export function migrate(raw: unknown): CareerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CareerState>;
  if (s.v !== 1 || !s.characterId) return null;
  // Careers from before this reset start over (3.3.1: everyone restarted).
  if (s.epoch !== CAREER_EPOCH) return null;
  const out = { ...newCareer({ name: s.name ?? 'Player', homeCountry: s.homeCountry ?? 'GBR', characterId: s.characterId, difficulty: s.difficulty ?? 'relaxed', seed: s.rngSeed }), ...s } as CareerState;
  // 3.9: no more energy. Everyone's fresh, uninjured, flies economy and stays in a 3-star; the physio goes.
  if (!out.restedSince) out.energy = 100;
  out.injury = null;
  if (!out.restedSince) { out.settings = { ...out.settings, travelClass: 'economy', business: false, hotel: 'three' }; out.restedSince = '4.1'; }
  if (out.staff?.physio) out.staff.physio = false;

  return out;
}

export const world = (s: CareerState, appVersion: string) =>
  new World({ appVersion, seed: s.rngSeed, startYear: CFG.startYear, year: s.year, week: s.week, history: s.history });

const book = (s: CareerState, label: string, amount: number) => {
  s.money += amount;
  s.ledger.push({ year: s.year, week: s.week, label, amount });
  if (s.ledger.length > 300) s.ledger.splice(0, s.ledger.length - 300);
};

/** Energy multiplier from your Stamina (career stats): more Stamina, less energy used. */
export const staminaFactor = (c: Character) => Math.max(0.6, 1 - ((c.base_stats ?? c.stats)[4] - 20) * CFG.staminaPerPoint);

/** Energy penalty, set once at the start of a match: none from 70 up, down to −8% at 0 (never power or reach). */
export function energyPenalty(energy: number): number {
  return energy >= CFG.energyPenaltyFrom ? 0 : (CFG.maxPenalty * (CFG.energyPenaltyFrom - Math.max(0, energy))) / CFG.energyPenaltyFrom;
}
export function energyModifier(energy: number): Modifier {
  const p = energyPenalty(energy);
  return p ? { move: 1 - p, swingWait: 1 + p, timing: 1 - p } : {};
}
/** A coach: sharper timing and aim in your career matches. */
export const coachModifier = (s: CareerState): Modifier => (s.shop?.coach ? (CFG.coaches[s.shop.coach]?.mod as Modifier) ?? {} : s.staff?.coach ? { timing: 1.03, aim: 0.97 } : {});
/** 4.1: staff, the racket strings and training camps (camp points work like extra stat points). */
export function shopModifier(s: CareerState): Modifier {
  const sh = s.shop ?? {}, c = sh.camps ?? [0, 0, 0, 0, 0], P = CAREER_STATS.perPoint;
  return {
    smash: (1 + P.power * c[0]) * (sh.stringing ? 1.02 : 1), clearDepth: 1 + P.power * c[0],
    move: 1 + P.speed * c[1], swingWait: 1 - P.speed * c[1],
    netAim: 1 - P.netAim * c[2], netTiming: 1 + P.netTiming * c[2],
    defenceTiming: 1 + P.defenceTiming * c[3], defenceDepth: 1 - P.defenceDepth * c[3],
    fatigue: 1 - 0.05 * c[4], timing: sh.psychologist ? 1.02 : 1,
  };
}
/** 4.1: what your staff cost a week (coach and extras). */
export const staffWages = (s: CareerState) => (s.shop?.coach ? CFG.coaches[s.shop.coach]?.wage ?? 0 : 0)
  + (['nutritionist', 'psychologist', 'stringing'] as const).reduce((n, k) => n + (s.shop?.[k] ? CFG.extras[k].wage : 0), 0);
/** The next training camp's price for a stat. */
export const campCost = (s: CareerState, stat: number) => Math.round(CFG.camp.cost * (1 + (s.shop?.camps?.[stat] ?? 0) * CFG.camp.step) * (s.shop?.base ? 1 - CFG.camp.baseDiscount : 1));
export const houseCost = (country: string) => Math.round(CFG.house * (CFG.cityCost[COUNTRIES[country]?.region ?? ''] ?? 1));
export const teamCost = (rank: number | null) => (rank ? CFG.teamCosts.find((b) => rank <= b.rank)?.weekly ?? 0 : 0);
/** Spend money (false if you can't afford it). */
export function buy(s: CareerState, label: string, cost: number): boolean {
  if (s.money < cost) return false;
  book(s, label, -cost);
  return true;
}
/** A week at a training camp: +1 to a stat. Uses the week. */
export function trainingCamp(s: CareerState, stat: number, appVersion: string): boolean {
  const sh = (s.shop ??= {}), c = (sh.camps ??= [0, 0, 0, 0, 0]);
  if (s.current || c[stat] >= CFG.camp.max || !buy(s, `Training camp (${['Power', 'Speed', 'Net', 'Defence', 'Stamina'][stat]})`, campCost(s, stat))) return false;
  c[stat]++;
  advanceWeek(s, 'next', appVersion);
  return true;
}

// ── Calendar and entry ──
export const purseOf = (ev: TourEvent) => (ev.tier === 'CLUB' ? CFG.clubOpen.purse : Math.round(ev.prize_pool_usd * CFG.moneyScale * (CFG.prizeCut[ev.tier] ?? 1)));
export const prizeFor = (ev: TourEvent, round: Round) => Math.round(purseOf(ev) * CFG.prizeShare[round]);
export const travelCost = (s: CareerState, ev: TourEvent, cls: TravelClass = travelClassOf(s)) => {
  if (ev.tier === 'CLUB') return 0;
  const base = CFG.travel[travelBand(s.currentLocation, ev.host_country)];
  return Math.round(base * CFG.travelClass[cls].cost * (CFG.tierCost[ev.tier] ?? 1) * (s.sponsor?.perk === 'flights' ? 0.5 : 1));
};
export const travelEnergy = (s: CareerState, ev: TourEvent, cls: TravelClass = travelClassOf(s)) => {
  if (ev.tier === 'CLUB') return 0;
  const e = CFG.travelEnergy[travelBand(s.currentLocation, ev.host_country) as Band];
  return Math.round(e * (1 - CFG.travelClass[cls].energySaved) * staminaFactor(characterById(s.characterId)));
};
/** A hotel night at this event (Club Opens: you sleep at home). */
export const hotelCost = (s: CareerState, ev: TourEvent, tier: HotelTier = hotelOf(s)) =>
  ev.tier === 'CLUB' || s.houses?.includes(ev.host_country) || s.sponsor?.perk === 'hotels' ? 0 : Math.round(CFG.hotels[tier].perNight * (CFG.cityCost[COUNTRIES[ev.host_country]?.region ?? ''] ?? 1) * (CFG.tierCost[ev.tier] ?? 1));
export const hotelRecover = (ev: TourEvent, tier: HotelTier) => (ev.tier === 'CLUB' ? 2 : CFG.hotels[tier].recover);
/** Energy you'd use going all the way (a guide for the tournament screen). */
export const roundEnergy = (s: CareerState, ev: TourEvent) => (ev.tier === 'CLUB' ? CFG.clubOpen.energyPerRound : CFG.energyPerRound) * staminaFactor(characterById(s.characterId));

export function canEnter(s: CareerState, ev: TourEvent, w: World): { ok: boolean; why?: string; qual?: boolean } {
  if (s.current) return { ok: false, why: 'Finish your current tournament first.' };
  if (s.injury && s.injury.weeks > 0) return { ok: false, why: `You’re injured: ${s.injury.weeks} more week${s.injury.weeks === 1 ? '' : 's'} of rest.` };
  if (s.history.some((h) => h.year === s.year && h.tournamentId === ev.id)) return { ok: false, why: 'You’ve already played this event this season.' };
  if (CFG.closedTiers.includes(ev.tier)) return { ok: false, why: 'Super 500 events and above are locked for now. They open once more players are added.' };
  const gate = (CFG.gates as Record<string, { finalIn?: string; rankAtMost: number } | undefined>)[ev.tier];
  if (gate && !unlocked(s, ev.tier)) {
    const r = myRank(s, w);
    if (!(r !== null && r <= gate.rankAtMost)) {
      const name = TIER_LABEL[ev.tier];
      return { ok: false, why: ev.tier === 'WTF' ? `Only the world’s top ${gate.rankAtMost} play the World Tour Finals.`
        : gate.finalIn ? `${name} events open after you reach a ${TIER_LABEL[gate.finalIn]} final, or a world ranking of ${gate.rankAtMost} or better.`
        : `The ${name} need a world ranking of ${gate.rankAtMost} or better.` };
    }
  }
  // 3.19: short of money? You can still play it: through qualifying (free, and the event pays if you get through).
  if (cantAfford(s, ev) && !hasQualifying(ev)) return { ok: false, why: `You need ${money(travelCost(s, ev) + hotelCost(s, ev))} to go, and this event has no qualifying. Save up, or take a tour loan (Money tab).` };
  if (needsQualifying(s, ev)) return { ok: true, qual: true, why: `You can’t afford the ${money(travelCost(s, ev) + hotelCost(s, ev))} to go, so you’d go through qualifying: win two matches and the event pays your travel and hotel.` };
  return { ok: true };
}

/** 3.19: not enough money to go on tour to this event (or below the tour minimum): qualifying instead. */
export const needsQualifying = (s: CareerState, ev: TourEvent) =>
  hasQualifying(ev) && cantAfford(s, ev);
const cantAfford = (s: CareerState, ev: TourEvent) => ev.tier !== 'CLUB' && (s.money < CFG.tourMinMoney || s.money < travelCost(s, ev) + hotelCost(s, ev));
/** 4.2.2: qualifying only at Super 100s, Super 300s and the Super 500s with a 48-player draw (the ones with a qualifying round). */
export const hasQualifying = (ev: TourEvent) => ev.tier === 'S100' || ev.tier === 'S300' || (ev.tier === 'S500' && ev.draw_size === 48);

// ── 3.19: tour loans ──
/** The most you can borrow, by your best world ranking. */
export const loanLimit = (s: CareerState) => (CFG.loan.limitByRank.find((b) => (s.bestRank ?? 999) <= b.rank) ?? CFG.loan.limitByRank[CFG.loan.limitByRank.length - 1]).max;
export const loanOptions = (s: CareerState) => (s.loan ? [] : CFG.loan.amounts.filter((a) => a <= loanLimit(s)));
export const loanOwed = (amount: number, s?: CareerState) => Math.round(amount * (1 + CFG.loan.fee * (s?.sponsor?.perk === 'loans' ? 1 / 3 : 1)));
export function takeLoan(s: CareerState, amount: number): boolean {
  if (s.loan || !loanOptions(s).includes(amount)) return false;
  s.loan = { owed: loanOwed(amount, s), borrowed: amount };
  book(s, 'Tour loan', amount);
  return true;
}
/** Pay back as much as you can (or all of it). */
export function repayLoan(s: CareerState, amount?: number) {
  if (!s.loan) return;
  const pay = Math.max(0, Math.min(s.loan.owed, Math.max(0, s.money), amount ?? Infinity));
  if (!pay) return;
  book(s, 'Loan repayment', -pay);
  s.loan.owed -= pay;
  if (s.loan.owed <= 0) s.loan = null;
}

/** Levels you've opened by reaching a final at the level below (Super 300 from 3.0 saves too). */
export const unlocked = (s: CareerState, tier: string) => (tier === 'S300' && s.unlocks.s300) || !!s.unlocks.tiers?.includes(tier);

/** This week's events you haven't played yet (usually one; some weeks have two to choose from). */
export const eventsThisWeek = (s: CareerState, appVersion: string) =>
  calendar(appVersion, s.year).filter((e) => e.week === s.week && !s.history.some((h) => h.year === s.year && h.tournamentId === e.id));
/** This week's event, if there is one (the first enterable of them). */
export const eventThisWeek = (s: CareerState, appVersion: string) => eventsThisWeek(s, appVersion)[0] ?? null;

/** 3.19: the Local Club Open is no longer forced on you when money runs out (qualifying and loans replace it). */
export function softLocked(_s: CareerState, _w: World): boolean { return false; }

export function clubEvent(s: CareerState): TourEvent {
  return { id: `club_open_${s.year}_${s.week}`, name: 'Local Club Open', tier: 'CLUB', host_country: s.currentLocation, city: null, order: 0, week: s.week, draw_size: 16, prize_pool_usd: 0, sponsor: null, released_in: '3.0', enabled: true };
}

export const findEvent = (s: CareerState, id: string, appVersion: string): TourEvent | null =>
  id.startsWith('club_open_') ? clubEvent(s) : calendar(appVersion, s.year).find((e) => e.id === id) ?? null;

export function enter(s: CareerState, ev: TourEvent, w?: World) {
  // 3.19: can't afford it: qualifying (free; the event pays travel and hotel if you get through).
  const qual = !!w && needsQualifying(s, ev);
  const travel = qual ? 0 : travelCost(s, ev);
  const cls = travelClassOf(s);
  if (travel) book(s, `Travel to ${ev.name}`, -travel);
  addRest(s, -travelRestCost(s, ev));
  // 4.2: your sponsor asked you to play this one.
  const rq = s.sponsor?.request;
  if (rq && rq.eventId === ev.id && !rq.entered) { rq.entered = true; book(s, `${s.sponsor!.name}: thanks for playing the ${ev.name}`, rq.enter); }
  s.current = { eventId: ev.id, year: s.year, week: s.week, as: s.characterId, round: roundsFor(ev.draw_size)[0], opponents: [], scores: [], travel, hotel: 0, business: cls === 'business', travelClass: cls, hotelTier: hotelOf(s), club: ev.tier === 'CLUB', shortEarly: true,
    ...(qual ? { qual: { stage: 1 as const, opps: qualifyingOpponents(s, w!, ev) }, covered: true } : {}) };
}

/** Two qualifying opponents: lower-level players for this event (drawn like a Super 100 field). */
function qualifyingOpponents(s: CareerState, w: World, ev: TourEvent): [string, string] {
  const p = w.plan({ ...ev, id: `${ev.id}~qual`, tier: 'S100', draw_size: 16 }, s.year, s.characterId);
  const pool = p.slots.filter((x) => x !== YOU && x !== 'bye');
  const r = rng(hash(s.rngSeed, s.year, ev.id, 'qual'));
  const a = pool.splice(Math.floor(r() * pool.length), 1)[0], b = pool[Math.floor(r() * pool.length)];
  return [a, b];
}

/**
 * Mend a tournament stuck on a round that doesn't exist in its draw (3.3.9 and earlier could save "winner" after
 * a Round of 64 win): the round after the matches you've played. Returns true if it changed anything.
 */
export function repairCurrent(s: CareerState, w: World, appVersion: string): boolean {
  const a = s.current;
  if (!a) return false;
  const ev = findEvent(s, a.eventId, appVersion);
  if (!ev) { s.current = null; return true; }
  const order = roundsFor(ev.draw_size);
  if (order.includes(a.round)) return false;
  a.round = order[Math.min(a.opponents.length, order.length - 1)];
  skipByes(s, w, ev);
  return true;
}

/** A bye: you go straight through to the next round (top seeds in 48-player draws). */
export function skipByes(s: CareerState, w: World, ev: TourEvent) {
  const a = s.current;
  for (let k = 0; a && k < 3; k++) {
    const m = nextMatch(s, w, ev);
    if (!m || m.opponentId !== 'bye') return;
    a.round = nextRound(a.round);
  }
}

/** The bracket for the event you're in (Club Opens are drawn from Commons near you). */
export function currentPlan(s: CareerState, w: World, ev: TourEvent) {
  return w.plan(ev.tier === 'CLUB' ? { ...ev, tier: 'S100' } : ev, s.year, s.current!.as);
}

export interface NextMatch { opponent: Character; opponentId: string; round: Round; level: Level; games: 1 | 3; points: 15 | 21; bronze?: boolean; /** 3.19: a qualifying round (1 or 2). */ qual?: 1 | 2 }

/** Who you play next: the bracket with you winning so far. */
export function nextMatch(s: CareerState, w: World, ev: TourEvent): NextMatch | null {
  const a = s.current;
  if (!a) return null;
  if (a.qual) {
    const q = characterById(a.qual.opps[a.qual.stage - 1]);
    const level = cpuLevelFor(q.rarity, hash(s.rngSeed, s.year, ev.id, 'qual', a.qual.stage, 'level'), ev.tier);
    return { opponent: q, opponentId: q.id, round: a.round, level, games: 1, points: 15, qual: a.qual.stage };
  }
  const p = currentPlan(s, w, ev);
  const order = roundsFor(p.slots.length);
  const ri = order.indexOf(a.round);
  const { rounds } = playOut(p.slots, w.strength, hash(s.rngSeed, s.year, ev.id, 'play'), (x, y) => (x === YOU ? YOU : y === YOU ? YOU : null));
  const alive = rounds[ri];
  const i = alive.indexOf(YOU);
  let oppId = alive[i % 2 === 0 ? i + 1 : i - 1];
  // The bronze match: the other semi-final's loser (the one of that pair who isn't in the final).
  if (a.bronze) {
    const other = i < 2 ? [alive[2], alive[3]] : [alive[0], alive[1]], final = rounds[ri + 1] ?? [];
    oppId = other.find((x) => !final.includes(x)) ?? other[1];
  }
  const opponent = characterById(oppId);
  const level = cpuLevelFor(opponent.rarity, hash(s.rngSeed, s.year, ev.id, a.round, a.bronze ? 'bronze' : '', 'level'), ev.tier);
  // Career matches are best of 3 games to 15 (the new scoring).
  // Early rounds are one game to 15; from the quarter-finals on, best of 3 to 15.
  const early = !!a.shortEarly && (a.round === 'R64' || a.round === 'R32' || a.round === 'R16');
  return { opponent, opponentId: oppId, round: a.round, level, games: early ? 1 : 3, points: 15, bronze: !!a.bronze };
}

/** A match finished: pay the hotel, use energy, and move on (or finish the event). */

export function recordMatch(s: CareerState, w: World, ev: TourEvent, won: boolean, games: [number, number][], opponentId: string, drain = 0): { finished: boolean; result?: PlayerResult; injured?: number; qualified?: boolean } {
  const a = s.current!;
  // 4.1: the match tires you; nights before your next match bring some back.
  const dayBefore = roundDay(ev, a.round, hash(s.rngSeed, ev.id), !!a.qual);
  addRest(s, -drain);
  if (won && s.sponsor?.perk === 'wins' && s.sponsor.winBonus) book(s, `Win bonus: ${s.sponsor.name}`, s.sponsor.winBonus);
  const restUntil = (q: boolean) => { const n = Math.max(0, roundDay(ev, a.round, hash(s.rngSeed, ev.id), q) - dayBefore); addRest(s, n * nightRest(s, ev)); };
  // 3.19: qualifying. Win both and you're in the main draw; lose and you're out (with a few ranking points).
  if (a.qual) {
    const stage = a.qual.stage;
    if (won && stage === 1) { a.qual.stage = 2; return { finished: false }; }
    if (won) { delete a.qual; skipByes(s, w, ev); restUntil(false); return { finished: false, qualified: true }; }
    const pts = Math.round(pointsFor(ev.tier, a.round, ev.draw_size) * CFG.qualifying.lossPoints[stage - 1]);
    const res: PlayerResult = { tournamentId: ev.id, year: s.year, week: s.week, tier: ev.tier, round: a.round, points: pts, prize: 0, costs: 0, opponents: [], scores: [], as: a.as, qual: stage };
    s.history.push(res);
    s.currentLocation = ev.host_country;
    s.current = null;
    return { finished: true, result: res };
  }
  a.opponents.push(opponentId);
  a.scores.push(games);
  const tier = a.hotelTier ?? hotelOf(s);
  if (ev.tier !== 'CLUB' && !a.covered) { const c = hotelCost(s, ev, tier); a.hotel += c; book(s, `Hotel: ${CFG.hotels[tier].label} (${ev.name})`, -c); }
  // 3.9: no energy and no injuries.
  // Lose a semi-final and you play for 3rd place.
  if (a.bronze) return { finished: true, result: finish(s, w, ev, 'SF', false, won ? 3 : 4) };
  if (!won && a.round === 'SF') { a.bronze = true; addRest(s, nightRest(s, ev)); return { finished: false }; }
  if (won && a.round !== 'F') { a.round = nextRound(a.round); skipByes(s, w, ev); restUntil(false); return { finished: false }; }
  const reached: Round = won ? 'W' : a.round;
  return { finished: true, result: finish(s, w, ev, reached) };
}

function finish(s: CareerState, w: World, ev: TourEvent, reached: Round, noReward = false, place?: 3 | 4): PlayerResult {
  const a = s.current!;
  const pts = noReward ? 0 : pointsFor(ev.tier, reached, ev.draw_size);
  // 3rd place pays a little more than 4th (the semi-final prize plus CFG.bronzeBonus).
  const prize = noReward ? 0 : Math.round(prizeFor(ev, reached) * (place === 3 ? 1 + CFG.bronzeBonus : 1));
  if (prize) book(s, `Prize money: ${ev.name}`, prize);
  // 4.2: the sponsor's event: a bonus for reaching the quarter-finals or better.
  const rq = s.sponsor?.request;
  if (rq && rq.eventId === ev.id && !rq.paid && !noReward && ['QF', 'SF', 'F', 'W'].includes(reached)) { rq.paid = true; book(s, `${s.sponsor!.name}: quarter-finals or better at their event`, rq.deep); }
  // 3.19: part of every prize pays off a loan.
  if (prize && s.loan) repayLoan(s, Math.ceil(prize * CFG.loan.repayShare));
  const res: PlayerResult = { tournamentId: ev.id, year: s.year, week: s.week, tier: ev.tier, round: reached, points: pts, prize, costs: a.travel + a.hotel, opponents: a.opponents, scores: a.scores, as: a.as, ...(place ? { place } : {}) };
  s.history.push(res);
  if (ev.tier !== 'CLUB') s.currentLocation = ev.host_country;
  if (reached === 'W') {
    // Local club opens don't count as titles (3.14.1).
    if (ev.tier !== 'CLUB') s.titles++;
    if (s.sponsor && ev.tier !== 'CLUB') book(s, `Title bonus: ${s.sponsor.name}`, s.sponsor.bonus);
  }
  // A final opens the next level up.
  if (reached === 'F' || reached === 'W') {
    if (ev.tier === 'S100') s.unlocks.s300 = true;
    for (const [tier, g] of Object.entries(CFG.gates)) if (g?.finalIn === ev.tier && !unlocked(s, tier)) (s.unlocks.tiers ??= []).push(tier);
  }
  // Recruits: win anything; at the lower levels a final or 3rd place also earns an offer (with worse odds of the rarer players).
  const top: 1 | 2 | 3 | 0 = reached === 'W' ? 1 : reached === 'F' ? 2 : place === 3 ? 3 : 0;
  if (ev.tier !== 'CLUB' && !noReward && (top === 1 || (top > 0 && CFG.recruitTop3.includes(ev.tier)))) {
    const p = currentPlan(s, w, ev);
    s.offerDue = { tournamentId: ev.id, tier: ev.tier, field: p.slots.filter((x) => x !== YOU && x !== 'bye'), place: top as 1 | 2 | 3 };
  }
  s.current = null;
  return res;
}

/** Retire from the event you're in (counts as losing your next round, with no prize for it). */
export function withdraw(s: CareerState, w: World, ev: TourEvent): PlayerResult {
  // 3.19: pulling out of qualifying: out in that qualifying round, nothing earned.
  const q = s.current!.qual;
  if (q) {
    const res: PlayerResult = { tournamentId: ev.id, year: s.year, week: s.week, tier: ev.tier, round: s.current!.round, points: 0, prize: 0, costs: 0, opponents: [], scores: [], as: s.current!.as, qual: q.stage };
    s.history.push(res); s.current = null;
    return res;
  }
  // Withdrawing before playing anyone earns nothing; later, you keep what the round you leave in pays.
  return finish(s, w, ev, s.current!.round, !s.current!.opponents.length, s.current!.bronze ? 4 : undefined);
}

// ── The week ──
export type WeekAction = 'next' | 'rest';
export function advanceWeek(s: CareerState, action: WeekAction, appVersion: string) {
  if (s.current) return;
  void action;
  // 4.1: a week off brings back a lot; the days after an event a little.
  const playedThisWeek = s.history.some((h) => h.year === s.year && h.week === s.week);
  addRest(s, playedThisWeek ? CFG.rested.weekAfterEvent : CFG.rested.weekOff);
  // The week's wages and sponsor money.
  if (s.staff?.coach && !s.shop?.coach) book(s, `${CFG.staff.coach.label}’s wages`, -CFG.staff.coach.wage);
  // 4.1: staff wages and team costs (a bigger team as you climb).
  const wages = staffWages(s);
  if (wages) book(s, 'Staff wages', -wages);
  const tc = teamCost(s.bestRankNow ?? null);
  if (tc) book(s, 'Team costs (travel team)', -tc);
  // A week off at your training base rests you more.
  if (s.shop?.base && !s.history.some((h) => h.year === s.year && h.week === s.week)) addRest(s, CFG.base.restPerLevel * s.shop.base.level);
  if (s.sponsor) book(s, `Sponsor: ${s.sponsor.name}`, s.sponsor.weekly);
  // 4.2: a home-country sponsor pays double in weeks you play an event at home.
  const playedHome = s.history.some((h) => h.year === s.year && h.week === s.week && findEvent(s, h.tournamentId, appVersion)?.host_country === s.homeCountry);
  if (s.sponsor?.home && playedHome) book(s, `Home event bonus: ${s.sponsor.name}`, s.sponsor.weekly);
  if (s.injury && s.injury.weeks > 0) { s.injury.weeks--; if (!s.injury.weeks) s.injury = null; }
  const last = Math.max(...calendar(appVersion, s.year).map((e) => e.week), 1);
  if (s.week >= last || s.week >= 52) {
    // The off-season: fully rested for the new year, sponsors come back with new offers.
    s.recap = s.year; s.year++; s.season = s.year; s.week = 1;
    s.energy = 100; s.injury = null; // a fresh start every season
    if (s.sponsor && s.sponsor.year < s.year) s.sponsor = null;
    // 3.19: a loan still owed grows a little each new season.
    if (s.loan && s.sponsor?.perk !== 'loans') s.loan.owed = Math.round(s.loan.owed * (1 + CFG.loan.seasonInterest));
  }
  else s.week++;
}

/**
 * 4.2: sponsors who'd sign you at this ranking, from the game's real brands. Up to three offers: a big company
 * paying the most, a brand with a perk (airline, hotel, bank, drinks) paying less, and a brand from your own
 * country that pays double in weeks you play at home. Each asks you to play one event this season. Null if unranked.
 */
export function sponsorOffers(s: CareerState, rank: number | null, appVersion = '4.2'): Sponsor[] | null {
  if (!rank) return null;
  const band = CFG.sponsorBands.find((b) => rank <= b.rank);
  if (!band) return null;
  const r = rng(hash(s.rngSeed, s.year, band.rank, 'sponsor'));
  const mix = <T,>(a: T[]) => [...a].sort(() => r() - 0.5);
  const home = mix(SPONSOR_BRANDS.filter((b) => b.country === s.homeCountry));
  const cash = mix(SPONSOR_BRANDS.filter((b) => !perkOf(b.id) && b.country !== s.homeCountry));
  const perk = mix(SPONSOR_BRANDS.filter((b) => perkOf(b.id) && b.country !== s.homeCountry));
  const upcoming = calendar(appVersion, s.year).filter((v) => v.week > s.week && !CFG.closedTiers.includes(v.tier));
  const request = (brandId: string, weekly: number): Sponsor['request'] => {
    const theirs = upcoming.filter((v) => eventLook(v.id, v.tier, v.host_country).sponsors.some((b) => b.id === brandId) || v.host_country === SPONSOR_BRANDS.find((b) => b.id === brandId)?.country);
    const pickFrom = theirs.length ? theirs : upcoming.filter((v) => v.tier === 'S100' || v.tier === 'S300');
    const v = pickFrom[Math.floor(r() * pickFrom.length)];
    return v ? { eventId: v.id, name: v.name, enter: weekly * 3, deep: weekly * 6 } : null;
  };
  const make = (b: (typeof SPONSOR_BRANDS)[number] | undefined, wk: number, bo: number, extra: Partial<Sponsor>): Sponsor | null => {
    if (!b) return null;
    const weekly = Math.round(band.weekly * wk);
    return { name: b.name, brandId: b.id, weekly, bonus: Math.round(band.bonus * bo), band: band.rank, year: s.year, request: request(b.id, weekly), ...extra };
  };
  const p = perk[0], pk = p ? perkOf(p.id) : null;
  return [
    make(cash[0], CFG.sponsorSteady.weekly, CFG.sponsorSteady.bonus, { perk: null }),
    make(p, 0.6, 0.6, { perk: pk, ...(pk === 'wins' ? { winBonus: Math.round(band.bonus * 0.15) } : {}) }),
    make(home[0], 0.9, 1, { home: s.homeCountry, perk: perkOf(home[0]?.id ?? '') }),
  ].filter((x): x is Sponsor => !!x);
}
export const perkText = (p: SponsorPerk | null | undefined) => (p ? PERK_TEXT[p] : '');
/** 3.14.3: a deal signed before the sponsor cut drops to the new rates for its band (keeping its steady or bonus style). */
export function rescaleSponsor(s: CareerState): boolean {
  const sp = s.sponsor;
  if (!sp || s.sponsorRescaled) return false;
  s.sponsorRescaled = true;
  const band = CFG.sponsorBands.find((b) => b.rank === sp.band);
  if (!band) return true;
  const style = sp.bonus > band.bonus * 3 ? CFG.sponsorBonusy : CFG.sponsorSteady;
  sp.weekly = Math.min(sp.weekly, Math.round(band.weekly * style.weekly));
  sp.bonus = Math.min(sp.bonus, Math.round(band.bonus * style.bonus));
  return true;
}
/** A better sponsor deal is on offer (you're in a better ranking band than your sponsor's). */
export const sponsorUpgrade = (s: CareerState, rank: number | null, appVersion?: string) => {
  const offers = sponsorOffers(s, rank, appVersion);
  return offers && (!s.sponsor || offers[0].band < s.sponsor.band || s.sponsor.year < s.year) ? offers : null;
};

export function setStaff(s: CareerState, role: StaffRole, on: boolean) { (s.staff ??= {})[role] = on; }

// ── Trophies, milestones and retirement ──
export interface Milestone { id: string; label: string; done: boolean }
const MEDAL: Partial<Record<Round, 'gold' | 'silver' | 'bronze'>> = { W: 'gold', F: 'silver', SF: 'bronze' };
// Since 3.5 the semi-final losers play for bronze: only 3rd place gets it (older results kept theirs).
export const medalOf = (h: PlayerResult) => (h.tier === 'OLYMPICS' || h.tier === 'WORLDS' ? (h.place === 4 ? null : MEDAL[h.round] ?? null) : null);

export function milestones(s: CareerState): Milestone[] {
  const h = s.history, won = (tier?: string) => h.some((x) => x.round === 'W' && (!tier || x.tier === tier));
  const best = s.bestRank ?? 9999;
  return [
    { id: 'first_win', label: 'Win a match', done: h.some((x) => (x.opponents?.length ?? 0) >= 2 || x.round === 'W') },
    { id: 'first_title', label: 'Win a title', done: won() },
    { id: 'title_s300', label: 'Win a Super 300', done: won('S300') },
    { id: 'title_s500', label: 'Win a Super 500', done: won('S500') },
    { id: 'title_s750', label: 'Win a Super 750', done: won('S750') },
    { id: 'title_s1000', label: 'Win a Super 1000', done: won('S1000') },
    { id: 'top100', label: 'Reach the world top 100', done: best <= 100 },
    { id: 'top50', label: 'Reach the world top 50', done: best <= 50 },
    { id: 'top10', label: 'Reach the world top 10', done: best <= 10 },
    { id: 'number1', label: 'Become world number 1', done: best <= 1 },
    { id: 'worlds_medal', label: 'Win a World Championships medal', done: h.some((x) => x.tier === 'WORLDS' && !!medalOf(x)) },
    { id: 'olympic_medal', label: 'Win an Olympic medal', done: h.some((x) => x.tier === 'OLYMPICS' && !!medalOf(x)) },
    { id: 'olympic_gold', label: 'Win Olympic gold', done: h.some((x) => x.tier === 'OLYMPICS' && x.round === 'W') },
    { id: 'wtf', label: 'Win the World Tour Finals', done: won('WTF') },
    { id: 'titles10', label: 'Win 10 titles', done: s.titles >= 10 },
    { id: 'titles25', label: 'Win 25 titles', done: s.titles >= 25 },
  ];
}
/** Milestones reached since last checked (and remembers them). */
export function newMilestones(s: CareerState): Milestone[] {
  const seen = new Set(s.milestones ?? []);
  const fresh = milestones(s).filter((m) => m.done && !seen.has(m.id));
  s.milestones = [...seen, ...fresh.map((m) => m.id)];
  return fresh;
}

/** Retire: your career goes into the Hall of Fame (kept for your next career). */
export function retire(s: CareerState): HallEntry[] {
  const medals = s.history.map(medalOf);
  const entry: HallEntry = {
    name: s.name, from: CFG.startYear, to: s.year, titles: s.titles, bestRank: s.bestRank, as: characterById(s.characterId).name,
    golds: medals.filter((m) => m === 'gold').length, silvers: medals.filter((m) => m === 'silver').length, bronzes: medals.filter((m) => m === 'bronze').length,
    prize: s.history.reduce((t, h) => t + h.prize, 0),
  };
  return [...(s.hallOfFame ?? []), entry];
}

export const refuelCost = (s: CareerState, kind: 'food' | 'physio') => (kind === 'physio' && s.staff?.physio ? Math.round(CFG.physio.cost / 2) : CFG[kind].cost);
export function refuel(s: CareerState, kind: 'food' | 'physio'): boolean {
  const o = CFG[kind], cost = refuelCost(s, kind);
  if (s.money < cost) return false;
  book(s, kind === 'food' ? 'Good food' : 'Physio session', -cost);
  s.energy = Math.min(100, s.energy + o.energy);
  return true;
}

export function payFor(s: CareerState, label: string, amount: number): boolean {
  if (s.money < amount) return false;
  book(s, label, -amount);
  return true;
}

/** Your world ranking (null = no points yet). */
export function myRank(s: CareerState, w: World, at = absWeek(s.year, s.week)): number | null {
  const list = w.rankingAt(at);
  const i = list.findIndex((x) => x.id === YOU);
  return i < 0 || list[i].pts <= 0 ? null : i + 1;
}

export const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
