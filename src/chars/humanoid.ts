/**
 * Parametric biped used by huscarl, volva, valkyrie, jarl, and the berserkr
 * rider. Joint pivots at hips/knees/shoulders/elbows/wrists so bone rotation
 * articulates believably. Positive bone rotation.x swings a limb toward -Z,
 * the default facing.
 */

import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';
import type { Material, Object3D } from 'three';
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

export function buildHumanoid(
  kit: RigKit,
  parent: Object3D,
  s: HumanoidSpec,
): HumanoidBones {
  const hips = kit.bone('hips', parent, [0, s.hipsY, 0]);
  kit.mesh(
    new BoxGeometry(s.hipHalf * 2.4, s.thigh.r * 1.6, s.thigh.r * 2.2),
    s.limbMat,
    hips,
  );

  if (s.legs !== false) {
    for (const side of ['L', 'R'] as const) {
      const x = side === 'L' ? s.hipHalf : -s.hipHalf;
      const leg = kit.bone(`leg${side}`, hips, [x, -0.02, 0]);
      kit.mesh(
        new CylinderGeometry(s.thigh.r, s.thigh.r * 0.8, s.thigh.len, 7),
        s.limbMat,
        leg,
        [0, -s.thigh.len / 2, 0],
      );
      const shin = kit.bone(`shin${side}`, leg, [0, -s.thigh.len, 0]);
      kit.mesh(
        new CylinderGeometry(s.shin.r, s.shin.r * 0.75, s.shin.len, 7),
        s.limbMat,
        shin,
        [0, -s.shin.len / 2, 0],
      );
      kit.mesh(
        new BoxGeometry(s.shin.r * 2, s.shin.r * 1.1, s.shin.r * 3.2),
        s.limbMat,
        shin,
        [0, -s.shin.len + s.shin.r * 0.4, -s.shin.r * 0.7],
      );
    }
  }

  const spine = kit.bone('spine', hips, [0, s.thigh.r * 0.8, 0]);
  kit.mesh(
    new CylinderGeometry(s.torso.rTop, s.torso.rBot, s.torso.len, 8),
    s.torsoMat,
    spine,
    [0, s.torso.len / 2, 0],
  );
  const chest = kit.bone('chest', spine, [0, s.chestY, 0]);

  const mkArm = (side: 'L' | 'R') => {
    const x = side === 'L' ? s.shoulderX : -s.shoulderX;
    const arm = kit.bone(`arm${side}`, chest, [x, s.shoulderY, 0]);
    kit.mesh(new SphereGeometry(s.upperArm.r * 1.25, 7, 5), s.torsoMat, arm);
    kit.mesh(
      new CylinderGeometry(s.upperArm.r, s.upperArm.r * 0.85, s.upperArm.len, 7),
      s.limbMat,
      arm,
      [0, -s.upperArm.len / 2, 0],
    );
    const forearm = kit.bone(`forearm${side}`, arm, [0, -s.upperArm.len, 0]);
    kit.mesh(
      new CylinderGeometry(s.forearm.r, s.forearm.r * 0.8, s.forearm.len, 7),
      s.limbMat,
      forearm,
      [0, -s.forearm.len / 2, 0],
    );
    const hand = kit.bone(`hand${side}`, forearm, [0, -s.forearm.len, 0]);
    kit.mesh(new SphereGeometry(s.forearm.r * 1.1, 6, 5), s.headMat, hand);
    return { arm, forearm, hand };
  };
  const l = mkArm('L');
  const r = mkArm('R');

  const head = kit.bone('head', chest, [0, s.neckY, 0]);
  kit.mesh(
    new CylinderGeometry(s.headR * 0.5, s.headR * 0.55, s.neckY * 0.9, 6),
    s.headMat,
    head,
    [0, -s.neckY * 0.4, 0],
  );
  kit.mesh(new SphereGeometry(s.headR, 8, 6), s.headMat, head, [0, s.headR * 0.7, 0]);

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
