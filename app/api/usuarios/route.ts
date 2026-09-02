import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { nombre, email, rol, password, activo } = body

    if (!nombre || !email || !rol) {
      return NextResponse.json({ error: 'Faltan campos obligatorios (nombre, email, rol)' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

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

    // 2. Modo Resiliente (sin Service Role Key): insertar directamente en tabla pública
    const clientKey = supabaseAnonKey || 'placeholder'
    const supabaseClient = createClient(supabaseUrl, clientKey)

    const { error: dbError } = await supabaseClient.from('usuarios').insert({
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

// ── PATCH: Asignar o resetear contraseña (solo Admin) ────────────────────────
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { userId, nuevaPassword } = body

    if (!userId || !nuevaPassword) {
      return NextResponse.json({ error: 'userId y nuevaPassword son requeridos' }, { status: 400 })
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
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const email = searchParams.get('email')

    if (!id && !email) {
      return NextResponse.json({ error: 'Se requiere id o email para eliminar' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl) {
      return NextResponse.json({ error: 'URL de Supabase no configurada' }, { status: 500 })
    }

    if (supabaseServiceKey) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
      if (email) {
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
        const user = (usersData?.users as any[])?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase())
        if (user) await supabaseAdmin.auth.admin.deleteUser(user.id)
      }
      if (id) await supabaseAdmin.from('usuarios').delete().eq('id', id)
      else if (email) await supabaseAdmin.from('usuarios').delete().eq('email', email.toLowerCase())
    } else {
      const supabaseClient = createClient(supabaseUrl, supabaseAnonKey || 'placeholder')
      if (id) await supabaseClient.from('usuarios').delete().eq('id', id)
      else if (email) await supabaseClient.from('usuarios').delete().eq('email', email.toLowerCase())
    }

    return NextResponse.json({ success: true, message: 'Usuario eliminado correctamente' })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error al eliminar usuario' }, { status: 500 })
  }
}
