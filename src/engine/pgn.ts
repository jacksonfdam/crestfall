/** PGN import (headers, comments, NAGs, variations) and export. */

import type { MoveRecord } from '../core/contract.ts';
import {
  INITIAL_FEN, Position, applyMove, fromFEN, type EngineMove,
} from './position.ts';
import { sanToMove } from './san.ts';

export function importPGN(
  pgn: string,
): { moves: EngineMove[]; positions: Position[] } | null {
  const fenMatch = /\[\s*FEN\s+"([^"]+)"\s*\]/.exec(pgn);
  let text = pgn
    .replace(/^\s*\[[^\]]*\]\s*$/gm, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ');
  let depth = text.length + 1;
  while (/\([^()]*\)/.test(text) && text.length < depth) {
    depth = text.length;
    text = text.replace(/\([^()]*\)/g, ' ');
  }
  if (text.includes('(') || text.includes(')')) return null;
  text = text
    .replace(/\$\d+/g, ' ')
    .replace(/\b(1-0|0-1|1\/2-1\/2)\b/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\.\.\./g, ' ');

  let pos: Position;
  try {
    pos = fromFEN(fenMatch ? fenMatch[1] : INITIAL_FEN);
  } catch {
    return null;
  }
  const moves: EngineMove[] = [];
  const positions: Position[] = [];
  for (const token of text.split(/\s+/)) {
    if (token === '') continue;
    const m = sanToMove(pos, token);
    if (m === null) return null;
    pos = applyMove(pos, m);
    moves.push(m);
    positions.push(pos);
  }
  return { moves, positions };
}

export function exportPGN(records: MoveRecord[], result: string): string {
  const tokens: string[] = [];
  let moveNo = 1;
  let expectWhite = true;
  for (const rec of records) {
    if (rec.color === 'w') {
      tokens.push(`${moveNo}.`);
      expectWhite = false;
    } else {
      if (expectWhite) tokens.push(`${moveNo}...`);
      expectWhite = true;
      moveNo++;
    }
    tokens.push(rec.san);
  }
  tokens.push(result);
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    if (line === '') line = tok;
    else if (line.length + tok.length + 1 <= 80) line += ' ' + tok;
    else {
      lines.push(line);
      line = tok;
    }
  }
  if (line !== '') lines.push(line);
  return (
    '[Event "CRESTFALL"]\n' +
    '[Site "?"]\n' +
    '[Date "????.??.??"]\n' +
    '[Round "?"]\n' +
    '[White "?"]\n' +
    '[Black "?"]\n' +
    `[Result "${result}"]\n\n` +
    lines.join('\n') +
    '\n'
  );
}
