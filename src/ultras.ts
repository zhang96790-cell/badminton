// 5.0: the Champions' Ultra Signatures, as their designer wrote them. Unlike S, SS and SSS signatures, an Ultra
// works past the game's normal stat limits (that's the point of it). Only Untouchable (Momota) bends the net
// rules, as its designer wrote and the owner approved: no net-touch fault on his kills, and a lower kill threshold. Toned-down versions are in the "Signatures and Shots" doc if testing shows they're too strong.
import type { Character, Effective } from '../shared/characters';
import { PLAYER } from './config';
import type { ShotKind } from './careermode/signatures';

export type UltraId = 'great_wall' | 'untouchable' | 'fastest_of_all_time' | 'the_goat' | 'king_of_backhand' | 'denmark_s_pride';
const KNOWN = new Set<UltraId>(['great_wall', 'untouchable', 'fastest_of_all_time', 'the_goat', 'king_of_backhand', 'denmark_s_pride']);

export const ULTRA = {
  greatWall: { liftDepth: 0.3, liftAim: 0.4, blockAim: 0.45, reach: 0.25 },
  /** Also (as designed, the one Ultra that bends the net rules): no net-touch fault on his net kills, and he kills 8 cm lower than anyone. */
  untouchable: { netRun: 3, killNetAim: 0.6, killAim: 0.7, killMargin: 0.08 },
  fastest: { afterSmash: 1.4, smashTime: 1.2, afterNet: 1.5, netTime: 1.0 },
  /** The GOAT: +7.5% per attacking shot in a row (counted up to 10: +75%). */
  goat: { perShot: 0.075, maxStacks: 10 },
  /** King of Backhand: backhand shots +30% power, +50% accuracy; backhand smashes at 85% of forehand power. */
  backhand: { power: 1.3, accuracy: 0.5, smashPower: 0.85 },
  /** Denmark's Pride: smashes +20% and much harder to time; a defence that isn't perfect: stunned 1 s, and 90% of the time it goes to half court or up high.
   *  cpuPerfect: a CPU's defence of it counts as perfect only this often (CPU timing is otherwise nearly always perfect). */
  denmark: { smash: 1.2, heavy: 2.5, stun: 1.0, weakChance: 0.9, weakScale: 0.55, cpuPerfect: 0.3 },
};
/** Attacking shots for The GOAT (drives, smashes, drops, net kills and taps); defensive or neutral ones reset it. */
const ATTACK: ShotKind[] = ['smash', 'kill', 'drive', 'push', 'drop'];
const RESET: ShotKind[] = ['lift', 'clear', 'net', 'block', 'serve'];

export class Ultras {
  private ids: (UltraId | null)[];
  /** The GOAT: attacking shots in a row. */
  streak = [0, 0, 0, 0];
  /** Untouchable: net shots this rally, by either player (3 in total, then Momota's next net shot tumbles). */
  rallyNets = 0;
  private speed = [0, 1, 2, 3].map(() => ({ mult: 1, t: 0 }));
  constructor(chars: (Character | null)[]) {
    this.ids = chars.map((c) => {
      const id = c?.abilities.find((a) => a.tier === 'U')?.id as UltraId | undefined;
      return id && KNOWN.has(id) ? id : null;
    });
  }
  of(i: number): UltraId | null { return this.ids[i] ?? null; }
  get any() { return this.ids.some(Boolean); }

  /** This shot's stats with the player's Ultra on top (after the normal limits). */
  shotEff(i: number, kind: ShotKind, hand: string, overhead: boolean, eff: Effective): Effective {
    const u = this.ids[i];
    if (!u) return eff;
    const e: Effective = { ...eff };
    if (u === 'great_wall') {
      if (kind === 'lift') { e.defenceDepth *= ULTRA.greatWall.liftDepth; e.aim *= ULTRA.greatWall.liftAim; }
      if (kind === 'block') e.aim *= ULTRA.greatWall.blockAim;
    } else if (u === 'the_goat') {
      const k = Math.min(ULTRA.goat.maxStacks, this.streak[i]);
      if (k && ATTACK.includes(kind)) { const b = 1 + ULTRA.goat.perShot * k; e.smash *= b; e.shotSpeed *= b; e.aim /= b; }
    } else if (u === 'king_of_backhand') {
      if (hand === 'backhand') {
        const B = ULTRA.backhand;
        e.backhandPower = overhead && kind === 'smash' ? B.smashPower : Math.min(1, 0.72 * B.power);
        e.backhandNoise = 1.9 * B.accuracy;
      }
    } else if (u === 'denmark_s_pride') {
      if (kind === 'smash') e.smash *= ULTRA.denmark.smash;
    } else if (u === 'untouchable') {
      if (kind === 'kill') { e.netAim *= ULTRA.untouchable.killNetAim; e.aim *= ULTRA.untouchable.killAim; }
    }
    return e;
  }

  /** Untouchable: after 3 of your net shots in a row, this net shot is sure to tumble. */
  forceTumble(i: number, kind: ShotKind): boolean {
    return this.ids[i] === 'untouchable' && kind === 'net' && this.rallyNets >= ULTRA.untouchable.netRun;
  }

  /** How heavy this player's smashes are (Denmark's Pride: much harder to time). */
  heavy(i: number): number { return this.ids[i] === 'denmark_s_pride' ? ULTRA.denmark.heavy : 1; }

  /** After a shot: streaks, speed boosts. Returns what to announce, if anything. */
  afterShot(i: number, kind: ShotKind, tumbleForced: boolean): string | null {
    const u = this.ids[i];
    // Untouchable: count every net shot in the rally; a forced tumble starts the count again.
    this.rallyNets = tumbleForced ? 0 : kind === 'net' ? this.rallyNets + 1 : this.rallyNets;
    if (!u) return null;
    if (u === 'the_goat') {
      if (ATTACK.includes(kind)) this.streak[i]++;
      else if (RESET.includes(kind)) this.streak[i] = 0;
      return this.streak[i] >= 3 && ATTACK.includes(kind) ? `The GOAT ×${Math.min(ULTRA.goat.maxStacks, this.streak[i])}` : null;
    }
    if (u === 'fastest_of_all_time') {
      const F = ULTRA.fastest;
      if (kind === 'smash') { this.speed[i] = { mult: F.afterSmash, t: F.smashTime }; return 'Fastest of All Time'; }
      if (kind === 'net') { this.speed[i] = { mult: F.afterNet, t: F.netTime }; return 'Fastest of All Time'; }
    }
    if (u === 'untouchable' && tumbleForced) return 'Untouchable';
    if (u === 'denmark_s_pride' && kind === 'smash') return "Denmark's Pride";
    if (u === 'great_wall' && kind === 'lift') return null;
    return null;
  }

  /** Great Wall: after a lift, this much extra reach (m) for the next shot. */
  liftReach(i: number, kind: ShotKind): number { return this.ids[i] === 'great_wall' && kind === 'lift' ? PLAYER.reach * ULTRA.greatWall.reach : 0; }

  /** Movement multiplier from a speed Ultra right now. */
  moveMult(i: number): number { return this.speed[i].t > 0 ? this.speed[i].mult : 1; }

  /** A new rally: the net-shot count starts again. */
  newRally() { this.rallyNets = 0; }

  /** Count down; true when a speed boost just ended (stats need refreshing). */
  tick(dt: number): boolean {
    let ended = false;
    for (const s of this.speed) if (s.t > 0 && (s.t -= dt) <= 0) { s.t = 0; s.mult = 1; ended = true; }
    return ended;
  }
}
