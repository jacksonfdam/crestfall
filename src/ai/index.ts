/**
 * Public surface of the AI module.
 *
 * Main-thread usage:
 *   const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
 *   const controller = new GameController(createAiPort(worker));
 *
 * Tests and Node tooling use search/searchTier/handleRequest directly.
 */

import type { AiReply, SearchRequest } from '../core/aiProtocol.ts';

export { evaluate } from './eval.ts';
export { search, MATE, MATE_BOUND, type SearchLimits, type SearchOutcome } from './search.ts';
export { searchTier, TIER_PROFILE, type TierProfile } from './tiers.ts';
export { handleRequest } from './worker.ts';

/** Structural match for AiPort in src/game/controller.ts (no game import —
 * the ai module depends only on core and engine). */
export interface AiPortLike {
  post(req: SearchRequest | { type: 'cancel'; generation: number }): void;
  onReply(fn: (r: AiReply) => void): void;
}

/** Minimal structural view of a Worker so this stays DOM-lib agnostic. */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
}

/** Wrap a Web Worker running ./worker.ts as the controller's AiPort. */
export function createAiPort(worker: WorkerLike): AiPortLike {
  return {
    post: (req) => worker.postMessage(req),
    onReply: (fn) =>
      worker.addEventListener('message', (e) => fn(e.data as AiReply)),
  };
}
