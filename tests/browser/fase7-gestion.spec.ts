/**
 * Fase 7 en el navegador (migración 036): editar un producto sin poder tocar SKU ni código,
 * registrar un egreso con comprobante (antes fallaba) y abrir y cerrar la caja por sus funciones.
 */
import { test, expect, type Page } from '@playwright/test'
import { iniciarSesionAdmin } from './sesion'

test.describe.configure({ mode: 'serial' })
test.beforeEach(async ({ context, baseURL }) => { await iniciarSesionAdmin(context, baseURL!) })

const mockDb = async (page: Page) => (await page.request.get('/api/mock-db')).json()

test('Catálogo: se edita el color; el SKU y el código quedan fijos y no se pueden escribir', async ({ page }) => {
  await page.goto('/dashboard/catalogo')
  const fila = page.getByRole('row').filter({ hasText: 'TST-2' }).first()
  await fila.getByTitle('Editar').click()
  await expect(page.getByLabel('SKU del producto')).toHaveAttribute('readonly', '')
  await expect(page.getByLabel('Código del producto')).toHaveAttribute('readonly', '')
  await expect(page.getByText('El SKU no se cambia')).toBeVisible()
  await page.getByPlaceholder('Ej. Con diseño / Negro').fill('Verde Fase 7')
  await page.getByRole('button', { name: /Guardar Producto/ }).click()
  await expect(page.getByText('Producto actualizado')).toBeVisible()
  const db = await mockDb(page)
  const p = db.catalogo_medias.find((c: { codigo: string }) => c.codigo === 'TST-2')
  expect(p).toMatchObject({ sku: 'SKU-TST-2', codigo: 'TST-2', diseno_color: 'Verde Fase 7' })
})

test('Egresos: un gasto con comprobante se registra (antes la base lo rechazaba)', async ({ page }) => {
  await page.goto('/dashboard/egresos')
  await page.getByRole('button', { name: /Registrar Egreso/ }).click()
  await page.getByPlaceholder(/Pago de planilla semanal/).fill('Luz de planta F7')
  await page.getByPlaceholder('Ej: 350.00').fill('120')
  await page.getByPlaceholder('https://ejemplo.com/factura.pdf').fill('https://ejemplo.com/luz.pdf')
  await page.getByRole('button', { name: /Registrar Gasto/ }).click()
  await expect(page.getByText(/Gasto operativo registrado/)).toBeVisible()
  const db = await mockDb(page)
  expect(db.egresos_adicionales.find((e: { concepto: string }) => e.concepto === 'Luz de planta F7'))
    .toMatchObject({ monto: 120, comprobante_url: 'https://ejemplo.com/luz.pdf' })
})

test('Caja: se abre y al cerrar con faltante pide justificación y guarda la diferencia calculada en la base', async ({ page }) => {
  await page.goto('/dashboard/ventas')
  await expect(page.getByRole('button', { name: /Abrir Caja/ })).toBeVisible()
  await page.getByRole('button', { name: /Abrir Caja/ }).click()
  const dialogo = page.getByRole('dialog')
  await page.waitForTimeout(500)
  await dialogo.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Vendedora Prueba', exact: true }).click()
  await expect(dialogo.getByRole('combobox').filter({ hasText: 'Vendedora Prueba' })).toBeVisible()
  await page.getByPlaceholder('0.00').first().fill('50')
  await page.getByRole('button', { name: /Abrir Caja/ }).last().click()
  await expect(page.getByText('Caja abierta exitosamente')).toBeVisible()
  await page.getByRole('button', { name: /Cerrar Caja/ }).click()
  await page.getByPlaceholder('0.00').last().fill('40')
  await page.getByRole('button', { name: /Confirmar Cierre/ }).click()
  await expect(page.getByText(/justificación para el faltante/)).toBeVisible()
  await page.getByPlaceholder(/motivo de la diferencia/).fill('Prueba de cierre')
  await page.getByRole('button', { name: /Confirmar Cierre/ }).click()
  await expect(page.getByText(/Caja cerrada faltante/)).toBeVisible()
  const db = await mockDb(page)
  const caja = db.cajas_diarias.at(-1)
  expect(caja).toMatchObject({ saldo_inicial: 50, saldo_declarado_efectivo: 40, estado: 'cerrada_faltante', justificacion: 'Prueba de cierre' })
  expect(caja.diferencia).toBe(Math.round((40 - caja.saldo_esperado_efectivo) * 100) / 100)
})

test('Sugerencias al escribir: productos, clientes y máquinas, sin importar tildes', async ({ page }) => {
  // Productos (Catálogo)
  await page.goto('/dashboard/catalogo')
  const buscaProducto = page.getByRole('combobox', { name: 'Buscar por SKU, código o modelo...' })
  await buscaProducto.fill('tst 2')
  const lista = page.getByRole('listbox', { name: 'Sugerencias' })
  await expect(lista.getByRole('option')).toHaveCount(1)
  await lista.getByRole('option', { name: /SKU-TST-2/ }).click()
  await expect(buscaProducto).toHaveValue('SKU-TST-2')

  // Productos en un selector de media (Planchado): elegir la sugerencia selecciona la media
  await page.goto('/dashboard/planchado')
  await page.getByLabel('Asignar a Planchador Prueba el lunes').click()
  const dialogo = page.getByRole('dialog')
  await dialogo.getByRole('combobox', { name: 'Filtrar: modelo, talla, color, SKU...' }).first().fill('sku-tst-2')
  await dialogo.getByRole('listbox', { name: 'Sugerencias' }).getByRole('option', { name: /SKU-TST-2/ }).click()
  await expect(dialogo.getByRole('combobox').filter({ hasText: /^TST-2/ }).first()).toBeVisible()

  // Clientes: sin tildes ni mayúsculas («nandu» encuentra «Ñandú Textil SAC»)
  await page.goto('/dashboard/clientes')
  const buscaCliente = page.getByRole('combobox', { name: /Buscar por nombre, DNI, RUC/ })
  await buscaCliente.fill('NANDU tex')
  await page.getByRole('listbox', { name: 'Sugerencias' }).getByRole('option', { name: /Ñandú Textil SAC/ }).click()
  await expect(buscaCliente).toHaveValue('Ñandú Textil SAC')

  const db = await mockDb(page)
  // Máquinas
  await page.goto('/dashboard/maquinas')
  const maquina = db.maquinas[0]
  const buscaMaquina = page.getByRole('combobox', { name: 'Buscar máquina o reporte...' })
  await buscaMaquina.fill(maquina.codigo.toLowerCase())
  await expect(page.getByRole('listbox', { name: 'Sugerencias' }).getByRole('option', { name: new RegExp(maquina.codigo) }).first()).toBeVisible()
})

test('Balance: una compra a plazos cuenta solo lo pagado (no su costo total)', async ({ page }) => {
  // Compras propias de esta prueba (se quitan al final: la base mock se comparte entre archivos)
  const base = await mockDb(page)
  const propias = {
    compras_materia_prima: [
      { id: 'f7c1', proveedor_id: 'prov1', materia_prima_id: 'mp1', cantidad_kg: 10, costo_total: 120, estado: 'recibida', fecha: '2026-11-02', condicion_pago: 'contado' },
      { id: 'f7c2', proveedor_id: 'prov1', materia_prima_id: 'mp1', cantidad_kg: 10, costo_total: 999, estado: 'devuelta', fecha: '2026-11-02', condicion_pago: 'contado' },
      { id: 'f7c3', proveedor_id: 'prov1', materia_prima_id: 'mp1', cantidad_kg: 30, costo_total: 300, estado: 'recibida', fecha: '2026-11-03', condicion_pago: 'pago_diferido' },
    ],
    cuotas_compras: [
      { id: 'f7q1', compra_id: 'f7c3', monto: 100, fecha_vencimiento: '2026-11-10', estado: 'pagada', fecha_pago: '2026-11-12' },
      { id: 'f7q2', compra_id: 'f7c3', monto: 100, fecha_vencimiento: '2026-12-10', estado: 'pendiente' },
      { id: 'f7q3', compra_id: 'f7c3', monto: 100, fecha_vencimiento: '2027-01-10', estado: 'pendiente' },
    ],
    pagos_proveedores: [{ id: 'f7p1', cuota_compra_id: 'f7q1', proveedor_id: 'prov1', monto: 100, metodo_pago: 'transferencia', fecha: '2026-11-12' }],
  }
  const conPropias = { ...base }
  for (const [t, filas] of Object.entries(propias)) conPropias[t] = [...(base[t] ?? []), ...filas]
  await page.request.post('/api/mock-db', { data: conPropias })
  const db = await mockDb(page)
  // Regla P1-A escrita aquí a mano (no se importa la del código): contado recibido + pagos de cuotas
  const compras = db.compras_materia_prima as { id: string; costo_total: number; estado: string; condicion_pago: string | null }[]
  const pagado = compras.filter(c => (c.condicion_pago ?? 'contado') === 'contado' && c.estado === 'recibida').reduce((t, c) => t + Number(c.costo_total), 0)
    + (db.pagos_proveedores as { monto: number }[]).reduce((t, p) => t + Number(p.monto), 0)
  const recibidoTotal = compras.filter(c => c.estado === 'recibida').reduce((t, c) => t + Number(c.costo_total), 0)
  expect(compras.some(c => c.id === 'f7c3')).toBe(true)
  expect(pagado).not.toBe(recibidoTotal)
  const soles = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  await page.goto('/dashboard/balance')
  const fila = page.getByRole('row').filter({ hasText: 'Compras Materia Prima' })
  await expect(fila).toContainText(soles(pagado))
  await expect(fila).not.toContainText(soles(recibidoTotal))

  await page.goto('/dashboard/egresos')
  await expect(page.getByText('Hilos: contado recibido y cuotas pagadas').locator('..')).toContainText(soles(pagado))

  const fin = await mockDb(page)
  for (const t of Object.keys(propias)) fin[t] = (fin[t] ?? []).filter((f: { id: string }) => !f.id.startsWith('f7'))
  await page.request.post('/api/mock-db', { data: fin })
})

test('Caja: con dos cajas abiertas, se ve la de la vendedora elegida (no la última abierta)', async ({ page }) => {
  const base = await mockDb(page)
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
  const propias = [
    { id: 'f7cajaA', asesora_id: 'vend1', fecha: hoy, saldo_inicial: 11, ventas_efectivo: 0, cobros_efectivo: 0, pagos_efectivo: 0, estado: 'abierta', created_at: '2026-01-01T08:00:00Z' },
    { id: 'f7cajaB', asesora_id: 'vend2', fecha: hoy, saldo_inicial: 22, ventas_efectivo: 0, cobros_efectivo: 0, pagos_efectivo: 0, estado: 'abierta', created_at: '2026-01-01T09:00:00Z' },
  ]
  // Sin otras cajas de hoy de estas vendedoras, para que se vea exactamente la de la prueba
  const otras = (base.cajas_diarias ?? []).filter((c: { fecha: string; asesora_id: string }) => !(c.fecha === hoy && ['vend1', 'vend2'].includes(c.asesora_id)))
  const vend2 = { id: 'vend2', nombre: 'Vendedora Dos', email: 'vend2@durey.com', rol: 'vendedora', activo: true, estado: 'disponible' }
  await page.request.post('/api/mock-db', { data: { ...base, usuarios: [...base.usuarios.filter((u: { id: string }) => u.id !== 'vend2'), vend2], cajas_diarias: [...otras, ...propias] } })

  await page.goto('/dashboard/ventas')
  await page.getByRole('button', { name: /Caja Diaria/ }).click()
  const elegirCaja = async (nombre: string) => {
    await page.getByLabel('Caja de la vendedora').getByRole('combobox').click()
    await page.getByRole('option', { name: `Caja de ${nombre}` }).click()
  }
  const esperado = page.getByText('Total Esperado en Caja').locator('..')
  await elegirCaja('Vendedora Prueba')
  await expect(esperado).toContainText('11.00')
  await elegirCaja('Vendedora Dos')
  await expect(esperado).toContainText('22.00')
  await expect(page.getByRole('button', { name: /Cerrar Caja/ })).toBeVisible()

  const fin = await mockDb(page)
  fin.cajas_diarias = (fin.cajas_diarias ?? []).filter((c: { id: string }) => !c.id.startsWith('f7caja')).concat(
    (base.cajas_diarias ?? []).filter((c: { fecha: string; asesora_id: string }) => c.fecha === hoy && ['vend1', 'vend2'].includes(c.asesora_id)))
  fin.usuarios = fin.usuarios.filter((u: { id: string }) => u.id !== 'vend2')
  await page.request.post('/api/mock-db', { data: fin })
})
