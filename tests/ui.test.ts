import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_STORAGE_KEY, SettingsStore } from '../src/ui/settings.ts';
import type { StorageLike } from '../src/ui/settings.ts';
import { describeEvent, describeMove, describeStatus, formatClock } from '../src/ui/announce.ts';
import { DEFAULT_SETTINGS } from '../src/core/contract.ts';
import type { GameEvent, MoveRecord } from '../src/core/contract.ts';

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const store = (storage: StorageLike, prefersReducedMotion = false): SettingsStore =>
  new SettingsStore({ storage, prefersReducedMotion });

describe('SettingsStore', () => {
  it('starts from DEFAULT_SETTINGS when storage is empty', () => {
    expect(store(new MemoryStorage()).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('uses prefers-reduced-motion as the reducedMotion default', () => {
    expect(store(new MemoryStorage(), true).get().reducedMotion).toBe(true);
    expect(store(new MemoryStorage(), false).get().reducedMotion).toBe(false);
  });

  it('lets the user override the reduced-motion media default, and remembers it', () => {
    const storage = new MemoryStorage();
    store(storage, true).set({ reducedMotion: false });
    expect(store(storage, true).get().reducedMotion).toBe(false);
  });

  it('keeps following the media default until the user overrides it', () => {
    const storage = new MemoryStorage();
    store(storage, true).set({ duelSpeed: 2 });
    expect(store(storage, false).get().reducedMotion).toBe(false);
    expect(store(storage, true).get().reducedMotion).toBe(true);
  });

  it('persists duelSpeed and duelsFirstNMoves across reloads', () => {
    const storage = new MemoryStorage();
    store(storage).set({ duelSpeed: 2, duelsFirstNMoves: 20 });
    const reloaded = store(storage).get();
    expect(reloaded.duelSpeed).toBe(2);
    expect(reloaded.duelsFirstNMoves).toBe(20);
  });

  it('round-trips duelsFirstNMoves = Infinity through JSON', () => {
    const storage = new MemoryStorage();
    const s = store(storage);
    s.set({ duelsFirstNMoves: 20 });
    s.set({ duelsFirstNMoves: Infinity });
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toContain('"always"');
    expect(store(storage).get().duelsFirstNMoves).toBe(Infinity);
  });

  it('survives corrupted storage payloads', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    expect(store(storage).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('drops or clamps invalid persisted values', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ duelSpeed: 5, viewMode: 'weird', masterVolume: 9, duelsFirstNMoves: -3 }),
    );
    const s = store(storage).get();
    expect(s.duelSpeed).toBe(DEFAULT_SETTINGS.duelSpeed);
    expect(s.viewMode).toBe(DEFAULT_SETTINGS.viewMode);
    expect(s.masterVolume).toBe(1);
    expect(s.duelsFirstNMoves).toBe(DEFAULT_SETTINGS.duelsFirstNMoves);
  });

  it('notifies subscribers with the merged settings, and unsubscribe works', () => {
    const s = store(new MemoryStorage());
    const fn = vi.fn();
    const unsub = s.subscribe(fn);
    s.set({ duelSpeed: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toEqual({ ...DEFAULT_SETTINGS, duelSpeed: 0 });
    unsub();
    s.set({ duelSpeed: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('works with persistence disabled (storage: null)', () => {
    const s = new SettingsStore({ storage: null, prefersReducedMotion: false });
    s.set({ musicVolume: 0.1 });
    expect(s.get().musicVolume).toBe(0.1);
  });
});

const move = (over: Partial<MoveRecord>): MoveRecord => ({
  from: 12,
  to: 28,
  piece: 'p',
  color: 'w',
  san: 'e4',
  ...over,
});

describe('describeMove', () => {
  it('describes a quiet move with the Norse piece name and SAN', () => {
    expect(describeMove(move({}))).toBe('White Huscarl to e4 (e4)');
  });

  it('describes a capture with check', () => {
    expect(
      describeMove(
        move({
          piece: 'q',
          color: 'w',
          to: 60,
          san: 'Qxe8+',
          capture: { type: 'r', color: 'b', square: 60 },
          check: true,
        }),
      ),
    ).toBe('White Valkyrie takes Jötunn on e8, check (Qxe8+)');
  });

  it('describes castling', () => {
    expect(describeMove(move({ piece: 'k', castle: 'k', san: 'O-O' }))).toBe(
      'White castles kingside (O-O)',
    );
    expect(describeMove(move({ piece: 'k', color: 'b', castle: 'q', san: 'O-O-O' }))).toBe(
      'Black castles queenside (O-O-O)',
    );
  });

  it('describes promotion', () => {
    expect(describeMove(move({ to: 60, promotion: 'q', san: 'e8=Q' }))).toBe(
      'White Huscarl to e8, promoted to Valkyrie (e8=Q)',
    );
  });

  it('describes en passant', () => {
    expect(
      describeMove(
        move({
          to: 43,
          san: 'exd6',
          capture: { type: 'p', color: 'b', square: 35 },
          enPassant: true,
        }),
      ),
    ).toBe('White Huscarl takes Huscarl on d6 en passant (exd6)');
  });

  it('describes checkmate', () => {
    expect(
      describeMove(move({ piece: 'q', to: 55, san: 'Qxh7#', capture: { type: 'p', color: 'b', square: 55 }, check: true, checkmate: true })),
    ).toBe('White Valkyrie takes Huscarl on h7, checkmate (Qxh7#)');
  });
});

describe('describeStatus', () => {
  it('covers every status', () => {
    expect(describeStatus('active', 'w')).toBe('White to move.');
    expect(describeStatus('checkmate', 'b')).toBe('Checkmate. White wins.');
    expect(describeStatus('checkmate', 'w')).toBe('Checkmate. Black wins.');
    expect(describeStatus('stalemate', 'w')).toBe('Draw by stalemate.');
    expect(describeStatus('draw-fifty', 'w')).toBe('Draw by the fifty-move rule.');
    expect(describeStatus('draw-repetition', 'w')).toBe('Draw by threefold repetition.');
    expect(describeStatus('draw-material', 'w')).toBe('Draw by insufficient material.');
  });
});

const event = (over: Partial<GameEvent>): GameEvent => ({
  kind: 'move',
  fen: 'test',
  board: new Array(64).fill(null),
  status: 'active',
  turn: 'b',
  moveIndex: 1,
  inCheck: false,
  ...over,
});

describe('describeEvent', () => {
  it('announces moves with the follow-up turn', () => {
    expect(describeEvent(event({ record: move({}) }))).toBe(
      'White Huscarl to e4 (e4). Black to move.',
    );
  });

  it('announces redo, undo, new game, and load', () => {
    expect(describeEvent(event({ kind: 'redo', record: move({}) }))).toBe(
      'Redone: White Huscarl to e4 (e4). Black to move.',
    );
    expect(describeEvent(event({ kind: 'undo', turn: 'w' }))).toBe('Move undone. White to move.');
    expect(describeEvent(event({ kind: 'newgame', turn: 'w' }))).toBe('New game. White to move.');
    expect(describeEvent(event({ kind: 'load', turn: 'w' }))).toBe('Position loaded. White to move.');
  });

  it('announces terminal statuses after the move', () => {
    expect(
      describeEvent(event({ status: 'checkmate', record: move({ san: 'Qh7#', piece: 'q', to: 55, checkmate: true }) })),
    ).toBe('White Valkyrie to h7, checkmate (Qh7#). Checkmate. White wins.');
  });
});

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(999)).toBe('0:00');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(600_000)).toBe('10:00');
  });

  it('formats hours', () => {
    expect(formatClock(3_661_000)).toBe('1:01:01');
  });

  it('never goes negative', () => {
    expect(formatClock(-5000)).toBe('0:00');
  });
});
