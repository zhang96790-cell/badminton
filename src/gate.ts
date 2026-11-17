// 3.13: the game switch. On start and every minute the game asks the database whether it's shut for
// maintenance or whether this player is blocked, and if so covers everything with a notice. Admins can
// still play during maintenance (with a banner saying it's on). If the database can't be reached the game
// stays open: the switch should never lock everyone out by accident.
type Account = typeof import('./account');

const BLOCKED_KEY = 'badminton.blockedAs';
const CHECK_EVERY = 60_000;

const read = () => { try { return localStorage.getItem(BLOCKED_KEY); } catch { return null; } };
const write = (v: string | null) => { try { if (v) localStorage.setItem(BLOCKED_KEY, v); else localStorage.removeItem(BLOCKED_KEY); } catch { /* storage blocked */ } };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let shown: 'maintenance' | 'blocked' | null = null;

function cover(kind: 'maintenance' | 'blocked', text: string) {
  let el = document.getElementById('gate');
  if (!el) { el = document.createElement('div'); el.id = 'gate'; document.body.appendChild(el); }
  el.innerHTML = kind === 'maintenance'
    ? `<div class="gate-card"><p class="gate-kicker">Skyline Smash</p><h1>Down for maintenance</h1><p>${esc(text || 'We’re working on the game. It’ll be back soon.')}</p><p class="gate-sub">This page checks every minute and opens again by itself.</p></div>`
    : `<div class="gate-card"><p class="gate-kicker">Skyline Smash</p><h1>You can’t play right now</h1><p>${esc(text || 'Your account has been blocked from the game.')}</p></div>`;
  shown = kind;
  document.getElementById('gateBanner')?.remove();
}

function uncover() {
  document.getElementById('gate')?.remove();
  // Something was covered: start fresh so nothing half-loaded is left behind.
  if (shown) location.reload();
}

function banner(on: boolean) {
  const old = document.getElementById('gateBanner');
  if (!on) { old?.remove(); return; }
  if (old) return;
  const b = document.createElement('div');
  b.id = 'gateBanner';
  b.textContent = 'Maintenance mode is on: only admins can play. Turn it off in the Admin tab.';
  document.body.appendChild(b);
}

export function startGate(loadAccount: () => Promise<Account>) {
  const check = async () => {
    let m: Account;
    try { m = await loadAccount(); } catch { return; }
    const me = await m.current().catch(() => null);
    const was = read();
    const st = await m.gameStatus(was);
    if (!st) return;
    if (st.blocked) {
      write(me?.username ?? was);
      cover('blocked', st.reason ? `Your account has been blocked from the game. Reason: ${st.reason}` : '');
      return;
    }
    if (was) write(null);
    if (st.maintenance && !st.admin) { cover('maintenance', st.message ?? ''); return; }
    banner(st.maintenance && st.admin);
    if (shown) uncover();
  };
  void check();
  setInterval(() => void check(), CHECK_EVERY);
  return check;
}
