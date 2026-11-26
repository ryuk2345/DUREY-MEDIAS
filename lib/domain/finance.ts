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
export function gastoMantenimiento(reparaciones: { costo_mano_obra?: number | string | null }[]): number {
  return Math.round(reparaciones.reduce((s, r) => s + (Number(r.costo_mano_obra) || 0), 0) * 100) / 100
}
