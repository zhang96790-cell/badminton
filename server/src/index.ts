// Skyline Smash online rooms. Each room code is one Durable Object that seats two players and relays
// their messages. The game itself runs in the players' browsers: each is in charge of its own player
// and hits, and the room creator ("host") referees points. The room only keeps seats, the lobby
// settings and who is connected, so it costs almost nothing while players aren't sending anything.
import { DurableObject } from 'cloudflare:workers';
import { displayName } from '../../shared/names';

export interface Env { ROOMS: DurableObjectNamespace<Room> }

type Seat = 'host' | 'guest';
interface SeatInfo { token: string; name: string; connected: boolean; awaySince: number | null }
interface RoomState { host: SeatInfo | null; guest: SeatInfo | null; settings: unknown }
/** Kept on each socket so it survives hibernation. */
interface Attachment { seat: Seat }

/** A dropped player has this long to come back before the other player wins by forfeit. */
const RECONNECT_MS = 60_000;
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;
/** Sites allowed to open game connections (plus local development). */
const ORIGINS = [/^https:\/\/(www\.)?airphysicsrevision\.online$/, /^https:\/\/(www\.)?badmintongames\.site$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m) return new Response('Not found', { status: 404 });
    const code = m[1].toUpperCase();
    if (!CODE.test(code)) return new Response('Bad room code', { status: 400 });
    const origin = req.headers.get('Origin') ?? '';
    if (!ORIGINS.some((o) => o.test(origin))) return new Response('Forbidden', { status: 403 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  private state: RoomState | null = null;

  private async load(): Promise<RoomState> {
    this.state ??= (await this.ctx.storage.get<RoomState>('room')) ?? { host: null, guest: null, settings: null };
    return this.state;
  }

  private async save() { await this.ctx.storage.put('room', this.state); }

  private socket(seat: Seat): WebSocket | null { return this.ctx.getWebSockets(seat)[0] ?? null; }

  private send(ws: WebSocket | null, msg: unknown) {
    try { ws?.send(JSON.stringify(msg)); } catch { /* socket already closing */ }
  }

  private roster(s: RoomState) {
    const view = (x: SeatInfo | null) => (x ? { name: x.name, connected: x.connected } : null);
    return { host: view(s.host), guest: view(s.guest), settings: s.settings };
  }

  /** Tell both players who's in the room. */
  private broadcastRoster(s: RoomState) {
    for (const seat of ['host', 'guest'] as Seat[]) this.send(this.socket(seat), { type: 'roster', you: seat, ...this.roster(s) });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const token = (url.searchParams.get('token') ?? '').slice(0, 64);
    if (token.length < 16) return new Response('Missing token', { status: 400 });
    const s = await this.load();

    // Same token as a seat = that player reconnecting. Otherwise take a free seat.
    let seat: Seat | null = s.host?.token === token ? 'host' : s.guest?.token === token ? 'guest' : null;
    if (!seat) seat = !s.host ? 'host' : !s.guest ? 'guest' : null;

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (!seat) {
      this.ctx.acceptWebSocket(server, ['full']);
      this.send(server, { type: 'full' });
      server.close(4001, 'Room full');
      return new Response(null, { status: 101, webSocket: client });
    }
    // A newer connection for the same seat replaces the old one.
    for (const old of this.ctx.getWebSockets(seat)) { try { old.close(4002, 'Replaced'); } catch { /* gone */ } }
    this.ctx.acceptWebSocket(server, [seat]);
    server.serializeAttachment({ seat } satisfies Attachment);

    const name = displayName(url.searchParams.get('name'), seat === 'host' ? 'host_player' : 'guest_player');
    const wasAway = !!s[seat]?.awaySince;
    s[seat] = { token, name, connected: true, awaySince: null };
    await this.save();
    this.broadcastRoster(s);
    if (wasAway) this.send(this.socket(seat === 'host' ? 'guest' : 'host'), { type: 'peer', status: 'back' });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    let msg: { type?: string; [k: string]: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') { this.send(ws, { type: 'pong', t: msg.t }); return; }
    if (msg.type === 'settings' && att.seat === 'host') {
      const s = await this.load();
      s.settings = msg.settings;
      await this.save();
    }
    if (msg.type === 'leave') {
      const s = await this.load();
      s[att.seat] = null;
      await this.save();
      this.send(this.socket(att.seat === 'host' ? 'guest' : 'host'), { type: 'peer', status: 'left' });
      this.broadcastRoster(s);
      try { ws.close(1000, 'Left'); } catch { /* gone */ }
      return;
    }
    // Everything else is game traffic for the other player.
    this.send(this.socket(att.seat === 'host' ? 'guest' : 'host'), msg);
  }

  async webSocketClose(ws: WebSocket) { await this.dropped(ws); }
  async webSocketError(ws: WebSocket) { await this.dropped(ws); }

  /** A player's connection went: keep their seat for a minute and tell the other player. */
  private async dropped(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    const s = await this.load();
    const info = s[att.seat];
    if (!info || this.ctx.getWebSockets(att.seat).some((o) => o !== ws && o.readyState === WebSocket.OPEN)) return;
    info.connected = false;
    info.awaySince = Date.now();
    await this.save();
    this.send(this.socket(att.seat === 'host' ? 'guest' : 'host'), { type: 'peer', status: 'away', seconds: RECONNECT_MS / 1000 });
    this.broadcastRoster(s);
    await this.ctx.storage.setAlarm(Date.now() + RECONNECT_MS + 500);
  }

  /** Reconnect window over: anyone still away has left; the other player wins by forfeit. */
  async alarm() {
    const s = await this.load();
    const now = Date.now();
    for (const seat of ['host', 'guest'] as Seat[]) {
      const info = s[seat];
      if (info?.awaySince && now - info.awaySince >= RECONNECT_MS) {
        s[seat] = null;
        this.send(this.socket(seat === 'host' ? 'guest' : 'host'), { type: 'peer', status: 'left', forfeit: true });
      }
    }
    await this.save();
    this.broadcastRoster(s);
    // Empty room: forget it entirely.
    if (!s.host && !s.guest) await this.ctx.storage.deleteAll();
  }
}
