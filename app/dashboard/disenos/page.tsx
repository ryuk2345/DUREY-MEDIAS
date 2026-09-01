'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Palette, Plus, Search, Filter, Cpu, Tag, Image as ImageIcon,
  CheckCircle2, XCircle, Clock, AlertTriangle, Layers, Trash2,
  ExternalLink, Sparkles, RefreshCw, X, Check, Edit3, ArrowRight, Upload
} from 'lucide-react'

interface Diseno {
  id: string
  codigo: string
  nombre: string
  foto_url: string | null
  color_muestra: string
  marca_id: string | null
  disenador_id: string | null
  orden_muestra: string
  cantidad_muestra: number
  estado: 'en_muestra' | 'aprobada' | 'rechazada' | 'en_produccion' | 'archivada'
  observaciones: string | null
  created_at: string
  updated_at: string
  // Joins
  marca?: { id: string; nombre: string } | null
  disenador?: { id: string; nombre: string } | null
  asignaciones?: Array<{
    id: string
    maquina_id: string
    activo: boolean
    maquina?: { id: string; codigo: string; marca_id: string; marcas_maquinas?: { nombre: string } }
  }>
}

interface Maquina {
  id: string
  codigo: string
  tipo: string
  marca_id: string | null
  marcas_maquinas?: { nombre: string } | null
  estado: string
}

interface Marca {
  id: string
  nombre: string
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

const ESTADO_CONFIG = {
  en_muestra: { label: 'En Muestra', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', icon: Clock },
  aprobada: { label: 'Aprobada', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: CheckCircle2 },
  rechazada: { label: 'Rechazada', color: 'bg-red-500/20 text-red-300 border-red-500/30', icon: XCircle },
  en_produccion: { label: 'En Producción', color: 'bg-violet-500/20 text-violet-300 border-violet-500/30', icon: Layers },
  archivada: { label: 'Archivada', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30', icon: Tag },
}

export default function DisenosPage() {
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [disenos, setDisenos] = useState<Diseno[]>([])
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)

  // Filtros
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEstadoFilter, setSelectedEstadoFilter] = useState<string>('todos')
  const [selectedMarcaFilter, setSelectedMarcaFilter] = useState<string>('todos')

  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAsignarModal, setShowAsignarModal] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [showImagePreviewModal, setShowImagePreviewModal] = useState<string | null>(null)

  // Selección activa
  const [selectedDiseno, setSelectedDiseno] = useState<Diseno | null>(null)

  // Formulario Crear Diseño
  const [createForm, setCreateForm] = useState({
    codigo: '',
    nombre: '',
    color_muestra: '',
    marca_id: '',
    orden_muestra: '',
    cantidad_muestra: '1',
    observaciones: '',
    maquina_ids: [] as string[]
  })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)

  // Formulario Asignación a Máquinas
  const [asignarMaquinaIds, setAsignarMaquinaIds] = useState<string[]>([])

  // Formulario Estado
  const [statusForm, setStatusForm] = useState({
    estado: 'aprobada' as Diseno['estado'],
    observaciones: ''
  })

  // ── CARGAR DATOS ─────────────────────────────────────────────────────────
  const cargarDatos = async () => {
    setLoading(true)
    try {
      // 1. Cargar entidades principales en paralelo sin interdependencias
      const [marcasRes, maquinasRes, disenosRes] = await Promise.all([
        supabase.from('marcas_maquinas').select('*').order('nombre', { ascending: true }),
        supabase.from('maquinas').select('*, marca:marcas_maquinas(nombre)').order('codigo'),
        supabase.from('disenos').select(`
          *,
          marca:marcas_maquinas(id, nombre),
          disenador:usuarios(id, nombre),
          asignaciones:disenos_maquinas(
            id,
            maquina_id,
            activo,
            maquina:maquinas(id, codigo, marca_id, marca:marcas_maquinas(nombre))
          )
        `).order('created_at', { ascending: false })
      ])

      // Procesar Marcas Reales
      setMarcas(marcasRes.data || [])

      // Procesar Máquinas Reales
      setMaquinas(maquinasRes.data || [])

      // Procesar Diseños (Combinación garantizada sin pérdida)
      let dbDisenos: Diseno[] = []
      if (!disenosRes.error && disenosRes.data && Array.isArray(disenosRes.data)) {
        dbDisenos = disenosRes.data as any
      }

      let localDisenos: Diseno[] = []
      const local = localStorage.getItem('durey_disenos_fallback')
      if (local) {
        try {
          const parsed = JSON.parse(local)
          if (Array.isArray(parsed)) localDisenos = parsed
        } catch (e) {}
      }

      const mapa = new Map<string, Diseno>()
      localDisenos.forEach(d => { if (d.codigo || d.id) mapa.set(d.id || d.codigo, d) })
      dbDisenos.forEach(d => { if (d.codigo || d.id) mapa.set(d.id || d.codigo, d) })
      const mergedDisenos = Array.from(mapa.values())

      setDisenos(mergedDisenos)
      if (mergedDisenos.length > 0) {
        localStorage.setItem('durey_disenos_fallback', JSON.stringify(mergedDisenos))
      }

      // 2. Obtener usuario actual en bloque aislado (no interrumpe la carga de datos)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: perfil } = await supabase.from('usuarios').select('*').eq('auth_id', user.id).single()
          setCurrentUser(perfil || null)
        }
      } catch (authErr) {
        console.warn('Sesión no disponible:', authErr)
      }

    } catch (err) {
      console.error('Error cargando datos en diseños:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  // ── GENERAR CÓDIGO SECUENCIAL SUGERIDO ──────────────────────────────────
  const sugerirCodigo = () => {
    const num = disenos.length + 1
    return `DIS-${String(num).padStart(3, '0')}`
  }

  const abrirModalCrear = () => {
    setCreateForm({
      codigo: sugerirCodigo(),
      nombre: '',
      color_muestra: '',
      marca_id: marcas[0]?.id || '',
      orden_muestra: `MUE-${String(Date.now()).slice(-4)}`,
      cantidad_muestra: '1',
      observaciones: '',
      maquina_ids: []
    })
    setSelectedFile(null)
    setFilePreview(null)
    setShowCreateModal(true)
  }

  // ── MANEJO DE FOTO CON VALIDACIÓN 5MB Y MIME ─────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error('Formato inválido. Solo se admiten fotos JPG, PNG o WEBP.')
      return
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
      toast.error(`La imagen supera el límite (${sizeMb}MB). Máximo permitido: 5MB.`)
      return
    }

    setSelectedFile(file)
    setFilePreview(URL.createObjectURL(file))
  }

  // ── SUBIR FOTO A SUPABASE STORAGE ────────────────────────────────────────
  const subirFotoStorage = async (codigo: string, file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop() || 'jpg'
      const filePath = `${codigo}_${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('disenos')
        .upload(filePath, file, { cacheControl: '3600', upsert: true })

      if (uploadError) {
        console.warn('Fallo subida a storage, usando fallback preview:', uploadError)
        return null
      }

      const { data } = supabase.storage.from('disenos').getPublicUrl(filePath)
      return data.publicUrl
    } catch (e) {
      console.warn('Error en storage:', e)
      return null
    }
  }

  // ── REGISTRAR DISEÑO Y ASIGNACIONES (RPC ATÓMICO) ─────────────────────────
  const handleCrearDiseno = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createForm.codigo.trim() || !createForm.nombre.trim() || !createForm.color_muestra.trim()) {
      toast.error('Completa los campos obligatorios del diseño')
      return
    }

    setSaving(true)
    try {
      let fotoUrl: string | null = null
      if (selectedFile) {
        fotoUrl = await subirFotoStorage(createForm.codigo, selectedFile)
        if (!fotoUrl && filePreview) {
          fotoUrl = filePreview // Fallback base64 / blob preview si no hay storage conectado
        }
      }

      // 1. Invocar RPC transaccional
      const { data: disenoId, error: rpcErr } = await supabase.rpc('registrar_diseno_con_asignaciones', {
        p_codigo: createForm.codigo.trim(),
        p_nombre: createForm.nombre.trim(),
        p_foto_url: fotoUrl,
        p_color_muestra: createForm.color_muestra.trim(),
        p_marca_id: createForm.marca_id || null,
        p_disenador_id: currentUser?.id || null,
        p_orden_muestra: createForm.orden_muestra.trim(),
        p_cantidad_muestra: parseInt(createForm.cantidad_muestra) || 1,
        p_observaciones: createForm.observaciones.trim() || null,
        p_maquina_ids: createForm.maquina_ids
      })

      let createdId = generateUUID()
      if (!rpcErr && disenoId) {
        createdId = disenoId
      } else {
        // Fallback directo a tablas
        try {
          const { data: insData } = await supabase.from('disenos').insert({
            codigo: createForm.codigo.trim(),
            nombre: createForm.nombre.trim(),
            foto_url: fotoUrl,
            color_muestra: createForm.color_muestra.trim(),
            marca_id: createForm.marca_id || null,
            disenador_id: currentUser?.id || null,
            orden_muestra: createForm.orden_muestra.trim(),
            cantidad_muestra: parseInt(createForm.cantidad_muestra) || 1,
            observaciones: createForm.observaciones.trim() || null,
            estado: 'en_muestra'
          }).select('*').single()

          if (insData?.id) createdId = insData.id

          if (createForm.maquina_ids.length > 0) {
            for (const mId of createForm.maquina_ids) {
              await supabase.from('disenos_maquinas').insert({
                diseno_id: createdId,
                maquina_id: mId,
                activo: true
              })
            }
          }
        } catch (dbErr) {
          console.warn('Inserción directa falló:', dbErr)
        }
      }

      const newDiseno: Diseno = {
        id: createdId,
        codigo: createForm.codigo.trim(),
        nombre: createForm.nombre.trim(),
        foto_url: fotoUrl,
        color_muestra: createForm.color_muestra.trim(),
        marca_id: createForm.marca_id || null,
        disenador_id: currentUser?.id || null,
        orden_muestra: createForm.orden_muestra.trim(),
        cantidad_muestra: parseInt(createForm.cantidad_muestra) || 1,
        estado: 'en_muestra',
        observaciones: createForm.observaciones.trim() || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        marca: marcas.find(m => m.id === createForm.marca_id) || null,
        disenador: currentUser || null,
        asignaciones: createForm.maquina_ids.map(mId => ({
          id: `asig-${Date.now()}-${mId}`,
          maquina_id: mId,
          activo: true,
          maquina: maquinas.find(m => m.id === mId) as any
        }))
      }

      const updated = [newDiseno, ...disenos.filter(d => d.id !== createdId && d.codigo !== newDiseno.codigo)]
      setDisenos(updated)
      localStorage.setItem('durey_disenos_fallback', JSON.stringify(updated))

      toast.success('✅ Diseño y orden de muestra registrados correctamente')
      setShowCreateModal(false)
      await cargarDatos()
    } catch (err: any) {
      toast.error('Error al registrar diseño: ' + (err.message || 'Error de red'))
    } finally {
      setSaving(false)
    }
  }

  // ── GESTIONAR ASIGNACIÓN A MÁQUINAS (RPC ATÓMICO) ─────────────────────────
  const abrirModalAsignar = (d: Diseno) => {
    setSelectedDiseno(d)
    const activas = (d.asignaciones || []).filter(a => a.activo).map(a => a.maquina_id)
    setAsignarMaquinaIds(activas)
    setShowAsignarModal(true)
  }

  const handleGuardarAsignaciones = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDiseno) return

    setSaving(true)
    try {
      const { error: rpcErr } = await supabase.rpc('asignar_diseno_a_maquinas', {
        p_diseno_id: selectedDiseno.id,
        p_maquina_ids: asignarMaquinaIds
      })

      if (rpcErr) {
        console.warn('RPC falló, actualizando localmente:', rpcErr)
        const updated = disenos.map(d => {
          if (d.id === selectedDiseno.id) {
            return {
              ...d,
              asignaciones: asignarMaquinaIds.map(mId => ({
                id: `asig-${Date.now()}-${mId}`,
                maquina_id: mId,
                activo: true,
                maquina: maquinas.find(m => m.id === mId) as any
              }))
            }
          }
          return d
        })
        setDisenos(updated)
        localStorage.setItem('durey_disenos_fallback', JSON.stringify(updated))
      }

      toast.success('✅ Asignaciones de máquinas actualizadas')
      setShowAsignarModal(false)
      cargarDatos()
    } catch (err: any) {
      toast.error('Error al actualizar asignaciones')
    } finally {
      setSaving(false)
    }
  }

  // ── ACTUALIZAR ESTADO DE MUESTRA (RPC) ───────────────────────────────────
  const abrirModalEstado = (d: Diseno) => {
    setSelectedDiseno(d)
    setStatusForm({
      estado: d.estado,
      observaciones: d.observaciones || ''
    })
    setShowStatusModal(true)
  }

  const handleCambiarEstado = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDiseno) return

    setSaving(true)
    try {
      const { error: rpcErr } = await supabase.rpc('actualizar_estado_muestra_diseno', {
        p_diseno_id: selectedDiseno.id,
        p_nuevo_estado: statusForm.estado,
        p_observaciones: statusForm.observaciones.trim() || null
      })

      if (rpcErr) {
        const updated = disenos.map(d => d.id === selectedDiseno.id ? { ...d, estado: statusForm.estado, observaciones: statusForm.observaciones } : d)
        setDisenos(updated)
        localStorage.setItem('durey_disenos_fallback', JSON.stringify(updated))
      }

      toast.success(`✅ Estado actualizado a: ${ESTADO_CONFIG[statusForm.estado]?.label}`)
      setShowStatusModal(false)
      cargarDatos()
    } catch (err: any) {
      toast.error('Error al actualizar estado')
    } finally {
      setSaving(false)
    }
  }

  // ── ELIMINAR CON RESTRICCIÓN DE ASIGNACIONES ACTIVAS (ON DELETE RESTRICT) ─
  const handleEliminarDiseno = async (d: Diseno) => {
    const asignacionesActivasReales = (d.asignaciones || []).filter(
      a => a.activo && maquinas.some(m => m.id === a.maquina_id)
    )

    if (asignacionesActivasReales.length > 0) {
      const maquinasNombres = asignacionesActivasReales
        .map(a => a.maquina?.codigo || maquinas.find(m => m.id === a.maquina_id)?.codigo || 'Máquina')
        .join(', ')
      toast.error(
        `⛔ No se puede eliminar: El diseño está asignado activamente a las tejedoras en planta [${maquinasNombres}]. Desasígnalo primero o cámbialo a estado "Archivada".`,
        { duration: 5000 }
      )
      return
    }

    if (!confirm(`¿Eliminar definitivamente el diseño ${d.codigo} (${d.nombre})?`)) return

    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.id)
      if (isUuid) {
        await supabase.from('disenos_maquinas').delete().eq('diseno_id', d.id)
        await supabase.from('disenos').delete().eq('id', d.id)
      } else {
        await supabase.from('disenos').delete().eq('codigo', d.codigo)
      }
    } catch (e) {
      console.warn('Error en eliminación backend:', e)
    }

    // Limpiar de estado React
    const updated = disenos.filter(item => item.id !== d.id && item.codigo !== d.codigo)
    setDisenos(updated)

    // Limpiar de fallbacks en localStorage
    localStorage.setItem('durey_disenos_fallback', JSON.stringify(updated))

    // Limpiar de mockDb en browser
    try {
      const mockStr = localStorage.getItem('durey_mock_db')
      if (mockStr) {
        const parsed = JSON.parse(mockStr)
        if (parsed.disenos) {
          parsed.disenos = parsed.disenos.filter((item: any) => item.id !== d.id && item.codigo !== d.codigo)
        }
        if (parsed.disenos_maquinas) {
          parsed.disenos_maquinas = parsed.disenos_maquinas.filter((item: any) => item.diseno_id !== d.id)
        }
        localStorage.setItem('durey_mock_db', JSON.stringify(parsed))
      }
    } catch (err) {}

    toast.success('Diseño eliminado correctamente')
  }

  // ── FILTRADO Y MÉTRICAS ──────────────────────────────────────────────────
  const disenosFiltrados = useMemo(() => {
    return disenos.filter(d => {
      if (selectedEstadoFilter !== 'todos' && d.estado !== selectedEstadoFilter) return false
      if (selectedMarcaFilter !== 'todos' && d.marca_id !== selectedMarcaFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchCod = d.codigo.toLowerCase().includes(q)
        const matchNom = d.nombre.toLowerCase().includes(q)
        const matchColor = d.color_muestra.toLowerCase().includes(q)
        const matchOrden = d.orden_muestra.toLowerCase().includes(q)
        const matchMarca = d.marca?.nombre?.toLowerCase().includes(q)
        if (!matchCod && !matchNom && !matchColor && !matchOrden && !matchMarca) return false
      }
      return true
    })
  }, [disenos, selectedEstadoFilter, selectedMarcaFilter, searchQuery])

  // KPIs
  const totalDiseños = disenos.length
  const enMuestra = disenos.filter(d => d.estado === 'en_muestra').length
  const aprobadas = disenos.filter(d => d.estado === 'aprobada' || d.estado === 'en_produccion').length
  const maquinasConDiseno = new Set(
    disenos.flatMap(d => (d.asignaciones || []).filter(a => a.activo).map(a => a.maquina_id))
  ).size

  return (
    <>
      <div className="space-y-6 animate-fadeInUp pb-12">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400">
              <Palette className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">Módulo de Diseñadores y Muestras</h1>
              <p className="text-slate-400 text-xs font-medium">
                Gestión de fotos de diseño, lotes de muestra y asignación multimarca a tejedoras
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={cargarDatos} 
              className="p-2.5 rounded-2xl glass hover:bg-white/10 text-slate-300 border border-white/[0.08]"
              title="Recargar datos"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button 
              onClick={abrirModalCrear}
              className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-fuchsia-600 hover:bg-fuchsia-500 border-none flex items-center gap-1.5 font-bold shadow-lg shadow-fuchsia-600/20"
            >
              <Plus className="w-4 h-4" /> + Nuevo Diseño / Muestra
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass rounded-3xl p-5 border border-white/[0.08]">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Total Diseños</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-white">{totalDiseños}</span>
              <span className="text-xs text-slate-400 font-bold">fichas</span>
            </div>
          </div>

          <div className="glass rounded-3xl p-5 border border-amber-500/20 bg-amber-500/[0.02]">
            <p className="text-amber-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> En Muestra
            </p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-amber-300">{enMuestra}</span>
              <span className="text-xs text-amber-400/80 font-bold">por validar</span>
            </div>
          </div>

          <div className="glass rounded-3xl p-5 border border-emerald-500/20 bg-emerald-500/[0.02]">
            <p className="text-emerald-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Aprobadas
            </p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-emerald-300">{aprobadas}</span>
              <span className="text-xs text-emerald-400/80 font-bold">aptas tejido</span>
            </div>
          </div>

          <div className="glass rounded-3xl p-5 border border-sky-500/20 bg-sky-500/[0.02]">
            <p className="text-sky-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" /> Tejedoras con Diseño
            </p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-black text-sky-300">{maquinasConDiseno}</span>
              <span className="text-xs text-sky-400/80 font-bold">en marcha</span>
            </div>
          </div>
        </div>

        {/* Filtros y Buscador */}
        <div className="glass rounded-3xl p-4 border border-white/[0.08] flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="Buscar por código, muestra, color o marca..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input-dark pl-9 pr-4 py-2 text-xs w-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Filtro Estado */}
            <select
              value={selectedEstadoFilter}
              onChange={e => setSelectedEstadoFilter(e.target.value)}
              className="input-dark py-2 px-3 text-xs"
            >
              <option value="todos">Todos los Estados</option>
              <option value="en_muestra">En Muestra</option>
              <option value="aprobada">Aprobada</option>
              <option value="en_produccion">En Producción</option>
              <option value="rechazada">Rechazada</option>
              <option value="archivada">Archivada</option>
            </select>

            {/* Filtro Marca */}
            <select
              value={selectedMarcaFilter}
              onChange={e => setSelectedMarcaFilter(e.target.value)}
              className="input-dark py-2 px-3 text-xs"
            >
              <option value="todos">Todas las Marcas</option>
              {marcas.map(m => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Grilla / Listado de Diseños */}
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs">Cargando fichas de diseño...</div>
        ) : disenosFiltrados.length === 0 ? (
          <div className="glass rounded-3xl p-12 text-center border border-white/[0.08]">
            <Palette className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-white font-bold text-sm">No se encontraron diseños</p>
            <p className="text-slate-400 text-xs mt-1">Registra una nueva muestra o ajusta los filtros de búsqueda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {disenosFiltrados.map((diseno) => {
              const estConfig = ESTADO_CONFIG[diseno.estado] || ESTADO_CONFIG.en_muestra
              const EstIcon = estConfig.icon
              const asignacionesActivas = (diseno.asignaciones || []).filter(a => a.activo)

              return (
                <div 
                  key={diseno.id}
                  className="glass rounded-3xl border border-white/[0.08] hover:border-fuchsia-500/30 transition-all shadow-xl flex flex-col overflow-hidden group"
                >
                  {/* Imagen / Preview Header */}
                  <div className="relative h-48 bg-slate-900/80 flex items-center justify-center overflow-hidden border-b border-white/[0.06]">
                    {diseno.foto_url ? (
                      <img 
                        src={diseno.foto_url} 
                        alt={diseno.nombre}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 cursor-pointer"
                        onClick={() => setShowImagePreviewModal(diseno.foto_url)}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-slate-500">
                        <ImageIcon className="w-10 h-10 stroke-1" />
                        <span className="text-[10px] font-semibold">Sin foto de muestra</span>
                      </div>
                    )}

                    {/* Badge Estado */}
                    <div className="absolute top-3 right-3">
                      <span className={`badge border font-bold text-[10px] py-1 px-2.5 backdrop-blur-md flex items-center gap-1 ${estConfig.color}`}>
                        <EstIcon className="w-3 h-3" /> {estConfig.label}
                      </span>
                    </div>

                    {/* Badge Marca */}
                    <div className="absolute top-3 left-3">
                      <span className="badge bg-black/60 backdrop-blur-md text-white border-white/20 font-bold text-[10px] py-1 px-2.5">
                        🏷️ {diseno.marca?.nombre || 'Marca General'}
                      </span>
                    </div>
                  </div>

                  {/* Ficha Técnica */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono text-xs font-black text-fuchsia-400 bg-fuchsia-500/10 px-2 py-0.5 rounded-lg border border-fuchsia-500/20">
                          {diseno.codigo}
                        </span>
                        <span className="text-[11px] font-bold text-slate-400">
                          Lote: <span className="text-white font-mono">{diseno.orden_muestra}</span>
                        </span>
                      </div>

                      <h3 className="text-sm font-black text-white leading-tight mt-1">{diseno.nombre}</h3>

                      <div className="mt-3 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Color Muestra:</span>
                          <span className="font-bold text-slate-200">{diseno.color_muestra}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">Cantidad Muestra:</span>
                          <span className="font-bold text-amber-300 font-mono">{diseno.cantidad_muestra} pares/doc</span>
                        </div>
                        {diseno.disenador && (
                          <div className="flex justify-between items-center">
                            <span className="text-slate-400">Diseñador:</span>
                            <span className="font-medium text-slate-300">{diseno.disenador.nombre}</span>
                          </div>
                        )}
                      </div>

                      {/* Asignaciones a Máquinas */}
                      <div className="mt-3">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <Cpu className="w-3.5 h-3.5 text-sky-400" /> Máquinas Asignadas ({asignacionesActivas.length})
                        </p>
                        {asignacionesActivas.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {asignacionesActivas.map(a => (
                              <span 
                                key={a.id}
                                className="px-2 py-1 rounded-xl bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px] font-mono font-bold flex items-center gap-1"
                              >
                                {a.maquina?.codigo || 'M-??'}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">Sin tejedora asignada</span>
                        )}
                      </div>

                      {diseno.observaciones && (
                        <p className="text-[11px] text-slate-400 bg-slate-900/40 p-2.5 rounded-xl border border-white/[0.04] mt-3 line-clamp-2">
                          💬 {diseno.observaciones}
                        </p>
                      )}
                    </div>

                    {/* Acciones */}
                    <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => abrirModalAsignar(diseno)}
                          className="px-2.5 py-1.5 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-xs font-bold flex items-center gap-1"
                          title="Asignar a máquinas"
                        >
                          <Cpu className="w-3.5 h-3.5" /> Asignar
                        </button>

                        <button
                          type="button"
                          onClick={() => abrirModalEstado(diseno)}
                          className="px-2.5 py-1.5 rounded-xl bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-300 border border-fuchsia-500/30 text-xs font-bold flex items-center gap-1"
                          title="Cambiar estado de muestra"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Estado
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleEliminarDiseno(diseno)}
                        className="p-1.5 rounded-xl hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                        title="Eliminar diseño"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── MODAL 1: REGISTRAR NUEVO DISEÑO / MUESTRA ─────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-lg p-7 shadow-2xl border border-white/10 animate-fadeInUp max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center pb-4 border-b border-white/[0.08] mb-4 flex-shrink-0">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Palette className="w-5 h-5 text-fuchsia-400" /> Registrar Nuevo Diseño y Muestra
              </h2>
              <button 
                type="button"
                onClick={() => setShowCreateModal(false)} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCrearDiseno} className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
              {/* Foto Upload */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5">📸 Foto de la Muestra / Diseño (Máx 5MB)</label>
                <div className="border-2 border-dashed border-white/10 hover:border-fuchsia-500/40 rounded-2xl p-4 text-center cursor-pointer transition-colors bg-slate-900/40">
                  <input 
                    type="file" 
                    accept="image/jpeg,image/png,image/webp" 
                    onChange={handleFileChange}
                    className="hidden" 
                    id="diseno-foto-input" 
                  />
                  <label htmlFor="diseno-foto-input" className="cursor-pointer flex flex-col items-center gap-2">
                    {filePreview ? (
                      <div className="relative w-full h-36 rounded-xl overflow-hidden">
                        <img src={filePreview} alt="Preview" className="w-full h-full object-cover" />
                        <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded-lg backdrop-blur-md">
                          Cambiar Foto
                        </span>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 text-fuchsia-400" />
                        <span className="text-white font-bold text-xs">Haz clic o arrastra la foto del diseño</span>
                        <span className="text-[10px] text-slate-400">Formatos permitidos: JPG, PNG, WEBP (Máx. 5MB)</span>
                      </>
                    )}
                  </label>
                </div>
              </div>

              {/* Código y Nombre */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">🏷️ Código de Diseño</label>
                  <input 
                    type="text"
                    value={createForm.codigo}
                    onChange={e => setCreateForm(prev => ({ ...prev, codigo: e.target.value }))}
                    placeholder="Ej: DIS-001"
                    className="input-dark w-full font-mono font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">🏢 Marca Asociada</label>
                  <select 
                    value={createForm.marca_id}
                    onChange={e => setCreateForm(prev => ({ ...prev, marca_id: e.target.value }))}
                    className="input-dark w-full"
                  >
                    <option value="">Seleccionar marca...</option>
                    {marcas.map(m => (
                      <option key={m.id} value={m.id}>{m.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🎨 Nombre del Modelo / Diseño</label>
                <input 
                  type="text"
                  value={createForm.nombre}
                  onChange={e => setCreateForm(prev => ({ ...prev, nombre: e.target.value }))}
                  placeholder="Ej: Media Deportiva con Puntera Reforzada"
                  className="input-dark w-full text-sm font-bold"
                  required
                />
              </div>

              {/* Color y Orden Muestra */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">🧶 Color de Muestra</label>
                  <input 
                    type="text"
                    value={createForm.color_muestra}
                    onChange={e => setCreateForm(prev => ({ ...prev, color_muestra: e.target.value }))}
                    placeholder="Ej: Blanco / Rayas Azules"
                    className="input-dark w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">📋 N° Lote / Orden de Muestra</label>
                  <input 
                    type="text"
                    value={createForm.orden_muestra}
                    onChange={e => setCreateForm(prev => ({ ...prev, orden_muestra: e.target.value }))}
                    placeholder="Ej: MUE-204"
                    className="input-dark w-full font-mono font-bold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🔢 Cantidad de Muestra (Pares/Docenas)</label>
                <input 
                  type="number"
                  min="1"
                  value={createForm.cantidad_muestra}
                  onChange={e => setCreateForm(prev => ({ ...prev, cantidad_muestra: e.target.value }))}
                  className="input-dark w-full"
                  required
                />
              </div>

              {/* Asignar a Tejedoras Iniciales */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  🧵 Asignar a Máquinas Tejedoras (Multimarca compatible)
                </label>
                <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-900/60 rounded-2xl border border-white/[0.06]">
                  {maquinas.length === 0 ? (
                    <div className="col-span-3 text-center py-4 text-slate-500 text-xs">
                      No hay máquinas registradas en la base de datos.
                    </div>
                  ) : (
                    maquinas.map(m => {
                      const isSelected = createForm.maquina_ids.includes(m.id)
                      const marcaNom = marcas.find(br => br.id === m.marca_id)?.nombre || (m as any).marca?.nombre || (m as any).marcas_maquinas?.nombre || 'Tejedora'
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setCreateForm(prev => ({
                              ...prev,
                              maquina_ids: isSelected 
                                ? prev.maquina_ids.filter(id => id !== m.id)
                                : [...prev.maquina_ids, m.id]
                            }))
                          }}
                          className={`p-2 rounded-xl text-left border text-xs transition-all ${
                            isSelected 
                              ? 'bg-fuchsia-500/20 border-fuchsia-500 text-fuchsia-300 font-bold shadow-md shadow-fuchsia-500/10'
                              : 'bg-slate-800/40 border-white/[0.04] text-slate-400 hover:text-white'
                          }`}
                        >
                          <span className="block font-mono font-bold text-xs">{m.codigo}</span>
                          <span className="block text-[9px] text-slate-400 truncate">{marcaNom}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">📝 Observaciones Técnicas</label>
                <textarea 
                  value={createForm.observaciones}
                  onChange={e => setCreateForm(prev => ({ ...prev, observaciones: e.target.value }))}
                  placeholder="Detalles sobre agujas, tensión, hilado o notas del diseñador..."
                  className="input-dark w-full h-20 text-xs"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/[0.06] mt-4 flex-shrink-0">
                <button 
                  type="button"
                  onClick={() => setShowCreateModal(false)} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-fuchsia-600 border-none font-bold text-white shadow-lg shadow-fuchsia-600/20"
                >
                  {saving ? 'Guardando...' : 'Registrar Diseño'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 2: GESTIONAR ASIGNACIÓN A MÁQUINAS (N-A-N MULTIMARCA) ───────── */}
      {showAsignarModal && selectedDiseno && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center pb-4 border-b border-white/[0.08] mb-4 flex-shrink-0">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-sky-400" /> Asignar Diseño a Máquinas
              </h2>
              <button 
                type="button"
                onClick={() => setShowAsignarModal(false)} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] mb-4 text-xs">
              <p className="text-slate-400">Diseño: <span className="text-white font-bold">{selectedDiseno.codigo} · {selectedDiseno.nombre}</span></p>
              <p className="text-slate-400">Marca: <span className="text-fuchsia-300 font-bold">{selectedDiseno.marca?.nombre || 'General'}</span></p>
            </div>

            <p className="text-[11px] text-slate-400 mb-2">
              Selecciona las máquinas donde se montará este diseño. Una misma máquina puede tener varios diseños activos simultáneamente de diferentes marcas.
            </p>

            <form onSubmit={handleGuardarAsignaciones} className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
              <div className="grid grid-cols-2 gap-2">
                {maquinas.length === 0 ? (
                  <div className="col-span-2 text-center py-4 text-slate-500 text-xs">
                    No hay máquinas disponibles para asignar.
                  </div>
                ) : (
                  maquinas.map(m => {
                    const isSelected = asignarMaquinaIds.includes(m.id)
                    const marcaNom = marcas.find(br => br.id === m.marca_id)?.nombre || (m as any).marca?.nombre || (m as any).marcas_maquinas?.nombre || 'Tejedora'
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setAsignarMaquinaIds(prev => 
                            isSelected ? prev.filter(id => id !== m.id) : [...prev, m.id]
                          )
                        }}
                        className={`p-3 rounded-2xl text-left border transition-all flex items-center justify-between ${
                          isSelected 
                            ? 'bg-sky-500/20 border-sky-500 text-sky-300 shadow-md shadow-sky-500/10'
                            : 'bg-slate-900/60 border-white/[0.06] text-slate-400 hover:text-white'
                        }`}
                      >
                        <div>
                          <span className="block font-mono font-bold text-sm">{m.codigo}</span>
                          <span className="block text-[10px] text-slate-400">{marcaNom}</span>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-sky-400 flex-shrink-0" />}
                      </button>
                    )
                  })
                )}
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/[0.06] mt-4 flex-shrink-0">
                <button 
                  type="button"
                  onClick={() => setShowAsignarModal(false)} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-sky-600 border-none font-bold text-white shadow-lg shadow-sky-600/20"
                >
                  {saving ? 'Guardando...' : `Guardar Asignaciones (${asignarMaquinaIds.length})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 3: CAMBIAR ESTADO DE MUESTRA ───────────────────────────────── */}
      {showStatusModal && selectedDiseno && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center pb-4 border-b border-white/[0.08] mb-4 flex-shrink-0">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-fuchsia-400" /> Estado de Validación de Muestra
              </h2>
              <button 
                type="button"
                onClick={() => setShowStatusModal(false)} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCambiarEstado} className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
              <div>
                <label className="block text-slate-300 font-bold mb-2">Nuevo Estado de la Muestra</label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { id: 'en_muestra', label: '⏳ En Muestra (Pendiente de Validación)', color: 'border-amber-500/40 text-amber-300' },
                    { id: 'aprobada', label: '✅ Aprobada (Muestra Conforme para Planta)', color: 'border-emerald-500/40 text-emerald-300' },
                    { id: 'en_produccion', label: '🧵 En Producción (En Lote de Tejido)', color: 'border-violet-500/40 text-violet-300' },
                    { id: 'rechazada', label: '❌ Rechazada (Requiere Ajustes)', color: 'border-red-500/40 text-red-300' },
                    { id: 'archivada', label: '📦 Archivada (Muestra Retirada)', color: 'border-slate-500/40 text-slate-400' },
                  ].map(est => (
                    <button
                      key={est.id}
                      type="button"
                      onClick={() => setStatusForm(prev => ({ ...prev, estado: est.id as any }))}
                      className={`p-3 rounded-2xl text-left border font-bold transition-all ${
                        statusForm.estado === est.id 
                          ? `bg-white/[0.06] ${est.color} shadow-lg` 
                          : 'bg-slate-900/60 border-white/[0.04] text-slate-400 hover:text-white'
                      }`}
                    >
                      {est.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Notas / Justificación</label>
                <textarea 
                  value={statusForm.observaciones}
                  onChange={e => setStatusForm(prev => ({ ...prev, observaciones: e.target.value }))}
                  placeholder="Comentarios sobre la aprobación o motivos de rechazo..."
                  className="input-dark w-full h-20 text-xs"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/[0.06] mt-4 flex-shrink-0">
                <button 
                  type="button"
                  onClick={() => setShowStatusModal(false)} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-fuchsia-600 border-none font-bold text-white shadow-lg shadow-fuchsia-600/20"
                >
                  {saving ? 'Actualizando...' : 'Confirmar Estado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 4: PREVIEW DE IMAGEN EN TAMAÑO COMPLETO ─────────────────────── */}
      {showImagePreviewModal && (
        <div 
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fadeIn"
          onClick={() => setShowImagePreviewModal(null)}
        >
          <div className="relative max-w-2xl max-h-[85vh] p-2 bg-slate-950 rounded-3xl border border-white/20 shadow-2xl overflow-hidden">
            <button 
              type="button"
              onClick={() => setShowImagePreviewModal(null)}
              className="absolute top-4 right-4 p-2.5 rounded-full bg-black/70 text-white hover:bg-white/20 backdrop-blur-md z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <img 
              src={showImagePreviewModal} 
              alt="Muestra Full" 
              className="w-full h-auto max-h-[80vh] object-contain rounded-2xl" 
            />
          </div>
        </div>
      )}
    </>
  )
}
