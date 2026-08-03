/**
 * GameController — the ONLY writer of game state. Implements GameApi.
 * Presentation gets the subscribe side; UI gets the command side.
 *
 * The engine API it consumes is treated as opaque: legal moves are matched
 * through moveToRecord so this file never depends on the engine's internal
 * move encoding.
 */

import type {
  GameApi,
  GameEvent,
  GameListener,
  GameStatus,
  MoveRecord,
  NewGameOptions,
  PieceType,
  Square,
  Color,
} from '../core/contract.ts';
import { boardFromFEN } from '../core/contract.ts';
import type { AiReply, SearchRequest } from '../core/aiProtocol.ts';
import { hash32 } from '../core/prng.ts';
import {
  INITIAL_FEN,
  fromFEN,
  toFEN,
  legalMoves,
  applyMove,
  moveToRecord,
  status,
  inCheck,
  importPGN,
  exportPGN,
  type Position,
  type EngineMove,
} from '../engine/index.ts';

interface HistoryEntry {
  pos: Position;
  record: MoveRecord;
}

export interface AiPort {
  post(req: SearchRequest | { type: 'cancel'; generation: number }): void;
  onReply(fn: (r: AiReply) => void): void;
}

export class GameController implements GameApi {
  private pos: Position;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private listeners = new Set<GameListener>();
  private opts: NewGameOptions = { mode: 'hotseat', seed: 1 };
  private generation = 0;
  private ai?: AiPort;
  /** Set while a search is in flight, for the UI thinking indicator. */
  thinking = false;

  constructor(ai?: AiPort) {
    this.pos = fromFEN(INITIAL_FEN);
    this.ai = ai;
    ai?.onReply((r) => this.onAiReply(r));
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  tryMove(from: Square, to: Square, promotion?: PieceType): boolean {
    if (this.isAiTurn()) return false; // humans can't move for the AI
    return this.applyByCoords(from, to, promotion);
  }

  legalTargets(from: Square): Square[] {
    const targets: Square[] = [];
    for (const m of legalMoves(this.pos)) {
      const r = moveToRecord(this.pos, m);
      if (r.from === from && !targets.includes(r.to)) targets.push(r.to);
    }
    return targets;
  }

  needsPromotion(from: Square, to: Square): boolean {
    return legalMoves(this.pos).some((m) => {
      const r = moveToRecord(this.pos, m);
      return r.from === from && r.to === to && r.promotion !== undefined;
    });
  }

  undo(): boolean {
    if (this.past.length === 0) return false;
    this.cancelSearch();
    // In vs-ai, keep popping until it is the human's turn again — one ply if
    // the AI's reply is still in flight, two once it has landed. Popping a
    // fixed two plies would strand the game on an AI-to-move position with no
    // search queued.
    const maxSteps = this.opts.mode === 'vs-ai' ? 2 : 1;
    for (let i = 0; i < maxSteps && this.past.length > 0; i++) {
      this.future.push(this.past.pop()!);
      this.rewindToHistoryHead();
      if (this.opts.mode !== 'vs-ai' || !this.isAiTurn()) break;
    }
    this.emit('undo');
    // Safety net: if we still landed on an AI-to-move position (e.g. undoing
    // to the start of a game where the AI plays white), give it the move back.
    this.maybeSearch();
    return true;
  }

  private rewindToHistoryHead(): void {
    this.pos =
      this.past.length > 0
        ? this.past[this.past.length - 1].pos
        : fromFEN(this.opts.fen ?? INITIAL_FEN);
  }

  redo(): boolean {
    if (this.future.length === 0) return false;
    this.cancelSearch();
    const entry = this.future.pop()!;
    this.past.push(entry);
    this.pos = entry.pos;
    this.emit('redo', entry.record);
    this.maybeSearch();
    return true;
  }

  newGame(opts: NewGameOptions): void {
    this.cancelSearch();
    this.opts = { humanColor: 'w', ...opts };
    this.pos = fromFEN(opts.fen ?? INITIAL_FEN);
    this.past = [];
    this.future = [];
    this.emit('newgame');
    this.maybeSearch();
  }

  loadFEN(fen: string): boolean {
    try {
      const pos = fromFEN(fen);
      // Round-trip guard: reject garbage that parses but is inconsistent.
      if (toFEN(pos).split(' ')[0] !== fen.trim().split(' ')[0]) return false;
      this.cancelSearch();
      this.opts = { ...this.opts, fen };
      this.pos = pos;
      this.past = [];
      this.future = [];
      this.emit('load');
      this.maybeSearch();
      return true;
    } catch {
      return false;
    }
  }

  importPGN(pgn: string): boolean {
    const parsed = importPGN(pgn);
    if (!parsed) return false;
    this.cancelSearch();
    this.opts = { ...this.opts, fen: undefined };
    this.pos = fromFEN(INITIAL_FEN);
    this.past = [];
    this.future = [];
    for (const m of parsed.moves) {
      const record = moveToRecord(this.pos, m);
      this.pos = applyMove(this.pos, m);
      this.past.push({ pos: this.pos, record });
    }
    this.emit('load');
    return true;
  }

  exportPGN(): string {
    const st = status(this.pos);
    const result =
      st === 'checkmate'
        ? this.turn() === 'w'
          ? '0-1'
          : '1-0'
        : st === 'active'
          ? '*'
          : '1/2-1/2';
    return exportPGN(this.past.map((h) => h.record), result);
  }

  exportFEN(): string {
    return toFEN(this.pos);
  }

  subscribe(fn: GameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): GameEvent {
    return this.buildEvent('load');
  }

  history(): MoveRecord[] {
    return this.past.map((h) => h.record);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private turn(): Color {
    return toFEN(this.pos).split(' ')[1] as Color;
  }

  private isAiTurn(): boolean {
    if (status(this.pos) !== 'active') return false;
    if (this.opts.mode === 'attract') return true;
    if (this.opts.mode !== 'vs-ai') return false;
    return this.turn() !== (this.opts.humanColor ?? 'w');
  }

  private applyByCoords(from: Square, to: Square, promotion?: PieceType): boolean {
    if (status(this.pos) !== 'active') return false;
    let chosen: EngineMove | null = null;
    let chosenRecord: MoveRecord | null = null;
    for (const m of legalMoves(this.pos)) {
      const r = moveToRecord(this.pos, m);
      if (r.from !== from || r.to !== to) continue;
      if (r.promotion !== undefined) {
        if (r.promotion !== (promotion ?? 'q')) continue;
      } else if (promotion !== undefined) {
        continue;
      }
      chosen = m;
      chosenRecord = r;
      break;
    }
    if (!chosen || !chosenRecord) return false;
    this.pos = applyMove(this.pos, chosen);
    this.past.push({ pos: this.pos, record: chosenRecord });
    this.future = [];
    this.emit('move', chosenRecord);
    this.maybeSearch();
    return true;
  }

  private buildEvent(kind: GameEvent['kind'], record?: MoveRecord): GameEvent {
    const fen = toFEN(this.pos);
    const last = this.past.length > 0 ? this.past[this.past.length - 1].record : undefined;
    return {
      kind,
      record,
      fen,
      board: boardFromFEN(fen),
      status: status(this.pos) as GameStatus,
      turn: this.turn(),
      moveIndex: this.past.length,
      inCheck: inCheck(this.pos),
      lastMove: last ? { from: last.from, to: last.to } : undefined,
    };
  }

  private emit(kind: GameEvent['kind'], record?: MoveRecord): void {
    const e = this.buildEvent(kind, record);
    for (const fn of this.listeners) fn(e);
  }

  private cancelSearch(): void {
    this.generation++;
    this.thinking = false;
    this.ai?.post({ type: 'cancel', generation: this.generation - 1 });
  }

  private maybeSearch(): void {
    if (!this.ai || !this.isAiTurn()) return;
    this.generation++;
    this.thinking = true;
    const tier =
      this.opts.mode === 'attract'
        ? this.turn() === 'w'
          ? 'jarl'
          : 'karl'
        : (this.opts.aiTier ?? 'karl');
    this.ai.post({
      type: 'search',
      fen: toFEN(this.pos),
      tier,
      generation: this.generation,
      seed: hash32(this.opts.seed, this.past.length),
    });
  }

  private onAiReply(r: AiReply): void {
    if (r.type !== 'bestmove' || r.generation !== this.generation) return;
    this.thinking = false;
    if (!r.move || !this.isAiTurn()) return;
    this.applyByCoords(r.move.from, r.move.to, r.move.promotion);
  }
}
