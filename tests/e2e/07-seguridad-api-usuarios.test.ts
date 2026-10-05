// @vitest-environment node
/**
 * Seguridad: autenticación y autorización de las APIs de usuarios.
 *
 * A diferencia de 01-06, estos tests ejecutan los route handlers reales
 * (app/api/...) contra la base mock, no una copia de la lógica.
 *
 * El test FALLA si:
 *   - Alguien sin sesión puede cambiar contraseñas, crear, editar o borrar usuarios
 *   - Un rol sin el módulo 'usuarios' puede gestionarlos
 *   - Un supervisor puede tocar cuentas admin o crear admins
 *   - /api/usuarios-lista devuelve password_hash
 *   - Un token sin rol válido se trata como admin
 */
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { generateSupabaseJWT, verifySupabaseJWT } from '@/lib/auth/jwt'
import {
  AUTH_COOKIE,
  puedeGestionarUsuarios,
  puedeGestionarUsuarioObjetivo,
  sanitizarCamposUsuario,
} from '@/lib/auth/session'
import { POST as cambiarPassword } from '@/app/api/auth/change-password/route'
import { POST as crearUsuario, PATCH as editarUsuario, DELETE as borrarUsuario } from '@/app/api/usuarios/route'
import { GET as listarUsuarios, PATCH as cambiarEstado } from '@/app/api/usuarios-lista/route'

// Admin sembrado en mock_db.json
const ADMIN_ID = '65a2de1b-03f2-4b95-82c2-cc2e3ffc30bb'

async function token(rol: string, id = 'u-' + rol) {
  return generateSupabaseJWT({ id, email: `${rol}@durey.com`, rol, nombre: rol })
}

async function req(url: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (init.token) headers.cookie = `${AUTH_COOKIE}=${init.token}`
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: init.method ?? 'GET',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
}

describe('Reglas de autorización (lib/auth/session)', () => {
  it('[SEGURIDAD] Solo roles con el módulo usuarios pueden gestionarlos', () => {
    expect(puedeGestionarUsuarios('admin')).toBe(true)
    expect(puedeGestionarUsuarios('supervisor')).toBe(true)
    expect(puedeGestionarUsuarios('tejedor')).toBe(false)
    expect(puedeGestionarUsuarios('')).toBe(false)
    expect(puedeGestionarUsuarios(null)).toBe(false)
  })

  it('[SEGURIDAD] Un supervisor no puede tocar admins ni crear admins', () => {
    expect(puedeGestionarUsuarioObjetivo('supervisor', 'tejedor', 'vendedora')).toBe(true)
    expect(puedeGestionarUsuarioObjetivo('supervisor', 'admin')).toBe(false)
    expect(puedeGestionarUsuarioObjetivo('supervisor', 'tejedor', 'admin')).toBe(false)
    expect(puedeGestionarUsuarioObjetivo('admin', 'admin', 'admin')).toBe(true)
  })

  it('[SEGURIDAD] campos: nunca password_hash; * se expande a columnas públicas', () => {
    expect(sanitizarCamposUsuario('password_hash')).toBeNull()
    expect(sanitizarCamposUsuario('id,password_hash')).toBeNull()
    expect(sanitizarCamposUsuario('*')).not.toContain('password_hash')
    expect(sanitizarCamposUsuario('id, nombre')).toBe('id,nombre')
    expect(sanitizarCamposUsuario(null)).toBe('id,nombre,estado')
  })

  it('[SEGURIDAD] Un token sin rol NO se interpreta como admin', async () => {
    const t = await token('')
    const decoded = await verifySupabaseJWT(t)
    expect(decoded?.rol).toBe('')
  })
})

describe('Route handlers protegidos', () => {
  it('[SEGURIDAD] change-password sin sesión → 401 (antes cambiaba la clave de cualquiera)', async () => {
    const res = await cambiarPassword(await req('/api/auth/change-password', {
      method: 'POST',
      body: { userId: ADMIN_ID, nuevaPassword: 'hackeado123', esPrimerLogin: true },
    }))
    expect(res.status).toBe(401)
  })

  it('[SEGURIDAD] change-password ignora esPrimerLogin del cliente y exige la contraseña actual', async () => {
    // El admin sembrado tiene debe_cambiar_password = false
    const res = await cambiarPassword(await req('/api/auth/change-password', {
      method: 'POST',
      token: await token('admin', ADMIN_ID),
      body: { nuevaPassword: 'otraClave123', esPrimerLogin: true },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('contraseña actual')
  })

  it('[SEGURIDAD] /api/usuarios sin sesión → 401 en POST, PATCH y DELETE', async () => {
    const crear = await crearUsuario(await req('/api/usuarios', {
      method: 'POST', body: { nombre: 'X', email: 'x@x.com', rol: 'admin', password: 'clave12345' },
    }))
    const editar = await editarUsuario(await req('/api/usuarios', {
      method: 'PATCH', body: { userId: ADMIN_ID, nuevaPassword: 'hackeado123' },
    }))
    const borrar = await borrarUsuario(await req(`/api/usuarios?id=${ADMIN_ID}`, { method: 'DELETE' }))
    expect([crear.status, editar.status, borrar.status]).toEqual([401, 401, 401])
  })

  it('[SEGURIDAD] Un tejedor no puede gestionar usuarios → 403', async () => {
    const res = await editarUsuario(await req('/api/usuarios', {
      method: 'PATCH', token: await token('tejedor'), body: { userId: ADMIN_ID, nuevaPassword: 'hackeado123' },
    }))
    expect(res.status).toBe(403)
  })

  it('[SEGURIDAD] Un supervisor no puede resetear la clave del admin ni crear un admin → 403', async () => {
    const t = await token('supervisor')
    const reset = await editarUsuario(await req('/api/usuarios', {
      method: 'PATCH', token: t, body: { userId: ADMIN_ID, nuevaPassword: 'hackeado123' },
    }))
    const crear = await crearUsuario(await req('/api/usuarios', {
      method: 'POST', token: t, body: { nombre: 'X', email: 'x@x.com', rol: 'admin', password: 'clave12345' },
    }))
    expect(reset.status).toBe(403)
    expect(crear.status).toBe(403)
  })

  it('[SEGURIDAD] /api/usuarios-lista sin sesión → 401; pedir password_hash → 400', async () => {
    const sinSesion = await listarUsuarios(await req('/api/usuarios-lista?rol=admin&campos=*'))
    expect(sinSesion.status).toBe(401)

    const t = await token('tecnico')
    const hash = await listarUsuarios(await req('/api/usuarios-lista?rol=admin&campos=id,password_hash', { token: t }))
    expect(hash.status).toBe(400)

    const todo = await listarUsuarios(await req('/api/usuarios-lista?rol=admin&campos=*', { token: t }))
    expect(todo.status).toBe(200)
    const { data } = await todo.json()
    expect(data.length).toBeGreaterThan(0)
    for (const u of data) expect(u).not.toHaveProperty('password_hash')
  })

  it('[SEGURIDAD] Cambiar estado de un usuario sin sesión → 401', async () => {
    const res = await cambiarEstado(await req('/api/usuarios-lista', {
      method: 'PATCH', body: { id: ADMIN_ID, estado: 'ocupada' },
    }))
    expect(res.status).toBe(401)
  })
})
