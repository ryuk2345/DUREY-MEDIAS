/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de las funciones RPC de la migración
 * 021_rpc_produccion_y_averias.sql. Deben comportarse igual que el SQL:
 * validan todo primero y solo después escriben, así un error no deja
 * cambios a medias. mockDb.ts guarda la base solo si no hubo error.
 */
import { validarTransicionEstadoMaquina, type EstadoMaquina } from '@/lib/domain/machines'

type Db = Record<string, any[]>
type Resultado = { data: unknown; error: { message: string } | null }

/** Kg de hilo reservados por máquina al cargar un lote: 15 docenas × peso de la docena. */
export const DOCENAS_RESERVADAS_POR_MAQUINA = 15
const PESO_DOCENA_POR_DEFECTO_G = 360

export const RPC_PRODUCCION = [
  'cargar_lote_produccion',
  'cerrar_turno_produccion',
  'reportar_averia_maquina',
  'iniciar_reparacion_averia',
  'registrar_reparacion_averia',
] as const

class ErrorNegocio extends Error {}

function nuevoId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'mock-' + Math.random().toString(36).slice(2, 11)
}

function tabla(db: Db, nombre: string) {
  if (!db[nombre]) db[nombre] = []
  return db[nombre]
}

function exigirTransicion(maq: any, nuevo: EstadoMaquina, mensaje: string) {
  if (maq.estado === nuevo) throw new ErrorNegocio(mensaje)
  const v = validarTransicionEstadoMaquina(maq.estado as EstadoMaquina, nuevo)
  if (!v.valido) throw new ErrorNegocio(mensaje)
}

function liberarTejedorSiNoTieneTurnos(db: Db, tejedorId: string | null) {
  if (!tejedorId) return
  const otroActivo = tabla(db, 'turnos_produccion').some(t => t.tejedor_id === tejedorId && t.estado === 'activo')
  if (otroActivo) return
  const u = tabla(db, 'usuarios').find(x => x.id === tejedorId)
  if (u) u.estado = 'disponible'
}

function liberarMaquinasOcupadasDelTurno(db: Db, turnoId: string) {
  const ids = tabla(db, 'turno_maquinas').filter(tm => tm.turno_id === turnoId).map(tm => tm.maquina_id)
  for (const m of tabla(db, 'maquinas')) {
    if (ids.includes(m.id) && m.estado === 'ocupada') m.estado = 'activa'
  }
}

function cargarLote(db: Db, p: any) {
  const asignaciones: { maquina_id: string; catalogo_media_id: string }[] = p.p_asignaciones ?? []
  if (!p.p_tejedor_id) throw new ErrorNegocio('Selecciona un operador de turno (tejedor encargado)')
  if (!Array.isArray(asignaciones) || asignaciones.length === 0) {
    throw new ErrorNegocio('Selecciona al menos una máquina disponible para cargar')
  }
  if (asignaciones.some(a => !a.maquina_id || !a.catalogo_media_id)) {
    throw new ErrorNegocio('Asigna el código de media a todas las máquinas seleccionadas')
  }
  if (new Set(asignaciones.map(a => a.maquina_id)).size !== asignaciones.length) {
    throw new ErrorNegocio('Una máquina aparece más de una vez en el lote')
  }
  const tejedor = tabla(db, 'usuarios').find(u => u.id === p.p_tejedor_id)
  if (!tejedor || tejedor.activo === false) throw new ErrorNegocio('El operador seleccionado no existe o está desactivado')

  const maquinas = asignaciones.map(a => tabla(db, 'maquinas').find(m => m.id === a.maquina_id))
  if (maquinas.some(m => !m)) throw new ErrorNegocio('Una de las máquinas seleccionadas no existe')
  const ocupada = maquinas.filter(m => m.estado !== 'activa').sort((a, b) => a.codigo.localeCompare(b.codigo))[0]
  if (ocupada) throw new ErrorNegocio(`La máquina ${ocupada.codigo} no está disponible (estado: ${ocupada.estado})`)

  const requerido: Record<string, number> = {}
  for (const a of asignaciones) {
    const media = tabla(db, 'catalogo_medias').find(c => c.id === a.catalogo_media_id)
    if (!media?.materia_prima_id) continue
    const kg = (DOCENAS_RESERVADAS_POR_MAQUINA * (Number(media.peso_docena_g) || PESO_DOCENA_POR_DEFECTO_G)) / 1000
    requerido[media.materia_prima_id] = (requerido[media.materia_prima_id] ?? 0) + kg
  }
  for (const [mpId, necesario] of Object.entries(requerido)) {
    const mp = tabla(db, 'materia_prima').find(x => x.id === mpId)
    const stock = Number(mp?.stock_kg ?? 0)
    if (stock < necesario) {
      throw new ErrorNegocio(
        `Falta de materia prima: se requieren ${necesario.toFixed(2)} kg de ${mp?.material ?? ''} ${mp?.color ?? ''} pero solo quedan ${stock.toFixed(2)} kg`
      )
    }
  }

  // ── Escrituras (todo validado) ──
  const turnoId = nuevoId()
  const ahora = new Date().toISOString()
  tabla(db, 'turnos_produccion').push({
    id: turnoId,
    tejedor_id: p.p_tejedor_id,
    horario: p.p_horario,
    duracion_horas: Number(p.p_duracion_horas),
    estado: 'activo',
    fecha: ahora.split('T')[0],
    created_at: ahora,
  })
  for (const a of asignaciones) {
    tabla(db, 'turno_maquinas').push({ id: nuevoId(), turno_id: turnoId, ...a, created_at: ahora })
  }
  for (const [mpId, necesario] of Object.entries(requerido)) {
    const mp = tabla(db, 'materia_prima').find(x => x.id === mpId)
    mp.stock_kg = Number(mp.stock_kg) - necesario
    tabla(db, 'movimientos_materia_prima').push({
      id: nuevoId(), materia_prima_id: mpId, tipo: 'consumo_produccion', cantidad_kg: necesario, referencia_id: turnoId, created_at: ahora,
    })
  }
  for (const m of maquinas) m.estado = 'ocupada'
  tejedor.estado = 'ocupada'
  return turnoId
}

function cerrarTurno(db: Db, p: any) {
  const turno = tabla(db, 'turnos_produccion').find(t => t.id === p.p_turno_id)
  if (!turno) throw new ErrorNegocio('Turno no encontrado')
  if (turno.estado !== 'activo') throw new ErrorNegocio('Este turno ya fue cerrado')
  const reportes: { maquina_id: string; docenas: number }[] = p.p_reportes ?? []
  if (reportes.some(r => Number(r.docenas) < 0)) throw new ErrorNegocio('Las docenas producidas no pueden ser negativas')

  const fecha = new Date().toISOString().split('T')[0]
  for (const tm of tabla(db, 'turno_maquinas').filter(x => x.turno_id === turno.id)) {
    const r = reportes.find(x => x.maquina_id === tm.maquina_id)
    tabla(db, 'reportes_produccion').push({
      id: nuevoId(), turno_id: turno.id, maquina_id: tm.maquina_id, catalogo_media_id: tm.catalogo_media_id,
      docenas_producidas: Number(r?.docenas ?? 0), fecha, created_at: new Date().toISOString(),
    })
  }
  turno.estado = 'cerrado'
  liberarMaquinasOcupadasDelTurno(db, turno.id)
  liberarTejedorSiNoTieneTurnos(db, turno.tejedor_id)
  return null
}

function reportarAveria(db: Db, p: any) {
  if (!String(p.p_descripcion ?? '').trim()) throw new ErrorNegocio('Ingresa la descripción detallada de la falla')
  const maq = tabla(db, 'maquinas').find(m => m.id === p.p_maquina_id)
  if (!maq) throw new ErrorNegocio('Máquina no encontrada')
  const activa = tabla(db, 'averias_maquinas').some(
    a => a.maquina_id === maq.id && (a.estado === 'pendiente' || a.estado === 'en_reparacion')
  )
  if (activa) throw new ErrorNegocio(`La máquina ${maq.codigo} ya tiene un reporte de avería activo`)
  exigirTransicion(maq, 'malograda', `No se puede reportar una falla en la máquina ${maq.codigo} porque está en estado ${maq.estado}`)

  const averiaId = nuevoId()
  const ahora = new Date().toISOString()
  tabla(db, 'averias_maquinas').push({
    id: averiaId,
    maquina_id: maq.id,
    reportado_por_id: p.p_reportado_por_id ?? null,
    tipo_averia: p.p_tipo_averia ?? null,
    descripcion_operador: String(p.p_descripcion).trim(),
    estado: 'pendiente',
    asignado_a: String(p.p_asignado_a ?? '').trim() || null,
    nivel: 'CRÍTICO',
    fecha_reporte: ahora,
    created_at: ahora,
  })
  maq.estado = 'malograda'
  maq.detalle_estado = 'FALLA ' + (String(p.p_tipo_averia ?? '').trim() || 'REPORTADA')

  const turnosIds = new Set(tabla(db, 'turno_maquinas').filter(tm => tm.maquina_id === maq.id).map(tm => tm.turno_id))
  let cerrados = 0
  for (const t of tabla(db, 'turnos_produccion')) {
    if (!turnosIds.has(t.id) || t.estado !== 'activo') continue
    t.estado = 'cerrado'
    liberarMaquinasOcupadasDelTurno(db, t.id)
    liberarTejedorSiNoTieneTurnos(db, t.tejedor_id)
    cerrados++
  }
  return { averia_id: averiaId, turnos_cerrados: cerrados }
}

function iniciarReparacion(db: Db, p: any) {
  const averia = tabla(db, 'averias_maquinas').find(a => a.id === p.p_averia_id)
  if (!averia) throw new ErrorNegocio('Avería no encontrada')
  if (averia.estado !== 'pendiente') {
    throw new ErrorNegocio(`Solo se puede iniciar la reparación de una avería pendiente (estado actual: ${averia.estado})`)
  }
  const maq = tabla(db, 'maquinas').find(m => m.id === averia.maquina_id)
  if (!maq || maq.estado !== 'malograda') {
    throw new ErrorNegocio(`La máquina ${maq?.codigo ?? ''} debe estar malograda para iniciar la reparación (estado: ${maq?.estado})`)
  }
  averia.estado = 'en_reparacion'
  maq.estado = 'mantenimiento'
  maq.detalle_estado = 'EN REPARACIÓN'
  return null
}

function registrarReparacion(db: Db, p: any) {
  if (!String(p.p_descripcion_tecnico ?? '').trim()) throw new ErrorNegocio('Completa el diagnóstico técnico')
  const repuestos = Number(p.p_costo_repuestos ?? 0)
  const manoObra = Number(p.p_costo_mano_obra ?? 0)
  if (repuestos < 0 || manoObra < 0) throw new ErrorNegocio('Los costos no pueden ser negativos')
  const averia = tabla(db, 'averias_maquinas').find(a => a.id === p.p_averia_id)
  if (!averia) throw new ErrorNegocio('Avería no encontrada')
  if (averia.estado !== 'en_reparacion') {
    throw new ErrorNegocio(`Primero inicia la reparación (estado actual de la avería: ${averia.estado})`)
  }
  const maq = tabla(db, 'maquinas').find(m => m.id === averia.maquina_id)
  if (!maq || maq.estado !== 'mantenimiento') {
    throw new ErrorNegocio(`La máquina ${maq?.codigo ?? ''} debe estar en mantenimiento para cerrar la reparación (estado: ${maq?.estado})`)
  }
  const reparacionId = nuevoId()
  const ahora = new Date().toISOString()
  tabla(db, 'reparaciones').push({
    id: reparacionId,
    averia_id: averia.id,
    tecnico_id: p.p_tecnico_id ?? null,
    descripcion_tecnico: String(p.p_descripcion_tecnico).trim(),
    costo_repuestos: repuestos,
    costo_mano_obra: manoObra,
    costo_total: repuestos + manoObra,
    fecha_reparacion: ahora,
    created_at: ahora,
  })
  averia.estado = 'resuelto'
  maq.estado = 'activa'
  maq.detalle_estado = 'OPERATIVA'
  return reparacionId
}

/**
 * Ejecuta una RPC de producción/averías sobre `db` (lo modifica en sitio).
 * Devuelve null si `fnName` no es de este módulo.
 * Ante un error de negocio no modifica `db`: todas las validaciones van antes de escribir.
 */
export function ejecutarRpcProduccion(db: Db, fnName: string, params: any): Resultado | null {
  const handlers: Record<string, (db: Db, p: any) => unknown> = {
    cargar_lote_produccion: cargarLote,
    cerrar_turno_produccion: cerrarTurno,
    reportar_averia_maquina: reportarAveria,
    iniciar_reparacion_averia: iniciarReparacion,
    registrar_reparacion_averia: registrarReparacion,
  }
  const handler = handlers[fnName]
  if (!handler) return null
  try {
    return { data: handler(db, params ?? {}), error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}
