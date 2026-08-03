# Local development

Two things can run locally: the game, and the Supabase stack that link
challenges need. The game does not require the second one — without it,
everything works except "Challenge a friend".

## Just the game

```sh
make install     # npm install
make dev         # Vite dev server on http://localhost:5173
```

Other entry points: `make test`, `make typecheck`, `make build`, and the
correctness gates `make perft`, `make fuzz`, `make determinism`,
`make gauntlet`.

## With challenges: the Supabase stack

Requires Docker running and the [Supabase CLI](https://supabase.com/docs/guides/cli).
The CLI runs Postgres, Realtime, Auth and Studio in Docker for you.

```sh
make db-start    # supabase start  — applies supabase/migrations/
make config      # writes public/config.json pointed at the local stack
make dev
```

Then open two browser tabs, create a challenge in one, and paste the link into
the other.

`make db-studio` opens Studio (http://localhost:54423) if you want to look at the
`crestfall_invites` table. `make db-reset` re-applies the migrations from
scratch, and `make db-stop` shuts the stack down.

### Ports

Offset from the CLI defaults so this stack can run alongside another Supabase
project on the same machine:

| Service  | Port  |
|----------|-------|
| API      | 54421 |
| Postgres | 54422 |
| Studio   | 54423 |

Analytics is disabled in `supabase/config.toml` — it is not needed to develop
against, and its default port collides with other local projects.

## Runtime configuration

The client reads Supabase settings from `/config.json` at runtime rather than
from a compiled-in constant, so one build runs against any project.

```
public/config.json.example   committed template
public/config.json           real values, gitignored
```

`make config` writes the local-stack version. To point at a hosted project,
copy the example and fill in the project URL and anon key:

```sh
cp public/config.json.example public/config.json
$EDITOR public/config.json
```

The anon key belongs in the browser — that is what it is for — and row-level
security is what actually protects the data. Even so, `public/config.json`,
`.env` and `.env.local` are gitignored: the values are environment-specific, and
the example file is the thing worth committing.

If the file is missing or malformed, `loadNetConfig()` returns `null`, the menu
offers "Challenge a friend" as unavailable, and everything else runs as normal.

## Serving the production build (Docker)

The dev server is convenient but not what players get. To exercise the real
build — hashed assets, the runtime `/config.json` fetch, correct module MIME
types — serve `dist/` through nginx:

```sh
make web-up      # npm run build, then docker compose up -d web
                 # http://localhost:8080
make web-down
```

`public/config.json` is copied into `dist/` by Vite, so challenges work there
too. Note that `site_url` in `supabase/config.toml` lists both
`http://localhost:8080` and `http://localhost:5173`.

## Testing a challenge on a phone

The board wants landscape and a full screen. To reach the dev server from a
phone on the same network, run Vite with `--host`, then use your machine's LAN
address in place of `localhost` — including inside `public/config.json`, since
`127.0.0.1` means the phone itself:

```sh
npx vite --host
```
