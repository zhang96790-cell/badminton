// Inverse ballistics for a high-drag projectile. With no wind the shuttle stays in the vertical
// plane through contact and target, so every solve is 2D: s = distance along the aim, z = height.
import { PHYSICS } from './config';
import { DEG } from './math';
import { dragK } from './shuttle';

export interface Flight { range: number; netZ: number; apex: number; time: number }

/** Fly a shot launched from height z0. netZ is the height when passing sNet (-Infinity if it never gets there). */
export function fly2d(z0: number, speed: number, angle: number, sNet: number): Flight {
  const k = dragK(), g = PHYSICS.gravity, dt = PHYSICS.solverDt, h = dt / 2;
  let s = 0, z = z0, vs = speed * Math.cos(angle), vz = speed * Math.sin(angle), t = 0;
  let netZ = sNet <= 0 ? z0 : -Infinity, apex = z0;
  while (t < 8) {
    const ps = s, pz = z;
    // RK4
    let sp = Math.hypot(vs, vz);
    const a1s = -k * sp * vs, a1z = -g - k * sp * vz;
    const v2s = vs + a1s * h, v2z = vz + a1z * h;
    sp = Math.hypot(v2s, v2z);
    const a2s = -k * sp * v2s, a2z = -g - k * sp * v2z;
    const v3s = vs + a2s * h, v3z = vz + a2z * h;
    sp = Math.hypot(v3s, v3z);
    const a3s = -k * sp * v3s, a3z = -g - k * sp * v3z;
    const v4s = vs + a3s * dt, v4z = vz + a3z * dt;
    sp = Math.hypot(v4s, v4z);
    const a4s = -k * sp * v4s, a4z = -g - k * sp * v4z;
    s += (dt / 6) * (vs + 2 * v2s + 2 * v3s + v4s);
    z += (dt / 6) * (vz + 2 * v2z + 2 * v3z + v4z);
    vs += (dt / 6) * (a1s + 2 * a2s + 2 * a3s + a4s);
    vz += (dt / 6) * (a1z + 2 * a2z + 2 * a3z + a4z);
    t += dt;
    if (ps < sNet && s >= sNet) netZ = pz + ((z - pz) * (sNet - ps)) / (s - ps);
    if (z > apex) apex = z;
    if (z <= 0) {
      const f = pz / (pz - z);
      return { range: ps + (s - ps) * f, netZ, apex, time: t - dt + dt * f };
    }
  }
  return { range: s, netZ, apex, time: t };
}

/** Launch angle giving the longest carry at this speed (golden-section search). */
export function maxRange(z0: number, speed: number): { angle: number; range: number } {
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = -0.4, b = 1.2;
  let c = b - gr * (b - a), d = a + gr * (b - a);
  let fc = fly2d(z0, speed, c, Infinity).range, fd = fly2d(z0, speed, d, Infinity).range;
  for (let i = 0; i < 18; i++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = fly2d(z0, speed, c, Infinity).range; }
    else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = fly2d(z0, speed, d, Infinity).range; }
  }
  const angle = (a + b) / 2;
  return { angle, range: fly2d(z0, speed, angle, Infinity).range };
}

/** Fixed speed → angle that lands at distance D. 'low' = flat/downward solution, 'high' = lob. */
export function angleForSpeed(z0: number, D: number, speed: number, arc: 'low' | 'high'): { angle: number; reachable: boolean } {
  const m = maxRange(z0, speed);
  if (m.range <= D) return { angle: m.angle, reachable: false };
  let lo = arc === 'low' ? -1.45 : m.angle;
  let hi = arc === 'low' ? m.angle : 1.5;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const r = fly2d(z0, speed, mid, Infinity).range;
    const tooShort = r < D;
    if (arc === 'low' ? tooShort : !tooShort) lo = mid; else hi = mid;
  }
  return { angle: (lo + hi) / 2, reachable: true };
}

/** Fixed angle → speed that lands at distance D (capped). */
export function speedForAngle(z0: number, D: number, angle: number, cap: number): { speed: number; reachable: boolean } {
  if (fly2d(z0, cap, angle, Infinity).range < D) return { speed: cap, reachable: false };
  let lo = 0.5, hi = cap;
  for (let i = 0; i < 15; i++) {
    const mid = (lo + hi) / 2;
    if (fly2d(z0, mid, angle, Infinity).range < D) lo = mid; else hi = mid;
  }
  return { speed: (lo + hi) / 2, reachable: true };
}

/**
 * Softest shot that lands at D while passing the net plane `clearance` above the tape, launched no
 * steeper than maxAngle. Net-crossing height rises with launch angle for a fixed landing spot, so
 * bisect on angle. If even maxAngle can't clear the tape at D, the target is too tight: keep the angle
 * and add pace until it clears, so it lands a little deeper instead of floating up and dying.
 */
export function softShot(z0: number, D: number, sNet: number, netH: number, clearance: number, cap: number, maxAngle = 82 * DEG): { angle: number; speed: number } {
  const want = netH + clearance;
  const split = maxRange(z0, cap).angle;
  let lo = -40 * DEG, hi = maxAngle;
  let best: { angle: number; speed: number } | null = null;
  for (let i = 0; i < 13; i++) {
    const mid = (lo + hi) / 2;
    const sp = speedForAngle(z0, D, mid, cap);
    const err = sp.reachable ? fly2d(z0, sp.speed, mid, sNet).netZ - want : mid < split ? -Infinity : Infinity;
    if (err < 0) lo = mid;
    else { hi = mid; if (sp.reachable) best = { angle: mid, speed: sp.speed }; }
  }
  if (best) return best;
  return { angle: maxAngle, speed: speedToClear(z0, maxAngle, sNet, want, cap) };
}

/** Slowest speed at this angle that passes the net plane at height `need`. */
export function speedToClear(z0: number, angle: number, sNet: number, need: number, cap: number): number {
  if (fly2d(z0, cap, angle, sNet).netZ < need) return cap;
  let lo = 0.5, hi = cap;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fly2d(z0, mid, angle, sNet).netZ >= need) hi = mid; else lo = mid;
  }
  return hi;
}

/** Raise a fixed-speed shot's angle until it passes the net plane at height `need`. Lands deeper as a result. */
export function clearNetAngle(z0: number, speed: number, angle: number, sNet: number, need: number): number {
  if (fly2d(z0, speed, angle, sNet).netZ >= need) return angle;
  let lo = angle, hi = 70 * DEG;
  if (fly2d(z0, speed, hi, sNet).netZ < need) return hi;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fly2d(z0, speed, mid, sNet).netZ < need) lo = mid; else hi = mid;
  }
  return hi;
}
