/**
 * Fase 2 — Reportes con nombres.
 * Cada reporte de producción dice quién la hizo, no solo cuánto.
 *   - Tejido: turno (día/noche), encargado (tejedor del turno) y operarios
 *     (Calendario de Turnos, área tejido, misma fecha y turno).
 *   - Remallado: remalladora y máquina.
 *   - Planchado / Preparado: planchador / preparador.
 *   - Mantenimiento: quién reportó la falla y el técnico que la reparó.
 *   - Resumen por persona: docenas por persona en el período.
 */
import { describe, it, expect } from 'vitest'
import {
  SIN_REGISTRAR,
  etiquetaTurno,
  filasProduccion,
  filasRemallado,
  filasPlanchado,
  filasPreparado,
  filasMantenimiento,
  resumenPorPersona,
} from '@/lib/domain/reportes'
import { formatearFecha } from '@/lib/utils'

const reporteTejido = (over: Record<string, unknown> = {}) => ({
  fecha: '2026-11-20',
  docenas_producidas: 40,
  maquina: { codigo: 'M01' },
  catalogo_media: { codigo: 'TOB-NEG-M' },
  turno: { fecha: '2026-11-20', horario: 'dia', tejedor: { nombre: 'Rosa Encargada' } },
  ...over,
})

describe('formatearFecha con fechas sin hora (zona de Lima)', () => {
  it('una fecha "AAAA-MM-DD" se muestra como ese mismo día, no el anterior', () => {
    const tzAntes = process.env.TZ
    process.env.TZ = 'America/Lima'
    try {
      expect(formatearFecha('2026-11-20')).toBe('20/11/2026')
      expect(formatearFecha('2026-01-01')).toBe('01/01/2026')
      // Con hora sigue siendo un instante: 03:00 UTC es todavía el día anterior en Lima
      expect(formatearFecha('2026-11-20T03:00:00Z')).toBe('19/11/2026')
      expect(formatearFecha('no-es-fecha')).toBe('—')
      // Una fecha imposible no salta al mes siguiente
      expect(formatearFecha('2026-02-30')).toBe('—')
      expect(formatearFecha('2026-13-01')).toBe('—')
    } finally {
      if (tzAntes === undefined) delete process.env.TZ
      else process.env.TZ = tzAntes
    }
  })
})

describe('etiquetaTurno', () => {
  it('traduce dia/noche y marca lo desconocido', () => {
    expect(etiquetaTurno('dia')).toBe('Día')
    expect(etiquetaTurno('noche')).toBe('Noche')
    expect(etiquetaTurno(null)).toBe(SIN_REGISTRAR)
    expect(etiquetaTurno('tarde')).toBe(SIN_REGISTRAR)
  })
})

describe('filasProduccion (tejido)', () => {
  const asignaciones = [
    { fecha: '2026-11-20', turno: 'dia', operador: { nombre: 'Luis Operario' } },
    { fecha: '2026-11-20', turno: 'dia', operador: { nombre: 'Ana Operaria' } },
    { fecha: '2026-11-20', turno: 'noche', operador: { nombre: 'Pedro Noche' } },
    { fecha: '2026-11-21', turno: 'dia', operador: { nombre: 'Otro Día' } },
    { fecha: '2026-11-20', turno: 'dia', operador: { nombre: 'Luis Operario' } }, // repetido
  ]

  it('muestra turno, encargado y operarios del mismo día y turno', () => {
    const [fila] = filasProduccion([reporteTejido()], asignaciones)
    expect(fila).toEqual({
      Fecha: '20/11/2026',
      Turno: 'Día',
      Máquina: 'M01',
      'Tipo de Media': 'TOB-NEG-M',
      Encargado: 'Rosa Encargada',
      Operarios: 'Ana Operaria, Luis Operario',
      'Docenas Producidas': 40,
    })
  })

  it('el turno noche toma solo los operarios de la noche', () => {
    const [fila] = filasProduccion(
      [reporteTejido({ turno: { fecha: '2026-11-20', horario: 'noche', tejedor: { nombre: 'Rosa Encargada' } } })],
      asignaciones,
    )
    expect(fila.Turno).toBe('Noche')
    expect(fila.Operarios).toBe('Pedro Noche')
  })

  it('cruza por la fecha del turno, no por la del reporte (turno noche que cierra al día siguiente)', () => {
    const [fila] = filasProduccion(
      [reporteTejido({ fecha: '2026-11-21', turno: { fecha: '2026-11-20', horario: 'noche', tejedor: { nombre: 'Rosa' } } })],
      asignaciones,
    )
    expect(fila.Fecha).toBe('21/11/2026')
    expect(fila.Operarios).toBe('Pedro Noche')
  })

  it('el encargado no se repite en Operarios si también está asignado en el calendario', () => {
    const [fila] = filasProduccion([reporteTejido()], [
      { fecha: '2026-11-20', turno: 'dia', operador: { nombre: 'Rosa Encargada' } },
      { fecha: '2026-11-20', turno: 'dia', operador: { nombre: 'Luis Operario' } },
    ])
    expect(fila.Operarios).toBe('Luis Operario')
    const [soloEncargado] = filasProduccion([reporteTejido()], [
      { fecha: '2026-11-20', turno: 'dia', operador: { nombre: 'Rosa Encargada' } },
    ])
    expect(soloEncargado.Operarios).toBe(SIN_REGISTRAR)
  })

  it('sin asignaciones ni tejedor dice "Sin registrar", nunca vacío', () => {
    const [fila] = filasProduccion([reporteTejido({ turno: null })], [])
    expect(fila.Turno).toBe(SIN_REGISTRAR)
    expect(fila.Encargado).toBe(SIN_REGISTRAR)
    expect(fila.Operarios).toBe(SIN_REGISTRAR)
  })

  it('ordena por fecha, turno (día antes que noche) y máquina', () => {
    const filas = filasProduccion([
      reporteTejido({ fecha: '2026-11-21', maquina: { codigo: 'M01' } }),
      reporteTejido({ maquina: { codigo: 'M02' }, turno: { fecha: '2026-11-20', horario: 'noche', tejedor: null } }),
      reporteTejido({ maquina: { codigo: 'M03' } }),
      reporteTejido({ maquina: { codigo: 'M01' } }),
    ], [])
    expect(filas.map(f => `${f.Fecha} ${f.Turno} ${f.Máquina}`)).toEqual([
      '20/11/2026 Día M01', '20/11/2026 Día M03', '20/11/2026 Noche M02', '21/11/2026 Día M01',
    ])
  })
})

describe('filasRemallado', () => {
  it('muestra la remalladora y la máquina', () => {
    const [fila] = filasRemallado([{
      fecha: '2026-11-20', docenas_remalladas: 12, docenas_restantes: 3,
      remalladora: { nombre: 'Carmen Remalladora' }, maquina: { codigo: 'R01' },
      lote: { catalogo_media: { codigo: 'TOB-NEG-M' } },
    }])
    expect(fila).toEqual({
      Fecha: '20/11/2026',
      Remalladora: 'Carmen Remalladora',
      Máquina: 'R01',
      'Tipo de Media': 'TOB-NEG-M',
      'Docenas Remalladas': 12,
      'Docenas Restantes': 3,
    })
  })

  it('sin remalladora dice "Sin registrar"', () => {
    const [fila] = filasRemallado([{ fecha: '2026-11-20', docenas_remalladas: 1, docenas_restantes: 0 }])
    expect(fila.Remalladora).toBe(SIN_REGISTRAR)
    expect(fila.Máquina).toBe(SIN_REGISTRAR)
  })
})

describe('filasPlanchado y filasPreparado', () => {
  it('planchado muestra el planchador', () => {
    const [fila] = filasPlanchado([{
      fecha: '2026-11-20', docenas_planchadas: 20, docenas_defectuosas: 1,
      planchador: { nombre: 'Mario Planchador' }, catalogo_media: { codigo: 'TOB' },
    }])
    expect(fila.Planchador).toBe('Mario Planchador')
    expect(fila['Docenas Planchadas']).toBe(20)
    expect(fila.Mermas).toBe(1)
  })

  it('preparado muestra el preparador y usa el SKU si no hay código', () => {
    const [fila] = filasPreparado([{
      fecha: '2026-11-20', codigo_paquete: 'PQ-1', docenas: 10, estado: 'almacenado',
      preparador: { nombre: 'Lucía' }, catalogo_media: { codigo: null, sku: 'SKU-9' },
    }])
    expect(fila.Preparador).toBe('Lucía')
    // Se conserva el nombre de columna anterior ("Tipo Media") para no romper plantillas de Excel
    expect(fila['Tipo Media']).toBe('SKU-9')
    const [sinNombre] = filasPreparado([{ fecha: '2026-11-20', codigo_paquete: 'PQ-2', docenas: 1, estado: 'x' }])
    expect(sinNombre.Preparador).toBe(SIN_REGISTRAR)
  })
})

describe('filasMantenimiento', () => {
  it('muestra quién reportó y qué técnico reparó', () => {
    const [fila] = filasMantenimiento([{
      fecha_reporte: '2026-11-20T10:00:00Z', descripcion_operador: 'Se rompió una aguja', estado: 'reparada',
      maquina: { codigo: 'M01' }, reportado_por: { nombre: 'Rosa' },
      reparaciones: [{ costo_total: 45, tecnico: { nombre: 'Pedro Técnico' } }],
    }])
    expect(fila['Reportado por']).toBe('Rosa')
    expect(fila.Técnico).toBe('Pedro Técnico')
    expect(fila['Costo Total (S/)']).toBe(45)
    expect(fila.Reparada).toBe('Sí')
  })

  it('sin reparación: técnico pendiente, no reparada', () => {
    const [fila] = filasMantenimiento([{ fecha_reporte: '2026-11-20T10:00:00Z', descripcion_operador: 'x', estado: 'pendiente', reparaciones: [] }])
    expect(fila.Técnico).toBe('Pendiente')
    expect(fila.Reparada).toBe('No')
    expect(fila['Reportado por']).toBe(SIN_REGISTRAR)
  })
})

describe('resumenPorPersona', () => {
  it('suma las docenas y cuenta registros por persona, de mayor a menor', () => {
    const resumen = resumenPorPersona(
      [
        { Encargado: 'Rosa', 'Docenas Producidas': 40 },
        { Encargado: 'Luis', 'Docenas Producidas': 70 },
        { Encargado: 'Rosa', 'Docenas Producidas': 35.5 },
        { Encargado: SIN_REGISTRAR, 'Docenas Producidas': 5 },
      ],
      'Encargado',
      'Docenas Producidas',
    )
    expect(resumen).toEqual([
      { Persona: 'Rosa', Registros: 2, 'Docenas Producidas': 75.5 },
      { Persona: 'Luis', Registros: 1, 'Docenas Producidas': 70 },
      { Persona: SIN_REGISTRAR, Registros: 1, 'Docenas Producidas': 5 },
    ])
  })

  it('valores no numéricos cuentan como 0 y no rompen la suma', () => {
    const resumen = resumenPorPersona([{ P: 'A', D: null }, { P: 'A', D: '3' }], 'P', 'D')
    expect(resumen).toEqual([{ Persona: 'A', Registros: 2, D: 3 }])
  })
})
