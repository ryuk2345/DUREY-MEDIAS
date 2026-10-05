/**
 * Sesión del usuario frente a la base de datos (Supabase PostgREST y Storage).
 *
 * El login emite un JWT propio (durey_auth_token, httpOnly) firmado con
 * SUPABASE_JWT_SECRET. Para que la base sepa quién consulta, el navegador debe
 * mandar ese mismo JWT en "Authorization: Bearer". Como la cookie httpOnly no se
 * puede leer desde JavaScript, se publica una copia en la cookie legible
 * durey_db_token, y SOLO si Supabase acepta la firma: si el secreto no fuera el
 * del proyecto, mandar el token haría fallar todas las consultas con 401.
 */

export const COOKIE_TOKEN_DB = 'durey_db_token'

/** Lee el token de base de datos desde document.cookie (solo en el navegador). */
export function leerTokenDbNavegador(cookies: string = typeof document === 'undefined' ? '' : document.cookie): string | null {
  const prefijo = COOKIE_TOKEN_DB + '='
  const par = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(prefijo))
  if (!par) return null
  const valor = decodeURIComponent(par.slice(prefijo.length))
  return valor || null
}

/** Rutas de Supabase que deben ir con la sesión del usuario (Auth maneja su propio token). */
const RUTAS_CON_SESION = /\/(rest|storage)\/v1\//

/**
 * fetch para el cliente de Supabase del navegador: si hay token de base de datos,
 * reemplaza el "Bearer <anon key>" por "Bearer <token del usuario>".
 * Lee la cookie en cada petición para tomar el token nuevo tras volver a iniciar sesión.
 */
export function crearFetchConSesion(
  fetchBase: typeof fetch = (input, init) => fetch(input, init),
  leerToken: () => string | null = () => leerTokenDbNavegador()
): typeof fetch {
  return (input, init) => {
    const token = leerToken()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!token || !RUTAS_CON_SESION.test(url)) return fetchBase(input, init)

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set('Authorization', `Bearer ${token}`)
    return fetchBase(input, { ...init, headers })
  }
}

// Resultado por instancia del servidor: la validez depende del secreto, no del usuario.
let aceptado: boolean | null = null
let rechazadoEn = 0
const REINTENTO_TRAS_RECHAZO_MS = 5 * 60 * 1000

/** Solo para pruebas. */
export function reiniciarCacheTokenDb() {
  aceptado = null
  rechazadoEn = 0
}

/**
 * ¿Supabase acepta la firma de nuestros JWT? Consulta PostgREST con el token:
 * 401 = firma rechazada (SUPABASE_JWT_SECRET no es el del proyecto);
 * cualquier respuesta 2xx/4xx distinta = el token pasó la verificación.
 * Devuelve null si no se pudo comprobar (red caída), para reintentar luego.
 */
export async function tokenAceptadoPorSupabase(
  token: string,
  fetchBase: typeof fetch = (input, init) => fetch(input, init)
): Promise<boolean | null> {
  if (aceptado === true) return true
  if (aceptado === false && Date.now() - rechazadoEn < REINTENTO_TRAS_RECHAZO_MS) return false

  const resultado = await probarTokenEnSupabase(token, fetchBase)
  if (resultado === true) aceptado = true
  if (resultado === false) {
    aceptado = false
    rechazadoEn = Date.now()
  }
  return resultado
}

/** Petición mínima a PostgREST con el token del usuario (sin caché). */
export async function probarTokenEnSupabase(
  token: string,
  fetchBase: typeof fetch = (input, init) => fetch(input, init)
): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url || !anonKey) return null
  try {
    const res = await fetchBase(`${url}/rest/v1/maquinas?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (res.status === 401) return false
    if (res.status >= 500) return null
    return true
  } catch {
    return null
  }
}

/**
 * ¿La base deja leer a alguien SIN sesión (solo con la anon key pública)?
 * true = abierta, false = cerrada, null = no se pudo comprobar.
 */
export async function baseAbiertaSinSesion(
  fetchBase: typeof fetch = (input, init) => fetch(input, init)
): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url || !anonKey) return null
  try {
    const res = await fetchBase(`${url}/rest/v1/maquinas?select=id&limit=1`, {
      // Solo apikey: así entra como 'anon' tanto con la anon key clásica como con las nuevas sb_publishable_
      headers: { apikey: anonKey },
      cache: 'no-store',
    })
    if (res.ok) return true
    if (res.status === 401 || res.status === 403) return false
    return null
  } catch {
    return null
  }
}

export const OPCIONES_COOKIE_TOKEN_DB = {
  httpOnly: false, // el cliente de Supabase del navegador la lee para mandarla en Authorization
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // igual que el JWT (7 días)
}
