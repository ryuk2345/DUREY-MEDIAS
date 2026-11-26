/**
 * Mantenimiento preventivo e historia clínica de máquinas (Fase 4).
 * Única definición en la app de: próxima fecha, estado del plan (al día / próximo /
 * vencido), aviso por máquina, agrupación de la historia y sus filas para PDF y Excel.
 * Iniciar, usar repuestos y terminar son funciones atómicas de la base (migración 031).
 */
import { formatearFecha } from '@/lib/utils'
import { etiquetaTurno } from '@/lib/domain/reportes'

/** "Próximo" = vence en esta cantidad de días o menos (decisión del dueño, 2026-11-26). */
export const DIAS_AVISO_PROXIMO = 3

export type EstadoPlan = 'al_dia' | 'proximo' | 'vencido' | 'inactivo'

type PlanFechas = { fecha_inicio: string; ultima_fecha: string | null; frecuencia_dias: number }

const aUTC = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}
const deUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Fecha de hoy en la zona del navegador (Lima), como "AAAA-MM-DD". */
export function hoyLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Suma días a una fecha sin hora ("AAAA-MM-DD"), sin depender de la zona horaria. */
export function sumarDias(fecha: string, dias: number): string {
  return deUTC(aUTC(fecha) + dias * 86400000)
}

const diasEntre = (desde: string, hasta: string) => Math.round((aUTC(hasta) - aUTC(desde)) / 86400000)

/** Próxima fecha: (última vez o fecha de inicio) + frecuencia en días. */
export function proximaFecha(plan: PlanFechas): string {
  return sumarDias(plan.ultima_fecha ?? plan.fecha_inicio, plan.frecuencia_dias)
}

export function estadoPlan(plan: PlanFechas & { activo: boolean }, hoy: string = hoyLocal()): EstadoPlan {
  if (!plan.activo) return 'inactivo'
  const faltan = diasEntre(hoy, proximaFecha(plan))
  if (faltan < 0) return 'vencido'
  if (faltan <= DIAS_AVISO_PROXIMO) return 'proximo'
  return 'al_dia'
}

const GRAVEDAD: Record<EstadoPlan, number> = { vencido: 3, proximo: 2, al_dia: 1, inactivo: 0 }

/** Aviso de una máquina: el peor estado de sus planes activos (null si no tiene planes activos). */
export function estadoPreventivoMaquina(
  planes: (PlanFechas & { activo: boolean; maquina_id: string })[], maquinaId: string, hoy: string = hoyLocal(),
): Exclude<EstadoPlan, 'inactivo'> | null {
  let peor: EstadoPlan | null = null
  for (const p of planes) {
    if (p.maquina_id !== maquinaId || !p.activo) continue
    const e = estadoPlan(p, hoy)
    if (!peor || GRAVEDAD[e] > GRAVEDAD[peor]) peor = e
  }
  return peor === 'inactivo' ? null : peor
}

export const ETIQUETA_ESTADO_PLAN: Record<EstadoPlan, string> = {
  al_dia: 'Al día', proximo: 'Próximo', vencido: 'Vencido', inactivo: 'Desactivado',
}

// ── Historia clínica ──────────────────────────────────────────────────────
export type TipoEvento = 'produccion' | 'falla' | 'reparacion' | 'repuesto' | 'preventivo'

/** Fila de vista_historia_maquina (migración 031). */
export type EventoHistoria = {
  maquina_id: string
  fecha: string
  momento: string | null
  tipo: TipoEvento
  turno: string | null
  detalle: string | null
  cantidad: number | null
  costo: number | null
  persona: string | null
  mecanico: string | null
}

export const ETIQUETA_EVENTO: Record<TipoEvento, string> = {
  produccion: 'Producción', falla: 'Falla', reparacion: 'Reparación', repuesto: 'Repuesto usado', preventivo: 'Mantenimiento preventivo',
}

/** Lunes de la semana de una fecha sin hora (semanas de lunes a domingo). */
export function lunesDeSemana(fecha: string): string {
  const dia = new Date(aUTC(fecha)).getUTCDay() // 0 = domingo
  return sumarDias(fecha, -((dia + 6) % 7))
}

const masReciente = (a: EventoHistoria, b: EventoHistoria) =>
  b.fecha.localeCompare(a.fecha) || String(b.momento ?? '').localeCompare(String(a.momento ?? ''))

/** Por día: todos los eventos. Por semana: la producción se suma por semana; el resto sigue igual. */
export function agruparHistoria(eventos: EventoHistoria[], modo: 'dia' | 'semana'): EventoHistoria[] {
  if (modo === 'dia') return [...eventos].sort(masReciente)
  const semanas = new Map<string, EventoHistoria>()
  const otros: EventoHistoria[] = []
  for (const e of eventos) {
    if (e.tipo !== 'produccion') { otros.push(e); continue }
    const lunes = lunesDeSemana(e.fecha)
    const s = semanas.get(lunes) ?? {
      maquina_id: e.maquina_id, fecha: lunes, momento: `${lunes}T00:00:00Z`, tipo: 'produccion' as const, turno: null,
      detalle: `Semana del ${formatearFecha(lunes)}`, cantidad: 0, costo: null, persona: null, mecanico: null,
    }
    s.cantidad = Math.round(((s.cantidad ?? 0) + Number(e.cantidad ?? 0)) * 100) / 100
    semanas.set(lunes, s)
  }
  return [...semanas.values(), ...otros].sort(masReciente)
}

export function totalesHistoria(eventos: EventoHistoria[]) {
  const suma = (t: TipoEvento, campo: 'cantidad' | 'costo') =>
    Math.round(eventos.filter(e => e.tipo === t).reduce((s, e) => s + Number(e[campo] ?? 0), 0) * 100) / 100
  const cuenta = (t: TipoEvento) => eventos.filter(e => e.tipo === t).length
  return {
    docenas: suma('produccion', 'cantidad'),
    fallas: cuenta('falla'),
    reparaciones: cuenta('reparacion'),
    costoReparaciones: suma('reparacion', 'costo'),
    costoRepuestos: suma('repuesto', 'costo'),
    preventivos: cuenta('preventivo'),
    manoObraPreventivos: suma('preventivo', 'costo'),
  }
}

/** Filas para PDF y Excel. */
export function filasHistoria(eventos: EventoHistoria[]): Record<string, string | number | null>[] {
  return eventos.map(e => ({
    Fecha: formatearFecha(e.fecha),
    Evento: ETIQUETA_EVENTO[e.tipo],
    Turno: e.turno ? etiquetaTurno(e.turno) : '—',
    Detalle: e.detalle?.trim() || '—',
    Cantidad: e.cantidad != null ? Number(e.cantidad) : null,
    'Costo (S/)': e.costo != null ? Number(e.costo) : null,
    Persona: e.persona?.trim() || '—',
    Mecánico: e.mecanico?.trim() || '—',
  }))
}
