import { CAMERA, COURT } from './config';
import type { V2, V3 } from './math';

/** Perspective camera. Fixed views fit themselves to the screen; Hawk-Eye animates one by hand. */
export class Camera {
  private pos: V3 = { x: 0, y: 0, z: 1 };
  private f: V3 = { x: 0, y: 1, z: 0 };
  private r: V3 = { x: 1, y: 0, z: 0 };
  private u: V3 = { x: 0, y: 0, z: 1 };
  private F = 1;
  private cx = 0;
  private cy = 0;

  constructor(pos?: V3, target?: V3, private fitPoints: V3[] = [], private centerY = 0.53, private fill = { w: 0.94, h: 0.84 }) {
    if (pos && target) this.look(pos, target);
  }

  /** Change what this camera fits to the screen (call fit() afterwards). */
  setFit(points: V3[], centerY: number, fill: { w: number; h: number }) {
    this.fitPoints = points;
    this.centerY = centerY;
    this.fill = fill;
  }

  look(pos: V3, target: V3) {
    this.pos = { ...pos };
    const fx = target.x - pos.x, fy = target.y - pos.y, fz = target.z - pos.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    this.f = { x: fx / fl, y: fy / fl, z: fz / fl };
    let rx = this.f.y, ry = -this.f.x; // f × up
    let rl = Math.hypot(rx, ry);
    if (rl < 1e-4) { rx = 1; ry = 0; rl = 1; } // looking straight down
    this.r = { x: rx / rl, y: ry / rl, z: 0 };
    const { f, r } = this;
    this.u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  }

  setLens(F: number, cx: number, cy: number) {
    this.F = F;
    this.cx = cx;
    this.cy = cy;
  }

  get forward(): V3 { return this.f; }

  private cam(p: V3) {
    const dx = p.x - this.pos.x, dy = p.y - this.pos.y, dz = p.z - this.pos.z;
    return {
      x: dx * this.r.x + dy * this.r.y + dz * this.r.z,
      y: dx * this.u.x + dy * this.u.y + dz * this.u.z,
      z: dx * this.f.x + dy * this.f.y + dz * this.f.z,
    };
  }

  /** Scale and centre so the fit points fill the screen. */
  fit(w: number, h: number) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.fitPoints) {
      const c = this.cam(p), zc = Math.max(0.1, c.z);
      const x = c.x / zc, y = -c.y / zc;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    this.F = Math.min((w * this.fill.w) / (maxX - minX), (h * this.fill.h) / (maxY - minY));
    this.cx = w / 2 - (this.F * (minX + maxX)) / 2;
    this.cy = h * this.centerY - (this.F * (minY + maxY)) / 2;
  }

  /** Distance in front of the camera (for painter's ordering). */
  depth(p: V3): number { return this.cam(p).z; }

  /** Screen position plus pixels-per-metre at that depth. */
  project(p: V3): { x: number; y: number; s: number } {
    const c = this.cam(p), zc = Math.max(0.1, c.z);
    return { x: this.cx + (this.F * c.x) / zc, y: this.cy - (this.F * c.y) / zc, s: this.F / zc };
  }

  /** Project a polygon, clipping it against the near plane so parts behind the camera don't wrap. */
  projectPoly(pts: V3[], near = 0.05): { x: number; y: number }[] {
    const cs = pts.map((p) => this.cam(p));
    const out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const ain = a.z >= near, bin = b.z >= near;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (near - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near });
      }
    }
    return out.map((c) => ({ x: this.cx + (this.F * c.x) / c.z, y: this.cy - (this.F * c.y) / c.z }));
  }

  /** Floor point under a screen position, or null if the ray points at the sky. */
  groundAt(sx: number, sy: number): V2 | null {
    const a = (sx - this.cx) / this.F, b = -(sy - this.cy) / this.F;
    const dx = this.f.x + this.r.x * a + this.u.x * b;
    const dy = this.f.y + this.r.y * a + this.u.y * b;
    const dz = this.f.z + this.r.z * a + this.u.z * b;
    if (dz >= -1e-4) return null;
    const t = -this.pos.z / dz;
    return { x: this.pos.x + dx * t, y: this.pos.y + dy * t };
  }
}

export type View = 'broadcast' | 'close' | 'player' | 'overhead';
/** The in-game views in the order the View button cycles through them. */
export const VIEWS: { id: View; label: string }[] = [
  { id: 'close', label: 'Close' }, { id: 'broadcast', label: 'Broadcast' }, { id: 'player', label: 'Player' }, { id: 'overhead', label: 'Overhead' },
];

/**
 * Point the main camera for a view. Broadcast: court, run-off and most clears fit the screen.
 * Close: just the court and both players, so everything is bigger (high clears leave the top edge).
 */
export function setView(cam: Camera, view: View) {
  if (view === 'broadcast') {
    const W = COURT.doublesHalfWidth + 0.8, L = COURT.halfLength + 1.0;
    cam.look(CAMERA.broadcast.pos, CAMERA.broadcast.target);
    cam.setFit([
      { x: -W, y: -L, z: 0 }, { x: W, y: -L, z: 0 }, { x: -W, y: L, z: 0 }, { x: W, y: L, z: 0 },
      { x: 0, y: L - 0.4, z: 2.6 }, { x: -W, y: -L, z: 1.0 }, { x: W, y: -L, z: 1.0 },
      { x: 0, y: 1.5, z: 5.2 },
    ], 0.53, { w: 0.94, h: 0.84 });
  } else if (view === 'player') {
    const W = COURT.doublesHalfWidth + 0.1, L = COURT.halfLength + 0.2;
    cam.look(CAMERA.player.pos, CAMERA.player.target);
    cam.setFit([
      { x: -W, y: -L, z: 0 }, { x: W, y: -L, z: 0 }, { x: -W, y: L, z: 0 }, { x: W, y: L, z: 0 },
      { x: 0, y: L - 0.3, z: 2.4 },
    ], 0.5, { w: 0.98, h: 0.86 });
  } else if (view === 'overhead') {
    const W = COURT.doublesHalfWidth + 0.5, L = COURT.halfLength + 0.5;
    cam.look(CAMERA.overhead.pos, CAMERA.overhead.target);
    cam.setFit([
      { x: -W, y: -L, z: 0 }, { x: W, y: -L, z: 0 }, { x: -W, y: L, z: 0 }, { x: W, y: L, z: 0 },
      { x: 0, y: 0, z: 1.55 },
    ], 0.5, { w: 0.94, h: 0.86 });
  } else {
    const W = COURT.doublesHalfWidth + 0.15, L = COURT.halfLength + 0.35;
    cam.look(CAMERA.close.pos, CAMERA.close.target);
    cam.setFit([
      { x: -W, y: -L, z: 0 }, { x: W, y: -L, z: 0 }, { x: -W, y: L, z: 0 }, { x: W, y: L, z: 0 },
      { x: 0, y: L - 0.3, z: 2.3 },
    ], 0.5, { w: 0.98, h: 0.84 });
  }
}

export function broadcastCamera(view: View = 'broadcast'): Camera {
  const cam = new Camera();
  setView(cam, view);
  return cam;
}

/** Side-on replay camera. */
export function sideCamera(): Camera {
  const L = COURT.halfLength + 0.8;
  return new Camera(CAMERA.side.pos, CAMERA.side.target, [
    { x: 0, y: -L, z: 0 }, { x: 0, y: L, z: 0 }, { x: 0, y: -L, z: 2.4 }, { x: 0, y: L, z: 2.4 }, { x: 0, y: 0, z: 5.5 },
  ], 0.56);
}

/** Replay cameras V cycles through. */
export type ReplayCam = 'broadcast' | 'side' | 'low' | 'overhead' | 'reverse';
export const REPLAY_CAMS: { id: ReplayCam; label: string }[] = [
  { id: 'broadcast', label: 'Broadcast camera' }, { id: 'side', label: 'Side camera' }, { id: 'low', label: 'Low camera' },
  { id: 'overhead', label: 'Overhead camera' }, { id: 'reverse', label: 'Reverse angle' },
];

/** From behind the far baseline, looking back at the near player. */
export function reverseCamera(): Camera {
  const W = COURT.doublesHalfWidth + 0.8, L = COURT.halfLength + 1.0;
  return new Camera({ x: 0, y: 14.2, z: 8.6 }, { x: 0, y: -0.8, z: 0.3 }, [
    { x: -W, y: -L, z: 0 }, { x: W, y: -L, z: 0 }, { x: -W, y: L, z: 0 }, { x: W, y: L, z: 0 }, { x: 0, y: -L + 0.4, z: 2.6 },
  ], 0.53);
}
