/**
 * Fase 1 en navegador: correcciones y botones (migración 027).
 *
 * Corre antes que flujo-comercial y flujos-planta (orden alfabético, 1 worker):
 * no deja compras pendientes ni cambia "Salón A", que esos tests usan.
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

async function mockDb(page: Page) {
  return (await page.request.get('/api/mock-db')).json()
}

test('Máquinas: la tarjeta MANTENIMIENTO muestra solo las máquinas en mantenimiento', async ({ page }) => {
  await page.goto('/dashboard/maquinas')
  await page.getByRole('button', { name: /^MANTENIMIENTO/ }).click()
  const lista = page.getByTestId('maquinas-filtradas')
  await expect(lista.getByText('Máquinas: Mantenimiento (1)')).toBeVisible()
  await expect(lista.getByText('ANGE03', { exact: true })).toBeVisible()
  await expect(lista.getByText('ANGE01', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: /^OPERATIVA/ }).click()
  await expect(lista.getByText('Máquinas: Operativa (2)')).toBeVisible()
  await expect(lista.getByText('ANGE03', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Ver todas' }).click()
  await expect(lista).toHaveCount(0)
})

test('Almacenes: editar nombre, eliminar uno vacío y BLOQUEAR uno con paquetes', async ({ page }) => {
  await page.goto('/dashboard/almacen')

  // Crear, renombrar y eliminar (vacío → se oculta)
  await page.getByRole('button', { name: /Añadir Salón/ }).click()
  await page.getByPlaceholder(/Ej: Salón D/).fill('Salón Temporal')
  await page.getByRole('button', { name: 'Crear Salón' }).click()
  await page.getByRole('button', { name: 'Editar nombre de Salón Temporal' }).click()
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Salón Norte')
  await page.getByRole('button', { name: 'Guardar Nombre' }).click()
  await expect(page.getByText('Almacén renombrado a Salón Norte')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Salón Norte' })).toBeVisible()

  await page.getByRole('button', { name: 'Eliminar Salón Norte' }).click()
  await page.getByRole('button', { name: 'Eliminar Almacén' }).click()
  await expect(page.getByText(/Salón Norte eliminado/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Salón Norte' })).toHaveCount(0)
  const db = await mockDb(page)
  expect(db.ubicaciones.find((u: { nombre: string }) => u.nombre === 'Salón Norte')?.activo).toBe(false)

  // Un salón con paquetes dentro no se elimina y se explica por qué
  await page.getByRole('button', { name: /Añadir Salón/ }).click()
  await page.getByPlaceholder(/Ej: Salón D/).fill('Salón Lleno')
  await page.getByRole('button', { name: 'Crear Salón' }).click()
  await expect(page.getByRole('heading', { name: 'Salón Lleno' })).toBeVisible()
  await page.getByRole('button', { name: /Ingreso Directo de Stock/ }).click()
  await page.getByPlaceholder(/Busca por SKU, código o nombre/).fill('TST')
  await page.getByRole('button', { name: /TST-1/ }).first().click()
  await page.getByPlaceholder('Ej: 20').fill('1')
  await page.getByRole('combobox').filter({ hasText: /Salón A|Seleccionar salón/ }).click()
  await page.getByRole('option', { name: /Salón Lleno/ }).click()
  await page.getByRole('button', { name: /Confirmar Ingreso al Stock/ }).click()
  await expect(page.getByText(/1 docenas \(12 pares\)/)).toBeVisible()

  await page.getByRole('button', { name: 'Eliminar Salón Lleno' }).click()
  await page.getByRole('button', { name: 'Eliminar Almacén' }).click()
  await expect(page.getByText(/No se puede eliminar Salón Lleno: tiene 1 paquete\(s\) dentro/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Salón Lleno' })).toBeVisible()
})

test('Materia prima: compra a crédito → cuotas arriba, "en camino", pago registrado en el historial', async ({ page }) => {
  await page.goto('/dashboard/materia-prima')
  await page.getByRole('button', { name: /Registrar Compra/ }).first().click()
  await elegir(page, 'Selecciona el proveedor...', /Proveedor Prueba/)
  await elegir(page, 'Selecciona tipo de insumo...', /Algodón - Blanco/)
  await page.getByPlaceholder('Ej. 150').fill('5')
  await page.getByPlaceholder('Ej. 1200.0').fill('300')
  await elegir(page, 'Al Contado', /A Crédito/)
  await page.getByRole('button', { name: /Registrar Compra/ }).last().click()
  await expect(page.getByText(/Se crearon 3 cuotas en Cuentas por Pagar/)).toBeVisible()

  // El insumo muestra lo que está en camino (el stock aún no sube)
  await expect(page.getByText('+ 5 conos en camino (pendiente de control de calidad)')).toBeVisible()

  // Cuentas por pagar: el resumen de arriba refleja la deuda (antes quedaba en 0)
  await page.getByRole('button', { name: /Cuentas por Pagar/ }).click()
  const resumen = page.getByTestId('resumen-cuentas-por-pagar')
  await expect(resumen.getByText('3 cuota(s) pendiente(s)')).toBeVisible()
  await expect(page.getByText('Al día (S/ 0.00)')).toHaveCount(0)

  // Pagar la primera cuota en efectivo (sin caja abierta: queda en el historial y avisa)
  await page.getByRole('button', { name: 'Pagar Cuota' }).first().click()
  await elegir(page, 'Transferencia Bancaria', 'Efectivo de Caja')
  await expect(page.getByText(/se resta de la caja abierta del día/)).toBeVisible()
  await page.getByRole('button', { name: 'Registrar Pago de Cuota' }).click()
  await expect(page.getByText(/No había una caja abierta hoy/)).toBeVisible()
  await expect(resumen.getByText('2 cuota(s) pendiente(s)')).toBeVisible()
  const historial = page.getByTestId('historial-pagos-proveedores')
  await expect(historial.getByText('Proveedor Prueba')).toBeVisible()
  await expect(historial.getByText('Efectivo de Caja')).toBeVisible()

  // Reprogramar la siguiente cuota
  await page.getByRole('button', { name: 'Reprogramar' }).first().click()
  await page.getByLabel('Nueva fecha de vencimiento').fill('2030-01-15')
  await page.getByRole('button', { name: 'Guardar Fecha' }).click()
  await expect(page.getByText('📅 Cuota reprogramada para el 2030-01-15')).toBeVisible()
  await expect(page.getByRole('cell', { name: '2030-01-15', exact: true })).toBeVisible()

  // Dejar la compra aprobada (materia-prima.spec espera no tener compras pendientes)
  await page.getByRole('button', { name: /Materia Prima/ }).first().click()
  await page.getByRole('button', { name: 'Inspeccionar' }).first().click()
  await page.getByRole('button', { name: /Confirmar Aprobación/ }).click()
  await expect(page.getByText(/Entrega aprobada/)).toBeVisible()
  await expect(page.getByText(/en camino \(pendiente de control de calidad\)/)).toHaveCount(0)
})
