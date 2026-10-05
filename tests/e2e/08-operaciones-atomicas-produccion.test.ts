/**
 * Operaciones atómicas de Producción y Averías (migración 021).
 *
 * Ejecuta la emulación local real (lib/supabase/mockRpcProduccion.ts), que es
 * la que usa la app en modo mock. Las mismas reglas se prueban contra Postgres
 * en supabase/tests/021_rpc_produccion_y_averias.test.sql.
 *
 * El test FALLA si:
 *   - Un error deja cambios a medias (turno sin máquinas, hilo descontado, etc.)
 *   - Se puede tomar una máquina que no está libre o sin hilo suficiente
 *   - Al reportar una avería, las otras máquinas del lote quedan 'ocupada'
 *   - Se puede cerrar dos veces un turno o saltar pasos de la reparación
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ejecutarRpcProduccion } from '@/lib/supabase/mockRpcProduccion'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- filas mock sin tipar
type Db = Record<string, any[]>
let db: Db

function rpc(fn: string, params: Record<string, unknown>) {
  return ejecutarRpcProduccion(db, fn, params)!
}

function lote(maquinas: string[]) {
  return rpc('cargar_lote_produccion', {
    p_tejedor_id: 'tej1',
    p_horario: 'dia',
    p_duracion_horas: 12,
    p_asignaciones: maquinas.map(id => ({ maquina_id: id, catalogo_media_id: 'media1' })),
  })
}

beforeEach(() => {
  db = {
    usuarios: [{ id: 'tej1', nombre: 'Tejedor', rol: 'tejedor', activo: true, estado: 'disponible' }],
    materia_prima: [{ id: 'mp1', material: 'Algodón', color: 'Blanco', stock_kg: 20 }],
    catalogo_medias: [{ id: 'media1', codigo: 'TST-1', peso_docena_g: 400, materia_prima_id: 'mp1' }],
    maquinas: [
      { id: 'm1', codigo: 'M01', estado: 'activa' },
      { id: 'm2', codigo: 'M02', estado: 'activa' },
      { id: 'm3', codigo: 'M03', estado: 'mantenimiento' },
    ],
    turnos_produccion: [],
    turno_maquinas: [],
    movimientos_materia_prima: [],
    reportes_produccion: [],
    averias_maquinas: [],
    reparaciones: [],
  }
})

describe('cargar_lote_produccion', () => {
  it('crea turno, descuenta hilo (15 doc × 0.4 kg por máquina) y ocupa máquinas y tejedor', () => {
    const r = lote(['m1', 'm2'])
    expect(r.error).toBeNull()
    expect(db.materia_prima[0].stock_kg).toBeCloseTo(8)
    expect(db.movimientos_materia_prima).toHaveLength(1)
    expect(db.movimientos_materia_prima[0].referencia_id).toBe(r.data)
    expect(db.turno_maquinas).toHaveLength(2)
    expect(db.maquinas.filter(m => m.estado === 'ocupada')).toHaveLength(2)
    expect(db.usuarios[0].estado).toBe('ocupada')
  })

  it('[NEGOCIO] con hilo insuficiente NO deja nada escrito (antes quedaba el turno creado)', () => {
    db.materia_prima[0].stock_kg = 5
    const antes = structuredClone(db)
    const r = lote(['m1', 'm2'])
    expect(r.error?.message).toContain('Falta de materia prima')
    expect(db).toEqual(antes)
  })

  it('[NEGOCIO] BLOQUEA máquinas que no están libres', () => {
    expect(lote(['m3']).error?.message).toContain('M03 no está disponible')
    lote(['m1'])
    expect(lote(['m1']).error?.message).toContain('M01 no está disponible')
  })

  it('[NEGOCIO] BLOQUEA sin tejedor o sin código de media', () => {
    expect(rpc('cargar_lote_produccion', { p_asignaciones: [{ maquina_id: 'm1', catalogo_media_id: 'media1' }] }).error?.message)
      .toContain('operador de turno')
    expect(rpc('cargar_lote_produccion', { p_tejedor_id: 'tej1', p_asignaciones: [{ maquina_id: 'm1', catalogo_media_id: '' }] }).error?.message)
      .toContain('código de media')
  })
})

describe('cerrar_turno_produccion', () => {
  it('registra reportes, cierra el turno y libera máquinas y tejedor', () => {
    const turnoId = lote(['m1', 'm2']).data
    const r = rpc('cerrar_turno_produccion', { p_turno_id: turnoId, p_reportes: [{ maquina_id: 'm1', docenas: 14.5 }] })
    expect(r.error).toBeNull()
    expect(db.reportes_produccion.map(x => x.docenas_producidas).sort()).toEqual([0, 14.5])
    expect(db.turnos_produccion[0].estado).toBe('cerrado')
    expect(db.maquinas.filter(m => m.estado === 'activa')).toHaveLength(2)
    expect(db.usuarios[0].estado).toBe('disponible')
  })

  it('[NEGOCIO] BLOQUEA cerrar dos veces el mismo turno', () => {
    const turnoId = lote(['m1']).data
    rpc('cerrar_turno_produccion', { p_turno_id: turnoId, p_reportes: [] })
    expect(rpc('cerrar_turno_produccion', { p_turno_id: turnoId, p_reportes: [] }).error?.message).toContain('ya fue cerrado')
  })
})

describe('reportar_averia_maquina', () => {
  it('cierra el turno y libera TAMBIÉN las otras máquinas del lote (antes quedaban ocupadas)', () => {
    lote(['m1', 'm2'])
    const r = rpc('reportar_averia_maquina', {
      p_maquina_id: 'm1', p_tipo_averia: 'MECÁNICA', p_descripcion: 'Rotura de aguja', p_asignado_a: 'alexander',
    })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ turnos_cerrados: 1 })
    expect(db.maquinas.find(m => m.id === 'm1')).toMatchObject({ estado: 'malograda', detalle_estado: 'FALLA MECÁNICA' })
    expect(db.maquinas.find(m => m.id === 'm2')?.estado).toBe('activa')
    expect(db.usuarios[0].estado).toBe('disponible')
    expect(db.averias_maquinas[0]).toMatchObject({ estado: 'pendiente', asignado_a: 'alexander' })
  })

  it('[NEGOCIO] BLOQUEA sin descripción, en mantenimiento o con avería activa', () => {
    expect(rpc('reportar_averia_maquina', { p_maquina_id: 'm1', p_descripcion: ' ' }).error?.message).toContain('descripción')
    expect(rpc('reportar_averia_maquina', { p_maquina_id: 'm3', p_descripcion: 'x' }).error?.message).toContain('estado mantenimiento')
    rpc('reportar_averia_maquina', { p_maquina_id: 'm1', p_descripcion: 'x' })
    expect(rpc('reportar_averia_maquina', { p_maquina_id: 'm1', p_descripcion: 'y' }).error?.message).toContain('avería activo')
  })
})

describe('reparación (iniciar → registrar)', () => {
  it('ciclo completo deja la máquina activa y OPERATIVA con costo total', () => {
    const averiaId = (rpc('reportar_averia_maquina', { p_maquina_id: 'm1', p_descripcion: 'x' }).data as { averia_id: string }).averia_id

    expect(rpc('registrar_reparacion_averia', { p_averia_id: averiaId, p_descripcion_tecnico: 'ok' }).error?.message)
      .toContain('Primero inicia la reparación')

    expect(rpc('iniciar_reparacion_averia', { p_averia_id: averiaId }).error).toBeNull()
    expect(db.maquinas[0].estado).toBe('mantenimiento')
    expect(rpc('iniciar_reparacion_averia', { p_averia_id: averiaId }).error?.message).toContain('avería pendiente')

    expect(rpc('registrar_reparacion_averia', { p_averia_id: averiaId, p_descripcion_tecnico: ' ' }).error?.message).toContain('diagnóstico')
    const r = rpc('registrar_reparacion_averia', {
      p_averia_id: averiaId, p_descripcion_tecnico: 'Cambio de aguja', p_costo_repuestos: 30, p_costo_mano_obra: 20,
    })
    expect(r.error).toBeNull()
    expect(db.reparaciones[0].costo_total).toBe(50)
    expect(db.averias_maquinas[0].estado).toBe('resuelto')
    expect(db.maquinas[0]).toMatchObject({ estado: 'activa', detalle_estado: 'OPERATIVA' })
  })
})

it('devuelve null para funciones que no son de este módulo', () => {
  expect(ejecutarRpcProduccion(db, 'finalizar_lote_remallado', {})).toBeNull()
})
