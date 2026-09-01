import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createMockClient } from './mockDb'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '')

  const isMock =
    !url ||
    !serviceKey ||
    !url.startsWith('https://') ||
    url.includes('tu-proyecto') ||
    url.includes('placeholder') ||
    url.includes('example') ||
    !url.includes('.supabase.co')

  if (isMock) {
    return createMockClient() as any
  }

  return createSupabaseClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}
