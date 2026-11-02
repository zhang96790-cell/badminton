// Turns "what the player asked for" + "how and where they made contact" into a launch velocity.
// The button only expresses intent; contact height, net distance, timing, hand and stretch decide the shot.
import { SERVE, SHOTS, SWING } from './config';
import { netHeightAt, type Rect } from './court';
import { DEG, clamp, gauss, lerp, table, type Side, type V2, type V3 } from './math';
import { angleForSpeed, clearNetAngle, fly2d, softShot, speedForAngle } from './solver';

export type Intent = 'high' | 'fast' | 'soft';

export type ShotRequest =
  /** Keyboard / AI. aimX: -1 left, 0 centre, 1 right (screen). aimDepth: 1 deeper, -1 shorter. target overrides both. */
  | { kind: 'intent'; intent: Intent; aimX: number; aimDepth: number; target?: V2; strength?: number; power?: number }
  /** Mouse. low (left) = drive → smash, high (right) = drop on a tap, lob when held. power 0..1 from charge. target = cursor. */
  | { kind: 'mouse'; arc: 'low' | 'high'; power: number; target: V2 };

export type Hand = 'forehand' | 'backhand' | 'round-the-head';
export type TimingLabel = 'Perfect' | 'Good' | 'Early' | 'Late';

export interface Contact {
  point: V3;
  side: Side;
  hand: Hand;
  airborne: boolean;
  /** 0..1 swing timing quality. */
  timing: number;
  timingLabel: TimingLabel;
  /** Seconds the racket was early (+) or late (−) relative to a perfect swing. */
  timingError: number;
  /** Horizontal distance to the shuttle as a fraction of max reach. */
  stretch: number;
}

export interface Shot { velocity: V3; label: string; speedKmh: number }

export type MouseShot = 'drive' | 'smash' | 'drop' | 'lob';

/** What a mouse swing will be: left click drives (held = smash), right click drops (held = lob). */
export function mouseShotKind(arc: 'low' | 'high', power: number): MouseShot {
  if (arc === 'low') return power >= SHOTS.mouse.smashPower ? 'smash' : 'drive';
  return power < SHOTS.mouse.dropMaxPower ? 'drop' : 'lob';
}

/**
 * What to call a mouse swing given where you'll meet the shuttle: a held right-click is a clear
 * overhead but a lift from low; a tap is a drop overhead, a net shot at the net, a block elsewhere.
 */
export function mouseShotName(kind: MouseShot, contact: V3): string {
  const overhead = contact.z >= SHOTS.overheadHeight;
  const netArea = Math.abs(contact.y) < SHOTS.nearNet;
  const aboveTape = contact.z > netHeightAt(contact.x) + 0.15;
  const low = contact.z < SHOTS.lowHeight;
  switch (kind) {
    case 'smash': return overhead ? 'SMASH' : netArea && aboveTape ? 'KILL' : low ? 'PUSH' : 'DRIVE';
    case 'drive': return overhead ? 'HALF SMASH' : netArea && aboveTape ? 'KILL' : low ? 'PUSH' : 'DRIVE';
    case 'drop': return overhead ? 'DROP' : netArea ? 'NET SHOT' : 'BLOCK';
    case 'lob': return overhead ? 'CLEAR' : 'LIFT';
  }
}

/** The cursor picks direction; the shot type keeps the depth sensible (drops short, lobs deep). */
export function mouseTarget(arc: 'low' | 'high', power: number, cursor: V2, oppSide: number): V2 {
  const kind = mouseShotKind(arc, power), M = SHOTS.mouse;
  const depth = cursor.y * oppSide;
  const d = kind === 'drop' ? clamp(depth, 0.5, M.dropMaxDepth) : kind === 'lob' ? Math.max(depth, M.lobMinDepth) : Math.max(depth, M.driveMinDepth);
  return { x: cursor.x, y: oppSide * d };
}

/** Keep a target on the far side of the net and roughly on the court. */
function clampTarget(t: V2, opp: number, minDepth = SHOTS.minTargetDepth): V2 {
  return { x: clamp(t.x, -4.5, 4.5), y: opp * clamp(t.y * opp, minDepth, 8.5) };
}

type Zone = 'overhead' | 'mid' | 'low';
const zoneOf = (z: number): Zone => (z >= SHOTS.overheadHeight ? 'overhead' : z >= SHOTS.lowHeight ? 'mid' : 'low');

/** Aim line from contact to target, plus where it crosses the net plane and how high the tape is there. */
function geometry(from: V3, target: V2) {
  const dx = target.x - from.x, dy = target.y - from.y;
  const D = Math.max(0.3, Math.hypot(dx, dy));
  const ux = dx / D, uy = dy / D;
  const s = Math.abs(uy) > 1e-3 ? -from.y / uy : -1;
  const sNet = s > 0 ? s : Infinity;
  const netH = netHeightAt(Number.isFinite(sNet) ? from.x + ux * sNet : from.x);
  return { D, ux, uy, sNet, netH };
}

const toVelocity = (ux: number, uy: number, speed: number, angle: number): V3 => ({
  x: ux * speed * Math.cos(angle),
  y: uy * speed * Math.cos(angle),
  z: speed * Math.sin(angle),
});

/** Default landing spot for a keyboard/AI intent, before any aim noise. */
export function intentTarget(intent: Intent, point: V3, side: Side, aimX: number, aimDepth: number): V2 {
  const zone = zoneOf(point.z);
  const netArea = Math.abs(point.y) < SHOTS.nearNet;
  const d = SHOTS.depth;
  let depth: number;
  if (intent === 'high') depth = d.high;
  else if (intent === 'fast') depth = isKill(point) ? d.kill : zone === 'overhead' ? d.smash : zone === 'mid' ? d.drive : d.push;
  else depth = zone === 'overhead' ? d.drop : netArea ? d.netShot : d.block;
  depth += aimDepth > 0 ? SHOTS.depthToward : aimDepth < 0 ? SHOTS.depthAway : 0;
  return { x: clamp(aimX, -1, 1) * SHOTS.aimLateral, y: -side * clamp(depth, 0.5, 6.4) };
}

const isKill = (p: V3) => Math.abs(p.y) < SHOTS.nearNet && p.z > netHeightAt(p.x) + 0.2;

/** Hardest shot at up to `speed` that lands at the target and clears the tape. */
function fastSolve(z0: number, g: ReturnType<typeof geometry>, speed: number, extraDepth: number = SHOTS.netAssistMaxExtraDepth) {
  const need = g.netH + SHOTS.netAssistMargin;
  const low = angleForSpeed(z0, g.D, speed, 'low').angle;
  const raised = clearNetAngle(z0, speed, low, g.sNet, need);
  if (raised === low || fly2d(z0, speed, raised, g.sNet).range <= g.D + extraDepth) {
    return { angle: raised, speed };
  }
  // Too steep to land on target at this pace: hit as hard as the tape allows, landing a little deeper.
  return softShot(z0, g.D + SHOTS.netAssistMaxExtraDepth * 0.75, g.sNet, g.netH, SHOTS.netAssistMargin + 0.02, speed);
}

/** aimScale: multiplier on aim error (the menu's Casual setting for humans). */
export function resolveShot(req: ShotRequest, c: Contact, aimScale = 1): Shot {
  const z0 = c.point.z;
  const zone = zoneOf(z0);
  const netArea = Math.abs(c.point.y) < SHOTS.nearNet;
  const stretched = c.stretch > SHOTS.stretchStart;

  const handPower = c.hand === 'backhand' ? SHOTS.backhandPower : c.hand === 'round-the-head' ? SHOTS.roundTheHeadPower : 1;
  const handNoise = c.hand === 'backhand' ? SHOTS.backhandNoise : c.hand === 'round-the-head' ? SHOTS.roundTheHeadNoise : 1;
  const power = handPower
    * (stretched ? SHOTS.stretchPower : 1)
    * (0.78 + 0.22 * c.timing)
    * (c.airborne && zone === 'overhead' ? SHOTS.jumpSmashBonus : 1)
    * (req.kind === 'intent' ? req.strength ?? 1 : 1);
  const noiseMult = (handNoise * (stretched ? SHOTS.stretchNoise : 1)) / Math.pow(c.timing, 1.3);
  const vMax = table(SHOTS.maxSpeedByHeight, z0) * power;
  const softClearance = netArea ? SHOTS.netShotClearance : zone === 'overhead' ? SHOTS.dropClearance : SHOTS.blockClearance;
  const M = SHOTS.softMaxAngle;
  const softMax = (zone === 'overhead' ? M.overhead : netArea ? M.net : zone === 'mid' ? M.mid : M.low) * DEG;
  const opp = -c.side;

  type Plan = { type: 'angle'; angle: number } | { type: 'speed'; speed: number; extra: number } | { type: 'soft' };
  let target: V2;
  let plan: Plan;
  /** Rough pace of the shot as a fraction of a full smash, known before solving. */
  let pace: number;

  if (req.kind === 'intent') {
    target = req.target ?? intentTarget(req.intent, c.point, c.side, req.aimX, req.aimDepth);
    if (req.intent === 'high') {
      const base = zone === 'overhead' ? SHOTS.clearAngle : zone === 'mid' ? SHOTS.midHighAngle : SHOTS.liftAngle;
      plan = { type: 'angle', angle: base + (req.aimDepth > 0 ? -6 : req.aimDepth < 0 ? 8 : 0) };
    } else if (req.intent === 'fast') {
      // Keyboard K: a tap is full normal power; holding it adds a little extra.
      const bonus = req.power === undefined ? 1 : lerp(1, SWING.keyChargeBonus, req.power);
      plan = { type: 'speed', speed: vMax * bonus, extra: SHOTS.netAssistMaxExtraDepthHard };
    } else {
      plan = { type: 'soft' };
    }
  } else {
    const Mo = SHOTS.mouse, kind = mouseShotKind(req.arc, req.power);
    target = mouseTarget(req.arc, req.power, req.target, opp);
    if (kind === 'drop') plan = { type: 'soft' };
    else if (kind === 'lob') {
      const u = (req.power - Mo.dropMaxPower) / (1 - Mo.dropMaxPower);
      plan = { type: 'angle', angle: lerp(SHOTS.mouseHighAngleMin, SHOTS.mouseHighAngleMax, u) };
    } else {
      const smash = kind === 'smash';
      plan = {
        type: 'speed',
        speed: vMax * lerp(Mo.drivePace, 1, Math.min(1, req.power / Mo.smashPower)),
        extra: smash ? SHOTS.netAssistMaxExtraDepthHard : SHOTS.netAssistMaxExtraDepth,
      };
    }
  }
  const full = SHOTS.maxSpeedByHeight[SHOTS.maxSpeedByHeight.length - 1][1];
  pace = plan.type === 'angle' ? 0.45 : plan.type === 'speed' ? plan.speed / full : 0.12;

  // Longer and harder shots are less accurate: you still aim at a point, it just lands further from it.
  target = clampTarget(target, opp);
  const A = SHOTS.aim;
  const dist = Math.hypot(target.x - c.point.x, target.y - c.point.y);
  const sigma = (A.base + A.perMetre * dist + A.perPower * Math.pow(pace, 1.5)) * noiseMult * aimScale;
  target = clampTarget({ x: target.x + gauss() * sigma, y: target.y + gauss() * sigma * A.depthFactor }, opp, 0.1);
  const clearance = Math.max(-0.1, softClearance + gauss() * SHOTS.clearanceNoise * noiseMult * aimScale);
  const g = geometry(c.point, target);

  let angle: number, speed: number;
  switch (plan.type) {
    case 'angle': {
      // Steepen until it clears the tape (e.g. a lift scooped from right under the net).
      const cap = Math.max(vMax, SHOTS.highSpeedFloor * power);
      angle = plan.angle * DEG;
      let sp = speedForAngle(z0, g.D, angle, cap);
      // Too steep to reach that deep: flatten it until it can, rather than letting it die mid-court.
      while (!sp.reachable && angle > 18 * DEG) {
        angle -= 3 * DEG;
        sp = speedForAngle(z0, g.D, angle, cap);
      }
      speed = sp.speed;
      while (angle < 80 * DEG && fly2d(z0, speed, angle, g.sNet).netZ < g.netH + 0.15) {
        angle += 4 * DEG;
        speed = speedForAngle(z0, g.D, angle, cap).speed;
      }
      break;
    }
    case 'speed':
      ({ angle, speed } = fastSolve(z0, g, plan.speed, plan.extra));
      break;
    case 'soft':
      ({ angle, speed } = softShot(z0, g.D, g.sNet, g.netH, clearance, SHOTS.softSpeedCap, softMax));
      break;
  }

  speed *= 1 + gauss() * SHOTS.speedNoise * noiseMult;
  const rise = fly2d(z0, speed, angle, Infinity).apex - z0;
  const label = classify(zone, netArea, angle / DEG, speed, c.airborne, Math.abs(target.y), rise);
  return { velocity: toVelocity(g.ux, g.uy, speed, angle), label, speedKmh: speed * 3.6 };
}

/** Name the shot from what it actually does: where it was hit, how fast, how high it rises and how deep it lands. */
function classify(zone: Zone, netArea: boolean, deg: number, speed: number, airborne: boolean, depth: number, rise: number): string {
  const lob = depth >= 4.2 && rise > 1.2;
  if (zone === 'overhead') {
    if (deg < -2 && speed >= 40) return netArea ? 'Net kill' : airborne ? 'Jump smash' : 'Smash';
    if (lob) return 'Clear';
    if (depth < 3.7) return netArea && depth < 2.2 ? 'Net shot' : speed >= 30 ? 'Fast drop' : 'Drop';
    return deg < 3 ? 'Half smash' : 'Flat clear';
  }
  if (zone === 'mid') {
    if (netArea && deg < -2 && speed >= 22) return 'Net kill';
    if (lob) return 'Lift';
    if (netArea && depth < 2.2) return 'Net shot';
    return speed >= 20 && rise < 1 ? 'Drive' : 'Block';
  }
  if (lob) return 'Lift';
  if (netArea && depth < 2.2) return 'Net shot';
  return speed >= 16 ? 'Push' : 'Block';
}

/** Serves are struck below 1.15 m (always legal) into the diagonal service court `box`. */
export function resolveServe(req: ShotRequest, from: V3, server: Side, box: Rect): Shot {
  const rs = -server;
  let type: 'short' | 'high' | 'flick';
  let target: V2;
  let angleDeg = SERVE.highAngle;

  if (req.kind === 'intent') {
    type = req.intent === 'soft' ? 'short' : req.intent === 'high' ? 'high' : 'flick';
    const x = req.aimX < 0 ? box.xMin + 0.35 : req.aimX > 0 ? box.xMax - 0.35 : (box.xMin + box.xMax) / 2;
    // Long serves stay inside the box: in doubles that's the long service line, well short of the back line.
    const far = Math.max(Math.abs(box.yMin), Math.abs(box.yMax)) - SERVE.doubles.longMargin;
    const depth = Math.min(far, type === 'short' ? SERVE.shortDepth : type === 'high' ? SERVE.highDepth : SERVE.flickDepth);
    target = { x, y: rs * depth };
    angleDeg = type === 'flick' ? SERVE.flickAngle : SERVE.highAngle;
  } else {
    target = clampTarget(req.target, rs);
    type = req.arc === 'low' ? 'short' : req.power < 0.5 ? 'flick' : 'high';
    angleDeg = lerp(SERVE.flickAngle, SERVE.highAngle, req.power);
  }

  const sigma = type === 'short' ? SERVE.shortNoise : SERVE.longNoise;
  target = { x: target.x + gauss() * sigma, y: target.y + gauss() * sigma * 1.3 };
  const g = geometry(from, target);
  const sol = type === 'short'
    ? softShot(from.z, g.D, g.sNet, g.netH, SERVE.shortClearance, SHOTS.softSpeedCap)
    : { angle: angleDeg * DEG, speed: speedForAngle(from.z, g.D, angleDeg * DEG, SERVE.speedCap).speed };
  const label = type === 'short' ? 'Short serve' : type === 'high' ? 'High serve' : 'Flick serve';
  return { velocity: toVelocity(g.ux, g.uy, sol.speed, sol.angle), label, speedKmh: sol.speed * 3.6 };
}
