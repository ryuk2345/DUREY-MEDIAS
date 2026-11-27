'use client'

// Despacho por sacos (Fase 6A, migración 034): almacén elige sacos completos de un solo SKU,
// guiado por lo pedido; si falta no deja, si sobra avisa y queda registrado. Se guarda quién
// despachó. Regla de falta/sobra: lib/domain/despacho.ts; la base lo vuelve a comprobar.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Truck, CheckCircle2, AlertTriangle, Loader2, X, Check, FileText, Scan, Plus, Printer, ClipboardList, History, Calendar, User } from 'lucide-react'
import { toast } from 'sonner'
import { formatearFecha, formatearMoneda } from '@/lib/utils'
import { compararDespacho, sacosFueraDelPedido, puedeDespachar } from '@/lib/domain/despacho'
import CustomSelect from '@/components/ui/CustomSelect'
import { Modal } from '@/components/ui/Modal'
import { imprimirOrdenDespacho } from '@/lib/impresion/ordenDespacho'

interface Venta {
  id: string
  codigo_venta: string
  estado: string
  fecha: string
  total_soles: number
  cliente: { nombre: string; numero_documento: string; direccion?: string | null }
  asesora?: { nombre: string } | null
  items_venta: { id: string; catalogo_media_id: string; docenas: number; catalogo_media: { id: string; codigo: string; sku: string } }[]
}
interface Saco { id: string; codigo_paquete: string; docenas: number; catalogo_media_id: string | null; ubicacion: { nombre: string } | null }
interface GuiaRemision {
  id: string
  codigo_guia: string
  agencia: string
  fecha_despacho: string
  despachado?: { nombre: string } | null
  despacho_detalle?: { docenas_pedidas: number; docenas_entregadas: number; catalogo_media: { codigo: string; sku: string } | null }[]
  venta: { codigo_venta: string; total_soles: number; cliente: { nombre: string; numero_documento: string }; items_venta: { docenas: number; catalogo_media: { codigo: string; sku: string } }[] }
}
interface Agencia { id: string; nombre: string }

export default function DespachoPage() {
  const supabase = createClient()
  const [vistaActiva, setVistaActiva] = useState<'despacho' | 'kardex'>('despacho')
  const [ventasPendientes, setVentasPendientes] = useState<Venta[]>([])
  const [guias, setGuias] = useState<GuiaRemision[]>([])
  const [sacos, setSacos] = useState<Saco[]>([])
  const [agencias, setAgencias] = useState<Agencia[]>([])
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState(false)

  const [ventaSeleccionada, setVentaSeleccionada] = useState<Venta | null>(null)
  const [elegidos, setElegidos] = useState<string[]>([])
  const [inputSaco, setInputSaco] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const [showDespachoModal, setShowDespachoModal] = useState(false)
  const [agenciaSeleccionada, setAgenciaSeleccionada] = useState('')
  const [mostrarNuevaAgencia, setMostrarNuevaAgencia] = useState(false)
  const [nombreNuevaAgencia, setNombreNuevaAgencia] = useState('')
  const [guardandoAgencia, setGuardandoAgencia] = useState(false)
  const [busquedaKardex, setBusquedaKardex] = useState('')

  const leer = useCallback(async () => {
    const [venRes, guiRes, sacRes, agRes] = await Promise.all([
      supabase.from('ventas').select(`id, codigo_venta, estado, fecha, total_soles, cliente:clientes(nombre, numero_documento, direccion), asesora:usuarios(nombre),
        items_venta(id, catalogo_media_id, docenas, catalogo_media:catalogo_medias(id, codigo, sku))`).eq('estado', 'pendiente').order('created_at', { ascending: false }),
      supabase.from('guias_remision').select(`id, codigo_guia, agencia, fecha_despacho, despachado:usuarios(nombre),
        despacho_detalle(docenas_pedidas, docenas_entregadas, catalogo_media:catalogo_medias(codigo, sku)),
        venta:ventas(codigo_venta, total_soles, cliente:clientes(nombre, numero_documento), items_venta(docenas, catalogo_media:catalogo_medias(codigo, sku)))`)
        .order('fecha_despacho', { ascending: false }),
      supabase.from('paquetes').select('id, codigo_paquete, docenas, catalogo_media_id, ubicacion:ubicaciones(nombre)').eq('estado', 'almacenado').order('created_at'),
      supabase.from('agencias').select('id, nombre').eq('activo', true).order('nombre'),
    ])
    for (const [n, r] of [['pedidos', venRes], ['despachos', guiRes], ['sacos', sacRes], ['agencias', agRes]] as const) if (r.error) toast.error(`Error al cargar ${n}: ${r.error.message}`)
    return {
      ventas: (venRes.data ?? []) as unknown as Venta[], guias: (guiRes.data ?? []) as unknown as GuiaRemision[],
      sacos: ((sacRes.data ?? []) as unknown as Saco[]).filter(s => s.ubicacion), agencias: (agRes.data ?? []) as Agencia[],
    }
  }, [supabase])
  const aplicar = useCallback((d: Awaited<ReturnType<typeof leer>>) => {
    setVentasPendientes(d.ventas); setGuias(d.guias); setSacos(d.sacos); setAgencias(d.agencias); setLoading(false)
  }, [])
  useEffect(() => {
    let vigente = true
    ;(async () => { const d = await leer(); if (vigente) aplicar(d) })()
    return () => { vigente = false }
  }, [leer, aplicar])
  const recargar = async () => aplicar(await leer())

  const pedido = useMemo(() => (ventaSeleccionada?.items_venta ?? []).map(i => ({ catalogo_media_id: i.catalogo_media_id, docenas: Number(i.docenas) })), [ventaSeleccionada])
  const skusPedido = useMemo(() => new Set(pedido.map(l => l.catalogo_media_id)), [pedido])
  const disponibles = useMemo(() => sacos.filter(s => s.catalogo_media_id && skusPedido.has(s.catalogo_media_id)), [sacos, skusPedido])
  const sacosElegidos = useMemo(() => elegidos.map(id => sacos.find(s => s.id === id)!).filter(Boolean), [elegidos, sacos])
  const comparacion = useMemo(() => compararDespacho(pedido, sacosElegidos), [pedido, sacosElegidos])
  const listo = puedeDespachar(pedido, sacosElegidos)
  const sobrantes = comparacion.filter(c => c.sobra > 0)
  const codigoDe = (id: string) => ventaSeleccionada?.items_venta.find(i => i.catalogo_media_id === id)?.catalogo_media

  const seleccionarVenta = (v: Venta) => { setVentaSeleccionada(v); setElegidos([]); setInputSaco(''); setTimeout(() => inputRef.current?.focus(), 100) }
  const alternar = (id: string) => setElegidos(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const escanear = (e: React.FormEvent) => {
    e.preventDefault()
    const q = inputSaco.trim().toUpperCase()
    if (!q) return
    const saco = sacos.find(s => s.codigo_paquete.toUpperCase() === q)
    setInputSaco('')
    if (!saco) { toast.error(`Saco no disponible en un salón: "${q}"`); return }
    if (sacosFueraDelPedido(pedido, [saco]).length) { toast.error(`El saco ${saco.codigo_paquete} es de otro producto, que no está en el pedido`); return }
    if (elegidos.includes(saco.id)) { toast.warning(`El saco ${saco.codigo_paquete} ya está elegido`); return }
    setElegidos(prev => [...prev, saco.id])
  }

  const guardarNuevaAgencia = async () => {
    const nombre = nombreNuevaAgencia.trim()
    if (!nombre) { toast.error('Ingresa el nombre de la agencia'); return }
    setGuardandoAgencia(true)
    const { error } = await supabase.rpc('registrar_agencia', { p_nombre: nombre })
    setGuardandoAgencia(false)
    if (error) { toast.error(error.message); return }
    const { data } = await supabase.from('agencias').select('id, nombre').eq('activo', true).order('nombre')
    setAgencias((data ?? []) as Agencia[])
    setAgenciaSeleccionada(nombre); setNombreNuevaAgencia(''); setMostrarNuevaAgencia(false)
    toast.success(`Agencia ${nombre} añadida`)
  }

  const despachar = async () => {
    if (!ventaSeleccionada || !agenciaSeleccionada) { toast.error('Selecciona una agencia de transporte'); return }
    setProcesando(true)
    const { data: codigoGuia, error } = await supabase.rpc('despachar_venta_sacos', {
      p_venta_id: ventaSeleccionada.id, p_agencia: agenciaSeleccionada, p_sacos: elegidos,
    })
    setProcesando(false)
    if (error) { toast.error(`Error al despachar: ${error.message}`); return }
    toast.success(`Pedido ${ventaSeleccionada.codigo_venta} despachado. Guía ${codigoGuia} registrada en el kardex.`)
    setShowDespachoModal(false); setAgenciaSeleccionada(''); setVentaSeleccionada(null); setElegidos([])
    await recargar()
    setVistaActiva('kardex')
  }

  const guiasFiltradas = guias.filter(g => {
    const q = busquedaKardex.toLowerCase()
    return !q || g.codigo_guia.toLowerCase().includes(q) || g.venta?.codigo_venta?.toLowerCase().includes(q)
      || g.venta?.cliente?.nombre?.toLowerCase().includes(q) || g.agencia.toLowerCase().includes(q) || (g.despachado?.nombre ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6 animate-fadeInUp">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Despacho y Entregas</h1>
          <p className="text-slate-400 text-sm mt-1">Elige los sacos completos de cada pedido; el kardex guarda quién despachó</p>
        </div>
        <div className="flex gap-2 p-1 bg-white/[0.03] rounded-xl border border-white/[0.06]">
          <button onClick={() => setVistaActiva('despacho')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${vistaActiva === 'despacho' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            <Truck className="w-4 h-4" /> Despachar
          </button>
          <button onClick={() => setVistaActiva('kardex')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${vistaActiva === 'kardex' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            <History className="w-4 h-4" /> Kárdex de Despachos
          </button>
        </div>
      </div>

      {vistaActiva === 'despacho' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Por Despachar</h2>
              <span className="text-xs text-slate-500">{ventasPendientes.length} pendiente{ventasPendientes.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="glass rounded-2xl p-4 space-y-3 max-h-[75vh] overflow-y-auto">
              {loading ? <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-blue-400" /></div>
                : ventasPendientes.length === 0 ? <p className="text-center py-12 text-slate-500 text-sm">Sin pedidos pendientes</p>
                : ventasPendientes.map(v => (
                  <button key={v.id} onClick={() => seleccionarVenta(v)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${ventaSeleccionada?.id === v.id ? 'border-blue-400 bg-blue-500/10' : 'border-white/[0.06] hover:bg-white/[0.02]'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <code className="text-blue-300 font-mono text-xs bg-blue-500/15 px-2 py-0.5 rounded">{v.codigo_venta}</code>
                      <span className="badge badge-warning text-[10px]">Pendiente</span>
                    </div>
                    <p className="text-white font-medium text-sm truncate">{v.cliente?.nombre}</p>
                    <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
                      <span>{formatearFecha(v.fecha)}</span><span className="font-semibold text-emerald-400">{formatearMoneda(v.total_soles)}</span>
                    </div>
                  </button>
                ))}
            </div>
          </div>

          <div className="lg:col-span-2">
            {ventaSeleccionada ? (
              <div className="glass rounded-2xl p-6 space-y-5">
                <div className="flex justify-between items-start border-b border-white/[0.06] pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Pedido {ventaSeleccionada.codigo_venta}</h3>
                    <p className="text-slate-400 text-sm">{ventaSeleccionada.cliente?.nombre} · {ventaSeleccionada.cliente?.numero_documento}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={async () => { const err = await imprimirOrdenDespacho(supabase, ventaSeleccionada); if (err) toast.error(err) }}
                      className="btn-secondary text-sm"><Printer className="w-4 h-4" /> Orden de despacho</button>
                    <button onClick={() => setShowDespachoModal(true)} disabled={!listo} className={`btn-primary text-sm ${!listo ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <FileText className="w-4 h-4" /> Despachar y Cerrar
                    </button>
                  </div>
                </div>

                <form onSubmit={escanear} className="flex gap-2">
                  <Scan className="w-5 h-5 text-blue-400 mt-2" />
                  <input ref={inputRef} type="text" aria-label="Código del saco" placeholder="Escanea o escribe el código del saco…" value={inputSaco}
                    onChange={e => setInputSaco(e.target.value)} className="input-dark flex-1 font-mono text-sm" autoComplete="off" />
                  <button type="submit" className="btn-primary px-4 text-sm"><Check className="w-4 h-4" /></button>
                </form>

                <table className="w-full text-left text-xs" data-testid="comparacion-despacho">
                  <thead className="text-slate-400 uppercase text-[10px]"><tr><th className="p-2">Producto</th><th className="p-2 text-right">Pedido</th><th className="p-2 text-right">Elegido</th><th className="p-2 text-right">Falta</th><th className="p-2 text-right">Sobra</th></tr></thead>
                  <tbody className="divide-y divide-white/[0.04] text-slate-300">
                    {comparacion.map(c => (
                      <tr key={c.catalogo_media_id}>
                        <td className="p-2 font-mono">{codigoDe(c.catalogo_media_id)?.sku || codigoDe(c.catalogo_media_id)?.codigo}</td>
                        <td className="p-2 text-right font-mono">{c.pedidas}</td>
                        <td className="p-2 text-right font-mono">{c.elegidas}</td>
                        <td className={`p-2 text-right font-mono ${c.falta > 0 ? 'text-red-400 font-bold' : ''}`}>{c.falta || ''}</td>
                        <td className={`p-2 text-right font-mono ${c.sobra > 0 ? 'text-amber-300 font-bold' : ''}`}>{c.sobra || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Sacos disponibles para este pedido</h4>
                  {disponibles.length === 0 ? <p className="text-amber-300 text-xs">No hay sacos en los salones con los productos de este pedido</p> : (
                    <ul className="divide-y divide-white/[0.04]">
                      {disponibles.map(s => (
                        <li key={s.id} className="flex items-center justify-between py-1.5 text-xs" data-testid={`saco-disponible-${s.codigo_paquete}`}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={elegidos.includes(s.id)} onChange={() => alternar(s.id)} aria-label={`Elegir saco ${s.codigo_paquete}`} />
                            <span className="font-mono text-white">{s.codigo_paquete}</span>
                            <span className="text-slate-400">{codigoDe(s.catalogo_media_id!)?.codigo} · {s.docenas} doc. · {s.ubicacion?.nombre}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {listo
                  ? <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Listo para despachar
                      {sobrantes.length > 0 && <span className="text-amber-300 ml-2">· Sobran {sobrantes.map(s => `${s.sobra} doc. de ${codigoDe(s.catalogo_media_id)?.codigo}`).join(', ')}</span>}</p>
                  : <p className="text-xs text-amber-400 font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Elige sacos hasta cubrir todo lo pedido</p>}
              </div>
            ) : (
              <div className="glass rounded-2xl flex flex-col items-center justify-center py-24 text-slate-500">
                <Truck className="w-12 h-12 mb-3 opacity-25" />
                <p className="font-medium">Selecciona un pedido para elegir sus sacos</p>
              </div>
            )}
          </div>
        </div>
      )}

      {vistaActiva === 'kardex' && (
        <div className="space-y-4">
          <div className="glass rounded-2xl p-4">
            <input type="text" placeholder="Buscar por guía, pedido, cliente, agencia o quién despachó..." value={busquedaKardex}
              onChange={e => setBusquedaKardex(e.target.value)} className="input-dark w-full text-sm" />
          </div>
          {loading ? <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
            : guiasFiltradas.length === 0 ? <p className="glass rounded-2xl text-center py-16 text-slate-500">No hay despachos registrados aún</p>
            : (
              <div className="space-y-3">
                {guiasFiltradas.map(guia => (
                  <div key={guia.id} className="glass rounded-2xl p-5 border border-white/[0.06]" data-testid={`guia-${guia.codigo_guia}`}>
                    <div className="flex items-center gap-3 mb-3 flex-wrap">
                      <code className="text-blue-300 font-mono text-sm font-bold bg-blue-500/10 px-2.5 py-1 rounded-lg">{guia.codigo_guia}</code>
                      <span className="badge badge-success text-[10px]">Despachado</span>
                      <span className="text-xs text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-lg">{guia.agencia}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400 mb-3">
                      <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /><span className="font-semibold text-white">{guia.venta?.cliente?.nombre}</span><span>({guia.venta?.cliente?.numero_documento})</span></div>
                      <div className="flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" /><code className="text-blue-300">{guia.venta?.codigo_venta}</code><span className="text-emerald-400 font-bold ml-1">{formatearMoneda(guia.venta?.total_soles ?? 0)}</span></div>
                      <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /><span>Despacho: <strong className="text-slate-300">{formatearFecha(guia.fecha_despacho)}</strong></span></div>
                      <div className="flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /><span>Despachó: <strong className="text-slate-300">{guia.despachado?.nombre ?? 'Sin registrar'}</strong></span></div>
                    </div>
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-slate-500 uppercase text-[10px]"><tr><th className="py-1">Producto</th><th className="py-1 text-right">Pedido</th><th className="py-1 text-right">Entregado</th><th className="py-1 text-right">De más</th></tr></thead>
                      <tbody className="text-slate-300">
                        {(guia.despacho_detalle?.length ? guia.despacho_detalle.map(d => ({ c: d.catalogo_media, p: d.docenas_pedidas, e: d.docenas_entregadas }))
                          : (guia.venta?.items_venta ?? []).map(i => ({ c: i.catalogo_media, p: i.docenas, e: i.docenas }))).map((d, i) => (
                          <tr key={i}><td className="py-1 font-mono">{d.c?.sku || d.c?.codigo}</td><td className="py-1 text-right">{d.p}</td><td className="py-1 text-right">{d.e}</td>
                            <td className={`py-1 text-right ${Number(d.e) > Number(d.p) ? 'text-amber-300 font-bold' : ''}`}>{Number(d.e) > Number(d.p) ? Math.round((Number(d.e) - Number(d.p)) * 100) / 100 : ''}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      <Modal open={Boolean(showDespachoModal && ventaSeleccionada)} onClose={() => setShowDespachoModal(false)} title="Confirmar Despacho" maxWidth="md"
        footer={<>
          <button onClick={() => setShowDespachoModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
          <button onClick={despachar} disabled={procesando || !agenciaSeleccionada} className="btn-primary flex-1 justify-center">
            {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Despachar y Cerrar
          </button></>}>
        {ventaSeleccionada && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-400">Pedido <strong className="text-white">{ventaSeleccionada.codigo_venta}</strong> · {ventaSeleccionada.cliente?.nombre}</p>
            <p className="text-slate-400">Sacos: <span className="font-mono text-white">{sacosElegidos.map(s => s.codigo_paquete).join(', ')}</span></p>
            {sobrantes.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs" data-testid="aviso-sobrante">
                Se entregan de más: {sobrantes.map(s => `${s.sobra} docenas de ${codigoDe(s.catalogo_media_id)?.codigo}`).join(', ')}. Quedará registrado en el kardex.
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Agencia de Transporte</label>
              <CustomSelect value={agenciaSeleccionada} onChange={val => setAgenciaSeleccionada(val)}
                options={[{ value: '', label: 'Seleccionar agencia...' }, ...agencias.map(ag => ({ value: ag.nombre, label: ag.nombre }))]} placeholder="Seleccionar agencia..." />
              {mostrarNuevaAgencia ? (
                <div className="flex gap-2 mt-2">
                  <input type="text" autoFocus aria-label="Nombre de la nueva agencia" placeholder="Nombre de la nueva agencia" value={nombreNuevaAgencia}
                    onChange={e => setNombreNuevaAgencia(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarNuevaAgencia() } }}
                    className="input-dark flex-1 text-xs py-2" />
                  <button type="button" onClick={guardarNuevaAgencia} disabled={guardandoAgencia} className="btn-primary text-xs py-2 px-3">
                    {guardandoAgencia ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Guardar Agencia
                  </button>
                  <button type="button" onClick={() => { setMostrarNuevaAgencia(false); setNombreNuevaAgencia('') }} className="btn-secondary text-xs py-2 px-2" aria-label="Cancelar nueva agencia"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <button type="button" onClick={() => setMostrarNuevaAgencia(true)} className="mt-2 text-xs font-bold text-cyan-300 hover:text-cyan-200 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Añadir agencia</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
