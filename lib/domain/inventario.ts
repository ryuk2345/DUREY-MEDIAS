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
