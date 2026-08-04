/**
 * Board locomotion gate. The load-bearing property is that travel RESOLVES:
 * a piece must arrive in exactly its idle pose, square to the board, with no
 * residual offset or lean. A gait that leaves anything behind would accumulate
 * over a game, so every character is checked at both ends of the journey.
 */

import { describe, expect, it } from 'vitest';
import { PIECE_CHARACTER, type PieceType } from '../src/core/contract.ts';
import { buildCharacter } from '../src/chars/index.ts';
import type { CharacterRig } from '../src/core/stage.ts';
import {
  endTravel,
  gaitFor,
  stepTravel,
  travelSeconds,
  type Gait,
} from '../src/render/locomotion.ts';

const PIECES: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];
const GAITS: Gait[] = ['walk', 'ride', 'drift', 'grind', 'slide'];

/**
 * Signed zero is noise here — a rock amplitude of zero can come out as -0, and
 * -0 is numerically equal to 0 with no effect on a transform. The determinism
 * digest normalizes it the same way.
 */
const z = (n: number): number => (Object.is(n, -0) ? 0 : n);

/** Every bone rotation plus the root transform. */
function snapshot(rig: CharacterRig): number[] {
  const out: number[] = [];
  for (const name of Object.keys(rig.bones).sort()) {
    const bone = rig.bones[name as keyof typeof rig.bones];
    if (!bone) continue;
    out.push(z(bone.rotation.x), z(bone.rotation.y), z(bone.rotation.z));
  }
  out.push(
    z(rig.root.rotation.x), z(rig.root.rotation.y), z(rig.root.rotation.z),
    z(rig.root.position.x), z(rig.root.position.y), z(rig.root.position.z),
  );
  return out;
}

function idleSnapshot(piece: PieceType): number[] {
  const rig = buildCharacter(PIECE_CHARACTER[piece], 'ash');
  rig.setPose('idle');
  rig.root.rotation.set(0, 0, 0);
  rig.root.position.set(0, 0, 0);
  return snapshot(rig);
}

describe('gait assignment', () => {
  it('gives every character a gait its anatomy can perform', () => {
    // Each gait drives a named set of bones, so no character may be handed one
    // it has nothing to perform it with.

    // The jötunn is a folded tower: it is tipped over its shell, never stepped.
    expect(gaitFor('jotunn', false)).toBe('grind');
    expect(buildCharacter('jotunn', 'ash').bones.towerShell).toBeDefined();

    // The berserkr rides, and it is the horse's own four legs that gallop.
    expect(gaitFor('berserkr', false)).toBe('ride');
    const horse = buildCharacter('berserkr', 'ash');
    for (const side of ['FL', 'FR', 'BL', 'BR'] as const) {
      expect(horse.bones[`mountLeg${side}`]).toBeDefined();
      expect(horse.bones[`mountShin${side}`]).toBeDefined();
    }

    // The völva drifts: she does step, but only under a floor-length robe that
    // hangs off its own hem bone — the stride itself is never seen.
    expect(gaitFor('volva', false)).toBe('drift');
    const volva = buildCharacter('volva', 'ash');
    expect(volva.bones.legL).toBeDefined();
    expect(volva.bones.hem).toBeDefined();

    for (const name of ['huscarl', 'valkyrie', 'jarl'] as const) {
      expect(gaitFor(name, false)).toBe('walk');
      expect(buildCharacter(name, 'ash').bones.legL).toBeDefined();
    }
  });

  it('flattens to a slide in 2D, where emblems have no anatomy', () => {
    expect(gaitFor('huscarl', true)).toBe('slide');
    expect(gaitFor('jotunn', true)).toBe('slide');
  });
});

describe('pacing', () => {
  it('takes longer for longer moves, but stays bounded', () => {
    for (const gait of GAITS) {
      const one = travelSeconds(gait, 1);
      const seven = travelSeconds(gait, 7);
      expect(one).toBeGreaterThan(0);
      expect(seven).toBeGreaterThanOrEqual(one);
      expect(seven).toBeLessThanOrEqual(1.2);
    }
  });

  it('moves a mounted knight faster than a walking huscarl', () => {
    expect(travelSeconds('ride', 3)).toBeLessThan(travelSeconds('walk', 3));
  });
});

describe.each(PIECES)('travel for %s', (piece) => {
  const gait = gaitFor(PIECE_CHARACTER[piece], false);

  it('arrives in exactly the idle pose, square to the board', () => {
    const rig = buildCharacter(PIECE_CHARACTER[piece], 'ash');
    // Walk a long diagonal, then land.
    for (let k = 0; k < 1; k += 1 / 90) stepTravel(rig, gait, k, 5, 2.1);
    const bob = stepTravel(rig, gait, 1, 5, 2.1);
    expect(z(bob)).toBe(0);
    expect(snapshot(rig)).toEqual(idleSnapshot(piece));
  });

  it('sets off from the idle pose too', () => {
    const rig = buildCharacter(PIECE_CHARACTER[piece], 'ash');
    expect(z(stepTravel(rig, gait, 0, 5, 2.1))).toBe(0);
    expect(snapshot(rig)).toEqual(idleSnapshot(piece));
  });

  it('is a pure function of progress, not a per-frame accumulation', () => {
    const stepped = buildCharacter(PIECE_CHARACTER[piece], 'ash');
    for (let k = 0; k <= 0.5; k += 1 / 90) stepTravel(stepped, gait, k, 4, 1.0);
    stepTravel(stepped, gait, 0.5, 4, 1.0);

    const cold = buildCharacter(PIECE_CHARACTER[piece], 'ash');
    stepTravel(cold, gait, 0.5, 4, 1.0);

    expect(snapshot(stepped)).toEqual(snapshot(cold));
  });

  it('actually moves something mid-journey', () => {
    const rig = buildCharacter(PIECE_CHARACTER[piece], 'ash');
    stepTravel(rig, gait, 0.5, 4, 1.0);
    expect(snapshot(rig)).not.toEqual(idleSnapshot(piece));
  });

  it('faces the direction of travel mid-journey and squares up on arrival', () => {
    const rig = buildCharacter(PIECE_CHARACTER[piece], 'ash');
    stepTravel(rig, gait, 0.5, 4, 2.0);
    expect(Math.abs(rig.root.rotation.y)).toBeGreaterThan(0.5);
    stepTravel(rig, gait, 1, 4, 2.0);
    expect(rig.root.rotation.y).toBe(0);
  });

  it('can be cut short without leaving the piece mid-stride', () => {
    const rig = buildCharacter(PIECE_CHARACTER[piece], 'ash');
    stepTravel(rig, gait, 0.42, 6, -1.4);
    endTravel(rig);
    expect(snapshot(rig)).toEqual(idleSnapshot(piece));
  });
});
