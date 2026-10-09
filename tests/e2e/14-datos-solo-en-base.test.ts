/**
 * Todos los módulos guardan y leen sus datos SOLO en la base de datos.
 * Antes Materia Prima y Clientes tenían copias en localStorage (lo registrado ahí
 * no llegaba a la base ni a otros equipos), y Diseños guardaba como foto una
 * dirección blob: que solo existía en esa pestaña.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const raiz = path.resolve(__dirname, '../..')
const archivos = ['app', 'components']
  .flatMap(dir => readdirSync(path.join(raiz, dir), { recursive: true, encoding: 'utf8' }).map(f => path.join(dir, f).split(path.sep).join('/')))
  .filter(f => /\.tsx?$/.test(f))

// Únicos usos permitidos del navegador: avisos de interfaz, no datos del negocio
const PERMITIDOS: Record<string, RegExp> = {
  'components/layout/EventNotificationBanner.tsx': /alerta_calendario_vista_/, // "ya vi el aviso de hoy"
  'components/layout/StockNotification.tsx': /durey_notified_low_mats/, // "ya avisé de este stock bajo"
}

describe('Datos del negocio solo en la base de datos', () => {
  it('[NEGOCIO] ningún módulo usa localStorage / sessionStorage / IndexedDB para datos', () => {
    const infractores: string[] = []
    for (const archivo of archivos) {
      const lineas = readFileSync(path.join(raiz, archivo), 'utf8').split('\n')
      lineas.forEach((linea, i) => {
        if (!/\b(localStorage|sessionStorage|indexedDB)\b/.test(linea)) return
        if (/^\s*(\/\/|\*)/.test(linea)) return
        const permitido = PERMITIDOS[archivo]
        if (permitido && (permitido.test(linea) || /storageKey|notifiedSet/.test(linea))) return
        infractores.push(`${archivo}:${i + 1}: ${linea.trim()}`)
      })
    }
    expect(infractores).toEqual([])
  })

  it('[NEGOCIO] ninguna pantalla guarda en la base una vista previa blob: como si fuera un archivo subido', () => {
    const sospechosos = archivos.filter(a => /fotoUrl\s*=\s*filePreview|foto_url:\s*filePreview/.test(readFileSync(path.join(raiz, a), 'utf8')))
    expect(sospechosos).toEqual([])
  })
})
