/**
 * 2D-mode capture vignette. Full duels are suppressed in 2D; the capture
 * resolves as a compact heraldic beat: the attacker's emblem lifts, slides
 * over the victim's emblem, and presses down while the victim fades away
 * beneath it. Built as a DuelScript so the DuelDirector drives it through
 * the exact same codepath as 3D duels — one clock, one queue, one end state.
 *
 * Faction materials are shared across every piece on the board, so "fade"
 * is staged geometrically (shrink + sink under the board plane) instead of
 * via material opacity, which would ghost the whole army.
 */

import { PIECE_CHARACTER } from '../core/contract.ts';
import type { DuelContext, DuelScript } from '../core/stage.ts';
import {
  arc,
  backOut,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  phase,
  type Vec3,
} from './motion.ts';

/** Slide beat: lift-off → travel → press. */
const SLIDE_A = 0.08;
const SLIDE_B = 0.62;
/** Victim fade runs under the incoming emblem and completes before t=1. */
const FADE_A = 0.4;
const FADE_B = 0.94;
/** Settle beat: the landed emblem's press relaxes to rest. */
const SETTLE_B = 0.95;

const LIFT = 0.16;
const SINK = 0.05;
const PRESS_SCALE = 0.1;

const _pos: Vec3 = [0, 0, 0];

function update(t: number, ctx: DuelContext): void {
  const { attacker, victim, attackerPos, victimPos } = ctx;

  // ── Attacker emblem: anticipating lift, arc across, weighted settle ──────
  const slide = easeInOutCubic(phase(t, SLIDE_A, SLIDE_B));
  arc(attackerPos, victimPos, LIFT, slide, _pos);
  attacker.root.position.set(_pos[0], _pos[1], _pos[2]);

  // Grows slightly while airborne, then backOut presses it flat to exactly 1.
  const swell = easeOutCubic(phase(t, SLIDE_A, SLIDE_B));
  const settle = backOut(phase(t, SLIDE_B, SETTLE_B));
  const scale = 1 + PRESS_SCALE * (swell - settle * swell);
  attacker.root.scale.set(scale, 1, scale);

  // ── Victim emblem: fades — shrinks and sinks under the board plane ───────
  const fade = easeInCubic(phase(t, FADE_A, FADE_B));
  if (t >= FADE_B) {
    // Canonical end: victim gone, transforms restored for rig reuse.
    victim.root.visible = false;
    victim.root.scale.set(1, 1, 1);
    victim.root.position.set(victimPos[0], victimPos[1], victimPos[2]);
  } else {
    victim.root.visible = true;
    const s = Math.max(0.001, 1 - fade);
    victim.root.scale.set(s, 1, s);
    victim.root.position.set(
      victimPos[0],
      victimPos[1] - SINK * fade,
      victimPos[2],
    );
  }

  // ── Cues (director dedupes each windowed beat to one emission) ───────────
  if (t >= SLIDE_A && t < SLIDE_A + 0.12) ctx.cue('whoosh', 0.5);
  if (t >= SLIDE_B && t < SLIDE_B + 0.12) {
    ctx.cue('fall', 0.6);
    ctx.cue(`vocal:${PIECE_CHARACTER[ctx.victimPiece]}`, 0.5);
  }
}

/** Compact: well under the 4 s cap; no camera move — 2D stays top-down. */
export const VIGNETTE_2D: DuelScript = {
  duration: 0.9,
  update,
};
