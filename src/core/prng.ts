/** Deterministic PRNG. The only sanctioned source of variation in the game. */

export type PRNG = () => number;

/** mulberry32 — fast, solid distribution, one 32-bit word of state. */
export function mulberry32(seed: number): PRNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit avalanche hash for deriving sub-seeds (duel variants, AI jitter). */
export function hash32(...words: number[]): number {
  let h = 0x811c9dc5;
  for (const w of words) {
    let x = w >>> 0;
    for (let i = 0; i < 4; i++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
