/**
 * Fase 5A (migración 032): stock de fuera, varios SKU por persona y día,
 * planchado → por preparar → saco. Spec: 02-DOCS/wiki/sdd/specs/fase-5-flujo-produccion.md
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

test('Planchado: stock de fuera entra por planchar, sin egreso, con origen y quién', async ({ page }) => {
  await page.goto('/dashboard/planchado')
  await page.getByRole('button', { name: 'Ingresar stock de fuera' }).click()
  await elegir(page, 'Elegir producto…', 'TST-1')
  await page.getByLabel('Docenas').fill('10')
  await page.getByLabel('De dónde vienen').fill('Producción antes del sistema')
  await page.getByRole('button', { name: 'Guardar ingreso' }).click()
  await expect(page.getByText('Stock de fuera ingresado: 10 docenas de TST-1 por planchar')).toBeVisible()
  const db = await mockDb(page)
  expect(docenasDe(db.stock_listo_planchar, 'media1')).toBe(10)
  expect(db.ingresos_stock_fuera).toEqual([expect.objectContaining({ etapa: 'planchado', docenas: 10, origen: 'Producción antes del sistema' })])
  expect(db.ingresos_stock_fuera[0].registrado_por).toBe('65a2de1b-03f2-4b95-82c2-cc2e3ffc30bb')
  expect(db.egresos_adicionales ?? []).toHaveLength(0)
})

test('Planchado: asignar dos SKU de una vez a un planchador el lunes', async ({ page }) => {
  await page.goto('/dashboard/planchado')
  await page.getByLabel('Asignar a Planchador Prueba el lunes').click()
  await elegir(page, 'Seleccionar media...', 'TST-1')
  await page.getByRole('button', { name: 'Añadir otro SKU' }).click()
  await elegir(page, 'Seleccionar media...', 'TST-2')
  await page.getByRole('button', { name: 'Guardar Asignación' }).click()
  await expect(page.getByText('2 SKU asignados en el cronograma')).toBeVisible()
  const db = await mockDb(page)
  const delLunes = db.cronograma_planchado.filter((c: { planchador_id: string; dia_semana: string }) => c.planchador_id === 'plan1' && c.dia_semana === 'lunes')
  expect(delLunes.map((c: { valor_criterio: string }) => c.valor_criterio).sort()).toEqual(['TST-1', 'TST-2'])
})

test('Planchado → por preparar → Preparado crea el saco y descuenta', async ({ page }) => {
  // Planchar 7 buenas + 1 defectuosa de TST-1 (SKU añadido a mano en la tarjeta del planchador)
  await page.goto('/dashboard/planchado')
  const tarjeta = page.locator('div.glass').filter({ hasText: 'Planchador Prueba' }).filter({ has: page.getByText('Criterio / Media Asignada:') })
  await tarjeta.getByRole('combobox').filter({ hasText: '+ Añadir/Seleccionar media del catálogo...' }).click()
  await page.getByRole('option', { name: 'TST-1', exact: true }).click()
  const bloque = tarjeta.locator('div').filter({ has: page.getByText('TST-1', { exact: true }) }).filter({ has: page.locator('input[type="number"]') }).last()
  await bloque.locator('input[type="number"]').nth(0).fill('7')
  await bloque.locator('input[type="number"]').nth(1).fill('1')
  await page.getByRole('button', { name: /Guardar Registro Diario/ }).click()
  await expect(page.getByText(/guardada exitosamente/)).toBeVisible()
  let db = await mockDb(page)
  expect(docenasDe(db.stock_listo_planchar, 'media1')).toBe(2)
  expect(docenasDe(db.stock_listo_preparar, 'media1')).toBe(7)

  // Preparado: el lunes, Preparador Prueba con TST-1; prepara 6 + 1 defectuosa
  await page.goto('/dashboard/preparado')
  await page.getByLabel('Asignar a Preparador Prueba el lunes').click()
  await elegir(page, 'Seleccionar media...', 'TST-1')
  await page.getByRole('button', { name: 'Guardar Asignación' }).click()
  await expect(page.getByText('Nueva asignación agregada al cronograma')).toBeVisible()
  await page.getByRole('group', { name: 'Día' }).getByRole('button', { name: 'lunes' }).click()
  const fila = page.getByTestId('planilla-preparado-Preparador Prueba')
  await expect(fila.getByText('7 doc.')).toBeVisible()
  await fila.getByLabel('Preparadas de TST-1 por Preparador Prueba').fill('6')
  await fila.getByLabel('Defectuosas de TST-1 por Preparador Prueba').fill('1')
  await fila.getByRole('button', { name: 'Embolsar TST-1 de Preparador Prueba' }).click()
  await expect(page.getByText('Saco Maestro de Empaque')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar y Bajar a Almacén' }).click()
  await expect(page.getByText(/Saco .* registrado con 72 pares\. Listo para bajar a Salón A\./)).toBeVisible()

  db = await mockDb(page)
  expect(docenasDe(db.stock_listo_preparar, 'media1')).toBe(0)
  const saco = db.paquetes.find((p: { preparador_id?: string; docenas: number }) => p.preparador_id === 'prep1' && p.docenas === 6)
  expect(saco).toMatchObject({ estado: 'pendiente_almacenar', ubicacion_id: 'sal1', total_pares: 72 })
  expect(saco.detalles_contenido).toEqual([expect.objectContaining({ codigo: 'TST-1', docenas: 6, pares: 72 })])
  expect(db.reportes_preparado).toEqual([expect.objectContaining({ preparador_id: 'prep1', docenas_preparadas: 6, docenas_defectuosas: 1, paquete_id: saco.id })])
})
