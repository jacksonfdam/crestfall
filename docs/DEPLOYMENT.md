# Deployment

The game is a static build. Challenges need a Supabase project; nothing else
does, and nothing needs a server of our own.

## Build

```sh
npm run build     # tsc --noEmit && vite build  →  dist/
```

Vercel picks this up from `package.json` with no extra configuration. The output
is static: no server runtime, no functions.

## Runtime configuration

Supabase settings are fetched from `/config.json` at load time rather than
compiled in, so the same artefact can be promoted between environments. Put the
file next to `index.html` in whatever you deploy:

```json
{
  "supabaseUrl": "https://<project>.supabase.co",
  "supabaseAnonKey": "<anon key>"
}
```

The build generates it for you. `npm run build` runs
`scripts/write-runtime-config.ts` first, which writes `public/config.json` from
two environment variables:

| Variable             | Value                          |
|----------------------|--------------------------------|
| `SUPABASE_URL`       | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY`  | the project's anon key          |

On Vercel, set both under Settings → Environment Variables for Production and
Preview, and redeploy. Nothing else about the project needs changing: the
framework preset, build command and `dist/` output directory are detected.

With the variables unset the script writes nothing and the build still succeeds —
which is what keeps CI and offline builds green. `public/config.json` is
gitignored, so a local file made by `make config` is never deployed by accident.

`vercel.json` marks `/config.json` as `no-store`, so repointing a deployment at a
different Supabase project takes effect on reload instead of after a cache purge.

If the file is absent, the deployment still works — the menu just reports
challenges as unavailable.

The anon key is meant to be public; it identifies the project, and row-level
security is the actual access control. Never ship the service-role key to a
browser.

## Supabase project — shared with uBomber

Crestfall and uBomber share one Supabase instance. Crestfall's tables are
prefixed `crestfall_` so nothing collides, but the *migration history* cannot be
shared: `supabase_migrations.schema_migrations` is a single table per project,
and uBomber owns it.

So on the hosted project, **do not use `supabase db push`**. It will report

```
Remote migration versions not found in local migrations directory.
```

because uBomber's migrations are recorded there and absent here. Apply the
schema directly instead:

```sh
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
make db-apply-shared
```

The connection string is in Dashboard → Project Settings → Database. The SQL is
written to be idempotent, so running this again after a schema change is normal
and safe — that is the mechanism replacing migration history here.

> **Never run these against the shared project:**
>
> - `supabase migration repair --status reverted 20260730000000` — the CLI
>   suggests it, but it rewrites the shared history and would make uBomber's next
>   `db push` try to re-apply its own init migration.
> - `supabase db pull` — it would write uBomber's schema into this repo's
>   `supabase/migrations/`.
>
> `supabase link` is still fine, and `make db-start` / `make db-reset` are
> unaffected: the local stack is this project's own and has no shared history.

If Crestfall ever gets its own Supabase project, delete this section and the
`db-apply-shared` target — `supabase db push` then works as normal.

### Scheduled cleanup

Invites are ephemeral, and expired rows are kept for an hour so a late arrival
gets "this link has expired" rather than a bare not-found. Enable `pg_cron` from
the dashboard (Database → Extensions), then:

```sql
select cron.schedule(
  'cleanup-crestfall-invites',
  '0 * * * *',
  'select public.cleanup_expired_crestfall_invites()'
);
```

Without it nothing breaks — the table just accumulates dead rows, and RLS keeps
them invisible either way.

### Realtime

Challenge traffic uses broadcast channels, which need no per-table
configuration: no publication changes, no replication setup. Realtime is enabled
by default on hosted projects. Postgres holds only the invite; presence and
moves never touch it.

## Checklist

- [ ] `npm run build` clean (this runs `tsc --noEmit` first)
- [ ] `npm test` green
- [ ] `npm run perft`, `npm run fuzz`, `npm run determinism` green (CI runs these)
- [ ] Migrations pushed to the target project
- [ ] `/config.json` present in the deployment, pointing at that project
- [ ] `pg_cron` cleanup scheduled
- [ ] Challenge link tested end to end on the deployed URL, on a phone in
      landscape as well as a desktop
