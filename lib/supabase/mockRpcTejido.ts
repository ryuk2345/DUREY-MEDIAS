/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones de la migración 032
 * (tejido 24/6, preparado, stock de fuera). Igual que el SQL: validan todo
 * primero y solo después escriben. `p.__uid` es el usuario de la sesión
 * (en SQL, auth.uid()); lo pone mockDb.ts desde la cookie de sesión mock.
 */
import { ErrorNegocio, nuevoId, tabla, ejecutarHandler, type Db, type ResultadoRpc } from './mockRpcComun'
import { hoyLocal } from '@/lib/domain/mantenimiento'
import { kgHilo, productoVigente, registraProduccion, docenasValidas, puedeSupervisarTejido } from '@/lib/domain/tejido'
import { ETAPAS_STOCK_FUERA, ETAPA_EN_CRUDO, type EtapaStockFuera } from '@/lib/domain/tintoreria'
import { exigirModulo } from './mockRpcTintoreria'

export const RPC_TEJIDO = [
  'asignar_producto_maquina',
  'registrar_produccion_tejido',
  'corregir_produccion_tejido',
  'registrar_produccion_preparado',
  'ingresar_stock_fuera',
] as const

const ahora = () => new Date().toISOString()
const num = (v: unknown) => Number(v ?? 0) || 0
const red2 = (n: number) => Math.round(n * 100) / 100

function exigirAdminOSupervisor(db: Db, uid: string | null | undefined, accion: string): string {
  const u = uid ? tabla(db, 'usuarios').find(x => x.id === uid) : null
  if (!u || u.activo === false || !puedeSupervisarTejido(u.rol)) {
    throw new ErrorNegocio(`Solo el administrador o el supervisor pueden ${accion}`)
  }
  return u.id
}

function usuarioActivo(db: Db, id: string | null | undefined) {
  return id ? tabla(db, 'usuarios').find(u => u.id === id && u.activo !== false) ?? null : null
}

function asignarProducto(db: Db, p: any) {
  const uid = exigirAdminOSupervisor(db, p.__uid, 'cambiar el producto de una máquina')
  const maq = tabla(db, 'maquinas').find(m => m.id === p.p_maquina_id)
  if (!maq) throw new ErrorNegocio('Máquina no encontrada')
  if (maq.tipo !== 'tejedora') throw new ErrorNegocio(`La máquina ${maq.codigo} no es tejedora`)
  const prod = tabla(db, 'catalogo_medias').find(c => c.id === p.p_catalogo_media_id)
  if (!prod) throw new ErrorNegocio('Elige el producto de la máquina')
  if (prod.estado && prod.estado !== 'activo') throw new ErrorNegocio(`El producto ${prod.codigo} está inactivo`)
  const vigente = productoVigente(tabla(db, 'productos_maquina'), maq.id)
  if (vigente?.catalogo_media_id === prod.id) throw new ErrorNegocio(`La máquina ${maq.codigo} ya tiene el producto ${prod.codigo}`)

  const t = ahora()
  if (vigente) vigente.hasta = t
  const id = nuevoId()
  tabla(db, 'productos_maquina').push({ id, maquina_id: maq.id, catalogo_media_id: prod.id, desde: t, hasta: null, asignado_por: uid, created_at: t })
  return id
}

type ItemTejido = { maquina_id: string; docenas: unknown; operario_id?: string | null }

function registrarTejido(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'produccion')
  const hoy = hoyLocal()
  const fecha: string = p.p_fecha || hoy
  if (p.p_horario !== 'dia' && p.p_horario !== 'noche') throw new ErrorNegocio('Elige el turno: día o noche')
  if (fecha > hoy) throw new ErrorNegocio('No se registra producción de una fecha futura')
  if (!usuarioActivo(db, p.p_encargado_id)) throw new ErrorNegocio('Elige el encargado del turno')
  const items: ItemTejido[] = Array.isArray(p.p_items) ? p.p_items : []
  if (items.length === 0) throw new ErrorNegocio('Anota la producción de al menos una máquina')
  if (items.some(i => !i.maquina_id)) throw new ErrorNegocio('Falta la máquina en una fila')
  if (new Set(items.map(i => i.maquina_id)).size !== items.length) throw new ErrorNegocio('Una máquina aparece más de una vez')
  if (items.some(i => !docenasValidas(i.docenas))) throw new ErrorNegocio('Las docenas deben ser un número entre 0 y 10 000')
  if (items.some(i => !usuarioActivo(db, i.operario_id))) throw new ErrorNegocio('Elige el operario de cada máquina')

  const productos = tabla(db, 'productos_maquina')
  const filas = items
    .map(i => ({ i, m: tabla(db, 'maquinas').find(x => x.id === i.maquina_id), pm: productoVigente(productos, i.maquina_id) }))
    .sort((a, b) => String(a.m?.codigo ?? '').localeCompare(String(b.m?.codigo ?? '')))
  for (const { m, pm } of filas) {
    if (!m) throw new ErrorNegocio('Una de las máquinas no existe')
    if (m.tipo !== 'tejedora') throw new ErrorNegocio(`La máquina ${m.codigo} no es tejedora`)
    if (!registraProduccion(m.estado)) throw new ErrorNegocio(`La máquina ${m.codigo} está ${m.estado} y no registra producción`)
    if (!pm) throw new ErrorNegocio(`La máquina ${m.codigo} no tiene producto asignado`)
  }

  const turnos = tabla(db, 'turnos_produccion')
  let turno = turnos.find(t => t.registro_24_6 && t.fecha === fecha && t.horario === p.p_horario)
  if (turno && turno.tejedor_id !== p.p_encargado_id) {
    const nombre = tabla(db, 'usuarios').find(u => u.id === turno.tejedor_id)?.nombre ?? ''
    throw new ErrorNegocio(`El turno ya tiene otro encargado (${nombre})`)
  }
  if (turno) {
    const ya = filas.find(({ m }) => tabla(db, 'reportes_produccion').some(r => r.turno_id === turno.id && r.maquina_id === m.id))
    if (ya) throw new ErrorNegocio(`La máquina ${ya.m.codigo} ya está registrada en este turno`)
  }

  // Hilo por las docenas reales
  const requerido = new Map<string, number>()
  for (const { i, pm } of filas) {
    const media = tabla(db, 'catalogo_medias').find(c => c.id === pm!.catalogo_media_id)
    if (!media?.materia_prima_id || num(i.docenas) <= 0) continue
    requerido.set(media.materia_prima_id, (requerido.get(media.materia_prima_id) ?? 0) + kgHilo(num(i.docenas), media.peso_docena_g))
  }
  for (const [mpId, necesario] of requerido) {
    const mp = tabla(db, 'materia_prima').find(x => x.id === mpId)
    const stock = num(mp?.stock_kg)
    if (stock < necesario) {
      throw new ErrorNegocio(`Falta de materia prima: se requieren ${necesario.toFixed(2)} kg de ${mp?.material ?? ''} ${mp?.color ?? ''} pero solo quedan ${stock.toFixed(2)} kg`)
    }
  }

  // ── Escrituras ──
  const t = ahora()
  if (!turno) {
    turno = { id: nuevoId(), tejedor_id: p.p_encargado_id, fecha, horario: p.p_horario, duracion_horas: 12, estado: 'cerrado', registro_24_6: true, created_at: t }
    turnos.push(turno)
  }
  for (const [mpId, necesario] of requerido) {
    const mp = tabla(db, 'materia_prima').find(x => x.id === mpId)
    mp.stock_kg = num(mp.stock_kg) - necesario
    tabla(db, 'movimientos_materia_prima').push({ id: nuevoId(), materia_prima_id: mpId, tipo: 'consumo_produccion', cantidad_kg: necesario, referencia_id: turno.id, created_at: t })
  }
  for (const { i, pm } of filas) {
    tabla(db, 'reportes_produccion').push({
      id: nuevoId(), turno_id: turno.id, maquina_id: i.maquina_id, catalogo_media_id: pm!.catalogo_media_id,
      docenas_producidas: red2(num(i.docenas)), fecha, operario_id: i.operario_id, registrado_por: p.__uid ?? null, created_at: t,
    })
  }
  return turno.id
}

function corregirTejido(db: Db, p: any) {
  const uid = exigirAdminOSupervisor(db, p.__uid, 'corregir la producción de un turno')
  if (!docenasValidas(p.p_docenas)) throw new ErrorNegocio('Las docenas deben ser un número entre 0 y 10 000')
  if (!usuarioActivo(db, p.p_operario_id)) throw new ErrorNegocio('Elige el operario de la máquina')
  const r = tabla(db, 'reportes_produccion').find(x => x.id === p.p_reporte_id)
  if (!r) throw new ErrorNegocio('Registro de producción no encontrado')
  const turno = tabla(db, 'turnos_produccion').find(t => t.id === r.turno_id)
  if (!turno?.registro_24_6) throw new ErrorNegocio('Solo se corrigen registros del turno 24/6')
  if (hoyLocal(new Date(r.created_at ?? ahora())) !== hoyLocal()) throw new ErrorNegocio('Solo se corrige el mismo día en que se registró')

  const nuevas = red2(num(p.p_docenas))
  const dif = nuevas - num(r.docenas_producidas)
  const media = tabla(db, 'catalogo_medias').find(c => c.id === r.catalogo_media_id)
  let mp: any = null
  let kg = 0
  if (dif !== 0 && media?.materia_prima_id) {
    kg = kgHilo(Math.abs(dif), media.peso_docena_g)
    mp = tabla(db, 'materia_prima').find(x => x.id === media.materia_prima_id)
    if (dif > 0 && num(mp?.stock_kg) < kg) {
      throw new ErrorNegocio(`Falta de materia prima: se requieren ${kg.toFixed(2)} kg de ${mp?.material ?? ''} ${mp?.color ?? ''} pero solo quedan ${num(mp?.stock_kg).toFixed(2)} kg`)
    }
  }
  if (mp) {
    mp.stock_kg = num(mp.stock_kg) - Math.sign(dif) * kg
    tabla(db, 'movimientos_materia_prima').push({
      id: nuevoId(), materia_prima_id: mp.id, tipo: dif > 0 ? 'consumo_produccion' : 'devolucion', cantidad_kg: kg, referencia_id: r.turno_id, created_at: ahora(),
    })
  }
  r.docenas_producidas = nuevas
  r.operario_id = p.p_operario_id
  r.registrado_por = uid
  return null
}

type ItemPreparado = { catalogo_media_id: string; docenas?: unknown; defectuosas?: unknown }

function registrarPreparado(db: Db, p: any) {
  exigirModulo(db, p.__uid, 'preparado')
  if (!usuarioActivo(db, p.p_preparador_id)) throw new ErrorNegocio('Elige el preparador')
  const codigo = String(p.p_codigo_paquete ?? '').trim()
  if (!codigo) throw new ErrorNegocio('Falta el código del saco')
  if (!tabla(db, 'ubicaciones').some(u => u.id === p.p_ubicacion_id && u.activo !== false)) throw new ErrorNegocio('Elige el salón que recibe el saco')
  const items: ItemPreparado[] = Array.isArray(p.p_items) ? p.p_items : []
  if (items.length === 0) throw new ErrorNegocio('Anota las docenas preparadas')
  if (items.some(i => !i.catalogo_media_id || num(i.docenas) < 0 || num(i.defectuosas) < 0
    || Number.isNaN(Number(i.docenas ?? 0)) || Number.isNaN(Number(i.defectuosas ?? 0)))) {
    throw new ErrorNegocio('Las docenas no pueden ser negativas')
  }
  const total = items.reduce((s, i) => s + num(i.docenas), 0)
  if (total <= 0) throw new ErrorNegocio('El saco debe llevar al menos una docena preparada')
  if (new Set(items.map(i => i.catalogo_media_id)).size > 1) throw new ErrorNegocio('Un saco lleva un solo SKU: crea un saco por cada SKU')

  const porMedia = new Map<string, { buenas: number; malas: number }>()
  for (const i of items) {
    const a = porMedia.get(i.catalogo_media_id) ?? { buenas: 0, malas: 0 }
    a.buenas += num(i.docenas); a.malas += num(i.defectuosas)
    porMedia.set(i.catalogo_media_id, a)
  }
  const stock = tabla(db, 'stock_listo_preparar')
  for (const [mediaId, a] of [...porMedia].sort(([x], [y]) => x.localeCompare(y))) {
    const hay = num(stock.find(s => s.catalogo_media_id === mediaId)?.docenas)
    if (hay < a.buenas + a.malas) {
      const cod = tabla(db, 'catalogo_medias').find(c => c.id === mediaId)?.codigo ?? 'la media'
      throw new ErrorNegocio(`No hay suficiente stock por preparar de ${cod}: se registran ${a.buenas + a.malas} docenas y hay ${hay}`)
    }
  }
  if (tabla(db, 'paquetes').some(x => x.codigo_paquete === codigo)) {
    throw new ErrorNegocio('duplicate key value violates unique constraint "paquetes_codigo_paquete_key"')
  }

  // ── Escrituras ──
  const t = ahora()
  for (const [mediaId, a] of porMedia) {
    const fila = stock.find(s => s.catalogo_media_id === mediaId)
    fila.docenas = red2(num(fila.docenas) - a.buenas - a.malas)
    fila.updated_at = t
  }
  const catalogo = tabla(db, 'catalogo_medias')
  const detalles = [...porMedia].filter(([, a]) => a.buenas > 0).map(([mediaId, a]) => {
    const c = catalogo.find(x => x.id === mediaId)
    return { catalogo_media_id: mediaId, sku: c?.sku ?? `SKU-${String(c?.codigo ?? '').toUpperCase()}`, codigo: c?.codigo ?? '', docenas: a.buenas, pares: Math.round(a.buenas * 12) }
  }).sort((x, y) => x.codigo.localeCompare(y.codigo))
  const principal = [...porMedia].filter(([, a]) => a.buenas > 0).sort(([x, a], [y, b]) => b.buenas - a.buenas || x.localeCompare(y))[0][0]
  const paqueteId = nuevoId()
  tabla(db, 'paquetes').push({
    id: paqueteId, codigo_paquete: codigo, preparador_id: p.p_preparador_id, catalogo_media_id: principal,
    docenas: total, total_pares: Math.round(total * 12), qr_data: p.p_qr_data ?? null, detalles_contenido: detalles,
    estado: 'pendiente_almacenar', ubicacion_id: p.p_ubicacion_id, fecha: hoyLocal(), created_at: t, updated_at: t,
  })
  for (const [mediaId, a] of porMedia) {
    if (a.buenas + a.malas <= 0) continue
    tabla(db, 'reportes_preparado').push({
      id: nuevoId(), preparador_id: p.p_preparador_id, catalogo_media_id: mediaId, paquete_id: paqueteId, fecha: hoyLocal(),
      docenas_preparadas: a.buenas, docenas_defectuosas: a.malas, registrado_por: p.__uid ?? null, created_at: t,
    })
  }
  return paqueteId
}

/** Suma docenas al stock de una etapa (por voltear, por teñir, por planchar, por preparar). */
export function sumarStockEtapa(db: Db, nombreTabla: 'stock_listo_voltear' | 'stock_listo_tenir' | 'stock_listo_planchar' | 'stock_listo_preparar', mediaId: string, docenas: number) {
  const filas = tabla(db, nombreTabla)
  const fila = filas.find(s => s.catalogo_media_id === mediaId)
  if (fila) { fila.docenas = red2(num(fila.docenas) + docenas); fila.updated_at = ahora() }
  else filas.push({ id: nuevoId(), catalogo_media_id: mediaId, docenas: red2(docenas), updated_at: ahora() })
}

const TABLA_ETAPA: Record<EtapaStockFuera, 'stock_listo_voltear' | 'stock_listo_tenir' | 'stock_listo_planchar' | 'stock_listo_preparar' | null> = {
  remallado: null, volteado: 'stock_listo_voltear', tintoreria: 'stock_listo_tenir', planchado: 'stock_listo_planchar', preparado: 'stock_listo_preparar',
}

function ingresarStockFuera(db: Db, p: any) {
  if (!(ETAPAS_STOCK_FUERA as readonly string[]).includes(p.p_etapa)) throw new ErrorNegocio('Elige la etapa en la que están las medias')
  const etapa = p.p_etapa as EtapaStockFuera
  const uid = exigirModulo(db, p.__uid, etapa)
  const docenas = Number(p.p_docenas)
  if (!Number.isFinite(docenas) || docenas <= 0 || docenas > 100000) throw new ErrorNegocio('Las docenas deben ser mayores a 0')
  const origen = String(p.p_origen ?? '').trim()
  if (!origen) throw new ErrorNegocio('Indica de dónde vienen las medias')
  const prod = tabla(db, 'catalogo_medias').find(c => c.id === p.p_catalogo_media_id)
  if (!prod) throw new ErrorNegocio('Elige el producto')
  if (ETAPA_EN_CRUDO[etapa] && !prod.es_crudo) throw new ErrorNegocio(`En ${etapa} las medias están en crudo: elige la media cruda`)
  if (!ETAPA_EN_CRUDO[etapa] && prod.es_crudo) throw new ErrorNegocio(`En ${etapa} las medias ya tienen color: elige su SKU de color`)

  const destino = TABLA_ETAPA[etapa]
  if (destino) sumarStockEtapa(db, destino, p.p_catalogo_media_id, docenas)  // remallado: solo queda registrado (decisión C2)
  const id = nuevoId()
  tabla(db, 'ingresos_stock_fuera').push({
    id, etapa, catalogo_media_id: p.p_catalogo_media_id, docenas: red2(docenas), origen, registrado_por: uid ?? p.__uid ?? null, created_at: ahora(),
  })
  return id
}

export function ejecutarRpcTejido(db: Db, fnName: string, params: any): ResultadoRpc | null {
  return ejecutarHandler({
    asignar_producto_maquina: asignarProducto,
    registrar_produccion_tejido: registrarTejido,
    corregir_produccion_tejido: corregirTejido,
    registrar_produccion_preparado: registrarPreparado,
    ingresar_stock_fuera: ingresarStockFuera,
  }, db, fnName, params)
}
