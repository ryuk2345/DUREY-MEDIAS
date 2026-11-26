/**
 * Fase 3 — Repuestos y mecánicos.
 * Spec: 02-DOCS/wiki/sdd/specs/fase-3-repuestos-mecanicos.md
 *   - Buscador y filtro de repuestos.
 *   - Compra al contado: stock sube, costo = último precio, egreso por el total;
 *     efectivo de la caja del día resta de la caja.
 *   - Mecánicos (no usuarios); fallas con repuestos usados que bajan el stock sin egreso;
 *     al cerrar, costo de repuestos = suma de lo usado.
 *   - El rol técnico ya no existe.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { filtrarRepuestos, totalCompraRepuesto, costoRepuestosUsados, nombreMecanico, redondearCentimos } from '@/lib/domain/repuestos'
import { ejecutarRpcMantenimiento } from '@/lib/supabase/mockRpcMantenimiento'
import { ejecutarRpcMateriaPrima } from '@/lib/supabase/mockRpcMateriaPrima'
import { MODULOS_POR_ROL, ROLES_LABELS } from '@/lib/utils'
import { normalizarRol } from '@/lib/auth/roles'
import { gastoMantenimiento } from '@/lib/domain/finance'

describe('lib/domain/repuestos', () => {
  const lista = [
    { id: '1', nombre: 'Aguja de tejer 3.5', stock_actual: 10 },
    { id: '2', nombre: 'Correa dentada', stock_actual: 0 },
    { id: '3', nombre: 'Aceite de máquina', stock_actual: 2 },
  ]

  it('busca por nombre sin importar mayúsculas ni tildes', () => {
    expect(filtrarRepuestos(lista, 'AGUJA', 'todos').map(r => r.id)).toEqual(['1'])
    expect(filtrarRepuestos(lista, 'maquina', 'todos').map(r => r.id)).toEqual(['3'])
    expect(filtrarRepuestos(lista, '', 'todos')).toHaveLength(3)
  })

  it('filtra con stock y agotados', () => {
    expect(filtrarRepuestos(lista, '', 'con_stock').map(r => r.id)).toEqual(['1', '3'])
    expect(filtrarRepuestos(lista, '', 'agotados').map(r => r.id)).toEqual(['2'])
    expect(filtrarRepuestos(lista, 'correa', 'con_stock')).toEqual([])
  })

  it('total de compra: cantidad × precio redondeado a céntimos (igual que la base)', () => {
    expect(totalCompraRepuesto(3, 12)).toBe(36)
    expect(totalCompraRepuesto(100, 0.125)).toBe(13) // 0.125 → 0.13 × 100
    expect(totalCompraRepuesto(1, 1.005)).toBe(1.01) // sin error de coma flotante
    expect(totalCompraRepuesto(1, 2.135)).toBe(2.14)
    expect(totalCompraRepuesto(1, 4.015)).toBe(4.02)
    expect(totalCompraRepuesto(3, 1999.995)).toBe(6000)
  })

  it('redondearCentimos: números en notación científica y negativos diminutos', () => {
    expect(redondearCentimos(1e-7)).toBe(0)
    expect(Object.is(redondearCentimos(-0.001), 0)).toBe(true) // 0, no -0
    expect(redondearCentimos(1e21)).toBe(1e21)
    expect(redondearCentimos(5e-324)).toBe(0)
    expect(redondearCentimos(-2.135)).toBe(-2.14)
    expect(totalCompraRepuesto(2, 0)).toBe(0)
  })

  it('costo de repuestos usados = suma de cantidad × costo del momento', () => {
    expect(costoRepuestosUsados([{ cantidad: 2, costo_unitario: 12 }, { cantidad: 1, costo_unitario: 50.5 }])).toBe(74.5)
    expect(costoRepuestosUsados([])).toBe(0)
  })

  it('nombre del mecánico: nombre y apellido', () => {
    expect(nombreMecanico({ nombre: ' Juan ', apellido: 'Pérez ' })).toBe('Juan Pérez')
    expect(nombreMecanico(null)).toBe('Sin asignar')
  })
})

// ── RPC del mock (mismas reglas que la migración 029) ───────────────────────
type Db = Record<string, any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
const hoy = () => new Date().toISOString().split('T')[0]
const rpcMant = (db: Db, fn: string, p: object) => ejecutarRpcMantenimiento(db, fn, p)!
const rpcMp = (db: Db, fn: string, p: object) => ejecutarRpcMateriaPrima(db, fn, p)!

describe('mock: compra de repuestos (AC1)', () => {
  let db: Db
  beforeEach(() => {
    db = {
      repuestos: [{ id: 'r1', nombre: 'Aguja', stock_actual: 5, costo_unitario: 10 }],
      proveedores: [{ id: 'p1', nombre: 'Ferretería' }],
      cajas_diarias: [{ id: 'c1', fecha: hoy(), estado: 'abierta', asesora_id: null, pagos_efectivo: 0, created_at: '1' }],
      egresos_adicionales: [],
      usuarios: [],
    }
  })

  it('stock 5 + 3, costo = último precio 12, egreso 36 y resta de la caja', () => {
    const r = rpcMant(db, 'registrar_compra_repuesto', {
      p_repuesto_id: 'r1', p_cantidad: 3, p_precio_unitario: 12, p_metodo_pago: 'efectivo', p_proveedor_id: 'p1', p_de_caja: true,
    })
    expect(r.error).toBeNull()
    expect(db.repuestos[0]).toMatchObject({ stock_actual: 8, costo_unitario: 12 })
    expect(db.egresos_adicionales).toHaveLength(1)
    expect(db.egresos_adicionales[0]).toMatchObject({ monto: 36, categoria: 'repuestos' })
    expect(db.cajas_diarias[0].pagos_efectivo).toBe(36)
    expect(r.data).toMatchObject({ total: 36, descontado_de_caja: true, caja_de: 'Caja general' })
    expect(db.compras_repuestos[0]).toMatchObject({ total: 36, de_caja: true, caja_id: 'c1', proveedor_id: 'p1' })
  })

  it('efectivo fuera de la caja, transferencia y precio 0: la caja no cambia', () => {
    rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 10, p_metodo_pago: 'efectivo', p_de_caja: false })
    rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 10, p_metodo_pago: 'transferencia', p_de_caja: true })
    rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 0, p_metodo_pago: 'efectivo', p_de_caja: true })
    expect(db.cajas_diarias[0].pagos_efectivo).toBe(0)
    expect(db.egresos_adicionales).toHaveLength(2) // la de precio 0 no crea egreso
    expect(db.repuestos[0]).toMatchObject({ stock_actual: 8, costo_unitario: 0 })
  })

  it('rechaza cantidad 0, precio negativo, método inválido, fecha futura y proveedor inexistente sin tocar nada', () => {
    const casos: [object, string][] = [
      [{ p_cantidad: 0, p_precio_unitario: 1, p_metodo_pago: 'efectivo' }, 'mayor a 0'],
      [{ p_cantidad: 1, p_precio_unitario: -1, p_metodo_pago: 'efectivo' }, 'negativo'],
      [{ p_cantidad: 1, p_precio_unitario: 1, p_metodo_pago: 'cheque' }, 'Método de pago'],
      [{ p_cantidad: 1, p_precio_unitario: 1, p_metodo_pago: 'efectivo', p_fecha: '2999-01-01' }, 'futura'],
      [{ p_cantidad: 1, p_precio_unitario: 1, p_metodo_pago: 'efectivo', p_proveedor_id: 'nadie' }, 'Proveedor'],
    ]
    for (const [p, msg] of casos) {
      const r = rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', ...p })
      expect(r.error?.message).toContain(msg)
    }
    expect(db.repuestos[0]).toMatchObject({ stock_actual: 5, costo_unitario: 10 })
    expect(db.egresos_adicionales).toHaveLength(0)
  })

  it('la caja de quien paga va primero; nunca una cerrada ni de otro día; compra de otro día no toca la caja', () => {
    db.cajas_diarias.push(
      { id: 'c2', fecha: hoy(), estado: 'abierta', asesora_id: 'u1', pagos_efectivo: 0, created_at: '2' },
      { id: 'c3', fecha: hoy(), estado: 'cerrada_cuadrada', asesora_id: null, pagos_efectivo: 0, created_at: '0' },
      { id: 'c4', fecha: '2000-01-01', estado: 'abierta', asesora_id: null, pagos_efectivo: 0, created_at: '0' },
    )
    rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 7, p_metodo_pago: 'efectivo', p_de_caja: true, p_usuario_id: 'u1' })
    expect(db.cajas_diarias.map(c => c.pagos_efectivo)).toEqual([0, 7, 0, 0])
    rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 7, p_metodo_pago: 'efectivo', p_de_caja: true, p_fecha: '2026-01-01' })
    expect(db.cajas_diarias.map(c => c.pagos_efectivo)).toEqual([0, 7, 0, 0])
    expect(db.egresos_adicionales.at(-1)).toMatchObject({ fecha: '2026-01-01', monto: 7 })
  })

  it('sin caja propia: la general de hoy más antigua; nunca una de otro día ni de otra persona', () => {
    db.cajas_diarias = [
      { id: 'vieja', fecha: '2000-01-01', estado: 'abierta', asesora_id: null, pagos_efectivo: 0, created_at: '0' },
      { id: 'otra', fecha: hoy(), estado: 'abierta', asesora_id: 'u9', pagos_efectivo: 0, created_at: '1' },
      { id: 'gen2', fecha: hoy(), estado: 'abierta', asesora_id: null, pagos_efectivo: 0, created_at: '3' },
      { id: 'gen1', fecha: hoy(), estado: 'abierta', asesora_id: null, pagos_efectivo: 0, created_at: '2' },
    ]
    rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 5, p_metodo_pago: 'efectivo', p_de_caja: true, p_usuario_id: 'u1' })
    expect(Object.fromEntries(db.cajas_diarias.map(c => [c.id, c.pagos_efectivo]))).toEqual({ vieja: 0, otra: 0, gen2: 0, gen1: 5 })
  })

  it('precio 0 en efectivo de caja no toca la caja; efectivo fuera de caja queda de_caja = false', () => {
    const r = rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 0, p_metodo_pago: 'efectivo', p_de_caja: true })
    expect(r.data).toMatchObject({ descontado_de_caja: false, caja_id: null })
    rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 3, p_metodo_pago: 'efectivo', p_de_caja: false })
    expect(db.compras_repuestos.at(-1)).toMatchObject({ de_caja: false, caja_id: null })
    expect(db.cajas_diarias[0].pagos_efectivo).toBe(0)
  })

  it('una caja cerrada de hoy nunca se toca', () => {
    db.cajas_diarias = [{ id: 'cerrada', fecha: hoy(), estado: 'cerrada_cuadrada', asesora_id: null, pagos_efectivo: 0, created_at: '0' }]
    const r = rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 7, p_metodo_pago: 'efectivo', p_de_caja: true })
    expect(r.data).toMatchObject({ descontado_de_caja: false })
    expect(db.cajas_diarias[0].pagos_efectivo).toBe(0)
  })

  it('sin caja abierta la compra se registra igual (gasto, sin caja)', () => {
    db.cajas_diarias = []
    const r = rpcMant(db, 'registrar_compra_repuesto', { p_repuesto_id: 'r1', p_cantidad: 1, p_precio_unitario: 7, p_metodo_pago: 'efectivo', p_de_caja: true })
    expect(r.data).toMatchObject({ descontado_de_caja: false, total: 7 })
    expect(db.egresos_adicionales).toHaveLength(1)
  })

  it('el ajuste manual de stock ya no crea egreso', () => {
    const r = rpcMp(db, 'ajustar_stock_repuesto', { p_repuesto_id: 'r1', p_tipo: 'salida', p_cantidad: 2, p_motivo: 'conteo' })
    expect(r.data).toBe(3)
    expect(db.egresos_adicionales).toHaveLength(0)
  })
})

describe('mock: fallas con mecánico y repuestos (AC2-AC4)', () => {
  let db: Db
  beforeEach(() => {
    db = {
      repuestos: [
        { id: 'r1', nombre: 'Aguja', stock_actual: 5, costo_unitario: 12 },
        { id: 'r2', nombre: 'Correa', stock_actual: 2, costo_unitario: 50 },
      ],
      mecanicos: [
        { id: 'm1', nombre: 'Juan', apellido: 'Pérez', telefono: '987654321', activo: true },
        { id: 'm2', nombre: 'Luis', apellido: 'Baja', telefono: '9', activo: false },
      ],
      maquinas: [{ id: 'q1', codigo: 'T01', estado: 'malograda' }],
      averias_maquinas: [{ id: 'a1', maquina_id: 'q1', estado: 'pendiente' }],
      egresos_adicionales: [],
      reparaciones: [],
    }
  })

  const iniciar = () => rpcMant(db, 'iniciar_reparacion_mecanico', { p_averia_id: 'a1', p_mecanico_id: 'm1' })

  it('iniciar exige mecánico activo y deja la máquina en mantenimiento', () => {
    expect(rpcMant(db, 'iniciar_reparacion_mecanico', { p_averia_id: 'a1', p_mecanico_id: null }).error?.message).toContain('mecánico')
    expect(rpcMant(db, 'iniciar_reparacion_mecanico', { p_averia_id: 'a1', p_mecanico_id: 'm2' }).error?.message).toContain('no está activo')
    expect(iniciar().error).toBeNull()
    expect(db.averias_maquinas[0]).toMatchObject({ estado: 'en_reparacion', mecanico_id: 'm1', asignado_a: 'Juan Pérez' })
    expect(db.maquinas[0].estado).toBe('mantenimiento')
  })

  it('sin stock suficiente se rechaza y no descuenta; usar justo lo que queda sí se puede (AC2)', () => {
    iniciar()
    const r = rpcMant(db, 'usar_repuesto_en_averia', { p_averia_id: 'a1', p_repuesto_id: 'r2', p_cantidad: 3 })
    expect(r.error?.message).toBe('Solo hay 2 unidades de Correa; no se pueden usar 3')
    expect(db.repuestos[1].stock_actual).toBe(2)
    expect(rpcMant(db, 'usar_repuesto_en_averia', { p_averia_id: 'a1', p_repuesto_id: 'r2', p_cantidad: 2 }).error).toBeNull()
    expect(db.repuestos[1].stock_actual).toBe(0)
  })

  it('controles de estado: no se cierra sin iniciar, no se inicia dos veces, no se cierra dos veces', () => {
    expect(rpcMant(db, 'cerrar_reparacion_averia', { p_averia_id: 'a1', p_descripcion: 'x', p_costo_mano_obra: 0 }).error?.message).toContain('Primero inicia')
    iniciar()
    expect(iniciar().error?.message).toContain('pendiente')
    expect(rpcMant(db, 'cerrar_reparacion_averia', { p_averia_id: 'a1', p_descripcion: 'x', p_costo_mano_obra: 10 }).error).toBeNull()
    expect(rpcMant(db, 'cerrar_reparacion_averia', { p_averia_id: 'a1', p_descripcion: 'x', p_costo_mano_obra: 10 }).error?.message).toContain('Primero inicia')
    expect(db.reparaciones).toHaveLength(1)
    expect(db.maquinas[0]).toMatchObject({ estado: 'activa', detalle_estado: 'OPERATIVA' })
    expect(rpcMant(db, 'asignar_mecanico_averia', { p_averia_id: 'a1', p_mecanico_id: 'm1' }).error?.message).toContain('resuelta')
  })

  it('iniciar exige la máquina malograda', () => {
    db.maquinas[0].estado = 'activa'
    expect(iniciar().error?.message).toContain('malograda')
    expect(db.averias_maquinas[0].estado).toBe('pendiente')
  })

  it('usar baja el stock sin egreso; quitar lo devuelve; cerrar suma lo usado (AC3)', () => {
    expect(rpcMant(db, 'usar_repuesto_en_averia', { p_averia_id: 'a1', p_repuesto_id: 'r1', p_cantidad: 1 }).error?.message).toContain('en reparación')
    iniciar()
    rpcMant(db, 'usar_repuesto_en_averia', { p_averia_id: 'a1', p_repuesto_id: 'r1', p_cantidad: 2 })
    const uso = rpcMant(db, 'usar_repuesto_en_averia', { p_averia_id: 'a1', p_repuesto_id: 'r2', p_cantidad: 1 })
    expect(db.repuestos.map(r => r.stock_actual)).toEqual([3, 1])
    expect(db.egresos_adicionales).toHaveLength(0)
    expect(db.averia_repuestos[0]).toMatchObject({ costo_unitario: 12, mecanico_id: 'm1' })

    expect(rpcMant(db, 'quitar_repuesto_de_averia', { p_uso_id: uso.data }).error).toBeNull()
    expect(db.repuestos[1].stock_actual).toBe(2)

    expect(rpcMant(db, 'cerrar_reparacion_averia', { p_averia_id: 'a1', p_descripcion: ' ', p_costo_mano_obra: 0 }).error?.message).toContain('diagnóstico')
    const r = rpcMant(db, 'cerrar_reparacion_averia', { p_averia_id: 'a1', p_descripcion: 'Cambio de aguja', p_costo_mano_obra: 30 })
    expect(r.error).toBeNull()
    expect(db.reparaciones[0]).toMatchObject({ costo_repuestos: 24, costo_mano_obra: 30, costo_total: 54, mecanico_id: 'm1' })
    expect(db.averias_maquinas[0].estado).toBe('resuelto')
    expect(db.maquinas[0].estado).toBe('activa')
    expect(rpcMant(db, 'usar_repuesto_en_averia', { p_averia_id: 'a1', p_repuesto_id: 'r1', p_cantidad: 1 }).error?.message).toContain('en reparación')
  })

  it('asignar un mecánico a una falla pendiente guarda su nombre (AC4)', () => {
    expect(rpcMant(db, 'asignar_mecanico_averia', { p_averia_id: 'a1', p_mecanico_id: 'm1' }).error).toBeNull()
    expect(db.averias_maquinas[0]).toMatchObject({ mecanico_id: 'm1', asignado_a: 'Juan Pérez', estado: 'pendiente' })
  })
})

describe('gasto de mantenimiento (decisión A: el repuesto es gasto al comprarlo)', () => {
  it('suma solo la mano de obra: los repuestos no se cuentan dos veces', () => {
    expect(gastoMantenimiento([{ costo_mano_obra: 30 }, { costo_mano_obra: '12.5' }, { costo_mano_obra: null }])).toBe(42.5)
    expect(gastoMantenimiento([])).toBe(0)
  })
})

describe('el rol técnico ya no existe (AC5)', () => {
  it('no está en MODULOS_POR_ROL ni en ROLES_LABELS', () => {
    expect(MODULOS_POR_ROL.tecnico).toBeUndefined()
    expect(ROLES_LABELS.tecnico).toBeUndefined()
  })
  it('normalizarRol ya no produce "tecnico"', () => {
    expect(normalizarRol('Técnico')).not.toBe('tecnico')
  })
})
