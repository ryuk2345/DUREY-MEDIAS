// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Truck, QrCode, ClipboardList, CheckCircle2,
  AlertTriangle, Loader2, X, Upload, Check, FileText,
  Keyboard, Scan, Plus, Minus, Package, Barcode
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

const AGENCIAS = ['Shalom', 'Olva Courier', 'Marvisur', 'Flores Cargo']

// ── COMPONENTE PRINCIPAL ───────────────────────────────────────────────────
export default function DespachoPage() {
  const supabase = createClient()

  const [ventas, setVentas] = useState<Venta[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  // Stock disponible por catalogo_media_id
  const [stockPorMedia, setStockPorMedia] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState(false)

  const [ventaSeleccionada, setVentaSeleccionada] = useState<Venta | null>(null)
  const [lineas, setLineas] = useState<LineaEscaneada[]>([])

  // Modo escáner: 'pistola' | 'manual'
  const [modoEscaneo, setModoEscaneo] = useState<'pistola' | 'manual'>('pistola')
  const [inputSku, setInputSku] = useState('')
  const [docenasManual, setDocenasManual] = useState(1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Modal despacho
  const [showDespachoModal, setShowDespachoModal] = useState(false)
  const [agenciaSeleccionada, setAgenciaSeleccionada] = useState('')
  const [showEntregaModal, setShowEntregaModal] = useState(false)
  const [archivoFirma, setArchivoFirma] = useState<File | null>(null)

  // ── CARGA DATOS ────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [venRes, catRes, paqRes] = await Promise.all([
      supabase.from('ventas').select(`
        id, codigo_venta, estado, fecha, total_soles,
        cliente:clientes(nombre, numero_documento),
        items_venta(
          id, catalogo_media_id, docenas,
          catalogo_media:catalogo_medias(id, codigo, sku, modelo, publico, diseno_color)
        )
      `).in('estado', ['pendiente', 'despachado', 'en_transito']).order('created_at', { ascending: false }),
      supabase.from('catalogo_medias').select('id, codigo, sku, modelo, publico, diseno_color, talla'),
      supabase.from('paquetes').select('catalogo_media_id, docenas').in('estado', ['almacenado', 'pendiente_almacenar']),
    ])

    if (venRes.error) toast.error(`Error al cargar ventas: ${venRes.error.message}`)
    if (catRes.error) toast.error(`Error al cargar catálogo: ${catRes.error.message}`)

    setVentas((venRes.data ?? []) as unknown as Venta[])
    setCatalogo((catRes.data ?? []) as CatalogoMedia[])

    // Calcular stock por media
    const stockMap: Record<string, number> = {}
    for (const p of paqRes.data ?? []) {
      if (!p.catalogo_media_id) continue
      stockMap[p.catalogo_media_id] = (stockMap[p.catalogo_media_id] ?? 0) + Number(p.docenas ?? 0)
    }
    setStockPorMedia(stockMap)
    setLoading(false)
  }, [])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Auto-focus en el input cuando cambia el modo o la venta
  useEffect(() => {
    if (modoEscaneo === 'pistola' && ventaSeleccionada && inputRef.current) {
      inputRef.current.focus()
    }
  }, [modoEscaneo, ventaSeleccionada])

  // ── SELECCIONAR VENTA ──────────────────────────────────────────────────
  const seleccionarVenta = (venta: Venta) => {
    setVentaSeleccionada(venta)
    setInputSku('')
    setDocenasManual(1)
    // Inicializar líneas de escaneo desde los items de la venta
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

  // ── LÓGICA ESCANEO POR SKU ─────────────────────────────────────────────
  // Busca la media por SKU o código (case-insensitive, trims espacios)
  const resolverMedia = (raw: string): CatalogoMedia | null => {
    const q = raw.trim().toUpperCase()
    return catalogo.find(m =>
      (m.sku ?? '').toUpperCase() === q ||
      m.codigo.toUpperCase() === q
    ) ?? null
  }

  const registrarEscaneo = (mediaId: string, docenas: number) => {
    setLineas(prev => {
      const idx = prev.findIndex(l => l.catalogo_media_id === mediaId)
      if (idx === -1) {
        // Media escaneada que NO pertenece a esta venta
        const media = catalogo.find(m => m.id === mediaId)
        toast.error(`La media ${media?.sku ?? media?.codigo ?? ''} no pertenece a esta venta`)
        return prev
      }
      const linea = prev[idx]
      const nuevasCant = linea.docenas_escaneadas + docenas
      if (nuevasCant > linea.docenas_requeridas) {
        toast.warning(`⚠️ Excede la cantidad vendida para ${linea.codigo} (máx. ${linea.docenas_requeridas} doc.)`)
        return prev
      }
      const copia = [...prev]
      copia[idx] = { ...linea, docenas_escaneadas: nuevasCant }
      return copia
    })
  }

  // ── MODO PISTOLA: submit por Enter ─────────────────────────────────────
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

    registrarEscaneo(media.id, 1)
    setInputSku('')
    // Re-focus para siguiente escaneo continuo
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // ── MODO MANUAL: añadir N docenas ──────────────────────────────────────
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

  // ── QUITAR ESCANEO ─────────────────────────────────────────────────────
  const quitarLinea = (mediaId: string) => {
    setLineas(prev => prev.map(l =>
      l.catalogo_media_id === mediaId ? { ...l, docenas_escaneadas: 0 } : l
    ))
  }

  // ── VERIFICAR SI ESTÁ LISTO PARA DESPACHAR ────────────────────────────
  const totalRequerido = lineas.reduce((s, l) => s + l.docenas_requeridas, 0)
  const totalEscaneado = lineas.reduce((s, l) => s + l.docenas_escaneadas, 0)
  const listoParaDespachar = lineas.length > 0 && lineas.every(l => l.docenas_escaneadas >= l.docenas_requeridas)
  // Verifica si hay stock suficiente en almacén para despachar
  const hayStockInsuficiente = lineas.some(l => (stockPorMedia[l.catalogo_media_id] ?? 0) < l.docenas_requeridas)

  // ── DESPACHAR: descontar del almacén y crear guía ─────────────────────
  const despacharVenta = async () => {
    if (!ventaSeleccionada || !agenciaSeleccionada) {
      toast.error('Selecciona una agencia de transporte')
      return
    }
    if (!listoParaDespachar) {
      toast.error('Faltan medias por escanear antes de despachar')
      return
    }

    setProcesando(true)
    try {
      // 1. Generar código de guía
      const { count } = await supabase.from('guias_remision').select('*', { count: 'exact', head: true })
      const seq = (count ?? 0) + 9001
      const codigoGuia = generarCodigoGuia(seq)

      // 2. Descontar stock de paquetes por cada línea escaneada
      //    Busca paquetes almacenados del tipo de media y los marca como preparado_envio
      for (const linea of lineas) {
        let docenasFaltantes = linea.docenas_escaneadas

        // Obtener paquetes disponibles de este tipo de media
        const { data: paqDisp } = await supabase
          .from('paquetes')
          .select('id, docenas')
          .eq('catalogo_media_id', linea.catalogo_media_id)
          .in('estado', ['almacenado', 'pendiente_almacenar'])
          .order('created_at', { ascending: true })

        if (!paqDisp || paqDisp.length === 0) {
          toast.error(`Sin stock de paquetes para: ${linea.codigo}`)
          setProcesando(false)
          return
        }

        // Consumir paquetes hasta cubrir las docenas escaneadas
        for (const paq of paqDisp) {
          if (docenasFaltantes <= 0) break
          await supabase.from('paquetes').update({
            venta_id: ventaSeleccionada.id,
            estado: 'preparado_envio'
          }).eq('id', paq.id)
          docenasFaltantes -= Number(paq.docenas)
        }
      }

      // 3. Crear la guía de remisión
      const { error: errorGuia } = await supabase.from('guias_remision').insert({
        codigo_guia: codigoGuia,
        venta_id: ventaSeleccionada.id,
        agencia: agenciaSeleccionada,
        estado: 'en_transito'
      })

      if (errorGuia) throw errorGuia

      // 4. Actualizar venta a 'en_transito'
      await supabase.from('ventas').update({ estado: 'en_transito' }).eq('id', ventaSeleccionada.id)

      // 5. Registrar movimientos de salida
      const movimientos = lineas.map(l => ({
        tipo: 'salida_venta',
        referencia: `Despacho ${ventaSeleccionada.codigo_venta} → ${agenciaSeleccionada}`,
        docenas: l.docenas_escaneadas,
      }))
      await supabase.from('movimientos_stock').insert(movimientos)

      toast.success(`✅ Guía ${codigoGuia} generada. Pedido en tránsito vía ${agenciaSeleccionada}.`)
      setShowDespachoModal(false)
      setAgenciaSeleccionada('')
      setVentaSeleccionada(null)
      setLineas([])
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al despachar: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  // ── CONFIRMAR ENTREGA ──────────────────────────────────────────────────
  const confirmarEntrega = async () => {
    if (!ventaSeleccionada) return
    setProcesando(true)
    try {
      const cargoUrl = archivoFirma
        ? `firma_cargo_${ventaSeleccionada.codigo_venta}.jpg`
        : 'cargo_recibido_firmado.jpg'

      await supabase.from('guias_remision').update({
        estado: 'entregado',
        firma_cargo_url: cargoUrl,
        fecha_entrega: new Date().toISOString().split('T')[0]
      }).eq('venta_id', ventaSeleccionada.id)

      await supabase.from('ventas').update({ estado: 'entregado' }).eq('id', ventaSeleccionada.id)

      // Marcar paquetes como entregados
      await supabase.from('paquetes').update({ estado: 'entregado', ubicacion_id: null })
        .eq('venta_id', ventaSeleccionada.id)

      toast.success(`Entrega confirmada. Venta ${ventaSeleccionada.codigo_venta} cerrada.`)
      setShowEntregaModal(false)
      setArchivoFirma(null)
      setVentaSeleccionada(null)
      setLineas([])
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al confirmar entrega: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  // ── RENDER ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fadeInUp">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-xl bg-blue-500/10"><Truck className="w-5 h-5 text-blue-400" /></div>
          <h1 className="text-2xl font-bold text-white">Despacho y Entregas</h1>
        </div>
        <p className="text-slate-400 text-sm ml-12">Escanea el SKU de cada tipo de media para descontar del almacén y generar guía de remisión</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── COLUMNA IZQUIERDA: Lista de ventas ─────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Pedidos Pendientes</h2>
          <div className="glass rounded-2xl p-4 space-y-3 max-h-[75vh] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-blue-400" /></div>
            ) : ventas.length === 0 ? (
              <p className="text-center text-slate-500 text-sm py-8">No hay pedidos pendientes de despacho</p>
            ) : (
              ventas.map(v => (
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
                    <span className={`badge text-[10px] ${v.estado === 'pendiente' ? 'badge-warning' : v.estado === 'en_transito' ? 'badge-purple' : 'badge-success'}`}>
                      {v.estado === 'pendiente' ? 'Pendiente' : v.estado === 'en_transito' ? 'En Tránsito' : 'Entregado'}
                    </span>
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

        {/* ── COLUMNA DERECHA: Panel de escaneo ─────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {ventaSeleccionada ? (
            <div className="glass rounded-2xl p-6 space-y-6">

              {/* Cabecera del pedido */}
              <div className="flex justify-between items-start border-b border-white/[0.06] pb-4">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">Pedido {ventaSeleccionada.codigo_venta}</h3>
                  <p className="text-slate-400 text-sm">Cliente: {ventaSeleccionada.cliente?.nombre} ({ventaSeleccionada.cliente?.numero_documento})</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {totalEscaneado} / {totalRequerido} doc. escaneadas
                    {listoParaDespachar && <span className="text-emerald-400 font-semibold ml-2">✓ Listo para despachar</span>}
                  </p>
                </div>
                <div className="flex gap-2">
                  {ventaSeleccionada.estado === 'pendiente' ? (
                    <button
                      onClick={() => setShowDespachoModal(true)}
                      disabled={!listoParaDespachar || hayStockInsuficiente}
                      title={hayStockInsuficiente ? 'Stock insuficiente en almacén para completar este pedido' : ''}
                      className={`btn-primary text-sm ${
                        (!listoParaDespachar || hayStockInsuficiente) ? 'opacity-40 cursor-not-allowed' : ''
                      }`}
                    >
                      <FileText className="w-4 h-4" />
                      {hayStockInsuficiente ? '⛔ Sin Stock' : 'Despachar Pedido'}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowEntregaModal(true)}
                      className="btn-primary text-sm bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 border-none"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Confirmar Entrega
                    </button>
                  )}
                </div>
              </div>

              {/* ── SELECTOR DE MODO ESCANEO ─────────────────────────── */}
              {ventaSeleccionada.estado === 'pendiente' && (
                <>
                  <div className="flex gap-2 p-1 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                    <button
                      onClick={() => setModoEscaneo('pistola')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        modoEscaneo === 'pistola'
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                          : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <Scan className="w-4 h-4" /> Pistola / Escáner
                    </button>
                    <button
                      onClick={() => setModoEscaneo('manual')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        modoEscaneo === 'manual'
                          ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                          : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <Keyboard className="w-4 h-4" /> Manual
                    </button>
                  </div>

                  {/* ── MODO PISTOLA ─────────────────────────────────── */}
                  {modoEscaneo === 'pistola' && (
                    <div className="p-4 rounded-xl bg-blue-500/[0.04] border border-blue-500/20 space-y-3">
                      <div className="flex items-center gap-2 text-blue-400 mb-1">
                        <Barcode className="w-5 h-5" />
                        <h4 className="text-sm font-semibold">Modo Pistola — Escanea el SKU de la media</h4>
                      </div>
                      <form onSubmit={handlePistolaSubmit} className="flex gap-2">
                        <input
                          ref={inputRef}
                          type="text"
                          placeholder="Apunta al código de barras / SKU (ej: SKU-TOB-DAM-BLA-U)..."
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
                      <p className="text-slate-500 text-xs">
                        Cada escaneo suma <strong className="text-slate-400">1 docena</strong>. Escanea el mismo SKU varias veces si necesitas más docenas.
                        El campo se limpia automáticamente después de cada lectura.
                      </p>
                    </div>
                  )}

                  {/* ── MODO MANUAL ──────────────────────────────────── */}
                  {modoEscaneo === 'manual' && (
                    <div className="p-4 rounded-xl bg-violet-500/[0.04] border border-violet-500/20 space-y-3">
                      <div className="flex items-center gap-2 text-violet-400 mb-1">
                        <Keyboard className="w-5 h-5" />
                        <h4 className="text-sm font-semibold">Modo Manual — Ajusta las docenas por media</h4>
                      </div>
                      <p className="text-slate-500 text-xs">
                        Usa los botones <strong className="text-slate-300">+ / −</strong> de cada fila para ingresar la cantidad manualmente.
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* ── TABLA DE MEDIAS DEL PEDIDO ───────────────────────── */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4" /> Medias del Pedido
                </h4>
                <div className="space-y-2">
                  {lineas.map(linea => {
                    const completado = linea.docenas_escaneadas >= linea.docenas_requeridas
                    const porcentaje = Math.min(100, Math.round((linea.docenas_escaneadas / linea.docenas_requeridas) * 100))
                    return (
                      <div
                        key={linea.catalogo_media_id}
                        className={`p-4 rounded-xl border transition-all ${
                          completado
                            ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                            : linea.docenas_escaneadas > 0
                            ? 'border-amber-500/30 bg-amber-500/[0.03]'
                            : 'border-white/[0.06] bg-white/[0.01]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {completado
                                ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                : <Package className="w-4 h-4 text-slate-500 flex-shrink-0" />
                              }
                              <code className="text-xs font-mono text-blue-300 font-semibold truncate">{linea.sku || linea.codigo}</code>
                            </div>
                            <p className="text-xs text-slate-500 ml-6 capitalize">
                              {linea.modelo} · {linea.publico} · {linea.diseno_color}
                            </p>
                            {/* Barra de progreso */}
                            <div className="ml-6 mt-2">
                              <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                <span>{linea.docenas_escaneadas} / {linea.docenas_requeridas} doc.</span>
                                <span>{porcentaje}%</span>
                              </div>
                              <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    completado ? 'bg-emerald-500' : linea.docenas_escaneadas > 0 ? 'bg-amber-500' : 'bg-slate-700'
                                  }`}
                                  style={{ width: `${porcentaje}%` }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Controles */}
                          {ventaSeleccionada.estado === 'pendiente' && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {modoEscaneo === 'manual' ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleManualAgregar(linea.catalogo_media_id, -1)}
                                    disabled={linea.docenas_escaneadas <= 0}
                                    className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/10 text-slate-300 flex items-center justify-center disabled:opacity-30 transition-all"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="text-white font-bold text-sm w-8 text-center">{linea.docenas_escaneadas}</span>
                                  <button
                                    onClick={() => handleManualAgregar(linea.catalogo_media_id, +1)}
                                    disabled={linea.docenas_escaneadas >= linea.docenas_requeridas}
                                    className="w-8 h-8 rounded-lg bg-blue-600/40 hover:bg-blue-600/60 text-blue-300 flex items-center justify-center disabled:opacity-30 transition-all"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <span className={`text-sm font-bold ${completado ? 'text-emerald-400' : 'text-slate-400'}`}>
                                  {linea.docenas_escaneadas} doc.
                                </span>
                              )}
                              {linea.docenas_escaneadas > 0 && (
                                <button
                                  onClick={() => quitarLinea(linea.catalogo_media_id)}
                                  className="w-7 h-7 rounded-lg hover:bg-red-500/20 text-red-400 flex items-center justify-center transition-all"
                                  title="Resetear cantidad"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Resumen */}
              {lineas.length > 0 && (
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
                  <div className="text-sm text-slate-400">
                    Total escaneado: <span className="text-white font-bold">{totalEscaneado}</span> / <span className="text-slate-400">{totalRequerido}</span> docenas
                  </div>
                  {listoParaDespachar ? (
                    <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Completo
                    </span>
                  ) : (
                    <span className="text-xs text-amber-400 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" /> Faltan {totalRequerido - totalEscaneado} doc.
                    </span>
                  )}
                </div>
              )}

            </div>
          ) : (
            <div className="glass rounded-2xl flex flex-col items-center justify-center py-24 text-slate-500">
              <Truck className="w-12 h-12 mb-3 opacity-25" />
              <p className="font-medium">Selecciona un pedido para iniciar el escaneo</p>
              <p className="text-xs mt-1 text-slate-600">Podrás usar pistola escáner o ingresar manualmente</p>
            </div>
          )}
        </div>
      </div>

      {/* ── MODAL: DESPACHAR ──────────────────────────────────────────── */}
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
              {/* Resumen */}
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
                <p className="text-xs text-blue-300">
                  Se descontarán los paquetes del almacén y se generará una <strong>Guía de Remisión</strong>.
                </p>
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

      {/* ── MODAL: CONFIRMAR ENTREGA ───────────────────────────────────── */}
      {showEntregaModal && ventaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass rounded-2xl w-full max-w-md p-8 shadow-2xl animate-fadeInUp">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Confirmar Entrega</h2>
              <button onClick={() => setShowEntregaModal(false)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm space-y-1">
                <p className="text-emerald-300">Pedido: <strong className="text-white">{ventaSeleccionada.codigo_venta}</strong></p>
                <p className="text-slate-400">En tránsito con la agencia de transporte.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">📸 Adjuntar Cargo Recibido (Firmado)</label>
                <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.02] border border-dashed border-white/10 cursor-pointer hover:border-white/20 transition-all">
                  <Upload className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-400 text-sm truncate">{archivoFirma ? archivoFirma.name : 'Seleccionar foto del cargo...'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={e => setArchivoFirma(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">
                  Al confirmar, la venta pasará a <strong>Entregada y Cerrada</strong> y los paquetes saldrán definitivamente del stock.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowEntregaModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
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
