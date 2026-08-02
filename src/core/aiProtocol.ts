/**
 * Message protocol between GameController (main thread) and the AI worker.
 * The worker is cancellable via generation counters: any reply whose
 * generation doesn't match the controller's current one is discarded.
 */

import type { AiTier, PieceType, Square } from './contract.ts';

export interface SearchRequest {
  type: 'search';
  fen: string;
  tier: AiTier;
  generation: number;
  /** Seed for deterministic tie-breaking among equal moves. */
  seed: number;
}

export interface CancelRequest {
  type: 'cancel';
  generation: number;
}

export type AiRequest = SearchRequest | CancelRequest;

export interface BestMoveReply {
  type: 'bestmove';
  generation: number;
  move: { from: Square; to: Square; promotion?: PieceType } | null;
  /** Diagnostics for the UI's thinking indicator. */
  depth: number;
  nodes: number;
  timeMs: number;
}

export type AiReply = BestMoveReply;

/** Hard time budgets per tier, milliseconds. The worker must respect these. */
export const TIER_BUDGET_MS: Record<AiTier, number> = {
  thrall: 150,
  karl: 500,
  jarl: 1500,
  konungr: 4000,
};
