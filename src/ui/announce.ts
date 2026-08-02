import type { Color, GameEvent, GameStatus, MoveRecord, PieceType } from '../core/contract.ts';
import { squareName } from '../core/contract.ts';

export const PIECE_LABEL: Record<PieceType, string> = {
  p: 'Huscarl',
  n: 'Berserkr',
  b: 'Völva',
  r: 'Jötunn',
  q: 'Valkyrie',
  k: 'Jarl',
};

export const sideLabel = (c: Color): string => (c === 'w' ? 'White' : 'Black');

export function describeMove(r: MoveRecord): string {
  let body: string;
  const side = sideLabel(r.color);
  if (r.castle) {
    body = `${side} castles ${r.castle === 'k' ? 'kingside' : 'queenside'}`;
  } else {
    const piece = PIECE_LABEL[r.piece];
    body = r.capture
      ? `${side} ${piece} takes ${PIECE_LABEL[r.capture.type]} on ${squareName(r.to)}`
      : `${side} ${piece} to ${squareName(r.to)}`;
    if (r.enPassant) body += ' en passant';
    if (r.promotion) body += `, promoted to ${PIECE_LABEL[r.promotion]}`;
  }
  if (r.checkmate) body += ', checkmate';
  else if (r.check) body += ', check';
  return `${body} (${r.san})`;
}

export function describeStatus(status: GameStatus, turn: Color): string {
  switch (status) {
    case 'active':
      return `${sideLabel(turn)} to move.`;
    case 'checkmate':
      return `Checkmate. ${sideLabel(turn === 'w' ? 'b' : 'w')} wins.`;
    case 'stalemate':
      return 'Draw by stalemate.';
    case 'draw-fifty':
      return 'Draw by the fifty-move rule.';
    case 'draw-repetition':
      return 'Draw by threefold repetition.';
    case 'draw-material':
      return 'Draw by insufficient material.';
  }
}

export function describeEvent(e: GameEvent): string {
  const status = describeStatus(e.status, e.turn);
  switch (e.kind) {
    case 'newgame':
      return `New game. ${status}`;
    case 'load':
      return `Position loaded. ${status}`;
    case 'undo':
      return `Move undone. ${status}`;
    case 'move':
    case 'redo': {
      const prefix = e.kind === 'redo' ? 'Redone: ' : '';
      return e.record ? `${prefix}${describeMove(e.record)}. ${status}` : status;
    }
  }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
