/**
 * Lo que se registra en Clientes y Diseños llega a la base (no se queda en el navegador).
 */
import { test, expect } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

async function leerBase(page: import('@playwright/test').Page) {
  return (await page.request.get('/api/mock-db')).json()
}

test('un cliente registrado queda en la base y no en localStorage', async ({ page, context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
  await page.goto('/dashboard/clientes')
  await page.getByRole('button', { name: /Registrar Cliente/ }).first().click()
  await page.getByPlaceholder('Ej: 45678912').fill('41234567')
  await page.getByPlaceholder('Ej: Juan Pérez / Comercial Gamarra S.A.C.').fill('Cliente Prueba Base')
  await page.getByRole('button', { name: 'Registrar Cliente', exact: true }).click()
  await expect(page.getByText(/registrado exitosamente/)).toBeVisible()

  await expect.poll(async () => (await leerBase(page)).clientes?.some((c: { nombre: string }) => c.nombre === 'Cliente Prueba Base')).toBe(true)
  const claves = await page.evaluate(() => Object.keys(localStorage))
  expect(claves.filter(k => /durey_clientes|durey_materia_prima|durey_compras|durey_proveedores/.test(k))).toEqual([])
})

test('un diseño con foto se guarda con una foto real, no con una vista previa blob:', async ({ page, context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
  await page.goto('/dashboard/disenos')
  await page.getByRole('button', { name: /Nuevo Diseño/ }).first().click()
  // PNG de 1x1
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
  await page.locator('input[type="file"]').setInputFiles({ name: 'muestra.png', mimeType: 'image/png', buffer: png })
  await page.getByPlaceholder('Ej: DIS-001').fill('DIS-PRB-77')
  await page.getByPlaceholder('Ej: Media Deportiva con Puntera Reforzada').fill('Diseño prueba foto')
  await page.getByPlaceholder('Ej: Blanco / Rayas Azules').fill('Negro')
  await page.getByRole('button', { name: 'Registrar Diseño' }).click()
  await expect(page.getByText(/registrados correctamente/)).toBeVisible()

  await expect.poll(async () => {
    const d = (await leerBase(page)).disenos?.find((x: { codigo: string }) => x.codigo === 'DIS-PRB-77')
    return d ? String(d.foto_url).slice(0, 11) : null
  }).toBe('data:image/')
})
