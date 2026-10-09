// Single Source of Truth: búsqueda de productos del catálogo de medias

export interface ProductoBuscable {
  sku?: string | null
  codigo: string
  modelo?: string | null
  publico?: string | null
  diseno_color?: string | null
  talla?: string | null
}

// Minúsculas, sin tildes y con '_' '/' '-' como espacios: "niño_blanco" ≈ "nino blanco"
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_/\-]+/g, ' ')
}

// Devuelve los productos que contienen TODAS las palabras escritas, en cualquier campo y orden.
// Texto vacío → lista completa.
export function filtrarCatalogo<T extends ProductoBuscable>(items: T[], texto: string): T[] {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return items
  return items.filter(item => {
    const campos = normalizar(
      [item.sku, item.codigo, item.modelo, item.publico, item.diseno_color, item.talla].filter(Boolean).join(' ')
    )
    return palabras.every(p => campos.includes(p))
  })
}
