// Single Source of Truth: Finanzas, Adelantos y Cronogramas de Pago

export interface CuotaCronograma {
  numero: number
  fecha_vencimiento: string
  monto: number
  estado: 'pendiente' | 'pagada' | 'vencida'
}

export function calcularSaldoFinanciado(totalVenta: number, adelantoContado: number): number {
  const total = Math.max(0, totalVenta || 0)
  const adelanto = Math.max(0, adelantoContado || 0)
  return Math.max(0, Math.round((total - adelanto) * 100) / 100)
}

export function generarCronogramaCuotas(
  saldoFinanciado: number,
  numeroCuotas: number,
  frecuenciaDias: number,
  fechaInicio: Date = new Date()
): CuotaCronograma[] {
  if (saldoFinanciado <= 0 || numeroCuotas <= 0) return []

  const baseMonto = Math.floor((saldoFinanciado / numeroCuotas) * 100) / 100
  let sumaAcumulada = 0
  const resultado: CuotaCronograma[] = []

  for (let i = 1; i <= numeroCuotas; i++) {
    const fechaCuota = new Date(fechaInicio)
    fechaCuota.setDate(fechaCuota.getDate() + (i * frecuenciaDias))

    const isUltima = i === numeroCuotas
    const monto = isUltima
      ? Math.round((saldoFinanciado - sumaAcumulada) * 100) / 100
      : baseMonto

    sumaAcumulada += baseMonto

    resultado.push({
      numero: i,
      fecha_vencimiento: fechaCuota.toISOString().split('T')[0],
      monto,
      estado: 'pendiente'
    })
  }

  return resultado
}

// ── Caja diaria ────────────────────────────────────────────────────────────

export interface CajaEfectivo {
  saldo_inicial?: number | null
  ventas_efectivo?: number | null
  cobros_efectivo?: number | null
  pagos_efectivo?: number | null
}

/** Efectivo que debe haber en caja: entra lo vendido y cobrado, sale lo pagado a proveedores (027). */
export function calcularEfectivoEsperadoCaja(caja: CajaEfectivo | null | undefined): number {
  if (!caja) return 0
  const n = (v: number | null | undefined) => Number(v ?? 0) || 0
  return Math.round((n(caja.saldo_inicial) + n(caja.ventas_efectivo) + n(caja.cobros_efectivo) - n(caja.pagos_efectivo)) * 100) / 100
}

// ── Cuentas por pagar a proveedores ────────────────────────────────────────

export interface CuotaPorPagar {
  monto: number
  fecha_vencimiento: string
  estado: string
}

export interface ResumenCuentasPorPagar {
  totalPendiente: number
  vencido: number
  venceEstaSemana: number
  venceEsteMes: number
  cuotasPendientes: number
  cuotasVencidas: number
}

const sumarDias = (fechaISO: string, dias: number) => {
  const d = new Date(`${fechaISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().split('T')[0]
}

/**
 * Resumen para las cards de Cuentas por Pagar. «Esta semana» = de hoy a 7 días;
 * «este mes» = de hoy a 30 días (incluye la semana). Lo vencido va aparte.
 */
export function resumirCuentasPorPagar(cuotas: CuotaPorPagar[], hoyISO: string): ResumenCuentasPorPagar {
  const r2 = (v: number) => Math.round(v * 100) / 100
  const pendientes = cuotas.filter(c => c.estado !== 'pagada')
  const en7 = sumarDias(hoyISO, 7)
  const en30 = sumarDias(hoyISO, 30)
  const suma = (lista: CuotaPorPagar[]) => r2(lista.reduce((s, c) => s + (Number(c.monto) || 0), 0))
  const vencidas = pendientes.filter(c => c.fecha_vencimiento < hoyISO)
  return {
    totalPendiente: suma(pendientes),
    vencido: suma(vencidas),
    venceEstaSemana: suma(pendientes.filter(c => c.fecha_vencimiento >= hoyISO && c.fecha_vencimiento <= en7)),
    venceEsteMes: suma(pendientes.filter(c => c.fecha_vencimiento >= hoyISO && c.fecha_vencimiento <= en30)),
    cuotasPendientes: pendientes.length,
    cuotasVencidas: vencidas.length,
  }
}

/** Deuda pendiente por proveedor (cuotas no pagadas), para las tarjetas de proveedores. */
export function deudaPendientePorProveedor(
  cuotas: { monto: number; estado: string; compra?: { proveedor_id?: string | null } | null }[]
): Record<string, number> {
  const mapa: Record<string, number> = {}
  for (const c of cuotas) {
    const prov = c.compra?.proveedor_id
    if (!prov || c.estado === 'pagada') continue
    mapa[prov] = Math.round(((mapa[prov] ?? 0) + (Number(c.monto) || 0)) * 100) / 100
  }
  return mapa
}

/** Métodos de pago a proveedores (CHECK de pagos_proveedores, migración 027). */
export const METODOS_PAGO_PROVEEDOR = [
  { value: 'transferencia', label: 'Transferencia Bancaria' },
  { value: 'efectivo', label: 'Efectivo de Caja' },
  { value: 'yape_plin', label: 'Yape/Plin' },
  { value: 'otro', label: 'Otro' },
] as const
export type MetodoPagoProveedor = typeof METODOS_PAGO_PROVEEDOR[number]['value']

/**
 * Gasto de mantenimiento de un conjunto de reparaciones: solo la mano de obra.
 * Los repuestos ya son gasto al comprarlos (registrar_compra_repuesto, migración 029,
 * decisión del dueño 2026-11-25); sumar `costo_total` los contaría dos veces.
 * Única definición: la usan Panel, Balance, Egresos y Materia Prima.
 */
export function gastoMantenimiento(
  reparaciones: { costo_mano_obra?: number | string | null }[],
  preventivosTerminados: { costo_mano_obra?: number | string | null }[] = [],
): number {
  // Fase 4: la mano de obra de los mantenimientos preventivos también es gasto de mantenimiento
  return Math.round([...reparaciones, ...preventivosTerminados].reduce((s, r) => s + (Number(r.costo_mano_obra) || 0), 0) * 100) / 100
}

// ── Fase 7 (migración 036): gastos de materia prima por pagos reales y cierre de caja ──

export type FilaGastoMateriaPrima = { fecha: string; monto: number; origen: 'contado' | 'cuota'; compra_id: string | null }

/**
 * Lo realmente pagado en materia prima (decisión P1-A): las compras al contado recibidas
 * cuentan el día de la compra; las de pago diferido, cada pago a proveedor el día que se paga.
 * Las devueltas y pendientes no cuentan. En la base: vista_gastos_materia_prima.
 */
export function gastosMateriaPrima(
  compras: { id: string; fecha: string; costo_total: number; estado: string; condicion_pago?: string | null }[],
  pagos: { fecha: string; monto: number; cuota_compra_id?: string | null }[],
  cuotas: { id: string; compra_id: string }[] = [],
): FilaGastoMateriaPrima[] {
  const contado = compras.filter(c => (c.condicion_pago ?? 'contado') === 'contado' && c.estado === 'recibida')
    .map(c => ({ fecha: c.fecha, monto: Number(c.costo_total) || 0, origen: 'contado' as const, compra_id: c.id }))
  const porCuota = pagos.map(p => ({
    fecha: p.fecha, monto: Number(p.monto) || 0, origen: 'cuota' as const,
    compra_id: cuotas.find(q => q.id === p.cuota_compra_id)?.compra_id ?? null,
  }))
  return [...contado, ...porCuota]
}

/** Suma de lo pagado (opcionalmente entre dos fechas AAAA-MM-DD, ambas incluidas). */
export function totalGastos(filas: { fecha: string; monto: number }[], desde?: string, hasta?: string): number {
  return Math.round(filas.filter(f => (!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta))
    .reduce((t, f) => t + (Number(f.monto) || 0), 0) * 100) / 100
}

export type EstadoCierreCaja = 'cerrada_cuadrada' | 'cerrada_faltante' | 'cerrada_sobrante'

/** Diferencia y estado al cerrar la caja (misma regla que cerrar_caja en la base). */
export function cierreDeCaja(caja: CajaEfectivo, declaradoEfectivo: number): { esperado: number; diferencia: number; estado: EstadoCierreCaja } {
  const esperado = calcularEfectivoEsperadoCaja(caja)
  const diferencia = Math.round((Number(declaradoEfectivo) - esperado) * 100) / 100
  return { esperado, diferencia, estado: diferencia === 0 ? 'cerrada_cuadrada' : diferencia < 0 ? 'cerrada_faltante' : 'cerrada_sobrante' }
}

/** Roles que abren y cierran la caja de cualquier vendedora (decisión 2-B); las demás, solo la suya. */
export const ROLES_TODAS_LAS_CAJAS = ['admin', 'supervisor'] as const

export function puedeManejarCaja(rol: string | null | undefined, usuarioId: string | null | undefined, asesoraId: string | null | undefined): boolean {
  if (rol && (ROLES_TODAS_LAS_CAJAS as readonly string[]).includes(rol)) return true
  return !!usuarioId && usuarioId === asesoraId
}
