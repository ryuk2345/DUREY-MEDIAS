import { MODULOS_POR_ROL } from '@/lib/utils'

/**
 * Normaliza el rol guardado en la sesión (acepta variantes como "Administrador",
 * "Vendedora", "remalladora"...). Devuelve null si no es un rol conocido: un rol
 * desconocido NUNCA obtiene acceso (antes se trataba como admin).
 * Única definición: la usan proxy.ts, app/dashboard/layout.tsx y app/dashboard/page.tsx.
 */
export function normalizarRol(rawRole: string | undefined | null): string | null {
  if (!rawRole) return null
  const r = rawRole.toLowerCase().trim()
  if (r.includes('admin')) return 'admin'
  if (r.includes('super')) return 'supervisor'
  if (r.includes('oper')) return 'operador'
  if (r.includes('vend')) return 'vendedora'
  if (r.includes('tej')) return 'tejedor'
  if (r.includes('remal')) return 'remalladora'
  if (r.includes('planc')) return 'planchador'
  if (r.includes('prep')) return 'preparador'
  if (r.includes('almac')) return 'almacenero'
  return r in MODULOS_POR_ROL ? r : null
}

/** Ruta del panel de un módulo: 'materia_prima' → '/materia-prima'. */
export function rutaDeModulo(modulo: string): string {
  return '/' + modulo.replace(/_/g, '-')
}

/**
 * Rutas del panel que puede abrir un rol (Fase 7). Salen de MODULOS_POR_ROL, la misma lista
 * que el menú y la base (tabla modulos_por_rol): antes proxy.ts tenía su propia copia.
 * La primera es a donde se redirige si el rol pide una ruta que no tiene.
 */
export function rutasPorRol(rol: string | null | undefined): string[] {
  return rol ? (MODULOS_POR_ROL[rol] ?? []).map(rutaDeModulo) : []
}
