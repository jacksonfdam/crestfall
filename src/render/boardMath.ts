/**
 * FROZEN board-space mapping. One square = 1 world unit, board centered on
 * the origin, white (rank 1) on the +z side so a1 sits near-left from the
 * default three-quarter camera.
 */

import type { Square } from '../core/contract.ts';

export function squareToWorld(sq: Square): [number, number, number] {
  return [(sq & 7) - 3.5, 0, 3.5 - (sq >> 3)];
}

/** Inverse of squareToWorld (nearest square). Returns -1 when off the board. */
export function worldToSquare(world: [number, number, number]): Square {
  const file = Math.round(world[0] + 3.5);
  const rank = Math.round(3.5 - world[2]);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
  return rank * 8 + file;
}
