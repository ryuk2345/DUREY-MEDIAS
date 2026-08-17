// @ts-nocheck
'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BarChart3, Download, Calendar, FileSpreadsheet, FileText, Loader2, TrendingUp, Package, Scissors, Wind, Warehouse, ShoppingCart, Wrench, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { formatearFecha, formatearMoneda } from '@/lib/utils'
import * as XLSX from 'xlsx'

const MODULOS_REPORTE = [
  { id: 'produccion', label: 'Tejido / Producción', icon: <Layers className="w-5 h-5" />, color: 'text-violet-400', bg: 'bg-violet-500/10' },
  { id: 'remallado', label: 'Remallado', icon: <Scissors className="w-5 h-5" />, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  { id: 'planchado', label: 'Planchado', icon: <Wind className="w-5 h-5" />, color: 'text-red-400', bg: 'bg-red-500/10' },
  { id: 'preparado', label: 'Preparado y Embolsado', icon: <Package className="w-5 h-5" />, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { id: 'almacen', label: 'Almacén y Despacho', icon: <Warehouse className="w-5 h-5" />, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  { id: 'ventas', label: 'Ventas y Caja', icon: <ShoppingCart className="w-5 h-5" />, color: 'text-pink-400', bg: 'bg-pink-500/10' },
  { id: 'mantenimiento', label: 'Mantenimiento', icon: <Wrench className="w-5 h-5" />, color: 'text-amber-400', bg: 'bg-amber-500/10' },
]

export default function ReportesPage() {
  const [moduloSeleccionado, setModuloSeleccionado] = useState<string | null>(null)
  const [fechaInicio, setFechaInicio] = useState(new Date().toISOString().split('T')[0])
  const [fechaFin, setFechaFin] = useState(new Date().toISOString().split('T')[0])
  const [formato, setFormato] = useState<'excel' | 'pdf'>('excel')
  const [generando, setGenerando] = useState(false)
  const supabase = createClient()

  const generarReporte = useCallback(async () => {
    if (!moduloSeleccionado) { toast.error('Selecciona un módulo'); return }
    setGenerando(true)

    try {
      let data: Record<string, unknown>[] = []
      let nombreArchivo = `reporte_${moduloSeleccionado}_${fechaInicio}_${fechaFin}`

      switch (moduloSeleccionado) {
        case 'produccion': {
          const { data: rows, error } = await supabase
            .from('reportes_produccion')
            .select('fecha, docenas_producidas, maquina:maquinas(codigo), catalogo_media:catalogo_medias(codigo)')
            .gte('fecha', fechaInicio).lte('fecha', fechaFin)
          if (error) toast.error(`Error al generar reporte de producción: ${error.message}`)
          data = (rows ?? []).map(r => ({
            Fecha: formatearFecha(r.fecha as string),
            Máquina: (r.maquina as {codigo:string})?.codigo,
            'Tipo de Media': (r.catalogo_media as {codigo:string})?.codigo,
            'Docenas Producidas': r.docenas_producidas,
          }))
          break
        }
        case 'remallado': {
          const { data: rows, error } = await supabase
            .from('reportes_remallado')
            .select('fecha, docenas_remalladas, docenas_restantes, lote:lotes_remallado(catalogo_media:catalogo_medias(codigo))')
            .gte('fecha', fechaInicio).lte('fecha', fechaFin)
          if (error) toast.error(`Error al generar reporte de remallado: ${error.message}`)
          data = (rows ?? []).map(r => ({
            Fecha: formatearFecha(r.fecha as string),
            'Tipo de Media': ((r.lote as {catalogo_media:{codigo:string}})?.catalogo_media)?.codigo,
            'Docenas Remalladas': r.docenas_remalladas,
            'Docenas Restantes': r.docenas_restantes,
          }))
          break
        }
        case 'planchado': {
          const { data: rows, error } = await supabase
            .from('reportes_planchado')
            .select('fecha, docenas_planchadas, docenas_defectuosas, planchador:usuarios(nombre), catalogo_media:catalogo_medias(codigo)')
            .gte('fecha', fechaInicio).lte('fecha', fechaFin)
          if (error) toast.error(`Error al generar reporte de planchado: ${error.message}`)
          data = (rows ?? []).map(r => ({
            Fecha: formatearFecha(r.fecha as string),
            Planchador: (r.planchador as {nombre:string})?.nombre,
            'Tipo de Media': (r.catalogo_media as {codigo:string})?.codigo,
            'Docenas Planchadas': r.docenas_planchadas,
            'Mermas': r.docenas_defectuosas,
          }))
          break
        }
        case 'ventas': {
          const { data: rows, error } = await supabase
            .from('ventas')
            .select('fecha, codigo_venta, total_soles, tipo_pago, estado, cliente:clientes(nombre), asesora:usuarios(nombre)')
            .gte('fecha', fechaInicio).lte('fecha', fechaFin)
          if (error) toast.error(`Error al generar reporte de ventas: ${error.message}`)
          data = (rows ?? []).map(r => ({
            Fecha: formatearFecha(r.fecha as string),
            'N° Venta': r.codigo_venta,
            Cliente: (r.cliente as {nombre:string})?.nombre,
            Asesora: (r.asesora as {nombre:string})?.nombre,
            Total: `S/ ${r.total_soles}`,
            'Tipo Pago': r.tipo_pago,
            Estado: r.estado,
          }))
          break
        }
        case 'mantenimiento': {
          const { data: rows, error } = await supabase
            .from('averias_maquinas')
            .select('fecha_reporte, descripcion_operador, estado, maquina:maquinas(codigo), reparaciones(costo_repuestos, costo_mano_obra, costo_total)')
            .gte('fecha_reporte', fechaInicio).lte('fecha_reporte', fechaFin)
          if (error) toast.error(`Error al generar reporte de mantenimiento: ${error.message}`)

          data = (rows ?? []).map(r => {
            const rep = (r.reparaciones as {costo_total:number}[])?.[0]
            return {
              Fecha: formatearFecha(r.fecha_reporte as string),
              Máquina: (r.maquina as {codigo:string})?.codigo,
              'Descripción Problema': r.descripcion_operador,
              Estado: r.estado,
              'Costo Total': rep ? formatearMoneda(rep.costo_total) : 'Sin reparar',
            }
          })
          break
        }
        default:
          data = [{ Nota: `Reporte del módulo ${moduloSeleccionado} — Período: ${fechaInicio} al ${fechaFin}` }]
      }

      if (formato === 'excel') {
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.json_to_sheet(data)
        XLSX.utils.book_append_sheet(wb, ws, 'Reporte')
        XLSX.writeFile(wb, `${nombreArchivo}.xlsx`)
        toast.success(`Reporte Excel descargado: ${nombreArchivo}.xlsx`)
      } else {
        // PDF: importación dinámica para evitar SSR issues
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF({ orientation: 'landscape' })
        doc.setFontSize(16)
        doc.text(`Reporte DUREY — ${moduloSeleccionado.toUpperCase()}`, 14, 20)
        doc.setFontSize(10)
        doc.text(`Período: ${fechaInicio} al ${fechaFin}`, 14, 28)
        if (data.length > 0) {
          autoTable(doc, {
            head: [Object.keys(data[0])],
            body: data.map(row => Object.values(row) as string[]),
            startY: 35,
            theme: 'grid',
            styles: { fontSize: 8 },
            headStyles: { fillColor: [30, 58, 138] },
          })
        }
        doc.save(`${nombreArchivo}.pdf`)
        toast.success(`Reporte PDF descargado: ${nombreArchivo}.pdf`)
      }
    } catch (err) {
      console.error(err)
      toast.error('Error al generar el reporte')
    } finally {
      setGenerando(false)
    }
  }, [moduloSeleccionado, fechaInicio, fechaFin, formato, supabase])

  return (
    <div className="space-y-6 animate-fadeInUp">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-xl bg-teal-500/10"><BarChart3 className="w-5 h-5 text-teal-400" /></div>
          <h1 className="text-2xl font-bold text-white">Reportes Descargables</h1>
        </div>
        <p className="text-slate-400 text-sm ml-12">Genera reportes de producción diaria en Excel o PDF por módulo</p>
      </div>

      {/* Selección de módulo */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">1. Selecciona el Módulo</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {MODULOS_REPORTE.map(m => (
            <button
              key={m.id}
              onClick={() => setModuloSeleccionado(m.id)}
              className={`glass rounded-2xl p-4 text-left border transition-all ${
                moduloSeleccionado === m.id
                  ? 'border-teal-400/40 shadow-lg shadow-teal-400/10 bg-teal-500/10'
                  : 'border-white/[0.06] hover:border-white/[0.14]'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${m.bg}`}>
                <span className={m.color}>{m.icon}</span>
              </div>
              <p className="text-white font-medium text-sm">{m.label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Filtros de fecha y formato */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-5">2. Configura el Período y Formato</h2>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              <Calendar className="w-3.5 h-3.5 inline mr-1" />Fecha Inicio
            </label>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} className="input-dark" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              <Calendar className="w-3.5 h-3.5 inline mr-1" />Fecha Fin
            </label>
            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} className="input-dark" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Formato de Descarga</label>
            <div className="flex gap-2">
              <button onClick={() => setFormato('excel')} className={`flex-1 py-2.5 rounded-xl border font-medium text-sm transition-all flex items-center justify-center gap-2 ${formato === 'excel' ? 'border-teal-400 bg-teal-500/10 text-teal-300' : 'border-white/10 text-slate-400'}`}>
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </button>
              <button onClick={() => setFormato('pdf')} className={`flex-1 py-2.5 rounded-xl border font-medium text-sm transition-all flex items-center justify-center gap-2 ${formato === 'pdf' ? 'border-teal-400 bg-teal-500/10 text-teal-300' : 'border-white/10 text-slate-400'}`}>
                <FileText className="w-4 h-4" /> PDF
              </button>
            </div>
          </div>
        </div>

        {/* Resumen */}
        {moduloSeleccionado && (
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-teal-400" />
              <div>
                <p className="text-white font-medium text-sm">
                  Reporte de {MODULOS_REPORTE.find(m => m.id === moduloSeleccionado)?.label}
                </p>
                <p className="text-slate-500 text-xs">{formatearFecha(fechaInicio)} → {formatearFecha(fechaFin)} · Formato {formato.toUpperCase()}</p>
              </div>
            </div>
            <span className="badge badge-info capitalize">{formato}</span>
          </div>
        )}

        <button
          onClick={generarReporte}
          disabled={!moduloSeleccionado || generando}
          className="btn-primary w-full justify-center py-3 text-base disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generando ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Generando reporte...</>
          ) : (
            <><Download className="w-5 h-5" /> Descargar Reporte {formato === 'excel' ? 'Excel' : 'PDF'}</>
          )}
        </button>
      </div>
    </div>
  )
}
