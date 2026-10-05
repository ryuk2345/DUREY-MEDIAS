/**
 * Operaciones atómicas de Materia Prima y Repuestos (migración 024).
 * Ejecuta la emulación local real (lib/supabase/mockRpcMateriaPrima.ts); las mismas
 * reglas se prueban en Postgres en supabase/tests/024_rpc_materia_prima.test.sql.
 *
 * El test FALLA si:
 *   - Aprobar una compra pisa un consumo de hilo ocurrido después de abrir la pantalla
 *   - Una compra se puede aprobar dos veces
 *   - Editar un hilo cambia el stock sin que el usuario lo haya modificado
 *   - Las cuotas de una compra no suman exactamente el total
 *   - Una salida de repuestos mayor al stock se acepta
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ejecutarRpcMateriaPrima } from '@/lib/supabase/mockRpcMateriaPrima'
import type { Db } from '@/lib/supabase/mockRpcComun'

let db: Db
const rpc = (fn: string, p: Record<string, unknown>) => ejecutarRpcMateriaPrima(db, fn, p)!

beforeEach(() => {
  db = {
    materia_prima: [
      { id: 'h1', material: 'Algodón', color: 'Blanco', stock_kg: 20, tipo_empaque: 'cono' },
      { id: 'h2', material: 'Algodón', color: 'Negro', stock_kg: 30, tipo_empaque: 'cono' },
    ],
    repuestos: [{ id: 'r1', nombre: 'Aguja', stock_actual: 5, costo_unitario: 10 }],
    compras_materia_prima: [], cuotas_compras: [], movimientos_materia_prima: [], egresos_adicionales: [],
  }
})

const compra = (extra: Record<string, unknown> = {}) => rpc('registrar_compra_materia_prima', {
  p_proveedor_id: 'p1', p_materia_prima_id: 'h1', p_cantidad_kg: 10, p_costo_total: 100,
  p_condicion_pago: 'contado', p_metodo_pago: 'efectivo', p_cuotas_num: null, ...extra,
})

describe('compras y control de calidad', () => {
  it('las cuotas a crédito suman exactamente el total', () => {
    compra({ p_condicion_pago: 'pago_diferido', p_cuotas_num: 3 })
    expect(db.cuotas_compras.map(q => q.monto)).toEqual([33.33, 33.33, 33.34])
  })

  it('aprobar suma al stock ACTUAL (respeta un consumo posterior) y no se repite', () => {
    const compraId = compra().data
    db.materia_prima[0].stock_kg -= 6 // un lote de tejido consumió 6 kg en medio
    expect(rpc('procesar_control_calidad_compra', { p_compra_id: compraId, p_aprobar: true }).error).toBeNull()
    expect(db.materia_prima[0].stock_kg).toBe(24)
    expect(rpc('procesar_control_calidad_compra', { p_compra_id: compraId, p_aprobar: true }).error?.message).toContain('ya fue procesada')
    expect(db.materia_prima[0].stock_kg).toBe(24)
  })

  it('devolver exige motivo y no suma stock', () => {
    const compraId = compra().data
    expect(rpc('procesar_control_calidad_compra', { p_compra_id: compraId, p_aprobar: false, p_motivo: ' ' }).error?.message).toContain('motivo')
    rpc('procesar_control_calidad_compra', { p_compra_id: compraId, p_aprobar: false, p_motivo: 'Color equivocado' })
    expect(db.materia_prima[0].stock_kg).toBe(20)
    expect(db.movimientos_materia_prima[0].tipo).toBe('devolucion')
  })
})

describe('editar hilo', () => {
  it('cambiar el color no toca el stock real aunque la pantalla mostrara otro', () => {
    db.materia_prima[0].stock_kg = 24
    rpc('editar_materia_prima', { p_id: 'h1', p_material: 'Algodón', p_color: 'Crudo', p_tipo_empaque: 'cono', p_stock_anterior: 20, p_stock_nuevo: 20 })
    expect(db.materia_prima[0]).toMatchObject({ color: 'Crudo', stock_kg: 24 })
    expect(db.movimientos_materia_prima).toHaveLength(0)
    expect(db.materia_prima[1].color).toBe('Negro')
  })

  it('un conteo físico ajusta el stock y deja movimiento', () => {
    db.materia_prima[0].stock_kg = 24
    rpc('editar_materia_prima', { p_id: 'h1', p_material: 'Algodón', p_color: 'Blanco', p_tipo_empaque: 'cono', p_stock_anterior: 20, p_stock_nuevo: 22.5 })
    expect(db.materia_prima[0].stock_kg).toBe(22.5)
    expect(db.movimientos_materia_prima[0]).toMatchObject({ tipo: 'ajuste_inventario', cantidad_kg: -1.5 })
  })
})

describe('repuestos', () => {
  it('[NEGOCIO] una salida mayor al stock se rechaza sin registrar gasto', () => {
    const antes = structuredClone(db)
    expect(rpc('ajustar_stock_repuesto', { p_repuesto_id: 'r1', p_tipo: 'salida', p_cantidad: 6 }).error?.message).toContain('Solo hay 5')
    expect(db).toEqual(antes)
  })

  it('una salida válida descuenta y registra el gasto real', () => {
    expect(rpc('ajustar_stock_repuesto', { p_repuesto_id: 'r1', p_tipo: 'salida', p_cantidad: 2, p_motivo: 'Cambio' }).data).toBe(3)
    expect(db.egresos_adicionales[0].monto).toBe(20)
  })
})
