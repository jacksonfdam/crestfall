/**
 * Shared rig scaffolding. Bones are plain Groups whose origins sit at the
 * joints; meshes hang under them, so rotating a bone articulates the limb.
 * setPose snaps every bone: pose entry, else idle entry, else zero.
 */

import { Group, Mesh } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import type { CharacterName, Faction } from '../core/contract.ts';
import type { BoneName, CharacterRig, PoseName } from '../core/stage.ts';

export type Vec3 = readonly [number, number, number];
export type PoseTable = Record<
  PoseName,
  Partial<Record<BoneName, Vec3>>
>;

const ZERO: Vec3 = [0, 0, 0];

export class RigKit {
  readonly root = new Group();
  readonly bones: Partial<Record<BoneName, Object3D>> = {};
  private readonly geometries: BufferGeometry[] = [];

  bone(name: BoneName, parent: Object3D, pos: Vec3 = ZERO): Group {
    const g = new Group();
    g.name = name;
    g.position.set(pos[0], pos[1], pos[2]);
    parent.add(g);
    this.bones[name] = g;
    return g;
  }

  mesh(
    geo: BufferGeometry,
    mat: Material,
    parent: Object3D,
    pos: Vec3 = ZERO,
    rot: Vec3 = ZERO,
    scale?: Vec3,
  ): Mesh {
    this.geometries.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    parent.add(m);
    return m;
  }

  build(
    name: CharacterName,
    faction: Faction,
    height: number,
    poses: PoseTable,
  ): CharacterRig {
    const { bones, geometries, root } = this;
    root.name = `${name}-${faction}`;
    bones.root = root;
    const setPose = (pose: PoseName): void => {
      const table = poses[pose];
      const idle = poses.idle;
      for (const key of Object.keys(bones) as BoneName[]) {
        // The renderer owns root orientation (per-side facing); poses may not
        // reset it unless they claim it explicitly.
        if (key === 'root' && !table[key] && !idle[key]) continue;
        const r = table[key] ?? idle[key] ?? ZERO;
        bones[key]!.rotation.set(r[0], r[1], r[2]);
      }
    };
    setPose('idle');
    return {
      name,
      faction,
      root,
      bones,
      height,
      setPose,
      dispose(): void {
        for (const g of geometries) g.dispose();
        geometries.length = 0;
      },
    };
  }
}
