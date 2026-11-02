import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/barlow-semi-condensed/500';
import '@fontsource/barlow-semi-condensed/600';
import '@fontsource/barlow-semi-condensed/700';
import './menu.css';
import { Sound } from './audio';
import { Camera, broadcastCamera, setView, sideCamera } from './camera';
import { CHANGELOG } from './changelog';
import { RULES, STYLES, UI_KEYS } from './config';
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
  event: 'singles', opponent: 'beginner', style: 'allround', partnerStyle: 'allround', autoSwitch: false, p1Control: 'mouse', games: 3, points: 15, guides: true, timingLight: true, swingAssist: true, aim: 'realistic', voice: true,
  view: 'close',
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(STORE) ?? '{}'));
} catch { /* no saved settings */ }
setView(broadcast, settings.view);
function saveSettings() {
  try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
let game: Game | null = null;

// Bottom-right buttons: camera view and fullscreen. Blur after clicking so Space doesn't re-press them.
const viewBtn = document.getElementById('viewBtn') as HTMLButtonElement;
const fsBtn = document.getElementById('fsBtn') as HTMLButtonElement;
function syncViewbar() {
  viewBtn.textContent = `View: ${settings.view === 'close' ? 'Close' : 'Broadcast'}`;
  fsBtn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
}
function toggleView() {
  settings.view = settings.view === 'close' ? 'broadcast' : 'close';
  if (game) game.settings.view = settings.view;
  saveSettings();
  setView(broadcast, settings.view);
  resize();
  syncViewbar();
}
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}
viewBtn.addEventListener('click', () => { toggleView(); viewBtn.blur(); });
fsBtn.addEventListener('click', () => { toggleFullscreen(); fsBtn.blur(); });
document.addEventListener('fullscreenchange', () => { syncViewbar(); resize(); });

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
syncViewbar();

// ── Menu ─────────────────────────────────────────────────────────────────────

const k = (s: string) => `<kbd>${s}</kbd>`;
function describeControls() {
  const twoP = settings.opponent === 'human';
  // Keyboard keys for high / fast / soft: solo J K L; sharing a keyboard, P1 uses C V B and P2 J K L.
  const kb = (solo: string, p1: string) => (twoP ? `${k(p1)} <span class="dim">P1</span> · ${k(solo)} <span class="dim">P2</span>` : k(solo));
  const H = kb('J', 'C'), F = kb('K', 'V'), S = kb('L', 'B');
  const rows: [string, string, string, string][] = [
    ['Clear', 'Shuttle high above you', 'Hold right-click', H],
    ['Lift', 'Shuttle low: at the net or defending', 'Hold right-click', H],
    ['Drop', 'Shuttle high above you', 'Tap right-click', S],
    ['Net shot', 'At the net, shuttle below the tape', 'Tap right-click', S],
    ['Block', 'Defending a smash', 'Tap right-click', S],
    ['Smash', 'Shuttle high above you', 'Hold left-click until it says SMASH', `Tap ${twoP ? F : k('K')} (hold for extra power)`],
    ['Jump smash', 'High shuttle coming down', `${k('Space')}, then release left-click at the top`, `${k('Space')}, then tap ${twoP ? F : k('K')} at the top`],
    ['Drive', 'Shuttle at shoulder height', 'Tap left-click', `Tap ${twoP ? F : k('K')}`],
    ['Push', 'Shuttle low, front or mid-court', 'Tap left-click', `Tap ${twoP ? F : k('K')}`],
    ['Net kill', 'At the net, shuttle above the tape', k('E'), twoP ? `Hold ${F}` : k('E')],
    ['Short serve', 'Serving', 'Left-click', S],
    ['High serve', 'Serving', 'Hold right-click', H],
    ['Flick serve', 'Serving', 'Tap right-click', F],
    ['Aim', 'Any shot', 'Point the cursor', twoP
      ? `Hold ${k('X')}/${k('N')} <span class="dim">P1</span> · ${k('U')}/${k('O')} <span class="dim">P2</span> for left/right; neither = open side`
      : settings.p1Control === 'hybrid'
        ? `Point the cursor (trackpad); ${k('U')}/${k('O')} also work`
        : `Hold ${k('U')} left / ${k('O')} right as you hit; neither = open side`],
  ];
  const mouseOn = settings.p1Control === 'mouse';
  controlsBox.innerHTML = `
    <b>Move</b> ${k('W')}${k('A')}${k('S')}${k('D')}${twoP ? ` <span class="dim">(P2: arrow keys)</span>` : ''} · <b>Jump</b> ${k('Space')}${twoP ? ` <span class="dim">(P2: R-Shift)</span>` : ''}
    · swing just before the shuttle reaches you. Left-click and ${twoP ? 'the fast keys' : k('K')} swing when you <b>let go</b>: a quick tap is a normal shot, holding adds power
    <table class="shots">
      <thead><tr><th>Shot</th><th>When</th><th class="${mouseOn ? 'on' : ''}">Mouse</th><th class="${mouseOn ? '' : 'on'}">Keyboard</th></tr></thead>
      <tbody>${rows.map(([shot, when, m, key]) => `<tr><td><b>${shot}</b></td><td class="dim">${when}</td><td>${m}</td><td>${key}</td></tr>`).join('')}</tbody>
    </table>
    The button is your intent; contact height, timing, hand and stretch decide the exact shot. Longer and harder shots are less accurate.
    ${k('H')} challenge a line call · ${k('R')} replay · ${k('F')} fullscreen · ${k('G')} landing marker · ${k('M')} mute`
    + (settings.timingLight ? `<br>Timing light beside your player: <b style="color:#facc15">yellow</b> = too early, <b style="color:#4ade80">green</b> = swing now, <b style="color:#f87171">red</b> = too late.` : '');
  styleRow.classList.toggle('disabled', twoP);
  const doubles = settings.event === 'doubles';
  document.getElementById('partnerRow')!.classList.toggle('disabled', !doubles);
  document.querySelector<HTMLElement>('[data-group="opponent"] [data-value="human"]')!.classList.toggle('disabled', doubles);
}

// What's new pop-up: newest version first, with a NEW badge on the button until you've opened it.
const SEEN = 'badminton.seenVersion';
const latest = CHANGELOG[0].version;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const modal = document.getElementById('changelogModal')!;
const wnBadge = document.getElementById('wnBadge')!;
document.getElementById('wnTitle')!.textContent = `What’s new in v${latest}`;
document.getElementById('wnVer')!.textContent = `v${latest}`;
document.getElementById('changelog')!.innerHTML = CHANGELOG.map((v) =>
  `<h4>v${v.version}: ${esc(v.title)} <span>· ${v.date}</span></h4><ul>${v.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`).join('');
try { wnBadge.classList.toggle('hidden', localStorage.getItem(SEEN) === latest); } catch { /* storage unavailable */ }
const closeChangelog = () => modal.classList.add('hidden');
document.getElementById('whatsnewBtn')!.addEventListener('click', (e) => {
  modal.classList.remove('hidden');
  wnBadge.classList.add('hidden');
  try { localStorage.setItem(SEEN, latest); } catch { /* storage unavailable */ }
  (e.currentTarget as HTMLElement).blur();
  document.getElementById('wnClose')!.focus();
});
document.getElementById('wnClose')!.addEventListener('click', closeChangelog);
modal.addEventListener('click', (e) => { if (e.target === modal) closeChangelog(); });
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !modal.classList.contains('hidden')) closeChangelog(); });

// Court 1 on the Order of Play: who you're playing and the format, re-flipped like a board when it changes.
const tag = document.getElementById('tag')!;
const oppName = document.getElementById('oppName')!;
const meName = document.getElementById('meName')!;
const eventLabel = document.getElementById('eventLabel')!;
function flip(el: HTMLElement, text: string) {
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('flip');
  void el.offsetWidth;
  el.classList.add('flip');
}
function describeFormat() {
  const f = RULES.formats[settings.points];
  const len = settings.games === 1 ? '1 game' : 'Best of 3 games';
  flip(tag, `${len} to ${f.pointsToWin}, win by 2, capped at ${f.pointCap}`);
  const twoP = settings.opponent === 'human';
  const level = settings.opponent[0].toUpperCase() + settings.opponent.slice(1);
  const doubles = settings.event === 'doubles';
  flip(meName, twoP ? 'Player 1' : doubles ? 'You & Partner' : 'You');
  flip(oppName, twoP ? 'Player 2' : `CPU ${level}${doubles ? ' pair' : ''}`);
  flip(eventLabel, twoP ? 'Singles · 2 players' : `${doubles ? 'Doubles' : 'Singles'} · ${STYLES[settings.style].label}`);
}
const today = new Date();
document.getElementById('today')!.textContent = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

// Two side drawers: the match card (match settings) and Assists & controls (tabs). One open at a time.
const drawers = {
  card: { el: document.getElementById('matchcard')!, btn: document.getElementById('cardBtn')! },
  kit: { el: document.getElementById('kitcard')!, btn: document.getElementById('kitBtn')! },
};
type DrawerName = keyof typeof drawers;
function showTab(name: string) {
  const el = drawers.kit.el;
  el.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  el.querySelectorAll<HTMLElement>('.mc-pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
}
function openDrawer(name: DrawerName, tab?: string) {
  closeDrawers();
  const { el, btn } = drawers[name];
  if (tab) showTab(tab);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  btn.setAttribute('aria-expanded', 'true');
  el.querySelector<HTMLButtonElement>(tab ? `[data-tab="${tab}"]` : '.mc-close')?.focus();
}
function closeDrawers() {
  let closed = false;
  for (const { el, btn } of Object.values(drawers)) {
    if (!el.classList.contains('open')) continue;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    closed = true;
  }
  return closed;
}
const isOpen = (name: DrawerName) => drawers[name].el.classList.contains('open');
drawers.card.btn.addEventListener('click', () => (isOpen('card') ? closeDrawers() : openDrawer('card')));
drawers.kit.btn.addEventListener('click', () => (isOpen('kit') ? closeDrawers() : openDrawer('kit', 'assists')));
document.getElementById('cardClose')!.addEventListener('click', () => { closeDrawers(); drawers.card.btn.focus(); });
document.getElementById('kitClose')!.addEventListener('click', () => { closeDrawers(); drawers.kit.btn.focus(); });
document.getElementById('howBtn')!.addEventListener('click', () => openDrawer('kit', 'controls'));
drawers.kit.el.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab!)));
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !game && modal.classList.contains('hidden')) closeDrawers(); });

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
      // Doubles is against a CPU pair: picking one switches off the other.
      if (group === 'event' && settings.event === 'doubles' && settings.opponent === 'human') settings.opponent = 'medium';
      if (group === 'opponent' && settings.opponent === 'human') settings.event = 'singles';
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
  closeDrawers();
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
      for (const d of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']) if (input.tapped([d])) game.session.key(game, d);
    }
    if (game && input.tapped(UI_KEYS.mute)) {
      sound.muted = !sound.muted;
      voice.enabled = !sound.muted && settings.voice;
      if (!voice.enabled) voice.stop();
    }
    if (game && input.tapped(['KeyF'])) toggleFullscreen();
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
