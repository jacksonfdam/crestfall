/**
 * Valkyrie (queen): tallest, slender silhouette. Layered feather wings on
 * wingL/wingR, spear and small shield, winged helm.
 */

import { BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

export function buildValkyrie(faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);

  const b = buildHumanoid(kit, kit.root, {
    hipsY: 0.8,
    hipHalf: 0.06,
    thigh: { len: 0.38, r: 0.048 },
    shin: { len: 0.36, r: 0.04 },
    torso: { rTop: 0.085, rBot: 0.105, len: 0.34 },
    chestY: 0.28,
    shoulderX: 0.11,
    shoulderY: 0.04,
    neckY: 0.11,
    upperArm: { len: 0.16, r: 0.033 },
    forearm: { len: 0.15, r: 0.029 },
    headR: 0.054,
    torsoMat: m.steel,
    limbMat: m.cloth,
    headMat: m.bone,
  });

  // Skirt of hanging lamellar plates.
  kit.mesh(new CylinderGeometry(0.1, 0.14, 0.2, 9), m.cloth, b.hips, [
    0, -0.08, 0,
  ]);

  // Winged helm.
  kit.mesh(new SphereGeometry(0.06, 8, 5), m.steel, b.head, [0, 0.075, 0]);
  for (const s of [1, -1] as const) {
    kit.mesh(new BoxGeometry(0.015, 0.1, 0.07), m.bone, b.head, [
      s * 0.06, 0.13, 0.01,
    ], [0.25, 0, s * 0.35]);
  }

  // Feather-layered wings; wing bones flare them in guard/victory.
  for (const s of [1, -1] as const) {
    const wing = kit.bone(s === 1 ? 'wingL' : 'wingR', b.chest, [
      s * 0.05, 0.12, 0.06,
    ]);
    const layers = [
      { len: 0.29, w: 0.08, tilt: 0.78, z: 0 },
      { len: 0.26, w: 0.07, tilt: 1.1, z: 0.02 },
      { len: 0.21, w: 0.06, tilt: 1.4, z: 0.04 },
    ];
    for (const f of layers) {
      const a = f.tilt;
      kit.mesh(new BoxGeometry(f.len, f.w, 0.014), m.bone, wing, [
        s * Math.cos(a) * (f.len / 2 + 0.02),
        Math.sin(a) * (f.len / 2 + 0.02),
        f.z,
      ], [0.15, s * 0.35, s * a]);
    }
  }

  const weapon = kit.bone('weapon', b.handR);
  kit.mesh(new CylinderGeometry(0.013, 0.015, 1.1, 6), m.wood, weapon, [
    0, -0.05, 0,
  ]);
  kit.mesh(new ConeGeometry(0.028, 0.12, 6), m.steel, weapon, [0, 0.56, 0]);
  for (const s of [1, -1] as const) {
    kit.mesh(new BoxGeometry(0.05, 0.035, 0.012), m.steel, weapon, [
      s * 0.035, 0.485, 0,
    ], [0, 0, s * 0.5]);
  }

  const shield = kit.bone('shield', b.forearmL, [0, -0.06, -0.05]);
  kit.mesh(new CylinderGeometry(0.11, 0.11, 0.016, 12), m.wood, shield, [
    0, 0, 0,
  ], [Math.PI / 2, 0, 0]);
  kit.mesh(new SphereGeometry(0.028, 8, 5), m.steel, shield, [0, 0, -0.014]);

  return kit.build('valkyrie', faction, 1.5, {
    idle: {
      armR: [0.18, 0, -0.1],
      forearmR: [0.25, 0, 0],
      armL: [0.25, 0, 0.12],
      forearmL: [0.4, 0, 0],
    },
    guard: {
      armR: [1.1, 0, -0.2],
      forearmR: [0.45, 0, 0],
      armL: [0.8, 0, 0.15],
      forearmL: [0.5, 0, 0],
      wingL: [0, 0, 0.35],
      wingR: [0, 0, -0.35],
      spine: [0.1, 0, 0],
    },
    victory: {
      armR: [2.85, 0, -0.15],
      forearmR: [0.1, 0, 0],
      armL: [0.5, 0, 0.6],
      wingL: [0, -0.2, 0.6],
      wingR: [0, 0.2, -0.6],
      head: [-0.2, 0, 0],
    },
  });
}
