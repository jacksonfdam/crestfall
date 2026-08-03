/**
 * Static evaluation, written from first principles for CRESTFALL.
 * White-POV centipawns, tapered between midgame and endgame by phase.
 *
 * Terms: material, piece-square tables (own tables, mg/eg king split),
 * mobility, pawn structure (doubled / isolated / passed), king safety
 * (pawn shield + open files near the king), bishop pair, tempo, and a
 * mop-up term so lopsided endings drive the defending king to a corner.
 */

import type { Position } from '../engine/index.ts';

// ── Material ────────────────────────────────────────────────────────────────
// type index: 0 p, 1 n, 2 b, 3 r, 4 q, 5 k

const VAL_MG = [86, 322, 338, 486, 970, 0];
const VAL_EG = [102, 300, 320, 528, 950, 0];
/** For mop-up / king-safety decisions, endgame-ish flat values. */
const VAL_SIMPLE = [100, 310, 330, 520, 950, 0];

const PHASE_W = [0, 1, 1, 2, 4, 0];
const PHASE_TOTAL = 24;

// ── Piece-square tables ─────────────────────────────────────────────────────
// Written as board diagrams (rank 8 row first) for readability, flipped to
// a1-indexed at module init. Black mirrors with sq ^ 56.

function pst(rows: number[]): Int16Array {
  const t = new Int16Array(64);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) t[(7 - r) * 8 + f] = rows[r * 8 + f];
  }
  return t;
}

const PAWN_MG = pst([
  0, 0, 0, 0, 0, 0, 0, 0,
  62, 64, 60, 58, 58, 60, 64, 62,
  18, 24, 32, 40, 40, 32, 24, 18,
  8, 12, 20, 30, 30, 20, 12, 8,
  4, 6, 12, 26, 26, 12, 6, 4,
  4, 0, 6, 10, 10, 6, 0, 4,
  6, 8, 4, -10, -10, 4, 8, 6,
  0, 0, 0, 0, 0, 0, 0, 0,
]);

const PAWN_EG = pst([
  0, 0, 0, 0, 0, 0, 0, 0,
  96, 92, 88, 84, 84, 88, 92, 96,
  56, 52, 48, 44, 44, 48, 52, 56,
  32, 29, 26, 24, 24, 26, 29, 32,
  18, 16, 13, 11, 11, 13, 16, 18,
  8, 7, 6, 4, 4, 6, 7, 8,
  6, 5, 4, 2, 2, 4, 5, 6,
  0, 0, 0, 0, 0, 0, 0, 0,
]);

const KNIGHT_MG = pst([
  -52, -36, -26, -20, -20, -26, -36, -52,
  -36, -16, 0, 5, 5, 0, -16, -36,
  -26, 5, 13, 18, 18, 13, 5, -26,
  -20, 8, 18, 25, 25, 18, 8, -20,
  -20, 8, 18, 25, 25, 18, 8, -20,
  -26, 5, 13, 18, 18, 13, 5, -26,
  -36, -16, 0, 5, 5, 0, -16, -36,
  -52, -36, -26, -20, -20, -26, -36, -52,
]);

const KNIGHT_EG = pst([
  -44, -30, -20, -15, -15, -20, -30, -44,
  -30, -12, 0, 4, 4, 0, -12, -30,
  -20, 0, 10, 15, 15, 10, 0, -20,
  -15, 4, 15, 20, 20, 15, 4, -15,
  -15, 4, 15, 20, 20, 15, 4, -15,
  -20, 0, 10, 15, 15, 10, 0, -20,
  -30, -12, 0, 4, 4, 0, -12, -30,
  -44, -30, -20, -15, -15, -20, -30, -44,
]);

const BISHOP_MG = pst([
  -18, -10, -10, -10, -10, -10, -10, -18,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 6, 10, 10, 6, 0, -10,
  -10, 6, 10, 14, 14, 10, 6, -10,
  -10, 4, 12, 14, 14, 12, 4, -10,
  -10, 8, 10, 12, 12, 10, 8, -10,
  -10, 10, 4, 6, 6, 4, 10, -10,
  -18, -8, -12, -10, -10, -12, -8, -18,
]);

const BISHOP_EG = pst([
  -14, -8, -6, -4, -4, -6, -8, -14,
  -8, -2, 0, 2, 2, 0, -2, -8,
  -6, 0, 5, 8, 8, 5, 0, -6,
  -4, 2, 8, 12, 12, 8, 2, -4,
  -4, 2, 8, 12, 12, 8, 2, -4,
  -6, 0, 5, 8, 8, 5, 0, -6,
  -8, -2, 0, 2, 2, 0, -2, -8,
  -14, -8, -6, -4, -4, -6, -8, -14,
]);

const ROOK_MG = pst([
  6, 8, 10, 12, 12, 10, 8, 6,
  12, 16, 18, 20, 20, 18, 16, 12,
  -2, 0, 4, 6, 6, 4, 0, -2,
  -4, -2, 2, 4, 4, 2, -2, -4,
  -4, -2, 2, 4, 4, 2, -2, -4,
  -4, -2, 2, 4, 4, 2, -2, -4,
  -6, -4, 0, 2, 2, 0, -4, -6,
  -6, -4, 4, 10, 10, 4, -4, -6,
]);

const ROOK_EG = pst([
  6, 6, 6, 6, 6, 6, 6, 6,
  10, 10, 10, 10, 10, 10, 10, 10,
  2, 2, 2, 2, 2, 2, 2, 2,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  -2, -2, -2, -2, -2, -2, -2, -2,
  -4, -2, 0, 2, 2, 0, -2, -4,
]);

const QUEEN_MG = pst([
  -12, -6, -4, -2, -2, -4, -6, -12,
  -6, 0, 2, 4, 4, 2, 0, -6,
  -4, 2, 6, 8, 8, 6, 2, -4,
  -2, 4, 8, 10, 10, 8, 4, -2,
  -2, 4, 8, 10, 10, 8, 4, -2,
  -6, 2, 6, 8, 8, 6, 2, -6,
  -8, -2, 4, 4, 4, 2, -2, -8,
  -12, -8, -6, 2, -4, -8, -8, -12,
]);

const QUEEN_EG = pst([
  -16, -8, -4, 0, 0, -4, -8, -16,
  -8, 0, 6, 10, 10, 6, 0, -8,
  -4, 6, 12, 16, 16, 12, 6, -4,
  0, 10, 16, 22, 22, 16, 10, 0,
  0, 10, 16, 22, 22, 16, 10, 0,
  -4, 6, 12, 16, 16, 12, 6, -4,
  -8, 0, 6, 10, 10, 6, 0, -8,
  -16, -8, -4, 0, 0, -4, -8, -16,
]);

const KING_MG = pst([
  -66, -66, -66, -70, -70, -66, -66, -66,
  -60, -60, -62, -66, -66, -62, -60, -60,
  -52, -54, -56, -60, -60, -56, -54, -52,
  -44, -46, -50, -54, -54, -50, -46, -44,
  -34, -38, -42, -48, -48, -42, -38, -34,
  -24, -28, -34, -40, -40, -34, -28, -24,
  -8, -10, -20, -30, -30, -20, -10, -8,
  14, 24, 6, -14, -8, -2, 26, 16,
]);

const KING_EG = pst([
  -42, -26, -16, -10, -10, -16, -26, -42,
  -26, -10, 2, 8, 8, 2, -10, -26,
  -16, 2, 14, 22, 22, 14, 2, -16,
  -10, 8, 22, 30, 30, 22, 8, -10,
  -10, 8, 22, 30, 30, 22, 8, -10,
  -16, 2, 14, 22, 22, 14, 2, -16,
  -26, -10, 2, 8, 8, 2, -10, -26,
  -42, -26, -16, -10, -10, -16, -26, -42,
]);

const PST_MG = [PAWN_MG, KNIGHT_MG, BISHOP_MG, ROOK_MG, QUEEN_MG, KING_MG];
const PST_EG = [PAWN_EG, KNIGHT_EG, BISHOP_EG, ROOK_EG, QUEEN_EG, KING_EG];

// ── Pawn structure weights ──────────────────────────────────────────────────

const DOUBLED_MG = 10;
const DOUBLED_EG = 18;
const ISOLATED_MG = 13;
const ISOLATED_EG = 9;
/** Passed pawn bonus indexed by rank from the pawn's own side. */
const PASSED_MG = [0, 4, 8, 14, 24, 42, 66, 0];
const PASSED_EG = [0, 14, 22, 34, 56, 88, 130, 0];

// ── Mobility ────────────────────────────────────────────────────────────────

const KNIGHT_TARGETS: number[][] = [];
{
  const jumps = [
    [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
  ];
  for (let sq = 0; sq < 64; sq++) {
    const f = sq & 7;
    const r = sq >> 3;
    const out: number[] = [];
    for (const [df, dr] of jumps) {
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(nr * 8 + nf);
    }
    KNIGHT_TARGETS.push(out);
  }
}

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

// ── Scratch (module-level, reset per call — eval allocates nothing) ─────────

const wFileCount = new Int32Array(8);
const bFileCount = new Int32Array(8);
/** Highest black pawn rank per file (-1 if none) — blocks white passers. */
const bMaxRank = new Int32Array(8);
/** Lowest white pawn rank per file (8 if none) — blocks black passers. */
const wMinRank = new Int32Array(8);
const wPawnSq = new Int32Array(8);
const bPawnSq = new Int32Array(8);

function sliderMobility(
  board: Int8Array,
  sq: number,
  color: number,
  dirs: readonly (readonly [number, number])[],
): number {
  let count = 0;
  const f0 = sq & 7;
  const r0 = sq >> 3;
  for (const [df, dr] of dirs) {
    let f = f0 + df;
    let r = r0 + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const pc = board[r * 8 + f];
      if (pc < 0) {
        count++;
      } else {
        if ((pc > 5 ? 1 : 0) !== color) count++;
        break;
      }
      f += df;
      r += dr;
    }
  }
  return count;
}

const centerDist = (sq: number): number => {
  const f = sq & 7;
  const r = sq >> 3;
  const df = f > 3 ? f - 4 : 3 - f;
  const dr = r > 3 ? r - 4 : 3 - r;
  return df + dr; // 0 (center) .. 6 (corner)
};

const kingDist = (a: number, b: number): number => {
  const df = Math.abs((a & 7) - (b & 7));
  const dr = Math.abs((a >> 3) - (b >> 3));
  return df + dr;
};

/** Static evaluation of `pos`, white POV, centipawns. */
export function evaluate(pos: Position): number {
  const board = pos.board;
  let mg = 0;
  let eg = 0;
  let phase = 0;
  let wKing = 0;
  let bKing = 0;
  let wBishops = 0;
  let bBishops = 0;
  let wQueens = 0;
  let bQueens = 0;
  let wPawnN = 0;
  let bPawnN = 0;
  let wNpm = 0; // non-pawn, non-king material (simple values)
  let bNpm = 0;

  wFileCount.fill(0);
  bFileCount.fill(0);
  bMaxRank.fill(-1);
  wMinRank.fill(8);

  for (let sq = 0; sq < 64; sq++) {
    const pc = board[sq];
    if (pc < 0) continue;
    const color = pc > 5 ? 1 : 0;
    const t = pc % 6;
    const sign = color === 0 ? 1 : -1;
    const psq = color === 0 ? sq : sq ^ 56;
    mg += sign * (VAL_MG[t] + PST_MG[t][psq]);
    eg += sign * (VAL_EG[t] + PST_EG[t][psq]);
    phase += PHASE_W[t];

    switch (t) {
      case 0: {
        const f = sq & 7;
        const r = sq >> 3;
        if (color === 0) {
          wFileCount[f]++;
          if (r < wMinRank[f]) wMinRank[f] = r;
          wPawnSq[wPawnN++] = sq;
        } else {
          bFileCount[f]++;
          if (r > bMaxRank[f]) bMaxRank[f] = r;
          bPawnSq[bPawnN++] = sq;
        }
        break;
      }
      case 1: {
        let mob = 0;
        for (const to of KNIGHT_TARGETS[sq]) {
          const occ = board[to];
          if (occ < 0 || (occ > 5 ? 1 : 0) !== color) mob++;
        }
        mg += sign * 4 * (mob - 4);
        eg += sign * 4 * (mob - 4);
        wNpm += color === 0 ? VAL_SIMPLE[1] : 0;
        bNpm += color === 1 ? VAL_SIMPLE[1] : 0;
        break;
      }
      case 2: {
        const mob = sliderMobility(board, sq, color, BISHOP_DIRS);
        mg += sign * 3 * (mob - 6);
        eg += sign * 3 * (mob - 6);
        if (color === 0) {
          wBishops++;
          wNpm += VAL_SIMPLE[2];
        } else {
          bBishops++;
          bNpm += VAL_SIMPLE[2];
        }
        break;
      }
      case 3: {
        const mob = sliderMobility(board, sq, color, ROOK_DIRS);
        mg += sign * 2 * (mob - 7);
        eg += sign * 4 * (mob - 7);
        wNpm += color === 0 ? VAL_SIMPLE[3] : 0;
        bNpm += color === 1 ? VAL_SIMPLE[3] : 0;
        break;
      }
      case 4: {
        const mob =
          sliderMobility(board, sq, color, ROOK_DIRS) +
          sliderMobility(board, sq, color, BISHOP_DIRS);
        mg += sign * (mob - 13);
        eg += sign * 2 * (mob - 13);
        if (color === 0) {
          wQueens++;
          wNpm += VAL_SIMPLE[4];
        } else {
          bQueens++;
          bNpm += VAL_SIMPLE[4];
        }
        break;
      }
      default:
        if (color === 0) wKing = sq;
        else bKing = sq;
        break;
    }
  }

  // Bishop pair.
  if (wBishops >= 2) {
    mg += 30;
    eg += 42;
  }
  if (bBishops >= 2) {
    mg -= 30;
    eg -= 42;
  }

  // Pawn structure per file: doubled + isolated.
  for (let f = 0; f < 8; f++) {
    const wc = wFileCount[f];
    const bc = bFileCount[f];
    if (wc > 1) {
      mg -= (wc - 1) * DOUBLED_MG;
      eg -= (wc - 1) * DOUBLED_EG;
    }
    if (bc > 1) {
      mg += (bc - 1) * DOUBLED_MG;
      eg += (bc - 1) * DOUBLED_EG;
    }
    const wNeighbors =
      (f > 0 ? wFileCount[f - 1] : 0) + (f < 7 ? wFileCount[f + 1] : 0);
    const bNeighbors =
      (f > 0 ? bFileCount[f - 1] : 0) + (f < 7 ? bFileCount[f + 1] : 0);
    if (wc > 0 && wNeighbors === 0) {
      mg -= wc * ISOLATED_MG;
      eg -= wc * ISOLATED_EG;
    }
    if (bc > 0 && bNeighbors === 0) {
      mg += bc * ISOLATED_MG;
      eg += bc * ISOLATED_EG;
    }
  }

  // Passed pawns.
  for (let i = 0; i < wPawnN; i++) {
    const sq = wPawnSq[i];
    const f = sq & 7;
    const r = sq >> 3;
    let passed = bMaxRank[f] <= r;
    if (passed && f > 0 && bMaxRank[f - 1] > r) passed = false;
    if (passed && f < 7 && bMaxRank[f + 1] > r) passed = false;
    if (passed) {
      mg += PASSED_MG[r];
      eg += PASSED_EG[r];
    }
  }
  for (let i = 0; i < bPawnN; i++) {
    const sq = bPawnSq[i];
    const f = sq & 7;
    const r = sq >> 3;
    const rr = 7 - r; // rank from black's side
    let passed = wMinRank[f] >= r;
    if (passed && f > 0 && wMinRank[f - 1] < r) passed = false;
    if (passed && f < 7 && wMinRank[f + 1] < r) passed = false;
    if (passed) {
      mg -= PASSED_MG[rr];
      eg -= PASSED_EG[rr];
    }
  }

  // King safety (midgame): pawn shield + open files near the king.
  // Scaled down when the enemy queen is off the board.
  {
    const wScale = bQueens > 0 ? 2 : 1;
    const bScale = wQueens > 0 ? 2 : 1;
    mg += (kingShelter(board, wKing, 0) * wScale) >> 1;
    mg -= (kingShelter(board, bKing, 1) * bScale) >> 1;
  }

  // Tempo.
  if (pos.stm === 0) {
    mg += 12;
    eg += 6;
  } else {
    mg -= 12;
    eg -= 6;
  }

  // Mop-up: with a decisive material edge, drive the bare king to a corner
  // and bring our king up — makes shallow searches finish won endings.
  {
    const wMat = wNpm + wPawnN * 100;
    const bMat = bNpm + bPawnN * 100;
    if (wMat - bMat >= 450 && bNpm <= 340) {
      eg += 8 * centerDist(bKing) + 3 * (14 - kingDist(wKing, bKing));
    } else if (bMat - wMat >= 450 && wNpm <= 340) {
      eg -= 8 * centerDist(wKing) + 3 * (14 - kingDist(wKing, bKing));
    }
  }

  const p = phase > PHASE_TOTAL ? PHASE_TOTAL : phase;
  return ((mg * p + eg * (PHASE_TOTAL - p)) / PHASE_TOTAL) | 0;
}

/** Positive = safe. Shield pawns ahead of a back-rank king; open-file risk. */
function kingShelter(board: Int8Array, kSq: number, color: number): number {
  const kr = kSq >> 3;
  const kf = kSq & 7;
  const homeSide = color === 0 ? kr <= 1 : kr >= 6;
  if (!homeSide) return -14; // wandering king in the midgame
  const ownPawn = color * 6;
  const step = color === 0 ? 8 : -8;
  let score = 0;
  for (let f = kf - 1; f <= kf + 1; f++) {
    if (f < 0 || f > 7) continue;
    const base = kr * 8 + f;
    const one = base + step;
    const two = base + step * 2;
    if (one >= 0 && one < 64 && board[one] === ownPawn) {
      score += 14;
    } else if (two >= 0 && two < 64 && board[two] === ownPawn) {
      score += 7;
    } else {
      score -= 12;
    }
    // Fully open file next to the king is dangerous.
    let anyOwn = false;
    for (let r = 0; r < 8; r++) {
      if (board[r * 8 + f] === ownPawn) {
        anyOwn = true;
        break;
      }
    }
    if (!anyOwn) score -= 8;
  }
  return score;
}
