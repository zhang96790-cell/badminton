// Air Physics Revision: a small projectile simulator (gravity + quadratic drag), notes and a quiz.
// Self-contained on purpose: none of the badminton game is loaded on this page.
import './physics.css';

const G = 9.81;
const LAUNCH_HEIGHT = 1;

interface Point { x: number; y: number }
interface Flight { path: Point[]; range: number; maxH: number; time: number; landSpeed: number }

/**
 * Integrate a 2D flight with RK4: a = −g ŷ − (g / vt²)|v|v, the same drag model as the badminton
 * game's shuttlecock. vt = 0 means no air resistance.
 */
function fly(speed: number, angleDeg: number, vt: number): Flight {
  const k = vt > 0 ? G / (vt * vt) : 0;
  const a = (vx: number, vy: number) => {
    const s = Math.hypot(vx, vy);
    return [-k * s * vx, -G - k * s * vy];
  };
  const th = (angleDeg * Math.PI) / 180;
  let x = 0, y = LAUNCH_HEIGHT, vx = speed * Math.cos(th), vy = speed * Math.sin(th), t = 0, maxH = y;
  const dt = 1 / 240, path: Point[] = [{ x, y }];
  while (y > 0 && t < 60) {
    const [ax1, ay1] = a(vx, vy);
    const [ax2, ay2] = a(vx + ax1 * dt / 2, vy + ay1 * dt / 2);
    const [ax3, ay3] = a(vx + ax2 * dt / 2, vy + ay2 * dt / 2);
    const [ax4, ay4] = a(vx + ax3 * dt, vy + ay3 * dt);
    const px = x, py = y;
    x += (dt / 6) * (vx + 2 * (vx + ax1 * dt / 2) + 2 * (vx + ax2 * dt / 2) + (vx + ax3 * dt));
    y += (dt / 6) * (vy + 2 * (vy + ay1 * dt / 2) + 2 * (vy + ay2 * dt / 2) + (vy + ay3 * dt));
    vx += (dt / 6) * (ax1 + 2 * ax2 + 2 * ax3 + ax4);
    vy += (dt / 6) * (ay1 + 2 * ay2 + 2 * ay3 + ay4);
    t += dt;
    if (y <= 0) {
      // Interpolate the landing point onto the ground.
      const f = py / (py - y);
      x = px + (x - px) * f;
      y = 0;
      t -= dt * (1 - f);
    }
    maxH = Math.max(maxH, y);
    path.push({ x, y });
  }
  return { path, range: x, maxH, time: t, landSpeed: Math.hypot(vx, vy) };
}

// ── Simulator ────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('plot');
const ctx = canvas.getContext('2d')!;
const speedIn = $<HTMLInputElement>('speed'), angleIn = $<HTMLInputElement>('angle'), ghostIn = $<HTMLInputElement>('ghost');
const COLORS = ['#0b6e69', '#c2410c', '#6d28d9', '#1d4ed8'];

let vt = 6.8;
/** Launched flights, newest last (kept to four). */
let shots: { flight: Flight; ghost: Flight | null; color: string; label: string }[] = [];
/** Animation progress of the newest shot, in flight seconds. */
let anim = { t: 0, running: false, last: 0 };

function css(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/** A tidy tick step (1, 2 or 5 × 10ⁿ) giving about `n` ticks over `span`. */
function niceStep(span: number, n: number) {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Fit every path (and the no-air ghosts) with equal scales on both axes.
  const all = shots.flatMap((s) => [s.flight, ...(s.ghost && ghostIn.checked ? [s.ghost] : [])]);
  const maxX = Math.max(10, ...all.map((f) => f.range)) * 1.06;
  const maxY = Math.max(4, ...all.map((f) => f.maxH)) * 1.12;
  const pad = { l: 46, r: 14, t: 14, b: 34 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const scale = Math.min(pw / maxX, ph / maxY);
  const sx = (x: number) => pad.l + x * scale, sy = (y: number) => pad.t + ph - y * scale;

  // Grid and axes
  const ink = css('--ink-3'), rule = css('--rule');
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = ink;
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  const step = niceStep(Math.max(pw, ph) / scale, 8);
  ctx.textAlign = 'center';
  for (let x = 0; sx(x) <= w - pad.r + 0.5; x += step) {
    ctx.beginPath(); ctx.moveTo(sx(x), pad.t); ctx.lineTo(sx(x), pad.t + ph); ctx.stroke();
    ctx.fillText(`${+x.toFixed(1)}`, sx(x), h - pad.b + 18);
  }
  ctx.textAlign = 'right';
  for (let y = 0; sy(y) >= pad.t - 0.5; y += step) {
    ctx.beginPath(); ctx.moveTo(pad.l, sy(y)); ctx.lineTo(w - pad.r, sy(y)); ctx.stroke();
    ctx.fillText(`${+y.toFixed(1)}`, pad.l - 8, sy(y) + 4);
  }
  ctx.textAlign = 'left';
  ctx.fillText('height (m)', pad.l + 6, pad.t + 14);
  ctx.textAlign = 'right';
  ctx.fillText('distance (m)', w - pad.r - 4, pad.t + ph - 8);
  ctx.strokeStyle = css('--ink');
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ph); ctx.lineTo(w - pad.r, pad.t + ph); ctx.stroke();

  const line = (pts: Point[], color: string, dash: number[], width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y))));
    ctx.stroke();
    ctx.setLineDash([]);
  };

  shots.forEach((s, i) => {
    const newest = i === shots.length - 1;
    if (s.ghost && ghostIn.checked) line(s.ghost.path, s.color, [5, 5], 1.2);
    const n = newest && anim.running ? Math.min(s.flight.path.length, Math.floor(anim.t * 240) + 1) : s.flight.path.length;
    const pts = s.flight.path.slice(0, n);
    ctx.globalAlpha = newest ? 1 : 0.55;
    line(pts, s.color, [], newest ? 2.5 : 2);
    ctx.globalAlpha = 1;
    if (newest && pts.length) {
      const p = pts[pts.length - 1];
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  if (!shots.length) {
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Pick an object, set the speed and angle, then press Launch.', pad.l + pw / 2, pad.t + ph / 2);
  }
}

function frame(now: number) {
  if (!anim.running) return;
  const dt = Math.min(0.05, (now - anim.last) / 1000);
  anim.last = now;
  const f = shots[shots.length - 1].flight;
  // Show the flight in real time (but never longer than 4 seconds on screen).
  anim.t += dt * Math.max(1, f.time / 4);
  if (anim.t >= f.time) anim.running = false;
  draw();
  if (anim.running) requestAnimationFrame(frame);
}

const fmt = (v: number, unit: string, dp = 1) => `${v.toFixed(dp)} ${unit}`;

function launch() {
  const speed = +speedIn.value, angle = +angleIn.value;
  const flight = fly(speed, angle, vt);
  const ghost = vt > 0 ? fly(speed, angle, 0) : null;
  const color = COLORS[shots.length % COLORS.length];
  const name = document.querySelector<HTMLButtonElement>('#object .on')!.textContent!;
  shots.push({ flight, ghost, color, label: `${name}, ${speed} m/s at ${angle}°` });
  if (shots.length > 4) shots.shift();
  $('rRange').textContent = fmt(flight.range, 'm');
  $('rHeight').textContent = fmt(flight.maxH, 'm');
  $('rTime').textContent = fmt(flight.time, 's', 2);
  $('rLand').textContent = fmt(flight.landSpeed, 'm/s');
  $('rVt').textContent = vt > 0 ? fmt(vt, 'm/s') : 'none (no air)';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  anim = { t: 0, running: !reduce, last: performance.now() };
  if (anim.running) requestAnimationFrame(frame);
  else draw();
}

document.querySelectorAll<HTMLButtonElement>('#object button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#object button').forEach((o) => o.classList.toggle('on', o === b));
  vt = +b.dataset.vt!;
}));
speedIn.addEventListener('input', () => { $('speedOut').textContent = `${speedIn.value} m/s`; });
angleIn.addEventListener('input', () => { $('angleOut').textContent = `${angleIn.value}°`; });
ghostIn.addEventListener('change', draw);
$('launch').addEventListener('click', launch);
$('clear').addEventListener('click', () => {
  shots = [];
  anim.running = false;
  for (const id of ['rRange', 'rHeight', 'rTime', 'rLand', 'rVt']) $(id).textContent = '–';
  draw();
});
new ResizeObserver(draw).observe(canvas);

// ── Sidebar ──────────────────────────────────────────────────────────────────

const sidebar = $('sidebar'), menuBtn = $('menuBtn'), scrim = $('scrim');
function setMenu(open: boolean) {
  sidebar.classList.toggle('open', open);
  sidebar.setAttribute('aria-hidden', String(!open));
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  scrim.hidden = !open;
  if (open) sidebar.querySelector<HTMLElement>('a')?.focus();
}
menuBtn.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));
scrim.addEventListener('click', () => setMenu(false));
sidebar.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', () => setMenu(false)));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });

// ── Quiz ─────────────────────────────────────────────────────────────────────

const QUIZ: { q: string; options: string[]; answer: number; why: string }[] = [
  {
    q: 'An object is falling at its terminal velocity. What is the resultant force on it?',
    options: ['Equal to its weight, downward', 'Zero', 'Equal to the drag, upward'],
    answer: 1,
    why: 'Drag balances weight, so the resultant force is zero and the velocity stays constant.',
  },
  {
    q: 'At everyday speeds, if an object’s speed doubles, the drag on it becomes about…',
    options: ['twice as big', 'four times as big', 'half as big'],
    answer: 1,
    why: 'Drag is proportional to v², so 2² = 4 times.',
  },
  {
    q: 'With air resistance, what happens to a projectile’s horizontal velocity during flight?',
    options: ['It stays constant', 'It increases', 'It decreases'],
    answer: 2,
    why: 'Drag always points against the motion, so it has a backward horizontal component the whole time.',
  },
  {
    q: 'Ignoring air resistance, which launch angle gives the greatest range on flat ground?',
    options: ['30°', '45°', '60°'],
    answer: 1,
    why: 'R = u² sin 2θ / g is largest when sin 2θ = 1, at θ = 45°. (With drag, the best angle is lower.)',
  },
  {
    q: 'Why does a shuttlecock fall much more steeply than it rises?',
    options: ['Gravity is stronger on the way down', 'Drag has removed most of its horizontal speed', 'Its mass increases'],
    answer: 1,
    why: 'By the top of the flight drag has taken most of the horizontal speed, so it drops almost vertically near its terminal velocity.',
  },
];

const list = $('questions'), score = $('score');
const answered = new Map<number, boolean>();
QUIZ.forEach((item, qi) => {
  const li = document.createElement('li');
  li.innerHTML = `<p class="q">${item.q}</p><div class="opts"></div><p class="why" hidden></p>`;
  const opts = li.querySelector('.opts')!, why = li.querySelector<HTMLElement>('.why')!;
  item.options.forEach((text, oi) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', () => {
      if (answered.has(qi)) return;
      const right = oi === item.answer;
      answered.set(qi, right);
      opts.querySelectorAll('button').forEach((o, k) => {
        o.classList.toggle('right', k === item.answer);
        o.classList.toggle('wrong', k === oi && !right);
        (o as HTMLButtonElement).disabled = true;
      });
      why.hidden = false;
      why.textContent = `${right ? 'Correct.' : 'Not quite.'} ${item.why}`;
      const correct = [...answered.values()].filter(Boolean).length;
      score.textContent = `${correct} of ${answered.size} correct${answered.size === QUIZ.length ? ' — all done.' : ''}`;
    });
    opts.appendChild(b);
  });
  list.appendChild(li);
});

draw();
