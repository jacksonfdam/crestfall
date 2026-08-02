import { DEFAULT_SETTINGS } from '../core/contract.ts';
import type { Settings } from '../core/contract.ts';

export const SETTINGS_STORAGE_KEY = 'crestfall.settings';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStoreOptions {
  /** Injectable for tests; `null` disables persistence. Defaults to localStorage. */
  storage?: StorageLike | null;
  /** Injectable for tests. Defaults to the prefers-reduced-motion media query. */
  prefersReducedMotion?: boolean;
}

const VOLUME_KEYS = ['masterVolume', 'musicVolume', 'sfxVolume'] as const;

function sanitize(raw: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (r.viewMode === '3d' || r.viewMode === '2d') out.viewMode = r.viewMode;
  if (r.duelSpeed === 0 || r.duelSpeed === 1 || r.duelSpeed === 2) out.duelSpeed = r.duelSpeed;
  const n = r.duelsFirstNMoves;
  if (n === 'always' || n === Infinity) out.duelsFirstNMoves = Infinity;
  else if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out.duelsFirstNMoves = n;
  if (typeof r.reducedMotion === 'boolean') out.reducedMotion = r.reducedMotion;
  for (const k of VOLUME_KEYS) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
  }
  return out;
}

function encode(overrides: Partial<Settings>): string {
  const plain: Record<string, unknown> = { ...overrides };
  if (overrides.duelsFirstNMoves === Infinity) plain.duelsFirstNMoves = 'always';
  return JSON.stringify(plain);
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function systemReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Persists only the keys the user explicitly changed, so the
 * prefers-reduced-motion media query stays the default until overridden.
 */
export class SettingsStore {
  private readonly storage: StorageLike | null;
  private defaults: Settings;
  private overrides: Partial<Settings>;
  private readonly subscribers = new Set<(s: Settings) => void>();

  constructor(opts: SettingsStoreOptions = {}) {
    this.storage = opts.storage !== undefined ? opts.storage : defaultStorage();
    this.defaults = {
      ...DEFAULT_SETTINGS,
      reducedMotion: opts.prefersReducedMotion ?? systemReducedMotion(),
    };
    this.overrides = this.load();
    if (opts.prefersReducedMotion === undefined) this.watchMediaDefault();
  }

  get(): Settings {
    return { ...this.defaults, ...this.overrides };
  }

  set(partial: Partial<Settings>): void {
    this.overrides = { ...this.overrides, ...sanitize(partial) };
    this.persist();
    this.notify();
  }

  subscribe(fn: (s: Settings) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private notify(): void {
    const s = this.get();
    for (const fn of this.subscribers) fn(s);
  }

  private load(): Partial<Settings> {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(SETTINGS_STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SETTINGS_STORAGE_KEY, encode(this.overrides));
    } catch {
      /* storage can be unavailable (private mode); the in-memory value still works */
    }
  }

  private watchMediaDefault(): void {
    try {
      if (typeof matchMedia !== 'function') return;
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (ev) => {
        this.defaults = { ...this.defaults, reducedMotion: ev.matches };
        if (this.overrides.reducedMotion === undefined) this.notify();
      });
    } catch {
      /* older matchMedia without addEventListener — media default just stays fixed */
    }
  }
}
