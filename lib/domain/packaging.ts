// Single Source of Truth: Empaque por SKU y Sacos Maestros

export type EstadoPaquete = 'pendiente_almacenar' | 'almacenado' | 'preparado_envio' | 'entregado'

const TRANSICIONES_PAQUETE: Record<EstadoPaquete, EstadoPaquete[]> = {
  pendiente_almacenar: ['almacenado', 'preparado_envio'],
  almacenado: ['preparado_envio'],
  preparado_envio: ['entregado', 'almacenado'],
  entregado: []
}

export function convertirDocenasAPares(docenas: number): number {
  const d = Math.max(0, docenas || 0)
  return Math.round(d * 12)
}

export function validarTransicionEstadoPaquete(actual: EstadoPaquete, nuevo: EstadoPaquete): { valido: boolean; error?: string } {
  if (actual === nuevo) return { valido: true }
  const permitidos = TRANSICIONES_PAQUETE[actual] || []
  if (!permitidos.includes(nuevo)) {
    return {
      valido: false,
      error: `Transición de paquete no válida: no se puede cambiar de '${actual}' a '${nuevo}'.`
    }
  }
  return { valido: true }
}

export interface ContenidoSaco { sku: string; codigo: string; docenas: number; pares: number }

/**
 * Contenido del QR de un Saco Maestro. Una sola definición para la etiqueta
 * inicial y la reimpresión (antes cada una usaba nombres de campo distintos).
 * Almacén solo usa `codigo_saco` para buscar el saco registrado; el resto es
 * informativo para quien lee el QR.
 */
export function construirQrSacoMaestro(saco: {
  codigo_saco: string
  preparador_id?: string | null
  preparador_nombre?: string | null
  salon_destino_id?: string | null
  salon_destino_nombre?: string | null
  total_docenas: number
  total_pares?: number | null
  items?: ContenidoSaco[] | null
}): string {
  return JSON.stringify({
    tipo: 'saco_maestro',
    codigo_saco: saco.codigo_saco,
    preparador_id: saco.preparador_id ?? null,
    preparador_nombre: saco.preparador_nombre ?? null,
    salon_destino_id: saco.salon_destino_id ?? null,
    salon_destino_nombre: saco.salon_destino_nombre ?? null,
    total_docenas: saco.total_docenas,
    total_pares: saco.total_pares ?? convertirDocenasAPares(saco.total_docenas),
    items: saco.items ?? [],
  })
}

/** Siguiente código de saco B-NNNN: mayor entre "cantidad + 1005" y "mayor B- existente + 1". */
export function siguienteCodigoSaco(codigosExistentes: string[]): string {
  const maximo = Math.max(0, ...codigosExistentes
    .filter(c => /^B-\d+$/i.test(c))
    .map(c => parseInt(c.slice(2), 10)))
  return `B-${Math.max(codigosExistentes.length + 1005, maximo + 1)}`
}
