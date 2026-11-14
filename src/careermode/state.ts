// Career state and the rules that change it (entering events, playing rounds, money, energy, weeks).
// The state is the save; everything else (draws, NPC results, rankings) is worked out by World.
import { characterById, type Character, type Modifier } from '../../shared/characters';
import { CAREER_CFG as CFG, TIER_LABEL, type Difficulty, type HotelTier, type Round, type StaffRole, type TravelClass } from './config';
import { COUNTRIES, World, YOU, absWeek, pointsFor, calendar, cpuLevelFor, hash, nextRound, playOut, rng, roundsFor, travelBand, type Band, type PlayerResult, type TourEvent } from './world';
import type { Level } from '../config';
import { energyUseFactor } from './signatures';

export interface LedgerLine { year: number; week: number; label: string; amount: number }
export interface RecruitOffer { id: number; tournamentId: string; candidates: string[]; rerolled: boolean }

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
}

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
  offerDue: { tournamentId: string; tier: string; field: string[] } | null;
  /** s300 from 3.0; tiers: every level opened by reaching a final at the level below. */
  unlocks: { s300: boolean; tiers?: string[] };
  /** business: 3.0 saves (now travelClass). fasterEarlyRounds: no longer used (career is best of 3 to 15). */
  settings: { fasterEarlyRounds: boolean; business: boolean; travelClass?: TravelClass; hotel?: HotelTier };
  /** Out injured: weeks to go. */
  injury?: { weeks: number } | null;
  staff?: Partial<Record<StaffRole, boolean>>;
  sponsor?: Sponsor | null;
  sponsorOffers?: Sponsor[] | null;
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

export interface Sponsor { name: string; weekly: number; bonus: number; band: number; year: number }
export interface HallEntry { name: string; from: number; to: number; titles: number; bestRank: number | null; golds: number; silvers: number; bronzes: number; prize: number; as: string }

export const APP_VERSION_KEY = '3.0';
export const travelClassOf = (s: CareerState): TravelClass => s.settings.travelClass ?? (s.settings.business ? 'business' : 'economy');
export const hotelOf = (s: CareerState): HotelTier => s.settings.hotel ?? 'three';

export function newCareer(o: { name: string; homeCountry: string; characterId: string; difficulty: Difficulty; seed?: number }): CareerState {
  return {
    v: 1, name: o.name.slice(0, 24), homeCountry: o.homeCountry, currentLocation: o.homeCountry, characterId: o.characterId, squad: [o.characterId],
    money: CFG.startMoney, energy: CFG.startEnergy, year: CFG.startYear, week: 1, season: CFG.startYear,
    rngSeed: o.seed ?? Math.floor(Math.random() * 2 ** 31), difficulty: o.difficulty, history: [], pendingRecruitOffer: null, offerDue: null,
    unlocks: { s300: false }, settings: { fasterEarlyRounds: false, business: false, travelClass: 'economy', hotel: 'three' }, current: null, ledger: [], titles: 0, bestRank: null,
    recap: null, startedAt: new Date().toISOString(), epoch: CAREER_EPOCH, injury: null, staff: {}, sponsor: null, sponsorOffers: null, milestones: [], hallOfFame: [],
  };
}

/** Older saves → this version (add new fields with safe values). */
export function migrate(raw: unknown): CareerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CareerState>;
  if (s.v !== 1 || !s.characterId) return null;
  // Careers from before this reset start over (3.3.1: everyone restarted).
  if (s.epoch !== CAREER_EPOCH) return null;
  return { ...newCareer({ name: s.name ?? 'Player', homeCountry: s.homeCountry ?? 'GBR', characterId: s.characterId, difficulty: s.difficulty ?? 'relaxed', seed: s.rngSeed }), ...s } as CareerState;
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
export const coachModifier = (s: CareerState): Modifier => (s.staff?.coach ? { timing: 1.03, aim: 0.97 } : {});

// ── Calendar and entry ──
export const purseOf = (ev: TourEvent) => (ev.tier === 'CLUB' ? CFG.clubOpen.purse : Math.round(ev.prize_pool_usd * CFG.moneyScale));
export const prizeFor = (ev: TourEvent, round: Round) => Math.round(purseOf(ev) * CFG.prizeShare[round]);
export const travelCost = (s: CareerState, ev: TourEvent, cls: TravelClass = travelClassOf(s)) => {
  if (ev.tier === 'CLUB') return 0;
  const base = CFG.travel[travelBand(s.currentLocation, ev.host_country)];
  return Math.round(base * CFG.travelClass[cls].cost);
};
export const travelEnergy = (s: CareerState, ev: TourEvent, cls: TravelClass = travelClassOf(s)) => {
  if (ev.tier === 'CLUB') return 0;
  const e = CFG.travelEnergy[travelBand(s.currentLocation, ev.host_country) as Band];
  return Math.round(e * (1 - CFG.travelClass[cls].energySaved) * staminaFactor(characterById(s.characterId)));
};
/** A hotel night at this event (Club Opens: you sleep at home). */
export const hotelCost = (s: CareerState, ev: TourEvent, tier: HotelTier = hotelOf(s)) =>
  ev.tier === 'CLUB' ? 0 : Math.round(CFG.hotels[tier].perNight * (CFG.cityCost[COUNTRIES[ev.host_country]?.region ?? ''] ?? 1));
export const hotelRecover = (ev: TourEvent, tier: HotelTier) => (ev.tier === 'CLUB' ? 2 : CFG.hotels[tier].recover);
/** Energy you'd use going all the way (a guide for the tournament screen). */
export const roundEnergy = (s: CareerState, ev: TourEvent) => (ev.tier === 'CLUB' ? CFG.clubOpen.energyPerRound : CFG.energyPerRound) * staminaFactor(characterById(s.characterId));

export function canEnter(s: CareerState, ev: TourEvent, w: World): { ok: boolean; why?: string } {
  if (s.current) return { ok: false, why: 'Finish your current tournament first.' };
  if (s.injury && s.injury.weeks > 0) return { ok: false, why: `You’re injured: ${s.injury.weeks} more week${s.injury.weeks === 1 ? '' : 's'} of rest.` };
  if (s.history.some((h) => h.year === s.year && h.tournamentId === ev.id)) return { ok: false, why: 'You’ve already played this event this season.' };
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
  const cost = travelCost(s, ev) + hotelCost(s, ev);
  if (s.money < cost) return { ok: false, why: `You need ${money(cost)} for travel and your first hotel night.` };
  return { ok: true };
}

/** Levels you've opened by reaching a final at the level below (Super 300 from 3.0 saves too). */
export const unlocked = (s: CareerState, tier: string) => (tier === 'S300' && s.unlocks.s300) || !!s.unlocks.tiers?.includes(tier);

/** This week's events you haven't played yet (usually one; some weeks have two to choose from). */
export const eventsThisWeek = (s: CareerState, appVersion: string) =>
  calendar(appVersion, s.year).filter((e) => e.week === s.week && !s.history.some((h) => h.year === s.year && h.tournamentId === e.id));
/** This week's event, if there is one (the first enterable of them). */
export const eventThisWeek = (s: CareerState, appVersion: string) => eventsThisWeek(s, appVersion)[0] ?? null;

/** Nothing you can afford for the rest of the season: offer the free Local Club Open. */
export function softLocked(s: CareerState, w: World): boolean {
  if (s.current) return false;
  const upcoming = w.cal.filter((e) => e.week >= s.week);
  const cheapest = Math.min(...(upcoming.length ? upcoming : w.cal).map((e) => travelCost(s, e, 'economy') + hotelCost(s, e, 'hostel')));
  return s.money < cheapest;
}

export function clubEvent(s: CareerState): TourEvent {
  return { id: `club_open_${s.year}_${s.week}`, name: 'Local Club Open', tier: 'CLUB', host_country: s.currentLocation, city: null, order: 0, week: s.week, draw_size: 16, prize_pool_usd: 0, sponsor: null, released_in: '3.0', enabled: true };
}

export const findEvent = (s: CareerState, id: string, appVersion: string): TourEvent | null =>
  id.startsWith('club_open_') ? clubEvent(s) : calendar(appVersion, s.year).find((e) => e.id === id) ?? null;

export function enter(s: CareerState, ev: TourEvent) {
  const travel = travelCost(s, ev);
  const cls = travelClassOf(s);
  if (travel) book(s, `Travel to ${ev.name} (${CFG.travelClass[cls].label.toLowerCase()})`, -travel);
  s.energy = Math.max(0, s.energy - travelEnergy(s, ev));
  s.current = { eventId: ev.id, year: s.year, week: s.week, as: s.characterId, round: roundsFor(ev.draw_size)[0], opponents: [], scores: [], travel, hotel: 0, business: cls === 'business', travelClass: cls, hotelTier: hotelOf(s), club: ev.tier === 'CLUB' };
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

export interface NextMatch { opponent: Character; opponentId: string; round: Round; level: Level; games: 1 | 3; points: 15 | 21 }

/** Who you play next: the bracket with you winning so far. */
export function nextMatch(s: CareerState, w: World, ev: TourEvent): NextMatch | null {
  const a = s.current;
  if (!a) return null;
  const p = currentPlan(s, w, ev);
  const order = roundsFor(p.slots.length);
  const ri = order.indexOf(a.round);
  const { rounds } = playOut(p.slots, w.strength, hash(s.rngSeed, s.year, ev.id, 'play'), (x, y) => (x === YOU ? YOU : y === YOU ? YOU : null));
  const alive = rounds[ri];
  const i = alive.indexOf(YOU);
  const oppId = alive[i % 2 === 0 ? i + 1 : i - 1];
  const opponent = characterById(oppId);
  const level = cpuLevelFor(opponent.rarity, hash(s.rngSeed, s.year, ev.id, a.round, 'level'), ev.tier);
  // Career matches are best of 3 games to 15 (the new scoring).
  return { opponent, opponentId: oppId, round: a.round, level, games: 3, points: 15 };
}

/** A match finished: pay the hotel, use energy, and move on (or finish the event). */
const rngFor = (s: CareerState, ev: TourEvent, k: string) => rng(hash(s.rngSeed, s.year, ev.id, k, 'injury', s.history.length));

export function recordMatch(s: CareerState, w: World, ev: TourEvent, won: boolean, games: [number, number][], opponentId: string): { finished: boolean; result?: PlayerResult; injured?: number } {
  const a = s.current!;
  a.opponents.push(opponentId);
  a.scores.push(games);
  const tier = a.hotelTier ?? hotelOf(s);
  if (ev.tier !== 'CLUB') { const c = hotelCost(s, ev, tier); a.hotel += c; book(s, `Hotel: ${CFG.hotels[tier].label} (${ev.name})`, -c); }
  s.energy = Math.max(0, Math.round(s.energy - roundEnergy(s, ev) * energyUseFactor(characterById(a.as), a.energyAtMatch ?? s.energy)));
  // A night's rest in the hotel.
  s.energy = Math.min(100, s.energy + hotelRecover(ev, tier));
  // Played very tired: a chance of an injury (a physio halves it). Out of the event and off for a few weeks.
  const start = a.energyAtMatch ?? 100, I = CFG.injury;
  if (start < I.below && rngFor(s, ev, a.round)() < Math.min(I.max, (I.below - start) * I.perPoint) * (s.staff?.physio ? 0.5 : 1)) {
    const weeks = I.weeks[0] + Math.floor(rngFor(s, ev, `${a.round}w`)() * (I.weeks[1] - I.weeks[0] + 1));
    s.injury = { weeks };
    book(s, 'Injury treatment', -Math.round(I.treatment * (s.staff?.physio ? 0.5 : 1)));
    if (won && a.round !== 'F') { a.round = nextRound(a.round); return { finished: true, result: finish(s, w, ev, a.round), injured: weeks }; }
    return { finished: true, result: finish(s, w, ev, won ? 'W' : a.round), injured: weeks };
  }
  if (won && a.round !== 'F') { a.round = nextRound(a.round); skipByes(s, w, ev); return { finished: false }; }
  const reached: Round = won ? 'W' : a.round;
  return { finished: true, result: finish(s, w, ev, reached) };
}

function finish(s: CareerState, w: World, ev: TourEvent, reached: Round, noReward = false): PlayerResult {
  const a = s.current!;
  const pts = noReward ? 0 : pointsFor(ev.tier, reached, ev.draw_size);
  const prize = noReward ? 0 : prizeFor(ev, reached);
  if (prize) book(s, `Prize money: ${ev.name}`, prize);
  const res: PlayerResult = { tournamentId: ev.id, year: s.year, week: s.week, tier: ev.tier, round: reached, points: pts, prize, costs: a.travel + a.hotel, opponents: a.opponents, scores: a.scores, as: a.as };
  s.history.push(res);
  if (ev.tier !== 'CLUB') s.currentLocation = ev.host_country;
  if (reached === 'W') {
    s.titles++;
    if (s.sponsor && ev.tier !== 'CLUB') book(s, `Title bonus: ${s.sponsor.name}`, s.sponsor.bonus);
  }
  // A final opens the next level up.
  if (reached === 'F' || reached === 'W') {
    if (ev.tier === 'S100') s.unlocks.s300 = true;
    for (const [tier, g] of Object.entries(CFG.gates)) if (g?.finalIn === ev.tier && !unlocked(s, tier)) (s.unlocks.tiers ??= []).push(tier);
  }
  if (reached === 'W' && ev.tier !== 'CLUB') {
    const p = currentPlan(s, w, ev);
    s.offerDue = { tournamentId: ev.id, tier: ev.tier, field: p.slots.filter((x) => x !== YOU && x !== 'bye') };
  }
  s.current = null;
  return res;
}

/** Retire from the event you're in (counts as losing your next round, with no prize for it). */
export function withdraw(s: CareerState, w: World, ev: TourEvent): PlayerResult {
  // Withdrawing before playing anyone earns nothing; later, you keep what the round you leave in pays.
  return finish(s, w, ev, s.current!.round, !s.current!.opponents.length);
}

// ── The week ──
export type WeekAction = 'next' | 'rest';
export function advanceWeek(s: CareerState, action: WeekAction, appVersion: string) {
  if (s.current) return;
  if (action === 'rest') { book(s, 'Rest week (living costs)', -CFG.rest.cost); s.energy = Math.min(100, s.energy + CFG.rest.energy); }
  else s.energy = Math.min(100, s.energy + CFG.idleWeekEnergy);
  // The week's wages and sponsor money; a physio keeps you ticking over.
  for (const role of ['coach', 'physio'] as StaffRole[]) if (s.staff?.[role]) book(s, `${CFG.staff[role].label}’s wages`, -CFG.staff[role].wage);
  if (s.staff?.physio) s.energy = Math.min(100, s.energy + 4);
  if (s.sponsor) book(s, `Sponsor: ${s.sponsor.name}`, s.sponsor.weekly);
  if (s.injury && s.injury.weeks > 0) { s.injury.weeks--; if (!s.injury.weeks) s.injury = null; }
  const last = Math.max(...calendar(appVersion, s.year).map((e) => e.week), 1);
  if (s.week >= last || s.week >= 52) {
    // The off-season: fully rested for the new year, sponsors come back with new offers.
    s.recap = s.year; s.year++; s.season = s.year; s.week = 1;
    s.energy = 100; s.injury = null;
    if (s.sponsor && s.sponsor.year < s.year) s.sponsor = null;
  }
  else s.week++;
}

/** Sponsors who'd pay you at this ranking (two offers: steady pay, or bigger title bonuses). Null if unranked. */
export function sponsorOffers(s: CareerState, rank: number | null): Sponsor[] | null {
  if (!rank) return null;
  const band = CFG.sponsorBands.find((b) => rank <= b.rank);
  if (!band) return null;
  const r = rng(hash(s.rngSeed, s.year, band.rank, 'sponsor'));
  const names = [...CFG.sponsorNames].sort(() => r() - 0.5);
  return [
    { name: names[0], weekly: Math.round(band.weekly * 1.3), bonus: Math.round(band.bonus * 0.5), band: band.rank, year: s.year },
    { name: names[1], weekly: Math.round(band.weekly * 0.6), bonus: Math.round(band.bonus * 2), band: band.rank, year: s.year },
  ];
}
/** A better sponsor deal is on offer (you're in a better ranking band than your sponsor's). */
export const sponsorUpgrade = (s: CareerState, rank: number | null) => {
  const offers = sponsorOffers(s, rank);
  return offers && (!s.sponsor || offers[0].band < s.sponsor.band || s.sponsor.year < s.year) ? offers : null;
};

export function setStaff(s: CareerState, role: StaffRole, on: boolean) { (s.staff ??= {})[role] = on; }

// ── Trophies, milestones and retirement ──
export interface Milestone { id: string; label: string; done: boolean }
const MEDAL: Partial<Record<Round, 'gold' | 'silver' | 'bronze'>> = { W: 'gold', F: 'silver', SF: 'bronze' };
export const medalOf = (h: PlayerResult) => (h.tier === 'OLYMPICS' || h.tier === 'WORLDS' ? MEDAL[h.round] ?? null : null);

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
