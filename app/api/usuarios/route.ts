import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

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

    // 1. Si está configurada la Service Role Key, creamos en Auth + DB de forma administrativa
    if (supabaseServiceKey) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      })

      // Crear en Supabase Auth
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password: (password || 'durey2026').trim(),
        email_confirm: true
      })

      if (authError || !authData?.user) {
        // Si el correo ya existe en Auth, intentamos registrarlo/vincularlo en la tabla pública
        if (authError?.message?.includes('already registered') || authError?.message?.includes('already been registered')) {
          const { error: dbInsertErr } = await supabaseAdmin.from('usuarios').insert({
            nombre: nombre.trim(),
            email: email.trim().toLowerCase(),
            rol,
            activo: activo ?? true
          })
          if (!dbInsertErr) {
            return NextResponse.json({ success: true, message: 'Usuario vinculado a cuenta existente' })
          }
        }
        return NextResponse.json({ error: `Error en Autenticación: ${authError?.message}` }, { status: 400 })
      }

      const authUserId = authData.user.id

      // Insertar en la tabla pública "usuarios"
      const { error: dbError } = await supabaseAdmin
        .from('usuarios')
        .insert({
          auth_id: authUserId,
          nombre: nombre.trim(),
          email: email.trim().toLowerCase(),
          rol,
          activo: activo ?? true
        })

      if (dbError) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId)
        return NextResponse.json({ error: `Error en Base de Datos: ${dbError.message}` }, { status: 400 })
      }

      return NextResponse.json({ success: true, userId: authUserId })
    }

    // 2. Modo Resiliente (Sin Service Role Key): Insertar directamente en la tabla pública "usuarios"
    const clientKey = supabaseAnonKey || 'placeholder'
    const supabaseClient = createClient(supabaseUrl, clientKey)

    const { error: dbError } = await supabaseClient
      .from('usuarios')
      .insert({
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        rol,
        activo: activo ?? true
      })

    if (dbError) {
      return NextResponse.json({ error: `Error en Base de Datos: ${dbError.message}` }, { status: 400 })
    }

    return NextResponse.json({ 
      success: true, 
      warning: 'Usuario registrado en el sistema. (Para habilitar el inicio de sesión con contraseña en Supabase Auth, configura SUPABASE_SERVICE_ROLE_KEY en Vercel)' 
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error interno del servidor' }, { status: 500 })
  }
}

