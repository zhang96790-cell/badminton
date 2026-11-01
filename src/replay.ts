import { REPLAY } from './config';
import type { V3 } from './math';
import type { PlayerView } from './player';

export interface ShuttleView { pos: V3; dir: V3; vel: V3; inFlight: boolean; trail: V3[] }

export interface Frame { t: number; players: PlayerView[]; shuttle: ShuttleView }

/** Records the rally at 60 frames per game-second so it can be replayed or reviewed by Hawk-Eye. */
export class Recorder {
  frames: Frame[] = [];
  /** Game time the shuttle landed, if it has. */
  landedAt: number | null = null;
  t = 0;
  private acc = 0;

  reset() {
    this.frames = [];
    this.landedAt = null;
    this.t = 0;
    this.acc = 0;
  }

  record(dt: number, players: { snapshot(): PlayerView }[], s: ShuttleView) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / 60) return;
    this.acc %= 1 / 60;
    this.frames.push({
      t: this.t,
      players: players.map((p) => p.snapshot()),
      shuttle: { pos: { ...s.pos }, dir: { ...s.dir }, vel: { ...s.vel }, inFlight: s.inFlight, trail: s.trail.slice(-8).map((p) => ({ ...p })) },
    });
    while (this.frames.length && this.frames[0].t < this.t - REPLAY.maxSeconds) this.frames.shift();
  }

  markLanding() { this.landedAt = this.t; }

  /** Shuttle positions over the last `seconds` before it landed (for Hawk-Eye). */
  pathBefore(seconds: number): V3[] {
    const end = this.landedAt ?? this.t;
    return this.frames.filter((f) => f.t >= end - seconds && f.t <= end + 1e-6).map((f) => ({ ...f.shuttle.pos }));
  }
}

/** Plays recorded frames back in slow motion, slowest just before the shuttle lands. */
export class Playback {
  t: number;
  done = false;
  private end: number;

  constructor(private frames: Frame[], start: number, private landedAt: number | null, public auto: boolean) {
    this.t = Math.max(frames[0]?.t ?? 0, start);
    this.end = frames[frames.length - 1]?.t ?? 0;
  }

  get speed(): number {
    const l = this.landedAt;
    return l !== null && this.t > l - REPLAY.finalSeconds && this.t < l + 0.25 ? REPLAY.finalSlowmo : REPLAY.speed;
  }

  get progress(): number {
    const start = this.frames[0]?.t ?? 0;
    return this.end > start ? (this.t - start) / (this.end - start) : 1;
  }

  update(realDt: number) {
    this.t += realDt * this.speed;
    if (this.t >= this.end) { this.t = this.end; this.done = true; }
  }

  frame(): Frame {
    const f = this.frames;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid].t <= this.t) lo = mid; else hi = mid - 1;
    }
    return f[lo];
  }
}
