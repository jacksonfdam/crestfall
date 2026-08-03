/**
 * Generative ambient score: a slow modal drone with sparse melodic notes picked
 * by seeded PRNG. Intensity 0..1 raises phrase density and brings in a low
 * pulse. All events are scheduled on absolute AudioContext time
 * (nextTime += step), so the loop never drifts.
 *
 * Voicing is deliberately dull-edged. Every voice is a sine or a triangle, each
 * melodic note passes its own low-pass on the way out, and the whole score is
 * shelved and low-passed again at the bus. An earlier version plucked the melody
 * with Karplus-Strong, which is beautiful on a lute and wrong here: its partial
 * stack put a metallic ping on top of a drone whose fundamentals are two octaves
 * below, and no amount of filtering downstream fixed the source.
 */

import type { PRNG } from '../core/prng.ts';
import { tone, type SynthContext, type VoicePart } from './synth.ts';

/**
 * Bb1. Measured from the reference track the voicing was matched against: its
 * strongest partials cluster at 57-59 Hz, with the bulk of its energy below
 * 120 Hz and barely 4% above 1 kHz.
 */
const ROOT = 58.27; // Bb1
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10] as const;
const LOOKAHEAD = 0.6;
const TICK_MS = 120;
const PULSE_STEP = 0.75;
const OUT_LEVEL = 0.5;
const NOTE_TAIL = 2.2;

const semitone = (base: number, steps: number): number => base * 2 ** (steps / 12);

export class Score {
  private readonly ctx: SynthContext;
  private readonly out: GainNode;
  private readonly calmBus: GainNode;
  private readonly tenseBus: GainNode;
  private readonly prng: PRNG;
  private droneParts: VoicePart[] = [];
  private notes: { part: VoicePart; filter: BiquadFilterNode; endsAt: number }[] = [];
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

    // Bus voicing, on top of the per-note filter. The drone fundamentals live
    // between 36 and 110 Hz and the melody between 147 and 524 Hz, so
    // everything musical sits far below this shelf; it only catches whatever
    // harmonic glare survives the notes' own low-pass.
    const glare = ctx.createBiquadFilter();
    glare.type = 'highshelf';
    glare.frequency.value = 1200;
    glare.gain.value = -6;

    const ceiling = ctx.createBiquadFilter();
    ceiling.type = 'lowpass';
    ceiling.frequency.value = 1400;
    // No resonance: a peak here would reintroduce exactly what it removes.
    ceiling.Q.value = 0.4;

    this.out.connect(glare);
    glare.connect(ceiling);
    ceiling.connect(dest);
  }

  start(): void {
    if (this.timer !== null) return;
    const now = this.ctx.currentTime;
    this.sweepNotes(now);
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
    for (const n of this.notes) {
      n.part.stop(t + 1.2);
      n.endsAt = Math.min(n.endsAt, t + 1.5);
    }
    this.out.gain.setTargetAtTime(0.0001, t, 0.8);
  }

  private get scale(): readonly number[] {
    return this.modeIsAeolian ? AEOLIAN : DORIAN;
  }

  /**
   * Root, octave below, and the fifth, all sine. The pair at the root is
   * detuned +/-18 cents against itself, which puts the two partials about
   * 0.75 Hz apart and produces the slow beat the reference has. That breathing
   * is what a sawtooth's harmonics were doing before, without the edge.
   */
  private startDrone(): void {
    const t0 = this.ctx.currentTime;
    const long = 60 * 60 * 24; // effectively endless; stop() releases it
    for (const [freq, detune, level] of [
      [ROOT / 2, 0, 1],
      [ROOT, -18, 0.85],
      [ROOT, 18, 0.85],
      [ROOT * 1.5, 0, 0.5],
      // A sustained mid pad, two octaves up and at its fifth. The reference
      // carries about a quarter of its energy between 300 and 1000 Hz, and that
      // energy is continuous — pad, not plucks. Filling it with louder melody
      // notes instead just makes them stab, which is what made the old score
      // grating; a quiet held pair sits under them and does the same job.
      [ROOT * 4, -6, 0.55],
      [ROOT * 6, 6, 0.4],
    ] as const) {
      this.droneParts.push(
        tone(this.ctx, this.calmBus, {
          when: t0,
          duration: long,
          type: 'sine',
          frequency: freq,
          detune,
          env: { attack: 3, decay: long, peak: 0.075 * level, sustain: 1 },
        }),
      );
    }
  }

  /** Each note owns a filter node, so a finished note must take it with it. */
  private sweepNotes(now: number): void {
    const alive: typeof this.notes = [];
    for (const n of this.notes) {
      if (now < n.endsAt) alive.push(n);
      else {
        n.part.dispose();
        n.filter.disconnect();
      }
    }
    this.notes = alive;
  }

  /**
   * One melodic note: a triangle through its own low-pass. The filter opens a
   * little with intensity, which is the only brightness the score ever gains.
   */
  private scheduleNote(
    when: number,
    frequency: number,
  ): { part: VoicePart; filter: BiquadFilterNode } {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100 + this.intensity * 300;
    filter.Q.value = 0.5;
    filter.connect(this.calmBus);
    const part = tone(this.ctx, filter, {
      when,
      duration: 1.5,
      type: 'triangle',
      frequency,
      env: { attack: 0.02, decay: 1.5, peak: 0.12 },
    });
    return { part, filter };
  }

  private tick(): void {
    this.sweepNotes(this.ctx.currentTime);
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
      // The octave jump is the brightest thing the score can do, so it is rare.
      const octave = this.prng() < 0.18 ? 2 : 1;
      const st = this.scale[degree % this.scale.length] ?? 0;
      this.notes.push({
        ...this.scheduleNote(t, semitone(ROOT * 4 * octave, st)),
        endsAt: t + NOTE_TAIL,
      });
      degree += this.prng() < 0.6 ? 1 : this.prng() < 0.5 ? -2 : 2;
      if (degree < 0) degree += this.scale.length;
      t += step * (this.prng() < 0.2 ? 2 : 1);
    }
    const calmGap = 5 + this.prng() * 5;
    const tenseGap = 1.6 + this.prng() * 2.2;
    return t + calmGap + (tenseGap - calmGap) * this.intensity;
  }
}
