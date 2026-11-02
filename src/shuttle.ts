import { COURT, PHYSICS } from './config';
import { netHeightAt } from './court';
import type { Side, V3 } from './math';

/** Quadratic drag constant: drag accel = k·|v|·v, chosen so drag balances gravity at terminal velocity. */
export const dragK = () => PHYSICS.gravity / (PHYSICS.terminalVelocity * PHYSICS.terminalVelocity);

const A1 = [0, 0, 0], A2 = [0, 0, 0], A3 = [0, 0, 0], A4 = [0, 0, 0];

function accel(vx: number, vy: number, vz: number, k: number, g: number, out: number[]) {
  const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
  out[0] = -k * s * vx;
  out[1] = -k * s * vy;
  out[2] = -g - k * s * vz;
}

/** One RK4 step of shuttle flight (gravity + quadratic drag). Mutates p and v. */
export function stepFlight(p: V3, v: V3, dt: number): void {
  const k = dragK(), g = PHYSICS.gravity, h = dt / 2;
  accel(v.x, v.y, v.z, k, g, A1);
  const v2x = v.x + A1[0] * h, v2y = v.y + A1[1] * h, v2z = v.z + A1[2] * h;
  accel(v2x, v2y, v2z, k, g, A2);
  const v3x = v.x + A2[0] * h, v3y = v.y + A2[1] * h, v3z = v.z + A2[2] * h;
  accel(v3x, v3y, v3z, k, g, A3);
  const v4x = v.x + A3[0] * dt, v4y = v.y + A3[1] * dt, v4z = v.z + A3[2] * dt;
  accel(v4x, v4y, v4z, k, g, A4);
  const s = dt / 6;
  p.x += s * (v.x + 2 * v2x + 2 * v3x + v4x);
  p.y += s * (v.y + 2 * v2y + 2 * v3y + v4y);
  p.z += s * (v.z + 2 * v2z + 2 * v3z + v4z);
  v.x += s * (A1[0] + 2 * A2[0] + 2 * A3[0] + A4[0]);
  v.y += s * (A1[1] + 2 * A2[1] + 2 * A3[1] + A4[1]);
  v.z += s * (A1[2] + 2 * A2[2] + 2 * A3[2] + A4[2]);
}

export interface PathSample { t: number; p: V3 }

/** Forward-simulate a flight with the same integrator the game uses (for the AI). */
export function predictPath(pos: V3, vel: V3, maxT = 6): { samples: PathSample[]; landing: V3; netFault: boolean } {
  const p = { ...pos }, v = { ...vel }, dt = PHYSICS.dt;
  const samples: PathSample[] = [];
  let t = 0;
  while (t < maxT) {
    const py = p.y, pz = p.z, px = p.x;
    stepFlight(p, v, dt);
    t += dt;
    if (py * p.y < 0) {
      const f = py / (py - p.y);
      const x = px + (p.x - px) * f, z = pz + (p.z - pz) * f;
      if (Math.abs(x) <= COURT.postX && z < netHeightAt(x) - PHYSICS.netCordTolerance) {
        return { samples, landing: { ...p }, netFault: true };
      }
    }
    if (p.z <= 0) break;
    samples.push({ t, p: { ...p } });
  }
  return { samples, landing: { ...p }, netFault: false };
}

export class Shuttle {
  pos: V3 = { x: 0, y: 0, z: 1 };
  vel: V3 = { x: 0, y: 0, z: 0 };
  /** Unit vector the cork points along. Cork-first means it trails the velocity. */
  dir: V3 = { x: 0, y: 0, z: -1 };
  inFlight = false;
  lastHitter: Side | null = null;
  /** Total contacts so far (never reset, so a new hit always changes it). */
  hits = 0;
  isServe = false;
  touchedNet = false;
  wide = false;
  trail: V3[] = [];

  hold(at: V3) {
    this.pos = { ...at };
    this.vel = { x: 0, y: 0, z: 0 };
    this.dir = { x: 0, y: 0, z: -1 };
    this.inFlight = false;
    this.lastHitter = null;
    // hits keeps counting across points: anything watching for a new hit always sees one.
    this.touchedNet = false;
    this.wide = false;
    this.trail = [];
  }

  launch(from: V3, vel: V3, hitter: Side, serve: boolean) {
    // dir is left alone: the shuttle arrives cork-first toward the hitter, so it leaves the
    // racket skirt-first and visibly turns over.
    this.pos = { ...from };
    this.vel = { ...vel };
    this.inFlight = true;
    this.lastHitter = hitter;
    this.isServe = serve;
    this.hits++;
  }

  /** Turn toward the direction of travel. */
  orient(dt: number) {
    const sp = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    if (sp < 0.2) return;
    const tx = this.vel.x / sp, ty = this.vel.y / sp, tz = this.vel.z / sp;
    const a = Math.min(1, PHYSICS.turnoverRate * dt);
    let x = this.dir.x + (tx - this.dir.x) * a;
    let y = this.dir.y + (ty - this.dir.y) * a;
    let z = this.dir.z + (tz - this.dir.z) * a;
    let len = Math.hypot(x, y, z);
    if (len < 0.05) { z += 0.3; len = Math.hypot(x, y, z); } // mid-flip: tumble over the top
    this.dir = { x: x / len, y: y / len, z: z / len };
  }
}
