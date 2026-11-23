// Career mode screens: hub, events, bracket, ranking, squad, ledger, recruiting, season recap and the daily
// challenge. Plain HTML inside the #career panel (same look as Social). Matches are played by main.ts.
import { DEFAULT_CHARACTER, RARITY, characterById, getEdition, statNames, rosterFor, type Character } from '../../shared/characters';
import type { Game } from '../game';
import type { Settings } from '../game';
import { LEVEL_LABEL, RULES, STYLES, type Style } from '../config';
import type { WalkOnInfo, WalkOnStep } from '../walkon';
import type { MatchSetup } from '../setup';
import { Match } from '../rules';
import { eventLook, kitBrandOf } from '../brands';
import { titleTierOf } from '../titles';
import { CAREER_CFG as CFG, LEVELS, ROUND_LABEL, TIER_LABEL, type HotelTier, type StaffRole, type TravelClass, type Difficulty, type Round } from './config';
import { CareerSaves, type Conflict } from './save';
import {
  advanceWeek, canEnter, clubEvent, loanLimit, loanOptions, loanOwed, repayLoan, takeLoan, repairCurrent, coachModifier, currentPlan, energyModifier, enter, eventsThisWeek, findEvent, hotelCost, medalOf, milestones, newMilestones, retire, setStaff, skipByes, sponsorUpgrade, rescaleSponsor, perkText, tripPlan, rivalsOf, headToHead, pressAnswer, PRESS, entryFor, signSponsor, sponsorIn, type SponsorSlot, money, myRank, newCareer, semiFreshStart, migrate,
  nextMatch, payFor, DAY_NAMES, matchDrain, opponentRested, restedModifier, restedTier, roundDay, travelRestCost, shopModifier, staffWages, campCost, campGain, houseCost, teamCost, buy, trainingCamp, prizeFor, recordMatch, softLocked, travelCost, withdraw, world, type CareerState, type NewsItem, type LiveMatch,
  type NextMatch,
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
  play: (o: { setup: MatchSetup; settings: Partial<Settings>; onDone: (g: Game, retired: boolean) => void; onLeave?: () => void; walkOn?: WalkOnInfo }) => void;
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
  /** 4.2.2: opened during a match: look around, but nothing that plays, spends or moves the week. */
  let viewOnly = false;
  async function open(startTab = 'hub', view = false) {
    viewOnly = view;
    panel.classList.toggle('c-viewonly', view);
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
    saves = new CareerSaves(m, acc.id, getEdition() === 5 ? 'v5' : 'v4');
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
    // 3.14: titles from before then get their tier on your account once (they already count as titles).
    // 3.14.1: club opens aren't titles, so take any already counted off this career's total.
    if (s) { const n = s.history.filter((h) => h.round === 'W' && h.tier !== 'CLUB' && !h.legacy).length; if (s.titles !== n) { s.titles = n; await save(); } }
    // Club wins still go in as ct_club, only so the account can take them off its old title count.
    if (s && !s.titleTiersSynced) {
      const delta: Record<string, number> = {};
      for (const h of s.history) {
        if (h.round !== 'W') continue;
        const key = h.tier === 'CLUB' ? 'ct_club' : titleTierOf(h.tier)?.key;
        if (key) delta[key] = (delta[key] ?? 0) + 1;
      }
      if (Object.keys(delta).length) d.saveStats(delta);
      s.titleTiersSynced = true;
      await save();
    }
    if (s && rescaleSponsor(s)) await save();
    if (s && !viewOnly && await resumeLive(false)) return;
    if (liveDue) tab = 'hub';
    render();
    maybeCareerTour();
  }
  const close = () => { panel.classList.add('hidden'); setWhere(''); };

  // ── Rendering ──
  const NAV: [string, string, string][] = [
    ['hub', 'Next up', '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'],
    ['ranking', 'Ranking', '<path d="M5 20V10M12 20V4M19 20v-7"/>'],
    ['squad', 'Squad', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M14.5 15c.8-.4 1.6-.5 2.5-.5 2.3 0 4 1.5 4.5 4.5"/>'],
    ['news', 'News', '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7M7 17h4"/>'],
    ['sponsors', 'Sponsors', '<path d="M4 7h16v12H4zM9 7V5h6v2M4 12h16"/>'],
    ['shop', 'Shop', '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>'],
    ['ledger', 'Money', '<path d="M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.6 0-4.5 1.3-4.5 3.2 0 4.6 9 2.4 9 6.8 0 1.9-1.9 3.3-4.5 3.3-2.2 0-4-.9-4.8-2.3"/>'],
    ['daily', 'Daily challenge', '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>'],
    ['trophies', 'Trophies', '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8 21h8M9.5 17h5"/>'],
    ['settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'],
  ];
  const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const NAV_ICON = Object.fromEntries(NAV.map(([k, , p]) => [k, p]));
  /** 5.0: the tabs in groups: the season, you, money, the rest. */
  const NAV_V5: ([string, string, string] | null)[] = [
    ['hub', 'Next up', NAV_ICON.hub], ['calendar', 'Calendar', '<rect x="4" y="5" width="16" height="15" rx="1"/><path d="M4 10h16M9 3v4M15 3v4M8 14h2M14 14h2M8 17h2"/>'], ['ranking', 'Ranking', NAV_ICON.ranking],
    null,
    ['squad', 'Squad', NAV_ICON.squad], ['rivals', 'Rivals', '<path d="M3 6l4 12 4-12M20 8c-.6-1.3-1.8-2-3.3-2-1.9 0-3.2 1-3.2 2.5 0 3.4 6.8 1.8 6.8 5.2 0 1.6-1.4 2.8-3.4 2.8-1.6 0-2.9-.7-3.5-2"/>'],
    ['news', 'News', NAV_ICON.news], ['trophies', 'Trophies', NAV_ICON.trophies],
    null,
    ['sponsors', 'Sponsors', NAV_ICON.sponsors], ['ledger', 'Money', NAV_ICON.ledger], ['shop', 'Shop', NAV_ICON.shop],
    null,
    ['daily', 'Daily', NAV_ICON.daily], ['settings', 'Settings', NAV_ICON.settings],
  ];

  function render() {
    setWhere(`career: ${!s ? 'new career' : s.current ? 'tournament' : tab}`);
    panel.classList.toggle('c-board', true);
    if (!s) { renderNew(); return; }
    if (s.recap !== null) { renderRecap(); return; }
    const r = myRank(s, W());
    s.bestRankNow = r;
    head.innerHTML = `<p class="hero-kicker">${s.year} · Week ${s.week} · in ${e(countryName(s.currentLocation))}</p><h2>${e(s.name)}</h2>
      <div class="c-stats"><div><b>${money(s.money)}</b><span>Money</span></div>
      <div><b>${r ? `#${r}` : '–'}</b><span>World rank</span></div><div><b>${s.titles}</b><span>Titles</span></div></div>`;
    const tabBtn = ([k, l, p]: [string, string, string]) => `<button role="tab" data-ctab="${k}" aria-selected="${k === tab}" ${s!.current && k === 'squad' ? 'title="Change players between tournaments"' : ''}>${icon(p)}<span>${l}</span>${k === 'shop' && shopHasNew() ? '<span class="c-new dot">New</span>' : ''}</button>`;
    $('careerTabs').innerHTML = (getEdition() === 5 ? NAV_V5 : NAV.filter(([k]) => k !== 'news')).map((n) => (n ? tabBtn(n) : '<span class="c-tabsep" aria-hidden="true"></span>')).join('');
    if (s.pendingRecruitOffer || s.offerDue) { void renderOffer(); return; }
    ({ hub: renderHub, calendar: renderCalendar, rivals: renderRivals, ranking: renderRanking, squad: getEdition() === 5 ? renderSquadV5 : renderSquad, news: renderNews, sponsors: renderSponsors, shop: renderShop, ledger: renderLedger, daily: renderDaily, trophies: renderTrophies, settings: renderSettings } as Record<string, () => void>)[tab]?.();
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
  /** 4.1: the Rested bar (and what the next trip would cost you). */
  const recover = (x?: TourEvent | null) => {
    const r = Math.round(s!.energy), t = restedTier(r);
    const trip = x && !s!.current ? travelRestCost(s!, x) : 0;
    return `<div class="c-rest" style="--rest:${r}%"><span class="c-rest-k">Rested</span><div class="c-rest-bar"><i></i></div><b>${r}% · ${t.label}</b>${trip ? `<small>The trip there: −${trip}%</small>` : ''}${t.p ? `<small>Your timing and aim are off (−${Math.round(t.p * CFG.rested.effect.timing * 100)}%) and you’re a little slower (−${Math.round(t.p * CFG.rested.effect.move * 100)}%). Adrenaline halves it in a semi-final and cancels it in a final.</small>` : ''}</div>`;
  };

  /** The season at a glance: every event on a 52-week line, your results on the ones you played. */
  function seasonStrip() {
    const marks = W().cal.map((v) => {
      const h = s!.history.find((x) => x.year === s!.year && x.tournamentId === v.id);
      const res = h ? (h.qual ? 'Q' : h.round === 'W' ? '🏆' : h.round === 'F' ? 'F' : h.round === 'SF' ? 'SF' : h.round === 'QF' ? 'QF' : '·') : '';
      const now = v.week === s!.week, past = v.week < s!.week;
      return `<button class="c-mark ${v.tier.toLowerCase()}${now ? ' now' : ''}${past ? ' past' : ''}" style="left:${((v.week - 1) / 51) * 100}%" data-detail="${v.id}" title="${e(v.name)} · week ${v.week}${h ? ` · you: ${resultName(h)}` : ''}"><i></i>${res ? `<em>${res}</em>` : ''}</button>`;
    }).join('');
    return `<div class="c-strip" aria-label="${s!.year} season"><div class="c-line"><span class="c-you" style="left:${((s!.week - 1) / 51) * 100}%"></span>${marks}</div>
      <div class="c-strip-key">${['S100', 'S300', 'S500', 'S750', 'S1000', 'WORLDS', 'OLYMPICS', 'WTF'].filter((t) => W().cal.some((v) => v.tier === t)).map((t) => `<span><i class="${t.toLowerCase()}"></i>${TIER_LABEL[t]}</span>`).join('')}
        <button class="c-listbtn" data-list>All tournaments</button></div></div>`;
  }

  // ── 5.0 (v5): rivals, news, fans and press conferences on the hub ──
  /** A press conference waiting for your answer (after a career match). */
  let pressDue: { won: boolean; opp: string; event: string } | null = null;
  function pressHtml() {
    if (!pressDue) return '';
    const opts = pressDue.won ? PRESS.win : PRESS.loss, opp = characterById(pressDue.opp).name;
    const mic = icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>');
    return `<section class="v5-press"><div class="v5-press-mic">${mic}</div><div class="v5-press-main">
      <p class="v5-press-where">Press conference · ${e(pressDue.event)}</p>
      <h3 class="v5-press-q">${pressDue.won ? `How did you beat ${e(opp)}?` : `What went wrong against ${e(opp)}?`}</h3>
      <div class="v5-answers">${opts.map((o) => `<button class="v5-answer" data-press="${o.id}"><b>${e(o.label)}</b><span class="v5-chips"><i class="${o.fans >= 10 ? 'good' : ''}">+${o.fans} fans</i>${o.mood ? `<i class="${o.mood > 0 ? 'good' : 'bad'}">Sponsors ${o.mood > 0 ? 'happier' : 'less happy'}</i>` : ''}${o.fire ? `<i class="bad">Fires ${e(opp.split(' ')[0])} up</i>` : ''}</span></button>`).join('')}</div>
    </div></section>`;
  }
  const NEWS_KIND: Record<NewsItem['kind'], string> = { you: 'You', world: 'Tour', rival: 'Rival', move: 'Moves', award: 'Awards' };
  const newsLi = (n: NewsItem, i: number, year?: boolean) => `<li class="n-${n.kind}${i === 0 ? ' lead' : ''}"><span class="v5-wk">${year ? `${n.year} · ` : ''}W${n.week}</span><span class="v5-kind">${NEWS_KIND[n.kind]}</span><p>${e(n.text)}</p></li>`;
  function v5HubHtml() {
    const ids = rivalsOf(s!, W());
    const rank = (id: string) => { const l = W().rankingAt(absWeek(s!.year, s!.week)); const i = l.findIndex((x) => x.id === id); return i < 0 || l[i].pts <= 0 ? 'Unranked' : `#${i + 1}`; };
    const rivals = ids.map((id) => {
      const c = characterById(id), [w, l] = headToHead(s!, id), fired = s!.rivalFire?.includes(id);
      return `<li class="v5-rival${fired ? ' fired' : ''}${w > l ? ' ahead' : l > w ? ' behind' : ''}"><span class="v5-rival-meta"><span class="v5-cc">${e(c.country)}</span>${rank(id)}</span>
        <b class="v5-rival-name">${e(c.name)}</b>${fired ? '<span class="v5-tag fire">Fired up</span>' : ''}
        <span class="v5-h2h" title="Your head-to-head"><b class="w">${w}</b><i>–</i><b class="l">${l}</b></span></li>`;
    }).join('');
    const news = (s!.news ?? []).slice(0, 5).map((n, i) => newsLi(n, i)).join('');
    return `<div class="v5-hub">
      <section class="v5-panel v5-rivals"><header class="v5-ph"><h3>Rivals <em>${s!.year}</em></h3><button class="v5-more" data-ctab="rivals">All rivals ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button></header>
        ${rivals ? `<ol class="v5-rival-list">${rivals}</ol>` : '<p class="v5-empty-line">Your rivals are picked once you’re ranked.</p>'}
        <p class="v5-foot">Beat a rival for a bonus and a headline. Your head-to-head is on the right. <b>${(s!.fans ?? 0).toLocaleString('en-GB')}</b> fans.</p></section>
      <section class="v5-panel v5-wire"><header class="v5-ph"><h3>Newswire</h3><button class="v5-more" data-ctab="news">All news ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button></header>
        <ul class="v5-news">${news || '<li class="v5-empty-line">Nothing yet: play an event.</li>'}</ul></section>
    </div>`;
  }
  function renderNews() {
    const items = s!.news ?? [];
    const awards = (s!.awards ?? []).slice().reverse();
    body.innerHTML = `<section class="c-hero v5-newsroom"><h3 class="c-title">Newswire</h3>
      <ul class="v5-news big">${items.map((n, i) => newsLi(n, i, true)).join('') || '<li class="v5-empty-line">No news yet. Play an event and the headlines start.</li>'}</ul>
      ${awards.length ? `<h3 class="c-title small">Awards nights</h3>${awards.map((a) => `<div class="v5-award-line"><b>${a.year}</b>${a.list.map((x) => `<span class="${x.you ? 'you' : ''}"><i>${e(x.award)}</i>${e(x.winner)}</span>`).join('')}</div>`).join('')}` : ''}</section>`;
  }

  /** 5.0 travel planner: the whole trip's cost against the prize for each round, and where you break even. */
  function planHtml(x: TourEvent, qual?: boolean) {
    const p = tripPlan(s!, x);
    if (qual) return `<div class="v5-plan"><header class="v5-ph"><h3>Travel planner</h3></header><p class="v5-foot">Through qualifying: once you’re in the main draw the event pays your travel and hotel, so every round you win is profit.</p></div>`;
    const show = p.rows.filter((r) => r.round !== 'R64' || x.draw_size > 32);
    const max = Math.max(1, ...show.map((r) => Math.abs(r.prize - r.cost)));
    const rows = show.map((r) => {
      const net = r.prize - r.cost, up = net >= 0, be = r.round === p.breakEven;
      return `<div class="v5-plan-row ${up ? 'up' : 'down'}${be ? ' be' : ''}"><span class="r">${r.round === 'W' ? 'Win it' : ROUND_LABEL[r.round]}${be ? '<span class="v5-tag gold">Break even</span>' : ''}</span><span class="c">${money(r.cost)}</span><span class="p">${money(r.prize)}</span>
        <span class="bar"><i style="width:${(Math.abs(net) / max) * 50}%"></i></span><b class="net">${up ? '+' : '−'}${money(Math.abs(net)).replace('−', '')}</b></div>`;
    }).join('');
    return `<div class="v5-plan"><header class="v5-ph"><h3>Travel planner</h3><span class="v5-sub">${p.breakEven ? `Break even at the ${p.breakEven === 'W' ? 'title' : ROUND_LABEL[p.breakEven].toLowerCase()}` : 'Costs more than any prize: play it for the points'}</span></header>
      <div class="v5-plan-head"><span>Go out in</span><span>Trip costs</span><span>Prize</span><span>Profit or loss</span></div>${rows}</div>`;
  }
  /** 3.19: a short offer of a tour loan, under an event you can only reach through qualifying. */
  function loanLine() {
    const opts = loanOptions(s!);
    if (s!.loan) return `<p class="c-lead small">You owe ${money(s!.loan.owed)} on your tour loan.</p>`;
    if (!opts.length) return '';
    return `<p class="c-lead small">Or take a tour loan and pay your own way: ${opts.map((a) => `<button class="linkish" data-loan="${a}">borrow ${money(a)}</button>`).join(' · ')} (you pay back ${Math.round(CFG.loan.fee * 100)}% more).</p>`;
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
    } else if (s!.current?.qual) {
      // 3.19: qualifying.
      const ev2 = ev()!, nm = nextMatch(s!, W(), ev2)!;
      hero = `<p class="c-kicker">Qualifying · ${e(ev2.name)} · ${TIER_LABEL[ev2.tier]} · Tuesday</p><h3 class="c-title">Qualifying round ${nm.qual} of 2</h3>
        ${versus(nm.opponent)}
        <div class="c-facts">${fact('Format', 'One game to 15')}${fact('Win both', 'You’re in the main draw')}${fact('Travel and hotel', 'Paid by the event')}</div>
        ${liveNote()}<div class="c-cta">${goBtn(`Play qualifying round ${nm.qual}`, 'data-playnext')}<button class="edit" data-withdraw>Withdraw</button></div>${recover()}`;
    } else if (s!.current) {
      const ev2 = ev()!, a = s!.current, nm = nextMatch(s!, W(), ev2)!;
      const prizeNow = prizeFor(ev2, a.round), prizeWin = prizeFor(ev2, 'W');
      const day = DAY_NAMES[a.bronze ? 6 : roundDay(ev2, a.round, hash(s!.rngSeed, ev2.id))];
      hero = `<p class="c-kicker">Next up · ${e(ev2.name)} · ${TIER_LABEL[ev2.tier]} · ${day}</p><h3 class="c-title">${a.bronze ? 'Bronze medal match' : ROUND_LABEL[a.round]}</h3>
        ${versus(nm.opponent)}
        <div class="c-facts">${fact('Format', nm.games === 1 ? 'One game to 15' : 'Best of 3 to 15')}${fact('Prize if you lose here', money(prizeNow))}${fact('Prize if you win it all', money(prizeWin))}</div>
        ${liveNote()}<div class="c-cta">${goBtn(`Play ${a.bronze ? 'for 3rd place' : ROUND_LABEL[a.round].toLowerCase()}`, 'data-playnext')}<button class="edit" data-draw="${ev2.id}">See the draw</button><button class="edit" data-withdraw>Withdraw</button></div>
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
        ${c.qual ? `<p class="c-lead">${e(c.why ?? '')}</p>${loanLine()}` : !c.ok && c.why?.startsWith('You need') ? loanLine() : ''}
        <div class="c-cta">${c.ok ? `<button class="walk" data-enter="${x.id}">${c.qual ? 'Enter qualifying · free' : `Enter · ${money(travelCost(s!, x) + hotelCost(s!, x))}`} ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button>` : `<p class="c-why">${e(c.why ?? '')}</p>`}
          <button class="edit" data-week="next">Skip this event</button><button class="edit" data-detail="${x.id}">Prizes and field</button></div>
        ${getEdition() === 5 && (c.ok || c.why?.startsWith('You need')) ? planHtml(x, c.qual) : ''}
        <p class="c-lead small">The week: qualifying and the round of 32 Tuesday and Wednesday, round of 16 Thursday, quarter-finals Friday, semi-finals Saturday, final Sunday.</p>${recover(x)}`;
    } else if (next) {
      const weeks = next.week - s!.week;
      hero = `<p class="c-kicker">Next event in ${weeks} week${weeks === 1 ? '' : 's'} · ${TIER_LABEL[next.tier]}</p><h3 class="c-title">${e(next.name)}</h3>
        <p class="c-lead">${e(countryName(next.host_country))} · week ${next.week}${canEnter(s!, next, W()).ok ? '' : ` · ${e(canEnter(s!, next, W()).why ?? '')}`}</p>
        <div class="c-cta"><button class="walk" data-skip>Go to week ${next.week} ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button><button class="edit" data-week="next">Just one week</button></div>${recover()}`;
    } else {
      hero = `<p class="c-kicker">Season over</p><h3 class="c-title">That’s the ${s!.year} season</h3>
        <div class="c-cta"><button class="walk" data-skip>See your season ${icon('<path d="M4 12h15M13 6l6 6-6 6"/>')}</button></div>`;
    }
    body.innerHTML = `${viewOnly ? '<p class="c-viewnote">You’re in a match: looking only. Press Esc to go back to it.</p>' : ''}${getEdition() === 5 ? pressHtml() : ''}<section class="c-hero">${hero}</section>${seasonStrip()}${getEdition() === 5 ? v5HubHtml() : ''}`;
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
    /** One column: round i, only matches [from, to). */
    const column = (i: number, from: number, to: number, first: boolean) => {
      const rd = order[i], alive = rounds[i];
      const matches = [];
      for (let m = from * 2; m < to * 2; m += 2) {
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
      return `<div class="d-col${first ? ' first' : ''}"><h4>${ROUND_LABEL[rd]}</h4><div class="d-ms">${grouped.join('')}</div></div>`;
    };
    const champ = known >= order.length ? rounds[order.length][0] : null;
    const champCol = `<div class="d-col d-win"><h4>Champion</h4><div class="d-ms"><div class="d-pair solo"><div class="d-m d-champ${champ === YOU ? ' mine' : ''}${champ ? '' : ' empty'}"><span class="d-trophy">🏆</span><div class="d-p won${champ === YOU ? ' me' : ''}">${champ ? `<span class="d-n">${nm(champ)}</span>${who(champ)}` : '<span class="tbd">To be decided</span>'}</div></div></div></div></div>`;
    const grid = (cols: string[]) => `<div class="d-draw" role="table" aria-label="${e(x.name)} draw" style="--rounds:${cols.length}">${cols.join('')}</div>`;
    const note = `<p class="c-lead small">${known === 0 ? 'The first-round pairings. Seeds (top 4 in the world ranking) are marked with their number.' : 'Winners in green. Your matches show your scores; other results are the winner only.'}</p>`;
    // 3.12.13: draws of 32 or more split into four quarters (up to the quarter-finals), then a draw from the quarter-finals on, so each fits on one screen.
    const qf = order.indexOf('QF' as Round);
    if (qf < 2) return grid([...order.map((_, i) => column(i, 0, rounds[i].length / 2, i === 0)), champCol]) + note;
    const views: { label: string; html: string; has: boolean }[] = [];
    for (let q = 0; q < 4; q++) {
      const cols = [];
      for (let i = 0; i < qf; i++) { const n = rounds[i].length / 2 / 4; cols.push(column(i, q * n, (q + 1) * n, i === 0)); }
      const seg = rounds[0].slice(q * rounds[0].length / 4, (q + 1) * rounds[0].length / 4);
      views.push({ label: `Quarter ${q + 1}`, html: grid(cols), has: seg.includes(YOU) });
    }
    views.push({ label: 'Quarter-finals on', html: grid([...order.slice(qf).map((_, j) => column(qf + j, 0, rounds[qf + j].length / 2, true && j === 0)), champCol]), has: false });
    // Open on your quarter while it's still being played; on the last stage once the quarter-finals start.
    let open = known >= qf ? 4 : views.findIndex((v) => v.has);
    if (open < 0) open = 0;
    return `<div class="d-tabs" role="tablist">${views.map((v, k) => `<button type="button" role="tab" data-drawsec="${k}" class="${k === open ? 'on' : ''}">${v.label}${v.has ? ' <small>You</small>' : ''}</button>`).join('')}</div>
      ${views.map((v, k) => `<div class="d-view" data-drawview="${k}"${k === open ? '' : ' hidden'}>${v.html}</div>`).join('')}${note}`;
  }

  /** Every event this season: dates, level, draw, host, and whether you can play it. */
  /** 5.0: the season as a grid of weeks: each event's level, whether you're in, the trip cost, and Rested after the trip. */
  function calendarGrid() {
    const cells = [];
    for (let wk = 1; wk <= 52; wk++) {
      const evs = W().cal.filter((v) => v.week === wk), now = wk === s!.week, past = wk < s!.week;
      cells.push(`<div class="v5-wkc${now ? ' now' : ''}${past ? ' past' : ''}${evs.length ? '' : ' none'}"><i>${wk}${now ? '<span>This week</span>' : ''}</i>${evs.map((v) => {
        const c = canEnter(s!, v, W()), entry = entryFor(s!, v, W()), trip = travelCost(s!, v);
        const h = s!.history.find((y) => y.year === s!.year && y.tournamentId === v.id);
        const rest = Math.max(0, Math.round(s!.energy) - travelRestCost(s!, v));
        const [st, tag] = h ? ['done', `You: ${resultName(h)}`] : past ? ['out', 'Done'] : c.ok ? (c.qual ? ['qual', 'Qualifying'] : ['main', 'Main draw']) : entry === 'out' ? ['out', 'Not in'] : ['save', 'Save up'];
        return `<button class="v5-ev t-${v.tier.toLowerCase()}" data-detail="${v.id}" title="${e(v.name)}"><span class="v5-ev-tier"><i></i>${TIER_LABEL[v.tier]}</span><b>${e(v.name.replace(/ (Open|Masters|International|Championships?)$/, ''))}</b><span class="v5-ev-st st-${st}">${e(tag)}</span>${past || h ? '' : `<span class="v5-ev-meta">${money(trip)} trip · ${rest}% rested</span>`}</button>`;
      }).join('')}</div>`);
    }
    return `<div class="v5-cal">${cells.join('')}</div>`;
  }

  function listTable() {
    const rows = W().cal.map((v) => {
      const h = s!.history.find((y) => y.year === s!.year && y.tournamentId === v.id);
      const c = canEnter(s!, v, W());
      const status = h ? `You: ${resultName(h)}` : v.week < s!.week ? 'Done' : s!.current?.eventId === v.id ? 'Playing now'
        : c.ok ? (c.qual ? 'Qualifying' : v.week === s!.week ? 'Enter now' : 'Open') : c.why?.startsWith('You need') ? 'Open (save up)' : 'Locked';
      return `<tr class="${v.week === s!.week ? 'me' : ''}${v.week < s!.week && !h ? ' past' : ''}" data-detail="${v.id}" title="${e(c.ok || h ? '' : c.why ?? '')}">
        <td>${e(v.dates ?? `week ${v.week}`)}</td><td><b>${e(v.name)}</b></td><td><span class="c-tier ${v.tier.toLowerCase()}">${TIER_LABEL[v.tier]}</span></td>
        <td>${v.draw_size}</td><td>${e(v.city ? `${v.city}, ` : '')}${e(countryName(v.host_country))}</td><td>${money(prizeFor(v, 'W'))}</td><td>${status}</td></tr>`;
    }).join('');
    return `<table class="c-table c-list"><tr><th>Dates</th><th>Tournament</th><th>Level</th><th>Players</th><th>Host</th><th>Winner gets</th><th>Status</th></tr>${rows}</table>`;
  }
  function renderList() {
    if (getEdition() === 5) { tab = 'calendar'; render(); return; }
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">${s!.year} season · ${W().cal.length} tournaments</p><h3 class="c-title">All tournaments</h3>
      <p class="c-lead small">Click a tournament for its prizes and draw. ${getEdition() === 5 ? 'Every level is open: your world ranking decides if you go straight in, play qualifying, or miss out.' : 'Locked levels open when you reach a final at the level below, or climb the world ranking.'}</p>
      ${listTable()}
      <div class="c-cta"><button class="edit" data-ctab="hub">← Back</button></div></section>`;
  }
  /** 5.0: the Calendar tab: the season week by week, and the same as a list. */
  function renderCalendar() {
    const key = [['main', 'Main draw'], ['qual', 'Qualifying'], ['save', 'Save up'], ['out', 'Not in'], ['done', 'Your result']]
      .map(([k, l]) => `<span class="v5-ev-st st-${k}">${l}</span>`).join('');
    const tiers = ['S100', 'S300', 'S500', 'S750', 'S1000', 'WORLDS', 'OLYMPICS', 'WTF'].filter((x) => W().cal.some((v) => v.tier === x))
      .map((x) => `<span class="v5-ev-tier t-${x.toLowerCase()}"><i></i>${TIER_LABEL[x]}</span>`).join('');
    body.innerHTML = `<section class="v5-page"><header class="v5-page-head"><h3>${s!.year} season</h3><p>${W().cal.length} tournaments. Every level is open: your world ranking decides if you go straight in, play qualifying or miss out. Click one for its prizes, draw and travel plan.</p></header>
      <div class="v5-cal-key"><div>${tiers}</div><div>${key}</div></div>
      ${calendarGrid()}
      <details class="v5-cal-list"><summary>Show as a list</summary>${listTable()}</details></section>`;
  }
  /** 5.0: the Rivals tab: your three rivals, your meetings with them, and rival headlines. */
  function renderRivals() {
    const ids = rivalsOf(s!, W());
    const ranking = W().rankingAt(absWeek(s!.year, s!.week));
    const rank = (id: string) => { const i = ranking.findIndex((x) => x.id === id); return i < 0 || ranking[i].pts <= 0 ? 'Unranked' : `World #${i + 1}`; };
    const cards = ids.map((id) => {
      const c = characterById(id), [w, l] = headToHead(s!, id), fired = s!.rivalFire?.includes(id);
      const met = s!.history.flatMap((h) => (h.opponents ?? []).map((o, i) => (o === id ? { h, g: h.scores?.[i] ?? [] } : null)).filter((x): x is NonNullable<typeof x> => !!x));
      const meetings = met.slice(-4).reverse().map(({ h, g }) => {
        const won = g.filter(([a, b]) => a > b).length > g.filter(([a, b]) => b > a).length;
        return `<li class="${won ? 'won' : 'lost'}"><b>${won ? 'Won' : 'Lost'}</b><span>${e(findEvent(s!, h.tournamentId, d.appVersion)?.name ?? 'Club open')} ${h.year}</span><em>${g.map(([a, b]) => `${a}–${b}`).join(', ')}</em></li>`;
      }).join('');
      return `<article class="v5-rival-card${fired ? ' fired' : ''}" style="--rar:${RARITY[c.rarity].color}">
        <header><span class="rar">${RARITY[c.rarity].label}</span>${fired ? '<span class="v5-tag fire">Fired up</span>' : ''}</header>
        <b class="v5-rival-big">${e(c.name)}</b><p class="v5-rival-sub">${e(countryName(c.country))} · ${e(c.style)} · ${rank(id)}</p>
        <div class="v5-rival-score"><div><b class="${w > l ? 'up' : ''}">${w}</b><span>You</span></div><i>–</i><div><b class="${l > w ? 'down' : ''}">${l}</b><span>Them</span></div></div>
        ${meetings ? `<ul class="v5-meet">${meetings}</ul>` : '<p class="v5-foot">You haven’t met yet this career.</p>'}
      </article>`;
    }).join('');
    const news = (s!.news ?? []).filter((n) => n.kind === 'rival').slice(0, 6).map((n, i) => newsLi(n, i, true)).join('');
    body.innerHTML = `<section class="v5-page"><header class="v5-page-head"><h3>Rivals ${s!.year}</h3><p>Three players near your ranking, picked each season. Beat one for a bonus and a headline. Say something fiery at a press conference and they come back fired up. You have <b>${(s!.fans ?? 0).toLocaleString('en-GB')}</b> fans.</p></header>
      ${cards ? `<div class="v5-rival-cards">${cards}</div>` : '<p class="v5-empty-line">Your rivals are picked once you’re ranked.</p>'}
      ${news ? `<h4 class="v5-sub-h">Rival headlines</h4><ul class="v5-news">${news}</ul>` : ''}</section>`;
  }

  function renderDraw(id: string) {
    const x = findEvent(s!, id, d.appVersion);
    if (!x) return;
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">${TIER_LABEL[x.tier]} · week ${x.week}</p><h3 class="c-title">${e(x.name)}: the draw</h3>
      ${drawTable(x)}<div class="c-cta"><button class="edit" data-ctab="hub">← Back</button></div></section>`;
  }

  /** Before every career match: who you're about to play. */
  /** 4.1: the tactical analyst's notes on an opponent (from their stats and style). */
  function scouting(o: Character): string {
    const st = o.base_stats ?? o.stats, names = ['power', 'speed', 'net play', 'defence', 'stamina'];
    const lo = st.indexOf(Math.min(...st)), hi = st.indexOf(Math.max(...st));
    const side = o.handedness === 'left' ? 'their backhand (your left as you look)' : 'their backhand (your right as you look)';
    return `Strongest at ${names[hi]}, weakest at ${names[lo]}. Attack ${side}.${lo === 4 ? ' Make the rallies long: they tire.' : lo === 1 ? ' Move them corner to corner.' : lo === 2 ? ' Drop short and make them play at the net.' : lo === 3 ? ' Smash: their defence is the weak spot.' : ' Lift deep: their smash isn’t a big threat.'}`;
  }

  function renderPreMatch() {
    const x = ev(), nm = x && nextMatch(s!, W(), x);
    if (!x || !nm) return;
    const o = nm.opponent, me = characterById(s!.current!.as);
    const rankList = W().rankingAt(absWeek(s!.year, s!.week));
    const ri = rankList.findIndex((r) => r.id === o.id);
    const rank = ri >= 0 && rankList[ri].pts > 0 ? `#${ri + 1}` : 'Unranked';
    const style = STYLES[STYLE_AI[o.style]];
    const rows = statNames().map((l, i) => {
      const a = (o.base_stats ?? o.stats)[i], b = (me.base_stats ?? me.stats)[i];
      return `<tr><td>${l}</td><td><b>${a}</b></td><td>${b}</td><td class="${a > b ? 'down' : a < b ? 'up' : ''}">${a > b ? `+${a - b} them` : a < b ? `+${b - a} you` : 'even'}</td></tr>`;
    }).join('');
    const lk = eventLook(x.id, x.tier, x.host_country);
    body.innerHTML = `<section class="c-hero c-pre"><p class="c-kicker">${e(x.name)}${lk.poweredBy ? `, powered by ${e(lk.poweredBy.name)}` : ''} · ${roundName(nm)} · ${nm.games === 1 ? 'one game' : 'best of 3'} to 15 · ${e(lk.shuttle.name)} shuttles</p>
      <div class="c-pre-grid">
        <div class="c-pre-who">
          <h3 class="c-title">${e(o.name)}</h3>
          <span class="ccard" style="--rar:${RARITY[o.rarity].color}"><span class="rar">${RARITY[o.rarity].label}</span> ${e(countryName(o.country))} · ${o.handedness === 'left' ? 'left-handed' : 'right-handed'}</span>
          <div class="c-facts">${fact('World rank', rank)}${fact('Style', style.label)}${fact('Career strength', String(o.career_strength))}${fact('Plays like', `${LEVEL_LABEL[nm.level]} CPU`)}${fact('Kit', kitBrandOf(o.id).name)}</div>
          <p class="c-trait"><b>${e(style.label)}:</b> ${e(style.trait)}</p>
          ${s!.shop?.coach === 'tactical' || s!.shop?.coach === 'elite' ? `<p class="c-trait"><b>Scouting:</b> ${e(scouting(o))}</p>` : ''}
          ${o.abilities.length ? o.abilities.map((ab) => `<p class="ability"><span class="ab-tier t-${ab.tier}">${ab.tier === 'U' ? 'Ultra' : ab.tier}</span><b>${e(ab.name)}</b> ${e(SIGNATURES.get(ab.id)?.text ?? ab.text)}</p>`).join('') : '<p class="c-lead small">No signature ability.</p>'}
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
    for (const p of plan.slots) { const c = characterById(p); if (!p || c.id !== p || p === 'default_player') continue; byRarity.set(c.rarity, (byRarity.get(c.rarity) ?? 0) + 1); }
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

  /** 5.0 test: the squad is every player. Who you play as on top, then everyone by rarity. */
  let sqQ = '', sqRar = '', sqSort = 'rarity';
  function renderSquadV5() {
    const me = characterById(s!.characterId), names = statNames();
    const all = released.filter((c) => c.id !== DEFAULT_CHARACTER);
    const total = (c: Character) => c.stats.reduce((a, b) => a + b, 0);
    const sigOf = (c: Character) => c.abilities.find((a) => a.slot === 'signature');
    const tierTag = (tr: string) => (tr === 'U' ? 'Ultra' : tr);
    const meSig = me.abilities.map((ab) => `<p class="ability"><span class="ab-tier t-${ab.tier}">${tierTag(ab.tier)}</span><b>${e(ab.name)}</b> ${e(SIGNATURES.get(ab.id)?.text ?? ab.text)}</p>`).join('');
    body.innerHTML = `<section class="v5-page">
      <div class="v5-sq-me" style="--rar:${RARITY[me.rarity].color}"><canvas id="sqPent" class="v5-sq-pent" width="220" height="220"></canvas>
        <div class="v5-sq-info"><span class="v5-tag gold">Playing as</span><h3>${e(me.name)}</h3>
          <p class="v5-sq-line"><span class="rar">${RARITY[me.rarity].label}</span>${e(countryName(me.country))} · ${e(me.style)} · ${e(me.handedness)}-handed · total ${total(me)}</p>
          <div class="v5-sq-stats">${names.map((n, i) => `<div><span>${n}</span><b>${me.stats[i]}</b><i style="--w:${(me.stats[i] / 50) * 100}%"></i></div>`).join('')}</div>
          ${meSig || '<p class="v5-foot">No signature ability.</p>'}</div></div>
      <div class="v5-sq-tools"><input id="sqQ" class="mc-search" placeholder="Search ${all.length} players by name or country" value="${e(sqQ)}" autocomplete="off" spellcheck="false">
        <div class="v5-pick-rar"><button type="button" data-sqrar="" class="${sqRar ? '' : 'on'}">All</button>${[...new Set(all.map((c) => c.rarity))].sort((a, b) => RARITY[b].order - RARITY[a].order).map((r) => `<button type="button" data-sqrar="${r}" class="${sqRar === r ? 'on' : ''}" style="--rar:${RARITY[r].color}">${RARITY[r].label}</button>`).join('')}</div>
        <label class="v5-sq-sort">Sort <select id="sqSort">${[['rarity', 'Rarity'], ['total', 'Stat total'], ...names.map((n, i) => [`s${i}`, n])].map(([k, l]) => `<option value="${k}"${sqSort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      ${s!.current ? '<p class="v5-foot">You’re in a tournament: change player once it’s over.</p>' : '<p class="v5-foot">v5 test: every player is in your squad. Click one to play as them in your next tournament.</p>'}
      <div id="sqList"></div></section>`;
    const draw = () => {
      const list = all.filter((c) => (!sqRar || c.rarity === sqRar) && (!sqQ || c.name.toLowerCase().includes(sqQ) || countryName(c.country).toLowerCase().includes(sqQ)));
      const by = sqSort === 'rarity' ? null : sqSort === 'total' ? total : (c: Character) => c.stats[Number(sqSort.slice(1))];
      const cardOf = (c: Character) => {
        const sg = sigOf(c);
        return `<button class="v5-sq-card${c.id === me.id ? ' on' : ''}" data-pick="${c.id}" style="--rar:${RARITY[c.rarity].color}" ${s!.current ? 'disabled' : ''} title="${names.map((n, i) => `${n} ${c.stats[i]}`).join(' · ')}">
          <span class="v5-sq-top"><span class="rar">${RARITY[c.rarity].label}</span><span class="v5-sq-tot">${by && sqSort !== 'total' ? `${names[Number(sqSort.slice(1))]} ${by(c)}` : total(c)}</span></span>
          <b>${e(c.name)}</b><span class="v5-sq-sub">${e(c.country)} · ${e(c.style)}</span>
          <span class="v5-sq-bars">${c.stats.map((v, i) => `<i style="--h:${(v / 50) * 100}%" title="${names[i]} ${v}"></i>`).join('')}</span>
          ${sg ? `<span class="v5-pick-sig t-${sg.tier}">${tierTag(sg.tier)} · ${e(sg.name)}</span>` : '<span class="v5-pick-sig">No signature</span>'}</button>`;
      };
      let html = '';
      if (!by) {
        for (const r of [...new Set(list.map((c) => c.rarity))].sort((a, b) => RARITY[b].order - RARITY[a].order)) {
          const g = list.filter((c) => c.rarity === r).sort((a, b) => a.name.localeCompare(b.name));
          html += `<section class="v5-sq-group" style="--rar:${RARITY[r].color}"><h4>${RARITY[r].label}<span>${g.length}</span></h4><div class="v5-sq-grid">${g.map(cardOf).join('')}</div></section>`;
        }
      } else html = `<div class="v5-sq-grid">${[...list].sort((a, b) => by(b) - by(a) || a.name.localeCompare(b.name)).map(cardOf).join('')}</div>`;
      $('sqList').innerHTML = html || '<p class="v5-empty-line">No players match.</p>';
    };
    const q = $('sqQ') as HTMLInputElement;
    q.oninput = () => { sqQ = q.value.trim().toLowerCase(); draw(); };
    ($('sqSort') as HTMLSelectElement).onchange = (ev) => { sqSort = (ev.target as HTMLSelectElement).value; draw(); };
    body.querySelectorAll<HTMLElement>('[data-sqrar]').forEach((b) => { b.onclick = () => { sqRar = b.dataset.sqrar ?? ''; body.querySelectorAll('[data-sqrar]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }; });
    draw();
    void import('../pentagon').then(({ drawPentagon }) => drawPentagon($('sqPent') as HTMLCanvasElement, me.base_stats ?? me.stats, RARITY[me.rarity].color));
  }

  /** 3.19: borrow, see what you owe, pay it back. */
  function loanHtml() {
    const L = CFG.loan, ln = s!.loan;
    if (ln) return `<p class="c-lead">You owe <b>${money(ln.owed)}</b> (you borrowed ${money(ln.borrowed)}). ${Math.round(L.repayShare * 100)}% of every prize goes to it, and what’s left grows ${Math.round(L.seasonInterest * 100)}% each new season.</p>
      <div class="c-cta"><button class="edit" data-repay ${s!.money > 0 ? '' : 'disabled'}>Pay ${money(Math.min(ln.owed, Math.max(0, s!.money)))} now</button></div>`;
    return `<p class="c-lead">Borrow to pay your own way on tour. You pay back ${Math.round(L.fee * 100)}% more, ${Math.round(L.repayShare * 100)}% of every prize goes to it, and you can pay it off any time. The better your best world ranking, the more you can borrow (up to ${money(loanLimit(s!))} for you now). One loan at a time.</p>
      <div class="c-opts">${loanOptions(s!).map((a) => `<button class="c-opt" data-loan="${a}"><b>Borrow ${money(a)}</b><span>Pay back ${money(loanOwed(a))}</span></button>`).join('')}</div>`;
  }
  /** 4.4: the Sponsors page: your kit deal, main (perk) sponsor and money sponsor, and offers for each. */
  function renderSponsorsV5() {
    const rank = myRank(s!, W());
    const terms = (o: NonNullable<CareerState['sponsor']>) => [
      `${money(o.weekly)} a week`, `${money(o.bonus)} a title`,
      o.finalBonus ? `${money(o.finalBonus)} for every final, and their kit on your player` : '',
      o.perk ? `${perkText(o.perk)}${o.winBonus ? ` (${money(o.winBonus)})` : ''}` : o.slot === 'kit' ? '' : 'No perk: pays the most',
      o.home ? `Home brand: double pay in weeks you play in ${countryName(o.home)}` : '',
      o.request ? `Wants you at the ${o.request.name}: ${money(o.request.enter)} to play, ${money(o.request.deep)} for the quarter-finals` : '',
    ].filter(Boolean);
    const slots: [SponsorSlot, string, string][] = [
      ['kit', 'Kit deal', 'A badminton brand. Some money, a bonus for every final, and their name on your shirt.'],
      ['main', 'Main sponsor', 'A perk brand: little money, but cheaper flights, free hotels, cheaper loans, win bonuses or cheaper tournaments.'],
      ['cash', 'Money sponsor', 'Pays the most, with no perk.'],
    ];
    const ICON: Record<SponsorSlot, string> = {
      kit: '<path d="M8.5 4 4 6.5l1.8 4 2.2-.9V20h8V9.6l2.2.9 1.8-4L15.5 4a3.5 3.5 0 0 1-7 0z"/>',
      main: '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
      cash: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.4c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2s1.1 1.7 2.8 2.1 2.9.9 2.9 2.2-1.3 2.1-2.9 2.1c-1.4 0-2.5-.6-2.9-1.7M12 6.3v1.5M12 16.7v1.5"/>',
    };
    const html = slots.map(([slot, title, about]) => {
      const cur = sponsorIn(s!, slot), offers = sponsorUpgrade(s!, rank, d.appVersion, slot), req = cur?.request;
      return `<article class="v5-slot ${cur ? 'signed' : 'open'} slot-${slot}"><header><span class="v5-slot-ic">${icon(ICON[slot])}</span><div><h4>${title}</h4><p>${about}</p></div></header>
        ${cur ? `<div class="v5-deal"><span class="v5-tag green">Signed to the end of ${cur.year}</span><b class="v5-brand">${e(cur.name)}</b><ul class="v5-terms">${terms(cur).map((x) => `<li>${e(x)}</li>`).join('')}</ul>
          ${req ? `<p class="v5-foot">Their event: ${e(req.name)}. ${req.paid ? 'Done: quarter-finals bonus paid.' : req.entered ? 'Entered (bonus paid). Reach the quarter-finals for the big one.' : 'Not played yet.'}</p>` : ''}</div>`
          : `<div class="v5-open"><b>Open slot</b><span>${rank ? 'No offers yet. Better ones come as you climb.' : 'Offers start once you’re in the world top 200.'}</span></div>`}
        ${offers ? `<div class="v5-offers"><p class="v5-offers-h">${cur ? 'A better deal is on offer' : 'On offer'}</p>${offers.map((o, i) => `<button class="c-opt" data-sponsor="${slot}:${i}"><b>${e(o.name)}</b>${terms(o).map((x) => `<span>${e(x)}</span>`).join('')}</button>`).join('')}</div>` : ''}</article>`;
    }).join('');
    body.innerHTML = `<section class="c-hero v5-sponsors"><h3 class="c-title">Sponsors</h3><p class="c-lead">Up to three at once: a kit deal, a main sponsor with a perk, and a money sponsor. Deals run to the end of the season, and better ones come as you climb.</p><div class="v5-slots">${html}</div></section>`;
  }
  /** The Sponsors page: your sponsor and any offers (one sponsor; v5 has three slots). */
  function renderSponsors() {
    if (getEdition() === 5) { renderSponsorsV5(); return; }
    const rank = myRank(s!, W()), offers = sponsorUpgrade(s!, rank, d.appVersion), sp = s!.sponsor;
    const terms = (o: NonNullable<typeof sp>) => [
      `${money(o.weekly)} a week`, `${money(o.bonus)} a title`,
      o.perk ? `${perkText(o.perk)}${o.winBonus ? ` (${money(o.winBonus)})` : ''}` : 'No perk: pays the most',
      o.home ? `Home brand: double pay in weeks you play in ${countryName(o.home)}` : '',
      o.request ? `Wants you at the ${o.request.name}: ${money(o.request.enter)} to play, ${money(o.request.deep)} for the quarter-finals` : '',
    ].filter(Boolean);
    const req = sp?.request;
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">Sponsor</p>
      ${sp ? `<p class="c-lead"><b>${e(sp.name)}</b> until the end of ${sp.year}: ${terms(sp).map(e).join(' · ')}.</p>
        ${req ? `<p class="c-lead small">Their event: ${e(req.name)}. ${req.paid ? 'Done: quarter-finals bonus paid.' : req.entered ? 'Entered (bonus paid). Reach the quarter-finals for the big one.' : 'Not played yet.'}</p>` : ''}`
        : `<p class="c-lead">${rank ? 'No sponsor yet.' : 'No sponsor yet. Sponsors come to you once you’re in the world top 200, and better deals open as you climb.'}</p>`}
      ${offers ? `<p class="c-lead">${sp ? 'A better deal is on offer:' : 'Sponsors want you:'}</p><div class="c-opts">${offers.map((o, i) => `<button class="c-opt" data-sponsor="${i}"><b>${e(o.name)}</b>${terms(o).map((t) => `<span>${e(t)}</span>`).join('')}</button>`).join('')}</div>` : ''}
    </section>`;
  }
  /** 4.4: the Shop page. */
  function renderShop() {
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">Shop</p>${shopHtml()}</section>`;
    markShopSeen();
  }

  // 4.4: "New" on shop items you haven't seen yet (remembered on this computer).
  const seenKey = () => `badminton.shopSeen.${d.account()?.id ?? 'x'}`;
  const readSeen = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(seenKey()) ?? '[]') as string[]); } catch { return new Set(); } };
  const SHOP_KEYS = () => [
    ...Object.keys(CFG.coaches).map((k) => `coach:${k}`), ...Object.keys(CFG.extras).map((k) => `extra:${k}`), 'camp', 'base', 'house', 'racket',
    ...Object.keys(CFG.travelClass).map((k) => `class:${k}`), ...Object.keys(CFG.hotels).map((k) => `hotel:${k}`), ...Object.keys(CFG.walkOns).map((k) => `walkon:${k}`),
  ];
  const shopHasNew = () => { const seen = readSeen(); return SHOP_KEYS().some((k) => !seen.has(k)); };
  function markShopSeen() { try { localStorage.setItem(seenKey(), JSON.stringify(SHOP_KEYS())); } catch { /* storage blocked */ } }
  let seenNow = new Set<string>();
  const nw = (key: string) => (seenNow.has(key) ? '' : '<span class="c-new">New</span> ');

  /** 4.1: the shop: coach, staff, training, a base, houses, travel and hotel, your racket and walk-on. */
  function shopHtml() {
    seenNow = readSeen();
    const sh = s!.shop ?? {}, rank = myRank(s!, W());
    const coach = Object.entries(CFG.coaches).map(([k, c]) => {
      const on = sh.coach === k;
      return `<button class="c-opt${on ? ' on' : ''}" data-coach="${k}"><b>${nw(`coach:${k}`)}${e(c.label)}${on ? ' (hired)' : ''}</b><span>${money(c.wage)} a week</span><span>${e(c.perk)}</span><span>${on ? 'Click to let them go' : 'Click to hire (replaces your coach)'}</span></button>`;
    }).join('');
    const extras = Object.entries(CFG.extras).map(([k, c]) => {
      const on = !!sh[k as 'nutritionist'];
      return `<button class="c-opt${on ? ' on' : ''}" data-extra="${k}"><b>${nw(`extra:${k}`)}${e(c.label)}${on ? ' (hired)' : ''}</b><span>${money(c.wage)} a week</span><span>${e(c.perk)}</span></button>`;
    }).join('');
    const stats = statNames(), camps = sh.camps ?? [0, 0, 0, 0, 0], pts = sh.campPts ?? camps.map((n) => n * CFG.camp.points);
    const camp = stats.map((l, i) => `<button class="c-opt" data-camp="${i}" ${camps[i] >= CFG.camp.max || s!.current ? 'disabled' : ''}><b>${l} camp</b><span>${camps[i]} of ${CFG.camp.max} done · +${pts[i]} so far</span><span>${camps[i] >= CFG.camp.max ? '' : `Next: +${campGain(s!)} ${l}`}</span><span>${camps[i] >= CFG.camp.max ? 'Maxed out' : `${money(campCost(s!, i))} · takes the week`}</span></button>`).join('');
    const base = sh.base;
    const baseHtml = base
      ? `<p class="c-lead">Your training base in ${e(base.region)} is level ${base.level}: weeks off rest you ${CFG.base.restPerLevel * base.level}% more, and every training camp gives +${base.level * CFG.camp.basePerLevel} more and costs ${Math.round(CFG.camp.baseDiscount * 100)}% less.</p>${base.level < 3 ? `<div class="c-cta"><button class="edit" data-base="up">Upgrade to level ${base.level + 1} · ${money(CFG.base.upgrade[base.level - 1])}</button></div>` : ''}`
      : `<p class="c-lead">A base where you train: weeks off rest you more, training camps cost 70% less, and every camp gives +1 more per base level.</p><div class="c-cta"><button class="edit" data-base="buy">Build one in ${e(countryName(s!.homeCountry))} · ${money(CFG.base.buy)}</button></div>`;
    const hosts = [...new Set(W().cal.map((v) => v.host_country))].sort((a, b) => countryName(a).localeCompare(countryName(b)));
    const houses = hosts.map((c) => {
      const own = s!.houses?.includes(c);
      const n = W().cal.filter((v) => v.host_country === c).length;
      return `<button class="c-opt${own ? ' on' : ''}" data-house="${c}" ${own ? 'disabled' : ''}><b>${e(countryName(c))}</b><span>${own ? 'Yours' : money(houseCost(c, W().cal))}</span><span>${n} event${n === 1 ? '' : 's'} a season</span></button>`;
    }).join('');
    const cls = travelClassOfUi(), ho = s!.settings.hotel ?? 'three';
    const travel = (Object.keys(CFG.travelClass) as TravelClass[]).map((k) => `<button class="c-opt${cls === k ? ' on' : ''}" data-class="${k}"><b>${nw(`class:${k}`)}${CFG.travelClass[k].label}</b><span>${CFG.travelClass[k].cost}× the fare</span><span>${Math.round(CFG.travelClass[k].energySaved * 100)}% less tiring</span></button>`).join('');
    const hotels = (Object.keys(CFG.hotels) as HotelTier[]).map((k) => `<button class="c-opt${ho === k ? ' on' : ''}" data-hotel="${k}"><b>${nw(`hotel:${k}`)}${CFG.hotels[k].label}</b><span>${money(CFG.hotels[k].perNight)} a night (more in pricey cities)</span><span>+${CFG.rested.night[k]}% Rested a night</span></button>`).join('');
    const racket = sh.racket
      ? `<p class="c-lead">Your custom racket: <b style="color:${CFG.racketHex[sh.racket] ?? 'inherit'}">${e(sh.racket)}</b>. You use it in every career match.</p>`
      : `<div class="c-opts">${CFG.rackets.colours.map((c) => `<button class="c-opt" data-racket="${e(c)}"><b>${e(c)}</b><span>${money(CFG.rackets.cost)}</span></button>`).join('')}</div>`;
    const owned = sh.cosmetics ?? [], eq = sh.equipped?.walkon;
    const walk = Object.entries(CFG.walkOns).map(([k, w]) => {
      const have = owned.includes(`walkon:${k}`);
      return `<button class="c-opt${eq === k ? ' on' : ''}" data-walkon="${k}"><b>${nw(`walkon:${k}`)}${e(w.label)} walk-on</b><span>${have ? (eq === k ? 'Using it' : 'Click to use') : money(w.cost)}</span></button>`;
    }).join('');
    const wages = staffWages(s!), tc = teamCost(rank);
    return `<h3 class="c-title small">Your coach</h3><p class="c-lead small">One coach at a time. Every coach gives you notes after each match.</p><div class="c-opts">${coach}</div>
      <h3 class="c-title small">Staff</h3><div class="c-opts">${extras}</div>
      <p class="c-lead small">Staff wages: ${money(wages)} a week.${tc ? ` Team costs at your ranking: ${money(tc)} a week (they grow as you climb).` : ''}</p>
      <h3 class="c-title small">${nw('camp')}Training camps</h3><p class="c-lead small">A week away for +${CFG.camp.points} to a stat (more with a training base), up to ${CFG.camp.max} camps each. Each camp costs a bit more than the last.</p><div class="c-opts">${camp}</div>
      <h3 class="c-title small">${nw('base')}Training base</h3>${baseHtml}
      <h3 class="c-title small">${nw('house')}Houses</h3><p class="c-lead small">Own a house in a country and you sleep there at its events: no hotel bill, and +${CFG.rested.house}% Rested a night.</p><div class="c-opts">${houses}</div>
      <h3 class="c-title small">Flights</h3><div class="c-opts">${travel}</div>
      <h3 class="c-title small">Hotels</h3><div class="c-opts">${hotels}</div>
      <h3 class="c-title small">${nw('racket')}Custom racket</h3>${racket}
      <h3 class="c-title small">Walk-on look</h3><div class="c-opts">${walk}</div>`;
  }
  const travelClassOfUi = (): TravelClass => s!.settings.travelClass ?? 'economy';

  /** 5.0: what you won before the semi-fresh start, kept as legacy (it still counts for your ranking). */
  function legacyHtml(h: CareerState['history']) {
    const old = h.filter((x) => x.legacy);
    if (!old.length) return '';
    const titles = old.filter((x) => x.round === 'W' && x.tier !== 'CLUB'), byTier = new Map<string, number>();
    for (const t of titles) byTier.set(t.tier, (byTier.get(t.tier) ?? 0) + 1);
    return `<h3 class="c-title small">Legacy (before v5)</h3>
      <div class="c-facts">${fact('Titles', String(titles.length))}${fact('Events played', String(old.length))}${fact('Prize money', money(old.reduce((a, x) => a + x.prize, 0)))}</div>
      ${titles.length ? `<p class="c-lead small">${[...byTier].map(([t, n]) => `${n} × ${TIER_LABEL[t]}`).join(' · ')}</p>` : ''}`;
  }

  function renderTrophies() {
    const h = s!.history;
    const titles = h.filter((x) => x.round === 'W' && x.tier !== 'CLUB' && !x.legacy);
    const byTier = new Map<string, number>();
    for (const t of titles) byTier.set(t.tier, (byTier.get(t.tier) ?? 0) + 1);
    const medals = h.map((x) => ({ x, m: medalOf(x) })).filter((y) => y.m);
    const ms = milestones(s!);
    const hof = s!.hallOfFame ?? [];
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">Trophy cabinet</p>
      <div class="c-facts">${fact('Titles', String(s!.titles))}${fact('Best world ranking', s!.bestRank ? `#${s!.bestRank}` : '–')}${fact('Medals', medals.length ? medals.map((y) => (y.m === 'gold' ? '🥇' : y.m === 'silver' ? '🥈' : '🥉')).join('') : 'None yet')}${fact('Prize money won', money(h.reduce((t, x) => t + x.prize, 0)))}</div>
      ${titles.length ? `<p class="c-lead">${[...byTier].map(([t, n]) => `${n} × ${TIER_LABEL[t]}`).join(' · ')}</p><ul class="c-results">${titles.slice(-12).reverse().map((t) => `<li>🏆 ${t.year} ${e(calendar(d.appVersion, t.year).find((v) => v.id === t.tournamentId)?.name ?? 'Local Club Open')}</li>`).join('')}</ul>` : '<p class="c-lead">No titles yet.</p>'}
      ${medals.length ? `<ul class="c-results">${medals.map((y) => `<li>${y.m === 'gold' ? '🥇 Gold' : y.m === 'silver' ? '🥈 Silver' : '🥉 Bronze'}: ${y.x.tier === 'OLYMPICS' ? 'Olympic Games' : 'World Championships'} ${y.x.year}</li>`).join('')}</ul>` : ''}
      ${legacyHtml(h)}
      <h3 class="c-title small">Milestones · ${ms.filter((m) => m.done).length} of ${ms.length}</h3>
      <div class="c-miles">${ms.map((m) => `<span class="${m.done ? 'done' : ''}">${m.done ? '★' : '☆'} ${e(m.label)}</span>`).join('')}</div>
      <h3 class="c-title small">Hall of Fame</h3>
      ${hof.length ? `<table class="c-table"><tr><th>Player</th><th>Years</th><th>Titles</th><th>Best rank</th><th>Medals</th></tr>${hof.map((x) => `<tr><td>${x.number ? `<b class="c-retired">#${x.number}</b> ` : ''}${e(x.name)} <span class="sub">(as ${e(x.as)}${x.awards ? ` · ${x.awards} award${x.awards === 1 ? '' : 's'}` : ''}${x.fans ? ` · ${x.fans} fans` : ''})</span></td><td>${x.from}–${x.to}</td><td>${x.titles}</td><td>${x.bestRank ? `#${x.bestRank}` : '–'}</td><td>${'🥇'.repeat(x.golds)}${'🥈'.repeat(x.silvers)}${'🥉'.repeat(x.bronzes)}</td></tr>`).join('')}</table>` : '<p class="c-lead small">Retire a career to put it in the Hall of Fame.</p>'}
      ${s!.year > CFG.startYear && !s!.current ? `<div class="c-cta"><button class="edit" data-retire>Retire and enter the Hall of Fame</button></div>` : '<p class="c-lead small">You can retire after your first season.</p>'}
      </section>`;
  }

  function renderLedger() {
    const year = s!.ledger.filter((l) => l.year === s!.year);
    const inc = year.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0), out = year.filter((l) => l.amount < 0).reduce((t, l) => t + l.amount, 0);
    body.innerHTML = `<section class="c-hero"><p class="c-kicker">Tour loan</p>${loanHtml()}</section><div class="c-card"><h3>Money</h3><p>${s!.year} so far: income ${money(inc)}, costs ${money(-out)}, net ${money(inc + out)}.</p>
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
      
      <h3>Choose your player</h3><p class="sub">${getEdition() === 5 ? 'v5 test: every player is unlocked, so pick anyone and check how they play.' : 'Everyone starts as a Common player with no signature ability. Finish in the top 3 (or win the bigger events) to recruit stronger ones.'}</p>
      <div id="cStarters" class="c-squad"></div>
      <div class="c-actions"><button class="primary" id="cBegin" disabled>Start career</button></div></div>`;
    void fillStarters();
  }
  let starter: { id: string; free: boolean } | null = null;
  /** A retired career's Hall of Fame, carried into the next career. */
  let retiredHall: import('./state').HallEntry[] | null = null;
  /** 5.0 test: every player, with search and a rarity filter. */
  function fillAllPlayers() {
    const all = released.filter((c) => c.id !== DEFAULT_CHARACTER).sort((a, b) => RARITY[b.rarity].order - RARITY[a.rarity].order || a.name.localeCompare(b.name));
    const rars = [...new Set(all.map((c) => c.rarity))];
    let q = '', rar = '';
    const box = $('cStarters');
    box.classList.add('v5-allpick');
    box.innerHTML = `<div class="v5-pick-tools"><input id="cPickQ" class="mc-search" placeholder="Search ${all.length} players" autocomplete="off" spellcheck="false">
      <div class="v5-pick-rar"><button type="button" data-prar="" class="on">All</button>${rars.map((r) => `<button type="button" data-prar="${r}" style="--rar:${RARITY[r as Character['rarity']].color}">${RARITY[r as Character['rarity']].label}</button>`).join('')}</div></div><div id="cPickGrid" class="v5-pick-grid"></div>`;
    const draw = () => {
      const list = all.filter((c) => (!rar || c.rarity === rar) && (!q || c.name.toLowerCase().includes(q) || countryName(c.country).toLowerCase().includes(q)));
      $('cPickGrid').innerHTML = list.map((c) => {
        const sig = c.abilities.find((a) => a.slot === 'signature');
        return `<button data-starter="${c.id}" data-free="0" class="${starter?.id === c.id ? 'on' : ''}">${card(c, sig ? `<span class="v5-pick-sig t-${sig.tier}">${sig.tier === 'U' ? 'Ultra' : sig.tier} · ${e(sig.name)}</span>` : '')}</button>`;
      }).join('') || '<p class="sub">No players match.</p>';
    };
    box.oninput = (ev) => { if ((ev.target as HTMLElement).id === 'cPickQ') { q = (ev.target as HTMLInputElement).value.trim().toLowerCase(); draw(); } };
    box.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-prar]');
      if (!b) return;
      rar = b.dataset.prar ?? '';
      box.querySelectorAll('[data-prar]').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    };
    draw();
  }
  async function fillStarters() {
    if (getEdition() === 5) { if (!$('cPickGrid')) { starter = null; ($('cBegin') as HTMLButtonElement).disabled = true; fillAllPlayers(); } return; }
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
  /** 5.0: the end-of-season awards presentation (cards reveal one by one). */
  function awardsShow(y: number) {
    const a = s!.awards?.find((x) => x.year === y);
    if (!a) return '';
    return `<section class="c-awards"><p class="c-kicker">Awards night ${y}</p><div class="c-award-row">${a.list.map((x, i) => `<div class="c-award${x.you ? ' you' : ''}" style="animation-delay:${0.3 + i * 0.6}s"><span>${e(x.award)}</span><b>${e(x.winner)}</b><em>${e(x.note)}${x.you ? ' · +$2,000' : ''}</em></div>`).join('')}</div></section>`;
  }
  function renderRecap() {
    const y = s!.recap!;
    const hs = s!.history.filter((h) => h.year === y);
    const inc = s!.ledger.filter((l) => l.year === y && l.amount > 0).reduce((t, l) => t + l.amount, 0);
    const out = s!.ledger.filter((l) => l.year === y && l.amount < 0).reduce((t, l) => t + l.amount, 0);
    const endRank = myRank(s!, W(), absWeek(y, 52));
    head.innerHTML = `<p class="hero-kicker">Career</p><h2>${y} season</h2>`;
    body.innerHTML = `<div class="c-card"><h3>Your season</h3>
      <p>${hs.length} event${hs.length === 1 ? '' : 's'} · ${hs.filter((h) => h.round === 'W' && h.tier !== 'CLUB').length} title${hs.filter((h) => h.round === 'W' && h.tier !== 'CLUB').length === 1 ? '' : 's'} · finished ${endRank ? `ranked ${endRank}` : 'unranked'}</p>
      <p>Income ${money(inc)} · costs ${money(-out)} · net ${money(inc + out)}</p>
      <ul class="c-list">${hs.map((h) => `<li>${e(findEvent(s!, h.tournamentId, d.appVersion)?.name ?? 'Local Club Open')}: ${resultName(h)} (${h.points} points, ${money(h.prize)})</li>`).join('') || '<li>No events this season.</li>'}</ul>
      <div class="c-actions"><button class="primary" data-recapdone>On to ${y + 1}</button></div></div>${awardsShow(y)}`;
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
        ${c.abilities.map((ab) => `<p class="ability"><span class="ab-tier t-${ab.tier}">${ab.tier === 'U' ? 'Ultra' : ab.tier}</span><b>${e(ab.name)}</b> ${e(SIGNATURES.get(ab.id)?.text ?? ab.text)}</p>`).join('')}
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
  /** 4.5: a match left part-way, waiting for "Continue match" on the hub (career opens on its screen, not in the match). */
  let liveDue = false;
  const playIcon = () => icon('<path d="M4 12h15M13 6l6 6-6 6"/>');
  /** The hub's button for the next match: Continue match when one was left part-way. */
  const goBtn = (label: string, attr: string) => liveDue
    ? `<button class="walk" data-continue>Continue match ${playIcon()}</button>`
    : `<button class="walk" ${attr}>${label} ${playIcon()}</button>`;
  const liveNote = () => (liveDue ? '<p class="c-lead">You left this match part-way. Continue to carry on from the same score.</p>' : '');
  /** A match left part-way: with `play`, carry on with it now; without, just get it ready for Continue match
   * (a match that is already decided is finished either way). True if it took over the screen. */
  async function resumeLive(play = true): Promise<boolean> {
    liveDue = false;
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
      if (play) d.toast('Point to your opponent', 'You left in the middle of a rally.');
    }
    const over = mm.games[0] >= mm.gamesToWin || mm.games[1] >= mm.gamesToWin;
    if (over) {
      writeLive(null);
      delete a!.live;
      await finishMatch(x!, nm!.opponent.id, mm.games[0] > mm.games[1], mm.history.map((h) => [h[0], h[1]] as [number, number]));
      return true;
    }
    if (!play) { liveDue = true; return false; }
    d.toast('Match resumed', `${x!.name}, ${roundName(nm!).toLowerCase()}: carrying on from where you left.`);
    await playNext(mm.snapshot());
    return true;
  }

  const roundName = (nm: { round: Round; bronze?: boolean; qual?: 1 | 2 }) => (nm.qual ? `Qualifying round ${nm.qual}` : nm.bronze ? 'Bronze medal match' : ROUND_LABEL[nm.round]);
  const resultName = (h: { round: Round; place?: 3 | 4; qual?: 1 | 2 }) => (h.qual ? `Qualifying round ${h.qual}` : h.place === 3 ? '3rd place' : h.place === 4 ? '4th place' : ROUND_LABEL[h.round]);

  /** 5.0: an opponent you fired up at a press conference plays one CPU level higher. */
  const LEVELS_UP = (l: typeof LEVELS[number]) => LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(l) + 1)];

  /** 4.0: the walk-on for a career match: both players' numbers, their signature move, and your road to this round. */
  function careerWalkOn(x: TourEvent, nm: NextMatch): WalkOnInfo {
    const a = s!.current!, o = nm.opponent, me = characterById(a.as);
    const rankList = W().rankingAt(absWeek(s!.year, s!.week));
    const rankOf = (id: string) => { const i = rankList.findIndex((r) => r.id === id); return i >= 0 && rankList[i].pts > 0 ? `#${i + 1}` : '–'; };
    const mine = myRank(s!, W());
    // Every career match you've played, oldest first: [opponent, won].
    const played: [string, boolean][] = [];
    const add = (opps: string[] | undefined, scores: [number, number][][] | undefined) => (opps ?? []).forEach((id, i) => {
      const g = scores?.[i] ?? [];
      played.push([id, g.filter(([p, q]) => p > q).length > g.filter(([p, q]) => q > p).length]);
    });
    for (const h of s!.history) add(h.opponents, h.scores);
    add(a.opponents, a.scores);
    const form = played.slice(-5).map(([, w]) => (w ? 'W' : 'L')).join('');
    const h2h = played.filter(([id]) => id === o.id), h2hW = h2h.filter(([, w]) => w).length;
    const sig = o.abilities[0];
    const style = STYLES[STYLE_AI[o.style]];
    const mySig = me.abilities[0];
    // The road: qualifying, or the main-draw rounds with this one lit.
    let path: WalkOnStep[];
    if (nm.qual) path = [1, 2].map((q) => ({ label: `Qualifying ${q}`, state: q < nm.qual! ? 'won' : q === nm.qual ? 'now' : 'next' } as WalkOnStep)).concat([{ label: 'Main draw', state: 'next' }]);
    else {
      const order = roundsFor(x.draw_size);
      path = order.map((r, i): WalkOnStep => {
        if (i < a.opponents.length) {
          const sc = a.scores[i]?.map(([p, q]) => `${p}–${q}`).join(', ');
          return { label: ROUND_LABEL[r], detail: `${characterById(a.opponents[i]).name.split(' ').pop()} ${sc ?? ''}`.trim(), state: 'won' };
        }
        return { label: a.bronze && r === 'F' ? 'Bronze match' : ROUND_LABEL[r], state: r === a.round && !a.bronze ? 'now' : a.bronze && r === 'F' ? 'now' : 'next' };
      });
      path.push({ label: 'Champion', state: 'next' });
    }
    return {
      theme: s!.shop?.equipped?.walkon || undefined,
      event: x.name, round: roundName(nm),
      me: {
        name: s!.name, line: `World ${mine ? `#${mine}` : 'unranked'} · ${me.name}`,
        stats: [[mine ? `#${mine}` : '–', 'World rank'], [form ? `form:${form}` : '–', 'Last 5'], [h2h.length ? `${h2hW}–${h2h.length - h2hW}` : '0–0', 'Head to head'], [`${Math.round(s!.energy)}%`, `Rested · ${restedTier(s!.energy).label}`]],
        move: mySig ? { kicker: 'Your signature move', name: mySig.name, text: SIGNATURES.get(mySig.id)?.text ?? mySig.text } : undefined,
      },
      them: {
        name: o.name, line: `${getEdition() === 5 && s!.rivals?.ids.includes(o.id) ? 'RIVAL · ' : ''}${countryName(o.country)} · ${RARITY[o.rarity].label}`,
        stats: [[rankOf(o.id), 'World rank'], [String(o.career_strength), 'Strength'], [style.label, 'Style'], [`${opponentRested(s!, x, a.round, o.id)}%`, `Rested · ${restedTier(opponentRested(s!, x, a.round, o.id)).label}`]],
        move: sig ? { kicker: 'Signature move', name: sig.name, text: SIGNATURES.get(sig.id)?.text ?? sig.text } : { kicker: 'Plays like', name: style.label, text: style.trait },
      },
      path,
    };
  }

  /** 4.1: your coach's notes after a match (only with a coach). */
  function coachNotes(g: Game, won: boolean): { title: string; text: string } | null {
    const k = s!.shop?.coach;
    if (!k) return null;
    const me = g.stats.summary(0), them = g.stats.summary(1), hist = g.match.history;
    const lines: string[] = [];
    if (me.unforced >= 8) lines.push(`${me.unforced} unforced errors: play safer to the middle when you’re under pressure.`);
    else if (me.unforced <= 3) lines.push(`Only ${me.unforced} unforced errors. Very solid.`);
    if (me.winners >= 8) lines.push(`${me.winners} winners: your attacking was excellent.`);
    else if (me.winners <= 3 && !won) lines.push('Too few winners: look for the smash on anything short.');
    if (me.smashWinners >= 3) lines.push(`Your smash won ${me.smashWinners} points.`);
    if (them.winners > me.winners + 4) lines.push('They hit through you too often: recover to the middle sooner.');
    if (hist.length >= 3) { const [p, q] = hist[2]; lines.push(p > q ? 'Strong finish in the third game.' : 'You faded in the third game.'); }
    const r = Math.round(s!.energy);
    if (r < 55) lines.push(`You’re ${r}% rested now. A better hotel, a better seat or a week off would help.`);
    if (!lines.length) lines.push(won ? 'A clean win. Keep it up.' : 'Close one. Nothing big to fix: keep going.');
    return { title: `${CFG.coaches[k]?.label ?? 'Coach'}’s notes`, text: lines.slice(0, 3).join(' ') };
  }

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
      walkOn: resume ? undefined : careerWalkOn(x, nm),
      setup: {
        mode: 'career', format: { games: nm.games, points: nm.points }, label: `${x.name} · ${roundName(nm)}`,
        player: { characterId: a.as, modifiers: [coachModifier(s!), restedModifier(s!.energy, a.bronze ? 'bronze' : nm.qual ? undefined : a.round), shopModifier(s!)], abilities: true, kitBrand: getEdition() === 5 ? s!.kitSponsor?.brandId : undefined },
        opponent: { kind: 'cpu', characterId: opp.id, cpuLevel: getEdition() === 5 && s!.rivalFire?.includes(opp.id) ? LEVELS_UP(nm.level) : nm.level, style: STYLE_AI[opp.style], abilities: true, modifiers: [restedModifier(opponentRested(s!, x, a.round, opp.id), a.bronze ? 'bronze' : nm.qual ? undefined : a.round)] },
        restrictions: {}, resume, look: eventLook(x.id, x.tier, x.host_country), // 4.2.1: the boards are the event's own (local) sponsors, never yours
        checkpoint: (snap, rally) => { live.snap = snap; live.rally = rally; writeLive(live); },
      },
      settings: { opponent: nm.level, style: STYLE_AI[opp.style], games: nm.games, points: nm.points, event: 'singles', ...(s!.shop?.racket ? { racket: CFG.racketHex[s!.shop.racket] } : {}) },
      onLeave: async () => {
        // Saved to your account too, so it carries on from another computer. Career stays shut until you resume.
        if (live.snap) { s!.current!.live = { ...live }; await save(); }
        d.toast('Match saved', 'Open career mode to carry on from this score.');
      },
      onDone: async (g, retired) => {
        writeLive(null);
        const won = !retired && (g.forfeitWinner ?? (g.match.games[0] > g.match.games[1] ? 0 : 1)) === 0;
        const notes = coachNotes(g, won);
        await finishMatch(x, opp.id, won, g.match.history.map((h) => [h[0], h[1]] as [number, number]), g.stats.shots.length);
        if (notes) d.toast(notes.title, notes.text);
      },
    });
  }

  /** Record a finished career match and show what it did (ranking, prizes, injuries). */
  async function finishMatch(x: TourEvent, oppId: string, won: boolean, games: [number, number][], shots?: number) {
    if (s!.current) delete s!.current.live;
    const before = myRank(s!, W());
    // 4.1: tiredness from this match (its length; a resumed match is estimated from its points).
    const pts = games.reduce((n, [p, q]) => n + p + q, 0);
    const drain = matchDrain(shots ?? pts * 7, games, 15, s!);
    const r = recordMatch(s!, W(), x, won, games, oppId, drain);
    if (getEdition() === 5 && x.tier !== 'CLUB') pressDue = { won, opp: oppId, event: x.name };
    if (s!.rivalFire?.includes(oppId)) s!.rivalFire = s!.rivalFire.filter((id) => id !== oppId);
    d.saveStats({ career_matches: 1, career_wins: won ? 1 : 0 });
    if (r.finished && r.result) {
      // Club opens aren't titles: nothing goes on your account for them.
      if (r.result.round === 'W' && x.tier !== 'CLUB') { const t = titleTierOf(x.tier); d.saveStats(t ? { career_titles: 1, [t.key]: 1 } : { career_titles: 1 }); }
      d.saveStats({ career_prize: r.result.prize });
    }
    await save();
    const after = myRank(s!, W());
    if (after && (!s!.bestRank || after < s!.bestRank)) { s!.bestRank = after; d.saveStats({ max_career_best_rank: 1000 - after }); await save(); }
    panel.classList.remove('hidden');
    if (r.injured) d.toast(`Injured: out for ${r.injured} weeks`, 'You played too tired. Rest up: you can’t enter events until it heals.');
    for (const m of newMilestones(s!)) d.toast(`Milestone: ${m.label}`, 'See it in Trophies.');
    await save();
    if (r.qualified) d.toast(`Through to the ${x.name}!`, 'You came through qualifying. The event pays your travel and hotel from here.');
    else if (!r.finished && s!.current?.qual) d.toast('Qualifying round 1 won', 'One more win and you’re in the main draw.');
    if (r.finished && r.result?.qual) {
      d.toast(`Out in qualifying at the ${x.name}`, `${r.result.points} ranking points${after ? ` · world ranking ${after}` : ''}`);
      render();
      return;
    }
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
    { target: '[data-ctab="ledger"]', title: 'Money, sponsors and the shop', text: 'Every cost and prize, your sponsor (real brands: some pay the most, some give perks like cheaper flights, home brands pay double at home events), and the shop: coaches, staff, training camps, houses, flights and hotels.' },
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
    // 4.2.2: in the middle of a match: you can look (tabs, draws, event details), not play or buy.
    if (viewOnly) {
      const lookOnly = at('[data-draw], [data-detail], [data-drawsec], [data-list], [data-pickev]');
      if (!lookOnly) { if (at('button')) d.toast('You’re in a match', 'Finish or leave your match to do that. Press Esc to go back to it.'); return; }
    }
    if (!s) {
      const st = at('[data-starter]');
      if (st) { starter = { id: st.dataset.starter!, free: st.dataset.free === '1' }; body.querySelectorAll('[data-starter]').forEach((b) => b.classList.toggle('on', b === st)); ($('cBegin') as HTMLButtonElement).disabled = false; return; }
      if (t.id === 'cBegin') { void begin(); }
      if (t.closest('[data-carry]')) {
        const m = await d.loadAccount(), old = migrate(await m.career5Seed());
        if (!old) { d.toast('No career to bring over', 'Start a new one below instead.'); return; }
        s = semiFreshStart(old); fresh(); await save(); render(); d.toast('Career brought over', `Your squad, ranking and ${money(s.money)} are in v5.`); return;
      }
      return;
    }
    if (busy) return;
    const sec = at('[data-drawsec]');
    if (sec) {
      const box = sec.closest('.c-card, section, #careerBody') ?? body;
      box.querySelectorAll<HTMLElement>('[data-drawsec]').forEach((b) => b.classList.toggle('on', b === sec));
      box.querySelectorAll<HTMLElement>('[data-drawview]').forEach((v) => { v.hidden = v.dataset.drawview !== sec.dataset.drawsec; });
      return;
    }
    const dr = at('[data-draw]')?.dataset.draw;
    if (dr) { renderDraw(dr); return; }
    const det = at('[data-detail]')?.dataset.detail;
    if (det) { renderDetail(det); return; }
    const en = at('[data-enter]')?.dataset.enter;
    if (en) {
      const x = findEvent(s, en, d.appVersion);
      if (!x || !canEnter(s, x, W()).ok) return;
      if (s.pendingRecruitOffer) { const m = await d.loadAccount(); await m.offerChoose(s.pendingRecruitOffer.id, null); s.pendingRecruitOffer = null; }
      enter(s, x, W()); if (!s.current?.qual) skipByes(s, W(), x); await save(); render(); return;
    }
    if (at('[data-club]')) { enter(s, clubEvent(s)); await save(); render(); return; }
    const ln = at('[data-loan]')?.dataset.loan;
    if (ln) { const amt = Number(ln); if (confirm(`Borrow ${money(amt)}? You’ll owe ${money(loanOwed(amt))}, and ${Math.round(CFG.loan.repayShare * 100)}% of every prize goes to paying it back.`) && takeLoan(s, amt)) { d.toast(`Borrowed ${money(amt)}`, `You owe ${money(loanOwed(amt))}.`); await save(); render(); } return; }
    if (at('[data-repay]')) { repayLoan(s); d.toast(s.loan ? `You still owe ${money(s.loan.owed)}` : 'Loan paid off', ''); await save(); render(); return; }
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
    const pr = at('[data-press]')?.dataset.press;
    if (pr && pressDue) { pressAnswer(s, pressDue.won, pr, pressDue.opp); d.toast('Press conference done', `${s.fans ?? 0} fans now.`); pressDue = null; await save(); render(); return; }
    const co = at('[data-coach]')?.dataset.coach;
    if (co) { const sh = (s.shop ??= {}); sh.coach = sh.coach === co ? null : co; if (s.staff) s.staff.coach = false; await save(); render(); return; }
    const ex = at('[data-extra]')?.dataset.extra as 'nutritionist' | 'psychologist' | 'stringing' | undefined;
    if (ex) { const sh = (s.shop ??= {}); sh[ex] = !sh[ex]; await save(); render(); return; }
    const cp = at('[data-camp]')?.dataset.camp;
    if (cp !== undefined) { const i = Number(cp), campGainBefore = campGain(s); if (trainingCamp(s, i, d.appVersion)) d.toast('Training camp done', `+${campGainBefore} ${statNames()[i]}. A week has passed.`); else d.toast('Can’t do that camp', 'Not enough money, or you’re in a tournament.'); await save(); render(); return; }
    const bs = at('[data-base]')?.dataset.base;
    if (bs) {
      const sh = (s.shop ??= {});
      if (bs === 'buy' && !sh.base && buy(s, 'Training base', CFG.base.buy)) sh.base = { region: countryName(s.homeCountry), level: 1 };
      else if (bs === 'up' && sh.base && sh.base.level < 3 && buy(s, 'Training base upgrade', CFG.base.upgrade[sh.base.level - 1])) sh.base.level++;
      else d.toast('Not enough money', '');
      await save(); render(); return;
    }
    const hs = at('[data-house]')?.dataset.house;
    if (hs) { if (confirm(`Buy a house in ${countryName(hs)} for ${money(houseCost(hs, W().cal))}?`) && buy(s, `House in ${countryName(hs)}`, houseCost(hs, W().cal))) { (s.houses ??= []).push(hs); d.toast(`Your house in ${countryName(hs)}`, 'Free nights and better rest at events there.'); } await save(); render(); return; }
    const rk = at('[data-racket]')?.dataset.racket;
    if (rk) { if (buy(s, 'Custom racket', CFG.rackets.cost)) (s.shop ??= {}).racket = rk; else d.toast('Not enough money', ''); await save(); render(); return; }
    const wo = at('[data-walkon]')?.dataset.walkon;
    if (wo) {
      const sh = (s.shop ??= {}), have = (sh.cosmetics ??= []);
      if (!have.includes(`walkon:${wo}`)) { if (!buy(s, `${CFG.walkOns[wo].label} walk-on`, CFG.walkOns[wo].cost)) { d.toast('Not enough money', ''); return; } have.push(`walkon:${wo}`); }
      (sh.equipped ??= {}).walkon = sh.equipped.walkon === wo ? '' : wo;
      await save(); render(); return;
    }
    const stf = at('[data-staff]')?.dataset.staff as StaffRole | undefined;
    if (stf) { setStaff(s, stf, !s.staff?.[stf]); await save(); render(); return; }
    const spn = at('[data-sponsor]')?.dataset.sponsor;
    if (spn !== undefined) { const [slot, idx] = spn.includes(':') ? spn.split(':') as [SponsorSlot, string] : ['main' as SponsorSlot, spn]; const offers = sponsorUpgrade(s, myRank(s, W()), d.appVersion, slot); const o = offers?.[Number(idx)]; if (o) { signSponsor(s, o); d.toast(`Signed with ${o.name}`, `${money(o.weekly)} a week and ${money(o.bonus)} a title.`); await save(); render(); } return; }
    if (at('[data-retire]')) {
      if (!confirm('Retire? This career goes into the Hall of Fame and you start a new one. Players you recruited stay on your account.')) return;
      // 5.0 (v5): retire your shirt number too.
      const num = getEdition() === 5 ? Math.max(1, Math.min(99, Math.round(Number(prompt('Which shirt number do you retire? (1–99)', '7')) || 7))) : undefined;
      retiredHall = retire(s, num); s = null; render(); return;
    }
    const rf = at('[data-refuel]')?.dataset.refuel as 'food' | 'physio' | undefined;
    if (rf) return;
    if (at('[data-playnext]')) { renderPreMatch(); return; }
    if (at('[data-continue]')) { if (!(await resumeLive(true))) render(); return; }
    if (at('[data-startmatch]')) { void playNext(); return; }
    if (at('[data-withdraw]')) { if (!confirm('Withdraw from this tournament? You keep any prize and points from rounds you’ve already won.')) return; liveDue = false; writeLive(null); if (s.current) delete s.current.live; withdraw(s, W(), ev()!); await save(); render(); return; }
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
