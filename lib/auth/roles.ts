import { MODULOS_POR_ROL } from '@/lib/utils'

/**
 * Normaliza el rol guardado en la sesión (acepta variantes como "Administrador",
 * "Técnico", "remalladora"...). Devuelve null si no es un rol conocido: un rol
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
  if (r.includes('tecn') || r.includes('técn')) return 'tecnico'
  if (r.includes('tej')) return 'tejedor'
  if (r.includes('remal')) return 'remalladora'
  if (r.includes('planc')) return 'planchador'
  if (r.includes('prep')) return 'preparador'
  if (r.includes('almac')) return 'almacenero'
  return r in MODULOS_POR_ROL ? r : null
}
