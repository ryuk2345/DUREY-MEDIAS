import { describe, it, expect } from 'vitest'
import { filtrarCatalogo } from '@/lib/domain/catalogo'

const catalogo = [
  { id: '1', sku: 'TOB_O_B/P_69_FELPA', codigo: 'tobillera_niño_blancopuro_6-9_felpa', modelo: 'Tobillera', publico: 'Niño', diseno_color: 'Blanco puro', talla: '6-9' },
  { id: '2', sku: 'TAL_O_COLORES_01_LISO', codigo: 'talonera_niño_colores_0-1_liso', modelo: 'Talonera', publico: 'Niño', diseno_color: 'Colores', talla: '0-1' },
  { id: '3', sku: 'MED_A_NEG_STD_LISO', codigo: 'media_adulto_negro_std_liso', modelo: 'Media', publico: 'Adulto', diseno_color: 'Negro', talla: 'STD' },
]

describe('Buscador de SKU del catálogo (Preparado)', () => {
  it('sin texto devuelve todo el catálogo', () => {
    expect(filtrarCatalogo(catalogo, '  ')).toHaveLength(3)
  })

  it('encuentra un producto nuevo por su modelo aunque esté al final de la lista', () => {
    expect(filtrarCatalogo(catalogo, 'adulto').map(c => c.id)).toEqual(['3'])
  })

  it('ignora mayúsculas, tildes y guiones bajos, y exige todas las palabras', () => {
    expect(filtrarCatalogo(catalogo, 'NINO liso').map(c => c.id)).toEqual(['2'])
    expect(filtrarCatalogo(catalogo, 'blanco puro').map(c => c.id)).toEqual(['1'])
  })

  it('no encuentra nada si una palabra no coincide', () => {
    expect(filtrarCatalogo(catalogo, 'tobillera adulto')).toHaveLength(0)
  })
})
