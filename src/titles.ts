// 3.14: career titles are worth different amounts. Each tier has its own count on your account
// (ct_<tier> in the career stats) and its own weight in title points, which the Career titles
// leaderboard sorts by. The same weights are in supabase/3.14-titles.sql: keep them in step.

export interface TitleTier { tier: string; key: string; label: string; short: string; points: number; color: string }

/** Biggest first. */
export const TITLE_TIERS: TitleTier[] = [
  { tier: 'OLYMPICS', key: 'ct_olympics', label: 'Olympic gold', short: 'Olympics', points: 50, color: '#c9a227' },
  { tier: 'WORLDS', key: 'ct_worlds', label: 'World Championships', short: 'Worlds', points: 35, color: '#7b2cbf' },
  { tier: 'WTF', key: 'ct_finals', label: 'World Tour Finals', short: 'Finals', points: 25, color: '#b42318' },
  { tier: 'S1000', key: 'ct_s_thousand', label: 'Super 1000', short: 'S1000', points: 18, color: '#0c2259' },
  { tier: 'S750', key: 'ct_s_seven', label: 'Super 750', short: 'S750', points: 12, color: '#1f5fbf' },
  { tier: 'S500', key: 'ct_s_five', label: 'Super 500', short: 'S500', points: 8, color: '#0e7490' },
  { tier: 'S300', key: 'ct_s_three', label: 'Super 300', short: 'S300', points: 5, color: '#157f3d' },
  { tier: 'S100', key: 'ct_s_hundred', label: 'Super 100', short: 'S100', points: 3, color: '#4b5563' },
  { tier: 'CLUB', key: 'ct_club', label: 'Club open', short: 'Club', points: 1, color: '#8a8f98' },
];

/** Titles won before 3.14 (no tier saved) count this much each. */
export const OLD_TITLE_POINTS = 3;

export const titleTierOf = (tier: string) => TITLE_TIERS.find((t) => t.tier === tier);

type Stats = Record<string, number | undefined>;

export interface TitleSummary { titles: number; points: number; rows: { t: TitleTier | null; n: number }[] }

/** A player's titles from their career stats: the total, title points, and how many of each tier. */
export function titleSummary(c: Stats): TitleSummary {
  const titles = Number(c.career_titles ?? 0);
  let counted = 0, points = 0;
  const rows: TitleSummary['rows'] = [];
  for (const t of TITLE_TIERS) {
    const n = Number(c[t.key] ?? 0);
    if (!n) continue;
    counted += n; points += n * t.points;
    rows.push({ t, n });
  }
  const old = Math.max(0, titles - counted);
  if (old) { points += old * OLD_TITLE_POINTS; rows.push({ t: null, n: old }); }
  return { titles: Math.max(titles, counted), points, rows };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Little coloured chips, one per tier won: "S1000 ×2". */
export function titleChips(sum: TitleSummary, max = 9): string {
  return sum.rows.slice(0, max).map(({ t, n }) => t
    ? `<span class="t-chip" style="--c:${t.color}" title="${esc(t.label)}: ${t.points} points each">${esc(t.short)}${n > 1 ? ` ×${n}` : ''}</span>`
    : `<span class="t-chip old" title="Won before 3.14: ${OLD_TITLE_POINTS} points each">Earlier${n > 1 ? ` ×${n}` : ''}</span>`).join('');
}
