/**
 * AudioEngine — every sound in CRESTFALL, synthesized on demand.
 * The AudioContext is created lazily on the first user gesture (resume()),
 * so this module imports cleanly in Node.
 */

import type { Settings } from '../core/contract.ts';
import { DEFAULT_SETTINGS } from '../core/contract.ts';
import { mulberry32, type PRNG } from '../core/prng.ts';
import { CUE_NAMES, isCueName, type CueName } from './cues.ts';
import {
  fdnTail,
  fmVoice,
  formantVoice,
  noiseBurst,
  tone,
  type Envelope,
  type FormantSpec,
  type SynthContext,
  type VoicePart,
} from './synth.ts';
import { Score } from './score.ts';

export interface CueVoice {
  duration: number;
  stop(at: number): void;
  /** Disconnect every subgraph. Call only once the voice is silent. */
  dispose(): void;
}

export type CueBuilder = (
  ctx: SynthContext,
  dest: AudioNode,
  prng: PRNG,
  intensity: number,
) => CueVoice;

const MAX_VOICES = 16;

function group(duration: number, parts: VoicePart[]): CueVoice {
  return {
    duration,
    stop(at) {
      for (const p of parts) p.stop(at);
    },
    dispose() {
      for (const p of parts) p.dispose();
    },
  };
}

function perc(peak: number, decay: number, attack = 0.004): Envelope {
  return { attack, decay, peak };
}

function swell(peak: number, attack: number, decay: number): Envelope {
  return { attack, decay, peak };
}

/** transient click + filtered noise body + low thump + short FDN tail */
function impact(
  ctx: SynthContext,
  dest: AudioNode,
  prng: PRNG,
  i: number,
  opts: {
    thump: number;
    body: number;
    bodyType: BiquadFilterType;
    bodyDecay: number;
    tailTone: number;
  },
): VoicePart[] {
  const t0 = ctx.currentTime;
  const tail = fdnTail(ctx, dest, { decay: 0.55, tone: opts.tailTone, wet: 0.25 * i });
  return [
    tail,
    noiseBurst(ctx, tail.input, prng, {
      when: t0,
      duration: 0.02,
      filterType: 'highpass',
      frequency: 2500,
      env: perc(0.5 * i, 0.015, 0.001),
    }),
    noiseBurst(ctx, tail.input, prng, {
      when: t0,
      duration: opts.bodyDecay + 0.1,
      filterType: opts.bodyType,
      frequency: opts.body,
      frequencyEnd: opts.body * 0.4,
      q: 1.2,
      env: perc(0.6 * i, opts.bodyDecay),
    }),
    tone(ctx, dest, {
      when: t0,
      duration: 0.3,
      type: 'sine',
      frequency: opts.thump,
      frequencyEnd: opts.thump * 0.45,
      env: perc(0.7 * i, 0.22),
    }),
  ];
}

function vocal(spec: Omit<FormantSpec, 'env'> & { env: Envelope }): CueBuilder {
  return (ctx, dest, prng, i) => {
    const scaled: FormantSpec = {
      ...spec,
      env: { ...spec.env, peak: spec.env.peak * i },
    };
    return group(spec.duration, [formantVoice(ctx, dest, prng, ctx.currentTime, scaled)]);
  };
}

export const CUE_BUILDERS: Record<CueName, CueBuilder> = {
  move: (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    return group(0.22, [
      noiseBurst(ctx, dest, prng, {
        when: t0,
        duration: 0.14,
        color: 'pink',
        filterType: 'lowpass',
        frequency: 900,
        frequencyEnd: 400,
        env: swell(0.25 * i, 0.03, 0.1),
      }),
      noiseBurst(ctx, dest, prng, {
        when: t0 + 0.11,
        duration: 0.05,
        filterType: 'bandpass',
        frequency: 1700,
        q: 3,
        env: perc(0.3 * i, 0.04, 0.002),
      }),
      tone(ctx, dest, {
        when: t0 + 0.11,
        duration: 0.09,
        type: 'sine',
        frequency: 190,
        frequencyEnd: 140,
        env: perc(0.3 * i, 0.07),
      }),
    ]);
  },

  'capture-resolve': (ctx, dest, prng, i) =>
    group(
      0.6,
      impact(ctx, dest, prng, i, {
        thump: 80,
        body: 320,
        bodyType: 'lowpass',
        bodyDecay: 0.3,
        tailTone: 900,
      }),
    ),

  check: (ctx, dest, _prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [];
    for (const [freq, detune] of [
      [98, -6],
      [98, 6],
      [147, 0],
    ] as const) {
      parts.push(
        tone(ctx, dest, {
          when: t0,
          duration: 1.4,
          type: 'sawtooth',
          frequency: freq,
          detune,
          env: swell(0.16 * i, 0.5, 0.8),
        }),
      );
    }
    return group(1.4, parts);
  },

  promote: (ctx, dest, _prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [];
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, k) => {
      parts.push(
        fmVoice(ctx, dest, {
          when: t0 + k * 0.09,
          duration: 0.9,
          carrier: freq,
          ratio: 2,
          index: freq * 0.6,
          indexDecay: 0.3,
          pitchBend: 1.01,
          env: perc(0.2 * i, 0.7, 0.008),
        }),
      );
    });
    return group(0.09 * notes.length + 0.9, parts);
  },

  castle: (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [];
    for (const offset of [0, 0.28]) {
      parts.push(
        noiseBurst(ctx, dest, prng, {
          when: t0 + offset,
          duration: 0.22,
          color: 'pink',
          filterType: 'lowpass',
          frequency: 420,
          frequencyEnd: 180,
          q: 1.5,
          env: swell(0.4 * i, 0.04, 0.16),
        }),
        tone(ctx, dest, {
          when: t0 + offset + 0.18,
          duration: 0.12,
          type: 'sine',
          frequency: 100,
          frequencyEnd: 60,
          env: perc(0.35 * i, 0.1),
        }),
      );
    }
    return group(0.7, parts);
  },

  'game-over-win': (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [];
    for (const [freq, detune] of [
      [147, -5],
      [147, 5],
      [220, 0],
      [294, 3],
    ] as const) {
      parts.push(
        tone(ctx, dest, {
          when: t0,
          duration: 2.2,
          type: 'sawtooth',
          frequency: freq,
          detune,
          env: swell(0.14 * i, 0.35, 1.6),
        }),
      );
    }
    parts.push(
      tone(ctx, dest, {
        when: t0 + 0.3,
        duration: 0.5,
        type: 'sine',
        frequency: 95,
        frequencyEnd: 42,
        env: perc(0.8 * i, 0.4),
      }),
      noiseBurst(ctx, dest, prng, {
        when: t0 + 0.3,
        duration: 0.3,
        filterType: 'lowpass',
        frequency: 500,
        env: perc(0.4 * i, 0.25),
      }),
    );
    return group(2.2, parts);
  },

  'game-over-draw': (ctx, dest, _prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [];
    // Tritone pair — deliberately unresolved.
    for (const freq of [110, 155.56]) {
      parts.push(
        tone(ctx, dest, {
          when: t0,
          duration: 2.6,
          type: 'triangle',
          frequency: freq,
          env: swell(0.2 * i, 0.9, 1.5),
        }),
      );
    }
    return group(2.6, parts);
  },

  'ui-click': (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    return group(0.1, [
      noiseBurst(ctx, dest, prng, {
        when: t0,
        duration: 0.015,
        filterType: 'highpass',
        frequency: 4500,
        env: perc(0.14 * i, 0.012, 0.0005),
      }),
      fmVoice(ctx, dest, {
        when: t0,
        duration: 0.06,
        carrier: 1300,
        ratio: 1,
        index: 200,
        env: perc(0.25 * i, 0.05, 0.001),
      }),
      tone(ctx, dest, {
        when: t0,
        duration: 0.08,
        type: 'sine',
        frequency: 330,
        frequencyEnd: 230,
        env: perc(0.1 * i, 0.06, 0.001),
      }),
    ]);
  },

  'ui-toggle': (ctx, dest, _prng, i) => {
    const t0 = ctx.currentTime;
    return group(0.14, [
      fmVoice(ctx, dest, {
        when: t0,
        duration: 0.06,
        carrier: 900,
        ratio: 1,
        index: 150,
        env: perc(0.2 * i, 0.05, 0.001),
      }),
      fmVoice(ctx, dest, {
        when: t0 + 0.07,
        duration: 0.07,
        carrier: 1350,
        ratio: 1,
        index: 150,
        env: perc(0.22 * i, 0.06, 0.001),
      }),
    ]);
  },

  illegal: (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    return group(0.15, [
      tone(ctx, dest, {
        when: t0,
        duration: 0.12,
        type: 'triangle',
        frequency: 150,
        frequencyEnd: 95,
        env: perc(0.4 * i, 0.1, 0.002),
      }),
      noiseBurst(ctx, dest, prng, {
        when: t0,
        duration: 0.08,
        filterType: 'lowpass',
        frequency: 260,
        env: perc(0.3 * i, 0.06, 0.002),
      }),
    ]);
  },

  whoosh: (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const tail = fdnTail(ctx, dest, { decay: 0.35, tone: 2400, wet: 0.12 * i });
    return group(0.45, [
      tail,
      noiseBurst(ctx, tail.input, prng, {
        when: t0,
        duration: 0.3,
        color: 'pink',
        filterType: 'bandpass',
        frequency: 400,
        frequencyEnd: 2600,
        q: 1.8,
        env: swell(0.45 * i, 0.09, 0.18),
      }),
      noiseBurst(ctx, dest, prng, {
        when: t0 + 0.03,
        duration: 0.24,
        filterType: 'highpass',
        frequency: 3000,
        frequencyEnd: 6500,
        q: 0.7,
        env: swell(0.16 * i, 0.08, 0.13),
      }),
      tone(ctx, dest, {
        when: t0,
        duration: 0.28,
        type: 'sine',
        frequency: 150,
        frequencyEnd: 95,
        env: swell(0.14 * i, 0.06, 0.18),
      }),
    ]);
  },

  'impact-metal': (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const carrier = 620 * (0.92 + prng() * 0.16);
    const parts = impact(ctx, dest, prng, i, {
      thump: 95,
      body: 3200,
      bodyType: 'highpass',
      bodyDecay: 0.12,
      tailTone: 3500,
    });
    parts.push(
      fmVoice(ctx, dest, {
        when: t0,
        duration: 0.9,
        carrier,
        ratio: 2.76,
        index: carrier * 2.4,
        indexDecay: 0.25,
        env: perc(0.5 * i, 0.75, 0.001),
      }),
      fmVoice(ctx, dest, {
        when: t0,
        duration: 0.5,
        carrier: carrier * 1.83,
        ratio: 3.41,
        index: carrier,
        indexDecay: 0.15,
        env: perc(0.25 * i, 0.4, 0.001),
      }),
    );
    return group(0.9, parts);
  },

  'impact-stone': (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [
      tone(ctx, dest, {
        when: t0,
        duration: 0.45,
        type: 'sine',
        frequency: 55,
        frequencyEnd: 30,
        env: perc(0.85 * i, 0.35),
      }),
    ];
    // Granular crunch: staggered short pink-noise grains.
    let cursor = 0;
    for (let g = 0; g < 6; g++) {
      parts.push(
        noiseBurst(ctx, dest, prng, {
          when: t0 + cursor,
          duration: 0.05,
          color: 'pink',
          filterType: 'lowpass',
          frequency: 400 + prng() * 500,
          q: 2,
          env: perc((0.4 - g * 0.05) * i, 0.045, 0.002),
        }),
      );
      cursor += 0.02 + prng() * 0.04;
    }
    return group(0.6, parts);
  },

  'impact-shield': (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const parts = impact(ctx, dest, prng, i, {
      thump: 110,
      body: 550,
      bodyType: 'bandpass',
      bodyDecay: 0.14,
      tailTone: 1400,
    });
    parts.push(
      tone(ctx, dest, {
        when: t0,
        duration: 0.14,
        type: 'triangle',
        frequency: 260,
        frequencyEnd: 170,
        env: perc(0.4 * i, 0.11, 0.002),
      }),
      fmVoice(ctx, dest, {
        when: t0 + 0.01,
        duration: 0.55,
        carrier: 1150,
        ratio: 3.01,
        index: 900,
        indexDecay: 0.12,
        env: perc(0.18 * i, 0.45, 0.002),
      }),
    );
    return group(0.6, parts);
  },

  'impact-flesh': (ctx, dest, prng, i) =>
    group(0.35, [
      tone(ctx, dest, {
        when: ctx.currentTime,
        duration: 0.25,
        type: 'sine',
        frequency: 115,
        frequencyEnd: 55,
        env: perc(0.6 * i, 0.2, 0.003),
      }),
      noiseBurst(ctx, dest, prng, {
        when: ctx.currentTime,
        duration: 0.12,
        color: 'pink',
        filterType: 'lowpass',
        frequency: 280,
        env: perc(0.35 * i, 0.1, 0.003),
      }),
    ]),

  'stone-grind': (ctx, dest, prng, i) =>
    group(1.4, [
      noiseBurst(ctx, dest, prng, {
        when: ctx.currentTime,
        duration: 1.4,
        color: 'pink',
        filterType: 'lowpass',
        frequency: 320,
        frequencyEnd: 190,
        q: 2.5,
        playbackRate: 0.5,
        env: swell(0.45 * i, 0.35, 0.9),
      }),
      tone(ctx, dest, {
        when: ctx.currentTime,
        duration: 1.4,
        type: 'sawtooth',
        frequency: 38,
        frequencyEnd: 30,
        env: swell(0.2 * i, 0.4, 0.9),
      }),
    ]),

  rune: (ctx, dest, _prng, i) => {
    const t0 = ctx.currentTime;
    return group(1.3, [
      fmVoice(ctx, dest, {
        when: t0,
        duration: 1.3,
        carrier: 880,
        ratio: 1.5,
        index: 350,
        indexDecay: 0.5,
        pitchBend: 1.19,
        env: perc(0.3 * i, 1.1, 0.01),
      }),
      fmVoice(ctx, dest, {
        when: t0 + 0.12,
        duration: 1.0,
        carrier: 1320,
        ratio: 1.5,
        index: 260,
        indexDecay: 0.4,
        pitchBend: 1.12,
        env: perc(0.18 * i, 0.85, 0.01),
      }),
    ]);
  },

  wing: (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [];
    for (const offset of [0, 0.42]) {
      parts.push(
        noiseBurst(ctx, dest, prng, {
          when: t0 + offset,
          duration: 0.36,
          color: 'pink',
          filterType: 'bandpass',
          frequency: 220,
          frequencyEnd: 90,
          q: 1.2,
          playbackRate: 0.7,
          env: swell(0.5 * i, 0.12, 0.2),
        }),
      );
    }
    return group(0.85, parts);
  },

  horse: (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [];
    for (const offset of [0, 0.09, 0.32, 0.41]) {
      parts.push(
        tone(ctx, dest, {
          when: t0 + offset,
          duration: 0.07,
          type: 'sine',
          frequency: 210 + prng() * 40,
          frequencyEnd: 120,
          env: perc(0.4 * i, 0.055, 0.001),
        }),
        noiseBurst(ctx, dest, prng, {
          when: t0 + offset,
          duration: 0.04,
          filterType: 'lowpass',
          frequency: 700,
          env: perc(0.2 * i, 0.03, 0.001),
        }),
      );
    }
    parts.push(
      noiseBurst(ctx, dest, prng, {
        when: t0 + 0.55,
        duration: 0.28,
        color: 'pink',
        filterType: 'bandpass',
        frequency: 850,
        frequencyEnd: 350,
        q: 2.5,
        env: swell(0.25 * i, 0.05, 0.2),
      }),
    );
    return group(0.9, parts);
  },

  fall: (ctx, dest, prng, i) => {
    const t0 = ctx.currentTime;
    const parts: VoicePart[] = [
      tone(ctx, dest, {
        when: t0,
        duration: 0.35,
        type: 'sine',
        frequency: 85,
        frequencyEnd: 38,
        env: perc(0.7 * i, 0.28, 0.003),
      }),
      noiseBurst(ctx, dest, prng, {
        when: t0,
        duration: 0.15,
        color: 'pink',
        filterType: 'lowpass',
        frequency: 350,
        env: perc(0.4 * i, 0.12, 0.003),
      }),
    ];
    // Armor rattle: a scatter of tiny metallic pings after the body lands.
    let cursor = 0.06;
    for (let r = 0; r < 5; r++) {
      const c = 1400 + prng() * 2200;
      parts.push(
        fmVoice(ctx, dest, {
          when: t0 + cursor,
          duration: 0.12,
          carrier: c,
          ratio: 2.76,
          index: c * 0.8,
          indexDecay: 0.05,
          env: perc((0.16 - r * 0.02) * i, 0.09, 0.001),
        }),
      );
      cursor += 0.04 + prng() * 0.06;
    }
    return group(0.7, parts);
  },

  'vocal:huscarl': vocal({
    formants: [500, 1150, 2500],
    q: 6,
    source: 'pulse',
    pitch: 135,
    pitchEnd: 88,
    duration: 0.22,
    env: { attack: 0.015, decay: 0.18, peak: 0.55 },
  }),

  'vocal:berserkr': vocal({
    formants: [420, 950, 2300],
    q: 3.5,
    source: 'mixed',
    pitch: 95,
    pitchEnd: 68,
    duration: 0.9,
    env: { attack: 0.06, decay: 0.75, peak: 0.6, sustain: 0.3 },
  }),

  'vocal:volva': vocal({
    formants: [1300, 2900, 4600],
    q: 8,
    source: 'breath',
    pitch: 0,
    pitchEnd: 0,
    duration: 1.1,
    env: { attack: 0.2, decay: 0.8, peak: 0.35, sustain: 0.4 },
  }),

  'vocal:jotunn': vocal({
    formants: [95, 210, 420],
    q: 5,
    source: 'mixed',
    pitch: 44,
    pitchEnd: 30,
    duration: 1.4,
    env: { attack: 0.25, decay: 1.0, peak: 0.7, sustain: 0.35 },
  }),

  'vocal:valkyrie': vocal({
    formants: [820, 1750, 3300],
    q: 7,
    source: 'pulse',
    pitch: 440,
    pitchEnd: 523,
    duration: 0.8,
    octaveDoubling: true,
    env: { attack: 0.04, decay: 0.65, peak: 0.42, sustain: 0.4 },
  }),

  'vocal:jarl': vocal({
    formants: [360, 820, 1850],
    q: 5,
    source: 'pulse',
    pitch: 105,
    pitchEnd: 70,
    duration: 0.35,
    env: { attack: 0.03, decay: 0.28, peak: 0.5 },
  }),
};

interface ActiveVoice {
  voice: CueVoice;
  /** Cue name — a long voice is cut rather than stacked on top of itself. */
  cue: string;
  /** When the voice stops making sound. */
  soundsUntil: number;
  /** When its subgraph is safe to disconnect. */
  endsAt: number;
}

/**
 * A voice at least this long is tonal enough that re-firing the same cue while
 * it is still sounding fuses the two into one held note instead of reading as
 * two accents. Duels lean on repeated cues — three runes half a second apart on
 * a 1.3s voice, a giant grinding through a whole unfold — so for these the new
 * accent cuts its predecessor short instead of layering over it.
 */
const SELF_STACK_LIMIT = 0.6;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private settings: Settings = DEFAULT_SETTINGS;
  private readonly prng: PRNG;
  private readonly seed: number;
  private voices: ActiveVoice[] = [];
  private fading: ActiveVoice[] = [];
  private score: Score | null = null;

  constructor(seed = 0xc4e5f) {
    this.seed = seed;
    this.prng = mulberry32(seed);
  }

  /** Create/resume the AudioContext. Call from a user gesture handler. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      if (typeof AudioContext === 'undefined') {
        throw new Error('WebAudio is not available in this environment');
      }
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      // Duels stack cues by design — a capture can have an impact, a body fall
      // and a vocal all sounding at once, and several cues already peak near
      // full scale alone. Without a limiter on the way out those sums clip, and
      // clipping on a percussive bus reads as a nasty buzz rather than as
      // loudness. Fast attack so transients are caught, slow release so it does
      // not pump between beats.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.18;
      this.sfxBus.connect(limiter);
      limiter.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applySettings(this.settings);
      this.score = new Score(this.ctx, this.musicBus, mulberry32(this.seed ^ 0x5c07e));
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.musicVolume, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
  }

  /**
   * Fire a named cue. Unknown cues throw — a misspelled cue is a bug, not a
   * silence. Before resume() this validates and returns without sound.
   */
  play(cue: string, intensity = 1): void {
    if (!isCueName(cue)) {
      throw new Error(`Unknown audio cue: "${cue}" (known: ${CUE_NAMES.join(', ')})`);
    }
    if (!this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.sweep(now);
    this.cutSelfStack(cue, now);
    while (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift();
      if (oldest) this.retire(oldest, now);
    }
    const clamped = Math.min(1.5, Math.max(0.05, intensity));
    const voice = CUE_BUILDERS[cue](this.ctx, this.sfxBus, this.prng, clamped);
    this.voices.push({
      voice,
      cue,
      soundsUntil: now + voice.duration,
      endsAt: now + voice.duration + 0.5,
    });
  }

  /** Release a voice early and hold its subgraph until the ramp has finished. */
  private retire(v: ActiveVoice, now: number): void {
    v.voice.stop(now);
    this.fading.push({ ...v, soundsUntil: now, endsAt: now + 0.4 });
  }

  /**
   * Stop any still-sounding voice of the same long cue, so a repeated accent
   * re-articulates instead of blurring into a held note.
   */
  private cutSelfStack(cue: string, now: number): void {
    const keep: ActiveVoice[] = [];
    for (const v of this.voices) {
      if (
        v.cue === cue &&
        v.voice.duration >= SELF_STACK_LIMIT &&
        now < v.soundsUntil
      ) {
        this.retire(v, now);
      } else {
        keep.push(v);
      }
    }
    this.voices = keep;
  }

  /** Disconnect expired voices so feedback subgraphs never accumulate. */
  private sweep(now: number): void {
    const keep = (list: ActiveVoice[]): ActiveVoice[] => {
      const alive: ActiveVoice[] = [];
      for (const v of list) {
        if (now < v.endsAt) alive.push(v);
        else v.voice.dispose();
      }
      return alive;
    };
    this.voices = keep(this.voices);
    this.fading = keep(this.fading);
  }

  startScore(): void {
    this.score?.start();
  }

  /** 0 = calm ambient, 1 = full tension. Crossfades. */
  setScoreIntensity(intensity: number): void {
    this.score?.setIntensity(intensity);
  }

  stopScore(): void {
    this.score?.stop();
  }

  dispose(): void {
    this.score?.stop();
    const now = this.ctx?.currentTime ?? 0;
    for (const v of [...this.voices, ...this.fading]) {
      v.voice.stop(now);
      v.voice.dispose();
    }
    this.voices = [];
    this.fading = [];
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.score = null;
  }
}
