// Skyline Smash online rooms. Each room code is one Durable Object that seats two players (four in a
// doubles room) and relays their messages. The game itself runs in the players' browsers: each is in
// charge of its own player and hits, and the room creator ("host") referees points and runs any CPU
// players. The room only keeps seats, teams, the lobby settings and who is connected, so it costs
// almost nothing while players aren't sending anything.
import { DurableObject } from 'cloudflare:workers';
import { displayName } from '../../shared/names';
import { LOCATION } from './location';
import { Matchmaker } from './matchmaker';
import { recordMatch, type Player, type SupabaseEnv } from './supabase';

export { Matchmaker };
export interface Env extends SupabaseEnv { ROOMS: DurableObjectNamespace<Room>; QUEUE: DurableObjectNamespace<Matchmaker> }

type Seat = 'host' | 'guest' | 'p3' | 'p4';
const SEATS: Seat[] = ['host', 'guest', 'p3', 'p4'];
/** The two sides of a result: the host's team ('host') or the other team ('guest'). Ranked rooms are always these two seats. */
type Side = 'host' | 'guest';
/** Team 0 is always the host's team. In singles the guest is team 1. */
interface SeatInfo { token: string; name: string; connected: boolean; awaySince: number | null; team?: 0 | 1; /** Game version they're running ('' if too old to say). */ v?: string; /** Connection drops during this match. */ drops?: number }
/** A quick-match room: only the two matched players may sit, and the result counts for ranking. */
interface Ranked {
  tickets: Record<Side, string>;
  players: Record<Side, Player>;
  /** Set once the result has been saved (or couldn't be), so it's only ever recorded once. */
  recorded: boolean;
}
/** The match as the room follows it, from the host's point verdicts. */
interface Progress {
  playing: boolean; gamesToWin: number; games: [number, number]; scores: [number, number];
  /** Finished games' scores and who serves next (0 = the host's side), so a reloaded match can carry on. */
  history?: [number, number][]; server?: 0 | 1;
  /** The match looks over: who won, and when to save it (after any Hawk-Eye challenge has had time). */
  pending: { winner: Side; at: number } | null;
}
interface RoomState { host: SeatInfo | null; guest: SeatInfo | null; p3?: SeatInfo | null; p4?: SeatInfo | null; settings: unknown; ranked: Ranked | null; progress: Progress | null }
/** Kept on each socket so it survives hibernation. */
interface Attachment { seat: Seat }

/** A dropped player has this long to come back before the other player wins by forfeit. */
const RECONNECT_MS = 60_000;
/** After the last point, wait this long before saving a ranked result: the loser may challenge the call. */
const CHALLENGE_GRACE_MS = 9_000;
/** Dropping this many times in one match makes your connection the problem: leaving on you cancels instead of losing. */
const FLAKY_DROPS = 3;
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

  /** A doubles room: the host picked doubles in the lobby, so up to four can sit. */
  private doubles(s: RoomState): boolean { return !s.ranked && (s.settings as { event?: string } | null)?.event === 'doubles'; }

  private teamOf(s: RoomState, seat: Seat): 0 | 1 { return seat === 'host' ? 0 : s[seat]?.team ?? 1; }

  /** Send to everyone in the room except one seat. */
  private others(except: Seat, msg: unknown) {
    for (const seat of SEATS) if (seat !== except) this.send(this.socket(seat), msg);
  }

  private send(ws: WebSocket | null, msg: unknown) {
    try { ws?.send(JSON.stringify(msg)); } catch { /* socket already closing */ }
  }

  private roster(s: RoomState) {
    const view = (seat: Seat) => { const x = s[seat]; return x ? { name: x.name, connected: x.connected, team: this.teamOf(s, seat), v: x.v ?? '' } : null; };
    const ranked = s.ranked ? { host: s.ranked.players.host.rating, guest: s.ranked.players.guest.rating } : null;
    const p = s.progress;
    // Where the match stands: playing (so a reloaded page can resume it) or finished.
    const match = p ? { playing: p.playing && !p.pending, finished: !p.playing || !!p.pending, games: p.games, scores: p.scores, history: p.history ?? [], server: p.server ?? 0 } : null;
    return { host: view('host'), guest: view('guest'), p3: view('p3'), p4: view('p4'), settings: s.settings, ranked, match };
  }

  /** Tell everyone who's in the room. */
  private broadcastRoster(s: RoomState) {
    for (const seat of SEATS) this.send(this.socket(seat), { type: 'roster', you: seat, ...this.roster(s) });
  }

  /** Called by the matchmaker: this room is a ranked match between these two players. */
  async setupRanked(r: { tickets: Record<Side, string>; host: Player; guest: Player }) {
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
    let seat: Seat | null = SEATS.find((k) => s[k]?.token === token) ?? null;
    if (s.ranked) seat = s.ranked.tickets.host === token ? 'host' : s.ranked.tickets.guest === token ? 'guest' : null;
    else if (!seat) seat = (this.doubles(s) ? SEATS : SEATS.slice(0, 2)).find((k) => !s[k]) ?? null;

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

    const name = s.ranked ? s.ranked.players[seat as Side].name : displayName(url.searchParams.get('name'), `${seat === 'host' ? 'host' : 'guest'}_player`);
    const wasAway = !!s[seat]?.awaySince;
    // New arrivals join the team with fewer players (the guest is the host's opponent in singles).
    let team: 0 | 1 = seat === 'host' ? 0 : s[seat]?.team ?? 1;
    if (!s[seat] && seat !== 'host') {
      const count = (t: 0 | 1) => SEATS.filter((k) => s[k] && this.teamOf(s, k) === t).length;
      team = count(1) <= count(0) ? 1 : 0;
    }
    s[seat] = { token, name, connected: true, awaySince: null, team, v: (url.searchParams.get('v') ?? '').slice(0, 16), drops: s[seat]?.drops ?? 0 };
    await this.save();
    this.broadcastRoster(s);
    if (wasAway) this.others(seat, { type: 'peer', status: 'back', seat });
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
    // Doubles lobby: a player moves to the other team, if it has room.
    if (msg.type === 'team') {
      const s = await this.load();
      const info = s[att.seat], team = msg.team === 0 ? 0 : 1;
      if (!info || att.seat === 'host' || !this.doubles(s) || s.progress?.playing) return;
      if (SEATS.filter((k) => s[k] && k !== att.seat && this.teamOf(s, k) === team).length >= 2) return;
      info.team = team;
      await this.save();
      this.broadcastRoster(s);
      return;
    }
    // Follow the match: the host starts it and sends each point's verdict.
    if (msg.type === 'start' && att.seat === 'host') {
      const s = await this.load();
      const games = (msg.settings as { games?: number } | null)?.games === 3 ? 2 : 1;
      s.progress = { playing: true, gamesToWin: games, games: [0, 0], scores: [0, 0], pending: null, history: [], server: 0 };
      for (const k of SEATS) if (s[k]) s[k]!.drops = 0;
      if (s.ranked?.recorded) s.ranked = null; // a rematch in a ranked room doesn't count again
      await this.save();
    }
    // A point, or a Hawk-Eye review that changed the score: follow it. When the match looks over, wait
    // for any challenge before saving the result.
    if ((msg.type === 'point' || msg.type === 'review') && att.seat === 'host') {
      const s = await this.load();
      const p = s.progress;
      if (p?.playing && Array.isArray(msg.games) && Array.isArray(msg.scores)) {
        const games: [number, number] = [Number(msg.games[0]) || 0, Number(msg.games[1]) || 0];
        const scores: [number, number] = [Number(msg.scores[0]) || 0, Number(msg.scores[1]) || 0];
        // A game just ended: its final score goes in the history (the host's scores are still the final ones).
        if (games[0] + games[1] > p.games[0] + p.games[1]) (p.history ??= []).push(scores);
        if (msg.type === 'point' && (msg.winner === 0 || msg.winner === 1)) p.server = msg.winner;
        p.games = games;
        p.scores = scores;
        const over = Math.max(...p.games) >= p.gamesToWin;
        p.pending = over ? { winner: p.games[0] > p.games[1] ? 'host' : 'guest', at: Date.now() + (msg.type === 'review' ? 2_000 : CHALLENGE_GRACE_MS) } : null;
        await this.save();
        await this.scheduleAlarm(s);
      }
    }
    // Someone's page reloaded mid-match: restart everyone from the last point (same score, same server).
    if (msg.type === 'resumeReq') {
      const s = await this.load();
      const p = s.progress;
      // (Even if the other player is away right now: this screen carries on and waits for them in the match.)
      if (p?.playing && !p.pending) {
        const resume = { type: 'resume', settings: s.settings, match: { games: p.games, scores: p.scores, history: p.history ?? [], server: p.server ?? 0 } };
        for (const seat of SEATS) this.send(this.socket(seat), resume);
      }
      return;
    }
    if (msg.type === 'forfeit') await this.quit(att.seat);
    if (msg.type === 'leave') {
      const s = await this.load();
      if (s.progress?.playing) await this.quit(att.seat);
      s[att.seat] = null;
      await this.save();
      this.others(att.seat, { type: 'peer', status: 'left', seat: att.seat });
      this.broadcastRoster(s);
      try { ws.close(1000, 'Left'); } catch { /* gone */ }
      return;
    }
    // Everything else is game traffic for the other players, marked with who sent it.
    this.others(att.seat, { ...msg, from: att.seat });
  }

  /**
   * The match is over. Ranked: save the result (both ratings change in the database) and tell both
   * players their new ratings. Each match is recorded at most once.
   */
  private async finish(winner: Side, forfeit: boolean) {
    const s = await this.load();
    const p = s.progress;
    if (!p?.playing) return;
    p.playing = false;
    const r = s.ranked;
    if (!r || r.recorded) { await this.save(); return; }
    r.recorded = true;
    await this.save();
    const loser: Side = winner === 'host' ? 'guest' : 'host';
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
    for (const seat of SEATS) this.send(this.socket(seat), msg);
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
    if (s.progress?.playing) info.drops = (info.drops ?? 0) + 1;
    await this.save();
    this.others(att.seat, { type: 'peer', status: 'away', seconds: RECONNECT_MS / 1000, seat: att.seat });
    this.broadcastRoster(s);
    await this.scheduleAlarm(s);
  }

  /**
   * Someone forfeited or left: the other team wins, unless the match was already decided. But if the
   * other side is the one whose connection is the problem (gone right now, or dropped 3+ times this
   * match), nobody is punished: the match is cancelled with no result.
   */
  private async quit(seat: Seat) {
    const s = await this.load();
    const decided = s.progress?.pending?.winner;
    if (decided) { await this.finish(decided, false); return; }
    const theirs = SEATS.filter((k) => s[k] && this.teamOf(s, k) !== this.teamOf(s, seat));
    if (theirs.some((k) => !s[k]!.connected || (s[k]!.drops ?? 0) >= FLAKY_DROPS)) { await this.cancel(); return; }
    await this.finish(this.teamOf(s, seat) === 0 ? 'guest' : 'host', true);
  }

  /** End the match with no result (and no rating change): a connection problem, not a defeat. */
  private async cancel() {
    const s = await this.load();
    if (!s.progress?.playing) return;
    s.progress.playing = false;
    if (s.ranked) s.ranked.recorded = true;
    await this.save();
    for (const seat of SEATS) this.send(this.socket(seat), { type: 'result', cancelled: true });
  }

  /** One alarm covers both timers: dropped players' reconnect window and a result waiting to be saved. */
  private async scheduleAlarm(s: RoomState) {
    const times: number[] = [];
    for (const seat of SEATS) { const a = s[seat]?.awaySince; if (a) times.push(a + RECONNECT_MS + 500); }
    if (s.progress?.playing && s.progress.pending) times.push(s.progress.pending.at);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
  }

  async alarm() {
    const s = await this.load();
    const now = Date.now();
    const pend = s.progress?.playing ? s.progress.pending : null;
    if (pend && now >= pend.at) await this.finish(pend.winner, false);
    for (const seat of SEATS) {
      const info = s[seat];
      if (info?.awaySince && now - info.awaySince >= RECONNECT_MS) {
        if (s.progress?.playing) await this.quit(seat);
        s[seat] = null;
        this.others(seat, { type: 'peer', status: 'left', forfeit: true, seat });
      }
    }
    await this.save();
    this.broadcastRoster(s);
    // Empty room: forget it entirely. Otherwise keep any remaining timer running.
    if (SEATS.every((k) => !s[k])) await this.ctx.storage.deleteAll();
    else await this.scheduleAlarm(s);
  }
}
