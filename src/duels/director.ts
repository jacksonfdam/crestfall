/**
 * DuelDirector: drives DuelScripts from an external render-loop clock.
 * It owns no rAF, blocks no input, and can never alter game state — by the
 * time play() is called the capture has already resolved in the event.
 *
 * Guarantees:
 * - onDone fires exactly once per play(), synchronously when duels are
 *   instant (duelSpeed 0 or reducedMotion) or on skip()/clear().
 * - Every playback ends on the canonical t=1 state: script sampled at 1,
 *   victim rig hidden and re-posed to idle, attacker at idle on the captured
 *   square, camera released.
 * - Duels queue if a second capture arrives while one plays; clear() snaps
 *   everything (current + queue) to its end state silently.
 */

import type { PieceType, Settings } from '../core/contract.ts';
import type {
  CharacterRig,
  DuelCameraRig,
  DuelContext,
  DuelScript,
} from '../core/stage.ts';
import { hash32, mulberry32 } from '../core/prng.ts';

export interface DuelDirectorDeps {
  cameraRig: DuelCameraRig;
  /** Forwarded to the audio module; names must come from CUE_NAMES. */
  cue: (name: string, intensity?: number) => void;
  /** Live settings read every frame — speed changes apply mid-duel. */
  settings: () => Settings;
}

export interface DuelPlayOptions {
  script: DuelScript;
  attacker: CharacterRig;
  victim: CharacterRig;
  attackerPiece: PieceType;
  victimPiece: PieceType;
  seed: number;
  moveIndex: number;
  attackerPos: [number, number, number];
  victimPos: [number, number, number];
  onDone: () => void;
}

export interface DuelHandle {
  /** Jump cleanly to t=1 (silent). Safe to call at any time, repeatedly. */
  skip(): void;
}

/**
 * Same cue name re-fires only after this much normalized time has passed —
 * scripts fire cues from windowed threshold checks that span several frames,
 * so the director collapses each beat to one emission while still allowing
 * a genuine second impact later in the duel.
 */
const CUE_REFIRE_WINDOW = 0.1;

interface Playback {
  readonly opts: DuelPlayOptions;
  readonly ctx: DuelContext;
  t: number;
  done: boolean;
  /** While true, ctx.cue is a no-op (skips, clears, instant mode). */
  muted: boolean;
  skipRequested: boolean;
  firedCues: Map<string, number>;
}

export class DuelDirector {
  private current: Playback | null = null;
  private readonly queue: Playback[] = [];

  constructor(private readonly deps: DuelDirectorDeps) {}

  get active(): boolean {
    return this.current !== null;
  }

  play(opts: DuelPlayOptions): DuelHandle {
    const playback = this.createPlayback(opts);
    if (this.current) {
      this.queue.push(playback);
    } else {
      this.start(playback);
    }
    return {
      skip: () => this.skipPlayback(playback),
    };
  }

  /** Called by the render loop with wall-clock seconds. */
  update(dt: number): void {
    const p = this.current;
    if (!p) return;
    const s = this.deps.settings();
    if (s.duelSpeed === 0 || s.reducedMotion) {
      this.finish(p, true);
      this.startNext();
      return;
    }
    p.t = Math.min(1, p.t + (dt * s.duelSpeed) / p.opts.script.duration);
    this.sample(p, p.t);
    if (p.t >= 1) {
      this.finish(p, false);
      this.startNext();
    }
  }

  /**
   * Snap current AND queued duels to their end states silently. Called on
   * undo/redo/newgame — the renderer re-derives the scene from the event,
   * so all we owe is clean rigs, a released camera, and every onDone.
   */
  clear(): void {
    const pending = this.queue.splice(0, this.queue.length);
    const cur = this.current;
    this.current = null;
    if (cur) this.finish(cur, true);
    for (const p of pending) this.finish(p, true);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private createPlayback(opts: DuelPlayOptions): Playback {
    const playback: Playback = {
      opts,
      t: 0,
      done: false,
      muted: false,
      skipRequested: false,
      firedCues: new Map(),
      ctx: {
        attacker: opts.attacker,
        victim: opts.victim,
        attackerPiece: opts.attackerPiece,
        victimPiece: opts.victimPiece,
        camera: this.deps.cameraRig,
        prng: mulberry32(
          hash32(
            opts.seed,
            opts.moveIndex,
            (opts.attackerPiece.charCodeAt(0) << 8) |
              opts.victimPiece.charCodeAt(0),
          ),
        ),
        attackerPos: opts.attackerPos,
        victimPos: opts.victimPos,
        cue: (name, intensity) => this.emitCue(playback, name, intensity),
      },
    };
    return playback;
  }

  private emitCue(p: Playback, name: string, intensity?: number): void {
    if (p.muted || p.done) return;
    const last = p.firedCues.get(name);
    if (last !== undefined && p.t - last < CUE_REFIRE_WINDOW) return;
    p.firedCues.set(name, p.t);
    this.deps.cue(name, intensity);
  }

  private start(p: Playback): void {
    this.current = p;
    const s = this.deps.settings();
    if (p.skipRequested || s.duelSpeed === 0 || s.reducedMotion) {
      // Instant: land on t=1 and report done synchronously.
      this.finish(p, true);
      this.startNext();
      return;
    }
    this.sample(p, 0);
  }

  private startNext(): void {
    if (this.current) return;
    const next = this.queue.shift();
    if (next) this.start(next);
  }

  private skipPlayback(p: Playback): void {
    if (p.done) return;
    if (this.current === p) {
      this.finish(p, true);
      this.startNext();
    } else {
      // Still queued: resolve instantly the moment it would have started.
      p.skipRequested = true;
    }
  }

  private sample(p: Playback, t: number): void {
    p.t = t;
    try {
      p.opts.script.update(t, p.ctx);
    } catch (err) {
      // A broken script must never wedge the game: land it and move on.
      // eslint-disable-next-line no-console
      console.error('duel script failed; snapping to end', err);
      p.t = 1;
    }
  }

  /** Land p on the canonical end state and fire its onDone exactly once. */
  private finish(p: Playback, silent: boolean): void {
    if (p.done) {
      if (this.current === p) this.current = null;
      return;
    }
    p.muted = silent || p.muted;
    if (p.t < 1) this.sample(p, 1);
    p.done = true;

    const { attacker, victim, victimPos, onDone } = p.opts;
    // Victim: cleared by the director — hidden, bones back to idle.
    victim.setPose('idle');
    victim.root.visible = false;
    // Attacker: idle on the captured square.
    attacker.setPose('idle');
    attacker.root.position.set(victimPos[0], victimPos[1], victimPos[2]);
    attacker.root.scale.set(1, 1, 1);

    this.deps.cameraRig.release();
    if (this.current === p) this.current = null;
    onDone();
  }
}
