// Every tunable number lives here so the game can be balanced without hunting through code.
// Units: metres, seconds (game time), metres/second, degrees for angles.
// Court axes: x = across the court (screen left/right), y = along the court
// (net at y = 0, near player on y < 0), z = height above the floor.

export const PHYSICS = {
  gravity: 9.81,
  /** Shuttle terminal velocity (m/s). Drag accel = g·(v/vt)², so LOWER = MORE drag. Real feather shuttles ≈ 6.7–6.9. */
  terminalVelocity: 6.8,
  /** Global time scale. 1 = real time. Lower makes 300 km/h smashes readable on a laptop. */
  gameSpeed: 0.8,
  /** Fixed physics step (game seconds). */
  dt: 1 / 240,
  /** Coarser step used by the shot solver. */
  solverDt: 1 / 120,
  /** A shuttle clipping the tape by less than this (m) trickles over instead of being stopped. */
  netCordTolerance: 0.03,
  /** How quickly the shuttle flips back to cork-first after being hit (1/s). */
  turnoverRate: 28,
};

export const COURT = {
  halfLength: 6.7,
  singlesHalfWidth: 2.59,
  doublesHalfWidth: 3.05,
  /** Distances from the net, to the line edges as the Laws measure them. */
  shortServiceLine: 1.98,
  doublesLongServiceLine: 5.94,
  netHeightPost: 1.55,
  netHeightCentre: 1.524,
  netBottom: 0.79,
  postX: 3.05,
  lineWidth: 0.04,
  /** Radius of the cork's footprint. Any part touching the line is in. */
  footprint: 0.013,
};

export const PLAYER = {
  maxSpeed: 5.0,
  accel: 30,
  /** Braking when you let go or change direction. High = little drift. */
  decel: 70,
  /** Fraction of ground acceleration available while airborne. */
  airControl: 0.02,
  /** Share of your running speed carried into a jump (low = jumps go up, not across the court). */
  jumpCarry: 0.15,
  /** Braking in the air when you let go or push the other way (m/s²). */
  airBrake: 25,
  /** Speed multiplier while a swing is live. */
  swingMoveFactor: 0.55,
  /** Horizontal distance from body centre the racket can reach (arm + racket + lean). */
  reach: 1.15,
  /** Extra reach for human players, so near misses become (stretched) hits. */
  humanExtraReach: 0.1,
  /** Lunging adds reach for low shuttles, then slows you while you recover. */
  lungeReach: 0.25,
  lungeMaxZ: 1.2,
  lungeTime: 0.4,
  lungeRecoverySpeed: 0.6,
  reachMinZ: 0.08,
  /** Highest contact standing flat-footed. Jumping adds the jump height. */
  reachMaxZ: 2.75,
  /** Initial vertical speed of a jump: 3.0 m/s ≈ 0.46 m high, 0.6 s in the air. */
  jumpSpeed: 3.0,
  landingLag: 0.12,
  /** After landing a jump smash: no landing slowdown, and a short burst of extra speed to recover. */
  jumpSmashBoostTime: 0.6,
  jumpSmashBoostSpeed: 1.15,
  jumpSmashBoostAccel: 1.2,
  /** Split-step: an automatic little hop as the opponent hits, then a short burst of extra acceleration. */
  splitStepTime: 0.14,
  splitBoost: 1.35,
  splitBoostTime: 0.3,
  /** Ready position, distance from the net. */
  baseDepth: 3.5,
  handedness: 'right' as 'right' | 'left',
  /** How far past the lines players can run. */
  runOffBehind: 1.2,
  runOffWide: 0.9,
};

export const SWING = {
  /** How long a swing stays live looking for the shuttle. */
  window: 0.34,
  /** Press-to-contact time for a perfectly timed hit. */
  idealDelay: 0.14,
  perfectTolerance: 0.08,
  /** Timing error beyond the tolerance at which quality bottoms out. */
  falloff: 0.24,
  minQuality: 0.55,
  /**
   * Swings are a commitment: after a miss you can't swing again for this long, and after a hit for
   * hitRecovery. A player's click during recovery isn't lost: it swings the moment recovery ends.
   */
  recovery: 0.25,
  hitRecovery: 0.45,
  /** Mouse mode: hold time to reach full power. */
  chargeTime: 0.5,
  /** Keyboard fast key: hold time to reach its extra-power bonus. */
  keyChargeTime: 0.35,
  /** Keyboard fast key: a tap is full normal power; holding adds up to this much on top. */
  keyChargeBonus: 1.08,
};

export const SHOTS = {
  /** Max launch speed (m/s) by contact height (m). Linear between points. 85 m/s ≈ 306 km/h. */
  maxSpeedByHeight: [
    [0.3, 28],
    [1.2, 36],
    [1.8, 48],
    [2.2, 80],
    [2.5, 86],
  ] as [number, number][],
  /** Minimum speed budget for high shots, so lifts from the floor can still reach the back. */
  highSpeedFloor: 55,
  jumpSmashBonus: 1.1,
  /**
   * Perfect jump smash: hit at the top of the jump (vertical speed under apexSpeed) with the swing timed
   * within this window (s, much tighter than a normal Perfect) for this much extra pace on top.
   */
  perfectJump: { window: 0.035, apexSpeed: 1.0, bonus: 1.12 },
  overheadHeight: 2.0,
  lowHeight: 1.15,
  /** Contact closer than this to the net counts as a net-area shot. */
  nearNet: 2.3,
  backhandPower: 0.72,
  backhandNoise: 1.9,
  roundTheHeadPower: 0.92,
  roundTheHeadNoise: 1.25,
  /** Reaching beyond this fraction of max reach is a stretch. */
  stretchStart: 0.85,
  stretchPower: 0.85,
  stretchNoise: 1.5,
  /**
   * Aim error (std-dev, m) on a perfectly timed forehand. Longer and harder shots are less accurate:
   * base + perMetre·distance + perPower·(pace)^1.5, where pace is launch speed / 86 m/s.
   * Roughly: net shot 8 cm, drop 22 cm, clear 33 cm, full smash 40 cm. Timing, backhand and stretch multiply it.
   */
  aim: { base: 0.05, perMetre: 0.017, perPower: 0.2, depthFactor: 1.2 },
  /** Menu accuracy setting: multiplier on aim error for human players. */
  aimModes: { realistic: 1, casual: 0.55 },
  /** Random error in how far over the tape soft shots pass (std-dev, m), scaled like aim. */
  clearanceNoise: 0.035,
  speedNoise: 0.015,
  /** Launch angles (deg) for high shots, by contact zone. */
  clearAngle: 30,
  midHighAngle: 38,
  liftAngle: 57,
  /** Lifts played near the net launch at least this steep, so they climb out of reach of a player at the net. */
  netLiftAngle: 65,
  /**
   * Back court rewards. A perfectly timed clear goes at least clearDeep deep and straighter (noise × clearAim).
   * Hitting from deeper than deepFrom (m from the net) costs power and accuracy: a good clear pushes you back.
   * A perfectly timed smash from the back (deeper than 4 m, in front of you) gets only a small bonus.
   * A perfectly timed drop lands shorter (depth × perfectDrop).
   */
  backCourt: { clearDeep: 6.2, clearAim: 0.75, deepFrom: 5.6, deepPower: 0.88, deepNoise: 1.3, smashBonus: 1.03, perfectDrop: 0.8 },
  /**
   * Tumbling: only a perfectly timed net shot that crosses within margin (m) of the tape tumbles. Netting it
   * back or hitting it hard usually fails (lower clearance, more error, less power); lifting it is the way out.
   */
  tumble: { margin: 0.02, softClearance: -0.1, softNoise: 2.5, fastPower: 0.6, fastNoise: 2 },
  /** A hard overhead taken while the shuttle is still rising (faster upward than this, m/s) is only a drive, at this power. */
  rising: { speed: 0.4, power: 0.8 },
  /**
   * Hard shots at the net above the tape (net kills) play at this power; only just above the tape
   * (less than minAbove, m) they're a weaker push.
   */
  netKill: { power: 0.62, minAbove: 0.25, lowPower: 0.5 },
  /** Hard shots from within nearNet of the net and below the tape lose this much pace. */
  netDrivePower: 0.85,
  /** Disguised shots (Deceptive CPU): landing marker hidden for markerDelay, opponents slowed for wrongFoot (s). */
  disguise: { markerDelay: 0.32, wrongFoot: 0.16 },
  /** An overhead more than this far behind the body (m) is hit weaker (behindPower) and less accurately (behindNoise), whatever the shot. */
  behindLimit: 0.3,
  behindPower: 0.8,
  behindNoise: 1.5,
  /**
   * Mouse mode. Left click: tap = drive (this fraction of full pace), hold to smashPower charge = full smash.
   * Right click: release before dropMaxPower charge = drop, hold longer = lob (flat → high the longer you hold).
   * Drops land no deeper than dropMaxDepth past the net, lobs no shorter than lobMinDepth, wherever the cursor is.
   */
  mouse: { drivePace: 0.65, smashPower: 0.85, driveMinDepth: 1.2, dropMaxPower: 0.35, dropMaxDepth: 2.4, lobMinDepth: 5.2 },
  /** Mouse lob: just past the drop threshold = flat attacking lob, full charge = high defensive lob. */
  mouseHighAngleMin: 20,
  mouseHighAngleMax: 52,
  /** Soft shots: how far above the tape they aim to pass (m). */
  dropClearance: 0.28,
  netShotClearance: 0.06,
  blockClearance: 0.2,
  /** Soft shots can't float: highest launch angle (deg) by contact zone. Aim too tight and they land deeper instead. */
  softMaxAngle: { overhead: 12, mid: 30, low: 45, net: 80 },
  softSpeedCap: 34,
  /** Fast shots that would clip the tape are steepened to clear it by this much... */
  netAssistMargin: 0.04,
  /** ...unless that sends them this far past the target, in which case they're hit softer instead. */
  netAssistMaxExtraDepth: 1.2,
  /** Full-power shots (kill key, full charge, keyboard fast) keep their pace and accept landing this much deeper. */
  netAssistMaxExtraDepthHard: 2.0,
  /** Targets are kept at least this far past the net. */
  minTargetDepth: 0.4,
  /** Keyboard / AI default target, as distance past the net on the opponent's side. */
  depth: { high: 5.9, lift: 6.2, smash: 4.2, drive: 5.0, kill: 3.2, push: 4.6, drop: 2.1, netShot: 0.9, block: 2.2 },
  /** Holding toward the opponent at contact = deeper, away = shorter. */
  depthToward: 1.1,
  depthAway: -1.0,
  /** Holding left/right at contact aims this far from the centre line (singles sideline is 2.59). */
  aimLateral: 1.65,
  /** Keyboard with no direction held: aim this far toward the open side, away from the opponent. */
  autoAimLateral: 1.3,
};

export const SERVE = {
  /** Contact height. Laws require < 1.15 m; the game keeps every serve legal. */
  contactHeight: 1.05,
  shortClearance: 0.12,
  shortDepth: 2.35,
  highAngle: 58,
  highDepth: 6.3,
  flickAngle: 30,
  flickDepth: 6.1,
  shortNoise: 0.1,
  longNoise: 0.25,
  speedCap: 60,
  serverDepth: 2.6,
  serverOffset: 0.5,
  receiverDepth: 3.3,
  receiverOffset: 0.7,
  /** Doubles: serve and receive close to the short service line; partners stand behind. */
  doubles: {
    serverDepth: 2.15,
    receiverDepth: 2.35,
    serverPartnerDepth: 3.9,
    receiverPartnerDepth: 4.0,
    partnerOffset: 0.35,
    /** Long serves aim this far inside the doubles long service line. */
    longMargin: 0.3,
  },
};

/**
 * Online lag hiding. A shot from the other player reaches you a little late, so it plays slightly
 * faster until it has caught up with where it really is: both screens then show the shuttle in about
 * the same place. After your shot, the shuttle on their half is only for show on your screen (theirs
 * decides what happens there), so near the floor it hovers just long enough for their reply to arrive.
 */
export const ONLINE = {
  /** Incoming shots play this much faster (0.3 = 30%) until they've made up the delay... */
  catchUpRate: 0.3,
  /** ...which is never counted as more than this (game seconds). */
  catchUpMax: 0.15,
  /** Hover below this height (m) while falling, for about one message's trip (hoverScale × the lag, plus hoverPad)... */
  hoverHeight: 0.35,
  hoverScale: 1.3,
  hoverPad: 0.02,
  /** ...but never longer than this (game seconds), at this fraction of normal speed. */
  hoverMax: 0.25,
  hoverRate: 0.08,
  /** Position updates sent per second. */
  posRate: 30,
  /** An online pause ends on its own after this long (s), even if someone hasn't resumed. */
  pauseMax: 60,
  /** When their hit arrives, the drawn shuttle glides onto its true path over this long (game seconds). */
  smoothTime: 0.12,
};

export const DOUBLES = {
  /** Side-by-side defence: each player covers a half, this far from the centre line, this deep. */
  defence: { x: 1.35, y: 3.6 },
  /** Front-and-back attack: the front player sits near the T, the back player covers the rear court. */
  attack: { frontY: 2.1, backY: 4.3 },
  /** How far a player shades toward the gap their partner leaves when pulled out of position. */
  coverShift: 0.45,
  /** Who takes the shuttle: the player with more time to spare, unless it's within this much (m) of even... */
  contested: 0.35,
  /** ...in which case the forehand side takes it (this much of a head start). */
  forehandBias: 0.12,
  /** Shot-choice bonus for aiming down the middle between two side-by-side defenders. */
  middleBonus: 0.35,
  /** Auto-switch control only swaps when the partner is this much better placed (m). */
  switchMargin: 0.4,
  /** Serving in doubles is mostly low; this fraction of the CPU's long serves are flicks. */
  flickShare: 0.75,
  shoutTime: 0.9,
  /** Partners are kept at least this far apart (m). */
  personalSpace: 0.7,
};

export interface ScoringFormat { pointsToWin: number; winBy: number; pointCap: number; intervalAt: number }

export const RULES = {
  /** Picked on the menu. Interval when the leading score first reaches intervalAt. */
  formats: {
    15: { pointsToWin: 15, winBy: 2, pointCap: 21, intervalAt: 8 },
    21: { pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11 },
  } as Record<15 | 21, ScoringFormat>,
  pointPause: 1.8,
  /**
   * Touching the net is a fault: a hard shot (kill, smash, drive, push) hit while standing within `within`
   * metres of the net always touches it. Never random, never for a gentle net shot.
   */
  netFault: { within: 0.35 },
  /** Online: after each point the server waits this long (s) before they can serve, so the receiver is ready. */
  onlineServeWait: 2.2,
  /** Extra pause after a line call the human could challenge. */
  challengeWindow: 1.4,
  intervalPause: 4,
  gameBreak: 5,
};

export const OFFICIALS = {
  /** Line judges can miscall shuttles landing within this distance (m) of the line... */
  errorBand: 0.12,
  /** ...with this chance right on the edge, falling to zero at the edge of the band. */
  maxErrorChance: 0.45,
  /**
   * CPU challenges: it judges the landing by eye with this much error (m) at zero skill, down to the
   * minimum at full skill. If the call looked wrong it challenges; if it was just tight (within
   * gambleBand of the line) it sometimes challenges anyway, more often when reckless or on a big point.
   */
  cpuEyeError: { min: 0.03, max: 0.1 },
  cpuGambleBand: 0.12,
  cpuGamble: { careful: 0.25, reckless: 0.6, bigPoint: 0.2 },
  /** You're offered a challenge only when the shuttle landed this close to a line (m). */
  challengeRange: 0.35,
  /** Unsuccessful challenges allowed per game (successful ones are kept). */
  challengesPerGame: 2,
  /** Seconds from the end of a rally to the next serve. Run out and the umpire shows the server a red card: point to the receiver. */
  shotClock: 25,
};

export const REPLAY = {
  /** Replay speeds T cycles through (the default is the second, half speed). */
  speeds: [1, 0.5, 0.25],
  /** The winning shot (its last moments before landing) plays at this fraction of the chosen speed. */
  finalSlowmo: 0.35,
  finalSeconds: 1.0,
  /** Saved highlights: the last this-many seconds of the rally, and at most this many kept. */
  highlightSeconds: 7,
  highlightsKept: 10,
  /** Keep at most this much of a rally (game seconds). */
  maxSeconds: 60,
  /** Automatic replays show only the end of the rally. */
  autoSeconds: 4.5,
  /** Rallies at least this long get an automatic replay (as do jump-smash winners and very close calls)... */
  autoMinRally: 14,
  /** ...but at most one automatic replay every this many points. */
  autoCooldown: 5,
};

export type Level = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert';

export interface AILevel {
  /** Seconds before reacting to a shot. */
  reaction: number;
  speed: number;
  /** Multiplier on shot power. */
  strength: number;
  /** Extra aim error (m) on top of the normal shot model. */
  aimNoise: number;
  timingError: number;
  /** How far inside the lines it aims (m), on top of the shot's own expected error... */
  margin: number;
  /** ...times this much of that expected error (higher = safer). */
  caution: number;
  /** How strongly it prefers its best option over the alternatives. */
  decisiveness: number;
  /** How much it reads your habits to shade its ready position (0–0.4). */
  anticipation: number;
  /** How much it targets areas where you've struggled (0–1). */
  adapt: number;
  smash: number;
  drop: number;
  net: number;
  kill: number;
  jumpSmash: number;
  judgesOut: boolean;
  /** Leaves shuttles predicted to land out by more than this (m). */
  outMargin: number;
  serveShort: number;
  serveDelay: number;
  /** How well it spots bad line calls (0–1). */
  challengeSkill: number;
}

export const AI: Record<Level, AILevel> = {
  // Slow, soft, safe: keeps rallies going so new players can learn.
  beginner: {
    reaction: 0.45, speed: 0.72, strength: 0.6, aimNoise: 0.2, timingError: 0.04, margin: 1.1, caution: 0.8,
    decisiveness: 0.4, anticipation: 0, adapt: 0, smash: 0.08, drop: 0.3, net: 0.4, kill: 0.2, jumpSmash: 0,
    judgesOut: false, outMargin: 0, serveShort: 0.3, serveDelay: 1.3, challengeSkill: 0.1,
  },
  easy: {
    reaction: 0.36, speed: 0.8, strength: 0.72, aimNoise: 0.35, timingError: 0.05, margin: 0.7, caution: 0.6,
    decisiveness: 0.6, anticipation: 0, adapt: 0, smash: 0.3, drop: 0.5, net: 0.6, kill: 0.5, jumpSmash: 0,
    judgesOut: false, outMargin: 0, serveShort: 0.4, serveDelay: 1.1, challengeSkill: 0.25,
  },
  medium: {
    reaction: 0.24, speed: 0.92, strength: 0.88, aimNoise: 0.15, timingError: 0.03, margin: 0.5, caution: 0.9,
    decisiveness: 1.2, anticipation: 0.12, adapt: 0.35, smash: 0.8, drop: 0.8, net: 0.9, kill: 1, jumpSmash: 0.2,
    judgesOut: true, outMargin: 0.25, serveShort: 0.6, serveDelay: 0.9, challengeSkill: 0.5,
  },
  hard: {
    reaction: 0.15, speed: 1.0, strength: 1.0, aimNoise: 0.05, timingError: 0.015, margin: 0.35, caution: 1.15,
    decisiveness: 2, anticipation: 0.25, adapt: 0.7, smash: 1.1, drop: 1, net: 1, kill: 1.3, jumpSmash: 0.45,
    judgesOut: true, outMargin: 0.08, serveShort: 0.75, serveDelay: 0.8, challengeSkill: 0.75,
  },
  expert: {
    reaction: 0.1, speed: 1.06, strength: 1.05, aimNoise: 0, timingError: 0.01, margin: 0.25, caution: 1.3,
    decisiveness: 3, anticipation: 0.35, adapt: 1, smash: 1.2, drop: 1.1, net: 1.1, kill: 1.5, jumpSmash: 0.6,
    judgesOut: true, outMargin: 0.04, serveShort: 0.8, serveDelay: 0.7, challengeSkill: 0.9,
  },
};

export type Style = 'allround' | 'attacker' | 'defender' | 'net' | 'deceptive' | 'retriever' | 'wall';

/** CPU personalities: multipliers on shot preferences plus where they like to stand. */
/**
 * CPU personalities: how often each shot is chosen, where it waits, how safe its targets are and how
 * fast it moves. reach: extra reach (m). deceive: chance a drop, net shot or flick is disguised (you
 * read it late: no landing marker at first, and a brief wrong-footed step). steady: multiplies its aim error.
 */
export const STYLES: Record<Style, {
  label: string; smash: number; drop: number; clear: number; net: number; kill: number; jump: number;
  baseDepth: number; margin: number; speed: number; serveShort: number; reach?: number; deceive?: number; steady?: number;
}> = {
  allround: { label: 'All-rounder', smash: 1, drop: 1, clear: 1, net: 1, kill: 1, jump: 1, baseDepth: 3.5, margin: 0, speed: 1, serveShort: 1 },
  attacker: { label: 'Attacker', smash: 1.8, drop: 0.9, clear: 0.6, net: 0.8, kill: 1.3, jump: 1.6, baseDepth: 3.3, margin: -0.05, speed: 1, serveShort: 0.9 },
  defender: { label: 'Defender', smash: 0.5, drop: 0.8, clear: 1.7, net: 0.9, kill: 0.8, jump: 0.5, baseDepth: 3.8, margin: 0.15, speed: 1.05, serveShort: 0.8 },
  net: { label: 'Net player', smash: 0.9, drop: 1.5, clear: 0.8, net: 1.8, kill: 1.5, jump: 0.8, baseDepth: 3.0, margin: 0.05, speed: 1, serveShort: 1.2 },
  deceptive: { label: 'Deceptive', smash: 1.1, drop: 1.7, clear: 0.9, net: 1.5, kill: 1.1, jump: 0.9, baseDepth: 3.4, margin: 0.05, speed: 1, serveShort: 1.1, deceive: 0.45 },
  retriever: { label: 'Fast retriever', smash: 0.7, drop: 0.9, clear: 1.3, net: 1.1, kill: 0.9, jump: 0.6, baseDepth: 3.6, margin: 0.12, speed: 1.14, serveShort: 0.9, reach: 0.14 },
  wall: { label: 'Defensive wall', smash: 0.3, drop: 0.6, clear: 2.3, net: 0.7, kill: 0.7, jump: 0.3, baseDepth: 4.0, margin: 0.25, speed: 1.06, serveShort: 0.7, reach: 0.07, steady: 0.6 },
};

export interface KeyMap {
  up: string[]; down: string[]; left: string[]; right: string[];
  high: string[]; fast: string[]; soft: string[]; jump: string[];
  /** Instant full-power flat/downward shot (net kill at the net, smash overhead). */
  kill: string[];
  /** Aim the next shot left / right (separate from movement). Neither = toward the open side. */
  aimLeft: string[];
  aimRight: string[];
}

const WASD = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] };

export const KEYS: Record<'solo' | 'p1Shared' | 'p2Shared' | 'mouse', KeyMap> = {
  /** One player on the keyboard. K charges while held (tap = drive, hold = smash); E = instant full power. */
  solo: { ...WASD, high: ['KeyJ'], fast: ['KeyK'], soft: ['KeyL'], jump: ['Space'], kill: ['KeyE'], aimLeft: ['KeyU'], aimRight: ['KeyO'] },
  /** Player 1 sharing the keyboard. */
  p1Shared: { ...WASD, high: ['KeyC'], fast: ['KeyV'], soft: ['KeyB'], jump: ['Space'], kill: [], aimLeft: ['KeyX'], aimRight: ['KeyN'] },
  /** Player 2 sharing the keyboard. */
  p2Shared: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    high: ['KeyJ'], fast: ['KeyK'], soft: ['KeyL'], jump: ['ShiftRight', 'Slash'], kill: [], aimLeft: ['KeyU'], aimRight: ['KeyO'],
  },
  /** Mouse mode: keyboard moves, mouse aims and hits. */
  mouse: { ...WASD, high: [], fast: [], soft: [], jump: ['Space'], kill: ['KeyE'], aimLeft: [], aimRight: [] },
};

/** Keys that work in every control mode. */
export const UI_KEYS = {
  challenge: ['KeyH'],
  replay: ['KeyR'],
  replayCamera: ['KeyV'],
  replaySpeed: ['KeyT'],
  saveHighlight: ['KeyP'],
  guides: ['KeyG'],
  mute: ['KeyM'],
};

export const CAMERA = {
  /** TV-broadcast position: high behind the near baseline. */
  broadcast: { pos: { x: 0, y: -14.2, z: 8.6 }, target: { x: 0, y: 0.8, z: 0.3 } },
  /** Closer, lower broadcast view: the court fills more of the screen. */
  close: { pos: { x: 0, y: -11.6, z: 6.4 }, target: { x: 0, y: 0.4, z: 0.6 } },
  /** Low, just behind and above your end, like a camera on the baseline. */
  player: { pos: { x: 0, y: -10.4, z: 3.3 }, target: { x: 0, y: 2.0, z: 0.9 } },
  /** High overhead, almost looking straight down: the easiest view for judging depth. */
  overhead: { pos: { x: 0, y: -4.2, z: 17 }, target: { x: 0, y: 0.2, z: 0 } },
  /** Side-on replay camera. */
  side: { pos: { x: 15.5, y: 0, z: 5.2 }, target: { x: 0, y: 0, z: 1.1 } },
};

export const ARENA = {
  crowdDensity: 0.72,
  boardTexts: ['FEATHER OPEN', 'SMASH', 'SHUTTLE CUP 2026', 'RALLY', 'CORK & FEATHER', 'PLAY FAIR'],
};

export const VISUAL = {
  /** Shuttle drawn this many times real size so it reads on a laptop screen. */
  shuttleScale: 2.6,
  /**
   * Landing marker: a small ring with a centre dot, just slightly off (random std-dev in m, per shot)
   * so it's a strong guide without settling line calls to the centimetre.
   */
  markerError: 0.08,
  markerRadius: 0.22,
  colors: {
    bgTop: '#070b12',
    bgBottom: '#111a26',
    floor: '#172230',
    surround: '#1d3b52',
    court: '#2f7a5c',
    courtLight: '#348464',
    alley: '#286a4f',
    line: '#f2f4ef',
    netFill: 'rgba(12,16,22,0.5)',
    netMesh: 'rgba(225,232,238,0.28)',
    tape: '#f2f4ef',
    post: '#cfd5dc',
    p1: '#ff6a4d',
    p2: '#4da3ff',
    /** Doubles partners: a close shade of their team colour. */
    p3: '#ffb347',
    p4: '#8f7bff',
    you: '#ffffff',
    skin: '#e6c3a2',
    hair: '#2a1d15',
    shorts: '#1c2431',
    sock: '#f1f3f5',
    shoe: '#e9ecef',
    racket: '#eef1f4',
    skirt: '#ffffff',
    cork: '#d6b088',
    shadow: 'rgba(0,0,0,0.32)',
    blazer: '#26344d',
    trousers: '#1a2130',
    chair: '#9aa3ae',
    standRiser: '#0e141d',
    standTread: '#151e2b',
    boards: ['#12314f', '#6d1d2b', '#1b4a37', '#3a2a5c'],
    crowd: ['#b8504a', '#3d6aa8', '#c9a64a', '#d8dbe0', '#4b8a64', '#7b58a0', '#c07440', '#56636f', '#2b2f36', '#9a3d5c'],
    hud: '#f2f4ef',
    hudDim: 'rgba(242,244,239,0.55)',
    panel: 'rgba(8,12,18,0.78)',
    accent: '#ffd166',
    callIn: '#5ee38f',
    callOut: '#ff5b5b',
  },
};
