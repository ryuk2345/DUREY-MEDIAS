/**
 * DNI y RUC de clientes (Fase 6B). Única definición de qué número es válido y de cómo se
 * lee la respuesta de Decolecta (RENIEC y SUNAT). Documentación leída el 2026-11-27:
 *   https://decolecta.gitbook.io/docs/servicios/integrations-2.md  (DNI)
 *   https://decolecta.gitbook.io/docs/servicios/integrations.md    (RUC básico)
 */

export type TipoDocumento = 'dni' | 'ruc'
export type DatosDocumento = { tipo_documento: TipoDocumento; numero_documento: string; nombre: string; direccion: string }

export const DECOLECTA_URL = 'https://api.decolecta.com/v1'

/** 'dni' si son 8 dígitos; 'ruc' si son 11 dígitos y empieza como un RUC (10, 15, 16, 17 o 20); si no, null. */
export function tipoDocumento(numero: string): TipoDocumento | null {
  const n = numero.trim()
  if (/^\d{8}$/.test(n)) return 'dni'
  if (/^(10|15|16|17|20)\d{9}$/.test(n)) return 'ruc'
  return null
}

/** Ruta de Decolecta para el número (ya validado). */
export function urlDecolecta(tipo: TipoDocumento, numero: string): string {
  return `${DECOLECTA_URL}/${tipo === 'dni' ? 'reniec/dni' : 'sunat/ruc'}?numero=${encodeURIComponent(numero)}`
}

const texto = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** Solo los datos que la venta necesita; null si la respuesta no trae un nombre. */
export function normalizarDecolecta(tipo: TipoDocumento, numero: string, json: unknown): DatosDocumento | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (tipo === 'dni') {
    const nombre = texto(r.full_name) || [r.first_name, r.first_last_name, r.second_last_name].map(texto).filter(Boolean).join(' ')
    if (!nombre) return null
    return { tipo_documento: 'dni', numero_documento: texto(r.document_number) || numero, nombre, direccion: '' }
  }
  const nombre = texto(r.razon_social)
  if (!nombre) return null
  const lugar = [r.distrito, r.provincia, r.departamento].map(texto).filter(Boolean).join(' - ')
  const direccion = [texto(r.direccion), lugar].filter(Boolean).join(', ')
  return { tipo_documento: 'ruc', numero_documento: texto(r.numero_documento) || numero, nombre, direccion }
}
