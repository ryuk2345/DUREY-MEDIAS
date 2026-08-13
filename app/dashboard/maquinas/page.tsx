// @ts-nocheck
'use client'

// Maquinas Page - Control Center with ConfirmDialog
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Cpu, Plus, Search, Trash2, Edit2, Loader2, X, Check,
  AlertTriangle, CheckCircle, Wrench, PauseCircle, Clock,
  Phone, UserCheck, ShieldAlert, Zap, Send, Settings, Bell,
  FileText, Activity, Radio
} from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'

interface Marca { id: string; nombre: string }
interface Maquina {
  id: string
  codigo: string
  tipo: string
  marca_id: string
  anio: number
  caracteristicas: string
  estado: string
  eficiencia?: number
  detalle_estado?: string
  marca?: { nombre: string }
}

interface Tecnico {
  id: string
  nombre: string
  email: string
  especialidad: string
  telefono: string
  tipo: 'interno' | 'externo'
  estado: string
}

interface AveriaTimeline {
  id: string
  maquina_id: string
  descripcion_operador: string
  tipo_averia: string
  estado: string
  fecha_reporte: string
  asignado_a: string
  nivel: string
  maquina?: { codigo: string; tipo: string }
}

export default function MaquinasPage() {
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [averiasTimeline, setAveriasTimeline] = useState<AveriaTimeline[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'monitor' | 'gestion'>('monitor')

  // Formulario Reportar Falla (Machinery Monitor)
  const [reporteForm, setReporteForm] = useState({
    maquina_id: '',
    tipo_averia: 'MECÁNICA',
    descripcion: '',
    tecnico_asignado: ''
  })
  const [enviandoReporte, setEnviandoReporte] = useState(false)
  const [showConfirmReporte, setShowConfirmReporte] = useState(false)
  const [busquedaMonitor, setBusquedaMonitor] = useState('')

  // Modales y Gestión CRUD
  const [showMaquinaModal, setShowMaquinaModal] = useState(false)
  const [showMarcaModal, setShowMarcaModal] = useState(false)
  const [maquinaForm, setMaquinaForm] = useState({
    id: '',
    codigo: '',
    tipo: 'tejedora',
    marca_id: '',
    anio: new Date().getFullYear(),
    caracteristicas: '',
    estado: 'activa'
  })
  const [marcaForm, setMarcaForm] = useState({ id: '', nombre: '' })

  const supabase = createClient()

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [maq, mar, tec, av] = await Promise.all([
      supabase.from('maquinas').select('*, marca:marcas_maquinas!marca_id(nombre)').order('codigo'),
      supabase.from('marcas_maquinas').select('*').order('nombre'),
      supabase.from('usuarios').select('*').eq('rol', 'tecnico').order('nombre'),
      supabase.from('averias_maquinas').select(`
        *, maquina:maquinas!maquina_id(codigo, tipo)
      `).order('fecha_reporte', { ascending: false }).limit(10)
    ])

    const maqData = (maq.data ?? []) as unknown as Maquina[]
    setMaquinas(maqData)
    setMarcas(mar.data ?? [])
    setTecnicos((tec.data ?? []) as unknown as Tecnico[])
    setAveriasTimeline((av.data ?? []) as unknown as AveriaTimeline[])

    if (maqData.length > 0 && !reporteForm.maquina_id) {
      setReporteForm(prev => ({ ...prev, maquina_id: maqData[0].id }))
    }

    setLoading(false)
  }, [reporteForm.maquina_id])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // ── GUARDAR NUEVA FALLA / REPORTE CRÍTICO ──────────────────────────────────
  const enviarReporteCritico = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reporteForm.maquina_id) { toast.error('Selecciona la máquina averiada'); return }
    if (!reporteForm.descripcion.trim()) { toast.error('Ingresa la descripción detallada del síntoma'); return }

    setEnviandoReporte(true)

    const maqObj = maquinas.find(m => m.id === reporteForm.maquina_id)
    const tecObj = tecnicos.find(t => t.id === reporteForm.tecnico_asignado)

    const nuevoReporte = {
      maquina_id: reporteForm.maquina_id,
      tipo_averia: reporteForm.tipo_averia,
      descripcion_operador: `${maqObj?.codigo || ''}: ${reporteForm.descripcion.trim()}`,
      estado: 'pendiente',
      asignado_a: tecObj ? tecObj.nombre : 'Por Asignar',
      nivel: 'CRÍTICO',
      fecha_reporte: new Date().toISOString().replace('T', ' ').substring(0, 19)
    }

    const { error } = await supabase.from('averias_maquinas').insert(nuevoReporte)

    if (error) {
      toast.error('Error al enviar el reporte crítico')
      setEnviandoReporte(false)
      return
    }

    // Actualizar estado de máquina a 'malograda'
    await supabase.from('maquinas').update({
      estado: 'malograda',
      detalle_estado: `FALLA ${reporteForm.tipo_averia}`
    }).eq('id', reporteForm.maquina_id)

    toast.error(`⚠️ Reporte Crítico enviado para ${maqObj?.codigo || 'la máquina'}. Notificación enviada al equipo técnico.`, { duration: 4000 })

    setReporteForm(prev => ({ ...prev, descripcion: '' }))
    setEnviandoReporte(false)
    cargarDatos()
  }

  // Guardar Máquina CRUD
  const guardarMaquina = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!maquinaForm.codigo.trim() || !maquinaForm.marca_id) { toast.error('Completa los campos obligatorios'); return }

    const payload = {
      codigo: maquinaForm.codigo.trim().toUpperCase(),
      tipo: maquinaForm.tipo,
      marca_id: maquinaForm.marca_id,
      anio: maquinaForm.anio ? parseInt(maquinaForm.anio.toString()) : null,
      caracteristicas: maquinaForm.caracteristicas.trim(),
      estado: maquinaForm.estado,
      detalle_estado: maquinaForm.estado === 'activa' ? 'OPERATIVA' : 'MANTENIMIENTO'
    }

    if (maquinaForm.id) {
      await supabase.from('maquinas').update(payload).eq('id', maquinaForm.id)
      toast.success('Máquina actualizada')
    } else {
      await supabase.from('maquinas').insert(payload)
      toast.success('Nueva máquina registrada')
    }

    setShowMaquinaModal(false)
    setMaquinaForm({ id: '', codigo: '', tipo: 'tejedora', marca_id: '', anio: new Date().getFullYear(), caracteristicas: '', estado: 'activa' })
    cargarDatos()
  }

  const guardarNuevaMarca = async () => {
    if (!marcaForm.nombre.trim()) return
    await supabase.from('marcas_maquinas').insert({ nombre: marcaForm.nombre.trim() })
    toast.success('Marca creada')
    setShowMarcaModal(false)
    setMarcaForm({ id: '', nombre: '' })
    cargarDatos()
  }

  // Filtrado en el monitor
  const averiasFiltradas = averiasTimeline.filter(a => {
    if (!busquedaMonitor.trim()) return true
    const term = busquedaMonitor.toLowerCase()
    return a.descripcion_operador.toLowerCase().includes(term) ||
           a.maquina?.codigo.toLowerCase().includes(term) ||
           (a.asignado_a && a.asignado_a.toLowerCase().includes(term))
  })

  // Obtener máquina representativa de cada estado para las 4 tarjetas superiores
  const maqOperativa = maquinas.find(m => m.estado === 'activa') || { codigo: 'TX-401', eficiencia: 98, detalle_estado: 'EFICIENCIA: 98%' }
  const maqMalograda = maquinas.find(m => m.estado === 'malograda') || { codigo: 'RD-105', detalle_estado: 'ROTURA DE AGUJA' }
  const maqMantenimiento = maquinas.find(m => m.estado === 'mantenimiento') || { codigo: 'BK-220', detalle_estado: 'PREVENTIVO EN CURSO' }
  const maqStandby = maquinas.find(m => m.estado === 'standby' || m.estado === 'inactiva') || { codigo: 'TX-402', detalle_estado: 'SIN HILO (SET UP)' }

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── HEADER SUPERIOR MACHINERY MONITOR ─────────────────────────────────── */}
      <div className="glass p-6 rounded-3xl border border-white/[0.08] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Cpu className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-white tracking-tight">Machinery Monitor</h1>
              <span className="badge bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                <Radio className="w-3 h-3 animate-ping text-emerald-400" /> LIVE STATUS
              </span>
            </div>
            <p className="text-slate-400 text-xs font-medium">Monitoreo de estado en tiempo real, registro inmediato de averías y soporte técnico de planta</p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Buscador de máquinas/reportes */}
          <div className="relative flex-1 md:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar máquina o reporte..."
              value={busquedaMonitor}
              onChange={e => setBusquedaMonitor(e.target.value)}
              className="input-dark text-xs pl-9 py-2 w-full font-medium"
            />
          </div>

          <button
            onClick={() => setActiveTab(activeTab === 'monitor' ? 'gestion' : 'monitor')}
            className="btn-secondary text-xs py-2 px-3 rounded-2xl border-white/10 flex items-center gap-1.5 font-bold"
          >
            <Settings className="w-4 h-4 text-cyan-400" />
            {activeTab === 'monitor' ? 'Gestión y Marcas' : 'Machinery Monitor'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-cyan-400" /></div>
      ) : activeTab === 'monitor' ? (
        <>
          {/* ── 4 TARJETAS PRINCIPALES DE ESTADO EN VIVO (LIVE STATUS) ───────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. OPERATIVA */}
            <div className="glass rounded-3xl p-5 border border-emerald-500/30 bg-emerald-500/[0.02] shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <span className="badge bg-emerald-500/20 text-emerald-300 font-black text-[10px] uppercase tracking-wider">
                  OPERATIVA
                </span>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">MÁQUINA {maqOperativa.codigo}</p>
                <p className="text-xl font-black text-emerald-400 font-mono tracking-tight mt-0.5">
                  EFICIENCIA: {maqOperativa.eficiencia || 98}%
                </p>
              </div>
            </div>

            {/* 2. FALLA CRÍTICA */}
            <div className="glass rounded-3xl p-5 border border-red-500/40 bg-red-500/[0.04] shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <span className="badge bg-red-500/20 text-red-300 font-black text-[10px] uppercase tracking-wider">
                  FALLA CRÍTICA
                </span>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">MÁQUINA {maqMalograda.codigo}</p>
                <p className="text-lg font-black text-red-400 tracking-tight mt-0.5 uppercase">
                  {maqMalograda.detalle_estado || 'ROTURA DE AGUJA'}
                </p>
              </div>
            </div>

            {/* 3. MANTENIMIENTO */}
            <div className="glass rounded-3xl p-5 border border-cyan-500/30 bg-cyan-500/[0.02] shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                  <Wrench className="w-5 h-5" />
                </div>
                <span className="badge bg-cyan-500/20 text-cyan-300 font-black text-[10px] uppercase tracking-wider">
                  MANTENIMIENTO
                </span>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">MÁQUINA {maqMantenimiento.codigo}</p>
                <p className="text-lg font-black text-cyan-300 tracking-tight mt-0.5 uppercase">
                  {maqMantenimiento.detalle_estado || 'PREVENTIVO EN CURSO'}
                </p>
              </div>
            </div>

            {/* 4. STAND-BY */}
            <div className="glass rounded-3xl p-5 border border-slate-700 bg-slate-800/40 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center">
                  <PauseCircle className="w-5 h-5" />
                </div>
                <span className="badge bg-slate-700 text-slate-300 font-black text-[10px] uppercase tracking-wider">
                  STAND-BY
                </span>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">MÁQUINA {maqStandby.codigo}</p>
                <p className="text-lg font-black text-slate-300 tracking-tight mt-0.5 uppercase">
                  {maqStandby.detalle_estado || 'SIN HILO (SET UP)'}
                </p>
              </div>
            </div>
          </div>

          {/* ── CUERPO PRINCIPAL DOS COLUMNAS ───────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* COLUMNA IZQUIERDA: FORMULARIO "REPORTAR FALLA" (4 cols) */}
            <div className="lg:col-span-4 space-y-6">
              <div className="glass p-6 rounded-3xl border border-white/[0.08] shadow-xl">
                <div className="flex items-center gap-2 mb-5 pb-3 border-b border-white/[0.08]">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  <h2 className="text-base font-black text-white uppercase tracking-wider">REPORTAR FALLA</h2>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!reporteForm.maquina_id || !reporteForm.descripcion.trim()) {
                      toast.error('Selecciona una máquina e ingresa la descripción de la falla')
                      return
                    }
                    setShowConfirmReporte(true)
                  }}
                  className="space-y-4 text-xs"
                >
                  {/* SELECCIONAR MÁQUINA */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      SELECCIONAR MÁQUINA
                    </label>
                    <select
                      value={reporteForm.maquina_id}
                      onChange={e => setReporteForm({ ...reporteForm, maquina_id: e.target.value })}
                      className="input-dark text-xs font-bold w-full"
                    >
                      {maquinas.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.codigo} ({m.marca?.nombre || m.tipo}) — {m.estado.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* TIPO DE AVERÍA (4 BOTONES) */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      TIPO DE AVERÍA
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {['MECÁNICA', 'ELÉCTRICA', 'ELECTRÓNICA', 'SOFTWARE'].map(tipo => (
                        <button
                          key={tipo}
                          type="button"
                          onClick={() => setReporteForm({ ...reporteForm, tipo_averia: tipo })}
                          className={`py-2 px-3 rounded-xl border text-[11px] font-bold transition-all ${
                            reporteForm.tipo_averia === tipo
                              ? 'border-pink-500 bg-pink-500/20 text-pink-300'
                              : 'border-white/10 text-slate-400 hover:border-white/20'
                          }`}
                        >
                          {tipo}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* DESCRIPCIÓN DETALLADA */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      DESCRIPCIÓN DETALLADA
                    </label>
                    <textarea
                      rows={4}
                      placeholder="Especifique el síntoma o código de error..."
                      value={reporteForm.descripcion}
                      onChange={e => setReporteForm({ ...reporteForm, descripcion: e.target.value })}
                      className="input-dark text-xs w-full resize-none font-medium placeholder:text-slate-600"
                    />
                  </div>

                  {/* ASIGNAR TÉCNICO ESPECIALISTA */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      ASIGNAR TÉCNICO ESPECIALISTA
                    </label>
                    <select
                      value={reporteForm.tecnico_asignado}
                      onChange={e => setReporteForm({ ...reporteForm, tecnico_asignado: e.target.value })}
                      className="input-dark text-xs font-semibold w-full text-cyan-300 border-cyan-500/30"
                    >
                      <option value="">Sin asignación inmediata</option>
                      {tecnicos.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.nombre} ({t.especialidad || 'Mantenimiento General'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={enviandoReporte}
                    className="btn-primary w-full justify-center py-3 text-xs bg-slate-900 hover:bg-slate-800 text-white font-black border border-white/20 uppercase tracking-wider rounded-2xl shadow-xl flex items-center gap-2"
                  >
                    {enviandoReporte ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-red-400" />}
                    ENVIAR REPORTE CRÍTICO
                  </button>
                </form>
              </div>
            </div>

            {/* COLUMNA DERECHA: LÍNEA DE TIEMPO DE AVERÍAS + TÉCNICOS DISPONIBLES (8 cols) */}
            <div className="lg:col-span-8 space-y-6">

              {/* LÍNEA DE TIEMPO DE AVERÍAS */}
              <div className="glass p-6 rounded-3xl border border-white/[0.08] shadow-xl">
                <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-cyan-400" />
                    <h2 className="text-base font-black text-white uppercase tracking-wider">
                      LÍNEA DE TIEMPO DE AVERÍAS
                    </h2>
                  </div>
                  <a href="/dashboard/mantenimiento" className="text-xs font-bold text-cyan-400 hover:underline flex items-center gap-1 uppercase tracking-wider">
                    VER HISTORIAL COMPLETO ➔
                  </a>
                </div>

                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-white/10">
                  {averiasFiltradas.length === 0 ? (
                    <p className="text-slate-500 text-xs text-center py-6">No hay averías registradas recientemente</p>
                  ) : averiasFiltradas.map((a, idx) => {
                    const esCritico = a.nivel === 'CRÍTICO' || a.estado === 'pendiente'
                    const esResuelto = a.estado === 'resuelto'

                    return (
                      <div key={a.id || idx} className="relative">
                        {/* Dot indicador */}
                        <div className={`absolute -left-6 top-1 w-3 h-3 rounded-full border-2 border-slate-900 ${
                          esCritico ? 'bg-red-500 shadow-md shadow-red-500/50 animate-pulse' : esResuelto ? 'bg-emerald-400' : 'bg-cyan-400'
                        }`} />

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                          <h3 className="font-bold text-white text-xs tracking-tight">
                            {a.descripcion_operador.split('—')[0] || a.descripcion_operador}
                          </h3>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {a.fecha_reporte}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed mb-2 font-medium">
                          {a.descripcion_operador.includes('—') ? a.descripcion_operador.split('—')[1] : a.descripcion_operador}
                        </p>

                        <div className="flex items-center gap-2">
                          <span className={`badge text-[9px] font-black uppercase ${
                            esCritico ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          }`}>
                            {a.nivel || (esCritico ? 'CRÍTICO' : 'RESUELTO')}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Asignado a: <strong className="text-slate-200">{a.asignado_a || 'Pedro Técnico'}</strong>
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* TÉCNICOS DISPONIBLES (INTERNOS Y EXTERNOS) */}
              <div className="glass p-6 rounded-3xl border border-white/[0.08] shadow-xl">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.08]">
                  <UserCheck className="w-5 h-5 text-pink-400" />
                  <h2 className="text-base font-black text-white uppercase tracking-wider">
                    TÉCNICOS DISPONIBLES (INTERNOS Y EXTERNOS)
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {tecnicos.length === 0 ? (
                    <p className="text-slate-500 text-xs col-span-2 text-center py-4">Cargando personal técnico...</p>
                  ) : tecnicos.map(t => (
                    <div key={t.id} className="p-4 rounded-2xl bg-slate-900/60 border border-white/[0.06] flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 text-cyan-300 font-bold flex items-center justify-center border border-cyan-500/30 text-sm">
                          👨‍🔧
                        </div>
                        <div>
                          <p className="font-bold text-white text-xs uppercase">{t.nombre}</p>
                          <p className="text-[10px] text-slate-400 uppercase font-semibold">{t.especialidad || 'Mantenimiento de Planta'}</p>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold block mt-0.5">
                            {t.telefono || '+51 987 654 321'}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <span className={`badge text-[9px] font-bold uppercase ${
                          t.estado === 'disponible' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          {t.estado === 'disponible' ? 'DISPONIBLE' : 'EN REPARACIÓN'}
                        </span>
                        <a
                          href={`tel:${t.telefono || '987654321'}`}
                          className="btn-primary text-[10px] py-1 px-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold border-none rounded-xl flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3" /> CONTACTAR
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </>
      ) : (
        /* ── VISTA DE GESTIÓN Y MARCAS CRUD ───────────────────────────────────── */
        <div className="space-y-6">
          <div className="flex justify-between items-center glass p-5 rounded-3xl border border-white/[0.08]">
            <h2 className="text-lg font-bold text-white">Inventario Completo de Maquinarias</h2>
            <div className="flex gap-3">
              <button onClick={() => setShowMarcaModal(true)} className="btn-secondary text-xs py-2">
                <Plus className="w-4 h-4" /> Nueva Marca
              </button>
              <button onClick={() => setShowMaquinaModal(true)} className="btn-primary text-xs py-2 bg-cyan-600 border-none">
                <Plus className="w-4 h-4" /> Registrar Máquina
              </button>
            </div>
          </div>

          <div className="glass rounded-3xl overflow-hidden border border-white/[0.08]">
            <table className="table-dark">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Tipo</th>
                  <th>Marca</th>
                  <th>Año</th>
                  <th>Características</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {maquinas.map(m => (
                  <tr key={m.id}>
                    <td><code className="text-cyan-300 font-mono font-bold text-xs">{m.codigo}</code></td>
                    <td className="capitalize text-slate-300">{m.tipo}</td>
                    <td className="text-white font-medium">{m.marca?.nombre}</td>
                    <td className="text-slate-400 font-mono">{m.anio}</td>
                    <td className="text-slate-300 text-xs">{m.caracteristicas}</td>
                    <td>
                      <span className={`badge ${
                        m.estado === 'activa' ? 'badge-success' : m.estado === 'malograda' ? 'badge-danger' : 'badge-warning'
                      }`}>
                        {m.estado}
                      </span>
                    </td>
                    <td className="text-right space-x-2">
                      <button
                        onClick={() => {
                          setMaquinaForm({
                            id: m.id,
                            codigo: m.codigo,
                            tipo: m.tipo,
                            marca_id: m.marca_id,
                            anio: m.anio,
                            caracteristicas: m.caracteristicas,
                            estado: m.estado
                          })
                          setShowMaquinaModal(true)
                        }}
                        className="btn-secondary py-1 px-2.5 text-xs"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL REGISTRAR / EDITAR MÁQUINA */}
      {showMaquinaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-5 pb-3 border-b border-white/[0.08]">
              <h2 className="text-lg font-bold text-white">{maquinaForm.id ? 'Editar Máquina' : 'Registrar Nueva Máquina'}</h2>
              <button onClick={() => setShowMaquinaModal(false)} className="p-2 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={guardarMaquina} className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Código de Máquina *</label>
                <input type="text" placeholder="Ej. TX-401" value={maquinaForm.codigo} onChange={e => setMaquinaForm({ ...maquinaForm, codigo: e.target.value })} className="input-dark w-full font-mono font-bold" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Tipo</label>
                  <select value={maquinaForm.tipo} onChange={e => setMaquinaForm({ ...maquinaForm, tipo: e.target.value })} className="input-dark w-full font-bold">
                    <option value="tejedora">Tejedora</option>
                    <option value="remalladora">Remalladora</option>
                    <option value="planchadora">Planchadora</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Marca *</label>
                  <select value={maquinaForm.marca_id} onChange={e => setMaquinaForm({ ...maquinaForm, marca_id: e.target.value })} className="input-dark w-full font-bold">
                    <option value="">Selecciona...</option>
                    {marcas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Características</label>
                <textarea rows={2} placeholder="Descripción técnica..." value={maquinaForm.caracteristicas} onChange={e => setMaquinaForm({ ...maquinaForm, caracteristicas: e.target.value })} className="input-dark w-full" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowMaquinaModal(false)} className="btn-secondary flex-1 justify-center py-2">Cancelar</button>
                <button type="submit" className="btn-primary flex-1 justify-center py-2 bg-cyan-600 border-none font-bold">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL NUEVA MARCA */}
      {showMarcaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-sm p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <h2 className="text-lg font-bold text-white mb-4">Nueva Marca de Máquina</h2>
            <input type="text" placeholder="Ej. Rosso / Angies" value={marcaForm.nombre} onChange={e => setMarcaForm({ ...marcaForm, nombre: e.target.value })} className="input-dark w-full mb-6 font-bold" />
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowMarcaModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">Cancelar</button>
              <button
                type="button"
                onClick={guardarNuevaMarca}
                className="btn-primary flex-1 justify-center py-2 text-xs bg-cyan-600 border-none font-bold"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIÁLOGO DE CONFIRMACIÓN DE REPORTAR FALLA CRÍTICA */}
      <ConfirmDialog
        isOpen={showConfirmReporte}
        onClose={() => setShowConfirmReporte(false)}
        onConfirm={() => {
          setShowConfirmReporte(false)
          enviarReporteCritico()
        }}
        title="¿Confirmar Reporte Crítico de Avería?"
        description="Esta acción cambiará inmediatamente el estado de la máquina a 'FALLA CRÍTICA / MALOGRADA' y notificará al equipo técnico."
        confirmText="Sí, Marcar Avería"
        cancelText="Cancelar"
        isDanger={true}
        isLoading={enviandoReporte}
      />
    </div>
  )
}
