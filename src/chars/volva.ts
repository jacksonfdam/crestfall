/**
 * Völva (bishop): hooded seeress with a long iron staff and hanging
 * talismans. No face under the hood — only shadow.
 */

import { BoxGeometry, ConeGeometry, CylinderGeometry, TorusGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

export function buildVolva(faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);

  const b = buildHumanoid(kit, kit.root, {
    hipsY: 0.55,
    hipHalf: 0.05,
    thigh: { len: 0.2, r: 0.05 },
    shin: { len: 0.2, r: 0.04 },
    torso: { rTop: 0.095, rBot: 0.115, len: 0.3 },
    chestY: 0.24,
    shoulderX: 0.1,
    shoulderY: 0.03,
    neckY: 0.09,
    upperArm: { len: 0.13, r: 0.032 },
    forearm: { len: 0.12, r: 0.028 },
    headR: 0.055,
    torsoMat: m.cloth,
    limbMat: m.cloth,
    headMat: m.void,
    legs: false,
  });

  // Floor-length robe hides the legs entirely.
  kit.mesh(new CylinderGeometry(0.105, 0.19, 0.6, 9), m.cloth, b.hips, [
    0, -0.26, 0,
  ]);

  // Deep hood: shadow disc where a face would be.
  kit.mesh(new ConeGeometry(0.088, 0.17, 8), m.cloth, b.head, [0, 0.11, 0.01]);
  kit.mesh(new CylinderGeometry(0.062, 0.07, 0.09, 8), m.cloth, b.head, [
    0, 0.045, 0.01,
  ]);
  kit.mesh(new CylinderGeometry(0.048, 0.048, 0.006, 10), m.void, b.head, [
    0, 0.05, -0.052,
  ], [Math.PI / 2, 0, 0]);

  // Cloak down the back.
  const cloak = kit.bone('cloak', b.chest, [0, 0.06, 0.07]);
  kit.mesh(new BoxGeometry(0.24, 0.5, 0.02), m.cloth, cloak, [0, -0.2, 0.02], [
    0.12, 0, 0,
  ]);

  // Long iron staff, held upright; ring finial with a charm.
  const staff = kit.bone('staff', b.handR);
  kit.mesh(new CylinderGeometry(0.014, 0.016, 0.92, 6), m.steel, staff, [
    0, -0.14, 0,
  ]);
  kit.mesh(new TorusGeometry(0.035, 0.009, 6, 10), m.steel, staff, [0, 0.36, 0]);
  kit.mesh(new BoxGeometry(0.02, 0.03, 0.006), m.accent, staff, [0, 0.3, 0]);

  // Talismans on a belt cord.
  for (const [x, z, rot] of [
    [-0.07, -0.075, 0.3],
    [0.0, -0.095, 0.0],
    [0.07, -0.075, -0.3],
  ] as const) {
    kit.mesh(new CylinderGeometry(0.003, 0.003, 0.05, 4), m.hide, b.spine, [
      x, 0.02, z,
    ]);
    kit.mesh(new BoxGeometry(0.022, 0.03, 0.008), m.bone, b.spine, [
      x, -0.015, z,
    ], [0, rot, 0]);
  }

  return kit.build('volva', faction, 1.15, {
    idle: {
      armR: [0.35, 0, -0.08],
      forearmR: [0.35, 0, 0],
      armL: [0.2, 0, 0.1],
      forearmL: [0.55, 0, 0],
      head: [0.08, 0, 0],
    },
    guard: {
      armR: [1.15, 0, -0.15],
      forearmR: [0.3, 0, 0],
      armL: [0.7, 0, 0.3],
      forearmL: [0.8, 0, 0],
      spine: [0.1, 0, 0],
      head: [-0.05, 0, 0],
    },
    victory: {
      armR: [2.6, 0, -0.2],
      forearmR: [0.1, 0, 0],
      armL: [2.4, 0, 0.25],
      forearmL: [0.2, 0, 0],
      head: [-0.25, 0, 0],
    },
  });
}
