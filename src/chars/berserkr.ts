/**
 * Berserkr (knight): axe-wielding rider fused with a shaggy northern horse.
 * Wolf pelt over the shoulders, twin bearded axes — one on the weapon bone,
 * its twin under handL.
 *
 * The horse is a revolved barrel with a sagging belly, a two-segment neck and
 * fetlocked legs, because a stack of plain cylinders reads as a sawhorse. The
 * pelt crest over the helm is his silhouette top and the tail-to-muzzle run is
 * his depth divisor; both stay where the first pass put them.
 */

import { BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Object3D } from 'three';
import type { Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { crescentShape, extrude, furTufts, lathe } from './detail.ts';
import { buildHumanoid } from './humanoid.ts';
import { factionMaterials, type FactionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

/** Bearded axe: haft, langets, crescent head. `s` mirrors the blade. */
function axe(
  kit: RigKit,
  m: FactionMaterials,
  parent: Object3D,
  s: 1 | -1,
): void {
  kit.mesh(new CylinderGeometry(0.011, 0.014, 0.3, 7), m.wood, parent, [
    0, 0.05, 0,
  ]);
  for (const y of [-0.04, 0.0] as const) {
    kit.mesh(new CylinderGeometry(0.0145, 0.0145, 0.016, 7), m.hide, parent, [
      0,
      y,
      0,
    ]);
  }
  // Socket collar plus two langets running down the haft.
  kit.mesh(new CylinderGeometry(0.019, 0.021, 0.05, 7), m.steel, parent, [
    0, 0.168, 0,
  ]);
  kit.mesh(new BoxGeometry(0.008, 0.06, 0.016), m.steel, parent, [
    s * -0.016, 0.118, 0,
  ]);
  kit.mesh(extrude(crescentShape(0.115, 0.13), 0.011), m.steel, parent, [
    s * -0.052, 0.168, 0,
  ], [0, s === 1 ? 0 : Math.PI, 0]);
}

export function buildBerserkr(faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);

  const mount = kit.bone('mount', kit.root, [0, 0.46, 0]);
  // Barrel: revolved so the belly sags and the flanks narrow to the rump.
  kit.mesh(
    lathe(
      [
        [0.118, 0.3],
        [0.146, 0.19],
        [0.156, 0.02],
        [0.152, -0.12],
        [0.132, -0.24],
        [0.118, -0.3],
      ],
      10,
    ),
    m.hide,
    mount,
    [0, 0.05, 0.02],
    [Math.PI / 2, 0, 0],
  );
  kit.mesh(new SphereGeometry(0.152, 9, 7), m.hide, mount, [0, 0.05, 0.28]);
  kit.mesh(new SphereGeometry(0.128, 9, 7), m.hide, mount, [0, 0.055, -0.235]);
  // Withers and croup: the two high points of a horse's back line.
  kit.mesh(new SphereGeometry(0.1, 8, 6), m.hide, mount, [0, 0.14, -0.16], [0, 0, 0], [
    1.05,
    0.62,
    1.5,
  ]);
  kit.mesh(new SphereGeometry(0.105, 8, 6), m.hide, mount, [0, 0.13, 0.2], [0, 0, 0], [
    1.05,
    0.6,
    1.45,
  ]);

  // Legs: thigh, cannon, fetlock, hoof — on their own bones, so the horse can
  // gallop instead of gliding on static hide. `mountLeg*` pivots at the
  // shoulder/stifle and `mountShin*` at the knee/hock; the standing rotation of
  // each part stays on its mesh, so a bone at zero is exactly the old pose and
  // bone.rotation.x is a clean fore/aft swing. F/B is front/back, L/R the
  // horse's own. (legL/legR belong to the RIDER.)
  for (const [side, x, z, front] of [
    ['FL', 0.09, -0.22, 1],
    ['FR', -0.09, -0.22, 1],
    ['BL', 0.09, 0.24, 0],
    ['BR', -0.09, 0.24, 0],
  ] as const) {
    const lean = front ? 0.01 : -0.01;
    const upper = kit.bone(`mountLeg${side}`, mount, [x, -0.04, z + lean]);
    kit.mesh(
      new CylinderGeometry(0.044, 0.03, 0.2, 7),
      m.hide,
      upper,
      [0, -0.1, 0],
      [front ? 0.06 : -0.08, 0, 0],
    );
    const lower = kit.bone(`mountShin${side}`, upper, [0, -0.2, -lean]);
    // Knee ball: without it a folded joint shows the cannon's end cap.
    kit.mesh(new SphereGeometry(0.03, 6, 5), m.hide, lower);
    kit.mesh(new CylinderGeometry(0.028, 0.021, 0.19, 7), m.hide, lower, [
      0, -0.09, 0,
    ]);
    kit.mesh(new SphereGeometry(0.026, 6, 5), m.hide, lower, [0, -0.175, 0]);
    kit.mesh(new CylinderGeometry(0.026, 0.03, 0.045, 6), m.void, lower, [
      0, -0.1975, 0,
    ]);
  }

  // Tail: docked root, falling switch.
  kit.mesh(new CylinderGeometry(0.03, 0.018, 0.14, 7), m.hide, mount, [
    0, 0.07, 0.33,
  ], [-0.9, 0, 0]);
  kit.mesh(new BoxGeometry(0.05, 0.3, 0.06), m.cloth, mount, [0, -0.02, 0.36], [
    -0.5,
    0,
    0,
  ]);

  // Saddle pad and girth.
  kit.mesh(
    lathe(
      [
        [0.06, 0.055],
        [0.115, 0.03],
        [0.13, -0.02],
        [0.125, -0.03],
      ],
      10,
    ),
    m.cloth,
    mount,
    [0, 0.13, 0.02],
    [Math.PI / 2, 0, 0],
  );
  kit.mesh(new CylinderGeometry(0.152, 0.152, 0.03, 10, 1, true), m.hide, mount, [
    0, 0.04, 0.02,
  ]);

  const mountHead = kit.bone('mountHead', mount, [0, 0.16, -0.28]);
  // Neck in two tapered segments, then the skull and muzzle.
  kit.mesh(new CylinderGeometry(0.062, 0.082, 0.15, 8), m.hide, mountHead, [
    0, 0.02, 0.01,
  ], [0.5, 0, 0]);
  kit.mesh(new CylinderGeometry(0.05, 0.064, 0.12, 8), m.hide, mountHead, [
    0, 0.115, -0.075,
  ], [0.72, 0, 0]);
  kit.mesh(
    lathe(
      [
        [0.03, 0.11],
        [0.046, 0.05],
        [0.048, -0.02],
        [0.04, -0.08],
        [0.03, -0.1],
      ],
      8,
    ),
    m.hide,
    mountHead,
    [0, 0.165, -0.17],
    [-(Math.PI / 2 + 0.35), 0, 0],
  );
  kit.mesh(new BoxGeometry(0.062, 0.05, 0.05), m.void, mountHead, [
    0, 0.135, -0.255,
  ]);
  for (const s of [1, -1] as const) {
    kit.mesh(new ConeGeometry(0.016, 0.05, 4), m.hide, mountHead, [
      s * 0.032, 0.225, -0.1,
    ], [-0.2, 0, s * 0.25]);
    kit.mesh(new SphereGeometry(0.009, 5, 4), m.void, mountHead, [
      s * 0.042, 0.18, -0.16,
    ]);
    // Bridle: cheek strap and noseband.
    kit.mesh(new BoxGeometry(0.008, 0.09, 0.008), m.hide, mountHead, [
      s * 0.043, 0.16, -0.15,
    ], [0.5, 0, 0]);
  }
  kit.mesh(new CylinderGeometry(0.049, 0.049, 0.009, 8), m.hide, mountHead, [
    0, 0.146, -0.212,
  ], [-(Math.PI / 2 + 0.35), 0, 0]);
  // Shaggy mane along the neck ridge.
  for (let i = 0; i < 5; i++) {
    kit.mesh(
      new ConeGeometry(0.032 - i * 0.002, 0.1 - i * 0.008, 4),
      m.cloth,
      mountHead,
      [0, 0.2 - i * 0.038, -0.05 + i * 0.05],
      [Math.PI - 0.5, 0, 0],
    );
  }

  const b = buildHumanoid(kit, mount, {
    hipsY: 0.28,
    hipHalf: 0.075,
    thigh: { len: 0.2, r: 0.04 },
    shin: { len: 0.19, r: 0.035 },
    torso: { rTop: 0.1, rBot: 0.12, len: 0.26 },
    chestY: 0.21,
    shoulderX: 0.13,
    shoulderY: 0.03,
    neckY: 0.09,
    upperArm: { len: 0.14, r: 0.036 },
    forearm: { len: 0.13, r: 0.032 },
    headR: 0.055,
    torsoMat: m.hide,
    limbMat: m.cloth,
    headMat: m.bone,
    jointMat: m.hide,
    beltMat: m.hide,
    waist: 0.1,
  });

  // Wolf pelt: mantle over the shoulders with a shaggy fringe, skull crest
  // over the helm.
  kit.mesh(
    lathe(
      [
        [0.075, 0.075],
        [0.126, 0.03],
        [0.142, -0.03],
        [0.134, -0.042],
        [0.08, -0.036],
      ],
      10,
    ),
    m.hide,
    b.chest,
    [0, 0.05, 0.02],
  );
  furTufts(kit, m.hide, b.chest, {
    count: 11,
    radius: 0.128,
    y: -0.006,
    len: 0.07,
    thickness: 0.028,
    splay: 0.42,
  });
  kit.mesh(new CylinderGeometry(0.058, 0.062, 0.05, 9), m.steel, b.head, [
    0, 0.075, 0,
  ]);
  // Wolf skull: snout forward, ears back. Sets the silhouette top.
  kit.mesh(new BoxGeometry(0.07, 0.05, 0.12), m.bone, b.head, [0, 0.12, -0.03]);
  kit.mesh(new ConeGeometry(0.026, 0.055, 4), m.bone, b.head, [
    0, 0.113, -0.105,
  ], [-Math.PI / 2, 0, 0]);
  for (const s of [1, -1] as const) {
    kit.mesh(new ConeGeometry(0.015, 0.04, 4), m.bone, b.head, [
      s * 0.026, 0.137, 0.012,
    ], [-0.3, 0, s * 0.3]);
  }

  const weapon = kit.bone('weapon', b.handR);
  axe(kit, m, weapon, 1);
  // Twin axe rides the left hand directly; duels animate handL.
  axe(kit, m, b.handL, -1);

  const seat = {
    legL: [0.55, 0, 0.45],
    shinL: [-1.0, 0, 0],
    legR: [0.55, 0, -0.45],
    shinR: [-1.0, 0, 0],
  } as const;

  return kit.build('berserkr', faction, 1.3, {
    idle: {
      ...seat,
      armL: [0.25, 0, 0.35],
      forearmL: [0.4, 0, 0],
      armR: [0.25, 0, -0.35],
      forearmR: [0.4, 0, 0],
      mountHead: [0.1, 0, 0],
    },
    guard: {
      ...seat,
      armL: [0.9, 0, 0.25],
      forearmL: [0.7, 0, 0],
      armR: [0.9, 0, -0.25],
      forearmR: [0.7, 0, 0],
      spine: [0.15, 0, 0],
      mountHead: [0.3, 0, 0],
    },
    victory: {
      ...seat,
      armL: [2.7, 0, 0.3],
      armR: [2.7, 0, -0.3],
      head: [-0.25, 0, 0],
      mountHead: [-0.3, 0, 0],
    },
  });
}
