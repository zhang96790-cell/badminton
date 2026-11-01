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
  idealDelay: 0.11,
  perfectTolerance: 0.05,
  /** Timing error beyond the tolerance at which quality bottoms out. */
  falloff: 0.17,
  minQuality: 0.45,
  /** Lockout after a whiff. */
  recovery: 0.18,
  /** Mouse mode: hold time to reach full power. */
  chargeTime: 0.5,
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
  liftAngle: 50,
  /**
   * Mouse mode. Left click: tap = drive (this fraction of full pace), hold to smashPower charge = full smash.
   * Right click: release before dropMaxPower charge = drop, hold longer = lob (flat → high the longer you hold).
   * Drops land no deeper than dropMaxDepth past the net, lobs no shorter than lobMinDepth, wherever the cursor is.
   */
  mouse: { drivePace: 0.65, smashPower: 0.85, driveMinDepth: 1.2, dropMaxPower: 0.35, dropMaxDepth: 3.0, lobMinDepth: 4.8 },
  /** Mouse lob: just past the drop threshold = flat attacking lob, full charge = high defensive lob. */
  mouseHighAngleMin: 20,
  mouseHighAngleMax: 52,
  /** Soft shots: how far above the tape they aim to pass (m). */
  dropClearance: 0.4,
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
  depth: { high: 5.7, smash: 4.2, drive: 5.0, kill: 3.2, push: 4.6, drop: 2.6, netShot: 0.9, block: 2.2 },
  /** Holding toward the opponent at contact = deeper, away = shorter. */
  depthToward: 1.1,
  depthAway: -1.0,
  /** Holding left/right at contact aims this far from the centre line. */
  aimLateral: 2.0,
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
};

export interface ScoringFormat { pointsToWin: number; winBy: number; pointCap: number; intervalAt: number }

export const RULES = {
  /** Picked on the menu. Interval when the leading score first reaches intervalAt. */
  formats: {
    15: { pointsToWin: 15, winBy: 2, pointCap: 21, intervalAt: 8 },
    21: { pointsToWin: 21, winBy: 2, pointCap: 30, intervalAt: 11 },
  } as Record<15 | 21, ScoringFormat>,
  pointPause: 1.8,
  /** Extra pause after a line call the human could challenge. */
  challengeWindow: 1.4,
  intervalPause: 4,
  gameBreak: 5,
};

export const OFFICIALS = {
  /** Line judges can miscall shuttles landing within this distance (m) of the line... */
  errorBand: 0.05,
  /** ...with this chance right on the edge, falling to zero at the edge of the band. */
  maxErrorChance: 0.3,
  /** You're offered a challenge only when the shuttle landed this close to a line (m). */
  challengeRange: 0.35,
  /** Unsuccessful challenges allowed per game (successful ones are kept). */
  challengesPerGame: 2,
  /** Seconds from the end of a rally to the next serve before the umpire warns, then faults, the server. */
  shotClock: 25,
  shotClockAfterWarning: 10,
};

export const REPLAY = {
  speed: 0.5,
  /** The last moments before the shuttle lands play even slower. */
  finalSlowmo: 0.25,
  finalSeconds: 0.9,
  /** Keep at most this much of a rally (game seconds). */
  maxSeconds: 60,
  /** Automatic replays show only the end of the rally. */
  autoSeconds: 4.5,
  /** Rallies at least this long get an automatic replay (as do jump-smash winners and very close calls)... */
  autoMinRally: 14,
  /** ...but at most one automatic replay every this many points. */
  autoCooldown: 5,
};

export type Level = 'easy' | 'medium' | 'hard' | 'expert';

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

export type Style = 'allround' | 'attacker' | 'defender' | 'net';

/** CPU personalities: multipliers on shot preferences plus where they like to stand. */
export const STYLES: Record<Style, {
  label: string; smash: number; drop: number; clear: number; net: number; kill: number; jump: number;
  baseDepth: number; margin: number; speed: number; serveShort: number;
}> = {
  allround: { label: 'All-rounder', smash: 1, drop: 1, clear: 1, net: 1, kill: 1, jump: 1, baseDepth: 3.5, margin: 0, speed: 1, serveShort: 1 },
  attacker: { label: 'Attacker', smash: 1.8, drop: 0.9, clear: 0.6, net: 0.8, kill: 1.3, jump: 1.6, baseDepth: 3.3, margin: -0.05, speed: 1, serveShort: 0.9 },
  defender: { label: 'Defender', smash: 0.5, drop: 0.8, clear: 1.7, net: 0.9, kill: 0.8, jump: 0.5, baseDepth: 3.8, margin: 0.15, speed: 1.05, serveShort: 0.8 },
  net: { label: 'Net player', smash: 0.9, drop: 1.5, clear: 0.8, net: 1.8, kill: 1.5, jump: 0.8, baseDepth: 3.0, margin: 0.05, speed: 1, serveShort: 1.2 },
};

export interface KeyMap {
  up: string[]; down: string[]; left: string[]; right: string[];
  high: string[]; fast: string[]; soft: string[]; jump: string[];
  /** Instant full-power flat/downward shot (net kill at the net, smash overhead). */
  kill: string[];
}

const WASD = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] };

export const KEYS: Record<'solo' | 'p1Shared' | 'p2Shared' | 'mouse', KeyMap> = {
  /** One player on the keyboard. E works as kill too (same as K: full power). */
  solo: { ...WASD, high: ['KeyJ'], fast: ['KeyK', 'KeyE'], soft: ['KeyL'], jump: ['Space'], kill: [] },
  /** Player 1 sharing the keyboard. */
  p1Shared: { ...WASD, high: ['KeyC'], fast: ['KeyV'], soft: ['KeyB'], jump: ['Space'], kill: [] },
  /** Player 2 sharing the keyboard. */
  p2Shared: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    high: ['KeyJ'], fast: ['KeyK'], soft: ['KeyL'], jump: ['ShiftRight', 'Slash'], kill: [],
  },
  /** Mouse mode: keyboard moves, mouse aims and hits. */
  mouse: { ...WASD, high: [], fast: [], soft: [], jump: ['Space'], kill: ['KeyE'] },
};

/** Keys that work in every control mode. */
export const UI_KEYS = {
  challenge: ['KeyH'],
  replay: ['KeyR'],
  replayCamera: ['KeyV'],
  guides: ['KeyG'],
  mute: ['KeyM'],
};

export const CAMERA = {
  /** TV-broadcast position: high behind the near baseline. */
  broadcast: { pos: { x: 0, y: -14.2, z: 8.6 }, target: { x: 0, y: 0.8, z: 0.3 } },
  /** Closer, lower broadcast view: the court fills more of the screen. */
  close: { pos: { x: 0, y: -11.6, z: 6.4 }, target: { x: 0, y: 0.4, z: 0.6 } },
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
   * Landing marker is deliberately rough so it doesn't give away line calls: its centre is off by a
   * random amount (std-dev, m) each shot, and it's drawn as a wide ring.
   */
  markerError: 0.3,
  markerRadius: 0.55,
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
