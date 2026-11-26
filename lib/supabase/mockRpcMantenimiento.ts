/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones RPC de la migración
 * 029_repuestos_mecanicos.sql: compras de repuestos, mecánicos en fallas y
 * repuestos usados. Validan todo antes de escribir.
 */
import { ErrorNegocio, nuevoId, tabla, ejecutarHandler, cajaAbiertaHoy, nombreCaja, type Db, type ResultadoRpc } from './mockRpcComun'
import { totalCompraRepuesto, costoRepuestosUsados, nombreMecanico } from '@/lib/domain/repuestos'

export const RPC_MANTENIMIENTO = [
  'registrar_compra_repuesto',
  'asignar_mecanico_averia',
  'iniciar_reparacion_mecanico',
  'usar_repuesto_en_averia',
  'quitar_repuesto_de_averia',
  'cerrar_reparacion_averia',
] as const

const METODOS_PAGO = ['efectivo', 'transferencia', 'yape_plin', 'otro']
const num = (v: unknown) => Number(v ?? 0) || 0
const ahora = () => new Date().toISOString()
const hoy = () => ahora().split('T')[0]

function registrarCompraRepuesto(db: Db, p: any) {
  const cantidad = Math.trunc(num(p.p_cantidad))
  if (cantidad <= 0) throw new ErrorNegocio('La cantidad debe ser mayor a 0')
  if (p.p_precio_unitario == null || num(p.p_precio_unitario) < 0) throw new ErrorNegocio('El precio no puede ser negativo')
  if (!METODOS_PAGO.includes(p.p_metodo_pago)) throw new ErrorNegocio('Método de pago inválido')
  const fecha = p.p_fecha || hoy()
  if (fecha > hoy()) throw new ErrorNegocio('La fecha de compra no puede ser futura')
  if (p.p_proveedor_id && !tabla(db, 'proveedores').some(x => x.id === p.p_proveedor_id)) throw new ErrorNegocio('Proveedor no encontrado')
  const rep = tabla(db, 'repuestos').find(r => r.id === p.p_repuesto_id)
  if (!rep) throw new ErrorNegocio('Repuesto no encontrado')

  const precio = num(p.p_precio_unitario)
  const total = totalCompraRepuesto(cantidad, precio)
  rep.stock_actual = num(rep.stock_actual) + cantidad
  rep.costo_unitario = precio

  let egresoId: string | null = null
  if (total > 0) {
    egresoId = nuevoId()
    tabla(db, 'egresos_adicionales').push({
      id: egresoId, concepto: `Compra repuesto: ${rep.nombre} (${cantidad} uds.)`, monto: total, categoria: 'repuestos', fecha, created_at: ahora(),
    })
  }

  const deCaja = p.p_metodo_pago === 'efectivo' && Boolean(p.p_de_caja)
  const usuario = p.p_usuario_id ?? null
  const caja = deCaja && fecha === hoy() && total > 0 ? cajaAbiertaHoy(db, usuario) : null
  if (caja) caja.pagos_efectivo = num(caja.pagos_efectivo) + total

  const compraId = nuevoId()
  tabla(db, 'compras_repuestos').push({
    id: compraId, repuesto_id: rep.id, proveedor_id: p.p_proveedor_id || null, cantidad, precio_unitario: precio, total,
    metodo_pago: p.p_metodo_pago, de_caja: deCaja, fecha, caja_id: caja?.id ?? null, egreso_id: egresoId,
    registrado_por: usuario, created_at: ahora(),
  })
  return { compra_id: compraId, egreso_id: egresoId, total, caja_id: caja?.id ?? null, descontado_de_caja: Boolean(caja), caja_de: nombreCaja(db, caja) }
}

function averia(db: Db, id: string) {
  const a = tabla(db, 'averias_maquinas').find(x => x.id === id)
  if (!a) throw new ErrorNegocio('Avería no encontrada')
  return a
}

function asignarMecanico(db: Db, p: any) {
  const a = averia(db, p.p_averia_id)
  if (a.estado === 'resuelto') throw new ErrorNegocio('La avería ya está resuelta')
  const m = tabla(db, 'mecanicos').find(x => x.id === p.p_mecanico_id)
  if (!m) throw new ErrorNegocio('Elige un mecánico')
  if (!m.activo) throw new ErrorNegocio(`El mecánico ${nombreMecanico(m)} no está activo`)
  Object.assign(a, { mecanico_id: m.id, asignado_a: nombreMecanico(m) })
  return null
}

function iniciarReparacion(db: Db, p: any) {
  if (!p.p_mecanico_id) throw new ErrorNegocio('Elige el mecánico que hace la reparación')
  const a = averia(db, p.p_averia_id)
  if (a.estado !== 'pendiente') throw new ErrorNegocio(`Solo se puede iniciar la reparación de una avería pendiente (estado actual: ${a.estado})`)
  const maq = tabla(db, 'maquinas').find(m => m.id === a.maquina_id)
  if (!maq || maq.estado !== 'malograda') throw new ErrorNegocio(`La máquina ${maq?.codigo ?? ''} debe estar malograda para iniciar la reparación (estado: ${maq?.estado})`)
  asignarMecanico(db, p)
  a.estado = 'en_reparacion'
  Object.assign(maq, { estado: 'mantenimiento', detalle_estado: 'EN REPARACIÓN' })
  return null
}

function usarRepuesto(db: Db, p: any) {
  const cantidad = Math.trunc(num(p.p_cantidad))
  if (cantidad <= 0) throw new ErrorNegocio('La cantidad debe ser mayor a 0')
  const a = averia(db, p.p_averia_id)
  if (a.estado !== 'en_reparacion') throw new ErrorNegocio(`Solo se usan repuestos en una avería en reparación (estado actual: ${a.estado})`)
  const rep = tabla(db, 'repuestos').find(r => r.id === p.p_repuesto_id)
  if (!rep) throw new ErrorNegocio('Repuesto no encontrado')
  if (cantidad > num(rep.stock_actual)) throw new ErrorNegocio(`Solo hay ${num(rep.stock_actual)} unidades de ${rep.nombre}; no se pueden usar ${cantidad}`)
  rep.stock_actual = num(rep.stock_actual) - cantidad
  const id = nuevoId()
  tabla(db, 'averia_repuestos').push({
    id, averia_id: a.id, repuesto_id: rep.id, cantidad, costo_unitario: num(rep.costo_unitario), mecanico_id: a.mecanico_id ?? null, created_at: ahora(),
  })
  return id
}

function quitarRepuesto(db: Db, p: any) {
  const usos = tabla(db, 'averia_repuestos')
  const i = usos.findIndex(u => u.id === p.p_uso_id)
  if (i < 0) throw new ErrorNegocio('Ese repuesto ya no está en la avería')
  const a = averia(db, usos[i].averia_id)
  if (a.estado !== 'en_reparacion') throw new ErrorNegocio(`Solo se quitan repuestos de una avería en reparación (estado actual: ${a.estado})`)
  const rep = tabla(db, 'repuestos').find(r => r.id === usos[i].repuesto_id)
  if (rep) rep.stock_actual = num(rep.stock_actual) + num(usos[i].cantidad)
  usos.splice(i, 1)
  return null
}

function cerrarReparacion(db: Db, p: any) {
  if (!String(p.p_descripcion ?? '').trim()) throw new ErrorNegocio('Completa el diagnóstico técnico')
  if (num(p.p_costo_mano_obra) < 0) throw new ErrorNegocio('La mano de obra no puede ser negativa')
  const a = averia(db, p.p_averia_id)
  if (a.estado !== 'en_reparacion') throw new ErrorNegocio(`Primero inicia la reparación (estado actual de la avería: ${a.estado})`)
  const maq = tabla(db, 'maquinas').find(m => m.id === a.maquina_id)
  if (!maq || maq.estado !== 'mantenimiento') throw new ErrorNegocio(`La máquina ${maq?.codigo ?? ''} debe estar en mantenimiento para cerrar la reparación (estado: ${maq?.estado})`)
  const repuestos = costoRepuestosUsados(tabla(db, 'averia_repuestos').filter(u => u.averia_id === a.id))
  const manoObra = num(p.p_costo_mano_obra)
  const id = nuevoId()
  tabla(db, 'reparaciones').push({
    id, averia_id: a.id, mecanico_id: a.mecanico_id ?? null, descripcion_tecnico: String(p.p_descripcion).trim(),
    costo_repuestos: repuestos, costo_mano_obra: manoObra, costo_total: Math.round((repuestos + manoObra) * 100) / 100,
    fecha_reparacion: ahora(), created_at: ahora(),
  })
  a.estado = 'resuelto'
  Object.assign(maq, { estado: 'activa', detalle_estado: 'OPERATIVA' })
  return id
}

export function ejecutarRpcMantenimiento(db: Db, fnName: string, params: any): ResultadoRpc | null {
  return ejecutarHandler({
    registrar_compra_repuesto: registrarCompraRepuesto,
    asignar_mecanico_averia: asignarMecanico,
    iniciar_reparacion_mecanico: iniciarReparacion,
    usar_repuesto_en_averia: usarRepuesto,
    quitar_repuesto_de_averia: quitarRepuesto,
    cerrar_reparacion_averia: cerrarReparacion,
  }, db, fnName, params)
}
