import type { Camera } from './camera';
import { SWING, type KeyMap } from './config';
import type { Input } from './input';
import { clamp, type Side, type V2 } from './math';
import type { Player } from './player';
import type { Contact, Intent, ShotRequest } from './shots';

export interface Command { move: V2; jump: boolean; shot: ShotRequest | null }

/** What controllers get told about the rally (the CPU learns from these). */
export type Observation =
  | { type: 'hit'; by: Side; contact: Contact; label: string; landing: V2 | null }
  | { type: 'rally'; winner: Side };

export interface Controller {
  /** Called once per frame with game-time dt. */
  poll(dt: number): Command;
  /** Re-read aim at the moment of contact (direction held / cursor position right now). */
  aimAtContact?(req: ShotRequest): ShotRequest;
  observe?(o: Observation): void;
}

function moveDir(input: Input, k: KeyMap): V2 {
  return {
    x: (input.held(k.right) ? 1 : 0) - (input.held(k.left) ? 1 : 0),
    y: (input.held(k.up) ? 1 : 0) - (input.held(k.down) ? 1 : 0),
  };
}

/** No-mouse mode: three intent buttons, aim with the direction held at contact. */
export class KeyboardController implements Controller {
  constructor(private input: Input, private keys: KeyMap, private player: Player) {}

  poll(): Command {
    const move = moveDir(this.input, this.keys);
    const jump = this.input.tapped(this.keys.jump);
    let shot: ShotRequest | null = null;
    for (const intent of ['high', 'fast', 'soft'] as Intent[]) {
      if (this.input.tapped(this.keys[intent])) {
        shot = { kind: 'intent', intent, aimX: move.x, aimDepth: move.y * -this.player.side };
        break;
      }
    }
    return { move, jump, shot };
  }

  aimAtContact(req: ShotRequest): ShotRequest {
    if (req.kind !== 'intent') return req;
    const d = moveDir(this.input, this.keys);
    // Screen-relative: pushing toward the opponent means deeper for either player.
    return { ...req, aimX: d.x, aimDepth: d.y * -this.player.side };
  }
}

/** Mouse mode: WASD moves, the cursor is the landing spot, hold-and-release swings. */
export class MouseController implements Controller {
  private charge: { arc: 'low' | 'high'; button: 'left' | 'right'; t: number } | null = null;

  constructor(private input: Input, private keys: KeyMap, private player: Player, private camera: Camera) {}

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

  private power(): number { return this.charge ? clamp(this.charge.t / SWING.chargeTime, 0, 1) : 0; }

  target(): V2 {
    return this.camera.groundAt(this.input.mouse.x, this.input.mouse.y) ?? { x: 0, y: -this.player.side * 4 };
  }
}
