// CPU shot mix: what a style plays (smash / drive-push / drop / net / lift-clear / block), against an all-rounder.
// Args: level style n. Bundled with esbuild and run in Node.
import { Game } from '../../src/game';
import { AIController } from '../../src/ai';
import { Input } from '../../src/input';
import { broadcastCamera } from '../../src/camera';
import { shotKind } from '../../src/careermode/signatures';
import type { Settings } from '../../src/game';
import type { Level, Style } from '../../src/config';

const [, , lv = 'hard', st = 'attacker', nStr = '4'] = process.argv;
const SETTINGS = { event: 'singles', opponent: lv, style: st, partnerStyle: 'allround', autoSwitch: false, p1Control: 'keyboard', games: 1, points: 21, guides: false, timingLight: false, swingAssist: false, aim: 'realistic', voice: false, view: 'broadcast', performance: true } as Settings;
const input = new Input(document.createElement('div'));
const mix: Record<string, number> = {};
let won = 0;
for (let k = 0; k < Number(nStr); k++) {
  const g = new Game(SETTINGS, input, broadcastCamera(), 'match') as unknown as Record<string, any> & Game;
  (g.controllers as unknown[])[0] = new AIController(g, g.players[0], lv as Level, 'allround' as Style);
  g.startReplay = () => {};
  let last: unknown = null;
  for (let i = 0; i < 400_000 && g.state !== 'matchOver'; i++) {
    g.update(0.05); g.events.length = 0;
    if (g.lastShot && g.lastShot !== last) { last = g.lastShot; if (g.lastHitterId === g.players[1].id) { const kd = shotKind(g.lastShot.label); mix[kd] = (mix[kd] ?? 0) + 1; } }
  }
  if (g.match.games[1] > g.match.games[0]) won++;
}
const tot = Object.values(mix).reduce((a, b) => a + b, 0);
console.log(st, `won ${won}/${nStr}`, Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((100 * v) / tot)}%`).join(', '));
