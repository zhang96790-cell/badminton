// The five-stat pentagon (radar) chart for player cards, drawn on a canvas.
import { STAT_NAMES, type Stats } from '../shared/characters';

/** Draw stats (10–35 each) as a filled pentagon; `compare` is drawn as an outline on top. */
export function drawPentagon(canvas: HTMLCanvasElement, stats: Stats, color: string, compare?: { stats: Stats; color: string }) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 180, H = canvas.clientHeight || 180;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2 + 6, R = Math.min(W, H) / 2 - 26;
  const at = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  // Rings at 10, 20 (today's player), 30; spokes and labels.
  const ring = (frac: number, dash: number[]) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { const p = at(i, R * frac); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
    ctx.closePath();
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  ctx.strokeStyle = 'rgba(120,130,150,0.35)';
  ctx.lineWidth = 1;
  for (const v of [10, 30]) ring(v / 35, []);
  ctx.strokeStyle = 'rgba(120,130,150,0.7)';
  ring(20 / 35, [3, 3]);
  ctx.strokeStyle = 'rgba(120,130,150,0.3)';
  for (let i = 0; i < 5; i++) { const p = at(i, R); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  const shape = (s: Stats, fill: string | null, stroke: string, width: number) => {
    ctx.beginPath();
    s.forEach((v, i) => { const p = at(i, (R * Math.max(0, Math.min(35, v))) / 35); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  shape(stats, color + '55', color, 2);
  if (compare) shape(compare.stats, null, compare.color, 2);
  ctx.fillStyle = '#5b6474';
  ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  STAT_NAMES.forEach((name, i) => {
    const p = at(i, R + 14);
    ctx.fillText(`${name.toUpperCase()} ${stats[i]}${compare ? ` / ${compare.stats[i]}` : ''}`, p.x, p.y + 3);
  });
}
