import type { Game } from './game';
import type { V2 } from './math';
import type { FeedType, HitInfo, LandInfo, Panel, Session } from './practice';

type Controls = 'mouse' | 'keyboard';

interface Step {
  title: string;
  text: [mouse: string, keyboard: string];
  kind: 'move' | 'hit' | 'serve' | 'info' | 'hawkeye' | 'replay';
  feed?: FeedType;
  goal?: number;
  serve?: 'short' | 'high';
  /** Does this hit count (timing goals)? */
  okHit?: (h: HitInfo) => boolean;
  /** Does this landed shot of yours count? */
  ok?: (l: LandInfo) => boolean;
}

const same = (s: string): [string, string] => [s, s];

const STEPS: Step[] = [
  {
    title: 'Moving', kind: 'move', goal: 3,
    text: same('Move with W A S D. Run to each yellow ring. You stop as soon as you let go, so small taps make small adjustments.'),
  },
  {
    title: 'Timing', kind: 'hit', feed: 'liftMid', goal: 2, okHit: (h) => h.timing === 'perfect',
    text: [
      'The coach feeds you shuttles. Get under the yellow landing ring, then watch the light beside your player: yellow = wait, green = swing now, red = too late. Tap left-click on green. Get 2 Perfect hits.',
      'The coach feeds you shuttles. Get under the yellow landing ring, then watch the light beside your player: yellow = wait, green = swing now, red = too late. Tap K on green (K swings when you let go). Get 2 Perfect hits.',
    ],
  },
  {
    title: 'Clear', kind: 'hit', feed: 'liftBack', goal: 2, ok: (l) => l.inCourt && l.depth >= 4.5,
    text: [
      'Hold right-click, release on green: a clear always goes deep. The cursor picks left or right, and holding longer goes higher. Land 2 in the back of the court.',
      'Press J on green for a clear, deep to the back. Hold A or D as you hit to aim left or right. Land 2 in the back of the court.',
    ],
  },
  {
    title: 'Drop', kind: 'hit', feed: 'liftBack', goal: 2, ok: (l) => l.inCourt && l.depth <= 3.3,
    text: [
      'Tap right-click on green for a drop: it always lands short, just over the net. Land 2 drops in the front of the court.',
      'Press L on green for a drop, landing just over the net. Land 2 drops in the front of the court.',
    ],
  },
  {
    title: 'Smash', kind: 'hit', feed: 'liftMid', goal: 2, ok: (l) => l.inCourt && /smash/i.test(l.label),
    text: [
      'Start holding left-click early. When the label on the court says SMASH, release on green. Land 2 smashes in.',
      'Hold K while the shuttle drops toward you. The longer you hold, the harder the shot: once the ring above your head turns gold it’s a full smash. Let go on green. Land 2 smashes in.',
    ],
  },
  {
    title: 'Drive', kind: 'hit', feed: 'drive', goal: 2, ok: (l) => l.inCourt && /Drive|Push|Half smash|Flat clear|Smash/.test(l.label),
    text: [
      'A tap of left-click is a drive: flat and fast. These feeds come at shoulder height. Land 2 in.',
      'A quick tap of K is a drive: flat and fast. These feeds come at shoulder height. Land 2 in.',
    ],
  },
  {
    title: 'Net kill', kind: 'hit', feed: 'netLoose', goal: 2, ok: (l) => l.inCourt && /kill/i.test(l.label),
    text: [
      'Loose shuttles above the tape can be killed. Rush the net and press E for instant full power (no charging). Land 2 kills.',
      'Loose shuttles above the tape can be killed. Rush the net and press E for instant full power (no holding). Land 2 kills.',
    ],
  },
  {
    title: 'Jump smash', kind: 'hit', feed: 'liftMid', goal: 1, ok: (l) => l.inCourt && /Jump smash/.test(l.label),
    text: [
      'Press Space to jump as the shuttle drops toward you, then release your smash (left-click) at the top. Land 1 jump smash.',
      'Hold K, press Space to jump as the shuttle drops toward you, and let go of K at the top. Land 1 jump smash.',
    ],
  },
  {
    title: 'Short serve', kind: 'serve', serve: 'short', goal: 1, ok: (l) => l.inCourt,
    text: [
      'Serving: you serve from the RIGHT court when your score is even, the LEFT when it’s odd, diagonally into the box opposite. Left-click for a short serve into the box.',
      'Serving: you serve from the RIGHT court when your score is even, the LEFT when it’s odd, diagonally into the box opposite. Press L for a short serve into the box.',
    ],
  },
  {
    title: 'High serve', kind: 'serve', serve: 'high', goal: 1, ok: (l) => l.inCourt && l.depth >= 5,
    text: [
      'Now right-click (hold for higher) for a high serve to the back of the box.',
      'Now press J for a high serve to the back of the box.',
    ],
  },
  {
    title: 'Scoring', kind: 'info',
    text: same('Every rally wins a point. Games go to 15 or 21: win by 2, capped at 21 or 30. Faults: into the net, out, or not over. After each rally there’s a 25-second shot clock to serve. Press Enter to continue.'),
  },
  {
    title: 'Hawk-Eye', kind: 'hawkeye', goal: 1,
    text: same('Line judges sometimes miss close calls. Watch the next shuttle (don’t hit it). It lands just outside the line but gets called IN. When it does, press H to challenge.'),
  },
  {
    title: 'Replays', kind: 'replay', goal: 1,
    text: same('Press R between points to replay the last rally in slow motion. V switches to a side camera, and R or Enter stops it. Try it now.'),
  },
  {
    title: 'You’re ready', kind: 'info',
    text: same('That’s everything. Play a match against the CPU, or use Practice from the menu to drill any shot. Press Enter to go back to the menu.'),
  },
];

/** Step-by-step lessons on court with the coach feeding shuttles. */
export class Tutorial implements Session {
  readonly kind = 'tutorial';
  done = false;
  private i = 0;
  private count = 0;
  private wait = -1;
  private rings: V2[] = [];

  constructor(private controls: Controls) {}

  private get step(): Step { return STEPS[this.i]; }

  start(g: Game) { this.begin(g); }

  private begin(g: Game) {
    const s = this.step;
    this.count = 0;
    g.rings = [];
    g.players[0].frozen = false;
    switch (s.kind) {
      case 'move':
        this.rings = [{ x: 1.6, y: -5.2 }, { x: -1.7, y: -1.6 }, { x: 0, y: -3.6 }];
        g.rings = [this.rings[0]];
        g.idle();
        break;
      case 'hit': g.feed(s.feed!, 1.2); break;
      case 'serve': g.serveDrill(0.8); break;
      case 'hawkeye':
        g.players[0].place(0, -3.4);
        g.players[0].frozen = true;
        g.feed('line', 1.2);
        break;
      default: g.idle();
    }
  }

  /** Goal reached: say so, then move on. keepState: don't interrupt what's playing (a replay). */
  private complete(g: Game, keepState = false) {
    g.banner = { title: 'Nice!', sub: `${this.step.title} done`, color: '#5ee38f', t: 0 };
    g.rings = [];
    if (!keepState) g.idle();
    this.wait = 1.3;
  }

  private progress(g: Game) {
    this.count++;
    if (this.count >= (this.step.goal ?? 1)) this.complete(g);
  }

  private nextStep(g: Game) {
    g.banner = null;
    if (this.i >= STEPS.length - 1) { this.done = true; return; }
    this.i++;
    this.begin(g);
  }

  update(g: Game, dt: number) {
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) { this.wait = -1; this.nextStep(g); }
      return;
    }
    if (this.step.kind === 'move' && g.rings.length) {
      const r = g.rings[0], p = g.players[0].pos;
      if (Math.hypot(r.x - p.x, r.y - p.y) < 0.45) {
        this.count++;
        if (this.count >= this.rings.length) this.complete(g);
        else g.rings = [this.rings[this.count]];
      }
    }
  }

  onHit(g: Game, h: HitInfo) {
    if (this.wait < 0 && this.step.kind === 'hit' && this.step.okHit?.(h)) this.progress(g);
  }

  onLand(g: Game, l: LandInfo) {
    if (this.wait > 0) return;
    const s = this.step;
    if (s.kind === 'hawkeye') { g.stageMiscall(); return; }
    if (s.kind === 'serve') {
      if (l.isServe && s.ok?.(l)) this.progress(g);
      if (this.wait < 0) g.serveDrill(1.0);
      return;
    }
    if (s.kind === 'hit') {
      if (l.hitter === 0 && s.ok?.(l)) this.progress(g);
      if (this.wait < 0) g.feed(s.feed!, 0.9);
    }
  }

  onReview(g: Game) {
    if (this.step.kind === 'hawkeye') { g.players[0].frozen = false; this.complete(g); }
  }

  onReplay(g: Game) {
    if (this.step.kind === 'replay' && this.wait < 0) this.complete(g, true);
  }

  skip(g: Game) {
    if (this.wait > 0) return;
    g.players[0].frozen = false;
    this.nextStep(g);
  }

  key() {}

  panel(): Panel {
    const s = this.step;
    const goal = s.goal && s.kind !== 'replay' && s.kind !== 'hawkeye' ? s.goal : null;
    return {
      tag: `TUTORIAL  ·  STEP ${this.i + 1} OF ${STEPS.length}`,
      title: s.title,
      text: s.text[this.controls === 'mouse' ? 0 : 1],
      progress: goal ? [Math.min(this.count, goal), goal] : null,
      footer: s.kind === 'info' ? 'Enter to continue   ·   Esc to quit' : 'Enter to skip this step   ·   Esc to quit',
    };
  }
}
