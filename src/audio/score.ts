/**
 * Generative ambient score: a slow modal drone with sparse Karplus-Strong
 * "tagelharpa" phrases picked by seeded PRNG. Intensity 0..1 raises phrase
 * density and brings in a low pulse. All events are scheduled on absolute
 * AudioContext time (nextTime += step), so the loop never drifts. Levels are
 * kept low so the score sits under sfx in the mix, and the output is shelved and
 * low-passed so the plucks read as warm rather than glassy.
 */

import type { PRNG } from '../core/prng.ts';
import { ksPluck, tone, type SynthContext, type VoicePart } from './synth.ts';

const ROOT = 73.42; // D2
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10] as const;
const LOOKAHEAD = 0.6;
const TICK_MS = 120;
const PULSE_STEP = 0.75;
const OUT_LEVEL = 0.5;
const PLUCK_RING = 2.6;

const semitone = (base: number, steps: number): number => base * 2 ** (steps / 12);

export class Score {
  private readonly ctx: SynthContext;
  private readonly out: GainNode;
  private readonly calmBus: GainNode;
  private readonly tenseBus: GainNode;
  private readonly prng: PRNG;
  private droneParts: VoicePart[] = [];
  private plucks: { part: VoicePart; endsAt: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private intensity = 0;
  private nextPhraseTime = 0;
  private nextPulseTime = 0;
  private modeIsAeolian = false;

  constructor(ctx: SynthContext, dest: AudioNode, prng: PRNG) {
    this.ctx = ctx;
    this.prng = prng;
    this.out = ctx.createGain();
    this.out.gain.value = OUT_LEVEL;
    this.calmBus = ctx.createGain();
    this.tenseBus = ctx.createGain();
    this.calmBus.gain.value = 1;
    this.tenseBus.gain.value = 0;
    this.calmBus.connect(this.out);
    this.tenseBus.connect(this.out);

    // Voicing. Karplus-Strong plucks are harmonically rich, and over a drone
    // this dark their upper partials stand out as a shrill ping rather than as
    // brightness. The drone fundamentals live between 36 and 110 Hz and the
    // plucks between 147 and 524 Hz, so everything musical sits well below this
    // shelf; only the harmonic glare is taken off.
    const glare = ctx.createBiquadFilter();
    glare.type = 'highshelf';
    glare.frequency.value = 2200;
    glare.gain.value = -5;

    const ceiling = ctx.createBiquadFilter();
    ceiling.type = 'lowpass';
    ceiling.frequency.value = 3200;
    // No resonance: a peak here would reintroduce exactly what it removes.
    ceiling.Q.value = 0.4;

    this.out.connect(glare);
    glare.connect(ceiling);
    ceiling.connect(dest);
  }

  start(): void {
    if (this.timer !== null) return;
    const now = this.ctx.currentTime;
    this.sweepPlucks(now);
    // stop() faded `out` to silence; a restart must bring it back up.
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(0.0001, now);
    this.out.gain.setTargetAtTime(OUT_LEVEL, now, 0.4);
    this.modeIsAeolian = this.prng() < 0.5;
    this.startDrone();
    this.nextPhraseTime = now + 1.5 + this.prng() * 2;
    this.nextPulseTime = now + PULSE_STEP;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  setIntensity(intensity: number): void {
    this.intensity = Math.min(1, Math.max(0, intensity));
    const t = this.ctx.currentTime;
    this.calmBus.gain.setTargetAtTime(1 - this.intensity * 0.6, t, 1.2);
    this.tenseBus.gain.setTargetAtTime(this.intensity, t, 1.2);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const t = this.ctx.currentTime;
    for (const p of this.droneParts) p.stop(t + 1.5);
    this.droneParts = [];
    for (const p of this.plucks) {
      p.part.stop(t + 1.2);
      p.endsAt = Math.min(p.endsAt, t + 1.5);
    }
    this.out.gain.setTargetAtTime(0.0001, t, 0.8);
  }

  private get scale(): readonly number[] {
    return this.modeIsAeolian ? AEOLIAN : DORIAN;
  }

  private startDrone(): void {
    const t0 = this.ctx.currentTime;
    const long = 60 * 60 * 24; // effectively endless; stop() releases it
    const env = { attack: 3, decay: long, peak: 0.11, sustain: 1 };
    for (const [freq, detune, type] of [
      [ROOT, -5, 'sawtooth'],
      [ROOT, 5, 'sawtooth'],
      [ROOT / 2, 0, 'triangle'],
      [ROOT * 1.5, 2, 'triangle'],
    ] as const) {
      this.droneParts.push(
        tone(this.ctx, this.calmBus, {
          when: t0,
          duration: long,
          type,
          frequency: freq,
          detune,
          env: { ...env, peak: env.peak * (type === 'sawtooth' ? 1 : 0.6) },
        }),
      );
    }
  }

  /** KS delay cycles stay alive even when silent — disconnect rung-out plucks. */
  private sweepPlucks(now: number): void {
    const alive: { part: VoicePart; endsAt: number }[] = [];
    for (const p of this.plucks) {
      if (now < p.endsAt) alive.push(p);
      else p.part.dispose();
    }
    this.plucks = alive;
  }

  private tick(): void {
    this.sweepPlucks(this.ctx.currentTime);
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextPulseTime < horizon) {
      if (this.intensity > 0.15) this.schedulePulse(this.nextPulseTime);
      this.nextPulseTime += PULSE_STEP;
    }
    while (this.nextPhraseTime < horizon) {
      this.nextPhraseTime = this.schedulePhrase(this.nextPhraseTime);
    }
  }

  private schedulePulse(when: number): void {
    tone(this.ctx, this.tenseBus, {
      when,
      duration: 0.3,
      type: 'sine',
      frequency: ROOT / 2,
      frequencyEnd: ROOT / 4,
      env: { attack: 0.005, decay: 0.24, peak: 0.5 },
    });
    // Off-beat shadow pulse at high tension.
    if (this.intensity > 0.7 && this.prng() < 0.5) {
      tone(this.ctx, this.tenseBus, {
        when: when + PULSE_STEP / 2,
        duration: 0.18,
        type: 'sine',
        frequency: ROOT / 2,
        frequencyEnd: ROOT / 4,
        env: { attack: 0.005, decay: 0.14, peak: 0.22 },
      });
    }
  }

  /** Returns the absolute time the next phrase becomes due. */
  private schedulePhrase(when: number): number {
    const noteCount = 2 + Math.floor(this.prng() * (3 + this.intensity * 3));
    const step = 0.32 + this.prng() * 0.3 - this.intensity * 0.12;
    let degree = Math.floor(this.prng() * this.scale.length);
    let t = when;
    for (let n = 0; n < noteCount; n++) {
      // The octave jump is the shrillest thing the score can do, so it stays
      // rare and the pluck itself is voiced darker than it was.
      const octave = this.prng() < 0.18 ? 2 : 1;
      const st = this.scale[degree % this.scale.length] ?? 0;
      const part = ksPluck(this.ctx, this.calmBus, this.prng, {
        when: t,
        frequency: semitone(ROOT * 2 * octave, st),
        duration: 1.6,
        brightness: 0.16 + this.intensity * 0.16,
        gain: 0.16 + this.prng() * 0.05,
      });
      this.plucks.push({ part, endsAt: t + PLUCK_RING });
      degree += this.prng() < 0.6 ? 1 : this.prng() < 0.5 ? -2 : 2;
      if (degree < 0) degree += this.scale.length;
      t += step * (this.prng() < 0.2 ? 2 : 1);
    }
    const calmGap = 5 + this.prng() * 5;
    const tenseGap = 1.6 + this.prng() * 2.2;
    return t + calmGap + (tenseGap - calmGap) * this.intensity;
  }
}
