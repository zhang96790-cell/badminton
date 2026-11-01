import type { Camera } from './camera';
import { COURT } from './config';
import { courtLineRects, type Rect } from './court';
import { clamp, ease, lerp3, type V2, type V3 } from './math';

export interface Review {
  by: 0 | 1;
  name: string;
  color: string;
  landing: V2;
  /** Shuttle positions over its last moments, ending at the floor. */
  path: V3[];
  rect: Rect;
  signed: number;
  truthIn: boolean;
  callIn: boolean;
  /** Seconds since the review started (real time). */
  t: number;
}

export const REVIEW_TIME = 6.8;
/** Timeline: intro, follow the flight down, zoom onto the mark, verdict. */
const T = { intro: 0.5, flight: 3.0, zoom: 4.4 };

const HE = {
  bg: '#061427',
  floor: '#0b2442',
  court: '#145c84',
  area: '#1a6e9c',
  line: '#f4f7fb',
  path: '#ffd23f',
  inC: '#35e08a',
  outC: '#ff4f5e',
  text: '#eef4fb',
  dim: 'rgba(238,244,251,0.6)',
};

const LINES = courtLineRects();
const font = (px: number, weight = 700, style = '') => `${style} ${weight} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
const rect3 = (r: Rect): V3[] => [
  { x: r.xMin, y: r.yMin, z: 0 }, { x: r.xMax, y: r.yMin, z: 0 }, { x: r.xMax, y: r.yMax, z: 0 }, { x: r.xMin, y: r.yMax, z: 0 },
];
const circle3 = (c: V2, rad: number, n = 40): V3[] =>
  Array.from({ length: n }, (_, i) => ({ x: c.x + Math.cos((i / n) * Math.PI * 2) * rad, y: c.y + Math.sin((i / n) * Math.PI * 2) * rad, z: 0 }));

function fillPoly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], color: string) {
  if (pts.length < 3) return;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Closest point on the judged area's boundary (the outer edge of the line). */
function nearestEdge(p: V2, r: Rect): V2 {
  const inside = p.x >= r.xMin && p.x <= r.xMax && p.y >= r.yMin && p.y <= r.yMax;
  if (!inside) return { x: clamp(p.x, r.xMin, r.xMax), y: clamp(p.y, r.yMin, r.yMax) };
  const opts = [
    { d: p.x - r.xMin, q: { x: r.xMin, y: p.y } }, { d: r.xMax - p.x, q: { x: r.xMax, y: p.y } },
    { d: p.y - r.yMin, q: { x: p.x, y: r.yMin } }, { d: r.yMax - p.y, q: { x: p.x, y: r.yMax } },
  ];
  return opts.reduce((a, b) => (b.d < a.d ? b : a)).q;
}

export function verdictText(r: Review): string {
  const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;
  if (!r.truthIn) return `Out by ${cm(-r.signed - COURT.footprint)}`;
  if (r.signed < 0) return 'Touching the line';
  return `${cm(r.signed)} inside`;
}

export function drawReview(ctx: CanvasRenderingContext2D, w: number, h: number, r: Review, cam: Camera) {
  const t = r.t, p = r.landing;
  ctx.save();
  ctx.fillStyle = HE.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = clamp(t / 0.3, 0, 1);

  const path = r.path.length >= 2 ? r.path : [{ x: p.x, y: p.y - 0.6, z: 1.6 }, { x: p.x, y: p.y, z: 0 }];
  path[path.length - 1] = { x: p.x, y: p.y, z: 0 };
  const last = path[path.length - 1], before = path[Math.max(0, path.length - 14)];
  let ax = last.x - before.x, ay = last.y - before.y;
  const al = Math.hypot(ax, ay) || 1;
  ax /= al; ay /= al;
  // Watch from the side of the flight, from outside the court.
  let px = -ay, py = ax;
  if (px * p.x + py * p.y < 0) { px = -px; py = -py; }

  const k1 = { pos: { x: p.x + px * 4.2 - ax * 2.4, y: p.y + py * 4.2 - ay * 2.4, z: 3.0 }, target: { x: p.x - ax * 0.9, y: p.y - ay * 0.9, z: 0.5 } };
  const k2 = { pos: { x: p.x + px * 1.2 - ax * 0.45, y: p.y + py * 1.2 - ay * 0.45, z: 0.5 }, target: { x: p.x, y: p.y, z: 0.02 } };
  const k3 = { pos: { x: p.x - ax * 0.05, y: p.y - ay * 0.05, z: 0.55 }, target: { x: p.x, y: p.y, z: 0 } };
  let pos: V3, target: V3;
  if (t < T.flight) {
    const u = ease((t - T.intro) / (T.flight - T.intro));
    pos = lerp3(k1.pos, k2.pos, u);
    target = lerp3(k1.target, k2.target, u);
  } else {
    const u = ease((t - T.flight) / (T.zoom - T.flight));
    pos = lerp3(k2.pos, k3.pos, u);
    target = lerp3(k2.target, k3.target, u);
  }
  cam.look(pos, target);
  cam.setLens(h * 1.05, w * 0.42, h * 0.56);

  // Court
  fillPoly(ctx, cam.projectPoly(rect3({ xMin: p.x - 25, xMax: p.x + 25, yMin: p.y - 25, yMax: p.y + 25 })), HE.floor);
  fillPoly(ctx, cam.projectPoly(rect3({ xMin: -COURT.doublesHalfWidth, xMax: COURT.doublesHalfWidth, yMin: -COURT.halfLength, yMax: COURT.halfLength })), HE.court);
  const area = { ...r.rect, yMin: Math.max(r.rect.yMin, -COURT.halfLength), yMax: Math.min(r.rect.yMax, COURT.halfLength) };
  fillPoly(ctx, cam.projectPoly(rect3(area)), HE.area);
  for (const l of LINES) fillPoly(ctx, cam.projectPoly(rect3(l)), HE.line);

  // Flight path, drawn in as the shuttle comes down
  const flightU = clamp((t - T.intro) / (T.flight - T.intro - 0.5), 0, 1);
  const n = Math.max(1, Math.round(flightU * (path.length - 1)));
  const visible = path.slice(0, n + 1).filter((q) => cam.depth(q) > 0.15).map((q) => cam.project(q));
  if (visible.length > 1) {
    for (const [width, color] of [[10, 'rgba(255,210,63,0.18)'], [5, 'rgba(255,210,63,0.4)'], [2, HE.path]] as [number, string][]) {
      ctx.beginPath();
      visible.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
  if (flightU < 1) {
    const a = path[n], b = path[Math.max(0, n - 1)];
    if (cam.depth(a) > 0.15) {
      const q = cam.project(a), qb = cam.project({ x: a.x + (b.x - a.x) * 2, y: a.y + (b.y - a.y) * 2, z: a.z + (b.z - a.z) * 2 });
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(3, 0.05 * q.s);
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(qb.x, qb.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(2.5, 0.015 * q.s), 0, Math.PI * 2);
      ctx.fillStyle = '#e8c79e';
      ctx.fill();
    }
  } else {
    // Footprint where the cork touched down
    const color = r.truthIn ? HE.inC : HE.outC;
    const pulse = (t - (T.flight - 0.5)) % 1.2;
    fillPoly(ctx, cam.projectPoly(circle3(p, COURT.footprint)), color);
    const ring = cam.projectPoly(circle3(p, COURT.footprint * (1 + pulse * 3)));
    if (ring.length > 2) {
      ctx.beginPath();
      ring.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.max(0, 1 - pulse / 1.2) * clamp(t / 0.3, 0, 1);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = clamp(t / 0.3, 0, 1);
    }
  }

  // Measurement between the footprint and the line edge
  if (t > T.zoom - 0.5 && Math.abs(r.signed) < 0.3) {
    const q = nearestEdge(p, r.rect);
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d > 0.002) {
      const ux = dx / d, uy = dy / d;
      const a = cam.project({ x: p.x + ux * COURT.footprint, y: p.y + uy * COURT.footprint, z: 0.001 });
      const b = cam.project({ x: q.x, y: q.y, z: 0.001 });
      ctx.strokeStyle = HE.text;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Chrome
  ctx.globalAlpha = 1;
  const bar = ctx.createLinearGradient(0, 0, 0, 74);
  bar.addColorStop(0, 'rgba(3,10,22,0.95)');
  bar.addColorStop(1, 'rgba(3,10,22,0.6)');
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, w, 74);
  // Logo: an eye
  ctx.strokeStyle = HE.path;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(40, 37, 16, 9, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = HE.path;
  ctx.beginPath();
  ctx.arc(40, 37, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = HE.text;
  ctx.font = font(24, 900, 'italic');
  ctx.fillText('HAWK-EYE', 66, 45);
  ctx.textAlign = 'right';
  ctx.font = font(12, 700);
  ctx.fillStyle = HE.dim;
  ctx.fillText('CHALLENGE', w - 24, 30);
  ctx.font = font(18, 800);
  ctx.fillStyle = r.color;
  ctx.fillText(r.name, w - 24, 52);
  ctx.textAlign = 'left';
  ctx.font = font(13, 600);
  ctx.fillStyle = HE.dim;
  ctx.fillText(`Original call: ${r.callIn ? 'IN' : 'OUT'}`, 230, 43);

  // Verdict
  if (t > T.zoom) {
    const u = ease((t - T.zoom) / 0.25);
    const color = r.truthIn ? HE.inC : HE.outC;
    const x = w * 0.8, y = h * 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + (1 - u) * 0.6, 1 + (1 - u) * 0.6);
    ctx.globalAlpha = u;
    ctx.fillStyle = 'rgba(3,10,22,0.82)';
    ctx.beginPath();
    ctx.roundRect(-150, -110, 300, 220, 18);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = font(96, 900);
    ctx.fillText(r.truthIn ? 'IN' : 'OUT', 0, 18);
    ctx.fillStyle = HE.text;
    ctx.font = font(15, 600);
    ctx.fillText(verdictText(r), 0, 52);
    ctx.font = font(14, 800);
    ctx.fillStyle = r.truthIn !== r.callIn ? HE.path : HE.dim;
    if (t > T.zoom + 0.6) ctx.fillText(r.truthIn !== r.callIn ? 'CALL OVERTURNED' : 'CALL STANDS', 0, 84);
    ctx.restore();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = HE.dim;
  ctx.font = font(12, 500);
  ctx.fillText('Enter to skip', w / 2, h - 18);
  ctx.restore();
}
