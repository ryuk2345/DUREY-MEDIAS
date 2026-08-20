// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Truck, CheckCircle2, AlertTriangle, Loader2, X, Upload, Check, FileText,
  Keyboard, Scan, Plus, Minus, Package, Barcode, ClipboardList, History,
  Calendar, User, ArrowRight, MapPin
} from 'lucide-react'
import { toast } from 'sonner'
import { formatearFecha, formatearMoneda, generarCodigoGuia } from '@/lib/utils'

// ── TIPOS ──────────────────────────────────────────────────────────────────
interface Venta {
  id: string
  codigo_venta: string
  estado: string
  fecha: string
  total_soles: number
  cliente: { nombre: string; numero_documento: string }
  items_venta: {
    id: string
    catalogo_media_id: string
    docenas: number
    catalogo_media: { id: string; codigo: string; sku: string; modelo: string; publico: string; diseno_color: string }
  }[]
}

interface LineaEscaneada {
  catalogo_media_id: string
  codigo: string
  sku: string
  modelo: string
  publico: string
  diseno_color: string
  docenas_requeridas: number
  docenas_escaneadas: number
}

interface CatalogoMedia {
  id: string
  codigo: string
  sku: string
  modelo: string
  publico: string
  diseno_color: string
  talla: string
}

interface GuiaRemision {
  id: string
  codigo_guia: string
  agencia: string
  estado: string
  fecha_despacho: string
  fecha_entrega?: string
  venta: {
    codigo_venta: string
    total_soles: number
    fecha: string
    cliente: { nombre: string; numero_documento: string }
    items_venta: {
      docenas: number
      catalogo_media: { codigo: string; sku: string; modelo: string; publico: string }
    }[]
  }
}

const AGENCIAS = ['Shalom', 'Olva Courier', 'Marvisur', 'Flores Cargo']

// ── COMPONENTE PRINCIPAL ───────────────────────────────────────────────────
export default function DespachoPage() {
  const supabase = createClient()

  // Vista activa: 'despacho' = panel de trabajo | 'kardex' = historial
  const [vistaActiva, setVistaActiva] = useState<'despacho' | 'kardex'>('despacho')

  // Datos
  const [ventasPendientes, setVentasPendientes] = useState<Venta[]>([])
  const [guias, setGuias] = useState<GuiaRemision[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  const [stockPorMedia, setStockPorMedia] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState(false)

  // Panel de escaneo
  const [ventaSeleccionada, setVentaSeleccionada] = useState<Venta | null>(null)
  const [lineas, setLineas] = useState<LineaEscaneada[]>([])
  const [modoEscaneo, setModoEscaneo] = useState<'pistola' | 'manual'>('pistola')
  const [inputSku, setInputSku] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Modales
  const [showDespachoModal, setShowDespachoModal] = useState(false)
  const [agenciaSeleccionada, setAgenciaSeleccionada] = useState('')
  const [showEntregaModal, setShowEntregaModal] = useState(false)
  const [archivoFirma, setArchivoFirma] = useState<File | null>(null)
  const [guiaParaEntrega, setGuiaParaEntrega] = useState<GuiaRemision | null>(null)

  // Filtro kardex
  const [filtroKardex, setFiltroKardex] = useState<'todos' | 'en_transito' | 'entregado'>('todos')
  const [busquedaKardex, setBusquedaKardex] = useState('')

  // ── CARGA DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [venRes, guiRes, catRes, paqRes] = await Promise.all([
      // Solo ventas PENDIENTES de despacho
      supabase.from('ventas').select(`
        id, codigo_venta, estado, fecha, total_soles,
        cliente:clientes(nombre, numero_documento),
        items_venta(
          id, catalogo_media_id, docenas,
          catalogo_media:catalogo_medias(id, codigo, sku, modelo, publico, diseno_color)
        )
      `).eq('estado', 'pendiente').order('created_at', { ascending: false }),

      // Guías de remisión (kardex)
      supabase.from('guias_remision').select(`
        id, codigo_guia, agencia, estado, fecha_despacho, fecha_entrega,
        venta:ventas(
          codigo_venta, total_soles, fecha,
          cliente:clientes(nombre, numero_documento),
          items_venta(
            docenas,
            catalogo_media:catalogo_medias(codigo, sku, modelo, publico)
          )
        )
      `).order('fecha_despacho', { ascending: false }),

      supabase.from('catalogo_medias').select('id, codigo, sku, modelo, publico, diseno_color, talla'),
      supabase.from('paquetes').select('catalogo_media_id, docenas').in('estado', ['almacenado', 'pendiente_almacenar']),
    ])

    if (venRes.error) toast.error(`Error al cargar ventas: ${venRes.error.message}`)
    if (catRes.error) toast.error(`Error al cargar catálogo: ${catRes.error.message}`)

    setVentasPendientes((venRes.data ?? []) as unknown as Venta[])
    setGuias((guiRes.data ?? []) as unknown as GuiaRemision[])
    setCatalogo((catRes.data ?? []) as CatalogoMedia[])

    const stockMap: Record<string, number> = {}
    for (const p of paqRes.data ?? []) {
      if (!p.catalogo_media_id) continue
      stockMap[p.catalogo_media_id] = (stockMap[p.catalogo_media_id] ?? 0) + Number(p.docenas ?? 0)
    }
    setStockPorMedia(stockMap)
    setLoading(false)
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  useEffect(() => {
    if (modoEscaneo === 'pistola' && ventaSeleccionada && inputRef.current) {
      inputRef.current.focus()
    }
  }, [modoEscaneo, ventaSeleccionada])

  // ── SELECCIONAR VENTA ────────────────────────────────────────────────────
  const seleccionarVenta = (venta: Venta) => {
    setVentaSeleccionada(venta)
    setInputSku('')
    const lineasIniciales: LineaEscaneada[] = (venta.items_venta ?? []).map(item => ({
      catalogo_media_id: item.catalogo_media_id,
      codigo: item.catalogo_media?.codigo ?? '',
      sku: item.catalogo_media?.sku ?? item.catalogo_media?.codigo ?? '',
      modelo: item.catalogo_media?.modelo ?? '',
      publico: item.catalogo_media?.publico ?? '',
      diseno_color: item.catalogo_media?.diseno_color ?? '',
      docenas_requeridas: Number(item.docenas),
      docenas_escaneadas: 0,
    }))
    setLineas(lineasIniciales)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // ── ESCANEO ──────────────────────────────────────────────────────────────
  const resolverMedia = (raw: string): CatalogoMedia | null => {
    const q = raw.trim().toUpperCase()
    return catalogo.find(m => (m.sku ?? '').toUpperCase() === q || m.codigo.toUpperCase() === q) ?? null
  }

  const registrarEscaneo = (mediaId: string) => {
    setLineas(prev => {
      const idx = prev.findIndex(l => l.catalogo_media_id === mediaId)
      if (idx === -1) {
        const media = catalogo.find(m => m.id === mediaId)
        toast.error(`La media ${media?.sku ?? ''} no pertenece a esta venta`)
        return prev
      }
      const linea = prev[idx]
      if (linea.docenas_escaneadas >= linea.docenas_requeridas) {
        toast.warning(`Ya alcanzaste el máximo para ${linea.codigo}`)
        return prev
      }
      const copia = [...prev]
      copia[idx] = { ...linea, docenas_escaneadas: linea.docenas_escaneadas + 1 }
      return copia
    })
  }

  const handlePistolaSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const raw = inputSku.trim()
    if (!raw) return
    const media = resolverMedia(raw)
    if (!media) {
      toast.error(`SKU no reconocido: "${raw}"`)
      setInputSku('')
      return
    }
    registrarEscaneo(media.id)
    setInputSku('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleManualAgregar = (mediaId: string, delta: number) => {
    setLineas(prev => {
      const idx = prev.findIndex(l => l.catalogo_media_id === mediaId)
      if (idx === -1) return prev
      const linea = prev[idx]
      const nuevas = Math.max(0, Math.min(linea.docenas_requeridas, linea.docenas_escaneadas + delta))
      const copia = [...prev]
      copia[idx] = { ...linea, docenas_escaneadas: nuevas }
      return copia
    })
  }

  const quitarLinea = (mediaId: string) => {
    setLineas(prev => prev.map(l => l.catalogo_media_id === mediaId ? { ...l, docenas_escaneadas: 0 } : l))
  }

  const totalRequerido = lineas.reduce((s, l) => s + l.docenas_requeridas, 0)
  const totalEscaneado = lineas.reduce((s, l) => s + l.docenas_escaneadas, 0)
  const listoParaDespachar = lineas.length > 0 && lineas.every(l => l.docenas_escaneadas >= l.docenas_requeridas)
  const hayStockInsuficiente = lineas.some(l => (stockPorMedia[l.catalogo_media_id] ?? 0) < l.docenas_requeridas)

  // ── DESPACHAR ────────────────────────────────────────────────────────────
  const despacharVenta = async () => {
    if (!ventaSeleccionada || !agenciaSeleccionada) {
      toast.error('Selecciona una agencia de transporte')
      return
    }
    setProcesando(true)
    try {
      const { count } = await supabase.from('guias_remision').select('*', { count: 'exact', head: true })
      const codigoGuia = generarCodigoGuia((count ?? 0) + 9001)

      // Descontar paquetes del almacén
      for (const linea of lineas) {
        let docenasFaltantes = linea.docenas_escaneadas
        const { data: paqDisp } = await supabase
          .from('paquetes').select('id, docenas')
          .eq('catalogo_media_id', linea.catalogo_media_id)
          .in('estado', ['almacenado', 'pendiente_almacenar'])
          .order('created_at', { ascending: true })

        for (const paq of paqDisp ?? []) {
          if (docenasFaltantes <= 0) break
          await supabase.from('paquetes').update({ venta_id: ventaSeleccionada.id, estado: 'en_transito' }).eq('id', paq.id)
          docenasFaltantes -= Number(paq.docenas)
        }
      }

      // Crear guía de remisión
      const { error: errorGuia } = await supabase.from('guias_remision').insert({
        codigo_guia: codigoGuia,
        venta_id: ventaSeleccionada.id,
        agencia: agenciaSeleccionada,
        estado: 'en_transito'
      })
      if (errorGuia) throw errorGuia

      // Venta queda como despachada (no en_transito — el estado es del pedido, no de la venta para el usuario)
      await supabase.from('ventas').update({ estado: 'en_transito' }).eq('id', ventaSeleccionada.id)

      // Movimientos de salida
      await supabase.from('movimientos_stock').insert(
        lineas.map(l => ({
          tipo: 'salida_venta',
          referencia: `Despacho ${ventaSeleccionada.codigo_venta} → ${agenciaSeleccionada}`,
          docenas: l.docenas_escaneadas,
        }))
      )

      toast.success(`✅ Guía ${codigoGuia} generada. Pedido despachado vía ${agenciaSeleccionada}.`)
      setShowDespachoModal(false)
      setAgenciaSeleccionada('')
      setVentaSeleccionada(null)
      setLineas([])
      cargarDatos()
      // Ir al kardex para ver el despacho recién creado
      setVistaActiva('kardex')
    } catch (err: any) {
      toast.error(`Error al despachar: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  // ── CONFIRMAR ENTREGA ────────────────────────────────────────────────────
  const confirmarEntrega = async () => {
    if (!guiaParaEntrega) return
    setProcesando(true)
    try {
      const cargoUrl = archivoFirma
        ? `firma_cargo_${guiaParaEntrega.venta?.codigo_venta}.jpg`
        : 'cargo_recibido_firmado.jpg'

      await supabase.from('guias_remision').update({
        estado: 'entregado',
        firma_cargo_url: cargoUrl,
        fecha_entrega: new Date().toISOString().split('T')[0]
      }).eq('id', guiaParaEntrega.id)

      // Buscar venta_id desde la guía y actualizar
      const { data: guiaData } = await supabase.from('guias_remision').select('venta_id').eq('id', guiaParaEntrega.id).single()
      if (guiaData?.venta_id) {
        await supabase.from('ventas').update({ estado: 'entregado' }).eq('id', guiaData.venta_id)
        await supabase.from('paquetes').update({ estado: 'entregado', ubicacion_id: null }).eq('venta_id', guiaData.venta_id)
      }

      toast.success(`Entrega confirmada. Pedido ${guiaParaEntrega.venta?.codigo_venta} cerrado.`)
      setShowEntregaModal(false)
      setArchivoFirma(null)
      setGuiaParaEntrega(null)
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al confirmar entrega: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  // ── FILTRO KARDEX ────────────────────────────────────────────────────────
  const guiasFiltradas = guias.filter(g => {
    const matchEstado = filtroKardex === 'todos' || g.estado === filtroKardex
    const q = busquedaKardex.toLowerCase()
    const matchBusqueda = !q
      || g.codigo_guia.toLowerCase().includes(q)
      || g.venta?.codigo_venta?.toLowerCase().includes(q)
      || g.venta?.cliente?.nombre?.toLowerCase().includes(q)
      || g.agencia.toLowerCase().includes(q)
    return matchEstado && matchBusqueda
  })

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fadeInUp">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl bg-blue-500/10"><Truck className="w-5 h-5 text-blue-400" /></div>
            <h1 className="text-2xl font-bold text-white">Despacho y Entregas</h1>
          </div>
          <p className="text-slate-400 text-sm ml-12">Escanea el SKU de cada media para generar guía y descontar del almacén</p>
        </div>
        {/* Tabs */}
        <div className="flex gap-2 p-1 bg-white/[0.03] rounded-xl border border-white/[0.06]">
          <button
            onClick={() => setVistaActiva('despacho')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              vistaActiva === 'despacho'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Scan className="w-4 h-4" /> Despachar
          </button>
          <button
            onClick={() => setVistaActiva('kardex')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              vistaActiva === 'kardex'
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <History className="w-4 h-4" /> Kárdex de Despachos
            {guias.filter(g => g.estado === 'en_transito').length > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {guias.filter(g => g.estado === 'en_transito').length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          VISTA 1: PANEL DE DESPACHO
      ════════════════════════════════════════════════════════════════════ */}
      {vistaActiva === 'despacho' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Columna izquierda: Pedidos pendientes */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Pedidos por Despachar</h2>
              <span className="text-xs text-slate-500">{ventasPendientes.length} pendiente{ventasPendientes.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="glass rounded-2xl p-4 space-y-3 max-h-[75vh] overflow-y-auto">
              {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-blue-400" /></div>
              ) : ventasPendientes.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-slate-500">
                  <CheckCircle2 className="w-10 h-10 mb-2 opacity-20" />
                  <p className="text-sm font-medium">Sin pedidos pendientes</p>
                  <p className="text-xs mt-1 text-slate-600">Todos los pedidos han sido despachados</p>
                </div>
              ) : (
                ventasPendientes.map(v => (
                  <button
                    key={v.id}
                    onClick={() => seleccionarVenta(v)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      ventaSeleccionada?.id === v.id
                        ? 'border-blue-400 bg-blue-500/10 shadow-lg shadow-blue-500/5'
                        : 'border-white/[0.06] hover:border-white/12 hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <code className="text-blue-300 font-mono text-xs bg-blue-500/15 px-2 py-0.5 rounded">{v.codigo_venta}</code>
                      <span className="badge badge-warning text-[10px]">Pendiente</span>
                    </div>
                    <p className="text-white font-medium text-sm truncate">{v.cliente?.nombre}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
                      <span>{formatearFecha(v.fecha)}</span>
                      <span className="font-semibold text-emerald-400">{formatearMoneda(v.total_soles)}</span>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1">{v.items_venta?.length ?? 0} tipo(s) de media</p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Columna derecha: Panel de escaneo */}
          <div className="lg:col-span-2 space-y-4">
            {ventaSeleccionada ? (
              <div className="glass rounded-2xl p-6 space-y-6">
                {/* Cabecera */}
                <div className="flex justify-between items-start border-b border-white/[0.06] pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Pedido {ventaSeleccionada.codigo_venta}</h3>
                    <p className="text-slate-400 text-sm">Cliente: {ventaSeleccionada.cliente?.nombre} ({ventaSeleccionada.cliente?.numero_documento})</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {totalEscaneado} / {totalRequerido} doc. escaneadas
                      {listoParaDespachar && <span className="text-emerald-400 font-semibold ml-2">✓ Listo</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDespachoModal(true)}
                    disabled={!listoParaDespachar || hayStockInsuficiente}
                    title={hayStockInsuficiente ? 'Stock insuficiente en almacén' : !listoParaDespachar ? 'Completa el escaneo primero' : ''}
                    className={`btn-primary text-sm ${(!listoParaDespachar || hayStockInsuficiente) ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <FileText className="w-4 h-4" />
                    {hayStockInsuficiente ? '⛔ Sin Stock' : 'Generar Guía'}
                  </button>
                </div>

                {/* Selector de modo */}
                <div className="flex gap-2 p-1 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                  <button
                    onClick={() => setModoEscaneo('pistola')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      modoEscaneo === 'pistola' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <Scan className="w-4 h-4" /> Pistola / Escáner
                  </button>
                  <button
                    onClick={() => setModoEscaneo('manual')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      modoEscaneo === 'manual' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <Keyboard className="w-4 h-4" /> Manual
                  </button>
                </div>

                {/* Input de escaneo */}
                {modoEscaneo === 'pistola' && (
                  <div className="p-4 rounded-xl bg-blue-500/[0.04] border border-blue-500/20 space-y-3">
                    <div className="flex items-center gap-2 text-blue-400">
                      <Barcode className="w-5 h-5" />
                      <h4 className="text-sm font-semibold">Apunta la pistola al SKU de la media</h4>
                    </div>
                    <form onSubmit={handlePistolaSubmit} className="flex gap-2">
                      <input
                        ref={inputRef}
                        type="text"
                        placeholder="SKU o código de media (ej: SKU-TOB-DAM-BLA-U)..."
                        value={inputSku}
                        onChange={e => setInputSku(e.target.value)}
                        className="input-dark flex-1 font-mono text-sm"
                        autoComplete="off"
                        autoFocus
                      />
                      <button type="submit" className="btn-primary px-5 py-2.5 text-sm">
                        <Check className="w-4 h-4" />
                      </button>
                    </form>
                    <p className="text-slate-500 text-xs">Cada escaneo suma 1 docena. El campo se limpia solo para el siguiente escaneo.</p>
                  </div>
                )}

                {modoEscaneo === 'manual' && (
                  <div className="p-4 rounded-xl bg-violet-500/[0.04] border border-violet-500/20">
                    <div className="flex items-center gap-2 text-violet-400">
                      <Keyboard className="w-5 h-5" />
                      <h4 className="text-sm font-semibold">Usa los botones + / − de cada fila para ajustar manualmente</h4>
                    </div>
                  </div>
                )}

                {/* Tabla de medias */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Package className="w-4 h-4" /> Medias del Pedido
                  </h4>
                  <div className="space-y-2">
                    {lineas.map(linea => {
                      const completado = linea.docenas_escaneadas >= linea.docenas_requeridas
                      const pct = Math.min(100, Math.round((linea.docenas_escaneadas / linea.docenas_requeridas) * 100))
                      const stockDisp = stockPorMedia[linea.catalogo_media_id] ?? 0
                      const sinStock = stockDisp < linea.docenas_requeridas

                      return (
                        <div
                          key={linea.catalogo_media_id}
                          className={`p-4 rounded-xl border transition-all ${
                            completado ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                            : linea.docenas_escaneadas > 0 ? 'border-amber-500/30 bg-amber-500/[0.03]'
                            : 'border-white/[0.06] bg-white/[0.01]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                {completado ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <Package className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                                <code className="text-xs font-mono text-blue-300 font-semibold">{linea.sku || linea.codigo}</code>
                              </div>
                              <p className="text-xs text-slate-500 ml-6 capitalize">{linea.modelo} · {linea.publico} · {linea.diseno_color}</p>
                              <div className="ml-6 mt-2">
                                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                  <span>{linea.docenas_escaneadas} / {linea.docenas_requeridas} doc.</span>
                                  <span>{pct}%</span>
                                </div>
                                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${completado ? 'bg-emerald-500' : linea.docenas_escaneadas > 0 ? 'bg-amber-500' : 'bg-slate-700'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                              <div className={`ml-6 mt-1.5 flex items-center gap-1 text-[10px] font-semibold ${
                                stockDisp === 0 ? 'text-red-400' : sinStock ? 'text-red-400' : stockDisp <= 5 ? 'text-amber-400' : 'text-emerald-400'
                              }`}>
                                <AlertTriangle className="w-3 h-3" />
                                {stockDisp === 0 ? '⛔ SIN STOCK en almacén'
                                  : sinStock ? `⛔ Stock insuficiente — Solo ${stockDisp} doc. disponibles`
                                  : stockDisp <= 5 ? `⚠️ Stock bajo — ${stockDisp} doc. en almacén`
                                  : `✓ ${stockDisp} doc. en almacén`}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {modoEscaneo === 'manual' ? (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => handleManualAgregar(linea.catalogo_media_id, -1)} disabled={linea.docenas_escaneadas <= 0}
                                    className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/10 text-slate-300 flex items-center justify-center disabled:opacity-30">
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="text-white font-bold text-sm w-8 text-center">{linea.docenas_escaneadas}</span>
                                  <button onClick={() => handleManualAgregar(linea.catalogo_media_id, +1)} disabled={linea.docenas_escaneadas >= linea.docenas_requeridas}
                                    className="w-8 h-8 rounded-lg bg-blue-600/40 hover:bg-blue-600/60 text-blue-300 flex items-center justify-center disabled:opacity-30">
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <span className={`text-sm font-bold ${completado ? 'text-emerald-400' : 'text-slate-400'}`}>
                                  {linea.docenas_escaneadas} doc.
                                </span>
                              )}
                              {linea.docenas_escaneadas > 0 && (
                                <button onClick={() => quitarLinea(linea.catalogo_media_id)}
                                  className="w-7 h-7 rounded-lg hover:bg-red-500/20 text-red-400 flex items-center justify-center">
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Resumen */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
                  <div className="text-sm text-slate-400">
                    Total: <span className="text-white font-bold">{totalEscaneado}</span> / <span>{totalRequerido}</span> docenas
                  </div>
                  {listoParaDespachar
                    ? <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Completo</span>
                    : <span className="text-xs text-amber-400 font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Faltan {totalRequerido - totalEscaneado} doc.</span>
                  }
                </div>
              </div>
            ) : (
              <div className="glass rounded-2xl flex flex-col items-center justify-center py-24 text-slate-500">
                <Truck className="w-12 h-12 mb-3 opacity-25" />
                <p className="font-medium">Selecciona un pedido para iniciar el escaneo</p>
                <p className="text-xs mt-1 text-slate-600">Usa pistola escáner o modo manual</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          VISTA 2: KÁRDEX DE DESPACHOS
      ════════════════════════════════════════════════════════════════════ */}
      {vistaActiva === 'kardex' && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Buscar por guía, pedido, cliente o agencia..."
              value={busquedaKardex}
              onChange={e => setBusquedaKardex(e.target.value)}
              className="input-dark flex-1 text-sm"
            />
            <div className="flex gap-2">
              {(['todos', 'en_transito', 'entregado'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFiltroKardex(f)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    filtroKardex === f
                      ? f === 'en_transito' ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : f === 'entregado' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                      : 'border-white/[0.06] text-slate-400 hover:border-white/12'
                  }`}
                >
                  {f === 'todos' ? 'Todos' : f === 'en_transito' ? 'En Tránsito' : 'Entregados'}
                  <span className="ml-1.5 opacity-60">
                    ({guias.filter(g => f === 'todos' || g.estado === f).length})
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Resumen rápido */}
          <div className="grid grid-cols-3 gap-4">
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{guias.length}</p>
              <p className="text-xs text-slate-400 mt-1">Total Guías</p>
            </div>
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{guias.filter(g => g.estado === 'en_transito').length}</p>
              <p className="text-xs text-slate-400 mt-1">En Tránsito</p>
            </div>
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{guias.filter(g => g.estado === 'entregado').length}</p>
              <p className="text-xs text-slate-400 mt-1">Entregados</p>
            </div>
          </div>

          {/* Lista de guías */}
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
          ) : guiasFiltradas.length === 0 ? (
            <div className="glass rounded-2xl flex flex-col items-center py-16 text-slate-500">
              <History className="w-10 h-10 mb-2 opacity-20" />
              <p className="font-medium">No hay despachos registrados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {guiasFiltradas.map(guia => (
                <div key={guia.id} className="glass rounded-2xl p-5 border border-white/[0.06] hover:border-white/10 transition-all">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    {/* Datos de guía */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <code className="text-blue-300 font-mono text-sm font-bold bg-blue-500/10 px-2.5 py-1 rounded-lg">
                          {guia.codigo_guia}
                        </code>
                        <span className={`badge text-[10px] ${guia.estado === 'en_transito' ? 'badge-warning' : 'badge-success'}`}>
                          {guia.estado === 'en_transito' ? '🚚 En Tránsito' : '✅ Entregado'}
                        </span>
                        <span className="text-xs text-slate-500 font-medium bg-slate-800 px-2 py-0.5 rounded-lg">
                          {guia.agencia}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <User className="w-3.5 h-3.5 text-slate-500" />
                          <span className="font-semibold text-white truncate">{guia.venta?.cliente?.nombre}</span>
                          <span className="text-slate-600">({guia.venta?.cliente?.numero_documento})</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <ClipboardList className="w-3.5 h-3.5 text-slate-500" />
                          <span>Pedido:</span>
                          <code className="text-blue-300 font-mono">{guia.venta?.codigo_venta}</code>
                          <span className="text-emerald-400 font-bold">{formatearMoneda(guia.venta?.total_soles ?? 0)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          <span>Despacho: <strong className="text-slate-300">{formatearFecha(guia.fecha_despacho)}</strong></span>
                          {guia.fecha_entrega && (
                            <>
                              <ArrowRight className="w-3 h-3" />
                              <span>Entrega: <strong className="text-emerald-400">{formatearFecha(guia.fecha_entrega)}</strong></span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Medias despachadas */}
                      {guia.venta?.items_venta && guia.venta.items_venta.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {guia.venta.items_venta.map((item, i) => (
                            <div key={i} className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] px-2.5 py-1 rounded-lg">
                              <code className="text-[10px] font-mono text-blue-300">{item.catalogo_media?.sku || item.catalogo_media?.codigo}</code>
                              <span className="text-[10px] text-slate-500">{item.docenas} doc.</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Acción: Confirmar entrega */}
                    {guia.estado === 'en_transito' && (
                      <button
                        onClick={() => { setGuiaParaEntrega(guia); setShowEntregaModal(true) }}
                        className="btn-primary text-xs py-2 px-4 bg-gradient-to-br from-emerald-500 to-teal-600 border-none flex-shrink-0"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar Entrega
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: CONFIRMAR DESPACHO ───────────────────────────────────── */}
      {showDespachoModal && ventaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass rounded-2xl w-full max-w-md p-8 shadow-2xl animate-fadeInUp">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Confirmar Despacho</h2>
              <button onClick={() => setShowDespachoModal(false)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] text-sm space-y-2">
                <p className="text-slate-400">Pedido: <strong className="text-white">{ventaSeleccionada.codigo_venta}</strong></p>
                <p className="text-slate-400">Cliente: <strong className="text-white">{ventaSeleccionada.cliente?.nombre}</strong></p>
                <div className="pt-2 border-t border-white/[0.06] space-y-1">
                  {lineas.map(l => (
                    <div key={l.catalogo_media_id} className="flex justify-between text-xs">
                      <span className="font-mono text-blue-300">{l.sku || l.codigo}</span>
                      <span className="text-emerald-400 font-bold">{l.docenas_escaneadas} doc.</span>
                    </div>
                  ))}
                </div>
                <p className="text-slate-400 pt-2 border-t border-white/[0.06]">Total: <strong className="text-emerald-400">{totalEscaneado} docenas</strong></p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Agencia de Transporte</label>
                <select value={agenciaSeleccionada} onChange={e => setAgenciaSeleccionada(e.target.value)} className="input-dark">
                  <option value="">Seleccionar agencia...</option>
                  {AGENCIAS.map(ag => <option key={ag} value={ag}>{ag}</option>)}
                </select>
              </div>
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300">Se generará la <strong>Guía de Remisión</strong> y el pedido pasará al Kárdex de Despachos.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowDespachoModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
              <button onClick={despacharVenta} disabled={procesando || !agenciaSeleccionada} className="btn-primary flex-1 justify-center">
                {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Generar Guía
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CONFIRMAR ENTREGA ────────────────────────────────────── */}
      {showEntregaModal && guiaParaEntrega && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass rounded-2xl w-full max-w-md p-8 shadow-2xl animate-fadeInUp">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Confirmar Entrega</h2>
              <button onClick={() => { setShowEntregaModal(false); setGuiaParaEntrega(null) }} className="p-2 rounded-lg hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm space-y-1">
                <p className="text-emerald-300">Guía: <strong className="text-white">{guiaParaEntrega.codigo_guia}</strong></p>
                <p className="text-slate-400">Pedido: <strong className="text-white">{guiaParaEntrega.venta?.codigo_venta}</strong></p>
                <p className="text-slate-400">Cliente: <strong className="text-white">{guiaParaEntrega.venta?.cliente?.nombre}</strong></p>
                <p className="text-slate-400">Agencia: <strong className="text-white">{guiaParaEntrega.agencia}</strong></p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">📸 Adjuntar Cargo Firmado</label>
                <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.02] border border-dashed border-white/10 cursor-pointer hover:border-white/20 transition-all">
                  <Upload className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-400 text-sm truncate">{archivoFirma ? archivoFirma.name : 'Seleccionar foto del cargo...'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={e => setArchivoFirma(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">Al confirmar, la guía quedará como <strong>Entregada</strong> en el Kárdex y el pedido se cerrará.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => { setShowEntregaModal(false); setGuiaParaEntrega(null) }} className="btn-secondary flex-1 justify-center">Cancelar</button>
              <button onClick={confirmarEntrega} disabled={procesando} className="btn-primary flex-1 justify-center bg-gradient-to-br from-emerald-500 to-teal-600 border-none">
                {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirmar Entrega
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
