// Career stats: added up after every finished match (against the CPU or online). Saved to your
// account when you're logged in, and on this computer either way.
import type { Game } from './game';

/**
 * Keys starting max_ keep the best value, now_ replace the old value, everything else adds up.
 * The database applies the same rule (supabase/schema.sql, add_career).
 */
export type Career = Record<string, number>;

/** What this finished match adds to your career. prev is your career so far (for streaks). */
export function careerDelta(g: Game, prev: Career): Career {
  const st = g.stats, m = g.match;
  const won = (g.forfeitWinner ?? (m.games[0] > m.games[1] ? 0 : 1)) === 0;
  const mine = st.shots.filter((s) => s.by === 0 && (!g.doubles || s.pid === g.players[0].id));
  const smashes = mine.filter((s) => /smash/i.test(s.label));
  const rallies = st.rallies;
  const myWinners = rallies.filter((r) => r.kind === 'winner' && r.hitter === 0);
  const myErrors = rallies.filter((r) => r.kind === 'error' && r.hitter === 0);
  const streak = won ? (prev.now_streak ?? 0) + 1 : 0;
  return {
    matches: 1,
    wins: won ? 1 : 0,
    losses: won ? 0 : 1,
    cpu_matches: g.online ? 0 : 1,
    online_matches: g.online && !g.online.ranked ? 1 : 0,
    ranked_matches: g.online?.ranked ? 1 : 0,
    doubles_matches: g.doubles ? 1 : 0,
    doubles_wins: g.doubles && won ? 1 : 0,
    games_won: m.games[0],
    games_lost: m.games[1],
    points_won: rallies.filter((r) => r.winner === 0).length,
    points_lost: rallies.filter((r) => r.winner === 1).length,
    rallies: rallies.length,
    shots: mine.length,
    winners: myWinners.length,
    aces: myWinners.filter((r) => r.lastHand === 'serve').length,
    unforced_errors: myErrors.filter((r) => !r.forced).length,
    forced_errors: myErrors.filter((r) => r.forced).length,
    smashes: smashes.length,
    jump_smashes: mine.filter((s) => /Jump smash/.test(s.label)).length,
    perfect_jumps: st.you.perfectJumps,
    net_kills: mine.filter((s) => /Net kill/.test(s.label)).length,
    drops: mine.filter((s) => /Drop/.test(s.label)).length,
    clears: mine.filter((s) => /Clear/.test(s.label)).length,
    net_shots: mine.filter((s) => /Net shot/.test(s.label)).length,
    smash_winners: myWinners.filter((r) => /smash/i.test(r.lastLabel)).length,
    backhand_winners: myWinners.filter((r) => r.lastHand === 'backhand').length,
    hits: st.you.hits,
    perfect_hits: st.you.perfect,
    challenges: st.challenges[0].made,
    challenges_won: st.challenges[0].won,
    seconds: Math.round(st.seconds),
    max_smash: Math.round(smashes.reduce((a, s) => Math.max(a, s.speedKmh), 0)),
    max_rally: st.longestRally,
    max_streak: streak,
    now_streak: streak,
    // Wins and losses with the player (character) you used.
    [`char_wins_${g.setup.player.characterId}`]: won ? 1 : 0,
    [`char_losses_${g.setup.player.characterId}`]: won ? 0 : 1,
  };
}

/** Apply a match's numbers to a career, with the same rules as the database. */
export function addCareer(cur: Career, delta: Career): Career {
  const out = { ...cur };
  for (const [k, v] of Object.entries(delta)) {
    if (!Number.isFinite(v)) continue;
    out[k] = k.startsWith('max_') ? Math.max(out[k] ?? 0, v) : k.startsWith('now_') ? v : (out[k] ?? 0) + v;
  }
  return out;
}

const LOCAL = 'badminton.career';
export function loadLocalCareer(): Career {
  try { return JSON.parse(localStorage.getItem(LOCAL) ?? '{}'); } catch { return {}; }
}
export function saveLocalCareer(c: Career) {
  try { localStorage.setItem(LOCAL, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const num = (v: number | undefined) => (v ? v.toLocaleString('en-GB') : '0');
const minutes = (s: number | undefined) => {
  const m = Math.round((s ?? 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export interface StatTile { label: string; value: string; hint?: string; big?: boolean }

/** The stats screen, in groups. */
export function statGroups(c: Career): { title: string; tiles: StatTile[] }[] {
  const g = (k: string) => c[k] ?? 0;
  return [
    {
      title: 'Highlights',
      tiles: [
        { label: 'Fastest smash', value: g('max_smash') ? `${g('max_smash')} km/h` : '–', big: true },
        { label: 'Longest rally', value: g('max_rally') ? `${g('max_rally')} shots` : '–', big: true },
        { label: 'Best win streak', value: num(g('max_streak')), hint: `Current streak: ${num(g('now_streak'))}`, big: true },
      ],
    },
    {
      title: 'Matches',
      tiles: [
        { label: 'Played', value: num(g('matches')) },
        { label: 'Won', value: num(g('wins')) },
        { label: 'Win rate', value: pct(g('wins'), g('matches')), hint: 'All matches, CPU and online' },
        { label: 'Games won', value: `${num(g('games_won'))}–${num(g('games_lost'))}` },
        { label: 'Vs CPU', value: num(g('cpu_matches')) },
        { label: 'Online', value: num(g('online_matches')) },
        { label: 'Ranked', value: num(g('ranked_matches')) },
        { label: 'Doubles', value: num(g('doubles_matches')), hint: `${num(g('doubles_wins'))} won` },
        { label: 'Time on court', value: minutes(g('seconds')) },
      ],
    },
    {
      title: 'Attack',
      tiles: [
        { label: 'Winners', value: num(g('winners')) },
        { label: 'Smashes', value: num(g('smashes')) },
        { label: 'Smash winners', value: num(g('smash_winners')) },
        { label: 'Jump smashes', value: num(g('jump_smashes')) },
        { label: 'Perfect jumps', value: num(g('perfect_jumps')) },
        { label: 'Net kills', value: num(g('net_kills')) },
        { label: 'Aces', value: num(g('aces')) },
        { label: 'Backhand winners', value: num(g('backhand_winners')) },
      ],
    },
    {
      title: 'Rallies and accuracy',
      tiles: [
        { label: 'Points won', value: num(g('points_won')), hint: `of ${num(g('points_won') + g('points_lost'))}` },
        { label: 'Point win rate', value: pct(g('points_won'), g('points_won') + g('points_lost')) },
        { label: 'Shots played', value: num(g('shots')) },
        { label: 'Perfect timing', value: pct(g('perfect_hits'), g('hits')), hint: `${num(g('perfect_hits'))} perfect hits` },
        { label: 'Unforced errors', value: num(g('unforced_errors')) },
        { label: 'Forced errors', value: num(g('forced_errors')) },
        { label: 'Drops', value: num(g('drops')) },
        { label: 'Clears', value: num(g('clears')) },
        { label: 'Net shots', value: num(g('net_shots')) },
      ],
    },
    {
      title: 'Hawk-Eye',
      tiles: [
        { label: 'Challenges', value: num(g('challenges')) },
        { label: 'Overturned', value: num(g('challenges_won')) },
        { label: 'Success rate', value: pct(g('challenges_won'), g('challenges')) },
      ],
    },
  ];
}

export interface Evaluation { ready: boolean; strengths: string[]; weaknesses: string[]; tip: string }

/**
 * Your game in plain words, from your career stats: what you do well, what to work on, and one thing
 * to try. weakZone: where the CPU has found you struggle most (from its memory), if it knows.
 */
export function evaluate(c: Career, weakZone: string | null): Evaluation {
  const g = (k: string) => c[k] ?? 0;
  const hits = g('hits'), points = g('points_won') + g('points_lost');
  if (g('matches') < 2 || hits < 60) {
    return { ready: false, strengths: [], weaknesses: [], tip: 'Finish a couple of matches and your evaluation appears here.' };
  }
  const S: { score: number; text: string }[] = [], W: { score: number; text: string; tip?: string }[] = [];
  const rate = (a: number, b: number) => (b ? a / b : 0);
  const timing = rate(g('perfect_hits'), hits);
  if (timing >= 0.4) S.push({ score: timing, text: `Clean timing: ${Math.round(100 * timing)}% of your hits are perfect` });
  else if (timing < 0.2) W.push({ score: 0.4 - timing, text: `Timing: only ${Math.round(100 * timing)}% of hits are perfect. Try swinging a fraction later`, tip: 'a practice drill (Court 5) with the timing light on' });
  if (g('max_smash') >= 280) S.push({ score: 0.6, text: `A big smash (${g('max_smash')} km/h at best)` });
  const finish = rate(g('smash_winners'), g('smashes'));
  if (g('smashes') >= 15 && finish >= 0.25) S.push({ score: finish + 0.2, text: `Your smashes finish points (${Math.round(100 * finish)}% are winners)` });
  else if (g('smashes') >= 15 && finish < 0.1) W.push({ score: 0.3, text: 'Smashes rarely win the point: aim for the body or the sidelines, not the middle', tip: 'the Smash drill in Practice (Court 5)' });
  const unforced = rate(g('unforced_errors'), g('points_lost'));
  if (g('points_lost') >= 20 && unforced > 0.5) W.push({ score: unforced, text: `Unforced errors: ${Math.round(100 * unforced)}% of the points you lose are your own mistakes`, tip: 'aiming half a metre inside the lines, and the Deep clears challenge to groove a safe shot' });
  const ratio = rate(g('winners'), g('unforced_errors'));
  if (g('winners') >= 15 && ratio >= 1.3) S.push({ score: Math.min(1, ratio / 3), text: 'More winners than unforced errors: you take the right risks' });
  const pointRate = rate(g('points_won'), points);
  if (points >= 40 && pointRate >= 0.55) S.push({ score: pointRate, text: `You win ${Math.round(100 * pointRate)}% of points` });
  if (g('aces') >= Math.max(3, g('matches'))) S.push({ score: 0.45, text: `A dangerous serve (${g('aces')} aces)` });
  if (g('net_kills') >= 10) S.push({ score: 0.5, text: `Sharp at the net (${g('net_kills')} net kills)` });
  if (g('backhand_winners') >= 5) S.push({ score: 0.4, text: 'A backhand that wins points' });
  const attack = g('smashes') + g('drops') + g('clears');
  if (attack >= 40 && rate(g('drops'), attack) < 0.1) W.push({ score: 0.35, text: 'You hardly use the drop: mix it in so smashes and clears are harder to read', tip: 'the Clear & drop drill in Practice (Court 5)' });
  if (attack >= 40 && rate(g('smashes'), attack) > 0.6) W.push({ score: 0.3, text: 'Mostly smashes: easy to read. Vary with drops and clears', tip: 'the Clear & drop drill in Practice (Court 5)' });
  if (g('net_shots') < g('matches') * 3) W.push({ score: 0.2, text: 'You rarely play net shots: a tight net shot forces a lift you can attack', tip: 'the Net play drill in Practice (Court 5)' });
  if (weakZone) W.push({ score: 0.5, text: `The CPU has noticed you struggle with shots to your ${weakZone}`, tip: `moving back to your base after every shot, and the Mixed drill in Practice (Court 5)` });
  const challenges = g('challenges');
  if (challenges >= 5 && rate(g('challenges_won'), challenges) >= 0.5) S.push({ score: 0.3, text: 'A good eye for line calls' });
  S.sort((a, b) => b.score - a.score);
  W.sort((a, b) => b.score - a.score);
  const strengths = S.slice(0, 3).map((x) => x.text), weaknesses = W.slice(0, 3).map((x) => x.text);
  const tip = W[0]?.tip ? `Try this next: ${W[0].tip}.` : 'No big weaknesses yet. Try a harder CPU or a new personality.';
  return { ready: true, strengths: strengths.length ? strengths : ['Still finding your strengths: keep playing'], weaknesses, tip };
}
