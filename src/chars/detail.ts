/**
 * Shared ornament and equipment builders.
 *
 * Everything here composes three primitives only — no assets, no textures —
 * and stays cheap: scripts/smoke-chars.ts asserts every rig under 6000
 * triangles, and a rank of eight huscarls has to read as a shield wall at
 * board scale. Helpers that need their own frame create a plain `Group`;
 * only rig.ts mints bones, so these stay inert under `setPose`.
 *
 * Profiles are `[radius, height]` pairs revolved around +Y. Lathes are the
 * workhorse: a five-point profile at twelve segments costs ~120 triangles
 * and buys the curvature that stacked cylinders cannot fake.
 */

import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Shape,
  SphereGeometry,
  Vector2,
} from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import type { RigKit, Vec3 } from './rig.ts';

export type Profile = readonly (readonly [number, number])[];

const ZERO: Vec3 = [0, 0, 0];

/**
 * Revolve a `[radius, height]` profile around +Y. `phiLength` under a full
 * turn leaves an open sector — the jötunn's shell staves.
 */
export function lathe(
  profile: Profile,
  segments = 12,
  phiStart = 0,
  phiLength = Math.PI * 2,
): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
    phiStart,
    phiLength,
  );
}

export function polyShape(
  points: readonly (readonly [number, number])[],
): Shape {
  const s = new Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

/** Thin extrusion, centred on its own depth so it reads either way round. */
export function extrude(shape: Shape, depth: number): ExtrudeGeometry {
  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 3,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/**
 * Lanceolate outline, tip at +Y, tang at -Y. Spear heads, sword blades and
 * feathers are all the same silhouette at different aspect ratios.
 */
export function leafShape(len: number, width: number, shoulder = 0.3): Shape {
  const w = width / 2;
  const top = len / 2;
  return polyShape([
    [0, top],
    [w * 0.62, top - len * shoulder * 0.5],
    [w, top - len * shoulder],
    [w * 0.5, -top + len * 0.06],
    [0, -top],
    [-w * 0.5, -top + len * 0.06],
    [-w, top - len * shoulder],
    [-w * 0.62, top - len * shoulder * 0.5],
  ]);
}

/** Bearded-axe crescent: cutting edge bowed away from the haft at x=0. */
export function crescentShape(span: number, drop: number): Shape {
  return polyShape([
    [0, drop * 0.5],
    [span * 0.45, drop * 0.62],
    [span, drop * 0.34],
    [span * 0.96, -drop * 0.24],
    [span * 0.55, -drop * 0.62],
    [0, -drop * 0.5],
    [span * 0.3, -drop * 0.18],
    [span * 0.3, drop * 0.2],
  ]);
}

/** Feather: a leaf with a slight sweep, thin enough to layer cheaply. */
export function featherShape(len: number, width: number): Shape {
  const w = width / 2;
  return polyShape([
    [0, len * 0.5],
    [w * 0.9, len * 0.16],
    [w, -len * 0.1],
    [w * 0.7, -len * 0.38],
    [0, -len * 0.5],
    [-w * 0.55, -len * 0.34],
    [-w * 0.8, -len * 0.06],
    [-w * 0.7, len * 0.2],
  ]);
}

interface RepeatOptions {
  count: number;
  radius: number;
  y?: number;
  /** Extra spin so a ring can be offset from the seam. */
  phase?: number;
  /** Tilt outward around the tangent, radians. */
  tilt?: number;
  /** Rotate each item to face outward. */
  face?: boolean;
}

/**
 * Place `count` copies of a geometry evenly around +Y. `make` is called per
 * index so items can vary; returning the same geometry twice is fine, the
 * kit disposes each once.
 */
export function repeatRing(
  kit: RigKit,
  mat: Material,
  parent: Object3D,
  make: (i: number) => BufferGeometry,
  o: RepeatOptions,
): void {
  const { count, radius, y = 0, phase = 0, tilt = 0, face = true } = o;
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    kit.mesh(
      make(i),
      mat,
      parent,
      [Math.sin(a) * radius, y, Math.cos(a) * radius],
      face ? [tilt * Math.cos(a), a, -tilt * Math.sin(a)] : [0, 0, 0],
    );
  }
}

/** Rivets or bosses around a circle. */
export function studRing(
  kit: RigKit,
  mat: Material,
  parent: Object3D,
  o: RepeatOptions & { size: number; kind?: 'sphere' | 'cone' },
): void {
  const { size, kind = 'sphere' } = o;
  repeatRing(
    kit,
    mat,
    parent,
    () =>
      kind === 'cone'
        ? new ConeGeometry(size, size * 2.1, 5)
        : new SphereGeometry(size, 6, 4),
    o,
  );
}

/**
 * Mail suggestion: shallow stacked bands. Reads as rows of rings at board
 * scale for a fraction of the cost of modelling any.
 */
export function mailBands(
  kit: RigKit,
  mat: Material,
  parent: Object3D,
  o: { rTop: number; rBot: number; len: number; y: number; rows: number; segments?: number },
): void {
  const { rTop, rBot, len, y, rows, segments = 10 } = o;
  const step = len / rows;
  for (let i = 0; i < rows; i++) {
    const f = (i + 0.5) / rows;
    const r = rBot + (rTop - rBot) * f;
    kit.mesh(
      new CylinderGeometry(r * 1.015, r * 1.05, step * 0.66, segments),
      mat,
      parent,
      [0, y - len / 2 + step * (i + 0.5), 0],
    );
  }
}

/**
 * Overlapping lamellar plates hanging from a waist ring — the skirt on the
 * huscarl and the valkyrie.
 */
export function lamellarSkirt(
  kit: RigKit,
  mat: Material,
  parent: Object3D,
  o: { count: number; radius: number; y: number; len: number; width: number; flare?: number },
): void {
  const { count, radius, y, len, width, flare = 0.22 } = o;
  repeatRing(
    kit,
    mat,
    parent,
    () => new BoxGeometry(width, len, 0.012),
    { count, radius: radius + 0.004, y: y - len / 2, tilt: -flare, face: true },
  );
}

/** Fur tufts: a skirt of stubby cones, used on pelts and mantles. */
export function furTufts(
  kit: RigKit,
  mat: Material,
  parent: Object3D,
  o: { count: number; radius: number; y: number; len: number; thickness: number; splay?: number },
): void {
  const { count, radius, y, len, thickness, splay = 0.55 } = o;
  repeatRing(
    kit,
    mat,
    parent,
    (i) => new ConeGeometry(thickness * (i % 2 ? 0.82 : 1), len * (i % 3 ? 1 : 0.78), 4),
    { count, radius, y, tilt: Math.PI - splay, face: true },
  );
}

/**
 * Domed round shield built in its own frame: the disc faces +Y, so the
 * caller rotates the returned group once to aim it. Boss, rolled rim,
 * rivets and a back grip.
 */
export function roundShield(
  kit: RigKit,
  m: { wood: Material; steel: Material; hide: Material },
  parent: Object3D,
  o: { r: number; studs?: number; pos?: Vec3; rot?: Vec3; segments?: number },
): Group {
  const { r, studs = 6, pos = ZERO, rot = ZERO, segments = 14 } = o;
  const g = new Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(g);

  const d = r * 0.17;
  kit.mesh(
    lathe(
      [
        [0, d],
        [r * 0.44, d * 0.78],
        [r * 0.82, d * 0.34],
        [r, 0.004],
        [r * 0.95, -r * 0.055],
        [r * 0.3, -r * 0.075],
        [0, -r * 0.07],
      ],
      segments,
    ),
    m.wood,
    g,
  );
  // Iron boss over the hand, and a rolled rim.
  kit.mesh(
    lathe(
      [
        [0, d * 1.62],
        [r * 0.14, d * 1.5],
        [r * 0.24, d * 1.06],
        [r * 0.26, d * 0.86],
      ],
      10,
    ),
    m.steel,
    g,
    [0, 0, 0],
  );
  kit.mesh(
    new CylinderGeometry(r * 1.012, r * 1.012, r * 0.075, segments, 1, true),
    m.steel,
    g,
    [0, -r * 0.028, 0],
  );
  studRing(kit, m.steel, g, {
    count: studs,
    radius: r * 0.68,
    y: d * 0.42,
    size: r * 0.055,
  });
  // Grip bar on the reverse.
  kit.mesh(new BoxGeometry(r * 1.1, 0.012, r * 0.1), m.hide, g, [0, -r * 0.1, 0]);
  return g;
}

/**
 * Socketed head for a spear or a sword: leaf blade, collar, optional
 * side lugs. Built along +Y from `y`.
 */
export function bladeHead(
  kit: RigKit,
  m: { steel: Material; wood: Material },
  parent: Object3D,
  o: { y: number; len: number; width: number; thickness: number; collar?: number; lugs?: number },
): void {
  const { y, len, width, thickness, collar = width * 0.62, lugs = 0 } = o;
  kit.mesh(extrude(leafShape(len, width, 0.34), thickness), m.steel, parent, [
    0,
    y + len / 2,
    0,
  ]);
  kit.mesh(
    lathe(
      [
        [collar * 0.42, -collar * 0.5],
        [collar * 0.5, -collar * 0.16],
        [collar * 0.46, collar * 0.5],
      ],
      8,
    ),
    m.steel,
    parent,
    [0, y, 0],
  );
  for (let i = 0; i < lugs; i++) {
    const s = i === 0 ? 1 : -1;
    kit.mesh(
      new BoxGeometry(width * 0.9, thickness * 1.4, thickness * 1.2),
      m.steel,
      parent,
      [s * width * 0.5, y + collar * 0.1, 0],
      [0, 0, s * 0.62],
    );
  }
}

/** Small faceted gem — crown settings, staff charms. */
export function gem(size: number): BufferGeometry {
  return new ConeGeometry(size, size * 1.7, 4);
}

/** Engraved rune ticks: a short run of thin marks along a face. */
export function runeMarks(
  kit: RigKit,
  mat: Material,
  parent: Object3D,
  o: { count: number; from: Vec3; step: Vec3; size: number },
): void {
  const { count, from, step, size } = o;
  for (let i = 0; i < count; i++) {
    kit.mesh(
      new BoxGeometry(size * (i % 2 ? 0.5 : 1), size * (i % 2 ? 1.5 : 1), size * 0.4),
      mat,
      parent,
      [from[0] + step[0] * i, from[1] + step[1] * i, from[2] + step[2] * i],
      [0, 0, i % 3 === 0 ? 0.4 : -0.25],
    );
  }
}
