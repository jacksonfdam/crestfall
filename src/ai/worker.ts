/**
 * AI Web Worker entry. Implements src/core/aiProtocol.ts exactly:
 * 'search' → BestMoveReply, 'cancel' → abandon that generation.
 *
 * The search is driven one deepening iteration at a time, returning to the
 * event loop between them so a cancel that arrives mid-search is actually
 * observed. Without that, a stale konungr search would hold the next one off
 * for its entire budget. Results are unchanged by the pauses: a partial
 * iteration is discarded whole whether we stop for time or for a cancel.
 *
 * The module is also loadable under plain Node — the worker wiring only
 * engages inside a real WorkerGlobalScope — so tests drive it directly.
 */

import type { AiReply, AiRequest } from '../core/aiProtocol.ts';
import { searchTier, searchTierSteps } from './tiers.ts';

const cancelled = new Set<number>();

/** Generations only grow, so anything at or below `g` is settled. */
function forget(g: number): void {
  for (const c of cancelled) if (c <= g) cancelled.delete(c);
}

/**
 * Handle one request synchronously. Used by tests and by any host without a
 * macrotask scheduler; the worker itself prefers {@link handleRequestAsync}.
 */
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
  forget(req.generation);
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

/** Yield to the event loop so queued messages (i.e. cancels) are delivered. */
const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Step-wise request handling: abandons the search as soon as it is cancelled. */
export async function handleRequestAsync(
  req: AiRequest,
  reply: (r: AiReply) => void,
): Promise<void> {
  if (req.type === 'cancel') {
    cancelled.add(req.generation);
    return;
  }
  if (req.type !== 'search') return;
  if (cancelled.has(req.generation)) {
    cancelled.delete(req.generation);
    return;
  }

  const steps = searchTierSteps(req.fen, req.tier, req.seed);
  let step = steps.next();
  while (!step.done) {
    if (cancelled.has(req.generation)) {
      steps.return(undefined as never);
      forget(req.generation);
      return;
    }
    await nextTick();
    if (cancelled.has(req.generation)) {
      steps.return(undefined as never);
      forget(req.generation);
      return;
    }
    step = steps.next();
  }

  const discarded = cancelled.has(req.generation);
  forget(req.generation);
  if (discarded) return;
  const out = step.value;
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
  // Searches are serialised: a new request waits for the current one to finish
  // or be cancelled, so the worker never runs two searches at once.
  let queue: Promise<void> = Promise.resolve();
  scope.onmessage = (e) => {
    const req = e.data;
    if (req.type === 'cancel') {
      // Must take effect immediately, not behind the running search.
      void handleRequestAsync(req, () => {});
      return;
    }
    queue = queue.then(() => handleRequestAsync(req, (r) => scope.postMessage!(r)));
  };
}
