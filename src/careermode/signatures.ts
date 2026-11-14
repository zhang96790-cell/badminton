// Signature abilities in a match: shot boosts, timed effects, wrong-footing, cooldowns. Numbers live in
// data/signatures.json. Never touches net-fault rules or the net-kill/net-spin thresholds: net abilities
// only change accuracy or timing windows, and every effect still goes through getEffectiveStats' limits.
import data from '../../data/signatures.json';
import type { Character, Modifier } from '../../shared/characters';

export interface SigDef { id: string; name: string; tier: 'S' | 'SS'; trigger: string; effect: string; magnitude: number; duration: number; cooldown: number; text: string; from_sheet: boolean }
export const SIGNATURES = new Map((data.abilities as SigDef[]).map((a) => [a.id, a]));
/** Abilities in ranked and friendly matches: off until the balance simulations are clean. */
export const signaturesInRanked = false;

export type ShotKind = 'smash' | 'clear' | 'drop' | 'net' | 'kill' | 'drive' | 'push' | 'lift' | 'block' | 'serve' | 'other';
export function shotKind(label: string): ShotKind {
  if (/serve/i.test(label)) return 'serve';
  if (/net kill/i.test(label)) return 'kill';
  if (/smash/i.test(label)) return 'smash';
  if (/clear/i.test(label)) return 'clear';
  if (/drop/i.test(label)) return 'drop';
  if (/net shot/i.test(label)) return 'net';
  if (/push/i.test(label)) return 'push';
  if (/drive/i.test(label)) return 'drive';
  if (/lift|flick/i.test(label)) return 'lift';
  if (/block/i.test(label)) return 'block';
  return 'other';
}
const ATTACK: ShotKind[] = ['smash', 'kill', 'drive', 'push'];

export interface ShotCtx { kind: ShotKind; perfect: boolean; incomingKmh: number; lunged: boolean; early: boolean; crosscourt: boolean; prev: ShotKind | null }

const matches = (trigger: string, x: ShotCtx): boolean => {
  const defensive = x.kind === 'lift' || x.kind === 'block' || (x.kind === 'clear' && x.incomingKmh > 150);
  switch (trigger) {
    case 'perfectDefence': return x.perfect && defensive;
    case 'deceptive': return x.kind === 'drop' || x.kind === 'net' || x.kind === 'lift';
    case 'alternate': return !!x.prev && x.prev !== x.kind && x.kind !== 'serve';
    case 'early': return ATTACK.includes(x.kind) && x.early;
    case 'crosscourtLift': return x.crosscourt && x.kind === 'lift';
    case 'counterSmash': return x.incomingKmh >= 180 && (x.kind === 'drive' || x.kind === 'push');
    case 'crosscourtAttack': return x.crosscourt && (x.kind === 'smash' || x.kind === 'drive');
    case 'crosscourt': return x.crosscourt && x.kind !== 'serve';
    case 'crosscourtDrop': return x.crosscourt && x.kind === 'drop';
    case 'smash': case 'clear': case 'drop': case 'net': case 'drive': case 'lift': return x.kind === trigger;
    default: return false;
  }
};
/** Fired after the shot is played (timed effects). */
const AFTER = new Set(['retrieve', 'block']);
const isRetrieve = (x: ShotCtx) => x.kind !== 'serve' && (x.incomingKmh >= 180 || x.lunged);
const isBlock = (x: ShotCtx) => x.incomingKmh >= 180 && (x.kind === 'block' || x.kind === 'lift');

/** Modifier key for an effect name (self effects). */
const SELF: Record<string, (m: number) => Modifier> = {
  shotSpeed: (m) => ({ shotSpeed: 1 + m, smash: 1 + m }),
  smash: (m) => ({ smash: 1 + m }),
  aim: (m) => ({ aim: 1 - m }),
  netAim: (m) => ({ netAim: 1 - m }),
  netTiming: (m) => ({ netTiming: 1 + m }),
  defenceDepth: (m) => ({ defenceDepth: 1 - m }),
  move: (m) => ({ move: 1 + m }),
  swingWait: (m) => ({ swingWait: 1 - m }),
  nextAttack: (m) => ({ shotSpeed: 1 + m, smash: 1 + m }),
};

export interface ShotBoost { mods: Modifier[]; deceive: number; fired: SigDef[] }
export interface Fired { player: number; def: SigDef; t: number }

/** Abilities for every player in a match (index = player index). */
export class Signatures {
  private cd: Map<string, number>[];
  /** Timed effects: on a player, for a while. */
  timed: { player: number; mods: Modifier; t: number }[] = [];
  /** Effects waiting for a player's next shot of a kind (attack / smash). */
  private nextShot: { player: number; mods: Modifier; on: 'attack' | 'smash' }[] = [];
  private prev: (ShotKind | null)[];
  /** The last ability that fired (for the screen). */
  last: Fired | null = null;
  private clock = 0;

  constructor(private list: SigDef[][], private teamOf: (i: number) => 0 | 1) {
    this.cd = list.map(() => new Map());
    this.prev = list.map(() => null);
  }

  static forCharacters(chars: (Character | null)[], teamOf: (i: number) => 0 | 1) {
    return new Signatures(chars.map((c) => (c?.abilities ?? []).map((a) => SIGNATURES.get(a.id)).filter((d): d is SigDef => !!d)), teamOf);
  }

  /** Something timed ran out (the caller recomputes stats). */
  tick(dt: number): boolean {
    this.clock += dt;
    const before = this.timed.length;
    this.timed = this.timed.filter((x) => (x.t -= dt) > 0);
    return this.timed.length !== before;
  }

  private ready(i: number, d: SigDef) { return (this.cd[i].get(d.id) ?? -1e9) <= this.clock; }
  private use(i: number, d: SigDef) { this.cd[i].set(d.id, this.clock + d.cooldown); this.last = { player: i, def: d, t: this.clock }; }

  /** Boosts for the shot player i is playing now. */
  forShot(i: number, x: ShotCtx): ShotBoost {
    x.prev = this.prev[i];
    const out: ShotBoost = { mods: [], deceive: 0, fired: [] };
    for (const d of this.list[i] ?? []) {
      if (AFTER.has(d.trigger) || d.trigger === 'netWin' || d.trigger === 'lowEnergy') continue;
      if (!matches(d.trigger, x) || !this.ready(i, d)) continue;
      if (d.effect === 'deceive') { out.deceive = Math.max(out.deceive, d.magnitude); out.fired.push(d); continue; }
      if (d.effect === 'oppMove') continue; // handled after the shot
      const m = SELF[d.effect]?.(d.magnitude);
      if (!m) continue;
      // Passive boosts (no cooldown) don't announce themselves every shot.
      out.mods.push(m);
      if (d.cooldown) out.fired.push(d);
    }
    // A boost saved for this shot (e.g. after winning at the net).
    const keep: typeof this.nextShot = [];
    for (const n of this.nextShot) {
      if (n.player === i && (n.on === 'attack' ? ATTACK.includes(x.kind) : x.kind === 'smash')) out.mods.push(n.mods);
      else keep.push(n);
    }
    this.nextShot = keep;
    return out;
  }

  /** The shot was played: start any timed effects. `fired` from forShot set cooldowns here. */
  afterShot(i: number, x: ShotCtx, fired: SigDef[], deceived: boolean) {
    for (const d of fired) if (d.effect !== 'deceive' || deceived) this.use(i, d);
    this.prev[i] = x.kind;
    for (const d of this.list[i] ?? []) {
      if (!this.ready(i, d)) continue;
      const hit = d.trigger === 'retrieve' ? isRetrieve(x) : d.trigger === 'block' ? isBlock(x) : d.trigger === 'clear' && d.effect === 'oppMove' ? x.kind === 'clear' : false;
      if (!hit) continue;
      const opps = this.list.map((_, j) => j).filter((j) => this.teamOf(j) !== this.teamOf(i));
      if (d.effect === 'oppSmash') for (const j of opps) this.timed.push({ player: j, mods: { smash: 1 - d.magnitude }, t: d.duration });
      else if (d.effect === 'oppNextSmash') for (const j of opps) this.nextShot.push({ player: j, mods: { smash: 1 - d.magnitude }, on: 'smash' });
      else if (d.effect === 'oppMove') for (const j of opps) this.timed.push({ player: j, mods: { move: 1 - d.magnitude }, t: d.duration });
      else if (SELF[d.effect]) this.timed.push({ player: i, mods: SELF[d.effect](d.magnitude), t: d.duration });
      else continue;
      this.use(i, d);
    }
  }

  /** A point was won: net-exchange abilities (winner's last shot was at the net). */
  onPoint(winnerTeam: 0 | 1, lastHitter: number | null, lastKind: ShotKind | null) {
    if (lastHitter === null || this.teamOf(lastHitter) !== winnerTeam || (lastKind !== 'net' && lastKind !== 'kill')) return;
    for (const d of this.list[lastHitter] ?? []) {
      if (d.trigger !== 'netWin' || !this.ready(lastHitter, d)) continue;
      this.nextShot.push({ player: lastHitter, mods: SELF[d.effect]?.(d.magnitude) ?? {}, on: 'attack' });
      this.use(lastHitter, d);
    }
  }

  /** Timed effects on a player right now. */
  modsFor(i: number): Modifier[] { return this.timed.filter((x) => x.player === i).map((x) => x.mods); }
}

/** Last Stand: energy use cut when starting low (career). */
export function energyUseFactor(c: Character, energy: number): number {
  for (const a of c.abilities ?? []) {
    const d = SIGNATURES.get(a.id);
    if (d?.effect === 'energyUse' && energy < 20) return 1 - d.magnitude;
  }
  return 1;
}
