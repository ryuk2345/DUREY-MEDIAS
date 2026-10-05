import { SignJWT } from 'jose'
import type { BrowserContext } from '@playwright/test'

/** Secreto con el que la app de pruebas firma y verifica sesiones (ver playwright.config.ts). */
export const SECRETO_JWT_PRUEBAS = 'secreto-solo-para-tests-de-navegador'
export const ADMIN_ID = '65a2de1b-03f2-4b95-82c2-cc2e3ffc30bb'

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
