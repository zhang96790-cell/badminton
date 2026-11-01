import { AI, COURT, PHYSICS, PLAYER, SHOTS, STYLES, SWING, type AILevel, type Level, type Style } from './config';
import type { Command, Controller, Observation } from './controllers';
import { distanceOut, inSinglesHalf, netHeightAt } from './court';
import { chance, clamp, gauss, pick, weightedPick, type V2, type V3 } from './math';
import type { LineCall } from './officials';
import type { Player } from './player';
import { intentTarget, type Intent, type ShotRequest } from './shots';
import { predictPath } from './shuttle';
import type { Game } from './game';

interface Plan {
  leave: boolean;
  contact: V3;
  stand: V2;
  swingAt: number;
  jumpAt: number | null;
  intent: Intent;
  swung: boolean;
  jumped: boolean;
}

/** Distance coverable from rest in time T with accel a and top speed vmax. */
function coverable(T: number, vmax: number, a: number): number {
  if (T <= 0) return 0;
  const tAcc = vmax / a;
  return T < tAcc ? 0.5 * a * T * T : vmax * (T - tAcc / 2);
}

/** Six target zones on a half: front/mid/back × left/right. */
const zoneOf = (p: V2) => (Math.abs(p.y) < 2.6 ? 0 : Math.abs(p.y) < 4.6 ? 2 : 4) + (p.x < 0 ? 0 : 1);

/**
 * Reads the shuttle like a player: after a reaction delay it predicts the flight, picks the highest
 * contact point it can reach in time, moves there and swings with some timing error.
 * Shot choice is tactical: attack short lifts, use open space, go short when you're deep and deep
 * when you're at the net. Over a match it learns where you struggle and where you like to hit.
 */
export class AIController implements Controller {
  private L: AILevel;
  private S: (typeof STYLES)[Style];
  private plan: Plan | null = null;
  private seenHits = -1;
  private clock = 0;
  private serveWait = 0;
  // What it has learned about you this match.
  private oppLandings: V2[] = [];
  private zoneTries = [1, 1, 1, 1, 1, 1];
  private zoneWeak = [0.35, 0.35, 0.35, 0.35, 0.35, 0.35];
  private lastTargetZone: number | null = null;
  private lastIntent: Intent | null = null;

  constructor(private game: Game, private me: Player, private opp: Player, level: Level, style: Style) {
    this.L = AI[level];
    this.S = STYLES[style];
    me.speedMult = this.L.speed * this.S.speed;
  }

  poll(dt: number): Command {
    const g = this.game, sh = g.shuttle;
    const cmd: Command = { move: { x: 0, y: 0 }, jump: false, shot: null };

    if (g.state === 'serve') {
      this.plan = null;
      this.seenHits = -1;
      if (g.server === this.me && g.canServe()) {
        this.serveWait += dt;
        if (this.serveWait > this.L.serveDelay) {
          this.serveWait = 0;
          cmd.shot = {
            kind: 'intent',
            intent: chance(clamp(this.L.serveShort * this.S.serveShort, 0, 0.95)) ? 'soft' : chance(0.3) ? 'fast' : 'high',
            aimX: pick([-1, 0, 1]),
            aimDepth: 0,
          };
        }
      }
      return cmd;
    }
    if (g.state !== 'rally') return cmd;

    this.clock += dt;
    if (sh.hits !== this.seenHits) {
      this.seenHits = sh.hits;
      this.clock = 0;
      this.plan = sh.lastHitter === this.opp.side ? this.makePlan() : null;
    }

    let dest = this.base();
    const p = this.plan;
    if (p && !p.leave) {
      if (this.clock >= this.L.reaction) dest = p.stand;
      if (p.jumpAt !== null && !p.jumped && this.clock >= p.jumpAt) { cmd.jump = true; p.jumped = true; }
      if (!p.swung && this.clock >= p.swingAt) { cmd.shot = this.chooseShot(p); p.swung = true; }
    }
    const dx = dest.x - this.me.pos.x, dy = dest.y - this.me.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.04) {
      const m = Math.min(1, d / 0.5);
      cmd.move = { x: (dx / d) * m, y: (dy / d) * m };
    }
    return cmd;
  }

  observe(o: Observation) {
    if (o.type === 'hit' && o.by === this.opp.side) {
      if (o.landing) {
        this.oppLandings.push(o.landing);
        if (this.oppLandings.length > 10) this.oppLandings.shift();
      }
      // How well did you handle where we put it?
      if (this.lastTargetZone !== null) {
        const c = o.contact;
        const weakReply = /Lift|Clear|Block/.test(o.label) && !!o.landing && Math.abs(o.landing.y) < 4.8;
        const weak = c.timing < 0.7 || c.stretch > SHOTS.stretchStart || c.hand === 'backhand' || weakReply;
        this.zoneTries[this.lastTargetZone] += 1;
        this.zoneWeak[this.lastTargetZone] += weak ? 1 : 0;
        this.lastTargetZone = null;
      }
    } else if (o.type === 'hit' && o.by === this.me.side) {
      this.lastTargetZone = o.landing ? zoneOf(o.landing) : null;
    } else if (o.type === 'rally') {
      if (this.lastTargetZone !== null) {
        this.zoneTries[this.lastTargetZone] += 1;
        if (o.winner === this.me.side) this.zoneWeak[this.lastTargetZone] += 1;
      }
      this.lastTargetZone = null;
      this.lastIntent = null;
    }
  }

  /** Decide whether to challenge a call that went against it. */
  wantsChallenge(call: LineCall): boolean {
    const seen = call.signed + gauss() * 0.08 * (1 - this.L.challengeSkill);
    const looksIn = seen >= -COURT.footprint;
    if (looksIn !== call.callIn) return chance(0.85);
    return Math.abs(call.signed) < 0.05 && chance(0.15 * (1 - this.L.challengeSkill));
  }

  /** Ready position: personality, last shot, and a lean toward where you've been hitting. */
  private base(): V2 {
    let depth = this.S.baseDepth;
    if (this.lastIntent === 'soft') depth -= 0.5;
    else if (this.lastIntent === 'high') depth += 0.2;
    let x = 0;
    const n = this.oppLandings.length;
    if (this.L.anticipation > 0 && n >= 3) {
      const recent = this.oppLandings.slice(-8);
      const mx = recent.reduce((a, p) => a + p.x, 0) / recent.length;
      const my = recent.reduce((a, p) => a + Math.abs(p.y), 0) / recent.length;
      x = mx * this.L.anticipation;
      depth += (my - 3.5) * this.L.anticipation;
    }
    return { x: clamp(x, -1, 1), y: this.me.side * clamp(depth, 2.6, 4.4) };
  }

  private makePlan(): Plan | null {
    const sh = this.game.shuttle, me = this.me, side = me.side, L = this.L;
    const path = predictPath(sh.pos, sh.vel);
    const leavePlan = (): Plan => ({ leave: true, contact: path.landing, stand: this.base(), swingAt: Infinity, jumpAt: null, intent: 'high', swung: true, jumped: true });
    if (path.netFault || path.landing.y * side <= 0) return leavePlan();
    if (L.judgesOut && !inSinglesHalf(path.landing, side) && distanceOut(path.landing) > L.outMargin) return leavePlan();

    const jumpHeight = (PLAYER.jumpSpeed * PLAYER.jumpSpeed) / (2 * PHYSICS.gravity);
    const mayJump = chance(L.jumpSmash * this.S.jump);
    const top = PLAYER.reachMaxZ + (mayJump ? jumpHeight * 0.85 : 0) - 0.05;
    const vmax = PLAYER.maxSpeed * me.speedMult;
    const rs = me.racketSide;

    let best: { t: number; p: V3; stand: V2 } | null = null, bestScore = -Infinity;
    let fallback: { t: number; p: V3; stand: V2 } | null = null, fallbackGap = Infinity;
    for (const s of path.samples) {
      if (s.p.y * side < 0.3 || s.p.z < PLAYER.reachMinZ + 0.1 || s.p.z > top) continue;
      // Ideally stand so the shuttle is on the forehand, slightly in front...
      const comfy = { x: s.p.x - rs * 0.45, y: s.p.y + side * 0.2 };
      const needComfy = Math.hypot(comfy.x - me.pos.x, comfy.y - me.pos.y);
      // ...but against fast shots, just get within reach and stretch for it.
      const reachZ = (PLAYER.reach + (s.p.z < PLAYER.lungeMaxZ ? PLAYER.lungeReach : 0)) * 0.85;
      const d = Math.hypot(s.p.x - me.pos.x, s.p.y - me.pos.y);
      const stretch = d > reachZ
        ? { x: s.p.x + ((me.pos.x - s.p.x) / d) * reachZ, y: s.p.y + ((me.pos.y - s.p.y) / d) * reachZ }
        : { ...me.pos };
      const needStretch = Math.max(0, d - reachZ);
      const can = coverable(s.t - L.reaction - 0.04, vmax, PLAYER.accel);
      const base = Math.min(s.p.z, 2.6) - s.t * 0.35;
      if (needComfy <= can) {
        if (base > bestScore) { bestScore = base; best = { ...s, stand: comfy }; }
      } else if (needStretch <= can) {
        if (base - 0.6 > bestScore) { bestScore = base - 0.6; best = { ...s, stand: stretch }; }
      } else if (needStretch - can < fallbackGap) {
        fallbackGap = needStretch - can;
        fallback = { ...s, stand: stretch };
      }
    }
    const chosen = best ?? fallback;
    if (!chosen) return leavePlan();

    const needsJump = chosen.p.z > PLAYER.reachMaxZ - 0.05;
    const jumpAt = needsJump || (mayJump && chosen.p.z > 2.3) ? chosen.t - PLAYER.jumpSpeed / PHYSICS.gravity : null;
    return {
      leave: false,
      contact: chosen.p,
      stand: chosen.stand,
      swingAt: chosen.t - SWING.idealDelay + gauss() * L.timingError,
      jumpAt,
      intent: this.chooseIntent(chosen.p),
      swung: false,
      jumped: false,
    };
  }

  /** Pick high / fast / soft from the situation, weighted by level and personality. */
  private chooseIntent(c: V3): Intent {
    const L = this.L, S = this.S, opp = this.opp;
    const dNet = Math.abs(c.y);
    const oppDepth = Math.abs(opp.pos.y);
    const oppRetreating = opp.vel.y * opp.side > 0.5;
    const oppDeep = oppDepth > 4.3, oppForward = oppDepth < 2.8;
    let high = 1, fast = 1, soft = 1;
    if (c.z >= SHOTS.overheadHeight) {
      if (dNet < 2.6) { fast = 3 * L.kill * S.kill; soft = 0.8; high = 0.1; }
      else {
        // A short lift (taken overhead mid-court) is there to be punished.
        const shortLift = dNet < 4.8;
        fast = L.smash * S.smash * (shortLift ? 1.6 : 0.5);
        soft = L.drop * S.drop * (oppDeep ? 1.5 : 0.8);
        high = S.clear * (oppForward ? 1.6 : 0.7);
      }
    } else if (c.z >= SHOTS.lowHeight) {
      if (dNet < SHOTS.nearNet && c.z > netHeightAt(c.x) + 0.1) { fast = 2.5 * L.kill * S.kill; soft = 1; high = 0.3; }
      else { fast = Math.sqrt(S.smash); soft = L.net * S.net * (oppDeep ? 1.5 : 0.6); high = S.clear * (oppForward ? 1.4 : 0.6); }
    } else if (dNet < SHOTS.nearNet) {
      // At the net: go tight if you're back or backing off, lift deep if you're rushing in.
      soft = L.net * S.net * (oppDeep || oppRetreating ? 1.6 : 0.7);
      high = S.clear * (oppForward || !oppRetreating ? 1.3 : 0.8);
      fast = 0.2;
    } else {
      high = 1.2 * S.clear;
      soft = 0.8 * S.net;
      fast = 0.3;
    }
    const k = L.decisiveness;
    return weightedPick<Intent>(['high', 'fast', 'soft'], [high ** k, fast ** k, soft ** k]);
  }

  /** Aim into open space and toward your weak zones, kept a level-dependent margin inside the lines. */
  private chooseShot(p: Plan): ShotRequest {
    const L = this.L, opp = this.opp, intent = p.intent;
    this.lastIntent = intent;
    // Leave room for the shot's own inaccuracy: a smash needs far more margin than a net shot.
    const A = SHOTS.aim;
    const dist = Math.hypot(this.me.pos.x, Math.abs(this.me.pos.y) + 4);
    const pace = intent === 'fast' ? 0.9 : intent === 'high' ? 0.45 : 0.12;
    const sigma = A.base + A.perMetre * dist + A.perPower * Math.pow(pace, 1.5);
    const margin = Math.max(0.15, L.margin * 0.5 + this.S.margin + sigma * L.caution);
    const depthMargin = Math.max(0.2, L.margin * 0.5 + this.S.margin + sigma * A.depthFactor * L.caution);
    // Hard shots from below the tape get lifted to clear it and fly long, so aim them shorter.
    const lowFast = intent === 'fast' && p.contact.z < netHeightAt(p.contact.x) + 0.1;
    const oppPred = { x: opp.pos.x + opp.vel.x * 0.25, y: opp.pos.y + opp.vel.y * 0.25 };
    const backhand = -opp.racketSide;
    const depthMods = intent === 'soft' ? [0, -1] : intent === 'high' ? [0, 1] : [0, 1, -1];
    const options: { target: V2; score: number }[] = [];
    for (const lat of [-1, -0.4, 0.4, 1]) {
      for (const ad of depthMods) {
        const t = intentTarget(intent, p.contact, this.me.side, 0, ad);
        const depth = clamp(Math.abs(t.y), 0.5, lowFast ? 4 : COURT.halfLength - depthMargin);
        const target = { x: lat * (COURT.singlesHalfWidth - margin), y: opp.side * depth };
        let score = Math.hypot(target.x - oppPred.x, target.y - oppPred.y);
        const z = zoneOf(target);
        score += L.adapt * 2 * (this.zoneWeak[z] / this.zoneTries[z]);
        if (Math.sign(target.x) === backhand && depth > 4.5) score += 0.4 * L.adapt;
        options.push({ target, score });
      }
    }
    const chosen = weightedPick(options, options.map((o) => Math.exp(o.score * L.decisiveness * 1.5)));
    const target = { x: chosen.target.x + gauss() * L.aimNoise, y: chosen.target.y + gauss() * L.aimNoise };
    return { kind: 'intent', intent, aimX: 0, aimDepth: 0, target, strength: L.strength };
  }
}
