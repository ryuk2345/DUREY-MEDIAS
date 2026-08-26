import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createMockClient } from './mockDb'

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

  const isMock =
    !url ||
    !key ||
    !url.startsWith('https://') ||
    url.includes('tu-proyecto') ||
    url.includes('placeholder') ||
    url.includes('example') ||
    !url.includes('.supabase.co')

  if (isMock) {
    return createMockClient() as any
  }

  try {
    const cookieStore = await cookies()

    return createServerClient(
      url,
      key,
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
  } catch (e) {
    return createMockClient() as any
  }
}
