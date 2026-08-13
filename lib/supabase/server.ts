import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createMockClient } from './mockDb'

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const isMock = !url || url.includes('tu-proyecto')

  if (isMock) {
    return createMockClient() as any
  }

  const cookieStore = await cookies()

  return createServerClient(
    url!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — ignorar
          }
        },
      },
    }
  )
}
