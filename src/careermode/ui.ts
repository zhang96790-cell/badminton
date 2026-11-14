// Career mode screens: hub, events, bracket, ranking, squad, ledger, recruiting, season recap and the daily
// challenge. Plain HTML inside the #career panel (same look as Social). Matches are played by main.ts.
import { DEFAULT_CHARACTER, RARITY, characterById, rosterFor, type Character } from '../../shared/characters';
import type { Game } from '../game';
import type { Settings } from '../game';
import type { Style } from '../config';
import type { MatchSetup } from '../setup';
import { CAREER_CFG as CFG, ROUND_LABEL, TIER_LABEL, type Difficulty, type Round } from './config';
import { CareerSaves, type Conflict } from './save';
import {
  advanceWeek, canEnter, clubEvent, currentPlan, energyModifier, energyPenalty, enter, eventThisWeek, findEvent, money, myRank, newCareer,
  nextMatch, payFor, prizeFor, purseOf, recordMatch, refuel, roundEnergy, softLocked, travelCost, travelEnergy, withdraw, world, type CareerState,
} from './state';
import { COUNTRIES, YOU, absWeek, pointsFor, countryName, hash, rng, roundsFor, travelBand, type TourEvent, type World } from './world';
import { SIGNATURES } from './signatures';
import { setWhere } from '../errorlog';

type Account = typeof import('../account');
export interface CareerDeps {
  appVersion: string;
  account: () => { id: string; username: string } | null;
  loadAccount: () => Promise<Account>;
  /** Owned players (refreshed from the account). */
  owned: () => Promise<Set<string>>;
  /** Play a match, then call onDone with the finished (or retired) game. */
  play: (o: { setup: MatchSetup; settings: Partial<Settings>; onDone: (g: Game, retired: boolean) => void }) => void;
  toast: (title: string, sub: string) => void;
  openAccount: (why: string) => void;
  saveStats: (delta: Record<string, number>) => void;
  esc: (s: string) => string;
}

const STYLE_AI: Record<string, Style> = { 'all-rounder': 'allround', attacker: 'attacker', defender: 'defender', 'net player': 'net', deceptive: 'deceptive', 'fast retriever': 'retriever', 'defensive wall': 'wall' };
const HANDICAP_TEXT: Record<string, string> = { no_smash: 'No smashes (hard overheads become drives)', no_drop: 'No drop shots (soft overheads become clears)', fast_opponent: 'Your opponent moves 10% faster', start_behind: 'You start {n} points down', to_11: 'A single game to 11', half_energy: 'You play at 50% energy' };

export function initCareer(d: CareerDeps) {
  const $ = (id: string) => document.getElementById(id)!;
  const panel = $('career'), body = $('careerBody'), head = $('careerHead');
  const e = d.esc;
  let saves: CareerSaves | null = null;
  let s: CareerState | null = null;
  let w: World | null = null;
  let tab = 'hub';
  let busy = false;
  const released = rosterFor(d.appVersion);

  const W = () => (w ??= world(s!, d.appVersion));
  const fresh = () => { w = null; };
  const ev = () => (s?.current ? findEvent(s, s.current.eventId, d.appVersion) : null);
  const card = (c: Character, extra = '') => `<span class="ccard" style="--rar:${RARITY[c.rarity].color}"><span class="rar">${RARITY[c.rarity].label}</span> <b>${e(c.name)}</b> <span class="sub">${e(c.country)} · ${e(c.style)}</span>${extra}</span>`;

  async function save(): Promise<void> {
    if (!s || !saves) return;
    fresh();
    const r = await saves.save(s);
    if (r === 'offline') d.toast('Saved on this computer', 'Your career will be sent to your account when the connection is back.');
    else if (r !== 'ok') await settleConflict(r);
  }

  async function settleConflict(c: Conflict) {
    const sum = (x: CareerState) => `${x.year}, week ${x.week} · ${money(x.money)} · ${x.titles} title${x.titles === 1 ? '' : 's'}`;
    body.innerHTML = `<div class="c-card warn"><h3>This career was changed on another device</h3>
      <p>Which copy do you want to keep? The other one is replaced.</p>
      <div class="c-actions"><button class="primary" data-keep="mine">This device: ${e(sum(c.mine))}</button>
      <button data-keep="theirs">Other device: ${e(sum(c.theirs))}</button></div></div>`;
    await new Promise<void>((done) => {
      body.addEventListener('click', async function h(ev2) {
        const k = (ev2.target as HTMLElement).closest<HTMLElement>('[data-keep]')?.dataset.keep;
        if (!k) return;
        body.removeEventListener('click', h);
        if (k === 'mine') { s = c.mine; await saves!.overwrite(c.mine); } else { s = c.theirs; saves!.adopt(c.theirs, c.theirRev); }
        fresh(); done();
      });
    });
    render();
  }

  // ── Opening ──
  async function open(startTab = 'hub') {
    panel.classList.remove('hidden');
    tab = startTab;
    const acc = d.account();
    if (!acc) {
      head.innerHTML = '<p class="hero-kicker">Career</p><h2>Career mode</h2>';
      body.innerHTML = `<div class="c-card"><h3>Sign in to save a career</h3><p>Your career is saved to your account, so you can carry on from any computer. The daily challenge also needs an account.</p>
        <div class="c-actions"><button class="primary" data-login>Log in or sign up</button></div></div>`;
      return;
    }
    body.innerHTML = '<p class="sub">Loading your career…</p>';
    const m = await d.loadAccount();
    saves = new CareerSaves(m, acc.id);
    const l = await saves.load();
    s = l.state;
    fresh();
    if (l.offline && !s) {
      head.innerHTML = '<p class="hero-kicker">Career</p><h2>Career mode</h2>';
      body.innerHTML = '<div class="c-card"><h3>Can’t reach your career right now</h3><p>Check your connection and try again.</p><div class="c-actions"><button class="primary" data-retry>Try again</button></div></div>';
      return;
    }
    if (l.offline) d.toast('Offline', 'Showing the copy saved on this computer.');
    if (l.conflict) { await settleConflict(l.conflict); return; }
    render();
  }
  const close = () => { panel.classList.add('hidden'); setWhere(''); };

  // ── Rendering ──
  function render() {
    setWhere(`career: ${!s ? 'new career' : s.current ? 'tournament' : tab}`);
    if (!s) { renderNew(); return; }
    if (s.recap !== null) { renderRecap(); return; }
    const r = myRank(s, W());
    const pen = energyPenalty(s.energy);
    head.innerHTML = `<p class="hero-kicker">Career · ${s.year}, week ${s.week} · ${e(countryName(s.currentLocation))}</p><h2>${e(s.name)}</h2>
      <div class="c-stats"><div><b>${money(s.money)}</b><span>Money</span></div><div><b class="${pen ? 'low' : ''}">${s.energy}</b><span>Energy</span></div>
      <div><b>${r ?? '–'}</b><span>World ranking</span></div><div><b>${s.titles}</b><span>Titles</span></div></div>`;
    const tabs = [['hub', 'This week'], ['events', 'Events'], ['ranking', 'Ranking'], ['squad', 'Squad'], ['ledger', 'Money'], ['daily', 'Daily challenge'], ['settings', 'Settings']];
    $('careerTabs').innerHTML = tabs.map(([k, l]) => `<button role="tab" data-ctab="${k}" aria-selected="${k === tab}">${l}</button>`).join('');
    if (s.pendingRecruitOffer || s.offerDue) { void renderOffer(); return; }
    if (s.current) { renderTournament(); return; }
    ({ hub: renderHub, events: renderEvents, ranking: renderRanking, squad: renderSquad, ledger: renderLedger, daily: renderDaily, settings: renderSettings } as Record<string, () => void>)[tab]?.();
  }

  function eventLine(x: TourEvent, showEnter: boolean) {
    const c = canEnter(s!, x, W());
    const band = travelBand(s!.currentLocation, x.host_country);
    return `<div class="c-event"><div><b>${e(x.name)}</b> <span class="tier">${TIER_LABEL[x.tier]}</span><p class="sub">Week ${x.week} · ${e(x.city ? `${x.city}, ` : '')}${e(countryName(x.host_country))} · purse ${money(purseOf(x))} · ${band} travel ${money(travelCost(s!, x))}</p>
      ${c.ok ? '' : `<p class="sub why">${e(c.why ?? '')}</p>`}</div>${showEnter ? `<button class="${c.ok ? 'primary' : ''}" data-detail="${x.id}" ${c.ok ? '' : 'disabled'}>Details</button>` : ''}</div>`;
  }

  function renderHub() {
    const x = eventThisWeek(s!, d.appVersion);
    const upcoming = W().cal.filter((v) => v.week > s!.week).slice(0, 3);
    const locked = softLocked(s!, W());
    const me = characterById(s!.characterId);
    body.innerHTML = `
      <div class="c-card"><h3>This week</h3>${x ? eventLine(x, true) : '<p>No tournament this week.</p>'}
        ${locked ? `<div class="c-event club"><div><b>Local Club Open</b> <span class="tier">Free</span><p class="sub">You can’t afford any events right now. This one’s free, close by, with a small prize and little energy use.</p></div><button class="primary" data-club>Play it</button></div>` : ''}
        <div class="c-actions"><button data-week="next">Next week (+${CFG.idleWeekEnergy} energy)</button><button data-week="rest">Rest week (+${CFG.rest.energy} energy, ${money(CFG.rest.cost)})</button>
        <button data-skip>Skip to the next event</button></div>
        <div class="c-actions"><button data-refuel="food">Good food: +${CFG.food.energy} energy, ${money(CFG.food.cost)}</button><button data-refuel="physio">Physio: +${CFG.physio.energy} energy, ${money(CFG.physio.cost)}</button></div>
        ${energyPenalty(s!.energy) ? `<p class="sub why">Below ${CFG.energyPenaltyFrom} energy you’re a little slower and your timing is a little harder (${Math.round(energyPenalty(s!.energy) * 100)}% right now). Rest or refuel before a big event.</p>` : ''}
      </div>
      <div class="c-card"><h3>Playing as</h3>${card(me)} <button class="linkish" data-ctab="squad">Change</button></div>
      <div class="c-card"><h3>Coming up</h3>${upcoming.length ? upcoming.map((v) => eventLine(v, false)).join('') : '<p>That’s the last event of the season.</p>'}</div>`;
  }

  function renderEvents() {
    body.innerHTML = `<div class="c-card"><h3>${s!.year} season</h3>${W().cal.map((v) => {
      const h = s!.history.find((x) => x.year === s!.year && x.tournamentId === v.id);
      return `<div class="c-event${v.week < s!.week ? ' past' : ''}"><div><b>${e(v.name)}</b> <span class="tier">${TIER_LABEL[v.tier]}</span><p class="sub">Week ${v.week} · ${e(countryName(v.host_country))} · purse ${money(purseOf(v))}${h ? ` · you: ${ROUND_LABEL[h.round]}` : ''}</p></div></div>`;
    }).join('')}</div>`;
  }

  function renderDetail(id: string) {
    const x = findEvent(s!, id, d.appVersion);
    if (!x) return;
    const plan = W().plan(x, s!.year, null);
    const byRarity = new Map<string, number>();
    for (const p of plan.slots) { const c = characterById(p); byRarity.set(c.rarity, (byRarity.get(c.rarity) ?? 0) + 1); }
    const rounds = roundsFor(x.draw_size);
    const energyAll = Math.round(travelEnergy(s!, x) + roundEnergy(s!, x) * rounds.length);
    const c = canEnter(s!, x, W());
    body.innerHTML = `<div class="c-card"><h3>${e(x.name)} <span class="tier">${TIER_LABEL[x.tier]}</span></h3>
      <p>${e(x.city ? `${x.city}, ` : '')}${e(countryName(x.host_country))} · week ${x.week} · ${x.draw_size} players</p>
      <table class="c-table"><tr><th>Round you reach</th><th>Prize</th><th>Ranking points</th></tr>${[...rounds, 'W' as Round].map((r) => `<tr><td>${ROUND_LABEL[r === 'R16' ? 'R16' : r]}${r === 'W' ? '' : ' (lose there)'}</td><td>${money(prizeFor(x, r))}</td><td>${pointsFor(x.tier, r, x.draw_size)}</td></tr>`).join('')}</table>
      <p><b>Costs:</b> travel ${money(travelCost(s!, x, false))} economy or ${money(travelCost(s!, x, true))} business (paid now), hotel ${money(CFG.hotelPerRound)} per round you play.</p>
      <p><b>Energy:</b> about ${Math.round(travelEnergy(s!, x, false))} for travel (${Math.round(travelEnergy(s!, x, true))} in business) and ${Math.round(roundEnergy(s!, x))} per round: about ${energyAll} if you win it. You have ${s!.energy}.</p>
      <p><b>The field:</b> ${[...byRarity].map(([r, n]) => `${n} ${RARITY[r as Character['rarity']].label}`).join(', ')}.</p>
      <label class="c-check"><input type="checkbox" id="cBusiness" ${s!.settings.business ? 'checked' : ''}/> Fly business class (costs more, saves energy)</label>
      <div class="c-actions"><button class="primary" data-enter="${x.id}" ${c.ok ? '' : 'disabled'}>Enter (${money(travelCost(s!, x) + CFG.hotelPerRound)} to start)</button><button data-ctab="hub">Back</button></div>
      ${c.ok ? '' : `<p class="sub why">${e(c.why ?? '')}</p>`}</div>`;
  }

  function renderTournament() {
    const x = ev()!;
    const a = s!.current!;
    const plan = currentPlan(s!, W(), x);
    const nm = nextMatch(s!, W(), x);
    const name = (id: string) => (id === YOU ? `<b>${e(s!.name)}</b>` : id === 'bye' ? 'bye' : e(characterById(id).name));
    const results = a.scores.map((g, i) => `<li>${ROUND_LABEL[roundsFor(x.draw_size)[i]]}: beat ${e(characterById(a.opponents[i]).name)} ${g.map(([m, t]) => `${m}–${t}`).join(', ')}</li>`).join('');
    const opp = nm?.opponent;
    body.innerHTML = `<div class="c-card"><h3>${e(x.name)} · ${ROUND_LABEL[a.round]}</h3>
      ${results ? `<ul class="c-list">${results}</ul>` : ''}
      ${opp ? `<p>Next: ${card(opp, opp.abilities.length ? ` <span class="sub">${opp.abilities.map((ab) => `★ ${e(ab.name)}`).join(' ')}</span>` : '')}</p>
        <p class="sub">${nm!.games === 1 ? 'A single game to 15 (faster early rounds)' : 'Best of 3 games to 21'} · your energy ${s!.energy}${energyPenalty(s!.energy) ? ` (−${Math.round(energyPenalty(s!.energy) * 100)}% speed and timing this match)` : ''}</p>
        <div class="c-actions"><button class="primary" data-playnext>Play the ${ROUND_LABEL[a.round].toLowerCase()}</button><button data-refuel="food">Food +${CFG.food.energy} (${money(CFG.food.cost)})</button><button data-refuel="physio">Physio +${CFG.physio.energy} (${money(CFG.physio.cost)})</button><button data-withdraw>Withdraw</button></div>` : ''}
      <details class="c-bracket"><summary>Draw</summary><ol>${plan.slots.map((id, i) => `<li${plan.seeds.includes(id) ? ' class="seed"' : ''}>${i % 2 ? '' : ''}${name(id)}${plan.seeds.includes(id) ? ` <span class="sub">[${plan.seeds.indexOf(id) + 1}]</span>` : ''}</li>`).join('')}</ol></details></div>`;
  }

  function renderRanking() {
    const at = absWeek(s!.year, s!.week);
    const now = W().rankingAt(at), before = W().rankingAt(at - 1);
    const prevPos = new Map(before.map((x, i) => [x.id, i + 1]));
    const myI = now.findIndex((x) => x.id === YOU);
    const row = (x: { id: string; pts: number }, i: number) => {
      const was = prevPos.get(x.id), move = was && x.pts > 0 ? was - (i + 1) : 0;
      const c = x.id === YOU ? null : characterById(x.id);
      return `<tr class="${x.id === YOU ? 'me' : ''}"><td>${i + 1}</td><td>${x.id === YOU ? e(s!.name) : e(c!.name)}</td><td>${x.id === YOU ? e(s!.homeCountry) : e(c!.country)}</td><td>${x.pts.toLocaleString('en-US')}</td><td class="${move > 0 ? 'up' : move < 0 ? 'down' : ''}">${move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '–'}</td></tr>`;
    };
    const mine = W().results.get(YOU)?.filter((x) => x.at > at - 52 && x.at <= at).sort((a, b) => b.pts - a.pts) ?? [];
    body.innerHTML = `<div class="c-card"><h3>World ranking</h3><p class="sub">Your best ${CFG.bestOf} results in the last 52 weeks count. ${myI >= 0 && now[myI].pts > 0 ? `You’re <b>${myI + 1}</b>.` : 'Play an event to get a ranking.'}</p>
      ${mine.length ? `<p class="sub">Your points: ${mine.map((x, i) => `${i < CFG.bestOf ? '' : '<s>'}${findEvent(s!, x.ev, d.appVersion)?.name ?? 'Club Open'} ${x.pts}${i < CFG.bestOf ? '' : '</s>'}`).join(' · ')}</p>` : ''}
      <table class="c-table rank"><tr><th>#</th><th>Player</th><th>Country</th><th>Points</th><th>Since last week</th></tr>${now.slice(0, 100).map(row).join('')}${myI >= 100 && now[myI].pts > 0 ? row(now[myI], myI) : ''}</table></div>`;
  }

  async function renderSquad() {
    const owned = await d.owned();
    const mine = released.filter((c) => (owned.has(c.id) || s!.squad.includes(c.id)) && c.id !== DEFAULT_CHARACTER);
    body.innerHTML = `<div class="c-card"><h3>Your squad</h3><p class="sub">Players you own. Choose who plays your next tournament. Recruits from career also play in ranked and friend matches (with their ranked stats).</p>
      <div class="c-squad">${mine.map((c) => `<button class="${c.id === s!.characterId ? 'on' : ''}" data-pick="${c.id}" ${s!.current ? 'disabled' : ''}>${card(c, `<span class="sub">career strength ${c.career_strength}${c.abilities.length ? ` · ${c.abilities.map((ab) => `★ ${e(ab.name)}`).join(', ')}` : ''}</span>`)}</button>`).join('') || '<p>No players yet.</p>'}</div></div>`;
  }

  function renderLedger() {
    const year = s!.ledger.filter((l) => l.year === s!.year);
    const inc = year.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0), out = year.filter((l) => l.amount < 0).reduce((t, l) => t + l.amount, 0);
    body.innerHTML = `<div class="c-card"><h3>Money</h3><p>${s!.year} so far: income ${money(inc)}, costs ${money(-out)}, net ${money(inc + out)}.</p>
      <table class="c-table"><tr><th>Week</th><th>What</th><th>Amount</th></tr>${s!.ledger.slice(-60).reverse().map((l) => `<tr><td>${l.year} w${l.week}</td><td>${e(l.label)}</td><td class="${l.amount >= 0 ? 'up' : 'down'}">${money(l.amount)}</td></tr>`).join('')}</table></div>`;
  }

  function renderSettings() {
    const order: Difficulty[] = ['relaxed', 'normal', 'hard'];
    body.innerHTML = `<div class="c-card"><h3>Settings</h3>
      <label class="c-check"><input type="checkbox" id="cFaster" ${s!.settings.fasterEarlyRounds ? 'checked' : ''}/> Faster early rounds: rounds before the quarter-finals are a single game to 15</label>
      <p><b>Difficulty:</b> ${s!.difficulty[0].toUpperCase() + s!.difficulty.slice(1)}. You can make it harder, but not easier.</p>
      <div class="c-actions">${order.filter((x) => order.indexOf(x) > order.indexOf(s!.difficulty)).map((x) => `<button data-diff="${x}">Switch to ${x}</button>`).join('')}</div>
      <h3>Start again</h3><p class="sub">Restarting replaces this career. Players you recruited stay on your account.</p><div class="c-actions"><button data-restart>Restart career</button></div></div>`;
  }

  // ── New career ──
  function renderNew() {
    const acc = d.account()!;
    head.innerHTML = '<p class="hero-kicker">Career</p><h2>Start your career</h2>';
    $('careerTabs').innerHTML = '';
    const countries = [...new Set(released.map((c) => c.country))].filter((c) => COUNTRIES[c]).sort((a, b) => countryName(a).localeCompare(countryName(b)));
    body.innerHTML = `<div class="c-card" role="group" aria-label="New career" data-form-type="other"><label class="c-field">Your name <input id="cName" name="skyline-career-player" type="text" maxlength="24" spellcheck="false" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" value="${e(acc.username.replace(/_/g, ' '))}"/></label>
      <label class="c-field">Home country <select id="cHome" name="skyline-career-base" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other">${countries.map((c) => `<option value="${c}">${e(countryName(c))}</option>`).join('')}</select></label>
      <label class="c-field">Difficulty <select id="cDiff" name="skyline-career-difficulty" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other"><option value="relaxed">Relaxed: opponents play at their usual level</option><option value="normal">Normal: every opponent one level harder</option><option value="hard">Hard: two levels harder</option></select></label>
      <p class="sub">You can make it harder later, but not easier.</p>
      <h3>Choose your player</h3><p class="sub">A free Common player from your country (they join your account), or one you already own.</p>
      <div id="cStarters" class="c-squad"></div>
      <div class="c-actions"><button class="primary" id="cBegin" disabled>Start career</button></div></div>`;
    void fillStarters();
  }
  let starter: { id: string; free: boolean } | null = null;
  async function fillStarters() {
    const home = ($('cHome') as HTMLSelectElement).value;
    const owned = await d.owned();
    const commons = released.filter((c) => c.rarity === 'common' && c.id !== DEFAULT_CHARACTER);
    const region = COUNTRIES[home]?.region;
    let pool = commons.filter((c) => c.country === home);
    if (pool.length < 3) pool = pool.concat(commons.filter((c) => c.country !== home && COUNTRIES[c.country]?.region === region));
    if (pool.length < 3) pool = commons;
    const r = rng(hash(d.account()!.id, home));
    const picks = [...pool].sort(() => r() - 0.5).slice(0, 3);
    const mine = released.filter((c) => owned.has(c.id) && c.id !== DEFAULT_CHARACTER);
    starter = null;
    ($('cBegin') as HTMLButtonElement).disabled = true;
    $('cStarters').innerHTML = picks.map((c) => `<button data-starter="${c.id}" data-free="1">${card(c, '<span class="sub">free</span>')}</button>`).join('')
      + mine.map((c) => `<button data-starter="${c.id}">${card(c, '<span class="sub">owned</span>')}</button>`).join('');
  }

  async function begin() {
    if (!starter || busy) return;
    busy = true;
    try {
      const m = await d.loadAccount();
      if (starter.free) {
        const got = await m.careerStarter(starter.id);
        const owned = await d.owned();
        if (!got && !owned.has(starter.id)) { d.toast('Free player already used', 'Each account gets one free career player. Pick one you own.'); return; }
      }
      s = newCareer({ name: ($('cName') as HTMLInputElement).value.trim() || 'Player', homeCountry: ($('cHome') as HTMLSelectElement).value, characterId: starter.id, difficulty: ($('cDiff') as HTMLSelectElement).value as Difficulty });
      const prevRev = saves!.rev;
      saves!.rev = prevRev; // a restart replaces the old save from the same revision
      await save();
      tab = 'hub';
      render();
    } finally { busy = false; }
  }

  // ── Recap ──
  function renderRecap() {
    const y = s!.recap!;
    const hs = s!.history.filter((h) => h.year === y);
    const inc = s!.ledger.filter((l) => l.year === y && l.amount > 0).reduce((t, l) => t + l.amount, 0);
    const out = s!.ledger.filter((l) => l.year === y && l.amount < 0).reduce((t, l) => t + l.amount, 0);
    const endRank = myRank(s!, W(), absWeek(y, 52));
    head.innerHTML = `<p class="hero-kicker">Career</p><h2>${y} season</h2>`;
    body.innerHTML = `<div class="c-card"><h3>Your season</h3>
      <p>${hs.length} event${hs.length === 1 ? '' : 's'} · ${hs.filter((h) => h.round === 'W').length} title${hs.filter((h) => h.round === 'W').length === 1 ? '' : 's'} · finished ${endRank ? `ranked ${endRank}` : 'unranked'}</p>
      <p>Income ${money(inc)} · costs ${money(-out)} · net ${money(inc + out)}</p>
      <ul class="c-list">${hs.map((h) => `<li>${e(findEvent(s!, h.tournamentId, d.appVersion)?.name ?? 'Local Club Open')}: ${ROUND_LABEL[h.round]} (${h.points} points, ${money(h.prize)})</li>`).join('') || '<li>No events this season.</li>'}</ul>
      <div class="c-actions"><button class="primary" data-recapdone>On to ${y + 1}</button></div></div>`;
  }

  // ── Recruiting ──
  async function renderOffer() {
    const m = await d.loadAccount();
    if (s!.offerDue && !s!.pendingRecruitOffer) {
      const due = s!.offerDue;
      const o = await m.offerCreate(due.tournamentId, due.tier, due.field);
      if (!o) { body.innerHTML = '<div class="c-card"><p>Couldn’t reach the server to make your recruit offer. It’ll be waiting next time.</p><div class="c-actions"><button data-offerlater>Later</button></div></div>'; return; }
      s!.offerDue = null;
      if (o.limited) d.toast('No recruit offer this time', 'You can get up to 3 recruit offers a day.');
      if (o.id && o.candidates.length) s!.pendingRecruitOffer = { id: o.id, tournamentId: due.tournamentId, candidates: o.candidates, rerolled: !!o.rerolled };
      await save();
      if (!s!.pendingRecruitOffer) { render(); return; }
    }
    const o = s!.pendingRecruitOffer!;
    body.innerHTML = `<div class="c-card"><h3>Recruit a player</h3><p class="sub">You won! Three players from that draw want to join you. Recruiting one adds them to your account for every mode. The offer lasts until you enter your next tournament.</p>
      <div class="c-offer">${o.candidates.map((id) => { const c = characterById(id); const price = CFG.recruitCost[c.rarity]; return `<div class="c-recruit">${card(c)}<canvas class="pentagon" data-pent="${id}"></canvas>
        ${c.abilities.map((ab) => `<p class="ability"><span class="ab-tier">${ab.tier}</span><b>${e(ab.name)}</b> ${e(SIGNATURES.get(ab.id)?.text ?? ab.text)}</p>`).join('')}
        <button class="primary" data-recruit="${id}" ${s!.money < price ? 'disabled' : ''}>Recruit for ${money(price)}</button></div>`; }).join('')}</div>
      <div class="c-actions">${o.rerolled ? '' : `<button data-reroll ${s!.money < CFG.rerollCost ? 'disabled' : ''}>New candidates (${money(CFG.rerollCost)})</button>`}<button data-offerskip>Not now</button><button data-offerlater>Decide later</button></div></div>`;
    const { drawPentagon } = await import('../pentagon');
    body.querySelectorAll<HTMLCanvasElement>('[data-pent]').forEach((cv) => { const c = characterById(cv.dataset.pent!); drawPentagon(cv, c.base_stats ?? c.stats, RARITY[c.rarity].color); });
  }
  let offerLater = false;

  // ── Daily challenge ──
  let daily: import('../account').DailyInfo | null = null;
  async function renderDaily() {
    body.innerHTML = '<p class="sub">Loading today’s challenge…</p>';
    const m = await d.loadAccount();
    daily = await m.dailyGet();
    const ch = daily?.challenge;
    if (!ch) { body.innerHTML = '<div class="c-card"><p>The daily challenge isn’t available right now.</p></div>'; return; }
    const boss = characterById(ch.opponent);
    const owned = await d.owned();
    const mine = released.filter((c) => owned.has(c.id) || c.id === DEFAULT_CHARACTER).sort((a, b) => b.career_strength - a.career_strength);
    const next = new Date(ch.next_at).getTime() - Date.now();
    body.innerHTML = `<div class="c-card daily"><h3>Today’s challenge ${'★'.repeat(ch.difficulty)}${'☆'.repeat(5 - ch.difficulty)}</h3>
      <p>Beat ${card(boss)}${boss.abilities.length ? ` <span class="sub">${boss.abilities.map((ab) => `★ ${e(ab.name)}`).join(' ')}</span>` : ''}</p>
      <ul class="c-list">${ch.handicaps.map((h) => `<li>${e(HANDICAP_TEXT[h]?.replace('{n}', String(ch.behind)) ?? h)}</li>`).join('')}</ul>
      <p>Reward: <b>${ch.reward} rating points</b> (up to ${daily!.season_cap} a season from daily challenges; you have ${daily!.season_total}). Daily points can’t take you past Elite.</p>
      ${daily!.claimed ? `<p class="tag-on">Done today${daily!.reward_got !== null ? `: +${daily!.reward_got}` : ''}. Next challenge in ${Math.floor(next / 3600000)}h ${Math.floor((next % 3600000) / 60000)}m.</p>`
        : `<label class="c-field">Play as <select id="dPlayer" name="skyline-daily-player" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other">${mine.map((c) => `<option value="${c.id}">${e(c.name)} (${RARITY[c.rarity].label})</option>`).join('')}</select></label>
          <div class="c-actions"><button class="primary" data-dailygo>Play it</button></div><p class="sub">One game${ch.handicaps.includes('to_11') ? ' to 11' : ' to 21'}. You can try as often as you like today until you win.</p>`}</div>`;
  }

  async function playDaily() {
    const m = await d.loadAccount();
    const st = await m.dailyStart();
    if (!st?.ok || !st.token || !st.challenge) { d.toast('Can’t start the challenge', st?.claimed ? 'You’ve already won today’s challenge.' : 'Try again in a moment.'); return; }
    const ch = st.challenge, token = st.token;
    const boss = characterById(ch.opponent);
    const pick = ($('dPlayer') as HTMLSelectElement | null)?.value ?? DEFAULT_CHARACTER;
    const h = new Set(ch.handicaps);
    const level = boss.rarity === 'common' ? 'medium' : 'hard';
    close();
    d.play({
      setup: {
        mode: 'daily', format: { games: 1, points: h.has('to_11') ? 11 : 21 }, forced: true,
        player: { characterId: pick, abilities: true, modifiers: h.has('half_energy') ? [energyModifier(50)] : [] },
        opponent: { kind: 'cpu', characterId: boss.id, cpuLevel: level, style: STYLE_AI[boss.style], abilities: true },
        restrictions: { noSmash: h.has('no_smash'), noDropShot: h.has('no_drop'), opponentSpeedMult: h.has('fast_opponent') ? 1.1 : undefined, startScore: h.has('start_behind') ? [0, ch.behind] : undefined },
      },
      settings: { opponent: level, style: STYLE_AI[boss.style], games: 1, points: h.has('to_11') ? 11 : 21, event: 'singles' },
      onDone: async (g, retired) => {
        const won = !retired && (g.forfeitWinner ?? (g.match.games[0] > g.match.games[1] ? 0 : 1)) === 0;
        await open('daily');
        if (!won) { d.toast('Not this time', 'Have another go: you can try as often as you like today.'); return; }
        const r = await m.dailyClaim(token, g.match.history.map((x) => [x[0], x[1]] as [number, number]));
        if (r?.ok) d.toast(`Challenge won: +${r.reward} rating`, r.reward! < r.full_reward! ? 'Part of the reward was capped (season limit or the Elite ceiling).' : `Your rating is now ${r.rating}.`);
        else d.toast('Couldn’t claim the reward', r?.reason === 'too_fast' ? 'That was too quick to count.' : r?.reason === 'expired' ? 'The attempt took over 3 hours.' : 'The result wasn’t accepted.');
        void renderDaily();
      },
    });
  }

  // ── Playing a career match ──
  async function playNext() {
    const x = ev(), nm = x && nextMatch(s!, W(), x);
    if (!x || !nm || busy) return;
    const a = s!.current!;
    a.energyAtMatch = s!.energy;
    await save();
    const opp = nm.opponent;
    close();
    d.play({
      setup: {
        mode: 'career', format: { games: nm.games, points: nm.points },
        player: { characterId: a.as, modifiers: [energyModifier(s!.energy)], abilities: true },
        opponent: { kind: 'cpu', characterId: opp.id, cpuLevel: nm.level, style: STYLE_AI[opp.style], abilities: true },
        restrictions: {},
      },
      settings: { opponent: nm.level, style: STYLE_AI[opp.style], games: nm.games, points: nm.points, event: 'singles' },
      onDone: async (g, retired) => {
        const won = !retired && (g.forfeitWinner ?? (g.match.games[0] > g.match.games[1] ? 0 : 1)) === 0;
        const games = g.match.history.map((h) => [h[0], h[1]] as [number, number]);
        const before = myRank(s!, W());
        const r = recordMatch(s!, W(), x, won, games, opp.id);
        d.saveStats({ career_matches: 1, career_wins: won ? 1 : 0 });
        if (r.finished && r.result) {
          if (r.result.round === 'W') d.saveStats({ career_titles: 1 });
          d.saveStats({ career_prize: r.result.prize });
        }
        await save();
        const after = myRank(s!, W());
        if (after && (!s!.bestRank || after < s!.bestRank)) { s!.bestRank = after; d.saveStats({ max_career_best_rank: 1000 - after }); await save(); }
        panel.classList.remove('hidden');
        if (r.finished && r.result) {
          d.toast(r.result.round === 'W' ? `You won the ${x.name}!` : `Out in the ${ROUND_LABEL[r.result.round].toLowerCase()}`, `${r.result.points} ranking points · ${money(r.result.prize)} prize${after ? ` · world ranking ${after}${before && before !== after ? ` (was ${before})` : ''}` : ''}`);
        }
        render();
      },
    });
  }

  // ── Events ──
  panel.addEventListener('click', async (ev2) => {
    const t = ev2.target as HTMLElement;
    const at = (sel: string) => t.closest<HTMLElement>(sel);
    if (at('[data-cclose]')) { close(); return; }
    if (at('[data-retry]')) { void open(tab); return; }
    if (at('[data-login]')) { close(); d.openAccount('Log in or sign up to start a career.'); return; }
    const ct = at('[data-ctab]')?.dataset.ctab;
    if (ct) { tab = ct; render(); return; }
    if (!s) {
      const st = at('[data-starter]');
      if (st) { starter = { id: st.dataset.starter!, free: st.dataset.free === '1' }; body.querySelectorAll('[data-starter]').forEach((b) => b.classList.toggle('on', b === st)); ($('cBegin') as HTMLButtonElement).disabled = false; return; }
      if (t.id === 'cBegin') { void begin(); }
      return;
    }
    if (busy) return;
    const det = at('[data-detail]')?.dataset.detail;
    if (det) { renderDetail(det); return; }
    const en = at('[data-enter]')?.dataset.enter;
    if (en) {
      const x = findEvent(s, en, d.appVersion);
      if (!x || !canEnter(s, x, W()).ok) return;
      if (s.pendingRecruitOffer) { const m = await d.loadAccount(); await m.offerChoose(s.pendingRecruitOffer.id, null); s.pendingRecruitOffer = null; }
      enter(s, x); await save(); render(); return;
    }
    if (at('[data-club]')) { enter(s, clubEvent(s)); await save(); render(); return; }
    const wk = at('[data-week]')?.dataset.week as 'next' | 'rest' | undefined;
    if (wk) { if (wk === 'rest' && s.money < CFG.rest.cost) { d.toast('Not enough money', 'A rest week costs living expenses.'); return; } advanceWeek(s, wk, d.appVersion); await save(); render(); return; }
    if (at('[data-skip]')) {
      const target = W().cal.find((v) => v.week > s!.week);
      if (!target) { while (s.recap === null) advanceWeek(s, 'next', d.appVersion); }
      else while (s.week < target.week && s.recap === null) advanceWeek(s, 'next', d.appVersion);
      await save(); render(); return;
    }
    const rf = at('[data-refuel]')?.dataset.refuel as 'food' | 'physio' | undefined;
    if (rf) { if (!refuel(s, rf)) d.toast('Not enough money', ''); else { await save(); render(); } return; }
    if (at('[data-playnext]')) { void playNext(); return; }
    if (at('[data-withdraw]')) { if (!confirm('Withdraw from this tournament? You keep any prize and points from rounds you’ve already won.')) return; withdraw(s, W(), ev()!); await save(); render(); return; }
    const pk = at('[data-pick]')?.dataset.pick;
    if (pk && !s.current) { s.characterId = pk; if (!s.squad.includes(pk)) s.squad.push(pk); await save(); render(); return; }
    if (at('[data-recapdone]')) { s.recap = null; await save(); render(); return; }
    const df = at('[data-diff]')?.dataset.diff as Difficulty | undefined;
    if (df) { s.difficulty = df; await save(); render(); return; }
    if (at('[data-restart]')) { if (confirm('Restart your career? This one is replaced (recruited players stay on your account).')) { s = null; render(); } return; }
    // Recruiting
    const rc = at('[data-recruit]')?.dataset.recruit;
    const o = s.pendingRecruitOffer;
    if (rc && o) {
      const c = characterById(rc), price = CFG.recruitCost[c.rarity];
      if (s.money < price) return;
      const m = await d.loadAccount();
      const got = await m.offerChoose(o.id, rc);
      if (!got) { d.toast('Couldn’t recruit', 'The offer has expired or the server couldn’t be reached.'); return; }
      payFor(s, `Recruited ${c.name}`, price);
      s.squad.push(rc);
      s.pendingRecruitOffer = null;
      await save();
      d.toast(`${c.name} joined your squad`, 'Choose them in Squad to play your next event.');
      render(); return;
    }
    if (at('[data-reroll]') && o) {
      const m = await d.loadAccount();
      const r = await m.offerReroll(o.id);
      if (!r?.ok || !r.candidates) { d.toast('No new candidates', 'Nobody else from that draw is available.'); return; }
      payFor(s, 'New recruit candidates', CFG.rerollCost);
      o.candidates = r.candidates; o.rerolled = true;
      await save(); render(); return;
    }
    if (at('[data-offerskip]') && o) { const m = await d.loadAccount(); await m.offerChoose(o.id, null); s.pendingRecruitOffer = null; await save(); render(); return; }
    if (at('[data-offerlater]')) { offerLater = true; tab = 'hub'; renderLater(); return; }
    if (at('[data-dailygo]')) { void playDaily(); return; }
  });
  /** "Decide later": show the normal screens once (the offer comes back next time the career opens). */
  function renderLater() {
    const keepOffer = s!.pendingRecruitOffer, keepDue = s!.offerDue;
    s!.pendingRecruitOffer = null; s!.offerDue = null;
    render();
    s!.pendingRecruitOffer = keepOffer; s!.offerDue = keepDue;
    offerLater = false;
  }
  panel.addEventListener('change', async (ev2) => {
    const t = ev2.target as HTMLInputElement;
    if (!s) { if (t.id === 'cHome') void fillStarters(); return; }
    if (t.id === 'cBusiness') { s.settings.business = t.checked; const det = body.querySelector<HTMLElement>('[data-enter]')?.dataset.enter; await save(); if (det) renderDetail(det); }
    if (t.id === 'cFaster') { s.settings.fasterEarlyRounds = t.checked; await save(); }
  });

  return { open, close, isOpen: () => !panel.classList.contains('hidden'), get offerLater() { return offerLater; } };
}
