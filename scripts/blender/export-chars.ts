/**
 * Dump src/chars to JSON for scripts/blender/build_chars.py.
 *
 * The Blender scene used to be a hand-port of these builders, which meant two
 * sources of truth drifting apart on every tweak. Instead this walks the rigs
 * three.js actually builds and bakes, per mesh: vertices, normals and
 * triangles flattened into the nearest ancestor bone's frame, plus its
 * material key. Geometry is faction-independent — only materials differ — so
 * each character is exported once with both palettes alongside.
 *
 * Everything stays in three's frame (Y up, facing -Z, metres); the importer
 * owns the conversion to Z up. Colours come out of `Color` already in linear
 * working space, which is what Blender wants.
 *
 * Run: node --experimental-strip-types scripts/blender/export-chars.ts > out.json
 */

import { Matrix3, Mesh } from 'three';
import type { Material, MeshStandardMaterial, Object3D } from 'three';
import type { CharacterName, Faction } from '../../src/core/contract.ts';
import type { BoneName, PoseName } from '../../src/core/stage.ts';
import {
  buildCharacter,
  CHARACTER_HEIGHTS,
  factionMaterials,
} from '../../src/chars/index.ts';

const NAMES: CharacterName[] = [
  'huscarl',
  'berserkr',
  'volva',
  'jotunn',
  'valkyrie',
  'jarl',
];
const FACTIONS: Faction[] = ['ash', 'ember'];
const POSES: PoseName[] = ['idle', 'guard', 'victory'];

const round = (v: number): number => Math.round(v * 1e6) / 1e6;

function materialKeys(faction: Faction): Map<Material, string> {
  const set = factionMaterials(faction) as unknown as Record<string, Material>;
  const map = new Map<Material, string>();
  for (const key of Object.keys(set)) map.set(set[key], key);
  return map;
}

interface PartOut {
  bone: string;
  /** Material key per faction — a builder may swap materials by faction. */
  mats: Record<string, string>;
  positions: number[];
  normals: number[];
  indices: number[];
}

/**
 * Material keys per mesh, in traversal order, for a faction other than the
 * one the geometry came from. Both rigs run the same code path, so the orders
 * line up; the caller asserts the counts match anyway.
 */
function materialsFor(name: CharacterName, faction: Faction): string[] {
  const rig = buildCharacter(name, faction);
  const keys = materialKeys(faction);
  const out: string[] = [];
  rig.root.traverse((o: Object3D) => {
    if (!(o instanceof Mesh)) return;
    const key = keys.get(o.material as Material);
    if (!key) throw new Error(`${name}/${faction}: unmapped material`);
    out.push(key);
  });
  rig.dispose();
  return out;
}

function exportCharacter(name: CharacterName) {
  const rig = buildCharacter(name, 'ash');
  const keys = materialKeys('ash');
  const byFaction = Object.fromEntries(
    FACTIONS.map((f) => [f, materialsFor(name, f)]),
  ) as Record<string, string[]>;

  const boneNames = Object.keys(rig.bones) as BoneName[];
  const boneOf = new Map<Object3D, string>();
  for (const bone of boneNames) boneOf.set(rig.bones[bone]!, bone);

  const zero = (): void => {
    for (const bone of boneNames) rig.bones[bone]!.rotation.set(0, 0, 0);
  };

  // Rest = every bone rotation at zero. Poses are pure rotations, so meshes
  // baked here stay correct under any pose the importer applies.
  zero();
  rig.root.updateMatrixWorld(true);

  const parentOf = new Map<string, string | null>();
  for (const bone of boneNames) {
    let p: Object3D | null = rig.bones[bone]!.parent;
    let found: string | null = null;
    while (p) {
      const n = boneOf.get(p);
      if (n) {
        found = n;
        break;
      }
      p = p.parent;
    }
    parentOf.set(bone, found);
  }

  const nearestBone = (o: Object3D): string => {
    let p: Object3D | null = o.parent;
    while (p) {
      const n = boneOf.get(p);
      if (n) return n;
      p = p.parent;
    }
    return 'root';
  };

  const parts: PartOut[] = [];
  const normalMatrix = new Matrix3();
  let missing = 0;
  rig.root.traverse((o: Object3D) => {
    if (!(o instanceof Mesh)) return;
    const bone = nearestBone(o);
    const local = rig.bones[bone as BoneName]!.matrixWorld
      .clone()
      .invert()
      .multiply(o.matrixWorld);
    normalMatrix.getNormalMatrix(local);

    const geo = o.geometry;
    const pos = geo.attributes.position;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const positions: number[] = [];
    const normals: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      positions.push(
        round(local.elements[0] * x + local.elements[4] * y + local.elements[8] * z + local.elements[12]),
        round(local.elements[1] * x + local.elements[5] * y + local.elements[9] * z + local.elements[13]),
        round(local.elements[2] * x + local.elements[6] * y + local.elements[10] * z + local.elements[14]),
      );
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      const e = normalMatrix.elements;
      let ox = e[0] * nx + e[3] * ny + e[6] * nz;
      let oy = e[1] * nx + e[4] * ny + e[7] * nz;
      let oz = e[2] * nx + e[5] * ny + e[8] * nz;
      const len = Math.hypot(ox, oy, oz) || 1;
      ox /= len;
      oy /= len;
      oz /= len;
      normals.push(round(ox), round(oy), round(oz));
    }
    const indices: number[] = [];
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) indices.push(geo.index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i);
    }
    const mat = keys.get(o.material as Material);
    if (!mat) missing++;
    const i = parts.length;
    const mats: Record<string, string> = {};
    for (const faction of FACTIONS) {
      mats[faction] = byFaction[faction][i] ?? mat ?? 'stone';
    }
    parts.push({ bone, mats, positions, normals, indices });
  });
  if (missing) {
    throw new Error(`${name}: ${missing} mesh(es) with an unmapped material`);
  }
  for (const faction of FACTIONS) {
    if (byFaction[faction].length !== parts.length) {
      throw new Error(
        `${name}/${faction}: ${byFaction[faction].length} meshes vs ` +
          `${parts.length} in the ash pass — traversal orders diverged`,
      );
    }
  }

  const poses: Record<string, Record<string, [number, number, number]>> = {};
  for (const pose of POSES) {
    zero();
    rig.setPose(pose);
    const table: Record<string, [number, number, number]> = {};
    for (const bone of boneNames) {
      const r = rig.bones[bone]!.rotation;
      table[bone] = [round(r.x), round(r.y), round(r.z)];
    }
    poses[pose] = table;
  }

  const bones = boneNames.map((bone) => {
    const p = rig.bones[bone]!.position;
    return {
      name: bone,
      parent: parentOf.get(bone) ?? null,
      pos: [round(p.x), round(p.y), round(p.z)] as [number, number, number],
    };
  });

  rig.dispose();
  return { height: CHARACTER_HEIGHTS[name], bones, poses, parts };
}

function exportMaterials(faction: Faction) {
  const set = factionMaterials(faction) as unknown as Record<
    string,
    MeshStandardMaterial
  >;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(set)) {
    const mat = set[key];
    out[key] = {
      // three keeps Color in linear working space, which is Blender's input.
      color: [round(mat.color.r), round(mat.color.g), round(mat.color.b)],
      roughness: round(mat.roughness),
      metalness: round(mat.metalness),
      emissive: [
        round(mat.emissive.r),
        round(mat.emissive.g),
        round(mat.emissive.b),
      ],
      emissiveIntensity: round(mat.emissiveIntensity),
    };
  }
  return out;
}

const payload = {
  version: 2,
  source: 'src/chars',
  space: { up: 'Y', facing: '-Z', unit: 'board square = 1' },
  materials: Object.fromEntries(
    FACTIONS.map((f) => [f, exportMaterials(f)]),
  ),
  characters: Object.fromEntries(NAMES.map((n) => [n, exportCharacter(n)])),
};

console.log(JSON.stringify(payload));
