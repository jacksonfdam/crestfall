/**
 * How a piece crosses the board. A move is locomotion, not a slide: each
 * character carries itself the way its anatomy allows, so the board reads as
 * eight people walking rather than eight sprites being dragged.
 *
 * Gaits are assigned by what a rig actually has to move with:
 * - walk   huscarl, valkyrie, jarl — leg bones, so a real step cycle
 * - ride   berserkr — he straddles the horse; the horse's own four legs gallop
 * - drift  völva — floor-length robe: she does step, but the hem never shows it
 * - grind  jötunn — a petrified tower. It does not walk, it is walked, over its
 *          own base edges, and it lands hard.
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
  drift: { base: 0.22, perSquare: 0.13, max: 0.95, stridesPerSquare: 1.4 },
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

/**
 * One horse leg, same phase convention as footPlant. The fold direction is a
 * parameter because a horse folds front and back differently: the front knee
 * closes backwards like a human knee, the hind hock closes the other way and
 * brings the hoof forward under the belly.
 */
function hoof(
  leg: { rotation: { x: number } },
  shin: { rotation: { x: number } },
  cycle: number,
  stride: number,
  fold: 1 | -1,
): void {
  const a = (cycle - Math.floor(cycle)) * TAU;
  leg.rotation.x += Math.sin(a) * stride;
  shin.rotation.x += fold * Math.max(0, -Math.cos(a)) * stride * 1.5;
}

/**
 * Plan radius of the jötunn's base ring (the stave profile in src/chars/
 * jotunn.ts starts at 0.338). Tilting a base of radius R by θ drops its lowest
 * rim point by R·sin θ, so this is exactly the lift the tower needs in order to
 * pivot on an edge rather than scythe through the board.
 */
const TOWER_EDGE = 0.34;

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
      // Arms counter-swing against the legs — except a shield arm, which is
      // braced, not swung. A man carrying a board across his front keeps it
      // there, and swinging it also walks the rim into his own mail.
      const swing = Math.sin(cycle * TAU) * 0.3 * amp;
      if (b.armL) b.armL.rotation.x -= swing * (b.shield ? 0.25 : 1);
      if (b.armR) b.armR.rotation.x += swing;
      // Two bobs per stride, and a lean into the walk.
      bob = Math.abs(Math.sin(cycle * Math.PI)) * 0.022 * amp;
      if (b.spine) b.spine.rotation.x += 0.07 * amp;
      if (b.head) b.head.rotation.x -= 0.05 * amp;
      if (b.cloak) b.cloak.rotation.x -= 0.1 * amp;
      break;
    }
    case 'ride': {
      // Four-beat canter, and the legs are the gait: the hind pair strikes
      // first and drives, the front pair reaches and catches, and between the
      // two there is a beat with nothing on the board — that is the lift in
      // `bob`. The barrel only carries what the legs are doing.
      const drive = 0.62 * amp;
      const reach = 0.54 * amp;
      if (b.mountLegBL && b.mountShinBL) {
        hoof(b.mountLegBL, b.mountShinBL, cycle, drive, 1);
      }
      if (b.mountLegBR && b.mountShinBR) {
        hoof(b.mountLegBR, b.mountShinBR, cycle + 0.1, drive, 1);
      }
      if (b.mountLegFL && b.mountShinFL) {
        hoof(b.mountLegFL, b.mountShinFL, cycle + 0.45, reach, -1);
      }
      if (b.mountLegFR && b.mountShinFR) {
        hoof(b.mountLegFR, b.mountShinFR, cycle + 0.55, reach, -1);
      }

      const beat = Math.sin(cycle * TAU);
      if (b.mount) {
        b.mount.rotation.x += 0.09 * beat * amp;
        b.mount.rotation.z += 0.025 * Math.sin(cycle * TAU * 0.5) * amp;
      }
      if (b.mountHead) b.mountHead.rotation.x += 0.14 * beat * amp - 0.06 * amp;
      // The rider absorbs the stride instead of being shaken by it.
      if (b.spine) b.spine.rotation.x += 0.05 * amp - 0.04 * beat * amp;
      if (b.head) b.head.rotation.x += 0.03 * beat * amp;
      // Suspension, phased to land just after the hind pair leaves.
      bob = Math.max(0, Math.sin(cycle * TAU + 1.1)) * 0.05 * amp;
      break;
    }
    case 'drift': {
      // She does step — but under a floor-length robe, so the stride is short
      // enough that no boot ever shows past the hem. What reads is the body
      // rising, and cloth arriving a quarter-step late: hem and cloak lag the
      // hips, which is the difference between a glide and a slide.
      const stride = 0.2 * amp;
      if (b.legL && b.shinL) footPlant(b.legL, b.shinL, cycle, stride);
      if (b.legR && b.shinR) footPlant(b.legR, b.shinR, cycle + 0.5, stride);
      const sway = Math.sin(cycle * TAU) * amp;
      const trail = Math.sin((cycle - 0.25) * TAU) * amp;
      if (b.hips) b.hips.rotation.y += 0.05 * sway;
      if (b.spine) {
        b.spine.rotation.x += 0.06 * amp;
        b.spine.rotation.z += 0.03 * sway;
      }
      if (b.hem) {
        b.hem.rotation.x -= 0.12 * amp + 0.05 * trail;
        b.hem.rotation.z += 0.05 * trail;
      }
      if (b.cloak) b.cloak.rotation.x -= 0.2 * amp + 0.06 * trail;
      if (b.head) b.head.rotation.z += 0.025 * sway;
      if (b.staff) b.staff.rotation.x += 0.05 * sway;
      // A hand's breadth of lift while she is under way: the hem already rests
      // level with the board, so without it any swing puts cloth through it —
      // and a seeress who rises slightly to travel is the reading anyway.
      bob = 0.012 * amp + Math.abs(Math.sin(cycle * Math.PI)) * 0.014 * amp;
      break;
    }
    case 'grind': {
      // A tower is not walked on legs, it is walked on its own base edges: it
      // tips onto one, the far side screws forward over it, and the whole mass
      // drops flat again — twice a cycle, once per edge.
      //
      // `bob` is what makes that a pivot instead of a scythe: a base of radius
      // TOWER_EDGE tilted by `tilt` puts its lowest rim point TOWER_EDGE·sin
      // (tilt) below the board, so it is lifted by exactly that and the planted
      // edge stays on the surface. The only thing that ever goes below the
      // board is the landing itself.
      const a = cycle * TAU;
      const roll = 0.085 * Math.sin(a) * amp;
      const lean = (0.03 + 0.03 * Math.abs(Math.sin(a))) * amp;
      // Landings: sharp attack, fast decay, one as each edge comes down.
      const thud = Math.max(0, Math.cos(a * 2)) ** 8 * amp;
      rig.root.rotation.z = roll;
      rig.root.rotation.x = lean;
      // The raised side leads, a quarter-beat behind the roll.
      rig.root.rotation.y += 0.05 * -Math.cos(a) * amp;
      if (b.towerShell) {
        b.towerShell.rotation.y += 0.03 * Math.sin(a) * amp;
        b.towerShell.rotation.x += 0.025 * thud;
      }
      // The giant folded inside is shaken loose a little on every landing.
      if (b.spine) b.spine.rotation.x += 0.03 * thud;
      if (b.head) b.head.rotation.x += 0.05 * thud;
      bob = TOWER_EDGE * Math.sin(Math.hypot(roll, lean)) - 0.014 * thud;
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
