/**
 * 2D-mode heraldry: one crisp extruded emblem per character, lying flat on
 * the square and read top-down. Emblem "up" points toward -Z (the facing
 * direction), matching the full figures.
 */

import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Shape } from 'three';
import type { Material, Object3D } from 'three';
import type { CharacterName, Faction } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';
import { factionMaterials, type FactionMaterials } from './materials.ts';
import { RigKit } from './rig.ts';

const DEPTH = 0.02;
const EXTRUDE = { depth: DEPTH, bevelEnabled: false, curveSegments: 6 };

function poly(points: readonly (readonly [number, number])[]): Shape {
  const s = new Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

function disc(r: number, rInner = 0): Shape {
  const s = new Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  if (rInner > 0) {
    const hole = new Shape();
    hole.absarc(0, 0, rInner, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  return s;
}

interface Plate {
  kit: RigKit;
  face: Group;
  shape(sh: Shape, mat: Material, z?: number, rotZ?: number): void;
  bar(
    mat: Material,
    w: number,
    l: number,
    cx: number,
    cy: number,
    angle?: number,
    z?: number,
  ): void;
}

function makePlate(kit: RigKit, spine: Object3D): Plate {
  const face = new Group();
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.005;
  spine.add(face);
  return {
    kit,
    face,
    shape(sh, mat, z = 0, rotZ = 0) {
      kit.mesh(new ExtrudeGeometry(sh, EXTRUDE), mat, face, [0, 0, z], [0, 0, rotZ]);
    },
    bar(mat, w, l, cx, cy, angle = 0, z = 0) {
      kit.mesh(new BoxGeometry(w, l, DEPTH), mat, face, [cx, cy, z + DEPTH / 2], [
        0,
        0,
        angle,
      ]);
    },
  };
}

type EmblemBuilder = (p: Plate, m: FactionMaterials) => void;

const axeHead: readonly (readonly [number, number])[] = [
  [0.02, 0.14],
  [0.13, 0.2],
  [0.16, 0.06],
  [0.06, 0.1],
  [0.02, 0.08],
];

const EMBLEMS: Record<CharacterName, EmblemBuilder> = {
  huscarl(p, m) {
    p.shape(disc(0.3, 0.23), m.wood);
    p.shape(disc(0.1), m.steel, DEPTH);
    p.bar(m.wood, 0.05, 0.56, 0, 0);
    p.bar(m.wood, 0.05, 0.56, 0, 0, Math.PI / 2);
  },
  berserkr(p, m) {
    for (const s of [1, -1] as const) {
      const g = new Group();
      g.rotation.z = s * 0.55;
      p.face.add(g);
      p.kit.mesh(new BoxGeometry(0.05, 0.6, DEPTH), m.wood, g, [0, 0, DEPTH / 2]);
      const head = poly(axeHead.map(([x, y]) => [s * x, y] as const));
      p.kit.mesh(new ExtrudeGeometry(head, EXTRUDE), m.steel, g, [0, 0.1, DEPTH]);
    }
  },
  volva(p, m) {
    p.bar(m.steel, 0.05, 0.62, 0, 0);
    p.bar(m.steel, 0.04, 0.26, -0.09, 0.18, 0.7);
    p.bar(m.steel, 0.04, 0.26, 0.09, 0.18, -0.7);
    p.bar(m.steel, 0.04, 0.22, -0.08, -0.1, -0.7);
    p.bar(m.steel, 0.04, 0.22, 0.08, -0.1, 0.7);
    p.shape(disc(0.06), m.accent, DEPTH, 0);
  },
  jotunn(p, m) {
    p.shape(
      poly([
        [-0.24, -0.3],
        [0.24, -0.3],
        [0.2, 0.12],
        [-0.2, 0.12],
      ]),
      m.stone,
    );
    for (const x of [-0.17, 0, 0.17]) p.bar(m.stone, 0.1, 0.16, x, 0.19, 0, 0);
    p.bar(m.plate, 0.02, 0.34, 0.04, -0.12, 0.12, DEPTH / 2);
  },
  valkyrie(p, m) {
    p.shape(
      poly([
        [0, 0.32],
        [0.09, 0.04],
        [0, -0.3],
        [-0.09, 0.04],
      ]),
      m.steel,
      DEPTH,
    );
    for (const s of [1, -1] as const) {
      p.shape(
        poly([
          [s * 0.06, 0.02],
          [s * 0.3, 0.14],
          [s * 0.26, -0.02],
          [s * 0.3, -0.06],
          [s * 0.22, -0.14],
          [s * 0.06, -0.12],
        ]),
        m.bone,
      );
    }
  },
  jarl(p, m) {
    p.shape(
      poly([
        [-0.045, 0.1],
        [0.045, 0.1],
        [0.02, -0.3],
        [-0.02, -0.3],
      ]),
      m.steel,
    );
    p.bar(m.steel, 0.24, 0.045, 0, 0.12);
    p.bar(m.wood, 0.04, 0.1, 0, 0.19);
    p.shape(disc(0.035), m.accent, 0, 0);
    p.bar(m.accent, 0.3, 0.05, 0, 0.28);
    for (const x of [-0.12, 0, 0.12]) {
      p.shape(
        poly([
          [x - 0.04, 0.3],
          [x + 0.04, 0.3],
          [x, 0.42],
        ]),
        m.accent,
      );
    }
  },
};

export function buildEmblem(name: CharacterName, faction: Faction): CharacterRig {
  const kit = new RigKit();
  const m = factionMaterials(faction);
  const hips = kit.bone('hips', kit.root);
  const spine = kit.bone('spine', hips);
  kit.bone('head', spine);
  const plate = makePlate(kit, spine);
  kit.mesh(new CylinderGeometry(0.36, 0.38, 0.01, 16), m.plate, spine, [0, 0, 0]);
  EMBLEMS[name](plate, m);
  return kit.build(name, faction, HEIGHTS[name], {
    idle: {},
    victory: {},
    guard: {},
  });
}

export const HEIGHTS: Record<CharacterName, number> = {
  huscarl: 0.9,
  berserkr: 1.3,
  volva: 1.15,
  jotunn: 1.4,
  valkyrie: 1.5,
  jarl: 1.35,
};
