/**
 * Jötunn form changes — the petrify/unfold transition, shared by every duel
 * that involves a jötunn. Pure pose-functions of t ∈ [0,1]: each call writes
 * absolute transforms for every bone and shell fragment it ever touches, so
 * sampling any t (scrub, 2×, skip-to-1) lands on a clean state. No timers,
 * no Math.random — deterministic micro-variation comes from hash32 of the
 * shell-segment index.
 *
 * CLIPPING HANDOFF (chars critic): the rig's canonical poses rotate limbs
 * but never open the tower shell. These helpers co-animate the towerShell
 * fragments apart AND lift the hips in the same beats as the limb rotations
 * — always change jötunn form through this module, never via setPose alone.
 *
 * State contract:
 * - unfoldJotunn(rig, 0)  === the rig's 'idle' tower rest state.
 * - unfoldJotunn(rig, 1)  === battle stance (shell parted, hips risen).
 * - foldJotunn is the reverse journey with reversed beat order and heavier
 *   dynamics — NOT a time-reversed unfold. foldJotunn(rig, 0) === battle
 *   stance; foldJotunn(rig, 1) restores the tower rest state EXACTLY, so a
 *   surviving jötunn must pass through foldJotunn(…, 1) before the director
 *   calls setPose('idle') (setPose cannot reseat shell meshes or hips).
 * - crumbleJotunn(rig, 0) === battle stance; by t=1 the figure has lost
 *   coherence and the whole rig has sunk below the board plane (defeat:
 *   cracks along its seams, a rubble heap that sinks away — stone, no gore).
 *
 * Cue timing (fired by callers, names from src/audio/cues.ts):
 * - unfold: 'stone-grind' at JOTUNN_BEATS.shudder (dust shakes loose),
 *   'stone-grind'/'vocal:jotunn' at .part, 'impact-stone' at .limbs (the
 *   feet plant).
 * - fold: the shell slams shut at t = JOTUNN_BEATS.limbs (0.85) — cue
 *   'impact-stone' there.
 */

import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { hash32 } from '../core/prng.ts';
import type { BoneName, CharacterRig } from '../core/stage.ts';

/** Beat map for callers' ctx.cue() timing during unfoldJotunn. */
export const JOTUNN_BEATS = { shudder: 0.25, part: 0.55, limbs: 0.85 } as const;

// ── Tuning ───────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
/** How far each shell wall translates outward when the seams part. */
const WALL_OUT = 0.34;
/** Outward lean of a parted wall (about its tangent axis). */
const WALL_TILT = 0.26;
/** How far a parted wall settles downward. */
const WALL_DROP = 0.1;
/** Hip rise from tower crouch to battle stance. */
const HIP_RISE = 0.28;
/** Tower cap slide-off: it ends on the ground behind the giant (+z local). */
const CAP_SLIDE = 0.6;
const CAP_END_Y = 0.06;
const CAP_TILT = 0.55;
const CAP_YAW = 0.4;
/** Crumble: how far the root sinks below the board plane by t=1. */
const SINK_DEPTH = 1.9;

type V3 = readonly [number, number, number];
type LimbBone = Extract<
  BoneName,
  | 'legL' | 'legR' | 'shinL' | 'shinR' | 'spine' | 'chest' | 'head'
  | 'armL' | 'armR' | 'forearmL' | 'forearmR' | 'handL' | 'handR'
>;

/** Folded-giant rotations — must mirror the rig's 'idle' pose exactly. */
const FOLD: Record<LimbBone, V3> = {
  legL: [3.0, 0, 0.06],
  shinL: [-2.95, 0, 0],
  legR: [3.0, 0, -0.06],
  shinR: [-2.95, 0, 0],
  spine: [0.08, 0, 0],
  chest: [0, 0, 0],
  head: [0.3, 0, 0],
  armL: [0.15, 0, -0.1],
  forearmL: [0.28, 0, -1.15],
  handL: [0, 0, 0],
  armR: [0.15, 0, 0.1],
  forearmR: [0.28, 0, 1.15],
  handR: [0, 0, 0],
};

/** Battle stance — wide, guard-like, tuned so feet meet the board with the
 *  hips risen by HIP_RISE (the rig's own 'guard' assumes tower-height hips). */
const STANCE: Record<LimbBone, V3> = {
  legL: [0.6, 0, 0.3],
  shinL: [-0.55, 0, 0],
  legR: [0.6, 0, -0.3],
  shinR: [-0.55, 0, 0],
  spine: [0.14, 0, 0],
  chest: [0.06, 0, 0],
  head: [-0.08, 0, 0],
  armL: [0.75, 0, 0.45],
  forearmL: [0.9, 0, 0.1],
  handL: [0.15, 0, 0],
  armR: [0.75, 0, -0.45],
  forearmR: [0.9, 0, -0.1],
  handR: [0.15, 0, 0],
};

/** Rubble-heap rotations at the end of crumble (before the rig sinks away). */
const HEAP: Record<LimbBone, V3> = {
  legL: [2.1, 0, 0.5],
  shinL: [-2.5, 0, 0],
  legR: [2.2, 0, -0.45],
  shinR: [-2.4, 0, 0],
  spine: [0.9, 0.12, 0],
  chest: [0.35, 0, 0],
  head: [0.6, 0.2, 0],
  armL: [1.35, 0, 0.12],
  forearmL: [1.7, 0, -0.3],
  handL: [0.3, 0, 0],
  armR: [1.25, 0, -0.1],
  forearmR: [1.6, 0, 0.35],
  handR: [0.3, 0, 0],
};

// ── Easing ───────────────────────────────────────────────────────────────────

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Normalized phase of t inside [a,b], clamped. */
const win = (t: number, a: number, b: number): number =>
  clamp01((t - a) / (b - a));
const smooth = (x: number): number => x * x * (3 - 2 * x);
const easeInCubic = (x: number): number => x * x * x;
const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;
/** Ease-out with overshoot (stone shoved, not slid). back(0)=0, back(1)=1. */
const backOut = (x: number, s: number): number => {
  const u = x - 1;
  return 1 + u * u * ((s + 1) * u + s);
};
const lerp = (a: number, b: number, e: number): number => a + (b - a) * e;
/** Half-sine pulse: 0 at both ends of [0,1], 1 in the middle. */
const bump = (x: number): number => Math.sin(Math.PI * clamp01(x));

/** Deterministic per-fragment hash in [0,1) / [-1,1). Never prng. */
const h01 = (i: number, salt: number): number =>
  hash32(i + 1, salt) / 4294967296;
const h11 = (i: number, salt: number): number => h01(i, salt) * 2 - 1;

// ── Shell anatomy (cached rest transforms per rig) ──────────────────────────

interface ShellSeg {
  wall: Object3D;
  merlon: Object3D | null;
  /** Outward azimuth of this segment (from the merlon's baked yaw). */
  sin: number;
  cos: number;
  wallP: V3;
  merlonP: V3;
  /** Height of the merlon above the wall's pivot (tilt lever arm). */
  lever: number;
  wallS: number;
  merlonS: number;
}

interface JotunnParts {
  hips: Object3D;
  hipsRestY: number;
  shell: Object3D | null;
  segs: ShellSeg[];
  cap: Object3D | null;
  capP: V3;
}

const PARTS = new WeakMap<Object3D, JotunnParts>();

/**
 * Classify the towerShell's direct mesh children by their rest transforms
 * (walls sit centered at mid-height, merlons ride high at a radius, the cap
 * is high and centered, the base ring stays put) and cache everything the
 * pose functions need. Rest transforms are captured before any helper has
 * written to the meshes, so the cache is a pure function of the built rig.
 */
function partsOf(rig: CharacterRig): JotunnParts | null {
  const hips = rig.bones.hips;
  if (!hips) return null;
  const cached = PARTS.get(rig.root);
  if (cached) return cached;

  const shell = rig.bones.towerShell ?? null;
  const walls: Object3D[] = [];
  const merlons: Object3D[] = [];
  let cap: Object3D | null = null;
  if (shell) {
    for (const child of shell.children) {
      const { x, y, z } = child.position;
      if (Math.hypot(x, z) > 0.1 && y > 1.0) merlons.push(child);
      else if (y > 1.0) cap = child;
      else if (y > 0.2) walls.push(child);
      // else: the base ring — never animated, it sinks with the root.
    }
  }
  const segs: ShellSeg[] = walls.map((wall, i) => {
    const merlon = merlons[i] ?? null;
    const mid = merlon
      ? merlon.rotation.y
      : (i + 0.5) * (TAU / Math.max(1, walls.length));
    const merlonP: V3 = merlon
      ? [merlon.position.x, merlon.position.y, merlon.position.z]
      : [0, 0, 0];
    return {
      wall,
      merlon,
      sin: Math.sin(mid),
      cos: Math.cos(mid),
      wallP: [wall.position.x, wall.position.y, wall.position.z],
      merlonP,
      lever: merlon ? merlonP[1] - wall.position.y : 0,
      wallS: wall.scale.x,
      merlonS: merlon ? merlon.scale.x : 1,
    };
  });
  const parts: JotunnParts = {
    hips,
    hipsRestY: hips.position.y,
    shell,
    segs,
    cap,
    capP: cap ? [cap.position.x, cap.position.y, cap.position.z] : [0, 0, 0],
  };
  PARTS.set(rig.root, parts);
  return parts;
}

// Scratch (module constants, not state — fully overwritten on every use).
const AXIS = new Vector3();
const Y_UP = new Vector3(0, 1, 0);
const Q_TILT = new Quaternion();
const Q_YAW = new Quaternion();

/** Place one wall: outward slide + tangent-axis lean + yaw jitter + scale. */
function placeWall(
  s: ShellSeg,
  out: number,
  drop: number,
  tilt: number,
  yaw: number,
  scale: number,
): void {
  s.wall.position.set(
    s.wallP[0] + s.sin * out,
    s.wallP[1] - drop,
    s.wallP[2] + s.cos * out,
  );
  AXIS.set(s.cos, 0, -s.sin); // ŷ × outward dir: leaning about this tips the top outward
  Q_TILT.setFromAxisAngle(AXIS, tilt);
  Q_YAW.setFromAxisAngle(Y_UP, yaw);
  s.wall.quaternion.copy(Q_TILT).multiply(Q_YAW);
  s.wall.scale.setScalar(s.wallS * scale);
}

/** Place one merlon (its rest yaw `mid` is preserved under the tilt). */
function placeMerlon(
  s: ShellSeg,
  out: number,
  drop: number,
  tilt: number,
  yaw: number,
  scale: number,
): void {
  if (!s.merlon) return;
  s.merlon.position.set(
    s.merlonP[0] + s.sin * out,
    s.merlonP[1] - drop,
    s.merlonP[2] + s.cos * out,
  );
  AXIS.set(s.cos, 0, -s.sin);
  Q_TILT.setFromAxisAngle(AXIS, tilt);
  Q_YAW.setFromAxisAngle(Y_UP, Math.atan2(s.sin, s.cos) + yaw);
  s.merlon.quaternion.copy(Q_TILT).multiply(Q_YAW);
  s.merlon.scale.setScalar(s.merlonS * scale);
}

const rot = (
  rig: CharacterRig,
  name: LimbBone,
  x: number,
  y: number,
  z: number,
): void => {
  rig.bones[name]?.rotation.set(x, y, z);
};

/** lerp all three components of a FOLD/STANCE/HEAP entry with one ease. */
const rot3 = (
  rig: CharacterRig,
  name: LimbBone,
  from: Record<LimbBone, V3>,
  to: Record<LimbBone, V3>,
  e: number,
  addX = 0,
): void => {
  const a = from[name];
  const b = to[name];
  rot(rig, name, lerp(a[0], b[0], e) + addX, lerp(a[1], b[1], e), lerp(a[2], b[2], e));
};

// ── Unfold ───────────────────────────────────────────────────────────────────

/**
 * Petrified tower → battle stance.
 * Beats: 0–0.25 shudder (tremor swells, dust); 0.25–0.55 seams part while
 * the hips RISE (co-animated, per the clipping handoff); 0.45–0.85 limbs
 * unfold with overlap (legs plant before the arms finish); 0.85–1 the head
 * emerges and the stance settles.
 */
export function unfoldJotunn(rig: CharacterRig, time: number): void {
  const t = clamp01(time);
  const p = partsOf(rig);
  if (!p) return;

  // Tremor swells out of stillness and dies as the seams finish parting.
  const tremor = smooth(win(t, 0.03, 0.2)) * (1 - smooth(win(t, 0.5, 0.68)));
  // Anticipation: the shell inhales — a slight inward squeeze and hip dip
  // right before the seams burst.
  const squeeze = bump(win(t, 0.05, 0.3));

  // Seams part — staggered per segment, mild overshoot.
  for (let i = 0; i < p.segs.length; i++) {
    const s = p.segs[i];
    const st = h01(i, 11) * 0.05;
    const e = backOut(win(t, 0.25 + st, 0.53 + st), 1.4);
    const out =
      WALL_OUT * e -
      0.02 * squeeze +
      tremor * 0.008 * Math.sin(t * 95 + h01(i, 12) * TAU);
    const tilt = WALL_TILT * e;
    const drop = WALL_DROP * e;
    const yaw = tremor * 0.02 * Math.sin(t * 88 + h01(i, 13) * TAU);
    placeWall(s, out, drop, tilt, yaw, 1);
    placeMerlon(
      s,
      out + Math.sin(tilt) * s.lever,
      drop + (1 - Math.cos(tilt)) * s.lever,
      tilt,
      yaw,
      1,
    );
  }

  // The cap slides off backward first, then descends — clear of the rising
  // shoulders before the head emerges.
  if (p.cap) {
    const zE = smooth(win(t, 0.28, 0.55));
    const yE = smooth(win(t, 0.34, 0.72));
    const wob = tremor * 0.03;
    p.cap.position.set(
      p.capP[0] + wob * Math.sin(t * 90 + 2.1),
      lerp(p.capP[1], CAP_END_Y, yE) + 0.22 * bump(yE),
      p.capP[2] + CAP_SLIDE * zE,
    );
    p.cap.rotation.set(
      CAP_TILT * yE + wob * 0.4 * Math.sin(t * 84 + 0.7),
      CAP_YAW * zE,
      0,
    );
  }

  // Hips rise in the same beats as the parting seams — slight overshoot,
  // then the settle as the feet take the weight.
  const rise = smooth(win(t, 0.28, 0.7));
  const settle = smooth(win(t, 0.7, 0.9));
  p.hips.position.y =
    p.hipsRestY -
    0.035 * squeeze +
    (HIP_RISE + 0.03) * rise -
    0.03 * settle +
    tremor * 0.006 * Math.sin(t * 100 + 3.7);
  p.hips.rotation.set(tremor * 0.01 * Math.sin(t * 97 + 2.2), 0, 0);
  if (p.shell) {
    p.shell.rotation.set(
      tremor * 0.012 * Math.sin(t * 82 + 1.3),
      tremor * 0.02 * Math.sin(t * 91 + 0.4),
      tremor * 0.012 * Math.sin(t * 77 + 4.0),
    );
  }

  // Limbs unfold outward, overlapped — left leg leads, right follows, arms
  // trail, hands last; legs are planted (0.72) before arms finish (0.92).
  // A last knee/elbow squeeze right before release is the wind-up.
  const windLegs = 0.06 * bump(win(t, 0.33, 0.47));
  const windArms = 0.05 * bump(win(t, 0.45, 0.58));
  const micro = 0.015 * Math.sin(TAU * win(t, 0.86, 1)) * (1 - win(t, 0.86, 1));

  rot3(rig, 'legL', FOLD, STANCE, backOut(win(t, 0.45, 0.68), 1.2), windLegs);
  rot3(rig, 'shinL', FOLD, STANCE, backOut(win(t, 0.48, 0.7), 1.2), -windLegs);
  rot3(rig, 'legR', FOLD, STANCE, backOut(win(t, 0.5, 0.72), 1.2), windLegs);
  rot3(rig, 'shinR', FOLD, STANCE, backOut(win(t, 0.53, 0.74), 1.2), -windLegs);
  rot3(rig, 'armL', FOLD, STANCE, easeOutCubic(win(t, 0.55, 0.85)), windArms);
  rot3(rig, 'forearmL', FOLD, STANCE, easeOutCubic(win(t, 0.6, 0.89)));
  rot3(rig, 'armR', FOLD, STANCE, easeOutCubic(win(t, 0.59, 0.88)), windArms);
  rot3(rig, 'forearmR', FOLD, STANCE, easeOutCubic(win(t, 0.64, 0.92)));
  rot3(rig, 'handL', FOLD, STANCE, smooth(win(t, 0.7, 0.95)));
  rot3(rig, 'handR', FOLD, STANCE, smooth(win(t, 0.72, 0.96)));
  rot3(
    rig, 'spine', FOLD, STANCE,
    smooth(win(t, 0.38, 0.78)),
    micro + tremor * 0.02 * Math.sin(t * 85 + 1.1),
  );
  rot3(rig, 'chest', FOLD, STANCE, smooth(win(t, 0.45, 0.82)));
  // Head last: emerges with a small overshoot and levels into the stance.
  rot3(
    rig, 'head', FOLD, STANCE,
    backOut(win(t, 0.82, 0.97), 1.7),
    tremor * 0.025 * Math.sin(t * 80 + 2.8),
  );
}

// ── Fold ─────────────────────────────────────────────────────────────────────

/**
 * Battle stance → petrified tower. The reverse journey, but heavier and in
 * reversed beat order: the head bows first, arms draw in, the legs give way
 * as the hips drop, and the shell segments slam shut at t≈0.85 (cue
 * 'impact-stone' at JOTUNN_BEATS.limbs) with a settle to dead rest by t=1.
 */
export function foldJotunn(rig: CharacterRig, time: number): void {
  const t = clamp01(time);
  const p = partsOf(rig);
  if (!p) return;

  // Gather: he straightens and draws up before committing to the fold.
  const gather = bump(win(t, 0.04, 0.3));
  // Slam settle: a short shiver after the shell bites shut, dead by t=1.
  const settleSeg = win(t, 0.85, 1);
  const jolt = bump(settleSeg) * (1 - settleSeg) * Math.sin(t * 120);

  // Head bows first, then the arms wrap, then the legs give way — heavier
  // ease-in curves than the unfold's release.
  rot3(rig, 'head', STANCE, FOLD, smooth(win(t, 0.15, 0.48)), -0.15 * gather);
  rot3(rig, 'armL', STANCE, FOLD, smooth(win(t, 0.2, 0.52)), -0.12 * gather);
  rot3(rig, 'armR', STANCE, FOLD, smooth(win(t, 0.23, 0.55)), -0.12 * gather);
  rot3(rig, 'forearmL', STANCE, FOLD, smooth(win(t, 0.24, 0.56)));
  rot3(rig, 'forearmR', STANCE, FOLD, smooth(win(t, 0.27, 0.59)));
  rot3(rig, 'handL', STANCE, FOLD, smooth(win(t, 0.2, 0.5)));
  rot3(rig, 'handR', STANCE, FOLD, smooth(win(t, 0.22, 0.52)));
  rot3(rig, 'chest', STANCE, FOLD, smooth(win(t, 0.3, 0.6)));
  rot3(rig, 'spine', STANCE, FOLD, smooth(win(t, 0.32, 0.64)), -0.04 * gather);
  rot3(rig, 'legL', STANCE, FOLD, easeInCubic(win(t, 0.32, 0.6)));
  rot3(rig, 'shinL', STANCE, FOLD, easeInCubic(win(t, 0.34, 0.62)));
  rot3(rig, 'legR', STANCE, FOLD, easeInCubic(win(t, 0.36, 0.64)));
  rot3(rig, 'shinR', STANCE, FOLD, easeInCubic(win(t, 0.38, 0.66)));

  // Hips: a small draw-up, then a heavy accelerating drop that seats with a
  // thud (dips past rest, recovers).
  const drop = easeInCubic(win(t, 0.3, 0.66));
  const thud = bump(win(t, 0.66, 0.86));
  p.hips.position.y =
    p.hipsRestY +
    HIP_RISE * (1 - drop) +
    0.03 * gather -
    0.02 * thud +
    jolt * 0.004;
  p.hips.rotation.set(jolt * 0.008, 0, 0);

  // Shell: waits for the limbs (legs are folded by 0.66), then the segments
  // slam shut — accelerating ease-in, biting slightly past rest and easing
  // back. Grind wobble while they travel.
  for (let i = 0; i < p.segs.length; i++) {
    const s = p.segs[i];
    const st = h01(i, 21) * 0.04;
    const e = 1 - easeInCubic(win(t, 0.55 + st, 0.8 + st));
    const compress = 0.02 * bump(win(t, 0.82, 0.96));
    const out = WALL_OUT * e - compress;
    const tilt = WALL_TILT * e;
    const wallDrop = WALL_DROP * e;
    const yaw =
      h11(i, 23) * 0.01 * bump(win(t, 0.55, 0.85)) + jolt * 0.01 * h11(i, 22);
    placeWall(s, out, wallDrop, tilt, yaw, 1);
    placeMerlon(
      s,
      out + Math.sin(tilt) * s.lever,
      wallDrop + (1 - Math.cos(tilt)) * s.lever,
      tilt,
      yaw,
      1,
    );
  }

  // Cap swings back up over the shoulders and seats just before the slam.
  if (p.cap) {
    const yE = 1 - smooth(win(t, 0.42, 0.74)); // 1 = on the ground
    const zE = 1 - smooth(win(t, 0.5, 0.8));
    p.cap.position.set(
      p.capP[0],
      lerp(p.capP[1], CAP_END_Y, yE) + 0.3 * bump(yE),
      p.capP[2] + CAP_SLIDE * zE,
    );
    p.cap.rotation.set(CAP_TILT * yE + jolt * 0.01, CAP_YAW * zE, 0);
  }

  if (p.shell) {
    p.shell.rotation.set(
      0.02 * bump(win(t, 0.8, 0.95)) + jolt * 0.008,
      jolt * 0.012,
      jolt * 0.008,
    );
  }
}

// ── Crumble ──────────────────────────────────────────────────────────────────

/**
 * Defeat, from the battle stance: cracks propagate along the seams (scale
 * and rotation jitter driven by hash32 of the fragment index — never prng),
 * the limbs collapse inward, the shell fragments fall flat, and the whole
 * heap sinks below the board plane by t=1 (root.y = -SINK_DEPTH). Victims
 * are cleared by the director afterwards; the horse business is other rows'
 * problem — stone may shatter, and here it does.
 */
export function crumbleJotunn(rig: CharacterRig, time: number): void {
  const t = clamp01(time);
  const p = partsOf(rig);
  if (!p) return;

  // Crack envelope: swells, saturates through the collapse, dies as the
  // heap sinks (so t=1 is a clean, jitter-free state).
  const crack = smooth(win(t, 0.02, 0.22)) * (1 - smooth(win(t, 0.72, 0.92)));
  const jr = (i: number, salt: number, f: number): number =>
    crack * Math.sin(t * f + h01(i, salt) * TAU);

  // Limbs lose coherence and collapse inward, staggered.
  rot3(rig, 'legL', STANCE, HEAP, smooth(win(t, 0.22, 0.5)), 0.04 * jr(1, 31, 73));
  rot3(rig, 'shinL', STANCE, HEAP, smooth(win(t, 0.25, 0.53)), 0.04 * jr(2, 31, 67));
  rot3(rig, 'legR', STANCE, HEAP, smooth(win(t, 0.27, 0.55)), 0.04 * jr(3, 31, 79));
  rot3(rig, 'shinR', STANCE, HEAP, smooth(win(t, 0.3, 0.58)), 0.04 * jr(4, 31, 61));
  rot3(rig, 'armL', STANCE, HEAP, smooth(win(t, 0.25, 0.56)), 0.05 * jr(5, 31, 71));
  rot3(rig, 'forearmL', STANCE, HEAP, smooth(win(t, 0.28, 0.59)), 0.05 * jr(6, 31, 83));
  rot3(rig, 'armR', STANCE, HEAP, smooth(win(t, 0.28, 0.6)), 0.05 * jr(7, 31, 69));
  rot3(rig, 'forearmR', STANCE, HEAP, smooth(win(t, 0.31, 0.62)), 0.05 * jr(8, 31, 77));
  rot3(rig, 'handL', STANCE, HEAP, smooth(win(t, 0.3, 0.58)));
  rot3(rig, 'handR', STANCE, HEAP, smooth(win(t, 0.32, 0.6)));
  rot3(rig, 'chest', STANCE, HEAP, smooth(win(t, 0.3, 0.6)), 0.03 * jr(9, 31, 88));
  rot3(rig, 'spine', STANCE, HEAP, smooth(win(t, 0.3, 0.62)), 0.03 * jr(10, 31, 92));
  rot3(rig, 'head', STANCE, HEAP, smooth(win(t, 0.28, 0.55)), 0.04 * jr(11, 31, 96));

  // Hips sag as the legs buckle, then a second, smaller give.
  const sag = easeInCubic(win(t, 0.22, 0.6));
  const slump = smooth(win(t, 0.55, 0.8));
  p.hips.position.y =
    p.hipsRestY +
    HIP_RISE -
    (HIP_RISE + 0.22) * sag -
    0.08 * slump +
    crack * 0.008 * Math.sin(t * 105 + 1.9);
  p.hips.rotation.set(crack * 0.012 * Math.sin(t * 99 + 0.8), 0.15 * sag, 0);

  // Shell fragments shudder apart and fall flat around the heap, each on
  // its own hash-derived timing, with a small pop at touchdown.
  for (let i = 0; i < p.segs.length; i++) {
    const s = p.segs[i];
    const st = 0.15 * h01(i, 41);
    const e = easeInCubic(win(t, 0.2 + st, 0.55 + st));
    const eM = easeInCubic(win(t, 0.24 + st, 0.58 + st));
    const pop = 0.03 * bump(win(t, 0.5 + st, 0.62 + st));
    const scale = 1 + 0.05 * jr(i, 44, 60 + 30 * h01(i, 47));
    placeWall(
      s,
      lerp(WALL_OUT, 0.5 + 0.08 * h01(i, 42), e),
      lerp(WALL_DROP, 0.52, e) - pop,
      lerp(WALL_TILT, 0.85 + 0.3 * h11(i, 43), e),
      0.4 * h11(i, 48) * e + 0.02 * jr(i, 49, 90),
      scale,
    );
    placeMerlon(
      s,
      lerp(WALL_OUT + Math.sin(WALL_TILT) * s.lever, 0.55 + 0.12 * h01(i, 45), eM),
      lerp(WALL_DROP + (1 - Math.cos(WALL_TILT)) * s.lever, s.lever + 0.49, eM) - pop,
      lerp(WALL_TILT, 1.3 + 0.5 * h11(i, 46), eM),
      0.6 * h11(i, 50) * eM + 0.03 * jr(i, 51, 84),
      scale,
    );
  }

  // Cap (already on the ground behind him) skids a little and rocks.
  if (p.cap) {
    const skid = smooth(win(t, 0.3, 0.7));
    p.cap.position.set(
      p.capP[0] + crack * 0.01 * Math.sin(t * 93 + 3.3),
      CAP_END_Y,
      p.capP[2] + CAP_SLIDE + 0.12 * skid,
    );
    p.cap.rotation.set(CAP_TILT + 0.1 * skid, CAP_YAW, 0);
  }

  if (p.shell) {
    p.shell.rotation.set(
      crack * 0.015 * Math.sin(t * 76 + 0.9),
      crack * 0.02 * Math.sin(t * 83 + 2.5),
      crack * 0.015 * Math.sin(t * 71 + 4.4),
    );
  }

  // The heap sinks away: a slight early settle under its own weight, then
  // the whole rig descends below the board plane.
  const root = rig.bones.root;
  if (root) {
    root.position.y =
      -0.06 * smooth(win(t, 0.25, 0.55)) -
      (SINK_DEPTH - 0.06) * easeInCubic(win(t, 0.5, 1));
  }
}
