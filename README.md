# CRESTFALL ⚔️

**Chess where every capture is a duel.**

Every time a piece takes another, the board cuts to a short animated duel
between the two of them — a mounted Berserkr scissoring both axes over a shield
rim, a stone Jötunn unfolding out of its own tower, a Valkyrie landing on a
giant's arm and running its length. Then the camera pulls back and it is your
move again.

▶️ **[Play it](https://crestfall.vercel.app)**

Built with [Three.js](https://threejs.org), backed by
[Supabase](https://supabase.com) Realtime, hosted on
[Vercel](https://vercel.com) — and fully playable locally with Docker.

## Features

- ⚔️ **35 hand-authored duels** — six attackers × six victims, each with two
  variants that differ in opening beat *and* finish. Skipping or speeding one up
  can never change the result: the capture is already resolved before the first
  frame plays
- 🪓 **An original Norse cast** — Huscarl, Berserkr, Völva, Jötunn, Valkyrie and
  Jarl in place of the usual six, split into Ash and Ember factions that stay
  readable in greyscale
- 🔗 **Challenge a friend with a link** — no account, no sign-up, just type a
  name. Links are single-use and last 15 minutes
- 🤖 **Four AI tiers** — Thrall to Konungr, our own alpha-beta search engine in a Web
  Worker with a hard time budget, so input never stalls behind a search
- 🎬 **3D and 2D** — one scene drives a cinematic perspective board and a crisp
  top-down view, where duels become compact heraldic vignettes
- 🔇 **A no-sound mode** that means it — muted, the audio graph is never built
- ♿ **Keyboard board cursor and screen-reader announcements**, visible focus
  everywhere, 4.5:1 contrast, and a reduced-motion path that resolves duels
  instantly
- 📱 **Plays on a phone**, in landscape
- 🎲 **Deterministic** — every variation flows from one seeded PRNG, so the same
  seed and the same moves produce byte-identical choreography on both players'
  screens
- 📦 **Zero asset files** — all geometry procedural, all audio synthesized at
  runtime, no fonts beyond system defaults

## Running it

```sh
make install     # or: npm install
make dev         # Vite dev server on http://localhost:5173
make test        # unit + rules suites
make build       # production build into dist/
```

Correctness gates, all of which run in CI:

```sh
make perft         # full perft validation of the rules engine
make fuzz          # desync fuzz: the rendered board must equal the engine board
make determinism   # duel choreography must be byte-identical for a given seed
make gauntlet      # AI strength gauntlet
```

Link challenges need a Supabase project. Locally that is two more commands:

```sh
make db-start    # Supabase stack in Docker, via the Supabase CLI
make config      # writes public/config.json pointed at it
```

Without it the game runs exactly as normal and only challenges are unavailable.
To serve the real production build through nginx, `make web-up` →
http://localhost:8080. Full walkthrough in
[`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md).

## Documentation

| Document | What is in it |
|----------|---------------|
| [`docs/PROMPT.md`](docs/PROMPT.md) | The brief: what this is, and what it must never become |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The frozen contract between modules |
| [`docs/DUELS.md`](docs/DUELS.md) | The choreography bible — all 35 cells |
| [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md) | Link challenges, the wire protocol, the 15-minute rule |
| [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) | Running everything locally, Docker included |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Build, Supabase setup, scheduled cleanup |

The one-paragraph architecture: a pure, headless bitboard rules engine owns the
truth; the presentation layer is a read-only subscriber to a move log and
physically cannot alter game state; the AI — and a remote opponent — reach the
game through one cancellable port; and every source of variation flows from one
seeded PRNG, so replays are byte-identical.

## Licensing and provenance

**The chess AI is our own engine** — minimax with alpha-beta pruning, quiescence
search, and a transposition table, written from scratch in `src/ai/`. 
We  deliberately do **not** ship Stockfish or any GPL-licensed engine: Stockfish is
GPLv3 and embedding it would place this entire project under GPLv3. 

No opening book is shipped (most strong Polyglot books have unclear provenance); the engine
plays from search alone with a small, hand-written set of first-move preferences.

All art, animation, and audio are original and generated procedurally in code —
there are no third-party assets, and no fonts beyond system defaults.

CRESTFALL contains no content derived from Interplay Productions' Battle Chess
and references no third-party films.

## Credits

**Creative direction and code — Jackson Mafra**

Third-party software is limited to code dependencies: Three.js, Supabase, Vite,
Vitest and TypeScript. 

Full detail in [`CREDITS.md`](CREDITS.md), and on the
game's own Credits screen.
