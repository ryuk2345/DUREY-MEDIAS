// Single Source of Truth: búsqueda de productos del catálogo de medias

export interface ProductoBuscable {
  sku?: string | null
  codigo: string
  modelo?: string | null
  publico?: string | null
  diseno_color?: string | null
  talla?: string | null
}

// Minúsculas, sin tildes y con '_' '/' '-' como espacios: "niño_blanco" ≈ "nino blanco".
// Única definición para los buscadores (catálogo, repuestos).
export function normalizarBusqueda(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_/\-]+/g, ' ')
}

// Devuelve los productos que contienen TODAS las palabras escritas, en cualquier campo y orden.
// Texto vacío → lista completa.
export function filtrarCatalogo<T extends ProductoBuscable>(items: T[], texto: string): T[] {
  const palabras = normalizarBusqueda(texto).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return items
  return items.filter(item => {
    const campos = normalizarBusqueda(
      [item.sku, item.codigo, item.modelo, item.publico, item.diseno_color, item.talla].filter(Boolean).join(' ')
    )
    return palabras.every(p => campos.includes(p))
  })
}

/**
 * SKU y código fijos (Fase 7, decisiones 2-A y P2-A): el código nunca cambia y el SKU solo
 * se pone si estaba vacío. En la base: disparador catalogo_medias_identidad_fija (036).
 */
export function cambiaIdentidad(antes: { sku?: string | null; codigo: string }, despues: { sku?: string | null; codigo: string }): boolean {
  return despues.codigo !== antes.codigo || (antes.sku != null && antes.sku !== '' && (despues.sku ?? null) !== antes.sku)
}

// ── Sugerencias al escribir (Fase 7, decisión 1-A) ──────────────────────────────
export type Sugerencia = { id: string; etiqueta: string; detalle?: string }
export const MAX_SUGERENCIAS = 8

/**
 * Hasta 8 sugerencias que contienen TODAS las palabras escritas (sin tildes ni mayúsculas),
 * primero las que empiezan por lo escrito. `textos` da los campos en que se busca.
 */
export function sugerir<T>(items: T[], texto: string, aSugerencia: (item: T) => Sugerencia, textos: (item: T) => (string | null | undefined)[],
  max = MAX_SUGERENCIAS): Sugerencia[] {
  const escrito = normalizarBusqueda(texto).trim()
  const palabras = escrito.split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return []
  const conTexto = items.map(item => ({ item, campos: normalizarBusqueda(textos(item).filter(Boolean).join(' ')) }))
    .filter(x => palabras.every(p => x.campos.includes(p)))
  // 0: el texto entero empieza por lo escrito · 1: alguna palabra empieza · 2: lo contiene en medio
  const empieza = (x: { campos: string }) => x.campos.startsWith(palabras[0]) ? 0 : x.campos.split(/\s+/).some(w => w.startsWith(palabras[0])) ? 1 : 2
  return conTexto.sort((a, b) => empieza(a) - empieza(b)).slice(0, max).map(x => aSugerencia(x.item))
}

/** Sugerencias de productos del catálogo (SKU, código, modelo, público, color y talla). */
export function sugerirProductos<T extends ProductoBuscable & { id: string }>(items: T[], texto: string): Sugerencia[] {
  return sugerir(items, texto, p => ({ id: p.id, etiqueta: p.sku || p.codigo, detalle: [p.modelo, p.publico, p.diseno_color, p.talla].filter(Boolean).join(' · ') }),
    p => [p.sku, p.codigo, p.modelo, p.publico, p.diseno_color, p.talla])
}
