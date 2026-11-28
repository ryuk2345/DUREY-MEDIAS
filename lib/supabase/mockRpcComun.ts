import { hoyLocal } from '@/lib/domain/mantenimiento'
/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/** Utilidades compartidas por las emulaciones locales de funciones RPC (mockRpc*.ts). */

export type Db = Record<string, any[]>
export type ResultadoRpc = { data: unknown; error: { message: string } | null }

/** Error de regla de negocio: se devuelve al usuario como mensaje, igual que RAISE EXCEPTION en SQL. */
export class ErrorNegocio extends Error {}

export function nuevoId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'mock-' + Math.random().toString(36).slice(2, 11)
}

export function tabla(db: Db, nombre: string) {
  if (!db[nombre]) db[nombre] = []
  return db[nombre]
}

/** Ejecuta un handler RPC y convierte las excepciones en { error } como hace supabase-js. */
export function ejecutarHandler(
  handlers: Record<string, (db: Db, p: any) => unknown>,
  db: Db,
  fnName: string,
  params: any
): ResultadoRpc | null {
  const handler = handlers[fnName]
  if (!handler) return null
  try {
    return { data: handler(db, params ?? {}), error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

// Día de Lima, igual que la base desde la 036 (antes UTC)
const hoyIso = () => hoyLocal()

/**
 * Caja abierta de hoy para quien paga: la suya; si no tiene, la general (sin asesora);
 * si no, la más antigua. Igual que el SQL de las migraciones 027 y 029 (_caja_abierta_hoy).
 */
export function cajaAbiertaHoy(db: Db, usuario: string | null): any | null {
  const abiertas = tabla(db, 'cajas_diarias')
    .filter(c => c.fecha === hoyIso() && c.estado === 'abierta')
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  return (usuario && abiertas.find(c => c.asesora_id === usuario)) ?? abiertas.find(c => c.asesora_id == null) ?? abiertas[0] ?? null
}

/** "Caja general" o el nombre de la asesora dueña de la caja. */
export function nombreCaja(db: Db, caja: any | null): string | null {
  if (!caja) return null
  return caja.asesora_id == null ? 'Caja general' : (tabla(db, 'usuarios').find(u => u.id === caja.asesora_id)?.nombre ?? null)
}
