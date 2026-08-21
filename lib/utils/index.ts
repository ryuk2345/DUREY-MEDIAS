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

export function formatearFecha(fecha: string | Date): string {
  if (!fecha) return '—'
  const d = new Date(fecha)
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

export const ROLES_LABELS: Record<string, string> = {
  admin: 'Administrador General',
  supervisor: 'Supervisor de Producción',
  tejedor: 'Tejedor',
  remalladora: 'Remalladora',
  volteador: 'Volteador (Turning)',
  planchador: 'Planchador',
  preparador: 'Preparador',
  almacenero: 'Almacenero y Despacho',
  vendedora: 'Asesora de Ventas',
  tecnico: 'Técnico de Mantenimiento',
}

export const MODULOS_POR_ROL: Record<string, string[]> = {
  admin: ['admin', 'usuarios', 'catalogo', 'maquinas', 'produccion', 'remallado', 'volteado', 'planchado', 'preparado', 'almacen', 'ventas', 'despacho', 'mantenimiento', 'materia_prima', 'reportes'],
  supervisor: ['usuarios', 'catalogo', 'maquinas', 'produccion', 'remallado', 'volteado', 'planchado', 'preparado', 'almacen', 'despacho', 'materia_prima', 'reportes'],
  tejedor: ['produccion', 'mantenimiento'],
  remalladora: ['remallado', 'mantenimiento'],
  volteador: ['volteado'],
  planchador: ['planchado'],
  preparador: ['preparado'],
  almacenero: ['almacen', 'despacho'],
  vendedora: ['ventas'],
  tecnico: ['mantenimiento'],
}
