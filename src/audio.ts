import type { GameEvent } from './game';

/**
 * Synthesized sound set, so there are no asset files. Everything goes through one master bus (a
 * compressor keeps loud moments in check) with a little hall reverb, so hits and the crowd sound like
 * they're in an arena rather than in your ear.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  /** The crowd's constant murmur, louder when they're excited. */
  private murmur: GainNode | null = null;
  private _muted = false;

  get muted() { return this._muted; }
  set muted(m: boolean) {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = this.ctx = new AudioContext();
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 1;
    this.master.connect(comp).connect(ctx.destination);

    // Hall reverb: a second and a bit of decaying noise as the impulse.
    const irLen = Math.round(ctx.sampleRate * 1.3);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(this.master);

    // Crowd murmur: low, filtered, looping noise.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 0.5;
    this.murmur = ctx.createGain();
    this.murmur.gain.value = 0;
    src.connect(f).connect(this.murmur).connect(this.master);
    src.start();
  }

  play(e: GameEvent) {
    if (!this.ctx || this._muted) return;
    switch (e.type) {
      case 'hit': {
        // A racket hit: the strings' ping, the cork's knock, and a crack on the big ones.
        const s = e.strength;
        this.sweep(2600 + 900 * s, 1700, 0.06 + 0.14 * s, 0.045 + 0.03 * s, 'triangle', 0, 0.25);
        this.burst(420 + 260 * s, 1.1, 0.22 + 0.42 * s, 0.028 + 0.02 * s, 'bandpass', 0, 0.2);
        if (s > 0.55) this.burst(4200, 0.7, 0.32 * s, 0.018, 'highpass', 0, 0.35);
        break;
      }
      case 'net':
        this.burst(480, 0.8, 0.35, 0.14, 'lowpass', 0, 0.2);
        this.tone(130, 0.18, 0.12, 'sine');
        break;
      case 'land':
        // Feathers and cork on a wooden court: a soft, dull tock.
        this.burst(800, 0.9, 0.2, 0.06, 'lowpass', 0, 0.25);
        this.tone(210, 0.09, 0.07, 'sine');
        break;
      case 'whiff':
        this.sweep(900, 2200, 0.05, 0.13, 'sawtooth', 0, 0, 'bandpass');
        break;
      case 'squeak':
        // Shoes on the court as a player stops or turns hard.
        this.sweep(1900 + Math.random() * 600, 2600 + Math.random() * 500, e.near ? 0.07 : 0.03, 0.09, 'square', 0, 0.15, 'bandpass', e.pan);
        break;
      case 'step':
        this.burst(160 + Math.random() * 60, 1.4, e.near ? 0.12 : 0.05, 0.05, 'lowpass', 0, 0.12, e.pan);
        break;
      case 'point':
        this.tone(880, 0.07, 0.18, 'sine', 0.05);
        this.tone(1320, 0.06, 0.25, 'sine', 0.13);
        break;
      case 'applause':
        this.applause(e.intensity);
        break;
    }
  }

  /** A crowd: claps scattered over a couple of seconds, and a cheer that swells for big points. */
  private applause(intensity: number) {
    const n = Math.round(30 + 110 * intensity), dur = 1.3 + 1.7 * intensity;
    for (let i = 0; i < n; i++) {
      const at = Math.random() * dur * (0.35 + 0.65 * Math.random());
      this.burst(1100 + Math.random() * 1900, 1.2, 0.018 + 0.03 * Math.random(), 0.03, 'bandpass', at, 0.4, Math.random() * 1.6 - 0.8);
    }
    if (intensity > 0.45) {
      this.sweep(650, 1050, 0.05 * intensity, dur * 0.8, 'sawtooth', 0.05, 0.5, 'bandpass');
      this.burst(520, 0.5, 0.06 * intensity, dur, 'lowpass', 0, 0.5);
    }
  }

  private clapT = 0;
  private clapN = 0;
  /** Each frame: the crowd murmur follows how excited they are; a slow clap while Hawk-Eye reviews. */
  update(dt: number, reviewing: boolean, cheer = 0, playing = true) {
    if (this.murmur && this.ctx) this.murmur.gain.setTargetAtTime(playing ? 0.012 + 0.035 * cheer : 0, this.ctx.currentTime, 0.4);
    if (!reviewing) { this.clapT = 0; this.clapN = 0; return; }
    if (!this.ctx || this._muted) return;
    this.clapT -= dt;
    if (this.clapT <= 0) {
      for (let i = 0; i < 16; i++) this.burst(1300 + Math.random() * 1500, 1.1, 0.033, 0.035, 'bandpass', Math.random() * 0.03, 0.4, Math.random() * 1.4 - 0.7);
      this.clapN++;
      this.clapT = Math.max(0.22, 0.55 - this.clapN * 0.03);
    }
  }

  /** Where a sound goes: through a stereo position to the master bus, with some sent to the reverb. */
  private out(node: AudioNode, wet: number, pan: number) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p).connect(this.master!);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w).connect(this.reverb!); }
  }

  private burst(freq: number, q: number, gain: number, decay: number, type: BiquadFilterType = 'bandpass', delay = 0, wet = 0, pan = 0) {
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
    src.connect(f).connect(g);
    this.out(g, wet, pan);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  private tone(freq: number, gain: number, decay: number, type: OscillatorType, delay = 0, wet = 0.15) {
    this.sweep(freq, freq, gain, decay, type, delay, wet);
  }

  /** A tone that glides from one pitch to another as it fades (optionally through a filter). */
  private sweep(from: number, to: number, gain: number, decay: number, type: OscillatorType, delay = 0, wet = 0.15, filter?: BiquadFilterType, pan = 0) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    let node: AudioNode = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.value = (from + to) / 2; f.Q.value = 2; node = o.connect(f); }
    node.connect(g);
    this.out(g, wet, pan);
    o.start(t);
    o.stop(t + decay + 0.02);
  }
}
