import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })))

vi.mock('@supabase/supabase-js', () => ({ createClient }))

vi.mock('../../config/env.ts', () => ({
  env: {
    VITE_SUPABASE_URL: 'https://project.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'publishable-key',
  },
  isSupabaseConfigured: true,
}))

describe('Supabase browser client', () => {
  beforeEach(() => {
    createClient.mockClear()
  })

  it('detects sessions returned by recovery and magic-link URLs', async () => {
    const { getSupabaseClient } = await import('./client.ts')
    getSupabaseClient()

    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'publishable-key',
      expect.objectContaining({
        auth: expect.objectContaining({ detectSessionInUrl: true }),
      }),
    )
  })
})
