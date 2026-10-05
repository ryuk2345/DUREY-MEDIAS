/**
 * Operaciones atómicas de Ventas, Despacho, Almacén, Remallado y Planchado (migración 022).
 *
 * Ejecuta la emulación local real (lib/supabase/mockRpcProcesos.ts). Las mismas
 * reglas se prueban contra Postgres en
 * supabase/tests/022_rpc_ventas_despacho_almacen_procesos.test.sql.
 *
 * El test FALLA si:
 *   - Un error deja datos a medias (venta sin productos, paquetes entregados sin guía,
 *     traspaso que resta docenas sin crear el lote destino, reportes sin descontar stock)
 *   - Se despacha o se plancha más de lo que hay en stock
 *   - Dos ventas reciben el mismo código
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ejecutarRpcProcesos } from '@/lib/supabase/mockRpcProcesos'
import type { Db } from '@/lib/supabase/mockRpcComun'

let db: Db

function rpc(fn: string, params: Record<string, unknown>) {
  return ejecutarRpcProcesos(db, fn, params)!
}

const cliente = { nombre: 'Cliente Uno', numero_documento: '11111111', tipo_documento: 'dni' }
const venta = (extra: Record<string, unknown> = {}) => rpc('registrar_venta', {
  p_cliente: cliente,
  p_asesora_id: 'vend1',
  p_tipo_pago: 'directo',
  p_monto_adelanto: 0,
  p_items: [{ catalogo_media_id: 'A', docenas: 5, precio_docena: 40 }],
  p_cuotas: null,
  ...extra,
})

beforeEach(() => {
  db = {
    usuarios: [
      { id: 'rem1', rol: 'remalladora', estado: 'disponible' },
      { id: 'rem2', rol: 'remalladora', estado: 'disponible' },
    ],
    catalogo_medias: [{ id: 'A', codigo: 'MED-A' }, { id: 'B', codigo: 'MED-B' }],
    ubicaciones: [{ id: 'sal1', nombre: 'Salón A' }],
    maquinas: [
      { id: 'r1', codigo: 'R01', estado: 'activa' },
      { id: 'r2', codigo: 'R02', estado: 'activa' },
      { id: 'r3', codigo: 'R03', estado: 'malograda' },
    ],
    clientes: [], ventas: [], items_venta: [], cuotas: [], paquetes: [], guias_remision: [],
    movimientos_stock: [], lotes_remallado: [], stock_listo_planchar: [], reportes_planchado: [],
  }
})

describe('registrar_venta', () => {
  it('crea cliente, venta, productos y cuotas con el total calculado', () => {
    const r = venta({
      p_tipo_pago: 'cuotas', p_monto_adelanto: 20,
      p_items: [{ catalogo_media_id: 'A', docenas: 3, precio_docena: 40 }, { catalogo_media_id: 'B', docenas: 2, precio_docena: 50 }],
      p_cuotas: [{ numero_cuota: 1, monto: 100, fecha_vencimiento: '2026-11-01' }, { numero_cuota: 2, monto: 100, fecha_vencimiento: '2026-12-01' }],
    })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ codigo_venta: 'V-1001', total_soles: 220 })
    expect(db.items_venta).toHaveLength(2)
    expect(db.cuotas).toHaveLength(2)
  })

  it('[NEGOCIO] un error no deja cliente ni venta a medias', () => {
    const antes = structuredClone(db)
    expect(venta({ p_tipo_pago: 'cuotas', p_cuotas: [] }).error?.message).toContain('cronograma')
    expect(venta({ p_items: [{ catalogo_media_id: 'A', docenas: 0, precio_docena: 10 }] }).error?.message).toContain('docenas mayores a 0')
    expect(venta({ p_monto_adelanto: 999 }).error?.message).toContain('adelanto')
    expect(db).toEqual(antes)
  })

  it('reutiliza el cliente por documento y da códigos correlativos', () => {
    venta()
    const r2 = venta({ p_cliente: { ...cliente, nombre: 'Cliente Uno SAC' } })
    expect(db.clientes).toHaveLength(1)
    expect(db.clientes[0].nombre).toBe('Cliente Uno SAC')
    expect((r2.data as { codigo_venta: string }).codigo_venta).toBe('V-1002')
  })
})

describe('almacenar_paquete y despachar_venta', () => {
  it('almacena paquetes con su kárdex y despacha entregando los más antiguos', () => {
    rpc('almacenar_paquete', { p_ubicacion_id: 'sal1', p_codigo_paquete: 'P1', p_catalogo_media_id: 'A', p_docenas: 4, p_tipo_movimiento: 'ingreso_directo' })
    rpc('almacenar_paquete', { p_ubicacion_id: 'sal1', p_codigo_paquete: 'P2', p_catalogo_media_id: 'A', p_docenas: 1, p_tipo_movimiento: 'ingreso_directo' })
    expect(db.movimientos_stock).toHaveLength(2)

    const ventaId = (venta().data as { venta_id: string }).venta_id
    const r = rpc('despachar_venta', { p_venta_id: ventaId, p_agencia: 'Shalom', p_lineas: [{ catalogo_media_id: 'A', docenas: 5 }] })
    expect(r.error).toBeNull()
    expect(r.data).toBe('GR-9001')
    expect(db.paquetes.every(x => x.estado === 'entregado' && x.venta_id === ventaId && x.ubicacion_id === null)).toBe(true)
    expect(db.ventas[0].estado).toBe('entregado')
    expect(db.movimientos_stock.filter(m => m.tipo === 'salida_venta')).toHaveLength(1)
    expect(rpc('despachar_venta', { p_venta_id: ventaId, p_agencia: 'Shalom', p_lineas: [{ catalogo_media_id: 'A', docenas: 1 }] }).error?.message)
      .toContain('ya fue despachada')
  })

  it('[NEGOCIO] sin stock suficiente no entrega nada ni crea guía', () => {
    rpc('almacenar_paquete', { p_ubicacion_id: 'sal1', p_codigo_paquete: 'P1', p_catalogo_media_id: 'A', p_docenas: 4 })
    const ventaId = (venta().data as { venta_id: string }).venta_id
    const antes = structuredClone(db)
    expect(rpc('despachar_venta', { p_venta_id: ventaId, p_agencia: 'Shalom', p_lineas: [{ catalogo_media_id: 'A', docenas: 5 }] }).error?.message)
      .toContain('Stock insuficiente')
    expect(db).toEqual(antes)
  })

  it('[NEGOCIO] no almacena un paquete ya entregado ni sin salón', () => {
    db.paquetes.push({ id: 'e1', codigo_paquete: 'ENT', estado: 'entregado', docenas: 1 })
    expect(rpc('almacenar_paquete', { p_paquete_id: 'e1', p_ubicacion_id: 'sal1' }).error?.message).toContain('no se puede almacenar')
    expect(rpc('almacenar_paquete', { p_codigo_paquete: 'X', p_docenas: 1 }).error?.message).toContain('salón de destino')
  })
})

describe('remallado', () => {
  it('inicia un lote y traspasa docenas a otra operadora y máquina', () => {
    const loteId = rpc('iniciar_lote_remallado', { p_maquina_id: 'r1', p_remalladora_id: 'rem1', p_catalogo_media_id: 'A', p_docenas: 75 }).data
    expect(db.maquinas[0].estado).toBe('ocupada')
    expect(db.usuarios[0].estado).toBe('ocupada')

    const r = rpc('traspasar_lote_remallado', { p_lote_origen_id: loteId, p_remalladora_destino_id: 'rem2', p_maquina_destino_id: 'r2', p_docenas: 25 })
    expect(r.error).toBeNull()
    expect(db.lotes_remallado.map(l => l.docenas_pendientes)).toEqual([50, 25])
    expect(db.maquinas[1].estado).toBe('ocupada')
  })

  it('[NEGOCIO] un traspaso inválido no resta docenas al origen (antes sí)', () => {
    const loteId = rpc('iniciar_lote_remallado', { p_maquina_id: 'r1', p_remalladora_id: 'rem1', p_catalogo_media_id: 'A', p_docenas: 75 }).data
    expect(rpc('traspasar_lote_remallado', { p_lote_origen_id: loteId, p_remalladora_destino_id: 'rem2', p_maquina_destino_id: 'r3', p_docenas: 10 }).error?.message)
      .toContain('no está disponible')
    expect(rpc('traspasar_lote_remallado', { p_lote_origen_id: loteId, p_remalladora_destino_id: 'rem2', p_maquina_destino_id: 'r2', p_docenas: 80 }).error?.message)
      .toContain('excede')
    expect(db.lotes_remallado).toHaveLength(1)
    expect(db.lotes_remallado[0].docenas_pendientes).toBe(75)
  })

  it('[NEGOCIO] no inicia un lote en una máquina ocupada o malograda', () => {
    expect(rpc('iniciar_lote_remallado', { p_maquina_id: 'r3', p_remalladora_id: 'rem1', p_catalogo_media_id: 'A', p_docenas: 10 }).error?.message)
      .toContain('no está disponible')
  })
})

describe('registrar_produccion_planchado', () => {
  it('registra reportes y descuenta planchadas + defectuosas del stock', () => {
    db.stock_listo_planchar.push({ id: 's1', catalogo_media_id: 'A', docenas: 10 })
    const r = rpc('registrar_produccion_planchado', { p_items: [{ planchador_id: 'pl1', catalogo_media_id: 'A', docenas_planchadas: 7, docenas_defectuosas: 1 }] })
    expect(r.error).toBeNull()
    expect(db.stock_listo_planchar[0].docenas).toBe(2)
    expect(db.reportes_planchado).toHaveLength(1)
  })

  it('[NEGOCIO] no permite registrar más de lo que hay en stock (antes lo dejaba en 0 sin avisar)', () => {
    db.stock_listo_planchar.push({ id: 's1', catalogo_media_id: 'A', docenas: 10 })
    const antes = structuredClone(db)
    expect(rpc('registrar_produccion_planchado', { p_items: [{ catalogo_media_id: 'A', docenas_planchadas: 9, docenas_defectuosas: 2 }] }).error?.message)
      .toContain('No hay suficiente stock listo para planchar de MED-A')
    expect(db).toEqual(antes)
  })
})

describe('cobros reales y caja diaria (migración 023)', () => {
  const hoy = new Date().toISOString().split('T')[0]

  beforeEach(() => {
    db.cobros = []
    db.cajas_diarias = [{ id: 'caja1', asesora_id: 'vend1', fecha: hoy, estado: 'abierta', saldo_inicial: 100, ventas_efectivo: 0, ventas_digital: 0, cobros_efectivo: 0, cobros_digital: 0 }]
  })

  it('una venta al contado registra el cobro del total y lo suma a la caja', () => {
    const r = venta({ p_metodo_pago: 'efectivo' })
    expect(r.data).toMatchObject({ monto_cobrado: 200 })
    expect(db.cobros).toHaveLength(1)
    expect(db.cobros[0]).toMatchObject({ monto: 200, estado_validacion: 'validado', metodo_pago: 'efectivo' })
    expect(db.cajas_diarias[0].ventas_efectivo).toBe(200)
  })

  it('una venta a cuotas cobra solo el adelanto; cada cuota se cobra una sola vez', () => {
    const r = venta({
      p_tipo_pago: 'cuotas', p_monto_adelanto: 50, p_metodo_pago: 'yape',
      p_cuotas: [{ numero_cuota: 1, monto: 150, fecha_vencimiento: '2026-11-01' }],
    })
    expect(r.data).toMatchObject({ monto_cobrado: 50 })
    expect(db.cajas_diarias[0].ventas_digital).toBe(50)

    const cuotaId = db.cuotas[0].id
    expect(rpc('registrar_cobro_cuotas', { p_cuota_ids: [cuotaId], p_metodo_pago: 'efectivo', p_asesora_id: 'vend1' }).data).toBe(150)
    expect(db.cuotas[0].estado).toBe('pagada')
    expect(db.cajas_diarias[0].cobros_efectivo).toBe(150)
    expect(db.cobros).toHaveLength(2)

    expect(rpc('registrar_cobro_cuotas', { p_cuota_ids: [cuotaId], p_metodo_pago: 'efectivo' }).error?.message).toContain('ya está pagada')
    expect(db.cobros).toHaveLength(2)
  })

  it('[NEGOCIO] rechaza un método de pago inválido sin guardar nada', () => {
    const antes = structuredClone(db)
    expect(venta({ p_metodo_pago: 'bitcoin' }).error?.message).toContain('Método de pago')
    expect(db).toEqual(antes)
  })
})
