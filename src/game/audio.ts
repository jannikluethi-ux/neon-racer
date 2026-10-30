import { clamp } from "./math";
import { themeFor, trackById } from "./track-def";
import { vehicleById } from "./vehicle-def";

type Tone = { osc: OscillatorNode; gain: GainNode };

type HitVoice = {
  body: OscillatorNode;
  bodyGain: GainNode;
  noiseGain: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
};

/**
 * One persistent arcade-engine graph. Created on the first gesture and then only
 * parameter values change. Pitch follows RPM. Throttle opens the load layers.
 */
export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private body: Tone | null = null;
  private body2: Tone | null = null;
  private harm: Tone | null = null;
  private high: Tone | null = null;
  private toneFilter: BiquadFilterNode | null = null;
  private harmFilter: BiquadFilterNode | null = null;
  private highFilter: BiquadFilterNode | null = null;
  private exhaust: GainNode | null = null;
  private exhaustFilter: BiquadFilterNode | null = null;
  private tire: GainNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private wind: GainNode | null = null;
  private nitro: Tone | null = null;
  private nitroAir: GainNode | null = null;
  private city: GainNode | null = null;
  private yard: GainNode | null = null;
  private coast: GainNode | null = null;
  private core: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private shiftGain: GainNode | null = null;
  private shiftBody: Tone | null = null;
  private hits: HitVoice[] = [];
  private hitCursor = 0;
  volume = 0.8;
  private started = false;
  private lastImpact = 0;
  private lastShift = 0;
  private shiftAt = -10;
  private wasBoost = false;
  private track = "";

  unlock(): void {
    if (this.started) {
      if (this.ctx?.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);

    const engine = ctx.createGain();
    engine.gain.value = 1;
    const hip = ctx.createBiquadFilter();
    hip.type = "highpass";
    hip.frequency.value = 35;
    hip.Q.value = 0.5;
    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = 1800;
    toneFilter.Q.value = 0.5;
    engine.connect(hip);
    hip.connect(toneFilter);
    toneFilter.connect(master);

    const body = this.tone(ctx, "triangle", 80, engine);
    const body2 = this.tone(ctx, "sawtooth", 81, engine);
    const harm = this.tone(ctx, "triangle", 240, engine);
    const harmFilter = ctx.createBiquadFilter();
    harmFilter.type = "lowpass";
    harmFilter.frequency.value = 320;
    harmFilter.Q.value = 0.4;
    harm.osc.disconnect();
    harm.osc.connect(harmFilter);
    harmFilter.connect(harm.gain);

    const high = this.tone(ctx, "triangle", 480, engine);
    const highFilter = ctx.createBiquadFilter();
    highFilter.type = "highpass";
    highFilter.frequency.value = 700;
    highFilter.Q.value = 0.4;
    high.osc.disconnect();
    high.osc.connect(highFilter);
    highFilter.connect(high.gain);

    const noise = this.noiseBuffer(ctx);
    const exhaustFilter = ctx.createBiquadFilter();
    exhaustFilter.type = "lowpass";
    exhaustFilter.frequency.value = 240;
    exhaustFilter.Q.value = 0.5;
    const exhaust = ctx.createGain();
    exhaust.gain.value = 0;
    this.loop(ctx, noise, exhaustFilter);
    exhaustFilter.connect(exhaust);
    exhaust.connect(engine);

    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = "bandpass";
    tireFilter.frequency.value = 1500;
    tireFilter.Q.value = 1.1;
    const tire = ctx.createGain();
    tire.gain.value = 0;
    this.loop(ctx, noise, tireFilter);
    tireFilter.connect(tire);
    tire.connect(master);

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 300;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    this.loop(ctx, noise, windFilter);
    windFilter.connect(wind);
    wind.connect(master);

    const nitro = this.tone(ctx, "sawtooth", 58, master);
    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = "lowpass";
    nitroFilter.frequency.value = 240;
    nitro.osc.disconnect();
    nitro.osc.connect(nitroFilter);
    nitroFilter.connect(nitro.gain);
    const nitroAirFilter = ctx.createBiquadFilter();
    nitroAirFilter.type = "bandpass";
    nitroAirFilter.frequency.value = 880;
    nitroAirFilter.Q.value = 0.45;
    const nitroAir = ctx.createGain();
    nitroAir.gain.value = 0;
    this.loop(ctx, noise, nitroAirFilter);
    nitroAirFilter.connect(nitroAir);
    nitroAir.connect(master);

    const cityFilter = ctx.createBiquadFilter();
    cityFilter.type = "bandpass";
    cityFilter.frequency.value = 480;
    cityFilter.Q.value = 0.4;
    const city = ctx.createGain();
    city.gain.value = 0.004;
    this.loop(ctx, noise, cityFilter);
    cityFilter.connect(city);
    city.connect(master);

    const yardFilter = ctx.createBiquadFilter();
    yardFilter.type = "lowpass";
    yardFilter.frequency.value = 150;
    const yard = ctx.createGain();
    yard.gain.value = 0;
    this.loop(ctx, noise, yardFilter);
    yardFilter.connect(yard);
    yard.connect(master);
    const hum = this.tone(ctx, "sine", 55, yard);
    hum.gain.gain.value = 0.4;

    const coastFilter = ctx.createBiquadFilter();
    coastFilter.type = "highpass";
    coastFilter.frequency.value = 700;
    coastFilter.Q.value = 0.4;
    const coast = ctx.createGain();
    coast.gain.value = 0;
    this.loop(ctx, noise, coastFilter);
    coastFilter.connect(coast);
    coast.connect(master);

    const coreFilter = ctx.createBiquadFilter();
    coreFilter.type = "lowpass";
    coreFilter.frequency.value = 110;
    const core = ctx.createGain();
    core.gain.value = 0;
    this.loop(ctx, noise, coreFilter);
    coreFilter.connect(core);
    core.connect(master);

    const shiftFilter = ctx.createBiquadFilter();
    shiftFilter.type = "bandpass";
    shiftFilter.frequency.value = 520;
    shiftFilter.Q.value = 0.8;
    const shiftGain = ctx.createGain();
    shiftGain.gain.value = 0;
    this.loop(ctx, noise, shiftFilter);
    shiftFilter.connect(shiftGain);
    shiftGain.connect(master);
    const shiftBody = this.tone(ctx, "triangle", 100, master);

    const hits: HitVoice[] = [];
    for (let i = 0; i < 3; i++) hits.push(this.hitVoice(ctx, master, noise));

    this.ctx = ctx;
    this.master = master;
    this.body = body;
    this.body2 = body2;
    this.harm = harm;
    this.high = high;
    this.toneFilter = toneFilter;
    this.harmFilter = harmFilter;
    this.highFilter = highFilter;
    this.exhaust = exhaust;
    this.exhaustFilter = exhaustFilter;
    this.tire = tire;
    this.tireFilter = tireFilter;
    this.wind = wind;
    this.nitro = nitro;
    this.nitroAir = nitroAir;
    this.city = city;
    this.yard = yard;
    this.coast = coast;
    this.core = core;
    this.noise = noise;
    this.shiftGain = shiftGain;
    this.shiftBody = shiftBody;
    this.hits = hits;
    this.started = true;
    if (ctx.state === "suspended") void ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  update(state: {
    rpm: number;
    throttle: number;
    brake: number;
    drift: boolean;
    slip: number;
    slipAngle?: number;
    boosting: boolean;
    shifts: number;
    gear?: number;
    speed?: number;
    driftState?: number;
    track?: string;
    vehicle?: string;
  }): void {
    if (!this.started) return;
    if (!this.ctx || !this.body || !this.body2 || !this.harm || !this.high || !this.toneFilter || !this.harmFilter || !this.highFilter || !this.exhaust || !this.exhaustFilter || !this.tire || !this.tireFilter || !this.wind || !this.nitro || !this.nitroAir) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const rpm = clamp(state.rpm, 0.08, 1);
    const throttle = clamp(state.throttle, 0, 1);
    const brake = clamp(state.brake, 0, 1);
    const voice = vehicleById(state.vehicle).voice;
    const gear = state.gear ?? 0;
    const note = (62 + rpm * 88 + gear * 5) * voice.pitch;
    const now = this.ctx.currentTime;
    const duck = now - this.shiftAt < 0.1 ? 0.55 : 1;
    const lift = throttle < 0.08 ? 0.7 : 1;
    const detune = voice.detune;

    this.body.osc.frequency.value = note;
    this.body2.osc.frequency.value = note * detune;
    this.harm.osc.frequency.value = note * 2;
    this.high.osc.frequency.value = note * 3;
    this.harmFilter.frequency.value = 180 + note * 1.5;
    this.highFilter.frequency.value = 900;
    this.toneFilter.frequency.value = 240 + note * 2.4 + throttle * 160;

    this.body.gain.gain.value = (0.16 + throttle * 0.04) * lift * duck;
    this.body2.gain.gain.value = (0.025 + throttle * 0.03) * lift * duck * voice.grit;
    this.harm.gain.gain.value = (0.012 + throttle * 0.028) * (0.4 + rpm * 0.6) * duck * voice.harm;
    this.high.gain.gain.value = 0;

    this.exhaustFilter.frequency.value = 140 + throttle * 200 + rpm * 70;
    this.exhaust.gain.value = throttle * (0.008 + rpm * 0.012) * duck * voice.exhaust;

    const speed = Math.max(0, state.speed ?? 0);
    this.wind.gain.value = Math.min(0.022, (speed / 68) * 0.02) * (state.boosting ? 1.25 : 1);

    const stage = state.driftState ?? (state.drift ? 2 : 0);
    const tireLevel = stage >= 3 ? 0.08 : stage === 2 ? 0.045 : stage === 1 ? 0.012 : stage === 4 ? 0.025 : 0;
    const slip = Math.max(0, state.slip - 2) * 0.004 + Math.max(0, (state.slipAngle ?? 0) - 0.12) * 0.1;
    const brakeHiss = brake > 0.3 && speed > 6 ? 0.028 * brake : 0;
    this.tireFilter.frequency.value = stage >= 3 ? 1900 : 1400;
    this.tire.gain.value = Math.min(0.11, tireLevel + slip + brakeHiss);

    const nitroOn = state.boosting ? 1 : 0;
    this.nitro.osc.frequency.value = 48 + rpm * 36;
    this.nitro.gain.gain.value = nitroOn * (0.06 + voice.bark);
    this.nitroAir.gain.value = nitroOn * 0.05;
    if (state.boosting && !this.wasBoost) this.burst(480, 0.18, 0.055);
    this.wasBoost = state.boosting;

    if (state.track && state.track !== this.track && this.city && this.yard && this.coast && this.core) {
      this.track = state.track;
      const kind = themeFor(trackById(state.track).themeId).kind;
      this.city.gain.value = kind === "yard" ? 0.002 : kind === "city" ? 0.004 : 0.001;
      this.yard.gain.value = kind === "yard" ? 0.022 : 0;
      this.coast.gain.value = kind === "coast" ? 0.018 : 0;
      this.core.gain.value = kind === "core" ? 0.026 : 0;
    }

    if (state.shifts !== this.lastShift) {
      this.lastShift = state.shifts;
      if (state.shifts > 0) this.shift(now, rpm);
    }
  }

  beep(freq: number, dur: number, gain = 0.07): void {
    this.blip(freq, dur, gain);
  }

  /** strength 0..1 from the collision pulse. pan -1..1 is the contact side. */
  impact(strength: number, pan = 0): void {
    if (!this.ctx || !this.master || this.volume <= 0 || this.hits.length === 0) return;
    const now = this.ctx.currentTime;
    const s = clamp(strength, 0, 1);
    const light = s < 0.28;
    const heavy = s > 0.62;
    const gap = light ? 0.09 : heavy ? 0.22 : 0.13;
    if (now - this.lastImpact < gap) return;
    this.lastImpact = now;
    const voice = this.hits[this.hitCursor % this.hits.length]!;
    this.hitCursor++;
    const dur = light ? 0.055 : heavy ? 0.26 : 0.14;
    const f0 = light ? 220 : heavy ? 64 : 120;
    const f1 = light ? 140 : heavy ? 36 : 54;
    const body = (light ? 0.08 : heavy ? 0.22 : 0.12) * (0.7 + s * 0.5);
    const air = (light ? 0.05 : heavy ? 0.12 : 0.07) * (0.65 + s * 0.5);
    voice.panner.pan.setValueAtTime(clamp(pan, -1, 1), now);
    voice.filter.frequency.setValueAtTime(light ? 1400 : heavy ? 260 : 620, now);
    voice.body.frequency.cancelScheduledValues(now);
    voice.body.frequency.setValueAtTime(f0, now);
    voice.body.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
    voice.bodyGain.gain.cancelScheduledValues(now);
    voice.bodyGain.gain.setValueAtTime(body, now);
    voice.bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    voice.noiseGain.gain.cancelScheduledValues(now);
    voice.noiseGain.gain.setValueAtTime(air, now);
    voice.noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur * (heavy ? 1.1 : 0.75));
  }

  finish(): void {
    this.blip(523, 0.12, 0.06);
    window.setTimeout(() => this.blip(659, 0.12, 0.06), 120);
    window.setTimeout(() => this.blip(784, 0.22, 0.07), 240);
  }

  private shift(now: number, rpm: number): void {
    this.shiftAt = now;
    if (this.shiftGain) {
      this.shiftGain.gain.cancelScheduledValues(now);
      this.shiftGain.gain.setValueAtTime(0.06, now);
      this.shiftGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    }
    if (this.shiftBody) {
      this.shiftBody.osc.frequency.setValueAtTime(140 + rpm * 30, now);
      this.shiftBody.osc.frequency.exponentialRampToValueAtTime(70, now + 0.07);
      this.shiftBody.gain.gain.cancelScheduledValues(now);
      this.shiftBody.gain.gain.setValueAtTime(0.05, now);
      this.shiftBody.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    }
  }

  private tone(ctx: AudioContext, type: OscillatorType, freq: number, dest: AudioNode): Tone {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    return { osc, gain };
  }

  private hitVoice(ctx: AudioContext, master: AudioNode, noise: AudioBuffer): HitVoice {
    const panner = ctx.createStereoPanner();
    panner.connect(master);
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.value = 90;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0;
    body.connect(bodyGain);
    bodyGain.connect(panner);
    body.start();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 700;
    filter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    this.loop(ctx, noise, filter);
    filter.connect(noiseGain);
    noiseGain.connect(panner);
    return { body, bodyGain, noiseGain, filter, panner };
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = brown * 3.2;
    }
    return buffer;
  }

  private loop(ctx: AudioContext, buffer: AudioBuffer, dest: AudioNode): void {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(dest);
    src.start();
  }

  private blip(freq: number, dur: number, gain: number): void {
    if (!this.ctx || !this.master || this.volume <= 0) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private burst(freq: number, dur: number, gain: number): void {
    if (!this.ctx || !this.master || !this.noise || this.volume <= 0) return;
    const now = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }
}
