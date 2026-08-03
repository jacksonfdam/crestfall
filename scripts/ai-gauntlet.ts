/**
 * AI gauntlet: every tier must beat a uniform random mover 100% of the time.
 * A draw counts as failure. Exits 1 on any non-win.
 *
 *   node --experimental-strip-types scripts/ai-gauntlet.ts [N] [tier ...]
 *
 * N defaults to 100. With no tiers named, all four run. The AI alternates
 * colors game by game; both the random mover and the AI's tie-break seed
 * derive from the game index, so runs are reproducible.
 */

import {
  INITIAL_FEN,
  applyMove,
  fromFEN,
  legalMoves,
  moveToRecord,
  status,
  toFEN,
  type Position,
} from '../src/engine/index.ts';
import { searchTier } from '../src/ai/index.ts';
import type { AiTier, PieceType } from '../src/core/contract.ts';
import { hash32, mulberry32 } from '../src/core/prng.ts';

// @types/node is not installed; declare the Node globals this script uses.
declare const process: { argv: string[]; exit(code: number): never };

const ALL_TIERS: AiTier[] = ['thrall', 'karl', 'jarl', 'konungr'];
const PLY_CAP = 600;

const args = process.argv.slice(2);
const nArg = args.length > 0 && /^\d+$/.test(args[0]) ? parseInt(args[0], 10) : 100;
const tierArgs = args.filter((a) => (ALL_TIERS as string[]).includes(a)) as AiTier[];
const tiers = tierArgs.length > 0 ? tierArgs : ALL_TIERS;

function findMove(
  pos: Position,
  mv: { from: number; to: number; promotion?: PieceType } | null,
): number | null {
  if (!mv) return null;
  for (const m of legalMoves(pos)) {
    const r = moveToRecord(pos, m);
    if (r.from === mv.from && r.to === mv.to && r.promotion === mv.promotion) return m;
  }
  return null;
}

/** Returns 'win' | 'draw' | 'loss' from the AI's point of view. */
function playGame(tier: AiTier, gameIndex: number): 'win' | 'draw' | 'loss' {
  const aiColor = gameIndex % 2 === 0 ? 'w' : 'b';
  const rng = mulberry32(hash32(0x5eed, gameIndex, tier.length));
  let pos = fromFEN(INITIAL_FEN);
  let ply = 0;

  while (status(pos) === 'active' && ply < PLY_CAP) {
    if (pos.turn === aiColor) {
      const out = searchTier(toFEN(pos), tier, hash32(gameIndex, ply));
      const m = findMove(pos, out.move);
      if (m === null) {
        console.error(
          `ILLEGAL/NULL AI move ${JSON.stringify(out.move)} at ${toFEN(pos)}`,
        );
        return 'loss';
      }
      pos = applyMove(pos, m);
    } else {
      const ms = legalMoves(pos);
      pos = applyMove(pos, ms[Math.floor(rng() * ms.length)]);
    }
    ply++;
  }

  const st = status(pos);
  if (st === 'checkmate') return pos.turn === aiColor ? 'loss' : 'win';
  return 'draw'; // stalemate, any draw rule, or ply cap — all count as failure
}

let failed = false;
for (const tier of tiers) {
  let w = 0;
  let d = 0;
  let l = 0;
  const t0 = Date.now();
  for (let g = 0; g < nArg; g++) {
    const res = playGame(tier, g);
    if (res === 'win') w++;
    else if (res === 'draw') {
      d++;
      console.error(`  non-win: ${tier} game ${g} → draw`);
    } else {
      l++;
      console.error(`  non-win: ${tier} game ${g} → LOSS`);
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = w === nArg;
  if (!ok) failed = true;
  console.log(
    `${tier.padEnd(8)} vs random: W ${w} / D ${d} / L ${l} of ${nArg}  (${secs}s) ${ok ? 'OK' : 'FAIL'}`,
  );
}

process.exit(failed ? 1 : 0);
