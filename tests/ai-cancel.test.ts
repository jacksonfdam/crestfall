import { describe, it, expect } from 'vitest';
import { handleRequestAsync } from '../src/ai/worker.ts';
import { searchTier } from '../src/ai/tiers.ts';
import { search, searchSteps } from '../src/ai/search.ts';
import type { AiReply } from '../src/core/aiProtocol.ts';
import { INITIAL_FEN } from '../src/engine/index.ts';

const MIDGAME = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5';

describe('AI cancellation', () => {
  it('abandons an in-flight search when a cancel arrives', async () => {
    const replies: AiReply[] = [];
    const started = performance.now();

    const running = handleRequestAsync(
      { type: 'search', fen: MIDGAME, tier: 'konungr', generation: 7, seed: 1 },
      (r) => replies.push(r),
    );
    // Land the cancel while the search is between deepening iterations.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await handleRequestAsync({ type: 'cancel', generation: 7 }, () => {});
    await running;

    const elapsed = performance.now() - started;
    expect(replies).toHaveLength(0);
    // konungr's budget is 4000 ms; aborting must not burn it.
    expect(elapsed).toBeLessThan(2000);
  });

  it('still answers a search that is never cancelled', async () => {
    const replies: AiReply[] = [];
    await handleRequestAsync(
      { type: 'search', fen: INITIAL_FEN, tier: 'karl', generation: 1, seed: 42 },
      (r) => replies.push(r),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0].move).not.toBeNull();
    expect(replies[0].generation).toBe(1);
  });

  it('drops a search that was cancelled before it started', async () => {
    const replies: AiReply[] = [];
    await handleRequestAsync({ type: 'cancel', generation: 3 }, () => {});
    await handleRequestAsync(
      { type: 'search', fen: INITIAL_FEN, tier: 'karl', generation: 3, seed: 1 },
      (r) => replies.push(r),
    );
    expect(replies).toHaveLength(0);
  });

  it('pausing between depths does not change the chosen move', () => {
    const limits = { budgetMs: 500, maxDepth: 5, noiseCp: 0, seed: 99 };
    const direct = search(MIDGAME, limits);

    const steps = searchSteps(MIDGAME, limits);
    let step = steps.next();
    while (!step.done) step = steps.next();

    expect(step.value.move).toEqual(direct.move);
    expect(step.value.depth).toEqual(direct.depth);
  });

  it('keeps searchTier synchronous for tests and tooling', () => {
    const out = searchTier(INITIAL_FEN, 'thrall', 5);
    expect(out.move).not.toBeNull();
  });
});
