/**
 * Desync fuzz — the test this whole architecture exists to pass.
 *
 * Plays random legal games with duels enabled, randomly skipping and
 * interrupting them, then asserts the board derived from the SCENE GRAPH
 * equals the headless engine's board, after every move and every game.
 *
 * It drives the real Stage.prototype.syncBoard / deriveBoard rather than a
 * reimplementation. Stage's constructor needs a WebGL context, so the harness
 * builds an object on Stage's prototype and populates only the fields those
 * two methods touch — the shipping code paths run unmodified.
 */

import * as THREE from 'three';
import {
  INITIAL_FEN,
  fromFEN,
  toFEN,
  legalMoves,
  applyMove,
  moveToRecord,
  status,
  type Position,
} from '../src/engine/index.ts';
import {
  boardFromFEN,
  PIECE_CHARACTER,
  type Board64,
  type MoveRecord,
  type Square,
} from '../src/core/contract.ts';
import type { CharacterRig, DuelContext } from '../src/core/stage.ts';
import { mulberry32 } from '../src/core/prng.ts';
import { Stage, type RigBuilder } from '../src/render/stage.ts';
import { buildCharacter } from '../src/chars/index.ts';
import { DUEL_MATRIX, pickDuel } from '../src/duels/index.ts';

const GAMES = Number(process.argv[2] ?? 300);
const MAX_PLIES = 200;

const builder: RigBuilder = (name, faction, opts) => buildCharacter(name, faction, opts);

/** A Stage limited to its piece-management surface, no WebGL required. */
function headlessStage(reducedMotion: boolean): Stage {
  const s = Object.create(Stage.prototype) as Stage;
  const w = s as unknown as Record<string, unknown>;
  w.pieceLayer = new THREE.Group();
  w.pieces = new Map();
  w.glides = [];
  w.lastBuilder = null;
  w.variantHook = null;
  w.viewMode = '3d';
  w.reducedMotion = reducedMotion;
  return s;
}

function boardsEqual(a: Board64, b: Board64): string | null {
  for (let sq = 0; sq < 64; sq++) {
    const x = a[sq];
    const y = b[sq];
    if (!x && !y) continue;
    if (!x || !y || x.type !== y.type || x.color !== y.color) {
      const f = 'abcdefgh'[sq & 7] + String((sq >> 3) + 1);
      const show = (p: typeof x) => (p ? `${p.color}${p.type}` : 'empty');
      return `${f}: scene=${show(a[sq])} engine=${show(b[sq])}`;
    }
  }
  return null;
}

let failures = 0;
let totalPlies = 0;
let totalDuels = 0;
let skipped = 0;
let interrupted = 0;

for (let g = 0; g < GAMES; g++) {
  const seed = 0x63726573 ^ (g * 2654435761);
  const rnd = mulberry32(seed);
  const stage = headlessStage(g % 5 === 0);

  let pos: Position = fromFEN(INITIAL_FEN);
  stage.syncBoard(boardFromFEN(toFEN(pos)), builder);

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    if (status(pos) !== 'active') break;
    const moves = legalMoves(pos);
    if (moves.length === 0) break;

    const move = moves[Math.floor(rnd() * moves.length)];
    const record = moveToRecord(pos, move);
    pos = applyMove(pos, move);
    totalPlies++;

    // Presentation timeline: the capture is already resolved in `pos` before
    // a single frame plays. Whatever we do to the duel here must not matter.
    if (record.capture) {
      totalDuels++;
      const key = `${record.piece}x${record.capture.type}`;
      const variants = DUEL_MATRIX[key];
      if (variants && variants.length > 0) {
        const idx = pickDuel(seed, ply, record.piece, record.capture.type);
        const script = variants[idx % variants.length];
        const attacker = buildCharacter(
          PIECE_CHARACTER[record.piece],
          record.color === 'w' ? 'ash' : 'ember',
        );
        const victim = buildCharacter(
          PIECE_CHARACTER[record.capture.type],
          record.capture.color === 'w' ? 'ash' : 'ember',
        );
        const ctx = stubContext(
          attacker,
          victim,
          record as MoveRecord & { capture: NonNullable<MoveRecord['capture']> },
          seed + ply,
        );

        const roll = rnd();
        if (roll < 0.25) {
          skipped++;
          script.update(1, ctx); // instant-skip path
        } else if (roll < 0.6) {
          interrupted++;
          // Abandon mid-frame at 4x speed, as a real interruption would.
          const stopAt = 0.05 + rnd() * 0.9;
          for (let t = 0; t < stopAt; t += 0.08) script.update(t, ctx);
        } else {
          for (let t = 0; t <= 1.0001; t += 0.08) script.update(Math.min(t, 1), ctx);
        }
        attacker.dispose();
        victim.dispose();
      }
    }

    stage.syncBoard(boardFromFEN(toFEN(pos)), builder);

    const mismatch = boardsEqual(stage.deriveBoard(), boardFromFEN(toFEN(pos)));
    if (mismatch) {
      failures++;
      console.error(`FAIL game ${g} ply ${ply} (${record.san}): ${mismatch}`);
      console.error(`  engine FEN: ${toFEN(pos)}`);
      break;
    }
  }

  // End-of-game gate: derived FEN placement must equal the engine's.
  const derivedPlacement = placementOf(stage.deriveBoard());
  const enginePlacement = toFEN(pos).split(' ')[0];
  if (derivedPlacement !== enginePlacement) {
    failures++;
    console.error(`FAIL game ${g} final: scene=${derivedPlacement} engine=${enginePlacement}`);
  }
}

function placementOf(board: Board64): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let gap = 0;
    for (let file = 0; file < 8; file++) {
      const p = board[rank * 8 + file];
      if (!p) {
        gap++;
        continue;
      }
      if (gap) {
        row += String(gap);
        gap = 0;
      }
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    if (gap) row += String(gap);
    rows.push(row);
  }
  return rows.join('/');
}

function stubContext(
  attacker: CharacterRig,
  victim: CharacterRig,
  record: MoveRecord & { capture: NonNullable<MoveRecord['capture']> },
  seed: number,
): DuelContext {
  const noop = () => {};
  return {
    attacker,
    victim,
    attackerPiece: record.piece,
    victimPiece: record.capture.type,
    camera: {
      camera: new THREE.PerspectiveCamera(),
      moveTo: noop,
      shake: noop,
      release: noop,
    },
    prng: mulberry32(seed),
    attackerPos: worldOf(record.from),
    victimPos: worldOf(record.to),
    cue: noop,
  };
}

function worldOf(sq: Square): [number, number, number] {
  return [(sq & 7) - 3.5, 0, 3.5 - (sq >> 3)];
}

const label = `${GAMES} games, ${totalPlies} plies, ${totalDuels} duels (${skipped} skipped, ${interrupted} interrupted mid-frame)`;
if (failures > 0) {
  console.error(`\nDESYNC FUZZ FAILED — ${failures} mismatch(es) across ${label}`);
  process.exit(1);
}
console.log(`Desync fuzz PASS — ${label}; scene-derived board matched engine truth every time.`);
