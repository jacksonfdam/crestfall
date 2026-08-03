/**
 * The frozen contract between the engine, game controller, and presentation.
 * Presentation modules import ONLY from src/core — never from src/engine.
 */

import { hash32 } from './prng.ts';

// ── Chess vocabulary ────────────────────────────────────────────────────────

export type Color = 'w' | 'b';
/** p=Huscarl n=Berserkr b=Völva r=Jötunn q=Valkyrie k=Jarl */
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface ColoredPiece {
  color: Color;
  type: PieceType;
}

/** Square index 0..63, a1=0, h1=7, a8=56, h8=63. */
export type Square = number;
export const squareName = (sq: Square): string =>
  'abcdefgh'[sq & 7] + String((sq >> 3) + 1);
export const squareIndex = (name: string): Square =>
  (name.charCodeAt(0) - 97) | ((name.charCodeAt(1) - 49) << 3);

export type Board64 = (ColoredPiece | null)[];

export type GameStatus =
  | 'active'
  | 'checkmate'
  | 'stalemate'
  | 'draw-fifty'
  | 'draw-repetition'
  | 'draw-material';

// ── Move records (what the engine reports, what presentation consumes) ─────

export interface MoveRecord {
  from: Square;
  to: Square;
  piece: PieceType;
  color: Color;
  san: string;
  /** Victim, if this move captures (en passant victim sits off `to`). */
  capture?: { type: PieceType; color: Color; square: Square };
  promotion?: PieceType;
  castle?: 'k' | 'q';
  enPassant?: boolean;
  check?: boolean;
  checkmate?: boolean;
}

export interface GameEvent {
  kind: 'move' | 'undo' | 'redo' | 'newgame' | 'load';
  /** Move that produced this state (kind === 'move' | 'redo'). */
  record?: MoveRecord;
  /** Full resolved truth, always present. */
  fen: string;
  board: Board64;
  status: GameStatus;
  turn: Color;
  moveIndex: number;
  inCheck: boolean;
  /** Squares of the last move, for highlighting. */
  lastMove?: { from: Square; to: Square };
}

export type GameListener = (e: GameEvent) => void;

// ── Duel determinism ────────────────────────────────────────────────────────

/**
 * Deterministically pick a duel variant. Same seed + move sequence =
 * byte-identical choreography, by construction.
 */
export function duelVariant(
  gameSeed: number,
  moveIndex: number,
  attacker: PieceType,
  victim: PieceType,
  variantCount: number,
): number {
  const a = attacker.charCodeAt(0);
  const v = victim.charCodeAt(0);
  return hash32(gameSeed, moveIndex, (a << 8) | v) % Math.max(1, variantCount);
}

// ── Character rig contract (chars ↔ duels) ─────────────────────────────────

export type Faction = 'ash' | 'ember';

export type CharacterName =
  | 'huscarl'
  | 'berserkr'
  | 'volva'
  | 'jotunn'
  | 'valkyrie'
  | 'jarl';

export const PIECE_CHARACTER: Record<PieceType, CharacterName> = {
  p: 'huscarl',
  n: 'berserkr',
  b: 'volva',
  r: 'jotunn',
  q: 'valkyrie',
  k: 'jarl',
};

// ── Settings (ui owns persistence; everyone reads) ──────────────────────────

export interface Settings {
  viewMode: '3d' | '2d';
  /** 1 | 2 | 0 — 0 means instant (duels skipped). */
  duelSpeed: 1 | 2 | 0;
  /** Play duels only for the first N moves; Infinity = always. */
  duelsFirstNMoves: number;
  reducedMotion: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  viewMode: '3d',
  duelSpeed: 1,
  duelsFirstNMoves: Infinity,
  reducedMotion: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.9,
};

// ── Game command surface (implemented by src/game/GameController) ───────────

/**
 * `online` is a challenge match against a friend over a link. It behaves
 * exactly like `vs-ai` from the controller's point of view — one side is
 * driven from outside, through the same port — so the local player can never
 * move for the opponent whether that opponent is a search or a person.
 */
export type GameMode = 'hotseat' | 'vs-ai' | 'attract' | 'online';
export type AiTier = 'thrall' | 'karl' | 'jarl' | 'konungr';

export interface NewGameOptions {
  mode: GameMode;
  seed: number;
  aiTier?: AiTier;
  /** Which color the human plays in vs-ai. */
  humanColor?: Color;
  fen?: string;
}

/**
 * The ONLY write path into game state. UI calls commands; presentation
 * subscribes. Renderer/duels/audio get the listener side only.
 */
export interface GameApi {
  tryMove(from: Square, to: Square, promotion?: PieceType): boolean;
  legalTargets(from: Square): Square[];
  /** Does moving from→to require a promotion choice? */
  needsPromotion(from: Square, to: Square): boolean;
  undo(): boolean;
  redo(): boolean;
  newGame(opts: NewGameOptions): void;
  loadFEN(fen: string): boolean;
  importPGN(pgn: string): boolean;
  exportPGN(): string;
  exportFEN(): string;
  subscribe(fn: GameListener): () => void;
  getState(): GameEvent;
  /** SAN history for the move list. */
  history(): MoveRecord[];
}

// ── FEN board parsing (so presentation never imports the engine) ────────────

export function boardFromFEN(fen: string): Board64 {
  const board: Board64 = new Array(64).fill(null);
  const placement = fen.split(' ')[0];
  let rank = 7;
  let file = 0;
  for (const ch of placement) {
    if (ch === '/') {
      rank--;
      file = 0;
    } else if (ch >= '1' && ch <= '8') {
      file += ch.charCodeAt(0) - 48;
    } else {
      const color: Color = ch === ch.toLowerCase() ? 'b' : 'w';
      board[rank * 8 + file] = { color, type: ch.toLowerCase() as PieceType };
      file++;
    }
  }
  return board;
}
