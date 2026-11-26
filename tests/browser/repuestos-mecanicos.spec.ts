/**
 * Fase 3 — Repuestos y mecánicos, en el navegador (modo mock).
 * Datos sembrados en tests/browser/datos-prueba.json: "Correa de prueba" agotada (costo 30),
 * "Aguja de prueba" con stock. Spec: 02-DOCS/wiki/sdd/specs/fase-3-repuestos-mecanicos.md
 */
import { test, expect, type Page } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
})

async function elegir(page: Page, textoActual: string | RegExp, opcion: string) {
  await page.getByRole('combobox').filter({ hasText: textoActual }).click()
  await page.getByRole('option', { name: opcion }).click()
}

async function abrirRepuestos(page: Page) {
  await page.goto('/dashboard/materia-prima')
  await page.getByRole('button', { name: /Repuestos/ }).first().click()
}

test('Repuestos: buscador y filtro con stock / agotados', async ({ page }) => {
  await abrirRepuestos(page)
  const tabla = page.locator('table').filter({ hasText: 'Descripción del Repuesto' })
  await page.getByLabel('Buscar repuesto').fill('CORREA')
  await expect(tabla.getByText('Correa de prueba')).toBeVisible()
  await expect(tabla.getByText('Aguja de prueba')).toHaveCount(0)

  await page.getByLabel('Buscar repuesto').fill('')
  await page.getByRole('button', { name: 'Agotados' }).click()
  await expect(tabla.getByText('Correa de prueba')).toBeVisible()
  await expect(tabla.getByText('Aguja de prueba')).toHaveCount(0)

  await page.getByRole('button', { name: 'Con stock' }).click()
  await expect(tabla.getByText('Aguja de prueba')).toBeVisible()
  await expect(tabla.getByText('Correa de prueba')).toHaveCount(0)
})

test('Repuestos: comprar al contado sube el stock y fija el último precio', async ({ page }) => {
  await abrirRepuestos(page)
  await page.getByRole('button', { name: 'Comprar Correa de prueba' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Cantidad').fill('4')
  await modal.getByLabel(/Precio unitario pagado/).fill('12')
  await expect(modal.getByTestId('total-compra-repuesto')).toHaveText('S/ 48.00')
  // Efectivo por defecto con la casilla de caja marcada; sin caja abierta, avisa y la compra queda como gasto
  await expect(modal.getByLabel(/Pagado con efectivo de la caja del día/)).toBeChecked()
  await modal.getByRole('button', { name: 'Registrar compra' }).click()
  await expect(page.getByText('Compra registrada: S/ 48.00')).toBeVisible()
  await expect(page.getByText(/No hay una caja abierta hoy/)).toBeVisible()

  const fila = page.locator('tr').filter({ hasText: 'Correa de prueba' })
  await expect(fila.getByText('4 Unid.')).toBeVisible()
  await expect(fila.getByText('S/ 12.00')).toBeVisible()

  // Cantidad 0: el formulario no se envía (validación del navegador) y el stock no cambia
  await page.getByRole('button', { name: 'Registrar compra de repuesto' }).click()
  await elegir(page, 'Elegir repuesto...', 'Correa de prueba (stock 4)')
  await modal.getByLabel(/Precio unitario pagado/).fill('12')
  await modal.getByLabel('Cantidad').fill('0')
  await modal.getByRole('button', { name: 'Registrar compra' }).click()
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Cancelar' }).click()
  await expect(fila.getByText('4 Unid.')).toBeVisible()
})

test('Máquinas: registrar un mecánico (no es usuario) y asignarlo al reportar una falla', async ({ page }) => {
  await page.goto('/dashboard/maquinas')
  await page.getByRole('button', { name: 'Añadir mecánico' }).click()
  await page.getByLabel('Nombre del mecánico').fill('Ana')
  await page.getByLabel('Apellido del mecánico').fill('Torres')
  await page.getByLabel('Teléfono del mecánico').fill('955000111')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Mecánico Ana Torres registrado')).toBeVisible()
  await expect(page.getByRole('link', { name: '955000111' })).toBeVisible()

  await elegir(page, 'Sin asignación inmediata', 'Ana Torres · 955000111')
  await page.getByPlaceholder(/Especifique el síntoma/).fill('Correa rota')
  await page.getByRole('button', { name: /ENVIAR REPORTE CRÍTICO/ }).click()
  await page.getByRole('button', { name: 'Sí, Marcar Avería' }).click()
  await expect(page.getByText(/Reporte crítico enviado/)).toBeVisible()

  await page.goto('/dashboard/mantenimiento')
  await expect(page.getByText('Mecánico: Ana Torres')).toBeVisible()

  // Un mecánico no aparece en Usuarios
  await page.goto('/dashboard/usuarios')
  await expect(page.locator('main')).toBeVisible()
  await expect(page.getByText('Ana Torres')).toHaveCount(0)
})
