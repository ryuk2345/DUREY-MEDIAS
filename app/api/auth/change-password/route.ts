import { NextResponse, type NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { requerirSesion } from '@/lib/auth/session'

/**
 * POST /api/auth/change-password
 * Cambia la contraseña del usuario de la sesión (cookie durey_auth_token).
 * Usado en dos escenarios:
 *   1. Primer login (debe_cambiar_password = TRUE en BD) — no requiere contraseña actual
 *   2. Cambio voluntario — requiere contraseña actual para confirmar identidad
 *
 * Body:
 *   nuevaPassword : string  — Nueva contraseña (mínimo 8 caracteres)
 *   passwordActual: string? — Requerido si debe_cambiar_password es FALSE
 *
 * El usuario y el escenario salen de la sesión y de la BD, nunca del body.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requerirSesion(req)
    if ('respuesta' in auth) return auth.respuesta
    const userId = auth.sesion.sub

    const { nuevaPassword, passwordActual } = await req.json()

    if (!nuevaPassword) {
      return NextResponse.json(
        { error: 'nuevaPassword es requerida' },
        { status: 400 }
      )
    }

    if (nuevaPassword.length < 8) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 8 caracteres' },
        { status: 400 }
      )
    }

    if (nuevaPassword === 'durey2026') {
      return NextResponse.json(
        { error: 'No puedes usar la contraseña temporal como nueva contraseña. Elige una diferente.' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Obtener usuario actual
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, activo, password_hash, debe_cambiar_password')
      .eq('id', userId)
      .single()

    if (error || !usuario) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (!usuario.activo) {
      return NextResponse.json({ error: 'Cuenta desactivada' }, { status: 403 })
    }

    // Si NO es primer login (según la BD), verificar contraseña actual
    if (!usuario.debe_cambiar_password) {
      if (!passwordActual) {
        return NextResponse.json(
          { error: 'Se requiere la contraseña actual para confirmar el cambio' },
          { status: 400 }
        )
      }
      if (!usuario.password_hash) {
        return NextResponse.json(
          { error: 'No hay contraseña registrada. Contacta al Administrador.' },
          { status: 400 }
        )
      }
      const actual_ok = await bcrypt.compare(passwordActual, usuario.password_hash)
      if (!actual_ok) {
        return NextResponse.json(
          { error: 'La contraseña actual es incorrecta' },
          { status: 401 }
        )
      }
    }

    // Generar nuevo hash (cost 12)
    const nuevoHash = await bcrypt.hash(nuevaPassword, 12)

    const { error: updateErr } = await supabase
      .from('usuarios')
      .update({
        password_hash: nuevoHash,
        debe_cambiar_password: false
      })
      .eq('id', userId)

    if (updateErr) {
      return NextResponse.json(
        { error: 'Error al actualizar contraseña: ' + updateErr.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Error en el servidor: ' + err.message },
      { status: 500 }
    )
  }
}
