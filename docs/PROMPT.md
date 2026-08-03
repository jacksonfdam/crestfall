# The brief

The originating specification for CRESTFALL, kept current as the project grows.

> **Reconstructed.** The original prompt was not committed, so this was rebuilt
> from `docs/ARCHITECTURE.md`, `docs/DUELS.md`, `README.md` and the code itself,
> then extended with the scope added since. Correct anything that misremembers
> the intent — this file is the spec, so where it and the code disagree, one of
> them is wrong.

## The idea

Chess where every capture plays out as a short animated duel between the two
pieces involved. Not a chess program with decorations: the duels are the point,
and the chess is what earns them.

A Norse-inflected original cast, six characters mapped onto the six piece types:

| Piece  | Character | Reading |
|--------|-----------|---------|
| Pawn   | Huscarl   | workmanlike, spear and shield |
| Knight | Berserkr  | mounted, twin axes |
| Bishop | Völva     | ranged, casts runes, never closes distance |
| Rook   | Jötunn    | a stone tower that unfolds into a giant |
| Queen  | Valkyrie  | airborne |
| King   | Jarl      | heavy, reluctant, wins by economy |

Two factions, Ash (pale, high-value) and Ember (dark, low-value), readable in
greyscale so the board never depends on colour vision.

## Non-negotiables

**Original work only.** No third-party models, textures, audio samples, fonts
beyond system defaults, or opening books. All geometry procedural, all audio
synthesized at runtime. This is what keeps the payload under 8 MB with zero
asset files, and it is a licensing position as much as a technical one.

**Our own engine.** A from-scratch negamax with alpha-beta, quiescence and a
transposition table. Explicitly not Stockfish: it is GPLv3 and embedding it would
relicense the project.

**No derived content.** Nothing from Interplay's Battle Chess. No film
references in any duel — specifically not the Monty Python black-knight scene or
the Raiders swordsman scene. Homage sources allowed: Norse sagas, the Bayeux
Tapestry, the Poetic Edda, medieval marginalia.

**Defeat, not gore.** Victims are beaten, not butchered. Stone may shatter;
flesh is not dismembered. `docs/DUELS.md` fixes a defeat reading per character
that every attacker's row must honour.

## Architecture, in one breath

A pure headless bitboard engine owns the truth. Presentation is a read-only
subscriber to a move log and physically cannot alter game state. The AI runs in a
Web Worker on a hard per-tier time budget, cancellable. Every source of variation
flows from one seeded PRNG, so a replay is byte-identical.

`GameController` is the only writer of game state. `docs/ARCHITECTURE.md` is the
frozen contract; no module widens its surface beyond what is written there.

**Duels are pure pose-functions of `t ∈ [0,1]`.** Sampling any `t` is valid,
`t = 1` is the canonical end state, and the capture is already resolved in the
event before the first frame plays. That is why a duel can be skipped, sped up,
interrupted, or never played at all without the board and the engine ever
disagreeing — a property the desync fuzz gate enforces in CI.

**Perft-validated rules.** Correctness of the engine is not a matter of opinion;
`npm run perft` runs in CI.

## Duels

35 pairings (6 × 6 minus king-takes-king), each with a mandatory variant A
specified in `docs/DUELS.md` and a variant B designed to differ in both opening
beat and finish. Hard limits: ≤ 4 s at 1×, anticipation and follow-through on
every action, silhouettes separated, one camera idea per duel, at least one vocal
accent. 2D mode suppresses duels and resolves captures with an emblem vignette
driven by the same scripts.

## Presentation and the shell

One Three.js scene drives both a cinematic 3D mode and a crisp top-down 2D mode.

The player lands on an animated title splash, then a floating main menu over the
board: new game, challenge a friend, credits, settings, help. In-game the board
takes the whole viewport and the HUD is a slim strip — whose move it is, clocks,
undo/redo — with everything else living in the menu. Export controls appear only
once there is a finished game to export.

Accessible by construction: a keyboard board cursor with a screen-reader
announcer, visible focus everywhere, contrast held at 4.5:1, every state cue
carried by shape and not colour alone, and a reduced-motion path that resolves
duels instantly and drops camera shake.

Playable on a phone in landscape, with a prompt to rotate when held in portrait.

Sound is synthesized: a drone-and-pluck score plus cue-driven effects, with a
"no sound" mode that silences everything and never builds the audio graph at all.

## Multiplayer

One friend, one link, no accounts. A host creates an invite and shares a URL; the
friend opens it, types a name, and the game starts. Links are single-use and last
15 minutes, enforced in the database rather than the client.

Supabase Realtime carries presence and moves; Postgres holds only the invite so a
code can be validated before joining. The host deals the duel seed so both
screens play identical choreography. A remote player enters through the same port
the AI uses, so `GameController` remains the only writer of game state and no
player can move for their opponent. See `docs/MULTIPLAYER.md`.

Nothing about a match is persisted: no accounts, no history, no personal data
beyond a display name the player types.

## Local development

The whole thing runs locally, including the backend: Supabase via its CLI in
Docker, and the production build served through nginx via `docker compose`. A
Makefile is the entry point for all of it. See `docs/LOCAL_DEVELOPMENT.md`.

## Definition of done

Perft green, desync fuzz green, duel determinism green, type-check clean, tests
green, 60 fps on integrated graphics during a duel, cold load under 3 s, payload
under 8 MB, move input responding within 50 ms regardless of animation state.
