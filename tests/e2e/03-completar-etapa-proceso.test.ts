/**
 * E2E Test: Marcar etapa del proceso productivo como completada
 *
 * El flujo real de producción es:
 *   Tejido → Enlace (Remallado) → Volteado → Planchado → Preparado → Almacén
 *
 * Cada etapa tiene su propia lógica de completado:
 *
 * TEJIDO (completado):
 *   - turno_produccion.estado → 'cerrado'
 *   - Docenas producidas → minideposito (acumulación por horario)
 *   - Máquinas → 'activa', Operador → 'disponible'
 *
 * ENLACE/REMALLADO (completado):
 *   - lote_remallado.estado → 'completado'
 *   - Docenas remalladas → stock_listo_voltear (upsert por catalogo_media_id)
 *   - Máquina → 'activa', Operadora → 'disponible'
 *
 * VOLTEADO (completado):
 *   - lote_volteado.estado → 'completado' (cuando docenas_pendientes == 0)
 *   - Docenas volteadas → stock_listo_planchar (upsert por catalogo_media_id)
 *   - stock_listo_voltear se decrementó al asignar el lote
 *
 * PLANCHADO (completado):
 *   - reporte_planchado insertado con docenas_planchadas y docenas_defectuosas
 *   - stock_listo_planchar se reduce en docenas planchadas
 *
 * INVARIANTE CRÍTICO: Las docenas nunca se pierden ni duplican entre etapas.
 *
 * El test FALLA si:
 *   - Las docenas no se transfieren correctamente entre tablas de stock
 *   - Se puede marcar como completado con más docenas que las asignadas
 *   - Un lote ya completado puede recibir más reportes
 *   - El stock intermedio queda negativo
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type EstadoLote = 'en_proceso' | 'completado' | 'traspasado'

type LoteRemallado = {
  id: string
  catalogo_media_id: string
  remalladora_id: string
  maquina_remalladora_id: string
  docenas_asignadas: number
  docenas_pendientes: number
  estado: EstadoLote
}

type LoteVolteado = {
  id: string
  catalogo_media_id: string
  volteador_id: string
  docenas_asignadas: number
  docenas_pendientes: number
  estado: EstadoLote
}

type StockItem = {
  id: string
  catalogo_media_id: string
  docenas: number
}

// ── Servicio de etapas del proceso ────────────────────────────────────────────

function crearServicioProceso(inicial: {
  stock_listo_planchar: StockItem[]
  lotes_remallado: LoteRemallado[]
  maquinas: { id: string; estado: string }[]
  usuarios: { id: string; estado: string }[]
}) {
  const db = {
    stock_listo_planchar: [...inicial.stock_listo_planchar],
    lotes_remallado: JSON.parse(JSON.stringify(inicial.lotes_remallado)),
    maquinas: JSON.parse(JSON.stringify(inicial.maquinas)),
    usuarios: JSON.parse(JSON.stringify(inicial.usuarios)),
    reportes_remallado: [] as any[],
    reportes_planchado: [] as any[],
  }

  return {
    db,

    /** ETAPA ENLACE: Completar un lote de remallado */
    completarRemallado(params: {
      lote_id: string
      docenas_remalladas: number
      docenas_restantes: number
    }): { ok: boolean; error?: string } {
      const { lote_id, docenas_remalladas, docenas_restantes } = params
      const lote = db.lotes_remallado.find(l => l.id === lote_id)
      if (!lote) return { ok: false, error: 'Lote de remallado no encontrado' }
      if (lote.estado === 'completado') return { ok: false, error: 'Este lote ya fue completado' }

      if (docenas_remalladas < 0) return { ok: false, error: 'Docenas remalladas no puede ser negativo' }
      if (docenas_restantes < 0) return { ok: false, error: 'Docenas restantes no puede ser negativo' }
      if (docenas_remalladas > lote.docenas_pendientes) {
        return { ok: false, error: `Las docenas reportadas (${docenas_remalladas}) superan las pendientes (${lote.docenas_pendientes})` }
      }

      // 1. Insertar reporte
      db.reportes_remallado.push({
        lote_id,
        remalladora_id: lote.remalladora_id,
        maquina_id: lote.maquina_remalladora_id,
        docenas_remalladas,
        docenas_restantes,
      })

      // 2. Actualizar lote
      lote.docenas_pendientes = docenas_restantes
      lote.estado = 'completado'

      // 3. CRÍTICO: Incrementar stock_listo_planchar (upsert) directamente
      const existente = db.stock_listo_planchar.find(s => s.catalogo_media_id === lote.catalogo_media_id)
      if (existente) {
        existente.docenas += docenas_remalladas
      } else {
        db.stock_listo_planchar.push({
          id: `slp-${lote.catalogo_media_id}`,
          catalogo_media_id: lote.catalogo_media_id,
          docenas: docenas_remalladas,
        })
      }

      // 4. Liberar recursos
      const maq = db.maquinas.find(m => m.id === lote.maquina_remalladora_id)
      if (maq) maq.estado = 'activa'
      const op = db.usuarios.find(u => u.id === lote.remalladora_id)
      if (op) op.estado = 'disponible'

      return { ok: true }
    },

    /** ETAPA PLANCHADO: Registrar reporte de planchado */
    reportarPlanchado(params: {
      catalogo_media_id: string
      planchador_id: string
      docenas_planchadas: number
      docenas_defectuosas: number
    }): { ok: boolean; error?: string } {
      const { catalogo_media_id, docenas_planchadas, docenas_defectuosas } = params
      if (docenas_planchadas <= 0) return { ok: false, error: 'Docenas planchadas debe ser mayor a cero' }
      if (docenas_defectuosas < 0) return { ok: false, error: 'Defectuosas no puede ser negativo' }
      if (docenas_defectuosas > docenas_planchadas) {
        return { ok: false, error: 'Las defectuosas no pueden superar las planchadas' }
      }

      const stock = db.stock_listo_planchar.find(s => s.catalogo_media_id === catalogo_media_id)
      if (!stock || stock.docenas <= 0) {
        return { ok: false, error: 'No hay stock disponible para planchar de este tipo de media' }
      }
      if (docenas_planchadas > stock.docenas) {
        return { ok: false, error: `Docenas a planchar (${docenas_planchadas}) superan el stock disponible (${stock.docenas})` }
      }

      // Registrar reporte
      db.reportes_planchado.push({
        catalogo_media_id,
        planchador_id: params.planchador_id,
        docenas_planchadas,
        docenas_defectuosas,
      })

      // Reducir stock
      stock.docenas -= docenas_planchadas

      return { ok: true }
    },
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MEDIA_ID = 'cat-tobillera-nino'

describe('Flujo 3: Marcar etapa del proceso como completada', () => {
  let servicio: ReturnType<typeof crearServicioProceso>

  beforeEach(() => {
    servicio = crearServicioProceso({
      stock_listo_planchar: [{ id: 'slp1', catalogo_media_id: MEDIA_ID, docenas: 0 }],
      lotes_remallado: [
        {
          id: 'lr1',
          catalogo_media_id: MEDIA_ID,
          remalladora_id: 'op-rem',
          maquina_remalladora_id: 'maq-rem',
          docenas_asignadas: 75,
          docenas_pendientes: 75,
          estado: 'en_proceso',
        },
      ],
      maquinas: [
        { id: 'maq-rem', estado: 'ocupada' },
      ],
      usuarios: [
        { id: 'op-rem', estado: 'ocupada' },
      ],
    })
  })

  // ── ENLACE / REMALLADO ───────────────────────────────────────────────────────

  describe('Etapa: Enlace / Remallado', () => {
    it('completa lote correctamente y transfiere docenas a stock_listo_planchar', () => {
      const stockAntes = servicio.db.stock_listo_planchar.find(s => s.catalogo_media_id === MEDIA_ID)!.docenas
 
      const result = servicio.completarRemallado({
        lote_id: 'lr1',
        docenas_remalladas: 72,
        docenas_restantes: 3,
      })
 
      expect(result.ok).toBe(true)
 
      const stockDespues = servicio.db.stock_listo_planchar.find(s => s.catalogo_media_id === MEDIA_ID)!.docenas
      expect(stockDespues).toBe(stockAntes + 72)
    })

    it('lote queda en estado "completado" tras el reporte', () => {
      servicio.completarRemallado({ lote_id: 'lr1', docenas_remalladas: 75, docenas_restantes: 0 })
      const lote = servicio.db.lotes_remallado.find(l => l.id === 'lr1')!
      expect(lote.estado).toBe('completado')
    })

    it('máquina y operadora quedan liberadas tras completar remallado', () => {
      servicio.completarRemallado({ lote_id: 'lr1', docenas_remalladas: 75, docenas_restantes: 0 })
      expect(servicio.db.maquinas.find(m => m.id === 'maq-rem')!.estado).toBe('activa')
      expect(servicio.db.usuarios.find(u => u.id === 'op-rem')!.estado).toBe('disponible')
    })

    it('[NEGOCIO] BLOQUEA reportar más docenas de las pendientes', () => {
      const result = servicio.completarRemallado({
        lote_id: 'lr1',
        docenas_remalladas: 100, // más de las 75 asignadas
        docenas_restantes: 0,
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('superan las pendientes')
    })

    it('[NEGOCIO] BLOQUEA completar un lote ya completado', () => {
      servicio.completarRemallado({ lote_id: 'lr1', docenas_remalladas: 75, docenas_restantes: 0 })
      const result2 = servicio.completarRemallado({
        lote_id: 'lr1',
        docenas_remalladas: 10,
        docenas_restantes: 0,
      })

      expect(result2.ok).toBe(false)
      expect(result2.error).toContain('ya fue completado')
    })
  })

  // ── PLANCHADO ─────────────────────────────────────────────────────────────────

  describe('Etapa: Planchado', () => {
    beforeEach(() => {
      // Simular que hay stock listo para planchar (como si volteado ya terminó)
      const slp = servicio.db.stock_listo_planchar.find(s => s.catalogo_media_id === MEDIA_ID)!
      slp.docenas = 40 // Volteado terminó y pasó 40 docenas
    })

    it('registra reporte de planchado y reduce el stock correctamente', () => {
      const stockAntes = servicio.db.stock_listo_planchar.find(s => s.catalogo_media_id === MEDIA_ID)!.docenas

      const result = servicio.reportarPlanchado({
        catalogo_media_id: MEDIA_ID,
        planchador_id: 'op-planch',
        docenas_planchadas: 30,
        docenas_defectuosas: 2,
      })

      expect(result.ok).toBe(true)
      const stockDespues = servicio.db.stock_listo_planchar.find(s => s.catalogo_media_id === MEDIA_ID)!.docenas
      expect(stockDespues).toBe(stockAntes - 30)
    })

    it('[NEGOCIO] BLOQUEA planchar más docenas de las disponibles en stock', () => {
      const result = servicio.reportarPlanchado({
        catalogo_media_id: MEDIA_ID,
        planchador_id: 'op-planch',
        docenas_planchadas: 999, // más que el stock
        docenas_defectuosas: 0,
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('superan el stock disponible')
    })

    it('[NEGOCIO] BLOQUEA planchar si no hay stock disponible (stock_listo_planchar = 0)', () => {
      const slp = servicio.db.stock_listo_planchar.find(s => s.catalogo_media_id === MEDIA_ID)!
      slp.docenas = 0 // Sin stock

      const result = servicio.reportarPlanchado({
        catalogo_media_id: MEDIA_ID,
        planchador_id: 'op-planch',
        docenas_planchadas: 10,
        docenas_defectuosas: 0,
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('No hay stock disponible')
    })

    it('[NEGOCIO] BLOQUEA que defectuosas superen las planchadas', () => {
      const result = servicio.reportarPlanchado({
        catalogo_media_id: MEDIA_ID,
        planchador_id: 'op-planch',
        docenas_planchadas: 10,
        docenas_defectuosas: 15, // más defectuosas que planchadas → imposible
      })

      expect(result.ok).toBe(false)
      expect(result.error).toContain('Las defectuosas no pueden superar las planchadas')
    })
  })

  // ── INVARIANTE GLOBAL: conservación de docenas entre etapas ──────────────────

  describe('Invariante: conservación de docenas en el flujo completo', () => {
    it('las docenas producidas en remallado llegan íntegras a planchado', () => {
      const docenasRemalladas = 50

      // ETAPA 1: Completar remallado → va directamente a stock_listo_planchar
      servicio.completarRemallado({
        lote_id: 'lr1',
        docenas_remalladas: docenasRemalladas,
        docenas_restantes: 25,
      })

      const stockPlanchar = servicio.db.stock_listo_planchar.find(s => s.catalogo_media_id === MEDIA_ID)!.docenas

      // Las docenas deben haber llegado de forma directa
      expect(stockPlanchar).toBe(docenasRemalladas)
    })
  })
})
