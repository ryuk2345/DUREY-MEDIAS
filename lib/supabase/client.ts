import { createBrowserClient } from '@supabase/ssr'
import { createMockClient } from './mockDb'

// Igual que createBrowserClient (que devuelve siempre la misma instancia), el mock
// se reutiliza: varias páginas usan el cliente como dependencia de useCallback y
// una instancia nueva por render provocaba recargas en bucle en modo local.
let mockClient: ReturnType<typeof createMockClient> | null = null

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
    mockClient ??= createMockClient()
    return mockClient as any
  }

  return createBrowserClient(url, key)
}
