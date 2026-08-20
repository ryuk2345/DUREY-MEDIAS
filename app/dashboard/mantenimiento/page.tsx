// @ts-nocheck
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Wrench, AlertTriangle, Plus, Clock, CheckCircle, TrendingUp, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { formatearMoneda, formatearFecha } from '@/lib/utils'
import { validarTransicionEstadoMaquina } from '@/lib/domain/machines'


interface Maquina { id: string; codigo: string; tipo: string; estado: string }
interface Averia {
  id: string; descripcion_operador: string; estado: string; fecha_reporte: string
  maquina: { codigo: string; tipo: string }
  reportado_por: { nombre: string }
  reparaciones: { id: string; costo_total: number }[]
}

export default function MantenimientoPage() {
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [averias, setAverias] = useState<Averia[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'pendientes' | 'timeline' | 'ranking'>('pendientes')
  const [showAveriaModal, setShowAveriaModal] = useState(false)
  const [showRepararModal, setShowRepararModal] = useState(false)
  const [averiaSeleccionada, setAveriaSeleccionada] = useState<Averia | null>(null)
  const [averiaForm, setAveriaForm] = useState({ maquina_id: '', descripcion: '' })
  const [reparacionForm, setReparacionForm] = useState({ descripcion_tecnico: '', costo_repuestos: '', costo_mano_obra: '' })
  const [procesando, setProcesando] = useState(false)
  const supabase = createClient()

  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [maq, av] = await Promise.all([
      supabase.from('maquinas').select('id, codigo, tipo, estado').order('codigo'),
      supabase.from('averias_maquinas').select(`
        id, descripcion_operador, estado, fecha_reporte,
        maquina:maquinas(codigo, tipo),
        reportado_por:usuarios(nombre),
        reparaciones(id, costo_total)
      `).order('fecha_reporte', { ascending: false }),
    ])

    if (maq.error) toast.error(`Error al cargar máquinas: ${maq.error.message}`)
    if (av.error) toast.error(`Error al cargar averías: ${av.error.message}`)

    setMaquinas(maq.data ?? [])
    setAverias((av.data ?? []) as Averia[])
    setLoading(false)
  }, [])


  useEffect(() => { cargarDatos() }, [cargarDatos])

  const reportarAveria = async () => {
    if (!averiaForm.maquina_id || !averiaForm.descripcion) { toast.error('Selecciona la máquina y describe el problema'); return }
    if (procesando) return

    const maq = maquinas.find(m => m.id === averiaForm.maquina_id)
    if (maq) {
      const v = validarTransicionEstadoMaquina(maq.estado as any, 'malograda')
      if (!v.valido) {
        toast.error(`Error en máquina: ${v.error}`)
        return
      }

      // Parche: Evitar doble reporte activo para la misma máquina
      const yaTieneActivo = averias.some(a => 
        a.maquina?.codigo === maq.codigo && 
        (a.estado === 'pendiente' || a.estado === 'en_reparacion')
      )
      if (yaTieneActivo) {
        toast.error(`La máquina ${maq.codigo} ya tiene un reporte de avería activo.`)
        return
      }
    }

    setProcesando(true)
    // 1. Insertar reporte de avería
    const { data: nuevaAveria, error: avErr } = await supabase.from('averias_maquinas').insert({
      maquina_id: averiaForm.maquina_id,
      reportado_por_id: null,
      descripcion_operador: averiaForm.descripcion,
      estado: 'pendiente',
    }).select().single()

    if (avErr) {
      toast.error(`Error al reportar la avería: ${avErr.message}`)
      setProcesando(false)
      return
    }

    // 2. Cambiar estado a malograda
    await supabase.from('maquinas').update({ estado: 'malograda' }).eq('id', averiaForm.maquina_id)

    // 3. Buscar y cerrar turnos activos para esta máquina (para evitar registros de producción inválidos)
    const { data: turnoMaq } = await supabase.from('turno_maquinas')
      .select('id, turno_id, turnos_produccion(id, tejedor_id, estado)')
      .eq('maquina_id', averiaForm.maquina_id)
      .eq('turnos_produccion.estado', 'activo')
      .maybeSingle()

    if (turnoMaq && turnoMaq.turnos_produccion) {
      const turnoId = turnoMaq.turno_id
      const tejedorId = turnoMaq.turnos_produccion.tejedor_id

      // Cerrar el turno de tejido
      await supabase.from('turnos_produccion').update({ estado: 'cerrado' }).eq('id', turnoId)
      
      // Liberar al tejedor
      if (tejedorId) {
        await supabase.from('usuarios').update({ estado: 'disponible' }).eq('id', tejedorId)
      }
      toast.warning('⚠️ Turno activo de la máquina cerrado de forma automática. Operador liberado.')
    }

    toast.error(`Avería reportada — Máquina marcada como MALOGRADA`, { icon: '⚠️' })
    setShowAveriaModal(false)
    setAveriaForm({ maquina_id: '', descripcion: '' })
    setProcesando(false)
    cargarDatos()
  }

  const iniciarReparacion = async (averia: Averia) => {
    if (procesando) return
    const maq = maquinas.find(m => m.codigo === averia.maquina?.codigo)
    if (!maq) { toast.error('Máquina no encontrada'); return }

    const v = validarTransicionEstadoMaquina(maq.estado as any, 'mantenimiento')
    if (!v.valido) {
      toast.error(`Error en máquina: ${v.error}`)
      return
    }

    setProcesando(true)
    await supabase.from('maquinas').update({ estado: 'mantenimiento' }).eq('id', maq.id)
    await supabase.from('averias_maquinas').update({ estado: 'en_reparacion' }).eq('id', averia.id)

    toast.info('🔧 Reparación iniciada. Máquina en estado MANTENIMIENTO.')
    setProcesando(false)
    cargarDatos()
  }

  const registrarReparacion = async () => {
    if (!averiaSeleccionada || !reparacionForm.descripcion_tecnico) { toast.error('Completa el diagnóstico técnico'); return }
    if (procesando) return

    const maq = maquinas.find(m => m.codigo === averiaSeleccionada.maquina?.codigo)
    if (!maq) { toast.error('Máquina no encontrada'); return }

    const v = validarTransicionEstadoMaquina(maq.estado as any, 'activa')
    if (!v.valido) {
      toast.error(`Error en máquina: ${v.error}`)
      return
    }

    setProcesando(true)
    await supabase.from('reparaciones').insert({
      averia_id: averiaSeleccionada.id,
      tecnico_id: null,
      descripcion_tecnico: reparacionForm.descripcion_tecnico,
      costo_repuestos: parseFloat(reparacionForm.costo_repuestos || '0'),
      costo_mano_obra: parseFloat(reparacionForm.costo_mano_obra || '0'),
    })

    await supabase.from('averias_maquinas').update({ estado: 'resuelto' }).eq('id', averiaSeleccionada.id)
    await supabase.from('maquinas').update({ estado: 'activa' }).eq('id', maq.id)

    toast.success('Reparación registrada — Máquina habilitada (Activa)')
    setShowRepararModal(false)
    setProcesando(false)
    cargarDatos()
  }


  // Parche: Filtrar averías pendientes duplicadas para evitar mostrarlas doble en la interfaz
  const averiasPendientes = (() => {
    const vistos = new Set<string>()
    return averias.filter(a => {
      if (a.estado === 'pendiente' || a.estado === 'en_reparacion') {
        const key = a.maquina?.codigo || a.id
        if (vistos.has(key)) return false
        vistos.add(key)
        return true
      }
      return false
    })
  })()
  const averiasResueltas = averias.filter(a => a.estado === 'resuelto')

  // Ranking de máquinas con más gastos
  const rankingMaquinas = Object.entries(
    averias.reduce((acc, a) => {
      const codigo = a.maquina?.codigo ?? 'Desconocida'
      const gasto = a.reparaciones?.reduce((s, r) => s + (r.costo_total ?? 0), 0) ?? 0
      acc[codigo] = (acc[codigo] ?? 0) + gasto
      return acc
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6 animate-fadeInUp">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl bg-amber-500/10"><Wrench className="w-5 h-5 text-amber-400" /></div>
            <h1 className="text-2xl font-bold text-white">Mantenimiento de Máquinas</h1>
          </div>
          <p className="text-slate-400 text-sm ml-12">Averías, reparaciones, timeline y ranking por gasto</p>
        </div>
        <button onClick={() => setShowAveriaModal(true)} className="btn-danger">
          <AlertTriangle className="w-4 h-4" /> Reportar Avería
        </button>
      </div>

      {/* Stats rápidas */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Máquinas Activas', value: maquinas.filter(m => m.estado === 'activa').length, color: 'text-emerald-400' },
          { label: 'Ocupadas', value: maquinas.filter(m => m.estado === 'ocupada').length, color: 'text-blue-400' },
          { label: 'Malogradas', value: maquinas.filter(m => m.estado === 'malograda').length, color: 'text-red-400' },
          { label: 'Averías Pendientes', value: averiasPendientes.length, color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="glass rounded-2xl p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06]">
        {[
          { id: 'pendientes', label: 'Pendientes', icon: <AlertTriangle className="w-4 h-4" /> },
          { id: 'timeline', label: 'Timeline', icon: <Clock className="w-4 h-4" /> },
          { id: 'ranking', label: 'Ranking de Gastos', icon: <TrendingUp className="w-4 h-4" /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'pendientes' | 'timeline' | 'ranking')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id ? 'border-amber-400 text-amber-400' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-amber-400" /></div>
      ) : (
        <>
          {activeTab === 'pendientes' && (
            <div className="space-y-4">
              {averiasPendientes.length === 0 ? (
                <div className="glass rounded-2xl flex flex-col items-center justify-center py-12 text-slate-500">
                  <CheckCircle className="w-10 h-10 mb-2 opacity-30 text-emerald-400" />
                  <p>No hay averías pendientes ✓</p>
                </div>
              ) : averiasPendientes.map(a => {
                const isEnReparacion = a.estado === 'en_reparacion'
                return (
                  <div key={a.id} className={`glass rounded-2xl p-6 border ${isEnReparacion ? 'border-cyan-500/25 bg-cyan-500/[0.01]' : 'border-red-500/20'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          {isEnReparacion ? (
                            <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                              🔧 En Reparación
                            </span>
                          ) : (
                            <span className="badge badge-danger">● MALOGRADA</span>
                          )}
                          <code className="text-amber-300 font-mono text-sm">{a.maquina?.codigo}</code>
                          <span className="text-slate-500 text-xs capitalize">{a.maquina?.tipo}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-slate-500 mb-1 font-semibold uppercase">Reporte del Operario:</p>
                            <p className="text-slate-300 text-sm">{a.descripcion_operador}</p>
                            <p className="text-slate-600 text-xs mt-1">Reportado por: {a.reportado_por?.nombre} · {formatearFecha(a.fecha_reporte)}</p>
                          </div>
                        </div>
                      </div>
                      
                      {isEnReparacion ? (
                        <button
                          onClick={() => { setAveriaSeleccionada(a); setShowRepararModal(true) }}
                          disabled={procesando}
                          className="btn-primary text-sm py-2 ml-4 bg-cyan-600 hover:bg-cyan-500 border-none shadow-lg shadow-cyan-600/20 text-white"
                        >
                          {procesando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Registrar Reparación
                        </button>
                      ) : (
                        <button
                          onClick={() => iniciarReparacion(a)}
                          disabled={procesando}
                          className="btn-primary text-sm py-2 ml-4 bg-amber-600 hover:bg-amber-500 border-none shadow-lg shadow-amber-600/20 text-white"
                        >
                          {procesando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />} Iniciar Reparación
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="space-y-3">
              {averias.map((a, idx) => (
                <div key={a.id} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${a.estado === 'resuelto' ? 'bg-emerald-400' : 'bg-red-400 animate-pulse-ring'}`} />
                    {idx < averias.length - 1 && <div className="w-0.5 bg-white/[0.06] flex-1 mt-1" />}
                  </div>
                  <div className="glass rounded-xl p-4 flex-1 mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-sm text-amber-300 font-mono">{a.maquina?.codigo}</code>
                      <span className={`badge text-[10px] ${a.estado === 'resuelto' ? 'badge-success' : 'badge-danger'}`}>
                        {a.estado === 'resuelto' ? 'Resuelto' : 'Pendiente'}
                      </span>
                    </div>
                    <p className="text-slate-300 text-sm">{a.descripcion_operador}</p>
                    <p className="text-slate-600 text-xs mt-1">{formatearFecha(a.fecha_reporte)} · {a.reportado_por?.nombre}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'ranking' && (
            <div className="glass rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-slate-300 mb-4">Máquinas Ordenadas por Gasto Total en Reparaciones</h2>
              <div className="space-y-3">
                {rankingMaquinas.map(([codigo, gasto], idx) => (
                  <div key={codigo} className="flex items-center gap-4">
                    <span className={`text-lg font-bold w-6 ${idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-slate-300' : idx === 2 ? 'text-amber-700' : 'text-slate-600'}`}>
                      {idx + 1}
                    </span>
                    <code className="text-white font-mono text-sm w-20">{codigo}</code>
                    <div className="flex-1 progress-bar">
                      <div
                        className="progress-fill bg-gradient-to-r from-amber-500 to-red-500"
                        style={{ width: rankingMaquinas[0]?.[1] ? `${(gasto / rankingMaquinas[0][1]) * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="text-white font-bold text-sm w-24 text-right">{formatearMoneda(gasto)}</span>
                  </div>
                ))}
                {rankingMaquinas.length === 0 && (
                  <p className="text-center text-slate-600">Sin datos de gastos aún</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: Reportar Avería */}
      {showAveriaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl w-full max-w-md p-8 shadow-2xl animate-fadeInUp">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">⚠ Reportar Avería</h2>
              <button onClick={() => setShowAveriaModal(false)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-5">
              <p className="text-xs text-red-300">Al reportar la avería, el estado de la máquina cambiará automáticamente a <strong>MALOGRADA</strong> y no podrá ser asignada a nuevos turnos.</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Máquina Afectada</label>
                <select value={averiaForm.maquina_id} onChange={e => setAveriaForm({...averiaForm, maquina_id: e.target.value})} className="input-dark">
                  <option value="">Seleccionar máquina...</option>
                  {maquinas.filter(m => m.estado !== 'malograda').map(m => <option key={m.id} value={m.id}>{m.codigo} ({m.tipo})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Descripción del Problema</label>
                <textarea value={averiaForm.descripcion} onChange={e => setAveriaForm({...averiaForm, descripcion: e.target.value})} placeholder="Describe detalladamente qué le pasa a la máquina..." rows={4} className="input-dark resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowAveriaModal(false)} disabled={procesando} className="btn-secondary flex-1 justify-center">Cancelar</button>
              <button onClick={reportarAveria} disabled={procesando} className="btn-danger flex-1 justify-center">
                {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />} Reportar Avería
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Registrar Reparación */}
      {showRepararModal && averiaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl w-full max-w-lg p-8 shadow-2xl animate-fadeInUp">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Registrar Reparación</h2>
              <button onClick={() => setShowRepararModal(false)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400"><X className="w-5 h-5" /></button>
            </div>

            {/* Vista comparativa */}
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 font-semibold mb-2">🔧 Versión del Operario</p>
                <p className="text-slate-300 text-sm">{averiaSeleccionada.descripcion_operador}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Diagnóstico Técnico</label>
                <textarea value={reparacionForm.descripcion_tecnico} onChange={e => setReparacionForm({...reparacionForm, descripcion_tecnico: e.target.value})} placeholder="Diagnóstico del técnico..." rows={4} className="input-dark resize-none h-full" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Costo Repuestos (S/)</label>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={reparacionForm.costo_repuestos} onChange={e => setReparacionForm({...reparacionForm, costo_repuestos: e.target.value})} className="input-dark" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Costo Mano de Obra (S/)</label>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={reparacionForm.costo_mano_obra} onChange={e => setReparacionForm({...reparacionForm, costo_mano_obra: e.target.value})} className="input-dark" />
              </div>
            </div>

            {reparacionForm.costo_repuestos && reparacionForm.costo_mano_obra && (
              <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex justify-between">
                <span className="text-slate-400">Costo Total:</span>
                <span className="text-white font-bold">{formatearMoneda(parseFloat(reparacionForm.costo_repuestos) + parseFloat(reparacionForm.costo_mano_obra))}</span>
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowRepararModal(false)} disabled={procesando} className="btn-secondary flex-1 justify-center">Cancelar</button>
              <button onClick={registrarReparacion} disabled={procesando} className="btn-primary flex-1 justify-center">
                {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Marcar como Resuelto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
