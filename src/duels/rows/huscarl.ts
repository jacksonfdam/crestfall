/**
 * Huscarl attacks — the pawn row. Workmanlike spear and shield: he wins by
 * leverage and patience, never flourish. The shield is a weapon here as much
 * as the spear, and every cell is fought at spear length.
 *
 * The victim's collapse and vocal come from defeatVictim (see defeat.ts); a
 * cell owns the attack, the victim's beats before the reading, and the camera.
 */

import type { DuelMatrix, DuelScript } from '../../core/stage.ts';
import { unfoldJotunn } from '../jotunn.ts';
import {
  anticipate,
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

type HBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'legL' | 'legR' | 'shinL' | 'shinR'
  | 'weapon' | 'shield';

// ── Pose library ────────────────────────────────────────────────────────────

/** Shield forward-left, spear overhand: the rank-of-eight silhouette. */
const READY: Pose<HBone> = {
  spine: [0.14, 0.1, 0], chest: [0.02, 0, 0], head: [-0.08, -0.05, 0],
  armL: [0.9, 0, 0.08], forearmL: [0.55, 0, 0], shield: [0, 0, 0],
  armR: [0.5, 0, -0.18], forearmR: [0.9, 0, 0], weapon: [-0.3, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.18, 0, 0.06], shinL: [-0.25, 0, 0],
  legR: [-0.14, 0, -0.06], shinR: [-0.18, 0, 0],
};

/** Point pushed out over the rim, weight forward but feet still. */
const PROBE: Pose<HBone> = {
  spine: [0.24, -0.08, 0], chest: [0.05, 0, 0], head: [-0.02, -0.08, 0],
  armL: [0.95, 0, 0.05], forearmL: [0.5, 0, 0], shield: [0, 0, -0.05],
  armR: [1.2, 0, -0.12], forearmR: [0.2, 0, 0], weapon: [-1.25, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.3, 0, 0.06], shinL: [-0.35, 0, 0],
  legR: [-0.2, 0, -0.06], shinR: [-0.22, 0, 0],
};

/** Spear inverted, butt raised to come down behind a shield rim. */
const HOOK_UP: Pose<HBone> = {
  spine: [0.1, 0.12, 0], chest: [0, 0.04, 0], head: [-0.15, -0.1, 0],
  armL: [0.92, 0, 0.06], forearmL: [0.52, 0, 0], shield: [0, 0, 0],
  armR: [1.9, 0, -0.25], forearmR: [0.5, 0, 0], weapon: [0.9, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.22, 0, 0.06], shinL: [-0.3, 0, 0],
  legR: [-0.16, 0, -0.06], shinR: [-0.2, 0, 0],
};

/** The butt drives down and he leans his weight onto the lever. */
const HOOK_DOWN: Pose<HBone> = {
  spine: [0.34, 0.05, 0], chest: [0.12, 0, 0], head: [0.15, -0.05, 0],
  armL: [0.8, 0, 0.12], forearmL: [0.6, 0, 0], shield: [0, 0, 0.08],
  armR: [1.05, 0, -0.3], forearmR: [0.15, 0, 0], weapon: [1.5, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.4, 0, 0.08], shinL: [-0.5, 0, 0],
  legR: [-0.26, 0, -0.08], shinR: [-0.3, 0, 0],
};

/** Coiled: spear drawn back level beside the head, eyes on the gap. */
const WIND: Pose<HBone> = {
  spine: [-0.14, 0.3, 0], chest: [-0.05, 0.12, 0], head: [-0.05, -0.15, 0],
  armL: [1.0, 0, 0.15], forearmL: [0.45, 0, 0], shield: [0, 0, 0],
  armR: [0.35, 0, -0.55], forearmR: [1.75, 0, 0], weapon: [-1.55, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.1, 0, 0.06], shinL: [-0.2, 0, 0],
  legR: [-0.28, 0, -0.06], shinR: [-0.3, 0, 0],
};

/** Full extension, hips and shoulder behind the point. */
const THRUST: Pose<HBone> = {
  spine: [0.34, -0.18, 0], chest: [0.1, -0.06, 0], head: [0.08, -0.12, 0],
  armL: [0.7, 0, 0.3], forearmL: [0.7, 0, 0], shield: [0, 0, 0.1],
  armR: [1.3, 0, -0.12], forearmR: [0.02, 0, 0], weapon: [-1.52, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.42, 0, 0.08], shinL: [-0.5, 0, 0],
  legR: [-0.3, 0, -0.08], shinR: [-0.15, 0, 0],
};

/** Underhand: the point comes up from below the rim. */
const THRUST_LOW: Pose<HBone> = {
  spine: [0.4, -0.14, 0], chest: [0.14, -0.05, 0], head: [0.05, -0.1, 0],
  armL: [0.6, 0, 0.35], forearmL: [0.85, 0, 0], shield: [0.2, 0, 0.15],
  armR: [0.55, 0, -0.15], forearmR: [-0.2, 0, 0], weapon: [-1.9, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.5, 0, 0.1], shinL: [-0.6, 0, 0],
  legR: [-0.34, 0, -0.1], shinR: [-0.2, 0, 0],
};

/** Shield driven forward off the front foot; spear withdrawn out of the way. */
const BASH: Pose<HBone> = {
  spine: [0.3, -0.22, 0], chest: [0.08, -0.08, 0], head: [0.05, -0.1, 0],
  armL: [1.5, 0, -0.12], forearmL: [0.12, 0, 0], shield: [0, 0, 0],
  armR: [0.35, 0, -0.5], forearmR: [1.4, 0, 0], weapon: [-0.85, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.45, 0, 0.08], shinL: [-0.55, 0, 0],
  legR: [-0.32, 0, -0.08], shinR: [-0.2, 0, 0],
};

/** Butt planted in the board, point up-forward at a horse's chest. */
const BRACE: Pose<HBone> = {
  spine: [0.26, 0.05, 0], chest: [0.06, 0, 0], head: [-0.16, -0.05, 0],
  armL: [0.65, 0, 0.3], forearmL: [1.05, 0, 0], shield: [0, 0, 0.18],
  armR: [0.2, 0, -0.22], forearmR: [0.5, 0, 0], weapon: [-0.62, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.42, 0, 0.14], shinL: [-0.5, 0, 0],
  legR: [-0.38, 0, -0.14], shinR: [-0.3, 0, 0],
};

/** Ducked under a swing, shield over the head. Pair with a hip drop. */
const DUCK: Pose<HBone> = {
  spine: [0.5, 0.15, 0], chest: [0.2, 0, 0], head: [0.3, -0.1, 0],
  armL: [1.2, 0, 0.2], forearmL: [0.9, 0, 0], shield: [0.35, 0, 0],
  armR: [0.5, 0, -0.4], forearmR: [1.1, 0, 0], weapon: [-1.0, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.7, 0, 0.1], shinL: [-0.9, 0, 0],
  legR: [0.5, 0, -0.1], shinR: [-0.8, 0, 0],
};

/** Haft swept low across the shins. Pair with a hip drop. */
const SWEEP: Pose<HBone> = {
  spine: [0.45, -0.3, 0], chest: [0.15, -0.1, 0], head: [0.25, -0.2, 0],
  armL: [0.5, 0, 0.5], forearmL: [1.2, 0, 0], shield: [0.3, 0, 0.3],
  armR: [0.9, 0, -0.7], forearmR: [0.6, 0, 0], weapon: [1.2, 0, 0.6],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.6, 0, 0.12], shinL: [-0.7, 0, 0],
  legR: [-0.2, 0, -0.12], shinR: [-0.5, 0, 0],
};

/** Curled tight for a roll. Pair with a root lift and pitch. */
const TUCK: Pose<HBone> = {
  spine: [0.9, 0, 0], chest: [0.35, 0, 0], head: [0.5, 0, 0],
  armL: [1.6, 0, 0.5], forearmL: [1.8, 0, 0], shield: [0.6, 0, 0.4],
  armR: [1.4, 0, -0.5], forearmR: [1.9, 0, 0], weapon: [0.9, 0, 0.5],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [1.7, 0, 0.15], shinL: [-1.9, 0, 0],
  legR: [1.5, 0, -0.15], shinR: [-1.7, 0, 0],
};

/** Shield edge pressed down on something, thrusting one-handed past it. */
const PIN: Pose<HBone> = {
  spine: [0.55, -0.15, 0], chest: [0.2, 0, 0], head: [0.35, -0.1, 0],
  armL: [1.25, 0, -0.25], forearmL: [0.5, 0, 0], shield: [1.15, 0, 0],
  armR: [1.15, 0, -0.2], forearmR: [0.1, 0, 0], weapon: [-1.5, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.5, 0, 0.1], shinL: [-0.6, 0, 0],
  legR: [-0.3, 0, -0.1], shinR: [-0.25, 0, 0],
};

/** Spear held level at a throat — no swing, nothing to parry. */
const LEVEL: Pose<HBone> = {
  spine: [0.16, -0.12, 0], chest: [0.04, -0.04, 0], head: [0, -0.1, 0],
  armL: [0.55, 0, 0.4], forearmL: [0.8, 0, 0], shield: [0, 0, 0.12],
  armR: [1.05, 0, -0.14], forearmR: [0.25, 0, 0], weapon: [-1.5, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0.24, 0, 0.07], shinL: [-0.3, 0, 0],
  legR: [-0.18, 0, -0.07], shinR: [-0.22, 0, 0],
};

// ── pxp: shield wall ────────────────────────────────────────────────────────

/** Spears probe over the rims until one man makes a lever of his. */
const PXP_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 0.95 });

    const dk = phase(t, 0.66, 0.94);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // He probes back twice, then his rim is dragged down and he is open.
      const jab = bump(phase(t, 0.2, 0.34)) + bump(phase(t, 0.36, 0.46));
      nudge(ctx.victim, 'armR', 0.55 * jab);
      nudge(ctx.victim, 'forearmR', -0.5 * jab);
      const drag = smooth(phase(t, 0.44, 0.6));
      nudge(ctx.victim, 'armL', -0.75 * drag, 0, 0.5 * drag);
      nudge(ctx.victim, 'forearmL', 0.6 * drag);
      nudge(ctx.victim, 'shield', 0.8 * drag);
      nudge(ctx.victim, 'spine', -0.2 * drag, 0.18 * drag);
    }

    // Two probes of his own, close, then the hook and the thrust over the top.
    const close = smooth(phase(t, 0.12, 0.3));
    const probe = bump(phase(t, 0.16, 0.3)) + bump(phase(t, 0.3, 0.42));
    blendPose(a, READY, PROBE, clamp01(probe));
    const hook = smooth(phase(t, 0.4, 0.5));
    if (hook > 0) blendPose(a, PROBE, HOOK_UP, hook);
    const pull = easeInCubic(phase(t, 0.48, 0.6));
    if (pull > 0) blendPose(a, HOOK_UP, HOOK_DOWN, pull);
    const wind = smooth(phase(t, 0.58, 0.66));
    if (wind > 0) blendPose(a, HOOK_DOWN, WIND, wind);
    const drive = easeOutCubic(phase(t, 0.66, 0.76));
    if (drive > 0) blendPose(a, WIND, THRUST, drive);

    placeAt(a, s, lerp(1.6, 0.92, close) - 0.14 * drive, 0, 0, s.ay);

    cueAt(ctx, t, 0.22, 'impact-shield', 0.4);
    cueAt(ctx, t, 0.5, 'impact-shield', 0.7);
    cueAt(ctx, t, 0.66, 'whoosh', 0.6);
    cueAt(ctx, t, 0.72, 'impact-flesh', 0.8);
    cueAt(ctx, t, 0.24, 'vocal:huscarl', 0.5);
    resolve(a, s, t, 0.78);
  },
};

/** His first thrust is caught dead on the rim; he batters it aside instead. */
const PXP_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.0 });

    const dk = phase(t, 0.68, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // He catches the first thrust cleanly — and pays for the shield he
      // committed to the catch.
      const catchIt = bump(phase(t, 0.26, 0.42));
      nudge(ctx.victim, 'armL', 0.5 * catchIt, 0, -0.3 * catchIt);
      nudge(ctx.victim, 'shield', -0.25 * catchIt);
      nudge(ctx.victim, 'spine', -0.16 * catchIt);
      const beaten = smooth(phase(t, 0.5, 0.66));
      nudge(ctx.victim, 'armL', -0.9 * beaten, 0, 0.75 * beaten);
      nudge(ctx.victim, 'forearmL', 0.5 * beaten);
      nudge(ctx.victim, 'head', 0.2 * beaten, 0.3 * beaten);
    }

    const close = smooth(phase(t, 0.1, 0.26));
    // A committed thrust that goes nowhere.
    const wind1 = smooth(phase(t, 0.14, 0.24));
    blendPose(a, READY, WIND, wind1);
    const stab1 = easeOutCubic(phase(t, 0.24, 0.32));
    if (stab1 > 0) blendPose(a, WIND, THRUST, stab1);
    // Stopped: the recoil runs back up the shaft into his shoulder.
    const stopped = smooth(phase(t, 0.32, 0.44));
    if (stopped > 0) blendPose(a, THRUST, READY, stopped);
    nudge(a, 'forearmR', 0.28 * bump(phase(t, 0.3, 0.44)));
    // So he uses the shield instead, and finishes underneath the rim.
    const bash = anticipate(phase(t, 0.46, 0.62));
    if (phase(t, 0.46, 0.62) > 0) blendPose(a, READY, BASH, clamp01(bash));
    const low = easeOutCubic(phase(t, 0.66, 0.78));
    if (low > 0) blendPose(a, BASH, THRUST_LOW, low);

    placeAt(a, s, lerp(1.6, 0.9, close) - 0.1 * stab1 - 0.12 * low, 0, 0, s.ay);

    cueAt(ctx, t, 0.28, 'impact-shield', 0.75);
    cueAt(ctx, t, 0.56, 'impact-shield', 0.8);
    cueAt(ctx, t, 0.5, 'vocal:huscarl', 0.6);
    cueAt(ctx, t, 0.72, 'impact-flesh', 0.75);
    resolve(a, s, t, 0.76);
  },
};

// ── pxn: against the charge ─────────────────────────────────────────────────

/** Butt in the board, point at the chest: the horse rears off it. */
const PXN_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.0 });

    const dk = phase(t, 0.5, 0.92);
    if (dk > 0) {
      // The rear happens inside the reading; it starts from the point.
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      // The charge: in from beyond the square at speed.
      const run = easeInCubic(phase(t, 0.1, 0.5));
      victimGuard(ctx, s, lerp(-2.2, 0, run));
      const gallop = Math.sin(t * 46);
      mountLegs(ctx.victim, t * 46, 0.5);
      nudge(ctx.victim, 'mount', 0.06 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop, 0, 0);
      nudge(ctx.victim, 'armR', 0.4 * smooth(phase(t, 0.3, 0.5)));
    }

    // He sets himself early and does not move again until it is over.
    const set = smooth(phase(t, 0.08, 0.3));
    blendPose(a, READY, BRACE, set);
    // The shock of the impact runs down the shaft into the board.
    const shock = bump(phase(t, 0.48, 0.62));
    nudge(a, 'forearmR', 0.3 * shock);
    nudge(a, 'spine', 0.22 * shock);
    nudge(a, 'armL', 0.2 * shock);
    // One finishing thrust once the rider is down.
    const wind = smooth(phase(t, 0.62, 0.7));
    if (wind > 0) blendPose(a, BRACE, WIND, wind);
    const stab = easeOutCubic(phase(t, 0.7, 0.79));
    if (stab > 0) blendPose(a, WIND, THRUST, stab);

    placeAt(a, s, 1.15 - 0.06 * shock - 0.3 * stab, 0, 0, s.ay);
    if (t < ACT_END) sinkHips(a, 0.1 * set);

    cueAt(ctx, t, 0.14, 'horse', 0.6);
    cueAt(ctx, t, 0.3, 'vocal:huscarl', 0.7);
    cueAt(ctx, t, 0.5, 'impact-flesh', 0.7);
    cueAt(ctx, t, 0.76, 'impact-flesh', 0.6);
    resolve(a, s, t, 0.85, 0, 0, 0.1);
  },
};

/** No time to plant: he goes off the line, comes up behind, and hooks the
 *  rider out of the saddle with the haft across his chest. */
const PXN_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.05, side: -1 });

    const dk = phase(t, 0.62, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx + s.fx * 0.5, s.y, s.vz + s.fz * 0.5);
    } else {
      // Through the attacker's ground and past it, wheeling late.
      const run = easeOutCubic(phase(t, 0.1, 0.55));
      victimGuard(ctx, s, lerp(-2.4, 0.5, run), 0, 0, s.vy + 0.5 * run);
      const gallop = Math.sin(t * 44);
      mountLegs(ctx.victim, t * 44, 0.5);
      nudge(ctx.victim, 'mount', 0.05 * gallop);
      nudge(ctx.victim, 'mountHead', 0.1 * gallop, -0.3 * run, 0);
      // He swings at empty air where the huscarl was standing.
      const cut = bump(phase(t, 0.34, 0.5));
      nudge(ctx.victim, 'armR', -0.9 * cut);
      nudge(ctx.victim, 'spine', 0.2 * cut, -0.3 * cut);
    }

    // The dive off the line — he lands on his shield shoulder and rolls up.
    const dive = easeOutCubic(phase(t, 0.2, 0.4));
    const rise = smooth(phase(t, 0.4, 0.56));
    blendPose(a, READY, TUCK, dive * (1 - rise));
    if (rise > 0) blendPose(a, TUCK, READY, rise);
    // Then the haft goes across the rider's chest and levers him off.
    const hook = smooth(phase(t, 0.56, 0.68));
    if (hook > 0) blendPose(a, READY, HOOK_UP, hook);
    const lever = easeInCubic(phase(t, 0.66, 0.8));
    if (lever > 0) blendPose(a, HOOK_UP, HOOK_DOWN, lever);

    placeAt(
      a,
      s,
      lerp(1.6, 1.0, smooth(phase(t, 0.55, 0.8))),
      // Off the line to the right, then back onto it behind the horse.
      lerp(0, 0.95, dive) * (1 - rise * 0.55),
      0.28 * bump(phase(t, 0.2, 0.42)),
      s.ay + 0.5 * dive * (1 - rise),
      -5.6 * dive * (1 - rise),
    );

    cueAt(ctx, t, 0.12, 'horse', 0.7);
    cueAt(ctx, t, 0.24, 'whoosh', 0.6);
    cueAt(ctx, t, 0.38, 'fall', 0.4);
    cueAt(ctx, t, 0.44, 'vocal:huscarl', 0.65);
    cueAt(ctx, t, 0.68, 'impact-flesh', 0.7);
    resolve(a, s, t, 0.9);
  },
};

// ── pxb: shield-first into the runes ────────────────────────────────────────

/** He walks into a hail of runes behind the boss and does not stop. */
const PXB_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.05 });

    const dk = phase(t, 0.68, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // Three casts, each a little more hurried than the last.
      const c1 = bump(phase(t, 0.14, 0.28));
      const c2 = bump(phase(t, 0.3, 0.42));
      const c3 = bump(phase(t, 0.44, 0.54));
      const cast = c1 + c2 + c3;
      nudge(ctx.victim, 'armR', 0.75 * cast, 0, -0.3 * cast);
      nudge(ctx.victim, 'staff', -0.5 * cast);
      nudge(ctx.victim, 'armL', 0.5 * cast, 0, 0.3 * cast);
      nudge(ctx.victim, 'spine', -0.12 * cast);
      // The hood comes up as she realises he is still coming.
      const late = smooth(phase(t, 0.54, 0.66));
      nudge(ctx.victim, 'head', -0.3 * late);
    }

    // Shield-first, steady pace, the boss taking each burst.
    const walk = smooth(phase(t, 0.1, 0.6));
    blendPose(a, READY, BASH, 0.45 + 0.1 * Math.sin(t * 18));
    const bursts =
      bump(phase(t, 0.2, 0.3)) + bump(phase(t, 0.36, 0.46)) + bump(phase(t, 0.5, 0.58));
    nudge(a, 'armL', -0.22 * bursts);
    nudge(a, 'shield', -0.3 * bursts);
    nudge(a, 'spine', -0.14 * bursts);
    nudge(a, 'head', 0.1 * bursts);
    // Close, bash, thrust beneath the hood.
    const bash = anticipate(phase(t, 0.6, 0.7));
    if (phase(t, 0.6, 0.7) > 0) blendPose(a, READY, BASH, clamp01(bash));
    const stab = easeOutCubic(phase(t, 0.7, 0.8));
    if (stab > 0) blendPose(a, BASH, THRUST, stab);

    placeAt(a, s, lerp(1.6, 0.82, walk) - 0.12 * stab, 0, 0, s.ay);

    cueAt(ctx, t, 0.22, 'rune', 0.7);
    cueAt(ctx, t, 0.38, 'rune', 0.7);
    cueAt(ctx, t, 0.52, 'rune', 0.7);
    cueAt(ctx, t, 0.14, 'vocal:volva', 0.6);
    cueAt(ctx, t, 0.64, 'impact-shield', 0.8);
    cueAt(ctx, t, 0.75, 'impact-flesh', 0.7);
    resolve(a, s, t, 0.8);
  },
};

/** The first rune catches him square and puts him on a knee — he gets up. */
const PXB_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.0, side: -1 });

    const dk = phase(t, 0.7, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // One good hit, and then she is too slow with the second.
      const c1 = bump(phase(t, 0.1, 0.24));
      nudge(ctx.victim, 'armR', 0.9 * c1, 0, -0.35 * c1);
      nudge(ctx.victim, 'staff', -0.6 * c1);
      nudge(ctx.victim, 'head', -0.25 * c1);
      const c2 = bump(phase(t, 0.46, 0.62));
      nudge(ctx.victim, 'armR', 0.5 * c2, 0, -0.2 * c2);
      nudge(ctx.victim, 'staff', -0.35 * c2);
      // The staff is caught before the cast lands.
      const caught = smooth(phase(t, 0.62, 0.72));
      nudge(ctx.victim, 'armR', -0.7 * caught, 0, 0.4 * caught);
      nudge(ctx.victim, 'staff', 0.9 * caught, 0, 0.4 * caught);
      nudge(ctx.victim, 'spine', 0.25 * caught, 0.2 * caught);
    }

    // Struck down, up again, then the haft takes the staff and the rim
    // takes her.
    const hit = easeOutCubic(phase(t, 0.18, 0.3));
    const up = smooth(phase(t, 0.36, 0.52));
    blendPose(a, READY, DUCK, hit * (1 - up));
    nudge(a, 'spine', 0.3 * hit * (1 - up));
    if (up > 0) blendPose(a, DUCK, BASH, up);
    const swing = smooth(phase(t, 0.56, 0.7));
    if (swing > 0) blendPose(a, BASH, SWEEP, swing);
    const rim = easeOutCubic(phase(t, 0.72, 0.82));
    if (rim > 0) blendPose(a, SWEEP, PIN, rim);

    placeAt(
      a,
      s,
      lerp(1.6, 0.85, smooth(phase(t, 0.34, 0.72))) + 0.18 * hit * (1 - up),
      0,
      0,
      s.ay,
    );
    if (t < ACT_END) sinkHips(a, 0.2 * hit * (1 - up) + 0.14 * swing + 0.12 * rim);

    cueAt(ctx, t, 0.18, 'rune', 0.85);
    cueAt(ctx, t, 0.24, 'vocal:huscarl', 0.8);
    cueAt(ctx, t, 0.5, 'rune', 0.6);
    cueAt(ctx, t, 0.64, 'impact-metal', 0.8);
    cueAt(ctx, t, 0.76, 'impact-shield', 0.7);
    resolve(a, s, t, 0.85, 0, 0, 0.12);
  },
};

// ── pxr: under the giant ────────────────────────────────────────────────────

/** The palm comes down; he rolls between the fingers and finds a seam. */
const PXR_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'push', height: 1.15, dist: 2.8 });

    const dk = phase(t, 0.7, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      // The unfold IS the anticipation; then one palm comes down.
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      unfoldJotunn(v, phase(t, 0.06, 0.46));
      const slam = easeInCubic(phase(t, 0.5, 0.62));
      const rebound = smooth(phase(t, 0.62, 0.72));
      nudge(v, 'armR', 1.5 * slam - 0.35 * rebound);
      nudge(v, 'forearmR', 0.5 * slam - 0.2 * rebound);
      nudge(v, 'spine', 0.35 * slam - 0.1 * rebound);
      // It seizes up with the spear in the seam.
      const seize = smooth(phase(t, 0.62, 0.7));
      nudge(v, 'chest', -0.2 * seize);
      nudge(v, 'head', -0.25 * seize);
    }

    // Roll under the arm, then both hands drive the spear into the seam.
    const roll = easeInOutCubic(phase(t, 0.5, 0.66));
    blendPose(a, READY, TUCK, bump(phase(t, 0.5, 0.66)));
    const jam = smooth(phase(t, 0.66, 0.78));
    if (jam > 0) blendPose(a, TUCK, THRUST, jam);

    placeAt(
      a,
      s,
      lerp(1.6, 0.7, roll),
      // Rolls across the giant's front and comes up on its flank.
      0.85 * Math.sin(Math.PI * roll),
      0.3 * Math.sin(Math.PI * roll) * (1 - jam),
      s.ay + 0.6 * roll * (1 - jam),
      -6.28 * roll * (1 - jam),
    );

    cueAt(ctx, t, 0.1, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.42, 'impact-stone', 0.6);
    cueAt(ctx, t, 0.5, 'vocal:jotunn', 0.7);
    cueAt(ctx, t, 0.56, 'impact-stone', 0.9);
    cueAt(ctx, t, 0.72, 'impact-metal', 0.8);
    shakeAt(ctx, t, 0.56, 0.32, 0.16);
    shakeAt(ctx, t, 0.1, 0.14, 0.2);
    resolve(a, s, t, 0.8, 0.5);
  },
};

/** He is already wedging the spear into the seams as they part — the giant
 *  never gets its blow away, and he levers it over backwards. */
const PXR_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'rise', height: 0.9, dist: 2.7 });

    const dk = phase(t, 0.66, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      // Caught half-open: the unfold stalls at the wedge.
      const u = phase(t, 0.1, 0.52);
      unfoldJotunn(v, Math.min(u, 0.72));
      const strain = smooth(phase(t, 0.44, 0.62));
      const tip = easeInCubic(phase(t, 0.58, 0.68));
      nudge(v, 'armL', 0.8 * strain);
      nudge(v, 'armR', 0.6 * strain);
      nudge(v, 'spine', -0.3 * strain + 0.2 * tip);
      nudge(v, 'head', -0.2 * strain);
      // Tipped past its balance, going over backwards.
      v.root.rotation.set(0.5 * tip, s.vy, 0.12 * tip);
    }

    // In fast and low while the seams are still opening, then all his weight
    // on the haft.
    const dash = easeOutCubic(phase(t, 0.08, 0.34));
    blendPose(a, READY, WIND, smooth(phase(t, 0.2, 0.36)));
    const wedge = easeOutCubic(phase(t, 0.36, 0.48));
    if (wedge > 0) blendPose(a, WIND, THRUST, wedge);
    const lever = smooth(phase(t, 0.5, 0.68));
    if (lever > 0) blendPose(a, THRUST, HOOK_DOWN, lever);
    nudge(a, 'spine', 0.2 * bump(phase(t, 0.5, 0.68)));

    placeAt(a, s, lerp(1.6, 0.66, dash) + 0.2 * lever, 0.3 * lever, 0, s.ay);
    if (t < ACT_END) sinkHips(a, 0.16 * lever);

    cueAt(ctx, t, 0.14, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.4, 'impact-metal', 0.75);
    cueAt(ctx, t, 0.46, 'vocal:huscarl', 0.7);
    cueAt(ctx, t, 0.58, 'stone-grind', 0.9);
    shakeAt(ctx, t, 0.62, 0.3, 0.2);
    resolve(a, s, t, 0.86, 0, 0, 0.16);
  },
};

// ── pxq: against the dive ───────────────────────────────────────────────────

/** He braces, takes the dive on the boss, and pins a wing to finish. */
const PXQ_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.1, dist: 2.7 });

    const dk = phase(t, 0.56, 0.94);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.5, s.y + 0.1, s.vz - s.fz * 0.5);
    } else {
      // Up, over, and down onto the boss.
      const climb = smooth(phase(t, 0.08, 0.26));
      const dive = easeInCubic(phase(t, 0.28, 0.56));
      victimGuard(
        ctx,
        s,
        lerp(-0.9, 0.5, dive),
        0,
        lerp(0, 1.5, climb) - 1.4 * dive,
      );
      const beat = Math.sin(t * 26);
      nudge(ctx.victim, 'wingL', 0, 0, 0.4 * beat * (1 - dive));
      nudge(ctx.victim, 'wingR', 0, 0, -0.4 * beat * (1 - dive));
      nudge(ctx.victim, 'armR', 0.9 * dive);
      nudge(ctx.victim, 'spine', 0.3 * dive);
    }

    // Set, absorb, then the shield edge goes on the wing.
    const set = smooth(phase(t, 0.14, 0.32));
    blendPose(a, READY, BRACE, set);
    const shock = bump(phase(t, 0.54, 0.66));
    nudge(a, 'armL', -0.45 * shock);
    nudge(a, 'shield', -0.4 * shock);
    nudge(a, 'spine', -0.3 * shock);
    const pin = smooth(phase(t, 0.62, 0.74));
    if (pin > 0) blendPose(a, BRACE, PIN, pin);

    placeAt(a, s, 1.1 + 0.22 * shock - 0.35 * pin, 0, 0, s.ay);
    if (t < ACT_END) sinkHips(a, 0.08 * set + 0.12 * pin);

    cueAt(ctx, t, 0.12, 'wing', 0.7);
    cueAt(ctx, t, 0.3, 'wing', 0.6);
    cueAt(ctx, t, 0.34, 'vocal:huscarl', 0.6);
    cueAt(ctx, t, 0.56, 'impact-shield', 0.9);
    cueAt(ctx, t, 0.7, 'impact-flesh', 0.7);
    resolve(a, s, t, 0.75, 0, 0, 0.12);
  },
};

/** She comes in low and level and takes his shield apart on the pass; he hooks
 *  her out of the air on the second one. */
const PXQ_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.2, dist: 2.9 });

    const dk = phase(t, 0.66, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx + s.rx * 0.6, s.y + 0.75, s.vz + s.rz * 0.6);
    } else {
      // A strafing pass across him, then a tighter one that he is ready for.
      const pass1 = easeInOutCubic(phase(t, 0.1, 0.42));
      const pass2 = easeInOutCubic(phase(t, 0.46, 0.72));
      victimGuard(
        ctx,
        s,
        lerp(0.4, -0.2, pass1),
        lerp(-1.9, 1.9, pass1) * (1 - pass2) + lerp(1.9, 0.6, pass2) * pass2,
        0.75 + 0.25 * Math.sin(t * 12),
        s.vy + 1.2 - 2.4 * pass1 * (1 - pass2),
      );
      const beat = Math.sin(t * 24);
      nudge(ctx.victim, 'wingL', 0, 0, 0.5 * beat);
      nudge(ctx.victim, 'wingR', 0, 0, -0.5 * beat);
      const cut = bump(phase(t, 0.2, 0.34));
      nudge(ctx.victim, 'armR', -0.8 * cut, 0, -0.4 * cut);
    }

    // The shield is taken off him on the first pass — he fights on with the
    // spear alone and hooks her down on the second.
    const wrecked = smooth(phase(t, 0.26, 0.4));
    blendPose(a, READY, PROBE, 0.3);
    const track = smooth(phase(t, 0.44, 0.6));
    if (track > 0) blendPose(a, PROBE, HOOK_UP, track);
    const hook = easeInCubic(phase(t, 0.62, 0.76));
    if (hook > 0) blendPose(a, HOOK_UP, HOOK_DOWN, hook);
    // The ruined shield arm hangs for the rest of the duel — layered after every
    // blend, or the finish would quietly put the shield back on his arm.
    nudge(a, 'armL', -0.7 * wrecked, 0, 0.9 * wrecked);
    nudge(a, 'forearmL', 0.7 * wrecked);
    nudge(a, 'shield', 0.9 * wrecked, 0.4 * wrecked);
    nudge(a, 'spine', -0.2 * bump(phase(t, 0.26, 0.4)));
    nudge(a, 'head', -0.3 * track * (1 - hook));

    placeAt(a, s, lerp(1.5, 0.95, track), 0.3 * wrecked, 0, s.ay + 0.4 * track * (1 - hook));

    cueAt(ctx, t, 0.14, 'wing', 0.7);
    cueAt(ctx, t, 0.28, 'impact-shield', 0.9);
    cueAt(ctx, t, 0.36, 'vocal:huscarl', 0.75);
    cueAt(ctx, t, 0.5, 'wing', 0.65);
    cueAt(ctx, t, 0.66, 'impact-metal', 0.8);
    resolve(a, s, t, 0.9);
  },
};

// ── pxk: against the greatsword ─────────────────────────────────────────────

/** The greatsword splits his shield; he ducks the second swing and takes the
 *  Jarl's legs with the haft. */
const PXK_A: DuelScript = {
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
      // Two swings: the first splits the shield, the second finds nothing.
      const w1 = phase(t, 0.14, 0.24);
      const s1 = easeInCubic(phase(t, 0.24, 0.34));
      const w2 = phase(t, 0.42, 0.52);
      const s2 = easeInCubic(phase(t, 0.52, 0.62));
      const swing = -1.5 * w1 + 2.6 * s1 - 1.2 * w2 + 2.4 * s2;
      nudge(ctx.victim, 'armR', swing * 0.55);
      nudge(ctx.victim, 'armL', swing * 0.5);
      nudge(ctx.victim, 'weapon', -0.5 * s1 - 0.5 * s2);
      nudge(ctx.victim, 'spine', 0.3 * (s1 + s2) - 0.2 * (w1 + w2));
      // Overcommitted on the second, and he is still turning when it comes.
      const trip = smooth(phase(t, 0.62, 0.7));
      nudge(ctx.victim, 'spine', 0.2 * trip, 0.3 * trip);
    }

    // Shield up, shield gone, duck, sweep.
    const brace = smooth(phase(t, 0.1, 0.22));
    blendPose(a, READY, BASH, brace * 0.6);
    const split = smooth(phase(t, 0.3, 0.42));
    nudge(a, 'armL', -0.5 * split, 0, 0.8 * split);
    nudge(a, 'forearmL', 0.6 * split);
    nudge(a, 'shield', 1.0 * split, 0.5 * split);
    nudge(a, 'spine', -0.35 * bump(phase(t, 0.3, 0.44)));
    const duck = smooth(phase(t, 0.46, 0.58));
    if (duck > 0) blendPose(a, BASH, DUCK, duck);
    const sweep = easeOutCubic(phase(t, 0.62, 0.74));
    if (sweep > 0) blendPose(a, DUCK, SWEEP, sweep);

    placeAt(a, s, lerp(1.5, 0.85, brace) + 0.2 * split - 0.15 * sweep, 0, 0, s.ay);
    if (t < ACT_END) sinkHips(a, 0.22 * duck + 0.16 * sweep);

    cueAt(ctx, t, 0.22, 'whoosh', 0.7);
    cueAt(ctx, t, 0.3, 'impact-shield', 0.95);
    cueAt(ctx, t, 0.36, 'vocal:huscarl', 0.7);
    cueAt(ctx, t, 0.5, 'whoosh', 0.8);
    cueAt(ctx, t, 0.66, 'impact-flesh', 0.6);
    shakeAt(ctx, t, 0.3, 0.28, 0.14);
    resolve(a, s, t, 0.82, 0, 0, 0.18);
  },
};

/** The Jarl's first blow misses entirely; the huscarl steps inside the arc and
 *  simply holds the point where it needs to be. The Jarl kneels. */
const PXK_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.0, dist: 2.5, side: -1 });

    const dk = phase(t, 0.62, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // One big swing through where the huscarl was, and the weight of it
      // carries him past.
      const w = phase(t, 0.16, 0.28);
      const cut = easeInCubic(phase(t, 0.28, 0.42));
      const past = smooth(phase(t, 0.42, 0.58));
      nudge(ctx.victim, 'armR', -1.6 * w + 2.8 * cut - 0.5 * past);
      nudge(ctx.victim, 'armL', -1.4 * w + 2.5 * cut - 0.4 * past);
      nudge(ctx.victim, 'weapon', -0.6 * cut);
      nudge(ctx.victim, 'spine', -0.25 * w + 0.45 * cut + 0.1 * past, 0.5 * past);
      // He finds the point already waiting and stops.
      const still = smooth(phase(t, 0.56, 0.66));
      nudge(ctx.victim, 'armR', -0.6 * still);
      nudge(ctx.victim, 'armL', -0.5 * still);
      nudge(ctx.victim, 'head', 0.15 * still, -0.35 * still);
    }

    // He steps inside the arc as it comes down — no parry, no block.
    const inside = easeOutCubic(phase(t, 0.24, 0.44));
    blendPose(a, READY, LEVEL, smooth(phase(t, 0.3, 0.56)));
    // The blade goes past his shoulder; only the mantle moves.
    nudge(a, 'head', -0.2 * bump(phase(t, 0.32, 0.5)));
    nudge(a, 'spine', -0.12 * bump(phase(t, 0.32, 0.5)));
    const hold = smooth(phase(t, 0.56, 0.68));
    nudge(a, 'armR', 0.18 * hold);

    placeAt(
      a,
      s,
      lerp(1.55, 0.78, inside),
      // Inside and slightly off the sword's line, not away from it.
      0.42 * inside,
      0,
      s.ay - 0.3 * inside,
    );

    cueAt(ctx, t, 0.26, 'whoosh', 0.9);
    cueAt(ctx, t, 0.34, 'vocal:jarl', 0.7);
    cueAt(ctx, t, 0.44, 'whoosh', 0.4);
    cueAt(ctx, t, 0.6, 'impact-metal', 0.5);
    resolve(a, s, t, 0.78, 0.42);
  },
};

export const HUSCARL_ROW: DuelMatrix = {
  pxp: [PXP_A, PXP_B],
  pxn: [PXN_A, PXN_B],
  pxb: [PXB_A, PXB_B],
  pxr: [PXR_A, PXR_B],
  pxq: [PXQ_A, PXQ_B],
  pxk: [PXK_A, PXK_B],
};

