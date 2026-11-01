import { Sound } from './audio';
import { Camera, broadcastCamera, sideCamera } from './camera';
import { RULES, UI_KEYS } from './config';
import { Game, type Mode, type Settings } from './game';
import { drawReview } from './hawkeye';
import { Hud } from './hud';
import { Input } from './input';
import { Renderer, type Scene } from './render';
import { Voice } from './voice';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const menu = document.getElementById('menu')!;
const controlsBox = document.getElementById('controls')!;
const styleRow = document.getElementById('styleRow')!;
const input = new Input(canvas);
const broadcast = broadcastCamera();
const side = sideCamera();
const hawkCam = new Camera();
const renderer = new Renderer(ctx);
const hud = new Hud(ctx);
const sound = new Sound();
const voice = new Voice();

const STORE = 'badminton.settings';
const settings: Settings = {
  opponent: 'medium', style: 'allround', p1Control: 'mouse', games: 3, points: 15, guides: true, timingLight: true, aim: 'realistic', voice: true,
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(STORE) ?? '{}'));
} catch { /* no saved settings */ }
function saveSettings() {
  try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
let game: Game | null = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  broadcast.fit(innerWidth, innerHeight);
  side.fit(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// ── Menu ─────────────────────────────────────────────────────────────────────

const k = (s: string) => `<kbd>${s}</kbd>`;
function describeControls() {
  const p1 = settings.p1Control === 'mouse'
    ? `<b>Player 1 — keyboard + mouse</b><br>
       ${k('W')}${k('A')}${k('S')}${k('D')} move · ${k('Space')} jump · the cursor is where you want it to land<br>
       <b>Left-click</b>: attack. Tap = <b>drive</b>, hold = <b>smash</b> (the label on the court switches from DRIVE to SMASH)<br>
       <b>Right-click</b> (or Shift/Ctrl-click): touch. Tap = <b>drop</b> (always lands short), hold = <b>lob / clear</b> (always deep, higher the longer you hold)<br>
       ${k('E')} <b>kill</b>: instant full power at the cursor, no charging (net kills, snap smashes)<br>
       The swing happens when you <b>release</b> (or press E), so time it just before the shuttle reaches you`
    : settings.opponent === 'human'
      ? `<b>Player 1 — keyboard</b><br>${k('W')}${k('A')}${k('S')}${k('D')} move · ${k('C')} high · ${k('V')} fast · ${k('B')} soft · ${k('Space')} jump`
      : `<b>Player 1 — keyboard</b><br>
         ${k('W')}${k('A')}${k('S')}${k('D')} move · ${k('Space')} jump<br>
         ${k('J')} <b>high</b>: clear from overhead, lift from low<br>
         ${k('K')} or ${k('E')} <b>fast</b>: smash overhead, drive at mid height, kill above the tape, push from below it<br>
         ${k('L')} <b>soft</b>: drop overhead, net shot at the net, block in mid-court<br>
         Hold a direction as you hit to aim: left/right picks the side, toward the net goes deeper, away goes shorter`;
  const p2 = settings.opponent === 'human'
    ? `<br><br><b>Player 2 — keyboard</b><br>${k('←')}${k('↑')}${k('↓')}${k('→')} move · ${k('J')} high · ${k('K')} fast · ${k('L')} soft · ${k('R-Shift')} jump`
    : '';
  controlsBox.innerHTML = `${p1}${p2}<br><br>Timing, contact height, which hand you use and how far you're stretching decide the shot. `
    + `Longer and harder shots are less accurate. ${k('H')} challenges a line call, ${k('R')} replays the last rally.`
    + (settings.timingLight ? `<br>Timing light beside your player: <b style="color:#facc15">yellow</b> = too early, <b style="color:#4ade80">green</b> = swing now, <b style="color:#f87171">red</b> = too late.` : '');
  styleRow.classList.toggle('disabled', settings.opponent === 'human');
}

const tag = document.getElementById('tag')!;
function describeFormat() {
  const f = RULES.formats[settings.points];
  const len = settings.games === 1 ? '1 game' : 'best of 3 games';
  tag.textContent = `Singles · ${len} to ${f.pointsToWin}, win by 2, capped at ${f.pointCap} · interval at ${f.intervalAt}`;
}

/** Menu values are strings; settings hold numbers and booleans. */
const parse = (v: string): string | number | boolean => (v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v);

function syncMenu() {
  document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
    const group = seg.dataset.group as keyof Settings;
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', parse(b.dataset.value!) === settings[group]));
  });
}

document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
  const group = seg.dataset.group as keyof Settings;
  seg.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      (settings as unknown as Record<string, unknown>)[group] = parse(btn.dataset.value!);
      saveSettings();
      syncMenu();
      describeControls();
      describeFormat();
    });
  });
});
syncMenu();
describeControls();
describeFormat();

const TUTORIAL_DONE = 'badminton.tutorialDone';
const tutorialDone = () => { try { return localStorage.getItem(TUTORIAL_DONE) === '1'; } catch { return false; } };
function syncTutorialHint() {
  document.getElementById('newHint')!.classList.toggle('hidden', tutorialDone());
  document.getElementById('tutorial')!.classList.toggle('suggest', !tutorialDone());
}
syncTutorialHint();
// Touch-only devices (phones, tablets) can't really play: say so.
const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
document.getElementById('touchNote')!.classList.toggle('hidden', !touchOnly);

function startMatch(mode: Mode = 'match') {
  sound.init();
  voice.enabled = settings.voice;
  voice.unlock();
  game = new Game({ ...settings }, input, broadcast, mode);
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  menu.classList.add('hidden');
  (document.activeElement as HTMLElement | null)?.blur();
}

function showMenu() {
  if (game?.mode === 'tutorial' && game.session?.done) {
    try { localStorage.setItem(TUTORIAL_DONE, '1'); } catch { /* storage unavailable */ }
  }
  game = null;
  voice.stop();
  syncTutorialHint();
  menu.classList.remove('hidden');
}

document.getElementById('start')!.addEventListener('click', () => startMatch('match'));
document.getElementById('tutorial')!.addEventListener('click', () => startMatch('tutorial'));
document.getElementById('practice')!.addEventListener('click', () => startMatch('practice'));

// ── Loop ─────────────────────────────────────────────────────────────────────

let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  const w = innerWidth, h = innerHeight;

  if (game) {
    const over = game.state === 'matchOver';
    if (input.tapped(['Escape'])) { if (over || game.session) showMenu(); else game.paused = !game.paused; }
    if (game?.session) {
      for (const d of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']) if (input.tapped([d])) game.session.key(game, d);
    }
    if (game && input.tapped(UI_KEYS.mute)) {
      sound.muted = !sound.muted;
      voice.enabled = !sound.muted && settings.voice;
      if (!voice.enabled) voice.stop();
    }
    if (game && input.tapped(UI_KEYS.guides)) {
      settings.guides = game.settings.guides = !game.settings.guides;
      saveSettings();
      syncMenu();
    }
    if (game && !game.paused) {
      if (input.tapped(UI_KEYS.challenge)) game.requestChallenge();
      if (input.tapped(UI_KEYS.replay)) game.toggleReplay();
      if (input.tapped(UI_KEYS.replayCamera)) game.toggleReplayCamera();
    }
    if (game?.paused && input.tapped(['KeyQ'])) showMenu();
    else if (game && input.tapped(['Enter'])) {
      if (game.state === 'matchOver') startMatch('match');
      else game.skip();
    }
    if (game?.session?.done) showMenu();
  } else if (input.tapped(['Enter'])) {
    startMatch('match');
  }

  if (game) {
    game.update(dt);
    for (const e of game.events) {
      if (e.type === 'say') voice.say(e.text, e.who, e.interrupt);
      else sound.play(e);
    }
    game.events.length = 0;
    sound.update(Math.min(dt, 0.05), game.state === 'challenge');
  }

  if (game?.state === 'challenge' && game.review) {
    drawReview(ctx, w, h, game.review, hawkCam);
  } else if (game) {
    const replaying = game.state === 'replay' && game.playback;
    const scene: Scene = replaying
      ? { ...game.playback!.frame(), live: false }
      : { players: game.players, shuttle: game.shuttle, live: true };
    const cam = replaying && game.replayCam === 'side' ? side : broadcast;
    renderer.draw(cam, game, scene, w, h, now / 1000, cam === side);
    hud.draw(game, w, h, now / 1000);
  } else {
    renderer.draw(broadcast, null, null, w, h, now / 1000);
  }
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
