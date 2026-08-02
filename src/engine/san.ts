/** SAN generation and parsing on top of the move generator. */

import type { MoveRecord, PieceType } from '../core/contract.ts';
import { squareName } from '../core/contract.ts';
import {
  FLAG_CASTLE_K, FLAG_CASTLE_Q, FLAG_EP, TYPE_CH,
  Position, applyMove, inCheck, legalMoves, movePromotion,
  type EngineMove,
} from './position.ts';

const FILES = 'abcdefgh';
const UPPER = 'PNBRQK';

/** SAN without check/mate suffix. */
function sanCore(pos: Position, m: EngineMove, legal: EngineMove[]): string {
  const from = m & 63;
  const to = (m >>> 6) & 63;
  const fl = (m >>> 12) & 15;
  if (fl === FLAG_CASTLE_K) return 'O-O';
  if (fl === FLAG_CASTLE_Q) return 'O-O-O';
  const pc = pos.board[from];
  const t = pc % 6;
  const isCap = (fl & 4) !== 0;
  if (t === 0) {
    let s = isCap ? FILES[from & 7] + 'x' + squareName(to) : squareName(to);
    if ((fl & 8) !== 0) s += '=' + UPPER[(fl & 3) + 1];
    return s;
  }
  let s = UPPER[t];
  let amb = false;
  let sameFile = false;
  let sameRank = false;
  for (const mv of legal) {
    const f2 = mv & 63;
    if (f2 === from || ((mv >>> 6) & 63) !== to || pos.board[f2] !== pc) continue;
    amb = true;
    if ((f2 & 7) === (from & 7)) sameFile = true;
    if (f2 >> 3 === from >> 3) sameRank = true;
  }
  if (amb) {
    if (!sameFile) s += FILES[from & 7];
    else if (!sameRank) s += String((from >> 3) + 1);
    else s += squareName(from);
  }
  if (isCap) s += 'x';
  return s + squareName(to);
}

export function moveToRecord(pos: Position, move: EngineMove): MoveRecord {
  const from = move & 63;
  const to = (move >>> 6) & 63;
  const fl = (move >>> 12) & 15;
  const pc = pos.board[from];
  const color = pc > 5 ? 'b' : 'w';
  const child = applyMove(pos, move);
  const check = inCheck(child);
  const checkmate = check && legalMoves(child).length === 0;
  let san = sanCore(pos, move, legalMoves(pos));
  if (checkmate) san += '#';
  else if (check) san += '+';
  const record: MoveRecord = {
    from,
    to,
    piece: TYPE_CH[pc % 6] as PieceType,
    color,
    san,
  };
  if (fl === FLAG_EP) {
    const capSq = color === 'w' ? to - 8 : to + 8;
    record.capture = { type: 'p', color: color === 'w' ? 'b' : 'w', square: capSq };
    record.enPassant = true;
  } else if ((fl & 4) !== 0) {
    const victim = pos.board[to];
    record.capture = {
      type: TYPE_CH[victim % 6] as PieceType,
      color: victim > 5 ? 'b' : 'w',
      square: to,
    };
  }
  const promo = movePromotion(move);
  if (promo) record.promotion = promo;
  if (fl === FLAG_CASTLE_K) record.castle = 'k';
  if (fl === FLAG_CASTLE_Q) record.castle = 'q';
  if (check) record.check = true;
  if (checkmate) record.checkmate = true;
  return record;
}

export function sanToMove(pos: Position, san: string): EngineMove | null {
  const clean = san
    .replace(/e\.p\./g, '')
    .replace(/[+#!?]/g, '')
    .replace(/0/g, 'O')
    .trim();
  const legal = legalMoves(pos);
  if (clean === 'O-O' || clean === 'O-O-O') {
    const want = clean === 'O-O' ? FLAG_CASTLE_K : FLAG_CASTLE_Q;
    for (const m of legal) if (((m >>> 12) & 15) === want) return m;
    return null;
  }
  const match = /^([NBRQK]?)([a-h]?)([1-8]?)x?([a-h][1-8])(?:=?([NBRQ]))?$/.exec(clean);
  if (!match) return null;
  const type = match[1] === '' ? 0 : UPPER.indexOf(match[1]);
  const fromFile = match[2] === '' ? -1 : match[2].charCodeAt(0) - 97;
  const fromRank = match[3] === '' ? -1 : match[3].charCodeAt(0) - 49;
  const dest = (match[4].charCodeAt(0) - 97) | ((match[4].charCodeAt(1) - 49) << 3);
  const promo = match[5] ? UPPER.indexOf(match[5]) : -1;
  let found: EngineMove | null = null;
  for (const m of legal) {
    const from = m & 63;
    const fl = (m >>> 12) & 15;
    if (((m >>> 6) & 63) !== dest) continue;
    if (pos.board[from] % 6 !== type) continue;
    if (fl === FLAG_CASTLE_K || fl === FLAG_CASTLE_Q) continue;
    if (fromFile >= 0 && (from & 7) !== fromFile) continue;
    if (fromRank >= 0 && from >> 3 !== fromRank) continue;
    if ((fl & 8) !== 0 ? (fl & 3) + 1 !== promo : promo >= 0) continue;
    if (found !== null) return null;
    found = m;
  }
  return found;
}
