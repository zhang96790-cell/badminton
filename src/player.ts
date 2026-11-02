import { COURT, PHYSICS, PLAYER, SHOTS, SWING } from './config';
import { add3, clamp, len3, mul3, norm3, sub3, type Side, type V2, type V3 } from './math';
import type { Contact, Hand, ShotRequest, TimingLabel } from './shots';

/** Everything needed to draw a player. Live players implement it; replays store copies. */
export interface PlayerView {
  side: Side;
  color: string;
  /** x sign of the racket hand. */
  racketSide: number;
  pos: V2;
  vel: V2;
  z: number;
  vz: number;
  hand: V3;
  /** Unit vector from the grip toward the racket head. */
  rdir: V3;
  stride: number;
  /** Seconds since the last split-step / lunge began (large = not doing one). */
  split: number;
  lunge: number;
  lungeDir: V2;
  charge: number | null;
  /** Holding the shuttle ready to serve: forehand (singles) or backhand (doubles) stance. */
  serving: 'forehand' | 'backhand' | null;
}

export const RACKET_LENGTH = 0.58;

/** 0..1 depth of a lunge: drop in fast, hold, push back up. */
export function lungeAmount(v: PlayerView): number {
  const u = v.lunge / PLAYER.lungeTime;
  if (u >= 1) return 0;
  return u < 0.25 ? u / 0.25 : u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
}

/** 0..1 height of the split-step hop. */
export function splitAmount(v: PlayerView): number {
  return v.split < PLAYER.splitStepTime ? Math.sin((Math.PI * v.split) / PLAYER.splitStepTime) : 0;
}

export function crouchOf(v: PlayerView): number {
  return 0.05 + lungeAmount(v) * 0.26;
}

export function shoulderOf(v: PlayerView): V3 {
  const l = lungeAmount(v);
  return {
    x: v.pos.x + v.racketSide * 0.2 + v.lungeDir.x * l * 0.25,
    y: v.pos.y + v.lungeDir.y * l * 0.25,
    z: 1.42 + v.z - crouchOf(v),
  };
}

export class Player implements PlayerView {
  /** Stable identity (0–3) for stats; array positions can swap when auto-switch changes who you control. */
  id = 0;
  pos: V2;
  vel: V2 = { x: 0, y: 0 };
  z = 0;
  vz = 0;
  swing: { t: number; req: ShotRequest } | null = null;
  frozen = false;
  speedMult = 1;
  /** Extra reach on top of PLAYER.reach (human players get a little more). */
  extraReach = 0;
  /** The current swing was started by swing assist. */
  assisted = false;
  /** Set when a jump smash is hit; the boost starts when they land. */
  jumpSmashed = false;
  /** Seconds of post-jump-smash speed boost left. */
  boost = 0;
  charge: number | null = null;
  /** Doubles call shown over the head ("Mine!" / "Yours!"). */
  shout: { text: string; t: number; ttl: number } | null = null;
  hand: V3;
  rdir: V3 = { x: 0, y: 0, z: 1 };
  stride = 0;
  split = 9;
  lunge = 9;
  lungeDir: V2 = { x: 0, y: 1 };
  anim: { kind: 'hit' | 'whiff' | 'serve'; t: number; point: V3 | null } | null = null;
  serving: 'forehand' | 'backhand' | null = null;
  /** Result of the last hit, for the timing light. */
  timingFlash: { kind: 'perfect' | 'early' | 'late'; t: number } | null = null;
  private recover = 0;
  /** A click made during recovery, played as soon as it ends. */
  private queued: { req: ShotRequest; assisted: boolean } | null = null;
  private landLag = 0;

  constructor(public side: Side, public name: string, public color: string, public voiceName: string) {
    this.pos = { x: 0, y: side * PLAYER.baseDepth };
    const p = this.poseTarget();
    this.hand = p.hand;
    this.rdir = p.dir;
  }

  /** x sign of the player's right-hand side (they face the net). */
  get right(): number { return -this.side; }
  get racketSide(): number { return this.right * (PLAYER.handedness === 'right' ? 1 : -1); }
  get forward(): number { return -this.side; }
  get airborne(): boolean { return this.z > 0.02; }

  place(x: number, y: number) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.z = 0;
    this.vz = 0;
    this.swing = null;
    this.anim = null;
    this.recover = 0;
    this.queued = null;
    this.landLag = 0;
    this.split = 9;
    this.lunge = 9;
    this.boost = 0;
    this.jumpSmashed = false;
  }

  /**
   * queue: a click during recovery swings as soon as recovery ends instead of being dropped (players
   * only; the CPU waits for the right moment itself).
   */
  startSwing(req: ShotRequest, assisted = false, queue = false): boolean {
    if (!this.swing && this.recover > 0 && queue) this.queued = { req, assisted };
    if (this.swing || this.recover > 0) return false;
    this.swing = { t: 0, req };
    this.assisted = assisted;
    return true;
  }

  /** Little hop as the opponent hits; landing from it gives a burst of acceleration. */
  splitStep() {
    if (!this.airborne && !this.frozen && this.lunge > PLAYER.lungeTime) this.split = 0;
  }

  /** Advance movement, jump and swing timers. Returns 'whiff' if a swing expired without contact. */
  update(dt: number, move: V2, jump: boolean): 'whiff' | null {
    let result: 'whiff' | null = null;
    const grounded = this.z <= 0 && this.vz <= 0;
    if (jump && grounded && !this.frozen) {
      this.vz = PLAYER.jumpSpeed;
      this.vel.x *= PLAYER.jumpCarry;
      this.vel.y *= PLAYER.jumpCarry;
    }
    if (this.vz !== 0 || this.z > 0) {
      this.z += this.vz * dt;
      this.vz -= PHYSICS.gravity * dt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = 0;
        if (this.jumpSmashed) { this.boost = PLAYER.jumpSmashBoostTime; this.landLag = 0; this.jumpSmashed = false; }
        else this.landLag = PLAYER.landingLag;
      }
    }

    const len = Math.min(1, Math.hypot(move.x, move.y));
    const mag = Math.hypot(move.x, move.y) || 1;
    let max = PLAYER.maxSpeed * this.speedMult;
    if (this.swing) max *= PLAYER.swingMoveFactor;
    if (this.landLag > 0) max *= 0.5;
    if (this.lunge < PLAYER.lungeTime) max *= PLAYER.lungeRecoverySpeed;
    if (this.boost > 0) max *= PLAYER.jumpSmashBoostSpeed;
    const boosted = this.split > PLAYER.splitStepTime && this.split < PLAYER.splitStepTime + PLAYER.splitBoostTime;
    const accel = PLAYER.accel * (boosted ? PLAYER.splitBoost : 1) * (this.boost > 0 ? PLAYER.jumpSmashBoostAccel : 1);
    if (this.frozen) {
      this.vel = { x: 0, y: 0 };
    } else if (this.airborne) {
      // Committed to the jump: barely any steering, but you can kill leftover drift.
      const opposing = len === 0 || move.x * this.vel.x + move.y * this.vel.y < 0;
      const step = (opposing ? PLAYER.airBrake : accel * PLAYER.airControl) * dt;
      this.vel.x += clamp((move.x / mag) * len * max - this.vel.x, -step, step);
      this.vel.y += clamp((move.y / mag) * len * max - this.vel.y, -step, step);
    } else if (len === 0) {
      // Let go of the keys: plant and stop.
      const sp = Math.hypot(this.vel.x, this.vel.y);
      const k = sp > 0 ? Math.max(0, sp - PLAYER.decel * dt) / sp : 0;
      this.vel.x *= k;
      this.vel.y *= k;
    } else {
      // Velocity along the input accelerates; anything sideways or backwards is braked hard,
      // so changing direction doesn't slide.
      const ux = move.x / mag, uy = move.y / mag;
      let along = this.vel.x * ux + this.vel.y * uy;
      let px = this.vel.x - along * ux, py = this.vel.y - along * uy;
      const pm = Math.hypot(px, py);
      const pk = pm > 0 ? Math.max(0, pm - PLAYER.decel * dt) / pm : 0;
      px *= pk;
      py *= pk;
      const target = len * max;
      if (along < target) along = Math.min(target, along + (along < 0 ? PLAYER.decel : accel) * dt);
      else along = Math.max(target, along - PLAYER.decel * dt);
      this.vel.x = ux * along + px;
      this.vel.y = uy * along + py;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    const xLim = COURT.doublesHalfWidth + PLAYER.runOffWide;
    const yFar = COURT.halfLength + PLAYER.runOffBehind;
    const nx = clamp(this.pos.x, -xLim, xLim);
    const ny = this.side < 0 ? clamp(this.pos.y, -yFar, -0.25) : clamp(this.pos.y, 0.25, yFar);
    if (nx !== this.pos.x) this.vel.x = 0;
    if (ny !== this.pos.y) this.vel.y = 0;
    this.pos.x = nx;
    this.pos.y = ny;

    this.landLag = Math.max(0, this.landLag - dt);
    this.recover = Math.max(0, this.recover - dt);
    if (this.queued && this.recover <= 0 && !this.swing) {
      this.swing = { t: 0, req: this.queued.req };
      this.assisted = this.queued.assisted;
      this.queued = null;
    }
    this.split += dt;
    this.lunge += dt;
    this.boost = Math.max(0, this.boost - dt);
    if (this.swing) {
      this.swing.t += dt;
      if (this.swing.t > SWING.window) {
        this.swing = null;
        this.recover = SWING.recovery;
        this.anim = { kind: 'whiff', t: 0, point: null };
        result = 'whiff';
      }
    }

    // Visuals
    this.stride += Math.hypot(this.vel.x, this.vel.y) * dt * 5.5;
    if (this.anim) { this.anim.t += dt; if (this.anim.t > 0.35) this.anim = null; }
    if (this.timingFlash) { this.timingFlash.t += dt; if (this.timingFlash.t > 0.7) this.timingFlash = null; }
    if (this.shout) { this.shout.t += dt; if (this.shout.t > this.shout.ttl) this.shout = null; }
    const p = this.poseTarget();
    const snap = this.anim?.kind === 'hit' && this.anim.t < 0.05;
    const k = snap ? 1 : 1 - Math.exp(-26 * dt);
    this.hand = add3(this.hand, mul3(sub3(p.hand, this.hand), k));
    this.rdir = norm3(add3(this.rdir, mul3(sub3(p.dir, this.rdir), k)));
    return result;
  }

  reachFor(z: number): number {
    return PLAYER.reach + this.extraReach + (z < PLAYER.lungeMaxZ ? PLAYER.lungeReach : 0);
  }

  /** The shuttle is within reach now but won't be next step. */
  aboutToMiss(s: V3, v: V3, dt: number): boolean {
    return this.inReach(s) && !this.inReach({ x: s.x + v.x * dt, y: s.y + v.y * dt, z: s.z + v.z * dt });
  }

  private inReach(p: V3): boolean {
    const d = Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
    return d <= this.reachFor(p.z) && p.z >= PLAYER.reachMinZ && p.z <= PLAYER.reachMaxZ + this.z;
  }

  /**
   * Called every physics step while the shuttle is on this player's side and theirs to hit.
   * The racket arrives `idealDelay` after the press. If the shuttle is in reach then, it's a clean hit.
   * Pressed too early: contact happens late in the swing when the shuttle finally arrives.
   * Pressed too late: contact is forced just before the shuttle leaves reach.
   */
  tryContact(s: V3, v: V3, dt: number): Contact | null {
    const sw = this.swing;
    if (!sw || !this.inReach(s)) return null;
    const next = { x: s.x + v.x * dt, y: s.y + v.y * dt, z: s.z + v.z * dt };
    const leaving = !this.inReach(next) || next.z <= 0;
    if (sw.t < SWING.idealDelay && !leaving) return null;

    const err = sw.t - SWING.idealDelay; // < 0: pressed late, > 0: pressed early
    const e = Math.abs(err);
    const timing = e <= SWING.perfectTolerance
      ? 1
      : Math.max(SWING.minQuality, 1 - ((e - SWING.perfectTolerance) / SWING.falloff) * (1 - SWING.minQuality));
    const timingLabel: TimingLabel = e <= SWING.perfectTolerance ? 'Perfect' : e <= SWING.perfectTolerance * 2.2 ? 'Good' : err < 0 ? 'Late' : 'Early';

    const lateral = (s.x - this.pos.x) * this.racketSide;
    let hand: Hand = 'forehand';
    if (lateral < -0.12) hand = s.z >= SHOTS.overheadHeight && lateral > -0.75 ? 'round-the-head' : 'backhand';

    return {
      point: { ...s },
      side: this.side,
      hand,
      airborne: this.airborne,
      apex: this.airborne && Math.abs(this.vz) < SHOTS.perfectJump.apexSpeed,
      // Players face the net: forward is toward it, so a negative offset is behind them.
      behind: Math.max(0, -(s.y - this.pos.y) * this.forward),
      timing,
      timingLabel,
      timingError: err,
      stretch: Math.hypot(s.x - this.pos.x, s.y - this.pos.y) / PLAYER.reach,
    };
  }

  onHit(point: V3, serve = false) {
    this.swing = null;
    this.recover = SWING.hitRecovery;
    this.anim = { kind: serve ? 'serve' : 'hit', t: 0, point: { ...point } };
    const dx = point.x - this.pos.x, dy = point.y - this.pos.y, d = Math.hypot(dx, dy);
    if (point.z < PLAYER.lungeMaxZ && d > 0.75 && !this.airborne) {
      this.lunge = 0;
      this.lungeDir = { x: dx / d, y: dy / d };
    }
  }

  snapshot(): PlayerView {
    return {
      side: this.side, color: this.color, racketSide: this.racketSide,
      pos: { ...this.pos }, vel: { ...this.vel }, z: this.z, vz: this.vz,
      hand: { ...this.hand }, rdir: { ...this.rdir }, stride: this.stride,
      split: this.split, lunge: this.lunge, lungeDir: { ...this.lungeDir }, charge: this.charge, serving: this.serving,
    };
  }

  /** Where the racket hand wants to be, and which way the racket points. */
  private poseTarget(): { hand: V3; dir: V3 } {
    const S = shoulderOf(this), r = this.racketSide, f = this.forward;
    const at = (x: number, y: number, z: number): V3 => ({ x: S.x + x, y: S.y + y, z: S.z + z });
    const a = this.anim;
    if ((a?.kind === 'hit' || a?.kind === 'serve') && a.point && a.t < 0.06) {
      const d = sub3(a.point, S), L = len3(d), u = norm3(d);
      return { hand: add3(S, mul3(u, clamp(L - RACKET_LENGTH, 0.12, 0.56))), dir: u };
    }
    // Serve follow-through: the racket carries on up and forward rather than down across the body.
    if (a?.kind === 'serve') return { hand: at(-r * 0.05, f * 0.42, 0.05), dir: norm3({ x: -r * 0.25, y: f * 0.5, z: 0.85 }) };
    if (a) return { hand: at(-r * 0.25, f * 0.3, -0.45), dir: norm3({ x: -r * 0.7, y: f * 0.2, z: -0.7 }) };
    // Ready to serve. Forehand: racket drawn back low behind the hip. Backhand: racket in front, head down behind the shuttle.
    if (this.serving === 'forehand') return { hand: at(r * 0.3, -f * 0.32, -0.5), dir: norm3({ x: r * 0.35, y: -f * 0.6, z: 0.6 }) };
    if (this.serving === 'backhand') return { hand: at(-r * 0.12, f * 0.22, -0.42), dir: norm3({ x: r * 0.55, y: f * 0.25, z: -0.8 }) };
    if (this.swing || this.charge !== null) return { hand: at(r * 0.22, -f * 0.05, 0.22), dir: norm3({ x: r * 0.1, y: -f * 0.9, z: -0.35 }) };
    if (lungeAmount(this) > 0.2) {
      const ld = this.lungeDir;
      return { hand: at(ld.x * 0.5, ld.y * 0.5, -0.45), dir: norm3({ x: ld.x, y: ld.y, z: 0.2 }) };
    }
    return { hand: at(r * 0.22, f * 0.3, -0.28), dir: norm3({ x: r * 0.2, y: f * 0.35, z: 1 }) };
  }
}
