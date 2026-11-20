// 4.0: the walk-on, shown while a match loads. The two players' halves slam in from the sides, a VS pops
// between them, then their stats, signature moves and (in a tournament) the road to this round. It moves on
// by itself after a few seconds; Space, Enter or a click skips it.

export interface WalkOnSide {
  name: string;
  /** Under the name, e.g. "World #87 · Club Player". */
  line: string;
  /** A few [value, label] pairs. A value of "form:WWLWL" draws the last results as coloured blocks. */
  stats: [string, string][];
  /** A signature ability or the CPU's style. */
  move?: { kicker: string; name: string; text: string };
}
export interface WalkOnStep { label: string; detail?: string; state: 'won' | 'now' | 'next' }
export interface WalkOnInfo {
  event: string;
  round: string;
  me: WalkOnSide;
  them: WalkOnSide;
  /** In a tournament: the rounds so far, this one, and those to come. */
  path?: WalkOnStep[];
  tip?: string;
}

const TIPS = [
  'A jump smash timed at the top of your jump is about 15% faster.',
  'Against a smash, a soft block to the net is often better than lifting it back.',
  'Drops always go short and lobs always go deep, wherever the cursor is.',
  'Press H to challenge a line call. You get two wrong ones a game.',
  'A tight net shot can tumble over the tape. Lift it: it can’t be netted back.',
  'Press R after a rally to watch the replay.',
];

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function side(s: WalkOnSide, cls: 'me' | 'them'): string {
  const stats = s.stats.map(([v, l], i) => {
    const val = v.startsWith('form:')
      ? `<span class="wo-form">${[...v.slice(5)].map((r) => `<i class="${r === 'W' ? 'w' : 'l'}">${r}</i>`).join('') || '–'}</span>`
      : `<b>${esc(v)}</b>`;
    return `<div style="animation-delay:${0.6 + i * 0.08}s">${val}<span>${esc(l)}</span></div>`;
  }).join('');
  const move = s.move ? `<div class="wo-move"><small>${esc(s.move.kicker)}</small><b>${esc(s.move.name)}</b><p>${esc(s.move.text)}</p></div>` : '';
  return `<div class="wo-side ${cls}"><p class="wo-line">${esc(s.line)}</p><p class="wo-name">${esc(s.name)}</p><div class="wo-stats">${stats}</div>${move}</div>`;
}

/** Show the walk-on; resolves when it's done (or skipped). */
export function showWalkOn(info: WalkOnInfo, ms = 3600): Promise<void> {
  document.getElementById('walkon')?.remove();
  const el = document.createElement('div');
  el.id = 'walkon';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${info.event}: ${info.me.name} against ${info.them.name}`);
  el.style.setProperty('--wo-ms', `${ms}ms`);
  const path = info.path?.length
    ? `<div class="wo-path">${info.path.map((p) => `<span class="${p.state}">${esc(p.label)}${p.detail ? `<em>${esc(p.detail)}</em>` : ''}</span>`).join('')}</div>` : '';
  el.innerHTML = `
    <div class="wo-top"><span class="wo-ev">${esc(info.event)}</span><span class="wo-round">${esc(info.round)}</span><span class="wo-skip">Space to skip</span></div>
    <div class="wo-mid">${side(info.me, 'me')}${side(info.them, 'them')}<span class="wo-vs">VS</span><span class="wo-flash"></span></div>
    <div class="wo-bottom">${path}<div class="wo-bar"><i></i></div><p class="wo-tip">Tip: ${esc(info.tip ?? TIPS[Math.floor(Math.random() * TIPS.length)])}</p></div>`;
  document.body.appendChild(el);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      el.classList.add('out');
      window.setTimeout(() => { el.remove(); resolve(); }, 330);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    };
    const timer = window.setTimeout(finish, ms);
    window.addEventListener('keydown', onKey, true);
    el.addEventListener('click', finish);
  });
}
