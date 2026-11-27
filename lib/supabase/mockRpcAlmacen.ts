/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones de la migración 034: almacenar un saco,
 * trasladarlo entre salones y despachar eligiendo sacos completos. Igual que el SQL:
 * validan todo primero y solo después escriben. `p.__uid` es el usuario de la sesión.
 */
import { ErrorNegocio, nuevoId, tabla, ejecutarHandler, type Db, type ResultadoRpc } from './mockRpcComun'
import { exigirModulo } from './mockRpcTintoreria'
import { compararDespacho } from '@/lib/domain/despacho'
import { hoyLocal } from '@/lib/domain/mantenimiento'
import { validarTransicionEstadoPaquete, type EstadoPaquete } from '@/lib/domain/packaging'

export const RPC_ALMACEN = ['almacenar_paquete', 'trasladar_saco', 'despachar_venta_sacos'] as const

const ahora = () => new Date().toISOString()
const num = (v: unknown) => Number(v ?? 0) || 0

function movimiento(db: Db, m: Record<string, unknown>) {
  tabla(db, 'movimientos_stock').push({ id: nuevoId(), referencia: null, ubicacion_origen_id: null, ubicacion_destino_id: null, created_at: ahora(), ...m })
}

function almacenarPaquete(db: Db, p: any) {
  const uid = exigirModulo(db, p.__uid, 'almacen')
  if (!p.p_ubicacion_id || !tabla(db, 'ubicaciones').some(u => u.id === p.p_ubicacion_id && u.activo !== false)) {
    throw new ErrorNegocio('Selecciona un salón de destino válido')
  }
  let paquete: any
  if (p.p_paquete_id) {
    paquete = tabla(db, 'paquetes').find(x => x.id === p.p_paquete_id)
    if (!paquete) throw new ErrorNegocio('Paquete no encontrado')
    const v = validarTransicionEstadoPaquete(paquete.estado as EstadoPaquete, 'almacenado')
    if (!v.valido && paquete.estado !== 'almacenado') throw new ErrorNegocio(`El paquete ${paquete.codigo_paquete} no se puede almacenar (estado: ${paquete.estado})`)
    if (paquete.estado === 'almacenado' && paquete.ubicacion_id === p.p_ubicacion_id) return paquete.id
    const origen = paquete.estado === 'almacenado' ? paquete.ubicacion_id : null
    Object.assign(paquete, { estado: 'almacenado', ubicacion_id: p.p_ubicacion_id, updated_at: ahora() })
    if (origen) {
      const base = { referencia: p.p_referencia ?? null, paquete_id: paquete.id, ubicacion_origen_id: origen, ubicacion_destino_id: p.p_ubicacion_id, usuario_id: uid, docenas: paquete.docenas, catalogo_media_id: paquete.catalogo_media_id }
      movimiento(db, { ...base, tipo: 'traslado_salida', ubicacion_id: origen })
      movimiento(db, { ...base, tipo: 'traslado_entrada', ubicacion_id: p.p_ubicacion_id })
      return paquete.id
    }
  } else {
    if (!String(p.p_codigo_paquete ?? '').trim() || num(p.p_docenas) <= 0) {
      throw new ErrorNegocio('Indica el código del paquete y una cantidad de docenas mayor a 0')
    }
    if (!p.p_catalogo_media_id) throw new ErrorNegocio('Elige el SKU del saco')
    if (Array.isArray(p.p_detalles) && p.p_detalles.length > 1) throw new ErrorNegocio('Un saco lleva un solo SKU')
    paquete = {
      id: nuevoId(), codigo_paquete: String(p.p_codigo_paquete).trim(), catalogo_media_id: p.p_catalogo_media_id,
      docenas: num(p.p_docenas), total_pares: p.p_total_pares ?? null, ubicacion_id: p.p_ubicacion_id,
      detalles_contenido: p.p_detalles ?? null, estado: 'almacenado', fecha: hoyLocal(), created_at: ahora(),
    }
    tabla(db, 'paquetes').push(paquete)
  }
  movimiento(db, {
    tipo: p.p_tipo_movimiento || 'ingreso_salon', referencia: p.p_referencia ?? null, paquete_id: paquete.id, ubicacion_id: p.p_ubicacion_id,
    ubicacion_destino_id: p.p_ubicacion_id, usuario_id: uid, docenas: paquete.docenas, catalogo_media_id: paquete.catalogo_media_id,
  })
  return paquete.id
}

function trasladarSaco(db: Db, p: any) {
  const uid = exigirModulo(db, p.__uid, 'almacen')
  const saco = tabla(db, 'paquetes').find(x => x.id === p.p_paquete_id)
  if (!saco) throw new ErrorNegocio('Saco no encontrado')
  if (saco.estado !== 'almacenado' || !saco.ubicacion_id) throw new ErrorNegocio(`El saco ${saco.codigo_paquete} no está en un salón (estado: ${saco.estado})`)
  const destino = tabla(db, 'ubicaciones').find(u => u.id === p.p_ubicacion_destino_id)
  if (!destino || destino.activo === false) throw new ErrorNegocio('Elige un salón de destino activo')
  if (destino.id === saco.ubicacion_id) throw new ErrorNegocio(`El saco ya está en ${destino.nombre}`)
  const origen = saco.ubicacion_id
  Object.assign(saco, { ubicacion_id: destino.id, updated_at: ahora() })
  const base = { referencia: `Traslado a ${destino.nombre}`, paquete_id: saco.id, ubicacion_origen_id: origen, ubicacion_destino_id: destino.id, usuario_id: uid, docenas: saco.docenas, catalogo_media_id: saco.catalogo_media_id }
  movimiento(db, { ...base, tipo: 'traslado_salida', ubicacion_id: origen })
  movimiento(db, { ...base, tipo: 'traslado_entrada', ubicacion_id: destino.id })
  return null
}

function despacharVentaSacos(db: Db, p: any) {
  const uid = exigirModulo(db, p.__uid, 'despacho')
  const agencia = String(p.p_agencia ?? '').trim()
  if (!agencia) throw new ErrorNegocio('Selecciona una agencia de transporte')
  const ids: string[] = Array.isArray(p.p_sacos) ? p.p_sacos : []
  if (ids.length === 0) throw new ErrorNegocio('Elige los sacos que salen')
  if (new Set(ids).size !== ids.length) throw new ErrorNegocio('Un saco aparece más de una vez')
  const venta = tabla(db, 'ventas').find(v => v.id === p.p_venta_id)
  if (!venta) throw new ErrorNegocio('Venta no encontrada')
  if (venta.estado !== 'pendiente') throw new ErrorNegocio(`La venta ${venta.codigo_venta} ya fue despachada (estado: ${venta.estado})`)
  const sacos = ids.map(id => tabla(db, 'paquetes').find(x => x.id === id))
  if (sacos.some(s => !s)) throw new ErrorNegocio('Uno de los sacos no existe')
  const noDisp = [...sacos].sort((a, b) => a.codigo_paquete.localeCompare(b.codigo_paquete)).find(s => s.estado !== 'almacenado' || s.venta_id || !s.ubicacion_id)
  if (noDisp) throw new ErrorNegocio(`El saco ${noDisp.codigo_paquete} no está disponible en un salón (estado: ${noDisp.estado})`)
  const pedido = tabla(db, 'items_venta').filter(i => i.venta_id === venta.id).map(i => ({ catalogo_media_id: i.catalogo_media_id, docenas: num(i.docenas) }))
  const codigo = (id: string) => tabla(db, 'catalogo_medias').find(c => c.id === id)?.codigo ?? ''
  const fuera = [...sacos].sort((a, b) => a.codigo_paquete.localeCompare(b.codigo_paquete)).find(s => !pedido.some(l => l.catalogo_media_id === s.catalogo_media_id))
  if (fuera) throw new ErrorNegocio(`El saco ${fuera.codigo_paquete} es de ${codigo(fuera.catalogo_media_id)}, que no está en el pedido`)
  if (pedido.length === 0) throw new ErrorNegocio('El pedido no tiene productos para despachar')
  const comp = compararDespacho(pedido, sacos.map(s => ({ id: s.id, catalogo_media_id: s.catalogo_media_id, docenas: num(s.docenas) })))
  const falta = comp.filter(c => c.falta > 0).sort((a, b) => codigo(a.catalogo_media_id).localeCompare(codigo(b.catalogo_media_id)))[0]
  if (falta) throw new ErrorNegocio(`Faltan ${falta.falta} docenas de ${codigo(falta.catalogo_media_id)}: elige más sacos`)

  const guias = tabla(db, 'guias_remision')
  const max = guias.reduce((m, g) => Math.max(m, Number(String(g.codigo_guia).replace(/\D/g, '')) || 0), 9000)
  const codigoGuia = `GR-${max + 1}`
  const guiaId = nuevoId()
  guias.push({ id: guiaId, codigo_guia: codigoGuia, venta_id: venta.id, agencia, estado: 'entregado', fecha_despacho: hoyLocal(), fecha_entrega: hoyLocal(), despachado_por: uid ?? null, created_at: ahora() })
  for (const c of comp) tabla(db, 'despacho_detalle').push({ id: nuevoId(), guia_id: guiaId, venta_id: venta.id, catalogo_media_id: c.catalogo_media_id, docenas_pedidas: c.pedidas, docenas_entregadas: c.elegidas, created_at: ahora() })
  for (const s of sacos) {
    movimiento(db, {
      tipo: 'salida_venta', referencia: `Despacho ${venta.codigo_venta} — ${agencia}`, paquete_id: s.id, ubicacion_id: s.ubicacion_id, ubicacion_origen_id: s.ubicacion_id,
      usuario_id: uid ?? null, docenas: s.docenas, catalogo_media_id: s.catalogo_media_id, venta_id: venta.id, guia_id: guiaId,
    })
    Object.assign(s, { venta_id: venta.id, estado: 'entregado', ubicacion_id: null, updated_at: ahora() })
  }
  venta.estado = 'entregado'
  return codigoGuia
}

export function ejecutarRpcAlmacen(db: Db, fnName: string, params: any): ResultadoRpc | null {
  return ejecutarHandler({
    almacenar_paquete: almacenarPaquete,
    trasladar_saco: trasladarSaco,
    despachar_venta_sacos: despacharVentaSacos,
  }, db, fnName, params)
}
