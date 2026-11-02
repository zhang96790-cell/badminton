export type Speaker = 'umpire' | 'line' | 'service' | 'partner';

/** Umpire and line-judge calls through the browser's built-in text-to-speech. */
export class Voice {
  enabled = true;
  private voices: SpeechSynthesisVoice[] = [];
  private synth: SpeechSynthesis | null = 'speechSynthesis' in window ? window.speechSynthesis : null;

  constructor() {
    if (!this.synth) return;
    const load = () => { this.voices = this.synth!.getVoices().filter((v) => v.lang.startsWith('en')); };
    load();
    this.synth.addEventListener('voiceschanged', load);
  }

  /** Some browsers only allow speech after a user gesture; call from a click. */
  unlock() {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.synth.speak(u);
  }

  say(text: string, who: Speaker, interrupt = false) {
    if (!this.enabled || !this.synth) return;
    if (interrupt) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const gb = this.voices.filter((v) => v.lang === 'en-GB');
    const pool = gb.length ? gb : this.voices;
    // Umpire gets the first British voice; line judges a different one where available.
    // Your doubles partner gets a third voice, quick and short.
    u.voice = (who === 'umpire' ? pool[0] : who === 'partner' ? pool[2] ?? this.voices[2] ?? pool[1] : pool[1] ?? this.voices[1] ?? pool[0]) ?? null;
    u.rate = who === 'line' ? 1.1 : who === 'partner' ? 1.25 : 0.98;
    u.pitch = who === 'line' ? 1.15 : who === 'service' ? 0.9 : who === 'partner' ? 1.05 : 1;
    u.volume = who === 'line' ? 1 : 0.9;
    this.synth.speak(u);
  }

  stop() { this.synth?.cancel(); }
}
