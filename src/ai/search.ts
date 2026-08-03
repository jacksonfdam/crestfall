/**
 * Alpha-beta search in negate-max form, with iterative deepening, quiescence,
 * transposition table, killers/history move ordering, and a check extension.
 *
 * "Negate-max" is the compact way to write minimax for a zero-sum game: since
 * max(a, b) === -min(-a, -b), one routine serves both sides as long as the
 * score is negated on the way back up. That is where the negation in
 * `-negateMax(...)` at every recursion comes from.
 *
 * Deterministic for a given (fen, limits, seed): tie-breaks between equal
 * moves come only from hash32(seed, move); no Math.random, no clock in the
 * choice itself. The wall clock is consulted ONLY as a hard budget, checked
 * every 1024 nodes, and an aborted iteration is discarded whole — the move
 * returned always comes from the deepest fully completed iteration.
 */

import type { PieceType } from '../core/contract.ts';
import { hash32 } from '../core/prng.ts';
import {
  FLAG_EP,
  fromFEN,
  inCheck,
  legalMoves,
  moveFlags,
  moveFrom,
  moveIsCapture,
  moveIsPromotion,
  movePromotion,
  moveTo,
  type EngineMove,
  type Position,
} from '../engine/index.ts';
import { evaluate } from './eval.ts';

export interface SearchLimits {
  budgetMs: number;
  maxDepth: number;
  /** Seeded eval noise amplitude in centipawns (weaker tiers). */
  noiseCp: number;
  /** Deterministic tie-break / noise seed (from SearchRequest.seed). */
  seed: number;
}

export interface SearchOutcome {
  move: { from: number; to: number; promotion?: PieceType } | null;
  /** Deepest fully completed iteration. */
  depth: number;
  nodes: number;
  timeMs: number;
  /** Score of the chosen move, side-to-move POV, centipawns. */
  score: number;
}

const INF = 31000;
export const MATE = 30000;
export const MATE_BOUND = 29000;
const MAX_PLY = 96;

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

// ── Transposition table (fixed-size typed arrays, verified 64-bit key) ─────

const TT_SIZE = 1 << 18;
const TT_MASK = TT_SIZE - 1;
const TT_EXACT = 1;
const TT_LOWER = 2;
const TT_UPPER = 3;

const ttKeyLo = new Int32Array(TT_SIZE);
const ttKeyHi = new Int32Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE);
const ttScore = new Int16Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Uint8Array(TT_SIZE);

const ttIndex = (lo: number, hi: number): number =>
  (lo ^ Math.imul(hi, 0x9e3779b1)) & TT_MASK;

// ── Ordering state ──────────────────────────────────────────────────────────

const killer0 = new Int32Array(MAX_PLY + 4);
const killer1 = new Int32Array(MAX_PLY + 4);
const history = new Int32Array(2 * 64 * 64);

/** MVV victim values (type index p n b r q k). */
const VIC = [100, 320, 330, 500, 950, 0];
const PROMO_VAL: Record<string, number> = { n: 320, b: 330, r: 500, q: 950 };

// ── Searcher ────────────────────────────────────────────────────────────────

class Searcher {
  pos!: Position;
  nodes = 0;
  stopped = false;
  start = 0;
  budget = 0;
  seed = 0;
  noiseCp = 0;
  /** Zobrist hashes along the current search path (repetition detection). */
  private stackLo = new Int32Array(MAX_PLY + 128);
  private stackHi = new Int32Array(MAX_PLY + 128);
  private sp = 0;

  reset(pos: Position, budgetMs: number, seed: number, noiseCp: number): void {
    this.pos = pos;
    this.nodes = 0;
    this.stopped = false;
    this.start = now();
    this.budget = budgetMs;
    this.seed = seed;
    this.noiseCp = noiseCp;
    this.sp = 0;
    this.stackLo[this.sp] = pos.hashLo;
    this.stackHi[this.sp] = pos.hashHi;
    this.sp = 1;
    ttFlag.fill(0);
    killer0.fill(0);
    killer1.fill(0);
    history.fill(0);
  }

  elapsed(): number {
    return now() - this.start;
  }

  private checkTime(): void {
    if ((this.nodes & 1023) === 0 && this.elapsed() >= this.budget) {
      this.stopped = true;
    }
  }

  pushHash(): void {
    this.stackLo[this.sp] = this.pos.hashLo;
    this.stackHi[this.sp] = this.pos.hashHi;
    this.sp++;
  }

  popHash(): void {
    this.sp--;
  }

  /** Has the current position occurred earlier on the search path? */
  private isRepetition(): boolean {
    const lo = this.pos.hashLo;
    const hi = this.pos.hashHi;
    const limit = Math.max(0, this.sp - 1 - this.pos.halfmove);
    for (let i = this.sp - 3; i >= limit; i -= 2) {
      if (this.stackLo[i] === lo && this.stackHi[i] === hi) return true;
    }
    return false;
  }

  /** Eval from the side to move's POV, with deterministic seeded noise. */
  private evalHere(): number {
    let e = evaluate(this.pos);
    if (this.noiseCp > 0) {
      const span = 2 * this.noiseCp + 1;
      e += (hash32(this.seed, this.pos.hashLo, this.pos.hashHi) % span) - this.noiseCp;
    }
    return this.pos.stm === 0 ? e : -e;
  }

  /** Ordering score for a move (higher searched first). */
  private orderScore(m: EngineMove, ttMv: number, ply: number): number {
    if (m === ttMv) return 1 << 30;
    const fl = moveFlags(m);
    if ((fl & 4) !== 0) {
      const vic = fl === FLAG_EP ? 0 : this.pos.board[moveTo(m)] % 6;
      const att = this.pos.board[moveFrom(m)] % 6;
      let s = 100_000_000 + VIC[vic] * 32 - att;
      const promo = movePromotion(m);
      if (promo) s += PROMO_VAL[promo];
      return s;
    }
    if ((fl & 8) !== 0) return 90_000_000 + PROMO_VAL[movePromotion(m)!];
    if (m === killer0[ply]) return 80_000_000;
    if (m === killer1[ply]) return 79_000_000;
    return history[this.pos.stm * 4096 + moveFrom(m) * 64 + moveTo(m)];
  }

  negateMax(depth: number, alpha: number, beta: number, ply: number): number {
    if (this.stopped) return 0;
    this.nodes++;
    this.checkTime();
    if (this.stopped) return 0;

    const pos = this.pos;
    if (ply > 0) {
      if (pos.halfmove >= 100 || this.isRepetition()) return 0;
    }

    const inChk = inCheck(pos);
    if (inChk && ply < 64) depth++; // check extension
    if (depth <= 0) return this.qsearch(alpha, beta, ply);
    if (ply >= MAX_PLY) return this.evalHere();

    // Transposition table probe.
    const idx = ttIndex(pos.hashLo, pos.hashHi);
    let ttMv = 0;
    if (ttFlag[idx] !== 0 && ttKeyLo[idx] === pos.hashLo && ttKeyHi[idx] === pos.hashHi) {
      ttMv = ttMove[idx];
      if (ply > 0 && ttDepth[idx] >= depth) {
        let s = ttScore[idx];
        if (s > MATE_BOUND) s -= ply;
        else if (s < -MATE_BOUND) s += ply;
        const f = ttFlag[idx];
        if (f === TT_EXACT) return s;
        if (f === TT_LOWER && s > alpha) alpha = s;
        else if (f === TT_UPPER && s < beta) beta = s;
        if (alpha >= beta) return s;
      }
    }

    const moves = legalMoves(pos);
    const n = moves.length;
    if (n === 0) return inChk ? -MATE + ply : 0;

    const scores = new Array<number>(n);
    for (let i = 0; i < n; i++) scores[i] = this.orderScore(moves[i], ttMv, ply);

    const alphaOrig = alpha;
    let best = -INF;
    let bestMove = 0;

    for (let i = 0; i < n; i++) {
      // Selection sort: bring the highest-scored remaining move to slot i.
      let bi = i;
      for (let j = i + 1; j < n; j++) if (scores[j] > scores[bi]) bi = j;
      if (bi !== i) {
        const tm = moves[i];
        moves[i] = moves[bi];
        moves[bi] = tm;
        const ts = scores[i];
        scores[i] = scores[bi];
        scores[bi] = ts;
      }
      const m = moves[i];

      pos.make(m);
      this.pushHash();
      const score = -this.negateMax(depth - 1, -beta, -alpha, ply + 1);
      this.popHash();
      pos.unmake();
      if (this.stopped) return 0;

      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        if (!moveIsCapture(m) && !moveIsPromotion(m)) {
          if (killer0[ply] !== m) {
            killer1[ply] = killer0[ply];
            killer0[ply] = m;
          }
          const hIdx = pos.stm * 4096 + moveFrom(m) * 64 + moveTo(m);
          history[hIdx] += depth * depth;
          if (history[hIdx] > 40_000_000) history[hIdx] >>= 1;
        }
        break;
      }
    }

    // Store (always-replace). Mate scores are ply-adjusted to be
    // position-relative in the table.
    let stored = best;
    if (stored > MATE_BOUND) stored += ply;
    else if (stored < -MATE_BOUND) stored -= ply;
    ttKeyLo[idx] = pos.hashLo;
    ttKeyHi[idx] = pos.hashHi;
    ttMove[idx] = bestMove;
    ttScore[idx] = stored;
    ttDepth[idx] = depth > 127 ? 127 : depth;
    ttFlag[idx] = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;

    return best;
  }

  qsearch(alpha: number, beta: number, ply: number): number {
    if (this.stopped) return 0;
    this.nodes++;
    this.checkTime();
    if (this.stopped) return 0;

    const pos = this.pos;
    const inChk = inCheck(pos);
    let best = -INF;

    if (!inChk) {
      best = this.evalHere(); // stand pat
      if (ply >= MAX_PLY) return best;
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    } else if (ply >= MAX_PLY) {
      return 0;
    }

    const all = legalMoves(pos);
    if (all.length === 0) return inChk ? -MATE + ply : 0;

    // In check: search every evasion. Otherwise: captures + promotions.
    const moves: EngineMove[] = [];
    for (const m of all) {
      if (inChk || moveIsCapture(m) || moveIsPromotion(m)) moves.push(m);
    }
    const n = moves.length;
    const scores = new Array<number>(n);
    for (let i = 0; i < n; i++) scores[i] = this.orderScore(moves[i], 0, ply);

    for (let i = 0; i < n; i++) {
      let bi = i;
      for (let j = i + 1; j < n; j++) if (scores[j] > scores[bi]) bi = j;
      if (bi !== i) {
        const tm = moves[i];
        moves[i] = moves[bi];
        moves[bi] = tm;
        const ts = scores[i];
        scores[i] = scores[bi];
        scores[bi] = ts;
      }
      const m = moves[i];

      pos.make(m);
      this.pushHash();
      const score = -this.qsearch(-beta, -alpha, ply + 1);
      this.popHash();
      pos.unmake();
      if (this.stopped) return 0;

      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }

    return best;
  }
}

const searcher = new Searcher();

/** Decode an EngineMove into the protocol's move shape. */
function decode(m: EngineMove): { from: number; to: number; promotion?: PieceType } {
  const out: { from: number; to: number; promotion?: PieceType } = {
    from: moveFrom(m),
    to: moveTo(m),
  };
  const promo = movePromotion(m);
  if (promo) out.promotion = promo;
  return out;
}

/**
 * Search `fen` under `limits`. Same (fen, limits) → same move: variation
 * comes only from limits.seed. Never returns an illegal move; if the
 * position has any legal move at all, a move is always returned.
 */
/**
 * Iterative deepening, pausing after each completed depth.
 *
 * The pause points let a worker return to its event loop and observe a
 * cancel; without them a synchronous search cannot be abandoned and a stale
 * konungr search would hold the next one off for its whole budget. Yielding
 * only between depths keeps results identical to the uninterrupted run,
 * because a partial iteration is discarded whole either way.
 */
export function* searchSteps(fen: string, limits: SearchLimits): Generator<number, SearchOutcome> {
  const t0 = now();
  const root = fromFEN(fen);
  const rootMoves = legalMoves(root);
  if (rootMoves.length === 0) {
    return { move: null, depth: 0, nodes: 0, timeMs: now() - t0, score: 0 };
  }

  // Deterministic seeded pre-order: this is the tie-break among moves that
  // end up with equal scores, and the fallback if not even depth 1 finishes.
  const tie = new Map<EngineMove, number>();
  for (const m of rootMoves) tie.set(m, hash32(limits.seed, m));
  rootMoves.sort((a, b) => tie.get(a)! - tie.get(b)!);

  searcher.reset(root.clone(), limits.budgetMs, limits.seed, limits.noiseCp);

  let bestMove = rootMoves[0];
  let bestScore = 0;
  let completedDepth = 0;
  const rootScore = new Map<EngineMove, number>();

  const maxDepth = Math.max(1, Math.min(limits.maxDepth, MAX_PLY - 2));
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INF;
    let iterBest = -INF;
    let iterMove = 0;

    for (const m of rootMoves) {
      searcher.pos.make(m);
      searcher.pushHash();
      const score = -searcher.negateMax(depth - 1, -INF, -alpha, 1);
      searcher.popHash();
      searcher.pos.unmake();
      if (searcher.stopped) break;

      rootScore.set(m, score);
      if (score > iterBest) {
        iterBest = score;
        iterMove = m;
      }
      if (score > alpha) alpha = score;
    }

    if (searcher.stopped) break; // discard the partial iteration whole

    bestMove = iterMove;
    bestScore = iterBest;
    completedDepth = depth;

    // Re-order roots for the next iteration: score desc, seeded tie asc.
    rootMoves.sort((a, b) => {
      const sa = rootScore.get(a) ?? -INF;
      const sb = rootScore.get(b) ?? -INF;
      return sb - sa || tie.get(a)! - tie.get(b)!;
    });

    // Proven mate either way — deeper search cannot change the outcome.
    if (bestScore >= MATE_BOUND || bestScore <= -MATE_BOUND) break;
    // Soft stop: no point starting an iteration we can't finish.
    if (now() - t0 > limits.budgetMs * 0.55) break;

    // Abandonable boundary: the caller may stop driving us here.
    yield completedDepth;
  }

  return {
    move: decode(bestMove),
    depth: completedDepth,
    nodes: searcher.nodes,
    timeMs: now() - t0,
    score: bestScore,
  };
}

/** Run a search to completion without pausing. */
export function search(fen: string, limits: SearchLimits): SearchOutcome {
  const steps = searchSteps(fen, limits);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
