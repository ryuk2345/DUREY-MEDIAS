import { createBrowserClient } from '@supabase/ssr'
import { createMockClient } from './mockDb'
import { crearFetchConSesion } from '@/lib/auth/tokenDb'

// Igual que createBrowserClient (que devuelve siempre la misma instancia), el mock
// se reutiliza: varias páginas usan el cliente como dependencia de useCallback y
// una instancia nueva por render provocaba recargas en bucle en modo local.
let mockClient: ReturnType<typeof createMockClient> | null = null

/** true si no hay un Supabase real configurado (desarrollo local con la base mock). */
export function usaBaseMock() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return (
    !url ||
    !url.startsWith('https://') ||
    url.includes('tu-proyecto') ||
    url.includes('placeholder') ||
    url.includes('example') ||
    !url.includes('.supabase.co')
  )
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

  if (usaBaseMock()) {
    mockClient ??= createMockClient()
    return mockClient as any
  }

  // Las consultas a tablas, RPC y Storage van con el JWT del usuario (cookie durey_db_token),
  // no como 'anon': así la base puede negar el acceso a quien no inició sesión (migración 026).
  return createBrowserClient(url, key, { global: { fetch: crearFetchConSesion() } })
}
