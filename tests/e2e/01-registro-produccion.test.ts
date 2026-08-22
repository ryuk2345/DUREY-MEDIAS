/**
 * E2E Test: Registrar Producción de Máquina
 *
 * Flujo correcto del negocio (fuente de verdad):
 *   1. Supervisor/admin crea un turno eligiendo marca, operador y máquinas
 *   2. Cada máquina seleccionada recibe un `catalogo_media_id`
 *   3. Se valida que la máquina esté en estado 'activa' o 'standby' (transición a 'ocupada')
 *   4. Se valida stock de materia prima antes de iniciar
 *   5. Se crea el turno (`turnos_produccion`) + asignaciones (`turno_maquinas`)
 *   6. Las máquinas pasan a 'ocupada'; el operador pasa a 'ocupada'
 *   7. Al cerrar turno: se insertan `reportes_produccion`, turno → 'cerrado',
 *      máquinas → 'activa', operador → 'disponible'
 *
 * El test FALLA si:
 *   - Se permite crear turno con máquina en estado inválido (malograda/mantenimiento)
 *   - Se inicia producción sin stock de hilo suficiente
 *   - Las máquinas no quedan 'ocupada' tras iniciar turno
 *   - El operador no queda 'disponible' tras cerrar turno
 *   - Los `reportes_produccion` no se insertan al cerrar
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  validarTransicionEstadoMaquina,
  type EstadoMaquina,
} from '@/lib/domain/machines'

// ── Helpers de simulación de BD en memoria ──────────────────────────────────

type MockMaquina = { id: string; codigo: string; estado: EstadoMaquina; marca_id: string }
type MockUsuario = { id: string; nombre: string; rol: string; estado: string }
type MockTurno = { id: string; tejedor_id: string; horario: string; estado: string }
type MockTurnoMaquina = { id: string; turno_id: string; maquina_id: string; catalogo_media_id: string }
type MockReporte = { turno_id: string; maquina_id: string; catalogo_media_id: string; docenas_producidas: number }
type MockMateriaPrima = { id: string; material: string; color: string; stock_kg: number }

// Simula la lógica pura del módulo de producción (sin React, sin Supabase)
function crearServicioProduccion(initialState: {
  maquinas: MockMaquina[]
  usuarios: MockUsuario[]
  materia_prima: MockMateriaPrima[]
}) {
  const db = {
    maquinas: [...initialState.maquinas],
    usuarios: [...initialState.usuarios],
    materia_prima: [...initialState.materia_prima],
    turnos_produccion: [] as MockTurno[],
    turno_maquinas: [] as MockTurnoMaquina[],
    reportes_produccion: [] as MockReporte[],
    movimientos_materia_prima: [] as any[],
  }

  let turnoIdSeq = 1

  return {
    db,

    /**
     * Inicia un turno de producción — corresponde a `ejecutarCargaDeLote`
     * en app/dashboard/produccion/page.tsx
     */
    iniciarTurno(params: {
      marca_id: string
      tejedor_id: string
      horario: 'dia' | 'noche'
      duracion_horas: number
      maquinas_seleccionadas: Record<string, string> // maquina_id -> catalogo_media_id
      materia_prima_requerida: { materia_prima_id: string; kg_necesarios: number }[]
    }): { ok: boolean; error?: string; turno_id?: string } {
      const { tejedor_id, maquinas_seleccionadas, materia_prima_requerida } = params
      const maquinaIds = Object.keys(maquinas_seleccionadas)

      if (maquinaIds.length === 0) return { ok: false, error: 'Selecciona al menos una máquina' }
      if (!tejedor_id) return { ok: false, error: 'Selecciona un operador de turno' }

      // Validar transiciones de estado (regla de negocio core)
      for (const mId of maquinaIds) {
        const maq = db.maquinas.find(m => m.id === mId)
        if (!maq) return { ok: false, error: `Máquina ${mId} no encontrada` }
        const v = validarTransicionEstadoMaquina(maq.estado, 'ocupada')
        if (!v.valido) return { ok: false, error: `${maq.codigo}: ${v.error}` }
      }

      // Validar stock de materia prima
      for (const req of materia_prima_requerida) {
        const mp = db.materia_prima.find(m => m.id === req.materia_prima_id)
        if (!mp) return { ok: false, error: `Materia prima ${req.materia_prima_id} no encontrada` }
        if (mp.stock_kg < req.kg_necesarios) {
          return { ok: false, error: `Stock insuficiente: se requieren ${req.kg_necesarios}kg de ${mp.material} ${mp.color} pero quedan ${mp.stock_kg}kg` }
        }
      }

      // Crear turno
      const turnoId = `turno-${turnoIdSeq++}`
      db.turnos_produccion.push({
        id: turnoId,
        tejedor_id,
        horario: params.horario,
        estado: 'activo',
      })

      // Crear asignaciones
      for (const [maquinaId, catalogoId] of Object.entries(maquinas_seleccionadas)) {
        db.turno_maquinas.push({ id: `tm-${turnoId}-${maquinaId}`, turno_id: turnoId, maquina_id: maquinaId, catalogo_media_id: catalogoId })
      }

      // Marcar máquinas como ocupadas
      db.maquinas.forEach(m => {
        if (maquinaIds.includes(m.id)) m.estado = 'ocupada'
      })

      // Marcar operador como ocupado
      const op = db.usuarios.find(u => u.id === tejedor_id)
      if (op) op.estado = 'ocupada'

      // Descontar materia prima
      for (const req of materia_prima_requerida) {
        const mp = db.materia_prima.find(m => m.id === req.materia_prima_id)
        if (mp) mp.stock_kg -= req.kg_necesarios
        db.movimientos_materia_prima.push({ materia_prima_id: req.materia_prima_id, tipo: 'consumo_produccion', cantidad_kg: req.kg_necesarios, referencia_id: turnoId })
      }

      return { ok: true, turno_id: turnoId }
    },

    /**
     * Registra producción y cierra turno — corresponde a `enviarReporteProduccion`
     * en app/dashboard/produccion/page.tsx
     */
    cerrarTurnoConReporte(params: {
      turno_id: string
      reporte: Record<string, number> // maquina_id -> docenas_producidas
    }): { ok: boolean; error?: string } {
      const { turno_id, reporte } = params
      const turno = db.turnos_produccion.find(t => t.id === turno_id)
      if (!turno) return { ok: false, error: 'Turno no encontrado' }
      if (turno.estado !== 'activo') return { ok: false, error: 'Solo se puede cerrar un turno activo' }

      const asignaciones = db.turno_maquinas.filter(tm => tm.turno_id === turno_id)
      if (asignaciones.length === 0) return { ok: false, error: 'Turno sin asignaciones de máquina' }

      // Validar transición máquinas ocupada → activa
      for (const tm of asignaciones) {
        const maq = db.maquinas.find(m => m.id === tm.maquina_id)
        if (!maq) continue
        const v = validarTransicionEstadoMaquina(maq.estado, 'activa')
        if (!v.valido) return { ok: false, error: `${maq.codigo}: ${v.error}` }
      }

      // Insertar reportes de producción
      for (const tm of asignaciones) {
        db.reportes_produccion.push({
          turno_id: turno_id,
          maquina_id: tm.maquina_id,
          catalogo_media_id: tm.catalogo_media_id,
          docenas_producidas: reporte[tm.maquina_id] ?? 0,
        })
      }

      // Cerrar turno
      turno.estado = 'cerrado'

      // Liberar máquinas
      const maquinaIds = asignaciones.map(tm => tm.maquina_id)
      db.maquinas.forEach(m => {
        if (maquinaIds.includes(m.id)) m.estado = 'activa'
      })

      // Liberar operador
      const op = db.usuarios.find(u => u.id === turno.tejedor_id)
      if (op) op.estado = 'disponible'

      return { ok: true }
    },
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MAQUINAS_FIXTURE: MockMaquina[] = [
  { id: 'maq1', codigo: 'M01', estado: 'activa', marca_id: 'marca1' },
  { id: 'maq2', codigo: 'M02', estado: 'activa', marca_id: 'marca1' },
  { id: 'maq3', codigo: 'M03', estado: 'malograda', marca_id: 'marca1' },
  { id: 'maq4', codigo: 'M04', estado: 'mantenimiento', marca_id: 'marca1' },
]

const USUARIOS_FIXTURE: MockUsuario[] = [
  { id: 'op1', nombre: 'Carlos Tejedor', rol: 'operador', estado: 'disponible' },
]

const MATERIA_PRIMA_FIXTURE: MockMateriaPrima[] = [
  { id: 'mp1', material: 'Algodón', color: 'Blanco', stock_kg: 100 },
  { id: 'mp2', material: 'Lana', color: 'Roja', stock_kg: 2 }, // Stock crítico
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Flujo 1: Registrar producción de máquina', () => {
  let servicio: ReturnType<typeof crearServicioProduccion>

  beforeEach(() => {
    servicio = crearServicioProduccion({
      maquinas: JSON.parse(JSON.stringify(MAQUINAS_FIXTURE)),
      usuarios: JSON.parse(JSON.stringify(USUARIOS_FIXTURE)),
      materia_prima: JSON.parse(JSON.stringify(MATERIA_PRIMA_FIXTURE)),
    })
  })

  // ── CAMINO FELIZ ────────────────────────────────────────────────────────────

  it('crea turno correctamente con máquinas activas y stock suficiente', () => {
    const result = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1', maq2: 'cat2' },
      materia_prima_requerida: [{ materia_prima_id: 'mp1', kg_necesarios: 5.4 }],
    })

    expect(result.ok).toBe(true)
    expect(result.turno_id).toBeDefined()
  })

  it('máquinas quedan en estado "ocupada" al iniciar turno', () => {
    servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1', maq2: 'cat2' },
      materia_prima_requerida: [],
    })

    const m1 = servicio.db.maquinas.find(m => m.id === 'maq1')!
    const m2 = servicio.db.maquinas.find(m => m.id === 'maq2')!
    expect(m1.estado).toBe('ocupada')
    expect(m2.estado).toBe('ocupada')
  })

  it('operador queda en estado "ocupada" al iniciar turno', () => {
    servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1' },
      materia_prima_requerida: [],
    })

    const op = servicio.db.usuarios.find(u => u.id === 'op1')!
    expect(op.estado).toBe('ocupada')
  })

  it('el stock de hilo se descuenta correctamente al iniciar turno', () => {
    const stockAntes = servicio.db.materia_prima.find(m => m.id === 'mp1')!.stock_kg

    servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1' },
      materia_prima_requerida: [{ materia_prima_id: 'mp1', kg_necesarios: 5.4 }],
    })

    const stockDespues = servicio.db.materia_prima.find(m => m.id === 'mp1')!.stock_kg
    expect(stockDespues).toBeCloseTo(stockAntes - 5.4)
  })

  it('se registra movimiento de consumo en materia_prima al iniciar turno', () => {
    servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1' },
      materia_prima_requerida: [{ materia_prima_id: 'mp1', kg_necesarios: 5.4 }],
    })

    const movs = servicio.db.movimientos_materia_prima
    expect(movs).toHaveLength(1)
    expect(movs[0].tipo).toBe('consumo_produccion')
    expect(movs[0].cantidad_kg).toBeCloseTo(5.4)
  })

  it('insertar reportes_produccion y cerrar turno correctamente', () => {
    const { turno_id } = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1', maq2: 'cat2' },
      materia_prima_requerida: [],
    })

    const result = servicio.cerrarTurnoConReporte({
      turno_id: turno_id!,
      reporte: { maq1: 75, maq2: 70 },
    })

    expect(result.ok).toBe(true)
    expect(servicio.db.reportes_produccion).toHaveLength(2)
    expect(servicio.db.reportes_produccion[0].docenas_producidas).toBe(75)
    expect(servicio.db.reportes_produccion[1].docenas_producidas).toBe(70)
  })

  it('máquinas quedan "activa" y operador "disponible" al cerrar turno', () => {
    const { turno_id } = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1' },
      materia_prima_requerida: [],
    })

    servicio.cerrarTurnoConReporte({ turno_id: turno_id!, reporte: { maq1: 75 } })

    expect(servicio.db.maquinas.find(m => m.id === 'maq1')!.estado).toBe('activa')
    expect(servicio.db.usuarios.find(u => u.id === 'op1')!.estado).toBe('disponible')
  })

  it('turno queda en estado "cerrado" tras registrar producción', () => {
    const { turno_id } = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1' },
      materia_prima_requerida: [],
    })

    servicio.cerrarTurnoConReporte({ turno_id: turno_id!, reporte: { maq1: 75 } })

    const turno = servicio.db.turnos_produccion.find(t => t.id === turno_id)!
    expect(turno.estado).toBe('cerrado')
  })

  // ── CAMINOS DE FALLA (deben fallar para proteger el negocio) ───────────────

  it('[NEGOCIO] BLOQUEA iniciar turno con máquina malograda', () => {
    const result = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq3: 'cat1' }, // maq3 está malograda
      materia_prima_requerida: [],
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Transición no permitida')
  })

  it('[NEGOCIO] BLOQUEA iniciar turno con máquina en mantenimiento', () => {
    const result = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq4: 'cat1' }, // maq4 en mantenimiento
      materia_prima_requerida: [],
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Transición no permitida')
  })

  it('[NEGOCIO] BLOQUEA iniciar turno sin operador asignado', () => {
    const result = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: '', // sin operador
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1' },
      materia_prima_requerida: [],
    })

    expect(result.ok).toBe(false)
  })

  it('[NEGOCIO] BLOQUEA iniciar turno con stock de hilo insuficiente', () => {
    const result = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1' },
      materia_prima_requerida: [
        { materia_prima_id: 'mp2', kg_necesarios: 10 } // Solo hay 2kg de Lana Roja
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Stock insuficiente')
  })

  it('[NEGOCIO] BLOQUEA cerrar un turno que ya está cerrado', () => {
    const { turno_id } = servicio.iniciarTurno({
      marca_id: 'marca1',
      tejedor_id: 'op1',
      horario: 'dia',
      duracion_horas: 12,
      maquinas_seleccionadas: { maq1: 'cat1' },
      materia_prima_requerida: [],
    })

    servicio.cerrarTurnoConReporte({ turno_id: turno_id!, reporte: { maq1: 75 } })
    const result2 = servicio.cerrarTurnoConReporte({ turno_id: turno_id!, reporte: { maq1: 75 } })

    expect(result2.ok).toBe(false)
    expect(result2.error).toContain('Solo se puede cerrar un turno activo')
  })
})
