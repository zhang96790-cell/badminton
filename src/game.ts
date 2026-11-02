import { AIController } from './ai';
import type { Camera, View } from './camera';
import { COURT, KEYS, OFFICIALS, PHYSICS, PLAYER, REPLAY, RULES, SERVE, SHOTS, STYLES, SWING, VISUAL, type Level, type Style } from './config';
import { KeyboardController, MouseController, type Command, type Controller, type Observation } from './controllers';
import { isIn, netHeightAt, rightCourtSign, signedInside, singlesRect, singlesServiceBox, type Rect } from './court';
import { REVIEW_TIME, type Review } from './hawkeye';
import type { Input } from './input';
import { chance, clamp, gauss, type Side, type V2, type V3 } from './math';
import { createOfficials, gameStartCall, gameWonCall, judgeFor, matchWonCall, scoreCall, type LineCall, type Official } from './officials';
import { Player } from './player';
import { Practice, feedShot, type FeedType, type Session } from './practice';
import { Tutorial } from './tutorial';
import { Playback, Recorder } from './replay';
import { Match, type PointOutcome } from './rules';
import { resolveServe, resolveShot, type Contact, type Shot } from './shots';
import { Shuttle, predictPath, stepFlight, type PathSample } from './shuttle';
import { MatchStats } from './stats';
import type { Speaker } from './voice';

export interface Settings {
  opponent: Level | 'human';
  style: Style;
  /** hybrid = keys to hit, cursor (trackpad) to aim. */
  p1Control: 'mouse' | 'keyboard' | 'hybrid';
  /** 1 = single game, 3 = best of three. */
  games: 1 | 3;
  points: 15 | 21;
  /** Show the predicted landing spot and a height line under the shuttle. */
  guides: boolean;
  /** Light next to your player: yellow = too early to swing, green = swing now, red = too late. */
  timingLight: boolean;
  /** If you don't swing at all, the game swings for you as the shuttle reaches you (a late hit). */
  swingAssist: boolean;
  aim: 'realistic' | 'casual';
  voice: boolean;
  /** Camera: 'close' fills the screen with the court, 'broadcast' is the wider TV view. */
  view: View;
}

/** 'feed' = practice/tutorial: you move freely while the coach gets the next shuttle ready. */
export type GameState = 'serve' | 'rally' | 'point' | 'challenge' | 'interval' | 'gameBreak' | 'replay' | 'matchOver' | 'feed';
export type Mode = 'match' | 'practice' | 'tutorial';

export type GameEvent =
  | { type: 'hit'; strength: number }
  | { type: 'net' }
  | { type: 'land' }
  | { type: 'whiff' }
  | { type: 'point' }
  | { type: 'applause'; intensity: number }
  | { type: 'say'; who: Speaker; text: string; interrupt?: boolean };

export interface Callout { label: string; detail: string; color: string; t: number }
export interface Banner { title: string; sub: string; color: string; t: number }

export class Game {
  players: [Player, Player];
  controllers: [Controller, Controller];
  shuttle = new Shuttle();
  match: Match;
  stats = new MatchStats();
  recorder = new Recorder();
  officials: Official[] = createOfficials();
  state: GameState = 'serve';
  paused = false;
  rallyHits = 0;
  longestRally = 0;
  callout: Callout | null = null;
  banner: Banner | null = null;
  caption: { who: Speaker; text: string; t: number } | null = null;
  landing: { p: V2; call: 'IN' | 'OUT' | null; t: number } | null = null;
  events: GameEvent[] = [];
  serveBox: Rect | null = null;
  /** Where the shuttle in flight will land (null if it's going into the net). */
  predicted: V2 | null = null;
  /** The rough version shown on court: off by a random amount so it doesn't settle line calls. */
  marker: V2 | null = null;
  /** Predicted flight of the shuttle in the air, and how long it's been flying along it. */
  private path: PathSample[] = [];
  private flightT = 0;
  /** Seconds left on the shot clock (real time). */
  clock: number = OFFICIALS.shotClock;
  clockRunning = false;
  challenges: [number, number] = [OFFICIALS.challengesPerGame, OFFICIALS.challengesPerGame];
  call: LineCall | null = null;
  review: Review | null = null;
  playback: Playback | null = null;
  replayCam: 'broadcast' | 'side' = 'broadcast';
  /** Crowd excitement, 0..1. */
  cheer = 0;
  /** Practice or tutorial session (null in a match). */
  session: Session | null = null;
  /** Yellow target rings on the floor (tutorial movement lesson). */
  rings: V2[] = [];
  private pending: { kind: 'feed'; type: FeedType } | { kind: 'serve' } | null = null;

  private timer = 0;
  private pointT = 0;
  private acc = 0;
  private outcome: PointOutcome | null = null;
  private snap: string | null = null;
  private prevServer: 0 | 1 = 0;
  private resume: { state: GameState; timer: number; clock: boolean } | null = null;
  private greatPoint = false;
  private autoReplayed = false;
  private pointsSinceReplay = 99;
  private aiChallengeAt: number | null = null;
  private warnings: [number, number] = [0, 0];
  private lastContact: (Contact & { incomingKmh: number }) | null = null;
  private lastShot: { label: string; hand: Contact['hand'] | 'serve'; netCord: boolean } | null = null;

  constructor(public settings: Settings, input: Input, camera: Camera, public mode: Mode = 'match') {
    const drill = mode !== 'match';
    if (drill) settings = { ...settings, opponent: 'medium' };
    const vsAI = settings.opponent !== 'human';
    this.match = new Match(RULES.formats[settings.points], settings.games === 1 ? 1 : 2);
    const p1 = new Player(-1, vsAI ? 'You' : 'P1', VISUAL.colors.p1, vsAI ? 'Player' : 'Player one');
    const p2 = new Player(1, drill ? 'Coach' : vsAI ? 'CPU' : 'P2', VISUAL.colors.p2, vsAI ? 'C P U' : 'Player two');
    this.players = [p1, p2];
    const c1: Controller = settings.p1Control === 'mouse'
      ? new MouseController(input, KEYS.mouse, p1, camera)
      : new KeyboardController(input, vsAI ? KEYS.solo : KEYS.p1Shared, p1, settings.p1Control === 'hybrid' ? camera : undefined);
    const c2: Controller = drill
      ? { poll: () => ({ move: { x: 0, y: 0 }, jump: false, shot: null }) } // the coach only feeds
      : vsAI
        ? new AIController(this, p2, p1, settings.opponent as Level, settings.style)
        : new KeyboardController(input, KEYS.p2Shared, p2);
    this.controllers = [c1, c2];
    this.players.forEach((p, i) => { if (this.isHuman(i)) p.extraReach = PLAYER.humanExtraReach; });
    if (drill) {
      this.session = mode === 'practice' ? new Practice() : new Tutorial(settings.p1Control === 'mouse' ? 'mouse' : 'keyboard');
      p1.place(0, -PLAYER.baseDepth);
      p2.place(0, 2.2);
      this.shuttle.hold({ x: 0, y: 1.6, z: 0.8 });
      this.session.start(this);
      return;
    }
    this.say('umpire', gameStartCall(1, this.match.gamesToWin));
    this.startServe();
  }

  // ── Practice / tutorial hooks ──────────────────────────────────────────────

  /** Coach feeds a shuttle after `delay` game seconds; you can move meanwhile. */
  feed(type: FeedType, delay = 0.9) {
    this.state = 'feed';
    this.timer = delay;
    this.pending = { kind: 'feed', type };
  }

  /** Free movement, nothing coming. */
  idle() {
    this.state = 'feed';
    this.timer = Infinity;
    this.pending = null;
  }

  /** Set you up to serve (from the right court) after a short wait. */
  serveDrill(delay = 0.8) {
    this.state = 'feed';
    this.timer = delay;
    this.pending = { kind: 'serve' };
  }

  private doPending() {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (p.kind === 'serve') {
      this.match.scores = [0, 0];
      this.match.server = 0;
      this.startServe();
      return;
    }
    const f = feedShot(p.type, this.players[0].pos);
    const coach = this.players[1];
    coach.place(f.from.x - coach.racketSide * 0.3, Math.max(0.6, f.from.y + 0.25));
    coach.onHit(f.from);
    this.recorder.reset();
    this.shuttle.hold(f.from);
    this.shuttle.launch(f.from, f.velocity, coach.side, false);
    this.predict();
    this.players[0].splitStep();
    this.state = 'rally';
    this.acc = 0;
    this.rallyHits = 1;
    this.landing = null;
    this.lastShot = { label: 'Feed', hand: 'forehand', netCord: false };
  }

  /** Tutorial: the shuttle that just landed outside the line is (wrongly) called IN against you. */
  stageMiscall() {
    const land = { x: this.shuttle.pos.x, y: this.shuttle.pos.y };
    const rect = singlesRect(-1);
    const signed = signedInside(land, rect);
    const truthIn = signed >= -COURT.footprint;
    const judge = judgeFor(this.officials, land, rect);
    this.call = { landing: land, rect, signed, truthIn, callIn: !truthIn, hitter: 1, isServe: false, challenged: false, judge };
    if (judge) { judge.signal = truthIn ? 'out' : 'in'; judge.signalT = 0; }
    this.landing = { p: land, call: truthIn ? 'OUT' : 'IN', t: 0 };
    this.challenges = [OFFICIALS.challengesPerGame, OFFICIALS.challengesPerGame];
    this.banner = { title: `Called ${truthIn ? 'OUT' : 'IN'}`, sub: 'Press H to challenge', color: VISUAL.colors.accent, t: 0 };
    this.snap = this.match.snapshot();
    this.state = 'point';
    this.pointT = 0;
    this.timer = Infinity;
  }

  get server(): Player { return this.players[this.match.server]; }
  get receiver(): Player { return this.players[1 - this.match.server]; }
  get opponentLabel(): string {
    const o = this.settings.opponent;
    return o === 'human' ? '2 Player' : `CPU ${o[0].toUpperCase()}${o.slice(1)} · ${STYLES[this.settings.style].label}`;
  }
  isHuman(i: number): boolean { return !(this.controllers[i] instanceof AIController); }
  /** Short lockout so the key that ended the last rally doesn't instantly serve. */
  canServe(): boolean { return this.state === 'serve' && this.timer <= 0; }

  /** True while the human who lost the last point can still challenge the line call. */
  get challengeOpen(): boolean {
    const c = this.call;
    if (this.state !== 'point' || !c || c.challenged || this.aiChallengeAt !== null) return false;
    return this.challengeOpenFor(c);
  }

  update(realDt: number) {
    if (this.paused) return;
    const real = Math.min(realDt, 0.05);
    const dt = real * PHYSICS.gameSpeed;
    if (this.callout) { this.callout.t += dt; if (this.callout.t > 1.8) this.callout = null; }
    if (this.banner) this.banner.t += real;
    if (this.landing) this.landing.t += dt;
    if (this.caption) this.caption.t += real;
    this.cheer = Math.max(0, this.cheer - real * 0.3);
    this.stats.tick(real);
    for (const o of this.officials) o.signalT += real;

    if (this.state === 'replay') {
      this.playback!.update(real);
      if (this.playback!.done) this.endReplay();
      return;
    }
    if (this.state === 'challenge') {
      this.review!.t += real;
      if (this.review!.t >= REVIEW_TIME) this.finishChallenge();
      return;
    }

    const cmds = this.controllers.map((c) => c.poll(dt)) as [Command, Command];
    if (this.session) this.clockRunning = false;
    if (this.clockRunning && (this.state === 'point' || this.state === 'serve')) {
      this.clock -= real;
      if (this.state === 'serve' && this.clock <= 0) this.timeViolation();
    }

    switch (this.state) {
      case 'serve': this.updateServe(dt, cmds); break;
      case 'feed':
        this.players.forEach((p, i) => p.update(dt, i === 0 ? cmds[0].move : { x: 0, y: 0 }, i === 0 && cmds[0].jump));
        this.session?.update(this, dt);
        this.timer -= dt;
        if (this.state === 'feed' && this.timer <= 0) this.doPending();
        break;
      case 'rally': this.updateRally(dt, cmds); break;
      case 'point':
        this.settle(dt);
        this.pointT += dt;
        if (this.aiChallengeAt !== null && this.pointT >= this.aiChallengeAt) {
          const c = this.call!;
          this.startChallenge((c.callIn ? 1 - c.hitter : c.hitter) as 0 | 1);
          break;
        }
        this.timer -= dt;
        if (this.timer <= 0) this.advance();
        break;
      case 'interval':
      case 'gameBreak':
        this.settle(dt);
        this.timer -= dt;
        if (this.timer <= 0) this.advance();
        break;
      case 'matchOver':
        this.settle(dt);
        break;
    }
  }

  // ── Serving ────────────────────────────────────────────────────────────────

  private startServe() {
    this.state = 'serve';
    this.timer = 0.35;
    this.rallyHits = 0;
    this.landing = null;
    this.serveBox = null;
    this.predicted = null;
    this.call = null;
    this.greatPoint = false;
    this.autoReplayed = false;
    for (const o of this.officials) o.signal = 'none';
    if (!this.clockRunning && !this.session) { this.clock = OFFICIALS.shotClock; this.clockRunning = true; }
    const right = this.match.serverInRightCourt();
    const srv = this.server, rcv = this.receiver;
    const sCourt = right ? rightCourtSign(srv.side) : -rightCourtSign(srv.side);
    const rCourt = right ? rightCourtSign(rcv.side) : -rightCourtSign(rcv.side);
    srv.place(sCourt * SERVE.serverOffset, srv.side * SERVE.serverDepth);
    rcv.place(rCourt * SERVE.receiverOffset, rcv.side * SERVE.receiverDepth);
    srv.frozen = rcv.frozen = true;
    this.shuttle.hold(this.serveContact(srv));
  }

  private serveContact(p: Player): V3 {
    return { x: p.pos.x + p.racketSide * 0.15, y: p.pos.y + p.forward * 0.35, z: SERVE.contactHeight };
  }

  private updateServe(dt: number, cmds: [Command, Command]) {
    this.timer -= dt;
    this.players.forEach((p) => p.update(dt, { x: 0, y: 0 }, false));
    const idx = this.match.server;
    const srv = this.server;
    this.shuttle.hold(this.serveContact(srv));
    const req = cmds[idx].shot;
    if (!req || !this.canServe()) return;

    const box = singlesServiceBox(this.receiver.side, this.match.serverInRightCourt());
    const from = this.serveContact(srv);
    const shot = resolveServe(req, from, srv.side, box);
    this.serveBox = box;
    this.recorder.reset();
    this.shuttle.launch(from, shot.velocity, srv.side, true);
    this.predict();
    srv.onHit(from);
    srv.frozen = this.receiver.frozen = false;
    this.receiver.splitStep();
    this.state = 'rally';
    this.clockRunning = false;
    this.acc = 0;
    this.rallyHits = 1;
    this.lastContact = null;
    this.lastShot = { label: shot.label, hand: 'serve', netCord: false };
    this.stats.shots.push({ by: idx, label: shot.label, speedKmh: shot.speedKmh, hand: 'serve', landing: this.predicted });
    this.announce(srv, shot, null);
    this.events.push({ type: 'hit', strength: 0.3 });
  }

  // ── Rally ──────────────────────────────────────────────────────────────────

  private updateRally(dt: number, cmds: [Command, Command]) {
    this.acc += dt;
    let first = true;
    while (this.acc >= PHYSICS.dt && this.state === 'rally') {
      this.acc -= PHYSICS.dt;
      this.step(PHYSICS.dt, cmds, first);
      first = false;
    }
    if (this.state !== 'rally') this.acc = 0;
  }

  private step(dt: number, cmds: [Command, Command], first: boolean) {
    this.players.forEach((p, i) => {
      if (first && cmds[i].shot) p.startSwing(cmds[i].shot!);
      if (p.update(dt, cmds[i].move, first && cmds[i].jump) === 'whiff') this.events.push({ type: 'whiff' });
    });

    const sh = this.shuttle;
    const prev = { ...sh.pos };
    stepFlight(sh.pos, sh.vel, dt);
    this.flightT += dt;
    sh.orient(dt);

    // Net plane crossing
    if (prev.y * sh.pos.y < 0) {
      const f = prev.y / (prev.y - sh.pos.y);
      const x = prev.x + (sh.pos.x - prev.x) * f;
      const z = prev.z + (sh.pos.z - prev.z) * f;
      const tape = netHeightAt(x);
      if (Math.abs(x) > COURT.postX) {
        sh.wide = true;
      } else if (z < tape) {
        if (tape - z < PHYSICS.netCordTolerance) {
          // Net cord: clips the tape and trickles over.
          sh.vel = { x: sh.vel.x * 0.3, y: sh.vel.y * 0.3, z: Math.abs(sh.vel.z) * 0.2 + 0.6 };
          if (this.lastShot) this.lastShot.netCord = true;
          this.predict();
          this.events.push({ type: 'net' });
        } else {
          sh.pos = { x, y: Math.sign(prev.y) * 0.03, z };
          sh.vel = { x: sh.vel.x * 0.1, y: -sh.vel.y * 0.05, z: Math.min(0, sh.vel.z) * 0.2 };
          sh.touchedNet = true;
          this.predicted = null;
          this.events.push({ type: 'net' });
        }
      }
    }

    // Holding a charge too long: swing for them before the shuttle gets past (it'll be a late hit).
    if (sh.inFlight && !sh.touchedNet) {
      this.players.forEach((p, i) => {
        if (p.charge === null || p.swing || sh.lastHitter === p.side || sh.pos.y * p.side <= 0) return;
        if (!p.aboutToMiss(sh.pos, sh.vel, dt)) return;
        const req = this.controllers[i].forceRelease?.();
        if (req) p.startSwing(req);
      });
      // Swing assist: you didn't swing at all, so get it back with a high shot (a late hit). It lands
      // mid-court rather than deep, so the opponent can still attack it.
      if (this.settings.swingAssist && this.mode !== 'tutorial') {
        this.players.forEach((p, i) => {
          if (!this.isHuman(i) || p.swing || p.charge !== null || sh.lastHitter === p.side || sh.pos.y * p.side <= 0) return;
          // Attacking shots slow down a lot in the air, so judge by what was hit, not current speed.
          if (/smash|kill|drive|push/i.test(this.lastShot?.label ?? '')) return;
          if (p.aboutToMiss(sh.pos, sh.vel, dt)) p.startSwing({ kind: 'intent', intent: 'high', aimX: 0, aimDepth: -1 }, true);
        });
      }
    }

    // Contact
    if (sh.inFlight) {
      for (let i = 0; i < 2; i++) {
        const p = this.players[i];
        if (!p.swing || sh.lastHitter === p.side || sh.touchedNet || sh.pos.y * p.side <= 0) continue;
        const c = p.tryContact(sh.pos, sh.vel, dt);
        if (!c) continue;
        const ctrl = this.controllers[i];
        let req = ctrl.aimAtContact ? ctrl.aimAtContact(p.swing.req) : p.swing.req;
        if (req.kind === 'intent' && !req.target && req.aimX === 0 && this.isHuman(i)) {
          // Keyboard with no direction held: play into the open side rather than straight at the opponent.
          const ox = this.players[1 - i].pos.x;
          const side = Math.abs(ox) > 0.25 ? -Math.sign(ox) : Math.sign(c.point.x) || 1;
          req = { ...req, aimX: (side * SHOTS.autoAimLateral) / SHOTS.aimLateral };
        }
        const incomingKmh = Math.hypot(sh.vel.x, sh.vel.y, sh.vel.z) * 3.6;
        const shot = resolveShot(req, c, this.isHuman(i) ? SHOTS.aimModes[this.settings.aim] : 1);
        sh.launch(c.point, shot.velocity, p.side, false);
        this.predict();
        p.onHit(c.point);
        p.timingFlash = { kind: Math.abs(c.timingError) <= SWING.perfectTolerance ? 'perfect' : c.timingError > 0 ? 'early' : 'late', t: 0 };
        if (this.session && i === 0) this.session.onHit(this, { label: shot.label, timing: p.timingFlash.kind, airborne: c.airborne });
        this.players[1 - i].splitStep();
        this.rallyHits++;
        this.lastContact = { ...c, incomingKmh };
        this.lastShot = { label: shot.label, hand: c.hand, netCord: false };
        this.stats.shots.push({ by: i as 0 | 1, label: shot.label, speedKmh: shot.speedKmh, hand: c.hand, landing: this.predicted });
        this.observe({ type: 'hit', by: p.side, contact: c, label: shot.label, landing: this.predicted });
        this.announce(p, shot, `${c.timingLabel}${c.hand !== 'forehand' ? ` · ${c.hand}` : ''}${p.assisted ? ' · assisted' : ''}`);
        this.events.push({ type: 'hit', strength: Math.min(1, shot.speedKmh / 300) });
        break;
      }
    }

    sh.trail.push({ ...sh.pos });
    if (sh.trail.length > 14) sh.trail.shift();
    this.recorder.record(dt, this.players, sh);

    if (sh.pos.z <= 0) {
      sh.pos.z = 0;
      sh.inFlight = false;
      this.events.push({ type: 'land' });
      this.endRally({ x: sh.pos.x, y: sh.pos.y });
    }
  }

  private predict() {
    const p = predictPath(this.shuttle.pos, this.shuttle.vel);
    this.predicted = p.netFault ? null : { x: p.landing.x, y: p.landing.y };
    const e = VISUAL.markerError;
    this.marker = this.predicted && { x: this.predicted.x + gauss() * e, y: this.predicted.y + gauss() * e * 1.3 };
    this.path = p.samples;
    this.flightT = 0;
  }

  /**
   * Where player i will meet the incoming shuttle from where they stand now, and whether swinging
   * right now would be early (it isn't in reach yet when the racket arrives), on time, or late.
   */
  forecast(i: number): { light: 'early' | 'now' | 'late' | 'none'; point: V3 | null } | null {
    const p = this.players[i], sh = this.shuttle;
    if (this.state !== 'rally' || !sh.inFlight || sh.lastHitter === p.side || sh.touchedNet) return null;
    const racketArrives = this.flightT + SWING.idealDelay;
    let tIn = -1, tOut = -1, best: PathSample | null = null;
    for (const s of this.path) {
      if (s.t < this.flightT || s.p.y * p.side <= 0) continue;
      const reach = p.reachFor(s.p.z);
      const ok = Math.hypot(s.p.x - p.pos.x, s.p.y - p.pos.y) <= reach && s.p.z >= PLAYER.reachMinZ && s.p.z <= PLAYER.reachMaxZ + p.z;
      if (ok) {
        if (tIn < 0) tIn = s.t;
        tOut = s.t;
        if (!best || Math.abs(s.t - racketArrives) < Math.abs(best.t - racketArrives)) best = s;
      } else if (tIn >= 0) break;
    }
    if (tIn < 0) return { light: 'none', point: null };
    // Same tolerance as the timing grade, so green always means a Perfect hit.
    const tol = SWING.perfectTolerance;
    return { light: racketArrives < tIn - tol ? 'early' : racketArrives <= tOut + tol ? 'now' : 'late', point: best!.p };
  }

  private endRally(land: V2) {
    this.predicted = null;
    this.recorder.markLanding();
    const sh = this.shuttle;
    const hitter = sh.lastHitter as Side;
    const hIdx = (this.players[0].side === hitter ? 0 : 1) as 0 | 1;
    if (this.session) {
      // No scoring in practice: report the landing and let the session decide what's next.
      const crossed = land.y * hitter < 0 && !sh.wide;
      const inCourt = crossed && (sh.isServe ? isIn(land, this.serveBox!) : isIn(land, singlesRect(-hitter as Side)));
      this.landing = { p: land, call: hIdx === 0 ? (inCourt ? 'IN' : 'OUT') : null, t: 0 };
      this.rallyHits = 0;
      this.idle();
      this.session.onLand(this, { p: land, hitter: hIdx, label: this.lastShot?.label ?? '', isServe: sh.isServe, inCourt, depth: Math.abs(land.y) });
      return;
    }
    let hitterWins: boolean, title: string;
    let line: LineCall | null = null;

    if (sh.wide) { hitterWins = false; title = 'Fault — passed outside the post'; }
    else if (land.y * hitter >= 0) { hitterWins = false; title = sh.touchedNet ? 'Into the net' : "Didn't cross the net"; }
    else {
      const rect = sh.isServe ? this.serveBox! : singlesRect(-hitter as Side);
      const signed = signedInside(land, rect);
      const truthIn = signed >= -COURT.footprint;
      // Line judges are human: shuttles right on the edge are sometimes miscalled.
      const edge = Math.abs(signed + COURT.footprint);
      const wrong = edge < OFFICIALS.errorBand && chance(OFFICIALS.maxErrorChance * (1 - edge / OFFICIALS.errorBand));
      const callIn = wrong ? !truthIn : truthIn;
      const judge = judgeFor(this.officials, land, rect);
      line = { landing: land, rect, signed, truthIn, callIn, hitter: hIdx, isServe: sh.isServe, challenged: false, judge };
      if (judge) { judge.signal = callIn ? 'in' : 'out'; judge.signalT = 0; }
      if (!callIn) this.say('line', 'Out!');
      hitterWins = callIn;
      title = sh.isServe ? (callIn ? 'Ace' : 'Service fault — out') : callIn ? 'Winner' : 'Out';
    }

    const winner = (hitterWins ? hIdx : 1 - hIdx) as 0 | 1;
    const lc = this.lastContact;
    const forced = !hitterWins && !!lc && (lc.stretch > SHOTS.stretchStart || lc.timing < 0.7 || lc.incomingKmh > 180);
    this.stats.rallies.push({
      shots: this.rallyHits, winner, hitter: hIdx, kind: hitterWins ? 'winner' : 'error', forced,
      lastLabel: this.lastShot?.label ?? '', lastHand: this.lastShot?.hand ?? 'serve',
    });
    this.call = line;
    this.landing = { p: land, call: line ? (line.callIn ? 'IN' : 'OUT') : null, t: 0 };
    this.longestRally = Math.max(this.longestRally, this.rallyHits);
    this.snap = this.match.snapshot();
    this.prevServer = this.match.server;
    this.outcome = this.match.award(winner);
    const w = this.players[winner];
    const why = sh.touchedNet || (!sh.wide && land.y * hitter >= 0) ? this.netFaultReason() : null;
    this.banner = { title, sub: `${why ? `${why} · ` : ''}Point ${w.name}`, color: w.color, t: 0 };
    this.events.push({ type: 'point' });
    this.observe({ type: 'rally', winner: w.side });

    // Crowd: long rallies and spectacular winners get the biggest reaction.
    const spectacular = hitterWins && /Jump smash|Net kill/.test(this.lastShot?.label ?? '');
    const close = !!line && Math.abs(line.signed) < 0.04;
    const intensity = clamp((this.rallyHits - 3) / 14, 0.12, 1) + (spectacular ? 0.3 : 0) + (close ? 0.2 : 0);
    this.cheer = Math.min(1, intensity);
    this.events.push({ type: 'applause', intensity: Math.min(1, intensity) });
    this.pointsSinceReplay++;
    this.greatPoint = this.pointsSinceReplay >= REPLAY.autoCooldown
      && (this.rallyHits >= REPLAY.autoMinRally || (spectacular && this.rallyHits >= 6) || (!!line && Math.abs(line.signed) < 0.03) || (hitterWins && !!this.lastShot?.netCord));

    this.state = 'point';
    this.pointT = 0;
    this.timer = RULES.pointPause + (this.challengeOpenFor(line) ? RULES.challengeWindow : 0);
    this.clock = OFFICIALS.shotClock;
    this.clockRunning = true;
    this.aiChallengeAt = null;
    if (line) {
      const loser = (line.callIn ? 1 - line.hitter : line.hitter) as 0 | 1;
      const ai = this.controllers[loser];
      if (ai instanceof AIController && this.challenges[loser] > 0 && ai.wantsChallenge(line)) this.aiChallengeAt = 0.9;
    }
  }

  /** Why the last shot didn't get over, e.g. "Smash mistimed (late), hit too low". */
  private netFaultReason(): string | null {
    const s = this.lastShot, c = this.lastContact;
    if (!s) return null;
    if (!c) return s.label; // a serve
    const why: string[] = [];
    if (c.timingLabel === 'Late' || c.timingLabel === 'Early') why.push(`mistimed (${c.timingLabel.toLowerCase()})`);
    if (/smash|kill/i.test(s.label) && c.point.z < SHOTS.overheadHeight + 0.15) why.push('hit too low');
    if (/smash/i.test(s.label) && Math.abs(c.point.y) > 5.2) why.push('from too far back');
    if (c.hand === 'backhand') why.push('backhand');
    if (c.stretch > SHOTS.stretchStart) why.push('stretched');
    return why.length ? `${s.label} ${why.join(', ')}` : s.label;
  }

  private challengeOpenFor(line: LineCall | null): boolean {
    if (!line || Math.abs(line.signed) > OFFICIALS.challengeRange) return false;
    const loser = line.callIn ? 1 - line.hitter : line.hitter;
    return this.isHuman(loser) && this.challenges[loser] > 0;
  }

  private settle(dt: number) {
    this.players.forEach((p) => p.update(dt, { x: 0, y: 0 }, false));
    // Keep recording a moment after landing so replays don't cut off abruptly.
    if (this.recorder.landedAt !== null && this.recorder.t - this.recorder.landedAt < 0.8) this.recorder.record(dt, this.players, this.shuttle);
  }

  private advance() {
    if (this.session) { this.idle(); return; }
    if (this.state === 'point' && this.greatPoint && !this.autoReplayed && this.recorder.frames.length > 30) {
      this.autoReplayed = true;
      this.pointsSinceReplay = 0;
      this.startReplay(true);
      return;
    }
    const o = this.outcome;
    this.outcome = null;
    const m = this.match;
    if (this.state === 'point' && o?.matchOver) {
      const wi = (m.games[0] > m.games[1] ? 0 : 1) as 0 | 1;
      this.state = 'matchOver';
      this.banner = null;
      this.clockRunning = false;
      this.stats.finish();
      this.say('umpire', matchWonCall(this.players[wi].voiceName, m.history, wi), true);
      this.cheer = 1;
      this.events.push({ type: 'applause', intensity: 1 });
    } else if (this.state === 'point' && o?.gameOver) {
      const [a, b] = m.history[m.history.length - 1];
      const w = this.players[a > b ? 0 : 1];
      this.state = 'gameBreak';
      this.timer = RULES.gameBreak;
      this.clockRunning = false;
      this.banner = { title: `Game ${m.history.length} — ${w.name}`, sub: `${a}–${b}`, color: w.color, t: 0 };
      this.say('umpire', gameWonCall(w.voiceName, Math.max(a, b), Math.min(a, b)), true);
    } else if (this.state === 'point' && o?.interval) {
      this.state = 'interval';
      this.timer = RULES.intervalPause;
      this.clockRunning = false;
      this.banner = { title: 'Interval', sub: `${m.scores[0]}–${m.scores[1]}`, color: VISUAL.colors.hud, t: 0 };
      this.say('umpire', `${scoreCall(m, m.server !== this.prevServer).replace(/\.$/, '')}, interval.`, true);
    } else {
      if (this.state === 'gameBreak') {
        m.newGame();
        this.challenges = [OFFICIALS.challengesPerGame, OFFICIALS.challengesPerGame];
        this.say('umpire', gameStartCall(m.gameNumber, m.gamesToWin), true);
      } else if (this.state === 'interval') {
        this.say('umpire', `${scoreCall(m, false).replace(/\.$/, '')}, play.`, true);
      } else {
        this.say('umpire', scoreCall(m, m.server !== this.prevServer), true);
      }
      this.banner = null;
      this.startServe();
    }
  }

  // ── Challenges ─────────────────────────────────────────────────────────────

  /** H: the human who lost the point on a line call asks Hawk-Eye. */
  requestChallenge() {
    if (!this.challengeOpen) return;
    const c = this.call!;
    this.startChallenge((c.callIn ? 1 - c.hitter : c.hitter) as 0 | 1);
  }

  private startChallenge(by: 0 | 1) {
    const c = this.call!;
    c.challenged = true;
    this.aiChallengeAt = null;
    const p = this.players[by];
    this.review = {
      by, name: p.name, color: p.color, landing: c.landing, path: this.recorder.pathBefore(1.4),
      rect: c.rect, signed: c.signed, truthIn: c.truthIn, callIn: c.callIn, t: 0,
    };
    this.stats.challenges[by].made++;
    this.state = 'challenge';
    this.clockRunning = false;
    this.say('umpire', `${p.voiceName}, challenge.`, true);
  }

  private finishChallenge() {
    const r = this.review!, c = this.call!;
    const overturned = r.truthIn !== c.callIn;
    const p = this.players[r.by];
    if (overturned && this.session) {
      c.callIn = c.truthIn;
      if (c.judge) c.judge.signal = c.callIn ? 'in' : 'out';
      this.landing = { p: c.landing, call: c.callIn ? 'IN' : 'OUT', t: 0 };
      this.banner = { title: 'Call overturned', sub: 'Your challenge was right', color: p.color, t: 0 };
    } else if (overturned) {
      this.match.restore(this.snap!);
      const winner = (c.truthIn ? c.hitter : 1 - c.hitter) as 0 | 1;
      this.outcome = this.match.award(winner);
      c.callIn = c.truthIn;
      this.stats.reviseLast(winner, c.truthIn ? 'winner' : 'error');
      this.stats.challenges[r.by].won++;
      if (c.judge) c.judge.signal = c.callIn ? 'in' : 'out';
      this.landing = { p: c.landing, call: c.callIn ? 'IN' : 'OUT', t: 0 };
      const w = this.players[winner];
      this.banner = { title: 'Call overturned', sub: `Point ${w.name}`, color: w.color, t: 0 };
    } else {
      this.challenges[r.by]--;
      const left = this.challenges[r.by];
      this.banner = { title: 'Call stands', sub: `${p.name}: ${left} challenge${left === 1 ? '' : 's'} left this game`, color: VISUAL.colors.hud, t: 0 };
    }
    this.say('umpire', r.truthIn ? 'Shuttle in.' : 'Shuttle out.', true);
    this.review = null;
    this.state = 'point';
    this.timer = 1.8;
    this.clock = OFFICIALS.shotClock;
    this.clockRunning = true;
    this.session?.onReview(this);
  }

  // ── Replays ────────────────────────────────────────────────────────────────

  /** R: replay the last rally (or skip the replay that's playing). */
  toggleReplay() {
    if (this.state === 'replay') { this.endReplay(); return; }
    if (['point', 'serve', 'interval', 'gameBreak', 'matchOver', 'feed'].includes(this.state) && this.recorder.frames.length > 10) {
      this.startReplay(false);
      this.session?.onReplay(this);
    }
  }

  toggleReplayCamera() {
    if (this.state === 'replay') this.replayCam = this.replayCam === 'broadcast' ? 'side' : 'broadcast';
  }

  private startReplay(auto: boolean) {
    const r = this.recorder;
    const start = auto ? (r.landedAt ?? r.t) - REPLAY.autoSeconds : 0;
    this.playback = new Playback(r.frames, start, r.landedAt, auto);
    this.resume = { state: this.state, timer: this.timer, clock: this.clockRunning };
    this.state = 'replay';
    this.clockRunning = false;
  }

  private endReplay() {
    const r = this.resume!;
    this.playback = null;
    this.state = r.state;
    this.timer = r.timer;
    this.clockRunning = r.clock;
    this.resume = null;
  }

  // ── Shot clock ─────────────────────────────────────────────────────────────

  private timeViolation() {
    const s = this.match.server;
    if (this.warnings[s] === 0) {
      this.warnings[s]++;
      this.clock = OFFICIALS.shotClockAfterWarning;
      this.banner = { title: 'Warning — delay of game', sub: `${this.server.name}: serve before the shot clock runs out`, color: VISUAL.colors.accent, t: 0 };
      this.say('umpire', `${this.server.voiceName}, warning for delaying the game.`, true);
      return;
    }
    const winner = (1 - s) as 0 | 1;
    this.snap = this.match.snapshot();
    this.prevServer = this.match.server;
    this.outcome = this.match.award(winner);
    this.stats.rallies.push({ shots: 0, winner, hitter: s, kind: 'delay', forced: false, lastLabel: '', lastHand: 'serve' });
    this.call = null;
    this.landing = null;
    this.greatPoint = false;
    const w = this.players[winner];
    this.banner = { title: 'Fault — delay of game', sub: `Point ${w.name}`, color: w.color, t: 0 };
    this.say('service', 'Fault.', true);
    this.events.push({ type: 'point' });
    this.state = 'point';
    this.pointT = 0;
    this.timer = RULES.pointPause;
    this.clock = OFFICIALS.shotClock;
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  /** Enter skips pauses and replays. */
  skip() {
    if (this.state === 'replay') this.endReplay();
    else if (this.session && this.state !== 'challenge') this.session.skip(this);
    else if (this.state === 'challenge' && this.review) this.review.t = Math.max(this.review.t, REVIEW_TIME - 1.2);
    else if (this.state === 'point' && !this.challengeOpen) this.timer = 0;
    else if (this.state === 'interval' || this.state === 'gameBreak') this.timer = 0;
  }

  private observe(o: Observation) {
    for (const c of this.controllers) c.observe?.(o);
  }

  private say(who: Speaker, text: string, interrupt = false) {
    this.caption = { who, text, t: 0 };
    this.events.push({ type: 'say', who, text, interrupt });
  }

  private announce(p: Player, shot: Shot, detail: string | null) {
    const fast = /smash|kill|drive|push/i.test(shot.label) && shot.speedKmh > 100;
    this.callout = {
      label: shot.label,
      detail: [fast ? `${Math.round(shot.speedKmh)} km/h` : null, detail].filter(Boolean).join(' · '),
      color: p.color,
      t: 0,
    };
  }
}
