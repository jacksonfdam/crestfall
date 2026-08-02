/**
 * Huscarl (pawn): round-shield spearman. Conical helm with nasal, mail
 * hauberk; a rank of eight reads as a shield wall — shield forward-left,
 * spear upright.
 */

import { BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

export function buildHuscarl(faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);

  const b = buildHumanoid(kit, kit.root, {
    hipsY: 0.42,
    hipHalf: 0.055,
    thigh: { len: 0.2, r: 0.045 },
    shin: { len: 0.19, r: 0.04 },
    torso: { rTop: 0.09, rBot: 0.115, len: 0.3 },
    chestY: 0.24,
    shoulderX: 0.115,
    shoulderY: 0.03,
    neckY: 0.1,
    upperArm: { len: 0.14, r: 0.035 },
    forearm: { len: 0.13, r: 0.03 },
    headR: 0.055,
    torsoMat: m.steel,
    limbMat: m.cloth,
    headMat: m.bone,
  });

  // Hauberk skirt below the belt.
  kit.mesh(new CylinderGeometry(0.115, 0.145, 0.14, 8), m.steel, b.spine, [
    0, -0.03, 0,
  ]);
  // Conical helm with nasal.
  kit.mesh(new ConeGeometry(0.066, 0.1, 8), m.steel, b.head, [0, 0.12, 0]);
  kit.mesh(new CylinderGeometry(0.062, 0.064, 0.035, 8), m.steel, b.head, [
    0, 0.08, 0,
  ]);
  kit.mesh(new BoxGeometry(0.014, 0.06, 0.012), m.steel, b.head, [0, 0.045, -0.058]);

  // Short spear, upright in the right hand.
  const weapon = kit.bone('weapon', b.handR);
  kit.mesh(new CylinderGeometry(0.013, 0.013, 0.62, 6), m.wood, weapon, [
    0, 0.12, 0,
  ]);
  kit.mesh(new ConeGeometry(0.024, 0.09, 6), m.steel, weapon, [0, 0.47, 0]);

  // Round shield with boss, on the left forearm.
  const shield = kit.bone('shield', b.forearmL, [0, -0.06, -0.055]);
  kit.mesh(new CylinderGeometry(0.155, 0.155, 0.018, 14), m.wood, shield, [
    0, 0, 0,
  ], [Math.PI / 2, 0, 0]);
  kit.mesh(new SphereGeometry(0.038, 8, 5), m.steel, shield, [0, 0, -0.016]);

  return kit.build('huscarl', faction, 0.9, {
    idle: {
      armL: [0.3, 0, -0.12],
      forearmL: [0.45, 0, 0],
      armR: [0.12, 0, -0.1],
      forearmR: [0.2, 0, 0],
    },
    guard: {
      armL: [0.85, 0, 0.1],
      forearmL: [0.5, 0, 0],
      armR: [0.6, 0, -0.15],
      forearmR: [0.9, 0, 0],
      spine: [0.12, 0, 0],
      head: [-0.1, 0, 0],
    },
    victory: {
      armR: [2.9, 0, -0.15],
      forearmR: [0.15, 0, 0],
      armL: [0.4, 0, 0.5],
      forearmL: [0.5, 0, 0],
      head: [-0.2, 0, 0],
    },
  });
}
