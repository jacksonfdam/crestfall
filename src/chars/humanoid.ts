/**
 * Parametric biped used by huscarl, volva, valkyrie, jarl, and the berserkr
 * rider. Joint pivots at hips/knees/shoulders/elbows/wrists so bone rotation
 * articulates believably. Positive bone rotation.x swings a limb toward -Z,
 * the default facing.
 *
 * Proportion notes: the torso is two tapered sections meeting at a waist, so
 * the silhouette narrows where a belt would sit instead of reading as one
 * cone. Every hinge carries a joint ball sized to the thicker of the two
 * limbs it joins — without it a bent elbow shows the cylinder end caps.
 * Hands are fists with a thumb, feet are boots with a sole and a tapered
 * toe; both keep the extents of the primitives they replaced so the
 * idle-height and silhouette-ratio assertions in scripts/smoke-chars.ts
 * stay put.
 */

import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Material, Object3D } from 'three';
import { lathe } from './detail.ts';
import type { RigKit } from './rig.ts';

export interface HumanoidSpec {
  hipsY: number;
  hipHalf: number;
  thigh: { len: number; r: number };
  shin: { len: number; r: number };
  torso: { rTop: number; rBot: number; len: number };
  chestY: number;
  shoulderX: number;
  shoulderY: number;
  neckY: number;
  upperArm: { len: number; r: number };
  forearm: { len: number; r: number };
  headR: number;
  torsoMat: Material;
  limbMat: Material;
  headMat: Material;
  legs?: boolean;
  /** Waist pinch as a fraction of the narrower torso radius. */
  waist?: number;
  /** Belt band at the waist; omitted when undefined. */
  beltMat?: Material;
  /** Joint balls and boot soles. Defaults to `limbMat`. */
  jointMat?: Material;
  /** Fists with a thumb; false leaves a bare wrist ball. */
  hands?: boolean;
  /** Shoulder yoke wedges — reads as trapezius under mail or cloth. */
  yoke?: boolean;
  /** Jaw wedge under the skull. Off for hooded or fully helmed heads. */
  jaw?: boolean;
}

export interface HumanoidBones {
  hips: Object3D;
  spine: Object3D;
  chest: Object3D;
  head: Object3D;
  armL: Object3D;
  armR: Object3D;
  forearmL: Object3D;
  forearmR: Object3D;
  handL: Object3D;
  handR: Object3D;
}

const LIMB_SEG = 8;
const TORSO_SEG = 10;

export function buildHumanoid(
  kit: RigKit,
  parent: Object3D,
  s: HumanoidSpec,
): HumanoidBones {
  const joint = s.jointMat ?? s.limbMat;
  const hips = kit.bone('hips', parent, [0, s.hipsY, 0]);
  // Pelvis: a squat lathe rather than a box, so the hip line curves into the
  // thighs instead of showing a corner.
  kit.mesh(
    lathe(
      [
        [s.hipHalf * 0.7, -s.thigh.r * 0.9],
        [s.hipHalf * 1.22, -s.thigh.r * 0.4],
        [s.hipHalf * 1.3, s.thigh.r * 0.5],
        [s.hipHalf * 1.05, s.thigh.r * 0.95],
      ],
      TORSO_SEG,
    ),
    s.limbMat,
    hips,
  );

  if (s.legs !== false) {
    for (const side of ['L', 'R'] as const) {
      const x = side === 'L' ? s.hipHalf : -s.hipHalf;
      const leg = kit.bone(`leg${side}`, hips, [x, -0.02, 0]);
      kit.mesh(new SphereGeometry(s.thigh.r * 1.12, 7, 5), joint, leg);
      kit.mesh(
        new CylinderGeometry(s.thigh.r, s.thigh.r * 0.78, s.thigh.len, LIMB_SEG),
        s.limbMat,
        leg,
        [0, -s.thigh.len / 2, 0],
      );
      const shin = kit.bone(`shin${side}`, leg, [0, -s.thigh.len, 0]);
      // Knee ball hides the thigh/shin seam when the leg folds.
      kit.mesh(new SphereGeometry(s.shin.r * 1.18, 7, 5), joint, shin);
      kit.mesh(
        new CylinderGeometry(s.shin.r, s.shin.r * 0.72, s.shin.len, LIMB_SEG),
        s.limbMat,
        shin,
        [0, -s.shin.len / 2, 0],
      );
      boot(kit, s, joint, shin);
    }
  }

  const spine = kit.bone('spine', hips, [0, s.thigh.r * 0.8, 0]);
  const pinch = s.waist ?? 0.14;
  const rWaist = Math.min(s.torso.rTop, s.torso.rBot) * (1 - pinch);
  const waistY = s.torso.len * 0.42;
  kit.mesh(
    new CylinderGeometry(rWaist, s.torso.rBot, waistY, TORSO_SEG),
    s.torsoMat,
    spine,
    [0, waistY / 2, 0],
  );
  kit.mesh(
    new CylinderGeometry(s.torso.rTop, rWaist, s.torso.len - waistY, TORSO_SEG),
    s.torsoMat,
    spine,
    [0, waistY + (s.torso.len - waistY) / 2, 0],
  );
  if (s.beltMat) {
    kit.mesh(
      new CylinderGeometry(rWaist * 1.06, rWaist * 1.09, s.torso.len * 0.1, TORSO_SEG),
      s.beltMat,
      spine,
      [0, waistY, 0],
    );
  }
  const chest = kit.bone('chest', spine, [0, s.chestY, 0]);

  const mkArm = (side: 'L' | 'R') => {
    const sx = side === 'L' ? 1 : -1;
    const x = sx * s.shoulderX;
    if (s.yoke !== false) {
      // Trapezius wedge from the neck out to the shoulder ball.
      kit.mesh(
        new BoxGeometry(s.shoulderX * 0.92, s.upperArm.r * 1.5, s.torso.rTop * 1.35),
        s.torsoMat,
        chest,
        [x * 0.52, s.shoulderY + s.upperArm.r * 0.5, 0],
        [0, 0, sx * 0.2],
      );
    }
    const arm = kit.bone(`arm${side}`, chest, [x, s.shoulderY, 0]);
    kit.mesh(new SphereGeometry(s.upperArm.r * 1.3, 7, 5), s.torsoMat, arm);
    kit.mesh(
      new CylinderGeometry(s.upperArm.r, s.upperArm.r * 0.82, s.upperArm.len, LIMB_SEG),
      s.limbMat,
      arm,
      [0, -s.upperArm.len / 2, 0],
    );
    const forearm = kit.bone(`forearm${side}`, arm, [0, -s.upperArm.len, 0]);
    kit.mesh(new SphereGeometry(s.forearm.r * 1.24, 7, 5), joint, forearm);
    kit.mesh(
      new CylinderGeometry(s.forearm.r, s.forearm.r * 0.78, s.forearm.len, LIMB_SEG),
      s.limbMat,
      forearm,
      [0, -s.forearm.len / 2, 0],
    );
    const hand = kit.bone(`hand${side}`, forearm, [0, -s.forearm.len, 0]);
    if (s.hands === false) {
      kit.mesh(new SphereGeometry(s.forearm.r * 1.1, 6, 5), s.headMat, hand);
    } else {
      fist(kit, s, hand, sx);
    }
    return { arm, forearm, hand };
  };
  const l = mkArm('L');
  const r = mkArm('R');

  const head = kit.bone('head', chest, [0, s.neckY, 0]);
  kit.mesh(
    new CylinderGeometry(s.headR * 0.46, s.headR * 0.58, s.neckY * 0.9, 7),
    s.headMat,
    head,
    [0, -s.neckY * 0.4, 0],
  );
  // Skull: a lathe keeps the crown round and the base flat where the jaw
  // sits, which one sphere cannot do without extra rings.
  kit.mesh(
    lathe(
      [
        [0, s.headR * 1.02],
        [s.headR * 0.62, s.headR * 0.82],
        [s.headR * 0.98, s.headR * 0.16],
        [s.headR * 0.9, -s.headR * 0.52],
        [s.headR * 0.5, -s.headR * 0.94],
        [0, -s.headR * 1.0],
      ],
      TORSO_SEG,
    ),
    s.headMat,
    head,
    [0, s.headR * 0.7, 0],
  );
  if (s.jaw) {
    kit.mesh(
      new BoxGeometry(s.headR * 1.1, s.headR * 0.6, s.headR * 1.1),
      s.headMat,
      head,
      [0, s.headR * 0.26, -s.headR * 0.14],
    );
  }

  return {
    hips,
    spine,
    chest,
    head,
    armL: l.arm,
    armR: r.arm,
    forearmL: l.forearm,
    forearmR: r.forearm,
    handL: l.hand,
    handR: r.hand,
  };
}

/**
 * Closed fist with a thumb ridge. Sits inside the sphere it replaces so
 * gripped weapons keep their old alignment.
 */
function fist(kit: RigKit, s: HumanoidSpec, hand: Object3D, sx: number): void {
  const r = s.forearm.r;
  kit.mesh(
    new SphereGeometry(r * 1.1, 7, 5),
    s.headMat,
    hand,
    [0, 0, 0],
    [0, 0, 0],
    [1, 1.14, 0.86],
  );
  kit.mesh(
    new BoxGeometry(r * 0.5, r * 1.05, r * 0.62),
    s.headMat,
    hand,
    [sx * r * 0.76, r * 0.16, -r * 0.2],
    [0, 0, sx * 0.5],
  );
}

/**
 * Boot: flat sole, instep, toe cap, ankle cuff.
 *
 * Deliberately built from axis-aligned parts. `Box3.setFromObject` bounds the
 * transformed corners of each mesh's local box, so a rotated part inflates
 * the measured silhouette even when the geometry does not — and every extreme
 * here is load-bearing for the height and ratio assertions. The sole reaches
 * exactly as far down and forward as the single box this replaced.
 */
function boot(
  kit: RigKit,
  s: HumanoidSpec,
  soleMat: Material,
  shin: Object3D,
): void {
  const r = s.shin.r;
  const floor = -s.shin.len - r * 0.15;
  kit.mesh(
    new BoxGeometry(r * 1.9, r * 0.8, r * 2.5),
    s.limbMat,
    shin,
    [0, floor + r * 0.57, -r * 0.5],
  );
  kit.mesh(
    new BoxGeometry(r * 1.55, r * 0.46, r * 0.7),
    s.limbMat,
    shin,
    [0, floor + r * 0.42, -r * 1.9],
  );
  kit.mesh(
    new BoxGeometry(r * 2, r * 0.34, r * 3.2),
    soleMat,
    shin,
    [0, floor + r * 0.17, -r * 0.7],
  );
  kit.mesh(
    new CylinderGeometry(r * 1.18, r * 1.02, r * 0.55, 8),
    s.limbMat,
    shin,
    [0, -s.shin.len + r * 0.74, 0],
  );
}
