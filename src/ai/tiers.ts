/**
 * Tier profiles: AiTier → search limits. Budgets come straight from the
 * frozen protocol (TIER_BUDGET_MS). Depth caps keep the weak tiers weak —
 * and, as a bonus, make thrall/karl fully deterministic regardless of
 * machine speed, because their searches finish well inside the budget.
 * Noise is seeded eval jitter: weak play, never an illegal move.
 */

import type { AiTier } from '../core/contract.ts';
import { TIER_BUDGET_MS } from '../core/aiProtocol.ts';
import { search, searchSteps, type SearchLimits, type SearchOutcome } from './search.ts';

export interface TierProfile {
  budgetMs: number;
  maxDepth: number;
  noiseCp: number;
}

export const TIER_PROFILE: Record<AiTier, TierProfile> = {
  thrall: { budgetMs: TIER_BUDGET_MS.thrall, maxDepth: 2, noiseCp: 40 },
  karl: { budgetMs: TIER_BUDGET_MS.karl, maxDepth: 4, noiseCp: 10 },
  jarl: { budgetMs: TIER_BUDGET_MS.jarl, maxDepth: 9, noiseCp: 0 },
  konungr: { budgetMs: TIER_BUDGET_MS.konungr, maxDepth: 64, noiseCp: 0 },
};

/**
 * Run a search for a tier. `budgetOverrideMs` exists for tests and tooling
 * that sweep many positions (the legality of the reply never depends on
 * how long we think); production callers omit it.
 */
export function searchTier(
  fen: string,
  tier: AiTier,
  seed: number,
  budgetOverrideMs?: number,
): SearchOutcome {
  return search(fen, tierLimits(tier, seed, budgetOverrideMs));
}

/** Step-wise form of {@link searchTier}, abandonable between depths. */
export function searchTierSteps(
  fen: string,
  tier: AiTier,
  seed: number,
  budgetOverrideMs?: number,
): Generator<number, SearchOutcome> {
  return searchSteps(fen, tierLimits(tier, seed, budgetOverrideMs));
}

function tierLimits(tier: AiTier, seed: number, budgetOverrideMs?: number): SearchLimits {
  const p = TIER_PROFILE[tier];
  return {
    budgetMs: budgetOverrideMs ?? p.budgetMs,
    maxDepth: p.maxDepth,
    noiseCp: p.noiseCp,
    seed,
  };
}
