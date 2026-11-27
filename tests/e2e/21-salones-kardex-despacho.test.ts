/**
 * Fase 6A — un SKU por saco, kardex de salones, traslados y despacho eligiendo sacos.
 * Spec: 02-DOCS/wiki/sdd/specs/fase-6-almacen-ventas-despacho.md · SQL: migración 034.
 */
import { describe, it, expect } from 'vitest'
import { compararDespacho, sacosFueraDelPedido, puedeDespachar, signoMovimiento, kardexConSaldo } from '@/lib/domain/despacho'
import { ejecutarRpcAlmacen } from '@/lib/supabase/mockRpcAlmacen'
import { ejecutarRpcProcesos } from '@/lib/supabase/mockRpcProcesos'
import { ejecutarRpcLogistica } from '@/lib/supabase/mockRpcLogistica'

type Db = Record<string, any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = (db: Db, fn: string, p: Record<string, unknown>) =>
  (ejecutarRpcAlmacen(db, fn, p) ?? ejecutarRpcProcesos(db, fn, p) ?? ejecutarRpcLogistica(db, fn, p))!

describe('compararDespacho (lib/domain/despacho)', () => {
  const pedido = [{ catalogo_media_id: 'A', docenas: 10 }, { catalogo_media_id: 'B', docenas: 3 }]
  it('falta y sobra por SKU', () => {
    expect(compararDespacho(pedido, [{ id: '1', catalogo_media_id: 'A', docenas: 6 }])).toEqual([
      { catalogo_media_id: 'A', pedidas: 10, elegidas: 6, falta: 4, sobra: 0 },
      { catalogo_media_id: 'B', pedidas: 3, elegidas: 0, falta: 3, sobra: 0 },
    ])
    const ok = [{ id: '1', catalogo_media_id: 'A', docenas: 6 }, { id: '2', catalogo_media_id: 'A', docenas: 6 }, { id: '3', catalogo_media_id: 'B', docenas: 4 }]
    expect(compararDespacho(pedido, ok).map(c => c.sobra)).toEqual([2, 1])
    expect(puedeDespachar(pedido, ok)).toBe(true)
  })
  it('no se puede con faltante, sin sacos o con un saco de otro SKU', () => {
    expect(puedeDespachar(pedido, [{ id: '1', catalogo_media_id: 'A', docenas: 10 }])).toBe(false)
    expect(puedeDespachar(pedido, [])).toBe(false)
    const conOtro = [{ id: '1', catalogo_media_id: 'A', docenas: 10 }, { id: '2', catalogo_media_id: 'B', docenas: 3 }, { id: '3', catalogo_media_id: 'C', docenas: 1 }]
    expect(sacosFueraDelPedido(pedido, conOtro).map(s => s.id)).toEqual(['3'])
    expect(puedeDespachar(pedido, conOtro)).toBe(false)
  })
  it('suma líneas repetidas del mismo SKU', () => {
    expect(compararDespacho([{ catalogo_media_id: 'A', docenas: 2 }, { catalogo_media_id: 'A', docenas: 3 }], [])[0].pedidas).toBe(5)
  })
})

describe('kardex (lib/domain/despacho)', () => {
  it('signos y saldo por salón en orden de fecha', () => {
    expect(['ingreso_salon', 'ingreso_directo', 'traslado_entrada', 'traslado_salida', 'salida_venta', 'otro'].map(signoMovimiento)).toEqual([1, 1, 1, -1, -1, 0])
    const movs = [
      { tipo: 'salida_venta', docenas: 4, ubicacion_id: 's1', created_at: '2026-01-03' },
      { tipo: 'ingreso_salon', docenas: 6, ubicacion_id: 's1', created_at: '2026-01-01' },
      { tipo: 'traslado_entrada', docenas: 3, ubicacion_id: 's1', created_at: '2026-01-02' },
      { tipo: 'ingreso_salon', docenas: 9, ubicacion_id: 's2', created_at: '2026-01-01' },
      { tipo: 'salida_venta', docenas: 2, ubicacion_id: null, created_at: '2026-01-04' },
    ]
    expect(kardexConSaldo(movs, 's1').map(m => m.saldo)).toEqual([6, 9, 5])
  })
})

const ALM = 'u-alm', VEND = 'u-vend', PLAN = 'u-plan'
function base(): Db {
  return {
    usuarios: [
      { id: ALM, nombre: 'Almacén', rol: 'almacenero', activo: true },
      { id: VEND, nombre: 'Vende', rol: 'vendedora', activo: true },
      { id: PLAN, nombre: 'Plancha', rol: 'planchador', activo: true },
    ],
    catalogo_medias: [{ id: 'A', codigo: 'T-A' }, { id: 'B', codigo: 'T-B' }, { id: 'C', codigo: 'T-C' }],
    ubicaciones: [{ id: 's1', nombre: 'Salón 1', activo: true }, { id: 's2', nombre: 'Salón 2', activo: true }, { id: 's3', nombre: 'Baja', activo: false }],
    paquetes: [
      { id: 'a1', codigo_paquete: 'S-A1', catalogo_media_id: 'A', docenas: 6, estado: 'almacenado', ubicacion_id: 's1' },
      { id: 'a2', codigo_paquete: 'S-A2', catalogo_media_id: 'A', docenas: 6, estado: 'almacenado', ubicacion_id: 's2' },
      { id: 'b1', codigo_paquete: 'S-B1', catalogo_media_id: 'B', docenas: 4, estado: 'almacenado', ubicacion_id: 's1' },
      { id: 'c1', codigo_paquete: 'S-C1', catalogo_media_id: 'C', docenas: 6, estado: 'almacenado', ubicacion_id: 's1' },
      { id: 'p1', codigo_paquete: 'S-P1', catalogo_media_id: 'A', docenas: 2, estado: 'pendiente_almacenar', ubicacion_id: null },
    ],
    ventas: [{ id: 'v1', codigo_venta: 'V-1', estado: 'pendiente' }],
    items_venta: [{ venta_id: 'v1', catalogo_media_id: 'A', docenas: 10 }, { venta_id: 'v1', catalogo_media_id: 'B', docenas: 3 }],
    movimientos_stock: [], guias_remision: [], despacho_detalle: [], agencias: [],
  }
}

describe('mock: bloqueo por rol de almacén, despacho y ventas', () => {
  it('sin el módulo, rechazado', () => {
    const db = base()
    expect(rpc(db, 'trasladar_saco', { __uid: VEND, p_paquete_id: 'a1', p_ubicacion_destino_id: 's2' }).error?.message).toBe('Tu rol no tiene acceso al módulo almacen')
    expect(rpc(db, 'despachar_venta_sacos', { __uid: PLAN, p_venta_id: 'v1', p_agencia: 'X', p_sacos: ['a1'] }).error?.message).toBe('Tu rol no tiene acceso al módulo despacho')
    expect(rpc(db, 'registrar_agencia', { __uid: PLAN, p_nombre: 'X' }).error?.message).toBe('Tu rol no tiene acceso al módulo despacho')
    expect(rpc(db, 'crear_ubicacion', { __uid: VEND, p_nombre: 'X' }).error?.message).toBe('Tu rol no tiene acceso al módulo almacen')
    expect(rpc(db, 'registrar_venta', { __uid: PLAN }).error?.message).toBe('Tu rol no tiene acceso al módulo ventas')
    expect(rpc(db, 'registrar_cobro_cuotas', { __uid: PLAN }).error?.message).toBe('Tu rol no tiene acceso al módulo ventas')
  })
})

describe('mock: almacenar y trasladar con kardex', () => {
  it('entrada con usuario y SKU; mismo salón no registra; otro salón es traslado', () => {
    const db = base()
    expect(rpc(db, 'almacenar_paquete', { __uid: ALM, p_paquete_id: 'p1', p_ubicacion_id: 's3' }).error?.message).toContain('salón de destino válido')
    expect(rpc(db, 'almacenar_paquete', { __uid: ALM, p_paquete_id: 'p1', p_ubicacion_id: 's1' }).error).toBeNull()
    expect(rpc(db, 'almacenar_paquete', { __uid: ALM, p_paquete_id: 'p1', p_ubicacion_id: 's1' }).error).toBeNull()
    expect(db.movimientos_stock).toEqual([expect.objectContaining({ tipo: 'ingreso_salon', usuario_id: ALM, catalogo_media_id: 'A', docenas: 2, ubicacion_id: 's1' })])
    expect(rpc(db, 'almacenar_paquete', { __uid: ALM, p_paquete_id: 'p1', p_ubicacion_id: 's2' }).error).toBeNull()
    expect(db.movimientos_stock.slice(1).map(m => [m.tipo, m.ubicacion_id])).toEqual([['traslado_salida', 's1'], ['traslado_entrada', 's2']])
    expect(rpc(db, 'almacenar_paquete', { __uid: ALM, p_ubicacion_id: 's1', p_codigo_paquete: 'N', p_docenas: 2 }).error?.message).toContain('SKU del saco')
    expect(rpc(db, 'almacenar_paquete', { __uid: ALM, p_ubicacion_id: 's1', p_codigo_paquete: 'N', p_docenas: 2, p_catalogo_media_id: 'A', p_detalles: [{ codigo: 'T-A' }, { codigo: 'T-B' }] }).error?.message).toContain('un solo SKU')
  })
  it('traslado: validaciones y dos filas de kardex', () => {
    const db = base()
    expect(rpc(db, 'trasladar_saco', { __uid: ALM, p_paquete_id: 'a1', p_ubicacion_destino_id: 's1' }).error?.message).toBe('El saco ya está en Salón 1')
    expect(rpc(db, 'trasladar_saco', { __uid: ALM, p_paquete_id: 'a1', p_ubicacion_destino_id: 's3' }).error?.message).toContain('salón de destino activo')
    expect(rpc(db, 'trasladar_saco', { __uid: ALM, p_paquete_id: 'p1', p_ubicacion_destino_id: 's2' }).error?.message).toContain('no está en un salón')
    expect(rpc(db, 'trasladar_saco', { __uid: ALM, p_paquete_id: 'a1', p_ubicacion_destino_id: 's2' }).error).toBeNull()
    expect(db.paquetes[0].ubicacion_id).toBe('s2')
    expect(db.movimientos_stock).toEqual([
      expect.objectContaining({ tipo: 'traslado_salida', ubicacion_id: 's1', ubicacion_destino_id: 's2', usuario_id: ALM, docenas: 6 }),
      expect.objectContaining({ tipo: 'traslado_entrada', ubicacion_id: 's2', ubicacion_origen_id: 's1', usuario_id: ALM, docenas: 6 }),
    ])
  })
})

describe('mock: despachar eligiendo sacos', () => {
  it('rechaza lo inválido sin escribir nada', () => {
    const db = base()
    const d = (sacos: string[], agencia = 'Shalom') => rpc(db, 'despachar_venta_sacos', { __uid: ALM, p_venta_id: 'v1', p_agencia: agencia, p_sacos: sacos })
    expect(d(['a1'], ' ').error?.message).toContain('agencia')
    expect(d([]).error?.message).toContain('Elige los sacos')
    expect(d(['a1', 'a1']).error?.message).toContain('más de una vez')
    expect(d(['a1', 'p1']).error?.message).toContain('S-P1 no está disponible')
    expect(d(['a1', 'c1']).error?.message).toBe('El saco S-C1 es de T-C, que no está en el pedido')
    expect(d(['a1', 'b1']).error?.message).toBe('Faltan 4 docenas de T-A: elige más sacos')
    expect(db.guias_remision).toHaveLength(0)
    expect(db.ventas[0].estado).toBe('pendiente')
  })
  it('despacha, guarda quién, el sobrante y una salida por saco desde su salón', () => {
    const db = base()
    const r = rpc(db, 'despachar_venta_sacos', { __uid: ALM, p_venta_id: 'v1', p_agencia: ' Shalom ', p_sacos: ['a1', 'a2', 'b1'] })
    expect(r.error).toBeNull()
    expect(db.guias_remision[0]).toMatchObject({ codigo_guia: r.data, agencia: 'Shalom', despachado_por: ALM })
    expect(db.despacho_detalle.map(x => [x.catalogo_media_id, x.docenas_pedidas, x.docenas_entregadas])).toEqual([['A', 10, 12], ['B', 3, 4]])
    expect(db.movimientos_stock.map(m => [m.tipo, m.paquete_id, m.ubicacion_id])).toEqual([['salida_venta', 'a1', 's1'], ['salida_venta', 'a2', 's2'], ['salida_venta', 'b1', 's1']])
    expect(db.paquetes.filter(p => ['a1', 'a2', 'b1'].includes(p.id)).every(p => p.estado === 'entregado' && p.ubicacion_id === null && p.venta_id === 'v1')).toBe(true)
    expect(db.ventas[0].estado).toBe('entregado')
    expect(rpc(db, 'despachar_venta_sacos', { __uid: ALM, p_venta_id: 'v1', p_agencia: 'X', p_sacos: ['c1'] }).error?.message).toContain('ya fue despachada')
  })
})
