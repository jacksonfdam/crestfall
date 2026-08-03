/**
 * Adapts a remote player to the port the GameController already has for its
 * AI. The controller asks the port for a move whenever the turn is not the
 * local player's; the AI answers by searching, and a friend answers by playing.
 *
 * Reusing that seam is what keeps the "GameController is the only writer of
 * game state" invariant intact for online play — no new write path, and the
 * generation counter the controller already uses for cancellation gives us
 * staleness protection on undo and new game for free.
 */

import type { AiReply, SearchRequest } from '../core/aiProtocol.ts';
import type { PieceType, Square } from '../core/contract.ts';

export interface OpponentMove {
  from: Square;
  to: Square;
  promotion?: PieceType;
}

export interface OpponentPort {
  post(req: SearchRequest | { type: 'cancel'; generation: number }): void;
  onReply(fn: (r: AiReply) => void): void;
  /** Hand the controller a move that arrived from the other player. */
  deliver(move: OpponentMove): void;
  /** True while the controller is waiting on the opponent. */
  readonly waiting: boolean;
}

export function createOpponentPort(): OpponentPort {
  let reply: ((r: AiReply) => void) | null = null;
  /** Generation the controller is currently waiting on, if any. */
  let pending: number | null = null;
  /**
   * A move can land before the controller asks for it: the opponent may move
   * the instant our own move is applied, and the broadcast can beat the
   * controller's own bookkeeping. Hold exactly one so nothing is dropped.
   */
  let queued: OpponentMove | null = null;

  function flush(): void {
    if (pending === null || !queued || !reply) return;
    const generation = pending;
    const move = queued;
    pending = null;
    queued = null;
    reply({ type: 'bestmove', generation, move, depth: 0, nodes: 0, timeMs: 0 });
  }

  return {
    post(req): void {
      if (req.type === 'cancel') {
        // The game moved on (undo, new game): whatever we were waiting for is
        // no longer wanted, and a queued move would apply to a dead position.
        pending = null;
        queued = null;
        return;
      }
      pending = req.generation;
      flush();
    },
    onReply(fn): void {
      reply = fn;
    },
    deliver(move): void {
      queued = move;
      flush();
    },
    get waiting(): boolean {
      return pending !== null;
    },
  };
}
