/**
 * Fase 4 — Mantenimiento preventivo e historia clínica.
 * Spec: 02-DOCS/wiki/sdd/specs/fase-4-mantenimiento-preventivo.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  sumarDias, proximaFecha, estadoPlan, hoyLocal, estadoPreventivoMaquina, lunesDeSemana,
  agruparHistoria, totalesHistoria, filasHistoria, DIAS_AVISO_PROXIMO, type EventoHistoria,
} from '@/lib/domain/mantenimiento'
import { gastoMantenimiento } from '@/lib/domain/finance'
import { ejecutarRpcMantenimiento } from '@/lib/supabase/mockRpcMantenimiento'

describe('fechas del plan', () => {
  it('sumarDias sobre fechas sin hora, cruzando meses y años', () => {
    expect(sumarDias('2026-11-20', 15)).toBe('2026-12-05')
    expect(sumarDias('2026-12-25', 10)).toBe('2027-01-04')
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('próxima = (última vez o inicio) + frecuencia', () => {
    expect(proximaFecha({ fecha_inicio: '2026-11-01', ultima_fecha: null, frecuencia_dias: 15 })).toBe('2026-11-16')
    expect(proximaFecha({ fecha_inicio: '2026-11-01', ultima_fecha: '2026-11-20', frecuencia_dias: 15 })).toBe('2026-12-05')
  })

  it('estado: vencido si ya pasó, próximo si faltan 3 días o menos (incluido hoy), al día si no; inactivo si está desactivado', () => {
    const hoy = '2026-11-26'
    const plan = (inicio: string, activo = true) => ({ fecha_inicio: inicio, ultima_fecha: null, frecuencia_dias: 15, activo })
    expect(DIAS_AVISO_PROXIMO).toBe(3)
    expect(estadoPlan(plan('2026-11-06'), hoy)).toBe('vencido')   // próxima 21/11
    expect(estadoPlan(plan('2026-11-11'), hoy)).toBe('proximo')   // próxima 26/11 (hoy)
    expect(estadoPlan(plan('2026-11-14'), hoy)).toBe('proximo')   // próxima 29/11 (3 días)
    expect(estadoPlan(plan('2026-11-15'), hoy)).toBe('al_dia')    // próxima 30/11 (4 días)
    expect(estadoPlan(plan('2026-11-06', false), hoy)).toBe('inactivo')
  })

  it('aviso por máquina: el peor estado de sus planes activos', () => {
    const hoy = '2026-11-26'
    const planes = [
      { maquina_id: 'm1', fecha_inicio: '2026-11-15', ultima_fecha: null, frecuencia_dias: 15, activo: true },
      { maquina_id: 'm1', fecha_inicio: '2026-11-06', ultima_fecha: null, frecuencia_dias: 15, activo: true },
      { maquina_id: 'm2', fecha_inicio: '2026-11-06', ultima_fecha: null, frecuencia_dias: 15, activo: false },
    ]
    expect(estadoPreventivoMaquina(planes, 'm1', hoy)).toBe('vencido')
    expect(estadoPreventivoMaquina(planes, 'm2', hoy)).toBeNull()
    expect(estadoPreventivoMaquina(planes, 'm3', hoy)).toBeNull()
  })
})

describe('historia clínica', () => {
  const ev = (o: Partial<EventoHistoria>): EventoHistoria => ({
    maquina_id: 'm1', fecha: '2026-11-20', momento: '2026-11-20T10:00:00Z', tipo: 'produccion', turno: null,
    detalle: null, cantidad: null, costo: null, persona: null, mecanico: null, ...o,
  })
  const eventos = [
    ev({ fecha: '2026-11-23', momento: '2026-11-23T08:00:00Z', tipo: 'produccion', turno: 'dia', cantidad: 30, detalle: 'TST', persona: 'Rosa' }),
    ev({ fecha: '2026-11-24', momento: '2026-11-24T08:00:00Z', tipo: 'produccion', turno: 'noche', cantidad: 20, detalle: 'TST', persona: 'Luis' }),
    ev({ fecha: '2026-11-17', momento: '2026-11-17T08:00:00Z', tipo: 'produccion', turno: 'dia', cantidad: 10 }),
    ev({ fecha: '2026-11-24', momento: '2026-11-24T15:00:00Z', tipo: 'falla', detalle: 'Aguja rota', persona: 'Rosa' }),
    ev({ fecha: '2026-11-25', momento: '2026-11-25T10:00:00Z', tipo: 'reparacion', costo: 32, mecanico: 'Juan Pérez' }),
    ev({ fecha: '2026-11-25', momento: '2026-11-25T09:00:00Z', tipo: 'repuesto', detalle: 'Aguja', cantidad: 1, costo: 12, mecanico: 'Juan Pérez' }),
    ev({ fecha: '2026-11-26', momento: '2026-11-26T11:00:00Z', tipo: 'preventivo', detalle: 'Lubricar', costo: 40, mecanico: 'Juan Pérez' }),
  ]

  it('lunes de la semana (fechas sin hora)', () => {
    expect(lunesDeSemana('2026-11-26')).toBe('2026-11-23') // jueves
    expect(lunesDeSemana('2026-11-23')).toBe('2026-11-23') // lunes
    expect(lunesDeSemana('2026-11-29')).toBe('2026-11-23') // domingo
  })

  it('por día: todos los eventos, del más reciente al más antiguo', () => {
    const filas = agruparHistoria(eventos, 'dia')
    expect(filas.map(f => f.tipo)).toEqual(['preventivo', 'reparacion', 'repuesto', 'falla', 'produccion', 'produccion', 'produccion'])
  })

  it('por semana: la producción se suma por semana y turno; el resto sigue igual', () => {
    const filas = agruparHistoria(eventos, 'semana')
    const prod = filas.filter(f => f.tipo === 'produccion')
    expect(prod).toEqual([
      expect.objectContaining({ fecha: '2026-11-23', cantidad: 50, turno: null, detalle: 'Semana del 23/11/2026' }),
      expect.objectContaining({ fecha: '2026-11-16', cantidad: 10, detalle: 'Semana del 16/11/2026' }),
    ])
    expect(filas.filter(f => f.tipo !== 'produccion')).toHaveLength(4)
  })

  it('totales del período', () => {
    expect(totalesHistoria(eventos)).toEqual({
      docenas: 60, fallas: 1, reparaciones: 1, costoReparaciones: 32, costoRepuestos: 12, preventivos: 1, manoObraPreventivos: 40,
    })
  })

  it('filas para PDF y Excel, con etiquetas en español', () => {
    const [primera] = filasHistoria(agruparHistoria(eventos, 'dia'))
    expect(primera).toEqual({
      Fecha: '26/11/2026', Evento: 'Mantenimiento preventivo', Turno: '—', Detalle: 'Lubricar',
      Cantidad: null, 'Costo (S/)': 40, Persona: '—', Mecánico: 'Juan Pérez',
    })
    const prod = filasHistoria(agruparHistoria(eventos, 'dia')).find(f => f.Evento === 'Producción' && f.Turno === 'Noche')
    expect(prod).toMatchObject({ Cantidad: 20, Persona: 'Luis' })
  })
})

describe('gasto de mantenimiento con preventivos', () => {
  it('suma la mano de obra de reparaciones y de preventivos terminados', () => {
    expect(gastoMantenimiento([{ costo_mano_obra: 20 }], [{ costo_mano_obra: 40 }, { costo_mano_obra: '5.5' }])).toBe(65.5)
    expect(gastoMantenimiento([{ costo_mano_obra: 20 }])).toBe(20)
  })
})

// ── RPC del mock (mismas reglas que la migración 031) ───────────────────────
type Db = Record<string, any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = (db: Db, fn: string, p: object) => ejecutarRpcMantenimiento(db, fn, p)!

describe('mock: mantenimiento preventivo', () => {
  let db: Db
  beforeEach(() => {
    db = {
      maquinas: [
        { id: 'q1', codigo: 'T01', estado: 'activa' },
        { id: 'q2', codigo: 'T02', estado: 'ocupada' },
      ],
      planes_mantenimiento: [
        { id: 'p1', maquina_id: 'q1', tarea: 'Lubricar', frecuencia_dias: 15, fecha_inicio: '2026-01-01', ultima_fecha: null, activo: true },
        { id: 'p2', maquina_id: 'q2', tarea: 'Limpieza', frecuencia_dias: 7, fecha_inicio: '2026-01-01', ultima_fecha: null, activo: true },
        { id: 'p3', maquina_id: 'q1', tarea: 'Apagado', frecuencia_dias: 7, fecha_inicio: '2026-01-01', ultima_fecha: null, activo: false },
      ],
      mecanicos: [{ id: 'm1', nombre: 'Juan', apellido: 'Pérez', telefono: '9', activo: true }],
      repuestos: [{ id: 'r1', nombre: 'Aceite', stock_actual: 5, costo_unitario: 8 }],
      averias_maquinas: [],
      egresos_adicionales: [],
    }
  })

  it('iniciar → mantenimiento; repuestos; terminar → activa y el plan cuenta desde hoy', () => {
    expect(rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p1', p_mecanico_id: null }).error?.message).toContain('mecánico')
    const ini = rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p1', p_mecanico_id: 'm1' })
    expect(ini.error).toBeNull()
    expect(db.maquinas[0]).toMatchObject({ estado: 'mantenimiento', detalle_estado: 'MANTENIMIENTO PREVENTIVO' })
    expect(rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p1', p_mecanico_id: 'm1' }).error?.message).toContain('en curso')

    expect(rpc(db, 'usar_repuesto_en_mantenimiento', { p_mantenimiento_id: ini.data, p_repuesto_id: 'r1', p_cantidad: 6 }).error?.message)
      .toBe('Solo hay 5 unidades de Aceite; no se pueden usar 6')
    const uso = rpc(db, 'usar_repuesto_en_mantenimiento', { p_mantenimiento_id: ini.data, p_repuesto_id: 'r1', p_cantidad: 3 })
    expect(db.repuestos[0].stock_actual).toBe(2)
    rpc(db, 'quitar_repuesto_de_mantenimiento', { p_uso_id: uso.data })
    expect(db.repuestos[0].stock_actual).toBe(5)
    rpc(db, 'usar_repuesto_en_mantenimiento', { p_mantenimiento_id: ini.data, p_repuesto_id: 'r1', p_cantidad: 2 })

    expect(rpc(db, 'terminar_mantenimiento_preventivo', { p_mantenimiento_id: ini.data, p_nota: 'ok', p_costo_mano_obra: 40 }).error).toBeNull()
    expect(db.mantenimientos_preventivos[0]).toMatchObject({ estado: 'terminado', costo_mano_obra: 40, costo_repuestos: 16 })
    expect(db.planes_mantenimiento[0].ultima_fecha).toBe(hoyLocal())
    expect(db.maquinas[0]).toMatchObject({ estado: 'activa', detalle_estado: 'OPERATIVA' })
    expect(db.egresos_adicionales).toHaveLength(0)
    expect(rpc(db, 'terminar_mantenimiento_preventivo', { p_mantenimiento_id: ini.data, p_nota: '', p_costo_mano_obra: 1 }).error?.message).toContain('en curso')
  })

  it('no se inicia con la máquina malograda ni con un mecánico dado de baja', () => {
    db.maquinas[0].estado = 'malograda'
    expect(rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p1', p_mecanico_id: 'm1' }).error?.message).toContain('malograda')
    db.maquinas[0].estado = 'activa'
    db.mecanicos.push({ id: 'm2', nombre: 'Luis', apellido: 'Baja', telefono: '9', activo: false })
    expect(rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p1', p_mecanico_id: 'm2' }).error?.message).toContain('no está activo')
    expect(db.mantenimientos_preventivos ?? []).toHaveLength(0)
  })

  it('terminado: no se usan ni quitan repuestos; mano de obra inválida rechazada', () => {
    const ini = rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p1', p_mecanico_id: 'm1' })
    const uso = rpc(db, 'usar_repuesto_en_mantenimiento', { p_mantenimiento_id: ini.data, p_repuesto_id: 'r1', p_cantidad: 1 })
    for (const [v, msg] of [[-1, 'negativa'], ['NaN', 'no es un número'], [1000000.01, '1 000 000']] as const) {
      expect(rpc(db, 'terminar_mantenimiento_preventivo', { p_mantenimiento_id: ini.data, p_nota: '', p_costo_mano_obra: v }).error?.message).toContain(msg)
    }
    rpc(db, 'terminar_mantenimiento_preventivo', { p_mantenimiento_id: ini.data, p_nota: '', p_costo_mano_obra: 10 })
    expect(rpc(db, 'usar_repuesto_en_mantenimiento', { p_mantenimiento_id: ini.data, p_repuesto_id: 'r1', p_cantidad: 1 }).error?.message).toContain('en curso')
    expect(rpc(db, 'quitar_repuesto_de_mantenimiento', { p_uso_id: uso.data }).error?.message).toContain('en curso')
    expect(db.repuestos[0].stock_actual).toBe(4)
  })

  it('no se inicia con la máquina ocupada, con una falla abierta ni con el plan desactivado', () => {
    expect(rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p2', p_mecanico_id: 'm1' }).error?.message).toContain('ocupada')
    expect(db.maquinas[1].estado).toBe('ocupada')
    expect(rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p3', p_mecanico_id: 'm1' }).error?.message).toContain('desactivado')
    db.averias_maquinas.push({ id: 'a1', maquina_id: 'q1', estado: 'pendiente' })
    expect(rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p1', p_mecanico_id: 'm1' }).error?.message).toContain('falla')
    expect(db.maquinas[0].estado).toBe('activa')
  })
})

describe('mock: vista de historia', () => {
  it('construye una fila por evento, como la vista SQL', async () => {
    const { construirHistoriaMock } = await import('@/lib/supabase/mockHistoria')
    const db = {
      usuarios: [{ id: 'u1', nombre: 'Rosa' }],
      catalogo_medias: [{ id: 'c1', codigo: 'TST' }],
      turnos_produccion: [{ id: 't1', horario: 'noche', tejedor_id: 'u1' }],
      reportes_produccion: [{ turno_id: 't1', maquina_id: 'q1', catalogo_media_id: 'c1', docenas_producidas: 30, fecha: '2026-11-25', created_at: '2026-11-25T08:00:00Z' }],
      mecanicos: [{ id: 'm1', nombre: 'Juan', apellido: 'Pérez' }],
      averias_maquinas: [{ id: 'a1', maquina_id: 'q1', descripcion_operador: 'Aguja rota', fecha_reporte: '2026-11-24T15:00:00Z', reportado_por_id: 'u1', mecanico_id: 'm1' }],
      reparaciones: [{ averia_id: 'a1', descripcion_tecnico: 'Cambio', costo_repuestos: 12, costo_mano_obra: 20, mecanico_id: 'm1', fecha_reparacion: '2026-11-25T10:00:00Z' }],
      planes_mantenimiento: [{ id: 'p1', tarea: 'Lubricar' }],
      mantenimientos_preventivos: [{ id: 'mp1', plan_id: 'p1', maquina_id: 'q1', mecanico_id: 'm1', estado: 'terminado', fecha_inicio: '2026-11-26T09:00:00Z', fecha_fin: '2026-11-26T11:00:00Z', nota: 'ok', costo_mano_obra: 40 }],
      repuestos: [{ id: 'r1', nombre: 'Aceite' }],
      mantenimiento_repuestos: [{ mantenimiento_id: 'mp1', repuesto_id: 'r1', cantidad: 2, costo_unitario: 8, created_at: '2026-11-26T10:00:00Z' }],
    }
    const h = construirHistoriaMock(db)
    expect(h.find(e => e.tipo === 'produccion')).toMatchObject({ cantidad: 30, turno: 'noche', persona: 'Rosa', detalle: 'TST' })
    expect(h.find(e => e.tipo === 'falla')).toMatchObject({ detalle: 'Aguja rota', persona: 'Rosa', mecanico: 'Juan Pérez' })
    expect(h.find(e => e.tipo === 'reparacion')).toMatchObject({ costo: 32, mecanico: 'Juan Pérez' })
    expect(h.find(e => e.tipo === 'preventivo')).toMatchObject({ costo: 40, detalle: 'Lubricar — ok' })
    expect(h.find(e => e.tipo === 'repuesto')).toMatchObject({ detalle: 'Aceite', cantidad: 2, costo: 16 })
  })
})

describe('mock: lectura por páginas y tope de mano de obra', () => {
  it('range(desde, hasta) devuelve esas filas, con el orden aplicado antes', async () => {
    const { createMockClient } = await import('@/lib/supabase/mockDb')
    const g = globalThis as unknown as { localStorage?: Storage }
    if (!g.localStorage) return // la base mock del navegador no está disponible en este entorno
    const cliente = createMockClient()
    const a = await cliente.from('usuarios').select('*').order('id', { ascending: true }).range(0, 1)
    const b = await cliente.from('usuarios').select('*').order('id', { ascending: true }).range(2, 3)
    expect(a.data).toHaveLength(2)
    if ((b.data ?? []).length) expect(b.data![0].id).not.toBe(a.data![0].id)
  })

  it('1 000 000 exacto se acepta', () => {
    const db: Db = {
      maquinas: [{ id: 'q1', codigo: 'T01', estado: 'activa' }],
      planes_mantenimiento: [{ id: 'p1', maquina_id: 'q1', tarea: 'X', frecuencia_dias: 7, fecha_inicio: '2026-01-01', ultima_fecha: null, activo: true }],
      mecanicos: [{ id: 'm1', nombre: 'Juan', apellido: 'Pérez', telefono: '9', activo: true }],
      averias_maquinas: [],
    }
    const ini = rpc(db, 'iniciar_mantenimiento_preventivo', { p_plan_id: 'p1', p_mecanico_id: 'm1' })
    expect(rpc(db, 'terminar_mantenimiento_preventivo', { p_mantenimiento_id: ini.data, p_nota: '', p_costo_mano_obra: 1000000 }).error).toBeNull()
  })
})
