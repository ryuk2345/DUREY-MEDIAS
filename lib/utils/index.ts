import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generarCodigoMedia(modelo: string, publico: string, disenoColor: string, talla: string): string {
  return `${modelo}-${publico}-${disenoColor}-${talla}`.toLowerCase().replace(/\s+/g, '_')
}

export function generarSkuMedia(modelo: string, publico: string, disenoColor: string, talla: string): string {
  const modClean = (modelo || 'TOB').substring(0, 3).toUpperCase()
  const pubClean = (publico || 'UNI').substring(0, 3).toUpperCase()
  const disClean = (disenoColor || 'GEN').substring(0, 3).toUpperCase()
  const talClean = (talla || 'U').replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase()
  return `SKU-${modClean}-${pubClean}-${disClean}-${talClean}`
}

export function generarCodigoPaquete(secuencia: number): string {
  return `PKG-${String(secuencia).padStart(4, '0')}`
}

export function generarCodigoVenta(secuencia: number): string {
  return `V-${String(secuencia).padStart(4, '0')}`
}

export function generarCodigoGuia(secuencia: number): string {
  return `GR-${String(secuencia).padStart(4, '0')}`
}

export function formatearMoneda(monto: number): string {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
  }).format(monto)
}

/** Escapa texto para insertarlo en HTML armado a mano (etiquetas e impresiones en ventana nueva). */
export function escaparHtml(texto: unknown): string {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export function formatearFecha(fecha: string | Date): string {
  if (!fecha) return '—'
  // "AAAA-MM-DD" (columna DATE) es un día del calendario, no un instante: new Date() lo leería
  // como medianoche UTC y en Lima (UTC-5) se mostraría el día anterior.
  const soloDia = typeof fecha === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha) : null
  const d = soloDia ? new Date(Number(soloDia[1]), Number(soloDia[2]) - 1, Number(soloDia[3])) : new Date(fecha)
  // 2026-02-30 no existe: new Date() lo pasaría a marzo
  if (soloDia && (d.getMonth() !== Number(soloDia[2]) - 1 || d.getDate() !== Number(soloDia[3]))) return '—'
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

export function getDiaSemana(): string {
  const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  return dias[new Date().getDay()]
}

export function getSemanaAnio(): { semana: number; anio: number } {
  const ahora = new Date()
  const inicioAnio = new Date(ahora.getFullYear(), 0, 1)
  const dias = Math.floor((ahora.getTime() - inicioAnio.getTime()) / 86400000)
  return {
    semana: Math.ceil((dias + inicioAnio.getDay() + 1) / 7),
    anio: ahora.getFullYear(),
  }
}

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_COMPLETOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/**
 * Obtiene el rango de fechas (Lunes a Domingo) para una semana y año determinados.
 */
export function getFechasDeSemana(semana: number, anio: number): { fechaInicio: Date; fechaFin: Date } {
  const d4 = new Date(anio, 0, 4)
  const diaSemana = d4.getDay() || 7
  const primerLunes = new Date(anio, 0, 4 - diaSemana + 1)

  const fechaInicio = new Date(primerLunes.getTime() + (semana - 1) * 7 * 86400000)
  const fechaFin = new Date(fechaInicio.getTime() + 6 * 86400000)
  return { fechaInicio, fechaFin }
}

/**
 * Retorna el rango de fechas legible de la semana, p. ej.:
 * "Semana del 7 al 13 de Septiembre" o "Sem. 7 al 13 Sep"
 */
export function formatearRangoSemana(
  semana: number,
  anio: number,
  abreviado: boolean = false,
  conPrefijo: boolean = true
): string {
  const { fechaInicio, fechaFin } = getFechasDeSemana(semana, anio)
  const diaIni = fechaInicio.getDate()
  const mesIni = fechaInicio.getMonth()
  const diaFin = fechaFin.getDate()
  const mesFin = fechaFin.getMonth()
  const anioFin = fechaFin.getFullYear()

  const prefijo = conPrefijo ? (abreviado ? 'Sem. ' : 'Semana del ') : (conPrefijo === false && !abreviado ? 'Del ' : '')

  if (mesIni === mesFin) {
    return abreviado
      ? `${prefijo}${diaIni} al ${diaFin} ${MESES_ABR[mesIni]}`
      : `${prefijo}${diaIni} al ${diaFin} de ${MESES_COMPLETOS[mesIni]}`
  } else if (fechaInicio.getFullYear() === anioFin) {
    return abreviado
      ? `${prefijo}${diaIni} ${MESES_ABR[mesIni]} al ${diaFin} ${MESES_ABR[mesFin]}`
      : `${prefijo}${diaIni} de ${MESES_COMPLETOS[mesIni]} al ${diaFin} de ${MESES_COMPLETOS[mesFin]}`
  } else {
    return abreviado
      ? `${prefijo}${diaIni} ${MESES_ABR[mesIni]} al ${diaFin} ${MESES_ABR[mesFin]} ${anioFin}`
      : `${prefijo}${diaIni} de ${MESES_COMPLETOS[mesIni]} ${fechaInicio.getFullYear()} al ${diaFin} de ${MESES_COMPLETOS[mesFin]} ${anioFin}`
  }
}

export const ROLES_LABELS: Record<string, string> = {
  admin: 'Administrador General',
  supervisor: 'Supervisor de Producción',
  disenador: 'Diseñador Textil',
  tejedor: 'Tejedor (Tejido Circular)',
  remalladora: 'Remallador / Remalladora',
  remallador: 'Remallador / Remalladora',
  volteador: 'Volteador (Turning)',
  tintorero: 'Tintorería',
  planchador: 'Planchador (Hormado)',
  preparador: 'Preparador (Empaques)',
  almacenero: 'Almacenero y Despacho',
  vendedora: 'Asesora de Ventas',
  operador: 'Operador Multifuncional',
}

// La base tiene la misma tabla (modulos_por_rol, migración 033) y la usa para bloquear
// las funciones de producción: si se cambia aquí, hace falta una migración nueva
// (tests/e2e/20-crudo-volteado-tintoreria.test.ts compara las dos).
export const MODULOS_POR_ROL: Record<string, string[]> = {
  admin: ['admin', 'usuarios', 'catalogo', 'maquinas', 'disenos', 'produccion', 'remallado', 'volteado', 'tintoreria', 'planchado', 'preparado', 'almacen', 'ventas', 'clientes', 'despacho', 'mantenimiento', 'materia_prima', 'reportes', 'egresos', 'balance', 'calendario'],
  supervisor: ['usuarios', 'catalogo', 'maquinas', 'disenos', 'produccion', 'remallado', 'volteado', 'tintoreria', 'planchado', 'preparado', 'almacen', 'ventas', 'clientes', 'despacho', 'mantenimiento', 'materia_prima', 'reportes', 'calendario'],
  disenador: ['disenos', 'catalogo', 'maquinas'],
  tejedor: ['produccion', 'disenos', 'mantenimiento'],
  remalladora: ['remallado', 'mantenimiento'],
  remallador: ['remallado', 'mantenimiento'],
  volteador: ['volteado'],
  tintorero: ['tintoreria'],
  planchador: ['planchado', 'mantenimiento'],
  preparador: ['preparado'],
  almacenero: ['almacen', 'despacho', 'materia_prima'],
  vendedora: ['ventas', 'clientes', 'catalogo', 'despacho'],
  operador: ['produccion', 'remallado', 'tintoreria', 'disenos', 'planchado', 'preparado', 'almacen', 'mantenimiento'],
}


