/**
 * Jötunn (rook): stone giant with two forms in one rig. Idle is the
 * petrified tower — cracked shell staves under the towerShell bone, the
 * giant folded inside (fold rotations live in the idle pose). Duels unfold
 * by rotating limbs/spine/head out and lifting the hips; the crack gaps
 * between staves are where the tower splits.
 *
 * Two invariants from scripts/smoke-chars.ts bound every change here. The
 * folded giant may not poke outside the shell's plan radius, so his stone
 * plates are revolved rather than rotated boxes — a rotated box bounds wider
 * than it looks. And his height/footprint ratio is squeezed between the
 * jarl's and the huscarl's, so the staves keep their radii and the
 * crenellation tops keep their height.
 */

import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { lathe, repeatRing } from './detail.ts';
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
    // Battered stave: two setbacks up the wall, like dressed stone courses.
    // Kept centred at y=0.58 — src/duels/jotunn.ts classifies the shell's
    // direct children by rest position, and a wall has to read as a wall.
    const wall = kit.mesh(
      lathe(
        [
          [0.338, -0.58],
          [0.336, -0.505],
          [0.323, -0.48],
          [0.32, -0.08],
          [0.307, -0.05],
          [0.304, 0.37],
          [0.293, 0.4],
          [0.29, 0.58],
        ],
        SEGS,
        theta,
        sweep,
      ),
      m.stone,
      shell,
      [0, 0.58, 0],
    );
    const mid = theta + sweep / 2;
    const merlon = kit.mesh(new BoxGeometry(0.17, 0.16, 0.09), m.stone, shell, [
      Math.sin(mid) * 0.265, 1.26, Math.cos(mid) * 0.265,
    ], [0, mid, 0]);
    // Ornament hangs off the wall and merlon meshes rather than off the shell,
    // so it travels with them when the tower parts and never confuses the
    // classifier.
    kit.mesh(new BoxGeometry(0.2, 0.03, 0.11), m.stone, merlon, [0, -0.094, 0]);
    kit.mesh(new BoxGeometry(0.05, 0.07, 0.05), m.stone, wall, [
      Math.sin(theta) * 0.29, 0.04, Math.cos(theta) * 0.29,
    ], [0, theta, 0.3]);
    // Runes cut into the stave, stacked into one inscription — marks at
    // scattered angles read as chipped stone rather than writing. Ash reads
    // them as carved shadow; ember lets its coal accent glow out of them.
    const runeMat = faction === 'ash' ? m.void : m.accent;
    for (let j = 0; j < 3; j++) {
      kit.mesh(
        new BoxGeometry(0.01, 0.042, 0.01),
        runeMat,
        wall,
        [Math.sin(mid) * 0.307, 0.24 - j * 0.075, Math.cos(mid) * 0.307],
        [0, mid, 0],
      );
      kit.mesh(
        new BoxGeometry(0.026, 0.009, 0.01),
        runeMat,
        wall,
        [Math.sin(mid) * 0.307, 0.255 - j * 0.075, Math.cos(mid) * 0.307],
        [0, mid, j === 1 ? -0.5 : 0.5],
      );
    }
  }
  kit.mesh(new CylinderGeometry(0.315, 0.3, 0.08, 12), m.stone, shell, [
    0, 1.18, 0,
  ]);
  kit.mesh(
    lathe(
      [
        [0.3, 0.0],
        [0.335, 0.01],
        [0.341, 0.055],
        [0.336, 0.1],
        [0.3, 0.105],
      ],
      12,
    ),
    m.stone,
    shell,
  );
  // Spalled rubble round the plinth: below the animated bands, so it sinks
  // with the root like the base ring does.
  repeatRing(
    kit,
    m.stone,
    shell,
    (i) => new BoxGeometry(0.07, 0.045 + (i % 3) * 0.012, 0.05),
    { count: 9, radius: 0.3, y: 0.036, phase: 0.35 },
  );

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
    hands: false,
    waist: 0.08,
  });

  // Rune-scarred brow ridge, ember eyes, slab jaw.
  kit.mesh(new BoxGeometry(0.2, 0.05, 0.06), m.stone, b.head, [0, 0.14, -0.09]);
  kit.mesh(new BoxGeometry(0.17, 0.07, 0.11), m.stone, b.head, [0, 0.02, -0.06]);
  for (const s of [1, -1] as const) {
    kit.mesh(new BoxGeometry(0.035, 0.02, 0.01), m.accent, b.head, [
      s * 0.055, 0.09, -0.125,
    ]);
  }
  // Shoulder plates: revolved so the folded pose stays inside the shell.
  for (const s of [1, -1] as const) {
    kit.mesh(
      lathe(
        [
          [0.03, 0.06],
          [0.072, 0.035],
          [0.086, -0.03],
          [0.078, -0.045],
          [0.03, -0.04],
        ],
        8,
      ),
      m.stone,
      b.chest,
      [s * 0.19, 0.1, 0],
    );
  }
  // Cracked chest course with ember seams showing through.
  kit.mesh(new BoxGeometry(0.24, 0.11, 0.14), m.stone, b.chest, [0, -0.03, -0.06]);
  kit.mesh(new BoxGeometry(0.016, 0.1, 0.012), m.accent, b.chest, [
    0.03, -0.03, -0.135,
  ], [0, 0, 0.24]);
  kit.mesh(new BoxGeometry(0.012, 0.06, 0.012), m.accent, b.chest, [
    -0.05, 0.02, -0.13,
  ], [0, 0, -0.3]);
  // Fists: a stone ball with knuckle crags.
  for (const hand of [b.handL, b.handR] as const) {
    kit.mesh(new SphereGeometry(0.09, 7, 6), m.stone, hand);
    repeatRing(kit, m.stone, hand, () => new BoxGeometry(0.038, 0.034, 0.034), {
      count: 3,
      radius: 0.075,
      y: -0.03,
      phase: 0.6,
    });
  }

  const fold = {
    legL: [3.0, 0, 0.06],
    shinL: [-2.95, 0, 0],
    legR: [3.0, 0, -0.06],
    shinR: [-2.95, 0, 0],
  } as const;
  const unfold = {
    legL: [1.5, 0, 0.15],
    shinL: [-1.5, 0, 0],
    legR: [1.5, 0, -0.15],
    shinR: [-1.5, 0, 0],
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
      ...unfold,
      armL: [0.8, 0, 0.4],
      forearmL: [0.9, 0, 0],
      armR: [0.8, 0, -0.4],
      forearmR: [0.9, 0, 0],
      head: [-0.1, 0, 0],
    },
    victory: {
      ...unfold,
      armL: [2.6, 0, 0.3],
      armR: [2.6, 0, -0.3],
      head: [-0.3, 0, 0],
    },
  });
}
