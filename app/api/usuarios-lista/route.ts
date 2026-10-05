import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requerirSesion, sanitizarCamposUsuario, COLUMNAS_PUBLICAS_USUARIO } from '@/lib/auth/session'

/**
 * GET /api/usuarios-lista
 * Devuelve usuarios filtrados por rol y activo=true usando service_role.
 * El adminClient nunca depende del JWT del cliente.
 *
 * Query params:
 *   rol    → valor único: "tejedor", "vendedora", etc.
 *   roles  → múltiples separados por coma: "remalladora,remallador"
 *   campos → columnas de COLUMNAS_PUBLICAS_USUARIO (default: "id,nombre,estado"; "*" = todas las públicas)
 *   activo → "true" (default) | "false" | "all"
 * Requiere sesión. password_hash nunca se devuelve.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requerirSesion(req)
    if ('respuesta' in auth) return auth.respuesta

    const { searchParams } = new URL(req.url)
    const rol = searchParams.get('rol')
    const rolesParam = searchParams.get('roles')
    const campos = sanitizarCamposUsuario(searchParams.get('campos'))
    const activoParam = searchParams.get('activo') ?? 'true'

    if (!campos) {
      return NextResponse.json(
        { error: `Campos no permitidos. Permitidos: ${COLUMNAS_PUBLICAS_USUARIO.join(', ')}` },
        { status: 400 }
      )
    }

    if (!rol && !rolesParam) {
      return NextResponse.json(
        { error: 'Se requiere el parámetro "rol" o "roles"' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    let query = supabase.from('usuarios').select(campos)

    if (rolesParam) {
      const roles = rolesParam.split(',').map((r: string) => r.trim()).filter(Boolean)
      query = query.in('rol', roles)
    } else if (rol) {
      query = query.eq('rol', rol)
    }

    if (activoParam === 'true') query = query.eq('activo', true)
    else if (activoParam === 'false') query = query.eq('activo', false)

    query = query.order('nombre')

    const { data, error } = await query

    if (error) {
      console.error('[/api/usuarios-lista] Error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: data ?? [] })
  } catch (err: any) {
    console.error('[/api/usuarios-lista] Exception:', err.message)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

/**
 * PATCH /api/usuarios-lista
 * Actualiza el campo `estado` de un usuario.
 * Body: { id: string, estado: "disponible" | "ocupada" }
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requerirSesion(req)
    if ('respuesta' in auth) return auth.respuesta

    const body = await req.json()
    const { id, estado } = body

    if (!id || !estado) {
      return NextResponse.json(
        { error: 'Se requieren los campos "id" y "estado"' },
        { status: 400 }
      )
    }

    const ESTADOS_VALIDOS = ['disponible', 'ocupada', 'inactivo']
    if (!ESTADOS_VALIDOS.includes(estado)) {
      return NextResponse.json(
        { error: `Estado inválido. Permitidos: ${ESTADOS_VALIDOS.join(', ')}` },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('usuarios')
      .update({ estado })
      .eq('id', id)

    if (error) {
      console.error('[/api/usuarios-lista PATCH] Error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[/api/usuarios-lista PATCH] Exception:', err.message)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
