/**
 * Fase 2 — Reportes con nombres, en el navegador: descarga el Excel real y lo lee.
 * Datos sembrados en tests/browser/datos-prueba.json (día 05/01/2026):
 *   turno día de "Tejedor Prueba" (encargado), "Operaria Tejido" asignada a tejido ese día y turno,
 *   30 docenas en ANGE02; "Remalladora Prueba" remalló 10 docenas en ANGE01.
 * La zona horaria se fija en Lima: la fecha debe salir 05/01/2026 (antes salía un día menos).
 */
import { test, expect, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { iniciarSesionAdmin } from './sesion'

test.use({ timezoneId: 'America/Lima' })

test.beforeEach(async ({ context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
})

async function descargarExcel(page: Page, modulo: string) {
  await page.goto('/dashboard/reportes')
  await page.getByRole('button', { name: modulo }).click()
  const fechas = page.locator('input[type="date"]')
  await fechas.nth(0).fill('2026-01-01')
  await fechas.nth(1).fill('2026-01-31')
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Descargar Reporte Excel/ }).click(),
  ])
  const ruta = await descarga.path()
  const libro = XLSX.read(readFileSync(ruta!))
  const hoja = (nombre: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets[nombre])
  return { hojas: libro.SheetNames, hoja }
}

test('Tejido: el Excel dice turno, encargado y operarios, y resume por persona', async ({ page }) => {
  const { hojas, hoja } = await descargarExcel(page, 'Tejido / Producción')
  expect(hojas).toEqual(['Reporte', 'Resumen por persona'])
  expect(hoja('Reporte')).toEqual([{
    Fecha: '05/01/2026',
    Turno: 'Día',
    Máquina: 'ANGE02',
    'Tipo de Media': 'TST-1',
    Encargado: 'Tejedor Prueba',
    Operarios: 'Operaria Tejido',
    'Docenas Producidas': 30,
  }])
  expect(hoja('Resumen por persona')).toEqual([{ Persona: 'Tejedor Prueba', Registros: 1, 'Docenas Producidas': 30 }])
})

test('Remallado: el Excel dice la remalladora y la máquina', async ({ page }) => {
  const { hoja } = await descargarExcel(page, 'Remallado')
  expect(hoja('Reporte')).toEqual([{
    Fecha: '05/01/2026',
    Remalladora: 'Remalladora Prueba',
    Máquina: 'ANGE01',
    'Tipo de Media': 'TST-1',
    'Docenas Remalladas': 10,
    'Docenas Restantes': 0,
  }])
  expect(hoja('Resumen por persona')).toEqual([{ Persona: 'Remalladora Prueba', Registros: 1, 'Docenas Remalladas': 10 }])
})

test('Tejido en PDF: se descarga sin errores', async ({ page }) => {
  const errores: string[] = []
  page.on('pageerror', e => errores.push(e.message))
  await page.goto('/dashboard/reportes')
  await page.getByRole('button', { name: 'Tejido / Producción' }).click()
  const fechas = page.locator('input[type="date"]')
  await fechas.nth(0).fill('2026-01-01')
  await fechas.nth(1).fill('2026-01-31')
  await page.getByRole('button', { name: /PDF/ }).first().click()
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Descargar Reporte PDF/ }).click(),
  ])
  expect(descarga.suggestedFilename()).toBe('reporte_produccion_2026-01-01_2026-01-31.pdf')
  expect(errores).toEqual([])
})
