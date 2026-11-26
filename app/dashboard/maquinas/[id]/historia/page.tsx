'use client'

// Historia clínica de una máquina (Fase 4): producción, fallas, reparaciones,
// repuestos y mantenimientos preventivos, por día o por semana; PDF y Excel.
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, FileSpreadsheet, FileText, Loader2, History } from 'lucide-react'
import { formatearMoneda, formatearFecha } from '@/lib/utils'
import {
  agruparHistoria, totalesHistoria, filasHistoria, hoyLocal, sumarDias, ETIQUETA_EVENTO, type EventoHistoria,
} from '@/lib/domain/mantenimiento'
import { etiquetaTurno } from '@/lib/domain/reportes'

const COLOR_EVENTO: Record<EventoHistoria['tipo'], string> = {
  produccion: 'bg-emerald-500/15 text-emerald-300',
  falla: 'bg-red-500/15 text-red-300',
  reparacion: 'bg-cyan-500/15 text-cyan-300',
  repuesto: 'bg-amber-500/15 text-amber-300',
  preventivo: 'bg-indigo-500/15 text-indigo-300',
}

export default function HistoriaMaquinaPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = createClient()
  const [codigo, setCodigo] = useState('')
  const [eventos, setEventos] = useState<EventoHistoria[]>([])
  const [desde, setDesde] = useState(sumarDias(hoyLocal(), -30))
  const [hasta, setHasta] = useState(hoyLocal())
  const [modo, setModo] = useState<'dia' | 'semana'>('dia')
  // Qué rango ya está cargado: mientras no coincida con el pedido, se muestra "cargando"
  const clave = `${id}|${desde}|${hasta}`
  const [claveCargada, setClaveCargada] = useState('')
  const rangoValido = desde <= hasta
  const cargando = rangoValido && claveCargada !== clave

  useEffect(() => {
    if (!id || !rangoValido) return
    let vigente = true
    ;(async () => {
      const maq = await supabase.from('maquinas').select('codigo').eq('id', id).maybeSingle()
      // La API devuelve como máximo 1000 filas por consulta: se pide por páginas para no cortar la historia
      const PAGINA = 1000
      const todos: EventoHistoria[] = []
      for (let desdeFila = 0; ; desdeFila += PAGINA) {
        const hist = await supabase.from('vista_historia_maquina').select('*').eq('maquina_id', id).gte('fecha', desde).lte('fecha', hasta)
          .order('momento', { ascending: true }).range(desdeFila, desdeFila + PAGINA - 1)
        if (hist.error) { if (vigente) toast.error(`Error al cargar la historia: ${hist.error.message}`); break }
        todos.push(...((hist.data ?? []) as EventoHistoria[]))
        if ((hist.data ?? []).length < PAGINA) break
      }
      if (!vigente) return
      if (maq.error) toast.error(`Error al cargar la máquina: ${maq.error.message}`)
      setCodigo(maq.data?.codigo ?? '')
      setEventos(todos)
      setClaveCargada(`${id}|${desde}|${hasta}`)
    })()
    return () => { vigente = false }
  }, [id, desde, hasta, rangoValido, supabase])

  const filas = useMemo(() => agruparHistoria(eventos, modo), [eventos, modo])
  const totales = useMemo(() => totalesHistoria(eventos), [eventos])
  const nombreArchivo = `historia_${codigo || 'maquina'}_${desde}_${hasta}`

  const descargarExcel = async () => {
    if (filas.length === 0) { toast.info('No hay registros en el período'); return }
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasHistoria(filas)), 'Historia')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Docenas producidas': totales.docenas, Fallas: totales.fallas, Reparaciones: totales.reparaciones,
      'Costo reparaciones (S/)': totales.costoReparaciones, 'Costo repuestos (S/)': totales.costoRepuestos,
      Preventivos: totales.preventivos, 'Mano de obra preventivos (S/)': totales.manoObraPreventivos,
    }]), 'Totales')
    XLSX.writeFile(wb, `${nombreArchivo}.xlsx`)
    toast.success(`Historia descargada: ${nombreArchivo}.xlsx`)
  }

  const descargarPdf = async () => {
    if (filas.length === 0) { toast.info('No hay registros en el período'); return }
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(16)
    doc.text(`Historia clínica — Máquina ${codigo}`, 14, 18)
    doc.setFontSize(10)
    doc.text(`Período: ${formatearFecha(desde)} al ${formatearFecha(hasta)} · ${modo === 'dia' ? 'Por día' : 'Por semana'}`, 14, 25)
    doc.text(`Docenas: ${totales.docenas} · Fallas: ${totales.fallas} · Reparaciones: ${formatearMoneda(totales.costoReparaciones)} · ` +
      `Repuestos: ${formatearMoneda(totales.costoRepuestos)} · Preventivos: ${totales.preventivos} (${formatearMoneda(totales.manoObraPreventivos)})`, 14, 31)
    const datos = filasHistoria(filas)
    autoTable(doc, {
      head: [Object.keys(datos[0])],
      body: datos.map(f => Object.values(f).map(v => (v == null ? '—' : String(v)))),
      startY: 36, theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [30, 58, 138] },
    })
    doc.save(`${nombreArchivo}.pdf`)
    toast.success(`Historia descargada: ${nombreArchivo}.pdf`)
  }

  return (
    <div className="space-y-6 animate-fadeInUp">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/maquinas" className="btn-secondary text-xs py-2 px-3" aria-label="Volver a Máquinas"><ArrowLeft className="w-4 h-4" /></Link>
          <div className="p-2 rounded-xl bg-indigo-500/10"><History className="w-5 h-5 text-indigo-400" /></div>
          <h1 className="text-2xl font-bold text-white">Historia clínica {codigo && <span className="font-mono text-amber-300">{codigo}</span>}</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={descargarExcel} className="btn-secondary text-xs flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" /> Descargar Excel</button>
          <button type="button" onClick={descargarPdf} className="btn-primary text-xs flex items-center gap-1.5"><FileText className="w-4 h-4" /> Imprimir PDF</button>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="historia-desde" className="block text-xs text-slate-400 mb-1">Desde</label>
          <input id="historia-desde" type="date" value={desde} onChange={e => setDesde(e.target.value)} className="input-dark text-xs" />
        </div>
        <div>
          <label htmlFor="historia-hasta" className="block text-xs text-slate-400 mb-1">Hasta</label>
          <input id="historia-hasta" type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="input-dark text-xs" />
        </div>
        <div className="flex gap-1 p-1 rounded-2xl bg-slate-900/60 border border-white/[0.06]" role="group" aria-label="Agrupar">
          {(['dia', 'semana'] as const).map(m => (
            <button key={m} type="button" aria-pressed={modo === m} onClick={() => setModo(m)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${modo === m ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {m === 'dia' ? 'Por día' : 'Por semana'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="totales-historia">
        {[
          ['Docenas producidas', String(totales.docenas)],
          ['Fallas', String(totales.fallas)],
          ['Reparaciones', `${totales.reparaciones} · ${formatearMoneda(totales.costoReparaciones)}`],
          ['Preventivos', `${totales.preventivos} · ${formatearMoneda(totales.manoObraPreventivos)}`],
        ].map(([label, valor]) => (
          <div key={label} className="glass rounded-2xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
            <p className="text-lg font-bold text-white font-mono">{valor}</p>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl overflow-x-auto">
        {cargando ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>
        ) : !rangoValido ? (
          <p className="text-center text-amber-300 py-10">La fecha «desde» no puede ser posterior a «hasta».</p>
        ) : filas.length === 0 ? (
          <p className="text-center text-slate-500 py-10">Sin registros en el período.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-slate-400 uppercase text-[10px]">
              <tr><th className="p-3">Fecha</th><th className="p-3">Evento</th><th className="p-3">Turno</th><th className="p-3">Detalle</th>
                <th className="p-3 text-right">Cantidad</th><th className="p-3 text-right">Costo</th><th className="p-3">Persona</th><th className="p-3">Mecánico</th></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-slate-300">
              {filas.map((e, i) => (
                <tr key={`${e.tipo}-${e.momento}-${i}`}>
                  <td className="p-3 font-mono">{formatearFecha(e.fecha)}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-lg ${COLOR_EVENTO[e.tipo]}`}>{ETIQUETA_EVENTO[e.tipo]}</span></td>
                  <td className="p-3">{e.turno ? etiquetaTurno(e.turno) : '—'}</td>
                  <td className="p-3">{e.detalle || '—'}</td>
                  <td className="p-3 text-right font-mono">{e.cantidad ?? '—'}</td>
                  <td className="p-3 text-right font-mono">{e.costo != null ? formatearMoneda(Number(e.costo)) : '—'}</td>
                  <td className="p-3">{e.persona || '—'}</td>
                  <td className="p-3">{e.mecanico || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
