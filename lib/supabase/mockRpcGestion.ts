/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones de la migración 036: catálogo, caja diaria,
 * clientes y egresos solo por funciones con módulo. Igual que el SQL: validan todo primero
 * y solo después escriben. `p.__uid` es el usuario de la sesión.
 */
import { ErrorNegocio, nuevoId, tabla, ejecutarHandler, type Db, type ResultadoRpc } from './mockRpcComun'
import { exigirModulo } from './mockRpcTintoreria'
import { tieneModulo } from '@/lib/domain/tintoreria'
import { cierreDeCaja } from '@/lib/domain/finance'
import { hoyLocal } from '@/lib/domain/mantenimiento'

export const RPC_GESTION = [
  'crear_producto', 'editar_producto', 'cambiar_estado_producto', 'eliminar_producto', 'crear_modelo_media',
  'abrir_caja', 'cerrar_caja', 'guardar_cliente', 'eliminar_cliente', 'registrar_egreso', 'eliminar_egreso',
] as const

const ahora = () => new Date().toISOString()
const texto = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown) => Number(v ?? 0) || 0

function exigirAlgunModulo(db: Db, uid: string | null | undefined, modulos: string[]) {
  if (uid === undefined) return null
  const u = uid ? tabla(db, 'usuarios').find(x => x.id === uid) : null
  if (!u || u.activo === false || !modulos.some(m => tieneModulo(u.rol, m))) {
    throw new ErrorNegocio(`Tu rol no tiene acceso al módulo ${modulos.join(' ni al módulo ')}`)
  }
  return u.id
}

function validarProducto(d: any) {
  if (!texto(d.modelo) || !texto(d.publico) || !texto(d.diseno_color) || !texto(d.talla)) throw new ErrorNegocio('Completa modelo, público, color y talla')
  const costo = d.costo_produccion_docena == null || d.costo_produccion_docena === '' ? -1 : Number(d.costo_produccion_docena)
  if (!(costo >= 0) || num(d.precio_venta_sugerido) < 0) throw new ErrorNegocio('El costo y el precio no pueden ser negativos')
}

function crearProducto(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'catalogo')
  const d = p.p_datos ?? {}
  validarProducto(d)
  if (!texto(d.codigo)) throw new ErrorNegocio('Falta el código del producto')
  const filas = tabla(db, 'catalogo_medias')
  if (filas.some(c => c.codigo === texto(d.codigo))) throw new ErrorNegocio(`Ya existe un producto con el código ${texto(d.codigo)}`)
  if (texto(d.sku) && filas.some(c => c.sku === texto(d.sku))) throw new ErrorNegocio(`Ya existe un producto con el SKU ${texto(d.sku)}`)
  const id = nuevoId()
  filas.push({
    id, sku: texto(d.sku) || null, codigo: texto(d.codigo), modelo: texto(d.modelo), publico: texto(d.publico),
    diseno_color: texto(d.diseno_color), talla: texto(d.talla), costo_produccion_docena: Number(d.costo_produccion_docena),
    precio_venta_sugerido: num(d.precio_venta_sugerido), es_crudo: Boolean(d.es_crudo), estado: 'activo', created_at: ahora(), updated_at: ahora(),
  })
  return id
}

function editarProducto(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'catalogo')
  const c = tabla(db, 'catalogo_medias').find(x => x.id === p.p_id)
  if (!c) throw new ErrorNegocio('Producto no encontrado')
  const d = p.p_datos ?? {}
  validarProducto(d)
  Object.assign(c, {
    // El código nunca cambia; el SKU solo se pone si estaba vacío (036)
    sku: c.sku ? c.sku : (texto(d.sku) || null),
    modelo: texto(d.modelo), publico: texto(d.publico), diseno_color: texto(d.diseno_color), talla: texto(d.talla),
    costo_produccion_docena: Number(d.costo_produccion_docena), precio_venta_sugerido: num(d.precio_venta_sugerido),
    es_crudo: d.es_crudo == null ? c.es_crudo : Boolean(d.es_crudo), updated_at: ahora(),
  })
  return null
}

function cambiarEstadoProducto(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'catalogo')
  if (!['activo', 'inactivo'].includes(p.p_estado)) throw new ErrorNegocio('Estado de producto inválido')
  const c = tabla(db, 'catalogo_medias').find(x => x.id === p.p_id)
  if (!c) throw new ErrorNegocio('Producto no encontrado')
  c.estado = p.p_estado; c.updated_at = ahora()
  return null
}

const TABLAS_CON_PRODUCTO = ['items_venta', 'paquetes', 'reportes_produccion', 'lotes_remallado', 'stock_listo_planchar', 'stock_listo_preparar',
  'stock_listo_voltear', 'stock_listo_tenir', 'movimientos_stock', 'productos_maquina', 'reportes_planchado', 'reportes_preparado']

function eliminarProducto(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'catalogo')
  const filas = tabla(db, 'catalogo_medias')
  const c = filas.find(x => x.id === p.p_id)
  if (!c) throw new ErrorNegocio('Producto no encontrado')
  if (TABLAS_CON_PRODUCTO.some(t => tabla(db, t).some(f => f.catalogo_media_id === c.id))) {
    throw new ErrorNegocio(`No se puede eliminar ${c.codigo}: ya tiene producción, stock o ventas. Desactívalo en su lugar`)
  }
  filas.splice(filas.indexOf(c), 1)
  return null
}

function crearModeloMedia(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'catalogo')
  if (!texto(p.p_nombre)) throw new ErrorNegocio('Ingresa el nombre del modelo')
  const id = nuevoId()
  tabla(db, 'modelos_media').push({ id, nombre: texto(p.p_nombre), activo: true, created_at: ahora() })
  return id
}

function abrirCaja(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'ventas')
  if (!p.p_asesora_id || !tabla(db, 'usuarios').some(u => u.id === p.p_asesora_id && u.activo !== false)) throw new ErrorNegocio('Elige la vendedora de la caja')
  const saldo = p.p_saldo_inicial == null ? -1 : Number(p.p_saldo_inicial)
  if (!(saldo >= 0)) throw new ErrorNegocio('El saldo inicial no puede ser negativo')
  const hoy = hoyLocal()
  const cajas = tabla(db, 'cajas_diarias')
  if (cajas.some(c => c.asesora_id === p.p_asesora_id && c.fecha === hoy)) throw new ErrorNegocio('Esa vendedora ya abrió su caja de hoy')
  const id = nuevoId()
  cajas.push({ id, asesora_id: p.p_asesora_id, fecha: hoy, saldo_inicial: saldo, ventas_efectivo: 0, ventas_digital: 0, cobros_efectivo: 0,
    cobros_digital: 0, pagos_efectivo: 0, estado: 'abierta', created_at: ahora() })
  return id
}

function cerrarCaja(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'ventas')
  const caja = tabla(db, 'cajas_diarias').find(c => c.id === p.p_caja_id)
  if (!caja) throw new ErrorNegocio('Caja no encontrada')
  if (caja.estado !== 'abierta') throw new ErrorNegocio('La caja ya está cerrada')
  const declarado = p.p_declarado_efectivo == null ? -1 : Number(p.p_declarado_efectivo)
  if (!(declarado >= 0)) throw new ErrorNegocio('El efectivo contado no puede ser negativo')
  const r = cierreDeCaja(caja, declarado)
  if (r.estado !== 'cerrada_cuadrada' && !texto(p.p_justificacion)) throw new ErrorNegocio('Escribe la justificación del faltante o sobrante')
  Object.assign(caja, { saldo_esperado_efectivo: r.esperado, saldo_declarado_efectivo: declarado, diferencia: r.diferencia, estado: r.estado,
    justificacion: texto(p.p_justificacion) || null })
  return r
}

function guardarCliente(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'clientes')
  const d = p.p_datos ?? {}
  const doc = texto(d.numero_documento)
  const tipo = texto(d.tipo_documento) || (doc.length === 11 ? 'ruc' : 'dni')
  if (!texto(d.nombre)) throw new ErrorNegocio('El nombre o razón social es obligatorio')
  if (!doc) throw new ErrorNegocio('El número de DNI o RUC es obligatorio')
  if (!['dni', 'ruc'].includes(tipo)) throw new ErrorNegocio('Tipo de documento inválido')
  const clientes = tabla(db, 'clientes')
  if (clientes.some(c => c.numero_documento === doc && c.id !== p.p_id)) throw new ErrorNegocio(`Ya hay un cliente con el documento ${doc}`)
  const datos = { tipo_documento: tipo, numero_documento: doc, nombre: texto(d.nombre), telefono: texto(d.telefono) || null, direccion: texto(d.direccion) || null }
  if (!p.p_id) {
    const id = nuevoId()
    clientes.push({ id, ...datos, created_at: ahora() })
    return id
  }
  const c = clientes.find(x => x.id === p.p_id)
  if (!c) throw new ErrorNegocio('Cliente no encontrado')
  Object.assign(c, datos)
  return c.id
}

function eliminarCliente(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'clientes')
  const clientes = tabla(db, 'clientes')
  const c = clientes.find(x => x.id === p.p_id)
  if (!c) throw new ErrorNegocio('Cliente no encontrado')
  if (tabla(db, 'ventas').some(v => v.cliente_id === c.id)) throw new ErrorNegocio(`No se puede eliminar a ${c.nombre}: tiene ventas registradas`)
  clientes.splice(clientes.indexOf(c), 1)
  return null
}

function registrarEgreso(db: Db, p: any) {
  exigirAlgunModulo(db, p.__uid, ['egresos', 'materia_prima'])
  if (!texto(p.p_concepto)) throw new ErrorNegocio('Escribe el concepto del gasto')
  if (!(num(p.p_monto) > 0)) throw new ErrorNegocio('El monto debe ser mayor a 0')
  if (!texto(p.p_categoria)) throw new ErrorNegocio('Elige la categoría del gasto')
  if (texto(p.p_comprobante_url) && !/^https?:\/\//i.test(texto(p.p_comprobante_url))) throw new ErrorNegocio('El comprobante debe ser un enlace que empiece con http:// o https://')
  const id = nuevoId()
  tabla(db, 'egresos_adicionales').push({ id, concepto: texto(p.p_concepto), monto: num(p.p_monto), categoria: texto(p.p_categoria),
    fecha: p.p_fecha || hoyLocal(), comprobante_url: texto(p.p_comprobante_url) || null, created_at: ahora() })
  return id
}

function eliminarEgreso(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'egresos')
  const egresos = tabla(db, 'egresos_adicionales')
  const e = egresos.find(x => x.id === p.p_id)
  if (!e) throw new ErrorNegocio('Egreso no encontrado')
  if (tabla(db, 'compras_repuestos').some(c => c.egreso_id === e.id)) throw new ErrorNegocio('Este gasto viene de una compra de repuestos: no se elimina aquí')
  egresos.splice(egresos.indexOf(e), 1)
  return null
}

export function ejecutarRpcGestion(db: Db, fnName: string, params: any): ResultadoRpc | null {
  return ejecutarHandler({
    crear_producto: crearProducto, editar_producto: editarProducto, cambiar_estado_producto: cambiarEstadoProducto,
    eliminar_producto: eliminarProducto, crear_modelo_media: crearModeloMedia, abrir_caja: abrirCaja, cerrar_caja: cerrarCaja,
    guardar_cliente: guardarCliente, eliminar_cliente: eliminarCliente, registrar_egreso: registrarEgreso, eliminar_egreso: eliminarEgreso,
  }, db, fnName, params)
}
