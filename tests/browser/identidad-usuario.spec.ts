/**
 * Las pantallas identifican al usuario con la sesión verificada (/api/auth/sesion).
 * Antes usaban supabase.auth.getUser(), que en este sistema siempre es null: el
 * Calendario guardaba eventos con autor '1' y la base real los rechazaba
 * ("invalid input syntax for type uuid").
 */
import { test, expect } from '@playwright/test'
import { ADMIN_ID, iniciarSesionAdmin } from './sesion'

test('un evento del calendario se guarda con el usuario real como autor', async ({ page, context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
  await page.goto('/dashboard/calendario')
  await page.getByRole('button', { name: /Nuevo Evento/ }).first().click()
  await page.getByPlaceholder('Ej: Reunión de coordinación, Visita técnica, etc.').fill('Evento prueba identidad')
  // Fecha lejana: un evento de hoy dispara el aviso de próximos eventos en las demás pantallas
  await page.locator('input[type="date"]').fill('2030-01-15')
  await page.getByRole('button', { name: 'Guardar Evento' }).click()
  await expect(page.getByText(/Evento programado exitosamente/)).toBeVisible()

  await expect.poll(async () => {
    const db = await (await page.request.get('/api/mock-db')).json()
    const ev = (db.eventos_calendario ?? []).find((e: { titulo: string }) => e.titulo === 'Evento prueba identidad')
    return ev && { creado_por: ev.creado_por, creado_por_nombre: ev.creado_por_nombre }
  }).toEqual({ creado_por: ADMIN_ID, creado_por_nombre: 'Admin General' })
})

test('sin sesión válida, /api/auth/sesion no inventa un usuario', async ({ request }) => {
  const res = await request.get('/api/auth/sesion')
  expect(res.status()).toBe(401)
})

test('con sesión, /api/auth/sesion devuelve el usuario del JWT', async ({ page, context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
  const res = await page.request.get('/api/auth/sesion')
  expect(await res.json()).toEqual({ id: ADMIN_ID, email: 'admin@durey.com', nombre: 'Admin General', rol: 'admin' })
})
