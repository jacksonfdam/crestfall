/**
 * Pure WebAudio graph builders. Every function takes a SynthContext (a
 * structural subset of BaseAudioContext, so tests can pass a stub) and a
 * destination node, wires a subgraph, schedules its own start/stop, and
 * returns a VoicePart handle. No globals, no Math.random — variation comes
 * from the PRNG parameter.
 */

import type { PRNG } from '../core/prng.ts';

export interface SynthContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  createGain(): GainNode;
  createOscillator(): OscillatorNode;
  createBiquadFilter(): BiquadFilterNode;
  createDelay(maxDelayTime?: number): DelayNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
}

export interface VoicePart {
  /** Hard-release: ramp out and stop all sources at (or shortly after) `at`. */
  stop(at: number): void;
  /** Disconnect the whole subgraph. Call only once the voice is silent. */
  dispose(): void;
}

export type NoiseColor = 'white' | 'pink';

const noiseCache = new WeakMap<SynthContext, Map<NoiseColor, AudioBuffer>>();

/** Shared 1-second looping noise buffer per context (reused by every voice). */
export function noiseBuffer(ctx: SynthContext, color: NoiseColor, prng: PRNG): AudioBuffer {
  let perCtx = noiseCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    noiseCache.set(ctx, perCtx);
  }
  const cached = perCtx.get(color);
  if (cached) return cached;
  const length = Math.max(1, Math.floor(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (color === 'white') {
    for (let i = 0; i < length; i++) data[i] = prng() * 2 - 1;
  } else {
    // Paul Kellet's economy pink-noise approximation.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = prng() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
    }
  }
  perCtx.set(color, buffer);
  return buffer;
}

export interface Envelope {
  attack: number;
  decay: number;
  peak: number;
  /** Optional sustain level held until the natural end; default 0 (percussive). */
  sustain?: number;
  /** Release ramp length once the hold ends; default 0.08. */
  release?: number;
}

/**
 * Schedule the envelope on `param`. Sustained envelopes hold peak*sustain
 * until `holdUntil`, then release-ramp to silence so sources never hard-cut
 * at an audible level. Returns the absolute time the param reaches silence.
 */
export function applyEnvelope(
  param: AudioParam,
  t0: number,
  env: Envelope,
  holdUntil?: number,
): number {
  const sustain = env.sustain ?? 0;
  const decayEnd = t0 + env.attack + env.decay;
  param.setValueAtTime(0.0001, t0);
  param.linearRampToValueAtTime(Math.max(0.0001, env.peak), t0 + env.attack);
  if (sustain <= 0) {
    param.exponentialRampToValueAtTime(0.0001, decayEnd);
    return decayEnd;
  }
  const level = Math.max(0.0001, env.peak * sustain);
  param.exponentialRampToValueAtTime(level, decayEnd);
  const release = env.release ?? 0.08;
  const releaseStart = Math.max(decayEnd, holdUntil ?? decayEnd);
  if (releaseStart > decayEnd) param.setValueAtTime(level, releaseStart);
  param.exponentialRampToValueAtTime(0.0001, releaseStart + release);
  return releaseStart + release;
}

function releaseGain(gain: GainNode, at: number): void {
  gain.gain.cancelScheduledValues(at);
  gain.gain.setTargetAtTime(0.0001, at, 0.03);
}

function disconnectAll(nodes: AudioNode[]): void {
  for (const n of nodes) n.disconnect();
}

export interface NoiseBurstOpts {
  when: number;
  duration: number;
  color?: NoiseColor;
  filterType?: BiquadFilterType;
  frequency: number;
  frequencyEnd?: number;
  q?: number;
  playbackRate?: number;
  env: Envelope;
}

/** Filtered noise burst — body of every impact, whoosh, and grind. */
export function noiseBurst(
  ctx: SynthContext,
  dest: AudioNode,
  prng: PRNG,
  opts: NoiseBurstOpts,
): VoicePart {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, opts.color ?? 'white', prng);
  src.loop = true;
  src.playbackRate.value = opts.playbackRate ?? 1;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.frequency, opts.when);
  if (opts.frequencyEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(20, opts.frequencyEnd),
      opts.when + opts.duration,
    );
  }
  filter.Q.value = opts.q ?? 1;
  const gain = ctx.createGain();
  const silentAt = applyEnvelope(gain.gain, opts.when, opts.env, opts.when + opts.duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(opts.when);
  src.stop(Math.max(opts.when + opts.duration, silentAt) + 0.05);
  return {
    stop(at) {
      releaseGain(gain, at);
      src.stop(at + 0.2);
    },
    dispose() {
      disconnectAll([src, filter, gain]);
    },
  };
}

export interface ToneOpts {
  when: number;
  duration: number;
  type: OscillatorType;
  frequency: number;
  frequencyEnd?: number;
  detune?: number;
  env: Envelope;
}

/** Single oscillator through an envelope — thumps, swells, drones. */
export function tone(ctx: SynthContext, dest: AudioNode, opts: ToneOpts): VoicePart {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.frequency, opts.when);
  if (opts.frequencyEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(10, opts.frequencyEnd),
      opts.when + opts.duration,
    );
  }
  if (opts.detune !== undefined) osc.detune.value = opts.detune;
  const gain = ctx.createGain();
  const silentAt = applyEnvelope(gain.gain, opts.when, opts.env, opts.when + opts.duration);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(opts.when);
  osc.stop(Math.max(opts.when + opts.duration, silentAt) + 0.05);
  return {
    stop(at) {
      releaseGain(gain, at);
      osc.stop(at + 0.2);
    },
    dispose() {
      disconnectAll([osc, gain]);
    },
  };
}

export interface FmOpts {
  when: number;
  duration: number;
  carrier: number;
  /** Modulator frequency ratio; irrational-ish values give inharmonic clangs. */
  ratio: number;
  /** Modulation index in Hz of carrier deviation. */
  index: number;
  indexDecay?: number;
  env: Envelope;
  carrierType?: OscillatorType;
  pitchBend?: number;
}

/** Two-operator FM voice — bells, clangs, glassy rune chimes. */
export function fmVoice(ctx: SynthContext, dest: AudioNode, opts: FmOpts): VoicePart {
  const carrier = ctx.createOscillator();
  carrier.type = opts.carrierType ?? 'sine';
  carrier.frequency.setValueAtTime(opts.carrier, opts.when);
  if (opts.pitchBend !== undefined) {
    carrier.frequency.exponentialRampToValueAtTime(
      Math.max(10, opts.carrier * opts.pitchBend),
      opts.when + opts.duration,
    );
  }
  const modulator = ctx.createOscillator();
  modulator.type = 'sine';
  modulator.frequency.setValueAtTime(opts.carrier * opts.ratio, opts.when);
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(opts.index, opts.when);
  modGain.gain.exponentialRampToValueAtTime(
    Math.max(0.01, opts.index * 0.02),
    opts.when + (opts.indexDecay ?? opts.duration),
  );
  const outGain = ctx.createGain();
  const silentAt = applyEnvelope(outGain.gain, opts.when, opts.env, opts.when + opts.duration);
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(outGain);
  outGain.connect(dest);
  carrier.start(opts.when);
  modulator.start(opts.when);
  const stopAt = Math.max(opts.when + opts.duration, silentAt) + 0.05;
  carrier.stop(stopAt);
  modulator.stop(stopAt);
  return {
    stop(at) {
      releaseGain(outGain, at);
      carrier.stop(at + 0.2);
      modulator.stop(at + 0.2);
    },
    dispose() {
      disconnectAll([carrier, modulator, modGain, outGain]);
    },
  };
}

export interface PluckOpts {
  when: number;
  frequency: number;
  duration: number;
  /** 0..1 — feedback lowpass cutoff scale; higher = brighter, longer ring. */
  brightness?: number;
  gain?: number;
}

/**
 * Karplus-Strong pluck: short noise burst circulating in a tuned delay line
 * with a lowpass in the feedback path. The delay cycle keeps its nodes alive
 * even when silent — callers must dispose() once the pluck has rung out.
 */
export function ksPluck(
  ctx: SynthContext,
  dest: AudioNode,
  prng: PRNG,
  opts: PluckOpts,
): VoicePart {
  const burst = ctx.createBufferSource();
  burst.buffer = noiseBuffer(ctx, 'white', prng);
  const period = 1 / opts.frequency;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = period;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.985;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = opts.frequency * (4 + 12 * (opts.brightness ?? 0.5));
  const out = ctx.createGain();
  out.gain.setValueAtTime(opts.gain ?? 0.5, opts.when);
  out.gain.setTargetAtTime(0.0001, opts.when + opts.duration * 0.6, opts.duration * 0.15);
  burst.connect(delay);
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  delay.connect(out);
  out.connect(dest);
  burst.start(opts.when);
  burst.stop(opts.when + period * 2);
  return {
    stop(at) {
      releaseGain(out, at);
      feedback.gain.setTargetAtTime(0, at, 0.02);
    },
    dispose() {
      disconnectAll([burst, delay, damp, feedback, out]);
    },
  };
}

export interface FdnOpts {
  /** Feedback amount 0..1 — tail length. */
  decay: number;
  /** Lowpass cutoff of the tail. */
  tone: number;
  /** Wet gain into dest. */
  wet: number;
}

export interface FdnTail extends VoicePart {
  input: AudioNode;
}

/**
 * Small feedback-delay-network reverb: four mutually-fed delay lines with
 * damped feedback. Convolution-free and cheap. The feedback cycles keep the
 * nodes alive forever — callers must dispose() once the tail has rung out.
 */
export function fdnTail(ctx: SynthContext, dest: AudioNode, opts: FdnOpts): FdnTail {
  const input = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = opts.wet;
  const times = [0.0297, 0.0371, 0.0411, 0.0437];
  const delays: DelayNode[] = [];
  const damps: BiquadFilterNode[] = [];
  const feedbacks: GainNode[] = [];
  for (const t of times) {
    const d = ctx.createDelay(0.1);
    d.delayTime.value = t;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = opts.tone;
    const fb = ctx.createGain();
    fb.gain.value = opts.decay * 0.24;
    input.connect(d);
    d.connect(damp);
    damp.connect(fb);
    d.connect(wet);
    delays.push(d);
    damps.push(damp);
    feedbacks.push(fb);
  }
  // Cross-feed each line into the next (ring) for diffusion.
  for (let i = 0; i < delays.length; i++) {
    const fb = feedbacks[i];
    const next = delays[(i + 1) % delays.length];
    if (fb && next) fb.connect(next);
  }
  wet.connect(dest);
  return {
    input,
    stop(at) {
      releaseGain(wet, at);
      for (const fb of feedbacks) fb.gain.setTargetAtTime(0, at, 0.05);
    },
    dispose() {
      disconnectAll([input, ...delays, ...damps, ...feedbacks, wet]);
    },
  };
}

export interface FormantSpec {
  /** Bandpass center frequencies (Hz) — the vowel/timbre stamp. */
  formants: [number, number, number];
  q: number;
  /** 'pulse' = pitched glottal source (sawtooth), 'breath' = noise source. */
  source: 'pulse' | 'breath' | 'mixed';
  pitch: number;
  pitchEnd: number;
  duration: number;
  env: Envelope;
  /** Extra octave-harmonic shimmer (valkyrie). */
  octaveDoubling?: boolean;
}

/**
 * Formant-filtered vocal accent: a glottal-ish pulse and/or breath noise
 * pushed through a parallel bandpass stack. No words, no language — just
 * throat and timbre.
 */
export function formantVoice(
  ctx: SynthContext,
  dest: AudioNode,
  prng: PRNG,
  when: number,
  spec: FormantSpec,
): VoicePart {
  const bus = ctx.createGain();
  const silentAt = applyEnvelope(bus.gain, when, spec.env, when + spec.duration);
  const stopAt = Math.max(when + spec.duration, silentAt) + 0.05;
  bus.connect(dest);
  const sources: { stop(at: number): void }[] = [];
  const nodes: AudioNode[] = [bus];

  const stack = ctx.createGain();
  stack.gain.value = 1;
  nodes.push(stack);
  for (const f of spec.formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * (0.97 + prng() * 0.06);
    bp.Q.value = spec.q;
    stack.connect(bp);
    bp.connect(bus);
    nodes.push(bp);
  }

  if (spec.source !== 'breath') {
    const glottis = ctx.createOscillator();
    glottis.type = 'sawtooth';
    const jitter = 0.96 + prng() * 0.08;
    glottis.frequency.setValueAtTime(spec.pitch * jitter, when);
    glottis.frequency.exponentialRampToValueAtTime(
      Math.max(20, spec.pitchEnd * jitter),
      when + spec.duration,
    );
    glottis.connect(stack);
    glottis.start(when);
    glottis.stop(stopAt);
    sources.push({ stop: (at) => glottis.stop(at + 0.2) });
    nodes.push(glottis);
    if (spec.octaveDoubling) {
      const octave = ctx.createOscillator();
      octave.type = 'triangle';
      octave.frequency.setValueAtTime(spec.pitch * 2 * jitter, when);
      octave.frequency.exponentialRampToValueAtTime(
        Math.max(40, spec.pitchEnd * 2 * jitter),
        when + spec.duration,
      );
      const octGain = ctx.createGain();
      octGain.gain.value = 0.4;
      octave.connect(octGain);
      octGain.connect(stack);
      octave.start(when);
      octave.stop(stopAt);
      sources.push({ stop: (at) => octave.stop(at + 0.2) });
      nodes.push(octave, octGain);
    }
  }
  if (spec.source !== 'pulse') {
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuffer(ctx, 'pink', prng);
    breath.loop = true;
    const breathGain = ctx.createGain();
    breathGain.gain.value = spec.source === 'breath' ? 1 : 0.3;
    breath.connect(breathGain);
    breathGain.connect(stack);
    breath.start(when);
    breath.stop(stopAt);
    sources.push({ stop: (at) => breath.stop(at + 0.2) });
    nodes.push(breath, breathGain);
  }
  return {
    stop(at) {
      releaseGain(bus, at);
      for (const s of sources) s.stop(at);
    },
    dispose() {
      disconnectAll(nodes);
    },
  };
}
