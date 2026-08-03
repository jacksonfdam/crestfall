/**
 * Public surface of src/duels: the assembled 35-cell duel matrix, the
 * deterministic variant picker, the director, and the 2D vignette.
 *
 * Row modules are owned by the per-character choreography agents. Cell keys
 * are `${attackerPiece}x${victimPiece}` ('pxp', 'qxk', …); every cell ships
 * at least two variants ([A, B, …]) and 'kxk' does not exist.
 */

import type { PieceType } from '../core/contract.ts';
import { duelVariant } from '../core/contract.ts';
import type { DuelMatrix, DuelScript } from '../core/stage.ts';
import { BERSERKR_ROW } from './rows/berserkr.ts';
import { HUSCARL_ROW } from './rows/huscarl.ts';
import { JARL_ROW } from './rows/jarl.ts';
import { JOTUNN_ROW } from './rows/jotunnRow.ts';
import { VALKYRIE_ROW } from './rows/valkyrie.ts';
import { VOLVA_ROW } from './rows/volva.ts';

export { DuelDirector } from './director.ts';
export type {
  DuelDirectorDeps,
  DuelHandle,
  DuelPlayOptions,
} from './director.ts';
export { VIGNETTE_2D } from './vignette2d.ts';

export const DUEL_MATRIX: DuelMatrix = {
  ...HUSCARL_ROW,
  ...BERSERKR_ROW,
  ...VOLVA_ROW,
  ...JOTUNN_ROW,
  ...VALKYRIE_ROW,
  ...JARL_ROW,
};

const PIECES: readonly PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];

/** The 35 mandatory cell keys (6×6 minus kxk). */
export const CELL_KEYS: readonly string[] = PIECES.flatMap((a) =>
  PIECES.filter((v) => !(a === 'k' && v === 'k')).map((v) => `${a}x${v}`),
);

/**
 * Deterministically pick the duel for a capture. Same seed + move sequence =
 * byte-identical choreography. Returns undefined only for a missing cell
 * (a validateMatrix() failure); callers may fall back to skipping the duel.
 */
export function pickDuel(
  seed: number,
  moveIndex: number,
  attacker: PieceType,
  victim: PieceType,
): DuelScript | undefined {
  const variants = DUEL_MATRIX[`${attacker}x${victim}`];
  if (!variants || variants.length === 0) return undefined;
  return variants[duelVariant(seed, moveIndex, attacker, victim, variants.length)];
}

/**
 * Matrix health check for the critic and tests: every one of the 35 cells
 * present, ≥2 variants each, every duration in (0, 4]. Returns a list of
 * problems; empty means the matrix is shippable.
 */
export function validateMatrix(): string[] {
  const problems: string[] = [];
  for (const key of CELL_KEYS) {
    const variants = DUEL_MATRIX[key];
    if (!variants || variants.length === 0) {
      problems.push(`missing cell ${key}`);
      continue;
    }
    if (variants.length < 2) {
      problems.push(`cell ${key} has ${variants.length} variant, needs >= 2`);
    }
    for (let i = 0; i < variants.length; i++) {
      const d = variants[i].duration;
      if (!Number.isFinite(d) || d <= 0) {
        problems.push(`cell ${key} variant ${i} has invalid duration ${d}`);
      } else if (d > 4) {
        problems.push(`cell ${key} variant ${i} duration ${d}s exceeds 4s cap`);
      }
    }
  }
  for (const key of Object.keys(DUEL_MATRIX)) {
    if (!CELL_KEYS.includes(key)) problems.push(`unexpected cell key ${key}`);
  }
  return problems;
}
