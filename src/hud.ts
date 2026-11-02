import { COURT, KEYS, VISUAL } from './config';
import type { Game } from './game';
import { clamp } from './math';
import type { PlayerSummary } from './stats';

const C = VISUAL.colors;
const font = (px: number, weight = 600) => `${weight} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 12, fill = C.panel) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

export class Hud {
  constructor(private ctx: CanvasRenderingContext2D) {}

  draw(game: Game, w: number, h: number, time: number) {
    if (game.state === 'replay') { this.replay(game, w, h, time); return; }
    if (game.state === 'matchOver') { this.scoreboard(game); this.endScreen(game, w, h); return; }
    const ctx = this.ctx;
    if (game.session) this.sessionPanel(game, w);
    else {
      this.scoreboard(game);
      this.clock(game);
      this.rally(game, w);
    }

    // Shot callout
    const c = game.state === 'serve' ? null : game.callout;
    if (c) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (1.8 - c.t) / 0.4));
      ctx.textAlign = 'center';
      ctx.fillStyle = c.color;
      ctx.font = font(22, 800);
      ctx.fillText(c.label.toUpperCase(), w / 2, h - 66);
      if (c.detail) {
        ctx.fillStyle = C.hud;
        ctx.font = font(13, 600);
        ctx.fillText(c.detail, w / 2, h - 46);
      }
      ctx.globalAlpha = 1;
    }

    this.banner(game, w, h);

    if (game.challengeOpen) {
      const call = game.call!;
      const loser = call.callIn ? 1 - call.hitter : call.hitter;
      const n = game.challenges[loser];
      const pulse = 0.75 + 0.25 * Math.sin(time * 6);
      const bw = 300, x = w / 2 - bw / 2, y = h * 0.36 + 70;
      ctx.globalAlpha = pulse;
      panel(ctx, x, y, bw, 40, 20, 'rgba(255,209,102,0.16)');
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.fillStyle = C.accent;
      ctx.font = font(15, 800);
      ctx.fillText(`H — Challenge with Hawk-Eye (${n} left)`, w / 2, y + 26);
    }

    // Umpire caption
    const cap = game.caption;
    if (cap && cap.t < 4) {
      ctx.globalAlpha = Math.min(1, (4 - cap.t) / 0.5);
      ctx.font = font(13, 600);
      const label = cap.who === 'umpire' ? 'UMPIRE' : cap.who === 'line' ? 'LINE JUDGE' : 'SERVICE JUDGE';
      const tw = ctx.measureText(cap.text).width;
      panel(ctx, 16, h - 98, tw + 120, 32, 8);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.accent;
      ctx.font = font(10, 800);
      ctx.fillText(label, 28, h - 78);
      ctx.fillStyle = C.hud;
      ctx.font = font(13, 600);
      ctx.fillText(cap.text, 112, h - 77);
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'center';
    ctx.font = font(14, 600);
    const prompt = this.servePrompt(game);
    if (prompt) {
      ctx.fillStyle = C.hud;
      ctx.fillText(prompt, w / 2, h - 44);
    }
    ctx.fillStyle = C.hudDim;
    ctx.font = font(12, 500);
    ctx.fillText(this.controlsHint(game), w / 2, h - 18);

    if (game.paused) {
      ctx.fillStyle = 'rgba(5,8,12,0.6)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = C.hud;
      ctx.font = font(34, 800);
      ctx.fillText('Paused', w / 2, h / 2 - 10);
      ctx.font = font(15, 500);
      ctx.fillText('Esc to resume  ·  Q to quit to menu', w / 2, h / 2 + 22);
    }
  }

  /** Tutorial step / practice drill card at the top of the screen. */
  private sessionPanel(game: Game, w: number) {
    const ctx = this.ctx, p = game.session!.panel();
    const pw = Math.min(760, w - 32), x = (w - pw) / 2, y = 14;
    ctx.font = font(15, 500);
    const lines = wrap(ctx, p.text, pw - 40);
    const ph = 70 + lines.length * 21 + (p.progress ? 22 : 0) + 22;
    panel(ctx, x, y, pw, ph, 14, 'rgba(8,12,18,0.86)');
    ctx.fillStyle = C.accent;
    ctx.fillRect(x, y + 14, 4, ph - 28);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.accent;
    ctx.font = font(11, 800);
    ctx.fillText(p.tag, x + 20, y + 24);
    ctx.fillStyle = C.hud;
    ctx.font = font(22, 800);
    ctx.fillText(p.title, x + 20, y + 52);
    ctx.font = font(15, 500);
    lines.forEach((l, i) => ctx.fillText(l, x + 20, y + 78 + i * 21));
    let by = y + 78 + lines.length * 21;
    if (p.progress) {
      const [n, of] = p.progress;
      for (let k = 0; k < of; k++) {
        ctx.beginPath();
        ctx.arc(x + 28 + k * 24, by + 4, 8, 0, Math.PI * 2);
        ctx.fillStyle = k < n ? C.callIn : 'rgba(255,255,255,0.12)';
        ctx.fill();
        ctx.strokeStyle = k < n ? C.callIn : 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      by += 22;
    }
    ctx.fillStyle = C.hudDim;
    ctx.font = font(12, 600);
    ctx.fillText(p.footer, x + 20, by + 12);
  }

  private banner(game: Game, w: number, h: number) {
    const bn = game.banner;
    if (!bn) return;
    const ctx = this.ctx;
    ctx.font = font(28, 800);
    const tw = ctx.measureText(bn.title).width;
    ctx.font = font(16, 600);
    const sw = ctx.measureText(bn.sub).width;
    const bw = Math.min(w - 40, Math.max(460, tw + 60, sw + 60)), bh = 98;
    const x = w / 2 - bw / 2, y = h * 0.36 - bh / 2;
    ctx.globalAlpha = Math.min(1, bn.t / 0.15);
    panel(ctx, x, y, bw, bh, 14);
    ctx.fillStyle = bn.color;
    ctx.fillRect(x, y + 14, 4, bh - 28);
    ctx.textAlign = 'center';
    ctx.fillStyle = bn.color;
    ctx.font = font(28, 800);
    ctx.fillText(bn.title, w / 2, y + 44);
    ctx.fillStyle = C.hud;
    ctx.font = font(16, 600);
    ctx.fillText(bn.sub, w / 2, y + 74);
    ctx.globalAlpha = 1;
  }

  /** Broadcast-style score bug. */
  private scoreboard(game: Game) {
    const ctx = this.ctx, m = game.match;
    const x = 16, y = 16, rowH = 32, bw = 340;
    panel(ctx, x, y, bw, 28 + rowH * 2 + 8);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.hudDim;
    ctx.font = font(11, 700);
    const games = m.gamesToWin > 1 ? `GAME ${m.gameNumber} OF 3` : 'ONE GAME';
    ctx.fillText(`${games}  ·  TO ${m.format.pointsToWin}  ·  ${game.opponentLabel.toUpperCase()}`, x + 14, y + 19);
    game.players.forEach((p, i) => {
      const ry = y + 28 + rowH * i;
      ctx.fillStyle = p.color;
      ctx.fillRect(x + 10, ry + 6, 4, rowH - 10);
      ctx.fillStyle = C.hud;
      ctx.font = font(16, 700);
      ctx.fillText(p.name, x + 24, ry + 23);
      // Challenges left this game
      for (let k = 0; k < game.challenges[i]; k++) {
        ctx.fillStyle = 'rgba(255,209,102,0.85)';
        ctx.fillRect(x + 88 + k * 9, ry + 14, 6, 6);
      }
      if (game.server === p && (game.state === 'serve' || game.state === 'rally')) {
        ctx.fillStyle = C.accent;
        ctx.beginPath();
        ctx.arc(x + 124, ry + 17, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = font(13, 700);
      m.history.forEach((g, gi) => {
        ctx.fillStyle = g[i] > g[1 - i] ? C.hud : C.hudDim;
        ctx.textAlign = 'center';
        ctx.fillText(String(g[i]), x + 160 + gi * 34, ry + 22);
      });
      ctx.textAlign = 'center';
      panel(ctx, x + bw - 58, ry + 3, 46, rowH - 6, 6, 'rgba(255,255,255,0.08)');
      ctx.fillStyle = C.hud;
      ctx.font = font(22, 800);
      ctx.fillText(String(m.scores[i]), x + bw - 35, ry + 25);
      ctx.textAlign = 'left';
    });
  }

  private clock(game: Game) {
    if (!(game.state === 'serve' || game.state === 'point') || !game.clockRunning) return;
    const ctx = this.ctx, s = Math.max(0, game.clock);
    const x = 16, y = 116, urgent = s <= 5;
    panel(ctx, x, y, 132, 40, 10);
    ctx.beginPath();
    ctx.arc(x + 22, y + 20, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s / 25));
    ctx.strokeStyle = urgent ? C.callOut : C.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.hudDim;
    ctx.font = font(10, 800);
    ctx.fillText('SHOT CLOCK', x + 42, y + 17);
    ctx.fillStyle = urgent ? C.callOut : C.hud;
    ctx.font = font(15, 800);
    ctx.fillText(`${Math.ceil(s)}s`, x + 42, y + 33);
  }

  private rally(game: Game, w: number) {
    const ctx = this.ctx;
    ctx.textAlign = 'right';
    ctx.fillStyle = C.hudDim;
    ctx.font = font(12, 700);
    ctx.fillText('RALLY', w - 20, 30);
    ctx.fillStyle = C.hud;
    ctx.font = font(30, 800);
    ctx.fillText(String(game.rallyHits), w - 20, 62);
    ctx.fillStyle = C.hudDim;
    ctx.font = font(12, 600);
    ctx.fillText(`Longest ${game.longestRally}`, w - 20, 82);
  }

  private replay(game: Game, w: number, h: number, time: number) {
    const ctx = this.ctx, pb = game.playback!;
    const bar = Math.round(h * 0.06);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
    ctx.fillStyle = Math.sin(time * 5) > 0 ? '#ff4040' : '#7a1f1f';
    ctx.beginPath();
    ctx.arc(28, bar / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.hud;
    ctx.font = font(16, 900);
    ctx.fillText('REPLAY', 42, bar / 2 + 6);
    ctx.fillStyle = C.hudDim;
    ctx.font = font(13, 600);
    ctx.fillText(`${pb.speed}×  ·  ${game.replayCam === 'side' ? 'Side camera' : 'Broadcast camera'}`, 120, bar / 2 + 5);
    ctx.textAlign = 'right';
    ctx.fillText('V switch camera  ·  R / Enter skip', w - 20, bar / 2 + 5);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(20, h - bar / 2 - 2, w - 40, 4);
    ctx.fillStyle = C.accent;
    ctx.fillRect(20, h - bar / 2 - 2, (w - 40) * clamp(pb.progress, 0, 1), 4);
  }

  /** End-of-match scoreboard: result, game scores, stat comparison and where each player's shots landed. */
  private endScreen(game: Game, w: number, h: number) {
    const ctx = this.ctx, m = game.match, st = game.stats;
    const [p1, p2] = game.players;
    const wi = m.games[0] > m.games[1] ? 0 : 1;
    const winner = game.players[wi];
    ctx.fillStyle = 'rgba(4,7,12,0.72)';
    ctx.fillRect(0, 0, w, h);
    const pw = Math.min(900, w - 32), ph = Math.min(h - 32, 620);
    const x = (w - pw) / 2, y = (h - ph) / 2;
    panel(ctx, x, y, pw, ph, 18, 'rgba(10,15,24,0.96)');
    ctx.fillStyle = winner.color;
    ctx.fillRect(x, y, pw, 5);

    ctx.textAlign = 'left';
    ctx.fillStyle = C.hudDim;
    ctx.font = font(12, 800);
    ctx.fillText('MATCH RESULT', x + 28, y + 36);
    ctx.fillStyle = winner.color;
    ctx.font = font(30, 900);
    ctx.fillText(winner.name === 'You' ? 'You win!' : `${winner.name} wins`, x + 28, y + 72);
    const mins = Math.floor(st.seconds / 60), secs = Math.floor(st.seconds % 60);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.hudDim;
    ctx.font = font(13, 600);
    ctx.fillText(`${mins}:${String(secs).padStart(2, '0')} match time  ·  longest rally ${st.longestRally} shots`, x + pw - 28, y + 36);

    // Game-by-game table
    const tx = x + 28, ty = y + 96;
    game.players.forEach((p, i) => {
      const ry = ty + i * 40;
      panel(ctx, tx, ry, pw - 56, 34, 8, 'rgba(255,255,255,0.04)');
      ctx.fillStyle = p.color;
      ctx.fillRect(tx, ry, 5, 34);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.hud;
      ctx.font = font(17, i === wi ? 800 : 600);
      ctx.fillText(p.name, tx + 18, ry + 23);
      m.history.forEach((g, gi) => {
        ctx.textAlign = 'center';
        ctx.fillStyle = g[i] > g[1 - i] ? C.hud : C.hudDim;
        ctx.font = font(18, g[i] > g[1 - i] ? 800 : 500);
        ctx.fillText(String(g[i]), tx + 240 + gi * 60, ry + 24);
      });
      ctx.textAlign = 'right';
      ctx.fillStyle = i === wi ? winner.color : C.hudDim;
      ctx.font = font(22, 900);
      ctx.fillText(String(m.games[i]), tx + pw - 76, ry + 25);
    });

    // Stats comparison
    const a = st.summary(0), b = st.summary(1);
    const rows: [string, (s: PlayerSummary) => number, string?][] = [
      ['Points won', (s) => s.points],
      ['Winners', (s) => s.winners],
      ['Unforced errors', (s) => s.unforced],
      ['Forced errors', (s) => s.forced],
      ['Smashes', (s) => s.smashes],
      ['Fastest smash', (s) => Math.round(s.topSmash), ' km/h'],
      ['Forehand winners', (s) => s.forehandWinners],
      ['Backhand winners', (s) => s.backhandWinners],
      ['Challenges won', (s) => s.challengesWon],
    ];
    const sx = x + 28, sy = ty + 100, sw = pw * 0.56, rh = Math.min(34, (ph - (sy - y) - 60) / rows.length);
    ctx.font = font(12, 800);
    ctx.textAlign = 'left';
    ctx.fillStyle = p1.color;
    ctx.fillText(p1.name.toUpperCase(), sx, sy - 10);
    ctx.textAlign = 'right';
    ctx.fillStyle = p2.color;
    ctx.fillText(p2.name.toUpperCase(), sx + sw, sy - 10);
    rows.forEach(([label, get, unit], i) => {
      const ry = sy + i * rh;
      const va = get(a), vb = get(b), total = Math.max(1, va + vb);
      ctx.textAlign = 'center';
      ctx.fillStyle = C.hudDim;
      ctx.font = font(12, 600);
      ctx.fillText(label, sx + sw / 2, ry + 13);
      ctx.fillStyle = C.hud;
      ctx.font = font(15, 800);
      ctx.textAlign = 'left';
      ctx.fillText(`${va}${unit ?? ''}`, sx, ry + 14);
      ctx.textAlign = 'right';
      ctx.fillText(`${vb}${unit ?? ''}`, sx + sw, ry + 14);
      const barY = ry + 20, half = sw / 2 - 4;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(sx, barY, sw, 5);
      ctx.fillStyle = p1.color;
      ctx.fillRect(sx + half - half * (va / total), barY, half * (va / total), 5);
      ctx.fillStyle = p2.color;
      ctx.fillRect(sx + sw - half, barY, half * (vb / total), 5);
    });

    // Landing heatmaps
    const hx = x + pw * 0.64, hw = pw * 0.32;
    const courtH = Math.min((ph - (sy - y) - 70) / 2 - 22, hw * 0.62);
    [a, b].forEach((s, i) => {
      const cy = sy - 6 + i * (courtH + 34);
      ctx.textAlign = 'left';
      ctx.fillStyle = game.players[i].color;
      ctx.font = font(11, 800);
      ctx.fillText(`${game.players[i].name.toUpperCase()} — WHERE SHOTS LANDED`, hx, cy);
      this.miniCourt(hx, cy + 8, hw, courtH, s.landings.map((l) => ({ x: l.x, d: Math.abs(l.y) })), game.players[i].color);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = C.hudDim;
    ctx.font = font(13, 600);
    ctx.fillText('Enter — rematch   ·   R — replay last rally   ·   Esc — menu', w / 2, y + ph - 20);
  }

  /** Top-down half court (net on the left), with dots where shots landed. */
  private miniCourt(x: number, y: number, w: number, h: number, pts: { x: number; d: number }[], color: string) {
    const ctx = this.ctx;
    const L = COURT.halfLength, W = COURT.doublesHalfWidth;
    const sx = (d: number) => x + (d / L) * w, sy = (cx: number) => y + h / 2 + (cx / W) * (h / 2);
    ctx.fillStyle = '#245f48';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath();
    for (const cx of [-COURT.singlesHalfWidth, COURT.singlesHalfWidth]) { ctx.moveTo(x, sy(cx)); ctx.lineTo(x + w, sy(cx)); }
    for (const d of [COURT.shortServiceLine, COURT.doublesLongServiceLine]) { ctx.moveTo(sx(d), y); ctx.lineTo(sx(d), y + h); }
    ctx.moveTo(sx(COURT.shortServiceLine), sy(0));
    ctx.lineTo(x + w, sy(0));
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x - 2, y, 3, h);
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(sx(clamp(p.d, 0, L + 0.6)), sy(clamp(p.x, -W - 0.4, W + 0.4)), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.65;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private servePrompt(game: Game): string | null {
    if (game.state !== 'serve') return null;
    const s = game.server, opp = game.settings.opponent;
    if (opp !== 'human' && s === game.players[1]) return null;
    const court = game.match.serverInRightCourt() ? 'right' : 'left';
    if (s === game.players[0] && game.settings.p1Control === 'mouse') {
      return `${s.name} to serve (${court} court): aim with the cursor · left-click short · right-click high (hold for higher)`;
    }
    const k = s === game.players[1] ? KEYS.p2Shared : opp === 'human' ? KEYS.p1Shared : KEYS.solo;
    const key = (c: string[]) => c[0].replace('Key', '');
    return `${s.name} to serve (${court} court): ${key(k.soft)} short · ${key(k.high)} high · ${key(k.fast)} flick · hold ${key(k.aimLeft)}/${key(k.aimRight)} to aim`;
  }

  private controlsHint(game: Game): string {
    const vsAI = game.settings.opponent !== 'human';
    const hybrid = game.settings.p1Control === 'hybrid';
    const p1 = game.settings.p1Control === 'mouse'
      ? 'WASD move · Space jump · cursor = direction · left: tap drive, hold smash · right: tap drop, hold lob · E kill'
      : vsAI
        ? `WASD move · J high · K fast (hold = extra power) · L soft · E kill · ${hybrid ? 'cursor aims' : 'U/O aim'} · Space jump`
        : 'P1: WASD · C high · V fast (hold = extra power) · B soft · X/N aim · Space jump';
    const p2 = vsAI ? '' : '   |   P2: Arrows · J high · K fast · L soft · U/O aim · R-Shift jump';
    return `${p1}${p2}   ·   H challenge · R replay · G marker · F fullscreen · M mute · Esc pause`;
  }
}
