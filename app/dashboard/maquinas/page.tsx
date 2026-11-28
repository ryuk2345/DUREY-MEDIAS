'use client'

// Maquinas Page - Control Center with ConfirmDialog
import BuscadorConSugerencias from '@/components/ui/BuscadorConSugerencias'
import { sugerir } from '@/lib/domain/catalogo'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { obtenerUsuarioActual } from '@/lib/auth/usuarioActual'
import { nombreMecanico } from '@/lib/domain/repuestos'
import { estadoPreventivoMaquina, ETIQUETA_ESTADO_PLAN, hoyLocal } from '@/lib/domain/mantenimiento'
import { History } from 'lucide-react'
import { formatearFecha } from '@/lib/utils'
import {
  Cpu, Plus, Search, Trash2, Edit2, Loader2, X, Check,
  AlertTriangle, CheckCircle, Wrench, PauseCircle, Clock,
  Phone, UserCheck, ShieldAlert, Zap, Send, Settings, Bell,
  FileText, Activity, Radio
} from 'lucide-react'
import { toast } from 'sonner'
import {
  validarTransicionEstadoMaquina, filtrarMaquinasPorGrupo, GRUPOS_ESTADO_MAQUINA, ESTADOS_MAQUINA_VALIDOS,
  type GrupoEstadoMaquina, type EstadoMaquina
} from '@/lib/domain/machines'


import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import CustomSelect from '@/components/ui/CustomSelect'

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

// Fase 3: los mecánicos no son usuarios (tabla mecanicos, migración 029)
interface Mecanico {
  id: string
  nombre: string
  apellido: string
  telefono: string
  activo: boolean
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
  const [mecanicos, setMecanicos] = useState<Mecanico[]>([])
  // Fase 4: planes de mantenimiento preventivo, para el aviso de vencido/próximo
  const [planes, setPlanes] = useState<{ maquina_id: string; fecha_inicio: string; ultima_fecha: string | null; frecuencia_dias: number; activo: boolean }[]>([])
  const mecanicosActivos = mecanicos.filter(m => m.activo)
  const [mecanicoForm, setMecanicoForm] = useState<{ id: string; nombre: string; apellido: string; telefono: string } | null>(null)
  const [guardandoMecanico, setGuardandoMecanico] = useState(false)
  const [averiasTimeline, setAveriasTimeline] = useState<AveriaTimeline[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'monitor' | 'gestion'>('monitor')

  // Formulario Reportar Falla (Machinery Monitor)
  const [reporteForm, setReporteForm] = useState({
    maquina_id: '',
    tipo_averia: 'MECÁNICA',
    descripcion: '',
    mecanico_id: ''
  })
  const [enviandoReporte, setEnviandoReporte] = useState(false)
  const [showConfirmReporte, setShowConfirmReporte] = useState(false)
  const [busquedaMonitor, setBusquedaMonitor] = useState('')
  // Tarjeta de estado pulsada: filtra la lista de máquinas (null = todas)
  const [filtroGrupo, setFiltroGrupo] = useState<GrupoEstadoMaquina | null>(null)
  const alternarFiltro = (grupo: GrupoEstadoMaquina) => setFiltroGrupo(actual => (actual === grupo ? null : grupo))

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
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)


  const supabase = createClient()

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  // No pone loading=true: tras la carga inicial, las recargas actualizan sin ocultar la pantalla
  const cargarDatos = useCallback(async () => {
    const [maq, mar, tec, av, pl] = await Promise.all([
      supabase.from('maquinas').select('*, marca:marcas_maquinas(nombre)').order('codigo'),
      supabase.from('marcas_maquinas').select('*').order('nombre'),
      supabase.from('mecanicos').select('id, nombre, apellido, telefono, activo').order('nombre'),
      supabase.from('averias_maquinas').select(`
        *, maquina:maquinas(codigo, tipo)
      `).order('fecha_reporte', { ascending: false }).limit(10),
      supabase.from('planes_mantenimiento').select('maquina_id, fecha_inicio, ultima_fecha, frecuencia_dias, activo'),
    ])
    if (pl.error) toast.error(`Error cargando planes de mantenimiento: ${pl.error.message}`)
    setPlanes(pl.data ?? [])

    if (maq.error) {
      toast.error(`Error cargando máquinas: ${maq.error.message || maq.error.details}`)
    }
    if (mar.error) {
      toast.error(`Error cargando marcas: ${mar.error.message || mar.error.details}`)
    }
    if (tec.error) {
      toast.error(`Error cargando mecánicos: ${tec.error.message}`)
    }
    if (av.error) {
      toast.error(`Error cargando averías: ${av.error.message || av.error.details}`)
    }

    const maqData = (maq.data ?? []) as unknown as Maquina[]
    setMaquinas(maqData)
    setMarcas(mar.data ?? [])
    setMecanicos((tec.data ?? []) as Mecanico[])
    setAveriasTimeline((av.data ?? []) as unknown as AveriaTimeline[])

    // Preseleccionar una máquina a la que se le pueda reportar falla (activa u ocupada)
    const reportable = maqData.find(m => m.estado === 'activa' || m.estado === 'ocupada') ?? maqData[0]
    if (reportable) {
      setReporteForm(prev => (prev.maquina_id ? prev : { ...prev, maquina_id: reportable.id }))
    }

    setLoading(false)
  }, [])

  const abrirMaquinaModal = (maquina: any = null) => {
    setErrorEnvio(null)
    if (maquina) {
      setMaquinaForm({
        id: maquina.id,
        codigo: maquina.codigo,
        tipo: maquina.tipo,
        marca_id: maquina.marca_id,
        anio: maquina.anio || new Date().getFullYear(),
        caracteristicas: maquina.caracteristicas || '',
        estado: maquina.estado
      })
    } else {
      setMaquinaForm({
        id: '',
        codigo: '',
        tipo: 'tejedora',
        marca_id: '',
        anio: new Date().getFullYear(),
        caracteristicas: '',
        estado: 'activa'
      })
    }
    setShowMaquinaModal(true)
  }

  const abrirMarcaModal = () => {
    setErrorEnvio(null)
    setMarcaForm({ id: '', nombre: '' })
    setShowMarcaModal(true)
  }

  useEffect(() => { cargarDatos() }, [cargarDatos])



  // ── GUARDAR NUEVA FALLA / REPORTE CRÍTICO ──────────────────────────────────
  const enviarReporteCritico = async () => {
    if (!reporteForm.maquina_id) { toast.error('Selecciona la máquina averiada'); return }

    if (!reporteForm.descripcion.trim()) { toast.error('Ingresa la descripción detallada del síntoma'); return }

    const maqObj = maquinas.find(m => m.id === reporteForm.maquina_id)
    if (maqObj) {
      const v = validarTransicionEstadoMaquina(maqObj.estado as any, 'malograda')
      if (!v.valido) {
        toast.error(`Error de transición: ${v.error}`)
        return
      }
    }

    setEnviandoReporte(true)
    const reportadoPorId = (await obtenerUsuarioActual())?.id ?? null

    // Una sola operación atómica: avería + máquina malograda + cierre del turno activo
    const { data, error } = await supabase.rpc('reportar_averia_maquina', {
      p_maquina_id: reporteForm.maquina_id,
      p_tipo_averia: reporteForm.tipo_averia,
      p_descripcion: `${maqObj?.codigo || ''}: ${reporteForm.descripcion.trim()}`,
      p_asignado_a: null,
      p_reportado_por_id: reportadoPorId
    })
    setEnviandoReporte(false)

    if (error) {
      toast.error(`No se pudo enviar el reporte: ${error.message}`)
      cargarDatos()
      return
    }

    if (data?.turnos_cerrados > 0) {
      toast.warning('Se cerró automáticamente el turno activo de la máquina y se liberó al operador.')
    }
    // El mecánico se asigna con su propia función (guarda su nombre en la falla)
    if (reporteForm.mecanico_id && data?.averia_id) {
      const { error: errAsig } = await supabase.rpc('asignar_mecanico_averia', { p_averia_id: data.averia_id, p_mecanico_id: reporteForm.mecanico_id })
      if (errAsig) toast.error(`La falla se reportó, pero no se pudo asignar el mecánico: ${errAsig.message}`)
    }
    toast.success(`Reporte crítico enviado para ${maqObj?.codigo || 'la máquina'}.`, { duration: 4000 })

    // Limpiar el formulario; cargarDatos preselecciona otra máquina reportable
    setReporteForm(prev => ({ ...prev, descripcion: '', maquina_id: '' }))
    cargarDatos()
  }


  // ── MECÁNICOS (no son usuarios) ──────────────────────────────────────────
  const guardarMecanico = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mecanicoForm) return
    const datos = { nombre: mecanicoForm.nombre.trim(), apellido: mecanicoForm.apellido.trim(), telefono: mecanicoForm.telefono.trim() }
    if (!datos.nombre || !datos.apellido || !datos.telefono) { toast.error('Completa nombre, apellido y teléfono'); return }
    setGuardandoMecanico(true)
    const { error } = mecanicoForm.id
      ? await supabase.from('mecanicos').update(datos).eq('id', mecanicoForm.id)
      : await supabase.from('mecanicos').insert({ ...datos, activo: true })
    setGuardandoMecanico(false)
    if (error) { toast.error(`No se pudo guardar el mecánico: ${error.message}`); return }
    toast.success(mecanicoForm.id ? 'Mecánico actualizado' : `Mecánico ${datos.nombre} ${datos.apellido} registrado`)
    setMecanicoForm(null)
    cargarDatos()
  }

  const cambiarActivoMecanico = async (m: Mecanico) => {
    const { error } = await supabase.from('mecanicos').update({ activo: !m.activo }).eq('id', m.id)
    if (error) { toast.error(`No se pudo actualizar: ${error.message}`); return }
    toast.success(m.activo ? `${nombreMecanico(m)} dado de baja` : `${nombreMecanico(m)} reactivado`)
    cargarDatos()
  }

  // Guardar Máquina CRUD
  const guardarMaquina = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorEnvio(null)
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
      const { error } = await supabase.from('maquinas').update(payload).eq('id', maquinaForm.id)
      if (error) {
        setErrorEnvio(error.message || JSON.stringify(error))
        toast.error(`Error al actualizar la máquina`)
        return
      }
      toast.success('Máquina actualizada')
    } else {
      const { error } = await supabase.from('maquinas').insert(payload)
      if (error) {
        setErrorEnvio(error.message || JSON.stringify(error))
        toast.error(`Error al registrar la máquina`)
        return
      }
      toast.success('Nueva máquina registrada')
    }

    setShowMaquinaModal(false)
    setMaquinaForm({ id: '', codigo: '', tipo: 'tejedora', marca_id: '', anio: new Date().getFullYear(), caracteristicas: '', estado: 'activa' })
    cargarDatos()
  }


  const guardarNuevaMarca = async () => {
    setErrorEnvio(null)
    if (!marcaForm.nombre.trim()) return
    const { error } = await supabase.from('marcas_maquinas').insert({ nombre: marcaForm.nombre.trim() })
    if (error) {
      setErrorEnvio(error.message || JSON.stringify(error))
      toast.error(`Error al registrar la marca`)
      return
    }
    toast.success('Marca creada')
    setShowMarcaModal(false)
    setMarcaForm({ id: '', nombre: '' })
    cargarDatos()
  }

  // Eliminar Máquina CRUD
  const eliminarMaquina = async (m: Maquina) => {
    if (!confirm(`¿Eliminar definitivamente la máquina ${m.codigo} (${m.tipo})?\n\nEsta acción removerá la máquina del inventario de planta.`)) {
      return
    }

    try {
      // 0. Con historial de mantenimiento preventivo no se borra (031): se avisa antes de tocar nada
      const { count: conHistorial, error: errHist } = await supabase.from('mantenimientos_preventivos')
        .select('id', { count: 'exact', head: true }).eq('maquina_id', m.id)
      if (errHist) { toast.error(`No se pudo comprobar el historial de ${m.codigo}: ${errHist.message}`); return }
      if ((conHistorial ?? 0) > 0) {
        toast.error(`No se puede eliminar ${m.codigo}: tiene historial de mantenimiento. Cámbiala a estado "inactiva" en su lugar.`)
        return
      }

      // 1. Limpiar posibles asignaciones vinculadas en disenos_maquinas
      const { error: errDisenos } = await supabase.from('disenos_maquinas').delete().eq('maquina_id', m.id)
      if (errDisenos) {
        toast.error(`No se pudieron quitar los diseños asignados a ${m.codigo}: ${errDisenos.message}`)
        return
      }

      // 2. Eliminar máquina en DB
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)
      let delErr = null
      if (isUuid) {
        const { error } = await supabase.from('maquinas').delete().eq('id', m.id)
        delErr = error
      } else {
        const { error } = await supabase.from('maquinas').delete().eq('codigo', m.codigo)
        delErr = error
      }

      if (delErr) {
        toast.error(delErr.code === '23503'
          ? `No se puede eliminar ${m.codigo}: tiene historial (fallas, producción o mantenimientos). Cámbiala a estado "inactiva" en su lugar.`
          : 'Error al eliminar máquina: ' + delErr.message)
        return
      }


      setMaquinas(prev => prev.filter(item => item.id !== m.id && item.codigo !== m.codigo))
      toast.success(`✅ Máquina ${m.codigo} eliminada correctamente`)
      cargarDatos()
    } catch (e: any) {
      toast.error('Error al eliminar máquina')
    }
  }



  // Filtrado en el monitor
  const averiasFiltradas = averiasTimeline.filter(a => {
    if (!busquedaMonitor.trim()) return true
    const term = busquedaMonitor.toLowerCase()
    return a.descripcion_operador.toLowerCase().includes(term) ||
           a.maquina?.codigo.toLowerCase().includes(term) ||
           (a.asignado_a && a.asignado_a.toLowerCase().includes(term))
  })

  // Tarjetas superiores: conteo real por estado (sin máquinas ficticias)
  const resumenEstado = (grupo: GrupoEstadoMaquina) => {
    const lista = filtrarMaquinasPorGrupo(maquinas, grupo)
    const codigos = lista.slice(0, 3).map(m => m.codigo).join(', ') + (lista.length > 3 ? ` +${lista.length - 3}` : '')
    return { total: lista.length, codigos, detalle: lista[0]?.detalle_estado || '' }
  }
  const resumenOperativas = resumenEstado('operativa')
  const resumenMalogradas = resumenEstado('falla')
  const resumenMantenimiento = resumenEstado('mantenimiento')
  const resumenStandby = resumenEstado('standby')
  const maquinasFiltradas = filtrarMaquinasPorGrupo(maquinas, filtroGrupo)
  const hoy = hoyLocal()
  const avisoPreventivo = (maquinaId: string) => {
    const e = estadoPreventivoMaquina(planes, maquinaId, hoy)
    if (!e) return <span className="text-slate-600 text-xs">—</span>
    const color = e === 'vencido' ? 'bg-red-500/20 text-red-300' : e === 'proximo' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
    return <span className={`badge text-[10px] ${color}`}>{ETIQUETA_ESTADO_PLAN[e]}</span>
  }
  const enlaceHistoria = (maquinaId: string, codigo: string) => (
    <Link href={`/dashboard/maquinas/${maquinaId}/historia`} className="text-xs text-indigo-300 inline-flex items-center gap-1" aria-label={`Historia de ${codigo}`}>
      <History className="w-3.5 h-3.5" /> Historia
    </Link>
  )
  const conPreventivoVencido = maquinas.filter(m => estadoPreventivoMaquina(planes, m.id, hoy) === 'vencido')

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
            <BuscadorConSugerencias placeholder="Buscar máquina o reporte..." value={busquedaMonitor} onChange={setBusquedaMonitor}
              sugerencias={sugerir(maquinas, busquedaMonitor, m => ({ id: m.id, etiqueta: m.codigo, detalle: [m.tipo, m.marca?.nombre].filter(Boolean).join(' · ') }), m => [m.codigo, m.tipo, m.marca?.nombre])}
              inputClassName="text-xs py-2 font-medium" />
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
            <button
              type="button"
              onClick={() => alternarFiltro('operativa')}
              aria-pressed={filtroGrupo === 'operativa'}
              title="Mostrar solo estas máquinas"
              className={`glass rounded-3xl p-5 border border-emerald-500/30 bg-emerald-500/[0.02] shadow-lg flex flex-col justify-between text-left cursor-pointer transition-all hover:brightness-125 ${filtroGrupo === 'operativa' ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <span className="badge bg-emerald-500/20 text-emerald-300 font-black text-[10px] uppercase tracking-wider">
                  OPERATIVA
                </span>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider truncate">{resumenOperativas.codigos || 'NINGUNA'}</p>
                <p className="text-xl font-black text-emerald-400 font-mono tracking-tight mt-0.5">
                  {resumenOperativas.total} MÁQUINA(S)
                </p>
              </div>
            </button>

            {/* 2. FALLA CRÍTICA */}
            <button
              type="button"
              onClick={() => alternarFiltro('falla')}
              aria-pressed={filtroGrupo === 'falla'}
              title="Mostrar solo estas máquinas"
              className={`glass rounded-3xl p-5 border border-red-500/40 bg-red-500/[0.04] shadow-lg flex flex-col justify-between text-left cursor-pointer transition-all hover:brightness-125 ${filtroGrupo === 'falla' ? 'ring-2 ring-red-400' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <span className="badge bg-red-500/20 text-red-300 font-black text-[10px] uppercase tracking-wider">
                  FALLA CRÍTICA
                </span>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider truncate">{resumenMalogradas.codigos || 'NINGUNA'}</p>
                <p className="text-lg font-black text-red-400 tracking-tight mt-0.5 uppercase">
                  {resumenMalogradas.total === 0 ? 'SIN FALLAS' : resumenMalogradas.total === 1 ? (resumenMalogradas.detalle || '1 MÁQUINA') : `${resumenMalogradas.total} MÁQUINAS`}
                </p>
              </div>
            </button>

            {/* 3. MANTENIMIENTO */}
            <button
              type="button"
              onClick={() => alternarFiltro('mantenimiento')}
              aria-pressed={filtroGrupo === 'mantenimiento'}
              title="Mostrar solo estas máquinas"
              className={`glass rounded-3xl p-5 border border-cyan-500/30 bg-cyan-500/[0.02] shadow-lg flex flex-col justify-between text-left cursor-pointer transition-all hover:brightness-125 ${filtroGrupo === 'mantenimiento' ? 'ring-2 ring-cyan-400' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                  <Wrench className="w-5 h-5" />
                </div>
                <span className="badge bg-cyan-500/20 text-cyan-300 font-black text-[10px] uppercase tracking-wider">
                  MANTENIMIENTO
                </span>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider truncate">{resumenMantenimiento.codigos || 'NINGUNA'}</p>
                <p className="text-lg font-black text-cyan-300 tracking-tight mt-0.5 uppercase">
                  {resumenMantenimiento.total === 0 ? 'SIN MANTENIMIENTOS' : `${resumenMantenimiento.total} MÁQUINA(S)`}
                </p>
              </div>
            </button>

            {/* 4. STAND-BY */}
            <button
              type="button"
              onClick={() => alternarFiltro('standby')}
              aria-pressed={filtroGrupo === 'standby'}
              title="Mostrar solo estas máquinas"
              className={`glass rounded-3xl p-5 border border-slate-700 bg-slate-800/40 shadow-lg flex flex-col justify-between text-left cursor-pointer transition-all hover:brightness-125 ${filtroGrupo === 'standby' ? 'ring-2 ring-slate-300' : ''}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center">
                  <PauseCircle className="w-5 h-5" />
                </div>
                <span className="badge bg-slate-700 text-slate-300 font-black text-[10px] uppercase tracking-wider">
                  STAND-BY
                </span>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider truncate">{resumenStandby.codigos || 'NINGUNA'}</p>
                <p className="text-lg font-black text-slate-300 tracking-tight mt-0.5 uppercase">
                  {resumenStandby.total === 0 ? 'SIN MÁQUINAS' : `${resumenStandby.total} MÁQUINA(S)`}
                </p>
              </div>
            </button>
          </div>

          {conPreventivoVencido.length > 0 && (
            <div className="glass rounded-2xl p-4 border border-red-500/30 flex flex-wrap items-center gap-3" data-testid="aviso-preventivo-vencido">
              <Wrench className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-300">Mantenimiento preventivo vencido:</span>
              {conPreventivoVencido.map(m => <code key={m.id} className="text-amber-300 font-mono text-xs">{m.codigo}</code>)}
              <Link href="/dashboard/mantenimiento" className="text-xs text-cyan-300 ml-auto">Ir a Mantenimiento → Preventivo</Link>
            </div>
          )}

          {/* ── LISTA FILTRADA POR TARJETA ─────────────────────────────────────── */}
          {filtroGrupo && (
            <div className="glass rounded-3xl p-5 border border-white/[0.08] space-y-3 animate-fadeIn" data-testid="maquinas-filtradas">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-black text-white uppercase tracking-wider">
                  Máquinas: {GRUPOS_ESTADO_MAQUINA[filtroGrupo].label} ({maquinasFiltradas.length})
                </h2>
                <button type="button" onClick={() => setFiltroGrupo(null)} className="btn-secondary text-xs py-1.5 px-3">
                  <X className="w-3.5 h-3.5" /> Ver todas
                </button>
              </div>
              {maquinasFiltradas.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No hay máquinas en este estado.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                  <table className="table-dark">
                    <thead>
                      <tr><th>Código</th><th>Tipo</th><th>Marca</th><th>Estado</th><th>Detalle</th><th>Preventivo</th><th>Historia</th></tr>
                    </thead>
                    <tbody>
                      {maquinasFiltradas.map(m => (
                        <tr key={m.id}>
                          <td><code className="text-cyan-300 font-mono font-bold text-xs">{m.codigo}</code></td>
                          <td className="capitalize text-slate-300">{m.tipo}</td>
                          <td className="text-white font-medium">{m.marca?.nombre || '—'}</td>
                          <td>
                            <span className={`badge ${ESTADOS_MAQUINA_VALIDOS[m.estado as EstadoMaquina]?.badge ?? 'badge-warning'}`}>
                              {ESTADOS_MAQUINA_VALIDOS[m.estado as EstadoMaquina]?.label ?? m.estado}
                            </span>
                          </td>
                          <td className="text-slate-400 text-xs">{m.detalle_estado || '—'}</td>
                          <td>{avisoPreventivo(m.id)}</td>
                          <td>{enlaceHistoria(m.id, m.codigo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

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
                    <CustomSelect
                      value={reporteForm.maquina_id}
                      onChange={val => setReporteForm({ ...reporteForm, maquina_id: val })}
                      options={maquinas.map(m => ({
                        value: m.id,
                        label: `${m.codigo} (${m.marca?.nombre || m.tipo}) — ${m.estado.toUpperCase()}`
                      }))}
                      triggerClassName="text-xs font-bold"
                    />
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

                  {/* ASIGNAR MECÁNICO */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      ASIGNAR MECÁNICO
                    </label>
                    <CustomSelect
                      value={reporteForm.mecanico_id}
                      onChange={val => setReporteForm({ ...reporteForm, mecanico_id: val })}
                      options={[
                        { value: '', label: 'Sin asignación inmediata' },
                        ...mecanicosActivos.map(m => ({ value: m.id, label: `${nombreMecanico(m)} · ${m.telefono}` }))
                      ]}
                      triggerClassName="text-xs font-semibold text-cyan-300 border-cyan-500/30"
                    />
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
                  <Link href="/dashboard/mantenimiento" className="text-xs font-bold text-cyan-400 hover:underline flex items-center gap-1 uppercase tracking-wider">
                    VER HISTORIAL COMPLETO ➔
                  </Link>
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
                            {formatearFecha(a.fecha_reporte)}
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
                            Asignado a: <strong className="text-slate-200">{a.asignado_a || 'Sin asignar'}</strong>
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* MECÁNICOS: registro propio, no son usuarios (Fase 3) */}
              <div className="glass p-6 rounded-3xl border border-white/[0.08] shadow-xl">
                <div className="flex items-center justify-between gap-2 mb-4 pb-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-pink-400" />
                    <h2 className="text-base font-black text-white uppercase tracking-wider">MECÁNICOS</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMecanicoForm({ id: '', nombre: '', apellido: '', telefono: '' })}
                    className="btn-primary text-[10px] py-1.5 px-3 rounded-xl flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Añadir mecánico
                  </button>
                </div>

                {mecanicoForm && (
                  <form onSubmit={guardarMecanico} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-4 p-3 rounded-2xl bg-slate-900/60 border border-cyan-500/20">
                    <input aria-label="Nombre del mecánico" placeholder="Nombre" value={mecanicoForm.nombre} onChange={e => setMecanicoForm({ ...mecanicoForm, nombre: e.target.value })} className="input-dark text-xs" />
                    <input aria-label="Apellido del mecánico" placeholder="Apellido" value={mecanicoForm.apellido} onChange={e => setMecanicoForm({ ...mecanicoForm, apellido: e.target.value })} className="input-dark text-xs" />
                    <input aria-label="Teléfono del mecánico" placeholder="Teléfono" inputMode="tel" value={mecanicoForm.telefono} onChange={e => setMecanicoForm({ ...mecanicoForm, telefono: e.target.value })} className="input-dark text-xs" />
                    <div className="flex gap-2">
                      <button type="submit" disabled={guardandoMecanico} className="btn-primary text-xs flex-1 justify-center">
                        {guardandoMecanico ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Guardar
                      </button>
                      <button type="button" onClick={() => setMecanicoForm(null)} className="btn-secondary text-xs" aria-label="Cancelar">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </form>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {mecanicos.length === 0 ? (
                    <p className="text-slate-500 text-xs col-span-2 text-center py-4">No hay mecánicos registrados. Añade el primero.</p>
                  ) : mecanicos.map(m => (
                    <div key={m.id} className={`p-4 rounded-2xl bg-slate-900/60 border border-white/[0.06] flex items-center justify-between gap-3 ${m.activo ? '' : 'opacity-50'}`}>
                      <div>
                        <p className="font-bold text-white text-xs uppercase">{nombreMecanico(m)}</p>
                        <a href={`tel:${m.telefono}`} className="text-[10px] font-mono text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3" /> {m.telefono}
                        </a>
                        {!m.activo && <span className="badge text-[9px] bg-slate-700 text-slate-300 mt-1">DADO DE BAJA</span>}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <button type="button" onClick={() => setMecanicoForm({ id: m.id, nombre: m.nombre, apellido: m.apellido, telefono: m.telefono })}
                          className="text-[10px] text-cyan-300 flex items-center gap-1" aria-label={`Editar ${nombreMecanico(m)}`}>
                          <Edit2 className="w-3 h-3" /> Editar
                        </button>
                        <button type="button" onClick={() => cambiarActivoMecanico(m)}
                          className={`text-[10px] flex items-center gap-1 ${m.activo ? 'text-red-300' : 'text-emerald-300'}`}>
                          {m.activo ? <><Trash2 className="w-3 h-3" /> Dar de baja</> : <><Check className="w-3 h-3" /> Reactivar</>}
                        </button>
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
              <button onClick={abrirMarcaModal} className="btn-secondary text-xs py-2">
                <Plus className="w-4 h-4" /> Nueva Marca
              </button>
              <button onClick={() => abrirMaquinaModal()} className="btn-primary text-xs py-2 bg-cyan-600 border-none">
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
                  <th>Preventivo</th>
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
                    <td>{avisoPreventivo(m.id)}</td>
                    <td className="text-right space-x-2">
                      {enlaceHistoria(m.id, m.codigo)}
                      <button
                        onClick={() => abrirMaquinaModal(m)}
                        className="btn-secondary py-1 px-2.5 text-xs hover:border-cyan-500/50 text-slate-300 hover:text-white"
                        title="Editar Máquina"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => eliminarMaquina(m)}
                        className="btn-secondary py-1 px-2.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
                        title="Eliminar Máquina"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
      <Modal
        open={showMaquinaModal}
        onClose={() => setShowMaquinaModal(false)}
        title={maquinaForm.id ? 'Editar Máquina' : 'Registrar Nueva Máquina'}
        maxWidth="md"
      >
        <form onSubmit={guardarMaquina} className="space-y-4 text-xs">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Código de Máquina *</label>
            <input type="text" placeholder="Ej. M01" value={maquinaForm.codigo} onChange={e => setMaquinaForm({ ...maquinaForm, codigo: e.target.value })} className="input-dark w-full font-mono font-bold" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Tipo</label>
              <CustomSelect
                value={maquinaForm.tipo}
                onChange={val => setMaquinaForm({ ...maquinaForm, tipo: val })}
                options={[
                  { value: 'tejedora', label: 'Tejedora' },
                  { value: 'remalladora', label: 'Remalladora' },
                  { value: 'planchadora', label: 'Planchadora' }
                ]}
                triggerClassName="font-bold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Marca *</label>
              <CustomSelect
                value={maquinaForm.marca_id}
                onChange={val => setMaquinaForm({ ...maquinaForm, marca_id: val })}
                options={[
                  { value: '', label: 'Selecciona...' },
                  ...marcas.map(m => ({ value: m.id, label: m.nombre }))
                ]}
                placeholder="Selecciona..."
                triggerClassName="font-bold"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Características</label>
            <textarea rows={2} placeholder="Descripción técnica..." value={maquinaForm.caracteristicas} onChange={e => setMaquinaForm({ ...maquinaForm, caracteristicas: e.target.value })} className="input-dark w-full" />
          </div>
          {errorEnvio && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-2xl font-bold flex flex-col gap-1 text-[11px] mb-3 animate-fadeInUp">
              <span>⚠️ ERROR DE BASE DE DATOS:</span>
              <span className="font-mono font-medium whitespace-pre-wrap">{errorEnvio}</span>
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={() => setShowMaquinaModal(false)} className="btn-secondary flex-1 justify-center py-2">Cancelar</button>
            <button type="submit" className="btn-primary flex-1 justify-center py-2 bg-cyan-600 border-none font-bold">Guardar</button>
          </div>
        </form>
      </Modal>

      {/* MODAL NUEVA MARCA */}
      <Modal
        open={showMarcaModal}
        onClose={() => setShowMarcaModal(false)}
        title="Nueva Marca de Máquina"
        maxWidth="sm"
      >
        <div className="text-xs">
          <input type="text" placeholder="Ej. Rosso / Angies" value={marcaForm.nombre} onChange={e => setMarcaForm({ ...marcaForm, nombre: e.target.value })} className="input-dark w-full mb-6 font-bold" />
          {errorEnvio && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-2xl font-bold flex flex-col gap-1 text-[11px] mb-4 animate-fadeInUp">
              <span>⚠️ ERROR DE BASE DE DATOS:</span>
              <span className="font-mono font-medium whitespace-pre-wrap">{errorEnvio}</span>
            </div>
          )}
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
      </Modal>


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
