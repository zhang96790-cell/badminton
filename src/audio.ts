import type { GameEvent } from './game';

/** Tiny synthesized sound set, so there are no asset files. */
export class Sound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  play(e: GameEvent) {
    if (!this.ctx || this.muted) return;
    switch (e.type) {
      case 'hit':
        this.burst(2200 + 2600 * e.strength, 1.4, 0.18 + 0.5 * e.strength, 0.035 + 0.04 * e.strength);
        this.tone(650 + 500 * e.strength, 0.12 + 0.12 * e.strength, 0.05, 'triangle');
        break;
      case 'net':
        this.burst(500, 0.8, 0.35, 0.12, 'lowpass');
        this.tone(140, 0.2, 0.1, 'sine');
        break;
      case 'land':
        this.burst(900, 0.9, 0.18, 0.06, 'lowpass');
        break;
      case 'whiff':
        this.burst(1600, 0.6, 0.1, 0.12);
        break;
      case 'point':
        this.tone(880, 0.08, 0.18, 'sine', 0.05);
        this.tone(1320, 0.07, 0.25, 'sine', 0.13);
        break;
      case 'applause':
        this.applause(e.intensity);
        break;
    }
  }

  /** A crowd: lots of individual claps scattered over a couple of seconds, plus a roar for big points. */
  private applause(intensity: number) {
    const n = Math.round(20 + 90 * intensity), dur = 1.2 + 1.6 * intensity;
    for (let i = 0; i < n; i++) {
      const at = Math.random() * dur * (0.4 + 0.6 * Math.random());
      this.burst(1200 + Math.random() * 1800, 1.2, 0.02 + 0.03 * Math.random(), 0.03, 'bandpass', at);
    }
    if (intensity > 0.5) this.burst(600, 0.5, 0.05 * intensity, dur, 'lowpass');
  }

  private clapT = 0;
  private clapN = 0;
  /** Rhythmic slow clap while Hawk-Eye reviews a challenge, speeding up toward the verdict. */
  update(dt: number, reviewing: boolean) {
    if (!reviewing) { this.clapT = 0; this.clapN = 0; return; }
    if (!this.ctx || this.muted) return;
    this.clapT -= dt;
    if (this.clapT <= 0) {
      for (let i = 0; i < 14; i++) this.burst(1300 + Math.random() * 1500, 1.1, 0.035, 0.035, 'bandpass', Math.random() * 0.03);
      this.clapN++;
      this.clapT = Math.max(0.22, 0.55 - this.clapN * 0.03);
    }
  }

  private burst(freq: number, q: number, gain: number, decay: number, type: BiquadFilterType = 'bandpass', delay = 0) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  private tone(freq: number, gain: number, decay: number, type: OscillatorType, delay = 0) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + decay + 0.02);
  }
}
