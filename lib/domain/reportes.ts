/**
 * Reportes descargables: arma las filas de cada reporte con QUIÉN hizo el trabajo,
 * no solo cuánto (Fase 2). La página de Reportes solo consulta y llama a estas funciones.
 *
 * Tejido: el encargado es el tejedor del turno (turnos_produccion.tejedor_id) y los
 * operarios son los que el Calendario de Turnos asignó al área tejido en la misma
 * fecha y turno. El operario por máquina y turno llega con la Fase 5.
 */
import { formatearFecha } from '@/lib/utils'

export const SIN_REGISTRAR = 'Sin registrar'

type Fila = Record<string, string | number | null>
type ConNombre = { nombre?: string | null } | null | undefined
type ConCodigo = { codigo?: string | null } | null | undefined

const nombre = (p: ConNombre) => p?.nombre?.trim() || SIN_REGISTRAR
const codigo = (c: ConCodigo) => c?.codigo?.trim() || SIN_REGISTRAR

export function etiquetaTurno(horario: string | null | undefined): string {
  if (horario === 'dia') return 'Día'
  if (horario === 'noche') return 'Noche'
  return SIN_REGISTRAR
}

// ── Tejido / Producción ────────────────────────────────────────────────────
export type ReporteTejido = {
  fecha: string
  docenas_producidas: number | null
  maquina?: ConCodigo
  catalogo_media?: ConCodigo
  turno?: { fecha?: string | null; horario?: string | null; tejedor?: ConNombre } | null
}
export type AsignacionTurno = { fecha: string; turno: string; operador?: ConNombre }

const ORDEN_TURNO: Record<string, number> = { dia: 0, noche: 1 }

export function filasProduccion(reportes: ReporteTejido[], asignacionesTejido: AsignacionTurno[]): Fila[] {
  // Operarios por "fecha|turno", sin repetir y en orden alfabético
  const operarios = new Map<string, Set<string>>()
  for (const a of asignacionesTejido) {
    const n = a.operador?.nombre?.trim()
    if (!n) continue
    const clave = `${a.fecha}|${a.turno}`
    if (!operarios.has(clave)) operarios.set(clave, new Set())
    operarios.get(clave)!.add(n)
  }

  return [...reportes]
    .sort((a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      (ORDEN_TURNO[a.turno?.horario ?? ''] ?? 9) - (ORDEN_TURNO[b.turno?.horario ?? ''] ?? 9) ||
      codigo(a.maquina).localeCompare(codigo(b.maquina)))
    .map(r => {
      // El turno noche puede cerrarse al día siguiente: se cruza por la fecha del turno
      const fechaTurno = r.turno?.fecha ?? r.fecha
      const encargado = r.turno?.tejedor?.nombre?.trim()
      const nombres = [...(operarios.get(`${fechaTurno}|${r.turno?.horario}`) ?? [])]
        .filter(n => n !== encargado) // el encargado ya tiene su columna
        .sort((x, y) => x.localeCompare(y))
      return {
        Fecha: formatearFecha(r.fecha),
        Turno: etiquetaTurno(r.turno?.horario),
        Máquina: codigo(r.maquina),
        'Tipo de Media': codigo(r.catalogo_media),
        Encargado: nombre(r.turno?.tejedor),
        Operarios: nombres.length ? nombres.join(', ') : SIN_REGISTRAR,
        'Docenas Producidas': r.docenas_producidas,
      }
    })
}

// ── Remallado ──────────────────────────────────────────────────────────────
export type ReporteRemallado = {
  fecha: string
  docenas_remalladas: number | null
  docenas_restantes: number | null
  remalladora?: ConNombre
  maquina?: ConCodigo
  lote?: { catalogo_media?: ConCodigo } | null
}

export function filasRemallado(reportes: ReporteRemallado[]): Fila[] {
  return reportes.map(r => ({
    Fecha: formatearFecha(r.fecha),
    Remalladora: nombre(r.remalladora),
    Máquina: codigo(r.maquina),
    'Tipo de Media': codigo(r.lote?.catalogo_media),
    'Docenas Remalladas': r.docenas_remalladas,
    'Docenas Restantes': r.docenas_restantes,
  }))
}

// ── Planchado ──────────────────────────────────────────────────────────────
export type ReportePlanchado = {
  fecha: string
  docenas_planchadas: number | null
  docenas_defectuosas: number | null
  planchador?: ConNombre
  catalogo_media?: ConCodigo
}

export function filasPlanchado(reportes: ReportePlanchado[]): Fila[] {
  return reportes.map(r => ({
    Fecha: formatearFecha(r.fecha),
    Planchador: nombre(r.planchador),
    'Tipo de Media': codigo(r.catalogo_media),
    'Docenas Planchadas': r.docenas_planchadas,
    Mermas: r.docenas_defectuosas,
  }))
}

// ── Preparado y embolsado (paquetes) ───────────────────────────────────────
export type PaquetePreparado = {
  fecha: string
  codigo_paquete: string
  docenas: number | null
  estado: string
  preparador?: ConNombre
  catalogo_media?: { codigo?: string | null; sku?: string | null } | null
}

export function filasPreparado(paquetes: PaquetePreparado[]): Fila[] {
  return paquetes.map(p => ({
    Fecha: formatearFecha(p.fecha),
    Preparador: nombre(p.preparador),
    'Código Paquete': p.codigo_paquete,
    // Mismo nombre de columna que antes de la Fase 2: no romper plantillas de Excel existentes
    'Tipo Media': p.catalogo_media?.codigo || p.catalogo_media?.sku || SIN_REGISTRAR,
    Docenas: p.docenas,
    Estado: p.estado,
  }))
}

// ── Mantenimiento (averías y reparaciones) ─────────────────────────────────
export type AveriaReporte = {
  fecha_reporte: string
  descripcion_operador: string | null
  estado: string
  maquina?: ConCodigo
  reportado_por?: ConNombre
  reparaciones?: { costo_total?: number | null; tecnico?: ConNombre }[] | null
}

export function filasMantenimiento(averias: AveriaReporte[]): Fila[] {
  return averias.map(a => {
    const rep = a.reparaciones?.[0]
    return {
      Fecha: formatearFecha(a.fecha_reporte),
      Máquina: codigo(a.maquina),
      'Descripción Problema': a.descripcion_operador,
      'Reportado por': nombre(a.reportado_por),
      Técnico: rep ? nombre(rep.tecnico) : 'Pendiente',
      Estado: a.estado,
      'Costo Total (S/)': rep?.costo_total != null ? Number(rep.costo_total) : null,
      Reparada: rep ? 'Sí' : 'No',
    }
  })
}

// ── Resumen por persona ────────────────────────────────────────────────────
/** Agrupa las filas por la columna de la persona y suma la columna de cantidad. */
export function resumenPorPersona(filas: Fila[], columnaPersona: string, columnaCantidad: string): Fila[] {
  const grupos = new Map<string, { registros: number; total: number }>()
  for (const f of filas) {
    const persona = String(f[columnaPersona] ?? SIN_REGISTRAR)
    const valor = Number(f[columnaCantidad])
    const g = grupos.get(persona) ?? { registros: 0, total: 0 }
    g.registros += 1
    g.total += Number.isFinite(valor) ? valor : 0
    grupos.set(persona, g)
  }
  return [...grupos.entries()]
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .map(([persona, g]) => ({ Persona: persona, Registros: g.registros, [columnaCantidad]: Math.round(g.total * 100) / 100 }))
}

/** Qué columna identifica a la persona y cuál es la cantidad, por módulo (para el resumen). */
export const RESUMEN_POR_MODULO: Record<string, { persona: string; cantidad: string }> = {
  produccion: { persona: 'Encargado', cantidad: 'Docenas Producidas' },
  remallado: { persona: 'Remalladora', cantidad: 'Docenas Remalladas' },
  planchado: { persona: 'Planchador', cantidad: 'Docenas Planchadas' },
  preparado: { persona: 'Preparador', cantidad: 'Docenas' },
}
