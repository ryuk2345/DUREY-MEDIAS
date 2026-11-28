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
