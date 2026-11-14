// The career world: calendar, draws, NPC results and the world ranking. Nothing here is saved: it's all worked
// out from the save's seed and the player's own results, so it comes out the same on every reload.
import tournamentsData from '../../data/tournaments.json';
import regionsData from '../../data/country_regions.json';
import yearsData from '../../data/calendar_years.json';
import { RARITY, ROSTER, compareVersions, type Character, type Rarity } from '../../shared/characters';
import { CAREER_CFG as CFG, LEVELS, type Round, type Tier } from './config';
import type { Level } from '../config';

// ── Seeded randomness ──
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── Data ──
export interface TourEvent { id: string; name: string; tier: Tier | 'CLUB'; host_country: string; city: string | null; order: number; week: number; dates?: string; draw_size: number; prize_pool_usd: number; sponsor: string | null; released_in: string; enabled: boolean }
type RawEvent = Omit<TourEvent, 'week'> & { week: number | null };

/** How a year changes the base calendar (data/calendar_years.json). */
interface YearRules { set?: Record<string, Partial<RawEvent>>; replace?: Record<string, Partial<RawEvent> & { id: string }>; add?: (Partial<RawEvent> & { id: string })[]; remove?: string[] }
const YEARS = yearsData.years as Record<string, YearRules>;
/** Years after the last one written repeat the non-Olympic years before it. */
function rulesFor(year: number): YearRules {
  if (YEARS[year]) return YEARS[year];
  const cycle = [2029, 2030, 2031];
  return YEARS[cycle[(year - 2029) % cycle.length]] ?? {};
}

const calCache = new Map<string, TourEvent[]>();
/**
 * The calendar for a career year: enabled events out in this version, in week order. Each year can move,
 * swap, add or drop events (Olympics in 2028 and 2032, new Worlds and Finals hosts every year).
 */
export function calendar(appVersion: string, year = 2027): TourEvent[] {
  const key = `${appVersion}:${year}`;
  const hit = calCache.get(key);
  if (hit) return hit;
  const r = rulesFor(year);
  let list = (tournamentsData.tournaments as RawEvent[]).map((e) => ({ ...e }));
  for (const [id, patch] of Object.entries(r.set ?? {})) list = list.map((e) => (e.id === id ? { ...e, ...patch } : e));
  for (const [id, ev] of Object.entries(r.replace ?? {})) list = list.map((e) => (e.id === id ? { ...e, notes: '', ...ev } as RawEvent : e));
  for (const ev of r.add ?? []) list.push({ order: 99, sponsor: null, released_in: '3.0', enabled: true, notes: '', city: null, week: null, draw_size: 32, prize_pool_usd: 0, tier: 'S100', host_country: 'XXX', name: ev.id, ...ev } as RawEvent);
  list = list.filter((e) => !(r.remove ?? []).includes(e.id) && e.enabled && compareVersions(e.released_in, appVersion) <= 0);
  const gap = Math.max(1, Math.floor(50 / Math.max(1, list.length)));
  const out = list.map((e, i) => ({ ...e, week: e.week ?? Math.min(52, 2 + i * gap) })).sort((a, b) => a.week - b.week || a.order - b.order);
  calCache.set(key, out);
  return out;
}

export const COUNTRIES = regionsData.countries as Record<string, { name: string; region: string }>;
export const countryName = (code: string) => COUNTRIES[code]?.name ?? code;
export type Band = 'domestic' | 'regional' | 'intercontinental';
export function travelBand(from: string, to: string): Band {
  if (from === to) return 'domestic';
  const a = COUNTRIES[from]?.region, b = COUNTRIES[to]?.region;
  if (!a || !b) return 'regional';
  if (a === b || regionsData.neighbours.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return 'regional';
  return 'intercontinental';
}

// ── People ──
export const YOU = 'you';
/** NPCs: everyone released and enabled except the Club Player. */
/**
 * NPCs: every enabled player except the Club Player, including ones not released yet (stars play the big
 * events). Releases only decide who you can recruit and use. `appVersion` is kept for the call sites.
 */
export const npcPool = (_appVersion: string) => ROSTER.filter((c) => c.id !== 'default_player');

/** A character's strength for the result simulator: career strength plus a fixed personal form. */
const STRENGTH = new Map<string, number>();
export function simStrength(c: Character): number {
  let v = STRENGTH.get(c.id);
  if (v === undefined) STRENGTH.set(c.id, (v = c.career_strength + ((hash('form', c.id) % 2001) / 1000 - 1) * CFG.simSpread));
  return v;
}

/** Absolute week number, for "the last 52 weeks". */
export const absWeek = (year: number, week: number) => year * 52 + (week - 1);

// ── Draws ──
const ALL_ROUNDS: Round[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'];
/** Places in the bracket: the draw rounded up to a power of 2 (48 players = 64 places with 16 byes). */
export const slotsFor = (players: number) => 2 ** Math.ceil(Math.log2(Math.max(2, players)));
/** The rounds for a draw of this many players (or places). */
export const roundsFor = (players: number): Round[] => ALL_ROUNDS.slice(ALL_ROUNDS.length - Math.log2(slotsFor(players)));
export const nextRound = (r: Round): Round => (r === 'R32' ? 'R16' : r === 'R16' ? 'QF' : r === 'QF' ? 'SF' : r === 'SF' ? 'F' : 'W');

/**
 * The NPC field for an event: weighted by rarity for the tier, at least 2 from the host country (when there are
 * any), at most 3 from one country, no style more than a third of the draw, no duplicates.
 */
export function drawField(ev: TourEvent, year: number, seed: number, pool: Character[], size: number): string[] {
  const r = rng(hash(seed, year, ev.id, 'field'));
  const weights = (CFG.fieldWeights as Record<string, Partial<Record<Rarity, number>>>)[ev.tier] ?? { common: 100 };
  const cand = pool.filter((c) => (weights[c.rarity] ?? 0) > 0);
  const out: Character[] = [];
  const perCountry = new Map<string, number>(), perStyle = new Map<string, number>();
  const take = (c: Character) => { out.push(c); perCountry.set(c.country, (perCountry.get(c.country) ?? 0) + 1); perStyle.set(c.style, (perStyle.get(c.style) ?? 0) + 1); };
  const perCountryMax = ev.tier === 'OLYMPICS' ? 2 : CFG.maxPerCountry;
  const ok = (c: Character) => !out.includes(c) && (perCountry.get(c.country) ?? 0) < perCountryMax && (perStyle.get(c.style) ?? 0) < Math.ceil(size / 3);
  // Players in better form enter more events (as on the real tour).
  const wt = (c: Character) => (weights[c.rarity] ?? 0) * Math.exp((simStrength(c) - c.career_strength) / CFG.formEntry);
  const pick = (list: Character[]) => {
    const good = list.filter(ok);
    const total = good.reduce((t, c) => t + wt(c), 0);
    let x = r() * total;
    for (const c of good) { x -= wt(c); if (x <= 0) return c; }
    return good[good.length - 1];
  };
  const hosts = cand.filter((c) => c.country === ev.host_country);
  for (let i = 0; i < CFG.minHostPlayers && hosts.length; i++) { const c = pick(hosts); if (c) take(c); }
  // Wildcard (later versions): a Champion dropped into the draw.
  const wc = (CFG.wildcardChance as Record<string, number>)[ev.tier] ?? 0;
  if (wc > 0 && r() < wc) { const champs = pool.filter((c) => c.rarity === 'champion'); if (champs.length) take(champs[Math.floor(r() * champs.length)]); }
  while (out.length < size) { const c = pick(cand); if (!c) break; take(c); }
  return out.map((c) => c.id);
}

/** Standard seeding: which seed number each bracket place belongs to (1 and 2 in opposite halves, and so on). */
function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) order = order.flatMap((x) => [x, 2 * order.length + 1 - x]);
  return order;
}

/**
 * Bracket places: the seeds (best-ranked first) at the standard seeded places, a bye opposite each of the top
 * seeds when the draw isn't full, and everyone else shuffled into the rest.
 */
export function placeSeeds(ids: string[], seeds: string[], seed: number, players = ids.length): string[] {
  const r = rng(seed);
  const size = slotsFor(players), byes = size - ids.length;
  const order = seedOrder(size);
  const slots: (string | null)[] = new Array(size).fill(null);
  const placeOf = (n: number) => order.indexOf(n);
  seeds.forEach((id, i) => { slots[placeOf(i + 1)] = id; });
  // Byes face the top seeds (seed 1 first); with fewer seeds than byes, the next seeded places take them.
  for (let k = 1; k <= byes; k++) slots[placeOf(k) ^ 1] = 'bye';
  const rest = ids.filter((id) => !seeds.includes(id));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  let k = 0;
  for (let i = 0; i < size; i++) if (!slots[i]) slots[i] = rest[k++] ?? 'bye';
  return slots as string[];
}

export interface Strengths { get(id: string): number }

/** One simulated match (NPC vs NPC): its own seed, so the order matches are simulated in never matters. */
export function simMatch(a: string, b: string, str: Strengths, seed: number): string {
  if (a === 'bye') return b;
  if (b === 'bye') return a;
  const r = rng(seed);
  const gap = str.get(a) - str.get(b) + (r() - r()) * CFG.simNoise;
  return r() < 1 / (1 + Math.exp(-gap / CFG.simScale)) ? a : b;
}

/** A whole event: who reached which round. `decide` settles matches the player is in (null = simulate). */
export function playOut(slots: string[], str: Strengths, seed: number, decide?: (a: string, b: string, round: Round) => string | null): { reached: Map<string, Round>; rounds: string[][] } {
  const rounds = roundsFor(slots.length);
  const reached = new Map<string, Round>();
  const history: string[][] = [slots];
  let alive = slots;
  rounds.forEach((rd, ri) => {
    const next: string[] = [];
    for (let m = 0; m < alive.length; m += 2) {
      const a = alive[m], b = alive[m + 1];
      const w = decide?.(a, b, rd) ?? simMatch(a, b, str, hash(seed, ri, m));
      const l = w === a ? b : a;
      if (l !== 'bye') reached.set(l, rd);
      next.push(w);
    }
    alive = next;
    history.push(alive);
  });
  if (alive[0] && alive[0] !== 'bye') reached.set(alive[0], 'W');
  return { reached, rounds: history };
}

/**
 * Ranking points for reaching a round. Real events have bigger draws, so in a 16-player draw losing your first
 * match earns Round of 32 points (that's where it would have been), not Round of 16.
 */
export function pointsFor(tier: string, round: Round, drawSize: number): number {
  const t = CFG.points[tier];
  if (!t) return 0;
  return t[drawSize <= 16 && round === 'R16' ? 'R32' : round] ?? 0;
}

export interface PlayerResult { tournamentId: string; year: number; week: number; tier: string; round: Round; points: number; prize: number; costs: number; opponents?: string[]; /** Your games in each round you played ([yours, theirs]). */ scores?: [number, number][][]; /** Who you played as (left out of that draw). */ as: string }

/** Everyone's ranking results: id → list of (absolute week, points). */
export type Results = Map<string, { at: number; pts: number; ev: string }[]>;

/** Ranking points over the last 52 weeks (best `bestOf` results). */
export function pointsAt(list: { at: number; pts: number }[] | undefined, at: number): number {
  if (!list) return 0;
  return list.filter((x) => x.at <= at && x.at > at - 52).map((x) => x.pts).sort((a, b) => b - a).slice(0, CFG.bestOf).reduce((a, b) => a + b, 0);
}

export interface WorldInput {
  appVersion: string;
  seed: number;
  startYear: number;
  /** Up to and including this (year, week). */
  year: number;
  week: number;
  /** The player's own tournaments (their results are fixed). */
  history: PlayerResult[];
}

export interface EventPlan { ev: TourEvent; year: number; slots: string[]; seeds: string[] }

/**
 * Work the world out up to a week: every event from the season before the career started (so the ranking
 * starts sensible), NPC-only unless the player played it. Returns everyone's results, plus the plan (field
 * and bracket) for any event asked for.
 */
export class World {
  readonly pool: Character[];
  readonly cal: TourEvent[];
  private str = new Map<string, number>();
  results: Results = new Map();
  private plans = new Map<string, EventPlan>();

  /** Unseen world events (off by default), added to every year's calendar for the ranking. */
  private extra: TourEvent[];
  /** A year's calendar plus the unseen world events, in week order. */
  private allFor = (year: number) => [...calendar(this.input.appVersion, year), ...this.extra].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));

  constructor(private input: WorldInput) {
    this.pool = npcPool(input.appVersion);
    this.cal = calendar(input.appVersion, input.year);
    const countries = [...new Set(this.pool.map((c) => c.country))];
    const extra: TourEvent[] = [];
    for (const [tier, n] of Object.entries(CFG.worldEvents) as [Tier, number][]) {
      for (let i = 0; i < n; i++) {
        const r = rng(hash(input.seed, 'world', tier, i));
        extra.push({ id: `world_${tier.toLowerCase()}_${i}`, name: 'World event', tier, host_country: countries[Math.floor(r() * countries.length)], city: null, order: 0,
          week: 1 + Math.floor(((i + r()) / n) * 51), draw_size: 16, prize_pool_usd: 0, sponsor: null, released_in: '0', enabled: true });
      }
    }
    this.extra = extra;
    for (const c of this.pool) this.str.set(c.id, simStrength(c));
    this.str.set(YOU, 100);
    this.run();
  }

  strength = { get: (id: string) => this.str.get(id) ?? 100 };

  private add(id: string, at: number, pts: number, ev: string) {
    let l = this.results.get(id);
    if (!l) this.results.set(id, (l = []));
    l.push({ at, pts, ev });
  }

  rankingAt(at: number, ids?: string[]): { id: string; pts: number }[] {
    const list = (ids ?? [...this.results.keys()]).map((id) => ({ id, pts: pointsAt(this.results.get(id), at) }));
    return list.sort((a, b) => b.pts - a.pts || this.strength.get(b.id) - this.strength.get(a.id) || a.id.localeCompare(b.id));
  }

  /**
   * The field and bracket for an event. With the player (`playerAs` = who they play as), that character is
   * left out and the player takes the last place; without, it's the same NPC field every time.
   */
  plan(ev: TourEvent, year: number, playerAs: string | null): EventPlan {
    const key = `${year}:${ev.id}:${playerAs ?? '-'}`;
    const cached = this.plans.get(key);
    if (cached) return cached;
    const size = ev.draw_size;
    const at = absWeek(year, ev.week) - 1;
    let ids: string[];
    if (ev.tier === 'WTF') {
      // The World Tour Finals: the world's best that week (you take your place if you're among them).
      ids = this.rankingAt(at).map((x) => x.id).filter((id) => id !== YOU && id !== playerAs).slice(0, playerAs ? size - 1 : size);
      if (playerAs) ids.push(YOU);
    } else {
      ids = drawField(ev, year, this.input.seed, this.pool, size + 1);
      ids = playerAs ? [...ids.filter((id) => id !== playerAs).slice(0, size - 1), YOU] : ids.slice(0, size);
    }
    // Seeds: 4 in a 16 or 32 draw, 8 in 64, 16 when there are 16 byes (a 48 draw).
    const nSeeds = Math.max(4, slotsFor(size) - size, size >= 64 ? 8 : 4);
    const seeds = this.rankingAt(at, ids).filter((x) => x.pts > 0).slice(0, Math.min(nSeeds, ids.length)).map((x) => x.id);
    const p = { ev, year, slots: placeSeeds(ids, seeds, hash(this.input.seed, year, ev.id, 'bracket'), size), seeds };
    this.plans.set(key, p);
    return p;
  }

  private run() {
    const { history, startYear, year, week, seed } = this.input;
    const mine = new Map(history.map((h) => [`${h.year}:${h.tournamentId}`, h]));
    for (let y = startYear - 1; y <= year; y++) {
      for (const ev of this.allFor(y)) {
        if (y === year && ev.week > week) break;
        const h = mine.get(`${y}:${ev.id}`);
        // An event the player is still playing (this week) isn't counted until it's finished.
        if (y === year && ev.week === week && !h) continue;
        const at = absWeek(y, ev.week);
        const p = this.plan(ev, y, h ? h.as : null);
        const order = roundsFor(p.slots.length).concat('W');
        const { reached } = playOut(p.slots, this.strength, hash(seed, y, ev.id, 'play'), h ? (a, b, rd) => {
          if (a !== YOU && b !== YOU) return null;
          const other = a === YOU ? b : a;
          return order.indexOf(h.round) > order.indexOf(rd) ? YOU : other;
        } : undefined);
        for (const [id, rd] of reached) if (id !== YOU) this.add(id, at, pointsFor(ev.tier, rd, ev.draw_size), ev.id);
        if (h) this.add(YOU, at, h.points, ev.id);
      }
    }
    // Local Club Opens (only ever the player's): their points count too.
    for (const h of history) if (h.tier === 'CLUB' && (h.year < year || (h.year === year && h.week <= week))) this.add(YOU, absWeek(h.year, h.week), h.points, h.tournamentId);
  }
}

/** CPU level for an opponent: their rarity's range on the career ladder, picked from the event seed, plus the event's bonus. */
export function cpuLevelFor(rarity: Rarity, seed: number, tier = 'S100'): Level {
  const [lo, hi] = CFG.cpuLevel[rarity] ?? [1, 2];
  const lv = lo + Math.floor(rng(seed)() * (hi - lo + 1)) + (CFG.tierLevelBonus[tier] ?? 0);
  return LEVELS[Math.max(1, Math.min(LEVELS.length, lv)) - 1];
}

export const rarityOrder = (r: Rarity) => RARITY[r].order;
