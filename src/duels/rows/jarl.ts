/**
 * Jarl attacks — the king row, and the short one: five cells, because kxk does
 * not exist. He is heavy and reluctant and wins by economy: one blow where one
 * blow will do, and he turns away before the other man has finished falling.
 * Never a flourish, never a second swing he does not need.
 *
 * The greatsword's rest attitude is point-down (weapon [-0.77, 0, 0.35]); a
 * weapon rotation of 0 has the blade hanging straight down from his hands,
 * which is why the plant and the half-swing both read from small numbers here.
 */

import type { DuelMatrix, DuelScript } from '../../core/stage.ts';
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
  nudge,
  placeAt,
  resolve,
  shakeAt,
  sinkHips,
  stageDuel,
  stepLegs,
  type Pose,
} from './support.ts';

const smooth = (x: number): number => x * x * (3 - 2 * x);
const bump = (x: number): number => Math.sin(Math.PI * clamp01(x));

type KBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR'
  | 'cloak' | 'weapon';

// ── Pose library ────────────────────────────────────────────────────────────

/** Walking in, point down, in no hurry whatsoever. */
const WALK: Pose<KBone> = {
  spine: [0.05, 0, 0], chest: [0, 0, 0], head: [-0.05, 0, 0],
  armR: [0.42, 0, -0.35], forearmR: [0.35, 0, 0],
  armL: [0.42, 0, 0.35], forearmL: [0.42, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0, 0, 0.05], shinL: [-0.1, 0, 0],
  legR: [0, 0, -0.05], shinR: [-0.1, 0, 0],
  cloak: [0, 0, 0], weapon: [-0.77, 0, 0.35],
};

/** Both hands up, blade across: the guard he fights out of. */
const GUARD: Pose<KBone> = {
  spine: [0.15, 0, 0], chest: [0, 0, 0], head: [-0.1, 0, 0],
  armR: [1.25, 0, -0.3], forearmR: [0.5, 0, 0],
  armL: [1.1, 0, 0.35], forearmL: [0.6, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.12, 0, 0.08], shinL: [-0.18, 0, 0],
  legR: [-0.1, 0, -0.08], shinR: [-0.14, 0, 0],
  cloak: [0, 0, 0], weapon: [-0.6, 0, 0.2],
};

/** A gauntlet put on a spear shaft to move it — not a parry, a correction. */
const PUSH_ASIDE: Pose<KBone> = {
  spine: [0.18, -0.3, 0], chest: [0.06, -0.12, 0], head: [0.05, -0.25, 0],
  armR: [0.9, 0, -0.4], forearmR: [0.7, 0, 0],
  armL: [1.45, 0, -0.2], forearmL: [0.25, 0, 0],
  handL: [0, 0, 0.3], handR: [0, 0, 0],
  legL: [0.25, 0, 0.1], shinL: [-0.35, 0, 0],
  legR: [-0.15, 0, -0.1], shinR: [-0.2, 0, 0],
  cloak: [-0.06, 0, 0], weapon: [-0.7, 0, 0.3],
};

/** The half-swing, cocked. Not over the head — only to the shoulder. */
const HALF_UP: Pose<KBone> = {
  spine: [0.02, 0.32, 0], chest: [0, 0.14, 0], head: [-0.08, -0.1, 0],
  armR: [1.5, 0, -0.85], forearmR: [1.1, 0, 0],
  armL: [1.35, 0, 0.5], forearmL: [1.2, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.06, 0, 0.08], shinL: [-0.14, 0, 0],
  legR: [-0.16, 0, -0.08], shinR: [-0.2, 0, 0],
  cloak: [-0.1, 0, 0], weapon: [-1.5, 0, -0.35],
};

/** Through, and stopped. The economy is in where it ends. */
const HALF_THROUGH: Pose<KBone> = {
  spine: [0.28, -0.35, 0], chest: [0.1, -0.15, 0], head: [0.12, -0.3, 0],
  armR: [0.95, 0, -0.15], forearmR: [0.2, 0, 0],
  armL: [0.85, 0, 0.2], forearmL: [0.3, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.32, 0, 0.1], shinL: [-0.42, 0, 0],
  legR: [-0.22, 0, -0.1], shinR: [-0.24, 0, 0],
  cloak: [0.12, 0, 0], weapon: [-0.2, 0, 0.6],
};

/** One hand off the hilt to take hold of something. */
const SEIZE: Pose<KBone> = {
  spine: [0.24, 0.3, 0], chest: [0.1, 0.12, 0], head: [0.1, 0.28, 0],
  armR: [0.7, 0, -0.3], forearmR: [0.5, 0, 0],
  armL: [1.6, 0, 0.15], forearmL: [0.2, 0, 0],
  handL: [-0.3, 0, 0], handR: [0, 0, 0],
  legL: [0.3, 0, 0.12], shinL: [-0.4, 0, 0],
  legR: [-0.2, 0, -0.12], shinR: [-0.25, 0, 0],
  cloak: [0.05, 0, 0], weapon: [-0.9, 0, 0.4],
};

/** The swing that follows a seize — something carried around and released. */
const SWING_OUT: Pose<KBone> = {
  spine: [0.2, -0.55, 0], chest: [0.08, -0.22, 0], head: [0.1, -0.45, 0],
  armR: [0.8, 0, -0.25], forearmR: [0.4, 0, 0],
  armL: [1.3, 0, -0.5], forearmL: [0.3, 0, 0],
  handL: [0.2, 0, 0], handR: [0, 0, 0],
  legL: [0.4, 0, 0.14], shinL: [-0.5, 0, 0],
  legR: [-0.25, 0, -0.14], shinR: [-0.3, 0, 0],
  cloak: [0.16, 0, 0], weapon: [-0.85, 0, 0.35],
};

/** The greatsword planted point-first, both hands on it, weight behind. */
const PLANT: Pose<KBone> = {
  spine: [0.3, 0.05, 0], chest: [0.12, 0, 0], head: [0.15, 0, 0],
  armR: [0.95, 0, -0.14], forearmR: [-0.15, 0, 0],
  armL: [0.9, 0, 0.16], forearmL: [-0.12, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.45, 0, 0.12], shinL: [-0.55, 0, 0],
  legR: [-0.3, 0, -0.12], shinR: [-0.32, 0, 0],
  cloak: [0.14, 0, 0], weapon: [0, 0, 0],
};

/** Shoulder-first, head down, walking through something. */
const SHOULDER: Pose<KBone> = {
  spine: [0.4, 0.2, 0], chest: [0.16, 0.08, 0], head: [0.3, 0.15, 0],
  armR: [0.6, 0, -0.5], forearmR: [0.8, 0, 0],
  armL: [0.55, 0, 0.45], forearmL: [0.9, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.35, 0, 0.1], shinL: [-0.45, 0, 0],
  legR: [-0.2, 0, -0.1], shinR: [-0.22, 0, 0],
  cloak: [0.2, 0, 0], weapon: [-0.85, 0, 0.4],
};

/** A downward cut that finishes low — for breaking a staff, or an ankle seam. */
const CUT_LOW: Pose<KBone> = {
  spine: [0.5, -0.2, 0], chest: [0.2, -0.08, 0], head: [0.35, -0.18, 0],
  armR: [0.55, 0, -0.2], forearmR: [0.1, 0, 0],
  armL: [0.5, 0, 0.22], forearmL: [0.15, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.5, 0, 0.12], shinL: [-0.62, 0, 0],
  legR: [-0.32, 0, -0.12], shinR: [-0.3, 0, 0],
  cloak: [0.22, 0, 0], weapon: [-0.25, 0, 0.5],
};

/** Leaning on the pommel, breathing. He is old and this costs him. */
const BREATHE: Pose<KBone> = {
  spine: [0.34, 0.06, 0], chest: [0.14, 0, 0], head: [0.3, 0.05, 0],
  armR: [0.85, 0, -0.16], forearmR: [-0.1, 0, 0],
  armL: [0.8, 0, 0.18], forearmL: [-0.08, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.3, 0, 0.1], shinL: [-0.4, 0, 0],
  legR: [-0.18, 0, -0.1], shinR: [-0.22, 0, 0],
  cloak: [0.16, 0, 0], weapon: [0, 0, 0],
};

// ── kxp: the correction ─────────────────────────────────────────────────────

/** He pushes the spear aside with a gauntlet and gives one economical
 *  half-swing; turns away before the huscarl finishes kneeling. */
const KXP_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.0, dist: 2.5 });

    const dk = phase(t, 0.6, 0.92);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // He thrusts, and it is moved out of the way like a branch.
      const jab = bump(phase(t, 0.28, 0.42));
      nudge(ctx.victim, 'armR', 0.9 * jab);
      nudge(ctx.victim, 'forearmR', -0.6 * jab);
      nudge(ctx.victim, 'spine', 0.2 * jab);
      const moved = smooth(phase(t, 0.42, 0.54));
      nudge(ctx.victim, 'armR', -0.5 * moved, 0, -0.7 * moved);
      nudge(ctx.victim, 'weapon', 0, 0.5 * moved);
      nudge(ctx.victim, 'spine', 0, 0.4 * moved);
    }

    // Walk in, one gauntlet, one half-swing, and he is already turning away.
    const walk = smooth(phase(t, 0.1, 0.42));
    blendPose(a, WALK, GUARD, smooth(phase(t, 0.24, 0.4)));
    stepLegs(a, walk * 2.2, 0.3 * (1 - smooth(phase(t, 0.36, 0.5))));
    const aside = smooth(phase(t, 0.42, 0.52));
    if (aside > 0) blendPose(a, GUARD, PUSH_ASIDE, aside);
    const cock = smooth(phase(t, 0.52, 0.58));
    if (cock > 0) blendPose(a, PUSH_ASIDE, HALF_UP, cock);
    const through = easeInCubic(phase(t, 0.58, 0.66));
    if (through > 0) blendPose(a, HALF_UP, HALF_THROUGH, through);
    // Turning away: the cloak carries the movement, not the shoulders.
    const away = smooth(phase(t, 0.68, ACT_END));
    if (away > 0) blendPose(a, HALF_THROUGH, WALK, away * 0.8);
    nudge(a, 'cloak', 0.1 * bump(phase(t, 0.66, 0.82)));

    placeAt(a, s, lerp(1.6, 0.72, walk), 0, 0, s.ay + 0.4 * away);

    cueAt(ctx, t, 0.32, 'whoosh', 0.5);
    cueAt(ctx, t, 0.44, 'impact-metal', 0.7);
    cueAt(ctx, t, 0.6, 'whoosh', 0.8);
    cueAt(ctx, t, 0.64, 'impact-flesh', 0.85);
    cueAt(ctx, t, 0.5, 'vocal:jarl', 0.7);
    resolve(a, s, t, 0.72);
  },
};

/** The huscarl gets the shield wall right and holds him off twice; so the Jarl
 *  stops swinging, takes the rim in one hand, pulls it out of line and puts the
 *  point in over the top. */
const KXP_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 0.95, dist: 2.5, side: -1 });

    const dk = phase(t, 0.66, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Two good blocks — and then his own shield is used against him.
      const b1 = bump(phase(t, 0.22, 0.34));
      const b2 = bump(phase(t, 0.36, 0.48));
      nudge(ctx.victim, 'armL', 0.55 * (b1 + b2), 0, -0.2 * (b1 + b2));
      nudge(ctx.victim, 'spine', -0.18 * (b1 + b2));
      const pulled = smooth(phase(t, 0.52, 0.66));
      nudge(ctx.victim, 'armL', 0.9 * pulled, 0, -0.9 * pulled);
      nudge(ctx.victim, 'spine', -0.1 * pulled, -0.7 * pulled);
      nudge(ctx.victim, 'head', 0, -0.6 * pulled);
      nudge(ctx.victim, 'shield', 0, -0.4 * pulled);
    }

    // Two swings that the shield answers, then he simply moves the shield.
    const close = smooth(phase(t, 0.08, 0.28));
    const s1 = bump(phase(t, 0.2, 0.34));
    const s2 = bump(phase(t, 0.34, 0.48));
    blendPose(a, WALK, GUARD, close);
    if (s1 + s2 > 0) blendPose(a, GUARD, HALF_THROUGH, clamp01(s1 + s2));
    const grab = smooth(phase(t, 0.5, 0.62));
    if (grab > 0) blendPose(a, GUARD, SEIZE, grab);
    const point = easeOutCubic(phase(t, 0.64, 0.74));
    if (point > 0) blendPose(a, SEIZE, PLANT, point * 0.7);

    placeAt(a, s, lerp(1.6, 0.68, close) - 0.08 * point, 0.25 * grab, 0, s.ay - 0.3 * grab);

    cueAt(ctx, t, 0.24, 'impact-shield', 0.8);
    cueAt(ctx, t, 0.38, 'impact-shield', 0.8);
    cueAt(ctx, t, 0.5, 'vocal:jarl', 0.8);
    cueAt(ctx, t, 0.66, 'impact-flesh', 0.8);
    resolve(a, s, t, 0.68, 0.25);
  },
};

// ── kxn: off the horse ──────────────────────────────────────────────────────

/** Sidesteps the charge and drags the rider off as the horse passes; finishes
 *  grounded, then leans on the pommel, breathing hard. */
const KXN_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.05, dist: 2.9 });

    const dk = phase(t, 0.56, 0.9);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.3, s.y, s.vz - s.fz * 0.3);
    } else {
      const run = easeInCubic(phase(t, 0.1, 0.5));
      victimGuard(ctx, s, lerp(-2.1, 0.4, run));
      const gallop = Math.sin(t * 45);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      const cut = bump(phase(t, 0.36, 0.5));
      nudge(ctx.victim, 'armR', 1.4 * cut, 0, -0.3 * cut);
      // Taken by the arm as the horse goes on without him.
      const caught = smooth(phase(t, 0.48, 0.58));
      nudge(ctx.victim, 'armR', -1.0 * caught, 0, 0.6 * caught);
      nudge(ctx.victim, 'spine', -0.4 * caught, 0.5 * caught);
    }

    // One step off the line — no more than one — then a hand on him.
    const step = easeOutCubic(phase(t, 0.34, 0.48));
    blendPose(a, WALK, GUARD, smooth(phase(t, 0.14, 0.34)));
    const seize = smooth(phase(t, 0.46, 0.58));
    if (seize > 0) blendPose(a, GUARD, SEIZE, seize);
    const drag = easeInCubic(phase(t, 0.58, 0.68));
    if (drag > 0) blendPose(a, SEIZE, CUT_LOW, drag);
    // And then he needs a moment, which he takes.
    const rest = smooth(phase(t, 0.72, ACT_END));
    if (rest > 0) blendPose(a, CUT_LOW, BREATHE, rest);
    nudge(a, 'chest', -0.04 * bump(phase(t, 0.78, 1)));

    placeAt(a, s, 1.25, 0.62 * step, 0, s.ay - 0.35 * step + 0.2 * seize);
    if (t < ACT_END) sinkHips(a, 0.14 * drag + 0.1 * rest);

    cueAt(ctx, t, 0.14, 'horse', 0.75);
    cueAt(ctx, t, 0.42, 'whoosh', 0.8);
    cueAt(ctx, t, 0.5, 'impact-flesh', 0.7);
    cueAt(ctx, t, 0.56, 'vocal:jarl', 0.85);
    cueAt(ctx, t, 0.62, 'fall', 0.8);
    resolve(a, s, t, 1.25, 0.62, 0, 0.1);
  },
};

/** He does not step aside at all: he plants the greatsword in the horse's line
 *  and lets the charge break itself on it, then finishes standing exactly where
 *  he started. */
const KXN_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.0, dist: 2.9, side: -1 });

    const dk = phase(t, 0.58, 0.92);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.55, s.y, s.vz - s.fz * 0.55);
    } else {
      const run = easeInCubic(phase(t, 0.12, 0.48));
      victimGuard(ctx, s, lerp(-2.2, 0.55, run));
      const gallop = Math.sin(t * 46);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      // Pulls up hard into the planted point and comes apart over it.
      const check = smooth(phase(t, 0.46, 0.54));
      const over = easeInCubic(phase(t, 0.52, 0.62));
      nudge(ctx.victim, 'mount', 0.85 * check - 0.9 * over);
      nudge(ctx.victim, 'mountHead', -0.5 * check + 0.6 * over);
      nudge(ctx.victim, 'spine', -0.3 * check + 0.7 * over, 0.2 * over);
      nudge(ctx.victim, 'armL', 1.1 * over, 0, 0.3 * over);
    }

    // Set, and wait. He does not move again until it is finished.
    const set = smooth(phase(t, 0.16, 0.4));
    blendPose(a, WALK, PLANT, set);
    const shock = bump(phase(t, 0.48, 0.62));
    nudge(a, 'forearmR', 0.25 * shock);
    nudge(a, 'forearmL', 0.22 * shock);
    nudge(a, 'spine', 0.2 * shock);
    nudge(a, 'head', -0.1 * shock);
    // He pulls it out of the board, and that is all.
    const draw = smooth(phase(t, 0.66, 0.78));
    if (draw > 0) blendPose(a, PLANT, BREATHE, draw);

    placeAt(a, s, 1.2 - 0.05 * shock, 0, 0, s.ay);
    if (t < ACT_END) sinkHips(a, 0.12 * set);

    cueAt(ctx, t, 0.16, 'horse', 0.7);
    cueAt(ctx, t, 0.3, 'impact-stone', 0.55);
    cueAt(ctx, t, 0.46, 'horse', 0.9);
    cueAt(ctx, t, 0.52, 'impact-flesh', 0.8);
    cueAt(ctx, t, 0.6, 'vocal:jarl', 0.8);
    shakeAt(ctx, t, 0.5, 0.2, 0.14);
    resolve(a, s, t, 1.2, 0, 0, 0.12);
  },
};

// ── kxb: through the runes ──────────────────────────────────────────────────

/** Walks shoulder-first through all three runes — his mantle chars, he does not
 *  stop — and breaks the staff with one downward cut. */
const KXB_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.0, dist: 2.6 });

    const dk = phase(t, 0.68, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Three casts, and the third is already too late.
      const c1 = bump(phase(t, 0.16, 0.28));
      const c2 = bump(phase(t, 0.32, 0.44));
      const c3 = bump(phase(t, 0.48, 0.58));
      const cast = c1 + c2 + c3;
      nudge(ctx.victim, 'armR', 0.8 * cast, 0, -0.3 * cast);
      nudge(ctx.victim, 'staff', -0.5 * cast);
      nudge(ctx.victim, 'armL', 0.5 * cast, 0, 0.3 * cast);
      const back = smooth(phase(t, 0.58, 0.68));
      nudge(ctx.victim, 'spine', -0.2 * back);
      nudge(ctx.victim, 'head', -0.3 * back);
    }

    // A steady walk, shoulder down, into all three. The pace never changes.
    const walk = smooth(phase(t, 0.08, 0.62));
    blendPose(a, WALK, SHOULDER, smooth(phase(t, 0.14, 0.34)));
    stepLegs(a, walk * 3.4, 0.32 * (1 - smooth(phase(t, 0.58, 0.7))));
    // Each rune moves the mantle and nothing else.
    const hits =
      bump(phase(t, 0.22, 0.32)) + bump(phase(t, 0.36, 0.46)) + bump(phase(t, 0.5, 0.6));
    nudge(a, 'cloak', 0.22 * hits);
    nudge(a, 'spine', -0.08 * hits);
    nudge(a, 'head', 0.06 * hits);
    const cut = easeInCubic(phase(t, 0.64, 0.74));
    if (cut > 0) blendPose(a, SHOULDER, CUT_LOW, cut);

    placeAt(a, s, lerp(1.6, 0.7, walk), 0, 0, s.ay);
    if (t < ACT_END) sinkHips(a, 0.12 * cut);

    cueAt(ctx, t, 0.22, 'rune', 0.75);
    cueAt(ctx, t, 0.36, 'rune', 0.75);
    cueAt(ctx, t, 0.5, 'rune', 0.75);
    cueAt(ctx, t, 0.56, 'vocal:jarl', 0.8);
    cueAt(ctx, t, 0.7, 'impact-metal', 0.9);
    resolve(a, s, t, 0.7, 0, 0, 0.12);
  },
};

/** The first rune actually stops him — he takes a knee under it. Then he gets
 *  up, and there is nothing left in her that can stop him twice. */
const KXB_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 0.9, dist: 2.5, side: -1 });

    const dk = phase(t, 0.72, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // One cast that works, and then nothing that does.
      const c1 = bump(phase(t, 0.14, 0.26));
      nudge(ctx.victim, 'armR', 1.0 * c1, 0, -0.35 * c1);
      nudge(ctx.victim, 'staff', -0.6 * c1);
      const c2 = bump(phase(t, 0.5, 0.62));
      nudge(ctx.victim, 'armR', 0.6 * c2, 0, -0.2 * c2);
      nudge(ctx.victim, 'staff', -0.35 * c2);
      // She backs away, which she has never had to do before.
      const retreat = smooth(phase(t, 0.62, 0.72));
      nudge(ctx.victim, 'spine', -0.25 * retreat);
      nudge(ctx.victim, 'head', -0.35 * retreat);
      nudge(ctx.victim, 'armL', 0.6 * retreat, 0, 0.4 * retreat);
    }

    // Stopped, down on a knee, up again, and then one cut.
    const hit = easeOutCubic(phase(t, 0.2, 0.32));
    const knee = smooth(phase(t, 0.28, 0.44));
    const up = smooth(phase(t, 0.48, 0.64));
    blendPose(a, WALK, GUARD, smooth(phase(t, 0.1, 0.24)));
    if (knee > 0) blendPose(a, GUARD, PLANT, knee * (1 - up));
    nudge(a, 'spine', 0.3 * knee * (1 - up));
    nudge(a, 'head', 0.25 * knee * (1 - up));
    nudge(a, 'cloak', 0.3 * hit * (1 - up));
    if (up > 0) blendPose(a, PLANT, SHOULDER, up);
    const cut = easeInCubic(phase(t, 0.66, 0.78));
    if (cut > 0) blendPose(a, SHOULDER, CUT_LOW, cut);

    placeAt(
      a,
      s,
      lerp(1.6, 1.15, smooth(phase(t, 0.08, 0.28))) - 0.45 * up,
      0,
      0,
      s.ay,
    );
    if (t < ACT_END) sinkHips(a, 0.3 * knee * (1 - up) + 0.12 * cut);

    cueAt(ctx, t, 0.18, 'rune', 0.9);
    cueAt(ctx, t, 0.26, 'vocal:jarl', 0.85);
    cueAt(ctx, t, 0.34, 'impact-stone', 0.5);
    cueAt(ctx, t, 0.52, 'rune', 0.6);
    cueAt(ctx, t, 0.72, 'impact-metal', 0.9);
    shakeAt(ctx, t, 0.2, 0.22, 0.14);
    resolve(a, s, t, 0.7, 0, 0, 0.12);
  },
};

// ── kxr: riding it down ─────────────────────────────────────────────────────

/** The palm slams down; his planted greatsword splits the blow; he steps inside,
 *  cuts the ankle seam, and rides the falling tower down. */
const KXR_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'push', height: 1.0, dist: 2.9 });

    const dk = phase(t, 0.68, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      unfoldJotunn(v, phase(t, 0.04, 0.4));
      // One palm down onto a planted blade.
      const w = phase(t, 0.4, 0.48);
      const slam = easeInCubic(phase(t, 0.48, 0.58));
      nudge(v, 'armR', -1.2 * w + 2.2 * slam);
      nudge(v, 'forearmR', 0.4 * slam);
      nudge(v, 'spine', 0.3 * slam);
      // The ankle goes, and it comes down on that side.
      const cut = smooth(phase(t, 0.6, 0.68));
      nudge(v, 'legR', -0.6 * cut);
      nudge(v, 'shinR', -0.5 * cut);
      const tip = easeInCubic(phase(t, 0.64, 0.74));
      nudge(v, 'armL', 1.2 * tip, 0, 0.5 * tip);
      v.root.rotation.set(0.3 * tip, s.vy, -0.4 * tip);
    }

    // Plant, take the blow on the blade, step inside, cut low.
    const set = smooth(phase(t, 0.18, 0.42));
    blendPose(a, WALK, PLANT, set);
    const split = bump(phase(t, 0.5, 0.62));
    nudge(a, 'forearmR', 0.3 * split);
    nudge(a, 'forearmL', 0.28 * split);
    nudge(a, 'spine', 0.25 * split);
    const inside = smooth(phase(t, 0.58, 0.68));
    if (inside > 0) blendPose(a, PLANT, SHOULDER, inside);
    const cut = easeInCubic(phase(t, 0.66, 0.76));
    if (cut > 0) blendPose(a, SHOULDER, CUT_LOW, cut);

    placeAt(a, s, lerp(1.5, 0.95, set) - 0.35 * inside, 0.3 * inside, 0, s.ay);
    if (t < ACT_END) sinkHips(a, 0.1 * set + 0.14 * cut);

    cueAt(ctx, t, 0.1, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.5, 'impact-stone', 0.95);
    cueAt(ctx, t, 0.56, 'vocal:jarl', 0.85);
    cueAt(ctx, t, 0.66, 'impact-stone', 0.8);
    cueAt(ctx, t, 0.74, 'stone-grind', 0.9);
    shakeAt(ctx, t, 0.5, 0.32, 0.18);
    shakeAt(ctx, t, 0.74, 0.3, 0.2);
    resolve(a, s, t, 0.6, 0.3, 0, 0.14);
  },
};

/** He gets to it before it has finished standing up, and drives the greatsword
 *  into the open seam two-handed — the giant is killed by the gap in its own
 *  armour, half-unfolded. */
const KXR_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'rise', height: 0.9, dist: 2.8, side: -1 });

    const dk = phase(t, 0.62, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      // Caught with its seams still open.
      unfoldJotunn(v, Math.min(phase(t, 0.1, 0.5), 0.66));
      const struck = smooth(phase(t, 0.48, 0.58));
      nudge(v, 'spine', -0.35 * struck);
      nudge(v, 'head', -0.45 * struck);
      nudge(v, 'armL', 0.7 * struck, 0, 0.35 * struck);
      nudge(v, 'armR', 0.7 * struck, 0, -0.35 * struck);
      const fail = smooth(phase(t, 0.58, 0.66));
      nudge(v, 'legL', -0.4 * fail);
      nudge(v, 'shinL', -0.35 * fail);
    }

    // No waiting: straight in while it is still stone, both hands, one drive.
    const close = easeOutCubic(phase(t, 0.1, 0.36));
    blendPose(a, WALK, GUARD, smooth(phase(t, 0.1, 0.28)));
    stepLegs(a, close * 2.6, 0.34 * (1 - smooth(phase(t, 0.3, 0.44))));
    const cock = smooth(phase(t, 0.36, 0.46));
    if (cock > 0) blendPose(a, GUARD, HALF_UP, cock);
    const drive = easeInCubic(phase(t, 0.46, 0.56));
    if (drive > 0) blendPose(a, HALF_UP, PLANT, drive);
    // He holds it there while the giant comes apart around the blade.
    const hold = bump(phase(t, 0.58, 0.76));
    nudge(a, 'spine', 0.12 * hold);
    nudge(a, 'forearmR', 0.15 * hold);

    placeAt(a, s, lerp(1.6, 0.8, close), 0, 0, s.ay);
    if (t < ACT_END) sinkHips(a, 0.12 * drive);

    cueAt(ctx, t, 0.14, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.42, 'vocal:jarl', 0.9);
    cueAt(ctx, t, 0.5, 'impact-stone', 0.95);
    cueAt(ctx, t, 0.6, 'stone-grind', 0.9);
    shakeAt(ctx, t, 0.5, 0.3, 0.16);
    resolve(a, s, t, 0.8, 0, 0, 0.12);
  },
};

// ── kxq: out of the air ─────────────────────────────────────────────────────

/** She dives; he does not dodge — takes the spear on the mantled shoulder,
 *  staggers, seizes the haft and swings her out of the air. */
const KXQ_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.05, dist: 2.8 });

    const dk = phase(t, 0.66, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx + s.rx * 0.7, s.y + 0.35, s.vz + s.rz * 0.7);
    } else {
      // Up, dive, and then she is not going anywhere.
      const climb = smooth(phase(t, 0.1, 0.3));
      const dive = easeInCubic(phase(t, 0.32, 0.52));
      const held = smooth(phase(t, 0.52, 0.62));
      const swung = easeInOutCubic(phase(t, 0.6, 0.74));
      victimGuard(
        ctx,
        s,
        lerp(-1.0, 0.35, dive) - 0.3 * swung,
        1.4 * swung,
        lerp(0, 1.6, climb) - 1.2 * dive + 0.35 * swung,
        s.vy + 2.6 * swung,
      );
      const b = Math.sin(t * 26);
      nudge(ctx.victim, 'wingL', 0, 0, 0.5 * b * (1 - held));
      nudge(ctx.victim, 'wingR', 0, 0, -0.5 * b * (1 - held));
      nudge(ctx.victim, 'armR', 1.3 * dive - 0.8 * held);
      nudge(ctx.victim, 'spine', 0.3 * dive + 0.3 * held);
      nudge(ctx.victim, 'wingL', 0, 0, -0.8 * swung);
      nudge(ctx.victim, 'wingR', 0, 0, 0.8 * swung);
    }

    // He watches it come and does nothing about it.
    const set = smooth(phase(t, 0.16, 0.36));
    blendPose(a, WALK, GUARD, set * 0.7);
    nudge(a, 'head', -0.25 * set);
    // The hit: it moves him, and he lets it.
    const hit = bump(phase(t, 0.5, 0.64));
    nudge(a, 'spine', -0.3 * hit, 0.2 * hit);
    nudge(a, 'cloak', 0.35 * hit);
    nudge(a, 'head', 0.2 * hit);
    const seize = smooth(phase(t, 0.56, 0.66));
    if (seize > 0) blendPose(a, GUARD, SEIZE, seize);
    const swing = easeInOutCubic(phase(t, 0.64, 0.78));
    if (swing > 0) blendPose(a, SEIZE, SWING_OUT, swing);

    // He gives half a pace to the impact and takes it back with the swing.
    placeAt(a, s, 1.15 - 0.18 * hit, 0, 0, s.ay + 0.55 * swing);
    if (t < ACT_END) sinkHips(a, 0.12 * hit);

    cueAt(ctx, t, 0.14, 'wing', 0.8);
    cueAt(ctx, t, 0.34, 'wing', 0.7);
    cueAt(ctx, t, 0.52, 'impact-flesh', 0.9);
    cueAt(ctx, t, 0.58, 'vocal:jarl', 0.9);
    cueAt(ctx, t, 0.7, 'whoosh', 0.8);
    resolve(a, s, t, 1.15);
  },
};

/** She stays out of reach and works him over from above — three passes, and he
 *  is bleeding from all of them. On the fourth he is not there: he has put the
 *  greatsword where she is going to be. */
const KXQ_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.1, dist: 3.0, side: -1 });

    const dk = phase(t, 0.7, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y + 0.9, s.vz);
    } else {
      // Three passes on a tightening circle, and a fourth that ends early.
      const orbit = easeInOutCubic(phase(t, 0.08, 0.7));
      const ang = -7.4 * orbit;
      const rad = lerp(1.5, 0.55, orbit);
      victimGuard(
        ctx,
        s,
        rad * Math.cos(ang),
        rad * Math.sin(ang),
        lerp(0.9, 0.55, orbit),
        s.vy + ang * 0.7,
      );
      const b = Math.sin(t * 28);
      nudge(ctx.victim, 'wingL', 0, 0, 0.5 * b);
      nudge(ctx.victim, 'wingR', 0, 0, -0.5 * b);
      const p1 = bump(phase(t, 0.2, 0.3));
      const p2 = bump(phase(t, 0.38, 0.48));
      const p3 = bump(phase(t, 0.54, 0.62));
      nudge(ctx.victim, 'armR', 1.4 * (p1 + p2 + p3));
      // Into the blade she cannot see.
      const met = smooth(phase(t, 0.66, 0.72));
      nudge(ctx.victim, 'spine', 0.5 * met);
      nudge(ctx.victim, 'wingL', 0, 0, -1.0 * met);
      nudge(ctx.victim, 'wingR', 0, 0, 1.0 * met);
    }

    // He turns with her, wearing it, and gives nothing away until the last.
    const turn = easeInOutCubic(phase(t, 0.1, 0.62));
    blendPose(a, WALK, GUARD, smooth(phase(t, 0.1, 0.26)));
    const cuts =
      bump(phase(t, 0.22, 0.32)) + bump(phase(t, 0.4, 0.5)) + bump(phase(t, 0.56, 0.64));
    nudge(a, 'cloak', 0.28 * cuts);
    nudge(a, 'spine', -0.16 * cuts);
    nudge(a, 'head', 0.12 * cuts);
    // The one committed act of the whole duel, and it is a placement.
    const set = smooth(phase(t, 0.6, 0.68));
    if (set > 0) blendPose(a, GUARD, HALF_UP, set);
    const through = easeInCubic(phase(t, 0.68, 0.76));
    if (through > 0) blendPose(a, HALF_UP, HALF_THROUGH, through);

    placeAt(a, s, 1.1, 0, 0, s.ay - 4.6 * turn * 0.7);

    cueAt(ctx, t, 0.14, 'wing', 0.8);
    cueAt(ctx, t, 0.26, 'impact-flesh', 0.6);
    cueAt(ctx, t, 0.44, 'impact-flesh', 0.6);
    cueAt(ctx, t, 0.6, 'impact-flesh', 0.6);
    cueAt(ctx, t, 0.64, 'vocal:jarl', 0.9);
    cueAt(ctx, t, 0.72, 'impact-metal', 0.9);
    resolve(a, s, t, 1.1);
  },
};

export const JARL_ROW: DuelMatrix = {
  kxp: [KXP_A, KXP_B],
  kxn: [KXN_A, KXN_B],
  kxb: [KXB_A, KXB_B],
  kxr: [KXR_A, KXR_B],
  kxq: [KXQ_A, KXQ_B],
};
