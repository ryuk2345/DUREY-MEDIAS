import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { nombre, email, rol, password, activo } = body

    if (!nombre || !email || !rol || !password) {
      return NextResponse.json({ error: 'Faltan campos obligatorios (nombre, email, rol, password)' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ 
        error: 'Las credenciales administrativas de Supabase no están completamente configuradas en las variables de entorno.' 
      }, { status: 500 })
    }

    // Instanciar cliente administrativo seguro
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // 1. Crear el usuario en Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password: password.trim(),
      email_confirm: true
    })

    if (authError || !authData?.user) {
      return NextResponse.json({ error: `Error en Autenticación: ${authError?.message}` }, { status: 400 })
    }

    const authUserId = authData.user.id

    // 2. Insertar en la tabla pública "usuarios"
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
      // 3. Rollback: si falla la inserción SQL, eliminamos la cuenta creada en Auth para evitar cuentas fantasma
      await supabaseAdmin.auth.admin.deleteUser(authUserId)
      return NextResponse.json({ error: `Error en Base de Datos (Rollback ejecutado): ${dbError.message}` }, { status: 400 })
    }

    return NextResponse.json({ success: true, userId: authUserId })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error interno del servidor' }, { status: 500 })
  }
}
