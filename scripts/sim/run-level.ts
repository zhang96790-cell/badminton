// CPU ladder check: level A against level B (neutral players), single games to 21, sides swapped.
// Args: levelA levelB n seed. Bundled with esbuild and run in Node.
import { Game } from '../../src/game';
import { AIController } from '../../src/ai';
import { Input } from '../../src/input';
import { broadcastCamera } from '../../src/camera';
import type { Settings } from '../../src/game';
import type { Level } from '../../src/config';

const [, , la, lb, nStr] = process.argv;
const SETTINGS = { event: 'singles', opponent: 'hard', style: 'allround', partnerStyle: 'allround', autoSwitch: false, p1Control: 'keyboard', games: 1, points: 21, guides: false, timingLight: false, swingAssist: false, aim: 'realistic', voice: false, view: 'broadcast', performance: true } as Settings;
const input = new Input(document.createElement('div'));
function play(near: Level, far: Level) {
  const g = new Game({ ...SETTINGS, opponent: far }, input, broadcastCamera(), 'match') as unknown as Record<string, any> & Game;
  (g.controllers as unknown[])[0] = new AIController(g, g.players[0], near, 'allround');
  g.startReplay = () => {};
  for (let i = 0; i < 400_000 && g.state !== 'matchOver'; i++) { g.update(0.05); g.events.length = 0; }
  return { w: g.match.games[0] > g.match.games[1] ? 0 : 1, p: [g.stats.summary(0).points, g.stats.summary(1).points] };
}
let wins = 0, pa = 0, pb = 0;
const n = Number(nStr);
for (let k = 0; k < n; k++) {
  const flip = k % 2 === 1;
  const r = flip ? play(lb as Level, la as Level) : play(la as Level, lb as Level);
  const ia = flip ? 1 : 0;
  if (r.w === ia) wins++;
  pa += r.p[ia]; pb += r.p[1 - ia];
}
console.log(JSON.stringify({ n, wins, pa, pb, sa: 0, sb: 0 }));
