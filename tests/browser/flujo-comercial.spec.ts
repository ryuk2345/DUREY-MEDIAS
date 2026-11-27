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

test('Almacén: escanear un código que no existe NO crea stock (antes inventaba 10 docenas)', async ({ page }) => {
  await page.goto('/dashboard/almacen')
  const escaner = page.getByPlaceholder(/Apunta la pistola escáner/)
  await escaner.fill('B-9999')
  await escaner.press('Enter')
  await expect(page.getByText(/El saco B-9999 no está registrado/)).toBeVisible()
  await expect(page.getByText('B-9999', { exact: true })).toHaveCount(0)
})

test('Ventas: registrar una venta genera el código V-1001', async ({ page }) => {
  await page.goto('/dashboard/ventas')
  await page.getByRole('button', { name: /Nueva Venta/ }).click()
  await elegirSiFalta(page, 'Seleccionar Vendedora...', /Vendedora Prueba/)
  await page.getByPlaceholder('Ej. 45678912 o 20601234567').fill('45678912')
  await page.getByPlaceholder(/Juan Carlos Pérez/).fill('Cliente de Prueba')
  // La fila nueva toma el primer producto si el catálogo ya cargó: elegir solo si quedó vacía
  await elegirSiFalta(page, 'Tipo de media...', /TST-1/)
  await page.getByPlaceholder('Docenas').first().fill('2')
  await page.getByPlaceholder('S/ Docena').first().fill('40')
  await page.getByRole('button', { name: /Confirmar y Generar Venta/ }).click()
  await expect(page.getByText(/Venta V-1001 registrada/)).toBeVisible()
})

test('Despacho: despachar la venta genera la guía GR-9001', async ({ page }) => {
  await page.goto('/dashboard/despacho')
  await page.getByRole('button', { name: /V-1001/ }).click()
  // 6A: se eligen sacos completos; el de 3 docenas cubre las 2 pedidas y sobra 1
  await expect(page.getByRole('button', { name: /Despachar y Cerrar/ }).first()).toBeDisabled()
  await page.locator('[data-testid^="saco-disponible-"]').filter({ hasText: '3 doc.' }).first().getByRole('checkbox').check()
  await expect(page.getByText(/Sobran 1 doc\. de TST-1/)).toBeVisible()
  await page.getByRole('button', { name: /Despachar y Cerrar/ }).first().click()
  await expect(page.getByTestId('aviso-sobrante')).toContainText('1 docenas de TST-1')
  // Fase 1: añadir una agencia nueva (antes había solo 4 fijas) y despachar con ella
  await page.getByRole('button', { name: /Añadir agencia/ }).click()
  await page.getByLabel('Nombre de la nueva agencia').fill('Cruz del Sur')
  await page.getByRole('button', { name: 'Guardar Agencia' }).click()
  await expect(page.getByText('Agencia Cruz del Sur añadida')).toBeVisible()
  await expect(page.getByRole('combobox').filter({ hasText: 'Cruz del Sur' })).toBeVisible()
  await page.getByRole('button', { name: /Despachar y Cerrar/ }).last().click()
  await expect(page.getByText(/Pedido V-1001 despachado\. Guía GR-9001/)).toBeVisible()
  const db = await (await page.request.get('/api/mock-db')).json()
  expect(db.guias_remision.at(-1).agencia).toBe('Cruz del Sur')
  expect(db.agencias.map((a: { nombre: string }) => a.nombre)).toContain('Cruz del Sur')
  // Quién despachó y el sobrante quedan registrados
  expect(db.guias_remision.at(-1).despachado_por).toBe('65a2de1b-03f2-4b95-82c2-cc2e3ffc30bb')
  expect(db.despacho_detalle.at(-1)).toMatchObject({ docenas_pedidas: 2, docenas_entregadas: 3 })
  await expect(page.getByTestId('guia-GR-9001').getByText('Admin General')).toBeVisible()
})

test('Almacén: el salón muestra su stock, se traslada un saco y el kardex lo registra con usuario', async ({ page }) => {
  await page.goto('/dashboard/almacen')
  const bloque = page.getByTestId('salones-kardex')
  await bloque.getByLabel('Salón', { exact: true }).selectOption({ label: 'Salón A' })
  // Ingreso directo de otro saco para trasladarlo
  await page.getByRole('button', { name: /Ingreso Directo de Stock/ }).click()
  await page.getByPlaceholder(/Busca por SKU, código o nombre/).fill('TST')
  await page.getByRole('button', { name: /TST-1/ }).first().click()
  await page.getByPlaceholder('Ej: 20').fill('4')
  await elegirSiFalta(page, 'Seleccionar salón...', /Salón A/)
  await page.getByRole('button', { name: /Confirmar Ingreso al Stock/ }).click()
  await expect(page.getByText(/4 docenas \(48 pares\)/)).toBeVisible()
  await expect(bloque.getByTestId('stock-salon').getByText('TST-1')).toBeVisible()
  const db0 = await (await page.request.get('/api/mock-db')).json()
  const otro = db0.ubicaciones.find((u: { nombre: string; activo?: boolean }) => u.nombre !== 'Salón A' && u.activo !== false)
  test.skip(!otro, 'Hace falta un segundo salón en los datos de prueba')
  const saco = db0.paquetes.filter((p: { estado: string; docenas: number }) => p.estado === 'almacenado' && p.docenas === 4).at(-1)
  await bloque.getByTestId(`saco-${saco.codigo_paquete}`).getByRole('button', { name: 'Trasladar' }).click()
  await page.getByLabel('Salón de destino').selectOption({ label: otro.nombre })
  await page.getByRole('button', { name: 'Trasladar', exact: true }).last().click()
  await expect(page.getByText(`Saco ${saco.codigo_paquete} trasladado a ${otro.nombre}`)).toBeVisible()
  await expect(bloque.getByTestId('kardex').getByText('Traslado (sale)')).toBeVisible()
  const db = await (await page.request.get('/api/mock-db')).json()
  const movs = db.movimientos_stock.filter((m: { paquete_id: string }) => m.paquete_id === saco.id)
  expect(movs.map((m: { tipo: string }) => m.tipo)).toEqual(['ingreso_directo', 'traslado_salida', 'traslado_entrada'])
  expect(movs.every((m: { usuario_id: string }) => m.usuario_id === '65a2de1b-03f2-4b95-82c2-cc2e3ffc30bb')).toBe(true)
})
