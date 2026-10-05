/**
 * Materia Prima en navegador: registrar una compra y aprobarla en control de
 * calidad suma al stock real una sola vez (migración 024).
 */
import { test, expect, type Page } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })

async function elegir(page: Page, textoActual: string | RegExp, opcion: string | RegExp) {
  await page.getByRole('combobox').filter({ hasText: textoActual }).click()
  await page.getByRole('option', { name: opcion }).click()
}

async function stockAlgodonBlanco(page: Page) {
  const db = await (await page.request.get('/api/mock-db')).json()
  return Number(db.materia_prima.find((m: { id: string }) => m.id === 'mp1').stock_kg)
}

test('compra → control de calidad → el stock sube exactamente lo comprado', async ({ page, context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
  await page.goto('/dashboard/materia-prima')
  await expect(page.getByRole('button', { name: /Registrar Compra/ }).first()).toBeVisible()
  const antes = await stockAlgodonBlanco(page)

  await page.getByRole('button', { name: /Registrar Compra/ }).first().click()
  await elegir(page, 'Selecciona el proveedor...', /Proveedor Prueba/)
  await elegir(page, 'Selecciona tipo de insumo...', /Algodón - Blanco/)
  await page.getByPlaceholder('Ej. 150').fill('10')
  await page.getByPlaceholder('Ej. 1200.0').fill('100')
  await page.getByRole('button', { name: /Registrar Compra/ }).last().click()
  await expect(page.getByText(/Orden de compra registrada/)).toBeVisible()
  expect(await stockAlgodonBlanco(page)).toBe(antes)

  await page.getByRole('button', { name: 'Inspeccionar' }).first().click()
  await page.getByRole('button', { name: /Confirmar Aprobación/ }).click()
  await expect(page.getByText(/Entrega aprobada/)).toBeVisible()
  await expect.poll(() => stockAlgodonBlanco(page)).toBe(antes + 10)
  await expect(page.getByRole('button', { name: 'Inspeccionar' })).toHaveCount(0)
})
