/**
 * E2E Test: Cambio de Turno de Operador
 *
 * Flujo correcto del negocio (fuente de verdad):
 *   La tabla `asignaciones_turno` determina qué operador trabaja en qué área
 *   en cada fecha/turno. La restricción UNIQUE es (operador_id, fecha, turno).
 *
 *   Flujo de cambio de turno:
 *   1. Supervisor crea/modifica una asignación de turno para un operador
 *   2. Un operador NO puede tener dos asignaciones en el mismo turno del mismo día
 *   3. Un operador 'ocupada' NO debe ser reasignado hasta que quede 'disponible'
 *   4. Un supervisor puede reasignar un operador entre áreas entre turnos (dia/noche)
 *   5. Las áreas válidas: 'tejido','enlace','volteado','planchado','preparado','almacen'
 *   6. Los turnos válidos: 'dia' | 'noche'
 *
 * El test FALLA si:
 *   - Se crea asignación duplicada (mismo operador, fecha, turno)
 *   - Se asigna un área inválida
 *   - Se reasigna un operador que está 'ocupada' en un proceso activo
 *   - Un operario accede a un módulo sin asignación de turno
 */

import { describe, it, expect, beforeEach } from 'vitest'

type AreaTurno = 'tejido' | 'enlace' | 'volteado' | 'planchado' | 'preparado' | 'almacen'
type TipoTurno = 'dia' | 'noche'

type Asignacion = {
  id: string
  operador_id: string
  area: AreaTurno
  fecha: string
  turno: TipoTurno
}

type Operador = {
  id: string
  nombre: string
  rol: string
  estado: 'disponible' | 'ocupada' | 'en_reparacion'
}

const AREAS_VALIDAS: AreaTurno[] = ['tejido', 'enlace', 'volteado', 'planchado', 'preparado', 'almacen']
const TURNOS_VALIDOS: TipoTurno[] = ['dia', 'noche']
const HOY = '2026-08-22'

function crearServicioTurnos(inicial: { operadores: Operador[]; asignaciones: Asignacion[] }) {
  const db = {
    operadores: [...inicial.operadores],
    asignaciones: [...inicial.asignaciones],
  }
  let seq = 100

  return {
    db,

    /** Crea o reasigna un operador a un área para una fecha/turno */
    asignarTurno(params: {
      operador_id: string
      area: string
      fecha: string
      turno: string
    }): { ok: boolean; error?: string; asignacion?: Asignacion } {
      const { operador_id, area, fecha, turno } = params

      // Validar área válida
      if (!AREAS_VALIDAS.includes(area as AreaTurno)) {
        return { ok: false, error: `Área inválida: '${area}'. Áreas permitidas: ${AREAS_VALIDAS.join(', ')}` }
      }

      // Validar turno válido
      if (!TURNOS_VALIDOS.includes(turno as TipoTurno)) {
        return { ok: false, error: `Turno inválido: '${turno}'. Turnos permitidos: dia, noche` }
      }

      // Verificar que el operador existe
      const op = db.operadores.find(o => o.id === operador_id)
      if (!op) return { ok: false, error: `Operador ${operador_id} no encontrado` }

      // Regla de negocio: no reasignar un operador que está ocupado en un proceso
      if (op.estado === 'ocupada') {
        return { ok: false, error: `El operador '${op.nombre}' está actualmente ocupado en un proceso. Espera que termine su tarea actual.` }
      }

      // Regla UNIQUE: mismo operador, misma fecha, mismo turno
      const duplicado = db.asignaciones.find(
        a => a.operador_id === operador_id && a.fecha === fecha && a.turno === turno
      )
      if (duplicado) {
        return { ok: false, error: `El operador ya tiene asignación en turno '${turno}' del ${fecha} (área: ${duplicado.area}). Elimina la asignación anterior primero.` }
      }

      const nueva: Asignacion = {
        id: `asig-${seq++}`,
        operador_id,
        area: area as AreaTurno,
        fecha,
        turno: turno as TipoTurno,
      }
      db.asignaciones.push(nueva)
      return { ok: true, asignacion: nueva }
    },

    /** Elimina una asignación (para reemplazarla) */
    eliminarAsignacion(params: {
      operador_id: string
      fecha: string
      turno: string
    }): { ok: boolean; error?: string } {
      const idx = db.asignaciones.findIndex(
        a => a.operador_id === params.operador_id && a.fecha === params.fecha && a.turno === params.turno
      )
      if (idx === -1) return { ok: false, error: 'Asignación no encontrada' }
      db.asignaciones.splice(idx, 1)
      return { ok: true }
    },

    /** Consulta qué operadores están asignados a un área en una fecha/turno */
    obtenerOperadoresPorArea(params: {
      area: AreaTurno
      fecha: string
      turno: TipoTurno
    }): Operador[] {
      const asignaciones = db.asignaciones.filter(
        a => a.area === params.area && a.fecha === params.fecha && a.turno === params.turno
      )
      return asignaciones
        .map(a => db.operadores.find(o => o.id === a.operador_id))
        .filter(Boolean) as Operador[]
    },

    /** Verifica si un operador tiene acceso a un módulo en la fecha/turno actual */
    tieneAccesoAlModulo(params: {
      operador_id: string
      modulo: string // 'produccion' | 'remallado' | 'volteado' | 'planchado' | 'preparado' | 'almacen'
      fecha: string
      turno: TipoTurno
    }): boolean {
      const moduloAArea: Record<string, AreaTurno> = {
        produccion: 'tejido',
        remallado: 'enlace',
        volteado: 'volteado',
        planchado: 'planchado',
        preparado: 'preparado',
        almacen: 'almacen',
      }
      const areaRequerida = moduloAArea[params.modulo]
      if (!areaRequerida) return false
      return db.asignaciones.some(
        a =>
          a.operador_id === params.operador_id &&
          a.area === areaRequerida &&
          a.fecha === params.fecha &&
          a.turno === params.turno
      )
    },
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OPERADORES_FIXTURE: Operador[] = [
  { id: 'op1', nombre: 'Carlos Multifuncional', rol: 'operador', estado: 'disponible' },
  { id: 'op2', nombre: 'Ana Enlace', rol: 'operador', estado: 'disponible' },
  { id: 'op3', nombre: 'Pedro Ocupado', rol: 'operador', estado: 'ocupada' }, // Ya está trabajando
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Flujo 2: Cambio de turno de operador', () => {
  let servicio: ReturnType<typeof crearServicioTurnos>

  beforeEach(() => {
    servicio = crearServicioTurnos({
      operadores: JSON.parse(JSON.stringify(OPERADORES_FIXTURE)),
      asignaciones: [
        // op2 ya tiene asignación de enlace en turno dia de hoy
        { id: 'asig-inicial', operador_id: 'op2', area: 'enlace', fecha: HOY, turno: 'dia' },
      ],
    })
  })

  // ── CAMINO FELIZ ────────────────────────────────────────────────────────────

  it('asigna un operador a un área válida correctamente', () => {
    const result = servicio.asignarTurno({
      operador_id: 'op1',
      area: 'volteado',
      fecha: HOY,
      turno: 'dia',
    })

    expect(result.ok).toBe(true)
    expect(result.asignacion?.area).toBe('volteado')
    expect(result.asignacion?.turno).toBe('dia')
  })

  it('un operador puede tener asignaciones en turnos distintos el mismo día', () => {
    // Turno de día: tejido
    servicio.asignarTurno({ operador_id: 'op1', area: 'tejido', fecha: HOY, turno: 'dia' })
    // Turno de noche: volteado (mismo día, distinto turno → permitido)
    const result = servicio.asignarTurno({ operador_id: 'op1', area: 'volteado', fecha: HOY, turno: 'noche' })

    expect(result.ok).toBe(true)
  })

  it('obtiene correctamente la lista de operadores asignados a un área', () => {
    servicio.asignarTurno({ operador_id: 'op1', area: 'tejido', fecha: HOY, turno: 'dia' })

    const tejedores = servicio.obtenerOperadoresPorArea({ area: 'tejido', fecha: HOY, turno: 'dia' })
    expect(tejedores).toHaveLength(1)
    expect(tejedores[0].id).toBe('op1')
  })

  it('permite reasignar un área si se elimina la asignación anterior primero', () => {
    // op2 tiene enlace/dia → eliminar y reasignar a planchado/dia
    servicio.eliminarAsignacion({ operador_id: 'op2', fecha: HOY, turno: 'dia' })
    const result = servicio.asignarTurno({ operador_id: 'op2', area: 'planchado', fecha: HOY, turno: 'dia' })

    expect(result.ok).toBe(true)
    expect(result.asignacion?.area).toBe('planchado')
  })

  it('operador con asignación de tejido tiene acceso al módulo "produccion"', () => {
    servicio.asignarTurno({ operador_id: 'op1', area: 'tejido', fecha: HOY, turno: 'dia' })

    const tieneAcceso = servicio.tieneAccesoAlModulo({
      operador_id: 'op1',
      modulo: 'produccion',
      fecha: HOY,
      turno: 'dia',
    })

    expect(tieneAcceso).toBe(true)
  })

  it('operador asignado a tejido NO tiene acceso al módulo "remallado"', () => {
    servicio.asignarTurno({ operador_id: 'op1', area: 'tejido', fecha: HOY, turno: 'dia' })

    const tieneAcceso = servicio.tieneAccesoAlModulo({
      operador_id: 'op1',
      modulo: 'remallado',
      fecha: HOY,
      turno: 'dia',
    })

    expect(tieneAcceso).toBe(false)
  })

  // ── CAMINOS DE FALLA ────────────────────────────────────────────────────────

  it('[NEGOCIO] BLOQUEA asignación duplicada: mismo operador, fecha y turno', () => {
    // op2 ya tiene enlace/dia (fixture)
    const result = servicio.asignarTurno({
      operador_id: 'op2',
      area: 'planchado', // diferente área, mismo turno → viola UNIQUE
      fecha: HOY,
      turno: 'dia',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('ya tiene asignación')
  })

  it('[NEGOCIO] BLOQUEA asignación con área inválida', () => {
    const result = servicio.asignarTurno({
      operador_id: 'op1',
      area: 'cocina', // área que no existe en el sistema
      fecha: HOY,
      turno: 'dia',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Área inválida')
  })

  it('[NEGOCIO] BLOQUEA asignación con turno inválido', () => {
    const result = servicio.asignarTurno({
      operador_id: 'op1',
      area: 'tejido',
      fecha: HOY,
      turno: 'tarde', // no existe turno 'tarde'
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Turno inválido')
  })

  it('[NEGOCIO] BLOQUEA reasignar un operador que está actualmente ocupado', () => {
    // op3 está en estado 'ocupada' (activo en algún proceso)
    const result = servicio.asignarTurno({
      operador_id: 'op3',
      area: 'volteado',
      fecha: HOY,
      turno: 'dia',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('está actualmente ocupado')
  })

  it('[NEGOCIO] operador sin asignación de turno NO tiene acceso a ningún módulo', () => {
    // op1 no tiene asignaciones en el fixture inicial
    const tieneAccesoTejido = servicio.tieneAccesoAlModulo({
      operador_id: 'op1',
      modulo: 'produccion',
      fecha: HOY,
      turno: 'dia',
    })
    const tieneAccesoRemallado = servicio.tieneAccesoAlModulo({
      operador_id: 'op1',
      modulo: 'remallado',
      fecha: HOY,
      turno: 'dia',
    })

    expect(tieneAccesoTejido).toBe(false)
    expect(tieneAccesoRemallado).toBe(false)
  })
})
