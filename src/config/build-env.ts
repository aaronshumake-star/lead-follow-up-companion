const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";

/**
 * Rejects Supabase values that would compile a broken or privileged client
 * into the browser bundle. Empty values remain valid for intentional demo
 * builds.
 */
export function assertSupabaseBuildEnv(
  values: Record<string, string | undefined>,
): void {
  const url = values["VITE_SUPABASE_URL"];
  const key = values["VITE_SUPABASE_ANON_KEY"];

  if (!url && !key) return;

  if (!url || !key) {
    throw new Error(
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must either both be set or both be empty.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid URL.");
  }

  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".supabase.co") ||
    url !== parsed.origin
  ) {
    throw new Error(
      "VITE_SUPABASE_URL must be the HTTPS Supabase project origin without a path, query, or fragment.",
    );
  }

  if (!key.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    throw new Error(
      "VITE_SUPABASE_ANON_KEY must be a Supabase Publishable key.",
    );
  }
}
