/**
 * Ground dust for a defeat: a low ring of motes that puffs out of the board
 * where the victim goes down and settles back into nothing, so a piece leaves
 * by dissolving into the square rather than being switched off.
 *
 * Two things make this safe to drive from a duel script. It is a pure function
 * of the reading's clock `k` — every mote's angle, size and timing come from
 * hash32 of its index, never from prng or a wall clock, so scrubbing, 2x and
 * skip-to-1 all land on the same state. And every mote is scaled to zero at
 * both k=0 and k=1, so a rig that syncBoard recycles carries no leftovers.
 *
 * The motes hang off the rig root's PARENT, not the root, because the readings
 * translate and sink the root — dust that rode along with it would follow the
 * body down instead of staying on the ground where it fell. During a duel that
 * parent is the overlay group main.ts builds, so the burst is removed with the
 * duel and never touches the board rigs.
 */

import { BoxGeometry, Group, Mesh } from 'three';
import type { Material, Object3D } from 'three';
import { hash32 } from '../core/prng.ts';
import type { CharacterRig } from '../core/stage.ts';
import { clamp01, easeOutCubic, phase } from './motion.ts';

/** Motes per burst. Enough to read as a ring, cheap enough to be free. */
const MOTES = 22;
/** One geometry for every mote in the game; never disposed, never mutated. */
const MOTE = new BoxGeometry(0.08, 0.032, 0.08);

interface Burst {
  group: Group;
  motes: Mesh[];
}

const BURSTS = new WeakMap<Object3D, Burst>();

const h01 = (i: number, salt: number): number => hash32(i + 1, salt) / 4294967296;

/** First material in the rig, so the dust is the faction's own colour. */
function borrowMaterial(rig: CharacterRig): Material | null {
  let found: Material | null = null;
  rig.root.traverse((o: Object3D) => {
    if (found) return;
    if (o instanceof Mesh) found = o.material as Material;
  });
  return found;
}

/**
 * The burst for this rig, built on first use. Rebuilt if the rig has been
 * reparented into a new duel, which is what a recycled rig looks like.
 */
function burstFor(rig: CharacterRig): Burst | null {
  const parent = rig.root.parent;
  if (!parent) return null;
  const cached = BURSTS.get(rig.root);
  if (cached && cached.group.parent === parent) return cached;
  const mat = borrowMaterial(rig);
  if (!mat) return null;
  const group = new Group();
  group.name = 'dust';
  parent.add(group);
  const motes: Mesh[] = [];
  for (let i = 0; i < MOTES; i++) {
    const m = new Mesh(MOTE, mat);
    m.scale.setScalar(0);
    group.add(m);
    motes.push(m);
  }
  const burst: Burst = { group, motes };
  BURSTS.set(rig.root, burst);
  return burst;
}

/**
 * Puff dust out of (`x`, `y`, `z`) over the back half of a defeat reading.
 * Silently does nothing for a rig that is not parented into a scene, which is
 * how the headless harnesses see it.
 */
export function groundDust(
  rig: CharacterRig,
  k: number,
  x: number,
  y: number,
  z: number,
): void {
  const burst = burstFor(rig);
  if (!burst) return;
  const kk = clamp01(k);
  for (let i = 0; i < burst.motes.length; i++) {
    const mote = burst.motes[i];
    const angle = h01(i, 0x51) * Math.PI * 2;
    const spread = h01(i, 0x77);
    const heft = h01(i, 0x1d);
    // Staggered starts, so the ring lifts raggedly rather than as one lid.
    const start = 0.3 + 0.34 * spread;
    const u = phase(kk, start, 1);
    if (u <= 0 || u >= 1) {
      mote.scale.setScalar(0);
      continue;
    }
    const out = (0.12 + 0.5 * spread) * easeOutCubic(u);
    // Rise and fall once: dust kicked up, then settling back to the board.
    const puff = Math.sin(Math.PI * u);
    mote.position.set(
      x + Math.cos(angle) * out,
      y + 0.012 + puff * (0.05 + 0.09 * heft),
      z + Math.sin(angle) * out,
    );
    mote.rotation.set(u * (1.4 + heft), angle + u * 2.2, u * 0.9);
    mote.scale.setScalar(puff * (0.7 + 0.8 * heft));
  }
}
