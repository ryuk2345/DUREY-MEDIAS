// Single Source of Truth: copiar la asignación de Tejido del día anterior

export interface TurnoPrevio {
  fecha: string
  horario: string
  duracion_horas: number
  tejedor_id: string
  turno_maquinas: { maquina_id: string; catalogo_media_id: string }[]
}

export interface MaquinaTejido {
  id: string
  codigo: string
  marca_id: string
  estado: string
}

export interface CopiaAsignacion {
  fecha: string
  marca_id: string
  tejedor_id: string
  duracion_horas: string
  maquinas_seleccionadas: Record<string, string>
  omitidas: { codigo: string; motivo: string }[]
}

/** Exactamente uno de los dos viene con valor. */
export interface ResultadoCopiaAsignacion { copia: CopiaAsignacion | null; error: string | null }

const NOMBRE_HORARIO: Record<string, string> = { dia: 'día', noche: 'noche' }

/**
 * Arma el formulario de carga de lote con lo del último día anterior trabajado
 * (máquinas con su producto y el tejedor encargado) para el mismo horario.
 * No guarda nada: el supervisor revisa y luego carga el lote con la regla de
 * siempre (cargar_lote_produccion). Las máquinas que hoy no están activas, o
 * cuyo producto ya no está activo, se omiten y se informan.
 *
 * @param turnosPrevios turnos con fecha anterior a hoy (cualquier estado)
 * @param marcaId marca elegida en el formulario; null = la del primer turno encontrado
 */
export function construirCopiaAsignacion(
  turnosPrevios: TurnoPrevio[],
  maquinas: MaquinaTejido[],
  catalogoActivoIds: Set<string>,
  horario: string,
  marcaId: string | null
): ResultadoCopiaAsignacion {
  const delHorario = turnosPrevios.filter(t => t.horario === horario)
  if (delHorario.length === 0) {
    return { copia: null, error: `No hay asignaciones anteriores del turno ${NOMBRE_HORARIO[horario] ?? horario} para copiar` }
  }
  const fecha = delHorario.reduce((max, t) => (t.fecha > max ? t.fecha : max), delHorario[0].fecha)
  const delDia = delHorario.filter(t => t.fecha === fecha)

  const porId = new Map(maquinas.map(m => [m.id, m]))
  const marcaDeTurno = (t: TurnoPrevio) => t.turno_maquinas.map(tm => porId.get(tm.maquina_id)?.marca_id).find(Boolean) ?? null

  const turno = marcaId
    ? delDia.find(t => t.turno_maquinas.some(tm => porId.get(tm.maquina_id)?.marca_id === marcaId))
    : delDia.find(t => marcaDeTurno(t))
  if (!turno) {
    return {
      copia: null,
      error: marcaId
        ? `El ${fecha} (turno ${NOMBRE_HORARIO[horario] ?? horario}) no hubo máquinas de esta marca`
        : `Las máquinas del ${fecha} ya no están registradas`,
    }
  }
  const marca = marcaId ?? marcaDeTurno(turno)!

  const maquinas_seleccionadas: Record<string, string> = {}
  const omitidas: CopiaAsignacion['omitidas'] = []
  for (const tm of turno.turno_maquinas) {
    const m = porId.get(tm.maquina_id)
    if (!m || m.marca_id !== marca) continue
    if (m.estado !== 'activa') {
      omitidas.push({ codigo: m.codigo, motivo: `está ${m.estado}` })
    } else if (!catalogoActivoIds.has(tm.catalogo_media_id)) {
      omitidas.push({ codigo: m.codigo, motivo: 'su producto ya no está activo' })
    } else {
      maquinas_seleccionadas[m.id] = tm.catalogo_media_id
    }
  }

  return {
    error: null,
    copia: {
      fecha,
      marca_id: marca,
      tejedor_id: turno.tejedor_id,
      duracion_horas: String(turno.duracion_horas ?? 12),
      maquinas_seleccionadas,
      omitidas,
    },
  }
}

// ── Tejido 24/6 (Fase 5A, migración 032) ─────────────────────────────────
/** Roles que cambian el producto de una máquina y corrigen un turno (decisiones P1-A y P2-A, 2026-11-26). */
export const ROLES_SUPERVISAN_TEJIDO = ['admin', 'supervisor'] as const

export function puedeSupervisarTejido(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_SUPERVISAN_TEJIDO as readonly string[]).includes(rol)
}

/** Peso por docena cuando el producto no lo tiene (mismo valor que el SQL). */
export const PESO_DOCENA_POR_DEFECTO_G = 360

/** Kg de hilo de una producción: docenas reales × peso por docena (decisión C3-A). */
export function kgHilo(docenas: number, pesoDocenaG: number | null | undefined): number {
  const peso = Number(pesoDocenaG) || PESO_DOCENA_POR_DEFECTO_G
  return (Number(docenas) * peso) / 1000
}

export type ProductoMaquina = { maquina_id: string; catalogo_media_id: string; desde: string; hasta: string | null }

/** Producto vigente de una máquina (el que no tiene "hasta"), o null. */
export function productoVigente<T extends ProductoMaquina>(productos: T[], maquinaId: string): T | null {
  return productos.find(p => p.maquina_id === maquinaId && !p.hasta) ?? null
}

/** Estados en los que una tejedora no registra producción. */
export const ESTADOS_SIN_PRODUCCION = ['malograda', 'mantenimiento', 'inactiva'] as const

export function registraProduccion(estado: string): boolean {
  return !(ESTADOS_SIN_PRODUCCION as readonly string[]).includes(estado)
}

/** Docenas válidas de un turno: número entre 0 y 10 000 (igual que el SQL). */
export const MAX_DOCENAS_TURNO = 10000

export function docenasValidas(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === '') return false
  const n = Number(valor)
  return Number.isFinite(n) && n >= 0 && n <= MAX_DOCENAS_TURNO
}
