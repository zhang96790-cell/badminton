import { COURT, SERVE } from './config';
import { netHeightAt } from './court';
import { DEG, clamp, lerp, pick, type V2, type V3 } from './math';
import { angleForSpeed, clearNetAngle, softShot, speedForAngle } from './solver';
import type { Game } from './game';

export type FeedType = 'liftBack' | 'liftMid' | 'net' | 'netLoose' | 'drive' | 'smash' | 'line'
  // Doubles drills
  | 'smashWide' | 'driveFlat' | 'lowServe' | 'flickServe';

/** place: where the drill puts you before this feed (return of serve). */
export interface Feed { from: V3; velocity: V3; place?: V2 }

/** The player's shot after it lands, for practice stats and tutorial goals. */
export interface LandInfo {
  p: V2;
  /** 0 = you, 1 = the coach (you missed or didn't reach it). */
  hitter: 0 | 1;
  label: string;
  isServe: boolean;
  /** In the court in play, singles or doubles (or the service box for serves). */
  inCourt: boolean;
  /** Distance past the net. */
  depth: number;
}

export interface HitInfo { label: string; timing: 'perfect' | 'early' | 'late'; airborne: boolean }

export interface Panel { tag: string; title: string; text: string; progress: [number, number] | null; footer: string }

/** A practice or tutorial session: the far side is a coach feeding shuttles instead of an opponent. */
export interface Session {
  readonly kind: 'practice' | 'tutorial' | 'challenge';
  /** Set when the session wants to return to the menu. */
  done: boolean;
  start(g: Game): void;
  update(g: Game, dt: number): void;
  onHit(g: Game, h: HitInfo): void;
  onLand(g: Game, l: LandInfo): void;
  onReview(g: Game): void;
  onReplay(g: Game): void;
  /** Enter. */
  skip(g: Game): void;
  key(g: Game, code: string): void;
  panel(): Panel;
}

const rand = (a: number, b: number) => lerp(a, b, Math.random());

/** Solve a coach feed from `from` to `target` on the near side. */
function launch(from: V3, target: V2, solve: (z0: number, D: number, sNet: number, netH: number) => { angle: number; speed: number }): Feed {
  const dx = target.x - from.x, dy = target.y - from.y, D = Math.hypot(dx, dy);
  const ux = dx / D, uy = dy / D;
  const sNet = -from.y / uy;
  const netH = netHeightAt(from.x + ux * sNet);
  const { angle, speed } = solve(from.z, D, sNet, netH);
  return { from, velocity: { x: ux * speed * Math.cos(angle), y: uy * speed * Math.cos(angle), z: speed * Math.sin(angle) } };
}

/** A feed toward the near player, landing around where they're standing (sideways). */
export function feedShot(type: FeedType, near: V2): Feed {
  const lat = clamp(near.x + rand(-0.9, 0.9), -2.0, 2.0);
  const fx = rand(-1, 1);
  const lob = (angleDeg: number) => (z0: number, D: number) => ({ angle: angleDeg * DEG, speed: speedForAngle(z0, D, angleDeg * DEG, 70).speed });
  const fast = (speed: number) => (z0: number, D: number, sNet: number, netH: number) => {
    const low = angleForSpeed(z0, D, speed, 'low').angle;
    return { angle: clearNetAngle(z0, speed, low, sNet, netH + 0.08), speed };
  };
  const soft = (clearance: number) => (z0: number, D: number, sNet: number, netH: number) => softShot(z0, D, sNet, netH, clearance, 30, 80 * DEG);
  switch (type) {
    case 'liftBack': return launch({ x: fx, y: 1.6, z: 0.8 }, { x: lat, y: -rand(5.3, 6.0) }, lob(55));
    case 'liftMid': return launch({ x: fx, y: 1.6, z: 0.8 }, { x: lat, y: -rand(3.6, 4.4) }, lob(62));
    case 'net': return launch({ x: fx * 0.6, y: 0.9, z: 1.0 }, { x: clamp(near.x + rand(-0.8, 0.8), -2, 2), y: -rand(0.6, 1.2) }, soft(0.1));
    case 'netLoose': return launch({ x: fx * 0.6, y: 1.0, z: 1.1 }, { x: clamp(near.x + rand(-0.6, 0.6), -2, 2), y: -rand(1.3, 1.8) }, soft(0.55));
    // Drives are a mid-court exchange: aimed past you so they arrive around shoulder height.
    case 'drive': return launch({ x: fx, y: 2.4, z: 1.5 }, { x: lat, y: clamp(near.y - 1.8, -6.4, -4.0) }, fast(22));
    case 'smash': return launch({ x: fx, y: 4.2, z: 2.6 }, { x: lat, y: -rand(3.2, 4.2) }, fast(62));
    // Two attackers taking turns from either side, smashing anywhere across the doubles width.
    case 'smashWide': {
      const from = { x: pick([-1.6, 1.6]), y: rand(3.6, 4.6), z: 2.6 };
      return launch(from, { x: clamp(near.x + rand(-1.3, 1.3), -2.8, 2.8), y: -rand(3.0, 4.4) }, fast(rand(52, 64)));
    }
    // Flat, fast drive exchange from mid-court, straight at you.
    case 'driveFlat': return launch({ x: fx, y: 2.2, z: 1.3 }, { x: clamp(near.x + rand(-0.5, 0.5), -2.6, 2.6), y: clamp(near.y - 1.2, -6.2, -3.6) }, fast(rand(24, 29)));
    // Return of serve: you receive in the right court, close to the short service line.
    case 'lowServe':
    case 'flickServe': {
      const place = { x: SERVE.receiverOffset, y: -SERVE.doubles.receiverDepth };
      const from = { x: -SERVE.serverOffset, y: SERVE.doubles.serverDepth, z: SERVE.contactHeight };
      const target = type === 'lowServe'
        ? { x: place.x + rand(-0.4, 0.4), y: -rand(2.05, 2.5) }
        : { x: place.x + rand(-0.3, 0.6), y: -rand(5.2, 5.75) };
      const f = type === 'lowServe' ? launch(from, target, soft(rand(0.04, 0.22))) : launch(from, target, lob(30));
      return { ...f, place };
    }
    case 'line': {
      // Lands just outside the singles sideline, for the Hawk-Eye lesson.
      const side = near.x >= 0 ? 1 : -1;
      return launch({ x: 0, y: 3.5, z: 1.4 }, { x: side * (COURT.singlesHalfWidth + COURT.footprint + 0.022), y: -4.3 }, lob(25));
    }
  }
}

/** doubles: played on the doubles court (alleys in). delay: seconds between feeds. */
const DRILLS: { name: string; feeds: FeedType[]; doubles?: boolean; delay?: number }[] = [
  { name: 'Smash', feeds: ['liftMid'] },
  { name: 'Clear & drop', feeds: ['liftBack'] },
  { name: 'Net play', feeds: ['net', 'net', 'netLoose'] },
  { name: 'Drives', feeds: ['drive'] },
  { name: 'Defence', feeds: ['smash'] },
  { name: 'Mixed', feeds: ['liftBack', 'liftMid', 'net', 'netLoose', 'drive', 'smash'] },
  { name: 'Doubles defence (2 on 1)', feeds: ['smashWide'], doubles: true, delay: 0.5 },
  { name: 'Drive exchange', feeds: ['driveFlat'], doubles: true, delay: 0.4 },
  { name: 'Return of serve', feeds: ['lowServe', 'lowServe', 'lowServe', 'flickServe'], doubles: true, delay: 1.0 },
];

/** Free practice against a feeder. Number keys switch drills. */
export class Practice implements Session {
  readonly kind = 'practice';
  done = false;
  private drill = 5;
  private shots = 0;
  private inside = 0;
  private perfect = 0;

  start(g: Game) { g.feed(this.next(), 1.2); }

  private get delay(): number { return DRILLS[this.drill].delay ?? 0.8; }

  private next(): FeedType { return pick(DRILLS[this.drill].feeds); }

  update() {}

  onHit(_g: Game, h: HitInfo) {
    this.shots++;
    if (h.timing === 'perfect') this.perfect++;
  }

  onLand(g: Game, l: LandInfo) {
    if (l.hitter === 0 && l.inCourt) this.inside++;
    g.feed(this.next(), this.delay);
  }

  onReview() {}
  onReplay() {}
  skip() {}

  key(g: Game, code: string) {
    const n = Number(code.replace('Digit', '')) - 1;
    if (n >= 0 && n < DRILLS.length && n !== this.drill) {
      this.drill = n;
      this.shots = this.inside = this.perfect = 0;
      g.drillDoubles = !!DRILLS[n].doubles;
      if (g.state === 'feed') g.feed(this.next(), 0.6);
    }
  }

  panel(): Panel {
    const pct = (a: number) => (this.shots ? `${Math.min(100, Math.round((100 * a) / this.shots))}%` : '–');
    return {
      tag: 'PRACTICE',
      title: `Drill: ${DRILLS[this.drill].name}`,
      text: DRILLS.map((d, i) => `${i + 1} ${d.name}`).join('   ·   '),
      progress: null,
      footer: `Shots ${this.shots}   ·   In ${pct(this.inside)}   ·   Perfect timing ${pct(this.perfect)}   ·   Esc to quit`,
    };
  }
}
