/**
 * Runtime configuration for challenges.
 *
 * Deliberately free of any Supabase import: this is loaded during boot to decide
 * whether the menu can offer challenges at all, and dragging the client library
 * into the initial payload for a player who never opens one would cost every
 * cold load. `src/net/session.ts` — and with it the client — is imported only
 * once a challenge actually starts.
 */

export interface NetConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/**
 * Fetched rather than baked in, so one build runs against any Supabase project.
 * Returns null when the file is absent or unusable — the game is fully playable
 * without it and only challenges go dark.
 */
export async function loadNetConfig(baseUrl = ''): Promise<NetConfig | null> {
  try {
    const res = await fetch(`${baseUrl}/config.json`);
    if (!res.ok) return null;
    const raw = (await res.json()) as Partial<NetConfig>;
    if (!raw.supabaseUrl || !raw.supabaseAnonKey) return null;
    return { supabaseUrl: raw.supabaseUrl, supabaseAnonKey: raw.supabaseAnonKey };
  } catch {
    return null;
  }
}
