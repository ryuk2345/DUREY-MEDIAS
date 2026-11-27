/**
 * Fase 5A — Tejido 24/6, preparado con la lógica de planchado y stock de fuera.
 * Spec: 02-DOCS/wiki/sdd/specs/fase-5-flujo-produccion.md · SQL: migración 032.
 * El mock debe comportarse igual que el SQL (supabase/tests/032_*.test.sql).
 */
import { describe, it, expect } from 'vitest'
import {
  kgHilo, productoVigente, registraProduccion, docenasValidas, puedeSupervisarTejido, PESO_DOCENA_POR_DEFECTO_G,
} from '@/lib/domain/tejido'
import { ejecutarRpcTejido } from '@/lib/supabase/mockRpcTejido'
import { ejecutarRpcProcesos } from '@/lib/supabase/mockRpcProcesos'
import { hoyLocal } from '@/lib/domain/mantenimiento'

type Db = Record<string, any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = (db: Db, fn: string, p: Record<string, unknown>) => ejecutarRpcTejido(db, fn, p)!

const ADMIN = 'u-admin', SUPER = 'u-super', JUAN = 'u-juan', ANA = 'u-ana', PREP = 'u-prep', BAJA = 'u-baja'

function base(): Db {
  return {
    usuarios: [
      { id: ADMIN, nombre: 'Admin', rol: 'admin', activo: true },
      { id: SUPER, nombre: 'Super', rol: 'supervisor', activo: true },
      { id: JUAN, nombre: 'Juan', rol: 'tejedor', activo: true },
      { id: ANA, nombre: 'Ana', rol: 'tejedor', activo: true },
      { id: PREP, nombre: 'Prep', rol: 'operador', activo: true }, // 033: operador (planchado y preparado)
      { id: BAJA, nombre: 'Baja', rol: 'tejedor', activo: false },
      { id: 'u-admin-baja', nombre: 'Admin baja', rol: 'admin', activo: false },
    ],
    materia_prima: [{ id: 'mp1', material: 'Algodón', color: 'Crudo', stock_kg: 10 }],
    catalogo_medias: [
      { id: 'cA', codigo: 'T-A', sku: 'SKU-TA', estado: 'activo', peso_docena_g: 400, materia_prima_id: 'mp1' },
      { id: 'cB', codigo: 'T-B', sku: null, estado: 'activo', peso_docena_g: 500, materia_prima_id: 'mp1' },
    ],
    maquinas: [
      { id: 'm1', codigo: 'T01', tipo: 'tejedora', estado: 'activa' },
      { id: 'm2', codigo: 'T02', tipo: 'tejedora', estado: 'activa' },
      { id: 'm3', codigo: 'T03', tipo: 'tejedora', estado: 'malograda' },
      { id: 'm4', codigo: 'R01', tipo: 'remalladora', estado: 'activa' },
      { id: 'm5', codigo: 'T05', tipo: 'tejedora', estado: 'activa' },
    ],
    ubicaciones: [{ id: 's1', nombre: 'Salón A', activo: true }],
    productos_maquina: [], turnos_produccion: [], reportes_produccion: [], movimientos_materia_prima: [],
    stock_listo_planchar: [], stock_listo_preparar: [], reportes_planchado: [], reportes_preparado: [], paquetes: [], ingresos_stock_fuera: [],
  }
}

function conProductos(): Db {
  const db = base()
  expect(rpc(db, 'asignar_producto_maquina', { __uid: SUPER, p_maquina_id: 'm1', p_catalogo_media_id: 'cA' }).error).toBeNull()
  expect(rpc(db, 'asignar_producto_maquina', { __uid: SUPER, p_maquina_id: 'm2', p_catalogo_media_id: 'cA' }).error).toBeNull()
  expect(rpc(db, 'asignar_producto_maquina', { __uid: ADMIN, p_maquina_id: 'm2', p_catalogo_media_id: 'cB' }).error).toBeNull()
  expect(rpc(db, 'asignar_producto_maquina', { __uid: ADMIN, p_maquina_id: 'm3', p_catalogo_media_id: 'cA' }).error).toBeNull()
  return db
}

const item = (maquina_id: string, docenas: unknown, operario_id: string | null = JUAN) => ({ maquina_id, docenas, operario_id })

describe('reglas de tejido 24/6 (lib/domain/tejido)', () => {
  it('hilo por docenas reales: docenas × peso por docena', () => {
    expect(kgHilo(12, 400)).toBeCloseTo(4.8)
    expect(kgHilo(4, 500)).toBeCloseTo(2)
    expect(kgHilo(10, null)).toBeCloseTo(10 * PESO_DOCENA_POR_DEFECTO_G / 1000)
  })
  it('producto vigente = el que no tiene "hasta"', () => {
    const pm = [
      { maquina_id: 'm1', catalogo_media_id: 'cA', desde: '2026-01-01', hasta: '2026-02-01' },
      { maquina_id: 'm1', catalogo_media_id: 'cB', desde: '2026-02-01', hasta: null },
    ]
    expect(productoVigente(pm, 'm1')?.catalogo_media_id).toBe('cB')
    expect(productoVigente(pm, 'm2')).toBeNull()
  })
  it('solo administrador y supervisor supervisan tejido', () => {
    expect(puedeSupervisarTejido('admin')).toBe(true)
    expect(puedeSupervisarTejido('supervisor')).toBe(true)
    expect(puedeSupervisarTejido('tejedor')).toBe(false)
    expect(puedeSupervisarTejido(null)).toBe(false)
  })
  it('estados sin producción y docenas válidas', () => {
    expect(['malograda', 'mantenimiento', 'inactiva'].map(registraProduccion)).toEqual([false, false, false])
    expect(['activa', 'ocupada', 'standby'].map(registraProduccion)).toEqual([true, true, true])
    expect([0, 12, '3.5', 10000].map(docenasValidas)).toEqual([true, true, true, true])
    expect([-1, 10000.01, 'abc', '', null, NaN, Infinity].map(docenasValidas)).toEqual([false, false, false, false, false, false, false])
  })
})

describe('mock: producto fijo por máquina', () => {
  it('un tejedor o sin sesión no cambian el producto', () => {
    const db = base()
    expect(rpc(db, 'asignar_producto_maquina', { __uid: JUAN, p_maquina_id: 'm1', p_catalogo_media_id: 'cA' }).error?.message).toContain('Solo el administrador o el supervisor')
    expect(rpc(db, 'asignar_producto_maquina', { __uid: null, p_maquina_id: 'm1', p_catalogo_media_id: 'cA' }).error?.message).toContain('Solo el administrador o el supervisor')
    expect(rpc(db, 'asignar_producto_maquina', { __uid: 'u-admin-baja', p_maquina_id: 'm1', p_catalogo_media_id: 'cA' }).error?.message).toContain('Solo el administrador o el supervisor')
    expect(db.productos_maquina).toHaveLength(0)
  })
  it('el cambio guarda historial; el mismo producto otra vez o una remalladora se rechazan', () => {
    const db = conProductos()
    const deM2 = db.productos_maquina.filter(p => p.maquina_id === 'm2')
    expect(deM2).toHaveLength(2)
    expect(deM2.find(p => !p.hasta)).toMatchObject({ catalogo_media_id: 'cB', asignado_por: ADMIN })
    expect(rpc(db, 'asignar_producto_maquina', { __uid: ADMIN, p_maquina_id: 'm2', p_catalogo_media_id: 'cB' }).error?.message).toContain('ya tiene el producto')
    expect(rpc(db, 'asignar_producto_maquina', { __uid: ADMIN, p_maquina_id: 'm4', p_catalogo_media_id: 'cA' }).error?.message).toContain('no es tejedora')
  })
})

describe('mock: registro de producción por turno', () => {
  const registrar = (db: Db, horario: string, encargado: string, items: unknown[], fecha: string | null = null) =>
    rpc(db, 'registrar_produccion_tejido', { __uid: ANA, p_fecha: fecha, p_horario: horario, p_encargado_id: encargado, p_items: items })

  it('rechaza lo inválido sin escribir nada', () => {
    const db = conProductos()
    const casos: [string, string, unknown[], string, string | null][] = [
      ['tarde', ANA, [item('m1', 1)], 'día o noche', null],
      ['dia', ANA, [item('m1', 1)], 'futura', '2999-01-01'],
      ['dia', '', [item('m1', 1)], 'encargado', null],
      ['dia', BAJA, [item('m1', 1)], 'encargado', null],
      ['dia', ANA, [item('m1', 10000.01)], 'entre 0 y 10 000', null],
      ['dia', ANA, [], 'al menos una máquina', null],
      ['dia', ANA, [item('m1', 1), item('m1', 1)], 'más de una vez', null],
      ['dia', ANA, [item('m1', -1)], 'entre 0 y 10 000', null],
      ['dia', ANA, [item('m1', 'NaN')], 'entre 0 y 10 000', null],
      ['dia', ANA, [item('m1', 2, null)], 'operario de cada máquina', null],
      ['dia', ANA, [item('m1', 2, BAJA)], 'operario de cada máquina', null],
      ['dia', ANA, [item('m3', 2)], 'T03 está malograda', null],
      ['dia', ANA, [item('m5', 2)], 'T05 no tiene producto', null],
      ['dia', ANA, [item('m4', 2)], 'no es tejedora', null],
      ['noche', ANA, [item('m1', 30)], 'Falta de materia prima', null], // 30 × 0,4 = 12 kg y hay 10
    ]
    for (const [horario, enc, items, msg, fecha] of casos) {
      expect(registrar(db, horario, enc, items, fecha).error?.message, msg).toContain(msg)
    }
    expect(db.turnos_produccion).toHaveLength(0)
    expect(db.materia_prima[0].stock_kg).toBe(10)
  })

  it('registra docenas y operario por máquina, descuenta el hilo real y no ocupa la máquina', () => {
    const db = conProductos()
    const r = registrar(db, 'noche', ANA, [item('m1', 12, JUAN), item('m2', 4, ANA)])
    expect(r.error).toBeNull()
    expect(db.materia_prima[0].stock_kg).toBeCloseTo(3.2) // 10 − (4,8 + 2)
    expect(db.movimientos_materia_prima).toEqual([expect.objectContaining({ tipo: 'consumo_produccion', referencia_id: r.data })])
    expect(db.movimientos_materia_prima[0].cantidad_kg).toBeCloseTo(6.8)
    expect(db.reportes_produccion.find(x => x.maquina_id === 'm1')).toMatchObject({ docenas_producidas: 12, operario_id: JUAN, catalogo_media_id: 'cA', registrado_por: ANA, fecha: hoyLocal() })
    expect(db.reportes_produccion.find(x => x.maquina_id === 'm2')?.catalogo_media_id).toBe('cB') // el producto nuevo
    expect(db.maquinas.find(m => m.id === 'm1')?.estado).toBe('activa')
    expect(db.turnos_produccion[0]).toMatchObject({ tejedor_id: ANA, horario: 'noche', registro_24_6: true })
  })

  it('una máquina una vez por turno; otro encargado no; día y noche son turnos distintos; 0 docenas no gastan hilo', () => {
    const db = conProductos()
    registrar(db, 'noche', ANA, [item('m1', 12)])
    expect(registrar(db, 'noche', ANA, [item('m1', 1)]).error?.message).toContain('T01 ya está registrada')
    expect(registrar(db, 'noche', JUAN, [item('m2', 1)]).error?.message).toContain('otro encargado (Ana)')
    const stock = db.materia_prima[0].stock_kg
    expect(registrar(db, 'dia', JUAN, [item('m1', 0)]).error).toBeNull()
    expect(db.turnos_produccion).toHaveLength(2)
    expect(db.materia_prima[0].stock_kg).toBe(stock)
  })
})

describe('mock: corrección del mismo día', () => {
  function registrado() {
    const db = conProductos()
    rpc(db, 'registrar_produccion_tejido', { __uid: ANA, p_horario: 'noche', p_encargado_id: ANA, p_items: [item('m1', 12), item('m2', 4)] })
    return { db, rep: db.reportes_produccion.find(x => x.maquina_id === 'm1')! }
  }
  it('solo administrador o supervisor; hilo insuficiente y NaN se rechazan', () => {
    const { db, rep } = registrado()
    expect(rpc(db, 'corregir_produccion_tejido', { __uid: JUAN, p_reporte_id: rep.id, p_docenas: 10, p_operario_id: JUAN }).error?.message).toContain('Solo el administrador o el supervisor')
    expect(rpc(db, 'corregir_produccion_tejido', { __uid: SUPER, p_reporte_id: rep.id, p_docenas: 21, p_operario_id: JUAN }).error?.message).toContain('Falta de materia prima')
    expect(rpc(db, 'corregir_produccion_tejido', { __uid: SUPER, p_reporte_id: rep.id, p_docenas: 'NaN', p_operario_id: JUAN }).error?.message).toContain('entre 0 y 10 000')
    expect(rep.docenas_producidas).toBe(12)
  })
  it('12 → 10 devuelve 0,8 kg; 10 → 11 descuenta 0,4 kg; cambia operario y quién registró', () => {
    const { db, rep } = registrado()
    expect(rpc(db, 'corregir_produccion_tejido', { __uid: SUPER, p_reporte_id: rep.id, p_docenas: 10, p_operario_id: ANA }).error).toBeNull()
    expect(db.materia_prima[0].stock_kg).toBeCloseTo(4)
    expect(rep).toMatchObject({ docenas_producidas: 10, operario_id: ANA, registrado_por: SUPER })
    expect(db.movimientos_materia_prima.at(-1)).toMatchObject({ tipo: 'devolucion' })
    expect(db.movimientos_materia_prima.at(-1)!.cantidad_kg).toBeCloseTo(0.8)
    rpc(db, 'corregir_produccion_tejido', { __uid: ADMIN, p_reporte_id: rep.id, p_docenas: 11, p_operario_id: ANA })
    expect(db.materia_prima[0].stock_kg).toBeCloseTo(3.6)
  })
  it('un registro de otro día ya no se corrige', () => {
    const { db, rep } = registrado()
    rep.created_at = new Date(Date.now() - 2 * 86400000).toISOString()
    expect(rpc(db, 'corregir_produccion_tejido', { __uid: SUPER, p_reporte_id: rep.id, p_docenas: 1, p_operario_id: JUAN }).error?.message).toContain('mismo día')
  })
})

describe('mock: planchado → por preparar → saco; stock de fuera', () => {
  function conPlanchado() {
    const db = base()
    db.stock_listo_planchar.push({ id: 'sp', catalogo_media_id: 'cA', docenas: 10 })
    const r = ejecutarRpcProcesos(db, 'registrar_produccion_planchado', {
      p_items: [{ planchador_id: PREP, catalogo_media_id: 'cA', docenas_planchadas: 7, docenas_defectuosas: 1 }],
    })!
    expect(r.error).toBeNull()
    return db
  }
  it('planchar 7 + 1 defectuosa deja 2 por planchar y 7 por preparar; NaN se rechaza', () => {
    const db = conPlanchado()
    expect(db.stock_listo_planchar[0].docenas).toBe(2)
    expect(db.stock_listo_preparar.find(s => s.catalogo_media_id === 'cA')?.docenas).toBe(7)
    expect(ejecutarRpcProcesos(db, 'registrar_produccion_planchado', { p_items: [{ catalogo_media_id: 'cA', docenas_planchadas: 'NaN' }] })!.error?.message).toContain('negativas')
  })

  it('stock de fuera: valida, suma a la etapa elegida, guarda origen y quién; sin egreso', () => {
    const db = conPlanchado()
    const fuera = (etapa: string, docenas: unknown, origen: string) =>
      rpc(db, 'ingresar_stock_fuera', { __uid: PREP, p_etapa: etapa, p_catalogo_media_id: 'cB', p_docenas: docenas, p_origen: origen })
    expect(fuera('empaque', 5, 'x').error?.message).toContain('etapa')
    expect(fuera('planchado', 0, 'x').error?.message).toContain('mayores a 0')
    expect(fuera('planchado', 'NaN', 'x').error?.message).toContain('mayores a 0')
    expect(fuera('planchado', 5, '  ').error?.message).toContain('de dónde vienen')
    expect(fuera('planchado', 5, ' Producción antes del sistema ').error).toBeNull()
    expect(fuera('preparado', 3, 'Taller externo').error).toBeNull()
    expect(db.stock_listo_planchar.find(s => s.catalogo_media_id === 'cB')?.docenas).toBe(5)
    expect(db.stock_listo_preparar.find(s => s.catalogo_media_id === 'cB')?.docenas).toBe(3)
    expect(db.ingresos_stock_fuera).toHaveLength(2)
    expect(db.ingresos_stock_fuera[0]).toMatchObject({ origen: 'Producción antes del sistema', registrado_por: PREP, etapa: 'planchado' })
    expect(db.egresos_adicionales).toBeUndefined()
  })

  it('preparado descuenta por preparar y crea el saco con su contenido por SKU', () => {
    const db = conPlanchado()
    rpc(db, 'ingresar_stock_fuera', { __uid: PREP, p_etapa: 'preparado', p_catalogo_media_id: 'cB', p_docenas: 3, p_origen: 'Taller' })
    const saco = (items: unknown[], codigo = 'S-1', ubic: string | null = 's1') =>
      rpc(db, 'registrar_produccion_preparado', { __uid: PREP, p_preparador_id: PREP, p_codigo_paquete: codigo, p_ubicacion_id: ubic, p_items: items, p_qr_data: 'qr' })
    expect(saco([{ catalogo_media_id: 'cA', docenas: 8 }]).error?.message).toBe('No hay suficiente stock por preparar de T-A: se registran 8 docenas y hay 7')
    expect(saco([{ catalogo_media_id: 'cA', docenas: 0, defectuosas: 1 }]).error?.message).toContain('al menos una docena preparada')
    expect(saco([{ catalogo_media_id: 'cA', docenas: 1 }], ' ').error?.message).toContain('código del saco')
    expect(saco([{ catalogo_media_id: 'cA', docenas: 1 }], 'S-1', null).error?.message).toContain('salón')
    // 034: un saco lleva un solo SKU
    expect(saco([{ catalogo_media_id: 'cA', docenas: 6 }, { catalogo_media_id: 'cB', docenas: 2 }]).error?.message).toContain('un solo SKU')
    const r = saco([{ catalogo_media_id: 'cA', docenas: 6, defectuosas: 1 }])
    expect(r.error).toBeNull()
    expect(saco([{ catalogo_media_id: 'cB', docenas: 2 }], 'S-2').error).toBeNull()
    expect(db.stock_listo_preparar.find(s => s.catalogo_media_id === 'cA')?.docenas).toBe(0)
    expect(db.stock_listo_preparar.find(s => s.catalogo_media_id === 'cB')?.docenas).toBe(1)
    const paq = db.paquetes.find(p => p.id === r.data)!
    expect(paq).toMatchObject({ codigo_paquete: 'S-1', docenas: 6, total_pares: 72, estado: 'pendiente_almacenar', catalogo_media_id: 'cA', ubicacion_id: 's1', qr_data: 'qr' })
    expect(paq.detalles_contenido).toEqual([{ catalogo_media_id: 'cA', sku: 'SKU-TA', codigo: 'T-A', docenas: 6, pares: 72 }])
    expect(db.paquetes.find(p => p.codigo_paquete === 'S-2')?.detalles_contenido).toEqual([{ catalogo_media_id: 'cB', sku: 'SKU-T-B', codigo: 'T-B', docenas: 2, pares: 24 }])
    expect(db.reportes_preparado).toHaveLength(2)
    expect(db.reportes_preparado.find(x => x.catalogo_media_id === 'cA')).toMatchObject({ docenas_preparadas: 6, docenas_defectuosas: 1, paquete_id: r.data, preparador_id: PREP })
    // Código repetido: no descuenta nada
    expect(saco([{ catalogo_media_id: 'cB', docenas: 1 }]).error?.message).toContain('duplicate key')
    expect(db.stock_listo_preparar.find(s => s.catalogo_media_id === 'cB')?.docenas).toBe(1)
  })
})

describe('etiqueta del saco: escaparHtml', () => {
  it('un nombre o código con HTML no se ejecuta al imprimir', async () => {
    const { escaparHtml } = await import('@/lib/utils')
    expect(escaparHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(escaparHtml("O'Brien & Hijos")).toBe('O&#39;Brien &amp; Hijos')
    expect(escaparHtml(null)).toBe('')
  })
})

describe('mock: historia clínica con el operario del turno 24/6', () => {
  it('la persona de la producción es el operario; sin operario (turno anterior), el encargado', async () => {
    const { construirHistoriaMock } = await import('@/lib/supabase/mockHistoria')
    const db = conProductos()
    rpc(db, 'registrar_produccion_tejido', { __uid: ANA, p_horario: 'noche', p_encargado_id: ANA, p_items: [item('m1', 12, JUAN)] })
    db.turnos_produccion.push({ id: 't-viejo', tejedor_id: ANA, fecha: '2026-01-01', horario: 'dia' })
    db.reportes_produccion.push({ id: 'r-viejo', turno_id: 't-viejo', maquina_id: 'm2', catalogo_media_id: 'cA', docenas_producidas: 3, fecha: '2026-01-01' })
    const filas = construirHistoriaMock(db).filter(f => f.tipo === 'produccion')
    expect(filas.find(f => f.maquina_id === 'm1')?.persona).toBe('Juan')
    expect(filas.find(f => f.maquina_id === 'm2')?.persona).toBe('Ana')
  })
})

describe('mock: corrección con operario dado de baja', () => {
  it('se rechaza', () => {
    const db = conProductos()
    rpc(db, 'registrar_produccion_tejido', { __uid: ANA, p_horario: 'noche', p_encargado_id: ANA, p_items: [item('m1', 2)] })
    const rep = db.reportes_produccion[0]
    expect(rpc(db, 'corregir_produccion_tejido', { __uid: SUPER, p_reporte_id: rep.id, p_docenas: 1, p_operario_id: BAJA }).error?.message).toContain('Elige el operario de la máquina')
    expect(rep.docenas_producidas).toBe(2)
  })
})
