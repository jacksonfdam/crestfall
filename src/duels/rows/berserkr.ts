/**
 * Berserkr attacks — the knight row. Mounted, twin axes, and always moving:
 * every cell carries speed through the strike rather than stopping to trade.
 * Three cells take him off the horse (nxb, nxq, nxk); each puts him back in the
 * saddle before the resolve, because the victor rides onto the captured square.
 *
 * The horse is a character too — it veers, slides, pulls up short and rears,
 * and it is never the thing that dies.
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
  seatRider,
  shakeAt,
  stageDuel,
  type Pose,
} from './support.ts';

const smooth = (x: number): number => x * x * (3 - 2 * x);
const bump = (x: number): number => Math.sin(Math.PI * clamp01(x));

type NBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR'
  | 'weapon' | 'mount' | 'mountHead';

// ── Pose library ────────────────────────────────────────────────────────────

/** Riding: axes low and wide, weight over the withers. */
const RIDE: Pose<NBone> = {
  spine: [0.18, 0, 0], chest: [0.02, 0, 0], head: [-0.08, 0, 0],
  armL: [0.4, 0, 0.4], forearmL: [0.5, 0, 0],
  armR: [0.4, 0, -0.4], forearmR: [0.5, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.55, 0, 0.45], shinL: [-1.0, 0, 0],
  legR: [0.55, 0, -0.45], shinR: [-1.0, 0, 0],
  weapon: [0, 0, 0], mount: [0, 0, 0], mountHead: [0.1, 0, 0],
};

/** Both axes cocked high and outside — the wind-up for the scissor. */
const SCISSOR_UP: Pose<NBone> = {
  spine: [0.05, 0, 0], chest: [-0.05, 0, 0], head: [-0.15, -0.1, 0],
  armL: [2.5, 0, 0.75], forearmL: [0.9, 0, 0],
  armR: [2.5, 0, -0.75], forearmR: [0.9, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.5, 0, 0.45], shinL: [-0.95, 0, 0],
  legR: [0.5, 0, -0.45], shinR: [-0.95, 0, 0],
  weapon: [0, 0, 0], mount: [0, 0, 0], mountHead: [0.05, 0, 0],
};

/** Both axes closing across each other at rim height. */
const SCISSOR_IN: Pose<NBone> = {
  spine: [0.34, 0, 0], chest: [0.12, 0, 0], head: [0.15, 0, 0],
  armL: [1.35, 0, -0.5], forearmL: [0.35, 0, 0],
  armR: [1.35, 0, 0.5], forearmR: [0.35, 0, 0],
  handL: [0, 0, 0.4], handR: [0, 0, -0.4],
  legL: [0.6, 0, 0.42], shinL: [-1.05, 0, 0],
  legR: [0.6, 0, -0.42], shinR: [-1.05, 0, 0],
  weapon: [0, 0, 0], mount: [0, 0, 0], mountHead: [0.2, 0, 0],
};

/** Flat along the horse's neck, under a swing. */
const UNDER: Pose<NBone> = {
  spine: [0.85, 0.35, 0], chest: [0.3, 0.1, 0], head: [-0.2, -0.3, 0],
  armL: [1.9, 0, 0.3], forearmL: [1.1, 0, 0],
  armR: [0.7, 0, -0.9], forearmR: [0.8, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.7, 0, 0.5], shinL: [-1.2, 0, 0],
  legR: [0.4, 0, -0.4], shinR: [-0.85, 0, 0],
  weapon: [0.3, 0, 0], mount: [0, 0, 0], mountHead: [0.35, 0, 0],
};

/** Reaching out of the saddle to take hold of something. */
const REACH: Pose<NBone> = {
  spine: [0.15, -0.45, 0], chest: [0.05, -0.15, 0], head: [0, -0.4, 0],
  armL: [1.15, 0, 0.9], forearmL: [0.3, 0, 0],
  armR: [1.9, 0, -0.35], forearmR: [0.25, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.75, 0, 0.5], shinL: [-1.15, 0, 0],
  legR: [0.35, 0, -0.35], shinR: [-0.8, 0, 0],
  weapon: [0, 0, 0], mount: [0, 0, 0], mountHead: [0.05, 0, 0],
};

/** Standing in the stirrups, gathered to jump. */
const STAND: Pose<NBone> = {
  spine: [-0.1, 0, 0], chest: [-0.05, 0, 0], head: [-0.3, 0, 0],
  armL: [1.6, 0, 0.6], forearmL: [0.7, 0, 0],
  armR: [1.6, 0, -0.6], forearmR: [0.7, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.15, 0, 0.2], shinL: [-0.35, 0, 0],
  legR: [0.15, 0, -0.2], shinR: [-0.35, 0, 0],
  weapon: [0, 0, 0], mount: [0, 0, 0], mountHead: [-0.1, 0, 0],
};

/** Airborne, both axes overhead, legs trailing. */
const LEAP: Pose<NBone> = {
  spine: [-0.2, 0, 0], chest: [-0.08, 0, 0], head: [-0.35, 0, 0],
  armL: [2.7, 0, 0.5], forearmL: [0.4, 0, 0],
  armR: [2.7, 0, -0.5], forearmR: [0.4, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.5, 0, 0.3], shinL: [-1.3, 0, 0],
  legR: [0.3, 0, -0.25], shinR: [-1.0, 0, 0],
  weapon: [0, 0, 0], mount: [0, 0, 0], mountHead: [0, 0, 0],
};

/** Both axes driven down through whatever is below him. */
const FALLING_AXES: Pose<NBone> = {
  spine: [0.55, 0, 0], chest: [0.2, 0, 0], head: [0.3, 0, 0],
  armL: [0.7, 0, 0.15], forearmL: [0.1, 0, 0],
  armR: [0.7, 0, -0.15], forearmR: [0.1, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.9, 0, 0.35], shinL: [-1.5, 0, 0],
  legR: [1.0, 0, -0.3], shinR: [-1.6, 0, 0],
  weapon: [0, 0, 0], mount: [0, 0, 0], mountHead: [0, 0, 0],
};

/** One axe chopping into a low seam on the off side. */
const CHOP_LOW: Pose<NBone> = {
  spine: [0.5, -0.55, 0], chest: [0.15, -0.2, 0], head: [0.25, -0.5, 0],
  armL: [0.9, 0, 0.6], forearmL: [0.9, 0, 0],
  armR: [1.5, 0, -0.15], forearmR: [0.05, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.8, 0, 0.5], shinL: [-1.2, 0, 0],
  legR: [0.45, 0, -0.4], shinR: [-0.9, 0, 0],
  weapon: [-0.6, 0, 0], mount: [0, 0, 0], mountHead: [0.15, 0, 0],
};

/** Grounded and finishing: both axes working, weight low. */
const GROUND_WORK: Pose<NBone> = {
  spine: [0.42, 0.1, 0], chest: [0.15, 0, 0], head: [0.25, 0.05, 0],
  armL: [1.1, 0, 0.3], forearmL: [0.5, 0, 0],
  armR: [2.2, 0, -0.4], forearmR: [0.7, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.35, 0, 0.2], shinL: [-0.55, 0, 0],
  legR: [-0.2, 0, -0.2], shinR: [-0.3, 0, 0],
  weapon: [0, 0, 0], mount: [0, 0, 0], mountHead: [0, 0, 0],
};

// ── nxp: the passing charge ─────────────────────────────────────────────────

/** The horse veers at the last stride; both axes scissor over the rim. */
const NXP_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.15, dist: 2.9 });

    const dk = phase(t, 0.6, 0.94);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // He sets his shield against a charge that does not come where he set it.
      const set = smooth(phase(t, 0.14, 0.34));
      nudge(ctx.victim, 'armL', 0.4 * set, 0, -0.15 * set);
      nudge(ctx.victim, 'spine', 0.12 * set);
      const wrong = smooth(phase(t, 0.44, 0.58));
      nudge(ctx.victim, 'armL', -0.3 * wrong, 0.5 * wrong);
      nudge(ctx.victim, 'head', 0, 0.6 * wrong);
    }

    // Straight in, then the veer, then both axes across the rim at speed.
    const run = easeInOutCubic(phase(t, 0.1, 0.58));
    const veer = smooth(phase(t, 0.4, 0.56));
    const cock = smooth(phase(t, 0.3, 0.48));
    blendPose(a, RIDE, SCISSOR_UP, cock);
    const cut = easeInCubic(phase(t, 0.5, 0.62));
    if (cut > 0) blendPose(a, SCISSOR_UP, SCISSOR_IN, cut);
    // Gallop through the whole approach; the horse leans into its own veer.
    const gallop = Math.sin(t * 40) * (1 - cut * 0.6);
    nudge(a, 'mount', 0.07 * gallop, 0, -0.25 * veer);
    nudge(a, 'mountHead', 0.13 * gallop, -0.45 * veer, 0);

    placeAt(
      a,
      s,
      lerp(1.7, 0.45, run),
      // The line breaks late: he passes on the shield side rather than into it.
      0.95 * veer,
      0,
      s.ay - 0.55 * veer,
    );

    cueAt(ctx, t, 0.12, 'horse', 0.7);
    cueAt(ctx, t, 0.34, 'vocal:berserkr', 0.8);
    cueAt(ctx, t, 0.46, 'horse', 0.5);
    cueAt(ctx, t, 0.54, 'whoosh', 0.8);
    cueAt(ctx, t, 0.6, 'impact-metal', 0.85);
    resolve(a, s, t, 0.4, 0.9);
  },
};

/** The huscarl gets his spear into the horse's path and the charge has to
 *  break off; the second pass comes back the other way, one axe backhanded. */
const NXP_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.1, dist: 3.0, side: -1 });

    const dk = phase(t, 0.66, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // The spear that turns the first pass, and is still out of line for the
      // second.
      const jab = bump(phase(t, 0.2, 0.36));
      nudge(ctx.victim, 'armR', 0.9 * jab);
      nudge(ctx.victim, 'forearmR', -0.6 * jab);
      nudge(ctx.victim, 'spine', 0.2 * jab);
      const turning = smooth(phase(t, 0.46, 0.66));
      nudge(ctx.victim, 'armR', -0.4 * turning);
      nudge(ctx.victim, 'spine', 0, -0.7 * turning);
      nudge(ctx.victim, 'head', 0, -0.8 * turning);
    }

    // Aborted pass, wide turn, and back through on the other rein.
    const pass1 = easeOutCubic(phase(t, 0.1, 0.36));
    const turn = easeInOutCubic(phase(t, 0.36, 0.62));
    const pass2 = easeInCubic(phase(t, 0.6, 0.78));
    const gallop = Math.sin(t * 42);
    nudge(a, 'mount', 0.07 * gallop, 0, 0.3 * turn - 0.3 * pass2);
    nudge(a, 'mountHead', 0.12 * gallop, 0.7 * turn, 0);
    // One axe kept high through the turn, then brought back across.
    const carry = smooth(phase(t, 0.4, 0.6));
    blendPose(a, RIDE, SCISSOR_UP, carry * 0.7);
    nudge(a, 'armL', -0.5 * carry);
    const back = easeInCubic(phase(t, 0.62, 0.76));
    if (back > 0) blendPose(a, SCISSOR_UP, SCISSOR_IN, back);
    nudge(a, 'armL', 0.6 * back, 0, 0.5 * back);

    placeAt(
      a,
      s,
      // In, out to the flank, and back in from the other side.
      lerp(1.7, 0.9, pass1) + 0.9 * turn - 1.35 * pass2,
      1.5 * turn - 2.6 * turn * pass2,
      0,
      s.ay + 1.5 * turn - 3.0 * turn * pass2,
    );

    cueAt(ctx, t, 0.12, 'horse', 0.7);
    cueAt(ctx, t, 0.26, 'impact-metal', 0.6);
    cueAt(ctx, t, 0.42, 'horse', 0.75);
    cueAt(ctx, t, 0.5, 'vocal:berserkr', 0.85);
    cueAt(ctx, t, 0.68, 'impact-flesh', 0.8);
    resolve(a, s, t, 0.5, -0.5);
  },
};

// ── nxn: rider against rider ────────────────────────────────────────────────

/** Two passes: sparks on the first, a saddle emptied on the second. */
const NXN_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.2, dist: 3.1 });

    const dk = phase(t, 0.7, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.4, s.y, s.vz - s.fz * 0.4);
    } else {
      // He rides the mirror of the attacker's course, and swings high on the
      // return — which is what opens him up.
      const p1 = easeInOutCubic(phase(t, 0.08, 0.38));
      const p2 = easeInOutCubic(phase(t, 0.44, 0.72));
      victimGuard(
        ctx,
        s,
        lerp(-1.5, 0.7, p1) * (1 - p2) + lerp(0.7, -0.4, p2) * p2,
        lerp(0, -1.0, p1) * (1 - p2) + lerp(-1.0, 0.2, p2) * p2,
        0,
        s.vy - 0.5 * p1 + 0.9 * p2,
      );
      const gallop = Math.sin(t * 41 + 1.3);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      const trade = bump(phase(t, 0.2, 0.32));
      nudge(ctx.victim, 'armR', 1.4 * trade, 0, -0.3 * trade);
      const high = bump(phase(t, 0.54, 0.7));
      nudge(ctx.victim, 'armR', 2.0 * high, 0, -0.4 * high);
      nudge(ctx.victim, 'spine', -0.3 * high);
    }

    // First pass: axes meet axes. Second: he goes flat and takes the man.
    const p1 = easeInOutCubic(phase(t, 0.08, 0.38));
    const p2 = easeInOutCubic(phase(t, 0.44, 0.74));
    const trade = bump(phase(t, 0.2, 0.32));
    blendPose(a, RIDE, SCISSOR_UP, trade);
    const flat = smooth(phase(t, 0.5, 0.64));
    if (flat > 0) blendPose(a, RIDE, UNDER, flat);
    const take = easeOutCubic(phase(t, 0.64, 0.78));
    if (take > 0) blendPose(a, UNDER, REACH, take);
    const gallop = Math.sin(t * 43);
    nudge(a, 'mount', 0.07 * gallop);
    nudge(a, 'mountHead', 0.12 * gallop);

    placeAt(
      a,
      s,
      lerp(1.7, -0.5, p1) * (1 - p2) + lerp(-0.5, 0.55, p2) * p2,
      lerp(0, 1.0, p1) * (1 - p2) + lerp(1.0, -0.15, p2) * p2,
      0,
      s.ay + 0.5 * p1 - 0.9 * p2,
    );

    cueAt(ctx, t, 0.1, 'horse', 0.7);
    cueAt(ctx, t, 0.24, 'impact-metal', 0.9);
    cueAt(ctx, t, 0.34, 'vocal:berserkr', 0.8);
    cueAt(ctx, t, 0.48, 'horse', 0.6);
    cueAt(ctx, t, 0.7, 'impact-flesh', 0.8);
    resolve(a, s, t, 0.55, -0.15);
  },
};

/** No passing at all: the two horses meet chest to chest and it becomes a
 *  standing brawl, finished by dragging him down over his own cantle. */
const NXN_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.25, dist: 2.7 });

    const dk = phase(t, 0.72, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      const close = easeOutCubic(phase(t, 0.08, 0.3));
      victimGuard(ctx, s, lerp(-1.3, -0.15, close));
      const shove = Math.sin(t * 9);
      nudge(ctx.victim, 'mount', 0.08 * shove);
      nudge(ctx.victim, 'mountHead', 0.3 * bump(phase(t, 0.3, 0.44)) + 0.1 * shove);
      // He gets two blows in before he loses his seat.
      const b1 = bump(phase(t, 0.34, 0.46));
      const b2 = bump(phase(t, 0.5, 0.62));
      nudge(ctx.victim, 'armR', 1.6 * (b1 + b2), 0, -0.3 * (b1 + b2));
      nudge(ctx.victim, 'spine', 0.2 * (b1 + b2));
      const dragged = smooth(phase(t, 0.62, 0.72));
      nudge(ctx.victim, 'spine', -0.4 * dragged, 0.5 * dragged);
      nudge(ctx.victim, 'armL', 1.2 * dragged, 0, 0.4 * dragged);
    }

    // Chest to chest, trading, then both hands on him.
    const close = easeOutCubic(phase(t, 0.08, 0.3));
    const brawl = bump(phase(t, 0.3, 0.44)) + bump(phase(t, 0.44, 0.58));
    blendPose(a, RIDE, SCISSOR_IN, clamp01(brawl));
    const grab = smooth(phase(t, 0.58, 0.7));
    if (grab > 0) blendPose(a, SCISSOR_IN, REACH, grab);
    const drag = easeInCubic(phase(t, 0.68, 0.8));
    if (drag > 0) blendPose(a, REACH, GROUND_WORK, drag * 0.55);
    const shove = Math.sin(t * 9 + 2.1);
    nudge(a, 'mount', 0.08 * shove);
    nudge(a, 'mountHead', 0.12 * shove);

    placeAt(a, s, lerp(1.7, 0.75, close) - 0.1 * drag, 0, 0, s.ay + 0.25 * drag);

    cueAt(ctx, t, 0.1, 'horse', 0.8);
    cueAt(ctx, t, 0.3, 'horse', 0.6);
    cueAt(ctx, t, 0.36, 'impact-metal', 0.85);
    cueAt(ctx, t, 0.5, 'impact-metal', 0.8);
    cueAt(ctx, t, 0.6, 'vocal:berserkr', 0.9);
    cueAt(ctx, t, 0.74, 'fall', 0.7);
    resolve(a, s, t, 0.6);
  },
};

// ── nxb: the spooked horse ──────────────────────────────────────────────────

/** Her first rune spooks the horse; he leaps from the rearing saddle, over the
 *  second rune, and comes down through the third. */
const NXB_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'rise', height: 1.0, dist: 2.8 });

    const dk = phase(t, 0.72, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Three casts. The third is still forming when he lands on it.
      const c1 = bump(phase(t, 0.14, 0.26));
      const c2 = bump(phase(t, 0.38, 0.5));
      const c3 = bump(phase(t, 0.58, 0.7));
      const cast = c1 + c2 + c3;
      nudge(ctx.victim, 'armR', 0.8 * cast, 0, -0.3 * cast);
      nudge(ctx.victim, 'staff', -0.55 * cast);
      nudge(ctx.victim, 'armL', 0.55 * cast, 0, 0.3 * cast);
      nudge(ctx.victim, 'head', -0.3 * bump(phase(t, 0.62, 0.74)));
    }

    // The rear is the anticipation for the leap: he goes up as the horse does.
    const spook = smooth(phase(t, 0.2, 0.34));
    const settleHorse = smooth(phase(t, 0.44, 0.7));
    const rear = spook * (1 - settleHorse);
    const gather = smooth(phase(t, 0.3, 0.44));
    const air = easeOutCubic(phase(t, 0.44, 0.64));
    const fall = easeInCubic(phase(t, 0.62, 0.76));
    const back = smooth(phase(t, 0.76, ACT_END));

    blendPose(a, RIDE, STAND, gather * (1 - air));
    if (air > 0) blendPose(a, STAND, LEAP, air * (1 - fall));
    if (fall > 0) blendPose(a, LEAP, FALLING_AXES, fall * (1 - back));
    if (back > 0) blendPose(a, FALLING_AXES, RIDE, back);

    // The horse rears under him, then comes down and stays put.
    nudge(a, 'mount', 0.95 * rear, 0.25 * rear, 0);
    nudge(a, 'mountHead', -0.6 * rear, 0, 0);

    // Off the saddle at the top of the rear, down on the far side, and back
    // into the seat before the resolve.
    const off = air * (1 - back);
    const down = fall * (1 - back);
    seatRider(
      a,
      0,
      (0.55 * off - 0.55 * down) * (1 - back),
      (-1.5 * off - 0.5 * down) * (1 - back),
    );

    placeAt(a, s, lerp(1.7, 1.15, smooth(phase(t, 0.06, 0.3))), 0, 0, s.ay);

    cueAt(ctx, t, 0.16, 'rune', 0.8);
    cueAt(ctx, t, 0.22, 'horse', 0.9);
    cueAt(ctx, t, 0.4, 'rune', 0.75);
    cueAt(ctx, t, 0.46, 'vocal:berserkr', 0.9);
    cueAt(ctx, t, 0.6, 'rune', 0.7);
    cueAt(ctx, t, 0.72, 'impact-flesh', 0.8);
    resolve(a, s, t, 1.15);
  },
};

/** He never lets her get the first cast away: the horse is put straight at the
 *  staff, and he takes it out of her hands on the way past. */
const NXB_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.05, dist: 2.6, side: -1 });

    const dk = phase(t, 0.64, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // A cast begun and not finished.
      const begin = smooth(phase(t, 0.16, 0.34));
      nudge(ctx.victim, 'armR', 0.7 * begin, 0, -0.25 * begin);
      nudge(ctx.victim, 'staff', -0.45 * begin);
      const taken = smooth(phase(t, 0.42, 0.56));
      nudge(ctx.victim, 'armR', -1.1 * taken, 0, 0.6 * taken);
      nudge(ctx.victim, 'staff', 1.3 * taken, 0.4 * taken, 0.5 * taken);
      nudge(ctx.victim, 'spine', 0.3 * taken, 0.35 * taken);
      nudge(ctx.victim, 'head', 0.2 * taken);
    }

    // Straight at her, one axe hooking the staff, the other coming back.
    const run = easeInCubic(phase(t, 0.08, 0.5));
    const hook = smooth(phase(t, 0.36, 0.5));
    blendPose(a, RIDE, REACH, hook);
    const cut = easeInCubic(phase(t, 0.52, 0.66));
    if (cut > 0) blendPose(a, REACH, SCISSOR_IN, cut);
    const gallop = Math.sin(t * 44);
    nudge(a, 'mount', 0.07 * gallop);
    nudge(a, 'mountHead', 0.12 * gallop);

    placeAt(a, s, lerp(1.7, 0.7, run), 0.35 * hook - 0.2 * cut, 0, s.ay - 0.2 * hook);

    cueAt(ctx, t, 0.1, 'horse', 0.75);
    cueAt(ctx, t, 0.2, 'rune', 0.5);
    cueAt(ctx, t, 0.44, 'impact-metal', 0.85);
    cueAt(ctx, t, 0.5, 'vocal:berserkr', 0.8);
    cueAt(ctx, t, 0.62, 'impact-flesh', 0.75);
    resolve(a, s, t, 0.65, 0.15);
  },
};

// ── nxr: under the stone arm ────────────────────────────────────────────────

/** The arm sweeps; the horse slides under it and he chops the elbow seam. */
const NXR_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'push', height: 1.2, dist: 3.0 });

    const dk = phase(t, 0.7, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      unfoldJotunn(v, phase(t, 0.04, 0.42));
      // One long horizontal sweep of the arm.
      const w = phase(t, 0.42, 0.52);
      const sweep = easeInCubic(phase(t, 0.52, 0.64));
      nudge(v, 'armR', 0.5 * sweep, -1.5 * w + 2.4 * sweep, 0.9 * sweep);
      nudge(v, 'spine', 0, -0.3 * w + 0.5 * sweep);
      // The arm comes off at the elbow and it loses its balance.
      const broken = smooth(phase(t, 0.64, 0.74));
      nudge(v, 'forearmR', 1.6 * broken, 0.8 * broken, 0);
      nudge(v, 'spine', 0.2 * broken, 0, 0.3 * broken);
    }

    // Slide under the sweep, chop on the way through.
    const run = easeInOutCubic(phase(t, 0.1, 0.56));
    const slide = smooth(phase(t, 0.46, 0.6));
    blendPose(a, RIDE, UNDER, slide);
    const chop = easeInCubic(phase(t, 0.6, 0.72));
    if (chop > 0) blendPose(a, UNDER, CHOP_LOW, chop);
    const gallop = Math.sin(t * 42) * (1 - slide * 0.5);
    nudge(a, 'mount', 0.07 * gallop - 0.35 * slide, 0, 0.2 * slide);
    nudge(a, 'mountHead', 0.12 * gallop - 0.3 * slide, 0, 0);

    placeAt(a, s, lerp(1.8, 0.55, run), 0.55 * slide, 0, s.ay - 0.3 * slide);

    cueAt(ctx, t, 0.08, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.5, 'whoosh', 0.9);
    cueAt(ctx, t, 0.56, 'horse', 0.7);
    cueAt(ctx, t, 0.62, 'impact-stone', 0.9);
    cueAt(ctx, t, 0.68, 'vocal:berserkr', 0.85);
    shakeAt(ctx, t, 0.62, 0.3, 0.16);
    resolve(a, s, t, 0.5, 0.55);
  },
};

/** The giant gets its hands on the horse instead — it is lifted at the
 *  forehand. He steps off the rising saddle onto the giant's own arm and works
 *  up it to the shoulder seam. */
const NXR_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'rise', height: 1.05, dist: 3.0, side: -1 });

    const dk = phase(t, 0.74, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      unfoldJotunn(v, phase(t, 0.04, 0.4));
      // It reaches down and takes hold, then cannot get him off its arm.
      const grab = smooth(phase(t, 0.42, 0.56));
      const lift = smooth(phase(t, 0.54, 0.7));
      nudge(v, 'armL', 1.3 * grab - 1.5 * lift, 0.3 * grab, 0);
      nudge(v, 'forearmL', 0.5 * grab - 0.3 * lift);
      nudge(v, 'spine', 0.3 * grab - 0.35 * lift);
      const shrug = bump(phase(t, 0.66, 0.8));
      nudge(v, 'chest', 0, 0.3 * shrug);
      nudge(v, 'head', -0.3 * smooth(phase(t, 0.68, 0.78)));
    }

    // The horse is taken up at the forehand; he uses it as a step.
    const close = easeOutCubic(phase(t, 0.08, 0.4));
    const hoist = smooth(phase(t, 0.5, 0.66));
    const step = easeOutCubic(phase(t, 0.6, 0.74));
    const back = smooth(phase(t, 0.78, ACT_END));
    nudge(a, 'mount', 0.9 * hoist, 0, 0.2 * hoist);
    nudge(a, 'mountHead', -0.5 * hoist, 0.3 * hoist, 0);
    blendPose(a, RIDE, STAND, hoist * (1 - step));
    if (step > 0) blendPose(a, STAND, FALLING_AXES, step * (1 - back));
    if (back > 0) blendPose(a, FALLING_AXES, RIDE, back);
    seatRider(a, 0, (1.05 * step) * (1 - back), (-0.8 * step) * (1 - back));

    placeAt(a, s, lerp(1.8, 1.05, close), 0, 0, s.ay);

    cueAt(ctx, t, 0.08, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.46, 'horse', 0.9);
    cueAt(ctx, t, 0.56, 'stone-grind', 0.7);
    cueAt(ctx, t, 0.64, 'vocal:berserkr', 0.9);
    cueAt(ctx, t, 0.72, 'impact-stone', 0.9);
    shakeAt(ctx, t, 0.72, 0.3, 0.16);
    resolve(a, s, t, 1.05);
  },
};

// ── nxq: after the airborne ─────────────────────────────────────────────────

/** She lifts off; he stands on the saddle, leaps, catches her spear-arm and
 *  drags her out of the air. */
const NXQ_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'rise', height: 1.1, dist: 3.0 });

    const dk = phase(t, 0.66, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y + 0.95, s.vz);
    } else {
      // Up — but not fast enough, and then down with him on her arm.
      const lift = easeOutCubic(phase(t, 0.14, 0.44));
      const caught = smooth(phase(t, 0.52, 0.66));
      victimGuard(ctx, s, 0, 0, lerp(0, 1.45, lift) - 0.5 * caught);
      const beat = Math.sin(t * 25);
      nudge(ctx.victim, 'wingL', 0, 0, 0.45 * beat * (1 - caught));
      nudge(ctx.victim, 'wingR', 0, 0, -0.45 * beat * (1 - caught));
      nudge(ctx.victim, 'armR', -0.6 * caught, 0, -0.5 * caught);
      nudge(ctx.victim, 'spine', 0.4 * caught, 0.3 * caught);
    }

    // Stand, leap, take the arm, and finish it on the ground.
    const gather = smooth(phase(t, 0.24, 0.4));
    const air = easeOutCubic(phase(t, 0.4, 0.56));
    const hold = smooth(phase(t, 0.54, 0.66));
    const down = easeInCubic(phase(t, 0.64, 0.78));
    const back = smooth(phase(t, 0.78, ACT_END));

    blendPose(a, RIDE, STAND, gather * (1 - air));
    if (air > 0) blendPose(a, STAND, LEAP, air * (1 - hold));
    if (hold > 0) blendPose(a, LEAP, REACH, hold * (1 - down));
    if (down > 0) blendPose(a, REACH, GROUND_WORK, down * (1 - back));
    if (back > 0) blendPose(a, GROUND_WORK, RIDE, back);
    nudge(a, 'mount', 0.2 * gather * (1 - air));

    // Off the saddle, up to her, and back down to the board with her.
    const up = (air - down * 0.85) * (1 - back);
    seatRider(a, 0, 1.3 * up, -0.75 * up);

    placeAt(a, s, lerp(1.7, 1.0, smooth(phase(t, 0.06, 0.36))), 0, 0, s.ay);

    cueAt(ctx, t, 0.16, 'wing', 0.8);
    cueAt(ctx, t, 0.34, 'horse', 0.6);
    cueAt(ctx, t, 0.42, 'vocal:berserkr', 0.9);
    cueAt(ctx, t, 0.56, 'impact-flesh', 0.7);
    cueAt(ctx, t, 0.7, 'fall', 0.85);
    resolve(a, s, t, 1.0);
  },
};

/** She never gets off the ground: he rides straight over the top of the
 *  wingbeat and pins a wing under the horse's shoulder, finishing mounted. */
const NXQ_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.15, dist: 2.8, side: -1 });

    const dk = phase(t, 0.62, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y + 0.2, s.vz);
    } else {
      // A wingbeat that is caught before it can lift her.
      const tryLift = smooth(phase(t, 0.2, 0.38));
      const pinned = smooth(phase(t, 0.44, 0.6));
      victimGuard(ctx, s, 0, 0, 0.3 * tryLift * (1 - pinned) + 0.2 * pinned);
      const beat = Math.sin(t * 28);
      nudge(ctx.victim, 'wingL', 0, 0, 0.6 * beat * (1 - pinned) - 0.9 * pinned);
      nudge(ctx.victim, 'wingR', 0, 0, -0.6 * beat * (1 - pinned));
      nudge(ctx.victim, 'spine', -0.2 * tryLift + 0.45 * pinned);
      nudge(ctx.victim, 'armR', 0.7 * tryLift - 0.5 * pinned);
    }

    // Straight over her line, shoulder into the wing, axes down from the seat.
    const run = easeInCubic(phase(t, 0.08, 0.48));
    const shoulder = smooth(phase(t, 0.42, 0.56));
    blendPose(a, RIDE, SCISSOR_UP, smooth(phase(t, 0.3, 0.5)));
    const down = easeInCubic(phase(t, 0.56, 0.7));
    if (down > 0) blendPose(a, SCISSOR_UP, FALLING_AXES, down * 0.8);
    const gallop = Math.sin(t * 43) * (1 - shoulder * 0.6);
    nudge(a, 'mount', 0.07 * gallop + 0.25 * shoulder, 0, -0.2 * shoulder);
    nudge(a, 'mountHead', 0.12 * gallop - 0.25 * shoulder, 0, 0);

    placeAt(a, s, lerp(1.7, 0.62, run), 0.3 * shoulder, 0, s.ay - 0.25 * shoulder);

    cueAt(ctx, t, 0.1, 'horse', 0.75);
    cueAt(ctx, t, 0.22, 'wing', 0.8);
    cueAt(ctx, t, 0.46, 'impact-flesh', 0.7);
    cueAt(ctx, t, 0.52, 'vocal:berserkr', 0.85);
    cueAt(ctx, t, 0.64, 'impact-metal', 0.8);
    resolve(a, s, t, 0.6, 0.3);
  },
};

// ── nxk: over the pike ──────────────────────────────────────────────────────

/** The Jarl sets his point like a pike; the horse pulls up short and the
 *  Berserkr goes over its head, over the blade, both axes down. */
const NXK_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'rise', height: 1.0, dist: 2.9 });

    const dk = phase(t, 0.7, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Point set and braced — a good answer to a horse, and no answer at all
      // to a man in the air.
      const set = smooth(phase(t, 0.12, 0.34));
      nudge(ctx.victim, 'armR', 0.45 * set, 0, 0.2 * set);
      nudge(ctx.victim, 'armL', 0.4 * set, 0, -0.2 * set);
      nudge(ctx.victim, 'weapon', -0.75 * set);
      nudge(ctx.victim, 'spine', 0.2 * set);
      const late = smooth(phase(t, 0.58, 0.7));
      nudge(ctx.victim, 'head', -0.45 * late);
      nudge(ctx.victim, 'armR', -0.3 * late);
    }

    // The horse refuses the point; he does not.
    const run = easeOutCubic(phase(t, 0.08, 0.42));
    const propUp = smooth(phase(t, 0.4, 0.52));
    const vault = easeOutCubic(phase(t, 0.5, 0.66));
    const fall = easeInCubic(phase(t, 0.64, 0.78));
    const back = smooth(phase(t, 0.78, ACT_END));

    blendPose(a, RIDE, STAND, propUp * (1 - vault));
    if (vault > 0) blendPose(a, STAND, LEAP, vault * (1 - fall));
    if (fall > 0) blendPose(a, LEAP, FALLING_AXES, fall * (1 - back));
    if (back > 0) blendPose(a, FALLING_AXES, RIDE, back);
    // Pulling up hard: the forehand comes off the board and the head goes up.
    nudge(a, 'mount', 0.7 * propUp - 0.3 * fall, 0, 0);
    nudge(a, 'mountHead', -0.7 * propUp, 0, 0);

    const over = (vault - fall * 0.8) * (1 - back);
    seatRider(a, 0, 1.15 * over, -1.35 * over);

    placeAt(a, s, lerp(1.9, 1.3, run), 0, 0, s.ay);

    cueAt(ctx, t, 0.1, 'horse', 0.8);
    cueAt(ctx, t, 0.42, 'horse', 0.9);
    cueAt(ctx, t, 0.52, 'vocal:berserkr', 0.95);
    cueAt(ctx, t, 0.62, 'whoosh', 0.8);
    cueAt(ctx, t, 0.72, 'impact-metal', 0.85);
    resolve(a, s, t, 1.3);
  },
};

/** He does not test the point at all: he circles until the Jarl has to turn
 *  with him, then comes in on the closing side and takes him from behind the
 *  shoulder — one axe, no second blow needed. */
const NXK_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.1, dist: 2.9 });

    const dk = phase(t, 0.66, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      // Turning, and always a beat behind the horse.
      const turn = easeInOutCubic(phase(t, 0.16, 0.6));
      victimGuard(ctx, s, 0, 0, 0, s.vy + 2.1 * turn);
      nudge(ctx.victim, 'weapon', -0.7 * smooth(phase(t, 0.1, 0.3)));
      nudge(ctx.victim, 'armR', 0.4 * smooth(phase(t, 0.1, 0.3)));
      nudge(ctx.victim, 'armL', 0.35 * smooth(phase(t, 0.1, 0.3)));
      const heavy = Math.sin(t * 7);
      nudge(ctx.victim, 'spine', 0.06 * heavy);
      const late = smooth(phase(t, 0.6, 0.7));
      nudge(ctx.victim, 'spine', 0, 0.5 * late);
      nudge(ctx.victim, 'head', 0, 0.7 * late);
    }

    // A circle at the walk, then one acceleration into the blind side.
    const circle = easeInOutCubic(phase(t, 0.14, 0.58));
    const drive = easeInCubic(phase(t, 0.58, 0.72));
    const angle = 2.3 * circle;
    blendPose(a, RIDE, SCISSOR_UP, smooth(phase(t, 0.5, 0.64)) * 0.8);
    const cut = easeInCubic(phase(t, 0.64, 0.76));
    if (cut > 0) blendPose(a, SCISSOR_UP, SCISSOR_IN, cut);
    const walk = Math.sin(t * 16);
    nudge(a, 'mount', 0.04 * walk, -0.3 * circle, 0.15 * circle);
    nudge(a, 'mountHead', 0.07 * walk, -0.4 * circle, 0);

    // Around the outside on a constant radius, then in.
    const radius = lerp(1.5, 0.6, drive);
    placeAt(
      a,
      s,
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      0,
      s.ay + angle,
    );

    cueAt(ctx, t, 0.12, 'horse', 0.5);
    cueAt(ctx, t, 0.4, 'horse', 0.45);
    cueAt(ctx, t, 0.6, 'vocal:berserkr', 0.9);
    cueAt(ctx, t, 0.66, 'whoosh', 0.7);
    cueAt(ctx, t, 0.7, 'impact-metal', 0.9);
    resolve(a, s, t, 0.6 * Math.cos(2.3), 0.6 * Math.sin(2.3));
  },
};

export const BERSERKR_ROW: DuelMatrix = {
  nxp: [NXP_A, NXP_B],
  nxn: [NXN_A, NXN_B],
  nxb: [NXB_A, NXB_B],
  nxr: [NXR_A, NXR_B],
  nxq: [NXQ_A, NXQ_B],
  nxk: [NXK_A, NXK_B],
};
