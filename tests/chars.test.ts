/**
 * Rig construction gates for src/chars.
 *
 * These are the invariants that a silhouette tweak can silently break and that
 * no render test would catch, because a rig that self-intersects still draws:
 *
 * - a carried shield stays outside the body it protects, in every pose;
 * - nobody's geometry sinks through the board;
 * - the bones the animation layer drives by name actually exist.
 */

import { describe, expect, it } from 'vitest';
import { Mesh, Vector3 } from 'three';
import type { Object3D } from 'three';
import { buildCharacter } from '../src/chars/index.ts';
import type { CharacterName } from '../src/core/contract.ts';
import type { BoneName, CharacterRig, PoseName } from '../src/core/stage.ts';
import { gaitFor, stepTravel } from '../src/render/locomotion.ts';

const NAMES: CharacterName[] = [
  'huscarl',
  'berserkr',
  'volva',
  'jotunn',
  'valkyrie',
  'jarl',
];
const POSES: PoseName[] = ['idle', 'guard', 'victory'];

/**
 * Meshes under `bone`, stopping at any other bone: the geometry that moves with
 * this joint and nothing that moves with a child joint.
 */
function ownMeshes(rig: CharacterRig, bone: Object3D): Mesh[] {
  const joints = new Set<Object3D>(
    Object.values(rig.bones).filter((b): b is Object3D => b !== undefined),
  );
  const out: Mesh[] = [];
  const walk = (node: Object3D): void => {
    for (const child of node.children) {
      if (joints.has(child)) continue;
      if (child instanceof Mesh) out.push(child);
      walk(child);
    }
  };
  walk(bone);
  return out;
}

const BIN = 0.02;

/**
 * The body's radius as a function of height. The trunk is a stack of solids
 * revolved about the rig's own Y axis, so "outside the body" is exactly
 * "further from that axis than this" — which makes the shield test a scalar
 * comparison rather than a mesh intersection.
 */
function trunkRadius(rig: CharacterRig): (y: number) => number {
  const bins = new Map<number, number>();
  const v = new Vector3();
  const trunk: BoneName[] = ['hips', 'hem', 'spine', 'chest', 'head'];
  rig.root.updateMatrixWorld(true);
  for (const name of trunk) {
    const bone = rig.bones[name];
    if (!bone) continue;
    for (const mesh of ownMeshes(rig, bone)) {
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const key = Math.round(v.y / BIN);
        const r = Math.hypot(v.x, v.z);
        if (r > (bins.get(key) ?? 0)) bins.set(key, r);
      }
    }
  }
  // A point between two rings has to clear both of them.
  return (y: number): number => {
    const key = Math.round(y / BIN);
    return Math.max(
      bins.get(key - 1) ?? 0,
      bins.get(key) ?? 0,
      bins.get(key + 1) ?? 0,
    );
  };
}

/** Worst (smallest) gap between the shield's boards and the trunk. */
function shieldClearance(rig: CharacterRig): number {
  const shield = rig.bones.shield;
  if (!shield) return Infinity;
  rig.root.updateMatrixWorld(true);
  const radiusAt = trunkRadius(rig);
  const v = new Vector3();
  let worst = Infinity;
  for (const mesh of ownMeshes(rig, shield)) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const gap = Math.hypot(v.x, v.z) - radiusAt(v.y);
      if (gap < worst) worst = gap;
    }
  }
  return worst;
}

describe('carried shields clear the body', () => {
  for (const name of ['huscarl', 'valkyrie'] as const) {
    for (const pose of POSES) {
      it(`${name} in ${pose}`, () => {
        const rig = buildCharacter(name, 'ash');
        rig.setPose(pose);
        expect(rig.bones.shield).toBeDefined();
        // 4mm on a 0.9–1.5 unit figure: enough that no rim vertex is inside
        // the mail, tight enough that the shield still reads as carried.
        expect(shieldClearance(rig)).toBeGreaterThan(0.004);
        rig.dispose();
      });
    }
  }
});

describe('a shield stays clear while its owner walks', () => {
  for (const name of ['huscarl', 'valkyrie'] as const) {
    it(name, () => {
      const rig = buildCharacter(name, 'ash');
      let worst = Infinity;
      // Only root.rotation.y moves under a walk, so the trunk axis the
      // clearance is measured against is still the rig's own axis.
      for (let i = 0; i <= 120; i++) {
        stepTravel(rig, 'walk', i / 120, 5, 1.7);
        worst = Math.min(worst, shieldClearance(rig));
      }
      expect(worst).toBeGreaterThan(0.004);
      rig.dispose();
    });
  }
});

/**
 * Lowest VERTEX, not lowest bounding box. A revolved stave's box spans its whole
 * ring, so once a rig is tilted its box reaches a radius the geometry never
 * does — which would report the jötunn cutting through the board when it is
 * pivoting on its edge exactly as intended.
 */
function lowestVertex(rig: CharacterRig): number {
  rig.root.updateMatrixWorld(true);
  const v = new Vector3();
  let lo = Infinity;
  rig.root.traverse((o: Object3D) => {
    if (!(o instanceof Mesh)) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y;
      if (y < lo) lo = y;
    }
  });
  return lo;
}

describe('nobody sinks through the board', () => {
  for (const name of NAMES) {
    it(`${name}, standing`, () => {
      const rig = buildCharacter(name, 'ash');
      for (const pose of POSES) {
        rig.setPose(pose);
        // The völva's hem is deliberately set a hair under the board so a
        // floor-length robe never shows daylight beneath it; nothing else may
        // reach even that far.
        expect(lowestVertex(rig)).toBeGreaterThan(-0.011);
      }
      rig.dispose();
    });

    it(`${name}, crossing the board`, () => {
      const rig = buildCharacter(name, 'ash');
      const gait = gaitFor(name, false);
      let lo = Infinity;
      for (let i = 0; i <= 180; i++) {
        // stepTravel returns the bob for the caller to add to the root, so the
        // gait is only whole once it has been applied — the jötunn's edge-pivot
        // lift lives entirely in that return value.
        rig.root.position.y = stepTravel(rig, gait, i / 180, 5, 2.1);
        lo = Math.min(lo, lowestVertex(rig));
      }
      // A stride dips a boot or a hoof a centimetre under at worst. What this
      // catches is a gait that puts a whole body through the board: an
      // uncompensated tilt on the tower is four times this.
      expect(lo).toBeGreaterThan(-0.02);
      rig.dispose();
    });
  }
});

describe('bones the animation layer drives by name', () => {
  it("gives the berserkr's horse four jointed legs", () => {
    const rig = buildCharacter('berserkr', 'ash');
    for (const side of ['FL', 'FR', 'BL', 'BR'] as const) {
      expect(rig.bones[`mountLeg${side}`]).toBeDefined();
      expect(rig.bones[`mountShin${side}`]).toBeDefined();
    }
    rig.dispose();
  });

  it('gives the völva legs to carry her and a hem to trail', () => {
    const rig = buildCharacter('volva', 'ash');
    for (const bone of ['legL', 'legR', 'shinL', 'shinR', 'hem'] as const) {
      expect(rig.bones[bone]).toBeDefined();
    }
    rig.dispose();
  });
});
