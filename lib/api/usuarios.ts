/**
 * Helper cliente para /api/usuarios-lista.
 * Reemplaza supabase.from('usuarios').select/update desde el lado del cliente.
 * Todas las operaciones pasan por el adminClient (service_role) en el servidor.
 */

export interface UsuarioSimple {
  id: string
  nombre: string
  estado?: string
  rol?: string
  activo?: boolean
  email?: string
  [key: string]: any
}

interface ListarUsuariosOptions {
  rol?: string
  roles?: string[]
  campos?: string
  activo?: 'true' | 'false' | 'all'
}

/** Lista usuarios por rol usando /api/usuarios-lista */
export async function listarUsuarios(opts: ListarUsuariosOptions): Promise<UsuarioSimple[]> {
  const params = new URLSearchParams()

  if (opts.roles && opts.roles.length > 0) {
    params.set('roles', opts.roles.join(','))
  } else if (opts.rol) {
    params.set('rol', opts.rol)
  }

  if (opts.campos) params.set('campos', opts.campos)
  if (opts.activo) params.set('activo', opts.activo)

  const res = await fetch(`/api/usuarios-lista?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }))
    throw new Error(err.error ?? 'Error al cargar usuarios')
  }

  const json = await res.json()
  return json.data ?? []
}

/** Actualiza el estado (disponible/ocupada) de un usuario */
export async function actualizarEstadoUsuario(id: string, estado: 'disponible' | 'ocupada'): Promise<void> {
  const res = await fetch('/api/usuarios-lista', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, estado })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }))
    throw new Error(err.error ?? 'Error al actualizar estado de usuario')
  }
}
