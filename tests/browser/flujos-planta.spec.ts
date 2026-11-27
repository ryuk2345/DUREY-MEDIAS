/**
 * Tests de navegador: recorren la app real (Next.js en modo mock) como lo haría
 * un usuario. A diferencia de tests/e2e (lógica sin interfaz), aquí fallan si la
 * pantalla no carga, un botón no responde o se muestran datos inventados.
 *
 * Ejecutar: npm run test:browser
 * Los pasos van en orden y comparten la base (sembrada en tests/browser/datos-prueba.json).
 */
import { test, expect, type Page } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context, baseURL }) => {
  await iniciarSesionAdmin(context, baseURL!)
})

/** Abre un CustomSelect (Radix) por su texto actual y elige una opción. */
async function elegir(page: Page, textoActual: string | RegExp, opcion: string) {
  await page.getByRole('combobox').filter({ hasText: textoActual }).click()
  await page.getByRole('option', { name: opcion }).click()
}

const DATOS_INVENTADOS = ['ROTURA DE AGUJA', 'PREVENTIVO EN CURSO', 'SIN HILO', 'Pedro Técnico', '987 654 321', 'EFICIENCIA: 98', '88.4%', '2h 15m']

test('Seguridad: sin sesión, las APIs de usuarios responden 401 y el dashboard manda al login', async ({ browser, baseURL }) => {
  const anonimo = await browser.newContext({ baseURL })
  const lista = await anonimo.request.get('/api/usuarios-lista?rol=admin&campos=*')
  expect(lista.status()).toBe(401)
  const clave = await anonimo.request.post('/api/auth/change-password', { data: { userId: 'cualquiera', nuevaPassword: 'hackeado123', esPrimerLogin: true } })
  expect(clave.status()).toBe(401)
  const page = await anonimo.newPage()
  await page.goto('/dashboard/usuarios')
  await expect(page).toHaveURL(/\/login/)
  await anonimo.close()
})

test('Máquinas: tarjetas con datos reales y reportar falla', async ({ page }) => {
  await page.goto('/dashboard/maquinas')
  await expect(page.getByText('SIN FALLAS')).toBeVisible()
  await expect(page.getByText('ANGE01, ANGE02')).toBeVisible()
  const texto = await page.locator('body').innerText()
  for (const inventado of DATOS_INVENTADOS) expect(texto).not.toContain(inventado)

  await page.getByPlaceholder(/Especifique el síntoma/).fill('Rotura de aguja en cilindro')
  await page.getByRole('button', { name: /ENVIAR REPORTE CRÍTICO/ }).click()
  await page.getByRole('button', { name: 'Sí, Marcar Avería' }).click()

  await expect(page.getByText(/Reporte crítico enviado para ANGE01/)).toBeVisible()
  await expect(page.getByText('FALLA MECÁNICA')).toBeVisible()
  await expect(page.getByText('ANGE01: Rotura de aguja en cilindro').first()).toBeVisible()
})

test('Tejido 24/6: la máquina malograda no registra; asignar producto y registrar el turno con operario; corregir', async ({ page }) => {
  await page.goto('/dashboard/produccion')
  const malograda = page.getByTestId('fila-tejido-ANGE01')
  await expect(malograda.getByText('Falla')).toBeVisible()
  await expect(malograda.getByText('No registra producción en este estado')).toBeVisible()
  const texto = await page.locator('body').innerText()
  for (const inventado of DATOS_INVENTADOS) expect(texto).not.toContain(inventado)

  // ANGE02 no tiene producto: se le asigna (queda fijo para todos los turnos)
  const fila = page.getByTestId('fila-tejido-ANGE02')
  await expect(fila.getByText('Asigna un producto para registrar')).toBeVisible()
  await fila.getByRole('button', { name: 'Asignar producto' }).click()
  await elegir(page, 'Elegir producto…', 'CRU-1')  // 5B: se teje en crudo
  await page.getByRole('button', { name: 'Guardar producto' }).click()
  await expect(page.getByText('Máquina ANGE02: ahora teje CRU-1')).toBeVisible()

  // Turno día de hoy: encargado y, en la fila, docenas y operario
  const hiloAntes = (await (await page.request.get('/api/mock-db')).json()).materia_prima.find((m: { id: string }) => m.id === 'mp1').stock_kg
  await page.getByLabel('Encargado del turno').selectOption({ label: 'Tejedor Prueba' })
  await fila.getByLabel('Docenas de ANGE02').fill('14.5')
  await fila.getByLabel('Operario de ANGE02').selectOption({ label: 'Tejedor Prueba' })
  await page.getByRole('button', { name: 'Guardar turno' }).click()
  await expect(page.getByText(/Turno día del .*: 1 máquina\(s\) registradas/)).toBeVisible()
  await expect(fila.getByText('14.5')).toBeVisible()
  let db = await (await page.request.get('/api/mock-db')).json()
  const rep = db.reportes_produccion.find((r: { maquina_id: string; operario_id?: string }) => r.maquina_id === 'm2' && r.operario_id)
  expect(rep).toMatchObject({ docenas_producidas: 14.5, operario_id: 'tej1', catalogo_media_id: 'cru1' })
  expect(db.materia_prima.find((m: { id: string }) => m.id === 'mp1').stock_kg).toBeCloseTo(hiloAntes - 14.5 * 0.4)

  // El administrador corrige el mismo día: 14,5 → 10 (el hilo se devuelve)
  await fila.getByRole('button', { name: 'Corregir' }).click()
  await page.getByLabel('Docenas', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Guardar corrección' }).click()
  await expect(page.getByText('Corrección guardada en ANGE02')).toBeVisible()
  db = await (await page.request.get('/api/mock-db')).json()
  expect(db.materia_prima.find((m: { id: string }) => m.id === 'mp1').stock_kg).toBeCloseTo(hiloAntes - 10 * 0.4)
})

test('Mantenimiento: entra el mecánico, usa un repuesto del stock y al cerrar el costo sale solo', async ({ page }) => {
  await page.goto('/dashboard/mantenimiento')
  // Sin mecánico no se inicia la reparación
  await page.getByRole('button', { name: /Iniciar Reparación/ }).first().click()
  await expect(page.getByText('Elige el mecánico que hace la reparación')).toBeVisible()

  await elegir(page, 'Mecánico que entra...', 'Mecánico Prueba')
  await page.getByRole('button', { name: /Iniciar Reparación/ }).first().click()
  await expect(page.getByText(/Reparación iniciada/)).toBeVisible()
  await expect(page.getByText('Mecánico: Mecánico Prueba')).toBeVisible()

  // Más de lo que hay: se rechaza y no descuenta
  await elegir(page, 'Elegir repuesto...', 'Aguja de prueba (5 en stock)')
  await page.getByLabel('Cantidad de repuesto').fill('9')
  await page.getByRole('button', { name: 'Usar' }).click()
  await expect(page.getByText('Solo hay 5 unidades de Aguja de prueba; no se pueden usar 9')).toBeVisible()

  // El repuesto sigue elegido: solo se corrige la cantidad
  await page.getByLabel('Cantidad de repuesto').fill('2')
  await page.getByRole('button', { name: 'Usar' }).click()
  await expect(page.getByText('Repuesto descontado del stock')).toBeVisible()
  await expect(page.getByText(/2 × Aguja de prueba/)).toBeVisible()

  await page.getByRole('button', { name: /Registrar Reparación/ }).first().click()
  const modal = page.getByRole('dialog')
  await modal.getByPlaceholder('Diagnóstico del técnico...').fill('Cambio de aguja y ajuste')
  await expect(modal.getByLabel('Costo de repuestos usados')).toHaveText('S/ 20.00')
  await modal.locator('input[type="number"]').fill('30')
  await expect(modal.getByText('S/ 50.00')).toBeVisible()
  await modal.getByRole('button', { name: /Marcar como Resuelto/ }).click()
  await expect(page.getByText(/Reparación registrada/)).toBeVisible()

  await page.goto('/dashboard/maquinas')
  await expect(page.getByText('SIN FALLAS')).toBeVisible()
})

test('Cerrar sesión deja al usuario fuera del dashboard', async ({ page }) => {
  await page.goto('/dashboard/maquinas')
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/dashboard/maquinas')
  await expect(page).toHaveURL(/\/login/)
})
