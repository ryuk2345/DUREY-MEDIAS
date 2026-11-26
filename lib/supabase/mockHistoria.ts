/* eslint-disable @typescript-eslint/no-explicit-any -- las filas de la base mock no tienen tipos, igual que en mockDb.ts */
/**
 * Emulación local (modo mock) de vista_historia_maquina (migración 031):
 * una fila por evento de cada máquina (producción, fallas, reparaciones,
 * repuestos usados y mantenimientos preventivos).
 */
import type { EventoHistoria } from '@/lib/domain/mantenimiento'
import { nombreMecanico } from '@/lib/domain/repuestos'
import { hoyLocal } from '@/lib/domain/mantenimiento'

type Db = Record<string, any[]>
const t = (db: Db, n: string) => db[n] || []
const dia = (ts: string | null | undefined) => (ts ? hoyLocal(new Date(ts)) : '')
const nombre = (db: Db, id: string | null | undefined) => t(db, 'usuarios').find(u => u.id === id)?.nombre ?? null
const mec = (db: Db, id: string | null | undefined, texto: string | null = null) => {
  const m = t(db, 'mecanicos').find(x => x.id === id)
  return m ? nombreMecanico(m) : texto
}

export function construirHistoriaMock(db: Db): EventoHistoria[] {
  const filas: EventoHistoria[] = []
  const base = { turno: null, detalle: null, cantidad: null, costo: null, persona: null, mecanico: null }
  for (const r of t(db, 'reportes_produccion')) {
    const turno = t(db, 'turnos_produccion').find(x => x.id === r.turno_id)
    filas.push({ ...base, evento_id: `tejido:${r.id}`, maquina_id: r.maquina_id, fecha: r.fecha, momento: r.created_at ?? r.fecha, tipo: 'produccion',
      turno: turno?.horario ?? null, detalle: t(db, 'catalogo_medias').find(c => c.id === r.catalogo_media_id)?.codigo ?? null,
      cantidad: Number(r.docenas_producidas ?? 0), persona: nombre(db, turno?.tejedor_id) })
  }
  for (const r of t(db, 'reportes_remallado')) {
    const lote = t(db, 'lotes_remallado').find(x => x.id === r.lote_id)
    filas.push({ ...base, evento_id: `remallado:${r.id}`, maquina_id: r.maquina_id, fecha: r.fecha, momento: r.created_at ?? r.fecha, tipo: 'produccion',
      detalle: t(db, 'catalogo_medias').find(c => c.id === lote?.catalogo_media_id)?.codigo ?? null,
      cantidad: Number(r.docenas_remalladas ?? 0), persona: nombre(db, r.remalladora_id) })
  }
  for (const a of t(db, 'averias_maquinas')) {
    filas.push({ ...base, evento_id: `falla:${a.id}`, maquina_id: a.maquina_id, fecha: dia(a.fecha_reporte), momento: a.fecha_reporte, tipo: 'falla',
      detalle: a.descripcion_operador ?? null, persona: nombre(db, a.reportado_por_id), mecanico: mec(db, a.mecanico_id, a.asignado_a ?? null) })
  }
  for (const r of t(db, 'reparaciones')) {
    const a = t(db, 'averias_maquinas').find(x => x.id === r.averia_id)
    if (!a) continue
    filas.push({ ...base, evento_id: `reparacion:${r.id}`, maquina_id: a.maquina_id, fecha: dia(r.fecha_reparacion ?? r.created_at), momento: r.fecha_reparacion ?? r.created_at, tipo: 'reparacion',
      detalle: r.descripcion_tecnico ?? null, costo: Number(r.costo_repuestos ?? 0) + Number(r.costo_mano_obra ?? 0),
      mecanico: mec(db, r.mecanico_id, a.asignado_a ?? null) })
  }
  for (const u of t(db, 'averia_repuestos')) {
    const a = t(db, 'averias_maquinas').find(x => x.id === u.averia_id)
    const rep = t(db, 'repuestos').find(x => x.id === u.repuesto_id)
    if (!a || !rep) continue
    filas.push({ ...base, evento_id: `repuesto_falla:${u.id}`, maquina_id: a.maquina_id, fecha: dia(u.created_at), momento: u.created_at, tipo: 'repuesto', detalle: rep.nombre,
      cantidad: u.cantidad, costo: u.cantidad * Number(u.costo_unitario ?? 0), mecanico: mec(db, u.mecanico_id, a.asignado_a ?? null) })
  }
  for (const u of t(db, 'mantenimiento_repuestos')) {
    const m = t(db, 'mantenimientos_preventivos').find(x => x.id === u.mantenimiento_id)
    const rep = t(db, 'repuestos').find(x => x.id === u.repuesto_id)
    if (!m || !rep) continue
    filas.push({ ...base, evento_id: `repuesto_preventivo:${u.id}`, maquina_id: m.maquina_id, fecha: dia(u.created_at), momento: u.created_at, tipo: 'repuesto', detalle: rep.nombre,
      cantidad: u.cantidad, costo: u.cantidad * Number(u.costo_unitario ?? 0), mecanico: mec(db, m.mecanico_id) })
  }
  for (const m of t(db, 'mantenimientos_preventivos')) {
    const plan = t(db, 'planes_mantenimiento').find(x => x.id === m.plan_id)
    const cuando = m.fecha_fin ?? m.fecha_inicio
    filas.push({ ...base, evento_id: `preventivo:${m.id}`, maquina_id: m.maquina_id, fecha: dia(cuando), momento: cuando, tipo: 'preventivo',
      detalle: `${plan?.tarea ?? 'Mantenimiento'}${m.estado === 'en_curso' ? ' (en curso)' : m.nota ? ` — ${m.nota}` : ''}`,
      costo: Number(m.costo_mano_obra ?? 0), mecanico: mec(db, m.mecanico_id) })
  }
  return filas
}
