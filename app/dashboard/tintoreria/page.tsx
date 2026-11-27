'use client'

// Tintorería (Fase 5B, migración 033): las medias crudas y volteadas se envían a teñir
// con su SKU de color de destino; al volver, lo recibido entra a Planchado con ese SKU y
// la diferencia es merma con su motivo. Reglas: lib/domain/tintoreria.ts y funciones SQL.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Droplets, Loader2, Send, PackageCheck } from 'lucide-react'
import { formatearFecha } from '@/lib/utils'
import { coloresPara, mermaTintoreria, MATERIALES_TINTORERIA, ETIQUETA_MATERIAL, type MaterialTintoreria } from '@/lib/domain/tintoreria'
import SelectorMedia from '@/components/ui/SelectorMedia'
import Modal from '@/components/ui/Modal'
import IngresoStockFuera from '@/components/produccion/IngresoStockFuera'

interface Media { id: string; codigo: string; sku?: string | null; modelo: string; publico: string; talla: string; diseno_color?: string; es_crudo?: boolean; estado?: string }
interface Persona { id: string; nombre: string }
interface StockTenir { catalogo_media_id: string; docenas: number }
interface Lote {
  id: string; crudo_id: string; color_id: string; material: MaterialTintoreria; docenas_enviadas: number; estado: 'en_tintoreria' | 'recibido'
  docenas_recibidas: number | null; docenas_merma: number | null; motivo_merma: string | null; fecha_envio: string; fecha_recepcion: string | null
  crudo?: { codigo: string } | null; color?: { codigo: string; sku?: string | null } | null; remalladora?: { nombre: string } | null
}

const ROLES_REMALLADO = ['remalladora', 'remallador', 'operador']

export default function TintoreriaPage() {
  const supabase = createClient()
  const [catalogo, setCatalogo] = useState<Media[]>([])
  const [stock, setStock] = useState<StockTenir[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [remalladoras, setRemalladoras] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)

  const [envio, setEnvio] = useState({ crudo: '', color: '', material: 'algodon' as MaterialTintoreria, docenas: '', remalladora: '' })
  const [recepcion, setRecepcion] = useState<{ lote: Lote; recibidas: string; motivo: string } | null>(null)

  const leer = useCallback(async () => {
    const [cat, st, lt, us] = await Promise.all([
      supabase.from('catalogo_medias').select('id, sku, codigo, modelo, publico, talla, diseno_color, es_crudo, estado').eq('estado', 'activo').order('codigo'),
      supabase.from('stock_listo_tenir').select('catalogo_media_id, docenas'),
      supabase.from('lotes_tintoreria').select(`id, crudo_id, color_id, material, docenas_enviadas, estado, docenas_recibidas, docenas_merma, motivo_merma, fecha_envio, fecha_recepcion,
        crudo:catalogo_medias!lotes_tintoreria_crudo_id_fkey(codigo), color:catalogo_medias!lotes_tintoreria_color_id_fkey(codigo, sku),
        remalladora:usuarios!lotes_tintoreria_remalladora_id_fkey(nombre)`).order('fecha_envio', { ascending: false }).limit(60),
      supabase.from('usuarios').select('id, nombre, rol').eq('activo', true).order('nombre'),
    ])
    for (const [nombre, r] of [['catálogo', cat], ['stock por teñir', st], ['lotes', lt], ['remalladoras', us]] as const) {
      if (r.error) toast.error(`Error al cargar ${nombre}: ${r.error.message}`)
    }
    return {
      catalogo: (cat.data ?? []) as Media[],
      stock: (st.data ?? []) as StockTenir[],
      lotes: (lt.data ?? []) as unknown as Lote[],
      remalladoras: ((us.data ?? []) as (Persona & { rol: string })[]).filter(u => ROLES_REMALLADO.includes(u.rol)),
    }
  }, [supabase])

  const aplicar = useCallback((d: Awaited<ReturnType<typeof leer>>) => {
    setCatalogo(d.catalogo); setStock(d.stock); setLotes(d.lotes); setRemalladoras(d.remalladoras); setLoading(false)
  }, [])
  useEffect(() => {
    let vigente = true
    ;(async () => { const d = await leer(); if (vigente) aplicar(d) })()
    return () => { vigente = false }
  }, [leer, aplicar])
  const recargar = async () => aplicar(await leer())

  const porTenir = useMemo(() => stock.filter(s => Number(s.docenas) > 0)
    .map(s => ({ ...s, media: catalogo.find(c => c.id === s.catalogo_media_id) }))
    .filter(s => s.media), [stock, catalogo])
  const crudosConStock = useMemo(() => porTenir.map(s => s.media!), [porTenir])
  const crudoElegido = catalogo.find(c => c.id === envio.crudo)
  const colores = useMemo(() => coloresPara(catalogo, crudoElegido), [catalogo, crudoElegido])
  const hay = Number(stock.find(s => s.catalogo_media_id === envio.crudo)?.docenas ?? 0)
  const enCurso = lotes.filter(l => l.estado === 'en_tintoreria')
  const recibidos = lotes.filter(l => l.estado === 'recibido')

  const enviar = async () => {
    if (!envio.crudo) { toast.error('Elige la media cruda que se envía'); return }
    if (!envio.color) { toast.error('Elige el SKU de color en que vuelve'); return }
    const n = Number(envio.docenas)
    if (!Number.isFinite(n) || n <= 0) { toast.error('Las docenas deben ser mayores a 0'); return }
    if (n > hay) { toast.error(`Solo hay ${hay} docenas por teñir de ${crudoElegido?.codigo ?? ''}`); return }
    if (!envio.remalladora) { toast.error('Elige la operadora que remalló'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('enviar_lote_tintoreria', {
      p_crudo_id: envio.crudo, p_color_id: envio.color, p_material: envio.material, p_docenas: n, p_remalladora_id: envio.remalladora,
    })
    setGuardando(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Lote enviado a tintorería: ${n} docenas de ${crudoElegido?.codigo ?? ''}`)
    setEnvio(e => ({ ...e, docenas: '', color: '' }))
    recargar()
  }

  const recibir = async () => {
    if (!recepcion) return
    const n = Number(recepcion.recibidas)
    if (!Number.isFinite(n) || n < 0) { toast.error('Ingresa las docenas recibidas'); return }
    const merma = mermaTintoreria(recepcion.lote.docenas_enviadas, n)
    if (merma < 0) { toast.error(`Se enviaron ${recepcion.lote.docenas_enviadas} docenas`); return }
    if (merma > 0 && !recepcion.motivo.trim()) { toast.error(`Faltan ${merma} docenas: indica el motivo de la merma`); return }
    setGuardando(true)
    const { error } = await supabase.rpc('recibir_lote_tintoreria', { p_lote_id: recepcion.lote.id, p_docenas_recibidas: n, p_motivo_merma: recepcion.motivo.trim() || null })
    setGuardando(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Lote recibido: ${n} docenas de ${recepcion.lote.color?.codigo ?? ''} pasan a Planchado${merma > 0 ? ` (merma ${merma})` : ''}`)
    setRecepcion(null)
    recargar()
  }

  const mermaVista = recepcion ? mermaTintoreria(recepcion.lote.docenas_enviadas, Number(recepcion.recibidas || 0)) : 0

  return (
    <div className="space-y-6 animate-fadeInUp pb-12 text-xs">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-300"><Droplets className="w-6 h-6" /></div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Tintorería</h1>
            <p className="text-slate-400 text-xs font-medium">Las medias crudas y volteadas se tiñen y pasan a Planchado con su SKU de color</p>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <IngresoStockFuera etapa="tintoreria" onIngreso={recargar} />
          <span className="px-3.5 py-2 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-300 font-bold">{enCurso.length} en tintorería</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass rounded-3xl p-5 border border-white/[0.08]">
          <h2 className="text-sm font-bold text-white mb-3">Por teñir</h2>
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-blue-300" /> : porTenir.length === 0 ? (
            <p className="text-slate-500">No hay medias volteadas esperando tintorería</p>
          ) : (
            <ul className="space-y-1" data-testid="por-tenir">
              {porTenir.map(s => <li key={s.catalogo_media_id} className="flex justify-between"><span className="font-mono">{s.media!.codigo}</span><span className="font-mono text-blue-300">{s.docenas} doc.</span></li>)}
            </ul>
          )}
        </div>

        <div className="glass rounded-3xl p-5 border border-blue-500/20 lg:col-span-2 space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Send className="w-4 h-4 text-blue-300" />Enviar lote a tintorería</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <span className="block text-slate-400 mb-1">Media cruda</span>
              <SelectorMedia items={crudosConStock} value={envio.crudo} onChange={v => setEnvio({ ...envio, crudo: v, color: '' })}
                emptyOption={{ value: '', label: 'Elegir media cruda…' }} toOption={c => ({ value: c.id, label: c.codigo })} placeholder="Elegir media cruda…" />
              {envio.crudo && <p className="text-[10px] text-slate-500 mt-1">Hay {hay} docenas por teñir</p>}
            </div>
            <div>
              <span className="block text-slate-400 mb-1">SKU de color en que vuelve</span>
              <SelectorMedia items={colores} value={envio.color} onChange={v => setEnvio({ ...envio, color: v })}
                emptyOption={{ value: '', label: envio.crudo ? (colores.length ? 'Elegir SKU de color…' : 'No hay SKU de color: créalo en Catálogo') : 'Primero elige la media cruda' }}
                toOption={c => ({ value: c.id, label: `${c.codigo}${c.diseno_color ? ` (${c.diseno_color})` : ''}` })} placeholder="Elegir SKU de color…" />
            </div>
            <div>
              <label htmlFor="tinto-material" className="block text-slate-400 mb-1">Material</label>
              <select id="tinto-material" value={envio.material} onChange={e => setEnvio({ ...envio, material: e.target.value as MaterialTintoreria })} className="input-dark w-full">
                {MATERIALES_TINTORERIA.map(m => <option key={m} value={m}>{ETIQUETA_MATERIAL[m]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="tinto-docenas" className="block text-slate-400 mb-1">Docenas</label>
              <input id="tinto-docenas" type="number" min="0" step="0.5" value={envio.docenas} onChange={e => setEnvio({ ...envio, docenas: e.target.value })} className="input-dark w-full" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="tinto-remalladora" className="block text-slate-400 mb-1">Operadora que remalló</label>
              <select id="tinto-remalladora" value={envio.remalladora} onChange={e => setEnvio({ ...envio, remalladora: e.target.value })} className="input-dark w-full">
                <option value="">Elegir operadora…</option>
                {remalladoras.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          </div>
          <button type="button" onClick={enviar} disabled={guardando} className="btn-primary text-xs">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar a tintorería
          </button>
        </div>
      </div>

      <div className="glass rounded-3xl p-5 border border-white/[0.08] overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-3">En tintorería</h2>
        <table className="w-full text-left text-xs">
          <thead className="text-slate-400 uppercase text-[10px]"><tr><th className="p-2">Enviado</th><th className="p-2">Media cruda</th><th className="p-2">Vuelve como</th><th className="p-2">Material</th><th className="p-2 text-right">Docenas</th><th className="p-2">Remalló</th><th className="p-2 text-right">Acción</th></tr></thead>
          <tbody className="divide-y divide-white/[0.04] text-slate-300">
            {enCurso.length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-slate-500">No hay lotes en tintorería</td></tr> : enCurso.map(l => (
              <tr key={l.id} data-testid={`lote-tintoreria-${l.crudo?.codigo}`}>
                <td className="p-2">{formatearFecha(l.fecha_envio)}</td>
                <td className="p-2 font-mono">{l.crudo?.codigo ?? '—'}</td>
                <td className="p-2 font-mono">{l.color?.codigo ?? '—'}</td>
                <td className="p-2">{ETIQUETA_MATERIAL[l.material] ?? l.material}</td>
                <td className="p-2 text-right font-mono">{l.docenas_enviadas}</td>
                <td className="p-2">{l.remalladora?.nombre ?? '—'}</td>
                <td className="p-2 text-right">
                  <button type="button" className="btn-secondary text-[11px] py-1 px-2" onClick={() => setRecepcion({ lote: l, recibidas: String(l.docenas_enviadas), motivo: '' })}>
                    <PackageCheck className="w-3 h-3" /> Recibir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="glass rounded-3xl p-5 border border-white/[0.08] overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-3">Recibidos</h2>
        <table className="w-full text-left text-xs">
          <thead className="text-slate-400 uppercase text-[10px]"><tr><th className="p-2">Recibido</th><th className="p-2">Media cruda</th><th className="p-2">SKU de color</th><th className="p-2 text-right">Enviadas</th><th className="p-2 text-right">Recibidas</th><th className="p-2 text-right">Merma</th><th className="p-2">Motivo</th></tr></thead>
          <tbody className="divide-y divide-white/[0.04] text-slate-300">
            {recibidos.length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-slate-500">Aún no se recibió ningún lote</td></tr> : recibidos.map(l => (
              <tr key={l.id}>
                <td className="p-2">{l.fecha_recepcion ? formatearFecha(l.fecha_recepcion) : '—'}</td>
                <td className="p-2 font-mono">{l.crudo?.codigo ?? '—'}</td>
                <td className="p-2 font-mono">{l.color?.codigo ?? '—'}</td>
                <td className="p-2 text-right font-mono">{l.docenas_enviadas}</td>
                <td className="p-2 text-right font-mono">{l.docenas_recibidas}</td>
                <td className={`p-2 text-right font-mono ${Number(l.docenas_merma) > 0 ? 'text-amber-300' : ''}`}>{l.docenas_merma}</td>
                <td className="p-2">{l.motivo_merma ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!recepcion} onClose={() => setRecepcion(null)} title="Recibir lote de tintorería"
        subtitle={recepcion ? `${recepcion.lote.crudo?.codigo ?? ''} → ${recepcion.lote.color?.codigo ?? ''} · se enviaron ${recepcion.lote.docenas_enviadas} docenas` : undefined}
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setRecepcion(null)}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={recibir} disabled={guardando}>Guardar recepción</button></div>}>
        {recepcion && (
          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="tinto-recibidas" className="block text-slate-400 mb-1">Docenas recibidas</label>
              <input id="tinto-recibidas" type="number" min="0" step="0.5" value={recepcion.recibidas} onChange={e => setRecepcion({ ...recepcion, recibidas: e.target.value })} className="input-dark w-full" />
            </div>
            {mermaVista > 0 && (
              <div>
                <label htmlFor="tinto-motivo" className="block text-amber-300 mb-1">Merma: {mermaVista} docenas. Motivo</label>
                <input id="tinto-motivo" type="text" placeholder="Ej. manchadas, color disparejo…" value={recepcion.motivo} onChange={e => setRecepcion({ ...recepcion, motivo: e.target.value })} className="input-dark w-full" />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
