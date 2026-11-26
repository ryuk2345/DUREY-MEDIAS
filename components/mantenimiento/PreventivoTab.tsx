'use client'

// Mantenimiento preventivo (Fase 4): planes por máquina cada N días, avisos de
// vencido/próximo, iniciar con mecánico (la máquina pasa a mantenimiento),
// repuestos usados y terminar con mano de obra. Todo con funciones de la base (031).
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Plus, Wrench, CheckCircle, X, Loader2, Edit2, Power, History } from 'lucide-react'
import CustomSelect from '@/components/ui/CustomSelect'
import { Modal } from '@/components/ui/Modal'
import { formatearFecha, formatearMoneda } from '@/lib/utils'
import { proximaFecha, estadoPlan, hoyLocal, ETIQUETA_ESTADO_PLAN, type EstadoPlan } from '@/lib/domain/mantenimiento'
import { costoRepuestosUsados, nombreMecanico } from '@/lib/domain/repuestos'

interface Plan {
  id: string; maquina_id: string; tarea: string; frecuencia_dias: number; fecha_inicio: string; ultima_fecha: string | null; activo: boolean
  maquina: { codigo: string; estado: string } | null
}
interface EnCurso {
  id: string; plan_id: string; maquina_id: string
  mecanico: { nombre: string; apellido: string } | null
  mantenimiento_repuestos: { id: string; cantidad: number; costo_unitario: number; repuesto: { nombre: string } | null }[]
}
interface Opcion { id: string; codigo?: string; nombre?: string; apellido?: string; stock_actual?: number }

const COLOR_ESTADO: Record<EstadoPlan, string> = {
  vencido: 'bg-red-500/20 text-red-300', proximo: 'bg-amber-500/20 text-amber-300',
  al_dia: 'bg-emerald-500/20 text-emerald-300', inactivo: 'bg-slate-700 text-slate-400',
}

export default function PreventivoTab({ onCambio }: { onCambio?: () => void }) {
  const supabase = createClient()
  const [planes, setPlanes] = useState<Plan[]>([])
  const [enCurso, setEnCurso] = useState<EnCurso[]>([])
  const [maquinas, setMaquinas] = useState<Opcion[]>([])
  const [mecanicos, setMecanicos] = useState<Opcion[]>([])
  const [repuestos, setRepuestos] = useState<Opcion[]>([])
  const [version, setVersion] = useState(0)
  const [cargado, setCargado] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [planForm, setPlanForm] = useState<{ id: string; maquina_id: string; tarea: string; frecuencia_dias: string; fecha_inicio: string } | null>(null)
  const [mecanicoPorPlan, setMecanicoPorPlan] = useState<Record<string, string>>({})
  const [usoPorMant, setUsoPorMant] = useState<Record<string, { repuesto_id: string; cantidad: string }>>({})
  const [terminar, setTerminar] = useState<{ id: string; nota: string; mano_obra: string } | null>(null)
  const recargar = () => { setVersion(v => v + 1); onCambio?.() }

  useEffect(() => {
    let vigente = true
    ;(async () => {
      const [pl, mc, maq, mec, rep] = await Promise.all([
        supabase.from('planes_mantenimiento').select('id, maquina_id, tarea, frecuencia_dias, fecha_inicio, ultima_fecha, activo, maquina:maquinas(codigo, estado)').order('fecha_inicio'),
        supabase.from('mantenimientos_preventivos').select('id, plan_id, maquina_id, mecanico:mecanicos(nombre, apellido), mantenimiento_repuestos(id, cantidad, costo_unitario, repuesto:repuestos(nombre))').eq('estado', 'en_curso'),
        supabase.from('maquinas').select('id, codigo').order('codigo'),
        supabase.from('mecanicos').select('id, nombre, apellido').eq('activo', true).order('nombre'),
        supabase.from('repuestos').select('id, nombre, stock_actual').order('nombre'),
      ])
      if (!vigente) return
      for (const r of [pl, mc, maq, mec, rep]) if (r.error) toast.error(`Error al cargar el preventivo: ${r.error.message}`)
      setPlanes((pl.data ?? []) as unknown as Plan[])
      setEnCurso((mc.data ?? []) as unknown as EnCurso[])
      setMaquinas((maq.data ?? []) as Opcion[])
      setMecanicos((mec.data ?? []) as Opcion[])
      setRepuestos((rep.data ?? []) as Opcion[])
      setCargado(true)
    })()
    return () => { vigente = false }
  }, [version, supabase])

  const hoy = hoyLocal()
  const ordenados = useMemo(() => {
    const peso: Record<EstadoPlan, number> = { vencido: 0, proximo: 1, al_dia: 2, inactivo: 3 }
    return [...planes].sort((a, b) => peso[estadoPlan(a, hoy)] - peso[estadoPlan(b, hoy)] || proximaFecha(a).localeCompare(proximaFecha(b)))
  }, [planes, hoy])

  const ejecutar = async (fn: string, params: Record<string, unknown>, ok: string) => {
    if (procesando) return false
    setProcesando(true)
    const { error } = await supabase.rpc(fn, params)
    setProcesando(false)
    if (error) { toast.error(error.message); return false }
    toast.success(ok)
    recargar()
    return true
  }

  const guardarPlan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!planForm) return
    const frecuencia = Number(planForm.frecuencia_dias)
    if (!planForm.maquina_id || !planForm.tarea.trim()) { toast.error('Elige la máquina y escribe la tarea'); return }
    if (!Number.isInteger(frecuencia) || frecuencia <= 0) { toast.error('La frecuencia debe ser un número entero de días mayor a 0'); return }
    const datos = { maquina_id: planForm.maquina_id, tarea: planForm.tarea.trim(), frecuencia_dias: frecuencia, fecha_inicio: planForm.fecha_inicio || hoy }
    setProcesando(true)
    const { error } = planForm.id
      ? await supabase.from('planes_mantenimiento').update(datos).eq('id', planForm.id)
      : await supabase.from('planes_mantenimiento').insert({ ...datos, activo: true, ultima_fecha: null })
    setProcesando(false)
    if (error) { toast.error(`No se pudo guardar el plan: ${error.message}`); return }
    toast.success(planForm.id ? 'Plan actualizado' : 'Plan de mantenimiento creado')
    setPlanForm(null)
    recargar()
  }

  const cambiarActivo = async (p: Plan) => {
    const { error } = await supabase.from('planes_mantenimiento').update({ activo: !p.activo }).eq('id', p.id)
    if (error) { toast.error(error.message); return }
    toast.success(p.activo ? 'Plan desactivado' : 'Plan reactivado')
    recargar()
  }

  if (!cargado) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">Planes de mantenimiento preventivo</h2>
        <button type="button" onClick={() => setPlanForm({ id: '', maquina_id: '', tarea: '', frecuencia_dias: '', fecha_inicio: hoy })}
          className="btn-primary text-xs flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nuevo plan</button>
      </div>

      {planForm && (
        <form onSubmit={guardarPlan} className="glass rounded-2xl p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end border border-amber-500/20">
          <div className="md:col-span-1">
            <label className="block text-xs text-slate-400 mb-1">Máquina</label>
            <CustomSelect value={planForm.maquina_id} onChange={v => setPlanForm({ ...planForm, maquina_id: v })}
              options={[{ value: '', label: 'Elegir máquina...' }, ...maquinas.map(m => ({ value: m.id, label: m.codigo ?? '' }))]} triggerClassName="text-xs" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="plan-tarea" className="block text-xs text-slate-400 mb-1">Tarea</label>
            <input id="plan-tarea" value={planForm.tarea} onChange={e => setPlanForm({ ...planForm, tarea: e.target.value })} placeholder="Ej: Lubricar cilindro" className="input-dark text-xs w-full" />
          </div>
          <div>
            <label htmlFor="plan-frecuencia" className="block text-xs text-slate-400 mb-1">Cada cuántos días</label>
            <input id="plan-frecuencia" type="number" min="1" step="1" value={planForm.frecuencia_dias} onChange={e => setPlanForm({ ...planForm, frecuencia_dias: e.target.value })} className="input-dark text-xs w-full" />
          </div>
          <div>
            <label htmlFor="plan-inicio" className="block text-xs text-slate-400 mb-1">Cuenta desde</label>
            <input id="plan-inicio" type="date" value={planForm.fecha_inicio} onChange={e => setPlanForm({ ...planForm, fecha_inicio: e.target.value })} className="input-dark text-xs w-full" />
          </div>
          <div className="md:col-span-5 flex gap-2 justify-end">
            <button type="button" onClick={() => setPlanForm(null)} className="btn-secondary text-xs">Cancelar</button>
            <button type="submit" disabled={procesando} className="btn-primary text-xs">Guardar plan</button>
          </div>
        </form>
      )}

      {ordenados.length === 0 ? (
        <p className="text-center text-slate-500 py-8">Todavía no hay planes. Crea el primero con «Nuevo plan».</p>
      ) : (
        <div className="space-y-3">
          {ordenados.map(p => {
            const estado = estadoPlan(p, hoy)
            const curso = enCurso.find(m => m.plan_id === p.id)
            const maquinaOcupadaPorOtro = !curso && enCurso.some(m => m.maquina_id === p.maquina_id)
            return (
              <div key={p.id} className="glass rounded-2xl p-4 border border-white/[0.06]" data-testid={`plan-${p.tarea}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="text-amber-300 font-mono">{p.maquina?.codigo}</code>
                      <span className="text-white font-semibold">{p.tarea}</span>
                      <span className={`badge text-[10px] ${COLOR_ESTADO[estado]}`}>{ETIQUETA_ESTADO_PLAN[estado]}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Cada {p.frecuencia_dias} días · Última vez: {p.ultima_fecha ? formatearFecha(p.ultima_fecha) : 'nunca'} · Próxima: {formatearFecha(proximaFecha(p))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/dashboard/maquinas/${p.maquina_id}/historia`} className="text-xs text-indigo-300 flex items-center gap-1"><History className="w-3.5 h-3.5" /> Historia</Link>
                    <button type="button" onClick={() => setPlanForm({ id: p.id, maquina_id: p.maquina_id, tarea: p.tarea, frecuencia_dias: String(p.frecuencia_dias), fecha_inicio: p.fecha_inicio })}
                      className="text-xs text-cyan-300 flex items-center gap-1" aria-label={`Editar plan ${p.tarea}`}><Edit2 className="w-3.5 h-3.5" /> Editar</button>
                    <button type="button" onClick={() => cambiarActivo(p)} className="text-xs text-slate-400 flex items-center gap-1">
                      <Power className="w-3.5 h-3.5" /> {p.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </div>
                </div>

                {p.activo && !curso && (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <div className="min-w-[14rem]">
                      <CustomSelect value={mecanicoPorPlan[p.id] ?? ''} onChange={v => setMecanicoPorPlan(prev => ({ ...prev, [p.id]: v }))}
                        options={[{ value: '', label: mecanicos.length ? 'Mecánico...' : 'Registra mecánicos en Máquinas' }, ...mecanicos.map(m => ({ value: m.id, label: nombreMecanico({ nombre: m.nombre, apellido: m.apellido }) }))]}
                        triggerClassName="text-xs" />
                    </div>
                    <button type="button" disabled={procesando || maquinaOcupadaPorOtro}
                      onClick={() => mecanicoPorPlan[p.id]
                        ? ejecutar('iniciar_mantenimiento_preventivo', { p_plan_id: p.id, p_mecanico_id: mecanicoPorPlan[p.id] }, 'Mantenimiento iniciado: la máquina está en mantenimiento')
                        : toast.error('Elige el mecánico que hace el mantenimiento')}
                      className="btn-primary text-xs bg-amber-600 hover:bg-amber-500 border-none flex items-center gap-1">
                      <Wrench className="w-3.5 h-3.5" /> Iniciar mantenimiento
                    </button>
                    {maquinaOcupadaPorOtro && <span className="text-xs text-slate-500">La máquina ya tiene otro mantenimiento en curso</span>}
                  </div>
                )}

                {curso && (
                  <div className="mt-3 p-3 rounded-xl bg-cyan-500/[0.05] border border-cyan-500/20 space-y-2">
                    <p className="text-xs text-cyan-300">En curso · Mecánico: {nombreMecanico(curso.mecanico)}</p>
                    <ul className="space-y-1">
                      {curso.mantenimiento_repuestos.map(u => (
                        <li key={u.id} className="flex items-center justify-between text-xs text-slate-300">
                          <span>{u.cantidad} × {u.repuesto?.nombre ?? 'Repuesto'} · {formatearMoneda(u.cantidad * u.costo_unitario)}</span>
                          <button type="button" aria-label={`Quitar ${u.repuesto?.nombre ?? 'repuesto'}`} disabled={procesando}
                            onClick={() => ejecutar('quitar_repuesto_de_mantenimiento', { p_uso_id: u.id }, 'Repuesto devuelto al stock')} className="text-red-300"><X className="w-3.5 h-3.5" /></button>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <div className="min-w-[14rem]">
                        <CustomSelect value={usoPorMant[curso.id]?.repuesto_id ?? ''}
                          onChange={v => setUsoPorMant(prev => ({ ...prev, [curso.id]: { repuesto_id: v, cantidad: prev[curso.id]?.cantidad ?? '1' } }))}
                          options={[{ value: '', label: 'Elegir repuesto...' }, ...repuestos.filter(r => (r.stock_actual ?? 0) > 0).map(r => ({ value: r.id, label: `${r.nombre} (${r.stock_actual} en stock)` }))]}
                          triggerClassName="text-xs" />
                      </div>
                      <input type="number" min="1" step="1" aria-label="Cantidad de repuesto del mantenimiento" className="input-dark text-xs w-16"
                        value={usoPorMant[curso.id]?.cantidad ?? '1'}
                        onChange={e => setUsoPorMant(prev => ({ ...prev, [curso.id]: { repuesto_id: prev[curso.id]?.repuesto_id ?? '', cantidad: e.target.value } }))} />
                      <button type="button" className="btn-secondary text-xs" disabled={procesando}
                        onClick={async () => {
                          const u = usoPorMant[curso.id]
                          const cantidad = Number(u?.cantidad)
                          if (!u?.repuesto_id || !Number.isInteger(cantidad) || cantidad <= 0) { toast.error('Elige el repuesto y una cantidad entera mayor a 0'); return }
                          if (await ejecutar('usar_repuesto_en_mantenimiento', { p_mantenimiento_id: curso.id, p_repuesto_id: u.repuesto_id, p_cantidad: cantidad }, 'Repuesto descontado del stock')) {
                            setUsoPorMant(prev => ({ ...prev, [curso.id]: { repuesto_id: '', cantidad: '1' } }))
                          }
                        }}><Plus className="w-3.5 h-3.5" /> Usar</button>
                      <button type="button" className="btn-primary text-xs bg-cyan-600 hover:bg-cyan-500 border-none flex items-center gap-1"
                        onClick={() => setTerminar({ id: curso.id, nota: '', mano_obra: '' })}><CheckCircle className="w-3.5 h-3.5" /> Terminar mantenimiento</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={Boolean(terminar)} onClose={() => setTerminar(null)} title="Terminar mantenimiento preventivo" maxWidth="md"
        footer={<>
          <button onClick={() => setTerminar(null)} className="btn-secondary flex-1 justify-center">Cancelar</button>
          <button disabled={procesando} className="btn-primary flex-1 justify-center" onClick={async () => {
            if (!terminar) return
            const mano = parseFloat(terminar.mano_obra || '0')
            if (!Number.isFinite(mano) || mano < 0) { toast.error('La mano de obra no puede ser negativa'); return }
            if (await ejecutar('terminar_mantenimiento_preventivo', { p_mantenimiento_id: terminar.id, p_nota: terminar.nota, p_costo_mano_obra: mano }, 'Mantenimiento terminado: la máquina vuelve a operativa')) setTerminar(null)
          }}>Terminar</button>
        </>}>
        {terminar && (() => {
          const curso = enCurso.find(m => m.id === terminar.id)
          return (
            <div className="space-y-3 text-sm">
              <div>
                <label htmlFor="terminar-nota" className="block text-xs text-slate-400 mb-1">Nota (qué se hizo)</label>
                <textarea id="terminar-nota" rows={3} value={terminar.nota} onChange={e => setTerminar({ ...terminar, nota: e.target.value })} className="input-dark w-full resize-none" />
              </div>
              <div>
                <label htmlFor="terminar-mano" className="block text-xs text-slate-400 mb-1">Mano de obra (S/)</label>
                <input id="terminar-mano" type="number" min="0" step="0.01" value={terminar.mano_obra} onChange={e => setTerminar({ ...terminar, mano_obra: e.target.value })} className="input-dark w-full" />
              </div>
              <p className="text-xs text-slate-400">Repuestos usados: <span aria-label="Costo de repuestos del mantenimiento">{formatearMoneda(costoRepuestosUsados(curso?.mantenimiento_repuestos ?? []))}</span> (ya contados como gasto al comprarlos)</p>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
