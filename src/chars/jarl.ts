/**
 * Jarl (king): the widest silhouette. Fur mantle over heavy shoulders,
 * crowned helm, greatsword held two-handed, point resting down.
 *
 * Width is the whole point of this piece, so the mantle is a revolved collar
 * with a tufted fringe rather than a plain drum. The crown apex is his
 * silhouette top and the greatsword sets his width — both stay put, because
 * his ratio has to sit between the völva's and the jötunn's.
 */

import { BoxGeometry, ConeGeometry, CylinderGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import {
  extrude,
  furTufts,
  gem,
  lathe,
  leafShape,
  mailBands,
  repeatRing,
} from './detail.ts';
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
    jointMat: m.hide,
    beltMat: m.gold,
    waist: 0.12,
  });

  // Mail under the tunic, showing at the hem and the sleeves.
  mailBands(kit, m.mail, b.spine, {
    rTop: 0.132,
    rBot: 0.146,
    len: 0.2,
    y: 0.1,
    rows: 4,
    segments: 12,
  });
  kit.mesh(
    lathe(
      [
        [0.148, 0.02],
        [0.16, -0.05],
        [0.168, -0.1],
        [0.162, -0.106],
        [0, -0.1],
      ],
      12,
    ),
    m.hide,
    b.hips,
    [0, -0.01, 0],
  );

  // Fur mantle: the widest line on the board, with a tufted fringe.
  const cloak = kit.bone('cloak', b.chest, [0, 0.1, 0]);
  kit.mesh(
    lathe(
      [
        [0.14, 0.075],
        [0.198, 0.03],
        [0.232, -0.04],
        [0.243, -0.09],
        [0.234, -0.1],
        [0.15, -0.088],
      ],
      12,
    ),
    m.hide,
    cloak,
  );
  furTufts(kit, m.hide, cloak, {
    count: 14,
    radius: 0.225,
    y: -0.085,
    len: 0.075,
    thickness: 0.03,
    splay: 0.5,
  });
  kit.mesh(new BoxGeometry(0.34, 0.5, 0.025), m.hide, cloak, [0, -0.3, 0.13], [
    0.08,
    0,
    0,
  ]);
  for (const x of [-0.11, 0, 0.11] as const) {
    kit.mesh(new BoxGeometry(0.07, 0.47, 0.028), m.hide, cloak, [
      x,
      -0.305,
      0.142,
    ]);
  }
  // Shoulder clasps holding the mantle closed.
  for (const s of [1, -1] as const) {
    kit.mesh(new CylinderGeometry(0.026, 0.026, 0.014, 8), m.gold, cloak, [
      s * 0.115, 0.055, -0.09,
    ]);
  }

  // Crowned helm: revolved cap, gold circlet, five points with settings.
  kit.mesh(
    lathe(
      [
        [0, 0.13],
        [0.026, 0.122],
        [0.052, 0.094],
        [0.066, 0.048],
        [0.068, 0.022],
        [0.058, 0.016],
      ],
      12,
    ),
    m.steel,
    b.head,
  );
  kit.mesh(new CylinderGeometry(0.071, 0.071, 0.045, 12), m.gold, b.head, [
    0, 0.125, 0,
  ]);
  kit.mesh(new CylinderGeometry(0.073, 0.073, 0.008, 12), m.accent, b.head, [
    0, 0.148, 0,
  ]);
  repeatRing(kit, m.gold, b.head, () => new ConeGeometry(0.014, 0.05, 4), {
    count: 5,
    radius: 0.062,
    y: 0.17,
    face: false,
  });
  repeatRing(kit, m.accent, b.head, () => gem(0.011), {
    count: 5,
    radius: 0.069,
    y: 0.128,
    phase: Math.PI / 5,
    face: false,
  });
  // Nasal bar and a mail collar under the crown.
  kit.mesh(new BoxGeometry(0.014, 0.05, 0.012), m.steel, b.head, [
    0, 0.058, -0.062,
  ]);
  kit.mesh(new BoxGeometry(0.09, 0.07, 0.05), m.hide, b.head, [0, -0.02, -0.035]);

  // Greatsword: fullered blade, long crossguard, wheel pommel.
  const weapon = kit.bone('weapon', b.handR);
  kit.mesh(new CylinderGeometry(0.016, 0.019, 0.16, 8), m.wood, weapon, [
    0, 0.05, 0,
  ]);
  for (let i = 0; i < 4; i++) {
    kit.mesh(new CylinderGeometry(0.0195, 0.0195, 0.012, 8), m.hide, weapon, [
      0,
      0.005 + i * 0.032,
      0,
    ]);
  }
  kit.mesh(
    lathe(
      [
        [0, 0.03],
        [0.019, 0.022],
        [0.028, 0.0],
        [0.019, -0.022],
        [0, -0.03],
      ],
      10,
    ),
    m.gold,
    weapon,
    [0, 0.14, 0],
  );
  kit.mesh(new BoxGeometry(0.2, 0.028, 0.034), m.steel, weapon, [0, -0.04, 0]);
  for (const s of [1, -1] as const) {
    kit.mesh(new BoxGeometry(0.026, 0.036, 0.036), m.gold, weapon, [
      s * 0.088, -0.04, 0,
    ]);
  }
  kit.mesh(extrude(leafShape(0.55, 0.055, 0.12), 0.016), m.steel, weapon, [
    0, -0.325, 0,
  ]);
  // Fuller: a darker channel down the middle of the blade.
  kit.mesh(new BoxGeometry(0.016, 0.44, 0.019), m.mail, weapon, [0, -0.31, 0]);
  kit.mesh(new ConeGeometry(0.03, 0.06, 4), m.steel, weapon, [0, -0.63, 0], [
    Math.PI,
    0,
    Math.PI / 4,
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
