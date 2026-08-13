// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Warehouse, Scan, QrCode, CheckCircle2, AlertTriangle,
  Loader2, X, Search, Check, RefreshCw, Barcode, Box, Layers, Zap, MapPin, ArrowRight, Plus, PackagePlus
} from 'lucide-react'
import { toast } from 'sonner'
import { validarTransicionEstadoPaquete } from '@/lib/domain/packaging'


interface Ubicacion { id: string; nombre: string; tipo: string }
interface Paquete {
  id: string
  codigo_paquete: string
  docenas: number
  total_pares?: number
  estado: string
  detalles_contenido?: { sku?: string; codigo: string; docenas: number; pares: number }[]
  preparador?: { nombre: string }
  catalogo_media?: { sku?: string; codigo: string }
  ubicacion?: { id: string; nombre: string }
}

interface CatalogoMedia {
  id: string
  sku?: string
  codigo: string
  modelo: string
  publico: string
  diseno_color: string
  talla: string
}

interface EscaneoMasterBagInfo {
  codigo_saco: string
  preparador_nombre: string
  salon_destino_id: string
  salon_destino_nombre: string
  total_docenas: number
  total_pares: number
  items: { sku: string; codigo: string; docenas: number; pares: number }[]
  paqueteId?: string
}

export default function AlmacenPage() {
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [paquetes, setPaquetes] = useState<Paquete[]>([])
  const [loading, setLoading] = useState(true)

  // Escáner por pistola de código de barras
  const [inputEscaner, setInputEscaner] = useState('')
  const [sacoDetectado, setSacoDetectado] = useState<EscaneoMasterBagInfo | null>(null)
  const [autoConfirmar, setAutoConfirmar] = useState(true)
  const [procesandoEscaneo, setProcesandoEscaneo] = useState(false)

  // Desplegable de productos por almacén y modal de búsqueda
  const [salonesDesplegados, setSalonesDesplegados] = useState<Record<string, boolean>>({})
  const [salonModalProductos, setSalonModalProductos] = useState<any | null>(null)
  const [busquedaProductoModal, setBusquedaProductoModal] = useState('')

  // Filtros
  const [busqueda, setBusqueda] = useState('')
  const [filtroUbicacion, setFiltroUbicacion] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('todos')

  // ── INGRESO DIRECTO DE STOCK ─────────────────────────────────────────────
  const [showModalIngreso, setShowModalIngreso] = useState(false)
  const [catalogoItems, setCatalogoItems] = useState<CatalogoMedia[]>([])
  const [busquedaCatalogo, setBusquedaCatalogo] = useState('')
  const [productoSeleccionado, setProductoSeleccionado] = useState<CatalogoMedia | null>(null)
  const [formIngreso, setFormIngreso] = useState({ docenas: '', salon_id: '', nota: '' })
  const [guardandoIngreso, setGuardandoIngreso] = useState(false)

  const supabase = createClient()

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [ub, pq] = await Promise.all([
      supabase.from('ubicaciones').select('*').eq('activo', true).order('nombre'),
      supabase.from('paquetes').select(`
        id, codigo_paquete, docenas, total_pares, detalles_contenido, estado,
        preparador:usuarios!preparador_id(nombre),
        catalogo_media:catalogo_medias!catalogo_media_id(sku, codigo),
        ubicacion:ubicaciones!ubicacion_id(id, nombre)
      `).order('created_at', { ascending: false })
    ])
    setUbicaciones(ub.data ?? [])
    setPaquetes((pq.data ?? []) as Paquete[])
    setLoading(false)
  }, [])

  const cargarCatalogo = useCallback(async () => {
    const { data } = await supabase.from('catalogo_medias').select('id, sku, codigo, modelo, publico, diseno_color, talla').eq('estado', 'activo').order('modelo')
    setCatalogoItems(data ?? [])
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])
  useEffect(() => { cargarCatalogo() }, [cargarCatalogo])

  // ── PROCESAR LECTURA DE PISTOLA ESCÁNER (CÓDIGO DE BARRA O QR) ───────────
  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputEscaner.trim()) return

    const raw = inputEscaner.trim()
    setInputEscaner('')

    let info: EscaneoMasterBagInfo | null = null

    // 1. Intentar parsear si es cadena JSON proveniente del QR del Saco Maestro
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const parsed = JSON.parse(raw)
        const paqExistente = paquetes.find(p => p.codigo_paquete === parsed.codigo_saco)

        info = {
          codigo_saco: parsed.codigo_saco,
          preparador_nombre: parsed.preparador_nombre || 'Lucia Preparadora',
          salon_destino_id: parsed.salon_destino_id || ubicaciones[0]?.id || '',
          salon_destino_nombre: parsed.salon_destino_nombre || 'Salón A',
          total_docenas: parsed.total_docenas || 10,
          total_pares: parsed.total_pares || 120,
          items: parsed.items || [{ sku: 'SKU-MED-01', codigo: 'tobillera-dama-diseño-única', docenas: 10, pares: 120 }],
          paqueteId: paqExistente?.id
        }
      } catch (err) {
        console.error('Error parseando JSON de QR:', err)
      }
    }

    // 2. Si es lectura directa del código de barras (ej. B-1005 o PKG-1005)
    if (!info) {
      const codeClean = raw.toUpperCase()
      const paqMatch = paquetes.find(p => p.codigo_paquete.toUpperCase() === codeClean)

      if (paqMatch) {
        info = {
          codigo_saco: paqMatch.codigo_paquete,
          preparador_nombre: paqMatch.preparador?.nombre || 'Empacador de Turno',
          salon_destino_id: paqMatch.ubicacion?.id || ubicaciones[0]?.id || '',
          salon_destino_nombre: paqMatch.ubicacion?.nombre || 'Salón A',
          total_docenas: paqMatch.docenas,
          total_pares: paqMatch.total_pares || paqMatch.docenas * 12,
          items: paqMatch.detalles_contenido || [{
            sku: paqMatch.catalogo_media?.sku || 'SKU-VARIADO',
            codigo: paqMatch.catalogo_media?.codigo || 'Medias Variadas',
            docenas: paqMatch.docenas,
            pares: paqMatch.total_pares || paqMatch.docenas * 12
          }],
          paqueteId: paqMatch.id
        }
      } else {
        // Generar estructura al vuelo para simulación de lectura de saco nuevo
        info = {
          codigo_saco: codeClean,
          preparador_nombre: 'Lucia Preparadora',
          salon_destino_id: ubicaciones[0]?.id || '',
          salon_destino_nombre: ubicaciones[0]?.nombre || 'Salón A',
          total_docenas: 10,
          total_pares: 120,
          items: [{ sku: 'SKU-TOB-DAM-DIS-UNI', codigo: 'tobillera-dama-diseño-única', docenas: 10, pares: 120 }]
        }
      }
    }

    if (info) {
      setSacoDetectado(info)
      toast.success(`📦 Saco Maestro ${info.codigo_saco} escaneado correctamente`)

      if (autoConfirmar) {
        confirmarAlmacenarSaco(info)
      }
    } else {
      toast.error(`No se pudo leer el código o QR del saco maestro`)
    }
  }

  // ── CONFIRMAR INGRESO Y ALMACENAMIENTO DE SACO EN SALÓN ───────────────────
  const confirmarAlmacenarSaco = async (targetSaco?: EscaneoMasterBagInfo) => {
    const saco = targetSaco || sacoDetectado
    if (!saco) return

    setProcesandoEscaneo(true)

    if (saco.paqueteId) {
      // Obtener el estado actual del paquete para validar
      const { data: pkg } = await supabase.from('paquetes')
        .select('estado')
        .eq('id', saco.paqueteId)
        .single()

      if (pkg) {
        const v = validarTransicionEstadoPaquete(pkg.estado as any, 'almacenado')
        if (!v.valido) {
          toast.error(`Error en paquete: ${v.error}`)
          setProcesandoEscaneo(false)
          return
        }
      }

      await supabase.from('paquetes').update({
        estado: 'almacenado',
        ubicacion_id: saco.salon_destino_id
      }).eq('id', saco.paqueteId)
    } else {
      await supabase.from('paquetes').insert({
        codigo_paquete: saco.codigo_saco,
        docenas: saco.total_docenas,
        total_pares: saco.total_pares,
        ubicacion_id: saco.salon_destino_id,
        detalles_contenido: saco.items,
        estado: 'almacenado'
      })
    }


    // Registrar en movimientos de stock
    await supabase.from('movimientos_stock').insert({
      tipo: 'ingreso_salon',
      referencia: `Escáner Pistola Saco ${saco.codigo_saco}`,
      ubicacion_id: saco.salon_destino_id,
      docenas: saco.total_docenas
    })

    toast.success(`📍 Saco ${saco.codigo_saco} ALMACENADO EN ${saco.salon_destino_nombre.toUpperCase()} (${saco.total_pares} pares ingresados)`, { duration: 4000 })

    setSacoDetectado(null)
    setProcesandoEscaneo(false)
    cargarDatos()
  }

  // ── INGRESO DIRECTO DE STOCK AL SALÓN ────────────────────────────────────
  const ingresarStockDirecto = async () => {
    if (!productoSeleccionado) { toast.error('Selecciona un producto del catálogo'); return }
    if (!formIngreso.docenas || Number(formIngreso.docenas) <= 0) { toast.error('Ingresa la cantidad en docenas'); return }
    if (!formIngreso.salon_id) { toast.error('Selecciona el salón destino'); return }

    setGuardandoIngreso(true)
    const docenas = Number(formIngreso.docenas)
    const pares = docenas * 12
    const codigoIngreso = `ING-${Date.now().toString().slice(-6)}`
    const salon = ubicaciones.find(u => u.id === formIngreso.salon_id)

    const { error } = await supabase.from('paquetes').insert({
      codigo_paquete: codigoIngreso,
      catalogo_media_id: productoSeleccionado.id,
      docenas,
      total_pares: pares,
      ubicacion_id: formIngreso.salon_id,
      estado: 'almacenado',
      detalles_contenido: [{
        sku: productoSeleccionado.sku || productoSeleccionado.codigo,
        codigo: productoSeleccionado.codigo,
        docenas,
        pares
      }]
    })

    if (error) {
      toast.error('Error al registrar el ingreso: ' + error.message)
      setGuardandoIngreso(false)
      return
    }

    // Registrar movimiento de stock
    await supabase.from('movimientos_stock').insert({
      tipo: 'ingreso_directo',
      referencia: `${codigoIngreso} — ${formIngreso.nota || 'Ingreso directo de stock'}`,
      ubicacion_id: formIngreso.salon_id,
      docenas
    })

    toast.success(
      `✅ ${docenas} docenas (${pares} pares) de ${productoSeleccionado.modelo} ingresadas a ${salon?.nombre}`,
      { duration: 5000 }
    )

    setShowModalIngreso(false)
    setProductoSeleccionado(null)
    setBusquedaCatalogo('')
    setFormIngreso({ docenas: '', salon_id: '', nota: '' })
    setGuardandoIngreso(false)
    cargarDatos()
  }

  // ── MÉTRICAS DE OCUPACIÓN Y LLENADO LOGÍSTICO POR SALÓN EN TIEMPO REAL ─────
  const salonesStats = useMemo(() => {
    return ubicaciones.map(ub => {
      const paquetesSalon = paquetes.filter(p => p.ubicacion?.id === ub.id && p.estado === 'almacenado')
      const countSacos = paquetesSalon.length
      const totalDocenas = paquetesSalon.reduce((sum, p) => sum + p.docenas, 0)
      const totalPares = paquetesSalon.reduce((sum, p) => sum + (p.total_pares || p.docenas * 12), 0)

      // Desglose de medias por SKU en este salón
      const skuMap: Record<string, { sku: string; codigo: string; docenas: number; pares: number }> = {}
      paquetesSalon.forEach(p => {
        if (p.detalles_contenido && p.detalles_contenido.length > 0) {
          p.detalles_contenido.forEach(item => {
            const key = item.sku || item.codigo || 'SKU-VARIADO'
            if (!skuMap[key]) {
              skuMap[key] = { sku: key, codigo: item.codigo || key, docenas: 0, pares: 0 }
            }
            skuMap[key].docenas += item.docenas || 0
            skuMap[key].pares += item.pares || (item.docenas * 12) || 0
          })
        } else {
          const key = p.catalogo_media?.sku || p.catalogo_media?.codigo || 'SKU-MEDIAS'
          if (!skuMap[key]) {
            skuMap[key] = { sku: key, codigo: p.catalogo_media?.codigo || key, docenas: 0, pares: 0 }
          }
          skuMap[key].docenas += p.docenas || 0
          skuMap[key].pares += p.total_pares || (p.docenas * 12) || 0
        }
      })

      const skusDesglose = Object.values(skuMap)

      return {
        ...ub,
        countSacos,
        totalDocenas,
        totalPares,
        skusDesglose
      }
    })
  }, [ubicaciones, paquetes])

  // Paquetes filtrados en tabla
  const paquetesFiltrados = useMemo(() => {
    return paquetes.filter(p => {
      if (filtroUbicacion !== 'todas' && p.ubicacion?.id !== filtroUbicacion) return false
      if (filtroEstado !== 'todos' && p.estado !== filtroEstado) return false
      if (busqueda.trim()) {
        const term = busqueda.toLowerCase()
        return p.codigo_paquete.toLowerCase().includes(term) ||
               (p.preparador?.nombre && p.preparador.nombre.toLowerCase().includes(term)) ||
               (p.catalogo_media?.sku && p.catalogo_media.sku.toLowerCase().includes(term)) ||
               (p.catalogo_media?.codigo && p.catalogo_media.codigo.toLowerCase().includes(term))
      }
      return true
    })
  }, [paquetes, filtroUbicacion, filtroEstado, busqueda])

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── HEADER SUPERIOR ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Warehouse className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Almacén y Salones Logísticos</h1>
            <p className="text-slate-400 text-xs font-medium">Recepción por pistola escáner de Sacos Maestros (Bolsas Grandes), desglose por SKU de media y control de ocupación en Salones</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowModalIngreso(true); setFormIngreso(f => ({ ...f, salon_id: ubicaciones[0]?.id || '' })) }}
            className="btn-primary text-xs py-2.5 px-4 rounded-2xl flex items-center gap-2 font-bold bg-emerald-600 hover:bg-emerald-500 border-none shadow-lg shadow-emerald-600/20"
          >
            <PackagePlus className="w-4 h-4" /> Ingreso Directo de Stock
          </button>
          <button onClick={cargarDatos} className="btn-secondary text-xs py-2 px-3 rounded-2xl flex items-center gap-1.5 font-bold">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>
      </div>

      {/* ── RECEPTOR POR PISTOLA ESCÁNER DE CÓDIGO DE BARRAS / QR ─────────────── */}
      <div className="glass rounded-3xl p-6 border border-cyan-500/30 bg-cyan-500/[0.01] shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <Scan className="w-5 h-5 text-cyan-400 animate-pulse" />
            <h2 className="text-base font-black text-white uppercase tracking-wider">
              Receptor por Pistola Escáner de Código de Barras / QR (Saco Maestro)
            </h2>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-cyan-300 cursor-pointer bg-cyan-500/10 py-1.5 px-3 rounded-xl border border-cyan-500/20">
            <input
              type="checkbox"
              checked={autoConfirmar}
              onChange={e => setAutoConfirmar(e.target.checked)}
              className="checkbox checkbox-xs checkbox-accent"
            />
            <span>⚡ Modo Ultra-Rápido (Auto-Confirmar al escanear)</span>
          </label>
        </div>

        <form onSubmit={handleScanSubmit} className="flex gap-3">
          <div className="relative flex-1">
            <Barcode className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400" />
            <input
              type="text"
              autoFocus
              placeholder="Apunta la pistola escáner sobre el QR o código de barras del Saco (ej. B-1005)..."
              value={inputEscaner}
              onChange={e => setInputEscaner(e.target.value)}
              className="input-dark pl-11 py-3 text-xs font-mono font-bold text-cyan-300 border-cyan-500/30 w-full"
            />
          </div>
          <button type="submit" className="btn-primary py-3 px-6 bg-cyan-600 hover:bg-cyan-500 border-none font-bold text-xs shadow-lg shadow-cyan-600/20">
            <Scan className="w-4 h-4" /> Escanear Saco
          </button>
        </form>

        {/* TARJETA DETECTADA DEL SACO MAESTRO */}
        {sacoDetectado && (
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-cyan-500/40 space-y-4 animate-fadeIn">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="badge bg-emerald-500/20 text-emerald-300 border-emerald-500/30 font-bold text-[10px]">
                    Saco Maestro Detectado
                  </span>
                  <code className="text-xl font-black text-cyan-300 font-mono">{sacoDetectado.codigo_saco}</code>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">Empacador: <strong className="text-white">{sacoDetectado.preparador_nombre}</strong></p>
              </div>

              {/* SALÓN DESTINO GIGANTE */}
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-right">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">📍 SALÓN DESTINO ASIGNADO:</span>
                <span className="text-lg font-black text-emerald-300 font-mono uppercase">
                  {sacoDetectado.salon_destino_nombre}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Packs / Docenas</span>
                <span className="text-lg font-black text-white font-mono">{sacoDetectado.total_docenas} doc.</span>
              </div>
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Pares (12/pack)</span>
                <span className="text-lg font-black text-emerald-400 font-mono">{sacoDetectado.total_pares} PARES</span>
              </div>
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] sm:col-span-2 text-left">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Desglose de SKUs en Saco:</span>
                {sacoDetectado.items.map((i, idx) => (
                  <p key={idx} className="text-xs text-slate-200 font-mono truncate">
                    <strong className="text-cyan-300">{i.sku}</strong> — {i.docenas} doc ({i.pares} pares)
                  </p>
                ))}
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setSacoDetectado(null)} className="btn-secondary py-2 px-4 text-xs">Descartar</button>
              <button
                onClick={() => confirmarAlmacenarSaco()}
                disabled={procesandoEscaneo}
                className="btn-primary py-2 px-6 bg-emerald-600 hover:bg-emerald-500 border-none font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center gap-1.5"
              >
                {procesandoEscaneo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirmar e Ingresar a {sacoDetectado.salon_destino_nombre}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── MONITOR DE LLENADO Y OCUPACIÓN EN TIEMPO REAL POR SALÓN ─────────── */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-400" />
          Métricas de Ocupación Logística de Salones en Tiempo Real
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {salonesStats.map(sal => (
            <div key={sal.id} className="glass rounded-3xl p-5 border border-white/[0.08] flex flex-col justify-between space-y-4 shadow-xl">
              <div>
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-300 font-bold flex items-center justify-center text-sm border border-emerald-500/30">
                      📍
                    </div>
                    <div>
                      <h3 className="font-black text-white text-base">{sal.nombre}</h3>
                      <span className="text-[10px] text-slate-400 uppercase font-bold">Salón Almacenamiento</span>
                    </div>
                  </div>

                  <span className="badge bg-emerald-500/20 text-emerald-300 border-emerald-500/30 font-bold text-xs">
                    {sal.countSacos} Sacos
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/[0.04]">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Packs Docenas</span>
                    <span className="text-lg font-black text-white font-mono">{sal.totalDocenas} doc.</span>
                  </div>
                  <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/[0.04]">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Pares Almacenados</span>
                    <span className="text-lg font-black text-emerald-400 font-mono">{sal.totalPares} PARES</span>
                  </div>
                </div>

                {/* DESGLOSE DESPLEGABLE DE MEDIAS POR ALMACÉN */}
                <div className="mt-4 p-3 rounded-2xl bg-slate-900/80 border border-emerald-500/20 space-y-2">
                  <div
                    onClick={() => setSalonesDesplegados(prev => ({ ...prev, [sal.id]: !prev[sal.id] }))}
                    className="flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity select-none"
                  >
                    <span className="text-xs text-cyan-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                      🧦 Medias en Almacén ({sal.skusDesglose.length} Tipos)
                    </span>
                    <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                      {salonesDesplegados[sal.id] ? '▲ Ocultar' : '▼ Ver Productos'}
                    </span>
                  </div>

                  {/* CONTENIDO DESPLEGABLE */}
                  {salonesDesplegados[sal.id] && (
                    <div className="pt-2 space-y-2 animate-fadeIn">
                      {sal.skusDesglose.length === 0 ? (
                        <p className="text-xs text-slate-500 italic py-1">Sin medias almacenadas aún</p>
                      ) : (
                        <>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {sal.skusDesglose.map((item, idx) => (
                              <div key={idx} className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between gap-2 text-xs">
                                <div className="truncate">
                                  <span className="font-mono font-bold text-emerald-300 block text-xs truncate">
                                    {item.sku}
                                  </span>
                                  <span className="text-[10px] text-slate-400 block truncate">
                                    {item.codigo}
                                  </span>
                                </div>
                                <div className="text-right whitespace-nowrap">
                                  <span className="font-mono font-black text-white text-xs block">
                                    {item.docenas} doc.
                                  </span>
                                  <span className="font-mono text-[10px] text-emerald-400 font-bold block">
                                    {item.pares} pares
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSalonModalProductos(sal)
                              setBusquedaProductoModal('')
                            }}
                            className="btn-secondary w-full justify-center py-1.5 text-xs text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/10 font-bold flex items-center gap-1 mt-2"
                          >
                            <Search className="w-3.5 h-3.5" /> Ver Lista Completa / Buscar en {sal.nombre}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Estado de Ocupación:</span>
                <span className="text-emerald-400 font-bold font-mono">
                  {sal.totalPares > 0 ? `🟢 ${sal.totalPares} Pares Disponibles` : '⚪ Salón Disponible'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── TABLA DE SACOS Y PAQUETES ALMACENADOS EN SALONES ──────────────────── */}
      <div className="glass rounded-3xl p-6 border border-white/[0.08] space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Box className="w-5 h-5 text-cyan-400" />
            Inventario de Sacos y Paquetes en Salones
          </h2>

          <div className="flex items-center gap-2 flex-wrap text-xs">
            <select
              value={filtroUbicacion}
              onChange={e => setFiltroUbicacion(e.target.value)}
              className="input-dark py-1.5 px-3 text-xs font-bold text-cyan-300 border-cyan-500/30"
            >
              <option value="todas">Todos los Salones</option>
              {ubicaciones.map(u => (
                <option key={u.id} value={u.id}>📍 {u.nombre}</option>
              ))}
            </select>

            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
              className="input-dark py-1.5 px-3 text-xs font-bold text-slate-300"
            >
              <option value="todos">Todos los Estados</option>
              <option value="almacenado">Almacenado en Salón</option>
              <option value="pendiente_almacenar">Pendiente de Almacenar</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead>
              <tr>
                <th>Código Saco</th>
                <th>Salón Asignado</th>
                <th>Desglose por SKU</th>
                <th>Docenas</th>
                <th>Total Pares</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paquetesFiltrados.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-500">No hay sacos maestros registrados para este filtro</td></tr>
              ) : paquetesFiltrados.map(p => (
                <tr key={p.id}>
                  <td><code className="text-cyan-300 font-mono text-xs bg-cyan-500/10 px-2.5 py-1 rounded-lg border border-cyan-500/20 font-bold">{p.codigo_paquete}</code></td>
                  <td><span className="badge badge-info font-bold">📍 {p.ubicacion?.nombre || 'Salón A'}</span></td>
                  <td className="text-slate-300 text-xs font-mono">
                    {p.detalles_contenido && p.detalles_contenido.length > 0 ? (
                      p.detalles_contenido.map((i, idx) => (
                        <div key={idx} className="truncate">
                          <strong className="text-emerald-300">{i.sku || 'SKU-MEDIA'}</strong> ({i.docenas} doc.)
                        </div>
                      ))
                    ) : (
                      <span className="text-slate-200 font-bold">{p.catalogo_media?.sku || p.catalogo_media?.codigo || 'SKU-VARIADO'}</span>
                    )}
                  </td>
                  <td className="font-bold text-white font-mono">{p.docenas} doc.</td>
                  <td className="font-black text-emerald-400 font-mono">{p.total_pares || p.docenas * 12} pares</td>
                  <td>
                    <span className={`badge ${p.estado === 'almacenado' ? 'badge-success' : 'badge-warning'}`}>
                      {p.estado === 'almacenado' ? 'Almacenado en Salón' : 'Pendiente de Almacenar'}
                    </span>
                  </td>
                  <td className="text-right">
                    {p.estado !== 'almacenado' && (
                      <button
                        onClick={async () => {
                          const v = validarTransicionEstadoPaquete(p.estado as any, 'almacenado')
                          if (!v.valido) {
                            toast.error(`Error en paquete: ${v.error}`)
                            return
                          }
                          const salonA = ubicaciones[0]?.id || ''
                          await supabase.from('paquetes').update({ estado: 'almacenado', ubicacion_id: salonA }).eq('id', p.id)
                          toast.success(`Saco ${p.codigo_paquete} asignado a ${ubicaciones[0]?.nombre || 'Salón A'}`)
                          cargarDatos()
                        }}
                        className="btn-primary py-1 px-3 text-xs bg-emerald-600 border-none font-bold"
                      >
                        Confirmar Almacenamiento
                      </button>

                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODAL: VER / BUSCAR TODOS LOS PRODUCTOS DE UN ALMACÉN ───────────── */}
      {salonModalProductos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-2xl p-7 shadow-2xl border border-cyan-500/30 animate-fadeInUp max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.08] mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 text-cyan-300 font-bold flex items-center justify-center border border-cyan-500/30 text-lg">
                  📍
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">{salonModalProductos.nombre}</h2>
                  <p className="text-xs text-slate-400 font-medium">
                    Catálogo de productos almacenados · {salonModalProductos.skusDesglose.length} tipos de medias
                  </p>
                </div>
              </div>

              <button onClick={() => setSalonModalProductos(null)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* BUSCADOR DENTRO DEL MODAL */}
            <div className="relative mb-4">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-cyan-400" />
              <input
                type="text"
                placeholder="Buscar por SKU o tipo de media..."
                value={busquedaProductoModal}
                onChange={e => setBusquedaProductoModal(e.target.value)}
                className="input-dark pl-10 text-xs py-2.5 w-full font-semibold text-white"
              />
            </div>

            {/* TABLA DE PRODUCTOS EN ESTE SALÓN */}
            <div className="flex-1 overflow-y-auto pr-1">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 font-bold sticky top-0 border-b border-white/[0.08]">
                  <tr>
                    <th className="p-3">SKU Media</th>
                    <th className="p-3">Nombre / Variante</th>
                    <th className="p-3 text-center">Packs (Docenas)</th>
                    <th className="p-3 text-right">Total Pares</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {salonModalProductos.skusDesglose
                    .filter((item: any) => {
                      if (!busquedaProductoModal.trim()) return true
                      const term = busquedaProductoModal.toLowerCase()
                      return item.sku.toLowerCase().includes(term) || item.codigo.toLowerCase().includes(term)
                    })
                    .map((item: any, idx: number) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="p-3 font-mono font-bold text-cyan-300">{item.sku}</td>
                        <td className="p-3 text-slate-200 font-medium">{item.codigo}</td>
                        <td className="p-3 text-center font-mono font-bold text-white">{item.docenas} doc.</td>
                        <td className="p-3 text-right font-mono font-black text-emerald-400">{item.pares} PARES</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="pt-4 mt-4 border-t border-white/[0.08] flex justify-between items-center text-xs">
              <span className="text-slate-400">Total Almacenado en {salonModalProductos.nombre}:</span>
              <span className="font-mono font-black text-emerald-400 text-sm">
                {salonModalProductos.totalPares} PARES DISPONIBLES
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: INGRESO DIRECTO DE STOCK ─────────────────────────────────── */}
      {showModalIngreso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-xl shadow-2xl border border-emerald-500/40 flex flex-col max-h-[90vh] animate-fadeInUp">
            {/* Header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30">
                  <PackagePlus className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">Ingreso Directo de Stock</h2>
                  <p className="text-xs text-slate-400">Registra producto terminado ya existente en los salones</p>
                </div>
              </div>
              <button onClick={() => setShowModalIngreso(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-7 py-6 space-y-5">

              {/* Paso 1: Buscar producto */}
              <div className="space-y-3">
                <label className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-black flex items-center justify-center">1</span>
                  Seleccionar Producto del Catálogo
                </label>

                {/* Producto ya seleccionado */}
                {productoSeleccionado ? (
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono font-black text-emerald-300 text-sm">{productoSeleccionado.sku || productoSeleccionado.codigo}</p>
                      <p className="text-xs text-slate-300 mt-0.5">
                        {productoSeleccionado.modelo} · {productoSeleccionado.publico} · {productoSeleccionado.diseno_color} · Talla {productoSeleccionado.talla}
                      </p>
                    </div>
                    <button
                      onClick={() => { setProductoSeleccionado(null); setBusquedaCatalogo('') }}
                      className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        autoFocus
                        placeholder="Busca por SKU, código o nombre del producto..."
                        value={busquedaCatalogo}
                        onChange={e => setBusquedaCatalogo(e.target.value)}
                        className="input-dark pl-10 text-sm w-full py-2.5 font-medium"
                      />
                    </div>
                    {busquedaCatalogo.trim().length >= 1 && (
                      <div className="rounded-2xl border border-white/[0.08] bg-slate-900/90 max-h-48 overflow-y-auto">
                        {catalogoItems
                          .filter(item => {
                            const term = busquedaCatalogo.toLowerCase()
                            return (
                              (item.sku && item.sku.toLowerCase().includes(term)) ||
                              item.codigo.toLowerCase().includes(term) ||
                              item.modelo.toLowerCase().includes(term) ||
                              item.publico.toLowerCase().includes(term) ||
                              item.diseno_color.toLowerCase().includes(term)
                            )
                          })
                          .slice(0, 10)
                          .map(item => (
                            <button
                              key={item.id}
                              onClick={() => { setProductoSeleccionado(item); setBusquedaCatalogo('') }}
                              className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.05] text-left border-b border-white/[0.04] last:border-0 transition-colors"
                            >
                              <div>
                                <p className="font-mono font-bold text-emerald-300 text-xs">{item.sku || item.codigo}</p>
                                <p className="text-xs text-slate-400">{item.modelo} · {item.publico} · {item.diseno_color} · T.{item.talla}</p>
                              </div>
                              <Plus className="w-4 h-4 text-slate-500 flex-shrink-0" />
                            </button>
                          ))}
                        {catalogoItems.filter(item => {
                          const term = busquedaCatalogo.toLowerCase()
                          return (
                            (item.sku && item.sku.toLowerCase().includes(term)) ||
                            item.codigo.toLowerCase().includes(term) ||
                            item.modelo.toLowerCase().includes(term) ||
                            item.publico.toLowerCase().includes(term) ||
                            item.diseno_color.toLowerCase().includes(term)
                          )
                        }).length === 0 && (
                          <p className="px-4 py-4 text-xs text-slate-500 text-center">Sin resultados para "{busquedaCatalogo}"</p>
                        )}
                      </div>
                    )}
                    {busquedaCatalogo.trim().length === 0 && (
                      <p className="text-xs text-slate-500 text-center py-2">Escribe el SKU o nombre del producto para buscarlo</p>
                    )}
                  </div>
                )}
              </div>

              {/* Paso 2: Cantidad y Salón */}
              {productoSeleccionado && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Docenas */}
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-black flex items-center justify-center">2</span>
                        Cantidad (Docenas)
                      </label>
                      <input
                        type="number"
                        min="1"
                        placeholder="Ej: 20"
                        value={formIngreso.docenas}
                        onChange={e => setFormIngreso(f => ({ ...f, docenas: e.target.value }))}
                        className="input-dark text-lg font-black text-emerald-400 font-mono text-center py-3 w-full"
                      />
                      {formIngreso.docenas && Number(formIngreso.docenas) > 0 && (
                        <p className="text-center text-xs text-slate-400 font-mono">
                          = <strong className="text-emerald-400">{Number(formIngreso.docenas) * 12} pares</strong>
                        </p>
                      )}
                    </div>

                    {/* Salón */}
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-black flex items-center justify-center">3</span>
                        Salón Destino
                      </label>
                      <select
                        value={formIngreso.salon_id}
                        onChange={e => setFormIngreso(f => ({ ...f, salon_id: e.target.value }))}
                        className="input-dark py-3 font-bold text-sm text-cyan-300 w-full"
                      >
                        <option value="">Seleccionar salón...</option>
                        {ubicaciones.map(u => (
                          <option key={u.id} value={u.id}>📍 {u.nombre}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Nota opcional */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nota / Motivo (opcional)</label>
                    <input
                      type="text"
                      placeholder="Ej: Stock existente en salón, Reingreso, Compra externa..."
                      value={formIngreso.nota}
                      onChange={e => setFormIngreso(f => ({ ...f, nota: e.target.value }))}
                      className="input-dark text-sm py-2.5 w-full"
                    />
                  </div>

                  {/* Resumen */}
                  {formIngreso.docenas && formIngreso.salon_id && (
                    <div className="p-4 rounded-2xl bg-slate-900/80 border border-emerald-500/20 space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Resumen del Ingreso</p>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                          <p className="text-[10px] text-slate-400 uppercase font-bold">Producto</p>
                          <p className="text-xs font-black text-emerald-300 truncate mt-0.5">{productoSeleccionado.modelo}</p>
                          <p className="text-[10px] text-slate-400 truncate">{productoSeleccionado.publico} · T.{productoSeleccionado.talla}</p>
                        </div>
                        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                          <p className="text-[10px] text-slate-400 uppercase font-bold">Cantidad</p>
                          <p className="text-lg font-black text-white font-mono">{formIngreso.docenas}</p>
                          <p className="text-[10px] text-emerald-400 font-bold">{Number(formIngreso.docenas)*12} pares</p>
                        </div>
                        <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                          <p className="text-[10px] text-slate-400 uppercase font-bold">Salón</p>
                          <p className="text-xs font-black text-cyan-300 truncate mt-0.5">📍 {ubicaciones.find(u=>u.id===formIngreso.salon_id)?.nombre}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer botones */}
            <div className="px-7 py-5 border-t border-white/[0.08] flex items-center justify-between gap-3">
              <button
                onClick={() => setShowModalIngreso(false)}
                className="btn-secondary py-2.5 px-5 text-sm font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={ingresarStockDirecto}
                disabled={guardandoIngreso || !productoSeleccionado || !formIngreso.docenas || !formIngreso.salon_id}
                className="btn-primary py-2.5 px-7 bg-emerald-600 hover:bg-emerald-500 border-none font-black text-sm shadow-lg shadow-emerald-600/20 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {guardandoIngreso ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirmar Ingreso al Stock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
