// Quick match: one Durable Object holds everyone waiting and pairs players with similar ratings.
// The allowed rating gap starts small and widens the longer people wait. A pair gets a fresh ranked
// room, each player a one-time ticket for their seat in it.
import { DurableObject } from 'cloudflare:workers';
import { verifyPlayer, type Player, type SupabaseEnv } from './supabase';
import type { Env } from './index';
import { LOCATION } from './location';

/** Kept on each waiting socket so it survives hibernation. */
interface Waiting extends Player { joinedAt: number }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Rating gap allowed: this much at first, plus this much per second of waiting, up to the cap. */
const GAP = { start: 100, perSecond: 25, max: 800 };

const randomCode = (n: number, chars = CODE_CHARS) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => chars[b % chars.length]).join('');

export class Matchmaker extends DurableObject<Env & SupabaseEnv> {
  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private send(ws: WebSocket, msg: unknown) { try { ws.send(JSON.stringify(msg)); } catch { /* gone */ } }

  private waiting(): { ws: WebSocket; w: Waiting }[] {
    return this.ctx.getWebSockets()
      .map((ws) => ({ ws, w: ws.deserializeAttachment() as Waiting | null }))
      .filter((x): x is { ws: WebSocket; w: Waiting } => !!x.w && x.ws.readyState === WebSocket.OPEN);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 8192) return;
    let msg: { type?: string; token?: string };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type !== 'auth' || ws.deserializeAttachment()) return;
    const player = await verifyPlayer(this.env, msg.token ?? '');
    if (!player) { this.send(ws, { type: 'error', error: 'login' }); ws.close(4003, 'Not logged in'); return; }
    // One place in the queue per player: a newer search replaces an older one.
    for (const other of this.waiting()) if (other.w.id === player.id) { this.send(other.ws, { type: 'replaced' }); other.ws.close(4002, 'Replaced'); }
    ws.serializeAttachment({ ...player, joinedAt: Date.now() } satisfies Waiting);
    this.send(ws, { type: 'queued', rating: player.rating });
    await this.pair();
    if (this.waiting().length && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async alarm() {
    await this.pair();
    if (this.waiting().length) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  /** Pair the longest-waiting players first, each with the closest rating inside both players' allowed gap. */
  private async pair() {
    const now = Date.now();
    const gap = (w: Waiting) => Math.min(GAP.max, GAP.start + GAP.perSecond * (now - w.joinedAt) / 1000);
    const pool = this.waiting().sort((a, b) => a.w.joinedAt - b.w.joinedAt);
    const used = new Set<WebSocket>();
    for (const a of pool) {
      if (used.has(a.ws)) continue;
      let best: (typeof pool)[number] | null = null;
      for (const b of pool) {
        if (b === a || used.has(b.ws)) continue;
        const d = Math.abs(a.w.rating - b.w.rating);
        if (d <= gap(a.w) && d <= gap(b.w) && (!best || d < Math.abs(a.w.rating - best.w.rating))) best = b;
      }
      if (!best) continue;
      used.add(a.ws);
      used.add(best.ws);
      await this.startMatch(a, best);
    }
  }

  /** Set up a ranked room for the pair, then send each player their room code and seat ticket. */
  private async startMatch(host: { ws: WebSocket; w: Waiting }, guest: { ws: WebSocket; w: Waiting }) {
    const code = randomCode(5);
    const tickets = { host: randomCode(24, 'abcdefghijklmnopqrstuvwxyz0123456789'), guest: randomCode(24, 'abcdefghijklmnopqrstuvwxyz0123456789') };
    const strip = (w: Waiting): Player => ({ id: w.id, name: w.name, rating: w.rating });
    const room = this.env.ROOMS.get(this.env.ROOMS.idFromName(code), { locationHint: LOCATION });
    await room.setupRanked({ tickets, host: strip(host.w), guest: strip(guest.w) });
    this.send(host.ws, { type: 'matched', code, ticket: tickets.host, host: true, opponent: { name: guest.w.name, rating: guest.w.rating } });
    this.send(guest.ws, { type: 'matched', code, ticket: tickets.guest, host: false, opponent: { name: host.w.name, rating: host.w.rating } });
    for (const p of [host, guest]) { p.ws.serializeAttachment(null); p.ws.close(1000, 'Matched'); }
  }
}
