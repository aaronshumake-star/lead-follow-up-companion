import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured } from '../../config/env.ts'

/**
 * The browser Supabase client.
 *
 * Only the publishable anon key is used here. The service-role key must never
 * appear in client code — it bypasses Row Level Security, which is the only
 * thing keeping customer rows private. Server-side work that needs elevated
 * access belongs in an Edge Function with the key held as a project secret.
 *
 * Returns null when Supabase is not configured so a fresh clone still boots in
 * demo mode instead of throwing at import time.
 */
let cachedClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  if (cachedClient !== null) return cachedClient

  cachedClient = createClient(env.VITE_SUPABASE_URL as string, env.VITE_SUPABASE_ANON_KEY as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The app is a single-page app with no OAuth redirect flow, so there is
      // never a session to recover from the URL.
      detectSessionInUrl: false,
      storageKey: 'lead-follow-up-companion.auth',
    },
    global: {
      headers: { 'x-application-name': 'lead-follow-up-companion' },
    },
  })

  return cachedClient
}

/**
 * Type generation is deferred to the phase that adds real queries:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 *
 * then pass the generated `Database` type to createClient.
 */
