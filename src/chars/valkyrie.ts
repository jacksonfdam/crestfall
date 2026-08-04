/**
 * Valkyrie (queen): tallest, slender silhouette. Feathered wings on
 * wingL/wingR, spear and small shield, winged helm.
 *
 * Each wing is a swept spar carrying a graded vane of overlapping feathers —
 * see the note above the wing loop for why that shape and not a radial fan.
 * `FAN` scales the whole wing off the shoulder: her height/width ratio has to
 * stay clear of the huscarl's by 8% in scripts/smoke-chars.ts, and the wings
 * are what set both numbers, so the span is tuned, not guessed.
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

  // Wings. A wing reads as a wing because of one thing: a solid leading edge
  // with a graded vane trailing off it, every feather lying the same way and
  // overlapping its neighbour. The fan this replaced rooted every quill at one
  // point and splayed them radially, which is the anatomy of a laurel wreath —
  // hence "they don't even look like wings".
  //
  // So: a spar sweeps out and back from the shoulder, and the feathers stand up
  // off it in near-parallel, lengthening toward the wrist and shortening again
  // at the tip. The span is spent upward rather than outward because
  // scripts/smoke-chars.ts pins her h/w ratio 8% clear of the huscarl's — going
  // wider costs the ratio, going taller buys it back.
  for (const s of [1, -1] as const) {
    const wing = kit.bone(s === 1 ? 'wingL' : 'wingR', b.chest, [
      s * 0.102,
      0.082,
      0.072,
    ]);
    // Spar: shoulder to elbow to wrist, out and back with a slight rise. This
    // is the leading edge, and the only structural line in the wing.
    kit.mesh(new CylinderGeometry(0.015, 0.0105, 0.115, 7), m.mail, wing, [
      s * 0.048, 0.032, 0.014,
    ], [0, 0, s * -1.18]);
    kit.mesh(new CylinderGeometry(0.0105, 0.007, 0.105, 7), m.mail, wing, [
      s * 0.135, 0.07, 0.05,
    ], [-0.38, 0, s * -1.22]);

    // Primaries: rooted along the spar, standing up and raked back. Spacing is
    // under half a feather's width, so the vane closes into a surface.
    const primaries = [
      { at: 0.06, len: 0.15, w: 0.085 },
      { at: 0.30, len: 0.2, w: 0.092 },
      { at: 0.52, len: 0.235, w: 0.096 },
      { at: 0.72, len: 0.245, w: 0.094 },
      { at: 0.88, len: 0.215, w: 0.086 },
      { at: 1.0, len: 0.17, w: 0.076 },
    ];
    for (const [i, f] of primaries.entries()) {
      // Root walks the spar; `FAN` scales the whole wing off the shoulder.
      const rx = (0.03 + 0.125 * f.at) * FAN;
      const ry = (0.02 + 0.075 * f.at) * FAN;
      const rz = (0.006 + 0.07 * f.at) * FAN;
      // Rake: the outer feathers lie back further, which curves the trailing
      // edge instead of leaving it a straight cut.
      const rake = 0.2 + 0.26 * f.at;
      const lift = 0.92 - 0.1 * f.at;
      kit.mesh(
        extrude(featherShape(f.len, f.w), 0.008),
        m.bone,
        wing,
        [
          rx + s * (f.len / 2) * 0.12,
          ry + (f.len / 2) * lift,
          rz + (f.len / 2) * 0.22,
        ],
        [rake, s * 0.52, s * (0.16 + 0.1 * f.at)],
      );
      // Secondary tucked behind each primary root, filling the inner vane.
      if (i < 4) {
        kit.mesh(
          extrude(featherShape(f.len * 0.62, f.w * 0.9), 0.007),
          m.cloth,
          wing,
          [
            rx + s * 0.012,
            ry + f.len * 0.28,
            rz + 0.024 + f.len * 0.1,
          ],
          [rake + 0.18, s * 0.52, s * (0.22 + 0.1 * f.at)],
        );
      }
    }

    // Coverts: a short overlapping row hiding every quill root, plus the
    // shoulder boss the whole wing appears to grow out of.
    for (let i = 0; i < 4; i++) {
      const u = i / 3;
      kit.mesh(
        extrude(featherShape(0.085, 0.062), 0.007),
        m.cloth,
        wing,
        [(0.026 + 0.1 * u) * FAN, (0.014 + 0.062 * u) * FAN - 0.008, (0.004 + 0.058 * u) * FAN - 0.016],
        [0.2 + 0.18 * u, s * 0.54, s * (0.2 + 0.12 * u)],
      );
    }
    kit.mesh(
      lathe(
        [
          [0.018, 0.034],
          [0.036, 0.0],
          [0.032, -0.034],
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
