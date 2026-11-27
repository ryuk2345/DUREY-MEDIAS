/**
 * Stock que se puede vender (decisión del dueño 2026-11-27, 2-A): lo que hay en sacos
 * (almacenados o por almacenar, como vista_stock_medias) menos lo ya vendido sin despachar
 * (ventas 'pendiente'). Los crudos no se venden. En la base: vista_stock_vendible y
 * registrar_venta (migración 035). Este archivo es la misma regla para el mock y la pantalla.
 */

export const ESTADOS_SACO_EN_STOCK = ['almacenado', 'pendiente_almacenar'] as const
export type FilaStockVendible = { catalogo_media_id: string; fisico: number; comprometidas: number; vendibles: number }

type Fila = Record<string, unknown>
const r2 = (n: number) => Math.round(n * 100) / 100

/** Por cada producto que no es crudo: docenas en sacos, comprometidas en ventas pendientes y vendibles. */
export function stockVendible(db: { paquetes?: Fila[]; ventas?: Fila[]; items_venta?: Fila[]; catalogo_medias?: Fila[] }): FilaStockVendible[] {
  const sumar = (m: Map<string, number>, k: unknown, v: unknown) => { if (k) m.set(String(k), (m.get(String(k)) ?? 0) + Number(v ?? 0)) }
  const fisico = new Map<string, number>()
  for (const p of db.paquetes ?? []) if ((ESTADOS_SACO_EN_STOCK as readonly string[]).includes(String(p.estado))) sumar(fisico, p.catalogo_media_id, p.docenas)
  const pendientes = new Set((db.ventas ?? []).filter(v => v.estado === 'pendiente').map(v => v.id))
  const comprometidas = new Map<string, number>()
  for (const i of db.items_venta ?? []) if (pendientes.has(i.venta_id)) sumar(comprometidas, i.catalogo_media_id, i.docenas)
  return (db.catalogo_medias ?? []).filter(c => !c.es_crudo).map(c => {
    const id = String(c.id)
    const f = r2(fisico.get(id) ?? 0), k = r2(comprometidas.get(id) ?? 0)
    return { catalogo_media_id: id, fisico: f, comprometidas: k, vendibles: r2(f - k) }
  })
}

/** Primer motivo por el que no se puede vender lo pedido, o null. Mismos textos que la base. */
export function motivoNoVendible(
  items: { catalogo_media_id: string; docenas: number }[],
  stock: FilaStockVendible[],
  catalogo: { id: string; codigo: string; es_crudo?: boolean | null }[],
): string | null {
  const codigo = (id: string) => catalogo.find(c => c.id === id)?.codigo ?? 'la media'
  const crudo = items.find(i => catalogo.find(c => c.id === i.catalogo_media_id)?.es_crudo)
  if (crudo) return `No se vende ${codigo(crudo.catalogo_media_id)}: es un producto crudo`
  const pedidas = new Map<string, number>()
  for (const i of items) pedidas.set(i.catalogo_media_id, (pedidas.get(i.catalogo_media_id) ?? 0) + Number(i.docenas))
  for (const [id, cant] of [...pedidas].sort((a, b) => codigo(a[0]).localeCompare(codigo(b[0])))) {
    const hay = stock.find(s => s.catalogo_media_id === id)?.vendibles ?? 0
    if (r2(cant) > hay) return `No hay stock suficiente de ${codigo(id)}: pides ${r2(cant)} docenas y hay ${Math.max(0, hay)} para vender`
  }
  return null
}
