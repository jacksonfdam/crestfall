import { describe, expect, it } from 'vitest';
import { BOARD_CUES, CUE_NAMES, DUEL_CUES, VOCAL_CUES, isCueName } from '../src/audio/cues.ts';
import { AudioEngine, CUE_BUILDERS } from '../src/audio/engine.ts';
import { Score } from '../src/audio/score.ts';
import { applyEnvelope, noiseBuffer, type SynthContext } from '../src/audio/synth.ts';
import { mulberry32 } from '../src/core/prng.ts';

const EXPECTED_BOARD = [
  'move',
  'capture-resolve',
  'check',
  'promote',
  'castle',
  'game-over-win',
  'game-over-draw',
  'ui-click',
  'ui-toggle',
  'illegal',
];
const EXPECTED_DUEL = [
  'whoosh',
  'impact-metal',
  'impact-stone',
  'impact-shield',
  'impact-flesh',
  'stone-grind',
  'rune',
  'wing',
  'horse',
  'fall',
];
const EXPECTED_VOCAL = [
  'vocal:huscarl',
  'vocal:berserkr',
  'vocal:volva',
  'vocal:jotunn',
  'vocal:valkyrie',
  'vocal:jarl',
];

interface ParamCall {
  method: string;
  args: number[];
}

function fakeParam() {
  const calls: ParamCall[] = [];
  const record =
    (method: string) =>
    (...args: number[]) => {
      calls.push({ method, args });
    };
  return {
    value: 0,
    calls,
    setValueAtTime: record('setValueAtTime'),
    linearRampToValueAtTime: record('linearRampToValueAtTime'),
    exponentialRampToValueAtTime: record('exponentialRampToValueAtTime'),
    setTargetAtTime: record('setTargetAtTime'),
    cancelScheduledValues: record('cancelScheduledValues'),
  };
}

type FakeNode = ReturnType<typeof fakeNode>;

function fakeNode() {
  return {
    connect() {},
    disconnectCount: 0,
    disconnect() {
      this.disconnectCount++;
    },
    start() {},
    stop() {},
    buffer: null as unknown,
    loop: false,
    type: 'sine',
    gain: fakeParam(),
    frequency: fakeParam(),
    detune: fakeParam(),
    Q: fakeParam(),
    playbackRate: fakeParam(),
    delayTime: fakeParam(),
  };
}

function stubContext(): SynthContext & { created: FakeNode[] } {
  const created: FakeNode[] = [];
  const make = () => {
    const n = fakeNode();
    created.push(n);
    return n;
  };
  const stub = {
    created,
    currentTime: 0,
    sampleRate: 48000,
    createGain: make,
    createOscillator: make,
    createBiquadFilter: make,
    createDelay: make,
    createBufferSource: make,
    createBuffer(channels: number, length: number, sampleRate: number) {
      const data = new Float32Array(length);
      return { channels, length, sampleRate, getChannelData: () => data };
    },
  };
  return stub as unknown as SynthContext & { created: FakeNode[] };
}

describe('cue map', () => {
  it('CUE_NAMES covers every required cue exactly once', () => {
    for (const name of [...EXPECTED_BOARD, ...EXPECTED_DUEL, ...EXPECTED_VOCAL]) {
      expect(CUE_NAMES).toContain(name);
    }
    expect(new Set(CUE_NAMES).size).toBe(CUE_NAMES.length);
    expect(BOARD_CUES.length).toBe(EXPECTED_BOARD.length);
    expect(DUEL_CUES.length).toBe(EXPECTED_DUEL.length);
    expect(VOCAL_CUES.length).toBe(EXPECTED_VOCAL.length);
  });

  it('every cue name has a builder and vice versa', () => {
    expect(Object.keys(CUE_BUILDERS).sort()).toEqual([...CUE_NAMES].sort());
  });

  it('isCueName rejects unknown names', () => {
    expect(isCueName('move')).toBe(true);
    expect(isCueName('explosion')).toBe(false);
  });
});

describe('AudioEngine in Node (no AudioContext)', () => {
  it('constructs without touching WebAudio', () => {
    expect(() => new AudioEngine(42)).not.toThrow();
  });

  it('play() with an unknown cue throws even before resume()', () => {
    const engine = new AudioEngine(42);
    expect(() => engine.play('not-a-cue')).toThrow(/Unknown audio cue/);
  });

  it('play() with a known cue before resume() is a silent no-op', () => {
    const engine = new AudioEngine(42);
    for (const name of CUE_NAMES) expect(() => engine.play(name)).not.toThrow();
  });

  it('applySettings before resume() does not require a context', () => {
    const engine = new AudioEngine(42);
    expect(() =>
      engine.applySettings({
        viewMode: '3d',
        duelSpeed: 1,
        duelsFirstNMoves: Infinity,
        reducedMotion: false,
        masterVolume: 0.5,
        musicVolume: 0.5,
        sfxVolume: 0.5,
      }),
    ).not.toThrow();
  });
});

describe('cue builders as pure graph-builders', () => {
  it('every known cue resolves to a voice spec on a stub context', () => {
    const ctx = stubContext();
    const dest = ctx.createGain();
    const prng = mulberry32(7);
    for (const name of CUE_NAMES) {
      const voice = CUE_BUILDERS[name](ctx, dest, prng, 1);
      expect(voice.duration).toBeGreaterThan(0);
      expect(typeof voice.stop).toBe('function');
      expect(() => voice.stop(1)).not.toThrow();
    }
  });

  it('every cue voice disposes cleanly (disconnects its subgraph)', () => {
    const ctx = stubContext();
    const dest = ctx.createGain();
    const prng = mulberry32(11);
    for (const name of CUE_NAMES) {
      const before = ctx.created.length;
      const voice = CUE_BUILDERS[name](ctx, dest, prng, 1);
      expect(typeof voice.dispose).toBe('function');
      expect(() => voice.dispose()).not.toThrow();
      const disconnected = ctx.created
        .slice(before)
        .reduce((sum, n) => sum + n.disconnectCount, 0);
      expect(disconnected).toBeGreaterThan(0);
    }
  });

  it('whoosh and ui-click are layered (transient + body + tail), not single sources', () => {
    for (const name of ['whoosh', 'ui-click'] as const) {
      const ctx = stubContext();
      const dest = ctx.createGain();
      const sourcesBefore = ctx.created.length;
      CUE_BUILDERS[name](ctx, dest, mulberry32(5), 1);
      expect(ctx.created.length - sourcesBefore).toBeGreaterThanOrEqual(6);
    }
  });

  it('sustained envelopes schedule a release ramp to silence at the natural end', () => {
    const param = fakeParam();
    const holdUntil = 1.0;
    const end = applyEnvelope(
      param as unknown as AudioParam,
      0,
      { attack: 0.05, decay: 0.5, peak: 0.6, sustain: 0.3 },
      holdUntil,
    );
    expect(end).toBeGreaterThan(holdUntil);
    const last = param.calls[param.calls.length - 1]!;
    expect(last.method).toBe('exponentialRampToValueAtTime');
    expect(last.args[0]).toBeLessThanOrEqual(0.0001);
    expect(last.args[1]).toBeCloseTo(end, 6);
  });

  it('percussive envelopes still decay fully to silence', () => {
    const param = fakeParam();
    const end = applyEnvelope(param as unknown as AudioParam, 0, {
      attack: 0.004,
      decay: 0.2,
      peak: 0.5,
    });
    expect(end).toBeCloseTo(0.204, 6);
    const last = param.calls[param.calls.length - 1]!;
    expect(last.method).toBe('exponentialRampToValueAtTime');
    expect(last.args[0]).toBeLessThanOrEqual(0.0001);
  });

  it('noise buffers are cached per context and deterministic per seed', () => {
    const ctx = stubContext();
    const a = noiseBuffer(ctx, 'white', mulberry32(1));
    const b = noiseBuffer(ctx, 'white', mulberry32(999));
    expect(a).toBe(b);

    const ctx2 = stubContext();
    const c = noiseBuffer(ctx2, 'white', mulberry32(1));
    expect(c.getChannelData(0)).toEqual(a.getChannelData(0));

    const pink = noiseBuffer(ctx, 'pink', mulberry32(1));
    expect(pink).not.toBe(a);
  });
});

describe('Score lifecycle', () => {
  it('start() after stop() restores the output gain (stop → start is not silent)', () => {
    const ctx = stubContext();
    const dest = ctx.createGain();
    const score = new Score(ctx, dest as unknown as AudioNode, mulberry32(3));
    const out = ctx.created[1]!;

    score.start();
    score.stop();
    const fade = out.gain.calls.find(
      (c) => c.method === 'setTargetAtTime' && c.args[0]! <= 0.0001,
    );
    expect(fade).toBeDefined();

    out.gain.calls.length = 0;
    score.start();
    score.stop();
    expect(out.gain.calls.some((c) => c.method === 'cancelScheduledValues')).toBe(true);
    const restore = out.gain.calls.find(
      (c) => c.method === 'setTargetAtTime' && c.args[0]! >= 0.4,
    );
    expect(restore).toBeDefined();
  });
});

describe('AudioEngine voice stacking', () => {
  /** An engine wired to a stub graph, as if resume() had run. */
  function engineOnStub(): {
    engine: AudioEngine;
    ctx: ReturnType<typeof stubContext>;
    state: { voices: unknown[]; fading: unknown[] };
    advance(seconds: number): void;
  } {
    const engine = new AudioEngine(9);
    const ctx = stubContext();
    const w = ctx as unknown as { currentTime: number; state: string };
    w.state = 'running';
    const priv = engine as unknown as {
      ctx: unknown;
      sfxBus: unknown;
      voices: unknown[];
      fading: unknown[];
    };
    priv.ctx = ctx;
    priv.sfxBus = ctx.createGain();
    return {
      engine,
      ctx,
      state: priv as unknown as { voices: unknown[]; fading: unknown[] },
      advance: (seconds) => {
        w.currentTime += seconds;
      },
    };
  }

  it('re-articulates a long cue instead of layering it on itself', () => {
    // 'rune' is a 1.3s voice; three casts half a second apart used to fuse
    // into one held note for the length of a whole duel.
    const { engine, state, advance } = engineOnStub();
    engine.play('rune');
    expect(state.voices).toHaveLength(1);
    advance(0.5);
    engine.play('rune');
    advance(0.5);
    engine.play('rune');
    // Only the newest is still sounding; the others were released.
    expect(state.voices).toHaveLength(1);
    expect(state.fading.length).toBeGreaterThanOrEqual(1);
  });

  it('still lets short cues layer, and lets a long cue re-fire once done', () => {
    const { engine, state, advance } = engineOnStub();
    // 'ui-click' is percussive — stacking two is correct.
    engine.play('ui-click');
    advance(0.01);
    engine.play('ui-click');
    expect(state.voices).toHaveLength(2);

    const fresh = engineOnStub();
    fresh.engine.play('stone-grind');
    fresh.advance(2.0); // past the 1.4s voice
    fresh.engine.play('stone-grind');
    expect(fresh.state.voices).toHaveLength(1);
    expect(fresh.state.fading).toHaveLength(0);
  });

  it('leaves different cue names alone', () => {
    const { engine, state } = engineOnStub();
    engine.play('stone-grind');
    engine.play('rune');
    engine.play('vocal:jotunn');
    expect(state.voices).toHaveLength(3);
  });
});
