# CRESTFALL Architecture — the frozen contract

Every module codes against this document and `src/core/contract.ts`. Do not
widen a module's surface beyond what is written here.

## Load-bearing invariants

1. **The engine is pure and headless.** `src/engine/` imports nothing from
   `three`, the DOM, timers, or `Math.random`. Position in, position out.
   It must run under plain Node (`node --experimental-strip-types`).
2. **Presentation is a read-only consumer.** `src/render/`, `src/duels/`,
   `src/chars/`, `src/audio/` receive `GameEvent`s and render them. There is
   no API by which they can cause, cancel, delay, or alter a move. Events
   carry the resolved board state — by the time a duel's first frame plays,
   the capture has already happened.
3. **The AI runs in a Web Worker** (`src/ai/worker.ts`), hard time budget per
   tier, cancellable via a generation counter.
   **A remote opponent uses the same port.** In an online match the friend's
   move arrives on the port the AI answers on (`src/net/opponentPort.ts`), so
   there is still exactly one external write path, one cancellation mechanism,
   and one guard — `isAiTurn()` — stopping a player moving for their opponent.
   See `docs/MULTIPLAYER.md`.
4. **Determinism.** All variation flows from the game seed through
   `src/core/prng.ts` (mulberry32) and `duelVariant()` in the contract. No
   `Math.random`, no `Date.now` inside game/duel logic.

## Module ownership (one agent per directory, no cross-edits)

| Path           | Owner   | Depends on |
|----------------|---------|------------|
| `src/core/`    | FROZEN  | —          |
| `src/engine/`  | rules   | core       |
| `src/ai/`      | ai      | core, engine |
| `src/game/`    | integrator | core, engine |
| `src/render/`  | render  | core, three |
| `src/chars/`   | chars   | core, three |
| `src/duels/`   | duels   | core, three, chars, render (camera rig API) |
| `src/audio/`   | audio   | core       |
| `src/ui/`      | ui      | core, game (read + command API only), net (protocol constants) |
| `src/net/`     | net     | core (contract + the AI port shape) |
| `src/main.ts`  | integrator | everything — the only module that wires the rest together |

`src/game/GameController` is the ONLY writer of game state. UI calls its
command methods (`tryMove`, `undo`, `redo`, `newGame`, `loadFEN`,
`importPGN`); everything downstream is events.

## Event flow

```
UI input ──▶ GameController ──▶ engine.applyMove (pure)
                 │
                 └─▶ emit GameEvent { record, fen, board[64], capture? }
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
     render           duels            audio     (all read-only)
```

Events carry a parsed `board: (ColoredPiece|null)[64]` so presentation never
imports engine internals. The renderer re-derives its scene from the event —
interrupting a duel mid-frame can never desync because the truth already
shipped in the event.

## Duel determinism

`duelVariant(seed, moveIndex, attacker, victim)` in `src/core/contract.ts`
hashes to a variant index. Same seed + same move sequence = byte-identical
choreography. Duel scripts are data (keyframe tracks on named rig bones),
evaluated by elapsed time — they are pose functions of `t`, so they can be
sampled at any speed (1×/2×) or skipped to `t = 1` with no artefact.

## Character rig contract

Each character factory (see `CharacterRig` in contract.ts) returns a
`THREE.Group` plus a named-bone map and a `pose(name)` for canonical poses
(`idle`, `victory`). Duel scripts animate bones by name. Both factions come
from one builder parameterised by a `FactionMaterials` set.

## Perf budget (perf agent has veto)

60 fps on integrated graphics during a duel; < 3 s cold load; < 8 MB total
payload (hence: zero asset files — all geometry procedural, all audio
synthesized); move input responds < 50 ms regardless of animation state.

## Legal constraints

No Interplay-derived content. No film references in any duel (specifically:
nothing evoking the Monty Python black-knight scene or the Raiders swordsman
scene). Homage sources allowed: Norse sagas, Bayeux Tapestry, Poetic Edda,
medieval marginalia. Engine is our own negamax — no Stockfish, no GPL code.
