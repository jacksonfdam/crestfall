/**
 * Huscarl (pawn): round-shield spearman. Conical nasal helm, mail hauberk in
 * riveted rows, domed and studded shield; a rank of eight reads as a shield
 * wall — shield forward-left, spear upright.
 *
 * The helm apex and the shield rim are the silhouette extremes the smoke test
 * measures, so both stay exactly where the first pass put them.
 */

import { BoxGeometry, ConeGeometry, CylinderGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { bladeHead, lathe, mailBands, roundShield, studRing } from './detail.ts';
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
    torsoMat: m.mail,
    limbMat: m.cloth,
    headMat: m.bone,
    jointMat: m.hide,
    beltMat: m.hide,
    waist: 0.17,
  });

  // Hauberk: riveted rows over the ribs, flared skirt below the belt.
  mailBands(kit, m.mail, b.spine, {
    rTop: 0.092,
    rBot: 0.113,
    len: 0.28,
    y: 0.15,
    rows: 6,
  });
  kit.mesh(
    lathe(
      [
        [0.112, 0.07],
        [0.128, 0.012],
        [0.142, -0.045],
        [0.145, -0.066],
        [0.138, -0.07],
        [0, -0.068],
      ],
      10,
    ),
    m.mail,
    b.spine,
    [0, -0.03, 0],
  );
  // Doubled mail over the shoulders — the shield-wall read at rank scale.
  kit.mesh(
    lathe(
      [
        [0.058, 0.062],
        [0.108, 0.03],
        [0.132, -0.026],
        [0.126, -0.036],
        [0, -0.03],
      ],
      10,
    ),
    m.mail,
    b.chest,
    [0, 0.028, 0],
  );

  // Conical nasal helm: one revolved shell, brow band, nasal, cheek plates.
  kit.mesh(
    lathe(
      [
        [0, 0.17],
        [0.019, 0.152],
        [0.042, 0.112],
        [0.06, 0.062],
        [0.066, 0.03],
        [0.067, 0.022],
        [0.058, 0.02],
        [0, 0.024],
      ],
      10,
    ),
    m.steel,
    b.head,
  );
  kit.mesh(
    new CylinderGeometry(0.0685, 0.0685, 0.016, 10, 1, true),
    m.mail,
    b.head,
    [0, 0.032, 0],
  );
  kit.mesh(new BoxGeometry(0.013, 0.058, 0.011), m.steel, b.head, [
    0, 0.044, -0.059,
  ]);
  for (const s of [1, -1] as const) {
    kit.mesh(new BoxGeometry(0.012, 0.05, 0.03), m.steel, b.head, [
      s * 0.058, 0.035, -0.03,
    ]);
  }
  // Mail aventail hanging off the helm rim.
  kit.mesh(
    lathe(
      [
        [0.066, 0.02],
        [0.07, -0.006],
        [0.072, -0.03],
        [0.066, -0.034],
      ],
      10,
    ),
    m.mail,
    b.head,
  );

  // Short spear: shaft, bound grip, socketed leaf head, butt cap.
  const weapon = kit.bone('weapon', b.handR);
  kit.mesh(new CylinderGeometry(0.0125, 0.0135, 0.62, 8), m.wood, weapon, [
    0, 0.12, 0,
  ]);
  for (const y of [0.05, 0.085]) {
    kit.mesh(new CylinderGeometry(0.0155, 0.0155, 0.018, 8), m.hide, weapon, [
      0, y, 0,
    ]);
  }
  bladeHead(kit, m, weapon, {
    y: 0.425,
    len: 0.09,
    width: 0.05,
    thickness: 0.009,
    collar: 0.032,
  });
  kit.mesh(new ConeGeometry(0.016, 0.03, 6), m.steel, weapon, [0, -0.2, 0], [
    Math.PI,
    0,
    0,
  ]);

  // Round shield: domed boards, iron boss, rolled rim, rivets.
  //
  // Centre-grip, on the HAND and not the forearm. roundShield puts its grip bar
  // on the reverse of the boss — which is how a Viking round shield is actually
  // carried — and the fist sits far enough out from the ribs that a 0.155 rim
  // clears the hauberk. Strapped to the forearm the disc rode straight through
  // the mail skirt at rest. `shield`'s own rotation cancels the arm's carry
  // angle, so the boards hang vertical instead of tipping with the elbow.
  const shield = kit.bone('shield', b.handL, [0, -0.03, -0.02]);
  const face = roundShield(kit, m, shield, {
    r: 0.155,
    studs: 6,
    rot: [-Math.PI / 2, 0, 0],
  });
  // Painted quarter battens, echoing the cross on the 2D emblem.
  for (const rot of [0, Math.PI / 2] as const) {
    kit.mesh(new BoxGeometry(0.018, 0.006, 0.29), m.hide, face, [0, 0.021, 0], [
      0,
      rot,
      0,
    ]);
  }
  studRing(kit, m.steel, face, {
    count: 10,
    radius: 0.141,
    y: 0.008,
    size: 0.0075,
  });

  return kit.build('huscarl', faction, 0.9, {
    idle: {
      // Shield carried up across the front — the rest pose of a man in a
      // shield wall. The forearm angle and the shield's counter-rotation are
      // measured, not eyeballed: they are the pair that keeps the rim clear of
      // the mail (56mm at the worst vertex) while leaving his height/footprint
      // ratio 9.6% off its nearest neighbour, which scripts/smoke-chars.ts
      // requires to stay above 8%.
      armL: [0.3, 0, -0.15],
      forearmL: [1.1, 0, 0],
      shield: [-1.4, 0, 0],
      armR: [0.12, 0, -0.1],
      forearmR: [0.2, 0, 0],
    },
    guard: {
      // No shield entry: idle's -1.3 is within 0.05 rad of upright here too.
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
      shield: [-0.95, 0, 0],
      head: [-0.2, 0, 0],
    },
  });
}
