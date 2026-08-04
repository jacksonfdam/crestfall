/**
 * Valkyrie attacks — the queen row, and the airborne one: every cell leaves the
 * ground. She fights in three dimensions and lands standing, which is the whole
 * point of her; the wings are the anticipation for everything.
 *
 * QxK is the only duel in the game allowed to leave ground level with the
 * camera (DUELS.md camera grammar) — it is the only cell here using the 'rise'
 * idea; the rest keep the camera low and let her exit the top of frame.
 *
 * Flight is root height plus a wing beat; she always comes back to the board
 * before the resolve, because the victor walks to idle on the captured square.
 */

import type { CharacterRig, DuelMatrix, DuelScript } from '../../core/stage.ts';
import { unfoldJotunn } from '../jotunn.ts';
import {
  clamp01,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  phase,
} from '../motion.ts';
import { defeatVictim, victimGuard } from './defeat.ts';
import {
  ACT_END,
  blendPose,
  camera,
  cueAt,
  DUR,
  mountLegs,
  nudge,
  placeAt,
  resolve,
  shakeAt,
  sinkHips,
  stageDuel,
  type Pose,
} from './support.ts';

const smooth = (x: number): number => x * x * (3 - 2 * x);
const bump = (x: number): number => Math.sin(Math.PI * clamp01(x));

type QBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR'
  | 'wingL' | 'wingR' | 'weapon' | 'shield';

// ── Pose library ────────────────────────────────────────────────────────────

/** Grounded, spear up, wings furled. */
const GROUND: Pose<QBone> = {
  spine: [0.08, 0, 0], chest: [0, 0, 0], head: [0, 0, 0],
  armR: [0.5, 0, -0.15], forearmR: [0.5, 0, 0],
  armL: [0.4, 0, 0.15], forearmL: [0.45, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.1, 0, 0.06], shinL: [-0.15, 0, 0],
  legR: [-0.08, 0, -0.06], shinR: [-0.12, 0, 0],
  wingL: [0, 0, 0.2], wingR: [0, 0, -0.2],
  weapon: [-0.3, 0, 0], shield: [0, 0, 0],
};

/** The crouch that precedes every take-off. */
const COIL: Pose<QBone> = {
  spine: [0.3, 0, 0], chest: [0.12, 0, 0], head: [-0.2, 0, 0],
  armR: [0.3, 0, -0.3], forearmR: [0.9, 0, 0],
  armL: [0.5, 0, 0.35], forearmL: [0.8, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.85, 0, 0.14], shinL: [-1.05, 0, 0],
  legR: [0.7, 0, -0.14], shinR: [-0.95, 0, 0],
  // Wings gathered high and forward — the down-beat has not happened yet.
  wingL: [-0.35, -0.3, 0.95], wingR: [-0.35, 0.3, -0.95],
  weapon: [-0.5, 0, 0], shield: [0, 0, 0],
};

/** Climbing: the down-beat, body long, legs trailing. */
const CLIMB: Pose<QBone> = {
  spine: [-0.25, 0, 0], chest: [-0.1, 0, 0], head: [-0.35, 0, 0],
  armR: [0.9, 0, -0.2], forearmR: [0.35, 0, 0],
  armL: [0.7, 0, 0.25], forearmL: [0.5, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [-0.3, 0, 0.1], shinL: [-0.35, 0, 0],
  legR: [-0.35, 0, -0.1], shinR: [-0.3, 0, 0],
  wingL: [0.2, 0.15, -0.5], wingR: [0.2, -0.15, 0.5],
  weapon: [-0.6, 0, 0], shield: [0, 0, 0],
};

/** Level flight, spear carried forward: the strafing attitude. */
const LEVEL: Pose<QBone> = {
  spine: [0.32, 0, 0], chest: [0.12, 0, 0], head: [-0.25, 0, 0],
  armR: [1.4, 0, -0.15], forearmR: [0.15, 0, 0],
  armL: [0.8, 0, 0.3], forearmL: [0.6, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [-0.5, 0, 0.12], shinL: [-0.45, 0, 0],
  legR: [-0.55, 0, -0.12], shinR: [-0.4, 0, 0],
  wingL: [0, 0.1, 0.55], wingR: [0, -0.1, -0.55],
  weapon: [-1.5, 0, 0], shield: [0, 0, 0],
};

/** The dive: wings swept back, spear leading, everything behind the point. */
const DIVE: Pose<QBone> = {
  spine: [0.5, 0, 0], chest: [0.2, 0, 0], head: [-0.1, 0, 0],
  armR: [1.75, 0, -0.1], forearmR: [0.05, 0, 0],
  armL: [1.1, 0, 0.2], forearmL: [0.35, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [-0.7, 0, 0.1], shinL: [-0.5, 0, 0],
  legR: [-0.75, 0, -0.1], shinR: [-0.45, 0, 0],
  wingL: [0.3, 0.4, 1.25], wingR: [0.3, -0.4, -1.25],
  weapon: [-1.62, 0, 0], shield: [0, 0, 0],
};

/** The spear driven straight down beneath her — a bolt through something. */
const BOLT: Pose<QBone> = {
  spine: [0.42, 0, 0], chest: [0.18, 0, 0], head: [0.3, 0, 0],
  armR: [0.7, 0, -0.12], forearmR: [-0.1, 0, 0],
  armL: [0.6, 0, 0.3], forearmL: [0.5, 0, 0],
  handL: [0, 0, 0], handR: [0.2, 0, 0],
  legL: [0.5, 0, 0.15], shinL: [-0.9, 0, 0],
  legR: [0.6, 0, -0.15], shinR: [-1.0, 0, 0],
  wingL: [0.1, 0.3, 0.9], wingR: [0.1, -0.3, -0.9],
  weapon: [0, 0, 0], shield: [0, 0, 0],
};

/** Shield turned edge-on and led with, like a blade. */
const EDGE: Pose<QBone> = {
  spine: [0.3, -0.3, 0], chest: [0.12, -0.12, 0], head: [-0.1, -0.25, 0],
  armR: [0.7, 0, -0.5], forearmR: [1.0, 0, 0],
  armL: [1.55, 0, -0.2], forearmL: [0.1, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [-0.35, 0, 0.12], shinL: [-0.5, 0, 0],
  legR: [-0.4, 0, -0.12], shinR: [-0.45, 0, 0],
  wingL: [0.1, 0.25, 0.8], wingR: [0.1, -0.25, -0.8],
  weapon: [-1.0, 0, 0], shield: [1.35, 0, 0],
};

/** Landed on something and standing on it. */
const PERCH: Pose<QBone> = {
  spine: [0.16, 0, 0], chest: [0.06, 0, 0], head: [0.15, 0, 0],
  armR: [1.2, 0, -0.2], forearmR: [0.25, 0, 0],
  armL: [0.5, 0, 0.45], forearmL: [0.7, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.45, 0, 0.16], shinL: [-0.6, 0, 0],
  legR: [0.2, 0, -0.16], shinR: [-0.35, 0, 0],
  wingL: [0, 0.2, 0.7], wingR: [0, -0.2, -0.7],
  weapon: [-1.2, 0, 0], shield: [0, 0, 0],
};

/** Running along something narrow, spear cocked to drive down. */
const RUN_ALONG: Pose<QBone> = {
  spine: [0.24, -0.12, 0], chest: [0.1, -0.05, 0], head: [0.05, -0.1, 0],
  armR: [1.9, 0, -0.3], forearmR: [0.7, 0, 0],
  armL: [0.6, 0, 0.5], forearmL: [0.8, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.9, 0, 0.14], shinL: [-1.2, 0, 0],
  legR: [-0.3, 0, -0.14], shinR: [-0.4, 0, 0],
  wingL: [0, 0.15, 0.6], wingR: [0, -0.15, -0.6],
  weapon: [-0.9, 0, 0], shield: [0, 0, 0],
};

/** The spearhead turned to catch and split something incoming. */
const PARRY: Pose<QBone> = {
  spine: [0.1, 0.28, 0], chest: [0.04, 0.12, 0], head: [-0.05, 0.2, 0],
  armR: [1.15, 0, 0.35], forearmR: [0.4, 0, 0],
  armL: [0.9, 0, 0.2], forearmL: [0.55, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, -0.4],
  legL: [-0.2, 0, 0.12], shinL: [-0.4, 0, 0],
  legR: [-0.25, 0, -0.12], shinR: [-0.35, 0, 0],
  wingL: [0.15, 0.2, 0.75], wingR: [0.15, -0.2, -0.75],
  weapon: [-1.1, 0, 0.5], shield: [0, 0, 0],
};

/** Both hands on the haft, wrenching something out of the air. */
const WRENCH: Pose<QBone> = {
  spine: [0.35, 0.3, 0], chest: [0.15, 0.14, 0], head: [0.2, 0.25, 0],
  armR: [1.3, 0, 0.2], forearmR: [0.5, 0, 0],
  armL: [1.35, 0, 0.55], forearmL: [0.6, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.3, 0, 0.2], shinL: [-0.5, 0, 0],
  legR: [-0.1, 0, -0.2], shinR: [-0.3, 0, 0],
  wingL: [0.2, 0.35, 1.0], wingR: [0.2, -0.35, -1.0],
  weapon: [-1.3, 0, 0.3], shield: [0, 0, 0],
};

// ── Flight helper ───────────────────────────────────────────────────────────

/** Wing beat: a fast flap while airborne, still when not. */
function beat(rig: CharacterRig, t: number, weight: number): void {
  if (weight <= 0) return;
  const b = Math.sin(t * 27) * weight;
  nudge(rig, 'wingL', 0.1 * b, 0, 0.5 * b);
  nudge(rig, 'wingR', 0.1 * b, 0, -0.5 * b);
}

// ── qxp: the bolt ───────────────────────────────────────────────────────────

/** One wingbeat up; the spear comes down through the shield like a bolt; she
 *  lands standing on the fallen shield. */
const QXP_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.0, dist: 2.7 });

    const dk = phase(t, 0.6, 0.94);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Shield up over his head, which is where the spear is going anyway.
      const up = smooth(phase(t, 0.34, 0.52));
      nudge(ctx.victim, 'armL', 0.8 * up, 0, -0.25 * up);
      nudge(ctx.victim, 'forearmL', -0.35 * up);
      nudge(ctx.victim, 'head', -0.25 * up);
      const through = smooth(phase(t, 0.56, 0.64));
      nudge(ctx.victim, 'armL', -1.1 * through, 0, 0.5 * through);
      nudge(ctx.victim, 'shield', 0.9 * through);
      nudge(ctx.victim, 'spine', 0.5 * through);
    }

    // Coil, one beat, and straight back down. No second wingbeat.
    const coil = smooth(phase(t, 0.14, 0.3));
    blendPose(a, GROUND, COIL, coil);
    const up = easeOutCubic(phase(t, 0.3, 0.46));
    if (up > 0) blendPose(a, COIL, CLIMB, up);
    const over = smooth(phase(t, 0.44, 0.54));
    if (over > 0) blendPose(a, CLIMB, DIVE, over);
    const down = easeInCubic(phase(t, 0.54, 0.62));
    if (down > 0) blendPose(a, DIVE, BOLT, down);
    const land = smooth(phase(t, 0.64, 0.76));
    if (land > 0) blendPose(a, BOLT, PERCH, land);
    beat(a, t, up * (1 - down));

    const height = 1.45 * easeOutCubic(phase(t, 0.3, 0.5)) - 1.45 * easeInCubic(phase(t, 0.5, 0.64));
    placeAt(a, s, lerp(1.6, 0.3, smooth(phase(t, 0.3, 0.6))), 0, Math.max(0, height), s.ay);
    if (t < ACT_END) sinkHips(a, 0.22 * coil * (1 - up));

    cueAt(ctx, t, 0.32, 'wing', 0.9);
    cueAt(ctx, t, 0.4, 'vocal:valkyrie', 0.85);
    cueAt(ctx, t, 0.56, 'whoosh', 0.8);
    cueAt(ctx, t, 0.6, 'impact-shield', 0.95);
    resolve(a, s, t, 0.3);
  },
};

/** She does not go up at all: she comes in flat and fast at rim height, takes
 *  the shield away on the point, and finishes with the shield edge. */
const QXP_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 0.9, dist: 2.6, side: -1 });

    const dk = phase(t, 0.64, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.4, s.y, s.vz - s.fz * 0.4);
    } else {
      victimGuard(ctx, s);
      const set = smooth(phase(t, 0.2, 0.38));
      nudge(ctx.victim, 'armL', 0.5 * set, 0, -0.2 * set);
      nudge(ctx.victim, 'spine', 0.15 * set);
      // The shield is hooked off his arm entirely.
      const stripped = smooth(phase(t, 0.42, 0.56));
      nudge(ctx.victim, 'armL', -1.2 * stripped, 0, 0.9 * stripped);
      nudge(ctx.victim, 'forearmL', 0.7 * stripped);
      nudge(ctx.victim, 'shield', 1.1 * stripped, 0.5 * stripped);
      nudge(ctx.victim, 'spine', -0.2 * stripped, 0.3 * stripped);
    }

    // A low skimming approach — airborne, but barely.
    const run = easeOutCubic(phase(t, 0.12, 0.5));
    blendPose(a, GROUND, LEVEL, smooth(phase(t, 0.12, 0.3)));
    const strip = smooth(phase(t, 0.42, 0.54));
    if (strip > 0) blendPose(a, LEVEL, WRENCH, strip);
    const edge = easeInCubic(phase(t, 0.56, 0.68));
    if (edge > 0) blendPose(a, WRENCH, EDGE, edge);
    beat(a, t, (1 - edge) * 0.8);

    placeAt(
      a,
      s,
      lerp(1.7, 0.45, run),
      0.3 * strip - 0.3 * edge,
      Math.max(0, 0.55 * smooth(phase(t, 0.12, 0.34)) - 0.55 * smooth(phase(t, 0.6, 0.76))),
      s.ay,
    );

    cueAt(ctx, t, 0.16, 'wing', 0.85);
    cueAt(ctx, t, 0.44, 'impact-metal', 0.8);
    cueAt(ctx, t, 0.5, 'vocal:valkyrie', 0.8);
    cueAt(ctx, t, 0.6, 'impact-shield', 0.85);
    resolve(a, s, t, 0.45);
  },
};

// ── qxn: the counter-circle ─────────────────────────────────────────────────

/** She flies a low counter-circle to the charge and drops her shield edge-first
 *  across the horse's line; it shies, and the rider is thrown onto her point. */
const QXN_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.05, dist: 3.0 });

    const dk = phase(t, 0.58, 0.94);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      const run = easeInCubic(phase(t, 0.12, 0.5));
      victimGuard(ctx, s, lerp(-2.0, 0.2, run));
      const gallop = Math.sin(t * 45);
      mountLegs(ctx.victim, t * 45, 0.5);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      // It shies off the shield edge and the rider keeps going forward.
      const shy = smooth(phase(t, 0.48, 0.58));
      nudge(ctx.victim, 'mount', 0.5 * shy, 0.6 * shy);
      nudge(ctx.victim, 'mountHead', -0.4 * shy, 0.5 * shy);
      nudge(ctx.victim, 'spine', -0.4 * shy);
    }

    // A tight circle against the charge's direction, ending across its line.
    const lift = smooth(phase(t, 0.1, 0.26));
    blendPose(a, GROUND, CLIMB, lift);
    const circle = easeInOutCubic(phase(t, 0.2, 0.54));
    const turn = smooth(phase(t, 0.26, 0.5));
    if (turn > 0) blendPose(a, CLIMB, EDGE, turn);
    const point = easeOutCubic(phase(t, 0.56, 0.68));
    if (point > 0) blendPose(a, EDGE, LEVEL, point);
    beat(a, t, (1 - point) * 0.9);

    // Counter-clockwise across the front of the charge.
    const ang = -2.4 * circle;
    const rad = lerp(1.5, 0.7, point);
    placeAt(
      a,
      s,
      rad * Math.cos(ang),
      rad * Math.sin(ang),
      Math.max(0, 0.85 * lift - 0.85 * smooth(phase(t, 0.62, 0.78))),
      s.ay + ang * 0.6,
    );

    cueAt(ctx, t, 0.14, 'wing', 0.85);
    cueAt(ctx, t, 0.2, 'horse', 0.7);
    cueAt(ctx, t, 0.48, 'impact-shield', 0.8);
    cueAt(ctx, t, 0.52, 'horse', 0.9);
    cueAt(ctx, t, 0.56, 'vocal:valkyrie', 0.85);
    resolve(a, s, t, 0.7 * Math.cos(-2.4), 0.7 * Math.sin(-2.4));
  },
};

/** She meets the charge head-on instead: straight over the horse's head, and
 *  takes the rider from behind as she passes over him. */
const QXN_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.1, dist: 2.9, side: -1 });

    const dk = phase(t, 0.62, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx + s.fx * 0.6, s.y, s.vz + s.fz * 0.6);
    } else {
      const run = easeInCubic(phase(t, 0.1, 0.52));
      victimGuard(ctx, s, lerp(-2.2, 0.6, run));
      const gallop = Math.sin(t * 46);
      mountLegs(ctx.victim, t * 46, 0.5);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      // He swings up at her as she goes over, and misses.
      const swing = bump(phase(t, 0.42, 0.56));
      nudge(ctx.victim, 'armR', 2.0 * swing, 0, -0.3 * swing);
      nudge(ctx.victim, 'head', -0.4 * swing);
      const behind = smooth(phase(t, 0.56, 0.66));
      nudge(ctx.victim, 'spine', -0.2 * behind, -0.6 * behind);
      nudge(ctx.victim, 'head', 0, -0.8 * behind);
    }

    // Up over the forehand, and down behind the cantle.
    const coil = smooth(phase(t, 0.1, 0.24));
    blendPose(a, GROUND, COIL, coil);
    const up = easeOutCubic(phase(t, 0.24, 0.42));
    if (up > 0) blendPose(a, COIL, CLIMB, up);
    const over = smooth(phase(t, 0.42, 0.54));
    if (over > 0) blendPose(a, CLIMB, LEVEL, over);
    const take = easeInCubic(phase(t, 0.56, 0.68));
    if (take > 0) blendPose(a, LEVEL, BOLT, take);
    beat(a, t, up * (1 - take));

    placeAt(
      a,
      s,
      // She passes over him and ends on the far side of the square.
      lerp(1.6, -0.55, easeInOutCubic(phase(t, 0.24, 0.62))),
      0,
      Math.max(0, 1.25 * easeOutCubic(phase(t, 0.24, 0.46)) - 1.25 * easeInCubic(phase(t, 0.5, 0.68))),
      s.ay,
    );
    if (t < ACT_END) sinkHips(a, 0.2 * coil * (1 - up));

    cueAt(ctx, t, 0.12, 'horse', 0.7);
    cueAt(ctx, t, 0.26, 'wing', 0.9);
    cueAt(ctx, t, 0.46, 'whoosh', 0.7);
    cueAt(ctx, t, 0.52, 'vocal:valkyrie', 0.85);
    cueAt(ctx, t, 0.6, 'impact-flesh', 0.8);
    resolve(a, s, t, -0.55);
  },
};

// ── qxb: through the runes ──────────────────────────────────────────────────

/** Runes chase her; she rolls between two, splits the third on her spearhead,
 *  and continues through to pin the staff to the ground. */
const QXB_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.1, dist: 2.8 });

    const dk = phase(t, 0.66, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Three casts, tracking her, the last one hurried.
      const c1 = bump(phase(t, 0.16, 0.28));
      const c2 = bump(phase(t, 0.3, 0.42));
      const c3 = bump(phase(t, 0.44, 0.54));
      const cast = c1 + c2 + c3;
      nudge(ctx.victim, 'armL', 0.9 * cast, 0, -0.3 * cast);
      nudge(ctx.victim, 'armR', 0.4 * cast, 0, -0.2 * cast);
      nudge(ctx.victim, 'head', 0, -0.5 * smooth(phase(t, 0.2, 0.5)));
      // The staff is pinned to the board with her weight on the haft.
      const pinned = smooth(phase(t, 0.58, 0.68));
      nudge(ctx.victim, 'armR', -1.0 * pinned, 0, 0.6 * pinned);
      nudge(ctx.victim, 'staff', 1.3 * pinned, 0, 0.5 * pinned);
      nudge(ctx.victim, 'spine', 0.4 * pinned, 0.2 * pinned);
    }

    // A rolling climb through the first two, a parry on the third, then down.
    const lift = smooth(phase(t, 0.1, 0.26));
    blendPose(a, GROUND, CLIMB, lift);
    const roll = bump(phase(t, 0.26, 0.46));
    const parry = smooth(phase(t, 0.44, 0.56));
    if (parry > 0) blendPose(a, CLIMB, PARRY, parry);
    const drive = easeInCubic(phase(t, 0.56, 0.68));
    if (drive > 0) blendPose(a, PARRY, BOLT, drive);
    beat(a, t, (1 - drive) * 0.9);

    placeAt(
      a,
      s,
      lerp(1.7, 0.35, easeInOutCubic(phase(t, 0.2, 0.62))),
      // The roll: she crosses her own line twice on the way in.
      0.9 * Math.sin(roll * Math.PI * 2) * (1 - drive),
      Math.max(0, 1.1 * lift - 1.1 * easeInCubic(phase(t, 0.54, 0.7))),
      s.ay,
      // The barrel roll itself.
      0,
      3.4 * roll * (1 - drive),
    );

    cueAt(ctx, t, 0.14, 'wing', 0.85);
    cueAt(ctx, t, 0.2, 'rune', 0.7);
    cueAt(ctx, t, 0.34, 'rune', 0.7);
    cueAt(ctx, t, 0.46, 'rune', 0.8);
    cueAt(ctx, t, 0.5, 'impact-metal', 0.7);
    cueAt(ctx, t, 0.56, 'vocal:valkyrie', 0.85);
    resolve(a, s, t, 0.35);
  },
};

/** She goes straight up out of the runes' reach and comes down on top of the
 *  cast — the völva never gets to aim upward. */
const QXB_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 0.95, dist: 2.7, side: -1 });

    const dk = phase(t, 0.62, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Two casts across the board at where she was standing.
      const c1 = bump(phase(t, 0.18, 0.3));
      const c2 = bump(phase(t, 0.32, 0.44));
      nudge(ctx.victim, 'armL', 0.9 * (c1 + c2), 0, -0.3 * (c1 + c2));
      nudge(ctx.victim, 'staff', -0.4 * (c1 + c2));
      // Looking for her at head height, far too late to look up.
      const lost = smooth(phase(t, 0.44, 0.56));
      nudge(ctx.victim, 'head', 0, 0.9 * lost);
      nudge(ctx.victim, 'spine', 0, 0.3 * lost);
      const above = smooth(phase(t, 0.56, 0.64));
      nudge(ctx.victim, 'head', -0.7 * above, -0.5 * above);
    }

    // Nearly vertical, then straight back down through the top of her guard.
    const coil = smooth(phase(t, 0.1, 0.24));
    blendPose(a, GROUND, COIL, coil);
    const up = easeOutCubic(phase(t, 0.24, 0.46));
    if (up > 0) blendPose(a, COIL, CLIMB, up);
    const hang = smooth(phase(t, 0.46, 0.54));
    if (hang > 0) blendPose(a, CLIMB, DIVE, hang);
    const down = easeInCubic(phase(t, 0.54, 0.64));
    if (down > 0) blendPose(a, DIVE, BOLT, down);
    beat(a, t, up * (1 - down) + 0.5 * hang);

    placeAt(
      a,
      s,
      lerp(1.6, 0.2, smooth(phase(t, 0.4, 0.62))),
      0,
      Math.max(0, 2.0 * easeOutCubic(phase(t, 0.24, 0.5)) - 2.0 * easeInCubic(phase(t, 0.5, 0.66))),
      s.ay,
    );
    if (t < ACT_END) sinkHips(a, 0.2 * coil * (1 - up));

    cueAt(ctx, t, 0.26, 'wing', 0.95);
    cueAt(ctx, t, 0.22, 'rune', 0.65);
    cueAt(ctx, t, 0.36, 'rune', 0.65);
    cueAt(ctx, t, 0.5, 'vocal:valkyrie', 0.9);
    cueAt(ctx, t, 0.58, 'whoosh', 0.85);
    cueAt(ctx, t, 0.62, 'impact-metal', 0.8);
    resolve(a, s, t, 0.2);
  },
};

// ── qxr: along the arm ──────────────────────────────────────────────────────

/** The stone arm swings; she lands ON it, runs its length, drives the spear
 *  into the neck seam, and steps off as it crumbles beneath her. */
const QXR_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'orbit', height: 1.15, dist: 3.1 });

    const dk = phase(t, 0.72, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      unfoldJotunn(v, phase(t, 0.04, 0.4));
      // One swing of the arm, which she uses as a road.
      const w = phase(t, 0.4, 0.48);
      const swing = easeInCubic(phase(t, 0.48, 0.58));
      nudge(v, 'armR', 0.4 * swing, -1.3 * w + 2.1 * swing, 0.8 * swing);
      nudge(v, 'spine', 0, -0.25 * w + 0.4 * swing);
      // It cannot reach its own neck, and it knows it.
      const reach = smooth(phase(t, 0.62, 0.72));
      nudge(v, 'armL', 1.4 * reach, -0.6 * reach, 0.4 * reach);
      nudge(v, 'head', 0.2 * reach, 0.3 * reach);
    }

    // Up, land on the arm, run it, and drive down into the seam.
    const lift = smooth(phase(t, 0.12, 0.34));
    blendPose(a, GROUND, CLIMB, lift);
    const land = smooth(phase(t, 0.5, 0.58));
    if (land > 0) blendPose(a, CLIMB, PERCH, land);
    const run = smooth(phase(t, 0.58, 0.68));
    if (run > 0) blendPose(a, PERCH, RUN_ALONG, run);
    const drive = easeInCubic(phase(t, 0.68, 0.78));
    if (drive > 0) blendPose(a, RUN_ALONG, BOLT, drive);
    beat(a, t, lift * (1 - land) + 0.4 * drive);

    // She travels in along the arm's length as it sweeps: shoulder-ward.
    const along = smooth(phase(t, 0.56, 0.76));
    placeAt(
      a,
      s,
      lerp(1.9, 0.55, easeInOutCubic(phase(t, 0.2, 0.56))) - 0.2 * along,
      lerp(1.1, 0.15, along),
      Math.max(0, lerp(1.15, 1.5, along) * smooth(phase(t, 0.16, 0.5))
        - 1.5 * easeInCubic(phase(t, 0.76, 0.9))),
      s.ay - 0.5 * along,
    );

    cueAt(ctx, t, 0.1, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.16, 'wing', 0.85);
    cueAt(ctx, t, 0.5, 'whoosh', 0.8);
    cueAt(ctx, t, 0.54, 'impact-stone', 0.7);
    cueAt(ctx, t, 0.66, 'vocal:valkyrie', 0.9);
    cueAt(ctx, t, 0.72, 'impact-stone', 0.95);
    shakeAt(ctx, t, 0.72, 0.3, 0.18);
    resolve(a, s, t, 0.35, 0.15, 0);
  },
};

/** It never gets an arm up: she comes down between the seams while it is still
 *  unfolding and opens the shell from the inside. */
const QXR_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'push', height: 1.0, dist: 2.9, side: -1 });

    const dk = phase(t, 0.62, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      // Caught mid-unfold, with the seams still open.
      unfoldJotunn(v, Math.min(phase(t, 0.14, 0.56), 0.62));
      const jolt = smooth(phase(t, 0.5, 0.6));
      nudge(v, 'spine', -0.3 * jolt);
      nudge(v, 'head', -0.4 * jolt);
      nudge(v, 'armL', 0.6 * jolt, 0, 0.3 * jolt);
      nudge(v, 'armR', 0.6 * jolt, 0, -0.3 * jolt);
    }

    // Straight up early, hang while it opens, then down into the gap.
    const coil = smooth(phase(t, 0.06, 0.2));
    blendPose(a, GROUND, COIL, coil);
    const up = easeOutCubic(phase(t, 0.2, 0.4));
    if (up > 0) blendPose(a, COIL, CLIMB, up);
    const hang = smooth(phase(t, 0.4, 0.48));
    if (hang > 0) blendPose(a, CLIMB, DIVE, hang);
    const down = easeInCubic(phase(t, 0.48, 0.6));
    if (down > 0) blendPose(a, DIVE, BOLT, down);
    beat(a, t, up * (1 - down) + 0.6 * hang);

    placeAt(
      a,
      s,
      lerp(1.7, 0.15, smooth(phase(t, 0.34, 0.58))),
      0,
      Math.max(0, 2.2 * easeOutCubic(phase(t, 0.2, 0.46)) - 2.2 * easeInCubic(phase(t, 0.46, 0.62))),
      s.ay,
    );
    if (t < ACT_END) sinkHips(a, 0.2 * coil * (1 - up));

    cueAt(ctx, t, 0.14, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.22, 'wing', 0.95);
    cueAt(ctx, t, 0.46, 'vocal:valkyrie', 0.9);
    cueAt(ctx, t, 0.54, 'whoosh', 0.85);
    cueAt(ctx, t, 0.58, 'impact-stone', 0.95);
    shakeAt(ctx, t, 0.58, 0.32, 0.18);
    resolve(a, s, t, 0.15);
  },
};

// ── qxq: the double helix ───────────────────────────────────────────────────

/** Two fliers spiral upward in a double helix and clash once at the apex with a
 *  flash; the loser's wings fold and she falls, landing kneeling. */
const QXQ_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.2, dist: 3.3 });

    const dk = phase(t, 0.6, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y + 2.2, s.vz);
    } else {
      // The mirror of the attacker's climb, half a turn out of phase.
      const climb = easeInOutCubic(phase(t, 0.14, 0.58));
      const ang = 6.0 * climb + Math.PI;
      const rad = lerp(0.85, 0.22, climb);
      victimGuard(
        ctx,
        s,
        rad * Math.cos(ang),
        rad * Math.sin(ang),
        2.3 * climb,
        s.vy + ang,
      );
      const b = Math.sin(t * 26 + 2.0);
      nudge(ctx.victim, 'wingL', 0.1 * b, 0, 0.55 * b);
      nudge(ctx.victim, 'wingR', 0.1 * b, 0, -0.55 * b);
      nudge(ctx.victim, 'spine', -0.25 * climb);
      const clash = bump(phase(t, 0.54, 0.62));
      nudge(ctx.victim, 'armR', 1.3 * clash);
    }

    // The same helix, opposite phase, meeting once at the top.
    const lift = smooth(phase(t, 0.1, 0.28));
    blendPose(a, GROUND, CLIMB, lift);
    const climb = easeInOutCubic(phase(t, 0.14, 0.58));
    const strike = smooth(phase(t, 0.5, 0.58));
    if (strike > 0) blendPose(a, CLIMB, DIVE, strike);
    const after = smooth(phase(t, 0.62, 0.74));
    if (after > 0) blendPose(a, DIVE, LEVEL, after);
    const settle = smooth(phase(t, 0.74, ACT_END));
    if (settle > 0) blendPose(a, LEVEL, PERCH, settle);
    beat(a, t, (1 - settle) * 0.95);

    const ang = 6.0 * climb;
    const rad = lerp(0.85, 0.22, climb);
    placeAt(
      a,
      s,
      rad * Math.cos(ang),
      rad * Math.sin(ang),
      Math.max(0, 2.3 * climb - 2.3 * easeInCubic(phase(t, 0.66, 0.84))),
      s.ay + ang,
    );

    cueAt(ctx, t, 0.14, 'wing', 0.9);
    cueAt(ctx, t, 0.3, 'wing', 0.7);
    cueAt(ctx, t, 0.44, 'vocal:valkyrie', 0.85);
    cueAt(ctx, t, 0.56, 'impact-metal', 1.0);
    cueAt(ctx, t, 0.62, 'wing', 0.6);
    resolve(a, s, t, 0.22 * Math.cos(6.0), 0.22 * Math.sin(6.0));
  },
};

/** Neither of them gets off the ground for long: the attacker catches the
 *  rival's take-off at the coil, and it is settled on the board, spear to
 *  spear, before either wing does any work. */
const QXQ_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 0.9, dist: 2.6, side: -1 });

    const dk = phase(t, 0.64, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y + 0.25, s.vz);
    } else {
      // A take-off that is interrupted at the worst possible moment.
      const coil = smooth(phase(t, 0.16, 0.34));
      const hop = bump(phase(t, 0.34, 0.5));
      victimGuard(ctx, s, 0, 0, 0.45 * hop);
      nudge(ctx.victim, 'wingL', -0.3 * coil, 0, 0.9 * coil - 0.5 * hop);
      nudge(ctx.victim, 'wingR', -0.3 * coil, 0, -0.9 * coil + 0.5 * hop);
      nudge(ctx.victim, 'spine', 0.3 * coil - 0.3 * hop);
      // Spear caught against spear, and pressed back down.
      const bound = smooth(phase(t, 0.5, 0.62));
      nudge(ctx.victim, 'armR', 0.9 * bound, 0, -0.5 * bound);
      nudge(ctx.victim, 'wingL', 0, 0, -0.9 * bound);
      nudge(ctx.victim, 'wingR', 0, 0, 0.9 * bound);
      nudge(ctx.victim, 'spine', 0.4 * bound);
    }

    // One short hop to close, then it is a wrestling match on the haft.
    const hop = bump(phase(t, 0.2, 0.42));
    blendPose(a, GROUND, LEVEL, smooth(phase(t, 0.16, 0.36)));
    const bind = smooth(phase(t, 0.44, 0.58));
    if (bind > 0) blendPose(a, LEVEL, PARRY, bind);
    const press = easeInCubic(phase(t, 0.58, 0.72));
    if (press > 0) blendPose(a, PARRY, EDGE, press);
    beat(a, t, hop * 0.9);

    placeAt(
      a,
      s,
      lerp(1.6, 0.55, smooth(phase(t, 0.18, 0.5))),
      0,
      Math.max(0, 0.6 * hop),
      s.ay,
    );

    cueAt(ctx, t, 0.2, 'wing', 0.85);
    cueAt(ctx, t, 0.36, 'wing', 0.7);
    cueAt(ctx, t, 0.46, 'impact-metal', 0.9);
    cueAt(ctx, t, 0.56, 'vocal:valkyrie', 0.9);
    cueAt(ctx, t, 0.66, 'impact-flesh', 0.75);
    resolve(a, s, t, 0.55);
  },
};

// ── qxk: the worked example ─────────────────────────────────────────────────

/** She takes off; he swings through empty air; she comes down through the gap.
 *  The only duel where the camera leaves ground level. (DUELS.md worked
 *  example, and the one licensed 'rise'.) */
const QXK_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'rise', height: 0.85, dist: 2.8 });

    const dk = phase(t, 0.66, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // One committed swing through the space she has just left.
      const w = phase(t, 0.3, 0.42);
      const cut = easeInCubic(phase(t, 0.42, 0.54));
      const past = smooth(phase(t, 0.54, 0.66));
      nudge(ctx.victim, 'armR', -1.6 * w + 2.8 * cut - 0.4 * past);
      nudge(ctx.victim, 'armL', -1.4 * w + 2.5 * cut - 0.35 * past);
      nudge(ctx.victim, 'weapon', -0.6 * cut);
      nudge(ctx.victim, 'spine', -0.25 * w + 0.5 * cut, 0.4 * past);
      // He looks for her at his own height. She is not there.
      const looking = smooth(phase(t, 0.6, 0.7));
      nudge(ctx.victim, 'head', 0, 0.7 * looking);
    }

    // Straight up out of his arc, hang at the apex, and down through the gap
    // his own swing has opened.
    const coil = smooth(phase(t, 0.14, 0.3));
    blendPose(a, GROUND, COIL, coil);
    const up = easeOutCubic(phase(t, 0.3, 0.5));
    if (up > 0) blendPose(a, COIL, CLIMB, up);
    const apex = smooth(phase(t, 0.5, 0.58));
    if (apex > 0) blendPose(a, CLIMB, DIVE, apex);
    const through = easeInCubic(phase(t, 0.58, 0.68));
    if (through > 0) blendPose(a, DIVE, BOLT, through);
    const land = smooth(phase(t, 0.7, ACT_END));
    if (land > 0) blendPose(a, BOLT, PERCH, land);
    beat(a, t, up * (1 - through) + 0.5 * apex);

    placeAt(
      a,
      s,
      lerp(1.5, 0.4, smooth(phase(t, 0.44, 0.66))),
      0,
      Math.max(0, 2.4 * easeOutCubic(phase(t, 0.3, 0.54)) - 2.4 * easeInCubic(phase(t, 0.56, 0.7))),
      s.ay,
    );
    if (t < ACT_END) sinkHips(a, 0.24 * coil * (1 - up));

    cueAt(ctx, t, 0.32, 'wing', 1.0);
    cueAt(ctx, t, 0.4, 'vocal:valkyrie', 0.9);
    cueAt(ctx, t, 0.46, 'whoosh', 0.9);
    cueAt(ctx, t, 0.62, 'whoosh', 0.7);
    cueAt(ctx, t, 0.66, 'impact-metal', 0.9);
    resolve(a, s, t, 0.4);
  },
};

/** He does not swing — he sets the greatsword high and waits for her to come
 *  down onto it. So she does not come down: she takes the crown off him from
 *  behind, on the way past, and he kneels rather than turn around. */
const QXK_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.0, dist: 2.9, side: -1 });

    const dk = phase(t, 0.68, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // High guard, held. It is the right answer to a dive.
      const set = smooth(phase(t, 0.18, 0.4));
      nudge(ctx.victim, 'armR', 1.5 * set, 0, 0.2 * set);
      nudge(ctx.victim, 'armL', 1.3 * set, 0, -0.2 * set);
      nudge(ctx.victim, 'weapon', -1.0 * set);
      nudge(ctx.victim, 'head', -0.3 * set);
      // She is behind him, and he does not turn.
      const behind = smooth(phase(t, 0.56, 0.68));
      nudge(ctx.victim, 'head', 0.2 * behind, -0.5 * behind);
      nudge(ctx.victim, 'armR', -0.8 * behind);
      nudge(ctx.victim, 'armL', -0.7 * behind);
      nudge(ctx.victim, 'spine', 0.2 * behind);
    }

    // A flat pass at shoulder height, around him rather than over him.
    const lift = smooth(phase(t, 0.12, 0.3));
    blendPose(a, GROUND, LEVEL, lift);
    const round = easeInOutCubic(phase(t, 0.24, 0.66));
    const take = smooth(phase(t, 0.54, 0.66));
    if (take > 0) blendPose(a, LEVEL, WRENCH, take);
    const done = smooth(phase(t, 0.7, ACT_END));
    if (done > 0) blendPose(a, WRENCH, PERCH, done);
    beat(a, t, (1 - done) * 0.9);

    // Around the outside and in behind him.
    const ang = 3.1 * round;
    const rad = lerp(1.45, 0.6, take);
    placeAt(
      a,
      s,
      rad * Math.cos(ang),
      rad * Math.sin(ang),
      Math.max(0, 0.95 * lift - 0.95 * easeInCubic(phase(t, 0.68, 0.84))),
      s.ay + ang,
    );

    cueAt(ctx, t, 0.16, 'wing', 0.9);
    cueAt(ctx, t, 0.42, 'wing', 0.7);
    cueAt(ctx, t, 0.56, 'impact-metal', 0.85);
    cueAt(ctx, t, 0.62, 'vocal:jarl', 0.8);
    cueAt(ctx, t, 0.7, 'fall', 0.6);
    resolve(a, s, t, 0.6 * Math.cos(3.1), 0.6 * Math.sin(3.1));
  },
};

export const VALKYRIE_ROW: DuelMatrix = {
  qxp: [QXP_A, QXP_B],
  qxn: [QXN_A, QXN_B],
  qxb: [QXB_A, QXB_B],
  qxr: [QXR_A, QXR_B],
  qxq: [QXQ_A, QXQ_B],
  qxk: [QXK_A, QXK_B],
};
