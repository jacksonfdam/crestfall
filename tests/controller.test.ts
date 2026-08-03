import { describe, it, expect } from 'vitest';
import { GameController, type AiPort } from '../src/game/controller.ts';
import type { AiReply, SearchRequest } from '../src/core/aiProtocol.ts';
import { squareIndex } from '../src/core/contract.ts';

/** A worker stand-in that only replies when we tell it to. */
class ManualAi implements AiPort {
  posted: (SearchRequest | { type: 'cancel'; generation: number })[] = [];
  private handler?: (r: AiReply) => void;

  post(req: SearchRequest | { type: 'cancel'; generation: number }): void {
    this.posted.push(req);
  }

  onReply(fn: (r: AiReply) => void): void {
    this.handler = fn;
  }

  get pendingSearch(): SearchRequest | undefined {
    const searches = this.posted.filter((p): p is SearchRequest => p.type === 'search');
    return searches[searches.length - 1];
  }

  /** Deliver a reply for a specific generation (stale generations allowed). */
  reply(generation: number, from: string, to: string): void {
    this.handler?.({
      type: 'bestmove',
      generation,
      move: { from: squareIndex(from), to: squareIndex(to) },
      depth: 1,
      nodes: 1,
      timeMs: 1,
    });
  }
}

const move = (c: GameController, from: string, to: string) =>
  c.tryMove(squareIndex(from), squareIndex(to));

describe('GameController undo in vs-ai', () => {
  it('does not stall when undoing while the AI is thinking', () => {
    const ai = new ManualAi();
    const c = new GameController(ai);
    c.newGame({ mode: 'vs-ai', seed: 1, aiTier: 'karl', humanColor: 'w' });

    expect(move(c, 'e2', 'e4')).toBe(true);
    expect(ai.pendingSearch).toBeDefined(); // AI is thinking, no reply yet

    expect(c.undo()).toBe(true);

    // The human must be able to move again immediately.
    expect(c.getState().turn).toBe('w');
    expect(move(c, 'd2', 'd4')).toBe(true);
  });

  it('discards a reply that arrives for a cancelled search', () => {
    const ai = new ManualAi();
    const c = new GameController(ai);
    c.newGame({ mode: 'vs-ai', seed: 1, aiTier: 'karl', humanColor: 'w' });

    move(c, 'e2', 'e4');
    const staleGeneration = ai.pendingSearch!.generation;
    c.undo();
    ai.reply(staleGeneration, 'e7', 'e5');

    expect(c.history()).toHaveLength(0);
    expect(c.getState().turn).toBe('w');
  });

  it('undoes both plies once the AI has replied', () => {
    const ai = new ManualAi();
    const c = new GameController(ai);
    c.newGame({ mode: 'vs-ai', seed: 1, aiTier: 'karl', humanColor: 'w' });

    move(c, 'e2', 'e4');
    ai.reply(ai.pendingSearch!.generation, 'e7', 'e5');
    expect(c.history()).toHaveLength(2);

    expect(c.undo()).toBe(true);
    expect(c.history()).toHaveLength(0);
    expect(c.getState().turn).toBe('w');
    expect(move(c, 'd2', 'd4')).toBe(true);
  });

  it('undoes a single ply in hotseat', () => {
    const c = new GameController();
    c.newGame({ mode: 'hotseat', seed: 1 });
    move(c, 'e2', 'e4');
    move(c, 'e7', 'e5');
    expect(c.undo()).toBe(true);
    expect(c.history()).toHaveLength(1);
    expect(c.getState().turn).toBe('b');
  });

  it('returns false when there is nothing to undo', () => {
    const c = new GameController();
    c.newGame({ mode: 'hotseat', seed: 1 });
    expect(c.undo()).toBe(false);
  });

  it('blocks human input on the AI turn and round-trips FEN and PGN', () => {
    const ai = new ManualAi();
    const c = new GameController(ai);
    c.newGame({ mode: 'vs-ai', seed: 1, aiTier: 'karl', humanColor: 'w' });
    move(c, 'e2', 'e4');
    expect(move(c, 'd2', 'd4')).toBe(false); // not the human's turn

    ai.reply(ai.pendingSearch!.generation, 'e7', 'e5');
    const fen = c.exportFEN();
    const pgn = c.exportPGN();

    const fresh = new GameController();
    expect(fresh.importPGN(pgn)).toBe(true);
    expect(fresh.exportFEN()).toBe(fen);
  });
});
