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
import { PIECE_CHARACTER, type PieceType } from '../src/core/contract.ts';
import { isCueName } from '../src/audio/cues.ts';
import { mulberry32 } from '../src/core/prng.ts';
import { buildCharacter } from '../src/chars/index.ts';
import type { CharacterRig, DuelContext, DuelScript } from '../src/core/stage.ts';
import { CELL_KEYS, DUEL_MATRIX, validateMatrix } from '../src/duels/index.ts';

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
