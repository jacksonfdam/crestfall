/**
 * One challenge match, over Supabase.
 *
 * The `crestfall_invites` table is only an invite registry, so a code can be
 * validated (and its 15-minute window checked) before anyone joins. Everything
 * about the match itself — presence and moves — flows through a Realtime
 * broadcast channel and never touches Postgres.
 *
 * This module owns no game state. It reports what the other player did and
 * lets integration decide; the GameController remains the only writer.
 */

import { createClient } from '@supabase/supabase-js';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import type { Color, PieceType, Square } from '../core/contract.ts';
import type { NetConfig } from './config.ts';
import {
  channelName,
  generateCode,
  isValidCode,
  newClientId,
  opposite,
  parseMsg,
  sanitizeName,
  type MoveMsg,
  type NetMsg,
} from './protocol.ts';

const TABLE = 'crestfall_invites';

export type JoinFailure =
  | 'expired-or-missing'
  | 'already-claimed'
  | 'invalid-code'
  | 'unreachable';

export class JoinError extends Error {
  constructor(readonly kind: JoinFailure, message: string) {
    super(message);
    this.name = 'JoinError';
  }
}

export interface SessionEvents {
  /** The other player arrived (or re-announced after a reconnect). */
  onOpponent?: (name: string, side: Color) => void;
  /** A validated move from the other player. */
  onRemoteMove?: (move: { from: Square; to: Square; promotion?: PieceType }) => void;
  /** They left, or the channel dropped. */
  onOpponentGone?: (reason: 'left' | 'resigned' | 'disconnected') => void;
}

export interface MatchInfo {
  code: string;
  /** The side the local player controls. */
  localSide: Color;
  localName: string;
  /** Shared duel seed — identical on both screens by construction. */
  seed: number;
  isHost: boolean;
}

/**
 * Seeds must survive a round trip through a `bigint` column and JSON, so they
 * stay inside the 32-bit range the PRNG uses anyway.
 */
function freshSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

export class ChallengeSession {
  private readonly supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private readonly clientId = newClientId();

  private info: MatchInfo | null = null;
  private opponentName: string | null = null;
  /** Highest ply we have already applied, so a resend cannot double-move. */
  private appliedPly = -1;

  constructor(
    config: NetConfig,
    private readonly events: SessionEvents = {},
  ) {
    // No session, no storage: a challenge is anonymous by design.
    this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  get match(): MatchInfo | null {
    return this.info;
  }

  get opponent(): string | null {
    return this.opponentName;
  }

  /**
   * Register an invite and wait on its channel as host. Returns the code to
   * put in the link.
   */
  async host(name: string, side: Color): Promise<MatchInfo> {
    const localName = requireName(name);
    const seed = freshSeed();
    const code = await this.insertInvite(localName, side, seed);
    this.info = { code, localSide: side, localName, seed, isHost: true };
    await this.openChannel(code);
    return this.info;
  }

  /** Claim an invite by code and join its channel as guest. */
  async join(code: string, name: string): Promise<MatchInfo> {
    if (!isValidCode(code)) {
      throw new JoinError('invalid-code', 'That is not a valid challenge code.');
    }
    const localName = requireName(name);

    // RLS hides expired rows, so "not found" and "expired" are one case here —
    // which is exactly the guarantee we want: a stale link cannot be claimed.
    const { data, error } = await this.supabase
      .from(TABLE)
      .select('code, host_name, host_side, seed, status')
      .eq('code', code)
      .maybeSingle();

    if (error) throw new JoinError('unreachable', `Could not reach the server: ${error.message}`);
    if (!data) {
      throw new JoinError(
        'expired-or-missing',
        'This challenge link has expired or was never valid. Links last 15 minutes.',
      );
    }
    if (data.status !== 'open') {
      throw new JoinError('already-claimed', 'Someone has already taken this challenge.');
    }

    const hostSide = data.host_side === 'b' ? 'b' : 'w';
    const seed = Number(data.seed);
    const { error: claimError } = await this.supabase
      .from(TABLE)
      .update({ status: 'joined', guest_name: localName })
      .eq('code', code);
    if (claimError) {
      throw new JoinError('unreachable', `Could not claim the challenge: ${claimError.message}`);
    }

    this.opponentName = sanitizeName(String(data.host_name)) || 'Host';
    this.info = {
      code,
      localSide: opposite(hostSide),
      localName,
      seed,
      isHost: false,
    };
    await this.openChannel(code);
    this.events.onOpponent?.(this.opponentName, hostSide);
    return this.info;
  }

  /** Broadcast a move the local player just made. */
  async sendMove(
    move: { from: Square; to: Square; promotion?: PieceType },
    ply: number,
  ): Promise<void> {
    const payload: MoveMsg = {
      type: 'move',
      clientId: this.clientId,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      ply,
    };
    await this.send(payload);
  }

  /** Announce a deliberate exit, then tear the channel down. */
  async leave(reason: 'left' | 'resigned' = 'left'): Promise<void> {
    if (this.channel) {
      await this.send({ type: 'bye', clientId: this.clientId, reason });
      if (this.info?.isHost) await this.closeInvite();
    }
    await this.dispose();
  }

  async dispose(): Promise<void> {
    const channel = this.channel;
    this.channel = null;
    this.info = null;
    this.opponentName = null;
    this.appliedPly = -1;
    if (channel) await this.supabase.removeChannel(channel);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async insertInvite(name: string, side: Color, seed: number): Promise<string> {
    // Codes are short, so a collision is unlikely but not impossible; the
    // unique index is the referee and we simply try again.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const { error } = await this.supabase
        .from(TABLE)
        .insert({ code, host_name: name, host_side: side, seed });
      if (!error) return code;
      const isCollision = error.code === '23505';
      if (!isCollision) {
        throw new JoinError('unreachable', `Could not create the challenge: ${error.message}`);
      }
    }
    throw new JoinError('unreachable', 'Could not allocate a challenge code. Try again.');
  }

  private async closeInvite(): Promise<void> {
    if (!this.info) return;
    // Best effort: an unclosed invite simply expires on its own.
    await this.supabase.from(TABLE).update({ status: 'closed' }).eq('code', this.info.code);
  }

  private async openChannel(code: string): Promise<void> {
    const channel = this.supabase.channel(channelName(code), {
      config: { broadcast: { self: false }, presence: { key: this.clientId } },
    });
    this.channel = channel;

    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      this.handle(parseMsg(payload));
    });

    channel.on('presence', { event: 'leave' }, () => {
      // Presence is the only signal for a closed laptop or a dead network.
      if (this.opponentName) this.events.onOpponentGone?.('disconnected');
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new JoinError('unreachable', 'Could not open the match channel.'));
        }
      });
    });

    await channel.track({ clientId: this.clientId, name: this.info?.localName ?? '' });
    await this.sayHello();
  }

  private async sayHello(): Promise<void> {
    if (!this.info) return;
    await this.send({
      type: 'hello',
      clientId: this.clientId,
      name: this.info.localName,
      side: this.info.localSide,
      seed: this.info.seed,
    });
  }

  private handle(msg: NetMsg | null): void {
    if (!msg || !this.info) return;
    if (msg.clientId === this.clientId) return; // our own echo

    switch (msg.type) {
      case 'hello': {
        const isNew = this.opponentName === null;
        this.opponentName = msg.name;
        this.events.onOpponent?.(msg.name, msg.side);
        // The host greeted first and the guest has only just arrived, so greet
        // back — otherwise the guest never learns the host's name.
        if (isNew && this.info.isHost) void this.sayHello();
        break;
      }
      case 'move': {
        if (msg.ply <= this.appliedPly) return; // duplicate or stale resend
        this.appliedPly = msg.ply;
        this.events.onRemoteMove?.({
          from: msg.from,
          to: msg.to,
          promotion: msg.promotion,
        });
        break;
      }
      case 'bye':
        this.events.onOpponentGone?.(msg.reason);
        break;
    }
  }

  private async send(msg: NetMsg): Promise<void> {
    if (!this.channel) return;
    await this.channel.send({ type: 'broadcast', event: 'msg', payload: msg });
  }
}

function requireName(raw: string): string {
  const name = sanitizeName(raw);
  if (!name) throw new JoinError('invalid-code', 'Please enter a name first.');
  return name;
}
