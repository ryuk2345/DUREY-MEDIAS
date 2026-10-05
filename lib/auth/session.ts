import { NextResponse, type NextRequest } from 'next/server'
import { verifySupabaseJWT, type DecodedDureyJWT } from './jwt'
import { MODULOS_POR_ROL } from '@/lib/utils'

export const AUTH_COOKIE = 'durey_auth_token'

/** Columnas de `usuarios` que pueden salir del servidor. password_hash NUNCA. */
export const COLUMNAS_PUBLICAS_USUARIO = [
  'id', 'auth_id', 'nombre', 'email', 'rol', 'activo', 'estado', 'created_at', 'debe_cambiar_password'
] as const

/** Roles que pueden gestionar usuarios (los que tienen el módulo 'usuarios'). */
export function puedeGestionarUsuarios(rol: string | null | undefined): boolean {
  return !!rol && (MODULOS_POR_ROL[rol]?.includes('usuarios') ?? false)
}

/**
 * Un gestor puede tocar a un usuario objetivo y asignarle un rol solo si
 * ninguno de los dos es 'admin', salvo que el gestor también sea admin.
 */
export function puedeGestionarUsuarioObjetivo(
  rolGestor: string,
  rolObjetivoActual?: string | null,
  rolObjetivoNuevo?: string | null
): boolean {
  if (!puedeGestionarUsuarios(rolGestor)) return false
  if (rolGestor === 'admin') return true
  return rolObjetivoActual !== 'admin' && rolObjetivoNuevo !== 'admin'
}

/**
 * Valida el parámetro `campos` de /api/usuarios-lista contra la lista blanca.
 * '*' se expande a las columnas públicas. Devuelve null si pide algo no permitido.
 */
export function sanitizarCamposUsuario(campos: string | null | undefined): string | null {
  const raw = (campos ?? '').trim()
  if (!raw) return 'id,nombre,estado'
  if (raw === '*') return COLUMNAS_PUBLICAS_USUARIO.join(',')
  const lista = raw.split(',').map(c => c.trim()).filter(Boolean)
  const permitidas = COLUMNAS_PUBLICAS_USUARIO as readonly string[]
  if (lista.length === 0 || lista.some(c => !permitidas.includes(c))) return null
  return lista.join(',')
}

export async function obtenerSesion(request: NextRequest): Promise<DecodedDureyJWT | null> {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (!token) return null
  const sesion = await verifySupabaseJWT(token)
  if (!sesion || !sesion.sub || !sesion.rol || !(sesion.rol in MODULOS_POR_ROL)) return null
  return sesion
}

/**
 * Exige sesión válida (y opcionalmente un permiso). Uso:
 *   const auth = await requerirSesion(req, puedeGestionarUsuarios)
 *   if ('respuesta' in auth) return auth.respuesta
 */
export async function requerirSesion(
  request: NextRequest,
  autorizado?: (rol: string) => boolean
): Promise<{ sesion: DecodedDureyJWT } | { respuesta: NextResponse }> {
  const sesion = await obtenerSesion(request)
  if (!sesion) {
    return { respuesta: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  }
  if (autorizado && !autorizado(sesion.rol)) {
    return { respuesta: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return { sesion }
}
