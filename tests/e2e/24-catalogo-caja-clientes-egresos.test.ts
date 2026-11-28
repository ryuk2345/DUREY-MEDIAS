/**
 * Fase 7 (migración 036): SKU y código fijos; catálogo, caja, clientes y egresos solo por
 * funciones con módulo; gastos de materia prima por pagos reales.
 * Mismos casos que supabase/tests/036_catalogo_caja_clientes_egresos_por_funciones.test.sql.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ejecutarRpcGestion } from '@/lib/supabase/mockRpcGestion'
import { gastosMateriaPrima, totalGastos, cierreDeCaja } from '@/lib/domain/finance'
import { cambiaIdentidad } from '@/lib/domain/catalogo'
import { hoyLocal } from '@/lib/domain/mantenimiento'
import type { Db } from '@/lib/supabase/mockRpcComun'

let db: Db
const ADM = 'adm', VEN = 'ven', TEJ = 'tej', ALM = 'alm'
const rpc = (fn: string, uid: string, p: Record<string, unknown> = {}) => ejecutarRpcGestion(db, fn, { __uid: uid, ...p })!
const producto = (extra: Record<string, unknown> = {}) => ({ sku: 'SKU-36A', codigo: 't36_a', modelo: 'M36', publico: 'adulto', diseno_color: 'Azul', talla: 'L',
  costo_produccion_docena: 5, precio_venta_sugerido: 12, ...extra })

beforeEach(() => {
  db = {
    usuarios: [
      { id: ADM, rol: 'admin', activo: true }, { id: VEN, rol: 'vendedora', activo: true },
      { id: TEJ, rol: 'tejedor', activo: true }, { id: ALM, rol: 'almacenero', activo: true },
    ],
    catalogo_medias: [], modelos_media: [], clientes: [], ventas: [], items_venta: [], cajas_diarias: [], egresos_adicionales: [], compras_repuestos: [],
  }
})

describe('sin el módulo, nada', () => {
  it('rechaza catálogo, caja, clientes y egresos con el mismo texto que la base', () => {
    expect(rpc('crear_producto', TEJ, { p_datos: producto() }).error?.message).toBe('Tu rol no tiene acceso al módulo catalogo')
    expect(rpc('crear_modelo_media', TEJ, { p_nombre: 'M' }).error?.message).toContain('módulo catalogo')
    expect(rpc('abrir_caja', TEJ, { p_asesora_id: VEN, p_saldo_inicial: 10 }).error?.message).toContain('módulo ventas')
    expect(rpc('guardar_cliente', TEJ, { p_datos: { nombre: 'X', numero_documento: '1' } }).error?.message).toContain('módulo clientes')
    expect(rpc('registrar_egreso', TEJ, { p_concepto: 'Luz', p_monto: 1, p_categoria: 'servicios' }).error?.message)
      .toBe('Tu rol no tiene acceso al módulo egresos ni al módulo materia_prima')
  })
})

describe('catálogo con SKU y código fijos', () => {
  it('valida, crea y edita todo menos el SKU y el código', () => {
    expect(rpc('crear_producto', VEN, { p_datos: producto({ diseno_color: '' }) }).error?.message).toContain('Completa modelo')
    expect(rpc('crear_producto', VEN, { p_datos: producto({ costo_produccion_docena: -1 }) }).error?.message).toContain('no pueden ser negativos')
    const id = rpc('crear_producto', VEN, { p_datos: producto() }).data
    expect(rpc('crear_producto', VEN, { p_datos: producto({ sku: 'OTRO' }) }).error?.message).toContain('código t36_a')
    expect(rpc('editar_producto', VEN, { p_id: id, p_datos: producto({ sku: 'OTRO', codigo: 'otro', diseno_color: 'Rojo', talla: 'XL', costo_produccion_docena: 6, precio_venta_sugerido: 14 }) }).error).toBeNull()
    expect(db.catalogo_medias[0]).toMatchObject({ sku: 'SKU-36A', codigo: 't36_a', diseno_color: 'Rojo', talla: 'XL', costo_produccion_docena: 6, precio_venta_sugerido: 14 })
  })
  it('un producto sin SKU puede recibirlo una vez', () => {
    db.catalogo_medias.push({ id: 'sin', codigo: 't36_sin', sku: null, modelo: 'M36', publico: 'adulto', diseno_color: 'Verde', talla: 'L' })
    rpc('editar_producto', ADM, { p_id: 'sin', p_datos: producto({ sku: 'SKU-36S', codigo: 'x', diseno_color: 'Verde' }) })
    rpc('editar_producto', ADM, { p_id: 'sin', p_datos: producto({ sku: 'SKU-36X', codigo: 'x', diseno_color: 'Verde' }) })
    expect(db.catalogo_medias[0]).toMatchObject({ sku: 'SKU-36S', codigo: 't36_sin' })
  })
  it('la regla de identidad: código nunca; SKU solo si estaba vacío', () => {
    expect(cambiaIdentidad({ sku: 'A', codigo: 'c' }, { sku: 'A', codigo: 'c' })).toBe(false)
    expect(cambiaIdentidad({ sku: 'A', codigo: 'c' }, { sku: 'B', codigo: 'c' })).toBe(true)
    expect(cambiaIdentidad({ sku: 'A', codigo: 'c' }, { sku: 'A', codigo: 'd' })).toBe(true)
    expect(cambiaIdentidad({ sku: null, codigo: 'c' }, { sku: 'B', codigo: 'c' })).toBe(false)
  })
  it('estado, modelo y eliminar: con ventas se desactiva, sin uso se elimina', () => {
    const id = rpc('crear_producto', ADM, { p_datos: producto() }).data
    expect(rpc('cambiar_estado_producto', ADM, { p_id: id, p_estado: 'borrado' }).error?.message).toBe('Estado de producto inválido')
    rpc('cambiar_estado_producto', ADM, { p_id: id, p_estado: 'inactivo' })
    expect(db.catalogo_medias[0].estado).toBe('inactivo')
    rpc('crear_modelo_media', ADM, { p_nombre: ' Modelo 36 ' })
    expect(db.modelos_media[0].nombre).toBe('Modelo 36')
    db.items_venta.push({ venta_id: 'v', catalogo_media_id: id })
    expect(rpc('eliminar_producto', ADM, { p_id: id }).error?.message).toContain('Desactívalo en su lugar')
    const libre = rpc('crear_producto', ADM, { p_datos: producto({ sku: 'SKU-L', codigo: 'libre' }) }).data
    expect(rpc('eliminar_producto', ADM, { p_id: libre }).error).toBeNull()
    expect(db.catalogo_medias.map(c => c.codigo)).toEqual(['t36_a'])
  })
})

describe('clientes', () => {
  it('crea, rechaza duplicados, edita y no elimina a quien tiene ventas', () => {
    const id = rpc('guardar_cliente', VEN, { p_id: null, p_datos: { nombre: ' Cliente 36 ', numero_documento: '20360360361', telefono: '', direccion: 'Jr. 36' } }).data
    expect(rpc('guardar_cliente', VEN, { p_datos: { nombre: 'Otro', numero_documento: '20360360361' } }).error?.message).toBe('Ya hay un cliente con el documento 20360360361')
    expect(rpc('guardar_cliente', VEN, { p_datos: { nombre: '', numero_documento: '1' } }).error?.message).toContain('obligatorio')
    rpc('guardar_cliente', VEN, { p_id: id, p_datos: { nombre: 'Cliente 36 SAC', numero_documento: '20360360361', telefono: '999' } })
    expect(db.clientes[0]).toMatchObject({ tipo_documento: 'ruc', nombre: 'Cliente 36 SAC', telefono: '999', direccion: null })
    db.ventas.push({ id: 'v1', cliente_id: id })
    expect(rpc('eliminar_cliente', VEN, { p_id: id }).error?.message).toBe('No se puede eliminar a Cliente 36 SAC: tiene ventas registradas')
    const otro = rpc('guardar_cliente', VEN, { p_datos: { nombre: 'Sin ventas', numero_documento: '36363636' } }).data
    expect(rpc('eliminar_cliente', VEN, { p_id: otro }).error).toBeNull()
    expect(db.clientes).toHaveLength(1)
  })
})

describe('caja diaria', () => {
  it('abre una por vendedora y día con fecha de Lima; cierra con lo esperado calculado aquí', () => {
    expect(rpc('abrir_caja', VEN, { p_asesora_id: VEN, p_saldo_inicial: -1 }).error?.message).toContain('no puede ser negativo')
    expect(rpc('abrir_caja', VEN, { p_asesora_id: null, p_saldo_inicial: 10 }).error?.message).toContain('Elige la vendedora')
    const id = rpc('abrir_caja', VEN, { p_asesora_id: VEN, p_saldo_inicial: 100 }).data
    expect(rpc('abrir_caja', VEN, { p_asesora_id: VEN, p_saldo_inicial: 50 }).error?.message).toBe('Esa vendedora ya abrió su caja de hoy')
    expect(db.cajas_diarias[0]).toMatchObject({ fecha: hoyLocal(), estado: 'abierta' })
    Object.assign(db.cajas_diarias[0], { ventas_efectivo: 80, cobros_efectivo: 30, pagos_efectivo: 10 })
    expect(rpc('cerrar_caja', VEN, { p_caja_id: id, p_declarado_efectivo: 190, p_justificacion: ' ' }).error?.message).toContain('justificación')
    expect(rpc('cerrar_caja', VEN, { p_caja_id: id, p_declarado_efectivo: 190, p_justificacion: 'Faltó cambio' }).data)
      .toEqual({ esperado: 200, diferencia: -10, estado: 'cerrada_faltante' })
    expect(db.cajas_diarias[0]).toMatchObject({ saldo_esperado_efectivo: 200, saldo_declarado_efectivo: 190, diferencia: -10, justificacion: 'Faltó cambio' })
    expect(rpc('cerrar_caja', VEN, { p_caja_id: id, p_declarado_efectivo: 200 }).error?.message).toBe('La caja ya está cerrada')
  })
  it('la regla de cierre: cuadrada, faltante o sobrante', () => {
    const caja = { saldo_inicial: 100, ventas_efectivo: 50, cobros_efectivo: 0, pagos_efectivo: 0 }
    expect([150, 149.5, 151].map(d => cierreDeCaja(caja, d).estado)).toEqual(['cerrada_cuadrada', 'cerrada_faltante', 'cerrada_sobrante'])
  })
})

describe('egresos', () => {
  it('materia prima registra; solo egresos elimina; lo de repuestos no se elimina', () => {
    const id = rpc('registrar_egreso', ALM, { p_concepto: ' Planilla ', p_monto: 500, p_categoria: 'planilla', p_fecha: null, p_comprobante_url: ' https://x/c.jpg ' }).data
    expect(db.egresos_adicionales[0]).toMatchObject({ concepto: 'Planilla', comprobante_url: 'https://x/c.jpg', fecha: hoyLocal() })
    expect(rpc('registrar_egreso', ALM, { p_concepto: 'Luz', p_monto: 0, p_categoria: 'servicios' }).error?.message).toContain('mayor a 0')
    expect(rpc('eliminar_egreso', ALM, { p_id: id }).error?.message).toContain('módulo egresos')
    const rep = rpc('registrar_egreso', ADM, { p_concepto: 'Aguja', p_monto: 80, p_categoria: 'repuestos', p_fecha: '2026-11-01' }).data
    db.compras_repuestos.push({ id: 'cr', egreso_id: rep })
    expect(rpc('eliminar_egreso', ADM, { p_id: rep }).error?.message).toContain('viene de una compra de repuestos')
    expect(rpc('eliminar_egreso', ADM, { p_id: id }).error).toBeNull()
    expect(db.egresos_adicionales.map(e => e.id)).toEqual([rep])
  })
})

describe('gastos de materia prima por pagos reales (P1-A)', () => {
  const compras = [
    { id: 'k1', fecha: '2026-11-02', costo_total: 120, estado: 'recibida', condicion_pago: 'contado' },
    { id: 'k2', fecha: '2026-11-02', costo_total: 999, estado: 'devuelta', condicion_pago: 'contado' },
    { id: 'k3', fecha: '2026-11-02', costo_total: 50, estado: 'pendiente', condicion_pago: 'contado' },
    { id: 'k4', fecha: '2026-11-03', costo_total: 300, estado: 'recibida', condicion_pago: 'pago_diferido' },
    { id: 'k5', fecha: '2026-11-04', costo_total: 40, estado: 'recibida', condicion_pago: null },
  ]
  const cuotas = [{ id: 'q1', compra_id: 'k4' }, { id: 'q2', compra_id: 'k4' }]
  const pagos = [{ fecha: '2026-11-12', monto: 100, cuota_compra_id: 'q1' }]
  it('contado recibido por su fecha y cada cuota pagada por su fecha; sin devueltas ni pendientes', () => {
    const filas = gastosMateriaPrima(compras, pagos, cuotas)
    expect(filas).toEqual([
      { fecha: '2026-11-02', monto: 120, origen: 'contado', compra_id: 'k1' },
      { fecha: '2026-11-04', monto: 40, origen: 'contado', compra_id: 'k5' },
      { fecha: '2026-11-12', monto: 100, origen: 'cuota', compra_id: 'k4' },
    ])
    expect(totalGastos(filas)).toBe(260)
    expect(totalGastos(filas, '2026-11-03', '2026-11-30')).toBe(140)
  })
})
