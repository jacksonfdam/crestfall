/**
 * Ground dust on defeat. The load-bearing properties are that it is a pure
 * function of the reading's clock, that it leaves nothing behind at either end
 * (syncBoard recycles rigs), and that it stays on the ground while the reading
 * drops the body.
 */

import { describe, expect, it } from 'vitest';
import { Group, Mesh, Vector3 } from 'three';
import { buildCharacter } from '../src/chars/index.ts';
import { groundDust } from '../src/duels/dust.ts';
import type { CharacterRig } from '../src/core/stage.ts';

/** A rig parented into a scene, which is what a duel overlay looks like. */
function staged(): { rig: CharacterRig; parent: Group } {
  const parent = new Group();
  const rig = buildCharacter('huscarl', 'ember');
  parent.add(rig.root);
  return { rig, parent };
}

const motesOf = (parent: Group): Mesh[] => {
  const dust = parent.children.find((c) => c.name === 'dust');
  return dust ? (dust.children as Mesh[]) : [];
};

const maxScale = (parent: Group): number =>
  motesOf(parent).reduce((m, o) => Math.max(m, o.scale.x), 0);

const state = (parent: Group): number[] =>
  motesOf(parent).flatMap((o) => [
    o.position.x, o.position.y, o.position.z,
    o.rotation.x, o.rotation.y, o.rotation.z,
    o.scale.x,
  ]);

describe('groundDust', () => {
  it('does nothing for a rig that is not in a scene', () => {
    const rig = buildCharacter('huscarl', 'ash');
    expect(() => groundDust(rig, 0.5, 0, 0, 0)).not.toThrow();
    expect(rig.root.children.some((c) => c.name === 'dust')).toBe(false);
    rig.dispose();
  });

  it('shows nothing at either end of the reading', () => {
    const { rig, parent } = staged();
    groundDust(rig, 0.6, 0, 0, 0);
    expect(maxScale(parent)).toBeGreaterThan(0);
    for (const k of [0, 1]) {
      groundDust(rig, k, 0, 0, 0);
      expect(maxScale(parent), `k=${k}`).toBe(0);
    }
    rig.dispose();
  });

  it('is visible through the back half of the reading', () => {
    const { rig, parent } = staged();
    let seen = 0;
    for (let i = 1; i < 20; i++) {
      groundDust(rig, i / 20, 0, 0, 0);
      if (maxScale(parent) > 0) seen++;
    }
    expect(seen).toBeGreaterThan(6);
    rig.dispose();
  });

  it('is a pure function of k, not an accumulation', () => {
    const a = staged();
    for (let i = 0; i <= 30; i++) groundDust(a.rig, i / 30, 1.5, 0, -2.5);
    groundDust(a.rig, 0.7, 1.5, 0, -2.5);

    const b = staged();
    groundDust(b.rig, 0.7, 1.5, 0, -2.5);

    expect(state(a.parent)).toEqual(state(b.parent));
    a.rig.dispose();
    b.rig.dispose();
  });

  it('stays on the ground when the reading drops the body', () => {
    const { rig, parent } = staged();
    // Sink and shove the root, as a defeat reading does.
    rig.root.position.set(0.8, -1.4, 0.6);
    rig.root.rotation.set(1.2, 0.5, 0.3);
    groundDust(rig, 0.75, 2.0, 0, -1.0);
    const live = motesOf(parent).filter((o) => o.scale.x > 0);
    expect(live.length).toBeGreaterThan(0);
    const p = new Vector3();
    for (const mote of live) {
      mote.getWorldPosition(p);
      // Near the square it was told to dust, and above the board, not under it.
      expect(Math.hypot(p.x - 2.0, p.z + 1.0)).toBeLessThan(0.7);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(0.35);
    }
    rig.dispose();
  });

  it('reuses one burst per rig instead of piling groups up', () => {
    const { rig, parent } = staged();
    for (let i = 0; i <= 40; i++) groundDust(rig, i / 40, 0, 0, 0);
    expect(parent.children.filter((c) => c.name === 'dust')).toHaveLength(1);
    rig.dispose();
  });
});
