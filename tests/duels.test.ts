/**
 * Duel matrix gate: the hard rules from docs/DUELS.md, checked against every
 * script in the matrix (35 cells × every variant).
 *
 * The important one is PURITY. A DuelScript is specified as a pure pose-function
 * of t, so sampling any t must be valid on its own: a script reached by stepping
 * from 0 must be byte-identical to the same t sampled cold on a fresh rig.
 * That is what makes scrubbing, 2× speed and skip-to-1 land on clean states,
 * and it is what the determinism and desync harnesses depend on.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PIECE_CHARACTER, type PieceType, type Square } from '../src/core/contract.ts';
import { isCueName } from '../src/audio/cues.ts';
import { mulberry32 } from '../src/core/prng.ts';
import { buildCharacter } from '../src/chars/index.ts';
import type { CharacterRig, DuelContext, DuelScript } from '../src/core/stage.ts';
import { CELL_KEYS, DUEL_MATRIX, validateMatrix } from '../src/duels/index.ts';
import { defeatVictim } from '../src/duels/rows/defeat.ts';
import { stageDuel } from '../src/duels/rows/support.ts';
import { arcCamera } from '../src/render/cameraPath.ts';
import { squareToWorld } from '../src/render/boardMath.ts';

const ATTACKER_POS: [number, number, number] = [-1.5, 0, 2.5];
const VICTIM_POS: [number, number, number] = [0.5, 0, 0.5];

interface Recording {
  cues: string[];
  shakes: number[];
}

function makeCtx(
  attacker: CharacterRig,
  victim: CharacterRig,
  attackerPiece: PieceType,
  victimPiece: PieceType,
  rec: Recording,
): DuelContext {
  return {
    attacker,
    victim,
    attackerPiece,
    victimPiece,
    camera: {
      camera: new THREE.PerspectiveCamera(),
      moveTo: () => {},
      shake: (i) => rec.shakes.push(i),
      release: () => {},
    },
    prng: mulberry32(1234),
    attackerPos: ATTACKER_POS,
    victimPos: VICTIM_POS,
    cue: (name) => rec.cues.push(name),
  };
}

/** Every transform a script can touch, as a flat list of numbers. */
function snapshot(rig: CharacterRig): number[] {
  const out: number[] = [];
  for (const name of Object.keys(rig.bones).sort()) {
    const bone = rig.bones[name as keyof typeof rig.bones];
    if (!bone) continue;
    out.push(
      bone.position.x, bone.position.y, bone.position.z,
      bone.rotation.x, bone.rotation.y, bone.rotation.z,
      bone.scale.x, bone.scale.y, bone.scale.z,
    );
  }
  // Shell fragments and other non-bone meshes the jötunn helpers move.
  rig.root.traverse((o) => {
    out.push(
      o.position.x, o.position.y, o.position.z,
      o.rotation.x, o.rotation.y, o.rotation.z,
      o.scale.x, o.scale.y, o.scale.z,
    );
  });
  return out;
}

interface Cell {
  key: string;
  index: number;
  script: DuelScript;
  attackerPiece: PieceType;
  victimPiece: PieceType;
}

const CELLS: Cell[] = CELL_KEYS.flatMap((key) =>
  (DUEL_MATRIX[key] ?? []).map((script, index) => ({
    key,
    index,
    script,
    attackerPiece: key[0] as PieceType,
    victimPiece: key[2] as PieceType,
  })),
);

function rigsFor(cell: Cell): [CharacterRig, CharacterRig] {
  return [
    buildCharacter(PIECE_CHARACTER[cell.attackerPiece], 'ash'),
    buildCharacter(PIECE_CHARACTER[cell.victimPiece], 'ember'),
  ];
}

/** Sample one script over a fresh pair of rigs and return the end snapshots. */
function play(cell: Cell, ts: readonly number[]): {
  rec: Recording;
  states: number[][];
  attacker: CharacterRig;
  victim: CharacterRig;
} {
  const [attacker, victim] = rigsFor(cell);
  const rec: Recording = { cues: [], shakes: [] };
  const ctx = makeCtx(attacker, victim, cell.attackerPiece, cell.victimPiece, rec);
  const states: number[][] = [];
  for (const t of ts) {
    cell.script.update(t, ctx);
    states.push([...snapshot(attacker), ...snapshot(victim)]);
  }
  return { rec, states, attacker, victim };
}

const SWEEP: number[] = [];
for (let i = 0; i <= 40; i++) SWEEP.push(i / 40);

describe('duel matrix', () => {
  it('is complete and shippable: 35 cells, >=2 variants, durations in (0,4]', () => {
    expect(validateMatrix()).toEqual([]);
    expect(CELL_KEYS).toHaveLength(35);
    expect(Object.keys(DUEL_MATRIX).sort()).toEqual([...CELL_KEYS].sort());
  });

  it('has a variant A and B for every cell', () => {
    for (const key of CELL_KEYS) {
      expect(DUEL_MATRIX[key].length, key).toBeGreaterThanOrEqual(2);
    }
  });

  it('covers 35 cells with at least 70 scripts', () => {
    expect(CELLS.length).toBeGreaterThanOrEqual(70);
  });
});

describe.each(CELLS)('$key variant $index', (cell) => {
  it('holds the 4.0s cap', () => {
    expect(cell.script.duration).toBeGreaterThan(0);
    expect(cell.script.duration).toBeLessThanOrEqual(4);
  });

  it('writes only finite transforms across the whole timeline', () => {
    const { states } = play(cell, SWEEP);
    for (let i = 0; i < states.length; i++) {
      for (const n of states[i]) {
        if (!Number.isFinite(n)) {
          throw new Error(`non-finite transform at t=${SWEEP[i]}`);
        }
      }
    }
  });

  it('is a pure function of t: a cold sample equals a stepped one', () => {
    const stepped = play(cell, SWEEP).states;
    // Sample each t cold, on rigs that have never seen another frame.
    for (let i = 0; i < SWEEP.length; i++) {
      const cold = play(cell, [SWEEP[i]]).states[0];
      expect(cold, `t=${SWEEP[i]}`).toEqual(stepped[i]);
    }
  });

  it('survives being skipped straight to the end', () => {
    const skipped = play(cell, [1]).states[0];
    const swept = play(cell, SWEEP).states.at(-1)!;
    expect(skipped).toEqual(swept);
  });

  it('lands the victor on the captured square at t=1', () => {
    const { attacker } = play(cell, SWEEP);
    expect(attacker.root.position.x).toBeCloseTo(VICTIM_POS[0], 6);
    expect(attacker.root.position.y).toBeCloseTo(VICTIM_POS[1], 6);
    expect(attacker.root.position.z).toBeCloseTo(VICTIM_POS[2], 6);
  });

  it('leaves the victor with no displaced bone positions or scales', () => {
    // The victor goes back on the board, and syncBoard may even recycle the
    // rig for another piece of the same type and colour. setPose restores
    // rotations only, so anything a duel translated must be put back.
    const { attacker } = play(cell, SWEEP);
    const [fresh] = rigsFor(cell);
    fresh.setPose('idle');
    for (const name of Object.keys(fresh.bones)) {
      const key = name as keyof typeof fresh.bones;
      const got = attacker.bones[key];
      const want = fresh.bones[key];
      if (!got || !want || name === 'root') continue;
      expect(got.position.toArray(), `${name} position`).toEqual(
        want.position.toArray(),
      );
      expect(got.scale.toArray(), `${name} scale`).toEqual(want.scale.toArray());
    }
  });

  it('fires at least one vocal accent, and only real cue names', () => {
    const { rec } = play(cell, SWEEP);
    expect(rec.cues.every(isCueName), rec.cues.join(',')).toBe(true);
    expect(rec.cues.some((c) => c.startsWith('vocal:'))).toBe(true);
  });

  it('keeps camera shake within the 0.35 cap', () => {
    const { rec } = play(cell, SWEEP);
    for (const s of rec.shakes) {
      expect(s).toBeLessThanOrEqual(0.35);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * Camera clearance. The duel camera used to dolly straight from the board
 * camera to the duel framing, and because each script picks its viewing side
 * without knowing where the board camera is, that chord ran through a
 * combatant on about half of all captures — worst measured case 0.06 world
 * units, i.e. the eye inside the victim's chest. src/render/cameraPath.ts
 * arcs the move around the framing centre instead; this pins that down over
 * the real scripts, at squares chosen so the pair sits between the board
 * camera and both possible viewing sides.
 */
describe('duel camera clearance', () => {
  // Board camera rest state, mirrored from src/render/stage.ts.
  const ORBIT = { az: 0.55, polar: 1.02, radius: 11 };
  const ORBIT_TARGET = new THREE.Vector3(0, 0.2, 0);
  /** Cut-in ramp, from src/duels/rows/support.ts. */
  const CUT_IN = 0.14;
  /** Nothing may come closer to the eye than this; near plane is 0.1. */
  const MIN_CLEARANCE = 0.35;

  const boardCamera = (): THREE.Vector3 => {
    const sp = Math.sin(ORBIT.polar);
    return new THREE.Vector3(
      ORBIT_TARGET.x + ORBIT.radius * sp * Math.sin(ORBIT.az),
      ORBIT_TARGET.y + ORBIT.radius * Math.cos(ORBIT.polar),
      ORBIT_TARGET.z + ORBIT.radius * sp * Math.cos(ORBIT.az),
    );
  };

  const smoothstep = (t: number): number => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };

  const box = new THREE.Box3();
  function clearance(rig: CharacterRig, eye: THREE.Vector3): number {
    let best = Infinity;
    rig.root.updateMatrixWorld(true);
    rig.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      box.setFromObject(o);
      const d = box.distanceToPoint(eye);
      if (d < best) best = d;
    });
    return best;
  }

  // Captures whose approach axis is roughly across the board camera's sightline,
  // which is the geometry that used to produce the intrusions.
  const CAPTURES: [Square, Square][] = [
    [27, 36], [63, 54], [0, 9], [7, 14], [56, 49], [3, 11],
  ];

  it.each(CELLS.map((c) => [`${c.key} variant ${c.index}`, c] as const))(
    '%s keeps the eye clear of both fighters through the cut-in',
    (_label, cell) => {
      const start = boardCamera();
      const eye = new THREE.Vector3();
      const reqPos = new THREE.Vector3();
      const reqLook = new THREE.Vector3();
      const look = new THREE.Vector3();

      for (const [fromSq, toSq] of CAPTURES) {
        const [attacker, victim] = rigsFor(cell);
        const rec: Recording = { cues: [], shakes: [] };
        const ctx: DuelContext = {
          ...makeCtx(attacker, victim, cell.attackerPiece, cell.victimPiece, rec),
          attackerPos: squareToWorld(fromSq),
          victimPos: squareToWorld(toSq),
          camera: {
            camera: new THREE.PerspectiveCamera(),
            moveTo: (pos, lookAt) => {
              reqPos.set(pos[0], pos[1], pos[2]);
              reqLook.set(lookAt[0], lookAt[1], lookAt[2]);
            },
            shake: (i) => rec.shakes.push(i),
            release: () => {},
          },
        };

        // Sample the cut-in densely — that is the leg that used to intrude.
        for (let i = 0; i <= 60; i++) {
          const t = (i / 60) * CUT_IN;
          cell.script.update(t, ctx);
          const k = smoothstep(t / CUT_IN);
          look.lerpVectors(ORBIT_TARGET, reqLook, k);
          arcCamera(eye, start, reqPos, look, k);
          for (const [who, rig] of [
            ['attacker', attacker] as const,
            ['victim', victim] as const,
          ]) {
            const d = clearance(rig, eye);
            expect(
              d,
              `${cell.key}#${cell.index} ${fromSq}->${toSq} t=${t.toFixed(3)} ${who}`,
            ).toBeGreaterThan(MIN_CLEARANCE);
          }
        }
        attacker.dispose();
        victim.dispose();
      }
    },
  );
});

/**
 * The unhorsing, specifically. Every other victim collapses where it stands;
 * the berserkr is the only one thrown clear of something, and "thrown clear"
 * used to mean left hanging in the air above the square, because the reading
 * eased him downwards to a height that was never the board.
 */
describe('the unhorsed berserkr', () => {
  const sample = (): { hips: number[]; lowest: number[] } => {
    const victim = buildCharacter('berserkr', 'ash');
    const rec: Recording = { cues: [], shakes: [] };
    const ctx = makeCtx(victim, victim, 'p', 'n', rec);
    const s = stageDuel(ctx);
    const hips: number[] = [];
    const lowest: number[] = [];
    const v = new THREE.Vector3();
    const rider = victim.bones.hips!;
    for (let i = 0; i <= 60; i++) {
      victim.setPose('idle');
      defeatVictim(ctx, i / 60, s, s.vx, s.y, s.vz);
      victim.root.updateMatrixWorld(true);
      hips.push(rider.getWorldPosition(v).y);
      let lo = Infinity;
      // The rider only: the horse survives and bolts offstage, which is its job.
      rider.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const pos = o.geometry.attributes.position;
        for (let j = 0; j < pos.count; j++) {
          const y = v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld).y;
          if (y < lo) lo = y;
        }
      });
      lowest.push(lo);
    }
    victim.dispose();
    return { hips, lowest };
  };

  it('leaves the saddle, rises, and comes down onto the board', () => {
    const { hips } = sample();
    const seated = hips[0];
    const apex = Math.max(...hips);
    // Sampled at 1/60: index 54 is k = 0.9, well after the landing at 0.56 and
    // before the t=1 restore puts him back in the saddle for the next piece.
    const grounded = hips[54];
    expect(apex).toBeGreaterThan(seated + 0.1);
    expect(grounded).toBeLessThan(seated * 0.45);
    expect(grounded).toBeGreaterThan(0.1);
  });

  it('accelerates into the board instead of easing onto it', () => {
    const { hips } = sample();
    // Falling from the apex (k≈0.32, index 19) to the landing (k=0.56, i=34).
    const early = hips[22] - hips[24];
    const late = hips[32] - hips[34];
    expect(late).toBeGreaterThan(early * 1.5);
  });

  it('never passes through the board on the way down or after', () => {
    const { lowest } = sample();
    for (let i = 1; i < lowest.length - 1; i++) {
      expect(lowest[i]).toBeGreaterThan(-0.005);
    }
  });
});
