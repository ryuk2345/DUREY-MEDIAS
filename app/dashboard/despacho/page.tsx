// @ts-nocheck
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Truck, Search, QrCode, ClipboardList, CheckCircle2,
  AlertTriangle, Loader2, X, Upload, Check, FileText
} from 'lucide-react'
import { toast } from 'sonner'
import { formatearFecha, formatearMoneda, generarCodigoGuia } from '@/lib/utils'
import { validarTransicionEstadoPaquete } from '@/lib/domain/packaging'


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
    catalogo_media: { codigo: string; modelo: string; publico: string }
  }[]
}

interface Paquete {
  id: string
  codigo_paquete: string
  docenas: number
  estado: string
  catalogo_media: { codigo: string }
  venta_id?: string
  ubicacion?: { nombre: string }
}

interface Agencia {
  id: string
  nombre: string
}

const AGENCIAS: Agencia[] = [
  { id: 'Shalom', nombre: 'Shalom' },
  { id: 'Olva', nombre: 'Olva Courier' },
  { id: 'Marvisur', nombre: 'Marvisur' },
  { id: 'Flores', nombre: 'Flores Cargo' }
]

export default function DespachoPage() {
  const [ventas, setVentas] = useState<Venta[]>([])
  const [ventaSeleccionada, setVentaSeleccionada] = useState<Venta | null>(null)
  const [paquetesDisponibles, setPaquetesDisponibles] = useState<Paquete[]>([])
  const [paquetesAsociados, setPaquetesAsociados] = useState<Paquete[]>([])
  const [loading, setLoading] = useState(true)
  const [showDespachoModal, setShowDespachoModal] = useState(false)
  const [showEntregaModal, setShowEntregaModal] = useState(false)
  const [agenciaSeleccionada, setAgenciaSeleccionada] = useState('')
  const [codigoQR, setCodigoQR] = useState('')
  const [archivoFirma, setArchivoFirma] = useState<File | null>(null)
  const [procesando, setProcesando] = useState(false)

  const supabase = createClient()

  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [ven, paq] = await Promise.all([
      supabase.from('ventas').select(`
        id, codigo_venta, estado, fecha, total_soles,
        cliente:clientes(nombre, numero_documento),
        items_venta(
          id, catalogo_media_id, docenas,
          catalogo_media:catalogo_medias(codigo, modelo, publico)
        )
      `).in('estado', ['pendiente', 'despachado', 'en_transito']).order('created_at', { ascending: false }),
      supabase.from('paquetes').select(`
        id, codigo_paquete, docenas, estado, venta_id,
        catalogo_media:catalogo_medias(codigo),
        ubicacion:ubicaciones(nombre)
      `).in('estado', ['almacenado', 'preparado_envio', 'en_transito'])
    ])

    if (ven.error) toast.error(`Error al cargar ventas: ${ven.error.message}`)
    if (paq.error) toast.error(`Error al cargar paquetes: ${paq.error.message}`)

    setVentas((ven.data ?? []) as unknown as Venta[])
    setPaquetesDisponibles((paq.data ?? []) as unknown as Paquete[])
    setLoading(false)
  }, [])


  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // Obtener paquetes asociados a la venta seleccionada
  useEffect(() => {
    if (ventaSeleccionada) {
      const asociados = paquetesDisponibles.filter(p => p.venta_id === ventaSeleccionada.id)
      setPaquetesAsociados(asociados)
    } else {
      setPaquetesAsociados([])
    }
  }, [ventaSeleccionada, paquetesDisponibles])

  const seleccionarVenta = (venta: Venta) => {
    setVentaSeleccionada(venta)
    setCodigoQR('')
  }

  // Simular escaneo de QR
  const escanearQR = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!codigoQR.trim() || !ventaSeleccionada) return

    const codigo = codigoQR.trim().toUpperCase()
    const paquete = paquetesDisponibles.find(p => p.codigo_paquete === codigo)

    if (!paquete) {
      toast.error(`Paquete ${codigo} no encontrado o no disponible en almacén`)
      return
    }

    if (paquete.venta_id && paquete.venta_id !== ventaSeleccionada.id) {
      toast.error(`El paquete ${codigo} ya está asociado a otra venta`)
      return
    }

    // Verificar si el tipo de media coincide con lo requerido en la venta
    const itemRequerido = ventaSeleccionada.items_venta.find(
      iv => iv.catalogo_media?.codigo === paquete.catalogo_media?.codigo
    )

    if (!itemRequerido) {
      toast.error(`Este paquete contiene medias que no corresponden a esta venta`)
      return
    }

    // Verificar que la cantidad no exceda
    const yaAsociado = paquetesAsociados
      .filter(p => p.catalogo_media?.codigo === paquete.catalogo_media?.codigo)
      .reduce((sum, p) => sum + p.docenas, 0)

    if (yaAsociado + paquete.docenas > itemRequerido.docenas) {
      toast.warning(`Supera la cantidad de docenas vendidas para esta media (${itemRequerido.docenas} doc.)`)
    }

    // Validar transición a 'preparado_envio'
    const v = validarTransicionEstadoPaquete(paquete.estado as any, 'preparado_envio')
    if (!v.valido) {
      toast.error(`Error en paquete: ${v.error}`)
      return
    }

    // Asociar paquete a la venta y cambiar estado a 'preparado_envio' (Empaquetado para Envío)
    const { error } = await supabase.from('paquetes').update({
      venta_id: ventaSeleccionada.id,
      estado: 'preparado_envio'
    }).eq('id', paquete.id)

    if (error) {
      toast.error('Error al asociar paquete')
      return
    }

    toast.success(`Paquete ${codigo} asociado exitosamente a la venta`)
    setCodigoQR('')
    cargarDatos()
  }

  const desasociarPaquete = async (paqueteId: string) => {
    // Validar transición de regreso a 'almacenado'
    const pkg = paquetesAsociados.find(p => p.id === paqueteId)
    if (pkg) {
      const v = validarTransicionEstadoPaquete(pkg.estado as any, 'almacenado')
      if (!v.valido) {
        toast.error(`Error en paquete: ${v.error}`)
        return
      }
    }

    const { error } = await supabase.from('paquetes').update({
      venta_id: null,
      estado: 'almacenado'
    }).eq('id', paqueteId)

    if (error) {
      toast.error('Error al desasociar el paquete')
      return
    }

    toast.info('Paquete removido de la venta')
    cargarDatos()
  }

  const despacharVenta = async () => {
    if (!ventaSeleccionada || !agenciaSeleccionada) {
      toast.error('Selecciona una agencia de transporte')
      return
    }
    setProcesando(true)

    // Validar transiciones a 'en_transito' para cada paquete asociado
    for (const p of paquetesAsociados) {
      const v = validarTransicionEstadoPaquete(p.estado as any, 'en_transito')
      if (!v.valido) {
        toast.error(`Error en paquete ${p.codigo_paquete}: ${v.error}`)
        setProcesando(false)
        return
      }
    }

    // Obtener secuencia de guías
    const { count } = await supabase.from('guias_remision').select('*', { count: 'exact', head: true })
    const seq = (count ?? 0) + 9001
    const codigoGuia = generarCodigoGuia(seq)

    // Crear guía de remisión
    const { data: guia, error: errorGuia } = await supabase.from('guias_remision').insert({
      codigo_guia: codigoGuia,
      venta_id: ventaSeleccionada.id,
      agencia: agenciaSeleccionada,
      estado: 'en_transito'
    }).select().single()

    if (errorGuia || !guia) {
      toast.error('Error al generar la Guía de Remisión')
      setProcesando(false)
      return
    }

    // Actualizar estado de venta a 'en_transito' (Despachado - En Tránsito)
    await supabase.from('ventas').update({ estado: 'en_transito' }).eq('id', ventaSeleccionada.id)

    // Cambiar paquetes a 'en_transito' y cambiar ubicación a 'En Tránsito - Shalom / Olva'
    const paqueteIds = paquetesAsociados.map(p => p.id)
    if (paqueteIds.length > 0) {
      // Intentar obtener o crear la ubicación de la agencia
      let { data: ubicAgencia } = await supabase.from('ubicaciones')
        .select('id')
        .eq('nombre', `En Tránsito - ${agenciaSeleccionada}`)
        .single()

      if (!ubicAgencia) {
        const { data: nuevaUbic } = await supabase.from('ubicaciones').insert({
          nombre: `En Tránsito - ${agenciaSeleccionada}`,
          tipo: 'salon'
        }).select().single()
        ubicAgencia = nuevaUbic
      }

      await supabase.from('paquetes').update({
        estado: 'en_transito',
        ubicacion_id: ubicAgencia?.id || null
      }).in('id', paqueteIds)
    }

    toast.success(`Guía de Remisión ${codigoGuia} generada. Pedido en tránsito.`)
    setShowDespachoModal(false)
    setAgenciaSeleccionada('')
    setVentaSeleccionada(null)
    setProcesando(false)
    cargarDatos()
  }

  const confirmarEntrega = async () => {
    if (!ventaSeleccionada) return
    setProcesando(true)

    // Validar transiciones a 'entregado' para cada paquete asociado
    for (const p of paquetesAsociados) {
      const v = validarTransicionEstadoPaquete(p.estado as any, 'entregado')
      if (!v.valido) {
        toast.error(`Error en paquete ${p.codigo_paquete}: ${v.error}`)
        setProcesando(false)
        return
      }
    }

    // En un flujo real, se subiría la firma al Storage y se obtendría la URL.
    // Aquí simulamos guardando un valor estático para firma_cargo_url
    const cargoUrl = archivoFirma ? `firma_cargo_${ventaSeleccionada.codigo_venta}.jpg` : 'cargo_recibido_firmado.jpg'

    // Actualizar guía de remisión a entregado
    await supabase.from('guias_remision').update({
      estado: 'entregado',
      firma_cargo_url: cargoUrl,
      fecha_entrega: new Date().toISOString().split('T')[0]
    }).eq('venta_id', ventaSeleccionada.id)

    // Actualizar venta a 'entregado' (Entregada y Cerrada)
    await supabase.from('ventas').update({ estado: 'entregado' }).eq('id', ventaSeleccionada.id)

    // Retirar paquetes del inventario activo (estado = entregado) y remover ubicación
    const paqueteIds = paquetesAsociados.map(p => p.id)
    if (paqueteIds.length > 0) {
      await supabase.from('paquetes').update({
        estado: 'entregado',
        ubicacion_id: null
      }).in('id', paqueteIds)
    }

    toast.success(`Entrega confirmada. Venta ${ventaSeleccionada.codigo_venta} cerrada.`)
    setShowEntregaModal(false)
    setArchivoFirma(null)
    setVentaSeleccionada(null)
    setProcesando(false)

    cargarDatos()
  }

  return (
    <div className="space-y-6 animate-fadeInUp">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-xl bg-blue-500/10"><Truck className="w-5 h-5 text-blue-400" /></div>
          <h1 className="text-2xl font-bold text-white">Despacho y Entregas</h1>
        </div>
        <p className="text-slate-400 text-sm ml-12">Verificación de paquetes con QR, guías de remisión y constancias de entrega</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda: Ventas Pendientes */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Pedidos en Curso</h2>
          <div className="glass rounded-2xl p-4 space-y-3 max-h-[70vh] overflow-y-auto">
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
                    <span className={`badge text-[10px] ${
                      v.estado === 'pendiente' ? 'badge-warning' : 'badge-purple'
                    }`}>
                      {v.estado === 'pendiente' ? 'Pendiente' : 'En Tránsito'}
                    </span>
                  </div>
                  <p className="text-white font-medium text-sm truncate">{v.cliente?.nombre}</p>
                  <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
                    <span>{formatearFecha(v.fecha)}</span>
                    <span className="font-semibold text-emerald-400">{formatearMoneda(v.total_soles)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Columna Derecha: Detalle de Despacho */}
        <div className="lg:col-span-2 space-y-4">
          {ventaSeleccionada ? (
            <div className="glass rounded-2xl p-6 space-y-6">
              {/* Info del pedido */}
              <div className="flex justify-between items-start border-b border-white/[0.06] pb-4">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">Detalle del Pedido {ventaSeleccionada.codigo_venta}</h3>
                  <p className="text-slate-400 text-sm">Cliente: {ventaSeleccionada.cliente?.nombre} ({ventaSeleccionada.cliente?.numero_documento})</p>
                </div>
                {ventaSeleccionada.estado === 'pendiente' ? (
                  <button onClick={() => setShowDespachoModal(true)} disabled={paquetesAsociados.length === 0} className="btn-primary">
                    <FileText className="w-4 h-4" /> Despachar Pedido
                  </button>
                ) : (
                  <button onClick={() => setShowEntregaModal(true)} className="btn-primary bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 border-none shadow-emerald-500/20">
                    <CheckCircle2 className="w-4 h-4" /> Confirmar Entrega
                  </button>
                )}
              </div>

              {/* Items vendidos */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Medias requeridas para despacho</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ventaSeleccionada.items_venta?.map(item => {
                    const escaneado = paquetesAsociados
                      .filter(p => p.catalogo_media?.codigo === item.catalogo_media?.codigo)
                      .reduce((sum, p) => sum + p.docenas, 0)
                    const completado = escaneado >= item.docenas

                    return (
                      <div key={item.id} className={`p-4 rounded-xl border flex justify-between items-center ${completado ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                        <div>
                          <p className="text-xs font-mono text-blue-300 font-semibold">{item.catalogo_media?.codigo}</p>
                          <p className="text-xs text-slate-500 capitalize">{item.catalogo_media?.modelo} · {item.catalogo_media?.publico}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${completado ? 'text-emerald-400' : 'text-slate-300'}`}>
                            {escaneado} / {item.docenas} doc.
                          </p>
                          <span className={`text-[10px] ${completado ? 'text-emerald-500 font-medium' : 'text-slate-500'}`}>
                            {completado ? '✓ Listo' : 'Pendiente'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Escáner de paquetes (solo si está pendiente) */}
              {ventaSeleccionada.estado === 'pendiente' && (
                <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-4">
                  <div className="flex items-center gap-2 text-blue-400">
                    <QrCode className="w-5 h-5" />
                    <h4 className="text-sm font-semibold">Simulador de Escáner QR de Bultos</h4>
                  </div>
                  <form onSubmit={escanearQR} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Escribe o escanea el código del paquete (Ej: PKG-1001)..."
                      value={codigoQR}
                      onChange={e => setCodigoQR(e.target.value)}
                      className="input-dark flex-1"
                    />
                    <button type="submit" className="btn-primary py-2.5 px-5">Asociar</button>
                  </form>
                  <p className="text-slate-500 text-xs">Simula la lectura del código QR de la etiqueta del bulto al pasar por el lector.</p>
                </div>
              )}

              {/* Paquetes escaneados */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Paquetes asociados al envío ({paquetesAsociados.length})</h4>
                {paquetesAsociados.length === 0 ? (
                  <p className="text-slate-500 text-sm italic py-4">No se han escaneado paquetes para esta venta</p>
                ) : (
                  <div className="divide-y divide-white/[0.04] bg-white/[0.01] rounded-xl border border-white/[0.06] overflow-hidden">
                    {paquetesAsociados.map(paq => (
                      <div key={paq.id} className="p-3 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3">
                          <code className="text-xs text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded font-mono">{paq.codigo_paquete}</code>
                          <span className="text-slate-300 font-mono text-xs">{paq.catalogo_media?.codigo}</span>
                          <span className="text-slate-500 text-xs">({paq.docenas} doc.)</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="badge badge-info text-[10px]">{paq.ubicacion?.nombre ?? 'Salón'}</span>
                          {ventaSeleccionada.estado === 'pendiente' && (
                            <button onClick={() => desasociarPaquete(paq.id)} className="text-red-400 hover:text-red-300 text-xs hover:underline">
                              Quitar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="glass rounded-2xl flex flex-col items-center justify-center py-24 text-slate-500">
              <Truck className="w-12 h-12 mb-3 opacity-25" />
              <p className="font-medium">Selecciona un pedido para gestionar su despacho o entrega</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Despacho (Guía de Remisión) */}
      {showDespachoModal && ventaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass rounded-2xl w-full max-w-md p-8 shadow-2xl animate-fadeInUp">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Despachar Pedido</h2>
              <button onClick={() => setShowDespachoModal(false)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] text-sm space-y-1">
                <p className="text-slate-400">Pedido: <strong className="text-white">{ventaSeleccionada.codigo_venta}</strong></p>
                <p className="text-slate-400">Paquetes listos: <strong className="text-white">{paquetesAsociados.length} bultos</strong></p>
                <p className="text-slate-400">Total docenas: <strong className="text-emerald-400">{paquetesAsociados.reduce((s,p)=>s+p.docenas, 0)} doc.</strong></p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Agencia de Transporte</label>
                <select value={agenciaSeleccionada} onChange={e => setAgenciaSeleccionada(e.target.value)} className="input-dark">
                  <option value="">Seleccionar agencia...</option>
                  {AGENCIAS.map(ag => <option key={ag.id} value={ag.id}>{ag.nombre}</option>)}
                </select>
              </div>

              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300">
                  Al despachar, la venta cambiará al estado <strong>En Tránsito</strong> y se generará el código único de guía.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowDespachoModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
              <button onClick={despacharVenta} disabled={procesando} className="btn-primary flex-1 justify-center">
                {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Generar Guía
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Entrega */}
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
                <p className="text-slate-400">En tránsito con agencia de transporte registrada.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">📸 Adjuntar Cargo Recibido (Firmado por cliente)</label>
                <label className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.02] border border-dashed border-white/10 cursor-pointer hover:border-white/20 transition-all">
                  <Upload className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-400 text-sm truncate">{archivoFirma ? archivoFirma.name : 'Seleccionar foto del cargo...'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={e => setArchivoFirma(e.target.files?.[0] || null)} />
                </label>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">
                  Al confirmar, la venta pasará a estado <strong>Entregada y Cerrada</strong>, y los paquetes saldrán definitivamente del stock en tránsito.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowEntregaModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
              <button onClick={confirmarEntrega} disabled={procesando} className="btn-primary flex-1 justify-center">
                {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
