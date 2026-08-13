import { createBrowserClient } from '@supabase/ssr'
import { createMockClient } from './mockDb'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const isMock = !url || url.includes('tu-proyecto')

  if (isMock) {
    return createMockClient() as any
  }

  return createBrowserClient(
    url!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
