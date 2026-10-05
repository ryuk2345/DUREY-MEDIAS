import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, requerirSesion } from '@/lib/auth/session'
import { COOKIE_TOKEN_DB, OPCIONES_COOKIE_TOKEN_DB, tokenAceptadoPorSupabase } from '@/lib/auth/tokenDb'
import { usaBaseMock } from '@/lib/supabase/client'

/**
 * Publica la cookie legible durey_db_token a partir de la sesión httpOnly.
 * La llama el cliente de Supabase del navegador cuando la cookie falta
 * (ver recuperarTokenDbNavegador en lib/auth/tokenDb.ts).
 */
export async function POST(request: NextRequest) {
  const auth = await requerirSesion(request)
  if ('respuesta' in auth) return auth.respuesta

  const sinCache = { 'Cache-Control': 'no-store' }
  if (usaBaseMock()) return NextResponse.json({ ok: false }, { headers: sinCache })

  const token = request.cookies.get(AUTH_COOKIE)?.value ?? ''
  const aceptado = await tokenAceptadoPorSupabase(token)
  const respuesta = NextResponse.json({ ok: aceptado === true }, { headers: sinCache })
  if (aceptado === true) respuesta.cookies.set(COOKIE_TOKEN_DB, token, OPCIONES_COOKIE_TOKEN_DB)
  return respuesta
}
