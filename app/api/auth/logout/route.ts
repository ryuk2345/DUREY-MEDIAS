import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true })

  // Limpiar todas las cookies de autenticación
  response.cookies.set('durey_auth_token', '', { path: '/', maxAge: 0 })
  response.cookies.set('durey_user_role', '', { path: '/', maxAge: 0 })
  response.cookies.set('durey_user_name', '', { path: '/', maxAge: 0 })
  response.cookies.set('durey_user_id', '', { path: '/', maxAge: 0 })
  response.cookies.set('durey_user_logged', '', { path: '/', maxAge: 0 })
  response.cookies.set('durey_mock_session', '', { path: '/', maxAge: 0 })

  return response
}
