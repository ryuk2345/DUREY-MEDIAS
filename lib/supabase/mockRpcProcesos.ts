/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones RPC de la migración
 * 022_rpc_ventas_despacho_almacen_procesos.sql. Deben comportarse igual que el
 * SQL: validan todo primero y solo después escriben, así un error no deja
 * cambios a medias. mockDb.ts guarda la base solo si no hubo error.
 */
import { generarCodigoVenta, generarCodigoGuia } from '@/lib/utils'
import { validarTransicionEstadoPaquete, type EstadoPaquete } from '@/lib/domain/packaging'
import { ErrorNegocio, nuevoId, tabla, ejecutarHandler, type Db, type ResultadoRpc } from './mockRpcComun'

export const RPC_PROCESOS = [
  'registrar_venta',
  'registrar_cobro_cuotas',
  'despachar_venta',
  'almacenar_paquete',
  'iniciar_lote_remallado',
  'traspasar_lote_remallado',
  'registrar_produccion_planchado',
] as const

const hoy = () => new Date().toISOString().split('T')[0]
const num = (v: unknown) => Number(v ?? 0) || 0
const METODOS_PAGO = ['efectivo', 'yape', 'plin', 'transferencia']

/** Igual que _sumar_a_caja en SQL: suma a la caja abierta de hoy (prefiere la de la vendedora). */
function sumarACaja(db: Db, asesoraId: string | null, metodo: string, monto: number, esVenta: boolean) {
  if (monto <= 0) return
  const abiertas = tabla(db, 'cajas_diarias').filter(c => c.fecha === hoy() && c.estado === 'abierta')
  const caja = abiertas.find(c => (c.asesora_id ?? null) === (asesoraId ?? null)) ?? abiertas[0]
  if (!caja) return
  const campo = `${esVenta ? 'ventas' : 'cobros'}_${metodo === 'efectivo' ? 'efectivo' : 'digital'}`
  caja[campo] = num(caja[campo]) + monto
}

function registrarCobro(db: Db, c: { venta_id: string; cuota_id?: string | null; asesora_id: string | null; monto: number; metodo_pago: string }) {
  tabla(db, 'cobros').push({ id: nuevoId(), cuota_id: null, ...c, estado_validacion: 'validado', fecha: hoy(), created_at: new Date().toISOString() })
}

/** Misma regla que _siguiente_codigo en SQL: max(filas + base, mayor número existente + 1). */
function siguienteSecuencia(codigos: string[], base: number) {
  const maximo = Math.max(0, ...codigos.map(c => parseInt(String(c).replace(/\D/g, ''), 10) || 0))
  return Math.max(codigos.length + base, maximo + 1)
}

function registrarVenta(db: Db, p: any) {
  const cliente = p.p_cliente ?? {}
  const items: { catalogo_media_id: string; docenas: number; precio_docena: number }[] = p.p_items ?? []
  const cuotas: { numero_cuota: number; monto: number; fecha_vencimiento: string }[] = p.p_cuotas ?? []
  if (!p.p_asesora_id) throw new ErrorNegocio('Selecciona la vendedora / asesora encargada')
  if (!String(cliente.nombre ?? '').trim()) throw new ErrorNegocio('Ingresa el nombre o razón social del cliente')
  if (!String(cliente.numero_documento ?? '').trim()) throw new ErrorNegocio('Ingresa el DNI o RUC del cliente')
  if (!['directo', 'cuotas'].includes(p.p_tipo_pago)) throw new ErrorNegocio('Tipo de pago inválido')
  const metodo = p.p_metodo_pago ?? 'efectivo'
  if (!METODOS_PAGO.includes(metodo)) throw new ErrorNegocio('Método de pago inválido')
  if (!Array.isArray(items) || items.length === 0) throw new ErrorNegocio('Agrega al menos un producto a la venta')
  if (items.some(i => !i.catalogo_media_id || num(i.docenas) <= 0 || num(i.precio_docena) < 0)) {
    throw new ErrorNegocio('Cada producto necesita una media, docenas mayores a 0 y un precio válido')
  }
  if (p.p_tipo_pago === 'cuotas' && (!Array.isArray(cuotas) || cuotas.length === 0)) {
    throw new ErrorNegocio('Una venta a cuotas necesita su cronograma de pagos')
  }
  const total = items.reduce((s, i) => s + num(i.docenas) * num(i.precio_docena), 0)
  const adelanto = num(p.p_monto_adelanto)
  if (adelanto < 0 || adelanto > total) throw new ErrorNegocio('El adelanto debe estar entre 0 y el total de la venta')

  // ── Escrituras ──
  const doc = String(cliente.numero_documento).trim()
  const datosCliente = {
    tipo_documento: cliente.tipo_documento || 'dni',
    numero_documento: doc,
    nombre: String(cliente.nombre).trim(),
    telefono: String(cliente.telefono ?? '').trim(),
    direccion: String(cliente.direccion ?? '').trim(),
  }
  let c = tabla(db, 'clientes').find(x => x.numero_documento === doc)
  if (c) Object.assign(c, datosCliente)
  else {
    c = { id: nuevoId(), ...datosCliente, created_at: new Date().toISOString() }
    tabla(db, 'clientes').push(c)
  }

  const ventas = tabla(db, 'ventas')
  const codigo = generarCodigoVenta(siguienteSecuencia(ventas.map(v => v.codigo_venta), 1001))
  const ventaId = nuevoId()
  ventas.push({
    id: ventaId, codigo_venta: codigo, cliente_id: c.id, asesora_id: p.p_asesora_id, tipo_pago: p.p_tipo_pago,
    total_soles: total, monto_adelanto: adelanto, estado: 'pendiente', fecha: hoy(), created_at: new Date().toISOString(),
  })
  for (const i of items) {
    tabla(db, 'items_venta').push({
      id: nuevoId(), venta_id: ventaId, catalogo_media_id: i.catalogo_media_id, docenas: num(i.docenas),
      precio_docena: num(i.precio_docena), subtotal: num(i.docenas) * num(i.precio_docena),
    })
  }
  if (p.p_tipo_pago === 'cuotas') {
    for (const q of cuotas) {
      tabla(db, 'cuotas').push({
        id: nuevoId(), venta_id: ventaId, numero_cuota: q.numero_cuota, monto: num(q.monto),
        fecha_vencimiento: q.fecha_vencimiento, estado: 'pendiente', created_at: new Date().toISOString(),
      })
    }
  }
  // Cobro al momento de la venta: total (contado) o adelanto (cuotas)
  const cobrado = p.p_tipo_pago === 'directo' ? total : adelanto
  if (cobrado > 0) {
    registrarCobro(db, { venta_id: ventaId, asesora_id: p.p_asesora_id, monto: cobrado, metodo_pago: metodo })
    sumarACaja(db, p.p_asesora_id, metodo, cobrado, true)
  }
  return { venta_id: ventaId, codigo_venta: codigo, total_soles: total, monto_cobrado: cobrado }
}

function registrarCobroCuotas(db: Db, p: any) {
  const ids: string[] = Array.isArray(p.p_cuota_ids) ? p.p_cuota_ids : []
  if (ids.length === 0) throw new ErrorNegocio('Selecciona al menos una cuota')
  if (!METODOS_PAGO.includes(p.p_metodo_pago)) throw new ErrorNegocio('Método de pago inválido')
  const cuotas = ids.map(id => tabla(db, 'cuotas').find(q => q.id === id))
  if (cuotas.some(q => !q)) throw new ErrorNegocio('Una de las cuotas no existe')
  for (const q of cuotas) {
    if (q.estado === 'pagada') {
      const venta = tabla(db, 'ventas').find(v => v.id === q.venta_id)
      throw new ErrorNegocio(`La cuota N° ${q.numero_cuota} de la venta ${venta?.codigo_venta ?? ''} ya está pagada`)
    }
  }
  let total = 0
  for (const q of cuotas) {
    const venta = tabla(db, 'ventas').find(v => v.id === q.venta_id)
    Object.assign(q, { estado: 'pagada', metodo_pago: p.p_metodo_pago, comprobante_url: p.p_comprobante_url ?? null })
    registrarCobro(db, { venta_id: q.venta_id, cuota_id: q.id, asesora_id: p.p_asesora_id ?? venta?.asesora_id ?? null, monto: num(q.monto), metodo_pago: p.p_metodo_pago })
    total += num(q.monto)
  }
  sumarACaja(db, p.p_asesora_id ?? null, p.p_metodo_pago, total, false)
  return total
}

const ESTADOS_EN_STOCK = ['almacenado', 'pendiente_almacenar']

function despacharVenta(db: Db, p: any) {
  if (!String(p.p_agencia ?? '').trim()) throw new ErrorNegocio('Selecciona una agencia de transporte')
  const lineas: { catalogo_media_id: string; docenas: number }[] = (p.p_lineas ?? []).filter((l: any) => num(l.docenas) > 0)
  if (lineas.length === 0) throw new ErrorNegocio('El pedido no tiene productos para despachar')
  const venta = tabla(db, 'ventas').find(v => v.id === p.p_venta_id)
  if (!venta) throw new ErrorNegocio('Venta no encontrada')
  if (venta.estado !== 'pendiente') throw new ErrorNegocio(`La venta ${venta.codigo_venta} ya fue despachada (estado: ${venta.estado})`)

  const porOrden = (a: any, b: any) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id))
  const aEntregar: any[] = []
  for (const l of lineas) {
    const disponibles = tabla(db, 'paquetes')
      .filter(x => x.catalogo_media_id === l.catalogo_media_id && ESTADOS_EN_STOCK.includes(x.estado))
      .sort(porOrden)
    const stock = disponibles.reduce((s, x) => s + num(x.docenas), 0)
    if (stock < num(l.docenas)) {
      throw new ErrorNegocio(`Stock insuficiente para despachar: se necesitan ${num(l.docenas)} docenas y hay ${stock} en almacén`)
    }
    let faltantes = num(l.docenas)
    for (const paq of disponibles) {
      if (faltantes <= 0) break
      aEntregar.push(paq)
      faltantes -= num(paq.docenas)
    }
  }

  // ── Escrituras ──
  for (const paq of aEntregar) Object.assign(paq, { venta_id: venta.id, estado: 'entregado', ubicacion_id: null, updated_at: new Date().toISOString() })
  const guias = tabla(db, 'guias_remision')
  const codigo = generarCodigoGuia(siguienteSecuencia(guias.map(g => g.codigo_guia), 9001))
  guias.push({
    id: nuevoId(), codigo_guia: codigo, venta_id: venta.id, agencia: String(p.p_agencia).trim(), estado: 'entregado',
    fecha_despacho: hoy(), fecha_entrega: hoy(), created_at: new Date().toISOString(),
  })
  venta.estado = 'entregado'
  for (const l of lineas) {
    tabla(db, 'movimientos_stock').push({
      id: nuevoId(), tipo: 'salida_venta', referencia: `Despacho ${venta.codigo_venta} — ${String(p.p_agencia).trim()}`,
      docenas: num(l.docenas), created_at: new Date().toISOString(),
    })
  }
  return codigo
}

function almacenarPaquete(db: Db, p: any) {
  if (!p.p_ubicacion_id || !tabla(db, 'ubicaciones').some(u => u.id === p.p_ubicacion_id)) {
    throw new ErrorNegocio('Selecciona un salón de destino válido')
  }
  let paquete: any
  if (p.p_paquete_id) {
    paquete = tabla(db, 'paquetes').find(x => x.id === p.p_paquete_id)
    if (!paquete) throw new ErrorNegocio('Paquete no encontrado')
    const v = validarTransicionEstadoPaquete(paquete.estado as EstadoPaquete, 'almacenado')
    if (!v.valido) throw new ErrorNegocio(`El paquete ${paquete.codigo_paquete} no se puede almacenar (estado: ${paquete.estado})`)
    Object.assign(paquete, { estado: 'almacenado', ubicacion_id: p.p_ubicacion_id, updated_at: new Date().toISOString() })
  } else {
    if (!String(p.p_codigo_paquete ?? '').trim() || num(p.p_docenas) <= 0) {
      throw new ErrorNegocio('Indica el código del paquete y una cantidad de docenas mayor a 0')
    }
    paquete = {
      id: nuevoId(), codigo_paquete: String(p.p_codigo_paquete).trim(), catalogo_media_id: p.p_catalogo_media_id ?? null,
      docenas: num(p.p_docenas), total_pares: p.p_total_pares ?? null, ubicacion_id: p.p_ubicacion_id,
      detalles_contenido: p.p_detalles ?? null, estado: 'almacenado', fecha: hoy(), created_at: new Date().toISOString(),
    }
    tabla(db, 'paquetes').push(paquete)
  }
  tabla(db, 'movimientos_stock').push({
    id: nuevoId(), tipo: p.p_tipo_movimiento || 'ingreso_salon', referencia: p.p_referencia ?? null, paquete_id: paquete.id,
    ubicacion_id: p.p_ubicacion_id, docenas: p.p_docenas ?? paquete.docenas, created_at: new Date().toISOString(),
  })
  return paquete.id
}

function maquinaLibre(db: Db, id: string, mensajeSinMaquina: string, prefijo = 'La máquina') {
  const maq = tabla(db, 'maquinas').find(m => m.id === id)
  if (!maq) throw new ErrorNegocio(mensajeSinMaquina)
  if (maq.estado !== 'activa') throw new ErrorNegocio(`${prefijo} ${maq.codigo} no está disponible (estado: ${maq.estado})`)
  return maq
}

function marcarOcupada(db: Db, maq: any, usuarioId: string) {
  maq.estado = 'ocupada'
  const u = tabla(db, 'usuarios').find(x => x.id === usuarioId)
  if (u) u.estado = 'ocupada'
}

function iniciarLoteRemallado(db: Db, p: any) {
  if (!p.p_remalladora_id) throw new ErrorNegocio('Selecciona una operadora remalladora')
  if (!p.p_catalogo_media_id) throw new ErrorNegocio('Selecciona el tipo de media a remallar')
  if (num(p.p_docenas) <= 0) throw new ErrorNegocio('Las docenas asignadas deben ser mayores a 0')
  const maq = maquinaLibre(db, p.p_maquina_id, 'Selecciona una máquina remalladora')

  const loteId = nuevoId()
  tabla(db, 'lotes_remallado').push({
    id: loteId, catalogo_media_id: p.p_catalogo_media_id, remalladora_id: p.p_remalladora_id, maquina_remalladora_id: maq.id,
    docenas_asignadas: num(p.p_docenas), docenas_pendientes: num(p.p_docenas), estado: 'en_proceso', fecha: hoy(), created_at: new Date().toISOString(),
  })
  marcarOcupada(db, maq, p.p_remalladora_id)
  return loteId
}

function traspasarLoteRemallado(db: Db, p: any) {
  const docenas = num(p.p_docenas)
  if (docenas <= 0) throw new ErrorNegocio('Cantidad inválida')
  if (!p.p_remalladora_destino_id) throw new ErrorNegocio('Selecciona la remalladora destino')
  const origen = tabla(db, 'lotes_remallado').find(l => l.id === p.p_lote_origen_id)
  if (!origen) throw new ErrorNegocio('Lote de origen no encontrado')
  if (origen.estado !== 'en_proceso') throw new ErrorNegocio(`Solo se puede traspasar desde un lote en proceso (estado: ${origen.estado})`)
  if (docenas > num(origen.docenas_pendientes)) {
    throw new ErrorNegocio(`La cantidad a traspasar (${docenas}) excede las docenas pendientes del lote de origen (${num(origen.docenas_pendientes)})`)
  }
  const maq = maquinaLibre(db, p.p_maquina_destino_id, 'Selecciona la máquina destino', 'La máquina destino')

  origen.docenas_pendientes = num(origen.docenas_pendientes) - docenas
  const loteId = nuevoId()
  tabla(db, 'lotes_remallado').push({
    id: loteId, catalogo_media_id: origen.catalogo_media_id, remalladora_id: p.p_remalladora_destino_id, maquina_remalladora_id: maq.id,
    docenas_asignadas: docenas, docenas_pendientes: docenas, estado: 'en_proceso', fecha: hoy(), created_at: new Date().toISOString(),
  })
  marcarOcupada(db, maq, p.p_remalladora_destino_id)
  return loteId
}

function registrarProduccionPlanchado(db: Db, p: any) {
  const items: any[] = Array.isArray(p.p_items) ? p.p_items : []
  const conDatos = items.filter(i => num(i.docenas_planchadas) + num(i.docenas_defectuosas) > 0)
  if (conDatos.length === 0) throw new ErrorNegocio('Ingresa al menos una docena planchada o defectuosa para guardar')
  if (items.some(i => num(i.docenas_planchadas) < 0 || num(i.docenas_defectuosas) < 0 || !i.catalogo_media_id)) {
    throw new ErrorNegocio('Las docenas no pueden ser negativas')
  }
  const porMedia = new Map<string, number>()
  for (const i of conDatos) porMedia.set(i.catalogo_media_id, (porMedia.get(i.catalogo_media_id) ?? 0) + num(i.docenas_planchadas) + num(i.docenas_defectuosas))
  for (const [mediaId, total] of porMedia) {
    const stock = num(tabla(db, 'stock_listo_planchar').find(s => s.catalogo_media_id === mediaId)?.docenas)
    if (stock < total) {
      const codigo = tabla(db, 'catalogo_medias').find(c => c.id === mediaId)?.codigo ?? 'la media'
      throw new ErrorNegocio(`No hay suficiente stock listo para planchar de ${codigo}: se registran ${total} docenas y hay ${stock}`)
    }
  }

  for (const [mediaId, total] of porMedia) {
    const fila = tabla(db, 'stock_listo_planchar').find(s => s.catalogo_media_id === mediaId)
    fila.docenas = num(fila.docenas) - total
    fila.updated_at = new Date().toISOString()
  }
  for (const i of conDatos) {
    tabla(db, 'reportes_planchado').push({
      id: nuevoId(), planchador_id: i.planchador_id ?? null, catalogo_media_id: i.catalogo_media_id,
      docenas_planchadas: num(i.docenas_planchadas), docenas_defectuosas: num(i.docenas_defectuosas), fecha: hoy(), created_at: new Date().toISOString(),
    })
  }
  return conDatos.length
}

/**
 * Ejecuta una RPC de ventas/despacho/almacén/remallado/planchado sobre `db`.
 * Devuelve null si `fnName` no es de este módulo.
 */
export function ejecutarRpcProcesos(db: Db, fnName: string, params: any): ResultadoRpc | null {
  return ejecutarHandler({
    registrar_venta: registrarVenta,
    registrar_cobro_cuotas: registrarCobroCuotas,
    despachar_venta: despacharVenta,
    almacenar_paquete: almacenarPaquete,
    iniciar_lote_remallado: iniciarLoteRemallado,
    traspasar_lote_remallado: traspasarLoteRemallado,
    registrar_produccion_planchado: registrarProduccionPlanchado,
  }, db, fnName, params)
}
