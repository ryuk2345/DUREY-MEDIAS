/**
 * Repuestos y mecánicos (Fase 3). Única definición de estas reglas en la app;
 * las operaciones que tocan stock, caja o gastos son funciones atómicas de la
 * base (migración 029): aquí solo se busca, se suma y se muestra.
 */
import { normalizarBusqueda } from '@/lib/domain/catalogo'

export type FiltroStockRepuesto = 'todos' | 'con_stock' | 'agotados'

type RepuestoBuscable = { nombre: string; stock_actual: number | null }

/** Repuestos cuyo nombre contiene todas las palabras escritas (sin tildes ni mayúsculas) y que cumplen el filtro de stock. */
export function filtrarRepuestos<T extends RepuestoBuscable>(items: T[], texto: string, filtro: FiltroStockRepuesto): T[] {
  const palabras = normalizarBusqueda(texto).split(/\s+/).filter(Boolean)
  return items.filter(r => {
    const stock = Number(r.stock_actual ?? 0)
    if (filtro === 'con_stock' && stock <= 0) return false
    if (filtro === 'agotados' && stock > 0) return false
    const nombre = normalizarBusqueda(r.nombre ?? '')
    return palabras.every(p => nombre.includes(p))
  })
}

/** Total de una compra al contado, redondeado a céntimos (igual que la base). */
export function totalCompraRepuesto(cantidad: number, precioUnitario: number): number {
  return Math.round(cantidad * precioUnitario * 100) / 100
}

/** Costo de los repuestos usados en una falla: cantidad × costo del momento en que se usó. */
export function costoRepuestosUsados(usos: { cantidad: number; costo_unitario: number | null }[]): number {
  return Math.round(usos.reduce((t, u) => t + Number(u.cantidad) * Number(u.costo_unitario ?? 0), 0) * 100) / 100
}

export function nombreMecanico(m: { nombre?: string | null; apellido?: string | null } | null | undefined): string {
  const n = [m?.nombre?.trim(), m?.apellido?.trim()].filter(Boolean).join(' ')
  return n || 'Sin asignar'
}
