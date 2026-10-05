/**
 * Tests de navegador del circuito comercial: Almacén → Ventas → Despacho.
 * Cada paso usa una operación atómica de la base (migración 022).
 *
 * Ejecutar: npm run test:browser
 */
import { test, expect, type Page } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
})

async function elegir(page: Page, textoActual: string | RegExp, opcion: string | RegExp) {
  await page.getByRole('combobox').filter({ hasText: textoActual }).click()
  await page.getByRole('option', { name: opcion }).click()
}

/** Elige la opción solo si el select todavía muestra su texto vacío (algunas pantallas preseleccionan). */
async function elegirSiFalta(page: Page, textoVacio: string, opcion: RegExp) {
  await page.waitForTimeout(500)
  if (await page.getByRole('combobox').filter({ hasText: textoVacio }).count()) await elegir(page, textoVacio, opcion)
  await expect(page.getByRole('combobox').filter({ hasText: opcion }).first()).toBeVisible()
}

test('Almacén: ingreso directo de stock al salón', async ({ page }) => {
  await page.goto('/dashboard/almacen')
  await page.getByRole('button', { name: /Ingreso Directo de Stock/ }).click()
  await page.getByPlaceholder(/Busca por SKU, código o nombre/).fill('TST')
  await page.getByRole('button', { name: /TST-1/ }).first().click()
  await page.getByPlaceholder('Ej: 20').fill('3')
  await elegirSiFalta(page, 'Seleccionar salón...', /Salón A/)
  await page.getByRole('button', { name: /Confirmar Ingreso al Stock/ }).click()
  await expect(page.getByText(/3 docenas \(36 pares\)/)).toBeVisible()
})

test('Ventas: registrar una venta genera el código V-1001', async ({ page }) => {
  await page.goto('/dashboard/ventas')
  await page.getByRole('button', { name: /Nueva Venta/ }).click()
  await elegirSiFalta(page, 'Seleccionar Vendedora...', /Vendedora Prueba/)
  await page.getByPlaceholder('Ej. 45678912 o 20601234567').fill('45678912')
  await page.getByPlaceholder(/Juan Carlos Pérez/).fill('Cliente de Prueba')
  await elegir(page, 'Tipo de media...', /TST-1/)
  await page.getByPlaceholder('Docenas').first().fill('2')
  await page.getByPlaceholder('S/ Docena').first().fill('40')
  await page.getByRole('button', { name: /Confirmar y Generar Venta/ }).click()
  await expect(page.getByText(/Venta V-1001 registrada/)).toBeVisible()
})

test('Despacho: despachar la venta genera la guía GR-9001', async ({ page }) => {
  await page.goto('/dashboard/despacho')
  await page.getByRole('button', { name: /V-1001/ }).click()
  await page.getByRole('button', { name: /Manual/ }).click()
  const sumar = page.locator('button').filter({ has: page.locator('svg.lucide-plus') })
  await sumar.first().click()
  await sumar.first().click()
  await page.getByRole('button', { name: /Despachar y Cerrar/ }).first().click()
  await elegir(page, 'Seleccionar agencia...', 'Shalom')
  await page.getByRole('button', { name: /Despachar y Cerrar/ }).last().click()
  await expect(page.getByText(/Pedido V-1001 despachado\. Guía GR-9001/)).toBeVisible()
})
