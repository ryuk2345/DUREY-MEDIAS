// Single Source of Truth: umbrales de stock bajo (alertas de la campana y de Materia Prima)

export type TipoEmpaque = 'bolsa' | 'cono' | 'caja'

/** Kg mínimos por tipo de empaque antes de alertar: cajas y bolsas ≤ 4, conos ≤ 10. */
export const UMBRAL_STOCK_BAJO_KG: Record<TipoEmpaque, number> = { caja: 4, bolsa: 4, cono: 10 }

/** Docenas de una media en almacén a partir de las cuales se alerta. */
export const UMBRAL_STOCK_BAJO_DOCENAS = 5

export function esStockBajoMateriaPrima(stockKg: number, tipoEmpaque?: string | null): boolean {
  const empaque = (tipoEmpaque && tipoEmpaque in UMBRAL_STOCK_BAJO_KG ? tipoEmpaque : 'cono') as TipoEmpaque
  return Number(stockKg ?? 0) <= UMBRAL_STOCK_BAJO_KG[empaque]
}

/**
 * Cantidad comprada que todavía no entra al stock: compras en estado
 * 'pendiente' (esperan control de calidad). El stock sube solo al aprobarlas.
 */
export function cantidadEnCaminoPorInsumo(
  compras: { materia_prima_id: string; cantidad_kg: number; estado: string }[]
): Record<string, number> {
  const mapa: Record<string, number> = {}
  for (const c of compras) {
    if (c.estado !== 'pendiente') continue
    mapa[c.materia_prima_id] = (mapa[c.materia_prima_id] ?? 0) + (Number(c.cantidad_kg) || 0)
  }
  return mapa
}
