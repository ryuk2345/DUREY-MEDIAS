// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatearFecha } from '@/lib/utils'
import { listarUsuarios, actualizarEstadoUsuario } from '@/lib/api/usuarios'
import {
  Layers, Plus, Search, CheckCircle, Clock, ChevronDown, X,
  Loader2, AlertTriangle, Cpu, Play, Pause, Activity, User, Wrench,
  CheckCircle2, Sparkles, Filter, TrendingUp, ShieldAlert
} from 'lucide-react'
import { toast } from 'sonner'
import { validarTransicionEstadoMaquina } from '@/lib/domain/machines'
import CustomSelect from '@/components/ui/CustomSelect'


interface Marca { id: string; nombre: string }
interface Maquina {
  id: string
  codigo: string
  marca_id: string
  tipo: string
  estado: string // 'activa', 'ocupada', 'mantenimiento'
  caracteristicas?: string
  marca?: { id: string; nombre: string }
}
interface Tejedor { id: string; nombre: string }
interface CatalogoMedia { id: string; codigo: string; modelo: string; publico: string; talla: string }
interface TurnoMaquina { maquina_id: string; catalogo_media_id: string }
interface Turno {
  id: string
  fecha: string
  horario: string
  duracion_horas: number
  estado: string
  tejedor_id: string
  tejedor: { nombre: string }
  turno_maquinas: TurnoMaquina[]
}

export default function ProduccionTejidoPage() {
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [tejedores, setTejedores] = useState<Tejedor[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros de búsqueda
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMarcaFilter, setSelectedMarcaFilter] = useState('todas')
  const [selectedEstadoFilter, setSelectedEstadoFilter] = useState('todos')

  // Formulario lateral de "Carga de Lote por Marca"
  const [cargaForm, setCargaForm] = useState({
    marca_id: '',
    tejedor_id: '',
    horario: 'dia',
    duracion_horas: '12',
    maquinas_seleccionadas: {} as Record<string, string> // maquina_id -> catalogo_media_id
  })

  // Modal para Registro de Producción
  const [showReporteModal, setShowReporteModal] = useState(false)
  const [turnoSeleccionado, setTurnoSeleccionado] = useState<Turno | null>(null)
  const [reporte, setReporte] = useState<Record<string, string>>({})

  const supabase = createClient()

  // ── CARGAR DATOS EN TIEMPO REAL / MOCK ────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [mar, maq, cat, tur] = await Promise.all([
      supabase.from('marcas_maquinas').select('id, nombre').order('nombre'),
      supabase.from('maquinas').select(`
        id, codigo, marca_id, tipo, estado, caracteristicas,
        marca:marcas_maquinas(id, nombre)
      `).eq('tipo', 'tejedora').order('codigo'),
      supabase.from('catalogo_medias').select('id, codigo, modelo, publico, talla').eq('estado', 'activo').order('codigo'),
      supabase.from('turnos_produccion').select(`
        id, fecha, horario, duracion_horas, estado, tejedor_id,
        tejedor:usuarios(nombre),
        turno_maquinas(maquina_id, catalogo_media_id)
      `).eq('estado', 'activo').order('created_at', { ascending: false })
    ])

    if (mar.error) {
      toast.error(`Error cargando marcas: ${mar.error.message}`)
    }
    if (maq.error) {
      toast.error(`Error cargando máquinas: ${maq.error.message}`)
    }
    if (cat.error) {
      toast.error(`Error cargando catálogo: ${cat.error.message}`)
    }
    if (tur.error) {
      toast.error(`Error cargando turnos: ${tur.error.message}`)
    }

    const hoy = new Date().toISOString().split('T')[0]
    const [tejedoresData, asigRes] = await Promise.all([
      listarUsuarios({ rol: 'tejedor', campos: 'id,nombre,estado' }),
      supabase.from('asignaciones_turno').select('operador_id, operador:usuarios(id, nombre, estado)').eq('area', 'tejido').eq('fecha', hoy)
    ])
    // Adapter: listarUsuarios retorna array directo (no { data, error })
    const espRes = { data: tejedoresData, error: null }

    const mapaTejedores = new Map<string, { id: string; nombre: string; estado?: string }>()
    if (espRes.data) {
      espRes.data.forEach((u: any) => mapaTejedores.set(u.id, u))
    }
    if (asigRes.data) {
      asigRes.data.forEach((a: any) => {
        if (a.operador) {
          mapaTejedores.set(a.operador.id, a.operador)
        }
      })
    }

    const tejedoresList = Array.from(mapaTejedores.values())

    setMarcas(mar.data ?? [])
    setMaquinas((maq.data ?? []) as Maquina[])
    setTejedores(tejedoresList)
    setCatalogo(cat.data ?? [])
    setTurnos((tur.data ?? []) as Turno[])
    setLoading(false)
  }, [supabase])


  useEffect(() => { cargarDatos() }, [cargarDatos])

  // ── MAPA DE ESTADO DE MÁQUINAS CON SU TEJEDOR Y TURNO ──────────────────────
  const maquinasEstadoMap = useMemo(() => {
    const map = new Map<string, {
      turnoId: string | null
      tejedorNombre: string
      catalogoMediaCodigo: string
      catalogoMediaId: string
      horario: string
      duracion: number
    }>()

    turnos.forEach(t => {
      t.turno_maquinas?.forEach(tm => {
        const cat = catalogo.find(c => c.id === tm.catalogo_media_id)
        map.set(tm.maquina_id, {
          turnoId: t.id,
          tejedorNombre: t.tejedor?.nombre || 'Tejedor',
          catalogoMediaCodigo: cat?.codigo || 'Media estándar',
          catalogoMediaId: tm.catalogo_media_id,
          horario: t.horario,
          duracion: t.duracion_horas,
        })
      })
    })

    return map
  }, [turnos, catalogo])

  // Máquinas filtradas de la grilla principal
  const maquinasFiltradas = useMemo(() => {
    return maquinas.filter(m => {
      // Filtro por marca
      if (selectedMarcaFilter !== 'todas' && m.marca_id !== selectedMarcaFilter) {
        return false
      }
      // Filtro por estado
      if (selectedEstadoFilter === 'en_marcha' && m.estado !== 'ocupada') return false
      if (selectedEstadoFilter === 'disponibles' && m.estado !== 'activa') return false
      if (selectedEstadoFilter === 'mantenimiento' && m.estado !== 'mantenimiento') return false

      // Búsqueda por texto (código de máquina o tejedor)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const info = maquinasEstadoMap.get(m.id)
        const matchCodigo = m.codigo.toLowerCase().includes(q)
        const matchTejedor = info?.tejedorNombre.toLowerCase().includes(q)
        const matchMedia = info?.catalogoMediaCodigo.toLowerCase().includes(q)
        const matchMarca = m.marca?.nombre?.toLowerCase().includes(q)
        if (!matchCodigo && !matchTejedor && !matchMedia && !matchMarca) return false
      }

      return true
    })
  }, [maquinas, selectedMarcaFilter, selectedEstadoFilter, searchQuery, maquinasEstadoMap])

  // Máquinas disponibles de la marca seleccionada en la Carga de Lote
  const maquinasDisponiblesPorMarca = useMemo(() => {
    if (!cargaForm.marca_id) return []
    return maquinas.filter(m => m.marca_id === cargaForm.marca_id && m.estado === 'activa')
  }, [maquinas, cargaForm.marca_id])

  // Conteos para los badges del KPI
  const countActivas = maquinas.filter(m => m.estado === 'ocupada').length
  const countDisponibles = maquinas.filter(m => m.estado === 'activa').length
  const countMantenimiento = maquinas.filter(m => m.estado === 'mantenimiento').length

  // ── MANEJADOR DE CAMBIO DE MARCA EN LA CARGA DE LOTE ──────────────────────
  const handleMarcaChange = (marcaId: string) => {
    setCargaForm(prev => ({
      ...prev,
      marca_id: marcaId,
      maquinas_seleccionadas: {} // reset selecciones previas
    }))
  }

  const toggleMaquinaSeleccionada = (maquinaId: string) => {
    setCargaForm(prev => {
      const next = { ...prev.maquinas_seleccionadas }
      if (next[maquinaId] !== undefined) {
        delete next[maquinaId]
      } else {
        // Pre-seleccionar el primer código del catálogo si existe
        next[maquinaId] = catalogo[0]?.id || ''
      }
      return { ...prev, maquinas_seleccionadas: next }
    })
  }

  const updateMediaParaMaquina = (maquinaId: string, mediaId: string) => {
    setCargaForm(prev => ({
      ...prev,
      maquinas_seleccionadas: {
        ...prev.maquinas_seleccionadas,
        [maquinaId]: mediaId
      }
    }))
  }

  // ── CREAR TURNO POR MARCA ─────────────────────────────────────────────────
  const ejecutarCargaDeLote = async () => {
    const { marca_id, tejedor_id, horario, duracion_horas, maquinas_seleccionadas } = cargaForm
    const maquinaIds = Object.keys(maquinas_seleccionadas)

    if (!marca_id) {
      toast.error('Selecciona una Marca de Máquina')
      return
    }
    if (!tejedor_id) {
      toast.error('Selecciona un Operador de Turno (Tejedor Encargado)')
      return
    }
    if (maquinaIds.length === 0) {
      toast.error('Selecciona al menos una máquina disponible de la marca para cargar')
      return
    }

    const algunaSinMedia = maquinaIds.some(id => !maquinas_seleccionadas[id])
    if (algunaSinMedia) {
      toast.error('Asigna el código de media a todas las máquinas seleccionadas')
      return
    }

    // Validar transiciones de estado de las máquinas a 'ocupada'
    for (const mId of maquinaIds) {
      const maq = maquinas.find(m => m.id === mId)
      if (maq) {
        const v = validarTransicionEstadoMaquina(maq.estado as any, 'ocupada')
        if (!v.valido) {
          toast.error(`Error en máquina ${maq.codigo}: ${v.error}`)
          return
        }
      }
    }

    // --- VALIDACIÓN DE MATERIA PRIMA (HILO) ---
    const mediaIdsToCheck = maquinaIds.map(id => maquinas_seleccionadas[id])
    const { data: mediasInfo, error: mediaErr } = await supabase
      .from('catalogo_medias')
      .select('id, codigo, peso_docena_g, materia_prima_id, materia_prima:materia_prima(material, color, stock_kg)')
      .in('id', mediaIdsToCheck)

    if (mediaErr) {
      toast.error(`Error al validar materia prima: ${mediaErr.message}`)
      return
    }

    const yarnRequirements: Record<string, { material: string; color: string; needed: number; stock: number }> = {}
    for (const tm of mediaIdsToCheck) {
      const mInfo = mediasInfo?.find(m => m.id === tm)
      if (mInfo && mInfo.materia_prima_id) {
        const weightNeededKg = (15 * (Number(mInfo.peso_docena_g) || 360.00)) / 1000
        const yKey = mInfo.materia_prima_id
        if (!yarnRequirements[yKey]) {
          yarnRequirements[yKey] = {
            material: (mInfo.materia_prima as any)?.material || 'Algodón',
            color: (mInfo.materia_prima as any)?.color || 'Blanco',
            needed: 0,
            stock: Number((mInfo.materia_prima as any)?.stock_kg || 0)
          }
        }
        yarnRequirements[yKey].needed += weightNeededKg
      }
    }

    for (const yKey of Object.keys(yarnRequirements)) {
      const req = yarnRequirements[yKey]
      if (req.stock < req.needed) {
        toast.error(`⚠️ Alerta: Falta de materia prima. Se requieren ${req.needed.toFixed(2)} Kg de ${req.material} ${req.color} pero solo quedan ${req.stock.toFixed(2)} Kg.`)
        return
      }
    }

    // 1. Crear el turno de producción en DB
    const { data: nuevoTurno, error: tErr } = await supabase.from('turnos_produccion').insert({
      tejedor_id,
      horario,
      duracion_horas: parseInt(duracion_horas),
      estado: 'activo',
      fecha: new Date().toISOString().split('T')[0]
    }).select().single()

    if (tErr || !nuevoTurno) {
      toast.error('Error al iniciar el turno de tejido')
      return
    }

    // --- DESCONTAR STOCK DE HILO Y REGISTRAR CONSUMO ---
    for (const yKey of Object.keys(yarnRequirements)) {
      const req = yarnRequirements[yKey]
      const newStock = req.stock - req.needed
      
      const { error: stockErr } = await supabase
        .from('materia_prima')
        .update({ stock_kg: newStock })
        .eq('id', yKey)
      
      if (stockErr) {
        toast.error(`Error al descontar stock de materia prima: ${stockErr.message}`)
        return
      }

      const { error: movErr } = await supabase
        .from('movimientos_materia_prima')
        .insert({
          materia_prima_id: yKey,
          tipo: 'consumo_produccion',
          cantidad_kg: req.needed,
          referencia_id: nuevoTurno.id
        })

      if (movErr) {
        toast.error(`Error al registrar movimiento de consumo: ${movErr.message}`)
        return
      }
    }


    // 2. Insertar las asignaciones de máquina-media
    const asignaciones = maquinaIds.map(id => ({
      turno_id: nuevoTurno.id,
      maquina_id: id,
      catalogo_media_id: maquinas_seleccionadas[id]
    }))

    const { error: asigErr } = await supabase.from('turno_maquinas').insert(asignaciones)
    if (asigErr) {
      toast.error(`Error al registrar asignaciones de máquinas: ${asigErr.message}`)
      return
    }

    // 3. Marcar las máquinas de esa marca como ocupadas
    const { error: maqErr } = await supabase.from('maquinas').update({ estado: 'ocupada' }).in('id', maquinaIds)
    if (maqErr) {
      toast.error(`Error al actualizar estado de las máquinas: ${maqErr.message}`)
      return
    }

    // 4. Marcar al tejedor como ocupado
    try {
      await actualizarEstadoUsuario(tejedor_id, 'ocupada')
    } catch (tejErr: any) {
      toast.error(`Error al actualizar estado de operario tejedor: ${tejErr.message}`)
      return
    }

    toast.success(`✅ Lote cargado. ${maquinaIds.length} máquinas en marcha para el turno.`)
    setCargaForm({
      marca_id: '',
      tejedor_id: '',
      horario: 'dia',
      duracion_horas: '12',
      maquinas_seleccionadas: {}
    })
    cargarDatos()
  }

  // ── REGISTRAR PRODUCCIÓN (DESDE TARJETA O MODAL) ──────────────────────────
  const abrirReporteParaMaquina = (maquina: Maquina) => {
    const info = maquinasEstadoMap.get(maquina.id)
    if (!info) return
    const turno = turnos.find(t => t.id === info.turnoId)
    if (turno) {
      setTurnoSeleccionado(turno)
      const initialRep: Record<string, string> = {}
      turno.turno_maquinas?.forEach(tm => { initialRep[tm.maquina_id] = '' })
      setReporte(initialRep)
      setShowReporteModal(true)
    }
  }

  const enviarReporteProduccion = async () => {
    if (!turnoSeleccionado) return

    // Validar transición de las máquinas a 'activa'
    const mIds = turnoSeleccionado.turno_maquinas.map(tm => tm.maquina_id)
    for (const mId of mIds) {
      const maq = maquinas.find(m => m.id === mId)
      if (maq) {
        const v = validarTransicionEstadoMaquina(maq.estado as any, 'activa')
        if (!v.valido) {
          toast.error(`Error en máquina ${maq.codigo}: ${v.error}`)
          return
        }
      }
    }

    const items = turnoSeleccionado.turno_maquinas.map(tm => ({
      turno_id: turnoSeleccionado.id,
      maquina_id: tm.maquina_id,
      catalogo_media_id: tm.catalogo_media_id,
      docenas_producidas: parseFloat(reporte[tm.maquina_id] ?? '0') || 0,
      fecha: new Date().toISOString().split('T')[0],
    }))

    const { error: rErr } = await supabase.from('reportes_produccion').insert(items)
    if (rErr) { toast.error('Error al guardar reporte de producción'); return }

    // Liberar turno y máquinas
    await supabase.from('turnos_produccion').update({ estado: 'cerrado' }).eq('id', turnoSeleccionado.id)
    await supabase.from('maquinas').update({ estado: 'activa' }).in('id', mIds)

    // Liberar al tejedor
    if (turnoSeleccionado.tejedor_id) {
      await actualizarEstadoUsuario(turnoSeleccionado.tejedor_id, 'disponible').catch(() => {})
    }

    toast.success('🎉 Producción registrada correctamente.')
    setShowReporteModal(false)
    cargarDatos()
  }


  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── BARRA SUPERIOR E INFORMACIÓN DEL ÁREA DE TEJIDO ─────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">Monitor de Producción</h1>
              <p className="text-slate-400 text-xs font-medium">Control de máquinas tejedoras en tiempo real por marca y operador</p>
            </div>
          </div>
        </div>

        {/* Badges de conteo de estado */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{countActivas} En Marcha</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span>{countMantenimiento} Mantenimiento</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
            <span>{countDisponibles} Libres</span>
          </div>
        </div>
      </div>

      {/* ── BARRA DE FILTROS Y BÚSQUEDA ────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Buscador */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar máquina o tejedor..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="input-dark pl-10 text-xs rounded-xl w-full"
          />
        </div>

        {/* Filtros por Marca y Estado */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-slate-900/60 p-1 rounded-2xl border border-white/[0.06] text-xs">
            <span className="text-slate-400 font-semibold px-3 py-1">Marca:</span>
            <CustomSelect
              value={selectedMarcaFilter}
              onChange={val => setSelectedMarcaFilter(val)}
              options={[
                { value: 'todas', label: `Todas las marcas (${marcas.length})` },
                ...marcas.map(m => ({ value: m.id, label: m.nombre }))
              ]}
              triggerClassName="bg-transparent border-none text-xs py-1"
            />
          </div>

          <div className="flex items-center gap-2 bg-slate-900/60 p-1 rounded-2xl border border-white/[0.06] text-xs">
            <span className="text-slate-400 font-semibold px-3 py-1">Estado:</span>
            <CustomSelect
              value={selectedEstadoFilter}
              onChange={val => setSelectedEstadoFilter(val)}
              options={[
                { value: 'todos', label: 'Todos los estados' },
                { value: 'en_marcha', label: 'En Marcha' },
                { value: 'disponibles', label: 'Libres' },
                { value: 'mantenimiento', label: 'Mantenimiento' }
              ]}
              triggerClassName="bg-transparent border-none text-xs py-1"
            />
          </div>
        </div>
      </div>

      {/* ── CONTENIDO PRINCIPAL EN 2 COLUMNAS (MONITOR GRID + CARGA DE LOTE) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── COLUMNA IZQUIERDA (2 COLS): GRID DE MÁQUINAS (MONITOR) ─────────── */}
        <div className="lg:col-span-2 space-y-4">

          {loading ? (
            <div className="flex justify-center items-center py-24 glass rounded-3xl">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            </div>
          ) : maquinasFiltradas.length === 0 ? (
            <div className="glass rounded-3xl flex flex-col items-center justify-center py-20 text-slate-500 border border-dashed border-white/10">
              <Cpu className="w-12 h-12 mb-3 opacity-20" />
              <p className="font-semibold text-sm">No se encontraron máquinas tejedoras</p>
              <p className="text-xs text-slate-600 mt-1">Prueba cambiando los filtros de marca o búsqueda</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {maquinasFiltradas.map(m => {
                const info = maquinasEstadoMap.get(m.id)
                const isEnMarcha = m.estado === 'ocupada'
                const isMantenimiento = m.estado === 'mantenimiento'

                return (
                  <div
                    key={m.id}
                    className={`glass rounded-2xl p-4 border transition-all duration-300 relative flex flex-col justify-between ${
                      isEnMarcha
                        ? 'border-emerald-500/30 bg-emerald-500/[0.02] shadow-lg shadow-emerald-500/5'
                        : isMantenimiento
                        ? 'border-amber-500/30 bg-amber-500/[0.02]'
                        : 'border-white/[0.08] hover:border-blue-400/40'
                    }`}
                  >
                    {/* Header de la Tarjeta */}
                    <div>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-lg text-white font-mono">{m.codigo}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/10 text-slate-300 font-semibold">
                              {m.marca?.nombre || 'Marca'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <User className="w-3 h-3 text-slate-500" />
                            {info ? info.tejedorNombre : 'Sin Encargado'}
                          </p>
                        </div>

                        {/* Badge de Estado */}
                        <div>
                          {isEnMarcha ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              EN MARCHA
                            </span>
                          ) : isMantenimiento ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              <Wrench className="w-3 h-3" />
                              ALERTA
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              LIBRE
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Código de media tejiéndose */}
                      <div className="mt-3 p-2.5 rounded-xl bg-slate-900/60 border border-white/[0.05]">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">
                          {isEnMarcha ? 'Tejiendo producto:' : 'Especificación:'}
                        </p>
                        <p className="text-xs font-mono font-medium text-slate-200 truncate">
                          {info ? info.catalogoMediaCodigo : (m.caracteristicas || 'Disponible para cargar')}
                        </p>
                      </div>
                    </div>

                    {/* Acciones de la Tarjeta */}
                    <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      {isEnMarcha ? (
                        <>
                          <button
                            onClick={() => abrirReporteParaMaquina(m)}
                            className="btn-primary flex-1 justify-center text-xs py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white border-none shadow-md shadow-emerald-600/20"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Registrar Producción
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setCargaForm(f => ({ ...f, marca_id: m.marca_id }))}
                          className="btn-secondary flex-1 justify-center text-xs py-1.5 text-blue-300 hover:text-white border-blue-500/20 hover:border-blue-500/40"
                        >
                          <Play className="w-3.5 h-3.5 text-blue-400" />
                          Iniciar Lote
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── COLUMNA DERECHA (1 COL): PANEL CARGA DE LOTE POR MARCA Y OEE ─────── */}
        <div className="space-y-6">

          {/* Formulario Carga de Lote */}
          <div className="glass rounded-3xl p-6 border border-blue-500/20 shadow-xl bg-blue-500/[0.02]">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/[0.08]">
              <Sparkles className="w-5 h-5 text-blue-400" />
              <h2 className="text-base font-bold text-white">Carga de Lote por Marca</h2>
            </div>

            <div className="space-y-4 text-xs">
              {/* 1. Selector de Marca de Máquina */}
              <div>
                <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Marca de Máquina
                </label>
                <CustomSelect
                  value={cargaForm.marca_id}
                  onChange={val => handleMarcaChange(val)}
                  options={[
                    { value: '', label: 'Seleccionar marca de máquina...' },
                    ...marcas.map(m => ({ value: m.id, label: m.nombre }))
                  ]}
                  triggerClassName="text-xs font-medium"
                  placeholder="Seleccionar marca de máquina..."
                />
              </div>

              {/* 2. Selector de Operador de Turno (Tejedor) */}
              <div>
                <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                  Operador de Turno (Encargado)
                </label>
                <CustomSelect
                  value={cargaForm.tejedor_id}
                  onChange={val => setCargaForm({ ...cargaForm, tejedor_id: val })}
                  options={
                    tejedores.length === 0
                      ? [{ value: '', label: '⚠️ No hay tejedores asignados a esta área hoy — pide al supervisor que complete el Calendario de Turnos', disabled: true }]
                      : [
                          { value: '', label: 'Seleccionar tejedor...' },
                          ...tejedores.map(t => ({ value: t.id, label: t.nombre }))
                        ]
                  }
                  triggerClassName="text-xs font-medium"
                  placeholder="Seleccionar tejedor..."
                />
              </div>

              {/* 3. Horario y Duración */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Horario</label>
                  <CustomSelect
                    value={cargaForm.horario}
                    onChange={val => setCargaForm({ ...cargaForm, horario: val })}
                    options={[
                      { value: 'dia', label: '☀ Día' },
                      { value: 'noche', label: '🌙 Noche' }
                    ]}
                    triggerClassName="text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Duración</label>
                  <CustomSelect
                    value={cargaForm.duracion_horas}
                    onChange={val => setCargaForm({ ...cargaForm, duracion_horas: val })}
                    options={[
                      { value: '8', label: '8 horas' },
                      { value: '12', label: '12 horas' }
                    ]}
                    triggerClassName="text-xs"
                  />
                </div>
              </div>

              {/* 4. Lista de Máquinas disponibles de la marca elegida */}
              <div>
                <label className="block font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                  Máquinas Disponibles de la Marca
                  {cargaForm.marca_id && (
                    <span className="text-blue-400 font-normal normal-case ml-1">
                      ({maquinasDisponiblesPorMarca.length} libres)
                    </span>
                  )}
                </label>

                {!cargaForm.marca_id ? (
                  <p className="text-slate-500 text-[11px] italic py-3 text-center border border-dashed border-white/10 rounded-xl">
                    Selecciona una marca arriba para cargar sus máquinas disponibles
                  </p>
                ) : maquinasDisponiblesPorMarca.length === 0 ? (
                  <p className="text-amber-400 text-[11px] font-medium py-3 text-center border border-amber-500/20 bg-amber-500/10 rounded-xl">
                    ⚠ No hay máquinas libres actualmente en la marca seleccionada
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                    {maquinasDisponiblesPorMarca.map(m => {
                      const isSelected = cargaForm.maquinas_seleccionadas[m.id] !== undefined
                      const selectedMediaId = cargaForm.maquinas_seleccionadas[m.id] || ''

                      return (
                        <div
                          key={m.id}
                          className={`p-3 rounded-xl border transition-all ${
                            isSelected
                              ? 'bg-blue-500/10 border-blue-500/40'
                              : 'bg-white/[0.02] border-white/[0.06]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <label className="flex items-center gap-2 cursor-pointer font-bold text-white font-mono">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleMaquinaSeleccionada(m.id)}
                                className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4"
                              />
                              <span>{m.codigo}</span>
                            </label>
                            <span className="text-[10px] text-slate-400 font-sans">{m.caracteristicas || 'Estándar'}</span>
                          </div>

                          {isSelected && (
                            <CustomSelect
                              value={selectedMediaId}
                              onChange={val => updateMediaParaMaquina(m.id, val)}
                              options={[
                                { value: '', label: 'Seleccionar código de media...' },
                                ...catalogo.map(c => ({ value: c.id, label: c.codigo }))
                              ]}
                              triggerClassName="text-[11px] py-1.5 font-mono mt-1"
                              placeholder="Seleccionar código de media..."
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Botón de envío de Carga */}
              <button
                onClick={ejecutarCargaDeLote}
                disabled={!cargaForm.marca_id || maquinasDisponiblesPorMarca.length === 0}
                className="btn-primary w-full justify-center py-2.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-600/20 disabled:opacity-50 mt-2"
              >
                Validar y Cargar Lote
              </button>
            </div>
          </div>

          {/* Widget 2: Eficiencia OEE de Planta */}
          <div className="glass rounded-3xl p-5 border border-white/[0.08]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Eficiencia de Planta</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-black text-white">88.4%</span>
                  <span className="text-xs text-emerald-400 font-bold flex items-center">
                    <TrendingUp className="w-3 h-3 mr-0.5" /> +2.4%
                  </span>
                </div>
              </div>
              <Activity className="w-6 h-6 text-blue-400" />
            </div>

            {/* Barras animadas OEE */}
            <div className="flex items-end gap-1.5 h-12 pt-2">
              {[60, 75, 80, 88, 92, 85, 90, 94].map((h, i) => (
                <div key={i} className="flex-1 bg-blue-500/20 rounded-t-md relative overflow-hidden h-full">
                  <div
                    className="bg-gradient-to-t from-blue-600 to-cyan-400 absolute bottom-0 left-0 right-0 rounded-t-md transition-all duration-500"
                    style={{ height: `${h}%` }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Widget 3: Mantenimiento Preventivo Banner */}
          <div className="p-4 rounded-3xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-amber-300">Mantenimiento Preventivo</p>
              <p className="text-[11px] text-amber-200/70">Próxima ronda programada en 2h 15m</p>
            </div>
          </div>

        </div>

      </div>

      {/* ── MODAL: REGISTRAR PRODUCCIÓN FINAL ───────────────────────────────── */}
      {showReporteModal && turnoSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-lg p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.08]">
              <div>
                <h2 className="text-lg font-bold text-white">Registrar Producción del Turno</h2>
                <p className="text-xs text-slate-400">
                  Tejedor: <span className="text-white font-medium">{turnoSeleccionado.tejedor?.nombre}</span> · Horario: <span className="capitalize">{turnoSeleccionado.horario}</span>
                </p>
              </div>
              <button onClick={() => setShowReporteModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Ingresa las docenas obtenidas por cada máquina. Al confirmar, los minidepósitos se actualizarán y las máquinas quedarán libres.
            </p>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {turnoSeleccionado.turno_maquinas?.map(tm => {
                const maqObj = maquinas.find(m => m.id === tm.maquina_id)
                const catObj = catalogo.find(c => c.id === tm.catalogo_media_id)

                return (
                  <div key={tm.maquina_id} className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white font-mono">{maqObj?.codigo || tm.maquina_id}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300">{maqObj?.marca?.nombre}</span>
                      </div>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{catObj?.codigo || 'Media'}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="0"
                        value={reporte[tm.maquina_id] ?? ''}
                        onChange={e => setReporte(r => ({ ...r, [tm.maquina_id]: e.target.value }))}
                        className="input-dark w-24 text-center font-bold text-sm"
                      />
                      <span className="text-xs text-slate-500">docenas</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowReporteModal(false)} className="btn-secondary flex-1 justify-center py-2">
                Cancelar
              </button>
              <button onClick={enviarReporteProduccion} className="btn-primary flex-1 justify-center py-2 bg-emerald-600 hover:bg-emerald-500 border-none">
                <CheckCircle2 className="w-4 h-4" /> Confirmar Producción
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
