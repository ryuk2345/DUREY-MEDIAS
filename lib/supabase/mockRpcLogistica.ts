/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones de agencias y almacenes de la
 * migración 027_agencias_pagos_proveedores_almacenes.sql. Mismas reglas y
 * mensajes que el SQL; mockDb.ts guarda la base solo si no hubo error.
 */
import { ErrorNegocio, nuevoId, tabla, ejecutarHandler, type Db, type ResultadoRpc } from './mockRpcComun'

export const RPC_LOGISTICA = [
  'registrar_agencia',
  'crear_ubicacion',
  'renombrar_ubicacion',
  'desactivar_ubicacion',
] as const

const normalizar = (s: unknown) => String(s ?? '').trim().toLowerCase()

function registrarAgencia(db: Db, p: any) {
  const nombre = String(p.p_nombre ?? '').trim()
  if (!nombre) throw new ErrorNegocio('Ingresa el nombre de la agencia')
  const existente = tabla(db, 'agencias').find(a => normalizar(a.nombre) === nombre.toLowerCase())
  if (existente) {
    if (existente.activo !== false) throw new ErrorNegocio(`La agencia ${nombre} ya está registrada`)
    existente.activo = true
    return existente.id
  }
  const id = nuevoId()
  tabla(db, 'agencias').push({ id, nombre, activo: true, created_at: new Date().toISOString() })
  return id
}

function crearUbicacion(db: Db, p: any) {
  const nombre = String(p.p_nombre ?? '').trim()
  const tipo = p.p_tipo ?? 'salon'
  if (!nombre) throw new ErrorNegocio('Ingresa el nombre del almacén')
  if (!['salon', 'almacen_general'].includes(tipo)) throw new ErrorNegocio('Tipo de almacén inválido')
  const existente = tabla(db, 'ubicaciones').find(u => normalizar(u.nombre) === nombre.toLowerCase())
  if (existente) {
    if (existente.activo !== false) throw new ErrorNegocio(`Ya existe un almacén llamado ${nombre}`)
    existente.activo = true
    return existente.id
  }
  const id = nuevoId()
  tabla(db, 'ubicaciones').push({ id, nombre, tipo, activo: true })
  return id
}

function renombrarUbicacion(db: Db, p: any) {
  const nombre = String(p.p_nombre ?? '').trim()
  if (!nombre) throw new ErrorNegocio('Ingresa el nombre del almacén')
  const ub = tabla(db, 'ubicaciones').find(u => u.id === p.p_id)
  if (!ub) throw new ErrorNegocio('Almacén no encontrado')
  const otros = tabla(db, 'ubicaciones').filter(u => u.id !== p.p_id && normalizar(u.nombre) === nombre.toLowerCase())
  if (otros.some(u => u.activo !== false)) throw new ErrorNegocio(`Ya existe un almacén llamado ${nombre}`)
  if (otros.length > 0) {
    throw new ErrorNegocio(`El nombre ${nombre} pertenece a un almacén eliminado. Créalo con ese nombre para reactivarlo.`)
  }
  ub.nombre = nombre
  return null
}

function desactivarUbicacion(db: Db, p: any) {
  const ub = tabla(db, 'ubicaciones').find(u => u.id === p.p_id)
  if (!ub) throw new ErrorNegocio('Almacén no encontrado')
  const dentro = tabla(db, 'paquetes').filter(pq => pq.ubicacion_id === p.p_id && pq.estado !== 'entregado').length
  if (dentro > 0) {
    throw new ErrorNegocio(`No se puede eliminar ${ub.nombre}: tiene ${dentro} paquete(s) dentro. Muévelos o despáchalos primero.`)
  }
  ub.activo = false
  return null
}

export function ejecutarRpcLogistica(db: Db, fnName: string, params: any): ResultadoRpc | null {
  return ejecutarHandler({
    registrar_agencia: registrarAgencia,
    crear_ubicacion: crearUbicacion,
    renombrar_ubicacion: renombrarUbicacion,
    desactivar_ubicacion: desactivarUbicacion,
  }, db, fnName, params)
}
