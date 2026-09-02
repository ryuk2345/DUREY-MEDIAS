import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { generateSupabaseJWT } from '@/lib/auth/jwt'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email y contraseña requeridos' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()
    const supabase = createAdminClient()

    // Consultar usuario incluyendo hash y flag de cambio obligatorio
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, activo, password_hash, debe_cambiar_password')
      .eq('email', normalizedEmail)
      .single()

    if (error || !usuario) {
      return NextResponse.json(
        { error: 'Credenciales inválidas o usuario no registrado' },
        { status: 401 }
      )
    }

    if (!usuario.activo) {
      return NextResponse.json(
        { error: 'Esta cuenta ha sido desactivada por el Administrador' },
        { status: 403 }
      )
    }

    // Verificar que el usuario tiene contraseña asignada
    if (!usuario.password_hash) {
      return NextResponse.json(
        { error: 'Tu cuenta aún no tiene contraseña configurada. Contacta al Administrador.' },
        { status: 401 }
      )
    }

    // Comparar contraseña contra el hash almacenado
    const passwordValido = await bcrypt.compare(password, usuario.password_hash)
    if (!passwordValido) {
      return NextResponse.json(
        { error: 'Credenciales inválidas o usuario no registrado' },
        { status: 401 }
      )
    }

    const matchedUser = {
      id: usuario.id,
      email: usuario.email,
      rol: usuario.rol || 'vendedora',
      nombre: usuario.nombre || normalizedEmail.split('@')[0]
    }

    // Generar JWT firmado compatible con Supabase PostgREST
    const access_token = generateSupabaseJWT(matchedUser)

    const response = NextResponse.json({
      success: true,
      access_token,
      user: matchedUser,
      debe_cambiar_password: usuario.debe_cambiar_password ?? false
    })

    // Guardar cookies de sesión para Next.js
    const oneWeek = 60 * 60 * 24 * 7
    response.cookies.set('durey_user_role', matchedUser.rol, { path: '/', maxAge: oneWeek })
    response.cookies.set('durey_user_name', encodeURIComponent(matchedUser.nombre), { path: '/', maxAge: oneWeek })
    response.cookies.set('durey_user_id', matchedUser.id, { path: '/', maxAge: oneWeek })
    response.cookies.set('durey_user_logged', 'true', { path: '/', maxAge: oneWeek })

    const mockPayload = encodeURIComponent(JSON.stringify(matchedUser))
    response.cookies.set('durey_mock_session', mockPayload, { path: '/', maxAge: oneWeek })

    return response
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Error en el servidor de autenticación: ' + error.message },
      { status: 500 }
    )
  }
}
