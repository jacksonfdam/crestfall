import { describe, expect, it } from 'vitest';
import {
  INITIAL_FEN,
  applyMove,
  exportPGN,
  fromFEN,
  importPGN,
  inCheck,
  legalMoves,
  moveToRecord,
  sanToMove,
  status,
  toFEN,
  type Position,
} from '../src/engine/index.ts';

function sans(pos: Position): string[] {
  return legalMoves(pos).map((m) => moveToRecord(pos, m).san);
}

function play(pos: Position, ...moves: string[]): Position {
  let p = pos;
  for (const s of moves) {
    const m = sanToMove(p, s);
    expect(m, `expected ${s} to be legal in ${toFEN(p)}`).not.toBeNull();
    p = applyMove(p, m!);
  }
  return p;
}

describe('FEN round-trip', () => {
  const fens = [
    INITIAL_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
    'r3k2r/8/8/8/8/8/8/R3K2R b Kq - 12 34',
    '4k3/8/8/8/8/8/8/4K2R w K - 99 120',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  ];
  it.each(fens)('%s', (fen) => {
    expect(toFEN(fromFEN(fen))).toBe(fen);
  });

  it('rejects FEN without kings', () => {
    expect(() => fromFEN('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow();
  });
});

describe('SAN disambiguation', () => {
  it('disambiguates by file', () => {
    const pos = fromFEN('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
    const list = sans(pos);
    expect(list).toContain('Rab1');
    expect(list).toContain('Rhb1');
    expect(list).not.toContain('Rb1');
  });

  it('disambiguates by rank', () => {
    const pos = fromFEN('4k3/8/8/8/R7/8/8/R3K3 w - - 0 1');
    const list = sans(pos);
    expect(list).toContain('R4a2');
    expect(list).toContain('R1a2');
  });

  it('disambiguates by file and rank with three queens', () => {
    const pos = fromFEN('1k6/8/8/8/4Q2Q/8/8/K6Q w - - 0 1');
    const list = sans(pos);
    expect(list).toContain('Qh4e1');
    expect(list).toContain('Qee1');
    expect(list).toContain('Q1e1');
  });

  it('does not add needless disambiguation', () => {
    const pos = fromFEN(INITIAL_FEN);
    expect(sans(pos)).toContain('Nf3');
  });

  it('sanToMove accepts over-disambiguated input', () => {
    const pos = fromFEN(INITIAL_FEN);
    expect(sanToMove(pos, 'Ngf3')).not.toBeNull();
    expect(sanToMove(pos, 'Nf3')).toBe(sanToMove(pos, 'Ngf3'));
  });
});

describe('en passant', () => {
  it('generates a legal en passant capture', () => {
    const pos = fromFEN('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3');
    const m = sanToMove(pos, 'dxe3');
    expect(m).not.toBeNull();
    const rec = moveToRecord(pos, m!);
    expect(rec.enPassant).toBe(true);
    expect(rec.capture).toEqual({ type: 'p', color: 'w', square: 28 });
  });

  it('rejects the horizontally-pinned en passant capture', () => {
    const pos = fromFEN('8/8/8/8/k2Pp2R/8/8/4K3 b - d3 0 1');
    expect(sanToMove(pos, 'exd3')).toBeNull();
    expect(sans(pos)).not.toContain('exd3');
  });

  it('allows en passant that resolves a pawn check', () => {
    const pos = fromFEN('8/8/8/2k5/3Pp3/8/8/4K3 b - d3 0 1');
    expect(sanToMove(pos, 'exd3')).not.toBeNull();
  });
});

describe('castling legality', () => {
  it('rejects castling through an attacked square', () => {
    const pos = fromFEN('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1');
    const list = sans(pos);
    expect(list).not.toContain('O-O');
    expect(list).toContain('O-O-O');
  });

  it('rejects castling while in check', () => {
    const pos = fromFEN('r3k2r/8/8/8/8/4r3/8/R3K2R w KQkq - 0 1');
    const list = sans(pos);
    expect(list).not.toContain('O-O');
    expect(list).not.toContain('O-O-O');
  });

  it('rejects castling into check', () => {
    const pos = fromFEN('r3k2r/8/8/8/8/6r1/8/R3K2R w KQkq - 0 1');
    expect(sans(pos)).not.toContain('O-O');
  });

  it('allows castling when only the rook path is attacked', () => {
    const pos = fromFEN('r3k2r/8/8/8/8/1r6/8/R3K2R w KQkq - 0 1');
    expect(sans(pos)).toContain('O-O-O');
  });

  it('moves king and rook and clears rights', () => {
    const pos = fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const next = applyMove(pos, sanToMove(pos, 'O-O')!);
    expect(toFEN(next)).toBe('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
  });
});

describe('promotion', () => {
  it('offers all four promotion pieces', () => {
    const pos = fromFEN('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    const list = sans(pos);
    for (const s of ['a8=Q', 'a8=R', 'a8=B', 'a8=N']) expect(list).toContain(s);
  });

  it('applies an underpromotion capture', () => {
    const pos = fromFEN('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const m = sanToMove(pos, 'axb8=N');
    expect(m).not.toBeNull();
    const rec = moveToRecord(pos, m!);
    expect(rec.promotion).toBe('n');
    expect(rec.capture?.type).toBe('n');
    const next = applyMove(pos, m!);
    expect(toFEN(next).split(' ')[0]).toBe('1N2k3/8/8/8/8/8/8/4K3');
  });

  it('parses e8Q as promotion SAN', () => {
    const pos = fromFEN('4k3/8/8/8/8/8/p7/4K3 b - - 0 1');
    expect(sanToMove(pos, 'a1Q')).toBe(sanToMove(pos, 'a1=Q'));
  });
});

describe('draw and mate detection', () => {
  it('detects checkmate and marks SAN with #', () => {
    const pos = fromFEN(INITIAL_FEN);
    const mate = play(pos, 'f3', 'e5', 'g4');
    const qh4 = sanToMove(mate, 'Qh4')!;
    expect(moveToRecord(mate, qh4).san).toBe('Qh4#');
    const done = applyMove(mate, qh4);
    expect(status(done)).toBe('checkmate');
    expect(inCheck(done)).toBe(true);
  });

  it('detects stalemate', () => {
    const pos = fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(status(pos)).toBe('stalemate');
    expect(inCheck(pos)).toBe(false);
  });

  it('detects the fifty-move rule', () => {
    const pos = fromFEN('4k3/8/8/8/8/8/8/4K2R w K - 99 80');
    const next = applyMove(pos, sanToMove(pos, 'Rh2')!);
    expect(next.halfmove).toBe(100);
    expect(status(next)).toBe('draw-fifty');
  });

  it('prefers checkmate over the fifty-move rule', () => {
    const pos = fromFEN('k7/8/1QK5/8/8/8/8/8 w - - 99 80');
    const next = applyMove(pos, sanToMove(pos, 'Qb7')!);
    expect(status(next)).toBe('checkmate');
  });

  it('detects threefold repetition', () => {
    let pos = fromFEN(INITIAL_FEN);
    pos = play(pos, 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1');
    expect(status(pos)).toBe('active');
    pos = play(pos, 'Ng8');
    expect(status(pos)).toBe('draw-repetition');
  });

  it('resets repetition tracking on irreversible moves', () => {
    let pos = fromFEN(INITIAL_FEN);
    pos = play(pos, 'e4', 'e5', 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1');
    expect(status(pos)).toBe('active');
  });

  const materialCases: [string, string][] = [
    ['4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'draw-material'],
    ['4k3/8/8/8/8/8/8/2B1K3 w - - 0 1', 'draw-material'],
    ['4k3/8/8/8/8/8/8/2N1K3 w - - 0 1', 'draw-material'],
    ['2b1k3/8/8/8/8/8/8/1B2K3 w - - 0 1', 'draw-material'],
    ['1b2k3/8/8/8/8/8/8/1B2K3 w - - 0 1', 'active'],
    ['4k3/8/8/8/8/8/8/1N2K1N1 w - - 0 1', 'active'],
    ['4k3/8/8/8/8/8/8/3QK3 w - - 0 1', 'active'],
    ['4k3/7p/8/8/8/8/8/4K3 w - - 0 1', 'active'],
  ];
  it.each(materialCases)('material status of %s is %s', (fen, expected) => {
    expect(status(fromFEN(fen))).toBe(expected);
  });
});

describe('applyMove purity', () => {
  it('never mutates the input position', () => {
    const pos = fromFEN(INITIAL_FEN);
    const before = toFEN(pos);
    for (const m of legalMoves(pos)) applyMove(pos, m);
    expect(toFEN(pos)).toBe(before);
    expect(legalMoves(pos)).toHaveLength(20);
  });
});

describe('PGN', () => {
  it('imports headers, comments, NAGs, and variations', () => {
    const pgn = `[Event "Saga"]
[Site "Uppsala"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]

1. e4 {king's pawn} e5 $1 2. Nf3 (2. f4 exf4) 2... Nc6 ; edda
3. Bb5 a6 1/2-1/2`;
    const res = importPGN(pgn);
    expect(res).not.toBeNull();
    expect(res!.moves).toHaveLength(6);
    expect(toFEN(res!.positions[5]).split(' ')[0]).toBe(
      'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R',
    );
  });

  it('returns null on an illegal move', () => {
    expect(importPGN('1. e4 e5 2. Ke2 Ke7 3. Qxd8')).toBeNull();
  });

  it('round-trips export → import', () => {
    let pos = fromFEN(INITIAL_FEN);
    const records = [];
    for (const s of ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6']) {
      const m = sanToMove(pos, s)!;
      records.push(moveToRecord(pos, m));
      pos = applyMove(pos, m);
    }
    const pgn = exportPGN(records, '*');
    expect(pgn).toContain('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 *');
    const back = importPGN(pgn);
    expect(back).not.toBeNull();
    expect(back!.moves.map((m, i) => moveToRecord(i === 0 ? fromFEN(INITIAL_FEN) : back!.positions[i - 1], m).san)).toEqual(
      records.map((r) => r.san),
    );
    expect(toFEN(back!.positions[7])).toBe(toFEN(pos));
  });

  it('numbers a black-first export correctly', () => {
    const pos = fromFEN('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    const m = sanToMove(pos, 'e5')!;
    const pgn = exportPGN([moveToRecord(pos, m)], '*');
    expect(pgn).toContain('1... e5 *');
  });
});
