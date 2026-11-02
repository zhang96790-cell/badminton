// Connection to an online room on the game server (Cloudflare). Reconnects on its own after a drop,
// keeping the same seat, and measures the round trip to the server.

/** Where the room server lives. Local development runs `npm run dev` in server/. */
export const ROOM_SERVER = import.meta.env.DEV ? 'ws://127.0.0.1:8787' : 'wss://badminton-rooms.zhang96790.workers.dev';

/** Room codes avoid look-alike characters (no I, O, 0 or 1). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

export function newRoomCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

export type Seat = 'host' | 'guest';

/** A line call as the host sends it (host's view; hitter is the host's side numbering). */
export interface WireCall { rect: { xMin: number; xMax: number; yMin: number; yMax: number }; signed: number; truthIn: boolean; callIn: boolean; hitter: 0 | 1; isServe: boolean }
export interface Roster {
  you: Seat;
  host: { name: string; connected: boolean } | null;
  guest: { name: string; connected: boolean } | null;
  settings: unknown;
  /** Quick-match rooms: both players' ratings. Null for private rooms. */
  ranked: { host: number; guest: number } | null;
}

/** The room's verdict on a ranked match: new ratings, or why they couldn't be saved. */
export type RankedResult = { winner: Seat; forfeit: boolean; change?: number; ratings?: { host: number; guest: number }; error?: string };

/** Messages the game sends to the other player (relayed by the room). */
export type GameMsg =
  | { type: 'settings'; settings: unknown }
  | { type: 'start'; settings: unknown }
  | { type: 'pos'; x: number; y: number; z: number; vx: number; vy: number; charge: number | null; jump: boolean }
  | { type: 'hit'; p: [number, number, number]; v: [number, number, number]; label: string; kmh: number; hand: string; detail: string; serve: boolean }
  | { type: 'land'; p: [number, number]; net: boolean; wide: boolean }
  | { type: 'point'; winner: 0 | 1; land: [number, number] | null; title: string; why: string | null; callIn: boolean | null; scores: [number, number]; games: [number, number]; call?: WireCall | null }
  | { type: 'challenge' }
  /** Guest to host: I was serving and ran out the shot clock. */
  | { type: 'delay' }
  | { type: 'review'; scores: [number, number]; games: [number, number] }
  | { type: 'pause'; on: boolean; all?: boolean }
  | { type: 'chat'; i: number }
  | { type: 'rtt'; ms: number }
  | { type: 'rematch' }
  | { type: 'forfeit' };

export type ServerMsg =
  | ({ type: 'roster' } & Roster)
  | { type: 'peer'; status: 'away' | 'back' | 'left'; seconds?: number; forfeit?: boolean }
  | { type: 'pong'; t: number }
  | { type: 'full' }
  | ({ type: 'result' } & RankedResult);

type Handler = (msg: GameMsg | ServerMsg) => void;

export class RoomConnection {
  /** Round trip to the server (ms), smoothed. */
  rtt = 0;
  /** The other player's round trip to the server, as they last reported it. */
  peerRtt = 0;
  roster: Roster | null = null;
  status: 'connecting' | 'open' | 'reconnecting' | 'closed' | 'full' = 'connecting';
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private pingTimer = 0;
  private retry = 0;
  private closedByUs = false;

  constructor(readonly code: string, private token: string, private name: string) {
    this.open();
  }

  /** One-way delay between the two players, roughly (ms). */
  get latency(): number { return (this.rtt + this.peerRtt) / 2; }

  on(h: Handler): () => void { this.handlers.add(h); return () => this.handlers.delete(h); }

  send(msg: GameMsg | { type: 'leave' }) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closedByUs = true;
    this.send({ type: 'leave' });
    clearInterval(this.pingTimer);
    this.ws?.close(1000);
    this.status = 'closed';
  }

  private open() {
    const url = `${ROOM_SERVER}/room/${this.code}?token=${encodeURIComponent(this.token)}&name=${encodeURIComponent(this.name)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.status = 'open';
      this.retry = 0;
      clearInterval(this.pingTimer);
      this.ping();
      this.pingTimer = window.setInterval(() => this.ping(), 2000);
    });
    ws.addEventListener('message', (e) => {
      let msg: GameMsg | ServerMsg;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg.type === 'pong') {
        const sample = performance.now() - msg.t;
        this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
        this.send({ type: 'rtt', ms: Math.round(this.rtt) });
        return;
      }
      if (msg.type === 'rtt') { this.peerRtt = msg.ms; return; }
      if (msg.type === 'roster') this.roster = msg;
      if (msg.type === 'full') this.status = 'full';
      for (const h of this.handlers) h(msg);
    });
    ws.addEventListener('close', () => {
      clearInterval(this.pingTimer);
      if (this.closedByUs || this.status === 'full') return;
      // Dropped: try again with backoff; the room keeps our seat for a minute.
      this.status = 'reconnecting';
      for (const h of this.handlers) h({ type: 'peer', status: 'away' } as ServerMsg & { self?: boolean });
      const wait = Math.min(5000, 500 * 2 ** this.retry++);
      window.setTimeout(() => { if (!this.closedByUs) this.open(); }, wait);
    });
  }

  private ping() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
  }
}

export type QueueEvent =
  | { type: 'queued'; rating: number }
  | { type: 'matched'; code: string; ticket: string; host: boolean; opponent: { name: string; rating: number } }
  | { type: 'error'; error: string }
  | { type: 'closed' };

/** Waiting for a quick match. Logs in with your account token; closes once you're matched. */
export class QueueConnection {
  private ws: WebSocket;
  private done = false;

  constructor(token: string, private onEvent: (e: QueueEvent) => void) {
    this.ws = new WebSocket(`${ROOM_SERVER}/queue`);
    this.ws.addEventListener('open', () => this.ws.send(JSON.stringify({ type: 'auth', token })));
    this.ws.addEventListener('message', (e) => {
      let msg: QueueEvent | { type: 'replaced' };
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg.type === 'matched') this.done = true;
      if (msg.type === 'replaced') { this.done = true; this.onEvent({ type: 'error', error: 'replaced' }); return; }
      this.onEvent(msg);
    });
    this.ws.addEventListener('close', () => { if (!this.done) this.onEvent({ type: 'closed' }); });
  }

  cancel() { this.done = true; this.ws.close(1000); }
}
