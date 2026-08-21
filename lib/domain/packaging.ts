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
