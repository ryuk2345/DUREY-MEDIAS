import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, requerirSesion } from '@/lib/auth/session'
import { COOKIE_TOKEN_DB, baseAbiertaSinSesion, probarTokenEnSupabase } from '@/lib/auth/tokenDb'
import { usaBaseMock } from '@/lib/supabase/client'

/**
 * Comprobación previa a la migración 026 (cerrar tablas). Abrir con la sesión iniciada:
 *   https://<sitio>/api/diagnostico/sesion-db
 * Solo si "listo_para_026" es true se puede ejecutar la migración sin dejar a nadie fuera.
 */
export async function GET(request: NextRequest) {
  const auth = await requerirSesion(request)
  if ('respuesta' in auth) return auth.respuesta

  if (usaBaseMock()) {
    return NextResponse.json({ modo: 'base local de prueba (mock)', listo_para_026: false, mensaje: 'Este diagnóstico solo aplica con Supabase real.' })
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value ?? ''
  const [firmaAceptada, abierta] = await Promise.all([probarTokenEnSupabase(token), baseAbiertaSinSesion()])
  const navegadorTieneToken = request.cookies.get(COOKIE_TOKEN_DB)?.value === token

  let mensaje: string
  if (firmaAceptada === false) {
    mensaje = 'NO ejecutes la migración 026. Supabase rechaza la firma de la sesión: en Vercel, SUPABASE_JWT_SECRET debe ser el "JWT Secret" (Legacy JWT secret) de Supabase → Project Settings → JWT Keys. Corrígelo, vuelve a desplegar, cierra sesión, entra de nuevo y repite esta prueba.'
  } else if (firmaAceptada === null) {
    mensaje = 'No se pudo comprobar (Supabase no respondió). Recarga esta página en un minuto.'
  } else if (!navegadorTieneToken) {
    mensaje = 'Supabase acepta la sesión, pero este navegador aún no tiene la cookie nueva. Recarga esta página (o cierra sesión y vuelve a entrar).'
  } else if (abierta === false) {
    mensaje = 'Todo correcto: la base ya está cerrada para quien no inició sesión (la migración 026 ya está aplicada).'
  } else {
    mensaje = 'Todo correcto: puedes ejecutar la migración 026 en Supabase.'
  }

  return NextResponse.json({
    usuario: auth.sesion.email,
    supabase_acepta_la_sesion: firmaAceptada,
    navegador_envia_la_sesion: navegadorTieneToken,
    tablas_abiertas_sin_sesion: abierta,
    listo_para_026: firmaAceptada === true && navegadorTieneToken,
    mensaje,
  })
}
