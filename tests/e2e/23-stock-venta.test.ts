/**
 * Ventas no vende crudos ni más de lo que hay para vender (migración 035, decisión 2-A).
 * Stock para vender = sacos almacenados o por almacenar − lo vendido sin despachar.
 * Mismos casos que supabase/tests/035_ventas_stock_vendible_sin_crudos.test.sql.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { stockVendible, motivoNoVendible } from '@/lib/domain/stockVenta'
import { ejecutarRpcProcesos } from '@/lib/supabase/mockRpcProcesos'
import type { Db } from '@/lib/supabase/mockRpcComun'

let db: Db
const vender = (media: string, docenas: number, extra: Record<string, unknown> = {}) => ejecutarRpcProcesos(db, 'registrar_venta', {
  p_cliente: { nombre: 'Cliente 35', numero_documento: '35353535' }, p_asesora_id: 'v1', p_tipo_pago: 'directo', p_monto_adelanto: 0,
  p_items: [{ catalogo_media_id: media, docenas, precio_docena: 10 }], p_cuotas: null, ...extra,
})!
const fila = (id: string) => stockVendible(db).find(f => f.catalogo_media_id === id)

beforeEach(() => {
  db = {
    usuarios: [], clientes: [], ventas: [], items_venta: [], cuotas: [], cobros: [], cajas_diarias: [],
    catalogo_medias: [{ id: 'A', codigo: 'T35-A' }, { id: 'B', codigo: 'T35-B' }, { id: 'C', codigo: 'CRU-35', es_crudo: true }],
    paquetes: [
      { id: 's1', catalogo_media_id: 'A', docenas: 6, estado: 'almacenado' },
      { id: 's2', catalogo_media_id: 'A', docenas: 4, estado: 'pendiente_almacenar' },
      { id: 's3', catalogo_media_id: 'A', docenas: 9, estado: 'entregado' },
      { id: 'sc', catalogo_media_id: 'C', docenas: 5, estado: 'almacenado' },
    ],
  }
})

describe('stock para vender', () => {
  it('físico = almacenado + por almacenar; sin sacos = 0; los crudos no aparecen', () => {
    expect(fila('A')).toEqual({ catalogo_media_id: 'A', fisico: 10, comprometidas: 0, vendibles: 10 })
    expect(fila('B')?.vendibles).toBe(0)
    expect(fila('C')).toBeUndefined()
  })
  it('no vende crudos ni más de lo que hay; dos líneas del mismo producto se suman', () => {
    expect(vender('C', 1).error?.message).toBe('No se vende CRU-35: es un producto crudo')
    expect(vender('B', 1).error?.message).toContain('No hay stock suficiente de T35-B')
    expect(vender('A', 10.5).error?.message).toBe('No hay stock suficiente de T35-A: pides 10.5 docenas y hay 10 para vender')
    expect(vender('A', 6, { p_items: [{ catalogo_media_id: 'A', docenas: 6, precio_docena: 1 }, { catalogo_media_id: 'A', docenas: 5, precio_docena: 1 }] }).error?.message)
      .toContain('pides 11 docenas')
    expect(db.ventas).toHaveLength(0)
    expect(db.clientes).toHaveLength(0)
  })
  it('lo vendido sin despachar queda comprometido; al entregar se libera', () => {
    expect(vender('A', 8).error).toBeNull()
    expect(fila('A')).toMatchObject({ fisico: 10, comprometidas: 8, vendibles: 2 })
    expect(vender('A', 3).error?.message).toContain('pides 3 docenas y hay 2 para vender')
    expect(vender('A', 2).error).toBeNull()
    expect(vender('A', 0.5).error?.message).toContain('hay 0 para vender')
    db.ventas[0].estado = 'entregado'
    expect(fila('A')?.comprometidas).toBe(2)
  })
  it('con un saldo negativo (sobreventa antigua) no deja vender y dice 0', () => {
    db.ventas.push({ id: 'old', estado: 'pendiente' }); db.items_venta.push({ venta_id: 'old', catalogo_media_id: 'A', docenas: 12 })
    expect(fila('A')?.vendibles).toBe(-2)
    expect(motivoNoVendible([{ catalogo_media_id: 'A', docenas: 1 }], stockVendible(db), db.catalogo_medias)).toContain('hay 0 para vender')
  })
})
