/** La API de Supabase devuelve como mucho 1000 filas por consulta: se lee por páginas para no cortar en silencio. */
export const PAGINA = 1000
export type Resultado = { data: unknown[] | null; error: { message: string } | null }

/** Junta todas las páginas de una consulta ordenada; `consulta` recibe el rango (ambos incluidos). */
export async function todasLasFilas(consulta: (desde: number, hasta: number) => PromiseLike<Resultado>, pagina = PAGINA): Promise<Resultado> {
  const filas: unknown[] = []
  for (let desde = 0; ; desde += pagina) {
    const r = await consulta(desde, desde + pagina - 1)
    if (r.error) return { data: null, error: r.error }
    filas.push(...(r.data ?? []))
    if ((r.data ?? []).length < pagina) return { data: filas, error: null }
  }
}
