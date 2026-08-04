/**
 * The six defeat readings, one per victim, shared by every attacker row
 * (DUELS.md: "Defeat readings per victim, used by every attacker row"). A cell
 * choreographs its own attack and hands the victim's last beats to
 * `defeatVictim`, which also fires that victim's fall and vocal cues — so
 * every one of the 35 cells gets its mandated reading and its vocal accent
 * from one place.
 *
 * Victims are defeated, not butchered: no gore, no dismemberment of flesh.
 * Stone shatters (the jötunn) and a horse always walks away (the berserkr).
 *
 * Timing: `k` is the reading's own 0→1 clock, so a cell can spend as much or
 * as little of its duel on the collapse. Cues are placed on k, which is always
 * at least as fast as the duel clock, so the director's re-fire guard still
 * collapses each beat to a single emission.
 *
 * The reading opens from a guard-like keyframe; keep the victim near guard as
 * its window opens or the first frame will pop.
 *
 * Bone positions (hips, and the berserkr's mount) are restored at k=1. The
 * director hides the victim in the same finish() call that samples t=1, so the
 * restore is never seen — and it keeps a rig that syncBoard recycles for
 * another piece of the same type and colour from carrying a dropped hip or a
 * bolted-away horse onto the board.
 */

import type { CharacterRig, DuelContext } from '../../core/stage.ts';
import { groundDust } from '../dust.ts';
import { crumbleJotunn } from '../jotunn.ts';
import { clamp01, easeInCubic, easeOutCubic, lerp, phase } from '../motion.ts';
import {
  applyPose,
  blendPose,
  cueAt,
  faceRider,
  mountLegs,
  mountRear,
  nudge,
  place,
  restOf,
  restoreHips,
  restoreMount,
  seatRider,
  sinkHips,
  type Pose,
  type Staging,
} from './support.ts';

const smooth = (x: number): number => x * x * (3 - 2 * x);
/** Half-sine pulse: 0 at both ends, 1 in the middle. */
const bump = (x: number): number => Math.sin(Math.PI * clamp01(x));

// ── Huscarl: shield fails him; drops to a knee, falls ───────────────────────

type HusBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR'
  | 'weapon' | 'shield';

const HUS_GUARD: Pose<HusBone> = {
  spine: [0.12, 0, 0], chest: [0, 0, 0], head: [-0.1, 0, 0],
  armL: [0.85, 0, 0.1], forearmL: [0.5, 0, 0],
  armR: [0.6, 0, -0.15], forearmR: [0.9, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.08, 0, 0.05], shinL: [-0.12, 0, 0],
  legR: [-0.06, 0, -0.05], shinR: [-0.1, 0, 0],
  weapon: [0, 0, 0], shield: [0, 0, 0],
};

/** The boss is struck away and the shield arm is beaten wide. */
const HUS_BROKEN: Pose<HusBone> = {
  spine: [-0.12, 0.18, 0], chest: [0.05, 0.1, 0], head: [0.15, 0.22, 0],
  armL: [0.35, 0, 0.85], forearmL: [1.05, 0, 0.2],
  armR: [0.3, 0, -0.3], forearmR: [1.2, 0, 0],
  handL: [0, 0, 0.3], handR: [0, 0, 0],
  legL: [0.3, 0, 0.08], shinL: [-0.45, 0, 0],
  legR: [-0.2, 0, -0.08], shinR: [-0.2, 0, 0],
  weapon: [0.25, 0, 0], shield: [0.4, 0, 0.5],
};

/** Right knee down, weight on the spear, shield hanging off a slack arm. */
const HUS_KNEE: Pose<HusBone> = {
  spine: [0.42, 0.1, 0], chest: [0.16, 0.06, 0], head: [0.4, 0.08, 0],
  armL: [0.15, 0, 0.55], forearmL: [0.7, 0, 0.15],
  armR: [0.5, 0, -0.2], forearmR: [0.35, 0, 0],
  handL: [0, 0, 0.2], handR: [-0.5, 0, 0],
  legL: [0.62, 0, 0.1], shinL: [-0.75, 0, 0],
  legR: [-0.55, 0, -0.1], shinR: [-1.75, 0, 0],
  weapon: [-1.1, 0, 0], shield: [0.55, 0, 0.35],
};

/** Fallen: the spear has rolled out of his hand, the shield lies under him. */
const HUS_DOWN: Pose<HusBone> = {
  spine: [0.1, 0.12, 0], chest: [0.05, 0.05, 0], head: [0.25, 0.3, 0],
  armL: [-0.3, 0, 1.1], forearmL: [0.35, 0, 0.25],
  armR: [-0.45, 0, -0.65], forearmR: [0.2, 0, 0],
  handL: [0, 0, 0.15], handR: [-1.4, 0, 0],
  legL: [0.35, 0, 0.22], shinL: [-0.5, 0, 0],
  legR: [-0.15, 0, -0.3], shinR: [-0.9, 0, 0],
  weapon: [-1.55, 0.3, 0], shield: [0.7, 0, 0.2],
};

function defeatHuscarl(
  ctx: DuelContext,
  v: CharacterRig,
  k: number,
  s: Staging,
  fx: number,
  fy: number,
  fz: number,
): void {
  const fail = smooth(phase(k, 0, 0.3));
  const kneel = smooth(phase(k, 0.25, 0.62));
  const fall = easeInCubic(phase(k, 0.55, 0.95));
  const settle = smooth(phase(k, 0.9, 1));

  blendPose(v, HUS_GUARD, HUS_BROKEN, fail);
  if (kneel > 0) blendPose(v, HUS_BROKEN, HUS_KNEE, kneel);
  if (fall > 0) blendPose(v, HUS_KNEE, HUS_DOWN, fall);
  // The arm that lost the shield keeps shaking until the knee lands.
  nudge(v, 'forearmL', 0.06 * bump(phase(k, 0.05, 0.35)));

  if (k >= 1) restoreHips(v);
  else sinkHips(v, 0.2 * kneel + 0.02 * bump(phase(k, 0.55, 0.75)));

  // He topples backward off the planted knee, pivoting at the board.
  place(
    v,
    lerp(fx, s.vx, smooth(phase(k, 0, 0.5))),
    lerp(fy, s.y, smooth(phase(k, 0, 0.4))),
    lerp(fz, s.vz, smooth(phase(k, 0, 0.5))),
    s.vy + 0.16 * fail + 0.1 * fall,
    1.12 * fall - 0.04 * settle,
    0.1 * fall,
  );

  cueAt(ctx, k, 0.02, 'impact-shield', 0.8);
  cueAt(ctx, k, 0.3, 'vocal:huscarl', 0.7);
  cueAt(ctx, k, 0.62, 'fall', 0.75);
}

// ── Berserkr: unhorsed; the horse always survives and bolts offstage ────────

/**
 * The horse's bones are in here so that victimGuard reseats them every frame:
 * a cell that gallops or rears its victim does so with nudge(), which adds to
 * whatever is already on the bone — without a baseline the additions would
 * accumulate frame over frame and the script would stop being a function of t.
 */
type RiderBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR' | 'weapon'
  | 'mount' | 'mountHead';

const RIDE_GUARD: Pose<RiderBone> = {
  spine: [0.15, 0, 0], chest: [0, 0, 0], head: [-0.05, 0, 0],
  armL: [0.9, 0, 0.25], forearmL: [0.7, 0, 0],
  armR: [0.9, 0, -0.25], forearmR: [0.7, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.55, 0, 0.45], shinL: [-1.0, 0, 0],
  legR: [0.55, 0, -0.45], shinR: [-1.0, 0, 0],
  weapon: [0, 0, 0],
  mount: [0, 0, 0], mountHead: [0.1, 0, 0],
};

/** Thrown: he is off the saddle with nothing under him. */
const RIDE_THROWN: Pose<RiderBone> = {
  spine: [-0.35, 0.2, 0], chest: [-0.1, 0.12, 0], head: [-0.3, 0.25, 0],
  armL: [2.1, 0, 0.7], forearmL: [0.5, 0, 0.2],
  armR: [1.9, 0, -0.8], forearmR: [0.6, 0, 0],
  handL: [0, 0, 0.4], handR: [0.3, 0, 0],
  legL: [1.15, 0, 0.6], shinL: [-1.5, 0, 0],
  legR: [0.95, 0, -0.55], shinR: [-1.2, 0, 0],
  weapon: [0.5, 0, 0],
  // Overwritten immediately below by the rear/bolt; present only to keep the
  // tables keyed alike.
  mount: [0, 0, 0], mountHead: [0, 0, 0],
};

/**
 * Grounded and still, both axes loose on the board beside him. Read together
 * with the hips pitch of ~1.5 rad that faceRider puts under it: the limbs are
 * near-straight here BECAUSE the pelvis is on its back, so thighs and torso lie
 * along the board instead of hanging off it. Bending them, as a seated pose
 * would, is what used to leave him horizontal but a third of a unit up in the
 * air, resting on his boot soles.
 */
const RIDE_DOWN: Pose<RiderBone> = {
  spine: [0.1, 0.16, 0], chest: [0.06, 0.08, 0], head: [0.75, 0.42, 0],
  armL: [-0.5, 0, 1.25], forearmL: [0.25, 0, 0.35],
  armR: [-0.55, 0, -1.05], forearmR: [0.2, 0, 0],
  handL: [0, 0, 0.2], handR: [-1.3, 0, 0],
  legL: [-0.19, 0, 0.3], shinL: [-0.18, 0, 0],
  legR: [-0.31, 0, -0.26], shinR: [-0.3, 0, 0],
  weapon: [-1.5, 0.4, 0],
  mount: [0, 0, 0], mountHead: [0, 0, 0],
};

/**
 * Pelvis height of a man lying on the board. Measured against RIDE_DOWN with
 * the hips attitude below: at 0.26 his shoulder is 12mm off the board, his
 * helm 72mm and his boots 44mm — a body resting on it, with nothing through it.
 */
const RIDER_DOWN_Y = 0.26;
/**
 * Pelvis height at the instant he touches down, while he is still in the
 * tucked, thrown pose — 60mm higher, because a tucked body reaches further
 * below its own pelvis than a slack one. He lands on this and settles onto
 * RIDER_DOWN_Y as he goes limp, which is also just what a body does.
 */
const RIDER_THROWN_Y = 0.32;
/** Fraction of the flight at which he is at the top of his arc. */
const RIDER_APEX = 0.35;

/**
 * The horse rears, throws him, and bolts to its own right; the rider goes over
 * its shoulder and HITS THE BOARD on the other side.
 *
 * The fall is a real parabola, not an ease. Solving y(0) = seated,
 * y(1) = grounded with the peak at RIDER_APEX gives a launch and a gravity that
 * make him accelerate all the way into the board — an eased descent reads as a
 * man being lowered, which is what this used to look like, and it left him
 * hanging a third of a unit above the square because the target height was
 * written as an absolute board height where a saddle-relative offset was
 * wanted. The landing height is now derived from the rig's own seat.
 *
 * The rider's hips hang off the mount bone, so unhorsing means moving the horse
 * out from under him: his desired offset from the rig root is converted back
 * into mount-local space each frame. seatRider gets level=1 from the moment he
 * leaves the saddle — the horse is rearing and rolling into its bolt underneath
 * him, and without cancelling that his landing height would be whatever the
 * horse's roll happened to leave, not the board.
 */
function defeatBerserkr(
  ctx: DuelContext,
  v: CharacterRig,
  k: number,
  s: Staging,
  fx: number,
  fy: number,
  fz: number,
): void {
  const r = restOf(v);
  const rear = smooth(phase(k, 0, 0.26));
  const drop = smooth(phase(k, 0.26, 0.46));
  // The flight has its own clock: out of the saddle at 0.2, on the board at
  // 0.56. `land` is the body going slack once it is down, `skid` the carry.
  const air = clamp01(phase(k, 0.2, 0.56));
  const land = smooth(phase(k, 0.54, 0.78));
  const skid = smooth(phase(k, 0.56, 0.84));
  const bolt = easeInCubic(phase(k, 0.34, 1));

  blendPose(v, RIDE_GUARD, RIDE_THROWN, smooth(phase(k, 0.12, 0.46)));
  if (land > 0) blendPose(v, RIDE_THROWN, RIDE_DOWN, land);

  const mount = r.mount;
  const hips = v.bones.hips;
  if (mount) {
    // Rear, come down, then run: a yaw away from the duel line as it goes.
    const pitch = 0.85 * rear - 0.85 * drop - 0.1 * bump(phase(k, 0.3, 0.5));
    const yaw = -1.25 * smooth(phase(k, 0.34, 0.75));
    const run = 3.8 * bolt;
    mount.rotation.set(pitch, yaw, 0.12 * bolt);
    mount.position.set(
      r.mountP[0] + run,
      r.mountP[1] + 0.06 * bump(phase(k, 0.34, 1)),
      r.mountP[2] - 0.35 * bolt,
    );
    // Front hooves paw the air on the way up; once all four are down it
    // gallops out. The handover is at drop = 1, where both are at zero.
    const upright = rear * (1 - drop);
    if (upright > 0) mountRear(v, upright, k * 46);
    else mountLegs(v, k * 44, 0.55 * bolt);
    const head = v.bones.mountHead;
    if (head) {
      head.rotation.set(
        -0.55 * rear + 0.3 * drop + 0.12 * Math.sin(k * 34) * bolt,
        0.35 * bolt,
        0,
      );
    }

    if (hips) {
      const sit = r.mountP[1] + r.mountHipsP[1];
      // y(a) = sit + v0·a − g·a², peaking at RIDER_APEX and reaching
      // RIDER_DOWN_Y at a = 1. Held at the floor for a >= 1.
      // Peak at RIDER_APEX means v0 = 2·APEX·g; y(1) = sit + v0 − g then fixes
      // g = (sit − touchdown) / (1 − 2·APEX).
      const g = (sit - RIDER_THROWN_Y) / (1 - 2 * RIDER_APEX);
      const v0 = 2 * RIDER_APEX * g;
      const arc = sit + v0 * air - g * air * air;
      // Then he goes slack and settles the last few centimetres, plus one
      // shallow bounce off the shoulder that hit first.
      const slack = lerp(0, RIDER_DOWN_Y - RIDER_THROWN_Y, land);
      const bounce = 0.045 * bump(phase(k, 0.56, 0.7));
      // Out of the saddle fast, then coasting; the skid carries him after.
      const out = easeOutCubic(air);
      seatRider(
        v,
        (-0.62 - r.mountHipsP[0]) * out - 0.16 * skid,
        arc + slack + bounce - sit,
        (0.22 - r.mountHipsP[2]) * out + 0.08 * skid,
        1,
      );
      // Over the shoulder head-first in the air, then flat and slack — and in
      // the rig's own frame from the moment he is off, or the horse's turn as
      // it bolts would swing the body lying on the board round with it.
      faceRider(
        v,
        0.35 * air + 1.2 * land,
        0.25 * air * (1 - land) + 0.2 * land,
        0.2 * air * (1 - land) + 0.25 * land,
        air,
      );
    }
  }

  if (k >= 1) {
    restoreMount(v);
    if (hips) hips.rotation.set(0, 0, 0);
  }

  place(
    v,
    lerp(fx, s.vx, smooth(phase(k, 0, 0.5))),
    lerp(fy, s.y, smooth(phase(k, 0, 0.4))),
    lerp(fz, s.vz, smooth(phase(k, 0, 0.5))),
    s.vy,
  );

  cueAt(ctx, k, 0.02, 'horse', 0.85);
  cueAt(ctx, k, 0.3, 'vocal:berserkr', 0.75);
  // On the frame he actually lands, not a guess at it.
  cueAt(ctx, k, 0.56, 'fall', 0.85);
  cueAt(ctx, k, 0.72, 'horse', 0.5);
}

// ── Völva: staff broken or grounded; hood collapses as if empty ─────────────

type VolvaBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'cloak' | 'staff';

const VOL_GUARD: Pose<VolvaBone> = {
  spine: [0.1, 0, 0], chest: [0, 0, 0], head: [-0.05, 0, 0],
  armR: [1.15, 0, -0.15], forearmR: [0.3, 0, 0],
  armL: [0.7, 0, 0.3], forearmL: [0.8, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  cloak: [0, 0, 0], staff: [0, 0, 0],
};

/** The staff is struck out of true — driven down and across her body. */
const VOL_GROUNDED: Pose<VolvaBone> = {
  spine: [-0.15, 0.2, 0], chest: [0.08, 0.1, 0], head: [0.1, 0.28, 0],
  armR: [0.15, 0, -0.6], forearmR: [0.75, 0, 0],
  armL: [0.3, 0, 0.7], forearmL: [1.1, 0, 0],
  handL: [0, 0, 0.25], handR: [-0.7, 0, 0],
  cloak: [0.12, 0, 0], staff: [1.15, 0, 0.35],
};

/**
 * The hood collapses as if empty: the head folds fully forward so the hood's
 * mouth faces the board and the shadow disc reads as a hollow, and the robe
 * pools as she sinks. She has no legs — she crumples straight down rather than
 * toppling.
 */
const VOL_EMPTY: Pose<VolvaBone> = {
  spine: [0.62, 0.1, 0], chest: [0.3, 0.05, 0], head: [1.25, 0.15, 0],
  armR: [-0.2, 0, -0.35], forearmR: [0.25, 0, 0],
  armL: [-0.15, 0, 0.4], forearmL: [0.35, 0, 0],
  handL: [0, 0, 0.1], handR: [-1.2, 0, 0],
  cloak: [0.5, 0, 0], staff: [1.5, 0.2, 0.5],
};

function defeatVolva(
  ctx: DuelContext,
  v: CharacterRig,
  k: number,
  s: Staging,
  fx: number,
  fy: number,
  fz: number,
): void {
  const ground = smooth(phase(k, 0, 0.32));
  // One long collapse rather than two overlapping ones: she has no legs to
  // kneel with, so the robe simply pools from the moment the staff goes down.
  const empty = smooth(phase(k, 0.28, 0.96));

  blendPose(v, VOL_GUARD, VOL_GROUNDED, ground);
  if (empty > 0) blendPose(v, VOL_GROUNDED, VOL_EMPTY, empty);
  // One last shiver through the hood before it goes slack.
  nudge(v, 'head', 0.05 * bump(phase(k, 0.35, 0.6)));

  if (k >= 1) restoreHips(v);
  else sinkHips(v, 0.16 * empty);

  place(
    v,
    lerp(fx, s.vx, smooth(phase(k, 0, 0.45))),
    lerp(fy, s.y, smooth(phase(k, 0, 0.4))) - 0.1 * empty,
    lerp(fz, s.vz, smooth(phase(k, 0, 0.45))),
    s.vy + 0.2 * ground,
    0.22 * empty,
    0.08 * ground,
  );

  cueAt(ctx, k, 0.02, 'impact-metal', 0.7);
  cueAt(ctx, k, 0.28, 'vocal:volva', 0.7);
  cueAt(ctx, k, 0.62, 'fall', 0.55);
}

// ── Jötunn: cracks along its seams, collapses into a rubble heap ────────────

/**
 * Delegates to the shared crumble, which owns the jötunn's hips, shell
 * fragments and root height (it sinks the heap below the board plane by k=1).
 * Only x/z and facing are ours to set — writing root.y here would fight it.
 */
function defeatJotunn(
  ctx: DuelContext,
  v: CharacterRig,
  k: number,
  s: Staging,
  fx: number,
  _fy: number,
  fz: number,
): void {
  const settle = smooth(phase(k, 0, 0.45));
  v.root.position.x = lerp(fx, s.vx, settle);
  v.root.position.z = lerp(fz, s.vz, settle);
  v.root.rotation.order = 'YXZ';
  v.root.rotation.set(0, s.vy, 0);
  crumbleJotunn(v, k);

  cueAt(ctx, k, 0.02, 'stone-grind', 0.9);
  cueAt(ctx, k, 0.3, 'vocal:jotunn', 0.8);
  cueAt(ctx, k, 0.55, 'impact-stone', 0.85);
}

// ── Valkyrie: brought out of the air; wings fold over her as she kneels ─────

type ValkBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR'
  | 'wingL' | 'wingR' | 'weapon' | 'shield';

const VAL_GUARD: Pose<ValkBone> = {
  spine: [0.1, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
  armR: [1.1, 0, -0.2], forearmR: [0.45, 0, 0],
  armL: [0.8, 0, 0.15], forearmL: [0.5, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.1, 0, 0.06], shinL: [-0.15, 0, 0],
  legR: [-0.08, 0, -0.06], shinR: [-0.12, 0, 0],
  wingL: [0, 0, 0.35], wingR: [0, 0, -0.35],
  weapon: [0, 0, 0], shield: [0, 0, 0],
};

/** The air spills out from under her — wings stall, back arches. */
const VAL_STALLED: Pose<ValkBone> = {
  spine: [-0.3, 0.15, 0], chest: [-0.12, 0.08, 0], head: [-0.35, 0.2, 0],
  armR: [0.5, 0, -0.75], forearmR: [0.9, 0, 0],
  armL: [1.5, 0, 0.6], forearmL: [0.7, 0, 0],
  handL: [0, 0, 0.3], handR: [0.35, 0, 0],
  legL: [0.75, 0, 0.3], shinL: [-0.95, 0, 0],
  legR: [0.5, 0, -0.25], shinR: [-0.7, 0, 0],
  wingL: [-0.5, -0.4, 1.15], wingR: [-0.5, 0.4, -1.15],
  weapon: [0.4, 0, 0], shield: [0.3, 0, 0],
};

/** Kneeling, spear grounded, wings drawn forward and closed over her. */
const VAL_KNEELING: Pose<ValkBone> = {
  spine: [0.4, 0.05, 0], chest: [0.18, 0, 0], head: [0.5, 0.05, 0],
  armR: [0.35, 0, -0.25], forearmR: [0.3, 0, 0],
  armL: [0.25, 0, 0.3], forearmL: [0.55, 0, 0],
  handL: [0, 0, 0.1], handR: [-0.85, 0, 0],
  legL: [0.7, 0, 0.12], shinL: [-0.85, 0, 0],
  legR: [-0.5, 0, -0.12], shinR: [-1.8, 0, 0],
  // Folded across her, tips nearly meeting: the shroud.
  wingL: [0.55, -1.15, -0.35], wingR: [0.55, 1.15, 0.35],
  weapon: [-1.2, 0, 0], shield: [0.5, 0, 0.2],
};

function defeatValkyrie(
  ctx: DuelContext,
  v: CharacterRig,
  k: number,
  s: Staging,
  fx: number,
  fy: number,
  fz: number,
): void {
  const stall = smooth(phase(k, 0, 0.3));
  const kneel = smooth(phase(k, 0.52, 0.85));
  const fold = smooth(phase(k, 0.6, 0.98));
  // She hangs a moment, then the ground comes up fast.
  const descend = easeInCubic(phase(k, 0.2, 0.62));
  const impact = bump(phase(k, 0.58, 0.72));

  blendPose(v, VAL_GUARD, VAL_STALLED, stall);
  if (kneel > 0) blendPose(v, VAL_STALLED, VAL_KNEELING, kneel);
  // The wings are on their own, slower beat: she is already down on a knee when
  // they come forward and close over her. Set after the body blend, which would
  // otherwise drag them along on the kneel's timing.
  const wl = v.bones.wingL;
  const wr = v.bones.wingR;
  if (wl && wr) {
    for (const [bone, from, to] of [
      [wl, VAL_STALLED.wingL, VAL_KNEELING.wingL],
      [wr, VAL_STALLED.wingR, VAL_KNEELING.wingR],
    ] as const) {
      bone.rotation.set(
        lerp(from[0], to[0], fold),
        lerp(from[1], to[1], fold),
        lerp(from[2], to[2], fold),
      );
    }
  }
  // The last wingbeats that do not catch.
  const flail = bump(phase(k, 0.05, 0.5)) * (1 - fold);
  nudge(v, 'wingL', 0, 0, 0.22 * flail * Math.sin(k * 40));
  nudge(v, 'wingR', 0, 0, -0.22 * flail * Math.sin(k * 40));

  if (k >= 1) restoreHips(v);
  else sinkHips(v, 0.34 * kneel + 0.05 * impact);

  place(
    v,
    lerp(fx, s.vx, smooth(phase(k, 0, 0.6))),
    lerp(fy, s.y, descend),
    lerp(fz, s.vz, smooth(phase(k, 0, 0.6))),
    s.vy + 0.3 * stall - 0.3 * kneel,
    0.28 * stall - 0.1 * kneel,
    0.2 * stall - 0.2 * kneel,
  );

  cueAt(ctx, k, 0.02, 'wing', 0.8);
  cueAt(ctx, k, 0.26, 'vocal:valkyrie', 0.75);
  cueAt(ctx, k, 0.6, 'fall', 0.8);
  cueAt(ctx, k, 0.72, 'wing', 0.5);
}

// ── Jarl: kneels, plants the greatsword, slumps against it ──────────────────

type JarlBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR'
  | 'cloak' | 'weapon';

const JARL_GUARD: Pose<JarlBone> = {
  spine: [0.15, 0, 0], chest: [0, 0, 0], head: [-0.1, 0, 0],
  armR: [1.25, 0, -0.3], forearmR: [0.5, 0, 0],
  armL: [1.1, 0, 0.35], forearmL: [0.6, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.12, 0, 0.08], shinL: [-0.18, 0, 0],
  legR: [-0.1, 0, -0.08], shinR: [-0.14, 0, 0],
  cloak: [0, 0, 0], weapon: [-0.77, 0, 0.35],
};

/** He takes it and gives ground — one step back, no flourish. */
const JARL_STAGGER: Pose<JarlBone> = {
  spine: [-0.22, 0.12, 0], chest: [-0.05, 0.06, 0], head: [0.1, 0.15, 0],
  armR: [0.8, 0, -0.5], forearmR: [0.85, 0, 0],
  armL: [0.7, 0, 0.55], forearmL: [0.95, 0, 0],
  handL: [0, 0, 0.2], handR: [-0.3, 0, 0],
  legL: [0.5, 0, 0.14], shinL: [-0.6, 0, 0],
  legR: [-0.3, 0, -0.14], shinR: [-0.3, 0, 0],
  cloak: [-0.08, 0, 0], weapon: [-0.45, 0, 0.5],
};

/** Down on one knee with the greatsword driven point-first into the board. */
const JARL_PLANTED: Pose<JarlBone> = {
  spine: [0.34, 0.04, 0], chest: [0.12, 0, 0], head: [0.3, 0.04, 0],
  armR: [0.95, 0, -0.12], forearmR: [-0.15, 0, 0],
  armL: [0.9, 0, 0.14], forearmL: [-0.1, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.66, 0, 0.12], shinL: [-0.8, 0, 0],
  legR: [-0.5, 0, -0.12], shinR: [-1.85, 0, 0],
  cloak: [0.15, 0, 0], weapon: [0, 0, 0],
};

/** Slumped against the pommel, head down on his hands. */
const JARL_SLUMPED: Pose<JarlBone> = {
  spine: [0.66, 0.06, 0], chest: [0.26, 0, 0], head: [0.62, 0.08, 0],
  armR: [1.0, 0, -0.1], forearmR: [-0.28, 0, 0],
  armL: [0.96, 0, 0.12], forearmL: [-0.22, 0, 0],
  handL: [0.15, 0, 0], handR: [0.15, 0, 0],
  legL: [0.72, 0, 0.14], shinL: [-0.9, 0, 0],
  legR: [-0.55, 0, -0.14], shinR: [-1.95, 0, 0],
  cloak: [0.34, 0, 0], weapon: [0.06, 0, 0],
};

function defeatJarl(
  ctx: DuelContext,
  v: CharacterRig,
  k: number,
  s: Staging,
  fx: number,
  fy: number,
  fz: number,
): void {
  const stagger = smooth(phase(k, 0, 0.28));
  const kneel = smooth(phase(k, 0.24, 0.66));
  const slump = smooth(phase(k, 0.62, 0.97));
  const breathe = bump(phase(k, 0.72, 1));

  blendPose(v, JARL_GUARD, JARL_STAGGER, stagger);
  if (kneel > 0) blendPose(v, JARL_STAGGER, JARL_PLANTED, kneel);
  if (slump > 0) blendPose(v, JARL_PLANTED, JARL_SLUMPED, slump);
  // The one breath he has left, leaning on the blade.
  nudge(v, 'spine', -0.03 * breathe);
  nudge(v, 'chest', -0.02 * breathe);

  if (k >= 1) restoreHips(v);
  else sinkHips(v, 0.3 * kneel + 0.03 * slump);

  // He gives half a step back before the knee goes down.
  const give = 0.16 * stagger * (1 - kneel);
  place(
    v,
    lerp(fx, s.vx, smooth(phase(k, 0, 0.5))) - s.fx * give,
    lerp(fy, s.y, smooth(phase(k, 0, 0.4))),
    lerp(fz, s.vz, smooth(phase(k, 0, 0.5))) - s.fz * give,
    s.vy + 0.1 * stagger,
    0.06 * slump,
  );

  cueAt(ctx, k, 0.02, 'impact-metal', 0.85);
  cueAt(ctx, k, 0.3, 'vocal:jarl', 0.8);
  cueAt(ctx, k, 0.66, 'impact-stone', 0.5);
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Play the victim's mandated defeat reading, from wherever the cell left it
 * (`fx,fy,fz` — world) down to the captured square. Also fires that victim's
 * fall and vocal cues, which is how every cell satisfies the ≥1 vocal accent
 * rule.
 */
export function defeatVictim(
  ctx: DuelContext,
  k: number,
  s: Staging,
  fx: number,
  fy: number,
  fz: number,
): void {
  const kk = clamp01(k);
  const v = ctx.victim;
  // Dust on the square the victim goes down on, for every reading — a piece
  // dissolves into the board rather than being switched off. Anchored to the
  // ground, so it stays put while the reading drops or sinks the body.
  groundDust(v, kk, s.vx, s.y, s.vz);
  switch (ctx.victimPiece) {
    case 'p':
      defeatHuscarl(ctx, v, kk, s, fx, fy, fz);
      return;
    case 'n':
      defeatBerserkr(ctx, v, kk, s, fx, fy, fz);
      return;
    case 'b':
      defeatVolva(ctx, v, kk, s, fx, fy, fz);
      return;
    case 'r':
      defeatJotunn(ctx, v, kk, s, fx, fy, fz);
      return;
    case 'q':
      defeatValkyrie(ctx, v, kk, s, fx, fy, fz);
      return;
    case 'k':
      defeatJarl(ctx, v, kk, s, fx, fy, fz);
      return;
  }
}

/**
 * Stand the victim in its guard keyframe at a staged point, for the beats
 * before its reading takes over: `gap` back from the captured square along the
 * approach (negative is beyond it — a charge starts there), `side` across it,
 * `lift` above the board. Layer the victim's own action on top with nudge().
 *
 * The jötunn is skipped: its tower form is unfolded by the cell, not posed.
 */
export function victimGuard(
  ctx: DuelContext,
  s: Staging,
  gap = 0,
  side = 0,
  lift = 0,
  yaw = s.vy,
): void {
  const v = ctx.victim;
  switch (ctx.victimPiece) {
    case 'p': applyPose(v, HUS_GUARD); break;
    case 'n': applyPose(v, RIDE_GUARD); break;
    case 'b': applyPose(v, VOL_GUARD); break;
    case 'q': applyPose(v, VAL_GUARD); break;
    case 'k': applyPose(v, JARL_GUARD); break;
    case 'r': return; // the tower is unfolded by the cell, not posed here
  }
  place(
    v,
    s.vx - s.fx * gap + s.rx * side,
    s.y + lift,
    s.vz - s.fz * gap + s.rz * side,
    yaw,
  );
}

export { HUS_GUARD, RIDE_GUARD, VOL_GUARD, VAL_GUARD, JARL_GUARD };
