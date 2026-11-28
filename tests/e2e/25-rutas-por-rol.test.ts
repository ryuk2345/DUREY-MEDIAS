/**
 * Fase 7: las rutas que puede abrir cada rol salen de MODULOS_POR_ROL (antes proxy.ts tenía
 * su propia lista, que dejaba al administrador sin Volteado ni Tintorería por URL).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { MODULOS_POR_ROL } from '@/lib/utils'
import { rutasPorRol, rutaDeModulo } from '@/lib/auth/roles'

describe('rutas por rol', () => {
  it('cada módulo tiene su página en el panel', () => {
    for (const modulo of new Set(Object.values(MODULOS_POR_ROL).flat())) {
      expect(existsSync(`app/dashboard${rutaDeModulo(modulo)}/page.tsx`), modulo).toBe(true)
    }
  })
  it('las rutas de cada rol son exactamente sus módulos, en el mismo orden', () => {
    for (const [rol, modulos] of Object.entries(MODULOS_POR_ROL)) expect(rutasPorRol(rol)).toEqual(modulos.map(rutaDeModulo))
    expect(rutasPorRol('admin')).toEqual(expect.arrayContaining(['/volteado', '/tintoreria', '/materia-prima']))
    expect(rutasPorRol('vendedora')).toEqual(['/ventas', '/clientes', '/catalogo', '/despacho'])
    expect(rutasPorRol('desconocido')).toEqual([])
    expect(rutasPorRol(null)).toEqual([])
  })
  it('proxy.ts ya no tiene su propia lista', () => {
    const proxy = readFileSync('proxy.ts', 'utf8')
    expect(proxy).not.toMatch(/ROLE_ROUTES/)
    expect(proxy).toMatch(/rutasPorRol\(cleanRole\)/)
  })
})

import { sugerir, sugerirProductos, MAX_SUGERENCIAS } from '@/lib/domain/catalogo'

describe('sugerencias al escribir (1-A)', () => {
  const productos = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, codigo: `tobillera_niña_${i}`, sku: `SKU-TOB-${i}`, modelo: 'Tobillera', publico: 'niña', diseno_color: i % 2 ? 'Azul' : 'Rosado', talla: '10-13' }))
  it('sin tildes ni mayúsculas, todas las palabras, como mucho 8', () => {
    expect(sugerirProductos(productos, 'TOB nina')).toHaveLength(MAX_SUGERENCIAS)
    expect(sugerirProductos(productos, 'tob niñ azul').every(s => s.detalle?.includes('Azul'))).toBe(true)
    expect(sugerirProductos(productos, '   ')).toEqual([])
    expect(sugerirProductos(productos, 'zapato')).toEqual([])
    expect(sugerirProductos(productos, 'SKU-TOB-7')).toEqual([{ id: 'p7', etiqueta: 'SKU-TOB-7', detalle: 'Tobillera · niña · Azul · 10-13' }])
  })
  it('primero lo que empieza por lo escrito', () => {
    const clientes = [{ id: 'a', nombre: 'Banana SAC' }, { id: 'b', nombre: 'Comercial Ana' }, { id: 'c', nombre: 'Ana Ruiz' }]
    expect(sugerir(clientes, 'ana', c => ({ id: c.id, etiqueta: c.nombre }), c => [c.nombre]).map(s => s.id)).toEqual(['c', 'b', 'a'])
  })
})
