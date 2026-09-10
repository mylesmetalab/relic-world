/**
 * A synthesized soundscape — no samples. Everything is noise and a handful
 * of oscillators shaped to read as paper, ink and rock:
 *  - footsteps as filtered noise bursts (pitch by surface speed),
 *  - jump / land / mantle thumps,
 *  - prop knocks scaled by impact,
 *  - the "press": a roller hum whose level follows how much new rock is
 *    being inked right now, so exploring is audible,
 *  - a chat blip when someone starts talking.
 * The context starts on the first click (browser autoplay rules). M mutes.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private press: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  private pressLevel = 0;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Call from a user gesture. Idempotent. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    // Two seconds of white noise, reused by every burst.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Press roller: band-passed noise, level driven by inking rate.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 520;
    bp.Q.value = 1.4;
    this.press = ctx.createGain();
    this.press.gain.value = 0;
    src.connect(bp).connect(this.press).connect(this.master);
    src.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx!.currentTime, 0.05);
    return this.muted;
  }

  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = "bandpass"): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine"): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.6), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Footfall — a short scuff, brighter when running. */
  step(speed: number): void {
    const run = Math.min(1, speed / 7);
    this.burst(900 + run * 900, 0.9, 0.09, 0.22 + run * 0.1);
    this.tone(70 - run * 10, 0.08, 0.12);
  }
  jump(): void {
    this.burst(600, 1.2, 0.12, 0.18);
  }
  land(v: number): void {
    const k = Math.min(1, Math.abs(v) / 12);
    this.tone(55, 0.16, 0.25 + k * 0.3);
    this.burst(400, 0.8, 0.14, 0.2 + k * 0.25);
  }
  mantle(): void {
    this.burst(1400, 0.6, 0.35, 0.16, "highpass");
    this.tone(90, 0.3, 0.14, "triangle");
  }
  /** A rock knock; `impact` in m/s of velocity change. */
  knock(impact: number): void {
    const k = Math.min(1, impact / 8);
    if (k < 0.08) return;
    this.tone(120 + k * 80, 0.12 + k * 0.1, 0.1 + k * 0.3, "triangle");
    this.burst(300 + k * 500, 1.1, 0.1 + k * 0.1, 0.15 + k * 0.3);
  }
  /** A pick into rock: a dull thud and a spray of grit. Steps ring a little
   *  higher; a roof cut (swung up into rock overhead) rings highest of all. */
  dig(kind: "pit" | "tunnel" | "step" | "roof" = "pit"): void {
    const hi = kind === "roof" ? 1.4 : kind === "step" ? 1.25 : kind === "tunnel" ? 1.1 : 1;
    this.tone(95 * hi, 0.11, 0.3, "triangle");
    this.burst(650 * hi, 1.0, 0.13, 0.3);
    this.burst(2600, 0.7, 0.18, 0.12, "highpass");
  }
  /** The wandering presence, near but unlit: a soft, one-shot low creak —
   *  occasional (main.ts gates the cadence), never a sustained drone. */
  presence(): void {
    this.tone(150, 0.55, 0.05, "sine");
    this.burst(220, 2.4, 0.45, 0.05, "lowpass");
  }
  blip(): void {
    this.tone(880, 0.09, 0.12);
    setTimeout(() => this.tone(1320, 0.08, 0.1), 70);
  }
  /** `rate` = freshly inked texels this frame; the roller hums while the world prints. */
  print(rate: number, dt: number): void {
    if (!this.press || !this.ctx) return;
    const target = Math.min(0.28, rate * 0.0015);
    this.pressLevel += (target - this.pressLevel) * Math.min(1, dt * 4);
    this.press.gain.setTargetAtTime(this.pressLevel, this.ctx.currentTime, 0.05);
  }
}
