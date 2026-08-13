// Single Source of Truth: Finanzas, Adelantos y Cronogramas de Pago

export interface CuotaCronograma {
  numero: number
  fecha_vencimiento: string
  monto: number
  estado: 'pendiente' | 'pagado' | 'vencido'
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
