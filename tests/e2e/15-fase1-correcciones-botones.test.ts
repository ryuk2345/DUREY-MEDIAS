/**
 * Fase 1 — correcciones y botones (migración 027).
 *
 * Ejecuta la emulación local real (mockRpcMateriaPrima / mockRpcLogistica) y las
 * funciones de dominio. Las mismas reglas se prueban contra Postgres en
 * supabase/tests/027_agencias_pagos_proveedores_almacenes.test.sql.
 *
 * El test FALLA si:
 *   - Un pago en efectivo no sale de la caja del día, o una transferencia sí sale
 *   - Una cuota se paga dos veces o se reprograma ya pagada
 *   - Se elimina un almacén con paquetes dentro
 *   - Las tarjetas de Máquinas filtran estados que no les corresponden
 *   - Copiar la asignación del día anterior carga máquinas que hoy no están activas
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ejecutarRpcMateriaPrima } from '@/lib/supabase/mockRpcMateriaPrima'
import { ejecutarRpcLogistica } from '@/lib/supabase/mockRpcLogistica'
import type { Db } from '@/lib/supabase/mockRpcComun'
import { calcularEfectivoEsperadoCaja, resumirCuentasPorPagar } from '@/lib/domain/finance'
import { cantidadEnCaminoPorInsumo } from '@/lib/domain/inventario'
import { filtrarMaquinasPorGrupo, GRUPOS_ESTADO_MAQUINA } from '@/lib/domain/machines'
import { construirCopiaAsignacion, type TurnoPrevio } from '@/lib/domain/tejido'

const hoy = () => new Date().toISOString().split('T')[0]
let db: Db

const rpc = (fn: string, params: Record<string, unknown>) =>
  (ejecutarRpcMateriaPrima(db, fn, params) ?? ejecutarRpcLogistica(db, fn, params))!

beforeEach(() => {
  db = {
    proveedores: [{ id: 'prov1', nombre: 'Hilos SAC' }],
    materia_prima: [{ id: 'mp1', material: 'Algodón', color: 'Blanco', stock_kg: 0, tipo_empaque: 'cono' }],
    compras_materia_prima: [], cuotas_compras: [], movimientos_materia_prima: [], pagos_proveedores: [],
    cajas_diarias: [{ id: 'caja1', asesora_id: null, fecha: hoy(), saldo_inicial: 500, ventas_efectivo: 0, cobros_efectivo: 0, pagos_efectivo: 0, estado: 'abierta' }],
    agencias: [{ id: 'ag1', nombre: 'Shalom', activo: true }],
    ubicaciones: [{ id: 'u1', nombre: 'Salón A', tipo: 'salon', activo: true }, { id: 'u2', nombre: 'Salón B', tipo: 'salon', activo: true }],
    paquetes: [],
  }
})

function compraACredito(cuotas = 3, total = 300) {
  const r = rpc('registrar_compra_materia_prima', {
    p_proveedor_id: 'prov1', p_materia_prima_id: 'mp1', p_cantidad_kg: 10, p_costo_total: total,
    p_condicion_pago: 'pago_diferido', p_metodo_pago: 'Transferencia', p_cuotas_num: cuotas,
  })
  expect(r.error).toBeNull()
  return db.cuotas_compras.filter(q => q.compra_id === r.data)
}

describe('Materia prima: la compra a crédito se ve en cuotas y en "en camino"', () => {
  it('[NEGOCIO] la compra pendiente NO suma stock, pero aparece como "en camino" y con sus cuotas', () => {
    const cuotas = compraACredito()
    expect(cuotas).toHaveLength(3)
    expect(db.materia_prima[0].stock_kg).toBe(0)
    expect(cantidadEnCaminoPorInsumo(db.compras_materia_prima)).toEqual({ mp1: 10 })
  })

  it('al aprobar el control de calidad deja de estar "en camino" y entra al stock', () => {
    compraACredito()
    rpc('procesar_control_calidad_compra', { p_compra_id: db.compras_materia_prima[0].id, p_aprobar: true })
    expect(db.materia_prima[0].stock_kg).toBe(10)
    expect(cantidadEnCaminoPorInsumo(db.compras_materia_prima)).toEqual({})
  })
})

describe('registrar_pago_proveedor', () => {
  it('[NEGOCIO] efectivo de hoy: sale de la caja del día y queda en el historial', () => {
    const [q1] = compraACredito()
    const r = rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'efectivo' })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ descontado_de_caja: true, caja_id: 'caja1', monto: 100 })
    expect(db.cajas_diarias[0].pagos_efectivo).toBe(100)
    expect(calcularEfectivoEsperadoCaja(db.cajas_diarias[0])).toBe(400)
    expect(q1).toMatchObject({ estado: 'pagada', fecha_pago: hoy(), metodo_pago: 'Efectivo' })
    expect(db.pagos_proveedores).toHaveLength(1)
    expect(db.pagos_proveedores[0]).toMatchObject({ proveedor_id: 'prov1', monto: 100, metodo_pago: 'efectivo', caja_id: 'caja1' })
  })

  it('[NEGOCIO] transferencia: solo historial, la caja no cambia', () => {
    const [q1] = compraACredito()
    const r = rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'transferencia' })
    expect(r.data).toMatchObject({ descontado_de_caja: false, caja_id: null })
    expect(db.cajas_diarias[0].pagos_efectivo).toBe(0)
    expect(db.pagos_proveedores[0].caja_id).toBeNull()
  })

  it('efectivo sin caja abierta: el pago queda en el historial (igual que los cobros)', () => {
    db.cajas_diarias = []
    const [q1] = compraACredito()
    const r = rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'efectivo' })
    expect(r.data).toMatchObject({ descontado_de_caja: false })
    expect(db.pagos_proveedores).toHaveLength(1)
  })

  it('efectivo con fecha pasada: no toca la caja de hoy', () => {
    const [q1] = compraACredito()
    rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'efectivo', p_fecha: '2020-01-01' })
    expect(db.cajas_diarias[0].pagos_efectivo).toBe(0)
    expect(db.pagos_proveedores[0].fecha).toBe('2020-01-01')
  })

  it('[NEGOCIO] BLOQUEA pagar dos veces la misma cuota (no se resta dos veces)', () => {
    const [q1] = compraACredito()
    rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'efectivo' })
    const r = rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'efectivo' })
    expect(r.error?.message).toContain('ya fue pagada')
    expect(db.cajas_diarias[0].pagos_efectivo).toBe(100)
    expect(db.pagos_proveedores).toHaveLength(1)
  })

  it('BLOQUEA método inválido y fecha futura', () => {
    const [q1] = compraACredito()
    expect(rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'bitcoin' }).error?.message).toContain('Método de pago inválido')
    expect(rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'efectivo', p_fecha: '2999-01-01' }).error?.message).toContain('no puede ser futura')
    expect(q1.estado).toBe('pendiente')
  })
})

describe('reprogramar_cuota_compra', () => {
  it('cambia la fecha de una cuota pendiente', () => {
    const [, , q3] = compraACredito()
    expect(rpc('reprogramar_cuota_compra', { p_cuota_id: q3.id, p_fecha_vencimiento: '2030-05-10' }).error).toBeNull()
    expect(q3.fecha_vencimiento).toBe('2030-05-10')
  })
  it('[NEGOCIO] BLOQUEA reprogramar una cuota pagada', () => {
    const [q1] = compraACredito()
    rpc('registrar_pago_proveedor', { p_cuota_id: q1.id, p_metodo_pago: 'transferencia' })
    expect(rpc('reprogramar_cuota_compra', { p_cuota_id: q1.id, p_fecha_vencimiento: '2030-05-10' }).error?.message).toContain('pagada no se puede reprogramar')
  })
})

describe('Cuentas por pagar: resumen de las cards', () => {
  it('separa vencido, esta semana y este mes; ignora lo pagado', () => {
    const r = resumirCuentasPorPagar([
      { monto: 50, fecha_vencimiento: '2026-11-20', estado: 'pendiente' }, // vencida
      { monto: 100, fecha_vencimiento: '2026-11-25', estado: 'pendiente' }, // hoy
      { monto: 200, fecha_vencimiento: '2026-12-02', estado: 'pendiente' }, // +7
      { monto: 300, fecha_vencimiento: '2026-12-20', estado: 'pendiente' }, // +25
      { monto: 400, fecha_vencimiento: '2027-02-01', estado: 'pendiente' }, // lejos
      { monto: 999, fecha_vencimiento: '2026-11-26', estado: 'pagada' },
    ], '2026-11-25')
    expect(r).toEqual({
      totalPendiente: 1050, vencido: 50, venceEstaSemana: 300, venceEsteMes: 600, cuotasPendientes: 5, cuotasVencidas: 1,
    })
  })
})

describe('Caja: efectivo esperado', () => {
  it('[NEGOCIO] resta los pagos a proveedores en efectivo', () => {
    expect(calcularEfectivoEsperadoCaja({ saldo_inicial: 100, ventas_efectivo: 50, cobros_efectivo: 25, pagos_efectivo: 30 })).toBe(145)
    expect(calcularEfectivoEsperadoCaja({ saldo_inicial: 100, ventas_efectivo: 50, cobros_efectivo: 25 })).toBe(175)
    expect(calcularEfectivoEsperadoCaja(null)).toBe(0)
  })
})

describe('Agencias', () => {
  it('registra una nueva y BLOQUEA duplicados (sin importar mayúsculas ni espacios)', () => {
    expect(rpc('registrar_agencia', { p_nombre: '  Cruz del Sur ' }).error).toBeNull()
    expect(db.agencias.map(a => a.nombre)).toContain('Cruz del Sur')
    expect(rpc('registrar_agencia', { p_nombre: 'shalom' }).error?.message).toContain('ya está registrada')
    expect(rpc('registrar_agencia', { p_nombre: '  ' }).error?.message).toContain('nombre de la agencia')
  })
  it('una agencia dada de baja se reactiva en lugar de duplicarse', () => {
    db.agencias[0].activo = false
    const r = rpc('registrar_agencia', { p_nombre: 'Shalom' })
    expect(r.data).toBe('ag1')
    expect(db.agencias).toHaveLength(1)
    expect(db.agencias[0].activo).toBe(true)
  })
})

describe('Almacenes: editar nombre y borrado suave', () => {
  it('renombra y BLOQUEA un nombre repetido', () => {
    expect(rpc('renombrar_ubicacion', { p_id: 'u1', p_nombre: ' Salón Norte ' }).error).toBeNull()
    expect(db.ubicaciones[0].nombre).toBe('Salón Norte')
    expect(rpc('renombrar_ubicacion', { p_id: 'u1', p_nombre: 'salón b' }).error?.message).toContain('Ya existe un almacén')
  })
  it('[NEGOCIO] BLOQUEA eliminar un almacén con paquetes dentro y lo explica', () => {
    db.paquetes.push({ id: 'p1', ubicacion_id: 'u1', estado: 'almacenado' }, { id: 'p2', ubicacion_id: 'u1', estado: 'pendiente_almacenar' })
    const r = rpc('desactivar_ubicacion', { p_id: 'u1' })
    expect(r.error?.message).toBe('No se puede eliminar Salón A: tiene 2 paquete(s) dentro. Muévelos o despáchalos primero.')
    expect(db.ubicaciones[0].activo).toBe(true)
  })
  it('[NEGOCIO] un almacén vacío (o solo con paquetes entregados) se oculta sin borrar su historial', () => {
    db.paquetes.push({ id: 'p1', ubicacion_id: 'u1', estado: 'entregado' })
    expect(rpc('desactivar_ubicacion', { p_id: 'u1' }).error).toBeNull()
    expect(db.ubicaciones[0].activo).toBe(false)
    expect(db.ubicaciones).toHaveLength(2)
    expect(db.paquetes[0].ubicacion_id).toBe('u1')
  })
})

describe('Máquinas: las tarjetas filtran', () => {
  const maquinas = ['activa', 'ocupada', 'malograda', 'mantenimiento', 'standby', 'inactiva'].map((estado, i) => ({ id: String(i), estado }))
  it('[NEGOCIO] cada tarjeta muestra solo sus estados; sin filtro, todas', () => {
    expect(filtrarMaquinasPorGrupo(maquinas, 'mantenimiento').map(m => m.estado)).toEqual(['mantenimiento'])
    expect(filtrarMaquinasPorGrupo(maquinas, 'operativa').map(m => m.estado)).toEqual(['activa', 'ocupada'])
    expect(filtrarMaquinasPorGrupo(maquinas, 'falla').map(m => m.estado)).toEqual(['malograda'])
    expect(filtrarMaquinasPorGrupo(maquinas, 'standby').map(m => m.estado)).toEqual(['standby', 'inactiva'])
    expect(filtrarMaquinasPorGrupo(maquinas, null)).toHaveLength(6)
  })
  it('los 4 grupos cubren todos los estados sin repetir', () => {
    const todos = Object.values(GRUPOS_ESTADO_MAQUINA).flatMap(g => g.estados)
    expect(new Set(todos).size).toBe(todos.length)
    expect(todos.sort()).toEqual(['activa', 'inactiva', 'malograda', 'mantenimiento', 'ocupada', 'standby'])
  })
})

describe('Tejido: copiar asignación del día anterior', () => {
  const maquinas = [
    { id: 'm1', codigo: 'M01', marca_id: 'mk1', estado: 'activa' },
    { id: 'm2', codigo: 'M02', marca_id: 'mk1', estado: 'malograda' },
    { id: 'm3', codigo: 'M03', marca_id: 'mk1', estado: 'activa' },
    { id: 'm4', codigo: 'M04', marca_id: 'mk2', estado: 'activa' },
  ]
  const catalogo = new Set(['c1', 'c2'])
  const turnos: TurnoPrevio[] = [
    { fecha: '2026-11-23', horario: 'dia', duracion_horas: 8, tejedor_id: 'viejo', turno_maquinas: [{ maquina_id: 'm1', catalogo_media_id: 'c2' }] },
    { fecha: '2026-11-24', horario: 'dia', duracion_horas: 12, tejedor_id: 't1', turno_maquinas: [
      { maquina_id: 'm1', catalogo_media_id: 'c1' },
      { maquina_id: 'm2', catalogo_media_id: 'c1' },
      { maquina_id: 'm3', catalogo_media_id: 'cX' },
    ] },
    { fecha: '2026-11-24', horario: 'dia', duracion_horas: 12, tejedor_id: 't2', turno_maquinas: [{ maquina_id: 'm4', catalogo_media_id: 'c2' }] },
    { fecha: '2026-11-24', horario: 'noche', duracion_horas: 12, tejedor_id: 't3', turno_maquinas: [{ maquina_id: 'm4', catalogo_media_id: 'c1' }] },
  ]

  it('[NEGOCIO] copia máquinas con su producto y el tejedor del último día, mismo horario', () => {
    const r = construirCopiaAsignacion(turnos, maquinas, catalogo, 'dia', 'mk1')
    expect(r.error).toBeNull()
    expect(r.copia).toMatchObject({ fecha: '2026-11-24', marca_id: 'mk1', tejedor_id: 't1', duracion_horas: '12', maquinas_seleccionadas: { m1: 'c1' } })
  })

  it('[NEGOCIO] NO copia máquinas que hoy no están activas ni productos inactivos; los informa', () => {
    const r = construirCopiaAsignacion(turnos, maquinas, catalogo, 'dia', 'mk1')
    expect(r.error).toBeNull()
    expect(r.copia!.maquinas_seleccionadas).not.toHaveProperty('m2')
    expect(r.copia!.maquinas_seleccionadas).not.toHaveProperty('m3')
    expect(r.copia!.omitidas).toEqual([
      { codigo: 'M02', motivo: 'está malograda' },
      { codigo: 'M03', motivo: 'su producto ya no está activo' },
    ])
  })

  it('respeta el horario y, sin marca elegida, toma la del primer turno', () => {
    const r = construirCopiaAsignacion(turnos, maquinas, catalogo, 'noche', null)
    expect(r.error).toBeNull()
    expect(r.copia).toMatchObject({ marca_id: 'mk2', tejedor_id: 't3', maquinas_seleccionadas: { m4: 'c1' } })
  })

  it('sin turnos anteriores, o sin la marca elegida, lo explica', () => {
    expect(construirCopiaAsignacion([], maquinas, catalogo, 'dia', null)).toEqual({ copia: null, error: 'No hay asignaciones anteriores del turno día para copiar' })
    const r = construirCopiaAsignacion(turnos, maquinas, catalogo, 'noche', 'mk1')
    expect(r.copia).toBeNull()
    expect(r.error).toContain('no hubo máquinas de esta marca')
  })
})

describe('Migración 027: checklist de AGENTS.md', () => {
  const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/027_agencias_pagos_proveedores_almacenes.sql'), 'utf-8')
  it('va dentro de BEGIN; ... COMMIT;', () => {
    expect(sql).toMatch(/^\s*BEGIN;/m)
    expect(sql.trim()).toMatch(/COMMIT;$/)
  })
  it('[NEGOCIO] tablas nuevas con RLS y la política de usuarios con sesión; nada para anon', () => {
    for (const t of ['agencias', 'pagos_proveedores']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)
      expect(sql).toContain(`CREATE POLICY durey_usuarios_con_sesion ON public.${t} FOR ALL TO authenticated`)
    }
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i)
  })
  it('migra los datos antes de crear la restricción de nombre único', () => {
    expect(sql.indexOf('INSERT INTO public.agencias')).toBeLessThan(sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS agencias_nombre_unico'))
  })
})
