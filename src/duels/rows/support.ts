/**
 * Staging, camera grammar, and pose plumbing shared by all six duel rows.
 *
 * Space: DuelContext.attackerPos/victimPos are world-space square centers and
 * rig.root.position is written in that same space — the 2D vignette sets the
 * precedent and the director's end state (`attacker.root.position = victimPos`)
 * assumes it.
 *
 * Purity: every helper is a pure function of its arguments. Nothing here reads
 * a transform it also writes, so sampling t out of order (scrub, 2×, skip to 1)
 * always lands on the same state. Module scratch is fully overwritten on each
 * use and never read across calls, which keeps the hot path allocation-free.
 *
 * What a script may leave behind: rig.root position/rotation (the renderer
 * reseats root on attach) and bone ROTATIONS (setPose restores those). Bone
 * positions and scales must be restored by t=1 — syncBoard reuses a stale rig
 * for another piece of the same type and colour, so a displaced bone would
 * follow the survivor onto the board.
 */

import { Euler, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { BoneName, CharacterRig, DuelContext } from '../../core/stage.ts';
import {
  clamp01,
  easeInOutCubic,
  footPlant,
  lerp,
  phase,
  shakeEnv,
  type ReadonlyVec3,
  type Vec3,
} from '../motion.ts';

// ── Duel shape (DUELS.md: cut-in ≤0.5s, action ≈2.7s, resolve+cut-out ≤0.8s) ─

/** Camera has finished easing in by here. At 3.6s duration that is 0.5s. */
export const CUT_IN = 0.14;
/** The action is over here; [ACT_END, 1] is resolve + cut-out. */
export const ACT_END = 0.8;
/** Default duration: leaves the 4.0s cap a margin at 1×. */
export const DUR = 3.6;

/** Combatants are staged this far apart, per the silhouette-separation rule. */
export const GAP = 1.6;

// ── Staging ─────────────────────────────────────────────────────────────────

export interface Staging {
  /** Unit vector from the attacker's square toward the victim's, on XZ. */
  fx: number;
  fz: number;
  /** Unit vector 90° to the right of the approach — sidesteps, veers, bolts. */
  rx: number;
  rz: number;
  /** Victim's stand: the captured square, where the attacker also ends. */
  vx: number;
  vz: number;
  /** Board plane. */
  y: number;
  /** Attacker's opening stand, GAP back along the approach. */
  sx: number;
  sz: number;
  /** Yaw facing the victim (attacker) and facing the attacker (victim). */
  ay: number;
  vy: number;
}

const STAGE: Staging = {
  fx: 0, fz: 1, rx: 1, rz: 0,
  vx: 0, vz: 0, y: 0, sx: 0, sz: 0, ay: 0, vy: 0,
};

/**
 * Re-stage a capture as a duel: both combatants are placed on the approach
 * axis GAP apart, centred on the captured square, regardless of how far apart
 * the two squares actually were. Returns shared scratch — valid until the next
 * call, which is fine because the director plays one duel at a time and every
 * script calls this once at the top of update().
 */
export function stageDuel(ctx: DuelContext): Staging {
  const [ax, , az] = ctx.attackerPos;
  const [vx, vy, vz] = ctx.victimPos;
  let dx = vx - ax;
  let dz = vz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    dx = 0;
    dz = 1;
  } else {
    dx /= len;
    dz /= len;
  }
  const s = STAGE;
  s.fx = dx;
  s.fz = dz;
  // Right of the approach on XZ (ŷ × f̂).
  s.rx = -dz;
  s.rz = dx;
  s.vx = vx;
  s.vz = vz;
  s.y = vy;
  s.sx = vx - dx * GAP;
  s.sz = vz - dz * GAP;
  // A rig's neutral gaze is -Z, so yaw = atan2(-Δx, -Δz).
  s.ay = Math.atan2(-dx, -dz);
  s.vy = Math.atan2(dx, dz);
  return s;
}

/**
 * A world point on the staging plane: `gap` back from the captured square
 * along the approach, `side` to the approach's right, `lift` above the board.
 */
export function stagePoint(
  s: Staging,
  gap: number,
  side: number,
  lift: number,
  out: Vec3,
): Vec3 {
  out[0] = s.vx - s.fx * gap + s.rx * side;
  out[1] = s.y + lift;
  out[2] = s.vz - s.fz * gap + s.rz * side;
  return out;
}

// ── Root placement ──────────────────────────────────────────────────────────

/**
 * Seat a rig on the board. Euler order is forced to YXZ so `pitch` and `roll`
 * act in the rig's own frame — a fall reads the same whichever way the duel
 * happens to be facing, which an XYZ pitch would not.
 */
export function place(
  rig: CharacterRig,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch = 0,
  roll = 0,
): void {
  rig.root.position.set(x, y, z);
  rig.root.rotation.order = 'YXZ';
  rig.root.rotation.set(pitch, yaw, roll);
}

/** Seat a rig at a staged point (see stagePoint). */
export function placeAt(
  rig: CharacterRig,
  s: Staging,
  gap: number,
  side: number,
  lift: number,
  yaw: number,
  pitch = 0,
  roll = 0,
): void {
  place(
    rig,
    s.vx - s.fx * gap + s.rx * side,
    s.y + lift,
    s.vz - s.fz * gap + s.rz * side,
    yaw,
    pitch,
    roll,
  );
}

// ── Poses ───────────────────────────────────────────────────────────────────

/**
 * A keyframe: every bone this character animates, so a row's tables are all
 * keyed alike and TS rejects a table that forgets a bone mid-swing.
 */
export type Pose<K extends BoneName> = Readonly<Record<K, ReadonlyVec3>>;

/** Snap to a keyframe. */
export function applyPose<K extends BoneName>(
  rig: CharacterRig,
  pose: Pose<K>,
): void {
  for (const name in pose) {
    const bone = rig.bones[name as BoneName];
    if (!bone) continue;
    const r = pose[name as K];
    bone.rotation.set(r[0], r[1], r[2]);
  }
}

/** Blend between two keyframes. k is pre-eased by the caller. */
export function blendPose<K extends BoneName>(
  rig: CharacterRig,
  from: Pose<K>,
  to: Pose<K>,
  k: number,
): void {
  for (const name in from) {
    const bone = rig.bones[name as BoneName];
    if (!bone) continue;
    const a = from[name as K];
    const b = to[name as K];
    bone.rotation.set(
      lerp(a[0], b[0], k),
      lerp(a[1], b[1], k),
      lerp(a[2], b[2], k),
    );
  }
}

/** Layer a wind-up or a shudder on top of a blended pose. */
export function nudge(
  rig: CharacterRig,
  name: BoneName,
  dx: number,
  dy = 0,
  dz = 0,
): void {
  const bone = rig.bones[name];
  if (!bone) return;
  bone.rotation.x += dx;
  bone.rotation.y += dy;
  bone.rotation.z += dz;
}

// ── Rest transforms ─────────────────────────────────────────────────────────

export interface Rest {
  hips: Object3D | null;
  hipsY: number;
  mount: Object3D | null;
  mountP: ReadonlyVec3;
  mountHipsP: ReadonlyVec3;
}

const REST = new WeakMap<Object3D, Rest>();

/**
 * Rest transforms of the bones a duel may translate, captured before anything
 * has written to them — so the cache is a pure function of the built rig.
 */
export function restOf(rig: CharacterRig): Rest {
  const cached = REST.get(rig.root);
  if (cached) return cached;
  const hips = rig.bones.hips ?? null;
  const mount = rig.bones.mount ?? null;
  const rest: Rest = {
    hips,
    hipsY: hips ? hips.position.y : 0,
    mount: mount,
    mountP: mount
      ? [mount.position.x, mount.position.y, mount.position.z]
      : [0, 0, 0],
    mountHipsP: hips
      ? [hips.position.x, hips.position.y, hips.position.z]
      : [0, 0, 0],
  };
  REST.set(rig.root, rest);
  return rest;
}

/**
 * Lower the hips to crouch, duck, kneel or sag. The legs are a chain hanging
 * off the hips, so leg rotation alone can never bring a body down.
 *
 * This is a bone position, so it MUST be undone before the rig goes back on the
 * board: victors are restored by victorSettle, victims at k=1 by their reading.
 */
export function sinkHips(rig: CharacterRig, drop: number): void {
  const r = restOf(rig);
  if (r.hips) r.hips.position.y = r.hipsY - drop;
}

export function restoreHips(rig: CharacterRig): void {
  const r = restOf(rig);
  if (r.hips) r.hips.position.y = r.hipsY;
}

/**
 * Move a mounted rider relative to his saddle: `(0,0,0)` is seated, and the
 * offset is in the rig's own root space so a leap reads the same whichever way
 * the duel faces.
 *
 * The rider's hips hang off the mount bone, so getting him off the horse means
 * cancelling the mount's transform: this reads the mount's rotation and
 * translation (which the caller must have written earlier in the same frame)
 * and inverts them.
 *
 * `level` is how much of the mount's PITCH AND ROLL to cancel as well as its
 * yaw. At 0 they are left in and the rider is carried by them — which is what a
 * leap out of the saddle wants, since the horse's own tumble is what launches
 * him. At 1 the offset lands exactly where it was asked for in the rig's own
 * frame, which is what a fall needs: a man coming off a rearing, bolting horse
 * has to reach the board at the height the script says, not wherever the roll
 * of the horse happens to leave him.
 *
 * A rider offset is a bone position, so it must be back to (0,0,0) before the
 * resolve, or the victor rides onto the board dismounted.
 */
export function seatRider(
  rig: CharacterRig,
  ox: number,
  oy: number,
  oz: number,
  level = 0,
): void {
  const r = restOf(rig);
  const mount = r.mount;
  const hips = r.hips;
  if (!mount || !hips) return;
  _seat.set(
    r.mountP[0] + r.mountHipsP[0] + ox - mount.position.x,
    r.mountP[1] + r.mountHipsP[1] + oy - mount.position.y,
    r.mountP[2] + r.mountHipsP[2] + oz - mount.position.z,
  );
  // At level 0 this reduces to a pure yaw inverse — the original behaviour.
  _mountE.set(
    mount.rotation.x * level,
    mount.rotation.y,
    mount.rotation.z * level,
  );
  _mountQ.setFromEuler(_mountE).invert();
  hips.position.copy(_seat.applyQuaternion(_mountQ));
}

/**
 * Orient a rider in the rig's OWN frame rather than the saddle's.
 *
 * His hips hang off the mount bone, so a rider who has left it still inherits
 * every degree the horse turns: a man lying on the board would otherwise swing
 * slowly round after the horse as it bolts offstage. `level` blends from
 * "carried by the saddle" (0, the plain seated behaviour) to "exactly this
 * attitude in root space, whatever the horse is doing" (1).
 *
 * Writes hips.quaternion, which three keeps in sync with hips.rotation — so
 * restoring the bone by setting its rotation back to zero still works.
 */
export function faceRider(
  rig: CharacterRig,
  pitch: number,
  yaw: number,
  roll: number,
  level = 1,
): void {
  const r = restOf(rig);
  const mount = r.mount;
  const hips = r.hips;
  if (!mount || !hips) return;
  _bodyQ.setFromEuler(_bodyE.set(pitch, yaw, roll));
  _mountE.set(
    mount.rotation.x * level,
    mount.rotation.y * level,
    mount.rotation.z * level,
  );
  _mountQ.setFromEuler(_mountE).invert();
  hips.quaternion.copy(_mountQ.multiply(_bodyQ));
}

const _seat = new Vector3();
const _mountE = new Euler();
const _mountQ = new Quaternion();
const _bodyE = new Euler();
const _bodyQ = new Quaternion();

/** Restore the mount and rider to their rest transforms. */
export function restoreMount(rig: CharacterRig): void {
  const r = restOf(rig);
  if (r.mount) {
    r.mount.position.set(r.mountP[0], r.mountP[1], r.mountP[2]);
    r.mount.rotation.set(0, 0, 0);
  }
  if (r.hips) {
    r.hips.position.set(r.mountHipsP[0], r.mountHipsP[1], r.mountHipsP[2]);
  }
}

/**
 * Gallop the horse's own four legs: hind pair driving, front pair reaching half
 * a beat later, knee or hock folding only through the carry.
 *
 * `beat` is in radians — the same phase the caller is already feeding its mount
 * nudge, so a cell galloping on `Math.sin(t * 40)` passes `t * 40` and the legs
 * land on the body's own rhythm. `stride` scales to 0 for a halt.
 *
 * Unlike nudge() this ASSIGNS: the horse's legs appear in no pose table, so
 * nothing re-baselines them each frame and adding would accumulate. The canter
 * is duplicated from src/render/locomotion.ts on purpose — render and duels are
 * sibling consumers of src/core and neither may reach into the other.
 */
export function mountLegs(
  rig: CharacterRig,
  beat: number,
  stride: number,
): void {
  const b = rig.bones;
  const leg = (
    upper: BoneName,
    lower: BoneName,
    offset: number,
    amp: number,
    fold: 1 | -1,
  ): void => {
    const u = b[upper];
    const l = b[lower];
    if (!u || !l) return;
    const a = beat + offset;
    u.rotation.x = Math.sin(a) * amp;
    l.rotation.x = fold * Math.max(0, -Math.cos(a)) * amp * 1.5;
  };
  const turn = Math.PI * 2;
  leg('mountLegBL', 'mountShinBL', 0, stride, 1);
  leg('mountLegBR', 'mountShinBR', 0.1 * turn, stride, 1);
  leg('mountLegFL', 'mountShinFL', 0.45 * turn, stride * 0.87, -1);
  leg('mountLegFR', 'mountShinFR', 0.55 * turn, stride * 0.87, -1);
}

/**
 * A rearing horse: the front legs strike out and paw, the hind legs fold under
 * and take the weight. `k` is 0 (all four down) to 1 (fully up), `paw` a
 * free-running phase in radians for the pawing itself. Assigns, like mountLegs.
 */
export function mountRear(rig: CharacterRig, k: number, paw: number): void {
  const b = rig.bones;
  const pairs: [BoneName, BoneName, boolean, number][] = [
    ['mountLegFL', 'mountShinFL', true, 0],
    ['mountLegFR', 'mountShinFR', true, 2.2],
    ['mountLegBL', 'mountShinBL', false, 0],
    ['mountLegBR', 'mountShinBR', false, 0],
  ];
  for (const [upper, lower, isFront, off] of pairs) {
    const u = b[upper];
    const l = b[lower];
    if (!u || !l) continue;
    if (isFront) {
      u.rotation.x = (1.0 + 0.35 * Math.sin(paw + off)) * k;
      l.rotation.x = (-0.9 + 0.4 * Math.sin(paw + off + 1.1)) * k;
    } else {
      u.rotation.x = -0.3 * k;
      l.rotation.x = 0.5 * k;
    }
  }
}

// ── Locomotion ──────────────────────────────────────────────────────────────

/**
 * Walk/lope the legs. `stride` is scaled by the caller so it can reach exactly
 * 0 — footPlant at an integer cycle is the neutral pose, so a script that ends
 * with stride 0 lands cleanly on idle legs.
 */
export function stepLegs(
  rig: CharacterRig,
  cycle: number,
  stride: number,
): void {
  const { legL, legR, shinL, shinR } = rig.bones;
  if (!legL || !legR || !shinL || !shinR) return; // the völva has no legs
  footPlant(legL, shinL, cycle, stride);
  footPlant(legR, shinR, cycle + 0.5, stride);
}

/** Vertical bob for a travelling figure; two bobs per stride. */
export function walkBob(cycle: number, amount: number): number {
  return Math.abs(Math.sin(cycle * Math.PI * 2)) * amount;
}

// ── Camera ──────────────────────────────────────────────────────────────────

/** One camera idea per duel, maximum. */
export type CameraIdea = 'hold' | 'push' | 'orbit' | 'rise';

export interface CameraOptions {
  idea?: CameraIdea;
  /** Eye height at the cut-in, in board units. */
  height?: number;
  /** Eye distance from the pair's midpoint. */
  dist?: number;
  /** Which side of the approach the camera watches from. */
  side?: 1 | -1;
  /** Camera has fully eased in by here. */
  cutIn?: number;
  /** Framing starts easing back out here. */
  out?: number;
}

const _camPos: Vec3 = [0, 0, 0];
const _camLook: Vec3 = [0, 0, 0];

/**
 * The house camera grammar: ease from the board camera to a low framing that
 * looks across the approach axis (so the two silhouettes separate), hold
 * through the action with at most one idea, then widen as the victor settles.
 * The director's release() finishes the return to the board camera.
 *
 * `t` is passed to moveTo as a linear ramp — moveTo eases it internally, and
 * easing twice would stall the cut-in.
 */
export function camera(
  ctx: DuelContext,
  s: Staging,
  t: number,
  opts: CameraOptions = {},
): void {
  const idea = opts.idea ?? 'hold';
  const side = opts.side ?? 1;
  const cutIn = opts.cutIn ?? CUT_IN;
  const outAt = opts.out ?? ACT_END;
  const act = phase(t, cutIn, outAt);
  const back = easeInOutCubic(phase(t, outAt, 1));

  let height = opts.height ?? 1.1;
  let dist = opts.dist ?? 2.5;
  let swing = 0;
  if (idea === 'push') dist -= 0.55 * easeInOutCubic(act);
  else if (idea === 'orbit') swing = 0.44 * easeInOutCubic(act);
  else if (idea === 'rise') height += 1.15 * easeInOutCubic(act);
  // Cut-out: ease back and up as the victor walks to idle.
  dist += 0.7 * back;
  height += 0.35 * back;

  // Midpoint of the staged pair, biased a third of the way toward the victim.
  const midGap = GAP * 0.5 - GAP * 0.16;
  // Watch from across the approach; a touch of -f makes it a 3/4 view.
  const ox = (s.rx * side * Math.cos(swing) - s.fx * Math.sin(swing)) * dist;
  const oz = (s.rz * side * Math.cos(swing) - s.fz * Math.sin(swing)) * dist;
  const cx = s.vx - s.fx * midGap;
  const cz = s.vz - s.fz * midGap;

  _camPos[0] = cx + ox - s.fx * 0.45;
  _camPos[1] = s.y + height;
  _camPos[2] = cz + oz - s.fz * 0.45;
  _camLook[0] = cx + s.fx * 0.15;
  _camLook[1] = s.y + 0.55;
  _camLook[2] = cz + s.fz * 0.15;
  ctx.camera.moveTo(_camPos, _camLook, clamp01(t / cutIn));
}

/**
 * Impact shake. Stone impacts and shield breaks only, ≤0.35 — the renderer
 * suppresses it under reduced motion.
 */
export function shakeAt(
  ctx: DuelContext,
  t: number,
  at: number,
  intensity: number,
  dur = 0.12,
): void {
  const e = shakeEnv(t, at, dur);
  if (e > 0) ctx.camera.shake(Math.min(0.35, intensity) * e);
}

/**
 * Fire a cue on the frame that crosses `at`. The window matches the director's
 * re-fire guard exactly, so a beat emits once however the clock is stepped.
 */
export function cueAt(
  ctx: DuelContext,
  t: number,
  at: number,
  name: string,
  intensity?: number,
): void {
  if (t >= at && t < at + 0.1) ctx.cue(name, intensity);
}

// ── Resolve ─────────────────────────────────────────────────────────────────

/**
 * The victor's walk to idle on the captured square. Snaps to the rig's own
 * idle keyframe and layers a decaying travel on top, so k=1 is exactly
 * "idle, on the captured square" — the canonical end state — for every
 * character without this module knowing any of their pose tables.
 *
 * Call last in update(): the setPose is what returns the bones the script has
 * been driving all duel back to neutral.
 */
export function victorSettle(
  a: CharacterRig,
  s: Staging,
  k: number,
  fromX: number,
  fromZ: number,
  fromY = s.y,
  fromHipDrop = 0,
): void {
  const e = easeInOutCubic(clamp01(k));
  const rest = 1 - e;
  a.setPose('idle');
  // Straighten out of whatever crouch the action ended in; exactly rest at k=1,
  // so a victor never carries a dropped hip back onto the board.
  sinkHips(a, fromHipDrop * rest);
  const cycle = e * 1.5;
  const stride = 0.45 * rest;
  stepLegs(a, cycle, stride);
  place(
    a,
    lerp(fromX, s.vx, e),
    lerp(fromY, s.y, e) + walkBob(cycle, 0.02 * rest),
    lerp(fromZ, s.vz, e),
    s.ay,
    // A little residual weight in the torso, gone by k=1.
    0.06 * rest,
  );
  nudge(a, 'spine', 0.05 * rest);
  nudge(a, 'head', -0.04 * rest);
}

const _from: Vec3 = [0, 0, 0];

/**
 * The standard tail of a cell: from `at` onwards, walk the victor from where
 * its action finished (a staged point) onto the captured square and into idle.
 * A no-op before `at`, so cells can call it unconditionally.
 */
export function resolve(
  a: CharacterRig,
  s: Staging,
  t: number,
  gap: number,
  side = 0,
  lift = 0,
  hipDrop = 0,
  at = ACT_END,
): void {
  if (t < at) return;
  stagePoint(s, gap, side, lift, _from);
  victorSettle(a, s, phase(t, at, 1), _from[0], _from[2], _from[1], hipDrop);
}
