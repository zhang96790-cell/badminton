import { AI, COURT, DOUBLES, OFFICIALS, PHYSICS, PLAYER, SHOTS, STYLES, SWING, type AILevel, type Level, type Style } from './config';
import type { Command, Controller, Observation } from './controllers';
import { distanceOut, inHalf, netHeightAt } from './court';
import { coverable, interceptSlack } from './doubles';
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
  /** Doubles: where the partner is expected to take the shuttle when it's theirs. */
  private mateSpot: V2 | null = null;
  private style: Style;

  constructor(private game: Game, private me: Player, level: Level, style: Style) {
    this.L = AI[level];
    this.S = STYLES[style];
    this.style = style;
    me.speedMult = this.L.speed * this.S.speed;
  }

  /** Auto-switch handed this controller a different player. */
  bind(p: Player) { this.me = p; this.plan = null; this.seenHits = -1; }

  private get opps(): Player[] { return this.game.players.filter((p) => p.side !== this.me.side); }
  private get mate(): Player | null { return this.game.players.find((p) => p !== this.me && p.side === this.me.side) ?? null; }
  /** The opponent nearest a point (singles: the only one). */
  private oppNear(p: V2): Player {
    return this.opps.reduce((a, b) => (Math.hypot(b.pos.x - p.x, b.pos.y - p.y) < Math.hypot(a.pos.x - p.x, a.pos.y - p.y) ? b : a));
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
          // Doubles serving is mostly low; the long ones are mostly flicks over a rushing receiver.
          const shortP = g.doubles ? clamp(0.55 + 0.4 * this.L.serveShort, 0, 0.92) : clamp(this.L.serveShort * this.S.serveShort, 0, 0.95);
          cmd.shot = {
            kind: 'intent',
            intent: chance(shortP) ? 'soft' : chance(g.doubles ? DOUBLES.flickShare : 0.3) ? 'fast' : 'high',
            aimX: g.doubles ? pick([-1, -1, 0, 1]) : pick([-1, 0, 1]),
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
      this.mateSpot = null;
      this.plan = sh.lastHitter === -this.me.side ? this.makePlan() : null;
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
    if (o.type === 'hit' && o.by === -this.me.side) {
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

  /**
   * Decide whether to challenge a call that went against it. Like a real player it judges the landing
   * by eye (worse at lower levels), and on close calls it sometimes gambles even when the call was right.
   */
  wantsChallenge(call: LineCall): boolean {
    const skill = this.L.challengeSkill, O = OFFICIALS, m = this.game.match;
    const seen = call.signed + gauss() * (O.cpuEyeError.max - (O.cpuEyeError.max - O.cpuEyeError.min) * skill);
    // How far on the other side of the line from the call it looked (positive = looked wrong).
    const edge = -COURT.footprint;
    const wrongBy = call.callIn ? edge - seen : seen - edge;
    if (wrongBy > 0) return chance(0.85);
    // It looked right but tight: players often challenge those anyway, especially on big points.
    const tight = 1 - Math.abs(seen - edge) / O.cpuGambleBand;
    if (tight <= 0) return false;
    const bigPoint = m.atGamePoint(0) || m.atGamePoint(1);
    const p = (O.cpuGamble.reckless - (O.cpuGamble.reckless - O.cpuGamble.careful) * skill) * tight + (bigPoint ? O.cpuGamble.bigPoint : 0);
    return chance(p);
  }

  /** Ready position: personality, last shot, and a lean toward where you've been hitting. */
  private base(): V2 {
    if (this.game.doubles && this.mate) return this.formation(this.mate);
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

  /** Is our pair attacking (front and back) or defending (side by side)? */
  private attacking(): boolean {
    const g = this.game, label = g.lastShotLabel;
    if (/Short serve/.test(label)) return true;
    const high = /Lift|Clear|High serve|Flick serve/.test(label);
    return g.shuttle.lastHitter === this.me.side ? !high : high;
  }

  /**
   * Doubles ready position. Attacking: one up at the net, one at the back. Defending: side by side,
   * one half each. Roles go to whoever is already nearer, and a player shades toward the gap their
   * partner leaves when pulled out of position.
   */
  private formation(mate: Player): V2 {
    const me = this.me, side = me.side, F = DOUBLES;
    const mp = this.mateSpot ?? mate.pos;
    const myIdx = this.game.players.indexOf(me), mateIdx = this.game.players.indexOf(mate);
    if (this.attacking()) {
      // Style decides who prefers the net: net players move up, attackers drop back.
      const pref = this.style === 'net' ? -0.7 : this.style === 'attacker' ? 0.7 : 0;
      const myDepth = Math.abs(me.pos.y) + pref, mateDepth = Math.abs(mp.y);
      const front = myDepth < mateDepth || (myDepth === mateDepth && myIdx < mateIdx);
      // If the partner is the one at the back (or about to play from there), cover the front, and vice versa.
      if (front) return { x: clamp(mp.x * 0.25, -1, 1), y: side * F.attack.frontY };
      return { x: clamp(-mp.x * F.coverShift, -1.2, 1.2), y: side * F.attack.backY };
    }
    const left = me.pos.x < mp.x || (me.pos.x === mp.x && myIdx < mateIdx);
    let x = (left ? -1 : 1) * F.defence.x, y = F.defence.y;
    // Partner pulled forward, back or wide: shift toward the middle and away from them in depth.
    const off = Math.abs(Math.abs(mp.y) - F.defence.y);
    if (off > 1 || Math.abs(mp.x) > F.defence.x + 0.8) {
      x *= 1 - F.coverShift;
      y += Math.abs(mp.y) < F.defence.y ? 0.5 : -0.5;
    }
    return { x, y: side * y };
  }

  private makePlan(): Plan | null {
    const g = this.game, sh = g.shuttle, me = this.me, side = me.side, L = this.L;
    const path = predictPath(sh.pos, sh.vel);
    const leavePlan = (): Plan => ({ leave: true, contact: path.landing, stand: this.base(), swingAt: Infinity, jumpAt: null, intent: 'high', swung: true, jumped: true });
    if (path.netFault || path.landing.y * side <= 0) return leavePlan();
    if (L.judgesOut && !inHalf(path.landing, side, g.doubles) && distanceOut(path.landing, g.doubles) > L.outMargin) return leavePlan();
    const mate = this.mate;
    if (g.doubles && mate) {
      // Only the receiver returns a serve; otherwise whoever is better placed takes it.
      if (sh.isServe) { if (g.receiver !== me) return leavePlan(); }
      else {
        const mine = interceptSlack(me, path.samples, L.reaction), theirs = interceptSlack(mate, path.samples, L.reaction);
        const myIdx = g.players.indexOf(me), mateIdx = g.players.indexOf(mate);
        const take = mine.slack < theirs.slack || (mine.slack === theirs.slack && myIdx < mateIdx);
        const contested = Math.abs(mine.slack - theirs.slack) < DOUBLES.contested && mine.slack < 0.6 && theirs.slack < 0.6;
        if (contested && g.teamOf(myIdx) === 0) g.shout(me, take ? 'Mine!' : 'Yours!');
        if (!take) {
          this.mateSpot = theirs.point ? { x: theirs.point.x, y: theirs.point.y } : null;
          return leavePlan();
        }
      }
    }

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
    const L = this.L, S = this.S, opps = this.opps, doubles = this.game.doubles;
    const dNet = Math.abs(c.y);
    // Against a pair, judge by whoever is nearest the net: drops only work if both are back.
    const oppDepth = Math.min(...opps.map((o) => Math.abs(o.pos.y)));
    const oppRetreating = opps.every((o) => o.vel.y * o.side > 0.5);
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
    // Doubles is about keeping the shuttle down: lift less, attack and push more.
    if (doubles) { high *= 0.55; fast *= 1.3; }
    const k = L.decisiveness;
    return weightedPick<Intent>(['high', 'fast', 'soft'], [high ** k, fast ** k, soft ** k]);
  }

  /** Aim into open space and toward your weak zones, kept a level-dependent margin inside the lines. */
  private chooseShot(p: Plan): ShotRequest {
    const L = this.L, intent = p.intent, doubles = this.game.doubles;
    const opps = this.opps, opp = this.oppNear({ x: p.contact.x, y: -p.contact.y });
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
    const preds = opps.map((o) => ({ x: o.pos.x + o.vel.x * 0.25, y: o.pos.y + o.vel.y * 0.25 }));
    const backhand = -opp.racketSide;
    const halfW = doubles ? COURT.doublesHalfWidth : COURT.singlesHalfWidth;
    // Two defenders side by side: the middle between them causes hesitation.
    const sideBySide = doubles && opps.length === 2 && Math.abs(Math.abs(opps[0].pos.y) - Math.abs(opps[1].pos.y)) < 1.2;
    const depthMods = intent === 'soft' ? [0, -1] : intent === 'high' ? [0, 1] : [0, 1, -1];
    const options: { target: V2; score: number }[] = [];
    for (const lat of doubles ? [-1, -0.45, 0, 0.45, 1] : [-1, -0.4, 0.4, 1]) {
      for (const ad of depthMods) {
        const t = intentTarget(intent, p.contact, this.me.side, 0, ad);
        const depth = clamp(Math.abs(t.y), 0.5, lowFast ? 4 : COURT.halfLength - depthMargin);
        const target = { x: lat * (halfW - margin), y: opp.side * depth };
        let score = Math.min(...preds.map((q) => Math.hypot(target.x - q.x, target.y - q.y)));
        if (sideBySide && lat === 0) score += DOUBLES.middleBonus;
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
