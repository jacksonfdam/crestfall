/** Perft validation table — exits 1 on any mismatch. */

import { INITIAL_FEN, fromFEN, perft } from '../src/engine/index.ts';

// @types/node is not installed; declare the one Node global this script uses.
declare const process: { exit(code: number): never };

const CASES: { name: string; fen: string; counts: number[] }[] = [
  {
    name: 'Initial position',
    fen: INITIAL_FEN,
    counts: [20, 400, 8902, 197281, 4865609, 119060324],
  },
  {
    name: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2039, 97862, 4085603, 193690690],
  },
  {
    name: 'Position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2812, 43238, 674624, 11030083],
  },
  {
    name: 'Position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9467, 422333, 15833292],
  },
  {
    name: 'Position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1486, 62379, 2103487, 89941194],
  },
  {
    name: 'Position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2079, 89890, 3894594, 164075551],
  },
];

let failed = false;
let totalNodes = 0;
const t0 = performance.now();

for (const c of CASES) {
  const pos = fromFEN(c.fen);
  console.log(`\n${c.name}  (${c.fen})`);
  for (let d = 1; d <= c.counts.length; d++) {
    const expected = c.counts[d - 1];
    const s0 = performance.now();
    const got = perft(pos, d);
    const dt = performance.now() - s0;
    totalNodes += got;
    const ok = got === expected;
    if (!ok) failed = true;
    console.log(
      `  d${d}: ${ok ? 'PASS' : 'FAIL'}  got=${got} expected=${expected}  (${dt.toFixed(0)} ms)`,
    );
  }
}

const secs = (performance.now() - t0) / 1000;
console.log(
  `\n${failed ? 'FAILED' : 'ALL PASS'} — ${totalNodes} nodes in ${secs.toFixed(1)} s ` +
    `(${Math.round(totalNodes / secs).toLocaleString('en-US')} nodes/sec)`,
);
process.exit(failed ? 1 : 0);
