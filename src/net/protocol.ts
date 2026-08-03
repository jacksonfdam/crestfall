/**
 * Wire protocol for a challenge match. Pure and DOM-free so the whole of it
 * can be unit-tested without a browser or a Supabase instance.
 *
 * Two players, one broadcast channel, and a deliberately tiny vocabulary: say
 * hello, send moves, say goodbye. There is no server-side referee — each side
 * runs the same rules engine and rejects anything illegal, so a malformed or
 * hostile message can only ever be ignored.
 */

import type { Color, PieceType, Square } from '../core/contract.ts';

/** How long a fresh invite can be claimed. Mirrors the SQL default. */
export const INVITE_TTL_MS = 15 * 60 * 1000;

/** Codes avoid I, L, O, 0 and 1 so they survive being read out loud. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
const CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]{6}$/;

/** Display names are trimmed, collapsed, and capped to the column width. */
export const MAX_NAME_LENGTH = 24;

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** Uppercases and strips separators people paste in ("ab-cd-ef"). */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z2-9]/g, '');
}

export function generateCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Names come from a text field, so they are untrusted: control characters and
 * runs of whitespace go, and the result is capped. An empty result is the
 * caller's problem to reject — this function never invents a name.
 */
export function sanitizeName(raw: string): string {
  return raw
    // Control characters go, but tab, newline and return are spared so the
    // collapse below turns them into a space: deleting them outright would
    // weld two words together.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

export function channelName(code: string): string {
  return `crestfall:${code}`;
}

/** The side the guest gets, given the side the host took. */
export function opposite(side: Color): Color {
  return side === 'w' ? 'b' : 'w';
}

/**
 * Build the link a host shares. A query string rather than a fragment, because
 * chat apps and link previewers mangle `#` far more often than `?`.
 */
export function inviteLink(origin: string, pathname: string, code: string): string {
  const base = `${origin}${pathname}`.replace(/\?.*$/, '');
  return `${base}?join=${code}`;
}

/** Read a challenge code out of a URL, if one is there and looks sane. */
export function codeFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('join');
  if (!value) return null;
  const code = normalizeCode(value);
  return isValidCode(code) ? code : null;
}

// ── Messages ────────────────────────────────────────────────────────────────

/** Sent by both sides on join, so each learns the other's name and side. */
export interface HelloMsg {
  type: 'hello';
  clientId: string;
  name: string;
  side: Color;
  /** Shared duel seed; the host is authoritative, the guest echoes it back. */
  seed: number;
}

export interface MoveMsg {
  type: 'move';
  clientId: string;
  from: Square;
  to: Square;
  promotion?: PieceType;
  /** Ply index this move was made at, used to drop duplicates and stale sends. */
  ply: number;
}

/** Sent on a deliberate exit so the other side hears "left" and not "silent". */
export interface ByeMsg {
  type: 'bye';
  clientId: string;
  reason: 'left' | 'resigned';
}

export type NetMsg = HelloMsg | MoveMsg | ByeMsg;

const SIDES: readonly string[] = ['w', 'b'];

/**
 * Validate anything that arrives on the channel. Broadcast payloads are
 * attacker-controlled, so every field is checked before it reaches the game.
 */
export function parseMsg(raw: unknown): NetMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.clientId !== 'string' || m.clientId.length === 0) return null;

  if (m.type === 'hello') {
    if (typeof m.name !== 'string' || typeof m.seed !== 'number') return null;
    if (!Number.isFinite(m.seed) || !SIDES.includes(m.side as string)) return null;
    const name = sanitizeName(m.name);
    if (!name) return null;
    return {
      type: 'hello',
      clientId: m.clientId,
      name,
      side: m.side as Color,
      seed: Math.floor(m.seed),
    };
  }

  if (m.type === 'move') {
    if (!isSquare(m.from) || !isSquare(m.to)) return null;
    if (typeof m.ply !== 'number' || !Number.isInteger(m.ply) || m.ply < 0) return null;
    const promotion =
      m.promotion === undefined ? undefined : (m.promotion as PieceType);
    if (promotion !== undefined && !['q', 'r', 'b', 'n'].includes(promotion)) return null;
    return {
      type: 'move',
      clientId: m.clientId,
      from: m.from,
      to: m.to,
      promotion,
      ply: m.ply,
    };
  }

  if (m.type === 'bye') {
    const reason = m.reason === 'resigned' ? 'resigned' : 'left';
    return { type: 'bye', clientId: m.clientId, reason };
  }

  return null;
}

function isSquare(value: unknown): value is Square {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 64;
}

/** Random enough to tell two browser tabs apart; not a secret. */
export function newClientId(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return `${buf[0].toString(36)}${buf[1].toString(36)}`;
}
