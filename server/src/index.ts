// Skyline Smash online rooms. Each room code is one Durable Object that seats two players and relays
// their messages. The game itself runs in the players' browsers: each is in charge of its own player
// and hits, and the room creator ("host") referees points. The room only keeps seats, the lobby
// settings and who is connected, so it costs almost nothing while players aren't sending anything.
import { DurableObject } from 'cloudflare:workers';
import { displayName } from '../../shared/names';
import { LOCATION } from './location';
import { Matchmaker } from './matchmaker';
import { recordMatch, type Player, type SupabaseEnv } from './supabase';

export { Matchmaker };
export interface Env extends SupabaseEnv { ROOMS: DurableObjectNamespace<Room>; QUEUE: DurableObjectNamespace<Matchmaker> }

type Seat = 'host' | 'guest';
interface SeatInfo { token: string; name: string; connected: boolean; awaySince: number | null }
/** A quick-match room: only the two matched players may sit, and the result counts for ranking. */
interface Ranked {
  tickets: Record<Seat, string>;
  players: Record<Seat, Player>;
  /** Set once the result has been saved (or couldn't be), so it's only ever recorded once. */
  recorded: boolean;
}
/** The match as the room follows it, from the host's point verdicts. */
interface Progress {
  playing: boolean; gamesToWin: number; games: [number, number]; scores: [number, number];
  /** The match looks over: who won, and when to save it (after any Hawk-Eye challenge has had time). */
  pending: { winner: Seat; at: number } | null;
}
interface RoomState { host: SeatInfo | null; guest: SeatInfo | null; settings: unknown; ranked: Ranked | null; progress: Progress | null }
/** Kept on each socket so it survives hibernation. */
interface Attachment { seat: Seat }

/** A dropped player has this long to come back before the other player wins by forfeit. */
const RECONNECT_MS = 60_000;
/** After the last point, wait this long before saving a ranked result: the loser may challenge the call. */
const CHALLENGE_GRACE_MS = 9_000;
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;
/** Sites allowed to open game connections (plus local development). */
const ORIGINS = [/^https:\/\/(www\.)?airphysicsrevision\.online$/, /^https:\/\/(www\.)?badmintongames\.site$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/queue') {
      const origin = req.headers.get('Origin') ?? '';
      if (!ORIGINS.some((o) => o.test(origin))) return new Response('Forbidden', { status: 403 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return env.QUEUE.get(env.QUEUE.idFromName('global'), { locationHint: LOCATION }).fetch(req);
    }
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m) return new Response('Not found', { status: 404 });
    const code = m[1].toUpperCase();
    if (!CODE.test(code)) return new Response('Bad room code', { status: 400 });
    const origin = req.headers.get('Origin') ?? '';
    if (!ORIGINS.some((o) => o.test(origin))) return new Response('Forbidden', { status: 403 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(code), { locationHint: LOCATION }).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  private state: RoomState | null = null;

  private async load(): Promise<RoomState> {
    this.state ??= (await this.ctx.storage.get<RoomState>('room')) ?? { host: null, guest: null, settings: null, ranked: null, progress: null };
    return this.state;
  }

  private async save() { await this.ctx.storage.put('room', this.state); }

  private socket(seat: Seat): WebSocket | null { return this.ctx.getWebSockets(seat)[0] ?? null; }

  private send(ws: WebSocket | null, msg: unknown) {
    try { ws?.send(JSON.stringify(msg)); } catch { /* socket already closing */ }
  }

  private roster(s: RoomState) {
    const view = (x: SeatInfo | null) => (x ? { name: x.name, connected: x.connected } : null);
    const ranked = s.ranked ? { host: s.ranked.players.host.rating, guest: s.ranked.players.guest.rating } : null;
    return { host: view(s.host), guest: view(s.guest), settings: s.settings, ranked };
  }

  /** Tell both players who's in the room. */
  private broadcastRoster(s: RoomState) {
    for (const seat of ['host', 'guest'] as Seat[]) this.send(this.socket(seat), { type: 'roster', you: seat, ...this.roster(s) });
  }

  /** Called by the matchmaker: this room is a ranked match between these two players. */
  async setupRanked(r: { tickets: Record<Seat, string>; host: Player; guest: Player }) {
    const s = await this.load();
    s.ranked = { tickets: r.tickets, players: { host: r.host, guest: r.guest }, recorded: false };
    s.settings = { games: 1, points: 21 };
    await this.save();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const token = (url.searchParams.get('token') ?? '').slice(0, 64);
    if (token.length < 16) return new Response('Missing token', { status: 400 });
    const s = await this.load();

    // Ranked: your matchmaker ticket is your seat. Otherwise the same token as a seat is that player
    // reconnecting, and anyone else takes a free seat.
    let seat: Seat | null = s.host?.token === token ? 'host' : s.guest?.token === token ? 'guest' : null;
    if (s.ranked) seat = s.ranked.tickets.host === token ? 'host' : s.ranked.tickets.guest === token ? 'guest' : null;
    else if (!seat) seat = !s.host ? 'host' : !s.guest ? 'guest' : null;

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

    const name = s.ranked ? s.ranked.players[seat].name : displayName(url.searchParams.get('name'), seat === 'host' ? 'host_player' : 'guest_player');
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
      if (!s.ranked) s.settings = msg.settings;
      await this.save();
    }
    // Follow the match: the host starts it and sends each point's verdict.
    if (msg.type === 'start' && att.seat === 'host') {
      const s = await this.load();
      const games = (msg.settings as { games?: number } | null)?.games === 3 ? 2 : 1;
      s.progress = { playing: true, gamesToWin: games, games: [0, 0], scores: [0, 0], pending: null };
      if (s.ranked?.recorded) s.ranked = null; // a rematch in a ranked room doesn't count again
      await this.save();
    }
    // A point, or a Hawk-Eye review that changed the score: follow it. When the match looks over, wait
    // for any challenge before saving the result.
    if ((msg.type === 'point' || msg.type === 'review') && att.seat === 'host') {
      const s = await this.load();
      const p = s.progress;
      if (p?.playing && Array.isArray(msg.games) && Array.isArray(msg.scores)) {
        p.games = [Number(msg.games[0]) || 0, Number(msg.games[1]) || 0];
        p.scores = [Number(msg.scores[0]) || 0, Number(msg.scores[1]) || 0];
        const over = Math.max(...p.games) >= p.gamesToWin;
        p.pending = over ? { winner: p.games[0] > p.games[1] ? 'host' : 'guest', at: Date.now() + (msg.type === 'review' ? 2_000 : CHALLENGE_GRACE_MS) } : null;
        await this.save();
        await this.scheduleAlarm(s);
      }
    }
    if (msg.type === 'forfeit') await this.quit(att.seat);
    if (msg.type === 'leave') {
      const s = await this.load();
      if (s.progress?.playing) await this.quit(att.seat);
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

  /**
   * The match is over. Ranked: save the result (both ratings change in the database) and tell both
   * players their new ratings. Each match is recorded at most once.
   */
  private async finish(winner: Seat, forfeit: boolean) {
    const s = await this.load();
    const p = s.progress;
    if (!p?.playing) return;
    p.playing = false;
    const r = s.ranked;
    if (!r || r.recorded) { await this.save(); return; }
    r.recorded = true;
    await this.save();
    const loser: Seat = winner === 'host' ? 'guest' : 'host';
    const [a, b] = winner === 'host' ? p.scores : [p.scores[1], p.scores[0]];
    const score = forfeit ? `${a}–${b} (retired)` : `${a}–${b}`;
    let msg: unknown;
    try {
      const res = await recordMatch(this.env, r.players[winner].id, r.players[loser].id, score, forfeit);
      r.players[winner].rating = res.winner_rating;
      r.players[loser].rating = res.loser_rating;
      await this.save();
      msg = { type: 'result', winner, forfeit, change: res.change, ratings: { host: r.players.host.rating, guest: r.players.guest.rating } };
    } catch (e) {
      console.error('Could not record ranked result', e);
      msg = { type: 'result', winner, forfeit, error: 'not_saved' };
    }
    for (const seat of ['host', 'guest'] as Seat[]) this.send(this.socket(seat), msg);
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
    await this.scheduleAlarm(s);
  }

  /** Reconnect window over: anyone still away has left; the other player wins by forfeit. */
  /** Someone forfeited or left: the other player wins, unless the match was already decided. */
  private async quit(seat: Seat) {
    const s = await this.load();
    const decided = s.progress?.pending?.winner;
    await this.finish(decided ?? (seat === 'host' ? 'guest' : 'host'), !decided);
  }

  /** One alarm covers both timers: dropped players' reconnect window and a result waiting to be saved. */
  private async scheduleAlarm(s: RoomState) {
    const times: number[] = [];
    for (const seat of ['host', 'guest'] as Seat[]) { const a = s[seat]?.awaySince; if (a) times.push(a + RECONNECT_MS + 500); }
    if (s.progress?.playing && s.progress.pending) times.push(s.progress.pending.at);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
  }

  async alarm() {
    const s = await this.load();
    const now = Date.now();
    const pend = s.progress?.playing ? s.progress.pending : null;
    if (pend && now >= pend.at) await this.finish(pend.winner, false);
    for (const seat of ['host', 'guest'] as Seat[]) {
      const info = s[seat];
      if (info?.awaySince && now - info.awaySince >= RECONNECT_MS) {
        if (s.progress?.playing) await this.quit(seat);
        s[seat] = null;
        this.send(this.socket(seat === 'host' ? 'guest' : 'host'), { type: 'peer', status: 'left', forfeit: true });
      }
    }
    await this.save();
    this.broadcastRoster(s);
    // Empty room: forget it entirely. Otherwise keep any remaining timer running.
    if (!s.host && !s.guest) await this.ctx.storage.deleteAll();
    else await this.scheduleAlarm(s);
  }
}
