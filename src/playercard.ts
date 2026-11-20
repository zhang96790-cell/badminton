// 3.14: a player's card, opened by clicking anyone on a leaderboard (or "Your player card" in Account).
// Rating and rank, record, career titles by tier with their points, and their best numbers.
import type { PlayerCard } from './account';
import { tierOf } from './rating';
import { titleChips, titleSummary } from './titles';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number | undefined) => (v ?? 0).toLocaleString('en-GB');

function shell(): HTMLElement {
  let el = document.getElementById('playerCard');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'playerCard';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.addEventListener('click', (e) => { if (e.target === el || (e.target as HTMLElement).closest('[data-pc-close]')) el!.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el!.classList.contains('hidden')) { e.stopPropagation(); el!.classList.add('hidden'); } }, true);
  document.body.appendChild(el);
  return el;
}

export async function openPlayerCard(username: string, load: (u: string) => Promise<PlayerCard | null>, me?: string, mine?: Record<string, number>) {
  const el = shell();
  el.classList.remove('hidden');
  el.innerHTML = `<div class="pc-panel"><button class="pc-x" data-pc-close aria-label="Close">×</button><p class="pc-loading">Loading ${esc(username)}…</p></div>`;
  const c = await load(username);
  if (el.classList.contains('hidden')) return;
  if (!c) {
    el.innerHTML = `<div class="pc-panel"><button class="pc-x" data-pc-close aria-label="Close">×</button><p class="pc-loading">Couldn’t load ${esc(username)}’s card. If the game was just updated, it may need a moment.</p></div>`;
    return;
  }
  const st = c.stats ?? {}, sum = titleSummary(st), t = tierOf(c.rating);
  const ranked = c.wins + c.losses > 0;
  const best = st.max_career_best_rank ? 1000 - st.max_career_best_rank : 0;
  const cm = st.career_matches ?? 0, cw = st.career_wins ?? 0;
  const fact = (label: string, value: string, sub = '') => `<div class="pc-fact"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const tierRows = sum.rows.map(({ t: tt, n }) => `<tr><td><span class="t-chip" style="--c:${tt?.color ?? '#8a8f98'}">${esc(tt?.short ?? 'Earlier')}</span> ${esc(tt?.label ?? 'Won before 3.14')}</td><td>${n}</td><td>${num(n * (tt?.points ?? 3))}</td></tr>`).join('');
  el.innerHTML = `<div class="pc-panel">
    <button class="pc-x" data-pc-close aria-label="Close">×</button>
    <header class="pc-head" style="--tier:${t.color}">
      <div class="pc-badge">${esc(c.username.slice(0, 2).toUpperCase())}</div>
      <div><p class="pc-kicker">${c.username === me ? 'Your player card' : 'Player card'}</p><h2>${esc(c.username)}</h2>
      <p class="pc-tier">${ranked ? `<b style="color:${t.color}">${esc(t.name)}</b> · ${c.rating} rating${c.rating_rank ? ` · #${c.rating_rank} ranked` : ''}` : 'Not ranked yet'}</p></div>
    </header>
    <div class="pc-facts">
      ${fact('Title points', num(sum.points), c.title_points > 0 ? `#${c.title_rank} on the titles board` : 'No titles yet')}
      ${fact('Career titles', num(sum.titles), best ? `Best world ranking #${best}` : '')}
      ${fact('Ranked record', ranked ? `${c.wins}–${c.losses}` : '–', ranked ? `${Math.round((100 * c.wins) / (c.wins + c.losses))}% won` : '')}
      ${fact('Career record', cm ? `${num(cw)}–${num(cm - cw)}` : '–', st.career_prize ? `$${num(st.career_prize)} prize money` : '')}
    </div>
    ${sum.rows.length ? `<h3 class="pc-h">Titles</h3><div class="pc-chips">${titleChips(sum)}</div>
      <table class="pc-table"><tr><th>Tier</th><th>Won</th><th>Points</th></tr>${tierRows}</table>` : ''}
    <h3 class="pc-h">Best numbers</h3>
    <div class="pc-facts small">
      ${fact('Matches won', num(st.wins), `of ${num(st.matches)}`)}
      ${fact('Fastest smash', st.max_smash ? `${st.max_smash} km/h` : '–')}
      ${fact('Longest rally', st.max_rally ? `${st.max_rally} shots` : '–')}
      ${fact('Win streak', num(st.max_streak))}
      ${fact('Smash winners', num(st.smash_winners))}
      ${fact('Achievements', num(c.achievements))}
    </div>
    ${mine && c.username !== me ? compareHtml(st, mine, c.username) : ''}
  </div>`;
}

/** 4.4: you against this player, side by side (their account stats against yours). */
function compareHtml(them: Record<string, number>, me: Record<string, number>, name: string): string {
  const g = (o: Record<string, number>, k: string) => o[k] ?? 0;
  const pct = (o: Record<string, number>) => (g(o, 'matches') ? Math.round((100 * g(o, 'wins')) / g(o, 'matches')) : 0);
  const rows: [string, number, number, string?][] = [
    ['Matches played', g(me, 'matches'), g(them, 'matches')],
    ['Win rate', pct(me), pct(them), '%'],
    ['Title points', titleSummary(me).points, titleSummary(them).points],
    ['Fastest smash', g(me, 'max_smash'), g(them, 'max_smash'), ' km/h'],
    ['Longest rally', g(me, 'max_rally'), g(them, 'max_rally')],
    ['Best win streak', g(me, 'max_streak'), g(them, 'max_streak')],
    ['Smash winners', g(me, 'smash_winners'), g(them, 'smash_winners')],
    ['Aces', g(me, 'aces'), g(them, 'aces')],
  ];
  return `<h3 class="pc-h">You v ${esc(name)}</h3><table class="pc-table pc-compare"><tr><th></th><th>You</th><th>${esc(name)}</th></tr>${rows.map(([l, a, b, u = '']) =>
    `<tr><td>${l}</td><td class="${a > b ? 'up' : ''}">${num(a)}${u}</td><td class="${b > a ? 'up' : ''}">${num(b)}${u}</td></tr>`).join('')}</table>`;
}
