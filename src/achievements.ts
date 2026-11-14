// Achievements: one-off milestones, checked after every match. Unlocked ones are kept on
// this computer and, when logged in, added to your career (max_ach_<id> = 1) for the leaderboard.
import type { Career } from './career';

/** What a finished match showed (only the parts achievements care about). */
export interface MatchFacts {
  won: boolean;
  online: boolean;
  /** The CPU level you played, or null online. */
  level: string | null;
  jumpSmashWinner: boolean;
  /** Won a game after being this many points down in it (0 if never). */
  comeback: number;
  /** Won a game without losing a point. */
  loveGame: boolean;
}

export interface Achievement { id: string; name: string; desc: string; done: (c: Career, m: MatchFacts | null) => boolean }

const beat = (level: string) => (_: Career, m: MatchFacts | null) => !!m?.won && !m.online && m.level === level;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_win', name: 'Off the mark', desc: 'Win your first match', done: (c) => (c.wins ?? 0) >= 1 },
  { id: 'jump_winner', name: 'Sky high', desc: 'Win a point with a jump smash', done: (_, m) => !!m?.jumpSmashWinner },
  { id: 'marathon', name: 'Marathon', desc: 'Play a 30-shot rally', done: (c) => (c.max_rally ?? 0) >= 30 },
  { id: 'beat_medium', name: 'Club player', desc: 'Beat a Medium CPU', done: beat('medium') },
  { id: 'beat_hard', name: 'County standard', desc: 'Beat a Hard CPU', done: beat('hard') },
  { id: 'beat_expert', name: 'Giant killer', desc: 'Beat an Expert CPU', done: beat('expert') },
  { id: 'rocket', name: 'Rocket', desc: 'Smash at 300 km/h or faster', done: (c) => (c.max_smash ?? 0) >= 300 },
  { id: 'metronome', name: 'Metronome', desc: '100 perfectly timed hits', done: (c) => (c.perfect_hits ?? 0) >= 100 },
  { id: 'ace_machine', name: 'Ace machine', desc: 'Serve 10 aces', done: (c) => (c.aces ?? 0) >= 10 },
  { id: 'comeback', name: 'Comeback', desc: 'Win a game after being 5 points down', done: (_, m) => (m?.comeback ?? 0) >= 5 },
  { id: 'love_game', name: 'Clean sheet', desc: 'Win a game without losing a point', done: (_, m) => !!m?.loveGame },
  { id: 'hawkeye', name: 'Eagle eye', desc: 'Overturn a line call with Hawk-Eye', done: (c) => (c.challenges_won ?? 0) >= 1 },
  { id: 'on_fire', name: 'On fire', desc: 'Win 5 matches in a row', done: (c) => (c.max_streak ?? 0) >= 5 },
  { id: 'online_win', name: 'Going global', desc: 'Win a match online', done: (_, m) => !!m?.won && m.online },
  { id: 'regular', name: 'Regular', desc: 'Play 50 matches', done: (c) => (c.matches ?? 0) >= 50 },
];

const KEY = 'badminton.achievements';
export type Unlocked = Record<string, number>;
export function loadUnlocked(): Unlocked {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Unlocked; } catch { return {}; }
}

/**
 * Check everything against your career (and this match, if there was one). Saves and returns the
 * achievements that are new. Ones already in your account's career count as unlocked too.
 */
export function checkAchievements(c: Career, m: MatchFacts | null): Achievement[] {
  const got = loadUnlocked();
  const fresh: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (got[a.id]) continue;
    if (c[`max_ach_${a.id}`]) { got[a.id] = Date.now(); continue; }
    if (a.done(c, m)) { got[a.id] = Date.now(); fresh.push(a); }
  }
  try { localStorage.setItem(KEY, JSON.stringify(got)); } catch { /* storage unavailable */ }
  return fresh;
}

/** Career numbers for unlocked achievements (so they follow your account and count on the leaderboard). */
export const achievementDelta = (list: Achievement[]): Career => Object.fromEntries(list.map((a) => [`max_ach_${a.id}`, 1]));
