// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Scissors, Send, ArrowRightLeft, Loader2, X,
  AlertTriangle, CheckCircle2, Package, User, Cpu,
  Play, Wrench, Search, Sparkles, Activity, TrendingUp, ShieldAlert
} from 'lucide-react'
import { toast } from 'sonner'
import { validarTransicionEstadoMaquina } from '@/lib/domain/machines'


interface LoteRemallado {
  id: string
  docenas_asignadas: number
  docenas_pendientes: number
  estado: string
  catalogo_media_id: string
  remalladora_id: string
  maquina_remalladora_id: string
  catalogo_media: { id: string; codigo: string }
  remalladora: { id: string; nombre: string }
  maquina_remalladora: { id: string; codigo: string }
}

interface Remalladora { id: string; nombre: string; estado: string }
interface MaquinaRem {
  id: string
  codigo: string
  marca_id: string
  tipo: string
  estado: string
  marca?: { id: string; nombre: string }
}
interface CatalogoMedia { id: string; codigo: string; modelo: string; publico: string }

const LIMITE_DOCENAS = 75

export default function RemalladoMonitorPage() {
  const [lotes, setLotes] = useState<LoteRemallado[]>([])
  const [remalladoras, setRemalladoras] = useState<Remalladora[]>([])
  const [maquinasRem, setMaquinasRem] = useState<MaquinaRem[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEstadoFilter, setSelectedEstadoFilter] = useState('todos')

  // Formulario lateral de "Asignación de Turno de Remallado"
  const [cargaForm, setCargaForm] = useState({
    maquina_id: '',
    remalladora_id: '',
    catalogo_media_id: '',
    docenas_asignadas: '75',
    horario: 'dia',
    duracion_horas: '8'
  })

  // Modales
  const [showReporteModal, setShowReporteModal] = useState(false)
  const [showTraspasoModal, setShowTraspasoModal] = useState(false)
  const [loteSeleccionado, setLoteSeleccionado] = useState<LoteRemallado | null>(null)
  const [reporteForm, setReporteForm] = useState({ docenas_remalladas: '', docenas_restantes: '' })

  const [traspasoForm, setTraspasoForm] = useState({
    lote_origen_id: '', remalladora_destino_id: '', maquina_destino_id: '', docenas: ''
  })

  const supabase = createClient()

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [lot, maq, cat] = await Promise.all([
      supabase.from('lotes_remallado')
        .select(`id, docenas_asignadas, docenas_pendientes, estado, catalogo_media_id, remalladora_id, maquina_remalladora_id,
          catalogo_media:catalogo_medias(id, codigo),
          remalladora:usuarios(id, nombre),
          maquina_remalladora:maquinas(id, codigo)
        `).eq('estado', 'en_proceso'),
      supabase.from('maquinas').select('id, codigo, marca_id, tipo, estado, marca:marcas_maquinas(id, nombre)').eq('tipo', 'remalladora').order('codigo'),
      supabase.from('catalogo_medias').select('id, codigo, modelo, publico').eq('estado', 'activo').order('codigo'),
    ])

    if (lot.error) {
      toast.error(`Error cargando lotes: ${lot.error.message}`)
    }
    if (maq.error) {
      toast.error(`Error cargando máquinas: ${maq.error.message}`)
    }
    if (cat.error) {
      toast.error(`Error cargando catálogo: ${cat.error.message}`)
    }

    const hoy = new Date().toISOString().split('T')[0]
    const { data: asigData, error: asigErr } = await supabase
      .from('asignaciones_turno')
      .select('operador_id, operador:usuarios(id, nombre, estado)')
      .eq('area', 'enlace')
      .eq('fecha', hoy)

    let remalladorasList = []
    if (asigErr) {
      toast.error(`Error cargando asignaciones de turno: ${asigErr.message}`)
    } else if (asigData && asigData.length > 0) {
      remalladorasList = asigData.map((a: any) => a.operador).filter(Boolean)
    } else {
      const { data: usersData, error: usersErr } = await supabase
        .from('usuarios')
        .select('id, nombre, estado')
        .in('rol', ['operador', 'remalladora'])
        .eq('activo', true)
      if (usersErr) {
        toast.error(`Error cargando operarios: ${usersErr.message}`)
      } else if (usersData) {
        remalladorasList = usersData
      }
    }

    setLotes((lot.data ?? []) as unknown as LoteRemallado[])
    setRemalladoras(remalladorasList)
    setMaquinasRem((maq.data ?? []) as MaquinaRem[])
    setCatalogo((cat.data ?? []) as CatalogoMedia[])
    setLoading(false)
  }, [])


  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Map de lotes activos por id de máquina remalladora
  const maquinasLoteMap = useMemo(() => {
    const map = new Map<string, LoteRemallado>()
    lotes.forEach(l => {
      if (l.maquina_remalladora_id) {
        map.set(l.maquina_remalladora_id, l)
      }
    })
    return map
  }, [lotes])

  // Máquinas filtradas
  const maquinasFiltradas = useMemo(() => {
    return maquinasRem.filter(m => {
      const lote = maquinasLoteMap.get(m.id)
      const isOcupada = m.estado === 'ocupada' || !!lote
      const isMantenimiento = m.estado === 'mantenimiento'

      if (selectedEstadoFilter === 'en_marcha' && !isOcupada) return false
      if (selectedEstadoFilter === 'disponibles' && isOcupada) return false
      if (selectedEstadoFilter === 'mantenimiento' && !isMantenimiento) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchCodigo = m.codigo.toLowerCase().includes(q)
        const matchRemalladora = lote?.remalladora?.nombre?.toLowerCase().includes(q)
        const matchMedia = lote?.catalogo_media?.codigo?.toLowerCase().includes(q)
        if (!matchCodigo && !matchRemalladora && !matchMedia) return false
      }
      return true
    })
  }, [maquinasRem, maquinasLoteMap, selectedEstadoFilter, searchQuery])

  // Remalladoras disponibles
  const remalladorasDisponibles = useMemo(() => {
    return remalladoras.filter(r => r.estado === 'disponible')
  }, [remalladoras])

  // Máquinas remalladoras libres
  const maquinasLibres = useMemo(() => {
    return maquinasRem.filter(m => m.estado === 'activa' && !maquinasLoteMap.has(m.id))
  }, [maquinasRem, maquinasLoteMap])

  // Conteos KPI
  const countActivas = maquinasRem.filter(m => m.estado === 'ocupada' || maquinasLoteMap.has(m.id)).length
  const countDisponibles = maquinasRem.filter(m => m.estado === 'activa' && !maquinasLoteMap.has(m.id)).length
  const countMantenimiento = maquinasRem.filter(m => m.estado === 'mantenimiento').length

  // Eliminado prellenarDesdeMinideposito

  // ── EJECUTAR ASIGNACIÓN DE TURNO EN REMALLADO ─────────────────────────────
  const ejecutarAsignacionRemallado = async () => {
    const { maquina_id, remalladora_id, catalogo_media_id, docenas_asignadas } = cargaForm

    if (!maquina_id) { toast.error('Selecciona una máquina remalladora'); return }
    if (!remalladora_id) { toast.error('Selecciona una operadora remalladora'); return }
    if (!catalogo_media_id) { toast.error('Selecciona el tipo de media a remallar'); return }

    const numDocenas = parseFloat(docenas_asignadas) || LIMITE_DOCENAS

    // Validar transición de la máquina a 'ocupada'
    const maquinaActual = maquinasRem.find(m => m.id === maquina_id)
    if (maquinaActual) {
      const v = validarTransicionEstadoMaquina(maquinaActual.estado as any, 'ocupada')
      if (!v.valido) {
        toast.error(`Error en máquina: ${v.error}`)
        return
      }
    }

    // 1. Crear el lote de remallado
    const { error: loteErr } = await supabase.from('lotes_remallado').insert({
      catalogo_media_id: catalogo_media_id,
      remalladora_id: remalladora_id,
      maquina_remalladora_id: maquina_id,
      docenas_asignadas: numDocenas,
      docenas_pendientes: numDocenas,
      estado: 'en_proceso',
    })

    if (loteErr) { toast.error('Error al iniciar lote de remallado'); return }

    // 2. Marcar máquina y operadora como ocupadas
    await supabase.from('usuarios').update({ estado: 'ocupada' }).eq('id', remalladora_id)
    await supabase.from('maquinas').update({ estado: 'ocupada' }).eq('id', maquina_id)

    toast.success('✅ Asignación iniciada. Máquina en marcha.')
    setCargaForm({
      maquina_id: '',
      remalladora_id: '',
      catalogo_media_id: '',
      docenas_asignadas: '75',
      horario: 'dia',
      duracion_horas: '8'
    })
    cargarDatos()
  }

  // ── REGISTRAR PRODUCCIÓN AL FINALIZAR TURNO ────────────────────────────────
  const abrirReporteModal = (lote: LoteRemallado) => {
    setLoteSeleccionado(lote)
    setReporteForm({ docenas_remalladas: '', docenas_restantes: '' })
    setShowReporteModal(true)
  }

  const enviarReporteProduccion = async () => {
    if (!loteSeleccionado) return
    const remalladas = parseFloat(reporteForm.docenas_remalladas)
    const restantes = parseFloat(reporteForm.docenas_restantes)

    if (isNaN(remalladas) || remalladas < 0) { toast.error('Ingresa las docenas remalladas correctamente'); return }
    if (isNaN(restantes) || restantes < 0) { toast.error('Ingresa las docenas restantes correctamente'); return }

    // Validar transición de la máquina a 'activa'
    const maquinaActual = maquinasRem.find(m => m.id === loteSeleccionado.maquina_remalladora_id)
    if (maquinaActual) {
      const v = validarTransicionEstadoMaquina(maquinaActual.estado as any, 'activa')
      if (!v.valido) {
        toast.error(`Error en máquina: ${v.error}`)
        return
      }
    }

    // 1. Guardar reporte de remallado
    const { error: repErr } = await supabase.from('reportes_remallado').insert({
      lote_id: loteSeleccionado.id,
      remalladora_id: loteSeleccionado.remalladora_id,
      maquina_id: loteSeleccionado.maquina_remalladora_id,
      docenas_remalladas: remalladas,
      docenas_restantes: restantes,
      fecha: new Date().toISOString().split('T')[0],
    })
    if (repErr) { toast.error('Error al guardar reporte'); return }

    // 2. Marcar lote como completado
    const { error: updLoteErr } = await supabase.from('lotes_remallado')
      .update({ estado: 'completado', docenas_pendientes: restantes })
      .eq('id', loteSeleccionado.id)
    if (updLoteErr) { toast.error(`Error al actualizar el lote: ${updLoteErr.message}`); return }

    // 3. Incrementar el stock listo para voltear
    const mediaId = loteSeleccionado.catalogo_media_id
    const { data: slvExist, error: slvFindErr } = await supabase.from('stock_listo_voltear')
      .select('id, docenas').eq('catalogo_media_id', mediaId).maybeSingle()
    
    if (slvFindErr) { toast.error(`Error al consultar stock de volteado: ${slvFindErr.message}`); return }

    if (slvExist) {
      const { error: slvUpdErr } = await supabase.from('stock_listo_voltear')
        .update({ docenas: Number(slvExist.docenas) + remalladas }).eq('id', slvExist.id)
      if (slvUpdErr) { toast.error(`Error al actualizar stock de volteado: ${slvUpdErr.message}`); return }
    } else {
      const { error: slvInsErr } = await supabase.from('stock_listo_voltear')
        .insert({ catalogo_media_id: mediaId, docenas: remalladas })
      if (slvInsErr) { toast.error(`Error al registrar stock de volteado: ${slvInsErr.message}`); return }
    }

    // 4. Liberar remalladora y máquina
    if (loteSeleccionado.remalladora_id) {
      const { error: rUserErr } = await supabase.from('usuarios').update({ estado: 'disponible' }).eq('id', loteSeleccionado.remalladora_id)
      if (rUserErr) { toast.error(`Error al liberar remalladora: ${rUserErr.message}`); return }
    }
    if (loteSeleccionado.maquina_remalladora_id) {
      const { error: rMaqErr } = await supabase.from('maquinas').update({ estado: 'activa' }).eq('id', loteSeleccionado.maquina_remalladora_id)
      if (rMaqErr) { toast.error(`Error al liberar máquina: ${rMaqErr.message}`); return }
    }

    toast.success(`🎉 ${remalladas} doc. remalladas enviadas a Volteado. Máquina liberada.`)
    setShowReporteModal(false)
    cargarDatos()
  }


  // ── TRASPASO POR SATURACIÓN ───────────────────────────────────────────────
  const ejecutarTraspaso = async () => {
    const { lote_origen_id, remalladora_destino_id, maquina_destino_id, docenas } = traspasoForm
    if (!lote_origen_id || !remalladora_destino_id || !maquina_destino_id || !docenas) {
      toast.error('Completa todos los campos del traspaso')
      return
    }

    const loteOrigen = lotes.find(l => l.id === lote_origen_id)
    if (!loteOrigen) { toast.error('Lote de origen no encontrado'); return }

    const docsTraspaso = parseFloat(docenas)
    if (isNaN(docsTraspaso) || docsTraspaso <= 0) { toast.error('Cantidad inválida'); return }

    if (docsTraspaso > loteOrigen.docenas_pendientes) {
      toast.error('La cantidad a traspasar excede el stock pendiente de la remalladora de origen')
      return
    }

    await supabase.from('lotes_remallado')
      .update({ docenas_pendientes: loteOrigen.docenas_pendientes - docsTraspaso })
      .eq('id', lote_origen_id)

    await supabase.from('lotes_remallado').insert({
      catalogo_media_id: loteOrigen.catalogo_media_id,
      remalladora_id: remalladora_destino_id,
      maquina_remalladora_id: maquina_destino_id,
      docenas_asignadas: docsTraspaso,
      docenas_pendientes: docsTraspaso,
      estado: 'en_proceso',
    })

    await supabase.from('usuarios').update({ estado: 'ocupada' }).eq('id', remalladora_destino_id)
    await supabase.from('maquinas').update({ estado: 'ocupada' }).eq('id', maquina_destino_id)

    toast.success(`Traspaso exitoso: ${docsTraspaso} docenas transferidas`)
    setShowTraspasoModal(false)
    setTraspasoForm({ lote_origen_id: '', remalladora_destino_id: '', maquina_destino_id: '', docenas: '' })
    cargarDatos()
  }

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── BARRA SUPERIOR E INFORMACIÓN DEL ÁREA DE REMALLADO ──────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-400">
              <Scissors className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">Monitor de Remallado</h1>
              <p className="text-slate-400 text-xs font-medium">Asignación por máquina remalladora, minidepósitos y traspasos</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Badges de Estado */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{countActivas} En Marcha</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-400" />
            <span>{countDisponibles} Libres</span>
          </div>

          <button
            onClick={() => { setTraspasoForm({ lote_origen_id: '', remalladora_destino_id: '', maquina_destino_id: '', docenas: '' }); setShowTraspasoModal(true) }}
            className="btn-secondary text-xs rounded-2xl py-2"
          >
            <ArrowRightLeft className="w-4 h-4" /> Traspaso por Saturación
          </button>
        </div>
      </div>

      {/* ── SECCIÓN DE MINIDEPÓSITOS ELIMINADA ── */}

      {/* ── FILTROS Y BÚSQUEDA ──────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar máquina remalladora o media..."
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
            <option value="todos" className="bg-slate-900 text-white">Todos los estados</option>
            <option value="en_marcha" className="bg-slate-900 text-white">En Marcha</option>
            <option value="disponibles" className="bg-slate-900 text-white">Libres</option>
            <option value="mantenimiento" className="bg-slate-900 text-white">Mantenimiento</option>
          </select>
        </div>
      </div>

      {/* ── CONTENIDO PRINCIPAL EN 2 COLUMNAS (GRID MÁQUINAS + ASIGNACIÓN) ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── COLUMNA IZQUIERDA (2 COLS): GRID DE MÁQUINAS REMALLADORAS ──────── */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="flex justify-center items-center py-24 glass rounded-3xl">
              <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
            </div>
          ) : maquinasFiltradas.length === 0 ? (
            <div className="glass rounded-3xl flex flex-col items-center justify-center py-20 text-slate-500 border border-dashed border-white/10">
              <Cpu className="w-12 h-12 mb-3 opacity-20" />
              <p className="font-semibold text-sm">No hay máquinas remalladoras encontradas</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {maquinasFiltradas.map(m => {
                const lote = maquinasLoteMap.get(m.id)
                const isEnMarcha = m.estado === 'ocupada' || !!lote
                const isMantenimiento = m.estado === 'mantenimiento'

                return (
                  <div
                    key={m.id}
                    className={`glass rounded-2xl p-4 border transition-all duration-300 flex flex-col justify-between ${
                      isEnMarcha
                        ? 'border-orange-500/30 bg-orange-500/[0.02] shadow-lg shadow-orange-500/5'
                        : isMantenimiento
                        ? 'border-amber-500/30 bg-amber-500/[0.02]'
                        : 'border-white/[0.08] hover:border-orange-400/40'
                    }`}
                  >
                    <div>
                      {/* Cabecera Tarjeta */}
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-lg text-white font-mono">{m.codigo}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/10 text-slate-300 font-semibold">
                              Remalladora
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <User className="w-3 h-3 text-slate-500" />
                            {lote?.remalladora?.nombre || 'Sin Operadora'}
                          </p>
                        </div>

                        <div>
                          {isEnMarcha ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                              EN MARCHA
                            </span>
                          ) : isMantenimiento ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              <Wrench className="w-3 h-3" />
                              ALERTA
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              LIBRE
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Info de media en remallado */}
                      <div className="mt-3 p-2.5 rounded-xl bg-slate-900/60 border border-white/[0.05]">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">
                          {isEnMarcha ? 'Remallando producto:' : 'Estado máquina:'}
                        </p>
                        <p className="text-xs font-mono font-medium text-slate-200 truncate">
                          {lote ? lote.catalogo_media?.codigo : 'Disponible para asignar'}
                        </p>
                        {lote && (
                          <p className="text-[10px] text-orange-300 font-medium mt-1">
                            Docenas: {lote.docenas_asignadas} asignadas / {lote.docenas_pendientes} pend.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Botones de Acción */}
                    <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      {isEnMarcha && lote ? (
                        <button
                          onClick={() => abrirReporteModal(lote)}
                          className="btn-primary flex-1 justify-center text-xs py-1.5 bg-orange-600 hover:bg-orange-500 text-white border-none shadow-md shadow-orange-600/20"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Cerrar Turno — Registrar
                        </button>
                      ) : (
                        <button
                          onClick={() => setCargaForm(f => ({ ...f, maquina_id: m.id }))}
                          className="btn-secondary flex-1 justify-center text-xs py-1.5 text-orange-300 hover:text-white border-orange-500/20 hover:border-orange-500/40"
                        >
                          <Play className="w-3.5 h-3.5 text-orange-400" />
                          Asignar Turno
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── COLUMNA DERECHA (1 COL): PANEL ASIGNACIÓN POR MÁQUINA Y REMALLADORA ── */}
        <div className="space-y-6">
          <div className="glass rounded-3xl p-6 border border-orange-500/20 shadow-xl bg-orange-500/[0.02]">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.08]">
              <Sparkles className="w-5 h-5 text-orange-400" />
              <h2 className="text-base font-bold text-white">Asignación de Turno en Remallado</h2>
            </div>

            <div className="space-y-4 text-xs">
              {/* 1. Selección de Máquina Remalladora */}
              <div>
                <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Máquina Remalladora Libre ({maquinasLibres.length})
                </label>
                <select
                  value={cargaForm.maquina_id}
                  onChange={e => setCargaForm({ ...cargaForm, maquina_id: e.target.value })}
                  className="input-dark text-xs w-full font-medium"
                >
                  <option value="">Seleccionar máquina remalladora...</option>
                  {maquinasLibres.map(m => (
                    <option key={m.id} value={m.id}>{m.codigo} — Libre</option>
                  ))}
                </select>
              </div>

              {/* 2. Selección de Operadora Remalladora */}
              <div>
                <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Operadora Remalladora ({remalladorasDisponibles.length} disponibles)
                </label>
                <select
                  value={cargaForm.remalladora_id}
                  onChange={e => setCargaForm({ ...cargaForm, remalladora_id: e.target.value })}
                  className="input-dark text-xs w-full font-medium"
                >
                  <option value="">Seleccionar remalladora...</option>
                  {remalladorasDisponibles.map(r => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </div>

              {/* 3. Selección de Tipo de Media (Catálogo) */}
              <div>
                <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Tipo de Media a Remallar (Catálogo)
                </label>
                <select
                  value={cargaForm.catalogo_media_id}
                  onChange={e => setCargaForm({ ...cargaForm, catalogo_media_id: e.target.value })}
                  className="input-dark text-xs w-full font-mono font-medium"
                >
                  <option value="">Seleccionar código de media...</option>
                  {catalogo.map(c => (
                    <option key={c.id} value={c.id}>{c.codigo}</option>
                  ))}
                </select>
              </div>

              {/* 4. Cantidad de Docenas y Horario */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Docenas Lote</label>
                  <input
                    type="number"
                    min="1"
                    value={cargaForm.docenas_asignadas}
                    onChange={e => setCargaForm({ ...cargaForm, docenas_asignadas: e.target.value })}
                    className="input-dark text-xs w-full text-center font-bold font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Horario</label>
                  <select
                    value={cargaForm.horario}
                    onChange={e => setCargaForm({ ...cargaForm, horario: e.target.value })}
                    className="input-dark text-xs w-full"
                  >
                    <option value="dia">☀ Día</option>
                    <option value="noche">🌙 Noche</option>
                  </select>
                </div>
              </div>

              {/* Botón Asignar */}
              <button
                onClick={ejecutarAsignacionRemallado}
                disabled={!cargaForm.maquina_id || !cargaForm.remalladora_id || !cargaForm.catalogo_media_id}
                className="btn-primary w-full justify-center py-2.5 text-xs font-bold bg-orange-600 hover:bg-orange-500 text-white rounded-xl shadow-lg shadow-orange-600/20 disabled:opacity-50 mt-2"
              >
                Asignar y Cargar Lote
              </button>
            </div>
          </div>

          {/* Widget OEE Remallado */}
          <div className="glass rounded-3xl p-5 border border-white/[0.08]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Eficiencia Remallado</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-black text-white">91.2%</span>
                  <span className="text-xs text-emerald-400 font-bold flex items-center">
                    <TrendingUp className="w-3 h-3 mr-0.5" /> +1.8%
                  </span>
                </div>
              </div>
              <Activity className="w-6 h-6 text-orange-400" />
            </div>

            <div className="flex items-end gap-1.5 h-12 pt-2">
              {[70, 85, 90, 88, 95, 91, 89, 93].map((h, i) => (
                <div key={i} className="flex-1 bg-orange-500/20 rounded-t-md relative overflow-hidden h-full">
                  <div
                    className="bg-gradient-to-t from-orange-600 to-amber-400 absolute bottom-0 left-0 right-0 rounded-t-md transition-all duration-500"
                    style={{ height: `${h}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* ── MODAL: REGISTRAR PRODUCCIÓN FINAL DE REMALLADO ────────────────────── */}
      {showReporteModal && loteSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.08]">
              <div>
                <h2 className="text-lg font-bold text-white">Cierre de Turno de Remallado</h2>
                <p className="text-xs text-slate-400">
                  Máquina: <span className="text-orange-300 font-mono">{loteSeleccionado.maquina_remalladora?.codigo}</span> · Operadora: <span className="text-white">{loteSeleccionado.remalladora?.nombre}</span>
                </p>
              </div>
              <button onClick={() => setShowReporteModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] mb-4 text-xs font-mono">
              <p className="text-slate-400">Media: <span className="text-white font-bold">{loteSeleccionado.catalogo_media?.codigo}</span></p>
              <p className="text-slate-400">Docenas asignadas: <span className="text-orange-300 font-bold">{loteSeleccionado.docenas_asignadas}</span></p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">✅ Docenas Remalladas (Terminadas)</label>
                <input
                  type="number"
                  min="0"
                  max={loteSeleccionado.docenas_asignadas}
                  placeholder="0"
                  value={reporteForm.docenas_remalladas}
                  onChange={e => setReporteForm({ ...reporteForm, docenas_remalladas: e.target.value })}
                  className="input-dark text-center font-bold text-sm w-full"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">📦 Docenas Restantes (Stock Pendiente)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={reporteForm.docenas_restantes}
                  onChange={e => setReporteForm({ ...reporteForm, docenas_restantes: e.target.value })}
                  className="input-dark text-center font-bold text-sm w-full"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500 mt-4">
              Las docenas remalladas se sumarán al inventario listo para Planchado. La máquina y la operadora quedarán libres.
            </p>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowReporteModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">
                Cancelar
              </button>
              <button onClick={enviarReporteProduccion} className="btn-primary flex-1 justify-center py-2 text-xs bg-orange-600 hover:bg-orange-500 border-none">
                <CheckCircle2 className="w-4 h-4" /> Confirmar Reporte
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: TRASPASO POR SATURACIÓN ───────────────────────────────────── */}
      {showTraspasoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.08]">
              <h2 className="text-lg font-bold text-white">Traspaso por Saturación</h2>
              <button onClick={() => setShowTraspasoModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                Transfiere docenas pendientes de una remalladora saturada a otra operadora y máquina libre.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Lote de Origen</label>
                <select
                  value={traspasoForm.lote_origen_id}
                  onChange={e => setTraspasoForm({ ...traspasoForm, lote_origen_id: e.target.value })}
                  className="input-dark text-xs w-full"
                >
                  <option value="">Seleccionar lote activo...</option>
                  {lotes.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.remalladora?.nombre} ({l.maquina_remalladora?.codigo}) — {l.catalogo_media?.codigo} ({l.docenas_pendientes} pend.)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Remalladora Destino (disponible)</label>
                <select
                  value={traspasoForm.remalladora_destino_id}
                  onChange={e => setTraspasoForm({ ...traspasoForm, remalladora_destino_id: e.target.value })}
                  className="input-dark text-xs w-full"
                >
                  <option value="">Seleccionar remalladora libre...</option>
                  {remalladorasDisponibles.map(r => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Máquina Destino (libre)</label>
                <select
                  value={traspasoForm.maquina_destino_id}
                  onChange={e => setTraspasoForm({ ...traspasoForm, maquina_destino_id: e.target.value })}
                  className="input-dark text-xs w-full"
                >
                  <option value="">Seleccionar máquina libre...</option>
                  {maquinasLibres.map(m => (
                    <option key={m.id} value={m.id}>{m.codigo}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Docenas a Traspasar</label>
                <input
                  type="number"
                  min="1"
                  placeholder="0"
                  value={traspasoForm.docenas}
                  onChange={e => setTraspasoForm({ ...traspasoForm, docenas: e.target.value })}
                  className="input-dark text-center font-bold text-sm w-full"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowTraspasoModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">
                Cancelar
              </button>
              <button onClick={ejecutarTraspaso} className="btn-primary flex-1 justify-center py-2 text-xs">
                <ArrowRightLeft className="w-4 h-4" /> Traspasar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
