// Players online: one global Durable Object that every open game page keeps a small socket to. Each page
// says hello (who it is and what it's doing) and beats every 25 seconds; anyone not heard from for 70
// seconds stops counting. Each account (or guest tab) counts once, however many tabs it has open.
import { DurableObject } from 'cloudflare:workers';

export type PresenceState = 'menu' | 'queue' | 'room' | 'match';
const STATES: PresenceState[] = ['menu', 'queue', 'room', 'match'];
interface Tag { key: string; state: PresenceState; seen: number; asked: number }

const EXPIRE_MS = 70_000;
const CACHE_MS = 5_000;
const ASK_EVERY_MS = 5_000;
const MAX_PER_KEY = 2;

export class Presence extends DurableObject {
  private cache: { at: number; counts: Record<string, number> } | null = null;

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ key: '', state: 'menu', seen: Date.now(), asked: 0 } satisfies Tag);
    return new Response(null, { status: 101, webSocket: client });
  }

  private counts() {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.counts;
    // Each key once, at its "busiest" state (a match beats a room beats the queue beats the menu).
    const best = new Map<string, number>();
    for (const ws of this.ctx.getWebSockets()) {
      const t = ws.deserializeAttachment() as Tag | null;
      if (!t?.key || now - t.seen > EXPIRE_MS) continue;
      best.set(t.key, Math.max(best.get(t.key) ?? 0, STATES.indexOf(t.state)));
    }
    const by = [0, 0, 0, 0];
    for (const v of best.values()) by[v]++;
    const counts = { online: best.size, inQueue: by[1], inRoom: by[2], inMatch: by[3], updatedAt: now };
    this.cache = { at: now, counts };
    return counts;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 300) return;
    let msg: { type?: string; key?: unknown; state?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    const t = (ws.deserializeAttachment() as Tag | null) ?? { key: '', state: 'menu', seen: 0, asked: 0 };
    const now = Date.now();
    if (msg.type === 'hello' || msg.type === 'beat') {
      if (msg.type === 'hello' && typeof msg.key === 'string' && /^[a-z0-9_-]{6,64}$/i.test(msg.key)) {
        t.key = msg.key;
        // At most two sockets per account: close the oldest extra ones.
        const same = this.ctx.getWebSockets().filter((w) => w !== ws && (w.deserializeAttachment() as Tag | null)?.key === t.key);
        for (const old of same.slice(0, Math.max(0, same.length - (MAX_PER_KEY - 1)))) { try { old.close(4003, 'Too many tabs'); } catch { /* gone */ } }
      }
      if (STATES.includes(msg.state as PresenceState)) t.state = msg.state as PresenceState;
      t.seen = now;
      ws.serializeAttachment(t);
      return;
    }
    if (msg.type === 'counts') {
      if (now - t.asked < ASK_EVERY_MS) return;
      t.asked = now;
      ws.serializeAttachment(t);
      try { ws.send(JSON.stringify({ type: 'counts', ...this.counts() })); } catch { /* gone */ }
    }
  }

  async webSocketClose(ws: WebSocket) { try { ws.close(); } catch { /* already closed */ } this.cache = null; }
  async webSocketError() { this.cache = null; }
}
