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
