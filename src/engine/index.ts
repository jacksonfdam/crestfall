/**
 * Public surface of the headless rules engine. Pure functions over an
 * immutable-by-convention Position — applyMove always returns a new one.
 */

export {
  INITIAL_FEN,
  Position,
  applyMove,
  decodeMove,
  fromFEN,
  inCheck,
  legalMoves,
  moveFlags,
  moveFrom,
  moveIsCapture,
  moveIsPromotion,
  movePromotion,
  moveTo,
  perft,
  perftDivide,
  status,
  toFEN,
  FLAG_CAPTURE,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  FLAG_DPUSH,
  FLAG_EP,
  FLAG_PROMO,
  FLAG_QUIET,
  type DecodedMove,
  type EngineMove,
  type GameStatus,
} from './position.ts';

export { moveToRecord, sanToMove } from './san.ts';
export { exportPGN, importPGN } from './pgn.ts';
