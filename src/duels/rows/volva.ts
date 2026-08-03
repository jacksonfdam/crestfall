/**
 * Völva attacks — the bishop row. She never closes distance: in every cell her
 * feet stay where they started and the duel is decided at range. Her body
 * language is the whole performance — the staff plants, the free hand draws,
 * and the victim's reaction is what tells you a rune arrived.
 *
 * RUNES ARE CHOREOGRAPHED, NOT RENDERED. There is no VFX system and the
 * faction materials are shared by the whole army, so nothing here can safely
 * emit light or spawn geometry. Casts read through her gesture, the 'rune'
 * cue, and the victim's recoil; each cast beat is commented with what should
 * eventually ignite there, so a later renderer pass can hang effects off these
 * exact timings.
 *
 * She has no leg bones (the robe is floor-length) — stepLegs is a no-op for
 * her, and her staff hangs off handR.
 */

import type { DuelMatrix, DuelScript } from '../../core/stage.ts';
import { unfoldJotunn } from '../jotunn.ts';
import { clamp01, easeInCubic, easeOutCubic, lerp, phase } from '../motion.ts';
import { defeatVictim, victimGuard } from './defeat.ts';
import {
  blendPose,
  camera,
  cueAt,
  DUR,
  nudge,
  placeAt,
  resolve,
  shakeAt,
  stageDuel,
  type Pose,
} from './support.ts';

const smooth = (x: number): number => x * x * (3 - 2 * x);
const bump = (x: number): number => Math.sin(Math.PI * clamp01(x));

type BBone =
  | 'spine' | 'chest' | 'head' | 'armL' | 'armR' | 'forearmL' | 'forearmR'
  | 'handL' | 'handR' | 'cloak' | 'staff';

// ── Pose library ────────────────────────────────────────────────────────────

/** Staff upright, free hand low: waiting, and in no hurry. */
const STILL: Pose<BBone> = {
  spine: [0.08, 0, 0], chest: [0, 0, 0], head: [0.02, 0, 0],
  armR: [0.35, 0, -0.08], forearmR: [0.35, 0, 0],
  armL: [0.2, 0, 0.1], forearmL: [0.55, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  cloak: [0, 0, 0], staff: [0, 0, 0],
};

/** Staff butt driven into the board — the anchor for everything after. */
const PLANTED: Pose<BBone> = {
  spine: [0.14, 0.05, 0], chest: [0.04, 0, 0], head: [-0.04, 0, 0],
  armR: [0.6, 0, -0.2], forearmR: [0.15, 0, 0],
  armL: [0.35, 0, 0.2], forearmL: [0.7, 0, 0],
  handL: [0, 0, 0], handR: [-0.15, 0, 0],
  cloak: [0.06, 0, 0], staff: [-0.12, 0, 0],
};

/** The draw: free hand gathered in at the chest before it opens. */
const DRAW: Pose<BBone> = {
  spine: [0.02, 0.18, 0], chest: [-0.04, 0.08, 0], head: [-0.1, 0.12, 0],
  armR: [0.62, 0, -0.22], forearmR: [0.12, 0, 0],
  armL: [1.15, 0, -0.35], forearmL: [1.5, 0, 0],
  handL: [0.4, 0, 0], handR: [-0.15, 0, 0],
  cloak: [0.04, 0, 0], staff: [-0.12, 0, 0],
};

/** The release: hand thrown open toward the victim, hood following it. */
const RELEASE: Pose<BBone> = {
  spine: [0.2, -0.22, 0], chest: [0.06, -0.1, 0], head: [-0.06, -0.16, 0],
  armR: [0.6, 0, -0.2], forearmR: [0.15, 0, 0],
  armL: [1.45, 0, 0.15], forearmL: [0.08, 0, 0],
  handL: [-0.35, 0, 0], handR: [-0.15, 0, 0],
  cloak: [-0.05, 0, 0], staff: [-0.12, 0, 0],
};

/** Both hands up: a dome, a fetter, anything that has to be held. */
const HOLD: Pose<BBone> = {
  spine: [-0.12, 0, 0], chest: [-0.06, 0, 0], head: [-0.3, 0, 0],
  armR: [2.1, 0, -0.5], forearmR: [0.35, 0, 0],
  armL: [2.1, 0, 0.5], forearmL: [0.35, 0, 0],
  handL: [-0.3, 0, 0], handR: [-0.3, 0, 0],
  cloak: [-0.12, 0, 0], staff: [-0.5, 0, 0],
};

/** The contraction: what she holds is pulled closed. */
const CLENCH: Pose<BBone> = {
  spine: [0.35, 0, 0], chest: [0.14, 0, 0], head: [0.3, 0, 0],
  armR: [1.5, 0, -0.9], forearmR: [1.3, 0, 0],
  armL: [1.5, 0, 0.9], forearmL: [1.3, 0, 0],
  handL: [0.5, 0, 0], handR: [0.5, 0, 0],
  cloak: [0.2, 0, 0], staff: [-0.3, 0, 0],
};

/** Palm turned down: for a rune sent under the board rather than across it. */
const UNDERCAST: Pose<BBone> = {
  spine: [0.42, -0.12, 0], chest: [0.16, -0.06, 0], head: [0.34, -0.1, 0],
  armR: [0.65, 0, -0.2], forearmR: [0.12, 0, 0],
  armL: [0.5, 0, 0.1], forearmL: [-0.15, 0, 0],
  handL: [-0.7, 0, 0], handR: [-0.15, 0, 0],
  cloak: [0.18, 0, 0], staff: [-0.12, 0, 0],
};

/** The staff swung out level and held there — a sweep across the board. */
const SWEEP_OUT: Pose<BBone> = {
  spine: [0.1, -0.35, 0], chest: [0.04, -0.15, 0], head: [0, -0.3, 0],
  armR: [1.55, 0, -0.15], forearmR: [0.1, 0, 0],
  armL: [0.9, 0, 0.5], forearmL: [0.9, 0, 0],
  handL: [0, 0, 0], handR: [0, 0, 0],
  cloak: [-0.06, 0, 0], staff: [-1.5, 0, 0],
};

// ── bxp: the patient rune ───────────────────────────────────────────────────

/** One slow rune circles him; he swipes at it and it splits into three. */
const BXP_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.05, dist: 2.6 });

    const dk = phase(t, 0.7, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // He tracks it round, swipes, and then it is on three sides of him.
      const track = smooth(phase(t, 0.22, 0.44));
      nudge(ctx.victim, 'head', -0.15 * track, 1.4 * Math.sin(t * 6) * track);
      const swipe = bump(phase(t, 0.44, 0.56));
      nudge(ctx.victim, 'armR', 1.5 * swipe, 0, -0.5 * swipe);
      nudge(ctx.victim, 'spine', 0.2 * swipe, -0.4 * swipe);
      // Shield, arm, chest — three hits in quick order.
      const h1 = bump(phase(t, 0.58, 0.64));
      const h2 = bump(phase(t, 0.62, 0.68));
      const h3 = bump(phase(t, 0.66, 0.72));
      nudge(ctx.victim, 'armL', -0.5 * h1, 0, 0.4 * h1);
      nudge(ctx.victim, 'shield', 0.5 * h1);
      nudge(ctx.victim, 'armR', -0.6 * h2, 0, -0.3 * h2);
      nudge(ctx.victim, 'spine', -0.35 * h3);
      nudge(ctx.victim, 'chest', -0.2 * h3);
    }

    // Plant, one unhurried cast, and then she simply watches it work.
    const plant = smooth(phase(t, 0.08, 0.24));
    blendPose(a, STILL, PLANTED, plant);
    const draw = smooth(phase(t, 0.24, 0.4));
    if (draw > 0) blendPose(a, PLANTED, DRAW, draw);
    // CAST 1 — the single slow rune leaves her hand here and begins to circle.
    const send = easeOutCubic(phase(t, 0.4, 0.5));
    if (send > 0) blendPose(a, DRAW, RELEASE, send);
    // The split: one small turn of the wrist, nothing more.
    const split = bump(phase(t, 0.54, 0.62));
    nudge(a, 'handL', 0.5 * split);
    nudge(a, 'forearmL', 0.3 * split);
    const watch = smooth(phase(t, 0.62, 0.76));
    if (watch > 0) blendPose(a, RELEASE, PLANTED, watch);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.12, 'impact-stone', 0.4);
    cueAt(ctx, t, 0.44, 'rune', 0.7);
    cueAt(ctx, t, 0.3, 'vocal:volva', 0.7);
    cueAt(ctx, t, 0.58, 'rune', 0.6);
    cueAt(ctx, t, 0.64, 'rune', 0.6);
    cueAt(ctx, t, 0.68, 'rune', 0.6);
    resolve(a, s, t, 1.6);
  },
};

/** He comes at her behind the shield, so she puts the rune in the board under
 *  his front foot and lets his own advance walk him onto it. */
const BXP_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 0.95, dist: 2.5, side: -1 });

    const dk = phase(t, 0.66, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.75, s.y, s.vz - s.fz * 0.75);
    } else {
      // He advances shield-first, into it.
      const walk = smooth(phase(t, 0.12, 0.58));
      victimGuard(ctx, s, lerp(0, 0.75, walk));
      const step = Math.sin(t * 22);
      nudge(ctx.victim, 'armL', 0.45 * walk + 0.05 * step, 0, -0.15 * walk);
      nudge(ctx.victim, 'spine', 0.15 * walk);
      nudge(ctx.victim, 'head', 0.06 * step);
      // The board goes out from under him.
      const under = smooth(phase(t, 0.58, 0.68));
      nudge(ctx.victim, 'spine', -0.5 * under);
      nudge(ctx.victim, 'armL', -0.4 * under, 0, 0.5 * under);
      nudge(ctx.victim, 'armR', 0.5 * under, 0, -0.4 * under);
      nudge(ctx.victim, 'head', -0.3 * under);
    }

    // Palm down, cast into the board, and wait for him to arrive.
    const plant = smooth(phase(t, 0.06, 0.2));
    blendPose(a, STILL, PLANTED, plant);
    const turn = smooth(phase(t, 0.24, 0.42));
    if (turn > 0) blendPose(a, PLANTED, UNDERCAST, turn);
    // CAST — set into the board, ahead of where he is walking, not at him.
    const set = bump(phase(t, 0.4, 0.52));
    nudge(a, 'handL', -0.4 * set);
    nudge(a, 'forearmL', -0.3 * set);
    // It comes up under him; she lifts her hand and it follows.
    const raise = easeOutCubic(phase(t, 0.56, 0.68));
    if (raise > 0) blendPose(a, UNDERCAST, RELEASE, raise);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.1, 'impact-stone', 0.4);
    cueAt(ctx, t, 0.28, 'vocal:volva', 0.75);
    cueAt(ctx, t, 0.44, 'rune', 0.55);
    cueAt(ctx, t, 0.58, 'rune', 0.85);
    cueAt(ctx, t, 0.62, 'impact-stone', 0.6);
    shakeAt(ctx, t, 0.58, 0.2, 0.14);
    resolve(a, s, t, 1.6);
  },
};

// ── bxn: the worked example ─────────────────────────────────────────────────

/** Staff planted; three runes ignite in sequence; the horse rears and throws
 *  the rider before the third lands. (DUELS.md worked example.) */
const BXN_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.1, dist: 2.9 });

    const dk = phase(t, 0.62, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      // The charge comes on until the second rune, and never reaches her.
      const run = easeOutCubic(phase(t, 0.14, 0.5));
      victimGuard(ctx, s, lerp(-1.6, 0.1, run));
      const gallop = Math.sin(t * 44);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      // Rune one: the horse shies. Rune two: it rears in earnest.
      const shy = bump(phase(t, 0.32, 0.42));
      nudge(ctx.victim, 'mount', 0.25 * shy, 0.2 * shy);
      nudge(ctx.victim, 'mountHead', -0.3 * shy);
      const rear = smooth(phase(t, 0.46, 0.6));
      nudge(ctx.victim, 'mount', 0.8 * rear);
      nudge(ctx.victim, 'mountHead', -0.6 * rear);
      nudge(ctx.victim, 'spine', -0.3 * rear);
      nudge(ctx.victim, 'armR', 0.6 * rear, 0, -0.3 * rear);
    }

    // Plant, then three casts on an accelerating beat.
    const plant = smooth(phase(t, 0.06, 0.2));
    blendPose(a, STILL, PLANTED, plant);
    // CAST 1 (t≈0.30) ignites in front of the horse — it shies off the line.
    const d1 = smooth(phase(t, 0.2, 0.28));
    const r1 = easeOutCubic(phase(t, 0.28, 0.36));
    // CAST 2 (t≈0.46) ignites under its forehooves — the rear.
    const d2 = smooth(phase(t, 0.38, 0.44));
    const r2 = easeOutCubic(phase(t, 0.44, 0.52));
    // CAST 3 (t≈0.60) never lands: the rider is already off.
    const d3 = smooth(phase(t, 0.52, 0.58));
    const r3 = easeOutCubic(phase(t, 0.58, 0.66));
    const drawn = clamp01(d1 - r1 + d2 - r2 + d3 - r3);
    const sent = clamp01(r1 * (1 - d2) + r2 * (1 - d3) + r3);
    blendPose(a, PLANTED, DRAW, drawn);
    if (sent > 0) blendPose(a, PLANTED, RELEASE, sent);
    // She never moves her feet, and the hood tracks the horse the whole way.
    nudge(a, 'head', 0, -0.2 * smooth(phase(t, 0.28, 0.6)));

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.1, 'impact-stone', 0.45);
    cueAt(ctx, t, 0.18, 'horse', 0.6);
    cueAt(ctx, t, 0.3, 'rune', 0.75);
    cueAt(ctx, t, 0.46, 'rune', 0.85);
    cueAt(ctx, t, 0.5, 'horse', 0.9);
    cueAt(ctx, t, 0.4, 'vocal:volva', 0.8);
    cueAt(ctx, t, 0.6, 'rune', 0.7);
    resolve(a, s, t, 1.6);
  },
};

/** She lets the charge commit and then simply closes the ground in front of it
 *  — a fetter across the horse's path that stops the forehand dead. */
const BXN_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.15, dist: 3.0, side: -1 });

    const dk = phase(t, 0.64, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.35, s.y, s.vz - s.fz * 0.35);
    } else {
      const run = easeInCubic(phase(t, 0.1, 0.46));
      victimGuard(ctx, s, lerp(-1.9, 0.35, run));
      const gallop = Math.sin(t * 46);
      nudge(ctx.victim, 'mount', 0.07 * gallop);
      nudge(ctx.victim, 'mountHead', 0.12 * gallop);
      // Into the fetter at full speed: the forehand stops, the rest does not.
      const caught = smooth(phase(t, 0.46, 0.56));
      const pitch = smooth(phase(t, 0.52, 0.64));
      nudge(ctx.victim, 'mount', -0.75 * pitch, 0, 0.2 * caught);
      nudge(ctx.victim, 'mountHead', 0.5 * pitch);
      nudge(ctx.victim, 'spine', 0.6 * pitch, 0.2 * pitch);
      nudge(ctx.victim, 'armL', 1.0 * pitch, 0, 0.3 * pitch);
    }

    // Both hands, low and wide: a line drawn across the board, then pulled.
    const open = smooth(phase(t, 0.14, 0.36));
    blendPose(a, STILL, HOLD, open);
    // CAST — the fetter lies across the charge's path, not on the horse.
    const bind = easeInCubic(phase(t, 0.44, 0.58));
    if (bind > 0) blendPose(a, HOLD, CLENCH, bind);
    nudge(a, 'spine', 0.1 * bump(phase(t, 0.44, 0.6)));
    const release = smooth(phase(t, 0.62, 0.76));
    if (release > 0) blendPose(a, CLENCH, PLANTED, release);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.16, 'rune', 0.5);
    cueAt(ctx, t, 0.34, 'vocal:volva', 0.8);
    cueAt(ctx, t, 0.46, 'rune', 0.9);
    cueAt(ctx, t, 0.52, 'horse', 0.9);
    cueAt(ctx, t, 0.6, 'fall', 0.6);
    resolve(a, s, t, 1.6);
  },
};

// ── bxb: cast against cast ──────────────────────────────────────────────────

/** Runes annihilate mid-air; her third travels underground and erupts beneath
 *  the rival's staff, breaking it. */
const BXB_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.05, dist: 2.7 });

    const dk = phase(t, 0.66, 0.96);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // She answers the first two exactly, and is still looking up for a third
      // that is not coming.
      const a1 = bump(phase(t, 0.22, 0.34));
      const a2 = bump(phase(t, 0.36, 0.48));
      nudge(ctx.victim, 'armL', 1.2 * (a1 + a2), 0, -0.3 * (a1 + a2));
      nudge(ctx.victim, 'forearmL', -0.8 * (a1 + a2));
      nudge(ctx.victim, 'spine', -0.1 * (a1 + a2));
      const up = smooth(phase(t, 0.5, 0.6));
      nudge(ctx.victim, 'head', -0.35 * up);
      // It comes from below instead: the staff is jolted out of true.
      const erupt = smooth(phase(t, 0.6, 0.68));
      nudge(ctx.victim, 'armR', -0.9 * erupt, 0, 0.5 * erupt);
      nudge(ctx.victim, 'staff', 1.1 * erupt, 0.3 * erupt, 0.4 * erupt);
      nudge(ctx.victim, 'spine', 0.3 * erupt, 0.2 * erupt);
    }

    // Two casts spent on the exchange, then the palm turns down.
    const plant = smooth(phase(t, 0.06, 0.18));
    blendPose(a, STILL, PLANTED, plant);
    const d1 = smooth(phase(t, 0.16, 0.24));
    const r1 = easeOutCubic(phase(t, 0.24, 0.32));
    const d2 = smooth(phase(t, 0.3, 0.38));
    const r2 = easeOutCubic(phase(t, 0.38, 0.46));
    blendPose(a, PLANTED, DRAW, clamp01(d1 - r1 + d2 - r2));
    const sent = clamp01(r1 * (1 - d2) + r2 * (1 - smooth(phase(t, 0.46, 0.54))));
    if (sent > 0) blendPose(a, PLANTED, RELEASE, sent);
    // CAST 3 — sent into the board, to travel under the exchange entirely.
    const down = smooth(phase(t, 0.48, 0.6));
    if (down > 0) blendPose(a, PLANTED, UNDERCAST, down);
    const erupt = bump(phase(t, 0.58, 0.7));
    nudge(a, 'handL', -0.5 * erupt);
    nudge(a, 'armL', 0.4 * erupt);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.26, 'rune', 0.7);
    cueAt(ctx, t, 0.3, 'rune', 0.55);
    cueAt(ctx, t, 0.4, 'rune', 0.7);
    cueAt(ctx, t, 0.44, 'rune', 0.55);
    cueAt(ctx, t, 0.5, 'vocal:volva', 0.8);
    cueAt(ctx, t, 0.6, 'impact-stone', 0.7);
    cueAt(ctx, t, 0.64, 'impact-metal', 0.85);
    shakeAt(ctx, t, 0.6, 0.18, 0.12);
    resolve(a, s, t, 1.6);
  },
};

/** No exchange at all: she smothers the rival's first cast in a dome before it
 *  can leave her hands, then contracts the dome onto the staff. */
const BXB_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.0, dist: 2.6, side: -1 });

    const dk = phase(t, 0.68, 0.97);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      victimGuard(ctx, s);
      // A cast that never gets clear of her own hands.
      const begin = smooth(phase(t, 0.12, 0.3));
      nudge(ctx.victim, 'armL', 0.9 * begin, 0, -0.3 * begin);
      nudge(ctx.victim, 'forearmL', -0.5 * begin);
      const smothered = smooth(phase(t, 0.34, 0.5));
      nudge(ctx.victim, 'armL', -0.7 * smothered, 0, 0.5 * smothered);
      nudge(ctx.victim, 'head', -0.2 * smothered, 0.3 * smothered);
      // The dome closes; the staff is what it closes on.
      const crush = smooth(phase(t, 0.54, 0.68));
      nudge(ctx.victim, 'armR', -0.6 * crush, 0, 0.4 * crush);
      nudge(ctx.victim, 'staff', 0.9 * crush, 0, 0.6 * crush);
      nudge(ctx.victim, 'spine', 0.35 * crush);
    }

    // Hands up early, dome held, then closed with her whole body.
    const up = easeOutCubic(phase(t, 0.1, 0.3));
    blendPose(a, STILL, HOLD, up);
    // The dome resists while the rival works at it.
    const strain = bump(phase(t, 0.34, 0.52));
    nudge(a, 'forearmL', -0.2 * strain);
    nudge(a, 'forearmR', -0.2 * strain);
    nudge(a, 'spine', -0.08 * strain);
    const close = easeInCubic(phase(t, 0.52, 0.68));
    if (close > 0) blendPose(a, HOLD, CLENCH, close);
    const done = smooth(phase(t, 0.72, 0.84));
    if (done > 0) blendPose(a, CLENCH, STILL, done);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.16, 'rune', 0.6);
    cueAt(ctx, t, 0.36, 'rune', 0.75);
    cueAt(ctx, t, 0.5, 'vocal:volva', 0.85);
    cueAt(ctx, t, 0.56, 'rune', 0.8);
    cueAt(ctx, t, 0.64, 'impact-metal', 0.8);
    resolve(a, s, t, 1.6);
  },
};

// ── bxr: the fetter ─────────────────────────────────────────────────────────

/** A fetter-rune binds the tower before it can unfold; the bands contract and
 *  the tower bursts to rubble. */
const BXR_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'push', height: 1.2, dist: 3.0 });

    const dk = phase(t, 0.66, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      v.root.rotation.set(0, s.vy, 0);
      // Bound before it can finish: the unfold stalls part-open and strains
      // against the bands rather than completing.
      const u = phase(t, 0.06, 0.4);
      const bound = smooth(phase(t, 0.34, 0.5));
      unfoldJotunn(v, Math.min(u, lerp(1, 0.45, bound)));
      const strain = bump(phase(t, 0.44, 0.64));
      nudge(v, 'armL', 0.5 * strain, 0, 0.2 * strain);
      nudge(v, 'armR', 0.5 * strain, 0, -0.2 * strain);
      nudge(v, 'spine', -0.2 * strain);
      nudge(v, 'head', -0.3 * strain);
      const squeeze = smooth(phase(t, 0.56, 0.66));
      nudge(v, 'chest', 0.2 * squeeze);
      nudge(v, 'armL', -0.4 * squeeze, 0, -0.3 * squeeze);
      nudge(v, 'armR', -0.4 * squeeze, 0, 0.3 * squeeze);
    }

    // The bands go on early, and then she closes her hands.
    const cast = easeOutCubic(phase(t, 0.16, 0.36));
    blendPose(a, STILL, HOLD, cast);
    // CAST — bands of light around the shell, laid on before it opens.
    const pull = easeInCubic(phase(t, 0.46, 0.66));
    if (pull > 0) blendPose(a, HOLD, CLENCH, pull);
    nudge(a, 'spine', 0.12 * bump(phase(t, 0.46, 0.66)));
    const open = smooth(phase(t, 0.7, 0.84));
    if (open > 0) blendPose(a, CLENCH, PLANTED, open);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.1, 'stone-grind', 0.7);
    cueAt(ctx, t, 0.2, 'rune', 0.75);
    cueAt(ctx, t, 0.42, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.48, 'vocal:volva', 0.85);
    cueAt(ctx, t, 0.6, 'rune', 0.9);
    shakeAt(ctx, t, 0.62, 0.3, 0.18);
    resolve(a, s, t, 1.6);
  },
};

/** She lets it stand all the way up first — and takes the ground out from under
 *  one foot, so its own weight finishes it. */
const BXR_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    const v = ctx.victim;
    camera(ctx, s, t, { idea: 'rise', height: 0.95, dist: 3.1, side: -1 });

    const dk = phase(t, 0.7, 0.99);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y, s.vz);
    } else {
      v.root.position.set(s.vx, s.y, s.vz);
      v.root.rotation.order = 'YXZ';
      // A full, unhurried unfold — she does nothing to stop it.
      unfoldJotunn(v, phase(t, 0.06, 0.48));
      // One foot loses the board and it goes down on that side.
      const sink = smooth(phase(t, 0.56, 0.7));
      const tip = easeInCubic(phase(t, 0.6, 0.72));
      nudge(v, 'legR', -0.5 * sink);
      nudge(v, 'shinR', -0.4 * sink);
      nudge(v, 'armR', 1.2 * tip, 0, -0.5 * tip);
      nudge(v, 'armL', 0.8 * tip, 0, 0.4 * tip);
      nudge(v, 'spine', 0.2 * tip);
      v.root.rotation.set(0, s.vy, -0.45 * tip);
    }

    // Palm down, and a long wait while it finishes standing up.
    const plant = smooth(phase(t, 0.06, 0.2));
    blendPose(a, STILL, PLANTED, plant);
    const turn = smooth(phase(t, 0.36, 0.52));
    if (turn > 0) blendPose(a, PLANTED, UNDERCAST, turn);
    // CAST — into the board beneath its right foot, once the weight is on it.
    const open = bump(phase(t, 0.54, 0.68));
    nudge(a, 'handL', -0.55 * open);
    nudge(a, 'armL', 0.35 * open);
    nudge(a, 'head', 0.2 * open);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.1, 'stone-grind', 0.8);
    cueAt(ctx, t, 0.44, 'impact-stone', 0.6);
    cueAt(ctx, t, 0.5, 'vocal:volva', 0.8);
    cueAt(ctx, t, 0.56, 'rune', 0.85);
    cueAt(ctx, t, 0.64, 'stone-grind', 0.9);
    shakeAt(ctx, t, 0.66, 0.32, 0.2);
    resolve(a, s, t, 1.6);
  },
};

// ── bxq: against the dive ───────────────────────────────────────────────────

/** The dive meets a dome of light; wingtips clip it and spin her, and a rune
 *  ignites on her own shield and drives her to earth. */
const BXQ_A: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.1, dist: 2.9 });

    const dk = phase(t, 0.6, 0.95);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.5, s.y + 0.55, s.vz - s.fz * 0.5);
    } else {
      // Up, over, down onto the dome — and off it, sideways.
      const climb = smooth(phase(t, 0.1, 0.3));
      const dive = easeInCubic(phase(t, 0.32, 0.54));
      const spin = smooth(phase(t, 0.52, 0.62));
      victimGuard(
        ctx,
        s,
        lerp(-1.1, 0.5, dive),
        1.1 * spin,
        lerp(0, 1.6, climb) - 1.0 * dive,
        s.vy + 2.2 * spin,
      );
      const beat = Math.sin(t * 26);
      nudge(ctx.victim, 'wingL', 0, 0, 0.45 * beat * (1 - spin) - 0.6 * spin);
      nudge(ctx.victim, 'wingR', 0, 0, -0.45 * beat * (1 - spin));
      nudge(ctx.victim, 'armR', 1.0 * dive - 0.5 * spin);
      nudge(ctx.victim, 'spine', 0.3 * dive - 0.4 * spin);
      // The rune takes on her own shield and pushes her down.
      const driven = smooth(phase(t, 0.58, 0.68));
      nudge(ctx.victim, 'armL', -0.6 * driven, 0, 0.5 * driven);
      nudge(ctx.victim, 'shield', 0.7 * driven);
    }

    // The dome goes up and simply stays up; then one rune, placed.
    const up = easeOutCubic(phase(t, 0.12, 0.34));
    blendPose(a, STILL, HOLD, up);
    const impact = bump(phase(t, 0.5, 0.6));
    nudge(a, 'forearmL', -0.3 * impact);
    nudge(a, 'forearmR', -0.3 * impact);
    nudge(a, 'spine', -0.12 * impact);
    // CAST — onto the shield boss she is still holding between them.
    const send = easeOutCubic(phase(t, 0.58, 0.68));
    if (send > 0) blendPose(a, HOLD, RELEASE, send);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.14, 'wing', 0.7);
    cueAt(ctx, t, 0.2, 'rune', 0.6);
    cueAt(ctx, t, 0.5, 'impact-shield', 0.85);
    cueAt(ctx, t, 0.54, 'vocal:valkyrie', 0.8);
    cueAt(ctx, t, 0.6, 'rune', 0.9);
    resolve(a, s, t, 1.6);
  },
};

/** She does not wait to be dived on: she fetters the wings at the top of the
 *  climb, and the valkyrie comes down without ever getting her dive away. */
const BXQ_B: DuelScript = {
  duration: DUR,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'rise', height: 1.0, dist: 3.0, side: -1 });

    const dk = phase(t, 0.58, 0.94);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx, s.y + 1.25, s.vz);
    } else {
      // She gets height, and then the wings stop answering her.
      const climb = easeOutCubic(phase(t, 0.1, 0.4));
      const bound = smooth(phase(t, 0.44, 0.58));
      victimGuard(ctx, s, 0, 0, lerp(0, 1.7, climb) - 0.45 * bound);
      const beat = Math.sin(t * 27);
      nudge(ctx.victim, 'wingL', 0, 0, 0.5 * beat * (1 - bound) - 1.0 * bound);
      nudge(ctx.victim, 'wingR', 0, 0, -0.5 * beat * (1 - bound) + 1.0 * bound);
      nudge(ctx.victim, 'spine', -0.2 * climb + 0.4 * bound);
      nudge(ctx.victim, 'armR', 0.6 * climb - 0.8 * bound);
    }

    // Hands follow her up, close on the wings, and open again.
    const track = smooth(phase(t, 0.1, 0.4));
    blendPose(a, STILL, HOLD, track);
    nudge(a, 'head', -0.3 * track);
    // CAST — bands on both wings at the top of the climb.
    const bind = easeInCubic(phase(t, 0.44, 0.6));
    if (bind > 0) blendPose(a, HOLD, CLENCH, bind);
    const open = smooth(phase(t, 0.66, 0.8));
    if (open > 0) blendPose(a, CLENCH, PLANTED, open);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.14, 'wing', 0.8);
    cueAt(ctx, t, 0.3, 'rune', 0.6);
    cueAt(ctx, t, 0.42, 'vocal:volva', 0.8);
    cueAt(ctx, t, 0.48, 'rune', 0.9);
    cueAt(ctx, t, 0.56, 'wing', 0.5);
    resolve(a, s, t, 1.6);
  },
};

// ── bxk: the three marks ────────────────────────────────────────────────────

/** He swings through each rune as it lights — each parried rune brands a mark
 *  on him; at the third mark he freezes mid-swing and falls. */
const BXK_A: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'push', height: 1.05, dist: 2.7 });

    const dk = phase(t, 0.72, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.55, s.y, s.vz - s.fz * 0.55);
    } else {
      // He walks into all three, parrying each, and each parry costs him.
      const walk = smooth(phase(t, 0.1, 0.6));
      victimGuard(ctx, s, lerp(0, 0.55, walk));
      const p1 = bump(phase(t, 0.24, 0.34));
      const p2 = bump(phase(t, 0.42, 0.52));
      const p3 = bump(phase(t, 0.58, 0.68));
      const parry = p1 + p2 + p3;
      nudge(ctx.victim, 'armR', 1.5 * parry, 0, -0.3 * parry);
      nudge(ctx.victim, 'armL', 1.3 * parry, 0, 0.3 * parry);
      nudge(ctx.victim, 'weapon', -0.5 * parry);
      // The marks accumulate: each one takes a little more out of him.
      const m1 = smooth(phase(t, 0.3, 0.4));
      const m2 = smooth(phase(t, 0.48, 0.58));
      const m3 = smooth(phase(t, 0.64, 0.72));
      nudge(ctx.victim, 'spine', 0.12 * m1 + 0.16 * m2 + 0.3 * m3);
      nudge(ctx.victim, 'head', 0.1 * m1 + 0.15 * m2 + 0.25 * m3);
      // Frozen mid-swing on the third.
      const frozen = smooth(phase(t, 0.68, 0.74));
      nudge(ctx.victim, 'armR', 1.2 * frozen);
      nudge(ctx.victim, 'armL', 1.0 * frozen);
    }

    // Three casts, unhurried, each one placed where his guard has just left.
    const plant = smooth(phase(t, 0.06, 0.18));
    blendPose(a, STILL, PLANTED, plant);
    const d1 = smooth(phase(t, 0.14, 0.2));
    const r1 = easeOutCubic(phase(t, 0.2, 0.28));
    const d2 = smooth(phase(t, 0.32, 0.38));
    const r2 = easeOutCubic(phase(t, 0.38, 0.46));
    const d3 = smooth(phase(t, 0.48, 0.54));
    const r3 = easeOutCubic(phase(t, 0.54, 0.62));
    blendPose(a, PLANTED, DRAW, clamp01(d1 - r1 + d2 - r2 + d3 - r3));
    const sent = clamp01(r1 * (1 - d2) + r2 * (1 - d3) + r3);
    if (sent > 0) blendPose(a, PLANTED, RELEASE, sent);
    // She watches him come the whole way and does not give ground.
    nudge(a, 'head', 0.1 * smooth(phase(t, 0.6, 0.76)));

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.22, 'rune', 0.7);
    cueAt(ctx, t, 0.28, 'impact-metal', 0.6);
    cueAt(ctx, t, 0.4, 'rune', 0.75);
    cueAt(ctx, t, 0.46, 'impact-metal', 0.6);
    cueAt(ctx, t, 0.56, 'rune', 0.85);
    cueAt(ctx, t, 0.62, 'vocal:jarl', 0.8);
    resolve(a, s, t, 1.6);
  },
};

/** He gets close enough this time to put the greatsword through the staff —
 *  so she gives him the staff, and finishes it with her bare hands. */
const BXK_B: DuelScript = {
  duration: 3.9,
  update(t, ctx) {
    const s = stageDuel(ctx);
    const a = ctx.attacker;
    camera(ctx, s, t, { idea: 'orbit', height: 1.0, dist: 2.6, side: -1 });

    const dk = phase(t, 0.7, 0.98);
    if (dk > 0) {
      defeatVictim(ctx, dk, s, s.vx - s.fx * 0.7, s.y, s.vz - s.fz * 0.7);
    } else {
      // He closes fast and commits everything to one cut at the staff.
      const rush = easeInCubic(phase(t, 0.1, 0.4));
      victimGuard(ctx, s, lerp(0, 0.7, rush));
      const w = phase(t, 0.36, 0.46);
      const cut = easeInCubic(phase(t, 0.46, 0.56));
      nudge(ctx.victim, 'armR', -1.5 * w + 2.6 * cut);
      nudge(ctx.victim, 'armL', -1.3 * w + 2.3 * cut);
      nudge(ctx.victim, 'weapon', -0.6 * cut);
      nudge(ctx.victim, 'spine', -0.2 * w + 0.4 * cut);
      // Nothing to recover to: the blade is buried in the board.
      const stuck = smooth(phase(t, 0.56, 0.7));
      nudge(ctx.victim, 'armR', 0.3 * stuck);
      nudge(ctx.victim, 'spine', 0.35 * stuck);
      nudge(ctx.victim, 'head', 0.3 * stuck);
    }

    // She lets the staff go — it is only iron — and closes both hands on him.
    const offer = smooth(phase(t, 0.3, 0.46));
    blendPose(a, STILL, SWEEP_OUT, offer);
    const lose = smooth(phase(t, 0.5, 0.58));
    nudge(a, 'armR', -0.9 * lose, 0, 0.5 * lose);
    nudge(a, 'staff', 1.2 * lose, 0.4 * lose, 0.5 * lose);
    const both = easeOutCubic(phase(t, 0.58, 0.7));
    if (both > 0) blendPose(a, SWEEP_OUT, HOLD, both);
    const close = easeInCubic(phase(t, 0.7, 0.82));
    if (close > 0) blendPose(a, HOLD, CLENCH, close);

    placeAt(a, s, 1.6, 0, 0, s.ay);

    cueAt(ctx, t, 0.14, 'vocal:jarl', 0.7);
    cueAt(ctx, t, 0.5, 'impact-metal', 0.9);
    cueAt(ctx, t, 0.56, 'impact-stone', 0.6);
    cueAt(ctx, t, 0.62, 'vocal:volva', 0.9);
    cueAt(ctx, t, 0.74, 'rune', 0.85);
    resolve(a, s, t, 1.6);
  },
};

export const VOLVA_ROW: DuelMatrix = {
  bxp: [BXP_A, BXP_B],
  bxn: [BXN_A, BXN_B],
  bxb: [BXB_A, BXB_B],
  bxr: [BXR_A, BXR_B],
  bxq: [BXQ_A, BXQ_B],
  bxk: [BXK_A, BXK_B],
};
