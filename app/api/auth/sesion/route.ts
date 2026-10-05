import { NextRequest, NextResponse } from 'next/server'
import { requerirSesion } from '@/lib/auth/session'

/** Usuario de la sesión actual, leído del JWT firmado (no de cookies editables). */
export async function GET(request: NextRequest) {
  const auth = await requerirSesion(request)
  if ('respuesta' in auth) return auth.respuesta
  const { sub, email, nombre, rol } = auth.sesion
  return NextResponse.json({ id: sub, email, nombre, rol }, { headers: { 'Cache-Control': 'no-store' } })
}
