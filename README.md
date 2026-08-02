# CRESTFALL

A chess game where every capture plays out as an animated duel between the two
pieces. Norse-inflected original cast, one Three.js scene driving both a
cinematic 3D mode and a crisp top-down 2D mode, and a rules engine that is
perft-validated in CI.

## Licensing decision

**The chess AI is our own engine** — negamax with alpha-beta pruning,
quiescence search, and a transposition table, written from scratch in
`src/ai/`. We deliberately do **not** ship Stockfish or any GPL-licensed
engine: Stockfish is GPLv3 and embedding it would place this entire project
under GPLv3. No opening book is shipped (most strong Polyglot books have
unclear provenance); the engine plays from search alone with a small,
hand-written set of first-move preferences.

All art, animation, and audio are original and generated procedurally in
code — there are no third-party assets. See `CREDITS.md`.

CRESTFALL contains no content derived from Interplay Productions' Battle
Chess and references no third-party films.

## Running

```sh
npm install
npm run dev        # dev server
npm test           # unit + rules suites
npm run perft      # full perft validation (runs in CI)
npm run fuzz       # desync fuzz: rendered FEN must equal engine FEN
npm run build      # production build
```

## Architecture

See `docs/ARCHITECTURE.md`. The one-paragraph version: a pure, headless
bitboard rules engine owns the truth; the presentation layer is a read-only
subscriber to a move log and physically cannot alter game state; the AI runs
in a Web Worker with a hard time budget; and every source of variation flows
from one seeded PRNG, so replays are byte-identical.
