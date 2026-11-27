/**
 * Despacho por sacos y kardex de salones (Fase 6A, migración 034). Única definición en la
 * app de: lo que falta o sobra al elegir sacos para un pedido, y el saldo de un salón según
 * su kardex. La base aplica la misma regla en despachar_venta_sacos (si falta, no despacha).
 */

export type LineaPedido = { catalogo_media_id: string; docenas: number }
export type SacoElegible = { id: string; catalogo_media_id: string | null; docenas: number }
export type ComparacionSku = { catalogo_media_id: string; pedidas: number; elegidas: number; falta: number; sobra: number }

const r2 = (n: number) => Math.round(n * 100) / 100

/** Por SKU del pedido: lo pedido frente a lo que llevan los sacos elegidos. */
export function compararDespacho(pedido: LineaPedido[], sacos: SacoElegible[]): ComparacionSku[] {
  const pedidas = new Map<string, number>()
  for (const l of pedido) pedidas.set(l.catalogo_media_id, (pedidas.get(l.catalogo_media_id) ?? 0) + Number(l.docenas))
  return [...pedidas].map(([id, ped]) => {
    const elegidas = r2(sacos.filter(s => s.catalogo_media_id === id).reduce((t, s) => t + Number(s.docenas), 0))
    return { catalogo_media_id: id, pedidas: r2(ped), elegidas, falta: r2(Math.max(0, ped - elegidas)), sobra: r2(Math.max(0, elegidas - ped)) }
  })
}

/** Sacos elegidos de un SKU que no está en el pedido (la base los rechaza). */
export function sacosFueraDelPedido<T extends SacoElegible>(pedido: LineaPedido[], sacos: T[]): T[] {
  const skus = new Set(pedido.map(l => l.catalogo_media_id))
  return sacos.filter(s => !s.catalogo_media_id || !skus.has(s.catalogo_media_id))
}

/** Se puede despachar si hay sacos, ninguno es de otro SKU y no falta nada. */
export function puedeDespachar(pedido: LineaPedido[], sacos: SacoElegible[]): boolean {
  return sacos.length > 0 && sacosFueraDelPedido(pedido, sacos).length === 0 && compararDespacho(pedido, sacos).every(c => c.falta === 0)
}

// ── Kardex ────────────────────────────────────────────────────────────────
export type TipoMovimiento = 'ingreso_salon' | 'ingreso_directo' | 'traslado_entrada' | 'traslado_salida' | 'salida_venta'
export type Movimiento = { tipo: string; docenas: number | null; ubicacion_id: string | null; created_at: string }

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  ingreso_salon: 'Entrada', ingreso_directo: 'Entrada directa', traslado_entrada: 'Traslado (entra)', traslado_salida: 'Traslado (sale)', salida_venta: 'Salida por despacho',
}

/** +1 si el movimiento suma al salón, −1 si resta, 0 si no cuenta (tipos antiguos sin salón). */
export function signoMovimiento(tipo: string): 1 | -1 | 0 {
  if (tipo === 'ingreso_salon' || tipo === 'ingreso_directo' || tipo === 'traslado_entrada') return 1
  if (tipo === 'traslado_salida' || tipo === 'salida_venta') return -1
  return 0
}

/** Docenas que suman los movimientos de un salón (saldo anterior a la ventana del kardex). */
export function saldoDeSalon(movs: Pick<Movimiento, 'tipo' | 'docenas' | 'ubicacion_id'>[], ubicacionId: string): number {
  return r2(movs.filter(m => m.ubicacion_id === ubicacionId).reduce((t, m) => t + signoMovimiento(m.tipo) * Number(m.docenas ?? 0), 0))
}

/** Movimientos de un salón en orden, con el saldo después de cada uno, partiendo del saldo anterior. */
export function kardexConSaldo<T extends Movimiento>(movs: T[], ubicacionId: string, saldoInicial = 0): (T & { saldo: number })[] {
  let saldo = saldoInicial
  return movs
    .filter(m => m.ubicacion_id === ubicacionId && signoMovimiento(m.tipo) !== 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(m => { saldo = r2(saldo + signoMovimiento(m.tipo) * Number(m.docenas ?? 0)); return { ...m, saldo } })
}
