# Challenge matches — link multiplayer

One friend, one link, no accounts. A host creates an invite, sends the link,
and the game starts the moment the other player opens it and types a name.

## The shape of it

```
host                              Supabase                            guest
 │                                   │                                  │
 ├─ insert invite ─────────────────▶ crestfall_invites                  │
 │   (code, host_name, side, seed)   │  expires_at = now() + 15 min      │
 │◀─ code ───────────────────────────┤                                  │
 │                                   │                                  │
 │  share  /?join=CODE  ────────────────────────────────────────────────▶│
 │                                   │                                  │
 │                                   │◀── select by code (RLS: live only)┤
 │                                   │◀── update status/guest_name ──────┤
 │                                   │                                  │
 ├─ realtime channel  crestfall:CODE ───────────────────────────────────┤
 │       hello (name, side, seed)  ⇄  hello                              │
 │       move (from, to, promotion, ply) ⇄ move                          │
 │       bye  (left | resigned)          ⇄ bye                           │
```

Postgres holds **only** the invite, so a code can be validated before anyone
joins. Presence and moves travel over a Realtime broadcast channel and never
touch the database. Nothing about a match is persisted: no history, no accounts,
no personal data beyond a display name the player types.

## The 15 minutes

Expiry is a property of the *invite*, not the match. A claimed invite starts a
game that runs as long as both players keep playing; an unclaimed one dies after
15 minutes.

It is enforced in the database, not the client. The read policy is
`using (expires_at > now())`, so an expired row is invisible and unclaimable —
a client that ignores timestamps still cannot use a stale link.

Insert is granted per column (`code, host_name, host_side, seed`) and update per
column (`status, guest_name`), so the expiry window and the shared seed are not
client-writable. The migration also revokes the blanket privileges Supabase
grants `anon` by default, so the table's reachable surface is exactly
`SELECT` + those two column sets — no `DELETE`, no `TRUNCATE`. Verified:

| Attempt (as `anon`)                    | Result                        |
|----------------------------------------|-------------------------------|
| create an invite                       | allowed                       |
| claim a live invite                    | allowed (`status`, `guest_name`) |
| insert with a forged `expires_at`      | denied                        |
| rewrite `seed`                         | denied                        |
| delete a row                           | denied                        |
| read an expired invite                 | not found                     |
| claim an expired invite                | 0 rows changed                |

See `supabase/migrations/`. Because the hosted project's migration history
belongs to uBomber, that file is applied by hand there and is written to be
idempotent — see `docs/DEPLOYMENT.md`.

Expired rows are kept for an hour so a player who arrives late gets "this link
has expired" rather than a bare not-found, then
`cleanup_expired_crestfall_invites()` removes them (pg_cron; see
`docs/DEPLOYMENT.md`).

## Determinism across two screens

Duel choreography is a pure function of the game seed (see
`docs/ARCHITECTURE.md`), so both clients must agree on it. The host deals the
seed, stores it on the invite, and repeats it in `hello`; the guest adopts it.
Same seed plus the same move sequence means both players watch byte-identical
duels, and neither client has to send a single animation frame.

## Where a remote player plugs in

`GameController` is still the only writer of game state. It already has exactly
one port for "the side I do not control" — the one the AI answers on — and a
remote friend answers on the same one:

```
      local input ──▶ GameController ──▶ engine (pure)
                          │  ▲
   opponent port ─────────┘  │
    ├─ AI worker (searches)  │
    └─ ChallengeSession ◀────┴── broadcast: the friend's move
```

`src/net/opponentPort.ts` adapts one to the other. Two consequences fall out for
free:

- **Turn ownership.** `isAiTurn()` is true whenever it is not the local
  player's move, so a player physically cannot move their opponent's pieces —
  the same guard that stops you playing for the AI.
- **Staleness.** The controller cancels a pending request by generation on
  undo/new game, so a move that arrives late is discarded rather than applied to
  a position that has moved on.

`src/main.ts` routes the single port to the worker or the session depending on
who is playing.

## Deliberate limitations

- **Undo and redo are refused during a match.** Taking a move back would desync
  the two boards and there is no protocol for agreeing to it. The buttons
  decline rather than lie.
- **No reconnect.** If a player drops, presence reports it and the other side is
  told; there is no resume. The invite is already spent, so recovery means a new
  link.
- **No server-side referee.** Both clients run the same rules engine and reject
  anything illegal, so a hostile or malformed message can only ever be ignored —
  but a determined cheat could still play a legal move chosen by other means.
  For a game about watching duels, that trade is deliberate.
- **One guest.** An invite is claimed once; `status` moves `open → joined`.

## Message validation

Every broadcast payload is attacker-controlled, so `parseMsg()` in
`src/net/protocol.ts` checks each field before anything reaches the game:
squares must be integers in 0..63, ply a non-negative integer, promotion one of
`q r b n`, names sanitised and capped, sides exactly `w` or `b`. Anything else
returns `null` and is dropped. `tests/net.test.ts` covers the rejections.
