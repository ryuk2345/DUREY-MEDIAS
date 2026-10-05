/**
 * Reglas compartidas de inventario y sacos maestros (auditoría final).
 *
 * El test FALLA si:
 *   - Cambian los umbrales de stock bajo sin actualizar alertas y Materia Prima
 *   - El QR de reimpresión y el original dejan de tener la misma estructura
 *   - El código de saco se repite tras eliminar sacos
 *   - Un rol desconocido o vacío se interpreta como admin
 */
import { describe, it, expect } from 'vitest'
import { esStockBajoMateriaPrima, UMBRAL_STOCK_BAJO_KG } from '@/lib/domain/inventario'
import { construirQrSacoMaestro, siguienteCodigoSaco } from '@/lib/domain/packaging'
import { normalizarRol } from '@/lib/auth/roles'

describe('stock bajo de materia prima', () => {
  it('cajas y bolsas ≤ 4 kg, conos ≤ 10 kg (y conos por defecto)', () => {
    expect(UMBRAL_STOCK_BAJO_KG).toEqual({ caja: 4, bolsa: 4, cono: 10 })
    expect(esStockBajoMateriaPrima(4, 'caja')).toBe(true)
    expect(esStockBajoMateriaPrima(5, 'bolsa')).toBe(false)
    expect(esStockBajoMateriaPrima(10, 'cono')).toBe(true)
    expect(esStockBajoMateriaPrima(9, null)).toBe(true)
  })
})

describe('sacos maestros', () => {
  it('el QR original y la reimpresión tienen los mismos campos', () => {
    const original = JSON.parse(construirQrSacoMaestro({ codigo_saco: 'B-1005', total_docenas: 3, items: [{ sku: 'S', codigo: 'C', docenas: 3, pares: 36 }] }))
    const reimpresion = JSON.parse(construirQrSacoMaestro({ codigo_saco: 'B-1005', total_docenas: 3 }))
    expect(Object.keys(reimpresion).sort()).toEqual(Object.keys(original).sort())
    expect(reimpresion).toMatchObject({ tipo: 'saco_maestro', codigo_saco: 'B-1005', total_docenas: 3, total_pares: 36 })
  })

  it('el siguiente código no repite uno existente aunque se hayan borrado sacos', () => {
    expect(siguienteCodigoSaco([])).toBe('B-1005')
    expect(siguienteCodigoSaco(['B-1005', 'B-1009'])).toBe('B-1010')
    expect(siguienteCodigoSaco(['ING-123', 'B-1005'])).toBe('B-1007')
  })
})

describe('roles', () => {
  it('[SEGURIDAD] un rol vacío o desconocido no es admin', () => {
    expect(normalizarRol(null)).toBeNull()
    expect(normalizarRol('')).toBeNull()
    expect(normalizarRol('hacker')).toBeNull()
    expect(normalizarRol('Administrador')).toBe('admin')
    expect(normalizarRol('Técnico')).toBe('tecnico')
    expect(normalizarRol('volteador')).toBe('volteador')
  })
})
