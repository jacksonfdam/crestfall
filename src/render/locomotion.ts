/**
 * How a piece crosses the board. A move is locomotion, not a slide: each
 * character carries itself the way its anatomy allows, so the board reads as
 * eight people walking rather than eight sprites being dragged.
 *
 * Gaits are assigned by what a rig actually has to move with:
 * - walk   huscarl, valkyrie, jarl — leg bones, so a real step cycle
 * - ride   berserkr — his legs straddle a horse; the mount carries him
 * - drift  völva — floor-length robe, no leg bones at all; she does not step
 * - grind  jötunn — a petrified tower. It does not walk. It is shifted.
 * - slide  2D emblems — flat heraldry has no anatomy to animate
 *
 * Every gait is a pure function of travel progress k, and every one of them
 * resolves to exactly the rig's idle pose at k=1: poses are re-applied from
 * setPose each frame and the deltas are enveloped to zero at both ends, so a
 * piece can never arrive mid-stride or keep a residual lean.
 *
 * The step cycle math is duplicated from src/duels/motion.ts rather than
 * imported: render and duels are sibling consumers of src/core, and reaching
 * into the duel layer for it would invert that.
 */

import type { CharacterName } from '../core/contract.ts';
import type { CharacterRig } from '../core/stage.ts';

export type Gait = 'walk' | 'ride' | 'drift' | 'grind' | 'slide';

const GAITS: Record<CharacterName, Gait> = {
  huscarl: 'walk',
  valkyrie: 'walk',
  jarl: 'walk',
  berserkr: 'ride',
  volva: 'drift',
  jotunn: 'grind',
};

export function gaitFor(name: CharacterName, flat: boolean): Gait {
  return flat ? 'slide' : GAITS[name];
}

interface Pace {
  /** Fixed cost of setting off and settling, seconds. */
  base: number;
  /** Seconds per square travelled. */
  perSquare: number;
  /** Long moves must not drag the game out. */
  max: number;
  /** Step cycles per square — how short the character's stride is. */
  stridesPerSquare: number;
}

const PACE: Record<Gait, Pace> = {
  // The jarl is the same gait as the huscarl but reads heavier through his
  // stride length, not his speed.
  walk: { base: 0.2, perSquare: 0.15, max: 1.05, stridesPerSquare: 1.6 },
  ride: { base: 0.16, perSquare: 0.1, max: 0.8, stridesPerSquare: 1.15 },
  drift: { base: 0.22, perSquare: 0.13, max: 0.95, stridesPerSquare: 0.9 },
  grind: { base: 0.24, perSquare: 0.14, max: 1.1, stridesPerSquare: 0.75 },
  slide: { base: 0.12, perSquare: 0.02, max: 0.26, stridesPerSquare: 0 },
};

/** How long this piece should take to cover `distance` squares. */
export function travelSeconds(gait: Gait, distance: number): number {
  const p = PACE[gait];
  return Math.min(p.max, p.base + p.perSquare * distance);
}

// ── Curves ──────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number): number => x * x * (3 - 2 * x);
/** Ramp up out of stillness and back into it: 0 at both ends, 1 in between. */
const settle = (k: number, edge: number): number =>
  smooth(clamp01(k / edge)) * smooth(clamp01((1 - k) / edge));

function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
}

/**
 * One leg of a step cycle. The foot plants at integer `cycle` and the knee only
 * folds while the leg carries forward, so a cycle that lands on a whole number
 * leaves the leg exactly straight.
 */
function footPlant(
  leg: { rotation: { x: number } },
  shin: { rotation: { x: number } },
  cycle: number,
  stride: number,
): void {
  const a = (cycle - Math.floor(cycle)) * TAU;
  leg.rotation.x += Math.sin(a) * stride;
  shin.rotation.x += -Math.max(0, -Math.cos(a)) * stride * 1.6;
}

// ── Gaits ───────────────────────────────────────────────────────────────────

/**
 * Pose a travelling rig. `k` is progress in [0,1], `distance` is in squares,
 * `heading` is the yaw that faces the direction of travel.
 *
 * Returns the vertical bob to add to the rig's root, which the caller owns
 * (it is already writing root.position for the approach itself).
 */
export function stepTravel(
  rig: CharacterRig,
  gait: Gait,
  k: number,
  distance: number,
  heading: number,
): number {
  if (gait === 'slide') {
    // Flat heraldry stays square to the board — and this also clears any lean
    // left behind if the gait changed mid-journey on a view switch.
    rig.root.rotation.set(0, 0, 0);
    return 0;
  }

  const p = PACE[gait];
  // Whole number of strides, so the feet are together on arrival.
  const strides = Math.max(1, Math.round(distance * p.stridesPerSquare));
  const cycle = strides * k;
  const amp = settle(k, 0.14);

  // Poses are re-applied every frame and departed from by deltas, so nothing
  // accumulates and k=1 is exactly idle.
  rig.setPose('idle');

  // Face the way you are going, and square up again on arrival.
  const turn = settle(k, 0.18);
  rig.root.rotation.y = lerpAngle(0, heading, turn);

  const b = rig.bones;
  let bob = 0;

  switch (gait) {
    case 'walk': {
      const stride = 0.42 * amp;
      if (b.legL && b.shinL) footPlant(b.legL, b.shinL, cycle, stride);
      if (b.legR && b.shinR) footPlant(b.legR, b.shinR, cycle + 0.5, stride);
      // Arms counter-swing against the legs.
      const swing = Math.sin(cycle * TAU) * 0.3 * amp;
      if (b.armL) b.armL.rotation.x -= swing;
      if (b.armR) b.armR.rotation.x += swing;
      // Two bobs per stride, and a lean into the walk.
      bob = Math.abs(Math.sin(cycle * Math.PI)) * 0.022 * amp;
      if (b.spine) b.spine.rotation.x += 0.07 * amp;
      if (b.head) b.head.rotation.x -= 0.05 * amp;
      if (b.cloak) b.cloak.rotation.x -= 0.1 * amp;
      break;
    }
    case 'ride': {
      // The horse's legs are static geometry, so the canter lives in the
      // mount's body and head and travels up into the rider.
      const beat = Math.sin(cycle * TAU);
      if (b.mount) {
        b.mount.rotation.x += 0.07 * beat * amp;
        b.mount.rotation.z += 0.03 * Math.sin(cycle * TAU * 0.5) * amp;
      }
      if (b.mountHead) b.mountHead.rotation.x += 0.13 * beat * amp;
      if (b.spine) b.spine.rotation.x += 0.05 * amp * (1 + 0.4 * beat);
      bob = Math.abs(Math.sin(cycle * Math.PI)) * 0.03 * amp;
      break;
    }
    case 'drift': {
      // She does not step: the robe hem stays down and she carries level, with
      // a slow sway and the cloak trailing the direction of travel.
      const sway = Math.sin(cycle * TAU) * amp;
      if (b.spine) {
        b.spine.rotation.x += 0.06 * amp;
        b.spine.rotation.z += 0.035 * sway;
      }
      if (b.cloak) b.cloak.rotation.x -= 0.22 * amp;
      if (b.head) b.head.rotation.z += 0.03 * sway;
      if (b.staff) b.staff.rotation.x += 0.06 * sway;
      bob = 0.012 * amp * (1 + 0.5 * Math.sin(cycle * Math.PI * 2));
      break;
    }
    case 'grind': {
      // A tower being shifted: it rocks onto one edge and back, and never
      // lifts clear of the board.
      const rock = Math.sin(cycle * TAU) * amp;
      rig.root.rotation.z = 0.035 * rock;
      rig.root.rotation.x = 0.02 * amp;
      if (b.towerShell) b.towerShell.rotation.y += 0.02 * rock;
      bob = -0.008 * amp;
      break;
    }
  }

  return bob;
}

/**
 * Put a rig back to rest after travel: idle pose, square to the board, no
 * residual lean. Called when a move finishes or is cut short, so an
 * interrupted walk can never leave a piece mid-stride.
 */
export function endTravel(rig: CharacterRig): void {
  rig.setPose('idle');
  rig.root.rotation.set(0, 0, 0);
  rig.root.position.set(0, 0, 0);
}
