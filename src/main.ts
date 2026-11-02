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
import { CODE_PATTERN, QueueConnection, RoomConnection, newRoomCode, type GameMsg, type QueueEvent, type ServerMsg } from './net';
import { tierOf } from './rating';
import { addCareer, careerDelta, loadLocalCareer, saveLocalCareer, statGroups, type Career } from './career';
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
const acForm = document.getElementById('acForm') as HTMLFormElement;
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

/** Your rating and record, once loaded (logged in only). */
let myRating: { rating: number; wins: number; losses: number } | null = null;

/** Your career stats: from your account when logged in, otherwise kept on this computer. */
let career: Career = loadLocalCareer();

function syncAccountUi() {
  document.getElementById('accountLabel')!.textContent = account ? `${account.username}${myRating ? ` · ${myRating.rating}` : ''}` : 'Log in';
  document.getElementById('accountBtn')!.classList.toggle('in', !!account);
  // Social screen: who you are, your tier and rating, and what needs a login.
  document.getElementById('socialName')!.textContent = account ? account.username : 'Guest';
  document.getElementById('socialKicker')!.textContent = account ? 'Player profile' : 'Not logged in · stats on this computer';
  const tierEl = document.getElementById('socialTier')!;
  const t = myRating ? tierOf(myRating.rating) : null;
  tierEl.textContent = t ? t.name : account ? '' : 'Log in to get a rating';
  tierEl.style.setProperty('--tier', t?.color ?? '#8ea6d8');
  document.getElementById('heroRating')!.textContent = myRating ? String(myRating.rating) : '–';
  document.getElementById('heroRecord')!.textContent = myRating ? `${myRating.wins}–${myRating.losses}` : '–';
  const played = career.matches ?? 0;
  document.getElementById('heroWinPct')!.textContent = played ? `${Math.round((100 * (career.wins ?? 0)) / played)}%` : '–';
  document.getElementById('accountTab')!.hidden = !account;
  document.getElementById('friendsLogin')!.hidden = !!account;
  document.getElementById('friendsArea')!.hidden = !account;
  document.getElementById('matchesLogin')!.hidden = !!account;
  document.getElementById('acMatches')!.hidden = !account;
  if (account) document.getElementById('acName')!.textContent = account.username;
  renderStats();
}

/** The Stats tab: your career in groups of tiles. */
function renderStats() {
  document.getElementById('statsScope')!.innerHTML = account
    ? `Every finished match against the CPU or online counts. <b>${(career.matches ?? 0).toLocaleString('en-GB')}</b> so far.`
    : 'These stats are saved on this computer only. <button type="button" class="inline-link" data-login>Log in</button> to keep them on your account and play ranked.';
  document.getElementById('statGroups')!.innerHTML = statGroups(career).map((g) => `
    <div class="stat-group${g.title === 'Highlights' ? ' highlights' : ''}">
      <h3>${g.title}</h3>
      <div class="tiles">${g.tiles.map((t) => `<div class="tile${t.big ? ' big' : ''}"><b>${t.value}</b><span>${t.label}</span>${t.hint ? `<em>${t.hint}</em>` : ''}</div>`).join('')}</div>
    </div>`).join('');
}

/** Reload your rating (after logging in, opening the hub, or a ranked match). */
async function refreshStats() {
  if (!account) { career = loadLocalCareer(); syncAccountUi(); return; }
  void loadAccount().then(async (m) => { const c = await m.myCareer(); if (c) { career = c; syncAccountUi(); } });
  const m = await loadAccount();
  const s = await m.myStats();
  if (s) myRating = { rating: s.rating, wins: s.wins, losses: s.losses };
  syncAccountUi();
}

/** Logged in: use the settings saved to the account, or save this browser's settings to a new one. */
async function afterLogin(a: { id: string; username: string }, isNew: boolean) {
  account = a;
  syncAccountUi();
  void refreshStats();
  startPresence();
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
    syncControlsLabel();
    // An account that has never picked its controls gets asked once.
    if (!settings.controlsChosen) openControlsPick();
  } else {
    await m.saveSettings(a.id, { ...settings } as unknown as Record<string, unknown>);
  }
}

/** The account chip: log in (or, when you're logged in, your Social profile). */
function openAccount(note?: string) {
  if (account) { openSocial('overview'); return; }
  acError.classList.remove('ok');
  acError.textContent = note ?? '';
  acMsg.textContent = '';
  closeSocial();
  accountModal.classList.remove('hidden');
  syncAccountUi();
  acUser.focus();
  void loadAccount();
}

/** Add a finished match to your career: on your account if you're logged in, otherwise on this computer. */
function recordCareer(g: Game) {
  if (g.mode !== 'match' && g.mode !== 'online') return;
  const delta = careerDelta(g, career);
  career = addCareer(career, delta);
  if (!account) { saveLocalCareer(career); return; }
  void loadAccount().then(async (m) => { const saved = await m.addCareer(delta); if (saved) career = saved; });
}

// ── Social screen ────────────────────────────────────────────────────────────
const social = document.getElementById('social')!;
function openSocial(tab = 'overview') {
  social.classList.remove('hidden');
  syncAccountUi();
  showHubTab(tab);
  void refreshStats();
  if (account) { void renderMatches(); void renderFriends(); }
  document.getElementById('socialClose')!.focus();
}
function closeSocial() { social.classList.add('hidden'); }
document.getElementById('socialBtn')!.addEventListener('click', () => openSocial());
document.getElementById('socialClose')!.addEventListener('click', () => { closeSocial(); document.getElementById('socialBtn')!.focus(); });
social.addEventListener('click', (e) => {
  if (e.target === social) closeSocial();
  if ((e.target as HTMLElement).closest('[data-login]')) openAccount('Log in or sign up to save your stats, add friends and play ranked.');
});
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !social.classList.contains('hidden')) closeSocial(); });
const closeAccount = () => { accountModal.classList.add('hidden'); document.getElementById('accountBtn')!.focus(); };
document.getElementById('accountBtn')!.addEventListener('click', () => openAccount());
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
  // Straight to your profile.
  accountModal.classList.add('hidden');
  openSocial('overview');
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
  myRating = null;
  career = loadLocalCareer();
  stopPresence();
  acError.textContent = '';
  syncAccountUi();
  acUser.focus();
});

// ── Player hub: profile, friends, leaderboard ────────────────────────────────
const hubEsc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function showHubTab(name: string) {
  document.querySelectorAll<HTMLButtonElement>('[data-hub]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.hub === name)));
  document.querySelectorAll<HTMLElement>('[data-hubpane]').forEach((p) => { p.hidden = p.dataset.hubpane !== name; });
  if (name === 'friends') void renderFriends();
  if (name === 'leaders') void renderLeaders();
}
document.querySelectorAll<HTMLButtonElement>('[data-hub]').forEach((t) => t.addEventListener('click', () => showHubTab(t.dataset.hub!)));



async function renderMatches() {
  const m = await loadAccount();
  const rows = await m.myMatches();
  const list = document.getElementById('acMatches')!;
  list.innerHTML = rows.length ? rows.map((r) => {
    const when = new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `<li><span class="${r.won ? 'won' : 'lost'}">${r.won ? 'W' : 'L'}</span><span class="grow">v ${hubEsc(r.opponent)}<span class="sub">${hubEsc(r.score)} · ${when}</span></span><b class="${r.change >= 0 ? 'won' : 'lost'}">${r.change >= 0 ? '+' : ''}${r.change}</b></li>`;
  }).join('') : '<li class="empty">No ranked matches yet. Try Quick match on Court 4.</li>';
}

/** Fill a leaderboard list (the hub's tab or the footer pop-up). Anyone can see it, logged in or not. */
async function renderLeaders(listId = 'leaderList') {
  const m = await loadAccount();
  const rows = await m.leaderboard();
  document.getElementById(listId)!.innerHTML = rows.length ? rows.map((r, i) => {
    const t = tierOf(r.rating);
    return `<li class="${r.username === account?.username ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="grow">${hubEsc(r.username)}<span class="sub" style="color:${t.color === '#cbd5e1' ? '#64748b' : t.color}">${t.name}</span></span><span class="sub">${r.wins}–${r.losses}</span><b>${r.rating}</b></li>`;
  }).join('') : '<li class="empty">Nobody has played a ranked match yet. Be the first.</li>';
}

let friendRows: import('./account').Friend[] = [];
async function renderFriends() {
  if (!account) return;
  const m = await loadAccount();
  friendRows = await m.friendsList();
  const incoming = friendRows.filter((f) => f.direction === 'incoming').length;
  const badge = document.getElementById('friendBadge')!;
  badge.hidden = !incoming;
  badge.textContent = String(incoming);
  const list = document.getElementById('friendList')!;
  list.innerHTML = friendRows.length ? friendRows.map((f) => {
    const name = `<span class="grow">${hubEsc(f.username)}<span class="sub">${f.direction === 'friend' ? (f.online ? 'Online' : 'Offline') + ` · ${f.rating}` : f.direction === 'incoming' ? 'Wants to be friends' : 'Request sent'}</span></span>`;
    const actions = f.direction === 'friend'
      ? `<button class="primary" data-act="invite" data-id="${f.id}" ${f.online ? '' : 'disabled'}>Invite</button><button class="quiet" data-act="remove" data-id="${f.id}">Remove</button>`
      : f.direction === 'incoming'
        ? `<button class="primary" data-act="accept" data-id="${f.id}">Accept</button><button class="quiet" data-act="decline" data-id="${f.id}">Decline</button>`
        : `<button class="quiet" data-act="remove" data-id="${f.id}">Cancel</button>`;
    return `<li><span class="dot ${f.direction === 'friend' && f.online ? 'on' : ''}"></span>${name}${actions}</li>`;
  }).join('') : '<li class="empty">No friends yet. Add someone by their username.</li>';
}
document.getElementById('friendList')!.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.act) return;
  const m = await loadAccount(), id = b.dataset.id!;
  if (b.dataset.act === 'accept') await m.respondFriendRequest(id, true);
  else if (b.dataset.act === 'decline') await m.respondFriendRequest(id, false);
  else if (b.dataset.act === 'remove') await m.removeFriend(id);
  else if (b.dataset.act === 'invite') {
    // Make a private room, invite them to it and go to its lobby.
    const code = newRoomCode();
    const r = await m.sendInvite(id, code);
    if (r !== 'sent') { document.getElementById('friendMsg')!.textContent = 'Couldn’t send the invite. Try again.'; return; }
    accountModal.classList.add('hidden');
    openRoom(code);
    const f = friendRows.find((x) => x.id === id);
    roomStatus.textContent = `Invite sent to ${f?.username ?? 'your friend'}. Waiting for them to join…`;
    return;
  }
  void renderFriends();
});
document.getElementById('friendForm')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('friendName') as HTMLInputElement, msg = document.getElementById('friendMsg')!;
  const name = input.value.trim();
  if (!name) return;
  const m = await loadAccount();
  const r = await m.sendFriendRequest(name);
  const text: Record<string, string> = {
    sent: 'Request sent. They’ll see it in their Friends tab.', accepted: 'You’re now friends.', already: 'You’ve already added them.',
    no_such_player: 'No player with that username.', self: 'That’s you!', too_many: 'You have too many requests waiting. Cancel some first.',
  };
  msg.classList.toggle('ok', r === 'sent' || r === 'accepted');
  msg.textContent = (r && text[r]) ?? 'Couldn’t send that. Try again.';
  if (r === 'sent' || r === 'accepted') input.value = '';
  void renderFriends();
});

// ── Online presence and invites ──────────────────────────────────────────────
// While you're logged in: tell the server you're online every minute, and check for invites from
// friends every 15 seconds (not during a match).
let presenceTimer = 0, inviteTimer = 0;
const seenInvites = new Set<number>();
let shownInvite: import('./account').Invite | null = null;
const inviteToast = document.getElementById('inviteToast')!;
function startPresence() {
  stopPresence();
  const beat = () => { if (document.visibilityState === 'visible') void loadAccount().then((m) => m.heartbeat()); };
  beat();
  presenceTimer = window.setInterval(beat, 60_000);
  const check = async () => {
    if (!account || game || shownInvite || document.visibilityState !== 'visible') return;
    const m = await loadAccount();
    const inv = (await m.myInvites()).find((i) => !seenInvites.has(i.id));
    if (!inv) return;
    shownInvite = inv;
    document.getElementById('inviteText')!.innerHTML = `<b>${hubEsc(inv.from_name)}</b> invited you to play`;
    inviteToast.hidden = false;
  };
  void check();
  inviteTimer = window.setInterval(check, 15_000);
}
function stopPresence() { clearInterval(presenceTimer); clearInterval(inviteTimer); inviteToast.hidden = true; shownInvite = null; }
async function closeInvite(join: boolean) {
  const inv = shownInvite;
  inviteToast.hidden = true;
  shownInvite = null;
  if (!inv) return;
  seenInvites.add(inv.id);
  void loadAccount().then((m) => m.dismissInvite(inv.id));
  if (join && !game) openRoom(inv.room);
}
document.getElementById('inviteJoin')!.addEventListener('click', () => void closeInvite(true));
document.getElementById('inviteDismiss')!.addEventListener('click', () => void closeInvite(false));
// Logged in on this browser before: restore the session (Supabase keeps it under this key).
try {
  if (localStorage.getItem('badminton.account')) {
    void loadAccount().then(async (m) => { const a = await m.current(); if (a) await afterLogin(a, false); });
  }
} catch { /* storage unavailable */ }

// ── Tour of the start screen ─────────────────────────────────────────────────
const tour = new Tour([
  { target: '.oop-row.live', title: 'Your match', text: 'Court 1 is your next match against the CPU: who you’re playing and the scoring. Press Walk on (or Enter) to play.', before: () => { closeDrawers(); closeSocial(); } },
  { target: '#controlsBtn', title: 'Your controls', text: 'How you play: keyboard and mouse, keys with a trackpad, or keyboard only. Click it any time to switch.' },
  { target: '#matchcard', title: 'Match card', text: 'Edit match card opens this: singles or doubles, the CPU’s level and style, your doubles partner, 1 or 3 games to 15 or 21, and how accurate shots are.', before: () => openDrawer('card') },
  { target: '.oop-row:has(#tutorial)', title: 'Tutorial', text: 'New to the game? Court 2 is the tutorial: short lessons with a coach feeding you shuttles, from moving to jump smashes and doubles.', before: closeDrawers },
  { target: '.oop-row:has(#practice)', title: 'Practice', text: 'Court 3 is practice: drill any shot against a feeder. In practice, number keys 1–9 switch drills.' },
  { target: '.oop-row:has(#quickMatch)', title: 'Play online', text: 'Court 4. Quick match finds someone near your rating for a ranked game (log in first). Create room gives you a code to send a friend, and Join takes you into theirs.' },
  { target: '#kitBtn', title: 'Assists & controls', text: 'This tab on the left edge slides out your assists and controls. Click it again to put it away.' },
  { target: '#kitcard', title: 'Assists', text: 'Turn help on or off: the landing marker (on by default), the timing light, swing assist, doubles auto-switch and the umpire’s voice.', before: () => openDrawer('kit', 'assists') },
  { target: '#kitcard', title: 'Controls and keys', text: 'Switch control mode, change any key under Your keys, and see how to play every shot.', before: () => openDrawer('kit', 'controls') },
  { target: '#socialBtn', title: 'Social', text: 'Everything about you and other players: your stats, friends, the leaderboard and your ranked matches.', before: () => { closeDrawers(); closeSocial(); } },
  { target: '.social-panel', title: 'Your stats', text: 'Every finished match adds up: fastest smash, longest rally, win streaks, aces, perfect jumps and more. The tabs along the top have your friends, the top 50 and your ranked history.', before: () => openSocial('overview') },
  { target: '#accountBtn', title: 'Your account', text: 'Log in or sign up with a username and passcode to keep your stats and settings on any computer, play ranked and add friends. Once you’re in, it shows your rating.', before: closeSocial },
  { target: '.board-foot', title: 'Help and updates', text: 'How to play lists every shot and key, Take the tour brings you back here, and What’s new shows every update (with a NEW badge when there’s one you haven’t seen).' },
  { target: '#viewbar', title: 'View and fullscreen', text: 'Switch between the close and broadcast camera, and go fullscreen (or press F in a match).' },
  { target: '#start', title: 'Ready?', text: 'That’s everything. Press Walk on to play the CPU, or try Court 4 to play someone online.' },
], () => { closeSocial(); closeDrawers(); document.getElementById('tourBtn')?.focus(); });
document.getElementById('tourBtn')!.addEventListener('click', () => { closeAccountIfOpen(); tour.start(); });
function closeAccountIfOpen() { if (!accountModal.classList.contains('hidden')) accountModal.classList.add('hidden'); }

// ── Controls picker (first visit, and the Controls button at the top) ────────
const CONTROL_NAMES: Record<Settings['p1Control'], string> = { mouse: 'Keyboard + mouse', hybrid: 'Keys + trackpad', keyboard: 'Keyboard only' };
const controlsPick = document.getElementById('controlsPick')!;
function syncControlsLabel() { document.getElementById('controlsLabel')!.textContent = CONTROL_NAMES[settings.p1Control]; }
function renderControlsPick() {
  const kb = (a: BindAction) => `<kbd>${keyLabel(keyFor(settings.keys, a))}</kbd>`;
  const move = `${kb('up')}${kb('left')}${kb('down')}${kb('right')}`;
  const icons = {
    mouse: '<svg viewBox="0 0 48 48"><rect x="16" y="6" width="16" height="28" rx="8"/><path d="M24 6v10M10 42h28"/></svg>',
    hybrid: '<svg viewBox="0 0 48 48"><rect x="6" y="12" width="36" height="24" rx="4"/><path d="M14 30h20"/></svg>',
    keyboard: '<svg viewBox="0 0 48 48"><rect x="4" y="14" width="40" height="20" rx="3"/><path d="M10 20h2M16 20h2M22 20h2M28 20h2M34 20h2M14 28h20"/></svg>',
  };
  const cards: [Settings['p1Control'], string, string, string][] = [
    ['mouse', 'You have a mouse. Move with the keyboard, aim and hit with the mouse.',
      `<li><b>Move</b>${move}</li><li><b>Aim</b>Point the cursor</li><li><b>Hit</b>Left-click: drive, hold to smash · right-click: drop, hold for a clear</li>`, 'Best with a mouse'],
    ['hybrid', 'On a laptop trackpad. Hit with keys, aim by moving the cursor.',
      `<li><b>Move</b>${move}</li><li><b>Aim</b>Trackpad cursor</li><li><b>Hit</b>${kb('high')} high · ${kb('fast')} fast · ${kb('soft')} soft</li>`, ''],
    ['keyboard', 'Just the keyboard. Aim with two keys or let the game pick the open side.',
      `<li><b>Move</b>${move}</li><li><b>Aim</b>${kb('aimLeft')} left · ${kb('aimRight')} right</li><li><b>Hit</b>${kb('high')} high · ${kb('fast')} fast · ${kb('soft')} soft</li>`, ''],
  ];
  document.getElementById('pickCards')!.innerHTML = cards.map(([mode, blurb, keys, rec]) => `
    <button type="button" class="pick-card${settings.p1Control === mode ? ' on' : ''}" data-mode="${mode}">
      ${rec ? `<span class="rec">${rec}</span>` : ''}${icons[mode]}
      <h3>${CONTROL_NAMES[mode]}</h3><p>${blurb}</p><ul>${keys}</ul>
      <span class="go-line">Play this way →</span>
    </button>`).join('');
}
function openControlsPick() {
  renderControlsPick();
  controlsPick.classList.remove('hidden');
  controlsPick.querySelector<HTMLButtonElement>('.pick-card.on')?.focus();
}
function closeControlsPick() {
  controlsPick.classList.add('hidden');
  if (!settings.controlsChosen) { settings.controlsChosen = true; saveSettings(); }
}
document.getElementById('pickCards')!.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
  if (!card) return;
  settings.p1Control = card.dataset.mode as Settings['p1Control'];
  settings.controlsChosen = true;
  saveSettings();
  syncMenu();
  describeControls();
  renderBinds();
  syncControlsLabel();
  controlsPick.classList.add('hidden');
});
document.getElementById('controlsBtn')!.addEventListener('click', openControlsPick);
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !controlsPick.classList.contains('hidden')) closeControlsPick(); });
syncControlsLabel();
// First visit: ask before anything else.
if (!settings.controlsChosen) openControlsPick();

// ── Online rooms (Court 4) ───────────────────────────────────────────────────
const roomModal = document.getElementById('roomModal')!;
const roomJoin = document.getElementById('roomJoin')!, roomLobby = document.getElementById('roomLobby')!;
const roomCodeIn = document.getElementById('roomCodeIn') as HTMLInputElement, roomJoinMsg = document.getElementById('roomJoinMsg')!;
const roomStart = document.getElementById('roomStart') as HTMLButtonElement, roomStatus = document.getElementById('roomStatus')!;
let room: RoomConnection | null = null;
let roomSettings = { games: settings.games, points: settings.points };
/** The other player asked for a rematch. */
let peerRematch = false;

/** Logged in: your username. Otherwise a guest name kept for this browser. */
function myName(): string {
  if (account) return account.username;
  try {
    let g = localStorage.getItem('badminton.guestName');
    if (!g) { g = `guest_${Math.floor(1000 + Math.random() * 9000)}`; localStorage.setItem('badminton.guestName', g); }
    return g;
  } catch { return 'guest'; }
}

/** A secret per room, kept for this tab, so reloading or a dropped connection gets your seat back. */
function roomToken(code: string): string {
  const key = `badminton.room.${code}`;
  try {
    let t = sessionStorage.getItem(key);
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem(key, t); }
    return t;
  } catch { return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); }
}

function showRoomView(view: 'join' | 'lobby' | 'queue') {
  roomModal.classList.remove('hidden');
  roomJoin.hidden = view !== 'join';
  roomLobby.hidden = view !== 'lobby';
  document.getElementById('roomQueue')!.hidden = view !== 'queue';
  document.getElementById('roomTitle')!.textContent = view === 'join' ? 'Join a room' : view === 'queue' ? 'Quick match' : room?.roster?.ranked ? 'Ranked match' : 'Your room';
}

function renderLobby() {
  if (!room) return;
  const r = room.roster, host = r?.you === 'host';
  document.getElementById('roomCode')!.textContent = room.code;
  const row = (id: string, p: { name: string; connected: boolean } | null | undefined, mine: boolean, role: string) => {
    const li = document.getElementById(id)!;
    li.className = p ? (p.connected ? 'on' : 'away') : '';
    li.innerHTML = p ? `${p.name}${mine ? ' (you)' : ''}<em>${p.connected ? role : 'reconnecting'}</em>` : `Waiting for your opponent…<em>${role}</em>`;
  };
  row('roomHost', r?.host, r?.you === 'host', 'host');
  row('roomGuest', r?.guest, r?.you === 'guest', 'guest');
  for (const [id, key] of [['roomGames', 'games'], ['roomPoints', 'points']] as const) {
    const seg = document.getElementById(id)!;
    seg.classList.toggle('locked', !host);
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === roomSettings[key]));
  }
  const ready = !!(r?.host?.connected && r?.guest?.connected);
  // Ranked rooms: no code to share and no settings; the match starts by itself once you're both in.
  const ranked = r?.ranked;
  document.querySelector<HTMLElement>('#roomLobby .room-code')!.hidden = !!ranked;
  document.querySelector<HTMLElement>('#roomLobby .field-row')!.hidden = !!ranked;
  document.getElementById('roomTitle')!.textContent = ranked ? 'Ranked match' : 'Your room';
  // Each player's round trip to the server, so a slow connection is easy to spot before playing.
  const conn = ready && room.rtt && room.peerRtt
    ? ` Connection: you ${Math.round(room.rtt)} ms, them ${Math.round(room.peerRtt)} ms${room.latency >= 150 ? ' (laggy: try moving closer to the Wi-Fi)' : ''}.`
    : '';
  if (ranked) {
    roomStart.hidden = true;
    roomStatus.textContent = (ready ? 'Both here. Starting…' : 'Ranked · 1 game to 21 · starts as soon as you’re both connected') + conn;
    return;
  }
  roomStart.hidden = !host;
  roomStart.disabled = !ready;
  roomStatus.textContent = (room.status === 'connecting' ? 'Connecting…'
    : room.status === 'reconnecting' ? 'Connection lost, reconnecting…'
    : !ready ? (host ? 'Send your friend the code or the invite link. You can start once they join.' : 'Waiting for the host…')
    : host ? 'Both here. Press Start match when you’re ready.' : 'Both here. Waiting for the host to start.') + conn;
}

function openRoom(code: string) {
  leaveRoom();
  room = new RoomConnection(code, roomToken(code), myName());
  room.on(onRoomMsg);
  // Reloading the page brings you back to the same seat in this room.
  history.replaceState(null, '', `/play?room=${code}`);
  showRoomView('lobby');
  renderLobby();
}

function leaveRoom() {
  game?.dispose();
  room?.close();
  room = null;
  peerRematch = false;
  if (location.search.includes('room=')) history.replaceState(null, '', '/play');
}

function onRoomMsg(m: GameMsg | ServerMsg) {
  if (!room) return;
  switch (m.type) {
    case 'roster':
      if (m.ranked) roomSettings = (m.settings as typeof roomSettings) ?? { games: 1, points: 21 };
      else if (m.you === 'host') room.send({ type: 'settings', settings: roomSettings });
      else if (m.settings) roomSettings = m.settings as typeof roomSettings;
      // Ranked: the host's screen starts the match as soon as both players are connected.
      if (m.ranked && m.you === 'host' && m.host?.connected && m.guest?.connected && !game) {
        room.send({ type: 'start', settings: roomSettings });
        startOnline(true);
      }
      break;
    case 'result':
      if (game?.online) game.rankedResult = m;
      void refreshStats();
      void renderMatches();
      break;
    case 'settings': roomSettings = m.settings as typeof roomSettings; break;
    case 'start': roomSettings = m.settings as typeof roomSettings; startOnline(false); break;
    case 'rematch':
      peerRematch = true;
      if (room.roster?.you === 'host' && game?.rematchAsked) restartOnline();
      break;
    case 'full':
      showRoomView('join');
      roomJoinMsg.textContent = 'That room already has two players.';
      room = null;
      return;
  }
  renderLobby();
}

function startOnline(host: boolean) {
  const r = room?.roster, opp = host ? r?.guest : r?.host;
  if (!room || !opp) return;
  game?.dispose();
  sound.init();
  voice.enabled = settings.voice;
  voice.unlock();
  peerRematch = false;
  const ranked = r?.ranked ? { mine: host ? r.ranked.host : r.ranked.guest, theirs: host ? r.ranked.guest : r.ranked.host } : null;
  game = new Game({ ...settings, games: roomSettings.games as 1 | 3, points: roomSettings.points as 15 | 21 }, input, broadcast, 'online', { conn: room, host, opponentName: opp.name, ranked });
  game.onMatchOver = recordCareer;
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  closeDrawers();
  roomModal.classList.add('hidden');
  menu.classList.add('hidden');
  (document.activeElement as HTMLElement | null)?.blur();
}

/** Host: both asked for a rematch, so start a fresh match on both screens. */
function restartOnline() {
  room?.send({ type: 'start', settings: roomSettings });
  startOnline(true);
}

function askRematch() {
  if (!game?.online || game.rematchAsked || game.forfeitWinner !== null) return;
  game.rematchAsked = true;
  room?.send({ type: 'rematch' });
  if (room?.roster?.you === 'host' && peerRematch) restartOnline();
}

// ── Quick match ──────────────────────────────────────────────────────────────
let queue: QueueConnection | null = null;
let queueTimer = 0;
async function startQuickMatch() {
  if (!account) { openAccount('Log in or sign up to play ranked quick matches.'); return; }
  const m = await loadAccount();
  const token = await m.accessToken();
  if (!token) { openAccount('Your login has expired. Log in again to play quick match.'); return; }
  leaveRoom();
  showRoomView('queue');
  const started = Date.now();
  const info = document.getElementById('queueInfo')!, title = document.getElementById('queueTitle')!, time = document.getElementById('queueTime')!;
  title.textContent = 'Finding an opponent…';
  info.textContent = 'Connecting…';
  clearInterval(queueTimer);
  queueTimer = window.setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  queue?.cancel();
  queue = new QueueConnection(token, (e: QueueEvent) => {
    if (e.type === 'queued') {
      const t = tierOf(e.rating);
      info.textContent = `Looking for someone near your rating (${e.rating}, ${t.name}). The range widens the longer you wait.`;
    } else if (e.type === 'matched') {
      clearInterval(queueTimer);
      queue = null;
      title.textContent = `Matched with ${e.opponent.name} (${e.opponent.rating})`;
      info.textContent = 'Joining the match…';
      // Your ticket is your seat: keep it for this tab so a reload gets you back in.
      try { sessionStorage.setItem(`badminton.room.${e.code}`, e.ticket); } catch { /* storage unavailable */ }
      history.replaceState(null, '', `/play?room=${e.code}`);
      room = new RoomConnection(e.code, e.ticket, myName());
      room.on(onRoomMsg);
      showRoomView('lobby');
      renderLobby();
    } else {
      clearInterval(queueTimer);
      queue = null;
      title.textContent = 'Couldn’t find a match';
      info.textContent = e.type === 'error' && e.error === 'login' ? 'Your login has expired. Log in again and retry.'
        : e.type === 'error' && e.error === 'replaced' ? 'You started searching in another tab.'
        : 'Lost the connection to the match server. Check your internet and try again.';
    }
  });
}
function cancelQuickMatch() {
  queue?.cancel();
  queue = null;
  clearInterval(queueTimer);
  roomModal.classList.add('hidden');
}
document.getElementById('quickMatch')!.addEventListener('click', () => void startQuickMatch());
document.getElementById('queueCancel')!.addEventListener('click', cancelQuickMatch);

document.getElementById('createRoom')!.addEventListener('click', () => openRoom(newRoomCode()));
document.getElementById('joinRoom')!.addEventListener('click', () => {
  roomJoinMsg.textContent = '';
  showRoomView('join');
  roomCodeIn.focus();
});
function joinTyped() {
  const code = roomCodeIn.value.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) { roomJoinMsg.textContent = 'Room codes are 5 letters and numbers.'; return; }
  openRoom(code);
}
document.getElementById('roomJoinGo')!.addEventListener('click', joinTyped);
roomCodeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); joinTyped(); } });
roomStart.addEventListener('click', () => {
  if (room?.roster?.you !== 'host') return;
  room.send({ type: 'start', settings: roomSettings });
  startOnline(true);
});
for (const [id, key] of [['roomGames', 'games'], ['roomPoints', 'points']] as const) {
  document.getElementById(id)!.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    if (room?.roster?.you !== 'host') return;
    roomSettings = { ...roomSettings, [key]: Number(b.dataset.value) };
    room.send({ type: 'settings', settings: roomSettings });
    renderLobby();
  }));
}
document.getElementById('roomCopy')!.addEventListener('click', async (e) => {
  if (!room) return;
  const btn = e.currentTarget as HTMLButtonElement;
  try { await navigator.clipboard.writeText(`${location.origin}/play?room=${room.code}`); btn.textContent = 'Copied!'; }
  catch { btn.textContent = room.code; }
  setTimeout(() => { btn.textContent = 'Copy invite link'; }, 1600);
});
const closeRoom = () => { cancelQuickMatch(); leaveRoom(); roomModal.classList.add('hidden'); };
document.getElementById('roomClose')!.addEventListener('click', closeRoom);
document.getElementById('roomLeave')!.addEventListener('click', closeRoom);
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !game && !roomModal.classList.contains('hidden')) closeRoom(); });
// Keep the lobby's connection status fresh.
setInterval(() => { if (room && !roomModal.classList.contains('hidden')) renderLobby(); }, 1000);
// An invite link (…/play?room=ABCDE) opens that room straight away.
{
  const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
  if (code && CODE_PATTERN.test(code)) openRoom(code);
}

// What's new pop-up: newest version first, with a NEW badge on the button until you've opened it.
const SEEN = 'badminton.seenVersion';
const latest = CHANGELOG[0].version;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const modal = document.getElementById('changelogModal')!;
const wnBadge = document.getElementById('wnBadge')!;
document.getElementById('wnTitle')!.textContent = `What’s new in v${latest}`;
document.getElementById('wnVer')!.textContent = `v${latest}`;
// Short: one line per version (its title and the gist of its first change). Full: every change.
const gist = (text: string) => {
  const first = text.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
  return first.length > 78 ? `${first.slice(0, 76).trimEnd()}…` : first;
};
const CHANGELOG_VIEW = 'badminton.changelogView';
function renderChangelog(view: 'short' | 'full') {
  const box = document.getElementById('changelog')!;
  box.classList.toggle('short', view === 'short');
  box.innerHTML = view === 'short'
    ? `<ol class="wn-short">${CHANGELOG.map((v) => `<li><b>v${v.version}</b><span class="t">${esc(v.title)}</span><span class="g">${esc(gist(v.changes[0] ?? ''))}</span></li>`).join('')}</ol>`
    : CHANGELOG.map((v) => `<h4>v${v.version}: ${esc(v.title)} <span>· ${v.date}</span></h4><ul>${v.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`).join('');
  document.querySelectorAll<HTMLButtonElement>('.wn-toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
}
let changelogView: 'short' | 'full' = 'short';
try { if (localStorage.getItem(CHANGELOG_VIEW) === 'full') changelogView = 'full'; } catch { /* storage unavailable */ }
renderChangelog(changelogView);
document.querySelectorAll<HTMLButtonElement>('.wn-toggle button').forEach((b) => b.addEventListener('click', () => {
  changelogView = b.dataset.view as 'short' | 'full';
  try { localStorage.setItem(CHANGELOG_VIEW, changelogView); } catch { /* storage unavailable */ }
  renderChangelog(changelogView);
}));
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
  document.querySelectorAll<HTMLElement>('.seg[data-group]').forEach((seg) => {
    const group = seg.dataset.group as keyof Settings;
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', parse(b.dataset.value!) === settings[group]));
  });
}

document.querySelectorAll<HTMLElement>('.seg[data-group]').forEach((seg) => {
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
      syncControlsLabel();
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
  game.onMatchOver = recordCareer;
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

/** Keys during an online match: quick chat, pause (between points), forfeit, rematch, leave. */
function onlineKeys(g: Game, over: boolean) {
  for (let i = 0; i < 6; i++) if (input.tapped([`Digit${i + 1}`])) g.sendChat(i);
  if (input.tapped(['Escape'])) {
    if (over) { leaveRoom(); showMenu(); return; }
    if (!g.peerAway) g.setOnlinePause(!(g.paused && g.pausedBy === 'you'));
  }
  if (g.paused && g.pausedBy === 'you' && input.tapped(['KeyQ'])) {
    room?.send({ type: 'forfeit' });
    leaveRoom();
    showMenu();
    return;
  }
  // Ranked matches don't rematch: Enter looks for the next opponent.
  if (input.tapped(['Enter'])) { if (over) { if (g.online?.ranked) { leaveRoom(); showMenu(); startQuickMatch(); } else askRematch(); } else if (!g.paused) g.skip(); }
  if (over && input.tapped(UI_KEYS.replay)) g.toggleReplay();
}

// ── Loop ─────────────────────────────────────────────────────────────────────

let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  const w = innerWidth, h = innerHeight;

  if (game) {
    const over = game.state === 'matchOver';
    if (game.online) onlineKeys(game, over);
    else if (input.tapped(['Escape'])) { if (over || game.session) showMenu(); else game.paused = !game.paused; }
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
    if (game && !game.paused && !game.online) {
      if (input.tapped(UI_KEYS.challenge)) game.requestChallenge();
      if (input.tapped(UI_KEYS.replay)) game.toggleReplay();
      if (input.tapped(UI_KEYS.replayCamera)) game.toggleReplayCamera();
    }
    if (game?.online) { /* handled in onlineKeys */ }
    else if (game?.paused && input.tapped(['KeyQ'])) showMenu();
    else if (game && input.tapped(['Enter'])) {
      if (game.state === 'matchOver') startMatch('match');
      else game.skip();
    }
    if (game?.session?.done) showMenu();
  } else if (input.tapped(['Enter']) && accountModal.classList.contains('hidden') && roomModal.classList.contains('hidden') && social.classList.contains('hidden') && controlsPick.classList.contains('hidden') && !tour.isOpen) {
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
      : { players: game.players, shuttle: game.shuttleView, live: true };
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
