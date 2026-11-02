// Online play: how the other players' moves reach this screen.
// Each screen shows its own team on the near side, so everything from the other team is turned round
// (x and y flipped) on arrival. Each person is in charge of their own movement and hits, the host's
// screen also plays any CPUs, and the shuttle's flight after a hit is worked out identically everywhere.
import type { Command, Controller } from './controllers';
import type { V2, V3 } from './math';
import type { LineupSlot, RoomConnection } from './net';
import type { Player } from './player';

export interface OnlineLink {
  conn: RoomConnection;
  /** The room creator referees points (in/out, scoring) and plays any CPUs. */
  host: boolean;
  opponentName: string;
  /** Quick match: both ratings before the match. Null for private rooms. */
  ranked?: { mine: number; theirs: number } | null;
  /** Doubles: the four slots (0 and 2 the host's team, 1 and 3 the other) and which one is you. */
  lineup?: LineupSlot[];
  me?: number;
}

/** Quick chat: number keys 1–6 during an online match. Preset only, no typing. */
export const CHAT = ['Good shot!', 'Nice rally', 'Unlucky', 'Ready?', 'GG', 'Thanks!'];

/** The other player's coordinates turned round to this screen's view. */
export const flip2 = (x: number, y: number): V2 => ({ x: -x, y: -y });
export const flip3 = (a: [number, number, number]): V3 => ({ x: -a[0], y: -a[1], z: a[2] });

/**
 * Drives another player (a person elsewhere, or the host's CPU) from position updates (ONLINE.posRate a
 * second). It steers toward
 * the latest position like a player running there, so movement looks smooth between updates, and
 * snaps if it falls far behind.
 */
export class RemoteController implements Controller {
  private target: V2 | null = null;
  private jumpPending = false;

  constructor(private player: Player) {}

  /** A position update, already turned round. */
  update(p: V2, charge: number | null, jumped: boolean) {
    this.target = p;
    this.player.charge = charge;
    if (jumped) this.jumpPending = true;
  }

  /** Forget the last target (a new point is starting and players are placed for the serve). */
  reset() { this.target = null; this.jumpPending = false; }

  poll(): Command {
    const cmd: Command = { move: { x: 0, y: 0 }, jump: false, shot: null };
    const t = this.target, me = this.player;
    if (!t || me.frozen) return cmd;
    const dx = t.x - me.pos.x, dy = t.y - me.pos.y, d = Math.hypot(dx, dy);
    if (d > 1.6) { me.pos.x = t.x; me.pos.y = t.y; }
    else if (d > 0.03) {
      const m = Math.min(1, d / 0.35);
      cmd.move = { x: (dx / d) * m, y: (dy / d) * m };
    }
    if (this.jumpPending) { cmd.jump = true; this.jumpPending = false; }
    return cmd;
  }
}
