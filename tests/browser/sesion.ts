import { SignJWT } from 'jose'
import type { BrowserContext } from '@playwright/test'

/** Secreto con el que la app de pruebas firma y verifica sesiones (ver playwright.config.ts). */
export const SECRETO_JWT_PRUEBAS = 'secreto-solo-para-tests-de-navegador'
export const ADMIN_ID = '65a2de1b-03f2-4b95-82c2-cc2e3ffc30bb'

/** Deja el contexto con la misma sesión que crea /api/auth/login para cualquier usuario. */
export async function iniciarSesionComo(context: BrowserContext, baseURL: string, u: { id: string; email: string; rol: string; nombre: string }) {
  const token = await new SignJWT({ sub: u.id, email: u.email, app_metadata: { rol: u.rol }, user_metadata: { name: u.nombre, rol: u.rol } })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRETO_JWT_PRUEBAS))
  const mockSession = encodeURIComponent(JSON.stringify({ id: u.id, email: u.email, rol: u.rol, nombre: u.nombre }))
  await context.addCookies([
    { name: 'durey_auth_token', value: token, url: baseURL, httpOnly: true },
    { name: 'durey_mock_session', value: mockSession, url: baseURL },
    { name: 'durey_user_id', value: u.id, url: baseURL },
    { name: 'durey_user_role', value: u.rol, url: baseURL },
    { name: 'durey_user_name', value: encodeURIComponent(u.nombre), url: baseURL },
    { name: 'durey_user_logged', value: 'true', url: baseURL },
  ])
}

/** Deja el contexto con la misma sesión que crea /api/auth/login para el admin. */
export async function iniciarSesionAdmin(context: BrowserContext, baseURL: string) {
  const token = await new SignJWT({
    sub: ADMIN_ID,
    email: 'admin@durey.com',
    app_metadata: { rol: 'admin' },
    user_metadata: { name: 'Admin General', rol: 'admin' },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRETO_JWT_PRUEBAS))

  const mockSession = encodeURIComponent(JSON.stringify({ id: ADMIN_ID, email: 'admin@durey.com', rol: 'admin', nombre: 'Admin General' }))
  await context.addCookies([
    { name: 'durey_auth_token', value: token, url: baseURL, httpOnly: true },
    { name: 'durey_mock_session', value: mockSession, url: baseURL },
    { name: 'durey_user_id', value: ADMIN_ID, url: baseURL },
    { name: 'durey_user_role', value: 'admin', url: baseURL },
    { name: 'durey_user_name', value: 'Admin%20General', url: baseURL },
    { name: 'durey_user_logged', value: 'true', url: baseURL },
  ])
}
