import { AIController } from './ai';
import type { Camera, View } from './camera';
import { COURT, DOUBLES, LEVEL_LABEL, KEYS, OFFICIALS, ONLINE, PHYSICS, PLAYER, REPLAY, RULES, SERVE, SHOTS, STYLES, SWING, VISUAL, type KeyMap, type Level, type Style } from './config';
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
import type { Seat } from './net';
import { characterById, getEffectiveStats, type Character, type Modifier } from '../shared/characters';
import { defaultSetup, restrictionsAllowed, usesCareerStats, type MatchSetup, type Restrictions } from './setup';
import { Signatures, shotKind, type ShotCtx, type SigDef } from './careermode/signatures';
import { REPLAY_CAMS, type ReplayCam } from './camera';
import type { Highlight } from './highlights';
import type { MatchFacts } from './achievements';
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
  points: 11 | 15 | 21;
  /** Show the predicted landing spot and a height line under the shuttle. */
  guides: boolean;
  /** Light next to your player: yellow = too early to swing, green = swing now, red = too late. */
  timingLight: boolean;
  /** If you don't swing at all, the game swings for you as the shuttle reaches you (a late hit). */
  swingAssist: boolean;
  /** Your look: a name for the scoreboard (blank = "You"), shirt and racket colours (blank = standard). */
  playerName?: string;
  shirt?: string;
  racket?: string;
  /** Lighter drawing for slow laptops: smaller crowd, lower resolution, fewer effects, 30 frames a second. */
  performance?: boolean;
  /** Your player (character id); the placeholder Club Player if not set. */
  character?: string;
  aim: 'realistic' | 'casual';
  voice: boolean;
  /** Online quick chat from other players: shown (default) or hidden. */
  hideChat?: boolean;
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
  /** Footwork: a shoe squeak on a hard stop or turn, and footsteps. pan: −1 left to 1 right; near: your end. */
  | { type: 'squeak'; pan: number; near: boolean }
  | { type: 'step'; pan: number; near: boolean }
  | { type: 'point' }
  | { type: 'applause'; intensity: number }
  | { type: 'say'; who: Speaker; text: string; interrupt?: boolean };

export interface Callout { label: string; detail: string; color: string; t: number; assist?: boolean }
/** ttl: notices that disappear on their own after this many seconds (others stay until the next point). */
export interface Banner { title: string; sub: string; color: string; t: number; card?: 'red'; ttl?: number }

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
  /** Developer restrictions in force for this match (none in normal play). */
  private limits: Restrictions = {};
  /** Game seconds since the shuttle was last hit. */
  get flightTime(): number { return this.flightT; }
  /** A lift was just played: nobody can touch it for this much longer (game seconds). */
  liftGuard = 0;
  /** Seconds left on the shot clock (real time). */
  clock: number = OFFICIALS.shotClock;
  clockRunning = false;
  challenges: [number, number] = [OFFICIALS.challengesPerGame, OFFICIALS.challengesPerGame];
  call: LineCall | null = null;
  review: Review | null = null;
  playback: Playback | null = null;
  replayCam: ReplayCam = 'broadcast';
  /** Replay speed (1, ½ or ¼), T to change. */
  replaySpeed = REPLAY.speeds[1];
  /** Crowd excitement, 0..1. */
  cheer = 0;
  /** Practice or tutorial session (null in a match). */
  session: Session | null = null;
  /** Yellow target rings on the floor (tutorial movement lesson). */
  rings: V2[] = [];
  /** Challenges: the box to aim for on the far court (depths past the net), and time since a shot counted. */
  targetZone: { d0: number; d1: number } | null = null;
  zoneFlash = Infinity;
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
  /**
   * Online pause: each player has their own Esc. Play waits until both have resumed, and any pause ends
   * on its own after ONLINE.pauseMax seconds so nobody can stall.
   */
  pauseMine = false;
  /** Online: who else has pressed Esc (their seats). */
  pausedBy = new Set<Seat>();
  get pauseTheirs(): boolean { return this.pausedBy.size > 0; }
  /** Online: whose connection is down ('self' for your own). */
  /** Whose connection is down ('self' for your own), and since when (performance.now()). */
  private away = new Map<string, number>();
  /** Online: your team, numbered from the host's side (0 = the host's team). */
  private myTeam: 0 | 1 = 0;
  /** Online: how long this screen has been waiting on the rally's verdict, and the host's last verdict (to resend). */
  private waitT = 0;
  private syncT = 0;
  private lastPointMsg: GameMsg | null = null;
  /** Online: points decided so far (host: numbers each verdict; others: the last one applied). */
  private pointN = 0;
  /** Online doubles: the last hit applied here (rally hit number, lineup slot), to settle simultaneous hits. */
  private lastHit = { n: 0, g: -1 };
  /** When the current online pause began (performance.now()), or null. */
  pauseSince: number | null = null;
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
  private jumped = [false, false, false, false];
  private lastSentPos = '';
  private lastChat = -9;
  /** Online lag hiding: how long the shuttle has hovered on the other side, for which hit. */
  private hoverT = 0;
  private hoverHit = -1;
  /** A disguised shot was just played: the landing marker stays hidden this long (game seconds). */
  disguiseT = 0;
  /** Signature abilities in this match (null when off). */
  sigs: Signatures | null = null;
  /** The last ability that fired, for the screen. */
  abilityPop: { text: string; mine: boolean; t: number } | null = null;
  private statMode: 'ranked' | 'career' = 'ranked';
  private statChars: (Character | null)[] = [null, null];
  private baseMods: Modifier[][] = [[], []];
  private baseSpeed: number[] = [];
  /** Recompute a player's stats with any timed ability effects. */
  private refreshEff(i: number) {
    const c = this.statChars[i];
    if (!c) return;
    const p = this.players[i];
    p.eff = getEffectiveStats(c, [...this.baseMods[i], ...(this.sigs?.modsFor(i) ?? [])], this.statMode);
    p.speedMult = this.baseSpeed[i] * p.eff.move;
  }
  /** Online: how far (game seconds) the other player's latest shot still lags behind its true position. */
  private catchUp = 0;
  /** Online: gap between where the shuttle was drawn and where their hit put it, shrinking to nothing. */
  private drawOffset: V3 | null = null;
  private drawOffsetT = 0;

  /** The match as described when it started (characters, opponent, restrictions). */
  readonly setup: MatchSetup;

  constructor(public settings: Settings, input: Input, camera: Camera, public mode: Mode = 'match', online: OnlineLink | null = null, setup?: MatchSetup) {
    this.setup = setup ?? defaultSetup(online ? (online.ranked ? 'ranked' : 'friendly') : mode === 'practice' || mode === 'tutorial' ? 'practice' : 'cpu', settings.games, settings.points);
    this.online = online;
    const drill = mode === 'practice' || mode === 'tutorial';
    // Online: doubles when the room has a lineup of four, otherwise singles. Nobody switches players online.
    if (online) settings = { ...settings, event: online.lineup ? 'doubles' : 'singles', autoSwitch: false };
    if (drill) settings = { ...settings, opponent: 'medium', event: 'singles' };
    // The tutorial teaches timing with the light, so it's always on there.
    if (mode === 'tutorial') settings = { ...settings, timingLight: true };
    // Offline doubles is always against a CPU pair (no shared-keyboard doubles).
    if (settings.event === 'doubles' && settings.opponent === 'human') settings = { ...settings, opponent: 'medium' };
    if (online) this.myTeam = online.lineup ? ((online.me ?? 0) % 2 as 0 | 1) : online.host ? 0 : 1;
    this.settings = settings;
    const doubles = this.doubles = settings.event === 'doubles';
    // One player on this keyboard: against the CPU, or online (the other player is on their own computer).
    const vsAI = settings.opponent !== 'human' || !!online;
    this.match = new Match(RULES.formats[settings.points], settings.games === 1 ? 1 : 2, doubles);
    this.officials = createOfficials(doubles);
    const myName = settings.playerName?.trim();
    const p1 = new Player(-1, vsAI ? myName || 'You' : 'P1', settings.shirt || VISUAL.colors.p1, vsAI ? myName?.replace(/_/g, ' ') || 'Player' : 'Player one');
    p1.racket = settings.racket || undefined;
    const p2 = online
      ? new Player(1, online.opponentName, VISUAL.colors.p2, online.opponentName.replace(/_/g, ' '))
      : new Player(1, drill ? 'Coach' : doubles ? 'CPU 1' : vsAI ? 'CPU' : 'P2', VISUAL.colors.p2, doubles ? 'C P U one' : vsAI ? 'C P U' : 'Player two');
    this.players = [p1, p2];
    if (doubles) this.players.push(new Player(-1, 'Partner', VISUAL.colors.p3, 'Partner'), new Player(1, 'CPU 2', VISUAL.colors.p4, 'C P U two'));
    this.players.forEach((p, i) => { p.id = i; });
    // Career and the daily challenge: the opponent is a real player from the roster, by name.
    if (!online && !doubles && setup?.opponent.characterId && usesCareerStats(setup.mode)) {
      const rival = characterById(setup.opponent.characterId);
      p2.name = rival.name;
      p2.voiceName = rival.name;
    }
    // Online doubles: everyone's name from the lineup (CPUs keep theirs).
    if (online?.lineup) {
      for (let i = 1; i < 4; i++) {
        const slot = online.lineup[this.slotOf(i)];
        this.players[i].name = slot.name;
        this.players[i].voiceName = slot.name.replace(/_/g, ' ');
      }
    }
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
    if (online?.lineup) {
      // Online doubles: other people are driven from their screens; CPUs are played by the host's
      // screen and driven from it everywhere else.
      for (let i = 1; i < 4; i++) {
        const person = !!online.lineup[this.slotOf(i)].seat;
        this.controllers[i] = person || !online.host
          ? new RemoteController(this.players[i])
          : new AIController(this, this.players[i], settings.opponent as Level, i === 2 ? settings.partnerStyle : settings.style);
      }
    }
    this.players.forEach((p, i) => { if (this.isHuman(i)) p.extraReach = PLAYER.humanExtraReach; });
    // Characters: you, and a CPU opponent if one was picked. Neutral stats leave everything as it was.
    const statMode = this.statMode = usesCareerStats(this.setup.mode) ? 'career' : 'ranked';
    this.statChars = [characterById(this.setup.player.characterId), this.setup.opponent.characterId && !online ? characterById(this.setup.opponent.characterId) : null];
    this.baseMods = [this.setup.player.modifiers ?? [], this.setup.opponent.modifiers ?? []];
    this.players[0].eff = getEffectiveStats(this.statChars[0]!, this.baseMods[0], statMode);
    if (this.statChars[1]) this.players[1].eff = getEffectiveStats(this.statChars[1], this.baseMods[1], statMode);
    for (const p of this.players) p.speedMult *= p.eff.move;
    this.limits = restrictionsAllowed() || this.setup.forced ? this.setup.restrictions : {};
    if (this.limits.opponentSpeedMult) this.players[1].speedMult *= this.limits.opponentSpeedMult;
    this.baseSpeed = this.players.map((p) => p.speedMult / p.eff.move);
    // Signature abilities (career and the daily challenge; never online until they're balanced for it).
    if (!online && !doubles && (this.setup.player.abilities || this.setup.opponent.abilities)) {
      this.sigs = Signatures.forCharacters([this.setup.player.abilities ? this.statChars[0] : null, this.setup.opponent.abilities ? this.statChars[1] : null], (i) => this.teamOf(i));
    }
    if (drill) {
      this.session = mode === 'practice' ? new Practice() : new Tutorial(settings.p1Control === 'mouse' ? 'mouse' : 'keyboard', this.p1Keys);
      p1.place(0, -PLAYER.baseDepth);
      p2.place(0, 2.2);
      this.shuttle.hold({ x: 0, y: 1.6, z: 0.8 });
      this.session.start(this);
      return;
    }
    if (online) {
      // The host's team serves first; on the other team's screens the host's team is the far side.
      this.match.server = this.teamHere(0);
      if (online.lineup) {
        // Slots 0 and 1 start in the right service courts, the same people on every screen.
        this.match.startRight[this.teamHere(0)] = this.local(0);
        this.match.startRight[this.teamHere(1)] = this.local(1);
        this.match.right = [...this.match.startRight];
      }
      this.unsubscribe = online.conn.on((m) => this.onNet(m));
    }
    const r = online?.resume;
    if (r) {
      // Carrying on after a reload: same score, same server, turned to this screen's view.
      const flip = <T,>(a: [T, T]): [T, T] => (this.myTeam === 0 ? [a[0], a[1]] : [a[1], a[0]]);
      this.match.resumeFrom(flip(r.scores), flip(r.games), r.history.map((h) => flip(h)), this.teamHere(r.server));
      this.say('umpire', `Play resumes. ${scoreCall(this.match, false)}`);
    } else this.say('umpire', gameStartCall(1, this.match.gamesToWin));
    if (this.limits.startScore && !online) this.match.scores = [...this.limits.startScore];
    // Singles against the CPU: it remembers your habits from earlier matches on this computer.
    if (mode === 'match' && !online && !doubles && this.controllers[1] instanceof AIController && vsAI && !usesCareerStats(this.setup.mode)) {
      const weak = this.controllers[1].useMemory();
      if (weak) this.banner = { title: 'The CPU remembers you', sub: `Last time you struggled with shots to your ${weak}. Expect more of them.`, color: VISUAL.colors.accent, t: 0, ttl: 4.5 };
    }
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
    if (this.online) return `Online${this.doubles ? ' doubles' : ''} · room ${this.online.conn.code}`;
    // Career and the daily challenge: a real player, not "CPU <level>".
    const rival = this.setup.opponent.characterId && usesCareerStats(this.setup.mode) ? characterById(this.setup.opponent.characterId) : null;
    if (rival) return `${this.setup.label ?? (this.setup.mode === 'daily' ? 'Daily challenge' : 'Career')} · ${rival.country} · ${rival.style}`;
    const o = this.settings.opponent;
    if (o === 'human') return '2 Player';
    return `CPU ${LEVEL_LABEL[o]}${this.doubles ? ' pair' : ''} · ${STYLES[this.settings.style].label}`;
  }
  /** Side 0 (near) or 1 (far) of player i. */
  teamOf(i: number): 0 | 1 { return (i % 2) as 0 | 1; }
  teamName(t: 0 | 1): string {
    if (!this.doubles) return this.players[t].name;
    if (this.online) return `${this.players[t].name} & ${this.players[t + 2].name}`;
    return t === 0 ? 'You & Partner' : 'CPU pair';
  }
  teamVoice(t: 0 | 1): string {
    if (!this.doubles) return this.players[t].voiceName;
    if (this.online) return `${this.players[t].voiceName} and ${this.players[t + 2].voiceName}`;
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
  /** Swing assist only helps against a Beginner or Easy CPU (never online, in the tutorial or harder matches). */
  get assistAllowed(): boolean {
    return !this.online && this.mode !== 'tutorial' && (this.settings.opponent === 'beginner' || this.settings.opponent === 'easy');
  }
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
    if (this.online && this.paused && this.pauseLeft <= 0) this.endOnlinePause(true);
    if (this.away.size) this.syncAway();
    if (this.paused || this.peerAway) return;
    if (this.state !== 'wait') { this.waitT = 0; this.syncT = 0; }
    const real = Math.min(realDt, 0.05);
    const dt = real * PHYSICS.gameSpeed;
    if (this.drawOffset && (this.drawOffsetT += dt) >= ONLINE.smoothTime) this.drawOffset = null;
    if (this.callout) { this.callout.t += dt; if (this.callout.t > 1.8) this.callout = null; }
    if (this.banner) { this.banner.t += real; if (this.banner.ttl && this.banner.t > this.banner.ttl) this.banner = null; }
    if (this.landing) this.landing.t += dt;
    if (this.caption) this.caption.t += real;
    this.zoneFlash += real;
    if (this.commentary && (this.commentary.t += real) > 4.5) this.commentary = null;
    this.cheer = Math.max(0, this.cheer - real * 0.3);
    this.stats.tick(real);
    if (this.sigs?.tick(dt)) { this.refreshEff(0); this.refreshEff(1); }
    if (this.abilityPop && (this.abilityPop.t += real) > 1.8) this.abilityPop = null;
    if (!this.session) this.scoreWatch();
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
    if (this.online) this.sendPos(dt, cmds);
    if (this.session) this.clockRunning = false;
    if (this.clockRunning && (this.state === 'point' || this.state === 'serve')) {
      this.clock -= real;
      if (this.state === 'serve' && this.clock <= 0 && this.clockRunning) this.timeViolation();
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
        this.waitWatchdog(real);
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
    if (!this.clockRunning && !this.session) { this.clock = OFFICIALS.shotClock; this.clockRunning = true; }
    for (const c of this.controllers) if (c instanceof RemoteController) c.reset();
    this.lastHit = { n: 0, g: -1 };
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
    if (this.online) this.sendHit(si, from, shot.velocity, shot.label, shot.speedKmh, 'serve', '', true);
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
      if (first && cmds[i].shot) p.startSwing(cmds[i].shot!, false, this.isHuman(i));
      if (p.update(dt, cmds[i].move, first && cmds[i].jump) === 'whiff') this.events.push({ type: 'whiff' });
      this.footwork(p, i, dt);
    });
    if (this.doubles) this.keepApart();

    const sh = this.shuttle;
    const prev = { ...sh.pos };
    if (this.disguiseT > 0) this.disguiseT -= dt;
    // Online: a shot from another screen arrived late, so play it a little faster until it catches up.
    // Coming down on a side where someone on another screen could still reach it, the shuttle is for
    // show here: near the floor it hovers for about as long as their hit takes to arrive, rather than
    // landing before you know if they hit it.
    let fdt = dt;
    if (this.online && sh.inFlight && !sh.touchedNet) {
      const side = sh.pos.y < 0 ? -1 : 1;
      if (this.catchUp > 0) {
        const extra = Math.min(this.catchUp, dt * ONLINE.catchUpRate);
        fdt = dt + extra;
        this.catchUp -= extra;
      } else if (sh.lastHitter !== side && this.players.some((p, i) => p.side === side && this.remote(i))) {
        if (this.hoverHit !== sh.hits) { this.hoverHit = sh.hits; this.hoverT = 0; }
        const hold = Math.min(ONLINE.hoverMax, ONLINE.hoverScale * this.online.conn.latency / 1000 * PHYSICS.gameSpeed + ONLINE.hoverPad);
        if (sh.pos.z < ONLINE.hoverHeight && sh.vel.z < 0 && this.hoverT < hold) {
          this.hoverT += dt;
          fdt = dt * ONLINE.hoverRate;
        }
      }
    }
    stepFlight(sh.pos, sh.vel, fdt);
    this.flightT += fdt;
    if (this.liftGuard > 0) this.liftGuard -= fdt;
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
        if (!p.aboutToMiss(sh.pos, sh.vel, dt, this.flightT)) return;
        const req = this.controllers[i].forceRelease?.();
        if (req) p.startSwing(req);
      });
      // Swing assist: you didn't swing at all, so get it back with a high shot (a late hit). It lands
      // mid-court rather than deep, so the opponent can still attack it.
      if (this.settings.swingAssist && this.assistAllowed) {
        this.players.forEach((p, i) => {
          if (!this.isHuman(i) || p.swing || p.charge !== null || sh.lastHitter === p.side || sh.pos.y * p.side <= 0) return;
          // Attacking shots slow down a lot in the air, so judge by what was hit, not current speed.
          if (/smash|kill|drive|push/i.test(this.lastShot?.label ?? '')) return;
          if (p.aboutToMiss(sh.pos, sh.vel, dt, this.flightT)) p.startSwing({ kind: 'intent', intent: 'high', aimX: 0, aimDepth: -1 }, true);
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
        // Online: other screens' hits arrive as messages (the host's screen plays its CPUs' hits).
        if (this.online && this.remote(i)) continue;
        // A lift that has only just left the racket is out of anyone's reach.
        if (this.liftGuard > 0) continue;
        const c = p.tryContact(sh.pos, sh.vel, dt, this.flightT);
        if (!c) continue;
        // Developer restrictions: no smashing (a hard overhead is only a drive), no dropping (it's a clear).
        if (i === 0 && this.limits.noSmash && c.point.z >= SHOTS.overheadHeight) c.rising = true;
        if (i === 0 && this.limits.noDropShot && c.point.z >= SHOTS.overheadHeight && p.swing.req.kind === 'intent' && p.swing.req.intent === 'soft') p.swing = { ...p.swing, req: { ...p.swing.req, intent: 'high' } };
        c.tumbling = sh.tumbling;
        const ctrl = this.controllers[i];
        let req = ctrl.aimAtContact ? ctrl.aimAtContact(p.swing.req) : p.swing.req;
        if (req.kind === 'intent' && !req.target && req.aimX === 0 && this.isHuman(i)) {
          // Keyboard with no direction held: play into the open side rather than straight at the opponent.
          const opps = this.players.filter((q) => q.side !== p.side);
          const ox = opps.reduce((a, q) => a + q.pos.x, 0) / opps.length;
          const side = Math.abs(ox) > 0.25 ? -Math.sign(ox) : Math.sign(c.point.x) || 1;
          // A lift goes all the way to the far corner, away from them.
          // A lift, push or drive goes all the way to the far side, away from them.
          const corner = (req.intent === 'high' || req.intent === 'fast') && c.point.z < SHOTS.overheadHeight;
          req = { ...req, aimX: corner ? side : (side * SHOTS.autoAimLateral) / SHOTS.aimLateral };
        }
        const incomingKmh = Math.hypot(sh.vel.x, sh.vel.y, sh.vel.z) * 3.6;
        if (c.rising && Math.abs(c.point.y) < RULES.overNet) {
          // Still climbing, right by the net: you'd have to reach over to it. Fault; it drops dead.
          p.onHit(c.point);
          sh.vel = { x: 0, y: 0, z: -1.5 };
          this.faultTitle = 'Fault — reached over the net';
          this.callout = { label: 'OVER THE NET', detail: 'Too close to a rising shuttle · fault', color: VISUAL.colors.callOut, t: 0 };
          this.events.push({ type: 'net' });
          break;
        }
        if (this.touchesNet(p, req, c)) {
          // Hit hard from right on top of the net: the racket clips it. The shuttle drops dead on this side.
          p.onHit(c.point);
          sh.vel = { x: 0, y: 0, z: -1.5 };
          this.faultTitle = 'Fault — touched the net';
          this.callout = { label: 'TOUCHED THE NET', detail: 'Too close for a hard shot · fault', color: VISUAL.colors.callOut, t: 0 };
          this.events.push({ type: 'net' });
          break;
        }
        const aimScale = this.isHuman(i) ? SHOTS.aimModes[this.settings.aim] : 1;
        let shot = resolveShot(req, c, aimScale, this.isHuman(i), p.eff);
        // Signature abilities: boosts for this shot (played again with them), and a chance to wrong-foot.
        let sigCtx: ShotCtx | null = null, sigFired: SigDef[] = [], deceived = false;
        const sigBefore = this.sigs?.last ?? null;
        if (this.sigs && i < 2) {
          sigCtx = { kind: shotKind(shot.label), perfect: c.timing >= 1, incomingKmh, lunged: c.stretch > SHOTS.stretchStart, early: this.flightT < 0.6,
            crosscourt: Math.abs(c.point.x) > 0.5 && c.point.x * shot.velocity.x < 0, prev: null };
          const boost = this.sigs.forShot(i, sigCtx);
          if (boost.mods.length && this.statChars[i]) shot = resolveShot(req, c, aimScale, this.isHuman(i), getEffectiveStats(this.statChars[i]!, [...this.baseMods[i], ...this.sigs.modsFor(i), ...boost.mods], this.statMode));
          deceived = boost.deceive > 0 && Math.random() < boost.deceive;
          sigFired = boost.fired;
        }
        sh.launch(c.point, shot.velocity, p.side, false);
        this.predict();
        if (this.checkTumble(shot.label, c.timing >= 1)) shot.label = 'Net shot (tumbling)';
        if (/Lift/.test(shot.label)) this.liftGuard = SHOTS.liftGuard;
        if (req.kind === 'intent' && req.disguise) {
          // Disguised: the landing marker shows up late and the other side is caught going the wrong way.
          shot.label = `${shot.label} (disguised)`;
          this.disguiseT = SHOTS.disguise.markerDelay;
          for (const q of this.players) if (q.side !== p.side) q.wrongFoot(SHOTS.disguise.wrongFoot);
        } else if (deceived) {
          this.disguiseT = SHOTS.disguise.markerDelay;
          for (const q of this.players) if (q.side !== p.side) q.wrongFoot(SHOTS.disguise.wrongFoot);
        }
        if (this.sigs && sigCtx) {
          this.sigs.afterShot(i, sigCtx, sigFired, deceived);
          this.refreshEff(0); this.refreshEff(1);
          const f = this.sigs.last;
          if (f && f !== sigBefore) this.abilityPop = { text: f.def.name, mine: this.teamOf(f.player) === 0, t: 0 };
        }
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
        const detail = `${perfectJump ? 'PERFECT JUMP' : c.timingLabel}${c.hand !== 'forehand' ? ` · ${c.hand}` : ''}`;
        this.announce(p, shot, detail);
        if (this.online) this.sendHit(i, c.point, shot.velocity, shot.label, shot.speedKmh, c.hand, detail, false);
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
    this.sigs?.onPoint(winner, this.lastHitterId, this.lastShot ? shotKind(this.lastShot.label) : null);
    this.stats.rallies.push({
      shots: this.rallyHits, winner, hitter: hIdx, hitterPid: this.lastHitterId, kind: hitterWins ? 'winner' : 'error', forced,
      lastLabel: this.lastShot?.label ?? '', lastHand: this.lastShot?.hand ?? 'serve',
    });
    this.call = line;
    this.landing = { p: land, call: line ? (line.callIn ? 'IN' : 'OUT') : null, t: 0 };
    this.longestRally = Math.max(this.longestRally, this.rallyHits);
    this.snap = this.match.snapshot();
    this.prevServer = this.match.server;
    this.outcome = this.awardPoint(winner);
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
    this.clockRunning = true;
    this.aiChallengeAt = null;
    if (this.online?.host) {
      this.online.conn.send(this.lastPointMsg = {
        type: 'point', n: ++this.pointN, winner, land: [land.x, land.y], title, why, callIn: line ? line.callIn : null,
        call: line ? { rect: line.rect, signed: line.signed, truthIn: line.truthIn, callIn: line.callIn, hitter: line.hitter, isServe: line.isServe } : null,
        scores: [...this.match.scores], games: [...this.match.games], ...this.rightField(),
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
   * Touching the net: a hard shot played while standing right up against it always does (see
   * RULES.netFault); a gentle net shot never does.
   */
  private touchesNet(p: Player, req: ShotRequest, c: Contact): boolean {
    const N = RULES.netFault, dist = Math.abs(p.pos.y);
    if (dist >= N.within || Math.abs(c.point.y) > N.within + 0.4) return false;
    return req.kind === 'intent' ? req.intent === 'fast' : req.arc === 'low' && req.power > 0.4;
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
      // The guest's screen confirms the final score to the room (in the host's order), so a rated
      // result is only saved when both screens agree.
      if (this.online && !this.online.host && !this.doubles) this.online.conn.send({ type: 'final', games: [m.games[1], m.games[0]] });
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
    if (this.online?.host) this.online.conn.send({ type: 'review', scores: [...this.match.scores], games: [...this.match.games], ...this.rightField() });
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

  /** T: replay speed 1× → ½× → ¼×. */
  cycleReplaySpeed() {
    const S = REPLAY.speeds;
    this.replaySpeed = S[(S.indexOf(this.replaySpeed) + 1) % S.length];
    if (this.playback) this.playback.base = this.replaySpeed;
  }

  /** P: the last rally as a highlight to save (null if there's nothing to save yet). */
  highlight(): Highlight | null {
    if (!['point', 'serve', 'replay', 'interval', 'gameBreak', 'matchOver'].includes(this.state)) return null;
    const frames = this.recorder.clip(REPLAY.highlightSeconds);
    if (frames.length < 20) return null;
    const m = this.match, shot = this.lastShot?.label ?? 'Rally';
    return {
      id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, at: Date.now(),
      title: `${shot} · ${this.rallyHits}-shot rally`, sub: `${this.teamName(0)} ${m.scores[0]}–${m.scores[1]} ${this.teamName(1)}`,
      doubles: this.doublesCourt, landedAt: this.recorder.landedAt, frames,
    };
  }

  toggleReplayCamera() {
    if (this.state !== 'replay') return;
    const i = REPLAY_CAMS.findIndex((c) => c.id === this.replayCam);
    this.replayCam = REPLAY_CAMS[(i + 1) % REPLAY_CAMS.length].id;
  }

  private startReplay(auto: boolean) {
    const r = this.recorder;
    const start = auto ? (r.landedAt ?? r.t) - REPLAY.autoSeconds : 0;
    this.playback = new Playback(r.frames, start, r.landedAt, auto, this.replaySpeed);
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

  /**
   * The server ran out the shot clock. Online, only the server's own screen calls this (its clock is the
   * one that counts) and the host awards the point, so a guest server tells the host.
   */
  private timeViolation() {
    const s = this.match.server;
    if (this.online) {
      if (this.match.serverIdx() !== 0) return;
      this.clockRunning = false;
      // Guest: no serving now; the host's point message comes straight back.
      if (!this.online.host) { this.online.conn.send({ type: 'delay' }); this.state = 'wait'; return; }
    }
    this.redCard(s);
  }

  /** Red card for delaying the serve: the point goes to the receiver. */
  private redCard(s: 0 | 1) {
    const winner = (1 - s) as 0 | 1, late = this.server;
    const title = 'Red card — delay of service';
    this.snap = this.match.snapshot();
    this.prevServer = this.match.server;
    this.outcome = this.awardPoint(winner);
    this.stats.rallies.push({ shots: 0, winner, hitter: s, hitterPid: late.id, kind: 'delay', forced: false, lastLabel: '', lastHand: 'serve' });
    this.call = null;
    this.landing = null;
    this.predicted = null;
    this.greatPoint = false;
    this.banner = { title, sub: `${late.name} took more than ${OFFICIALS.shotClock} seconds to serve · Point ${this.teamName(winner)}`, color: VISUAL.colors.callOut, t: 0, card: 'red' };
    this.say('umpire', `${late.voiceName}, red card, delay of service.`, true);
    this.events.push({ type: 'point' });
    this.state = 'point';
    this.pointT = 0;
    this.timer = RULES.pointPause + 1;
    this.clock = OFFICIALS.shotClock;
    this.clockRunning = true;
    if (this.online?.host) {
      this.online.conn.send(this.lastPointMsg = { type: 'point', n: ++this.pointN, winner, land: null, title, why: null, callIn: null, call: null, scores: [...this.match.scores], games: [...this.match.games], ...this.rightField() });
    }
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

  // For achievements: the biggest deficit you've faced in the current game, your best comeback and
  // games won to love.
  private worstDeficit = 0;
  private seenGames = 0;
  private comebackBest = 0;
  private loveGames = 0;
  private scoreWatch() {
    const m = this.match;
    if (m.history.length > this.seenGames) {
      const [a, b] = m.history[m.history.length - 1];
      if (a > b) { this.comebackBest = Math.max(this.comebackBest, this.worstDeficit); if (b === 0) this.loveGames++; }
      this.seenGames = m.history.length;
      this.worstDeficit = 0;
    } else if (this.state !== 'gameBreak' && this.state !== 'matchOver') {
      this.worstDeficit = Math.max(this.worstDeficit, m.scores[1] - m.scores[0]);
    }
  }

  /** What this match showed, for achievements (call when it's over). */
  matchFacts(): MatchFacts {
    this.scoreWatch();
    const m = this.match, me = this.players[0].id;
    return {
      won: (this.forfeitWinner ?? (m.games[0] > m.games[1] ? 0 : 1)) === 0,
      online: !!this.online,
      level: this.online ? null : this.settings.opponent,
      jumpSmashWinner: this.stats.rallies.some((r) => r.kind === 'winner' && r.winner === 0 && r.hitterPid === me && /Jump smash/.test(r.lastLabel)),
      comeback: this.comebackBest,
      loveGame: this.loveGames > 0,
    };
  }

  // ── Commentary (text only) ────────────────────────────────────────────────
  /** The latest line from the commentator, shown at the top for a few seconds. */
  commentary: { text: string; t: number } | null = null;
  /** When each other player's last quick-chat line arrived (match seconds). */
  private chatHeard = new Map<string, number>();
  private run = { team: -1, n: 0 };
  /** Game or match points saved in a row by the same side. */
  private saves = { team: -1, n: 0 };
  private deficit: [number, number] = [0, 0];
  private bigSmash = 0;

  /** Score the point, then let the commentator react to it. */
  private awardPoint(winner: 0 | 1): PointOutcome {
    const m = this.match, savedFrom = m.atMatchPoint((1 - winner) as 0 | 1) ? 'match' : m.atGamePoint((1 - winner) as 0 | 1) ? 'game' : null;
    const last = this.stats.shots[this.stats.shots.length - 1];
    this.bigSmash = last && /smash/i.test(last.label) ? last.speedKmh : 0;
    const out = m.award(winner);
    if (!this.session) this.commentate(winner, out, savedFrom);
    return out;
  }

  private commentate(w: 0 | 1, out: PointOutcome, savedFrom: 'match' | 'game' | null) {
    const m = this.match, name = this.teamName(w);
    const plural = this.doubles || (w === 0 && this.players[0].name === 'You');
    const s = (verb: string) => (plural ? verb : `${verb}s`), were = plural ? 'were' : 'was';
    const [a, b] = m.scores, mine = m.scores[w], theirs = m.scores[1 - w];
    // Points in a row, and the biggest deficit each side has faced this game.
    this.run = this.run.team === w ? { team: w, n: this.run.n + 1 } : { team: w, n: 1 };
    if (a + b === 1) this.deficit = [0, 0];
    this.deficit[0] = Math.max(this.deficit[0], b - a);
    this.deficit[1] = Math.max(this.deficit[1], a - b);
    const down = this.deficit[w];
    const rally = this.rallyHits;
    let line: string | null = null;
    if (out.matchOver) line = down >= 5 ? `From ${down} points down, ${name} ${s('win')} it! What a comeback.` : `That’s the match. ${name} ${s('take')} it ${m.games[w]}–${m.games[1 - w]}.`;
    else if (out.gameOver) line = down >= 4 ? `${name} ${were} ${down} down in that game and still ${s('win')} it, ${mine}–${theirs}!` : `${name} ${s('take')} the game, ${mine}–${theirs}.`;
    else if (savedFrom) {
      this.saves = this.saves.team === w ? { team: w, n: this.saves.n + 1 } : { team: w, n: 1 };
      const what = savedFrom === 'match' ? 'match' : 'game';
      line = this.saves.n === 1 ? `${what === 'match' ? 'Match' : 'Game'} point saved! ${name} ${s('hang')} on.`
        : this.saves.n === 3 ? `Three ${what} points saved in a row! ${name} won’t go away.`
        : mine === theirs ? `Level at ${mine}–${theirs}. Anything can happen now.` : null;
    }
    else if (rally >= 25) line = `${rally} shots! What a rally, and ${name} ${s('win')} it.`;
    else if (this.bigSmash >= 320 && this.teamOf(this.players.findIndex((p) => p.id === this.lastHitterId)) === w) line = `${Math.round(this.bigSmash)} km/h! Nobody’s getting that back.`;
    else if (rally >= 15) line = `A ${rally}-shot rally goes to ${name}.`;
    else if (mine === theirs && down >= 4) line = `${name} ${were} ${down} points down. All square now at ${mine}–${theirs}!`;
    else if (this.run.n === 5 || this.run.n === 8) line = `${this.run.n === 5 ? 'Five' : 'Eight'} points in a row for ${name}.`;
    else if (m.atMatchPoint(w)) line = `Match point to ${name}.`;
    if (line) this.commentary = { text: line, t: 0 };
  }

  /** Last frame's movement per player, for footstep and squeak sounds. */
  private feet: { vx: number; vy: number; stride: number; cd: number }[] = [];
  private footwork(p: Player, i: number, dt: number) {
    const f = this.feet[i] ??= { vx: p.vel.x, vy: p.vel.y, stride: p.stride, cd: 0 };
    f.cd -= dt;
    const was = Math.hypot(f.vx, f.vy), now = Math.hypot(p.vel.x, p.vel.y);
    const pan = clamp(p.pos.x / 4, -0.8, 0.8), near = p.side < 0;
    if (!p.airborne && f.cd <= 0) {
      const turn = (f.vx * p.vel.x + f.vy * p.vel.y) / (Math.max(was, 1e-6) * Math.max(now, 1e-6));
      // A lunge into a shot, a hard stop, or a sharp change of direction squeaks.
      if (p.lunge <= dt + 1e-9 || (was > 1.6 && (now < was * 0.6 || (now > 0.8 && turn < 0.5)))) { this.events.push({ type: 'squeak', pan, near }); f.cd = 0.35; }
    }
    // A footstep every half stride while running.
    if (!p.airborne && now > 1.2 && Math.floor(p.stride / Math.PI) !== Math.floor(f.stride / Math.PI)) this.events.push({ type: 'step', pan, near });
    f.vx = p.vel.x; f.vy = p.vel.y; f.stride = p.stride;
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

  /** Run by another screen (a person elsewhere, or the host's CPU)? */
  private remote(i: number): boolean { return this.controllers[i] instanceof RemoteController; }

  /** This screen's player index for a lineup slot: you are 0, your partner 2, the other team 1 and 3. */
  private local(g: number): number {
    const me = this.online?.me ?? 0;
    return g === me ? 0 : g % 2 === me % 2 ? 2 : g < 2 ? 1 : 3;
  }

  /** The lineup slot of this screen's player i. */
  private slotOf(i: number): number {
    for (let g = 0; g < 4; g++) if (this.local(g) === i) return g;
    return i;
  }

  /** A team numbered from the host's side, as this screen numbers it (0 = your team). */
  private teamHere(t: 0 | 1): 0 | 1 { return (this.myTeam === 0 ? t : 1 - t) as 0 | 1; }

  private get mySeat(): Seat | undefined {
    const o = this.online;
    return o?.lineup ? o.lineup[o.me ?? 0].seat ?? undefined : o ? (o.host ? 'host' : 'guest') : undefined;
  }

  /** The team (numbered from the host's side) of a seat in the room. */
  private teamOfSeat(seat: Seat | undefined): 0 | 1 {
    const L = this.online?.lineup;
    if (!L) return seat === 'host' ? 0 : seat ? 1 : (1 - this.myTeam) as 0 | 1;
    const g = L.findIndex((s) => s.seat === seat);
    return g >= 0 ? (g % 2) as 0 | 1 : (1 - this.myTeam) as 0 | 1;
  }

  /** This screen's player index for whoever is in a seat (singles: the opponent). */
  private localOfSeat(seat: Seat | undefined): number {
    const L = this.online?.lineup;
    if (!L) return 1;
    const g = L.findIndex((s) => s.seat === seat);
    return g >= 0 ? this.local(g) : 1;
  }

  /** A name for whoever is in a seat. */
  nameOfSeat(seat: string | undefined): string {
    return seat === 'self' ? 'You' : this.players[this.localOfSeat(seat as Seat)].name;
  }

  /** Messages come in the sender's view: turned round when they're on the other team. */
  private turned(m: { from?: Seat }): boolean { return this.teamOfSeat(m.from) !== this.myTeam; }
  private view2(m: { from?: Seat }, x: number, y: number): V2 { return this.turned(m) ? flip2(x, y) : { x, y }; }
  private view3(m: { from?: Seat }, a: [number, number, number]): V3 { return this.turned(m) ? flip3(a) : { x: a[0], y: a[1], z: a[2] }; }

  /**
   * Whose screen decides a shuttle landing on this side (0 = yours): the host for its own team and for
   * a team of CPUs, otherwise that team's first person in the lineup. In singles, each screen its own side.
   */
  private ownsSide(t: 0 | 1): boolean {
    const o = this.online!, team = t === 0 ? this.myTeam : (1 - this.myTeam) as 0 | 1;
    if (!o.lineup) return t === 0;
    const owner = team === 0 ? 'host' : o.lineup[1].seat ?? o.lineup[3].seat ?? 'host';
    return owner === this.mySeat;
  }

  /** Doubles: who is in each team's right service court, as lineup slots in host-side team order. */
  private rightSlots(): [number, number] {
    const r = this.match.right;
    return [this.slotOf(r[this.teamHere(0)]), this.slotOf(r[this.teamHere(1)])];
  }

  /** Host, online doubles: who is in the right courts, for the point message. */
  private rightField(): { right?: [number, number] } { return this.online?.lineup ? { right: this.rightSlots() } : {}; }

  private setRightSlots(slots: [number, number] | undefined) {
    if (!slots || !this.online?.lineup) return;
    this.match.right[this.teamHere(0)] = this.local(slots[0]);
    this.match.right[this.teamHere(1)] = this.local(slots[1]);
  }

  /**
   * Tell the other screens where you are (ONLINE.posRate times a second, only when something changed).
   * The host also sends where its CPUs are, in the same message.
   */
  private sendPos(dt: number, cmds: Command[]) {
    cmds.forEach((c, i) => { if (c.jump) this.jumped[i] = true; });
    this.posT += dt;
    if (this.posT < PHYSICS.gameSpeed / ONLINE.posRate) return;
    this.posT = 0;
    if (this.state !== 'rally' && this.state !== 'wait') return;
    const r = (n: number) => Math.round(n * 100) / 100;
    const p = this.players[0];
    const msg: Extract<GameMsg, { type: 'pos' }> = { type: 'pos', x: r(p.pos.x), y: r(p.pos.y), z: r(p.z), vx: r(p.vel.x), vy: r(p.vel.y), charge: p.charge === null ? null : r(p.charge), jump: this.jumped[0] };
    if (this.online!.lineup && this.online!.host) {
      msg.bots = [];
      this.players.forEach((b, i) => {
        if (i === 0 || this.remote(i)) return;
        msg.bots!.push({ g: this.slotOf(i), x: r(b.pos.x), y: r(b.pos.y), z: r(b.z), charge: b.charge === null ? null : r(b.charge), jump: this.jumped[i] });
      });
    }
    const key = JSON.stringify([msg.x, msg.y, msg.z, msg.charge, msg.jump, msg.bots]);
    if (key === this.lastSentPos) return;
    this.lastSentPos = key;
    this.jumped = [false, false, false, false];
    this.online!.conn.send(msg);
  }

  /** A hit on this screen (yours, or one of the host's CPUs) for everyone else. */
  private sendHit(i: number, p: V3, v: V3, label: string, kmh: number, hand: string, detail: string, serve: boolean) {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const g = this.slotOf(i);
    const extra = this.online!.lineup ? { g, n: this.rallyHits } : {};
    this.lastHit = { n: this.rallyHits, g };
    this.catchUp = 0;
    this.online!.conn.send({ type: 'hit', p: [r(p.x), r(p.y), r(p.z)], v: [r(v.x), r(v.y), r(v.z)], label, kmh: Math.round(kmh), hand, detail, serve, ...extra });
  }

  /** The shuttle reached the floor on this screen. The screen that owns that side knows nobody there hit it. */
  private onlineLanding(land: V2) {
    const o = this.online!, sh = this.shuttle;
    if (!this.ownsSide(land.y < 0 ? 0 : 1)) { this.state = 'wait'; return; }
    if (o.host) this.endRally(land);
    // Sent in this screen's view, like every message: the host turns it round if it needs to.
    else { o.conn.send({ type: 'land', p: [land.x, land.y], net: sh.touchedNet, wide: sh.wide }); this.state = 'wait'; }
  }

  private onNet(m: GameMsg | ServerMsg) {
    const o = this.online!;
    switch (m.type) {
      case 'pos': {
        const c = this.controllers[this.localOfSeat(m.from)];
        if (c instanceof RemoteController) c.update(this.view2(m, m.x, m.y), m.charge, m.jump);
        for (const b of m.bots ?? []) {
          const bc = this.controllers[this.local(b.g)];
          if (bc instanceof RemoteController) bc.update(this.view2(m, b.x, b.y), b.charge, b.jump);
        }
        break;
      }
      case 'hit': this.applyRemoteHit(m); break;
      case 'land': {
        // Host only: the screen that owns a side says the shuttle landed there untouched.
        if (!o.host || (this.state !== 'rally' && this.state !== 'wait')) break;
        const sh = this.shuttle, p = this.view2(m, m.p[0], m.p[1]);
        sh.touchedNet ||= m.net;
        sh.wide ||= m.wide;
        sh.pos = { x: p.x, y: p.y, z: 0 };
        sh.inFlight = false;
        this.endRally(p);
        break;
      }
      case 'point':
        if (o.host) break;
        // A verdict sent again (after a sync) that already arrived: don't count it twice.
        if (m.n !== undefined) { if (m.n <= this.pointN) break; this.pointN = m.n; }
        this.applyRemotePoint(m);
        break;
      // Host: someone is still waiting on a rally. If it's still going here, this screen will decide it.
      // If they've missed a verdict, send it again; if they have every verdict, the rally they're waiting
      // on never reached this screen (its serve got lost), so it's replayed from the serve.
      case 'sync':
        if (!o.host || this.state === 'rally' || this.state === 'wait') break;
        if (this.lastPointMsg && (m.n === undefined || m.n < this.pointN)) o.conn.send(this.lastPointMsg);
        else if (this.state === 'serve') o.conn.send({ type: 'resync', scores: [...this.match.scores], games: [...this.match.games], server: this.match.server });
        break;
      case 'resync': {
        if (o.host || (this.state !== 'wait' && this.state !== 'rally')) break;
        // Back to the serve, at the host's score.
        const flip = <T,>(a: [T, T]): [T, T] => (this.myTeam === 0 ? [a[0], a[1]] : [a[1], a[0]]);
        this.match.scores = flip(m.scores);
        this.match.games = flip(m.games);
        this.match.server = this.teamHere(m.server);
        this.shuttle.inFlight = false;
        this.predicted = null;
        this.banner = { title: 'Let — replay the point', sub: 'That rally got lost in a connection blip', color: VISUAL.colors.hud, t: 0, ttl: 2.5 };
        this.startServe();
        break;
      }
      // Host only: whoever was serving ran out their shot clock.
      case 'delay': {
        const i = this.localOfSeat(m.from);
        if (o.host && this.state === 'serve' && this.match.serverIdx() === i) this.redCard(this.teamOf(i));
        break;
      }
      case 'challenge':
        // Someone on the side the call went against asked for Hawk-Eye.
        if (this.state === 'replay') this.endReplay();
        if (this.call && !this.call.challenged && (this.state === 'point' || this.state === 'serve')) this.startChallenge(this.turned(m) ? 1 : 0);
        break;
      case 'review':
        if (!o.host) {
          this.match.scores = [m.scores[this.teamHere(0)], m.scores[this.teamHere(1)]];
          this.match.games = [m.games[this.teamHere(0)], m.games[this.teamHere(1)]];
          this.setRightSlots(m.right);
        }
        break;
      case 'chat': {
        // Hidden in settings, or more than one every 3 seconds from the same player (an old page): ignore.
        const now = this.stats.seconds, k = m.from ?? 'host';
        if (!CHAT[m.i] || this.settings.hideChat || now - (this.chatHeard.get(k) ?? -99) < 2.5) break;
        this.chatHeard.set(k, now);
        this.shout(this.players[this.localOfSeat(m.from)], CHAT[m.i], 2.5);
        break;
      }
      case 'pause':
        if (m.from) { if (m.on) this.pausedBy.add(m.from); else this.pausedBy.delete(m.from); }
        // Their pause ran out of time: it ends for everyone.
        if (!m.on && m.all) { this.pauseMine = false; this.pausedBy.clear(); }
        this.syncPause();
        break;
      case 'forfeit': this.winByForfeit(this.turned(m) ? 1 : 0); break;
      case 'peer': {
        const who = m.self ? 'self' : m.seat ?? 'peer';
        if (m.status === 'away') { if (!this.away.has(who)) this.away.set(who, performance.now()); }
        else if (m.status === 'back') this.away.delete(who);
        else this.winByForfeit(this.teamOfSeat(m.seat) === this.myTeam ? 0 : 1);
        this.syncAway();
        break;
      }
    }
  }

  /**
   * A rally can't stay unfinished: if a message went missing in a connection blip, the two screens may
   * each think the other one decides. After a moment the host decides from its own screen; anyone else
   * asks the host to send its verdict again.
   */
  private waitWatchdog(real: number) {
    const o = this.online;
    if (!o) return;
    this.waitT += real;
    if (o.host) {
      if (this.waitT > ONLINE.waitMax) { const p = this.shuttle.pos; this.endRally({ x: p.x, y: p.y }); }
    } else if (this.waitT > ONLINE.waitMax + 1.5 && (this.syncT -= real) <= 0) {
      this.syncT = 2;
      o.conn.send({ type: 'sync', n: this.pointN });
    }
  }

  /**
   * Pause for a dropped connection only once it has been gone a few seconds: short blips just carry on
   * (their messages are held and arrive when the connection is back).
   */
  private syncAway() {
    const now = performance.now();
    this.peerAway = [...this.away.values()].some((t) => now - t > ONLINE.awayGrace * 1000);
  }

  /** Someone's connection was already down when this match (re)started here. */
  markAway(seat: string) { if (!this.away.has(seat)) this.away.set(seat, performance.now() - ONLINE.awayGrace * 1000 - 1); this.syncAway(); }

  /** Whose connection is down, for the "disconnected" screen. */
  get awayName(): string {
    const who = [...this.away.keys()][0];
    return who === 'peer' ? this.players[1].name : this.nameOfSeat(who);
  }

  /** Someone on another screen hit the shuttle (or served): a person, or one of the host's CPUs. */
  private applyRemoteHit(m: Extract<GameMsg, { type: 'hit' }>) {
    const doublesOnline = !!this.online!.lineup;
    if (this.state === 'replay') this.endReplay();
    // Still in the pause after the last point here: catch up to their serve.
    if (m.serve) for (let k = 0; k < 4 && this.state !== 'serve' && this.state !== 'matchOver'; k++) this.advance();
    if (this.state === 'matchOver') return;
    if (doublesOnline && !m.serve) {
      // Too late: this rally is already over here.
      if (this.state !== 'rally' && this.state !== 'wait') return;
      // Two teammates hit the same shuttle on their own screens: the lower lineup slot's hit stands
      // everywhere (so each screen keeps or swaps to the same one).
      if (m.n !== undefined && m.g !== undefined) {
        if (m.n < this.lastHit.n || (m.n === this.lastHit.n && m.g > this.lastHit.g)) return;
        this.rallyHits = m.n - 1;
      }
    }
    const hi = doublesOnline && m.g !== undefined ? this.local(m.g) : 1;
    const hitter = this.players[hi], sh = this.shuttle;
    const pos = this.view3(m, m.p), vel = this.view3(m, m.v);
    if (this.state === 'serve') {
      this.serveBox = serviceBox(-hitter.side as Side, this.match.serverInRightCourt(), this.doublesCourt);
      for (const p of this.players) { p.frozen = false; p.serving = null; }
      this.recorder.reset();
      this.rallyHits = 0;
    }
    // Mid-rally, this screen's shuttle has drifted from where they really hit it: draw it gliding
    // onto the true path rather than jumping (the physics uses the true path straight away).
    const drawnFrom = this.state === 'rally' || this.state === 'wait' ? { ...sh.pos } : null;
    this.state = 'rally';
    this.acc = 0;
    sh.launch(pos, vel, hitter.side, m.serve);
    if (drawnFrom && Math.hypot(drawnFrom.x - pos.x, drawnFrom.y - pos.y, drawnFrom.z - pos.z) < 3) {
      this.drawOffset = { x: drawnFrom.x - pos.x, y: drawnFrom.y - pos.y, z: drawnFrom.z - pos.z };
      this.drawOffsetT = 0;
    }
    sh.trail = [];
    this.predict();
    // The message took about one trip to get here: make that up by playing this shot a little fast.
    this.catchUp = Math.min(ONLINE.catchUpMax, this.online!.conn.latency / 1000 * PHYSICS.gameSpeed);
    sh.tumbling = /tumbling/.test(m.label);
    this.liftGuard = /Lift/.test(m.label) ? SHOTS.liftGuard : 0;
    hitter.onHit(pos, m.serve);
    for (const p of this.players) if (p.side !== hitter.side) p.splitStep();
    this.rallyHits++;
    this.lastHit = { n: this.rallyHits, g: m.g ?? -1 };
    this.lastContact = null;
    const hand = m.serve ? 'serve' : (m.hand as Contact['hand']);
    this.lastShot = { label: m.label, hand, netCord: false };
    this.lastHitterId = hitter.id;
    this.stats.shots.push({ by: this.teamOf(hi), pid: hitter.id, label: m.label, speedKmh: m.kmh, hand, landing: this.predicted });
    this.announce(hitter, { velocity: vel, label: m.label, speedKmh: m.kmh }, m.detail || null);
    this.events.push({ type: 'hit', strength: m.serve ? 0.3 : Math.min(1, m.kmh / 300) });
    // Same notice a local hit gives (only the timing details of their contact aren't known here).
    const contact: Contact = { point: pos, side: hitter.side, hand: hand === 'serve' ? 'forehand' : hand, airborne: false, timing: 1, timingLabel: 'Perfect', timingError: 0, stretch: 0, apex: false, behind: 0 };
    this.observe({ type: 'hit', by: hitter.side, contact, label: m.label, landing: this.predicted, hitter });
  }

  /** Not the host: the host's verdict on the rally. */
  private applyRemotePoint(m: Extract<GameMsg, { type: 'point' }>) {
    const winner = this.teamHere(m.winner), sh = this.shuttle;
    const land = m.land ? this.view2(m, m.land[0], m.land[1]) : null;
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
    // The host's line call, in this screen's view (so it can be challenged and reviewed here too).
    this.call = null;
    if (m.call && land) {
      const r = m.call.rect, rect = this.turned(m) ? { xMin: -r.xMax, xMax: -r.xMin, yMin: -r.yMax, yMax: -r.yMin } : { ...r };
      const judge = judgeFor(this.officials, land, rect);
      this.call = { landing: land, rect, signed: m.call.signed, truthIn: m.call.truthIn, callIn: m.call.callIn, hitter: this.teamHere(m.call.hitter), isServe: m.call.isServe, challenged: false, judge };
      if (judge) { judge.signal = m.call.callIn ? 'in' : 'out'; judge.signalT = 0; }
    }
    this.landing = land ? { p: land, call: m.callIn === null ? null : m.callIn ? 'IN' : 'OUT', t: 0 } : null;
    if (m.callIn === false) this.say('line', 'Out!');
    this.longestRally = Math.max(this.longestRally, this.rallyHits);
    // A red card is given to whoever was serving (worked out before the point moves the serve on).
    const late = this.players[this.match.serverIdx()];
    this.snap = this.match.snapshot();
    this.prevServer = this.match.server;
    this.outcome = this.awardPoint(winner);
    // The host's score is the real one: line up with it if anything drifted.
    this.match.scores = [m.scores[this.teamHere(0)], m.scores[this.teamHere(1)]];
    this.match.games = [m.games[this.teamHere(0)], m.games[this.teamHere(1)]];
    this.setRightSlots(m.right);
    this.banner = { title: m.title, sub: `${m.why ? `${m.why} · ` : ''}Point ${this.teamName(winner)}`, color: this.teamColor(winner), t: 0 };
    if (/^Red card/.test(m.title)) {
      this.banner = { ...this.banner, sub: `${late.name} took more than ${OFFICIALS.shotClock} seconds to serve · Point ${this.teamName(winner)}`, color: VISUAL.colors.callOut, card: 'red' };
      this.say('umpire', `${late.voiceName}, red card, delay of service.`, true);
    }
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
    this.clock = OFFICIALS.shotClock;
    this.clockRunning = true;
  }

  /** Online: seconds until the server may serve (0 once they can). */
  get serveCountdown(): number { return this.state === 'serve' ? Math.max(0, this.timer) : 0; }

  /** Someone left or gave up: their team retires (loser = 1, the other team, or 0, yours). */
  private winByForfeit(loser: 0 | 1 = 1) {
    if (this.state === 'matchOver') return;
    this.forfeitWinner = (1 - loser) as 0 | 1;
    this.away.clear();
    this.peerAway = false;
    this.endOnlinePause(false);
    this.state = 'matchOver';
    this.onMatchOver?.(this);
    this.banner = null;
    this.stats.finish();
    this.say('umpire', `${this.teamVoice(loser)} retired. Match won by ${loser === 1 ? this.teamVoice(0) : this.teamVoice(1)}.`, true);
  }

  /** Quick chat (online): a preset line over your head and on everyone's screen. */
  sendChat(i: number) {
    // One message every 3 seconds, so nobody can spam the other screen.
    if (!this.online || !CHAT[i] || this.stats.seconds - this.lastChat < 3) return;
    this.lastChat = this.stats.seconds;
    this.shout(this.players[0], CHAT[i], 2.5);
    this.online.conn.send({ type: 'chat', i });
  }

  /** Online pause (Esc): only between points, so every screen stops in the same place. */
  setOnlinePause(on: boolean): boolean {
    if (!this.online) return false;
    if (on && (this.state === 'rally' || this.state === 'wait')) {
      this.banner = { title: 'Pause between points', sub: 'You can pause once this rally is over', color: VISUAL.colors.hud, t: 0, ttl: 2.5 };
      return false;
    }
    this.pauseMine = on;
    this.online.conn.send({ type: 'pause', on });
    this.syncPause();
    return true;
  }

  /** Seconds left before an online pause ends on its own. */
  get pauseLeft(): number {
    return this.pauseSince === null ? ONLINE.pauseMax : ONLINE.pauseMax - (performance.now() - this.pauseSince) / 1000;
  }

  /** Who else has the game paused, by name. */
  get pausers(): string { return [...this.pausedBy].map((s) => this.nameOfSeat(s)).join(' and '); }

  private syncPause() {
    const was = this.paused;
    this.paused = this.pauseMine || this.pauseTheirs;
    if (this.paused && !was) this.pauseSince = performance.now();
    if (!this.paused) this.pauseSince = null;
  }

  /** The pause ran out of time (timeUp) or the match ended: everyone plays on. */
  private endOnlinePause(timeUp: boolean) {
    this.pauseMine = false;
    this.pausedBy.clear();
    this.syncPause();
    if (timeUp) {
      this.online?.conn.send({ type: 'pause', on: false, all: true });
      this.banner = { title: 'Play on', sub: `Pauses last at most ${ONLINE.pauseMax / 60 === 1 ? 'a minute' : `${ONLINE.pauseMax} seconds`}`, color: VISUAL.colors.hud, t: 0, ttl: 2.5 };
    }
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
      assist: p.assisted,
    };
  }
}
