/**
 * Fase 5B (migración 033): medias en crudo por Volteado y Tintorería hasta Planchado.
 * Spec: 02-DOCS/wiki/sdd/specs/fase-5-flujo-produccion.md
 */
import { test, expect, type Page } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
})

async function elegir(page: Page, textoActual: string | RegExp, opcion: string) {
  await page.getByRole('combobox').filter({ hasText: textoActual }).last().click()
  await page.getByRole('option', { name: opcion, exact: true }).click()
}

async function mockDb(page: Page) {
  return (await page.request.get('/api/mock-db')).json()
}
type Fila = { catalogo_media_id: string; docenas: number }
const docenasDe = (filas: Fila[] | undefined, id: string) => filas?.find(f => f.catalogo_media_id === id)?.docenas

test('Volteado: stock de fuera en crudo, voltear y queda por teñir', async ({ page }) => {
  await page.goto('/dashboard/volteado')
  await page.getByRole('button', { name: 'Ingresar stock de fuera' }).click()
  await elegir(page, 'Elegir producto…', 'CRU-1')
  await page.getByLabel('Docenas').fill('10')
  await page.getByLabel('De dónde vienen').fill('Remallado antes del sistema')
  await page.getByRole('button', { name: 'Guardar ingreso' }).click()
  await expect(page.getByText('Stock de fuera ingresado: 10 docenas de CRU-1 por voltear')).toBeVisible()

  await page.getByRole('button', { name: 'Asignar Lote' }).click()
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Asignar e Iniciar Volteo' }) })
  await form.locator('select').nth(0).selectOption({ label: 'CRU-1 (10 docenas disponibles)' })
  await form.locator('select').nth(1).selectOption({ label: 'Volteador Prueba' })
  await form.locator('input[type="number"]').fill('8')
  await form.getByRole('button', { name: 'Asignar e Iniciar Volteo' }).click()
  await expect(page.getByText(/Lote asignado/)).toBeVisible()

  await page.getByRole('button', { name: /Cerrar Turno — Registrar/ }).first().click()
  const rep = page.locator('form').filter({ has: page.getByRole('button', { name: 'Registrar' }) })
  await rep.locator('input[type="number"]').first().fill('8')
  await rep.getByRole('button', { name: 'Registrar' }).click()
  await expect(page.getByText('Reporte registrado: 8 doc. quedan por teñir en Tintorería.')).toBeVisible()

  const db = await mockDb(page)
  expect(docenasDe(db.stock_listo_voltear, 'cru1')).toBe(2)
  expect(docenasDe(db.stock_listo_tenir, 'cru1')).toBe(8)
  expect(docenasDe(db.stock_listo_planchar, 'cru1')).toBeUndefined()
})

test('Tintorería: enviar 8 en crudo, recibir 7 con merma y motivo; entran a Planchado con su SKU', async ({ page }) => {
  await page.goto('/dashboard/tintoreria')
  await expect(page.getByTestId('por-tenir').getByText('8 doc.')).toBeVisible()
  await elegir(page, 'Elegir media cruda…', 'CRU-1')
  await elegir(page, 'Elegir SKU de color…', 'TST-1')
  await page.getByLabel('Material').selectOption({ label: 'Poliéster' })
  await page.getByLabel('Docenas', { exact: true }).fill('8')
  await page.getByLabel('Operadora que remalló').selectOption({ label: 'Remalladora Prueba' })
  await page.getByRole('button', { name: 'Enviar a tintorería' }).click()
  await expect(page.getByText('Lote enviado a tintorería: 8 docenas de CRU-1')).toBeVisible()

  const planchadoAntes = docenasDe((await mockDb(page)).stock_listo_planchar, 'media1') ?? 0
  await page.getByTestId('lote-tintoreria-CRU-1').getByRole('button', { name: 'Recibir' }).click()
  await page.getByLabel('Docenas recibidas').fill('7')
  await page.getByRole('button', { name: 'Guardar recepción' }).click()
  await expect(page.getByText('Faltan 1 docenas: indica el motivo de la merma')).toBeVisible()
  await page.getByLabel(/Motivo/).fill('manchadas')
  await page.getByRole('button', { name: 'Guardar recepción' }).click()
  await expect(page.getByText('Lote recibido: 7 docenas de TST-1 pasan a Planchado (merma 1)')).toBeVisible()
  await expect(page.getByText('manchadas')).toBeVisible()

  const db = await mockDb(page)
  expect(docenasDe(db.stock_listo_tenir, 'cru1')).toBe(0)
  expect(docenasDe(db.stock_listo_planchar, 'media1')).toBe(planchadoAntes + 7)
  expect(db.lotes_tintoreria).toEqual([expect.objectContaining({
    estado: 'recibido', crudo_id: 'cru1', color_id: 'media1', material: 'poliester', docenas_enviadas: 8, docenas_recibidas: 7,
    docenas_merma: 1, motivo_merma: 'manchadas', remalladora_id: 'rem1',
  })])
})
