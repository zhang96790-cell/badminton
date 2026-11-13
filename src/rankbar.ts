// The rank bar (eight tiers, where you are, points to the next) and the rating graph (last 30 changes).
import { TIERS, toNext } from './rating';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** HTML for the bar: one segment per tier, a marker at your rating, and how far the next tier is. */
export function rankBarHtml(rating: number, tier: number, opts: { peakTier?: number; compact?: boolean; anim?: 'up' | 'down' | null } = {}): string {
  const segs = TIERS.map((t, i) => {
    const top = TIERS[i + 1]?.min ?? t.min + 200;
    const pos = i === tier ? Math.max(0, Math.min(1, (rating - t.min) / (top - t.min))) : 0;
    const cls = i < tier ? 'done' : i === tier ? 'now' : '';
    const tip = `${t.name} · ${i === 0 ? `below ${TIERS[1].min}` : `${t.min}+`}`;
    return `<span class="rb-seg ${cls}" style="--c:${t.color}" title="${esc(tip)}">${i === tier ? `<i class="rb-mark" style="left:${(pos * 100).toFixed(1)}%"></i>` : ''}${opts.compact ? '' : `<em>${esc(t.name)}</em>`}</span>`;
  }).join('');
  const next = toNext(rating, tier);
  const now = TIERS[tier];
  const caption = next === null ? `${now.name}: the top tier` : `${next} point${next === 1 ? '' : 's'} to ${TIERS[tier + 1].name}`;
  const buffer = tier > 0 && rating < now.min ? ` · ${rating - (now.min - 20)} above dropping to ${TIERS[tier - 1].name}` : '';
  const peak = opts.peakTier !== undefined && opts.peakTier > tier ? `<span class="rb-peak" style="--c:${TIERS[opts.peakTier].color}">Peak: ${esc(TIERS[opts.peakTier].name)}</span>` : opts.peakTier !== undefined ? `<span class="rb-peak" style="--c:${now.color}">Peak: ${esc(TIERS[opts.peakTier].name)}</span>` : '';
  return `<div class="rank-bar${opts.compact ? ' compact' : ''}${opts.anim ? ` anim-${opts.anim}` : ''}">
    <div class="rb-head"><b style="color:${now.color}">${esc(now.name)}</b><span>${rating}</span>${peak}</div>
    <div class="rb-track">${segs}</div>
    <p class="rb-caption">${caption}${buffer}</p>
  </div>`;
}

/** Rating over the last changes, oldest on the left; tier lines drawn faintly behind. */
export function drawRatingGraph(canvas: HTMLCanvasElement, ratings: number[]) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 520, H = canvas.clientHeight || 140;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  if (ratings.length < 2) {
    ctx.fillStyle = '#7b8494';
    ctx.textAlign = 'center';
    ctx.fillText('Play a couple of rated matches to see your rating graph.', W / 2, H / 2);
    return;
  }
  const lo = Math.min(...ratings) - 25, hi = Math.max(...ratings) + 25;
  const padL = 40, padR = 10, padT = 10, padB = 18;
  const X = (i: number) => padL + (i / (ratings.length - 1)) * (W - padL - padR);
  const Y = (r: number) => padT + (1 - (r - lo) / (hi - lo)) * (H - padT - padB);
  // Tier thresholds inside the range.
  ctx.textAlign = 'right';
  for (const t of TIERS) {
    if (t.min <= lo || t.min >= hi) continue;
    ctx.strokeStyle = t.color + '66';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, Y(t.min)); ctx.lineTo(W - padR, Y(t.min)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = t.color;
    ctx.fillText(String(t.min), padL - 6, Y(t.min) + 4);
  }
  ctx.fillStyle = '#7b8494';
  ctx.fillText(String(Math.round(hi - 25)), padL - 6, padT + 8);
  ctx.fillText(String(Math.round(lo + 25)), padL - 6, H - padB);
  ctx.textAlign = 'left';
  ctx.fillText(`Last ${ratings.length - 1} rated matches`, padL, H - 3);
  ctx.strokeStyle = '#f2b544';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ratings.forEach((r, i) => { if (i) ctx.lineTo(X(i), Y(r)); else ctx.moveTo(X(i), Y(r)); });
  ctx.stroke();
  const last = ratings[ratings.length - 1];
  ctx.fillStyle = '#f2b544';
  ctx.beginPath(); ctx.arc(X(ratings.length - 1), Y(last), 3.5, 0, Math.PI * 2); ctx.fill();
}
