/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones de la migración 033: terminar
 * remallado (crudo → por voltear), Volteado, Tintorería y el bloqueo por rol
 * (exigir_modulo). Igual que el SQL: validan todo primero y solo después escriben.
 * `p.__uid` es el usuario de la sesión (en SQL, auth.uid()). Si no viene (pruebas
 * unitarias de otras funciones), el bloqueo por rol no se aplica.
 */
import { ErrorNegocio, nuevoId, tabla, ejecutarHandler, type Db, type ResultadoRpc } from './mockRpcComun'
import { tieneModulo, esColorDe, mermaTintoreria, destinoTrasRemallado, destinoTrasVolteado, MATERIALES_TINTORERIA } from '@/lib/domain/tintoreria'
import { hoyLocal } from '@/lib/domain/mantenimiento'

export const RPC_TINTORERIA = [
  'finalizar_lote_remallado',
  'iniciar_lote_volteado',
  'reportar_lote_volteado',
  'enviar_lote_tintoreria',
  'recibir_lote_tintoreria',
] as const

const ahora = () => new Date().toISOString()
const num = (v: unknown) => Number(v ?? 0) || 0
const red2 = (n: number) => Math.round(n * 100) / 100
const malNumero = (v: unknown) => v === null || v === undefined || v === '' || !Number.isFinite(Number(v))

/** exigir_modulo(): sesión de un usuario activo cuyo rol tenga el módulo. */
export function exigirModulo(db: Db, uid: string | null | undefined, modulo: string): string | null {
  if (uid === undefined) return null
  const u = uid ? tabla(db, 'usuarios').find(x => x.id === uid) : null
  if (!u || u.activo === false || !tieneModulo(u.rol, modulo)) throw new ErrorNegocio(`Tu rol no tiene acceso al módulo ${modulo}`)
  return u.id
}

function sumar(db: Db, nombre: string, mediaId: string, docenas: number) {
  const filas = tabla(db, nombre)
  const fila = filas.find(s => s.catalogo_media_id === mediaId)
  if (fila) { fila.docenas = red2(num(fila.docenas) + docenas); fila.updated_at = ahora() }
  else filas.push({ id: nuevoId(), catalogo_media_id: mediaId, docenas: red2(docenas), updated_at: ahora() })
}

const media = (db: Db, id: string) => tabla(db, 'catalogo_medias').find(c => c.id === id)

function finalizarRemallado(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'remallado')
  if (malNumero(p.p_docenas_remalladas) || num(p.p_docenas_remalladas) < 0 || num(p.p_docenas_restantes) < 0 || Number.isNaN(Number(p.p_docenas_restantes ?? 0))) {
    throw new ErrorNegocio('Las docenas no pueden ser negativas')
  }
  const lote = tabla(db, 'lotes_remallado').find(l => l.id === p.p_lote_id)
  if (!lote) throw new ErrorNegocio('Lote de remallado no encontrado')
  if (lote.estado !== 'en_proceso') throw new ErrorNegocio(`Este lote ya no está en proceso (estado: ${lote.estado})`)
  const hechas = num(p.p_docenas_remalladas)
  if (hechas > num(lote.docenas_pendientes)) throw new ErrorNegocio(`Se remallan ${hechas} docenas y el lote tiene ${num(lote.docenas_pendientes)} pendientes`)

  tabla(db, 'reportes_remallado').push({
    id: nuevoId(), lote_id: lote.id, remalladora_id: p.p_remalladora_id ?? null, maquina_id: p.p_maquina_id ?? null,
    docenas_remalladas: hechas, docenas_restantes: num(p.p_docenas_restantes), fecha: hoyLocal(), created_at: ahora(),
  })
  lote.estado = 'completado'
  lote.docenas_pendientes = num(p.p_docenas_restantes)
  // El producto sale del lote (antes lo mandaba la pantalla)
  if (hechas > 0) sumar(db, destinoTrasRemallado(!!media(db, lote.catalogo_media_id)?.es_crudo), lote.catalogo_media_id, hechas)
  const u = tabla(db, 'usuarios').find(x => x.id === p.p_remalladora_id)
  if (u) u.estado = 'disponible'
  const m = tabla(db, 'maquinas').find(x => x.id === p.p_maquina_id)
  if (m) m.estado = 'activa'
  return null
}

function iniciarVolteado(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'volteado')
  if (!tabla(db, 'usuarios').some(u => u.id === p.p_volteador_id && u.activo !== false)) throw new ErrorNegocio('Elige quién voltea')
  if (malNumero(p.p_docenas) || num(p.p_docenas) <= 0) throw new ErrorNegocio('Las docenas deben ser mayores a 0')
  const docenas = num(p.p_docenas)
  const hay = num(tabla(db, 'stock_listo_voltear').find(s => s.catalogo_media_id === p.p_catalogo_media_id)?.docenas)
  if (hay < docenas) throw new ErrorNegocio(`No hay suficiente stock por voltear de ${media(db, p.p_catalogo_media_id)?.codigo ?? 'la media'}: se asignan ${docenas} docenas y hay ${hay}`)
  sumar(db, 'stock_listo_voltear', p.p_catalogo_media_id, -docenas)
  const id = nuevoId()
  tabla(db, 'lotes_volteado').push({
    id, volteador_id: p.p_volteador_id, catalogo_media_id: p.p_catalogo_media_id, docenas_asignadas: docenas, docenas_pendientes: docenas, estado: 'en_proceso', created_at: ahora(),
  })
  return id
}

function reportarVolteado(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'volteado')
  if (malNumero(p.p_docenas) || num(p.p_docenas) <= 0) throw new ErrorNegocio('Ingresa las docenas volteadas')
  if (num(p.p_pares_defectuosos) < 0) throw new ErrorNegocio('Los pares defectuosos no pueden ser negativos')
  const lote = tabla(db, 'lotes_volteado').find(l => l.id === p.p_lote_id)
  if (!lote) throw new ErrorNegocio('Lote de volteado no encontrado')
  if (lote.estado !== 'en_proceso') throw new ErrorNegocio('Este lote ya está completado')
  const docenas = num(p.p_docenas)
  if (docenas > num(lote.docenas_pendientes)) throw new ErrorNegocio(`Se reportan ${docenas} docenas y el lote tiene ${num(lote.docenas_pendientes)} pendientes`)
  tabla(db, 'reportes_volteado').push({
    id: nuevoId(), lote_volteado_id: lote.id, volteador_id: lote.volteador_id, catalogo_media_id: lote.catalogo_media_id,
    docenas_volteadas: docenas, pares_defectuosos: Math.trunc(num(p.p_pares_defectuosos)), comentarios: String(p.p_comentarios ?? '').trim() || null,
    fecha: hoyLocal(), created_at: ahora(),
  })
  lote.docenas_pendientes = red2(num(lote.docenas_pendientes) - docenas)
  lote.estado = lote.docenas_pendientes === 0 ? 'completado' : 'en_proceso'
  sumar(db, destinoTrasVolteado(!!media(db, lote.catalogo_media_id)?.es_crudo), lote.catalogo_media_id, docenas)
  return null
}

function enviarTintoreria(db: Db, p: any) {
  const uid = exigirModulo(db, p.__uid, 'tintoreria')
  const crudo = media(db, p.p_crudo_id)
  if (!crudo?.es_crudo) throw new ErrorNegocio('Elige la media cruda que se envía')
  const color = media(db, p.p_color_id)
  if (!color || color.es_crudo) throw new ErrorNegocio('Elige el SKU de color en que vuelve')
  if ((color.estado ?? 'activo') !== 'activo') throw new ErrorNegocio(`El SKU ${color.codigo} está inactivo`)
  if (!esColorDe(color, crudo)) throw new ErrorNegocio(`El SKU ${color.codigo} no es de la misma media (modelo, público y talla) que ${crudo.codigo}`)
  if (!(MATERIALES_TINTORERIA as readonly string[]).includes(p.p_material)) throw new ErrorNegocio('Elige el material: algodón o poliéster')
  if (malNumero(p.p_docenas) || num(p.p_docenas) <= 0) throw new ErrorNegocio('Las docenas deben ser mayores a 0')
  if (!tabla(db, 'usuarios').some(u => u.id === p.p_remalladora_id)) throw new ErrorNegocio('Elige la operadora que remalló')
  const docenas = red2(num(p.p_docenas))
  const hay = num(tabla(db, 'stock_listo_tenir').find(s => s.catalogo_media_id === crudo.id)?.docenas)
  if (hay < docenas) throw new ErrorNegocio(`No hay suficiente stock por teñir de ${crudo.codigo}: se envían ${docenas} docenas y hay ${hay}`)
  sumar(db, 'stock_listo_tenir', crudo.id, -docenas)
  const id = nuevoId()
  tabla(db, 'lotes_tintoreria').push({
    id, crudo_id: crudo.id, color_id: color.id, material: p.p_material, docenas_enviadas: docenas, remalladora_id: p.p_remalladora_id,
    estado: 'en_tintoreria', docenas_recibidas: null, docenas_merma: null, motivo_merma: null, enviado_por: uid ?? null, recibido_por: null,
    fecha_envio: ahora(), fecha_recepcion: null,
  })
  return id
}

function recibirTintoreria(db: Db, p: any) {
  const uid = exigirModulo(db, p.__uid, 'tintoreria')
  if (malNumero(p.p_docenas_recibidas) || num(p.p_docenas_recibidas) < 0) throw new ErrorNegocio('Ingresa las docenas recibidas')
  const lote = tabla(db, 'lotes_tintoreria').find(l => l.id === p.p_lote_id)
  if (!lote) throw new ErrorNegocio('Lote de tintorería no encontrado')
  if (lote.estado !== 'en_tintoreria') throw new ErrorNegocio('Este lote ya fue recibido')
  const recibidas = red2(num(p.p_docenas_recibidas))
  if (recibidas > num(lote.docenas_enviadas)) throw new ErrorNegocio(`Se reciben ${recibidas} docenas y se enviaron ${num(lote.docenas_enviadas)}`)
  const merma = mermaTintoreria(lote.docenas_enviadas, recibidas)
  const motivo = String(p.p_motivo_merma ?? '').trim()
  if (merma > 0 && !motivo) throw new ErrorNegocio(`Faltan ${merma} docenas: indica el motivo de la merma`)
  Object.assign(lote, {
    estado: 'recibido', docenas_recibidas: recibidas, docenas_merma: merma, motivo_merma: merma > 0 ? motivo : null,
    recibido_por: uid ?? null, fecha_recepcion: ahora(),
  })
  if (recibidas > 0) sumar(db, 'stock_listo_planchar', lote.color_id, recibidas)
  return null
}

export function ejecutarRpcTintoreria(db: Db, fnName: string, params: any): ResultadoRpc | null {
  return ejecutarHandler({
    finalizar_lote_remallado: finalizarRemallado,
    iniciar_lote_volteado: iniciarVolteado,
    reportar_lote_volteado: reportarVolteado,
    enviar_lote_tintoreria: enviarTintoreria,
    recibir_lote_tintoreria: recibirTintoreria,
  }, db, fnName, params)
}
