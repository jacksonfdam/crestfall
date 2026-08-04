/**
 * Völva (bishop): hooded seeress with a long iron staff and hanging
 * talismans. No face under the hood — only shadow.
 *
 * The robe is a revolved bell with pleat battens standing on it, which is
 * what separates a garment from a cone. Her silhouette divisor is the tilted
 * staff, not her body, so the hem may gain width freely — the hood apex and
 * the hem bottom are the two extremes that may not move.
 */

import { BoxGeometry, CylinderGeometry, TorusGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { extrude, lathe, polyShape, repeatRing } from './detail.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

export function buildVolva(faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);

  const b = buildHumanoid(kit, kit.root, {
    hipsY: 0.55,
    hipHalf: 0.05,
    thigh: { len: 0.27, r: 0.045 },
    shin: { len: 0.25, r: 0.038 },
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
    yoke: false,
    waist: 0.2,
    beltMat: m.hide,
  });

  // Floor-length robe: a revolved bell, hem exactly where the cylinder ended.
  // She does have legs — long enough to reach the board — but they are never
  // seen: they exist so travel can carry her with a step instead of sliding a
  // cone. The robe hangs off its own bone below the belt so the hem can swing
  // and trail a beat behind the hips rather than shearing rigidly with them.
  // The pivot sits AT the waist seam, not below it: swing a skirt from lower
  // down and its top rim slides out from under the belt, opening a notch in her
  // side at the top of every stride.
  const hem = kit.bone('hem', b.hips, [0, 0.02, 0]);
  kit.mesh(
    lathe(
      [
        [0.102, 0.045],
        [0.116, -0.09],
        [0.142, -0.28],
        [0.172, -0.45],
        [0.19, -0.53],
        [0.188, -0.56],
        [0, -0.552],
      ],
      12,
    ),
    m.cloth,
    hem,
    [0, -0.02, 0],
  );
  // Pleat battens: the vertical break-up that makes cloth read as cloth.
  repeatRing(
    kit,
    m.cloth,
    hem,
    (i) => new BoxGeometry(0.03, 0.44 - (i % 2) * 0.06, 0.016),
    { count: 9, radius: 0.163, y: -0.345, phase: 0.2 },
  );
  // Sleeve mouths, wide enough to hint at a hidden hand.
  for (const s of [1, -1] as const) {
    kit.mesh(
      lathe(
        [
          [0.036, 0.02],
          [0.05, -0.05],
          [0.056, -0.09],
          [0.05, -0.095],
        ],
        8,
      ),
      m.cloth,
      s === 1 ? b.armL : b.armR,
    );
  }

  // Deep hood: revolved cowl, brim, and a shadow disc where a face would be.
  kit.mesh(
    lathe(
      [
        [0, 0.195],
        [0.026, 0.176],
        [0.056, 0.135],
        [0.078, 0.082],
        [0.088, 0.036],
        [0.086, 0.008],
        [0.07, -0.012],
        [0.058, -0.016],
      ],
      10,
    ),
    m.cloth,
    b.head,
    [0, 0, 0.012],
  );
  kit.mesh(
    new CylinderGeometry(0.052, 0.058, 0.006, 12),
    m.void,
    b.head,
    [0, 0.05, -0.05],
    [Math.PI / 2, 0, 0],
  );
  // Cowl brim rolled forward, framing the shadow.
  kit.mesh(
    new TorusGeometry(0.056, 0.009, 4, 10, Math.PI * 1.2),
    m.cloth,
    b.head,
    [0, 0.052, -0.046],
    [Math.PI / 2, 0, -Math.PI * 0.6],
  );

  // Cloak down the back, broken into three folds.
  const cloak = kit.bone('cloak', b.chest, [0, 0.06, 0.07]);
  kit.mesh(new BoxGeometry(0.24, 0.5, 0.02), m.cloth, cloak, [0, -0.2, 0.02], [
    0.12,
    0,
    0,
  ]);
  for (const x of [-0.075, 0, 0.075] as const) {
    kit.mesh(new BoxGeometry(0.05, 0.47, 0.022), m.cloth, cloak, [
      x,
      -0.205,
      0.031,
    ]);
  }

  // Long iron staff: banded shaft, ring finial, hanging charm.
  const staff = kit.bone('staff', b.handR);
  kit.mesh(new CylinderGeometry(0.013, 0.016, 0.92, 8), m.steel, staff, [
    0, -0.14, 0,
  ]);
  for (const y of [0.05, -0.12, -0.32] as const) {
    kit.mesh(new CylinderGeometry(0.017, 0.017, 0.014, 8), m.mail, staff, [
      0,
      y,
      0,
    ]);
  }
  kit.mesh(new TorusGeometry(0.035, 0.008, 5, 12), m.steel, staff, [0, 0.36, 0]);
  kit.mesh(new CylinderGeometry(0.019, 0.014, 0.03, 8), m.steel, staff, [
    0, 0.322, 0,
  ]);
  kit.mesh(
    extrude(
      polyShape([
        [0, 0.019],
        [0.011, 0.006],
        [0.008, -0.017],
        [-0.008, -0.017],
        [-0.011, 0.006],
      ]),
      0.005,
    ),
    m.accent,
    staff,
    [0, 0.3, 0],
  );

  // Talismans on a belt cord: bone tags, incised.
  for (const [x, z, rot] of [
    [-0.07, -0.075, 0.3],
    [0.0, -0.095, 0.0],
    [0.07, -0.075, -0.3],
  ] as const) {
    kit.mesh(new CylinderGeometry(0.003, 0.003, 0.05, 4), m.hide, b.spine, [
      x,
      0.02,
      z,
    ]);
    kit.mesh(
      extrude(
        polyShape([
          [0, 0.017],
          [0.011, 0.008],
          [0.011, -0.012],
          [0, -0.018],
          [-0.011, -0.012],
          [-0.011, 0.008],
        ]),
        0.007,
      ),
      m.bone,
      b.spine,
      [x, -0.015, z],
      [0, rot, 0],
    );
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
