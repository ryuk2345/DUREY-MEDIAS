import { createBrowserClient } from '@supabase/ssr'
import { createMockClient } from './mockDb'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

  // Usar mock si la URL no parece una URL real de Supabase
  const isMock =
    !url ||
    !url.startsWith('https://') ||
    url.includes('tu-proyecto') ||
    url.includes('placeholder') ||
    url.includes('example') ||
    !url.includes('.supabase.co')

  if (isMock) {
    return createMockClient() as any
  }

  return createBrowserClient(url, key)
}
