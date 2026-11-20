import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/barlow-semi-condensed/500';
import '@fontsource/barlow-semi-condensed/600';
import '@fontsource/barlow-semi-condensed/700';
import '@fontsource/saira-condensed/latin-700.css';
import '@fontsource/saira-condensed/latin-800.css';
import '@fontsource/saira-condensed/latin-900.css';
import './menu.css';
import { Sound } from './audio';
import { Camera, REPLAY_CAMS, VIEWS, broadcastCamera, reverseCamera, setView, sideCamera, type ReplayCam } from './camera';
import { ZONE_NAMES, loadMemory } from './ai';
import { drawHeat, loadSessions, recordHeat, type ShotKind } from './heatmap';
import { DEFAULT_CHARACTER, RARITY, ROSTER_HASH, characterById, rosterFor, statTotal } from '../shared/characters';
import { drawPentagon } from './pentagon';
import { defaultSetup, type MatchSetup } from './setup';
import { ACHIEVEMENTS, achievementDelta, checkAchievements, loadUnlocked, type Achievement } from './achievements';
import { deleteHighlight, loadHighlights, saveHighlight, type Highlight } from './highlights';
import { Playback } from './replay';
import { CHANGELOG } from './changelog';
import { DEFAULT_LOOK } from './brands';
import { openPlayerCard } from './playercard';
import { titleChips, titleSummary } from './titles';
import { COURT_THEMES, LEVEL_LABEL, REPLAY, RULES, STYLES, UI_KEYS, type Level } from './config';
import { showWalkOn, type WalkOnInfo } from './walkon';
import { Game, type Mode, type Settings } from './game';
import { drawReview } from './hawkeye';
import { Hud } from './hud';
import { Input } from './input';
import { Tour } from './tour';
import { CODE_PATTERN, QueueConnection, RoomConnection, SEATS, newRoomCode, type GameMsg, type LineupSlot, type MatchSnapshot, type QueueEvent, type Roster, type RosterSeat, type ServerMsg } from './net';
import { tierIndex, tierOf, toNext, TIERS } from './rating';
import { drawRatingGraph, rankBarHtml } from './rankbar';
import { PresenceLink, type PresenceCounts } from './presence';
import { initCareer } from './careermode/ui';
import { clearLog, installErrorLog, logText, readLog } from './errorlog';
import { SHOT_KINDS, addCareer, careerDelta, evaluate, loadLocalCareer, saveLocalCareer, statGroups, type Career } from './career';
import { BIND_ACTIONS, bind, bindProblem, keyFor, keyLabel, type BindAction } from './keys';
import { Renderer, type Scene } from './render';
import { Voice } from './voice';
import { startGate } from './gate';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const menu = document.getElementById('menu')!;
const controlsBox = document.getElementById('controls')!;
const styleRow = document.getElementById('styleRow')!;
const input = new Input(canvas);
const broadcast = broadcastCamera();
const side = sideCamera();
const hawkCam = new Camera();
/** Replay cameras (V cycles them). */
const replayCams: Record<ReplayCam, Camera> = { broadcast, side, low: broadcastCamera('player'), overhead: broadcastCamera('overhead'), reverse: reverseCamera() };
const renderer = new Renderer(ctx);
const hud = new Hud(ctx);
const sound = new Sound();
const voice = new Voice();

const STORE = 'badminton.settings';
const settings: Settings = {
  event: 'singles', opponent: 'beginner', style: 'allround', partnerStyle: 'allround', autoSwitch: false, p1Control: 'mouse', games: 3, points: 15,
  // Assists start off except the landing marker.
  guides: true, timingLight: false, swingAssist: false, aim: 'realistic', voice: false, hideChat: false,
  view: 'close', performance: false,
};
/** A fresh start, for new settings profiles. */
const DEFAULT_SETTINGS: Settings = JSON.parse(JSON.stringify(settings));
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
  saveProfile();
}
saveSettings();
let game: Game | null = null;

// Bottom-right buttons: camera view and fullscreen. Blur after clicking so Space doesn't re-press them.
const viewBtn = document.getElementById('viewBtn') as HTMLButtonElement;
const fsBtn = document.getElementById('fsBtn') as HTMLButtonElement;
function syncViewbar() {
  viewBtn.textContent = `View: ${VIEWS.find((v) => v.id === settings.view)?.label ?? 'Close'}`;
  fsBtn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
}
function toggleView() {
  // Cycle through every camera: Close → Broadcast → Player → Overhead.
  const i = VIEWS.findIndex((v) => v.id === settings.view);
  settings.view = VIEWS[(i + 1) % VIEWS.length].id;
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
// 4.0.1: on the home page the View/Fullscreen bar hides (it covered What's new); this footer link does the same job.
const fsLink = document.getElementById('fsLink') as HTMLButtonElement;
fsLink.addEventListener('click', () => { toggleFullscreen(); fsLink.blur(); });
document.addEventListener('fullscreenchange', () => { fsLink.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; });
document.addEventListener('fullscreenchange', () => { syncViewbar(); resize(); });

function resize() {
  // Performance mode draws at three-quarters of normal resolution (and never above 1:1 on sharp screens).
  const dpr = settings.performance ? Math.min(window.devicePixelRatio || 1, 1) * 0.75 : window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderer.lite = !!settings.performance;
  for (const c of new Set([broadcast, ...Object.values(replayCams)])) c.fit(innerWidth, innerHeight);
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
    ['Clear', 'Shuttle high above you', 'Hold right-click', `Hold ${H} (tap for a fast, flat one)`],
    ['Lift', 'Shuttle low: at the net or defending', 'Hold right-click', `Hold ${H} (tap for a fast, flat one)`],
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
// 3.13: maintenance and blocked players (checked on start, every minute, and after logging in or out).
const recheckGate = startGate(loadAccount);
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
/** Your tier from the account server (null until the 2.7 update has been run there). */
let myRankInfo: import('./account').RankInfo | null = null;
/** This account is in the database's admins table (shows the Admin tab). */
let isAdmin = false;

/** Your career stats: from your account when logged in, otherwise kept on this computer. */
let career: Career = loadLocalCareer();

/** 3.18: the Career and Ranked panels on the home page show where you stand. */
function syncHomeCards() {
  const g = (k: string) => career[k] ?? 0, sum = titleSummary(career);
  const best = g('max_career_best_rank') ? 1000 - g('max_career_best_rank') : 0;
  const cm = g('career_matches'), cw = g('career_wins');
  document.getElementById('careerStats')!.innerHTML = [
    [best ? `#${best}` : '–', 'Best world rank'],
    [String(sum.points), 'Title points'],
    [cm ? `${cw}–${cm - cw}` : '–', 'Career record'],
  ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  const line = document.getElementById('rankedLine')!;
  if (!account || !myRating) {
    line.className = 'h-rank guest';
    line.textContent = account ? 'Play a quick match to get your rating.' : 'Log in to play ranked and get a rating. Rooms with friends work without one.';
    return;
  }
  const r = myRankInfo?.rating ?? myRating.rating, t = tierOf(r, myRankInfo?.tier);
  const next = toNext(r, t.index), span = next === null ? 0 : TIERS[t.index + 1].min - t.min;
  const fill = next === null ? 100 : Math.max(4, Math.min(100, Math.round((100 * (span - next)) / span)));
  line.className = 'h-rank';
  line.style.setProperty('--tier', t.color);
  line.innerHTML = `<b>${Math.round(r)}</b><span class="tier-name">${hubEsc(t.name)} · ${myRating.wins}–${myRating.losses}</span><span class="tier-bar"><i style="width:${fill}%"></i></span>`
    + `<span class="tier-next">${next === null ? 'Top tier' : `${next} to ${hubEsc(TIERS[t.index + 1].name)}`}</span>`;
}

function syncAccountUi() {
  syncHomeCards();
  document.getElementById('accountLabel')!.textContent = account ? `${account.username}${myRating ? ` · ${myRating.rating}` : ''}` : 'Log in';
  document.getElementById('accountBtn')!.classList.toggle('in', !!account);
  // Social screen: who you are, your tier and rating, and what needs a login.
  document.getElementById('socialName')!.textContent = account ? account.username : 'Guest';
  document.getElementById('socialKicker')!.textContent = account ? 'Player profile' : 'Not logged in · stats on this computer';
  const tierEl = document.getElementById('socialTier')!;
  const t = myRating ? tierOf(myRankInfo?.rating ?? myRating.rating, myRankInfo?.tier) : null;
  tierEl.textContent = t ? t.name : account ? '' : 'Log in to get a rating';
  if (t && myRankInfo?.title) tierEl.insertAdjacentHTML('beforeend', `<span class="season-title">· ${hubEsc(myRankInfo.title)}</span>`);
  tierEl.style.setProperty('--tier', t?.color ?? '#8ea6d8');
  document.getElementById('heroRating')!.textContent = myRating ? String(myRating.rating) : '–';
  document.getElementById('heroRecord')!.textContent = myRating ? `${myRating.wins}–${myRating.losses}` : '–';
  const played = career.matches ?? 0;
  // Beside the ranked record, show the ranked win rate (so the two agree); otherwise all your matches.
  const ranked = myRating ? myRating.wins + myRating.losses : 0;
  document.getElementById('heroWinPct')!.textContent = ranked ? `${Math.round((100 * myRating!.wins) / ranked)}%` : played ? `${Math.round((100 * (career.wins ?? 0)) / played)}%` : '–';
  document.getElementById('heroWinLabel')!.textContent = ranked ? 'Ranked win rate' : 'Win rate (all matches)';
  document.getElementById('accountTab')!.hidden = !account;
  document.getElementById('adminTab')!.hidden = !(account && isAdmin);
  document.getElementById('friendsLogin')!.hidden = !!account;
  document.getElementById('friendsArea')!.hidden = !account;
  document.getElementById('matchesLogin')!.hidden = !!account;
  document.getElementById('acMatches')!.hidden = !account;
  if (account) document.getElementById('acName')!.textContent = account.username;
  if (account) {
    const sum = titleSummary(career), t = myRating ? tierOf(myRankInfo?.rating ?? myRating.rating, myRankInfo?.tier) : null;
    const best = career.max_career_best_rank ? 1000 - career.max_career_best_rank : 0;
    const cell = (label: string, value: string) => `<div><span>${label}</span><b>${value}</b></div>`;
    document.getElementById('acSummary')!.innerHTML =
      cell('Rank', t && myRating && myRating.wins + myRating.losses ? `<i style="color:${t.color}">${hubEsc(t.name)}</i>` : 'Unranked')
      + cell('Rating', myRating ? String(myRankInfo?.rating ?? myRating.rating) : '–')
      + cell('Ranked record', myRating ? `${myRating.wins}–${myRating.losses}` : '–')
      + cell('Matches won', (career.wins ?? 0).toLocaleString('en-GB'))
      + cell('Title points', sum.points.toLocaleString('en-GB'))
      + cell('Career titles', String(sum.titles))
      + cell('Best world ranking', best ? `#${best}` : '–')
      + cell('Fastest smash', career.max_smash ? `${career.max_smash} km/h` : '–');
  }
  renderStats();
}

/** The Stats tab: your evaluation, then your career in groups of tiles. */
function renderStats() {
  const ev = evaluate(career, cpuWeakZone());
  document.getElementById('evaluation')!.innerHTML = ev.ready
    ? `<div class="ev-col"><h3>Strengths</h3><ul>${ev.strengths.map((t) => `<li>${hubEsc(t)}</li>`).join('')}</ul></div>
       <div class="ev-col"><h3>Work on</h3><ul>${ev.weaknesses.length ? ev.weaknesses.map((t) => `<li>${hubEsc(t)}</li>`).join('') : '<li>Nothing stands out. Nice.</li>'}</ul></div>
       <p class="ev-tip">${hubEsc(ev.tip)}</p>`
    : `<p class="ev-tip">${hubEsc(ev.tip)}</p>`;
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
  void renderRank();
}

/** The rank bar, season and rating graph on the Stats tab (and the small bar while waiting for a match). */
async function renderRank() {
  const card = document.getElementById('rankCard')!;
  if (!account || !myRating) { card.hidden = true; document.getElementById('queueRank')!.innerHTML = ''; return; }
  const m = await loadAccount();
  const [info, hist] = await Promise.all([m.myRank().catch(() => null), m.myRatingHistory().catch(() => [])]);
  myRankInfo = info;
  const rating = info?.rating ?? myRating.rating;
  const tier = info?.tier ?? tierIndex(rating);
  // Promoted or dropped since you last looked: animate the bar once and say so.
  let anim: 'up' | 'down' | null = null;
  try {
    const key = `badminton.tier.${account.id}`, was = localStorage.getItem(key);
    if (was !== null && Number(was) !== tier) {
      anim = tier > Number(was) ? 'up' : 'down';
      toast(anim === 'up' ? `Promoted to ${TIERS[tier].name}` : `Down to ${TIERS[tier].name}`, anim === 'up' ? 'Nice work. Your new tier shows beside your name.' : 'Win a match or two to climb back.');
    }
    localStorage.setItem(key, String(tier));
  } catch { /* storage blocked: no animation */ }
  card.hidden = false;
  document.getElementById('rankBar')!.innerHTML = rankBarHtml(rating, tier, { peakTier: info?.peak_tier, anim });
  document.getElementById('queueRank')!.innerHTML = rankBarHtml(rating, tier, { compact: true });
  const season = document.getElementById('rankSeason')!;
  if (info) {
    const end = new Date(info.season_end);
    const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000));
    season.innerHTML = `<span>Season ${info.season} · ends ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} (${days} day${days === 1 ? '' : 's'})</span>`
      + `<span>${info.matches} rated match${info.matches === 1 ? '' : 'es'} this season</span>`
      + (info.title ? `<span class="rc-title" style="--c:${TIERS[Number(info.frame?.replace('tier_', '') ?? 1)]?.color ?? '#f2b544'}">${hubEsc(info.title)}</span>` : '');
  } else season.textContent = 'Seasons start once the account server is updated.';
  // Oldest first: the rating before the first change, then after each one.
  const pts = [...hist].reverse();
  const series = pts.length ? [pts[0].rating_after - pts[0].delta, ...pts.map((p) => p.rating_after)] : [];
  drawRatingGraph(document.getElementById('rankGraph') as HTMLCanvasElement, series);
  syncAccountUi();
}

// Logins: renew when you come back to the tab (a sleeping laptop can miss the automatic renewal), and
// say so clearly if the login ended, instead of quietly failing.
let loggingOut = false;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && account) void loadAccount().then((m) => m.freshToken()); });
void loadAccount().then((m) => m.onLoggedOut(() => {
  if (loggingOut || !account) return;
  account = null;
  myRating = null;
  myRankInfo = null;
  isAdmin = false;
  career = loadLocalCareer();
  stopPresence();
  syncAccountUi();
  toast('You’ve been logged out', 'Your login expired. Log in again to keep saving stats and play ranked.');
}));

/** Logged in: use the settings saved to the account, or save this browser's settings to a new one. */
async function afterLogin(a: { id: string; username: string }, isNew: boolean) {
  account = a;
  void recheckGate();
  syncAccountUi();
  void refreshStats();
  startPresence();
  void loadAccount().then((m) => m.amIAdmin()).then((yes) => { isAdmin = yes; syncAccountUi(); });
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
  logEvent('finish', g.online ? 'online' : g.setup.mode, levelOf(g), g);
  recordHeat(g);
  const delta = careerDelta(g, career);
  const fresh = checkAchievements(addCareer(career, delta), g.matchFacts());
  saveCareer({ ...delta, ...achievementDelta(fresh) });
  announceAchievements(fresh);
}

/** Add these numbers to your career: on your account when logged in, otherwise on this computer. */
function saveCareer(delta: Career) {
  if (!Object.keys(delta).length) return;
  career = addCareer(career, delta);
  if (!account) { saveLocalCareer(career); return; }
  void loadAccount().then(async (m) => { const saved = await m.addCareer(delta); if (saved) career = saved; });
}

/** Pop-up notes in the corner ("Achievement unlocked"), one after another. */
const toastQueue: { title: string; sub: string }[] = [];
let toastBusy = false;
function toast(title: string, sub: string) {
  toastQueue.push({ title, sub });
  if (toastBusy) return;
  const el = document.getElementById('toast')!;
  const next = () => {
    const t = toastQueue.shift();
    if (!t) { toastBusy = false; el.classList.remove('show'); return; }
    toastBusy = true;
    el.innerHTML = `<b>${hubEsc(t.title)}</b><span>${hubEsc(t.sub)}</span>`;
    el.classList.add('show');
    setTimeout(() => { el.classList.remove('show'); setTimeout(next, 350); }, 3800);
  };
  next();
}
function announceAchievements(list: Achievement[]) {
  for (const a of list) toast(`Achievement unlocked: ${a.name}`, a.desc);
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
  loggingOut = true;
  await m.logOut();
  loggingOut = false;
  account = null;
  myRating = null;
  myRankInfo = null;
  isAdmin = false;
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
  if (name === 'admin') void renderAdmin();
  if (name === 'highlights') renderHighlights();
  if (name === 'awards') void renderAwards();
  if (name === 'profile') void renderProfile();
  if (name === 'players') void renderPlayers();
  if (name === 'heat') renderHeat();
}

/** Where the CPU's memory says you struggle most (needs a few remembered points there). */
function cpuWeakZone(): string | null {
  const m = loadMemory();
  if (!m) return null;
  let best = -1, rate = 0.3;
  m.tries.forEach((t, z) => { const r = m.weak[z] / Math.max(1, t); if (t >= 4 && r > rate) { best = z; rate = r; } });
  return best >= 0 ? ZONE_NAMES[best] : null;
}

/** Heatmap tab: where your shots land, recent sessions next to all time, by shot type. */
let heatKind: ShotKind | 'all' = 'all';
function renderHeat() {
  const all = loadSessions();
  document.querySelectorAll<HTMLButtonElement>('#heatKind button').forEach((b) => b.classList.toggle('on', b.dataset.value === heatKind));
  const recent = drawHeat(document.getElementById('heatRecent') as HTMLCanvasElement, all.slice(0, 5), heatKind);
  const ever = drawHeat(document.getElementById('heatAll') as HTMLCanvasElement, all, heatKind);
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  document.getElementById('heatRecentNote')!.textContent = recent.n ? `${recent.n} shots · ${pct(recent.inShare)} in` : 'No shots yet';
  document.getElementById('heatAllNote')!.textContent = ever.n ? `${ever.n} shots over ${all.length} session${all.length === 1 ? '' : 's'} · ${pct(ever.inShare)} in` : 'No shots yet';
}
document.querySelectorAll<HTMLButtonElement>('#heatKind button').forEach((b) => b.addEventListener('click', () => { heatKind = b.dataset.value as ShotKind | 'all'; renderHeat(); }));

// ── Players (characters) ─────────────────────────────────────────────────────
/** Characters you can use right now: the Club Player, this season's free ones, and ones you've earned. */
let ownedIds = new Set<string>([DEFAULT_CHARACTER]);
let featuredIds = new Set<string>();
let selectedPlayer = DEFAULT_CHARACTER;
let comparePlayer: string | null = null;
const canUse = (id: string) => id === DEFAULT_CHARACTER || ownedIds.has(id) || featuredIds.has(id);
/** Your player for the next match (falls back to the Club Player if you can't use the one saved). */
const myCharacter = () => (settings.character && canUse(settings.character) ? settings.character : DEFAULT_CHARACTER);

async function refreshOwned() {
  const m = await loadAccount();
  if (account) {
    const r = await m.myCharacters();
    if (r) { ownedIds = new Set([DEFAULT_CHARACTER, ...r.owned]); featuredIds = new Set(r.featured); }
  } else {
    ownedIds = new Set([DEFAULT_CHARACTER]);
    featuredIds = new Set(await m.featuredNow());
  }
}

const countryName = (code: string) => {
  if (code === 'XXX') return '—';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.slice(0, 2)) ?? code; } catch { return code; }
};

/** Players out in this version of the game (later ones stay hidden). */
const VISIBLE = rosterFor(CHANGELOG[0].version);
const STAT_LABELS = ['Power', 'Speed', 'Net', 'Defence', 'Stamina'];
const pf = { q: '', rarity: '', style: '', country: '', hand: '', owned: '', sort: 'rarity' };
let pList: typeof VISIBLE = VISIBLE;
/** Card size for the grid (it only draws the rows on screen, so 400+ players stay smooth). */
const P_CARD = { minW: 168, h: 96, gap: 10 };

function filterPlayers() {
  const q = pf.q.trim().toLowerCase();
  pList = VISIBLE.filter((c) => (!q || c.name.toLowerCase().includes(q))
    && (!pf.rarity || c.rarity === pf.rarity) && (!pf.style || c.style === pf.style) && (!pf.country || c.country === pf.country)
    && (!pf.hand || c.handedness === pf.hand) && (!pf.owned || (pf.owned === 'owned') === canUse(c.id)));
  const by = pf.sort;
  pList.sort((a, b) => by === 'name' ? a.name.localeCompare(b.name)
    : by === 'rarity' ? RARITY[b.rarity].order - RARITY[a.rarity].order || a.name.localeCompare(b.name)
    : by === 'total' ? statTotal(b) - statTotal(a) || a.name.localeCompare(b.name)
    : b.stats[Number(by)] - a.stats[Number(by)] || a.name.localeCompare(b.name));
  document.getElementById('pCount')!.textContent = `${pList.length} of ${VISIBLE.length} players`;
  const scroll = document.getElementById('playerScroll')!;
  scroll.scrollTop = 0;
  drawPlayerGrid();
}

function fillPlayerFilters() {
  const opts = (id: string, items: [string, string][]) => {
    const el = document.getElementById(id) as HTMLSelectElement;
    if (el.options.length > 1) return;
    el.insertAdjacentHTML('beforeend', items.map(([v, l]) => `<option value="${v}">${hubEsc(l)}</option>`).join(''));
  };
  const rar = [...new Set(VISIBLE.map((c) => c.rarity))].sort((a, b) => RARITY[a].order - RARITY[b].order);
  opts('pRarity', rar.map((r) => [r, RARITY[r].label]));
  opts('pStyle', [...new Set(VISIBLE.map((c) => c.style))].sort().map((s) => [s, s[0].toUpperCase() + s.slice(1)]));
  opts('pCountry', [...new Set(VISIBLE.map((c) => c.country).filter((c) => c !== 'XXX'))].map((c) => [c, countryName(c)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1])));
}

/** Draw just the rows in view (plus a few either side). */
function drawPlayerGrid() {
  const scroll = document.getElementById('playerScroll')!, grid = document.getElementById('playerGrid')!;
  const width = grid.clientWidth || scroll.clientWidth || 600;
  const cols = Math.max(1, Math.floor((width + P_CARD.gap) / (P_CARD.minW + P_CARD.gap)));
  const rowH = P_CARD.h + P_CARD.gap, rows = Math.ceil(pList.length / cols);
  const first = Math.max(0, Math.floor(scroll.scrollTop / rowH) - 2);
  const last = Math.min(rows, Math.ceil((scroll.scrollTop + (scroll.clientHeight || 600)) / rowH) + 2);
  grid.style.setProperty('--cols', String(cols));
  grid.style.height = `${Math.max(0, rows * rowH - P_CARD.gap)}px`;
  grid.style.paddingTop = `${first * rowH}px`;
  const mine = myCharacter();
  grid.innerHTML = pList.slice(first * cols, last * cols).map((c) => {
    const r = RARITY[c.rarity], use = canUse(c.id);
    return `<button type="button" class="pcard${use ? '' : ' locked'}${c.id === selectedPlayer ? ' on' : ''}" data-player="${c.id}" style="--rar:${r.color}">
      <span class="rar">${r.label}</span><b>${hubEsc(c.name)}</b>
      <span class="sub">${c.country !== 'XXX' ? `${c.country} · ` : ''}${hubEsc(c.style)}${c.handedness === 'left' ? ' · left' : ''}</span>
      <span class="tag">${c.id === mine ? 'Your player' : featuredIds.has(c.id) ? 'Free this season' : use ? 'Owned' : 'Locked'}${c.abilities.length ? ` · ${c.abilities.map((a) => a.tier).join('+')}` : ''}</span>
    </button>`;
  }).join('') || '<p class="coming">No players match.</p>';
}

async function renderPlayers() {
  await refreshOwned();
  fillPlayerFilters();
  filterPlayers();
  renderPlayerDetail();
  // 3.8.1: rank-up player picks are gone (players come from career recruiting).
  document.getElementById('pickOffer')!.hidden = true;
}

function renderPlayerDetail() {
  const c = characterById(selectedPlayer), r = RARITY[c.rarity], use = canUse(c.id);
  const wins = career[`char_wins_${c.id}`] ?? 0, losses = career[`char_losses_${c.id}`] ?? 0;
  const cmp = comparePlayer && comparePlayer !== c.id ? characterById(comparePlayer) : null;
  const rowsHtml = STAT_LABELS.map((l, i) => {
    const d = cmp ? c.stats[i] - cmp.stats[i] : 0;
    return `<tr><td>${l}</td><td><b>${c.stats[i]}</b></td>${cmp ? `<td>${cmp.stats[i]}</td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d || '='}</td>` : ''}</tr>`;
  }).join('');
  const careerLine = c.base_stats && c.base_stats.join() !== c.stats.join() ? `<p class="sub">Career stats: ${c.base_stats.join(' / ')}</p>` : '';
  document.getElementById('playerDetail')!.innerHTML = `
    <p class="rar-line" style="--rar:${r.color}"><span class="rar">${r.label}</span> ${hubEsc(countryName(c.country))}</p>
    <h3>${hubEsc(c.name)}</h3>
    <canvas id="playerPentagon" class="pentagon"></canvas>
    <p class="sub">${hubEsc(c.style)} · ${c.handedness === 'left' ? 'left-handed' : 'right-handed'} · stats total ${statTotal(c)}${c.id !== DEFAULT_CHARACTER ? ` · career strength ${c.career_strength}` : ''}</p>
    <table class="pstats"><tr><th></th><th>${hubEsc(c.name.split(' ')[0])}</th>${cmp ? `<th>${hubEsc(cmp.name.split(' ')[0])}</th><th></th>` : ''}</tr>${rowsHtml}</table>
    ${careerLine}
    ${c.abilities.map((a) => `<p class="ability"><span class="ab-tier">${a.tier}</span><b>${hubEsc(a.name)}</b>${a.text ? ` ${hubEsc(a.text)}` : ''}</p>`).join('')}
    <p>${hubEsc(c.description)}</p>
    <p class="sub">With this player: ${wins} won, ${losses} lost</p>
    <label class="cmp">Compare with <input id="playerCompare" list="playerNames" placeholder="Type a name" value="${cmp ? hubEsc(cmp.name) : ''}" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" /></label>
    ${cmp ? '<button type="button" class="linkish" data-uncompare>Stop comparing</button>' : ''}
    ${use ? (c.id === myCharacter() ? '<p class="tag-on">This is your player</p>' : `<button type="button" class="primary" data-use="${c.id}">Play as ${hubEsc(c.name)}</button>`)
      : '<p class="sub">Locked. Earn players by recruiting them in career mode.</p>'}`;
  drawPentagon(document.getElementById('playerPentagon') as HTMLCanvasElement, c.stats, r.color, cmp ? { stats: cmp.stats, color: '#1f2937' } : undefined);
}
{
  // Names for the compare box: only on the page while you're typing in it (a 340-name list sitting on the
  // page all the time makes browsers and password managers scan it on every key press elsewhere).
  const detail = document.getElementById('playerDetail')!;
  detail.addEventListener('focusin', (e) => {
    if ((e.target as HTMLElement).id !== 'playerCompare' || document.getElementById('playerNames')) return;
    const dl = document.createElement('datalist');
    dl.id = 'playerNames';
    dl.innerHTML = VISIBLE.map((c) => `<option value="${hubEsc(c.name)}"></option>`).join('');
    detail.appendChild(dl);
  });
  detail.addEventListener('focusout', (e) => { if ((e.target as HTMLElement).id === 'playerCompare') setTimeout(() => { if (document.activeElement?.id !== 'playerCompare') document.getElementById('playerNames')?.remove(); }, 300); });
  let raf = 0;
  document.getElementById('playerScroll')!.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawPlayerGrid); }, { passive: true });
  window.addEventListener('resize', () => { if (!document.getElementById('playerScroll')!.closest('[hidden]')) drawPlayerGrid(); });
  let typing = 0;
  document.getElementById('pSearch')!.addEventListener('input', (e) => { pf.q = (e.target as HTMLInputElement).value; clearTimeout(typing); typing = window.setTimeout(filterPlayers, 120); });
  for (const [id, key] of [['pRarity', 'rarity'], ['pStyle', 'style'], ['pCountry', 'country'], ['pHand', 'hand'], ['pOwned', 'owned'], ['pSort', 'sort']] as const) {
    document.getElementById(id)!.addEventListener('change', (e) => { pf[key] = (e.target as HTMLSelectElement).value; filterPlayers(); });
  }
}

document.getElementById('playerGrid')!.addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-player]')?.dataset.player;
  if (id) { selectedPlayer = id; drawPlayerGrid(); renderPlayerDetail(); }
});
document.getElementById('playerDetail')!.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-uncompare]')) { comparePlayer = null; renderPlayerDetail(); return; }
  const id = t.closest<HTMLElement>('[data-use]')?.dataset.use;
  if (id && canUse(id)) { settings.character = id; saveSettings(); drawPlayerGrid(); renderPlayerDetail(); }
});
document.getElementById('playerDetail')!.addEventListener('change', (e) => {
  if ((e.target as HTMLElement).id !== 'playerCompare') return;
  const name = (e.target as HTMLInputElement).value.trim().toLowerCase();
  comparePlayer = VISIBLE.find((c) => c.name.toLowerCase() === name)?.id ?? null;
  renderPlayerDetail();
});
document.getElementById('pickOffer')!.addEventListener('click', async (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
  if (!id) return;
  const m = await loadAccount();
  if (await m.choosePick(id)) { toast('New player unlocked', characterById(id).name); selectedPlayer = id; }
  void renderPlayers();
});

/** Awards tab: achievements. */
/** 4.4: how rare each achievement is (share of players who have it), loaded once. */
let rarity: Record<string, number> | null = null;
async function loadRarity() { if (!rarity) rarity = (await (await loadAccount()).achievementRarity()) ?? {}; return rarity; }
const rareText = (id: string) => (rarity && rarity[id] !== undefined ? `${rarity[id] < 1 ? '<1' : Math.round(rarity[id])}% of players have this` : '');

async function renderAwards() {
  const got = loadUnlocked();
  const n = ACHIEVEMENTS.filter((a) => got[a.id] || career[`max_ach_${a.id}`]).length;
  document.getElementById('awardsScope')!.innerHTML = `<b>${n}</b> of ${ACHIEVEMENTS.length} achievements`;
  const draw = () => {
    document.getElementById('achList')!.innerHTML = ACHIEVEMENTS.map((a) => {
      const on = !!(got[a.id] || career[`max_ach_${a.id}`]), r = rareText(a.id);
      return `<div class="tile ach${on ? ' on' : ''}"><b>${on ? '★' : '☆'} ${hubEsc(a.name)}</b><span>${hubEsc(a.desc)}</span>${r ? `<em class="ach-rare${(rarity?.[a.id] ?? 100) < 5 ? ' very' : ''}">${r}</em>` : ''}</div>`;
    }).join('');
  };
  draw();
  await loadRarity().catch(() => null);
  draw();
}

/** 4.4: the Profile tab: who you are, what you play, what wins and loses you points, and your rarest achievements. */
async function renderProfile() {
  const el = document.getElementById('profilePane')!, g = (k: string) => career[k] ?? 0;
  const kinds = SHOT_KINDS.map(([k, label]) => ({ k, label, played: g(`st_${k}`), won: g(`sw_${k}`), errors: g(`se_${k}`), lost: g(`sl_${k}`) }));
  const played = kinds.filter((x) => x.played > 0);
  const fav = [...played].sort((a, b) => b.played - a.played)[0];
  const best = [...played].filter((x) => x.played >= 15).sort((a, b) => b.won / b.played - a.won / a.played)[0];
  const nemesis = [...kinds].sort((a, b) => b.lost - a.lost)[0];
  const t = myRating ? tierOf(myRankInfo?.rating ?? myRating.rating, myRankInfo?.tier) : null;
  const sum = titleSummary(career);
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
  const got = loadUnlocked();
  const mine = ACHIEVEMENTS.filter((a) => got[a.id] || career[`max_ach_${a.id}`]);
  const draw = () => {
    const rare = [...mine].filter((a) => rarity?.[a.id] !== undefined).sort((a, b) => (rarity![a.id] ?? 100) - (rarity![b.id] ?? 100)).slice(0, 4);
    el.innerHTML = `<div class="pf-head" style="--tier:${t?.color ?? '#8ea6d8'}">
        <div class="pf-badge">${hubEsc((account?.username ?? 'You').slice(0, 2).toUpperCase())}</div>
        <div><p class="hero-kicker">Your profile</p><h3 class="pf-name">${hubEsc(account?.username ?? 'Guest')}</h3>
        <p class="sub">${t ? `<b style="color:${t.color}">${hubEsc(t.name)}</b> · ${myRating!.rating} rating · ${myRating!.wins}–${myRating!.losses} ranked` : 'Not ranked yet'} · ${sum.titles} career title${sum.titles === 1 ? '' : 's'} · ${g('matches')} matches played</p></div>
        <button type="button" class="edit" data-mycard>Your player card</button>
      </div>
      <div class="pf-facts">
        <div><span>Favourite shot</span><b>${fav ? hubEsc(fav.label) : '–'}</b><em>${fav ? `${fav.played} played` : 'Play a match to fill this in'}</em></div>
        <div><span>Best shot</span><b>${best ? hubEsc(best.label) : '–'}</b><em>${best ? `wins ${pct(best.won, best.played)} of the time` : 'Needs 15 of one shot'}</em></div>
        <div><span>You lose most points to</span><b>${nemesis && nemesis.lost ? hubEsc(nemesis.label.toLowerCase()) : '–'}</b><em>${nemesis && nemesis.lost ? `${nemesis.lost} points` : ''}</em></div>
        <div><span>Fastest smash</span><b>${g('max_smash') ? `${g('max_smash')} km/h` : '–'}</b><em>${g('max_rally') ? `longest rally ${g('max_rally')} shots` : ''}</em></div>
      </div>
      <h4 class="pf-h">Shot analytics</h4>
      ${played.length ? `<table class="pf-table"><tr><th>Shot</th><th>Played</th><th>Winners</th><th>Win %</th><th>Your errors</th><th>Points lost to it</th></tr>
        ${kinds.map((x) => `<tr><td>${hubEsc(x.label)}</td><td>${x.played}</td><td>${x.won}</td><td>${pct(x.won, x.played)}</td><td>${x.errors}</td><td>${x.lost}</td></tr>`).join('')}</table>
        <p class="sub">Counted from matches since 4.4. Win % is the share of those shots that won the point outright.</p>`
        : '<p class="sub">Your shot analytics start with your next match.</p>'}
      <h4 class="pf-h">Rarest achievements</h4>
      ${rare.length ? `<div class="pf-rare">${rare.map((a) => `<div><b>★ ${hubEsc(a.name)}</b><span>${rareText(a.id)}</span></div>`).join('')}</div>` : `<p class="sub">${mine.length ? 'Loading…' : 'No achievements yet.'}</p>`}
      <p class="sub">Your rating graph is in Stats, your heatmap in Heatmap and your matches in Matches.</p>`;
  };
  draw();
  await loadRarity().catch(() => null);
  if (!document.querySelector('[data-hubpane="profile"]')!.hasAttribute('hidden')) draw();
}
document.getElementById('profilePane')!.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-mycard]') && account) showCard(account.username);
});

/** Highlights tab: rallies you saved with P, kept on this computer. */
function renderHighlights() {
  const list = loadHighlights();
  const el = document.getElementById('highlightList')!;
  el.innerHTML = list.length ? list.map((h) => {
    const when = new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `<li><span class="grow">${hubEsc(h.title)}<span class="sub">${hubEsc(h.sub)} · ${when}</span></span><button type="button" data-watch="${h.id}">Watch</button><button type="button" data-del="${h.id}" aria-label="Delete">✕</button></li>`;
  }).join('') : '<li class="empty">No highlights yet. After a great point, press P to save it.</li>';
}
document.getElementById('highlightList')!.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const watch = t.closest<HTMLElement>('[data-watch]')?.dataset.watch, del = t.closest<HTMLElement>('[data-del]')?.dataset.del;
  if (watch) { const h = loadHighlights().find((x) => x.id === watch); if (h) watchHighlight(h); }
  if (del) { deleteHighlight(del); renderHighlights(); }
});

/** Admin tab: who's signing up and playing. The database refuses anyone who isn't an admin. */
async function renderAdmin() {
  const m = await loadAccount();
  const o = await m.adminOverview();
  const scope = document.getElementById('adminScope')!;
  if (!o) { scope.textContent = 'Couldn’t load the admin overview (is supabase/admin.sql set up, and is this account an admin?).'; return; }
  const n = (v: number) => Number(v).toLocaleString('en-GB');
  scope.innerHTML = `Accounts only: guests aren’t counted. <b>${n(o.online_now)}</b> online right now.`;
  const groups = [
    { title: 'Players', tiles: [['Accounts', o.players], ['New today', o.signups_today], ['New this week', o.signups_week]] },
    { title: 'Activity', tiles: [['Online now', o.online_now], ['Played today', o.active_today], ['Played this week', o.active_week]] },
    { title: 'Matches', tiles: [['Matches finished', o.matches_played], ['Hours played', o.hours_played], ['Ranked today', o.ranked_today], ['Ranked all time', o.ranked_total]] },
  ];
  document.getElementById('adminGroups')!.innerHTML = groups.map((g) => `
    <div class="stat-group"><h3>${g.title}</h3>
      <div class="tiles">${g.tiles.map(([label, v]) => `<div class="tile"><b>${n(v as number)}</b><span>${label}</span></div>`).join('')}</div>
    </div>`).join('');
  // 3.5.2: every account (falls back to the 30 most recent if admin_players isn't set up yet).
  adminRows = (await m.adminPlayers()) ?? o.recent.map((p) => ({ ...p, owned: 0, career_player: null }));
  drawAdminList();
  void drawGameSwitch();
  void loadAdminFeedback();
}

// ── 4.4: admin pages: analytics and the feedback inbox ──
function showAdminPage(p: string) {
  document.querySelectorAll<HTMLElement>('#adminNav [data-apage]').forEach((b) => b.classList.toggle('on', b.dataset.apage === p));
  document.querySelectorAll<HTMLElement>('[data-apane]').forEach((x) => { x.hidden = x.dataset.apane !== p; });
  if (p === 'analytics') void drawAnalytics();
  if (p === 'feedback') drawAdminFeedback();
}
document.getElementById('adminNav')!.addEventListener('click', (e) => {
  const p = (e.target as HTMLElement).closest<HTMLElement>('[data-apage]')?.dataset.apage;
  if (p) showAdminPage(p);
});
async function drawAnalytics() {
  const box = document.getElementById('adminAnalytics')!, a = await (await loadAccount()).adminAnalytics();
  if (!a) { box.innerHTML = '<p class="sub">Analytics aren’t set up yet: run supabase/4.4-feedback-analytics.sql in the Supabase SQL Editor.</p>'; return; }
  const n = (v: number) => Number(v).toLocaleString('en-GB');
  const bar = (v: number, max: number) => `<i class="an-bar" style="width:${max ? Math.max(2, (100 * v) / max) : 0}%"></i>`;
  const maxL = Math.max(1, ...a.by_level.map((r) => r.started)), maxD = Math.max(1, ...a.per_day.map((r) => r.started)), maxQ = Math.max(1, ...a.quit_points.map((r) => r.quits));
  const label = (l: string) => LEVEL_LABEL[l as Level] ?? l;
  box.innerHTML = `<p class="sub">The last 30 days, everyone (guests too). Counts come in from 4.4 on.</p>
    <h3 class="admin-h">CPU levels played</h3>
    <table class="an-table"><tr><th>Level</th><th>Started</th><th></th><th>Finished</th><th>Quit</th><th>Quit rate</th></tr>
      ${a.by_level.map((r) => `<tr><td>${hubEsc(label(r.level))}</td><td>${n(r.started)}</td><td class="an-cell">${bar(r.started, maxL)}</td><td>${n(r.finished)}</td><td>${n(r.quit)}</td><td>${r.started ? Math.round((100 * r.quit) / r.started) : 0}%</td></tr>`).join('') || '<tr><td colspan="6">Nothing yet.</td></tr>'}</table>
    <h3 class="admin-h">Modes</h3>
    <table class="an-table"><tr><th>Mode</th><th>Started</th><th>Finished</th><th>Quit</th></tr>
      ${a.by_mode.map((r) => `<tr><td>${hubEsc(r.mode ?? '–')}</td><td>${n(r.started)}</td><td>${n(r.finished)}</td><td>${n(r.quit)}</td></tr>`).join('') || '<tr><td colspan="4">Nothing yet.</td></tr>'}</table>
    <h3 class="admin-h">Where people quit (points played before leaving)</h3>
    <table class="an-table">${a.quit_points.map((r) => `<tr><td>${r.bucket}–${r.bucket + 4} points</td><td>${n(r.quits)}</td><td class="an-cell">${bar(r.quits, maxQ)}</td></tr>`).join('') || '<tr><td>No quits yet.</td></tr>'}</table>
    <h3 class="admin-h">Matches started per day</h3>
    <table class="an-table">${a.per_day.map((r) => `<tr><td>${new Date(r.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td><td>${n(r.started)}</td><td class="an-cell">${bar(r.started, maxD)}</td></tr>`).join('') || '<tr><td>Nothing yet.</td></tr>'}</table>`;
}
let adminFb: import('./account').FeedbackRow[] = [];
let fbFilter = 'open';
async function loadAdminFeedback() {
  adminFb = (await (await loadAccount()).adminFeedback()) ?? [];
  const open = adminFb.filter((f) => !f.done).length, badge = document.getElementById('adminFbCount')!;
  badge.hidden = !open; badge.textContent = String(open);
  drawAdminFeedback();
}
function drawAdminFeedback() {
  const list = document.getElementById('adminFeedback')!;
  const rows = adminFb.filter((f) => fbFilter === 'all' ? true : fbFilter === 'open' ? !f.done : f.kind === fbFilter);
  list.innerHTML = rows.length ? rows.map((f) => `<li class="${f.done ? 'done' : ''}"><span class="grow"><b class="fb-k ${f.kind}">${f.kind}</b> ${hubEsc(f.message)}
      <span class="sub">${hubEsc(f.username ?? 'Guest')} · ${adminDay(f.created_at)} · v${hubEsc(f.version ?? '?')}${f.page ? ` · ${hubEsc(f.page)}` : ''}</span>
      ${f.log ? `<details><summary>Problem log</summary><pre>${hubEsc(f.log)}</pre></details>` : ''}</span>
      <button type="button" class="edit" data-fbdone="${f.id}" data-v="${f.done ? '0' : '1'}">${f.done ? 'Reopen' : 'Done'}</button></li>`).join('')
    : '<p class="sub">Nothing here. (If you expected feedback, run supabase/4.4-feedback-analytics.sql.)</p>';
}
document.getElementById('adminFbFilter')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fbf]');
  if (!b) return;
  fbFilter = b.dataset.fbf!;
  document.querySelectorAll<HTMLElement>('#adminFbFilter [data-fbf]').forEach((x) => x.classList.toggle('on', x === b));
  drawAdminFeedback();
});
document.getElementById('adminFeedback')!.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fbdone]');
  if (!b) return;
  await (await loadAccount()).adminFeedbackDone(Number(b.dataset.fbdone), b.dataset.v === '1');
  await loadAdminFeedback();
});

/** 3.13: the game switch: maintenance for everyone, and the blocked players list. */
async function drawGameSwitch() {
  const m = await loadAccount();
  const [st, blocked] = await Promise.all([m.gameStatus(null), m.adminBlocked()]);
  const box = document.getElementById('adminSwitch')!;
  if (!st || !blocked) { box.innerHTML = '<p class="sub">The game switch isn’t set up yet: run supabase/3.13-game-switch.sql in the Supabase SQL Editor.</p>'; return; }
  box.innerHTML = `
    <div class="gs-row"><span class="grow"><b>Maintenance</b> <span class="gs-state ${st.maintenance ? 'on' : ''}">${st.maintenance ? 'ON: the game is shut for everyone but admins' : 'Off: the game is open'}</span></span>
      <button type="button" class="${st.maintenance ? 'primary' : 'edit'}" data-gsmaint="${st.maintenance ? 'off' : 'on'}">${st.maintenance ? 'Open the game' : 'Shut the game'}</button></div>
    <input type="text" id="gsMessage" class="admin-search" maxlength="200" placeholder="Message for players (optional), e.g. Back at 6pm" value="${hubEsc(st.message ?? '')}">
    <h4>Blocked players (${blocked.length})</h4>
    ${blocked.length ? `<ol class="hub-list">${blocked.map((b) => `<li><span class="grow">${hubEsc(b.username)}<span class="sub">Blocked ${adminDay(b.at)}${b.reason ? ` · ${hubEsc(b.reason)}` : ''}</span></span><button type="button" class="edit" data-gsunblock="${hubEsc(b.username)}">Unblock</button></li>`).join('')}</ol>` : '<p class="sub">No one is blocked. Open a player below to block them.</p>'}`;
}
document.getElementById('adminSwitch')!.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement, m = await loadAccount();
  const mt = t.closest<HTMLElement>('[data-gsmaint]')?.dataset.gsmaint;
  if (mt) {
    const on = mt === 'on';
    if (on && !confirm('Shut the game for everyone except admins? Players in a match will be stopped within a minute.')) return;
    const msg = (document.getElementById('gsMessage') as HTMLInputElement).value;
    if (!(await m.adminSetMaintenance(on, msg))) { toast('Couldn’t change it', 'Is supabase/3.13-game-switch.sql set up?'); return; }
    toast(on ? 'The game is shut' : 'The game is open', on ? 'Players see the maintenance notice within a minute.' : 'Players get back in within a minute.');
    void drawGameSwitch(); void recheckGate();
  }
  const ub = t.closest<HTMLElement>('[data-gsunblock]')?.dataset.gsunblock;
  if (ub) { await m.adminBlock(ub, false); toast(`${ub} unblocked`, 'They can play again within a minute.'); void drawGameSwitch(); }
});

let adminRows: import('./account').AdminListPlayer[] = [];
const adminNum = (v: number) => Number(v ?? 0).toLocaleString('en-GB');
const adminAgo = (iso: string | null) => {
  if (!iso) return 'never played logged in';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return mins < 2 ? 'online now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
};
const adminDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const charName = (id: string | null) => (id ? characterById(id)?.name ?? id : '–');

function drawAdminList() {
  const q = (document.getElementById('adminSearch') as HTMLInputElement).value.trim().toLowerCase();
  const rows = q ? adminRows.filter((p) => p.username.includes(q)) : adminRows;
  document.getElementById('adminList')!.innerHTML = rows.length ? rows.map((p) => {
    const extra = p.career_player ? ` · career as ${hubEsc(charName(p.career_player))}` : '';
    return `<li data-user="${hubEsc(p.username)}"><span class="dot${p.online ? ' on' : ''}"></span><span class="grow">${hubEsc(p.username)}<span class="sub">Joined ${adminDay(p.created_at)} · seen ${adminAgo(p.last_seen)}${extra}</span></span><span class="sub">${adminNum(p.owned)} players · ${adminNum(p.matches)} matches · ${p.wins}–${p.losses}</span><b>${p.rating}</b></li>`;
  }).join('') : `<li class="empty">${q ? 'No usernames match.' : 'No accounts yet.'}</li>`;
}
document.getElementById('adminSearch')!.addEventListener('input', drawAdminList);
document.getElementById('adminList')!.addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-user]');
  if (li) void showAdminPlayer(li.dataset.user!);
});

async function showAdminPlayer(username: string) {
  const box = document.getElementById('adminDetail')!;
  document.querySelectorAll('#adminList li.sel').forEach((l) => l.classList.remove('sel'));
  document.querySelector(`#adminList li[data-user="${CSS.escape(username)}"]`)?.classList.add('sel');
  box.hidden = false; box.innerHTML = `Loading ${hubEsc(username)}…`;
  const m = await loadAccount();
  const d = await m.adminPlayer(username);
  if (!d) { box.textContent = 'Couldn’t load this player (is supabase/3.5.2-admin-players.sql set up?).'; return; }
  const tiles = (t: [string, string | number][]) => `<div class="tiles">${t.map(([l, v]) => `<div class="tile"><b>${typeof v === 'number' ? adminNum(v) : hubEsc(v)}</b><span>${l}</span></div>`).join('')}</div>`;
  const order = (id: string) => RARITY[characterById(id)?.rarity]?.order ?? 0;
  const owned = d.owned.length ? `<div class="ad-owned">${[...d.owned].sort((a, b) => order(b.id) - order(a.id)).map((o) => {
    const c = characterById(o.id), r = c ? RARITY[c.rarity] : null;
    return `<span title="${hubEsc(r?.label ?? '')} · got from ${hubEsc(o.source)} on ${adminDay(o.at)}"><i style="background:${r?.color ?? '#888'}"></i>${hubEsc(c?.name ?? o.id)}</span>`;
  }).join('')}</div>` : '<p class="sub">Only the default player.</p>';
  const c = d.career;
  const career = c ? tiles([
    ['Playing as', charName(c.characterId)], ['Name', c.name], ['Season', `${c.year} · week ${c.week}`],
    ['Money', `$${adminNum(Math.round(c.money))}`], ['Titles', c.titles],
    ['Best ranking', c.bestRank ? `#${c.bestRank}` : '–'], ['Tournaments', c.history?.length ?? 0], ['Squad', (c.squad ?? []).map(charName).join(', ') || '–'],
  ]) + `<p class="sub">Saved ${adminAgo(d.career_updated)}${c.current ? ' · in a tournament now' : ''}${c.injury?.weeks ? ` · injured ${c.injury.weeks} wk` : ''}</p>` : '<p class="sub">No career save.</p>';
  const stats = statGroups(d.stats ?? {}).map((g) => `<h4>${g.title}</h4>${tiles(g.tiles.map((t) => [t.label, t.value] as [string, string]))}`).join('');
  box.innerHTML = `
    <div class="ad-head"><span>${hubEsc(d.username)} <span class="sub">rating ${d.rating}${d.peak_rating ? ` (peak ${d.peak_rating})` : ''} · ranked ${d.wins}–${d.losses}</span></span><button type="button" class="edit" data-adclose>Close</button></div>
    <p class="sub">Joined ${adminDay(d.created_at)} · seen ${adminAgo(d.last_seen)}</p>
    <div class="gs-row"><span class="grow sub">Block this player from the whole game (they see a notice instead).</span><input type="text" id="gsReason" class="admin-search gs-reason" maxlength="200" placeholder="Reason (optional)"><button type="button" class="edit" data-adblock>Block</button><button type="button" class="edit" data-adunblock>Unblock</button></div>
    <h4>Players owned (${d.owned.length})</h4>${owned}
    <h4>Career</h4>${career}
    ${stats}`;
  box.querySelector('[data-adblock]')!.addEventListener('click', async () => {
    if (!confirm(`Block ${d.username} from the game?`)) return;
    const ok = await m.adminBlock(d.username, true, (document.getElementById('gsReason') as HTMLInputElement).value);
    toast(ok ? `${d.username} is blocked` : 'Couldn’t block them', ok ? 'They see the notice within a minute.' : 'Is supabase/3.13-game-switch.sql set up?');
    void drawGameSwitch();
  });
  box.querySelector('[data-adunblock]')!.addEventListener('click', async () => {
    const ok = await m.adminBlock(d.username, false);
    toast(ok ? `${d.username} unblocked` : 'Couldn’t unblock them', ok ? 'They can play again within a minute.' : 'Is supabase/3.13-game-switch.sql set up?');
    void drawGameSwitch();
  });
  box.querySelector('[data-adclose]')!.addEventListener('click', () => { box.hidden = true; document.querySelectorAll('#adminList li.sel').forEach((l) => l.classList.remove('sel')); });
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
document.querySelectorAll<HTMLButtonElement>('[data-hub]').forEach((t) => t.addEventListener('click', () => showHubTab(t.dataset.hub!)));



async function renderMatches() {
  const m = await loadAccount();
  const rows = await m.myMatches();
  const list = document.getElementById('acMatches')!;
  list.innerHTML = rows.length ? rows.map((r) => {
    const when = new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `<li><span class="${r.won ? 'won' : 'lost'}">${r.won ? 'W' : 'L'}</span><span class="grow">v ${hubEsc(r.opponent)}<span class="sub">${hubEsc(r.score)} · ${when}</span></span><b class="${r.change >= 0 ? 'won' : 'lost'}">${r.change >= 0 ? '+' : ''}${r.change}</b></li>`;
  }).join('') : '<li class="empty">No ranked matches yet. Try Quick match on the home page.</li>';
}

/** Fill a leaderboard list (the hub's tab or the footer pop-up). Anyone can see it, logged in or not. */
/** Which global leaderboard the Leaderboard tab shows. */
let board = 'rating';
const BOARDS: Record<string, { note: string; unit: (v: number) => string }> = {
  wins: { note: 'Most matches won (against the CPU and online), by everyone with an account.', unit: (v) => `${v} wins` },
  max_smash: { note: 'Fastest smash ever hit, by everyone with an account.', unit: (v) => `${v} km/h` },
  max_rally: { note: 'Longest rally in a match.', unit: (v) => `${v} shots` },
  perfect_hits: { note: 'Most perfectly timed hits, all time.', unit: (v) => `${v}` },
  max_streak: { note: 'Longest run of matches won in a row.', unit: (v) => `${v} in a row` },
  achievements: { note: 'Most achievements unlocked.', unit: (v) => `${v}` },
  career_titles: { note: 'Career titles by title points: bigger titles are worth more. Olympics 50, Worlds 35, Tour Finals 25, Super 1000 18, 750 12, 500 8, 300 5, 100 3 (titles from before 3.14: 3). Local club opens don’t count.', unit: (v) => `${v} pts` },
  career_best_rank: { note: 'Best world ranking reached in career mode.', unit: (v) => `#${v}` },
};
document.querySelectorAll<HTMLButtonElement>('#boardSeg button').forEach((b) => b.addEventListener('click', () => { board = b.dataset.value!; void renderLeaders(); }));

let boardReq = 0;
async function renderLeaders(listId = 'leaderList') {
  // Only the latest request draws (switching boards quickly mustn't let an older answer win).
  const req = ++boardReq;
  const m = await loadAccount();
  if (listId === 'leaderList') {
    document.querySelectorAll<HTMLButtonElement>('#boardSeg button').forEach((b) => b.classList.toggle('on', b.dataset.value === board));
    if (board !== 'rating') {
      const B = BOARDS[board], list = document.getElementById(listId)!;
      document.getElementById('boardNote')!.textContent = `${B.note} Stats count when you’re logged in.`;
      list.innerHTML = '<li class="empty">Loading…</li>';
      if (board === 'career_titles') {
        const tr = await m.leaderboardTitles();
        if (req !== boardReq) return;
        if (tr) {
          list.innerHTML = tr.length ? tr.map((r, i) => {
            const sum = titleSummary(r.stats ?? {});
            return `<li class="${r.username === account?.username ? 'me' : ''}" data-player="${hubEsc(r.username)}"><span class="rank">${i + 1}</span><span class="grow">${hubEsc(r.username)}<span class="t-chips">${titleChips(sum, 6)}</span></span><span class="sub">${sum.titles} title${sum.titles === 1 ? '' : 's'}</span><b>${Number(r.points)} pts</b></li>`;
          }).join('') : '<li class="empty">Nobody has won a career title yet. Be the first.</li>';
          return;
        }
      }
      // One failed request (a network blip, a login that needs refreshing) shouldn't blank the board: try again once.
      let rows = await m.leaderboardStat(board);
      if (rows === null && req === boardReq) { await new Promise((r) => setTimeout(r, 800)); rows = await m.leaderboardStat(board); }
      if (req !== boardReq) return;
      list.innerHTML = rows === null ? '<li class="empty">Couldn’t load this leaderboard. Check your connection, then click the tab again.</li>'
        : rows.length ? rows.map((r, i) => `<li class="${r.username === account?.username ? 'me' : ''}" data-player="${hubEsc(r.username)}"><span class="rank">${i + 1}</span><span class="grow">${hubEsc(r.username)}</span><b>${board === 'career_titles' ? `${r.value} title${Number(r.value) === 1 ? '' : 's'}` : B.unit(Number(r.value))}</b></li>`).join('')
        : '<li class="empty">Nobody on this board yet. Be the first.</li>';
      return;
    }
    document.getElementById('boardNote')!.textContent = 'Top 50 by rating from quick matches and rated friend matches. Everyone starts at 1000; ranks are shown beside each name.';
  }
  const rows = await m.leaderboard();
  if (req !== boardReq) return;
  document.getElementById(listId)!.innerHTML = rows.length ? rows.map((r, i) => {
    const t = tierOf(r.rating);
    return `<li class="${r.username === account?.username ? 'me' : ''}" data-player="${hubEsc(r.username)}"><span class="rank">${i + 1}</span><span class="grow">${hubEsc(r.username)}<span class="sub" style="color:${t.color}">${t.name}</span></span><span class="sub">${r.wins}–${r.losses}</span><b>${r.rating}</b></li>`;
  }).join('') : '<li class="empty">Nobody has played a ranked match yet. Be the first.</li>';
}

// 3.14: click anyone on a leaderboard (or a friend) to see their player card.
const showCard = (name: string) => void loadAccount().then((m) => openPlayerCard(name, m.playerCard, account?.username, career));
document.getElementById('leaderList')!.addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('[data-player]');
  if (li?.dataset.player) showCard(li.dataset.player);
});
document.getElementById('acCard')?.addEventListener('click', () => { if (account) showCard(account.username); });

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
    const name = `<span class="grow"><button type="button" class="name-link" data-card="${hubEsc(f.username)}">${hubEsc(f.username)}</button><span class="sub">${f.direction === 'friend' ? (f.online ? 'Online' : 'Offline') + ` · ${f.rating}` : f.direction === 'incoming' ? 'Wants to be friends' : 'Request sent'}</span></span>`;
    const actions = f.direction === 'friend'
      ? `<button class="primary" data-act="invite" data-id="${f.id}" ${f.online ? '' : 'disabled'}>Invite</button><button class="quiet" data-act="remove" data-id="${f.id}">Remove</button>`
      : f.direction === 'incoming'
        ? `<button class="primary" data-act="accept" data-id="${f.id}">Accept</button><button class="quiet" data-act="decline" data-id="${f.id}">Decline</button>`
        : `<button class="quiet" data-act="remove" data-id="${f.id}">Cancel</button>`;
    return `<li><span class="dot ${f.direction === 'friend' && f.online ? 'on' : ''}"></span>${name}${actions}</li>`;
  }).join('') : '<li class="empty">No friends yet. Add someone by their username.</li>';
}
document.getElementById('friendList')!.addEventListener('click', async (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-card]');
  if (card?.dataset.card) { showCard(card.dataset.card); return; }
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
  { target: '.bc-career', title: 'Career', text: 'Career mode: travel the tour, earn prize money, climb the world ranking and recruit players. Your best ranking, title points and record show here. The daily challenge is here too (log in first).', before: () => { closeDrawers(); closeSocial(); } },
  { target: '.bc-ranked', title: 'Ranked and online', text: 'Quick match finds someone near your rating for a ranked game (log in first). Your rating and tier show here. Create room gives you a code to send a friend, and Join takes you into theirs.' },
  { target: '.bc-exhib', title: 'A match against the CPU', text: 'An exhibition match against the CPU: who you’re playing and the scoring. Press Walk on (or Enter) to play, and Match card to change the level and format.' },
  { target: '#controlsBtn', title: 'Your controls', text: 'How you play: keyboard and mouse, keys with a trackpad, or keyboard only. Click it any time to switch.' },
  { target: '#matchcard', title: 'Match card', text: 'Match card opens this: singles or doubles, the CPU’s level and style, your doubles partner, 1 or 3 games to 15 or 21, and how accurate shots are.', before: () => openDrawer('card') },
  { target: '.ltile-tutorial', title: 'Tutorial', text: 'New to the game? The tutorial is short lessons with a coach feeding you shuttles, from moving to jump smashes and doubles.', before: closeDrawers },
  { target: '.ltile-practice', title: 'Practice', text: 'Drills are practice: drill any shot against a feeder. In practice, number keys 1–9 switch drills.' },
  { target: '#kitBtn', title: 'Assists & controls', text: 'This tab on the left edge slides out your assists and controls. Click it again to put it away.' },
  { target: '#kitcard', title: 'Assists', text: 'Turn help on or off: the landing marker (on by default), the timing light, swing assist, doubles auto-switch and the umpire’s voice.', before: () => openDrawer('kit', 'assists') },
  { target: '#kitcard', title: 'Controls and keys', text: 'Switch control mode, change any key under Your keys, and see how to play every shot.', before: () => openDrawer('kit', 'controls') },
  { target: '#socialBtn', title: 'Social', text: 'Everything about you and other players: your stats, friends, the leaderboard and your ranked matches.', before: () => { closeDrawers(); closeSocial(); } },
  { target: '.social-panel', title: 'Your stats', text: 'Every finished match adds up: fastest smash, longest rally, win streaks, aces, perfect jumps and more. The tabs along the top have your friends, the top 50 and your ranked history.', before: () => openSocial('overview') },
  { target: '#accountBtn', title: 'Your account', text: 'Log in or sign up with a username and passcode to keep your stats and settings on any computer, play ranked and add friends. Once you’re in, it shows your rating.', before: closeSocial },
  { target: '.board-foot', title: 'Help and updates', text: 'How to play lists every shot and key, Take the tour brings you back here, and What’s new shows every update (with a NEW badge when there’s one you haven’t seen).' },
  { target: '#fsLink', title: 'Fullscreen and camera', text: 'Go fullscreen from here (or press F in a match). In a match, the buttons at the bottom right switch between the close and broadcast camera.' },
  { target: '#start', title: 'Ready?', text: 'That’s everything. Start a career, play someone online, or press Walk on to play the CPU.' },
], () => { closeSocial(); closeDrawers(); document.getElementById('tourBtn')?.focus(); });
/** Taking the tour (from the footer or the welcome card) counts as having seen it. */
function startTour() {
  closeAccountIfOpen();
  try { localStorage.setItem('badminton.tourDone', '1'); } catch { /* storage unavailable */ }
  document.getElementById('tourBadge')!.hidden = true;
  tour.start();
}
document.getElementById('tourBtn')!.addEventListener('click', startTour);
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
  maybeWelcome();
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
  maybeWelcome();
});
document.getElementById('controlsBtn')!.addEventListener('click', openControlsPick);
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !controlsPick.classList.contains('hidden')) closeControlsPick(); });
syncControlsLabel();

// ── You: look and settings profiles ──────────────────────────────────────────
const SHIRTS = ['#ff6a4d', '#e63946', '#f4a261', '#ffd166', '#2a9d8f', '#3a86ff', '#8338ec', '#ff4fa3', '#f1f1f1', '#222831'];
const RACKETS = ['#eef1f4', '#ffd166', '#ff4d4d', '#4dd2ff', '#7cff6b', '#c77dff', '#111111'];
function syncYou() {
  (document.getElementById('playerName') as HTMLInputElement).value = settings.playerName ?? '';
  const sw = (id: string, colors: string[], cur: string | undefined, fallback: string) => {
    document.getElementById(id)!.innerHTML = colors.map((c) => `<button type="button" class="sw${(cur || fallback) === c ? ' on' : ''}" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('');
  };
  sw('shirtSw', SHIRTS, settings.shirt, SHIRTS[0]);
  sw('racketSw', RACKETS, settings.racket, RACKETS[0]);
  const P = loadProfiles();
  document.getElementById('profileSel')!.innerHTML = Object.keys(P.list).map((n) => `<option${n === P.active ? ' selected' : ''}>${hubEsc(n)}</option>`).join('');
  (document.getElementById('profileDel') as HTMLButtonElement).disabled = Object.keys(P.list).length < 2;
}
document.getElementById('playerName')!.addEventListener('input', (e) => { settings.playerName = (e.target as HTMLInputElement).value.trim().slice(0, 16); saveSettings(); });
for (const [id, key] of [['shirtSw', 'shirt'], ['racketSw', 'racket']] as const) {
  document.getElementById(id)!.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('[data-color]')?.dataset.color;
    if (!c) return;
    settings[key] = c;
    saveSettings();
    syncYou();
  });
}

/** Settings profiles on this computer: each a full copy of the settings, one active. */
interface Profiles { active: string; list: Record<string, Partial<Settings>> }
function loadProfiles(): Profiles {
  try {
    const p = JSON.parse(localStorage.getItem('badminton.profiles') ?? 'null') as Profiles | null;
    if (p && p.list[p.active]) return p;
  } catch { /* none yet */ }
  return { active: 'Player 1', list: { 'Player 1': { ...settings } } };
}
function storeProfiles(p: Profiles) { try { localStorage.setItem('badminton.profiles', JSON.stringify(p)); } catch { /* storage unavailable */ } }
/** Keep the active profile up to date with the current settings. */
function saveProfile() { const p = loadProfiles(); p.list[p.active] = { ...settings }; storeProfiles(p); }
/** Switch to a profile: its settings replace the current ones everywhere. */
function useProfile(name: string) {
  const p = loadProfiles();
  p.list[p.active] = { ...settings };
  p.active = name;
  storeProfiles(p);
  // Start from the standard settings so nothing from the previous profile (a name, a shirt) carries over.
  const next: Record<string, unknown> = { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), ...p.list[name] };
  for (const k of Object.keys(settings)) if (!(k in next)) delete (settings as unknown as Record<string, unknown>)[k];
  Object.assign(settings, next);
  saveSettings();
  setView(broadcast, settings.view);
  resize();
  syncViewbar();
  syncMenu();
  describeControls();
  describeFormat();
  renderBinds();
  syncControlsLabel();
  syncYou();
  if (!settings.controlsChosen) openControlsPick();
}
document.getElementById('profileSel')!.addEventListener('change', (e) => useProfile((e.target as HTMLSelectElement).value));
document.getElementById('profileNew')!.addEventListener('click', () => {
  const row = document.getElementById('profileNewRow')!;
  row.hidden = !row.hidden;
  if (!row.hidden) (document.getElementById('profileName') as HTMLInputElement).focus();
});
document.getElementById('profileCreate')!.addEventListener('click', () => {
  const input = document.getElementById('profileName') as HTMLInputElement, name = input.value.trim().slice(0, 16);
  const p = loadProfiles();
  if (!name || p.list[name]) { input.focus(); return; }
  // A new profile starts from the standard settings, with its name on the scoreboard.
  p.list[p.active] = { ...settings };
  p.list[name] = { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), playerName: name, controlsChosen: false };
  storeProfiles(p);
  input.value = '';
  document.getElementById('profileNewRow')!.hidden = true;
  useProfile(name);
});
document.getElementById('profileDel')!.addEventListener('click', () => {
  const p = loadProfiles(), names = Object.keys(p.list);
  if (names.length < 2) return;
  delete p.list[p.active];
  p.active = Object.keys(p.list)[0];
  storeProfiles(p);
  useProfile(p.active);
});
syncYou();

// ── Welcome (newcomers and logged-out visitors) ──────────────────────────────
// First visit: a big nudge to take the tour, plus signing up. Back again but logged out: just the
// sign-up pitch, at most once a day, and it can be turned off. Logged in: nothing.
const TOUR_DONE = 'badminton.tourDone', WELCOME_OFF = 'badminton.welcomeOff', WELCOME_SEEN = 'badminton.welcomeSeen';
const welcome = document.getElementById('welcome')!;
const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
let welcomeShown = false;
function syncTourBadge() { document.getElementById('tourBadge')!.hidden = !!stored(TOUR_DONE); }
function maybeWelcome() {
  if (welcomeShown || game) return;
  if (account || stored('badminton.account')) return;
  const seen = Number(stored(WELCOME_SEEN) ?? 0), newcomer = !seen && !stored(TOUR_DONE);
  if (!newcomer && (stored(WELCOME_OFF) || Date.now() - seen < 24 * 3600e3)) return;
  welcomeShown = true;
  store(WELCOME_SEEN, String(Date.now()));
  document.getElementById('welcomeTour')!.hidden = !newcomer;
  document.getElementById('welcomeNeverRow')!.hidden = newcomer;
  document.getElementById('welcomeKicker')!.textContent = newcomer ? 'First time here?' : 'Welcome back';
  document.getElementById('welcomeTitle')!.textContent = newcomer ? 'Welcome to Skyline Smash' : 'Save your progress';
  welcome.classList.remove('hidden');
  (document.getElementById(newcomer ? 'welcomeTourBtn' : 'welcomeSignup') as HTMLButtonElement).focus();
}
function closeWelcome() {
  if ((document.getElementById('welcomeNever') as HTMLInputElement).checked) store(WELCOME_OFF, '1');
  welcome.classList.add('hidden');
}
document.getElementById('welcomeTourBtn')!.addEventListener('click', () => { closeWelcome(); startTour(); });
document.getElementById('welcomeSignup')!.addEventListener('click', () => { closeWelcome(); openAccount('Pick a username and passcode, then press Sign up.'); });
document.getElementById('welcomeLogin')!.addEventListener('click', () => { closeWelcome(); openAccount(); });
document.getElementById('welcomeGuest')!.addEventListener('click', closeWelcome);
welcome.addEventListener('click', (e) => { if (e.target === welcome) closeWelcome(); });
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !welcome.classList.contains('hidden')) closeWelcome(); });
syncTourBadge();

// First visit: controls first, then the welcome.
if (!settings.controlsChosen) openControlsPick();
else maybeWelcome();

// ── Online rooms (Court 2) ───────────────────────────────────────────────────
const roomModal = document.getElementById('roomModal')!;
const roomJoin = document.getElementById('roomJoin')!, roomLobby = document.getElementById('roomLobby')!;
const roomCodeIn = document.getElementById('roomCodeIn') as HTMLInputElement, roomJoinMsg = document.getElementById('roomJoinMsg')!;
const roomStart = document.getElementById('roomStart') as HTMLButtonElement, roomStatus = document.getElementById('roomStatus')!;
let room: RoomConnection | null = null;
/** This game's version: the room compares it so players on an old page are told to refresh. */
const GAME_VERSION = CHANGELOG[0].version;
/** Someone in the room is on a different version: who, and whether it's you that's out of date. */
function versionClash(r: Roster | null | undefined): { name: string; mineOld: boolean; roster?: boolean } | null {
  for (const p of seated(r)) {
    // (A room server from before 2.5.4 doesn't report versions at all: nothing to compare.)
    if (p.seat === r?.you || p.v === undefined) continue;
    // Same version but a different list of players (a roster update): whoever loaded first refreshes.
    if (p.v === GAME_VERSION) { if (p.r && p.r !== ROSTER_HASH) return { name: p.name, mineOld: false, roster: true }; continue; }
    // An empty version is a page from before 2.5.4: always the older one.
    const theirs = (p.v || '0').split(/[.–-]/).map(Number), mine = GAME_VERSION.split(/[.–-]/).map(Number);
    let mineOld = false;
    for (let i = 0; i < 3; i++) { if ((mine[i] ?? 0) !== (theirs[i] ?? 0)) { mineOld = (mine[i] ?? 0) < (theirs[i] ?? 0); break; } }
    return { name: p.name, mineOld };
  }
  return null;
}
/** What a room needs besides your name: roster fingerprint, your player, and your login (friend rooms only). */
function roomExtra(auth = true) {
  return { roster: ROSTER_HASH, character: myCharacter(), auth: auth && account ? () => loadAccount().then((a) => a.accessToken()) : undefined };
}
/** Online doubles is held back while it's made steadier: rooms are singles only (doubles is still there against the CPU). */
const ONLINE_DOUBLES = false;
/** The room's match settings (the host's choice). Doubles fills empty places with CPUs at `level`. */
let roomSettings: { games: number; points: number; event?: 'singles' | 'doubles'; level?: Level; elo?: boolean } = { games: settings.games, points: settings.points, event: 'singles', level: 'medium' };
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

/** Everyone seated in the room, with their team (0 = the host's). */
function seated(r: Roster | null | undefined) {
  return SEATS.flatMap((seat) => { const p = r?.[seat]; return p ? [{ seat, ...p, team: seat === 'host' ? 0 : p.team ?? 1 }] : []; });
}

/** Doubles: the four places in court order (host's team in 0 and 2), CPUs where nobody is sitting. */
function buildLineup(r: Roster): LineupSlot[] {
  let cpu = 0;
  const team = (t: number) => {
    const list: LineupSlot[] = seated(r).filter((p) => p.team === t).map((p) => ({ seat: p.seat, name: p.name }));
    while (list.length < 2) list.push({ seat: null, name: `CPU ${++cpu}` });
    return list;
  };
  const a = team(0), b = team(1);
  return [a[0], b[0], a[1], b[1]];
}

function renderLobby() {
  if (!room) return;
  const r = room.roster, host = r?.you === 'host';
  document.getElementById('roomCode')!.textContent = room.code;
  const row = (id: string, p: { name: string; connected: boolean } | null | undefined, mine: boolean, role: string) => {
    const li = document.getElementById(id)!;
    li.className = p ? (p.connected ? 'on' : 'away') : '';
    li.innerHTML = p ? `${hubEsc(p.name)}${mine ? ' (you)' : ''}<em>${p.connected ? role : 'reconnecting'}</em>` : `Waiting for your opponent…<em>${role}</em>`;
  };
  row('roomHost', r?.host, r?.you === 'host', 'host');
  row('roomGuest', r?.guest, r?.you === 'guest', 'guest');
  const ranked = r?.ranked;
  const people = seated(r);
  const doubles = ONLINE_DOUBLES && !ranked && roomSettings.event === 'doubles';
  const me = people.find((p) => p.seat === r?.you);
  // Doubles: your team on the left, CPUs in the empty places.
  const picking = rankedPicking(r);
  document.getElementById('roomSingles')!.hidden = doubles || picking;
  renderVs(picking ? r : null);
  document.getElementById('roomTeams')!.hidden = !doubles;
  if (doubles) {
    const level = roomSettings.level ?? 'medium';
    const fill = (id: string, t: number) => {
      const list = people.filter((p) => p.team === t);
      document.getElementById(id)!.innerHTML = [0, 1].map((k) => {
        const p = list[k];
        if (!p) return `<li class="cpu">CPU<em>${level}</em></li>`;
        return `<li class="${p.connected ? 'on' : 'away'}${p.seat === r?.you ? ' me' : ''}">${hubEsc(p.name)}${p.seat === r?.you ? ' (you)' : ''}<em>${!p.connected ? 'reconnecting' : p.seat === 'host' ? 'host' : ''}</em></li>`;
      }).join('');
    };
    const mine = me?.team ?? 0;
    fill('roomTeamMine', mine);
    fill('roomTeamThem', 1 - mine);
  }
  const sw = document.getElementById('roomSwitch') as HTMLButtonElement;
  sw.hidden = !doubles || host || !me;
  sw.disabled = !me || people.filter((p) => p.team !== me.team).length >= 2;
  const lockSeg = (id: string, value: string | number) => {
    const seg = document.getElementById(id)!;
    seg.classList.toggle('locked', !host);
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.value === String(value)));
  };
  lockSeg('roomGames', roomSettings.games);
  lockSeg('roomPoints', roomSettings.points);
  lockSeg('roomEvent', roomSettings.event ?? 'singles');
  lockSeg('roomLevel', roomSettings.level ?? 'medium');
  lockSeg('roomElo', roomSettings.elo ? 'on' : 'off');
  // Counts for rating: both players must be logged in (as different people). Friend matches count 0.75×, 3 a day each.
  {
    const both = !!r?.host?.account && !!r?.guest?.account;
    const note = document.getElementById('roomEloNote')!;
    note.textContent = !roomSettings.elo ? 'Off: this match won’t change anyone’s rating.'
      : both ? 'On: counts at 0.75× a quick match, up to 3 a day against the same friend. You both play the Club Player.'
      : 'On, but both players need to be logged in for it to count.';
  }
  // Singles can't seat more than two.
  document.querySelector<HTMLButtonElement>('#roomEvent [data-value="singles"]')!.classList.toggle('disabled', people.length > 2);
  document.getElementById('roomLevelField')!.hidden = !doubles || people.length >= 4;
  const ready = doubles ? people.length >= 2 && people.every((p) => p.connected) : !!(r?.host?.connected && r?.guest?.connected);
  // Ranked rooms: no code to share and no settings; the match starts by itself once you're both in.
  document.querySelector<HTMLElement>('#roomLobby .room-code')!.hidden = !!ranked;
  document.querySelectorAll<HTMLElement>('#roomLobby .field-row').forEach((f) => { f.hidden = !!ranked || (f.classList.contains('room-mode') && !ONLINE_DOUBLES); });
  document.getElementById('roomTitle')!.textContent = ranked ? 'Ranked match' : 'Your room';
  // Each player's round trip to the server, so a slow connection is easy to spot before playing.
  const conn = ready && room.rtt && room.peerRtt
    ? ` Connection: you ${Math.round(room.rtt)} ms, ${doubles ? 'others' : 'them'} ${Math.round(room.peerRtt)} ms${room.latency >= 150 ? ' (laggy: try moving closer to the Wi-Fi)' : ''}.`
    : '';
  const clash = versionClash(r);
  const refresh = document.getElementById('roomRefresh')!, next = document.getElementById('roomNext')!;
  refresh.hidden = !clash?.mineOld;
  // Ranked: over, or the opponent never turned up: offer the next match instead of waiting forever.
  const rankedOver = !!ranked && !!r?.match?.finished && !game;
  const noShow = !!ranked && !ready && !rankedOver && Date.now() - roomOpenedAt > 30_000;
  next.hidden = !(rankedOver || noShow);
  if (clash) {
    roomStart.hidden = !host;
    roomStart.disabled = true;
    refresh.hidden = !clash.mineOld && !clash.roster;
    roomStatus.textContent = clash.roster
      ? `You and ${clash.name} have different player lists. Whoever loaded the game first should refresh their page (seats are kept).`
      : clash.mineOld
      ? 'There’s a newer version of the game. Refresh this page to play (your seat is kept).'
      : `Waiting for ${clash.name} to refresh their page: they’re on an older version of the game.`;
    return;
  }
  if (ranked) {
    roomStart.hidden = true;
    roomStatus.textContent = (rankedOver ? 'This ranked match is over. Find another when you’re ready.'
      : noShow ? 'Your opponent hasn’t joined. Find another match, or keep waiting.'
      : ready && picking ? `Press Ready. Starts when you’re both ready, or in ${pickSecondsLeft()} s.`
      : ready ? 'Both here. Starting…' : 'Ranked · 1 game to 21 · you both play the Club Player') + conn;
    return;
  }
  roomStart.hidden = !host;
  roomStart.disabled = !ready;
  const cpus = 4 - people.length;
  roomStatus.textContent = (room.status === 'connecting' ? 'Connecting…'
    : room.status === 'reconnecting' ? 'Connection lost, reconnecting…'
    : doubles && !ready ? (host ? 'Send friends the code or invite link (up to 3). Empty places are played by CPUs.' : 'Waiting for the host…')
    : doubles ? `${people.length} players${cpus ? ` and ${cpus} CPU${cpus > 1 ? 's' : ''}` : ''}. ${host ? 'Press Start match when everyone’s ready.' : 'Pick your team; the host starts the match.'}`
    : !ready ? (host ? 'Send your friend the code or the invite link. You can start once they join.' : 'Waiting for the host…')
    : host ? 'Both here. Press Start match when you’re ready.' : 'Both here. Waiting for the host to start.') + conn;
}

/** When this room was opened (to notice an opponent who never joins). */
let roomOpenedAt = 0;
/** Ranked pick (3.6): when both players were first here, and what the pick cards last showed. */
let bothHereAt = 0;
let vsKey = '';
const PICK_SECONDS = 30;
/** Asked the room to carry on a match in progress (after a reload), once per connection. */
let resumeAsked = false;
/** Carried on a match while these players were away: when one comes back, everyone lines up again. */
const resumedWithout = new Set<string>();
/**
 * Leaving a live ranked match: ask first. If the opponent is the one who's disconnected, leaving
 * cancels the match instead (no rating change), and the question says so.
 */
function confirmLeave(): boolean {
  const r = room?.roster;
  const live = !!r?.ranked && (!!r.match?.playing || (!!game?.online && game.state !== 'matchOver' && game.forfeitWinner === null));
  if (!live) return true;
  const opp = r!.you === 'host' ? r!.guest : r!.host;
  return confirm(opp?.connected
    ? 'Leave this ranked match? Leaving counts as a loss, so your rating goes down.'
    : `${opp?.name ?? 'Your opponent'} is disconnected, so leaving now cancels the match: no rating change for either of you. Leave?`);
}
function openRoom(code: string) {
  leaveRoom();
  room = new RoomConnection(code, roomToken(code), myName(), GAME_VERSION, roomExtra());
  roomOpenedAt = Date.now();
  bothHereAt = 0; vsKey = '';
  resumeAsked = false;
  room.on(onRoomMsg);
  // Reloading the page brings you back to the same seat in this room.
  history.replaceState(null, '', `/play?room=${code}`);
  showRoomView('lobby');
  renderLobby();
  presenceNow();
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
      {
        const both = !!(m.host?.connected && m.guest?.connected), same = !versionClash(m);
        // A match is already under way and this page has none (it was reloaded): carry on, even if the
        // other player is away right now (you wait for them in the match, not on the room screen).
        if (m.match?.playing && !game && same && !resumeAsked) { resumeAsked = true; room.send({ type: 'resumeReq' }); }
        // Ranked: the host's screen starts the match as soon as both players are connected (and on the same version).
        else if (m.ranked && both && same && !game && !m.match) { if (!bothHereAt) bothHereAt = Date.now(); maybeStartRanked(); }
        if (!both) bothHereAt = 0;
      }
      break;
    case 'resume': {
      // Someone's page reloaded mid-match: everyone restarts from the last point.
      roomSettings = { ...roomSettings, ...(m.settings as typeof roomSettings) };
      startOnline(room.roster?.you === 'host', undefined, m.match);
      // Anyone not connected yet: wait for them in the match. When they're back, line everyone up again.
      const r = room.roster;
      resumedWithout.clear();
      for (const seat of SEATS) if (seat !== r?.you && r?.[seat] && !r[seat]!.connected) { game?.markAway(seat); resumedWithout.add(seat); }
      break;
    }
    case 'peer':
      if (m.status === 'back' && m.seat && resumedWithout.delete(m.seat)) room.send({ type: 'resumeReq' });
      break;
    case 'result':
      if (game?.online) game.rankedResult = m;
      void refreshStats();
      void renderMatches();
      break;
    case 'settings': roomSettings = m.settings as typeof roomSettings; break;
    case 'start': roomSettings = m.settings as typeof roomSettings; startOnline(false, m.lineup); break;
    case 'rematch':
      peerRematch = true;
      if (room.roster?.you === 'host' && game?.rematchAsked && !game.doubles) hostStart();
      break;
    case 'full':
      showRoomView('join');
      roomJoinMsg.textContent = 'That room is full.';
      room = null;
      return;
  }
  renderLobby();
}

function startOnline(host: boolean, lineup?: LineupSlot[], resume?: MatchSnapshot) {
  const r = room?.roster;
  // Doubles: your place in the lineup; singles: the other player.
  const me = lineup ? lineup.findIndex((s) => s.seat === r?.you) : -1;
  const opp = lineup ? lineup[me % 2 === 0 ? 1 : 0] : host ? r?.guest : r?.host;
  if (!room || !r || !opp || (lineup && me < 0)) return;
  game?.dispose();
  sound.init();
  voice.enabled = settings.voice;
  voice.unlock();
  peerRematch = false;
  logEvent('start', 'online', null);
  const ranked = r?.ranked ? { mine: host ? r.ranked.host : r.ranked.guest, theirs: host ? r.ranked.guest : r.ranked.host } : null;
  const level = lineup ? roomSettings.level ?? 'medium' : settings.opponent;
  const friendRated = !ranked && !lineup && !!roomSettings.elo && !!r.host?.account && !!r.guest?.account;
  // 3.15: anything that changes your rating is played as the Club Player on both sides: pure skill.
  const pure = !!ranked || friendRated;
  game = new Game({ ...settings, games: roomSettings.games as 1 | 3, points: roomSettings.points as 15 | 21, opponent: level }, input, broadcast, 'online',
    { conn: room, host, opponentName: opp.name, ranked, lineup, me: lineup ? me : undefined, resume, friendRated },
    withOpponent(defaultSetup(ranked ? 'ranked' : 'friendly', roomSettings.games as 1 | 3, roomSettings.points as 15 | 21, pure ? DEFAULT_CHARACTER : myCharacter()),
      pure ? DEFAULT_CHARACTER : lineup || !('connected' in opp) ? null : opp.character ?? null));
  game.onMatchOver = recordCareer;
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  closeDrawers();
  roomModal.classList.add('hidden');
  menu.classList.add('hidden');
  (document.activeElement as HTMLElement | null)?.blur();
}

// ── Ranked player pick (3.6): both players choose, see each other's player and stats, then lock in. ──
function withOpponent(setup: MatchSetup, id: string | null): MatchSetup { return id ? { ...setup, opponent: { ...setup.opponent, characterId: id } } : setup; }
function rankedPicking(r: Roster | null | undefined) { return !!r?.ranked && !!r.host && !!r.guest && !r.match && !game; }
function pickSecondsLeft() { return Math.max(0, Math.ceil(PICK_SECONDS - (Date.now() - (bothHereAt || Date.now())) / 1000)); }
function maybeStartRanked() {
  const r = room?.roster;
  if (!r || r.you !== 'host' || !rankedPicking(r) || !r.host?.connected || !r.guest?.connected || versionClash(r)) return;
  if ((r.host.ready && r.guest.ready) || (bothHereAt && pickSecondsLeft() <= 0)) hostStart();
}
window.setInterval(() => {
  if (!room || !rankedPicking(room.roster)) return;
  maybeStartRanked();
  if (!game) renderLobby();
}, 1000);

/** 3.15: ranked is the Club Player for both, so the cards show who you're playing and their rating. */
function rankedVsCard(seat: RosterSeat, mine: boolean, rating: number | undefined) {
  const t = rating != null ? tierOf(rating) : null;
  const btn = mine ? `<button type="button" class="${seat.ready ? '' : 'primary'} vs-ready" data-vsready>${seat.ready ? 'Not ready' : 'Ready'}</button>` : '';
  return `<div class="vs-card${seat.ready ? ' ready' : ''}" style="--rar:${RARITY.common.color}">
    <div class="who"><span>${hubEsc(seat.name)}${mine ? ' (you)' : ''}</span>${seat.ready ? '<b>Ready</b>' : `<span>${seat.connected ? 'Getting ready…' : 'Reconnecting'}</span>`}</div>
    <h3>${rating != null ? Math.round(rating) : '–'}</h3>
    <p class="sub">${t ? hubEsc(t.name) + ' · ' : ''}rating</p>
    <p class="sub">Playing as the Club Player. Same player on both sides, so it comes down to your skill.</p>
    ${btn}
  </div>`;
}
function vsCard(seat: RosterSeat, mine: boolean, other: RosterSeat | null) {
  const c = characterById(seat.character ?? DEFAULT_CHARACTER), r = RARITY[c.rarity];
  const o = other ? characterById(other.character ?? DEFAULT_CHARACTER) : null;
  const rows = STAT_LABELS.map((l, i) => {
    const d = o ? c.stats[i] - o.stats[i] : 0;
    return `<tr><td>${l}</td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${c.stats[i]}</td></tr>`;
  }).join('');
  const pick = mine && !seat.ready
    ? `<select data-vspick>${VISIBLE.filter((x) => canUse(x.id) || x.id === c.id).sort((a, b) => RARITY[b.rarity].order - RARITY[a.rarity].order || a.name.localeCompare(b.name))
        .map((x) => `<option value="${x.id}"${x.id === c.id ? ' selected' : ''}>${hubEsc(x.name)} · ${RARITY[x.rarity].label}</option>`).join('')}</select>`
    : '';
  const btn = mine ? `<button type="button" class="${seat.ready ? '' : 'primary'} vs-ready" data-vsready>${seat.ready ? 'Change player' : 'Ready'}</button>` : '';
  return `<div class="vs-card${seat.ready ? ' ready' : ''}" style="--rar:${r.color}">
    <div class="who"><span>${hubEsc(seat.name)}${mine ? ' (you)' : ''}</span>${seat.ready ? '<b>Ready</b>' : `<span>${seat.connected ? 'Picking…' : 'Reconnecting'}</span>`}</div>
    <p class="rar-line" style="--rar:${r.color}"><span class="rar">${r.label}</span> ${hubEsc(countryName(c.country))}</p>
    <h3>${hubEsc(c.name)}</h3>
    ${pick}
    <canvas class="pentagon" data-vspent="${mine ? 'me' : 'them'}"></canvas>
    <p class="sub">${hubEsc(c.style)} · ${c.handedness === 'left' ? 'left-handed' : 'right-handed'} · stats total ${statTotal(c)}</p>
    <table>${rows}</table>
    ${btn}
  </div>`;
}
function renderVs(r: Roster | null) {
  const box = document.getElementById('roomVs')!;
  box.hidden = !r;
  roomModal.classList.toggle('picking', !!r);
  if (!r) { vsKey = ''; return; }
  const mine = r.you === 'host' ? r.host! : r.guest!, theirs = r.you === 'host' ? r.guest! : r.host!;
  const key = JSON.stringify([mine, theirs]);
  if (key === vsKey) return;
  // 3.9.5: don't redraw under an open player list (it would snap shut); the next tick catches up.
  if (document.activeElement?.matches?.('#roomVs [data-vspick]')) return;
  vsKey = key;
  if (r.ranked) {
    const rt = r.ranked, myR = r.you === 'host' ? rt.host : rt.guest, theirR = r.you === 'host' ? rt.guest : rt.host;
    box.innerHTML = `${rankedVsCard(mine, true, myR)}<span class="vs">VS</span>${rankedVsCard(theirs, false, theirR)}`;
    return;
  }
  box.innerHTML = `${vsCard(mine, true, theirs)}<span class="vs">VS</span>${vsCard(theirs, false, mine)}`;
  const me = characterById(mine.character ?? DEFAULT_CHARACTER), them = characterById(theirs.character ?? DEFAULT_CHARACTER);
  drawPentagon(box.querySelector('[data-vspent="me"]') as HTMLCanvasElement, me.stats, RARITY[me.rarity].color, { stats: them.stats, color: '#1f2937' });
  drawPentagon(box.querySelector('[data-vspent="them"]') as HTMLCanvasElement, them.stats, RARITY[them.rarity].color, { stats: me.stats, color: '#1f2937' });
}
if (import.meta.env.DEV) (window as unknown as { renderVs: typeof renderVs }).renderVs = renderVs;
if (import.meta.env.DEV) (window as unknown as { devGame: () => Game | null }).devGame = () => game;
document.getElementById('roomVs')!.addEventListener('change', (e) => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-vspick]');
  if (!sel || !room || !canUse(sel.value)) return;
  settings.character = sel.value; saveSettings();
  sel.blur(); // lets the cards redraw with the new pick
  room.setCharacter(sel.value);
  room.send({ type: 'pick', character: sel.value });
});
document.getElementById('roomVs')!.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('[data-vsready]') || !room?.roster) return;
  const r = room.roster, mine = r.you === 'host' ? r.host : r.guest;
  room.send({ type: 'pick', ready: !mine?.ready });
});

/** Host: start the match on every screen (doubles: with the lineup as the room stands now). */
function hostStart() {
  const r = room?.roster;
  if (!room || r?.you !== 'host') return;
  const lineup = ONLINE_DOUBLES && !r.ranked && roomSettings.event === 'doubles' ? buildLineup(r) : undefined;
  room.send({ type: 'start', settings: roomSettings, lineup });
  startOnline(true, lineup);
}

function askRematch() {
  if (!game?.online || game.rematchAsked || game.forfeitWinner !== null) return;
  game.rematchAsked = true;
  room?.send({ type: 'rematch' });
  // Singles: both ask. Doubles: the host decides.
  if (room?.roster?.you === 'host' && (peerRematch || game.doubles)) hostStart();
}

// ── Quick match ──────────────────────────────────────────────────────────────
let queue: QueueConnection | null = null;
let queueTimer = 0;
async function startQuickMatch() {
  if (!account) { openAccount('Log in or sign up to play ranked quick matches.'); return; }
  const m = await loadAccount();
  const token = await m.freshToken();
  if (!token) { openAccount('Your login has expired. Log in again to play quick match.'); return; }
  // 3.9.5: know which players you own before matching, so you join as your own player (not the Club Player).
  await refreshOwned().catch(() => {});
  leaveRoom();
  showRoomView('queue');
  const started = Date.now();
  window.setTimeout(() => presenceNow(true), 300);
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
      room = new RoomConnection(e.code, e.ticket, myName(), GAME_VERSION, roomExtra(false));
      roomOpenedAt = Date.now();
      resumeAsked = false;
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
roomStart.addEventListener('click', hostStart);
document.getElementById('roomRefresh')!.addEventListener('click', () => location.reload());
document.getElementById('roomNext')!.addEventListener('click', () => void startQuickMatch());
for (const [id, key] of [['roomGames', 'games'], ['roomPoints', 'points'], ['roomEvent', 'event'], ['roomLevel', 'level'], ['roomElo', 'elo']] as const) {
  document.getElementById(id)!.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    if (room?.roster?.you !== 'host' || b.classList.contains('disabled')) return;
    const v = b.dataset.value!;
    roomSettings = { ...roomSettings, [key]: key === 'games' || key === 'points' ? Number(v) : key === 'elo' ? v === 'on' : v };
    room.send({ type: 'settings', settings: roomSettings });
    renderLobby();
  }));
}
document.getElementById('roomSwitch')!.addEventListener('click', () => {
  const me = seated(room?.roster).find((p) => p.seat === room?.roster?.you);
  if (me) room?.send({ type: 'team', team: me.team === 0 ? 1 : 0 });
});
document.getElementById('roomCopy')!.addEventListener('click', async (e) => {
  if (!room) return;
  const btn = e.currentTarget as HTMLButtonElement;
  try { await navigator.clipboard.writeText(`${location.origin}/play?room=${room.code}`); btn.textContent = 'Copied!'; }
  catch { btn.textContent = room.code; }
  setTimeout(() => { btn.textContent = 'Copy invite link'; }, 1600);
});
const closeRoom = () => { if (!confirmLeave()) return; cancelQuickMatch(); leaveRoom(); roomModal.classList.add('hidden'); };
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

// Court 3 on the Order of Play: who you're playing and the format, re-flipped like a board when it changes.
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
  const level = settings.opponent === 'human' ? '' : LEVEL_LABEL[settings.opponent];
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

/** 3.17: one line on each CPU level, shown under the opponent ladder. */
const OPP_NOTE: Record<Level, string> = {
  beginner: 'Slow and soft. Keeps the rally going while you learn.',
  easy: 'Gentle, and makes plenty of mistakes.',
  medium: 'A steady club player.',
  hard: 'Quick and accurate, and punishes short lifts.',
  expert: 'Rarely misses and starts reading your patterns.',
  pro: 'Tour level: fast around the court and attacks a lot.',
  elite: 'Sharper, quicker and harder to get past than Pro.',
  world: 'Gets almost everything back.',
  legend: 'The toughest of the classic levels.',
  titan: 'Above Legend. Aggressive: smashes and kills anything that’s up.',
  phantom: 'Faster and safer than Titan, and more aggressive.',
  immortal: 'Hardly ever gives you a free point.',
  apex: 'Close to the limit. Every part of its game is sharper.',
  ultimate: 'The strongest CPU you can still beat.',
  impossible: 'Jump-smashes every high shuttle from about half court in, at around 700 km/h. Not meant to be beaten.',
};

/** 4.0: every CPU level, easiest first (the order of the home page's level strip). */
const LEVEL_ORDER: Level[] = ['beginner', 'easy', 'medium', 'hard', 'expert', 'pro', 'elite', 'world', 'legend', 'titan', 'phantom', 'immortal', 'apex', 'ultimate', 'impossible'];
const levelTrack = document.getElementById('levelTrack')!;
levelTrack.innerHTML = LEVEL_ORDER.map((l) => `<button type="button" data-level="${l}" class="${l === 'impossible' ? 'imp' : ''}">${LEVEL_LABEL[l]}</button>`).join('');
/** Pick a level the same way the match card does (so everything else follows). */
function pickLevel(l: Level) { document.querySelector<HTMLButtonElement>(`.seg[data-group="opponent"] [data-value="${l}"]`)?.click(); }
function stepLevel(d: number) {
  const i = LEVEL_ORDER.indexOf(settings.opponent as Level);
  const next = LEVEL_ORDER[Math.max(0, Math.min(LEVEL_ORDER.length - 1, (i < 0 ? 2 : i) + d))];
  if (next !== settings.opponent) pickLevel(next);
}
/** Slide the strip so the chosen level sits in the middle. */
function syncLevelStrip() {
  const btns = Array.from(levelTrack.querySelectorAll<HTMLButtonElement>('button'));
  btns.forEach((b) => b.classList.toggle('on', b.dataset.level === settings.opponent));
  const on = btns.find((b) => b.classList.contains('on'));
  const win = levelTrack.parentElement!;
  const x = on ? on.offsetLeft + on.offsetWidth / 2 - win.clientWidth / 2 : 0;
  levelTrack.style.transform = `translateX(${-Math.max(0, Math.min(x, levelTrack.scrollWidth - win.clientWidth))}px)`;
}
const levelPick = document.getElementById('levelPick')!;
levelPick.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const lv = t.closest<HTMLElement>('[data-level]')?.dataset.level as Level | undefined;
  if (lv) { pickLevel(lv); return; }
  const d = t.closest<HTMLElement>('[data-lv]')?.dataset.lv;
  if (d) stepLevel(Number(d));
});
// Scroll over the strip (or the whole CPU box) to step through the levels.
let wheelAcc = 0;
document.querySelector<HTMLElement>('.bc-exhib')!.addEventListener('wheel', (e) => {
  e.preventDefault();
  wheelAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (Math.abs(wheelAcc) >= 60) { stepLevel(Math.sign(wheelAcc)); wheelAcc = 0; }
}, { passive: false });
window.addEventListener('resize', () => syncLevelStrip());

/** 4.0: the ticker along the bottom of the home page: the latest update and some tips. */
{
  const items = [
    `<b>New</b>${CHANGELOG[0].title} (v${CHANGELOG[0].version})`,
    '<b>Tip</b>Scroll over the exhibition box to change the CPU level',
    '<b>Tip</b>A jump smash at the top of your jump is about 15% faster',
    '<b>Ranked</b>Everyone plays the Club Player: it’s pure skill',
    '<b>Career</b>Short of money? Enter through qualifying, or take a tour loan',
    '<b>Tip</b>Press H to challenge a line call, R to watch a replay',
    '<b>Impossible</b>Smashes at around 700 km/h. Good luck',
  ].map((t) => `<span>${t}</span>`).join('');
  document.getElementById('tickerText')!.innerHTML = items + items; // twice, so it loops without a gap
}

function syncMenu() {
  document.querySelectorAll<HTMLElement>('.seg[data-group]').forEach((seg) => {
    const group = seg.dataset.group as keyof Settings;
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', parse(b.dataset.value!) === settings[group]));
  });
  // What makes the chosen CPU style different.
  document.getElementById('styleTrait')!.textContent = STYLES[settings.style].trait;
  // 3.17: what the chosen opponent is like.
  const oppNote = document.getElementById('oppNote')!;
  const o = settings.opponent;
  oppNote.innerHTML = o === 'human' ? '<b>2 players.</b> Share the keyboard: P1 on WASD, P2 on the arrows.'
    : `<b>${LEVEL_LABEL[o]}.</b> ${OPP_NOTE[o]}`;
  oppNote.classList.toggle('danger', o === 'impossible');
  // Swing assist only works against a Beginner or Easy CPU.
  const assistOk = settings.opponent === 'beginner' || settings.opponent === 'easy';
  document.querySelectorAll<HTMLButtonElement>('.seg[data-group="swingAssist"] button').forEach((b) => b.classList.toggle('disabled', !assistOk));
  document.getElementById('assistHelp')!.textContent = assistOk
    ? 'Gets lifts, drops and clears back if you don’t swing. Smashes still need you. Every assisted shot is tagged ASSIST.'
    : 'Only against a Beginner or Easy CPU. Pick one of those to use it.';
  syncLevelStrip();
}

document.querySelectorAll<HTMLElement>('.seg[data-group]').forEach((seg) => {
  const group = seg.dataset.group as keyof Settings;
  seg.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      (settings as unknown as Record<string, unknown>)[group] = parse(btn.dataset.value!);
      // Doubles is against a CPU pair: picking one switches off the other.
      if (group === 'event' && settings.event === 'doubles' && settings.opponent === 'human') settings.opponent = 'medium';
      if (group === 'opponent' && settings.opponent === 'human') settings.event = 'singles';
      if (group === 'performance') resize();
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
syncHomeCards(); // 3.18: guests and first paint (logging in fills it again)

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

/** 4.0: the walk-on for a match against the CPU: you, the CPU level and its style. */
function exhibitionWalkOn(): WalkOnInfo {
  const i = LEVEL_ORDER.indexOf(settings.opponent as Level), lv = settings.opponent as Level, st = STYLES[settings.style];
  const f = RULES.formats[settings.points], doubles = settings.event === 'doubles';
  const g = (k: string) => career[k] ?? 0, played = g('matches');
  const me = account?.username ?? (settings.playerName?.trim() || 'You');
  return {
    event: 'Exhibition', round: `${doubles ? 'Doubles' : 'Singles'} · ${settings.games === 1 ? '1 game' : 'Best of 3'} to ${f.pointsToWin}`,
    me: {
      name: me, line: `${characterById(myCharacter()).name}${myRating ? ` · rating ${myRating.rating}` : ''}`,
      stats: [[played ? `${g('wins')}–${played - g('wins')}` : '–', 'Your record'], [g('max_smash') ? `${Math.round(g('max_smash'))} km/h` : '–', 'Fastest smash'],
        [g('max_rally') ? String(g('max_rally')) : '–', 'Longest rally'], [g('aces') ? String(g('aces')) : '0', 'Aces']],
    },
    them: {
      name: `CPU ${LEVEL_LABEL[lv]}${doubles ? ' pair' : ''}`, line: `Level ${i + 1} of ${LEVEL_ORDER.length} · ${st.label}`,
      stats: [[`${i + 1}/${LEVEL_ORDER.length}`, 'Level'], [st.label, 'Style']],
      move: lv === 'impossible' ? { kicker: 'Warning', name: 'Impossible', text: OPP_NOTE.impossible } : { kicker: 'Plays like', name: st.label, text: st.trait },
    },
  };
}
let walkingOn = false;

async function startMatch(mode: Mode = 'match') {
  if (walkingOn) return;
  // 4.0: a walk-on before a match against the CPU (not 2 players, practice or the tutorial).
  if (mode === 'match' && settings.opponent !== 'human') {
    walkingOn = true;
    closeDrawers();
    menu.classList.add('hidden');
    try { await showWalkOn(exhibitionWalkOn()); } finally { walkingOn = false; }
  }
  sound.init();
  voice.enabled = settings.voice;
  voice.unlock();
  // 4.4: exhibition boards say who you're playing; and a note for the admin analytics.
  renderer.boardLine = mode === 'match' && settings.opponent !== 'human' ? `vs CPU ${LEVEL_LABEL[settings.opponent as Level]}` : null;
  logEvent('start', mode, mode === 'match' && settings.opponent !== 'human' ? settings.opponent : null);
  const setup = defaultSetup(mode === 'match' ? 'cpu' : 'practice', settings.games, settings.points, myCharacter());
  game = new Game({ ...settings }, input, broadcast, mode, null, setup);
  game.onMatchOver = recordCareer;
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  closeDrawers();
  menu.classList.add('hidden');
  (document.activeElement as HTMLElement | null)?.blur();
}

/** 4.4: match starts, finishes and quits for the admin analytics (mode, CPU level, points played; nothing personal). */
function logEvent(kind: 'start' | 'finish' | 'quit', mode: string, level: string | null, g: Game | null = null) {
  const pts = g ? g.match.history.reduce((n, [a, b]) => n + a + b, 0) + g.match.scores[0] + g.match.scores[1] : 0;
  void loadAccount().then((m) => m.logGameEvent(kind, mode, level, pts, g?.stats.seconds ?? 0)).catch(() => {});
}
const levelOf = (g: Game) => (g.mode === 'match' && !g.online && g.settings.opponent !== 'human' ? g.settings.opponent : null);

function showMenu() {
  if (game && game.state !== 'matchOver' && (game.mode === 'match' || game.mode === 'online')) logEvent('quit', game.online ? 'online' : game.setup.mode, levelOf(game), game);
  renderer.boardLine = null;
  // Practice adds to your heatmap too (matches add theirs when they finish).
  if (game?.mode === 'practice') recordHeat(game);
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
    if (!g.peerAway) g.setOnlinePause(!g.pauseMine);
  }
  // Stuck waiting on a lost connection: Q always gets you out.
  if (g.peerAway && input.tapped(['KeyQ'])) { if (confirmLeave()) { leaveRoom(); showMenu(); } return; }
  if (g.pauseMine && input.tapped(['KeyQ'])) {
    if (!confirmLeave()) return;
    room?.send({ type: 'forfeit' });
    leaveRoom();
    showMenu();
    return;
  }
  // Ranked matches don't rematch: Enter looks for the next opponent.
  if (input.tapped(['Enter'])) { if (over) { if (g.online?.ranked) { leaveRoom(); showMenu(); startQuickMatch(); } else askRematch(); } else if (!g.paused) g.skip(); }
  if (input.tapped(UI_KEYS.challenge)) g.requestChallenge();
  if (input.tapped(UI_KEYS.replay)) g.toggleReplay();
  if (input.tapped(UI_KEYS.replayCamera)) g.toggleReplayCamera();
  if (input.tapped(UI_KEYS.replaySpeed)) g.cycleReplaySpeed();
  if (input.tapped(UI_KEYS.saveHighlight)) keepHighlight(g);
}

/** P after a point: save the end of that rally to Social → Highlights. */
function keepHighlight(g: Game) {
  const h = g.highlight();
  if (!h) return;
  const ok = saveHighlight(h);
  g.banner = ok
    ? { title: 'Saved to highlights', sub: `${h.title} · watch it in Social → Highlights`, color: '#ffd166', t: 0, ttl: 3 }
    : { title: 'Couldn’t save', sub: 'This browser has no room for highlights', color: '#ff6b6b', t: 0, ttl: 3 };
}

// ── Loop ─────────────────────────────────────────────────────────────────────

let last = performance.now();
let lastDraw = 0;
/** A saved highlight playing (from Social → Highlights), looping until Esc. */
let watching: { h: Highlight; pb: Playback; cam: ReplayCam; endT: number } | null = null;
function watchHighlight(h: Highlight) {
  closeSocial();
  menu.classList.add('hidden');
  watching = { h, pb: new Playback(h.frames, h.frames[0]?.t ?? 0, h.landedAt, false), cam: 'broadcast', endT: 0 };
}
function stopHighlight() {
  watching = null;
  menu.classList.remove('hidden');
  openSocial('highlights');
}
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  const w = innerWidth, h = innerHeight;

  if (game) {
    const over = game.state === 'matchOver';
    if (game.online) onlineKeys(game, over);
    else if (input.tapped(['Escape'])) {
      // 4.2.2: the career screens are open over a paused match: Esc closes them.
      if (careerUi.isOpen()) careerUi.close();
      else if (over && careerDone) endCareerMatch(false); else if (over || game.session) showMenu(); else game.paused = !game.paused;
    }
    // 4.2.2: C in a paused career match opens the career screens to look at (draw, ranking, money…).
    if (game && careerDone && game.paused && !over && !careerUi.isOpen() && input.tapped(['KeyC'])) void careerUi.open('hub', true);
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
      if (input.tapped(UI_KEYS.replaySpeed)) game.cycleReplaySpeed();
      if (input.tapped(UI_KEYS.saveHighlight)) keepHighlight(game);
    }
    if (game?.online) { /* handled in onlineKeys */ }
    else if (game?.paused && !game.session && game.state !== 'matchOver' && input.tapped(['KeyX'])) {
      // 3.12.14: forfeit: the match ends as a loss (in career, you're out of the event).
      if (careerDone) { if (confirm('Forfeit this match? It counts as a loss, and you’re out of the tournament.')) endCareerMatch(true); }
      else if (confirm('Forfeit this match? It counts as a loss.')) game.retire(0);
    }
    else if (game?.paused && input.tapped(['KeyQ'])) {
      if (!careerDone) showMenu();
      else if (careerLeave) leaveCareerMatch();
      else if (confirm('Retire from this match? It counts as a loss.')) endCareerMatch(true);
    }
    else if (game && input.tapped(['Enter'])) {
      if (game.state === 'matchOver' && careerDone) endCareerMatch(false);
      else if (game.state === 'matchOver') startMatch('match');
      else game.skip();
    }
    if (game?.session?.done) showMenu();
  } else if (!watching && input.tapped(['Enter']) && accountModal.classList.contains('hidden') && roomModal.classList.contains('hidden') && social.classList.contains('hidden') && controlsPick.classList.contains('hidden') && welcome.classList.contains('hidden') && !tour.isOpen && !careerUi.isOpen()) {
    startMatch('match');
  }

  if (game) {
    game.update(dt);
    for (const e of game.events) {
      if (e.type === 'say') voice.say(e.text, e.who, e.interrupt);
      else sound.play(e);
    }
    game.events.length = 0;
    sound.update(Math.min(dt, 0.05), game.state === 'challenge', game.cheer, game.state !== 'matchOver');
  } else sound.update(dt, false, 0, false);

  // Performance mode: draw at most 30 frames a second (the game itself still runs every frame).
  const skipDraw = settings.performance && now - lastDraw < 30;
  if (watching && !game) {
    const v = watching;
    if (input.tapped(['Escape'])) stopHighlight();
    else {
      if (input.tapped(UI_KEYS.replayCamera)) { const i = REPLAY_CAMS.findIndex((c) => c.id === v.cam); v.cam = REPLAY_CAMS[(i + 1) % REPLAY_CAMS.length].id; }
      if (input.tapped(UI_KEYS.replaySpeed)) { const S = REPLAY.speeds; v.pb.base = S[(S.indexOf(v.pb.base) + 1) % S.length]; }
      if (input.tapped(UI_KEYS.replay) || (v.pb.done && (v.endT += dt) > 1.5)) { v.pb.restart(); v.endT = 0; }
      v.pb.update(Math.min(dt, 0.05));
      if (!skipDraw) {
        lastDraw = now;
        const cam = replayCams[v.cam];
        renderer.draw(cam, null, { ...v.pb.frame(), live: false }, w, h, now / 1000, cam === side);
        hud.highlight(v.pb, v.h.title, REPLAY_CAMS.find((c) => c.id === v.cam)!.label, w, h, now / 1000);
      }
    }
  }
  else if (skipDraw) { /* keep the last frame on screen */ }
  else if (game?.state === 'challenge' && game.review) {
    lastDraw = now;
    drawReview(ctx, w, h, game.review, hawkCam);
  } else if (game) {
    const replaying = game.state === 'replay' && game.playback;
    const scene: Scene = replaying
      ? { ...game.playback!.frame(), live: false }
      : { players: game.players, shuttle: game.shuttleView, live: true };
    const cam = replaying ? replayCams[game.replayCam] : broadcast;
    lastDraw = now;
    renderer.draw(cam, game, scene, w, h, now / 1000, cam === side);
    hud.draw(game, w, h, now / 1000);
  } else {
    lastDraw = now;
    renderer.draw(broadcast, null, null, w, h, now / 1000);
  }
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Players online (2.7) ─────────────────────────────────────────────────────
/** A random id for this guest tab, so a guest counts once however often the socket reconnects. */
function guestPresenceKey(): string {
  try {
    let k = sessionStorage.getItem('badminton.presenceKey');
    if (!k) { k = 'g_' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem('badminton.presenceKey', k); }
    return k;
  } catch { return 'g_' + Math.random().toString(36).slice(2, 12); }
}
const presence = new PresenceLink(
  () => (account ? account.id : guestPresenceKey()),
  () => (queue ? 'queue' : game?.online ? 'match' : room ? 'room' : 'menu'),
);
const onlineBtn = document.getElementById('onlineBtn')!, onlinePanel = document.getElementById('onlinePanel')!;
let onlineTimer = 0;
function showCounts(c: PresenceCounts | null) {
  document.getElementById('onlineCount')!.textContent = c ? String(c.online) : '--';
  onlineBtn.classList.toggle('off', !c);
  const q = document.getElementById('queueOnline');
  if (q) q.textContent = c ? (c.online <= 1 ? 'You’re the only one online right now.' : `${c.online} online · ${c.inQueue} looking for a match`) : '';
  if (onlinePanel.hidden) return;
  if (!c) { onlinePanel.innerHTML = '<b>--</b><p>Can’t reach the game server right now.</p>'; return; }
  onlinePanel.innerHTML = `<b>${c.online}</b><ul>
    <li><span>Playing a match</span><span>${c.inMatch}</span></li>
    <li><span>Looking for a quick match</span><span>${c.inQueue}</span></li>
    <li><span>In a friend’s room</span><span>${c.inRoom}</span></li>
    <li><span>On the menu</span><span>${Math.max(0, c.online - c.inMatch - c.inQueue - c.inRoom)}</span></li></ul>
    <p>${c.online <= 1 ? 'You’re the only one online right now. Make a room under Play online and send a friend the code.' : 'Quick match pairs you with someone near your rating.'}</p>`;
}
presence.onCounts(showCounts);
onlineBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  onlinePanel.hidden = !onlinePanel.hidden;
  onlineBtn.setAttribute('aria-expanded', String(!onlinePanel.hidden));
  clearInterval(onlineTimer);
  if (!onlinePanel.hidden) { showCounts(presence.counts); presence.ask(); onlineTimer = window.setInterval(() => presence.ask(), 15_000); }
});
document.addEventListener('click', (e) => {
  if (!onlinePanel.hidden && !onlinePanel.contains(e.target as Node)) { onlinePanel.hidden = true; onlineBtn.setAttribute('aria-expanded', 'false'); clearInterval(onlineTimer); }
});
/** Tell the presence server what you're doing now (safe to call before it's set up). */
function presenceNow(ask = false) { try { presence.beat(); if (ask) presence.ask(); } catch { /* not ready yet */ } }
// One count on load, so the button isn't blank.
window.setTimeout(() => presence.ask(), 1500);

// ── Career mode and the daily challenge (3.0) ────────────────────────────────
/** A career or daily-challenge match is on: what to do with the result. */
let careerDone: ((g: Game, retired: boolean) => void) | null = null;
/** A career match (not the daily challenge): Q while paused saves the score and leaves. */
let careerLeave: (() => void) | null = null;
/** Development only: a pretend account for trying career screens (see careermode/devfake.ts). */
let devFake: typeof import('./careermode/devfake') | null = null;
if (import.meta.env.DEV) void import('./careermode/devfake').then((m) => { devFake = m; });
const careerUi = initCareer({
  appVersion: CHANGELOG[0].version,
  account: () => account ?? (import.meta.env.DEV && devFake?.fakeOn() ? devFake.fakeAccount : null),
  loadAccount: async () => (import.meta.env.DEV && !account && devFake?.fakeOn() ? ({ ...(await loadAccount()), ...devFake.fakeModule() } as Awaited<ReturnType<typeof loadAccount>>) : loadAccount()),
  owned: async () => { if (import.meta.env.DEV && !account && devFake?.fakeOn()) return devFake.fakeOwned(); await refreshOwned(); return ownedIds; },
  play: async (o) => {
    if (o.walkOn) {
      if (walkingOn) return;
      walkingOn = true;
      closeDrawers();
      menu.classList.add('hidden');
      try { await showWalkOn(o.walkOn); } finally { walkingOn = false; }
    }
    sound.init();
    voice.enabled = settings.voice;
    voice.unlock();
    careerDone = o.onDone;
    careerLeave = o.onLeave ?? null;
    renderer.boardLine = null;
    logEvent('start', o.setup.mode, null);
    renderer.eventTitle = o.setup.label?.split(' · ')[0] ?? null;
    renderer.courtTheme = (o.setup.look && COURT_THEMES[o.setup.look.court]) || null;
    renderer.look = o.setup.look ?? DEFAULT_LOOK;
    game = new Game({ ...settings, ...o.settings }, input, broadcast, 'match', null, o.setup);
    game.onMatchOver = recordCareer;
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
    closeDrawers();
    menu.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
  },
  toast,
  openAccount,
  saveStats: (delta) => saveCareer(delta),
  esc: hubEsc,
});
function leaveCareerMatch() {
  const leave = careerLeave;
  careerDone = careerLeave = null;
  renderer.eventTitle = null;
  renderer.courtTheme = null;
  renderer.look = DEFAULT_LOOK;
  showMenu();
  leave?.();
}
function endCareerMatch(retired: boolean) {
  const g = game!, done = careerDone;
  careerDone = careerLeave = null;
  renderer.eventTitle = null;
  renderer.courtTheme = null;
  renderer.look = DEFAULT_LOOK;
  showMenu();
  done?.(g, retired);
}
if (import.meta.env.DEV) (window as unknown as { endCareerMatch: typeof endCareerMatch }).endCareerMatch = endCareerMatch;
document.getElementById('careerOpen')!.addEventListener('click', () => void careerUi.open('hub'));
document.getElementById('dailyOpen')!.addEventListener('click', () => void careerUi.open('daily'));

// ── Problem log (3.0.2): errors and freezes, kept on this computer ───────────
// ── 4.4: feedback and bug reports ──
const fbModal = document.getElementById('feedbackModal')!, fbText = document.getElementById('fbText') as HTMLTextAreaElement;
const fbLog = document.getElementById('fbLog') as HTMLInputElement, fbMsg = document.getElementById('fbMsg')!;
let fbKind: 'idea' | 'bug' | 'other' = 'idea';
function openFeedback(kind: 'idea' | 'bug' | 'other' = 'idea') {
  fbKind = kind;
  document.querySelectorAll<HTMLButtonElement>('#fbKind button').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
  fbLog.checked = kind === 'bug';
  fbMsg.textContent = '';
  fbModal.classList.remove('hidden');
  fbText.focus();
}
document.getElementById('feedbackBtn')!.addEventListener('click', () => openFeedback());
document.getElementById('fbKind')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-kind]');
  if (!b) return;
  fbKind = b.dataset.kind as typeof fbKind;
  document.querySelectorAll<HTMLButtonElement>('#fbKind button').forEach((x) => x.classList.toggle('on', x === b));
  if (fbKind === 'bug') fbLog.checked = true;
});
document.getElementById('fbCancel')!.addEventListener('click', () => fbModal.classList.add('hidden'));
fbModal.addEventListener('click', (e) => { if (e.target === fbModal) fbModal.classList.add('hidden'); });
document.getElementById('fbSend')!.addEventListener('click', async () => {
  const text = fbText.value.trim();
  if (!text) { fbMsg.textContent = 'Write something first.'; return; }
  fbMsg.textContent = 'Sending…';
  const m = await loadAccount();
  const ok = await m.sendFeedback(fbKind, text, fbLog.checked ? logText() : null, GAME_VERSION, `${location.pathname} · ${innerWidth}×${innerHeight} · ${navigator.userAgent.slice(0, 120)}`);
  if (ok) { fbText.value = ''; fbModal.classList.add('hidden'); toast('Thanks!', 'Your feedback was sent.'); }
  else fbMsg.textContent = 'Couldn’t send it. Try again in a minute.';
});

// ── 4.4: the ? shortcut list ──
const shortcuts = document.getElementById('shortcuts')!;
function showShortcuts() {
  const k = (c: string) => `<kbd>${hubEsc(c)}</kbd>`;
  const rows: [string, string][] = settings.p1Control === 'mouse'
    ? [['Move', k('W') + k('A') + k('S') + k('D')], ['Drive / smash', 'Left click (tap / hold)'], ['Drop / lob', 'Right click (tap / hold)'], ['Net kill', k('E')], ['Jump', k('Space')]]
    : [['Move', k('W') + k('A') + k('S') + k('D')], ['Lift (tap fast, hold high)', k('J')], ['Fast (hold for extra power)', k('K')], ['Soft', k('L')], ['Aim', k('U') + ' / ' + k('O')], ['Jump', k('Space')]];
  rows.push(['Pause', k('Esc')], ['Challenge a line call', k('H')], ['Replay the last rally', k('R')], ['Landing marker on/off', k('G')], ['Fullscreen', k('F')], ['Mute', k('M')],
    ['Quick chat (online)', k('1') + '–' + k('6')], ['Your career (paused career match)', k('C')], ['Start the match (home page)', k('Enter')], ['This list', k('?')]);
  document.getElementById('shortcutList')!.innerHTML = `<table class="sc-table">${rows.map(([a, b]) => `<tr><td>${hubEsc(a)}</td><td>${b}</td></tr>`).join('')}</table><p class="sub">Your own keys may differ if you changed them (Assists &amp; controls → Controls).</p>`;
  shortcuts.classList.remove('hidden');
}
window.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
  if (typing) return;
  if (e.key === '?') { e.preventDefault(); if (shortcuts.classList.contains('hidden')) showShortcuts(); else shortcuts.classList.add('hidden'); }
  else if (e.key === 'Escape' && !shortcuts.classList.contains('hidden')) shortcuts.classList.add('hidden');
});
shortcuts.addEventListener('click', (e) => { if (e.target === shortcuts) shortcuts.classList.add('hidden'); });

// ── 4.4: search and reset in the settings drawers ──
document.querySelectorAll<HTMLInputElement>('.mc-search').forEach((inp) => inp.addEventListener('input', () => {
  const drawer = inp.closest('.matchcard')!, q = inp.value.trim().toLowerCase();
  drawer.classList.toggle('searching', !!q);
  drawer.querySelectorAll<HTMLElement>('.field').forEach((f) => { f.classList.toggle('no-match', !!q && !f.textContent!.toLowerCase().includes(q)); });
}));
const RESET_KEYS: Record<string, (keyof Settings)[]> = {
  card: ['event', 'opponent', 'style', 'partnerStyle', 'games', 'points', 'aim'],
  kit: ['guides', 'timingLight', 'swingAssist', 'voice', 'hideChat', 'autoSwitch', 'performance'],
};
document.querySelectorAll<HTMLButtonElement>('.mc-reset').forEach((b) => b.addEventListener('click', () => {
  if (!confirm('Put these settings back to how they start?')) return;
  for (const key of RESET_KEYS[b.dataset.reset!] ?? []) (settings as unknown as Record<string, unknown>)[key] = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
  saveSettings(); syncMenu(); describeControls(); describeFormat(); resize();
  toast('Settings reset', 'Back to the defaults.');
}));

const errlogBtn = document.getElementById('errlogBtn')!;
const syncErrlog = () => { const n = readLog().length; errlogBtn.hidden = n === 0; errlogBtn.textContent = `Problem log (${n})`; };
installErrorLog(CHANGELOG[0].version, syncErrlog);
syncErrlog();
errlogBtn.addEventListener('click', async () => {
  const text = logText();
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* clipboard blocked */ }
  if (confirm(`${copied ? 'Copied to the clipboard: paste it into a message to us.' : 'Copy this and send it to us:'}\n\n${text.slice(0, 1500)}\n\nClear the log now?`)) { clearLog(); syncErrlog(); }
});
