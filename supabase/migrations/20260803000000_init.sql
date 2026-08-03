-- CRESTFALL initial schema.
--
-- The database does one job: hold an invite long enough for a friend to claim
-- it. Everything about the game itself — who is connected, whose turn it is,
-- the moves — travels over a Supabase Realtime broadcast channel and never
-- touches Postgres. No accounts, no history, no personal data beyond a
-- display name the player types in.
--
-- Tables are prefixed `crestfall_` because this project shares its Supabase
-- instance with uBomber, which owns the unprefixed `rooms` table.

create table public.crestfall_invites (
  id uuid primary key default gen_random_uuid(),
  -- Confusable characters (I, L, O, 0, 1) are excluded so a code stays
  -- readable out loud.
  code text not null unique check (code ~ '^[A-HJ-KM-NP-Z2-9]{6}$'),
  host_name text not null check (char_length(host_name) between 1 and 24),
  host_side text not null check (host_side in ('w', 'b')),
  -- Duel choreography is seeded, so both screens must share one seed to play
  -- the same variants. The host deals it and the guest adopts it.
  seed bigint not null,
  guest_name text check (char_length(guest_name) between 1 and 24),
  status text not null default 'open'
    check (status in ('open', 'joined', 'closed')),
  created_at timestamptz not null default now(),
  -- A link is good for 15 minutes. Claiming it starts a match that outlives
  -- the invite: expiry gates joining, never a game in progress.
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create index crestfall_invites_expires_at_idx on public.crestfall_invites (expires_at);

alter table public.crestfall_invites enable row level security;

-- Invites are throwaway, anonymous objects: anyone may create one, and anyone
-- holding the link may look it up. Nothing sensitive is stored.
create policy "anyone can create invites"
  on public.crestfall_invites for insert
  to anon, authenticated
  with check (true);

-- Expiry is enforced here rather than in the client: after 15 minutes the row
-- is simply not visible, so a stale link cannot be claimed even by a client
-- that ignores the timestamp.
create policy "anyone can read live invites"
  on public.crestfall_invites for select
  to anon, authenticated
  using (expires_at > now());

create policy "anyone can claim a live invite"
  on public.crestfall_invites for update
  to anon, authenticated
  using (expires_at > now())
  with check (true);

-- Privileges are granted explicitly. The schema's default privileges do not
-- reach a table created by the migration role, so without these grants every
-- anonymous request fails with "permission denied" before any policy is even
-- consulted. The policies above are what decide which rows are reachable;
-- these grants decide which verbs exist at all.
-- Server-side tooling (and the scheduled cleanup) needs unrestricted access;
-- service_role bypasses RLS but still needs the privilege to exist.
grant all on public.crestfall_invites to service_role;

grant select on public.crestfall_invites to anon, authenticated;

-- Insert is column-scoped on purpose: `expires_at` and `status` must come from
-- their defaults. A table-wide insert grant would let a client hand itself a
-- link that never expires, which is the one rule this table exists to keep.
grant insert (code, host_name, host_side, seed) on public.crestfall_invites to anon, authenticated;

-- Claiming may only write the guest's name and the lifecycle column; the code,
-- the seed and the host's side are fixed once dealt.
grant update (status, guest_name) on public.crestfall_invites to anon, authenticated;

-- Invites are ephemeral. Keep expired rows around briefly so a player who
-- arrives a moment late gets "this link has expired" rather than "not found",
-- then drop them.
create or replace function public.cleanup_expired_crestfall_invites()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.crestfall_invites where expires_at < now() - interval '1 hour';
$$;

-- On hosted Supabase, schedule the cleanup hourly with pg_cron:
--   select cron.schedule('cleanup-crestfall-invites', '0 * * * *',
--                        'select public.cleanup_expired_crestfall_invites()');
-- (See docs/DEPLOYMENT.md; pg_cron is enabled from the dashboard.)
