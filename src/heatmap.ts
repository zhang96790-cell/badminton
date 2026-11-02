// Shot heatmaps: where your shots land, collected from every match, practice and challenge on this
// computer. Kept as a list of sessions (newest first) so you can compare recent play with all time.
import { COURT } from './config';
import type { Game } from './game';

export type ShotKind = 'smash' | 'drop' | 'clear' | 'net' | 'other';
/** One landing in your view: x across the court, y metres past the net (beyond 6.7 is long). */
type Spot = [number, number, ShotKind];
interface Session { at: number; spots: Spot[] }

const KEY = 'badminton.heatmap';
/** Sessions kept (older ones drop off). */
const KEPT = 40;

export const kindOf = (label: string): ShotKind =>
  /smash/i.test(label) ? 'smash' : /Drop/.test(label) ? 'drop' : /Clear|Lift/.test(label) ? 'clear' : /Net/.test(label) ? 'net' : 'other';

export function loadSessions(): Session[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Session[]; } catch { return []; }
}

/** Add this game's shots (yours, not serves) as a session. */
export function recordHeat(g: Game) {
  const me = g.players[0].id;
  const spots: Spot[] = g.stats.shots
    .filter((s) => s.by === 0 && s.pid === me && s.hand !== 'serve' && s.landing && s.landing.y > 0)
    .map((s) => [Math.round(s.landing!.x * 100) / 100, Math.round(s.landing!.y * 100) / 100, kindOf(s.label)]);
  if (spots.length < 3) return;
  const list = [{ at: Date.now(), spots }, ...loadSessions()].slice(0, KEPT);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

/**
 * Draw the far half of the court from above with your landings glowing on it. Returns how many
 * landings were drawn and what share landed in.
 */
export function drawHeat(canvas: HTMLCanvasElement, sessions: Session[], kind: ShotKind | 'all'): { n: number; inShare: number } {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const halfW = COURT.doublesHalfWidth, len = COURT.halfLength, pad = 0.6;
  const scale = Math.min(W / (2 * (halfW + pad)), H / (len + 2 * pad));
  const ox = W / 2, oy = H - pad * scale;
  // Net at the bottom, far baseline at the top, as if looking at it from your end.
  const P = (x: number, y: number) => ({ x: ox + x * scale, y: oy - y * scale });
  ctx.fillStyle = '#1d6b45';
  ctx.fillRect(0, 0, W, H);
  const a = P(-halfW, len), b = P(halfW, 0);
  ctx.fillStyle = '#23845a';
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  const line = (x1: number, y1: number, x2: number, y2: number) => { const p = P(x1, y1), q = P(x2, y2); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  for (const s of [-1, 1]) line(s * COURT.singlesHalfWidth, 0, s * COURT.singlesHalfWidth, len);
  line(-halfW, COURT.shortServiceLine, halfW, COURT.shortServiceLine);
  line(-halfW, COURT.doublesLongServiceLine, halfW, COURT.doublesLongServiceLine);
  line(0, COURT.shortServiceLine, 0, len);
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 3;
  line(-halfW - pad / 2, 0, halfW + pad / 2, 0);
  // Landings: soft glows that add up where you hit most.
  const spots = sessions.flatMap((s) => s.spots).filter((p) => kind === 'all' || p[2] === kind);
  // Fainter glows the more shots there are, so busy areas stand out instead of everything turning white.
  const r = Math.max(9, 0.45 * scale), alpha = Math.max(0.025, Math.min(0.3, 1.5 / Math.sqrt(spots.length + 1)));
  ctx.globalCompositeOperation = 'lighter';
  let inside = 0;
  for (const [x, y] of spots) {
    if (Math.abs(x) <= halfW && y <= len) inside++;
    const p = P(x, y);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `rgba(255,150,40,${alpha})`);
    g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NET', ox, oy + 14);
  return { n: spots.length, inShare: spots.length ? inside / spots.length : 0 };
}
