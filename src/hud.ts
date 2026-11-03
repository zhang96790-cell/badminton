import { COURT, KEYS, VISUAL } from './config';
import type { Game } from './game';
import { REPLAY_CAMS } from './camera';
import type { Playback } from './replay';
import { keyLabel } from './keys';
import { tierOf } from './rating';
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
      const label = c.label.toUpperCase();
      ctx.fillText(label, w / 2, h - 66);
      if (c.assist) {
        // The game played this one for you: say so plainly.
        const lw = ctx.measureText(label).width, tw = 62, tx = w / 2 + lw / 2 + 10, ty = h - 84;
        ctx.fillStyle = C.accent;
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, 22, 11);
        ctx.fill();
        ctx.fillStyle = '#10161f';
        ctx.font = font(12, 900);
        ctx.textAlign = 'left';
        ctx.fillText('ASSIST', tx + 10, ty + 15.5);
        ctx.textAlign = 'center';
      }
      if (c.detail) {
        ctx.fillStyle = C.hud;
        ctx.font = font(13, 600);
        ctx.fillText(c.detail, w / 2, h - 46);
      }
      ctx.globalAlpha = 1;
    }

    this.banner(game, w, h);
    if (game.online) this.connection(game, w);

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

    // Commentary: text only, at the top.
    const cm = game.commentary;
    if (cm) {
      ctx.globalAlpha = Math.min(1, cm.t / 0.25, (4.5 - cm.t) / 0.6);
      ctx.font = font(15, 600);
      const tw = ctx.measureText(cm.text).width, bw = tw + 150, x = w / 2 - bw / 2, y = bw > w - 2 * 370 ? 124 : 18;
      panel(ctx, x, y, bw, 34, 17);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.accent;
      ctx.font = font(10, 800);
      ctx.fillText('COMMENTARY', x + 16, y + 21);
      ctx.fillStyle = C.hud;
      ctx.font = font(15, 600);
      ctx.fillText(cm.text, x + 120, y + 22);
      ctx.globalAlpha = 1;
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

    if (game.paused || game.peerAway) {
      ctx.fillStyle = 'rgba(5,8,12,0.6)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = C.hud;
      const them = game.pausers, gone = game.awayName;
      const [title, sub] = game.peerAway
        ? gone === 'You'
          ? ['Connection lost', 'Reconnecting… your place is kept for a minute  ·  Q to leave']
          : [`${gone} disconnected`, 'Waiting up to a minute for them to come back. If they don’t, their side retires  ·  Q to leave']
        : !game.online
          ? ['Paused', 'Esc to resume  ·  Q to quit to menu']
          : game.pauseMine && game.pauseTheirs
            ? [`You and ${them} paused`, 'Esc when you’re ready  ·  play starts once everyone has resumed  ·  Q to forfeit']
            : game.pauseMine
              ? ['Paused', `${game.doubles ? 'Everyone else is' : `${game.players[1].name} is`} ready  ·  Esc to resume  ·  Q to forfeit and leave`]
              : [`Paused by ${them}`, `Play carries on when ${them} resumes  ·  Esc to pause too`];
      ctx.font = font(34, 800);
      ctx.fillText(title, w / 2, h / 2 - 10);
      ctx.font = font(15, 500);
      ctx.fillText(sub, w / 2, h / 2 + 22);
      if (game.online && game.paused && !game.peerAway) {
        // The warning: pauses are capped so nobody can stall a match.
        const left = Math.max(0, Math.ceil(game.pauseLeft));
        ctx.fillStyle = left <= 15 ? C.callOut : C.accent;
        ctx.font = font(15, 700);
        ctx.fillText(`Play resumes automatically in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, w / 2, h / 2 + 58);
        ctx.fillStyle = C.hudDim;
        ctx.font = font(13, 500);
        ctx.fillText('Pauses last at most a minute, so nobody can stall the match', w / 2, h / 2 + 80);
      }
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
    if (bn.card) {
      // The umpire's card, held up above the banner.
      const pop = Math.min(1, bn.t / 0.25), cw = 38, ch = 54;
      ctx.save();
      ctx.translate(w / 2, y - 12 - ch / 2 + (1 - pop) * 20);
      ctx.rotate(-0.14);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-cw / 2 + 3, -ch / 2 + 4, cw, ch);
      ctx.fillStyle = '#d7263d';
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-cw / 2 + 1, -ch / 2 + 1, cw - 2, ch - 2);
      ctx.restore();
    }
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
    ([0, 1] as const).forEach((i) => {
      const ry = y + 28 + rowH * i;
      ctx.fillStyle = game.teamColor(i);
      ctx.fillRect(x + 10, ry + 6, 4, rowH - 10);
      if (game.doubles) { ctx.fillStyle = game.players[i + 2].color; ctx.fillRect(x + 10, ry + 6 + (rowH - 10) / 2, 4, (rowH - 10) / 2); }
      ctx.fillStyle = C.hud;
      ctx.font = font(game.doubles ? 13 : 16, 700);
      ctx.fillText(game.doubles ? (i === 0 ? 'You / Partner' : 'CPU 1 / CPU 2') : game.players[i].name, x + 24, ry + 23);
      // Challenges left this game
      const cx = game.doubles ? 116 : 88;
      // No Hawk-Eye challenges online (yet), so no challenge markers.
      for (let k = 0; k < (game.online ? 0 : game.challenges[i]); k++) {
        ctx.fillStyle = 'rgba(255,209,102,0.85)';
        ctx.fillRect(x + cx + k * 9, ry + 14, 6, 6);
      }
      if (m.server === i && (game.state === 'serve' || game.state === 'rally')) {
        ctx.fillStyle = C.accent;
        ctx.beginPath();
        ctx.arc(x + (game.doubles ? 142 : 124), ry + 17, 4, 0, Math.PI * 2);
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
    const x = 16, y = 116, urgent = s <= 10;
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
    this.replayBars(game.playback!, 'REPLAY', REPLAY_CAMS.find((c) => c.id === game.replayCam)?.label ?? '', 'V camera  ·  T speed  ·  P save highlight  ·  R / Enter skip', w, h, time);
  }

  /** A saved highlight playing from the Social screen. */
  highlight(pb: Playback, title: string, cam: string, w: number, h: number, time: number) {
    this.replayBars(pb, 'HIGHLIGHT', `${title}  ·  ${cam}`, 'V camera  ·  T speed  ·  R restart  ·  Esc close', w, h, time);
  }

  private replayBars(pb: Playback, tag: string, info: string, keys: string, w: number, h: number, time: number) {
    const ctx = this.ctx;
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
    ctx.fillText(tag, 42, bar / 2 + 6);
    const tagW = ctx.measureText(tag).width;
    ctx.fillStyle = C.hudDim;
    ctx.font = font(13, 600);
    const speed = (s: number) => (s === 1 ? '1×' : s === 0.5 ? '½×' : s === 0.25 ? '¼×' : `${+s.toFixed(2)}×`);
    ctx.fillText(`${speed(pb.base)}${pb.slowmo ? '  ·  SLOW MOTION' : ''}  ·  ${info}`, 42 + tagW + 18, bar / 2 + 5);
    ctx.textAlign = 'right';
    ctx.fillText(keys, w - 20, bar / 2 + 5);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(20, h - bar / 2 - 2, w - 40, 4);
    ctx.fillStyle = C.accent;
    ctx.fillRect(20, h - bar / 2 - 2, (w - 40) * clamp(pb.progress, 0, 1), 4);
  }

  /** End-of-match scoreboard: result, game scores, stat comparison and where each player's shots landed. */
  private endScreen(game: Game, w: number, h: number) {
    const ctx = this.ctx, m = game.match, st = game.stats;
    const wi = game.forfeitWinner ?? (m.games[0] > m.games[1] ? 0 : 1) as 0 | 1;
    const p1 = { name: game.teamName(0), color: game.teamColor(0) }, p2 = { name: game.teamName(1), color: game.teamColor(1) };
    const winner = wi === 0 ? p1 : p2;
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
    // Two players on one keyboard are P1 and P2; otherwise player 0 is you.
    const shared = game.settings.opponent === 'human' && !game.online;
    const won = wi === 0 && !shared ? (game.doubles ? 'You and your partner win!' : 'You win!') : `${winner.name} win${game.doubles ? '' : 's'}`;
    ctx.fillText(game.forfeitWinner !== null ? `${won} (${game.teamName((1 - wi) as 0 | 1)} left)` : won, x + 28, y + 72);
    // Ranked: how your rating changed (it arrives from the server a moment after the last point).
    if (game.online?.ranked) {
      const r = game.rankedResult, me = game.online.host ? 'host' : 'guest';
      ctx.font = font(15, 700);
      if (!r) { ctx.fillStyle = C.hudDim; ctx.fillText('Ranked · saving the result…', x + 28, y + 96); }
      else if (r.error || !r.ratings || r.change === undefined) { ctx.fillStyle = C.hudDim; ctx.fillText('Ranked · this result couldn’t be saved, so ratings didn’t change', x + 28, y + 96); }
      else {
        const mine = r.ratings[me], up = r.winner === me;
        ctx.fillStyle = up ? C.callIn : C.callOut;
        ctx.fillText(`${up ? '+' : '−'}${r.change} rating  →  ${mine} (${tierOf(mine).name})`, x + 28, y + 96);
      }
    }
    const mins = Math.floor(st.seconds / 60), secs = Math.floor(st.seconds % 60);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.hudDim;
    ctx.font = font(13, 600);
    ctx.fillText(`${mins}:${String(secs).padStart(2, '0')} match time  ·  longest rally ${st.longestRally} shots`, x + pw - 28, y + 36);

    // Game-by-game table
    const tx = x + 28, ty = y + (game.online?.ranked ? 112 : 96);
    [p1, p2].forEach((p, i) => {
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

    // Landing heatmaps (singles) or each player's numbers (doubles)
    const hx = x + pw * 0.64, hw = pw * 0.32;
    const courtH = Math.min((ph - (sy - y) - 70) / 2 - 22, hw * 0.62);
    if (game.doubles) this.individuals(game, hx, sy - 6, hw);
    else [a, b].forEach((s, i) => {
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
    ctx.fillText(game.online?.ranked
      ? 'Enter — find another match   ·   R — replay last rally   ·   Esc — back to the menu'
      : game.online
      ? (game.forfeitWinner !== null ? 'Esc — back to the menu' : `Enter — rematch${game.rematchAsked ? ' (waiting for your opponent)' : ''}   ·   R — replay last rally   ·   Esc — leave room`)
      : 'Enter — rematch   ·   R — replay last rally   ·   Esc — menu', w / 2, y + ph - 20);
  }

  /** Online: connection quality, top centre. Delay is one way between the two players. */
  private connection(game: Game, w: number) {
    const conn = game.online!.conn, ctx = this.ctx;
    const ms = Math.round(conn.latency);
    const reconnecting = conn.status === 'reconnecting';
    const color = reconnecting ? C.callOut : ms < 80 ? C.callIn : ms < 150 ? C.accent : C.callOut;
    // When there's lag, say whose connection it's coming from.
    const whose = conn.rtt > conn.peerRtt * 1.5 ? 'your connection' : conn.peerRtt > conn.rtt * 1.5 ? `${game.players[1].name}’s connection` : 'both connections';
    const text = reconnecting ? 'Reconnecting…' : ms < 80 ? `${ms} ms` : `${ms} ms  ·  ${ms < 150 ? 'some lag' : 'laggy'} (${whose})`;
    ctx.font = font(12, 700);
    const tw = ctx.measureText(text).width;
    panel(ctx, w / 2 - tw / 2 - 22, 14, tw + 44, 24, 12);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(w / 2 - tw / 2 - 8, 26, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.hud;
    ctx.fillText(text, w / 2 - tw / 2 + 2, 30);
  }

  /** Doubles end screen: a line per player (shots, winners, errors, smashes, fastest smash). */
  private individuals(game: Game, x: number, y: number, w: number) {
    const ctx = this.ctx;
    const cols = ['Shots', 'Winners', 'Errors', 'Smashes', 'Top km/h'];
    const colX = (k: number) => x + w * 0.3 + (k + 0.5) * (w * 0.7 / cols.length);
    ctx.font = font(9, 800);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.hudDim;
    ctx.fillText('EACH PLAYER', x, y);
    ctx.font = font(9, 700);
    cols.forEach((c, k) => { ctx.textAlign = 'center'; ctx.fillText(c.toUpperCase(), colX(k), y + 24); });
    const order = [...game.players].sort((p, q) => (p.side - q.side) || (p.id - q.id));
    order.forEach((p, r) => {
      const ry = y + 36 + r * 34;
      const s = game.stats.individual(p.id);
      panel(ctx, x, ry, w, 28, 6, 'rgba(255,255,255,0.04)');
      ctx.fillStyle = p.color;
      ctx.fillRect(x, ry, 4, 28);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.hud;
      ctx.font = font(14, 700);
      ctx.fillText(p.name, x + 12, ry + 19);
      ctx.font = font(14, 800);
      [s.shots, s.winners, s.errors, s.smashes, Math.round(s.topSmash)].forEach((v, k) => {
        ctx.textAlign = 'center';
        ctx.fillText(String(v), colX(k), ry + 19);
      });
    });
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
    // Online: a short wait after each point before the serve, counted down for both players.
    const wait = game.online ? Math.ceil(game.serveCountdown) : 0;
    if (wait > 0) return s === game.players[0] ? `Get ready… you can serve in ${wait}` : `${s.name} serves in ${wait}… get ready`;
    if (game.doubles && s !== game.players[0]) {
      const court = game.match.serverInRightCourt() ? 'right' : 'left';
      const to = game.receiver === game.players[0] ? 'you' : game.receiver.name;
      return `${s.name} serves from the ${court} court to ${to}`;
    }
    if (opp !== 'human' && s === game.players[1]) return null;
    const court = game.match.serverInRightCourt() ? 'right' : 'left';
    if (s === game.players[0] && game.settings.p1Control === 'mouse') {
      return `${s.name} to serve (${court} court): aim with the cursor · left-click short · right-click: tap = flick, hold = high`;
    }
    const k = s === game.players[1] ? KEYS.p2Shared : game.p1Keys;
    const key = (c: string[]) => keyLabel(c[0]);
    return `${s.name} to serve (${court} court): ${key(k.soft)} short · ${key(k.high)} high · ${key(k.fast)} flick · hold ${key(k.aimLeft)}/${key(k.aimRight)} to aim`;
  }

  private controlsHint(game: Game): string {
    const vsAI = game.settings.opponent !== 'human';
    const hybrid = game.settings.p1Control === 'hybrid';
    const K = game.p1Keys, n = (c: string[]) => keyLabel(c[0] ?? '');
    const move = [K.up, K.left, K.down, K.right].map(n).join('');
    const p1 = game.settings.p1Control === 'mouse'
      ? `${move} move · ${n(K.jump)} jump · cursor = direction · left: tap drive, hold smash · right: tap drop, hold lob · ${n(K.kill)} kill`
      : vsAI
        ? `${move} move · ${n(K.high)} high · ${n(K.fast)} fast (hold = extra power) · ${n(K.soft)} soft · ${n(K.kill)} kill · ${hybrid ? 'cursor aims' : `${n(K.aimLeft)}/${n(K.aimRight)} aim`} · ${n(K.jump)} jump`
        : 'P1: WASD · C high · V fast (hold = extra power) · B soft · X/N aim · Space jump';
    const p2 = vsAI ? '' : '   |   P2: Arrows · J high · K fast · L soft · U/O aim · R-Shift jump';
    if (game.online) return `${p1}   ·   1–6 quick chat · H challenge · R replay · G marker · F fullscreen · M mute · Esc pause`;
    return `${p1}${p2}   ·   H challenge · R replay · G marker · F fullscreen · M mute · Esc pause`;
  }
}
