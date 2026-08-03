/**
 * AI Web Worker entry. Implements src/core/aiProtocol.ts exactly:
 * 'search' → BestMoveReply, 'cancel' → discard that generation's reply.
 *
 * The search itself is synchronous, so a cancel can only be observed
 * before a search starts (messages queue); the controller additionally
 * discards stale generations on its side. This module is also loadable
 * under plain Node — the worker wiring only engages inside a real
 * WorkerGlobalScope — so tests drive it via handleRequest directly.
 */

import type { AiReply, AiRequest } from '../core/aiProtocol.ts';
import { searchTier } from './tiers.ts';

const cancelled = new Set<number>();

/** Handle one protocol request; `reply` receives any protocol replies. */
export function handleRequest(req: AiRequest, reply: (r: AiReply) => void): void {
  if (req.type === 'cancel') {
    cancelled.add(req.generation);
    return;
  }
  if (req.type !== 'search') return;
  if (cancelled.has(req.generation)) {
    cancelled.delete(req.generation);
    return;
  }
  const out = searchTier(req.fen, req.tier, req.seed);
  const discarded = cancelled.has(req.generation);
  // Generations only grow: anything at or below this one is settled.
  for (const g of cancelled) if (g <= req.generation) cancelled.delete(g);
  if (discarded) return;
  reply({
    type: 'bestmove',
    generation: req.generation,
    move: out.move,
    depth: out.depth,
    nodes: out.nodes,
    timeMs: Math.round(out.timeMs),
  });
}

// ── Worker wiring (browser only — inert under Node and on the main thread) ──

interface WorkerScope {
  WorkerGlobalScope?: abstract new () => unknown;
  self?: unknown;
  onmessage?: ((e: { data: AiRequest }) => void) | null;
  postMessage?: (msg: AiReply) => void;
}

const scope = globalThis as WorkerScope;
if (
  typeof scope.WorkerGlobalScope === 'function' &&
  scope.self instanceof scope.WorkerGlobalScope &&
  typeof scope.postMessage === 'function'
) {
  scope.onmessage = (e) => handleRequest(e.data, (r) => scope.postMessage!(r));
}
