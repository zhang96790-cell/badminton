import type { Camera } from './camera';
import { SHOTS, SWING, type KeyMap } from './config';
import type { Input } from './input';
import { clamp, type Side, type V2 } from './math';
import type { Player } from './player';
import type { Contact, ShotRequest } from './shots';

export interface Command { move: V2; jump: boolean; shot: ShotRequest | null }

/** What controllers get told about the rally (the CPU learns from these). */
export type Observation =
  | { type: 'hit'; by: Side; contact: Contact; label: string; landing: V2 | null; hitter: Player }
  | { type: 'rally'; winner: Side };

export interface Controller {
  /** Called once per frame with game-time dt. */
  poll(dt: number): Command;
  /** Still holding a charge as the shuttle is about to get past: let go now (returns the shot). */
  forceRelease?(): ShotRequest | null;
  /** Re-read aim at the moment of contact (direction held / cursor position right now). */
  aimAtContact?(req: ShotRequest): ShotRequest;
  observe?(o: Observation): void;
  /** Take over a different player (doubles auto-switch). */
  bind?(p: Player): void;
}

function moveDir(input: Input, k: KeyMap): V2 {
  return {
    x: (input.held(k.right) ? 1 : 0) - (input.held(k.left) ? 1 : 0),
    y: (input.held(k.up) ? 1 : 0) - (input.held(k.down) ? 1 : 0),
  };
}

/**
 * No-mouse mode: three intent buttons, aim with the direction held at contact. High and soft swing
 * the moment you press. Fast charges while held and swings on release: a tap is a drive, holding
 * gives a harder shot up to a full smash. The kill key is instant full power.
 */
export class KeyboardController implements Controller {
  private chargeT: number | null = null;

  /** With a camera, the cursor (trackpad) aims left/right; the aim keys still override it. */
  constructor(private input: Input, private keys: KeyMap, private player: Player, private camera?: Camera) {}

  bind(p: Player) { this.player = p; this.chargeT = null; }

  get cursorAim(): boolean { return !!this.camera; }

  /** Cursor's spot on the opponent's court, or null if it's elsewhere. */
  target(): V2 | null {
    if (!this.camera) return null;
    const g = this.camera.groundAt(this.input.mouse.x, this.input.mouse.y);
    return g && g.y * this.player.side < 0 ? g : null;
  }

  /** -1 left … 1 right; 0 = let the game pick the open side. Movement keys never aim. */
  private aimX(): number {
    const keys = (this.input.held(this.keys.aimRight) ? 1 : 0) - (this.input.held(this.keys.aimLeft) ? 1 : 0);
    if (keys) return keys;
    const t = this.target();
    return t ? clamp(t.x / SHOTS.aimLateral, -1, 1) : 0;
  }

  poll(dt: number): Command {
    const move = moveDir(this.input, this.keys);
    const jump = this.input.tapped(this.keys.jump);
    const aim = { aimX: this.aimX(), aimDepth: 0 };
    let shot: ShotRequest | null = null;
    if (this.input.tapped(this.keys.kill)) {
      this.chargeT = null;
      shot = { kind: 'intent', intent: 'fast', ...aim };
    } else if (this.input.tapped(this.keys.high)) shot = { kind: 'intent', intent: 'high', ...aim };
    else if (this.input.tapped(this.keys.soft)) shot = { kind: 'intent', intent: 'soft', ...aim };
    if (!shot && this.input.tapped(this.keys.fast)) this.chargeT = 0;
    if (this.chargeT !== null && !shot) {
      this.chargeT += dt;
      if (!this.input.held(this.keys.fast)) {
        shot = { kind: 'intent', intent: 'fast', ...aim, power: this.power() };
        this.chargeT = null;
      }
    }
    this.player.charge = this.chargeT !== null ? this.power() : null;
    return { move, jump, shot };
  }

  private power(): number { return clamp((this.chargeT ?? 0) / SWING.keyChargeTime, 0, 1); }

  forceRelease(): ShotRequest | null {
    if (this.chargeT === null) return null;
    const shot: ShotRequest = { kind: 'intent', intent: 'fast', aimX: this.aimX(), aimDepth: 0, power: this.power() };
    this.chargeT = null;
    this.player.charge = null;
    return shot;
  }

  /** An aim key held at contact wins; otherwise keep the aim from when the shot key was pressed. */
  aimAtContact(req: ShotRequest): ShotRequest {
    if (req.kind !== 'intent') return req;
    const a = this.aimX();
    return a !== 0 ? { ...req, aimX: a } : req;
  }
}

/** Mouse mode: WASD moves, the cursor is the landing spot, hold-and-release swings. */
export class MouseController implements Controller {
  private charge: { arc: 'low' | 'high'; button: 'left' | 'right'; t: number } | null = null;

  constructor(private input: Input, private keys: KeyMap, private player: Player, private camera: Camera) {}

  bind(p: Player) { this.player = p; this.charge = null; }

  poll(dt: number): Command {
    const move = moveDir(this.input, this.keys);
    const jump = this.input.tapped(this.keys.jump);
    const m = this.input.mouse;
    let shot: ShotRequest | null = null;
    if (this.input.tapped(this.keys.kill)) {
      // Kill: instant full power at the cursor, no charging (net kills, snap smashes).
      this.charge = null;
      shot = { kind: 'mouse', arc: 'low', power: 1, target: this.target() };
    }
    for (const p of m.pressed) {
      if (!this.charge) this.charge = { arc: p.button === 'right' || p.modified ? 'high' : 'low', button: p.button, t: 0 };
    }
    if (this.charge && !shot) {
      this.charge.t += dt;
      if (m.released.includes(this.charge.button)) {
        shot = { kind: 'mouse', arc: this.charge.arc, power: this.power(), target: this.target() };
        this.charge = null;
      }
    }
    this.player.charge = this.charge ? this.power() : null;
    return { move, jump, shot };
  }

  aimAtContact(req: ShotRequest): ShotRequest {
    return req.kind === 'mouse' ? { ...req, target: this.target() } : req;
  }

  get arc(): 'low' | 'high' | null { return this.charge?.arc ?? null; }

  forceRelease(): ShotRequest | null {
    if (!this.charge) return null;
    const shot: ShotRequest = { kind: 'mouse', arc: this.charge.arc, power: this.power(), target: this.target() };
    this.charge = null;
    this.player.charge = null;
    return shot;
  }

  private power(): number { return this.charge ? clamp(this.charge.t / SWING.chargeTime, 0, 1) : 0; }

  target(): V2 {
    return this.camera.groundAt(this.input.mouse.x, this.input.mouse.y) ?? { x: 0, y: -this.player.side * 4 };
  }
}
