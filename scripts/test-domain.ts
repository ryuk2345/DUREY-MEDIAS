import { validarTransicionEstadoMaquina } from '../lib/domain/machines'
import { calcularSaldoFinanciado, generarCronogramaCuotas } from '../lib/domain/finance'
import { convertirDocenasAPares, validarTransicionEstadoPaquete } from '../lib/domain/packaging'

function assertEqual(actual: any, expected: any, testName: string) {
  const actualStr = JSON.stringify(actual)
  const expectedStr = JSON.stringify(expected)
  if (actualStr === expectedStr) {
    console.log(`✅ [PASS] ${testName}`)
  } else {
    console.error(`❌ [FAIL] ${testName}: Expected ${expectedStr}, got ${actualStr}`)
    process.exitCode = 1
  }
}

console.log('--- EJECUTANDO PRUEBAS DE DOMINIO Y REGLAS DE NEGOCIO ---')

// 1. Pruebas de Transición de Máquinas
assertEqual(
  validarTransicionEstadoMaquina('activa', 'ocupada'),
  { valido: true },
  'Máquina: Cambio de activa a ocupada (inicio turno) debe ser válido'
)
assertEqual(
  validarTransicionEstadoMaquina('ocupada', 'activa'),
  { valido: true },
  'Máquina: Cambio de ocupada a activa (fin turno) debe ser válido'
)
assertEqual(
  validarTransicionEstadoMaquina('ocupada', 'malograda'),
  { valido: true },
  'Máquina: Cambio de ocupada a malograda (avería en marcha) debe ser válido'
)
assertEqual(
  validarTransicionEstadoMaquina('ocupada', 'mantenimiento').valido,
  false,
  'Máquina: Cambio directo de ocupada a mantenimiento no está permitido (debe pasar por malograda primero)'
)
assertEqual(
  validarTransicionEstadoMaquina('activa', 'malograda'),
  { valido: true },
  'Máquina: Cambio de activa a malograda debe ser válido'
)
assertEqual(
  validarTransicionEstadoMaquina('malograda', 'standby').valido,
  false,
  'Máquina: Cambio directo de malograda a standby no está permitido (debe pasar por mantenimiento)'
)


// 2. Pruebas de Finanzas y Cronogramas
assertEqual(
  calcularSaldoFinanciado(10000, 3000),
  7000,
  'Finanzas: Saldo financiado de S/ 10,000 con adelantado S/ 3,000 debe ser S/ 7,000'
)

const cronograma = generarCronogramaCuotas(1000, 3, 15, new Date('2026-08-01T00:00:00Z'))
assertEqual(cronograma.length, 3, 'Finanzas: Debe generar 3 cuotas exactas')
assertEqual(cronograma[0].monto, 333.33, 'Finanzas: Cuota 1 debe ser 333.33')
assertEqual(cronograma[1].monto, 333.33, 'Finanzas: Cuota 2 debe ser 333.33')
assertEqual(cronograma[2].monto, 333.34, 'Finanzas: Cuota 3 (última) debe absorber los céntimos de redondeo (333.34)')

// 3. Pruebas de Empaque
assertEqual(convertirDocenasAPares(10), 120, 'Empaque: 10 docenas debe ser 120 pares exactos')
assertEqual(
  validarTransicionEstadoPaquete('pendiente_almacenar', 'almacenado').valido,
  true,
  'Empaque: Transición de pendiente_almacenar a almacenado debe ser válida'
)

console.log('--- TODAS LAS PRUEBAS DE DOMINIO FINALIZADAS EXITOSAMENTE ---')
