/**
 * Duel-camera path geometry. Both helpers exist because the duel camera used to
 * end up inside a figure: arcCamera for the two fighters (the cut-in dollied
 * along a chord that crossed them), keepOutOfFigure for the bystanders (the
 * framing is derived from the fighters' staging, so its mark lands on occupied
 * squares). tests/duels.test.ts flies the real scripts through arcCamera; this
 * file pins the geometry itself.
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { arcCamera, keepOutOfFigure } from '../src/render/cameraPath.ts';

const KEEP_OUT = 0.75;
const LIFT = 0.1;
/** A figure standing at the origin, huscarl-sized. */
const stand = (eye: Vector3, cx = 0, cz = 0, height = 0.96): boolean =>
  keepOutOfFigure(eye, cx, cz, 0, height, KEEP_OUT, LIFT);

const radial = (eye: Vector3, cx = 0, cz = 0): number =>
  Math.hypot(eye.x - cx, eye.z - cz);

describe('arcCamera', () => {
  const look = new Vector3(0, 0.5, 0);
  const from = new Vector3(0, 6, 8);
  const to = new Vector3(2.2, 1.1, 0);
  const out = new Vector3();

  it('lands exactly on both endpoints', () => {
    arcCamera(out, from, to, look, 0);
    expect(out.distanceTo(from)).toBeLessThan(1e-6);
    arcCamera(out, from, to, look, 1);
    expect(out.distanceTo(to)).toBeLessThan(1e-6);
  });

  it('never comes closer to the look point than the nearer endpoint', () => {
    const rMin = Math.min(from.distanceTo(look), to.distanceTo(look));
    for (let i = 0; i <= 200; i++) {
      arcCamera(out, from, to, look, i / 200);
      // This is the whole point: a chord would cut inside, an arc cannot.
      expect(out.distanceTo(look)).toBeGreaterThanOrEqual(rMin - 1e-9);
    }
  });

  it('holds its radius where the chord would pass straight through', () => {
    // The failure mode, in its purest form: put the subject exactly on the
    // chord. The lerp walks right through it; the arc cannot.
    const a = new Vector3(4.9, 5.96, 7.99);
    const b = new Vector3(-2.2, 1.1, -0.4);
    const mid = new Vector3().lerpVectors(a, b, 0.5);
    let arcMin = Infinity;
    let chordMin = Infinity;
    const chord = new Vector3();
    for (let i = 0; i <= 200; i++) {
      const k = i / 200;
      arcCamera(out, a, b, mid, k);
      arcMin = Math.min(arcMin, out.distanceTo(mid));
      chord.lerpVectors(a, b, k);
      chordMin = Math.min(chordMin, chord.distanceTo(mid));
    }
    expect(chordMin).toBeLessThan(1e-9);
    expect(arcMin).toBeCloseTo(a.distanceTo(mid), 6);
    expect(arcMin).toBeGreaterThan(5);
  });

  it('falls back to the chord when a radius is degenerate', () => {
    const at = new Vector3(1, 2, 3);
    arcCamera(out, at, new Vector3(5, 5, 5), at, 0.5);
    expect(out.x).toBeCloseTo(3);
  });
});

describe('keepOutOfFigure', () => {
  it('pushes an eye standing inside a figure out to the keep-out radius', () => {
    const eye = new Vector3(0.1, 1.0, 0.05);
    expect(stand(eye)).toBe(true);
    expect(radial(eye)).toBeCloseTo(KEEP_OUT, 6);
  });

  it('pushes straight out, preserving the bearing it came in on', () => {
    const eye = new Vector3(0.3, 1.0, 0.4);
    const bearing = Math.atan2(eye.z, eye.x);
    stand(eye);
    expect(Math.atan2(eye.z, eye.x)).toBeCloseTo(bearing, 6);
  });

  it('never changes the eye height — the low duel angle is the shot', () => {
    const eye = new Vector3(0, 1.05, 0);
    stand(eye);
    expect(eye.y).toBe(1.05);
  });

  it('resolves an eye dead on the axis instead of dividing by zero', () => {
    const eye = new Vector3(0, 0.5, 0);
    expect(stand(eye)).toBe(true);
    expect(radial(eye)).toBeCloseTo(KEEP_OUT, 6);
    expect(Number.isFinite(eye.x) && Number.isFinite(eye.z)).toBe(true);
  });

  it('leaves an eye that is already clear alone', () => {
    const eye = new Vector3(2.5, 1.0, 0);
    expect(stand(eye)).toBe(false);
    expect(eye.x).toBe(2.5);
  });

  it('leaves an eye above the figure alone, so wide shots are undistorted', () => {
    const eye = new Vector3(0, 5.96, 0);
    expect(stand(eye)).toBe(false);
    expect(eye.x).toBe(0);
  });

  it('gates on the figure it is given, not a fixed height', () => {
    // The eye clears a huscarl (0.96) but not a valkyrie (1.5).
    const short = new Vector3(0, 1.2, 0);
    expect(stand(short, 0, 0, 0.96)).toBe(false);
    const tall = new Vector3(0, 1.2, 0);
    expect(stand(tall, 0, 0, 1.5)).toBe(true);
  });

  it('clears a whole rank of neighbours in two passes, as the stage runs it', () => {
    // Eye buried in a file of adjacent pieces, one board unit apart.
    const figures = [-1, 0, 1].map((z) => ({ x: 0, z }));
    const eye = new Vector3(0.02, 1.0, 0.03);
    for (let pass = 0; pass < 2; pass++) {
      for (const f of figures) stand(eye, f.x, f.z);
    }
    for (const f of figures) {
      expect(
        radial(eye, f.x, f.z),
        `still inside figure at z=${f.z}`,
      ).toBeGreaterThanOrEqual(KEEP_OUT - 1e-6);
    }
  });
});
