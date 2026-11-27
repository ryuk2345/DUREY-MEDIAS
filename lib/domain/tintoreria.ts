/**
 * Medias en crudo y Tintorería (Fase 5B, migración 033). Única definición en la app de:
 * qué SKU de color corresponde a una media cruda, la merma de un lote y a qué etapa
 * va cada media al terminar Remallado o Volteado. Las escrituras son funciones de la
 * base (enviar_lote_tintoreria, recibir_lote_tintoreria, …), que aplican las mismas reglas.
 */
import { MODULOS_POR_ROL } from '@/lib/utils'

export const MATERIALES_TINTORERIA = ['algodon', 'poliester'] as const
export type MaterialTintoreria = (typeof MATERIALES_TINTORERIA)[number]
export const ETIQUETA_MATERIAL: Record<MaterialTintoreria, string> = { algodon: 'Algodón', poliester: 'Poliéster' }

type Media = { id: string; modelo: string; publico: string; talla: string; es_crudo?: boolean | null; estado?: string | null }

/** El SKU de color vuelve de la misma media: mismo modelo, público y talla, y no es crudo. */
export function esColorDe(color: Media, crudo: Media): boolean {
  return !color.es_crudo && !!crudo.es_crudo && color.modelo === crudo.modelo && color.publico === crudo.publico && color.talla === crudo.talla
}

/** SKU de color activos en que puede volver una media cruda. */
export function coloresPara<T extends Media>(catalogo: T[], crudo: T | null | undefined): T[] {
  if (!crudo) return []
  return catalogo.filter(c => esColorDe(c, crudo) && (c.estado ?? 'activo') === 'activo')
}

/** Merma = enviadas − recibidas (en centésimas, como la base). */
export function mermaTintoreria(enviadas: number, recibidas: number): number {
  return Math.round((Number(enviadas) - Number(recibidas)) * 100) / 100
}

/** Lo que sale de Remallado o Volteado: si es crudo sigue al paso siguiente en crudo; si tiene color, a planchado. */
export function destinoTrasRemallado(esCrudo: boolean): 'stock_listo_voltear' | 'stock_listo_planchar' {
  return esCrudo ? 'stock_listo_voltear' : 'stock_listo_planchar'
}
export function destinoTrasVolteado(esCrudo: boolean): 'stock_listo_tenir' | 'stock_listo_planchar' {
  return esCrudo ? 'stock_listo_tenir' : 'stock_listo_planchar'
}

/** Etapas del stock de fuera y si en ellas la media está en crudo. */
export const ETAPAS_STOCK_FUERA = ['remallado', 'volteado', 'tintoreria', 'planchado', 'preparado'] as const
export type EtapaStockFuera = (typeof ETAPAS_STOCK_FUERA)[number]
export const ETAPA_EN_CRUDO: Record<EtapaStockFuera, boolean> = { remallado: true, volteado: true, tintoreria: true, planchado: false, preparado: false }

/** ¿El rol tiene el módulo? Misma regla que exigir_modulo() en la base (tabla modulos_por_rol). */
export function tieneModulo(rol: string | null | undefined, modulo: string): boolean {
  return !!rol && (MODULOS_POR_ROL[rol] ?? []).includes(modulo)
}
