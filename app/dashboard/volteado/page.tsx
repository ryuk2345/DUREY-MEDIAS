// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  RotateCcw, Sparkles, Loader2, CheckCircle2, User, 
  Plus, X, Calendar, FileText, Search, Warehouse, ArrowRight, AlertTriangle
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
  estado: 'en_proceso' | 'completado'
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
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEstadoFilter, setSelectedEstadoFilter] = useState('todos')

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

  // Filtrar lotes por búsqueda, rol y filtro de estado
  const lotesFiltrados = useMemo(() => {
    let result = lotes

    // Filtro por rol (si no es supervisor, solo ve los suyos)
    if (!esSupervisor) {
      const profileId = volteadores.find(v => v.id === asignarForm.volteador_id)?.id || userId
      result = result.filter(l => l.volteador_id === profileId || l.volteador_id === userId)
    }

    // Filtro por estado
    if (selectedEstadoFilter === 'en_proceso') {
      result = result.filter(l => l.estado === 'en_proceso')
    } else if (selectedEstadoFilter === 'completado') {
      result = result.filter(l => l.estado === 'completado')
    }

    // Filtro por barra de búsqueda
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(l => 
        (l.volteador?.nombre || '').toLowerCase().includes(q) ||
        (l.catalogo_media?.sku || '').toLowerCase().includes(q) ||
        (l.catalogo_media?.modelo || '').toLowerCase().includes(q)
      )
    }

    return result
  }, [lotes, esSupervisor, volteadores, asignarForm.volteador_id, userId, selectedEstadoFilter, searchQuery])

  // Contadores para badges
  const countEnProceso = useMemo(() => lotes.filter(l => l.estado === 'en_proceso').length, [lotes])
  const countCompletados = useMemo(() => lotes.filter(l => l.estado === 'completado').length, [lotes])

  // Métricas generales
  const metricas = useMemo(() => {
    const pendientes = lotes.reduce((sum, l) => l.estado === 'en_proceso' ? sum + Number(l.docenas_pendientes) : sum, 0)
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

    // 1. Crear el lote de volteado (estado por defecto: 'en_proceso' como en lotes_remallado)
    const { data: nuevoLote, error: insertErr } = await supabase.from('lotes_volteado').insert({
      volteador_id,
      catalogo_media_id,
      docenas_asignadas: docenasNum,
      docenas_pendientes: docenasNum,
      estado: 'en_proceso'
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

    toast.success('🎉 Lote asignado e iniciado en proceso de volteado.')
    setShowAsignarModal(false)
    setAsignarForm(f => ({ ...f, catalogo_media_id: '', docenas: '' }))
    setSaving(false)
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
    <div className="space-y-6 animate-fadeInUp pb-12 text-xs">
      {/* ── BARRA SUPERIOR E INFORMACIÓN DEL ÁREA DE VOLTEADO ( Turning ) ────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">Monitor de Volteado (Turning)</h1>
              <p className="text-slate-400 text-xs font-medium">Inspección de calcetines, mermas y transición al planchado</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Badges de Estado */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />
            <span>{countEnProceso} En Volteo</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>{countCompletados} Completados</span>
          </div>

          {esSupervisor && (
            <button
              onClick={() => setShowAsignarModal(true)}
              className="btn-primary text-xs rounded-2xl py-2 px-5 bg-indigo-600 hover:bg-indigo-500 border-none font-bold tracking-wider"
            >
              <Plus className="w-4 h-4" /> Asignar Lote
            </button>
          )}
        </div>
      </div>

      {/* ── METRICAS GENERALES ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass p-5 rounded-3xl border border-white/[0.08] relative overflow-hidden">
          <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Pendiente de Voltear</span>
          <span className="text-2xl font-black text-white font-mono block">
            {stockListo.reduce((sum, s) => sum + Number(s.docenas), 0)} doc.
          </span>
          <span className="text-[10px] text-slate-400 block mt-1">Acumulado en stock listo para voltear</span>
        </div>

        <div className="glass p-5 rounded-3xl border border-white/[0.08] relative overflow-hidden">
          <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Volteado Hoy</span>
          <span className="text-2xl font-black text-emerald-400 font-mono block">{metricas.volteadasHoy} doc.</span>
          <span className="text-[10px] text-slate-400 block mt-1">Registros del turno actual</span>
        </div>

        <div className="glass p-5 rounded-3xl border border-white/[0.08] relative overflow-hidden">
          <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Mermas Detectadas</span>
          <span className="text-2xl font-black text-rose-400 font-mono block">{metricas.totalDefectos} pares</span>
          <span className="text-[10px] text-slate-400 block mt-1">Pares defectuosos descartados</span>
        </div>
      </div>

      {/* ── FILTROS Y BÚSQUEDA ──────────────────────────────────────────────── ── */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar operario o media..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="input-dark pl-10 text-xs rounded-xl w-full"
          />
        </div>

        <div className="flex items-center gap-2 bg-slate-900/60 p-1 rounded-2xl border border-white/[0.06] text-xs">
          <span className="text-slate-400 font-semibold px-3 py-1">Estado:</span>
          <select
            value={selectedEstadoFilter}
            onChange={e => setSelectedEstadoFilter(e.target.value)}
            className="bg-transparent text-white font-medium focus:outline-none pr-2 cursor-pointer"
          >
            <option value="todos" className="bg-slate-900 text-white">Todos los lotes</option>
            <option value="en_proceso" className="bg-slate-900 text-white">En Volteo</option>
            <option value="completado" className="bg-slate-900 text-white">Completados</option>
          </select>
        </div>
      </div>

      {/* ── CONTENIDO EN 2 COLUMNAS (GRID DE CARDS + STOCK) ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── COLUMNA IZQUIERDA (2 COLS): GRID DE TAREAS DE VOLTEADO ──────────── */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="flex justify-center items-center py-24 glass rounded-3xl">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            </div>
          ) : lotesFiltrados.length === 0 ? (
            <div className="glass rounded-3xl flex flex-col items-center justify-center py-20 text-slate-500 border border-dashed border-white/10">
              <RotateCcw className="w-12 h-12 mb-3 opacity-20" />
              <p className="font-semibold text-sm">No hay lotes de volteado encontrados</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {lotesFiltrados.map(l => {
                const isEnMarcha = l.estado === 'en_proceso'

                return (
                  <div
                    key={l.id}
                    className={`glass rounded-2xl p-4 border transition-all duration-300 flex flex-col justify-between ${
                      isEnMarcha
                        ? 'border-indigo-500/30 bg-indigo-500/[0.02] shadow-lg shadow-indigo-500/5'
                        : 'border-white/[0.08] hover:border-indigo-400/40'
                    }`}
                  >
                    <div>
                      {/* Cabecera Tarjeta */}
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <span className="font-black text-sm text-slate-300 font-mono block">
                            {l.catalogo_media?.sku || 'SKU-VARIADO'}
                          </span>
                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5 font-semibold">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            {l.volteador?.nombre || 'Operador'}
                          </p>
                        </div>

                        <div>
                          {isEnMarcha ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                              EN VOLTEO
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              COMPLETADO
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Info de media en volteado */}
                      <div className="mt-3 p-2.5 rounded-xl bg-slate-900/60 border border-white/[0.05]">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">
                          Producto en proceso:
                        </p>
                        <p className="text-xs font-mono font-medium text-slate-200 truncate">
                          {l.catalogo_media?.modelo} • Talla {l.catalogo_media?.talla}
                        </p>
                        <p className="text-[10px] text-indigo-300 font-medium mt-1">
                          Docenas: {l.docenas_asignadas} asignadas / {l.docenas_pendientes} pend.
                        </p>
                      </div>
                    </div>

                    {/* Botones de Acción */}
                    <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      {isEnMarcha ? (
                        <button
                          onClick={() => { setSelectedLote(l); setShowReportarModal(true) }}
                          className="btn-primary flex-1 justify-center text-xs py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white border-none shadow-md shadow-indigo-600/20 font-bold"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Cerrar Turno — Registrar
                        </button>
                      ) : (
                        <span className="text-slate-500 text-[10px] font-medium italic block text-center w-full py-1">Lote finalizado con éxito</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── COLUMNA DERECHA (1 COL): PANEL ASIGNACIÓN Y STOCK DISPONIBLE ────── */}
        <div className="space-y-6">
          {/* PANEL ASIGNACIÓN */}
          {esSupervisor && (
            <div className="glass rounded-3xl p-6 border border-indigo-500/20 shadow-xl bg-indigo-500/[0.02]">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.08]">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white">Asignación de Turno en Volteado</h2>
              </div>

              <form onSubmit={handleAsignarLote} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    SKU Disponible para Voltear ({stockListo.length})
                  </label>
                  <select
                    value={asignarForm.catalogo_media_id}
                    onChange={e => setAsignarForm({ ...asignarForm, catalogo_media_id: e.target.value })}
                    className="input-dark text-xs w-full font-medium"
                    required
                  >
                    <option value="">Seleccionar SKU...</option>
                    {stockListo.map(s => (
                      <option key={s.catalogo_media?.id} value={s.catalogo_media?.id}>
                        {s.catalogo_media?.sku} ({s.docenas} docenas disponibles)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Operario Responsable (Volteador)
                  </label>
                  <select
                    value={asignarForm.volteador_id}
                    onChange={e => setAsignarForm({ ...asignarForm, volteador_id: e.target.value })}
                    className="input-dark text-xs w-full font-medium"
                    required
                  >
                    <option value="">Seleccionar operario...</option>
                    {volteadores.map(v => (
                      <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Cantidad a Voltear (Docenas)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    placeholder="Ej: 10"
                    value={asignarForm.docenas}
                    onChange={e => setAsignarForm({ ...asignarForm, docenas: e.target.value })}
                    className="input-dark text-xs w-full font-mono font-bold"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary w-full justify-center py-2 text-xs bg-indigo-600 hover:bg-indigo-500 border-none font-bold"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Asignar e Iniciar Volteo'}
                </button>
              </form>
            </div>
          )}

          {/* STOCK DISPONIBLE */}
          <div className="glass p-6 rounded-3xl border border-white/[0.08]">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-emerald-400" />
              Stock Esperando Volteo
            </h2>
            {stockListo.length === 0 ? (
              <p className="text-slate-500 text-xs py-4 text-center">No hay medias en stock esperando voltearse</p>
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
        </div>
      </div>

      {/* ── MODAL: REPORTAR LOTE (OPERARIO) ─────────────────────────────────── */}
      {showReportarModal && selectedLote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
              <h2 className="text-md font-bold text-white flex items-center gap-2 uppercase tracking-wide">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Registrar Producción y Mermas
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
                  placeholder="Opcional. Ej: Hilo flojo en lote original o aguja picada."
                  value={reporteForm.comentarios}
                  onChange={e => setReporteForm(f => ({ ...f, comentarios: e.target.value }))}
                  className="input-dark w-full min-h-[60px]"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-white/[0.08]">
                <button type="button" onClick={() => setShowReportarModal(false)} className="btn-secondary px-4 py-2 rounded-xl">Cancelar</button>
                <button type="submit" disabled={saving} className="btn-primary px-6 py-2 rounded-xl bg-emerald-600 border-none font-bold">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
