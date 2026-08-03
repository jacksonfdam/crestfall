import { describe, expect, it } from 'vitest';
import {
  INITIAL_FEN,
  applyMove,
  fromFEN,
  legalMoves,
  moveToRecord,
  status,
  toFEN,
  type EngineMove,
  type Position,
} from '../src/engine/index.ts';
import { searchTier } from '../src/ai/index.ts';
import { handleRequest } from '../src/ai/worker.ts';
import type { AiReply } from '../src/core/aiProtocol.ts';
import type { AiTier, PieceType } from '../src/core/contract.ts';
import { mulberry32 } from '../src/core/prng.ts';

const TIERS: AiTier[] = ['thrall', 'karl', 'jarl', 'konungr'];

/** Find the engine move matching an AI reply move; null if not legal. */
function matchMove(
  pos: Position,
  mv: { from: number; to: number; promotion?: PieceType } | null,
): EngineMove | null {
  if (!mv) return null;
  for (const m of legalMoves(pos)) {
    const r = moveToRecord(pos, m);
    if (r.from === mv.from && r.to === mv.to && r.promotion === mv.promotion) return m;
  }
  return null;
}

/** Seeded random playout from the initial position; returns an active FEN. */
function randomActiveFen(rng: () => number): string {
  for (;;) {
    let pos = fromFEN(INITIAL_FEN);
    const steps = 6 + Math.floor(rng() * 60);
    for (let s = 0; s < steps && status(pos) === 'active'; s++) {
      const ms = legalMoves(pos);
      pos = applyMove(pos, ms[Math.floor(rng() * ms.length)]);
    }
    if (status(pos) === 'active') return toFEN(pos);
  }
}

// ── Mate in 1 — konungr finds every mate ────────────────────────────────────
// Back-rank, smothered, promotion, queen, ladder, rook-endgame, two-bishop
// mates; both colors. Each FEN is first verified against the engine: the
// position must be active and contain at least one mating move.

const MATE_IN_1: string[] = [
  // back rank, white / black
  '6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1',
  '4r2k/8/8/8/8/8/5PPP/6K1 b - - 0 1',
  // smothered, white / black
  '6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1',
  'k7/8/8/8/6n1/8/6PP/6RK b - - 0 1',
  // promotion mate, white / black
  '7k/5Ppp/8/8/8/8/8/K7 w - - 0 1',
  'k7/8/8/8/8/8/5pPP/7K b - - 0 1',
  // queen mate, white / black
  '6k1/Q7/6K1/8/8/8/8/8 w - - 0 1',
  '8/8/8/8/8/6k1/q7/6K1 b - - 0 1',
  // two-rook ladder, white / black
  '7k/R7/1R6/8/8/8/8/K7 w - - 0 1',
  'k7/8/8/8/8/6r1/7r/K7 b - - 0 1',
  // rook endgame mate, black / white
  '8/8/8/8/8/5k2/r7/5K2 b - - 0 1',
  '5k2/R7/5K2/8/8/8/8/8 w - - 0 1',
  // two bishops
  'k7/8/1K6/4B3/4B3/8/8/8 w - - 0 1',
];

describe('mate in 1 (konungr)', () => {
  it.each(MATE_IN_1)(
    '%s',
    (fen) => {
      const pos = fromFEN(fen);
      // Verify the FEN against the engine before asserting on the AI.
      expect(status(pos)).toBe('active');
      const mates = legalMoves(pos).filter(
        (m) => status(applyMove(pos, m)) === 'checkmate',
      );
      expect(mates.length, `expected a mate-in-1 in ${fen}`).toBeGreaterThan(0);

      const out = searchTier(fen, 'konungr', 42);
      const chosen = matchMove(pos, out.move);
      expect(chosen, `AI move must be legal in ${fen}`).not.toBeNull();
      expect(status(applyMove(pos, chosen!)), `AI must mate in ${fen}`).toBe(
        'checkmate',
      );
    },
    20_000,
  );
});

// ── Mate in 2 — konungr finds the mating move ───────────────────────────────
// Verified exhaustively: the position has no mate-in-1, and after the AI's
// move EVERY opponent reply loses to a mate-in-1 (which konungr also finds).

const MATE_IN_2: string[] = [
  'k7/8/8/8/8/8/3R4/2R4K w - - 0 1',
  '2r4k/3r4/8/8/8/8/8/K7 b - - 0 1',
  'k7/8/2K5/8/8/7Q/8/8 w - - 0 1',
  '8/8/7q/8/8/2k5/8/K7 b - - 0 1',
  '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1',
  '1r4k1/r7/8/8/8/8/8/7K b - - 0 1',
];

describe('mate in 2 (konungr)', () => {
  it.each(MATE_IN_2)(
    '%s',
    (fen) => {
      const pos = fromFEN(fen);
      expect(status(pos)).toBe('active');
      const m1 = legalMoves(pos).filter(
        (m) => status(applyMove(pos, m)) === 'checkmate',
      );
      expect(m1.length, `no mate-in-1 should exist in ${fen}`).toBe(0);

      const out = searchTier(fen, 'konungr', 7);
      const first = matchMove(pos, out.move);
      expect(first, `AI move must be legal in ${fen}`).not.toBeNull();
      const p1 = applyMove(pos, first!);
      expect(status(p1), `AI move must not throw the position away`).toBe('active');

      for (const reply of legalMoves(p1)) {
        const p2 = applyMove(p1, reply);
        const out2 = searchTier(toFEN(p2), 'konungr', 7);
        const finisher = matchMove(p2, out2.move);
        expect(finisher, `finisher must be legal after ${moveToRecord(p1, reply).san}`).not.toBeNull();
        expect(
          status(applyMove(p2, finisher!)),
          `must mate after reply ${moveToRecord(p1, reply).san} in ${fen}`,
        ).toBe('checkmate');
      }
    },
    30_000,
  );
});

// ── Never illegal ───────────────────────────────────────────────────────────
// 200 random positions (seeded playouts) × every tier: the returned move is
// always in legalMoves(). Legality can't depend on how long we think, so the
// strong tiers run with a small budget override to keep the sweep fast;
// thrall and karl run their real budgets (their depth caps finish early).

describe('never illegal', () => {
  const rng = mulberry32(0xc0ffee);
  const fens: string[] = [];
  for (let i = 0; i < 200; i++) fens.push(randomActiveFen(rng));

  it.each(TIERS)(
    'tier %s returns a legal move on all 200 positions',
    (tier) => {
      const override = tier === 'jarl' || tier === 'konungr' ? 40 : undefined;
      for (let i = 0; i < fens.length; i++) {
        const pos = fromFEN(fens[i]);
        const out = searchTier(fens[i], tier, i + 1, override);
        expect(out.move, `move expected in active position ${fens[i]}`).not.toBeNull();
        expect(
          matchMove(pos, out.move),
          `illegal move ${JSON.stringify(out.move)} from ${tier} in ${fens[i]}`,
        ).not.toBeNull();
      }
    },
    120_000,
  );
});

// ── Determinism ─────────────────────────────────────────────────────────────
// Same (fen, tier, seed) twice = same move. Thrall and karl are depth-capped
// (they finish far inside their budgets), so this holds on any machine.

describe('determinism', () => {
  it(
    'same fen+tier+seed twice = same move (50 positions × thrall, karl)',
    () => {
      const rng = mulberry32(0x5eed);
      for (let i = 0; i < 50; i++) {
        const fen = randomActiveFen(rng);
        for (const tier of ['thrall', 'karl'] as const) {
          const a = searchTier(fen, tier, 1000 + i);
          const b = searchTier(fen, tier, 1000 + i);
          expect(b.move, `${tier} nondeterministic on ${fen}`).toEqual(a.move);
        }
      }
    },
    120_000,
  );

  it('konungr is deterministic on decided positions (mate early-stop)', () => {
    for (const fen of MATE_IN_1.slice(0, 4)) {
      const a = searchTier(fen, 'konungr', 99);
      const b = searchTier(fen, 'konungr', 99);
      expect(b.move).toEqual(a.move);
    }
  });

  it('different seeds may break ties differently but stay legal', () => {
    const fen = INITIAL_FEN;
    for (const seed of [1, 2, 3, 4, 5]) {
      const out = searchTier(fen, 'thrall', seed);
      expect(matchMove(fromFEN(fen), out.move)).not.toBeNull();
    }
  });
});

// ── Budget ──────────────────────────────────────────────────────────────────

describe('time budget', () => {
  it(
    'konungr returns within 4000ms + 20% on a middlegame position',
    () => {
      const fen =
        'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2P1PN2/PP1N1PPP/R2QKB1R w KQ - 0 8';
      const t0 = Date.now();
      const out = searchTier(fen, 'konungr', 11);
      const wall = Date.now() - t0;
      expect(out.move).not.toBeNull();
      expect(wall).toBeLessThanOrEqual(4800);
      expect(out.timeMs).toBeLessThanOrEqual(4800);
      expect(out.depth).toBeGreaterThanOrEqual(4);
    },
    15_000,
  );
});

// ── Worker protocol (driven as a module, the Node path) ─────────────────────

describe('worker protocol', () => {
  it('search → bestmove with matching generation and diagnostics', () => {
    const replies: AiReply[] = [];
    handleRequest(
      { type: 'search', fen: INITIAL_FEN, tier: 'thrall', generation: 3, seed: 9 },
      (r) => replies.push(r),
    );
    expect(replies).toHaveLength(1);
    const r = replies[0];
    expect(r.type).toBe('bestmove');
    expect(r.generation).toBe(3);
    expect(r.move).not.toBeNull();
    expect(matchMove(fromFEN(INITIAL_FEN), r.move)).not.toBeNull();
    expect(r.depth).toBeGreaterThanOrEqual(1);
    expect(r.nodes).toBeGreaterThan(0);
    expect(r.timeMs).toBeGreaterThanOrEqual(0);
  });

  it('cancel discards that generation, later generations still reply', () => {
    const replies: AiReply[] = [];
    handleRequest({ type: 'cancel', generation: 7 }, (r) => replies.push(r));
    handleRequest(
      { type: 'search', fen: INITIAL_FEN, tier: 'thrall', generation: 7, seed: 1 },
      (r) => replies.push(r),
    );
    expect(replies).toHaveLength(0);
    handleRequest(
      { type: 'search', fen: INITIAL_FEN, tier: 'thrall', generation: 8, seed: 1 },
      (r) => replies.push(r),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0].generation).toBe(8);
  });
});
