/**
 * Abre cada módulo del dashboard como admin y falla si la página lanza un error
 * o muestra alguno de los datos inventados que se eliminaron en la auditoría.
 */
import { test, expect } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'
import { MODULOS_POR_ROL } from '../../lib/utils'

const INVENTADOS = [
  'ROTURA DE AGUJA', 'PREVENTIVO EN CURSO', 'SIN HILO', 'EFICIENCIA: 98', 'Pedro Técnico', '987 654 321',
  '88.4%', '91.2%', '+2.4%', '+1.8%', '+12% vs mes anterior', '2h 15m',
  'Sofia Vendedora', 'Lucia Preparadora', 'Empacador de Turno', 'Ana Remalladora',
  'S/ 18,500', 'S/ 1,250', 'tobillera-dama-diseño-única',
]

const RUTAS: Record<string, string> = { materia_prima: 'materia-prima' }

for (const modulo of MODULOS_POR_ROL.admin) {
  const ruta = `/dashboard/${RUTAS[modulo] ?? modulo}`
  test(`${ruta} carga sin errores ni datos inventados`, async ({ page, context, baseURL }) => {
    await iniciarSesionAdmin(context, baseURL!)
    const errores: string[] = []
    page.on('pageerror', e => errores.push(e.message))
    await page.goto(ruta)
    await expect(page.locator('main')).toBeVisible()
    await page.waitForTimeout(1500)
    const texto = await page.locator('body').innerText()
    for (const inventado of INVENTADOS) expect(texto, `"${inventado}" en ${ruta}`).not.toContain(inventado)
    expect(errores, `errores de página en ${ruta}`).toEqual([])
  })
}
