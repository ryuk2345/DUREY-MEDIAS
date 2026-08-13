// Single Source of Truth: Máquinas y Mantenimiento
export type EstadoMaquina = 'activa' | 'ocupada' | 'malograda' | 'mantenimiento' | 'standby' | 'inactiva'

export const ESTADOS_MAQUINA_VALIDOS: Record<EstadoMaquina, { label: string; color: string; badge: string }> = {
  activa: { label: 'Operativa (Activa)', color: 'text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300' },
  ocupada: { label: 'En Marcha (Ocupada)', color: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-300' },
  malograda: { label: 'Falla Crítica', color: 'text-red-400', badge: 'bg-red-500/20 text-red-300' },
  mantenimiento: { label: 'En Mantenimiento', color: 'text-cyan-300', badge: 'bg-cyan-500/20 text-cyan-300' },
  standby: { label: 'Stand-by (Set Up)', color: 'text-slate-400', badge: 'bg-slate-700 text-slate-300' },
  inactiva: { label: 'Inactiva', color: 'text-slate-500', badge: 'bg-slate-800 text-slate-400' }
}

const TRANSICIONES_PERMITIDAS: Record<EstadoMaquina, EstadoMaquina[]> = {
  activa: ['ocupada', 'malograda', 'mantenimiento', 'standby', 'inactiva'],
  ocupada: ['activa', 'malograda'],
  malograda: ['mantenimiento'],
  mantenimiento: ['activa', 'standby', 'inactiva'],
  standby: ['activa', 'mantenimiento', 'inactiva'],
  inactiva: ['activa', 'mantenimiento', 'standby']
}

export function validarTransicionEstadoMaquina(actual: EstadoMaquina, nuevo: EstadoMaquina): { valido: boolean; error?: string } {
  if (actual === nuevo) return { valido: true }
  const permitidos = TRANSICIONES_PERMITIDAS[actual] || []
  if (!permitidos.includes(nuevo)) {
    return {
      valido: false,
      error: `Transición no permitida: no se puede cambiar directamente de '${actual}' a '${nuevo}'.`
    }
  }
  return { valido: true }
}

