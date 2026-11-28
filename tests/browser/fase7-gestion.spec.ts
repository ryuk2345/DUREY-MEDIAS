/**
 * Fase 7 en el navegador (migración 036): editar un producto sin poder tocar SKU ni código,
 * registrar un egreso con comprobante (antes fallaba) y abrir y cerrar la caja por sus funciones.
 */
import { test, expect, type Page } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context, baseURL }) => { await iniciarSesionAdmin(context, baseURL!) })

const mockDb = async (page: Page) => (await page.request.get('/api/mock-db')).json()

test('Catálogo: se edita el color; el SKU y el código quedan fijos y no se pueden escribir', async ({ page }) => {
  await page.goto('/dashboard/catalogo')
  const fila = page.getByRole('row').filter({ hasText: 'TST-2' }).first()
  await fila.getByTitle('Editar').click()
  await expect(page.getByLabel('SKU del producto')).toHaveAttribute('readonly', '')
  await expect(page.getByLabel('Código del producto')).toHaveAttribute('readonly', '')
  await expect(page.getByText('El SKU no se cambia')).toBeVisible()
  await page.getByPlaceholder('Ej. Con diseño / Negro').fill('Verde Fase 7')
  await page.getByRole('button', { name: /Guardar Producto/ }).click()
  await expect(page.getByText('Producto actualizado')).toBeVisible()
  const db = await mockDb(page)
  const p = db.catalogo_medias.find((c: { codigo: string }) => c.codigo === 'TST-2')
  expect(p).toMatchObject({ sku: 'SKU-TST-2', codigo: 'TST-2', diseno_color: 'Verde Fase 7' })
})

test('Egresos: un gasto con comprobante se registra (antes la base lo rechazaba)', async ({ page }) => {
  await page.goto('/dashboard/egresos')
  await page.getByRole('button', { name: /Registrar Egreso/ }).click()
  await page.getByPlaceholder(/Pago de planilla semanal/).fill('Luz de planta F7')
  await page.getByPlaceholder('Ej: 350.00').fill('120')
  await page.getByPlaceholder('https://ejemplo.com/factura.pdf').fill('https://ejemplo.com/luz.pdf')
  await page.getByRole('button', { name: /Registrar Gasto/ }).click()
  await expect(page.getByText(/Gasto operativo registrado/)).toBeVisible()
  const db = await mockDb(page)
  expect(db.egresos_adicionales.find((e: { concepto: string }) => e.concepto === 'Luz de planta F7'))
    .toMatchObject({ monto: 120, comprobante_url: 'https://ejemplo.com/luz.pdf' })
})

test('Caja: se abre y al cerrar con faltante pide justificación y guarda la diferencia calculada en la base', async ({ page }) => {
  await page.goto('/dashboard/ventas')
  await expect(page.getByRole('button', { name: /Abrir Caja/ })).toBeVisible()
  await page.getByRole('button', { name: /Abrir Caja/ }).click()
  const dialogo = page.getByRole('dialog')
  await page.waitForTimeout(500)
  if (await dialogo.getByRole('combobox').filter({ hasText: 'Seleccionar Vendedora...' }).count()) {
    await dialogo.getByRole('combobox').filter({ hasText: 'Seleccionar Vendedora...' }).click()
    await page.getByRole('option', { name: /Vendedora Prueba/ }).click()
  }
  await expect(dialogo.getByRole('combobox').filter({ hasText: 'Vendedora Prueba' })).toBeVisible()
  await page.getByPlaceholder('0.00').first().fill('50')
  await page.getByRole('button', { name: /Abrir Caja/ }).last().click()
  await expect(page.getByText('Caja abierta exitosamente')).toBeVisible()
  await page.getByRole('button', { name: /Cerrar Caja/ }).click()
  await page.getByPlaceholder('0.00').last().fill('40')
  await page.getByRole('button', { name: /Confirmar Cierre/ }).click()
  await expect(page.getByText(/justificación para el faltante/)).toBeVisible()
  await page.getByPlaceholder(/motivo de la diferencia/).fill('Prueba de cierre')
  await page.getByRole('button', { name: /Confirmar Cierre/ }).click()
  await expect(page.getByText(/Caja cerrada faltante/)).toBeVisible()
  const db = await mockDb(page)
  const caja = db.cajas_diarias.at(-1)
  expect(caja).toMatchObject({ saldo_inicial: 50, saldo_declarado_efectivo: 40, estado: 'cerrada_faltante', justificacion: 'Prueba de cierre' })
  expect(caja.diferencia).toBe(Math.round((40 - caja.saldo_esperado_efectivo) * 100) / 100)
})
