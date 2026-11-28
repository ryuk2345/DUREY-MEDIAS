/**
 * Fase 5B — medias en crudo, Volteado, Tintorería y bloqueo por rol.
 * Spec: 02-DOCS/wiki/sdd/specs/fase-5-flujo-produccion.md · SQL: migración 033.
 * El mock debe comportarse igual que el SQL (supabase/tests/033_*.test.sql).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { MODULOS_POR_ROL } from '@/lib/utils'
import {
  esColorDe, coloresPara, mermaTintoreria, destinoTrasRemallado, destinoTrasVolteado, tieneModulo, ETAPA_EN_CRUDO,
} from '@/lib/domain/tintoreria'
import { ejecutarRpcTintoreria } from '@/lib/supabase/mockRpcTintoreria'
import { ejecutarRpcTejido } from '@/lib/supabase/mockRpcTejido'

type Db = Record<string, any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = (db: Db, fn: string, p: Record<string, unknown>) => (ejecutarRpcTintoreria(db, fn, p) ?? ejecutarRpcTejido(db, fn, p))!

describe('MODULOS_POR_ROL = modulos_por_rol de la base (migración 033)', () => {
  it('las dos tablas tienen exactamente los mismos pares rol–módulo', () => {
    // Todas las migraciones que añaden pares (033 y las siguientes, p. ej. la 036 da Mantenimiento al supervisor)
    const enBase = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort().flatMap(f => {
      const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
      return [...sql.matchAll(/INSERT INTO public\.modulos_por_rol[^;]*?ON CONFLICT DO NOTHING/g)]
        .flatMap(b => [...b[0].matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map(m => `${m[1]}:${m[2]}`))
    }).sort()
    const enApp = Object.entries(MODULOS_POR_ROL).flatMap(([r, ms]) => ms.map(m => `${r}:${m}`)).sort()
    expect(enBase.length).toBeGreaterThan(50)
    expect(enBase).toEqual(enApp)
  })
  it('decisiones Q2-A y Q3-A', () => {
    expect(tieneModulo('tintorero', 'tintoreria')).toBe(true)
    expect(['admin', 'supervisor', 'operador'].every(r => tieneModulo(r, 'tintoreria'))).toBe(true)
    expect(['admin', 'supervisor', 'volteador'].every(r => tieneModulo(r, 'volteado'))).toBe(true)
    expect(tieneModulo('planchador', 'tintoreria')).toBe(false)
    expect(tieneModulo(null, 'produccion')).toBe(false)
    expect(tieneModulo('desconocido', 'produccion')).toBe(false)
  })
})

describe('reglas de crudo y tintorería (lib/domain/tintoreria)', () => {
  const crudo = { id: 'k', modelo: 'M', publico: 'adulto', talla: 'L', es_crudo: true }
  const azul = { id: 'a', modelo: 'M', publico: 'adulto', talla: 'L', es_crudo: false }
  const otraTalla = { ...azul, id: 'b', talla: 'M' }
  const inactivo = { ...azul, id: 'c', estado: 'inactivo' }
  it('el SKU de color es de la misma media y no crudo', () => {
    expect(esColorDe(azul, crudo)).toBe(true)
    expect(esColorDe(otraTalla, crudo)).toBe(false)
    expect(esColorDe(crudo, crudo)).toBe(false)
    expect(esColorDe(azul, azul)).toBe(false)
    expect(coloresPara([crudo, azul, otraTalla, inactivo], crudo).map(c => c.id)).toEqual(['a'])
    expect(coloresPara([azul], null)).toEqual([])
  })
  it('merma, destinos y etapas', () => {
    expect(mermaTintoreria(8, 7)).toBe(1)
    expect(mermaTintoreria(8.5, 8.25)).toBe(0.25)
    expect(destinoTrasRemallado(true)).toBe('stock_listo_voltear')
    expect(destinoTrasRemallado(false)).toBe('stock_listo_planchar')
    expect(destinoTrasVolteado(true)).toBe('stock_listo_tenir')
    expect(destinoTrasVolteado(false)).toBe('stock_listo_planchar')
    expect(ETAPA_EN_CRUDO).toEqual({ remallado: true, volteado: true, tintoreria: true, planchado: false, preparado: false })
  })
})

const ADMIN = 'u-admin', REMA = 'u-rema', VOLT = 'u-volt', TINTO = 'u-tinto', PLANCHA = 'u-plancha', BAJA = 'u-baja'

function base(): Db {
  return {
    usuarios: [
      { id: ADMIN, nombre: 'Admin', rol: 'admin', activo: true },
      { id: REMA, nombre: 'Rema', rol: 'remalladora', activo: true },
      { id: VOLT, nombre: 'Volt', rol: 'volteador', activo: true },
      { id: TINTO, nombre: 'Tinto', rol: 'tintorero', activo: true },
      { id: PLANCHA, nombre: 'Plancha', rol: 'planchador', activo: true },
      { id: BAJA, nombre: 'Baja', rol: 'tintorero', activo: false },
    ],
    catalogo_medias: [
      { id: 'k', codigo: 'K-CRUDO', modelo: 'M', publico: 'adulto', talla: 'L', es_crudo: true, estado: 'activo' },
      { id: 'a', codigo: 'K-AZUL', sku: 'SKU-A', modelo: 'M', publico: 'adulto', talla: 'L', es_crudo: false, estado: 'activo' },
      { id: 'b', codigo: 'K-AZUL-M', modelo: 'M', publico: 'adulto', talla: 'M', es_crudo: false, estado: 'activo' },
    ],
    maquinas: [{ id: 'r1', codigo: 'R01', tipo: 'remalladora', estado: 'ocupada' }, { id: 'r2', codigo: 'R02', tipo: 'remalladora', estado: 'ocupada' }],
    lotes_remallado: [
      { id: 'lr', catalogo_media_id: 'k', remalladora_id: REMA, maquina_remalladora_id: 'r1', docenas_asignadas: 12, docenas_pendientes: 12, estado: 'en_proceso' },
      { id: 'lc', catalogo_media_id: 'a', remalladora_id: REMA, maquina_remalladora_id: 'r2', docenas_asignadas: 4, docenas_pendientes: 4, estado: 'en_proceso' },
    ],
    reportes_remallado: [], stock_listo_voltear: [], lotes_volteado: [], reportes_volteado: [], stock_listo_tenir: [], lotes_tintoreria: [],
    stock_listo_planchar: [], stock_listo_preparar: [], ingresos_stock_fuera: [],
  }
}
const stock = (db: Db, t: string, id: string) => db[t].find(s => s.catalogo_media_id === id)?.docenas

describe('mock: bloqueo por rol', () => {
  it('sin sesión, sin el módulo o dado de baja: rechazado; sin __uid (otras pruebas) no se aplica', () => {
    const db = base()
    const fin = (uid: string | null | undefined) => rpc(db, 'finalizar_lote_remallado', { __uid: uid, p_lote_id: 'lr', p_docenas_remalladas: 1, p_docenas_restantes: 0 })
    expect(fin(null).error?.message).toBe('Tu rol no tiene acceso al módulo remallado')
    expect(fin(PLANCHA).error?.message).toBe('Tu rol no tiene acceso al módulo remallado')
    expect(rpc(db, 'enviar_lote_tintoreria', { __uid: BAJA, p_crudo_id: 'k' }).error?.message).toBe('Tu rol no tiene acceso al módulo tintoreria')
    expect(rpc(db, 'ingresar_stock_fuera', { __uid: PLANCHA, p_etapa: 'tintoreria', p_catalogo_media_id: 'k', p_docenas: 1, p_origen: 'x' }).error?.message).toBe('Tu rol no tiene acceso al módulo tintoreria')
    expect(db.lotes_remallado[0].estado).toBe('en_proceso')
  })
})

describe('mock: remallado crudo → volteado → tintorería → por planchar', () => {
  it('el flujo completo con sus validaciones', () => {
    const db = base()
    // Remallado: el producto sale del lote, no del parámetro
    expect(rpc(db, 'finalizar_lote_remallado', { __uid: REMA, p_lote_id: 'lr', p_docenas_remalladas: 13, p_docenas_restantes: 0 }).error?.message).toContain('tiene 12 pendientes')
    expect(rpc(db, 'finalizar_lote_remallado', { __uid: REMA, p_lote_id: 'lr', p_docenas_remalladas: -1, p_docenas_restantes: 0 }).error?.message).toContain('negativas')
    expect(rpc(db, 'finalizar_lote_remallado', { __uid: REMA, p_lote_id: 'lr', p_docenas_remalladas: 10, p_docenas_restantes: 2, p_catalogo_media_id: 'a', p_remalladora_id: REMA, p_maquina_id: 'r1' }).error).toBeNull()
    expect(rpc(db, 'finalizar_lote_remallado', { __uid: REMA, p_lote_id: 'lc', p_docenas_remalladas: 4, p_docenas_restantes: 0 }).error).toBeNull()
    expect(rpc(db, 'finalizar_lote_remallado', { __uid: REMA, p_lote_id: 'lr', p_docenas_remalladas: 1, p_docenas_restantes: 0 }).error?.message).toContain('ya no está en proceso')
    expect(stock(db, 'stock_listo_voltear', 'k')).toBe(10)
    expect(stock(db, 'stock_listo_planchar', 'k')).toBeUndefined()
    expect(stock(db, 'stock_listo_planchar', 'a')).toBe(4)
    expect(db.maquinas.find(m => m.id === 'r1')?.estado).toBe('activa')

    // Volteado
    expect(rpc(db, 'iniciar_lote_volteado', { __uid: VOLT, p_volteador_id: VOLT, p_catalogo_media_id: 'k', p_docenas: 11 }).error?.message).toBe('No hay suficiente stock por voltear de K-CRUDO: se asignan 11 docenas y hay 10')
    expect(rpc(db, 'iniciar_lote_volteado', { __uid: VOLT, p_volteador_id: BAJA, p_catalogo_media_id: 'k', p_docenas: 1 }).error?.message).toContain('quién voltea')
    const lv = rpc(db, 'iniciar_lote_volteado', { __uid: VOLT, p_volteador_id: VOLT, p_catalogo_media_id: 'k', p_docenas: 8 }).data
    expect(rpc(db, 'reportar_lote_volteado', { __uid: VOLT, p_lote_id: lv, p_docenas: 5, p_pares_defectuosos: 2, p_comentarios: ' bien ' }).error).toBeNull()
    expect(rpc(db, 'reportar_lote_volteado', { __uid: VOLT, p_lote_id: lv, p_docenas: 4 }).error?.message).toContain('tiene 3 pendientes')
    expect(rpc(db, 'reportar_lote_volteado', { __uid: VOLT, p_lote_id: lv, p_docenas: 1, p_pares_defectuosos: -1 }).error?.message).toContain('defectuosos')
    expect(rpc(db, 'reportar_lote_volteado', { __uid: VOLT, p_lote_id: lv, p_docenas: 3 }).error).toBeNull()
    expect(rpc(db, 'reportar_lote_volteado', { __uid: VOLT, p_lote_id: lv, p_docenas: 1 }).error?.message).toContain('ya está completado')
    expect(stock(db, 'stock_listo_voltear', 'k')).toBe(2)
    expect(stock(db, 'stock_listo_tenir', 'k')).toBe(8)
    expect(db.reportes_volteado).toHaveLength(2)
    expect(db.reportes_volteado[0].comentarios).toBe('bien')

    // Tintorería
    const enviar = (p: Record<string, unknown>) => rpc(db, 'enviar_lote_tintoreria', { __uid: TINTO, p_crudo_id: 'k', p_color_id: 'a', p_material: 'poliester', p_docenas: 8, p_remalladora_id: REMA, ...p })
    expect(enviar({ p_crudo_id: 'a' }).error?.message).toContain('media cruda')
    expect(enviar({ p_color_id: 'k' }).error?.message).toContain('SKU de color')
    expect(enviar({ p_color_id: 'b' }).error?.message).toBe('El SKU K-AZUL-M no es de la misma media (modelo, público y talla) que K-CRUDO')
    expect(enviar({ p_material: 'lana' }).error?.message).toContain('algodón o poliéster')
    expect(enviar({ p_remalladora_id: null }).error?.message).toContain('que remalló')
    expect(enviar({ p_docenas: 9 }).error?.message).toBe('No hay suficiente stock por teñir de K-CRUDO: se envían 9 docenas y hay 8')
    const lt = enviar({}).data
    expect(stock(db, 'stock_listo_tenir', 'k')).toBe(0)
    const recibir = (docenas: unknown, motivo: string | null) => rpc(db, 'recibir_lote_tintoreria', { __uid: TINTO, p_lote_id: lt, p_docenas_recibidas: docenas, p_motivo_merma: motivo })
    expect(recibir(9, null).error?.message).toBe('Se reciben 9 docenas y se enviaron 8')
    expect(recibir(7, '  ').error?.message).toBe('Faltan 1 docenas: indica el motivo de la merma')
    expect(recibir('NaN', 'x').error?.message).toContain('docenas recibidas')
    expect(recibir(7, ' manchada ').error).toBeNull()
    expect(recibir(7, 'x').error?.message).toContain('ya fue recibido')
    expect(stock(db, 'stock_listo_planchar', 'a')).toBe(11)
    expect(db.lotes_tintoreria[0]).toMatchObject({ estado: 'recibido', docenas_recibidas: 7, docenas_merma: 1, motivo_merma: 'manchada', enviado_por: TINTO, recibido_por: TINTO, material: 'poliester' })
  })

  it('stock de fuera en las etapas nuevas: crudo donde toca, remallado solo registra', () => {
    const db = base()
    const fuera = (etapa: string, id: string, docenas = 5) => rpc(db, 'ingresar_stock_fuera', { __uid: ADMIN, p_etapa: etapa, p_catalogo_media_id: id, p_docenas: docenas, p_origen: 'Taller' })
    expect(fuera('volteado', 'a').error?.message).toContain('elige la media cruda')
    expect(fuera('planchado', 'k').error?.message).toContain('elige su SKU de color')
    expect(fuera('volteado', 'k').error).toBeNull()
    expect(fuera('tintoreria', 'k', 6).error).toBeNull()
    expect(fuera('remallado', 'k', 7).error).toBeNull()
    expect(stock(db, 'stock_listo_voltear', 'k')).toBe(5)
    expect(stock(db, 'stock_listo_tenir', 'k')).toBe(6)
    expect(db.ingresos_stock_fuera.map(i => i.etapa)).toEqual(['volteado', 'tintoreria', 'remallado'])
    expect(db.ingresos_stock_fuera.every(i => i.registrado_por === ADMIN)).toBe(true)
  })
})

describe('mock y dominio: casos que el panel pidió fijar', () => {
  it('el color debe coincidir también en modelo y público', () => {
    const crudo = { id: 'k', modelo: 'M', publico: 'adulto', talla: 'L', es_crudo: true }
    expect(esColorDe({ ...crudo, id: 'x', es_crudo: false, publico: 'niño' }, crudo)).toBe(false)
    expect(esColorDe({ ...crudo, id: 'y', es_crudo: false, modelo: 'Otro' }, crudo)).toBe(false)
  })
  it('volteado: rol equivocado rechazado; una media con color va a por planchar, no a por teñir', () => {
    const db = base()
    db.stock_listo_voltear.push({ id: 's', catalogo_media_id: 'a', docenas: 3 })
    expect(rpc(db, 'iniciar_lote_volteado', { __uid: PLANCHA, p_volteador_id: VOLT, p_catalogo_media_id: 'a', p_docenas: 3 }).error?.message).toBe('Tu rol no tiene acceso al módulo volteado')
    const lote = rpc(db, 'iniciar_lote_volteado', { __uid: VOLT, p_volteador_id: VOLT, p_catalogo_media_id: 'a', p_docenas: 3 }).data
    expect(rpc(db, 'reportar_lote_volteado', { __uid: TINTO, p_lote_id: lote, p_docenas: 3 }).error?.message).toBe('Tu rol no tiene acceso al módulo volteado')
    expect(rpc(db, 'reportar_lote_volteado', { __uid: VOLT, p_lote_id: lote, p_docenas: 3, p_pares_defectuosos: 4 }).error).toBeNull()
    expect(stock(db, 'stock_listo_planchar', 'a')).toBe(3)
    expect(stock(db, 'stock_listo_tenir', 'a')).toBeUndefined()
    expect(db.reportes_volteado[0].pares_defectuosos).toBe(4)
  })
  it('tintorería: sin merma el motivo no se guarda; SKU inactivo rechazado', () => {
    const db = base()
    db.stock_listo_tenir.push({ id: 't', catalogo_media_id: 'k', docenas: 5 })
    db.catalogo_medias.push({ id: 'z', codigo: 'K-VERDE', modelo: 'M', publico: 'adulto', talla: 'L', es_crudo: false, estado: 'inactivo' })
    expect(rpc(db, 'enviar_lote_tintoreria', { __uid: TINTO, p_crudo_id: 'k', p_color_id: 'z', p_material: 'algodon', p_docenas: 1, p_remalladora_id: REMA }).error?.message).toBe('El SKU K-VERDE está inactivo')
    const lt = rpc(db, 'enviar_lote_tintoreria', { __uid: TINTO, p_crudo_id: 'k', p_color_id: 'a', p_material: 'algodon', p_docenas: 5, p_remalladora_id: REMA }).data
    expect(rpc(db, 'recibir_lote_tintoreria', { __uid: TINTO, p_lote_id: lt, p_docenas_recibidas: 5, p_motivo_merma: 'no hacía falta' }).error).toBeNull()
    expect(db.lotes_tintoreria[0]).toMatchObject({ docenas_merma: 0, motivo_merma: null })
  })
})
