/**
 * Camera path interpolation, kept apart from ./stage.ts so it is reachable
 * without a canvas — tests/duels.test.ts flies the real duel paths through it.
 *
 * Module scratch is fully overwritten on every call and never read across
 * calls, which keeps the render loop allocation-free (same convention as
 * src/duels/rows/support.ts).
 */

import { Quaternion, Vector3 } from 'three';

const _a = new Vector3();
const _b = new Vector3();
const _turn = new Quaternion();
const _step = new Quaternion();

/**
 * Swing an eye from `from` to `to` around `look`, rather than dollying along
 * the chord between them.
 *
 * A straight lerp is what used to put the duel camera inside the fighters. The
 * board camera sits at one fixed world point while each duel script picks which
 * side of the approach axis to watch from, so on roughly half of all captures
 * the chord to the duel framing ran clean through a combatant — measured worst
 * case 0.06 world units of clearance, i.e. the eye inside the victim's chest,
 * with the near plane slicing the body open.
 *
 * Interpolating the direction and the radius separately holds the eye at
 * `lerp(|from-look|, |to-look|, k)` from the subject for the whole move, so it
 * can never dip inside the closer of the two framings, and it reads as a swing
 * around the action instead of a shove through it.
 */
export function arcCamera(
  out: Vector3,
  from: Vector3,
  to: Vector3,
  look: Vector3,
  k: number,
): Vector3 {
  const a = _a.subVectors(from, look);
  const b = _b.subVectors(to, look);
  const ra = a.length();
  const rb = b.length();
  // Degenerate radius: no direction to rotate, so the chord is all there is.
  if (ra < 1e-6 || rb < 1e-6) return out.lerpVectors(from, to, k);
  a.divideScalar(ra);
  b.divideScalar(rb);
  _turn.setFromUnitVectors(a, b);
  _step.identity().slerp(_turn, k);
  return out
    .copy(a)
    .applyQuaternion(_step)
    .multiplyScalar(ra + (rb - ra) * k)
    .add(look);
}

/**
 * Shove `eye` out of one standing figure, modelled as a vertical cylinder of
 * `radius` rising `height` from (`cx`, `baseY`, `cz`). Returns true if it moved.
 *
 * This is the bystander half of the duel-camera problem. arcCamera keeps the
 * move clear of the two fighters, but the framing is derived purely from their
 * staging, so its mark regularly lands on a square that happens to be occupied
 * by a spectator. Measured in a live demonstration game before this existed: the
 * eye reached 0.053 from a huscarl's head — inside the 0.1 near plane, which
 * slices the body open and fills the shot — with that huscarl 3.03 units from
 * the duel centre. Roughly a third of duel frames had some piece within 0.35.
 *
 * The push is horizontal only: the framing's eye height carries the shot, and
 * lifting the camera over a figure would break the low across-the-approach angle
 * the duel grammar is built on. An eye already clear above the figure's head is
 * left alone, so the wide part of a cut-in is never distorted.
 */
export function keepOutOfFigure(
  eye: Vector3,
  cx: number,
  cz: number,
  baseY: number,
  height: number,
  radius: number,
  lift: number,
): boolean {
  if (eye.y > baseY + height + lift) return false;
  const dx = eye.x - cx;
  const dz = eye.z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= radius) return false;
  if (d > 1e-4) {
    eye.x = cx + (dx / d) * radius;
    eye.z = cz + (dz / d) * radius;
  } else {
    // Dead on the axis: any way out beats standing inside the body.
    eye.x = cx + radius;
  }
  return true;
}
