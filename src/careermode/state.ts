// Career state and the rules that change it (entering events, playing rounds, money, energy, weeks).
// The state is the save; everything else (draws, NPC results, rankings) is worked out by World.
import { characterById, type Character, type Modifier } from '../../shared/characters';
import { CAREER_CFG as CFG, type Difficulty, type Round } from './config';
import { World, YOU, absWeek, pointsFor, calendar, cpuLevelFor, hash, nextRound, playOut, roundsFor, travelBand, type Band, type PlayerResult, type TourEvent } from './world';
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
  unlocks: { s300: boolean };
  settings: { fasterEarlyRounds: boolean; business: boolean };
  current: Active | null;
  ledger: LedgerLine[];
  titles: number;
  bestRank: number | null;
  /** The season recap to show (the year just finished). */
  recap: number | null;
  startedAt: string;
}

export const APP_VERSION_KEY = '3.0';

export function newCareer(o: { name: string; homeCountry: string; characterId: string; difficulty: Difficulty; seed?: number }): CareerState {
  return {
    v: 1, name: o.name.slice(0, 24), homeCountry: o.homeCountry, currentLocation: o.homeCountry, characterId: o.characterId, squad: [o.characterId],
    money: CFG.startMoney, energy: CFG.startEnergy, year: CFG.startYear, week: 1, season: CFG.startYear,
    rngSeed: o.seed ?? Math.floor(Math.random() * 2 ** 31), difficulty: o.difficulty, history: [], pendingRecruitOffer: null, offerDue: null,
    unlocks: { s300: false }, settings: { fasterEarlyRounds: false, business: false }, current: null, ledger: [], titles: 0, bestRank: null,
    recap: null, startedAt: new Date().toISOString(),
  };
}

/** Older saves → this version (add new fields with safe values). */
export function migrate(raw: unknown): CareerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CareerState>;
  if (s.v !== 1 || !s.characterId) return null;
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

/** Energy penalty, set once at the start of a match: none from 60 up, down to −12% at 0 (never power or reach). */
export function energyPenalty(energy: number): number {
  return energy >= CFG.energyPenaltyFrom ? 0 : (CFG.maxPenalty * (CFG.energyPenaltyFrom - Math.max(0, energy))) / CFG.energyPenaltyFrom;
}
export function energyModifier(energy: number): Modifier {
  const p = energyPenalty(energy);
  return p ? { move: 1 - p, swingWait: 1 + p, timing: 1 - p } : {};
}

// ── Calendar and entry ──
export const purseOf = (ev: TourEvent) => (ev.tier === 'CLUB' ? CFG.clubOpen.purse : Math.round(ev.prize_pool_usd * CFG.moneyScale));
export const prizeFor = (ev: TourEvent, round: Round) => Math.round(purseOf(ev) * CFG.prizeShare[round]);
export const travelCost = (s: CareerState, ev: TourEvent, business = s.settings.business) => {
  if (ev.tier === 'CLUB') return 0;
  const base = CFG.travel[travelBand(s.currentLocation, ev.host_country)];
  return Math.round(base * (business ? CFG.business.cost : 1));
};
export const travelEnergy = (s: CareerState, ev: TourEvent, business = s.settings.business) => {
  if (ev.tier === 'CLUB') return 0;
  const e = CFG.travelEnergy[travelBand(s.currentLocation, ev.host_country) as Band];
  return Math.round(e * (business ? 1 - CFG.business.energySaved : 1) * staminaFactor(characterById(s.characterId)));
};
/** Energy you'd use going all the way (a guide for the tournament screen). */
export const roundEnergy = (s: CareerState, ev: TourEvent) => (ev.tier === 'CLUB' ? CFG.clubOpen.energyPerRound : CFG.energyPerRound) * staminaFactor(characterById(s.characterId));

export function canEnter(s: CareerState, ev: TourEvent, w: World): { ok: boolean; why?: string } {
  if (s.current) return { ok: false, why: 'Finish your current tournament first.' };
  if (s.history.some((h) => h.year === s.year && h.tournamentId === ev.id)) return { ok: false, why: 'You’ve already played this event this season.' };
  if (ev.tier === 'S300' && !s.unlocks.s300) {
    const r = myRank(s, w);
    if (!(r !== null && r <= CFG.gate.S300.rankAtMost)) return { ok: false, why: `Super 300 events open after you reach a Super 100 final, or a world ranking of ${CFG.gate.S300.rankAtMost} or better.` };
  }
  const cost = travelCost(s, ev) + CFG.hotelPerRound;
  if (s.money < cost) return { ok: false, why: `You need ${money(cost)} for travel and your first hotel night.` };
  return { ok: true };
}

/** This week's event, if there is one. */
export const eventThisWeek = (s: CareerState, appVersion: string) =>
  calendar(appVersion).find((e) => e.week === s.week && !s.history.some((h) => h.year === s.year && h.tournamentId === e.id)) ?? null;

/** Nothing you can afford for the rest of the season: offer the free Local Club Open. */
export function softLocked(s: CareerState, w: World): boolean {
  if (s.current) return false;
  const upcoming = w.cal.filter((e) => e.week >= s.week);
  const cheapest = Math.min(...(upcoming.length ? upcoming : w.cal).map((e) => travelCost(s, e, false) + CFG.hotelPerRound));
  return s.money < cheapest;
}

export function clubEvent(s: CareerState): TourEvent {
  return { id: `club_open_${s.year}_${s.week}`, name: 'Local Club Open', tier: 'CLUB', host_country: s.currentLocation, city: null, order: 0, week: s.week, draw_size: 16, prize_pool_usd: 0, sponsor: null, released_in: '3.0', enabled: true };
}

export const findEvent = (s: CareerState, id: string, appVersion: string): TourEvent | null =>
  id.startsWith('club_open_') ? clubEvent(s) : calendar(appVersion).find((e) => e.id === id) ?? null;

export function enter(s: CareerState, ev: TourEvent) {
  const travel = travelCost(s, ev);
  if (travel) book(s, `Travel to ${ev.name}${s.settings.business ? ' (business)' : ''}`, -travel);
  s.energy = Math.max(0, s.energy - travelEnergy(s, ev));
  s.current = { eventId: ev.id, year: s.year, week: s.week, as: s.characterId, round: roundsFor(ev.draw_size)[0], opponents: [], scores: [], travel, hotel: 0, business: s.settings.business, club: ev.tier === 'CLUB' };
}

/** The bracket for the event you're in (Club Opens are drawn from Commons near you). */
export function currentPlan(s: CareerState, w: World, ev: TourEvent) {
  return w.plan(ev.tier === 'CLUB' ? { ...ev, tier: 'S100' } : ev, s.year, s.current!.as);
}

export interface NextMatch { opponent: Character; round: Round; level: Level; games: 1 | 3; points: 15 | 21 }

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
  const early = order.indexOf('QF') > ri;
  return { opponent, round: a.round, level, ...(s.settings.fasterEarlyRounds && early ? { games: 1 as const, points: 15 as const } : { games: 3 as const, points: 21 as const }) };
}

/** A match finished: pay the hotel, use energy, and move on (or finish the event). */
export function recordMatch(s: CareerState, w: World, ev: TourEvent, won: boolean, games: [number, number][], opponentId: string): { finished: boolean; result?: PlayerResult } {
  const a = s.current!;
  a.opponents.push(opponentId);
  a.scores.push(games);
  if (ev.tier !== 'CLUB') { a.hotel += CFG.hotelPerRound; book(s, `Hotel (${ev.name})`, -CFG.hotelPerRound); }
  s.energy = Math.max(0, Math.round(s.energy - roundEnergy(s, ev) * energyUseFactor(characterById(a.as), a.energyAtMatch ?? s.energy)));
  if (won && a.round !== 'F') { a.round = nextRound(a.round); return { finished: false }; }
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
  if (reached === 'W') s.titles++;
  if (ev.tier === 'S100' && (reached === 'F' || reached === 'W')) s.unlocks.s300 = true;
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
  const last = Math.max(...calendar(appVersion).map((e) => e.week), 1);
  if (s.week >= last || s.week >= 52) { s.recap = s.year; s.year++; s.season = s.year; s.week = 1; }
  else s.week++;
}

export function refuel(s: CareerState, kind: 'food' | 'physio'): boolean {
  const o = CFG[kind];
  if (s.money < o.cost) return false;
  book(s, kind === 'food' ? 'Good food' : 'Physio session', -o.cost);
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
