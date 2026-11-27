'use client'

// Stock de fuera (Fase 5A, migración 032): medias que no salieron de las máquinas
// registradas (producidas antes del sistema o traídas de otro lugar). Entran como
// pendientes de la etapa elegida y no generan egreso. La regla vive en la función
// SQL ingresar_stock_fuera.
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { PackagePlus, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import SelectorMedia from '@/components/ui/SelectorMedia'
import { formatearFecha } from '@/lib/utils'
import type { ProductoBuscable } from '@/lib/domain/catalogo'
import { ETAPA_EN_CRUDO, type EtapaStockFuera } from '@/lib/domain/tintoreria'

export type { EtapaStockFuera }

const TEXTO_ETAPA: Record<EtapaStockFuera, string> = {
  remallado: 'en Remallado (solo queda registrado: el lote se asigna a mano)',
  volteado: 'por voltear', tintoreria: 'por teñir', planchado: 'por planchar', preparado: 'por preparar',
}

type Producto = ProductoBuscable & { id: string; codigo: string; es_crudo?: boolean | null }
type Ingreso = { id: string; docenas: number; origen: string; created_at: string; catalogo_media?: { codigo: string } | null; registrador?: { nombre: string } | null }

/** En Remallado, Volteado y Tintorería solo medias crudas; en Planchado y Preparado, con color (033). */
export default function IngresoStockFuera({ etapa, onIngreso }: { etapa: EtapaStockFuera; onIngreso?: () => void }) {
  const supabase = createClient()
  const [catalogo, setCatalogo] = useState<Producto[]>([])
  const [abierto, setAbierto] = useState(false)
  const [producto, setProducto] = useState('')
  const [docenas, setDocenas] = useState('')
  const [origen, setOrigen] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [ingresos, setIngresos] = useState<Ingreso[]>([])

  const leer = useCallback(async () => {
    const { data, error } = await supabase.from('ingresos_stock_fuera')
      .select('id, docenas, origen, created_at, catalogo_media:catalogo_medias(codigo), registrador:usuarios(nombre)')
      .eq('etapa', etapa).order('created_at', { ascending: false }).limit(10)
    if (error) toast.error(`Error cargando el stock de fuera: ${error.message}`)
    return (data ?? []) as unknown as Ingreso[]
  }, [supabase, etapa])

  useEffect(() => {
    let vigente = true
    ;(async () => {
      const [d, cat] = await Promise.all([
        leer(),
        supabase.from('catalogo_medias').select('id, sku, codigo, modelo, publico, diseno_color, talla, es_crudo').eq('estado', 'activo').order('codigo'),
      ])
      if (cat.error) toast.error(`Error cargando el catálogo: ${cat.error.message}`)
      if (!vigente) return
      setIngresos(d)
      setCatalogo(((cat.data ?? []) as Producto[]).filter(c => !!c.es_crudo === ETAPA_EN_CRUDO[etapa]))
    })()
    return () => { vigente = false }
  }, [leer, supabase, etapa])

  const guardar = async () => {
    if (!producto) { toast.error('Elige el producto'); return }
    const n = Number(docenas)
    if (!Number.isFinite(n) || n <= 0) { toast.error('Las docenas deben ser mayores a 0'); return }
    if (!origen.trim()) { toast.error('Indica de dónde vienen las medias'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('ingresar_stock_fuera', { p_etapa: etapa, p_catalogo_media_id: producto, p_docenas: n, p_origen: origen.trim() })
    setGuardando(false)
    if (error) { toast.error(error.message); return }
    const codigo = catalogo.find(c => c.id === producto)?.codigo ?? ''
    toast.success(`Stock de fuera ingresado: ${n} docenas de ${codigo} ${TEXTO_ETAPA[etapa]}`)
    setAbierto(false); setProducto(''); setDocenas(''); setOrigen('')
    setIngresos(await leer())
    onIngreso?.()
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className="btn-secondary text-xs py-2 rounded-2xl">
        <PackagePlus className="w-4 h-4" /> Ingresar stock de fuera
      </button>

      <Modal isOpen={abierto} onClose={() => setAbierto(false)} title="Ingresar stock de fuera"
        subtitle={`Medias que no salieron de las máquinas registradas. Entran ${TEXTO_ETAPA[etapa]}; no generan egreso.`}
        footer={<div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setAbierto(false)}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="w-4 h-4 animate-spin" />} Guardar ingreso
          </button></div>}>
        <div className="space-y-3 text-xs">
          <div>
            <span className="block text-slate-400 mb-1">Producto</span>
            <SelectorMedia items={catalogo} value={producto} onChange={setProducto} emptyOption={{ value: '', label: 'Elegir producto…' }}
              toOption={c => ({ value: c.id, label: c.codigo })} placeholder="Elegir producto…" />
          </div>
          <div>
            <label htmlFor={`fuera-docenas-${etapa}`} className="block text-slate-400 mb-1">Docenas</label>
            <input id={`fuera-docenas-${etapa}`} type="number" min="0" step="0.5" value={docenas} onChange={e => setDocenas(e.target.value)} className="input-dark w-full" />
          </div>
          <div>
            <label htmlFor={`fuera-origen-${etapa}`} className="block text-slate-400 mb-1">De dónde vienen</label>
            <input id={`fuera-origen-${etapa}`} type="text" placeholder="Ej. producción antes del sistema, taller externo…" value={origen} onChange={e => setOrigen(e.target.value)} className="input-dark w-full" />
          </div>
          {ingresos.length > 0 && (
            <div>
              <p className="text-slate-400 mb-1">Últimos ingresos</p>
              <ul className="space-y-1" data-testid={`ingresos-fuera-${etapa}`}>
                {ingresos.map(i => (
                  <li key={i.id} className="flex justify-between gap-2 text-slate-300">
                    <span>{formatearFecha(i.created_at)} · <span className="font-mono">{i.catalogo_media?.codigo ?? '—'}</span> · {i.docenas} doc. · {i.origen}</span>
                    <span className="text-slate-500">{i.registrador?.nombre ?? ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
