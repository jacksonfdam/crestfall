/**
 * Presentation-side contract: character rigs, duel scripts, camera rig.
 * Type-only three imports — core ships no renderer code.
 */

import type { Group, Object3D, PerspectiveCamera } from 'three';
import type { Faction, CharacterName, PieceType } from './contract.ts';
import type { PRNG } from './prng.ts';

/**
 * Canonical bone names. Builders must expose every bone that exists for
 * their anatomy; duel scripts animate bones by these names only.
 * root/hips/spine/head are mandatory for all characters.
 */
export type BoneName =
  | 'root'
  | 'hips'
  | 'spine'
  | 'chest'
  | 'head'
  | 'armL'
  | 'armR'
  | 'forearmL'
  | 'forearmR'
  | 'handL'
  | 'handR'
  | 'legL'
  | 'legR'
  | 'shinL'
  | 'shinR'
  | 'weapon'
  | 'shield'
  | 'cloak'
  | 'wingL'
  | 'wingR'
  | 'mount'      // Berserkr's horse body
  | 'mountHead'
  | 'staff'      // Völva
  | 'towerShell'; // Jötunn petrified form

export type PoseName = 'idle' | 'victory' | 'guard';

export interface CharacterRig {
  name: CharacterName;
  faction: Faction;
  root: Group;
  bones: Partial<Record<BoneName, Object3D>>;
  /** Snap to a canonical pose. Duels must start and end from 'idle'. */
  setPose(pose: PoseName): void;
  /** Approximate height in board units (one square = 1 unit). */
  height: number;
  dispose(): void;
}

export interface CharacterOptions {
  /** 2D mode uses flat emblem meshes instead of full figures. */
  flat?: boolean;
}

export type CharacterFactory = (
  faction: Faction,
  opts?: CharacterOptions,
) => CharacterRig;

// ── Duels ───────────────────────────────────────────────────────────────────

export interface DuelCameraRig {
  camera: PerspectiveCamera;
  /** Frame two combatants standing on `fromSq`/`toSq` world positions. */
  moveTo(pos: [number, number, number], lookAt: [number, number, number], t: number): void;
  shake(intensity: number): void;
  /** Return control to the board camera. */
  release(): void;
}

export interface DuelContext {
  attacker: CharacterRig;
  victim: CharacterRig;
  attackerPiece: PieceType;
  victimPiece: PieceType;
  camera: DuelCameraRig;
  prng: PRNG; // seeded per-duel; the only allowed randomness
  /** World-space square centers. */
  attackerPos: [number, number, number];
  victimPos: [number, number, number];
  /** Fire a named audio cue ('impact','whoosh','vocal:<char>','stone',…). */
  cue(name: string, intensity?: number): void;
}

/**
 * A duel script is a pure pose-function of normalized time t ∈ [0,1].
 * Sampling at any t must be valid: scrubbing, 2× speed, and jumping straight
 * to t=1 (skip) all land on clean states. No internal timers, no tweens
 * with hidden state.
 */
export interface DuelScript {
  /** Wall-clock duration at 1× speed, seconds. MUST be ≤ 4 including camera. */
  duration: number;
  update(t: number, ctx: DuelContext): void;
}

/** attacker+victim → variants. Key format: `${attacker}x${victim}`, e.g. 'qxk'. */
export type DuelMatrix = Record<string, DuelScript[]>;
