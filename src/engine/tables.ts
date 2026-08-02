/**
 * Precomputed attack tables over paired-u32 bitboards.
 * lo covers squares 0..31 (a1..h4), hi covers 32..63 (a5..h8).
 */

export const KNIGHT_LO = new Int32Array(64);
export const KNIGHT_HI = new Int32Array(64);
export const KING_LO = new Int32Array(64);
export const KING_HI = new Int32Array(64);
/** color*64+sq → squares attacked by a pawn of that color standing on sq (0 = white). */
export const PAWN_ATT_LO = new Int32Array(128);
export const PAWN_ATT_HI = new Int32Array(128);
/** dir*64+sq. Directions: 0 N, 1 E, 2 S, 3 W, 4 NE, 5 NW, 6 SE, 7 SW. */
export const RAY_LO = new Int32Array(512);
export const RAY_HI = new Int32Array(512);
/** a*64+b → squares strictly between aligned a and b (0 when unaligned). */
export const BETWEEN_LO = new Int32Array(4096);
export const BETWEEN_HI = new Int32Array(4096);
/** a*64+b → full edge-to-edge line through aligned a and b (0 when unaligned). */
export const LINE_LO = new Int32Array(4096);
export const LINE_HI = new Int32Array(4096);
/** Castling-rights bits (1 WK, 2 WQ, 4 BK, 8 BQ) that survive a move touching sq. */
export const CASTLE_MASK = new Int32Array(64).fill(15);

export function popcnt32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

export const popcnt = (lo: number, hi: number): number => popcnt32(lo) + popcnt32(hi);

/** Index of least-significant set bit of a nonzero 32-bit word. */
export const ctz32 = (x: number): number => 31 - Math.clz32(x & -x);

/** Least-significant set square of a nonzero pair. */
export const lsb = (lo: number, hi: number): number =>
  lo !== 0 ? ctz32(lo) : 32 + ctz32(hi);

/** 1 when sq is set in the pair, else 0. */
export const hasBit = (lo: number, hi: number, sq: number): number =>
  sq < 32 ? (lo >>> sq) & 1 : (hi >>> (sq - 32)) & 1;

const DF = [0, 1, 0, -1, 1, -1, 1, -1];
const DR = [1, 0, -1, 0, 1, 1, -1, -1];
const OPP = [2, 3, 0, 1, 7, 6, 5, 4];

function setBit(lo: Int32Array, hi: Int32Array, idx: number, sq: number): void {
  if (sq < 32) lo[idx] |= 1 << sq;
  else hi[idx] |= 1 << (sq - 32);
}

for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7;
  const r = sq >> 3;

  for (const [df, dr] of [
    [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
  ]) {
    const nf = f + df;
    const nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8)
      setBit(KNIGHT_LO, KNIGHT_HI, sq, nr * 8 + nf);
  }

  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8)
        setBit(KING_LO, KING_HI, sq, nr * 8 + nf);
    }

  for (const df of [-1, 1]) {
    const nf = f + df;
    if (nf < 0 || nf > 7) continue;
    if (r + 1 < 8) setBit(PAWN_ATT_LO, PAWN_ATT_HI, sq, (r + 1) * 8 + nf);
    if (r - 1 >= 0) setBit(PAWN_ATT_LO, PAWN_ATT_HI, 64 + sq, (r - 1) * 8 + nf);
  }

  for (let d = 0; d < 8; d++) {
    let nf = f + DF[d];
    let nr = r + DR[d];
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      setBit(RAY_LO, RAY_HI, d * 64 + sq, nr * 8 + nf);
      nf += DF[d];
      nr += DR[d];
    }
  }
}

for (let a = 0; a < 64; a++) {
  for (let d = 0; d < 8; d++) {
    let btwLo = 0;
    let btwHi = 0;
    let nf = (a & 7) + DF[d];
    let nr = (a >> 3) + DR[d];
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      const b = nr * 8 + nf;
      BETWEEN_LO[a * 64 + b] = btwLo;
      BETWEEN_HI[a * 64 + b] = btwHi;
      LINE_LO[a * 64 + b] =
        RAY_LO[d * 64 + a] | RAY_LO[OPP[d] * 64 + a] | (a < 32 ? 1 << a : 0);
      LINE_HI[a * 64 + b] =
        RAY_HI[d * 64 + a] | RAY_HI[OPP[d] * 64 + a] | (a < 32 ? 0 : 1 << (a - 32));
      if (b < 32) btwLo |= 1 << b;
      else btwHi |= 1 << (b - 32);
      nf += DF[d];
      nr += DR[d];
    }
  }
}

CASTLE_MASK[0] = 15 ^ 2;
CASTLE_MASK[4] = 15 ^ 3;
CASTLE_MASK[7] = 15 ^ 1;
CASTLE_MASK[56] = 15 ^ 8;
CASTLE_MASK[60] = 15 ^ 12;
CASTLE_MASK[63] = 15 ^ 4;
