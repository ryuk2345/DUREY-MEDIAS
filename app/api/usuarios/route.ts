import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { requerirSesion, puedeGestionarUsuarios, puedeGestionarUsuarioObjetivo } from '@/lib/auth/session'

const NO_AUTORIZADO_ADMIN = 'Solo un administrador puede gestionar cuentas de administrador'

/** Rol y email actuales de un usuario (para impedir que un supervisor toque cuentas admin). */
async function obtenerUsuarioObjetivo(id: string): Promise<{ rol: string; email: string } | null> {
  const { data } = await createAdminClient().from('usuarios').select('rol, email').eq('id', id)
  return data?.[0] ?? null
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requerirSesion(request, puedeGestionarUsuarios)
    if ('respuesta' in auth) return auth.respuesta

    const body = await request.json()
    const { nombre, email, rol, password, activo } = body

    if (!nombre || !email || !rol) {
      return NextResponse.json({ error: 'Faltan campos obligatorios (nombre, email, rol)' }, { status: 400 })
    }

    if (!puedeGestionarUsuarioObjetivo(auth.sesion.rol, null, rol)) {
      return NextResponse.json({ error: NO_AUTORIZADO_ADMIN }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl) {
      return NextResponse.json({
        error: 'La URL de Supabase no está configurada en las variables de entorno.'
      }, { status: 500 })
    }

    // Hashear la contraseña (o usar 'durey2026' como temporal si no se proveyó)
    const passwordPlano = (password || 'durey2026').trim()
    const password_hash = await bcrypt.hash(passwordPlano, 12)
    const debe_cambiar_password = !password || password.trim() === 'durey2026'

    // 1. Modo con Service Role Key: crear en Auth + tabla pública
    if (supabaseServiceKey) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password: passwordPlano,
        email_confirm: true
      })

      if (authError || !authData?.user) {
        if (authError?.message?.includes('already registered') || authError?.message?.includes('already been registered')) {
          const { error: dbInsertErr } = await supabaseAdmin.from('usuarios').insert({
            nombre: nombre.trim(),
            email: email.trim().toLowerCase(),
            rol,
            activo: activo ?? true,
            password_hash,
            debe_cambiar_password
          })
          if (!dbInsertErr) {
            return NextResponse.json({ success: true, message: 'Usuario vinculado a cuenta existente' })
          }
        }
        return NextResponse.json({ error: `Error en Autenticación: ${authError?.message}` }, { status: 400 })
      }

      const authUserId = authData.user.id

      const { error: dbError } = await supabaseAdmin.from('usuarios').insert({
        auth_id: authUserId,
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        rol,
        activo: activo ?? true,
        password_hash,
        debe_cambiar_password
      })

      if (dbError) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId)
        return NextResponse.json({ error: `Error en Base de Datos: ${dbError.message}` }, { status: 400 })
      }

      return NextResponse.json({ success: true, userId: authUserId })
    }

    // 2. Sin Service Role Key (desarrollo/mock): insertar solo en la tabla pública
    const { error: dbError } = await createAdminClient().from('usuarios').insert({
      nombre: nombre.trim(),
      email: email.trim().toLowerCase(),
      rol,
      activo: activo ?? true,
      password_hash,
      debe_cambiar_password
    })

    if (dbError) {
      return NextResponse.json({ error: `Error en Base de Datos: ${dbError.message}` }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: '🎉 Usuario registrado correctamente en el sistema.'
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error interno del servidor' }, { status: 500 })
  }
}

// ── PATCH: Editar datos o asignar/resetear contraseña (admin/supervisor) ─────
// Body: { userId, nuevaPassword }                       → resetear contraseña
//       { userId, cambios: { nombre?, email?, rol?, activo? } } → editar perfil
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requerirSesion(request, puedeGestionarUsuarios)
    if ('respuesta' in auth) return auth.respuesta

    const body = await request.json()
    const { userId, nuevaPassword, cambios } = body

    if (!userId || (!nuevaPassword && !cambios)) {
      return NextResponse.json({ error: 'userId y nuevaPassword o cambios son requeridos' }, { status: 400 })
    }

    const objetivo = await obtenerUsuarioObjetivo(userId)
    if (!objetivo) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }
    if (!puedeGestionarUsuarioObjetivo(auth.sesion.rol, objetivo.rol, cambios?.rol)) {
      return NextResponse.json({ error: NO_AUTORIZADO_ADMIN }, { status: 403 })
    }

    if (cambios) {
      const update: Record<string, unknown> = {}
      if (typeof cambios.nombre === 'string') update.nombre = cambios.nombre.trim()
      if (typeof cambios.email === 'string') update.email = cambios.email.trim().toLowerCase()
      if (typeof cambios.rol === 'string') update.rol = cambios.rol
      if (typeof cambios.activo === 'boolean') update.activo = cambios.activo
      if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: 'No hay cambios válidos' }, { status: 400 })
      }
      const { error } = await createAdminClient().from('usuarios').update(update).eq('id', userId)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }
    if (nuevaPassword.length < 8) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, { status: 400 })
    }

    const password_hash = await bcrypt.hash(nuevaPassword.trim(), 12)
    const debe_cambiar_password = nuevaPassword.trim() === 'durey2026'

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('usuarios')
      .update({ password_hash, debe_cambiar_password })
      .eq('id', userId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error interno del servidor' }, { status: 500 })
  }
}

// ── DELETE: Eliminar usuario ──────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requerirSesion(request, puedeGestionarUsuarios)
    if ('respuesta' in auth) return auth.respuesta

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Se requiere id para eliminar' }, { status: 400 })
    }
    if (id === auth.sesion.sub) {
      return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta' }, { status: 400 })
    }

    const objetivo = await obtenerUsuarioObjetivo(id)
    if (!objetivo) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }
    if (!puedeGestionarUsuarioObjetivo(auth.sesion.rol, objetivo.rol)) {
      return NextResponse.json({ error: NO_AUTORIZADO_ADMIN }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    // Borrar la cuenta de Auth usando el email de la BD (nunca uno enviado por el cliente)
    if (supabaseUrl && supabaseServiceKey && objetivo.email) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
      const user = (usersData?.users as any[])?.find((u: any) => u.email?.toLowerCase() === objetivo.email.toLowerCase())
      if (user) await supabaseAdmin.auth.admin.deleteUser(user.id)
    }

    const { error: delErr } = await createAdminClient().from('usuarios').delete().eq('id', id)
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Usuario eliminado correctamente' })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error al eliminar usuario' }, { status: 500 })
  }
}
