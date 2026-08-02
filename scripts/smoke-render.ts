/**
 * Headless smoke checks for src/render. Stage needs a browser canvas, so
 * only the math layer and module imports are exercised under Node.
 */

import { squareToWorld, worldToSquare } from '../src/render/boardMath.ts';
import { squareName } from '../src/core/contract.ts';

let failures = 0;
const check = (cond: boolean, msg: string): void => {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
};

for (let sq = 0; sq < 64; sq++) {
  const world = squareToWorld(sq);
  const back = worldToSquare(world);
  check(back === sq, `round-trip ${squareName(sq)}: ${sq} -> [${world}] -> ${back}`);
}

check(squareToWorld(0).join(',') === '-3.5,0,3.5', 'a1 sits near-left at (-3.5, 0, 3.5)');
check(squareToWorld(7).join(',') === '3.5,0,3.5', 'h1 at (3.5, 0, 3.5)');
check(squareToWorld(56).join(',') === '-3.5,0,-3.5', 'a8 at (-3.5, 0, -3.5)');
check(squareToWorld(63).join(',') === '3.5,0,-3.5', 'h8 at (3.5, 0, -3.5)');

check(worldToSquare([-4.6, 0, 0]) === -1, 'off-board west returns -1');
check(worldToSquare([0, 0, 4.6]) === -1, 'off-board south returns -1');
check(worldToSquare([0.2, 0, -0.3]) === worldToSquare([0, 0, 0]), 'nearest-square rounding');

if (typeof document === 'undefined') {
  console.log('Stage construction skipped (no DOM — browser only).');
} else {
  const { Stage } = await import('../src/render/stage.ts');
  check(typeof Stage === 'function', 'Stage class exported');
}

if (failures > 0) {
  throw new Error(`smoke-render: ${failures} failure(s)`);
}
console.log('smoke-render: all checks passed');
