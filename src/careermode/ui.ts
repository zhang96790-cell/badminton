// Career mode screens: hub, events, bracket, ranking, squad, ledger, recruiting, season recap and the daily
// challenge. Plain HTML inside the #career panel (same look as Social). Matches are played by main.ts.
import { DEFAULT_CHARACTER, RARITY, characterById, rosterFor, type Character } from '../../shared/characters';
import type { Game } from '../game';
import type { Settings } from '../game';
import { LEVEL_LABEL, RULES, STYLES, type Style } from '../config';
import type { MatchSetup } from '../setup';
import { Match } from '../rules';
import { eventLook, kitBrandOf } from '../brands';
import { CAREER_CFG as CFG, LEVELS, ROUND_LABEL, TIER_LABEL, type HotelTier, type StaffRole, type TravelClass, type Difficulty, type Round } from './config';
import { CareerSaves, type Conflict } from './save';
import {
  advanceWeek, canEnter, clubEvent, repairCurrent, coachModifier, currentPlan, energyModifier, enter, eventsThisWeek, findEvent, hotelCost, medalOf, milestones, newMilestones, retire, setStaff, skipByes, sponsorUpgrade, money, myRank, newCareer,
  nextMatch, payFor, prizeFor, recordMatch, softLocked, travelCost, withdraw, world, type CareerState, type LiveMatch,
} from './state';
import { COUNTRIES, YOU, absWeek, calendar, pointsFor, countryName, hash, playOut, rng, roundsFor, simMatch, travelBand, type TourEvent, type World } from './world';
import { SIGNATURES } from './signatures';
import { setWhere } from '../errorlog';
import { Tour } from '../tour';

type Account = typeof import('../account');
export interface CareerDeps {
  appVersion: string;
  account: () => { id: string; username: string } | null;
  loadAccount: () => Promise<Account>;
  /** Owned players (refreshed from the account). */
  owned: () => Promise<Set<string>>;
  /** Play a match, then call onDone with the finished (or retired) game. */
  play: (o: { setup: MatchSetup; settings: Partial<Settings>; onDone: (g: Game, retired: boolean) => void; onLeave?: () => void }) => void;
  toast: (title: string, sub: string) => void;
  openAccount: (why: string) => void;
  saveStats: (delta: Record<string, number>) => void;
  esc: (s: string) => string;
}

const STYLE_AI: Record<string, Style> = { 'all-rounder': 'allround', attacker: 'attacker', defender: 'defender', 'net player': 'net', deceptive: 'deceptive', 'fast retriever': 'retriever', 'defensive wall': 'wall' };
const HANDICAP_TEXT: Record<string, string> = { no_smash: 'No smashes (hard overheads become drives)', no_drop: 'No drop shots (soft overheads become clears)', fast_opponent: 'Your opponent moves 10% faster', start_behind: 'You start {n} points down', to_11: 'A single game to 11', half_energy: 'You play tired: a little slower, and your timing is a little harder' };

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
    if (s && repairCurrent(s, W(), d.appVersion)) await save();
    if (s && await resumeLive()) return;
    render();
    maybeCareerTour();
  }
  const close = () => { panel.classList.add('hidden'); setWhere(''); };

  // ── Rendering ──
  const NAV: [string, string, string][] = [
    ['hub', 'Next up', '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'],
    ['ranking', 'Ranking', '<path d="M5 20V10M12 20V4M19 20v-7"/>'],
    ['squad', 'Squad', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M14.5 15c.8-.4 1.6-.5 2.5-.5 2.3 0 4 1.5 4.5 4.5"/>'],
    ['ledger', 'Money', '<path d="M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.6 0-4.5 1.3-4.5 3.2 0 4.6 9 2.4 9 6.8 0 1.9-1.9 3.3-4.5 3.3-2.2 0-4-.9-4.8-2.3"/>'],
    ['daily', 'Daily challenge', '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>'],
    ['trophies', 'Trophies', '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8 21h8M9.5 17h5"/>'],
    ['settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'],
  ];
  const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

  function render() {
    setWhere(`career: ${!s ? 'new career' : s.current ? 'tournament' : tab}`);
    panel.classList.toggle('c-board', true);
    if (!s) { renderNew(); return; }
    if (s.recap !== null) { renderRecap(); return; }
    const r = myRank(s, W());
    head.innerHTML = `<p class="hero-kicker">${s.year} · Week ${s.week} · in ${e(countryName(s.currentLocation))}</p><h2>${e(s.name)}</h2>
      <div class="c-stats"><div><b>${money(s.money)}</b><span>Money</span></div>
      <div><b>${r ? `#${r}` : '–'}</b><span>World rank</span></div><div><b>${s.titles}</b><span>Titles</span></div></div>`;
    $('careerTabs').innerHTML = NAV.map(([k, l, p]) => `<button role="tab" data-ctab="${k}" aria-selected="${k === tab}" ${s!.current && k === 'squad' ? 'title="Change players between tournaments"' : ''}>${icon(p)}<span>${l}</span></button>`).join('');
    if (s.pendingRecruitOffer || s.offerDue) { void renderOffer(); return; }
    ({ hub: renderHub, ranking: renderRanking, squad: renderSquad, ledger: renderLedger, daily: renderDaily, trophies: renderTrophies, settings: renderSettings } as Record<string, () => void>)[tab]?.();
  }

  /** You v them, for the next match. */
  const versus = (opp: Character) => {
    const me = characterById(s!.current?.as ?? s!.characterId);
    const side = (name: string, c: Character, who: string) => `<div class="c-side"><span class="c-who">${who}</span><b>${e(name)}</b>
      <span class="ccard" style="--rar:${RARITY[c.rarity].color}"><span class="rar">${RARITY[c.rarity].label}</span> ${e(c.country)} · ${e(c.style)}</span>
      ${c.abilities.map((ab) => `<span class="c-ab">★ ${e(ab.name)}</span>`).join('')}</div>`;
    return `<div class="c-vs">${side(s!.name, me, `You, as ${me.name}`)}<span class="c-v">v</span>${side(opp.name, opp, 'Opponent')}</div>
      <p class="c-trait"><b>${e(STYLES[STYLE_AI[opp.style]].label)}:</b> ${e(STYLES[STYLE_AI[opp.style]].trait)}</p>`;
  };
  const fact = (label: string, value: string, warn = false) => `<div class="c-fact${warn ? ' warn' : ''}"><span>${label}</span><b>${value}</b></div>`;
  // 3.9: no energy, so no travel and recovery bar (flights are economy and hotels 3-star).
  const recover = () => '';

  /** The season at a glance: every event on a 52-week line, your results on the ones you played. */
  function seasonStrip() {
    const marks = W().cal.map((v) => {
      const h = s!.history.find((x) => x.year === s!.year && x.tournamentId === v.id);
      const res = h ? (h.round === 'W' ? '🏆' : h.round === 'F' ? 'F' : h.round === 'SF' ? 'SF' : h.round === 'QF' ? 'QF' : '·') : '';
      const now = v.week === s!.week, past = v.week < s!.week;
      return `<button class="c-mark ${v.tier.toLowerCase()}${now ? ' now' : ''}${past ? ' past' : ''}" style="left:${((v.week - 1) / 51) * 100}%" data-detail="${v.id}" title="${e(v.name)} · week ${v.week}${h ? ` · you: ${resultName(h)}` : ''}"><i></i>${res ? `<em>${res}</em>` : ''}</button>`;
    }).join('');
    return `<div class="c-strip" aria-label="${s!.year} season"><div class="c-line"><span class="c-you" style="left:${((s!.week - 1) / 51) * 100}%"></span>${marks}</div>
      <div class="c-strip-key">${['S100', 'S300', 'S500', 'S750', 'S1000', 'WORLDS', 'OLYMPICS', 'WTF'].filter((t) => W().cal.some((v) => v.tier === t)).map((t) => `<span><i class="${t.toLowerCase()}"></i>${TIER_LABEL[t]}</span>`).join('')}
        <button class="c-listbtn" data-list>All tournaments</button></div></div>`;
  }

  /** An event you're allowed into (you may still need to save up for it). */
  const reachable = (v: TourEvent) => { const c = canEnter(s!, v, W()); return c.ok || !!c.why?.startsWith('You need'); };
  /** Two events in one week: which one the hub shows. */
  let pickedEv: string | null = null;
  function renderHub() {
    const week = eventsThisWeek(s!, d.appVersion);
    const x = week.find((v) => v.id === pickedEv) ?? week.find((v) => canEnter(s!, v, W()).ok) ?? week[0] ?? null;
    const also = week.filter((v) => v !== x);
    // The next event you're allowed into (a locked Super 300 is skipped; money can still be short).
    const upcoming = W().cal.filter((v) => v.week > s!.week);
    const next = upcoming.find((v) => reachable(v)) ?? upcoming[0] ?? null;
    let hero = '';
    if (s!.injury && !s!.current) {
      hero = `<p class="c-kicker">Injured</p><h3 class="c-title">${s!.injury.weeks} week${s!.injury.weeks === 1 ? '' : 's'} out</h3>
        <p class="c-lead">You can’t enter events until it heals; each week counts down.</p>
        <div class="c-cta"><button class="walk" data-week="next">Next week ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button></div>`;
    } else if (s!.current) {
      const ev2 = ev()!, a = s!.current, nm = nextMatch(s!, W(), ev2)!;
      const prizeNow = prizeFor(ev2, a.round), prizeWin = prizeFor(ev2, 'W');
      hero = `<p class="c-kicker">Next up · ${e(ev2.name)} · ${TIER_LABEL[ev2.tier]}</p><h3 class="c-title">${a.bronze ? 'Bronze medal match' : ROUND_LABEL[a.round]}</h3>
        ${versus(nm.opponent)}
        <div class="c-facts">${fact('Format', nm.games === 1 ? 'One game to 15' : 'Best of 3 to 15')}${fact('Prize if you lose here', money(prizeNow))}${fact('Prize if you win it all', money(prizeWin))}</div>
        <div class="c-cta"><button class="walk" data-playnext>Play ${a.bronze ? 'for 3rd place' : ROUND_LABEL[a.round].toLowerCase()} ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button><button class="edit" data-draw="${ev2.id}">See the draw</button><button class="edit" data-withdraw>Withdraw</button></div>
        ${a.scores.length ? `<ul class="c-results">${a.scores.map((g, i) => `<li>${ROUND_LABEL[roundsFor(ev2.draw_size)[i]]}: ${a.bronze && i === a.scores.length - 1 ? 'lost to' : 'beat'} ${e(characterById(a.opponents[i]).name)} <b>${g.map(([m, t]) => `${m}–${t}`).join(', ')}</b></li>`).join('')}</ul>` : ''}
        ${recover()}
`;
    } else if (softLocked(s!, W())) {
      hero = `<p class="c-kicker">Next up</p><h3 class="c-title">Local Club Open</h3>
        <p class="c-lead">${s!.money < CFG.tourMinMoney ? `You’re low on money: you need ${money(CFG.tourMinMoney)} to go on tour. Play the club open (it’s free and close by) until you’ve won it back.` : 'You can’t afford any tour events right now. The club open is free and close by: win a little money and some ranking points to get going again.'}</p>
        <div class="c-cta"><button class="walk" data-club>Play the club open ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button></div>${recover()}`;
    } else if (x) {
      const c = canEnter(s!, x, W());
      hero = `<p class="c-kicker">This week · ${TIER_LABEL[x.tier]}${x.dates ? ` · ${e(x.dates)}` : ''}</p><h3 class="c-title">${e(x.name)}</h3>
        <p class="c-lead">${e(x.city ? `${x.city}, ` : '')}${e(countryName(x.host_country))} · ${x.draw_size} players</p>
        ${also.length ? `<p class="c-also">Also this week (you can play one): ${also.map((v) => `<button class="linkish" data-pickev="${v.id}">${e(v.name)} · ${TIER_LABEL[v.tier]}</button>`).join(' ')}</p>` : ''}
        <div class="c-facts">${fact('Win it', `${money(prizeFor(x, 'W'))} · ${pointsFor(x.tier, 'W', x.draw_size)} pts`)}${fact(`Travel (${travelBand(s!.currentLocation, x.host_country)})`, money(travelCost(s!, x)))}${fact('Hotel', `${money(hotelCost(s!, x))} a night`)}</div>
        <div class="c-cta">${c.ok ? `<button class="walk" data-enter="${x.id}">Enter · ${money(travelCost(s!, x) + hotelCost(s!, x))} ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button>` : `<p class="c-why">${e(c.why ?? '')}</p>`}
          <button class="edit" data-week="next">Skip this event</button><button class="edit" data-detail="${x.id}">Prizes and field</button></div>${recover()}`;
    } else if (next) {
      const weeks = next.week - s!.week;
      hero = `<p class="c-kicker">Next event in ${weeks} week${weeks === 1 ? '' : 's'} · ${TIER_LABEL[next.tier]}</p><h3 class="c-title">${e(next.name)}</h3>
        <p class="c-lead">${e(countryName(next.host_country))} · week ${next.week}${canEnter(s!, next, W()).ok ? '' : ` · ${e(canEnter(s!, next, W()).why ?? '')}`}</p>
        <div class="c-cta"><button class="walk" data-skip>Go to week ${next.week} ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button><button class="edit" data-week="next">Just one week</button></div>${recover()}`;
    } else {
      hero = `<p class="c-kicker">Season over</p><h3 class="c-title">That’s the ${s!.year} season</h3>
        <div class="c-cta"><button class="walk" data-skip>See your season ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button></div>`;
    }
    body.innerHTML = `<section class="c-hero">${hero}</section>${seasonStrip()}`;
  }

  /**
   * The draw as a table: a column per round, who plays whom, winners in bold, seeds marked. Results are known
   * for finished rounds (your matches show your scores; other matches are simulated, so they show the winner only).
   */
  function drawTable(x: TourEvent): string {
    const cur = s!.current && s!.current.eventId === x.id ? s!.current : null;
    const h = s!.history.find((y) => y.year === s!.year && y.tournamentId === x.id) ?? null;
    const plan = cur ? currentPlan(s!, W(), x) : W().plan(x, s!.year, h ? h.as : null);
    const order = roundsFor(plan.slots.length);
    const withW = [...order, 'W' as Round];
    const finished = x.week < s!.week || !!h;
    const known = cur ? order.indexOf(cur.round) : finished ? order.length : 0;
    const decide = cur ? (a: string, b: string) => (a === YOU || b === YOU ? YOU : null)
      : h ? (a: string, b: string, rd: Round) => (a !== YOU && b !== YOU ? null : withW.indexOf(h.round) > withW.indexOf(rd) ? YOU : a === YOU ? b : a) : undefined;
    const { rounds } = playOut(plan.slots, W().strength, hash(s!.rngSeed, s!.year, x.id, 'play'), decide);
    const myScores = cur?.scores ?? h?.scores ?? [];
    const seed = (id: string) => (plan.seeds.includes(id) ? `<span class="d-seed" title="Seed ${plan.seeds.indexOf(id) + 1}">${plan.seeds.indexOf(id) + 1}</span>` : '');
    const nm = (id: string) => (id === YOU ? e(s!.name) : id === 'bye' ? 'Bye' : e(characterById(id).name));
    const who = (id: string) => (id === YOU ? '<small class="d-cc you">You</small>' : id === 'bye' ? '' : `<small class="d-cc">${e(characterById(id).country)}</small>`);
    const cols = order.map((rd, i) => {
      const alive = rounds[i];
      const matches = [];
      for (let m = 0; m < alive.length; m += 2) {
        const a = alive[m], b = alive[m + 1];
        const shown = i <= known;
        const winner = i < known ? rounds[i + 1][m / 2] : null;
        const mine = a === YOU || b === YOU;
        const sc = mine && i < myScores.length ? myScores[i].map(([p, q]) => `${p}–${q}`).join(', ') : '';
        const line = (id: string) => `<div class="d-p${winner === id ? ' won' : winner ? ' lost' : ''}${id === YOU ? ' me' : ''}${id === 'bye' ? ' bye' : ''}">${shown ? `${seed(id)}<span class="d-n">${nm(id)}</span>${who(id)}` : '<span class="tbd"></span>'}</div>`;
        matches.push(`<div class="d-m${mine && shown ? ' mine' : ''}${cur && i === known && mine ? ' next' : ''}${shown ? '' : ' empty'}">${line(a)}${line(b)}${sc ? `<div class="d-sc">${sc}</div>` : ''}</div>`);
      }
      // 3.12.12: matches in pairs, so a bracket line can join each pair to the match they feed.
      const grouped = [];
      for (let k = 0; k < matches.length; k += 2) grouped.push(`<div class="d-pair${matches.length === 1 ? ' solo' : ''}">${matches.slice(k, k + 2).join('')}</div>`);
      return `<div class="d-col${i === 0 ? ' first' : ''}"><h4>${ROUND_LABEL[rd]}</h4><div class="d-ms">${grouped.join('')}</div></div>`;
    });
    const champ = known >= order.length ? rounds[order.length][0] : null;
    cols.push(`<div class="d-col d-win"><h4>Champion</h4><div class="d-ms"><div class="d-pair solo"><div class="d-m d-champ${champ === YOU ? ' mine' : ''}${champ ? '' : ' empty'}"><span class="d-trophy">🏆</span><div class="d-p won${champ === YOU ? ' me' : ''}">${champ ? `<span class="d-n">${nm(champ)}</span>${who(champ)}` : '<span class="tbd">To be decided</span>'}</div></div></div></div></div>`);
    return `<div class="d-draw" role="table" aria-label="${e(x.name)} draw" style="--rounds:${cols.length}">${cols.join('')}</div>
      <p class="c-lead small">${known === 0 ? 'The first-round pairings. Seeds (top 4 in the world ranking) are marked with their number.' : 'Winners in bold. Your matches show your scores; other results are the winner only.'}</p>`;
  }

  /** Every event this season: dates, level, draw, host, and whether you can play it. */
  function renderList() {
    const rows = W().cal.map((v) => {
      const h = s!.history.find((y) => y.year === s!.year && y.tournamentId === v.id);
      const c = canEnter(s!, v, W());
      const status = h ? `You: ${resultName(h)}` : v.week < s!.week ? 'Done' : s!.current?.eventId === v.id ? 'Playing now'
        : c.ok ? (v.week === s!.week ? 'Enter now' : 'Open') : c.why?.startsWith('You need') ? 'Open (save up)' : 'Locked';
      return `<tr class="${v.week === s!.week ? 'me' : ''}${v.week < s!.week && !h ? ' past' : ''}" data-detail="${v.id}" title="${e(c.ok || h ? '' : c.why ?? '')}">
        <td>${e(v.dates ?? `week ${v.week}`)}</td><td><b>${e(v.name)}</b></td><td><span class="c-tier ${v.tier.toLowerCase()}">${TIER_LABEL[v.tier]}</span></td>
        <td>${v.draw_size}</td><td>${e(v.city ? `${v.city}, ` : '')}${e(countryName(v.host_country))}</td><td>${money(prizeFor(v, 'W'))}</td><td>${status}</td></tr>`;
    }).join('');
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">${s!.year} season · ${W().cal.length} tournaments</p><h3 class="c-title">All tournaments</h3>
      <p class="c-lead small">Click a tournament for its prizes and draw. Locked levels open when you reach a final at the level below, or climb the world ranking.</p>
      <table class="c-table c-list"><tr><th>Dates</th><th>Tournament</th><th>Level</th><th>Players</th><th>Host</th><th>Winner gets</th><th>Status</th></tr>${rows}</table>
      <div class="c-cta"><button class="edit" data-ctab="hub">← Back</button></div></section>`;
  }

  function renderDraw(id: string) {
    const x = findEvent(s!, id, d.appVersion);
    if (!x) return;
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">${TIER_LABEL[x.tier]} · week ${x.week}</p><h3 class="c-title">${e(x.name)}: the draw</h3>
      ${drawTable(x)}<div class="c-cta"><button class="edit" data-ctab="hub">← Back</button></div></section>`;
  }

  /** Before every career match: who you're about to play. */
  function renderPreMatch() {
    const x = ev(), nm = x && nextMatch(s!, W(), x);
    if (!x || !nm) return;
    const o = nm.opponent, me = characterById(s!.current!.as);
    const rankList = W().rankingAt(absWeek(s!.year, s!.week));
    const ri = rankList.findIndex((r) => r.id === o.id);
    const rank = ri >= 0 && rankList[ri].pts > 0 ? `#${ri + 1}` : 'Unranked';
    const style = STYLES[STYLE_AI[o.style]];
    const rows = ['Power', 'Speed', 'Net', 'Defence', 'Stamina'].map((l, i) => {
      const a = (o.base_stats ?? o.stats)[i], b = (me.base_stats ?? me.stats)[i];
      return `<tr><td>${l}</td><td><b>${a}</b></td><td>${b}</td><td class="${a > b ? 'down' : a < b ? 'up' : ''}">${a > b ? `+${a - b} them` : a < b ? `+${b - a} you` : 'even'}</td></tr>`;
    }).join('');
    const lk = eventLook(x.id, x.tier);
    body.innerHTML = `<section class="c-hero c-pre"><p class="c-kicker">${e(x.name)}${lk.presenter ? ` presented by ${e(lk.presenter.name)}` : ''} · ${roundName(nm)} · ${nm.games === 1 ? 'one game' : 'best of 3'} to 15 · ${e(lk.shuttle.name)} shuttles</p>
      <div class="c-pre-grid">
        <div class="c-pre-who">
          <h3 class="c-title">${e(o.name)}</h3>
          <span class="ccard" style="--rar:${RARITY[o.rarity].color}"><span class="rar">${RARITY[o.rarity].label}</span> ${e(countryName(o.country))} · ${o.handedness === 'left' ? 'left-handed' : 'right-handed'}</span>
          <div class="c-facts">${fact('World rank', rank)}${fact('Style', style.label)}${fact('Career strength', String(o.career_strength))}${fact('Plays like', `${LEVEL_LABEL[nm.level]} CPU`)}${fact('Kit', kitBrandOf(o.id).name)}</div>
          <p class="c-trait"><b>${e(style.label)}:</b> ${e(style.trait)}</p>
          ${o.abilities.length ? o.abilities.map((ab) => `<p class="ability"><span class="ab-tier">${ab.tier}</span><b>${e(ab.name)}</b> ${e(SIGNATURES.get(ab.id)?.text ?? ab.text)}</p>`).join('') : '<p class="c-lead small">No signature ability.</p>'}
          <p class="c-lead">${e(o.description)}</p>
        </div>
        <div class="c-pre-stats">
          <canvas class="pentagon" id="prePent" aria-label="${e(o.name)}'s stats against yours"></canvas>
          <p class="c-lead small"><span class="key them"></span>${e(o.name.split(' ')[0])} <span class="key you"></span>You (${e(me.name)})</p>
          <table class="c-table"><tr><th></th><th>${e(o.name.split(' ')[0])}</th><th>You</th><th></th></tr>${rows}</table>
        </div>
      </div>
      <div class="c-cta"><button class="walk" data-startmatch>Start match ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button><button class="edit" data-ctab="hub">← Back</button></div></section>`;
    void import('../pentagon').then(({ drawPentagon }) => drawPentagon($('prePent') as HTMLCanvasElement, o.base_stats ?? o.stats, RARITY[o.rarity].color, { stats: me.base_stats ?? me.stats, color: '#ffc54d' }));
  }

  function renderDetail(id: string) {
    const x = findEvent(s!, id, d.appVersion);
    if (!x) return;
    const plan = W().plan(x, s!.year, null);
    const byRarity = new Map<string, number>();
    for (const p of plan.slots) { const c = characterById(p); byRarity.set(c.rarity, (byRarity.get(c.rarity) ?? 0) + 1); }
    const rounds = roundsFor(x.draw_size);
    const h = s!.history.find((y) => y.year === s!.year && y.tournamentId === x.id);
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">${e(x.dates ?? `Week ${x.week}`)} · ${TIER_LABEL[x.tier]}</p><h3 class="c-title">${e(x.name)}</h3>
      <p class="c-lead">${e(x.city ? `${x.city}, ` : '')}${e(countryName(x.host_country))} · ${x.draw_size} players: ${[...byRarity].map(([r, n]) => `${n} ${RARITY[r as Character['rarity']].label}`).join(', ')}${h ? ` · you reached the ${ROUND_LABEL[h.round].toLowerCase()}` : ''}</p>
      <table class="c-table"><tr><th>If you go out in</th><th>Prize</th><th>Ranking points</th></tr>${[...rounds, 'W' as Round].map((r) => `<tr><td>${r === 'W' ? 'Win it' : ROUND_LABEL[r]}</td><td>${money(prizeFor(x, r))}</td><td>${pointsFor(x.tier, r, x.draw_size)}</td></tr>`).join('')}</table>
      <div class="c-facts">${fact('Flight', money(travelCost(s!, x)))}${fact('Hotel a night', money(hotelCost(s!, x)))}</div>
      <h3 class="c-title small">The draw</h3>${drawTable(x)}
      <div class="c-cta"><button class="edit" data-ctab="hub">← Back</button></div></section>`;
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
    // Your career squad: the player you started with and the ones you've recruited in this career.
    const mine = s!.squad.map((id) => characterById(id)).filter((c) => c.id !== DEFAULT_CHARACTER);
    void owned;
    body.innerHTML = `<div class="c-card"><h3>Your squad</h3><p class="sub">The player you started with and the ones you’ve recruited this career. Choose who plays your next tournament. Recruits also join your account for ranked and friend matches.</p>
      <div class="c-squad">${mine.map((c) => `<button class="${c.id === s!.characterId ? 'on' : ''}" data-pick="${c.id}" ${s!.current ? 'disabled' : ''}>${card(c, `<span class="sub">career strength ${c.career_strength}${c.abilities.length ? ` · ${c.abilities.map((ab) => `★ ${e(ab.name)}`).join(', ')}` : ''}</span>`)}</button>`).join('') || '<p>No players yet.</p>'}</div></div>`;
  }

  /** Sponsors and staff (in the Money tab). */
  function teamHtml() {
    const offers = sponsorUpgrade(s!, myRank(s!, W()));
    const sp = s!.sponsor;
    const staff = (['coach'] as StaffRole[]).map((k) => {
      const st = CFG.staff[k], on = !!s!.staff?.[k];
      return `<button class="c-opt${on ? ' on' : ''}" data-staff="${k}"><b>${st.label}${on ? ' (hired)' : ''}</b><span>${money(st.wage)} a week</span><span>${e(st.note)}</span><span>${on ? 'Click to let them go' : 'Click to hire'}</span></button>`;
    }).join('');
    return `<section class="c-hero"><p class="c-kicker">Sponsor</p>
      ${sp ? `<p class="c-lead"><b>${e(sp.name)}</b> pays you ${money(sp.weekly)} a week and ${money(sp.bonus)} for every title, until the end of ${sp.year}.</p>` : '<p class="c-lead">No sponsor yet. Sponsors come to you once you’re in the world top 200, and better deals open as you climb.</p>'}
      ${offers ? `<p class="c-lead">${sp ? 'A better deal is on offer:' : 'Sponsors want you:'}</p><div class="c-opts">${offers.map((o, i) => `<button class="c-opt" data-sponsor="${i}"><b>${e(o.name)}</b><span>${money(o.weekly)} a week</span><span>${money(o.bonus)} a title</span><span>Until the end of ${o.year}</span></button>`).join('')}</div>` : ''}
      <h3 class="c-title small">Your team</h3><div class="c-opts">${staff}</div></section>`;
  }

  function renderTrophies() {
    const h = s!.history;
    const titles = h.filter((x) => x.round === 'W');
    const byTier = new Map<string, number>();
    for (const t of titles) byTier.set(t.tier, (byTier.get(t.tier) ?? 0) + 1);
    const medals = h.map((x) => ({ x, m: medalOf(x) })).filter((y) => y.m);
    const ms = milestones(s!);
    const hof = s!.hallOfFame ?? [];
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">Trophy cabinet</p>
      <div class="c-facts">${fact('Titles', String(s!.titles))}${fact('Best world ranking', s!.bestRank ? `#${s!.bestRank}` : '–')}${fact('Medals', medals.length ? medals.map((y) => (y.m === 'gold' ? '🥇' : y.m === 'silver' ? '🥈' : '🥉')).join('') : 'None yet')}${fact('Prize money won', money(h.reduce((t, x) => t + x.prize, 0)))}</div>
      ${titles.length ? `<p class="c-lead">${[...byTier].map(([t, n]) => `${n} × ${TIER_LABEL[t]}`).join(' · ')}</p><ul class="c-results">${titles.slice(-12).reverse().map((t) => `<li>🏆 ${t.year} ${e(calendar(d.appVersion, t.year).find((v) => v.id === t.tournamentId)?.name ?? 'Local Club Open')}</li>`).join('')}</ul>` : '<p class="c-lead">No titles yet.</p>'}
      ${medals.length ? `<ul class="c-results">${medals.map((y) => `<li>${y.m === 'gold' ? '🥇 Gold' : y.m === 'silver' ? '🥈 Silver' : '🥉 Bronze'}: ${y.x.tier === 'OLYMPICS' ? 'Olympic Games' : 'World Championships'} ${y.x.year}</li>`).join('')}</ul>` : ''}
      <h3 class="c-title small">Milestones · ${ms.filter((m) => m.done).length} of ${ms.length}</h3>
      <div class="c-miles">${ms.map((m) => `<span class="${m.done ? 'done' : ''}">${m.done ? '★' : '☆'} ${e(m.label)}</span>`).join('')}</div>
      <h3 class="c-title small">Hall of Fame</h3>
      ${hof.length ? `<table class="c-table"><tr><th>Player</th><th>Years</th><th>Titles</th><th>Best rank</th><th>Medals</th></tr>${hof.map((x) => `<tr><td>${e(x.name)} <span class="sub">(as ${e(x.as)})</span></td><td>${x.from}–${x.to}</td><td>${x.titles}</td><td>${x.bestRank ? `#${x.bestRank}` : '–'}</td><td>${'🥇'.repeat(x.golds)}${'🥈'.repeat(x.silvers)}${'🥉'.repeat(x.bronzes)}</td></tr>`).join('')}</table>` : '<p class="c-lead small">Retire a career to put it in the Hall of Fame.</p>'}
      ${s!.year > CFG.startYear && !s!.current ? `<div class="c-cta"><button class="edit" data-retire>Retire and enter the Hall of Fame</button></div>` : '<p class="c-lead small">You can retire after your first season.</p>'}
      </section>`;
  }

  function renderLedger() {
    const year = s!.ledger.filter((l) => l.year === s!.year);
    const inc = year.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0), out = year.filter((l) => l.amount < 0).reduce((t, l) => t + l.amount, 0);
    body.innerHTML = teamHtml() + `<div class="c-card"><h3>Money</h3><p>${s!.year} so far: income ${money(inc)}, costs ${money(-out)}, net ${money(inc + out)}.</p>
      <table class="c-table"><tr><th>Week</th><th>What</th><th>Amount</th></tr>${s!.ledger.slice(-60).reverse().map((l) => `<tr><td>${l.year} w${l.week}</td><td>${e(l.label)}</td><td class="${l.amount >= 0 ? 'up' : 'down'}">${money(l.amount)}</td></tr>`).join('')}</table></div>`;
  }

  function renderSettings() {
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">Settings</p>
      <p class="c-lead">Early rounds are one game to 15 points; from the quarter-finals on, matches are best of 3 games to 15.</p>
      <p class="c-lead">Opponents get harder as you meet stronger players and enter bigger events: Commons play like a Hard or Expert CPU, Rares up to Elite, and Super 300 players a level higher.</p>
      <h3 class="c-title small">Start again</h3><p class="c-lead">Restarting replaces this career. Players you recruited stay on your account.</p>
      <div class="c-cta"><button class="edit" data-restart>Restart career</button></div></section>`;
  }

  // ── New career ──
  function renderNew() {
    const acc = d.account()!;
    head.innerHTML = '<p class="hero-kicker">Career</p><h2>Start your career</h2>';
    $('careerTabs').innerHTML = '';
    const countries = [...new Set(released.map((c) => c.country))].filter((c) => COUNTRIES[c]).sort((a, b) => countryName(a).localeCompare(countryName(b)));
    body.innerHTML = `<div class="c-card" role="group" aria-label="New career" data-form-type="other"><label class="c-field">Your name <input id="cName" name="skyline-career-player" type="text" maxlength="24" spellcheck="false" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" value="${e(acc.username.replace(/_/g, ' '))}"/></label>
      <label class="c-field">Home country <select id="cHome" name="skyline-career-base" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other">${countries.map((c) => `<option value="${c}">${e(countryName(c))}</option>`).join('')}</select></label>
      <h3>Choose your player</h3><p class="sub">Everyone starts as a Common player with no signature ability. Finish in the top 3 (or win the bigger events) to recruit stronger ones.</p>
      <div id="cStarters" class="c-squad"></div>
      <div class="c-actions"><button class="primary" id="cBegin" disabled>Start career</button></div></div>`;
    void fillStarters();
  }
  let starter: { id: string; free: boolean } | null = null;
  /** A retired career's Hall of Fame, carried into the next career. */
  let retiredHall: import('./state').HallEntry[] | null = null;
  async function fillStarters() {
    const home = ($('cHome') as HTMLSelectElement).value;
    // Everyone starts as a Common with no signature ability (recruits come from winning).
    const commons = released.filter((c) => c.rarity === 'common' && c.id !== DEFAULT_CHARACTER && !c.abilities.length);
    const region = COUNTRIES[home]?.region;
    let pool = commons.filter((c) => c.country === home);
    if (pool.length < 3) pool = pool.concat(commons.filter((c) => c.country !== home && COUNTRIES[c.country]?.region === region));
    if (pool.length < 3) pool = commons;
    const r = rng(hash(d.account()!.id, home));
    const picks = [...pool].sort(() => r() - 0.5).slice(0, 3);
    starter = null;
    ($('cBegin') as HTMLButtonElement).disabled = true;
    $('cStarters').innerHTML = picks.map((c) => `<button data-starter="${c.id}" data-free="1">${card(c, '<span class="sub">free</span>')}</button>`).join('');
  }

  async function begin() {
    if (!starter || busy) return;
    busy = true;
    try {
      const m = await d.loadAccount();
      // The first career also adds the free player to your account (for ranked); later careers just play as them.
      if (starter.free) await m.careerStarter(starter.id).catch(() => null);
      const hall = retiredHall ?? [];
      retiredHall = null;
      s = newCareer({ name: ($('cName') as HTMLInputElement).value.trim() || 'Player', homeCountry: ($('cHome') as HTMLSelectElement).value, characterId: starter.id, difficulty: 'relaxed' });
      s.hallOfFame = hall;
      const prevRev = saves!.rev;
      saves!.rev = prevRev; // a restart replaces the old save from the same revision
      await save();
      tab = 'hub';
      render();
      maybeCareerTour();
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
      <ul class="c-list">${hs.map((h) => `<li>${e(findEvent(s!, h.tournamentId, d.appVersion)?.name ?? 'Local Club Open')}: ${resultName(h)} (${h.points} points, ${money(h.prize)})</li>`).join('') || '<li>No events this season.</li>'}</ul>
      <div class="c-actions"><button class="primary" data-recapdone>On to ${y + 1}</button></div></div>`;
  }

  // ── Recruiting ──
  async function renderOffer() {
    const m = await d.loadAccount();
    if (s!.offerDue && !s!.pendingRecruitOffer) {
      const due = s!.offerDue;
      const o = await m.offerCreate(due.tournamentId, due.tier, due.field, due.place ?? 1);
      if (!o) { body.innerHTML = '<div class="c-card"><p>Couldn’t reach the server to make your recruit offer. It’ll be waiting next time.</p><div class="c-actions"><button data-offerlater>Later</button></div></div>'; return; }
      s!.offerDue = null;
      if (o.limited) d.toast('No recruit offer this time', 'You can get up to 6 recruit offers a day.');
      if (o.id && o.candidates.length) s!.pendingRecruitOffer = { id: o.id, tournamentId: due.tournamentId, candidates: o.candidates, rerolled: !!o.rerolled, place: due.place };
      await save();
      if (!s!.pendingRecruitOffer) { render(); return; }
    }
    const o = s!.pendingRecruitOffer!;
    body.innerHTML = `<div class="c-card"><h3>Recruit a player</h3><p class="sub">${o.place === 3 ? 'Third place!' : o.place === 2 ? 'Runner-up!' : 'You won!'} Three players from that draw want to join you${o.place === 2 ? ' (2nd place: a quarter off)' : o.place === 3 ? '' : ' (you won: Commons free, everyone else half price)'}${o.place && o.place > 1 ? ' (win the event for better odds of rarer players and cheaper recruits)' : ''}. Recruiting one adds them to your account for every mode. The offer lasts until you enter your next tournament.</p>
      <div class="c-offer">${o.candidates.map((id) => { const c = characterById(id); const price = recruitPrice(c.rarity, o.place); return `<div class="c-recruit">${card(c)}<canvas class="pentagon" data-pent="${id}"></canvas>
        ${c.abilities.map((ab) => `<p class="ability"><span class="ab-tier">${ab.tier}</span><b>${e(ab.name)}</b> ${e(SIGNATURES.get(ab.id)?.text ?? ab.text)}</p>`).join('')}
        <button class="primary" data-recruit="${id}" ${s!.money < price ? 'disabled' : ''}>${price ? `Recruit for ${money(price)}` : 'Recruit for free'}</button></div>`; }).join('')}</div>
      <div class="c-actions">${o.rerolled ? '' : `<button data-reroll ${s!.money < CFG.rerollCost ? 'disabled' : ''}>New candidates (${money(CFG.rerollCost)})</button>`}<button data-offerskip>Not now</button><button data-offerlater>Decide later</button></div></div>`;
    const { drawPentagon } = await import('../pentagon');
    body.querySelectorAll<HTMLCanvasElement>('[data-pent]').forEach((cv) => { const c = characterById(cv.dataset.pent!); drawPentagon(cv, c.base_stats ?? c.stats, RARITY[c.rarity].color); });
  }
  let offerLater = false;
  /** 3.12.7: the rarity's price times your place's share (win: Commons free, the rest half price; 2nd: 3/4; 3rd: full). */
  const recruitPrice = (r: keyof typeof CFG.recruitCost, place?: 1 | 2 | 3) => Math.round(CFG.recruitCost[r] * (r === 'common' ? CFG.recruitCommonShare : CFG.recruitPlaceShare)[place ?? 1]);

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
      <p class="c-trait"><b>${e(STYLES[STYLE_AI[boss.style]].label)}:</b> ${e(STYLES[STYLE_AI[boss.style]].trait)}</p>
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
    // The boss plays at the easiest career level for its rarity (Rare: Expert, Super Rare: Pro, Epic: Elite); handicaps make it harder.
    const level = LEVELS[(CFG.cpuLevel[boss.rarity]?.[0] ?? 1) - 1];
    close();
    d.play({
      setup: {
        mode: 'daily', format: { games: 1, points: h.has('to_11') ? 11 : 21 }, forced: true, label: 'Daily challenge',
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
  // A match in progress is saved at every serve (on this computer) and on Save and leave (to your account),
  // so a reload or leaving carries on from the same score. Opening career mode goes straight back to it.
  const liveKey = () => `badminton.careerLive.${d.account()?.id ?? 'x'}`;
  function readLive(): LiveMatch | null {
    try { const t = localStorage.getItem(liveKey()); return t ? JSON.parse(t) as LiveMatch : null; } catch { return null; }
  }
  function writeLive(l: LiveMatch | null) {
    try { if (l) localStorage.setItem(liveKey(), JSON.stringify(l)); else localStorage.removeItem(liveKey()); } catch { /* storage blocked */ }
  }
  /** On opening career: carry on with a match left part-way. True if it took over. */
  async function resumeLive(): Promise<boolean> {
    const a = s?.current, x = ev(), nm = a && x && nextMatch(s!, W(), x);
    const same = (l: LiveMatch | null | undefined) => !!l && !!a && !!nm && l.eventId === a.eventId && l.round === nm.round && l.opp === nm.opponent.id;
    const local = readLive(), l = same(local) ? local : same(a?.live) ? a!.live! : null;
    if (!l) {
      if (local) writeLive(null);
      if (a?.live) { delete a.live; await save(); }
      return false;
    }
    const mm = new Match(RULES.formats[nm!.points], nm!.games === 1 ? 1 : 2);
    mm.restore(l.snap);
    // Leaving in the middle of a rally gives the point away (otherwise a reload would undo a lost rally).
    if (l.rally) {
      const o = mm.award(1);
      if (o.gameOver && !o.matchOver) mm.newGame();
      d.toast('Point to your opponent', 'You left in the middle of a rally.');
    }
    const over = mm.games[0] >= mm.gamesToWin || mm.games[1] >= mm.gamesToWin;
    if (over) {
      writeLive(null);
      delete a!.live;
      await finishMatch(x!, nm!.opponent.id, mm.games[0] > mm.games[1], mm.history.map((h) => [h[0], h[1]] as [number, number]));
      return true;
    }
    d.toast('Match resumed', `${x!.name}, ${roundName(nm!).toLowerCase()}: carrying on from where you left.`);
    await playNext(mm.snapshot());
    return true;
  }

  const roundName = (nm: { round: Round; bronze?: boolean }) => (nm.bronze ? 'Bronze medal match' : ROUND_LABEL[nm.round]);
  const resultName = (h: { round: Round; place?: 3 | 4 }) => (h.place === 3 ? '3rd place' : h.place === 4 ? '4th place' : ROUND_LABEL[h.round]);

  async function playNext(resume?: string) {
    const x = ev(), nm = x && nextMatch(s!, W(), x);
    if (!x || !nm || busy) return;
    const a = s!.current!;
    delete a.live;
    await save();
    const opp = nm.opponent;
    const live: LiveMatch = { eventId: a.eventId, round: nm.round, opp: opp.id, snap: '', rally: false };
    close();
    d.play({
      setup: {
        mode: 'career', format: { games: nm.games, points: nm.points }, label: `${x.name} · ${roundName(nm)}`,
        player: { characterId: a.as, modifiers: [coachModifier(s!)], abilities: true },
        opponent: { kind: 'cpu', characterId: opp.id, cpuLevel: nm.level, style: STYLE_AI[opp.style], abilities: true },
        restrictions: {}, resume, look: eventLook(x.id, x.tier),
        checkpoint: (snap, rally) => { live.snap = snap; live.rally = rally; writeLive(live); },
      },
      settings: { opponent: nm.level, style: STYLE_AI[opp.style], games: nm.games, points: nm.points, event: 'singles' },
      onLeave: async () => {
        // Saved to your account too, so it carries on from another computer. Career stays shut until you resume.
        if (live.snap) { s!.current!.live = { ...live }; await save(); }
        d.toast('Match saved', 'Open career mode to carry on from this score.');
      },
      onDone: async (g, retired) => {
        writeLive(null);
        const won = !retired && (g.forfeitWinner ?? (g.match.games[0] > g.match.games[1] ? 0 : 1)) === 0;
        await finishMatch(x, opp.id, won, g.match.history.map((h) => [h[0], h[1]] as [number, number]));
      },
    });
  }

  /** Record a finished career match and show what it did (ranking, prizes, injuries). */
  async function finishMatch(x: TourEvent, oppId: string, won: boolean, games: [number, number][]) {
    if (s!.current) delete s!.current.live;
    const before = myRank(s!, W());
    const r = recordMatch(s!, W(), x, won, games, oppId);
    d.saveStats({ career_matches: 1, career_wins: won ? 1 : 0 });
    if (r.finished && r.result) {
      if (r.result.round === 'W') d.saveStats({ career_titles: 1 });
      d.saveStats({ career_prize: r.result.prize });
    }
    await save();
    const after = myRank(s!, W());
    if (after && (!s!.bestRank || after < s!.bestRank)) { s!.bestRank = after; d.saveStats({ max_career_best_rank: 1000 - after }); await save(); }
    panel.classList.remove('hidden');
    if (r.injured) d.toast(`Injured: out for ${r.injured} weeks`, 'You played too tired. Rest up: you can’t enter events until it heals.');
    for (const m of newMilestones(s!)) d.toast(`Milestone: ${m.label}`, 'See it in Trophies.');
    await save();
    if (r.finished && r.result) {
      d.toast(r.result.round === 'W' ? `You won the ${x.name}!` : r.result.place ? `${r.result.place === 3 ? '3rd' : '4th'} place at the ${x.name}` : `Out in the ${ROUND_LABEL[r.result.round].toLowerCase()}`, `${r.result.points} ranking points · ${money(r.result.prize)} prize${after ? ` · world ranking ${after}${before && before !== after ? ` (was ${before})` : ''}` : ''}`);
    }
    render();
    if (r.finished && r.result) showPodium(x, r.result);
  }

  /** 3.12: the top 3 of an event, once it's over (worked out the same way as the draw). */
  function podiumOf(x: TourEvent, h: { as: string | null; round: Round; place?: number }): [string, string, string] | null {
    const plan = W().plan(x, s!.year, h.as);
    const order = roundsFor(plan.slots.length);
    if (order.length < 2) return null;
    const withW = [...order, 'W' as Round];
    const decide = (a: string, b: string, rd: Round) => (a !== YOU && b !== YOU ? null : withW.indexOf(h.round) > withW.indexOf(rd) ? YOU : a === YOU ? b : a);
    const { rounds } = playOut(plan.slots, W().strength, hash(s!.rngSeed, s!.year, x.id, 'play'), decide);
    const n = order.length;
    const champ = rounds[n][0], finalists = rounds[n - 1], semis = rounds[n - 2];
    const runner = finalists.find((p) => p !== champ) ?? finalists[0];
    const losers = semis.filter((p) => !finalists.includes(p) && p !== 'bye');
    let third = losers[0];
    if (losers.length === 2) {
      third = h.place === 3 ? YOU : h.place === 4 ? losers.find((p) => p !== YOU)! : simMatch(losers[0], losers[1], W().strength, hash(s!.rngSeed, s!.year, x.id, 'bronze'));
    }
    return [champ, runner, third];
  }

  if (import.meta.env.DEV) (window as unknown as { devPodium: (top: [string, string, string]) => void }).devPodium = (top) => renderPodium('Malaysia Open', 'S1000', 2026, top, 'You');
  function showPodium(x: TourEvent, h: { as: string | null; round: Round; place?: number }) {
    let top: [string, string, string] | null = null;
    try { top = podiumOf(x, h); } catch { return; }
    if (top) renderPodium(x.name, x.tier, s!.year, top, s!.name);
  }

  function renderPodium(evName: string, tier: string, year: number, top: [string, string, string], myName: string) {
    document.getElementById('podium')?.remove();
    const nm = (id: string) => (id === YOU ? e(myName) : id === 'bye' ? '' : e(characterById(id).name));
    const ct = (id: string) => (id === YOU ? '' : id === 'bye' ? '' : e(countryName(characterById(id).country)));
    const you = top.indexOf(YOU);
    const step = (i: 0 | 1 | 2) => `<div class="pd-step pd-${i + 1}${top![i] === YOU ? ' me' : ''}">
      <div class="pd-who"><span class="pd-medal">${['🥇', '🥈', '🥉'][i]}</span><b>${nm(top![i])}</b><small>${ct(top![i])}${top![i] === YOU ? 'You' : ''}</small></div>
      <div class="pd-block"><span>${i + 1}</span></div></div>`;
    const el = document.createElement('div');
    el.id = 'podium';
    el.className = you === 0 ? 'won' : '';
    el.innerHTML = `<div class="pd-card" role="dialog" aria-label="${e(evName)} podium">
      <p class="c-kicker">${e(TIER_LABEL[tier] ?? '')} · ${year}</p>
      <h2>${e(evName)}</h2>
      <p class="pd-sub">${you === 0 ? 'Champion! You won the title.' : you > 0 ? `You finished ${you === 1 ? '2nd' : '3rd'}.` : 'The final standings.'}</p>
      <div class="pd-stage">${step(1)}${step(0)}${step(2)}</div>
      <button class="walk" data-podiumclose>Continue</button>
    </div>${you === 0 ? `<div class="pd-confetti">${Array.from({ length: 60 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.25}s;--c:${['#f2c14e', '#fff', '#5ad1a0', '#ff6b6b', '#7aa8ff'][i % 5]};--r:${(i * 53) % 360}deg"></i>`).join('')}</div>` : ''}`;
    document.body.appendChild(el);
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); document.removeEventListener('keydown', key); };
    const key = (k: KeyboardEvent) => { if (k.key === 'Enter' || k.key === 'Escape') { k.preventDefault(); close(); } };
    el.querySelector('[data-podiumclose]')!.addEventListener('click', close);
    document.addEventListener('keydown', key);
  }

  // ── Career tour (first visit, and the Tour button) ──
  const TOUR_KEY = 'badminton.careerTourDone';
  const go = (t: string) => () => { tab = t; render(); };
  const careerTour = new Tour([
    { target: '#careerHead .c-stats', title: 'Your numbers', text: 'Money, world rank and titles. Money pays for flights and hotels; prizes and sponsors bring it in.', before: go('hub') },
    { target: '.c-hero', title: 'Next up', text: 'Always your next step: your next match (with a big Play button), this week’s tournament to enter, or the next event to travel to. Before each match you get a scouting report on your opponent.' },
    { target: '.c-strip', title: 'The season', text: 'Every tournament of the year on one line, coloured by level, with your results. Click one for its prizes and draw. Bigger events open as you reach finals or climb the world ranking.' },
    { target: '.c-listbtn', title: 'All tournaments', text: 'The full calendar as a list: dates, level, players, host, prize and whether you can enter.' },
    { target: '[data-ctab="ranking"]', title: 'World ranking', text: 'Your best 10 results in the last 52 weeks count. It decides your seeding and which events you can enter.' },
    { target: '[data-ctab="squad"]', title: 'Your squad', text: 'Everyone starts as a Common player with no signature ability. Finish in the top 3 of a Super 100, 300 or 500 (or win any bigger event) to recruit a player from its draw. Better places and bigger events give better odds of rarer players.' },
    { target: '[data-ctab="ledger"]', title: 'Money, sponsors and staff', text: 'Every cost and prize. Sponsors pay you weekly once you’re in the top 200, and you can hire a coach for weekly wages.' },
    { target: '[data-ctab="daily"]', title: 'Daily challenge', text: 'One challenge a day for everyone, against a strong player with a handicap or two. Win it for rating points.' },
    { target: '[data-ctab="trophies"]', title: 'Trophies', text: 'Your titles, medals and milestones. After your first season you can retire into the Hall of Fame and start again.' },
    { target: '[data-ctab="settings"]', title: 'Starting again', text: 'Settings has Restart career. Note: in 3.3.1 everyone’s career was reset, so if an old career is gone, that’s why. Players you recruited are still on your account.' },
    { target: '[data-ctour]', title: 'That’s it', text: 'Press Tour any time to see this again. Good luck on the tour!' },
  ], () => { tab = 'hub'; if (s) render(); });
  function startCareerTour() {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* storage blocked */ }
    tab = 'hub';
    render();
    careerTour.start();
  }
  /** First time with a career: show the tour once. */
  function maybeCareerTour() {
    let seen = false;
    try { seen = localStorage.getItem(TOUR_KEY) === '1'; } catch { seen = true; }
    if (!seen && s && !s.recap && !s.pendingRecruitOffer && !s.offerDue) setTimeout(startCareerTour, 300);
  }

  // ── Events ──
  panel.addEventListener('click', async (ev2) => {
    const t = ev2.target as HTMLElement;
    const at = (sel: string) => t.closest<HTMLElement>(sel);
    if (at('[data-cclose]')) { close(); return; }
    if (at('[data-ctour]')) { if (s) startCareerTour(); else d.toast('Start a career first', 'The tour shows you around once your career has begun.'); return; }
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
    const dr = at('[data-draw]')?.dataset.draw;
    if (dr) { renderDraw(dr); return; }
    const det = at('[data-detail]')?.dataset.detail;
    if (det) { renderDetail(det); return; }
    const en = at('[data-enter]')?.dataset.enter;
    if (en) {
      const x = findEvent(s, en, d.appVersion);
      if (!x || !canEnter(s, x, W()).ok) return;
      if (s.pendingRecruitOffer) { const m = await d.loadAccount(); await m.offerChoose(s.pendingRecruitOffer.id, null); s.pendingRecruitOffer = null; }
      enter(s, x); skipByes(s, W(), x); await save(); render(); return;
    }
    if (at('[data-club]')) { enter(s, clubEvent(s)); await save(); render(); return; }
    const pe = at('[data-pickev]')?.dataset.pickev;
    if (pe) { pickedEv = pe; renderHub(); return; }
    if (at('[data-list]')) { renderList(); return; }
    const wk = at('[data-week]')?.dataset.week as 'next' | 'rest' | undefined;
    if (wk) { if (wk === 'rest' && s.money < CFG.rest.cost) { d.toast('Not enough money', 'A rest week costs living expenses.'); return; } advanceWeek(s, wk, d.appVersion); await save(); render(); return; }
    if (at('[data-skip]')) {
      const target = W().cal.filter((v) => v.week > s!.week).find((v) => reachable(v)) ?? W().cal.find((v) => v.week > s!.week);
      if (!target) { while (s.recap === null) advanceWeek(s, 'next', d.appVersion); }
      else while (s.week < target.week && s.recap === null) advanceWeek(s, 'next', d.appVersion);
      await save(); render(); return;
    }
    const cl = at('[data-class]')?.dataset.class as TravelClass | undefined;
    if (cl) { s.settings.travelClass = cl; s.settings.business = cl === 'business'; await save(); render(); return; }
    const ho = at('[data-hotel]')?.dataset.hotel as HotelTier | undefined;
    if (ho) { s.settings.hotel = ho; if (s.current) s.current.hotelTier = ho; await save(); render(); return; }
    const stf = at('[data-staff]')?.dataset.staff as StaffRole | undefined;
    if (stf) { setStaff(s, stf, !s.staff?.[stf]); await save(); render(); return; }
    const spn = at('[data-sponsor]')?.dataset.sponsor;
    if (spn !== undefined) { const offers = sponsorUpgrade(s, myRank(s, W())); if (offers) { s.sponsor = offers[Number(spn)]; d.toast(`Signed with ${s.sponsor.name}`, `${money(s.sponsor.weekly)} a week and ${money(s.sponsor.bonus)} a title.`); await save(); render(); } return; }
    if (at('[data-retire]')) {
      if (!confirm('Retire? This career goes into the Hall of Fame and you start a new one. Players you recruited stay on your account.')) return;
      retiredHall = retire(s); s = null; render(); return;
    }
    const rf = at('[data-refuel]')?.dataset.refuel as 'food' | 'physio' | undefined;
    if (rf) return;
    if (at('[data-playnext]')) { renderPreMatch(); return; }
    if (at('[data-startmatch]')) { void playNext(); return; }
    if (at('[data-withdraw]')) { if (!confirm('Withdraw from this tournament? You keep any prize and points from rounds you’ve already won.')) return; withdraw(s, W(), ev()!); await save(); render(); return; }
    const pk = at('[data-pick]')?.dataset.pick;
    if (pk && !s.current) { s.characterId = pk; if (!s.squad.includes(pk)) s.squad.push(pk); await save(); render(); return; }
    if (at('[data-recapdone]')) { s.recap = null; await save(); render(); return; }
    const df = at('[data-diff]')?.dataset.diff as Difficulty | undefined;
    if (df) { s.difficulty = df; await save(); render(); return; }
    if (at('[data-restart]')) { if (confirm('Restart your career? This one is replaced (recruited players stay on your account).')) { retiredHall = s.hallOfFame ?? []; s = null; render(); } return; }
    // Recruiting
    const rc = at('[data-recruit]')?.dataset.recruit;
    const o = s.pendingRecruitOffer;
    if (rc && o) {
      const c = characterById(rc), price = recruitPrice(c.rarity, o.place);
      if (s.money < price) return;
      const m = await d.loadAccount();
      const got = await m.offerChoose(o.id, rc);
      if (!got) { d.toast('Couldn’t recruit', 'The offer has expired or the server couldn’t be reached.'); return; }
      if (price) payFor(s, `Recruited ${c.name}`, price);
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

  });

  return { open, close, isOpen: () => !panel.classList.contains('hidden'), get offerLater() { return offerLater; } };
}
