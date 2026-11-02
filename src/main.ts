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
import { Tour } from './tour';
import { BIND_ACTIONS, bind, bindProblem, keyFor, keyLabel, type BindAction } from './keys';
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
  event: 'singles', opponent: 'beginner', style: 'allround', partnerStyle: 'allround', autoSwitch: false, p1Control: 'mouse', games: 3, points: 15,
  // Assists start off except the landing marker.
  guides: true, timingLight: false, swingAssist: false, aim: 'realistic', voice: false,
  view: 'close',
};
// Bumped when defaults change in a way existing players should get once.
const SETTINGS_VERSION = 2;
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
  // v2 (1.6.4): assists default off except the landing marker, so drop old saved assist values once.
  if ((saved.v ?? 1) < 2) { delete saved.timingLight; delete saved.swingAssist; delete saved.voice; delete saved.autoSwitch; }
  Object.assign(settings, saved);
} catch { /* no saved settings */ }
setView(broadcast, settings.view);
/** The logged-in player (see Player account below); declared here because saving settings syncs to it. */
let account: { id: string; username: string } | null = null;
let accountSaveTimer = 0;
function saveSettings() {
  try { localStorage.setItem(STORE, JSON.stringify({ ...settings, v: SETTINGS_VERSION })); } catch { /* storage unavailable */ }
  queueAccountSave();
}
saveSettings();
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
  // Your custom keys when you're on your own; sharing a keyboard keeps the fixed keys.
  const key = (a: BindAction) => k(keyLabel(keyFor(settings.keys, a)));
  const kb = (a: BindAction, p1: string, p2: string) => (twoP ? `${k(p1)} <span class="dim">P1</span> · ${k(p2)} <span class="dim">P2</span>` : key(a));
  const H = kb('high', 'C', 'J'), F = kb('fast', 'V', 'K'), S = kb('soft', 'B', 'L');
  const J = twoP ? k('Space') : key('jump');
  const rows: [string, string, string, string][] = [
    ['Clear', 'Shuttle high above you', 'Hold right-click', H],
    ['Lift', 'Shuttle low: at the net or defending', 'Hold right-click', H],
    ['Drop', 'Shuttle high above you', 'Tap right-click', S],
    ['Net shot', 'At the net, shuttle below the tape', 'Tap right-click', S],
    ['Block', 'Defending a smash', 'Tap right-click', S],
    ['Smash', 'Shuttle high above you', 'Hold left-click until it says SMASH', `Tap ${twoP ? F : key('fast')} (hold for extra power)`],
    ['Jump smash', 'High shuttle coming down', `${J}, then release left-click at the top`, `${J}, then tap ${twoP ? F : key('fast')} at the top`],
    ['Drive', 'Shuttle at shoulder height', 'Tap left-click', `Tap ${twoP ? F : key('fast')}`],
    ['Push', 'Shuttle low, front or mid-court', 'Tap left-click', `Tap ${twoP ? F : key('fast')}`],
    ['Net kill', 'At the net, shuttle above the tape', key('kill'), twoP ? `Hold ${F}` : key('kill')],
    ['Short serve', 'Serving', 'Left-click', S],
    ['High serve', 'Serving', 'Hold right-click', H],
    ['Flick serve', 'Serving', 'Tap right-click', F],
    ['Aim', 'Any shot', 'Point the cursor', twoP
      ? `Hold ${k('X')}/${k('N')} <span class="dim">P1</span> · ${k('U')}/${k('O')} <span class="dim">P2</span> for left/right; neither = open side`
      : settings.p1Control === 'hybrid'
        ? `Point the cursor (trackpad); ${key('aimLeft')}/${key('aimRight')} also work`
        : `Hold ${key('aimLeft')} left / ${key('aimRight')} right as you hit; neither = open side`],
  ];
  const mouseOn = settings.p1Control === 'mouse';
  controlsBox.innerHTML = `
    <b>Move</b> ${twoP ? k('W') + k('A') + k('S') + k('D') : key('up') + key('left') + key('down') + key('right')}${twoP ? ` <span class="dim">(P2: arrow keys)</span>` : ''} · <b>Jump</b> ${J}${twoP ? ` <span class="dim">(P2: R-Shift)</span>` : ''}
    · swing just before the shuttle reaches you. Left-click and ${twoP ? 'the fast keys' : key('fast')} swing when you <b>let go</b>: a quick tap is a normal shot, holding adds power
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

// Key bind editor (Assists & controls → Controls). While it's listening, it takes the key before the game or menu sees it.
const bindsBox = document.getElementById('binds')!, bindMsg = document.getElementById('bindMsg')!;
let listening: BindAction | null = null;
let swallowKeyup: string | null = null;
const actionLabel = (a: BindAction) => BIND_ACTIONS.find((b) => b.action === a)!.label;
function setBindMsg(text: string, problem = false) {
  bindMsg.textContent = text;
  bindMsg.classList.toggle('problem', problem);
}
function renderBinds() {
  const mouse = settings.p1Control === 'mouse';
  bindsBox.innerHTML = BIND_ACTIONS.map(({ action, label, mouse: inMouse }) => {
    const off = mouse && !inMouse;
    const key = listening === action ? 'Press a key…' : keyLabel(keyFor(settings.keys, action));
    return `<div class="bind${off ? ' off' : ''}"><span>${label}${off ? ' <em>keyboard modes</em>' : ''}</span>`
      + `<button data-action="${action}" class="${listening === action ? 'listening' : ''}" aria-label="${label}: ${key}">${key}</button></div>`;
  }).join('');
  bindsBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.action as BindAction;
    listening = listening === a ? null : a;
    setBindMsg(listening ? `Press the new key for ${actionLabel(a).toLowerCase()}` : '');
    renderBinds();
    if (listening) bindsBox.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)?.focus();
  }));
}
addEventListener('keydown', (e) => {
  if (!listening) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  swallowKeyup = e.code;
  const a = listening;
  if (e.code === 'Escape') { listening = null; setBindMsg(''); renderBinds(); return; }
  const problem = bindProblem(settings.keys, a, e.code);
  if (problem) { setBindMsg(problem, true); return; }
  const r = bind(settings.keys, a, e.code);
  settings.keys = r.binds;
  listening = null;
  saveSettings();
  setBindMsg(r.swapped
    ? `${actionLabel(a)} is now ${keyLabel(e.code)}; ${actionLabel(r.swapped).toLowerCase()} moved to ${keyLabel(keyFor(settings.keys, r.swapped))}`
    : `${actionLabel(a)} is now ${keyLabel(e.code)}`);
  renderBinds();
  describeControls();
}, { capture: true });
// Space on a focused button clicks it on key-up: don't let the key we just took re-open the editor.
addEventListener('keyup', (e) => {
  if (swallowKeyup !== e.code) return;
  swallowKeyup = null;
  e.preventDefault();
  e.stopImmediatePropagation();
}, { capture: true });
document.getElementById('bindReset')!.addEventListener('click', () => {
  settings.keys = {};
  listening = null;
  saveSettings();
  setBindMsg('Keys reset to the defaults');
  renderBinds();
  describeControls();
});
renderBinds();

// ── Player account ───────────────────────────────────────────────────────────
// The account code (and Supabase) only loads when needed: on opening the dialog, or at start-up if
// this browser has logged in before.
type AccountModule = typeof import('./account');
let accountModule: Promise<AccountModule> | null = null;
const loadAccount = () => (accountModule ??= import('./account'));
const accountModal = document.getElementById('accountModal')!;
const acForm = document.getElementById('acForm') as HTMLFormElement, acSignedIn = document.getElementById('acSignedIn')!;
const acUser = document.getElementById('acUser') as HTMLInputElement, acPass = document.getElementById('acPass') as HTMLInputElement;
const acNewPass = document.getElementById('acNewPass') as HTMLInputElement;
const acError = document.getElementById('acError')!, acMsg = document.getElementById('acMsg')!;

function queueAccountSave() {
  if (!account) return;
  clearTimeout(accountSaveTimer);
  const id = account.id;
  accountSaveTimer = window.setTimeout(() => {
    void loadAccount().then((m) => m.saveSettings(id, { ...settings } as unknown as Record<string, unknown>));
  }, 800);
}

function syncAccountUi() {
  document.getElementById('accountLabel')!.textContent = account ? account.username : 'Log in';
  document.getElementById('accountBtn')!.classList.toggle('in', !!account);
  acForm.hidden = !!account;
  acSignedIn.hidden = !account;
  if (account) document.getElementById('acName')!.textContent = account.username;
}

/** Logged in: use the settings saved to the account, or save this browser's settings to a new one. */
async function afterLogin(a: { id: string; username: string }, isNew: boolean) {
  account = a;
  syncAccountUi();
  const m = await loadAccount();
  const remote = isNew ? null : await m.loadSettings(a.id);
  if (remote) {
    delete remote.v;
    Object.assign(settings, remote);
    try { localStorage.setItem(STORE, JSON.stringify({ ...settings, v: SETTINGS_VERSION })); } catch { /* storage unavailable */ }
    setView(broadcast, settings.view);
    resize();
    syncViewbar();
    syncMenu();
    describeControls();
    describeFormat();
    renderBinds();
  } else {
    await m.saveSettings(a.id, { ...settings } as unknown as Record<string, unknown>);
  }
}

function openAccount() {
  acError.textContent = acMsg.textContent = '';
  accountModal.classList.remove('hidden');
  syncAccountUi();
  (account ? acNewPass : acUser).focus();
  void loadAccount();
}
const closeAccount = () => { accountModal.classList.add('hidden'); document.getElementById('accountBtn')!.focus(); };
document.getElementById('accountBtn')!.addEventListener('click', openAccount);
document.getElementById('acClose')!.addEventListener('click', closeAccount);
accountModal.addEventListener('click', (e) => { if (e.target === accountModal) closeAccount(); });
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !accountModal.classList.contains('hidden')) closeAccount(); });

async function submitAccount(kind: 'login' | 'signup') {
  const m = await loadAccount();
  const username = m.normalise(acUser.value), passcode = acPass.value;
  const problem = m.problemWith(username, passcode);
  acError.classList.remove('ok');
  if (problem) { acError.textContent = problem; return; }
  acError.textContent = kind === 'login' ? 'Logging in…' : 'Creating your account…';
  const r = kind === 'login' ? await m.logIn(username, passcode) : await m.signUp(username, passcode);
  if (!r.ok) { acError.textContent = r.error; return; }
  acPass.value = '';
  await afterLogin(r.account, kind === 'signup');
  acMsg.classList.add('ok');
  acMsg.textContent = kind === 'signup' ? 'Account created. Your settings are saved to it.' : 'Welcome back. Your saved settings are loaded.';
}
// Show what the typed name will become, and whether it's allowed, before anything is sent.
const acHint = document.getElementById('acHint')!;
const HINT = '3–16 letters, numbers or underscores. Spaces become underscores.';
acUser.addEventListener('input', () => {
  const name = acUser.value.trim().toLowerCase().replace(/\s+/g, '_');
  const ok = /^[a-z0-9_]{3,16}$/.test(name);
  acHint.classList.toggle('bad', !!name && !ok);
  acHint.textContent = !name ? HINT : ok ? `Your username: ${name}` : `“${name}” won’t work. ${HINT}`;
});
acForm.addEventListener('submit', (e) => { e.preventDefault(); void submitAccount('login'); });
document.getElementById('acSignup')!.addEventListener('click', () => void submitAccount('signup'));
document.getElementById('acChange')!.addEventListener('click', async () => {
  const m = await loadAccount();
  acMsg.classList.remove('ok');
  if (acNewPass.value.length < 6) { acMsg.textContent = 'Passcodes need at least 6 characters'; return; }
  const err = await m.changePasscode(acNewPass.value);
  acMsg.classList.toggle('ok', !err);
  acMsg.textContent = err ?? 'Passcode changed';
  if (!err) acNewPass.value = '';
});
document.getElementById('acLogout')!.addEventListener('click', async () => {
  const m = await loadAccount();
  await m.logOut();
  account = null;
  acError.textContent = '';
  syncAccountUi();
  acUser.focus();
});
// Logged in on this browser before: restore the session (Supabase keeps it under this key).
try {
  if (localStorage.getItem('badminton.account')) {
    void loadAccount().then(async (m) => { const a = await m.current(); if (a) await afterLogin(a, false); });
  }
} catch { /* storage unavailable */ }

// ── Tour of the start screen ─────────────────────────────────────────────────
const tour = new Tour([
  { target: '.oop-row.live', title: 'Your match', text: 'Your next match is on Court 1: who you’re playing and the scoring. Press Walk on (or Enter) to play.', before: closeDrawers },
  { target: '#matchcard', title: 'Match card', text: 'Edit match card opens this: singles or doubles, the CPU’s level and style, your doubles partner, 1 or 3 games to 15 or 21, and how accurate shots are.', before: () => openDrawer('card') },
  { target: '.oop-row:has(#tutorial)', title: 'Tutorial', text: 'New to the game? Court 2 is the tutorial: short lessons with a coach feeding you shuttles, from moving to jump smashes and doubles.', before: closeDrawers },
  { target: '.oop-row:has(#practice)', title: 'Practice', text: 'Court 3 is practice: drill any shot against a feeder. In practice, number keys 1–9 switch drills.' },
  { target: '#kitBtn', title: 'Assists & controls', text: 'This tab on the left edge slides out a panel with your assists and controls. Click it again to put it away.' },
  { target: '#kitcard', title: 'Assists', text: 'Turn help on or off: the landing marker (on by default), the timing light, swing assist, doubles auto-switch and the umpire’s voice.', before: () => openDrawer('kit', 'assists') },
  { target: '#kitcard', title: 'Controls and keys', text: 'Choose mouse, trackpad or keyboard-only play, change any key under Your keys, and see how to play every shot.', before: () => openDrawer('kit', 'controls') },
  { target: '#accountBtn', title: 'Your account', text: 'Log in or sign up with a username and passcode to save your settings and keys, so they follow you to any computer.', before: closeDrawers },
  { target: '#whatsnewBtn', title: 'What’s new', text: 'Every update is listed here. A NEW badge appears when there’s something you haven’t seen.' },
  { target: '#viewbar', title: 'View and fullscreen', text: 'Switch between the close and broadcast camera, and go fullscreen (or press F in a match).' },
  { target: '#start', title: 'Ready?', text: 'That’s everything. Press Walk on to start your match, or come back to this tour any time from the bottom of the board.' },
], () => document.getElementById('tourBtn')?.focus());
document.getElementById('tourBtn')!.addEventListener('click', () => { closeAccountIfOpen(); tour.start(); });
function closeAccountIfOpen() { if (!accountModal.classList.contains('hidden')) accountModal.classList.add('hidden'); }

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
      renderBinds();
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
  } else if (input.tapped(['Enter']) && accountModal.classList.contains('hidden') && !tour.isOpen) {
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
