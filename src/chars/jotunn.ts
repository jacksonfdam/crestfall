/**
 * Jötunn (rook): stone giant with two forms in one rig. Idle is the
 * petrified tower — cracked shell segments under the towerShell bone, the
 * giant folded inside (fold rotations live in the idle pose). Duels unfold
 * by rotating limbs/spine/head out and lifting the hips; the crack gaps
 * between shell segments are where the tower splits.
 */

import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

export function buildJotunn(faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);

  const shell = kit.bone('towerShell', kit.root);
  const SEGS = 4;
  const GAP = 0.24;
  const sweep = (Math.PI * 2) / SEGS - GAP;
  for (let i = 0; i < SEGS; i++) {
    const theta = i * ((Math.PI * 2) / SEGS) + GAP / 2;
    kit.mesh(
      new CylinderGeometry(0.29, 0.335, 1.16, 4, 1, true, theta, sweep),
      m.stone,
      shell,
      [0, 0.58, 0],
    );
    const mid = theta + sweep / 2;
    kit.mesh(new BoxGeometry(0.17, 0.16, 0.09), m.stone, shell, [
      Math.sin(mid) * 0.265, 1.26, Math.cos(mid) * 0.265,
    ], [0, mid, 0]);
  }
  kit.mesh(new CylinderGeometry(0.315, 0.3, 0.08, 10), m.stone, shell, [
    0, 1.18, 0,
  ]);
  kit.mesh(new CylinderGeometry(0.335, 0.342, 0.1, 10), m.stone, shell, [
    0, 0.05, 0,
  ]);

  const b = buildHumanoid(kit, kit.root, {
    hipsY: 0.5,
    hipHalf: 0.14,
    thigh: { len: 0.44, r: 0.08 },
    shin: { len: 0.4, r: 0.068 },
    torso: { rTop: 0.18, rBot: 0.22, len: 0.44 },
    chestY: 0.37,
    shoulderX: 0.16,
    shoulderY: 0.04,
    neckY: 0.13,
    upperArm: { len: 0.32, r: 0.07 },
    forearm: { len: 0.28, r: 0.06 },
    headR: 0.13,
    torsoMat: m.stone,
    limbMat: m.stone,
    headMat: m.stone,
  });

  // Rune-scarred brow ridge and ember eyes.
  kit.mesh(new BoxGeometry(0.2, 0.05, 0.06), m.stone, b.head, [0, 0.14, -0.09]);
  for (const s of [1, -1] as const) {
    kit.mesh(new BoxGeometry(0.035, 0.02, 0.01), m.accent, b.head, [
      s * 0.055, 0.09, -0.125,
    ]);
    // Cracked shoulder plates.
    kit.mesh(new BoxGeometry(0.14, 0.1, 0.14), m.stone, b.chest, [
      s * 0.2, 0.11, 0,
    ], [0, 0, s * -0.25]);
  }
  kit.mesh(new SphereGeometry(0.09, 6, 5), m.stone, b.handL);
  kit.mesh(new SphereGeometry(0.09, 6, 5), m.stone, b.handR);

  const fold = {
    legL: [3.0, 0, 0.06],
    shinL: [-2.95, 0, 0],
    legR: [3.0, 0, -0.06],
    shinR: [-2.95, 0, 0],
  } as const;

  return kit.build('jotunn', faction, 1.4, {
    idle: {
      ...fold,
      spine: [0.08, 0, 0],
      head: [0.3, 0, 0],
      armL: [0.15, 0, -0.1],
      forearmL: [0.28, 0, -1.15],
      armR: [0.15, 0, 0.1],
      forearmR: [0.28, 0, 1.15],
    },
    guard: {
      legL: [1.5, 0, 0.15],
      shinL: [-1.5, 0, 0],
      legR: [1.5, 0, -0.15],
      shinR: [-1.5, 0, 0],
      armL: [0.8, 0, 0.4],
      forearmL: [0.9, 0, 0],
      armR: [0.8, 0, -0.4],
      forearmR: [0.9, 0, 0],
      head: [-0.1, 0, 0],
    },
    victory: {
      legL: [1.5, 0, 0.15],
      shinL: [-1.5, 0, 0],
      legR: [1.5, 0, -0.15],
      shinR: [-1.5, 0, 0],
      armL: [2.6, 0, 0.3],
      armR: [2.6, 0, -0.3],
      head: [-0.3, 0, 0],
    },
  });
}
