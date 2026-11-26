/**
 * Fase 4 — Mantenimiento preventivo e historia clínica, en el navegador (modo mock).
 * Sembrado: plan "Lubricar cilindro" de ANGE02 (m2) cada 15 días desde el 01/01/2026 (vencido).
 * Corre después de flujos-planta (ANGE02 queda activa, "Aguja de prueba" con stock).
 */
import { test, expect, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })
test.use({ timezoneId: 'America/Lima' })

test.beforeEach(async ({ context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
})

async function elegir(page: Page, textoActual: string | RegExp, opcion: string | RegExp) {
  await page.getByRole('combobox').filter({ hasText: textoActual }).first().click()
  await page.getByRole('option', { name: opcion }).click()
}

async function abrirPreventivo(page: Page) {
  await page.goto('/dashboard/mantenimiento')
  await page.getByRole('button', { name: /Preventivo/ }).click()
}

test('Máquinas avisa del preventivo vencido', async ({ page }) => {
  await page.goto('/dashboard/maquinas')
  const aviso = page.getByTestId('aviso-preventivo-vencido')
  await expect(aviso).toBeVisible()
  await expect(aviso.getByText('ANGE02')).toBeVisible()
})

test('Preventivo: iniciar con mecánico, usar un repuesto y terminar con mano de obra', async ({ page }) => {
  await abrirPreventivo(page)
  const plan = page.getByTestId('plan-Lubricar cilindro')
  await expect(plan.getByText('Vencido')).toBeVisible()

  // Sin mecánico no se inicia
  await plan.getByRole('button', { name: /Iniciar mantenimiento/ }).click()
  await expect(page.getByText('Elige el mecánico que hace el mantenimiento')).toBeVisible()

  await plan.getByRole('combobox').filter({ hasText: 'Mecánico...' }).click()
  await page.getByRole('option', { name: 'Mecánico Prueba' }).click()
  await plan.getByRole('button', { name: /Iniciar mantenimiento/ }).click()
  await expect(page.getByText(/Mantenimiento iniciado/)).toBeVisible()
  await expect(plan.getByText(/En curso · Mecánico: Mecánico Prueba/)).toBeVisible()

  await plan.getByRole('combobox').filter({ hasText: 'Elegir repuesto...' }).click()
  await page.getByRole('option', { name: /Aguja de prueba/ }).click()
  await plan.getByLabel('Cantidad de repuesto del mantenimiento').fill('1')
  await plan.getByRole('button', { name: 'Usar' }).click()
  await expect(page.getByText('Repuesto descontado del stock')).toBeVisible()
  await expect(plan.getByText(/1 × Aguja de prueba/)).toBeVisible()

  await plan.getByRole('button', { name: /Terminar mantenimiento/ }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Nota (qué se hizo)').fill('Lubricado y ajustado')
  await modal.getByLabel('Mano de obra (S/)').fill('40')
  await modal.getByRole('button', { name: 'Terminar' }).click()
  await expect(page.getByText(/Mantenimiento terminado/)).toBeVisible()
  await expect(plan.getByText('Al día')).toBeVisible()
})

test('Preventivo: crear un plan nuevo', async ({ page }) => {
  await abrirPreventivo(page)
  await page.getByRole('button', { name: /Nuevo plan/ }).click()
  await elegir(page, 'Elegir máquina...', 'ANGE01')
  await page.getByLabel('Tarea').fill('Limpieza general')
  await page.getByLabel('Cada cuántos días').fill('30')
  await page.getByRole('button', { name: 'Guardar plan' }).click()
  await expect(page.getByText('Plan de mantenimiento creado')).toBeVisible()
  await expect(page.getByTestId('plan-Limpieza general').getByText('Al día')).toBeVisible()
})

test('Historia clínica: eventos, por semana, y descarga en Excel y PDF', async ({ page }) => {
  await page.goto('/dashboard/maquinas/m2/historia')
  await expect(page.getByRole('heading', { name: /Historia clínica/ })).toContainText('ANGE02')
  await expect(page.getByText('Mantenimiento preventivo').first()).toBeVisible()
  await expect(page.getByText(/Lubricar cilindro — Lubricado y ajustado/)).toBeVisible()
  await expect(page.getByText('Repuesto usado').first()).toBeVisible()

  await page.getByRole('button', { name: 'Por semana' }).click()
  await expect(page.getByRole('button', { name: 'Por semana' })).toHaveAttribute('aria-pressed', 'true')

  const [excel] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descargar Excel/ }).click()])
  const libro = XLSX.read(readFileSync((await excel.path())!))
  expect(libro.SheetNames).toEqual(['Historia', 'Totales'])
  const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets.Historia)
  expect(filas.some(f => f.Evento === 'Mantenimiento preventivo' && f['Costo (S/)'] === 40 && f['Mecánico'] === 'Mecánico Prueba')).toBe(true)
  expect(filas.some(f => f.Evento === 'Repuesto usado' && f.Detalle === 'Aguja de prueba')).toBe(true)

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Imprimir PDF/ }).click()])
  expect(pdf.suggestedFilename()).toMatch(/^historia_ANGE02_.*\.pdf$/)
})
