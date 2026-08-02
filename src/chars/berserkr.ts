/**
 * Berserkr (knight): axe-wielding rider fused with a shaggy northern horse.
 * Wolf pelt over the shoulders, twin axes — one on the weapon bone, its twin
 * under handL.
 */

import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Object3D } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials, type FactionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

function axe(
  kit: RigKit,
  m: FactionMaterials,
  parent: Object3D,
  s: 1 | -1,
): void {
  kit.mesh(new CylinderGeometry(0.012, 0.014, 0.3, 6), m.wood, parent, [
    0, 0.05, 0,
  ]);
  kit.mesh(new BoxGeometry(0.1, 0.07, 0.02), m.steel, parent, [s * -0.05, 0.17, 0]);
  kit.mesh(new BoxGeometry(0.02, 0.11, 0.02), m.steel, parent, [
    s * -0.095, 0.17, 0,
  ]);
}

export function buildBerserkr(faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);

  const mount = kit.bone('mount', kit.root, [0, 0.46, 0]);
  kit.mesh(new CylinderGeometry(0.15, 0.15, 0.55, 8), m.hide, mount, [
    0, 0.05, 0.02,
  ], [Math.PI / 2, 0, 0]);
  kit.mesh(new SphereGeometry(0.155, 8, 6), m.hide, mount, [0, 0.05, 0.28]);
  kit.mesh(new SphereGeometry(0.15, 8, 6), m.hide, mount, [0, 0.06, -0.26]);
  // Legs are static hide; the rider's legL/R are the rig's leg bones.
  for (const [x, z] of [
    [0.09, -0.22],
    [-0.09, -0.22],
    [0.09, 0.24],
    [-0.09, 0.24],
  ] as const) {
    kit.mesh(new CylinderGeometry(0.032, 0.026, 0.42, 6), m.hide, mount, [
      x, -0.25, z,
    ]);
    kit.mesh(new BoxGeometry(0.06, 0.045, 0.07), m.void, mount, [x, -0.44, z]);
  }
  kit.mesh(new BoxGeometry(0.05, 0.3, 0.06), m.hide, mount, [0, -0.02, 0.36], [
    -0.5, 0, 0,
  ]);

  const mountHead = kit.bone('mountHead', mount, [0, 0.16, -0.28]);
  kit.mesh(new CylinderGeometry(0.055, 0.075, 0.26, 7), m.hide, mountHead, [
    0, 0.06, -0.05,
  ], [0.55, 0, 0]);
  kit.mesh(new BoxGeometry(0.085, 0.09, 0.2), m.hide, mountHead, [0, 0.16, -0.17]);
  kit.mesh(new BoxGeometry(0.11, 0.05, 0.05), m.void, mountHead, [0, 0.13, -0.27]);
  for (const s of [1, -1] as const) {
    kit.mesh(new BoxGeometry(0.025, 0.06, 0.02), m.hide, mountHead, [
      s * 0.035, 0.22, -0.1,
    ]);
  }
  // Shaggy mane along the neck ridge.
  for (let i = 0; i < 3; i++) {
    kit.mesh(new BoxGeometry(0.05, 0.09, 0.07), m.cloth, mountHead, [
      0, 0.14 - i * 0.045, 0.02 + i * 0.06,
    ], [0.4, 0, 0]);
  }

  const b = buildHumanoid(kit, mount, {
    hipsY: 0.28,
    hipHalf: 0.075,
    thigh: { len: 0.2, r: 0.04 },
    shin: { len: 0.19, r: 0.035 },
    torso: { rTop: 0.1, rBot: 0.12, len: 0.26 },
    chestY: 0.21,
    shoulderX: 0.13,
    shoulderY: 0.03,
    neckY: 0.09,
    upperArm: { len: 0.14, r: 0.036 },
    forearm: { len: 0.13, r: 0.032 },
    headR: 0.055,
    torsoMat: m.hide,
    limbMat: m.cloth,
    headMat: m.bone,
  });

  // Wolf pelt: mantle over the shoulders, snout crest over the helm.
  kit.mesh(new SphereGeometry(0.13, 8, 6), m.hide, b.chest, [0, 0.06, 0.02], [
    0, 0, 0,
  ], [1.25, 0.6, 1.15]);
  kit.mesh(new BoxGeometry(0.07, 0.05, 0.12), m.hide, b.head, [0, 0.12, -0.03]);
  kit.mesh(new CylinderGeometry(0.06, 0.062, 0.05, 8), m.steel, b.head, [
    0, 0.075, 0,
  ]);

  const weapon = kit.bone('weapon', b.handR);
  axe(kit, m, weapon, 1);
  // Twin axe rides the left hand directly; duels animate handL.
  axe(kit, m, b.handL, -1);

  return kit.build('berserkr', faction, 1.3, {
    idle: {
      legL: [0.55, 0, 0.45],
      shinL: [-1.0, 0, 0],
      legR: [0.55, 0, -0.45],
      shinR: [-1.0, 0, 0],
      armL: [0.25, 0, 0.35],
      forearmL: [0.4, 0, 0],
      armR: [0.25, 0, -0.35],
      forearmR: [0.4, 0, 0],
      mountHead: [0.1, 0, 0],
    },
    guard: {
      legL: [0.55, 0, 0.45],
      shinL: [-1.0, 0, 0],
      legR: [0.55, 0, -0.45],
      shinR: [-1.0, 0, 0],
      armL: [0.9, 0, 0.25],
      forearmL: [0.7, 0, 0],
      armR: [0.9, 0, -0.25],
      forearmR: [0.7, 0, 0],
      spine: [0.15, 0, 0],
      mountHead: [0.3, 0, 0],
    },
    victory: {
      legL: [0.55, 0, 0.45],
      shinL: [-1.0, 0, 0],
      legR: [0.55, 0, -0.45],
      shinR: [-1.0, 0, 0],
      armL: [2.7, 0, 0.3],
      armR: [2.7, 0, -0.3],
      head: [-0.25, 0, 0],
      mountHead: [-0.3, 0, 0],
    },
  });
}
