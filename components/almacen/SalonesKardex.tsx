'use client'

// Salones y kardex (Fase 6A, migración 034): stock por SKU de cada salón (imprimible),
// sus sacos con traslado a otro salón, y el kardex con fecha, hora, usuario y saldo.
// Las escrituras son funciones de la base (trasladar_saco); las reglas de saldo, lib/domain/despacho.ts.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Printer, ArrowRightLeft, BookOpen, Loader2 } from 'lucide-react'
import { escaparHtml as h } from '@/lib/utils'
import { kardexConSaldo, ETIQUETA_MOVIMIENTO, signoMovimiento, type TipoMovimiento } from '@/lib/domain/despacho'
import { hoyLocal, sumarDias } from '@/lib/domain/mantenimiento'
import Modal from '@/components/ui/Modal'

interface Salon { id: string; nombre: string }
interface Saco { id: string; codigo_paquete: string; docenas: number; ubicacion_id: string | null; catalogo_media_id: string | null; catalogo_media?: { codigo: string; sku?: string | null } | null }
interface Mov {
  id: string; tipo: string; docenas: number | null; ubicacion_id: string | null; created_at: string; referencia: string | null
  catalogo_media_id: string | null; paquete?: { codigo_paquete: string } | null; usuario?: { nombre: string } | null
  catalogo_media?: { codigo: string } | null
}

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })

/** `version`: cambia cuando la página de Almacén guarda algo, para volver a leer. */
export default function SalonesKardex({ version = '' }: { version?: string }) {
  const supabase = createClient()
  const [salones, setSalones] = useState<Salon[]>([])
  const [sacos, setSacos] = useState<Saco[]>([])
  const [movs, setMovs] = useState<Mov[]>([])
  const [salon, setSalon] = useState('')
  const [sku, setSku] = useState('')
  const [desde, setDesde] = useState(sumarDias(hoyLocal(), -30))
  const [hasta, setHasta] = useState(hoyLocal())
  const [cargando, setCargando] = useState(true)
  const [traslado, setTraslado] = useState<{ saco: Saco; destino: string } | null>(null)
  const [recarga, setRecarga] = useState(0)

  const leer = useCallback(async () => {
    const [ub, pq, mv] = await Promise.all([
      supabase.from('ubicaciones').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('paquetes').select('id, codigo_paquete, docenas, ubicacion_id, catalogo_media_id, catalogo_media:catalogo_medias(codigo, sku)').eq('estado', 'almacenado'),
      supabase.from('movimientos_stock').select('id, tipo, docenas, ubicacion_id, created_at, referencia, catalogo_media_id, paquete:paquetes(codigo_paquete), usuario:usuarios(nombre), catalogo_media:catalogo_medias(codigo)')
        .gte('created_at', `${desde}T00:00:00`).lte('created_at', `${hasta}T23:59:59`).order('created_at', { ascending: true }),
    ])
    for (const [n, r] of [['salones', ub], ['sacos', pq], ['kardex', mv]] as const) if (r.error) toast.error(`Error cargando ${n}: ${r.error.message}`)
    return { salones: (ub.data ?? []) as Salon[], sacos: (pq.data ?? []) as unknown as Saco[], movs: (mv.data ?? []) as unknown as Mov[] }
  }, [supabase, desde, hasta])

  useEffect(() => {
    let vigente = true
    ;(async () => {
      const d = await leer()
      if (!vigente) return
      setSalones(d.salones); setSacos(d.sacos); setMovs(d.movs); setCargando(false)
      setSalon(s => s || d.salones[0]?.id || '')
    })()
    return () => { vigente = false }
  }, [leer, version, recarga])

  const nombreSalon = (id: string | null) => salones.find(s => s.id === id)?.nombre ?? '—'
  const sacosSalon = useMemo(() => sacos.filter(s => s.ubicacion_id === salon), [sacos, salon])
  const stockSalon = useMemo(() => {
    const m = new Map<string, { codigo: string; sku: string; sacos: number; docenas: number }>()
    for (const s of sacosSalon) {
      const k = s.catalogo_media_id ?? '—'
      const a = m.get(k) ?? { codigo: s.catalogo_media?.codigo ?? '—', sku: s.catalogo_media?.sku ?? '', sacos: 0, docenas: 0 }
      a.sacos += 1; a.docenas = Math.round((a.docenas + Number(s.docenas)) * 100) / 100
      m.set(k, a)
    }
    return [...m.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [sacosSalon])
  const skus = useMemo(() => [...new Map(movs.filter(m => m.catalogo_media_id).map(m => [m.catalogo_media_id!, m.catalogo_media?.codigo ?? ''])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [movs])
  const kardex = useMemo(() => {
    const filtrados = movs.filter(m => !sku || m.catalogo_media_id === sku)
    return salon ? kardexConSaldo(filtrados, salon) : []
  }, [movs, salon, sku])

  const imprimir = () => {
    const filas = stockSalon.map(r => `<tr><td>${h(r.codigo)}</td><td>${h(r.sku)}</td><td style="text-align:right">${r.sacos}</td><td style="text-align:right">${r.docenas}</td></tr>`).join('')
    const detalle = sacosSalon.map(s => `<tr><td>${h(s.codigo_paquete)}</td><td>${h(s.catalogo_media?.codigo ?? '')}</td><td style="text-align:right">${s.docenas}</td></tr>`).join('')
    const html = `<html><head><title>Stock ${h(nombreSalon(salon))}</title><style>body{font-family:Arial;padding:20px}table{border-collapse:collapse;width:100%;margin-bottom:16px}td,th{border:1px solid #ccc;padding:6px;font-size:12px}</style></head><body>
      <h2>Stock del ${h(nombreSalon(salon))}</h2><p>${h(new Date().toLocaleString('es-PE'))}</p>
      <table><thead><tr><th>Producto</th><th>SKU</th><th>Sacos</th><th>Docenas</th></tr></thead><tbody>${filas}</tbody></table>
      <h3>Sacos</h3><table><thead><tr><th>Saco</th><th>Producto</th><th>Docenas</th></tr></thead><tbody>${detalle}</tbody></table></body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  const trasladar = async () => {
    if (!traslado?.destino) { toast.error('Elige el salón de destino'); return }
    const { error } = await supabase.rpc('trasladar_saco', { p_paquete_id: traslado.saco.id, p_ubicacion_destino_id: traslado.destino })
    if (error) { toast.error(error.message); return }
    toast.success(`Saco ${traslado.saco.codigo_paquete} trasladado a ${nombreSalon(traslado.destino)}`)
    setTraslado(null)
    setRecarga(n => n + 1)
  }

  return (
    <div className="glass rounded-3xl p-6 border border-white/[0.08] space-y-5 text-xs" data-testid="salones-kardex">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <h2 className="text-base font-bold text-white flex items-center gap-2"><BookOpen className="w-5 h-5 text-cyan-400" />Salones y kardex</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label htmlFor="kardex-salon" className="block text-slate-400 mb-1">Salón</label>
            <select id="kardex-salon" value={salon} onChange={e => setSalon(e.target.value)} className="input-dark text-xs">
              {salones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <button type="button" onClick={imprimir} disabled={!salon} className="btn-secondary text-xs py-2"><Printer className="w-4 h-4" /> Imprimir stock del salón</button>
        </div>
      </div>

      {cargando ? <Loader2 className="w-5 h-5 animate-spin text-cyan-400" /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <h3 className="font-bold text-slate-300 mb-2">Stock por SKU</h3>
            <table className="w-full text-left" data-testid="stock-salon">
              <thead className="text-slate-400 uppercase text-[10px]"><tr><th className="p-2">Producto</th><th className="p-2 text-right">Sacos</th><th className="p-2 text-right">Docenas</th></tr></thead>
              <tbody className="divide-y divide-white/[0.04] text-slate-300">
                {stockSalon.length === 0 ? <tr><td colSpan={3} className="p-3 text-slate-500">Salón vacío</td></tr> : stockSalon.map(r => (
                  <tr key={r.codigo}><td className="p-2 font-mono">{r.codigo}</td><td className="p-2 text-right">{r.sacos}</td><td className="p-2 text-right font-mono">{r.docenas}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="font-bold text-slate-300 mb-2">Sacos del salón</h3>
            <ul className="divide-y divide-white/[0.04] max-h-64 overflow-y-auto">
              {sacosSalon.map(s => (
                <li key={s.id} className="flex items-center justify-between py-1.5" data-testid={`saco-${s.codigo_paquete}`}>
                  <span><span className="font-mono text-white">{s.codigo_paquete}</span> · {s.catalogo_media?.codigo ?? '—'} · {s.docenas} doc.</span>
                  <button type="button" className="btn-secondary text-[11px] py-1 px-2" onClick={() => setTraslado({ saco: s, destino: '' })}>
                    <ArrowRightLeft className="w-3 h-3" /> Trasladar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-end">
          <h3 className="font-bold text-slate-300 mr-auto">Kardex del salón</h3>
          <div>
            <label htmlFor="kardex-sku" className="block text-slate-400 mb-1">SKU</label>
            <select id="kardex-sku" value={sku} onChange={e => setSku(e.target.value)} className="input-dark text-xs">
              <option value="">Todos</option>
              {skus.map(([id, codigo]) => <option key={id} value={id}>{codigo}</option>)}
            </select>
          </div>
          <div><label htmlFor="kardex-desde" className="block text-slate-400 mb-1">Desde</label><input id="kardex-desde" type="date" value={desde} onChange={e => setDesde(e.target.value)} className="input-dark text-xs" /></div>
          <div><label htmlFor="kardex-hasta" className="block text-slate-400 mb-1">Hasta</label><input id="kardex-hasta" type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="input-dark text-xs" /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="kardex">
            <thead className="text-slate-400 uppercase text-[10px]"><tr><th className="p-2">Fecha y hora</th><th className="p-2">Movimiento</th><th className="p-2">Saco</th><th className="p-2">Producto</th>
              <th className="p-2 text-right">Entra</th><th className="p-2 text-right">Sale</th><th className="p-2 text-right">Saldo</th><th className="p-2">Usuario</th><th className="p-2">Detalle</th></tr></thead>
            <tbody className="divide-y divide-white/[0.04] text-slate-300">
              {kardex.length === 0 ? <tr><td colSpan={9} className="p-3 text-slate-500">Sin movimientos en el período</td></tr> : kardex.map(m => {
                const signo = signoMovimiento(m.tipo)
                return (
                  <tr key={m.id}>
                    <td className="p-2 whitespace-nowrap">{fechaHora(m.created_at)}</td>
                    <td className="p-2">{ETIQUETA_MOVIMIENTO[m.tipo as TipoMovimiento] ?? m.tipo}</td>
                    <td className="p-2 font-mono">{m.paquete?.codigo_paquete ?? '—'}</td>
                    <td className="p-2 font-mono">{m.catalogo_media?.codigo ?? '—'}</td>
                    <td className="p-2 text-right font-mono text-emerald-300">{signo > 0 ? m.docenas : ''}</td>
                    <td className="p-2 text-right font-mono text-amber-300">{signo < 0 ? m.docenas : ''}</td>
                    <td className="p-2 text-right font-mono text-white">{m.saldo}</td>
                    <td className="p-2">{m.usuario?.nombre ?? '—'}</td>
                    <td className="p-2 text-slate-500">{m.referencia ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={!!traslado} onClose={() => setTraslado(null)} title={`Trasladar ${traslado?.saco.codigo_paquete ?? ''}`}
        subtitle={traslado ? `Sale del ${nombreSalon(traslado.saco.ubicacion_id)}` : undefined}
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setTraslado(null)}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={trasladar}>Trasladar</button></div>}>
        {traslado && (
          <div>
            <label htmlFor="traslado-destino" className="block text-slate-400 text-xs mb-1">Salón de destino</label>
            <select id="traslado-destino" value={traslado.destino} onChange={e => setTraslado({ ...traslado, destino: e.target.value })} className="input-dark w-full text-xs">
              <option value="">Elegir salón…</option>
              {salones.filter(s => s.id !== traslado.saco.ubicacion_id).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}
      </Modal>
    </div>
  )
}
