/**
 * Quién inició sesión, para pantallas del navegador. Única fuente: /api/auth/sesion,
 * que lee el JWT firmado. Antes cada pantalla usaba supabase.auth.getUser(), que
 * siempre devuelve null en este sistema (el login no usa Supabase Auth), y caía en
 * cookies editables o en valores inventados como id '1' o rol 'admin'.
 */
export interface UsuarioActual {
  id: string
  email: string
  nombre: string
  rol: string
}

let pendiente: Promise<UsuarioActual | null> | null = null

export function obtenerUsuarioActual(fetchBase: typeof fetch = (input, init) => fetch(input, init)): Promise<UsuarioActual | null> {
  pendiente ??= fetchBase('/api/auth/sesion', { credentials: 'same-origin', cache: 'no-store' })
    .then(async res => (res.ok ? ((await res.json()) as UsuarioActual) : null))
    .catch(() => null)
    .then(usuario => {
      // Solo se recuerda un resultado válido; sin sesión se vuelve a preguntar la próxima vez
      if (!usuario?.id) pendiente = null
      return usuario?.id ? usuario : null
    })
  return pendiente
}

/** Al cerrar sesión o en pruebas. */
export function olvidarUsuarioActual() {
  pendiente = null
}
