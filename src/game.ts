import { AIController } from './ai';
import type { Camera, View } from './camera';
import { COURT, DOUBLES, KEYS, OFFICIALS, ONLINE, PHYSICS, PLAYER, REPLAY, RULES, SERVE, SHOTS, STYLES, SWING, VISUAL, type KeyMap, type Level, type Style } from './config';
import { KeyboardController, MouseController, type Command, type Controller, type Observation } from './controllers';
import { applyBinds, type KeyBinds } from './keys';
import { halfRect, isIn, netHeightAt, rightCourtSign, serviceBox, signedInside, singlesRect, type Rect } from './court';
import { interceptSlack } from './doubles';
import { REVIEW_TIME, type Review } from './hawkeye';
import type { Input } from './input';
import { chance, clamp, gauss, type Side, type V2, type V3 } from './math';
import { createOfficials, gameStartCall, gameWonCall, judgeFor, matchWonCall, scoreCall, type LineCall, type Official } from './officials';
import { Player } from './player';
import { Practice, feedShot, type FeedType, type Session } from './practice';
import { Tutorial } from './tutorial';
import { Playback, Recorder, type ShuttleView } from './replay';
import { Match, partnerIdx, type PointOutcome } from './rules';
import type { GameMsg, ServerMsg } from './net';
import { CHAT, RemoteController, flip2, flip3, type OnlineLink } from './online';
import { isPerfectJump, resolveServe, resolveShot, type Contact, type Shot, type ShotRequest } from './shots';
import { Shuttle, predictPath, stepFlight, type PathSample } from './shuttle';
import { MatchStats } from './stats';
import type { Speaker } from './voice';

export interface Settings {
  /** Doubles is you and a CPU partner against a CPU pair. */
  event: 'singles' | 'doubles';
  opponent: Level | 'human';
  style: Style;
  /** Your doubles partner's style. */
  partnerStyle: Style;
  /** Doubles: you take over whichever of your pair is better placed for the next shot. */
  autoSwitch: boolean;
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
  /** Your custom keys (single player); anything not set uses the default. */
  keys?: KeyBinds;
  /** Set once you've picked how you play on the controls screen (first visit). */
  controlsChosen?: boolean;
}

/** 'feed' = practice/tutorial: you move freely while the coach gets the next shuttle ready. */
/** 'wait' = online: the shuttle reached the floor here, waiting to hear whether the other player hit it first. */
export type GameState = 'serve' | 'rally' | 'point' | 'challenge' | 'interval' | 'gameBreak' | 'replay' | 'matchOver' | 'feed' | 'wait';
export type Mode = 'match' | 'practice' | 'tutorial' | 'online';

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
  /** 0 = you (near), 1 = far player. Doubles adds 2 = your partner and 3 = the far partner (team = index % 2). */
  players: Player[];
  controllers: Controller[];
  readonly doubles: boolean;
  /** Player 1's keys after custom binds (for on-screen hints). */
  readonly p1Keys: KeyMap;
  /** Tutorial: serve into the doubles box and draw the doubles court, in a singles drill. */
  drillDoubles = false;
  /** Which court is in play: doubles (alleys in, short wide service box) or singles. */
  get doublesCourt(): boolean { return this.doubles || this.drillDoubles; }
  shuttle = new Shuttle();
  match: Match;
  stats = new MatchStats();
  recorder = new Recorder();
  officials: Official[];
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
  /** Index (and stable id) of whoever hit last, for per-player stats. */
  private lastHitterId = 0;
  /** Set when a player touched the net: the next point is called with this instead. */
  private faultTitle: string | null = null;
  /** Online match: the room connection and whether this screen referees. Null otherwise. */
  readonly online: OnlineLink | null;
  /** Online: the other player's connection dropped (play waits for them). */
  peerAway = false;
  /** Online: who paused. */
  pausedBy: 'you' | 'opponent' | null = null;
  /** Online: set when the other player left or forfeited (index of the winner). */
  forfeitWinner: 0 | 1 | null = null;
  /** Online: you've asked for a rematch and are waiting for the other player. */
  rematchAsked = false;
  /** Ranked online match: the result the room saved (new ratings), once it arrives. */
  rankedResult: import('./net').RankedResult | null = null;
  /** Called once when the match ends (main uses it to add the match to your career stats). */
  onMatchOver: ((g: Game) => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private posT = 0;
  private jumped = false;
  private lastSentPos = '';
  private lastChat = -9;
  /** Online lag hiding: how long the shuttle has hovered on the other side, for which hit. */
  private hoverT = 0;
  private hoverHit = -1;
  /** Online: gap between where the shuttle was drawn and where their hit put it, shrinking to nothing. */
  private drawOffset: V3 | null = null;
  private drawOffsetT = 0;

  constructor(public settings: Settings, input: Input, camera: Camera, public mode: Mode = 'match', online: OnlineLink | null = null) {
    this.online = online;
    const drill = mode === 'practice' || mode === 'tutorial';
    // Online is singles for now (doubles comes in 2.1).
    if (online) settings = { ...settings, event: 'singles' };
    if (drill) settings = { ...settings, opponent: 'medium', event: 'singles' };
    // The tutorial teaches timing with the light, so it's always on there.
    if (mode === 'tutorial') settings = { ...settings, timingLight: true };
    // Doubles is always against a CPU pair (no shared-keyboard doubles).
    if (settings.event === 'doubles' && settings.opponent === 'human') settings = { ...settings, opponent: 'medium' };
    this.settings = settings;
    const doubles = this.doubles = settings.event === 'doubles';
    // One player on this keyboard: against the CPU, or online (the other player is on their own computer).
    const vsAI = settings.opponent !== 'human' || !!online;
    this.match = new Match(RULES.formats[settings.points], settings.games === 1 ? 1 : 2, doubles);
    this.officials = createOfficials(doubles);
    const p1 = new Player(-1, vsAI ? 'You' : 'P1', VISUAL.colors.p1, vsAI ? 'Player' : 'Player one');
    const p2 = online
      ? new Player(1, online.opponentName, VISUAL.colors.p2, online.opponentName.replace(/_/g, ' '))
      : new Player(1, drill ? 'Coach' : doubles ? 'CPU 1' : vsAI ? 'CPU' : 'P2', VISUAL.colors.p2, doubles ? 'C P U one' : vsAI ? 'C P U' : 'Player two');
    this.players = [p1, p2];
    if (doubles) this.players.push(new Player(-1, 'Partner', VISUAL.colors.p3, 'Partner'), new Player(1, 'CPU 2', VISUAL.colors.p4, 'C P U two'));
    this.players.forEach((p, i) => { p.id = i; });
    // Custom keys apply to one player on the keyboard; sharing a keyboard keeps the fixed P1/P2 keys.
    this.p1Keys = settings.p1Control === 'mouse' ? applyBinds(KEYS.mouse, settings.keys, true) : vsAI ? applyBinds(KEYS.solo, settings.keys) : KEYS.p1Shared;
    const c1: Controller = settings.p1Control === 'mouse'
      ? new MouseController(input, this.p1Keys, p1, camera)
      : new KeyboardController(input, this.p1Keys, p1, settings.p1Control === 'hybrid' ? camera : undefined);
    const c2: Controller = online
      ? new RemoteController(p2)
      : drill
      ? { poll: () => ({ move: { x: 0, y: 0 }, jump: false, shot: null }) } // the coach only feeds
      : vsAI
        ? new AIController(this, p2, settings.opponent as Level, settings.style)
        : new KeyboardController(input, KEYS.p2Shared, p2);
    this.controllers = [c1, c2];
    if (doubles) {
      // Your partner plays at the same level as the opponents.
      const level = settings.opponent as Level;
      this.controllers.push(new AIController(this, this.players[2], level, settings.partnerStyle), new AIController(this, this.players[3], level, settings.style));
    }
    this.players.forEach((p, i) => { if (this.isHuman(i)) p.extraReach = PLAYER.humanExtraReach; });
    if (drill) {
      this.session = mode === 'practice' ? new Practice() : new Tutorial(settings.p1Control === 'mouse' ? 'mouse' : 'keyboard', this.p1Keys);
      p1.place(0, -PLAYER.baseDepth);
      p2.place(0, 2.2);
      this.shuttle.hold({ x: 0, y: 1.6, z: 0.8 });
      this.session.start(this);
      return;
    }
    if (online) {
      // The host serves first; on the guest's screen the host is the far player.
      this.match.server = online.host ? 0 : 1;
      this.unsubscribe = online.conn.on((m) => this.onNet(m));
    }
    this.say('umpire', gameStartCall(1, this.match.gamesToWin));
    this.startServe();
  }

  /** Stop listening to the room (the match is over or abandoned). */
  dispose() { this.unsubscribe?.(); this.unsubscribe = null; }

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
    if (f.place) this.players[0].place(f.place.x, f.place.y);
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

  get server(): Player { return this.players[this.match.serverIdx()]; }
  get receiver(): Player { return this.players[this.match.receiverIdx()]; }
  get opponentLabel(): string {
    if (this.online?.ranked) return `Ranked · ${this.online.opponentName} ${this.online.ranked.theirs}`;
    if (this.online) return `Online · room ${this.online.conn.code}`;
    const o = this.settings.opponent;
    if (o === 'human') return '2 Player';
    return `CPU ${o[0].toUpperCase()}${o.slice(1)}${this.doubles ? ' pair' : ''} · ${STYLES[this.settings.style].label}`;
  }
  /** Side 0 (near) or 1 (far) of player i. */
  teamOf(i: number): 0 | 1 { return (i % 2) as 0 | 1; }
  teamName(t: 0 | 1): string {
    if (!this.doubles) return this.players[t].name;
    return t === 0 ? 'You & Partner' : 'CPU pair';
  }
  teamVoice(t: 0 | 1): string {
    if (!this.doubles) return this.players[t].voiceName;
    return t === 0 ? 'Player and partner' : 'C P U pair';
  }
  teamColor(t: 0 | 1): string { return this.players[t].color; }
  /** The shuttle as it should be drawn (online it may be gliding onto its true path). */
  get shuttleView(): ShuttleView {
    const sh = this.shuttle, o = this.drawOffset;
    if (!o) return sh;
    const k = 1 - this.drawOffsetT / ONLINE.smoothTime;
    return { pos: { x: sh.pos.x + o.x * k, y: sh.pos.y + o.y * k, z: Math.max(0, sh.pos.z + o.z * k) }, dir: sh.dir, vel: sh.vel, inFlight: sh.inFlight, trail: sh.trail };
  }
  /** The last shot played (for the doubles AI's attack / defence formations). */
  get lastShotLabel(): string { return this.lastShot?.label ?? ''; }
  /** Played by someone at this computer (not the CPU, and not the online opponent). */
  isHuman(i: number): boolean { const c = this.controllers[i]; return !(c instanceof AIController) && !(c instanceof RemoteController); }
  /** Short lockout so the key that ended the last rally doesn't instantly serve. */
  canServe(): boolean { return this.state === 'serve' && this.timer <= 0; }

  /** True while the human who lost the last point can still challenge the line call. */
  get challengeOpen(): boolean {
    const c = this.call;
    if (this.state !== 'point' || !c || c.challenged || this.aiChallengeAt !== null) return false;
    return this.challengeOpenFor(c);
  }

  update(realDt: number) {
    if (this.paused || this.peerAway) return;
    const real = Math.min(realDt, 0.05);
    const dt = real * PHYSICS.gameSpeed;
    if (this.drawOffset && (this.drawOffsetT += dt) >= ONLINE.smoothTime) this.drawOffset = null;
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

    const cmds = this.controllers.map((c) => c.poll(dt));
    if (this.online) this.sendPos(dt, cmds[0].jump);
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
      case 'wait':
        // Keep moving: the other player may still have reached it.
        this.players.forEach((p, i) => p.update(dt, cmds[i].move, cmds[i].jump));
        break;
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
    // Online, the server waits a moment after each point so the receiver is ready.
    this.timer = this.online ? RULES.onlineServeWait : 0.35;
    this.rallyHits = 0;
    this.landing = null;
    this.serveBox = null;
    this.predicted = null;
    this.call = null;
    this.greatPoint = false;
    this.autoReplayed = false;
    for (const o of this.officials) o.signal = 'none';
    if (!this.clockRunning && !this.session && !this.online) { this.clock = OFFICIALS.shotClock; this.clockRunning = true; }
    if (this.controllers[1] instanceof RemoteController) this.controllers[1].reset();
    const right = this.match.serverInRightCourt();
    const srv = this.server, rcv = this.receiver;
    const sCourt = right ? rightCourtSign(srv.side) : -rightCourtSign(srv.side);
    const rCourt = right ? rightCourtSign(rcv.side) : -rightCourtSign(rcv.side);
    if (this.doubles) {
      // Server and receiver up near the short service line; partners behind, ready for the next shot.
      const D = SERVE.doubles;
      srv.place(sCourt * SERVE.serverOffset, srv.side * D.serverDepth);
      rcv.place(rCourt * SERVE.receiverOffset, rcv.side * D.receiverDepth);
      this.players[partnerIdx(this.match.serverIdx())].place(-sCourt * D.partnerOffset, srv.side * D.serverPartnerDepth);
      this.players[partnerIdx(this.match.receiverIdx())].place(-rCourt * DOUBLES.defence.x * 0.8, rcv.side * D.receiverPartnerDepth);
    } else {
      srv.place(sCourt * SERVE.serverOffset, srv.side * SERVE.serverDepth);
      rcv.place(rCourt * SERVE.receiverOffset, rcv.side * SERVE.receiverDepth);
    }
    for (const p of this.players) { p.frozen = true; p.serving = null; }
    srv.serving = this.doublesCourt ? 'backhand' : 'forehand';
    this.shuttle.hold(this.serveContact(srv));
  }

  private serveContact(p: Player): V3 {
    return { x: p.pos.x + p.racketSide * 0.15, y: p.pos.y + p.forward * 0.35, z: SERVE.contactHeight };
  }

  private updateServe(dt: number, cmds: Command[]) {
    this.timer -= dt;
    this.players.forEach((p) => p.update(dt, { x: 0, y: 0 }, false));
    const idx = this.match.server, si = this.match.serverIdx();
    const srv = this.server;
    this.shuttle.hold(this.serveContact(srv));
    const req = cmds[si].shot;
    if (!req || !this.canServe()) return;

    const box = serviceBox(this.receiver.side, this.match.serverInRightCourt(), this.doublesCourt);
    const from = this.serveContact(srv);
    const shot = resolveServe(req, from, srv.side, box);
    this.serveBox = box;
    this.recorder.reset();
    this.shuttle.launch(from, shot.velocity, srv.side, true);
    this.predict();
    srv.serving = null;
    srv.onHit(from, true);
    for (const p of this.players) p.frozen = false;
    this.receiver.splitStep();
    this.state = 'rally';
    this.clockRunning = false;
    this.acc = 0;
    this.rallyHits = 1;
    this.lastContact = null;
    this.lastShot = { label: shot.label, hand: 'serve', netCord: false };
    this.lastHitterId = srv.id;
    this.stats.shots.push({ by: idx, pid: srv.id, label: shot.label, speedKmh: shot.speedKmh, hand: 'serve', landing: this.predicted });
    this.announce(srv, shot, null);
    this.events.push({ type: 'hit', strength: 0.3 });
    if (this.online) this.sendHit(from, shot.velocity, shot.label, shot.speedKmh, 'serve', '', true);
  }

  // ── Rally ──────────────────────────────────────────────────────────────────

  private updateRally(dt: number, cmds: Command[]) {
    this.acc += dt;
    let first = true;
    while (this.acc >= PHYSICS.dt && this.state === 'rally') {
      this.acc -= PHYSICS.dt;
      this.step(PHYSICS.dt, cmds, first);
      first = false;
    }
    if (this.state !== 'rally') this.acc = 0;
  }

  private step(dt: number, cmds: Command[], first: boolean) {
    this.players.forEach((p, i) => {
      if (first && cmds[i].shot) p.startSwing(cmds[i].shot!);
      if (p.update(dt, cmds[i].move, first && cmds[i].jump) === 'whiff') this.events.push({ type: 'whiff' });
    });
    if (this.doubles) this.keepApart();

    const sh = this.shuttle;
    const prev = { ...sh.pos };
    // Online, after your shot: on the other player's half the shuttle is for show here, so slow it a
    // little while their reply is on its way, and hover near the floor rather than land early.
    let fdt = dt;
    if (this.online && sh.inFlight && !sh.touchedNet && sh.lastHitter === this.players[0].side && sh.pos.y > 0) {
      if (this.hoverHit !== sh.hits) { this.hoverHit = sh.hits; this.hoverT = 0; }
      fdt = dt * clamp(1 - this.online.conn.latency * ONLINE.slowPerMs, ONLINE.slowMin, 1);
      if (sh.pos.z < ONLINE.hoverHeight && sh.vel.z < 0 && this.hoverT < ONLINE.hoverMax) {
        this.hoverT += dt;
        fdt = dt * ONLINE.hoverRate;
      }
    }
    stepFlight(sh.pos, sh.vel, fdt);
    this.flightT += fdt;
    sh.orient(fdt);
    if (sh.tumbling) {
      // Tumbling over the tape: the cork flips end over end.
      const a = this.flightT * 26;
      sh.dir = { x: 0.25 * Math.sin(a * 0.5), y: Math.sin(a), z: Math.cos(a) };
    }

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
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.swing || sh.lastHitter === p.side || sh.touchedNet || sh.pos.y * p.side <= 0) continue;
        // Doubles: only the receiver may return the serve.
        if (this.doubles && sh.isServe && p !== this.receiver) continue;
        // Online: the other player's hits arrive as messages from their screen.
        if (this.online && i !== 0) continue;
        const c = p.tryContact(sh.pos, sh.vel, dt);
        if (!c) continue;
        c.tumbling = sh.tumbling;
        const ctrl = this.controllers[i];
        let req = ctrl.aimAtContact ? ctrl.aimAtContact(p.swing.req) : p.swing.req;
        if (req.kind === 'intent' && !req.target && req.aimX === 0 && this.isHuman(i)) {
          // Keyboard with no direction held: play into the open side rather than straight at the opponent.
          const opps = this.players.filter((q) => q.side !== p.side);
          const ox = opps.reduce((a, q) => a + q.pos.x, 0) / opps.length;
          const side = Math.abs(ox) > 0.25 ? -Math.sign(ox) : Math.sign(c.point.x) || 1;
          req = { ...req, aimX: (side * SHOTS.autoAimLateral) / SHOTS.aimLateral };
        }
        const incomingKmh = Math.hypot(sh.vel.x, sh.vel.y, sh.vel.z) * 3.6;
        if (this.touchesNet(p, req, c)) {
          // Hit hard from right on top of the net: the racket clips it. The shuttle drops dead on this side.
          p.onHit(c.point);
          sh.vel = { x: 0, y: 0, z: -1.5 };
          this.faultTitle = 'Fault — touched the net';
          this.callout = { label: 'TOUCHED THE NET', detail: 'Too close for a hard shot · fault', color: VISUAL.colors.callOut, t: 0 };
          this.events.push({ type: 'net' });
          break;
        }
        const shot = resolveShot(req, c, this.isHuman(i) ? SHOTS.aimModes[this.settings.aim] : 1, this.isHuman(i));
        sh.launch(c.point, shot.velocity, p.side, false);
        this.predict();
        if (this.checkTumble(shot.label, c.timing >= 1)) shot.label = 'Net shot (tumbling)';
        p.onHit(c.point);
        if (c.airborne && /Jump smash/.test(shot.label)) p.jumpSmashed = true;
        p.timingFlash = { kind: Math.abs(c.timingError) <= SWING.perfectTolerance ? 'perfect' : c.timingError > 0 ? 'early' : 'late', t: 0 };
        if (this.session && i === 0) this.session.onHit(this, { label: shot.label, timing: p.timingFlash.kind, airborne: c.airborne });
        for (const q of this.players) if (q.side !== p.side) q.splitStep();
        this.rallyHits++;
        this.lastContact = { ...c, incomingKmh };
        this.lastShot = { label: shot.label, hand: c.hand, netCord: false };
        this.lastHitterId = p.id;
        this.stats.shots.push({ by: this.teamOf(i), pid: p.id, label: shot.label, speedKmh: shot.speedKmh, hand: c.hand, landing: this.predicted });
        this.observe({ type: 'hit', by: p.side, contact: c, label: shot.label, landing: this.predicted, hitter: p });
        if (this.teamOf(i) === 1) this.maybeSwitch();
        const perfectJump = this.isHuman(i) && /Jump smash/.test(shot.label) && isPerfectJump(c);
        const detail = `${perfectJump ? 'PERFECT JUMP' : c.timingLabel}${c.hand !== 'forehand' ? ` · ${c.hand}` : ''}${p.assisted ? ' · assisted' : ''}`;
        this.announce(p, shot, detail);
        if (this.online) this.sendHit(c.point, shot.velocity, shot.label, shot.speedKmh, c.hand, detail, false);
        if (perfectJump) { this.cheer = Math.max(this.cheer, 0.6); this.events.push({ type: 'applause', intensity: 0.5 }); }
        if (i === 0) {
          this.stats.you.hits++;
          if (p.timingFlash.kind === 'perfect') this.stats.you.perfect++;
          if (perfectJump) this.stats.you.perfectJumps++;
        }
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
      if (this.online) this.onlineLanding({ x: sh.pos.x, y: sh.pos.y });
      else this.endRally({ x: sh.pos.x, y: sh.pos.y });
    }
  }

  /**
   * A perfectly timed net shot that will cross within SHOTS.tumble.margin of the tape tumbles over it
   * (worked out from the predicted flight). Returns whether it does. Online, the other screen goes by the label.
   */
  private checkTumble(label: string, perfect: boolean): boolean {
    const sh = this.shuttle;
    sh.tumbling = false;
    if (!perfect || !/Net shot/.test(label) || !this.path.length) return false;
    const cross = this.path.find((s, i) => i > 0 && s.p.y * this.path[i - 1].p.y <= 0);
    if (!cross) return false;
    const margin = cross.p.z - netHeightAt(cross.p.x);
    sh.tumbling = margin >= 0 && margin < SHOTS.tumble.margin;
    return sh.tumbling;
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
      const inCourt = crossed && (sh.isServe ? isIn(land, this.serveBox!) : isIn(land, halfRect(-hitter as Side, this.doublesCourt)));
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
      const rect = sh.isServe ? this.serveBox! : halfRect(-hitter as Side, this.doubles);
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
    if (this.faultTitle) { title = this.faultTitle; this.faultTitle = null; }

    const winner = (hitterWins ? hIdx : 1 - hIdx) as 0 | 1;
    const lc = this.lastContact;
    const forced = !hitterWins && !!lc && (lc.stretch > SHOTS.stretchStart || lc.timing < 0.7 || lc.incomingKmh > 180);
    this.stats.rallies.push({
      shots: this.rallyHits, winner, hitter: hIdx, hitterPid: this.lastHitterId, kind: hitterWins ? 'winner' : 'error', forced,
      lastLabel: this.lastShot?.label ?? '', lastHand: this.lastShot?.hand ?? 'serve',
    });
    this.call = line;
    this.landing = { p: land, call: line ? (line.callIn ? 'IN' : 'OUT') : null, t: 0 };
    this.longestRally = Math.max(this.longestRally, this.rallyHits);
    this.snap = this.match.snapshot();
    this.prevServer = this.match.server;
    this.outcome = this.match.award(winner);
    const why = sh.touchedNet || (!sh.wide && land.y * hitter >= 0) ? this.netFaultReason() : null;
    this.banner = { title, sub: `${why ? `${why} · ` : ''}Point ${this.teamName(winner)}`, color: this.teamColor(winner), t: 0 };
    this.events.push({ type: 'point' });
    this.observe({ type: 'rally', winner: this.players[winner].side });

    // Crowd: long rallies and spectacular winners get the biggest reaction.
    const spectacular = hitterWins && /Jump smash|Net kill/.test(this.lastShot?.label ?? '');
    const close = !!line && Math.abs(line.signed) < 0.04;
    const intensity = clamp((this.rallyHits - 3) / 14, 0.12, 1) + (spectacular ? 0.3 : 0) + (close ? 0.2 : 0);
    this.cheer = Math.min(1, intensity);
    this.events.push({ type: 'applause', intensity: Math.min(1, intensity) });
    this.pointsSinceReplay++;
    this.greatPoint = !this.online && this.pointsSinceReplay >= REPLAY.autoCooldown
      && (this.rallyHits >= REPLAY.autoMinRally || (spectacular && this.rallyHits >= 6) || (!!line && Math.abs(line.signed) < 0.03) || (hitterWins && !!this.lastShot?.netCord));

    this.state = 'point';
    this.pointT = 0;
    this.timer = RULES.pointPause + (this.challengeWait(line) ? RULES.challengeWindow : 0);
    this.clock = OFFICIALS.shotClock;
    this.clockRunning = !this.online;
    this.aiChallengeAt = null;
    if (this.online?.host) {
      this.online.conn.send({
        type: 'point', winner, land: [land.x, land.y], title, why, callIn: line ? line.callIn : null,
        call: line ? { rect: line.rect, signed: line.signed, truthIn: line.truthIn, callIn: line.callIn, hitter: line.hitter, isServe: line.isServe } : null,
        scores: [...this.match.scores], games: [...this.match.games],
      });
    }
    // The CPU challenges offline only: online, both players are people and press H themselves.
    if (line && !this.online) {
      const loser = (line.callIn ? 1 - line.hitter : line.hitter) as 0 | 1;
      const ai = this.controllers[loser];
      if (ai instanceof AIController && this.challenges[loser] > 0 && ai.wantsChallenge(line)) this.aiChallengeAt = 0.9;
    }
  }

  /**
   * Touching the net: only a hard shot from right on top of it can, never a gentle net shot, and the
   * risk rises the closer the player is (see RULES.netFault).
   */
  private touchesNet(p: Player, req: ShotRequest, c: Contact): boolean {
    const N = RULES.netFault, dist = Math.abs(p.pos.y);
    if (dist >= N.within || Math.abs(c.point.y) > N.within + 0.4) return false;
    const hard = req.kind === 'intent' ? req.intent === 'fast' : req.arc === 'low' && req.power > 0.4;
    if (!hard) return false;
    return chance(N.maxChance * Math.min(1, (N.within - dist) / (N.within - N.closest)));
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

  /**
   * Hold the pause open for a possible challenge. Online that's on both screens whenever either player
   * could challenge, so neither serves while the other is still deciding.
   */
  private challengeWait(line: LineCall | null): boolean {
    return this.online ? this.challengePossible(line) : this.challengeOpenFor(line);
  }

  /** The call is close enough to challenge and the side it went against has challenges left. */
  private challengePossible(line: LineCall | null): boolean {
    if (!line || line.challenged || Math.abs(line.signed) > OFFICIALS.challengeRange) return false;
    return this.challenges[line.callIn ? 1 - line.hitter : line.hitter] > 0;
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
      this.onMatchOver?.(this);
      this.banner = null;
      this.clockRunning = false;
      this.stats.finish();
      this.say('umpire', matchWonCall(this.teamVoice(wi), m.history, wi), true);
      this.cheer = 1;
      this.events.push({ type: 'applause', intensity: 1 });
    } else if (this.state === 'point' && o?.gameOver) {
      const [a, b] = m.history[m.history.length - 1];
      const wt = (a > b ? 0 : 1) as 0 | 1;
      this.state = 'gameBreak';
      this.timer = RULES.gameBreak;
      this.clockRunning = false;
      this.banner = { title: `Game ${m.history.length} — ${this.teamName(wt)}`, sub: `${a}–${b}`, color: this.teamColor(wt), t: 0 };
      this.say('umpire', gameWonCall(this.teamVoice(wt), Math.max(a, b), Math.min(a, b)), true);
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
    this.online?.conn.send({ type: 'challenge' });
    this.startChallenge((c.callIn ? 1 - c.hitter : c.hitter) as 0 | 1);
  }

  private startChallenge(by: 0 | 1) {
    const c = this.call!;
    c.challenged = true;
    this.aiChallengeAt = null;
    this.review = {
      by, name: this.teamName(by), color: this.teamColor(by), landing: c.landing, path: this.recorder.pathBefore(1.4),
      rect: c.rect, signed: c.signed, truthIn: c.truthIn, callIn: c.callIn, t: 0,
    };
    this.stats.challenges[by].made++;
    this.state = 'challenge';
    this.clockRunning = false;
    this.say('umpire', `${this.teamVoice(by)}, challenge.`, true);
  }

  private finishChallenge() {
    const r = this.review!, c = this.call!;
    const overturned = r.truthIn !== c.callIn;
    const p = { name: this.teamName(r.by), color: this.teamColor(r.by) };
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
      this.banner = { title: 'Call overturned', sub: `Point ${this.teamName(winner)}`, color: this.teamColor(winner), t: 0 };
    } else {
      this.challenges[r.by]--;
      const left = this.challenges[r.by];
      this.banner = { title: 'Call stands', sub: `${p.name}: ${left} challenge${left === 1 ? '' : 's'} left this game`, color: VISUAL.colors.hud, t: 0 };
    }
    this.say('umpire', r.truthIn ? 'Shuttle in.' : 'Shuttle out.', true);
    // Online: the host's score is the real one; send it so the other screen lines up exactly.
    if (this.online?.host) this.online.conn.send({ type: 'review', scores: [...this.match.scores], games: [...this.match.games] });
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
    // Online, replays only between points (the other player's serve ends one, so you never miss it).
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
    this.stats.rallies.push({ shots: 0, winner, hitter: s, hitterPid: this.server.id, kind: 'delay', forced: false, lastLabel: '', lastHand: 'serve' });
    this.call = null;
    this.landing = null;
    this.greatPoint = false;
    this.banner = { title: 'Fault — delay of game', sub: `Point ${this.teamName(winner)}`, color: this.teamColor(winner), t: 0 };
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
    // Online, the pause can't be skipped while the other player could still challenge.
    else if (this.state === 'point' && !this.challengeOpen && !(this.online && this.challengePossible(this.call))) this.timer = 0;
    else if (this.state === 'interval' || this.state === 'gameBreak') this.timer = 0;
  }

  /** Partners can't stand in the same spot: nudge them apart when they get too close. */
  private keepApart() {
    for (const [a, b] of [[this.players[0], this.players[2]], [this.players[1], this.players[3]]]) {
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, d = Math.hypot(dx, dy);
      if (d >= DOUBLES.personalSpace || d < 1e-6) continue;
      const push = (DOUBLES.personalSpace - d) / 2;
      a.pos.x -= (dx / d) * push; a.pos.y -= (dy / d) * push;
      b.pos.x += (dx / d) * push; b.pos.y += (dy / d) * push;
    }
  }

  /** A doubles call ("Mine!" / "Yours!"). Only your partner's calls are spoken. */
  shout(p: Player, text: string, ttl = DOUBLES.shoutTime) {
    p.shout = { text, t: 0, ttl };
    const i = this.players.indexOf(p);
    if (i >= 0 && this.teamOf(i) === 0 && !this.isHuman(i)) this.events.push({ type: 'say', who: 'partner', text });
  }

  /**
   * Doubles auto-switch: as the shuttle comes back to your side, take over whichever of your pair is
   * better placed for it. Your old player carries on as the CPU partner.
   */
  private maybeSwitch() {
    if (!this.doubles || !this.settings.autoSwitch || this.session) return;
    const you = this.players[0], mate = this.players[2];
    if (you.swing || you.charge !== null || mate.swing || you.airborne) return;
    const path = predictPath(this.shuttle.pos, this.shuttle.vel);
    if (path.netFault || path.landing.y * you.side <= 0) return;
    const a = interceptSlack(you, path.samples, 0).slack, b = interceptSlack(mate, path.samples, 0).slack;
    if (b < a - DOUBLES.switchMargin) this.swapControl();
  }

  private swapControl() {
    const a = this.players[0], b = this.players[2];
    this.players[0] = b;
    this.players[2] = a;
    [a.extraReach, b.extraReach] = [b.extraReach, a.extraReach];
    [a.speedMult, b.speedMult] = [b.speedMult, a.speedMult];
    a.charge = b.charge = null;
    this.controllers[0].bind?.(b);
    this.controllers[2].bind?.(a);
    this.match.swapIndices(0, 2);
  }

  // ── Online ─────────────────────────────────────────────────────────────────

  /** Tell the other screen where you are (about 15 times a second, only when something changed). */
  private sendPos(dt: number, jump: boolean) {
    if (jump) this.jumped = true;
    this.posT += dt;
    if (this.posT < PHYSICS.gameSpeed / 15) return;
    this.posT = 0;
    if (this.state !== 'rally' && this.state !== 'wait') return;
    const p = this.players[0];
    const r = (n: number) => Math.round(n * 100) / 100;
    const msg = { type: 'pos' as const, x: r(p.pos.x), y: r(p.pos.y), z: r(p.z), vx: r(p.vel.x), vy: r(p.vel.y), charge: p.charge === null ? null : r(p.charge), jump: this.jumped };
    const key = `${msg.x},${msg.y},${msg.z},${msg.charge},${msg.jump}`;
    if (key === this.lastSentPos) return;
    this.lastSentPos = key;
    this.jumped = false;
    this.online!.conn.send(msg);
  }

  private sendHit(p: V3, v: V3, label: string, kmh: number, hand: string, detail: string, serve: boolean) {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    this.online!.conn.send({ type: 'hit', p: [r(p.x), r(p.y), r(p.z)], v: [r(v.x), r(v.y), r(v.z)], label, kmh: Math.round(kmh), hand, detail, serve });
  }

  /** The shuttle reached the floor on this screen. Whoever owns that side knows nobody there hit it. */
  private onlineLanding(land: V2) {
    const o = this.online!, sh = this.shuttle;
    if (land.y < 0) {
      if (o.host) this.endRally(land);
      // Sent in this screen's view, like every message: the host turns it round on arrival.
      else { o.conn.send({ type: 'land', p: [land.x, land.y], net: sh.touchedNet, wide: sh.wide }); this.state = 'wait'; }
    } else this.state = 'wait';
  }

  private onNet(m: GameMsg | ServerMsg) {
    const o = this.online!;
    switch (m.type) {
      case 'pos':
        (this.controllers[1] as RemoteController).update(flip2(m.x, m.y), m.charge, m.jump);
        break;
      case 'hit': this.applyRemoteHit(m); break;
      case 'land': {
        // Host only: the guest says the shuttle landed on their side untouched.
        if (!o.host || (this.state !== 'rally' && this.state !== 'wait')) break;
        const sh = this.shuttle, p = flip2(m.p[0], m.p[1]);
        sh.touchedNet ||= m.net;
        sh.wide ||= m.wide;
        sh.pos = { x: p.x, y: p.y, z: 0 };
        sh.inFlight = false;
        this.endRally(p);
        break;
      }
      case 'point': if (!o.host) this.applyRemotePoint(m); break;
      case 'challenge':
        // The other player asked for Hawk-Eye on the last call (it went against them).
        if (this.state === 'replay') this.endReplay();
        if (this.call && !this.call.challenged && (this.state === 'point' || this.state === 'serve')) this.startChallenge(1);
        break;
      case 'review':
        if (!o.host) { this.match.scores = [m.scores[1], m.scores[0]]; this.match.games = [m.games[1], m.games[0]]; }
        break;
      case 'chat': if (CHAT[m.i]) this.shout(this.players[1], CHAT[m.i], 2.5); break;
      case 'pause': this.paused = m.on; this.pausedBy = m.on ? 'opponent' : null; break;
      case 'forfeit': this.winByForfeit(); break;
      case 'peer':
        if (m.status === 'away') this.peerAway = true;
        else if (m.status === 'back') this.peerAway = false;
        else this.winByForfeit();
        break;
    }
  }

  /** The other player hit the shuttle (or served) on their screen. */
  private applyRemoteHit(m: Extract<GameMsg, { type: 'hit' }>) {
    if (this.state === 'replay') this.endReplay();
    // Still in the pause after the last point here: catch up to their serve.
    if (m.serve) for (let k = 0; k < 4 && this.state !== 'serve' && this.state !== 'matchOver'; k++) this.advance();
    if (this.state === 'matchOver') return;
    const me = this.players[0], opp = this.players[1], sh = this.shuttle;
    const pos = flip3(m.p), vel = flip3(m.v);
    if (this.state === 'serve') {
      this.serveBox = serviceBox(me.side, this.match.serverInRightCourt(), false);
      for (const p of this.players) { p.frozen = false; p.serving = null; }
      this.recorder.reset();
      this.rallyHits = 0;
    }
    // Mid-rally, this screen's shuttle has drifted from where they really hit it: draw it gliding
    // onto the true path rather than jumping (the physics uses the true path straight away).
    const drawnFrom = this.state === 'rally' || this.state === 'wait' ? { ...sh.pos } : null;
    this.state = 'rally';
    this.acc = 0;
    sh.launch(pos, vel, opp.side, m.serve);
    if (drawnFrom && Math.hypot(drawnFrom.x - pos.x, drawnFrom.y - pos.y, drawnFrom.z - pos.z) < 3) {
      this.drawOffset = { x: drawnFrom.x - pos.x, y: drawnFrom.y - pos.y, z: drawnFrom.z - pos.z };
      this.drawOffsetT = 0;
    }
    sh.trail = [];
    this.predict();
    sh.tumbling = /tumbling/.test(m.label);
    opp.onHit(pos, m.serve);
    me.splitStep();
    this.rallyHits++;
    this.lastContact = null;
    const hand = m.serve ? 'serve' : (m.hand as Contact['hand']);
    this.lastShot = { label: m.label, hand, netCord: false };
    this.lastHitterId = opp.id;
    this.stats.shots.push({ by: 1, pid: opp.id, label: m.label, speedKmh: m.kmh, hand, landing: this.predicted });
    this.announce(opp, { velocity: vel, label: m.label, speedKmh: m.kmh }, m.detail || null);
    this.events.push({ type: 'hit', strength: m.serve ? 0.3 : Math.min(1, m.kmh / 300) });
    // Same notice a local hit gives (only the timing details of their contact aren't known here).
    const contact: Contact = { point: pos, side: opp.side, hand: hand === 'serve' ? 'forehand' : hand, airborne: false, timing: 1, timingLabel: 'Perfect', timingError: 0, stretch: 0, apex: false, behind: 0 };
    this.observe({ type: 'hit', by: opp.side, contact, label: m.label, landing: this.predicted, hitter: opp });
  }

  /** Guest: the host's verdict on the rally. */
  private applyRemotePoint(m: Extract<GameMsg, { type: 'point' }>) {
    const winner = (1 - m.winner) as 0 | 1, sh = this.shuttle;
    const land = m.land ? flip2(m.land[0], m.land[1]) : null;
    if (land) sh.pos = { x: land.x, y: land.y, z: 0 };
    sh.inFlight = false;
    this.predicted = null;
    this.recorder.markLanding();
    const hitter = (sh.lastHitter === this.players[0].side ? 0 : 1) as 0 | 1;
    const hitterWins = winner === hitter;
    this.stats.rallies.push({
      shots: this.rallyHits, winner, hitter, hitterPid: this.lastHitterId, kind: hitterWins ? 'winner' : 'error', forced: false,
      lastLabel: this.lastShot?.label ?? '', lastHand: this.lastShot?.hand ?? 'serve',
    });
    // The host's line call, turned round to this screen (so it can be challenged and reviewed here too).
    this.call = null;
    if (m.call && land) {
      const r = m.call.rect, rect = { xMin: -r.xMax, xMax: -r.xMin, yMin: -r.yMax, yMax: -r.yMin };
      const judge = judgeFor(this.officials, land, rect);
      this.call = { landing: land, rect, signed: m.call.signed, truthIn: m.call.truthIn, callIn: m.call.callIn, hitter: (1 - m.call.hitter) as 0 | 1, isServe: m.call.isServe, challenged: false, judge };
      if (judge) { judge.signal = m.call.callIn ? 'in' : 'out'; judge.signalT = 0; }
    }
    this.landing = land ? { p: land, call: m.callIn === null ? null : m.callIn ? 'IN' : 'OUT', t: 0 } : null;
    if (m.callIn === false) this.say('line', 'Out!');
    this.longestRally = Math.max(this.longestRally, this.rallyHits);
    this.snap = this.match.snapshot();
    this.prevServer = this.match.server;
    this.outcome = this.match.award(winner);
    // The host's score is the real one: line up with it if anything drifted.
    this.match.scores = [m.scores[1], m.scores[0]];
    this.match.games = [m.games[1], m.games[0]];
    this.banner = { title: m.title, sub: `${m.why ? `${m.why} · ` : ''}Point ${this.teamName(winner)}`, color: this.teamColor(winner), t: 0 };
    this.events.push({ type: 'point' });
    const intensity = clamp((this.rallyHits - 3) / 14, 0.12, 1);
    this.cheer = intensity;
    this.events.push({ type: 'applause', intensity });
    this.greatPoint = false;
    this.aiChallengeAt = null;
    this.observe({ type: 'rally', winner: this.players[winner].side });
    this.state = 'point';
    this.pointT = 0;
    this.timer = RULES.pointPause + (this.challengeWait(this.call) ? RULES.challengeWindow : 0);
  }

  /** Online: seconds until the server may serve (0 once they can). */
  get serveCountdown(): number { return this.state === 'serve' ? Math.max(0, this.timer) : 0; }

  /** The other player left or gave up: you win. */
  private winByForfeit() {
    if (this.state === 'matchOver') return;
    this.forfeitWinner = 0;
    this.peerAway = false;
    this.paused = false;
    this.pausedBy = null;
    this.state = 'matchOver';
    this.onMatchOver?.(this);
    this.banner = null;
    this.stats.finish();
    this.say('umpire', `${this.players[1].voiceName} retired. Match won by player.`, true);
  }

  /** Quick chat (online): a preset line over your head and theirs. */
  sendChat(i: number) {
    if (!this.online || !CHAT[i] || this.stats.seconds - this.lastChat < 1.5) return;
    this.lastChat = this.stats.seconds;
    this.shout(this.players[0], CHAT[i], 2.5);
    this.online.conn.send({ type: 'chat', i });
  }

  /** Online pause: only between points, so both screens stop in the same place. */
  setOnlinePause(on: boolean): boolean {
    if (!this.online) return false;
    if (on && (this.state === 'rally' || this.state === 'wait')) {
      this.banner = { title: 'Pause between points', sub: 'You can pause once this rally is over', color: VISUAL.colors.hud, t: 0 };
      return false;
    }
    if (!on && this.pausedBy === 'opponent') return false;
    this.paused = on;
    this.pausedBy = on ? 'you' : null;
    this.online.conn.send({ type: 'pause', on });
    return true;
  }

  private observe(o: Observation) {
    for (const c of this.controllers) c.observe?.(o);
  }

  private say(who: Speaker, text: string, interrupt = false) {
    if (who !== 'partner') this.caption = { who, text, t: 0 };
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
