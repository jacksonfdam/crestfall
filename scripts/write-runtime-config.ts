/**
 * Writes public/config.json from the environment, so a hosted build can reach
 * Supabase without the file being committed.
 *
 * Runs as the first step of `npm run build`. It is deliberately forgiving: with
 * no Supabase variables set it writes nothing and exits 0, which keeps CI and
 * offline builds working — the game runs fine without the file and only link
 * challenges go dark. It also never overwrites an existing local config unless
 * the environment actually has something to say.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

const target = join('public', 'config.json');

if (!url || !anonKey) {
  const note = existsSync(target)
    ? `keeping the existing ${target}`
    : 'challenges will be unavailable in this build';
  console.log(
    `write-runtime-config: SUPABASE_URL / SUPABASE_ANON_KEY not set — ${note}.`,
  );
  process.exit(0);
}

mkdirSync('public', { recursive: true });
writeFileSync(target, `${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anonKey }, null, 2)}\n`);

// The anon key is public by design, but there is no reason to print it.
console.log(`write-runtime-config: wrote ${target} for ${new URL(url).host}`);
