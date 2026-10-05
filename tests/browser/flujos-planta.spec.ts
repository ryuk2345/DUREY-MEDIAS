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

test('Producción: la máquina malograda no se puede cargar; cargar lote y registrar producción', async ({ page }) => {
  await page.goto('/dashboard/produccion')
  const tarjetaMalograda = page.locator('div.glass').filter({ has: page.getByRole('heading', { name: 'ANGE01' }) })
  await expect(tarjetaMalograda.getByText('FALLA')).toBeVisible()
  await expect(tarjetaMalograda.getByText('No disponible para cargar')).toBeVisible()
  const texto = await page.locator('body').innerText()
  for (const inventado of DATOS_INVENTADOS) expect(texto).not.toContain(inventado)

  await elegir(page, 'Seleccionar marca de máquina', 'ANGE')
  await elegir(page, 'Seleccionar tejedor', 'Tejedor Prueba')
  await page.getByText('ANGE02', { exact: true }).last().click()
  await page.getByRole('button', { name: 'Validar y Cargar Lote' }).click()
  await expect(page.getByText(/Lote cargado/)).toBeVisible()
  await expect(page.getByText('1 En Marcha')).toBeVisible()

  await page.getByRole('button', { name: /Registrar Producción/ }).first().click()
  await page.locator('input[type="number"]').first().fill('14.5')
  await page.getByRole('button', { name: /Guardar|Registrar|Confirmar/ }).last().click()
  await expect(page.getByText(/Producción registrada/)).toBeVisible()
  await expect(page.getByText('0 En Marcha')).toBeVisible()
})

test('Mantenimiento: iniciar reparación y marcar como resuelta deja la máquina activa', async ({ page }) => {
  await page.goto('/dashboard/mantenimiento')
  await page.getByRole('button', { name: /Iniciar Reparación/ }).first().click()
  await expect(page.getByText(/Reparación iniciada/)).toBeVisible()

  await page.getByRole('button', { name: /Registrar Reparación/ }).first().click()
  await page.getByPlaceholder('Diagnóstico del técnico...').fill('Cambio de aguja y ajuste')
  const costos = page.locator('input[type="number"]')
  await costos.nth(0).fill('30')
  await costos.nth(1).fill('20')
  await page.getByRole('button', { name: /Marcar como Resuelto/ }).click()
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
