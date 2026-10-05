/**
 * Etapa 1b: el navegador consulta la base con el JWT del usuario y la base
 * (migración 026) niega todo a quien no tiene sesión.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COOKIE_TOKEN_DB,
  baseAbiertaSinSesion,
  crearFetchConSesion,
  leerTokenDbNavegador,
  reiniciarCacheTokenDb,
  reiniciarRecuperacionTokenDb,
  recuperarTokenDbNavegador,
  tokenAceptadoPorSupabase,
} from '@/lib/auth/tokenDb'

const SUPABASE = 'https://proyecto.supabase.co'

function fetchFalso(status: number) {
  return vi.fn<typeof fetch>(async () => new Response('{}', { status }))
}

describe('Cookie del token de base de datos', () => {
  it('lee el token entre otras cookies', () => {
    expect(leerTokenDbNavegador(`a=1; ${COOKIE_TOKEN_DB}=abc.def.ghi; b=2`)).toBe('abc.def.ghi')
  })
  it('sin cookie o vacía → null (se consulta como antes)', () => {
    expect(leerTokenDbNavegador('a=1')).toBeNull()
    expect(leerTokenDbNavegador(`${COOKIE_TOKEN_DB}=`)).toBeNull()
  })
})

describe('fetch del cliente de Supabase', () => {
  const anon = 'Bearer anon-key'

  it('[NEGOCIO] tablas, RPC y Storage van con el JWT del usuario en lugar de la anon key', async () => {
    const base = fetchFalso(200)
    const f = crearFetchConSesion(base, () => 'jwt-usuario')
    for (const url of [`${SUPABASE}/rest/v1/ventas?select=*`, `${SUPABASE}/rest/v1/rpc/registrar_venta`, `${SUPABASE}/storage/v1/object/disenos/a.png`]) {
      await f(url, { headers: { Authorization: anon, apikey: 'anon-key' } })
      const headers = new Headers(base.mock.calls.at(-1)![1]!.headers)
      expect(headers.get('Authorization')).toBe('Bearer jwt-usuario')
      expect(headers.get('apikey')).toBe('anon-key')
    }
  })

  it('no toca las llamadas de Supabase Auth', async () => {
    const base = fetchFalso(200)
    const f = crearFetchConSesion(base, () => 'jwt-usuario')
    const init = { headers: { Authorization: anon } }
    await f(`${SUPABASE}/auth/v1/user`, init)
    expect(base.mock.calls[0][1]).toBe(init)
  })

  it('sin token y sin poder recuperarlo deja la petición igual que antes', async () => {
    const base = fetchFalso(200)
    const f = crearFetchConSesion(base, () => null, async () => null)
    const init = { headers: { Authorization: anon } }
    await f(`${SUPABASE}/rest/v1/maquinas`, init)
    expect(base.mock.calls[0][1]).toBe(init)
  })

  it('[NEGOCIO] si falta la cookie la recupera ANTES de consultar (si no, la base responde "permission denied")', async () => {
    const base = fetchFalso(200)
    const recuperar = vi.fn(async () => 'jwt-recuperado')
    const f = crearFetchConSesion(base, () => null, recuperar)
    await f(`${SUPABASE}/rest/v1/reportes_produccion?select=*`, { headers: { Authorization: anon } })
    expect(recuperar).toHaveBeenCalledTimes(1)
    expect(new Headers(base.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer jwt-recuperado')
  })

  it('con la cookie presente no pide nada al servidor', async () => {
    const recuperar = vi.fn(async () => 'otro')
    const f = crearFetchConSesion(fetchFalso(200), () => 'jwt-usuario', recuperar)
    await f(`${SUPABASE}/rest/v1/maquinas`)
    expect(recuperar).not.toHaveBeenCalled()
  })
})

describe('Recuperación de la cookie en el navegador', () => {
  beforeEach(() => {
    reiniciarRecuperacionTokenDb()
    document.cookie = `${COOKIE_TOKEN_DB}=; max-age=0; path=/`
  })

  it('varias consultas a la vez generan UNA sola petición al servidor', async () => {
    const servidor = vi.fn<typeof fetch>(async () => {
      document.cookie = `${COOKIE_TOKEN_DB}=jwt-nuevo; path=/`
      return new Response('{"ok":true}')
    })
    const tokens = await Promise.all([recuperarTokenDbNavegador(servidor), recuperarTokenDbNavegador(servidor), recuperarTokenDbNavegador(servidor)])
    expect(tokens).toEqual(['jwt-nuevo', 'jwt-nuevo', 'jwt-nuevo'])
    expect(servidor).toHaveBeenCalledTimes(1)
    expect(servidor.mock.calls[0][0]).toBe('/api/auth/token-db')
  })

  it('sin sesión no insiste en cada consulta', async () => {
    const servidor = vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 }))
    expect(await recuperarTokenDbNavegador(servidor)).toBeNull()
    expect(await recuperarTokenDbNavegador(servidor)).toBeNull()
    expect(servidor).toHaveBeenCalledTimes(1)
  })
})

describe('Verificación de la firma contra Supabase', () => {
  beforeEach(() => {
    reiniciarCacheTokenDb()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('[NEGOCIO] 401 = secreto equivocado → NO se publica el token (si no, toda la app fallaría)', async () => {
    expect(await tokenAceptadoPorSupabase('jwt', fetchFalso(401))).toBe(false)
  })

  it('200 o 403 = la firma pasó la verificación', async () => {
    expect(await tokenAceptadoPorSupabase('jwt', fetchFalso(200))).toBe(true)
    reiniciarCacheTokenDb()
    expect(await tokenAceptadoPorSupabase('jwt', fetchFalso(403))).toBe(true)
  })

  it('error de red o 5xx = no se sabe, se reintenta después', async () => {
    expect(await tokenAceptadoPorSupabase('jwt', fetchFalso(503))).toBeNull()
    const caido = vi.fn(async () => { throw new Error('offline') })
    expect(await tokenAceptadoPorSupabase('jwt', caido)).toBeNull()
    expect(await tokenAceptadoPorSupabase('jwt', fetchFalso(200))).toBe(true)
  })

  it('una vez aceptada no vuelve a consultar (sin costo por petición)', async () => {
    const base = fetchFalso(200)
    await tokenAceptadoPorSupabase('jwt', base)
    await tokenAceptadoPorSupabase('jwt', base)
    expect(base).toHaveBeenCalledTimes(1)
    const headers = new Headers(base.mock.calls[0][1]!.headers)
    expect(headers.get('Authorization')).toBe('Bearer jwt')
  })

  it('un rechazo se recuerda unos minutos (no satura Supabase)', async () => {
    const base = fetchFalso(401)
    await tokenAceptadoPorSupabase('jwt', base)
    await tokenAceptadoPorSupabase('jwt', base)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('detecta si la base sigue abierta sin sesión', async () => {
    expect(await baseAbiertaSinSesion(fetchFalso(200))).toBe(true)
    expect(await baseAbiertaSinSesion(fetchFalso(401))).toBe(false)
  })
})

describe('Migraciones posteriores a la 026', () => {
  it('[NEGOCIO] ninguna migración nueva vuelve a dar permisos a anon', () => {
    const dir = path.resolve(__dirname, '../../supabase/migrations')
    const nuevas = readdirSync(dir).filter(f => /^\d{3}_/.test(f) && Number(f.slice(0, 3)) > 26)
    for (const archivo of nuevas) {
      const sql = readFileSync(path.join(dir, archivo), 'utf8').replace(/--.*$/gm, '')
      expect(sql, `${archivo} da GRANT a anon`).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i)
    }
  })
})
