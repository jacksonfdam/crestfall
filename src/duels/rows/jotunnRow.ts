/**
 * Jötunn attacks — the rook row. The unfold IS the anticipation: every cell
 * opens as a petrified tower, and the shudder-crack-part sequence is the
 * wind-up for whatever it does next. Nothing here is fast; the giant wins by
 * mass and by being unhurried about it.
 *
 * FORM CONTRACT (see jotunn.ts): setPose cannot reseat the shell meshes or the
 * hips, so a surviving jötunn MUST pass through foldJotunn(rig, 1) before the
 * director's setPose('idle'). Every cell therefore ends its resolve with a
 * completed fold on the captured square — that is what `towerSettle` is for,
 * and it is why this row does not use the shared victorSettle.
 *
 * These duels run at 3.9s: unfold and fold are expensive, and the cap is 4.0.
 */

import type { CharacterRig, DuelMatrix, DuelScript } from '../../core/stage.ts';
import { foldJotunn, unfoldJotunn } from '../jotunn.ts';
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
  blendPose,
  camera,
  cueAt,
  nudge,
  place,
  placeAt,
  shakeAt,
  stageDuel,
  type Pose,
  type Staging,
} from './support.ts';

const smooth = (x: number): number => x * x * (3 - 2 * x);
const bump = (x: number): number => Math.sin(Math.PI * clamp01(x));

/** All cells: unfold window, action window, then the fold. */
const UNFOLD_A = 0.05;
const UNFOLD_B = 0.4;
const FOLD_A = 0.78;
const DUR_R = 3.9;

type RBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR';

// ── Pose library ────────────────────────────────────────────────────────────
//
// These are DELTAS layered on the battle stance that unfoldJotunn(rig, 1)
// leaves behind — the unfold owns the stance itself, so a table here is only
// ever blended in on top of it via `stance()`.

/** The stance the unfold ends on; the identity for every blend below. */
const STANCE: Pose<RBone> = {
  spine: [0.14, 0, 0], chest: [0.06, 0, 0], head: [-0.08, 0, 0],
  armL: [0.75, 0, 0.45], forearmL: [0.9, 0, 0.1], handL: [0.15, 0, 0],
  armR: [0.75, 0, -0.45], forearmR: [0.9, 0, -0.1], handR: [0.15, 0, 0],
  legL: [0.6, 0, 0.3], shinL: [-0.55, 0, 0],
  legR: [0.6, 0, -0.3], shinR: [-0.55, 0, 0],
};

/** One arm up and back, the whole mass loaded behind it. */
const PALM_UP: Pose<RBone> = {
  spine: [-0.12, -0.2, 0], chest: [-0.05, -0.1, 0], head: [-0.25, -0.15, 0],
  armL: [0.5, 0, 0.5], forearmL: [1.0, 0, 0.1], handL: [0.15, 0, 0],
  armR: [2.7, 0, -0.35], forearmR: [0.5, 0, -0.1], handR: [-0.3, 0, 0],
  legL: [0.5, 0, 0.32], shinL: [-0.5, 0, 0],
  legR: [0.72, 0, -0.28], shinR: [-0.65, 0, 0],
};

/** The palm through the board. */
const PALM_DOWN: Pose<RBone> = {
  spine: [0.55, 0.15, 0], chest: [0.2, 0.08, 0], head: [0.4, 0.1, 0],
  armL: [0.9, 0, 0.5], forearmL: [0.8, 0, 0.1], handL: [0.15, 0, 0],
  armR: [0.35, 0, -0.2], forearmR: [-0.1, 0, 0], handR: [0.5, 0, 0],
  legL: [0.85, 0, 0.3], shinL: [-0.8, 0, 0],
  legR: [0.35, 0, -0.3], shinR: [-0.35, 0, 0],
};

/** Both hands out to take hold of something and hold it. */
const CATCH: Pose<RBone> = {
  spine: [0.2, 0, 0], chest: [0.08, 0, 0], head: [0.1, 0, 0],
  armL: [1.5, 0, 0.15], forearmL: [0.35, 0, 0.05], handL: [-0.2, 0, 0],
  armR: [1.5, 0, -0.15], forearmR: [0.35, 0, -0.05], handR: [-0.2, 0, 0],
  legL: [0.8, 0, 0.3], shinL: [-0.75, 0, 0],
  legR: [0.45, 0, -0.3], shinR: [-0.45, 0, 0],
};

/** The shove: arms straightened, weight transferred through them. */
const SHOVE: Pose<RBone> = {
  spine: [0.4, 0, 0], chest: [0.15, 0, 0], head: [0.05, 0, 0],
  armL: [1.75, 0, 0.05], forearmL: [-0.05, 0, 0], handL: [-0.1, 0, 0],
  armR: [1.75, 0, -0.05], forearmR: [-0.05, 0, 0], handR: [-0.1, 0, 0],
  legL: [1.0, 0, 0.28], shinL: [-0.95, 0, 0],
  legR: [0.15, 0, -0.32], shinR: [-0.2, 0, 0],
};

/** Chest filled, head back: the inhale before it blows. */
const INHALE: Pose<RBone> = {
  spine: [-0.2, 0, 0], chest: [-0.15, 0, 0], head: [-0.4, 0, 0],
  armL: [0.55, 0, 0.6], forearmL: [1.1, 0, 0.1], handL: [0.15, 0, 0],
  armR: [0.55, 0, -0.6], forearmR: [1.1, 0, -0.1], handR: [0.15, 0, 0],
  legL: [0.55, 0, 0.32], shinL: [-0.5, 0, 0],
  legR: [0.55, 0, -0.32], shinR: [-0.5, 0, 0],
};

/** The blow-out, and the flick of two fingers that follows it. */
const EXHALE: Pose<RBone> = {
  spine: [0.35, 0, 0], chest: [0.22, 0, 0], head: [0.25, 0, 0],
  armL: [0.7, 0, 0.4], forearmL: [0.85, 0, 0.1], handL: [0.15, 0, 0],
  armR: [1.15, 0, -0.3], forearmR: [0.3, 0, -0.1], handR: [-0.5, 0, 0],
  legL: [0.6, 0, 0.3], shinL: [-0.55, 0, 0],
  legR: [0.6, 0, -0.3], shinR: [-0.55, 0, 0],
};

/** Both palms wide apart, about to come together. */
const CLAP_WIDE: Pose<RBone> = {
  spine: [0.05, 0, 0], chest: [0, 0, 0], head: [-0.2, 0, 0],
  armL: [1.4, 0, 1.15], forearmL: [0.3, 0, 0.2], handL: [0, 0, 0],
  armR: [1.4, 0, -1.15], forearmR: [0.3, 0, -0.2], handR: [0, 0, 0],
  legL: [0.6, 0, 0.34], shinL: [-0.55, 0, 0],
  legR: [0.6, 0, -0.34], shinR: [-0.55, 0, 0],
};

/** Shut. */
const CLAP_SHUT: Pose<RBone> = {
  spine: [0.3, 0, 0], chest: [0.14, 0, 0], head: [0.15, 0, 0],
  armL: [1.55, 0, -0.1], forearmL: [0.4, 0, -0.15], handL: [0, 0, 0],
  armR: [1.55, 0, 0.1], forearmR: [0.4, 0, 0.15], handR: [0, 0, 0],
  legL: [0.62, 0, 0.3], shinL: [-0.58, 0, 0],
  legR: [0.62, 0, -0.3], shinR: [-0.58, 0, 0],
};

/** Down to a knee to be at a man's level — the marginalia beat. */
const KNEEL: Pose<RBone> = {
  spine: [0.3, 0, 0], chest: [0.1, 0, 0], head: [0.35, 0, 0],
  armL: [0.5, 0, 0.4], forearmL: [1.2, 0, 0.1], handL: [0.15, 0, 0],
  armR: [0.6, 0, -0.35], forearmR: [1.0, 0, -0.1], handR: [0.15, 0, 0],
  legL: [1.55, 0, 0.28], shinL: [-1.5, 0, 0],
  legR: [0.15, 0, -0.3], shinR: [-1.9, 0, 0],
};

/** Two fingers, laid on. */
const TWO_FINGERS: Pose<RBone> = {
  spine: [0.42, -0.1, 0], chest: [0.16, -0.05, 0], head: [0.45, -0.08, 0],
  armL: [0.5, 0, 0.4], forearmL: [1.2, 0, 0.1], handL: [0.15, 0, 0],
  armR: [1.45, 0, -0.15], forearmR: [0.15, 0, 0], handR: [0.35, 0, 0],
  legL: [1.55, 0, 0.28], shinL: [-1.5, 0, 0],
  legR: [0.15, 0, -0.3], shinR: [-1.9, 0, 0],
};

/** A merlon torn off its own shoulder and swung as a club. */
const CLUB_UP: Pose<RBone> = {
  spine: [-0.15, 0.3, 0], chest: [-0.05, 0.12, 0], head: [-0.2, 0.2, 0],
  armL: [0.6, 0, 0.5], forearmL: [1.0, 0, 0.1], handL: [0.15, 0, 0],
  armR: [2.85, 0, -0.5], forearmR: [0.8, 0, -0.1], handR: [-0.2, 0, 0],
  legL: [0.5, 0, 0.32], shinL: [-0.48, 0, 0],
  legR: [0.75, 0, -0.28], shinR: [-0.7, 0, 0],
};

const CLUB_DOWN: Pose<RBone> = {
  spine: [0.5, -0.25, 0], chest: [0.2, -0.1, 0], head: [0.35, -0.15, 0],
  armL: [0.85, 0, 0.45], forearmL: [0.9, 0, 0.1], handL: [0.15, 0, 0],
  armR: [0.4, 0, -0.15], forearmR: [-0.05, 0, 0], handR: [0.4, 0, 0],
  legL: [0.9, 0, 0.3], shinL: [-0.85, 0, 0],
  legR: [0.3, 0, -0.32], shinR: [-0.3, 0, 0],
};

/** Forehead down against another forehead, both hands locked. */
const GRAPPLE: Pose<RBone> = {
  spine: [0.42, 0, 0], chest: [0.2, 0, 0], head: [0.5, 0, 0],
  armL: [1.5, 0, 0.35], forearmL: [0.55, 0, 0.1], handL: [-0.15, 0, 0],
  armR: [1.5, 0, -0.35], forearmR: [0.55, 0, -0.1], handR: [-0.15, 0, 0],
  legL: [0.95, 0, 0.32], shinL: [-0.9, 0, 0],
  legR: [0.3, 0, -0.32], shinR: [-0.3, 0, 0],
};

// ── Form helpers ────────────────────────────────────────────────────────────

/**
 * Hold the giant in its unfolded form and layer an action pose on top. Call
 * unfoldJotunn first — it owns the shell, the hips and the stance; this only
 * ever blends limb rotations over the top of what it left.
 */
function stance(rig: CharacterRig, to: Pose<RBone>, k: number): void {
  if (k > 0) blendPose(rig, STANCE, to, k);
}

/**
 * The victor's resolve for this row: walk the tower onto the captured square
 * while folding, landing on foldJotunn(rig, 1) — the exact rest state the
 * director's setPose('idle') expects — at t=1.
 */
function towerSettle(
  rig: CharacterRig,
  s: Staging,
  t: number,
  fromGap: number,
  fromSide: number,
): void {
  if (t < FOLD_A) return;
  const k = phase(t, FOLD_A, 1);
  const e = easeInOutCubic(k);
  foldJotunn(rig, k);
  place(
    rig,
    lerp(s.vx - s.fx * fromGap + s.rx * fromSide, s.vx, e),
    s.y,
    lerp(s.vz - s.fz * fromGap + s.rz * fromSide, s.vz, e),
    s.ay,
  );
}

// ── rxp: the worked example ─────────────────────────────────────────────────

/** The tower shudders, seams crack, limbs unfold, one hand comes down. The
 *  shield does not help. (DUELS.md worked example.) */
const RXP_A: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'rise', height: 0.85, dist: 2.9 });

    unfoldJotunn(a, phase(t, UNFOLD_A, UNFOLD_B));
    placeAt(a, s, 1.5, 0, 0, s.ay);

    const dk = phase(t, 0.62, 0.94);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // He gets the shield up. It is the right answer to the wrong problem.
      const up = smooth(phase(t, 0.38, 0.54));
      nudge(ctx.victim, 'armL', 0.7 * up, 0, -0.2 * up);
      nudge(ctx.victim, 'forearmL', -0.3 * up);
      nudge(ctx.victim, 'head', -0.3 * up);
      const crush = smooth(phase(t, 0.58, 0.66));
      nudge(ctx.victim, 'armL', -1.0 * crush, 0, 0.4 * crush);
      nudge(ctx.victim, 'shield', 0.8 * crush);
      nudge(ctx.victim, 'spine', 0.5 * crush);
    }

    // One arm up through the end of the unfold, then straight down.
    const lift = smooth(phase(t, 0.4, 0.55));
    stance(a, PALM_UP, lift);
    const down = easeInCubic(phase(t, 0.55, 0.64));
    if (down > 0) stance(a, PALM_DOWN, down);
    nudge(a, 'spine', 0.05 * bump(phase(t, 0.64, 0.74)));

    cueAt(ctx, t, 0.12, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.3, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.34, 'vocal:jotunn', 0.9);
    cueAt(ctx, t, 0.4, 'impact-stone', 0.8);
    cueAt(ctx, t, 0.6, 'impact-shield', 0.9);
    cueAt(ctx, t, 0.63, 'impact-stone', 0.95);
    shakeAt(ctx, t, 0.4, 0.22, 0.14);
    shakeAt(ctx, t, 0.62, 0.35, 0.2);
    towerSettle(a, s, t, 1.5, 0);
  },
};

/** It never lifts a hand: the huscarl is close enough that it simply stands up
 *  into him, and the unfold itself is the blow. */
const RXP_B: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 0.8, dist: 2.6, side: -1 });

    unfoldJotunn(a, phase(t, 0.1, 0.58));
    placeAt(a, s, 0.95, 0, 0, s.ay);

    const dk = phase(t, 0.56, 0.92);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.35, s.y, s.vz - s.fz * 0.35);
    } else {
      // He is already at the wall, spear against the stone, when it moves.
      const press = smooth(phase(t, 0.1, 0.3));
      victimGuard(ctx, s, lerp(0, 0.35, press));
      const probe = bump(phase(t, 0.2, 0.36));
      nudge(ctx.victim, 'armR', 0.8 * probe);
      nudge(ctx.victim, 'forearmR', -0.5 * probe);
      // The seams open under his hands and he is carried up and back.
      const lifted = smooth(phase(t, 0.4, 0.56));
      nudge(ctx.victim, 'armL', 1.2 * lifted, 0, -0.3 * lifted);
      nudge(ctx.victim, 'armR', 1.0 * lifted, 0, 0.3 * lifted);
      nudge(ctx.victim, 'spine', -0.5 * lifted);
      nudge(ctx.victim, 'head', -0.4 * lifted);
    }

    // A shrug of the shoulder plates, and nothing else.
    const shrug = bump(phase(t, 0.44, 0.62));
    stance(a, SHOVE, 0.35 * shrug);
    nudge(a, 'chest', 0.08 * shrug);

    cueAt(ctx, t, 0.14, 'impact-metal', 0.4);
    cueAt(ctx, t, 0.24, 'stone-grind', 0.9);
    cueAt(ctx, t, 0.44, 'vocal:jotunn', 0.85);
    cueAt(ctx, t, 0.5, 'stone-grind', 0.95);
    cueAt(ctx, t, 0.58, 'fall', 0.7);
    shakeAt(ctx, t, 0.5, 0.3, 0.2);
    towerSettle(a, s, t, 0.95, 0);
  },
};

// ── rxn: into the charge ────────────────────────────────────────────────────

/** It stands into the charge, catches the rearing forehooves in one hand and
 *  shoves; horse and rider roll away, and the horse bolts. */
const RXN_A: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.0, dist: 3.1 });

    unfoldJotunn(a, phase(t, UNFOLD_A, UNFOLD_B));
    placeAt(a, s, 1.35, 0, 0, s.ay);

    const dk = phase(t, 0.6, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.3, s.y, s.vz - s.fz * 0.3);
    } else {
      // The charge arrives exactly as the tower finishes becoming a giant.
      const run = easeInCubic(phase(t, 0.14, 0.48));
      victimGuard(ctx, s, lerp(-2.0, 0.3, run));
      const gallop = Math.sin(t * 45);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      const rear = smooth(phase(t, 0.46, 0.58));
      nudge(ctx.victim, 'mount', 0.9 * rear);
      nudge(ctx.victim, 'mountHead', -0.5 * rear);
      nudge(ctx.victim, 'spine', -0.35 * rear);
    }

    // Catch, and shove. No swing at any point.
    const open = smooth(phase(t, 0.4, 0.52));
    stance(a, CATCH, open);
    const shove = easeOutCubic(phase(t, 0.54, 0.66));
    if (shove > 0) stance(a, SHOVE, shove);

    cueAt(ctx, t, 0.12, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.2, 'horse', 0.7);
    cueAt(ctx, t, 0.46, 'horse', 0.9);
    cueAt(ctx, t, 0.5, 'impact-stone', 0.7);
    cueAt(ctx, t, 0.56, 'vocal:jotunn', 0.9);
    shakeAt(ctx, t, 0.56, 0.28, 0.16);
    towerSettle(a, s, t, 1.35, 0);
  },
};

/** The charge goes past it — so it takes a merlon off its own shoulder and
 *  throws the horse's line, then clubs the rider down as he comes back. */
const RXN_B: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.05, dist: 3.2, side: -1 });

    unfoldJotunn(a, phase(t, UNFOLD_A, UNFOLD_B));
    placeAt(a, s, 1.4, 0, 0, s.ay + 0.5 * smooth(phase(t, 0.5, 0.7)));

    const dk = phase(t, 0.68, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx + s.rx * 0.5, s.y, s.vz + s.rz * 0.5);
    } else {
      // Past on the first pass, and turning back into the club on the second.
      const p1 = easeInOutCubic(phase(t, 0.12, 0.46));
      const p2 = easeInOutCubic(phase(t, 0.5, 0.72));
      victimGuard(
        ctx,
        s,
        lerp(-2.0, 0.9, p1) * (1 - p2) + lerp(0.9, 0.1, p2) * p2,
        lerp(0, 1.4, p1) * (1 - p2) + lerp(1.4, 0.5, p2) * p2,
        0,
        s.vy - 0.8 * p1 + 1.4 * p2,
      );
      const gallop = Math.sin(t * 44);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      const cut = bump(phase(t, 0.3, 0.44));
      nudge(ctx.victim, 'armR', 1.3 * cut);
    }

    // Tear the merlon loose, then one heavy swing on the return pass.
    const tear = smooth(phase(t, 0.42, 0.58));
    stance(a, CLUB_UP, tear);
    const club = easeInCubic(phase(t, 0.6, 0.72));
    if (club > 0) stance(a, CLUB_DOWN, club);

    cueAt(ctx, t, 0.12, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.24, 'horse', 0.75);
    cueAt(ctx, t, 0.46, 'stone-grind', 0.9);
    cueAt(ctx, t, 0.6, 'vocal:jotunn', 0.9);
    cueAt(ctx, t, 0.68, 'impact-stone', 0.95);
    shakeAt(ctx, t, 0.68, 0.32, 0.18);
    towerSettle(a, s, t, 1.4, 0);
  },
};

// ── rxb: the candles ────────────────────────────────────────────────────────

/** Runes burst as dust against its chest; it inhales and blows the rune-light
 *  out like candles, then flicks the staff from her hands. */
const RXB_A: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.0, dist: 2.9 });

    unfoldJotunn(a, phase(t, UNFOLD_A, UNFOLD_B));
    placeAt(a, s, 1.45, 0, 0, s.ay);

    const dk = phase(t, 0.7, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Three casts that do nothing at all, and then no staff.
      const c1 = bump(phase(t, 0.22, 0.32));
      const c2 = bump(phase(t, 0.34, 0.44));
      const c3 = bump(phase(t, 0.46, 0.56));
      const cast = c1 + c2 + c3;
      nudge(ctx.victim, 'armR', 0.75 * cast, 0, -0.3 * cast);
      nudge(ctx.victim, 'staff', -0.5 * cast);
      nudge(ctx.victim, 'armL', 0.5 * cast, 0, 0.3 * cast);
      const flick = smooth(phase(t, 0.62, 0.7));
      nudge(ctx.victim, 'armR', -1.2 * flick, 0, 0.7 * flick);
      nudge(ctx.victim, 'staff', 1.4 * flick, 0.5 * flick, 0.6 * flick);
      nudge(ctx.victim, 'spine', 0.2 * flick, 0.4 * flick);
    }

    // It fills its chest while she is still casting, and then puts them out.
    const fill = smooth(phase(t, 0.44, 0.58));
    stance(a, INHALE, fill);
    const blow = easeOutCubic(phase(t, 0.58, 0.68));
    if (blow > 0) stance(a, EXHALE, blow);
    // The flick is a single finger's worth of effort.
    nudge(a, 'handR', -0.5 * bump(phase(t, 0.62, 0.72)));

    cueAt(ctx, t, 0.12, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.24, 'rune', 0.6);
    cueAt(ctx, t, 0.36, 'rune', 0.6);
    cueAt(ctx, t, 0.48, 'rune', 0.6);
    cueAt(ctx, t, 0.58, 'vocal:jotunn', 0.95);
    cueAt(ctx, t, 0.64, 'impact-metal', 0.7);
    towerSettle(a, s, t, 1.45, 0);
  },
};

/** Her fetter actually holds it — for a moment. It breaks the bands by
 *  standing up through them, and takes the staff with it. */
const RXB_B: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'rise', height: 0.9, dist: 2.8, side: -1 });

    // The unfold stalls against the fetter, then finishes through it.
    const u = phase(t, 0.08, 0.44);
    const held = smooth(phase(t, 0.3, 0.42)) * (1 - smooth(phase(t, 0.52, 0.62)));
    unfoldJotunn(a, Math.min(u, lerp(1, 0.55, held)));
    placeAt(a, s, 1.45, 0, 0, s.ay);

    const dk = phase(t, 0.68, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Both hands on the bands, and then nothing left to hold them with.
      const bind = smooth(phase(t, 0.2, 0.36));
      nudge(ctx.victim, 'armR', 1.3 * bind, 0, -0.4 * bind);
      nudge(ctx.victim, 'armL', 1.3 * bind, 0, 0.4 * bind);
      nudge(ctx.victim, 'staff', -0.6 * bind);
      const strain = bump(phase(t, 0.4, 0.56));
      nudge(ctx.victim, 'spine', -0.2 * strain);
      nudge(ctx.victim, 'forearmL', -0.3 * strain);
      const snapped = smooth(phase(t, 0.58, 0.68));
      nudge(ctx.victim, 'armR', -1.5 * snapped, 0, 0.6 * snapped);
      nudge(ctx.victim, 'armL', -1.4 * snapped, 0, -0.5 * snapped);
      nudge(ctx.victim, 'spine', 0.4 * snapped);
      nudge(ctx.victim, 'head', 0.3 * snapped);
    }

    // Straining against the bands, then through them.
    const strain = bump(phase(t, 0.36, 0.56));
    stance(a, SHOVE, 0.4 * strain);
    nudge(a, 'spine', -0.12 * strain);
    const through = easeOutCubic(phase(t, 0.56, 0.7));
    stance(a, CATCH, through);
    const take = smooth(phase(t, 0.66, 0.76));
    if (take > 0) stance(a, EXHALE, take * 0.7);

    cueAt(ctx, t, 0.16, 'rune', 0.8);
    cueAt(ctx, t, 0.32, 'stone-grind', 0.7);
    cueAt(ctx, t, 0.44, 'vocal:jotunn', 0.9);
    cueAt(ctx, t, 0.58, 'stone-grind', 0.95);
    cueAt(ctx, t, 0.64, 'impact-metal', 0.75);
    shakeAt(ctx, t, 0.58, 0.3, 0.18);
    towerSettle(a, s, t, 1.45, 0);
  },
};

// ── rxr: tower against tower ────────────────────────────────────────────────

/** Two towers unfold facing; a colossal grapple, forehead on forehead; the
 *  attacker tears a merlon from its own shoulder and clubs. */
const RXR_A: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'orbit', height: 1.25, dist: 3.4 });

    unfoldJotunn(a, phase(t, UNFOLD_A, 0.36));
    placeAt(a, s, 1.15, 0, 0, s.ay);

    const dk = phase(t, 0.72, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      // It unfolds to meet him, and they lock.
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      unfoldJotunn(v, phase(t, 0.07, 0.38));
      const lock = smooth(phase(t, 0.4, 0.54));
      nudge(v, 'armL', 0.7 * lock, 0, -0.25 * lock);
      nudge(v, 'armR', 0.7 * lock, 0, 0.25 * lock);
      nudge(v, 'spine', 0.25 * lock);
      nudge(v, 'head', 0.3 * lock);
      // Grinding, and then it is holding nothing and the merlon arrives.
      const grind = Math.sin(t * 12);
      nudge(v, 'spine', 0.05 * grind * smooth(phase(t, 0.44, 0.66)));
      const struck = smooth(phase(t, 0.66, 0.74));
      nudge(v, 'spine', 0.4 * struck, 0.3 * struck);
      nudge(v, 'head', 0.5 * struck, 0.4 * struck);
      nudge(v, 'armL', -0.6 * struck);
    }

    // Lock up, grind, break one hand free, tear the merlon, swing.
    const lock = smooth(phase(t, 0.38, 0.52));
    stance(a, GRAPPLE, lock);
    const grind = Math.sin(t * 12 + 1.7);
    nudge(a, 'spine', 0.05 * grind * smooth(phase(t, 0.44, 0.64)));
    const tear = smooth(phase(t, 0.58, 0.68));
    if (tear > 0) stance(a, CLUB_UP, tear);
    const club = easeInCubic(phase(t, 0.68, 0.76));
    if (club > 0) stance(a, CLUB_DOWN, club);

    cueAt(ctx, t, 0.12, 'stone-grind', 0.9);
    cueAt(ctx, t, 0.4, 'impact-stone', 0.9);
    cueAt(ctx, t, 0.48, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.6, 'vocal:jotunn', 0.95);
    cueAt(ctx, t, 0.72, 'impact-stone', 1.0);
    shakeAt(ctx, t, 0.4, 0.3, 0.16);
    shakeAt(ctx, t, 0.72, 0.35, 0.2);
    towerSettle(a, s, t, 1.15, 0);
  },
};

/** The other tower never opens: the attacker gets both hands into its seams
 *  while it is still stone and prises it apart. */
const RXR_B: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'push', height: 1.1, dist: 3.0, side: -1 });

    unfoldJotunn(a, phase(t, 0.04, 0.34));
    placeAt(a, s, 1.1, 0, 0, s.ay);

    const dk = phase(t, 0.62, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      // Caught shut: it barely gets its seams open before they are opened for
      // it. The crumble takes it the rest of the way.
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      unfoldJotunn(v, Math.min(phase(t, 0.3, 0.62), 0.3));
    }

    // Both hands into the seams, and then apart.
    const grip = smooth(phase(t, 0.36, 0.5));
    stance(a, CATCH, grip);
    const prise = easeInCubic(phase(t, 0.5, 0.62));
    if (prise > 0) stance(a, CLAP_WIDE, prise);
    nudge(a, 'spine', -0.15 * bump(phase(t, 0.5, 0.64)));

    cueAt(ctx, t, 0.1, 'stone-grind', 0.9);
    cueAt(ctx, t, 0.38, 'impact-stone', 0.8);
    cueAt(ctx, t, 0.5, 'vocal:jotunn', 0.95);
    cueAt(ctx, t, 0.56, 'stone-grind', 1.0);
    shakeAt(ctx, t, 0.56, 0.34, 0.2);
    towerSettle(a, s, t, 1.1, 0);
  },
};

// ── rxq: the thunderclap ────────────────────────────────────────────────────

/** She strafes once, spear sparking off stone; it claps both hands — a
 *  thunderclap — and she tumbles from the air, wings folding. */
const RXQ_A: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'rise', height: 1.0, dist: 3.2 });

    unfoldJotunn(a, phase(t, UNFOLD_A, UNFOLD_B));
    placeAt(a, s, 1.4, 0, 0, s.ay);

    const dk = phase(t, 0.64, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx + s.rx * 0.8, s.y + 1.2, s.vz + s.rz * 0.8);
    } else {
      // One pass across it, sparks and nothing else, and then the air is gone.
      const pass = easeInOutCubic(phase(t, 0.16, 0.58));
      victimGuard(
        ctx,
        s,
        lerp(-0.8, 0.6, pass),
        lerp(-2.0, 1.6, pass),
        1.3 + 0.15 * Math.sin(t * 14),
        s.vy + 1.4 - 2.6 * pass,
      );
      const beat = Math.sin(t * 26);
      nudge(ctx.victim, 'wingL', 0, 0, 0.5 * beat);
      nudge(ctx.victim, 'wingR', 0, 0, -0.5 * beat);
      const strike = bump(phase(t, 0.3, 0.44));
      nudge(ctx.victim, 'armR', 1.1 * strike, 0, -0.3 * strike);
      nudge(ctx.victim, 'spine', 0.2 * strike);
      // Caught between the palms.
      const clap = smooth(phase(t, 0.58, 0.64));
      nudge(ctx.victim, 'wingL', 0, 0, -1.2 * clap);
      nudge(ctx.victim, 'wingR', 0, 0, 1.2 * clap);
      nudge(ctx.victim, 'spine', 0.5 * clap);
    }

    // Arms wide while she is still committing to the pass, then shut.
    const wide = smooth(phase(t, 0.42, 0.56));
    stance(a, CLAP_WIDE, wide);
    const shut = easeInCubic(phase(t, 0.56, 0.62));
    if (shut > 0) stance(a, CLAP_SHUT, shut);
    nudge(a, 'chest', 0.1 * bump(phase(t, 0.62, 0.76)));

    cueAt(ctx, t, 0.12, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.2, 'wing', 0.8);
    cueAt(ctx, t, 0.34, 'impact-metal', 0.6);
    cueAt(ctx, t, 0.5, 'vocal:jotunn', 0.9);
    cueAt(ctx, t, 0.58, 'impact-stone', 1.0);
    shakeAt(ctx, t, 0.58, 0.35, 0.22);
    towerSettle(a, s, t, 1.4, 0);
  },
};

/** She goes for the head and it lets her arrive — then closes one hand on her
 *  and sets her down on the board almost gently. */
const RXQ_B: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.15, dist: 3.0, side: -1 });

    unfoldJotunn(a, phase(t, UNFOLD_A, UNFOLD_B));
    placeAt(a, s, 1.3, 0, 0, s.ay);

    const dk = phase(t, 0.66, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y + 0.5, s.vz);
    } else {
      // Straight in at the head, into the hand that is waiting for her.
      const climb = easeOutCubic(phase(t, 0.14, 0.38));
      const dive = easeInCubic(phase(t, 0.38, 0.56));
      const held = smooth(phase(t, 0.56, 0.66));
      victimGuard(
        ctx,
        s,
        lerp(-1.0, 0.15, dive),
        0,
        lerp(0, 1.75, climb) - 0.3 * dive - 0.85 * held,
      );
      const beat = Math.sin(t * 27);
      nudge(ctx.victim, 'wingL', 0, 0, 0.5 * beat * (1 - held) - 0.9 * held);
      nudge(ctx.victim, 'wingR', 0, 0, -0.5 * beat * (1 - held) + 0.9 * held);
      nudge(ctx.victim, 'armR', 1.2 * dive - 1.0 * held);
      nudge(ctx.victim, 'spine', 0.3 * dive + 0.3 * held);
    }

    // One hand up, closed, and lowered.
    const reach = smooth(phase(t, 0.44, 0.56));
    stance(a, CATCH, reach);
    const close = smooth(phase(t, 0.56, 0.64));
    if (close > 0) stance(a, CLAP_SHUT, close * 0.6);
    const setDown = easeInOutCubic(phase(t, 0.64, 0.76));
    if (setDown > 0) stance(a, PALM_DOWN, setDown * 0.55);

    cueAt(ctx, t, 0.12, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.18, 'wing', 0.8);
    cueAt(ctx, t, 0.46, 'wing', 0.7);
    cueAt(ctx, t, 0.58, 'impact-flesh', 0.6);
    cueAt(ctx, t, 0.62, 'vocal:jotunn', 0.85);
    towerSettle(a, s, t, 1.3, 0);
  },
};

// ── rxk: the marginalia ─────────────────────────────────────────────────────

/** One great human blow chips its shin; the giant kneels down to his level,
 *  regards him, and lays him down with two fingers. Marginalia-dry. */
const RXK_A: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 0.9, dist: 2.7 });

    unfoldJotunn(a, phase(t, UNFOLD_A, UNFOLD_B));
    placeAt(a, s, 1.3, 0, 0, s.ay);

    const dk = phase(t, 0.74, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // The best blow he has, and it is worth a chip of stone.
      const w = phase(t, 0.34, 0.44);
      const cut = easeInCubic(phase(t, 0.44, 0.52));
      nudge(ctx.victim, 'armR', -1.6 * w + 2.7 * cut);
      nudge(ctx.victim, 'armL', -1.4 * w + 2.4 * cut);
      nudge(ctx.victim, 'weapon', -0.6 * cut);
      nudge(ctx.victim, 'spine', -0.25 * w + 0.5 * cut);
      // It comes down to look at him. He does not swing again.
      const regarded = smooth(phase(t, 0.6, 0.72));
      nudge(ctx.victim, 'armR', -0.5 * regarded);
      nudge(ctx.victim, 'armL', -0.4 * regarded);
      nudge(ctx.victim, 'head', -0.35 * regarded);
      nudge(ctx.victim, 'spine', -0.1 * regarded);
    }

    // It kneels — unhurried — looks at him, and reaches out.
    const kneel = easeInOutCubic(phase(t, 0.52, 0.68));
    stance(a, KNEEL, kneel);
    // The pause is the joke: nothing moves for a beat.
    const finger = smooth(phase(t, 0.72, 0.82));
    if (finger > 0) stance(a, TWO_FINGERS, finger);

    cueAt(ctx, t, 0.12, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.46, 'impact-stone', 0.7);
    cueAt(ctx, t, 0.54, 'stone-grind', 0.6);
    cueAt(ctx, t, 0.7, 'vocal:jotunn', 0.7);
    cueAt(ctx, t, 0.76, 'impact-flesh', 0.4);
    shakeAt(ctx, t, 0.46, 0.18, 0.12);
    towerSettle(a, s, t, 1.3, 0);
  },
};

/** He does not swing at all — he plants the greatsword and waits for it, which
 *  is the correct decision and does not help. It picks the sword up, considers
 *  it, and puts it down out of reach. */
const RXK_B: DuelScript = {
  duration: DUR_R,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 0.95, dist: 2.8, side: -1 });

    unfoldJotunn(a, phase(t, UNFOLD_A, UNFOLD_B));
    placeAt(a, s, 1.25, 0, 0, s.ay);

    const dk = phase(t, 0.72, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Point set, both hands, waiting. Then no sword.
      const set = smooth(phase(t, 0.2, 0.4));
      nudge(ctx.victim, 'armR', 0.5 * set, 0, 0.25 * set);
      nudge(ctx.victim, 'armL', 0.45 * set, 0, -0.25 * set);
      nudge(ctx.victim, 'weapon', -0.8 * set);
      nudge(ctx.victim, 'spine', 0.22 * set);
      const taken = smooth(phase(t, 0.52, 0.64));
      nudge(ctx.victim, 'armR', 1.6 * taken, 0, -0.4 * taken);
      nudge(ctx.victim, 'armL', 1.4 * taken, 0, 0.4 * taken);
      nudge(ctx.victim, 'weapon', 1.2 * taken, 0.5 * taken, 0);
      // Empty hands, and a long look at them.
      const empty = smooth(phase(t, 0.64, 0.74));
      nudge(ctx.victim, 'armR', -1.4 * empty);
      nudge(ctx.victim, 'armL', -1.2 * empty);
      nudge(ctx.victim, 'head', 0.3 * empty);
    }

    // Two fingers on the blade, lift, look, set aside.
    const pinch = smooth(phase(t, 0.44, 0.56));
    stance(a, CATCH, pinch * 0.7);
    const lift = easeOutCubic(phase(t, 0.54, 0.66));
    if (lift > 0) stance(a, CLUB_UP, lift * 0.55);
    const aside = easeInOutCubic(phase(t, 0.66, 0.78));
    if (aside > 0) stance(a, EXHALE, aside * 0.6);

    cueAt(ctx, t, 0.12, 'stone-grind', 0.85);
    cueAt(ctx, t, 0.5, 'impact-metal', 0.6);
    cueAt(ctx, t, 0.6, 'vocal:jotunn', 0.75);
    cueAt(ctx, t, 0.7, 'impact-metal', 0.35);
    cueAt(ctx, t, 0.76, 'impact-flesh', 0.4);
    towerSettle(a, s, t, 1.25, 0);
  },
};

export const JOTUNN_ROW: DuelMatrix = {
  rxp: [RXP_A, RXP_B],
  rxn: [RXN_A, RXN_B],
  rxb: [RXB_A, RXB_B],
  rxr: [RXR_A, RXR_B],
  rxq: [RXQ_A, RXQ_B],
  rxk: [RXK_A, RXK_B],
};
