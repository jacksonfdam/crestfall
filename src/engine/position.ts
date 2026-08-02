/**
 * Bitboard position, legal move generation, make/unmake, zobrist hashing.
 * Bitboards are paired 32-bit words (lo = squares 0..31, hi = 32..63) —
 * roughly 3-5x faster than BigInt in current JS engines.
 */

import { mulberry32 } from '../core/prng.ts';
import type { Color, GameStatus, PieceType } from '../core/contract.ts';
import { squareIndex, squareName } from '../core/contract.ts';
import {
  BETWEEN_HI, BETWEEN_LO, CASTLE_MASK, KING_HI, KING_LO, KNIGHT_HI, KNIGHT_LO,
  LINE_HI, LINE_LO, PAWN_ATT_HI, PAWN_ATT_LO, RAY_HI, RAY_LO,
  ctz32, hasBit, lsb, popcnt,
} from './tables.ts';

// ── Move encoding ───────────────────────────────────────────────────────────
// bits 0-5 from, 6-11 to, 12-15 flags. Promotion flags carry the piece in
// their low two bits (0 N, 1 B, 2 R, 3 Q).

export type EngineMove = number;

export const FLAG_QUIET = 0;
export const FLAG_DPUSH = 1;
export const FLAG_CASTLE_K = 2;
export const FLAG_CASTLE_Q = 3;
export const FLAG_CAPTURE = 4;
export const FLAG_EP = 5;
export const FLAG_PROMO = 8;

export const TYPE_CH = 'pnbrqk';
const PROMO_CH = 'nbrq';

export const moveFrom = (m: EngineMove): number => m & 63;
export const moveTo = (m: EngineMove): number => (m >>> 6) & 63;
export const moveFlags = (m: EngineMove): number => (m >>> 12) & 15;
export const moveIsCapture = (m: EngineMove): boolean => ((m >>> 12) & 4) !== 0;
export const moveIsPromotion = (m: EngineMove): boolean => ((m >>> 12) & 8) !== 0;
export const movePromotion = (m: EngineMove): PieceType | undefined =>
  ((m >>> 12) & 8) !== 0 ? (PROMO_CH[(m >>> 12) & 3] as PieceType) : undefined;

export interface DecodedMove {
  from: number;
  to: number;
  flags: number;
  promotion?: PieceType;
}

export function decodeMove(m: EngineMove): DecodedMove {
  const d: DecodedMove = { from: m & 63, to: (m >>> 6) & 63, flags: (m >>> 12) & 15 };
  const promo = movePromotion(m);
  if (promo) d.promotion = promo;
  return d;
}

// ── Zobrist keys (deterministically seeded — no Math.random) ────────────────

const zr = mulberry32(0x9e3779b9);
const zw = (): number => (zr() * 4294967296) | 0;
const Z_PIECE_LO = new Int32Array(768);
const Z_PIECE_HI = new Int32Array(768);
for (let i = 0; i < 768; i++) {
  Z_PIECE_LO[i] = zw();
  Z_PIECE_HI[i] = zw();
}
const Z_CASTLE_LO = new Int32Array(16);
const Z_CASTLE_HI = new Int32Array(16);
for (let i = 0; i < 16; i++) {
  Z_CASTLE_LO[i] = zw();
  Z_CASTLE_HI[i] = zw();
}
const Z_EP_LO = new Int32Array(8);
const Z_EP_HI = new Int32Array(8);
for (let i = 0; i < 8; i++) {
  Z_EP_LO[i] = zw();
  Z_EP_HI[i] = zw();
}
const Z_SIDE_LO = zw();
const Z_SIDE_HI = zw();

// ── Position ────────────────────────────────────────────────────────────────
// Piece codes: color*6 + type, type 0..5 = p n b r q k. Empty = -1.

export const INITIAL_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class Position {
  board = new Int8Array(64).fill(-1);
  pLo = new Int32Array(12);
  pHi = new Int32Array(12);
  cLo = new Int32Array(2);
  cHi = new Int32Array(2);
  stm = 0;
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  hashLo = 0;
  hashHi = 0;
  /** Zobrist keys of prior positions since the last irreversible move. */
  repLo: number[] = [];
  repHi: number[] = [];
  private undo = new Int32Array(64 * 8);
  private undoTop = 0;

  get turn(): Color {
    return this.stm === 0 ? 'w' : 'b';
  }

  clone(): Position {
    const q = new Position();
    q.board.set(this.board);
    q.pLo.set(this.pLo);
    q.pHi.set(this.pHi);
    q.cLo.set(this.cLo);
    q.cHi.set(this.cHi);
    q.stm = this.stm;
    q.castling = this.castling;
    q.ep = this.ep;
    q.halfmove = this.halfmove;
    q.fullmove = this.fullmove;
    q.hashLo = this.hashLo;
    q.hashHi = this.hashHi;
    q.repLo = this.repLo.slice();
    q.repHi = this.repHi.slice();
    return q;
  }

  addPiece(pc: number, sq: number): void {
    this.board[sq] = pc;
    const c = pc > 5 ? 1 : 0;
    if (sq < 32) {
      const b = 1 << sq;
      this.pLo[pc] |= b;
      this.cLo[c] |= b;
    } else {
      const b = 1 << (sq - 32);
      this.pHi[pc] |= b;
      this.cHi[c] |= b;
    }
  }

  private removePiece(pc: number, sq: number): void {
    this.board[sq] = -1;
    const c = pc > 5 ? 1 : 0;
    if (sq < 32) {
      const b = ~(1 << sq);
      this.pLo[pc] &= b;
      this.cLo[c] &= b;
    } else {
      const b = ~(1 << (sq - 32));
      this.pHi[pc] &= b;
      this.cHi[c] &= b;
    }
  }

  private epRelevant(): boolean {
    if (this.ep < 0) return false;
    const idx = (this.stm ^ 1) * 64 + this.ep;
    const pawn = this.stm * 6;
    return (
      ((PAWN_ATT_LO[idx] & this.pLo[pawn]) | (PAWN_ATT_HI[idx] & this.pHi[pawn])) !== 0
    );
  }

  computeHash(): void {
    let lo = 0;
    let hi = 0;
    for (let sq = 0; sq < 64; sq++) {
      const pc = this.board[sq];
      if (pc >= 0) {
        lo ^= Z_PIECE_LO[pc * 64 + sq];
        hi ^= Z_PIECE_HI[pc * 64 + sq];
      }
    }
    lo ^= Z_CASTLE_LO[this.castling];
    hi ^= Z_CASTLE_HI[this.castling];
    if (this.stm === 1) {
      lo ^= Z_SIDE_LO;
      hi ^= Z_SIDE_HI;
    }
    this.hashLo = lo;
    this.hashHi = hi;
    if (this.epRelevant()) {
      this.hashLo ^= Z_EP_LO[this.ep & 7];
      this.hashHi ^= Z_EP_HI[this.ep & 7];
    }
  }

  make(m: EngineMove): void {
    if (this.undoTop + 8 > this.undo.length) {
      const g = new Int32Array(this.undo.length * 2);
      g.set(this.undo);
      this.undo = g;
    }
    const u = this.undoTop;
    this.undoTop = u + 8;
    const un = this.undo;
    const from = m & 63;
    const to = (m >>> 6) & 63;
    const fl = (m >>> 12) & 15;
    const us = this.stm;
    const pc = this.board[from];
    let captured = -1;
    let capSq = to;
    if (fl === FLAG_EP) {
      capSq = us === 0 ? to - 8 : to + 8;
      captured = this.board[capSq];
    } else if ((fl & 4) !== 0) {
      captured = this.board[to];
    }
    un[u] = m;
    un[u + 1] = captured;
    un[u + 2] = this.castling;
    un[u + 3] = this.ep;
    un[u + 4] = this.halfmove;
    un[u + 5] = this.hashLo;
    un[u + 6] = this.hashHi;
    un[u + 7] = this.fullmove;

    if (this.epRelevant()) {
      this.hashLo ^= Z_EP_LO[this.ep & 7];
      this.hashHi ^= Z_EP_HI[this.ep & 7];
    }
    this.hashLo ^= Z_CASTLE_LO[this.castling];
    this.hashHi ^= Z_CASTLE_HI[this.castling];

    if (captured >= 0) {
      this.removePiece(captured, capSq);
      this.hashLo ^= Z_PIECE_LO[captured * 64 + capSq];
      this.hashHi ^= Z_PIECE_HI[captured * 64 + capSq];
    }
    this.removePiece(pc, from);
    this.hashLo ^= Z_PIECE_LO[pc * 64 + from];
    this.hashHi ^= Z_PIECE_HI[pc * 64 + from];
    if ((fl & 8) !== 0) {
      const promo = us * 6 + (fl & 3) + 1;
      this.addPiece(promo, to);
      this.hashLo ^= Z_PIECE_LO[promo * 64 + to];
      this.hashHi ^= Z_PIECE_HI[promo * 64 + to];
    } else {
      this.addPiece(pc, to);
      this.hashLo ^= Z_PIECE_LO[pc * 64 + to];
      this.hashHi ^= Z_PIECE_HI[pc * 64 + to];
    }
    if (fl === FLAG_CASTLE_K) {
      const rook = us * 6 + 3;
      this.removePiece(rook, to + 1);
      this.addPiece(rook, to - 1);
      this.hashLo ^= Z_PIECE_LO[rook * 64 + to + 1] ^ Z_PIECE_LO[rook * 64 + to - 1];
      this.hashHi ^= Z_PIECE_HI[rook * 64 + to + 1] ^ Z_PIECE_HI[rook * 64 + to - 1];
    } else if (fl === FLAG_CASTLE_Q) {
      const rook = us * 6 + 3;
      this.removePiece(rook, to - 2);
      this.addPiece(rook, to + 1);
      this.hashLo ^= Z_PIECE_LO[rook * 64 + to - 2] ^ Z_PIECE_LO[rook * 64 + to + 1];
      this.hashHi ^= Z_PIECE_HI[rook * 64 + to - 2] ^ Z_PIECE_HI[rook * 64 + to + 1];
    }

    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.hashLo ^= Z_CASTLE_LO[this.castling];
    this.hashHi ^= Z_CASTLE_HI[this.castling];

    this.ep = fl === FLAG_DPUSH ? (us === 0 ? from + 8 : from - 8) : -1;
    this.halfmove = pc === us * 6 || captured >= 0 ? 0 : this.halfmove + 1;
    if (us === 1) this.fullmove++;
    this.stm = us ^ 1;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    if (this.epRelevant()) {
      this.hashLo ^= Z_EP_LO[this.ep & 7];
      this.hashHi ^= Z_EP_HI[this.ep & 7];
    }
  }

  unmake(): void {
    const u = this.undoTop - 8;
    this.undoTop = u;
    const un = this.undo;
    const m = un[u];
    const captured = un[u + 1];
    const from = m & 63;
    const to = (m >>> 6) & 63;
    const fl = (m >>> 12) & 15;
    this.stm ^= 1;
    const us = this.stm;
    this.castling = un[u + 2];
    this.ep = un[u + 3];
    this.halfmove = un[u + 4];
    this.hashLo = un[u + 5];
    this.hashHi = un[u + 6];
    this.fullmove = un[u + 7];
    if ((fl & 8) !== 0) {
      this.removePiece(us * 6 + (fl & 3) + 1, to);
      this.addPiece(us * 6, from);
    } else {
      const pc = this.board[to];
      this.removePiece(pc, to);
      this.addPiece(pc, from);
    }
    if (fl === FLAG_CASTLE_K) {
      const rook = us * 6 + 3;
      this.removePiece(rook, to - 1);
      this.addPiece(rook, to + 1);
    } else if (fl === FLAG_CASTLE_Q) {
      const rook = us * 6 + 3;
      this.removePiece(rook, to + 1);
      this.addPiece(rook, to - 2);
    }
    if (captured >= 0) {
      this.addPiece(captured, fl === FLAG_EP ? (us === 0 ? to - 8 : to + 8) : to);
    }
  }
}

// ── Slider attacks (classical rays, module scratch to avoid allocation) ─────

let gLo = 0;
let gHi = 0;

function rookAtt(sq: number, oLo: number, oHi: number): void {
  let i = sq;
  let rLo = RAY_LO[i];
  let rHi = RAY_HI[i];
  let lo = rLo;
  let hi = rHi;
  let bLo = rLo & oLo;
  let bHi = rHi & oHi;
  let f = 0;
  if ((bLo | bHi) !== 0) {
    f = bLo !== 0 ? ctz32(bLo) : 32 + ctz32(bHi);
    lo ^= RAY_LO[f];
    hi ^= RAY_HI[f];
  }
  i = 64 + sq;
  rLo = RAY_LO[i];
  rHi = RAY_HI[i];
  lo |= rLo;
  hi |= rHi;
  bLo = rLo & oLo;
  bHi = rHi & oHi;
  if ((bLo | bHi) !== 0) {
    f = bLo !== 0 ? ctz32(bLo) : 32 + ctz32(bHi);
    lo ^= RAY_LO[64 + f];
    hi ^= RAY_HI[64 + f];
  }
  i = 128 + sq;
  rLo = RAY_LO[i];
  rHi = RAY_HI[i];
  lo |= rLo;
  hi |= rHi;
  bLo = rLo & oLo;
  bHi = rHi & oHi;
  if ((bLo | bHi) !== 0) {
    f = bHi !== 0 ? 63 - Math.clz32(bHi) : 31 - Math.clz32(bLo);
    lo ^= RAY_LO[128 + f];
    hi ^= RAY_HI[128 + f];
  }
  i = 192 + sq;
  rLo = RAY_LO[i];
  rHi = RAY_HI[i];
  lo |= rLo;
  hi |= rHi;
  bLo = rLo & oLo;
  bHi = rHi & oHi;
  if ((bLo | bHi) !== 0) {
    f = bHi !== 0 ? 63 - Math.clz32(bHi) : 31 - Math.clz32(bLo);
    lo ^= RAY_LO[192 + f];
    hi ^= RAY_HI[192 + f];
  }
  gLo = lo;
  gHi = hi;
}

function bishopAtt(sq: number, oLo: number, oHi: number): void {
  let i = 256 + sq;
  let rLo = RAY_LO[i];
  let rHi = RAY_HI[i];
  let lo = rLo;
  let hi = rHi;
  let bLo = rLo & oLo;
  let bHi = rHi & oHi;
  let f = 0;
  if ((bLo | bHi) !== 0) {
    f = bLo !== 0 ? ctz32(bLo) : 32 + ctz32(bHi);
    lo ^= RAY_LO[256 + f];
    hi ^= RAY_HI[256 + f];
  }
  i = 320 + sq;
  rLo = RAY_LO[i];
  rHi = RAY_HI[i];
  lo |= rLo;
  hi |= rHi;
  bLo = rLo & oLo;
  bHi = rHi & oHi;
  if ((bLo | bHi) !== 0) {
    f = bLo !== 0 ? ctz32(bLo) : 32 + ctz32(bHi);
    lo ^= RAY_LO[320 + f];
    hi ^= RAY_HI[320 + f];
  }
  i = 384 + sq;
  rLo = RAY_LO[i];
  rHi = RAY_HI[i];
  lo |= rLo;
  hi |= rHi;
  bLo = rLo & oLo;
  bHi = rHi & oHi;
  if ((bLo | bHi) !== 0) {
    f = bHi !== 0 ? 63 - Math.clz32(bHi) : 31 - Math.clz32(bLo);
    lo ^= RAY_LO[384 + f];
    hi ^= RAY_HI[384 + f];
  }
  i = 448 + sq;
  rLo = RAY_LO[i];
  rHi = RAY_HI[i];
  lo |= rLo;
  hi |= rHi;
  bLo = rLo & oLo;
  bHi = rHi & oHi;
  if ((bLo | bHi) !== 0) {
    f = bHi !== 0 ? 63 - Math.clz32(bHi) : 31 - Math.clz32(bLo);
    lo ^= RAY_LO[448 + f];
    hi ^= RAY_HI[448 + f];
  }
  gLo = lo;
  gHi = hi;
}

/** Is sq attacked by side byC, given occupancy (oLo, oHi)? */
export function attacked(
  p: Position,
  sq: number,
  byC: number,
  oLo: number,
  oHi: number,
): boolean {
  const b = byC * 6;
  const idx = (byC ^ 1) * 64 + sq;
  if (((PAWN_ATT_LO[idx] & p.pLo[b]) | (PAWN_ATT_HI[idx] & p.pHi[b])) !== 0) return true;
  if (((KNIGHT_LO[sq] & p.pLo[b + 1]) | (KNIGHT_HI[sq] & p.pHi[b + 1])) !== 0) return true;
  if (((KING_LO[sq] & p.pLo[b + 5]) | (KING_HI[sq] & p.pHi[b + 5])) !== 0) return true;
  bishopAtt(sq, oLo, oHi);
  if (
    ((gLo & (p.pLo[b + 2] | p.pLo[b + 4])) | (gHi & (p.pHi[b + 2] | p.pHi[b + 4]))) !== 0
  )
    return true;
  rookAtt(sq, oLo, oHi);
  return (
    ((gLo & (p.pLo[b + 3] | p.pLo[b + 4])) | (gHi & (p.pHi[b + 3] | p.pHi[b + 4]))) !== 0
  );
}

export function inCheck(p: Position): boolean {
  const k = p.stm * 6 + 5;
  const kSq = lsb(p.pLo[k], p.pHi[k]);
  return attacked(p, kSq, p.stm ^ 1, p.cLo[0] | p.cLo[1], p.cHi[0] | p.cHi[1]);
}

// ── Legal move generation ───────────────────────────────────────────────────

export const MOVE_BUF = new Int32Array(256 * 64);

function epLegal(p: Position, from: number, kSq: number, occLo: number, occHi: number): boolean {
  const us = p.stm;
  const eb = (us ^ 1) * 6;
  const to = p.ep;
  const vic = us === 0 ? to - 8 : to + 8;
  let oLo = occLo;
  let oHi = occHi;
  if (from < 32) oLo &= ~(1 << from);
  else oHi &= ~(1 << (from - 32));
  if (vic < 32) oLo &= ~(1 << vic);
  else oHi &= ~(1 << (vic - 32));
  if (to < 32) oLo |= 1 << to;
  else oHi |= 1 << (to - 32);
  let epLo = p.pLo[eb];
  let epHi = p.pHi[eb];
  if (vic < 32) epLo &= ~(1 << vic);
  else epHi &= ~(1 << (vic - 32));
  const idx = us * 64 + kSq;
  if (((PAWN_ATT_LO[idx] & epLo) | (PAWN_ATT_HI[idx] & epHi)) !== 0) return false;
  if (((KNIGHT_LO[kSq] & p.pLo[eb + 1]) | (KNIGHT_HI[kSq] & p.pHi[eb + 1])) !== 0)
    return false;
  bishopAtt(kSq, oLo, oHi);
  if (
    ((gLo & (p.pLo[eb + 2] | p.pLo[eb + 4])) | (gHi & (p.pHi[eb + 2] | p.pHi[eb + 4]))) !== 0
  )
    return false;
  rookAtt(kSq, oLo, oHi);
  return (
    ((gLo & (p.pLo[eb + 3] | p.pLo[eb + 4])) | (gHi & (p.pHi[eb + 3] | p.pHi[eb + 4]))) === 0
  );
}

/** Fills MOVE_BUF starting at `first`; returns the number of legal moves. */
export function generateMoves(p: Position, first: number): number {
  const us = p.stm;
  const them = us ^ 1;
  const base = us * 6;
  const eBase = them * 6;
  const occLo = p.cLo[0] | p.cLo[1];
  const occHi = p.cHi[0] | p.cHi[1];
  const ownLo = p.cLo[us];
  const ownHi = p.cHi[us];
  const enLo = p.cLo[them];
  const enHi = p.cHi[them];
  const kSq = lsb(p.pLo[base + 5], p.pHi[base + 5]);
  let n = first;

  const kbLo = kSq < 32 ? 1 << kSq : 0;
  const kbHi = kSq < 32 ? 0 : 1 << (kSq - 32);
  const nkLo = occLo & ~kbLo;
  const nkHi = occHi & ~kbHi;
  let tLo = KING_LO[kSq] & ~ownLo;
  let tHi = KING_HI[kSq] & ~ownHi;
  while ((tLo | tHi) !== 0) {
    let to: number;
    if (tLo !== 0) {
      to = ctz32(tLo);
      tLo &= tLo - 1;
    } else {
      to = 32 + ctz32(tHi);
      tHi &= tHi - 1;
    }
    if (!attacked(p, to, them, nkLo, nkHi)) {
      MOVE_BUF[n++] =
        kSq | (to << 6) | ((hasBit(enLo, enHi, to) !== 0 ? FLAG_CAPTURE : 0) << 12);
    }
  }

  let chLo = PAWN_ATT_LO[us * 64 + kSq] & p.pLo[eBase];
  let chHi = PAWN_ATT_HI[us * 64 + kSq] & p.pHi[eBase];
  chLo |= KNIGHT_LO[kSq] & p.pLo[eBase + 1];
  chHi |= KNIGHT_HI[kSq] & p.pHi[eBase + 1];
  bishopAtt(kSq, occLo, occHi);
  chLo |= gLo & (p.pLo[eBase + 2] | p.pLo[eBase + 4]);
  chHi |= gHi & (p.pHi[eBase + 2] | p.pHi[eBase + 4]);
  rookAtt(kSq, occLo, occHi);
  chLo |= gLo & (p.pLo[eBase + 3] | p.pLo[eBase + 4]);
  chHi |= gHi & (p.pHi[eBase + 3] | p.pHi[eBase + 4]);

  const nCheck = popcnt(chLo, chHi);
  if (nCheck === 2) return n - first;

  let mLo = -1;
  let mHi = -1;
  if (nCheck === 1) {
    const cs = lsb(chLo, chHi);
    mLo = BETWEEN_LO[kSq * 64 + cs] | chLo;
    mHi = BETWEEN_HI[kSq * 64 + cs] | chHi;
  }

  let pinLo = 0;
  let pinHi = 0;
  rookAtt(kSq, enLo, enHi);
  let snLo = gLo & (p.pLo[eBase + 3] | p.pLo[eBase + 4]);
  let snHi = gHi & (p.pHi[eBase + 3] | p.pHi[eBase + 4]);
  bishopAtt(kSq, enLo, enHi);
  snLo |= gLo & (p.pLo[eBase + 2] | p.pLo[eBase + 4]);
  snHi |= gHi & (p.pHi[eBase + 2] | p.pHi[eBase + 4]);
  while ((snLo | snHi) !== 0) {
    let s: number;
    if (snLo !== 0) {
      s = ctz32(snLo);
      snLo &= snLo - 1;
    } else {
      s = 32 + ctz32(snHi);
      snHi &= snHi - 1;
    }
    const bLo = BETWEEN_LO[kSq * 64 + s] & ownLo;
    const bHi = BETWEEN_HI[kSq * 64 + s] & ownHi;
    if (popcnt(bLo, bHi) === 1) {
      pinLo |= bLo;
      pinHi |= bHi;
    }
  }

  let bbLo = p.pLo[base + 1] & ~pinLo;
  let bbHi = p.pHi[base + 1] & ~pinHi;
  while ((bbLo | bbHi) !== 0) {
    let sq: number;
    if (bbLo !== 0) {
      sq = ctz32(bbLo);
      bbLo &= bbLo - 1;
    } else {
      sq = 32 + ctz32(bbHi);
      bbHi &= bbHi - 1;
    }
    let aLo = KNIGHT_LO[sq] & ~ownLo & mLo;
    let aHi = KNIGHT_HI[sq] & ~ownHi & mHi;
    while ((aLo | aHi) !== 0) {
      let to: number;
      if (aLo !== 0) {
        to = ctz32(aLo);
        aLo &= aLo - 1;
      } else {
        to = 32 + ctz32(aHi);
        aHi &= aHi - 1;
      }
      MOVE_BUF[n++] =
        sq | (to << 6) | ((hasBit(enLo, enHi, to) !== 0 ? FLAG_CAPTURE : 0) << 12);
    }
  }

  for (let pt = 2; pt <= 4; pt++) {
    bbLo = p.pLo[base + pt];
    bbHi = p.pHi[base + pt];
    while ((bbLo | bbHi) !== 0) {
      let sq: number;
      if (bbLo !== 0) {
        sq = ctz32(bbLo);
        bbLo &= bbLo - 1;
      } else {
        sq = 32 + ctz32(bbHi);
        bbHi &= bbHi - 1;
      }
      let aLo = 0;
      let aHi = 0;
      if (pt !== 3) {
        bishopAtt(sq, occLo, occHi);
        aLo |= gLo;
        aHi |= gHi;
      }
      if (pt !== 2) {
        rookAtt(sq, occLo, occHi);
        aLo |= gLo;
        aHi |= gHi;
      }
      aLo &= ~ownLo & mLo;
      aHi &= ~ownHi & mHi;
      if (hasBit(pinLo, pinHi, sq) !== 0) {
        aLo &= LINE_LO[kSq * 64 + sq];
        aHi &= LINE_HI[kSq * 64 + sq];
      }
      while ((aLo | aHi) !== 0) {
        let to: number;
        if (aLo !== 0) {
          to = ctz32(aLo);
          aLo &= aLo - 1;
        } else {
          to = 32 + ctz32(aHi);
          aHi &= aHi - 1;
        }
        MOVE_BUF[n++] =
          sq | (to << 6) | ((hasBit(enLo, enHi, to) !== 0 ? FLAG_CAPTURE : 0) << 12);
      }
    }
  }

  const push = us === 0 ? 8 : -8;
  const startRank = us === 0 ? 1 : 6;
  const promoRank = us === 0 ? 7 : 0;
  bbLo = p.pLo[base];
  bbHi = p.pHi[base];
  while ((bbLo | bbHi) !== 0) {
    let sq: number;
    if (bbLo !== 0) {
      sq = ctz32(bbLo);
      bbLo &= bbLo - 1;
    } else {
      sq = 32 + ctz32(bbHi);
      bbHi &= bbHi - 1;
    }
    let amLo = mLo;
    let amHi = mHi;
    if (hasBit(pinLo, pinHi, sq) !== 0) {
      amLo &= LINE_LO[kSq * 64 + sq];
      amHi &= LINE_HI[kSq * 64 + sq];
    }
    const to1 = sq + push;
    if (hasBit(occLo, occHi, to1) === 0) {
      if (to1 >> 3 === promoRank) {
        if (hasBit(amLo, amHi, to1) !== 0) {
          MOVE_BUF[n++] = sq | (to1 << 6) | (8 << 12);
          MOVE_BUF[n++] = sq | (to1 << 6) | (9 << 12);
          MOVE_BUF[n++] = sq | (to1 << 6) | (10 << 12);
          MOVE_BUF[n++] = sq | (to1 << 6) | (11 << 12);
        }
      } else {
        if (hasBit(amLo, amHi, to1) !== 0) MOVE_BUF[n++] = sq | (to1 << 6);
        if (sq >> 3 === startRank) {
          const to2 = sq + push * 2;
          if (hasBit(occLo, occHi, to2) === 0 && hasBit(amLo, amHi, to2) !== 0)
            MOVE_BUF[n++] = sq | (to2 << 6) | (FLAG_DPUSH << 12);
        }
      }
    }
    let capLo = PAWN_ATT_LO[us * 64 + sq] & enLo & amLo;
    let capHi = PAWN_ATT_HI[us * 64 + sq] & enHi & amHi;
    while ((capLo | capHi) !== 0) {
      let to: number;
      if (capLo !== 0) {
        to = ctz32(capLo);
        capLo &= capLo - 1;
      } else {
        to = 32 + ctz32(capHi);
        capHi &= capHi - 1;
      }
      if (to >> 3 === promoRank) {
        MOVE_BUF[n++] = sq | (to << 6) | (12 << 12);
        MOVE_BUF[n++] = sq | (to << 6) | (13 << 12);
        MOVE_BUF[n++] = sq | (to << 6) | (14 << 12);
        MOVE_BUF[n++] = sq | (to << 6) | (15 << 12);
      } else {
        MOVE_BUF[n++] = sq | (to << 6) | (FLAG_CAPTURE << 12);
      }
    }
    if (
      p.ep >= 0 &&
      hasBit(PAWN_ATT_LO[us * 64 + sq], PAWN_ATT_HI[us * 64 + sq], p.ep) !== 0 &&
      epLegal(p, sq, kSq, occLo, occHi)
    ) {
      MOVE_BUF[n++] = sq | (p.ep << 6) | (FLAG_EP << 12);
    }
  }

  if (nCheck === 0) {
    if (us === 0) {
      if (
        (p.castling & 1) !== 0 &&
        p.board[5] < 0 &&
        p.board[6] < 0 &&
        !attacked(p, 5, 1, occLo, occHi) &&
        !attacked(p, 6, 1, occLo, occHi)
      )
        MOVE_BUF[n++] = 4 | (6 << 6) | (FLAG_CASTLE_K << 12);
      if (
        (p.castling & 2) !== 0 &&
        p.board[1] < 0 &&
        p.board[2] < 0 &&
        p.board[3] < 0 &&
        !attacked(p, 2, 1, occLo, occHi) &&
        !attacked(p, 3, 1, occLo, occHi)
      )
        MOVE_BUF[n++] = 4 | (2 << 6) | (FLAG_CASTLE_Q << 12);
    } else {
      if (
        (p.castling & 4) !== 0 &&
        p.board[61] < 0 &&
        p.board[62] < 0 &&
        !attacked(p, 61, 0, occLo, occHi) &&
        !attacked(p, 62, 0, occLo, occHi)
      )
        MOVE_BUF[n++] = 60 | (62 << 6) | (FLAG_CASTLE_K << 12);
      if (
        (p.castling & 8) !== 0 &&
        p.board[57] < 0 &&
        p.board[58] < 0 &&
        p.board[59] < 0 &&
        !attacked(p, 58, 0, occLo, occHi) &&
        !attacked(p, 59, 0, occLo, occHi)
      )
        MOVE_BUF[n++] = 60 | (58 << 6) | (FLAG_CASTLE_Q << 12);
    }
  }

  return n - first;
}

// ── Public pure API ─────────────────────────────────────────────────────────

export function legalMoves(pos: Position): EngineMove[] {
  const n = generateMoves(pos, 0);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = MOVE_BUF[i];
  return out;
}

export function applyMove(pos: Position, move: EngineMove): Position {
  const p = pos.clone();
  p.make(move);
  if (p.halfmove === 0) {
    p.repLo.length = 0;
    p.repHi.length = 0;
  } else {
    p.repLo.push(pos.hashLo);
    p.repHi.push(pos.hashHi);
  }
  return p;
}

// ── FEN ─────────────────────────────────────────────────────────────────────

const PIECE_CH = 'PNBRQKpnbrqk';

export function fromFEN(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0];
  if (!placement) throw new Error('empty FEN');
  const p = new Position();
  let rank = 7;
  let file = 0;
  for (const ch of placement) {
    if (ch === '/') {
      rank--;
      file = 0;
    } else if (ch >= '1' && ch <= '8') {
      file += ch.charCodeAt(0) - 48;
    } else {
      const pc = PIECE_CH.indexOf(ch);
      if (pc < 0 || rank < 0 || file > 7) throw new Error(`bad FEN placement: ${fen}`);
      p.addPiece(pc, rank * 8 + file);
      file++;
    }
  }
  if (popcnt(p.pLo[5], p.pHi[5]) !== 1 || popcnt(p.pLo[11], p.pHi[11]) !== 1)
    throw new Error(`FEN must have exactly one king per side: ${fen}`);
  p.stm = parts[1] === 'b' ? 1 : 0;
  const cast = parts[2] ?? '-';
  p.castling =
    (cast.includes('K') ? 1 : 0) |
    (cast.includes('Q') ? 2 : 0) |
    (cast.includes('k') ? 4 : 0) |
    (cast.includes('q') ? 8 : 0);
  p.ep = parts[3] && parts[3] !== '-' ? squareIndex(parts[3]) : -1;
  p.halfmove = parts[4] ? parseInt(parts[4], 10) || 0 : 0;
  p.fullmove = parts[5] ? parseInt(parts[5], 10) || 1 : 1;
  p.computeHash();
  return p;
}

export function toFEN(pos: Position): string {
  let placement = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const pc = pos.board[rank * 8 + file];
      if (pc < 0) {
        empty++;
      } else {
        if (empty > 0) {
          placement += empty;
          empty = 0;
        }
        placement += PIECE_CH[pc];
      }
    }
    if (empty > 0) placement += empty;
    if (rank > 0) placement += '/';
  }
  let cast = '';
  if (pos.castling & 1) cast += 'K';
  if (pos.castling & 2) cast += 'Q';
  if (pos.castling & 4) cast += 'k';
  if (pos.castling & 8) cast += 'q';
  if (cast === '') cast = '-';
  const ep = pos.ep >= 0 ? squareName(pos.ep) : '-';
  return `${placement} ${pos.turn} ${cast} ${ep} ${pos.halfmove} ${pos.fullmove}`;
}

// ── Status ──────────────────────────────────────────────────────────────────

function insufficientMaterial(p: Position): boolean {
  for (const t of [0, 3, 4]) {
    if ((p.pLo[t] | p.pHi[t] | p.pLo[t + 6] | p.pHi[t + 6]) !== 0) return false;
  }
  const wN = popcnt(p.pLo[1], p.pHi[1]);
  const wB = popcnt(p.pLo[2], p.pHi[2]);
  const bN = popcnt(p.pLo[7], p.pHi[7]);
  const bB = popcnt(p.pLo[8], p.pHi[8]);
  const minors = wN + wB + bN + bB;
  if (minors <= 1) return true;
  if (minors === 2 && wB === 1 && bB === 1) {
    const ws = lsb(p.pLo[2], p.pHi[2]);
    const bs = lsb(p.pLo[8], p.pHi[8]);
    return ((ws + (ws >> 3)) & 1) === ((bs + (bs >> 3)) & 1);
  }
  return false;
}

export type { GameStatus };

export function status(pos: Position): GameStatus {
  if (generateMoves(pos, 0) === 0) return inCheck(pos) ? 'checkmate' : 'stalemate';
  if (pos.halfmove >= 100) return 'draw-fifty';
  let seen = 0;
  for (let i = 0; i < pos.repLo.length; i++) {
    if (pos.repLo[i] === pos.hashLo && pos.repHi[i] === pos.hashHi) seen++;
  }
  if (seen >= 2) return 'draw-repetition';
  if (insufficientMaterial(pos)) return 'draw-material';
  return 'active';
}

// ── Perft ───────────────────────────────────────────────────────────────────

function perftRec(p: Position, depth: number, first: number): number {
  const n = generateMoves(p, first);
  if (depth === 1) return n;
  let total = 0;
  for (let i = 0; i < n; i++) {
    p.make(MOVE_BUF[first + i]);
    total += perftRec(p, depth - 1, first + n);
    p.unmake();
  }
  return total;
}

export function perft(pos: Position, depth: number): number {
  if (depth <= 0) return 1;
  return perftRec(pos.clone(), depth, 0);
}

/** Per-root-move subtree counts, for divide-style debugging. */
export function perftDivide(pos: Position, depth: number): [EngineMove, number][] {
  const p = pos.clone();
  const n = generateMoves(p, 0);
  const out: [EngineMove, number][] = [];
  const moves: number[] = [];
  for (let i = 0; i < n; i++) moves.push(MOVE_BUF[i]);
  for (const m of moves) {
    p.make(m);
    out.push([m, depth <= 1 ? 1 : perftRec(p, depth - 1, 0)]);
    p.unmake();
  }
  return out;
}
