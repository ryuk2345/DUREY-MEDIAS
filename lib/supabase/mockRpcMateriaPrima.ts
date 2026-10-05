/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones RPC de la migración
 * 024_rpc_materia_prima.sql. Validan todo antes de escribir; mockDb.ts guarda
 * la base solo si no hubo error.
 */
import { ErrorNegocio, nuevoId, tabla, ejecutarHandler, type Db, type ResultadoRpc } from './mockRpcComun'

export const RPC_MATERIA_PRIMA = [
  'editar_materia_prima',
  'registrar_compra_materia_prima',
  'procesar_control_calidad_compra',
  'ajustar_stock_repuesto',
] as const

const num = (v: unknown) => Number(v ?? 0) || 0
const ahora = () => new Date().toISOString()
const hoy = () => ahora().split('T')[0]

function movimiento(db: Db, materiaPrimaId: string, tipo: string, cantidad: number, referenciaId: string | null) {
  tabla(db, 'movimientos_materia_prima').push({
    id: nuevoId(), materia_prima_id: materiaPrimaId, tipo, cantidad_kg: cantidad, referencia_id: referenciaId, created_at: ahora(),
  })
}

function editarMateriaPrima(db: Db, p: any) {
  if (!String(p.p_material ?? '').trim() || !String(p.p_color ?? '').trim()) throw new ErrorNegocio('Material y color son obligatorios')
  if (p.p_stock_nuevo != null && num(p.p_stock_nuevo) < 0) throw new ErrorNegocio('El stock no puede ser negativo')
  const mp = tabla(db, 'materia_prima').find(x => x.id === p.p_id)
  if (!mp) throw new ErrorNegocio('Insumo no encontrado')

  const actual = num(mp.stock_kg)
  Object.assign(mp, { material: String(p.p_material).trim(), color: String(p.p_color).trim(), tipo_empaque: p.p_tipo_empaque || 'cono' })
  const cambioStock = p.p_stock_nuevo != null && num(p.p_stock_nuevo) !== num(p.p_stock_anterior) && num(p.p_stock_nuevo) !== actual
  if (cambioStock) {
    mp.stock_kg = num(p.p_stock_nuevo)
    movimiento(db, mp.id, 'ajuste_inventario', num(p.p_stock_nuevo) - actual, null)
  }
  return null
}

function registrarCompra(db: Db, p: any) {
  if (!p.p_proveedor_id || !p.p_materia_prima_id) throw new ErrorNegocio('Selecciona el proveedor y el insumo')
  if (num(p.p_cantidad_kg) <= 0 || num(p.p_costo_total) <= 0) throw new ErrorNegocio('La cantidad y el costo deben ser mayores a 0')
  if (!['contado', 'pago_diferido'].includes(p.p_condicion_pago)) throw new ErrorNegocio('Condición de pago inválida')
  const cuotas = Math.trunc(num(p.p_cuotas_num))
  if (p.p_condicion_pago === 'pago_diferido' && cuotas < 1) throw new ErrorNegocio('Indica el número de cuotas')

  const compraId = nuevoId()
  tabla(db, 'compras_materia_prima').push({
    id: compraId, proveedor_id: p.p_proveedor_id, materia_prima_id: p.p_materia_prima_id, cantidad_kg: num(p.p_cantidad_kg),
    costo_total: num(p.p_costo_total), condicion_pago: p.p_condicion_pago, metodo_pago: p.p_metodo_pago ?? null,
    estado: 'pendiente', motivo_devolucion: null, fecha: hoy(), created_at: ahora(),
  })
  if (p.p_condicion_pago === 'pago_diferido') {
    // Igual que el SQL: cuotas redondeadas hacia abajo, la última absorbe la diferencia
    const total = num(p.p_costo_total)
    const base = Math.floor((total / cuotas) * 100) / 100
    for (let i = 1; i <= cuotas; i++) {
      const vence = new Date()
      vence.setMonth(vence.getMonth() + i)
      tabla(db, 'cuotas_compras').push({
        id: nuevoId(), compra_id: compraId,
        monto: i === cuotas ? Math.round((total - base * (cuotas - 1)) * 100) / 100 : base,
        fecha_vencimiento: vence.toISOString().split('T')[0], estado: 'pendiente', created_at: ahora(),
      })
    }
  }
  return compraId
}

function procesarControlCalidad(db: Db, p: any) {
  const compra = tabla(db, 'compras_materia_prima').find(c => c.id === p.p_compra_id)
  if (!compra) throw new ErrorNegocio('Compra no encontrada')
  if (compra.estado !== 'pendiente') throw new ErrorNegocio(`Esta compra ya fue procesada (estado: ${compra.estado})`)
  if (!p.p_aprobar && !String(p.p_motivo ?? '').trim()) throw new ErrorNegocio('Indica el motivo de la devolución')

  compra.estado = p.p_aprobar ? 'recibida' : 'devuelta'
  compra.motivo_devolucion = p.p_aprobar ? null : String(p.p_motivo).trim()
  if (p.p_aprobar) {
    const mp = tabla(db, 'materia_prima').find(x => x.id === compra.materia_prima_id)
    if (mp) mp.stock_kg = num(mp.stock_kg) + num(compra.cantidad_kg)
  }
  movimiento(db, compra.materia_prima_id, p.p_aprobar ? 'ingreso_compra' : 'devolucion', num(compra.cantidad_kg), compra.id)
  return null
}

function ajustarStockRepuesto(db: Db, p: any) {
  if (!['ingreso', 'salida'].includes(p.p_tipo)) throw new ErrorNegocio('Tipo de ajuste inválido')
  const cantidad = Math.trunc(num(p.p_cantidad))
  if (cantidad <= 0) throw new ErrorNegocio('La cantidad debe ser mayor a 0')
  const rep = tabla(db, 'repuestos').find(r => r.id === p.p_repuesto_id)
  if (!rep) throw new ErrorNegocio('Repuesto no encontrado')
  if (p.p_tipo === 'salida' && cantidad > num(rep.stock_actual)) {
    throw new ErrorNegocio(`Solo hay ${num(rep.stock_actual)} unidades de ${rep.nombre}; no se pueden sacar ${cantidad}`)
  }

  rep.stock_actual = num(rep.stock_actual) + (p.p_tipo === 'ingreso' ? cantidad : -cantidad)
  if (p.p_tipo === 'salida') {
    tabla(db, 'egresos_adicionales').push({
      id: nuevoId(),
      concepto: `Consumo repuesto: ${rep.nombre} (${cantidad} uds.) — ${String(p.p_motivo ?? '').trim() || 'Mantenimiento'}`,
      monto: cantidad * num(rep.costo_unitario), categoria: 'repuestos', fecha: hoy(), created_at: ahora(),
    })
  }
  return rep.stock_actual
}

export function ejecutarRpcMateriaPrima(db: Db, fnName: string, params: any): ResultadoRpc | null {
  return ejecutarHandler({
    editar_materia_prima: editarMateriaPrima,
    registrar_compra_materia_prima: registrarCompra,
    procesar_control_calidad_compra: procesarControlCalidad,
    ajustar_stock_repuesto: ajustarStockRepuesto,
  }, db, fnName, params)
}
