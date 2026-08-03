/**
 * Determinism gate: the same seed must produce byte-identical duel
 * choreography, run after run. This is what makes replay validation possible.
 *
 * Two levels are checked:
 *   1. Variant selection — which duel script fires for each capture.
 *   2. Pose output — the actual bone transforms sampled across the timeline,
 *      hashed to a digest. A single differing float changes the digest.
 */

import * as THREE from 'three';
import {
  INITIAL_FEN,
  fromFEN,
  legalMoves,
  applyMove,
  moveToRecord,
  status,
  type Position,
} from '../src/engine/index.ts';
import { PIECE_CHARACTER, type MoveRecord, type Square } from '../src/core/contract.ts';
import type { CharacterRig, DuelContext } from '../src/core/stage.ts';
import { mulberry32 } from '../src/core/prng.ts';
import { buildCharacter } from '../src/chars/index.ts';
import { DUEL_MATRIX, pickDuel } from '../src/duels/index.ts';

const GAMES = Number(process.argv[2] ?? 1000);
const RUNS = 2;

/** FNV-1a over the float bits of every bone transform we sample. */
class Digest {
  private h = 0x811c9dc5;
  private readonly buf = new DataView(new ArrayBuffer(8));

  push(n: number): void {
    this.buf.setFloat64(0, Object.is(n, -0) ? 0 : n);
    for (let i = 0; i < 8; i++) {
      this.h ^= this.buf.getUint8(i);
      this.h = Math.imul(this.h, 0x01000193);
    }
  }

  pushString(s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i);
      this.h = Math.imul(this.h, 0x01000193);
    }
  }

  get value(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

function sampleRig(rig: CharacterRig, digest: Digest): void {
  rig.root.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const name of Object.keys(rig.bones).sort()) {
    const bone = rig.bones[name as keyof typeof rig.bones];
    if (!bone) continue;
    bone.matrixWorld.decompose(p, q, s);
    digest.pushString(name);
    digest.push(p.x);
    digest.push(p.y);
    digest.push(p.z);
    digest.push(q.x);
    digest.push(q.y);
    digest.push(q.z);
    digest.push(q.w);
    digest.push(s.x);
    digest.push(s.y);
    digest.push(s.z);
  }
}

function stubContext(
  attacker: CharacterRig,
  victim: CharacterRig,
  record: MoveRecord & { capture: NonNullable<MoveRecord['capture']> },
  seed: number,
  cues: string[],
): DuelContext {
  const worldOf = (sq: Square): [number, number, number] => [
    (sq & 7) - 3.5,
    0,
    3.5 - (sq >> 3),
  ];
  return {
    attacker,
    victim,
    attackerPiece: record.piece,
    victimPiece: record.capture.type,
    camera: {
      camera: new THREE.PerspectiveCamera(),
      moveTo: (pos, look, t) => cues.push(`cam:${pos.join()}|${look.join()}|${t}`),
      shake: (i) => cues.push(`shake:${i}`),
      release: () => cues.push('release'),
    },
    prng: mulberry32(seed),
    attackerPos: worldOf(record.from),
    victimPos: worldOf(record.to),
    cue: (n, i) => cues.push(`${n}:${i ?? 1}`),
  };
}

/** Replay one seeded game and digest every duel it produces. */
function runGame(gameIndex: number): string {
  const seed = 0x63726573 ^ (gameIndex * 2654435761);
  const rnd = mulberry32(seed);
  const digest = new Digest();
  let pos: Position = fromFEN(INITIAL_FEN);

  for (let ply = 0; ply < 160; ply++) {
    if (status(pos) !== 'active') break;
    const moves = legalMoves(pos);
    if (moves.length === 0) break;
    const move = moves[Math.floor(rnd() * moves.length)];
    const record = moveToRecord(pos, move);
    pos = applyMove(pos, move);

    if (!record.capture) continue;
    const key = `${record.piece}x${record.capture.type}`;
    const variants = DUEL_MATRIX[key];
    if (!variants || variants.length === 0) continue;

    const script = pickDuel(seed, ply, record.piece, record.capture.type);
    if (!script) continue;
    // Record WHICH variant fired, not just its poses: a changed selection
    // must fail the gate even if the two variants happened to pose alike.
    digest.pushString(`${key}#${variants.indexOf(script)}`);
    const attacker = buildCharacter(
      PIECE_CHARACTER[record.piece],
      record.color === 'w' ? 'ash' : 'ember',
    );
    const victim = buildCharacter(
      PIECE_CHARACTER[record.capture.type],
      record.capture.color === 'w' ? 'ash' : 'ember',
    );
    const cues: string[] = [];
    const ctx = stubContext(
      attacker,
      victim,
      record as MoveRecord & { capture: NonNullable<MoveRecord['capture']> },
      seed + ply,
      cues,
    );

    for (let step = 0; step <= 10; step++) {
      script.update(step / 10, ctx);
      sampleRig(attacker, digest);
      sampleRig(victim, digest);
    }
    for (const c of cues) digest.pushString(c);

    attacker.dispose();
    victim.dispose();
  }
  return digest.value;
}

const runs: string[][] = [];
for (let r = 0; r < RUNS; r++) {
  const digests: string[] = [];
  for (let g = 0; g < GAMES; g++) digests.push(runGame(g));
  runs.push(digests);
}

let mismatches = 0;
for (let g = 0; g < GAMES; g++) {
  for (let r = 1; r < RUNS; r++) {
    if (runs[r][g] !== runs[0][g]) {
      mismatches++;
      console.error(`FAIL game ${g}: run0=${runs[0][g]} run${r}=${runs[r][g]}`);
    }
  }
}

// A digest set that is all-identical would mean we hashed nothing useful.
const distinct = new Set(runs[0]).size;
if (distinct < 2) {
  console.error(`FAIL: all ${GAMES} games produced digest ${runs[0][0]} — harness is not sampling.`);
  process.exit(1);
}

if (mismatches > 0) {
  console.error(`\nDETERMINISM FAILED — ${mismatches} mismatch(es) across ${GAMES} games.`);
  process.exit(1);
}
console.log(
  `Determinism PASS — ${GAMES} seeded games x ${RUNS} runs, byte-identical choreography (${distinct} distinct game digests).`,
);
