# Developer entry points. See docs/LOCAL_DEVELOPMENT.md for details.

.PHONY: install dev test typecheck build perft fuzz determinism gauntlet \
        db-start db-stop db-reset db-studio web-up web-down config

## Install dependencies
install:
	npm install

## Vite dev server with hot reload
dev:
	npm run dev

## Unit + rules suites
test:
	npm test

## Typecheck everything (no emit)
typecheck:
	npx tsc --noEmit

## Production build into dist/
build:
	npm run build

## Full perft validation (also runs in CI)
perft:
	npm run perft

## Desync fuzz: the rendered board must equal the engine board
fuzz:
	npm run fuzz

## Duel determinism gate
determinism:
	npm run determinism

## AI strength gauntlet
gauntlet:
	npm run gauntlet

## Start the local Supabase stack (Docker, via Supabase CLI)
db-start:
	supabase start

## Stop the local Supabase stack
db-stop:
	supabase stop

## Reset the local database and re-apply migrations
db-reset:
	supabase db reset

## Apply the schema to the SHARED hosted project.
## `supabase db push` cannot be used there: the hosted project's migration
## history belongs to uBomber, and two repos cannot share one history. The SQL
## is idempotent, so re-running this is safe. Needs SUPABASE_DB_URL (Dashboard →
## Project Settings → Database → Connection string, session pooler).
## psql runs in a container so it need not be installed locally.
db-apply-shared:
	@test -n "$$SUPABASE_DB_URL" || { \
		echo "SUPABASE_DB_URL is not set."; \
		echo "  export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'"; \
		exit 1; }
	@for f in supabase/migrations/*.sql; do \
		echo "applying $$f"; \
		docker run --rm -i postgres:15-alpine \
			psql "$$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f - < "$$f" || exit 1; \
	done
	@echo "schema applied to the shared project"

## Open Supabase Studio for the local stack
db-studio:
	open http://localhost:54423

## Write public/config.json for the local Supabase stack
config:
	@printf '{\n  "supabaseUrl": "http://127.0.0.1:54421",\n  "supabaseAnonKey": "%s"\n}\n' \
		"$$(supabase status -o env | sed -n 's/^ANON_KEY=//p' | tr -d '\"')" \
		> public/config.json
	@echo "wrote public/config.json for the local stack"

## Serve the production build at http://localhost:8080
web-up: build
	docker compose up -d web

web-down:
	docker compose down
