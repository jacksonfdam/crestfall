/**
 * Headless smoke test for src/duels/jotunn.ts (the petrify/unfold helpers):
 * - samples unfold/fold/crumble at t = 0, 0.33, 0.66, 1 (plus a fine sweep)
 *   and asserts every world matrix stays finite (no NaNs);
 * - asserts unfold(1) lifts the hips world-Y above the tower-form hips Y;
 * - asserts unfold(0) and fold(1) restore the built rig's rest transforms
 *   exactly (setPose cannot reseat shell meshes — the helpers must);
 * - asserts the seams are open by JOTUNN_BEATS.part (clipping handoff);
 * - asserts crumble(1) sinks the root below y=0 and the whole heap below
 *   the board plane.
 * Run: node --experimental-strip-types scripts/smoke-jotunn.ts
 */

import { Box3, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { buildCharacter } from '../src/chars/index.ts';
import {
  crumbleJotunn,
  foldJotunn,
  JOTUNN_BEATS,
  unfoldJotunn,
} from '../src/duels/jotunn.ts';

let failures = 0;
const fail = (msg: string): void => {
  failures++;
  console.error(`  FAIL ${msg}`);
};

// ── Beats sanity ─────────────────────────────────────────────────────────────

const { shudder, part, limbs } = JOTUNN_BEATS;
if (!(shudder > 0 && shudder < part && part < limbs && limbs < 1)) {
  fail(`JOTUNN_BEATS not ordered in (0,1): ${JSON.stringify(JOTUNN_BEATS)}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Rest {
  p: Vector3;
  q: Quaternion;
  s: Vector3;
}

function snapshot(root: Object3D): Map<Object3D, Rest> {
  const map = new Map<Object3D, Rest>();
  root.traverse((o: Object3D) => {
    map.set(o, {
      p: o.position.clone(),
      q: o.quaternion.clone(),
      s: o.scale.clone(),
    });
  });
  return map;
}

function compareToSnapshot(
  root: Object3D,
  snap: Map<Object3D, Rest>,
  label: string,
  eps = 1e-5,
): void {
  root.traverse((o: Object3D) => {
    const rest = snap.get(o);
    if (!rest) {
      fail(`${label}: node '${o.name}' not in rest snapshot`);
      return;
    }
    if (o.position.distanceTo(rest.p) > eps) {
      fail(
        `${label}: '${o.name || o.type}' position drifted by ` +
          o.position.distanceTo(rest.p).toFixed(6),
      );
    }
    if (Math.abs(Math.abs(o.quaternion.dot(rest.q)) - 1) > eps) {
      fail(`${label}: '${o.name || o.type}' rotation drifted`);
    }
    if (o.scale.distanceTo(rest.s) > eps) {
      fail(`${label}: '${o.name || o.type}' scale drifted`);
    }
  });
}

function assertFinite(root: Object3D, label: string): void {
  root.updateMatrixWorld(true);
  let bad = 0;
  root.traverse((o: Object3D) => {
    for (const v of o.matrixWorld.elements) {
      if (!Number.isFinite(v)) {
        bad++;
        return;
      }
    }
  });
  if (bad > 0) fail(`${label}: ${bad} node(s) with non-finite world matrices`);
}

const V = new Vector3();

// ── NaN sweep: sample every function at the required ts plus a fine sweep ───

const FNS = [
  ['unfold', unfoldJotunn],
  ['fold', foldJotunn],
  ['crumble', crumbleJotunn],
] as const;
const REQUIRED_TS = [0, 0.33, 0.66, 1];
const SWEEP_TS = Array.from({ length: 21 }, (_, i) => i / 20);

for (const [name, fn] of FNS) {
  const rig = buildCharacter('jotunn', 'ash');
  for (const t of [...REQUIRED_TS, ...SWEEP_TS]) {
    fn(rig, t);
    assertFinite(rig.root, `${name}(t=${t})`);
  }
  // Out-of-range ts must clamp, not explode.
  fn(rig, -0.5);
  assertFinite(rig.root, `${name}(t=-0.5)`);
  fn(rig, 1.5);
  assertFinite(rig.root, `${name}(t=1.5)`);
  rig.dispose();
}

// ── Unfold: hips rise above tower form, seams open by the part beat ─────────

{
  const rig = buildCharacter('jotunn', 'ember');
  rig.setPose('idle');
  rig.root.updateMatrixWorld(true);
  const towerHipsY = rig.bones.hips!.getWorldPosition(V).y;

  // Seams must be visibly parted at JOTUNN_BEATS.part so the limbs never
  // swing through intact shell geometry (chars-critic clipping handoff).
  unfoldJotunn(rig, part);
  const shell = rig.bones.towerShell!;
  for (const child of shell.children) {
    const y = child.position.y;
    const isWall = y > 0.2 && y < 1.0 && Math.hypot(child.position.x, child.position.z) >= 0;
    if (!isWall) continue;
    const radial = Math.hypot(child.position.x, child.position.z);
    if (radial < 0.25) {
      fail(`unfold(t=part): wall only ${radial.toFixed(3)} off-axis (< 0.25)`);
    }
  }

  unfoldJotunn(rig, 1);
  rig.root.updateMatrixWorld(true);
  const unfoldedHipsY = rig.bones.hips!.getWorldPosition(V).y;
  if (!(unfoldedHipsY > towerHipsY)) {
    fail(
      `unfold(1): hips world-Y ${unfoldedHipsY.toFixed(3)} not above ` +
        `tower-form ${towerHipsY.toFixed(3)}`,
    );
  }
  console.log(
    `hips world-Y: tower ${towerHipsY.toFixed(3)} -> unfolded ${unfoldedHipsY.toFixed(3)}`,
  );
  rig.dispose();
}

// ── Endpoint hygiene: unfold(0) and fold(1) equal the built rest state ──────

{
  const rig = buildCharacter('jotunn', 'ash');
  rig.setPose('idle');
  const rest = snapshot(rig.root);

  unfoldJotunn(rig, 0);
  compareToSnapshot(rig.root, rest, 'unfold(0) vs rest');

  // Drive through a messy sampling order, then land on fold(1): the tower
  // must reseat EXACTLY (a surviving jotunn ends here before setPose).
  unfoldJotunn(rig, 0.4);
  unfoldJotunn(rig, 1);
  foldJotunn(rig, 0.2);
  foldJotunn(rig, 0.87);
  foldJotunn(rig, 1);
  compareToSnapshot(rig.root, rest, 'fold(1) vs rest');
  rig.dispose();
}

// ── Fold(0) === unfold(1): scripts can hand off between the two ─────────────

{
  const a = buildCharacter('jotunn', 'ash');
  const b = buildCharacter('jotunn', 'ash');
  unfoldJotunn(a, 1);
  foldJotunn(b, 0);
  const listOf = (root: Object3D): Object3D[] => {
    const out: Object3D[] = [];
    root.traverse((o: Object3D) => out.push(o));
    return out;
  };
  const la = listOf(a.root);
  const lb = listOf(b.root);
  if (la.length !== lb.length) {
    fail(`fold(0) vs unfold(1): node counts differ (${la.length} vs ${lb.length})`);
  } else {
    const eps = 1e-4;
    for (let i = 0; i < la.length; i++) {
      const oa = la[i];
      const ob = lb[i];
      if (
        oa.position.distanceTo(ob.position) > eps ||
        Math.abs(Math.abs(oa.quaternion.dot(ob.quaternion)) - 1) > eps ||
        oa.scale.distanceTo(ob.scale) > eps
      ) {
        fail(`fold(0) vs unfold(1): node #${i} '${oa.name || oa.type}' differs`);
      }
    }
  }
  a.dispose();
  b.dispose();
}

// ── Crumble: t=1 sinks the root (and the whole heap) below the board ────────

{
  const rig = buildCharacter('jotunn', 'ember');
  crumbleJotunn(rig, 1);
  const rootY = rig.bones.root!.position.y;
  if (!(rootY < 0)) fail(`crumble(1): root y ${rootY.toFixed(3)} not below 0`);
  rig.root.updateMatrixWorld(true);
  const top = new Box3().setFromObject(rig.root).max.y;
  if (!(top < 0)) {
    fail(`crumble(1): heap top ${top.toFixed(3)} still above the board plane`);
  }
  console.log(`crumble(1): root y ${rootY.toFixed(3)}, heap top ${top.toFixed(3)}`);
  rig.dispose();
}

if (failures > 0) {
  // No @types/node in this project: an uncaught throw makes Node exit 1.
  throw new Error(`smoke-jotunn: ${failures} failure(s)`);
}
console.log('smoke-jotunn: all checks passed');
