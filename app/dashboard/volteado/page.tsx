// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  RotateCcw, Sparkles, Loader2, Play, CheckCircle2, User, 
  Plus, X, Calendar, FileText, Barchart, Eye, Info, AlertTriangle, ShieldCheck
} from 'lucide-react'
import { toast } from 'sonner'
import { formatearFecha } from '@/lib/utils'

interface Volteador { id: string; nombre: string }
interface StockVoltear { id: string; docenas: number; catalogo_media: { id: string; sku?: string; codigo: string; talla: string; publico: string } }
interface LoteVolteado {
  id: string
  volteador_id: string
  catalogo_media_id: string
  docenas_asignadas: number
  docenas_pendientes: number
  estado: 'pendiente' | 'en_proceso' | 'completado'
  created_at: string
  volteador?: { nombre: string }
  catalogo_media?: { id: string; sku?: string; codigo: string; talla: string; publico: string }
}
interface ReporteVolteado {
  id: string
  docenas_volteadas: number
  pares_defectuosos: number
  fecha: string
  volteador?: { nombre: string }
  catalogo_media?: { codigo: string; sku?: string }
}

export default function VolteadoPage() {
  const supabase = createClient()

  // Estados de datos
  const [loading, setLoading] = useState(true)
  const [userRol, setUserRol] = useState<string>('operador')
  const [userId, setUserId] = useState<string>('')
  const [volteadores, setVolteadores] = useState<Volteador[]>([])
  const [stockListo, setStockListo] = useState<StockVoltear[]>([])
  const [lotes, setLotes] = useState<LoteVolteado[]>([])
  const [reportes, setReportes] = useState<ReporteVolteado[]>([])

  // Modales y formularios
  const [showAsignarModal, setShowAsignarModal] = useState(false)
  const [showReportarModal, setShowReportarModal] = useState(false)
  const [selectedLote, setSelectedLote] = useState<LoteVolteado | null>(null)
  const [saving, setSaving] = useState(false)

  const [asignarForm, setAsignarForm] = useState({
    catalogo_media_id: '',
    volteador_id: '',
    docenas: ''
  })

  const [reporteForm, setReporteForm] = useState({
    docenas_volteadas: '',
    pares_defectuosos: '0',
    comentarios: ''
  })

  // Cargar rol de usuario
  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserId(user.id)
        const { data: profile } = await supabase.from('usuarios').select('rol, id').eq('email', user.email).single()
        if (profile) {
          setUserRol(profile.rol)
          if (profile.rol === 'volteador') {
            setAsignarForm(f => ({ ...f, volteador_id: profile.id }))
          }
        }
      }
    }
    loadUser()
  }, [supabase])

  // Cargar datos
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    try {
      const [uRes, sRes, lRes, rRes] = await Promise.all([
        supabase.from('usuarios').select('id, nombre').in('rol', ['volteador', 'supervisor', 'admin']).eq('activo', true),
        supabase.from('stock_listo_voltear').select('id, docenas, catalogo_media:catalogo_medias(id, sku, codigo, talla, publico)').gt('docenas', 0),
        supabase.from('lotes_volteado').select(`
          id, volteador_id, catalogo_media_id, docenas_asignadas, docenas_pendientes, estado, created_at,
          volteador:usuarios(nombre),
          catalogo_media:catalogo_medias(id, sku, codigo, talla, publico)
        `).order('created_at', { ascending: false }),
        supabase.from('reportes_volteado').select(`
          id, docenas_volteadas, pares_defectuosos, fecha,
          volteador:usuarios(nombre),
          catalogo_media:catalogo_medias(codigo, sku)
        `).order('created_at', { ascending: false }).limit(20)
      ])

      if (uRes.data) setVolteadores(uRes.data)
      if (sRes.data) setStockListo(sRes.data as unknown as StockVoltear[])
      if (lRes.data) setLotes(lRes.data as unknown as LoteVolteado[])
      if (rRes.data) setReportes(rRes.data as unknown as ReporteVolteado[])
    } catch (error) {
      console.error('Error al cargar datos de volteado:', error)
      toast.error('Error al actualizar las listas de volteado')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  const esSupervisor = userRol === 'admin' || userRol === 'supervisor'

  // Filtrar lotes por operario si no es supervisor
  const lotesFiltrados = useMemo(() => {
    if (esSupervisor) return lotes
    // Buscar id del operario logueado en la tabla de usuarios
    const profileId = volteadores.find(v => v.id === asignarForm.volteador_id)?.id || userId
    return lotes.filter(l => l.volteador_id === profileId || l.volteador_id === userId)
  }, [lotes, esSupervisor, volteadores, asignarForm.volteador_id, userId])

  // Métricas generales
  const metricas = useMemo(() => {
    const pendientes = lotes.reduce((sum, l) => l.estado !== 'completado' ? sum + Number(l.docenas_pendientes) : sum, 0)
    const volteadasHoy = reportes
      .filter(r => r.fecha === new Date().toISOString().split('T')[0])
      .reduce((sum, r) => sum + Number(r.docenas_volteadas), 0)
    const totalDefectos = reportes.reduce((sum, r) => sum + Number(r.pares_defectuosos), 0)

    return { pendientes, volteadasHoy, totalDefectos }
  }, [lotes, reportes])

  // ── ACCIÓN: ASIGNAR LOTE (SUPERVISOR) ──────────────────────────────────────
  const handleAsignarLote = async (e: React.FormEvent) => {
    e.preventDefault()
    const { catalogo_media_id, volteador_id, docenas } = asignarForm

    if (!catalogo_media_id || !volteador_id || !docenas || Number(docenas) <= 0) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    const docenasNum = parseFloat(docenas)
    const stockDisponible = stockListo.find(s => s.catalogo_media?.id === catalogo_media_id)

    if (!stockDisponible || Number(stockDisponible.docenas) < docenasNum) {
      toast.error('La cantidad asignada supera el stock disponible para voltear')
      return
    }

    setSaving(true)

    // 1. Crear el lote de volteado
    const { data: nuevoLote, error: insertErr } = await supabase.from('lotes_volteado').insert({
      volteador_id,
      catalogo_media_id,
      docenas_asignadas: docenasNum,
      docenas_pendientes: docenasNum,
      estado: 'pendiente'
    }).select().single()

    if (insertErr) {
      toast.error(`Error al asignar lote: ${insertErr.message}`)
      setSaving(false)
      return
    }

    // 2. Decrementar el stock listo para voltear
    const nuevoStock = Number(stockDisponible.docenas) - docenasNum
    const { error: stockErr } = await supabase.from('stock_listo_voltear')
      .update({ docenas: nuevoStock })
      .eq('id', stockDisponible.id)

    if (stockErr) {
      toast.error(`Error al actualizar stock: ${stockErr.message}`)
      setSaving(false)
      return
    }

    toast.success('🎉 Lote de Volteado asignado exitosamente al operario.')
    setShowAsignarModal(false)
    setAsignarForm(f => ({ ...f, catalogo_media_id: '', docenas: '' }))
    setSaving(false)
    cargarDatos()
  }

  // ── ACCIÓN: INICIAR LOTE (OPERARIO) ────────────────────────────────────────
  const handleIniciarLote = async (loteId: string) => {
    const { error } = await supabase.from('lotes_volteado')
      .update({ estado: 'en_proceso' })
      .eq('id', loteId)

    if (error) {
      toast.error(`Error al iniciar lote: ${error.message}`)
      return
    }

    toast.success('🚀 Lote en proceso de volteado')
    cargarDatos()
  }

  // ── ACCIÓN: REPORTAR AVANCE Y TERMINAR LOTE ────────────────────────────────
  const handleReportarLote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLote) return

    const { docenas_volteadas, pares_defectuosos, comentarios } = reporteForm
    if (!docenas_volteadas || Number(docenas_volteadas) <= 0) {
      toast.error('Ingresa las docenas volteadas')
      return
    }

    const docenasReportadas = parseFloat(docenas_volteadas)
    const defectos = parseInt(pares_defectuosos) || 0

    if (docenasReportadas > Number(selectedLote.docenas_pendientes)) {
      toast.error('La cantidad reportada supera las docenas pendientes de este lote')
      return
    }

    setSaving(true)

    // 1. Insertar reporte de volteado
    const { error: repErr } = await supabase.from('reportes_volteado').insert({
      lote_volteado_id: selectedLote.id,
      volteador_id: selectedLote.volteador_id,
      catalogo_media_id: selectedLote.catalogo_media_id,
      docenas_volteadas: docenasReportadas,
      pares_defectuosos: defectos,
      comentarios: comentarios.trim() || null
    })

    if (repErr) {
      toast.error(`Error al registrar el reporte: ${repErr.message}`)
      setSaving(false)
      return
    }

    // 2. Actualizar las docenas pendientes del lote
    const pendientesNuevas = Math.max(0, Number(selectedLote.docenas_pendientes) - docenasReportadas)
    const nuevoEstado = pendientesNuevas === 0 ? 'completado' : 'en_proceso'

    const { error: loteUpdErr } = await supabase.from('lotes_volteado')
      .update({
        docenas_pendientes: pendientesNuevas,
        estado: nuevoEstado
      })
      .eq('id', selectedLote.id)

    if (loteUpdErr) {
      toast.error(`Error al actualizar estado del lote: ${loteUpdErr.message}`)
      setSaving(false)
      return
    }

    // 3. Incrementar stock listo para planchar
    const { data: slpExist, error: slpFindErr } = await supabase.from('stock_listo_planchar')
      .select('id, docenas')
      .eq('catalogo_media_id', selectedLote.catalogo_media_id)
      .maybeSingle()

    if (slpFindErr) {
      toast.error(`Error al consultar stock de planchado: ${slpFindErr.message}`)
      setSaving(false)
      return
    }

    if (slpExist) {
      const { error: slpUpdErr } = await supabase.from('stock_listo_planchar')
        .update({ docenas: Number(slpExist.docenas) + docenasReportadas })
        .eq('id', slpExist.id)
      if (slpUpdErr) {
        toast.error(`Error al actualizar stock de planchado: ${slpUpdErr.message}`)
        setSaving(false)
        return
      }
    } else {
      const { error: slpInsErr } = await supabase.from('stock_listo_planchar')
        .insert({
          catalogo_media_id: selectedLote.catalogo_media_id,
          docenas: docenasReportadas
        })
      if (slpInsErr) {
        toast.error(`Error al registrar stock de planchado: ${slpInsErr.message}`)
        setSaving(false)
        return
      }
    }

    toast.success(`🎉 Reporte registrado. ${docenasReportadas} doc. enviadas al stock de Planchado.`)
    setShowReportarModal(false)
    setSelectedLote(null)
    setReporteForm({ docenas_volteadas: '', pares_defectuosos: '0', comentarios: '' })
    setSaving(false)
    cargarDatos()
  }

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── HEADER SUPERIOR ─────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <RotateCcw className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white uppercase tracking-wider">Control de Volteado (Turning)</h1>
            <p className="text-xs text-slate-400">Administra y registra la etapa intermedia de volteo de calcetines y control de mermas.</p>
          </div>
        </div>

        {esSupervisor && (
          <button
            onClick={() => setShowAsignarModal(true)}
            className="btn-primary flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-indigo-600 border-none font-bold text-xs uppercase tracking-wider"
          >
            <Plus className="w-4 h-4" /> Asignar Tarea de Volteo
          </button>
        )}
      </div>

      {/* ── METRICAS GENERALES ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass p-5 rounded-3xl border border-white/[0.08] relative overflow-hidden">
          <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Stock por Voltear</span>
          <span className="text-2xl font-black text-white font-mono block">
            {stockListo.reduce((sum, s) => sum + Number(s.docenas), 0)} doc.
          </span>
          <span className="text-[10px] text-slate-400 block mt-1">Acumulado en stock listo para voltear</span>
          <div className="absolute right-4 bottom-4 text-indigo-500/20"><Warehouse className="w-12 h-12" /></div>
        </div>

        <div className="glass p-5 rounded-3xl border border-white/[0.08] relative overflow-hidden">
          <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Volteado Hoy</span>
          <span className="text-2xl font-black text-emerald-400 font-mono block">{metricas.volteadasHoy} doc.</span>
          <span className="text-[10px] text-slate-400 block mt-1">Registros del turno actual</span>
          <div className="absolute right-4 bottom-4 text-emerald-500/20"><CheckCircle2 className="w-12 h-12" /></div>
        </div>

        <div className="glass p-5 rounded-3xl border border-white/[0.08] relative overflow-hidden">
          <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Mermas Detectadas</span>
          <span className="text-2xl font-black text-rose-400 font-mono block">{metricas.totalDefectos} pares</span>
          <span className="text-[10px] text-slate-400 block mt-1">Pares defectuosos descartados</span>
          <div className="absolute right-4 bottom-4 text-rose-500/20"><AlertTriangle className="w-12 h-12" /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ── SECCIÓN DE LOTES ASIGNADOS ─────────────────────────────────────── */}
        <div className="xl:col-span-2 space-y-4">
          <div className="glass p-6 rounded-3xl border border-white/[0.08]">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-400" /> 
              {esSupervisor ? 'Seguimiento de Lotes Asignados' : 'Mis Lotes Asignados'}
            </h2>

            {loading ? (
              <div className="py-10 text-center text-slate-400 flex flex-col items-center gap-2"><Loader2 className="w-6 h-6 animate-spin" /> Cargando lotes...</div>
            ) : lotesFiltrados.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-xs">No tienes lotes de volteado asignados actualmente</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-400 font-bold uppercase">
                      <th className="pb-3">Cód. SKU</th>
                      <th className="pb-3">Detalle</th>
                      <th className="pb-3">Asignado a</th>
                      <th className="pb-3">Docenas</th>
                      <th className="pb-3">Estado</th>
                      <th className="pb-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotesFiltrados.map(l => (
                      <tr key={l.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.01]">
                        <td className="py-3.5 font-mono text-slate-300 font-bold">{l.catalogo_media?.sku || 'SKU-VARIADO'}</td>
                        <td className="py-3.5 text-slate-200">
                          {l.catalogo_media?.modelo} — {l.catalogo_media?.talla} ({l.catalogo_media?.publico})
                        </td>
                        <td className="py-3.5 text-slate-300 font-medium">{l.volteador?.nombre || 'Operador'}</td>
                        <td className="py-3.5 font-mono text-slate-200 font-bold">
                          {l.docenas_pendientes} / {l.docenas_asignadas} doc.
                        </td>
                        <td className="py-3.5">
                          <span className={`badge ${
                            l.estado === 'completado' ? 'badge-success' :
                            l.estado === 'en_proceso' ? 'badge-warning' : 'badge-info'
                          }`}>
                            {l.estado === 'completado' ? 'Completado' :
                             l.estado === 'en_proceso' ? 'En Proceso' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="py-3.5 text-right">
                          {l.estado === 'pendiente' && (
                            <button
                              onClick={() => handleIniciarLote(l.id)}
                              className="btn-secondary py-1 px-2.5 rounded-lg border-indigo-500/30 text-indigo-300 text-[10px] font-bold flex items-center gap-1.5 ml-auto"
                            >
                              <Play className="w-3 h-3" /> Iniciar
                            </button>
                          )}
                          {l.estado === 'en_proceso' && (
                            <button
                              onClick={() => { setSelectedLote(l); setShowReportarModal(true) }}
                              className="btn-primary py-1 px-2.5 rounded-lg bg-emerald-600 text-white border-none text-[10px] font-bold flex items-center gap-1.5 ml-auto"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Reportar
                            </button>
                          )}
                          {l.estado === 'completado' && (
                            <span className="text-slate-500 text-[10px] font-medium italic block mr-2">Terminado</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── PANEL DE STOCK DISPONIBLE (LADO DERECHO) ───────────────────────── */}
        <div className="space-y-6">
          <div className="glass p-6 rounded-3xl border border-white/[0.08]">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-emerald-400" />
              Stock Esperando Volteo
            </h2>
            {stockListo.length === 0 ? (
              <p className="text-slate-500 text-xs py-4 text-center">No hay medias acumuladas listas para voltear</p>
            ) : (
              <div className="space-y-3">
                {stockListo.map(s => (
                  <div key={s.id} className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-between text-xs">
                    <div>
                      <strong className="text-slate-200 block">{s.catalogo_media?.sku}</strong>
                      <span className="text-slate-400">{s.catalogo_media?.modelo} • Talla {s.catalogo_media?.talla}</span>
                    </div>
                    <span className="text-emerald-400 font-mono font-black">{s.docenas} doc.</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ÚLTIMOS REPORTES */}
          <div className="glass p-6 rounded-3xl border border-white/[0.08]">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              Últimos Reportes de Volteo
            </h2>
            <div className="space-y-3 max-h-60 overflow-y-auto text-xs">
              {reportes.slice(0, 5).map(r => (
                <div key={r.id} className="pb-3 border-b border-white/[0.04] last:border-0 last:pb-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-300 font-medium">{r.volteador?.nombre}</span>
                    <span className="text-slate-500 text-[10px] font-mono">{formatearFecha(r.fecha)}</span>
                  </div>
                  <div className="flex justify-between items-center font-mono">
                    <span className="text-slate-400">{r.catalogo_media?.sku}</span>
                    <span className="font-bold text-emerald-300">
                      {r.docenas_volteadas} doc. {r.pares_defectuosos > 0 && <span className="text-rose-400">({r.pares_defectuosos} m.)</span>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL: ASIGNAR LOTE (SUPERVISOR) ─────────────────────────────────── */}
      {showAsignarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
              <h2 className="text-md font-bold text-white flex items-center gap-2 uppercase tracking-wide">
                <RotateCcw className="w-5 h-5 text-indigo-400" /> Asignar Tarea de Volteo
              </h2>
              <button onClick={() => setShowAsignarModal(false)} className="p-1 rounded-lg hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAsignarLote} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1 uppercase">Media / SKU en Almacén</label>
                <select
                  value={asignarForm.catalogo_media_id}
                  onChange={e => setAsignarForm(f => ({ ...f, catalogo_media_id: e.target.value }))}
                  className="input-dark w-full font-medium"
                  required
                >
                  <option value="">Seleccionar SKU disponible...</option>
                  {stockListo.map(s => (
                    <option key={s.catalogo_media?.id} value={s.catalogo_media?.id}>
                      {s.catalogo_media?.sku} ({s.docenas} docenas disponibles)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1 uppercase">Operario Responsable</label>
                <select
                  value={asignarForm.volteador_id}
                  onChange={e => setAsignarForm(f => ({ ...f, volteador_id: e.target.value }))}
                  className="input-dark w-full font-medium"
                  required
                >
                  <option value="">Seleccionar volteador...</option>
                  {volteadores.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1 uppercase">Cantidad a Voltear (Docenas)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  placeholder="Ej: 15.5"
                  value={asignarForm.docenas}
                  onChange={e => setAsignarForm(f => ({ ...f, docenas: e.target.value }))}
                  className="input-dark w-full font-mono font-bold"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-white/[0.08]">
                <button type="button" onClick={() => setShowAsignarModal(false)} className="btn-secondary px-4 py-2 rounded-xl">Cancelar</button>
                <button type="submit" disabled={saving} className="btn-primary px-6 py-2 rounded-xl bg-indigo-600 border-none font-bold">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Asignar Lote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: REPORTAR LOTE (OPERARIO) ─────────────────────────────────── */}
      {showReportarModal && selectedLote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
              <h2 className="text-md font-bold text-white flex items-center gap-2 uppercase tracking-wide">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Reportar Lote
              </h2>
              <button onClick={() => setShowReportarModal(false)} className="p-1 rounded-lg hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.04] text-xs">
              <p className="text-slate-400">Modelo: <strong className="text-white">{selectedLote.catalogo_media?.modelo} • Talla {selectedLote.catalogo_media?.talla}</strong></p>
              <p className="text-slate-400 mt-1">Pendiente: <strong className="text-emerald-400">{selectedLote.docenas_pendientes} docenas</strong></p>
            </div>

            <form onSubmit={handleReportarLote} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1 uppercase">Docenas Volteadas Correctamente</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max={selectedLote.docenas_pendientes}
                  placeholder={`Máx: ${selectedLote.docenas_pendientes}`}
                  value={reporteForm.docenas_volteadas}
                  onChange={e => setReporteForm(f => ({ ...f, docenas_volteadas: e.target.value }))}
                  className="input-dark w-full font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1 uppercase flex items-center gap-1.5">
                  Mermas / Defectos Detectados (Cantidad en Pares)
                  <Info className="w-3.5 h-3.5 text-rose-400" title="Pares con huecos, fallas de costura o tejido descartados" />
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="Ej: 5"
                  value={reporteForm.pares_defectuosos}
                  onChange={e => setReporteForm(f => ({ ...f, pares_defectuosos: e.target.value }))}
                  className="input-dark w-full font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1 uppercase">Comentarios y Observaciones</label>
                <textarea
                  placeholder="Opcional. Ej: Agujas rotas en tejedora original, costura floja de remalle."
                  value={reporteForm.comentarios}
                  onChange={e => setReporteForm(f => ({ ...f, comentarios: e.target.value }))}
                  className="input-dark w-full min-h-[60px]"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-white/[0.08]">
                <button type="button" onClick={() => setShowReportarModal(false)} className="btn-secondary px-4 py-2 rounded-xl">Cancelar</button>
                <button type="submit" disabled={saving} className="btn-primary px-6 py-2 rounded-xl bg-emerald-600 border-none font-bold">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Registrar Producción'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
