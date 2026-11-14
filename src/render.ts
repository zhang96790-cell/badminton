import type { Camera } from './camera';
import { ARENA, COURT, SHOTS, VISUAL } from './config';
import { ads, type Ad } from './ads';
import { KeyboardController, MouseController } from './controllers';
import { courtLineRects, inHalf, isIn, netHeightAt, serviceBox, type Rect } from './court';
import type { Game } from './game';
import { add3, clamp, len3, mul3, norm3, rng, sub3, type V2, type V3 } from './math';
import type { Official } from './officials';
import { RACKET_LENGTH, crouchOf, lungeAmount, shoulderOf, splitAmount, type PlayerView } from './player';
import type { ShuttleView } from './replay';
import { mouseShotKind, mouseShotName, mouseTarget } from './shots';

export interface Scene { players: PlayerView[]; shuttle: ShuttleView; live: boolean }

const C = VISUAL.colors;
const v3 = (x: number, y: number, z = 0): V3 => ({ x, y, z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const LINES = courtLineRects();
const rect3 = (r: Rect, z = 0): V3[] => [v3(r.xMin, r.yMin, z), v3(r.xMax, r.yMin, z), v3(r.xMax, r.yMax, z), v3(r.xMin, r.yMax, z)];

/** Two-bone IK: the joint between `a` and `c`, bending toward `bend`. */
function ik(a: V3, c: V3, l1: number, l2: number, bend: V3): V3 {
  const d = sub3(c, a);
  const L = Math.min(len3(d), l1 + l2 - 1e-3);
  const u = norm3(d);
  const along = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const b = norm3(sub3(bend, mul3(u, dot(bend, u))));
  return add3(add3(a, mul3(u, along)), mul3(b, h));
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(clamp(c * k, 0, 255));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

interface Spectator { p: V3; shirt: string; skin: string; phase: number }

function buildCrowd(): Spectator[] {
  const R = rng(11);
  const skins = ['#e6c3a2', '#c99a74', '#8d5f3e', '#f0d2b6', '#b07d56'];
  const out: Spectator[] = [];
  const add = (x: number, y: number, z: number) => {
    if (R() > ARENA.crowdDensity) return;
    out.push({ p: v3(x + (R() - 0.5) * 0.12, y, z), shirt: C.crowd[Math.floor(R() * C.crowd.length)], skin: skins[Math.floor(R() * skins.length)], phase: R() * Math.PI * 2 });
  };
  for (let k = 0; k < 6; k++) for (let x = -12.6; x <= 12.6; x += 0.62) add(x, 11.75 + k * 0.85, 1.05 + k * 0.5);
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) for (let y = -8.6; y <= 13.4; y += 0.62) add(s * (8.05 + k * 0.85), y, 1.05 + k * 0.5);
  return out;
}

export class Renderer {
  /** The tournament's name for the court boards (career and daily matches), or null. */
  eventTitle: string | null = null;
  private cam!: Camera;
  private crowd = buildCrowd();
  /** Performance mode: a third of the crowd (standing still), no lighting or glow, no shuttle trail. */
  lite = false;
  private liteCrowd = this.crowd.filter((_, i) => i % 3 === 0);

  constructor(private ctx: CanvasRenderingContext2D) {}

  /** sideView: hide the service judge, who sits between the side camera and the net. */
  draw(cam: Camera, game: Game | null, scene: Scene | null, w: number, h: number, time: number, sideView = false) {
    this.cam = cam;
    const ctx = this.ctx;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, C.bgTop);
    bg.addColorStop(1, C.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    this.arena(time, game?.cheer ?? 0);
    this.court(!!game?.doublesCourt);
    if (game?.targetZone) this.targetZone(game, time);
    if (!this.lite) this.lights(w, h);

    const items: { d: number; draw: () => void }[] = [{ d: cam.depth(v3(0, 0, 1)), draw: () => this.net() }];
    const officials = game?.officials ?? [];
    for (const o of officials) if (!(sideView && o.kind === 'service')) items.push({ d: cam.depth(v3(o.pos.x, o.pos.y, 0.8)), draw: () => this.official(o, scene?.shuttle.pos ?? null) });
    // A saved highlight plays without a match (game is null): just the recorded players and shuttle.
    if (scene) {
      this.shadows(scene, officials);
      if (scene.live && game) {
        for (const r of game.rings) this.targetRing(r, time);
        if (game.settings.guides) this.guides(game);
        if (game.landing) this.landingMark(game.landing);
        this.reticle(game);
        if (game.doubles) this.youRing(game, time);
      }
      for (const p of scene.players) items.push({ d: cam.depth(v3(p.pos.x, p.pos.y, 1)), draw: () => this.player(p) });
      if (scene.live && game?.settings.timingLight) {
        game.players.forEach((p, i) => { if (game.isHuman(i)) items.push({ d: -1, draw: () => this.timingLight(game, i) }); });
      }
      items.push({ d: cam.depth(scene.shuttle.pos), draw: () => this.shuttle(scene.shuttle, w) });
      if (scene.live && game?.doubles) items.push({ d: -2, draw: () => this.youTag(game) });
      if (scene.live && game) for (const p of game.players) if (p.shout) items.push({ d: -2, draw: () => this.shoutBubble(p) });
    }
    items.sort((a, b) => b.d - a.d).forEach((i) => i.draw());
    if (!this.lite) this.vignette(w, h);
  }

  // ── Primitives ─────────────────────────────────────────────────────────────

  private poly(pts: V3[], fill: string) {
    const q = this.cam.projectPoly(pts);
    if (q.length < 3) return;
    const ctx = this.ctx;
    ctx.beginPath();
    q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  private seg(a: V3, b: V3, widthM: number, color: string, minPx = 1) {
    const pa = this.cam.project(a), pb = this.cam.project(b);
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(minPx, (widthM * (pa.s + pb.s)) / 2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  private dotAt(p: V3, radiusM: number, color: string, minPx = 1.5) {
    const q = this.cam.project(p), ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(minPx, radiusM * q.s), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private floorCircle(c: V2, r: number, n = 28): V3[] {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return v3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.9);
    });
  }

  // ── Arena ──────────────────────────────────────────────────────────────────

  private arena(time: number, cheer: number) {
    this.poly([v3(-16, -12), v3(16, -12), v3(16, 19), v3(-16, 19)], C.floor);
    // Stands: far end and both sides, back rows first.
    for (let k = 5; k >= 0; k--) {
      const y0 = 11.4 + k * 0.85, z0 = 0.3 + k * 0.5;
      this.poly([v3(-13.2, y0, 0), v3(13.2, y0, 0), v3(13.2, y0, z0 + 0.5), v3(-13.2, y0, z0 + 0.5)], C.standRiser);
      this.poly([v3(-13.2, y0, z0 + 0.5), v3(13.2, y0, z0 + 0.5), v3(13.2, y0 + 0.85, z0 + 0.5), v3(-13.2, y0 + 0.85, z0 + 0.5)], C.standTread);
    }
    for (const s of [-1, 1]) {
      for (let k = 5; k >= 0; k--) {
        const x0 = s * (7.7 + k * 0.85), x1 = s * (7.7 + (k + 1) * 0.85), z0 = 0.3 + k * 0.5;
        this.poly([v3(x0, -9.5, 0), v3(x0, 14, 0), v3(x0, 14, z0 + 0.5), v3(x0, -9.5, z0 + 0.5)], C.standRiser);
        this.poly([v3(x0, -9.5, z0 + 0.5), v3(x0, 14, z0 + 0.5), v3(x1, 14, z0 + 0.5), v3(x1, -9.5, z0 + 0.5)], C.standTread);
      }
    }
    // Crowd, far to near; they bounce when excited.
    const cam = this.cam, ctx = this.ctx;
    const people = (this.lite ? this.liteCrowd : this.crowd).map((s) => ({ s, d: cam.depth(s.p) })).filter((o) => o.d > 0.5).sort((a, b) => b.d - a.d);
    for (const { s } of people) {
      const bob = this.lite ? 0 : Math.max(0, Math.sin(time * 11 + s.phase)) * 0.14 * cheer;
      const body = cam.project(v3(s.p.x, s.p.y, s.p.z + bob));
      const head = cam.project(v3(s.p.x, s.p.y, s.p.z + 0.32 + bob));
      ctx.fillStyle = s.shirt;
      ctx.beginPath();
      ctx.ellipse(body.x, body.y, Math.max(1, 0.21 * body.s), Math.max(1, 0.2 * body.s), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = s.skin;
      ctx.beginPath();
      ctx.arc(head.x, head.y, Math.max(0.8, 0.1 * head.s), 0, Math.PI * 2);
      ctx.fill();
    }
    // Advertising boards behind the far baseline and along the sides.
    const texts = ARENA.boardTexts;
    // Career and daily matches: the tournament's name runs across the outer boards (two either side).
    const title = this.eventTitle;
    for (let i = 0; i < 6; i++) {
      const x0 = -7.8 + i * 2.6, color = title && i !== 2 && i !== 3 ? '#0b1f4f' : C.boards[i % C.boards.length];
      // Sponsors' boards: Solar Sparks and Ventra.
      const ad = i === 2 ? ads.solar : i === 3 ? ads.ventra : undefined;
      if (ad && this.cam.forward.y >= 0.5) { this.adBoard(ad, v3(x0, 9.4, 0.85), v3(x0 + 2.6, 9.4, 0.85), v3(x0, 9.4, 0)); continue; }
      this.poly([v3(x0, 9.4, 0), v3(x0 + 2.6, 9.4, 0), v3(x0 + 2.6, 9.4, 0.85), v3(x0, 9.4, 0.85)], color);
      if (title) continue;
      this.poly([v3(x0, 9.4, 0.72), v3(x0 + 2.6, 9.4, 0.72), v3(x0 + 2.6, 9.4, 0.78), v3(x0, 9.4, 0.78)], 'rgba(255,255,255,0.25)');
      if (this.cam.forward.y < 0.5) continue; // seen edge-on: skip the text
      const q = this.cam.project(v3(x0 + 1.3, 9.4, 0.36));
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = `800 ${Math.max(6, 0.26 * q.s)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(texts[i % texts.length], q.x, q.y + 0.12 * q.s);
    }
    if (title && this.cam.forward.y >= 0.5) {
      for (const cx of [-5.2, 5.2]) {
        const q = this.cam.project(v3(cx, 9.4, 0.36));
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.max(6, Math.min(0.26, 4.4 / Math.max(8, title.length)) * q.s)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(title.toUpperCase(), q.x, q.y + 0.1 * q.s);
      }
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const y0 = -9 + i * 3.05;
        // Read from the court: left-hand boards run near to far, right-hand ones far to near.
        const ad = i === 2 ? (s < 0 ? ads.ventra : ads.solar) : i === 4 ? (s < 0 ? ads.solar : ads.ventra) : undefined;
        if (ad) {
          const [ya, yb] = s < 0 ? [y0, y0 + 3.05] : [y0 + 3.05, y0];
          this.adBoard(ad, v3(s * 6.6, ya, 0.85), v3(s * 6.6, yb, 0.85), v3(s * 6.6, ya, 0));
          continue;
        }
        this.poly([v3(s * 6.6, y0, 0), v3(s * 6.6, y0 + 3.05, 0), v3(s * 6.6, y0 + 3.05, 0.85), v3(s * 6.6, y0, 0.85)], C.boards[(i + (s > 0 ? 1 : 3)) % C.boards.length]);
        this.poly([v3(s * 6.6, y0, 0.72), v3(s * 6.6, y0 + 3.05, 0.72), v3(s * 6.6, y0 + 3.05, 0.78), v3(s * 6.6, y0, 0.78)], 'rgba(255,255,255,0.22)');
      }
    }
  }

  /**
   * A sponsor's board: its background colour, with the banner fitted inside and drawn in perspective.
   * tl / tr: the board's top corners left to right as you read it; bl: bottom left.
   */
  private adBoard(ad: Ad, tl: V3, tr: V3, bl: V3) {
    const br = v3(tr.x + bl.x - tl.x, tr.y + bl.y - tl.y, tr.z + bl.z - tl.z);
    this.poly([tl, tr, br, bl], ad.bg);
    const cam = this.cam;
    if ([tl, tr, bl, br].some((p) => cam.depth(p) < 0.5)) return;
    // Fit the banner inside a small margin, keeping its shape.
    const len = Math.hypot(tr.x - tl.x, tr.y - tl.y), hgt = tl.z - bl.z, m = 0.07;
    const aw = len - 2 * m, ah = hgt - 2 * m, ratio = ad.banner.width / ad.banner.height;
    const w = Math.min(aw, ah * ratio), h = w / ratio;
    const u0 = (len - w) / 2 / len, u1 = u0 + w / len, v0 = (hgt - h) / 2 / hgt, v1 = v0 + h / hgt;
    const at = (u: number, v: number) => cam.project(v3(tl.x + (tr.x - tl.x) * u + (bl.x - tl.x) * v, tl.y + (tr.y - tl.y) * u + (bl.y - tl.y) * v, tl.z + (tr.z - tl.z) * u + (bl.z - tl.z) * v));
    // In thin vertical strips, each mapped flat, so a board seen at an angle keeps its perspective.
    const ctx = this.ctx, iw = ad.banner.width, ih = ad.banner.height, N = 12, sw = iw / N;
    for (let k = 0; k < N; k++) {
      const ua = u0 + ((u1 - u0) * k) / N, ub = u0 + ((u1 - u0) * (k + 1)) / N;
      const a = at(ua, v0), b = at(ub, v0), c = at(ua, v1);
      ctx.save();
      ctx.transform((b.x - a.x) / sw, (b.y - a.y) / sw, (c.x - a.x) / ih, (c.y - a.y) / ih, a.x, a.y);
      // A hair wider than the strip so no seams show between them.
      ctx.drawImage(ad.banner, k * sw, 0, Math.min(sw + 1, iw - k * sw), ih, 0, 0, Math.min(sw + 1, iw - k * sw), ih);
      ctx.restore();
    }
  }

  private court(doubles: boolean) {
    const W = COURT.doublesHalfWidth, S = COURT.singlesHalfWidth, L = COURT.halfLength;
    this.poly([v3(-W - 1.6, -L - 2.2), v3(W + 1.6, -L - 2.2), v3(W + 1.6, L + 2.2), v3(-W - 1.6, L + 2.2)], C.surround);
    this.poly([v3(-W, -L), v3(W, -L), v3(W, L), v3(-W, L)], C.court);
    // Faint mat seams.
    for (let x = -W; x < W - 0.01; x += 1.22) {
      this.poly([v3(x, -L), v3(x + 0.61, -L), v3(x + 0.61, L), v3(x, L)], 'rgba(255,255,255,0.025)');
    }
    // Doubles side alleys are out in singles: shade them so the singles court reads clearly.
    if (!doubles) {
      this.poly([v3(-W, -L), v3(-S, -L), v3(-S, L), v3(-W, L)], C.alley);
      this.poly([v3(S, -L), v3(W, -L), v3(W, L), v3(S, L)], C.alley);
    }
    for (const l of LINES) this.poly(rect3(l), C.line);
  }

  /** A challenge's target box on the far court: a pulsing fill and bright edge, flashing green on a hit. */
  private targetZone(game: Game, time: number) {
    const z = game.targetZone!, X = COURT.singlesHalfWidth;
    const hit = game.zoneFlash < 0.6, pulse = 0.5 + 0.5 * Math.sin(time * 3);
    const corners = [v3(-X, z.d0, 0.002), v3(X, z.d0, 0.002), v3(X, z.d1, 0.002), v3(-X, z.d1, 0.002)];
    this.poly(corners, hit ? `rgba(80,220,120,${0.55 - game.zoneFlash * 0.6})` : `rgba(255,209,102,${0.16 + 0.1 * pulse})`);
    const ctx = this.ctx, p = corners.map((c) => this.cam.project(c));
    ctx.beginPath();
    p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.strokeStyle = hit ? '#50dc78' : '#ffd166';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private lights(w: number, h: number) {
    const ctx = this.ctx;
    const c = this.cam.project(v3(0, 0, 0));
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(w, h) * 0.55);
    g.addColorStop(0, 'rgba(255,250,235,0.07)');
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private vignette(w: number, h: number) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.45, w / 2, h * 0.5, Math.max(w, h) * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private net() {
    const N = 24, X = COURT.postX, depth = COURT.netHeightPost - COURT.netBottom;
    const top: V3[] = [], bottom: V3[] = [];
    for (let i = 0; i <= N; i++) {
      const x = -X + (2 * X * i) / N, t = netHeightAt(x);
      top.push(v3(x, 0, t));
      bottom.push(v3(x, 0, t - depth));
    }
    this.poly([...top, ...bottom.reverse()], C.netFill);
    for (let x = -X; x <= X + 1e-6; x += 0.2) {
      const t = netHeightAt(x);
      this.seg(v3(x, 0, t), v3(x, 0, t - depth), 0.006, C.netMesh, 0.5);
    }
    for (const f of [0.25, 0.5, 0.75]) this.seg(v3(-X, 0, COURT.netHeightPost - depth * f), v3(X, 0, COURT.netHeightPost - depth * f), 0.006, C.netMesh, 0.5);
    const ctx = this.ctx;
    ctx.beginPath();
    top.forEach((p, i) => { const q = this.cam.project(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.strokeStyle = C.tape;
    ctx.lineWidth = Math.max(2, 0.05 * this.cam.project(v3(0, 0, 1.5)).s);
    ctx.stroke();
    for (const s of [-1, 1]) {
      this.poly(this.floorCircle({ x: s * X, y: 0 }, 0.16, 16), '#3a4553');
      this.seg(v3(s * X, 0, 0), v3(s * X, 0, COURT.netHeightPost + 0.02), 0.045, C.post, 2);
    }
  }

  private shadows(scene: Scene, officials: Official[]) {
    for (const p of scene.players) this.poly(this.floorCircle(p.pos, 0.32 * (1 - Math.min(0.4, p.z))), C.shadow);
    for (const o of officials) this.poly(this.floorCircle(o.pos, o.kind === 'umpire' ? 0.5 : 0.32), 'rgba(0,0,0,0.25)');
    const s = scene.shuttle;
    const r = 0.07 + Math.min(0.08, s.pos.z * 0.01);
    const alpha = 0.5 * (1 - Math.min(0.7, s.pos.z / 9));
    this.poly(this.floorCircle(s.pos, r), `rgba(0,0,0,${alpha.toFixed(3)})`);
  }

  // ── Overlays on the floor ──────────────────────────────────────────────────

  /** Predicted landing spot plus a dotted line from the shuttle to the floor, to help read depth. */
  private guides(game: Game) {
    const s = game.shuttle;
    if (!s.inFlight || game.state !== 'rally' || game.disguiseT > 0) return;
    const ctx = this.ctx;
    const a = this.cam.project(s.pos), b = this.cam.project(v3(s.pos.x, s.pos.y, 0));
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // The original marker: small ring plus centre dot. Its centre is only slightly off (markerError).
    const p = game.marker;
    if (!p || !game.predicted) return;
    const ring = this.cam.projectPoly(this.floorCircle(p, VISUAL.markerRadius));
    ctx.beginPath();
    ring.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,209,102,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,102,0.85)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    this.dotAt(v3(p.x, p.y), 0.02, 'rgba(255,209,102,0.95)', 2);
  }

  /** Doubles: a white ring under the player you control, so you never lose yourself among four. */
  private youRing(game: Game, time: number) {
    const p = game.players[0];
    const ring = this.cam.projectPoly(this.floorCircle(p.pos, 0.46 + 0.02 * Math.sin(time * 4))), ctx = this.ctx;
    ctx.beginPath();
    ring.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  /** Small "YOU" tag over your head (doubles). */
  private youTag(game: Game) {
    const p = game.players[0];
    if (p.shout) return;
    const q = this.cam.project(v3(p.pos.x, p.pos.y, p.z + 2.05));
    const ctx = this.ctx;
    ctx.font = '800 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText('YOU').width;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.roundRect(q.x - tw / 2 - 7, q.y - 14, tw + 14, 19, 4);
    ctx.fill();
    ctx.fillStyle = '#0c1422';
    ctx.fillText('YOU', q.x, q.y);
  }

  /** "Mine!" / "Yours!" speech bubble over a player. */
  private shoutBubble(p: { pos: V2; z: number; color: string; shout: { text: string; t: number; ttl: number } | null }) {
    if (!p.shout) return;
    const q = this.cam.project(v3(p.pos.x, p.pos.y, p.z + 2.15));
    const ctx = this.ctx;
    const a = Math.min(1, (p.shout.ttl - p.shout.t) / 0.2);
    ctx.globalAlpha = Math.max(0, a);
    ctx.font = '900 15px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(p.shout.text).width;
    ctx.fillStyle = 'rgba(6,10,16,0.88)';
    ctx.beginPath();
    ctx.roundRect(q.x - tw / 2 - 10, q.y - 20, tw + 20, 26, 6);
    ctx.fill();
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(p.shout.text, q.x, q.y - 2);
    ctx.globalAlpha = 1;
  }

  /** Pulsing yellow ring to run to (tutorial). */
  private targetRing(c: V2, time: number) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    this.poly(this.floorCircle(c, 0.42), `rgba(255,209,102,${(0.15 + 0.15 * pulse).toFixed(3)})`);
    const ring = this.cam.projectPoly(this.floorCircle(c, 0.42 + 0.05 * pulse)), ctx = this.ctx;
    ctx.beginPath();
    ring.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private landingMark(l: NonNullable<Game['landing']>) {
    const color = l.call === null ? C.hudDim : l.call === 'IN' ? C.callIn : C.callOut;
    this.poly(this.floorCircle(l.p, 0.12), color);
    if (!l.call) return;
    const q = this.cam.project(v3(l.p.x, l.p.y, 0.55));
    const ctx = this.ctx;
    ctx.font = `800 ${Math.max(14, q.s * 0.28)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(l.call, q.x, q.y);
    ctx.fillStyle = color;
    ctx.fillText(l.call, q.x, q.y);
  }

  private reticle(game: Game) {
    const ctrl = game.controllers[0];
    if (game.state !== 'serve' && game.state !== 'rally') return;
    const t = ctrl instanceof MouseController ? ctrl.target() : ctrl instanceof KeyboardController ? ctrl.target() : null;
    if (!t || t.y * game.players[0].side > 0) return;
    const ok = game.state === 'serve' && game.server === game.players[0]
      ? isIn(t, serviceBox(game.receiver.side, game.match.serverInRightCourt(), game.doublesCourt))
      : inHalf(t, 1, game.doubles);
    const ring = this.cam.projectPoly(this.floorCircle(t, 0.3)), ctx = this.ctx;
    ctx.beginPath();
    ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = ok ? 'rgba(255,255,255,0.85)' : 'rgba(255,91,91,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const charge = game.players[0].charge;
    if (ctrl instanceof MouseController && charge !== null && ctrl.arc && game.state === 'rally') {
      // Where this swing will actually go: drops pulled short, lobs pushed deep.
      const kind = mouseShotKind(ctrl.arc, charge);
      const e = mouseTarget(ctrl.arc, charge, t, 1);
      // Name it from where you'll actually meet the shuttle (or a guess from where you're standing).
      const me = game.players[0];
      const meet = game.forecast(0)?.point
        ?? v3(me.pos.x, me.pos.y, Math.abs(me.pos.y) < 2.3 ? 0.8 : Math.abs(me.pos.y) > 4.5 ? 2.4 : 1.5);
      const name = mouseShotName(kind, meet);
      const color = kind === 'drop' ? 'rgba(120,220,170,0.6)' : kind === 'lob' ? 'rgba(120,190,255,0.6)' : kind === 'smash' ? 'rgba(255,110,80,0.65)' : 'rgba(255,200,90,0.6)';
      this.poly(this.floorCircle(e, 0.12 + 0.18 * charge), color);
      const q = this.cam.project(v3(e.x, e.y, 0.5));
      ctx.font = '900 15px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(name).width;
      ctx.fillStyle = 'rgba(6,10,16,0.82)';
      ctx.beginPath();
      ctx.roundRect(q.x - tw / 2 - 10, q.y - 18, tw + 20, 24, 12);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = C.hud;
      ctx.fillText(name, q.x, q.y);
    }
  }

  /**
   * Small light beside a human player's head. Before the hit it says when to swing: yellow = too early
   * (the shuttle won't be in reach when the racket gets there), green = swing now, red = too late,
   * grey = out of reach. Right after a hit it shows how you actually timed it.
   */
  private timingLight(game: Game, i: number) {
    const p = game.players[i];
    const flash = p.timingFlash;
    const f = flash ? null : game.forecast(i);
    if (!flash && !f) return;
    const state = flash ? (flash.kind === 'perfect' ? 'now' : flash.kind) : f!.light;
    const color = state === 'now' ? '#4ade80' : state === 'early' ? '#facc15' : state === 'late' ? '#f87171' : 'rgba(255,255,255,0.35)';
    const q = this.cam.project(v3(p.pos.x, p.pos.y, p.z + 1.75));
    const x = q.x + Math.max(14, 0.32 * q.s), y = q.y;
    const r = flash ? 9 : 7;
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = state === 'none' || this.lite ? 0 : 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (flash) {
      ctx.font = '800 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = color;
      ctx.fillText(flash.kind === 'perfect' ? 'PERFECT' : flash.kind === 'early' ? 'EARLY' : 'LATE', x + 12, y + 4);
    }
  }

  // ── People ─────────────────────────────────────────────────────────────────

  /** Draw body parts back to front so limbs overlap correctly from any camera. */
  private drawParts(parts: { at: V3; draw: () => void }[]) {
    parts.map((p) => ({ p, d: this.cam.depth(p.at) })).sort((a, b) => b.d - a.d).forEach(({ p }) => p.draw());
  }

  private head(center: V3, face: V3, radius: number) {
    // Hair on the back of the head; the face shows only when it's turned toward the camera.
    const back = sub3(center, mul3(face, 0.035));
    const front = add3(center, mul3(face, 0.025));
    if (this.cam.depth(front) < this.cam.depth(back)) {
      this.dotAt(add3(back, v3(0, 0, 0.02)), radius, C.hair, 2);
      this.dotAt(center, radius * 0.92, C.skin, 2);
      this.dotAt(add3(center, v3(0, 0, radius * 0.55)), radius * 0.8, C.hair, 1);
    } else {
      this.dotAt(center, radius, C.skin, 2);
      this.dotAt(add3(back, v3(0, 0, 0.015)), radius * 0.98, C.hair, 2);
    }
  }

  private player(v: PlayerView) {
    const fwd = v3(0, -v.side, 0), right = v3(-v.side, 0, 0);
    const rs = v.racketSide;
    const L = lungeAmount(v), sp = splitAmount(v), crouch = crouchOf(v);
    const z0 = v.z + sp * 0.06;
    const ld = v3(v.lungeDir.x, v.lungeDir.y, 0);
    const pelvis = v3(v.pos.x + ld.x * L * 0.18, v.pos.y + ld.y * L * 0.18, z0 + 0.92 - crouch);
    const hipR = add3(pelvis, mul3(right, 0.11)), hipL = add3(pelvis, mul3(right, -0.11));

    // Feet: scissor kick in the air, lunge, or a split-step stance / running / side-shuffling.
    const speed = Math.hypot(v.vel.x, v.vel.y);
    const m = speed > 0.3 ? v3(v.vel.x / speed, v.vel.y / speed, 0) : fwd;
    const base = v3(v.pos.x, v.pos.y, 0);
    let racketFoot: V3, otherFoot: V3;
    if (v.z > 0.03) {
      const k = clamp(v.vz / 3, -1, 1); // racket leg kicks back on the way up, through on the way down
      racketFoot = add3(add3(base, mul3(fwd, -0.3 * k)), v3(rs * 0.14, 0, v.z + 0.06 + Math.max(0, k) * 0.18));
      otherFoot = add3(add3(base, mul3(fwd, 0.3 * k)), v3(-rs * 0.14, 0, v.z + 0.1 + Math.max(0, -k) * 0.12));
    } else if (L > 0.02) {
      racketFoot = add3(base, add3(mul3(ld, 0.85 * L), v3(rs * 0.1, 0, 0)));
      otherFoot = add3(base, add3(mul3(ld, -0.45 * L), v3(-rs * 0.12, 0, 0)));
    } else {
      const wStance = 0.17 + sp * 0.12;
      const gait = Math.min(1, speed / 2.5);
      const shuffle = Math.abs(m.x) > 0.75;
      const dir = shuffle ? right : m;
      const s = Math.sin(v.stride) * (shuffle ? 0.1 : 0.26) * gait;
      racketFoot = add3(base, add3(v3(rs * wStance, 0, 0), mul3(dir, s)));
      otherFoot = add3(base, add3(v3(-rs * wStance, 0, 0), mul3(dir, -s)));
      racketFoot.z = Math.max(0, Math.cos(v.stride)) * 0.09 * gait;
      otherFoot.z = Math.max(0, -Math.cos(v.stride)) * 0.09 * gait;
    }
    const rIsRight = rs === right.x;
    const footR = rIsRight ? racketFoot : otherFoot, footL = rIsRight ? otherFoot : racketFoot;
    const kneeBend = add3(L > 0.02 ? ld : fwd, v3(0, 0, 0.1));
    const kneeR = ik(hipR, footR, 0.46, 0.46, kneeBend), kneeL = ik(hipL, footL, 0.46, 0.46, kneeBend);

    const sh = shoulderOf(v);
    const neck = v3(pelvis.x + fwd.x * 0.04 + ld.x * L * 0.12, pelvis.y + fwd.y * 0.04 + ld.y * L * 0.12, pelvis.z + 0.52);
    const offSh = v3(2 * neck.x - sh.x, 2 * neck.y - sh.y, sh.z);
    const hand = v.hand;
    const elbow = ik(sh, hand, 0.3, 0.29, add3(v3(0, 0, -1), mul3(fwd, -0.3)));
    const raised = hand.z > sh.z + 0.1;
    // Serving: the free hand holds the shuttle by its feathers, just above the cork, out in front.
    const offHand = v.serving
      ? v3(v.pos.x + rs * 0.15, v.pos.y + fwd.y * 0.35, 1.13)
      : raised ? add3(offSh, v3(-rs * 0.05, fwd.y * 0.3, 0.42)) : add3(offSh, v3(-rs * 0.06, fwd.y * 0.24, -0.32));
    const offElbow = ik(offSh, offHand, 0.3, 0.29, v3(0, -fwd.y * 0.2, -1));
    const headC = add3(neck, v3(0, 0, 0.2));
    const throat = add3(hand, mul3(v.rdir, 0.33)), rHead = add3(hand, mul3(v.rdir, RACKET_LENGTH));
    const shirt = v.color, shirtDark = shade(v.color, 0.75);
    const mid = (a: V3, b: V3) => mul3(add3(a, b), 0.5);

    const leg = (hip: V3, knee: V3, foot: V3) => [
      { at: mid(hip, knee), draw: () => { this.seg(hip, knee, 0.13, C.skin, 2); this.seg(hip, add3(hip, mul3(sub3(knee, hip), 0.5)), 0.175, C.shorts, 3); } },
      { at: mid(knee, foot), draw: () => { this.seg(knee, foot, 0.1, C.skin, 1.6); this.seg(add3(foot, mul3(sub3(knee, foot), 0.28)), foot, 0.105, C.sock, 1.6); } },
      { at: foot, draw: () => this.seg(foot, add3(foot, mul3(fwd, 0.12)), 0.085, C.shoe, 2) },
    ];
    this.drawParts([
      ...leg(hipR, kneeR, footR),
      ...leg(hipL, kneeL, footL),
      {
        at: mid(pelvis, neck),
        draw: () => {
          this.seg(pelvis, neck, 0.3, shirt, 4);
          this.poly([add3(hipL, v3(0, 0, -0.04)), add3(hipR, v3(0, 0, -0.04)), add3(neck, mul3(right, 0.2)), add3(neck, mul3(right, -0.2))], shirt);
          this.seg(add3(neck, mul3(right, -0.2)), add3(hipL, v3(0, 0, -0.02)), 0.04, shirtDark, 1);
        },
      },
      { at: mid(sh, elbow), draw: () => { this.seg(sh, elbow, 0.085, C.skin, 1.6); this.seg(sh, add3(sh, mul3(sub3(elbow, sh), 0.45)), 0.11, shirt, 2); } },
      { at: mid(elbow, hand), draw: () => this.seg(elbow, hand, 0.075, C.skin, 1.5) },
      { at: mid(offSh, offElbow), draw: () => { this.seg(offSh, offElbow, 0.085, C.skin, 1.6); this.seg(offSh, add3(offSh, mul3(sub3(offElbow, offSh), 0.45)), 0.11, shirt, 2); } },
      { at: mid(offElbow, offHand), draw: () => this.seg(offElbow, offHand, 0.075, C.skin, 1.5) },
      { at: headC, draw: () => this.head(headC, fwd, 0.115) },
      {
        at: throat,
        draw: () => {
          this.seg(hand, throat, 0.02, '#3b4048', 1.4);
          const q = this.cam.project(rHead), qt = this.cam.project(throat), ctx = this.ctx;
          const ang = Math.atan2(q.y - qt.y, q.x - qt.x);
          ctx.beginPath();
          ctx.ellipse(q.x, q.y, Math.max(3, 0.13 * q.s), Math.max(2.4, 0.1 * q.s), ang, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          ctx.fill();
          ctx.strokeStyle = v.racket ?? C.racket;
          ctx.lineWidth = Math.max(1.2, 0.014 * q.s);
          ctx.stroke();
        },
      },
    ]);

    if (v.charge !== null) {
      const q = this.cam.project(v3(v.pos.x, v.pos.y, z0 + 2.05)), ctx = this.ctx;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v.charge);
      ctx.strokeStyle = v.charge >= SHOTS.mouse.smashPower ? C.accent : C.hud;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  private official(o: Official, look: V3 | null) {
    const f = v3(o.facing.x, o.facing.y, 0), side = v3(-o.facing.y, o.facing.x, 0);
    const base = v3(o.pos.x, o.pos.y, 0);
    const seat = o.seat;
    const at = (fw: number, sd: number, z: number) => add3(base, add3(add3(mul3(f, fw), mul3(side, sd)), v3(0, 0, z)));

    // Chair: the umpire's is a tall stand with a ladder and desk.
    if (o.kind === 'umpire') {
      for (const [a, b] of [[-0.3, -0.3], [-0.3, 0.3], [0.3, -0.3], [0.3, 0.3]]) this.seg(at(a, b, 0), at(a, b, seat - 0.05), 0.04, C.chair, 1.5);
      for (let z = 0.3; z < seat - 0.1; z += 0.3) this.seg(at(-0.3, -0.3, z), at(-0.3, 0.3, z), 0.025, C.chair, 1);
      this.poly([at(-0.32, -0.32, seat - 0.05), at(0.32, -0.32, seat - 0.05), at(0.32, 0.32, seat - 0.05), at(-0.32, 0.32, seat - 0.05)], '#c3cad3');
      this.poly([at(-0.3, -0.25, seat), at(-0.3, 0.25, seat), at(-0.3, 0.25, seat + 0.55), at(-0.3, -0.25, seat + 0.55)], '#8d96a1');
      this.poly([at(0.3, -0.3, seat + 0.25), at(0.3, 0.3, seat + 0.25), at(0.55, 0.3, seat + 0.27), at(0.55, -0.3, seat + 0.27)], '#d7dce2');
    } else {
      for (const [a, b] of [[-0.18, -0.18], [-0.18, 0.18], [0.18, -0.18], [0.18, 0.18]]) this.seg(at(a, b, 0), at(a, b, seat), 0.025, C.chair, 1);
      this.poly([at(-0.2, -0.2, seat), at(0.2, -0.2, seat), at(0.2, 0.2, seat), at(-0.2, 0.2, seat)], '#7d8792');
      this.poly([at(-0.2, -0.2, seat), at(-0.2, 0.2, seat), at(-0.2, 0.2, seat + 0.45), at(-0.2, -0.2, seat + 0.45)], '#6b7480');
    }

    // Seated figure
    const hip = at(-0.05, 0, seat + 0.1);
    const knees = [at(0.38, -0.11, seat + 0.08), at(0.38, 0.11, seat + 0.08)];
    const feet = o.kind === 'umpire' ? [at(0.42, -0.12, seat - 0.4), at(0.42, 0.12, seat - 0.4)] : [at(0.45, -0.12, 0.02), at(0.45, 0.12, 0.02)];
    const neck = at(0.0, 0, seat + 0.66);
    const shL = add3(neck, mul3(side, -0.19)), shR = add3(neck, mul3(side, 0.19));
    let handL: V3, handR: V3;
    const raise = Math.min(1, o.signalT / 0.18);
    if (o.signal === 'out') {
      // Arms straight out to the sides.
      handL = add3(shL, add3(mul3(side, -0.62 * raise), v3(0, 0, (1 - raise) * -0.4)));
      handR = add3(shR, add3(mul3(side, 0.62 * raise), v3(0, 0, (1 - raise) * -0.4)));
    } else if (o.signal === 'in') {
      // Right hand points down at the line.
      handL = add3(knees[0], v3(0, 0, 0.05));
      handR = add3(shR, add3(mul3(f, 0.5 * raise), v3(0, 0, -0.38)));
    } else if (o.kind === 'umpire') {
      handL = at(0.38, -0.12, seat + 0.3);
      handR = at(0.38, 0.12, seat + 0.3);
    } else {
      handL = add3(knees[0], v3(-f.x * 0.12, -f.y * 0.12, 0.05));
      handR = add3(knees[1], v3(-f.x * 0.12, -f.y * 0.12, 0.05));
    }
    const head = add3(neck, v3(0, 0, 0.18));
    let face = f;
    if (look && o.kind === 'umpire') {
      const d = v3(look.x - head.x, look.y - head.y, 0);
      if (len3(d) > 0.1) face = norm3(d);
    }
    const arm = (s: V3, hnd: V3) => () => {
      const e = ik(s, hnd, 0.29, 0.28, v3(0, 0, -1));
      this.seg(s, e, 0.085, C.blazer, 1.6);
      this.seg(e, hnd, 0.075, C.blazer, 1.5);
      this.dotAt(hnd, 0.04, C.skin, 1);
    };
    this.drawParts([
      ...[0, 1].map((i) => ({ at: knees[i], draw: () => { this.seg(hip, knees[i], 0.14, C.trousers, 2); this.seg(knees[i], feet[i], 0.12, C.trousers, 2); this.seg(feet[i], add3(feet[i], mul3(f, 0.1)), 0.07, '#111', 1.5); } })),
      { at: mul3(add3(hip, neck), 0.5), draw: () => { this.seg(hip, neck, 0.34, C.blazer, 4); this.seg(add3(neck, v3(0, 0, -0.02)), add3(neck, add3(mul3(f, 0.04), v3(0, 0, -0.14))), 0.07, '#e8ecf0', 1.5); } },
      { at: mul3(add3(shL, handL), 0.5), draw: arm(shL, handL) },
      { at: mul3(add3(shR, handR), 0.5), draw: arm(shR, handR) },
      { at: head, draw: () => this.head(head, face, 0.1) },
    ]);
  }

  // ── Shuttle ────────────────────────────────────────────────────────────────

  private shuttle(s: ShuttleView, w: number) {
    const ctx = this.ctx;
    const top = this.cam.project(s.pos);
    if (top.y < 8) {
      // Above the top of the screen: marker at the edge.
      const x = clamp(top.x, 12, w - 12);
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x - 7, 16);
      ctx.lineTo(x + 7, 16);
      ctx.closePath();
      ctx.fillStyle = C.hud;
      ctx.fill();
      return;
    }
    const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
    if (!this.lite && s.inFlight && speed > 14 && s.trail.length > 2) {
      for (let i = 1; i < s.trail.length; i++) {
        const a = i / s.trail.length;
        this.seg(s.trail[i - 1], s.trail[i], 0.04, `rgba(255,255,255,${(a * 0.35).toFixed(3)})`, 1);
      }
    }
    const k = VISUAL.shuttleScale, d = s.dir, p = s.pos;
    const back = v3(p.x - d.x * 0.02 * k, p.y - d.y * 0.02 * k, p.z - d.z * 0.02 * k);
    const end = v3(p.x - d.x * 0.085 * k, p.y - d.y * 0.085 * k, p.z - d.z * 0.085 * k);
    const pc = this.cam.project(p), pb = this.cam.project(back), pe = this.cam.project(end);
    const sR = 0.033 * k * pe.s, cR = 0.013 * k * pc.s;
    let vx = pe.x - pb.x, vy = pe.y - pb.y;
    const len = Math.hypot(vx, vy);
    if (len < 0.01) { vx = 0; vy = 1; } else { vx /= len; vy /= len; }
    const nx = -vy, ny = vx;
    const disc = sR * Math.max(0.15, 1 - len / (sR * 3));
    ctx.beginPath();
    ctx.ellipse(pe.x, pe.y, Math.max(1, sR), Math.max(1, disc), Math.atan2(ny, nx), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(235,238,240,0.9)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pb.x + nx * cR * 0.9, pb.y + ny * cR * 0.9);
    ctx.lineTo(pe.x + nx * sR, pe.y + ny * sR);
    ctx.lineTo(pe.x - nx * sR, pe.y - ny * sR);
    ctx.lineTo(pb.x - nx * cR * 0.9, pb.y - ny * cR * 0.9);
    ctx.closePath();
    ctx.fillStyle = C.skirt;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,130,140,0.6)';
    ctx.lineWidth = 0.75;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pc.x, pc.y, Math.max(1.6, cR * 1.1), 0, Math.PI * 2);
    ctx.fillStyle = C.cork;
    ctx.fill();
  }
}
