/**
 * Shared motion vocabulary for all duel scripts. Every helper is a pure
 * function; hot-path helpers take out-params and allocate nothing. All
 * curves map [0,1] → value; scripts compose them over `phase()` windows.
 */

import { Euler, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';

export type Vec3 = [number, number, number];
export type ReadonlyVec3 = readonly [number, number, number];

// ── Scalars ─────────────────────────────────────────────────────────────────

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/** Shortest-arc angle interpolation (radians). */
export function lerpAngle(a: number, b: number, k: number): number {
  const TAU = Math.PI * 2;
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
}

/**
 * Remap t into the [a,b] sub-window, clamped to [0,1]. The backbone of every
 * script: `ease(phase(t, 0.2, 0.5))` is "this beat runs from 20% to 50%".
 */
export function phase(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a));
}

// ── Easing set ──────────────────────────────────────────────────────────────

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

export function easeInQuint(t: number): number {
  return t * t * t * t * t;
}

export function easeOutQuint(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u * u * u;
}

export function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - ((-2 * t + 2) ** 5) / 2;
}

/**
 * Follow-through: overshoots past 1 then settles back. Use for weapon
 * settles, landings, anything that should carry weight past its mark.
 */
export function backOut(t: number, overshoot = 1.70158): number {
  const u = t - 1;
  return 1 + u * u * ((overshoot + 1) * u + overshoot);
}

/**
 * Anticipation: dips NEGATIVE first (the wind-up), crosses zero at
 * pull/(pull+1), then accelerates to 1 (the strike). Larger `pull` =
 * deeper, longer wind-up.
 */
export function anticipate(t: number, pull = 2.2): number {
  return t * t * ((pull + 1) * t - pull);
}

// ── Paths ───────────────────────────────────────────────────────────────────

/**
 * Parabolic arc from p0 to p1 with `apexHeight` of extra lift at midpoint.
 * Writes into `out`; returns it. apexHeight 0 degrades to a straight lerp.
 */
export function arc(
  p0: ReadonlyVec3,
  p1: ReadonlyVec3,
  apexHeight: number,
  t: number,
  out: Vec3,
): Vec3 {
  out[0] = lerp(p0[0], p1[0], t);
  out[1] = lerp(p0[1], p1[1], t) + apexHeight * 4 * t * (1 - t);
  out[2] = lerp(p0[2], p1[2], t);
  return out;
}

// ── Bone pose helpers ───────────────────────────────────────────────────────

/** Componentwise euler lerp — right for small swings on one dominant axis. */
export function boneLerp(
  bone: Object3D,
  from: ReadonlyVec3,
  to: ReadonlyVec3,
  k: number,
): void {
  bone.rotation.set(
    lerp(from[0], to[0], k),
    lerp(from[1], to[1], k),
    lerp(from[2], to[2], k),
  );
}

const _eA = new Euler();
const _eB = new Euler();
const _qA = new Quaternion();
const _qB = new Quaternion();

/** Quaternion slerp between two euler poses — for big multi-axis swings. */
export function boneSlerp(
  bone: Object3D,
  from: ReadonlyVec3,
  to: ReadonlyVec3,
  k: number,
): void {
  _qA.setFromEuler(_eA.set(from[0], from[1], from[2]));
  _qB.setFromEuler(_eB.set(to[0], to[1], to[2]));
  _qA.slerp(_qB, k);
  bone.quaternion.copy(_qA);
}

// ── Envelopes ───────────────────────────────────────────────────────────────

/**
 * Impact-shake envelope: 0 outside [start, start+dur]; inside, a sharp
 * attack then a squared decay. Multiply by your max intensity and feed
 * `ctx.camera.shake()` (remember the ≤0.35 cap on stone/shield hits only).
 */
export function shakeEnv(t: number, start: number, dur: number): number {
  const u = (t - start) / dur;
  if (u <= 0 || u >= 1) return 0;
  const decay = (1 - u) * (1 - u);
  return u < 0.15 ? (u / 0.15) * decay : decay;
}

// ── Locomotion ──────────────────────────────────────────────────────────────

/**
 * One walking/loping leg. `cycle` in stride units (fractional part used):
 * the foot plants at cycle 0 and lifts through mid-swing, knee folding only
 * while the leg carries forward. Call with cycle+0.5 for the opposite leg.
 * `stride` is the hip swing amplitude in radians (positive x = toward -Z,
 * the default facing).
 */
export function footPlant(
  leg: Object3D,
  shin: Object3D,
  cycle: number,
  stride: number,
): void {
  const a = (cycle - Math.floor(cycle)) * Math.PI * 2;
  leg.rotation.x = Math.sin(a) * stride;
  // Knee folds while the thigh swings forward (cos < 0 half of the cycle).
  shin.rotation.x = -Math.max(0, -Math.cos(a)) * stride * 1.6;
}

// ── Aiming ──────────────────────────────────────────────────────────────────

const _target = new Vector3();

/**
 * Aim a head (or any bone whose neutral gaze is -Z) at a world-space point.
 * `weight` blends from neutral (0) to fully tracking (1). Overwrites the
 * bone's rotation — apply after any pose lerp on the same bone.
 */
export function lookAt(head: Object3D, target: ReadonlyVec3, weight = 1): void {
  const parent = head.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  _target.set(target[0], target[1], target[2]);
  parent.worldToLocal(_target);
  _target.sub(head.position);
  const yaw = Math.atan2(-_target.x, -_target.z);
  const pitch = Math.atan2(_target.y, Math.hypot(_target.x, _target.z));
  head.rotation.set(-pitch * weight, yaw * weight, 0);
}

/** World-yaw that points a -Z-facing rig standing at `from` toward `to`. */
export function facingYaw(from: ReadonlyVec3, to: ReadonlyVec3): number {
  return Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
}

/**
 * Turn a rig root to face `to`, blending from an explicit starting yaw so
 * the result stays a pure function of t (never read-modify-write per frame).
 */
export function orientTowards(
  obj: Object3D,
  to: ReadonlyVec3,
  fromYaw: number,
  k: number,
): void {
  const desired = Math.atan2(
    -(to[0] - obj.position.x),
    -(to[2] - obj.position.z),
  );
  obj.rotation.y = lerpAngle(fromYaw, desired, k);
}
