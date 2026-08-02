/**
 * Jarl (king): the widest silhouette. Fur mantle over heavy shoulders,
 * crowned helm, greatsword held two-handed, point resting down.
 */

import { BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

export function buildJarl(faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);

  const b = buildHumanoid(kit, kit.root, {
    hipsY: 0.62,
    hipHalf: 0.085,
    thigh: { len: 0.29, r: 0.06 },
    shin: { len: 0.28, r: 0.052 },
    torso: { rTop: 0.14, rBot: 0.15, len: 0.34 },
    chestY: 0.3,
    shoulderX: 0.175,
    shoulderY: 0.05,
    neckY: 0.13,
    upperArm: { len: 0.16, r: 0.045 },
    forearm: { len: 0.15, r: 0.04 },
    headR: 0.06,
    torsoMat: m.cloth,
    limbMat: m.cloth,
    headMat: m.bone,
  });

  // Fur mantle: the widest line on the board.
  const cloak = kit.bone('cloak', b.chest, [0, 0.1, 0]);
  kit.mesh(new CylinderGeometry(0.2, 0.245, 0.16, 10), m.hide, cloak, [
    0, -0.04, 0,
  ]);
  kit.mesh(new BoxGeometry(0.34, 0.5, 0.025), m.hide, cloak, [0, -0.3, 0.13], [
    0.08, 0, 0,
  ]);

  // Crowned helm.
  kit.mesh(new SphereGeometry(0.065, 8, 5), m.steel, b.head, [0, 0.08, 0]);
  kit.mesh(new CylinderGeometry(0.07, 0.07, 0.045, 8), m.accent, b.head, [
    0, 0.125, 0,
  ]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    kit.mesh(new ConeGeometry(0.014, 0.05, 4), m.accent, b.head, [
      Math.sin(a) * 0.062, 0.17, Math.cos(a) * 0.062,
    ]);
  }
  kit.mesh(new BoxGeometry(0.09, 0.07, 0.05), m.hide, b.head, [0, -0.02, -0.035]);

  // Greatsword on the weapon bone, two-handed scale, point down.
  const weapon = kit.bone('weapon', b.handR);
  kit.mesh(new CylinderGeometry(0.017, 0.019, 0.16, 6), m.wood, weapon, [
    0, 0.05, 0,
  ]);
  kit.mesh(new SphereGeometry(0.028, 6, 5), m.steel, weapon, [0, 0.14, 0]);
  kit.mesh(new BoxGeometry(0.2, 0.03, 0.035), m.steel, weapon, [0, -0.04, 0]);
  kit.mesh(new BoxGeometry(0.055, 0.55, 0.016), m.steel, weapon, [0, -0.325, 0]);
  kit.mesh(new ConeGeometry(0.03, 0.06, 4), m.steel, weapon, [0, -0.63, 0], [
    Math.PI, 0, Math.PI / 4,
  ]);

  return kit.build('jarl', faction, 1.35, {
    idle: {
      armR: [0.42, 0, -0.35],
      forearmR: [0.35, 0, 0],
      armL: [0.42, 0, 0.35],
      forearmL: [0.42, 0, 0],
      spine: [0.03, 0, 0],
      weapon: [-0.77, 0, 0.35],
    },
    guard: {
      armR: [1.25, 0, -0.3],
      forearmR: [0.5, 0, 0],
      armL: [1.1, 0, 0.35],
      forearmL: [0.6, 0, 0],
      spine: [0.15, 0, 0],
      head: [-0.1, 0, 0],
    },
    victory: {
      armR: [2.9, 0, -0.2],
      forearmR: [0.1, 0, 0],
      armL: [0.6, 0, 0.55],
      forearmL: [0.4, 0, 0],
      head: [-0.2, 0, 0],
      spine: [-0.05, 0, 0],
    },
  });
}
