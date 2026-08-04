/**
 * Headless smoke test for src/chars: builds every character x faction x
 * {full, flat}, checks mandatory bones, triangle budget, and idle-pose
 * heights (full figures only — emblems are flat by design). Also guards
 * three silhouette/readability invariants: the folded jotunn stays inside
 * its tower shell, idle h/w ratios stay pairwise distinct, and emblem
 * strokes keep luminance contrast against the backing plate per faction.
 * Run: node --experimental-strip-types scripts/smoke-chars.ts
 */

import { Box3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { CharacterName, Faction } from '../src/core/contract.ts';
import type { BoneName } from '../src/core/stage.ts';
import { buildCharacter, CHARACTER_HEIGHTS } from '../src/chars/index.ts';
import { factionMaterials } from '../src/chars/materials.ts';

const NAMES: CharacterName[] = [
  'huscarl',
  'berserkr',
  'volva',
  'jotunn',
  'valkyrie',
  'jarl',
];
const FACTIONS: Faction[] = ['ash', 'ember'];
const MANDATORY: BoneName[] = ['root', 'hips', 'spine', 'head'];
const EXPECTED_EXTRA: Partial<Record<CharacterName, BoneName[]>> = {
  huscarl: ['armL', 'armR', 'legL', 'legR', 'weapon', 'shield'],
  berserkr: [
    'mount', 'mountHead', 'armL', 'armR', 'legL', 'legR', 'weapon',
    'mountLegFL', 'mountLegFR', 'mountLegBL', 'mountLegBR',
    'mountShinFL', 'mountShinFR', 'mountShinBL', 'mountShinBR',
  ],
  volva: ['staff', 'cloak', 'hem', 'armL', 'armR', 'legL', 'legR'],
  jotunn: ['towerShell', 'armL', 'armR', 'legL', 'legR', 'shinL', 'shinR'],
  valkyrie: ['wingL', 'wingR', 'weapon', 'shield', 'legL', 'legR'],
  jarl: ['weapon', 'cloak', 'legL', 'legR'],
};
const MAX_TRIS = 6000;
const HEIGHT_TOL = 0.1;

function triangles(root: Object3D): number {
  let tris = 0;
  root.traverse((o: Object3D) => {
    if (o instanceof Mesh) {
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return Math.round(tris);
}

function bboxHeight(root: Object3D): number {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  return size.y;
}

let failures = 0;
const fail = (msg: string): void => {
  failures++;
  console.error(`  FAIL ${msg}`);
};

const rows: string[][] = [
  ['character', 'faction', 'mode', 'tris', 'height', 'target', 'bones'],
];

for (const name of NAMES) {
  for (const faction of FACTIONS) {
    for (const flat of [false, true]) {
      const mode = flat ? 'flat' : 'full';
      const rig = buildCharacter(name, faction, { flat });

      for (const bone of MANDATORY) {
        if (!rig.bones[bone]) fail(`${name}/${faction}/${mode}: missing bone '${bone}'`);
      }
      if (!flat) {
        for (const bone of EXPECTED_EXTRA[name] ?? []) {
          if (!rig.bones[bone]) {
            fail(`${name}/${faction}/${mode}: missing bone '${bone}'`);
          }
        }
      }

      const tris = triangles(rig.root);
      if (tris >= MAX_TRIS) {
        fail(`${name}/${faction}/${mode}: ${tris} tris >= ${MAX_TRIS}`);
      }

      rig.setPose('victory');
      rig.setPose('guard');
      rig.setPose('idle');
      const h = bboxHeight(rig.root);
      const target = CHARACTER_HEIGHTS[name];
      if (!flat) {
        if (Math.abs(h - target) > target * HEIGHT_TOL) {
          fail(
            `${name}/${faction}/${mode}: height ${h.toFixed(3)} outside ` +
              `${target}±${(target * HEIGHT_TOL).toFixed(3)}`,
          );
        }
      }
      if (rig.height !== target) {
        fail(`${name}/${faction}/${mode}: rig.height ${rig.height} !== ${target}`);
      }

      rows.push([
        name,
        faction,
        mode,
        String(tris),
        h.toFixed(3),
        flat ? '—' : String(target),
        String(Object.keys(rig.bones).length),
      ]);
      rig.dispose();
    }
  }
}

const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) {
  console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '));
}

// Jotunn tower reading: in idle every folded-giant mesh must stay inside
// the shell's plan footprint.
{
  const rig = buildCharacter('jotunn', 'ash');
  rig.root.updateMatrixWorld(true);
  const shellMeshes = new Set<Object3D>();
  rig.bones.towerShell!.traverse((o: Object3D) => shellMeshes.add(o));
  const shellBox = new Box3().setFromObject(rig.bones.towerShell!);
  const shellR = Math.max(
    Math.abs(shellBox.min.x), Math.abs(shellBox.max.x),
    Math.abs(shellBox.min.z), Math.abs(shellBox.max.z),
  );
  rig.root.traverse((o: Object3D) => {
    if (!(o instanceof Mesh) || shellMeshes.has(o)) return;
    const b = new Box3().setFromObject(o);
    const r = Math.max(
      Math.hypot(b.min.x, b.min.z), Math.hypot(b.min.x, b.max.z),
      Math.hypot(b.max.x, b.min.z), Math.hypot(b.max.x, b.max.z),
    );
    if (r > shellR + 0.005) {
      fail(`jotunn idle: giant mesh at radius ${r.toFixed(3)} outside shell ${shellR.toFixed(3)}`);
    }
  });
  rig.dispose();
}

// Silhouette identity: idle height/width ratios pairwise distinct by ≥ 8%.
{
  const ratios: [CharacterName, number][] = NAMES.map((name) => {
    const rig = buildCharacter(name, 'ash');
    rig.root.updateMatrixWorld(true);
    const size = new Box3().setFromObject(rig.root).getSize(new Vector3());
    rig.dispose();
    return [name, size.y / Math.max(size.x, size.z)];
  });
  ratios.sort((a, b) => a[1] - b[1]);
  console.log(
    `\nratios: ${ratios.map(([n, r]) => `${n}=${r.toFixed(2)}`).join(' ')}`,
  );
  for (let i = 1; i < ratios.length; i++) {
    const [loName, lo] = ratios[i - 1];
    const [hiName, hi] = ratios[i];
    if (hi / lo < 1.08) {
      fail(
        `silhouette ratios collide: ${loName} ${lo.toFixed(3)} vs ` +
          `${hiName} ${hi.toFixed(3)} (< 8% apart)`,
      );
    }
  }
}

// 2D readability: every non-emissive emblem stroke must hold ≥ 3:1
// luminance contrast against the faction's backing plate.
{
  const lum = (m: MeshStandardMaterial): number =>
    0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
  for (const faction of FACTIONS) {
    const plate = factionMaterials(faction).plate;
    const plateL = lum(plate);
    for (const name of NAMES) {
      const rig = buildCharacter(name, faction, { flat: true });
      rig.root.traverse((o: Object3D) => {
        if (!(o instanceof Mesh)) return;
        const mat = o.material as MeshStandardMaterial;
        if (mat === plate) return;
        if (mat.emissiveIntensity > 0 && (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0)) return;
        const a = lum(mat) + 0.05;
        const b = plateL + 0.05;
        const contrast = Math.max(a, b) / Math.min(a, b);
        if (contrast < 3) {
          fail(
            `${name}/${faction}/flat: emblem stroke contrast ` +
              `${contrast.toFixed(2)}:1 < 3:1 vs plate`,
          );
        }
      });
      rig.dispose();
    }
  }
}

if (failures > 0) {
  // No @types/node in this project: an uncaught throw makes Node exit 1.
  throw new Error(`smoke-chars: ${failures} failure(s)`);
}
console.log('\nsmoke-chars: all checks passed');
