// Players online: a small socket to the room server that says this page is open (and what it's doing),
// and asks how many people are about. Everything here fails quietly: if the server can't be reached,
// the count just shows "--".
import { ROOM_SERVER } from './net';

export type PresenceState = 'menu' | 'queue' | 'room' | 'match';
export interface PresenceCounts { online: number; inQueue: number; inMatch: number; inRoom: number; updatedAt: number }

const BEAT_MS = 25_000;
/** A tab left in the background this long stops counting (and stops beating). */
const HIDDEN_STOP_MS = 120_000;

export class PresenceLink {
  counts: PresenceCounts | null = null;
  private ws: WebSocket | null = null;
  private beatTimer = 0;
  private hiddenTimer = 0;
  private retry = 0;
  private stopped = false;
  private listeners = new Set<(c: PresenceCounts | null) => void>();

  /** key: your account id, or a random id for this guest tab. state: what you're doing right now. */
  constructor(private key: () => string, private state: () => PresenceState) {
    document.addEventListener('visibilitychange', () => {
      clearTimeout(this.hiddenTimer);
      if (document.visibilityState === 'hidden') this.hiddenTimer = window.setTimeout(() => this.pause(), HIDDEN_STOP_MS);
      else if (!this.ws && !this.stopped) this.open();
    });
    this.open();
  }

  onCounts(f: (c: PresenceCounts | null) => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }

  /** Ask for fresh counts (the server answers at most every 5 seconds). */
  ask() { this.send({ type: 'counts' }); }

  /** Say what you're doing now (e.g. you just joined the queue), without waiting for the next beat. */
  beat() { this.send({ type: 'beat', state: this.state() }); }

  private send(msg: unknown) { if (this.ws?.readyState === WebSocket.OPEN) { try { this.ws.send(JSON.stringify(msg)); } catch { /* ignore */ } } }

  private emit() { for (const f of this.listeners) f(this.counts); }

  private pause() {
    clearInterval(this.beatTimer);
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(1000); } catch { /* ignore */ }
  }

  private open() {
    let ws: WebSocket;
    try { ws = new WebSocket(`${ROOM_SERVER}/presence`); } catch { return; }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      this.send({ type: 'hello', key: this.key(), state: this.state() });
      clearInterval(this.beatTimer);
      this.beatTimer = window.setInterval(() => this.beat(), BEAT_MS);
      if (this.listeners.size) this.ask();
    });
    ws.addEventListener('message', (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m.type === 'counts') { this.counts = m; this.emit(); }
      } catch { /* ignore */ }
    });
    ws.addEventListener('close', (e) => {
      if (this.ws !== ws) return; // paused on purpose
      clearInterval(this.beatTimer);
      this.ws = null;
      this.counts = null;
      this.emit();
      // Too many tabs for this account: this one stays quiet.
      if (e.code === 4003) { this.stopped = true; return; }
      const wait = Math.min(60_000, 2000 * 2 ** this.retry++);
      window.setTimeout(() => { if (!this.ws && !this.stopped && document.visibilityState === 'visible') this.open(); }, wait);
    });
  }
}
