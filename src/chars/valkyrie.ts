/**
 * Valkyrie (queen): tallest, slender silhouette. Feathered wings on
 * wingL/wingR, spear and small shield, winged helm.
 *
 * Each wing is a fan of cut feathers plus a row of coverts over the roots,
 * rather than three long slabs. `FAN` scales the whole fan: the wingtips are
 * the widest thing on the model, and her height/width ratio has to stay clear
 * of the huscarl's by 8% in scripts/smoke-chars.ts, so the span is tuned, not
 * guessed.
 */

import { BoxGeometry, CylinderGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import {
  bladeHead,
  extrude,
  featherShape,
  lamellarSkirt,
  lathe,
  roundShield,
} from './detail.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

/** Wingtip reach multiplier — see the ratio note above before touching. */
const FAN = 0.68;

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
    jointMat: m.mail,
    beltMat: m.gold,
    waist: 0.2,
  });

  // Scale cuirass over the ribs, then a skirt of hanging lamellar plates.
  kit.mesh(
    lathe(
      [
        [0.088, 0.16],
        [0.096, 0.09],
        [0.093, 0.0],
        [0.084, -0.06],
        [0.078, -0.08],
      ],
      12,
    ),
    m.steel,
    b.spine,
    [0, 0.09, 0],
  );
  kit.mesh(
    lathe(
      [
        [0.1, 0.02],
        [0.118, -0.06],
        [0.132, -0.1],
        [0.126, -0.105],
        [0, -0.1],
      ],
      10,
    ),
    m.cloth,
    b.hips,
    [0, -0.02, 0],
  );
  lamellarSkirt(kit, m.steel, b.hips, {
    count: 12,
    radius: 0.124,
    y: -0.05,
    len: 0.115,
    width: 0.05,
    flare: 0.16,
  });

  // Winged helm: revolved cap, cheek plates, swept crest wings.
  kit.mesh(
    lathe(
      [
        [0, 0.135],
        [0.024, 0.126],
        [0.048, 0.098],
        [0.06, 0.056],
        [0.062, 0.03],
        [0.052, 0.024],
      ],
      10,
    ),
    m.steel,
    b.head,
  );
  for (const s of [1, -1] as const) {
    kit.mesh(new BoxGeometry(0.014, 0.052, 0.034), m.steel, b.head, [
      s * 0.052, 0.052, -0.016,
    ]);
    kit.mesh(
      extrude(featherShape(0.082, 0.046), 0.007),
      m.bone,
      b.head,
      [s * 0.066, 0.112, 0.03],
      [0.5, 0, s * 0.95],
    );
  }

  // Wings: a fan of primaries with a row of coverts over the roots.
  for (const s of [1, -1] as const) {
    const wing = kit.bone(s === 1 ? 'wingL' : 'wingR', b.chest, [
      s * 0.085,
      0.115,
      0.09,
    ]);
    // Feathers wide enough to overlap into a vane. Narrow quills on a wide
    // fan read as a crown of blades, not a wing.
    const primaries = [
      { a: 0.5, len: 0.225, w: 0.115 },
      { a: 0.72, len: 0.245, w: 0.11 },
      { a: 0.95, len: 0.235, w: 0.105 },
      { a: 1.18, len: 0.2, w: 0.095 },
      { a: 1.4, len: 0.16, w: 0.085 },
    ];
    for (const [i, f] of primaries.entries()) {
      const reach = (f.len / 2 + 0.035) * FAN;
      kit.mesh(
        extrude(featherShape(f.len, f.w), 0.009),
        m.bone,
        wing,
        [s * Math.cos(f.a) * reach, Math.sin(f.a) * reach, 0.008 + i * 0.009],
        [0.1, s * 0.26, s * (f.a - Math.PI / 2)],
      );
    }
    // Leading edge: the wing's own bone, root out to the last quill.
    kit.mesh(
      new CylinderGeometry(0.014, 0.008, 0.19, 7),
      m.mail,
      wing,
      [s * 0.05, 0.08, -0.014],
      [0, 0, s * -0.7],
    );
    // Coverts: short overlapping feathers hiding where the primaries meet.
    for (const [i, a] of [0.62, 0.86, 1.1].entries()) {
      kit.mesh(
        extrude(featherShape(0.105, 0.075), 0.008),
        m.cloth,
        wing,
        [s * Math.cos(a) * 0.062, Math.sin(a) * 0.062, -0.014 - i * 0.007],
        [0.08, s * 0.22, s * (a - Math.PI / 2)],
      );
    }
    kit.mesh(
      lathe(
        [
          [0.018, 0.03],
          [0.032, 0.0],
          [0.03, -0.03],
        ],
        8,
      ),
      m.bone,
      wing,
    );
  }

  // Spear: banded shaft, winged lugs under a long leaf blade.
  const weapon = kit.bone('weapon', b.handR);
  kit.mesh(new CylinderGeometry(0.0125, 0.0145, 1.1, 8), m.wood, weapon, [
    0, -0.05, 0,
  ]);
  for (const y of [-0.1, -0.02, 0.06] as const) {
    kit.mesh(new CylinderGeometry(0.0165, 0.0165, 0.012, 8), m.gold, weapon, [
      0,
      y,
      0,
    ]);
  }
  bladeHead(kit, m, weapon, {
    y: 0.5,
    len: 0.12,
    width: 0.056,
    thickness: 0.009,
    collar: 0.034,
    lugs: 2,
  });
  kit.mesh(new CylinderGeometry(0.014, 0.008, 0.05, 8), m.steel, weapon, [
    0, -0.615, 0,
  ]);

  // Small round shield, centre-gripped in the left fist (see huscarl.ts): on
  // the hand it clears the lamellar, on the forearm it did not.
  const shield = kit.bone('shield', b.handL, [0, -0.025, -0.015]);
  roundShield(kit, m, shield, {
    r: 0.11,
    studs: 8,
    segments: 12,
    rot: [-Math.PI / 2, 0, 0],
  });

  return kit.build('valkyrie', faction, 1.5, {
    idle: {
      armR: [0.18, 0, -0.1],
      forearmR: [0.25, 0, 0],
      armL: [0.25, 0, 0.12],
      forearmL: [0.4, 0, 0],
      shield: [-0.65, 0, 0],
    },
    guard: {
      armR: [1.1, 0, -0.2],
      forearmR: [0.45, 0, 0],
      armL: [0.8, 0, 0.15],
      forearmL: [0.5, 0, 0],
      shield: [-1.3, 0, 0],
      wingL: [0, 0, 0.35],
      wingR: [0, 0, -0.35],
      spine: [0.1, 0, 0],
    },
    victory: {
      armR: [2.85, 0, -0.15],
      forearmR: [0.1, 0, 0],
      armL: [0.5, 0, 0.6],
      shield: [-0.98, 0, 0],
      wingL: [0, -0.2, 0.6],
      wingR: [0, 0.2, -0.6],
      head: [-0.2, 0, 0],
    },
  });
}
