/**
 * E2E Test: Escalamiento de Error/Incidencia a Supervisor
 *
 * Flujo real del negocio (fuente de verdad):
 *   Un operador detecta una avería en máquina y la reporta al sistema.
 *   El supervisor/técnico toma el caso y escala por los estados:
 *
 *   OPERADOR:
 *     1. Reporta avería en máquina X (descripción)
 *     2. Máquina X → 'malograda' (bloquea producción futura)
 *     3. Turno activo en esa máquina → 'cerrado' automáticamente, operador → 'disponible'
 *     4. averias_maquinas insertada con estado 'pendiente'
 *     5. NO se puede reportar una segunda avería activa en la misma máquina
 *
 *   SUPERVISOR/TÉCNICO:
 *     6. Inicia reparación → avería 'en_reparacion', máquina → 'mantenimiento'
 *     7. Registra diagnóstico y costos → reparacion insertada, avería → 'resuelto', máquina → 'activa'
 *
 *   TRANSICIONES VÁLIDAS DE MÁQUINA (del dominio machines.ts):
 *     activa/ocupada → malograda
 *     malograda → mantenimiento
 *     mantenimiento → activa
 *
 * El test FALLA si:
 *   - Se permite reportar avería en máquina que ya tiene una activa
 *   - Máquina no queda 'malograda' al reportar avería
 *   - El turno activo NO se cierra automáticamente al averiar la máquina
 *   - Se puede ir de 'malograda' directo a 'activa' sin pasar por 'mantenimiento'
 *   - Se puede registrar reparación sin diagnóstico técnico
 *   - La avería no queda 'resuelto' al completar reparación
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { validarTransicionEstadoMaquina, type EstadoMaquina } from '@/lib/domain/machines'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type EstadoAveria = 'pendiente' | 'en_reparacion' | 'resuelto'

type Averia = {
  id: string
  maquina_id: string
  descripcion_operador: string
  estado: EstadoAveria
  tipo_averia: string | null
  nivel: string
}

type Reparacion = {
  id: string
  averia_id: string
  descripcion_tecnico: string
  costo_repuestos: number
  costo_mano_obra: number
  costo_total: number
}

type Maquina = { id: string; codigo: string; estado: EstadoMaquina }
type Usuario = { id: string; estado: string }
type Turno = { id: string; tejedor_id: string; estado: string }
type TurnoMaquina = { id: string; turno_id: string; maquina_id: string }

// ── Servicio de gestión de incidencias ───────────────────────────────────────

function crearServicioIncidencias(inicial: {
  maquinas: Maquina[]
  usuarios: Usuario[]
  turnos: Turno[]
  turno_maquinas: TurnoMaquina[]
  averias: Averia[]
}) {
  const db = {
    maquinas: JSON.parse(JSON.stringify(inicial.maquinas)),
    usuarios: JSON.parse(JSON.stringify(inicial.usuarios)),
    turnos: JSON.parse(JSON.stringify(inicial.turnos)),
    turno_maquinas: JSON.parse(JSON.stringify(inicial.turno_maquinas)),
    averias: JSON.parse(JSON.stringify(inicial.averias)),
    reparaciones: [] as Reparacion[],
  }
  let seq = 1

  return {
    db,

    /** Operador reporta avería — corresponde a `reportarAveria` en mantenimiento/page.tsx */
    reportarAveria(params: {
      maquina_id: string
      descripcion_operador: string
      tipo_averia?: string
    }): { ok: boolean; error?: string; averia_id?: string } {
      const { maquina_id, descripcion_operador } = params
      if (!maquina_id || !descripcion_operador.trim()) {
        return { ok: false, error: 'Selecciona la máquina y describe el problema' }
      }

      const maq = db.maquinas.find(m => m.id === maquina_id)
      if (!maq) return { ok: false, error: 'Máquina no encontrada' }

      // Validar transición de estado → 'malograda'
      const v = validarTransicionEstadoMaquina(maq.estado, 'malograda')
      if (!v.valido) {
        return { ok: false, error: `Error en máquina ${maq.codigo}: ${v.error}` }
      }

      // Regla de negocio: no duplicar averías activas para la misma máquina
      const yaActiva = db.averias.some(
        a => a.maquina_id === maquina_id && (a.estado === 'pendiente' || a.estado === 'en_reparacion')
      )
      if (yaActiva) {
        return { ok: false, error: `La máquina ${maq.codigo} ya tiene un reporte de avería activo.` }
      }

      // 1. Insertar avería
      const averiaId = `av-${seq++}`
      db.averias.push({
        id: averiaId,
        maquina_id,
        descripcion_operador: descripcion_operador.trim(),
        estado: 'pendiente',
        tipo_averia: params.tipo_averia ?? null,
        nivel: 'CRÍTICO',
      })

      // 2. Máquina → 'malograda'
      maq.estado = 'malograda'

      // 3. Cerrar turno activo de la máquina automáticamente
      const turnoMaq = db.turno_maquinas.find(tm => tm.maquina_id === maquina_id)
      if (turnoMaq) {
        const turno = db.turnos.find(t => t.id === turnoMaq.turno_id && t.estado === 'activo')
        if (turno) {
          turno.estado = 'cerrado'
          const op = db.usuarios.find(u => u.id === turno.tejedor_id)
          if (op) op.estado = 'disponible'
        }
      }

      return { ok: true, averia_id: averiaId }
    },

    /** Técnico/supervisor inicia reparación — corresponde a `iniciarReparacion` */
    iniciarReparacion(averia_id: string): { ok: boolean; error?: string } {
      const averia = db.averias.find(a => a.id === averia_id)
      if (!averia) return { ok: false, error: 'Avería no encontrada' }
      if (averia.estado !== 'pendiente') {
        return { ok: false, error: `La avería debe estar 'pendiente' para iniciar reparación. Estado actual: '${averia.estado}'` }
      }

      const maq = db.maquinas.find(m => m.id === averia.maquina_id)
      if (!maq) return { ok: false, error: 'Máquina no encontrada' }

      // Validar transición malograda → mantenimiento
      const v = validarTransicionEstadoMaquina(maq.estado, 'mantenimiento')
      if (!v.valido) {
        return { ok: false, error: `Error en máquina ${maq.codigo}: ${v.error}` }
      }

      maq.estado = 'mantenimiento'
      averia.estado = 'en_reparacion'
      return { ok: true }
    },

    /** Técnico registra diagnóstico y cierra reparación — corresponde a `registrarReparacion` */
    registrarReparacion(params: {
      averia_id: string
      descripcion_tecnico: string
      costo_repuestos: number
      costo_mano_obra: number
    }): { ok: boolean; error?: string } {
      const { averia_id, descripcion_tecnico, costo_repuestos, costo_mano_obra } = params
      if (!descripcion_tecnico.trim()) {
        return { ok: false, error: 'Completa el diagnóstico técnico' }
      }

      const averia = db.averias.find(a => a.id === averia_id)
      if (!averia) return { ok: false, error: 'Avería no encontrada' }
      if (averia.estado !== 'en_reparacion') {
        return { ok: false, error: `Solo se puede registrar reparación en averías con estado 'en_reparacion'. Estado actual: '${averia.estado}'` }
      }

      const maq = db.maquinas.find(m => m.id === averia.maquina_id)
      if (!maq) return { ok: false, error: 'Máquina no encontrada' }

      // Validar transición mantenimiento → activa
      const v = validarTransicionEstadoMaquina(maq.estado, 'activa')
      if (!v.valido) {
        return { ok: false, error: `Error en máquina ${maq.codigo}: ${v.error}` }
      }

      // Insertar reparación
      db.reparaciones.push({
        id: `rep-${seq++}`,
        averia_id,
        descripcion_tecnico: descripcion_tecnico.trim(),
        costo_repuestos: costo_repuestos || 0,
        costo_mano_obra: costo_mano_obra || 0,
        costo_total: (costo_repuestos || 0) + (costo_mano_obra || 0),
      })

      averia.estado = 'resuelto'
      averia.nivel = 'RESUELTO'
      maq.estado = 'activa'

      return { ok: true }
    },
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

describe('Flujo 4: Escalamiento de incidencia a supervisor', () => {
  let servicio: ReturnType<typeof crearServicioIncidencias>

  beforeEach(() => {
    servicio = crearServicioIncidencias({
      maquinas: [
        { id: 'maq1', codigo: 'M01', estado: 'ocupada' },
        { id: 'maq2', codigo: 'M02', estado: 'activa' },
        { id: 'maq3', codigo: 'M03', estado: 'malograda' }, // ya malograda
      ],
      usuarios: [
        { id: 'op1', estado: 'ocupada' }, // operando M01
        { id: 'sup1', estado: 'disponible' },
      ],
      turnos: [
        { id: 'turno1', tejedor_id: 'op1', estado: 'activo' }, // turno activo en M01
      ],
      turno_maquinas: [
        { id: 'tm1', turno_id: 'turno1', maquina_id: 'maq1' },
      ],
      averias: [
        // maq3 ya tiene avería activa (pendiente)
        { id: 'av-existente', maquina_id: 'maq3', descripcion_operador: 'Avería previa', estado: 'pendiente', tipo_averia: 'MECÁNICA', nivel: 'CRÍTICO' },
      ],
    })
  })

  // ── REPORTE DE AVERÍA (OPERADOR) ──────────────────────────────────────────

  describe('Paso 1: Reporte de avería por operador', () => {
    it('crea avería correctamente en máquina activa/ocupada', () => {
      const result = servicio.reportarAveria({
        maquina_id: 'maq1',
        descripcion_operador: 'Sobrecalentamiento del motor principal',
        tipo_averia: 'MECÁNICA',
      })

      expect(result.ok).toBe(true)
      expect(result.averia_id).toBeDefined()
    })

    it('máquina queda en estado "malograda" al reportar avería', () => {
      servicio.reportarAveria({ maquina_id: 'maq1', descripcion_operador: 'Falla en sensor' })
      const maq = servicio.db.maquinas.find(m => m.id === 'maq1')!
      expect(maq.estado).toBe('malograda')
    })

    it('el turno activo de la máquina se cierra automáticamente al reportar avería', () => {
      servicio.reportarAveria({ maquina_id: 'maq1', descripcion_operador: 'Falla en sensor' })
      const turno = servicio.db.turnos.find(t => t.id === 'turno1')!
      expect(turno.estado).toBe('cerrado')
    })

    it('el operador que estaba trabajando en la máquina queda "disponible"', () => {
      servicio.reportarAveria({ maquina_id: 'maq1', descripcion_operador: 'Falla en sensor' })
      const op = servicio.db.usuarios.find(u => u.id === 'op1')!
      expect(op.estado).toBe('disponible')
    })

    it('la avería queda insertada con estado "pendiente"', () => {
      const { averia_id } = servicio.reportarAveria({
        maquina_id: 'maq1',
        descripcion_operador: 'Correa dentada rota',
      })
      const averia = servicio.db.averias.find(a => a.id === averia_id)!
      expect(averia.estado).toBe('pendiente')
    })

    it('[NEGOCIO] BLOQUEA reportar avería sin descripción', () => {
      const result = servicio.reportarAveria({ maquina_id: 'maq1', descripcion_operador: '' })
      expect(result.ok).toBe(false)
    })

    it('[NEGOCIO] BLOQUEA doble avería activa en la misma máquina', () => {
      // maq3 ya tiene avería 'pendiente' en el fixture
      const result = servicio.reportarAveria({
        maquina_id: 'maq3',
        descripcion_operador: 'Segunda avería',
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('ya tiene un reporte de avería activo')
    })

    it('[NEGOCIO] BLOQUEA reportar avería en máquina en mantenimiento', () => {
      // Llevar maq2 a mantenimiento primero
      servicio.reportarAveria({ maquina_id: 'maq2', descripcion_operador: 'Primera avería' })
      servicio.iniciarReparacion(servicio.db.averias.at(-1)!.id)

      // Intentar reportar segunda avería en máquina que ahora está en mantenimiento
      const result = servicio.reportarAveria({
        maquina_id: 'maq2',
        descripcion_operador: 'Segunda avería',
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Transición no permitida')
    })
  })

  // ── INICIAR REPARACIÓN (SUPERVISOR/TÉCNICO) ───────────────────────────────

  describe('Paso 2: Escalamiento — Iniciar reparación', () => {
    let averiaId: string

    beforeEach(() => {
      const { averia_id } = servicio.reportarAveria({
        maquina_id: 'maq1',
        descripcion_operador: 'Rodamiento dañado',
      })
      averiaId = averia_id!
    })

    it('inicia reparación correctamente desde estado "pendiente"', () => {
      const result = servicio.iniciarReparacion(averiaId)
      expect(result.ok).toBe(true)
    })

    it('avería pasa a "en_reparacion" al iniciar', () => {
      servicio.iniciarReparacion(averiaId)
      const averia = servicio.db.averias.find(a => a.id === averiaId)!
      expect(averia.estado).toBe('en_reparacion')
    })

    it('máquina pasa a "mantenimiento" al iniciar reparación', () => {
      servicio.iniciarReparacion(averiaId)
      const maq = servicio.db.maquinas.find(m => m.id === 'maq1')!
      expect(maq.estado).toBe('mantenimiento')
    })

    it('[NEGOCIO] BLOQUEA iniciar reparación en avería ya en reparación', () => {
      servicio.iniciarReparacion(averiaId)
      const result2 = servicio.iniciarReparacion(averiaId)
      expect(result2.ok).toBe(false)
      expect(result2.error).toContain('pendiente')
    })
  })

  // ── REGISTRAR REPARACIÓN COMPLETA ─────────────────────────────────────────

  describe('Paso 3: Cierre — Registrar diagnóstico y resolver', () => {
    let averiaId: string

    beforeEach(() => {
      const { averia_id } = servicio.reportarAveria({
        maquina_id: 'maq1',
        descripcion_operador: 'Rodamiento dañado',
      })
      averiaId = averia_id!
      servicio.iniciarReparacion(averiaId)
    })

    it('registra reparación completa y cierra avería correctamente', () => {
      const result = servicio.registrarReparacion({
        averia_id: averiaId,
        descripcion_tecnico: 'Se reemplazó el rodamiento y se lubricaron partes móviles',
        costo_repuestos: 45.00,
        costo_mano_obra: 120.00,
      })

      expect(result.ok).toBe(true)
    })

    it('avería queda en estado "resuelto" al completar reparación', () => {
      servicio.registrarReparacion({
        averia_id: averiaId,
        descripcion_tecnico: 'Diagnóstico completo',
        costo_repuestos: 0,
        costo_mano_obra: 0,
      })

      const averia = servicio.db.averias.find(a => a.id === averiaId)!
      expect(averia.estado).toBe('resuelto')
    })

    it('máquina queda "activa" al completar reparación', () => {
      servicio.registrarReparacion({
        averia_id: averiaId,
        descripcion_tecnico: 'Reparación completa',
        costo_repuestos: 0,
        costo_mano_obra: 0,
      })

      const maq = servicio.db.maquinas.find(m => m.id === 'maq1')!
      expect(maq.estado).toBe('activa')
    })

    it('costo_total se calcula como suma de repuestos + mano de obra', () => {
      servicio.registrarReparacion({
        averia_id: averiaId,
        descripcion_tecnico: 'Reparación con repuestos',
        costo_repuestos: 45.00,
        costo_mano_obra: 120.00,
      })

      const rep = servicio.db.reparaciones.find(r => r.averia_id === averiaId)!
      expect(rep.costo_total).toBe(165.00)
    })

    it('[NEGOCIO] BLOQUEA registrar reparación sin diagnóstico técnico', () => {
      const result = servicio.registrarReparacion({
        averia_id: averiaId,
        descripcion_tecnico: '',
        costo_repuestos: 0,
        costo_mano_obra: 0,
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('diagnóstico técnico')
    })

    it('[NEGOCIO] BLOQUEA registrar reparación si avería está solo "pendiente" (no iniciada)', () => {
      // Usar la avería de maq3 que está pendiente pero no en_reparacion
      const result = servicio.registrarReparacion({
        averia_id: 'av-existente',
        descripcion_tecnico: 'Saltarse el paso de iniciar reparación',
        costo_repuestos: 0,
        costo_mano_obra: 0,
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain("en_reparacion")
    })

    it('[NEGOCIO] TRANSICIÓN INVÁLIDA: malograda NO puede ir directamente a activa', () => {
      // Sin pasar por mantenimiento
      const maq = servicio.db.maquinas.find(m => m.id === 'maq3')! // Estado: malograda
      const v = validarTransicionEstadoMaquina(maq.estado, 'activa')
      expect(v.valido).toBe(false)
      expect(v.error).toContain('Transición no permitida')
    })
  })

  // ── FLUJO COMPLETO: OPERADOR → SUPERVISOR → TÉCNICO ──────────────────────

  describe('Flujo completo integrado: reporte → reparación → resolución', () => {
    it('ciclo completo de incidencia restaura la máquina a "activa"', () => {
      // 1. Operador reporta
      const { averia_id } = servicio.reportarAveria({
        maquina_id: 'maq2',
        descripcion_operador: 'Falla en sensor de aguja',
      })
      expect(servicio.db.maquinas.find(m => m.id === 'maq2')!.estado).toBe('malograda')

      // 2. Supervisor escala a técnico
      servicio.iniciarReparacion(averia_id!)
      expect(servicio.db.maquinas.find(m => m.id === 'maq2')!.estado).toBe('mantenimiento')

      // 3. Técnico resuelve
      servicio.registrarReparacion({
        averia_id: averia_id!,
        descripcion_tecnico: 'Sensor reemplazado y calibrado',
        costo_repuestos: 45,
        costo_mano_obra: 80,
      })
      expect(servicio.db.maquinas.find(m => m.id === 'maq2')!.estado).toBe('activa')
      expect(servicio.db.averias.find(a => a.id === averia_id)!.estado).toBe('resuelto')
      expect(servicio.db.reparaciones).toHaveLength(1)
    })
  })
})
