/**
 * Fase 6B en el navegador: venta a cuotas → cronograma impreso con productos → productos en
 * la cartera → orden de despacho impresa desde Ventas y desde Despacho.
 */
import { test, expect, type Page } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context, baseURL }) => { await iniciarSesionAdmin(context, baseURL!) })

const CLIENTE = 'Cliente Cuotas 6B'

async function elegirSiFalta(page: Page, textoVacio: string, opcion: RegExp) {
  await page.waitForTimeout(500)
  if (await page.getByRole('combobox').filter({ hasText: textoVacio }).count()) {
    await page.getByRole('combobox').filter({ hasText: textoVacio }).click()
    await page.getByRole('option', { name: opcion }).click()
  }
}

/** Abre la impresión (pestaña nueva) y devuelve su HTML; window.print queda anulado. */
async function capturarImpresion(page: Page, accion: () => Promise<void>): Promise<string> {
  await page.context().addInitScript(() => { window.print = () => {} })
  const [popup] = await Promise.all([page.waitForEvent('popup'), accion()])
  await popup.waitForLoadState()
  const html = await popup.content()
  await popup.close()
  return html
}

test('Venta a cuotas: el cronograma impreso lleva el detalle de productos', async ({ page }) => {
  // Stock propio para no depender de otras pruebas: un saco de 3 docenas de TST-1 en el Salón A
  await page.goto('/dashboard/almacen')
  await page.getByRole('button', { name: /Ingreso Directo de Stock/ }).click()
  await page.getByPlaceholder(/Busca por SKU, código o nombre/).fill('TST')
  await page.getByRole('button', { name: /TST-1/ }).first().click()
  await page.getByPlaceholder('Ej: 20').fill('3')
  await elegirSiFalta(page, 'Seleccionar salón...', /Salón A/)
  await page.getByRole('button', { name: /Confirmar Ingreso al Stock/ }).click()
  await expect(page.getByText(/3 docenas \(36 pares\)/)).toBeVisible()

  await page.goto('/dashboard/ventas')
  await page.getByRole('button', { name: /Nueva Venta/ }).click()
  await elegirSiFalta(page, 'Seleccionar Vendedora...', /Vendedora Prueba/)
  await page.getByPlaceholder('Ej. 45678912 o 20601234567').fill('41414141')
  await page.getByPlaceholder(/Juan Carlos Pérez/).fill(CLIENTE)
  // La fila nueva toma el primer producto del catálogo: se elige TST-1 explícitamente
  await page.waitForTimeout(500)
  await page.getByRole('combobox').filter({ hasText: /Tipo de media|CRU-1|TST-/ }).first().click()
  await page.getByRole('option', { name: /^TST-1/ }).click()
  await page.getByPlaceholder('Docenas').first().fill('2')
  await page.getByPlaceholder('S/ Docena').first().fill('40')
  await page.getByRole('button', { name: /Crédito en Cuotas/ }).click()
  page.once('dialog', d => d.accept())
  const html = await capturarImpresion(page, () => page.getByRole('button', { name: /Confirmar y Generar Venta/ }).click())
  expect(html).toContain('COMPROMISO Y CRONOGRAMA DE PAGOS')
  expect(html).toContain(CLIENTE)
  expect(html).toMatch(/TST-1<\/td><td[^>]*>2<\/td>\s*<td[^>]*>S\/ 40\.00<\/td><td[^>]*>S\/ 80\.00<\/td>/)
  expect(html).toContain('Cuota N° 1')
})

test('Cartera: el cliente muestra qué compró junto a sus cuotas', async ({ page }) => {
  await page.goto('/dashboard/ventas')
  await page.getByRole('button', { name: /Cuentas por Cobrar/ }).click()
  await page.getByText('Vendedora Prueba', { exact: true }).first().click()
  await page.getByText(CLIENTE, { exact: true }).first().click()
  const bloque = page.getByTestId('productos-cronograma')
  await expect(bloque.getByText('TST-1')).toBeVisible()
  await expect(bloque.getByText('S/ 80.00')).toBeVisible()
})

test('Orden de despacho: se imprime desde Ventas y desde Despacho con lo pedido por SKU', async ({ page }) => {
  await page.goto('/dashboard/ventas')
  const db = await (await page.request.get('/api/mock-db')).json()
  const venta = db.ventas.find((v: { cliente_id: string; estado: string }) =>
    v.estado === 'pendiente' && db.clientes.find((c: { id: string; nombre: string }) => c.id === v.cliente_id)?.nombre === CLIENTE)
  const html = await capturarImpresion(page, () => page.getByLabel(`Imprimir orden de despacho ${venta.codigo_venta}`).click())
  expect(html).toContain('ORDEN DE DESPACHO')
  expect(html).toContain(venta.codigo_venta)
  expect(html).toContain(CLIENTE)
  expect(html).toContain('pedido: 2 doc.')
  // Cada saco disponible del SKU aparece con su salón
  const tst = db.catalogo_medias.find((m: { codigo: string }) => m.codigo === 'TST-1').id
  const sacos = db.paquetes.filter((p: { estado: string; catalogo_media_id: string; ubicacion_id: string | null }) =>
    p.estado === 'almacenado' && p.ubicacion_id && p.catalogo_media_id === tst)
  for (const s of sacos) expect(html).toContain(s.codigo_paquete)

  await page.goto('/dashboard/despacho')
  await page.getByRole('button', { name: new RegExp(venta.codigo_venta) }).click()
  const html2 = await capturarImpresion(page, () => page.getByRole('button', { name: /Orden de despacho/ }).click())
  expect(html2).toContain('ORDEN DE DESPACHO')
  expect(html2).toContain(venta.codigo_venta)
})
