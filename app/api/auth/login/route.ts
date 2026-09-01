import { NextResponse } from 'next/server'
import { generateSupabaseJWT } from '@/lib/auth/jwt'
import { createClient } from '@/lib/supabase/server'

const ACUENTAS_RAPIDAS_MOCK = [
  { rol: 'admin', nombre: 'Administrador General', email: 'admin@durey.com', pass: 'durey2026', id: '1' },
  { rol: 'supervisor', nombre: 'Supervisor Durey', email: 'supervisor@durey.com', pass: 'durey2026', id: '2' },
  { rol: 'operador', nombre: 'Carlos Operador', email: 'operador@durey.com', pass: 'durey2026', id: '3' },
  { rol: 'vendedora', nombre: 'Sofia Vendedora', email: 'vendedora@durey.com', pass: 'durey2026', id: '8' },
  { rol: 'tecnico', nombre: 'Pedro Técnico', email: 'tecnico@durey.com', pass: 'durey2026', id: '9' },
  { rol: 'almacenero', nombre: 'Juan Almacenero', email: 'almacenero@durey.com', pass: 'durey2026', id: '7' },
  { rol: 'tejedor', nombre: 'Tejedor Operario', email: 'tejedor@durey.com', pass: 'durey2026', id: '3' },
  { rol: 'planchador', nombre: 'Carlos Planchador', email: 'planchador@durey.com', pass: 'durey2026', id: '5' },
  { rol: 'preparador', nombre: 'Lucia Preparadora', email: 'preparador@durey.com', pass: 'durey2026', id: '6' }
]

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
    const supabase = await createClient()

    let matchedUser = {
      id: '',
      email: normalizedEmail,
      rol: 'vendedora',
      nombre: normalizedEmail.split('@')[0]
    }

    // 1. Verificar si coincide con cuentas mock predeterminadas
    const mockAcc = ACUENTAS_RAPIDAS_MOCK.find(a => a.email.toLowerCase() === normalizedEmail)
    if (mockAcc && password === mockAcc.pass) {
      matchedUser = {
        id: mockAcc.id,
        email: mockAcc.email,
        rol: mockAcc.rol,
        nombre: mockAcc.nombre
      }
    } else {
      // 2. Consultar en la base de datos SQL usuarios
      const { data: usuario, error } = await supabase
        .from('usuarios')
        .select('id, nombre, email, rol, activo')
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

      matchedUser = {
        id: usuario.id,
        email: usuario.email,
        rol: usuario.rol || 'vendedora',
        nombre: usuario.nombre || normalizedEmail.split('@')[0]
      }
    }

    // 3. Generar el JWT firmado compatible con Supabase PostgREST
    const access_token = generateSupabaseJWT(matchedUser)

    // 4. Construir la respuesta con cookies de sesión Next.js
    const response = NextResponse.json({
      success: true,
      access_token,
      user: matchedUser
    })

    // Guardar cookies para el middleware de Next.js
    const oneWeek = 60 * 60 * 24 * 7
    response.cookies.set('durey_user_role', matchedUser.rol, { path: '/', maxAge: oneWeek })
    response.cookies.set('durey_user_name', encodeURIComponent(matchedUser.nombre), { path: '/', maxAge: oneWeek })
    response.cookies.set('durey_user_id', matchedUser.id, { path: '/', maxAge: oneWeek })
    response.cookies.set('durey_user_logged', 'true', { path: '/', maxAge: oneWeek })

    // Payload de sesión para mock/server
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
